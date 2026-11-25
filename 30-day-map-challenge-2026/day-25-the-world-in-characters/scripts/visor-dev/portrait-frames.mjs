// Extract the live lettering before the original two-hemisphere plate is rasterized.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const {chromium}=createRequire(new URL('../qa/package.json',import.meta.url))('playwright');
const width=390,height=844,fps=8,seconds=12;
const src=resolve('scripts/mapamundi/plate.html'),target=resolve('public/detail/portrait.json');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,offline:true,reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    const state=window.__portraitCapture={planes:new Map()};
    const proto=CanvasRenderingContext2D.prototype,original=proto.fillText,clear=proto.clearRect;
    proto.fillText=function(ch,x,y,...rest){
      const id=this.canvas.id;
      if(id&&this.canvas.isConnected&&ch.trim()&&this.globalAlpha>0){
        const t=this.getTransform(),width=this.textAlign==='center'?0:this.measureText(ch).width*(this.textAlign==='right'||this.textAlign==='end'?-.5:.5);
        if(this.textBaseline!=='middle')throw Error(this.textBaseline);
        let plane=state.planes.get(id);
        if(!plane){plane=[];state.planes.set(id,plane);}
        plane.push({id,t:ch,x:t.a*(x+width)+t.c*y+t.e,y:t.b*(x+width)+t.d*y+t.f,
          e:Math.atan2(t.b,t.a)*180/Math.PI,s:Number(this.font.match(/([\d.]+)px/)[1]),
          face:this.font.includes('Instrument Serif')?'serif':'mono',c:this.fillStyle.toLowerCase(),a:this.globalAlpha});
      }
      return original.call(this,ch,x,y,...rest);
    };
    proto.clearRect=function(x,y,w,h){
      if(x===0&&y===0&&w>=this.canvas.width&&h>=this.canvas.height)state.planes.delete(this.canvas.id);
      return clear.call(this,x,y,w,h);
    };
    for(const name of ['width','height']){
      const d=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,name);
      Object.defineProperty(HTMLCanvasElement.prototype,name,{...d,set(v){state.planes.delete(this.id);d.set.call(this,v);}});
    }
  });
  await page.goto(pathToFileURL(src).href);
  await page.waitForFunction(()=>window.plate?.ready);
  const result=await page.evaluate(({width,height,fps,seconds})=>{
    const planes=window.__portraitCapture.planes;
    const colors=Object.fromEntries(Object.entries(JSON.parse(document.getElementById('score').textContent).roles).map(([k,v])=>[v.color.toLowerCase(),k]));
    const asBatch=m=>{
      const r=colors[m.c];
      const index=m.id==='geography'?({shore:0,river:1,border:2})[r]
        :m.id==='water-a'?3:m.id==='water-b'?4:m.id==='motion'?({road:5,river:6,water:7,ocean:8})[r]
        :m.id==='lettering'?(m.face==='serif'?9:10):null;
      if(!Number.isInteger(index))throw Error('Unknown layer '+[m.id,m.c,r].join('/'));
      return 'type-'+index;
    };
    window.plate.setPlaying(false);
    window.plate.seek(0);
    if(window.plate.stats().projection!=='Lambert hemispheres')throw Error('Unexpected projection');
    const n2=n=>Math.round(n*100)/100,n3=n=>Math.round(n*1000)/1000;
    const groups=new Map();
    for(const id of ['geography','water-a','water-b','lettering']){
      for(const m of planes.get(id)||[]){
        const b=asBatch(m),e=n2(m.e),a=n3(m.a),s=n2(m.s);
        const k=[b,m.t,s,e,a,m.c].join('|');
        let group=groups.get(k);if(!group){group={b,t:m.t,s,e,a,c:m.c,points:[]};groups.set(k,group);}
        group.points.push([n2(m.x),n2(m.y)]);
      }
    }
    const frames=[],styles=[],indices=new Map();
    function encodedFrame(seconds){
      window.plate.seek(seconds);
      const marks=planes.get('motion');
      const bytes=new Uint8Array(marks.length*9),v=new DataView(bytes.buffer);
      for(let i=0;i<marks.length;i++){
        const m=marks[i],b=asBatch(m),s=n2(m.s),key=[b,m.t,s,m.c].join('|');
        let j=indices.get(key);if(j===undefined){j=styles.length;indices.set(key,j);styles.push({b,t:m.t,s,c:m.c});}
        if(m.x<0||m.x>width||m.y<0||m.y>height)throw Error('Out of paper: '+[m.x,m.y]);
        const o=9*i;
        v.setUint16(o,Math.round(m.x/width*65535),true);v.setUint16(o+2,Math.round(m.y/height*65535),true);
        v.setUint16(o+4,j,true);v.setInt16(o+6,Math.round(m.e*10),true);v.setUint8(o+8,Math.round(m.a*255));
      }
      let bin='';for(let i=0;i<bytes.length;i+=8192)bin+=String.fromCharCode(...bytes.subarray(i,i+8192));
      return btoa(bin);
    }
    for(let i=0;i<fps*seconds;i++)frames.push(encodedFrame(i/fps));
    if(encodedFrame(seconds)!==frames[0]||new Set(frames).size!==frames.length)throw Error('Motion loop mismatch');
    const unit=Math.max(.53,Math.min(width/655,height/1180,1.5));
    const margin=Math.max(5,Math.min(width,height)*.012),gap=Math.min(18,height*.021),half=(height-gap)/2;
    const radius=Math.min(width/2-margin,half/2-margin*.32);
    return {width,height,unit,hemispheres:[{center:[-90,0],origin:[width/2,half/2],radius},{center:[90,0],origin:[width/2,height-half/2],radius}],
      static:[...groups.values()],motion:{fps,seconds,recordBytes:9,styles,frames}};
  },{width,height,fps,seconds});
  if(errors.length)throw Error(errors.join('\n'));
  result.sourceHtmlSha256=createHash('sha256').update(await readFile(src)).digest('hex');
  await writeFile(target,JSON.stringify(result)+'\n');
  console.log(JSON.stringify({width,height,static:result.static.reduce((n,g)=>n+g.points.length,0),moving:Buffer.from(result.motion.frames[0],'base64').length/9,frames:result.motion.frames.length,bytes:(await readFile(target)).length}));
} finally {await browser.close();}
