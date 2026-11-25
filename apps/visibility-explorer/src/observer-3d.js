import * as maplibregl from 'maplibre-gl';

const DEG = Math.PI / 180;
const rgb = (hex) => [16, 8, 0].map((s) => ((hex >> s) & 255) / 255);
function unit(a) {
  const norm = Math.hypot(...a) || 1;
  return a.map((x) => x / norm);
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

const shoulder = (side) => [side * 0.186, 0, 1.407];
const elbow = (side) => [side * 0.261, -side * 0.066, 1.158];
const leftShoulder = shoulder(-1),
  leftElbow = elbow(-1);
const greetingMs = 1000;

// Metres in body space. +y is the face/forward direction and +z is up.
// Build one static mesh for all parts. The nominal sole-to-cap height is 1.80 m.
function buildHiker() {
  const data = [];
  const jacket = 0xf2aa3d,
    seam = 0xbb732d,
    trim = 0x87542e,
    sleeve = 0xf4bd60,
    pants = 0x364d56,
    cargo = 0x46616b,
    sole = 0x323c3c,
    leather = 0x825238,
    leatherLight = 0x9d6a46,
    pack = 0x148084,
    webbing = 0x213e38,
    packLight = 0x41aaa3,
    skin = 0xd89b71,
    shade = 0xab7252,
    hair = 0x3f332b,
    beanie = 0xe85046,
    brim = 0xb33338,
    pom = 0xfde797,
    metal = 0xb4c2c0;
  const push = (p, n, c) => data.push(...p, ...n, ...c);
  function surface(rows, sides, vertex, color) {
    const c = rgb(color),
      rings = [];
    for (let k = 0; k <= rows; k++) {
      const ring = [];
      for (let i = 0; i < sides; i++) ring.push(vertex(k, (2 * Math.PI * i) / sides));
      rings.push(ring);
    }
    for (let k = 0; k < rows; k++)
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides,
          a = rings[k][i],
          b = rings[k][j],
          d = rings[k + 1][i],
          e = rings[k + 1][j];
        for (const v of [a, b, d, b, e, d]) push(v[0], v[1], c);
      }
  }
  function ellipsoid(x, y, z, rx, ry, rz, color, tilt = 0) {
    const co = Math.cos(tilt),
      si = Math.sin(tilt);
    surface(
      9,
      16,
      (k, t) => {
        const lat = -Math.PI / 2 + (k * Math.PI) / 9,
          nx = Math.cos(t) * Math.cos(lat),
          ny = Math.sin(t) * Math.cos(lat),
          nz = Math.sin(lat);
        const n = unit([nx / rx, ny / ry, nz / rz]),
          a = ry * ny,
          b = rz * nz;
        return [
          [x + rx * nx, y + a * co - b * si, z + a * si + b * co],
          [n[0], n[1] * co - n[2] * si, n[1] * si + n[2] * co],
        ];
      },
      color,
    );
  }
  // [height, half width, half depth, forward offset]. Smooth normals follow the cut of the garment.
  function garment(x, y, rows, color) {
    surface(
      rows.length - 1,
      18,
      (k, t) => {
        const [z, rx, ry, offset] = rows[k],
          a = rows[Math.max(0, k - 1)],
          b = rows[Math.min(k + 1, rows.length - 1)];
        const co = Math.cos(t),
          si = Math.sin(t),
          edge = [-rx * si, ry * co, 0];
        const vertical = [(b[1] - a[1]) * co, (b[2] - a[2]) * si + (b[3] - a[3]), b[0] - a[0]];
        return [[x + rx * co, y + offset + ry * si, z], unit(cross(edge, vertical))];
      },
      color,
    );
  }
  // Rounded tapered segment for sleeves, articulated legs, gear and the pole.
  function segment(a, b, rx, ry, color, taper = 1) {
    const delta = b.map((v, i) => v - a[i]),
      axis = unit(delta);
    const right = unit(cross(Math.abs(axis[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0], axis)),
      front = cross(axis, right);
    const ring = [
      [0, 0.035],
      [0.025, 0.7],
      [0.1, 1],
      [0.83, taper],
      [0.96, taper * 0.9],
      [1, 0.035],
    ];
    surface(
      ring.length - 1,
      12,
      (k, t) => {
        const [at, r] = ring[k],
          co = Math.cos(t),
          si = Math.sin(t),
          pr = rx * r * co,
          pf = ry * r * si;
        const capWeight = k === 0 ? -0.9 : k === ring.length - 1 ? 0.9 : 0;
        return [
          a.map((v, i) => v + at * delta[i] + pr * right[i] + pf * front[i]),
          unit(
            right.map(
              (v, i) =>
                (v * co) / rx + (front[i] * si) / ry + (axis[i] * capWeight) / Math.max(rx, ry),
            ),
          ),
        ];
      },
      color,
    );
  }
  for (const side of [-1, 1]) {
    const x = side * 0.112,
      y = side * 0.068;
    ellipsoid(x, y + 0.045, 0.053, 0.088, 0.152, 0.052, sole);
    ellipsoid(x, y + 0.047, 0.102, 0.087, 0.145, 0.068, leather);
    ellipsoid(x, y + 0.139, 0.09, 0.081, 0.057, 0.045, leatherLight);
    garment(
      x,
      y,
      [
        [0.105, 0.081, 0.079, 0],
        [0.16, 0.082, 0.079, 0],
        [0.185, 0.068, 0.069, 0],
      ],
      leather,
    );
    for (let n = 0; n < 3; n++) {
      const t = y + 0.083 - n * 0.022;
      segment(
        [x - 0.045, t + 0.006, 0.154 + n * 0.004],
        [x + 0.045, t - 0.006, 0.155 + n * 0.004],
        0.004,
        0.004,
        0xe1c99f,
      );
    }
    const knee = [side * 0.105, y + 0.022, 0.525],
      hip = [side * 0.093, -y * 0.13, 0.945];
    segment([x, y, 0.157], knee, 0.086, 0.083, pants, 1.07);
    segment(knee, hip, 0.101, 0.107, pants, 1.12);
    ellipsoid(knee[0], knee[1] + 0.034, knee[2], 0.09, 0.072, 0.09, cargo);
    ellipsoid(side * 0.193, -0.01, 0.735, 0.022, 0.069, 0.094, cargo);
  }
  garment(
    0,
    0,
    [
      [0.845, 0.103, 0.086, 0],
      [0.87, 0.183, 0.119, 0],
      [0.96, 0.178, 0.121, 0],
      [1.015, 0.151, 0.109, 0],
    ],
    pants,
  );
  garment(
    0,
    0,
    [
      [0.93, 0.184, 0.122, 0.002],
      [0.963, 0.185, 0.125, 0.002],
      [0.97, 0.182, 0.122, 0],
    ],
    webbing,
  );
  garment(
    0,
    0,
    [
      [0.957, 0.151, 0.112, 0],
      [0.982, 0.185, 0.132, 0.005],
      [1.07, 0.174, 0.137, 0],
      [1.23, 0.204, 0.148, 0],
      [1.39, 0.218, 0.142, 0],
      [1.453, 0.192, 0.119, 0.004],
      [1.491, 0.098, 0.084, 0.003],
      [1.496, 0.067, 0.063, 0.005],
    ],
    jacket,
  );
  garment(
    0,
    0,
    [
      [0.968, 0.182, 0.129, 0.003],
      [0.983, 0.185, 0.134, 0.005],
      [0.994, 0.184, 0.134, 0.004],
    ],
    seam,
  );
  segment([0, 0.134, 1.0], [0, 0.147, 1.36], 0.007, 0.006, trim);
  segment([0, 0.147, 1.36], [0, 0.083, 1.483], 0.005, 0.005, trim);
  function upperArm(side) {
    segment(shoulder(side), elbow(side), 0.093, 0.09, jacket, 0.83);
    ellipsoid(...elbow(side), 0.074, 0.077, 0.074, seam);
  }
  function lowerArm(side) {
    const wrist = [side * 0.265, side > 0 ? 0.18 : 0.085, 1.021];
    segment(elbow(side), wrist, 0.073, 0.074, sleeve, 0.72);
    const cuff = [wrist[0], wrist[1] + 0.011, wrist[2] - 0.017];
    segment([wrist[0], wrist[1] - 0.012, wrist[2] + 0.017], cuff, 0.054, 0.05, trim);
    ellipsoid(cuff[0], cuff[1] + 0.012, cuff[2] - 0.035, 0.048, 0.053, 0.066, skin, 0.21);
  }
  upperArm(1);
  lowerArm(1);
  for (const side of [-1, 1]) {
    segment([side * 0.133, 0.09, 1.461], [side * 0.153, 0.116, 1.285], 0.022, 0.017, webbing);
    segment([side * 0.153, 0.116, 1.285], [side * 0.173, 0.073, 1.096], 0.021, 0.015, webbing);
  }
  segment([-0.15, 0.145, 1.307], [0.15, 0.145, 1.307], 0.009, 0.011, webbing);
  segment([-0.017, 0.153, 1.307], [0.021, 0.153, 1.307], 0.012, 0.014, metal);
  // A large fabric rucksack behind the shoulders, with a lid, rear pocket and roll.
  garment(
    0,
    -0.143,
    [
      [1.015, 0.04, 0.035, -0.012],
      [1.045, 0.137, 0.073, -0.036],
      [1.13, 0.152, 0.096, -0.037],
      [1.36, 0.159, 0.095, -0.029],
      [1.467, 0.132, 0.074, -0.015],
      [1.493, 0.04, 0.02, -0.011],
    ],
    pack,
  );
  ellipsoid(0, -0.251, 1.192, 0.14, 0.052, 0.119, packLight);
  // A broad teal bedroll gives the rucksack an outline from the side as well as the back.
  segment([-0.202, -0.203, 1.419], [0.202, -0.203, 1.419], 0.063, 0.065, packLight);
  for (const x of [-0.12, 0.12])
    segment([x - 0.013, -0.203, 1.419], [x + 0.013, -0.203, 1.419], 0.065, 0.066, webbing);
  ellipsoid(0, -0.191, 1.425, 0.157, 0.091, 0.067, packLight);
  segment([-0.149, -0.227, 1.043], [0.149, -0.227, 1.043], 0.045, 0.047, 0x9caa85);
  for (const side of [-1, 1]) {
    segment([side * 0.086, -0.268, 1.057], [side * 0.084, -0.289, 1.256], 0.009, 0.006, webbing);
    segment([side * 0.087, -0.272, 1.33], [side * 0.083, -0.256, 1.445], 0.01, 0.008, webbing);
  }
  ellipsoid(0, 0.004, 1.503, 0.071, 0.063, 0.087, skin);
  ellipsoid(0, -0.018, 1.616, 0.109, 0.091, 0.127, hair);
  ellipsoid(0, 0.024, 1.624, 0.116, 0.104, 0.126, skin, -0.055);
  for (const side of [-1, 1]) {
    ellipsoid(side * 0.099, 0.006, 1.621, 0.021, 0.023, 0.036, skin);
    ellipsoid(side * 0.047, 0.12, 1.644, 0.012, 0.009, 0.014, hair);
    ellipsoid(side * 0.077, 0.101, 1.611, 0.022, 0.008, 0.013, 0xe49274);
    segment([side * 0.026, 0.109, 1.667], [side * 0.067, 0.1, 1.669], 0.006, 0.005, hair);
  }
  ellipsoid(0, 0.123, 1.628, 0.023, 0.035, 0.031, skin, -0.2);
  for (const side of [-1, 1])
    segment([0, 0.122, 1.583], [side * 0.028, 0.119, 1.592], 0.005, 0.004, shade);
  // Poppy-red wool hat and golden pom-pom. The colours remain distinct at map scale.
  ellipsoid(0, -0.004, 1.692, 0.138, 0.132, 0.083, beanie);
  ellipsoid(0, 0, 1.685, 0.143, 0.135, 0.037, brim);
  ellipsoid(0.01, -0.009, 1.762, 0.043, 0.044, 0.039, pom);
  // A single trekking pole sits in the right hand.
  segment([0.265, 0.197, 1.019], [0.291, 0.32, 0.029], 0.008, 0.008, metal, 0.7);
  segment([0.265, 0.19, 1.064], [0.269, 0.205, 0.936], 0.014, 0.014, webbing);
  ellipsoid(0.291, 0.317, 0.052, 0.023, 0.024, 0.006, webbing);
  // The resting hiker is one draw. The two contiguous left-arm ranges only need
  // separate transforms during the placement greeting.
  const wavingArmStart = data.length / 9;
  upperArm(-1);
  const wavingForearmStart = data.length / 9;
  lowerArm(-1);
  return {vertices: new Float32Array(data), wavingArmStart, wavingForearmStart};
}
const vertex = `#version 300 es
  layout(location=0) in vec3 pos;
  layout(location=1) in vec3 normal;
  layout(location=2) in vec3 paint;
  uniform mat4 transform;
  uniform vec2 feet;
  uniform vec3 light;
  out vec3 lit;
  void main() {
    vec3 p = pos;
    // Each boot rests on its own local ground sample, blending back to the hip.
    p.z += mix(feet.x, feet.y, smoothstep(-.03, .03, p.x)) * (1. - smoothstep(.18, .83, p.z));
    gl_Position = transform * vec4(p, 1.);
    float direct = max(0., dot(normal, light));
    float sky = .5 + .5 * normal.z;
    lit = paint * (.60 + .32 * direct + .13 * sky);
  }`;
const fragment = `#version 300 es
  precision highp float;
  in vec3 lit;
  uniform float opacity;
  out vec4 result;
  void main(){result=vec4(lit*opacity,opacity);}`;
function shaderProgram(gl) {
  const program = gl.createProgram(),
    shaders = [];
  try {
    for (const [type, source] of [
      [gl.VERTEX_SHADER, vertex],
      [gl.FRAGMENT_SHADER, fragment],
    ]) {
      const shader = gl.createShader(type);
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw Error(gl.getProgramInfoLog(program));
    return program;
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  } finally {
    shaders.forEach((s) => gl.deleteShader(s));
  }
}
const clampUnit = (value) => Math.min(1, Math.max(0, value));

// The portrait and mesh use the same CSS-pixel scale through the handoff.
export function observerSymbolHeight(zoom) {
  return 24 + 2 * Math.max(0, Math.min(16, zoom - 6));
}

export const maxObserverHeight = 142;

export function observerModelOpacity(zoom, pitch) {
  // From overhead the camera sees only the cap, even at close zoom. Keep
  // the standing portrait until the pitch lets the actual silhouette read.
  return easeInOut((zoom - 9) / 1.15) * easeInOut((pitch - 22) / 10);
}

// Compose a body-space Y rotation about a joint into the model-view-projection matrix.
function rotateJoint(out, input, joint, angle) {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  for (let i = 0; i < 4; i++) {
    out[i] = input[i] * c - input[8 + i] * s;
    out[4 + i] = input[4 + i];
    out[8 + i] = input[i] * s + input[8 + i] * c;
    out[12 + i] =
      input[12 + i] + (input[i] - out[i]) * joint[0] + (input[8 + i] - out[8 + i]) * joint[2];
  }
}
function easeInOut(fraction) {
  const t = clampUnit(fraction);
  return t * t * (3 - 2 * t);
}

function createLayer(marker, id = 'observer-hiker-3d') {
  let map,
    program,
    vao,
    buffer,
    uniforms,
    count = 0,
    wavingArmStart = 0,
    wavingForearmStart = 0,
    placedAt = -Infinity,
    placementHidden = false,
    pose = null;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const upperMatrix = new Float32Array(16),
    forearmMatrix = new Float32Array(16);
  const matrix = new Float32Array(16);
  return {
    id,
    type: 'custom',
    renderingMode: '3d',
    setPlacementHidden(hidden) {
      if (placementHidden === hidden) return;
      placementHidden = hidden;
      map?.triggerRepaint();
    },
    setPose(point, groundM, bearing = 0) {
      if (
        !point ||
        !Number.isFinite(point.lat) ||
        Math.abs(point.lat) > 85.052 ||
        !Number.isFinite(point.lon)
      )
        pose = null;
      else {
        if (!pose || pose.lat !== point.lat || pose.lon !== point.lon)
          placedAt = motion.matches ? -Infinity : null;
        const anchor = maplibregl.MercatorCoordinate.fromLngLat([point.lon, point.lat]);
        pose = {
          lon: point.lon,
          lat: point.lat,
          ground: Number.isFinite(groundM) ? groundM : 0,
          bearing: Number.isFinite(bearing) ? bearing : 0,
          anchor,
          scale: anchor.meterInMercatorCoordinateUnits(),
        };
      }
      map?.triggerRepaint();
    },
    onAdd(value, gl) {
      map = value;
      program = shaderProgram(gl);
      vao = gl.createVertexArray();
      buffer = gl.createBuffer();
      const geometry = buildHiker();
      count = geometry.vertices.length / 9;
      wavingArmStart = geometry.wavingArmStart;
      wavingForearmStart = geometry.wavingForearmStart;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, geometry.vertices, gl.STATIC_DRAW);
      for (let i = 0; i < 3; i++) {
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, 3, gl.FLOAT, false, 36, 12 * i);
      }
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      uniforms = Object.fromEntries(
        ['transform', 'light', 'opacity', 'feet'].map((k) => [
          k,
          gl.getUniformLocation(program, k),
        ]),
      );
    },
    render(gl, args) {
      if (!pose || placementHidden) return;
      const opacity = observerModelOpacity(map.getZoom(), map.getPitch());
      if (opacity <= 0) {
        placedAt = -Infinity;
        return;
      }
      const t = pose.bearing * DEG,
        c = Math.cos(t),
        s = Math.sin(t),
        k = pose.scale;
      const terrain = map.getTerrain(),
        coord = [pose.lon, pose.lat];
      const drawn = terrain ? map.queryTerrainElevation(coord) : 0;
      const ground = Number.isFinite(drawn) ? drawn : pose.ground;
      const world = Math.round((map.getCenter().lng - pose.lon) / 360);
      const x = pose.anchor.x + world,
        y = pose.anchor.y,
        z = k * ground;
      const m = args.defaultProjectionData.mainMatrix;
      // Translate in double precision on CPU before converting the small, local matrix
      // to float32. A direct transform of world x/y loses metres at close zooms.
      for (let i = 0; i < 4; i++) {
        matrix[i] = k * (m[i] * c + m[4 + i] * s);
        matrix[4 + i] = k * (m[i] * s - m[4 + i] * c);
        matrix[8 + i] = k * m[8 + i];
        matrix[12 + i] = m[12 + i] + m[i] * x + m[4 + i] * y + m[8 + i] * z;
      }
      // Use the actual local projection: pitch, camera distance and latitude
      // affect how tall a 1.8 m figure appears, even at the same map zoom.
      const w = matrix[15],
        headW = w + 1.8 * matrix[11];
      if (w <= 0 || headW <= 0) return;
      const canvas = map.getCanvas();
      const projectedHeight = Math.hypot(
        (canvas.clientWidth / 2) * ((matrix[12] + 1.8 * matrix[8]) / headW - matrix[12] / w),
        (canvas.clientHeight / 2) * ((matrix[13] + 1.8 * matrix[9]) / headW - matrix[13] / w),
      );
      if (projectedHeight < 0.000001) return;
      const desiredHeight = Math.min(
        maxObserverHeight,
        Math.max(observerSymbolHeight(map.getZoom()), projectedHeight),
      );
      // Changing scale also changes the head's perspective divisor. Solve
      // for the screen height rather than multiplying by the unscaled ratio.
      const headDepth = (headW - w) / w;
      const scale = desiredHeight / (projectedHeight * (1 + headDepth) - desiredHeight * headDepth);
      if (!Number.isFinite(scale) || scale <= 0) return;
      if (Math.abs(scale - 1) > 0.0001) {
        // A resized symbol must not peek over a ridge hiding its anchor.
        if (marker?.classList.contains('maplibregl-marker-covered')) {
          placedAt = -Infinity;
          return;
        }
        for (let i = 0; i < 12; i++) matrix[i] *= scale;
      }
      function footing(side) {
        if (!terrain) return 0;
        const east = side * 0.112 * c + (side * 0.068 + 0.045) * s,
          north = -side * 0.112 * s + (side * 0.068 + 0.045) * c;
        const ll = new maplibregl.MercatorCoordinate(
          pose.anchor.x + east * k * scale,
          pose.anchor.y - north * k * scale,
        ).toLngLat();
        const height = map.queryTerrainElevation(ll);
        return Number.isFinite(height)
          ? Math.max(-0.25, Math.min(0.25, (height - ground) / scale))
          : 0;
      }
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.uniformMatrix4fv(uniforms.transform, false, matrix);
      gl.uniform2f(uniforms.feet, footing(-1), footing(1));
      // Fixed northwest key in world space, transformed into the person's body axes.
      gl.uniform3f(uniforms.light, -0.42 * c - 0.34 * s, -0.42 * s + 0.34 * c, 0.8414);
      gl.uniform1f(uniforms.opacity, opacity);
      // Start the greeting on the first drawing frame, even if the initial tiles took time to load.
      if (placedAt === null) placedAt = performance.now();
      const phase = placedAt === -Infinity ? 1 : (performance.now() - placedAt) / greetingMs;
      if (phase < 1 && !motion.matches) {
        // Raise the free arm, wave at the elbow, and settle the hand beside the pack.
        const lift = easeInOut(phase / 0.23) * (1 - easeInOut((phase - 0.73) / 0.27));
        const wobble =
          Math.sin((phase - 0.23) * 7 * Math.PI) *
          easeInOut((phase - 0.19) / 0.1) *
          (1 - easeInOut((phase - 0.67) / 0.12));
        const upper = 1.62 * lift,
          forearm = (1.1 + 0.48 * wobble) * lift;
        gl.drawArrays(gl.TRIANGLES, 0, wavingArmStart);
        rotateJoint(upperMatrix, matrix, leftShoulder, upper);
        rotateJoint(forearmMatrix, upperMatrix, leftElbow, forearm);
        const lx = -0.42 * c - 0.34 * s,
          ly = -0.42 * s + 0.34 * c,
          lz = 0.8414;
        function drawArm(transform, angle, begin, end) {
          const ca = Math.cos(angle),
            sa = Math.sin(angle);
          gl.uniformMatrix4fv(uniforms.transform, false, transform);
          gl.uniform3f(uniforms.light, ca * lx - sa * lz, ly, sa * lx + ca * lz);
          gl.drawArrays(gl.TRIANGLES, begin, end - begin);
        }
        drawArm(upperMatrix, upper, wavingArmStart, wavingForearmStart);
        drawArm(forearmMatrix, upper + forearm, wavingForearmStart, count);
        map.triggerRepaint();
      } else {
        placedAt = -Infinity;
        gl.drawArrays(gl.TRIANGLES, 0, count);
      }
      gl.bindVertexArray(null);
    },
    onRemove(_m, gl) {
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      map = null;
    },
  };
}
export default {createLayer};
