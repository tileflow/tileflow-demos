export const TILE = 40075016.686 * Math.cos(48.8566 * Math.PI/180) / 16384;
export const RADIUS = 119;
export const GRID = 96;
export const ANCHOR = [8299,5637];

export function world(lon,lat){
  return [(lon+180)/360*16384,(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*16384];
}
export function geo(x,y){
  return [x/16384*360-180,Math.atan(Math.sinh(Math.PI*(1-2*y/16384)))*180/Math.PI];
}
export function cellAt(lon,lat){
  const [x,y]=world(lon,lat);
  const sx=(x-ANCHOR[0])*TILE/RADIUS, sy=(y-ANCHOR[1])*TILE/RADIUS;
  const a=sx/Math.sqrt(3)-sy/3, b=sy*2/3, c=-a-b;
  let q=Math.floor(a+.5), r=Math.floor(b+.5);
  const t=Math.floor(c+.5), dq=Math.abs(q-a), dr=Math.abs(r-b);
  if(dq>dr && dq>Math.abs(t-c)) q=-r-t;
  else if(dr>Math.abs(t-c)) r=-q-t;
  return [q,r];
}
export function centerOf(q,r){
  return geo(ANCHOR[0]+Math.sqrt(3)*RADIUS*(q+r/2)/TILE,ANCHOR[1]+r*1.5*RADIUS/TILE);
}
