// Letter sizes and clearances vary with scale. The capital levels follow
// OpenStreetMap admin_level in the Tileflow place layer.
const clamp=n=>Math.min(1,Math.max(0,n));
const ease=n=>{const t=clamp(n);return t*t*(3-2*t);};
// City hierarchy enters while the map still shows several regions. At the
// other end the metropolitan plate gives way to street and district lettering.
export const metroWeight=z=>ease((z-5.56)/.98)*ease((11.4-z)/1.05);
export const regionalWeight=z=>ease((z-5.7)/.86)*ease((8.6-z)/.82);
const placeStyles=[
  {size:34,ink:'#233e37',priority:-9,gap:0,dot:24},
  {size:26,ink:'#354c40',priority:-5,gap:25,dot:20},
  {size:22,ink:'#354d43',priority:-2,gap:36,dot:16},
  {size:17,ink:'#41554a',priority:3,gap:58,dot:9},
  {size:14,ink:'#546251',priority:6,gap:69,dot:7.4},
  {size:12,ink:'#697060',priority:11,gap:96,dot:0}
];
export function metroPlace(p,rank){
  const capital=Number(p.capital),population=Number(p.population)||0;
  if(rank<2||rank>4)return null;
  const tier=capital===2||population>=2000000?0:capital>0&&capital<=4||population>=650000?1:capital>0&&capital<=6||population>=240000?2:rank+1;
  return placeStyles[tier];
}

// Count road and river ink in a prospective name rectangle in constant time.
// Geometry is already culled and projected by the compositor worker.
export function corridorDensity(paths,width,height){
  const cell=8,stride=Math.ceil(width/cell)+1,rows=Math.ceil(height/cell)+1;
  const density=new Int32Array(stride*rows);
  for(const p of paths){
    if(p.b!=='river'&&(p.b!=='road'||p.rank>3))continue;
    const line=p.path.line,weight=p.b==='river'?3:5-p.rank;
    for(let i=1;i<line.length;i++){
      const a=line[i-1],b=line[i],dx=b[0]-a[0],dy=b[1]-a[1];
      const steps=Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))/cell));
      for(let j=0;j<=steps;j++){
        const x=1+Math.floor((a[0]+dx*j/steps)/cell),y=1+Math.floor((a[1]+dy*j/steps)/cell);
        if(x>0&&x<stride&&y>0&&y<rows)density[y*stride+x]=Math.max(weight,density[y*stride+x]);
      }
    }
  }
  for(let y=1;y<rows;y++){
    let sum=0;
    for(let x=1;x<stride;x++){
      const i=y*stride+x;sum+=density[i];density[i]=sum+density[i-stride];
    }
  }
  const ix=n=>Math.max(0,Math.min(stride-1,Math.floor(n/cell)));
  const iy=n=>Math.max(0,Math.min(rows-1,Math.floor(n/cell)))*stride;
  return box=>{
    const l=ix(box.x-box.extX),r=ix(box.x+box.extX),t=iy(box.y-box.extY),b=iy(box.y+box.extY);
    return density[b+r]-density[b+l]-density[t+r]+density[t+l];
  };
}
export function setPlace(c,space,density,width,height,priors,weight,water){
  const [sx,sy]=c.site,dx=(c.width/2+4)*weight,dy=(c.size*.57+3.5)*weight;
  // Keep the same side of a surveyed town across a zoom even as its map
  // coordinates and the optical width of its name change independently.
  const old=priors?.find(o=>o.roadPoint&&Math.hypot(o.roadPoint[0]-sx,o.roadPoint[1]-sy)<Math.max(4,Math.min(14,c.size*.65)));
  const ox=old?old.x-old.roadPoint[0]:0,oy=old?old.y-old.roadPoint[1]:0;
  const oldLength=Math.hypot(ox,oy);
  const longName=c.width>155&&c.name.includes(' / ');
  const offsets=c.dot>=20||longName?[[0,-1],[0,1],[.24,-1],[-.24,-1],[.24,1],[-.24,1]]:
    [[1,-1],[0,-1],[1,1],[0,1],[-1,-1],[-1,1],[1,0],[-1,0]];
  const inland=!water.has(sx,sy);
  let best,bestScore=Infinity;
  for(let i=0;i<offsets.length;i++){
    const [u,v]=offsets[i],x=sx+dx*u,y=sy+dy*v;
    const box=space.rect(x,y,c.width+6,c.size*1.02+3,0);
    if(x-box.extX<1||y-box.extY<1||x+box.extX>width-1||y+box.extY>height-1||space.overlaps(box))continue;
    const length=Math.hypot(dx*u,dy*v);
    // Compare the side of the town independently of camera magnification.
    const direction=oldLength>2&&length>2?(dx*u*ox+dy*v*oy)/(oldLength*length):0;
    const match=direction>.96;
    let offshore=0;
    if(inland)for(const part of [-.44,-.22,0,.22,.44])if(water.has(x+c.width*part,y))offshore+=longName?50:14;
    const score=density(box)+offshore+i*.44-(match?10*direction:0);
    if(score<bestScore){bestScore=score;best={box,x,y,held:!!match};}
  }
  return best;
}
