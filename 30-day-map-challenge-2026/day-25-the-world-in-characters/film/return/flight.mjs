// One camera. The increasing ground speed follows the growing field of view.
// Wide atlas editions and the globe are projected on this same camera clock.
export const length=183,width=960,height=540,dpr=2;
const venice=[12.33510,45.43764];
const zooms=[[0,17.5],[.24,17.37],[.70,16.28],[1.34,13.61],[2.1,10.24],
  [2.9,7.12],[3.57,5.10],[4.08,3.87],[4.55,2.80],[4.92,2.01],[5.23,1.65],[6.1,1.37]];
const centers=[[0,...venice],[.5,12.3351,45.43764],[1.3,12.3395,45.4364],
  [2,12.351,45.421],[2.75,12.42,45.286],[3.45,12.72,44.18],[3.98,13.75,42.31],
  [4.42,15.9,39.22],[4.91,20.82,35.12],[5.5,30.2,29.9],[6.1,41.92,26.2]];
function hermite(tab,x,k){
  if(x<=tab[0][0])return tab[0][k];
  if(x>=tab.at(-1)[0])return tab.at(-1)[k];
  const i=tab.findIndex(v=>v[0]>x)-1;
  const slope=j=>(tab[j+1][k]-tab[j][k])/(tab[j+1][0]-tab[j][0]);
  function tan(j){
    if(j===0)return 0;
    if(j===tab.length-1)return slope(j-1);
    const a=slope(j-1),b=slope(j);return a*b>0?2*a*b/(a+b):0;
  }
  const w=tab[i+1][0]-tab[i][0],u=(x-tab[i][0])/w;
  return (1-u)**2*((1+2*u)*tab[i][k]+u*w*tan(i))+u*u*((3-2*u)*tab[i+1][k]-(1-u)*w*tan(i+1));
}
export function pose(i){
  const t=i/30;return {i,t:t+23.8,z:hermite(zooms,t,1),center:[hermite(centers,t,1),hermite(centers,t,2)]};
}
export const grades=[17.5,16.65,15.8,14.95,14.1,13.25,12.4,11.55,10.7,9.85,9,8.15,7.3,6.45,5.6,4.8,4.1,3.45,2.85];
export const poses=Array.from({length},(_,i)=>pose(i));
const smooth=u=>{u=Math.max(0,Math.min(1,u));return u*u*(3-2*u);};
export function mixAt(z){
  const globe=smooth((3.95-z)/.89);
  if(globe>=1)return {globe,charts:[]};
  for(let j=0;j<grades.length-1;j++){
    const g=grades[j],n=grades[j+1],boundary=.66*g+.34*n;
    if(z>=boundary+.23)return {globe,charts:[[j,1]]};
    if(z>boundary-.23){const next=smooth((boundary+.23-z)/.46);return {globe,charts:[[j,1-next],[j+1,next]]};}
  }
  return {globe,charts:[[grades.length-1,1]]};
}
