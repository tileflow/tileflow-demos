// Supplemental surveyed boundaries. The published catalog supplies the general
// admin layer everywhere; this edition also has Madrid's 21 municipal districts.
const madrid=[-3.90,40.30,-3.50,40.66];
const intersects=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
let load;
function loadMadrid(){
  load??=fetch(new URL('./madrid-districts.json',import.meta.url)).then(r=>{
    if(!r.ok)throw Error('Municipal district data unavailable');return r.json();
  }).then(data=>{
    const f=[];
    for(const [owners,x,y,...rest] of data.arcs){
      let a=x,b=y;const coords=[[a*data.unit,b*data.unit]];
      for(let i=0;i<rest.length;i+=2){a+=rest[i];b+=rest[i+1];coords.push([a*data.unit,b*data.unit]);}
      const bbox=[Infinity,Infinity,-Infinity,-Infinity];
      for(const [lon,lat] of coords){bbox[0]=Math.min(bbox[0],lon);bbox[1]=Math.min(bbox[1],lat);bbox[2]=Math.max(bbox[2],lon);bbox[3]=Math.max(bbox[3],lat);}
      f.push({type:'Feature',bbox,properties:{_layer:'municipal_district',admin_level:owners===1?8:9},geometry:{type:'LineString',coordinates:coords}});
    }
    for(const [name,anchors] of data.labels)for(const [alternate,[x,y]] of anchors.entries()){
      const lon=x*data.unit,lat=y*data.unit;
      f.push({type:'Feature',bbox:[lon,lat,lon,lat],properties:{_layer:'district_label',name,class:'borough',alternate},geometry:{type:'Point',coordinates:[lon,lat]}});
    }
    return f;
  }).catch(e=>{load=undefined;throw e;});
  return load;
}
export async function cityBoundaries(bounds,z){
  if(z<10||z>15.8||!bounds||!intersects(bounds,madrid))return [];
  try{return (await loadMadrid()).filter(f=>intersects(f.bbox,bounds));}
  catch(e){console.warn('Madrid districts',e);return [];}
}
