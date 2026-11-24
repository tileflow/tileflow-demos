import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import {makeMap} from './map.js';
import {helsinkiTimeOfDay} from './daylight.js';
import {choosePattern, move, progress as tripOffset, samplePose, upcoming} from './transit.js';
import {isNobinaU12} from './u12-model.js';
import {distance, networkTrack, routePreview} from './route-track.js';
import {trackDetail} from './door-feed.js';
import {platformInfo, vehicleAtStop, callForBus, matchesService} from './stop-call.js';
import {statusIcon} from './stop-card.js';

const $ = (id) => document.getElementById(id);
const escape = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c],
  );
const fold = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Helsinki',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const now = () => Math.floor(Date.now() / 1000);
const time = (seconds) => timeFormat.format(new Date(seconds * 1000));
const eta = (seconds) => (seconds <= now() + 29 ? 'Now' : Math.round((seconds - now()) / 60) + ' min');
const vehicles = new Map(),
  predictions = new Map(),
  servedBy = new Map(),
  destinations = new Map();
const navigation = [];
let nearbyFix,
  locationStatus = '',
  nearestStops = [];
const stamps = {positions: 0, arrivals: 0},
  errors = {};
const freshArrivals = () => now() - stamps.arrivals < 75;
let amenities = {};
let network,
  view,
  timeOfDay,
  worker,
  selection = {kind: 'home'},
  door,
  following = false,
  showAll = false;
let lastGeometry,
  lastDetail,
  query = '',
  didStart = false,
  visibleFleet = [],
  lastCamera = 0;
const patternCache = new Map();
const locateIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg>';
const target = (kind, id) => 'data-kind="' + kind + '" data-id="' + escape(id) + '"';
const fitButton =
  '<button class="route-link" data-action="fit">Fit route <span aria-hidden="true">→</span></button>';
const badge = (n) => '<span class="route-tag">' + escape(n) + '</span>';
const empty = (s) => '<p class="empty">' + escape(s) + '</p>';
const row = (kind, id, contents, attributes = '') =>
  '<button class="row" ' + target(kind, id) + attributes + '>' + contents + '</button>';
const section = (title) => '<div class="section-head"><h3>' + escape(title) + '</h3></div>';
function caption(text, kind = 'network') {
  $('map-caption').textContent = text;
  $('map-key').dataset.kind = kind;
}
function expandDock(expanded) {
  $('detail').hidden = !expanded;
  $('fold').setAttribute('aria-expanded', String(expanded));
  $('fold').title = expanded ? 'Collapse details' : 'Expand details';
}
function clearSearch() {
  query = '';
  $('search').value = '';
  $('search-results').hidden = true;
}
function displayedPose(bus, time) {
  return samplePose(bus, time, bus.track && view?.align.covers(bus.coordinate) ? view.align : undefined);
}
function placeFix(previous, update, time) {
  const p = pattern(update);
  const track = networkTrack(network, p?.shape);
  return move(previous, update, time, {pattern: p, track});
}

function visible(time, bounds) {
  const extent = bounds.toArray(),
    results = [];
  for (const bus of visibleFleet) {
    if (!matchesDestination(bus)) continue;
    const [x, y] = bus.coordinate;
    if (
      x < extent[0][0] - 0.002 ||
      x > extent[1][0] + 0.002 ||
      y < extent[0][1] - 0.001 ||
      y > extent[1][1] + 0.001
    )
      continue;
    const selected = selection.kind === 'bus' && selection.id === bus.id;
    const pose = displayedPose(bus, time);
    results.push({
      id: bus.id,
      ...pose,
      onRoute: Boolean(bus.track) && !pose.uncertain,
      destination: selected ? titleFor(bus) : undefined,
      selected,
      stopped: bus.status === 1 && (bus.speed == null || bus.speed < 1),
      doors: selected && door?.key === bus.key && door.time > now() - 8 ? door.open : null,
      doorStop: selected && door?.open ? vehicleAtStop(bus, door, network.stops, now())?.id : undefined,
      wheelDistance: bus.track ? tripOffset(bus, time) : undefined,
      line: network.routes[bus.route].number,
    });
  }
  return results;
}
function pattern(item) {
  if (!item) return undefined;
  if (!patternCache.has(item.key))
    patternCache.set(
      item.key,
      choosePattern(
        network.routes[item.route],
        item.direction,
        predictions.get(item.key)?.stops.map((s) => s.id),
      ),
    );
  return patternCache.get(item.key);
}
function titleFor(item) {
  return pattern(item)?.headsign || network.routes[item.route].name;
}
function subscribeBus(id) {
  trackDetail(id, (reading, route) => {
    const current = vehicles.get(id);
    if (
      selection.kind !== 'bus' ||
      selection.id !== id ||
      !current ||
      current.route !== route ||
      Number(reading.dir) - 1 !== current.direction ||
      !matchesService(current.key, reading) ||
      !Number.isFinite(reading.tsi) ||
      Math.abs(now() - reading.tsi) > 35
    )
      return;
    if (
      (reading.drst === 0 || reading.drst === 1) &&
      (door?.key !== current.key || reading.tsi >= door.time)
    ) {
      door = {
        open: reading.drst === 1,
        time: reading.tsi,
        key: current.key,
        stopId: reading.stop && String(reading.stop),
      };
    }
    if (Number.isFinite(reading.long) && Number.isFinite(reading.lat)) {
      vehicles.set(
        id,
        placeFix(
          current,
          {
            ...current,
            precise: true,
            coordinate: [reading.long, reading.lat],
            timestamp: reading.tsi,
            bearing: reading.hdg ?? current.bearing,
            speed: reading.spd ?? current.speed,
          },
          performance.now(),
        ),
      );
      updateFleet();
    }
    updateGeometry();
    paint();
  }).catch(() => {});
}
function frameMap() {
  if (!view) return;
  const top = Math.round(document.querySelector('.map-top').getBoundingClientRect().bottom);
  const dockHeight = $('dock').getBoundingClientRect().height;
  const bottom = Math.min(Math.round(dockHeight + 32), Math.floor(innerHeight * 0.52));
  const padding = view.map.getPadding();
  if (padding.top !== top || padding.bottom !== bottom) view.map.setPadding({top, bottom, left: 0, right: 0});
}
function routeGroup() {
  return destinations.get(selection.id)[selection.destination];
}
function matchesDestination(bus) {
  if (selection.kind !== 'route') return true;
  const group = routeGroup();
  return bus.route === selection.id && bus.direction === group.direction && titleFor(bus) === group.headsign;
}
function busesToDestination() {
  return visibleFleet.filter(matchesDestination);
}
function shownPatterns() {
  if (selection.kind === 'bus') return [pattern(vehicles.get(selection.id))].filter(Boolean);
  const active = new Set(busesToDestination().map(pattern).filter(Boolean));
  return active.size ? [...active] : [routeGroup().patterns[0]];
}
function navigationLabel() {
  if (selection.kind === 'bus') {
    const b = vehicles.get(selection.id);
    return b ? network.routes[b.route].number + ' → ' + titleFor(b) : 'bus';
  }
  if (selection.kind === 'stop') return network.stops[selection.id].name;
  if (selection.kind === 'route') return network.routes[selection.id].number + ' → ' + routeGroup().headsign;
  return 'nearby stops';
}
function select(kind, id, camera = 'keep', options = {}) {
  if (!network) return;
  didStart = true;
  const restored = options.restore;
  if (kind === 'bus' && !vehicles.has(id) && !restored) return;
  const bus = kind === 'bus' ? vehicles.get(id) : null;
  const startup = camera === 'startup';
  const sameBus = bus && selection.kind === 'bus' && selection.id === id;
  if (options.root || kind === 'home' || kind === 'nearby') {
    if (!restored) navigation.length = 0;
  } else if (
    !restored &&
    view &&
    kind !== selection.kind &&
    ['stop', 'bus', 'route', 'nearby'].includes(selection.kind)
  ) {
    const m = view.map;
    navigation.push({
      selection,
      label: navigationLabel(),
      scroll: $('detail').scrollTop,
      showAll,
      camera: {
        center: m.getCenter(),
        zoom: m.getZoom(),
        pitch: m.getPitch(),
        bearing: m.getBearing(),
        padding: m.getPadding(),
      },
    });
    if (navigation.length > 12) navigation.shift();
  }
  const destination =
    options.destination ?? (selection.kind === 'route' && selection.id === id ? selection.destination : 0);
  selection = restored?.selection ?? {
    kind,
    id,
    destination,
    fullTrip: Boolean(bus && !startup),
    originStop:
      options.originStop ?? (sameBus && bus.key === selection.tripKey ? selection.originStop : undefined),
    tripKey: bus?.key,
  };
  following = Boolean(bus && startup);
  showAll = restored?.showAll ?? false;
  if (!sameBus) door = null;
  clearSearch();
  expandDock(true);
  lastGeometry = null;
  if (!sameBus) subscribeBus(bus?.id ?? null);
  if (kind !== 'bus') view?.label(null);
  if (kind === 'home') caption('Bus network');
  if (kind === 'nearby') {
    if (!restored) nearbyFix = null;
    locationStatus = '';
    refreshNearby();
    caption('Nearby stops', 'stop');
  }
  updateGeometry();
  draw();
  lastPreviewUpdate = -Infinity;
  drawPreviews(performance.now());
  paint();
  $('detail').scrollTop = restored?.scroll ?? 0;
  if (restored) {
    view.map.stop();
    view.map.jumpTo(restored.camera);
    return;
  }
  if (camera === 'inPlace' || (camera === 'keep' && (bus || kind === 'route' || kind === 'nearby'))) {
    view?.map.stop();
    return;
  }
  frameMap();
  if (bus && startup) view?.fly(displayedPose(bus, performance.now()).coordinate, 17.9, true);
  if (kind === 'stop') view?.fly(network.stops[id].coordinate, 17);
  if (kind === 'home') view?.fly([24.922, 60.174], 12.7);
}
function detach() {
  if (selection.kind === 'nearby') {
    nearbyFix = null;
    locationStatus = '';
  }
  if (following) {
    following = false;
    paint();
  }
}
function updateFleet() {
  visibleFleet = [...vehicles.values()].filter((b) => now() - b.timestamp < 90);
}
function draw() {
  if (!view) return;
  view.drawVehicles(
    visibleFleet.filter(matchesDestination).map((bus) => {
      const pose = displayedPose(bus, performance.now());
      return {
        id: bus.id,
        line: network.routes[bus.route].number,
        coordinate: pose.coordinate,
        onRoute: Boolean(bus.track) && !pose.uncertain,
        selected: selection.kind === 'bus' && selection.id === bus.id,
        routeSelected: selection.kind === 'route',
        secondary: selection.kind === 'bus' && selection.id !== bus.id,
      };
    }),
  );
}
let lastPreviewUpdate = -Infinity;
function drawPreviews(t) {
  if (!view || t - lastPreviewUpdate < 600) return;
  lastPreviewUpdate = t;
  const items = [];
  const map = view.map;
  if (selection.kind === 'bus' && selection.fullTrip) {
    const bus = vehicles.get(selection.id);
    const track = bus?.track;
    view.tripProgress(track, track ? tripOffset(bus, t) : 0);
  }
  if (map.getZoom() >= 11.5) {
    const bounds = map.getBounds();
    const align = map.getZoom() >= 15 ? view.align : undefined;
    for (const bus of visibleFleet) {
      if (
        !matchesDestination(bus) ||
        !bus.track ||
        now() - bus.timestamp > 30 ||
        !bounds.contains(bus.coordinate)
      )
        continue;
      if (selection.fullTrip && selection.id === bus.id && pattern(bus)?.shape) continue;
      const path = routePreview(bus.track, tripOffset(bus, t), 100, align);
      if (path.length > 1)
        items.push({id: bus.id, selected: selection.kind === 'bus' && selection.id === bus.id, path});
    }
  }
  view.drawPreviews(items);
}
function startSelection() {
  if (!view || didStart || !visibleFleet.length) return;
  const fresh = visibleFleet.filter((b) => now() - b.timestamp < 30);
  const u12On21 = fresh.filter((b) => b.track && b.route === '1021' && isNobinaU12(b.id));
  const recent = u12On21.length ? u12On21 : fresh;
  if (!recent.length) return;
  const score = (b) =>
    Math.hypot((b.coordinate[0] - 24.9025) * 0.5, b.coordinate[1] - 60.163) +
    (b.route === '1021' ? 0 : 0.045) +
    (b.speed > 1 ? 0 : 0.002);
  const closest = recent.reduce((a, b) => (score(a) < score(b) ? a : b));
  select('bus', closest.id, 'startup');
}
function updateGeometry() {
  if (!view || !network) return;
  const {kind, id} = selection;
  let patterns = [],
    ids = [],
    progress,
    call;
  if (kind === 'bus') {
    const bus = vehicles.get(id),
      p = pattern(bus);
    if (p) {
      const trip = freshArrivals() ? predictions.get(bus.key) : null;
      const start = p.stops.indexOf(bus.stopId);
      const remaining = trip
        ? upcoming(trip.stops, now()).map((s) => s.id)
        : p.stops.slice(Math.max(0, start));
      patterns = selection.fullTrip ? [p] : [];
      ids = selection.fullTrip ? p.stops : remaining;
      const track = bus.track;
      const offset = track && track.line === network.shapes[p.shape] ? tripOffset(bus, performance.now()) : 0;
      const ahead = new Set(p.stops.filter((stop, i) => (p.stopOffsets?.[i] ?? Infinity) >= offset - 4));
      call = callForBus(bus, p, remaining, door, network.stops, now());
      if (call) call.line = network.routes[bus.route].number;
      progress = {
        currentStop: call?.id,
        passedStops: p.stops.filter((stop) => !ahead.has(stop)),
      };
      caption(
        'Route ' + network.routes[bus.route].number + ' · ' + titleFor(bus),
        selection.fullTrip ? 'route' : 'bus',
      );
    } else caption(bus ? 'Route ' + network.routes[bus.route].number : 'Bus signal lost', 'bus');
  } else if (kind === 'route') {
    patterns = shownPatterns();
    ids = patterns.flatMap((p) => p.stops);
    caption('Route ' + network.routes[id].number + ' · ' + routeGroup().headsign, 'route');
  } else if (kind === 'stop') {
    ids = [id];
    call = {id};
    caption('Stop · ' + network.stops[id].name, 'stop');
  } else if (kind === 'nearby') {
    ids = nearestStops.map((s) => s.id);
  }
  const key = JSON.stringify([
    kind,
    id,
    patterns.map((p) => p.shape),
    ids,
    progress?.passedStops,
    progress?.currentStop,
    call,
  ]);
  if (key !== lastGeometry) {
    lastGeometry = key;
    const routeId = kind === 'bus' ? vehicles.get(id)?.route : kind === 'route' ? id : undefined;
    view.geometry(patterns, ids, progress, routeId, call);
    if (selection.fullTrip) {
      const bus = vehicles.get(id);
      if (bus?.track) view.tripProgress(bus.track, tripOffset(bus, performance.now()));
    }
  }
}
function feedMessage({data: {name, data, timestamp, error}}) {
  errors[name] = Boolean(error);
  if (error) {
    paint();
    return;
  }
  if (timestamp < stamps[name]) return;
  stamps[name] = timestamp;
  if (name === 'positions') {
    const seen = new Set();
    for (const v of data) {
      if (now() - v.timestamp > 90) continue;
      seen.add(v.id);
      const previous = vehicles.get(v.id);
      const fix = placeFix(previous, {...v, statusTime: v.timestamp}, performance.now());
      // A newer HFP location can arrive before this GTFS report carries its new stop.
      if (fix === previous && previous.precise && v.timestamp >= (previous.statusTime ?? 0)) {
        vehicles.set(v.id, {
          ...previous,
          stopId: v.stopId,
          stopSequence: v.stopSequence,
          status: v.status,
          statusTime: v.timestamp,
        });
      } else vehicles.set(v.id, fix);
    }
    for (const [id, v] of vehicles)
      if (!seen.has(id) && (selection.kind !== 'bus' || selection.id !== id || now() - v.timestamp > 120))
        vehicles.delete(id);
    updateFleet();
    draw();
    startSelection();
  } else {
    predictions.clear();
    patternCache.clear();
    for (const trip of data) predictions.set(trip.key, trip);
  }
  updateGeometry();
  paint();
}
function stopRow(id, at, highlight) {
  const s = network.stops[id];
  const name =
    '<span class="dot' +
    (highlight ? ' highlighted' : '') +
    '"></span><span class="name">' +
    escape(s?.name || id) +
    '</span><span class="eta">' +
    (at ? eta(at) : '—') +
    '</span>';
  return s ? row('stop', id, name) : '<div class="row">' + name + '</div>';
}
function busDetail(id) {
  const b = vehicles.get(id);
  if (!b || now() - b.timestamp > 90)
    return section('Bus signal lost') + empty('HSL is no longer reporting this vehicle’s location.');
  const route = network.routes[b.route],
    p = pattern(b),
    trip = freshArrivals() ? predictions.get(b.key) : null;
  const live = trip ? upcoming(trip.stops, now()) : [];
  const platform = vehicleAtStop(b, door, network.stops, now());
  const atStop = Boolean(platform);
  const open = platform?.state === 'doors';
  const stopName = network.stops[platform?.id]?.name;
  const status =
    now() - b.timestamp > 20
      ? 'Delayed signal'
      : open
        ? 'Doors open'
        : atStop
          ? 'At stop'
          : b.status === 0
            ? 'Approaching stop'
            : b.speed != null && b.speed < 0.5
              ? 'Stopped'
              : 'In service';
  const dir = titleFor(b);
  const pos = p?.stops.indexOf(b.stopId) ?? -1;
  const scheduleStops = pos >= 0 ? p.stops.slice(pos) : [];
  const rows = trip ? live.map((s) => [s.id, s.arrival || s.departure]) : scheduleStops.map((s) => [s, 0]);
  const next = rows[0];
  const namedPlatform = atStop && next?.[0] === platform.id;
  const details = [];
  if (!atStop) details.push(status);
  if (atStop && stopName && !namedPlatform) details.push(stopName);
  if (b.speed != null && !(namedPlatform && b.speed < 0.5)) details.push(Math.round(b.speed * 3.6) + ' km/h');
  const boarding = selection.tripKey === b.key && selection.originStop;
  const call = boarding && live.find((s) => s.id === boarding);
  const report = boarding && trip?.stops.find((s) => s.id === boarding);
  const boardingTime = call
    ? eta(call.departure || call.arrival)
    : report?.skipped
      ? 'Skipped'
      : report?.passed
        ? 'Departed'
        : 'Live time unavailable';
  const nextLine =
    next && boarding !== next[0]
      ? '<div class="next-call"><span>' +
        (atStop && next[0] === platform.id ? 'At stop' : 'Next') +
        '</span> ' +
        escape(network.stops[next[0]]?.name ?? next[0]) +
        (next[1] ? ' · ' + eta(next[1]) : '') +
        '</div>'
      : '';
  const boardingLine = boarding
    ? '<div class="boarding-call"><span>' +
      (next?.[0] === boarding
        ? atStop && boarding === platform.id
          ? 'At your stop'
          : 'Your stop is next'
        : 'Your stop') +
      '</span> ' +
      escape(network.stops[boarding].name) +
      ' · ' +
      boardingTime +
      '</div>'
    : '';
  return (
    '<div class="ride-layout"><article class="ride-card"><div class="route-heading">' +
    badge(route.number) +
    '<h2>' +
    escape(dir) +
    '</h2></div>' +
    boardingLine +
    nextLine +
    '<div class="vehicle-type">Bus ' +
    escape(id.split('/').at(-1)) +
    (isNobinaU12(id) ? ' · Nobina Yutong U12' : ' · Representative HSL model') +
    '</div>' +
    (platform
      ? '<span class="boarding-status">' +
        statusIcon(platform.state) +
        (open ? 'Doors open' : 'At stop') +
        '</span>'
      : '') +
    (details.length ? '<div class="status-text">' + escape(details.join(' · ')) + '</div>' : '') +
    '<div class="actions"><button class="action ' +
    (following ? 'active' : '') +
    '" data-action="follow" aria-pressed="' +
    following +
    '">' +
    locateIcon +
    (following ? 'Following' : 'Follow') +
    '</button>' +
    (b.track ? '<button class="action" data-action="closeup">Street view</button>' : '') +
    '</div></article><section class="itinerary" aria-label="Itinerary">' +
    '<div class="itinerary-top">' +
    section('Upcoming stops') +
    (p ? fitButton : '') +
    '</div>' +
    (rows.length
      ? '<div class="timeline">' +
        rows
          .slice(0, showAll ? Infinity : 5)
          .map(([s, a]) => stopRow(s, a, s === (platform?.id ?? rows[0][0])))
          .join('') +
        '</div>'
      : empty(
          trip
            ? 'No more arrivals are expected on this trip.'
            : 'HSL has not published arrivals for this trip yet.',
        )) +
    (rows.length > 5
      ? '<button class="back" data-action="more">' +
        (showAll ? 'Show less' : 'Show all ' + rows.length + ' stops') +
        '</button>'
      : '') +
    (!trip && rows.length ? empty('Scheduled route · live times pending.') : '') +
    '<div class="data-note">Last location · ' +
    Math.max(0, now() - b.timestamp) +
    (b.track ? ' s' : ' s · GPS outside the matched route') +
    (open ? ' · Illustrative passengers' : '') +
    '</div></section></div>'
  );
}
function activeRow(b) {
  return row(
    'bus',
    b.id,
    badge(network.routes[b.route].number) +
      '<span class="name">' +
      escape(titleFor(b)) +
      '<small>Bus ' +
      escape(b.id.split('/').at(-1)) +
      '</small></span>',
  );
}
function routeDetail(id) {
  const r = network.routes[id],
    groups = destinations.get(id);
  const buses = busesToDestination(),
    patterns = shownPatterns();
  const sequences = new Map(patterns.map((p) => [p.stops.join('|'), p.stops]));
  const stops = [...sequences.values()]
    .map(
      (ids, i) =>
        (sequences.size > 1 ? section('Stopping pattern ' + (i + 1)) : '') +
        ids
          .filter((s) => network.stops[s])
          .map((id) =>
            row(
              'stop',
              id,
              '<span class="dot"></span><span class="name">' + escape(network.stops[id].name) + '</span>',
            ),
          )
          .join(''),
    )
    .join('');
  const directions = groups
    .map(
      (g, i) =>
        '<button class="direction" data-action="direction" data-id="' +
        i +
        '" aria-pressed="' +
        (i === selection.destination) +
        '">To ' +
        escape(g.headsign) +
        '</button>',
    )
    .join('');
  return (
    '<div class="board-layout"><div class="board-intro"><div class="itinerary-top"><div class="route-heading"><h2>Route ' +
    badge(r.number) +
    '</h2></div>' +
    fitButton +
    '</div><div class="directions" role="group" aria-label="Route destination">' +
    directions +
    '</div>' +
    section('Buses in service') +
    (buses.length ? buses.map(activeRow).join('') : empty('No recent vehicle locations on this route.')) +
    '</div><section class="board-list"><div class="itinerary-top">' +
    section('Stops') +
    '</div>' +
    stops +
    '</section></div>'
  );
}
function stopDetail(id) {
  const s = network.stops[id],
    arrivals = [];
  if (freshArrivals()) {
    for (const t of predictions.values()) {
      for (const call of upcoming(t.stops, now()))
        if (call.id === id) arrivals.push({t, at: call.departure || call.arrival});
    }
  }
  arrivals.sort((a, b) => a.at - b.at);
  const byTrip = new Map(visibleFleet.map((b) => [b.key, b]));
  return (
    '<div class="board-layout"><div class="board-intro"><div class="eyebrow">Stop ' +
    escape(s.code) +
    '</div><h2 class="stop-heading">' +
    escape(s.name) +
    '</h2>' +
    '<div class="platform-facts">' +
    escape(platformInfo(s, amenities[id]).join(' · ')) +
    '</div>' +
    '<div class="route-info">Routes ' +
    escape((servedBy.get(id) ?? []).map((r) => network.routes[r].number).join(' · ')) +
    '</div>' +
    '</div><section class="board-list">' +
    section('Upcoming departures') +
    (arrivals.length
      ? arrivals
          .slice(0, 15)
          .map(({t, at}) => {
            const b = byTrip.get(t.key);
            return row(
              b ? 'bus' : 'route',
              b?.id ?? t.route,
              badge(network.routes[t.route].number) +
                '<span class="name">' +
                escape(titleFor(t)) +
                '<small>' +
                time(at) +
                (b ? ' · estimated' : ' · estimated · route only') +
                '</small></span><span class="eta">' +
                eta(at) +
                '</span>',
              b
                ? ''
                : ' data-destination="' +
                    Math.max(
                      0,
                      destinations
                        .get(t.route)
                        .findIndex((g) => g.direction === t.direction && g.headsign === titleFor(t)),
                    ) +
                    '"',
            );
          })
          .join('')
      : empty(
          freshArrivals()
            ? 'No live departures listed for this stop.'
            : 'Waiting for live predictions from HSL.',
        )) +
    '<div class="data-note"><a class="link" href="https://reittiopas.hsl.fi/pysakit/HSL%3A' +
    encodeURIComponent(id) +
    '?locale=en" target="_blank" rel="noreferrer">Stop timetable on HSL ↗</a></div></section></div>'
  );
}
function routeRow(id) {
  const r = network.routes[id];
  return row('route', id, badge(r.number) + '<span class="name">' + escape(r.name) + '</span>');
}
function stopHint(id) {
  const services = servedBy.get(id) ?? [];
  const hints = [];
  for (const route of services) {
    for (const g of destinations.get(route)) {
      if (g.patterns.some((p) => p.stops.slice(0, -1).includes(id))) {
        hints.push(network.routes[route].number + ' → ' + g.headsign);
      }
      if (hints.length === 2) return hints.join(' · ');
    }
  }
  return hints.length
    ? hints.join(' · ')
    : services
        .map((r) => network.routes[r].number)
        .slice(0, 3)
        .join(' · ');
}
function stopResult(id, metres) {
  const s = network.stops[id],
    hint = stopHint(id);
  const meta = s.code + (hint ? ' · ' + hint : '');
  return row(
    'stop',
    id,
    '<span class="name">' +
      escape(s.name) +
      '<small>' +
      escape(meta) +
      '</small></span>' +
      (metres === undefined ? '' : '<span class="eta">' + Math.round(metres) + ' m</span>'),
  );
}
function refreshNearby() {
  const center = nearbyFix ?? view?.map.getCenter().toArray() ?? [24.922, 60.174];
  nearestStops = [];
  for (const [id, s] of Object.entries(network.stops)) {
    if (Math.abs(s.coordinate[0] - center[0]) > 0.04 || Math.abs(s.coordinate[1] - center[1]) > 0.02)
      continue;
    const metres = distance(center, s.coordinate);
    if (metres <= 2000) nearestStops.push({id, metres});
  }
  nearestStops.sort((a, b) => a.metres - b.metres);
  nearestStops = nearestStops.slice(0, 8);
}
function nearbyDetail() {
  return (
    '<div class="itinerary-top">' +
    section(nearbyFix ? 'Near your location' : 'Near the map centre') +
    '<button class="route-link" data-action="locate">Use my location</button></div>' +
    (locationStatus ? '<p class="data-note" role="status">' + escape(locationStatus) + '</p>' : '') +
    (nearestStops.length
      ? nearestStops.map((s) => stopResult(s.id, s.metres)).join('')
      : empty('No HSL bus stops within 2 km. Move the map to another area.'))
  );
}
function locateNearby() {
  const requested = selection;
  if (!navigator.geolocation) {
    locationStatus = 'Location unavailable. Showing stops near the map centre.';
    paint();
    return;
  }
  locationStatus = 'Finding your location…';
  paint();
  navigator.geolocation.getCurrentPosition(
    ({coords}) => {
      if (selection !== requested) return;
      nearbyFix = [coords.longitude, coords.latitude];
      refreshNearby();
      if (nearestStops.length) {
        locationStatus = '';
        view?.map.easeTo({center: nearbyFix, zoom: 15, duration: 500});
      } else {
        nearbyFix = null;
        refreshNearby();
        locationStatus = 'No HSL stops within 2 km of your location. Showing the map area.';
      }
      updateGeometry();
      paint();
    },
    () => {
      if (selection !== requested) return;
      nearbyFix = null;
      refreshNearby();
      updateGeometry();
      locationStatus = 'Location unavailable. Showing stops near the map centre.';
      paint();
    },
    {timeout: 8000, maximumAge: 60000},
  );
}
function searchResults() {
  const term = fold(query.trim()),
    routes = Object.keys(network.routes).filter(
      (id) =>
        fold(network.routes[id].number).startsWith(term) || fold(network.routes[id].name).includes(term),
    );
  routes.sort(
    (a, b) =>
      Number(fold(network.routes[b].number) === term) - Number(fold(network.routes[a].number) === term),
  );
  const stops = Object.entries(network.stops)
    .filter(([, s]) => fold(s.name).includes(term) || fold(s.code).includes(term))
    .slice(0, 18);
  return (
    (routes.length ? section('Routes') + routes.slice(0, 12).map(routeRow).join('') : '') +
    (stops.length ? section('Stops') + stops.map(([id]) => stopResult(id)).join('') : '') +
    (!routes.length && !stops.length ? empty('No matching routes or stops.') : '')
  );
}
function home() {
  const center = view?.position() ?? {lng: 24.92, lat: 60.17};
  const distance = (b) => Math.hypot((b.coordinate[0] - center.lng) * 0.5, b.coordinate[1] - center.lat);
  const nearest = [...visibleFleet].sort((a, b) => distance(a) - distance(b)).slice(0, 8);
  return (
    '<div class="board-layout"><section>' +
    section('Nearby buses') +
    (nearest.length
      ? nearest.map(activeRow).join('')
      : empty('No recent bus locations. Browse the routes and stops.')) +
    '</section><section class="board-list">' +
    section('Helsinki routes') +
    ['1021', '1022', '2105']
      .filter((id) => network.routes[id])
      .map(routeRow)
      .join('') +
    '</section></div>'
  );
}
function paint() {
  $('clock').textContent = time(now());
  const age = now() - stamps.positions;
  const ok = age < 20 && !errors.positions;
  $('live').classList.toggle('on', ok);
  $('live').textContent = ok
    ? 'Live'
    : stamps.positions
      ? age < 90
        ? 'Updating'
        : 'No signal'
      : errors.positions
        ? 'No signal'
        : 'Connecting';
  if (!network) return;
  const back = navigation.length
    ? '<button class="return-link" data-action="back">← Back to ' +
      escape(navigation.at(-1).label) +
      '</button>'
    : '';
  const content =
    selection.kind === 'bus'
      ? busDetail(selection.id)
      : selection.kind === 'route'
        ? routeDetail(selection.id)
        : selection.kind === 'stop'
          ? stopDetail(selection.id)
          : selection.kind === 'nearby'
            ? nearbyDetail()
            : home();
  const html = back + content;
  if (html === lastDetail) return;
  const detail = $('detail'),
    focused = document.activeElement;
  const focusKey = detail.contains(focused)
    ? [focused.dataset.kind, focused.dataset.id, focused.dataset.action]
    : null;
  detail.innerHTML = html;
  lastDetail = html;
  if (focusKey) {
    [...detail.querySelectorAll('button')]
      .find(
        (e) =>
          e.dataset.kind === focusKey[0] && e.dataset.id === focusKey[1] && e.dataset.action === focusKey[2],
      )
      ?.focus({preventScroll: true});
  }
}
function animate(t) {
  drawPreviews(t);
  if (view && selection.kind === 'bus') {
    const bus = vehicles.get(selection.id);
    if (bus && now() - bus.timestamp < 90) {
      const pos = displayedPose(bus, t).coordinate;
      view.label(bus, pos, titleFor(bus));
      if (following && !view.map.isMoving() && t - lastCamera >= 32) {
        const center = view.map.getCenter();
        if (view.map.project(pos).dist(view.map.project(center)) > 0.6) {
          const ease = 1 - Math.exp(-(t - lastCamera) / 75);
          view.map.setCenter([
            center.lng + (pos[0] - center.lng) * ease,
            center.lat + (pos[1] - center.lat) * ease,
          ]);
        }
        lastCamera = t;
      }
    } else view.label(null);
  }
  requestAnimationFrame(animate);
}
$('detail').addEventListener('click', (e) => {
  const el = e.target.closest('button');
  if (!el) return;
  if (el.dataset.kind)
    select(el.dataset.kind, el.dataset.id, 'keep', {
      originStop: selection.kind === 'stop' && el.dataset.kind === 'bus' ? selection.id : undefined,
      destination: el.dataset.destination === undefined ? undefined : Number(el.dataset.destination),
    });
  if (el.dataset.action === 'direction')
    select('route', selection.id, 'keep', {destination: Number(el.dataset.id)});
  if (el.dataset.action === 'back') {
    const previous = navigation.pop();
    if (previous) select(previous.selection.kind, previous.selection.id, 'restore', {restore: previous});
  }
  if (el.dataset.action === 'locate') locateNearby();
  if (el.dataset.action === 'fit' && view) {
    following = false;
    if (selection.kind === 'bus') selection.fullTrip = true;
    updateGeometry();
    frameMap();
    view.fit(shownPatterns());
    paint();
  }
  if (el.dataset.action === 'more') {
    showAll = !showAll;
    paint();
  }
  if (el.dataset.action === 'closeup') {
    const bus = vehicles.get(selection.id);
    if (bus && view) {
      const pose = displayedPose(bus, performance.now());
      following = true;
      frameMap();
      view.map.easeTo({
        center: pose.coordinate,
        zoom: 19.25,
        pitch: 60,
        bearing: (pose.bearing + 223) % 360,
        duration: 650,
      });
      paint();
    }
  }
  if (el.dataset.action === 'follow') {
    following = !following;
    const bus = vehicles.get(selection.id);
    if (following && bus && view) {
      frameMap();
      view.fly(displayedPose(bus, performance.now()).coordinate, Math.max(17, view.map.getZoom()));
    }
    paint();
  }
});
function showSearch() {
  const results = $('search-results');
  results.hidden = !query.trim() || !network;
  if (!results.hidden) results.innerHTML = searchResults();
}
$('search').addEventListener('input', (e) => {
  query = e.target.value;
  if (query.trim()) didStart = true;
  showSearch();
});
$('search').addEventListener('focus', showSearch);
document.querySelector('.finder').addEventListener('focusout', (e) => {
  if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) $('search-results').hidden = true;
});
$('search-results').addEventListener('click', (e) => {
  const el = e.target.closest('button[data-kind]');
  if (el) {
    select(el.dataset.kind, el.dataset.id, 'keep', {root: true});
    $('fold').focus({preventScroll: true});
  }
});
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.finder')) $('search-results').hidden = true;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && e.target.closest('.finder')) {
    clearSearch();
    $('search').focus();
  }
});
$('fold').onclick = () => expandDock($('detail').hidden);
$('nearby').onclick = () => select('nearby');
$('overview').onclick = () => select('home');
$('plus').onclick = () => view?.map.zoomIn();
$('minus').onclick = () => view?.map.zoomOut();
function mapError(message) {
  $('map-error').textContent = message;
  $('map-error').hidden = false;
}
async function init() {
  $('detail').innerHTML = empty('Loading the Helsinki network…');
  const base = new URL(import.meta.env.BASE_URL, location.href).href;
  const [result, facilities] = await Promise.all([
    fetch(base + 'data/network.json'),
    fetch(base + 'data/stop-facilities.json', {signal: AbortSignal.timeout(5000)})
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({})),
  ]);
  amenities = facilities;
  if (!result.ok) throw Error('Could not load the HSL network.');
  network = await result.json();
  const serviceDate = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Helsinki'}).format(new Date());
  if (serviceDate > network.validThrough)
    mapError(
      'Route data valid through ' + network.validThrough + '. Check HSL for subsequent route changes.',
    );
  for (const [id, r] of Object.entries(network.routes)) {
    const groups = [];
    for (const p of r.patterns) {
      let g = groups.find((g) => g.headsign === p.headsign && g.direction === p.direction);
      if (!g) {
        g = {headsign: p.headsign, direction: p.direction, patterns: []};
        groups.push(g);
      }
      g.patterns.push(p);
    }
    destinations.set(id, groups);
    for (const sid of new Set(r.patterns.flatMap((p) => p.stops))) {
      if (!servedBy.has(sid)) servedBy.set(sid, []);
      servedBy.get(sid).push(id);
    }
  }
  const order = new Intl.Collator('en', {numeric: true});
  for (const routes of servedBy.values())
    routes.sort((a, b) => order.compare(network.routes[a].number, network.routes[b].number));
  function syncFeeds() {
    if (document.hidden) {
      worker?.terminate();
      worker = null;
      subscribeBus(null);
      return;
    }
    if (worker) return;
    worker = new Worker(new URL('./feed-worker.js', import.meta.url), {type: 'module'});
    worker.onmessage = feedMessage;
    worker.onerror = () => {
      errors.positions = true;
      errors.arrivals = true;
      paint();
    };
    worker.postMessage({base, routes: Object.keys(network.routes)});
    subscribeBus(selection.kind === 'bus' ? selection.id : null);
  }
  document.addEventListener('visibilitychange', syncFeeds);
  syncFeeds();
  showSearch();
  paint();
  view = await makeMap(network, {visible, select, detach}, timeOfDay, amenities);
  view.setTimeOfDay(timeOfDay);
  if (selection.kind === 'nearby') refreshNearby();
  updateGeometry();
  draw();
  startSelection();
  const frame = new ResizeObserver((entries) => {
    const resized = entries.some(({target}) => target === $('map'));
    if (resized) view.map.resize();
    // Changing the contents of a floating card must not shift the street under the pointer.
    if (resized || following || (selection.kind !== 'bus' && selection.kind !== 'route')) frameMap();
  });
  frame.observe($('map'));
  frame.observe($('dock'));
  frame.observe(document.querySelector('.map-top'));
  view.map.on('moveend', () => {
    if (selection.kind === 'nearby') {
      refreshNearby();
      updateGeometry();
    }
    if (selection.kind === 'home' || selection.kind === 'nearby') paint();
  });
  requestAnimationFrame(animate);
}
function syncTimeOfDay() {
  if (timeOfDay && document.hidden) return;
  timeOfDay = helsinkiTimeOfDay(Date.now());
  const root = document.documentElement;
  if (root.dataset.daylight !== timeOfDay) {
    root.dataset.daylight = timeOfDay;
    document.querySelector('meta[name="theme-color"]').content = getComputedStyle(root)
      .getPropertyValue('--paper')
      .trim();
    $('clock').title = 'Helsinki · ' + timeOfDay;
  }
  view?.setTimeOfDay(timeOfDay);
}
syncTimeOfDay();
document.addEventListener('visibilitychange', syncTimeOfDay);
setInterval(syncTimeOfDay, 60_000);
init().catch((e) => {
  mapError(e.message);
  $('live').textContent = 'Unavailable';
});
setInterval(() => {
  updateFleet();
  updateGeometry();
  paint();
  draw();
}, 1500);
