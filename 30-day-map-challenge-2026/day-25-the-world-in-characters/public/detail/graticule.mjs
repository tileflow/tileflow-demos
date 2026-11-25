// Where the catalog has no features, a sparse graticule locates the sheet.
const steps=[.05,.1,.2,.5,1,2,5,10,15,30,60,120,300,600,900,1800,3600,7200,18000];
function format(value,longitude,interval){
  let ticks=Math.round(Math.abs(value)*36000)/10;
  const deg=Math.floor(ticks/3600);ticks-=deg*3600;
  const min=Math.floor(ticks/60),sec=Math.round((ticks-min*60)*10)/10;
  const suffix=longitude?(value<0?'W':'E'):(value<0?'S':'N');
  if(interval>=3600)return deg+'° '+suffix;
  if(interval>=60)return deg+'° '+min+'′ '+suffix;
  return deg+'° '+min+'′ '+sec+'″ '+suffix;
}
export function graticule({w,h,xy,llAt,emit}){
  const [cx,cy]=llAt(w/2,h/2);
  const a=llAt(w/2+130,h/2),b=llAt(w/2,h/2+130);
  const deltaLon=(a[0]-cx+540)%360-180;
  const xs=Math.abs(deltaLon)*3600,ys=Math.abs(b[1]-cy)*3600;
  const stepFor=n=>steps.find(q=>q>=n)||18000;
  for(const meridian of [true,false]){
    const step=stepFor(meridian?xs:ys),index=Math.round((meridian?cx:cy)*3600/step);
    const limit=Math.ceil((meridian?w:h)/130)+2;
    for(let k=index-limit;k<=index+limit;k++){
      const geo=k*step/3600;
      if(!meridian&&Math.abs(geo)>89.99)continue;
      const pos=xy(meridian?[geo,cy]:[cx,geo]);if(!pos.every(Number.isFinite))continue;
      const labelX=meridian?pos[0]+5:w*.18,labelY=meridian?h*.18:pos[1]-8;
      if(meridian?(pos[0]<0||pos[0]>w):(pos[1]<0||pos[1]>h))continue;
      for(let n=6;n<(meridian?h:w);n+=13){
        const ll=meridian?llAt(pos[0],n):llAt(n,pos[1]);
        const p=xy(meridian?[geo,ll[1]]:[ll[0],geo]);
        if(Math.abs(p[0]-labelX)<42&&Math.abs(p[1]-labelY)<14)continue;
        emit('land','·',p[0],p[1],9,0,.50,'#768274');
      }
      const normalized=meridian?(geo+540)%360-180:geo;
      emit('terrainName',format(normalized,meridian,step),labelX,labelY,13,meridian?-Math.PI/2:0,.89,'#596a5c');
    }
  }
}
