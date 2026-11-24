// Nobina's 2026 U12-B, modelled in metres around the centre of its footprint.
// Manufacturer envelope 12.170 × 2.550 m, 6.000 m wheelbase, 275/70R22.5 tyres.
// Passenger doors: two front leaves, two centre leaves, one rear leaf.
import * as T from 'three';
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {LENGTH, WIDTH, HEIGHT, BLUE, sideArt, endArt, glassTexture, signArt} from './u12-art.js';

const HALF = WIDTH / 2;
const AXLES = [-3.18, 2.82];
const ARCH = 0.556;
const DOORS = [
  {z: -5.1, width: 1.33, count: 2},
  {z: 0.44, width: 1.34, count: 2},
  {z: 4.63, width: 0.78, count: 1},
];
const instances = new WeakMap();
const namedFleet = /^0*22\/0*(15(?:0[3-9]|[12]\d|3[0-2]))$/;
export const isNobinaU12 = (id) => namedFleet.test(String(id));

function paint(color, roughness = 0.62, metalness = 0) {
  return new T.MeshStandardMaterial({color, roughness, metalness, side: T.DoubleSide});
}
function imageMaterial(map) {
  return new T.MeshStandardMaterial({
    map,
    roughness: 0.39,
    metalness: 0.06,
    alphaTest: 0.55,
    side: T.DoubleSide,
  });
}
function mesh(group, geometry, material, x = 0, y = 0, z = 0) {
  const item = new T.Mesh(geometry, material);
  item.position.set(x, y, z);
  group.add(item);
  return item;
}
function box(group, material, x, y, z, w, h, l, radius = 0) {
  return mesh(
    group,
    radius ? new RoundedBoxGeometry(w, h, l, 2, radius) : new T.BoxGeometry(w, h, l),
    material,
    x,
    y,
    z,
  );
}
function rod(group, mat, a, b, r, sides = 8) {
  const start = new T.Vector3(...a),
    end = new T.Vector3(...b),
    delta = end.clone().sub(start);
  const item = mesh(group, new T.CylinderGeometry(r, r, delta.length(), sides), mat);
  item.position.copy(start).lerp(end, 0.5);
  item.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize());
}
function tube(group, mat, points, r) {
  const curve = new T.CatmullRomCurve3(points.map((p) => new T.Vector3(...p)));
  return mesh(group, new T.TubeGeometry(curve, Math.max(12, points.length * 5), r, 7, false), mat);
}
function cylinderX(group, mat, x, y, z, radius, width, sides = 36) {
  const item = mesh(group, new T.CylinderGeometry(radius, radius, width, sides), mat, x, y, z);
  item.rotation.z = Math.PI / 2;
  return item;
}
function arcTrim(group, side, z, mat) {
  const points = [];
  for (let i = 0; i <= 35; i++) {
    const a = (1.144 - (i / 35) * 1.288) * Math.PI;
    points.push([side * 1.266, 0.48 + ARCH * Math.sin(a), z + ARCH * Math.cos(a)]);
  }
  tube(group, mat, points, 0.015);
}

// Flatten static subassemblies by material. Dynamic leaves, signs and brakes remain independent.
function batch(group) {
  const byMaterial = new Map();
  for (const child of [...group.children]) {
    if (!child.isMesh) continue;
    child.updateMatrix();
    const source = child.geometry;
    const geo = source.index ? source.toNonIndexed() : source;
    if (geo !== source) source.dispose();
    geo.applyMatrix4(child.matrix);
    if (!geo.getAttribute('uv'))
      geo.setAttribute(
        'uv',
        new T.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2),
      );
    const list = byMaterial.get(child.material) || [];
    list.push(geo);
    byMaterial.set(child.material, list);
    group.remove(child);
  }
  for (const [mat, parts] of byMaterial) {
    const geo = mergeGeometries(parts);
    for (const item of parts) item.dispose();
    mesh(group, geo, mat);
  }
}

function skinSection(shape, side, materials, group, x = HALF) {
  const raw = new T.ShapeGeometry(shape);
  const pos = raw.getAttribute('position'),
    uv = raw.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    let z = pos.getX(i);
    const y = pos.getY(i);
    // Inward curving shoulders where the window header meets the roof.
    if (z < -5.61) z += (endZ(true, HALF, y) + 5.78) * Math.min(1, (-5.61 - z) / 0.17);
    if (z > 5.61) z += (endZ(false, HALF, y) - 5.815) * Math.min(1, (z - 5.61) / 0.205);
    pos.setXYZ(i, side * x, y, z);
    uv.setXY(i, (z + LENGTH / 2) / LENGTH, y / HEIGHT);
  }
  raw.computeVertexNormals();
  return mesh(group, raw, materials);
}
function section(x0, y0, x1, y1) {
  const shape = new T.Shape();
  shape.moveTo(x0, y0);
  shape.lineTo(x1, y0);
  shape.lineTo(x1, y1);
  shape.lineTo(x0, y1);
  shape.closePath();
  return shape;
}
function sideWall(doorSide) {
  const s = new T.Shape();
  const events = AXLES.map((z) => ({z, arch: true}));
  if (doorSide) events.push(...DOORS);
  const wheelStart = Math.asin((0.48 - 0.235) / ARCH);
  s.moveTo(-5.78, 0.235);
  for (const cut of events.sort((a, b) => a.z - b.z)) {
    if (cut.arch) {
      for (let i = 0; i <= 40; i++) {
        const a = Math.PI + wheelStart - (i / 40) * (Math.PI + 2 * wheelStart);
        s.lineTo(cut.z + ARCH * Math.cos(a), 0.48 + ARCH * Math.sin(a));
      }
    } else {
      const lo = cut.z - cut.width / 2,
        hi = cut.z + cut.width / 2;
      s.lineTo(lo, 0.235);
      s.lineTo(lo, 2.635);
      s.lineTo(hi, 2.635);
      s.lineTo(hi, 0.235);
    }
  }
  s.lineTo(5.815, 0.235);
  s.lineTo(5.815, 2.89);
  s.lineTo(-5.78, 2.89);
  s.closePath();
  return s;
}
// The endcaps and the roof share this surface profile, including the corner radius in plan.
const SHOULDER = [
  [2.89, HALF],
  [2.95, 1.27],
  [3.005, 1.25],
  [3.052, 1.218],
  [3.087, 1.17],
  [3.111, 1.105],
  [3.123, 1.035],
];
function halfWidthAt(y) {
  for (let i = 1; i < SHOULDER.length; i++) {
    const [top, upper] = SHOULDER[i],
      [base, lower] = SHOULDER[i - 1];
    if (y <= top) return T.MathUtils.lerp(lower, upper, Math.max(0, (y - base) / (top - base)));
  }
  return SHOULDER.at(-1)[1];
}
function endZ(front, x, y) {
  const q = Math.min(1, Math.abs(x) / halfWidthAt(y));
  const corner = 0.295 * (1 - Math.sqrt(Math.max(0, 1 - q ** 7)));
  const crown = 0.19 * Math.max(0, (y - 2.65) / 0.54) ** 2;
  const mid = -LENGTH / 2 + corner + crown + 0.032 * Math.max(0, (0.55 - y) / 0.32) ** 2;
  return front ? mid : -mid - 0.025;
}
function endPatch(front, rows, span, uvAt) {
  const vertices = [],
    uv = [],
    indices = [],
    n = 48;
  for (const y of rows)
    for (let i = 0; i <= n; i++) {
      // Sample close to both edges so the broad face can turn tangent to the side wall.
      const u = 0.5 - 0.5 * Math.cos((Math.PI * i) / n);
      const x = (u * 2 - 1) * span(y);
      vertices.push(x, y, endZ(front, x, y));
      uv.push(...uvAt(x, y, u));
    }
  for (let j = 0; j < rows.length - 1; j++)
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i,
        b = a + 1,
        c = b + n + 1,
        d = c - 1;
      if (front) indices.push(a, d, b, b, d, c);
      else indices.push(a, b, d, d, b, c);
    }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
function nose(group, front, skin, glass) {
  const rows = [
    0.235,
    0.28,
    0.36,
    0.5,
    0.64,
    0.81,
    0.97,
    1.1,
    1.5,
    1.9,
    2.3,
    2.53,
    2.65,
    2.83,
    ...SHOULDER.map(([y]) => y),
  ];
  const geo = endPatch(front, rows, halfWidthAt, (x, y) => [(x + HALF) / WIDTH, y / HEIGHT]);
  mesh(group, geo, skin);
  const pane = geo.clone();
  pane.translate(0, 0, front ? 0.025 : -0.025);
  mesh(group, pane, glass);
}
function rim(group, side, z, m) {
  // Revolved tyre section with shoulders, longitudinal grooves, sidewall bulge and bead.
  const tyreSection = [
    [0.275, -0.115],
    [0.32, -0.137],
    [0.411, -0.139],
    [0.456, -0.12],
    [0.476, -0.088],
    [0.48, -0.081],
    [0.48, -0.057],
    [0.466, -0.053],
    [0.466, -0.044],
    [0.48, -0.04],
    [0.48, -0.014],
    [0.466, -0.01],
    [0.466, -0.003],
    [0.48, 0.001],
    [0.48, 0.027],
    [0.466, 0.032],
    [0.466, 0.039],
    [0.48, 0.044],
    [0.48, 0.071],
    [0.476, 0.09],
    [0.454, 0.12],
    [0.416, 0.137],
    [0.34, 0.141],
    [0.275, 0.116],
  ];
  const x = side * 1.102;
  const tyre = mesh(
    group,
    new T.LatheGeometry(
      tyreSection.map(([r, d]) => new T.Vector2(r, d)),
      48,
    ),
    m.rubber,
    x,
    0.48,
    z,
  );
  tyre.rotation.z = Math.PI / 2;
  cylinderX(group, m.rubber, x, 0.48, z, 0.294, 0.219);
  const face = side * 1.243;
  cylinderX(group, m.silver, face, 0.48, z, 0.276, 0.025);
  const edge = mesh(group, new T.TorusGeometry(0.281, 0.017, 8, 48), m.chrome, face + side * 0.019, 0.48, z);
  edge.rotation.y = Math.PI / 2;
  cylinderX(group, m.steel, face + side * 0.021, 0.48, z, 0.157, 0.044);
  const capColor = z === AXLES[0] ? m.silver : m.steel;
  cylinderX(group, capColor, face + side * 0.048, 0.48, z, 0.092, 0.06);
  for (let n = 0; n < 10; n++) {
    const a = (n * Math.PI) / 5;
    cylinderX(
      group,
      m.cavity,
      face + side * 0.02,
      0.48 + 0.21 * Math.sin(a),
      z + 0.21 * Math.cos(a),
      0.028,
      0.008,
      12,
    );
    cylinderX(
      group,
      m.chrome,
      face + side * 0.049,
      0.48 + 0.132 * Math.sin(a),
      z + 0.132 * Math.cos(a),
      0.017,
      0.035,
      6,
    );
    if (z === AXLES[0])
      cylinderX(
        group,
        m.red,
        face + side * 0.07,
        0.48 + 0.132 * Math.sin(a),
        z + 0.132 * Math.cos(a),
        0.013,
        0.008,
        6,
      );
  }
}

function roofSection(group, mat, frontHalf) {
  const cross = SHOULDER.map(([y, x]) => [-x, y]);
  for (let i = 1; i < 32; i++) cross.push([(i / 16 - 1) * 1.035, 3.123]);
  cross.push(...[...SHOULDER].reverse().map(([y, x]) => [x, y]));
  const v = [],
    idx = [];
  for (const edge of [0, 1])
    for (const [x, y] of cross) {
      const split = 2.25;
      const z = frontHalf ? (edge ? split : endZ(true, x, y)) : edge ? endZ(false, x, y) : split;
      v.push(x, y, z);
    }
  for (let i = 0; i < cross.length - 1; i++) {
    const j = i + cross.length;
    idx.push(i, j, i + 1, i + 1, j, j + 1);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  mesh(group, g, mat);
}
function roof(group, m) {
  roofSection(group, m.blue, true);
  roofSection(group, m.white, false);
  // Roof edge fairings mask the recessed HVAC plant, as seen on the Nordic vehicle from above.
  for (const [z, len, col] of [
    [-4.95, 0.77, m.blue],
    [-2.16, 3.68, m.blue],
    [0.57, 1.88, m.blue],
    [3.7, 2.75, m.white],
    [5.43, 0.59, m.white],
  ]) {
    box(group, col, 0, 3.13, z, 2.14, 0.095, len, 0.042);
  }
  for (const [z, len, mat] of [
    [-4.22, 0.61, m.blue],
    [1.69, 0.63, m.blue],
    [4.85, 0.37, m.white],
  ]) {
    box(group, m.cavity, 0, 3.123, z, 1.97, 0.015, len, 0.012);
    for (const x of [-0.98, 0.98]) box(group, mat, x, 3.147, z, 0.105, 0.062, len, 0.016);
  }
  box(group, m.aluminium, -0.23, 3.173, 0.34, 0.87, 0.024, 1.31, 0.012);
  for (const z of [-0.08, 0.35, 0.78]) {
    mesh(group, new T.CylinderGeometry(0.185, 0.185, 0.014, 24), m.cavity, -0.23, 3.18, z);
    for (let i = 0; i < 3; i++) {
      const ring = mesh(
        group,
        new T.TorusGeometry(0.061 + i * 0.045, 0.006, 5, 30),
        m.steel,
        -0.23,
        3.188,
        z,
      );
      ring.rotation.x = Math.PI / 2;
    }
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI) / 5;
      rod(
        group,
        m.steel,
        [-0.23 - 0.169 * Math.cos(a), 3.189, z - 0.169 * Math.sin(a)],
        [-0.23 + 0.169 * Math.cos(a), 3.189, z + 0.169 * Math.sin(a)],
        0.004,
        5,
      );
    }
  }
}

function interior(group, m) {
  box(group, m.floor, 0, 0.29, -0.22, 2.36, 0.11, 11.13);
  box(group, m.floor, 0, 0.51, 4.02, 2.29, 0.39, 3.33);
  box(group, m.lining, 0, 2.85, 0, 2.38, 0.06, 11.4);
  for (const side of [-1, 1]) {
    for (const z of AXLES) box(group, m.floor, side * 0.9, 0.63, z, 0.6, 0.67, 1.42, 0.2);
    rod(group, m.rail, [side * 0.64, 2.5, -4.15], [side * 0.64, 2.5, 4.85], 0.02, 10);
  }
  const seats = [-3.72, -2.9, -2.08, -1.26, -0.44, 0.38, 1.24, 2.15, 3.01, 3.87, 4.74, 5.39];
  for (const z of seats)
    for (const x of [-0.94, -0.5, 0.53, 0.97]) {
      if (x > 0 && ((z > -0.5 && z < 1.25) || (z > 4.3 && z < 5.05))) continue;
      const y = z > 2.3 ? 0.96 : 0.74;
      box(group, m.seats, x, y, z, 0.39, 0.12, 0.37, 0.046);
      const back = box(group, m.seats, x, y + 0.24, z + 0.173, 0.39, 0.56, 0.105, 0.048);
      back.rotation.x = 0.1;
      box(group, m.lining, x, y + 0.455, z + 0.223, 0.31, 0.028, 0.04, 0.012);
    }
  for (const z of [-4.17, -1.8, -0.33, 1.2, 3.77, 5.05]) {
    rod(group, m.rail, [0.81, 0.37, z], [0.81, 2.66, z], 0.023);
    rod(group, m.rail, [-0.69, 0.37, z], [-0.69, 2.66, z], 0.022);
  }
  for (const z of [-3.54, -2.53, -1.49, -0.51, 0.5, 1.52, 2.51, 3.53]) {
    const loop = mesh(group, new T.TorusGeometry(0.077, 0.012, 6, 12), m.strap, -0.63, 2.32, z);
    loop.scale.y = 1.25;
    rod(group, m.strap, [-0.63, 2.4, z], [-0.63, 2.51, z], 0.012);
  }
  box(group, m.seats, -0.58, 0.94, -4.72, 0.51, 0.15, 0.48, 0.07);
  box(group, m.seats, -0.59, 1.28, -4.49, 0.5, 0.69, 0.12, 0.07);
  box(group, m.dash, -0.34, 0.96, -5.6, 1.28, 0.22, 0.49, 0.075);
  box(group, m.dash, -0.6, 1.14, -5.42, 0.63, 0.15, 0.21, 0.04);
  const steering = mesh(group, new T.TorusGeometry(0.165, 0.018, 8, 30), m.rubber, -0.6, 1.19, -5.28);
  steering.rotation.x = 1.0;
  rod(group, m.dash, [-0.6, 0.91, -5.45], [-0.6, 1.19, -5.28], 0.034);
  box(group, m.steel, 0.02, 0.83, -5.16, 0.06, 0.93, 0.055);
  const reader = box(group, m.reader, 0.03, 1.27, -5.15, 0.12, 0.18, 0.08, 0.025);
  reader.rotation.x = -0.23;
  box(group, m.cavity, 0.03, 1.29, -5.11, 0.09, 0.09, 0.008);
}

function fascia(group, m, brakes) {
  const front = true;
  for (const side of [-1, 1]) {
    const x = side * 1.04;
    box(group, m.chrome, x, 0.64, endZ(front, x, 0.64) - 0.005, 0.177, 0.524, 0.061, 0.072);
    box(group, m.black, x, 0.64, endZ(front, x, 0.64) - 0.032, 0.145, 0.484, 0.051, 0.061);
    for (const y of [0.534, 0.744]) {
      const ring = mesh(
        group,
        new T.TorusGeometry(0.043, 0.008, 8, 24),
        m.chrome,
        x,
        y,
        endZ(front, x, 0.64) - 0.065,
      );
      const bulb = mesh(group, new T.SphereGeometry(0.034, 12, 10), m.lens, x, y, ring.position.z - 0.001);
      bulb.scale.z = 0.41;
    }
    // Distinctive upright running lamp capsules and the U12's polished front brow.
    const points = [];
    for (const [a, cy] of [
      [0, 0.798],
      [1, 0.492],
    ]) {
      for (let i = 0; i <= 12; i++) {
        const k = Math.PI * (i / 12 + a);
        points.push([x + 0.067 * Math.cos(k), cy + 0.061 * Math.sin(k), endZ(front, x, 0.64) - 0.064]);
      }
    }
    points.push(points[0]);
    tube(group, m.drl, points, 0.009);
    const rearZ = endZ(false, x, 0.8);
    box(group, m.black, x, 1.03, rearZ + 0.008, 0.13, 0.79, 0.06, 0.056);
    box(group, m.red, x, 1.03, rearZ + 0.039, 0.066, 0.65, 0.026, 0.032);
    box(brakes, m.brake, x, 1.07, rearZ + 0.055, 0.042, 0.57, 0.018, 0.02);
    // Tall off-board mirrors on curved supports, including convex lower glass.
    const mx = side * 1.52;
    tube(
      group,
      m.black,
      [
        [side * 1.16, 2.57, -5.47],
        [side * 1.36, 2.56, -5.56],
        [mx, 2.48, -5.62],
        [mx, 2.37, -5.64],
      ],
      0.025,
    );
    box(group, m.black, mx, 2.19, -5.65, 0.21, 0.42, 0.108, 0.052);
    box(group, m.mirror, mx, 2.23, -5.584, 0.163, 0.232, 0.018, 0.026);
    box(group, m.mirror, mx, 2.055, -5.584, 0.159, 0.08, 0.016, 0.018);
    // Two black articulated arms and separate rubber blades resting against curved glazing.
    const anchor = [side * 0.67, 1.057, endZ(true, side * 0.67, 1.06) - 0.028];
    const joint = [side * 0.24, 1.18, endZ(true, side * 0.24, 1.18) - 0.029];
    rod(group, m.black, anchor, joint, 0.012);
    rod(
      group,
      m.black,
      [joint[0], joint[1], joint[2]],
      [side * 0.96, 1.35, endZ(true, side * 0.96, 1.35) - 0.036],
      0.017,
    );
  }
  tube(
    group,
    m.chrome,
    [
      [-0.86, 0.902, endZ(true, -0.86, 0.9) - 0.016],
      [-0.77, 0.847, -6.041],
      [-0.55, 0.839, -6.068],
      [0, 0.845, -6.096],
      [0.55, 0.839, -6.068],
      [0.77, 0.847, -6.041],
      [0.86, 0.902, endZ(true, 0.86, 0.9) - 0.016],
    ],
    0.014,
  );
  box(group, m.black, 0, 0.649, -6.081, 0.56, 0.073, 0.021, 0.028);
  box(group, m.black, 0, 2.991, -5.99, 0.083, 0.049, 0.05, 0.018);
}

function signs(group) {
  const face = new T.MeshBasicMaterial({color: 0xffffff, toneMapped: false});
  const rear = face.clone();
  const mounting = (mat, x, y, z, w, h, angle) => {
    const pane = mesh(group, new T.PlaneGeometry(w, h), mat, x, y, z);
    pane.rotation.y = angle;
  };
  const frontSign = endPatch(
    true,
    [2.585, 2.66, 2.76, 2.84, 2.922],
    () => 1.087,
    (_x, y, u) => [1 - u, (y - 2.585) / 0.337],
  );
  frontSign.translate(0, 0, -0.007);
  mesh(group, frontSign, face);
  mounting(face, HALF + 0.011, 2.213, -3.89, 0.881, 0.174, Math.PI / 2);
  mounting(face, -HALF - 0.011, 2.165, -3.88, 0.881, 0.174, -Math.PI / 2);
  const backSign = endPatch(
    false,
    [2.586, 2.7, 2.849],
    () => 0.38,
    (_x, y, u) => [u, (y - 2.586) / 0.263],
  );
  backSign.translate(0, 0, 0.007);
  mesh(group, backSign, rear);
  return {face, rear};
}
function materials() {
  const glass = paint('#ffffff', 0.21, 0.08);
  glass.map = glassTexture();
  glass.transparent = true;
  glass.depthWrite = false;
  return {
    blue: paint(BLUE, 0.43, 0.1),
    white: paint('#edf2f3', 0.4, 0.09),
    silver: paint('#afb9bc', 0.33, 0.51),
    chrome: paint('#dae1df', 0.23, 0.63),
    aluminium: paint('#c7cdce', 0.45, 0.34),
    steel: paint('#828e93', 0.52, 0.36),
    red: paint('#ae3034', 0.28),
    rubber: paint('#22282c', 0.91),
    floor: paint('#454b4d', 0.86),
    cavity: paint('#222a2c', 0.71),
    black: paint('#192328', 0.5),
    dash: paint('#33434a', 0.84),
    seats: paint('#27556e', 0.84),
    lining: paint('#b8c4c1', 0.79),
    rail: paint('#39a0c8', 0.5, 0.15),
    strap: paint('#475761', 0.74),
    reader: paint('#2f8b77', 0.52),
    mirror: paint('#a1b7c0', 0.17, 0.36),
    lens: paint('#d2e8ed', 0.17, 0.36),
    drl: new T.MeshBasicMaterial({color: '#fff9e7'}),
    brake: new T.MeshBasicMaterial({color: '#ff5955'}),
    glass,
  };
}

/** Create an exportable metre-scale U12. Texture canvases hold original drawings, not photographs. */
export function createU12Model(vehicle = {}) {
  const root = new T.Group();
  root.name = 'Nobina Yutong U12-B';
  const fixed = new T.Group();
  fixed.name = 'Body and interior';
  root.add(fixed);
  const fleet = String(vehicle.id || '').match(namedFleet)?.[1] || '';
  const plate = fleet ? 'YMN-' + (Number(fleet) - 600) : '';
  const m = materials();
  const leaves = [];
  const axles = AXLES.map((z) => {
    const axle = new T.Group();
    axle.position.set(0, 0.48, z);
    root.add(axle);
    return axle;
  });
  box(fixed, m.black, 0, 0.33, 0, 2.1, 0.29, 10.8, 0.1);
  for (const side of [-1, 1]) {
    const artwork = imageMaterial(sideArt(side, fleet));
    const shell = sideWall(side === 1);
    skinSection(shell, side, artwork, fixed);
    skinSection(shell, side, m.glass, fixed, HALF - 0.024);
    for (const z of AXLES) {
      rim(axles[AXLES.indexOf(z)], side, z, m);
      arcTrim(fixed, side, z, z < 0 ? m.blue : m.white);
    }
    if (side === 1)
      for (const door of DOORS) {
        const width = door.width / door.count;
        for (let i = 0; i < door.count; i++) {
          const lo = door.z - door.width / 2 + i * width;
          const leaf = new T.Group();
          leaf.name = 'Door ' + (DOORS.indexOf(door) + 1) + ' leaf ' + (i + 1);
          const shape = section(lo + 0.006, 0.234, lo + width - 0.006, 2.63);
          skinSection(shape, 1, artwork, leaf, HALF + 0.003);
          skinSection(shape, 1, m.glass, leaf, HALF - 0.01);
          box(leaf, m.rubber, HALF + 0.005, 1.415, lo + width - 0.018, 0.024, 2.35, 0.025);
          batch(leaf);
          root.add(leaf);
          leaves.push({leaf, direction: door.count === 1 ? 1 : i === 0 ? -1 : 1, width: width * 0.88});
        }
        box(fixed, m.steel, 1.19, 0.268, door.z, 0.16, 0.047, door.width - 0.04);
        box(fixed, m.floor, 1.11, 0.295, door.z, 0.22, 0.015, door.width - 0.05);
        box(fixed, m.chrome, 1.272, 0.245, door.z, 0.022, 0.04, door.width - 0.02);
      }
  }
  nose(fixed, true, imageMaterial(endArt(true, fleet, plate)), m.glass);
  nose(fixed, false, imageMaterial(endArt(false, fleet, plate)), m.glass);
  const brakeLights = new T.Group();
  brakeLights.name = 'Brake lamps';
  root.add(brakeLights);
  fascia(fixed, m, brakeLights);
  interior(fixed, m);
  roof(fixed, m);
  const boards = signs(fixed);
  for (const axle of axles) {
    for (const part of axle.children) part.position.sub(axle.position);
    batch(axle);
  }
  batch(fixed);
  batch(brakeLights);
  instances.set(root, {boards, leaves, axles, brakeLights, lastSign: null});
  updateU12Model(root, vehicle);
  return root;
}

/** Opening progress is optional and ranges from zero to one, shared across the active door leaves. */
export function updateU12Model(root, vehicle, opening = vehicle.doors === true ? 1 : 0) {
  const state = instances.get(root);
  if (!state) return;
  const {boards, leaves, axles, brakeLights} = state;
  if (Number.isFinite(vehicle.wheelDistance)) {
    for (const axle of axles) axle.rotation.x = -(vehicle.wheelDistance / 0.48) % (Math.PI * 2);
  }
  for (const {leaf, direction, width} of leaves) {
    leaf.position.set(Math.min(1, opening * 4) * 0.073, 0, direction * opening * width);
  }
  brakeLights.visible = vehicle.stopped === true;
  const sign = String(vehicle.line || '') + '\n' + String(vehicle.destination || '');
  if (sign === state.lastSign) return;
  state.lastSign = sign;
  for (const [key, short] of [
    ['face', false],
    ['rear', true],
  ]) {
    boards[key].map?.dispose();
    boards[key].map = signArt(vehicle.line, vehicle.destination, short);
    boards[key].needsUpdate = true;
  }
}
export function disposeU12Model(root) {
  const geometries = new Set(),
    materials = new Set(),
    textures = new Set();
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    geometries.add(obj.geometry);
    materials.add(obj.material);
    if (obj.material.map) textures.add(obj.material.map);
  });
  geometries.forEach((x) => x.dispose());
  materials.forEach((x) => x.dispose());
  textures.forEach((x) => x.dispose());
  instances.delete(root);
}
