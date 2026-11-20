// A MapLibre custom layer that draws every hexagon as one instanced prism. Everything that moves
// (the opening wave, the colour change between modes, the sea level, the closing) runs in the
// vertex shader from a few uniforms, so the CPU does nothing per frame. Positions are Web Mercator
// metres from `origin` (u east, v south). Each cell carries its real elevation; the shader decides
// from the sea level whether it is land or sea, how high its terrace stands and its colour.
import type {CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap} from 'maplibre-gl';
import {FRESH, GAINED, landColor, LOST, SAND, seaColor} from './colors';

export const EARTH = 40075016.68557849;

/** Towards the sun: high in the west-north-west, as in the reference relief. */
export const LIGHT: [number, number, number] = (() => {
  const v = [-0.62, -0.42, 0.95];
  const l = Math.hypot(...v);
  return v.map((x) => x / l) as [number, number, number];
})();

const VS = `#version 300 es
const vec3 FRESH = vec3(${FRESH.map((c) => (c / 255).toFixed(4)).join(', ')});
const vec3 SAND = vec3(${SAND.map((c) => (c / 255).toFixed(4)).join(', ')});
const vec3 LOST = vec3(${LOST.map((c) => (c / 255).toFixed(4)).join(', ')});
const vec3 GAINED = vec3(${GAINED.map((c) => (c / 255).toFixed(4)).join(', ')});
in vec2 a_corner;   // unit hexagon, (0,0) at the centre of the top
in vec4 a_vert;     // wall (0 top, 1 wall), wall height fraction, face normal u, v
in float a_rim;     // 0 at the centre of the top face, 1 along its edge
in vec2 a_center;
in float a_elev;    // metres: land above 0, the sea floor below
in float a_low;     // the lowest neighbouring elevation: the wall need not reach further down
in float a_spill;   // the sea level at which the ocean first reaches this cell, over its neighbours
in vec4 a_color0;   // a colour from the tiles (land cover), or alpha 0 for the shader's own
in vec4 a_color1;
in vec4 a_info;     // distance from the centre (0..1), jitter, shade, kind (0 land, 1 sea, 2-3 fresh water)
uniform mat4 u_matrix;
uniform float u_radius;
uniform float u_base;
uniform float u_zscale;
uniform float u_far;    // clip-space w beyond which everything shares the farthest depth
uniform float u_focus;  // clip-space w of the map's centre: haze starts well beyond it
uniform float u_time;
uniform float u_intro;
uniform float u_colorStart;
uniform float u_exit;
uniform float u_swap;   // start of the change of level, < 0 when none
uniform float u_old;    // 1 for the outgoing scene of a change of level
uniform float u_sea;    // sea level, metres
uniform float u_landScale;
uniform float u_seaScale;
uniform float u_landStep;
uniform sampler2D u_ramp; // row 0: land 0..2,700 m; row 1: sea depth, sqrt(depth / 7,000)
out vec3 v_color;
out float v_alpha;
out float v_rim;
out float v_wall;
out float v_drop;
out vec2 v_normal;
out float v_shade;
flat out highp uint v_id;
out float v_haze;
// the sea floor steps down in terraces, fine near the shore and wider in the deep ocean
float seaTerrace(float depth) {
  float s = max(1.0, floor(sqrt(max(depth, 0.0)) / 3.5 + 0.5)) * 3.5;
  return s * s;
}
float landTerrace(float rel) { return max(1.0, floor(rel / u_landStep + 0.5)) * u_landStep; }
// the relief itself never moves with the sea level: only what is wet changes
float topOf(float e) { return e < 0.0 ? -seaTerrace(-e) * u_seaScale : landTerrace(e) * u_landScale; }
vec3 ramp(float row, float x) { return texture(u_ramp, vec2(clamp(x, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0, row)).rgb; }
void main() {
  float d = a_info.x;
  float j = a_info.y;
  float appear = 1.0;
  float eased = 1.0;
  if (u_intro >= 0.0) {
    appear = clamp((u_time - u_intro - d * 0.9 - j) / 0.35, 0.0, 1.0);
    float rise = clamp((u_time - u_intro - 0.9 - d * 1.3 - j * 2.0) / 1.25, 0.0, 1.0) - 1.0;
    eased = 1.0 + 2.2 * rise * rise * rise + 1.2 * rise * rise;
  }
  // the relief is fixed; the sea level decides what is wet and the colours. Only what the ocean
  // reaches floods: land behind a ridge stays dry, and a sea cut off by a sill stays as a lake.
  float kind = a_info.w;
  float g = a_info.y / 0.16;
  bool sea = abs(kind - 1.0) < 0.5;
  bool reached = u_sea > a_spill;
  bool wet = sea ? reached || a_elev < a_spill : u_sea > max(a_spill, 0.0);
  float waterline = sea && !reached ? min(a_spill, 0.0) : u_sea;
  float rel = a_elev - u_sea;
  float surface = topOf(a_elev);
  if (kind > 1.5 && a_elev >= 0.0) surface = max(u_landStep * 0.5, landTerrace(a_elev) - u_landStep) * u_landScale;
  else if (a_elev >= 0.0 && a_low < 0.0 && a_elev < 150.0) surface = u_landStep * 0.5 * u_landScale;
  vec3 natural;
  if (wet) {
    natural = ramp(0.75, sqrt(seaTerrace(max(waterline - a_elev, 1.0)) / 7000.0)) * (0.97 + g * 0.06);
    // land the sea has taken
    if (!sea && kind < 0.5) natural = mix(natural, LOST, 0.42);
  } else if (a_low < u_sea && rel < 150.0 && rel >= 0.0) {
    // a beach: the first ring of land along the water
    natural = SAND * (0.97 + g * 0.05);
  } else if (sea) {
    // sea floor laid bare by a lower sea: lowland colours, paler, so the old coast still shows
    float t = max(1.0, floor(max(rel, 0.0) / 120.0 + 0.5)) * 120.0;
    natural = mix(ramp(0.25, min(t, 1400.0) / 2700.0), GAINED, 0.45) * (0.95 + g * 0.08);
  } else if (kind > 1.5) {
    natural = FRESH * (0.96 + g * 0.08);
  } else {
    float t = landTerrace(max(a_elev, 0.0));
    natural = ramp(0.25, max(0.0, t + (g - 0.5) * u_landStep * 1.4) / 2700.0) * (0.94 + g * 0.1);
  }
  float top = surface * eased;
  float fade = 1.0;
  if (u_exit >= 0.0) {
    float w = (1.0 - min(d, 1.0)) * 0.6;
    float o = clamp((u_time - u_exit - w) / 0.6, 0.0, 1.0);
    top *= 1.0 - o * o * (3.0 - 2.0 * o);
    fade = 1.0 - clamp((u_time - u_exit - 0.5 - w) / 0.35, 0.0, 1.0);
  }
  // a change of level: the new grid is complete underneath and the old cells shrink away over it,
  // in random order, so the ground never opens
  float grow = 1.0;
  if (u_swap >= 0.0 && u_old > 0.5) {
    float p = clamp((u_time - u_swap) / 0.4, 0.0, 1.0);
    vec2 cell = floor(a_center / u_radius + 0.5);
    float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453) * 0.7;
    float g = clamp((p - h) / 0.3, 0.0, 1.0);
    grow = 1.0 - g * g * (3.0 - 2.0 * g);
  }
  float ct = u_colorStart < 0.0 ? 1.0 : clamp((u_time - u_colorStart - d * 0.45) / 0.45, 0.0, 1.0);
  bool own = wet || kind > 0.5;
  vec3 c0 = a_color0.a > 0.5 && !own ? a_color0.rgb : natural;
  vec3 c1 = a_color1.a > 0.5 && !own ? a_color1.rgb : natural;
  vec3 col = mix(c0, c1, ct * ct * (3.0 - 2.0 * ct));
  col = mix(vec3(0.93, 0.945, 0.955), col, smoothstep(0.0, 1.0, appear));
  // while blocks move their neighbours are not where the floor assumes: walls reach the base then
  bool settled = appear >= 1.0 && eased == 1.0 && u_exit < 0.0;
  // one terrace lower than the lowest neighbour's: covers beaches and lakes, which sit lower
  float floorZ = settled ? min(topOf(a_low) - u_landStep * u_landScale, top) : u_base;
  float z = a_vert.x > 0.5 ? mix(floorZ, top, a_vert.y) : top;
  gl_Position = u_matrix * vec4(a_center + a_corner * u_radius * grow, z * u_zscale, 1.0);
  // the layer clears and owns the depth buffer, so depth is its own: linear in distance and always
  // inside the clip volume. MapLibre's near and far planes, set for a surface map, clip nothing here:
  // not the deep sea floor far away, nor the peaks close to the camera.
  float w = gl_Position.w;
  gl_Position.z = (clamp(w / u_far, 0.0, 1.0) * 2.0 - 1.0) * w;
  // air between the camera and the far cells: depth, and no shimmer of tiny cells at the horizon
  v_haze = smoothstep(1.5, 4.0, w / u_focus) * 0.6;
  v_color = col;
  v_alpha = grow > 0.0 ? appear * fade : 0.0;
  v_rim = a_rim;
  v_wall = a_vert.x;
  // how far below its own top this point of the wall is, in cell radii
  v_drop = (top - z) * u_zscale / u_radius;
  v_normal = a_vert.zw;
  v_shade = a_vert.x > 0.5 ? 1.0 : a_info.z;
  v_id = uint(gl_InstanceID) + 1u;
}`;

const FS = `#version 300 es
precision highp float;
uniform vec3 u_light;
in vec3 v_color;
in float v_alpha;
in float v_rim;
in float v_wall;
in float v_drop;
in vec2 v_normal;
in float v_shade;
in float v_haze;
out vec4 color;
const vec3 HAZE = vec3(0.88, 0.92, 0.955);
void main() {
  if (v_alpha <= 0.0) discard;
  float lit;
  if (v_wall > 0.5) {
    float diffuse = max(dot(vec3(v_normal, 0.0), u_light), 0.0);
    lit = (0.66 + 0.5 * diffuse) * v_shade;
    // walls darken towards their foot, where the neighbouring blocks keep the light out
    lit *= mix(0.68, 1.0, exp(-v_drop * 0.5));
    // a thin bright lip just under the top edge
    lit *= 1.0 + 0.12 * (1.0 - smoothstep(0.0, 0.08, v_drop));
  } else {
    lit = v_shade * 1.1;
    // bevel: the rim facing the sun catches light, the far rim falls into shade
    float rim = smoothstep(0.72, 1.0, v_rim);
    lit *= 1.0 + rim * 0.26 * dot(v_normal, normalize(u_light.xy));
    // the seam between neighbouring blocks
    lit *= 1.0 - smoothstep(0.9, 1.0, v_rim) * 0.2;
  }
  color = vec4(mix(v_color * lit, HAZE, v_haze) * v_alpha, v_alpha);
}`;

/** The cell under one pixel: its instance number (plus one) as a colour. */
const PICK_FS = `#version 300 es
precision highp float;
in float v_alpha;
flat in highp uint v_id;
out vec4 color;
void main() {
  if (v_alpha <= 0.0) discard;
  color = vec4(float(v_id & 255u), float((v_id >> 8) & 255u), float((v_id >> 16) & 255u), 255.0) / 255.0;
}`;

/** Fixed attribute slots, so the drawing and picking programs share one vertex array per scene. */
const ATTRIBUTES = ['a_corner', 'a_vert', 'a_rim', 'a_center', 'a_elev', 'a_low', 'a_spill', 'a_color0', 'a_color1', 'a_info'];

const VEIL_VS = `#version 300 es
const vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(corners[gl_VertexID], 0.0, 1.0); }`;
const VEIL_FS = `#version 300 es
precision mediump float;
uniform vec4 u_veil;
out vec4 color;
void main() { color = vec4(u_veil.rgb * u_veil.a, u_veil.a); }`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const program = gl.createProgram()!;
  for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
    gl.attachShader(program, shader);
  }
  if (vs !== VEIL_VS) ATTRIBUTES.forEach((name, i) => gl.bindAttribLocation(program, i, name));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link');
  return program;
}

/** 18 top vertices (a fan of six triangles) and 36 wall vertices: corner, wall info, rim. */
function prism(): Float32Array {
  const corner = (i: number) => {
    const a = ((30 + 60 * i) * Math.PI) / 180;
    return [Math.cos(a), Math.sin(a)];
  };
  const out: number[] = [];
  const push = (c: number[], wall: number, h: number, n: number[], rim: number) => out.push(c[0], c[1], wall, h, n[0], n[1], rim);
  for (let i = 0; i < 6; i++) {
    const a = corner(i);
    const b = corner(i + 1);
    const m = ((60 + 60 * i) * Math.PI) / 180;
    const n = [Math.cos(m), Math.sin(m)];
    push([0, 0], 0, 1, n, 0);
    push(a, 0, 1, n, 1);
    push(b, 0, 1, n, 1);
    push(a, 1, 0, n, 0);
    push(b, 1, 0, n, 0);
    push(b, 1, 1, n, 0);
    push(a, 1, 0, n, 0);
    push(b, 1, 1, n, 0);
    push(a, 1, 1, n, 0);
  }
  return new Float32Array(out);
}

export type HexScene = {
  count: number;
  /** Mercator (0..1) the positions are measured from. */
  origin: [number, number];
  /** Mercator metres per real metre at the scene's latitude. */
  zscale: number;
  /** Cell radius (centre to corner), Mercator metres. */
  radius: number;
  /** Displayed metres the walls start from. */
  base: number;
  /** Map zoom the heights were exaggerated for; they are rescaled to the zoom of each frame. */
  reliefZoom: number;
  landScale: number;
  seaScale: number;
  landStep: number;
  centers: Float32Array;
  elev: Float32Array;
  low: Float32Array;
  spill: Float32Array;
  colors: Uint8Array;
  info: Float32Array;
  /** Identifies the scene to whoever built it (the scene worker's reply id). */
  key: number;
  /** Highest land in the scene, metres (set by the layer). */
  peak?: number;
};

/** The relief exaggeration for a map zoom (kept in step with scene-worker.ts). */
const relief = (zoom: number, cosLat: number) => Math.max(1.3, 0.88 * Math.sqrt((EARTH * cosLat) / (512 * 2 ** zoom)));

/** Land (row 0, 0..2,700 m) and sea depth (row 1, by the square root of depth / 7,000 m) colours. */
function rampPixels() {
  const px = new Uint8Array(256 * 2 * 4);
  for (let x = 0; x < 256; x++) {
    const land = landColor((x / 255) * 2700);
    const sea = seaColor((x / 255) ** 2 * 7000);
    px.set([...land.map(Math.round), 255], x * 4);
    px.set([...sea.map(Math.round), 255], (256 + x) * 4);
  }
  return px;
}

const UNIFORMS = ['u_focus', 'u_matrix', 'u_radius', 'u_base', 'u_zscale', 'u_time', 'u_intro', 'u_colorStart', 'u_exit', 'u_light', 'u_swap', 'u_old', 'u_far', 'u_sea', 'u_landScale', 'u_seaScale', 'u_landStep', 'u_ramp'];
type Locations = Record<string, WebGLUniformLocation | null>;

type Slot = {vao: WebGLVertexArrayObject; buffers: Record<string, WebGLBuffer>; scene?: HexScene; uploaded: boolean};

export class HexLayer implements CustomLayerInterface {
  readonly id = 'hexagons';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;
  /** Paper drawn over the map underneath (0 shows the map, 1 hides it). */
  veil = 0;
  veilColor: [number, number, number] = [0.93, 0.95, 0.965];
  /** Which winding faces the camera; `false` draws both sides. */
  cull: 'cw' | 'ccw' | false = 'cw';
  private map?: MapLibreMap;
  private gl?: WebGL2RenderingContext;
  private program?: WebGLProgram;
  private veilProgram?: WebGLProgram;
  /** The scene shown, and the one leaving during a change of level. */
  private slots: Slot[] = [];
  private current = 0;
  private outgoing = false;
  private swap = -1;
  private intro = -1;
  private colorStart = -1;
  private exit = -1;
  private veilFrom = 0;
  private veilTo = 0;
  private veilStart = 0;
  private veilDur = 1;
  private loc: Locations = {};
  private pickProgram?: WebGLProgram;
  private pickLoc: Locations = {};
  private pickTarget?: {fb: WebGLFramebuffer; color: WebGLRenderbuffer; depth: WebGLRenderbuffer; w: number; h: number};
  private picks: Array<{x: number; y: number; done: (cell: {scene: number; index: number} | null) => void}> = [];
  private ramp?: WebGLTexture;
  private sea = {from: 0, to: 0, start: 0, dur: 1};

  onAdd(map: MapLibreMap, glIn: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    const gl = (this.gl = glIn as WebGL2RenderingContext);
    this.program = compile(gl, VS, FS);
    this.pickProgram = compile(gl, VS, PICK_FS);
    this.veilProgram = compile(gl, VEIL_VS, VEIL_FS);
    for (const u of UNIFORMS) {
      this.loc[u] = gl.getUniformLocation(this.program, u);
      this.pickLoc[u] = gl.getUniformLocation(this.pickProgram, u);
    }
    this.loc.u_veil = gl.getUniformLocation(this.veilProgram, 'u_veil');
    const p = this.program;
    this.ramp = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.ramp);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, rampPixels());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const geometry = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, geometry);
    gl.bufferData(gl.ARRAY_BUFFER, prism(), gl.STATIC_DRAW);
    const previous = this.slots;
    this.slots = [0, 1].map((i) => {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const attrib = (name: string, buffer: WebGLBuffer, size: number, type: number, normalized: boolean, stride: number, offset: number, divisor: number) => {
        const at = gl.getAttribLocation(p, name);
        if (at < 0) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(at);
        gl.vertexAttribPointer(at, size, type, normalized, stride, offset);
        gl.vertexAttribDivisor(at, divisor);
      };
      attrib('a_corner', geometry, 2, gl.FLOAT, false, 28, 0, 0);
      attrib('a_vert', geometry, 4, gl.FLOAT, false, 28, 8, 0);
      attrib('a_rim', geometry, 1, gl.FLOAT, false, 28, 24, 0);
      const buffers: Record<string, WebGLBuffer> = {};
      for (const name of ['centers', 'elev', 'low', 'spill', 'color0', 'color1', 'info']) buffers[name] = gl.createBuffer()!;
      attrib('a_center', buffers.centers, 2, gl.FLOAT, false, 0, 0, 1);
      attrib('a_elev', buffers.elev, 1, gl.FLOAT, false, 0, 0, 1);
      attrib('a_low', buffers.low, 1, gl.FLOAT, false, 0, 0, 1);
      attrib('a_spill', buffers.spill, 1, gl.FLOAT, false, 0, 0, 1);
      attrib('a_color0', buffers.color0, 4, gl.UNSIGNED_BYTE, true, 0, 0, 1);
      attrib('a_color1', buffers.color1, 4, gl.UNSIGNED_BYTE, true, 0, 0, 1);
      attrib('a_info', buffers.info, 4, gl.FLOAT, false, 0, 0, 1);
      return {vao, buffers, scene: previous[i]?.scene, uploaded: false};
    });
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  onRemove() {
    this.gl = undefined;
  }

  private clock = () => performance.now() / 1000;

  private slot(i: number): Slot {
    // before onAdd the scene waits in a placeholder slot
    return (this.slots[i] ??= {vao: null!, buffers: {}, uploaded: false});
  }

  /**
   * Shows a scene. `intro` sweeps the cells in surface from the centre and raises them; `swap` (a new
   * level) grows the new cells in while the old ones shrink away; `replace` (more of the same level)
   * swaps the arrays at once, since the cells it shares with the old scene are identical.
   */
  setScene(scene: HexScene, how: 'intro' | 'swap' | 'replace' = 'replace') {
    const t = this.clock();
    const opening = this.intro >= 0 && t < this.intro + 4.2;
    if (how === 'swap' && this.slot(this.current).scene && !opening) {
      this.current = 1 - this.current;
      this.outgoing = true;
      this.swap = t;
    }
    if (how === 'intro') {
      this.outgoing = false;
      this.swap = -1;
      this.intro = t;
    }
    const s = this.slot(this.current);
    let peak = 0;
    for (let i = 0; i < scene.elev.length; i++) if (scene.elev[i] > peak) peak = scene.elev[i];
    scene.peak = peak;
    s.scene = scene;
    s.uploaded = false;
    this.colorStart = -1;
    this.exit = -1;
    this.map?.triggerRepaint();
  }

  /** The colours of a new mode, blended in as a wave from the centre. */
  setColors(colors: Uint8Array) {
    const gl = this.gl;
    const s = this.slot(this.current);
    if (!gl || !s.scene || !s.uploaded) return;
    // the colours shown now become the starting point
    gl.bindBuffer(gl.ARRAY_BUFFER, s.buffers.color0);
    gl.bufferData(gl.ARRAY_BUFFER, s.scene.colors, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, s.buffers.color1);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    s.scene.colors = colors;
    this.colorStart = this.clock();
    this.map?.triggerRepaint();
  }

  /** Moves the sea to `level` metres; cells flood or emerge as it passes them. */
  setSeaLevel(level: number, dur = 1.6) {
    this.sea = {from: this.seaLevel(), to: level, start: this.clock(), dur};
    this.map?.triggerRepaint();
  }

  /** The sea level shown now, metres. */
  seaLevel() {
    const {from, to, start, dur} = this.sea;
    const t = Math.min(1, Math.max(0, (this.clock() - start) / dur));
    return from + (to - from) * t * t * (3 - 2 * t);
  }

  /** Sinks every cell back into the map. */
  leave() {
    this.exit = this.clock();
    this.outgoing = false;
    this.fadeVeil(0, 0.5, 0.9);
  }

  fadeVeil(to: number, delay: number, dur: number) {
    this.veilFrom = this.currentVeil();
    this.veilTo = to;
    this.veilStart = this.clock() + delay;
    this.veilDur = dur;
    this.map?.triggerRepaint();
  }

  private currentVeil() {
    const t = Math.min(1, Math.max(0, (this.clock() - this.veilStart) / this.veilDur));
    return this.veilFrom + (this.veilTo - this.veilFrom) * t * t * (3 - 2 * t);
  }

  /** Seconds until everything has stopped moving. */
  private busyFor(t: number) {
    let until = this.veilStart + this.veilDur;
    if (this.intro >= 0) until = Math.max(until, this.intro + 0.9 + 1.56 + 0.32 + 1.25);
    if (this.colorStart >= 0) until = Math.max(until, this.colorStart + 1.1);
    if (this.exit >= 0) until = Math.max(until, this.exit + 1.5);
    if (this.swap >= 0) until = Math.max(until, this.swap + 0.4);
    until = Math.max(until, this.sea.start + this.sea.dur);
    return until - t;
  }

  private upload(gl: WebGL2RenderingContext, slot: Slot, s: HexScene) {
    const put = (name: string, data: ArrayBufferView) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, slot.buffers[name]);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    };
    put('centers', s.centers);
    put('elev', s.elev);
    put('low', s.low);
    put('spill', s.spill);
    put('color0', s.colors);
    put('color1', s.colors);
    put('info', s.info);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    slot.uploaded = true;
  }

  private matrix(args: CustomRenderMethodInput, origin: [number, number]): Float32Array {
    const main = args.defaultProjectionData.mainMatrix as unknown as ArrayLike<number>;
    const [ox, oy] = origin;
    const s = 1 / EARTH;
    const out = new Float32Array(16);
    // main · translate(origin) · scale(1 / EARTH), in float64 before handing it to the GPU
    for (let r = 0; r < 4; r++) {
      out[0 + r] = main[0 + r] * s;
      out[4 + r] = main[4 + r] * s;
      out[8 + r] = main[8 + r] * s;
      out[12 + r] = main[0 + r] * ox + main[4 + r] * oy + main[12 + r];
    }
    return out;
  }

  /**
   * Close to the ground the exaggerated relief would reach the camera: the highest land may stand
   * at most 30 % of the camera's height. Eased, so a new scene or a zoom never makes it jump.
   */
  private tame = 1;
  private tameAt = 0;
  private updateTame(t: number) {
    const m = this.map;
    const s = this.slots[this.current]?.scene;
    if (!m || !s) return;
    const zoom = m.getZoom();
    const cosLat = 1 / s.zscale;
    const metresPerPx = (EARTH * cosLat) / (512 * 2 ** zoom);
    const distance = (0.5 * m.getContainer().clientHeight) / Math.tan((36.87 * Math.PI) / 360);
    const altitude = distance * metresPerPx * Math.cos((m.getPitch() * Math.PI) / 180);
    const tallest = (s.peak ?? 0) * s.landScale * (relief(zoom, cosLat) / relief(s.reliefZoom, cosLat));
    const target = tallest > 0 ? Math.min(1, (0.3 * altitude) / tallest) : 1;
    const dt = Math.min(0.1, Math.max(0, t - this.tameAt));
    this.tameAt = t;
    this.tame += (target - this.tame) * (1 - Math.exp(-dt * 6));
    if (Math.abs(target - this.tame) > 0.002) m.triggerRepaint();
  }

  private drawScenes(gl: WebGL2RenderingContext, args: CustomRenderMethodInput, program: WebGLProgram, loc: Locations, slots: number[], t: number) {
    gl.useProgram(program);
    gl.uniform1f(loc.u_time, t);
    gl.uniform1f(loc.u_intro, this.intro);
    gl.uniform1f(loc.u_colorStart, this.colorStart);
    gl.uniform1f(loc.u_exit, this.exit);
    gl.uniform1f(loc.u_swap, this.swap);
    gl.uniform1f(loc.u_sea, this.seaLevel());
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.ramp ?? null);
    gl.uniform1i(loc.u_ramp, 0);
    gl.uniform3f(loc.u_light, ...LIGHT);
    // only faces turned towards the camera: half the walls never reach the rasteriser
    if (this.cull) {
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.frontFace(this.cull === 'cw' ? gl.CW : gl.CCW);
    }
    const zoom = this.map?.getZoom() ?? 0;
    const tame = this.tame;
    const scale = (s: HexScene) => s.zscale * (relief(zoom, 1 / s.zscale) / relief(s.reliefZoom, 1 / s.zscale)) * tame;
    for (const i of slots) {
      const slot = this.slots[i];
      const s = slot.scene;
      if (!s || !s.count) continue;
      if (!slot.uploaded) this.upload(gl, slot, s);
      // heights follow the zoom continuously, whatever zoom the scene was built for
      const matrix = this.matrix(args, s.origin);
      gl.uniformMatrix4fv(loc.u_matrix, false, matrix);
      // w of the scene's origin is the camera's distance to it; the horizon is far beyond
      gl.uniform1f(loc.u_far, Math.abs(matrix[15]) * 60);
      gl.uniform1f(loc.u_focus, Math.abs(matrix[15]));
      gl.uniform1f(loc.u_radius, s.radius);
      gl.uniform1f(loc.u_base, s.base);
      gl.uniform1f(loc.u_landScale, s.landScale);
      gl.uniform1f(loc.u_seaScale, s.seaScale);
      gl.uniform1f(loc.u_landStep, s.landStep);
      gl.uniform1f(loc.u_zscale, scale(s));
      gl.uniform1f(loc.u_old, i === this.current ? 0 : 1);
      gl.bindVertexArray(slot.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 54, s.count);
    }
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.disable(gl.CULL_FACE);
    gl.frontFace(gl.CCW);
  }

  /** The cell under a point of the map (CSS pixels), found by drawing cell numbers under that pixel. */
  pickAt(x: number, y: number): Promise<{scene: number; index: number} | null> {
    return new Promise((done) => {
      this.picks.push({x, y, done});
      this.map?.triggerRepaint();
    });
  }

  private pick(gl: WebGL2RenderingContext, args: CustomRenderMethodInput, t: number) {
    const picks = this.picks.splice(0);
    const scene = this.slots[this.current]?.scene;
    const canvas = gl.canvas as HTMLCanvasElement;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    if (!scene || !this.pickProgram) return picks.forEach((p) => p.done(null));
    let target = this.pickTarget;
    if (!target || target.w !== w || target.h !== h) {
      if (target) {
        gl.deleteFramebuffer(target.fb);
        gl.deleteRenderbuffer(target.color);
        gl.deleteRenderbuffer(target.depth);
      }
      const fb = gl.createFramebuffer()!;
      const color = gl.createRenderbuffer()!;
      const depth = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, color);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, w, h);
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      target = this.pickTarget = {fb, color, depth, w, h};
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    }
    const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.enable(gl.SCISSOR_TEST);
    const ratio = w / (canvas.clientWidth || w);
    const px = new Uint8Array(4);
    for (const p of picks) {
      const x = Math.min(w - 1, Math.max(0, Math.floor(p.x * ratio)));
      const y = Math.min(h - 1, Math.max(0, h - 1 - Math.floor(p.y * ratio)));
      // only that pixel is coloured: the vertices run as in a frame, the fragments hardly at all
      gl.scissor(x, y, 1, 1);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this.drawScenes(gl, args, this.pickProgram, this.pickLoc, [this.current], t);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const id = px[0] + px[1] * 256 + px[2] * 65536;
      p.done(id ? {scene: scene.key, index: id - 1} : null);
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.enable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
    gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
  }

  render(glIn: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    const gl = glIn as WebGL2RenderingContext;
    const t = this.clock();
    const veil = this.currentVeil();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    if (veil > 0 && this.veilProgram) {
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(this.veilProgram);
      gl.uniform4f(this.loc.u_veil, ...this.veilColor, veil);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (this.swap >= 0 && t > this.swap + 0.4) {
      this.swap = -1;
      this.outgoing = false;
    }
    this.updateTame(t);
    if (this.program && this.slots[0]?.vao) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      this.drawScenes(gl, args, this.program, this.loc, [this.current, ...(this.outgoing ? [1 - this.current] : [])], t);
      if (this.picks.length) this.pick(gl, args, t);
    }
    if (this.busyFor(t) > 0) this.map?.triggerRepaint();
  }
}
