// Country outlines: Natural Earth 1:110m Admin 0, public domain.
// This generalized edition is shown only at atlas scales. Tileflow World takes over on approach.
import {sampleLine,glyphString} from './glyph-contours.js';
import countries from './data/countries-110m.json';
import {mercator} from './type-layout.js';

const ns='http://www.w3.org/2000/svg';
const element=(tag,attrs={})=>{const node=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);return node;};
const inks=['#986446','#62774e','#96794c','#577775','#946353','#70724b'];
const countriesByVertex=new Map(),sharedEdges=new Set();
function uniqueContours(rings){
  const result=[];
  for(const ring of rings){
    let part=[];
    for(let i=1;i<ring.length;i++){
      const a=ring[i-1],b=ring[i],sa=a.join(','),sb=b.join(','),key=sa<sb?sa+'/'+sb:sb+'/'+sa;
      if(sharedEdges.has(key)){if(part.length)result.push(part);part=[];continue;}
      sharedEdges.add(key);if(!part.length)part.push(a);part.push(b);
    }
    if(part.length)result.push(part);
  }
  return result;
}
const plates=countries.features.map((f,i)=>{
  const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
  const neighbors=new Set();
  const shapes=polygons.map(polygon=>{
    const rings=polygon.map(ring=>ring.map(c=>{
      const key=c.join(',');
      const owners=countriesByVertex.get(key)??[];for(const owner of owners)if(owner!==i)neighbors.add(owner);
      if(owners.at(-1)!==i){owners.push(i);countriesByVertex.set(key,owners);}
      return mercator(c);
    }));
    const exterior=rings[0],xs=exterior.map(p=>p[0]),ys=exterior.map(p=>p[1]);
    return {rings,edges:uniqueContours(rings),bounds:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]};
  });
  return {name:f.properties.name,shapes,neighbors};
});
for(const [i,plate] of plates.entries()){
  const used=new Set([...plate.neighbors].map(j=>plates[j].ink));
  plate.ink=inks.slice(i%inks.length).concat(inks.slice(0,i%inks.length)).find(c=>!used.has(c))??inks[i%inks.length];
}

export function countryPrint(view){
  if(view.z>=4.6)return null;
  const {w,h,z}=view,world=512*2**z,pad=100;
  const left=view.x-w/(2*world),top=view.y-h/(2*world);
  const x=n=>(n-left)*world,y=n=>(n-top)*world;
  const svg=element('svg',{width:w+2*pad,height:h+2*pad,viewBox:[-pad,-pad,w+2*pad,h+2*pad].join(' '),'aria-hidden':true});
  svg.classList.add('country-print');svg.style.left=-pad+'px';svg.style.top=-pad+'px';
  const defs=element('defs');svg.append(defs);
  const scale=Math.min(1,Math.max(0,(4.6-z)/1.35));
  const dx=5.45,dy=9.0,outline=[],seen=new Set();
  for(const [i,p] of plates.entries()){
    const parts=[];
    for(const {rings,edges,bounds:[a,b,c,d]} of p.shapes){
      if(x(c)<-pad||x(a)>w+pad||y(d)<-pad||y(b)>h+pad)continue;
      if(z<4.5)for(const edge of edges)sampleLine(edge.map(([a,b])=>[x(a),y(b)]),view,5.7,(px,py,angle)=>{
          const key=Math.round(px/3)+','+Math.round(py/3);
          if(!seen.has(key)){seen.add(key);outline.push([px,py,angle]);}
        });
      for(const ring of rings){
        parts.push('M'+ring.map(([a,b])=>x(a).toFixed(1)+' '+y(b).toFixed(1)).join('L')+'Z');
      }
    }
    if(!parts.length)continue;
    const name=p.name.toLocaleUpperCase('es')+' · ',width=dx*name.length,id='country-type-'+i;
    const pat=element('pattern',{id,patternUnits:'userSpaceOnUse',x:(-left*world)%width,y:(-top*world)%(dy*2),width,height:dy*2});
    for(let j=0;j<2;j++){
      const label=element('text',{x:j?-width*.5:0,y:dy*(j+1)-1.3,fill:p.ink,'font-family':'monospace','font-size':8.7,'font-weight':'600',textLength:width*2,lengthAdjust:'spacingAndGlyphs','xml:space':'preserve'});
      label.textContent=name.repeat(2);pat.append(label);
    }
    defs.append(pat);
    const path=element('path',{d:parts.join(''),'fill-rule':'evenodd',fill:'url(#'+id+')','fill-opacity':.91*scale});
    svg.append(path);
  }
  if(outline.length){const edge=glyphString(outline,'-',8,'#65513f');edge.dataset.geometry='countrySilhouettes';svg.append(edge);}
  return svg;
}
