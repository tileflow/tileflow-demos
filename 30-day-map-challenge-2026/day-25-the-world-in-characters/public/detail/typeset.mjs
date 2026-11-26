import {lineStations} from './line-stations.mjs?v=grounded-type-1';
import {areaStations} from './water-weave.mjs?v=regional-reading-1';
import {wordKey,wordKeys} from './word-identity.mjs?v=continuous-zoom-1';
import {printBorderNames} from './regional-border-names.mjs?v=regional-20261125b';
import {boundaryPen,matchingArea,placeAreaNames} from './regional-administration.mjs?v=regional-20261125b';
import {metropolitanScale,metropolitanPen,corridorStations} from './metropolitan-roads.mjs?v=continuous-zoom-1';
import {continuousRoads,simplifyForType} from './road-continuity.mjs?v=regional-20261125b';
import {metroWeight,regionalWeight,metroPlace,corridorDensity,setPlace} from './metropolitan.mjs?v=continuous-zoom-1';
import {graticule} from './graticule.mjs';
import {localRiverName,notablePeak} from './regional-peaks.mjs?v=regional-20261125b';

// Screen-space typesetting for real vector-tile features. All published geometry
// is a station for a character or a word; the source linework is never painted.
const PAPER_INKS = {
  water:'#397780', coast:'#36534d', river:'#347380', waterName:'#326c77',
  border:'#9a543b', trunk:'#974e32', road:'#815b43', lane:'#756657', path:'#7c786b',
  place:'#273f38', building:'#758074', park:'#75856f', poi:'#654b39'
};
const TAU=2*Math.PI, DEG=180/Math.PI;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const mod=(v,n)=>((v%n)+n)%n;
const featureBoxes=new WeakMap();
const waterNames=new Set(['water_name','water_label','waterway_label']);
const roadLayers=new Set(['transportation','transportation_name']);
const primaryPOI=new Set(['railway','railway_station','public_transit_facility','station','airport','aerodrome','hospital','museum','university','library','castle','monument','historic_site','theatre','theatre_venue','townhall','marketplace','place_of_worship','attraction','park']);
const landmarkTypes=new Set(['museum','castle','monument','historic_site','theatre','theatre_venue','townhall','town_hall','city_hall','cathedral','palace']);
const ornamentalWater=/\b(?:fuente|fountain|fontaine|fontana|brunnen|chafariz|piscina|swimming pool)\b/iu;
const naturalClasses=new Set(['park','national_park','nature_reserve','wood','forest','grass','grassland','garden','recreation_ground','leisure','meadow','village_green','cemetery']);
const naturalPlaces=new Set(['peak','mountain','volcano','mountain_peak','mountain_range','cape','island','archipelago','glacier','beach']);
function coverType(layer,cl,sub){
  if(!['landcover','landuse','park'].includes(layer))return null;
  const value=cl+' '+sub;
  if(/forest|wood|orchard/.test(value))return 'wood';
  if(/scrub|heath|wetland|marsh|grass|meadow|field|farmland|vineyard/.test(value))return 'grass';
  if(/sand|beach|dune|bare_rock|bare rock|scree/.test(value))return 'bare';
  if(/glacier|snow|ice_shelf/.test(value))return 'ice';
  return layer==='park'||naturalClasses.has(cl)?'park':null;
}
const placeRank={country:0,state:1,province:1,city:2,town:3,village:4,suburb:5,borough:5,neighbourhood:6,neighborhood:6,quarter:6,hamlet:7,locality:8,isolated_dwelling:9};
const placesAt=[2,4.5,5.2,7.0,9,10.5,12,12,14,16];
const textKey=s=>s.trim().toLocaleLowerCase();
const mixedHash=s=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;};
function geometryBounds(g){
  let cached=featureBoxes.get(g);if(cached)return cached;
  const b=[Infinity,Infinity,-Infinity,-Infinity];
  function walk(v){
    if(!v||!v.length)return;
    if(typeof v[0]==='number'){b[0]=Math.min(b[0],v[0]);b[1]=Math.min(b[1],v[1]);b[2]=Math.max(b[2],v[0]);b[3]=Math.max(b[3],v[1]);}
    else for(const item of v)walk(item);
  }
  walk(g.coordinates);featureBoxes.set(g,b);return b;
}
function overlapsBounds(b,r){
  if(b[3]<r[1]||b[1]>r[3])return false;
  if(r[2]-r[0]>=359)return true;
  const k=Math.round(((r[0]+r[2])-(b[0]+b[2]))/720)*360;
  return b[2]+k>=r[0]&&b[0]+k<=r[2];
}
function textWidth(text,size,mono=true){
  let units=0;
  for(const ch of text){
    if(/\p{Mark}/u.test(ch))continue;
    units+=ch.charCodeAt(0)>=0x2e80?1:mono?.615:/[MW]/.test(ch)?.8:/[il .,:'’]/.test(ch)?.28:.52;
  }
  return Math.max(size*.45,units*size);
}
function nameOf(p){return String(p.name||p.name_en||p['name:en']||'').trim();}
function rankRoad(p){
  const c=String(p.class||p._class||'').toLowerCase(),sub=String(p.subclass||'').toLowerCase();
  if(/motorway|freeway/.test(c))return 0;
  if(/trunk|expressway/.test(c))return 1;
  if(/primary|major_road/.test(c))return 2;
  if(/secondary/.test(c))return 3;
  if(/tertiary/.test(c))return 4;
  if(/rail|transit|aerialway|ferry|pier|runway|taxiway|construction/.test(c+' '+sub))return -1;
  if(/footway|pedestrian|steps|cycleway|bridleway|path|track/.test(c+' '+sub))return 7;
  if(c==='service'||sub==='service')return 6;
  return 5;
}
function roadPen(rank,z,link=false){
  const minZoom=[5.3,6.3,7,8.5,10,11.85,14.25,14.75][rank];
  if(z<minZoom||(link&&z<10.2))return null;
  const close=clamp((z-12)/6,0,1),block=clamp((z-17.5)/2.5,0,1);
  if(link&&rank<=2)return {char:'–',color:'#98664b',size:9.1+close*2,step:6.7+close*.5,alpha:.85,order:3};
  if(rank===0)return {char:'═',color:'#893e28',size:12.4+close*1.8+block*2,step:8.7+close*1.2+block,alpha:.97,order:7};
  if(rank===1)return {char:'━',color:'#95482e',size:12.2+close*1.8+block*2,step:8.7+close*1.1+block,alpha:.98,order:6};
  if(rank===2)return {char:'━',color:'#99563b',size:10.4+close*2.1+block*1.6,step:7.6+close*.9+block,alpha:.94,order:5};
  if(rank===3)return {char:'–',color:'#815b43',size:10.6+close*2+block*1.8,step:7+close*.9+block,alpha:.93,order:4};
  if(rank===4)return {char:'–',color:'#867361',size:9.4+close*1.9+block*1.5,step:7.2+close*.8,alpha:.84,order:3};
  if(rank===5)return {char:'-',color:'#766f60',size:8.4+close*2.3+block*1.7,step:7.4+close*.4,alpha:.65+close*.21,order:2};
  return {char:rank===7?'·':'-',color:PAPER_INKS.path,size:rank===7?12:9.6,step:rank===7?6.6:7.0,alpha:rank===7?.7:.72,order:2};
}
function clipSegment(a,b,w,h,pad){
  const dx=b[0]-a[0],dy=b[1]-a[1];let lo=0,hi=1;
  for(const [p,q] of [[-dx,a[0]+pad],[dx,w+pad-a[0]],[-dy,a[1]+pad],[dy,h+pad-a[1]]]){
    if(!p){if(q<0)return null;continue;}
    const cut=q/p;if(p<0)lo=Math.max(lo,cut);else hi=Math.min(hi,cut);
    if(lo>hi)return null;
  }
  return [[a[0]+dx*lo,a[1]+dy*lo],[a[0]+dx*hi,a[1]+dy*hi]];
}
function clippedPaths(line,w,h,pad=22){
  const output=[];let run=null;
  for(let i=1;i<line.length;i++){
    const seg=clipSegment(line[i-1],line[i],w,h,pad);if(!seg)continue;
    const [a,b]=seg;
    if(Math.hypot(b[0]-a[0],b[1]-a[1])<.06)continue;
    if(!run||Math.hypot(run.at(-1)[0]-a[0],run.at(-1)[1]-a[1])>.06){run=[a];output.push(run);}
    run.push(b);
  }
  return output;
}
function measure(line){
  const ds=[0];let length=0;
  for(let i=1;i<line.length;i++){length+=Math.hypot(line[i][0]-line[i-1][0],line[i][1]-line[i-1][1]);ds.push(length);}
  return {line,ds,length};
}
function where(path,d){
  d=clamp(d,0,path.length);
  let a=0,b=path.ds.length-1;
  while(b-a>1){const m=(a+b)>>1;if(path.ds[m]<d)a=m;else b=m;}
  const t=(d-path.ds[a])/(path.ds[b]-path.ds[a]||1),p=path.line[a],q=path.line[b];
  return [p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t];
}
function tangent(path,d,length=3){
  const a=where(path,d-length),b=where(path,d+length);
  return Math.atan2(b[1]-a[1],b[0]-a[0]);
}
function upright(a){if(a>Math.PI/2)return a-Math.PI;if(a< -Math.PI/2)return a+Math.PI;return a;}
function rectOf(rings){
  let xmin=Infinity,ymin=Infinity,xmax=-Infinity,ymax=-Infinity;
  for(const ring of rings)for(const p of ring){xmin=Math.min(xmin,p[0]);ymin=Math.min(ymin,p[1]);xmax=Math.max(xmax,p[0]);ymax=Math.max(ymax,p[1]);}
  return [xmin,ymin,xmax,ymax];
}
function inPolygon(rings,x,y){
  let inside=false;
  for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];
    if((a[1]>y)!==(b[1]>y)&&x<a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]))inside=!inside;
  }
  return inside;
}
function gridMask(w,h,cell){
  const cols=Math.ceil(w/cell)+2,rows=Math.ceil(h/cell)+2,bits=new Uint8Array(cols*rows);
  function has(x,y){const j=Math.floor(y/cell),i=Math.floor(x/cell);return j>=0&&j<rows&&i>=0&&i<cols&&bits[j*cols+i]===1;}
  function fill(rings){
    const lines=new Map();
    for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const [x1,y1]=ring[j],[x2,y2]=ring[i];if(y1===y2)continue;
      const start=Math.max(0,Math.ceil(Math.min(y1,y2)/cell-.5)),end=Math.min(rows,Math.ceil(Math.max(y1,y2)/cell-.5));
      for(let row=start;row<end;row++){
        const x=x1+(x2-x1)*((row+.5)*cell-y1)/(y2-y1);
        let xs=lines.get(row);if(!xs){xs=[];lines.set(row,xs);}xs.push(x);
      }
    }
    for(const [row,xs] of lines){
      xs.sort((a,b)=>a-b);
      for(let i=1;i<xs.length;i+=2){
        const from=clamp(Math.ceil(xs[i-1]/cell-.5),0,cols),to=clamp(Math.ceil(xs[i]/cell-.5),0,cols);
        if(to>from)bits.fill(1,row*cols+from,row*cols+to);
      }
    }
  }
  return {fill,has,fraction(){let n=0;for(const v of bits)n+=v;return n/bits.length;}};
}
function screenTileSeam(llA,llB,tile){
  if(!tile)return false;
  const [z,x,y]=tile;const n=2**z;
  const gx=lon=>(lon+180)/360*n-x;
  const gy=lat=>(1-Math.asinh(Math.tan(lat/DEG))/Math.PI)*.5*n-y;
  function cut(a,b){
    if(Math.abs(a-b)>.00003)return false;
    // Only a coordinate on or outside the nominal tile can be a clipping edge.
    if(a>.00004&&a<.99996)return false;
    return [0,1,-.5,1.5,-.25,1.25,-.125,1.125,-.0625,1.0625,-.03125,1.03125,-.015625,1.015625,-.0078125,1.0078125].some(v=>Math.abs(v-a)<.00010);
  }
  return cut(gx(llA[0]),gx(llB[0]))||cut(gy(llA[1]),gy(llB[1]));
}
function insideTile([lon,lat],[z,x,y]){
  const n=2**z,u=(lon+180)/360*n-x,v=(1-Math.asinh(Math.tan(lat/DEG))/Math.PI)*.5*n-y;
  const inset=1/4096;
  return u>inset&&u<1-inset&&v>inset&&v<1-inset;
}
function boundaryRuns(ring,screen,tile,w,h){
  if(!tile)return clippedPaths(screen,w,h);
  const out=[];let line=[];
  for(let i=1;i<ring.length;i++){
    if(screenTileSeam(ring[i-1],ring[i],tile)){
      if(line.length>1)out.push(...clippedPaths(line,w,h));line=[];continue;
    }
    if(!line.length)line.push(screen[i-1]);line.push(screen[i]);
  }
  if(line.length>1)out.push(...clippedPaths(line,w,h));
  return out;
}
function labelSpace(){
  const grid=new Map(),cell=40;
  function keys(box,grow,fn){
    const x0=Math.floor((box.x-box.extX-grow)/cell),x1=Math.floor((box.x+box.extX+grow)/cell);
    const y0=Math.floor((box.y-box.extY-grow)/cell),y1=Math.floor((box.y+box.extY+grow)/cell);
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){if(fn(x+','+y))return true;}
    return false;
  }
  function rect(x,y,w,h,a){
    const u=Math.cos(a),v=Math.sin(a),hw=w/2,hh=h/2;
    return {x,y,hw,hh,u,v,extX:Math.abs(u)*hw+Math.abs(v)*hh,extY:Math.abs(v)*hw+Math.abs(u)*hh};
  }
  function overlap(a,b){
    const dx=b.x-a.x,dy=b.y-a.y;
    if(Math.abs(dx)>a.extX+b.extX||Math.abs(dy)>a.extY+b.extY)return false;
    const c=Math.abs(a.u*b.u+a.v*b.v),s=Math.abs(a.u*b.v-a.v*b.u);
    return Math.abs(dx*a.u+dy*a.v)<a.hw+b.hw*c+b.hh*s&&Math.abs(-dx*a.v+dy*a.u)<a.hh+b.hw*s+b.hh*c&&
      Math.abs(dx*b.u+dy*b.v)<b.hw+a.hw*c+a.hh*s&&Math.abs(-dx*b.v+dy*b.u)<b.hh+a.hw*s+a.hh*c;
  }
  return {rect,overlaps(b){return keys(b,0,k=>(grid.get(k)||[]).some(a=>overlap(a,b)));},
    add(b){keys(b,0,k=>{let row=grid.get(k);if(!row){row=[];grid.set(k,row);}row.push(b);});},
    covers(x,y,r=0){
      for(const b of grid.get(Math.floor(x/cell)+','+Math.floor(y/cell))||[]){
        const dx=x-b.x,dy=y-b.y;
        if(Math.abs(dx*b.u+dy*b.v)<b.hw+r&&Math.abs(-dx*b.v+dy*b.u)<b.hh+r)return true;
      }
      return false;
    }};
}
export function typesetDetail({features,zoom,width,height,project,unproject,bounds,matrix,phase=0,terrain,cityFeatures=[],priorLabels=[],retainNames=false,administrativeAreas=[],pad=0}){
  const z=zoom,w=width,h=height;
  const blank=()=>({type:'FeatureCollection',features:[]});
  if(!w||!h||!Array.isArray(features)||z<5)return blank();
  const llAt=(x,y)=>{const p=unproject([x,y]);return Array.isArray(p)?p:[p?.lng??NaN,p?.lat??NaN];};
  const center=llAt(w*.5,h*.5);
  const nearLon=x=>x+Math.round((center[0]-x)/360)*360;
  const xy=ll=>{const a=project([nearLon(ll[0]),ll[1]]);return Array.isArray(a)?a:[a?.x??NaN,a?.y??NaN];};
  const corners=[center,llAt(-48,-48),llAt(w+48,-48),llAt(w+48,h+48),llAt(-48,h+48)].filter(p=>p.every(Number.isFinite));
  const xs=corners.map(p=>nearLon(p[0])),ys=corners.map(p=>p[1]);
  let extent=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
  if(bounds&&Array.isArray(bounds)&&bounds.length===4&&bounds.every(Number.isFinite)){
    const west=nearLon(bounds[0]),east=nearLon(bounds[2]);
    extent=[Math.min(extent[0],west,east),Math.min(extent[1],bounds[1]),Math.max(extent[2],east,west),Math.max(extent[3],bounds[3])];
  }
  const water=gridMask(w,h,3),covers=new Map(),space=labelSpace(),bridges=labelSpace();
  const weight=metroWeight(z),region=regionalWeight(z),inkSpace=weight?labelSpace():space;
  let buildingInteriors,urbanMask;
  const metro=metropolitanScale(z),corridors=metro?corridorStations(w,h,z):null;
  const metroDetail=metro?clamp((z-10.35),0,1):1,pulsePeriod=Math.round(8-5*metroDetail);
  let linework=[];
  const buildings=[],waterRings=[],parkRings=[],peaks=[],candidates=[],batches=new Map();
  const usedLabels=new Map(), occupied=new Map(),area=w*h;
  const quota={road:Math.round(area/143),river:Math.round(area/450),coast:Math.round(area/410),
    border:Math.round(area/770),building:Math.round(area/155),water:Math.round(area/188),park:Math.round(area/380)};
  const counts={},roadClasses=Array(8).fill(0),previous=new Map(),anchors={supplied:0,held:0,path:0,points:0};
  const previousInView=retainNames?[]:null;
  const surveyedPlaces=retainNames?new Set():null,printedNames=retainNames?new Set():null;
  // Only retain names whose real anchor still falls near this sheet.
  for(const old of priorLabels){
    if(!old?.t||!Array.isArray(old.ll)||old.ll.length!==2)continue;
    const [x,y]=xy(old.ll);if(!Number.isFinite(x+y)||x< -44||y< -44||x>w+44||y>h+44)continue;
    const item={...old,x,y};
    if(old.station?.length===2)item.roadPoint=xy(old.station);
    for(const key of wordKeys(old.b,old.t,old.alias)){let group=previous.get(key);if(!group)previous.set(key,group=[]);group.push(item);}
    previousInView?.push(item);anchors.supplied++;
  }
  const civicNames=new Set(cityFeatures.filter(f=>f.properties._layer==='district_label').map(f=>textKey(f.properties.name)));
  let serial=0,parkEdgeMarks=0,madridBoundaryMarks=0;
  function emit(b,t,x,y,size,angle,alpha,c,q,order=0,label,stretch){
    if(x< -12||x>w+12||y< -12||y>h+12)return;
    const ll=llAt(x,y);if(!ll.every(Number.isFinite)||Math.abs(ll[1])>90)return;
    const e=Math.round(angle*DEG/3)*3;
    const s=Math.round(size*10)/10;
    const key=label?[b,t,x,y,e].join('|'):[b,t,s,e,alpha,c,q,order].join('|');
    let f=batches.get(key);
    if(!f){const properties={b,t,s,e,a:alpha,c};
      if(label){
        if(label.held)properties.held=1;
        if(label.alias)properties.alias=label.alias;
        if(label.site)properties.station=llAt(...label.site);
        if(label.roadPoint){properties.station=llAt(label.roadPoint[0],label.roadPoint[1]);properties.route=label.route;}
      }
      if(order)properties.order=order;if(q!==undefined)properties.q=q;f={type:'Feature',properties,geometry:{type:'MultiPoint',coordinates:[]}};batches.set(key,f);}
    if(stretch||f.stretches){
      f.stretches??=Array(f.geometry.coordinates.length).fill(1);f.stretches.push(stretch||1);
    }
    f.geometry.coordinates.push([mod(ll[0]+180,360)-180,ll[1]]);counts[b]=(counts[b]||0)+1;
  }
  function seedOf(p){return mixedHash(String(p.name||p.ref||p.class||''));}
  function candidate(name,b,priority,size,x,y,a=0,repeat=200,color=PAPER_INKS.place,mono=false,metadata){
    if(!name||name.length>70||x<0||x>w||y<0||y>h)return;
    const rows=name.split('\n'),width=Math.max(...rows.map(row=>textWidth(row,size,mono)));
    // Point names only retain an existing, surveyed label location. A district
    // may have several safe interior positions, which makes this tie-break useful.
    const prior=previous.get(wordKey(b,name))||metadata?.alias&&previous.get(wordKey(b,metadata.alias));
    const held=metadata?.held||prior?.some(o=>{
      if(metadata?.site&&o.roadPoint)return Math.hypot(o.roadPoint[0]-x,o.roadPoint[1]-y)<4;
      return !metadata?.roadPoint&&!metadata?.site&&Math.hypot(o.x-x,o.y-y)<1.75;
    });
    candidates.push({name,b,priority:priority-(held?3.1:0),size,x,y,a,width,lines:rows.length,repeat,color,serial:serial++,...metadata,held});
  }
  function nearestStation(path,target,tolerance){
    const {line,ds}=path;let best=tolerance*tolerance,distance=null;
    for(let j=1;j<line.length;j++){
      const a=line[j-1],b=line[j],x=target[0],y=target[1];
      if(x<Math.min(a[0],b[0])-tolerance||y<Math.min(a[1],b[1])-tolerance||x>Math.max(a[0],b[0])+tolerance||y>Math.max(a[1],b[1])+tolerance)continue;
      const dx=b[0]-a[0],dy=b[1]-a[1],len2=dx*dx+dy*dy;
      const t=clamp(((x-a[0])*dx+(y-a[1])*dy)/(len2||1),0,1),error=(a[0]+dx*t-x)**2+(a[1]+dy*t-y)**2;
      if(error<=best){best=error;distance=ds[j-1]+(ds[j]-ds[j-1])*t;}
    }
    return distance;
  }
  function lineNameOffset(role,size){
    return -size*((role==='waterLabel'?.58:.69)+weight*.18+(role==='waterLabel'?region*.12:0));
  }
  function lineLabel(name,b,path,priority,size,color,mono,repeat,routeRef,waterProperties){
    if(!name||name.length>60)return;
    const span=textWidth(name,size,mono);
    if(path.length<span*1.12+12)return;
    const from=span*.53+4,to=path.length-from,half=span*.49;
    const channel=b==='waterLabel'?region:0;
    const offset=lineNameOffset(b,size);
    const route=textKey(String(routeRef||name)),priors=previous.get(wordKey(b,name))||[];
    const alternate=channel>.12&&waterProperties?.name_es&&waterProperties.name_es!==name?previous.get(wordKey(b,waterProperties.name_es)):null;
    function propose(distance,rank,old){
      const at=where(path,distance),left=where(path,distance-half),right=where(path,distance+half);
      // A river's name follows the local valley axis; small meanders can fit
      // beneath its baseline. Reject reaches that double back on themselves.
      if(Math.hypot(right[0]-left[0],right[1]-left[1])<half*(1.83-.48*channel))return;
      const angle=upright(Math.atan2(right[1]-left[1],right[0]-left[0]));
      if(old&&Math.abs(Math.cos(angle-old.e/DEG))<.946)return;
      const local=channel>.12&&waterProperties?localRiverName(waterProperties,llAt(...at))||name:name;
      const centrality=channel*.5*((at[0]/w-.5)**2+(at[1]/h-.5)**2);
      candidate(local,b,rank+centrality,size,at[0]-Math.sin(angle)*offset,at[1]+Math.cos(angle)*offset,
        angle,repeat,color,mono,{held:!!old,roadPoint:at,route,waterCourse:channel>.12?route:undefined});
    }
    // Recover the actual old centreline station, not the old offset of the text.
    // Confirm route identity, position and bearing before giving it precedence.
    // New or disconnected road sections keep the regular station candidates.
    for(const old of alternate?[...priors,...alternate]:priors){
      if(old.route&&old.route!==route)continue;
      const oldAngle=Number(old.e||0)/DEG;
      const target=old.roadPoint||[old.x+Math.sin(oldAngle)*offset,old.y-Math.cos(oldAngle)*offset];
      const d=nearestStation(path,target,old.roadPoint?3.5:5.5);
      if(d!==null&&d>=from&&d<=to)propose(d,priority,old);
    }
    const count=clamp(Math.ceil(path.length/(210-channel*76)),1,8);
    for(let i=0;i<count;i++)propose(from+(to-from)*(i+.5)/count,priority+i*.01);
  }
  function pointLabel(p,ll,layer){
    const pos=xy(ll),name=nameOf(p),[x,y]=pos;
    if(surveyedPlaces&&name&&(layer==='place'||layer==='district_label'||layer==='natural_label'||layer==='park')){
      surveyedPlaces.add(textKey(name));
    }
    if(region>0&&layer==='park'){
      // These are the source's surveyed park label points. Individual mapped
      // polygon fragments can span the same tile in several separate pieces.
      const classification=String(p.name_en||'')+' '+name;
      const national=/national park|nationalpark|parque nacional|parc national|parco nazionale/i.test(classification)||Number(p.protect_class)===2;
      const regional=/regional park|parque regional|parc (?:naturel )?régional|parco regionale/i.test(classification);
      if(!name||(!national&&!regional))return;
      // Keep the legal designation while leaving room for adjacent settlements.
      const title=name.replace(/^parque (nacional|regional)(?: (?:de la|del|de))?\s+/i,(_all,kind)=>/^n/i.test(kind)?'P. N. ':'P. R. ');
      const priority=national?2.45:5.3, size=13+region*.9;
      const side=Math.min(48,textWidth(title,size,false)*.32);
      for(const [dx,dy] of [[0,0],[0,-size],[0,size],[side,-size],[side,size],[-side,-size],[-side,size]]){
        candidate(title,'place',priority+Math.hypot(dx,dy)*.015,size,x+dx,y+dy,0,1600,'#53684e',false,{physical:'park'});
      }
    }else if(region>.12&&layer==='natural_label'&&/^(peak|mountain|volcano|mountain_peak)$/.test(p.class)){
      if(Number(p.filterrank??p.rank)!==0||!notablePeak(ll))return;
      candidate(name,'place',12.1,12.2+region*.65,x,y-7,0,1100,'#6c6857',false,{physical:'peak',peakPoint:[x,y]});
    }else if(layer==='district_label'){
      if(z>=10.8&&z<=15.2)candidate(z<13.45?name.toLocaleUpperCase('es'):name,'place',5.4+(p.alternate||0)*.12,z<13.45?17:15.5,x,y,0,10000,'#57475a');
    }else if(layer==='place'){
      if(civicNames.has(textKey(name))&&z>=10.8&&z<=15.2)return;
      const k=String(p.class||p._class||'').toLowerCase(),rank=placeRank[k]??6;
      if(z<(placesAt[rank]||5)||rank===0&&z>8.2||rank===1&&z>10.25||rank===2&&z>14||rank===3&&z>15.5)return;
      if(rank===0&&z>=6.85&&region>.2)return;
      if(rank===1&&region>.045&&matchingArea(name,administrativeAreas))return;
      if(rank===1&&region){
        const size=18.5-4.5*region;
        candidate(name.toLocaleUpperCase(),'regionLabel',7+region*2,size,x,y,0,650,'#74687d');
        return;
      }
      const prominence=clamp((z-9.55)/.9,0,1);
      const citySize=19+prominence*(p.capital||Number(p.rank)<=3?6:3);
      const alias=p.name_en||p['name:en'];
      const size=rank<=1?18.5:rank===2?citySize:rank===3?16.3:rank<=5?14.4:12.7;
      const style=weight&&metroPlace(p,rank),priority=rank*1.55+clamp(Number(p.rank)||5,0,20)*.04;
      if(style){
        candidate(name,'place',priority+(style.priority-priority)*weight,size+(style.size-size)*weight-region*(style.dot===24?3.2:style.dot>=16?1.4:1.6),
          x,y,0,300,style.ink,false,{site:[x,y],alias:alias!==name?alias:undefined,gap:style.gap*weight*(1+region*.48),dot:style.dot});
      }else candidate(rank===0?name.toUpperCase():name,'place',priority,size,x,y,0,260,PAPER_INKS.place,false,alias&&alias!==name?{alias}:undefined);
    }else if(waterNames.has(layer)&&name){
      const rank=Number(p.sizerank??p.rank)||0;
      if(z<17&&(ornamentalWater.test(name)||ornamentalWater.test(String(p.name_en||''))||p.class==='lake'&&rank>Math.max(5,z-4.5)))return;
      candidate(name,'waterLabel',3.4+rank*.12,15+3*clamp((9.4-z)/.8,0,1)-2*weight,x,y,0,480,PAPER_INKS.waterName);
    }else if(layer==='natural_label'&&naturalPlaces.has(String(p.class))&&z>=8){
      const rank=Number(p.sizerank??p.rank)||0;
      if(rank>Math.max(3,z-4))return;
      const summit=/peak|mountain|volcano/.test(p.class);
      if(summit&&civicNames.size&&z>=10.8)return;
      candidate(name,'place',8.8+rank*.1+weight*6,(summit?13.3:12.5)-weight*1.8,x,y-7,0,270,
        weight?'#697462':PAPER_INKS.coast,false,weight?{gap:110*weight,summit}:undefined);
      if(summit&&x>=0&&x<=w&&y>=0&&y<=h)peaks.push([x,y]);
    }else if(layer==='poi'&&name&&z>=15.3){
      const cl=String(p.class||'').toLowerCase(),sub=String(p.subclass||'').toLowerCase();
      if(landmarkTypes.has(sub)||landmarkTypes.has(cl)){
        const rank=Number(p.filterrank??p.rank)||4;
        candidate(name,'landmark',19.5+rank*.14,z>=18?16.5:15,x,y,0,280,PAPER_INKS.place);
        return;
      }
      const civic=primaryPOI.has(cl)||primaryPOI.has(sub)||/place_of_worship/.test(sub);
      if(!civic&&(z<18.25||/atm|bus_stop|parking|entrance|rental/.test(sub)))return;
      candidate(name,'poi',23+(civic?0:7)+(Number(p.rank)||4)*.14,11.3,x,y,0,170,PAPER_INKS.poi,true);
    }else if(layer==='housenumber'&&z>=18.15){
      const number=String(p.housenumber||p['addr:housenumber']||p.house_number||name||'');
      if(number&&number.length<=10)candidate(number,'house',45,9.8,x,y,0,0,PAPER_INKS.building,true);
    }
  }
  for(const feature of (cityFeatures.length?[...cityFeatures,...features]:features)){
    const g=feature.geometry,p=feature.properties||{},layer=p._layer||feature.layer;
    if(!g||!layer||!overlapsBounds(feature.bbox||geometryBounds(g),extent))continue;
    const type=g.type,cl=String(p.class||'').toLowerCase(),name=nameOf(p);
    if(type==='Point'||type==='MultiPoint'){
      if(layer==='place'||layer==='district_label'||waterNames.has(layer)||layer==='poi'||layer==='housenumber'||layer==='natural_label'||region>0&&layer==='park'){
        for(const point of (type==='Point'?[g.coordinates]:g.coordinates))pointLabel(p,point,layer);
      }
      continue;
    }
    if(type==='Polygon'||type==='MultiPolygon'){
      const isWater=layer==='water',isBuilding=layer==='building'&&z>=16.8;
      const isUrban=weight>0&&(layer==='landcover'&&cl==='urban'||layer==='landuse'&&['residential','industrial','commercial','retail'].includes(cl));
      const cover=weight&&layer==='landcover'&&cl==='trees'?'wood':z>=9.2?coverType(layer,cl,String(p.subclass||'')):null,isPark=!!cover;
      if(!isWater&&!isBuilding&&!isPark&&!isUrban&&!waterNames.has(layer))continue;
      const rawTile=String(p._tile||'').split('/').map(Number),tile=rawTile.length===3&&rawTile.every(Number.isFinite)?rawTile:null;
      for(const rings of (type==='Polygon'?[g.coordinates]:g.coordinates)){
        const screen=rings.map(r=>r.map(xy));if(!screen[0]?.length)continue;
        const box=rectOf([screen[0]]),bw=box[2]-box[0],bh=box[3]-box[1];
        if(box[2]<-20||box[3]<-20||box[0]>w+20||box[1]>h+20)continue;
        if(isUrban){urbanMask??=gridMask(w,h,4);urbanMask.fill(screen);}
        if(isWater){water.fill(screen);waterRings.push({rings,screen,tile});}
        if(isPark){
          let mask=covers.get(cover);if(!mask){mask=gridMask(w,h,5);covers.set(cover,mask);}
          mask.fill(screen);
          if(z>=9.7&&z<=17.5&&['park','wood'].includes(cover)&&bw>=38&&bh>=30&&bw*bh>=8500){
            parkRings.push({rings,screen,tile,mask,importance:Math.min(w,bw)*Math.min(h,bh)});
          }
        }
        if(isBuilding&&bw>=5&&bh>=5&&bw*bh>=(z>=18?36:60)){
          buildings.push({rings,screen,tile,importance:Math.min(220,Math.sqrt(bw*bh))});
          if(z>=18&&bw>=16&&bh>=16&&bw*bh>=550){
            buildingInteriors??=gridMask(w,h,3);buildingInteriors.fill(screen);
          }
        }
        if(name&&(isWater||waterNames.has(layer)||isBuilding&&z>=17.75||isPark&&z>=10.3)){
          const size=isWater?15:isPark&&z<=15?14:11.5,minText=textWidth(name,size,!isWater&&!isPark);
          if(bw>=minText+8&&bh>=size+6&&(!isWater||z>=17||!ornamentalWater.test(name)&&bw*bh>=4800)){
            const x=(box[0]+box[2])/2,y=(box[1]+box[3])/2;
            if(inPolygon(screen,x,y)&&inPolygon(screen,x-minText*.35,y)&&inPolygon(screen,x+minText*.35,y))
              candidate(name,isWater?'waterLabel':isPark&&z<=15?'place':'poi',isWater?5:isPark?14:26,size,x,y,0,isWater?480:290,isWater?PAPER_INKS.waterName:isPark?'#526b50':PAPER_INKS.poi,!isWater&&!isPark);
          }
        }
      }
      continue;
    }
    if(type!=='LineString'&&type!=='MultiLineString')continue;
    const road=roadLayers.has(layer),river=layer==='waterway'||waterNames.has(layer),border=layer==='boundary'||layer==='municipal_district';
    if(!road&&!river&&!border)continue;
    if(border&&(p.maritime===true||p.maritime===1||p.maritime==='1'))continue;
    const level=Number(p.admin_level||p.adminLevel)||2,rank=road?rankRoad(p):0;
    const localBoundary=level>=7,official=layer==='municipal_district';
    if(road&&rank<0||border&&(level>10||level>=9&&!official&&z<12||level>=7&&z<10||level>4&&z<9||level>2&&z<6.6))continue;
    const link=road&&(p.link===true||p.link===1||p.link==='true'||p.link==='1'||/_link$/.test(String(p.subclass)));
    const ordinaryPen=road?roadPen(rank,z,link):null;
    const pen=ordinaryPen&&metro?metropolitanPen(rank,z,link,ordinaryPen):ordinaryPen;
    if(road&&!pen||river&&/ditch|drain|stream/.test(cl)&&z<11.6)continue;
    const isNameLayer=layer==='transportation_name'||waterNames.has(layer);
    for(const pathLL of (type==='LineString'?[g.coordinates]:g.coordinates)){
      const projected=pathLL.map(xy);
      for(const run of clippedPaths(projected,w,h)){
        const path=measure(run);if(path.length<3)continue;
        if(road&&!isNameLayer&&path.length<=24&&run.length===projected.length){
          const tile=p._tile?String(p._tile).split('/').map(Number):null;
          const onPage=([x,y])=>x>0&&x<w&&y>0&&y<h;
          // A clipped tile or viewport endpoint is not a stable survey anchor.
          path.complete=onPage(projected[0])&&onPage(projected.at(-1))&&
            (!tile||tile.length!==3||[pathLL[0],pathLL.at(-1)].every(ll=>insideTile(ll,tile)));
        }
        if(road&&p.structure==='bridge'&&!isNameLayer){
          for(let i=1;i<run.length;i++){
            const a=run[i-1],b=run[i],x=b[0]-a[0],y=b[1]-a[1];
            bridges.add(bridges.rect((a[0]+b[0])/2,(a[1]+b[1])/2,Math.hypot(x,y)+6,14,Math.atan2(y,x)));
          }
        }
        if(!isNameLayer){
          if(road){
            // At metropolitan scales tiny unclassified street fragments compete
            // with complete avenues. Introduce them as the block becomes readable.
            const minimum=rank===5?clamp((14-z)*11,0,24):link?clamp((13-z)*7,0,15):0;
            if(path.length>=minimum)linework.push({b:'road',path,rank,link,route:p.ref||name,structure:p.structure||'',priority:10+rank+(link?.35:0),pen,seed:seedOf(p)});
          }
          else if(river)linework.push({b:'river',path,priority:5,pen:{char:'~',color:PAPER_INKS.river,size:cl==='stream'?9.5:11+.65*region,alpha:.88+.07*region,step:cl==='stream'?7.5:7+.6*region},seed:seedOf(p)});
          else linework.push({b:'border',path,official,priority:level<=2?0:official?1:3,
            pen:localBoundary?{char:':',color:'#755b77',size:level===10?9.6:11,
              step:level===10?12.8:10.8,alpha:level===10?.68:.86,order:1}:
              boundaryPen(level,{char:level<=2?'–':'-',color:PAPER_INKS.border,size:level<=2?11.2:9.5,step:level<=2?9:8,alpha:level<=2?.99:.69,order:1},region,p.disputed===true),seed:seedOf(p)});
        }
        if(road){
          const reference=String(p.shield_text||p.ref||'').split(';')[0].trim();
          const title=rank<=1&&reference&&z<15.5?reference:name||reference;
          const threshold=[5.7,6.3,7.4,9.2,10.7,12.15,15.25,16.1][rank];
          if(z>=threshold&&(!weight||weight<.5||!link)&&!(region>.60&&rank>=2&&path.length<138)){
            const size=(rank<=1?15:rank===2?13.2:rank<6?12:11)-weight*(rank<=1?3.7:1.9);
            lineLabel(title,'roadLabel',path,7.1+rank*1.15+(link?1.4:0)+(isNameLayer?0:.45),size,rank<=1?(weight?'#86553d':'#71331f'):rank<=2?PAPER_INKS.trunk:PAPER_INKS.road,true,(rank<=1?350:rank<=3?275:225)+weight*135,p.ref||name||title);
          }
        }else if(river&&name)lineLabel(name,'waterLabel',path,6-3.2*region,15.5-weight*2.5+.45*region,PAPER_INKS.waterName,false,480+weight*150+region*Math.max(w,h)*.83,undefined,p);
      }
    }
  }
  const density=weight?corridorDensity(linework,w,h):null;
  if(administrativeAreas.length)placeAreaNames(administrativeAreas,{xy,width:w,height:h,region,weight,candidate,pad,density,
    centres:candidates.filter(c=>c.site&&c.dot>=20),urban:urbanMask});
  if(region&&z>=6.85)candidates.push({kind:'border-pair',priority:4,x:w/2,y:h/2,serial:serial++});
  // Sparse parent tiles can omit an entire named street. Reuse its surveyed
  // station only on provisional inward sheets, after all fresh candidates.
  if(previousInView)for(const old of previousInView){
    const {b,t,s,roadPoint}=old,road=b==='roadLabel',waterName=b==='waterLabel';
    if(!road&&!waterName&&(b!=='place'||surveyedPlaces.has(textKey(t))))continue;
    if(!Number.isFinite(s)||s<=0)continue;
    const a=Number.isFinite(old.e)?upright(old.e/DEG):0;
    let {x,y}=old,metadata={held:true,retained:true};
    if(roadPoint){
      if(!roadPoint.every(Number.isFinite))continue;
      if(road||waterName){
        const offset=lineNameOffset(b,s);
        x=roadPoint[0]-Math.sin(a)*offset;y=roadPoint[1]+Math.cos(a)*offset;
        metadata.roadPoint=roadPoint;metadata.route=old.route;
      }else{
        [x,y]=roadPoint;
        if(weight)metadata.site=roadPoint;
      }
    }
    const color=old.c||(road?PAPER_INKS.road:waterName?PAPER_INKS.waterName:PAPER_INKS.place);
    candidate(t,b,road?103:waterName?102:101,s,x,y,a,road?225:waterName?480:260,color,road,metadata);
  }
  candidates.sort((a,b)=>a.priority-b.priority||((a.x-w/2)**2+(a.y-h/2)**2)-((b.x-w/2)**2+(b.y-h/2)**2)||a.serial-b.serial);
  const physicalSites=[];
  const sites=[],roadNames=[];
  const maxLabels=Math.max(12,Math.round(area/3700)),poiPoints=[],landmarkPoints=[];let nLabels=0;
  for(const c of candidates){
    if(nLabels>=maxLabels)break;
    if(c.kind==='border-pair'){
      nLabels+=printBorderNames({z,region,bounds:extent,w,h,pad,linework,llAt,where,space,inkSpace,emit});
      continue;
    }
    if(c.physical&&physicalSites.some(other=>Math.hypot(c.x-other.x,c.y-other.y)<(c.physical==='peak'?230:147)))continue;
    if(c.b==='poi'&&(poiPoints.length>=Math.max(3,Math.min(Math.round(area/58000),Math.ceil((counts.roadLabel||0)*.52)))||poiPoints.some(p=>Math.hypot(c.x-p[0],c.y-p[1])<75)))continue;
    if(c.b==='landmark'&&(landmarkPoints.length>=clamp(Math.round(area/230000),2,5)||landmarkPoints.some(p=>Math.hypot(c.x-p[0],c.y-p[1])<130)))continue;
    if(c.b==='waterLabel'&&(counts.waterLabel||0)>=Math.max(3,Math.round(area/55000)))continue;
    const key=c.b+'|'+(c.waterCourse||textKey(c.name)),olds=usedLabels.get(key)||[];
    if(c.retained&&(printedNames.has(c.b+'|'+textKey(c.name))||c.route&&printedNames.has(c.b+'|'+c.route)))continue;
    if(c.b==='waterLabel'&&z>=16&&olds.length)continue;
    const repeat=c.b==='roadLabel'?Math.max(c.repeat,c.width*2.5):c.repeat;
    if(repeat&&olds.some(p=>Math.hypot(c.x-p[0],c.y-p[1])<repeat))continue;
    if(c.gap&&sites.some(([x,y])=>(x-c.x)**2+(y-c.y)**2<c.gap*c.gap))continue;
    if(weight&&c.b==='roadLabel'&&roadNames.some(([x,y])=>(x-c.x)**2+(y-c.y)**2<((82+region*49)*weight)**2))continue;
    let box;
    if(c.site){
      const placed=setPlace(c,space,density,w,h,previous.get(wordKey(c.b,c.name))||c.alias&&previous.get(wordKey(c.b,c.alias)),weight,water);
      if(!placed)continue;
      c.x=placed.x;c.y=placed.y;c.held=placed.held;box=placed.box;
    }else box=space.rect(c.x,c.y,c.width+(c.b==='house'?4:8),c.size*(1.12+1.2*(c.lines-1))+3,c.a);
    if(c.b==='waterLabel'&&bridges.overlaps(box))continue;
    if(c.x-box.extX<1||c.y-box.extY<1||c.x+box.extX>w-1||c.y+box.extY>h-1||space.overlaps(box))continue;
    space.add(box);
    if(inkSpace!==space)inkSpace.add(space.rect(c.x,c.y,c.width*(1-.16*weight)+2,c.size*(1.03-.22*weight+1.2*(c.lines-1)),c.a));
    if(c.site||c.summit)sites.push(c.site||[c.x,c.y]);
    if(weight&&c.b==='roadLabel')roadNames.push([c.x,c.y]);
    if(c.site&&c.dot&&weight>.15)emit('townDot','·',...c.site,c.dot,0,weight,c.color,undefined,9);
    olds.push([c.x,c.y]);usedLabels.set(key,olds);nLabels++;
    if(printedNames){
      printedNames.add(c.b+'|'+textKey(c.name));
      if(c.route)printedNames.add(c.b+'|'+c.route);
    }
    emit(c.b,c.name,c.x,c.y,c.size,c.a,c.b==='house'?.79:c.opacity??1,c.color,undefined,0,c);
    if(c.held){anchors.held++;if(c.roadPoint)anchors.path++;else anchors.points++;}
    if(c.b==='poi')poiPoints.push([c.x,c.y]);
    if(c.b==='landmark')landmarkPoints.push([c.x,c.y]);
    if(c.physical){physicalSites.push(c);if(c.peakPoint)peaks.push(c.peakPoint);}
  }
  function markUsed(b,x,y,spacing){
    let set=occupied.get(b);if(!set){set=new Set();occupied.set(b,set);}
    const nx=Math.ceil((w+60)/spacing);
    const key=Math.floor((y+30)/spacing)*nx+Math.floor((x+30)/spacing);
    if(set.has(key))return true;set.add(key);return false;
  }
  const fixedStations=lineStations(matrix);
  function printPath(role,path,pen,start,check,flowSeed,budget,rank){
    if((counts[role]||0)>=quota[role]||budget&&budget.used>=budget.max)return;
    function draw(x,y,a,index,fixedKey,stretch){
      if(x<0||x>w||y<0||y>h||inkSpace.covers(x,y,1.7-weight))return;
      if(check&&!check(x,y,a))return;
      if(role==='road'&&metro){
        if(!corridors.accept(x,y,a,path,pen.step,rank))return;
      }else if(fixedKey!==undefined){
        let seen=occupied.get(role);
        if(!seen){seen=new Set();occupied.set(role,seen);}
        if(seen.has(fixedKey))return;
        seen.add(fixedKey);
      }else if(markUsed(role,x,y,role==='road'?4.1:pen.step*.66))return;
      emit(role,pen.alternate&&index%pen.period===pen.period-1?pen.alternate:pen.char,x,y,pen.size,a,pen.alpha,pen.color,undefined,pen.order,undefined,stretch);
      if(budget)budget.used++;
      if(!fixedStations&&flowSeed!==undefined&&(counts.flow||0)<Math.max(40,Math.round(area/1550))&&index%pulsePeriod===0){
        emit('flow',pen.char,x,y,pen.size+.5*metroDetail,a,.42+.46*metroDetail,metro?'#a8684b':'#b55434',mod(index+flowSeed,8));
      }
      if(counts[role]>=quota[role]||budget&&budget.used>=budget.max)return false;
    }
    if(fixedStations){
      const hits=fixedStations(path,pen.step,draw,role==='road'&&rank<=3);
      if(!hits&&path.length<=pen.step*2.3){
        const first=path.line[0],last=path.line.at(-1);
        const closed=first[0]>0&&first[0]<w&&first[1]>0&&first[1]<h&&Math.hypot(first[0]-last[0],first[1]-last[1])<1e-6;
        if(path.complete||closed){
          // A whole cul-de-sac or ring may fit between consecutive stations.
          // Place one sign on the actual perimeter or road, in either direction.
          const half=path.length/2,[x,y]=where(path,half);
          draw(x,y,tangent(path,half),0);
        }
      }
      return;
    }
    const approx=Math.ceil(path.length/pen.step),skipStart=path.length<pen.step*1.28?path.length/2:start;
    for(let i=0,d=skipStart;i<=approx&&d<path.length;i++,d+=pen.step){
      const [x,y]=where(path,d),a=tangent(path,d,Math.min(3,pen.step*.4)+(role==='border'||role==='road'?region*2.1:0));
      if(draw(x,y,a,i)===false)break;
    }
  }
  if((metro||z>=9)&&z<=16)linework=continuousRoads(linework,measure,metro);
  if(region){
    for(const r of linework){
      if(r.b==='road'||r.b==='border')r.path=simplifyForType(r.path,region*(r.b==='border'?1.15:.85),measure);
    }
    if(urbanMask)linework=linework.filter(r=>r.b!=='road'||r.path.length>=region*(r.rank<2?8:12)||!urbanMask.has(...where(r.path,r.path.length/2)));
  }
  if(metro){
    const gate=clamp((11.35-z)/1.2,0,1);
    linework=linework.filter(r=>r.b!=='road'||r.rank<3||r.path.length>gate*(r.rank===3?10:18));
  }
  linework.sort((a,b)=>a.priority-b.priority||b.path.length-a.path.length);
  const roadInk=[{count:0,used:0},{count:0,used:0},{count:0,used:0}];
  const roadGroup=r=>r.rank<=1&&!r.link?0:r.rank<=3?1:2;
  for(const r of linework)if(r.b==='road')roadInk[roadGroup(r)].count+=Math.max(r.path.complete?1:0,r.path.length/r.pen.step);
  // Thin subordinate linework first. Preserve the spacing of motorway dashes
  // and keep some paper for the smaller roads wherever they actually exist.
  let remaining=quota.road;
  for(const [i,share] of [0.35,0.32,0.33].entries()){
    const group=roadInk[i];group.max=Math.min(Math.ceil(group.count),Math.floor(quota.road*share));remaining-=group.max;
  }
  for(const g of roadInk){const extra=Math.min(remaining,Math.max(0,Math.ceil(g.count)-g.max));g.max+=extra;remaining-=extra;}
  for(const [i,g] of roadInk.entries())g.dilation=clamp(g.count/Math.max(1,g.max*1.35),1,[1.25,1.7,2.1][i]);
  const localPulses=new Set(z>=15?linework.filter(a=>a.b==='road'&&a.path.length>=80)
    .sort((a,b)=>b.path.length-a.path.length).slice(0,clamp(Math.round(area/110000),2,10)):[]);
  for(const item of linework){
    const budget=item.b==='road'?roadInk[roadGroup(item)]:null;
    const pen=budget&&budget.dilation>1?{...item.pen,step:item.pen.step*budget.dilation}:item.pen;
    const advance=item.b==='road'?phase*pen.step:0;
    const pulse=item.b==='road'&&(!region||item.rank<2)&&!item.link&&item.path.length>=65&&(item.rank<=2||localPulses.has(item));
    const axis=item.b==='river'?(x,y)=>!(water.has(x-7,y)&&water.has(x+7,y)&&water.has(x,y-7)&&water.has(x,y+7)):null;
    const before=counts[item.b]||0;
    printPath(item.b,item.path,pen,mod((item.seed%997)/997*pen.step+advance,pen.step),axis,pulse?item.seed:undefined,budget,item.rank);
    if(item.official)madridBoundaryMarks+=(counts.border||0)-before;
    if(budget)roadClasses[item.rank]+=(counts.road||0)-before;
  }
  const parkBudget={used:0,max:Math.round(area/670)},parkPen={char:'–',color:'#4e6c54',size:10.3,step:7.6,alpha:.88,order:1};
  parkRings.sort((a,b)=>b.importance-a.importance);
  for(const {rings,screen,tile,mask} of parkRings){
    if(parkBudget.used>=parkBudget.max)break;
    for(let i=0;i<rings.length;i++)for(const run of boundaryRuns(rings[i],screen[i],tile,w,h)){
      const p=measure(run);if(p.length<14)continue;
      printPath('park',p,parkPen,3.5,(x,y,a)=>{
        const dx=Math.sin(a)*5.5,dy=Math.cos(a)*5.5;
        return mask.has(x-dx,y+dy)!==mask.has(x+dx,y-dy);
      },undefined,parkBudget);
    }
  }
  parkEdgeMarks=parkBudget.used;
  const shorePen={char:'–',color:PAPER_INKS.coast,size:9.4,step:6.6,alpha:.91};
  for(const {rings,screen,tile} of waterRings){
    for(let i=0;i<rings.length;i++)for(const run of boundaryRuns(rings[i],screen[i],tile,w,h))
      printPath('coast',measure(run),shorePen,2.4,(x,y,a)=>{const nx=-Math.sin(a)*3.3,ny=Math.cos(a)*3.3;return water.has(x+nx,y+ny)!==water.has(x-nx,y-ny);});
  }
  const buildingPen={char:'-',color:PAPER_INKS.building,size:z>=18?8.2:7.2,step:z>=18?5.4:5.8,alpha:z>=18?.72:.57};
  buildings.sort((a,b)=>b.importance-a.importance);
  for(const {rings,screen,tile} of buildings){
    if((counts.building||0)>=quota.building)break;
    for(let i=0;i<rings.length;i++)for(const run of boundaryRuns(rings[i],screen[i],tile,w,h))printPath('building',measure(run),buildingPen,2.1);
  }
  // Phase the weave against global mercator pixels at the camera centre. The
  // same shore retains its waves where neighbouring decoded tiles meet.
  const wm=512*2**z, mx=(center[0]+180)/360*wm,my=(1-Math.asinh(Math.tan(clamp(center[1],-85,85)/DEG))/Math.PI)/2*wm;
  function printWave(x,y,u,v,sample,visibility){
    if((counts.water||0)>=quota.water||!water.has(x,y)||space.covers(x,y,4))return;
    if(!water.has(x-3,y)||!water.has(x+3,y)||!water.has(x,y-2)||!water.has(x,y+2))return;
    const nearShore=!water.has(x-13,y)||!water.has(x+13,y)||!water.has(x,y-11)||!water.has(x,y+11);
    const fraction=Math.sin(u)+Math.cos(v)*.67;
    if(fraction<-.2&&sample>(nearShore?7:3))return;
    const shade=fraction>.8?.63:fraction>-.2?.44:nearShore?.39:.28;
    // Quantise only optional stations and group equal ink into MultiPoints.
    const opacity=visibility>=1?shade:Math.round(shade*visibility*32)/32;
    if(opacity>0)emit('water','~',x,y,12.2+.8*clamp(z-13.5,0,1),Math.cos(u)*.09,opacity,PAPER_INKS.water);
  }
  const printedCover=new Set();
  function pattern(b,mask,dx,dy,kind=b){
    function station(x,y,u,v,sample,visibility){
      if(b!=='interior'&&(counts[b]||0)>=quota[b])return;
      if(!mask.has(x,y)||(b==='urban'&&region?inkSpace.covers(x,y,1):space.covers(x,y,4)))return;
      const fraction=Math.sin(u)+Math.cos(v)*.67;
      function mark(role,char,x,y,size,angle,alpha,color){
        const ink=visibility===1?alpha:Math.round(32*alpha*visibility)/32;
        if(ink>0)emit(role,char,x,y,size,angle,ink,color);
      }
      if(b==='urban'){
        if(water.has(x,y)||sample===10)return;
        const edge=!mask.has(x-7,y)||!mask.has(x+7,y)||!mask.has(x,y-6)||!mask.has(x,y+6);
        const dash=(sample<4||edge&&sample<7);
        mark('urban',dash?'–':'·',x,y,dash?7.7+region:10.3+region,dash?-.35:0,((edge?.73:.59)+region*.15)*weight,region>.4?'#8f766f':'#9a8270');
      }else if(b==='water'){
        printWave(x,y,u,v,sample,1);
      }else if(kind==='wood'&&region>sample/11){
        if(sample>8||water.has(x,y))return;
        const needle=sample>1,tree=sample===4||sample===7,angle=needle&&!tree?-.30+Math.sin(v*.4)*.21:0;
        mark('park',tree?'∧':needle?'′':'·',x,y,tree?8.3:needle?10.5:10.8,angle,(tree?.58:needle?.66:.55)*(.78+.22*region),'#567657');
      }else if(b==='interior'){
        if(sample>6||water.has(x,y)||!mask.has(x-4,y)||!mask.has(x+4,y)||!mask.has(x,y-4)||!mask.has(x,y+4))return;
        mark('building',sample===0?'′':'·',x,y,sample===0?8.2:8.8,.04,.43,PAPER_INKS.building);
      }else if((fraction>.25||sample<2)&&!water.has(x,y)){
        if(matrix){
          // Overlapping park and landcover polygons can share a station.
          // Use that station's coordinates instead of a screen-space bin.
          const key=x+','+y;
          if(printedCover.has(key))return;
          printedCover.add(key);
        }else if(markUsed('cover',x,y,dx*.66))return;
        const char=kind==='wood'?(z<10.5&&sample<4?'∧':sample<3?'·':'′'):kind==='bare'?'·':kind==='ice'?'·':kind==='grass'?(sample<5?',':'′'):'′';
        const ink=kind==='bare'?'#977f61':kind==='ice'?'#6b969e':PAPER_INKS.park;
        mark(b,char,x,y,kind==='wood'?9.7:11,.06,(kind==='wood'?.53:kind==='bare'?.53:.47)*(1-.37*region),ink);
      }
    }
    if(areaStations(w,h,matrix,station,Math.sqrt(dx*dy)))return;
    // Standalone callers can supply their own projection functions and omit
    // the camera matrix. Keep their original projected-pixel lattice.
    const xOrigin=w/2-mx,yOrigin=h/2-my;
    const r0=Math.floor(-yOrigin/dy)-1,r1=Math.ceil((h-yOrigin)/dy)+1;
    const c0=Math.floor(-xOrigin/dx)-2,c1=Math.ceil((w-xOrigin)/dx)+1;
    for(let row=r0;row<=r1;row++)for(let col=c0;col<=c1;col++){
      if(b!=='interior'&&(counts[b]||0)>=quota[b])return;
      const u=col*.31+row*.11,v=col*.09-row*.37;
      const x=xOrigin+(col+mod(row,2)*.43)*dx,y=yOrigin+row*dy+Math.sin(u)*dy*.23;
      if(x>=0&&x<=w&&y>=0&&y<=h)station(x,y,u,v,mod(Math.imul(col,73856093)^Math.imul(row,19349663),11),1);
    }
  }
  if(urbanMask)pattern('urban',urbanMask,8.4-region*2.65,8.2-region*2.5);
  if(waterRings.length&&!areaStations(w,h,matrix,printWave))pattern('water',water,12.9,13.8);
  for(const [kind,mask] of covers){
    if(kind==='wood'&&region){
      const pitch=Math.max(11.5,Math.sqrt(area*mask.fraction()*.86/(quota.park*.9)));
      pattern('park',mask,15+(pitch-15)*region,16.5+(pitch*1.09-16.5)*region,kind);
    }else pattern('park',mask,kind==='wood'?15:16,kind==='wood'?16.5:17.8,kind);
  }
  if(buildingInteriors)pattern('interior',buildingInteriors,15.5,16.5);
  for(const [x,y] of peaks)if(!water.has(x,y)&&!space.covers(x,y+3,1)&&(!weight||!markUsed('summit',x,y,31*weight)))emit('land','∧',x,y+3,13-weight*2,0,.84-weight*.29,PAPER_INKS.coast);
  terrain?.({w,h,z,llAt,wet:(x,y)=>water.has(x,y),textAt:(x,y)=>space.covers(x,y,6),blocked:(x,y)=>water.has(x,y)||space.covers(x,y,6),emit});
  if(z>=8&&Object.values(counts).reduce((sum,n)=>sum+n,0)<5)graticule({w,h,xy,llAt,emit});
  return {type:'FeatureCollection',features:[...batches.values()],meta:{counts,sourceFeatures:features.length,labels:nLabels,zoom:z,
    duplicateRoadStations:corridors?.omitted||0,majorRoadMarks:roadInk[0].used+roadInk[1].used,localRoadMarks:roadInk[2].used,roadClasses,parkEdgeMarks,madridBoundaryMarks,ignAreas:administrativeAreas.length,anchors}};
}
