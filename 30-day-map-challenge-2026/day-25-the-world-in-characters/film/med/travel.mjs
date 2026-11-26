import {writeFile} from 'node:fs/promises';
import {launch} from '../../scripts/qa/browser.mjs';
import {camera} from './path.mjs';

const pose=Array.from({length:331},(_,i)=>camera(i/30));
const outline=Array.from({length:991},(_,i)=>{
  const t=i/90,[lon,lat]=camera(t).center;
  return [lon-.1538*Math.exp(-2*t),lat+.1668*Math.exp(-2*t)];
});
const browser=await launch();
try{
  const page=await browser.newPage({viewport:{width:960,height:540},deviceScaleFactor:2,reducedMotion:'reduce'});
  await page.goto('http://127.0.0.1:8526/?z=5.25&lon=-3.55&lat=40.25');
  await page.waitForFunction(()=>window.tileflowWorld?.map?.loaded());
  const samples=[];
  for(const [i,p] of pose.entries()){
    const measurement=await page.evaluate(({p,outline})=>{
      const m=tileflowWorld.map;
      m.jumpTo({center:p.center,zoom:p.z});
      const origin=m.project([4,44]),east=m.project([5,44]);
      return {origin:[origin.x,origin.y],dx:east.x-origin.x,route:outline.map(ll=>{
        const q=m.project(ll);return [Math.round(q.x*200)/100,Math.round(q.y*200)/100];
      })};
    },{p,outline});
    const {route,...sample}=measurement;
    samples.push(sample);
    if(i<330)await writeFile(new URL('route-'+i+'.json',import.meta.url),JSON.stringify(route));
  }
  await writeFile(new URL('journey.json',import.meta.url),JSON.stringify({poses:pose,samples}));
}finally{await browser.close();}
