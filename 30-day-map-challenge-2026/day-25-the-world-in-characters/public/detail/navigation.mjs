// A quick, fully local chart for a moving regional camera. The publisher's
// Natural Earth road ranks and identifiers determine the lines available here.
import {regionGlyphs} from './regional.mjs?v=regional-reading-1';

let catalog;
const cache=new Map();
const origins=new WeakMap();
const mod=(n,p)=>((n%p)+p)%p;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

function catalogReady(){
  catalog??=fetch(new URL('./navigation/index.json',import.meta.url)).then(r=>{
    if(!r.ok)throw Error('Regional road index unavailable');
    return r.json();
  }).then(d=>({...d,keys:new Set(d.cells)})).catch(e=>{catalog=null;throw e;});
  return catalog;
}
function block(key){
  let value=cache.get(key);
  if(value){cache.delete(key);cache.set(key,value);return value;}
  value=fetch(new URL('./navigation/'+key+'.gz',import.meta.url)).then(async r=>{
    if(!r.ok)throw Error('Regional road block unavailable');
    const data=await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json();
    return {roads:data.r,cities:data.c};
  }).catch(e=>{if(cache.get(key)===value)cache.delete(key);throw e;});
  cache.set(key,value);
  if(cache.size>36)cache.delete(cache.keys().next().value);
  return value;
}
function inBounds(box,west,south,east,north){
  if(box[1]>north||box[3]<south)return false;
  const wrapped=Math.round(((west+east)-(box[0]+box[2]))/720)*360;
  return box[0]+wrapped<=east&&box[2]+wrapped>=west;
}
function coordinates(record){
  const packed=record[6],points=[];let x=0,y=0;
  for(let i=0;i<packed.length;i+=2){x+=packed[i];y+=packed[i+1];points.push([x/10000,y/10000]);}
  return points;
}
function navigationLines(data){
  if(!origins.has(data))origins.set(data,data.lines.filter(f=>f.b!=='road'));
  return origins.get(data);
}
function localLines(rows,ctx){
  const {bounds:[west,south,east,north],project,width,height,zoom}=ctx;
  const roads=[],cities=[],seen=new Set(),roadNames=new Map();
  for(const chunk of rows){
    for(const record of chunk.roads){
      const [id,tier,minzoom,minlabel,label,rawBox]=record;
      if(seen.has(id)||zoom*10<minzoom)continue;
      const box=rawBox.map(n=>n/10000);
      if(!inBounds(box,west,south,east,north))continue;
      seen.add(id);
      let name=label;
      const arr=coordinates(record),screen=arr.map(project);
      let visibleLength=0,best=0,candidate;
      for(let i=1;i<screen.length;i++){
        const p=screen[i-1],q=screen[i],dx=q[0]-p[0],dy=q[1]-p[1],len=Math.hypot(dx,dy);
        if(!len||Math.max(p[0],q[0])<0||Math.min(p[0],q[0])>width||Math.max(p[1],q[1])<0||Math.min(p[1],q[1])>height)continue;
        visibleLength+=Math.min(len,width);
        const x=(p[0]+q[0])/2,y=(p[1]+q[1])/2;
        if(len>best&&x>16&&x<width-16&&y>12&&y<height-12){
          best=len;let angle=Math.atan2(dy,dx)*180/Math.PI;
          if(angle>90)angle-=180;if(angle< -90)angle+=180;
          candidate={name,tier,x,y,angle};
        }
      }
      if(!visibleLength)continue;
      // At the actual label anchor near Madrid keep locally identifiable radial
      // and orbital references. Continental itinerary names can cross several regions.
      if(candidate&&label){
        const [lon,lat]=ctx.unproject([candidate.x,candidate.y]);
        if(lon>-5.1&&lon< -2.35&&lat>39.5&&lat<41.5){
          const ref=/^(M)-?(30|40|45|50)$|^(A)-?([1-6])$/.exec(label);
          name=ref?(ref[1]||ref[3])+'-'+(ref[2]||ref[4]):'';
          candidate.name=name;
        }
      }
      roads.push({arr,screen,b:'road',tier,name,west:box[0],south:box[1],east:box[2],north:box[3],visibleLength});
      if(name&&candidate&&zoom*10>=minlabel&&visibleLength>name.length*8+20){
        const old=roadNames.get(name);
        if(!old||visibleLength>old.visibleLength)roadNames.set(name,{...candidate,visibleLength});
      }
    }
    for(const [name,x,y,population,minzoom] of chunk.cities){
      const lon=x/10000,lat=y/10000;
      if(zoom+.1<minzoom/10||!inBounds([lon,lat,lon,lat],west,south,east,north))continue;
      cities.push({name,point:[lon,lat],population});
    }
  }
  roads.sort((a,b)=>a.tier-b.tier||b.visibleLength-a.visibleLength);
  const routeNames=[...roadNames.values()].sort((a,b)=>a.tier-b.tier||b.visibleLength-a.visibleLength);
  return {roads,cities,routeNames};
}
export async function navigationRegion(data,ctx,relief){
  if(ctx.projection==='mercator'){
    const original=ctx.project;
    ctx={...ctx,project:ll=>original([ll[0]+360*Math.round((ctx.lon-ll[0])/360),ll[1]])};
  }
  const db=await catalogReady(),step=db.cellDegrees,[west,south,east,north]=ctx.bounds;
  const y0=clamp(Math.floor((90-north)/step),0,180/step-1),y1=clamp(Math.floor((90-south)/step),0,180/step-1);
  const x0=Math.floor((west+180)/step),x1=Math.min(x0+360/step-1,Math.floor((east+180)/step));
  const blocks=[];
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const key=mod(x,360/step)+'-'+y;if(db.keys.has(key))blocks.push(block(key));
  }
  const {roads,cities,routeNames}=localLines(await Promise.all(blocks),ctx);
  const base=navigationLines(data).filter(f=>inBounds([f.west,f.south,f.east,f.north],west-.2,south-.2,east+.2,north+.2));
  const labels={countries:ctx.zoom<7.3?data.geo.labels.countries:[],cities};
  const size=ctx.width*ctx.height;
  const roadSpacing=clamp(roads.reduce((n,f)=>n+f.visibleLength,0)/(size/230*7.7),1,2.2);
  // The large-scale terrain is shared with the final chart. Never hold up
  // the first routes waiting for a cold elevation block.
  const terrain=ctx.zoom>=8&&ctx.zoom<=10.25&&relief?
    await Promise.race([relief,new Promise(resolve=>setTimeout(resolve,12))]):undefined;
  return regionGlyphs({...data,geo:{...data.geo,labels},lines:[...base,...roads]},{
    ...ctx,navigation:{terrain,routeNames,roadSpacing,roadLabelLimit:clamp(Math.round(size/48000),2,24)}
  });
}
