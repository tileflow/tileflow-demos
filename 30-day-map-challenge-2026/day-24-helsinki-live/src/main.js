import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import {lineColor} from './line-colors.js';
import {makeMap} from './map.js';
import {indexTerminals} from './station-symbols.js';
import {helsinkiTimeOfDay} from './daylight.js';
import {sidePanel} from './place-card.js';
import {createBusPicker} from './bus-picker.js';
import {createBusViewport} from './bus-viewport.js';
import {busModelZoom, overviewEnd, timingGroup, timingPalette} from './fleet-lights.js';
import {alreadyArrived, vehiclePunctuality, stopPunctuality} from './punctuality.js';
import {choosePattern, move, progress as tripOffset, recentTrail, samplePose} from './transit.js';
import {isNobinaU12} from './u12-model.js';
import {distance, networkTrack, routePreview} from './route-track.js';
import {trackDetail} from './door-feed.js';
import {platformInfo, vehicleAtStop, callForBus, matchesService} from './stop-call.js';

const $ = (id) => document.getElementById(id);
const escape = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c],
  );
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
  servedBy = new Map();
const navigation = [];
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
  didStart = false,
  visibleFleet = [],
  lastCamera = 0,
  lastFollowPosition,
  followAnchor,
  cameraChasing = false,
  revealSelectedBus = false;
const reducedCameraMotion = matchMedia('(prefers-reduced-motion: reduce)');
const patternCache = new Map();
const busPicker = createBusPicker($('bus-picker'), (bus) => ({
  line: network.routes[bus.route].number,
  destination: titleFor(bus),
}), (id) => {
  if (!id) return select('home');
  const bus = vehicles.get(id);
  if (bus && now() - bus.timestamp < 90) select('bus', id, 'picker');
});
const target = (kind, id) => 'data-kind="' + kind + '" data-id="' + escape(id) + '"';
const fitButton =
  '<button class="route-link" data-action="fit">Fit route<span aria-hidden="true">→</span></button>';
function badge(number) {
  const color = lineColor(number);
  const style = '--line-ink:' + color.ink + ';--line-body:' + color.body;
  return '<span class="route-tag" style="' + style + '">' + escape(number) + '</span>';
}
const empty = (s) => '<p class="empty">' + escape(s) + '</p>';
const row = (kind, id, contents, sequence) =>
  '<button class="row" ' + target(kind, id) +
  (Number.isInteger(sequence) ? ' data-sequence="' + sequence + '"' : '') + '>' + contents + '</button>';
const section = (title) => '<div class="section-head"><h3>' + escape(title) + '</h3></div>';
function closeDetails(kind) {
  const label = 'Close ' + kind + ' details';
  return '<button type="button" class="ride-close" data-action="close" aria-label="' + label + '" title="' + label +
    '"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button>';
}
let timetable, timingClock = -Infinity;
const busTimings = new Map(), reportedFleet = new Map();
function mapStatus(id) {
  return busTimings.get(id)?.status ?? 'unknown';
}
let fleetTimingCounts;
const timingBands = new Map();
const timingPercent = $('timing-percent');
timingPercent.style.setProperty('--timing-day', timingPalette.late.day);
timingPercent.style.setProperty('--timing-night', timingPalette.late.night);
for (const status of ['on-time', 'late', 'very-late']) {
  const colour = timingPalette[status];
  const entry = document.createElement('div');
  const band = document.createElement('span');
  band.style.setProperty('--timing-day', colour.day);
  band.style.setProperty('--timing-night', colour.night);
  const track = document.createElement('span');
  track.className = 'timing-track';
  track.setAttribute('aria-hidden', 'true');
  track.append(band);
  const label = document.createElement('dt');
  label.textContent = colour.label;
  entry.title = colour.hint;
  label.setAttribute('aria-label', colour.label + '. ' + colour.hint);
  const detail = document.createElement('dd');
  const value = document.createElement('span');
  value.textContent = '—';
  detail.append(track, value);
  entry.append(label, detail);
  $('timing-legend').append(entry);
  timingBands.set(status, {value, band});
}
function refreshTimings() {
  const clock = now();
  if (timingClock === clock) return;
  timingClock = clock;
  busTimings.clear();
  fleetTimingCounts = Object.fromEntries(Object.keys(timingPalette).map((status) => [status, 0]));
  // Extra HFP observations for a selected bus refine its card separately from fleet-wide totals.
  for (const bus of reportedFleet.values()) {
    const timing = vehiclePunctuality(timetable, bus, predictions.get(bus.key), clock, stamps.arrivals);
    busTimings.set(bus.id, timing);
    if (bus.timestamp <= clock + 5 && clock - bus.timestamp < 30) fleetTimingCounts[timingGroup(timing.status)]++;
  }
  for (const bus of visibleFleet) {
    if (bus.precise || !reportedFleet.has(bus.id)) {
      busTimings.set(bus.id, vehiclePunctuality(timetable, bus, predictions.get(bus.key), clock, stamps.arrivals));
    }
  }
}
function updateTimingPanel() {
  refreshTimings();
  const clock = now();
  const current = clock - stamps.positions < 30 && freshArrivals() && Boolean(timetable);
  const counts = fleetTimingCounts;
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const covered = total - counts.unknown;
  const hasEstimate = current && covered > 0;
  const delayed = counts.late + counts['very-late'];
  $('timing-sample').hidden = !hasEstimate;
  $('timing-late-count').textContent = delayed;
  $('timing-base').textContent = 'of ' + covered + (covered === 1 ? ' bus' : ' buses');
  $('timing-outlook').textContent = hasEstimate ? (delayed === 1 ? 'is expected late' : 'are expected late') : 'Expected late';
  timingPercent.textContent = hasEstimate ? Math.round(100 * delayed / covered) + '%' : '—';
  $('timing-coverage').textContent = !current ? 'Waiting for live data and timetable'
    : total ? covered + ' of ' + total + (total === 1 ? ' bus analysed' : ' buses analysed')
    : 'No recent bus positions in the HSL feed';
  $('timing-unknown').textContent = current && total ? counts.unknown + ' without an estimate' : '';
  for (const [status, {value, band}] of timingBands) {
    value.textContent = current ? counts[status] : '—';
    band.style.width = (hasEstimate ? 100 * counts[status] / covered : 0) + '%';
  }
}
function futureArrivals(bus, trip) {
  if (!trip) return [];
  refreshTimings();
  const timing = busTimings.get(bus.id);
  const index = timing?.callIndex ?? -1;
  const clock = now();
  const calls = index >= 0 ? trip.stops.slice(index) : trip.stops;
  return calls.flatMap((call) => {
    if (call.relationship === 1 || (call.skipped && call.relationship !== 2)) return [];
    const pending = call === trip.stops[index] && timing?.status === 'unknown'
      ? [{...call, arrival: 0, departure: 0}] : [];
    const predicted = call.arrival || (Number.isFinite(call.arrivalDelay)
      ? stopPunctuality(timetable, trip, call, clock, stamps.arrivals).eta : null);
    if (call.relationship === 2 || alreadyArrived(call, predicted, clock)) return pending;
    if (predicted) return [call.arrival ? call : {...call, arrival: predicted}];
    return call.departure && call.departure >= clock - 3 ? [call] : pending;
  });
}
// A fresh update can contain only the stop the bus just served. HSL's reported
// next stop still identifies the remaining scheduled visits, without predicting an ETA.
function remainingCalls(bus, p, trip) {
  const live = futureArrivals(bus, trip);
  if (live.length || !p || trip?.ambiguous || (trip?.relationship ?? bus.relationship ?? 0) !== 0) return live;
  const sequence = bus.stopSequence;
  let start = Number.isInteger(sequence) ? (p.sequences ? p.sequences.indexOf(sequence) : sequence - 1) : -1;
  if (start < 0 || p.stops[start] !== bus.stopId) {
    start = p.stops.indexOf(bus.stopId);
    if (start < 0 || p.stops.indexOf(bus.stopId, start + 1) >= 0) return [];
  }
  const omitted = trip?.stops.filter(c => c.relationship === 1 || (c.skipped && c.relationship !== 2) ||
    (c.passed && (c.departure || c.arrival) <= now())) ?? [];
  return p.stops.slice(start).flatMap((id, i) => {
    const visit = p.sequences?.[start + i] ?? start + i + 1;
    if (omitted.some(c => c.id === id && (c.sequence == null || c.sequence === visit))) return [];
    return [{id, sequence: visit}];
  });
}
function timingLabel(status) {
  if (!status || status === 'unknown') return 'Delay unknown';
  if (status === 'early') return 'Early';
  return status === 'on-time' ? 'On time' : timingPalette[timingGroup(status)].label;
}
function arrivalComparison(result, stopName = '') {
  if (!result || result.status === 'unknown') return '';
  const {eta: predicted, scheduled, delta, status} = result;
  const palette = timingPalette[timingGroup(status)];
  const label = timingLabel(status);
  const seconds = Math.abs(delta), minutes = Math.floor(seconds / 60), rest = seconds % 60;
  const offset = (delta < 0 ? '−' : delta > 0 ? '+' : '') +
    (minutes ? minutes + 'm' + (rest ? ' ' + rest + 's' : '') : seconds + 's');
  return '<span class="arrival-accuracy" style="--timing-day:' + palette.day + ';--timing-night:' + palette.night +
    '"><strong>' + label + ' · ' + offset + '</strong><span>' +
    (stopName ? escape(stopName) + ' · ' : '') +
    'Scheduled ' + time(scheduled) + ' · Expected ' + time(predicted) + '</span></span>';
}
function displayedPose(bus, time) {
  const pose = samplePose(bus, time, bus.track && view?.align.covers(bus.coordinate) ? view.align : undefined);
  if (pose.uncertain && bus.rawCoordinate && selection.fullTrip && selection.id === bus.id)
    return {coordinate: bus.rawCoordinate, bearing: bus.bearing, uncertain: true};
  return pose;
}
function placeFix(previous, update, time) {
  const p = pattern(update);
  const track = networkTrack(network, p?.shape);
  return move(previous, update, time, {pattern: p, track});
}

function visible(time, bounds, selectedOnly = false) {
  let fleet = visibleFleet;
  if (selectedOnly) {
    const bus = selection.fullTrip && selection.kind === 'bus' && vehicles.get(selection.id);
    if (!bus || now() - bus.timestamp >= 90) return [];
    fleet = [bus];
  }
  const extent = bounds.toArray(),
    results = [];
  for (const bus of fleet) {
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
      punctuality: mapStatus(bus.id),
      onRoute: Boolean(bus.track) && !pose.uncertain,
      destination: selected ? titleFor(bus) : undefined,
      selected,
      fullTrip: selected && selection.fullTrip,
      speed: bus.speed,
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
function frameMap(fitBus = false) {
  if (!view) return;
  const map = view.map;
  const canvas = map.getCanvas().getBoundingClientRect();
  const dock = $('dock').getBoundingClientRect();
  const side = sidePanel.matches && selection.kind !== 'home' && !$('detail').hidden;
  let left = 0, right = 0, top = 0, bottom = 0;
  if (fitBus) {
    const free = busViewport().freeRect();
    if (free) {
      left = Math.floor(free.left); top = Math.floor(free.top);
      right = Math.floor(canvas.width - free.right); bottom = Math.floor(canvas.height - free.bottom);
    }
  } else if (selection.kind !== 'bus') {
    top = Math.round(Math.min(document.querySelector('.map-top').getBoundingClientRect().bottom - canvas.top, canvas.height * .45));
    bottom = side ? 30 : Math.min(Math.round(dock.height + 32), Math.floor(canvas.height * .42));
    right = side ? Math.round(dock.width + 32) : 0;
  }
  const padding = map.getPadding();
  if (padding.top !== top || padding.bottom !== bottom || padding.right !== right || padding.left !== left) {
    map.setPadding({top, bottom, left, right});
  }
}
function navigationLabel() {
  if (selection.kind === 'bus') {
    const b = vehicles.get(selection.id);
    return b ? network.routes[b.route].number + ' → ' + titleFor(b) : 'bus';
  }
  if (selection.kind === 'stop') return network.stops[selection.id].name;
  if (selection.kind === 'terminal') return network.terminals[selection.id].name;
  return '';
}
function select(kind, id, camera = 'keep', options = {}) {
  if (!network || !['home', 'bus', 'stop', 'terminal'].includes(kind)) return;
  didStart = true;
  const restored = options.restore;
  if (kind === 'bus' && !vehicles.has(id) && !restored) return;
  if (kind === 'terminal' && !network.terminals[id]) return;
  const bus = kind === 'bus' ? vehicles.get(id) : null;
  const startup = camera === 'startup';
  const fromKeyboardBadge = bus && document.activeElement?.matches('.bus-label:focus-visible');
  const sameBus = bus && selection.kind === 'bus' && selection.id === id;
  if (kind === 'home') {
    if (!restored) navigation.length = 0;
  } else if (
    !restored &&
    view &&
    kind !== selection.kind &&
    selection.kind !== 'home'
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
  selection = restored?.selection ?? {
    kind,
    id,
    fullTrip: Boolean(bus && !startup),
    originStop:
      options.originStop ?? (sameBus && bus.key === selection.tripKey ? selection.originStop : undefined),
    tripKey: bus?.key,
    fromBus: options.fromBus,
  };
  $('dock').hidden = selection.kind === 'home';
  busPicker.select(selection.kind === 'bus' ? selection.id : '');
  following = Boolean(bus && !restored && !reducedCameraMotion.matches);
  revealSelectedBus = Boolean(bus && !restored && !startup);
  followAnchor = null;
  view?.resetBusAnchor();
  lastFollowPosition = bus && displayedPose(bus, performance.now()).coordinate;
  lastCamera = performance.now();
  $('dock').removeAttribute('data-bus-outside');
  showAll = restored?.showAll ?? false;
  if (!sameBus) door = null;
  lastGeometry = null;
  if (!sameBus) subscribeBus(bus?.id ?? null);
  if (kind !== 'bus') view?.label(null);
  updateGeometry();
  draw();
  lastPreviewUpdate = -Infinity;
  drawPreviews(performance.now());
  paint();
  $('detail').scrollTop = restored?.scroll ?? 0;
  if (fromKeyboardBadge) $('detail').querySelector('[data-action="close"]')?.focus({preventScroll: true});
  if (restored) {
    view.restoreCamera(restored.camera);
    return;
  }
  if (camera === 'picker' && bus && view) {
    frameMap();
    view.map.stop();
    centerBus(displayedPose(bus, performance.now()).coordinate);
    return;
  }
  if (camera === 'inPlace' || (camera === 'keep' && (bus || kind === 'terminal'))) {
    view?.map.stop();
    return;
  }
  frameMap();
  if (bus && startup) view?.fly(displayedPose(bus, performance.now()).coordinate, 17.9, true);
  if (kind === 'stop') view?.fly(network.stops[id].coordinate, 17);
  if (kind === 'home') view?.fly([24.922, 60.174], 12.7);
}
function detach() {
  revealSelectedBus = false;
  if (following) {
    following = false;
    followAnchor = null;
    if (cameraChasing) view.map.stop();
    showFollowControl(!$('dock').hasAttribute('data-bus-outside'));
  }
}
function updateFleet() {
  visibleFleet = [...vehicles.values()].filter((b) => now() - b.timestamp < 90);
  if (view) busPicker.update(visibleFleet);
}
let lastFleetDraw = -Infinity;
function draw(t = performance.now()) {
  if (!view) return;
  lastFleetDraw = t;
  const clock = Date.now() / 1000;
  const overview = view.map.getZoom() < overviewEnd;
  refreshTimings();
  view.drawVehicles(
    visibleFleet.map((bus) => {
      const pose = displayedPose(bus, t);
      const fullTrip = Boolean(selection.fullTrip && selection.kind === 'bus' && selection.id === bus.id);
      return {
        fullTrip,
        trail: overview && !fullTrip && !pose.uncertain ? recentTrail(bus, t, clock) : undefined,
        punctuality: mapStatus(bus.id),
        stale: clock - bus.timestamp > 30,
        id: bus.id,
        line: network.routes[bus.route].number,
        coordinate: pose.coordinate,
        onRoute: Boolean(bus.track) && !pose.uncertain,
        selected: selection.kind === 'bus' && selection.id === bus.id,
        secondary: selection.kind === 'bus' && selection.id !== bus.id,
      };
    }),
  );
}
let lastPreviewUpdate = -Infinity;
function drawPreviews(t) {
  if (!view) return;
  const zoom = view.map.getZoom();
  if (t - lastPreviewUpdate < 100) return;
  lastPreviewUpdate = t;
  const items = [];
  const map = view.map;
  if (zoom >= busModelZoom) {
    // Start under the twelve-metre model, whose size increases at neighbourhood zoom.
    // The ribbon extends another one or two bus lengths beyond the windscreen.
    const metresPerPixel = 40075017 * Math.cos(map.getCenter().lat * Math.PI / 180) / (512 * 2 ** zoom);
    const halfModelLength = 6 * Math.max(1, 2 ** (15.5 - zoom));
    const guideLength = halfModelLength + Math.max(12, Math.min(28, 18 * metresPerPixel));
    const showArrivals = zoom >= 15.5 && freshArrivals();
    for (const model of visible(t, map.getBounds())) {
      if (!model.onRoute || model.fullTrip) continue;
      const bus = vehicles.get(model.id);
      const offset = model.wheelDistance;
      const align = view.align.covers(bus.coordinate) ? view.align : undefined;
      const path = routePreview(bus.track, offset, guideLength, align);
      if (path.length < 2) continue;
      const trip = showArrivals && now() - bus.timestamp <= 30 ? predictions.get(bus.key) : undefined;
      const call = trip && futureArrivals(bus, trip)[0];
      const patternForBus = call && pattern(bus);
      const index = call && patternForBus?.stops.findIndex(
        (id, i) => id === call.id && patternForBus.stopOffsets?.[i] >= offset - 4,
      );
      const metres = Number.isInteger(index) && index >= 0 ? patternForBus.stopOffsets[index] - offset : Infinity;
      const stop = call && network.stops[call.id];
      // A valid upcoming platform may be beyond the tip of the guide.
      let passingStop = false;
      if (stop && metres <= 550) {
        const approach = metres + 12 > guideLength ? routePreview(bus.track, offset, metres + 12, align) : path;
        passingStop = approach.some((p) => distance(p, stop.coordinate) < 42);
      }
      const arrival = call && (call.arrival || call.departure);
      items.push({
        id: model.id,
        line: model.line,
        punctuality: model.punctuality,
        path,
        call: passingStop && arrival ? {id: call.id, name: stop.name, eta: eta(arrival), arrival} : undefined,
      });
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
      const remaining = remainingCalls(bus, p, trip).map(s => s.id);
      patterns = selection.fullTrip ? [p] : [];
      const skipped = new Set(trip?.stops.filter((stop) => stop.skipped).map((stop) => stop.id));
      ids = selection.fullTrip ? p.stops.filter((stop) => !skipped.has(stop)) : remaining;
      call = callForBus(bus, p, remaining, door, network.stops, now());
      progress = {currentStop: call?.id};
    }
  } else if (kind === 'stop') {
    ids = [id];
  }
  const key = JSON.stringify([
    kind,
    id,
    patterns.map((p) => p.shape),
    ids,
    progress?.currentStop,
    call,
    timeOfDay,
  ]);
  if (key !== lastGeometry) {
    lastGeometry = key;
    const routeId = kind === 'bus' ? vehicles.get(id)?.route : undefined;
    view.geometry(patterns, ids, progress, routeId, call);

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
  timingClock = -Infinity;
  if (name === 'positions') {
    reportedFleet.clear();
    for (const v of data) {
      if (now() - v.timestamp > 90) continue;
      reportedFleet.set(v.id, v);
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
      if (!reportedFleet.has(id) && (selection.kind !== 'bus' || selection.id !== id || now() - v.timestamp > 120))
        vehicles.delete(id);
    updateFleet();
  } else {
    predictions.clear();
    patternCache.clear();
    for (const trip of data) predictions.set(trip.key, trip);
  }
  draw();
  if (name === 'positions') startSelection();
  updateGeometry();
  paint();
}
function busStopRow([id, at, sequence], label = '', current = false) {
  const stop = network.stops[id];
  const arrival = current ? 'Now' : at ? eta(at) : '';
  const contents = '<span class="name">' + (label ? '<small>' + escape(label) + '</small>' : '') +
    escape(stop?.name || id) + '</span>' +
    (arrival ? '<span class="eta">' + arrival + '</span>' : '<span class="eta" aria-label="Live arrival unavailable">—</span>');
  return stop ? row('stop', id, contents, sequence) : '<div class="row">' + contents + '</div>';
}
function busDetail(id) {
  const b = vehicles.get(id);
  if (!b || now() - b.timestamp > 90)
    return '<div class="ride-layout bus-panel"><article class="ride-card">' + closeDetails('bus') +
      section('Bus signal lost') + empty('HSL is no longer reporting this vehicle’s location.') + '</article></div>';
  const route = network.routes[b.route],
    p = pattern(b),
    trip = freshArrivals() ? predictions.get(b.key) : null;
  const visits = remainingCalls(b, p, trip);
  const platform = vehicleAtStop(b, door, network.stops, now());
  const atStop = Boolean(platform);
  const open = platform?.state === 'doors';
  const status =
    now() - b.timestamp > 20
      ? 'Delayed signal'
      : atStop
        ? 'At stop'
          : b.status === 0
            ? 'Approaching stop'
            : b.speed != null && b.speed < 0.5
              ? 'Stopped'
              : 'In service';
  const dir = titleFor(b);
  const rows = visits.map(s => [s.id, s.arrival || s.departure, s.sequence]);
  // The live board may already start with the next stop while this bus is still boarding.
  // Remove only the matching current visit; a loop can serve the same stop again.
  const firstVisit = visits[0]?.sequence;
  if (platform && rows[0]?.[0] === platform.id &&
      (firstVisit == null || b.stopSequence == null || firstVisit === b.stopSequence)) rows.shift();
  const next = rows[0];
  const timing = busTimings.get(id);
  const line = lineColor(route.number);
  const timingStop = timing?.stopId !== next?.[0] ? network.stops[timing?.stopId]?.name : '';
  const platformNumber = network.stops[platform?.id]?.platform;
  const details = [];
  if (!atStop) details.push(status);
  if (b.speed != null && !(atStop && b.speed < 0.5)) details.push(Math.round(b.speed * 3.6) + ' km/h');
  const boarding = selection.tripKey === b.key && selection.originStop;
  const atLabel = boarding && boarding === platform?.id ? 'At your stop' : 'At stop';
  const currentLabel = platformNumber ? atLabel + ' · Platform ' + platformNumber : atLabel;
  const report = boarding && trip?.stops.find((s) => s.id === boarding);
  const call = report && !report.skipped && report.departure >= now() && !(report.passed && report.departure <= now())
    ? report : boarding && visits.find((s) => s.id === boarding && (s.departure || s.arrival));
  const boardingTime = call
    ? eta(call.departure || call.arrival)
    : report?.skipped
      ? 'Skipped'
      : report?.passed
        ? 'Departed'
        : 'Live time unavailable';
  const primary = platform ? [platform.id, 0, platform.id === b.stopId ? b.stopSequence : null] : next;
  const primaryLabel = platform ? currentLabel : boarding && boarding === next?.[0] ? 'Your stop is next' : 'Next stop';
  const followingStops = platform ? rows : rows.slice(1);
  const hasMore = followingStops.length > 2;
  const band = timingPalette[timingGroup(timing?.status)];
  const boardingLine = boarding && boarding !== primary?.[0]
    ? '<div class="boarding-call"><span>' +
      (next?.[0] === boarding ? 'Your stop is next' : 'Your stop') +
      '</span> ' +
      escape(network.stops[boarding].name) +
      ' · ' +
      boardingTime +
      '</div>'
    : '';
  return (
    '<div class="ride-layout bus-panel" data-route="' + escape(route.number) + '" style="--route-body:' +
    line.body + ';--route-ink:' + line.ink +
    '"><article class="ride-card"><div class="route-heading">' +
    badge(route.number) +
    '<h2>' +
    escape(dir) +
    '</h2></div>' + closeDetails('bus') +
    boardingLine + '</article><section class="bus-calls" aria-label="Stops">' +
    (primary ? '<div class="bus-next">' + busStopRow(primary, primaryLabel, atStop) + '</div>' : '') +
    followingStops.slice(0, 2).map(call => busStopRow(call)).join('') +
    (hasMore ? '<div id="extra-bus-stops"' + (showAll ? '>' +
      followingStops.slice(2).map(call => busStopRow(call)).join('') : ' hidden>') + '</div>' : '') +
    (!rows.length ? empty(trip ? 'No more arrivals are expected on this trip.'
      : 'HSL has not published arrivals for this trip yet.') : '') +
    '</section><footer class="bus-summary">' +
    '<button type="button" class="bus-timing" data-action="timing" aria-controls="bus-report" aria-expanded="' +
    Boolean(selection.reportOpen) + '" title="Arrival and vehicle details" style="--timing-day:' + band.day +
    ';--timing-night:' + band.night + '">' + timingLabel(timing?.status) + '</button>' +
    '<button type="button" class="route-link locate-bus" data-action="locate" hidden>Locate bus</button>' +
    (p && (!hasMore || showAll) ? fitButton : '') +
    (hasMore ? '<button type="button" class="bus-more" data-action="more" aria-controls="extra-bus-stops" aria-expanded="' +
      showAll + '">' + (showAll ? 'Fewer stops' : 'More stops') + '</button>' : '') +
    '</footer><div id="bus-report"' + (selection.reportOpen ? '>' + arrivalComparison(timing, timingStop) +
      '<div class="vehicle-type">Bus ' + escape(id.split('/').at(-1)) +
      (isNobinaU12(id) ? ' · Nobina Yutong U12' : '') +
      (details.length ? ' · ' + escape(details.join(' · ')) : '') +
      '</div><div class="data-note">Last location · ' + Math.max(0, now() - b.timestamp) +
      (b.track ? ' s' : ' s · GPS outside the matched route') +
      (open ? ' · Illustrative passengers' : '') + '</div>' : ' hidden>') + '</div></div>'
  );
}
function terminalDetail(id) {
  const group = network.terminals[id];
  const platforms = group.stops.map((key) => {
    const stop = network.stops[key];
    const label = stop.platform ? 'Platform ' + stop.platform : 'Stop ' + stop.code;
    const number = stop.platform ? '<span class="terminal-code">' + escape(stop.code) + '</span>' : '';
    return row('stop', key, '<span class="name">' + escape(label) + '</span>' + number);
  });
  return '<section class="place-panel terminal-panel"><header class="place-heading"><div class="eyebrow">Bus station</div><h2>' +
    escape(group.name) + '</h2>' + closeDetails('station') + '</header><section class="place-board">' +
    section('Bus boarding points') + platforms.join('') + '</section></section>';
}
function stopHeadline(id, arrivals, byTrip) {
  const source = selection.fromBus;
  const entry = source
    ? arrivals.find(({t, call}) => !t.ambiguous && t.key === source.key &&
      (source.sequence == null || call.sequence === source.sequence))
    : arrivals.reduce((first, visit) => !first || (visit.arrival || visit.at) < (first.arrival || first.at)
      ? visit : first, null);
  const bus = source ? vehicles.get(source.id) : entry && !entry.t.ambiguous && byTrip.get(entry.t.key);
  const active = bus && now() - bus.timestamp < 90 && (!source || bus.key === source.key);
  const here = active && vehicleAtStop(bus, null, network.stops, now())?.id === id &&
    (!source || source.sequence == null || bus.stopSequence == null || source.sequence === bus.stopSequence);
  const at = entry?.arrival || entry?.call.departure;
  const line = source?.line ?? (entry && network.routes[entry.t.route].number);
  const destination = source?.destination ?? (entry && titleFor(entry.t));
  const service = line ? badge(line) + '<span>' + escape(destination) + '</span>' : '';
  const serviceLink = !service ? '' : active
    ? '<button class="stop-service" ' + target('bus', bus.id) + ' aria-label="Show bus ' +
      escape(line + ' to ' + destination) + '">' + service + '</button>'
    : '<span class="stop-service">' + service + '</span>';
  const wait = here ? 'Now' : at ? eta(at) : '';
  const caption = here ? 'At this stop' : !wait || wait === 'Now' ? (source ? 'Your bus' : 'Next bus')
    : entry?.arrival ? (source ? 'Your bus arrives in' : 'Next bus in') : 'Departs in';
  const fallback = source ? 'Live time unavailable' : freshArrivals() ? 'No live departures' : 'Awaiting live times';
  const value = wait ? '<strong class="stop-wait">' +
    wait.replace(' min', ' <small>min</small>') + '</strong>' : '<span class="stop-no-time">' + fallback + '</span>';
  return '<div class="stop-arrival"><div><span class="stop-caption">' + caption + '</span>' +
    value + '</div>' + serviceLink + '</div><footer class="stop-footer"><span>' +
    (here ? 'At stop now' : at ? time(at) + ' estimated' : '') + '</span>' +
    '<button class="bus-more" data-action="stop-details" aria-expanded="' + Boolean(selection.detailsOpen) +
    '" aria-controls="stop-details">Stop details</button></footer>';
}
function stopDetail(id) {
  const s = network.stops[id], parent = network.parentOf.get(id),
    arrivals = [];
  const numbers = [...new Set((servedBy.get(id) ?? []).map((route) => network.routes[route].number))];
  const routes = escape(numbers.join(' · '));
  const routeList = numbers.length > 8
    ? '<details class="place-routes" data-stop="' + escape(id) + '"><summary>' + numbers.length +
      ' routes serve this stop</summary><div class="route-info">' + routes + '</div></details>'
    : numbers.length ? '<div class="route-info">Routes ' + routes + '</div>' : '';
  if (freshArrivals()) {
    for (const t of predictions.values()) {
      if (t.timestamp && now() - t.timestamp > 75) continue;
      for (const call of t.stops) {
        if (call.id !== id || call.skipped || (call.passed && (!call.departure || call.departure <= now()))) continue;
        const accuracy = stopPunctuality(timetable, t, call, now(), stamps.arrivals);
        const at = call.departure || call.arrival || accuracy.eta;
        if (at && at >= now() - 3) {
          const predicted = call.arrival || accuracy.eta;
          const arrival = predicted && !alreadyArrived(call, predicted, now()) ? predicted : null;
          arrivals.push({t, call, at, arrival, accuracy});
        }
      }
    }
  }
  arrivals.sort((a, b) => a.at - b.at);
  const byTrip = new Map(visibleFleet.map((b) => [b.key, b]));
  return (
    '<article class="place-panel stop-panel"><header class="place-heading"><div class="stop-caption">Bus stop · ' +
    escape(s.code || id) +
    '</div><h2 class="stop-heading">' +
    escape(s.name) +
    '</h2>' + closeDetails('stop') + '</header>' +
    stopHeadline(id, arrivals, byTrip) +
    (selection.detailsOpen ? '<section id="stop-details" class="place-board"><div class="platform-facts">' +
    escape(platformInfo(s, amenities[id]).join(' · ')) +
    '</div>' +
    (parent
      ? '<button class="route-link" ' + target('terminal', parent) + '>All boarding points at ' + escape(network.terminals[parent].name) + '</button>'
      : '') +
    routeList +
    section('Upcoming departures') +
    (arrivals.length
      ? arrivals
          .slice(0, 15)
          .map(({t, at, accuracy}) => {
            const b = byTrip.get(t.key);
            const contents = badge(network.routes[t.route].number) +
                '<span class="name">' +
                escape(titleFor(t)) +
                '<small>' +
                time(at) +
                (b ? ' · estimated' : ' · estimated · vehicle location unavailable') +
                '</small>' + arrivalComparison(accuracy) + '</span><span class="eta">' +
                eta(at) +
                '</span>';
            return b ? row('bus', b.id, contents) : '<div class="row">' + contents + '</div>';
          })
          .join('')
      : empty(
          freshArrivals()
            ? 'No live departures listed for this stop.'
            : 'Waiting for live predictions from HSL.',
        )) +
    '<div class="data-note"><a class="link" href="https://reittiopas.hsl.fi/pysakit/HSL%3A' +
    encodeURIComponent(id) +
    '?locale=en" target="_blank" rel="noreferrer">Stop timetable on HSL ↗</a></div></section>' :
      '<section id="stop-details" hidden></section>') + '</article>'
  );
}
function paint() {
  refreshTimings();
  updateTimingPanel();
  $('clock').textContent = time(now());
  const age = now() - stamps.positions;
  const ok = age < 20 && !errors.positions;
  $('live').classList.toggle('on', ok);
  const feedStatus = ok
    ? 'Live'
    : stamps.positions
      ? age < 90
        ? 'Updating'
        : 'No signal'
      : errors.positions
        ? 'No signal'
        : 'Connecting';
  const signal = $('live');
  signal.textContent = signal.title = feedStatus;
  signal.dataset.compact = ok ? 'Live' : feedStatus === 'No signal' ? 'Offline' : 'Sync';
  if (!network) return;
  const back = selection.kind === 'terminal' && navigation.length
    ? '<button class="return-link" data-action="back">← Back to ' +
      escape(navigation.at(-1).label) +
      '</button>'
    : '';
  const content =
    selection.kind === 'bus'
      ? busDetail(selection.id)
      : selection.kind === 'stop'
        ? stopDetail(selection.id)
        : selection.kind === 'terminal' ? terminalDetail(selection.id) : '';
  const html = back + content;
  if (html === lastDetail) return;
  const detail = $('detail'),
    focused = document.activeElement;
  const expandedRoutes = detail.querySelector('.place-routes[open]')?.dataset.stop;
  const focusRoutes = focused?.matches('.place-routes > summary');
  const focusedLink = detail.contains(focused) && focused.closest('a')?.href;
  const focusKey = detail.contains(focused)
    ? [focused.dataset.kind, focused.dataset.id, focused.dataset.action]
    : null;
  detail.innerHTML = html;
  lastDetail = html;
  const routes = detail.querySelector('.place-routes');
  if (routes && expandedRoutes === routes.dataset.stop) routes.open = true;
  if (focusRoutes && routes) {
    routes.querySelector('summary').focus({preventScroll: true});
  } else if (focusedLink) {
    [...detail.querySelectorAll('a')].find((a) => a.href === focusedLink)?.focus({preventScroll: true});
  } else if (focusKey) {
    [...detail.querySelectorAll('button')]
      .find(
        (e) =>
          e.dataset.kind === focusKey[0] && e.dataset.id === focusKey[1] && e.dataset.action === focusKey[2],
      )
      ?.focus({preventScroll: true});
  }
}
// Only the actual control rectangles hide the bus. A floating card does not
// make the entire right-hand column (or the entire bottom of a phone) unusable.
const mapObstacles = [...document.querySelectorAll('.map-top, #camera-controls, #punctuality-panel, #dock')];
function busViewport() {
  const canvas = view.map.getCanvas().getBoundingClientRect();
  return createBusViewport(canvas, mapObstacles.map(element => element.getBoundingClientRect()));
}
function frameBus(coordinate, point, duration, chase = false) {
  const map = view.map;
  const anchor = map.project(map.getCenter());
  map.easeTo({center: coordinate, offset: [point.x - anchor.x, point.y - anchor.y],
    duration: reducedCameraMotion.matches ? 0 : duration,
    ...(chase && {easeId: 'hsl-bus-follow', easing: t => 1 - (1 - t) ** 2}),
  }, {busChase: chase});
}
function centerBus(coordinate, returnToCard = false) {
  const area = busViewport(), canvas = view.map.getCanvas().getBoundingClientRect();
  const point = view.map.project(coordinate);
  let target = area.place(point, {mode: 'center'});
  if (returnToCard && $('dock').hasAttribute('data-bus-anchored')) {
    const card = $('dock').getBoundingClientRect();
    const y = card.top - canvas.top + 42;
    const sides = [card.left - canvas.left - 60, card.right - canvas.left + 60];
    const preferredX = followAnchor?.x ?? target.x;
    sides.sort((a, b) => Math.abs(a - preferredX) - Math.abs(b - preferredX));
    for (const x of sides) {
      const beside = area.place({x, y}, {footprint: {left: 16, right: 16, top: 18, bottom: 12}});
      if (beside.visible) {
        target = beside;
        break;
      }
    }
  }
  followAnchor = target.feasible ? {x: target.x, y: target.y} : null;
  if (followAnchor) frameBus(coordinate, followAnchor, 420);
}
function showFollowControl(visible) {
  const button = $('dock').querySelector('[data-action="locate"]');
  if (!button) return;
  const hidden = visible && (following || reducedCameraMotion.matches);
  if (button.hidden !== hidden) button.hidden = hidden;
  const text = visible ? 'Resume follow' : 'Locate bus';
  if (button.textContent !== text) button.textContent = text;
}
function trackSelectedBus(coordinate, roof, t) {
  if (t - lastCamera < 100) return;
  lastCamera = t;
  const map = view.map, point = map.project(coordinate);
  const area = busViewport();
  // Keep the projected body clear of overlays, even when viewing a tall roof from the street.
  const badgeHeight = selection.fullTrip ? 0 : 27;
  const footprint = roof ? {
    left: Math.max(10, point.x - roof.left), right: Math.max(10, roof.right - point.x),
    top: Math.max(8, point.y - roof.top + badgeHeight), bottom: Math.max(6, roof.bottom - point.y),
  } : {left: 10, right: 10, top: 8 + badgeHeight, bottom: 8};
  const reveal = area.place(point, {mode: 'reveal', footprint});
  // A clipped bumper warrants a small framing correction, but the visible roof
  // still identifies the bus. Offer Locate only when its centre is actually hidden.
  const identifiable = area.place(roof ?? point, {footprint: {left: 3, right: 3, top: 3, bottom: 3}}).visible;
  $('dock').toggleAttribute('data-bus-outside', !identifiable);
  showFollowControl(identifiable);
  if (map.isMoving() && !cameraChasing) return;

  if (!followAnchor || revealSelectedBus) {
    followAnchor = {x: reveal.x, y: reveal.y};
    const mayReveal = revealSelectedBus;
    revealSelectedBus = false;
    if (mayReveal && !reveal.visible && reveal.feasible) {
      frameBus(coordinate, followAnchor, 360);
      return;
    }
  }
  if (!following || reducedCameraMotion.matches || !lastFollowPosition) return;
  if (distance(coordinate, lastFollowPosition) < .25) return;
  lastFollowPosition = coordinate;
  // Keep the initial framing. Small movements can play out naturally next to
  // the card; a bus travelling down a street gently carries the map with it.
  const dx = point.x - followAnchor.x, dy = point.y - followAnchor.y;
  const drift = Math.hypot(dx, dy), slack = 24;
  const desired = drift > slack
    ? {x: followAnchor.x + dx * slack / drift, y: followAnchor.y + dy * slack / drift}
    : point;
  const target = area.place(desired, {mode: 'follow', footprint, previous: followAnchor});
  if (target.feasible && Math.hypot(target.x - point.x, target.y - point.y) > 3) {
    frameBus(coordinate, target, 360, true);
  }
}
function animate(t) {
  if (view && view.map.getZoom() < overviewEnd && t - lastFleetDraw >= 400) draw(t);
  drawPreviews(t);
  view?.pulseDirections(t);
  if (view && selection.kind === 'bus') {
    const bus = vehicles.get(selection.id);
    if (bus && now() - bus.timestamp < 90) {
      const pos = displayedPose(bus, t).coordinate;
      const roof = view.label(bus, pos, titleFor(bus), !selection.fullTrip);
      trackSelectedBus(pos, roof, t);
    } else {
      view.label(null);
      $('dock').removeAttribute('data-bus-outside');
    }
  } else if (view && (selection.kind === 'stop' || selection.kind === 'terminal')) {
    view.labelPlace(selection.kind, selection.id);
  }
  requestAnimationFrame(animate);
}
$('detail').addEventListener('click', (e) => {
  const el = e.target.closest('button');
  if (!el) return;
  if (el.dataset.kind) {
    const boarding = selection.kind === 'stop' && el.dataset.kind === 'bus';
    const origin = selection.kind === 'bus' && el.dataset.kind === 'stop' && vehicles.get(selection.id);
    select(el.dataset.kind, el.dataset.id, boarding ? 'picker' : 'keep', {
      originStop: boarding ? selection.id : undefined,
      fromBus: origin ? {id: origin.id, key: origin.key, line: network.routes[origin.route].number,
        destination: titleFor(origin), sequence: el.hasAttribute('data-sequence') ? Number(el.dataset.sequence) : null} : undefined,
    });
  }
  if (el.dataset.action === 'stop-details') {
    selection.detailsOpen = !selection.detailsOpen;
    paint();
  }
  if (el.dataset.action === 'close') {
    select('home', undefined, 'inPlace');
    $('bus-picker').focus({preventScroll: true});
  }
  if (el.dataset.action === 'back') {
    const previous = navigation.pop();
    if (previous) select(previous.selection.kind, previous.selection.id, 'restore', {restore: previous});
  }
  if (el.dataset.action === 'locate' && view && selection.kind === 'bus') {
    const bus = vehicles.get(selection.id);
    if (!bus || now() - bus.timestamp >= 90) return;
    const coordinate = displayedPose(bus, performance.now()).coordinate;
    const outside = $('dock').hasAttribute('data-bus-outside');
    view.map.stop();
    if (!outside) followAnchor = null;
    following = !reducedCameraMotion.matches;
    lastFollowPosition = coordinate;
    if (outside) {
      centerBus(coordinate, true);
      revealSelectedBus = true;
    }
    showFollowControl(true);
  }
  if (el.dataset.action === 'fit' && view && selection.kind === 'bus') {
    const trip = pattern(vehicles.get(selection.id));
    if (!trip) return;
    following = false;
    selection.fullTrip = true;
    updateGeometry();
    lastPreviewUpdate = -Infinity;
    drawPreviews(performance.now());
    revealSelectedBus = false;
    followAnchor = null;
    frameMap(true);
    view.fit([trip]);
    paint();
  }
  if (el.dataset.action === 'more') {
    showAll = !showAll;
    paint();
  }
  if (el.dataset.action === 'timing') {
    selection.reportOpen = !selection.reportOpen;
    paint();
  }

});
$('overview').onclick = () => select('home');
function mapError(message) {
  $('map-error').textContent = message;
  $('map-error').hidden = false;
}
async function init() {
  $('detail').innerHTML = empty('Loading the Helsinki network…');
  const base = new URL(import.meta.env.BASE_URL, location.href).href;
  fetch(base + 'data/timetable.json').then((response) => response.ok ? response.json() : null).then((data) => {
    timetable = data;
    timingClock = -Infinity;
    paint();
    draw();
  }).catch(() => {});
  const [result, facilities, terminalCatalogue] = await Promise.all([
    fetch(base + 'data/network.json'),

    fetch(base + 'data/stop-facilities.json', {signal: AbortSignal.timeout(5000)})
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({})),
    fetch(base + 'data/terminals.json')
      .then((r) => r.ok ? r.json() : null)
      .catch(() => null),
  ]);
  amenities = facilities;
  if (!result.ok) throw Error('Could not load the HSL network.');
  network = await result.json();
  const {stations, parentOf} = indexTerminals(terminalCatalogue, network);
  network.terminals = stations;
  network.parentOf = parentOf;
  const serviceDate = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Helsinki'}).format(new Date());
  if (serviceDate > network.validThrough)
    mapError(
      'Route data valid through ' + network.validThrough + '. Check HSL for subsequent route changes.',
    );
  for (const [id, r] of Object.entries(network.routes)) {
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
  paint();
  function dismissPlaceOrBus() {
    if (['bus', 'stop', 'terminal'].includes(selection.kind)) select('home', undefined, 'inPlace');
  }
  view = await makeMap(network, {visible, select, detach, dismiss: dismissPlaceOrBus}, timeOfDay, amenities);
  view.map.on('movestart', event => { cameraChasing = event.busChase === true; });
  view.map.on('moveend', () => { cameraChasing = false; });
  busPicker.update(visibleFleet);
  view.setTimeOfDay(timeOfDay);
  updateGeometry();
  draw();
  startSelection();
  const frame = new ResizeObserver((entries) => {
    const resized = entries.some(({target}) => target === $('map'));
    if (resized) {
      followAnchor = null;
      view.map.resize();
    }
    // Changing the contents of a floating card must not shift the street under the pointer.
    if (resized || selection.kind === 'home') frameMap();
  });
  frame.observe($('map'));
  frame.observe($('dock'));
  frame.observe(document.querySelector('.map-top'));
  let wasOverview = view.map.getZoom() < overviewEnd;
  view.map.on('zoom', () => {
    const overview = view.map.getZoom() < overviewEnd;
    if (overview !== wasOverview) {
      wasOverview = overview;
      draw();
      lastPreviewUpdate = -Infinity;
      drawPreviews(performance.now());
    }
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
    if (view) {
      view.setTimeOfDay(timeOfDay);
      updateGeometry();
      draw();
      lastPreviewUpdate = -Infinity;
      drawPreviews(performance.now());
      paint();
    }
  }
}
syncTimeOfDay();
document.addEventListener('visibilitychange', syncTimeOfDay);
setInterval(syncTimeOfDay, 60_000);
init().catch((e) => {
  mapError(e.message);
  const signal = $('live');
  signal.textContent = signal.title = 'Unavailable';
  signal.dataset.compact = 'Offline';
});
setInterval(() => {
  updateFleet();
  updateGeometry();
  paint();
  draw();
}, 1500);
