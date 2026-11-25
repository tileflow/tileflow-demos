import {cameraContext} from './projector.mjs?v=regional-reading-1';

const turn=Math.PI*2;
const baseSpacing=512/Math.sqrt(40*36);
const mod=(n,m)=>((n%m)+m)%m;
const earth=cameraContext({matrix:{merc:false,p0:[0,0],v0:[0,0],sx:1,sy:0,tx:0,ty:1}});
const pole=earth.project([0,90])[1]/turn;
function earthHalfWidth(y){
  const lat=earth.unproject([0,Math.min(pole,Math.abs(y-.5))*turn])[1];
  return earth.project([180,lat])[0]/turn;
}

function hash(col,row,level){
  let n=Math.imul(col^Math.imul(level,0x85ebca6b),0x27d4eb2d)^Math.imul(row,0x165667b1);
  n=Math.imul(n^(n>>>15),0x2c1b3c6d);
  return (n^(n>>>12))>>>0;
}

// Each projected cell keeps its station in one child. A change in spacing
// selects the number of stations without ever moving an existing one.
export function areaStations(width,height,matrix,visit,spacing=baseSpacing){
  if(!matrix||typeof matrix.merc!=='boolean')return false;
  const {sx,sy,tx,ty,p0,v0}=matrix;
  const xx=turn*sx,xy=turn*sy,yx=-turn*tx,yy=-turn*ty,det=xx*yy-xy*yx;
  if(!Number.isFinite(det)||Math.abs(det)<1e-8)return false;
  const cx=.5+p0[0]/turn,cy=.5-p0[1]/turn;
  let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
  for(const x of [0,width])for(const y of [0,height]){
    const dx=x-v0[0],dy=y-v0[1],wx=cx+(yy*dx-yx*dy)/det,wy=cy+(xx*dy-xy*dx)/det;
    left=Math.min(left,wx);right=Math.max(right,wx);top=Math.min(top,wy);bottom=Math.max(bottom,wy);
  }
  let interiorHalfWidth=Infinity;
  if(!matrix.merc){
    // Equal Earth ends at its curved meridians and poles. Its unproject
    // clamps past that edge, which would otherwise duplicate boundary marks.
    top=Math.max(top,.5-pole);bottom=Math.min(bottom,.5+pole);
    if(top>bottom)return true;
    const outerWidth=earthHalfWidth(Math.max(top,Math.min(.5,bottom)));
    left=Math.max(left,.5-outerWidth);right=Math.min(right,.5+outerWidth);
    if(left>right)return true;
    interiorHalfWidth=earthHalfWidth(Math.abs(top-.5)>Math.abs(bottom-.5)?top:bottom);
  }
  // The native camera supplies the physical scale, including its local
  // projection correction. Ordinary zoom maps exactly to one octave.
  const effective=Math.max(0,Math.min(22,Math.log2(Math.sqrt(Math.abs(det))/512*baseSpacing/spacing)));
  const level=Math.floor(effective),fraction=effective-level;
  const last=fraction>1e-8?level+1:level;
  const admission=(4**fraction-1)/3;
  const feather=.7*Math.min(.2,admission,1-admission);
  function cell(depth,col,row,wx,wy,key,u,v,sample,born){
    const nx=40*2**depth,ny=36*2**depth;
    if(col+1<left*nx||col>right*nx||row+1<top*ny||row>bottom*ny)return;
    if(key===null){
      const wrapped=matrix.merc?mod(col,nx):col;
      key=hash(wrapped,row,depth);
      wx=(col+.24+.52*(key&65535)/65535)/nx;
      wy=(row+.24+.52*(key>>>16)/65535)/ny;
      u=wrapped*.31+row*.11;
      v=wrapped*.09-row*.37;
      sample=key%11;
      born=depth;
    }
    if(depth===last){
      let alpha=1;
      if(depth>level&&born===depth){
        const threshold=(((key>>>8)&65535)+.5)/65536;
        const t=Math.min(1,Math.max(0,.5+(admission-threshold)/(2*feather)));
        alpha=t*t*(3-2*t);
        if(alpha<.02)return;
      }
      if(wx<left||wx>right||wy<top||wy>bottom)return;
      if(Math.abs(wx-.5)>interiorHalfWidth&&Math.abs(wx-.5)>earthHalfWidth(wy))return;
      const dx=wx-cx,dy=wy-cy,x=v0[0]+xx*dx+yx*dy,y=v0[1]+xy*dx+yy*dy;
      if(x>=0&&x<=width&&y>=0&&y<=height)visit(x,y,u,v,sample,alpha);
      return;
    }
    const ownerX=Math.floor(wx*nx*2),ownerY=Math.floor(wy*ny*2);
    for(let j=0;j<2;j++)for(let i=0;i<2;i++){
      const childX=col*2+i,childY=row*2+j;
      cell(depth+1,childX,childY,wx,wy,childX===ownerX&&childY===ownerY?key:null,u,v,sample,born);
    }
  }
  for(let row=Math.max(0,Math.floor(top*36));row<=Math.min(35,Math.floor(bottom*36));row++){
    for(let col=Math.floor(left*40);col<=Math.floor(right*40);col++){
      cell(0,col,row,0,0,null,0,0,0,0);
    }
  }
  return true;
}

// Existing standalone atlas scripts still use this name for the water mesh.
export {areaStations as waterStations};
