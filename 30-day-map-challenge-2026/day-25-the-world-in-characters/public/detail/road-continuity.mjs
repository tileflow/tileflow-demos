// Vector tiles split an avenue at intersections and tile edges. Stationing each
// fragment separately gives short pieces random dash phases. Rejoin compatible
// major-road ends before laying type, only when the continuation is unambiguous.
export function continuousRoads(items,measure,metropolitan=false){
  const graph=new Map(),backbones=items.filter(r=>r.b==='road'&&r.rank<=3&&!r.link);
  for(const r of backbones){
    const vertices=r.path.line,keys=[];
    for(const [anchor,inside] of [[vertices[0],vertices[1]],[vertices.at(-1),vertices.at(-2)]]){
      const key=r.rank+'|'+(metropolitan?'':r.structure)+'|'+Math.round(anchor[0]*4)+'|'+Math.round(anchor[1]*4);
      const dx=inside[0]-anchor[0],dy=inside[1]-anchor[1],length=Math.hypot(dx,dy)||1;
      const end={r,first:keys.length===0,x:dx/length,y:dy/length};
      keys.push(end);let list=graph.get(key);if(!list)graph.set(key,list=[]);list.push(end);
    }
    r.ends=keys;
  }
  for(const ends of graph.values()){
    if(ends.length<2||ends.length>8)continue;
    const choices=new Map();
    for(const a of ends){
      let best,score=-1,second=-1;
      for(const b of ends){
        if(a.r===b.r||a.r.route&&b.r.route&&a.r.route!==b.r.route)continue;
        const linearity=-(a.x*b.x+a.y*b.y);
        if(linearity>score){second=score;score=linearity;best=b;}
        else second=Math.max(second,linearity);
      }
      if(score>.67&&(second<.65||score-second>.10))choices.set(a,best);
    }
    for(const [a,b] of choices)if(choices.get(b)===a)a.next=b;
  }
  const rebuilt=[],visited=new Set();
  for(const r of items){
    if(!r.ends){rebuilt.push(r);continue;}
    if(visited.has(r))continue;visited.add(r);
    const collect=end=>{
      const list=[];let peer=end.next;
      while(peer&&!visited.has(peer.r)){
        const road=peer.r;visited.add(road);
        list.push(peer.first?road.path.line.slice(1):road.path.line.slice(0,-1).reverse());
        peer=road.ends[peer.first?1:0].next;
      }
      return list.flat();
    };
    const before=collect(r.ends[0]),after=collect(r.ends[1]);
    if(before.length||after.length)r.path=measure([...before.reverse(),...r.path.line,...after]);
    rebuilt.push(r);
  }
  return rebuilt;
}

// Subpixel bends in motorway interchanges and administrative lines turn a dash
// at every vertex. Keep both endpoints and any bend visible at the print scale.
export function simplifyForType(path,tolerance,measure){
  const points=path.line;
  if(points.length<3||tolerance<.15)return path;
  const keep=new Uint8Array(points.length),last=points.length-1,pending=[[0,last]];
  keep[0]=keep[last]=1;
  while(pending.length){
    const [i,j]=pending.pop(),a=points[i],b=points[j],dx=b[0]-a[0],dy=b[1]-a[1],norm=dx*dx+dy*dy;
    let far=tolerance*tolerance,split=-1;
    for(let k=i+1;k<j;k++){
      const x=points[k][0]-a[0],y=points[k][1]-a[1];
      const t=norm?Math.max(0,Math.min(1,(x*dx+y*dy)/norm)):0;
      const distance=(x-t*dx)**2+(y-t*dy)**2;
      if(distance>far){split=k;far=distance;}
    }
    if(split>=0){keep[split]=1;pending.push([i,split],[split,j]);}
  }
  const reduced=points.filter((_,i)=>keep[i]);
  return reduced.length===points.length?path:measure(reduced);
}
