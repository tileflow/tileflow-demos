// Localised names and street references may be spelled differently in two surveys.
// Proximity, semantic role and the direction of a linear feature still have to agree.
export function wordKey(role, text) {
  let name=String(text).trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu,'').replace(/\s+/gu,' ');
  if(role==='roadLabel')name=name.replace(/^(\p{L}{1,4})[ ‐‑–-]+(?=\d)/u,'$1');
  return (role==='settlement'?'place':role)+'|'+name;
}

export function wordKeys(role,text,alias) {
  const names=[text,...(alias?[alias]:[])];
  if(!names.some(name=>typeof name==='string'&&name.includes(' / '))&&names.length===1)return [wordKey(role,text)];
  const ids=new Set();
  for(const name of names)if(typeof name==='string'){
    ids.add(wordKey(role,name));
    for(const part of name.split(' / '))ids.add(wordKey(role,part));
  }
  return [...ids];
}

export function wordHistory(anchors,project) {
  const byName=new Map();
  for(const old of anchors) {
    const [x,y]=project(old.ll);
    if(!Number.isFinite(x+y))continue;
    const anchor={...old,x,y,used:false};
    for(const key of wordKeys(old.b,old.t,old.alias)) {
      let list=byName.get(key);
      if(!list)byName.set(key,list=[]);
      list.push(anchor);
    }
  }
  return (keys,xy,size,angle,role)=>{
    // A house number can recur on multiple streets within a few pixels. Do not
    // count it as a continuing word unless its station itself is unchanged.
    let best=null,limit=role==='house'||role==='number'||role==='housenumber'?3:Math.max(18,size*1.8);
    for(const key of keys)for(const old of byName.get(key)||[]){
      if(old.used||Math.abs(Math.cos(((angle||0)-(old.e||0))*Math.PI/180))<.94)continue;
      const distance=Math.hypot(xy[0]-old.x,xy[1]-old.y);
      if(distance<limit){best=old;limit=distance;}
    }
    if(best)best.used=true;
    return best;
  };
}
