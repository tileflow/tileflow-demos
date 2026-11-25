import * as maplibregl from 'maplibre-gl';

const wrap = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;
const isPoint = (p) =>
  Number.isFinite(p?.lon) && Number.isFinite(p.lat) && Math.abs(p.lat) <= 85.051129;
const stop = (e) => {
  if (e.cancelable) e.preventDefault();
  e.stopPropagation();
};

function attach(map, {atlas, onAim, onLockChange} = {}) {
  const canvas = map.getCanvas(),
    container = map.getContainer();
  const handle = document.createElement('button');
  handle.className = 'live-aim';
  handle.type = 'button';
  handle.draggable = false;
  handle.setAttribute(
    'aria-keyshortcuts',
    'ArrowLeft ArrowRight ArrowUp ArrowDown Enter Space Escape',
  );
  const sight = document.createElement('span');
  sight.className = 'live-aim-sight';
  sight.setAttribute('aria-hidden', 'true');
  handle.append(sight);
  const marker = new maplibregl.Marker({
    element: handle,
    anchor: 'center',
    subpixelPositioning: true,
    opacityWhenCovered: 0.65,
  });
  let target = null,
    fixed = false,
    gesture = null,
    background = null,
    lastPointer = '',
    suppressUntil = 0;

  function sync() {
    handle.dataset.fixed = String(fixed);
    handle.setAttribute('aria-pressed', String(fixed));
    handle.setAttribute(
      'aria-label',
      fixed ? 'View locked. Resume exploring' : 'Profile target. Lock view',
    );
    handle.title = fixed ? 'Resume exploring' : 'Lock view. Use the arrow keys to move the target';
  }
  function setFixed(next) {
    next = !!target && !!next;
    if (next === fixed) return;
    fixed = next;
    sync();
    onLockChange?.(fixed);
  }
  function set(p, {fixed: next = false, notify = true, source = 'set'} = {}) {
    if (!isPoint(p)) return false;
    const isNew = !target;
    target = {...p, lon: wrap(p.lon)};
    const displayLon = target.lon + 360 * Math.round((map.getCenter().lng - target.lon) / 360);
    marker.setLngLat([displayLon, target.lat]);
    if (isNew) marker.addTo(map);
    setFixed(next);
    if (notify) onAim?.(target, {fixed, source});
    return true;
  }
  function hover(p) {
    if (fixed || gesture || background || !isPoint(p)) return false;
    if (target?.lat === p.lat && target.lon === wrap(p.lon)) return false;
    return set(p, {source: 'hover'});
  }
  function tap(p, {touch = lastPointer === 'touch' || lastPointer === 'pen'} = {}) {
    if (gesture || performance.now() < suppressUntil) return false;
    return set(p, {fixed: !touch, source: touch ? 'touch' : 'click'});
  }
  function releaseGesture() {
    const active = gesture;
    gesture = null;
    delete handle.dataset.dragging;
    if (active && handle.hasPointerCapture?.(active.id)) handle.releasePointerCapture(active.id);
  }
  function clear() {
    releaseGesture();
    background = null;
    target = null;
    setFixed(false);
    marker.remove();
  }
  function pointAt(x, y) {
    if (x < 0 || y < 0 || x >= canvas.clientWidth || y >= canvas.clientHeight) return null;
    const ll = map.unproject([x, y]);
    if (!ll || !atlas.isGround({x, y}, ll)) return null;
    const p = {lat: ll.lat, lon: wrap(ll.lng)};
    return isPoint(p) ? p : null;
  }
  function canvasPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) * canvas.clientWidth) / rect.width,
      y: ((clientY - rect.top) * canvas.clientHeight) / rect.height,
    };
  }
  function updateDrag(e) {
    const pt = canvasPoint(e.clientX, e.clientY);
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    if (
      !hit ||
      !container.contains(hit) ||
      hit.closest('.floating,.maplibregl-ctrl,.maplibregl-popup,[data-placement-block]')
    )
      return;
    const p = pointAt(pt.x + gesture.offsetX, pt.y + gesture.offsetY);
    if (p) set(p, {fixed, source: 'drag'});
  }
  function onPointerDown(e) {
    if (gesture && e.pointerId !== gesture.id) {
      releaseGesture();
      background = null;
      return;
    }
    if (!e.isPrimary || e.button !== 0) return;
    lastPointer = e.pointerType;
    suppressUntil = 0;
    background = null;
    if (!target || container.classList.contains('is-placing') || !container.contains(e.target))
      return;
    let onHandle = handle.contains(e.target);
    // Hybrid laptops can report a fine primary pointer while accepting a finger.
    // Catch a finger on the canvas directly above the normally click-through sight.
    if (!onHandle && e.pointerType !== 'mouse' && e.target === canvas) {
      const r = handle.getBoundingClientRect();
      onHandle =
        Math.abs(e.clientX - (r.left + r.width / 2)) <= 22 &&
        Math.abs(e.clientY - (r.top + r.height / 2)) <= 22;
    }
    if (!onHandle) {
      if (e.target === canvas)
        background = {id: e.pointerId, x: e.clientX, y: e.clientY, moved: false};
      return;
    }
    const rect = handle.getBoundingClientRect(),
      pt = canvasPoint(e.clientX, e.clientY);
    const center = canvasPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    gesture = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      offsetX: center.x - pt.x,
      offsetY: center.y - pt.y,
      moved: false,
    };
    handle.focus({preventScroll: true});
    handle.setPointerCapture?.(e.pointerId);
    stop(e);
  }
  function onPointerMove(e) {
    if (
      background?.id === e.pointerId &&
      Math.hypot(e.clientX - background.x, e.clientY - background.y) > 4
    )
      background.moved = true;
    if (gesture?.id !== e.pointerId) return;
    stop(e);
    if (!gesture.moved) {
      if (Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) < 4) return;
      gesture.moved = true;
      handle.dataset.dragging = 'true';
      map.stop();
    }
    updateDrag(e);
  }
  function onPointerUp(e) {
    if (background?.id === e.pointerId) {
      if (background.moved || Math.hypot(e.clientX - background.x, e.clientY - background.y) > 4)
        suppressUntil = performance.now() + 550;
      background = null;
    }
    if (gesture?.id !== e.pointerId) return;
    stop(e);
    if (gesture.moved) updateDrag(e);
    else setFixed(!fixed);
    suppressUntil = performance.now() + 650;
    releaseGesture();
  }
  function onPointerCancel(e) {
    if (background?.id === e.pointerId) background = null;
    if (gesture?.id === e.pointerId) {
      suppressUntil = performance.now() + 650;
      releaseGesture();
    }
  }
  function onClick(e) {
    // A genuine keyboard/assistive activation dispatches click without pointerdown.
    // The matching pointerup has already handled physical clicks.
    if (!handle.contains(e.target)) return;
    stop(e);
    if (e.detail === 0 && !e.pointerType) setFixed(!fixed);
  }
  function keyDown(e) {
    const arrows = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]};
    const delta = arrows[e.key];
    if (delta && target) {
      stop(e);
      const rect = handle.getBoundingClientRect(),
        center = canvasPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const px = e.shiftKey ? 45 : 10;
      const p = pointAt(center.x + delta[0] * px, center.y + delta[1] * px);
      if (p) set(p, {fixed, source: 'keyboard'});
    } else if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
      stop(e);
      if (!e.repeat) setFixed(e.key === 'Escape' ? false : !fixed);
    }
  }
  function onBlur(e) {
    if (e.target === window) {
      releaseGesture();
      background = null;
    }
  }
  function shield(e) {
    e.stopPropagation();
  }
  const shieldNames = [
    'mousedown',
    'mouseup',
    'touchstart',
    'touchmove',
    'touchend',
    'touchcancel',
    'dblclick',
    'contextmenu',
    'keyup',
  ];
  for (const name of shieldNames) handle.addEventListener(name, shield);
  handle.addEventListener('keydown', keyDown);
  handle.addEventListener('click', onClick);
  handle.addEventListener('lostpointercapture', onPointerCancel);
  const listeners = [
    ['pointerdown', onPointerDown],
    ['pointermove', onPointerMove],
    ['pointerup', onPointerUp],
    ['pointercancel', onPointerCancel],
    ['blur', onBlur],
  ];
  for (const [name, handler] of listeners)
    window.addEventListener(name, handler, {capture: true, passive: false});
  sync();
  function destroy() {
    clear();
    map.off('remove', destroy);
    for (const [name, handler] of listeners) window.removeEventListener(name, handler, true);
    for (const name of shieldNames) handle.removeEventListener(name, shield);
    handle.removeEventListener('keydown', keyDown);
    handle.removeEventListener('click', onClick);
    handle.removeEventListener('lostpointercapture', onPointerCancel);
  }
  map.on('remove', destroy);
  return {
    set,
    hover,
    tap,
    clear,
    setFixed,
    isFixed: () => fixed,
    current: () => target,
    element: () => handle,
    isDragging: () => !!gesture?.moved,
    destroy,
  };
}
export default {attach};
