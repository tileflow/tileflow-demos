// A low-floor city bus in metres. Local +X is the door side, +Y is up and the nose points north (-Z).
import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {MercatorCoordinate} from 'maplibre-gl';
import {createCityBusModel, updateU12Model, disposeU12Model} from './u12-model.js';

const BLUE = '#007ac4';
const WHITE = '#eff8fa';
const GLASS = '#183749';
const STEEL = '#798d98';
const AMBER = '#ffbf54';
const DOORS = [-4.84, 0, 4.84];

function partsBuilder() {
  const parts = [];
  function add(geometry, color, x, y, z, rotation = null) {
    if (rotation) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rotation));
    geometry.translate(x, y, z);
    const triangles = geometry.index ? geometry.toNonIndexed() : geometry;
    if (triangles !== geometry) geometry.dispose();
    triangles.deleteAttribute('uv');
    const rgb = new THREE.Color(color);
    const count = triangles.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) rgb.toArray(colors, i * 3);
    triangles.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(triangles);
  }
  function box(x, y, z, width, height, length, color, radius = 0) {
    const geometry = radius
      ? new RoundedBoxGeometry(width, height, length, 1, radius)
      : new THREE.BoxGeometry(width, height, length);
    add(geometry, color, x, y, z);
  }
  function finish() {
    const merged = mergeGeometries(parts);
    parts.forEach((part) => part.dispose());
    return merged;
  }
  return {box, add, finish};
}

function bodyGeometry() {
  const {box, add, finish} = partsBuilder();
  box(0, 0.52, 0, 2.28, 0.64, 10.85, '#253642', 0.12);
  box(0, 1.62, 0, 2.57, 2.45, 11.95, WHITE, 0.16);
  box(0, 0.9, 0, 2.59, 0.95, 11.96, BLUE, 0.13);
  box(0, 2.16, 0, 2.58, 1.25, 11.94, GLASS, 0.15);
  box(0, 2.89, 0, 2.56, 0.32, 11.93, WHITE, 0.13);
  // Blue roof trim, two battery housings and raised ventilation grilles survive a high camera pitch.
  box(0, 3.05, 0.0, 2.4, 0.12, 11.55, BLUE, 0.05);
  box(0, 3.15, 1.1, 1.53, 0.24, 4.35, '#d4e3e8', 0.09);
  box(0, 3.14, -3.46, 1.28, 0.21, 1.48, '#e2ecef', 0.08);
  box(0, 3.27, 2.12, 1.11, 0.04, 1.38, '#7d949d');
  for (let z = 1.55; z < 2.77; z += 0.17) box(0, 3.3, z, 1.05, 0.035, 0.065, '#aebdc2');

  for (const side of [-1, 1]) {
    const x = side * 1.294;
    for (let n = 0; n < 10; n++) {
      const z = -4.98 + n * 1.1;
      box(x, 2.13, z, 0.027, 0.94, 0.99, n % 3 === 0 ? '#406579' : '#2a4e62');
      box(x + side * 0.016, 2.51, z, 0.02, 0.13, 0.98, '#668696');
    }
    box(x, 1.51, 0, 0.028, 0.12, 11.36, '#c3e7f2');
    // This white sweep over the blue lower body is shared by the two sides of the livery.
    const stripe = new THREE.BoxGeometry(0.035, 0.11, 3.34);
    add(stripe, WHITE, side * 1.302, 0.95, 2.44, new THREE.Euler(-0.14, 0, 0));
    for (const z of [-3.65, 3.48]) {
      const axle = new THREE.Euler(0, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.57, 0.57, 0.22, 14), '#172630', side * 1.24, 0.59, z, axle);
      add(new THREE.CylinderGeometry(0.32, 0.32, 0.045, 12), STEEL, side * 1.36, 0.59, z, axle);
      add(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 10), '#445661', side * 1.39, 0.59, z, axle);
    }
    box(side * 1.37, 2.49, -5.48, 0.22, 0.1, 0.32, '#263b49');
    box(side * 1.45, 2.39, -5.45, 0.12, 0.25, 0.18, '#1a2d38', 0.035);
    box(side * 0.94, 1.03, -5.978, 0.46, 0.13, 0.06, '#ffedbc');
    box(side * 1.07, 1.25, 5.969, 0.14, 0.48, 0.055, '#bd3842');
  }
  box(0, 2.16, -5.975, 2.18, 1.06, 0.052, '#30586a', 0.02);
  box(-0.31, 2.11, -6.01, 0.055, 0.98, 0.035, '#263d4a');
  box(0, 2.78, -5.959, 1.98, 0.32, 0.075, '#16242b', 0.03);
  box(-0.5, 2.79, -6.002, 0.48, 0.075, 0.01, AMBER);
  box(0.18, 2.79, -6.002, 0.52, 0.055, 0.01, '#cba264');
  box(0, 0.84, -5.99, 0.54, 0.14, 0.035, '#e5e9e5');
  box(0, 2.23, 5.97, 1.99, 0.87, 0.047, '#315565', 0.02);
  for (const z of DOORS) {
    box(1.307, 1.52, z, 0.036, 2.02, 1.25, '#182e39');
    box(1.332, 0.54, z, 0.045, 0.09, 1.17, '#ffbb53');
    box(1.33, 1.46, z + 0.46, 0.036, 1.64, 0.036, '#e5b15e');
  }
  return finish();
}

// Doors are instanced separately so a reported opening can slide both leaves toward the bodywork.
function leavesGeometry(side) {
  const {box, finish} = partsBuilder();
  for (const z of DOORS) {
    const center = z + side * 0.297;
    box(1.348, 1.51, center, 0.043, 1.97, 0.575, '#24404b');
    box(1.373, 1.85, center, 0.018, 1.12, 0.47, '#426577');
    box(1.373, 0.94, center, 0.018, 0.56, 0.47, BLUE);
    box(1.386, 1.32, center + side * 0.2, 0.019, 0.36, 0.026, '#cddcdf');
  }
  return finish();
}

// At street scale, favour the selected bus and those nearest the middle of the screen.
function streetModels(map, vehicles, detailed) {
  const zoom = map.getZoom();
  if (zoom < 16.35) return new Set();
  const selected = vehicles.find((bus) => bus.selected);
  const ids = new Set(selected ? [selected.id] : []);
  if (zoom < 17) return ids;
  const {clientWidth: width, clientHeight: height} = map.getCanvas();
  const candidates = [];
  for (const bus of vehicles) {
    if (bus.selected) continue;
    const {x, y} = map.project(bus.coordinate);
    if (x < 0 || x > width || y < 0 || y > height) continue;
    // Keep small GPS changes from repeatedly rebuilding a model near the cutoff.
    const distance = Math.hypot(x - width / 2, y - height / 2) - (detailed.has(bus.id) ? 45 : 0);
    candidates.push({id: bus.id, distance});
  }
  candidates.sort((a, b) => a.distance - b.distance);
  for (const candidate of candidates.slice(0, 3 - ids.size)) ids.add(candidate.id);
  return ids;
}

function makeBusScene(map, gl) {
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const renderer = new THREE.WebGLRenderer({canvas: map.getCanvas(), context: gl, antialias: true});
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.HemisphereLight('#ffffff', '#a5b7c5', 1.75);
  scene.add(sky);
  const white = new THREE.Color('#ffffff');
  let lastLight = -Infinity;
  const sun = new THREE.DirectionalLight('#fff5da', 1.65);
  sun.position.set(-3, 7, -4);
  scene.add(sun);

  const material = new THREE.MeshLambertMaterial({vertexColors: true});
  const brake = partsBuilder();
  for (const side of [-1, 1]) brake.box(side * 1.07, 1.25, 6.007, 0.145, 0.4, 0.032, '#ff4442');
  const geometries = [bodyGeometry(), leavesGeometry(-1), leavesGeometry(1), brake.finish()];
  const detailed = new Map();
  const signCanvas = document.createElement('canvas');
  signCanvas.width = 256;
  signCanvas.height = 42;
  const ctx = signCanvas.getContext('2d');
  const signTexture = new THREE.CanvasTexture(signCanvas);
  signTexture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.92, 0.3),
    new THREE.MeshBasicMaterial({map: signTexture}),
  );
  sign.matrixAutoUpdate = false;
  sign.frustumCulled = false;
  sign.visible = false;
  scene.add(sign);
  let signText = '';

  // Project nearby points into a common local frame first. Passing absolute Mercator coordinates
  // in a GPU instance matrix would lose sub-metre precision at street scale.
  const origin = MercatorCoordinate.fromLngLat([24.94, 60.17]);
  const metres = origin.meterInMercatorCoordinateUnits();
  const local = new THREE.Matrix4()
    .makeTranslation(origin.x, origin.y, 0)
    .multiply(new THREE.Matrix4().makeScale(metres, -metres, metres))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  const pose = new THREE.Object3D();
  const matrix = new THREE.Matrix4();
  const translation = new THREE.Matrix4();
  const signOffset = new THREE.Matrix4()
    .makeTranslation(0, 2.78, -6.023)
    .multiply(new THREE.Matrix4().makeRotationY(Math.PI));
  let capacity = 0;
  let batches = [];
  const doorTravel = new Map();

  function resize(count) {
    if (count <= capacity) return;
    for (const batch of batches) {
      scene.remove(batch);
      batch.dispose();
    }
    capacity = Math.max(16, THREE.MathUtils.ceilPowerOfTwo(count));
    batches = geometries.map((geometry) => {
      const batch = new THREE.InstancedMesh(geometry, material, capacity);
      batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      batch.frustumCulled = false;
      scene.add(batch);
      return batch;
    });
  }

  function render(input, vehicles, now, getSun) {
    if (!vehicles.length) return;
    if (now - lastLight >= 1000) {
      const light = getSun?.();
      if (light) {
        const [east, north, up] = light.direction;
        sun.position.set(east, up, -north);
        sun.color.setRGB(...light.rgb, THREE.SRGBColorSpace);
        sun.intensity = light.intensity * 5;
        // Street lighting leaves enough fill to read the blue livery after sunset.
        sky.color.setRGB(...light.ambient.rgb, THREE.SRGBColorSpace).lerp(white, 0.32);
        sky.intensity = 1 + light.ambient.intensity;
      }
      lastLight = now;
    }
    resize(vehicles.length);
    let braking = 0,
      generic = 0;
    const used = streetModels(map, vehicles, detailed);
    for (const item of detailed.values()) item.visible = false;
    const zoom = map.getZoom();
    sign.visible = false;
    const scale = THREE.MathUtils.clamp(2 ** (15.5 - zoom), 1, 3);
    for (let i = 0; i < vehicles.length; i++) {
      const bus = vehicles[i];
      const point = MercatorCoordinate.fromLngLat(bus.coordinate);
      pose.position.set((point.x - origin.x) / metres, 0.06, (point.y - origin.y) / metres);
      pose.rotation.y = -THREE.MathUtils.degToRad(bus.bearing || 0);
      pose.scale.setScalar((scale * point.meterInMercatorCoordinateUnits()) / metres);
      pose.updateMatrix();
      const target = bus.doors === true ? 0.52 : 0;
      const door = doorTravel.get(bus.id);
      let travel = target;
      if (door && now - door.at < 3000) {
        const step = Math.max(0, now - door.at) * 0.00095;
        travel = door.value + THREE.MathUtils.clamp(target - door.value, -step, step);
      }
      doorTravel.set(bus.id, {value: travel, at: now});
      if (used.has(bus.id)) {
        let model = detailed.get(bus.id);
        if (!model) {
          model = createCityBusModel(bus);
          model.matrixAutoUpdate = false;
          detailed.set(bus.id, model);
          scene.add(model);
        }
        model.userData.lastVisible = now;
        model.visible = true;
        model.matrix.copy(pose.matrix);
        model.matrixWorldNeedsUpdate = true;
        updateU12Model(model, bus, travel / 0.52);
        continue;
      }
      const index = generic++;
      batches[0].setMatrixAt(index, pose.matrix);
      matrix.multiplyMatrices(pose.matrix, translation.makeTranslation(0, 0, -travel));
      batches[1].setMatrixAt(index, matrix);
      matrix.multiplyMatrices(pose.matrix, translation.makeTranslation(0, 0, travel));
      batches[2].setMatrixAt(index, matrix);
      if (bus.stopped) batches[3].setMatrixAt(braking++, pose.matrix);
      if (bus.selected && bus.line && ctx) {
        const line = String(bus.line);
        if (line !== signText) {
          ctx.fillStyle = '#15242c';
          ctx.fillRect(0, 0, signCanvas.width, signCanvas.height);
          ctx.fillStyle = '#ffc25b';
          ctx.font = 'bold 38px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(line, 128, 23, 232);
          signTexture.needsUpdate = true;
          signText = line;
        }
        sign.visible = true;
        sign.matrix.multiplyMatrices(pose.matrix, signOffset);
        sign.matrixWorldNeedsUpdate = true;
      }
    }
    for (const [id, model] of detailed) {
      // A single uncertain GPS fix can briefly hide a model. Reuse its meshes
      // when the lane match returns, keeping the same three-model memory limit.
      if (used.has(id) || (detailed.size <= 3 && now - model.userData.lastVisible < 2500)) continue;
      scene.remove(model);
      disposeU12Model(model);
      detailed.delete(id);
    }
    for (const [id, state] of doorTravel) if (now - state.at > 5000) doorTravel.delete(id);
    batches.forEach((batch, i) => {
      batch.count = i === 3 ? braking : generic;
      batch.instanceMatrix.needsUpdate = true;
    });
    camera.projectionMatrix.fromArray(input.defaultProjectionData.mainMatrix).multiply(local);
    renderer.resetState();
    renderer.render(scene, camera);
    renderer.resetState();
  }

  function dispose() {
    for (const model of detailed.values()) disposeU12Model(model);
    detailed.clear();
    for (const batch of batches) batch.dispose();
    for (const geo of geometries) geo.dispose();
    material.dispose();
    sign.geometry.dispose();
    sign.material.dispose();
    signTexture.dispose();
    renderer.dispose();
  }
  return {render, dispose};
}

/** getFrame(timeMs, bounds) supplies currently visible, interpolated vehicle poses. */
export function createBusLayer(map, getFrame, getSun) {
  let world;
  let timer;
  return {
    id: 'helsinki-bus-models',
    type: 'custom',
    renderingMode: '3d',
    render(gl, input) {
      const now = performance.now();
      const vehicles = getFrame(now, map.getBounds());
      if (!vehicles.length) return;
      if (!world) world = makeBusScene(map, gl);
      world.render(input, vehicles, now, getSun);
      if (timer === undefined) {
        timer = setTimeout(() => {
          timer = undefined;
          map.triggerRepaint();
        }, 32);
      }
    },
    onRemove() {
      clearTimeout(timer);
      timer = undefined;
      world?.dispose();
      world = undefined;
    },
  };
}
