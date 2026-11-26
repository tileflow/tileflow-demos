import bindings from 'gtfs-realtime-bindings';
import {tripKey} from './transit.js';

const feeds = {positions: 3000, arrivals: 15000};
let routeIds, base;
const own = (value, key) => value && Object.hasOwn(value, key);

function positions(entities) {
  const results = [];
  for (const {vehicle: v} of entities) {
    if (!v?.trip || !routeIds.has(v.trip.routeId) || !v.position || !v.vehicle?.id) continue;
    if (!Number.isFinite(v.position.longitude) || !Number.isFinite(v.position.latitude)) continue;
    results.push({
      id: v.vehicle.id,
      key: tripKey(v.trip),
      relationship: v.trip.scheduleRelationship ?? 0,
      route: v.trip.routeId,
      direction: v.trip.directionId,
      coordinate: [v.position.longitude, v.position.latitude],
      timestamp: Number(v.timestamp),
      bearing: own(v.position, 'bearing') ? v.position.bearing : null,
      speed: own(v.position, 'speed') ? v.position.speed : null,
      status: own(v, 'currentStatus') ? v.currentStatus : 2,
      stopId: v.stopId,
      stopSequence: own(v, 'currentStopSequence') && v.currentStopSequence > 0 ? v.currentStopSequence : null,
    });
  }
  return results;
}

function arrivals(entities) {
  const results = [];
  const seen = new Map();
  for (const {tripUpdate: u} of entities) {
    if (!u?.trip || !routeIds.has(u.trip.routeId) || [3, 7].includes(u.trip.scheduleRelationship)) continue;
    const stops = u.stopTimeUpdate.map((s) => ({
      id: s.stopId,
      relationship: s.scheduleRelationship ?? 0,
      sequence: own(s, 'stopSequence') ? s.stopSequence : null,
      arrivalDelay: own(s.arrival, 'delay') ? s.arrival.delay : null,
      arrival: Number(s.arrival?.time || 0),
      departure: Number(s.departure?.time || 0),
      arrived: own(s.arrival, 'uncertainty') && s.arrival.uncertainty === 0,
      passed: own(s.departure, 'uncertainty') && s.departure.uncertainty === 0,
      skipped: s.scheduleRelationship === 1 || s.scheduleRelationship === 2,
    }));
    const update = {
      key: tripKey(u.trip),
      route: u.trip.routeId,
      direction: u.trip.directionId,
      stops,
      relationship: u.trip.scheduleRelationship ?? 0,
      timestamp: own(u, 'timestamp') ? Number(u.timestamp) : null,
    };
    const other = seen.get(update.key);
    if (other) other.ambiguous = update.ambiguous = true;
    seen.set(update.key, update);
    results.push(update);
  }
  return results;
}

async function poll(name) {
  try {
    const response = await fetch(base + 'api/' + name, {signal: AbortSignal.timeout(10000)});
    if (!response.ok) throw Error(String(response.status));
    const feed = bindings.transit_realtime.FeedMessage.decode(new Uint8Array(await response.arrayBuffer()));
    const data = name === 'positions' ? positions(feed.entity) : arrivals(feed.entity);
    self.postMessage({name, data, timestamp: Number(feed.header.timestamp)});
  } catch {
    self.postMessage({name, error: true});
  } finally {
    setTimeout(() => poll(name), feeds[name]);
  }
}

self.onmessage = ({data}) => {
  base = data.base;
  routeIds = new Set(data.routes);
  for (const name of Object.keys(feeds)) poll(name);
};
