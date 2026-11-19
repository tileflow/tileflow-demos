/** Sparse persistent exploration with a sliding GPU window; no neighbourhood boundary. */
export function createExploration(size=512,min=-700,span=1400){
 const data=new Uint8Array(size*size),cells=new Map(),step=span/(size-1);let ix=Math.round(min/step),iz=ix;
 const key=(x,z)=>`${x}:${z}`;
 const field={data,size,min,span,minX:ix*step,minZ:iz*step,
  focus(x,z){const cx=Math.round(x/step),cz=Math.round(z/step);if(Math.abs(cx-(ix+size/2))<size/5&&Math.abs(cz-(iz+size/2))<size/5)return false;ix=cx-Math.floor(size/2);iz=cz-Math.floor(size/2);field.minX=ix*step;field.minZ=iz*step;for(let j=0;j<size;j++)for(let i=0;i<size;i++)data[j*size+i]=cells.get(key(ix+i,iz+j))??0;return true;},
  reveal(x,z,radius=45){let dirty=field.focus(x,z);for(let j=Math.floor((z-radius)/step);j<=Math.ceil((z+radius)/step);j++)for(let i=Math.floor((x-radius)/step);i<=Math.ceil((x+radius)/step);i++){const d=Math.hypot(i*step-x,j*step-z)/radius,u=Math.max(0,Math.min(1,(1-d)/.32)),value=Math.round(u*u*(3-2*u)*255),k=key(i,j);if(value>(cells.get(k)??0)){cells.set(k,value);const px=i-ix,pz=j-iz;if(px>=0&&pz>=0&&px<size&&pz<size)data[pz*size+px]=value;dirty=true;}}return dirty;},
  sample(x,z){return (cells.get(key(Math.round(x/step),Math.round(z/step)))??0)/255;},
  reset(){data.fill(0);cells.clear();}
 };return field;
}

/** Ease the radius of the next permanent brush stamp in every direction. */
export function advanceSniffBoost(current, dt, sniffing, held, reduced = false) {
 const target = sniffing ? (held ? 20 : 11) : 0;
 const blend = reduced ? 1 : 1 - Math.exp(-Math.max(0, dt) * 3.7);
 const next = current + (target - current) * blend;
 return Math.abs(next - target) < .05 ? target : next;
}

/** Limit tilt before a roof can intersect the sightline to the dog's head. */
export function safeCameraPitch(position,bearing,buildings,preferred=47){
 const a=bearing*Math.PI/180,dir=[-Math.sin(a),Math.cos(a)],side=[Math.cos(a),Math.sin(a)];let pitch=preferred;
 for(const b of buildings){if(Math.hypot(b.center[0]-position[0],b.center[1]-position[1])>180)continue;
  for(const offset of [-2,0,2]){const origin=[position[0]+side[0]*offset,position[1]+side[1]*offset];
   for(let i=1;i<b.ring.length;i++){const p=b.ring[i-1],q=b.ring[i],ex=q[0]-p[0],ez=q[1]-p[1],den=dir[0]*ez-dir[1]*ex;if(Math.abs(den)<1e-8)continue;
    const px=p[0]-origin[0],pz=p[1]-origin[1],t=(px*ez-pz*ex)/den,u=(px*dir[1]-pz*dir[0])/den;
    if(t>1&&t<150&&u>=0&&u<=1)pitch=Math.min(pitch,Math.atan2(Math.max(.1,t-2),Math.max(1,b.height+4-3))*180/Math.PI);
   }
  }
 }return Math.max(0,pitch);
}
