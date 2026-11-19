export const ORIGIN = [-3.7001, 40.4145];
const R = 6378137;
let originMeters;
const mercator=p=>[R*p[0]*Math.PI/180,-R*Math.log(Math.tan(Math.PI/4+Math.max(-85,Math.min(85,p[1]))*Math.PI/360))];
export function setOrigin(point){ORIGIN.splice(0,2,...point);originMeters=mercator(ORIGIN);}
setOrigin(ORIGIN);
/** Coordinates share the renderer's local Mercator scale, at any latitude. */
export const toLocal = point => {const p=mercator(point),scale=Math.cos(ORIGIN[1]*Math.PI/180);let dx=p[0]-originMeters[0];const world=2*Math.PI*R;dx=((dx+world/2)%world+world)%world-world/2;return [dx*scale,(p[1]-originMeters[1])*scale];};
export const toLngLat = point => {const scale=Math.cos(ORIGIN[1]*Math.PI/180);return [(originMeters[0]+point[0]/scale)/R*180/Math.PI,(2*Math.atan(Math.exp(-(originMeters[1]+point[1]/scale)/R))-Math.PI/2)*180/Math.PI];};
export const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function makeGraph(data) {
  const nodes = new Map();
  const edges = [];
  const put = (id, p) => { if (!nodes.has(id)) nodes.set(id, {id, p, links: []}); };
  for (const way of data.elements) {
    if (way.tags?.access === 'private' || way.tags?.foot === 'no' || way.tags?.tunnel === 'yes') continue;
    for (let i = 1; i < way.nodes.length; i++) {
      const ga = way.geometry[i - 1], gb = way.geometry[i];
      const a = toLocal([ga.lon, ga.lat]), b = toLocal([gb.lon, gb.lat]);
      if (distance(a, b) > 350) continue;
      put(way.nodes[i - 1], a); put(way.nodes[i], b);
      const count = Math.max(1, Math.ceil(distance(a, b) / 5));
      let previous = way.nodes[i - 1];
      for (let j = 1; j <= count; j++) {
        const id = j === count ? way.nodes[i] : `${way.id}:${i}:${j}`;
        put(id, [a[0] + (b[0] - a[0]) * j / count, a[1] + (b[1] - a[1]) * j / count]);
        const cost = distance(nodes.get(previous).p, nodes.get(id).p);
        if (cost > 0.01) {
          nodes.get(previous).links.push({id, cost});
          nodes.get(id).links.push({id: previous, cost});
          edges.push([nodes.get(previous).p, nodes.get(id).p]);
        }
        previous = id;
      }
    }
  }
  return {nodes,edges};
}

export function nearest(graph, point) {
  let best, bestDistance = Infinity;
  for (const node of graph.nodes.values()) {
    const d = distance(node.p, point);
    if (d < bestDistance) { best = node; bestDistance = d; }
  }
  return best;
}

export function shortestPath(graph,start,end){
 if(!graph.nodes.has(start)||!graph.nodes.has(end))return [];
 const costs=new Map([[start,0]]),previous=new Map(),heap=[];
 const push=(id,cost)=>{let i=heap.length;heap.push({id,cost});while(i){const p=(i-1)>>1;if(heap[p].cost<=cost)break;heap[i]=heap[p];i=p;}heap[i]={id,cost};};
 const pop=()=>{const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&heap[child+1].cost<heap[child].cost)child++;if(heap[child].cost>=last.cost)break;heap[i]=heap[child];i=child;}heap[i]=last;}return first;};
 push(start,0);while(heap.length){const {id,cost}=pop();if(cost!==costs.get(id))continue;if(id===end)break;for(const link of graph.nodes.get(id).links){const next=cost+link.cost;if(next<(costs.get(link.id)??Infinity)){costs.set(link.id,next);previous.set(link.id,id);push(link.id,next);}}}
 if(!costs.has(end))return [];const path=[end];while(path.at(-1)!==start)path.push(previous.get(path.at(-1)));return path.reverse();
}

export function makeRoute(points) {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative.at(-1) + distance(points[i - 1], points[i]));
  return {points, cumulative, length: cumulative.at(-1) ?? 0};
}

export function sampleRoute(route, travelled) {
  if (!route.points.length) return {p:[0,0],heading:0};
  if (route.points.length === 1) return {p:[...route.points[0]],heading:0};
  const d = Math.max(0, Math.min(route.length, travelled));
  let i = 1;
  while (i < route.cumulative.length - 1 && route.cumulative[i] < d) i++;
  const a = route.points[i - 1], b = route.points[i];
  const t = (d - route.cumulative[i - 1]) / Math.max(0.001, route.cumulative[i] - route.cumulative[i - 1]);
  return {p:[a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],heading:Math.atan2(b[0] - a[0], b[1] - a[1])};
}
