import { mkdir, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The untextured GLB exporter uses FileReader to assemble its binary chunks.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend();
    });
  }
};

const up = new THREE.Vector3(0, 1, 0);
const output = new URL('../assets/trees/', import.meta.url);

function paint(geometry, value) {
  geometry.deleteAttribute('uv');
  const mesh = geometry.index ? geometry.toNonIndexed() : geometry;
  const colors = new Float32Array(mesh.attributes.position.count * 3).fill(value);
  mesh.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return mesh;
}

function bough(from, to, bottom, top, sides = 7) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const direction = b.clone().sub(a);
  const rotation = new THREE.Quaternion().setFromUnitVectors(up, direction.clone().normalize());
  const midpoint = a.lerp(b, .5);
  const geometry = new THREE.CylinderGeometry(top, bottom, direction.length(), sides, 1, true);
  return paint(geometry.applyQuaternion(rotation).translate(...midpoint), .82);
}

function lobe([x, y, z, width, height, depth, shade], detail = 0) {
  const geometry = new THREE.IcosahedronGeometry(1, detail);
  return paint(geometry.scale(width, height, depth).rotateY(x * .6 + y).translate(x, y, z), shade);
}

// Individual crowns overlap so each type has its own silhouette and pockets of shade.
const deciduous = {
  round: {
    trunk: [.13, 3.9, -.14],
    forks: [[-1.18, 3.72, .25], [1.17, 3.9, .37], [.17, 3.55, -1.05]],
    crown: [
      [.0, 4.65, .0, 1.62, 1.43, 1.53, .94], [-1.28, 4.2, .37, 1.28, 1.1, 1.18, .83],
      [1.25, 4.51, -.21, 1.36, 1.19, 1.23, .91], [.02, 4.29, -1.08, 1.25, 1.17, 1.3, .85],
      [-.45, 5.43, -.48, 1.07, .98, .97, 1], [.5, 5.4, .62, .93, .94, 1, 1],
      [-.6, 4.1, 1.2, 1.18, .93, 1.12, .84], [.83, 3.98, .97, 1.1, .98, .96, .82],
      [-1.67, 4.91, -.41, .83, .91, .89, .94], [1.46, 5.07, .56, .87, .88, .89, .96],
    ],
    far: [0, 1, 2, 4],
  },
  open: {
    trunk: [-.2, 4.9, .1],
    forks: [[-1.68, 4.2, .48], [1.56, 4.36, .69], [.91, 4.48, -1.22]],
    crown: [
      [-.27, 5.14, .12, 1.7, .9, 1.38, .94], [-1.65, 4.87, .43, 1.43, .84, 1.22, .88],
      [1.57, 4.93, .65, 1.41, .85, 1.23, .92], [.76, 4.94, -1.25, 1.51, .96, 1.33, .92],
      [-1.41, 5.24, -.68, 1.2, .77, 1.02, .95], [-.86, 4.93, 1.34, 1.24, .76, .98, .85],
      [.55, 5.32, 1.34, 1.04, .76, .92, 1], [.26, 5.7, -.2, 1.06, .68, 1.08, 1],
      [2.15, 4.73, -.04, .87, .62, .94, .87], [-2.02, 4.72, -.65, .87, .65, .82, .87],
    ],
    far: [0, 1, 2, 3, 5],
  },
  tall: {
    trunk: [.12, 5.75, -.14],
    forks: [[-1.02, 4.68, .22], [1.2, 5.52, .1], [0, 5.08, -.81]],
    crown: [
      [.12, 5.89, .03, 1.5, 1.91, 1.35, .94], [-.93, 5.29, .54, 1.12, 1.28, 1.12, .83],
      [1.02, 5.78, .12, 1.05, 1.43, 1.06, .91], [-.1, 5.65, -.85, 1.19, 1.57, .92, .87],
      [-.25, 7.07, -.15, .9, 1.23, .9, .99], [.43, 6.51, .65, .82, 1.16, .85, .95],
      [.25, 4.74, .79, 1.06, 1.01, .92, .82], [-.9, 6.54, -.45, .83, 1.11, .8, .93],
    ],
    far: [0, 1, 2, 4],
  },
  columnar: {
    trunk: [.05, 5.8, -.12],
    forks: [[-.49, 4.15, .12], [.44, 4.75, -.2]],
    crown: [
      [.03, 5.4, .06, 1, 2.34, .95, .93], [-.46, 4.45, .24, .66, 1.19, .69, .83],
      [.42, 5.18, -.2, .72, 1.47, .64, .91], [.14, 6.94, -.13, .7, 1.56, .71, .99],
      [-.23, 6.05, -.49, .67, 1.14, .6, .87], [.24, 5.42, .48, .67, 1.21, .64, .91],
      [-.35, 7.03, .33, .52, .89, .51, .96], [.29, 4.06, -.08, .63, .97, .68, .82],
    ],
    far: [0, 1, 2, 3],
  },
};

function broadleaf(form, far) {
  const { trunk, forks, crown, far: simplified } = deciduous[form];
  const wood = [bough([0, 0, 0], trunk, .3, .08, far ? 5 : 8)];
  if (!far) {
    forks.forEach((tip, index) => wood.push(bough([0, 1.8 + index * .42, 0], tip, .13, .044, 5)));
  }
  const leaves = far ? simplified.map((index) => lobe(crown[index])) : crown.map((data, index) => lobe(data, index < 4 ? 1 : 0));
  return [wood, leaves];
}

function conifer(far) {
  const trunk = [bough([0, 0, 0], [.06, 6.9, 0], .25, .05, far ? 5 : 8)];
  const tiers = far
    ? [[0, 2.68, 1.87, 2.55, .81], [0, 4.24, 1.46, 2.57, .9], [.01, 5.67, 1.02, 2.6, 1]]
    : [[-.1, 2.36, 1.92, 2.26, .78], [.12, 3.14, 1.76, 2.29, .83],
      [-.08, 3.95, 1.5, 2.34, .86], [.02, 4.74, 1.29, 2.47, .92],
      [.05, 5.47, 1.02, 2.35, .96], [.02, 6.26, .74, 2.65, 1]];
  const leaves = tiers.map(([x, y, radius, height, shade], index) => {
    const geometry = new THREE.CylinderGeometry(0, radius, height, far ? 7 : 11, 1);
    return paint(geometry.scale(1, 1, .92).rotateY(index * .39).translate(x, y, 0), shade);
  });
  return [trunk, leaves];
}

function palm(form, far) {
  const feather = form === 'palm-feather';
  const head = [.49, 5.95, .32];
  const trunk = far ? [bough([0, 0, 0], head, .25, .12, 5)] : [
    bough([0, 0, 0], [.1, 1.9, .04], .33, .23),
    bough([.1, 1.9, .04], [.25, 3.85, .16], .23, .16),
    bough([.25, 3.85, .16], head, .16, .15),
    lobe([.49, 5.89, .32, .33, .45, .3, .75]),
  ];
  const leaves = [];
  const count = far ? 6 : 10;
  const lobes = feather ? (far ? 3 : 6) : (far ? 4 : 8);

  for (let index = 0; index < count; index += 1) {
    const positions = [];
    const angle = index * Math.PI * 2 / count;
    const length = (feather ? 2.35 : 1.76) + (index % 3) * .22;
    const vertex = (out, side, rise) => [
      head[0] + Math.cos(angle) * out - Math.sin(angle) * side,
      head[1] + rise,
      head[2] + Math.sin(angle) * out + Math.cos(angle) * side,
    ];
    if (feather) {
      const spine = (t) => vertex(length * t, 0, .56 * Math.sin(Math.PI * t) - t * t * (.53 + (index % 3) * .28));
      for (let tooth = 0; tooth < lobes; tooth += 1) {
        const a = tooth / lobes;
        const b = (tooth + 1) / lobes;
        const width = .52 * Math.sin((.17 + a * .72) * Math.PI);
        const rise = .39 * Math.sin(a * Math.PI) - a * a * .73 - .15;
        positions.push(...spine(a), ...spine(b), ...vertex(length * (b + .06), -width, rise));
        positions.push(...spine(b), ...spine(a), ...vertex(length * (b + .06), width, rise));
      }
    } else {
      const root = vertex(.39, 0, .24);
      for (let notch = 0; notch < lobes; notch += 1) {
        const across = (notch + .5) / lobes - .5;
        const edge = (side, inset) => vertex(length * (1 - Math.abs(side) * .65) - inset, side * 1.88, .41 - .21 * (index % 3));
        const tip = edge(across, 0);
        positions.push(...root, ...tip, ...edge(across - .48 / lobes, .29));
        positions.push(...root, ...edge(across + .48 / lobes, .29), ...tip);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    leaves.push(paint(geometry, .82 + (index % 4) * .055));
  }
  return [trunk, leaves];
}

await mkdir(output, { recursive: true });
const exporter = new GLTFExporter();
const models = ['round', 'open', 'tall', 'conifer', 'columnar', 'palm-feather', 'palm-fan'];
for (const form of models) {
  for (const far of [false, true]) {
    const isPalm = form.startsWith('palm-');
    const parts = isPalm ? palm(form, far) : form === 'conifer' ? conifer(far) : broadleaf(form, far);
    const materials = (isPalm ? ['stem', 'fronds'] : ['bark', 'leaves']).map((name) =>
      new THREE.MeshStandardMaterial({ name, roughness: .95, vertexColors: true, side: THREE.DoubleSide }),
    );
    const geometry = mergeGeometries(parts.map((group) => mergeGeometries(group)), true);
    const triangles = geometry.attributes.position.count / 3;
    const name = `streets-tree-${form}${far ? '.far' : ''}.glb`;
    if (triangles > (far ? 120 : 700)) throw new Error(`${name} has ${triangles} triangles`);
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.name = form;
    const binary = await exporter.parseAsync(mesh, { binary: true });
    await writeFile(new URL(name, output), Buffer.from(binary));
  }
}
