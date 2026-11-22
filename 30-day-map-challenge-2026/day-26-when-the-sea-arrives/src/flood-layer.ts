// A MapLibre custom layer that floods the map. The worker's raster carries, for every pixel, its
// elevation and the sea level at which the ocean reaches it; the IPCC field gives the sea level of
// each place and decade. The fragment shader compares the two at every screen pixel, so the year
// can move continuously and the CPU does nothing per frame. The shoreline is where the difference
// crosses zero: interpolated between samples, it stays smooth at any zoom.
import type {CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap} from 'maplibre-gl';
import type {Raster} from './flood-worker';
import {CELLS, LINE_COLS, LINE_ROWS, YEARS} from './sea-level';

const VS = `#version 300 es
in vec2 a_pos;
uniform mat4 u_matrix;
uniform vec2 u_size;     // raster size in metres, for the ripples
out vec2 v_uv;
out vec2 v_m;
void main() {
  v_uv = a_pos;
  v_m = a_pos * u_size;
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D u_field;   // r: elevation, g: spill height, metres
uniform sampler2D u_rise;    // centimetres, 360 x (181 x decades)
uniform vec4 u_box;          // Mercator origin and size of the raster
uniform float u_year;        // fractional index into the decades
uniform sampler2D u_line;    // centimetres above mean sea level, 0.25 degree
uniform float u_lineOn;      // 0..1: how much of the water line is added
uniform float u_time;
uniform float u_alpha;
uniform float u_pulse;       // 0..1: the water front glows while the year moves
in vec2 v_uv;
in vec2 v_m;
out vec4 color;
const float PI = 3.141592653589793;
float rise(vec2 ll, float yi) {
  float x = mod(ll.x + 180.0, 360.0);
  float y = clamp(90.0 - ll.y, 0.0, 179.999);
  vec2 i0 = floor(vec2(x, y));
  vec2 f = vec2(x, y) - i0;
  int x0 = int(i0.x);
  int x1 = (x0 + 1) % 360;
  int y0 = int(i0.y) + int(yi) * 181;
  float a = texelFetch(u_rise, ivec2(x0, y0), 0).r;
  float b = texelFetch(u_rise, ivec2(x1, y0), 0).r;
  float c = texelFetch(u_rise, ivec2(x0, y0 + 1), 0).r;
  float d = texelFetch(u_rise, ivec2(x1, y0 + 1), 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y) / 100.0;
}
float riseAt(vec2 ll, float year) {
  float i0 = floor(year);
  float i1 = min(i0 + 1.0, ${YEARS.length - 1}.0);
  return mix(rise(ll, i0), rise(ll, i1), year - i0);
}
float lineAt(vec2 ll) {
  vec2 p = vec2(mod(ll.x + 180.0, 360.0) * 4.0, clamp((90.0 - ll.y) * 4.0, 0.0, ${LINE_ROWS - 1}.999));
  vec2 i0 = floor(p);
  vec2 f = p - i0;
  int x0 = int(i0.x);
  int x1 = (x0 + 1) % ${LINE_COLS};
  int y0 = int(i0.y);
  float a = texelFetch(u_line, ivec2(x0, y0), 0).r;
  float b = texelFetch(u_line, ivec2(x1, y0), 0).r;
  float c = texelFetch(u_line, ivec2(x0, y0 + 1), 0).r;
  float d = texelFetch(u_line, ivec2(x1, y0 + 1), 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y) / 100.0;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 f = texture(u_field, v_uv).rg;
  float elev = f.r;
  float spill = f.g;
  if (spill < -900.0 || elev < -5000.0) discard; // today's ocean and other water: the map draws them
  vec2 merc = u_box.xy + v_uv * u_box.zw;
  vec2 ll = vec2(merc.x * 360.0 - 180.0, degrees(atan(sinh(PI * (1.0 - 2.0 * merc.y)))));
  float line = u_lineOn > 0.0 ? lineAt(ll) * u_lineOn : 0.0;
  float sea = riseAt(ll, u_year) + line;
  float today = riseAt(ll, 0.0) + line;
  float a = sea - spill;
  float aa = max(fwidth(a), 1e-4);
  float wet = smoothstep(-aa, aa, a);
  if (wet <= 0.002) discard;
  float depth = max(sea - elev, 0.0);
  // land below the sea already today: dikes and pumps keep it dry
  float defended = smoothstep(-aa, aa, today - spill);
  vec3 shallow = vec3(0.30, 0.78, 0.86);
  vec3 deep = vec3(0.04, 0.30, 0.60);
  vec3 c = mix(shallow, deep, smoothstep(0.0, 2.5, sqrt(depth) * 1.2));
  // light on small waves: two layers of noise drifting apart, in metres, scaled to the view
  float scale = 1.0 / max(fwidth(v_m.x) * 6.0, 0.5);
  vec2 p = v_m * scale;
  float n = noise(p + vec2(u_time * 0.35, u_time * 0.2)) * 0.6 + noise(p * 2.3 - vec2(u_time * 0.25, -u_time * 0.4)) * 0.4;
  c *= 0.93 + 0.14 * n;
  c += vec3(0.9, 0.97, 1.0) * pow(n, 8.0) * 0.5;
  // the edge of the water: a pale line, brighter while the year moves
  float edge = 1.0 - smoothstep(0.0, aa * 3.0 + 0.02, a);
  c = mix(c, vec3(0.88, 0.98, 1.0), edge * (0.55 + 0.4 * u_pulse));
  float alpha = 0.82;
  if (defended > 0.5) {
    // thin hatching over the map: under the projected sea already, behind defences
    float f = fract((gl_FragCoord.x + gl_FragCoord.y) / 10.0);
    float line = 1.0 - smoothstep(0.12, 0.24, abs(f - 0.5) * 2.0 - 0.62);
    c = vec3(0.40, 0.33, 0.68);
    alpha = mix(0.07, 0.5, line);
  }
  alpha *= wet * u_alpha;
  color = vec4(c * alpha, alpha);
}`;

type Slot = {raster: Raster; texture: WebGLTexture; alpha: number; target: number};

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const program = gl.createProgram()!;
  for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
    gl.attachShader(program, shader);
  }
  gl.bindAttribLocation(program, 0, 'a_pos');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link');
  return program;
}

export class FloodLayer implements CustomLayerInterface {
  readonly id = 'flood';
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;
  private map?: MapLibreMap;
  private gl?: WebGL2RenderingContext;
  private program?: WebGLProgram;
  private vao?: WebGLVertexArrayObject;
  private rise?: WebGLTexture;
  private pendingRise?: Int16Array;
  private line?: WebGLTexture;
  private pendingLine?: Int16Array | null;
  private lineOn = 0;
  private lineTarget = 0;
  private slots: Slot[] = [];
  private pending?: Raster;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private year = 0;
  private yearFrom = 0;
  private yearTo = 0;
  private yearStart = 0;
  private yearDur = 0;
  private pulse = 0;
  private last = performance.now();
  private start = performance.now();

  onAdd(map: MapLibreMap, glIn: WebGLRenderingContext | WebGL2RenderingContext) {
    const gl = glIn as WebGL2RenderingContext;
    this.map = map;
    this.gl = gl;
    this.program = compile(gl, VS, FS);
    for (const n of ['u_matrix', 'u_size', 'u_field', 'u_rise', 'u_box', 'u_year', 'u_time', 'u_alpha', 'u_pulse', 'u_line', 'u_lineOn'])
      this.loc[n] = gl.getUniformLocation(this.program, n);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    if (this.pendingRise) this.setRise(this.pendingRise);
    if (this.pendingLine !== undefined) this.setLine(this.pendingLine);
    if (this.pending) this.setRaster(this.pending);
  }

  onRemove() {
    const gl = this.gl;
    if (!gl) return;
    for (const s of this.slots) gl.deleteTexture(s.texture);
    this.slots = [];
    if (this.rise) gl.deleteTexture(this.rise);
    this.rise = undefined;
    this.gl = undefined;
  }

  /** The decades of one scenario and percentile, centimetres. */
  setRise(field: Int16Array) {
    const gl = this.gl;
    if (!gl) return void (this.pendingRise = field);
    this.pendingRise = undefined;
    if (!this.rise) this.rise = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.rise);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 360, (CELLS / 360) * YEARS.length, 0, gl.RED, gl.FLOAT, Float32Array.from(field));
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    this.map?.triggerRepaint();
  }

  /** A water line above mean sea level (centimetres, 0.25 degree), or null for mean sea level. */
  setLine(field: Int16Array | null) {
    const gl = this.gl;
    if (!gl) return void (this.pendingLine = field);
    this.pendingLine = undefined;
    if (field) {
      if (!this.line) this.line = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, this.line);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, LINE_COLS, LINE_ROWS, 0, gl.RED, gl.FLOAT, Float32Array.from(field));
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    }
    // from mean sea level the water rises to the line, and sinks back when it is turned off
    this.lineTarget = field ? 1 : 0;
    this.map?.triggerRepaint();
  }

  /** A new raster fades in over the one shown, which then leaves. */
  setRaster(raster: Raster) {
    const gl = this.gl;
    if (!gl) return void (this.pending = raster);
    this.pending = undefined;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const data = new Float32Array(raster.w * raster.h * 2);
    for (let i = 0; i < raster.w * raster.h; i++) {
      // lakes, lagoons and rivers are already water: the map draws them
      data[i * 2] = raster.water[i] === 2 ? -9999 : Math.max(-1000, Math.min(60000, raster.elev[i]));
      data[i * 2 + 1] = raster.spill[i];
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    // half floats filter in every WebGL2; the heights that matter are a few metres, well within range
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, raster.w, raster.h, 0, gl.RG, gl.FLOAT, data);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    for (const s of this.slots) s.target = 0;
    this.slots.push({raster, texture, alpha: this.slots.length ? 0 : 0, target: 1});
    this.map?.triggerRepaint();
  }

  /** Moves the year (a fractional index into the decades) over `dur` seconds. */
  setYear(index: number, dur = 0) {
    this.yearFrom = this.year;
    this.yearTo = index;
    this.yearStart = performance.now();
    this.yearDur = dur * 1000;
    if (!dur) this.year = index;
    this.map?.triggerRepaint();
  }

  private matrix(args: CustomRenderMethodInput, r: Raster): Float32Array {
    const main = args.defaultProjectionData.mainMatrix as unknown as ArrayLike<number>;
    const [ox, oy] = r.origin;
    const sx = r.w * r.step;
    const sy = r.h * r.step;
    const out = new Float32Array(16);
    // main · translate(origin) · scale(size), in float64 before handing it to the GPU
    for (let k = 0; k < 4; k++) {
      out[0 + k] = main[0 + k] * sx;
      out[4 + k] = main[4 + k] * sy;
      out[8 + k] = main[8 + k];
      out[12 + k] = main[0 + k] * ox + main[4 + k] * oy + main[12 + k];
    }
    return out;
  }

  render(glIn: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    const gl = glIn as WebGL2RenderingContext;
    if (!this.program || !this.rise || !this.slots.length) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    let moving = false;
    if (this.year !== this.yearTo) {
      const t = this.yearDur ? Math.min(1, (now - this.yearStart) / this.yearDur) : 1;
      const e = t < 1 ? t * t * (3 - 2 * t) : 1;
      this.year = this.yearFrom + (this.yearTo - this.yearFrom) * e;
      moving = true;
    }
    this.pulse += ((moving ? 1 : 0) - this.pulse) * Math.min(1, dt * 4);
    this.lineOn += Math.sign(this.lineTarget - this.lineOn) * Math.min(Math.abs(this.lineTarget - this.lineOn), dt / 1.2);
    for (const s of this.slots) s.alpha += Math.sign(s.target - s.alpha) * Math.min(Math.abs(s.target - s.alpha), dt / 0.35);
    // the newest raster is complete once it has faded in; the older ones go
    const top = this.slots[this.slots.length - 1];
    if (top.alpha >= 1) for (const s of this.slots.splice(0, this.slots.length - 1)) gl.deleteTexture(s.texture);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao!);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.rise);
    gl.uniform1i(this.loc.u_rise, 1);
    gl.uniform1i(this.loc.u_field, 0);
    if (this.line) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.line);
    }
    gl.uniform1i(this.loc.u_line, 2);
    gl.uniform1f(this.loc.u_lineOn, this.line ? this.lineOn : 0);
    gl.uniform1f(this.loc.u_year, this.year);
    gl.uniform1f(this.loc.u_time, (now - this.start) / 1000);
    gl.uniform1f(this.loc.u_pulse, this.pulse);
    for (const s of this.slots) {
      if (s.alpha <= 0) continue;
      const r = s.raster;
      // the older raster underneath stays opaque until the new one covers it
      const alpha = s === top ? s.alpha : 1;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, s.texture);
      gl.uniformMatrix4fv(this.loc.u_matrix, false, this.matrix(args, r));
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (r.origin[1] + (r.h * r.step) / 2))));
      const m = 40075016.686 * Math.cos(lat);
      gl.uniform2f(this.loc.u_size, r.w * r.step * m, r.h * r.step * m);
      gl.uniform4f(this.loc.u_box, r.origin[0], r.origin[1], r.w * r.step, r.h * r.step);
      gl.uniform1f(this.loc.u_alpha, alpha);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.bindVertexArray(null);
    // the water moves all the time; the map redraws only while it is on screen
    this.map?.triggerRepaint();
  }
}
