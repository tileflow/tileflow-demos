// The portrait opening is a two-hemisphere print. A second native Tileflow
// symbol scene lays the type on its page, while the inverse Lambert transform
// below recovers the real geographical position of the first zoom gesture.
import {mount} from '../runtime/tileflow.mjs';

const paper={width:390,height:844};
const pageLngLat=([x,y])=>[(x-paper.width/2)*360/2048,Math.atan(Math.sinh((paper.height/2-y)*2*Math.PI/2048))*180/Math.PI];
const collection=features=>({type:'FeatureCollection',features});
function movingFrame(m,index){
  const str=atob(m.frames[index]),bytes=Uint8Array.from(str,ch=>ch.charCodeAt(0)),d=new DataView(bytes.buffer),features=new Map();
  for(let o=0;o<bytes.length;o+=9){
    const type=d.getUint16(o+4,true),e=d.getInt16(o+6,true)/10,a=d.getUint8(o+8)/255,key=[type,e,a].join('|');
    if(!features.has(key))features.set(key,{type:'Feature',properties:{...m.styles[type],e,a},geometry:{type:'MultiPoint',coordinates:[]}});
    features.get(key).geometry.coordinates.push(pageLngLat([d.getUint16(o,true)*paper.width/65535,d.getUint16(o+2,true)*paper.height/65535]));
  }
  return collection([...features.values()]);
}
function coordinates(x,y,w,h){
  const scale=Math.min(w/paper.width,h/paper.height);
  x=(x-w/2)/scale+paper.width/2;y=(y-h/2)/scale+paper.height/2;
  const margin=5,gap=Math.min(18,paper.height*.021),half=(paper.height-gap)/2;
  const northPage=y<paper.height/2;
  const cy=(northPage?0:half+gap)+half/2;
  const radius=Math.min(paper.width/2-margin,half/2-margin*.32);
  let u=(x-paper.width/2)*Math.SQRT2/radius,v=(cy-y)*Math.SQRT2/radius;
  let r=Math.hypot(u,v);
  if(r>Math.SQRT2){u*=Math.SQRT2/r;v*=Math.SQRT2/r;r=Math.SQRT2;}
  const central=northPage?-90:90;
  if(r<1e-10)return [central,0];
  const a=2*Math.asin(r/2);
  const lat=Math.asin(Math.max(-1,Math.min(1,v*Math.sin(a)/r)))*180/Math.PI;
  const lon=central+Math.atan2(u*Math.sin(a),r*Math.cos(a))*180/Math.PI;
  return [((lon+540)%360)-180,Math.max(-85,Math.min(85,lat))];
}

export function portraitPlate(map,{home,toggle,initialHome}){
  const layer=document.querySelector('#portrait'),sheet=layer.querySelector('.sheet');
  let portraitMap,score,frame=-1,frameBusy=false,job,active=false,wanted=initialHome,pendingHide=0,lastStep=-1;
  let points=new Map(),start,gesture,tapTimer=0,suppressDoubleUntil=0;
  const state={active:false,ready:false,updates:0,renders:0};
  const narrow=()=>innerWidth/innerHeight<.95;
  const fit=()=>2+Math.log2(Math.min(innerWidth/paper.width,innerHeight/paper.height));
  function fadeOut(){
    active=false;state.active=false;layer.classList.remove('visible');
    clearTimeout(pendingHide);
    pendingHide=setTimeout(()=>{if(!active&&!points.size)layer.hidden=true;},190);
  }
  async function layout(){
    if(!narrow()||!wanted){fadeOut();return;}
    clearTimeout(pendingHide);layer.hidden=false;
    try{
      if(!job)job=mount(sheet,new URL('../portrait-style.json',import.meta.url).href,{
        mapName:'hemispheres',manifestUrl:new URL('../manifest.json',import.meta.url).href,
        projection:'mercator',interactive:false,center:[0,0],zoom:fit(),mapOptions:{keyboard:false,minZoom:-2,maxZoom:8}
      }).then(async x=>{
        x.map.on('render',()=>{if(active)state.renders++;});
        score=await fetch(new URL('./portrait.json',import.meta.url)).then(r=>r.json());
        const stills=collection(score.static.map(({points,...properties})=>({type:'Feature',properties,geometry:{type:'MultiPoint',coordinates:points.map(pageLngLat)}})));
        await Promise.all([x.map.getSource('glyphs').setData(stills,true),x.map.getSource('moving').setData(movingFrame(score.motion,0),true)]);
        frame=0;return x.map;
      });
      portraitMap=await job;state.ready=true;
      if(!wanted||!narrow())return;
      portraitMap.resize();portraitMap.jumpTo({center:[0,0],zoom:fit()});
      if(!portraitMap.loaded())await new Promise(resolve=>{const id=setTimeout(resolve,1200);portraitMap.once('idle',()=>{clearTimeout(id);resolve();});});
      if(wanted&&narrow()){active=true;state.active=true;layer.classList.add('visible');}
    }catch(error){console.warn('Portrait overview',error);fadeOut();}
  }
  function enter(x,y,zoom=2.75){
    if(!active)return;
    const ll=coordinates(x,y,innerWidth,innerHeight);
    wanted=false;map.jumpTo({center:ll,zoom:Math.min(20,Math.max(home().zoom+.55,zoom))});fadeOut();
    map.getCanvas().focus({preventScroll:true});
    return ll;
  }
  // Keep the portrait sheet at the minimum camera. Deep links open directly in geography.
  map.on('zoomend',()=>{
    if(map.getZoom()<=home().zoom+.04){wanted=true;layout();}
    else if(active||wanted){wanted=false;fadeOut();}
  });
  addEventListener('resize',layout);
  layer.addEventListener('wheel',e=>{e.preventDefault();if(e.deltaY<0)enter(e.clientX,e.clientY,2.6+Math.min(.65,Math.abs(e.deltaY)/400));},{passive:false});
  addEventListener('dblclick',e=>{
    if(performance.now()<suppressDoubleUntil){e.preventDefault();e.stopImmediatePropagation();}
  },true);
  layer.addEventListener('dblclick',e=>{clearTimeout(tapTimer);enter(e.clientX,e.clientY,3);});
  addEventListener('keydown',e=>{
    if(active&&(e.key==='+'||e.key==='=')){e.preventDefault();e.stopImmediatePropagation();enter(innerWidth/2,innerHeight*.25,2.75);}
  },true);
  layer.addEventListener('pointerdown',e=>{
    if(!active||e.button!==0)return;
    layer.setPointerCapture(e.pointerId);points.set(e.pointerId,[e.clientX,e.clientY]);
    if(points.size===1){start=[e.clientX,e.clientY];gesture=null;}
    if(points.size===2){
      clearTimeout(tapTimer);const [a,b]=points.values();
      gesture={distance:Math.hypot(a[0]-b[0],a[1]-b[1]),x:(a[0]+b[0])/2,y:(a[1]+b[1])/2,kind:'pinch'};
    }
  });
  layer.addEventListener('pointermove',e=>{
    if(!points.has(e.pointerId))return;
    const previous=points.get(e.pointerId);points.set(e.pointerId,[e.clientX,e.clientY]);
    if(gesture?.kind==='pinch'&&points.size===2){
      const [a,b]=points.values(),dist=Math.hypot(a[0]-b[0],a[1]-b[1]);
      const zoom=2.65+Math.log2(Math.max(1,dist/Math.max(1,gesture.distance)));
      if(active&&dist>gesture.distance*1.05){enter(gesture.x,gesture.y,zoom);gesture.started=true;}
      else if(gesture.started)map.jumpTo({zoom});
    }else if(points.size===1&&start&&gesture?.kind!=='pinch'){
      if(active&&Math.hypot(e.clientX-start[0],e.clientY-start[1])>12){
        clearTimeout(tapTimer);enter(start[0],start[1],2.65);gesture={kind:'drag'};
      }else if(gesture?.kind==='drag')map.panBy([previous[0]-e.clientX,previous[1]-e.clientY],{duration:0});
    }
  });
  function release(e){
    if(!points.has(e.pointerId))return;
    points.delete(e.pointerId);
    if(!points.size){
      if(active&&!gesture&&start&&e.pointerType==='touch'&&e.type==='pointerup'){
        if(tapTimer){clearTimeout(tapTimer);tapTimer=0;suppressDoubleUntil=performance.now()+480;enter(e.clientX,e.clientY,3);}
        else tapTimer=setTimeout(()=>{toggle();tapTimer=0;},310);
      }
      start=null;gesture=null;if(!active)layer.hidden=true;
    }
  }
  layer.addEventListener('pointerup',release);layer.addEventListener('pointercancel',release);
  layout();
  return {state,home(){wanted=true;layout();},tick(t){
    if(!active||!portraitMap)return;
    const step=Math.floor(t*8);if(step===lastStep)return;lastStep=step;
    const a=t*Math.PI/6;
    portraitMap.setPaintProperty('type-3','text-translate',[(Math.cos(a)-1)*.92,Math.sin(a)*.77]);
    portraitMap.setPaintProperty('type-4','text-translate',[Math.sin(a)*1.75,(Math.cos(a)-1)*.55]);
    const next=Math.floor(t*score.motion.fps)%score.motion.frames.length;
    if(!frameBusy&&next!==frame){
      frame=next;frameBusy=true;
      Promise.resolve(portraitMap.getSource('moving').setData(movingFrame(score.motion,frame),true)).then(()=>state.updates++).finally(()=>{frameBusy=false;});
    }
  }};
}
