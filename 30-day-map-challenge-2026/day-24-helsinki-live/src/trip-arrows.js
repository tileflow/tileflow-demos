import {atOffset, coverageInterval, distance, heading, turn} from './route-track.js';

// A whole zoom step doubles the number of anchors without sliding the old
// anchors along the street. At Helsinki's latitude this is about 85 px apart.
const arrowBudget = 320;
const spacingAt = zoom => 12.5 * 2 ** Math.max(-1, 18 - Math.floor(zoom));

// Preserve trip offsets even when only a small slice of a long segment is on screen.
function visibleRuns(sections, bounds) {
  const runs = [];
  for (const {coordinates, offsets} of sections) {
    const track = {line: coordinates, offsets};
    let run;
    for (let i = 1; i < coordinates.length; i++) {
      const start = offsets[i - 1], end = offsets[i];
      if (start >= end) continue;
      const interval = coverageInterval(bounds, coordinates[i - 1], coordinates[i]);
      if (!interval) continue;
      const from = interval[0] === 0 ? start : start + (end - start) * interval[0];
      const to = interval[1] === 1 ? end : start + (end - start) * interval[1];
      if (run && run.end === from) run.end = to;
      else {
        run = {track, start: from, end: to};
        runs.push(run);
      }
    }
  }
  return runs;
}

export function tripArrows(sections, bounds, zoom) {
  if (!sections?.length || !bounds || !Number.isFinite(zoom)) return [];
  const box = Array.isArray(bounds) ? bounds :
    [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
  const runs = visibleRuns(sections, box);
  if (!runs.length) return [];
  let spacing = spacingAt(zoom);
  function countAnchors() {
    return runs.reduce((count, run) => count + Math.max(0,
      Math.floor(run.end / spacing) - Math.max(1, Math.ceil(run.start / spacing)) + 1), 0);
  }
  while (countAnchors() > arrowBudget) spacing *= 2;

  const features = [], buckets = new Map();
  const tolerance = spacing * .24;
  const dy = tolerance / 111195, dx = dy / Math.cos((box[1] + box[3]) * Math.PI / 360);

  function place(run, offset, index, allowShift) {
    const {track} = run;
    const point = atOffset(track, offset);
    const radius = Math.min(3, spacing * .08);
    const before = atOffset(track, Math.max(track.offsets[0], offset - radius));
    const after = atOffset(track, Math.min(track.offsets.at(-1), offset + radius));
    if (distance(before, after) < .1) return; // Exactly at a reversal or a repeated vertex.
    const bearing = heading(before, after);
    const x = Math.floor(point[0] / dx), y = Math.floor(point[1] / dy);
    for (let i = x - 1; i <= x + 1; i++) {
      for (let j = y - 1; j <= y + 1; j++) {
        const nearby = buckets.get(i + '/' + j) ?? [];
        for (const previous of nearby) {
          if (distance(previous.geometry.coordinates, point) >= tolerance) continue;
          // If the same bus later retraces this road in the opposite direction,
          // interleave the two arrows without offsetting either from the carriageway.
          const alternative = offset + spacing * .4;
          if (allowShift && turn(previous.properties.bearing, bearing) > 110 && alternative <= run.end)
            place(run, alternative, index, false);
          return;
        }
      }
    }
    const feature = {
      type: 'Feature', properties: {offset, bearing, phase: index % 3},
      geometry: {type: 'Point', coordinates: point},
    };
    const key = x + '/' + y;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(feature);
    features.push(feature);
  }

  for (const run of runs) {
    const first = Math.max(1, Math.ceil(run.start / spacing));
    const last = Math.floor(run.end / spacing);
    for (let i = first; i <= last; i++) place(run, i * spacing, i, true);
  }
  // A short entire trip can be smaller than one arrow interval at city zoom.
  const total = sections.at(-1).offsets.at(-1);
  if (!features.length && total < spacing) {
    const mid = total / 2;
    const containing = runs.find(run => run.start <= mid && run.end >= mid);
    if (containing) place(containing, mid, 0, false);
  }
  return features;
}
