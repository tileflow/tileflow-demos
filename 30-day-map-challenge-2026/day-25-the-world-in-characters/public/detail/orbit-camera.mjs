// Tileflow's spherical camera measures zoom at the centre latitude. Its minimum
// zoom is specified at the equator and compensated by the renderer during a pan.
export const homeCenter=[-18,17];
const latitudeFactor=lat=>Math.cos(Math.min(85.051129,Math.abs(lat))*Math.PI/180);

export function equatorialFit(container){
  const {width,height}=container.getBoundingClientRect();
  const radius=.46*Math.min(width,height),focal=1.5*height;
  const tangent=radius/focal;
  const globeRadius=radius*(tangent+Math.hypot(1,tangent));
  return Math.log2(2*Math.PI*globeRadius/512);
}

export function globeHome(container,center=homeCenter){
  return {center,zoom:equatorialFit(container)+Math.log2(latitudeFactor(center[1])),bearing:0,pitch:0};
}

export function chartHome(container){
  const {width,height}=container.getBoundingClientRect();
  const margin=Math.max(5,Math.min(width,height)*.012);
  return {center:[0,0],zoom:Math.log2(Math.min(width-2*margin,(height-2*margin)*2.056)/512),pitch:0,bearing:0};
}

export function chartBoundary(container,latitude){
  const fittedZoom=equatorialFit(container)+Math.log2(latitudeFactor(latitude));
  // Coast dashes on the globe have fixed geographic spacing. Beyond this
  // reading scale the atlas must typeset them again, even on a tall screen.
  // Leave room to rotate a fitted globe on exceptionally large displays.
  return Math.max(fittedZoom+.38,Math.min(3.68,Math.max(3.55,fittedZoom+.88)));
}

export function readCamera(container){
  const query=new URLSearchParams(location.search);
  const valid=['z','lat','lon'].every(k=>query.has(k)&&query.get(k).trim()!==''&&Number.isFinite(+query.get(k)));
  if(!valid)return globeHome(container);
  const center=[wrapLongitude(+query.get('lon')),Math.max(-90,Math.min(90,+query.get('lat')))];
  return {center,zoom:Math.max(globeHome(container,center).zoom,Math.min(20,+query.get('z'))),pitch:0,bearing:0};
}

export const wrapLongitude=lon=>((lon+180)%360+360)%360-180;

// Symbols anchored just inside the native horizon can extend into the margin.
// Clip only the canvas paint, leaving Tileflow's full gesture surface intact.
export function clipAtHorizon(map){
  const canvas=map.getCanvas();
  let width=canvas.clientWidth,height=canvas.clientHeight,last;
  function update(){
    const radius=512*2**map.getZoom()/(2*Math.PI*latitudeFactor(map.getCenter().lat));
    const apparent=radius/Math.sqrt(1+2*radius/(1.5*height));
    const next=apparent>=Math.hypot(width,height)/2+1?'none':'circle('+apparent.toFixed(2)+'px at 50% 50%)';
    if(next!==last){canvas.style.clipPath=next;last=next;}
  }
  map.on('move',update);
  map.on('resize',()=>{width=canvas.clientWidth;height=canvas.clientHeight;update();});
  update();
}
