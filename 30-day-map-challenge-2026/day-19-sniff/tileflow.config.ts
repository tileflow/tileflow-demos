import {buildings, defineMap, defineTheme, disable, refine, token, zoom} from '@tileflow/core';
import {streets, streetsThemes} from '@tileflow/maps';
import {roadPalette} from './src/road-palette';

// Chalk curbs, graphite-blue streets and green parks separate play surfaces at a glance.
const adventure=defineTheme(streetsThemes.dawn,{
 id:'sniff-adventure',version:1,colorScheme:'light',tokens:{color:{
  'surface.background':'#ecd4ad','surface.background.transition':'#ecd4ad','surface.background.overview':'#f2ddba',
  'landuse.residential':'#d8bf9a','landuse.commercial':'#e6c39a','landuse.civic':'#e0bf9e','landuse.education':'#dfcfa6',
  'sniff.land.overview':'#faf3e3','sniff.residential.overview':'#f1e9d8',
  'sniff.education.overview':'#f0e5cc','sniff.civic.overview':'#f1e7d4',
  'sniff.park.overview':'#add974','sniff.wood.overview':'#8abb7a','sniff.grass.overview':'#b4d98a',
  'buildings.fill':'#e9dfce','buildings.outline':'#a0907c',
  'roads.default':'#4d5e68','roads.minor':'#435363','roads.tertiary':'#405163',
  'roads.secondary':'#3d4e5d','roads.primary':'#384858','roads.trunk':'#364554','roads.motorway':'#334351',
  'roads.city.minor':roadPalette.overview.minor,'roads.city.tertiary':roadPalette.overview.tertiary,'roads.city.secondary':roadPalette.overview.secondary,'roads.city.primary':roadPalette.overview.primary,
  'roads.casing':'#ccaf87','roads.default.casing':'#ccaf87','roads.detail.casing':'#ede2cf',
  'roads.city.casing':'#ccaf87','roads.motorway.casing':'#bda680','roads.trunk.casing':'#bda680',
  'roads.marking':'#f9e2ad',
  'roads.path':'#e3c58e','roads.path.casing':'#bf9f6c','roads.parkPath':'#ecd0a2',
  'roads.pedestrian.surface':'#e7ded0','roads.sidewalk.surface':'#eee6d8','roads.cycleway':'#6d9b89',
  'landcover.grass':'#a3c37a','landcover.greenspace':'#a9c587','landcover.urbanPark':'#96c170','landcover.wood':'#74a380',
  'vegetation.tree.bark':'#876449',
  'vegetation.tree.broadleaf.a':'#528150','vegetation.tree.broadleaf.b':'#6b9952',
  'vegetation.tree.broadleaf.c':'#84ab56','vegetation.tree.broadleaf.d':'#a4c669',
  'vegetation.tree.conifer.a':'#496f52','vegetation.tree.conifer.b':'#668c5b','vegetation.tree.conifer.c':'#83a56c',
  'landcover.hedgeShade':'#5b8149','landcover.hedge':'#83a759',
  'landcover.meadow':'#aabc75','landcover.recreationGround':'#9eb775','landuse.recreation':'#a2bb79',
  'landcover.sand':'#edca93',
  'hydro.water':'#77bfcd','hydro.ocean':'#6fcde4','hydro.waterway':'#6bb6cc',
  'hydro.water.overview':'#9de3f3','hydro.water.regional':'#74d4e7',
  'labels.water':'#176a91',
  'labels.road':roadPalette.label,'labels.roadHalo':roadPalette.halo,
 }},
});

// Tileflow places the marks on mapped road centrelines at street-level zooms.
const centreDashes={
 minZoom:17.25,angle:90,color:token.color('roads.marking'),
 opacity:zoom.linear([[17.25,0],[18.15,.76]]),
 size:zoom.linear([[17.25,10],[18.5,14],[20,17]]),
 spacing:zoom.linear([[17.25,28],[18.5,32],[20,38]]),
};
const localStreetWidth=zoom.exponential(1.5,[[12,.8],[14,2.1],[15,4.96],[18,24.6],[22,246]]);
const groundColor=(overview:string,street:string)=>zoom.linear([[14,token.color(overview)],[17.55,token.color(street)]]);
export default defineMap({
  id:'scent-trail',name:'Follow your nose',version:1,extends:streets,
  models:['./assets/trees'],
  defaultTheme:'dawn',themes:{dawn:adventure},
  modules:{
   poi:disable(),addresses:disable(),
   land:refine({
    background:{color:groundColor('sniff.land.overview','surface.background')},
    landuse:{
     residential:{fill:{color:groundColor('sniff.residential.overview','landuse.residential')}},
     civic:{fill:{color:groundColor('sniff.civic.overview','landuse.civic')}},
     education:{fill:{color:groundColor('sniff.education.overview','landuse.education')}},
     recreation:{fill:{color:groundColor('sniff.park.overview','landuse.recreation')}},
    },
    landcover:{
     urbanPark:{fill:{color:groundColor('sniff.park.overview','landcover.urbanPark')}},
     recreationGround:{fill:{color:groundColor('sniff.park.overview','landcover.recreationGround')}},
     meadow:{fill:{color:groundColor('sniff.grass.overview','landcover.meadow')}},
     wood:{fill:{color:groundColor('sniff.wood.overview','landcover.wood')}},
    },
   }),
   transit:refine({ferry:{opacity:zoom.linear([[8,0],[14,0],[17,1]])}}),
   // Keep street-scale footprints visible in the route view and beyond the nearby 3D scene.
   // Only SNIFF owns 3D buildings and their fades. Flat mode alone still declares the SDK's 3D scene.
   buildings:buildings({mode:'flat',extrusion:{visible:false},flat:{
    fill:{color:token.color('buildings.fill'),minZoom:14.5,opacity:zoom.linear([[14.5,0],[16,.66]])},
    outline:{color:token.color('buildings.outline'),minZoom:15.2,width:.65,opacity:zoom.linear([[15.2,0],[17,.36]])},
   }}),
   vegetation:refine({
    threeDimensional:{
     crownScale:1.1,finish:'faceted',edges:.13,
    },
   }),
   roads:refine({
    classes:{
     minor:{surface:{fill:{width:localStreetWidth},casing:{gapWidth:localStreetWidth},hatch:centreDashes}},
     tertiary:{surface:{hatch:centreDashes}},
     secondary:{surface:{hatch:centreDashes}},
     primary:{surface:{hatch:centreDashes}},
    },
   }),
  },
  view:{center:[-74.01385,40.70436],zoom:12.85,pitch:0,bearing:0},
  scenes:{'scent-trail':{theme:'dawn',camera:{type:'center',center:[-74.01385,40.70436],zoom:12.85,pitch:0,bearing:0},viewport:{width:1600,height:1000,dpr:1},target:{kind:'application',path:'/',captureId:'scent-map'}}},
});
