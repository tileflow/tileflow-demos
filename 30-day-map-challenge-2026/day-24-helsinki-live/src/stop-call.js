import {distance} from './route-track.js';

export function platformInfo(stop, amenities) {
  const facts = [];
  if (stop.platform) facts.push('Platform ' + stop.platform);
  if (stop.indoorLevel) facts.push('Indoor terminal · Level ' + stop.indoorLevel);
  else if (amenities?.shelter) facts.push('Shelter');
  else if (amenities?.shelter === false) facts.push('No shelter');
  if (amenities?.bench) facts.push('Bench');
  return facts;
}

// HFP uses local HH:mm; GTFS sometimes numbers the same trip past midnight as 24:xx.
export function matchesService(key, reading) {
  const [date, , , start] = key.split('|');
  if (reading.oday && String(reading.oday).replaceAll('-', '') !== date) return false;
  if (!reading.start || !start) return true;
  const minuteOfDay = (value) => {
    const [hours, minutes] = String(value).split(':').map(Number);
    return (hours % 24) * 60 + minutes;
  };
  return minuteOfDay(start) === minuteOfDay(reading.start);
}

export function vehicleAtStop(bus, door, stops, now) {
  if (!bus || now - bus.timestamp > 20) return null;
  const reading = door?.key === bus.key && Math.abs(now - door.time) < 8 ? door : null;
  const slow = bus.speed == null || bus.speed < 1;
  const open = Boolean(reading?.open);
  if (!open && !(bus.status === 1 && slow && now - (bus.statusTime ?? bus.timestamp) <= 20)) return null;
  const id = (open && reading.stopId) || bus.stopId;
  const stop = stops[id];
  if (!stop || distance(bus.rawCoordinate || bus.coordinate, stop.coordinate) > 90) return null;
  return {id, state: open ? 'doors' : 'at'};
}

export function callForBus(bus, pattern, remaining, door, stops, now) {
  if (!bus || now - bus.timestamp > 20) return null;
  const at = vehicleAtStop(bus, door, stops, now);
  const id = at?.id || (stops[bus.stopId] && remaining.includes(bus.stopId) ? bus.stopId : remaining[0]);
  if (!stops[id]) return null;
  const nextIndex = remaining.indexOf(id);
  let next = remaining[nextIndex + 1];
  if (nextIndex === -1 && !next && pattern) {
    const i = pattern.stops.indexOf(id);
    if (i !== -1) next = pattern.stops[i + 1];
  }
  return {
    id,
    state:
      at?.state ??
      (bus.status === 0 && now - (bus.statusTime ?? bus.timestamp) <= 20 && id === bus.stopId
        ? 'approaching'
        : 'next'),
    next: at && next !== id ? stops[next]?.name : undefined,
  };
}
