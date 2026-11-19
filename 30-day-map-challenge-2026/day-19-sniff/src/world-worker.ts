import {setOrigin} from './streets.mjs';
import {loadNeighbourhood} from './world-data.mjs';
import {createWalkSurface} from './walking.mjs';
import {buildEncounters} from './encounters.mjs';

type Region=Awaited<ReturnType<typeof loadNeighbourhood>>;
const regions=new Map<number,{data:Region;surface?:ReturnType<typeof createWalkSurface>}>();
let chain=Promise.resolve();

function fail(id:number,error:unknown){
 self.postMessage({id,error:error instanceof Error?error.message:'The streets could not load.'});
}

self.onmessage=event=>{
 const message=event.data;
 if(message.type==='encounters'){
  const {id,regionId,position,food,rules}=message;
  try{
   const entry=regions.get(regionId);
   if(!entry)throw Error('These streets are no longer active.');
   const {data}=entry;
   entry.surface??=createWalkSurface(data.lines,data.buildings,data.areas,{center:data.center,radius:600},data.water);
   entry.surface.setBarriers((rules.existing??[]).filter((item:{kind:string})=>item.kind==='barrier'));
   const encounters=buildEncounters(data.lines,data.graph,entry.surface,position,food,{...rules,greenAreas:data.greenAreas,pavementAreas:data.areas,waterAreas:data.water});
   self.postMessage({id,data:encounters});
  }catch(error){fail(id,error);}
  return;
 }

 const {id,coordinate,origin}=message;
 chain=chain.then(async()=>{
  try{
   setOrigin(origin);
   const data=await loadNeighbourhood(coordinate);
   regions.set(id,{data});
   if(regions.size>3)regions.delete(regions.keys().next().value!);
   self.postMessage({id,data:{...data,regionId:id}});
  }catch(error){fail(id,error);}
 });
};
