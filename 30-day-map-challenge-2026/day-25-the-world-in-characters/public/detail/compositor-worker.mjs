// Map projection, collision placement, terrain synthesis and view caching stay off the input thread.
import {borderBounds} from './iberia-border-rings.mjs?v=regional-20261125b';
import {regionalWeight} from './metropolitan.mjs?v=continuous-zoom-1';
import {regionalAreas} from './regional-administration.mjs?v=regional-20261125b';
import {cameraContext} from './projector.mjs?v=regional-reading-1';
import {loadRegion,regionGlyphs} from './regional.mjs?v=regional-reading-1';
import {terrainFor} from './terrain.mjs?v=regional-20261125b';
import {createDetailSource} from './source.mjs?v=continuous-zoom-1';
import {viewport} from './cover.mjs';
import {wordRoom,fitWordRoom} from './word-room.mjs?v=continuous-zoom-1';
import {closeWordScale} from './word-optics.mjs';
import {typesetDetail} from './typeset.mjs?v=regional-reading-1';
import {hasMadridNavigation,madridNavigation} from './madrid-navigation.mjs?v=approach-1';

let pack,latest=0,nextStamp=0,controller,reader,priorLabels=[],priorCamera,priorSheet;
const lineSigns=new Set(['~','–','-','═','━']);
const wordRoles=new Set(['waterLabel','roadLabel','poi','house','settlement','number','housenumber','place','landmark','regionLabel']);
const detail=()=>reader??=createDetailSource();
let navModule,cityModule,streetContext;
import {hasPeninsula} from './peninsula-extent.mjs';
import {loadPeninsula,residentPeninsula,peninsulaGlyphs} from './peninsula.mjs?v=regional-reading-1';
async function regional(camera,id,asNavigation,current=()=>true,relief){
  const ctx=cameraContext(camera);
  // When zooming into Iberia the regional sheet already contains the surveyed
  // network. Retypeset it while street tiles load at the other side of the cut.
  const enteringPeninsula=asNavigation&&priorSheet==='peninsula'&&priorCamera&&camera.z>priorCamera.z&&camera.z<=7.45&&hasPeninsula({...camera,z:6});
  if(hasPeninsula(camera)||enteringPeninsula){
    const sheet=await loadPeninsula(camera).catch(()=>null);
    if(id!==latest||!current())return;
    if(sheet){
      const t=performance.now(),fc=peninsulaGlyphs(sheet,ctx,priorLabels,priorCamera,priorSheet);
      send(id,camera,'regional',fc,asNavigation?'navigation':'exact',{sheet:'peninsula',composeMs:Math.round(performance.now()-t)});
      return;
    }
  }
  const data=await loadRegion();
  if(id!==latest||!current())return;
  let fc,creditSources=atlasSources;
  if(asNavigation){
    navModule??=import('./navigation.mjs?v=regional-reading-1');
    const navigation=await navModule;
    if(id!==latest)return;
    // At street approach scales the relief is optional. The navigation
    // composer can finish before its elevation blocks have arrived.
    let drewTerrain=false;
    const terrain=relief?.then(draw=>draw&&(args=>{drewTerrain=true;return draw(args);}));
    fc=await navigation.navigationRegion(data,ctx,terrain);
    if(ctx.zoom>=8&&!drewTerrain)creditSources=['natural'];
  }else fc=regionGlyphs(data,ctx);
  if(id===latest&&current())send(id,camera,'regional',fc,asNavigation?'navigation':'exact',{},false,creditSources);
}
const atlasSources=['natural','etopo'];
function localSources(ctx,features,municipal,terrain,districts,areas){
  const sources=municipal?['osm']:['tileflow','osm'];
  if(terrain)sources.push('etopo');
  if(districts?.length)sources.push('madrid');
  if(areas?.length)sources.push('ign');
  // The regional street compositor consults Natural Earth's country rings
  // for the frontier and its summit index when selecting named peaks.
  const z=ctx.zoom,[w,s,e,n]=ctx.bounds,[west,south,east,north]=borderBounds;
  const frontier=z>=6.85&&z<8.55&&w<=east+.16&&e>=west-.16&&s<=north+.16&&n>=south-.16;
  if(regionalWeight(z)>.12&&(frontier||features.some(f=>f.properties?._layer==='natural_label'&&['peak','mountain','volcano','mountain_peak'].includes(f.properties.class))))sources.push('natural');
  return sources;
}
function send(id,camera,group,fc,quality,info={},reserve=false,creditSources=atlasSources){
  const marks={},labels=[],anchors=[],stamp=++nextStamp;
  let nextWord=0;
  const incoming=[],sample=new Array(9),ctx=cameraContext(camera);
  const room=wordRoom(fc.features,wordRoles,ctx.project);
  // Preserve the printed size of the settled edition. A retained edition must
  // then shrink at exactly the rate its geographic anchors approach each other.
  const z=camera.z,lower=Math.floor(z),fraction=z-lower;
  const printStop=d=>Math.min(1.15,1.06**d,1.5*2**d);
  const inkAtRest=printStop(-fraction)+(printStop(1-fraction)-printStop(-fraction))*Math.expm1(fraction*Math.log(1.06))/.06;
  const upperScale=Math.max(1.15,2**(Math.ceil(z)-z));
  const closeScale=closeWordScale(z,upperScale),terrainScale=closeWordScale(z,2.25);
  // Keep the upper integer endpoint intact, so native point textures retain
  // exactly their printed and shrinking sizes at every fractional chart zoom.
  const pointCeiling=Math.max(1.28,2**(Math.ceil(z)-z));
  for(const f of fc.features){
    const p=f.properties,n=f.geometry.type==='MultiPoint'?f.geometry.coordinates.length:1;
    p.optical=p.s*2**(-camera.z);
    p.ink=p.c+Math.round(Math.max(0,Math.min(1,p.a))*255).toString(16).padStart(2,'0');
    p.edition=stamp;
    marks[p.b]=(marks[p.b]||0)+n;
    if(labels.length<70&&String(p.t).length>1)labels.push(p.t);
    // Pick cheap screen-local probes instead of materialising every native
    // symbol in the viewport just to confirm that a new edition is drawable.
    const coords=f.geometry.coordinates;
    for(const k of [0,Math.floor(coords.length*.5)])if(coords[k]){
      const ll=coords[k],[px,py]=ctx.project(ll),x=(px-camera.pad)/camera.w,y=(py-camera.pad)/camera.h;
      if(x<.06||x>.94||y<.06||y>.94)continue;
      const bx=Math.floor(x*3),by=Math.floor(y*3),key=by*3+bx;
      const d=(x-(bx+.5)/3)**2+(y-(by+.5)/3)**2;
      if(!sample[key]||d<sample[key].d)sample[key]={ll,d};
    }
    if(!wordRoles.has(p.b)&&p.b!=='terrainName'){
      if(!pack&&(p.b==='water'||!lineSigns.has(p.t)))p.markCeiling=p.s*pointCeiling;
      continue;
    }
    if(p.b==='terrainName')p.closeSize=p.s*terrainScale;
    else {
      p.wordOptical=p.optical*inkAtRest;
      p.wordCeiling=p.s*inkAtRest*upperScale;
      p.closeSize=p.s*inkAtRest*closeScale;
      const safe=room.get(f);
      if(safe>1.06){
        const {scale,ceiling}=fitWordRoom(z,safe);
        p.wordOptical*=scale;
        p.wordCeiling=p.s*inkAtRest*ceiling;
        p.closeSize=p.s*inkAtRest*scale*closeWordScale(z,ceiling/scale);
      }
    }
    const locations=f.geometry.coordinates;
    for(let index=0;index<locations.length;index++){
      const ll=locations[index],id=stamp*65536+nextWord++;
      if(index===0){f.id=id;f.geometry.coordinates=[ll];}
      else incoming.push({type:'Feature',id,properties:p,geometry:{type:'MultiPoint',coordinates:[ll]}});
      anchors.push({id,b:p.b,t:String(p.t),e:p.e,s:p.s,c:p.c,ll,station:p.station,route:p.route,alias:p.alias});
    }
  }
  fc.features.push(...incoming);
  const press=pack?pack(fc,camera):null;
  // Overscan keeps panning seamless. A legitimate street chart can contain
  // many visible dashes but have every place name outside the screen.
  const margin=camera.pad;
  const nativeInView=!press?.count||fc.features.some(f=>{
    const r=Math.max(8,String(f.properties.t).length*f.properties.s*.62);
    return f.geometry.coordinates.some(ll=>{
      const [x,y]=ctx.project(ll);return x>=margin-r&&x<=margin+camera.w+r&&y>=margin-r&&y<=margin+camera.h+r;
    });
  });
  const probes=press?.count?fc.features.flatMap(f=>f.geometry.coordinates.slice(0,1)).slice(0,16):[4,1,7,3,5,0,8,2,6].flatMap(i=>sample[i]?[sample[i].ll]:[]);
  self.postMessage({type:'chart',id,stamp,press,nativeInView,camera,group,fc,quality,info,creditSources,marks,labels,anchors,probes,reserve,held:fc.meta?.anchors,madrid:fc.meta?.madridBoundaryMarks||0,ign:fc.meta?.ignAreas||0},press?[press.data.buffer]:[]);
}
async function run(msg){
  const {id,camera,group,settled,fallback}=msg;
  latest=id;priorLabels=msg.priorLabels||[];priorCamera=msg.priorCamera;priorSheet=msg.priorSheet;controller?.abort();controller=new AbortController();
  if(group==='world')return;
  const signal=controller.signal;
  pack=msg.press?(await import('./glyph-pack.mjs?v=regional-reading-1')).packGlyphs:null;
  if(id!==latest)return;
  if(group==='regional'){
    if(camera.z>=4.4)detail().warmCatalog().catch(()=>{});
    await regional(camera,id,false);return;
  }
  const ctx=cameraContext(camera),src=detail();
  const view={bounds:ctx.bounds,zoom:ctx.zoom};
  // Start the requested viewport immediately. Never fetch an unseen child, neighbour, or route.
  const exact=src.peek(view);
  const target=exact?Promise.resolve(exact):src.read({...view,signal});
  target.catch(()=>{}); // the owner can be superseded while a fallback is being composed
  const prior=exact||src.peek({...view,maxUnderzoom:3,maxOverzoom:1,featureLimit:22000});
  const draw=(collection,terrain,cityFeatures,quality,administrativeAreas)=>{
    if(id!==latest)return;
    const t=performance.now();
    const retainNames=quality!=='exact'&&priorCamera&&camera.z>priorCamera.z+.16;
    const fc=typesetDetail({...ctx,features:collection.features,terrain,cityFeatures,collection,priorLabels,administrativeAreas,retainNames});
    const info={tiles:collection.tiles,missing:collection.missing,sourceZoom:collection.sourceZoom,readMs:collection.readMs,
      cachedTiles:collection.cachedTiles,viewCache:!!collection.viewCache,composeMs:Math.round(performance.now()-t)};
    send(id,camera,'local',fc,quality,info,false,localSources(ctx,collection.features,quality==='municipal-navigation',terrain,cityFeatures,administrativeAreas));
  };
  const city=()=>{cityModule??=import('./city-boundaries.mjs');return cityModule.then(m=>m.cityBoundaries(ctx.bounds,ctx.zoom));};
  const [terrainWork,cityWork]=[terrainFor(ctx.bounds,ctx.zoom).catch(()=>undefined),city().catch(()=>[])];
  // The bundled street survey covers named axes that distant parent tiles omit.
  // Use it only for the area the user is actually entering.
  const approaching=priorCamera&&camera.z>priorCamera.z+.18;
  const surveyZoom=approaching?Math.min(camera.z,16.6):camera.z;
  const municipalPreview=!exact&&fallback&&approaching&&camera.z>=14.2&&hasMadridNavigation(ctx.bounds,surveyZoom)&&
    (!prior||prior.sourceZoom<Math.min(15,Math.floor(camera.z)));
  if(!exact&&prior&&fallback&&!municipalPreview)draw(prior,undefined,[],'previous-data');
  let finalSent=false;
  if((!prior||municipalPreview)&&fallback){
    const provisional=async()=>{
      if(hasMadridNavigation(ctx.bounds,surveyZoom)){
        const t=performance.now();
        const transport=await madridNavigation(ctx.bounds,surveyZoom).catch(()=>[]);
        if(id!==latest||finalSent)return;
        if(transport.length){
          const districts=await cityWork;
          if(id===latest&&!finalSent)draw({features:transport,tiles:0,missing:0,sourceZoom:null,readMs:Math.round(performance.now()-t),cachedTiles:0},undefined,districts,'municipal-navigation');
          return;
        }
        if(prior){draw(prior,undefined,[],'previous-data');return;}
      }
      if(camera.z<=11.25){
        await regional(camera,id,true,()=>!finalSent,terrainWork);return;
      }
      if(!settled&&msg.undercovered&&camera.z<17){
        // Draw a generalised tile of the view on screen while the more detailed
        // viewport arrives; the bounds are identical and the old chart stays up.
        const overview=await src.read({...view,zoom:Math.max(9,Math.floor(camera.z)-2),signal});
        if(id===latest&&!finalSent&&!overview.missing&&overview.features.length)draw(overview,undefined,[],'navigation');
      }
    };
    provisional().catch(()=>{});
  }
  const [data,terrain,cityFeatures,areas]=await Promise.all([target,terrainWork,cityWork,regionalAreas(ctx.bounds,ctx.zoom).catch(()=>[])]);
  if(id!==latest)return;
  if((data.missing||0)>0&&!data.features.length){
    self.postMessage({type:'error',id,message:'Street data could not be loaded. Reconnecting…'});return;
  }
  finalSent=true;
  streetContext={id,terrain,cityFeatures,administrativeAreas:areas};
  draw(data,terrain,cityFeatures,'exact',areas);
}
async function prepareReserve(data){
    // The precise chart is already visible. Prepare the inward edition from
    // memory. A bounded parent survey can cover the opening edges on retreat.
    const {camera,id,sheet}=data;
    if(id!==latest)return;
    if(data.group==='local'){
      if(streetContext?.id!==id)return;
      const ctx=cameraContext(camera);
      let collection=detail().peek({bounds:camera.bounds,zoom:camera.z,maxUnderzoom:2,featureLimit:22000});
      if(!collection&&camera.leadZoom<0){
        const coarse=camera.z-.85;
        if(viewport(camera.bounds,coarse).tiles.length>8)return;
        collection=await detail().read({bounds:camera.bounds,zoom:coarse,signal:controller.signal,remember:false});
        if(id!==latest||collection.missing||collection.features.length>22000)return;
      }
      if(!collection?.features.length)return;
      const survey=collection.sourceZoom<Math.min(collection.maxSourceZoom,Math.floor(camera.z))&&camera.z>=14.2?
        await madridNavigation(ctx.bounds,Math.min(16.6,camera.z),true):[];
      if(id!==latest)return;
      const t=performance.now();
      const features=survey.length?survey:collection.features;
      const terrain=camera.z<=10.25?streetContext.terrain:undefined;
      const cityFeatures=camera.z<=15.8?streetContext.cityFeatures:[];
      const administrativeAreas=streetContext.administrativeAreas;
      const fc=typesetDetail({...ctx,terrain,cityFeatures,administrativeAreas,features,priorLabels:data.priorLabels,retainNames:true});
      send(id,camera,'local',fc,'navigation',{sourceZoom:survey.length?null:collection.sourceZoom,tiles:survey.length?0:collection.tiles,missing:0,
        cachedTiles:survey.length?0:collection.cachedTiles,viewCache:true,composeMs:Math.round(performance.now()-t)},true,localSources(ctx,features,survey.length>0,terrain,cityFeatures,administrativeAreas));
      return;
    }
    const geo=await (sheet==='peninsula'?residentPeninsula():loadRegion());
    if(!geo||id!==latest)return;
    const ctx=cameraContext(camera);
    const fc=sheet==='peninsula'?peninsulaGlyphs(geo,ctx,data.priorLabels,data.priorCamera):regionGlyphs(geo,ctx);
    send(id,camera,'regional',fc,'navigation',{sheet},true);
}
self.onmessage=({data})=>{
  if(data.type==='reserve'){
    prepareReserve(data).catch(()=>{});
    return;
  }
  if(data.type==='warm'){
    nextStamp=Math.max(nextStamp,data.stampBase||0);
    (data.camera&&hasPeninsula(data.camera)?loadPeninsula(data.camera):loadRegion()).catch(()=>{});
    return;
  }
  if(data.type==='cancel'){latest=data.id;controller?.abort();return;}
  run(data).catch(e=>{if(data.id===latest&&e.name!=='AbortError')self.postMessage({type:'error',id:data.id,message:String(e)});});
};
