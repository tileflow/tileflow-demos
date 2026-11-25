// A low-floor city bus in metres. Local +X is the door side, +Y is up and the nose points north (-Z).
import * as THREE from 'three';
import {ARCO, createArcoGeometries} from './arco-model.js';
import {MercatorCoordinate} from 'maplibre-gl';
import {createPlatformScene, showPlatformModels} from './platform-model.js';
import {lineColors, lineIndex} from './line-colors.js';
import {timingColor, timingGroup, timingPalette} from './fleet-lights.js';

function makeBusScene(map, gl, amenities, stops) {
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
  const luminous = new THREE.MeshBasicMaterial({vertexColors: true});
  // A two-tone outline hugs the selected vehicle, independently of delay and daylight.
  const outline = new THREE.Group();
  function footprint(width, length, thickness, color) {
    function capsule(path, r, halfLength) {
      const straight = halfLength - r;
      path.absarc(0, straight, r, 0, Math.PI, false);
      path.absarc(0, -straight, r, Math.PI, 2 * Math.PI, false);
      path.closePath();
      return path;
    }
    const ring = capsule(new THREE.Shape(), width / 2, length / 2);
    ring.holes.push(capsule(new THREE.Path(), width / 2 - thickness, length / 2 - thickness));
    const geometry = new THREE.ShapeGeometry(ring, 12).rotateX(-Math.PI / 2);
    return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({color, side: THREE.DoubleSide}));
  }
  outline.add(footprint(3.92, 13.66, .29, '#192c3a'), footprint(3.38, 13.12, .24, '#fff9e9'));
  outline.matrixAutoUpdate = false;
  scene.add(outline);
  const palette = lineColors.map(({body}) => new THREE.Color(body));
  const delayPalette = Object.fromEntries(['day','night'].map(period => [period,
    Object.fromEntries(Object.keys(timingPalette).map(key => [key,new THREE.Color(timingColor(key,period))])),
  ]));
  const previousColors = [];
  const geometries = createArcoGeometries();
  const origin = MercatorCoordinate.fromLngLat([24.94, 60.17]);
  const metres = origin.meterInMercatorCoordinateUnits();
  const platforms = createPlatformScene(scene, map, origin, metres, amenities, stops);
  const local = new THREE.Matrix4()
    .makeTranslation(origin.x, origin.y, 0)
    .multiply(new THREE.Matrix4().makeScale(metres, -metres, metres))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  const globeFrame = new THREE.Matrix4();
  const flatProjection = new THREE.Matrix4();
  const pose = new THREE.Object3D();
  const matrix = new THREE.Matrix4();
  const translation = new THREE.Matrix4();
  const spin = new THREE.Matrix4();
  const poses = new Map();
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
    previousColors.length = 0;
    batches = geometries.map((geometry, part) => {
      const batch = new THREE.InstancedMesh(
        geometry,
        part === 4 ? material : luminous,
        (part >= 2 ? 2 : 1) * capacity,
      );
      batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      batch.frustumCulled = false;
      scene.add(batch);
      return batch;
    });
  }

  function render(input, vehicles, now, getSun, period) {
    const changedPlatforms = platforms.refresh();
    platforms.update(vehicles, now);
    if (now - lastLight >= 1000) {
      const light = getSun?.();
      if (light) {
        const [east, north, up] = light.direction;
        sun.position.set(east, up, -north);
        sun.color.setRGB(...light.rgb, THREE.SRGBColorSpace);
        sun.intensity = light.intensity * 5;
        // Retain ambient light on the hubs and platform furnishings after sunset.
        sky.color.setRGB(...light.ambient.rgb, THREE.SRGBColorSpace).lerp(white, 0.32);
        sky.intensity = 1 + light.ambient.intensity;
      }
      lastLight = now;
    }
    resize(vehicles.length);
    poses.clear();
    const [body, fittings, doorPaint, doorGlass, axles] = batches;
    const zoom = map.getZoom();
    const delays = delayPalette[period === 'dusk' || period === 'night' ? 'night' : 'day'];
    let changedColors = false;
    outline.visible = false;
    const scale = THREE.MathUtils.clamp(2 ** (15.5 - zoom), 1, 3);
    // Keep a 12 m selected vehicle legible at city scale (24 CSS pixels at the map centre).
    const minTripLength = 24 / (512 * 2 ** zoom);
    for (let i = 0; i < vehicles.length; i++) {
      const bus = vehicles[i];
      const point = MercatorCoordinate.fromLngLat(bus.coordinate);
      pose.position.set((point.x - origin.x) / metres, 0.06, (point.y - origin.y) / metres);
      pose.rotation.y = -THREE.MathUtils.degToRad(bus.bearing || 0);
      const normalScale = scale * point.meterInMercatorCoordinateUnits();
      const modelScale = bus.fullTrip ? Math.max(normalScale, minTripLength / 12) : normalScale;
      pose.scale.setScalar(modelScale / metres);
      pose.updateMatrix();
      const target = bus.doors === true ? 1 : 0;
      const door = doorTravel.get(bus.id);
      let travel = target;
      if (door && now - door.at < 3000) {
        const step = Math.max(0, now - door.at) / 650;
        travel = door.value + THREE.MathUtils.clamp(target - door.value, -step, step);
      }
      doorTravel.set(bus.id, {value: travel, at: now});
      poses.set(bus.id, i);
      body.setMatrixAt(i, pose.matrix);
      const shellColor = (bus.fullTrip ?? bus.selected) ? palette[lineIndex(bus.line)] : delays[timingGroup(bus.punctuality)];
      if (bus.selected) {
        outline.visible = true;
        outline.matrix.multiplyMatrices(pose.matrix, translation.makeTranslation(0, .12, 0));
        outline.matrixWorldNeedsUpdate = true;
      }
      if (shellColor !== previousColors[i]) {
        previousColors[i] = shellColor;
        body.setColorAt(i, shellColor);
        doorPaint.setColorAt(i * 2, shellColor);
        doorPaint.setColorAt(i * 2 + 1, shellColor);
        changedColors = true;
      }
      fittings.setMatrixAt(i, pose.matrix);
      spin.makeRotationX(-((bus.wheelDistance || 0) / ARCO.wheelRadius) % (2 * Math.PI));
      for (let k = 0; k < 2; k++) {
        const sign = k === 0 ? -1 : 1;
        const doorZ = ARCO.doorZ + sign * (ARCO.doorLeafOffset + travel * ARCO.doorTravel);
        matrix.multiplyMatrices(pose.matrix, translation.makeTranslation(travel * ARCO.doorOutset, 0, doorZ));
        const index = 2 * i + k;
        doorPaint.setMatrixAt(index, matrix);
        doorGlass.setMatrixAt(index, matrix);
        const axleZ = k === 0 ? ARCO.frontAxleZ : ARCO.rearAxleZ;
        matrix.multiplyMatrices(pose.matrix, translation.makeTranslation(0, ARCO.wheelY, axleZ)).multiply(spin);
        axles.setMatrixAt(index, matrix);
      }
    }
    for (const [id, state] of doorTravel) if (now - state.at > 5000) doorTravel.delete(id);
    batches.forEach((batch, i) => {
      batch.count = vehicles.length * (i >= 2 ? 2 : 1);
      batch.instanceMatrix.needsUpdate = true;
    });
    if (changedColors) {
      body.instanceColor.needsUpdate = true;
      doorPaint.instanceColor.needsUpdate = true;
    }
    const projection = input.defaultProjectionData;
    const viewProjection = camera.projectionMatrix.fromArray(projection.mainMatrix);
    if (projection.projectionTransition > 0 && vehicles.length) {
      // At regional zoom only the selected bus is drawn. Anchor its tangent plane
      // at the actual vehicle, with local axes east, up and south on the globe.
      const [lng, lat] = vehicles[0].coordinate.map(THREE.MathUtils.degToRad);
      const sinL = Math.sin(lng), cosL = Math.cos(lng), sinP = Math.sin(lat), cosP = Math.cos(lat);
      const unit = 2 * Math.PI * cosP * metres;
      globeFrame.set(
        cosL * unit, sinL * cosP * unit, sinL * sinP * unit, sinL * cosP,
        0,           sinP * unit,        -cosP * unit,       sinP,
        -sinL * unit, cosL * cosP * unit, cosL * sinP * unit, cosL * cosP,
        0, 0, 0, 1,
      );
      const anchor = MercatorCoordinate.fromLngLat(vehicles[0].coordinate);
      globeFrame.multiply(translation.makeTranslation((origin.x - anchor.x) / metres, 0, (origin.y - anchor.y) / metres));
      viewProjection.multiply(globeFrame);
      if (projection.projectionTransition < 1) {
        flatProjection.fromArray(projection.fallbackMatrix).multiply(local);
        for (let i = 0; i < 16; i++)
          viewProjection.elements[i] = THREE.MathUtils.lerp(flatProjection.elements[i], viewProjection.elements[i], projection.projectionTransition);
      }
    } else viewProjection.multiply(local);
    renderer.resetState();
    renderer.render(scene, camera);
    renderer.resetState();
    return changedPlatforms;
  }

  function dispose() {
    platforms.dispose();
    poses.clear();
    for (const batch of batches) batch.dispose();
    for (const geo of geometries) geo.dispose();
    material.dispose();
    luminous.dispose();
    for (const ring of outline.children) { ring.geometry.dispose(); ring.material.dispose(); }
    renderer.dispose();
  }
  // Include hub caps and the plug doors when they extend towards the kerb.
  const envelope = new THREE.Box3(new THREE.Vector3(-1.43, 0, -6.1), new THREE.Vector3(1.48, ARCO.roofY, 6.0));
  const roof = new THREE.Vector3();
  const busMatrix = new THREE.Matrix4();
  const edge = new THREE.Vector3();
  function roofPoint(id) {
    const index = poses.get(id);
    if (index === undefined) return null;
    batches[0].getMatrixAt(index, busMatrix);
    roof.set(0, ARCO.roofY, 0).applyMatrix4(busMatrix).applyMatrix4(camera.projectionMatrix);
    if (roof.z < -1 || roof.z > 1) return null;
    let top = roof.y, bottom = roof.y, left = roof.x, right = roof.x;
    for (const z of [-6, 6]) {
      for (const x of [-1.3, 1.3]) {
        edge.set(x, ARCO.roofY, z).applyMatrix4(busMatrix).applyMatrix4(camera.projectionMatrix);
        left = Math.min(left, edge.x);
        right = Math.max(right, edge.x);
        top = Math.max(top, edge.y);
        edge.set(x, 0, z).applyMatrix4(busMatrix).applyMatrix4(camera.projectionMatrix);
        left = Math.min(left, edge.x);
        right = Math.max(right, edge.x);
        bottom = Math.min(bottom, edge.y);
      }
    }
    const canvas = map.getCanvas();
    return {x: (roof.x + 1) * canvas.clientWidth / 2, y: (1 - roof.y) * canvas.clientHeight / 2,
      left: (1 + left) * canvas.clientWidth / 2, right: (1 + right) * canvas.clientWidth / 2,
      top: (1 - top) * canvas.clientHeight / 2, bottom: (1 - bottom) * canvas.clientHeight / 2};
  }
  function pick(point) {
    if (!poses.size && !showPlatformModels(map)) return;
    const canvas = map.getCanvas();
    const x = (2 * point.x) / canvas.clientWidth - 1,
      y = 1 - (2 * point.y) / canvas.clientHeight;
    const inverse = camera.projectionMatrix.clone().invert();
    const start = new THREE.Vector3(x, y, -1).applyMatrix4(inverse);
    const direction = new THREE.Vector3(x, y, 1).applyMatrix4(inverse).sub(start).normalize();
    const raycaster = new THREE.Raycaster(start, direction);
    let hit = platforms.pick(raycaster);
    const transform = new THREE.Matrix4();
    for (const [id, index] of poses) {
      batches[0].getMatrixAt(index, transform);
      const ray = raycaster.ray.clone().applyMatrix4(transform.clone().invert());
      const intersection = ray.intersectBox(envelope, new THREE.Vector3());
      if (!intersection) continue;
      const distance = intersection.applyMatrix4(transform).distanceTo(start);
      if (!hit || distance < hit.distance) hit = {kind: 'bus', id, distance};
    }
    return hit;
  }
  return {render, dispose, pick, roofPoint, platformPoint: id => platforms.flagPoint(id, camera, map.getCanvas())};
}

/** getFrame(timeMs, bounds) supplies currently visible, interpolated vehicle poses. */
export function createBusLayer(map, getFrame, getSun, amenities, stops, getPeriod, onPlatformsChanged, onBadgesFrame) {
  let world;
  let timer;
  let hasPlatforms = false;
  function notifyPlatforms(ids) {
    hasPlatforms = ids.size > 0;
    // MapLibre must finish drawing its custom layer before a style mutation.
    if (onPlatformsChanged) queueMicrotask(() => onPlatformsChanged(ids));
  }
  return {
    id: 'helsinki-bus-models',
    type: 'custom',
    renderingMode: '3d',
    pick(point) {
      return world?.pick(point);
    },
    roofPoint(id) {
      return world?.roofPoint(id);
    },
    platformPoint(id) {
      return world?.platformPoint(id);
    },
    render(gl, input) {
      const now = performance.now();
      const vehicles = getFrame(now, map.getBounds());
      if (!world && !vehicles.length && !showPlatformModels(map)) return;
      if (!world) world = makeBusScene(map, gl, amenities, stops);
      const changedPlatforms = world.render(input, vehicles, now, getSun, getPeriod?.());
      if (changedPlatforms) notifyPlatforms(changedPlatforms);
      onBadgesFrame?.(vehicles, world.roofPoint);
      if (vehicles.length && timer === undefined) {
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
      onBadgesFrame?.([]);
      if (hasPlatforms) notifyPlatforms(new Set());
    },
  };
}
