import * as maplibregl from 'maplibre-gl';

const EARTH_RADIUS = 6371008.8,
  RAD = Math.PI / 180;
const fmt = (n, d) =>
  n.toLocaleString('en-US', {minimumFractionDigits: d, maximumFractionDigits: d});
const wrap = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;
const stateNames = ['Hidden', 'Visible', 'Outside radius', 'Unknown'];
const stateColors = ['hidden', 'visible', 'outside', 'unknown'];
const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const finite = Number.isFinite;
function near(a, b, toleranceM) {
  const y = Math.sin(((b.lat - a.lat) * RAD) / 2),
    x = Math.sin((wrap(b.lon - a.lon) * RAD) / 2);
  return (
    y * y + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * x * x <=
    Math.sin(toleranceM / (2 * EARTH_RADIUS)) ** 2
  );
}
function color(status) {
  return stateColors[status] || 'neutral';
}
function stage(status) {
  if (Number.isInteger(status)) return stateNames[status] || 'Unknown';
  if (status === 'unplaced') return 'No observer';
  return 'Checking visibility…';
}
function make(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(cls, text, label) {
  const elem = make('button', cls, text);
  elem.type = 'button';
  if (label) elem.setAttribute('aria-label', label);
  return elem;
}
function shield(node) {
  // Native buttons retain click, keyboard and touch behaviour; gestures on this UI
  // must not also reach the map's native camera or picking handlers.
  for (const name of [
    'pointerdown',
    'mousedown',
    'touchstart',
    'touchend',
    'dblclick',
    'contextmenu',
    'keydown',
    'keyup',
  ]) {
    node.addEventListener(name, (e) => e.stopPropagation());
  }
  node.addEventListener('click', (e) => e.stopPropagation());
}
let instance = 0;
function attach(map, {onInspect, onPromote, onProfile, onRemove} = {}) {
  const entries = new Map();
  let selected = null,
    nextId = 1,
    nextNumber = 1;
  const prefix = 'tf-probe-' + ++instance + '-';
  const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    focusAfterOpen: false,
    subpixelPositioning: true,
    className: 'tf-probe-popup',
    maxWidth: 'min(268px, calc(100vw - 24px))',
    padding: {top: 56, right: 12, bottom: 26, left: 12},
    offset: {
      top: [0, 4],
      bottom: [0, -32],
      left: [14, -13],
      right: [-14, -13],
      'top-left': [6, 3],
      'top-right': [-6, 3],
      'bottom-left': [7, -29],
      'bottom-right': [-7, -29],
    },
  });
  const card = make('section', 'tf-probe-card');
  card.setAttribute('role', 'region');
  card.id = prefix + 'card';
  const head = make('div', 'tf-probe-head'),
    badge = make('span', 'tf-probe-index');
  badge.setAttribute('aria-hidden', 'true');
  const title = make('h2', 'tf-probe-title');
  title.id = prefix + 'heading';
  card.setAttribute('aria-labelledby', title.id);
  const closeButton = button('tf-probe-close', '×', 'Close point details');
  head.append(badge, title, closeButton);
  const location = make('p', 'tf-probe-location');
  const visibility = make('p', 'tf-probe-status');
  visibility.setAttribute('aria-live', 'polite');
  const facts = make('dl', 'tf-probe-facts');
  function fact(label) {
    const row = make('div', 'tf-probe-fact'),
      term = make('dt', '', label),
      value = make('dd');
    row.append(term, value);
    facts.append(row);
    return {row, value};
  }
  const dist = fact('Distance'),
    az = fact('Bearing'),
    elev = fact('Terrain elevation'),
    cell = fact('Additional height in cell');
  const note = make('p', 'tf-probe-note');
  const actions = make('div', 'tf-probe-actions');
  const promote = button('tf-probe-promote', 'Place observer here');
  const profileButton = button('tf-probe-promote', 'View profile');
  if (onProfile) actions.append(profileButton);
  if (onPromote) actions.append(promote);
  const drop = button('tf-probe-remove', 'Remove', 'Remove this point from the map');
  actions.append(drop);
  card.append(head, location, visibility, facts, note, actions);
  shield(card);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    }
  });
  popup.setDOMContent(card);
  function refresh(entry) {
    const {point, button: pin, result} = entry;
    const status = result.status,
      shade = color(status),
      label = result.reason === 'sector' ? 'Outside sector' : stage(status);
    const name = point.name
      ? 'Point ' + point.number + ' · ' + point.name
      : 'Point ' + point.number;
    pin.dataset.state = shade;
    pin.setAttribute('aria-label', name + '. ' + label + '. Show details');
    if (selected !== point.id) return;
    card.dataset.state = shade;
    title.textContent = point.name || 'Point ' + point.number;
    badge.textContent = String(point.number);
    location.textContent =
      fmt(Math.abs(point.lat), 4) +
      '° ' +
      (point.lat < 0 ? 'S' : 'N') +
      ' · ' +
      fmt(Math.abs(point.lon), 4) +
      '° ' +
      (point.lon < 0 ? 'W' : 'E');
    visibility.textContent = label;
    const haveObserver = status !== 'unplaced';
    dist.row.hidden = az.row.hidden = !haveObserver;
    dist.value.textContent = !finite(result.distance)
      ? '—'
      : result.distance < 1000
        ? fmt(result.distance, 0) + ' m'
        : fmt(result.distance / 1000, 2) + ' km';
    const bearing = finite(result.bearing) ? ((result.bearing % 360) + 360) % 360 : null;
    const degrees = bearing === null ? null : Math.round(bearing) % 360;
    az.value.textContent =
      degrees === null ? '—' : dirs[Math.round(bearing / 45) % 8] + ' · ' + degrees + '°';
    elev.value.textContent = finite(result.elevation) ? fmt(result.elevation, 0) + ' m' : '—';
    profileButton.hidden = !(status === 0 || status === 1 || status === 3);
    let message = result.message || '';
    if (Number.isFinite(result.additionalObserverHeightM) && result.additionalObserverHeightM > 0)
      message =
        'To see this point, raise the observer by about ' +
        fmt(result.additionalObserverHeightM, 1) +
        ' m.';
    else if (result.status === 0 && Number.isFinite(result.lowerBoundM))
      message = 'Terrain data is incomplete. The required observer height is unknown.';
    cell.row.hidden = !(result.heightMode && result.cell);
    cell.value.textContent = finite(result.cell?.additionalObserverHeightM)
      ? fmt(result.cell.additionalObserverHeightM, 1) + ' m'
      : 'Unknown';
    note.textContent = message;
    note.hidden = !note.textContent;
  }
  function close(returnFocus = false) {
    const entry = entries.get(selected);
    selected = null;
    if (entry) entry.button.setAttribute('aria-expanded', 'false');
    if (popup.isOpen()) popup.remove();
    if (returnFocus && entry?.button.isConnected) entry.button.focus({preventScroll: true});
  }
  closeButton.addEventListener('click', () => close(true));
  profileButton.onclick = () => {
    const p = entries.get(selected)?.point;
    if (p) onProfile(p);
  };
  promote.addEventListener('click', () => {
    const p = entries.get(selected)?.point;
    if (p) {
      close();
      onPromote?.(p);
    }
  });
  drop.addEventListener('click', () => {
    if (selected !== null) {
      remove(selected);
      map.getCanvas().focus({preventScroll: true});
    }
  });
  popup.on('close', () => {
    entries.get(selected)?.button.setAttribute('aria-expanded', 'false');
    selected = null;
  });
  function inspect(id, fromKeyboard = false) {
    const entry = entries.get(id);
    if (!entry) return null;
    const old = entries.get(selected);
    if (old && old !== entry) old.button.setAttribute('aria-expanded', 'false');
    const {point, button: pin} = entry;
    selected = id;
    pin.setAttribute('aria-expanded', 'true');
    refresh(entry);
    const lng = point.lon + 360 * Math.round((map.getCenter().lng - point.lon) / 360);
    popup.setLngLat([lng, point.lat]);
    if (!popup.isOpen()) popup.addTo(map);
    if (fromKeyboard) closeButton.focus({preventScroll: true});
    onInspect?.(point);
    return point;
  }
  function add(p) {
    if (!p || !finite(p.lat) || !finite(p.lon) || Math.abs(p.lat) > 85.051129) return null;
    const pos = {lat: p.lat, lon: wrap(p.lon)};
    // At an overview scale, taps on the same place can be metres apart.
    // Up close, keep separate targets even a step apart from one another.
    const metresPerPixel =
      (2 * Math.PI * EARTH_RADIUS * Math.cos(pos.lat * RAD)) / (512 * 2 ** map.getZoom());
    const toleranceM = Math.min(20, 5 * metresPerPixel);
    for (const {point} of entries.values()) {
      if (p.peakId ? point.peakId === p.peakId : near(pos, point, toleranceM))
        return inspect(point.id);
    }
    const id = nextId++,
      number = nextNumber++,
      point = Object.freeze({
        ...pos,
        id,
        number,
        peakId: p.peakId ?? null,
        name: typeof p.name === 'string' ? p.name.trim() : '',
      });
    const pin = button('tf-probe-pin', '');
    pin.id = prefix + id;
    pin.setAttribute('aria-expanded', 'false');
    pin.setAttribute('aria-controls', card.id);
    pin.append(make('span', 'tf-probe-pin-number', String(number)));
    shield(pin);
    pin.addEventListener('click', (e) => inspect(id, e.detail === 0));
    const marker = new maplibregl.Marker({
      element: pin,
      anchor: 'bottom',
      subpixelPositioning: true,
      opacityWhenCovered: 0.63,
    });
    marker.setLngLat([point.lon, point.lat]).addTo(map);
    const entry = {point, marker, button: pin, result: {status: 'pending'}};
    entries.set(id, entry);
    return inspect(id);
  }
  function update(id, result) {
    const entry = entries.get(id);
    if (!entry || !result) return;
    entry.result = result;
    refresh(entry);
  }
  function invalidate(reinspect = true) {
    for (const entry of entries.values()) {
      entry.result = {status: 'pending'};
      refresh(entry);
    }
    const p = entries.get(selected)?.point;
    if (reinspect && p) onInspect?.(p);
  }
  function remove(id) {
    const entry = entries.get(id);
    if (!entry) return;
    if (selected === id) close();
    entry.marker.remove();
    entries.delete(id);
    onRemove?.(entry.point);
  }
  function clear() {
    close();
    for (const entry of entries.values()) entry.marker.remove();
    entries.clear();
    nextNumber = 1;
  }
  map.on('remove', clear);
  return {
    add,
    update,
    inspect,
    close,
    remove,
    clear,
    invalidate,
    get: (id) => entries.get(id)?.point || null,
    active: () => entries.get(selected)?.point || null,
    values: () => Array.from(entries.values(), (e) => e.point),
  };
}
export default {attach};
