// Capture the original plate's moving glyphs before they are rasterized.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

let chromium;
try {
  ({chromium} = createRequire(import.meta.url)('playwright'));
} catch {
  ({chromium} = createRequire(new URL('../qa/package.json',import.meta.url))('playwright'));
}
const input=resolve(process.argv[2] || 'scripts/mapamundi/plate.html');
const target=process.argv[3] || fileURLToPath(new URL('../../public/motion.json',import.meta.url));
const fps=8,seconds=12,width=1600,height=900;
const hash=createHash('sha256').update(await readFile(input)).digest('hex');
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'chrome',headless:true});
try {
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce',offline:true});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(/^https?:/.test(r.url()))errors.push(r.url());});
  await page.addInitScript(()=>{
    const api=window.d3={};
    const state=window.__motionExport={capture:null,projection:null};
    Object.defineProperty(api,'geoEqualEarth',{configurable:true,set(factory){
      Object.defineProperty(api,'geoEqualEarth',{configurable:true,writable:true,value(...args){
        const projection=factory(...args);
        state.projection=projection;
        return projection;
      }});
    }});
    const original=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){
      if(state.capture&&this.canvas.id==='motion'){
        if(text.trim()&&this.globalAlpha>0)state.capture(this,text,x,y);
        return;
      }
      return original.call(this,text,x,y,...rest);
    };
  });
  await page.goto(pathToFileURL(input).href);
  await page.waitForFunction(()=>window.plate?.ready);
  const result=await page.evaluate(({fps,seconds})=>{
    const state=window.__motionExport;
    const p=state.projection;
    if(!p||window.plate.stats().projection!=='Equal Earth') throw new Error('Expected Equal Earth at 1600×900.');
    window.plate.setPlaying(false);
    const styles=[],styleIndex=new Map(),frames=[];
    const theme=JSON.parse(document.getElementById('score').textContent).roles;
    const roleBatches=['road','river','water','ocean'];
    const colorBatches=new Map(roleBatches.map((r,i)=>[theme[r].color.toLowerCase(),'type-'+(i+5)]));
    const q=(value,domain)=>Math.max(0,Math.min(65535,Math.round((value/domain+.5)*65535)));
    const cssFonts=new Map();
    function capture(seconds){
      let rows=[];
      state.capture=(ctx,t,x,y)=>{
        if(ctx.textAlign!=='center'||ctx.textBaseline!=='middle')throw new Error('Unexpected alignment '+ctx.textAlign);
        const matrix=ctx.getTransform(), px=matrix.a*x+matrix.c*y+matrix.e, py=matrix.b*x+matrix.d*y+matrix.f;
        const ll=p.invert([px,py]),restored=p(ll);
        if(!ll.every(Number.isFinite)||Math.hypot(restored[0]-px,restored[1]-py)>.30)throw new Error('Unprojectable glyph '+t);
        let size=cssFonts.get(ctx.font);
        if(size===undefined){
          size=Number(ctx.font.match(/([0-9.]+)px/)[1]);cssFonts.set(ctx.font,size);
        }
        const batch=colorBatches.get(ctx.fillStyle.toLowerCase());
        if(!batch)throw new Error('Unknown ink '+ctx.fillStyle);
        const key=batch+'|'+t+'|'+size;
        let i=styleIndex.get(key);
        if(i===undefined){i=styles.length;styleIndex.set(key,i);styles.push({b:batch,t,s:size});}
        const e=Math.round(Math.atan2(matrix.b,matrix.a)*1800/Math.PI);
        rows.push([q(ll[0],360),q(ll[1],180),i,e,Math.round(ctx.globalAlpha*255)]);
      };
      window.plate.seek(seconds);state.capture=null;
      const bytes=new Uint8Array(rows.length*9),view=new DataView(bytes.buffer);
      rows.forEach((r,i)=>{
        const o=i*9;
        view.setUint16(o,r[0],true);view.setUint16(o+2,r[1],true);view.setUint16(o+4,r[2],true);
        view.setInt16(o+6,r[3],true);view.setUint8(o+8,r[4]);
      });
      let bin='';
      for(let i=0;i<bytes.length;i+=8192)bin+=String.fromCharCode(...bytes.subarray(i,i+8192));
      return btoa(bin);
    }
    for(let i=0;i<fps*seconds;i++)frames.push(capture(i/fps));
    if(capture(seconds)!==frames[0])throw new Error('Loop endpoint does not match phase zero.');
    if(new Set(frames).size!==frames.length)throw new Error('Unexpected duplicate frames.');
    return {fps,seconds,recordBytes:9,styles,frames};
  },{fps,seconds});
  if(errors.length)throw new Error(errors.join('\n'));
  result.sourceHtmlSha256=hash;
  await writeFile(target,JSON.stringify(result)+'\n');
  const counts=result.frames.map(f=>Buffer.from(f,'base64').length/9);
  console.log(JSON.stringify({frames:result.frames.length,styles:result.styles.length,marks:[Math.min(...counts),Math.max(...counts)],bytes:(await readFile(target)).length,hash}));
} finally {await browser.close();}
