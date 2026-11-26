// At the extent of an intercity map, administrative ink has its own hue
// and rhythm. All stations follow the actual boundary from the vector tile.
const mix=(a,b,t)=>a+(b-a)*t;
function inkBetween(a,b,t){
  if(t===1)return b;
  const x=parseInt(a.slice(1),16),y=parseInt(b.slice(1),16);
  let rgb=0;
  for(const shift of [16,8,0])rgb|=Math.round(mix(x>>shift&255,y>>shift&255,t))<<shift;
  return '#'+rgb.toString(16).padStart(6,'0');
}
export function boundaryPen(level,p,weight,disputed){
  if(!weight||level>4)return p;
  const national=level<=2,w=weight;
  return {...p,char:'━',alternate:disputed?'·':national?'–':'·',period:disputed?2:national?4:5,
    color:inkBetween(p.color,national?'#654d71':'#816385',w),
    size:mix(p.size,national?11.6:9.9,w),step:mix(p.step,national?6.7:6.10,w),
    alpha:mix(p.alpha,national?.96:.94,w),order:national?7:5};
}

let regions;
export async function regionalAreas(bounds,z){
  if(z<=5.68||z>=8.6||bounds[0]>4.6||bounds[2]<-18.3||bounds[3]<27.3||bounds[1]>44)return [];
  regions??=fetch(new URL('./iberia-regions.json?v=regional-20261125b',import.meta.url)).then(r=>{
    if(!r.ok)throw Error('Regional name anchors unavailable');
    return r.json();
  }).catch(err=>{regions=undefined;throw err;});
  return (await regions).filter(({bbox:b})=>b[0]<=bounds[2]&&b[2]>=bounds[0]&&b[1]<=bounds[3]&&b[3]>=bounds[1]);
}
const compact=s=>s.normalize('NFD').replace(/\p{Mark}/gu,'').toLowerCase().replace(/[^a-z]/g,'');
export function matchingArea(name,regions){
  const n=compact(name);
  return regions.some(r=>[r.name,...(r.aliases||[])].some(a=>{const k=compact(a);return k===n||Math.min(k.length,n.length)>=5&&(k.includes(n)||n.includes(k));}));
}

export function placeAreaNames(areas,{xy,width,height,region,weight,candidate,pad=0,density,centres,urban}){
  if(region<.045)return;
  for(const area of areas){
    const capitalRegion=area.name==='Comunidad de Madrid',name=capitalRegion?'COMUNIDAD\nDE MADRID':area.name.toLocaleUpperCase('es');
    const size=(capitalRegion?14.4:15.7)*(.91+.09*region);
    const longest=Math.max(...name.split('\n').map(s=>Array.from(s).length));
    const minHalf=Math.min(70,Math.max(20,longest*size*.224)),anchors=[];
    // A glyph can straddle the line even when its centre lies within its region.
    // Prefer stations whose measured distance to the real boundary fits the word.
    for(const [lon,lat,clearance] of area.anchors){
      const [x,y]=xy([lon,lat]);if(x<minHalf||x>width-minHalf||y<20||y>height-20)continue;
      const [ex,ey]=xy([lon+.10,lat]),pxKm=Math.hypot(ex-x,ey-y)/(11.132*Math.cos(lat*Math.PI/180));
      const free=clearance*pxKm;
      if(free<Math.min(11,minHalf*.28))continue;
      const d=Math.hypot((x-width/2)/width,(y-height/2)/height);
      const nearCity=centres.reduce((n,c)=>Math.min(n,Math.hypot(x-c.x,y-c.y)),Infinity);
      const overRoads=density({x,y,extX:minHalf,extY:size*(capitalRegion?1.04:.57)});
      const outside=x<pad+minHalf||x>width-pad-minHalf||y<pad+size||y>height-pad-size;
      const score=(outside?12:0)+(urban?.has(x,y)?3:0)+Math.max(0,82-nearCity)/15+
        Math.max(0,minHalf-free)/minHalf*3+Math.min(60,overRoads)*.045+d*.3;
      anchors.push({x,y,score});
    }
    anchors.sort((a,b)=>a.score-b.score);
    for(const [i,a] of anchors.entries())candidate(name,'regionLabel',(capitalRegion?1.3:2.5)+i*.085,size,a.x,a.y,0,5000,'#75627d',false,{opacity:Math.min(1,weight*region*3),area:true});
  }
}
