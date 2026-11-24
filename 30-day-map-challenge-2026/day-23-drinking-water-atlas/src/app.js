import {createGlobe} from './globe.js';
import {createParticles} from './particles.js';

const scene=document.querySelector('#scene');
const place=document.querySelector('#place');
const overlay=document.querySelector('.glass-overlay');
const glass=createParticles(document.querySelector('#particles'));
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const initial=new URL(location.href).searchParams;
const stageNames=['world','country','sample','glass'];
const oldStages=['globo','pais','muestra','vaso'];
const rows=new Map();
let map,selected,animation=0,urlTimer=0;
let glassVisible=false,reveal=0,opacity=0,previousTime=0,currentTime=0;

function updateAddress(){
  if(location.protocol==='file:'||!map||!selected)return;
  const stage=glassVisible?3:map.getProgress()>.55?1:0;
  const url=new URL(location.href);
  if(selected.code==='WLD')url.searchParams.delete('country');else url.searchParams.set('country',selected.code);
  url.searchParams.delete('pais');url.searchParams.delete('etapa');
  if(stage===0&&selected.code==='WLD')url.searchParams.delete('stage');else url.searchParams.set('stage',stageNames[stage]);
  if(url.href!==location.href)history.replaceState(null,'',url);
}
function requestDraw(){
  if(!animation&&!document.hidden)animation=requestAnimationFrame(paint);
}
function paint(now){
  animation=0;
  if(!map||!selected||document.hidden)return;
  const visible=map.isLocked();
  if(visible!==glassVisible){
    glassVisible=visible;
    if(visible&&reveal===0){
      currentTime=0;
      glass.setOrigin(map.glassOrigin());
    }
  }
  const elapsed=previousTime?Math.max(0,now-previousTime):0;
  previousTime=now;
  if(reduced.matches){
    opacity=reveal=visible?1:0;
  }else{
    opacity=visible?Math.min(1,opacity+elapsed/160):Math.max(0,opacity-elapsed/240);
    // On zoom-out the whole overlay fades while any beads in flight keep moving.
    // A quick reversal resumes the same trajectories and never takes over the camera.
    if(visible||opacity>0){
      reveal=Math.min(1,reveal+elapsed/3100);
      currentTime+=Math.min(.05,elapsed/1000);
    }else reveal=0;
  }
  const alpha=String(Math.round(opacity*100)/100);
  if(overlay.style.opacity!==alpha)overlay.style.opacity=alpha;
  glass.draw(reveal,reduced.matches?0:currentTime);
  if(!reduced.matches&&(visible||opacity>0))requestDraw();
  else previousTime=0;
}
function cameraChanged(){
  if(!map)return;
  requestDraw();
  clearTimeout(urlTimer);urlTimer=setTimeout(updateAddress,160);
}

function select(code,{center=false,stage,animate=true}={}){
  const row=rows.get(code);if(!row)return;
  const changed=selected?.code!==code;
  if(changed){
    selected=row;place.value=row.code;
    const proxy=row.method==='proxy',good=Math.round(row.value*10);
    const value=proxy?'≈'+Math.round(row.value):row.value.toLocaleString('en',{minimumFractionDigits:1,maximumFractionDigits:1});
    glass.configure(row);
    document.querySelector('#value').textContent=value;
    document.querySelector('#meter-fill').style.width=row.value+'%';
    document.querySelector('#safe').textContent=String(good);
    document.querySelector('#other').textContent=String(1000-good);
    document.querySelector('#source').textContent=proxy?'Atlas estimate':row.method==='historical'?'Latest national JMP estimate':'WHO / UNICEF · JMP';
    document.querySelector('#year').textContent=row.year;
    document.querySelector('#note').textContent=row.note;
    document.querySelector('#details').open=false;
    document.querySelector('#announcement').textContent=row.name+'. '+value+' percent, '+good+' of every thousand people with safely managed drinking water.';
  }
  if(!map)return;
  if(changed||center)map.setCountry(code==='WLD'?null:code,{center,stage:stage??(code==='WLD'?0:1),animate:animate&&!reduced.matches});
  cameraChanged();
}
place.addEventListener('change',()=>select(place.value,{center:true}));
// A hover changes only the subject of the measurement. The map remains under
// the pointer so moving directly from one country to another never flies away.
function hover(code){
  if(code&&rows.has(code)&&selected?.code!==code)select(code);
}
window.addEventListener('keydown',e=>{
  if(!map||e.altKey||e.ctrlKey||e.metaKey||e.target.closest?.('select,details,a'))return;
  if(e.key==='Escape'||e.key==='Home'){e.preventDefault();select('WLD',{center:true,stage:0});}
  if(e.key==='End'){e.preventDefault();map.setStage(3,{animate:!reduced.matches});}
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){cancelAnimationFrame(animation);animation=0;previousTime=0;}else requestDraw();
});
reduced.addEventListener('change',cameraChanged);
async function start(){
  const data=globalThis.__atlasData??await fetch('./data/agua.json').then(r=>{if(!r.ok)throw Error('agua.json');return r.json();});
  const all=[data.world,...data.countries.slice().sort((a,b)=>a.name.localeCompare(b.name,'en'))];
  place.replaceChildren(...all.map(r=>{rows.set(r.code,r);return new Option(r.name,r.code);}));
  const code=(initial.get('country')??initial.get('pais'))?.toUpperCase()??'WLD';
  const initialCode=rows.has(code)?code:'WLD';
  select(initialCode);
  if(globalThis.__atlasCsv)document.querySelector('#download').href=URL.createObjectURL(new Blob([globalThis.__atlasCsv],{type:'text/csv;charset=utf-8'}));
  const resize=()=>{glass.resize();map?.resize();requestDraw();};
  const observer=new ResizeObserver(resize);observer.observe(scene);resize();
  map=await createGlobe(document.querySelector('#globe'),{rows:data.countries,onHover:hover,
    onCountry:code=>{if(rows.has(code)&&(selected?.code!==code||map.getProgress()<.96))select(code,{center:true});},onView:cameraChanged});
  const stage=initial.has('stage')?stageNames.indexOf(initial.get('stage')):oldStages.indexOf(initial.get('etapa'));
  select(initialCode,{center:true,animate:false,stage:stage>=0?stage:(initialCode==='WLD'?0:1)});
}
start().catch(error=>{
  console.error(error);const message=document.querySelector('#error');message.hidden=false;message.textContent='The map could not be loaded. Please reopen the atlas.';
});
