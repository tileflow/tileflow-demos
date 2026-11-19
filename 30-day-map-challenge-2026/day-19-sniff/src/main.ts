import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import './game-ui.css';
import './intro-ui.css';
import './next-bite.css';
import {createTileflowMap} from '@tileflow/dom';
import type {Map as MapLibreMap} from 'maplibre-gl';
import {makeGraph,nearest,shortestPath,makeRoute,sampleRoute,toLocal,toLngLat,distance,setOrigin,ORIGIN} from './streets.mjs';
import {createWorld} from './world';
import {stylePaving} from './paving';
import {styleCartography} from './cartography';
import type {Building} from './buildings';
import {icons} from './icons';
import {safeCameraPitch} from './exploration.mjs';
import {angleDelta,createFollowCamera,GAMEPLAY_PITCH,MIN_GAMEPLAY_PITCH} from './camera.mjs';
import {createWalkSurface,segmentProjection} from './walking.mjs';
import {loadEncounters,loadNeighbourhood} from './world-loader';
import {ENCOUNTER_REFRESH_DISTANCE,mergeRegionEncounters} from './hazard-population.mjs';

const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
import {createRound,chooseTasting,reachableNodeIds,hazardHits,hazardContact,selectStreetObjects,nearestKnownIngredient,TASTES,HARD_CLOCK,PICKUP_RADIUS,REST_SECONDS,JUMP_SECONDS,jumpHeight} from './game.mjs';
import {createGameWorld} from './game-world';
import {createHud} from './hud';
import {createAromaJournal,type JournalScent} from './aroma-journal';
import {placeVenue} from './venue-placement';
import {createFoodPois} from './food-pois';
import {createMinimap} from './minimap';
import {createSound} from './sound';
import {findScentPathAsync,joinScentPath,SCENT_TRAIL_SECONDS} from './scent-path.mjs';
import {createScentTrail} from './scent-trail';
import {bindJumpButton,createJoystick} from './joystick';
import {CRITTERS,type CritterKind} from './critters';

import {createStartMarker} from './start-marker';

const harbour:[number,number]=[-74.01385,40.70436];
const harbourZoom=12.85;
const difficulties={
 easy:{label:'Easy',seconds:75,level:0},
 normal:{label:'Normal',seconds:60,level:1},
 hard:{label:'Hard',seconds:HARD_CLOCK.seconds,level:3,clock:HARD_CLOCK},
};
type Difficulty=keyof typeof difficulties;
import {createMovement} from './movement.mjs';
document.querySelector('#app')!.innerHTML=`<div id="map" aria-label="Scent map" aria-describedby="pick-spot-hint"></div><div class="vignette"></div>
<div id="pick-spot-hint" class="pick-spot-hint"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg><div><strong>Pick a starting point</strong><span>Tap the map or drag your character</span></div></div>
<header class="topbar"><a class="brand" href="https://tileflow.dev" target="_blank" rel="noopener" aria-label="Built with Tileflow"><span>Built with</span><img src="${import.meta.env.BASE_URL}tileflow-wordmark.svg" alt="Tileflow"></a><div class="top-actions"><button id="locate-me" class="round-button" disabled aria-label="Use my location" title="Use my location">${icons.target}</button><button id="pick-location" class="round-button" aria-label="Choose a new starting point" title="Choose a new starting point" hidden>⚑</button><button id="sound" class="round-button" aria-label="Mute sound" title="Sound">♫</button><button id="pause" class="round-button" aria-label="Pause" title="Pause" hidden>Ⅱ</button><button id="about" class="round-button" aria-label="How to play" title="How to play">?</button></div></header>
<section class="intro"><div class="intro-challenge"><span>30 Day Map Challenge</span><span>Day 19 · Senses: Smell</span></div><h1 aria-label="SNIFF!"><span class="intro-wordmark"><span data-wordmark="S">S</span><span data-wordmark="N">N</span><span data-wordmark="IF">IF</span><span data-wordmark="F">F</span></span><span class="intro-bang" data-wordmark="!">!</span></h1>
<div id="critter-label" class="setup-label">Play as</div>
<div class="critter-picker" role="group" aria-labelledby="critter-label">${Object.entries(CRITTERS).map(([kind,critter])=>`<button type="button" data-critter="${kind}" aria-pressed="${kind==='dog'}"><img class="critter-portrait" src="${import.meta.env.BASE_URL}critters/${kind}.webp" alt="" width="51" height="46" draggable="false"><small>${critter.label}</small></button>`).join('')}</div>
<div class="setup-label difficulty-label" id="difficulty-label">Difficulty</div>
<div class="difficulty-picker" role="group" aria-labelledby="difficulty-label">${Object.entries(difficulties).map(([key,{label}])=>'<button type="button" data-difficulty="'+key+'" aria-pressed="'+(key==='normal')+'">'+label+'</button>').join('')}</div>
<button id="start" class="play-button" disabled><span>Loading…</span></button>
<div class="intro-extras"><button id="free-play" disabled>Free roam</button></div></section>
<div id="start-status" role="status"></div>
<div class="round-stats" hidden><div id="health" class="health" aria-label="3 hearts"><span id="heart-0"></span><span id="heart-1"></span><span id="heart-2"></span></div><div class="timer" role="timer" aria-label="Time for the next bite"><span class="timer-icon">${icons.watch}</span><strong id="time">1:00</strong><button id="pause-inline" aria-label="Pause round">Ⅱ</button></div></div>
<aside class="order-board" hidden>
 <div class="order-title"><h2><span class="bites-mobile-title">Next bites</span><span class="bites-desktop-title">Your tasting</span></h2><span id="tasting-count"></span><div class="star-count"><span id="star-model"></span><strong id="stars">0</strong></div></div>
 <div id="ingredients"></div>
 <button type="button" id="next-bite" class="next-bite" title="Sniff for a trail" hidden>
  <span class="next-bite-copy">
   <small id="next-bite-status">Next bite</small>
   <strong id="next-bite-venue"></strong>
  </span>
  <span id="next-bite-direction"><span id="next-bite-arrow" aria-hidden="true">➜</span><strong id="next-bite-distance"></strong></span>
 </button>
 <div class="score-line"><strong id="score">0</strong><span>points</span><span id="combo"></span></div>
</aside>
<div class="explore-badge" hidden><span>🐾</span><strong id="found-total">0</strong><button id="start-here">▶ Play</button></div>
<div class="game-controls" hidden><button id="jump" class="jump-button" aria-label="Jump, Space">${icons.jump}<strong>Jump</strong><kbd>SPACE</kbd></button><button id="sniff" class="sniff-button" aria-label="Hold to sniff, E or Enter">${icons.paw}<span>Sniff!</span><kbd>E / ↵</kbd></button><button id="sprint" class="round-button sprint-button" aria-label="Hold to sprint, Shift">${icons.sprint}<small aria-hidden="true">Sprint</small><kbd>SHIFT</kbd></button><button id="sit" class="round-button sit-button" aria-label="Sit and recover, Control" aria-pressed="false" title="Sit · Ctrl">${icons.rest}<kbd>CTRL</kbd></button><button id="camera" class="round-button" aria-label="Follow the dog" title="Follow the dog">${icons.target}</button></div>
<figure class="minimap" hidden><figcaption><span class="sr-only">Live minimap</span><span class="minimap-north" aria-label="North up"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2 13 13 8 10 3 13Z" fill="currentColor"/></svg>N</span></figcaption><canvas id="minimap" role="img" aria-label="Live map of your route and heading"></canvas></figure>
<div id="joystick" class="joystick" aria-label="Drag to steer" hidden><span class="joystick-knob" aria-hidden="true">✥</span></div>
<button id="scent-guide" class="scent-guide" aria-label="Find a food scent" hidden><span id="guide-arrow">➜</span><strong id="guide-distance"></strong><span id="guide-kind"></span><span id="guide-aroma" hidden></span><span id="guide-venue" hidden><strong id="venue-name"></strong><small id="venue-type"></small></span></button>
<div id="venue-labels">${Array.from({length:3},()=>'<div class="venue-label" hidden></div>').join('')}</div>
<div id="arrival-card" class="arrival-card" hidden><span id="arrival-city"></span><strong id="arrival-street"></strong></div>
<div id="countdown" class="countdown" hidden><strong id="countdown-number">3</strong><span id="countdown-caption">WASD to run · Space to jump · E / Enter to sniff</span></div>
<div id="game-toast" class="game-toast" role="status" aria-live="polite"></div><div id="damage-flash"></div><div id="order-celebration" class="order-celebration" hidden></div>
<section id="pause-card" class="pause-card" hidden><span>Ⅱ</span><h2>Paws for a moment.</h2><button id="resume" class="play-button">Resume <b>▶</b></button><button id="quit" class="text-button">End round</button><button id="pick-paused" class="text-button">Change starting point</button></section>
<div class="film-ui" hidden><span>SNIFF! <small>by tileflow</small></span><button id="stop-film" class="round-button" aria-label="End film">×</button><div class="film-track"><span id="film-progress"></span></div></div>
<dialog id="about-dialog"><button id="close-about" class="round-button" aria-label="Close help">×</button><h2>Follow your nose.</h2><div class="help-grid"><span>🥐 ☕ 🥘</span><p>Follow your nose to taste the foods on your card. Eat what you are craving. Every bite refills the clock. Later cravings give you less time.</p><span>💩 🚗</span><p>Jump over holes and low fences. Dodge cars, bikes, scooters and smelly trash. Sprinklers and pedestrians slow you down.</p><span>♡</span><p>Sit safely to regain one heart every 3 seconds.</p></div><p class="help-keys"><b>WASD / arrows</b> run · <b>Space</b> jump<br><b>E / Enter</b> sniff · <b>Shift</b> sprint · <b>Ctrl</b> rest<br>Tap a spot to run there · Drag to look around</p><small>Real mapped businesses. Fictional collectibles and hazards. Paella is a game reward, not a menu claim. © OpenStreetMap · Tileflow.</small></dialog>
<div id="load-error" role="alert" hidden><strong>The map could not load.</strong><button id="retry" class="play-button">Try again ↻</button></div>
`;
document.body.dataset.mode='intro';
let selectedCritter:CritterKind='dog',selectedDifficulty:Difficulty='normal';
let selectedPoint:[number,number]=[...harbour];
let selectionVersion=0;
let startMarker:ReturnType<typeof createStartMarker>;
let menuMapMoved=false;

let mode:'intro'|'play'|'explore'|'film'|'end'='intro',map:MapLibreMap,world:ReturnType<typeof createWorld>,graph:ReturnType<typeof makeGraph>;
let buildings:Building[]=[],startNode:any,currentNode:any,pos=[0,0],heading=0,desiredHeading=0,walkPath:any[]=[],moving=false,running=false,sprinting=false,manualWalking=false,sitting=false,draggingMap=false;
let walkSurface:ReturnType<typeof createWalkSurface>,gameWorld:ReturnType<typeof createGameWorld>,hud:ReturnType<typeof createHud>;
let candidates:any[]=[],streetItems:StreetItem[]=[],hazards:any[]=[],nextTastingAt=0,countdown=0,arrivalUntil=0,paused=false,ready=false,travelling=false,streaming=false,regionVersion=0,nextStreamAttempt=0,streamCenter=[0,0],following=true;
let navigation=createFollowCamera([0,0],24,38),obstacles:{center:number[];height:number;ring:number[][]}[]=[];
let walkIntent=0,scentIntent=0,slowUntil=0;
let activeRegion=0,encounterEpoch=0,encounterCenter:number[]|undefined;
let pendingEncounters=false,waitingForFirstEncounters=false,nextEncounterAttempt=0;
let jump=0,jumpCooldown=0,scentTrail:ReturnType<typeof createScentTrail>;
let sniff=0,scentTarget:number|undefined,sniffPointer:number|null=null,sprintPointer:number|null=null,clockRefillUntil=0,lastFrame=0,lastUi=0,frameId=0,filmStart=0,filmRoute:ReturnType<typeof makeRoute>,cameraReady=0,placeLabel='New York',streetLabel='',toastUntil=0,damageUntil=0;
let sniffQueued=false,sniffStarted=0,scentUntil=0,trailUntil=0,scentSurface:typeof walkSurface|undefined,scentStatus:'seeking'|'route'|'bearing'|'empty'='empty';
const SNIFF_GESTURE_MS=900;
const SCENT_TRAIL_MS=SCENT_TRAIL_SECONDS*1000;
const URGENT_CLOCK_SECONDS=15;
type StreetItem = {id:number;kind:string;point:number[];nodeId:string;poi:Building['pois'][number];fromDoor:boolean;venue?:{point:number[];facing:number}};
type EnvironmentSite = {id:string;kind:'park'|'trees'|'coast';point:number[];name?:string};
const venueTypes:Record<string,string>={bakery:'Bakery',cafe:'Café',restaurant:'Restaurant',iceCream:'Ice cream shop',fastFood:'Fast food'};
const environmentAromas={
 park:{aroma:'Fresh grass',category:'Park',color:'#519351'},
 trees:{aroma:'Green leaves',category:'Trees',color:'#388267'},
 coast:{aroma:'Waterfront breeze',category:'Waterfront',color:'#3282b2'},
};
const journalScents=new Map<string,JournalScent>();
let foodPois:ReturnType<typeof createFoodPois>;
let justTasted:{id:number;until:number}|undefined;
let activeVenue:StreetItem|undefined,nearbyVenues:{item:StreetItem;gap:number}[]=[];
const venueLabels=Array.from(document.querySelectorAll<HTMLElement>('.venue-label'));
let journal:ReturnType<typeof createAromaJournal>,walkedRoute:number[][]=[];
let roundStart:{point:number[];regionCenter:number[];heading:number}|undefined;
const minimap=createMinimap($<HTMLCanvasElement>('minimap'));
let lastRoutePoint:number[]|undefined,routeSpacing=4;
let environmentSites:EnvironmentSite[]=[],ambient:EnvironmentSite|undefined;
const found=new Map<number,Building>(),keys=new Set<string>(),sniffKeys=new Map<string,number>(),exploreCollected=new Set<number>(),inFlight=new Set<number>(),sound=createSound(),motion=createMovement();
let round=createRound();
const desktopHud=matchMedia('(min-width:701px) and (hover:hover) and (pointer:fine)');
const minimapLayout=matchMedia('(min-width:900px) and (hover:hover) and (pointer:fine)');
const cameraButton=$('camera');
const cameraHome=cameraButton.parentElement!;
const minimapPanel=document.querySelector<HTMLElement>('.minimap')!;
function placeCameraButton(){
 (minimapLayout.matches?minimapPanel:cameraHome).append(cameraButton);
}
minimapLayout.addEventListener('change',placeCameraButton);
placeCameraButton();
let maximumTastingSize=3;
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const taste = (kind:string) => TASTES[kind as keyof typeof TASTES];
const joystick = createJoystick($('joystick'),canPlay,()=>{cancelWalk();motion.reset();});
function canQueueSniff(){
 return (mode==='play'||mode==='explore')&&!paused&&!travelling&&!document.hidden&&!$<HTMLDialogElement>('about-dialog').open;
}
function canPlay() {
 return canQueueSniff()&&countdown===0&&round.state.stun===0;
}
function sniffHeldAt(now:number){
 if(sniffPointer!==null&&$('sniff').hasPointerCapture(sniffPointer))return true;
 for(const last of sniffKeys.values())if(now-last<700)return true;
 return false;
}
function sniffGestureActive(now:number,held=sniffHeldAt(now)){
 return sniffStarted>0&&canPlay()&&jump===0&&(held||now-sniffStarted<SNIFF_GESTURE_MS);
}
function cancelWalk(){
 walkPath=[];
 walkIntent++;
}
function clearScent(){
 scentIntent++;
 sniff=sniffStarted=scentUntil=trailUntil=0;
 scentTarget=undefined;
 scentTrail?.clear();
}
function clearInput() {
 cancelWalk();
 clearScent();
 keys.clear();
 sniffKeys.clear();
 sniffPointer=null;
 sniffQueued=false;
 sprintPointer=null;
 joystick.reset();
 motion.reset();
}
const compactRendering=matchMedia('(max-width:700px),(pointer:coarse)').matches;
const controller=createTileflowMap($('map'),{source:{map:'scent-trail',manifestUrl:`${import.meta.env.BASE_URL}tileflow/manifest.json`},theme:'dawn',center:harbour,zoom:harbourZoom,mapOptions:{
 pitch:0,bearing:0,maxPitch:60,
 canvasContextAttributes:{antialias:true,preserveDrawingBuffer:!compactRendering},
 ...(compactRendering?{pixelRatio:Math.min(devicePixelRatio,1.5)}:{}),
 attributionControl:{compact:true},maxZoom:19.5,minZoom:1.5,
},onError:({error})=>{console.error(error);if(!ready)$('load-error').hidden=false;}},{captureId:'scent-map'});
function refreshCandidates(entrances:Map<number,number[][]>,relocate:boolean){
 const preferred=new Set(relocate?[]:streetItems.filter(item=>distance(pos,item.point)<FOOD_SENSE_RANGE)
  .map(item=>item.id));
 const cells=new Map<string,{id:string;p:number[]}[]>();
 for(const node of graph.nodes.values()){
  const key=`${Math.floor(node.p[0]/50)},${Math.floor(node.p[1]/50)}`;
  const cell=cells.get(key);
  if(cell)cell.push(node);
  else cells.set(key,[node]);
 }
 function nearbyNodes(point:number[]){
  const x=Math.floor(point[0]/50),z=Math.floor(point[1]/50);
  const nodes:{id:string;p:number[];gap:number}[]=[];
  for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++){
   for(const node of cells.get(`${x+dx},${z+dz}`)??[]){
    const gap=distance(node.p,point);
    if(gap<100&&walkSurface.canStand(node.p))nodes.push({...node,gap});
   }
  }
  return nodes.sort((a,b)=>a.gap-b.gap).slice(0,12);
 }
 candidates=[];
 for(const building of buildings){
  const food=building.pois.filter(poi=>taste(poi.category));
  const poi=food.find(poi=>poi.name)||food[0];
  if(!poi)continue;
  const location=toLocal(poi.coordinate);
  const placement=placeVenue(building,location,entrances.get(building.id)??[],nearbyNodes(location),walkSurface);
  if(placement&&!hazards.some(hazard=>!hazard.route&&distance(hazard.point,placement.point)<10))
   candidates.push({id:building.id,building,kind:poi.category,poi,...placement});
 }
 streetItems=selectStreetObjects(candidates,34,preferred);
 gameWorld?.setObjects(streetItems);
 foodPois?.setItems(streetItems);
}
function foodAroma(item:StreetItem){
 return item.kind==='food'?'Kitchen aromas':taste(item.kind).aroma;
}
function venueCategory(item:StreetItem){
 return venueTypes[item.poi.venueType??'']??'Food spot';
}
function discoverVenue(item:StreetItem,tasted=false){
 if(mode!=='play')return;
 const id='venue-'+item.poi.id;
 if(!tasted&&journalScents.has(id))return;
 const category=venueCategory(item);
 journalScents.set(id,{id,coordinate:toLngLat(item.point) as [number,number],
  name:item.poi.name||category,aroma:foodAroma(item),category,color:taste(item.kind).trace,tasted});
}
function focusedVenue(now:number){
 if((mode!=='play'&&mode!=='explore')||countdown)return;
 if(justTasted&&now<justTasted.until){
  const tasted=streetItems.find(item=>item.id===justTasted?.id);
  if(tasted)return tasted;
 }
 const sniffed=sniff>0?streetItems.find(item=>item.id===scentTarget):undefined;
 if(sniffed)return sniffed;
 if(mode==='play'&&!nextTastingAt)return nearestKnownIngredient(
  streetItems,round.state.slots,round.state.collected,pos,
  (point:number[])=>distance(pos,point)<38&&world.isRevealed(point),
 ) as StreetItem|undefined;
}
const VENUE_NAME_RANGE=62;
const FOOD_SENSE_RANGE=450;
function venuesInRange(){
 if((mode!=='play'&&mode!=='explore')||paused||countdown)return [];
 return streetItems.filter(item=>item.poi.name).map(item=>({item,gap:distance(pos,item.point)}))
  .filter(({gap})=>gap<VENUE_NAME_RANGE).sort((a,b)=>a.gap-b.gap);
}
function updateVenueLabels(){
 let visible=0;
 const reserved:{x:number;y:number;width:number}[]=[];
 for(const {item,gap} of nearbyVenues){
  if(visible===venueLabels.length)break;
  const [groundX,groundY]=world.project([item.point[0],0,item.point[1]]);
  const x=groundX+25,y=groundY-52;
  const proximity=Math.max(0,Math.min(1,(VENUE_NAME_RANGE-gap)/(VENUE_NAME_RANGE-12)));
  const width=Math.min(230,item.poi.name.length*9+24);
  if(!Number.isFinite(x+y)||x<width/2+8||x>innerWidth-width/2-8||y<83||y>innerHeight-45)continue;
  if(reserved.some(other=>Math.abs(x-other.x)<(width+other.width)/2+9&&Math.abs(y-other.y)<47))continue;
  const label=venueLabels[visible++];
  label.hidden=false;
  if(label.textContent!==item.poi.name){
   label.textContent=item.poi.name;
   label.style.setProperty('--venue-accent',taste(item.kind).trace);
  }
  label.style.opacity=String(.76+.24*proximity);
  label.style.transform=`translate(${x}px,${y}px) translate(-50%,-100%) scale(${.85+.34*proximity})`;
  reserved.push({x,y,width});
 }
 for(const label of venueLabels.slice(visible))label.hidden=true;
}
function resetRoute(){
 walkedRoute=[];
 lastRoutePoint=undefined;
 routeSpacing=4;
 recordRoute(true);
}
function recordRoute(force=false){
 const gap=lastRoutePoint?distance(pos,lastRoutePoint):Infinity;
 if(gap<(force ? .15 : routeSpacing))return;
 lastRoutePoint=[...pos];
 if(walkedRoute.length>=1800){
  walkedRoute=walkedRoute.filter((_,index)=>index%2===0);
  routeSpacing*=2;
 }
 walkedRoute.push(lastRoutePoint);
}
function setAmbient(site?:EnvironmentSite){
 if(ambient===site)return;
 ambient=site;
 gameWorld?.setEnvironmentScent(site?{point:site.point,kind:site.kind==='trees'?'wood':site.kind}:null);
}
function discoverEnvironment(){
 let closest:EnvironmentSite|undefined,best=58;
 for(const site of environmentSites){
  const gap=distance(pos,site.point);
  if(gap<best){best=gap;closest=site;}
 }
 setAmbient(closest);
 if(!closest||mode!=='play')return;
 const id='ambient-'+closest.id;
 if(journalScents.has(id))return;
 const {aroma,category,color}=environmentAromas[closest.kind];
 journalScents.set(id,{id,coordinate:toLngLat(closest.point) as [number,number],name:closest.name||category,aroma,category,color});
}
function namedStreet(point:number[],lines:Awaited<ReturnType<typeof loadNeighbourhood>>['streetLabels']){
 let name='',best=45;
 for(const road of lines){

  for(let i=1;i<road.points.length;i++){
   const gap=segmentProjection(point,road.points[i-1],road.points[i]).distance;
   if(gap>=best)continue;
   name=road.name;
   best=gap;
  }
 }
 return name;
}
function installRegion(data:Awaited<ReturnType<typeof loadNeighbourhood>>,relocate=false){
 const surface=createWalkSurface(data.lines,data.buildings,data.areas,{center:data.center,radius:600},data.water);
 const spawn=relocate?nearest({nodes:new Map([...data.graph.nodes].filter(([,n])=>surface.canStand(n.p)))},data.center):null;if(relocate&&(!spawn||distance(spawn.p,data.center)>350)){
  throw Error('No walkable street nearby. Move your pin onto land and try again.');
 }
 activeRegion=data.regionId;graph=data.graph;buildings=data.buildings as Building[];walkSurface=surface;streamCenter=[...data.center];obstacles=buildings.filter(b=>b.extrude!==false).map(b=>({center:b.center,height:b.height,ring:b.outline.map(toLocal)}));
 if(relocate){startNode=spawn;currentNode=startNode;pos=[...startNode.p];streetLabel=namedStreet(pos,data.streetLabels);walkPath=[];world?.relocate(buildings);}
 else{currentNode=graph.nodes.get(currentNode?.id)??nearest(graph,pos);world?.setBuildings(buildings);}if(mode==='play')walkSurface.setBarriers(hazards.filter(h=>h.kind==='barrier'));environmentSites=data.environment as EnvironmentSite[];
 setAmbient();
 minimap.setRegion(data);
 world.setParks(data);
 refreshCandidates(data.entrances,relocate);
}
function buildFilmRoute(){const points=[startNode.p];let prev=startNode,total=0;for(const kind of ['bread','coffee','food','pizza']){const options=candidates.filter(c=>c.kind===kind).sort((a,b)=>distance(a.point,prev.p)-distance(b.point,prev.p));for(const c of options.slice(0,15)){const node=graph.nodes.get(c.nodeId)!,ids=shortestPath(graph,prev.id,node.id);if(ids.length<2)continue;const route=ids.map((id:any)=>graph.nodes.get(id)!.p),length=makeRoute(route).length;if(total+length>600)continue;points.push(...route.slice(1));prev=node;total+=length;break;}}filmRoute=makeRoute(points);}
function setMode(next:typeof mode){
 if(next!=='end'&&journal?.active){journal.hide();world.update({overview:next==='intro'});}
 mode=next;draggingMap=false;
 encounterEpoch++;
 encounterCenter=undefined;
 pendingEncounters=waitingForFirstEncounters=false;
 nextEncounterAttempt=slowUntil=0;
 hazards=[];
 gameWorld?.setHazards(hazards);
 foodPois?.setVisible(next==='play'||next==='explore'||next==='film');
 if(next==='intro')startMarker?.setLocation(selectedPoint);
 else startMarker?.hide();
 $('locate-me').hidden=next!=='intro';
 $('pick-location').hidden=next!=='explore'&&next!=='end';
 arrivalUntil=0;
 $('arrival-card').hidden=true;
 document.body.classList.remove('arriving');
 map?.dragPan.enable();
 if(next==='intro')map?.keyboard.enable();
 else map?.keyboard.disable();clearInput();sniff=0;scentTarget=undefined;clockRefillUntil=0;jump=jumpCooldown=0;scentTrail?.clear();setAmbient();activeVenue=justTasted=undefined;nearbyVenues=[];updateVenueLabels();walkSurface?.setHeight(0);walkSurface?.setBarriers([]);document.body.dataset.mode=next;for(const [selector,visible] of [['.intro',mode==='intro'],['.round-stats',mode==='play'],['.order-board',mode==='play'],['.explore-badge',mode==='explore'],['.game-controls',mode==='play'||mode==='explore'],['.minimap',mode==='play'||mode==='explore'],['#joystick',mode==='play'||mode==='explore'],['#scent-guide',mode==='play'],['.film-ui',mode==='film'],['#pause',mode==='play']])document.querySelector<HTMLElement>(selector as string)!.hidden=!visible;keys.clear();$('pause-card').hidden=true;paused=false;}
function resetCamera(){navigation.reset(toLocal([map.getCenter().lng,map.getCenter().lat]),map.getBearing(),map.getPitch());}
function startExplore(){if(!ready||travelling)return;if(mode!=='end')resetRoute();sound.unlock();round.stop();gameWorld.clear();exploreCollected.clear();hud.clearFlights();inFlight.clear();setMode('explore');countdown=0;following=true;setSitting(false);walkPath=[];sniff=0;$('countdown').hidden=true;$('order-celebration').hidden=true;map.easeTo({center:toLngLat(pos) as [number,number],zoom:18.65,pitch:startingPitch(),duration:600});cameraReady=performance.now()+600;resetCamera();}
function selectTasting(collected=round.state.collected,count=Math.min(maximumTastingSize,2+round.state.tastings)){const near=nearest(graph,pos),reachable=reachableNodeIds(graph,near.id);return chooseTasting(streetItems,pos,collected,(c:any)=>reachable.has(c.nodeId),FOOD_SENSE_RANGE,count);}
function showTasting(){
 const state=round.state;
 $('ingredients').innerHTML=state.slots.map((slot,i)=>{
  const item=taste(slot.kind);
  return '<div class="ingredient" style="--slot:'+item.color+'" aria-label="'+item.label+' to taste"><div id="ingredient-'+i+'" class="ingredient-model" aria-hidden="true"></div><span class="ingredient-count">○</span><span class="ingredient-name" aria-hidden="true">'+item.label+'</span></div>';
 }).join('');
 hud.setTasting(state.slots);
}
async function refreshEncounters(now:number,initial=false){
 if(mode!=='play'||pendingEncounters||now<nextEncounterAttempt)return;
 if(encounterCenter&&distance(pos,encounterCenter)<ENCOUNTER_REFRESH_DISTANCE)return;
 const first=!encounterCenter,epoch=encounterEpoch,region=activeRegion,origin=[...pos],previous=hazards;
 const food=streetItems.map(({point,nodeId})=>({point,nodeId}));
 const difficulty=difficulties[selectedDifficulty].level;
 pendingEncounters=true;
 if(initial)waitingForFirstEncounters=true;
 try{
  const incoming=await loadEncounters(region,origin,food,first?{difficulty}:{
   difficulty,minRange:100,maxRange:295,traffic:difficulty===3,allowClosures:false,allowCrowds:true,existing:previous,
  });
  if(epoch!==encounterEpoch||region!==activeRegion)return;
  encounterCenter=origin;
  hazards=first?incoming:mergeRegionEncounters(previous,
   incoming.filter(hazard=>walkSurface.canStand(hazard.point,0)),pos,streetItems);
  walkSurface.setBarriers(hazards.filter(hazard=>hazard.kind==='barrier'));
  gameWorld.setHazards(hazards);
 }catch(error){
  if(epoch!==encounterEpoch)return;
  nextEncounterAttempt=performance.now()+3000;
  console.warn(error);
 }finally{
  if(epoch===encounterEpoch)pendingEncounters=waitingForFirstEncounters=false;
 }
}
function startRound(){
 if(!ready||travelling)return;
 sound.unlock();
 const slots=selectTasting(new Set(),2);
 if(!slots.length){startExplore();toast('No food nearby. Try another neighbourhood.');return;}
 roundStart={point:[...pos],regionCenter:[...streamCenter],heading:desiredHeading};
 const fromOverview=mode==='intro';
 found.clear();
 world.resetDiscovery();
 const difficulty=difficulties[selectedDifficulty];
 maximumTastingSize=desktopHud.matches?4:3;
 round=createRound(difficulty.seconds,'clock' in difficulty?difficulty.clock:undefined);
 round.start(slots);
 setMode('play');
 journalScents.clear();
 resetRoute();
 inFlight.clear();
 hud.clearFlights();
 toastUntil=damageUntil=0;
 $('game-toast').classList.remove('show');
 $('countdown-caption').textContent=matchMedia('(max-width:700px),(pointer:coarse)').matches
  ?'Drag to run · Hold Sniff to find food':'WASD or arrows · Shift to sprint · E or Enter to sniff';
 sniff=0;
 nextTastingAt=0;
 countdown=fromOverview?2:3;
 following=true;
 walkPath=[];
 setSitting(false);
 showTasting();
 void refreshEncounters(performance.now(),true);
 $('countdown').hidden=fromOverview;
 $('countdown-number').textContent=String(countdown);
 $('order-celebration').hidden=true;

 const pitch=fromOverview?GAMEPLAY_PITCH:startingPitch();
 const view={center:toLngLat(pos) as [number,number],zoom:18.65,bearing:fromOverview?24:map.getBearing(),pitch};
 if(fromOverview){
  const duration=reduced?0:2250;
  arrivalUntil=performance.now()+duration;
  $('arrival-city').textContent=placeLabel||'Start here';
  $('arrival-street').textContent=streetLabel||'Starting point';
  $('arrival-card').hidden=false;
  document.body.classList.toggle('arriving',duration>0);
  if(duration>0){
   map.dragPan.disable();
   map.flyTo({...view,curve:1.1,duration});
  }
  else map.jumpTo(view);
  cameraReady=arrivalUntil;
 }else{
  map.easeTo({...view,duration:650});
  cameraReady=performance.now()+650;
 }
 resetCamera();
 updateUi();
}
async function replayRound(){
 if(mode!=='end'||travelling||!roundStart)return;
 const start=roundStart;
 sound.unlock();
 regionVersion++;
 if(distance(start.regionCenter,streamCenter)>.1){
  travelling=true;
  journal.replayStatus(true);
  try{
   const data=await loadNeighbourhood(toLngLat(start.regionCenter));
   installRegion(data);
  }catch{
   journal.replayStatus(false,'Could not load the starting streets. Try again.');
   return;
  }finally{
   travelling=false;
  }
 }
 journal.replayStatus(false);
 pos=[...start.point];
 currentNode=nearest(graph,pos);
 heading=desiredHeading=start.heading;
 startRound();
}
function endRound(reason:string){
 if(mode!=='play')return;
 recordRoute(true);
 const state=round.state;
 state.status='finished';
 walkPath=[];
 setMode('end');
 setSitting(reason==='nose');
 $('countdown').hidden=true;
 hud.clearFlights();
 gameWorld.clear();
 hud.finishRound();
 $('game-toast').classList.remove('show');
 $('damage-flash').classList.remove('hit');
 sound.setMusic(false);
 sound.play(reason==='nose'?'hurt':'order');
 world.update({x:pos[0],z:pos[1],overview:false,moving:false,sprinting:false,sniff:0,trailPoints:[]});
 const eaten=state.recipes.flat();
 if(state.slots.some(slot=>!slot.done))eaten.push(...state.slots.filter(slot=>slot.done).map(slot=>slot.kind));
 journal.show({
  route:walkedRoute.map(p=>toLngLat(p) as [number,number]),
  scents:[...journalScents.values()],
  place:placeLabel,
  result:{score:state.score,bites:state.collected.size,eaten},
 },()=>world.update({overview:true}));
}
function togglePause(value=!paused){if(mode!=='play')return;paused=value;clearInput();sniff=0;scentTrail.clear();walkPath=[];$('pause-card').hidden=!paused;lastFrame=performance.now();}
function setSitting(value:boolean){if(value&&jump>0)return;if(sitting===value)return;sitting=value;$('sit').setAttribute('aria-pressed',String(value));if(value){walkPath=[];clearInput();sniff=0;scentTrail.clear();}}
function toast(message:string,kind='good'){$('game-toast').dataset.kind=kind;$('game-toast').textContent=message;$('game-toast').classList.add('show');toastUntil=performance.now()+1600;}
function onDiscovery(b:Building){if(found.has(b.id))return;found.set(b.id,b);$('found-total').textContent=String(found.size);}
function handleEvents(events:any[]){for(const event of events){if(event.type==='hurt'){clearInput();walkPath=[];sniff=jump=0;motion.reset();scentTrail.clear();setSitting(false);world.hurt();sound.play('hurt');damageUntil=performance.now()+450;toast('YUCK!','wrong');}if(event.type==='heal'){sound.play('heal');toast('+1 ♥');}
 if(event.type==='pickup'){
  const item=streetItems.find(item=>item.id===event.id);
  if(item){discoverVenue(item,true);justTasted={id:item.id,until:performance.now()+2800};}
  clockRefillUntil=performance.now()+650;
  const aimedItem=streetItems.find(item=>item.id===scentTarget);
  const stillNeeded=round.state.slots.some(slot=>slot.kind===event.kind&&!slot.done);
  if(event.id===scentTarget||aimedItem?.kind===event.kind&&!stillNeeded)clearScent();
  const index=event.index;
  inFlight.add(event.slotId);
  world.react(event.kind);
  sound.play('pickup');
  hud.collect(event.kind,index,world.project([event.point[0],2,event.point[1]]),world.project([pos[0],5,pos[1]]),()=>{
   inFlight.delete(event.slotId);
   document.querySelectorAll('.ingredient')[index]?.classList.add('pop');
   updateUi();
  });
  toast(`+${event.points}`);
 }
 if(event.type==='tasting'){clearScent();nextTastingAt=round.state.elapsed+1.8;sound.play('order');hud.celebrateTasting(round.state.recipes.at(-1)??[],round.state.tastings);}
 if(event.type==='end')endRound(event.reason);}}
function updateNextBite(kind:string|undefined,target:StreetItem|undefined,metres:number,bearing:number,tracing:boolean){
 const button=$<HTMLButtonElement>('next-bite');
 button.hidden=!kind;
 if(!kind)return;
 const food=taste(kind);
 const venue=target?(target.poi.name||venueCategory(target)):'Sniff for a trail';
 button.disabled=paused||countdown>0;
 button.style.setProperty('--bite-trace',food.trace);
 button.setAttribute('aria-label',target?`Next bite: ${food.label} at ${venue}, ${metres} metres. Sniff for a trail.`:`Next bite: ${food.label}. Sniff for a trail.`);
 $('next-bite-status').textContent=tracing?'Tracing scent…':'Next bite';
 $('next-bite-venue').textContent=venue;
 $('next-bite-direction').hidden=!target;
 $('next-bite-distance').textContent=`${metres} m`;
 $('next-bite-arrow').style.transform=`rotate(${bearing}deg)`;
}
function updateUi(){const state=round.state;$('sprint').setAttribute('aria-pressed',String(sprinting));$('time').textContent=`${Math.floor(Math.ceil(state.remaining)/60)}:${String(Math.ceil(state.remaining)%60).padStart(2,'0')}`;document.querySelector('.timer')!.classList.toggle('urgent',state.remaining<=URGENT_CLOCK_SECONDS);$('health').setAttribute('aria-label',`${state.health} hearts`);$('score').textContent=String(state.score);$('stars').textContent=String(state.stars);$('combo').textContent=state.combo>1?`×${state.combo}`:'';
 const desktopPlay=mode==='play'&&desktopHud.matches;
 const tastingActive=mode==='play'&&!nextTastingAt;
 const currentScent=sniff>0?streetItems.find(item=>item.id===scentTarget):undefined;
 const nearbyTarget=tastingActive?nearestKnownIngredient(streetItems,state.slots,state.collected,pos,
  (point:number[])=>world.isRevealed(point)):undefined;
 const plannedTarget=desktopPlay&&tastingActive&&!currentScent&&!nearbyTarget
  ?state.slots.flatMap(slot=>slot.done?[]:streetItems.filter(item=>item.id===slot.id&&!state.collected.has(item.id)))[0]
  :undefined;
 const target=currentScent??nearbyTarget??plannedTarget;
 const featured=desktopPlay&&tastingActive
  ?state.slots.findIndex(slot=>!slot.done&&(!target||slot.kind===target.kind)):-1;
 let bearing=0,metres=0,completed=0;
 if(target){
  const p=map.project(toLngLat(target.point) as [number,number]);
  const dog=map.project(toLngLat(pos) as [number,number]);
  bearing=Math.atan2(p.y-dog.y,p.x-dog.x)*180/Math.PI;
  metres=Math.round(distance(pos,target.point));
 }
 document.querySelectorAll('.ingredient').forEach((el,i)=>{
  const s=state.slots[i];
  if(!s)return;
  const done=s.done&&!inFlight.has(s.id);
  completed+=Number(done);
  el.classList.toggle('done',done);
  el.classList.toggle('is-next',i===featured);
  el.setAttribute('aria-label',`${taste(s.kind).label} ${done?'tasted':'to taste'}`);
  el.querySelector('.ingredient-count')!.textContent=done?'✓':'○';
 });
 if(desktopPlay){
  updateNextBite(state.slots[featured]?.kind,target,metres,bearing,!!currentScent&&scentStatus==='seeking');
  $('tasting-count').textContent=`${completed}/${state.slots.length}`;
 }
 $('sniff').setAttribute('aria-pressed',String(sniffGestureActive(performance.now())));
 document.body.classList.toggle('resting',state.rest>0);
 const guide=$('scent-guide');
 guide.hidden=desktopPlay||paused||countdown>0||(mode==='play'?!!nextTastingAt:mode!=='explore'||sniff<=0);
 const aroma=$('guide-aroma');
 aroma.hidden=!currentScent;
 aroma.textContent=currentScent?(scentStatus==='seeking'?'Tracing scent…':foodAroma(currentScent)):'';
 $('guide-venue').hidden=!currentScent;
 if(currentScent){
  const category=venueCategory(currentScent);
  $('venue-name').textContent=currentScent.poi.name||category;
  $('venue-type').textContent=[currentScent.poi.name?category:'',currentScent.fromDoor?'Mapped entrance':''].filter(Boolean).join(' · ');
 }
 guide.style.setProperty('--scent-color',currentScent?taste(currentScent.kind).trace:'#7957bd');
 if(target){
  $('guide-arrow').textContent='➜';
  $('guide-arrow').style.transform=`rotate(${bearing}deg)`;
  $('guide-distance').textContent=`${metres} m`;
  $('guide-kind').textContent=taste(target.kind).emoji;
 }else{
  $('guide-arrow').textContent=sniff>0?'◌':'?';
  $('guide-arrow').style.transform='none';
  $('guide-distance').textContent=sniff>0?'No food scents nearby':'Sniff for food';
  $('guide-kind').textContent='';
 }
}
function jumpDog(){if(!canPlay()||jumpCooldown>0)return;setSitting(false);jump=JUMP_SECONDS;jumpCooldown=JUMP_SECONDS;sound.unlock();sound.play('jump');}
async function drawScentTrail(){
 const needed=mode==='play'?new Set(round.state.slots.filter(slot=>!slot.done).map(slot=>slot.kind)):new Set(Object.keys(TASTES));
 const collected=mode==='play'?round.state.collected:exploreCollected;
 const forward=[Math.sin(desiredHeading),Math.cos(desiredHeading)];
 const score=(point:number[])=>{
  const metres=distance(pos,point);
  const ahead=((point[0]-pos[0])*forward[0]+(point[1]-pos[1])*forward[1])/Math.max(1,metres);
  return metres+Math.max(0,.6-ahead)*30;
 };
 const targets=streetItems.filter(item=>needed.has(item.kind)&&!collected.has(item.id))
  .sort((a,b)=>score(a.point)-score(b.point)).slice(0,5);
 const obstaclesAhead=mode==='play'?hazards.filter(hazard=>!hazard.route&&hazard.kind!=='barrier'):[];
 const ticket=++scentIntent,surface=walkSurface,origin=[...pos],elapsed=round.state.elapsed;
 const stillSniffing=()=>ticket===scentIntent&&surface===walkSurface&&performance.now()<scentUntil&&canPlay();
 const canStand=(point:number[])=>surface.canStand(point,0);
 const options={step:1.25,maxVisited:12500};
 if(scentSurface!==surface||scentTarget!==targets[0]?.id){
  scentTrail.clear();
  trailUntil=0;
 }
 scentSurface=surface;
 scentTarget=targets[0]?.id;
 const nearby=targets.filter(target=>distance(origin,target.point)<=FOOD_SENSE_RANGE);
 scentStatus=nearby.length?'seeking':targets.length?'bearing':'empty';
 if(!nearby.length)return;

 let retraced=false;
 for(const target of nearby){
  if(!stillSniffing())return;
  const safe=(point:number[])=>canStand(point)&&!hazardHits(obstaclesAhead,point,elapsed);
  const safePath=obstaclesAhead.length?await findScentPathAsync(origin,target.point,safe,{...options,maxVisited:3500,padding:55},stillSniffing):[];
  if(!stillSniffing())return;
  // Transient hazards can leave a narrow lane. Footprints and closures remain solid.
  let path=safePath.length?safePath:await findScentPathAsync(origin,target.point,canStand,options,stillSniffing);
  if(!stillSniffing())return;
  if(!path.length)continue;
  const canTravel=(a:number[],b:number[])=>surface.canTravel(a,b,0);
  if(distance(pos,origin)>5){
   path=joinScentPath(path,pos,canTravel);
   if(!path.length&&!retraced){
    retraced=true;
    path=await findScentPathAsync(pos,target.point,canStand,options,stillSniffing);
    if(!stillSniffing())return;
    if(path.length)path=joinScentPath(path,pos,canTravel);
   }
  }
  if(!path.length)continue;
  scentTrail.setPath(path,taste(target.kind).trace);
  trailUntil=performance.now()+SCENT_TRAIL_MS;
  scentUntil=trailUntil;
  scentTarget=target.id;
  scentStatus='route';
  discoverVenue(target);
  return;
 }
 scentStatus='bearing';
 discoverVenue(nearby[0]);
}
function sniffAir(gesture=true){
 if(!canQueueSniff())return;
 if(!canPlay()||jump>0||nextTastingAt&&mode==='play'){if(gesture)sniffQueued=true;return;}
 sniffQueued=false;
 const now=performance.now();
 if(gesture&&sniffStarted&&now-sniffStarted<140)return;
 setSitting(false);
 if(gesture||!sniffStarted)sniffStarted=now;
 sniff=SCENT_TRAIL_SECONDS;
 scentUntil=now+SCENT_TRAIL_MS;
 void drawScentTrail();
 discoverEnvironment();
 updateUi();
 if(gesture){sound.unlock();sound.play('sniff');}
}
function startingPitch(){
 return Math.max(MIN_GAMEPLAY_PITCH,safeCameraPitch(pos,map.getBearing(),obstacles,GAMEPLAY_PITCH));
}
function mapFocus(){
 const canvas=map.getCanvas();
 const compact=canvas.clientWidth<=700;
 const landscape=canvas.clientHeight<=540&&canvas.clientWidth>canvas.clientHeight;
 const minimumMarkerHeight=canvas.clientHeight<=590?211:224;
 return {
  x:canvas.clientWidth*(landscape?.67:compact?.5:.62),
  y:compact&&!landscape?Math.max(minimumMarkerHeight,canvas.clientHeight*.30):canvas.clientHeight*.47,
 };
}
function pointAtFocus():[number,number]{
 const {x,y}=mapFocus();
 const point=map.unproject([x,y]);
 return [point.lng,point.lat];
}
function placeStart(point:[number,number]){
 if(travelling||mode!=='intro')return;
 selectedPoint=[((point[0]+180)%360+360)%360-180,Math.max(-84,Math.min(84,point[1]))];
 selectionVersion++;
 $('start-status').textContent='';
 startMarker.setLocation(selectedPoint);
}
function showStartMap(point:[number,number],zoom=harbourZoom,animate=true){
 const {x,y}=mapFocus(),canvas=map.getCanvas();
 const offset:[number,number]=[x-canvas.clientWidth/2,y-canvas.clientHeight/2];
 const view={center:point,zoom,pitch:0,bearing:0,offset};
 following=true;
 menuMapMoved=false;
 if(animate&&!reduced)map.flyTo({...view,duration:1100});
 else map.easeTo({...view,duration:0});
}
function changeStartingPoint(){
 if(!ready||travelling)return;
 selectedPoint=toLngLat(pos) as [number,number];
 selectionVersion++;
 round.stop();
 sound.setMusic(false);
 gameWorld.clear();
 hud.clearFlights();
 walkPath=[];
 countdown=0;
 $('countdown').hidden=true;
 $('order-celebration').hidden=true;
 $('start-status').textContent='';
 setMode('intro');
 world.update({overview:true});
 showStartMap(selectedPoint);
}
function toggleStartControls(disabled:boolean){
 for(const id of ['start','free-play','locate-me']){
  $<HTMLButtonElement>(id).disabled=disabled;
 }
}
function locatePlayer(userRequested:boolean){
 if(!ready||!navigator.geolocation||travelling||mode!=='intro')return;
 const revision=selectionVersion;
 const ownRequest=()=>revision===selectionVersion&&mode==='intro'&&!travelling;
 if(userRequested)$('start-status').textContent='Finding your location…';
 navigator.geolocation.getCurrentPosition(({coords})=>{
  if(!ownRequest())return;
  placeStart([coords.longitude,coords.latitude]);
  showStartMap(selectedPoint,13.4);
 },()=>{
  if(userRequested&&ownRequest())$('start-status').textContent='Location unavailable. You can still choose a spot on the map.';
 },{timeout:8000,maximumAge:120000});
}
async function beginAtPin(action:()=>void,needsFood=false){
 if(!ready||travelling||mode!=='intro')return;
 sound.unlock();
 travelling=true;
 regionVersion++;
 const point:[number,number]=[...selectedPoint];
 const oldOrigin=[...ORIGIN];
 toggleStartControls(true);
 startMarker.setLoading(true);
 map.dragPan.disable();
 $('start-status').textContent='Finding a playable street…';
 setOrigin(point);
 let foundStreet=false;
 try{
  const data=await loadNeighbourhood(point);
  installRegion(data,true);
  foundStreet=true;
  found.clear();
  exploreCollected.clear();
  buildFilmRoute();
  placeLabel=distance(toLocal(harbour),pos)<2500?'New York':data.placeName;
  if(needsFood&&!selectTasting(new Set(),2).length){
   throw Error('No food stops nearby. Move the pin closer to a town or try Free roam.');
  }
  $('start-status').textContent='';
  resetCamera();
 }catch(error){
  if(!foundStreet)setOrigin(oldOrigin);
  $('start-status').textContent=error instanceof Error?error.message:'This place could not load.';
  return;
 }finally{
  travelling=false;
  toggleStartControls(false);
  startMarker.setLoading(false);
  map.dragPan.enable();
  lastFrame=performance.now();
 }
 action();
}
async function streamAroundDog(now:number){if(streaming||travelling||now<nextStreamAttempt||distance(pos,streamCenter)<230)return;streaming=true;const version=regionVersion,coordinate=toLngLat(pos);try{const data=await loadNeighbourhood(coordinate);if(version===regionVersion)installRegion(data);}catch{nextStreamAttempt=performance.now()+5000;toast('Loading the next streets…');}finally{streaming=false;}}
function followDog(dt:number){
 const bearing=navigation.state.bearing;
 const ahead=[pos[0]+Math.sin(desiredHeading)*22,pos[1]+Math.cos(desiredHeading)*22];
 const safe=Math.min(safeCameraPitch(pos,bearing,obstacles,GAMEPLAY_PITCH),moving?safeCameraPitch(ahead,bearing,obstacles,GAMEPLAY_PITCH):GAMEPLAY_PITCH);
 const next=navigation.step(dt,pos,desiredHeading,moving,Math.max(MIN_GAMEPLAY_PITCH,safe),mode==='film');
 const current=map.getCenter();
 // MapLibre emits move events even for an identical jumpTo. Skip subpixel camera changes.
 if(distance(next.center,toLocal([current.lng,current.lat]))<.04&&Math.abs(angleDelta(next.bearing,map.getBearing()))<.02&&Math.abs(next.pitch-map.getPitch())<.02)return;
 map.jumpTo({center:toLngLat(next.center) as [number,number],bearing:next.bearing,pitch:next.pitch});
}
function walkTo(point:number[],screen:number[]){
 if(!canPlay()||draggingMap||joystick.active||[...keys].some(key=>directions.has(key)))return;
 cancelWalk();
 const collected=mode==='play'?round.state.collected:exploreCollected;
 let closestFood:number[]|undefined;
 let bestPixels=20;
 for(const item of streetItems){
  if(collected.has(item.id)||distance(item.point,pos)>150||!world.isRevealed(item.point))continue;
  const projected=world.project([item.point[0],1.7,item.point[1]]);
  const gap=Math.min(distance(projected,screen),distance(item.point,point)*2.5);
  if(gap>=bestPixels||!walkSurface.canStand(item.point))continue;
  bestPixels=gap;
  closestFood=item.point;
 }
 const goal=closestFood??(walkSurface.canStand(point)?point:nearest(graph,point)?.p);
 if(!goal||(!closestFood&&distance(goal,point)>35)||distance(pos,goal)>450)return;
 setSitting(false);
 motion.reset();
 if(walkSurface.canTravel(pos,goal,0))walkPath=[goal];
 else void planWalk(goal);
 following=true;
 resetCamera();
 cameraReady=0;
}

async function planWalk(goal:number[],blocked?:number[]){
 const ticket=++walkIntent,surface=walkSurface;
 const current=()=>ticket===walkIntent&&surface===walkSurface&&canPlay()&&!draggingMap;
 const path=await findScentPathAsync(pos,goal,(point:number[])=>surface.canStand(point,0),{step:1.25,sampleStep:.20},current);
 if(current()&&path.length&&(!blocked||(path[1]&&distance(path[1],blocked)>.03)))walkPath=path;
}
function startFilm(){if(!ready)return;round.stop();gameWorld.clear();exploreCollected.clear();found.clear();world.resetDiscovery();setMode('film');pos=[...startNode.p];currentNode=startNode;heading=desiredHeading=sampleRoute(filmRoute,0).heading;walkPath=[];filmStart=performance.now();map.jumpTo({center:toLngLat(pos) as [number,number],zoom:18.65,pitch:35,bearing:180-heading*180/Math.PI});resetCamera();}
function tick(now:number){
 // A long frame drops simulation time equally for the player, traffic and clock.
 const dt=Math.max(0,Math.min(.1,(now-lastFrame)/1000));lastFrame=now;const t=now/1000;moving=running=sprinting=manualWalking=false;
 if(travelling||mode==='intro'||journal?.active){frameId=requestAnimationFrame(tick);return;}
 const playable=(mode==='play'||mode==='explore')&&!paused&&!document.hidden&&!$<HTMLDialogElement>('about-dialog').open;
 const heldSniff=sniffHeldAt(now);
 if(playable){const wasAirborne=jumpHeight(jump)>0;jump=Math.max(0,jump-dt);jumpCooldown=Math.max(0,jumpCooldown-dt);walkSurface.setHeight(jumpHeight(jump));if(wasAirborne&&jumpHeight(jump)===0)pos=walkSurface.settle(pos);sniff=Math.max(0,(scentUntil-now)/1000);
 if(!heldSniff&&now-sniffStarted>=SNIFF_GESTURE_MS)sniffStarted=0;
 if(sniffQueued&&jump===0)sniffAir();
 else if(sniff===0&&heldSniff)sniffAir(false);
 if(sniff>0&&scentSurface!==walkSurface&&canPlay())void drawScentTrail();
 if(countdown>0){
   if(now>=arrivalUntil&&!waitingForFirstEncounters){
    countdown=Math.max(0,countdown-dt);
    $('countdown-number').textContent=String(Math.ceil(countdown));
    $('countdown').hidden=countdown===0;
    if(countdown===0){
     $('arrival-card').hidden=true;
     document.body.classList.remove('arriving');
     map.dragPan.enable();
    }
   }
  }
 else{
 const stick=joystick.input;
 const dx=round.state.stun>0?0:stick[0]+Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'));
 const dz=round.state.stun>0?0:stick[1]+Number(keys.has('KeyS')||keys.has('ArrowDown'))-Number(keys.has('KeyW')||keys.has('ArrowUp'));
 manualWalking=!!(dx||dz);
 if(manualWalking)setSitting(false);
 running=!sitting&&round.state.stun===0;
 sprinting=running&&(keys.has('ShiftLeft')||keys.has('ShiftRight')||sprintPointer!==null);
 const slowed=mode==='play'&&round.state.elapsed<slowUntil;
 const speed=(sprinting?27:20)*(sniffGestureActive(now,heldSniff)?.75:1)*(slowed?.6:1);
 if(manualWalking){cancelWalk();const result=motion.step(dt,[dx,dz],map.getBearing(),pos,walkSurface,speed),next=result.position;if(result.moving){desiredHeading=Math.atan2(next[0]-pos[0],next[1]-pos[1]);pos=next;moving=true;}}
 else{
  motion.reset();
  let left=sitting||round.state.stun>0?0:dt*speed;
  while(walkPath.length&&left>.002){
   const point=walkPath[0];
   const span=distance(pos,point);
   if(span<.025){walkPath.shift();continue;}
   const advance=Math.min(span,left);
   const next=pos.map((axis,i)=>axis+(point[i]-axis)*(advance/span));
   if(!walkSurface.canTravel(pos,next)){
    const destination=walkPath.at(-1)!;
    cancelWalk();
    void planWalk(destination,point);
    break;
   }
   desiredHeading=Math.atan2(next[0]-pos[0],next[1]-pos[1]);
   pos=next;
   moving=true;
   left-=advance;
   if(advance===span)walkPath.shift();
  }
 }
 if(mode==='play'){
  const time=round.state.elapsed,height=jumpHeight(jump);
  const contact=hazardContact(hazards,pos,time,height,'damage');
  const slow=hazardContact(hazards,pos,time,height,'slow');
  if(slow){
   const wet=slow.hazard.kind==='sprinkler';
   if(time>=slowUntil){
    toast(wet?'SPLASH!':'YIELD!','slow');
    if(wet)world.splash();
   }
   slowUntil=Math.max(slowUntil,time+(wet?1.25:.65));
  }
  const events=round.tick(dt,{hazard:!!contact,sitting,moving,clockRunning:nextTastingAt===0});
  if(contact?.hazard.route&&events.some(event=>event.type==='hurt')){
   const {p,heading}=contact.sample;
   const side=[Math.cos(heading),-Math.sin(heading)];
   const direction=Math.sign((pos[0]-p[0])*side[0]+(pos[1]-p[1])*side[1])||1;
   pos=walkSurface.move(pos,side.map(axis=>axis*direction),3);
   walkSurface.setHeight(0);
   pos=walkSurface.settle(pos);
  }
  handleEvents(events);
  if(round.state.status==='playing'){
  if(nextTastingAt&&round.state.elapsed>=nextTastingAt){nextTastingAt=0;$('order-celebration').hidden=true;const slots=selectTasting();if(slots.length){round.setTasting(slots);showTasting();}else endRound('complete');}
  if(!nextTastingAt&&round.state.stun===0&&jumpHeight(jump)<2)for(const item of streetItems){if(distance(pos,item.point)>=PICKUP_RADIUS)continue;handleEvents(round.pickup(item));}

 }}
 if(mode==='explore'&&jumpHeight(jump)<2)for(const item of streetItems)if(!exploreCollected.has(item.id)&&distance(pos,item.point)<PICKUP_RADIUS){exploreCollected.add(item.id);justTasted={id:item.id,until:now+2800};world.react(item.kind);sound.play('pickup');}
 }
 // A natural finish can open the journal in this frame. Its flight owns the camera now.
 if(journal?.active){frameId=requestAnimationFrame(tick);return;}
 if((mode==='play'||mode==='explore')&&countdown===0)recordRoute();
 if(moving&&!following&&!draggingMap){following=true;resetCamera();}if(following&&!draggingMap&&now>cameraReady){if(now-dt*1000<=cameraReady)resetCamera();followDog(dt);}void streamAroundDog(now);
 if(mode==='play'&&countdown===0)void refreshEncounters(now);
 }else if(mode==='film'&&!document.hidden){const elapsed=(now-filmStart)/1000,u=Math.max(0,Math.min(1,(elapsed-3)/21)),sample=sampleRoute(filmRoute,u*filmRoute.length);pos=sample.p;desiredHeading=sample.heading;moving=elapsed>3&&elapsed<24;const finish=Math.max(0,Math.min(1,(elapsed-24)/6)),a=finish*finish*(3-2*finish),p=toLngLat(navigation.state.center);if(elapsed<24)followDog(dt);else map.jumpTo({center:[p[0]+(ORIGIN[0]-p[0])*a,p[1]+(ORIGIN[1]-p[1])*a],zoom:18.65-a*1.7,pitch:navigation.state.pitch+(38-navigation.state.pitch)*a});$('film-progress').style.width=`${Math.min(100,elapsed/30*100)}%`;if(elapsed>=30)startExplore();}
 if(now-lastUi>100){activeVenue=focusedVenue(now);nearbyVenues=venuesInRange();}
 if(sniff<=0)setAmbient();
 else if(now-lastUi>100)discoverEnvironment();
 const angle=((desiredHeading-heading+Math.PI*3)%(Math.PI*2))-Math.PI;
 heading+=angle*(1-Math.exp(-dt*12));
 if((mode==='play'||mode==='explore')&&countdown===0&&!document.hidden)minimap.draw(now,pos,heading,walkedRoute);
 const entering=mode==='play'&&now<arrivalUntil;
 const zoom=map.getZoom();
 const fogStrength=entering?Math.max(0,Math.min(1,(zoom-17.3)/1.35)):1;
 const sniffing=sniffGestureActive(now,heldSniff);
 scentTrail.update(Math.max(0,(trailUntil-now)/1000),t,reduced);
 world.update({x:pos[0],z:pos[1],overview:!!journal?.active||entering&&zoom<16.8,fogStrength,trailPoints:scentTrail.visiblePoints(),heading,moving,running,sprinting,sitting,sniff:sniffing?1:0,sniffAge:sniffing?Math.max(0,(now-sniffStarted)/1000):0,sniffHeld:sniffing&&heldSniff,jump:jumpHeight(jump),jumpTime:jump,stun:mode==='play'?round.state.stun:0,healing:mode==='play'&&sitting&&round.state.health<3,time:t,reduced,range:mode==='film'?80:67,exploring:true});if(gameWorld.update(mode==='play'?round.state.elapsed:t,mode,pos,reduced,
  mode==='play'?round.state.collected:exploreCollected,new Set(round.state.slots.filter(slot=>!slot.done).map(slot=>slot.kind)),
  item=>mode==='film'||distance(item.point,pos)<25||world.isRevealed(item.point,.16),
  {venueVisible:item=>activeVenue?.id===item.id},
 )&&!paused&&countdown===0)sound.play('chant');
 updateVenueLabels();
 hud.showRest(world.project([pos[0],7,pos[1]]),mode==='play'&&sitting&&!paused&&round.state.health<3,round.state.rest/REST_SECONDS,Math.ceil(REST_SECONDS-round.state.rest),round.state.health===3);hud.update(t,round.state.health);
 const musicActive=(mode==='play'||mode==='explore')&&!paused&&!document.hidden&&countdown===0;
 sound.setUrgency(musicActive&&mode==='play'&&!nextTastingAt
  ?Math.max(0,1-round.state.remaining/URGENT_CLOCK_SECONDS):0);
 sound.setMusic(musicActive);
 $('jump').classList.toggle('cooldown',jumpCooldown>0);
 document.body.classList.toggle('super-sniff',sniffing);
 document.querySelector('.timer')!.classList.toggle('refilled',now<clockRefillUntil);$('damage-flash').classList.toggle('hit',now<damageUntil);if(now>toastUntil)$('game-toast').classList.remove('show');if(now-lastUi>100){updateUi();lastUi=now;}frameId=requestAnimationFrame(tick);
}
async function init(){
 try{
  const loaded=await controller.ready;
  if(!loaded)throw Error('Map unavailable');
  map=loaded;
  const attribution=map.getContainer().querySelector<HTMLDetailsElement>('details.maplibregl-ctrl-attrib');
  if(attribution){
   const collapseAttribution=()=>{
    attribution.open=false;
    attribution.classList.add('maplibregl-compact');
    attribution.classList.remove('maplibregl-compact-show');
   };
   collapseAttribution();
   map.on('dragstart',collapseAttribution);
  }
  stylePaving(map);
  styleCartography(map);
  world=createWorld(map,[],[],onDiscovery);
  foodPois=createFoodPois(map);
  world.setCritter(selectedCritter);
  world.update({overview:true});
  gameWorld=createGameWorld(world.scene);
  scentTrail=createScentTrail(world.scene);
  hud=createHud(reduced);
  journal=createAromaJournal(map);
  $('journal-replay').onclick=()=>void replayRound();
  $('journal-explore').onclick=startExplore;
  startMarker=createStartMarker(map,placeStart);
  startMarker.setCritter(selectedCritter);
  startMarker.setLocation(selectedPoint);
  showStartMap(selectedPoint,harbourZoom,false);
  map.on('click',event=>{
   const point:[number,number]=[event.lngLat.lng,event.lngLat.lat];
   if(mode==='intro'){placeStart(point);return;}
   walkTo(toLocal(point),[event.point.x,event.point.y]);
  });
  map.on('dragstart',()=>{
   if(performance.now()<arrivalUntil||travelling)return;
   if(mode==='intro'){if(!menuMapMoved){menuMapMoved=true;selectionVersion++;}return;}
   draggingMap=true;
   following=false;
   cancelWalk();
   motion.reset();
  });
  map.on('dragend',()=>{draggingMap=false;});
  map.on('movestart',event=>{
   if(mode==='intro'&&!menuMapMoved&&event.originalEvent){menuMapMoved=true;selectionVersion++;}
  });
  map.on('resize',()=>{
   if(mode==='intro'&&!travelling)showStartMap(selectedPoint,map.getZoom(),false);
  });
  map.on('moveend',()=>{
   if(mode!=='intro'||travelling||!menuMapMoved)return;
   menuMapMoved=false;
   placeStart(pointAtFocus());
  });
  resetCamera();
  ready=true;
  toggleStartControls(false);
  $('start').querySelector('span')!.textContent='Play here';
  lastFrame=performance.now();
  frameId=requestAnimationFrame(tick);
  if(new URLSearchParams(location.search).get('film')==='1')void beginAtPin(startFilm);
  else if(navigator.permissions){
   const revision=selectionVersion;
   void navigator.permissions.query({name:'geolocation'}).then(permission=>{
    if(permission.state==='granted'&&revision===selectionVersion)locatePlayer(false);
   }).catch(()=>{});
  }
 }catch(error){
  console.error(error);
  $('load-error').hidden=false;
 }
}
document.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach(button=>{
 button.onclick=()=>{
  if(travelling)return;
  selectedDifficulty=button.dataset.difficulty as Difficulty;
  document.querySelectorAll('[data-difficulty]').forEach(option=>option.setAttribute('aria-pressed',String(option===button)));
 };
});
document.querySelectorAll<HTMLButtonElement>('[data-critter]').forEach(button=>{
 button.onclick=()=>{
  selectedCritter=button.dataset.critter as CritterKind;
  world?.setCritter(selectedCritter);
  startMarker?.setCritter(selectedCritter);
  document.querySelectorAll('[data-critter]').forEach(option=>option.setAttribute('aria-pressed',String(option===button)));
 };
});
$('start').onclick=()=>void beginAtPin(startRound,true);
$('start-here').onclick=startRound;
$('free-play').onclick=()=>void beginAtPin(startExplore);
$('stop-film').onclick=startExplore;$('sit').onclick=()=>{if(!paused&&countdown===0&&round.state.stun===0)setSitting(!sitting);};$('camera').onclick=()=>{following=true;resetCamera();cameraReady=0;};$('pause').onclick=()=>togglePause();$('pause-inline').onclick=()=>togglePause();$('resume').onclick=()=>togglePause(false);$('quit').onclick=()=>endRound('quit');$('scent-guide').onclick=()=>sniffAir(true);
$('next-bite').onclick=()=>sniffAir(true);
$('sound').onclick=()=>{sound.unlock();const enabled=sound.toggle();$('sound').textContent=enabled?'♫':'♪';$('sound').setAttribute('aria-label',enabled?'Mute sound':'Enable sound');$('sound').style.opacity=enabled?'1':'.5';};$('locate-me').onclick=()=>locatePlayer(true);
$('pick-location').onclick=changeStartingPoint;
$('pick-paused').onclick=changeStartingPoint;
$('about').onclick=()=>{if(mode==='play')togglePause(true);clearInput();$<HTMLDialogElement>('about-dialog').showModal();};$('close-about').onclick=()=>$<HTMLDialogElement>('about-dialog').close();$('retry').onclick=()=>location.reload();
bindJumpButton($<HTMLButtonElement>('jump'),jumpDog);
for(const target of [cameraHome,minimapPanel,$('scent-guide'),$('next-bite')]){
 target.addEventListener('pointerdown',event=>{if(event.button===0)event.preventDefault();});
}
const sniffBindings=new Set(['KeyE','Enter','NumpadEnter','Numpad0']);
const directions = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight']);
document.addEventListener('keydown',event=>{
 if(event.code==='Escape'&&mode==='play'&&!$<HTMLDialogElement>('about-dialog').open){if(!event.repeat)togglePause();return;}
 const key=event.code;
 const movementKey=directions.has(key);
 const sniffInput=sniffBindings.has(key);
 if(!(sniffInput?canQueueSniff():canPlay())||(event.target instanceof HTMLElement&&event.target.closest('input,textarea,select,[contenteditable=true]')))return;
 if(!movementKey&&!sniffInput&&!['Space','ControlLeft','ControlRight','ShiftLeft','ShiftRight'].includes(key))return;
 if(event.target instanceof Element){
  if((key==='Enter'||key==='NumpadEnter')&&event.target.closest('button:not(#sniff),a'))return;
  if(key==='Space'&&event.target.closest('button:not(#jump)'))return;
 }
 if(event.metaKey||event.altKey)return;
 event.preventDefault();
 if(key==='Space'&&!event.repeat)jumpDog();
 else if(sniffInput){sniffKeys.set(key,performance.now());if(!event.repeat)sniffAir();}
 else if(key.startsWith('Control')&&!event.repeat)setSitting(!sitting);
 else if(key.startsWith('Shift'))keys.add(key);
 else if(movementKey){cancelWalk();setSitting(false);keys.add(key);}
});
window.addEventListener('keyup',event=>{
 keys.delete(event.code);
 sniffKeys.delete(event.code);
},{capture:true});
function holdButton(id:string,start:(pointer:number)=>void,end:(pointer:number)=>void){
 const button=$<HTMLButtonElement>(id);
 button.addEventListener('pointerdown',event=>{
  if(event.button!==0||!(id==='sniff'?canQueueSniff():canPlay()))return;
  event.preventDefault();
  button.setPointerCapture(event.pointerId);
  start(event.pointerId);
 });
 for(const type of ['pointerup','pointercancel','lostpointercapture'] as const){
  button.addEventListener(type,event=>end(event.pointerId));
 }
}
holdButton('sniff',pointer=>{
 sniffPointer=pointer;
 sniffAir();
},pointer=>{if(sniffPointer===pointer)sniffPointer=null;});
for(const type of ['pointerup','pointercancel'] as const){
 window.addEventListener(type,event=>{if(sniffPointer===event.pointerId)sniffPointer=null;},{capture:true});
}
window.addEventListener('pointermove',event=>{
 if(sniffPointer===event.pointerId&&event.pointerType!=='touch'&&!(event.buttons&1))sniffPointer=null;
},{capture:true,passive:true});
holdButton('sprint',pointer=>{sprintPointer=pointer;},pointer=>{if(sprintPointer===pointer)sprintPointer=null;});
$('sniff').addEventListener('click',event=>{if(event.detail===0)sniffAir(true);});
window.addEventListener('blur',clearInput);
let hiddenAt=0;document.addEventListener('visibilitychange',()=>{clearInput();if(document.hidden){hiddenAt=performance.now();if(mode==='play')togglePause(true);}else if(hiddenAt){if(mode==='film')filmStart+=performance.now()-hiddenAt;hiddenAt=0;}lastFrame=performance.now();});window.addEventListener('pagehide',event=>{if(event.persisted)return;cancelAnimationFrame(frameId);sound.dispose();startMarker?.dispose();hud?.dispose();journal?.dispose();scentTrail?.dispose();gameWorld?.dispose();controller.destroy();});void init();
