const ns='http://www.w3.org/2000/svg';
const phases=6;
const duration=6.8;
const symbols={
  tree:{glyph:'♣',color:'#58744d'},
  wood:{glyph:'∧',color:'#788963'},
  grass:{glyph:'′',color:'#839365'},
};

export function treeBreeze({view,plants},pad){
  if(!plants.length)return null;
  const svg=document.createElementNS(ns,'svg');
  svg.classList.add('tree-breeze');
  svg.style.cssText='position:absolute;left:-'+pad+'px;top:-'+pad+'px';
  svg.setAttribute('width',view.w+2*pad);svg.setAttribute('height',view.h+2*pad);
  svg.setAttribute('viewBox',[-pad,-pad,view.w+2*pad,view.h+2*pad].join(' '));
  const world=512*2**view.z, groups=new Map();
  const left=view.x*world-view.w/2,top=view.y*world-view.h/2;
  for(const [x,y,kind] of plants){
    // Anchor the front of the gust in geographic space, including across pans and tile seams.
    const wave=((x+left)+.38*(y+top))*2**(16-view.z)/270;
    const phase=Math.floor((wave-Math.floor(wave))*phases),key=kind+'/'+phase;
    if(!groups.has(key))groups.set(key,{kind,phase,xs:[],ys:[]});
    const group=groups.get(key);group.xs.push(x.toFixed(1));group.ys.push(y.toFixed(1));
  }
  const clips=[];
  for(const {kind,phase,xs,ys} of groups.values()){
    const text=document.createElementNS(ns,'text');
    const {glyph,color}=symbols[kind];
    text.setAttribute('data-plant',kind);
    text.setAttribute('x',xs.join(' '));text.setAttribute('y',ys.join(' '));
    text.setAttribute('font-family','Georgia,serif');text.setAttribute('fill',color);
    const size=kind==='tree'?Math.min(20,14+(view.z-15)*2):kind==='grass'?14:12;
    text.setAttribute('font-size',size);text.setAttribute('text-anchor','middle');
    text.textContent=glyph.repeat(xs.length);
    svg.append(text);
    const amplitude=kind==='tree'?1.4:.8;
    const animation=text.animate([
      {transform:`translateX(${-amplitude}px)`}, {transform:`translateX(${amplitude}px)`},
      {transform:`translateX(${-amplitude}px)`},
    ],{duration:duration*1000,iterations:Infinity,easing:'ease-in-out'});
    animation.currentTime=((document.timeline.currentTime??0)+duration*1000*phase/phases)%(duration*1000);
    clips.push({animation});
  }
  return {svg,clips};
}
