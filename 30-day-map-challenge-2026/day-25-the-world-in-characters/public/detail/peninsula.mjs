// A typeset intercity plate. All line stations and point anchors are WGS84;
// spacing, label clearance and glyph angles are measured in CSS pixels.
import {wordKey,wordKeys} from './word-identity.mjs?v=continuous-zoom-1';
import {loadIberiaPlaces} from './iberia-middle.mjs?v=regional-reading-1';

let pending,wide;
export function residentPeninsula(){return wide||pending;}
async function resource(file){
  const r=await fetch(new URL(file,import.meta.url));
  if(!r.ok)throw Error('Peninsular geography unavailable: '+file);
  return file.endsWith('.gz')?new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json():r.json();
}
function indexed(rows){
  return rows.map(row=>{
    let w=180,s=90,e=-180,n=-90;
    for(const [x,y] of row.arr){w=Math.min(x,w);e=Math.max(x,e);s=Math.min(s,y);n=Math.max(n,y);}
    return {...row,bounds:[w,s,e,n]};
  });
}
export function loadPeninsula(camera){
  const bounds=camera.bounds;
  pending??=Promise.all([loadIberiaPlaces(),resource('./iberia-network.json.gz'),resource('./iberia-elevation.gz')]).then(([places,net,relief])=>({
    ...places,coasts:indexed(net.coasts),borders:indexed(net.borders),roads:indexed(net.roads),
    rivers:indexed(places.rivers),boundaries:indexed(places.boundaries),relief:indexed(relief)
  })).catch(e=>{pending=undefined;throw e;});
  // The first flat frame can include the British Isles, Scandinavia and the
  // Sahara. Only broad frames need the small-scale geography beyond the sheet.
  if(camera.z>=4.8&&bounds[0]>=-35&&bounds[1]>=18&&bounds[2]<=24&&bounds[3]<=62)return pending;
  wide??=Promise.all([pending,resource('./iberia-surrounds.gz')]).then(([core,outer])=>({
    ...core,...Object.fromEntries(['coasts','borders','rivers','roads'].map(key=>[key,core[key].concat(indexed(outer[key]))]))
  })).catch(e=>{wide=undefined;throw e;});
  return wide;
}
const seas=[
  ['Océano Atlántico',-13.65,38.9,31,-12],['Golfo de Vizcaya',-4.15,45.0,21,7],
  ['Mar Mediterráneo',5.05,38.65,24,-10],['Golfo de Cádiz',-7.48,36.35,15,-8],
  ['Mar de Alborán',-3.65,35.70,16,-7],['Mar Balear',2.15,39.85,15,-19],
  ['La Manche',-2.5,49.8,17,-8],['Golfe du Lion',4.65,42.6,16,0]
];
const ranges=[
  ['Pirineos',.65,42.69,9],['Cordillera Cantábrica',-5.1,43.05,4],
  ['Sierra Morena',-4.9,38.33,-7],['Sierra Nevada',-3.2,37.05,-4],
  ['Rif',-4.58,35.01,-9],['Haut Atlas',-7.0,31.63,-18],['Massif central',3.07,45.38,-24]
];
const colors={coast:'#254f4b',border:'#6d5574',region:'#8a758a',road:'#985236',minorRoad:'#a87754',river:'#367e88',water:'#468693',city:'#25453d',area:'#7c697b',mountain:'#677956'};
const rad=Math.PI/180,intersects=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
const upper=s=>s.toLocaleUpperCase('es');
const keepUpright=a=>a>90?a-180:a< -90?a+180:a;
function makeSpace(){
  const cells=new Map(),step=48;
  function visit(x,y,w,h,fn){
    for(let j=Math.floor((y-h)/step);j<=Math.floor((y+h)/step);j++)for(let i=Math.floor((x-w)/step);i<=Math.floor((x+w)/step);i++){
      if(fn(i+','+j))return true;
    }
    return false;
  }
  return {
    intersects(x,y,w,h,angle=0){
      const c=Math.cos(angle*rad),s=Math.sin(angle*rad),hw=w*Math.abs(c)+h*Math.abs(s),hh=w*Math.abs(s)+h*Math.abs(c);
      return visit(x,y,hw,hh,k=>cells.get(k)?.some(b=>{
        const dx=x-b.x,dy=y-b.y,cs=Math.abs(c*b.c+s*b.s),sn=Math.abs(c*b.s-s*b.c);
        return Math.abs(dx*c+dy*s)<w+b.w*cs+b.h*sn&&Math.abs(dy*c-dx*s)<h+b.w*sn+b.h*cs&&
          Math.abs(dx*b.c+dy*b.s)<b.w+w*cs+h*sn&&Math.abs(dy*b.c-dx*b.s)<b.h+w*sn+h*cs;
      }));
    },
    add(x,y,w,h,angle=0){
      const c=Math.cos(angle*rad),s=Math.sin(angle*rad),b={x,y,w,h,c,s};
      visit(x,y,w*Math.abs(c)+h*Math.abs(s),w*Math.abs(s)+h*Math.abs(c),k=>{if(!cells.has(k))cells.set(k,[]);cells.get(k).push(b);});
    }
  };
}
export function peninsulaGlyphs(sheet,ctx,priorLabels=[],priorCamera){
  const {project,unproject,width:w,height:h,zoom:z,bounds}=ctx;
  const ramp=(low,high)=>{const t=Math.max(0,Math.min(1,(z-low)/(high-low)));return t*t*(3-2*t);};
  const labelScale=.72+.17*ramp(3.52,4.65)+.11*ramp(4.63,5.22);
  const backbone=ramp(3.73,4.85),adminDetail=ramp(4.23,4.89);
  const roadDetail=ramp(4.72,5.21),riverDetail=ramp(4.68,5.22);
  const ink=new Map(),space=makeSpace(),letterInk=makeSpace(),citySpace=makeSpace(),pad=ctx.pad;
  const inside=(x,y,m=0)=>x>=-m&&y>=-m&&x<=w+m&&y<=h+m;
  function emit(b,t,s,e,a,c,ll,station,alias){
    const style=[b,t,s,e,a,c].join('|');
    const key=station||alias?style+'|'+(station||'')+'|'+(alias||''):style;
    let f=ink.get(key);
    if(!f){const properties={b,t,s,e,a,c};if(station)properties.station=station;if(alias)properties.alias=alias;
      f={type:'Feature',properties,geometry:{type:'MultiPoint',coordinates:[]}};ink.set(key,f);}
    f.geometry.coordinates.push(ll);
  }
  const onPage=(x,y)=>x>=pad&&x<=w-pad&&y>=pad&&y<=h-pad;
  const narrow=ctx.w<560;
  const previous=new Map(),previousPlaces=new Map();
  if(priorCamera?.projection===ctx.projection&&
     priorCamera.w===ctx.w&&priorCamera.h===ctx.h&&Math.abs(priorCamera.z-z)<=1.6&&
     Math.abs(priorCamera.bearing-ctx.bearing)<1){
    const [cx,cy]=project([priorCamera.lon,priorCamera.lat]);
    if(Math.abs(cx-w/2)<ctx.w&&Math.abs(cy-h/2)<ctx.h){
      for(const mark of priorLabels){
        const [x,y]=project(mark.ll);
        const anchor={x,y,angle:mark.e||0};
        for(const key of wordKeys(mark.b,mark.t,mark.alias)){
          if(onPage(x,y))previous.set(key,anchor);
          if((mark.b==='place'||mark.b==='settlement')&&inside(x,y))previousPlaces.set(key,anchor);
        }
      }
    }
  }
  // Try the previously visible position within the current feature's valid
  // anchors. The normal collision, hierarchy and viewport tests still decide.
  function prefer(options,old,pixelAt,tolerance=12){
    if(!old||options.length<2)return options;
    let best=-1,distance=tolerance*tolerance;
    for(let i=0;i<options.length;i++){
      const [x,y,angle]=pixelAt(options[i]);
      if(angle!==undefined&&Math.abs(keepUpright(angle-old.angle))>24)continue;
      const d=(x-old.x)**2+(y-old.y)**2;
      if(d<distance){distance=d;best=i;}
    }
    if(best<=0)return options;
    return [options[best],...options.slice(0,best),...options.slice(best+1)];
  }
  function write(text,role,x,y,size,angle,color,alpha=1,margin=3,fit=false,station,alias){
    const length=[...text].reduce((sum,ch)=>sum+('MWm@'.includes(ch)?.79:'ilíì .,’'.includes(ch)?.27:ch===ch.toUpperCase()&&ch!==ch.toLowerCase()?.61:.48),0)*size;
    const c=Math.abs(Math.cos(angle*rad)),s=Math.abs(Math.sin(angle*rad));
    const hw=(length*c+size*s)/2+margin,hh=(length*s+size*c)/2+margin;
    if(fit&&(x-hw<pad+2||x+hw>w-pad-2||y-hh<pad+2||y+hh>h-pad-2))return false;
    if(!inside(x,y,4)||space.intersects(x,y,length/2+margin,size*.50+margin,angle))return false;
    emit(role,text,size,angle,alpha,color,unproject([x,y]),station,alias);
    space.add(x,y,length/2+margin,size*.5+margin,angle);
    letterInk.add(x,y-size*.09,length*.47,size*.34,angle);return true;
  }
  const cities=sheet.cities.slice();
  for(const c of sheet.labels.cities){
    const [x,y]=c.point;
    if(x>=-12&&x<=8.5&&y>=30.5&&y<=48.5)continue;
    if(cities.some(a=>Math.abs(a.point[0]-x)+Math.abs(a.point[1]-y)<.25))continue;
    cities.push({...c,rank:c.population>=2e6?1:c.population>=5e5?2:4});
  }
  cities.sort((a,b)=>a.rank-b.rank||b.population-a.population);
  const cityStarts={'Barcelona':3.3,'Sevilla':3.55,'Porto':3.73,'Bordeaux':3.85,'Lyon':3.90,'Toulouse':3.97,'Nantes':4.09,'Bilbao':4.03,'Vigo':4.09,'Valencia':4.13,'Cáceres':4.33,'Badajoz':4.49};
  function cityStart(c){
    if(c.rank===0)return 0;
    if(Object.hasOwn(cityStarts,c.name))return cityStarts[c.name];
    if(c.rank===1)return c.population>=2e6?3.45:4.08+Math.abs(c.point[0]%1)*.3;
    if(c.rank===2)return 4.42+Math.abs(c.point[1]%1)*.42;
    return 4.62+Math.abs(c.point[0]%1)*.35;
  }
  const visibleCities=cities.filter(c=>z>=cityStart(c)).map(c=>({...c,xy:project(c.point)})).filter(c=>inside(...c.xy,5));
  function city(c){
    let rank=c.rank;
    if(c.name==='Andorra la Vella')rank=3;
    const [x,y]=c.xy,gap=rank===0?7.6:rank===1?6:4.8;
    const size=(rank===0?23:rank===1?18.5:rank===2?16:rank===3?14.2:12.8)*labelScale;
    if(citySpace.intersects(x,y,rank<=1?7:12,rank<=1?6:9))return;
    const half=size*c.name.length*.245;
    const positions=[[1,-.40],[-1,-.40],[1,.52],[-1,.52],[0,-.94],[0,1.03]];
    if(narrow&&z<4.8&&rank===0)positions.push([-.4,1.14],[-.6,-1.12],[.5,1.16],[0,1.48]);
    const pixels=([dx,dy])=>[x+dx*(half+gap),y+dy*size];
    for(const p of prefer(positions,previousPlaces.get(wordKey('place',c.name)),pixels,Math.max(16,half*.85))){
      if(write(c.name,'place',...pixels(p),size,0,colors.city,1,2,onPage(x,y),c.point)){
        citySpace.add(x,y,rank<=1?18:15,rank<=1?13:10);
        const mark=rank===0?26:rank===1?23:rank===2?20:16;
        emit('townDot','·',mark,0,1,colors.city,c.point);
        if(rank===0&&c.population>250000)emit('townDot','o',13.7,0,.96,colors.city,c.point);
        return;
      }
    }
  }
  const tier=(c)=>c.name==='Andorra la Vella'?3:c.rank;

  const preferred={
    ESP:{text:'ESPAÑA',size:narrow?29:35,angle:0,points:[[-3.22,39.63],[-4.02,39.67],[-4.45,40.30],[-3.85,38.94],[-4.04,40.97]]},
    PRT:{text:'PORTUGAL',size:narrow?21.5:24.5,angle:-74,points:[[-8.01,39.83],[-7.89,40.08],[-7.77,39.57],[-8.25,40.03]]},
    MAR:{text:'MAROC',size:30,angle:0,points:[[-6.42,32.38],[-6.63,31.94]]},
    DZA:{text:'ALGÉRIE',size:29,angle:0,points:[[2.05,33.63],[2.75,34.2]]}
  };
  for(const c of sheet.labels.countries){
    if(c.rank>4&&!preferred[c.code]||c.code==='AND')continue;
    const opts=preferred[c.code]||{text:upper(c.name),size:c.rank<=2?32:22,angle:0,points:[c.point]};
    for(const ll of prefer(opts.points,previous.get(wordKey('place',opts.text))||previous.get(wordKey('place',c.name)),project)){
      if(write(opts.text,'place',...project(ll),opts.size*labelScale,opts.angle,'#294d43',1,4,onPage(...project(ll)),undefined,c.name!==opts.text?c.name:undefined))break;
    }
  }
  visibleCities.filter(c=>tier(c)<=1).forEach(city);
  for(const [text,x,y,size,angle] of seas){
    if(size<17&&z<4.80+(17-size)*.08)continue;
    write(text,'waterLabel',...project([x,y]),size*labelScale,angle,'#377681',.97,4,narrow&&z<4.8);
  }

  const regionalNames=['Extremadura','Andalucía','Castilla y León','Castilla-La Mancha','Galicia','Aragón','Catalunya','Navarra','Asturias','Murcia','Comunitat Valenciana'];
  const areas=sheet.areas.filter(a=>regionalNames.includes(a.name)).sort((a,b)=>regionalNames.indexOf(a.name)-regionalNames.indexOf(b.name));
  for(const area of areas){
    if(z<4.66+regionalNames.indexOf(area.name)*.036&&area.name!=='Galicia')continue;
    for(const [lon,lat,km] of prefer(area.anchors,previous.get(wordKey('regionLabel',area.name)),project)){
      const [x,y]=project([lon,lat]),s=area.name.length>13?12.6:13.6;
      if(km<16||!inside(x,y)||visibleCities.some(c=>tier(c)<=1&&Math.hypot(c.xy[0]-x,c.xy[1]-y)<19))continue;
      if(write(upper(area.name),'regionLabel',x,y,s,0,colors.area,1,3))break;
    }
  }
  const projected=rows=>rows.filter(r=>intersects(bounds,r.bounds)).map(r=>({...r,screen:r.arr.map(project)}));
  const rivers=projected(sheet.rivers).filter(r=>r.rank===1||riverDetail>.03),roads=projected(sheet.roads).filter(r=>r.rank===1||roadDetail>.03);
  // Traverse at fixed distances along the mapped path to place lettering on
  // long, gently turning reaches, with a local tangent instead of a compass guess.
  function candidates(path,minLength){
    const out=[],pts=path.screen;let length=0,next=minLength*.52,j=0;
    const lens=[0];
    for(let i=1;i<pts.length;i++){length+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);lens.push(length);}
    if(length<minLength)return out;
    const at=(d,from)=>{let i=from;while(i<pts.length-2&&lens[i+1]<d)i++;const f=(d-lens[i])/(lens[i+1]-lens[i]||1);return [pts[i][0]+f*(pts[i+1][0]-pts[i][0]),pts[i][1]+f*(pts[i+1][1]-pts[i][1])];};
    for(;next<length-minLength*.42;next+=Math.max(13,minLength*.36)){
      while(j<pts.length-2&&lens[j+1]<next-minLength*.4)j++;
      const a=at(next-minLength*.4,j),b=at(next+minLength*.4,j),p=at(next,j);
      if(!inside(...p)||Math.hypot(b[0]-a[0],b[1]-a[1])<minLength*.45)continue;
      const angle=keepUpright(Math.atan2(b[1]-a[1],b[0]-a[0])/rad);
      if(Math.abs(angle)>68)continue;
      const visible=p[0]>=pad+20&&p[0]<=w-pad-20&&p[1]>=pad+15&&p[1]<=h-pad-15;
      out.push({p,angle:Math.round(angle/3)*3,score:(visible?500:0)+Math.min(minLength*2,length)-Math.abs(angle)*.52-Math.abs(next/length-.5)*12});
    }
    return out;
  }
  const lineWords=(rows,river)=>{
    const choices=new Map();
    for(const r of rows){
      if(!r.name||(!river&&r.rank!==1)||(river&&r.rank>2))continue;
      if(river){
        const start=r.name==='Garonne'?3.95:r.name==='Loire'?4.08:4.17+Math.min(.49,r.name.length*.045);
        if(z<start)continue;
      }
      const pool=choices.get(r.name)||[];
      pool.push(...candidates(r,river?Math.max(38,r.name.length*6.5):48));choices.set(r.name,pool);
    }
    const important=river?['Guadiana','Tajo','Tejo','Duero','Douro','Guadalquivir','Ebro','Miño']:['A-5','A-2','A-4','A-6','A1','A-3'];
    const priority=n=>important.includes(n)?important.indexOf(n):important.length;
    const pool=[...choices].map(([name,cs])=>[name,cs.sort((a,b)=>b.score-a.score)]).sort((a,b)=>priority(a[0])-priority(b[0])||(b[1][0]?.score||0)-(a[1][0]?.score||0));
    const spacing=makeSpace();
    for(const [name,positions] of pool){
      const role=river?'waterLabel':'roadLabel',old=previous.get(wordKey(role,name)),gap=river?8.8:7.5;
      function position(station){
        const [x,y]=station.p,a=station.angle*rad;
        const side=old&&(old.y-y)*Math.cos(a)-(old.x-x)*Math.sin(a)>0?1:-1;
        return [x-Math.sin(a)*gap*side,y+Math.cos(a)*gap*side,station.angle];
      }
      for(const station of prefer(positions,old,position,22)){
        const {p:[x,y],angle}=station;
        if(spacing.intersects(x,y,river?27:50,river?16:31))continue;
        const s=river?14.4:10.3,a=angle*rad;
        const near=old&&Math.hypot(x-old.x,y-old.y)<24&&
          (old.y-y)*Math.cos(a)-(old.x-x)*Math.sin(a)>0;
        const placed=(near?[1,-1]:[-1,1]).some(side=>{
          const offset=gap*side;
          return write(name,role,x-Math.sin(a)*offset,y+Math.cos(a)*offset,s,angle,river?'#367681':'#8c563b',.98,2,onPage(x,y),unproject([x,y]));
        });
        if(placed){spacing.add(x,y,river?27:53,river?14:30);break;}
      }
    }
  };
  // The Guadiana is the geographic axis of the western interior.
  lineWords(rivers.filter(r=>r.name==='Guadiana'),true);
  visibleCities.filter(c=>tier(c)===2).forEach(city);
  lineWords(rivers.filter(r=>r.name!=='Guadiana'),true);
  if(z>=4.84)lineWords(roads,false);
  const maritime=new Set(['A Coruña','Cádiz','Faro','Palma']);
  visibleCities.filter(c=>tier(c)===3&&(c.population>=135000||maritime.has(c.name))).forEach(city);
  visibleCities.filter(c=>z>5.13+Math.min(.22,Math.abs(c.point[0]%1)*.24)&&tier(c)===3&&c.population<135000&&!maritime.has(c.name)&&citySpace.intersects(...c.xy,27,19)===false).forEach(city);
  for(const [t,lon,lat,angle] of ranges)if(z>4.48)write(t,'terrainName',...project([lon,lat]),13.4,angle,'#687857',.90,3);

  const seen=new Map();
  function trace(path,pen){
    const pts=path.screen||path.arr.map(project),step=pen.step;
    let carry=step*.37,idx=0;
    let occupied=seen.get(pen.group);
    if(!occupied){occupied=new Set();seen.set(pen.group,occupied);}
    for(let i=1;i<pts.length;i++){
      const a=pts[i-1],b=pts[i],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
      if(!len)continue;
      const angle=Math.round(keepUpright(Math.atan2(dy,dx)/rad)/5)*5;
      if(Math.max(a[0],b[0])>=-8&&Math.min(a[0],b[0])<=w+8&&Math.max(a[1],b[1])>=-8&&Math.min(a[1],b[1])<=h+8){
        for(let d=carry,station=idx;d<len;d+=step,station++){
          const x=a[0]+d/len*dx,y=a[1]+d/len*dy;
          if(!inside(x,y,6)||letterInk.intersects(x,y,1.15,1))continue;
          const key=Math.floor((x+8)/3)+Math.ceil((w+20)/3)*Math.floor((y+8)/3);
          if(occupied.has(key))continue;
          occupied.add(key);const t=pen.alt&&station%pen.every===0?pen.alt:pen.t;
          emit(pen.b,t,pen.s,angle,pen.a,pen.c,unproject([x,y]));
        }
      }
      idx+=Math.max(0,Math.ceil((len-carry)/step));
      carry=((carry-len)%step+step)%step;
    }
  }
  const drawRows=(rows,pen)=>{for(const r of rows)if(intersects(bounds,r.bounds))trace(r,typeof pen==='function'?pen(r):pen);};
  const landDetail=.45+.55*backbone,seaDetail=.40+.60*backbone;
  drawRows(sheet.relief,({level})=>level<0?
    {group:'depth',b:'bathymetry',t:'~',s:level===-250?11:10.4,step:(level===-250?10.4:13.4)/(.76+.24*backbone),a:(level===-250?.60:level===-4500?.31:.43)*seaDetail,c:'#4d8a95'}:
    {group:'slope',b:'land',t:level>=1300?'–':'·',alt:level>=1900?'∧':null,every:5,s:level>=1900?9.5:9.0,step:(level>=1300?6.8:6.2)/(.69+.31*backbone),a:(level>=1300?.63:.43)*landDetail,c:level>=1900?'#627459':'#74836b'});
  drawRows(roads,r=>({group:'road',b:'road',t:r.rank===1?'–':'-',s:r.rank===1?11:9.6,step:r.rank===1?5.7+3.2*(1-backbone):7.35,a:r.rank===1?.20+.75*backbone:.62*roadDetail,c:r.rank===1?colors.road:colors.minorRoad}));
  drawRows(rivers,r=>({group:'river',b:'river',t:'~',s:r.rank===1?11.7:9.6,step:r.rank===1?6.5+1.9*(1-backbone):7.6,a:r.rank===1?.50+.47*backbone:.64*riverDetail,c:colors.river}));
  if(adminDetail>.02)drawRows(sheet.boundaries,{group:'admin',b:'border',t:'-',alt:'·',every:3,s:9.4,step:5.7,a:.72*adminDetail,c:colors.region});
  drawRows(sheet.borders,{group:'national',b:'border',t:'━',alt:'·',every:4,s:10.2,step:5.65,a:narrow?.86:.92,c:colors.border});
  drawRows(sheet.coasts,{group:'shore',b:'coast',t:'–',s:13.2,step:5.65,a:1,c:colors.coast});
  return {type:'FeatureCollection',features:[...ink.values()]};
}
