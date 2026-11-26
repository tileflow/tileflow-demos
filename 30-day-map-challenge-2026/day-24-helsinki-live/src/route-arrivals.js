import {alreadyArrived, stopPunctuality} from './punctuality.js';

// Index once per TripUpdates packet. Reading a selected route then only visits its own services.
export function indexRouteTrips(trips) {
  const routes = new Map();
  for (const trip of trips) {
    if (trip.ambiguous || [3, 7].includes(trip.relationship) || ![0, 1].includes(trip.direction)) continue;
    if (!routes.has(trip.route)) routes.set(trip.route, [[], []]);
    routes.get(trip.route)[trip.direction].push(trip);
  }
  return routes;
}

const fresh = (stamp, clock, limit) => Number.isFinite(stamp) && stamp > 0 && stamp <= clock + 5 && clock - stamp < limit;
const skipped = call => call.relationship === 1 || (call.skipped && call.relationship !== 2);

export function servedRouteStops(pattern, trip, clock, feedTime) {
  if (!trip || trip.ambiguous || !fresh(feedTime, clock, 75) || (trip.timestamp != null && !fresh(trip.timestamp, clock, 75)))
    return pattern?.stops ?? [];
  if (!pattern) return trip.stops.filter(call => call.id && !skipped(call)).map(call => call.id);
  const omitted = trip.stops.filter(skipped);
  if (!omitted.length) return pattern.stops;
  const missed = new Set();
  for (const call of omitted) {
    let slot;
    if (call.sequence > 0) slot = pattern.sequences ? pattern.sequences.indexOf(call.sequence) : call.sequence - 1;
    else {
      slot = pattern.stops.indexOf(call.id);
      if (slot !== pattern.stops.lastIndexOf(call.id)) continue;
    }
    if (slot >= 0 && (!call.id || pattern.stops[slot] === call.id)) missed.add(slot);
  }
  return pattern.stops.filter((_, i) => !missed.has(i));
}

function firstPendingCall(trip, fix, clock) {
  const calls = trip.stops;
  let first = 0;
  for (let i = calls.length - 1; i >= 0; i--) {
    const call = calls[i];
    if ((call.arrived && call.arrival > 0 && call.arrival <= clock) ||
        (call.passed && call.departure > 0 && call.departure <= clock)) {
      first = i + 1;
      break;
    }
  }
  if (!fix || !fresh(fix.timestamp, clock, 30)) return first;
  let current = -1;
  if (Number.isInteger(fix.stopSequence)) {
    // TripUpdates may omit the current GPS stop. A later sequence is still authoritative.
    for (let i = first; i < calls.length; i++) {
      const sequence = calls[i].sequence;
      if (!(sequence > 0)) continue;
      if (sequence < fix.stopSequence) first = i + 1;
      else {
        if (sequence === fix.stopSequence) current = i;
        break;
      }
    }
  }
  if (current < 0 && fix.stopId) {
    const i = calls.findIndex(c => c.id === fix.stopId);
    if (i >= 0 && calls.findLastIndex(c => c.id === fix.stopId) === i &&
        (!fix.stopSequence || !calls[i].sequence)) current = i;
  }
  return current >= 0 ? Math.max(first, current + (fix.status === 1 ? 1 : 0)) : first;
}

export function nextRouteArrivals(trips, stopIds, positions, timetable, clock, feedTime) {
  const labels = new Map();
  if (!trips?.length || !fresh(feedTime, clock, 75)) return labels;
  const platforms = new Set(stopIds);
  const earliest = new Map();
  for (const trip of trips) {
    if (trip.timestamp != null && !fresh(trip.timestamp, clock, 75)) continue;
    const first = firstPendingCall(trip, positions.get(trip.key), clock);
    for (let i = first; i < trip.stops.length; i++) {
      const call = trip.stops[i];
      if (call.skipped || call.relationship === 1 || call.relationship === 2 || (call.id && !platforms.has(call.id))) continue;
      let stopId = call.id, arrival = call.arrival;
      // HSL can supply a live delay against a scheduled visit instead of an absolute time.
      if ((!arrival && Number.isFinite(call.arrivalDelay)) || !stopId) {
        const resolved = stopPunctuality(timetable, trip, call, clock, feedTime);
        stopId ||= resolved.stopId;
        arrival ||= resolved.eta;
      }
      if (!platforms.has(stopId) || !Number.isFinite(arrival) || arrival < clock || alreadyArrived(call, arrival, clock)) continue;
      if (!earliest.has(stopId) || arrival < earliest.get(stopId)) earliest.set(stopId, arrival);
    }
  }
  for (const id of platforms) {
    if (!earliest.has(id)) continue;
    const minutes = Math.round((earliest.get(id) - clock) / 60);
    labels.set(id, minutes === 0 ? 'Due' : minutes + ' min');
  }
  return labels;
}
