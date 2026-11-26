import {contourPrint} from './glyph-contours.js';
import {waveType} from './wave-type.js';
import {treeBreeze} from './tree-breeze.js';
import {countryPrint} from './printed-ground.js';
const ns='http://www.w3.org/2000/svg';
const svgElement=name=>document.createElementNS(ns,name);
const pad=110;
const mod=(x,n)=>((x%n)+n)%n;

// Keep city corners, merge nearly collinear vertices and clip the strips before
// allocating text. A long river only owns strips that can actually enter the view.
function straightRuns(points,w,h){
  const result=[];let total=0;
  function emit(a,b){
    const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
    if(!len)return;
    let lo=0,hi=1;
    for(const [v,d,limit] of [[a[0],dx,w],[a[1],dy,h]]){
      if(Math.abs(d)<1e-8){if(v< -pad||v>limit+pad)hi=-1;continue;}
      const f=(-pad-v)/d,t=(limit+pad-v)/d;
      lo=Math.max(lo,Math.min(f,t));hi=Math.min(hi,Math.max(f,t));
    }
    if(hi>lo)result.push({x:a[0]+dx*lo,y:a[1]+dy*lo,length:(hi-lo)*len,angle:Math.atan2(dy,dx),distance:total+lo*len});
    total+=len;
  }
  let start=0;
  for(let i=2;i<points.length;i++){
    const a=points[start],b=points[i-1],c=points[i];
    const ux=b[0]-a[0],uy=b[1]-a[1],vx=c[0]-b[0],vy=c[1]-b[1];
    const length=Math.hypot(ux,uy);
    if(length && (Math.abs(ux*vy-uy*vx)/length>1.3 || ux*vx+uy*vy<=0)){emit(a,b);start=i-1;}
  }
  if(points.length>1)emit(points[start],points.at(-1));
  return result;
}

// Adjacent tiles can supply overlapping lines, and a divided avenue can have two
// centerlines. Reserve one legible strip where the same name follows the same bearing.
function reserveStreet(runs,ink,id,size){
  const step=7,cell=28,tolerance=size*1.4;
  const visible=[];
  for(const run of runs){
    const c=Math.cos(run.angle),s=Math.sin(run.angle);
    let start=null;
    const finish=end=>{
      if(start!==null && end-start>3)visible.push({...run,x:run.x+c*start,y:run.y+s*start,
        distance:run.distance+start,length:end-start});
      start=null;
    };
    for(let offset=0;offset<run.length;offset+=step){
      const u=Math.min(offset+step/2,run.length),x=run.x+c*u,y=run.y+s*u;
      const a=Math.floor(x/cell),b=Math.floor(y/cell),distance=run.distance+u;
      let taken=false;
      for(let j=b-1;j<=b+1&&!taken;j++)for(let i=a-1;i<=a+1&&!taken;i++){
        const others=ink.get(i+','+j);
        if(others)taken=others.some(p=>(p.id!==id || Math.abs(p.distance-distance)>45) &&
          Math.abs(p.c*c+p.s*s)>.85 && (p.x-x)**2+(p.y-y)**2<tolerance*tolerance);
      }
      if(taken){finish(offset);continue;}
      if(start===null)start=offset;
      const key=a+','+b;
      if(!ink.has(key))ink.set(key,[]);
      ink.get(key).push({id,distance,x,y,c,s});
    }
    finish(run.length);
  }
  return visible;
}

// Several feature classes share ink and glyphs so adjacent tiles print as a continuous field.
const legend={roof:['∶','#ad8d73'],workshop:['⌗','#a77b60'],
  crop:['″','#a18b62'],farmland:['″','#a18b62'],orchard:['°','#84915f'],vineyard:['″','#84915f'],
  sand:['∴','#9a744c'],shrub:['⁙','#929775'],barren:['∴','#ac9877'],snow:['✳','#7d9b9e'],
  urban:[':','#997c70'],residential:[':','#997c70'],industrial:['+','#997c70']};

function glyphRows(points,svg){
  const groups=new Map();
  for(const [x,y,kind] of points){
    const mark=legend[kind];if(!mark)continue;
    const key=mark[0]+mark[1],rows=groups.get(key)??new Map();
    if(!groups.has(key))groups.set(key,rows);
    const xs=rows.get(y)??[];if(!rows.has(y))rows.set(y,xs);xs.push(x);
  }
  for(const [key,rows] of groups){
    const g=svgElement('g');g.setAttribute('fill',key.slice(1));svg.append(g);
    for(const [y,xs] of rows){
      const t=svgElement('text');t.setAttribute('y',y.toFixed(1));t.setAttribute('x',xs.map(v=>v.toFixed(1)).join(' '));
      t.textContent=key[0].repeat(xs.length);g.append(t);
    }
  }
}

export function mountLines(parent){
  const layer=document.createElement('div');layer.className='printed-lines';layer.setAttribute('aria-hidden','true');
  const base=document.createElement('div');base.className='map-ink';base.setAttribute('aria-hidden','true');
  parent.prepend(base);parent.append(layer);
  const paper=getComputedStyle(layer).getPropertyValue('--paper').trim();
  const measure=document.createElement('canvas').getContext('2d');
  let clips=[],playing=true,held=false,focused=null,printRuns=[],frozen=null,currentView=null;
  function freeze(){
    if(frozen || !printRuns.length || !currentView)return;
    const {w,h}=currentView,dpr=Math.min(2,window.devicePixelRatio||1);
    frozen=document.createElement('canvas');frozen.className='frozen-letters';
    frozen.width=(w+2*pad)*dpr;frozen.height=(h+2*pad)*dpr;
    frozen.style.cssText='position:absolute;left:-'+pad+'px;top:-'+pad+'px;width:'+(w+2*pad)+'px;height:'+(h+2*pad)+'px';
    const ctx=frozen.getContext('2d');ctx.scale(dpr,dpr);ctx.translate(pad,pad);ctx.textBaseline='middle';
    for(const r of printRuns){
      const phase=(Number(r.animation?.currentTime??0)%r.duration)/r.duration;
      ctx.save();ctx.translate(r.run.x,r.run.y);ctx.rotate(r.run.angle);
      ctx.beginPath();ctx.rect(0,-r.size*.78,r.run.length+.4,r.size*1.56);ctx.clip();
      const pos=r.start+phase*r.period;
      ctx.font=r.face;ctx.fillStyle=paper;
      for(let x=pos;x<r.run.length+r.padLeft;x+=r.period){
        ctx.fillRect(x-r.padLeft,r.maskTop-r.size*.76,r.padLeft+r.nameEnd,r.maskHeight);
      }
      ctx.textBaseline='alphabetic';ctx.fillStyle=r.color;ctx.fillText(r.line.textContent,pos,r.baseline-r.size*.76);
      ctx.restore();
    }
    layer.append(frozen);layer.classList.add('navigating');
  }
  function thaw(){frozen?.remove();frozen=null;layer.classList.remove('navigating');}
  function motion(){
    for(const {animation} of clips){
      if(playing && !held)animation.play();else animation.pause();
    }
  }
  function set(sheet){
    thaw();currentView=sheet.view;
    const frag=document.createDocumentFragment(),under=document.createDocumentFragment(),next=[];
    const {w,h}=sheet.view;
    const atlas=countryPrint(sheet.view);
    if(atlas)under.append(atlas);
    const sea=svgElement('svg');sea.setAttribute('width',w+2*pad);sea.setAttribute('height',h+2*pad);
    sea.setAttribute('viewBox',[-pad,-pad,w+2*pad,h+2*pad].join(' '));sea.classList.add('world-waves');
    sea.style.left=-pad+'px';sea.style.top=-pad+'px';
    const ground=svgElement('g');ground.classList.add('terrain-ink');sea.append(ground);
    ground.setAttribute('opacity',String(Math.min(.78,Math.max(0,(sheet.view.z-3.4)/1.15))));
    glyphRows(sheet.ground,ground);
    under.append(sea);
    const contours=contourPrint(sheet.contours,sheet.view,pad);
    if(contours)under.append(contours);
    // Keep the changing waves on their own surface. A ripple must not repaint
    // tens of thousands of stationary roof and street characters each frame.
    const waterSheet=sea.cloneNode(false);
    const waterGroup=svgElement('g');waterGroup.classList.add('wave-ink');waterSheet.append(waterGroup);
    under.append(waterSheet);
    const breeze=treeBreeze(sheet,pad);
    if(breeze)under.append(breeze.svg);
    const streets=new Map();
    for(const [id,track] of sheet.tracks.entries()){
      const {name,water,featured,size}=track;
      const face=(water?'italic ':featured?'bold ':'')+size+'px Georgia, serif';
      const word=name+(featured?'   /   ':water?'  ·  ':'    ·    ');
      measure.font=face;
      const period=measure.measureText(word).width,speed=featured?66:water?20:36;
      const duration=1000*period/speed,half=size*.76;
      const metrics=measure.measureText(name);
      const padLeft=Math.max(0,metrics.actualBoundingBoxLeft)+1.5;
      const nameEnd=Math.max(metrics.width,metrics.actualBoundingBoxRight)+1.5;
      const baseline=half+((metrics.fontBoundingBoxAscent??size*.9)-(metrics.fontBoundingBoxDescent??size*.23))/2;
      const maskTop=baseline-metrics.actualBoundingBoxAscent-1.3;
      const maskHeight=metrics.actualBoundingBoxAscent+metrics.actualBoundingBoxDescent+2.6;
      let runs=straightRuns(track.pts,w,h);
      if(!water){
        if(!streets.has(name))streets.set(name,new Map());
        runs=reserveStreet(runs,streets.get(name),id,size);
      }
      for(const run of runs){
        if(run.length<3)continue;
        const clip=document.createElement('div'),line=document.createElement('span');
        clip.className='letter-lane'+(water?' river-lane':featured?' featured-lane':'');
        clip.style.cssText='left:'+run.x+'px;top:'+run.y+'px;width:'+(run.length+.3)+'px;height:'+size*1.52+'px;transform:rotate('+run.angle+'rad) translateY('+(-half)+'px)';
        line.style.setProperty('--name-end',nameEnd+'px');line.style.setProperty('--next-name',(period-padLeft)+'px');
        line.style.setProperty('--period',period+'px');line.style.setProperty('--name-height',maskHeight+'px');
        line.style.setProperty('--name-top',maskTop+'px');
        line.style.font=face;line.style.lineHeight=size*1.52+'px';
        line.textContent=word.repeat(Math.ceil(run.length/period)+4);
        const start=-period-mod(run.distance,period);
        clip.append(line);frag.append(clip);
        next.push({name,line,start,period,duration,run,face,size,padLeft,nameEnd,baseline,maskTop,maskHeight,order:featured?2:water?1:0,color:water?'#206970':featured?'#a33720':'#433d35'});
      }
    }
    for(const c of clips)c.animation.cancel();
    base.replaceChildren(under);layer.replaceChildren(frag);
    const now=document.timeline.currentTime??0;
    printRuns=next.slice().sort((a,b)=>a.order-b.order);
    clips=next.map(r=>{
      const {name,line,start,period,duration}=r;
      const animation=line.animate([{transform:'translate3d('+start+'px,0,0)'},{transform:'translate3d('+(start+period)+'px,0,0)'}],
        {duration,iterations:Infinity,easing:'linear'});
      animation.currentTime=playing?now%duration:0;
      r.animation=animation;return {name,animation,clip:line.parentNode};
    });
    if(breeze)clips.push(...breeze.clips);
    clips.push(...waveType(waterGroup,sheet));
    focused=null;motion();if(held)freeze();
  }
  return {set,register([x,y,s]){
    for(const sheet of [base,layer]){
      sheet.style.transform='matrix('+s+',0,0,'+s+','+x+','+y+')';
      sheet.style.opacity=s<.35||s>2.85?'.35':'1';
    }
  },focus(name){
    if(name===focused)return;
    for(const item of clips){
      if(!item.clip || (item.name!==focused && item.name!==name))continue;
      const active=item.name===name;item.clip.classList.toggle('is-focused',active);
      item.animation.updatePlaybackRate(active?1.55:1);
    }
    focused=name;
  },motion(value){playing=value;motion();},hold(value){if(value!==held){held=value;motion();if(held)freeze();else thaw();}},
  destroy(){for(const c of clips)c.animation.cancel();base.remove();layer.remove();}};
}
