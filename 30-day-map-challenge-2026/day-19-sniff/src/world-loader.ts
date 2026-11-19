import {ORIGIN} from './streets.mjs';
import type {loadNeighbourhood as loadData} from './world-data.mjs';
import type {buildEncounters} from './encounters.mjs';

type RegionData=Awaited<ReturnType<typeof loadData>>;
type Encounters=ReturnType<typeof buildEncounters>;
type EncounterRules={minRange?:number;maxRange?:number;difficulty:number;traffic?:boolean;allowClosures?:boolean;allowCrowds?:boolean;existing?:Encounters};

const worker=new Worker(new URL('./world-worker.ts',import.meta.url),{type:'module'});
let sequence=0;
const pending=new Map<number,{resolve:(data:any)=>void;reject:(error:Error)=>void}>();

worker.onmessage=event=>{
 const {id,data,error}=event.data,request=pending.get(id);
 if(!request)return;
 pending.delete(id);
 if(error)request.reject(Error(error));
 else request.resolve(data);
};
worker.onerror=()=>{
 for(const request of pending.values())request.reject(Error('The streets could not load. Please try again.'));
 pending.clear();
};

function request<T>(message:Record<string,unknown>){
 return new Promise<T>((resolve,reject)=>{
  const id=++sequence;
  pending.set(id,{resolve,reject});
  worker.postMessage({...message,id});
 });
}
export function loadNeighbourhood(coordinate:number[]){
 return request<RegionData&{regionId:number}>({type:'neighbourhood',coordinate,origin:[...ORIGIN]});
}
export function loadEncounters(regionId:number,position:number[],food:{point:number[];nodeId:string}[],rules:EncounterRules){
 return request<Encounters>({type:'encounters',regionId,position,food,rules});
}
