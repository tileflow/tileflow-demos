import {streetZoom} from './street-scale.mjs?v=grounded-type-1';
import {wordHistory,wordKeys} from './word-identity.mjs?v=continuous-zoom-1';
import {wordZoomOpacity} from './word-optics.mjs';

const transparent=1e-8,fadeOut=95,fadeIn=135;
const clamp=t=>Math.max(0,Math.min(1,t));
const smooth=t=>{t=clamp(t);return t*t*(3-2*t);};
const bounds=(word,p)=>{
  const rows=String(word.t).split('\n'),w=Math.max(...rows.map(row=>row.length))*word.s*.35+4,h=word.s*(rows.length*.62)+4;
  const rotation=(word.e||0)*Math.PI/180,c=Math.abs(Math.cos(rotation)),s=Math.abs(Math.sin(rotation));
  return {x:p[0],y:p[1],w:w*c+h*s,h:h*c+w*s};
};
const intersects=(a,b)=>Math.abs(a.x-b.x)<a.w+b.w&&Math.abs(a.y-b.y)<a.h+b.h;
export const isWordLayer=id=>/-(?:type|road-up|road-down|road-steep)$/.test(id);
const channel=n=>['at',n,['var','channels']];
const wordColor=['let','channels',['to-rgba',['to-color',['get','ink']]],
  ['rgba',channel(0),channel(1),channel(2),['*',channel(3),['number',['feature-state','wordInk'],0]]]];

// Keep the native symbol buckets, fonts, collision choices and projection. Only
// opacity changes during a handoff. A shared name has one visible instance.
export function createWordHandoff(map,reduced){
  let frame,leaving,entering,lastTick=-Infinity;
  const levels=new Map(),editions=new Map(),configured=new Set();
  const feature=(slot,id)=>({source:slot,id});

  function set(slot,id,value){
    if((levels.get(id)??0)===value)return;
    levels.set(id,value);
    map.setFeatureState(feature(slot,id),{wordInk:value});
  }
  function clear(slot){
    if(!slot||!editions.has(slot))return;
    for(const a of editions.get(slot).anchors)levels.delete(a.id);
    map.removeFeatureState({source:slot});
  }
  function forget(slot){
    if(leaving?.slot===slot)leaving=null;
    if(entering?.slot===slot)entering=null;
    clear(slot);editions.delete(slot);
  }
  function prepare(slot,chart,id){
    if(id.includes('-enter-'))return;
    if(!configured.has(id)){
      map.setPaintProperty(id,'text-color-transition',{duration:0,delay:0});
      map.setPaintProperty(id,'text-opacity-transition',{duration:0,delay:0});
      map.setPaintProperty(id,'text-color',wordColor);
      configured.add(id);
    }
    // Keep the optical switch a camera uniform. A feature-state/zoom composite
    // is sampled at tile zoom stops. Keep both shaped buckets drawable across
    // their fractional switch, including on a restored or predicted sheet.
    const gate=wordZoomOpacity(id,chart.camera.z);
    if(Array.isArray(gate)){gate[2]||=transparent;gate[4]||=transparent;}
    map.setPaintProperty(id,'text-opacity',gate);
  }
  function tick(now){
    frame=0;
    // Updating paint attributes does not re-shape glyphs or upload a GeoJSON
    // source. Thirty updates per second suffice for this brief ink change.
    if(now-lastTick>=25){
      lastTick=now;
      if(leaving){
        const t=clamp((now-leaving.start)/fadeOut);
        for(const a of leaving.words)set(leaving.slot,a.id,a.from*(1-smooth(t)));
        if(t===1){clear(leaving.slot);leaving=null;}
      }
      if(entering){
        let done=true;
        for(const a of entering.words){
          const t=clamp((now-entering.start-a.delay)/fadeIn);
          set(entering.slot,a.id,a.from+(1-a.from)*smooth(t));if(t<1)done=false;
        }
        if(done)entering=null;
      }
    }
    if(leaving||entering)frame=requestAnimationFrame(tick);
  }
  const project=ll=>{const p=map.project(ll);return [p.x,p.y];};
  function exchange(oldSlot,old,slot,chart){
    if(frame)cancelAnimationFrame(frame);frame=0;
    if(leaving)clear(leaving.slot);
    leaving=null;entering=null;
    const still=chart?.camera.z>=streetZoom||reduced.matches;
    if(old&&(!chart||still))clear(oldSlot);
    if(!chart)return;
    editions.set(slot,chart);
    const now=performance.now();
    if(!old||still){for(const a of chart.anchors)set(slot,a.id,1);return;}
    const started=[],out=[],kept=new Set(),w=map.getCanvas().clientWidth,h=map.getCanvas().clientHeight;
    const previous=wordHistory(old.anchors,project);
    const visible=([x,y],a)=>x>=-a.s*String(a.t).length*.35&&x<=w+a.s*String(a.t).length*.35&&y>=-a.s*2&&y<=h+a.s*2;
    for(const a of chart.anchors){
      const p=project(a.ll);
      if(!visible(p,a)){set(slot,a.id,1);continue;}
      const match=previous(wordKeys(a.b,a.t,a.alias),p,a.s,a.e,a.b);
      const stationary=match&&Math.hypot(match.x-p[0],match.y-p[1])<=Math.max(4,Math.min(10,a.s*.45));
      if(stationary){
        kept.add(match.id);
        const from=levels.get(match.id)||0;
        set(oldSlot,match.id,0);
        set(slot,a.id,from);
        if(from<1)started.push({id:a.id,from,delay:0,carry:true});
      }else{
        set(slot,a.id,0);
        const secondary=/^(roadLabel|poi|house|housenumber|number)$/.test(a.b);
        started.push({id:a.id,from:0,delay:secondary?28:0,space:bounds(a,p),names:wordKeys(a.b,a.t,a.alias)});
      }
    }
    for(const a of old.anchors){
      if(kept.has(a.id))continue;
      const from=levels.get(a.id)||0;
      const p=project(a.ll);
      if(from>.01&&visible(p,a))out.push({id:a.id,from,space:bounds(a,p),names:wordKeys(a.b,a.t,a.alias)});
      else set(oldSlot,a.id,0);
    }
    if(out.length)leaving={slot:oldSlot,words:out,start:now};
    else clear(oldSlot);
    // Independent words can arrive while an old word elsewhere disappears.
    // Delay only an actual footprint conflict or a nearby displaced namesake.
    for(const a of started)if(!a.carry&&out.some(old=>intersects(a.space,old.space)||
      Math.abs(old.space.x-a.space.x)<145&&Math.abs(old.space.y-a.space.y)<95&&a.names.some(k=>old.names.includes(k))))a.delay+=fadeOut;
    if(started.length)entering={slot,words:started,start:now};
    if(leaving||entering)frame=requestAnimationFrame(tick);
  }
  function remaining(slot){
    return leaving?.slot===slot?Math.max(0,fadeOut-(performance.now()-leaving.start)):0;
  }
  return {prepare,forget,exchange,remaining,destroy(){if(frame)cancelAnimationFrame(frame);levels.clear();editions.clear();}};
}
