// Equal Earth ends at a physical cut at 180°. When a detailed camera reaches
// that cut, a wrapped native Mercator chart keeps islands, roads and tiles
// contiguous. The full-extent engraving always uses its original projection.
const canonical=lng=>((lng+180)%360+360)%360-180;

export function attachAntimeridian(map,onChange){
  const overviewProjection=map.getProjection();
  let wrapped=false,changing=false;
  function update(){
    if(changing)return;
    const c=map.getCenter(),z=map.getZoom(),canvas=map.getCanvas();
    const gap=180-Math.abs(canonical(c.lng));
    // The silhouette leans near the poles. Include some viewport height in
    // the approach margin, then use a wider exit margin to avoid oscillation.
    const halfView=(canvas.clientWidth+.65*canvas.clientHeight)*180/(512*2**z);
    const latitudeScale=1/Math.max(.53,Math.cos(c.lat*Math.PI/180));
    const margin=Math.min(65,halfView*latitudeScale);
    // Wrap the first regional view at the date line. On the way out a pinch
    // can still be holding this canvas while the globe prepares its frame.
    // Leave the wrapped projection when the camera clears the cut.
    const use=(wrapped||z>=3.40)&&Math.abs(c.lat)<84.5&&gap<margin*(wrapped?1.5:1.17);
    if(use===wrapped)return;
    changing=true;wrapped=use;
    try{
      map.setProjection(use?{type:'mercator'}:overviewProjection);
      map.setRenderWorldCopies(use);
      // Preserve the exact geographical camera even after panning around the world.
      const lng=use?c.lng:canonical(c.lng),actual=map.getCenter();
      if(Math.abs(actual.lng-lng)>1e-8||Math.abs(actual.lat-c.lat)>1e-8||Math.abs(map.getZoom()-z)>1e-8){
        map.jumpTo({center:[lng,c.lat],zoom:z});
      }
      onChange();
    }finally{changing=false;}
  }
  map.on('move',update);map.on('resize',update);update();
  return ()=>{map.off('move',update);map.off('resize',update);};
}
