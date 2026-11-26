import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import {createTileflowMap} from '@tileflow/dom';
import {mountMovingType} from './moving-type.js';

const views={
  bridges:{center:[-74.0006,40.7104],zoom:13.65},
  island:{center:[-73.965,40.78],zoom:11.5},
  bayard:{center:[-73.9982,40.71545],zoom:17.45},
  madrid:{center:[-3.70465,40.42004],zoom:16.8},
  parque:{center:[-3.6825,40.4133],zoom:14.35},
  retiro:{center:[-3.68379,40.41576],zoom:17.6},
  manzanares:{center:[-3.72334,40.4132],zoom:15.5},
  portal:{center:[-73.9982,40.71545],zoom:19},
  world:{center:[0,19],zoom:1.65},
  shibuya:{center:[139.7004,35.6596],zoom:16.2},
  sahara:{center:[-4.85,23.35],zoom:11.6},
  europa:{center:[1.5,45],zoom:3.2},
  iberia:{center:[-4.1,40.3],zoom:6.35},
  region:{center:[-3.74,40.5],zoom:9.5},
};
const key=new URLSearchParams(location.search).get('vista');
const start=Object.hasOwn(views,key)?key:'world',view=views[start];
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const container=document.getElementById('map'),message=document.getElementById('message');
// A portrait screen can show the entire sheet with paper above and below the poles.
function constrain(center,requestedZoom){
  const worldFit=Math.log2(Math.max(140,Math.min(container.clientWidth,container.clientHeight)-24)/512);
  const zoom=Math.max(worldFit,Math.min(19,requestedZoom)),size=512*2**zoom;
  const limitX=Math.max(0,180*(1-container.clientWidth/size));
  const limitY=Math.max(0,.5-container.clientHeight/(2*size));
  const latitude=Math.atan(Math.sinh(2*Math.PI*limitY))*180/Math.PI;
  const result=center.wrap();
  result.lng=Math.max(-limitX,Math.min(limitX,center.lng));
  result.lat=Math.max(-latitude,Math.min(latitude,center.lat));
  return {center:result,zoom};
}
function failed(){message.textContent='No se pudo abrir el mapa. Comprueba la conexión y recarga la página.';message.hidden=false;}
let activeMap;
const controller=createTileflowMap(container,{
  source:{map:'type-atlas',manifestUrl:`${import.meta.env.BASE_URL}tileflow/manifest.json`},theme:'paper',center:view.center,zoom:view.zoom,
  mapOptions:{minZoom:-1.5,maxZoom:19,renderWorldCopies:false,maxPitch:0,fadeDuration:0,dragRotate:false,touchPitch:false,attributionControl:{compact:true}},
  onLoad(map){
    map.setTransformConstrain(constrain);
    activeMap=map;map.touchZoomRotate.disableRotation();map.keyboard.disableRotation();
    if(start==='world')map.fitBounds([[-179,-79],[179,82]],{padding:12,duration:0});
    if(start==='island')map.fitBounds([[-74.031,40.694],[-73.905,40.882]],{padding:20,duration:0});
    mountMovingType(map,reduced);
    map.once('idle',()=>{message.hidden=true;});
  },
});
controller.ready.catch(failed);
new ResizeObserver(()=>activeMap?.resize()).observe(container);
