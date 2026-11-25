// Local coordinates are metres. The platform runs along Z, with the kerb on the negative X side.
import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {MercatorCoordinate} from 'maplibre-gl';
import {ARCO} from './arco-model.js';

function solid(parts) {
  const geometries = parts.map(([geometry, colour, x, y, z]) => {
    const triangles = geometry.index ? geometry.toNonIndexed() : geometry;
    if (geometry !== triangles) geometry.dispose();
    triangles.translate(x, y, z);
    triangles.deleteAttribute('uv');
    const tint = new THREE.Color(colour);
    const colors = new Float32Array(triangles.attributes.position.count * 3);
    const normals = triangles.getAttribute('normal');
    // A little form shading keeps small symbols legible in every Streets lighting preset.
    for (let i = 0; i < normals.count; i++) {
      const light = 0.78 + 0.17 * Math.max(0, normals.getY(i)) - 0.05 * normals.getX(i);
      colors.set([tint.r * light, tint.g * light, tint.b * light], i * 3);
    }
    triangles.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return triangles;
  });
  const result = mergeGeometries(geometries);
  geometries.forEach((p) => p.dispose());
  return result;
}
const box = (x, y, z, w, h, d, colour) => [new THREE.BoxGeometry(w, h, d), colour, x, y, z];
const tube = (x, y, z, top, bottom, h, colour) => [
  new THREE.CylinderGeometry(top, bottom, h, 10),
  colour,
  x,
  y,
  z,
];
function bevel(x, y, z, w, h, d, radius, colour) {
  return [new RoundedBoxGeometry(w, h, d, 1, radius), colour, x, y, z];
}

// A few elliptical sections describe a garment or a head without facial detail.
function profile(x, y, z, sections, depth, colour) {
  const outline = sections.map(([radius, height]) => new THREE.Vector2(radius, height));
  const shape = new THREE.LatheGeometry(outline, 12).scale(1, 1, depth);
  return [shape, colour, x, y, z];
}

function passenger(coat, trousers, skin, cap, scarf) {
  const sleeve = [[0, 0], [0.066, 0.02], [0.076, 0.21], [0.082, 0.32], [0.054, 0.39], [0, 0.42]];
  const body = solid([
    profile(0, 0.72, 0,
      [[0, 0], [0.19, 0], [0.225, 0.045], [0.223, 0.15], [0.182, 0.57], [0.14, 0.62], [0, 0.63]],
      0.74, coat),
    ...[-1, 1].map((side) => profile(side * 0.191, 0.875, -0.014, sleeve, 0.96, coat)),
    profile(0, 1.37, 0,
      [[0, 0], [0.105, 0.014], [0.145, 0.065], [0.15, 0.19], [0.122, 0.235], [0, 0.242]],
      0.91, skin),
    profile(0, 1.533, 0,
      [[0, 0], [0.151, 0], [0.158, 0.035], [0.151, 0.109], [0.119, 0.152], [0.063, 0.173], [0, 0.179]],
      0.94, cap),
    profile(0, 1.321, 0, [[0, 0], [0.155, 0], [0.166, 0.018], [0.151, 0.074], [0, 0.076]], 0.90, scarf),
    bevel(0.080, 1.265, -0.118, 0.084, 0.15, 0.038, 0.014, scarf),
  ]);
  const leg = solid([
    profile(0, -0.64, 0,
      [[0, 0], [0.057, 0], [0.068, 0.19], [0.071, 0.34], [0.085, 0.63], [0, 0.66]],
      1.02, trousers),
    bevel(0, -0.669, -0.043, 0.145, 0.117, 0.215, 0.045, '#354758'),
  ]);
  return {body, leg};
}

function platformKit() {
  const frame = '#35576a', jade = '#65a7a2', honey = '#ffd16a', glassTint = '#99d9db';
  const pole = solid([
    tube(0, 1.65, 0, 0.052, 0.062, 3.3, '#a5b7bc'),
    bevel(0, 2.79, 0, 0.09, 1.085, 0.57, 0.036, frame),
    bevel(0, 1.64, 0, 0.11, 0.50, 0.31, 0.027, frame),
    box(-0.064, 1.64, 0, 0.025, 0.40, 0.23, '#dbe6df'),
  ]);
  const shelter = [
    // The familiar glass bay, with the bus's rounded cap and narrow warm reveal.
    bevel(1.55, 2.48, 2.1, 1.82, 0.13, 4.72, 0.058, frame),
    bevel(1.55, 2.574, 2.1, 1.84, 0.076, 4.73, 0.032, honey),
    bevel(1.55, 2.655, 2.1, 1.86, 0.135, 4.75, 0.062, jade),
    bevel(1.55, 2.726, 2.1, 0.94, 0.018, 3.44, 0.008, '#a1cec4'),
    bevel(2.251, 1.58, 0.49, 0.096, 0.77, 0.61, 0.040, frame),
    box(2.193, 1.58, 0.49, 0.027, 0.64, 0.50, '#e5efea'),
    box(2.174, 1.76, 0.49, 0.015, 0.072, 0.49, '#518ca3'),
    box(2.293, 1.12, 2.10, 0.046, 0.055, 4.30, '#abd6d0'),
  ];
  for (const z of [-0.13, 4.33]) {
    shelter.push(
      bevel(2.34, 1.21, z, 0.11, 2.43, 0.11, 0.03, frame),
      bevel(1.22, 1.21, z, 0.083, 2.43, 0.083, 0.026, frame),
      box(1.77, 1.12, z, 1.13, 0.055, 0.05, '#abd6d0'),
    );
  }
  shelter.push(box(2.34, 1.21, 2.1, 0.08, 2.43, 0.08, frame));
  const glass = [box(2.33, 1.28, 2.1, 0.035, 2.18, 4.36, glassTint)];
  for (const z of [-0.13, 4.33]) glass.push(box(1.77, 1.28, z, 1.11, 2.18, 0.036, glassTint));
  const bench = [
    bevel(1.77, 0.50, 2.6, 0.45, 0.105, 1.92, 0.044, '#d4aa75'),
    bevel(1.99, 0.84, 2.6, 0.09, 0.23, 1.92, 0.039, '#d4aa75'),
  ];
  for (const z of [1.84, 3.36]) {
    bench.push(box(1.76, 0.23, z, 0.09, 0.46, 0.12, frame), box(1.96, 0.64, z, 0.065, 0.56, 0.065, frame));
  }
  const people = [
    passenger('#77c5bb', '#354c63', '#bb805d', '#487492', honey),
    passenger('#e9927d', '#464962', '#edbf9b', '#955a88', '#ffe1a2'),
    passenger('#929acd', '#3d5064', '#9d7055', '#648587', '#c5e5d7'),
  ];
  return {pole, shelter: solid(shelter), glass: solid(glass), bench: solid(bench), people};
}

function flag(stop) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 432;
  const c = canvas.getContext('2d');
  c.fillStyle = '#ffcd36';
  c.fillRect(0, 0, 256, 235);
  c.fillStyle = '#20313c';
  c.beginPath();
  c.roundRect(30, 68, 195, 85, [14, 22, 7, 7]);
  c.fill();
  c.fillStyle = '#ffcd36';
  for (const x of [46, 83, 120, 157]) c.fillRect(x, 80, 30, 33);
  c.fillRect(194, 84, 16, 32);
  for (const x of [72, 186]) {
    c.fillStyle = '#ffcd36';
    c.beginPath();
    c.arc(x, 151, 21, 0, 7);
    c.fill();
    c.fillStyle = '#20313c';
    c.beginPath();
    c.arc(x, 151, 15, 0, 7);
    c.fill();
  }
  c.fillStyle = '#f7faf4';
  c.fillRect(0, 237, 256, 195);
  c.fillStyle = '#0072ad';
  c.fillRect(0, 237, 256, 65);
  c.fillStyle = 'white';
  c.textAlign = 'center';
  c.font = 'bold 45px Arial';
  c.fillText(stop.code, 128, 285, 234);
  c.fillStyle = '#213743';
  c.font = 'bold 32px Arial';
  c.fillText(stop.name, 128, 364, 239);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({map: texture});
}

const gridKey = (x, y) => x + ',' + y;
const cell = (n) => Math.floor(n * 200);
const rad = Math.PI / 180;
const waiting = [
  [0.5, -1.05],
  [0.68, 2.15],
  [0.44, 3.36],
];

// From directly overhead a listing of platforms is more legible than the edge
// of a metre-scale sign. Keep the 2D flag until the street furniture is useful.
export function showPlatformModels(map) {
  return map.getZoom() >= 18.4 && map.getPitch() >= 20;
}

export function createPlatformScene(scene, map, origin, metres, facilities, stops) {
  const grid = new Map(),
    active = new Map();
  for (const [id, site] of Object.entries(facilities)) {
    if (!Number.isFinite(site.bearing) || !site.point || !stops[id]) continue;
    const key = gridKey(...site.point.map(cell));
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push({id, site, stop: stops[id]});
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const opaque = new THREE.MeshBasicMaterial({vertexColors: true});
  const glass = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  const face = new THREE.PlaneGeometry(0.53, 1.02);
  const shadeCanvas = document.createElement('canvas');
  shadeCanvas.width = shadeCanvas.height = 32;
  const ctx = shadeCanvas.getContext('2d');
  const fade = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  fade.addColorStop(0, 'rgba(12,26,35,.62)');
  fade.addColorStop(1, 'rgba(12,26,35,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 32, 32);
  const shade = new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(shadeCanvas),
    transparent: true,
    depthWrite: false,
  });
  const footprint = new THREE.PlaneGeometry(0.74, 0.6).rotateX(-Math.PI / 2);
  let kit, lastBounds, lastTripStops, event;
  function local(point) {
    const p = MercatorCoordinate.fromLngLat(point);
    return new THREE.Vector3((p.x - origin.x) / metres, 0, (p.y - origin.y) / metres);
  }
  function mesh(geo, mat = opaque) {
    return new THREE.Mesh(geo, mat);
  }
  function make({id, site, stop}) {
    kit ??= platformKit();
    const group = new THREE.Group();
    group.userData.stopId = id;
    group.position.copy(local(site.point));
    group.rotation.y = -site.bearing * rad;
    group.scale.setScalar(
      MercatorCoordinate.fromLngLat(site.point).meterInMercatorCoordinateUnits() / metres,
    );
    group.add(mesh(kit.pole));
    const nameplate = flag(stop);
    for (const side of [-1, 1]) {
      const plate = mesh(face, nameplate);
      plate.rotation.y = (side * Math.PI) / 2;
      plate.position.set(side * 0.048, 2.79, 0);
      group.add(plate);
    }
    if (site.shelter && !site.nativeRoof && !site.roofs?.length)
      group.add(mesh(kit.shelter), mesh(kit.glass, glass));
    if (site.bench) group.add(mesh(kit.bench));
    const figures = waiting.map(([x, z], i) => {
      const style = kit.people[(Number(id) + i) % kit.people.length],
        person = new THREE.Group();
      person.add(mesh(style.body));
      for (const side of [-1, 1]) {
        const leg = mesh(style.leg);
        leg.position.set(side * 0.091, 0.73, 0);
        person.add(leg);
      }
      const shadow = mesh(footprint, shade);
      shadow.position.y = 0.018;
      person.add(shadow);
      person.position.set(x, 0, z);
      person.scale.setScalar([0.96, 1.05, 0.9][i]);
      group.add(person);
      return person;
    });
    scene.add(group);
    return {id, group, figures, nameplate, exchanged: false};
  }
  function release(item) {
    scene.remove(item.group);
    item.nameplate.map.dispose();
    item.nameplate.dispose();
    active.delete(item.id);
  }
  function refresh(tripStops) {
    const bounds = map.getBounds();
    const show = showPlatformModels(map);
    const key =
      !show
        ? 'far'
        : bounds
            .toArray()
            .flat()
            .map((v) => v.toFixed(5))
            .join('/');
    if (key === lastBounds && tripStops === lastTripStops) return;
    lastBounds = key;
    lastTripStops = tripStops;
    const nearby = [];
    if (show) {
      const center = map.getCenter();
      for (let x = cell(bounds.getWest()); x <= cell(bounds.getEast()); x++)
        for (let y = cell(bounds.getSouth()); y <= cell(bounds.getNorth()); y++)
          for (const entry of grid.get(gridKey(x, y)) ?? [])
            if ((!tripStops || tripStops.has(entry.id)) && bounds.contains(entry.site.point)) nearby.push(entry);
      const dist = (e) => Math.hypot((center.lng - e.site.point[0]) * 0.5, center.lat - e.site.point[1]);
      nearby.sort((a, b) => dist(a) - dist(b));
      nearby.length = Math.min(nearby.length, 36);
    }
    const retained = new Set(nearby.map((e) => e.id));
    if (retained.size === active.size && nearby.every(({id}) => active.has(id))) return;
    for (const item of active.values()) if (!retained.has(item.id)) release(item);
    for (const e of nearby) if (!active.has(e.id)) active.set(e.id, make(e));
    return retained;
  }
  function update(vehicles, now) {
    const bus = vehicles.find((b) => b.selected && b.doors && b.doorStop);
    const item = bus && active.get(bus.doorStop);
    if (!item || event?.bus !== bus.id || event?.stop !== bus.doorStop) event = undefined;
    if (item && !event) {
      event = {bus: bus.id, stop: bus.doorStop, start: now};
      item.exchanged = false;
    }
    for (const platform of active.values()) {
      for (const [i, person] of platform.figures.entries()) {
        const [x, z] = waiting[i];
        person.visible = i === 2 || (platform.exchanged ? i === 1 : i === 0);
        person.position.set(x, 0, z);
        person.rotation.y = 1.17 + i * 0.36;
        person.children[1].rotation.x = person.children[2].rotation.x = 0;
      }
    }
    if (!event || reduced.matches) return;
    item.group.updateMatrixWorld(true);
    const busOrigin = local(bus.coordinate);
    const angle = bus.bearing * rad,
      size = MercatorCoordinate.fromLngLat(bus.coordinate).meterInMercatorCoordinateUnits() / metres;
    const seconds = (now - event.start) / 1000;
    for (let i = 0; i < 2; i++) {
      const person = item.figures[i],
        boarding = i === 0;
      const doorZ = ARCO.doorZ + (boarding ? -0.2 : 0.2);
      const dest = item.group.worldToLocal(
        new THREE.Vector3(
          busOrigin.x + size * (ARCO.boardingX * Math.cos(angle) - doorZ * Math.sin(angle)),
          0,
          busOrigin.z + size * (ARCO.boardingX * Math.sin(angle) + doorZ * Math.cos(angle)),
        ),
      );
      // Suppress the exchange when the HFP and mapped kerb disagree or the bus is across the street.
      if (
        dest.x > 1.15 ||
        dest.x < -8 ||
        Math.abs(dest.z) > 14 ||
        Math.cos(angle + item.group.rotation.y) < 0.68
      )
        continue;
      person.visible = true;
      const start = waiting[i],
        end = [dest.x, dest.z];
      const bend = [Math.max(end[0] + 0.8, Math.min(start[0], 0.08)), end[1] + (boarding ? 0.38 : -0.38)];
      const a = boarding ? start : end,
        b = boarding ? end : start;
      const l1 = Math.hypot(bend[0] - a[0], bend[1] - a[1]),
        l2 = Math.hypot(b[0] - bend[0], b[1] - bend[1]);
      const elapsed = seconds - (boarding ? 0.85 : 0.35);
      const travelled = Math.max(0, elapsed) * 1.75;
      if (boarding && travelled >= l1 + l2) item.exchanged = true;
      if ((!boarding && elapsed < 0) || (boarding && travelled >= l1 + l2)) {
        person.visible = false;
        continue;
      }
      const first = travelled < l1,
        from = first ? a : bend,
        to = first ? bend : b;
      const u = Math.min(1, (first ? travelled : travelled - l1) / Math.max(0.01, first ? l1 : l2));
      person.position.set(from[0] + (to[0] - from[0]) * u, 0, from[1] + (to[1] - from[1]) * u);
      if (elapsed > 0 && travelled < l1 + l2) {
        person.rotation.y = Math.atan2(from[0] - to[0], from[1] - to[1]);
        const stride = 0.43 * Math.sin(elapsed * 8.6);
        person.children[1].rotation.x = stride;
        person.children[2].rotation.x = -stride;
        person.position.y = 0.022 * Math.abs(stride);
      }
    }
  }
  function dispose() {
    for (const e of active.values()) release(e);
    if (kit) {
      for (const key of ['pole', 'shelter', 'glass', 'bench']) kit[key].dispose();
      for (const p of kit.people) {
        p.body.dispose();
        p.leg.dispose();
      }
    }
    shade.map.dispose();
    shade.dispose();
    footprint.dispose();
    face.dispose();
    opaque.dispose();
    glass.dispose();
  }
  // Project the centre and corners of the plate itself, using the same group
  // transform as the physical pole (including altitude, orientation and scale).
  const projected = new THREE.Vector3();
  const flagMatrix = new THREE.Matrix4();
  function flagPoint(id, camera, canvas) {
    const item = active.get(id);
    if (!item) return null;
    flagMatrix.multiplyMatrices(camera.projectionMatrix, item.group.matrixWorld);
    projected.set(0, 2.79, 0).applyMatrix4(flagMatrix);
    if (projected.z < -1 || projected.z > 1) return null;
    const w = canvas.clientWidth / 2, h = canvas.clientHeight / 2;
    const x = (1 + projected.x) * w, y = (1 - projected.y) * h;
    let left = x, right = x, top = y, bottom = y;
    for (const z of [-.265, .265]) for (const dy of [-.51, .51]) {
      projected.set(0, 2.79 + dy, z).applyMatrix4(flagMatrix);
      const px = (1 + projected.x) * w, py = (1 - projected.y) * h;
      left = Math.min(left, px); right = Math.max(right, px);
      top = Math.min(top, py); bottom = Math.max(bottom, py);
    }
    return {x, y, left, right, top, bottom};
  }
  function pick(raycaster) {
    const intersections = raycaster.intersectObjects(
      Array.from(active.values(), (item) => item.group),
      true,
    );
    for (const hit of intersections) {
      let object = hit.object;
      while (object && object.visible) {
        if (object.userData.stopId) return {kind: 'stop', id: object.userData.stopId, distance: hit.distance};
        object = object.parent;
      }
    }
  }
  return {refresh, update, dispose, pick, flagPoint};
}
