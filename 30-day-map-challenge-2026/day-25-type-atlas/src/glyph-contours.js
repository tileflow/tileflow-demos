const ns='http://www.w3.org/2000/svg';
const rules={
  countryEdges:['-',11,7.2,'#634b3b'],contestedEdges:['·',12,4.2,'#896b52'],
  regionEdges:['·',11,4.7,'#967f69'],coast:['-',8.5,5.9,'#507b7b'],
  regionalRoads:['-',9,6.5,'#955e45'],streams:['~',9,6.7,'#47808a'],
  arteries:['-',12,7.3,'#584c3f'],streets:['-',10,6.5,'#665c50'],
  lanes:['·',8.5,5,'#94836f'],footprints:['·',8,3.6,'#a1745b'],
};

export function sampleLine(points,view,spacing,emit){
  let distance=0;
  for(let i=1;i<points.length;i++){
    const [x,y]=points[i-1],[bx,by]=points[i],dx=bx-x,dy=by-y,len=Math.hypot(dx,dy);
    if(!len)continue;
    let lo=0,hi=1;
    for(const [pos,d,limit] of [[x,dx,view.w],[y,dy,view.h]]){
      if(!d){if(pos< -110||pos>limit+110)hi=-1;continue;}
      const a=(-110-pos)/d,b=(limit+110-pos)/d;lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));
    }
    if(hi>lo){
      const angle=(Math.atan2(dy,dx)*180/Math.PI+270)%180-90;
      const start=(Math.ceil((distance+lo*len)/spacing-.5)+.5)*spacing-distance;
      for(let t=start;t<hi*len;t+=spacing)emit(x+dx*t/len,y+dy*t/len,angle,dx/len,dy/len);
    }
    distance+=len;
  }
}

export function glyphString(points,glyph,size,ink){
  const t=document.createElementNS(ns,'text');
  t.setAttribute('x',points.map(p=>p[0].toFixed(1)).join(' '));
  t.setAttribute('y',points.map(p=>p[1].toFixed(1)).join(' '));
  t.setAttribute('rotate',points.map(p=>Math.round(p[2])).join(' '));
  t.setAttribute('fill',ink);t.setAttribute('font-family','monospace');t.setAttribute('font-size',size);
  t.setAttribute('dominant-baseline','central');t.setAttribute('text-anchor','middle');
  t.textContent=glyph.repeat(points.length);return t;
}

export function linearInk(map,view,project,surface){
  const prefix='tileflow-poi-render-',ids=Object.keys(rules).filter(k=>k!=='coast').map(k=>prefix+k);
  const byKind=new Map();
  function collect(kind,points){
    let spacing=rules[kind][2];
    if(kind==='footprints' && view.z<17.8){
      let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
      for(const [x,y] of points){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
      const minSpan=6+8*(17.8-view.z);
      if(Math.max(right-left,bottom-top)<minSpan || (right-left)*(bottom-top)<minSpan*minSpan*.6)return;
      spacing+=3.6*(17.8-view.z);
    }
    if(kind==='streets' && view.z<15)spacing+=3*(15-view.z);
    if(!byKind.has(kind))byKind.set(kind,{points:[],seen:new Set()});
    const group=byKind.get(kind),stride=Math.ceil((view.w+224)/2);
    sampleLine(points,view,spacing,(x,y,angle,ux,uy)=>{
      if(kind==='coast' && surface.intersects(x-uy*1.7,y+ux*1.7)===surface.intersects(x+uy*1.7,y-ux*1.7))return;
      const key=Math.round((y+110)/2)*stride+Math.round((x+110)/2);if(group.seen.has(key))return;
      group.seen.add(key);group.points.push([x,y,angle]);
    });
  }
  for(const f of map.queryRenderedFeatures([[-80,-80],[view.w+80,view.h+80]],{layers:ids})){
    const k=f.layer.id.slice(prefix.length),g=f.geometry;
    if(view.z<4.5 && (k==='countryEdges'||k==='contestedEdges'))continue;
    const paths=g.type==='LineString'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates.flat():g.coordinates;
    for(const line of paths)collect(k,line.map(project));
  }
  if(view.z>=4.5)for(const ring of surface.rings)collect('coast',ring);
  return byKind;
}

// Print native font glyphs at the display pixel ratio. Grouping by angle keeps
// the static print out of SVG text layout and retains each sampled position.
export function contourPrint(byKind,view,pad){
  if(![...byKind].some(([kind,group])=>kind!=='streams' && group.points.length))return null;
  const canvas=document.createElement('canvas'), ratio=window.devicePixelRatio || 1;
  const width=view.w+2*pad,height=view.h+2*pad;
  canvas.className='contour-ink';
  canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
  canvas.style.cssText=`position:absolute;left:${-pad}px;top:${-pad}px;width:${width}px;height:${height}px`;
  const ctx=canvas.getContext('2d');ctx.textAlign='center';ctx.textBaseline='middle';
  for(const [kind,[glyph,size,,ink]] of Object.entries(rules)){
    const points=byKind.get(kind)?.points;
    if(!points?.length || kind==='streams')continue;
    ctx.font=`${size}px monospace`;ctx.fillStyle=ink;
    ctx.globalAlpha=kind==='footprints'?Math.min(.96,.58+Math.max(0,view.z-15.5)*.22):1;
    const buckets=new Map();
    for(const point of points){
      const angle=glyph==='·'?0:Math.round(point[2]/5)*5;
      if(!buckets.has(angle))buckets.set(angle,[]);
      buckets.get(angle).push(point);
    }
    for(const [angle,bucket] of buckets){
      const radians=angle*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
      ctx.setTransform(ratio*c,ratio*s,-ratio*s,ratio*c,pad*ratio,pad*ratio);
      for(const [x,y] of bucket)ctx.fillText(glyph,c*x+s*y,c*y-s*x);
    }
  }
  return canvas;
}
