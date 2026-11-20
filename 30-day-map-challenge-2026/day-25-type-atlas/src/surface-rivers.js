// The label tiles and waterway tiles have independent geometries. Match the
// direction as well as the distance so a crossing does not bury a surface river.
export function surfaceRiverRuns(map,project,view) {
  const buried=map.querySourceFeatures('tileflow',{sourceLayer:'waterway',filter:
    ['any',['==',['get','structure'],'tunnel'],['==',['get','underground'],true]]});
  if(!buried.length)return points=>[points];
  const grid=new Map(), cell=48, tolerance=4, margin=120;
  const stride=Math.ceil((view.w+margin*2)/cell)+3;
  const key=(x,y)=>Math.floor((y+margin)/cell)*stride+Math.floor((x+margin)/cell);
  for(const feature of buried){
    const g=feature.geometry, lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[];
    for(const line of lines){
      const pts=line.map(project);
      for(let i=1;i<pts.length;i++){
        const [x,y]=pts[i-1],[xx,yy]=pts[i],dx=xx-x,dy=yy-y,len=Math.hypot(dx,dy);
        if(!len)continue;
        const left=Math.max(-margin,Math.min(x,xx)-tolerance),right=Math.min(view.w+margin,Math.max(x,xx)+tolerance);
        const top=Math.max(-margin,Math.min(y,yy)-tolerance),bottom=Math.min(view.h+margin,Math.max(y,yy)+tolerance);
        if(left>right || top>bottom)continue;
        const segment={x,y,dx,dy,len};
        for(let row=Math.floor((top+margin)/cell);row<=Math.floor((bottom+margin)/cell);row++){
          for(let col=Math.floor((left+margin)/cell);col<=Math.floor((right+margin)/cell);col++){
            const id=row*stride+col;
            if(!grid.has(id))grid.set(id,[]);
            grid.get(id).push(segment);
          }
        }
      }
    }
  }
  function isBuried(x,y,ux,uy){
    return grid.get(key(x,y))?.some(s=>{
      if(Math.abs(ux*s.dx+uy*s.dy)<s.len*.8)return false;
      const t=Math.max(0,Math.min(1,((x-s.x)*s.dx+(y-s.y)*s.dy)/(s.len*s.len)));
      return (x-s.x-t*s.dx)**2+(y-s.y-t*s.dy)**2<=tolerance*tolerance;
    });
  }
  return points=>{
    if(!grid.size)return [points];
    const runs=[];let run=[];
    for(let i=1;i<points.length;i++){
      const [x,y]=points[i-1],[xx,yy]=points[i],dx=xx-x,dy=yy-y,len=Math.hypot(dx,dy);
      if(!len)continue;
      if(Math.max(x,xx)<-margin || Math.min(x,xx)>view.w+margin || Math.max(y,yy)<-margin || Math.min(y,yy)>view.h+margin){
        if(run.length)runs.push(run);run=[];continue;
      }
      const steps=Math.ceil(len/7);let exposedStart=null;
      for(let j=0;j<steps;j++){
        const mid=(j+.5)/steps;
        if(!isBuried(x+dx*mid,y+dy*mid,dx/len,dy/len)){
          if(exposedStart===null)exposedStart=j/steps;
        }else{
          if(exposedStart!==null){if(!run.length)run.push([x+dx*exposedStart,y+dy*exposedStart]);run.push([x+dx*j/steps,y+dy*j/steps]);}
          if(run.length)runs.push(run);run=[];exposedStart=null;
        }
      }
      if(exposedStart!==null){if(!run.length)run.push([x+dx*exposedStart,y+dy*exposedStart]);run.push(points[i]);}
    }
    if(run.length)runs.push(run);
    return runs;
  };
}
