// Arco in metres. +X faces the kerb, +Y is up, the nose points towards -Z.
import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const ARCO = Object.freeze({
  doorZ: -0.86, doorLeafOffset: 0.375, doorTravel: 0.72, doorOutset: 0.09, boardingX: 1.42,
  wheelY: 0.51, wheelRadius: 0.51, frontAxleZ: -3.52, rearAxleZ: 3.74, roofY: 3.30,
});

const sill = 0.59;
const lintel = 2.58;
const doorWidth = 1.50;
const firstJamb = ARCO.doorZ - doorWidth / 2;
const lastJamb = ARCO.doorZ + doorWidth / 2;
const exponent = 5.8;
// Each station supplies z, half-width, bottom and crown of the superellipse.
const stations = [
  [-5.86, 1.03, .58, 2.92], [-5.68, 1.20, .44, 3.04], [-5.38, 1.27, .35, 3.17],
  [-4.85, 1.29, .32, 3.21], [firstJamb, 1.29, .32, 3.21], [lastJamb, 1.29, .32, 3.21],
  [4.95, 1.29, .32, 3.21], [5.48, 1.28, .33, 3.19], [5.75, 1.20, .39, 3.09], [5.85, 1.02, .55, 2.91],
];
const glass = {day: '#d4d9da', night: '#90989a'};
const reflection = {day: '#d5dada', night: '#929a9b'};
const gasket = '#52585b', ceramic = '#dce5e2', aluminium = '#91a8ae';
const signedPower = (x, n) => Math.sign(x) * Math.abs(x) ** n;
const rake = (z, y) => z - .20 * (1.61 - y) * Math.max(0, -z / 5.86) ** 4;
const rimX = (y, w, b, t) => w * Math.max(0, 1 - Math.abs(2 * (y - b) / (t - b) - 1) ** exponent) ** (1 / exponent);

function sideX(z, y) {
  let i = 1;
  while (i < stations.length - 1 && stations[i][0] < z) i++;
  const a = stations[i-1], b = stations[i];
  const u = THREE.MathUtils.clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
  return rimX(y, ...[1, 2, 3].map(k => THREE.MathUtils.lerp(a[k], b[k], u)));
}

function roundedRect(width, height, radius, steps = 4) {
  const corners = [[1, 1, 0], [-1, 1, .5], [-1, -1, 1], [1, -1, 1.5]];
  const points = [];
  for (const [sx, sy, turn] of corners) {
    for (let j = 0; j <= steps; j++) {
      const a = Math.PI * (turn + .5 * j / steps);
      const point = [sx * (width / 2 - radius) + radius * Math.cos(a), sy * (height / 2 - radius) + radius * Math.sin(a)];
      if (!points.length || Math.hypot(point[0] - points.at(-1)[0], point[1] - points.at(-1)[1]) > 1e-6) points.push(point);
    }
  }
  if (Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]) < 1e-6) points.pop();
  return points;
}

function face(points) {
  const vertices = points.flat();
  const center = [0, 1, 2].map(k => points.reduce((s, p) => s + p[k], 0) / points.length);
  vertices.push(...center);
  const indices = [];
  for (let i = 0; i < points.length; i++) indices.push(points.length, i, (i + 1) % points.length);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

function bodyShell() {
  const tau = Math.PI * 2;
  const angles = Array.from({length: 48}, (_, i) => i / 48 * tau);
  // Keep vertices exactly on the sill and lintel. This makes a physical opening
  // in the mesh and allows boarding passengers to pass behind the door frame.
  for (const h of [sill, lintel]) {
    const t = 2 * (h - .32) / (3.21 - .32) - 1;
    angles.push((Math.asin(signedPower(t, exponent / 2)) + tau) % tau);
  }
  angles.sort((a,b) => a-b);
  const rings = stations.map(([z,w,b,t]) => angles.map(a => {
    const y = (b + t + (t-b) * signedPower(Math.sin(a), 2 / exponent)) / 2;
    return [w * signedPower(Math.cos(a), 2 / exponent), y, rake(z,y)];
  }));
  const g = new THREE.BufferGeometry(), indices = [], count = angles.length;
  g.setAttribute('position', new THREE.Float32BufferAttribute(rings.flat(2), 3));
  for (let r = 0; r < rings.length - 1; r++) {
    for (let j = 0; j < count; j++) {
      const k = (j + 1) % count;
      const [x,y] = rings[r][j], midY = (y + rings[r][k][1]) / 2;
      if (stations[r][0] === firstJamb && x > 0 && midY > sill && midY < lintel) continue;
      const a = r * count + j, b = r * count + k;
      indices.push(a, b, b + count, a, b + count, a + count);
    }
  }
  g.setIndex(indices);
  g.computeVertexNormals();
  return [g, face(rings[0].slice().reverse()), face(rings.at(-1))];
}

function batch() {
  const parts = [];
  function add(geometry, hex, shade = true) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    const n = g.getAttribute('normal');
    const base = new THREE.Color(hex.day ?? hex);
    const smoke = hex.night && new THREE.Color(hex.night);
    const heights = g.getAttribute('position');
    const colors = new Float32Array(n.count * 3);
    const nightColors = smoke && new Float32Array(colors.length);
    for (let i = 0; i < n.count; i++) {
      const x = n.getX(i), y = n.getY(i), z = n.getZ(i);
      // A stable, neutral skylight keeps a curved shoulder visible with the
      // unlit fleet material, whatever the active delay or route colour.
      let light = shade ? .59 + .34 * Math.max(0, y) + .07 * Math.max(0, .45*x + .80*y - .39*z) : 1;
      // The upper edge of a pane picks up more sky than the lower edge.
      if (hex === glass) light *= .72 + .28 * THREE.MathUtils.clamp((heights.getY(i) - 1.26) / 1.28, 0, 1);
      colors.set([base.r * light, base.g * light, base.b * light], 3 * i);
      if (nightColors) nightColors.set([smoke.r * light, smoke.g * light, smoke.b * light], 3 * i);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors,3));
    if (nightColors) g.userData.nightColors = nightColors;
    parts.push(g);
  }
  function finish() {
    const result = mergeGeometries(parts);
    if (parts.some(p => p.userData.nightColors)) {
      const day = result.getAttribute('color').array, night = day.slice();
      let start = 0;
      for (const part of parts) {
        if (part.userData.nightColors) night.set(part.userData.nightColors, start);
        start += part.getAttribute('color').array.length;
      }
      result.userData.glazing = {day, night};
    }
    for (const p of parts) p.dispose();
    result.computeBoundingBox();
    result.computeBoundingSphere();
    return result;
  }
  return {add, finish};
}

export function setArcoGlassLight(geometries, light) {
  for (const geometry of geometries) {
    const colors = geometry.getAttribute('color'), next = geometry.userData.glazing?.[light];
    if (!next || colors.array === next) continue;
    colors.array = next;
    colors.needsUpdate = true;
  }
}

// The two leaf batches reuse one half-door twice. X/Y are already in vehicle
// space; translate along Z by doorZ ± (doorLeafOffset + travel), then lift
// towards the kerb by up to doorOutset. The axle has origin at its rotation axis.
export function createArcoGeometries() {
  const shell = batch(), fittings = batch(), doorPaint = batch(), doorGlass = batch(), axle = batch();
  for (const skin of bodyShell()) shell.add(skin, '#ffffff');
  function box(target, width, height, length, x, y, z, color, radius = 0) {
    const g = radius ? new RoundedBoxGeometry(width,height,length,1,radius) : new THREE.BoxGeometry(width,height,length);
    target.add(g.translate(x,y,z), color);
  }
  function panel(target, side, z, y, points, color, offset, shade = true, localLeaf = false) {
    const outline = side > 0 ? points.slice().reverse() : points;
    const vertices = outline.map(([u,v]) => {
      const depth = z+u, height = y+v;
      // The entrance sits on the straight portion of the body.
      if (localLeaf) return [rimX(height,1.29,.32,3.21)+offset, height, depth];
      return [side * (sideX(depth,height)+offset), height, rake(depth,height)];
    });
    target.add(face(vertices), color, shade);
  }
  function endPanel(end, x, y, points, color, offset = .016, shade = true) {
    const z = end < 0 ? stations[0][0] : stations.at(-1)[0];
    const vertices = points.map(([u,v]) => [x+u, y+v, rake(z,y+v)+end*offset]);
    fittings.add(face(end < 0 ? vertices.reverse() : vertices), color, shade);
  }
  for (const side of [-1,1]) {
    for (const [z,w] of [[4.20,1.46],[2.52,1.48],[.83,1.50],[ARCO.doorZ,1.50],[-2.57,1.50],[-4.23,1.40]]) {
      if (side > 0 && z === ARCO.doorZ) continue;
      panel(fittings,side,z,1.94,roundedRect(w,1.16,.28),glass,.026);
      panel(fittings,side,z+.10,2.37,roundedRect(w*.57,.052,.026),reflection,.046,false);
    }
  }
  endPanel(-1,0,1.95,roundedRect(1.81,1.01,.18),glass);
  endPanel(-1,0,2.34,roundedRect(1.23,.06,.03),reflection,.035,false);
  endPanel(-1,0,1.09,roundedRect(1.45,.088,.044),'#fff6d5',.018,false);
  endPanel(1,0,1.96,roundedRect(1.58,.65,.10),glass);
  for (const side of [-1,1]) endPanel(1,side*.69,1.24,roundedRect(.12,.31,.06),'#c35355',.018,false);
  box(shell,1.13,.13,2.54,0,3.21,.85,'#ffffff',.06);
  box(fittings,.57,.025,1.62,0,3.284,.93,ceramic,.012);

  // Shallow physical vestibule, facing the kerb. Its depth and contrasting
  // step read when open; the closed leaves restore the uninterrupted shell.
  box(fittings,.055,lintel-sill,doorWidth,.88,(sill+lintel)/2,ARCO.doorZ,'#243b44');
  const innerX = .88;
  const jambHeights = [sill,.88,1.23,2.20,lintel];
  for (const z of [firstJamb,lastJamb]) {
    for (let i = 1; i < jambHeights.length; i++) {
      const a = jambHeights[i-1], b = jambHeights[i];
      const cheek = [[innerX,a,z],[sideX(z,a),a,z],[sideX(z,b),b,z],[innerX,b,z]];
      fittings.add(face(z === firstJamb ? cheek : cheek.reverse()), '#425d64');
    }
  }
  for (const y of [sill,lintel]) {
    const step = [[innerX,y,firstJamb],[innerX,y,lastJamb],[sideX(lastJamb,y),y,lastJamb],[sideX(firstJamb,y),y,firstJamb]];
    fittings.add(face(y === sill ? step : step.reverse()), y === sill ? aluminium : '#405961');
  }
  const leafY = (sill+lintel)/2;
  panel(doorPaint,1,0,leafY,roundedRect(.744,lintel-sill,.055),'#ffffff',.037,true,true);
  panel(doorGlass,1,0,leafY+.18,roundedRect(.585,1.333,.15),glass,.084,true,true);
  // Narrow split, bottom rail and rounded gasket sit on each sliding leaf.
  for (const z of [-.355,.355]) panel(doorGlass,1,z,leafY,roundedRect(.026,1.93,.013),gasket,.070,true,true);
  for (const h of [sill+.038,lintel-.036]) panel(doorGlass,1,0,h,roundedRect(.685,.039,.018),gasket,.070,true,true);

  function disc(target,radius,depth,x,y,z,color) {
    const g = new THREE.CylinderGeometry(radius,radius,depth,24,1).rotateZ(Math.PI/2).translate(x,y,z);
    target.add(g,color,false);
  }
  const wheelX = sideX(0,.61)+.036;
  for (const side of [-1,1]) {
    disc(axle,ARCO.wheelRadius,.15,side*wheelX,0,0,'#394b55');
    disc(axle,.285,.045,side*(wheelX+.099),0,0,aluminium);
    // One pin off the hub centre makes the spin readable from the street.
    disc(axle,.035,.012,side*(wheelX+.13),.19,0,'#415862');
    for (const z of [ARCO.frontAxleZ,ARCO.rearAxleZ]) {
      disc(shell,.126,.038,side*(wheelX+.132),ARCO.wheelY,z,'#ffffff');
    }
  }
  return [shell.finish(),fittings.finish(),doorPaint.finish(),doorGlass.finish(),axle.finish()];
}
