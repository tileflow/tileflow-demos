const ns='http://www.w3.org/2000/svg',bands=16,period=3900;
const frames=Array.from({length:17},(_,i)=>{
  const a=i*2*Math.PI/16,s=Math.sin(a);
  return {transform:'translate('+((1.8*s).toFixed(2))+'px,'+((-2.5*Math.sin(a-.35)).toFixed(2))+'px)',opacity:.83+.16*s};
});

export function waveType(group,sheet){
  const {view,waves,shore}=sheet,world=512*2**view.z;
  const left=view.x*world-view.w/2,top=view.y*world-view.h/2;
  const buckets=Array.from({length:bands},()=>({water:[],shore:[],river:[]}));
  for(const [marks,key] of [[waves,'water'],[shore,'shore'],[sheet.contours.get('streams')?.points??[],'river']]){
    for(const p of marks){
      const phase=((left+p[0])*.82-(top+p[1])*.57)/156;
      buckets[Math.floor((phase-Math.floor(phase))*bands)][key].push(p);
    }
  }
  const animations=[];
  for(const [phase,bucket] of buckets.entries()){
    if(!bucket.water.length&&!bucket.shore.length&&!bucket.river.length)continue;
    const band=document.createElementNS(ns,'g');band.setAttribute('data-wave-phase',phase);
    for(const key of ['water','shore','river']){
      const pts=bucket[key];if(!pts.length)continue;
      const text=document.createElementNS(ns,'text');
      text.setAttribute('x',pts.map(p=>p[0].toFixed(1)).join(' '));
      text.setAttribute('y',pts.map(p=>p[1].toFixed(1)).join(' '));
      if(key!=='water'){text.setAttribute('rotate',pts.map(p=>Math.round(p[2])).join(' '));text.setAttribute('font-size',key==='shore'?'11':'9');}
      text.setAttribute('fill',key==='water'?'#458087':'#668c8c');
      text.textContent=(key==='water'?'≈':'~').repeat(pts.length);band.append(text);
    }
    group.append(band);
    const animation=band.animate(frames,{duration:period,iterations:Infinity});
    const now=document.timeline.currentTime??0;
    animation.currentTime=((now-period*phase/bands)%period+period)%period;
    animations.push({animation});
  }
  return animations;
}
