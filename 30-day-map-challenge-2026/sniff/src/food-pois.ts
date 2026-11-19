import type {GeoJSONSource,Map as MapLibreMap} from 'maplibre-gl';
import type {FeatureCollection,Point} from 'geojson';
import {toLngLat} from './streets.mjs';
import {TASTES} from './game.mjs';

type FoodStop = {id:number;kind:string;point:number[]};
const ink='#263443',paper='#fff3db';
const pin='M7 3h18q4 0 4 4v14q0 4-4 4h-4l-5 4-5-4H7q-4 0-4-4V7q0-4 4-4Z';
const pictograms:Record<keyof typeof TASTES,{fill:string;line?:string;path:string}>={
 bread:{fill:'#f8c454',line:ink,path:'M6 18c1-6 5-10 10-10s9 4 10 10l-4 3-1-4c-2-4-8-4-10 0l-1 4-4-3Zm5-8 2 4m8-4-2 4m-3-6v5'},
 coffee:{fill:'#177f7a',path:'M9 12h11v4a4 4 0 0 1-4 4h-3a4 4 0 0 1-4-4Zm11 1h2a2 2 0 1 1 0 4h-2m-9-8 1-2m3 2 1-2M8 22h13'},
 food:{fill:'#b34b37',path:'M8 15h16m-15 0c1 4 3 5 7 5s6-1 7-5m-12 7h10m-10-10c-2-2 2-2 0-4m6 4c-2-2 2-2 0-4'},
 pizza:{fill:'#b34b37',path:'m9 11 12-3a10 10 0 0 1 2 9L9 23Zm10-2a10 10 0 0 1 2 9m-7-4h.1m2 3h.1m1-5h.1'},
 ramen:{fill:'#21657b',path:'M8 15h16c-1 4-4 6-8 6s-7-2-8-6Zm5 8h6m-7-10c1-3 5-4 7-5m-4 5 7-4'},
 burger:{fill:'#f8c454',line:ink,path:'M8 13a8 6 0 0 1 16 0Zm1 4h14m-14 3h14v2H9Zm4-9h.1m4-1h.1m3 1h.1'},
 iceCream:{fill:'#805877',path:'M11 14a5 5 0 1 1 10 0h-10Zm2 0 3 8 3-8m-5 4 3-2'},
};

function makeFoodIcon(kind:keyof typeof TASTES){
 const canvas=document.createElement('canvas');
 canvas.width=canvas.height=64;
 const ctx=canvas.getContext('2d')!;
 ctx.scale(2,2);
 const frame=new Path2D(pin),art=pictograms[kind];
 ctx.lineJoin=ctx.lineCap='round';
 ctx.save();
 ctx.translate(0,1.5);
 ctx.fillStyle=ink;
 ctx.fill(frame);
 ctx.restore();
 ctx.fillStyle=art.fill;
 ctx.fill(frame);
 ctx.strokeStyle=paper;
 ctx.lineWidth=3;
 ctx.stroke(frame);
 ctx.strokeStyle=ink;
 ctx.lineWidth=1.15;
 ctx.stroke(frame);
 ctx.strokeStyle=art.line??paper;
 ctx.lineWidth=1.65;
 ctx.stroke(new Path2D(art.path));
 return ctx.getImageData(0,0,64,64);
}

export function createFoodPois(map:MapLibreMap){
 const id='tileflow-food-stops';
 for(const kind of Object.keys(TASTES) as (keyof typeof TASTES)[]){
  map.addImage('sniff-poi-'+kind,makeFoodIcon(kind),{pixelRatio:2});
 }
 map.addSource(id,{type:'geojson',data:{type:'FeatureCollection',features:[]}});
 map.addLayer({
  id,type:'symbol',source:id,minzoom:16.8,
  layout:{
   'icon-image':['concat','sniff-poi-',['get','kind']],
   'icon-anchor':'bottom-left',
   'icon-offset':[10,-16],
   'icon-allow-overlap':true,
   'icon-ignore-placement':true,
   'icon-pitch-alignment':'viewport',
   'icon-rotation-alignment':'viewport',
   visibility:'none',
  },
 });

 return {
  setItems(items:readonly FoodStop[]){
   const data:FeatureCollection<Point>={type:'FeatureCollection',features:items.map(item=>({
    type:'Feature',id:item.id,geometry:{type:'Point',coordinates:toLngLat(item.point)},
    properties:{kind:item.kind},
   }))};
   map.getSource<GeoJSONSource>(id)?.setData(data);
  },
  setVisible(visible:boolean){
   map.setLayoutProperty(id,'visibility',visible?'visible':'none');
  },
 };
}
