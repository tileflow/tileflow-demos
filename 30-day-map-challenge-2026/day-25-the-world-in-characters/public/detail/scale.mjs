import {streetZoom} from './street-scale.mjs?v=grounded-type-1';
import {captureCamera} from './projector.mjs?v=regional-reading-1';
import {hasPeninsula} from './peninsula-extent.mjs';
import {createWordHandoff,isWordLayer} from './word-handoff.mjs?v=grounded-type-1';
import {createGlyphPress} from './glyph-press.mjs?v=grounded-type-1';

const groups=['world','regional','local'];
const standby='atlas-reserve';
const modes={world:'world',regional:'regional atlas',local:'street atlas'};
const duration=()=>performance.now();
const reduced=matchMedia('(prefers-reduced-motion: reduce)');

export function attachScales(map,{home,onCreditSources,onStatus}){
  const layers=Object.fromEntries(groups.map(group=>[group,map.getStyle().layers.filter(l=>
    group==='world'?(l.id.startsWith('type-')||l.id.startsWith('world-reserve-')):l.source===group).map(l=>l.id)]));
  layers[standby]=map.getStyle().layers.filter(l=>l.source===standby).map(l=>l.id);
  let worker,workerRetry,workerFailures=0;
  const fronts={regional:null,local:null},cache=[];
  const slots={regional:null,local:null,[standby]:null},busySlots=new Set();
  const worldColors=Object.fromEntries(layers.world.map(id=>[id,map.getPaintProperty(id,'text-color')]));
  let activeSlot='world',waiting=[],loading=0,pressEnabled=false,inkChart=null;
  const press=createGlyphPress(map,()=>{
    // A GPU context may come back with fewer resources, especially on phones.
    // Restore the uncompressed typesetting path at the same camera.
    pressEnabled=false;state.glyphRenderer='native';cache.length=0;
    waiting=waiting.filter(chart=>!chart.press);currentExact=null;lastRequest=null;
    request(true,true);
  });
  const state={mode:modes.world,status:'ready',builds:0,tiles:null,sourceZoom:null,missing:null,marks:{},labels:[],
    center:[],zoom:map.getZoom(),weights:[1,0,0],stats:{requests:0,uploads:0,cacheHits:0,changes:0}};
  let active='world',desired='world',min=home().zoom,sequence=0,lastRequest,lastDispatch=-Infinity,timer,retry;
  let stopped=false,contextLost=false,waveStep=-1,wasMoving=false,settleTimer,serial=0,currentExact=null;
  let motionSample,lead,reserveTimer,reserveFor;
  let width=map.getCanvas().clientWidth,height=map.getCanvas().clientHeight;
  press.ready.then(enabled=>{
    pressEnabled=enabled;state.glyphRenderer=enabled?'instanced':'native';
  });
  const cam=()=>{
    const ll=map.getCenter();
    return {w:width,h:height,z:map.getZoom(),lon:ll.lng,lat:ll.lat,bearing:map.getBearing(),projection:map.getProjection().type};
  };
  function styleCamera(c){
    const cut=Math.max(1.27,min+.40,Math.min(2.82,min+.86));
    if(c.z<cut+(desired==='world'?.08:-.10))return 'world';
    return c.z<(desired==='local'?5.45:5.68)?'regional':'local';
  }
  let measuredCamera,measuredCharts=new Map();
  function metrics(chart,c){
    if(!chart||chart.camera.projection!==c.projection||Math.abs(chart.camera.bearing-c.bearing)>4)return {area:0,dz:99,pan:Infinity};
    if(measuredCamera!==c){measuredCamera=c;measuredCharts.clear();}
    if(measuredCharts.has(chart))return measuredCharts.get(chart);
    const ref=chart.camera,scale=2**(c.z-ref.z),p=map.project([ref.lon,ref.lat]);
    const hx=(ref.w/2+ref.pad)*scale,hy=(ref.h/2+ref.pad)*scale;
    const vw=Math.max(0,Math.min(c.w,p.x+hx)-Math.max(0,p.x-hx));
    const vh=Math.max(0,Math.min(c.h,p.y+hy)-Math.max(0,p.y-hy));
    const edge=Math.min(hx-p.x,hx+p.x-c.w,hy-p.y,hy+p.y-c.h);
    const result={area:vw*vh/(c.w*c.h),edge,dz:Math.abs(c.z-ref.z),pan:Math.hypot(p.x-c.w/2,p.y-c.h/2)};
    measuredCharts.set(chart,result);return result;
  }
  function score(chart,c){
    if(!chart)return -Infinity;
    const m=metrics(chart,c);
    if(m.area<.11)return -Infinity;
    const visible=slots[activeSlot],leadZoom=chart.camera.leadZoom;
    if(chart.reserve&&leadZoom>0&&(c.z<chart.camera.z-leadZoom+.32||m.area<.82))return -Infinity;
    if(chart.group==='local'&&desired==='regional'&&leadZoom>0)return -Infinity;
    // During a pan, an old sheet for the same scale can have different label
    // anchors. Keep the current placement until new ink or new coverage is needed.
    if(visible?.quality==='exact'&&chart.stamp<visible.stamp&&chart.group===visible.group&&chart.info?.sheet===visible.info?.sheet&&
      m.dz<.12&&Math.abs(visible.camera.z-c.z)<.12&&metrics(visible,c).area>=.75)return -Infinity;
    if(leadZoom&&visible&&visible!==chart){
      const ahead=(chart.camera.z-c.z)*Math.sign(leadZoom);
      if(ahead>.24&&Math.abs(visible.camera.z-c.z)<ahead+.18&&metrics(visible,c).area>.62)return -Infinity;
    }
    return m.area*3.6-Math.min(7,m.dz)*.85+(chart.group===desired?.82:0)+(chart.quality==='exact'?.13:0);
  }
  function closeTo(ref,c,delta=.16,fraction=.09){
    if(!ref||ref.w!==c.w||ref.h!==c.h||ref.projection!==c.projection||Math.abs(ref.bearing-c.bearing)>1||Math.abs(ref.z-c.z)>delta)return false;
    const p=map.project([ref.lon,ref.lat]);return Math.hypot(p.x-c.w/2,p.y-c.h/2)<Math.min(ref.w,ref.h)*fraction;
  }
  // The camera continuously transforms the existing survey. Its
  // composing zoom describes the ink on paper, not a required camera stop.
  function fitsPrintedView(chart,c){
    if(chart?.quality!=='exact'||chart.group!==desired||chart.info?.missing||
       chart.camera.w!==c.w||chart.camera.h!==c.h||
       Math.abs(chart.camera.bearing-c.bearing)>.5||Boolean(chart.press)!==pressEnabled)return false;
    const street=c.z>=streetZoom;
    if(street!==(chart.camera.z>=streetZoom))return false;
    if(c.z===map.getMaxZoom()&&Math.abs(chart.camera.z-c.z)>.012)return false;
    const footprint=metrics(chart,c);
    return footprint.dz<=(street?.40:.21)&&footprint.edge>=8;
  }
  // An atlas edition is already geographically registered to the moving
  // camera. Change it mid-gesture only when it buys coverage or readable
  // detail. A completed worker job alone is not a reason to reprint the map.
  function improvesMovingView(next,current,c){
    if(!current||next===current||!wasMoving&&!map.isMoving())return true;
    const shown=metrics(current,c),incoming=metrics(next,c);
    if(shown.area<.975&&incoming.area>shown.area+.025)return true;
    if(current.group!==desired&&next.group===desired&&incoming.area>=.88)return true;
    if(current.quality!=='exact'&&next.quality==='exact'&&incoming.area>=.92&&incoming.dz<=shown.dz+.15)return true;
    if(shown.area>=.88&&shown.dz<.54)return false;
    return incoming.dz+.19<shown.dz&&incoming.area>=Math.min(.88,shown.area-.035);
  }
  const words=createWordHandoff(map,reduced);
  const worldCredits=['natural','etopo'];
  const sourceOrder=[...worldCredits,'tileflow','osm','madrid','ign'];
  let activeCredits='',announcedCredits=[],creditTimer;
  function announceCredits(sources){
    if(sources.join()===announcedCredits.join())return;
    announcedCredits=sources;
    onCreditSources(sources);
  }
  function updateCredits(fade=0){
    const wordsSources=activeSlot==='world'?worldCredits:slots[activeSlot]?.creditSources||[];
    const inkSources=pressEnabled&&inkChart?.press?.count?inkChart.creditSources:[];
    const next=sourceOrder.filter(key=>wordsSources.includes(key)||inkSources.includes(key));
    const key=next.join();
    if(key===activeCredits)return;
    activeCredits=key;clearTimeout(creditTimer);
    if(fade>0&&announcedCredits.some(name=>!next.includes(name))){
      // Both editions can contribute while type fades and the GPU finishes
      // its queued handoff. Keep their credits through that brief interval.
      announceCredits(sourceOrder.filter(key=>announcedCredits.includes(key)||next.includes(key)));
      creditTimer=setTimeout(()=>announceCredits(next),fade);
    }else announceCredits(next);
  }
  function setLayerInk(slot,visible){
    for(const id of layers[slot]){
      if(slot==='world')map.setPaintProperty(id,'text-color',visible?worldColors[id]:'rgba(0,0,0,0)');
      else if(!isWordLayer(id))map.setPaintProperty(id,'text-opacity',visible?1:0);
    }
  }
  function selectInk(chart,c,preview=false,wordFade=0){
    if(chart===inkChart)return;
    if(chart&&inkChart&&wasMoving){
      const drawn=metrics(inkChart,c),incoming=metrics(chart,c);
      if(incoming.area+.06<drawn.area&&incoming.area<.94)return;
      if(preview&&(drawn.area>=.95||incoming.area<Math.min(.98,drawn.area+.06)))return;
    }else if(preview)return;
    const cross=pressEnabled&&inkChart?.press?.count&&chart?.press?.count&&!reduced.matches&&chart.camera.z<streetZoom;
    inkChart=chart;
    press.show(chart);
    updateCredits(Math.max(wordFade,cross?270:0));
  }
  function describe(chart){
    if(!chart)return;
    if(chart.group==='regional'){state.regionalMarks=chart.marks;state.tiles=null;state.sourceZoom=null;state.missing=null;}
    else Object.assign(state,chart.info);
    state.sheet=chart.info?.sheet||chart.group;state.marks=chart.marks;state.labels=chart.labels;state.gpuMarks=chart.press?.count||0;state.chartZoom=chart.camera.z;state.quality=chart.quality;state.held=chart.held;

  }
  let worldRepaintPending=false,worldZoomLimit=3.4;
  const normalWorldLimit=()=>Math.min(6,Math.max(3.4,min+.65));
  function capWorldTiles(limit) {
    if(limit===worldZoomLimit)return;
    worldZoomLimit=limit;
    for(const id of layers.world){
      if(id.startsWith('type-'))map.setLayerZoomRange(id,undefined,limit);
      else map.setLayerZoomRange(id,limit,6);
    }
  }
  capWorldTiles(normalWorldLimit());
  function settleWorldInk(){
    if(worldRepaintPending)return;
    worldRepaintPending=true;
    // The last symbol-placement frame after a large zoom-out can retain the
    // outgoing tile glyphs even after the geographic sources report loaded.
    map.once('idle',()=>{
      worldRepaintPending=false;
      if(!stopped && activeSlot==='world' && desired==='world')map.triggerRepaint();
    });
  }
  function show(group){
    const slot=group==='world'?'world':fronts[group]?.slot;
    if(!slot||busySlots.has(slot))return;
    const retired=activeSlot;
    if(slot!==activeSlot){
      setLayerInk(retired,false);setLayerInk(slot,true);words.exchange(retired,slots[retired],slot,slots[slot]);activeSlot=slot;active=group;state.slot=slot;
      // The atlas's native words ignore SDK collision placement. The retired
      // source can stay ready, fully transparent, for an immediate reversal.
      if(slots[retired])remember(slots[retired]);
      state.stats.changes++;waveStep=-1;
    }
    const fade=words.remaining(retired);
    selectInk(slots[slot]||null,cam(),false,fade);
    state.mode=modes[group];state.weights=groups.map(g=>Number(g===group));
    updateCredits(fade);
    if(group==='world'){
      settleWorldInk();
      state.sheet='world';state.chartZoom=min;state.quality='original';state.gpuMarks=0;state.tiles=null;state.missing=null;state.sourceZoom=null;
    }else describe(fronts[group]);
  }
  function remember(chart){
    if(chart.quality!=='exact'||cache.includes(chart))return;
    const same=cache.findIndex(k=>k.group===chart.group&&Math.abs(k.camera.z-chart.camera.z)<.055&&Math.abs(k.camera.lat-chart.camera.lat)<1e-7&&Math.abs(k.camera.lon-chart.camera.lon)<1e-7);
    if(same>=0)cache.splice(same,1);
    cache.unshift(chart);
    if(cache.length>12)cache.pop();
  }
  function reconsider(c,canRestore){
    if(desired==='world'){show('world');return;}
    if(fitsPrintedView(slots[activeSlot],c))return;
    let best=null,rank=-Infinity;
    for(const [slot,item] of Object.entries(slots)){
      if(!item||busySlots.has(slot)||!pressEnabled&&item.press||!improvesMovingView(item,slots[activeSlot],c))continue;
      const s=score(item,c);
      if(s>rank){rank=s;best=item;}
    }
    const displayed=slots[activeSlot];
    if(best&&best===displayed)fronts[best.group]=displayed;
    else if(best&&(active==='world'||rank>score(displayed,c)+.18)){
      fronts[best.group]=best;show(best.group);
    }
    // A reverse gesture can use a previously composed sheet immediately. The
    // footprint matters as much as the zoom number when the pointer is off centre.
    if(!canRestore)return;
    let cached=null,cacheScore=rank;
    for(const item of cache){
      if(Object.values(slots).includes(item)||loading||waiting.length||!improvesMovingView(item,displayed,c))continue;
      const s=score(item,c);
      if(s>cacheScore+.42){cached=item;cacheScore=s;}
    }
    if(cached){state.stats.cacheHits++;upload(cached,true);}
  }
  function ready(chart,c,settled=!wasMoving&&!map.isMoving()){
    if(chart.slot!==activeSlot||slots[activeSlot]!==chart||chart.group!==desired||chart.quality!=='exact'||
      !fitsPrintedView(chart,c)&&!closeTo(chart.camera,c,settled?.012:.20,settled?.006:.10))return false;
    currentExact=chart;state.status=chart.info?.missing?'partial':'ready';onStatus('');
    const reserveStep=chart.group==='local'?Math.min(.94,map.getMaxZoom()-c.z):c.z>=3.7?-.88:0;
    const wideStep=chart.group==='local'&&c.z>=7.15&&!navigator.connection?.saveData?-1.35:0;
    if(settled&&chart.press&&!chart.info?.missing&&(Math.abs(reserveStep)>.34||wideStep)&&!reserveTimer&&reserveFor!==chart){
      reserveTimer=setTimeout(()=>{
        reserveTimer=null;
        if(stopped||contextLost||!worker||loading||wasMoving||map.isMoving()||slots[activeSlot]!==chart||desired!==chart.group)return;
        const current=cam();
        reserveFor=chart;
        for(const step of [reserveStep,wideStep]){
          if(Math.abs(step)<.34||Object.values(slots).some(item=>item&&item.group===chart.group&&closeTo(item.camera,{...current,z:current.z+step},.16,.05)))continue;
          worker.postMessage({type:'reserve',id:sequence,group:chart.group,camera:captureCamera(map,current,{x:0,y:0,z:step}),
            sheet:chart.info?.sheet||chart.group,priorLabels:chart.anchors,priorCamera:chart.camera});
        }
      },80);
    }
    return true;
  }
  function waitForPlacement(slot,chart){
    // setData resolves after indexing. Tile parsing, glyph placement and upload
    // can still be in progress. A generation is ready only when its symbols are
    // present in the native renderer for this camera, on a different surface.
    return new Promise(resolve=>{
      const deadline=duration()+1600;
      function finish(value){clearTimeout(timeout);map.off('render',check);resolve(value);}
      function check(){
        if(stopped||contextLost||!map.getProjection()?.type||desired==='world'){finish(false);return;}
        if(chart.reserve&&chart.id!==sequence){finish(false);return;}
        if(duration()>deadline){
          finish(Boolean(chart.press?.count&&map.isSourceLoaded(slot)&&metrics(chart,cam()).area>=.70));return;
        }
        if(!map.isSourceLoaded(slot))return;
        const c=cam();
        if(metrics(chart,c).area<.16){finish(false);return;}
        const options={layers:layers[slot],filter:['==',['get','edition'],chart.stamp]};
        for(const ll of chart.probes){
          const p=map.project(ll);
          if(p.x<0||p.y<0||p.x>c.w||p.y>c.h)continue;
          if(map.queryRenderedFeatures([[p.x-6,p.y-6],[p.x+6,p.y+6]],options).length){finish(true);return;}
        }
        if(map.queryRenderedFeatures(options).length)finish(true);
      }
      const timeout=setTimeout(()=>finish(false),1700);
      map.on('render',check);map.triggerRepaint();
    });
  }
  function upload(chart,restored=false){
    if(desired==='world')return;
    // One native symbol placement can take several frames after its source is
    // loaded. A later inward waypoint can use the other hidden surface now.
    const parallel=loading===1&&chart.group==='local'&&chart.press&&chart.camera.leadZoom>.12&&
      Object.keys(slots).some(s=>s!==activeSlot&&!busySlots.has(s));
    if(loading&&!parallel){
      waiting=waiting.filter(item=>item.group!==chart.group||item.id>chart.id);
      if(!waiting.some(item=>item.group===chart.group&&item.id>chart.id))waiting.push(chart);
      return;
    }
    loading++;
    stage(chart,restored,parallel).catch(error=>{state.lastError=String(error);}).finally(()=>{
      loading--;
      if(waiting.length&&!stopped){
        waiting.sort((a,b)=>b.id-a.id||Number(b.quality==='exact')-Number(a.quality==='exact'));
        const next=waiting.shift();upload(next);
      }
    });
  }
  async function stage(chart,restored,parallel=false){
    if(contextLost||!map.getProjection()?.type)return;
    const g=chart.group,c=cam();
    if(desired==='world'||stopped||chart.press&&!pressEnabled)return;
    if(!chart.reserve&&chart.quality!=='exact'&&currentExact&&ready(currentExact,c))return;
    if(!restored&&chart.id!==sequence&&(metrics(chart,c).area<.70||score(chart,c)<score(fronts[g],c)))return;
    let slot=Object.keys(slots).find(s=>slots[s]===chart);
    if(!slot){
      const wideReserve=chart.reserve&&g==='local'&&chart.camera.leadZoom<0;
      const nativeSlots=chart.reserve&&!wideReserve?[standby]:[g,g==='local'?'regional':'local'];
      if(parallel)nativeSlots.push(standby);
      const free=nativeSlots.filter(s=>s!==activeSlot&&!busySlots.has(s));
      slot=free.find(s=>!words.remaining(s))??free[0];
      if(!slot)return;
      if(slot===standby&&!chart.reserve){
        // The compact surface is a waypoint. At a clamped zoom (especially
        // z20) the final camera can coincide exactly with this prediction.
        if(chart.quality==='exact'&&chart.id===sequence&&lastRequest){
          lastRequest.compactOnly=true;
          if(!wasMoving&&!map.isMoving())end();
        }
        chart={...chart,quality:'navigation'};
      }
      busySlots.add(slot);
      const remaining=words.remaining(slot);
      if(remaining&&!(lead?.z<-.12)&&metrics(slots[activeSlot],c).area>=.97){
        await new Promise(done=>setTimeout(done,remaining));
        if(stopped||contextLost){busySlots.delete(slot);return;}
      }
      for(const key of ['regional','local'])if(fronts[key]?.slot===slot)fronts[key]=null;
      words.forget(slot);slots[slot]=null;
      try{
        // A nonzero sub-quantisation uniform permits glyph placement but cannot
        // change a pixel in an 8-bit framebuffer. The old sheet remains fully drawn.
        for(const id of layers[slot]){
          if(isWordLayer(id))words.prepare(slot,chart,id);
          else map.setPaintProperty(id,'text-opacity',1e-8);
        }
        if(!chart.press&&slot!==standby&&chart.camera.z>=streetZoom)map.setPaintProperty(slot+'-sea','text-translate',[0,0]);
        await map.getSource(slot).setData(chart.fc);
        // A complete empty viewport is also a valid plate, for example bare
        // terrain. A font query can never return a feature in such a view.
        const noNative=chart.fc.features.length===0||chart.press?.count&&!chart.nativeInView;
        const placed=noNative&&(chart.press?.count||chart.quality==='exact'&&!chart.info?.missing)||await waitForPlacement(slot,chart);
        if(!placed){if(!chart.reserve&&chart.id===sequence&&desired===g){lastRequest=null;end();}return;}
        slots[slot]=chart;chart.slot=slot;state.stats.uploads++;
      }finally{busySlots.delete(slot);}
    }
    if(stopped||chart.press&&!pressEnabled)return;
    if(contextLost||!map.getProjection()?.type)return;
    if(chart.reserve)return;
    const now=cam();remember(chart);
    // A waypoint can finish after a new gesture. Never promote its geometry
    // solely because its asynchronous job finished last.
    if(desired==='world'||metrics(chart,now).area<.20)return;
    if(slots[activeSlot]!==chart&&fitsPrintedView(slots[activeSlot],now))return;
    if(chart.quality!=='exact'&&currentExact&&ready(currentExact,now))return;
    fronts[g]=chart;
    if(g==='local'&&chart.quality==='exact')state.builds++;
    if(chart.id===sequence&&chart.quality==='exact'&&g===desired&&closeTo(chart.camera,now,.24,.12)&&improvesMovingView(chart,slots[activeSlot],now))show(g);
    else reconsider(now,false);
    if(activeSlot===slot)describe(chart);
    if(ready(chart,now)&&chart.info?.missing)retry=setTimeout(()=>request(true,true),2600);
  }
  function receive({data}){
    if(stopped)return;
    if(data.type==='warning'){console.warn(data.message);return;}
    if(data.type==='error'){
      if(data.id!==sequence)return;
      state.status='error';state.lastError=data.message;onStatus('Street data could not be loaded. Reconnecting…');
      clearTimeout(retry);retry=setTimeout(()=>request(true,true),2800);return;
    }
    if(data.type==='chart'){
      workerFailures=0;
      // A wider GPU survey can fill newly exposed ground as soon as its
      // characters arrive. The independent native word layout can finish in
      // the following frames without holding up roads and water at the edge.
      if(pressEnabled&&data.press?.count&&desired===data.group&&inkChart&&lead?.z<-.12&&!fitsPrintedView(inkChart,cam())){
        selectInk(data,cam(),true);
      }
      if(data.reserve){
        if(data.id===sequence&&!wasMoving&&!map.isMoving()&&desired===data.group)stage(data,false).catch(()=>{});
        return;
      }
      data.serial=++serial;upload(data);
    }
  }
  function startWorker(){
    if(stopped)return;
    try{
      const next=new Worker(new URL('./compositor-worker.mjs?v=source-credits-1',import.meta.url),{type:'module',name:'Atlas typesetter'});
      worker=next;
      next.onmessage=e=>{if(worker===next)receive(e);};
      next.onerror=e=>{if(worker===next)recoverWorker(e);};
      const initial=cam();
      next.postMessage({type:'warm',stampBase:sequence*16,camera:initial.z<=6?captureCamera(map,initial):null});
    }catch(error){recoverWorker(error);}
  }
  function recoverWorker(error){
    worker?.terminate();worker=null;clearTimeout(workerRetry);
    state.lastError=error.message||'Unable to start the atlas typesetter';
    lastRequest=null;
    if(++workerFailures>3){state.status='error';onStatus('The map could not finish typesetting this view.');return;}
    state.status='composing';
    workerRetry=setTimeout(()=>{startWorker();if(worker)request(true,true);},180*2**(workerFailures-1));
  }
  function request(settled,force=false){
    clearTimeout(timer);timer=0;if(stopped||contextLost||!map.getProjection()?.type)return;
    const c=cam();desired=styleCamera(c);state.zoom=c.z;state.center=[c.lon,c.lat];
    if(desired==='world'){
      if(lastRequest){worker?.postMessage({type:'cancel',id:++sequence});lastRequest=null;}
      show('world');state.status='ready';onStatus('');return;
    }
    if(!worker)return;
    const printed=slots[activeSlot];
    if(!force&&fitsPrintedView(printed,c)){
      if(inkChart!==printed)selectInk(printed,c);
      ready(printed,c,settled);
      return;
    }
    if(settled&&!force){
      const placed=Object.entries(slots).find(([slot,chart])=>!busySlots.has(slot)&&chart?.quality==='exact'&&chart.group===desired&&
        !chart.info?.missing&&(!chart.press||pressEnabled)&&closeTo(chart.camera,c,.012,.006));
      if(placed){const [,chart]=placed;fronts[desired]=chart;show(desired);ready(chart,c,true);return;}
    }
    const targetGroup=!settled&&lead?.z>0?styleCamera({...c,z:c.z+lead.z}):desired;
    const front=fronts[targetGroup];
    const coversLead=ref=>settled||!lead||Math.abs(ref.z-c.z-lead.z)<.29&&Math.hypot(lead.x,lead.y)<ref.pad*.85;
    if(!force&&front&&coversLead(front.camera)&&ready(front,c,settled))return;
    // A trailing event must not restart an unchanged in-flight network read.
    if(!force&&lastRequest?.group===targetGroup&&!(settled&&lastRequest.compactOnly)&&coversLead(lastRequest.camera)&&closeTo(lastRequest.camera,c,settled?.012:lead?.30:.64,settled?.006:lead?.12:.19))return;
    clearTimeout(retry);onStatus('');currentExact=null;
    const camera=captureCamera(map,c,!settled?lead:null);
    const shown=slots[activeSlot],coverage=metrics(shown,c);
    const retreating=lead?.z<-.16;
    const fallback=active==='world'||coverage.dz>(retreating?.40:.76)||coverage.area<(retreating?.96:.83)||lead?.z>0&&camera.z-shown.camera.z>1.05;
    const id=++sequence;
    state.status='composing';state.stats.requests++;lastDispatch=duration();lastRequest={camera,group:targetGroup};
    const prior=slots[activeSlot];
    worker.postMessage({type:'compose',id,camera,group:targetGroup,settled,fallback,press:pressEnabled,undercovered:coverage.area<.65,
      priorLabels:prior?.anchors||[],priorCamera:prior?.camera,priorSheet:prior?.info?.sheet});
  }
  // Estimate one composition ahead from actual camera movement (CSS pixels per
  // millisecond). Keep all touch input in the SDK. The extra sheet margin covers
  // both the current centre and the short lead during one-finger inertia.
  function sampleMotion(c){
    const t=duration(),prev=motionSample;
    if(prev&&t-prev.t<5)return;
    motionSample={t,c};
    if(!prev||t-prev.t>135||Math.abs(prev.c.bearing-c.bearing)>3){lead=null;return;}
    const dt=t-prev.t,prevCenter=map.project([prev.c.lon,prev.c.lat]),ahead=Math.min(12,85/dt);
    const bound=(v,cap)=>Math.min(cap,Math.max(-cap,v));
    const x=bound((c.w/2-prevCenter.x)*ahead,Math.min(155,c.w*.20));
    const y=bound((c.h/2-prevCenter.y)*ahead,Math.min(155,c.h*.20));
    // On the way out the next edition must cover ground outside the current
    // sheet. Estimate the footprint during parsing and GPU handoff as well.
    const retreat=c.z<prev.c.z;
    let z=bound((c.z-prev.c.z)*(retreat?Math.min(18,155/dt):ahead),retreat?.98:.72);
    z=Math.min(map.getMaxZoom()-c.z,Math.max(map.getMinZoom()-c.z,z));
    // An inward gesture can start reading the street atlas just before the
    // regional cut. Its lettering stays hidden until the camera crosses it.
    const nextGroup=styleCamera({...c,z:c.z+z});
    if(nextGroup!==desired&&!(desired==='regional'&&nextGroup==='local'&&z>0))z=0;
    lead=(Math.abs(z)>.13||Math.hypot(x,y)>Math.min(c.w,c.h)*.075)?{x,y,z}:null;
  }
  function moving(){
    if(contextLost||!map.getProjection()?.type)return;
    const c=cam(),before=desired;desired=styleCamera(c);state.zoom=c.z;state.center=[c.lon,c.lat];
    const first=!wasMoving,previousLead=lead;
    wasMoving=true;sampleMotion(c);clearTimeout(settleTimer);
    reconsider(c,before!==desired||first||duration()-lastDispatch>80);
    if(desired==='world'){if(lastRequest)request(false);return;}
    const since=duration()-lastDispatch;
    const zoomingIn=lead?.z>.24,startedApproaching=zoomingIn&&!(previousLead?.z>.24);
    const coverage=metrics(slots[activeSlot],c);
    const interval=coverage.area<.87||lead?.z<-.12?78:lead?125:200;
    if(before!==desired||since>=interval||startedApproaching&&since>=24)request(false);
    else if(!timer)timer=setTimeout(()=>request(false),interval-since);
  }
  function end(){
    wasMoving=false;motionSample=lead=null;clearTimeout(settleTimer);
    settleTimer=setTimeout(()=>request(true),4);
  }
  function resize(){
    width=map.getCanvas().clientWidth;height=map.getCanvas().clientHeight;min=home().zoom;capWorldTiles(normalWorldLimit());end();
  }
  function loseContext(){contextLost=true;clearTimeout(timer);clearTimeout(settleTimer);clearTimeout(retry);}
  function recoverContext(){
    contextLost=false;lastRequest=null;currentExact=null;
    const reload=()=>{if(!stopped)request(true,true);};
    if(map.getProjection()?.type&&map.isStyleLoaded())reload();else map.once('style.load',reload);
  }
  map.on('webglcontextlost',loseContext);map.on('webglcontextrestored',recoverContext);
  map.on('move',moving);map.on('moveend',end);map.on('resize',resize);
  startWorker();
  if(styleCamera(cam())==='world')request(true);
  else Promise.race([press.ready,new Promise(resolve=>setTimeout(resolve,75))]).then(()=>request(true));
  return {state,awaitsPeninsula(){
    const c=cam();return styleCamera(c)==='regional'&&hasPeninsula(captureCamera(map,c));
  },get worldWeight(){return Number(active==='world');},viewDesign(){reconsider(cam(),false);},projectionChanged(){
    clearTimeout(timer);currentExact=null;lastRequest=null;desired=styleCamera(cam());timer=setTimeout(()=>request(true,true),0);
  },tick(seconds){
    if(contextLost||!map.getProjection()?.type||active==='world'||map.isMoving()||map.getZoom()>=streetZoom)return;
    if(pressEnabled)press.tick(seconds);
    const step=Math.floor(seconds*4)%8;if(step===waveStep)return;waveStep=step;
    const a=seconds*Math.PI/6,g=activeSlot;
    if(g===standby)return;
    if(!slots[g]?.press)map.setPaintProperty(g+'-sea','text-translate',[Math.sin(a)*1.6,Math.cos(a)*.65]);
  },destroy(){stopped=true;clearTimeout(creditTimer);words.destroy();clearTimeout(settleTimer);clearTimeout(timer);clearTimeout(retry);clearTimeout(workerRetry);clearTimeout(reserveTimer);worker?.terminate();press?.destroy();map.off('webglcontextlost',loseContext);map.off('webglcontextrestored',recoverContext);map.off('move',moving);map.off('moveend',end);map.off('resize',resize);}};
}
