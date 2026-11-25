import {busConnector, constrainBusCard, placeBusCard} from './bus-card-position.js';
import {sidePanel} from './place-card.js';

const svgNS = 'http://www.w3.org/2000/svg';
const round = n => Math.round(n * 2) / 2;

function crosses(a,b,rect) {
  // Clip this segment against the control's bounds, including parallel edges.
  let from = 0, to = 1;
  for (const [start,end,lo,hi] of [[a.x,b.x,rect.left,rect.right],[a.y,b.y,rect.top,rect.bottom]]) {
    if (start === end) { if (start < lo || start > hi) return false; continue; }
    const t0 = (lo-start)/(end-start), t1 = (hi-start)/(end-start);
    from = Math.max(from,Math.min(t0,t1));
    to = Math.min(to,Math.max(t0,t1));
    if (from > to) return false;
  }
  return true;
}

export function createBusCardAnchor(map, dock) {
  const canvas = map.getCanvas();
  const controls = [...document.querySelectorAll('.map-top, .map-controls, #punctuality-panel')];
  const svg = document.createElementNS(svgNS, 'svg');
  svg.classList.add('bus-card-connector');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('hidden', '');
  const make = name => {
    const item = document.createElementNS(svgNS, name);
    svg.append(item);
    return item;
  };
  const under = make('path'), line = make('path'), pin = make('circle');
  const haloUnder = make('rect'), halo = make('rect');
  pin.setAttribute('r', '3.3');
  dock.before(svg);

  let key, position, layout, lastMark, lastColor;
  let revealPending = false, revealing = false;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  function cancelReveal() {
    revealPending = false;
    if (revealing) {
      revealing = false;
      map.stop();
    }
  }
  function endReveal(event) {
    if (event.placeReveal) revealing = false;
  }
  const inputEvents = ['mousedown', 'touchstart', 'wheel', 'dragstart'];
  for (const event of inputEvents) map.on(event, cancelReveal);
  map.on('moveend', endReveal);
  const observer = new ResizeObserver(() => { layout = null; });
  for (const element of [canvas, dock, ...controls]) observer.observe(element);

  function hide() {
    if (lastMark) svg.setAttribute('hidden', '');
    lastMark = null;
  }
  function reset() {
    cancelReveal();
    hide();
    if (position) {
      delete dock.dataset.busAnchored;
      delete dock.dataset.anchored;
      dock.style.removeProperty('--card-x');
      dock.style.removeProperty('--card-y');
    }
    key = position = layout = null;
  }
  sidePanel.addEventListener('change', reset);
  map.once('remove', () => {
    observer.disconnect();
    sidePanel.removeEventListener('change', reset);
    for (const event of inputEvents) map.off(event, cancelReveal);
    map.off('moveend', endReveal);
    reset();
    svg.remove();
  });

  function measure(kind) {
    if (dock.hidden || !dock.querySelector(kind === 'bus' ? '.bus-panel' : '.place-panel')) return;
    const card = dock.getBoundingClientRect(), origin = canvas.getBoundingClientRect();
    if (!card.width || !card.height) return;
    const {width:w, height:h} = origin;
    const obstacles = [];
    for (const control of controls) {
      const r = control.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const rect = {left:r.left-origin.left, right:r.right-origin.left, top:r.top-origin.top, bottom:r.bottom-origin.top};
      if (obstacles.some(o => o.left<=rect.left && o.right>=rect.right && o.top<=rect.top && o.bottom>=rect.bottom)) continue;
      rect.bottomAnchor = rect.top+rect.bottom > h;
      obstacles.push(rect);
    }
    return {w,h,cw:card.width,ch:card.height,obstacles,
      mobileBox:{left:card.left-origin.left,top:card.top-origin.top,width:card.width,height:card.height}};
  }
  function setPosition(next,kind) {
    const left = Math.round(next.left), top = Math.round(next.top);
    if (position && left===position.left && top===position.top) return;
    position = {left,top};
    dock.style.setProperty('--card-x',left+'px');
    dock.style.setProperty('--card-y',top+'px');
    dock.toggleAttribute(kind==='bus'?'data-bus-anchored':'data-anchored',true);
  }
  function ready(kind,id) {
    if (kind === 'bus' && !sidePanel.matches) {
      if (key) reset();
      return false;
    }
    const next = kind+'/'+id;
    if (key !== next) {
      reset();
      key = next;
      revealPending = kind !== 'bus' && !sidePanel.matches;
      svg.dataset.kind = kind;
      // A selection can arrive before paint() replaces the previous detail.
      return false;
    }
    if (!layout) {
      layout = measure(kind);
      if (!layout) { hide(); return false; }
      if (position) setPosition(constrainBusCard(position,layout),kind);
    }
    return true;
  }
  function onScreen(p) {
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) &&
      p.x>=3 && p.x<=layout.w-3 && p.y>=3 && p.y<=layout.h-3;
  }
  function positionNear(kind,point,gap,protectedArea) {
    if (position || !sidePanel.matches || map.isMoving()) return;
    const {x,y} = point, {cw,w,obstacles} = layout;
    const side = x+cw+gap+8 < w || x<=w/2 ? 1 : -1;
    const preferred = placeBusCard({...layout,x,y,gap,lift:19,headerOffset:28,side});
    setPosition(constrainBusCard(preferred,{...layout,obstacles:[...obstacles,protectedArea]}),kind);
  }
  function display(mark,mode) {
    if (!lastMark) svg.removeAttribute('hidden');
    svg.dataset.mode = mode;
    lastMark = mark;
  }
  function drawHalo(point) {
    const width = 2*(point.halfWidth+3), height = 2*(point.halfHeight+3);
    const x = round(point.x-width/2), y = round(point.y-height/2);
    const mark = [x,y,width,height].join(',');
    if (mark===lastMark) return;
    for (const node of [haloUnder,halo]) {
      node.setAttribute('x',x); node.setAttribute('y',y);
      node.setAttribute('width',width); node.setAttribute('height',height);
      node.setAttribute('rx',point.type==='location' ? width/2 : Math.min(5,height/3));
    }
    svg.style.opacity='1';
    display(mark,'pin');
  }
  function leader(anchor,color,isPlace) {
    const {cw,ch,obstacles,mobileBox} = layout;
    if (!position && sidePanel.matches) return hide();
    const box = position ? {...position,width:cw,height:ch} : mobileBox;
    const raw = busConnector(anchor,box);
    if (!raw || obstacles.some(r=>anchor.x>=r.left && anchor.x<=r.right && anchor.y>=r.top && anchor.y<=r.bottom)) return hide();
    let x = anchor.x, y = anchor.y;
    const elbow = {x:raw.elbowX,y:raw.elbowY}, end = {x:raw.endX,y:raw.endY};
    if (isPlace) {
      // End at the edge of the selected sign so platform numbers stay readable.
      const dx = elbow.x-x, dy = elbow.y-y;
      const ratio = Math.max(Math.abs(dx)/(anchor.halfWidth+1),Math.abs(dy)/(anchor.halfHeight+1));
      if (ratio > 1) { x += dx/ratio; y += dy/ratio; }
    }
    if (lastColor!==color) { svg.style.setProperty('--connector-color',color); lastColor=color; }
    const length = Math.hypot(end.x-x,end.y-y);
    const maxLength = isPlace && !sidePanel.matches ? Math.min(240,Math.max(146,layout.h*.32)) : 150;
    if (length<10 || length>maxLength || obstacles.some(r=>crosses({x,y},elbow,r)||crosses(elbow,end,r))) {
      return isPlace ? drawHalo(anchor) : hide();
    }
    const path='M'+round(x)+' '+round(y)+'L'+round(elbow.x)+' '+round(elbow.y)+'L'+round(end.x)+' '+round(end.y);
    if (path===lastMark) return;
    under.setAttribute('d',path); line.setAttribute('d',path);
    pin.setAttribute('cx',round(x)); pin.setAttribute('cy',round(y));
    svg.style.opacity = isPlace ? '1' : String(Math.min(1,(maxLength+1-length)/32));
    display(path,'link');
  }
  function draw({busId,roof,ground,atStreet,color,lineNumber}) {
    if (!ready('bus',busId)) return;
    const anchor = atStreet&&roof ? roof : ground;
    if (!onScreen(anchor) || !onScreen(ground)) return hide();
    if (!position) {
      const {x,y} = anchor;
      const clearance = Math.max(x-(anchor.left??x),(anchor.right??x)-x);
      const badgeHalf = Math.max(18,String(lineNumber).length*4+8);
      const roofTop=anchor.top??y-5,roofBottom=anchor.bottom??y+5;
      positionNear('bus',anchor,Math.max(48,clearance+14),{
        left:Math.min(anchor.left??x,x-badgeHalf),right:Math.max(anchor.right??x,x+badgeHalf),
        top:roofTop>28?roofTop-28:roofTop,bottom:roofTop>28?roofBottom:roofBottom+28,
      });
    }
    if (atStreet && !roof) return hide();
    leader(anchor,color,false);
  }
  function revealUnderSheet(anchor) {
    revealPending = false;
    if (map.isMoving()) return;
    const {mobileBox: b, w, h, obstacles} = layout;
    const {x,y,halfWidth,halfHeight} = anchor, right = b.left+b.width, bottom = b.top+b.height;
    if (x+halfWidth < b.left || x-halfWidth > right || y+halfHeight < b.top || y-halfHeight > bottom) return;
    const marginX = halfWidth+9, marginY = halfHeight+9;
    const candidates = [
      {x,y:b.top-halfHeight-30}, {x:b.left-halfWidth-30,y},
      {x:right+halfWidth+30,y}, {x,y:bottom+halfHeight+30},
    ].filter(p => p.x >= marginX && p.x <= w-marginX && p.y >= marginY && p.y <= h-marginY-22 &&
      !obstacles.some(r => p.x+marginX >= r.left && p.x-marginX <= r.right && p.y+marginY >= r.top && p.y-marginY <= r.bottom));
    candidates.sort((a,b) => Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y));
    if (!candidates.length) return;
    const target = candidates[0];
    revealing = true;
    map.panBy([x-target.x,y-target.y], {duration: reducedMotion.matches ? 0 : 220}, {placeReveal:true});
  }
  function drawPlace(kind,id,anchor,color,tapped) {
    if (!ready(kind,id)) return;
    if (!onScreen(anchor)) return hide();
    if (svg.dataset.target!==anchor.type) svg.dataset.target=anchor.type;
    if (revealPending && tapped) revealUnderSheet(anchor);
    const {x,y,halfWidth,halfHeight} = anchor;
    positionNear(kind,anchor,halfWidth+36,{left:x-halfWidth,right:x+halfWidth,top:y-halfHeight,bottom:y+halfHeight});
    leader(anchor,color,true);
  }
  return {draw,drawPlace,reset};
}
