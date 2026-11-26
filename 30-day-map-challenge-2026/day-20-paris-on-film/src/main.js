import {createTileflowMap} from '@tileflow/dom';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import {atlasStyle,tileRequest} from './contexto.js';
import {FilmArchive,media,fold} from './archive.js';
import {FilmMaterial} from './material.js';
import {centerOf} from './grid.js';
import {bindTimeline} from './timeline.js';

const $=id=>document.getElementById(id);
const format=new Intl.NumberFormat('en-GB');
const home={center:[2.2935,48.8591],pitch:48,bearing:-23};
const openingZoom=()=>innerWidth<600?15.0:15.23;
const places=[
  ['Trocadéro',2.2873,48.8627],['Champ de Mars',2.2990,48.8552],['Passy',2.2818,48.8588],
  ['La Seine',2.3006,48.8633,'river'],['Gros-Caillou',2.3056,48.8580],['Invalides',2.3124,48.8560],
  ['Étoile',2.2945,48.8746],['Champs-Élysées',2.3090,48.8697],['Montmartre',2.3411,48.8865],['Pigalle',2.3381,48.8821],
  ['Palais-Royal',2.3374,48.8653],['Le Marais',2.3628,48.8588],['Île de la Cité',2.3474,48.8547],['Latin Quarter',2.3457,48.8498],
  ['Saint-Germain-des-Prés',2.3334,48.8540],['Montparnasse',2.3239,48.8417],['Belleville',2.3871,48.8731],['Bastille',2.3694,48.8532],['Port de l’Arsenal',2.3676,48.8475],
  ['Père-Lachaise',2.3941,48.8606],['Canal Saint-Martin',2.3650,48.8725],['Bercy',2.3859,48.8359],['Batignolles',2.3188,48.8849]
];
const labels=[];
let map,archive,material,selection,year=0,term='',work=null,key=null,shown=8;
let pauseTimeline = () => {};
const labelForWork=()=>work===null?term:archive.titles[work][0];
const motion=ms=>matchMedia('(prefers-reduced-motion: reduce)').matches?0:ms;
function placeNames(){
  const z=map.getZoom(),w=map.getCanvas().clientWidth,h=map.getCanvas().clientHeight,occupied=[];
  for(const {el,lon,lat} of labels){
    const p=map.project([lon,lat]);
    el.hidden=z<13.35 || z>16.75 || p.x<20 || p.x>w-20 || p.y<25 || p.y>h-20 ||
      (p.y<105 && p.x<260) || occupied.some(q=>Math.abs(q.x-p.x)<96&&Math.abs(q.y-p.y)<26);
    if(!el.hidden){el.style.transform='translate('+p.x+'px,'+p.y+'px) translate(-50%,-50%)';occupied.push(p);}
  }
  const p=map.project([2.3488,48.8549]),pin=$('paris-pin');
  pin.hidden=z>10.2 || p.x<0 || p.x>w || p.y<0 || p.y>h;
  if(!pin.hidden)pin.style.transform='translate('+p.x+'px,'+p.y+'px) translate(-50%,-100%)';
}
function syncUrl(){
  const url=new URL(location.href);
  for(const k of ['year','title','work'])url.searchParams.delete(k);
  if(year)url.searchParams.set('year',String(year));
  if(work!==null)url.searchParams.set('work',String(work));
  else if(term)url.searchParams.set('title',term);
  history.replaceState(null,'',url);
}
function nearestName(cell){
  const [lon,lat]=centerOf(cell.q,cell.r);
  const sorted=places.filter(p=>p[3]!=='river').map(([name,x,y])=>({name,d:Math.hypot((lon-x)*73200,(lat-y)*111100)})).sort((a,b)=>a.d-b.d);
  if(sorted[0].d<900)return 'Near '+sorted[0].name;
  const raw=archive.addresses[cell.records[0].address];
  return raw.replace(/,?\s*75\d{3}.*$/i,'').trim()||'Filming locations';
}
function choose(id){
  key=id && selection.cells.has(id)?id:null;shown=8;
  const c=selection.cells.get(key);material.selected=c?[c.q,c.r]:[999,999];map.triggerRepaint();drawDetail();
}
function explore({phrase='',id=null},fit=true){
  term=phrase;work=id;key=null;
  selection=archive.select(year,term,work);material.setData(selection);choose(null);syncUrl();
  const name=labelForWork();
  $('active-title').hidden=!name;
  $('active-label').textContent=name+(name && !selection.total?' · no shoots this year':'');
  $('active-title').setAttribute('aria-label','Clear title filter '+name);
  if(fit && name && selection.bounds){
    const [[w,s],[e,n]]=selection.bounds;
    if(w===e && n===s){map.easeTo({center:[w,s],zoom:16.1,pitch:42,duration:motion(700)});return;}
    const pad=innerWidth<600?{left:38,right:38,top:110,bottom:80}:{left:110,right:85,top:100,bottom:80};
    map.fitBounds(selection.bounds,{padding:pad,pitch:25,bearing:0,maxZoom:16.2,duration:motion(750)});
  }
}
const montmartrePosters = {
  '8,-22': {record: 'JOHN WICK 4', title: 'John Wick 4', street: 'Rue Foyatier', poster: 'john-wick-4',
    credit: 'Metropolitan Filmexport', source: 'https://metrofilms.com/media/Exe_A4-JW4-Prochainement.3751d2d7-2541-4ee7-8a2f-cda047aec1e9.pdf'},
  '7,-22': {record: 'LA PAGE BLANCHE', title: 'La Page blanche', street: 'Rue Androuet', poster: 'la-page-blanche',
    credit: 'SND', source: 'https://www.academie-cinema.org/films/la-page-blanche/-44610/'},
  '7,-21': {record: 'Les Volets Verts', title: 'Les Volets verts', street: 'Place Charles Dullin', poster: 'les-volets-verts',
    credit: 'ARP / Artémis Productions', source: 'https://www.artemisproductions.com/fr/films/Les_Volets_Verts'},
};

function showFeaturedShoot(cell) {
  const film = montmartrePosters[key];
  const row = film && cell.records.find(r => r.year === 2021 && archive.titles[r.title][0] === film.record &&
    archive.addresses[r.address].split(',')[0] === film.street.toLowerCase());
  const card = $('featured-shoot');
  card.hidden = !row;
  if (!row) return;
  card.querySelector('img').src = import.meta.env.BASE_URL + 'stills/' + film.poster + '.webp';
  $('shoot-place').textContent = 'Montmartre · Filmed in ' + row.year;
  $('shoot-name').textContent = film.title;
  $('shoot-street').textContent = film.street;
  $('shoot-credit').textContent = 'Poster · ' + film.credit;
  $('shoot-credit').href = film.source;
}

function drawDetail(){
  const c=selection.cells.get(key);$('panel').hidden=!c;if(!c)return;
  const groups=new Map();
  for(const row of c.records){
    let g=groups.get(row.title);if(!g){g={id:row.title,count:0,addresses:new Set(),years:new Set()};groups.set(row.title,g);}
    g.count++;g.years.add(row.year);g.addresses.add(archive.addresses[row.address]);
  }
  showFeaturedShoot(c);
  $('area').textContent=nearestName(c);
  $('tally').textContent=format.format(c.records.length)+(c.records.length===1?' shoot record':' shoot records')+' · '+groups.size+(groups.size===1?' title':' titles')+(year?' · '+year:'');
  const container=$('works');container.replaceChildren();
  for(const g of [...groups.values()].sort((a,b)=>b.count-a.count || archive.titles[a.id][0].localeCompare(archive.titles[b.id][0])).slice(0,shown)){
    const [title,kind]=archive.titles[g.id],details=document.createElement('details'),summary=document.createElement('summary');
    summary.textContent=title;details.append(summary);
    const meta=document.createElement('p');meta.className='note';meta.textContent=media[kind]+' · '+[...g.years].sort().join(', ');details.append(meta);
    const list=document.createElement('ul');
    for(const address of g.addresses){const li=document.createElement('li');li.textContent=address||'Address unlisted';list.append(li);}
    details.append(list);
    if (title === 'EMILY IN PARIS SAISON 4') {
      const figure = document.createElement('figure');
      figure.className = 'work-still';
      const photo = document.createElement('img');
      photo.alt = 'Emily and Gabriel on a bridge in season four';
      photo.loading = 'lazy';
      photo.src = import.meta.env.BASE_URL + 'stills/emily-season-four.webp';
      const credit = document.createElement('figcaption');
      const source = document.createElement('a');
      source.href = 'https://www.netflix.com/tudum/galleries/emily-in-paris-season-4-photo-gallery';
      source.textContent = 'Season 4 still · Netflix';
      credit.append(source);
      figure.append(photo, credit);
      details.append(figure);
    }
    const action=document.createElement('button');action.className='map-title';action.textContent='Map this title';action.onclick=()=>explore({id:g.id});details.append(action);
    container.append(details);
  }
  $('more').hidden=groups.size<=shown;
}
function result(name,detail,select,extra=''){
  const button=document.createElement('button'),text=document.createElement('span'),caption=document.createElement('small');
  text.textContent=name;caption.textContent=detail;button.className='result '+extra;button.append(text,caption);
  button.onclick=()=>{$('searchbox').close();select();};$('suggestions').append(button);
}
function results(){
  const box=$('suggestions'),text=$('query').value.trim();box.replaceChildren();
  if(!text){
    for(const example of ['Emily in Paris','Lupin','John Wick 4']){
      const n=archive.select(year,example).total;
      if(n)result(example,n+(n===1?' record':' records'),()=>explore({phrase:example}));
    }
    if(box.childElementCount)return;
  }
  const matches=archive.matches(text,year);
  if(!matches.length){const p=document.createElement('p');p.textContent='No matching titles'+(year?' in '+year:'')+'.';box.append(p);return;}
  if(text && matches.length>1)result('All titles matching “'+text+'”','View map',()=>explore({phrase:text}),'match-all');
  for(const [id] of matches){const [title,kind]=archive.titles[id];result(title,media[kind],()=>explore({id}));}
}
function openDialog(id){
  pauseTimeline();
  $('tools').open=false;$(id).showModal();
  if(id==='searchbox'){$('query').value='';results();$('query').focus();}
}
function controls(){
  for(const y of archive.years){const opt=new Option(String(y),String(y));$('year').append(opt);}
  $('year').value=year;
  pauseTimeline = bindTimeline(archive.years, $('year'), $('play-years'), $('year-track'), next => {
    year = next;
    explore({phrase:term,id:work}, false);
  });
  $('find').onclick=()=>openDialog('searchbox');$('info').onclick=$('key').onclick=()=>openDialog('about');
  $('query').addEventListener('input',results);
  $('query').addEventListener('keydown',e=>{if(e.key==='Enter')$('suggestions').querySelector('button')?.click();});
  $('active-title').onclick=()=>explore({},false);
  $('unpick').onclick=()=>choose(null);$('more').onclick=()=>{shown+=8;drawDetail();};
  $('plus').onclick=()=>map.zoomIn({duration:motion(230)});$('minus').onclick=()=>map.zoomOut({duration:motion(230)});
  $('tilt').onclick=()=>{const flat=map.getPitch()<12;map.easeTo({pitch:flat?52:0,bearing:flat?-23:0,duration:motion(500)});};
  $('home').onclick=$('paris-pin').onclick=()=>{choose(null);map.easeTo({...home,zoom:openingZoom(),duration:motion(700)});};
  $('wide').onclick=()=>{choose(null);map.easeTo({center:[2.35,47.2],zoom:innerWidth<600?4:4.6,pitch:0,bearing:0,duration:motion(750)});};
  for(const id of ['home','wide','tilt'])$(id).addEventListener('click',()=>{$('tools').open=false;});
  document.addEventListener('pointerdown',e=>{if(!$('tools').contains(e.target))$('tools').open=false;});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('tools').open=false;if(!document.querySelector('dialog[open]'))choose(null);}});
  for(const button of document.querySelectorAll('[data-close]'))button.onclick=()=>button.closest('dialog').close();
  for(const d of document.querySelectorAll('dialog'))d.onclick=e=>{if(e.target!==d)return;const b=d.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)d.close();};
}
async function json(path){
  const response=await fetch(path);if(!response.ok)throw Error('Could not load '+path);return response.json();
}
async function start(){
  const [raw,context,credits]=await Promise.all([json(import.meta.env.BASE_URL+'datos/film.json'),json(import.meta.env.BASE_URL+'datos/contexto.json'),json(import.meta.env.BASE_URL+'datos/landmark-credits.json')]);
  archive=new FilmArchive(raw);$('total').textContent=format.format(archive.total);
  for(const credit of credits){const li=document.createElement('li');li.textContent=credit;$('landmark-credits').append(li);}
  const params=new URLSearchParams(location.search),savedView=location.hash.includes('view=');
  year=archive.years.includes(Number(params.get('year')))?Number(params.get('year')):0;
  term=params.get('title')?.trim()||'';
  if(/^[0-9]+$/.test(params.get('work')||'') && Number(params.get('work'))<archive.titles.length){work=Number(params.get('work'));term='';}
  selection=archive.select(year,term,work);
  const controller=createTileflowMap($('map'),{
    source:{map:'film',manifestUrl:import.meta.env.BASE_URL+'tileflow/manifest.json'},theme:'porcelain',viewMode:'2d',vegetation:false,center:home.center,zoom:openingZoom(),
    mapOptions:{pitch:home.pitch,bearing:home.bearing,hash:'view',attributionControl:false,renderWorldCopies:false,minZoom:3.1,maxZoom:19,maxPitch:62,
      locale:{'Map.Title':'Paris on Film'},transformStyle:atlasStyle,transformRequest:url=>tileRequest(url,context)}
  },{captureId:'paris-on-film'});
  map=await controller.ready;if(!map)throw Error('Could not open the Tileflow map.');
  map.getCanvas().setAttribute('aria-label','Paris filming locations. Use the arrow keys to pan and the plus and minus keys to zoom.');
  material=new FilmMaterial(selection,()=>{$('loading').hidden=true;});
  map.addLayer(material,map.getStyle().layers.find(l=>l.type==='symbol')?.id);
  for(const [name,lon,lat,kind] of places){const el=document.createElement('span');el.className='place '+(kind||'');el.textContent=name;$('places').append(el);labels.push({el,lon,lat});}
  map.on('move',placeNames);map.on('resize',placeNames);map.on('click', e => {
    pauseTimeline();
    choose(material.pick(e.point, e.lngLat).join(','));
  });
  controls();placeNames();if(term || work!==null)explore({phrase:term,id:work},!savedView);
}
start().catch(error=>{console.error(error);$('loading').textContent='The map could not be opened. '+error.message;});
