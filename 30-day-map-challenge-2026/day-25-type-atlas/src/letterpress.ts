import {expr, field, fixed, poi, renderPass, withRenderStack, zoom, type TileflowRenderSelector} from '@tileflow/core';

export const paper = '#f5efdf';
const print = <T extends string | number>(value: T) => fixed(value, {reason:'Letterpress palette and typesetting'});
// Keep polygons queryable for clipping glyphs while leaving the paper unprinted.
const stencil = {color:print(paper),opacity:print(0)};
const lineStencil = {...stencil,width:print(1)};
const classes = (...values: string[]): TileflowRenderSelector => ({kind:'in', field:'class', values});
const all = (...selectors: TileflowRenderSelector[]): TileflowRenderSelector => ({kind:'all', selectors});
const aboveGround: TileflowRenderSelector = {kind:'not', selector:{kind:'compare',field:'structure',operator:'eq',value:'tunnel'}};
const surfaceWater = all(aboveGround, {kind:'not',selector:{kind:'compare',field:'underground',operator:'eq',value:true}});
const named: TileflowRenderSelector = {kind:'has', field:'name'};
const line: TileflowRenderSelector = {kind:'geometry', geometry:'line'};
const streets = classes('motorway','trunk','primary','secondary','tertiary','street','pedestrian','path','service','track');
const signature: TileflowRenderSelector = {kind:'in',field:'name',values:['Bayard Street','Broadway']};
const isBridge: TileflowRenderSelector = {kind:'compare',field:'structure',operator:'eq',value:'bridge'};
const roadbed = (group: TileflowRenderSelector) => all(line,aboveGround,group,{kind:'not',selector:isBridge});
const arteries = classes('motorway','trunk','primary','secondary','tertiary');
const localRoads = classes('street','pedestrian');
const lanes = classes('service','path','track');
const font = print('Noto Sans Regular');
const type = {font, color:print('#302c27'), padding:print(2), haloColor:print(paper), haloWidth:print(1.3)};
const name = expr.get(field('name'));

export const letterpress = withRenderStack(poi({icons:false,labels:false,categories:[]}), {
  paper:renderPass({renderer:'background',placement:'below-land',style:{color:print(paper),opacity:print(0)}}),
  waterShapes:renderPass({renderer:'fill',feature:'water',placement:'above-water',style:{...stencil}}),
  countryEdges:renderPass({renderer:'line',feature:'admin',placement:'above-land',
    selector:all({kind:'compare',field:'adminLevel',operator:'eq',value:2},{kind:'not',selector:{kind:'has',field:'maritime'}},{kind:'not',selector:{kind:'has',field:'disputed'}}),
    style:{...lineStencil}}),
  contestedEdges:renderPass({renderer:'line',feature:'admin',placement:'above-land',selector:all({kind:'has',field:'disputed'},{kind:'not',selector:{kind:'has',field:'maritime'}}),
    style:{...lineStencil}}),
  regionEdges:renderPass({renderer:'line',feature:'admin',placement:'above-land',selector:all({kind:'compare',field:'adminLevel',operator:'eq',value:4},{kind:'not',selector:{kind:'has',field:'maritime'}}),
    style:{minZoom:4,maxZoom:12,...lineStencil}}),
  ground:renderPass({renderer:'fill',feature:'landcover',placement:'above-land',selector:classes('trees','crop','snow','barren','urban','shrub','grass'),
    style:{minZoom:3.4,maxZoom:11,...stencil}}),
  urbanGround:renderPass({renderer:'fill',feature:'landuse',placement:'above-land',selector:classes('wood','grass','park','garden','farmland','orchard','vineyard','residential','industrial','sand'),
    style:{minZoom:10.5,maxZoom:16,...stencil}}),
  closeGreen:renderPass({renderer:'fill',feature:'landuse',placement:'above-land',selector:classes('wood','grass','sand'),
    style:{minZoom:16,...stencil}}),
  countries:renderPass({renderer:'symbol',feature:'placeLabel',placement:'below-labels',selector:all(named,classes('country')),
    style:{minZoom:4.3,maxZoom:7.5,text:{...type,field:name,color:print('#564333'),size:zoom.linear([[3,print(13)],[7,print(17)]]),padding:print(7)}}}),
  stateNames:renderPass({renderer:'symbol',feature:'placeLabel',placement:'below-labels',selector:all(named,classes('state')),
    style:{minZoom:5.6,maxZoom:9.4,text:{...type,field:name,color:print('#81604b'),size:print(12),padding:print(7)}}}),
  towns:renderPass({renderer:'symbol',feature:'placeLabel',placement:'below-labels',selector:all(named,classes('settlement')),
    style:{minZoom:4.3,maxZoom:14,text:{...type,field:name,size:zoom.linear([[4,print(10)],[8,print(13)],[13,print(15)]]),padding:print(9)}}}),
  districts:renderPass({renderer:'symbol',feature:'placeLabel',placement:'below-labels',selector:all(named,classes('settlement_subdivision')),
    style:{minZoom:12,maxZoom:16,text:{...type,field:name,color:print('#605447'),size:print(13),padding:print(8)}}}),
  regionalRoads:renderPass({renderer:'line',feature:'road',placement:'above-roads',selector:roadbed(classes('motorway','trunk','primary')),
    style:{minZoom:5.6,maxZoom:10.5,...lineStencil}}),
  highwayRefs:renderPass({renderer:'symbol',feature:'roadLabel',placement:'above-roads',selector:all(line,classes('motorway','trunk','primary'),{kind:'has',field:'ref'}),
    style:{minZoom:6.5,maxZoom:13.5,placement:'line',spacing:print(130),text:{...type,field:expr.get(field('ref')),color:print('#945337'),font:print('Noto Sans Bold'),size:print(11),padding:print(5)}}}),
  summits:renderPass({renderer:'symbol',feature:'naturalLabel',placement:'below-labels',selector:all(classes('peak','volcano'),{kind:'has',field:'elevation'}),
    style:{minZoom:7.5,maxZoom:13,text:{...type,field:expr.concat('⌃ ',expr.toString(expr.get(field('elevation'))),' m'),color:print('#815f47'),size:print(10),padding:print(9)}}}),
  streams:renderPass({renderer:'line',feature:'waterway',placement:'above-water',selector:all(surfaceWater,classes('river','canal','stream')),
    style:{minZoom:5,...lineStencil}}),
  arteries:renderPass({renderer:'line',feature:'road',placement:'above-roads',selector:roadbed(arteries),
    style:{minZoom:10.5,...lineStencil}}),
  streets:renderPass({renderer:'line',feature:'road',placement:'above-roads',selector:roadbed(localRoads),
    style:{minZoom:13.1,...lineStencil}}),
  lanes:renderPass({renderer:'line',feature:'road',placement:'above-roads',selector:roadbed(lanes),
    style:{minZoom:15,...lineStencil}}),
  bridges:renderPass({renderer:'symbol',feature:'road',placement:'above-roads',selector:all(line,isBridge),
    style:{minZoom:11,placement:'line',spacing:print(22),text:{font, field:'= =', size:print(15), color:print('#aa4a30'),
      padding:print(1), ignorePlacement:true}}}),
  roofPrint:renderPass({renderer:'fill',feature:'building',placement:'above-buildings',
    style:{minZoom:16.1,...stencil}}),
  footprints:renderPass({renderer:'line',feature:'building',placement:'above-buildings',
    style:{minZoom:15.5,...lineStencil}}),
  addresses:renderPass({renderer:'symbol',feature:'housenumLabel',placement:'above-buildings',
    style:{minZoom:16.5,text:{...type,field:expr.get(field('houseNum')),size:zoom.linear([[16,print(10)],[18,print(13)],[19,print(15)]]),
      color:print('#695a4a'),padding:print(2),ignorePlacement:false}}}),
  trees:renderPass({renderer:'symbol',feature:'tree',placement:'above-land',
    style:{minZoom:15,text:{font,field:'*',size:zoom.linear([[15,print(12)],[18,print(19)]]),color:print('#527048'),padding:print(2),ignorePlacement:true}}}),
  parks:renderPass({renderer:'symbol',feature:'poiLabel',placement:'below-labels',selector:all(named,classes('park','garden')),
    style:{minZoom:12,text:{...type,field:name,color:print('#46633b'),size:print(11),padding:print(6),maxWidth:print(12)}}}),
  streetNames:renderPass({renderer:'symbol',feature:'roadLabel',placement:'below-labels',
    selector:all(line,named,aboveGround,streets,{kind:'not',selector:signature}),
    style:{minZoom:12.2,placement:'line',spacing:print(110),text:{...type,field:name,maxAngle:print(32),letterSpacing:print(.07),
      size:zoom.linear([[12,print(11)],[15,print(13)],[19,print(17)]])}}}),
  signatureStreet:renderPass({renderer:'symbol',feature:'roadLabel',placement:'above-labels',selector:all(line,aboveGround,signature),
    style:{minZoom:12.2,placement:'line',spacing:print(185),text:{...type,field:name,font:print('Noto Sans Bold'),color:print('#973b28'),
      size:zoom.linear([[13,print(13)],[18,print(19)]]),letterSpacing:print(.13),haloWidth:print(2)}}}),
});
