// Decode the sampled Equal Earth print positions into a GeoJSON source for the
// text-only layers. Each MultiPoint shares a character, typeface, angle and ink.
export function decodeFrame(motion,index){
  const phase=((Math.floor(index)%motion.frames.length)+motion.frames.length)%motion.frames.length;
  const raw=atob(motion.frames[phase]);
  const bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  const view=new DataView(bytes.buffer),groups=new Map();
  for(let o=0;o<view.byteLength;o+=motion.recordBytes){
    const styleId=view.getUint16(o+4,true),angle=view.getInt16(o+6,true),alpha=view.getUint8(o+8);
    const key=(styleId*4096+angle+1800)*256+alpha;
    let feature=groups.get(key);
    if(!feature){
      const style=motion.styles[styleId];
      feature={type:'Feature',properties:{b:style.b,t:style.t,s:style.s,e:angle/10,a:alpha/255},geometry:{type:'MultiPoint',coordinates:[]}};
      groups.set(key,feature);
    }
    feature.geometry.coordinates.push([view.getUint16(o,true)*(360/65535)-180,view.getUint16(o+2,true)*(180/65535)-90]);
  }
  return {type:'FeatureCollection',features:[...groups.values()]};
}
