// Continental and country plates. Geometry comes from Natural Earth, and terrain
// texture is a sampled ETOPO elevation field; only characters leave this compositor.
import {metroWeight} from './metropolitan.mjs?v=continuous-zoom-1';
const load=name=>fetch(new URL(name,import.meta.url)).then(r=>{if(!r.ok)throw Error('Regional data unavailable');return r.json();});
const color={water:'#33747d',coast:'#294640',border:'#9a543b',river:'#427a86',road:'#82543b',place:'#243e37',waterLabel:'#326d76',settlement:'#714933'};
const compact=(value,step)=>Math.round(value/step)*step;
const mod=(value,base)=>(value%base+base)%base;
const hash=(a,b)=>Math.abs(Math.sin(a*18.7+b*33.5)*1851)%1;
const landText=['·',':','′','∧','^'];
const oceanLabels=[['North Pacific',-146,28],['South Pacific',-122,-26],['North Atlantic',-40,29],['South Atlantic',-25,-27],['Indian Ocean',78,-27],['Southern Ocean',18,-60],['Arctic Ocean',57,84.5]];
const localNames={'United States of America':'United States','Democratic Republic of the Congo':'DR Congo','Republic of the Congo':'Congo','United Republic of Tanzania':'Tanzania','Republic of Korea':'South Korea'};
let loading;
export function loadRegion(){
  if(!loading)loading=Promise.all([load('./natural-earth.json'),load('./land-mask.json'),load('./relief.json'),load('./streams.json')]).then(([geo,mask,relief,streams])=>{
    mask.bytes=Uint8Array.from(atob(mask.bits),c=>c.charCodeAt(0));relief.bytes=Uint8Array.from(atob(relief.data),c=>c.charCodeAt(0));
    const line=(arr)=>{let west=180,east=-180,south=90,north=-90;for(const [x,y] of arr){west=Math.min(west,x);east=Math.max(east,x);north=Math.max(north,y);south=Math.min(south,y);}return{arr,west,east,south,north};};
    const lines=[...geo.land.map(a=>({...line(a),b:'coast'})),...geo.landHoles.map(a=>({...line(a),b:'river'})),...geo.boundaries.map(a=>({...line(a),b:'border'})),...geo.rivers.map(f=>({...line(f.path),b:'river',name:f.name})),...geo.roads.map(f=>({...line(f.path),b:'road',name:f.name})),...streams.filter(([level])=>mod(level,4)===1).map(([level,a])=>({...line(a),b:'water',level}))];
    return {geo,mask,relief,lines};
  }).catch(e=>{loading=null;throw e;});
  return loading;
}
export function regionGlyphs(data,{project,unproject,width,height,zoom,bounds,navigation,matrix,lon}){
  const pad=70,items=new Map(),claimed=[],textures=new Set();
  const geographic=(x,y)=>{const ll=unproject([x,y]);return [mod(ll[0]+180,360)-180,Math.max(-89.999,Math.min(89.999,ll[1]))];};
  const inside=(x,y)=>x>=-pad&&x<=width+pad&&y>=-pad&&y<=height+pad;
  const collision=(x,y,w,h)=>claimed.some(r=>x+w/2>r[0]&&x-w/2<r[2]&&y+h/2>r[1]&&y-h/2<r[3]);
  function ink(b,t,s,e,a,c,ll,unique=false){
    const k=[b,t,s,e,a,c].join('|');let f=unique?null:items.get(k);
    if(!f){f={type:'Feature',properties:{b,t,s,e,a,c},geometry:{type:'MultiPoint',coordinates:[]}};items.set(unique?k+items.size:k,f);}
    f.geometry.coordinates.push(ll);
  }
  function isLand(ll){
    const x=mod(Math.floor((ll[0]+180)*4),data.mask.width),y=Math.max(0,Math.min(data.mask.height-1,Math.floor((90-ll[1])*4)));
    const i=y*data.mask.width+x;return (data.mask.bytes[i>>3]>>(7-(i%8)))&1;
  }
  function label(t,ll,size,role,angle=0){
    const [x,y]=project(ll);if(!inside(x,y))return;
    const boxw=t.length*size*(role==='place'?.52:.55)+8,boxh=size*1.07,theta=angle*Math.PI/180;
    const wide=boxw*Math.abs(Math.cos(theta))+boxh*Math.abs(Math.sin(theta)),h=boxw*Math.abs(Math.sin(theta))+boxh*Math.abs(Math.cos(theta));
    if(collision(x,y,wide,h))return;claimed.push([x-wide/2,y-h/2,x+wide/2,y+h/2]);
    ink(role,t,size,angle,1,color[role]||color.road,ll,true);
    if(role==='settlement')ink('coast','·',15,0,1,color.road,geographic(x,y+h*.68),true);
  }
  for(const [name,x,y] of oceanLabels)label(name,[x,y],30-6*Math.max(0,Math.min(1,(zoom-3.6)/.8)),'waterLabel');
  const metro=navigation?metroWeight(zoom):0;
  const countries=(navigation&&zoom>=8?[]:data.geo.labels.countries).slice().sort((a,b)=>a.rank-b.rank);
  for(const c of countries){if(zoom<3&&c.rank>3)continue;
    label((localNames[c.name]||c.name).toUpperCase(),c.point,Math.max(14,24-c.rank*1.2),'place');}
  const cities=data.geo.labels.cities.slice().sort((a,b)=>b.population-a.population);
  for(const c of cities){
    if(zoom<=3||c.population<=Math.max(10000,5000000/Math.pow(3,zoom-3)))continue;
    const size=Math.min(15,11+Math.log10(Math.max(1,c.population))/2.5);
    const metroSize=c.population>=2000000?34:c.population>=650000?26:c.population>=240000?22:c.population>=60000?17:14;
    label(c.name,c.point,size+(metroSize-size)*metro,metro?'place':'settlement');
  }
  if(navigation){
    let placed=0;
    for(const {name,x,y,angle} of navigation.routeNames){
      const before=claimed.length;
      label(name,geographic(x,y),12,'roadLabel',Math.round(angle/3)*3);
      if(claimed.length>before&&++placed>=navigation.roadLabelLimit)break;
    }
  }
  const origin=project([matrix?.merc?180:0,0]),step=navigation?(zoom<7?17:22):zoom<4?12:15;
  for(let j=Math.floor((-pad-origin[1])/step);j<(height+pad-origin[1])/step;j++){
    const y=origin[1]+j*step;
    for(let i=Math.floor((-pad-origin[0])/step);i<(width+pad-origin[0])/step;i++){
      const x=origin[0]+(i+mod(j,2)*.5)*step,noise=hash(i,j),px=x+(noise-.5)*step*.28,py=y+(hash(j,i)-.5)*step*.26;
      if(noise<.28||collision(px,py,3,4))continue;
      const ll=geographic(px,py),back=project(ll);
      if(Math.abs(back[0]-px)>2||Math.abs(back[1]-py)>2)continue;
      if(!isLand(ll)){
        if(noise>.72&&zoom>4.2){ink('water','~',12,0,.37,color.water,ll);}
        continue;
      }
      if(navigation&&zoom>=8)continue;
      const r=data.relief,ix=mod(Math.round((ll[0]-r.west)/r.step),r.width),iy=Math.min(r.height-1,Math.max(0,Math.round((r.north-ll[1])/r.step)));
      const z=r.bytes[iy*r.width+ix]*r.metersPerUnit,p=z>2800?4:z>1350?3:z>650?2:z>220?1:0;
      ink('coast',landText[p],p>2?12:10,0,p>2?.70:.46,color.coast,ll);
    }
  }
  const [west,south,east,north]=bounds;
  const corridors=navigation?.terrain?new Set():null;
  const stride=Math.ceil((width+2*pad)/8)+1;
  const cellAt=(x,y)=>Math.floor((y+pad)/8)*stride+Math.floor((x+pad)/8);
  for(const line of data.lines){
    if(line.north<south-5||line.south>north+5||(west<east&&west>=-180&&east<=180&&(line.east<west-8||line.west>east+8)))continue;
    const b=line.b,sea=b==='water',navRoad=navigation&&b==='road',spacing=navRoad?(line.tier===0?7.2:line.tier===1?7.8:8.6)*navigation.roadSpacing:sea?12:b==='coast'?5.7:b==='border'?7:b==='river'?8:10;
    const char=sea||b==='river'?'~':navRoad?(line.tier===2?'-':'–'):b==='road'?'·':b==='coast'?'–':'-';
    let phase=0,prev=null,prior=null,priorLongitude,index=0;
    for(const ll of line.arr){
      const curr=line.screen?line.screen[index++]:project(ll);
      // Split geometry at the edge of the camera's world copy. Otherwise a
      // short Greenwich segment can appear to cross the entire Pacific.
      const longitude=matrix?.merc?mod(ll[0]-lon+180,360)-180:ll[0];
      if(prev&&Math.abs(longitude-priorLongitude)<178&&!(Math.abs(ll[0])>179.995&&Math.abs(prior[0])>179.995)&&!(ll[1]<-89.98&&prior[1]<-89.98)){
        const dx=curr[0]-prev[0],dy=curr[1]-prev[1],len=Math.hypot(dx,dy);
        if(len>.01&&Math.max(prev[0],curr[0])>=-pad&&Math.min(prev[0],curr[0])<=width+pad&&Math.max(prev[1],curr[1])>=-pad&&Math.min(prev[1],curr[1])<=height+pad){
          let first=phase,last=len;
          if(navigation){
            let from=0,to=1;
            for(const [p,q] of [[-dx,prev[0]+pad],[dx,width+pad-prev[0]],[-dy,prev[1]+pad],[dy,height+pad-prev[1]]]){
              if(p<0)from=Math.max(from,q/p);else if(p>0)to=Math.min(to,q/p);else if(q<0)to=-1;
            }
            first=phase+Math.max(0,Math.ceil((from*len-phase)/spacing))*spacing;last=to*len;
          }
          for(let d=first;d<last;d+=spacing){const x=prev[0]+dx*d/len,y=prev[1]+dy*d/len;
            if(!inside(x,y)||collision(x,y,3,3))continue;
            const coord=geographic(x,y);
            if(sea&&(isLand(coord)||Math.sin(coord[0]*.15+coord[1]*.1+line.level)>0.76))continue;
            const cell=b+' '+Math.round(x/3)+' '+Math.round(y/3);if(textures.has(cell))continue;textures.add(cell);
            if(corridors&&!sea)corridors.add(cellAt(x,y));
            ink(b,char,navRoad?(line.tier===0?11:9.6):sea?13:b==='coast'?11:10,compact(Math.atan2(dy,dx)*180/Math.PI,5),navRoad?(line.tier===0?.95:.83):sea?.58:b==='road'?.84:1,navRoad?['#974e32','#815b43','#756657'][line.tier]:color[b],coord);
          }
        }
        phase=mod(phase-len,spacing);
      }
      prev=curr;prior=ll;priorLongitude=longitude;
    }
  }
  if(corridors){
    const wet=(x,y)=>!isLand(geographic(x,y));
    navigation.terrain({w:width,h:height,z:zoom,llAt:geographic,wet,
      textAt:(x,y)=>collision(x,y,6,6),
      blocked:(x,y)=>wet(x,y)||corridors.has(cellAt(x,y))||collision(x,y,6,6),
      emit:(role,t,x,y,body,theta,alpha,c)=>{
        if(role!=='terrainName')ink(role,t,body,compact(theta*180/Math.PI,3),alpha,c,geographic(x,y));
      }});
  }
  return {type:'FeatureCollection',features:[...items.values()]};
}
