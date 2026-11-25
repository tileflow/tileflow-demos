import { decodeTileflowVectorTile } from '@tileflow/core/browser';
import { inheritedOcean, intersects, toGeometry, viewport } from './geometry.mjs';
import { layers, normalizeProperties } from './layers.mjs';

let catalog='https://api.tileflow.dev/tiles/world,world-detail/tiles.json';
let catalogEntry;
let cooldown=0;
let cacheWeight=0;
const cache=new Map();
const jobs=new Map();
const inflight=new Map();

// A moving viewport and its successor can request the same address. Each reader
// owns a subscription; the fetch is cancelled only when it has no subscribers.
function share(key,signal,load) {
  signal.throwIfAborted();
  let entry=inflight.get(key);
  if (!entry) {
    const controller=new AbortController();
    entry={controller,count:0,done:false,retire:0};
    inflight.set(key,entry);
    entry.task=Promise.resolve().then(()=>load(controller.signal)).finally(()=>{
      entry.done=true;clearTimeout(entry.retire);
      if (inflight.get(key)===entry) inflight.delete(key);
    });
  }
  clearTimeout(entry.retire);
  entry.count++;
  return new Promise((resolve,reject)=>{
    let active=true;
    const close=()=>{
      if (!active) return false;
      active=false;
      signal.removeEventListener('abort',cancel);
      entry.count--;
      if (!entry.count && !entry.done) {
        // Consecutive camera jobs arrive as separate worker messages. Give the
        // next visible view a short opportunity to adopt the same in-flight tile.
        entry.retire=setTimeout(()=>{
          if (entry.done || entry.count) return;
          if (inflight.get(key)===entry) inflight.delete(key);
          entry.controller.abort();
        },80);
      }
      return true;
    };
    const cancel=()=>{if(close()) reject(signal.reason);};
    signal.addEventListener('abort',cancel,{once:true});
    entry.task.then(value=>{if(close())resolve(value);},error=>{if(close())reject(error);});
  });
}

function ttl(headers,defaultSeconds) {
  const cc=headers.get('cache-control')??'';
  if (/no-store|no-cache/i.test(cc)) return 0;
  const freshness=cc.match(/(?:^|,)\s*max-age\s*=\s*(\d+)/i)?.[1];
  return 1000*Math.max(0,Number(freshness??defaultSeconds)-Number(headers.get('age')??0));
}

async function getResponse(url,signal) {
  signal.throwIfAborted();
  if (Date.now()<cooldown) throw new Error('Tileflow is temporarily limiting map requests');
  const response=await fetch(url,{signal,credentials:'omit'});
  if (response.status===429 || response.status===503) {
    const raw=response.headers.get('retry-after');
    const seconds=raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
    cooldown=Number.isFinite(seconds) ? Date.now()+1000*Math.max(1,seconds) : Math.max(Date.now()+1000,Date.parse(raw)||Date.now()+10000);
  }
  return response;
}
async function getCatalog(signal) {
  if (catalogEntry && catalogEntry.expires>Date.now()) return catalogEntry;
  return share(catalog,signal,loadCatalog);
}
async function loadCatalog(signal) {
  const response=await getResponse(catalog,signal);
  if (!response.ok) throw new Error('Tileflow catalog returned HTTP '+response.status);
  const info=await response.json();
  if (!info.tiles?.length) throw new Error('Tileflow catalog has no vector tile URL');
  const template=new URL(info.tiles[0].replaceAll('{','__OPEN__').replaceAll('}','__CLOSE__'),catalog).href
    .replaceAll('__OPEN__','{').replaceAll('__CLOSE__','}');
  const entry={template,name:info.name??'Tileflow World',minzoom:info.minzoom??0,maxzoom:info.maxzoom??15,
    expires:Date.now()+ttl(response.headers,60), attribution:info.attribution??''};
  signal.throwIfAborted();
  if (catalogEntry && entry.template!==catalogEntry.template) {cache.clear();cacheWeight=0;}
  catalogEntry=entry;
  return entry;
}
function remember(k,entry) {
  if (entry.expires<=Date.now() || entry.weight>650000) return;
  const previous=cache.get(k);
  if (previous) cacheWeight-=previous.weight;
  cache.set(k,entry); cacheWeight+=entry.weight;
  while (cache.size>48 || cacheWeight>650000) {
    const key=cache.keys().next().value;
    cacheWeight-=cache.get(key).weight;cache.delete(key);
  }
}
async function readTile(tile,info,signal) {
  const k=info.template+'|'+tile.key;
  const old=cache.get(k);
  if (old) {
    cache.delete(k);cacheWeight-=old.weight;
    if (old.expires>Date.now()) {remember(k,old);return {features:old.features,expires:old.expires,cached:true};}
  }
  return share(k,signal,sharedSignal=>loadTile(tile,info,k,sharedSignal));
}
async function loadTile(tile,info,k,signal) {
  const url=info.template.replace('{z}',tile.z).replace('{x}',tile.x).replace('{y}',tile.y);
  const response=await getResponse(url,signal);
  if (!response.ok && response.status!==404) throw new Error('Tileflow tile returned HTTP '+response.status);
  const decoded=[];
  let weight=1;
  if (response.status!==204 && response.status!==404) {
    let bytes=new Uint8Array(await response.arrayBuffer());
    if (bytes[0]===31 && bytes[1]===139) {
      bytes=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    }
    const result=decodeTileflowVectorTile(bytes,{layers});
    for (const [layer,{features,extent}] of Object.entries(result)) for (const feature of features) {
      const shape=toGeometry(feature,tile,extent);
      if (!shape) continue;
      weight+=10;
      for (const part of feature.geometry) weight+=part.length/2;
      const properties=normalizeProperties(layer,feature.properties,tile.key,feature.id);
      const normalized={type:'Feature',properties,...shape};
      if (feature.id!==undefined) normalized.id=feature.id;
      decoded.push(normalized);
    }
  }
  signal.throwIfAborted();
  const expires=Date.now()+ttl(response.headers,0);
  remember(k,{features:decoded,expires,weight});
  return {features:decoded,expires,cached:false};
}
async function getView({id,bounds,zoom,progress},signal) {
  const t0=performance.now(),info=await getCatalog(signal);
  const view=viewport(bounds,zoom,info.maxzoom,info.minzoom);
  let index=0,loaded=0,cached=0,waterFallbackTiles=0;
  const missingTiles=[],parts=new Array(view.tiles.length);
  let firstError,expires=info.expires;
  async function consume() {
    while (index<view.tiles.length) {
      signal.throwIfAborted();
      const i=index++,tile=view.tiles[i];
      try {
        const result=await readTile(tile,info,signal);
        parts[i]=result.features.filter(feature=>intersects(feature.bbox,view));
        expires=Math.min(expires,result.expires);
        if (result.cached) cached++;
        // Some detailed tiles are sparse. Never classify an empty response as water.
        // A single visible parent can confirm open ocean without guessing at islands.
        if (!result.features.length && tile.z>info.minzoom) {
          const parent={z:tile.z-1,x:Math.floor(tile.x/2),y:Math.floor(tile.y/2)};
          parent.key=[parent.z,parent.x,parent.y].join('/');
          const parentResult=await readTile(parent,info,signal).catch(error=>{
            if (signal.aborted) throw error;
            return null;
          });
          expires=Math.min(expires,parentResult?.expires??0);
          const ocean=parentResult && inheritedOcean(tile,parentResult.features);
          if (ocean) {parts[i]=[ocean];waterFallbackTiles++;}
        }
      } catch(error) {
        if (signal.aborted) throw error;
        firstError??=error;
        missingTiles.push(tile.key);
      }
      loaded++;
      if (progress) self.postMessage({type:'progress',id,progress:{loaded,total:view.tiles.length,missing:missingTiles.length}});
    }
  }
  await Promise.all(Array.from({length:Math.min(4,view.tiles.length)},consume));
  if (missingTiles.length===view.tiles.length && firstError) throw firstError;
  return {type:'FeatureCollection',features:parts.flatMap(part=>part??[]),
    sourceZoom:view.z,tiles:view.tiles.length,missing:missingTiles.length,missingTiles,
    expires,minSourceZoom:info.minzoom,maxSourceZoom:info.maxzoom,provider:info.name,attribution:info.attribution,waterFallbackTiles,cachedTiles:cached,readMs:Math.round(performance.now()-t0)};
}
self.onmessage=async ({data})=>{
  if (data.type==='init') {if (data.catalog) catalog=data.catalog;return;}
  if (data.type==='cancel') {jobs.get(data.id)?.abort();return;}
  if (data.type!=='read' && data.type!=='warm') return;
  const controller=new AbortController();
  jobs.set(data.id,controller);
  try {
    const result=data.type==='warm' ? await getCatalog(controller.signal) : await getView(data,controller.signal);
    if (!controller.signal.aborted) self.postMessage({type:'result',id:data.id,result});
  } catch(error) {
    if (!controller.signal.aborted) self.postMessage({type:'error',id:data.id,error:error.message??String(error)});
  } finally {jobs.delete(data.id);}
};
