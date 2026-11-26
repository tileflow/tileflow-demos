import {Matrix4, Vector4} from 'three';
import {MercatorCoordinate} from 'maplibre-gl';

// Streets packs tile x/y and base/top in the first four uint16s of each
// 28-byte vertex. Keep just the positions, index ranges and per-building boxes
// after the renderer uploads its buffers. A tile's numeric feature index is
// available even when the source provides no OSM identifier.
export function indexBuildingFaces(bytes, indices) {
  const source = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.byteLength / 28;
  const points = new Uint16Array(count * 3);
  const parts = new Uint32Array(count);
  const footprints = [];
  const buildings = new Map();
  for (let i = 0; i < count; i++) {
    const offset = i * 28;
    const x = source.getUint16(offset, true),
      y = source.getUint16(offset + 2, true);
    const z = source.getUint16(offset + (source.getUint8(offset + 10) ? 6 : 4), true);
    const id = source.getUint16(offset + 24, true);
    // World can group separate houses with the same properties into one
    // MultiPolygon feature. Streets packs the individual polygon centre too.
    const cx = source.getUint16(offset + 16, true),
      cy = source.getUint16(offset + 18, true);
    const key = (id * 65536 + cx) * 65536 + cy;
    points[3 * i] = x;
    points[3 * i + 1] = y;
    points[3 * i + 2] = z;
    let building = buildings.get(key);
    if (!building) {
      building = {id, part: footprints.length, min: [x, y, z], max: [x, y, z], runs: []};
      buildings.set(key, building);
      footprints.push(building);
    } else {
      building.min[0] = Math.min(x, building.min[0]);
      building.max[0] = Math.max(x, building.max[0]);
      building.min[1] = Math.min(y, building.min[1]);
      building.max[1] = Math.max(y, building.max[1]);
      building.min[2] = Math.min(z, building.min[2]);
      building.max[2] = Math.max(z, building.max[2]);
    }
    parts[i] = building.part;
  }
  let previous;
  for (let i = 0; i < indices.length; i += 3) {
    const part = parts[indices[i]];
    if (previous?.part !== part) {
      previous = {part, from: i, count: 0};
      footprints[part].runs.push(previous);
    }
    previous.count += 3;
  }
  return {points, indices, buildings};
}

function reachesBox(origin, direction, box) {
  let enter = 0,
    exit = 1;
  for (let i = 0; i < 3; i++) {
    const d = direction[i];
    if (Math.abs(d) < 1e-9) {
      if (origin[i] < box.min[i] || origin[i] > box.max[i]) return false;
      continue;
    }
    const t0 = (box.min[i] - origin[i]) / d,
      t1 = (box.max[i] - origin[i]) / d;
    enter = Math.max(enter, Math.min(t0, t1));
    exit = Math.min(exit, Math.max(t0, t1));
    if (enter > exit) return false;
  }
  return true;
}

// Double-sided segment/triangle intersection. Both ends are bounded: a roof
// beyond the bus, a courtyard and a bridge above the sightline stay opaque.
function hitsFace(origin, d, p, a, b, c) {
  const ax = p[a],
    ay = p[a + 1],
    az = p[a + 2];
  const ex = p[b] - ax,
    ey = p[b + 1] - ay,
    ez = p[b + 2] - az;
  const fx = p[c] - ax,
    fy = p[c + 1] - ay,
    fz = p[c + 2] - az;
  const hx = d[1] * fz - d[2] * fy,
    hy = d[2] * fx - d[0] * fz,
    hz = d[0] * fy - d[1] * fx;
  const determinant = ex * hx + ey * hy + ez * hz;
  if (Math.abs(determinant) < 1e-8) return false;
  const sx = origin[0] - ax,
    sy = origin[1] - ay,
    sz = origin[2] - az;
  const u = (sx * hx + sy * hy + sz * hz) / determinant;
  if (u < 0 || u > 1) return false;
  const qx = sy * ez - sz * ey,
    qy = sz * ex - sx * ez,
    qz = sx * ey - sy * ex;
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) / determinant;
  if (v < 0 || u + v > 1) return false;
  const t = (fx * qx + fy * qy + fz * qz) / determinant;
  return t > 0 && t < 1;
}

export function blockingBuildings(mesh, rays) {
  const hits = [];
  for (const b of mesh.buildings.values()) {
    if (
      rays.some(({origin, direction}) => {
        if (!reachesBox(origin, direction, b)) return false;
        for (const {from, count} of b.runs) {
          for (let i = from; i < from + count; i += 3) {
            if (
              hitsFace(
                origin,
                direction,
                mesh.points,
                mesh.indices[i] * 3,
                mesh.indices[i + 1] * 3,
                mesh.indices[i + 2] * 3,
              )
            )
              return true;
          }
        }
        return false;
      })
    )
      hits.push(b);
  }
  return hits;
}

export function separateRanges(visible, blocked) {
  if (!blocked.length) return {solid: visible, glass: []};
  const runs = blocked.flatMap((b) => b.runs).sort((a, b) => a.from - b.from);
  const solid = [],
    glass = [];
  for (const {from, count} of visible) {
    let cursor = from;
    const end = from + count;
    for (const r of runs) {
      if (r.from >= end) break;
      const start = Math.max(cursor, r.from),
        stop = Math.min(end, r.from + r.count);
      if (start >= stop) continue;
      if (cursor < start) solid.push({from: cursor, count: start - cursor});
      glass.push({from: start, count: stop - start});
      cursor = stop;
    }
    if (cursor < end) solid.push({from: cursor, count: end - cursor});
  }
  return {solid, glass};
}

export function createBuildingOcclusion(map) {
  const meshes = new WeakMap();
  const tilePasses = new Map();
  let target,
    pending,
    blockedCount = 0;
  let lastTarget;
  const matrix = new Matrix4(),
    inverse = new Matrix4(),
    tip = new Vector4(),
    eye = new Vector4();
  function raysForTile(x, y, zoom, projection, scale) {
    const n = 2 ** zoom;
    matrix.fromArray(projection);
    inverse.copy(matrix).invert();
    const rays = [];
    for (const point of target) {
      const tx = (point.x * n - x) * 8192,
        ty = (point.y * n - y) * 8192;
      tip.set(tx, ty, point.z, 1).applyMatrix4(matrix);
      if (tip.w <= 0 || Math.abs(tip.x / tip.w) > 1.04 || Math.abs(tip.y / tip.w) > 1.04) continue;
      eye.set(tip.x / tip.w, tip.y / tip.w, -1, 1).applyMatrix4(inverse);
      if (Math.abs(eye.w) < 1e-10) continue;
      const origin = [eye.x / eye.w, eye.y / eye.w, ((eye.z / eye.w) * 10) / scale];
      rays.push({
        origin,
        direction: [tx - origin[0], ty - origin[1], (point.z * 10) / scale - origin[2]],
      });
    }
    return rays;
  }
  const api = {
    target(bus, coordinate) {
      if (!bus || !coordinate || map.getZoom() < 15 || map.getPitch() < 8) {
        target = undefined;
        lastTarget = undefined;
        pending = undefined;
        return;
      }
      const scale = Math.max(1, Math.min(3, 2 ** (15.5 - map.getZoom())));
      if (
        lastTarget?.id === bus.id &&
        lastTarget.lng === coordinate[0] &&
        lastTarget.lat === coordinate[1] &&
        lastTarget.bearing === bus.bearing &&
        lastTarget.scale === scale
      )
        return;
      lastTarget = {id: bus.id, lng: coordinate[0], lat: coordinate[1], bearing: bus.bearing, scale};
      const p = MercatorCoordinate.fromLngLat(coordinate),
        unit = p.meterInMercatorCoordinateUnits();
      const bearing = ((bus.bearing || 0) * Math.PI) / 180;
      target = [-4.8, 0, 4.8].map((m) => ({
        x: p.x + Math.sin(bearing) * m * scale * unit,
        y: p.y - Math.cos(bearing) * m * scale * unit,
        z: 2.25 * scale,
      }));
    },
    register(entry, vertices, indices) {
      meshes.set(entry, indexBuildingFaces(vertices, indices));
    },
    begin() {
      tilePasses.clear();
      pending = undefined;
      blockedCount = 0;
    },
    ranges(glass, entry, visible, x, y, zoom, projectionData, scale) {
      const mesh = meshes.get(entry);
      if (!target || !mesh || scale <= 0.9) return glass ? [] : visible;
      let passes = tilePasses.get(entry);
      if (!passes) {
        const projection = projectionData().mainMatrix;
        let snapshot = mesh.lastView;
        if (
          snapshot?.target !== target ||
          snapshot.scale !== scale ||
          !projection.every((value, i) => value === snapshot.matrix[i])
        ) {
          const blocked = blockingBuildings(mesh, raysForTile(x, y, zoom, projection, scale));
          snapshot = {target, scale, matrix: Array.from(projection), blocked};
          mesh.lastView = snapshot;
        }
        const {blocked} = snapshot;
        passes = separateRanges(visible, blocked);
        tilePasses.set(entry, passes);
        blockedCount += blocked.length;
      }
      return glass ? passes.glass : passes.solid;
    },
    defer(draw) {
      if (blockedCount) pending = draw;
    },
    get blockedCount() {
      return blockedCount;
    },
    layer: {
      id: 'hsl-occluding-buildings',
      type: 'custom',
      renderingMode: '3d',
      render(gl) {
        const draw = pending;
        pending = undefined;
        if (draw) {
          gl.enable(gl.DEPTH_TEST);
          draw();
        }
      },
      onRemove() {
        pending = undefined;
        tilePasses.clear();
      },
    },
  };
  return api;
}
