'use strict';
(async () => {
  const get = id => document.getElementById(id);
  const read = id => JSON.parse(get(id).textContent);
  const data = read('data'), theme = read('score'), sea = read('sea'), names = read('names'), relief = read('relief');
  const heightfield = Uint8Array.from(atob(relief.data), c => c.charCodeAt(0));
  const R = theme.roles, TAU=2*Math.PI, period=12;
  const surfaces = ['geography','water-a','water-b','motion','lettering'].map(id=>get(id));
  const [base,waterA,waterB,motion,letters] = surfaces.map(c=>c.getContext('2d'));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let width,height,ratio,unit,columns,rows,coverage,regions,portrait,scaleX,scaleY;
  let inkReservations=[], routes=[], movingWords=[], streamGlyphs=[], oceanWords=[], ready=false, frame=0, paintMs=0, staticGlyphs=0, waterGlyphs=0, animatedStreetGlyphs=0, animatedLetters=0, labelsCount=0;
  let coastOccupied;
  let playing=!reduced.matches, time=0, last=null, raf=0, resizeFrame=0, rebuildMs=0;
  const maskCell=2, wrap=v=>((v%1)+1)%1;
  const hash=(a,b)=>{const x=Math.sin(a*12.9898+b*78.233)*43758.5453;return x-Math.floor(x);};
  const mono='"JetBrains Mono",Menlo,monospace', serif='"Instrument Serif",Georgia,serif';
  const color=role=>R[role].color;
  document.documentElement.style.backgroundColor=theme.paper;
  function textStyle(ctx,role,size,face=mono,alpha=1,italic=false){
    ctx.font=(italic?'italic ':'')+size.toFixed(2)+'px '+face;
    ctx.fillStyle=color(role);ctx.globalAlpha=alpha;ctx.textAlign='center';ctx.textBaseline='middle';
  }
  function draw(ctx,char,x,y,angle=0){
    if(!angle){ctx.fillText(char,x,y);return;}
    // Reuse 64 orientations for still marks. Country letters and travelling text
    // retain their own angles; the largest change to a static tangent is 2.8125°.
    if(ctx!==motion)angle=Math.round(angle*32/Math.PI)*(Math.PI/32);
    const c=Math.cos(angle),s=Math.sin(angle);
    ctx.setTransform(scaleX*c,scaleY*s,-scaleX*s,scaleY*c,x*scaleX,y*scaleY);
    ctx.fillText(char,0,0);ctx.setTransform(scaleX,0,0,scaleY,0,0);
  }
  function projections(){
    const margin=Math.max(5,Math.min(width,height)*.012);
    const projection=d3.geoEqualEarth().precision(.35);
    if(!portrait)return [{p:projection.fitExtent([[margin,margin],[width-margin,height-margin]],{type:'Sphere'}),center:null}];
    const gap=Math.min(18,height*.021), half=(height-gap)/2;
    return [-90,90].map((lon,i)=>{
      const cy=(i?half+gap:0)+half/2, radius=Math.min(width/2-margin,half/2-margin*.32);
      const p=d3.geoAzimuthalEqualArea().rotate([-lon,0,0]).precision(.3).clipAngle(90).scale(radius/Math.SQRT2).translate([width/2,cy]);
      return {p,center:[lon,0]};
    });
  }
  function projectGeometry(geometry,p){
    let lines=[],line;
    const stream={point(x,y){if(line)line.push([x,y]);},lineStart(){line=[];},lineEnd(){if(line.length>1)lines.push(line);line=null;},polygonStart(){},polygonEnd(){},sphere(){}};
    d3.geoStream(geometry,p.stream(stream));return lines;
  }
  function polygon(ring){
    let g={type:'Polygon',coordinates:[ring]};
    if(d3.geoArea(g)>2*Math.PI)g.coordinates=[ring.slice().reverse()];
    return g;
  }
  function scan(rings,flag){
    if(!rings.length)return;
    const intersections=[];
    for(const ring of rings){
      for(let i=0,j=ring.length-1;i<ring.length;j=i++){
        const a=ring[j],b=ring[i];if(Math.abs(b[1]-a[1])<1e-6)continue;
        const start=Math.max(0,Math.ceil(Math.min(a[1],b[1])/maskCell-.5)),end=Math.min(rows,Math.ceil(Math.max(a[1],b[1])/maskCell-.5));
        for(let y=start;y<end;y++){
          const x=a[0]+((y+.5)*maskCell-a[1])*(b[0]-a[0])/(b[1]-a[1]);
          (intersections[y]??=[]).push(x);
        }
      }
    }
    intersections.forEach((xs,y)=>{
      xs.sort((a,b)=>a-b);
      for(let i=1;i<xs.length;i+=2){
        const start=Math.max(0,Math.ceil(xs[i-1]/maskCell-.5)),end=Math.min(columns,Math.ceil(xs[i]/maskCell-.5));
        if(end>start)coverage.fill(flag,y*columns+start,y*columns+end);
      }
    });
  }
  function medium(x,y){
    if(x<0||x>=width||y<0||y>=height)return 0;
    return coverage[Math.floor(y/maskCell)*columns+Math.floor(x/maskCell)];
  }
  function isVisible(r,ll){
    return !r.center||d3.geoDistance(r.center,ll)<Math.PI/2-1e-8;
  }
  function location(ll){
    const region=regions.find(r=>isVisible(r,ll));return region?region.p(ll):null;
  }
  function reserve(x,y,w,h){inkReservations.push([x-w/2,y-h/2,x+w/2,y+h/2]);}
  function overlaps(x,y,w,h){
    return inkReservations.some(b=>x+w/2>b[0]&&x-w/2<b[2]&&y+h/2>b[1]&&y-h/2<b[3]);
  }
  function curve(points){
    const parts=[];let length=0;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],d=Math.hypot(dx,dy);if(d<.01)continue;
      parts.push({x:a[0],y:a[1],u:dx/d,v:dy/d,angle:Math.atan2(dy,dx),start:length,end:length+d});length+=d;
    }
    return {parts,length};
  }
  function at(g,d){
    let a=0,b=g.parts.length-1;
    while(a<b){const m=(a+b)>>1;if(g.parts[m].end<d)a=m+1;else b=m;}
    const p=g.parts[a],r=d-p.start;return [p.x+p.u*r,p.y+p.v*r,p.angle];
  }
  function trace(line,region){return projectGeometry({type:'LineString',coordinates:line},region.p).map(curve).filter(c=>c.length>.15);}
  function coastParts(ring){
    const result=[];let segment=[ring[0]];
    for(let i=1;i<ring.length;i++){
      const a=ring[i-1],b=ring[i];
      const seam=(Math.abs(a[0])>179.995&&Math.abs(b[0])>179.995)||(a[1]<-89.98&&b[1]<-89.98);
      if(seam){if(segment.length>1)result.push(segment);segment=[];}
      segment.push(b);
    }
    if(segment.length>1)result.push(segment);return result;
  }
  const coastlines=data.land.flatMap(coastParts);
  function paintLine(ctx,path,char,step,{phase=step*.42,limit=false,separate=false}={}){
    let count=0;
    if(!path.length)return 0;
    if(separate&&path.length<step*.8){const [x,y]=at(path,path.length/2);draw(ctx,'·',x,y);return 1;}
    for(let d=phase;d<path.length;d+=step){const [x,y,a]=at(path,d);if(limit&&overlaps(x,y,2*unit,2*unit))continue;draw(ctx,char,x,y,a);count++;}
    return count;
  }
  const basins=[
    ['North Pacific',-146,28,37,-.13],['South Pacific',-122,-26,36,.085],
    ['North Atlantic',-39,31,31,-.25],['South Atlantic',-25,-27,30,.15],
    ['Indian Ocean',80,-29,37,-.12],['Southern Ocean',16,-59,29,.015],
    ['Arctic Ocean',57,84.5,16,0]
  ];
  function lettering(){
    const oceans=portrait?[
      ['Pacific Ocean',-123,-14,32,-.16],['North Atlantic',-43,29,23,-.20],['South Atlantic',-25,-26,21,.16],
      ['Indian Ocean',78,-28,31,-.16],['Southern Ocean',84,-59,22,0]
    ]:basins;
    for(const [name,lon,lat,size,angle] of oceans){
      const nominal=size*unit, space=.80*unit;
      // Reserve a narrow curved corridor rather than emptying a box around sloping text.
      let placed=false;
      for(const factor of [1,.90,.78]){
        for(const [dx,dy] of [[0,0],[-3,1],[3,1],[0,-2],[-6,-2],[6,2]]){
          const point=location([lon+dx,lat+dy]);if(!point)continue;const [x,y]=point;
          const sizePx=nominal*factor;
          letters.font='italic '+sizePx+'px '+serif;
          const chars=Array.from(name).map(ch=>({ch,width:letters.measureText(ch).width+space}));
          const span=chars.reduce((v,c)=>v+c.width,0);let advance=-span/2;
          const slots=chars.map(ch=>{
            const pos=advance+ch.width/2;advance+=ch.width;
            const bend=.00042/unit*(pos*pos-span*span/12);
            return [x+Math.cos(angle)*pos-Math.sin(angle)*bend,y+Math.sin(angle)*pos+Math.cos(angle)*bend,ch.width+6*unit,sizePx*.85];
          });
          const fits=slots.every(([cx,cy,sw,sh])=>
            medium(cx,cy)===1&&medium(cx,cy-sh*.38)===1&&medium(cx,cy+sh*.38)===1&&!overlaps(cx,cy,sw,sh));
          if(!fits)continue;
          for(const slot of slots)reserve(...slot);
          oceanWords.push({x,y,chars,span,size:sizePx,angle});labelsCount++;placed=true;break;
        }
        if(placed)break;
      }
    }
    planTravellingWords();
    const selected=names.slice().sort((a,b)=>a[3]-b[3]||b[4]-a[4]);
    for(const [value,lon,lat,priority,size] of selected){
      const point=location([lon,lat]);if(!point)continue;let [x,y]=point;
      if(medium(x,y)!==2)continue;
      if(portrait&&priority>2&&width<520)continue;
      const large=size>=17, text=large?value.toUpperCase():value;
      const px=portrait?Math.max(9,size*unit):Math.max(7.2,size*unit);
      const tracking=(large?1.50:.22)*unit,face=large?serif:mono;
      textStyle(letters,'label',px,face,large?1:.92);
      const advances=Array.from(text).map(ch=>letters.measureText(ch).width+tracking);
      const span=advances.reduce((a,b)=>a+b,0)-tracking, bw=span+4*unit,bh=px*.87+3*unit;
      const shifts=priority===1?[[0,0],[0,-7],[0,7],[-4,-4],[4,5],[0,13],[0,-13],[8,8],[-7,-8]]:[[0,0]];
      const place=shifts.map(([dx,dy])=>[x+dx*unit,y+dy*unit]).find(([a,b])=>
        a-span/2>1&&a+span/2<width-1&&medium(a,b)===2&&!overlaps(a,b,bw+2*unit,bh)&&
        (medium(a-span*.25,b)===2||medium(a+span*.25,b)===2));
      if(!place)continue;
      [x,y]=place;
      reserve(x,y,bw,bh);
      let pos=x-span/2;
      letters.textAlign='left';
      for(let j=0;j<text.length;j++){letters.fillText(text[j],pos,y);pos+=advances[j];}
      staticGlyphs+=text.length;labelsCount++;
    }
  }
  function elevation(lon,lat){
    const i=(Math.round((lon-relief.west)/relief.step)%relief.width+relief.width)%relief.width;
    const j=Math.max(0,Math.min(relief.height-1,Math.round((relief.north-lat)/relief.step)));
    return heightfield[j*relief.width+i]*relief.metersPerUnit;
  }
  function terrain(){
    const step=Math.max(4.5,7.20*unit),pens=[
      {glyph:'·',opacity:.57,size:10}, {glyph:':',opacity:.54,size:9.2},
      {glyph:'′',opacity:.62,size:10}, {glyph:'∧',opacity:.70,size:9},
      {glyph:'^',opacity:.88,size:13}
    ].map(p=>({...p,points:[]}));
    for(let row=0;row*step<height;row++){
      for(let col=0;col*step<width;col++){
        const rnd=hash(col,row),x=(col+(row%2)*.48+(rnd-.5)*.33)*step,y=(row+(hash(row,col)-.5)*.44)*step;
        if(medium(x,y)!==2||overlaps(x,y,2*unit,2*unit))continue;
        const r=portrait?regions[y<height/2?0:1]:regions[0], ll=r.p.invert([x,y]);
        const z=elevation(ll[0],ll[1]),pen=z>2800?4:z>1350?3:z>650?2:z>220?1:0;
        if(rnd<[.38,.31,.26,.16,.08][pen])continue;
        pens[pen].points.push([x,y]);
      }
    }
    for(const pen of pens){textStyle(base,'shore',pen.size*unit,mono,pen.opacity);for(const [x,y] of pen.points)base.fillText(pen.glyph,x,y);staticGlyphs+=pen.points.length;}
  }
  function waves(){
    for(let i=0;i<sea.length;i++){
      const [level,coordinates]=sea[i],tier=(level+101)%8;
      if(tier===6||(width<900&&!portrait&&tier===2))continue;
      const strong=tier===0||tier===4,ctx=strong?waterB:waterA;
      textStyle(ctx,'water',Math.max(7.8,R.water.size*(strong?1.08:.97)*unit),mono,strong?.62:.35);
      for(const region of regions)for(const path of trace(coordinates,region)){
        const step=Math.max(6.8,(strong?11.45:12.8)*unit);
        for(let d=hash(i,level)*step;d<path.length;d+=step){
          const [x,y,a]=at(path,d),guard=4.75*unit;
          if(medium(x,y)!==1||medium(x-guard,y)!==1||medium(x+guard,y)!==1||medium(x,y+guard*.65)!==1||medium(x,y-guard*.65)!==1||overlaps(x,y,6*unit,5*unit))continue;
          // Gaps in the streams leave open water between engraved wave-trains.
          if(Math.sin(d/(26*unit)+i*.83)+Math.sin(d/(69*unit)+level*.46)<(strong?-.9:-.36))continue;
          if(strong&&i%4===0&&d+step<path.length&&hash(i,Math.floor(d/step))>.60){
            const q=at(path,d+step);
            if(medium(q[0],q[1])===1&&!overlaps(q[0],q[1],8*unit,6*unit)){
              streamGlyphs.push({x,y,qx:q[0],qy:q[1],a});waterGlyphs++;continue;
            }
          }
          draw(ctx,'~',x,y,a);waterGlyphs++;
        }
      }
    }
  }
  function collectRoutes(){
    for(const region of regions){
      for(const [features,role] of [[data.roads,'road'],[data.rivers,'river']]){
        for(const f of features)for(const path of trace(f.path,region)){
          if(path.length>3*unit)routes.push({path,name:f.name,role,id:routes.length});
        }
      }
    }
  }
  function planTravellingWords(){
    const selected=['I-80','Amazon','Nile','E90','Perth–Adelaide','Lena','MEX 15','Mekong','Congo','Paraná River'];
    for(const name of selected){
      const f=routes.filter(x=>x.name===name).sort((a,b)=>b.path.length-a.path.length)[0];if(!f)continue;
      const str=f.name.replace(' River',''),size=Math.max(portrait?7.6:7.2,(f.role==='road'?10.3:12.8)*unit);
      const spacing=size*(f.role==='road'?.61:.48),len=(str.length-1)*spacing;
      if(f.path.length<len+5*unit)continue;
      const d0=len/2+2*unit,d1=f.path.length-len/2-2*unit;
      // Take a locally smooth stretch. The word remains intact as it advances.
      const travel=Math.min(d1-d0,Math.max(7*unit,Math.min(32*unit,f.path.length*.23)));
      if(travel<2*unit)continue;
      let best=null;
      for(let step=0;step<=10;step++){
        const begin=d0+(d1-d0-travel)*step/10,end=begin+travel;
        const a=at(f.path,begin),b=at(f.path,end),m=at(f.path,(begin+end)/2);
        const angle=Math.atan2(b[1]-a[1],b[0]-a[0]);
        const slope=Math.abs(Math.sin(angle));
        const direction=Math.cos(angle)>=0?1:-1;
        const tangent=angle+(direction<0?Math.PI:0),normal=[-Math.sin(tangent),Math.cos(tangent)];
        const lift=-(size*.76+1.0*unit),cx=m[0]+normal[0]*lift,cy=m[1]+normal[1]*lift;
        const boxW=Math.abs(Math.cos(tangent))*(len+spacing+travel)+Math.abs(normal[0])*size+3*unit;
        const boxH=Math.abs(Math.sin(tangent))*(len+spacing+travel)+Math.abs(normal[1])*size+2*unit;
        if(cx-boxW/2<1||cx+boxW/2>width-1||cy-boxH/2<1||cy+boxH/2>height-1||overlaps(cx,cy,boxW,boxH))continue;
        const score=slope+Math.abs(step-5)*.025+(1-Math.hypot(a[0]-b[0],a[1]-b[1])/travel)*3;
        if(!best||score<best.score)best={f,str,size,spacing,len,begin,travel,tangent,normal,lift,cx,cy,boxW,boxH,score};
      }
      if(best){
        reserve(best.cx,best.cy,best.boxW,best.boxH);
        movingWords.push(best);
      }
    }
  }
  function cleanCoast(path){
    const spacing=Math.max(3.85,5.55*unit),cell=Math.max(2,spacing*.55),nx=Math.ceil(width/cell);
    function mark(x,y){const i=Math.floor(x/cell),j=Math.floor(y/cell),key=j*nx+i;if(coastOccupied.has(key))return false;coastOccupied.add(key);return true;}
    if(path.length<spacing*.8){const [x,y]=at(path,path.length/2);if(mark(x,y)){draw(base,'·',x,y);staticGlyphs++;}return;}
    for(let d=spacing*.34;d<path.length;d+=spacing){
      const [x,y]=at(path,d);if(!mark(x,y))continue;
      const a=at(path,Math.max(0,d-spacing*.42)),b=at(path,Math.min(path.length,d+spacing*.42));
      draw(base,'–',x,y,Math.atan2(b[1]-a[1],b[0]-a[0]));staticGlyphs++;
    }
  }
  function routesAndOutlines(){
    textStyle(base,'river',Math.max(6.7,R.river.size*.88*unit),mono,.85);
    for(const route of routes)if(route.role==='river')staticGlyphs+=paintLine(base,route.path,'~',Math.max(4.2,6.9*unit),{limit:true});
    for(const region of regions){
      textStyle(base,'border',Math.max(7,R.border.size*1.02*unit),mono,.94);
      for(const line of data.boundaries)for(const path of trace(line,region))staticGlyphs+=paintLine(base,path,'-',Math.max(4.25,5.8*unit),{limit:true});
      textStyle(base,'river',Math.max(6.2,8*unit),mono,.80);
      for(const ring of data.landHoles)for(const path of trace(ring,region))staticGlyphs+=paintLine(base,path,'-',Math.max(3.7,4.2*unit),{separate:true});
      textStyle(base,'shore',Math.max(7.4,R.shore.size*.86*unit),mono,1);
      for(const line of coastlines)for(const path of trace(line,region))cleanCoast(path);
    }
  }
  function setScene(){
    const begin=performance.now();width=innerWidth;height=innerHeight;
    portrait=width/height<.95;ratio=Math.min(devicePixelRatio||1,2.25);
    unit=portrait?Math.max(.53,Math.min(width/655,height/1180,1.5)):Math.max(.40,Math.min(width/1600,height/815,1.55));
    columns=Math.ceil(width/maskCell);rows=Math.ceil(height/maskCell);coverage=new Uint8Array(columns*rows);
    scaleX=Math.round(width*ratio)/width;scaleY=Math.round(height*ratio)/height;
    for(const c of surfaces){c.width=Math.round(width*ratio);c.height=Math.round(height*ratio);c.getContext('2d').setTransform(scaleX,0,0,scaleY,0,0);}
    inkReservations=[];routes=[];movingWords=[];streamGlyphs=[];oceanWords=[];coastOccupied=new Set();staticGlyphs=0;waterGlyphs=0;labelsCount=0;regions=projections();
    for(const r of regions){
      scan(projectGeometry({type:'Sphere'},r.p),1);
      for(const ring of data.land)scan(projectGeometry(polygon(ring),r.p),2);
      for(const ring of data.landHoles||[])scan(projectGeometry(polygon(ring),r.p),1);
    }
    collectRoutes();lettering();terrain();waves();routesAndOutlines();paint(time);rebuildMs=performance.now()-begin;
  }
  function animateRoutes(phase){
    const pitch=Math.max(4.4,6.7*unit);
    textStyle(motion,'road',Math.max(7.3,9.2*unit),mono,.97);
    for(const f of routes)if(f.role==='road')animatedStreetGlyphs+=paintLine(motion,f.path,'-',pitch,{phase:wrap(phase*4+f.id*.219)*pitch,limit:true});
    for(const item of movingWords){
      // Typeset the full word on the local tangent, preserving every letter on sharp bends.
      const t=wrap(phase+item.f.id*.3819),p=at(item.f.path,item.begin+t*item.travel);
      const alpha=Math.min(1,t/.09,(1-t)/.09);
      textStyle(motion,item.f.role,item.size,item.f.role==='river'?serif:mono,alpha,item.f.role==='river');
      for(let j=0;j<item.str.length;j++){
        const d=j*item.spacing-item.len/2;
        draw(motion,item.str[j],p[0]+Math.cos(item.tangent)*d+item.normal[0]*item.lift,
          p[1]+Math.sin(item.tangent)*d+item.normal[1]*item.lift,item.tangent);
        animatedLetters++;
      }
    }
    textStyle(motion,'water',Math.max(7.8,R.water.size*1.08*unit),mono,.66);
    for(const g of streamGlyphs){
      // A travelling wave fades as it hands its place back to the repeated mark upstream.
      const t=wrap(phase*2+g.x*.002);
      const blend=Math.min(1,t/.14,(1-t)/.14);
      motion.globalAlpha=.6*blend;draw(motion,'~',g.x+(g.qx-g.x)*t,g.y+(g.qy-g.y)*t,g.a);
    }
  }
  function paint(seconds){
    const start=performance.now(),phase=wrap(seconds/period),a=phase*TAU;
    motion.clearRect(0,0,width,height);animatedStreetGlyphs=0;animatedLetters=0;
    surfaces[1].style.transform='translate('+((Math.cos(a)-1)*1.55*unit).toFixed(3)+'px,'+(Math.sin(a)*1.28*unit).toFixed(3)+'px)';
    surfaces[2].style.transform='translate('+(Math.sin(a)*2.95*unit).toFixed(3)+'px,'+((Math.cos(a)-1)*.92*unit).toFixed(3)+'px)';
    animateRoutes(phase);
    for(const word of oceanWords){
      textStyle(motion,'ocean',word.size,serif,.99,true);
      const sway=Math.sin(a)*3*unit;let advance=-word.span/2;
      for(const char of word.chars){
        const pos=advance+char.width/2+sway;
        const bend=.00042/unit*(pos*pos-word.span*word.span/12);
        const x=word.x+Math.cos(word.angle)*pos-Math.sin(word.angle)*bend,y=word.y+Math.sin(word.angle)*pos+Math.cos(word.angle)*bend;
        draw(motion,char.ch,x,y,word.angle+Math.atan(.00084/unit*pos));advance+=char.width;animatedLetters++;
      }
    }
    frame++;paintMs=performance.now()-start;
  }
  function tick(now){
    raf=0;if(!playing||document.hidden)return;
    if(last!==null)time+=(now-last)/1000;last=now;paint(time);raf=requestAnimationFrame(tick);
  }
  function schedule(){if(raf)cancelAnimationFrame(raf);raf=0;last=null;if(playing&&!document.hidden)raf=requestAnimationFrame(tick);}
  function setPlaying(v){playing=Boolean(v);schedule();}
  function full(){if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});else document.documentElement.requestFullscreen?.().catch(()=>{});}
  addEventListener('keydown',e=>{if(e.altKey||e.ctrlKey||e.metaKey||e.repeat)return;if(e.code==='Space'){e.preventDefault();setPlaying(!playing);}if(e.key.toLowerCase()==='f'){e.preventDefault();full();}});
  let tapTimer=null,touchStart=null;
  addEventListener('pointerdown',e=>{
    if(e.pointerType==='touch'&&e.isPrimary)touchStart=[e.pointerId,e.clientX,e.clientY,performance.now()];
    else touchStart=null;
  });
  addEventListener('pointercancel',()=>{touchStart=null;});
  addEventListener('pointerup',e=>{
    if(!touchStart||e.pointerId!==touchStart[0])return;
    const [,x,y,start]=touchStart;touchStart=null;
    if(Math.hypot(e.clientX-x,e.clientY-y)>9||performance.now()-start>550)return;
    if(tapTimer){clearTimeout(tapTimer);tapTimer=null;return;}
    tapTimer=setTimeout(()=>{tapTimer=null;setPlaying(!playing);},320);
  });
  addEventListener('dblclick',()=>{clearTimeout(tapTimer);tapTimer=null;full();});
  reduced.addEventListener('change',e=>setPlaying(!e.matches));document.addEventListener('visibilitychange',schedule);
  await Promise.all([document.fonts.load('12px "JetBrains Mono"'),document.fonts.load('20px "Instrument Serif"'),document.fonts.load('italic 20px "Instrument Serif"')]);
  setScene();ready=true;schedule();
  addEventListener('resize',()=>{if(resizeFrame)cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{resizeFrame=0;if(width!==innerWidth||height!==innerHeight)setScene();});});
  window.plate={ready,setPlaying,seek(t){time=Number(t)||0;last=null;paint(time);},stats(){return {frames:frame,paintMs,rebuildMs,staticGlyphs,waterGlyphs,animatedStreetGlyphs,animatedLetters,movingLabels:movingWords.map(w=>w.str),streamGlyphs:streamGlyphs.length,labels:labelsCount,playing,width,height,projection:portrait?'Lambert hemispheres':'Equal Earth'};}};
})();
