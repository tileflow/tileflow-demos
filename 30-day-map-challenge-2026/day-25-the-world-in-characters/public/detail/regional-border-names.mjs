import {borderBounds,portugal,spain} from './iberia-border-rings.mjs?v=regional-20261125b';

function inside([x,y],ring){
  let result=false;
  for(let j=0;j<ring.length-1;j++){
    const [a,b]=ring[j],[c,d]=ring[j+1];
    if((b>y)!==(d>y)&&x<a+(c-a)*(y-b)/(d-b))result=!result;
  }
  return result;
}

function crosses(a,b,c,d){
  const side=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  return side(a,b,c)*side(a,b,d)<0&&side(c,d,a)*side(c,d,b)<0;
}

function contained(box,ring,llAt){
  const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>llAt(
    box.x+box.hw*u*box.u-box.hh*v*box.v,box.y+box.hw*u*box.v+box.hh*v*box.u));
  if(!corners.every(p=>inside(p,ring)))return false;
  // A curved frontier can re-enter a label box even when its four corners fit.
  for(let i=0;i<4;i++)for(let j=1;j<ring.length;j++){
    if(crosses(corners[i],corners[(i+1)%4],ring[j-1],ring[j]))return false;
  }
  return true;
}

const names=[['ESPAÑA',spain],['PORTUGAL',portugal]];

function crossesBox(line,box){
  const local=([x,y])=>[(x-box.x)*box.u+(y-box.y)*box.v,
    -(x-box.x)*box.v+(y-box.y)*box.u];
  const corners=[[-box.hw,-box.hh],[box.hw,-box.hh],[box.hw,box.hh],[-box.hw,box.hh]];
  let a=local(line[0]);
  for(let i=1;i<line.length;i++){
    const b=local(line[i]);
    if(Math.abs(b[0])<=box.hw&&Math.abs(b[1])<=box.hh)return true;
    if(Math.min(a[0],b[0])<=box.hw&&Math.max(a[0],b[0])>=-box.hw&&
      Math.min(a[1],b[1])<=box.hh&&Math.max(a[1],b[1])>=-box.hh&&
      corners.some((c,j)=>crosses(a,b,c,corners[(j+1)%4])))return true;
    a=b;
  }
  return false;
}

export function printBorderNames({z,region,bounds,w,h,pad=0,linework,llAt,where,space,inkSpace,emit}){
  // Broad national labels are already present below this regional interval.
  if(!(z>=6.85&&z<8.55&&region>.2))return 0;
  const [west,south,east,north]=borderBounds;
  if(bounds[0]>east+.16||bounds[2]<west-.16||bounds[1]>north+.16||bounds[3]<south-.16)return 0;
  const size=11.6+1.1*region,half=3.15*size,stations=[];
  const margin=pad+8;
  for(const {b,priority,path} of linework){
    if(b!=='border'||priority!==0||path.length<2*half)continue;
    for(let d=half;d<=path.length-half;d+=10){
      const [x,y]=where(path,d);
      if(x<margin+16||y<margin+16||x>w-margin-16||y>h-margin-16)continue;
      const [lon,lat]=llAt(x,y);
      if(lon<west-.12||lon>east+.12||lat<south-.12||lat>north+.12)continue;
      const a=where(path,d-half),c=where(path,d+half);
      const dx=c[0]-a[0],dy=c[1]-a[1],length=Math.hypot(dx,dy);
      if(length<1.67*half)continue;
      const bend=Math.abs((x-a[0])*dy-(y-a[1])*dx)/length;
      if(bend>9)continue;
      let angle=Math.atan2(dy,dx);
      if(angle>Math.PI/2)angle-=Math.PI;
      if(angle< -Math.PI/2)angle+=Math.PI;
      const score=Math.hypot((x-w*.5)/w,(y-h*.5)/h)+bend*.012;
      stations.push({x,y,angle,score,line:path.line});
    }
  }
  stations.sort((a,b)=>a.score-b.score);
  for(const {x,y,angle,line} of stations){
    const nx=-Math.sin(angle),ny=Math.cos(angle);
    for(const offset of [16,23,31]){
      const left=[x+nx*offset,y+ny*offset],right=[x-nx*offset,y-ny*offset];
      const centres=inside(llAt(...left),spain)?[left,right]:[right,left];
      const boxes=names.map(([word],i)=>space.rect(...centres[i],word.length*size*.64+6,size*1.28+4,angle));
      if(!boxes.every((box,i)=>box.x-box.extX>margin&&box.x+box.extX<w-margin&&
        box.y-box.extY>margin&&box.y+box.extY<h-margin&&!space.overlaps(box)&&
        !crossesBox(line,box)&&contained(box,names[i][1],llAt)))continue;
      for(let i=0;i<boxes.length;i++){
        const box=boxes[i];space.add(box);
        if(inkSpace!==space)inkSpace.add(box);
        emit('regionLabel',names[i][0],box.x,box.y,size,angle,Math.min(.96,region*1.5),'#66546d',undefined,0,{});
      }
      return 2;
    }
  }
  return 0;
}
