function bind({
  map,
  atlas,
  handle,
  onPlace,
  hasObserver = () => false,
  onRemove = () => {},
  onMode = () => {},
  createGhost,
}) {
  const canvas = map.getCanvas(),
    mapElement = map.getContainer();
  let mode = 'idle',
    gesture = null,
    ghost = null,
    suppressed = null,
    discardPointer = null;
  let removeMarker = null,
    marker = null;
  const wrap = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

  function sync() {
    const selected = hasObserver();
    const action = selected
      ? 'Remove observer'
      : mode === 'armed'
        ? 'Cancel placement'
        : 'Place observer';
    handle.setAttribute('aria-pressed', String(selected || mode !== 'idle'));
    handle.setAttribute('aria-label', action);
    handle.title =
      mode === 'dragging'
        ? 'Release to place the observer'
        : selected
          ? 'Remove the observer or drag to a new location'
          : mode === 'armed'
            ? 'Cancel placement'
            : 'Click to place the observer or drag onto the map';
    marker?.setAttribute('aria-pressed', String(mode !== 'idle'));
  }
  function setMode(next) {
    if (mode === next) return;
    mode = next;
    onMode(mode);
    sync();
  }
  function stop(e) {
    if (e.cancelable) e.preventDefault();
    e.stopImmediatePropagation();
  }
  function groundAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (
      !rect.width ||
      !rect.height ||
      clientX < rect.left ||
      clientY < rect.top ||
      clientX >= rect.right ||
      clientY >= rect.bottom
    )
      return null;
    const hit = document.elementFromPoint(clientX, clientY);
    if (
      !hit ||
      !mapElement.contains(hit) ||
      hit.closest('.floating,.maplibregl-ctrl,.maplibregl-popup,[data-placement-block]')
    )
      return null;
    const x = ((clientX - rect.left) * canvas.clientWidth) / rect.width;
    const y = ((clientY - rect.top) * canvas.clientHeight) / rect.height;
    const ll = map.unproject([x, y]);
    if (
      !ll ||
      !Number.isFinite(ll.lat) ||
      !Number.isFinite(ll.lng) ||
      Math.abs(ll.lat) > 85.05112878
    )
      return null;
    if (!atlas.isGround({x, y}, ll)) return null;
    return {lat: ll.lat, lon: wrap(ll.lng), name: '', region: ''};
  }
  function showGhost(e) {
    if (!ghost) {
      ghost = createGhost?.() || document.createElement('div');
      if (!ghost.childElementCount) {
        const symbol = handle.querySelector('.observer-portrait');
        if (symbol) ghost.append(symbol.cloneNode(true));
      }
      ghost.classList.add('placement-ghost');
      ghost.setAttribute('aria-hidden', 'true');
      Object.assign(ghost.style, {position: 'fixed', pointerEvents: 'none', zIndex: '10'});
      document.body.append(ghost);
    }
    ghost.style.left = e.clientX + 'px';
    ghost.style.top = e.clientY + 'px';
    ghost.dataset.valid = String(!!groundAt(e.clientX, e.clientY));
  }
  function release() {
    const g = gesture;
    gesture = null;
    ghost?.remove();
    ghost = null;
    if (g?.source.hasPointerCapture?.(g.id)) g.source.releasePointerCapture(g.id);
    return g;
  }
  function suppress(g, x, y) {
    // A genuine next pointerdown or keyboard activation clears this guard immediately.
    suppressed = {source: g.source, x, y, until: performance.now() + 800};
  }
  function cancel() {
    const g = release();
    if (g) {
      discardPointer = g.id;
      suppress(g, g.x, g.y);
    }
    setMode('idle');
  }
  function activate(source) {
    if (source === handle && hasObserver()) {
      cancel();
      onRemove();
      sync();
      return;
    }
    if (mode === 'armed') {
      cancel();
      return;
    }
    setMode('armed');
    // Arrow keys can move the map and Enter selects its center using the map's normal picking.
    canvas.focus({preventScroll: true});
  }
  function onDown(e) {
    if (!e.isPrimary || e.button !== 0 || gesture) return;
    stop(e);
    const source = e.currentTarget;
    gesture = {
      id: e.pointerId,
      source,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      dragging: false,
    };
    source.setPointerCapture?.(e.pointerId);
  }
  function onMove(e) {
    const g = gesture;
    if (!g || g.id !== e.pointerId) return;
    stop(e);
    g.x = e.clientX;
    g.y = e.clientY;
    if (!g.dragging) {
      if (Math.hypot(g.x - g.startX, g.y - g.startY) < 5) return;
      g.dragging = true;
      setMode('dragging');
    }
    showGhost(e);
  }
  function onUp(e) {
    if (e.pointerId === discardPointer) {
      discardPointer = null;
      if (suppressed)
        Object.assign(suppressed, {x: e.clientX, y: e.clientY, until: performance.now() + 800});
      stop(e);
      return;
    }
    if (e.pointerId !== gesture?.id) return;
    stop(e);
    const g = release();
    suppress(g, e.clientX, e.clientY);
    const moved = g.dragging || Math.hypot(e.clientX - g.startX, e.clientY - g.startY) >= 5;
    if (!moved) {
      activate(g.source);
      return;
    }
    const point = groundAt(e.clientX, e.clientY);
    if (point) onPlace(point);
    setMode('idle');
    sync();
  }
  function onCancel(e) {
    if (e.pointerId !== gesture?.id) return;
    cancel();
  }
  function onPointerStart(e) {
    // An unrelated second touch interrupts placement, allowing a new pinch/pan gesture.
    if (gesture && e.pointerId !== gesture.id) {
      cancel();
      return;
    }
    if (e.isPrimary) {
      suppressed = null;
      discardPointer = null;
    }
    if (
      mode === 'armed' &&
      !handle.contains(e.target) &&
      !marker?.contains(e.target) &&
      !groundAt(e.clientX, e.clientY)
    )
      cancel();
  }
  function clicks(e) {
    if (!suppressed || performance.now() > suppressed.until) return;
    if (e.detail === 0 && !e.pointerType && !e.sourceCapabilities?.firesTouchEvents) return;
    const sameSpot = Math.hypot(e.clientX - suppressed.x, e.clientY - suppressed.y) < 12;
    if (sameSpot || e.composedPath().includes(suppressed.source)) stop(e);
  }
  function keys(e) {
    if (e.key === 'Escape' && (mode !== 'idle' || gesture)) {
      stop(e);
      cancel();
      handle.focus({preventScroll: true});
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') suppressed = null;
  }
  function activateClick(e) {
    stop(e);
    activate(e.currentTarget);
  }
  function activateKey(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    stop(e);
    if (!e.repeat) activate(e.currentTarget);
  }
  function blockMapGesture(e) {
    // MapLibre's pan handlers also listen for legacy touch and mouse events.
    // Contain them at their source for drags that start on the person.
    e.stopPropagation();
  }
  function bindSource(node, isMarker) {
    const oldTouch = node.style.touchAction,
      oldPointer = node.style.pointerEvents;
    const attrs = new Map(
      ['role', 'tabindex', 'aria-label', 'aria-pressed', 'title'].map((key) => [
        key,
        node.getAttribute(key),
      ]),
    );
    node.style.touchAction = 'none';
    node.style.pointerEvents = 'auto';
    if (node.tagName !== 'BUTTON') {
      node.tabIndex = 0;
      node.setAttribute('role', 'button');
    }
    if (isMarker && !node.hasAttribute('aria-label'))
      node.setAttribute('aria-label', 'Move observer');
    node.setAttribute('aria-pressed', String(mode !== 'idle'));
    const handlers = [
      ['pointerdown', onDown],
      ['lostpointercapture', onCancel],
      ['click', activateClick],
      ['keydown', activateKey],
      ['dragstart', stop],
      ['mousedown', blockMapGesture],
      ['touchstart', blockMapGesture],
      ['touchmove', blockMapGesture],
      ['touchend', blockMapGesture],
    ];
    for (const [event, fn] of handlers) node.addEventListener(event, fn);
    return () => {
      if (gesture?.source === node) cancel();
      for (const [event, fn] of handlers) node.removeEventListener(event, fn);
      node.style.touchAction = oldTouch;
      node.style.pointerEvents = oldPointer;
      for (const [key, value] of attrs) {
        if (value === null) node.removeAttribute(key);
        else node.setAttribute(key, value);
      }
    };
  }
  function connectMarker(node) {
    if (node === marker) {
      sync();
      return;
    }
    removeMarker?.();
    marker = node;
    removeMarker = node ? bindSource(node, true) : null;
    sync();
  }
  function consumeMapPick(ground) {
    if (gesture || (suppressed && performance.now() <= suppressed.until)) return true;
    if (mode !== 'armed') return false;
    if (
      ground &&
      Number.isFinite(ground.lat) &&
      Number.isFinite(ground.lon) &&
      Math.abs(ground.lat) <= 85.05112878
    ) {
      onPlace({lat: ground.lat, lon: wrap(ground.lon), name: '', region: ''});
      setMode('idle');
      sync();
    }
    return true;
  }
  const removeHandle = bindSource(handle, false);
  sync();
  const globalHandlers = [
    ['pointerdown', onPointerStart],
    ['pointermove', onMove],
    ['pointerup', onUp],
    ['pointercancel', onCancel],
    ['click', clicks],
    ['keydown', keys],
    ['blur', cancel],
  ];
  for (const [event, fn] of globalHandlers)
    window.addEventListener(event, fn, {capture: event !== 'blur', passive: false});
  function destroy() {
    cancel();
    connectMarker(null);
    removeHandle();
    for (const [event, fn] of globalHandlers)
      window.removeEventListener(event, fn, event !== 'blur');
  }
  return {
    connectMarker,
    consumeMapPick,
    cancel,
    sync,
    destroy,
    isActive: () => mode !== 'idle' || !!gesture,
  };
}
export default {bind};
