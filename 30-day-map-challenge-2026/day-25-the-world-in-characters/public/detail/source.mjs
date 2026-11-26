import {containsView,intersects,viewport} from './cover.mjs';

/** Tileflow World reader for one map. Bounds are WGS84 west,south,east,north. */
export function createDetailSource(options = {}) {
  const worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module', name: 'Tileflow World' });
  const pending = new Map();
  const recent = [];
  let nextId = 0;
  let stopped = false;
  let warmed;
  const abortError = () => new DOMException('Map view changed', 'AbortError');

  function finish(id, action, result) {
    const job = pending.get(id);
    if (!job) return;
    pending.delete(id);
    job.signal?.removeEventListener('abort', job.cancel);
    job[action](result);
  }
  worker.onmessage = ({ data }) => {
    const job = pending.get(data.id);
    if (!job) return;
    if (data.type === 'progress') job.onProgress?.(data.progress);
    else if (data.type === 'error') finish(data.id, 'reject', new Error(data.error));
    else if (data.type === 'result') finish(data.id, 'resolve', data.result);
  };

  function destroy(error = abortError()) {
    stopped = true;
    worker.terminate();
    for (const id of pending.keys()) finish(id, 'reject', error);
    recent.length=0;
  }
  worker.onerror = (event) => destroy(new Error(event.message || 'Tileflow worker failed'));
  worker.postMessage({type:'init',catalog:options.catalogUrl?new URL(options.catalogUrl,self.location.href).href:undefined});

  function request(message,signal,onProgress) {
    if (stopped || signal?.aborted) return Promise.reject(abortError());
    const id=++nextId;
    return new Promise((resolve,reject)=>{
      const cancel=()=>{worker.postMessage({type:'cancel',id});finish(id,'reject',abortError());};
      pending.set(id,{resolve,reject,signal,cancel,onProgress});
      signal?.addEventListener('abort',cancel,{once:true});
      worker.postMessage({...message,id});
    });
  }
  function valid(bounds,zoom) {
    return Array.isArray(bounds)&&bounds.length===4&&bounds.every(Number.isFinite)&&Number.isFinite(zoom);
  }
  // The loaded dataset already contains entire geometries intersecting its original
  // envelope. Retypesetting a contained viewport can reuse those exact immutable
  // objects, avoiding the cost of another trip through structured clone.
  function peek({bounds,zoom,maxUnderzoom=0,maxOverzoom=0,featureLimit=Infinity}) {
    if(stopped||!recent.length||!valid(bounds,zoom))return null;
    const now=Date.now(),fresh=recent.filter(entry=>entry.data.expires>now);
    if(!fresh.length){recent.length=0;return null;}
    const catalog=fresh[0].data;
    const view=viewport(bounds,zoom,catalog.maxSourceZoom,catalog.minSourceZoom);
    const candidates=fresh.filter(({area,data})=>{
      const delta=view.z-data.sourceZoom;
      return delta<=maxUnderzoom&&delta>=-maxOverzoom&&containsView(area,view);
    }).sort((a,b)=>Math.abs(a.data.sourceZoom-view.z)-Math.abs(b.data.sourceZoom-view.z));
    for(const {data} of candidates){
      const features=[];
      for(const feature of data.features)if(intersects(feature.bbox,view)){
        features.push(feature);
        if(features.length>featureLimit)break;
      }
      if(features.length>featureLimit)continue;
      const tiles=view.z===data.sourceZoom?view.tiles.length:viewport(bounds,data.sourceZoom,data.sourceZoom,data.minSourceZoom).tiles.length;
      return {...data,features,tiles,cachedTiles:tiles,readMs:0,viewCache:true};
    }
    return null;
  }
  return {
    peek,
    async warmCatalog({signal}={}) {
      if(stopped||signal?.aborted)throw abortError();
      if(warmed?.expires>Date.now())return warmed;
      warmed=await request({type:'warm'},signal);
      return warmed;
    },
    async read({bounds,zoom,signal,onProgress,remember=true}) {
      if(stopped||signal?.aborted)throw abortError();
      if(!valid(bounds,zoom))throw new TypeError('Tileflow requires finite WGS84 bounds and zoom');
      const hit=peek({bounds,zoom});if(hit)return hit;
      const data=await request({type:'read',bounds,zoom,progress:Boolean(onProgress)},signal,onProgress);
      if(remember&&!stopped&&!signal?.aborted&&!data.missing&&data.expires>Date.now()){
        const area=viewport(bounds,zoom,data.maxSourceZoom,data.minSourceZoom);
        recent.unshift({area,data});
        while(recent.length>2||recent.length>1&&recent[0].data.features.length+recent[1].data.features.length>18000)recent.pop();
      }
      return data;
    },
    destroy
  };
}
