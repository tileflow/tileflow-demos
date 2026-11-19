import {distance} from './streets.mjs';
/** Weld tile seams and split T-junctions, keeping bridges separate from ground streets. */
export function makeStreetGraph(lines){
 const segments=[],cells=new Map(),cellSize=25;
 for(const line of lines)for(let i=1;i<line.points.length;i++){
  const a=line.points[i-1],b=line.points[i];if(distance(a,b)<.15||distance(a,b)>2500)continue;
  const s={a,b,grade:line.grade??0,cuts:[0,1]};const id=segments.push(s)-1;
  for(let x=Math.floor(Math.min(a[0],b[0])/cellSize);x<=Math.floor(Math.max(a[0],b[0])/cellSize);x++)for(let z=Math.floor(Math.min(a[1],b[1])/cellSize);z<=Math.floor(Math.max(a[1],b[1])/cellSize);z++){const key=`${x}:${z}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(id);}
 }
 const checked=new Set();
 const project=(p,s)=>{const dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1];const t=((p[0]-s.a[0])*dx+(p[1]-s.a[1])*dz)/(dx*dx+dz*dz);return {t,d:distance(p,[s.a[0]+t*dx,s.a[1]+t*dz])};};
 for(const ids of cells.values())for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
  const key=`${Math.min(ids[i],ids[j])}:${Math.max(ids[i],ids[j])}`;if(checked.has(key))continue;checked.add(key);
  const a=segments[ids[i]],b=segments[ids[j]];if(a.grade!==b.grade)continue;
  const ax=a.b[0]-a.a[0],az=a.b[1]-a.a[1],bx=b.b[0]-b.a[0],bz=b.b[1]-b.a[1],den=ax*bz-az*bx;
  if(Math.abs(den)>.001){const dx=b.a[0]-a.a[0],dz=b.a[1]-a.a[1],u=(dx*bz-dz*bx)/den,v=(dx*az-dz*ax)/den;if(u>=0&&u<=1&&v>=0&&v<=1){a.cuts.push(u);b.cuts.push(v);}}
  for(const [first,second] of [[a,b],[b,a]])for(const p of [first.a,first.b]){const {t,d}=project(p,second);if(t>0&&t<1&&d<.75)second.cuts.push(t);}
 }
 // Bridge approaches can change grade at shared line endpoints. A crossing in
 // the middle of either line remains separated.
 const endpoints=new Map();for(const line of lines)for(const p of [line.points[0],line.points.at(-1)]){if(!p)continue;const key=`${Math.round(p[0])}:${Math.round(p[1])}`;if(!endpoints.has(key))endpoints.set(key,new Set());endpoints.get(key).add(line.grade??0);}
 const nodes=new Map(),edges=[],weld=new Map();
 const put=(p,grade)=>{const x=Math.round(p[0]),z=Math.round(p[1]);if((endpoints.get(`${x}:${z}`)?.size??0)>1)grade="approach";for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const id of weld.get(`${x+dx}:${z+dz}:${grade}`)??[]){if(distance(nodes.get(id).p,p)<.85)return id;}
  const id=`${p[0].toFixed(2)}:${p[1].toFixed(2)}:${grade}`;if(!nodes.has(id)){nodes.set(id,{id,p,links:[]});const key=`${x}:${z}:${grade}`;if(!weld.has(key))weld.set(key,[]);weld.get(key).push(id);}return id;};
 for(const s of segments){const cuts=[...new Set(s.cuts)].sort((a,b)=>a-b);for(let c=1;c<cuts.length;c++){const start=cuts[c-1],end=cuts[c],len=distance(s.a,s.b)*(end-start);if(len<.1)continue;const steps=Math.ceil(len/5);let previous;
  for(let j=0;j<=steps;j++){const t=start+(end-start)*j/steps,p=[s.a[0]+(s.b[0]-s.a[0])*t,s.a[1]+(s.b[1]-s.a[1])*t],id=put(p,s.grade);if(previous&&previous!==id&&!nodes.get(previous).links.some(l=>l.id===id)){const a=nodes.get(previous),b=nodes.get(id),cost=distance(a.p,b.p);a.links.push({id,cost});b.links.push({id:previous,cost});edges.push([a.p,b.p]);}previous=id;}
 }}
 return {nodes,edges};
}
/** Continue around a bend while a key is held; a fresh key can reverse direction. */
export function chooseStep(graph,node,vector,previous,allowReverse=false){
 let best,score=-Infinity;const forward=node.links.filter(l=>l.id!==previous);
 for(const link of node.links){if(!allowReverse&&forward.length&&link.id===previous)continue;const next=graph.nodes.get(link.id);if(!next)continue;const d=distance(node.p,next.p);if(d<.01)continue;const dot=((next.p[0]-node.p[0])*vector[0]+(next.p[1]-node.p[1])*vector[1])/d;if(dot>score){best=next;score=dot;}}
 return best;
}
