import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {launch} from '../../scripts/qa/browser.mjs';
import {grades,poses,mixAt,width,height,dpr} from './flight.mjs';

const dir=new URL('./',import.meta.url),viewer=new URL('../../public/',dir);
const base='http://127.0.0.1:8526/',mode=process.argv[2]||'all';
const file=name=>fileURLToPath(new URL(name,dir));
await mkdir(file('layers'),{recursive:true});
const browser=await launch(),errors=[],logs=[];
const html=await readFile(new URL('../index.html',viewer),'utf8');
const globeJS=`
import {mount} from './runtime/tileflow.mjs';
import {clipAtHorizon} from './detail/orbit-camera.mjs';
import {createGlobePress} from './detail/globe-press.mjs?v=orbit-ink-1';
const node=document.querySelector('#globe');
document.body.classList.add('in-orbit');node.classList.add('active');document.querySelector('main').style.background='#f3f1ea';
const {map}=await mount(node,'./globe-style.json',{mapName:'globe',projection:'globe',center:[13,44],zoom:3.2,interactive:false,
   mapOptions:{minZoom:-3,fadeDuration:0,pixelRatio:2},manifestUrl:'./manifest.json'});
clipAtHorizon(map);const press=await createGlobePress(map);
window.renderWorld=async ({center,z,t,i,delta,aim})=>{
  // Compare the same geographic baseline in each projection. The late, wide
  // orbit continues its preplanned rotation rather than chasing a distant label.
  const at=()=>aim.map(ll=>{const q=map.project(ll);return [q.x,q.y]});
  map.jumpTo({center,zoom:z-.20});
  let pts=at(),actual=Math.hypot(pts[1][0]-pts[0][0],pts[1][1]-pts[0][1]);
  const zoom=map.getZoom()+Math.log2(delta/actual);
  map.jumpTo({center,zoom});
  press.tick(t);
  for(let j=0;j<2;j++)await new Promise(ok=>{map.once('render',ok);map.triggerRepaint()});
  const canvas=map.getCanvas();
  return {i,zoom:map.getZoom(),marks:press.count,points:at(),size:[canvas.width,canvas.height]};
};
window.worldReady=press.ready;`;
const stage=html.replace(/<script type="module" src="(?:\.)?\/viewer\.mjs[^"]*"><\/script>/,
 '<style>.maplibregl-control-container,[class*="tileflow-logo"],#credit,#network{display:none!important}</style><script type="module">'+globeJS+'</script>');
try{
 const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr,reducedMotion:'reduce'});
 const page=await context.newPage(),cdp=await context.newCDPSession(page);
 const report=p=>p.on('pageerror',e=>errors.push(String(e)));
 report(page);
 const shot=async(client,path)=>{
   const data=await client.send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width,height,scale:dpr},optimizeForSpeed:true,fromSurface:true});
   const bytes=Buffer.from(data.data,'base64');
   if(bytes.readUInt32BE(16)!==1920||bytes.readUInt32BE(20)!==1080)throw Error('Unexpected backing resolution');
   await writeFile(file(path),bytes);
 };
 await page.route('**/detail/scale.mjs*',async route=>{
  const orig=await readFile(new URL('detail/scale.mjs',viewer),'utf8');
  const src=orig.replace("map.on('move',moving);map.on('moveend',end);map.on('resize',resize);","window.printReturn=()=>request(true,true);")
   .replace('if(settled&&chart.press&&!chart.info','if(false&&settled&&chart.press&&!chart.info');
  await route.fulfill({contentType:'text/javascript',body:src});
 });
 await page.route('**/detail/projector.mjs*',async r=>{
  const src=await readFile(new URL('detail/projector.mjs',viewer),'utf8');
  await r.fulfill({contentType:'text/javascript',body:src.replace('Math.min(110,Math.ceil(Math.min(c.w,c.h)*.13))','250')});
 });
 await page.route('**/viewer.mjs*',async r=>{
  const src=await readFile(new URL('viewer.mjs',viewer),'utf8');
  await r.fulfill({contentType:'text/javascript',body:src.replace("Object.defineProperty(window,'tileflowWorld'","window.seekReturn=t=>{time=t;draw();};Object.defineProperty(window,'tileflowWorld'")
   .replace('function desired(map,kind){','function desired(map,kind){return kind;')});
 });
 await page.goto(base+'?z=17.5&lat=45.43764&lon=12.33510');
 const ready=()=>page.waitForFunction(()=>{
  const a=window.tileflowWorld,d=a?.getState().design;
  return d?.quality==='exact'&&!d.missing&&d.status==='ready'&&Math.abs(d.chartZoom-a.map.getZoom())<.012&&a.map.loaded();
 },null,{timeout:65000});
 await ready();
 if(mode==='all'||mode==='chart'){
  for(const [j,z] of grades.entries()){
   const rows=poses.filter(p=>mixAt(p.z).charts.some(([grade])=>grade===j));
   if(!rows.length)continue;
   const mid=poses.reduce((a,b)=>Math.abs(b.z-z)<Math.abs(a.z-z)?b:a);
   await page.evaluate(({z,center})=>{const m=tileflowWorld.map;m.jumpTo({center,zoom:z});printReturn();},{z,center:mid.center});
   await ready();await page.waitForTimeout(85);
   const d=await page.evaluate(()=>{const d=tileflowWorld.getState().design;return {sheet:d.sheet,marks:d.gpuMarks,labels:d.labels.slice(0,30)}});
   logs.push({grade:j,z,pose:mid,first:rows[0].i,last:rows.at(-1).i,...d});
   for(const row of rows){
    await page.evaluate(async({z,center,t})=>{const m=tileflowWorld.map;m.jumpTo({center,zoom:z});seekReturn(t);
      await new Promise(ok=>{m.once('render',ok);m.triggerRepaint()});},row);
    await shot(cdp,'layers/'+j+'-'+row.i+'.png');
   }
   console.log('printed',j,z,rows.length,d.sheet,d.marks);
  }
  await writeFile(file('plates.json'),JSON.stringify(logs,null,2));
 }
 if(mode==='all'||mode==='globe'){
  const globe=await context.newPage(),cap=await context.newCDPSession(globe);report(globe);
  await globe.route(base+'film-return',r=>r.fulfill({contentType:'text/html',body:stage}));
  await globe.goto(base+'film-return');await globe.waitForFunction(()=>window.worldReady===true);
  const records=[];
  for(const row of poses.filter(p=>mixAt(p.z).globe>0)){
   const target=await page.evaluate(({center,z})=>{const m=tileflowWorld.map;m.jumpTo({center,zoom:z});
    const aim=[[center[0]-.35,center[1]],[center[0]+.35,center[1]]],points=aim.map(ll=>m.project(ll));
    return {aim,delta:Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y)};
   },row);
   records.push(await globe.evaluate(arg=>renderWorld(arg),{...row,...target}));
   await shot(cap,'layers/g-'+row.i+'.png');
  }
  await writeFile(file('globe.json'),JSON.stringify(records,null,2));
 }
 if(mode==='registration'){
  const incoming=JSON.parse(await readFile(new URL('../venice/camera.json',dir),'utf8')).camera;
  const handovers=await page.evaluate(({poses,incoming})=>poses.slice(0,30).map(row=>{
   const m=tileflowWorld.map;m.jumpTo({center:row.center,zoom:row.z});
   const p=incoming.reduce((a,b)=>Math.abs(b.z-row.z)<Math.abs(a.z-row.z)?b:a,incoming.at(-1));
   const projected=m.project(p.center);
   return {i:row.i,source:p.i,scale:2**(row.z-p.z),cx:2*projected.x,cy:2*projected.y};
  }),{poses,incoming});
  handovers[0]={i:0,source:173,scale:1,cx:960,cy:540};
  await writeFile(file('handover.json'),JSON.stringify(handovers,null,2));
 }
 if(errors.length)throw Error(errors.join('\n'));
 await writeFile(file('flight.json'),JSON.stringify(poses.map(p=>({...p,...mixAt(p.z)})),null,2));
}finally{await browser.close();}
