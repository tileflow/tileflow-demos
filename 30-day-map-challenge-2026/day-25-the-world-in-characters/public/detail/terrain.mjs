// True height contours from ETOPO 2022. Input cells are five arc-minutes apart;
// the output is a set of typographic marks on contour tangents and sampled crests.
const cache=new Map();
let index;
const mod=(v,n)=>(v%n+n)%n;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const shift=(p,a,b,t)=>p[a]+(p[b]-p[a])*t;
async function block(r,c){
  const key=r+'-'+c;
  if(!cache.has(key))cache.set(key,(async()=>{
    const res=await fetch(new URL('./terrain/'+key+'.gz',import.meta.url));
    if(!res.ok)throw Error('Elevation block unavailable');
    const bytes=new Uint8Array(await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    if(bytes.length!==259200)throw Error('Incomplete elevation block');
    return new Int16Array(bytes.buffer);
  })().catch(e=>{cache.delete(key);throw e;}));
  return cache.get(key);
}
export async function terrainFor(bounds,z){
  if(z<5.15||z>10.25)return;
  index??=fetch(new URL('./terrain/index.json',import.meta.url)).then(r=>r.json()).catch(e=>{index=null;throw e;});
  const m=await index;
  const col=x=>Math.floor((x-m.west)/m.step),row=y=>Math.floor((m.north-y)/m.step);
  const [west,south,east,north]=bounds;
  const tiles=new Map(),loads=[];
  const r0=clamp(Math.floor((row(north)-2)/360),0,5),r1=clamp(Math.floor((row(south)+2)/360),0,5);
  for(let r=r0;r<=r1;r++)for(let i=Math.floor((col(west)-2)/360);i<=Math.floor((col(east)+2)/360);i++){
    const c=mod(i,12);loads.push(block(r,c).then(b=>tiles.set(r*12+c,b)));
  }
  await Promise.all(loads);
  function at(col,row){
    const x=mod(col,m.width),y=clamp(row,0,m.height-1),b=tiles.get(Math.floor(y/360)*12+Math.floor(x/360));
    return b?b[(y%360)*360+x%360]*m.metersPerUnit:0;
  }
  function meters(ll){
    const x=(ll[0]-m.west)/m.step,y=(m.north-ll[1])/m.step,ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
    return (1-fy)*((1-fx)*at(ix,iy)+fx*at(ix+1,iy))+fy*((1-fx)*at(ix,iy+1)+fx*at(ix+1,iy+1));
  }
  return ({w,h,z,llAt,blocked,wet,textAt,emit})=>{
    const step=16,cols=Math.ceil(w/step)+1,rows=Math.ceil(h/step)+1;
    const mesh=new Float32Array(cols*rows);
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++)mesh[y*cols+x]=meters(llAt(x*step,y*step));
    const ci=z<7?600:z<8.7?400:250,pxCap=w*h/210,labels=[],angles=[0,1,2,3];
    const fade=clamp((10.25-z)/.8,0,1);
    const ease=v=>{const t=clamp(v,0,1);return t*t*(3-2*t);};
    const regional=ease((z-6.0)/.65)*ease((8.55-z)/.60);
    let cellMeters=1;
    if(regional){
      const [lon,lat]=llAt(w/2,h/2),[lon2,lat2]=llAt(w/2+step,h/2);
      const dlon=mod(lon2-lon+180,360)-180;
      cellMeters=Math.max(1,111195*Math.hypot(dlon*Math.cos(lat*Math.PI/180),lat2-lat));
    }
    const elevationLabels=new Set();
    let count=0;
    for(let j=0;j<rows-1;j++)for(let i=0;i<cols-1;i++){
      const k=j*cols+i,heights=[mesh[k],mesh[k+1],mesh[k+cols+1],mesh[k+cols]];
      const low=Math.min(...heights),high=Math.max(...heights);
      if(high-low<1||count>pxCap)continue;
      const x=i*step,y=j*step,vx=[x,x+step,x+step,x],vy=[y,y,y+step,y+step];
      const levels=[];
      let slope=0,downX=0,downY=0,shade=0;
      if(regional&&high>0){
        const gx=(heights[1]+heights[2]-heights[0]-heights[3])*.5;
        const gy=(heights[2]+heights[3]-heights[0]-heights[1])*.5;
        const gradient=Math.hypot(gx,gy);
        slope=clamp((gradient/cellMeters-.008)/.040,0,1);
        if(slope){
          downX=-gx/gradient;downY=-gy/gradient;
          // A small number of press tones lets neighbouring cells share a
          // renderer batch instead of allocating one feature per ink station.
          shade=Math.round(clamp((downX+downY)*.7071,0,1)*3)/3;
        }
        slope=Math.round(slope*4)/4;
      }
      // Shelf break and deeper isobaths use waves only inside independently surveyed water.
      if(low< -160&&z<=9.3)for(const band of [-6000,-4500,-3200,-2400,-1600,-800,-400,-160])if(low<=band&&band<high)levels.push(band);
      for(let band=Math.max(ci,Math.ceil(low/ci)*ci);band<high;band+=ci)levels.push(band);
      // Additional half intervals are genuine elevation contours. They appear
      // only on sustained slopes where flat-country contours would add noise.
      if(regional*slope>.06){
        for(let band=Math.max(ci/2,Math.ceil((low-ci/2)/ci)*ci+ci/2);band<high;band+=ci)levels.push(band);
      }
      for(const level of levels){
        const crossings=[];
        for(const a of angles){
          const b=(a+1)%4;if((heights[a]<level)===(heights[b]<level))continue;
          const t=(level-heights[a])/(heights[b]-heights[a]);crossings.push([shift(vx,a,b,t),shift(vy,a,b,t)]);
        }
        for(let k=0;k+1<crossings.length;k+=2){
          const [a,b]=crossings.slice(k,k+2),dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
          if(len<3.3)continue;
          const n=Math.max(1,Math.round(len/(level<0?12.5:7.8))),angle=Math.atan2(dy,dx);
          const half=level>0&&level%ci!==0,strong=level%(ci*2)===0;
          // Short dashes follow the fall line on slopes facing away from the
          // north-west light. Each stems from its measured contour, like hachures.
          if(level>0&&!half&&regional*slope*shade>.22&&len>7){
            const px=(a[0]+b[0])*.5+downX*4.2,py=(a[1]+b[1])*.5+downY*4.2;
            if(!blocked(px,py))emit('land','-',px,py,8.2+1.6*slope,Math.atan2(downY,downX),
              regional*slope*shade*.75,'#637455');
          }
          for(let s=0;s<n;s++){
            const t=(s+.5)/n,px=a[0]+dx*t,py=a[1]+dy*t;
            if(level<0){
              if(wet?.(px,py)&&!textAt?.(px,py)){
                emit('bathymetry','~',px,py,9.8,angle,.66*fade,'#44818a');count++;
              }
              continue;
            }
            if(blocked(px,py))continue;
            if(half){
              emit('land','·',px,py,8.6,angle,.57*regional*slope,'#738469');
              continue;
            }
            const relief=regional*slope;
            const stroke=strong||relief>.38?'–':'·';
            const alpha=(strong?.61:.5)+regional*((strong?.35:.38)*slope-.09*(1-slope));
            const color=relief>.38?(strong?'#506447':'#66795a'):(strong?'#62705b':'#7a826c');
            emit('land',stroke,px,py,(strong?8.2:8.8)+relief*1.7,angle,alpha*fade,color);count++;
            const highLabel=relief>.47&&level>=ci*3&&!elevationLabels.has(level)&&i%5===2;
            if((strong&&i%15===2&&j%13===5||highLabel)&&(!regional||!elevationLabels.has(level)||regional<.5)&&labels.length<Math.ceil(w*h/215000)&&!labels.some(p=>Math.hypot(p[0]-px,p[1]-py)<195)&&!blocked(px+20,py-9)&&!blocked(px-20,py-9)){
              elevationLabels.add(level);
              labels.push([px,py]);let theta=angle;if(theta>Math.PI/2)theta-=Math.PI;if(theta< -Math.PI/2)theta+=Math.PI;
              emit('terrainName',level+' m',px,py-8,10.8,theta,.9*fade,'#5c7058');
            }
          }
        }
      }
    }
  };
}
