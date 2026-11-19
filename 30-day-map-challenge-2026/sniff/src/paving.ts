import type {FillLayerSpecification,Map as MapLibreMap} from 'maplibre-gl';

const imageId='sniff-paving-stones';
const pavementOpacity:NonNullable<FillLayerSpecification['paint']>['fill-opacity']=
 ['interpolate',['linear'],['zoom'],16.8,0,17.5,.54,18.5,.92];

function makePaving(){
 const canvas=document.createElement('canvas');
 canvas.width=canvas.height=64;
 const context=canvas.getContext('2d')!;
 context.scale(2,2);
 const slab=16;
 for(let row=0;row<2;row++){
  const y=row*slab,shift=row*slab/2;
  for(let column=-1;column<2;column++){
   const x=column*slab+shift;
   context.fillStyle=(column+row)%2===0?'rgba(255,251,233,.22)':'rgba(103,97,89,.055)';
   context.fillRect(x,y,slab,slab);
   context.fillStyle='rgba(91,88,86,.26)';
   context.fillRect(x-.26,y,.52,slab);
   context.fillStyle='rgba(255,255,245,.48)';
   context.fillRect(x+.35,y,.55,slab);
  }
  context.fillStyle='rgba(91,88,86,.26)';
  context.fillRect(0,y+.1,32,.53);
  context.fillStyle='rgba(255,255,245,.42)';
  context.fillRect(0,y+.72,32,.54);
 }
 return context.getImageData(0,0,64,64);
}

function addCurb(map:MapLibreMap,id:string,base:FillLayerSpecification,before?:string){
 map.addLayer({
  id,type:'line',source:base.source,'source-layer':base['source-layer'],
  filter:base.filter,minzoom:17.2,
  layout:{'line-join':'round'},
  paint:{
   'line-color':'#aa9f91',
   'line-width':['interpolate',['linear'],['zoom'],17.2,.6,18.7,1.5,20,2.4],
   'line-opacity':['interpolate',['linear'],['zoom'],17.2,0,18.6,.72],
  },
 },before);
}

/** Detail follows World’s mapped pedestrian surfaces, underneath the road markings. */
export function stylePaving(map:MapLibreMap){
 const layers=map.getStyle().layers;
 const sidewalk=layers.find(layer=>layer.id==='tileflow-sidewalk-surface');
 const plaza=layers.find(layer=>layer.id==='tileflow-road-pedestrian-area');
 map.addImage(imageId,makePaving(),{pixelRatio:2});

 if(sidewalk?.type==='fill'&&map.getLayer('tileflow-sidewalk-pattern')){
  const pattern='tileflow-sidewalk-pattern';
  map.setPaintProperty(pattern,'fill-pattern',imageId);
  map.setPaintProperty(pattern,'fill-opacity',pavementOpacity);
  const next=layers[layers.findIndex(layer=>layer.id===pattern)+1]?.id;
  addCurb(map,'sniff-sidewalk-curb',sidewalk,next);
 }
 if(plaza?.type==='fill'){
  const next=layers[layers.indexOf(plaza)+1]?.id;
  map.addLayer({
   id:'sniff-plaza-paving',type:'fill',source:plaza.source,'source-layer':plaza['source-layer'],
   filter:plaza.filter,minzoom:16.8,
   paint:{'fill-pattern':imageId,'fill-opacity':pavementOpacity},
  },next);
  addCurb(map,'sniff-plaza-curb',plaza,next);
 }
 if(map.getLayer('tileflow-road-crossing')){
  map.setLayoutProperty('tileflow-road-crossing','icon-size',
   ['interpolate',['linear'],['zoom'],16.5,.36,17,.67,18,1.2,19,1.79,20,2.65,22,6.2]);
 }
}
