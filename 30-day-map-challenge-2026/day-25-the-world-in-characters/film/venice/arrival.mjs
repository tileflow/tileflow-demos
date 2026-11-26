import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {launch} from '../../scripts/qa/browser.mjs';

const root=new URL('./',import.meta.url),p=f=>fileURLToPath(new URL(f,root));
const viewer=new URL('../../public/',root);
const base='http://127.0.0.1:8526/',n=174,fps=30,T=(n-1)/fps;
const knots=[[0,11,.65],[.80,11.83,1.36],[1.85,13.47,1.60],[2.9,15.21,1.73],[3.77,16.61,1.25],[4.55,17.29,.48],[5.18,17.48,.095],[T,17.5,0]];
function level(t){
 const next=knots.findIndex(point=>point[0]>t);
 const k=next<0?knots.length-2:Math.max(0,next-1);
 const [t0,z0,v0]=knots[k],[t1,z1,v1]=knots[k+1],h=t1-t0,u=(t-t0)/h;
 return (1+2*u)*(1-u)**2*z0+u*(1-u)**2*h*v0+u*u*(3-2*u)*z1+u*u*(u-1)*h*v1;
}
function arrival(start,end,v){
 let lo=0,hi=10;
 for(let i=0;i<60;i++){
  const k=(lo+hi)/2,a=Math.exp(-k*T),initial=k*(1-a)/(1-a*(1+k*T));
  if(initial<Math.abs(v/(end-start)))lo=k;else hi=k;
 }
 const k=(lo+hi)/2,a=Math.exp(-k*T),d=1-a*(1+k*T);
 return t=>end-(end-start)*(Math.exp(-k*t)-a*(1+k*(T-t)))/d;
}
const lon=arrival(12.2525,12.3351,.118),lat=arrival(45.4475,45.43764,-.015);
const camera=Array.from({length:n},(_,i)=>({i,center:[lon(i/fps),lat(i/fps)],z:level(i/fps)}));
const keyIndices=[0];
for(const row of camera){
 const prev=camera[keyIndices.at(-1)];
 if(row.z-prev.z>=(row.z<12.2?.25:.41))keyIndices.push(row.i);
}
if(camera.at(-1).z-camera[keyIndices.at(-1)].z>.12)keyIndices.push(153);
// A short interval is printed by both adjacent vector editions at precisely
// the same native camera. The compositor can reveal the ink by locality.
const keyClips=keyIndices.map((at,k)=>{
 const mid=(a,b)=>Math.floor((a+b)/2);
 const joinBefore=k?mid(keyIndices[k-1],at):0;
 const joinAfter=k+1<keyIndices.length?mid(at,keyIndices[k+1]):n-1;
 return {k,at,first:Math.max(0,joinBefore-(k?3:0)),last:Math.min(n-1,joinAfter+(k+1<keyIndices.length?3:0))};
});
await writeFile(p('camera.json'),JSON.stringify({camera,keyClips},null,2));
const browser=await launch(),notes=[],errors=[];
try{
 const page=await browser.newPage({viewport:{width:960,height:540},deviceScaleFactor:2,reducedMotion:'reduce'});
 const cdp=await page.context().newCDPSession(page);
 page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/detail/scale.mjs*',async route=>{
  const src=await readFile(new URL('detail/scale.mjs',viewer),'utf8');
  const token="map.on('move',moving);map.on('moveend',end);map.on('resize',resize);";
  if(!src.includes(token))throw Error('Scale capture hook');
  await route.fulfill({contentType:'text/javascript',body:src.replace(token,'window.printSheet=()=>request(true,true);')
   .replace('if(settled&&chart.press&&!chart.info','if(false&&settled&&chart.press&&!chart.info')});
 });
 await page.route('**/detail/projector.mjs*',async route=>{
  const src=await readFile(new URL('detail/projector.mjs',viewer),'utf8'),find='Math.min(110,Math.ceil(Math.min(c.w,c.h)*.13))';
  await route.fulfill({contentType:'text/javascript',body:src.replace(find,"(typeof window!=='undefined'&&window.filmOverscan?184:"+find+')')});
 });
 await page.route('**/viewer.mjs*',async route=>{
  const src=await readFile(new URL('viewer.mjs',viewer),'utf8'),find="Object.defineProperty(window,'tileflowWorld'";
  await route.fulfill({contentType:'text/javascript',body:src.replace(find,"window.inkAt=s=>{time=s;draw();};"+find)});
 });
 const first=camera[0];
 await page.goto(base+'?z='+first.z+'&lon='+first.center[0]+'&lat='+first.center[1]);
 const settled=()=>page.waitForFunction(()=>{
  const a=window.tileflowWorld,d=a?.getState().design;
  return a?.map.loaded()&&d.status==='ready'&&d.quality==='exact'&&!d.missing&&Math.abs(a.map.getZoom()-d.chartZoom)<.012;
 },null,{timeout:50000});
 await settled();
 for(const clip of keyClips){
  const {at,k,first,last}=clip,shot=camera[at];
  await mkdir(p('plates/'+k),{recursive:true});
  if(k){
   await page.evaluate(({center,z})=>{window.filmOverscan=true;const m=tileflowWorld.map;m.jumpTo({center,zoom:z});printSheet();},shot);
   await settled();
  }
  await page.waitForTimeout(180);
  const info=await page.evaluate(()=>{
   const a=tileflowWorld,m=a.map,d=a.getState().design;
   const layers=m.getStyle().layers.filter(l=>l.source===d.slot&&l.type==='symbol').map(l=>l.id);
   const words=[...new Set(m.queryRenderedFeatures({layers}).map(f=>f.properties.t).filter(x=>x?.length>=3))];
   return {z:m.getZoom(),center:m.getCenter().toArray(),chart:d.chartZoom,missing:d.missing,marks:d.gpuMarks,words};
  });
  notes.push({at,k,...info});console.log('plate',k,at,shot.z.toFixed(3),info.marks);
  for(let i=first;i<=last;i++){
   await page.evaluate(async ({row,t})=>{
    const m=tileflowWorld.map;m.jumpTo({center:row.center,zoom:row.z});inkAt(t);
    await new Promise(resolve=>{m.once('render',resolve);m.triggerRepaint();});
   },{row:camera[i],t:18+i/fps});
   const s=await cdp.send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:960,height:540,scale:2},fromSurface:true,optimizeForSpeed:true});
   const png=Buffer.from(s.data,'base64');
   await writeFile(p('plates/'+k+'/'+i+'.png'),png);
   if(!k&&!i)await writeFile(p('first.png'),png);
  }
 }
 await writeFile(p('plates.json'),JSON.stringify({notes,errors},null,2));
 if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
