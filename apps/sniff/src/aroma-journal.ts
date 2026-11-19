import {
  LngLat,LngLatBounds,Marker,Popup,type Map as MapLibreMap,type MapLayerMouseEvent,
} from 'maplibre-gl';
import type {Feature,FeatureCollection,LineString,Point} from 'geojson';
import {TASTES} from './game.mjs';
import './aroma-journal.css';

type Coordinate = [number, number];

export type JournalScent = {
  id: string | number;
  coordinate: Coordinate;
  name: string;
  aroma: string;
  category: string;
  color: string;
  tasted?: boolean;
};

type JournalResult = {
  score:number;
  bites:number;
  eaten?:readonly string[];
};

type JournalData = {
  route: readonly Coordinate[];
  scents: readonly JournalScent[];
  place?: string;
  result?: JournalResult;
};

const ids = {
  route:'journal-route',
  routeRim:'journal-route-rim',
  routeInk:'journal-route-ink',
  points:'journal-scent-points',
  start:'journal-start-point',
  finish:'journal-finish-point',
  scent:'journal-scent-point',
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag:K,className:string,words?:string,
) {
  const node=document.createElement(tag);
  node.className=className;
  if(words!==undefined)node.textContent=words;
  return node;
}

function metresWalked(route:readonly Coordinate[]) {
  let metres=0;
  for(let i=1;i<route.length;i++){
    metres+=LngLat.convert(route[i-1]).distanceTo(LngLat.convert(route[i]));
  }
  return metres>=1000?(metres/1000).toFixed(1)+' km':Math.round(metres)+' m';
}

function nearLongitude(longitude:number,reference:number) {
  return reference+((longitude-reference+180)%360+360)%360-180;
}

export function createAromaJournal(map:MapLibreMap,onClose?:()=>void){
  const panel=element('section','aroma-journal');
  panel.setAttribute('aria-labelledby','journal-title');
  panel.hidden=true;
  const heading=element('div','journal-heading');
  const title=element('h2','journal-title','Your scent map');
  title.id='journal-title';
  title.tabIndex=-1;
  const back=element('button','journal-back','← Results');
  back.type='button';
  heading.append(title,back);
  const foodList=element('ul','journal-food-list');
  foodList.setAttribute('aria-label','Tasted foods');
  const actions=element('div','journal-actions');
  for(const [name,label] of [['replay','Play again'],['explore','Explore map']]){
    const button=element('button','journal-action',label);
    button.id='journal-'+name;
    button.type='button';
    actions.append(button);
  }
  const replayMessage=element('p','journal-replay-message');
  replayMessage.setAttribute('role','status');
  replayMessage.hidden=true;
  const location=element('p','journal-location');
  const summary=element('p','journal-summary');
  const legend=element('div','journal-legend');
  const trailLegend=element('button','journal-key journal-key-trail','Route');
  trailLegend.type='button';
  trailLegend.setAttribute('aria-label','Show the full route');
  trailLegend.addEventListener('click',()=>{popup.remove();fitRoute(300);});
  const startLegend=element('span','journal-key journal-key-start','Start');
  const finishLegend=element('span','journal-key journal-key-finish','Finish');
  const aromaLegend=element('span','journal-key journal-key-aroma','Discovered');
  legend.append(trailLegend,startLegend,finishLegend,aromaLegend);
  const records=element('ol','journal-records');
  records.setAttribute('aria-label','Discovered aromas');
  const empty=element('p','journal-empty','Sniff to add aromas on your next run.');
  panel.append(heading,location,foodList,summary,legend,actions,replayMessage,records,empty);
  document.querySelector('#app')!.append(panel);

  const popup=new Popup({
    closeOnClick:false,focusAfterOpen:false,maxWidth:'235px',offset:11,className:'journal-popup',
  });
  const scentById=new Map<string,JournalScent>();
  const buttonById=new Map<string,HTMLButtonElement>();
  const markers:Marker[]=[];
  let camera: ReturnType<typeof currentCamera>|undefined;
  let previousKeyboard=false;
  let selected:string|undefined;
  let showingResult=false;
  let routeBounds:LngLatBounds|undefined;
  let fitFrame=0;
  let lastFitLayout='';
  let openingEndsAt=0,openingTimer=0;
  let revealOverview:(()=>void)|undefined;
  const viewport=window.visualViewport;
  const panelResize=new ResizeObserver(scheduleFit);
  function currentCamera(){
    return {
      center:map.getCenter(),
      zoom:map.getZoom(),
      pitch:map.getPitch(),
      bearing:map.getBearing(),
      padding:map.getPadding(),
    };
  }

  function clearSelection(){
    if(selected!==undefined)buttonById.get(selected)?.setAttribute('aria-pressed','false');
    selected=undefined;
  }
  popup.on('close',clearSelection);

  function selectScent(id:string,recenter=false){
    const scent=scentById.get(id);
    if(!scent)return;
    const body=element('div','journal-popup-body');
    body.append(
      element('strong','journal-popup-title',scent.name),
      element('span','journal-popup-notes',scent.category+' · '+scent.aroma),
    );
    if(scent.tasted)body.append(element('span','journal-tasted','Tasted'));
    popup.setLngLat(scent.coordinate).setDOMContent(body).addTo(map);
    selected=id;
    buttonById.get(id)?.setAttribute('aria-pressed','true');
    const padding=recenter?summaryPadding():undefined;
    if(padding)map.easeTo({center:scent.coordinate,padding,duration:cameraDuration(300)});
  }

  function clickScent(event:MapLayerMouseEvent){
    const id=event.features?.[0]?.properties?.journalId;
    if(typeof id==='string')selectScent(id);
  }
  function cursorPointer(){map.getCanvas().style.cursor='pointer';}
  function cursorDefault(){map.getCanvas().style.cursor='';}
  function onEscape(event:KeyboardEvent){
    if(event.key==='Escape'&&camera&&!showingResult){event.preventDefault();close();}
  }

  function summaryPadding(){
    const view=map.getContainer().getBoundingClientRect();
    const box=panel.getBoundingClientRect();
    const visibleLeft=Math.max(view.left,viewport?.offsetLeft??view.left);
    const visibleTop=Math.max(view.top,viewport?.offsetTop??view.top);
    const visibleRight=Math.min(view.right,viewport?viewport.offsetLeft+viewport.width:view.right);
    const visibleBottom=Math.min(view.bottom,viewport?viewport.offsetTop+viewport.height:view.bottom);
    const edge=Math.round(Math.max(showingResult?31:18,Math.min(44,Math.min(visibleRight-visibleLeft,visibleBottom-visibleTop)*.07)));
    const below=getComputedStyle(panel).getPropertyValue('--journal-placement').trim()==='bottom';
    const left=below?visibleLeft:Math.max(visibleLeft,box.right);
    const panelLimit=below?Math.min(visibleBottom,box.top):visibleBottom;
    const brand=document.querySelector('.topbar .brand')?.getBoundingClientRect();
    const brandOverMap=brand?.height&&brand.right>left&&brand.left<visibleRight;
    const middle=(visibleTop+visibleBottom)/2;
    const top=brandOverMap&&brand.top<middle?Math.max(visibleTop,brand.bottom):visibleTop;
    const bottom=brandOverMap&&brand.top>=middle?Math.min(panelLimit,brand.top):panelLimit;
    if(visibleRight-left<=2*edge||bottom-top<=2*edge)return;
    return {
      left:Math.ceil(left-view.left+edge),right:Math.ceil(view.right-visibleRight+edge),
      top:Math.ceil(top-view.top+edge),bottom:Math.ceil(view.bottom-bottom+edge),
    };
  }

  function layoutKey(padding:NonNullable<ReturnType<typeof summaryPadding>>){
    const container=map.getContainer();
    return [container.clientWidth,container.clientHeight,padding.left,padding.right,padding.top,padding.bottom].join(':');
  }

  function overviewZoom(){
    const cap=showingResult?Math.min(17.5,(camera?.zoom??map.getZoom())-.9):19.2;
    return Math.max(map.getMinZoom(),Math.min(map.getMaxZoom(),cap));
  }

  function fitRoute(duration:number,padding=summaryPadding()){
    if(!routeBounds||!padding)return;
    lastFitLayout=layoutKey(padding);
    const maxZoom=overviewZoom();
    const options={bearing:0,pitch:0,padding,duration:cameraDuration(duration)};
    if(routeBounds.getWest()===routeBounds.getEast()&&routeBounds.getSouth()===routeBounds.getNorth()){
      map.easeTo({...options,center:routeBounds.getCenter(),zoom:Math.min(18.35,maxZoom)});
    }else{
      map.fitBounds(routeBounds,{...options,absolutePadding:true,maxZoom,linear:true});
    }
  }

  function scheduleFit(){
    cancelAnimationFrame(fitFrame);
    fitFrame=requestAnimationFrame(()=>{
      if(!camera)return;
      const padding=summaryPadding();
      if(!padding||layoutKey(padding)===lastFitLayout)return;
      const scent=selected!==undefined?scentById.get(selected):undefined;
      if(scent){
        lastFitLayout=layoutKey(padding);
        map.jumpTo({center:scent.coordinate,padding});
      }else fitRoute(Math.max(0,openingEndsAt-performance.now()),padding);
    });
  }

  function mapResized(){
    // The visual viewport can resize before MapLibre updates its camera transform.
    lastFitLayout='';
    scheduleFit();
  }

  function replayStatus(loading:boolean,message=''){
    for(const button of actions.querySelectorAll('button'))button.disabled=loading;
    replayMessage.hidden=!loading&&!message;
    replayMessage.textContent=loading?'Loading the starting streets…':message;
    if(camera)scheduleFit();
  }

  function renderFood(result:JournalResult){
    const counts=new Map<string,number>();
    for(const kind of result.eaten??[])counts.set(kind,(counts.get(kind)??0)+1);
    foodList.replaceChildren();
    for(const [kind,count] of counts){
      const taste=TASTES[kind as keyof typeof TASTES];
      if(!taste)continue;
      const tile=element('li','journal-food-item');
      tile.style.setProperty('--bite-color',taste.color);
      const image=map.getImage('sniff-poi-'+kind)?.data;
      if(image){
        const icon=element('canvas','journal-food-icon');
        icon.width=image.width;
        icon.height=image.height;
        icon.setAttribute('aria-hidden','true');
        const context=icon.getContext('2d');
        if(context)context.putImageData(new ImageData(new Uint8ClampedArray(image.data),image.width,image.height),0,0);
        tile.append(icon);
      }else{
        const icon=element('span','journal-food-icon',taste.emoji);
        icon.setAttribute('aria-hidden','true');
        tile.append(icon);
      }
      tile.append(element('span','journal-food-name',taste.label));
      if(count>1)tile.append(element('strong','journal-food-count','×'+count));
      foodList.append(tile);
    }
    foodList.hidden=!foodList.childElementCount;
  }

  function addEndpoint(coordinate:Coordinate,label:string,finish=false){
    const tag=element('span','journal-endpoint',label);
    const marker=new Marker({element:tag,anchor:finish?'top':'bottom',offset:[0,finish?9:-9]});
    markers.push(marker.setLngLat(coordinate).addTo(map));
  }

  function addScentMarker(scent:JournalScent,id:string){
    const button=element('button','journal-map-scent');
    button.type='button';
    button.setAttribute('aria-label',scent.name+' · '+scent.aroma);
    button.setAttribute('aria-pressed','false');
    button.style.setProperty('--aroma-color',scent.color);
    button.classList.toggle('journal-map-scent-tasted',!!scent.tasted);
    button.addEventListener('click',event=>{
      event.stopPropagation();
      selectScent(id,event.detail===0);
    });
    buttonById.set(id,button);
    markers.push(new Marker({element:button}).setLngLat(scent.coordinate).addTo(map));
  }

  function cameraDuration(duration:number){
    return matchMedia('(prefers-reduced-motion: reduce)').matches?0:duration;
  }

  function finishOpening(){
    if(!camera)return;
    // Restore the full route if a gesture interrupted the camera transition.
    if(openingEndsAt)fitRoute(0);
    openingEndsAt=0;
    clearTimeout(openingTimer);
    revealOverview?.();
    revealOverview=undefined;
    panel.classList.remove('journal-arriving');
    title.focus({preventScroll:true});
  }

  function show(data:JournalData,onOverview?:()=>void){
    if(camera)return;
    map.stop();
    replayStatus(false);
    camera=currentCamera();
    previousKeyboard=map.keyboard.isEnabled();
    map.keyboard.enable();
    const result=data.result;
    const aromas=data.scents.length;
    showingResult=!!result;
    const duration=cameraDuration(showingResult?1250:500);
    revealOverview=onOverview;
    if(showingResult&&duration>0){
      openingEndsAt=performance.now()+duration;
      panel.classList.add('journal-arriving');
    }
    panel.classList.toggle('journal-results',showingResult);
    title.textContent=result
      ?result.bites===0?'No bites found':result.bites===1?'1 bite found':result.bites+' bites found'
      :'Your scent map';
    actions.hidden=!result;
    back.hidden=showingResult;
    foodList.hidden=!result;
    if(result)renderFood(result);
    panel.hidden=false;
    document.body.classList.add('viewing-journal');
    if(!openingEndsAt)title.focus({preventScroll:true});
    location.textContent=data.place??'';
    location.hidden=showingResult||!data.place;
    legend.hidden=showingResult;
    records.hidden=showingResult||!aromas;
    empty.hidden=showingResult||!!aromas;
    summary.textContent=metresWalked(data.route)+' walked · '+(result
      ?result.score.toLocaleString('en-US')+' pts'
      :aromas+(aromas===1?' aroma':' aromas'));
    aromaLegend.hidden=!aromas;
    records.replaceChildren();
    const anchor=data.route[0]??data.scents[0]?.coordinate??[camera.center.lng,camera.center.lat];
    const normalized=([lng,lat]:Coordinate):Coordinate=>[nearLongitude(lng,anchor[0]),lat];
    const route=data.route.map(normalized);
    const scents=data.scents.map(scent=>({...scent,coordinate:normalized(scent.coordinate)}));

    const end=route.at(-1);
    const hasFinish=!!end&&LngLat.convert(anchor).distanceTo(LngLat.convert(end))>4;
    trailLegend.hidden=route.length<2;
    finishLegend.hidden=!hasFinish;
    const dots:FeatureCollection<Point>={type:'FeatureCollection',features:[
      {type:'Feature',geometry:{type:'Point',coordinates:anchor},properties:{start:true}},
      ...(hasFinish?[{type:'Feature' as const,geometry:{type:'Point' as const,coordinates:end},properties:{finish:true}}]:[]),
      ...(showingResult?[]:scents.map((scent):Feature<Point>=>({
        type:'Feature',
        geometry:{type:'Point',coordinates:scent.coordinate},
        properties:{journalId:String(scent.id),color:scent.color,tasted:!!scent.tasted},
      }))),
    ]};
    const path:FeatureCollection<LineString>={
      type:'FeatureCollection',
      features:route.length>1?[{type:'Feature',geometry:{type:'LineString',coordinates:route},properties:{}}]:[],
    };
    map.addSource(ids.route,{type:'geojson',data:path});
    map.addSource(ids.points,{type:'geojson',data:dots});
    map.addLayer({
      id:ids.routeRim,type:'line',source:ids.route,
      layout:{'line-cap':'round','line-join':'round'},
      paint:{'line-color':'#fff9ec','line-opacity':.98,'line-width':9},
    });
    map.addLayer({
      id:ids.routeInk,type:'line',source:ids.route,
      layout:{'line-cap':'round','line-join':'round'},
      paint:{'line-color':'#7956bf','line-width':5},
    });
    map.addLayer({
      id:ids.start,type:'circle',source:ids.points,
      filter:['==',['get','start'],true],
      paint:{'circle-radius':5,'circle-color':'#fff9ec','circle-stroke-width':3,'circle-stroke-color':'#7956bf'},
    });
    map.addLayer({
      id:ids.finish,type:'circle',source:ids.points,
      filter:['==',['get','finish'],true],
      paint:{'circle-radius':6,'circle-color':'#7956bf','circle-stroke-width':2.5,'circle-stroke-color':'#fff9ec'},
    });
    map.addLayer({
      id:ids.scent,type:'circle',source:ids.points,
      filter:['has','journalId'],
      paint:{
        'circle-color':['to-color',['get','color'],'#8b68c3'],
        'circle-radius':['case',['==',['get','tasted'],true],8,6],
        'circle-stroke-color':'#fffaf0',
        'circle-stroke-width':2.5,
      },
    });
    map.on('click',ids.scent,clickScent);
    map.on('mouseenter',ids.scent,cursorPointer);
    map.on('mouseleave',ids.scent,cursorDefault);

    for(const scent of scents){
      const id=String(scent.id);
      scentById.set(id,scent);
      if(showingResult){
        addScentMarker(scent,id);
        continue;
      }
      const row=element('li','journal-record');
      const button=element('button','journal-record-button');
      button.type='button';
      button.setAttribute('aria-pressed','false');
      button.style.setProperty('--aroma-color',scent.color);
      const text=element('span','journal-record-copy');
      text.append(
        element('strong','journal-record-name',scent.name),
        element('small','journal-record-notes',scent.category+' · '+scent.aroma),
      );
      button.append(text);
      if(scent.tasted)button.append(element('span','journal-tasted','Tasted'));
      button.addEventListener('click',()=>selectScent(id,true));
      buttonById.set(id,button);
      row.append(button);
      records.append(row);
    }
    if(showingResult&&route.length){
      addEndpoint(anchor,hasFinish?'Start':route.length>1?'Start / Finish':'Start');
      if(hasFinish)addEndpoint(end,'Finish',true);
    }
    routeBounds=new LngLatBounds(anchor,anchor);
    for(const point of route)routeBounds.extend(point);
    // A scent can be discovered across town. In results the frame follows the actual walk.
    if(!showingResult||!route.length)for(const scent of scents)routeBounds.extend(scent.coordinate);
    map.on('resize',mapResized);
    viewport?.addEventListener('resize',scheduleFit);
    viewport?.addEventListener('scroll',scheduleFit);
    fitRoute(duration);
    panelResize.observe(panel);
    if(openingEndsAt)openingTimer=window.setTimeout(finishOpening,duration+40);
    else if(showingResult)finishOpening();
    if(!showingResult)document.addEventListener('keydown',onEscape);
  }

  function hide(){
    if(!camera)return;
    openingEndsAt=0;
    clearTimeout(openingTimer);
    revealOverview=undefined;
    panel.classList.remove('journal-arriving');
    map.stop();
    popup.remove();
    for(const marker of markers)marker.remove();
    markers.length=0;
    map.off('click',ids.scent,clickScent);
    map.off('mouseenter',ids.scent,cursorPointer);
    map.off('mouseleave',ids.scent,cursorDefault);
    cursorDefault();
    map.off('resize',mapResized);
    viewport?.removeEventListener('resize',scheduleFit);
    viewport?.removeEventListener('scroll',scheduleFit);
    panelResize.disconnect();
    cancelAnimationFrame(fitFrame);
    for(const id of [ids.scent,ids.finish,ids.start,ids.routeInk,ids.routeRim]){
      if(map.getLayer(id))map.removeLayer(id);
    }
    for(const id of [ids.points,ids.route]){
      if(map.getSource(id))map.removeSource(id);
    }
    if(!previousKeyboard)map.keyboard.disable();
    map.jumpTo(camera);
    camera=undefined;
    routeBounds=undefined;
    lastFitLayout='';
    scentById.clear();
    buttonById.clear();
    panel.hidden=true;
    showingResult=false;
    document.body.classList.remove('viewing-journal');
    document.removeEventListener('keydown',onEscape);
  }

  function close(){
    hide();
    onClose?.();
    document.getElementById('see-scent-map')?.focus({preventScroll:true});
  }
  back.addEventListener('click',close);

  return {
    get active(){return camera!==undefined;},
    show,
    hide,
    replayStatus,
    dispose(){hide();panel.remove();},
  };
}
