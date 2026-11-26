// How much a name may grow relative to geography on a zoom out before it
// reaches another name or a settlement marker. Only the nearby names on this
// printed sheet enter the index. It is discarded after composing the edition.
const maxRoom=1.68,cell=80;
export function wordRoom(features,wordRoles,project){
  const grid=new Map(),room=new Map();
  const spacing=box=>room.get(box.f)??maxRoom;
  let visit=0;
  for(const f of features){
    const {b,t,s,e=0}=f.properties,marker=b==='townDot',word=wordRoles.has(b);
    if(!word&&!marker&&b!=='terrainName')continue;
    const lines=String(t).split('\n'),len=Math.max(...lines.map(l=>Array.from(l).length)),angle=e*Math.PI/180;
    const w=marker?Math.max(2,s*.18):Math.max(4,len*s*.34+3.5),h=marker?w:s*(lines.length*.60)+2;
    const c=Math.abs(Math.cos(angle)),sn=Math.abs(Math.sin(angle)),hw=w*c+h*sn,hh=h*c+w*sn;
    for(const ll of f.geometry.coordinates){
      const [x,y]=project(ll);if(!Number.isFinite(x+y))continue;
      const box={x,y,hw,hh,f,visit:0,word};
      if(word&&!room.has(f))room.set(f,maxRoom);
      const minX=Math.floor((x-hw*maxRoom)/cell),maxX=Math.floor((x+hw*maxRoom)/cell);
      const minY=Math.floor((y-hh*maxRoom)/cell),maxY=Math.floor((y+hh*maxRoom)/cell);
      visit++;
      for(let j=minY;j<=maxY;j++)for(let i=minX;i<=maxX;i++){
        const key=i+','+j;let group=grid.get(key);
        if(!group){group=[];grid.set(key,group);}
        for(const old of group){
          if(old.visit===visit||old===box||!old.word&&!word)continue;
          old.visit=visit;
          const gap=Math.max(Math.abs(old.x-x)/(hw+old.hw),Math.abs(old.y-y)/(hh+old.hh),1);
          if(word&&gap<spacing(box))room.set(f,gap);
          if(old.word&&gap<spacing(old))room.set(old.f,gap);
        }
        group.push(box);
      }
    }
  }
  return room;
}

// With MapLibre's composite font sizes, the two integer layout stops must
// interpolate back to precisely one at the fractional printed camera. This
// keeps relaxed and crowded labels the same size in the final edition.
export function fitWordRoom(z,safe){
  const fraction=z-Math.floor(z);
  const lo=Math.min(1,2**(-fraction)*safe),t=Math.expm1(fraction*Math.LN2);
  const ceiling=t>1e-7?1+(1-lo)*(1-t)/t:1;
  return {scale:safe,ceiling};
}
