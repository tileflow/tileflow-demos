import { createStyle, defineMap, geojsonSource, maplibreOverlay } from '@tileflow/core';
import { chromium } from 'playwright';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import definition from './tileflow.config.mjs';

const [input, out] = process.argv.slice(2);
if (!input || !out) throw Error('Usage: node export-frame.mjs <interactive-map.html> <output-directory>');
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
const viewport = { width: 1600, height: 900 };
let captured;
try {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, offline: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    const api = window.d3 = {};
    const snapshot = window.__typeCapture = { surfaces: new Map() };
    // Capture the actual Equal Earth instance. Its extent and scale are subsequently
    // set by the page itself, including at future revisions of the plate layout.
    Object.defineProperty(api, 'geoEqualEarth', { configurable: true, set(factory) {
      Object.defineProperty(api, 'geoEqualEarth', { configurable: true, writable: true, value(...args) {
        snapshot.projection = factory(...args);
        return snapshot.projection;
      } });
    } });
    const proto = CanvasRenderingContext2D.prototype;
    const originalText = proto.fillText, originalClear = proto.clearRect;
    proto.fillText = function(text, x, y, ...rest) {
      if (this.canvas.isConnected && text.trim() && this.globalAlpha > 0) {
        if (!snapshot.surfaces.has(this.canvas)) snapshot.surfaces.set(this.canvas, []);
        const commands = snapshot.surfaces.get(this.canvas);
        const align = this.textAlign;
        const advance = (align === 'center') ? 0 :
          this.measureText(text).width * (align === 'right' || align === 'end' ? -0.5 : 0.5);
        const t = this.getTransform(), p = new DOMPoint(x + advance, y).matrixTransform(t);
        commands.push({
          x: p.x, y: p.y, angle: Math.atan2(t.b, t.a), font: this.font, color: this.fillStyle,
          alpha: this.globalAlpha, text, baseline: this.textBaseline,
        });
      }
      return originalText.call(this, text, x, y, ...rest);
    };
    proto.clearRect = function(x,y,w,h) {
      if (x === 0 && y === 0 && w >= this.canvas.width && h >= this.canvas.height) {
        snapshot.surfaces.delete(this.canvas);
      }
      return originalClear.call(this,x,y,w,h);
    };
    for (const name of ['width','height']) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,name);
      Object.defineProperty(HTMLCanvasElement.prototype,name,{
        ...descriptor, set(v) { snapshot.surfaces.delete(this); descriptor.set.call(this,v); },
      });
    }
  });
  await page.goto(pathToFileURL(resolve(input)).href);
  await page.waitForFunction(() => window.plate?.ready);
  captured = await page.evaluate(() => {
    window.plate.setPlaying(false);
    window.plate.seek(0);
    const {surfaces, projection:p} = window.__typeCapture;
    if (!p || window.plate.stats().projection !== 'Equal Earth') throw Error('A landscape Equal Earth plate is required.');
    const score = JSON.parse(document.getElementById('score').textContent);
    const colors = Object.fromEntries(Object.entries(score.roles).map(([role,style]) => [style.color.toLowerCase(),role]));
    const world = [], mercMax = 85.0511287798;
    const toDeg = 180/Math.PI;
    const mercY = lat => -Math.asinh(Math.tan(Math.max(-mercMax, Math.min(mercMax,lat)) / toDeg)) * toDeg;
    let excluded = 0, polar = 0;
    // Each canvas occupies one compositing plane. Its CSS translation is separate
    // from the per-character transformation recorded by getTransform().
    for (const canvas of document.querySelectorAll('canvas')) {
      const rect = canvas.getBoundingClientRect(), sx=rect.width/canvas.width, sy=rect.height/canvas.height;
      for (const mark of surfaces.get(canvas) || []) {
        if(mark.baseline !== 'middle') throw Error('Unsupported text baseline: ' + mark.baseline);
        const x=rect.x+mark.x*sx, y=rect.y+mark.y*sy;
        const ll=p.invert([x,y]), restored=p(ll);
        if (!Number.isFinite(ll[0]) || !Number.isFinite(ll[1]) || Math.hypot(restored[0]-x,restored[1]-y)>.3) {
          excluded++; continue;
        }
        const localAngle=Math.atan2(Math.sin(mark.angle)*sy,Math.cos(mark.angle)*sx);
        const epsilon=.15;
        const tangent=p.invert([x+Math.cos(localAngle)*epsilon,y+Math.sin(localAngle)*epsilon]);
        const dx=((tangent[0]-ll[0]+540)%360)-180;
        const angle=Math.atan2(mercY(tangent[1])-mercY(ll[1]),dx)*toDeg;
        const face=mark.font.includes('Instrument Serif')?
          (mark.font.includes('italic')?'Instrument Serif Italic':'Instrument Serif'):'JetBrains Mono';
        const size=Number(mark.font.match(/([0-9.]+)px/)[1]);
        const role=colors[mark.color.toLowerCase()];
        if(!role) throw Error('No Tileflow symbol role for '+mark.color);
        // Keep polar marks in WGS84, although a Mercator camera cannot show their anchors.
        if(Math.abs(ll[1])>mercMax) polar++;
        world.push({
          pos:[+ll[0].toFixed(5),+ll[1].toFixed(5)],plane:canvas.id,face,role,
          t:mark.text, a:+mark.alpha.toFixed(3), s:+size.toFixed(2),
          r:Math.round(angle*2)/2, e:Math.round(localAngle*toDeg*2)/2,
        });
      }
    }
    return {world,excluded,polar,score};
  });
  if(errors.length)throw Error(errors.join('\n'));
} finally { await browser.close(); }

const faces = {
  'Instrument Serif':'./fonts/instrument-serif-latin.woff2',
  'Instrument Serif Italic':'./fonts/instrument-serif-italic-latin.woff2',
  'JetBrains Mono':'./fonts/jetbrains-mono.woff2',
};
const batches = new Map(), features = new Map(), counts = {};
for (const {pos,plane,face,role,t,a,s,r,e} of captured.world) {
  const key=[plane,face,role].join('/');
  if (!batches.has(key)) batches.set(key, {id:'type-'+batches.size, face,role});
  const {id}=batches.get(key), attributes={b:id,t,a,s,r,e};
  const signature=JSON.stringify(attributes);
  if (!features.has(signature)) features.set(signature, {
    type:'Feature',geometry:{type:'MultiPoint',coordinates:[]},properties:attributes,
  });
  features.get(signature).geometry.coordinates.push(pos);
  counts[role]=(counts[role]||0)+1;
}
const data={type:'FeatureCollection',features:[...features.values()]};
const layers = [...batches.values()].map(({id,face,role}) => ({
  id, type:'symbol', filter:['==',['get','b'],id],
  layout:{
    'symbol-placement':'point','text-field':['get','t'],'text-font':[face],
    'text-size':['get','s'],'text-rotate':['get','r'],'text-rotation-alignment':'viewport',
    'text-anchor':'center','text-padding':0,'text-allow-overlap':true,'text-ignore-placement':true,
  },
  paint:{'text-color':captured.score.roles[role].color,'text-opacity':['get','a']},
}));
const frame = defineMap({
  ...definition, id:'the-world-in-type-frame',name:'The world in type — geographic glyphs',
  projection:'mercator', sources:{glyphs:geojsonSource({data:{type:'FeatureCollection',features:[]}})},
  overlays:{ink:maplibreOverlay({source:'glyphs',placement:'above-labels',layers})},
});
const style=createStyle(frame);
style.layers.unshift({id:'paper',type:'background',paint:{'background-color':captured.score.paper}});
style.sources={glyphs:{type:'geojson',data:'./glyphs.geojson'}};
style['font-faces']=faces;
style.center=[0,0];style.zoom=0.79;
// The compiler also describes its optional World basemap in provenance. This
// frame uses independent local glyph points. Remove those unused source records.
delete style.metadata['tileflow:data'];delete style.metadata['tileflow:sources'];
const receipt={
  sourceHtmlSha256:createHash('sha256').update(await readFile(input)).digest('hex'),
  sourceFrame:{...viewport,seconds:0,projection:'Equal Earth',dpr:1},
  styleProjection:'Mercator', positions:'WGS84 [longitude, latitude]',
  coordinates:captured.world.length, groups:features.size, layers:layers.length, roleCounts:counts,
  outsideSourceProjection:captured.excluded, aboveMercatorLimit:captured.polar,
};
style.metadata['world-in-type:frame']=receipt;
await mkdir(out,{recursive:true});
await cp(new URL('../../public/fonts/',import.meta.url),join(out,'fonts'),{recursive:true});
for(const [name,content] of [['style.json',JSON.stringify(style,null,2)],['glyphs.geojson',JSON.stringify(data)],
  ['frame.json',JSON.stringify(receipt,null,2)]])await writeFile(join(out,name),content+'\n');
console.log(JSON.stringify(receipt));
