// Seconds since the first Iberian frame. Longitude, latitude and log scale
// have independently continuous velocities through both joins.
const route=[
  [0,-3.55,40.25,5.25],[1.08,-2.50,40.70,5.45],[2.73,.57,42.12,6.17],
  [3.67,1.68,42.55,6.59],[4.55,2.55,42.72,6.61],[5.75,4.78,43.23,6.32],
  [6.49,5.70,43.30,6.40],[7.32,7.32,43.81,6.48],[8.08,8.93,44.36,6.68],
  [8.99,10.90,45.10,7.48],[9.78,11.83,45.33,8.88],[10.42,12.126,45.434,10.29],
  [10.74,12.209,45.448,10.76],[11,12.2525,45.4475,11]
];
const start=[0,.58,.18,.16],end=[0,.118,-.015,.65];
export function camera(t){
  const k=Math.max(0,route.findLastIndex(row=>row[0]<=t)),j=Math.min(k,route.length-2),h=route[j+1][0]-route[j][0];
  function coordinate(a){
    const secant=i=>(route[i+1][a]-route[i][a])/(route[i+1][0]-route[i][0]);
    function slope(i){
      if(!i)return start[a];if(i===route.length-1)return end[a];
      const x=secant(i-1),y=secant(i);
      return x*y>0?2*x*y/(x+y):0;
    }
    const u=(t-route[j][0])/h;
    return (1+2*u)*(1-u)**2*route[j][a]+u*(1-u)**2*h*slope(j)+
      u*u*(3-2*u)*route[j+1][a]+u*u*(u-1)*h*slope(j+1);
  }
  return {center:[coordinate(1),coordinate(2)],z:coordinate(3),t};
}
