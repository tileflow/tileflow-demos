// Browsers that send discrete line ticks or conventional pixel-wheel ticks can
// start the native camera immediately. Precision scrolling and OS pinch retain
// MapLibre's native gesture classifier. The zoom increment is MapLibre's wheel
// response curve; only the wait before the first camera frame is removed.
export function attachWheel(map,container){
  let last=0,target,direction=0,precisionUntil=0;
  function wheel(e){
    const now=performance.now(),v=e.deltaY;
    if(e.ctrlKey||e.metaKey||e.altKey||e.shiftKey||e.deltaX||!v||
        map.isRotating()||!map.scrollZoom.isEnabled())return;
    const line=e.deltaMode===WheelEvent.DOM_DELTA_LINE;
    const pixel=e.deltaMode===WheelEvent.DOM_DELTA_PIXEL;
    const unit=Math.abs(v);
    const conventional=line||pixel&&Number.isInteger(unit)&&unit>=80&&(unit%100===0||unit%40===0);
    if(!conventional){precisionUntil=now+240;target=undefined;return;}
    if(now<precisionUntil)return;
    const value=line?v*40:v;
    const increment=-Math.sign(value)*Math.log2(2/(1+Math.exp(-Math.abs(value)/450)));
    const zoom=map.getZoom(),sign=Math.sign(increment);
    // On reversal, cancel the untravelled part of the previous wheel burst.
    // The first opposing tick should move the map under the pointer back.
    const from=target!==undefined&&sign===direction&&now-last<220?target:zoom;
    direction=sign;
    target=Math.max(map.getMinZoom(),Math.min(map.getMaxZoom(),from+increment));last=now;
    e.preventDefault();e.stopPropagation();
    if(Math.abs(target-zoom)<1e-6)return;
    const rect=container.getBoundingClientRect(),around=map.unproject([e.clientX-rect.left,e.clientY-rect.top]);
    map.easeTo({around,zoom:target,duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:165,
      easing:t=>1-(1-t)*(1-t),essential:true,easeId:'wheel-atlas'},{originalEvent:e});
  }
  function reset(){target=undefined;}
  container.addEventListener('wheel',wheel,{capture:true,passive:false});
  container.addEventListener('pointerdown',reset,true);window.addEventListener('keydown',reset,true);
  return ()=>{container.removeEventListener('wheel',wheel,true);container.removeEventListener('pointerdown',reset,true);window.removeEventListener('keydown',reset,true);};
}
