import {surfaceRiverRuns} from './surface-rivers.js';
import {waterSurface} from './water-surface.js';
import {linearInk} from './glyph-contours.js';
// Layout is baked in CSS pixels around a reference camera. The GPU moves this sheet
// during gestures; only a change of coverage, typesize or level of detail needs a new one.
export function mercator([lon,lat]) {
  return [(lon+180)/360,(1-Math.asinh(Math.tan(Math.max(-85.05113,Math.min(85.05113,lat))*Math.PI/180))/Math.PI)/2];
}
export function camera(map) {
  const c=map.getCanvas(), [x,y]=mercator(map.getCenter().toArray());
  return {x,y,z:map.getZoom(),w:c.clientWidth,h:c.clientHeight};
}
export function registration(sheet,view) {
  const scale=2**(view.z-sheet.z), world=512*2**view.z;
  return [view.w/2-sheet.w*scale/2+(sheet.x-view.x)*world,
    view.h/2-sheet.h*scale/2+(sheet.y-view.y)*world,scale];
}

const margin=115;
function chains(geometry) {
  if(geometry.type==='LineString')return [geometry.coordinates];
  if(geometry.type==='MultiPolygon')return geometry.coordinates.flat();
  if(geometry.type==='Polygon' || geometry.type==='MultiLineString')return geometry.coordinates;
  return [];
}

export function composeSheet(map,rivers,banks) {
  const view=camera(map), world=512*2**view.z;
  const left=view.x-view.w/(2*world), top=view.y-view.h/(2*world);
  const visible=(x,y)=>x>=-margin && x<=view.w+margin && y>=-margin && y<=view.h+margin;
  const picks=[],tracks=[],shore=[],ground=[],plants=[],occupiedWater=new Set();
  const project=c=>{const [x,y]=mercator(c);return [(x-left)*world,(y-top)*world];};
  function track(line,size,water=false){
    const pts=line.pts??line.coords.map(([x,y])=>[(x-left)*world,(y-top)*world]);
    tracks.push({pts,name:line.name,size,water,featured:!!line.featured});
    for(let i=1;i<pts.length;i++){
      const [x,y]=pts[i-1],dx=pts[i][0]-x,dy=pts[i][1]-y,len=Math.hypot(dx,dy);
      if(Math.max(x,x+dx)<-margin || Math.min(x,x+dx)>view.w+margin || Math.max(y,y+dy)<-margin || Math.min(y,y+dy)>view.h+margin)continue;
      picks.push({name:line.name,water,x,y,dx,dy});
      if(!water)continue;
      const steps=Math.max(1,Math.ceil(len/14));
      for(let j=0;j<=steps;j++){
        const xx=x+dx*j/steps,yy=y+dy*j/steps;
        if(visible(xx,yy))occupiedWater.add(Math.floor(xx/32)+','+Math.floor(yy/32));
      }
    }
  }
  const riverSize=(14+Math.max(0,view.z-10)*.4);
  const rank=Math.max(9,Math.floor(view.z+.85));
  if(view.z>=9)for(const line of rivers){
    const [x,y,X,Y]=line.bounds;
    if(line.rank>rank || (X-left)*world< -margin || (x-left)*world>view.w+margin ||
        (Y-top)*world< -margin || (y-top)*world>view.h+margin)continue;
    track({...line,name:line.river},riverSize,true);
  }
  if(view.z>=6){
    const features=map.querySourceFeatures('tileflow',{sourceLayer:'natural_label'});
    const authored=new Set(tracks.filter(l=>l.water).map(l=>l.name));
    const candidates=[];
    let splitSurface;
    for(const f of features){
      const {name,structure,underground}=f.properties;
      if(!name || authored.has(name) || structure==='tunnel' || underground===true || !['river','canal'].includes(f.properties.class))continue;
      splitSurface??=surfaceRiverRuns(map,project,view);
      for(const raw of chains(f.geometry))for(const pts of splitSurface(raw.map(project))){
        let length=0;
        for(let i=1;i<pts.length;i++){
          const [a,b]=pts[i-1],[c,d]=pts[i];
          if(Math.max(a,c)<0||Math.min(a,c)>view.w||Math.max(b,d)<0||Math.min(b,d)>view.h)continue;
          length+=Math.hypot(c-a,d-b);
        }
        if(length<Math.max(135,name.length*9))continue;
        if(pts[0][0]>pts.at(-1)[0])pts.reverse();
        candidates.push({name,length,pts});
      }
    }
    const names=new Set();
    for(const c of candidates.sort((a,b)=>b.length-a.length)){
      if(names.has(c.name))continue;
      track(c,13,true);names.add(c.name);if(names.size===5)break;
    }
  }
  const box=[[-65,-65],[view.w+65,view.h+65]];
  const water=map.queryRenderedFeatures(box,{layers:['tileflow-poi-render-waterShapes']});
  const surface=waterSurface(water,view,project);
  const waves=surface.marks(view.z<5?24:22,view.z<5?20:17,
    (x,y)=>!occupiedWater.has(Math.floor(x/32)+','+Math.floor(y/32)));
  const contours=linearInk(map,view,project,surface);
  // Baseline distance carries through corners and past the viewport, so the
  // shore marks keep their positions when a bank enters or leaves the view.
  if(view.z>=9)for(const {coords,bounds:[a,b,c,d]} of banks){
    if((c-left)*world< -margin||(a-left)*world>view.w+margin ||
       (d-top)*world< -margin||(b-top)*world>view.h+margin)continue;
    const spacing=18;
    let distance=0;
    for(let i=1;i<coords.length;i++){
      const [ax,ay]=coords[i-1],[bx,by]=coords[i];
      const x=(ax-left)*world,y=(ay-top)*world,dx=(bx-ax)*world,dy=(by-ay)*world;
      const length=Math.hypot(dx,dy);
      if(length && Math.max(x,x+dx)>-margin && Math.min(x,x+dx)<view.w+margin &&
         Math.max(y,y+dy)>-margin && Math.min(y,y+dy)<view.h+margin){
        const angle=(Math.atan2(dy,dx)*180/Math.PI+270)%180-90;
        for(let t=(spacing-distance%spacing)%spacing;t<length;t+=spacing){
          const px=x+dx*t/length,py=y+dy*t/length;
          if(visible(px,py))shore.push([px,py,angle]);
        }
      }
      distance+=length;
    }
  }
  if(view.z>=3.4){
    const layers=view.z<16?['tileflow-poi-render-ground','tileflow-poi-render-urbanGround']:['tileflow-poi-render-closeGreen'];
    const cover=map.queryRenderedFeatures(box,{layers});
    const gap=view.z>=16?23:view.z<8?12:15;
    stampPolygons(cover,view,project,gap,gap,(x,y,f)=>{
      const kind=f.properties.class;
      if(['wood','trees','park','garden','grass'].includes(kind)){
        if(surface.intersects(x-6,y-12,x+7,y+2))return;
        plants.push([x,y,kind==='grass'?'grass':'wood']);
      }else if(!surface.intersects(x-1,y-9,x+8,y+2))ground.push([x,y,kind]);
    });
  }
  if(view.z>=15){
    const features=map.querySourceFeatures('tileflow',{sourceLayer:'tree'});
    const occupied=new Set();
    const addTree=(x,y)=>{
      if(!visible(x,y) || surface.intersects(x-10,y-20,x+10,y+2))return;
      const key=Math.floor((x+left*world)/12)+','+Math.floor((y+top*world)/12);
      if(occupied.has(key))return;
      occupied.add(key);plants.push([x,y,'tree']);
    };
    for(const {geometry:g} of features){
      if(g.type==='Point')addTree(...project(g.coordinates));
      else if(g.type==='MultiPoint')for(const point of g.coordinates)addTree(...project(point));
    }
    // A mapped tree row is a line. Space its printed crowns along the line, preserving corners.
    const spacing=Math.max(15,10*world/(40075016*Math.cos(map.getCenter().lat*Math.PI/180)));
    for(const {geometry:g} of features){
      if(g.type!=='LineString' && g.type!=='MultiLineString')continue;
      for(const points of chains(g)){
        let next=spacing/2;
        for(let i=1;i<points.length;i++){
          const [x,y]=project(points[i-1]),[endX,endY]=project(points[i]);
          const dx=endX-x,dy=endY-y,length=Math.hypot(dx,dy);
          for(;next<length;next+=spacing)addTree(x+dx*next/length,y+dy*next/length);
          next-=length;
        }
      }
    }
  }
  if(view.z>=16.1){
    const roofs=map.queryRenderedFeatures(box,{layers:['tileflow-poi-render-roofPrint']});
    const gap=view.z<17?21:16;
    stampPolygons(roofs,view,project,gap,gap,(x,y,f)=>{
      ground.push([x,y,/industrial|warehouse/.test(f.properties.use??'')?'workshop':'roof']);
    });
  }
  // Join road-label runs by name before typesetting: a word can cross an intersection
  // or tile boundary. The same Tileflow World layer supplies Madrid and Manhattan.
  if(view.z>=13.5){
    const byName=new Map(),seen=new Set();
    const importance={motorway:4,trunk:4,primary:3,secondary:2,tertiary:1};
    for(const f of map.querySourceFeatures('tileflow',{sourceLayer:'road_label'})){
      const name=f.properties?.name;
      if(!name || f.properties.class==='ferry' || f.properties.structure==='tunnel')continue;
      for(const chain of chains(f.geometry)){
        if(chain.length<2)continue;
        const coords=chain.map(mercator);
        let length=0,near=false;
        for(let i=1;i<coords.length;i++){
          const [a,b]=coords[i-1],[c,d]=coords[i];
          const x=(a-left)*world,y=(b-top)*world,dx=(c-a)*world,dy=(d-b)*world;
          length+=Math.hypot(dx,dy);
          if(Math.max(x,x+dx)>-margin && Math.min(x,x+dx)<view.w+margin && Math.max(y,y+dy)>-margin && Math.min(y,y+dy)<view.h+margin){
            near=true;
          }
        }
        if(!near)continue;
        const keyOf=c=>Math.round(c[0]*2e7)+','+Math.round(c[1]*2e7);
        const a=keyOf(coords[0]),b=keyOf(coords.at(-1)),key=name+'/'+[a,b].sort().join('/');
        if(seen.has(key))continue;seen.add(key);
        if(!byName.has(name))byName.set(name,[]);
        byName.get(name).push({coords,a,b,length,rank:importance[f.properties.class]??0});
      }
    }
    const lines=[];
    for(const [name,runs] of byName){
      const ends=new Map();
      for(const run of runs)for(const k of [run.a,run.b]){if(!ends.has(k))ends.set(k,[]);ends.get(k).push(run);}
      for(const run of runs){
        if(run.used)continue;run.used=true;
        let coords=run.coords.slice(),length=run.length,rank=run.rank;
        for(const backward of [false,true]){
          if(backward)coords.reverse();
          let tip=backward?run.a:run.b;
          for(;;){
            const next=ends.get(tip)?.find(r=>!r.used);
            if(!next)break;
            next.used=true;length+=next.length;rank=Math.max(rank,next.rank);
            const forward=tip===next.a;
            const extra=forward?next.coords:next.coords.slice().reverse();
            coords.push(...extra.slice(1));tip=forward?next.b:next.a;
          }
        }
        if(coords.at(-1)[0]<coords[0][0])coords.reverse();
        const featured=/^(bayard street|broadway|calle de alcalá|gran vía)$/i.test(name);
        lines.push({name,coords,length,featured,rank});
      }
    }
    lines.sort((a,b)=>Number(b.featured)-Number(a.featured)||b.rank-a.rank||b.length-a.length);
    const size=(view.z>=15?15:12);
    const occupied=new Set(), maxRuns=view.z>=18?10:view.z>=15?7:4;
    const chosenNames=new Map();
    let taken=0,hasAccent=lines.some(l=>l.featured);
    for(const l of lines){
      if(taken>=maxRuns)break;
      const count=chosenNames.get(l.name)??0;
      if(count>=(l.featured?2:1))continue;
      const mid=l.coords[Math.floor(l.coords.length/2)];
      const key=Math.floor(((mid[0]-left)*world)/(view.z<15?85:48))+','+Math.floor(((mid[1]-top)*world)/(view.z<15?85:48));
      if(!l.featured && occupied.has(key))continue;
      const word=l.name+(l.featured?'   ·   ':'       ');
      if(l.length<size*(l.featured?.48:.67)*word.length)continue;
      occupied.add(key);chosenNames.set(l.name,count+1);taken++;
      if(!hasAccent && l.rank>=2){l.featured=true;hasAccent=true;}
      track(l,l.featured?size*1.23:size);

    }
  }
  return {view,picks,tracks,waves,shore,ground,plants,contours};
}
// Cut horizontal lines of wave characters against the actual water polygons.
// Even–odd intersections preserve islands and holes. The grid also works on wrapped worlds.
function stampPolygons(features,view,project,dx,dy,emit) {
  const used=new Set(),world=512*2**view.z;
  const originX=-view.x*world+view.w/2,originY=-view.y*world+view.h/2;
  const ox=((originX%dx)+dx)%dx,oy=((originY%(2*dy))+2*dy)%(2*dy);
  for(const feature of features){
    const g=feature.geometry;
    const polys=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
    for(const poly of polys){
      const rows=new Map();
      for(const ring of poly){
        let a=project(ring[0]);
        for(let k=1;k<ring.length;k++){
          const b=project(ring[k]),height=b[1]-a[1];
          if(height){
            const first=Math.ceil((Math.max(-65,Math.min(b[1],a[1]))-oy)/dy),last=Math.ceil((Math.min(view.h+65,Math.max(b[1],a[1]))-oy)/dy);
            for(let j=first;j<last;j++){
              const xs=rows.get(j)??[];xs.push(a[0]+(j*dy+oy-a[1])*(b[0]-a[0])/height);
              if(!rows.has(j))rows.set(j,xs);
            }
          }
          a=b;
        }
      }
      for(const [row,xs] of rows){
        xs.sort((a,b)=>a-b);
        const y=row*dy+oy,offset=ox+(row&1)*dx*.5;
        for(let i=0;i+1<xs.length;i+=2){
          const limit=Math.min(view.w+65,xs[i+1]-3);
          const first=Math.ceil((Math.max(-65,xs[i]+3)-offset)/dx);
          for(let col=first;col*dx+offset<=limit;col++){
            const x=col*dx+offset,key=col+','+row;
            if(used.has(key))continue;
            used.add(key);emit(x,y,feature);
          }
        }
      }
    }
  }
}

export function closestName(sheet,view,x,y) {
  const [tx,ty,s]=registration(sheet.view,view);
  const px=(x-tx)/s,py=(y-ty)/s;
  let best=null,score=Infinity;
  for(const line of sheet.picks){
    const vx=px-line.x,vy=py-line.y,len=line.dx*line.dx+line.dy*line.dy;
    const u=Math.max(0,Math.min(1,(vx*line.dx+vy*line.dy)/(len||1)));
    const distance=Math.hypot(vx-u*line.dx,vy-u*line.dy)*s;
    if(distance<score){best=line;score=distance;}
  }
  return score<21?best:null;
}
