// Local coordinates are metres. The platform runs along Z, with the kerb on the negative X side.
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {MercatorCoordinate} from 'maplibre-gl';

function solid(parts) {
  const geometries = parts.map(([geometry, colour, x, y, z]) => {
    const triangles = geometry.index ? geometry.toNonIndexed() : geometry;
    if (geometry !== triangles) geometry.dispose();
    triangles.translate(x, y, z);
    triangles.deleteAttribute('uv');
    const tint = new THREE.Color(colour);
    const colors = new Float32Array(triangles.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) tint.toArray(colors, i);
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
const oval = (x, y, z, w, h, d, colour) => [
  new THREE.SphereGeometry(1, 10, 8).scale(w, h, d),
  colour,
  x,
  y,
  z,
];

function platformKit() {
  const green = '#355e5a',
    metal = '#93abad',
    trim = '#47877d',
    wood = '#c99564';
  const pole = solid([
    tube(0, 1.65, 0, 0.055, 0.065, 3.3, metal),
    box(0, 2.97, 0, 0.075, 0.67, 0.54, '#e8e9dc'),
    box(0, 2.37, 0, 0.08, 0.4, 0.56, '#f8f7e6'),
    box(0, 1.64, 0, 0.11, 0.5, 0.31, '#637c83'),
    box(-0.061, 1.64, 0, 0.012, 0.43, 0.25, '#eceddf'),
  ]);
  const shelter = [
    box(1.55, 2.55, 2.1, 1.82, 0.07, 4.7, '#80a8a3'),
    box(0.675, 2.52, 2.1, 0.095, 0.17, 4.72, green),
    box(2.43, 2.49, 2.1, 0.09, 0.17, 4.72, green),
    box(0.72, 2.44, 2.1, 0.035, 0.046, 4.52, '#ffe9a6'),
  ];
  for (const z of [-0.13, 2.1, 4.33]) shelter.push(box(2.34, 1.24, z, 0.085, 2.48, 0.085, green));
  for (const z of [-0.13, 4.33]) {
    shelter.push(box(1.56, 2.46, z, 1.7, 0.14, 0.09, green), box(1.22, 1.22, z, 0.065, 2.44, 0.07, trim));
  }
  // Four slightly crowned roof lights and thin aluminium glazing bars read in an oblique view.
  for (const z of [0.41, 1.54, 2.67, 3.8]) {
    shelter.push(
      box(1.54, 2.595, z, 1.62, 0.038, 1.08, '#a4c9c1'),
      box(1.55, 2.62, z + 0.55, 1.82, 0.032, 0.035, metal),
    );
  }
  const glass = [box(2.33, 1.28, 2.1, 0.035, 2.18, 4.36, '#95cfcb')];
  for (const z of [-0.13, 4.33]) glass.push(box(1.77, 1.28, z, 1.11, 2.18, 0.036, '#95cfcb'));
  for (const y of [0.92, 1.48]) {
    shelter.push(box(2.3, y, 2.1, 0.017, 0.025, 4.28, '#cedfd7'));
    for (const z of [-0.13, 4.33]) shelter.push(box(1.77, y, z, 1.1, 0.025, 0.042, '#dee8df'));
  }
  shelter.push(
    box(2.23, 1.58, 0.49, 0.11, 0.8, 0.68, green),
    box(2.162, 1.58, 0.49, 0.025, 0.69, 0.56, '#f0f1df'),
    box(2.143, 1.81, 0.49, 0.016, 0.055, 0.47, '#2482a8'),
  );
  for (let n = 0; n < 7; n++) shelter.push(box(2.142, 1.72 - n * 0.06, 0.49, 0.016, 0.012, 0.43, metal));
  const bench = [];
  for (const x of [1.62, 1.77, 1.92]) bench.push(box(x, 0.5, 2.6, 0.13, 0.075, 1.92, wood));
  for (const y of [0.74, 0.92]) bench.push(box(1.99, y, 2.6, 0.07, 0.12, 1.92, wood));
  for (const z of [1.84, 3.36])
    bench.push(box(1.76, 0.25, z, 0.085, 0.5, 0.12, green), box(1.95, 0.68, z, 0.07, 0.57, 0.07, green));
  const palettes = [
    ['#be573f', '#293b57', '#eeaf8b', '#eeb94b', '#513842'],
    ['#427468', '#26394b', '#b97e59', '#e9d9bb', '#643f30'],
    ['#d49b41', '#374852', '#825238', '#433e67', '#607c96'],
  ];
  const people = palettes.map(([coat, trousers, skin, hat, bag]) => {
    const body = solid([
      oval(0, 1.07, 0, 0.225, 0.36, 0.155, coat),
      tube(0, 0.88, 0, 0.19, 0.216, 0.25, coat),
      oval(-0.22, 1.05, 0, 0.073, 0.25, 0.077, coat),
      oval(0.22, 1.04, -0.035, 0.073, 0.25, 0.078, coat),
      oval(-0.22, 0.815, 0, 0.064, 0.072, 0.068, skin),
      oval(0.22, 0.81, -0.045, 0.063, 0.072, 0.068, skin),
      oval(0, 1.53, -0.01, 0.139, 0.168, 0.135, skin),
      oval(0, 1.646, 0.004, 0.146, 0.108, 0.145, hat),
      tube(0, 1.604, 0.004, 0.15, 0.15, 0.052, hat),
      oval(0, 1.75, 0.025, 0.047, 0.048, 0.047, hat),
      oval(0, 1.373, 0, 0.167, 0.059, 0.143, hat),
      box(0.102, 1.252, -0.138, 0.075, 0.21, 0.034, hat),
      oval(0, 1.1, 0.147, 0.14, 0.213, 0.085, bag),
    ]);
    const leg = solid([
      tube(0, -0.178, 0, 0.082, 0.061, 0.37, trousers),
      tube(0, -0.5, 0.005, 0.064, 0.052, 0.3, trousers),
      oval(0, -0.66, -0.041, 0.068, 0.071, 0.12, '#253139'),
    ]);
    return {body, leg};
  });
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
  const opaque = new THREE.MeshLambertMaterial({vertexColors: true});
  const glass = new THREE.MeshPhongMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.27,
    depthWrite: false,
    shininess: 55,
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
  let kit, lastBounds, event;
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
  function refresh() {
    const bounds = map.getBounds(),
      zoom = map.getZoom();
    const key =
      zoom < 17.8
        ? 'far'
        : bounds
            .toArray()
            .flat()
            .map((v) => v.toFixed(5))
            .join('/');
    if (key === lastBounds) return;
    lastBounds = key;
    const nearby = [];
    if (zoom >= 17.8) {
      const center = map.getCenter();
      for (let x = cell(bounds.getWest()); x <= cell(bounds.getEast()); x++)
        for (let y = cell(bounds.getSouth()); y <= cell(bounds.getNorth()); y++)
          for (const entry of grid.get(gridKey(x, y)) ?? [])
            if (bounds.contains(entry.site.point)) nearby.push(entry);
      const dist = (e) => Math.hypot((center.lng - e.site.point[0]) * 0.5, center.lat - e.site.point[1]);
      nearby.sort((a, b) => dist(a) - dist(b));
      nearby.length = Math.min(nearby.length, 36);
    }
    const retained = new Set(nearby.map((e) => e.id));
    for (const item of active.values()) if (!retained.has(item.id)) release(item);
    for (const e of nearby) if (!active.has(e.id)) active.set(e.id, make(e));
  }
  function update(vehicles, now) {
    refresh();
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
    for (const [i, doorZ] of [
      [0, -5.1],
      [1, 0.44],
    ]) {
      const person = item.figures[i],
        boarding = i === 0;
      const dest = item.group.worldToLocal(
        new THREE.Vector3(
          busOrigin.x + size * (1.42 * Math.cos(angle) - doorZ * Math.sin(angle)),
          0,
          busOrigin.z + size * (1.42 * Math.sin(angle) + doorZ * Math.cos(angle)),
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
  return {update, dispose, pick};
}
