import {parentPort} from 'node:worker_threads';

const varint=value=>{
  const bytes=[];while(value>=128){bytes.push((value&127)|128);value=Math.floor(value/128);}
  bytes.push(value);return bytes;
};
const scalar=(field,n)=>[...varint(field*8),...varint(n)];
const block=(field,a)=>[...varint(field*8+2),...varint(a.length),...a];
const string=(field,s)=>block(field,[...new TextEncoder().encode(s)]);
const zigzag=n=>n<0?-2*n-1:2*n;
function fixtureOcean() {
  const outline=[9,zigzag(-128),zigzag(-128),26,zigzag(4352),0,0,zigzag(4352),zigzag(-4352),0,15];
  const feature=[...scalar(1,7),...block(2,[0,0]),...scalar(3,3),...block(4,outline.flatMap(varint))];
  const layer=[...string(1,'water'),...block(2,feature),...string(3,'class'),...block(4,string(1,'ocean')),...scalar(5,4096),...scalar(15,2)];
  return Uint8Array.from(block(3,layer));
}
const mvt=fixtureOcean();
function wait(ms,signal) {
  return new Promise((resolve,reject)=>{
    const id=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
    const abort=()=>{clearTimeout(id);parentPort.postMessage({type:'transportAbort'});reject(signal.reason);};
    signal.addEventListener('abort',abort,{once:true});
    if (signal.aborted) abort();
  });
}
globalThis.fetch=async (url,{signal})=>{
  const pathname=new URL(url).pathname;
  parentPort.postMessage({type:'transport',pathname});
  await wait(pathname.endsWith('.json')?5:90,signal);
  const headers={'Cache-Control':'public, max-age=120'};
  if (pathname.endsWith('.json')) return Response.json({tiles:['./{z}/{x}/{y}.pbf'],maxzoom:15,minzoom:0},{headers});
  if (pathname==='/3/4/3.pbf') return new Response(null,{status:404,headers});
  return new Response(mvt,{headers});
};
globalThis.self={postMessage:data=>parentPort.postMessage(data)};
await import('../../../public/detail/worker.mjs');
parentPort.on('message',data=>self.onmessage({data}));
