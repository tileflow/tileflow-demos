import {camera,closestName,composeSheet,registration} from './type-layout.js';
import {mountLines} from './composed-lines.js';

export function mountMovingType(map,preference) {
  const container=map.getContainer(), lines=mountLines(map.getCanvasContainer());
  const style=map.getStyle();
  map.setLayoutProperty('tileflow-poi-render-countries','text-field',['coalesce',['get','name_es'],['get','name']]);
  let rivers=[],banks=[],editionReady=false,editionPending=false,removed=false,retryAfter=0;
  map.setLayoutProperty('tileflow-poi-render-trees','visibility','none');
  const streetLabels=style.layers.filter(l=>['tileflow-poi-render-streetNames','tileflow-poi-render-signatureStreet'].includes(l.id));
  let sheet,signature='',lastFilter='',timer=0,frame=0,revision=0;
  let visible=true,enabled=!preference.matches,point=null,lastLayout=0;
  const loadedTiles=new WeakSet();

  function requestEdition(){
    if(editionReady || editionPending || performance.now()<retryAfter || map.getZoom()<8.7)return;
    if(!map.getBounds().intersects([[-74.06,40.67],[-73.89,40.93]]))return;
    editionPending=true;
    import('./new-york-rivers.js').then(edition=>{
      if(removed)return;
      rivers=edition.rivers;banks=edition.banks;editionReady=true;revision++;schedule();
    }).catch(()=>{retryAfter=performance.now()+5000;}).finally(()=>{editionPending=false;});
  }
  function syncLabels(tracks){
    const names=[...new Set(tracks.filter(l=>!l.water).map(l=>l.name))].sort();
    const key=JSON.stringify(names);
    if(key===lastFilter)return;
    lastFilter=key;
    const omit=['!', ['in',['get','name'],['literal',names]]];
    for(const layer of streetLabels)map.setFilter(layer.id,names.length?['all',layer.filter??true,omit]:layer.filter??null);
  }
  function describeView(view){
    const center=map.getCenter();
    const coordinates=[`${Math.abs(center.lat).toFixed(2)}° ${center.lat<0?'S':'N'}`,`${Math.abs(center.lng).toFixed(2)}° ${center.lng<0?'O':'E'}`];
    const near=closestName(sheet,view,view.w/2,view.h/2);
    const place=near?.name??(view.z<2?'Vista del mundo':'Centro del mapa');
    map.getCanvas().setAttribute('aria-label',`${place}. ${coordinates.join(', ')}. Zoom ${Math.round(view.z)}. Pulsa P para pausar o reanudar.`);
  }
  function layout(inGesture=false){
    timer=0;
    if(!visible || document.hidden || (map.isMoving() && !inGesture))return;
    requestEdition();
    const v=camera(map),key=[...Object.values(v),revision].join('/');
    if(key!==signature){
      signature=key;lastLayout=performance.now();
      sheet=composeSheet(map,rivers,banks);
      lines.set(sheet);
      lines.register([0,0,1]);
    }
    if(!inGesture && sheet){syncLabels(sheet.tracks);describeView(v);}
    lines.hold(map.isMoving());
  }
  function schedule(){if(!timer)timer=setTimeout(layout,45);}
  function clearFocus(){point=null;lines.focus(null);}
  function pointer(e){
    if(e.buttons || e.pointerType==='touch' || !sheet || map.isMoving())return;
    const box=container.getBoundingClientRect();point={x:e.clientX-box.left,y:e.clientY-box.top};
    if(!frame)frame=requestAnimationFrame(()=>{
      frame=0;
      if(point && !map.isMoving())lines.focus(closestName(sheet,sheet.view,point.x,point.y)?.name??null);
    });
  }
  function begin(){clearFocus();lines.hold(true);}
  function move(){
    if(!sheet)return;
    const v=camera(map),r=registration(sheet.view,v);
    lines.register(r);
    // Keep geographic ink in view during a long continuous pan or pinch. Small
    // movements only transform the existing sheet and retain the frozen street print.
    if(timer || performance.now()-lastLayout<220)return;
    const travelX=Math.abs((sheet.view.x-v.x)*512*2**v.z),travelY=Math.abs((sheet.view.y-v.y)*512*2**v.z);
    if(r[2]>3 || r[2]<.68 || travelX>v.w*.56 || travelY>v.h*.56)
      timer=setTimeout(()=>layout(true),65);
  }
  function preferenceChanged(){enabled=!preference.matches;lines.motion(enabled);}
  function key(e){if(!e.repeat && e.key.toLowerCase()==='p'){enabled=!enabled;lines.motion(enabled);}}
  function visibility(){if(!visible||document.hidden){clearFocus();lines.hold(true);}else schedule();}
  const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;visibility();});
  observer.observe(container);
  map.on('sourcedata',e=>{
    if(e.sourceId!=='tileflow' || !e.tile || e.tile.state!=='loaded' || loadedTiles.has(e.tile))return;
    loadedTiles.add(e.tile);revision++;
    if(!map.isMoving() && map.areTilesLoaded())schedule();
  });
  map.on('idle',schedule);map.on('resize',schedule);
  map.on('movestart',begin);map.on('move',move);map.on('moveend',schedule);
  preference.addEventListener('change',preferenceChanged);
  document.addEventListener('visibilitychange',visibility);
  container.addEventListener('pointermove',pointer,{passive:true});
  container.addEventListener('pointerleave',clearFocus);container.addEventListener('keydown',key);
  map.once('remove',()=>{removed=true;clearTimeout(timer);cancelAnimationFrame(frame);observer.disconnect();lines.destroy();
    document.removeEventListener('visibilitychange',visibility);preference.removeEventListener('change',preferenceChanged);
    container.removeEventListener('pointermove',pointer);container.removeEventListener('pointerleave',clearFocus);container.removeEventListener('keydown',key);});
  lines.motion(enabled);schedule();
}
