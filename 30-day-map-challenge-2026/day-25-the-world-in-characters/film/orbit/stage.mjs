import {readFile} from 'node:fs/promises';
const root = new URL('./', import.meta.url);
const html=await readFile(new URL('../../index.html',root),'utf8');
const module=`
import {mount} from './runtime/tileflow.mjs';
import {equatorialFit,clipAtHorizon} from './detail/orbit-camera.mjs';
import {createGlobePress} from './detail/globe-press.mjs?v=orbit-ink-1';
const node=document.querySelector('#globe');
document.body.classList.add('in-orbit');node.classList.add('active');
document.querySelector('main').style.background='#f3f1ea';
const {map}=await mount(node,'./globe-style.json',{mapName:'globe',projection:'globe',center:[-36,18],zoom:2,interactive:false,
  mapOptions:{minZoom:-3,fadeDuration:65,pixelRatio:1.5},manifestUrl:'./manifest.json'});
clipAtHorizon(map);const press=await createGlobePress(map);
if(!press.ready)throw Error('The globe glyph atlas failed to load');
const side=Math.min(node.clientWidth,node.clientHeight),r=180/Math.PI;
window.drawOrbit=async (pose)=>{
 const {lon,lat,diam,dx,t,ending}=pose,ratio=diam*side*.5,focus=1.5*node.clientHeight,tangent=ratio/focus;
 const radius=ratio*(tangent+Math.hypot(1,tangent));
 const z=Math.log2(2*Math.PI*radius*Math.cos(lat/r)/512);
 node.style.transform='translate('+dx+'px,0)';
 const promise=new Promise(resolve=>map.once('render',resolve));
 map.jumpTo({center:[lon,lat],zoom:z,bearing:0,pitch:0});
 press.tick(t);map.triggerRepaint();await promise;
 if(ending)await new Promise(resolve=>{map.once('render',resolve);map.triggerRepaint()});
 const points=Object.fromEntries(Object.entries({Lisboa:[-9.1393,38.7223],Barcelona:[2.1734,41.3851],Madrid:[-3.7038,40.4168]}).map(([name,ll])=>{
  const p=map.project(ll),toFilm=1920/node.clientWidth;return [name,[(p.x+dx)*toFilm,p.y*toFilm]];
 }));
 const canvas=map.getCanvas();
 if(canvas.width!==1920||canvas.height!==1080)throw Error('Globe backing surface is not 1080p');
 return {z:map.getZoom(),projection:map.getProjection().type,marks:press.count,points,labels:ending?[...new Set(map.queryRenderedFeatures({layers:['globe-country-names','globe-ocean-names']}).map(f=>f.properties.t||f.properties.name))]:[]};
};
window.ready=true;`;
const stage=html.replace(/<script type="module" src="(?:\.)?\/viewer\.mjs[^"]*"><\/script>/,
 '<style>.maplibregl-control-container,[class*="tileflow-logo"],#credit,#network{display:none!important}</style><script type="module">'+module+'</script>');

export {stage};
