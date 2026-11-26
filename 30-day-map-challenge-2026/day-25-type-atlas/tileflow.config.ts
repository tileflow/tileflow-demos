import {defineMap, defineTheme, disable, geojsonSource, maplibreOverlay} from '@tileflow/core';
import {streets, streetsThemes} from '@tileflow/maps';

import {letterpress, paper} from './src/letterpress';
const typeface = ['Noto Sans Regular'];
const ink = '#302c27';
const vermilion = '#a4412d';
const halo = {'text-halo-color': paper, 'text-halo-width': 2.4};

const paperTheme = defineTheme(streetsThemes.dawn, {
  id: 'letterpress', version: 1, colorScheme: 'light',
});

type Caption = [string, number, number, number, 'borough' | 'district' | 'bridge', number, number];
const captions: Caption[] = [
  ['MANHATTAN',-73.968,40.777,-64,'borough',9,12.9],
  ['BROOKLYN',-73.967,40.691,0,'borough',9,13.3],
  ['QUEENS',-73.913,40.751,0,'borough',9,12.9],
  ['THE BRONX',-73.898,40.842,0,'borough',9,12.9],
  ['Lower Manhattan',-74.007,40.7145,0,'district',12.2,14.8],
  ['Brooklyn Heights',-73.995,40.6943,0,'district',12.2,15],
  ['DUMBO',-73.990,40.7031,0,'district',12.7,15],
  ['Chinatown',-73.9976,40.7157,0,'district',14.5,16.7],
  ['Brooklyn Bridge',-73.9966,40.7057,45,'bridge',12,15.8],
  ['Manhattan Bridge',-73.9897,40.707,62,'bridge',12.5,15.8],
];
const captionsSource = geojsonSource({data:{type:'FeatureCollection',features:captions.map(([title,x,y,angle,kind,min,max])=>({
  type:'Feature',properties:{title,angle,kind,min,max},geometry:{type:'Point',coordinates:[x,y]},
}))}});

export default defineMap({
  id:'type-atlas', name:'Atlas tipográfico', version:1, extends:streets, terrain:'none',
  defaultTheme:'paper',themes:{paper:paperTheme},icons:[],models:[],
  sky:false,projection:'mercator',
  modules:{landforms:disable(),aeroways:disable(),nautical:disable(),land:disable(),water:disable(),roads:disable(),transit:disable(),buildings:disable(),vegetation:disable(),labels:disable(),poi:letterpress,addresses:disable(),boundaries:disable()},
  sources:{captions:captionsSource},
  overlays:{
    names:maplibreOverlay({source:'captions',placement:'above-labels',layers:
      captions.map(([title,,,,kind,min,max],i)=>({
        id:'caption-'+i,type:'symbol',minzoom:min,maxzoom:max,filter:['==',['get','title'],title],
        layout:{'text-field':['get','title'],'text-max-width':60,'text-font':typeface,'text-rotate':['get','angle'],'text-allow-overlap':true,'text-ignore-placement':true,
          'text-letter-spacing':kind==='borough'?.28:.09,'text-size':kind==='borough'?21:kind==='bridge'?12:19},
        paint:{'text-color':kind==='bridge'?vermilion:ink,...halo},
      }))}),
  },
  view:{center:[-74.0006,40.71],zoom:13.7,pitch:0,bearing:0},
});
