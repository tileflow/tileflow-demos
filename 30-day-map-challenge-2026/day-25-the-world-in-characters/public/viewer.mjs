import {streetZoom} from './detail/street-scale.mjs?v=grounded-type-1';
import {mount} from './runtime/tileflow.mjs';
import {decodeFrame} from './motion-frame.mjs';
import {attachMapFooter} from './detail/credit.mjs?v=world-attribution-2';
import {attachAntimeridian} from './detail/seam.mjs?v=regional-reading-1';
import {attachWheel} from './detail/wheel.mjs?v=continuous-zoom-1';
import {attachScales} from './detail/scale.mjs?v=atlas-credits-1';
import {globeHome,chartHome,chartBoundary,equatorialFit,readCamera,wrapLongitude,clipAtHorizon} from './detail/orbit-camera.mjs?v=regional-reading-1';

const main=document.querySelector('main');
const nodes={globe:document.getElementById('globe'),chart:document.getElementById('map')};
const network=document.getElementById('network');
const showSources=attachMapFooter(document.getElementById('map-footer'));
const globeSources=['natural','etopo'];
let chartSources=globeSources;
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const scenes={},jobs={};
const recoveryKey='world-in-type.context-recovery';
const initial=readCamera(main);
let active=initial.zoom<chartBoundary(main,initial.center[1])?'globe':'chart',intent=0;
let globePress,scales,animation,frame=-1,frameBusy=false,updates=0,globeUpdates=0;
let playing=false,time=0,lastTick=null,animationId=0,timer=0;
let anchor=null,transfer=null;
const touches=new Set();
const currentMap=()=>scenes[active]?.map;

function problem(error){
  const box=document.getElementById('problem');
  box.textContent='Tileflow could not open the map. '+(error?.message||'Try a browser with WebGL 2 enabled.');
  box.hidden=false;console.error(error);
}
function present(kind){
  active=kind;
  for(const [name,node] of Object.entries(nodes)){
    node.classList.toggle('active',name===kind);node.inert=name!==kind;
    node.setAttribute('aria-hidden',String(name!==kind));
  }
  document.body.classList.toggle('in-orbit',kind==='globe');
  showSources(kind==='globe'?globeSources:chartSources,scenes[kind]?.map);
}
function cameraOf(map){
  const ll=map.getCenter();
  return {center:[wrapLongitude(ll.lng),ll.lat],zoom:map.getZoom(),pitch:0,bearing:0};
}
function persist(){
  const map=currentMap();if(!map)return;
  const {center,zoom}=cameraOf(map),home=globeHome(main),url=new URL(location.href);
  if(active==='globe'&&Math.abs(zoom-home.zoom)<.005&&Math.abs(center[0]-home.center[0])<.01&&Math.abs(center[1]-home.center[1])<.01){
    for(const key of ['z','lat','lon'])url.searchParams.delete(key);
  }else{
    url.searchParams.set('z',zoom.toFixed(3));url.searchParams.set('lat',center[1].toFixed(6));url.searchParams.set('lon',center[0].toFixed(6));
  }
  if(url.href!==location.href)history.replaceState(null,'',url);
}
function draw(){
  const map=currentMap();if(!map||map.isMoving())return;
  const a=time*Math.PI/6;
  if(active==='globe'){
    if(globePress?.ready){globePress.tick(time);globeUpdates++;return;}
    map.setPaintProperty('globe-tide','text-translate',[Math.sin(a)*1.55,(Math.cos(a)-1)*.47]);
    map.setPaintProperty('globe-road-flow','text-translate',[Math.sin(a)*1.2,0]);
    globeUpdates++;return;
  }
  scales?.tick(time);
  if(!animation||map.getZoom()>=5||!scales?.worldWeight)return;
  const scale=2**(map.getZoom()-Math.log2(1578.4/512));
  map.setPaintProperty('type-3','text-translate',[(Math.cos(a)-1)*1.55*scale,Math.sin(a)*1.28*scale]);
  map.setPaintProperty('type-4','text-translate',[Math.sin(a)*2.95*scale,(Math.cos(a)-1)*.92*scale]);
  const index=Math.floor(time%12*animation.fps)%animation.frames.length;
  if(frameBusy||index===frame)return;
  frame=index;frameBusy=true;
  Promise.resolve(map.getSource('moving').setData(decodeFrame(animation,index),true)).then(()=>updates++).catch(problem).finally(()=>{frameBusy=false;});
}
function tick(now){
  animationId=0;
  if(!playing||document.hidden||!currentMap()||currentMap().isMoving()||active==='chart'&&currentMap().getZoom()>=streetZoom){lastTick=null;return;}
  if(lastTick!==null)time+=(now-lastTick)/1000;
  lastTick=now;draw();
  const delay=active==='globe'?120:scales?.worldWeight?0:200;
  if(delay)timer=setTimeout(()=>{timer=0;animationId=requestAnimationFrame(tick);},delay);
  else animationId=requestAnimationFrame(tick);
}
function schedule(){
  cancelAnimationFrame(animationId);clearTimeout(timer);animationId=0;timer=0;lastTick=null;
  if(playing&&!document.hidden&&currentMap()&&!currentMap().isMoving())animationId=requestAnimationFrame(tick);
}
function desired(map,kind){
  const boundary=chartBoundary(main,map.getCenter().lat);
  if(kind==='globe'&&map.getZoom()>boundary+.12)return 'chart';
  if(kind==='chart'&&map.getZoom()<boundary-.12)return 'globe';
  return kind;
}
function register(kind,map){
  const canvas=map.getCanvas();
  canvas.setAttribute('aria-label',kind==='globe'?'World globe. Drag to rotate.':'World atlas. Drag to explore.');
  canvas.addEventListener('webglcontextlost',()=>{
    if(kind!==active)return;
    persist();
    try{sessionStorage.setItem(recoveryKey,JSON.stringify({url:location.href,at:Date.now(),playing,time}));}catch{}
  });
  canvas.addEventListener('webglcontextrestored',()=>location.reload(),{once:true});
  map.on('movestart',()=>{if(kind===active)schedule();});
  map.on('zoom',()=>{
    if(kind!==active)return;
    const z=map.getZoom(),boundary=chartBoundary(main,map.getCenter().lat);
    // Warm the second projection only as its scale approaches. A drag at the
    // world opening does not fetch the other scene or run its compositor.
    if(kind==='globe'&&z>boundary-.40&&!jobs.chart)ensure('chart',cameraOf(map)).catch(problem);
    if(kind==='chart'&&z<boundary+.40&&!jobs.globe)ensure('globe',cameraOf(map)).catch(problem);
    if(desired(map,kind)!==kind&&!touches.size)route();
  });
  map.on('moveend',()=>{
    if(kind!==active)return;
    persist();schedule();route();
  });
}
async function build(kind,camera){
  const sphere=kind==='globe',node=nodes[kind];
  const opts=sphere?{projection:'globe',mapName:'globe'}:{projection:'equalEarth',mapName:'world-in-type'};
  const style=sphere?'globe-style.json?v=touch-orbit-1':'style.json?v=approach-2';
  const scene=await mount(node,new URL(style,import.meta.url).href,{
    ...opts,...(sphere?camera:chartHome(main)),manifestUrl:'./manifest.json?v=approach-2',
    mapOptions:{maxZoom:20,keyboard:true,minZoom:sphere?equatorialFit(main):-2,fadeDuration:sphere?65:20}
  });
  const {map}=scene;
  if(sphere){
    map.jumpTo(camera);clipAtHorizon(map);
    try{
      const {createGlobePress}=await import('./detail/globe-press.mjs?v=orbit-ink-1');
      globePress=await createGlobePress(map);
    }catch(error){console.warn('The globe is using Tileflow symbol layers.',error);}
    let previous=equatorialFit(main);
    map.on('resize',()=>{
      const fit=equatorialFit(main),ll=map.getCenter().toArray(),home=globeHome(main,ll);
      const wasFitted=Math.abs(map.getZoom()-(home.zoom-fit+previous))<.06;
      previous=fit;map.setMinZoom(fit);if(wasFitted)map.jumpTo(home);
    });
  }else{
    map.setMinZoom(chartHome(main).zoom);attachWheel(map,node);
    attachAntimeridian(map,()=>scales?.projectionChanged());
    map.jumpTo(camera);
    map.on('resize',()=>map.setMinZoom(chartHome(main).zoom));
    scales=attachScales(map,{
      home:()=>chartHome(main),
      onCreditSources(sources){
        chartSources=sources;
        if(active==='chart')showSources(sources,map);
      },
      onStatus(text){network.hidden=!text;network.textContent=text;}
    });
    fetch(new URL('./motion.json',import.meta.url)).then(r=>{if(!r.ok)throw Error('Motion file unavailable');return r.json();}).then(data=>{animation=data;}).catch(problem);
  }
  scenes[kind]=scene;register(kind,map);
  return scene;
}
function ensure(kind,camera){
  if(!jobs[kind])jobs[kind]=build(kind,camera).catch(e=>{delete jobs[kind];throw e;});
  return jobs[kind];
}
function surfaceArea(map,ll){
  const step=wrapLongitude(ll.lng)>179.9?-.025:.025;
  const origin=map.project(ll),east=map.project([ll.lng+step,ll.lat]),north=map.project([ll.lng,ll.lat+.025]);
  return Math.abs((east.x-origin.x)*(north.y-origin.y)-(north.x-origin.x)*(east.y-origin.y));
}
function place(map,camera,at,source,target){
  map.jumpTo(camera);
  const boundary=chartBoundary(main,camera.center[1]);
  if(Math.abs(camera.zoom-boundary)<.8){
    // The spherical and equal-area projections give a map degree different
    // lengths at the same SDK zoom. Match local ground area under the pointer.
    const ll=at?.ll||source.getCenter();
    if(Math.abs(ll.lat)<84){
      const from=surfaceArea(source,ll),to=surfaceArea(map,ll);
      const delta=.5*Math.log2(from/to);
      if(Number.isFinite(delta)&&Math.abs(delta)>.012){
        const z=camera.zoom+Math.max(-.6,Math.min(.6,delta));
        map.setZoom(target==='chart'?Math.max(boundary,z):Math.min(boundary,z));
      }
    }
  }
  if(!at)return;
  // Keep the place below the wheel or fingers in the same screen position
  // through the change from perspective to the regional projection.
  for(let i=0;i<3;i++){
    const p=map.project(at.ll),dx=p.x-at.x,dy=p.y-at.y;
    if(!Number.isFinite(dx+dy)||Math.hypot(dx,dy)<.6)break;
    map.panBy([dx,dy],{duration:0});
  }
}
function pointerAnchor(map){
  if(!anchor||performance.now()-anchor.t>950)return null;
  const {x,y}=anchor,ll=anchor.ll||map.unproject([x,y]);
  return ll&&Number.isFinite(ll.lng+ll.lat)?{x,y,ll}:null;
}
function nextFrame(map){
  return new Promise(resolve=>{map.once('render',resolve);map.triggerRepaint();});
}
async function changeScene(source,target,token){
  const map=scenes[source].map;
  const valid=()=>token===intent&&active===source&&!touches.size&&desired(map,source)===target;
  const {map:next}=await ensure(target,cameraOf(map));
  if(!valid())return;
  let camera=cameraOf(map);
  place(next,camera,pointerAnchor(map),map,target);
  // Keep the old scene visible while the incoming one draws. During a wheel
  // burst switch within the gesture, so the remaining events reach the atlas.
  const peninsular=target==='chart'&&scales.awaitsPeninsula();
  const deadline=performance.now()+(map.isMoving()?120:1200);
  const limit=peninsular?deadline+4000:deadline;
  do{
    await nextFrame(next);if(!valid())return;
    const ready=target==='globe'?next.areTilesLoaded():scales.state.quality==='exact'&&scales.state.status==='ready';
    if(ready&&(!peninsular||scales.state.sheet==='peninsula'))break;
    // The globe stays interactive until its successor has ink. A regional
    // fallback can still take over if the dedicated geography failed to load.
    if(peninsular&&scales.state.status==='error')break;
    if(peninsular&&ready&&scales.state.sheet==='regional'&&performance.now()>deadline)break;
  }while(performance.now()<limit);
  const latest=cameraOf(map);
  if(latest.zoom!==camera.zoom||latest.center.some((v,i)=>v!==camera.center[i])){
    // Inertia may have advanced the source while the other canvas was drawing.
    // Hand off the settled pose only after the new canvas has painted that pose.
    if(map.isMoving())map.stop();
    place(next,latest,pointerAnchor(map),map,target);
    await nextFrame(next);if(!valid())return;
  }
  const focused=nodes[source].contains(document.activeElement);
  present(target);
  if(map.isMoving())map.stop();
  if(focused)next.getCanvas().focus({preventScroll:true});
  persist();schedule();
}
function route(){
  const source=active,map=currentMap();if(!map||touches.size||transfer)return;
  const target=desired(map,source);if(target===source)return;
  const token=intent;
  transfer=changeScene(source,target,token).then(()=>{
    transfer=null;
    // A finger can cancel the in-flight transfer and lift before it completes.
    if(token===intent&&!touches.size&&desired(currentMap(),active)!==active)requestAnimationFrame(route);
  },error=>{transfer=null;problem(error);});
}
async function home(){
  const token=++intent;
  anchor=null;
  const camera=globeHome(main),from=currentMap(),focused=nodes[active].contains(document.activeElement);
  if(from?.isMoving())from.stop();
  const {map}=await ensure('globe',camera);
  if(token!==intent)return;
  map.jumpTo(camera);
  // A globe returning from the renderer's high-zoom planar projection applies
  // its latitude-aware minimum after the first spherical frame.
  if(Math.abs(map.getZoom()-camera.zoom)>.001){
    await nextFrame(map);if(token!==intent)return;
    map.jumpTo(camera);await nextFrame(map);if(token!==intent)return;
  }
  present('globe');
  if(focused)map.getCanvas().focus({preventScroll:true});
  persist();schedule();
}
function toggle(){
  if(active==='chart'&&currentMap()?.getZoom()>=streetZoom)return;
  playing=!playing;schedule();
}
let tap=null,tapTimer=0;
const fingers=new Map();
main.addEventListener('wheel',e=>{
  const x=e.clientX,y=e.clientY,t=performance.now(),map=currentMap();
  const same=anchor?.ll&&t-anchor.t<300&&Math.hypot(x-anchor.x,y-anchor.y)<2;
  anchor={x,y,t,ll:same?anchor.ll:map?.unproject([x,y])};
},{capture:true,passive:true});
main.addEventListener('dblclick',e=>{anchor={x:e.clientX,y:e.clientY,t:performance.now()};},true);
main.addEventListener('pointerdown',e=>{
  touches.add(e.pointerId);anchor=null;
  if(e.pointerType==='touch'){
    fingers.set(e.pointerId,[e.clientX,e.clientY]);
    tap=fingers.size===1?[e.pointerId,e.clientX,e.clientY]:null;
    if(fingers.size>1){clearTimeout(tapTimer);tapTimer=0;}
  }
},true);
main.addEventListener('pointermove',e=>{
  if(!fingers.has(e.pointerId))return;
  fingers.set(e.pointerId,[e.clientX,e.clientY]);
  if(fingers.size===2){
    const [a,b]=fingers.values();
    anchor={x:(a[0]+b[0])/2,y:(a[1]+b[1])/2,t:performance.now()};
  }
},{capture:true,passive:true});
function release(e){
  if(!touches.delete(e.pointerId))return;
  fingers.delete(e.pointerId);
  if(tap?.[0]===e.pointerId&&e.type==='pointerup'&&Math.hypot(e.clientX-tap[1],e.clientY-tap[2])<9){
    if(tapTimer){clearTimeout(tapTimer);tapTimer=0;anchor={x:e.clientX,y:e.clientY,t:performance.now()};}
    else tapTimer=setTimeout(()=>{toggle();tapTimer=0;},320);
  }
  tap=null;
  if(!touches.size)requestAnimationFrame(route);
}
window.addEventListener('pointerup',release,true);
window.addEventListener('pointercancel',release,true);
window.addEventListener('blur',()=>{touches.clear();fingers.clear();tap=null;});
document.addEventListener('visibilitychange',schedule);
reduced.addEventListener('change',e=>{if(e.matches)playing=false;schedule();});
addEventListener('keydown',e=>{
  if(e.metaKey||e.ctrlKey||e.altKey||e.repeat)return;
  if(e.code==='Space'){e.preventDefault();toggle();}
  if(e.code==='Home'){e.preventDefault();home().catch(problem);}
  if(e.key.toLowerCase()==='f'){
    e.preventDefault();
    if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});
    else document.documentElement.requestFullscreen?.().catch(()=>{});
  }
});
async function start(){
  present(active);
  try{
    const entry=JSON.parse(sessionStorage.getItem(recoveryKey)||'null');
    sessionStorage.removeItem(recoveryKey);
    if(entry&&entry.url===location.href&&Date.now()-entry.at<60000){time=entry.time;playing=entry.playing&&!reduced.matches;}
  }catch{}
  await ensure(active,initial);
  Object.defineProperty(window,'tileflowWorld',{value:{
    get map(){return currentMap();},get controller(){return scenes[active].controller;},get globe(){return scenes.globe;},home,
    getState(){
      const map=currentMap(),sphere=active==='globe';
      const design=sphere?{mode:'globe',quality:'original',status:'ready',glyphRenderer:globePress?.ready?'instanced':'native',gpuMarks:globePress?.count||0,center:map.getCenter().toArray(),zoom:map.getZoom(),weights:[1,0,0]}:scales.state;
      return {projection:map.getProjection()?.type,design,globe:{active:sphere,ready:!!scenes.globe,updates:globeUpdates},
        portrait:{active:false,ready:false},playing,frame,updates};
    },pause(){playing=false;schedule();},play(){playing=true;schedule();}
  }});
  schedule();
}
start().catch(problem);
