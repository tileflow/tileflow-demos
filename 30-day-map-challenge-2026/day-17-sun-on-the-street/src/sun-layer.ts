// A MapLibre custom layer that draws, for any sun position, without CPU work per frame:
//   1. the ground shadow of every loaded building: each wall is a quad whose top the vertex shader
//      slides along the shadow, drawn into an offscreen mask;
//   2. that mask over the ground, as the shadow, and a faint warm light where the sun reaches;
//   3. the sidewalks, sunlit where the mask is clear (or coloured by their minutes of sun).
// Positions are Web Mercator metres from `origin` (u east, v south).

import type {CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap} from 'maplibre-gl';

const EARTH = 40075016.68557849;

export type SunLayerColors = {
  sun: [number, number, number];
  shade: [number, number, number];
  shadow: [number, number, number, number];
  /** A faint warm wash on the ground the sun reaches, so the light reads on the street itself. */
  light?: [number, number, number, number];
};

type TileBuffers = {walls?: {buffer: WebGLBuffer; count: number}; sidewalks?: {buffer: WebGLBuffer; count: number}};

const WALL_VS = `#version 300 es
in vec4 a_wall; // u, v, height, top
uniform mat4 u_matrix;
uniform vec2 u_shadow; // Mercator metres of shadow per metre of height
void main() {
  vec2 p = a_wall.xy + a_wall.w * a_wall.z * u_shadow;
  gl_Position = u_matrix * vec4(p, 0.0, 1.0);
}`;
const WALL_FS = `#version 300 es
precision mediump float;
out vec4 color;
void main() { color = vec4(1.0); }`;

const COMPOSITE_VS = `#version 300 es
const vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(corners[gl_VertexID], 0.0, 1.0); }`;
const COMPOSITE_FS = `#version 300 es
precision mediump float;
uniform sampler2D u_mask;
uniform vec2 u_size;
uniform vec4 u_shadow; // rgb, alpha
uniform vec4 u_light;  // rgb, alpha
out vec4 color;
void main() {
  float m = texture(u_mask, gl_FragCoord.xy / u_size).r;
  color = mix(vec4(u_light.rgb * u_light.a, u_light.a), vec4(u_shadow.rgb * u_shadow.a, u_shadow.a), m);
}`;

const SIDEWALK_VS = `#version 300 es
in vec4 a_ab;     // a.u a.v b.u b.v
in vec3 a_extra;  // side, end, minutes
uniform mat4 u_matrix;
uniform vec2 u_viewport;
uniform float u_width; // pixels
out float v_side;
out float v_minutes;
void main() {
  vec4 pa = u_matrix * vec4(a_ab.xy, 0.0, 1.0);
  vec4 pb = u_matrix * vec4(a_ab.zw, 0.0, 1.0);
  vec2 sa = pa.xy / pa.w * u_viewport;
  vec2 sb = pb.xy / pb.w * u_viewport;
  vec2 dir = normalize(sb - sa + vec2(1e-6));
  vec2 normal = vec2(-dir.y, dir.x);
  vec4 p = mix(pa, pb, a_extra.y);
  // extend each segment a little so neighbours join without gaps
  vec2 along = dir * (a_extra.y * 2.0 - 1.0) * u_width * 0.5;
  p.xy += (normal * a_extra.x * u_width * 0.5 + along) / u_viewport * p.w;
  gl_Position = p;
  v_side = a_extra.x;
  v_minutes = a_extra.z;
}`;
const SIDEWALK_FS = `#version 300 es
precision mediump float;
uniform sampler2D u_mask;
uniform vec2 u_size;
uniform int u_mode;   // 0 at this time, 1 whole day
uniform int u_glow;   // 1 draws the soft halo of sunlit sidewalks
uniform float u_day;  // 1 while the sun is up
uniform vec3 u_sun;
uniform vec3 u_shade;
uniform float u_shadeAlpha; // shade recedes when zoomed out, so the sun reads first
uniform float u_strength;   // 1 on the ground; faint when drawn through the buildings
uniform int u_through;      // 1 over the buildings: only the sunny sidewalks show through
in float v_side;
in float v_minutes;
out vec4 color;
vec3 ramp(float m) {
  vec3 c0 = vec3(0.21, 0.31, 0.78), c1 = vec3(0.44, 0.28, 0.91), c2 = vec3(0.68, 0.24, 0.79);
  vec3 c3 = vec3(0.90, 0.29, 0.50), c4 = vec3(0.97, 0.40, 0.03), c5 = vec3(0.99, 0.77, 0.10), c6 = vec3(1.0, 0.95, 0.75);
  if (m <= 0.0) return c0;
  if (m < 15.0) return mix(c1, c2, m / 15.0);
  if (m < 30.0) return mix(c2, c3, (m - 15.0) / 15.0);
  if (m < 60.0) return mix(c3, c4, (m - 30.0) / 30.0);
  if (m < 120.0) return mix(c4, c5, (m - 60.0) / 60.0);
  return mix(c5, c6, clamp((m - 120.0) / 120.0, 0.0, 1.0));
}
void main() {
  float edge = 1.0 - smoothstep(0.55, 1.0, abs(v_side));
  bool lit = u_day > 0.5 && texture(u_mask, gl_FragCoord.xy / u_size).r < 0.5;
  if (u_glow == 1) {
    if (u_mode != 0 || !lit) discard;
    float a = pow(1.0 - abs(v_side), 2.0) * 0.55;
    color = vec4(u_sun * a, a) * u_strength;
    return;
  }
  // through the buildings only the sun shows: hidden shade would only stripe the roofs
  if (u_through == 1 && (u_mode == 0 ? !lit : v_minutes < 60.0)) discard;
  vec3 c;
  float a = edge;
  if (u_mode == 1) c = ramp(v_minutes);
  else if (lit) c = u_sun;
  else {
    // shade is drawn narrower and lighter than sun, so the sunlit sidewalks read first
    if (u_mode == 0 && u_day > 0.5) {
      if (abs(v_side) > 0.62) discard;
      a = 1.0 - smoothstep(0.34, 0.62, abs(v_side));
    }
    c = u_shade;
    a *= u_day > 0.5 ? u_shadeAlpha * 0.6 : 0.4;
  }
  color = vec4(c * a, a) * u_strength;
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const program = gl.createProgram()!;
  for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link');
  return program;
}

export class SunLayer implements CustomLayerInterface {
  readonly id = 'sun-on-the-street';
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;
  origin: [number, number] = [0, 0];
  private map?: MapLibreMap;
  private drawn?: Set<string>;
  private gl?: WebGL2RenderingContext;
  private programs?: {wall: WebGLProgram; composite: WebGLProgram; sidewalk: WebGLProgram};
  private fbo?: {framebuffer: WebGLFramebuffer; texture: WebGLTexture; width: number; height: number};
  private tiles = new Map<string, TileBuffers>();
  private pending: (() => void)[] = [];
  private shadow: [number, number] = [0, 0];
  private day = 1;
  private mode = 0;
  private colors: SunLayerColors = {sun: [1, 0.77, 0.24], shade: [0.3, 0.43, 0.96], shadow: [0.07, 0.09, 0.26, 0.42]};

  onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.gl = gl as WebGL2RenderingContext;
    this.programs = {
      wall: compile(this.gl, WALL_VS, WALL_FS),
      composite: compile(this.gl, COMPOSITE_VS, COMPOSITE_FS),
      sidewalk: compile(this.gl, SIDEWALK_VS, SIDEWALK_FS),
    };
    for (const run of this.pending.splice(0)) run();
  }

  onRemove() {
    const gl = this.gl;
    if (!gl) return;
    for (const key of [...this.tiles.keys()]) this.removeTile(key);
    if (this.fbo) (gl.deleteFramebuffer(this.fbo.framebuffer), gl.deleteTexture(this.fbo.texture));
    this.fbo = undefined;
    this.gl = undefined;
  }

  private upload(data: Float32Array) {
    const gl = this.gl!;
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buffer;
  }

  setWalls(key: string, walls: Float32Array) {
    if (!this.gl) return void this.pending.push(() => this.setWalls(key, walls));
    const entry = this.tiles.get(key) ?? {};
    if (entry.walls) this.gl.deleteBuffer(entry.walls.buffer);
    entry.walls = {buffer: this.upload(walls), count: walls.length / 4};
    this.tiles.set(key, entry);
    this.map?.triggerRepaint();
  }

  setSidewalks(key: string, segments: Float32Array) {
    if (!this.gl) return void this.pending.push(() => this.setSidewalks(key, segments));
    const entry = this.tiles.get(key) ?? {};
    if (entry.sidewalks) this.gl.deleteBuffer(entry.sidewalks.buffer);
    entry.sidewalks = {buffer: this.upload(segments), count: segments.length / 7};
    this.tiles.set(key, entry);
    this.map?.triggerRepaint();
  }

  clearSidewalks() {
    for (const entry of this.tiles.values())
      if (entry.sidewalks) {
        this.gl?.deleteBuffer(entry.sidewalks.buffer);
        entry.sidewalks = undefined;
      }
    this.map?.triggerRepaint();
  }

  removeTile(key: string) {
    const entry = this.tiles.get(key);
    if (!entry) return;
    if (entry.walls) this.gl?.deleteBuffer(entry.walls.buffer);
    if (entry.sidewalks) this.gl?.deleteBuffer(entry.sidewalks.buffer);
    this.tiles.delete(key);
    this.map?.triggerRepaint();
  }

  /** Below this zoom the layer draws nothing and costs nothing. */
  minZoom = 0;
  private idle() {
    return (this.map?.getZoom() ?? 0) < this.minZoom || this.tiles.size === 0;
  }

  /** Only these tiles are drawn: those in view and the ring whose shadows reach into it. */
  setDrawn(keys: Set<string>) {
    this.drawn = keys;
    this.map?.triggerRepaint();
  }

  tileKeys() {
    return [...this.tiles.keys()];
  }

  /** The sun's azimuth (clockwise from north) and altitude, in degrees. */
  setSun(azimuth: number, altitude: number) {
    this.day = altitude > 0.5 ? 1 : 0;
    const a = (azimuth * Math.PI) / 180;
    const cot = Math.min(1 / Math.tan((Math.max(altitude, 0.5) * Math.PI) / 180), 40);
    // away from the sun: u east, v south
    this.shadow = [-Math.sin(a) * cot, Math.cos(a) * cot];
    this.map?.triggerRepaint();
  }

  setMode(mode: 'now' | 'day') {
    this.mode = mode === 'day' ? 1 : 0;
    this.map?.triggerRepaint();
  }

  setColors(colors: SunLayerColors) {
    this.colors = colors;
    this.map?.triggerRepaint();
  }

  private matrix(args: CustomRenderMethodInput): Float32Array {
    const main = args.defaultProjectionData.mainMatrix as unknown as ArrayLike<number>;
    const ox = (this.origin[0] + 180) / 360;
    const oy = (1 - Math.asinh(Math.tan((this.origin[1] * Math.PI) / 180)) / Math.PI) / 2;
    // main · translate(origin) · scale(1 / EARTH), in float64 before handing it to the GPU
    const s = 1 / EARTH;
    const out = new Float32Array(16);
    for (let r = 0; r < 4; r++) {
      out[0 + r] = main[0 + r] * s;
      out[4 + r] = main[4 + r] * s;
      out[8 + r] = main[8 + r];
      out[12 + r] = main[0 + r] * ox + main[4 + r] * oy + main[12 + r];
    }
    return out;
  }

  private ensureFbo(gl: WebGL2RenderingContext) {
    const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
    if (this.fbo && this.fbo.width === width && this.fbo.height === height) return this.fbo;
    if (this.fbo) (gl.deleteFramebuffer(this.fbo.framebuffer), gl.deleteTexture(this.fbo.texture));
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    this.fbo = {framebuffer, texture, width, height};
    return this.fbo;
  }

  prerender(glIn: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    const gl = glIn as WebGL2RenderingContext;
    const programs = this.programs;
    if (!programs || this.idle()) return;
    const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const viewport = gl.getParameter(gl.VIEWPORT);
    const fbo = this.ensureFbo(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.framebuffer);
    gl.viewport(0, 0, fbo.width, fbo.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.day) {
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(programs.wall);
      gl.uniformMatrix4fv(gl.getUniformLocation(programs.wall, 'u_matrix'), false, this.matrix(args));
      gl.uniform2fv(gl.getUniformLocation(programs.wall, 'u_shadow'), this.shadow);
      const loc = gl.getAttribLocation(programs.wall, 'a_wall');
      gl.enableVertexAttribArray(loc);
      for (const [key, entry] of this.tiles) {
        if (this.drawn && !this.drawn.has(key)) continue;
        if (!entry.walls) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, entry.walls.buffer);
        gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 16, 0);
        gl.drawArrays(gl.TRIANGLES, 0, entry.walls.count);
      }
      gl.disableVertexAttribArray(loc);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
    gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
  }

  render(glIn: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    const gl = glIn as WebGL2RenderingContext;
    const programs = this.programs;
    if (!programs || !this.fbo || this.idle()) return;
    const size = [this.fbo.width, this.fbo.height];
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fbo.texture);

    if (this.day && this.mode === 0) {
      gl.useProgram(programs.composite);
      gl.uniform1i(gl.getUniformLocation(programs.composite, 'u_mask'), 0);
      gl.uniform2fv(gl.getUniformLocation(programs.composite, 'u_size'), size);
      // zoomed out, the ground shadow steps back so the sidewalks read first
      const [r, g, b, a] = this.colors.shadow;
      const zoomNow = this.map?.getZoom() ?? 16;
      const fade = Math.min(1, Math.max(0.45, 0.45 + (zoomNow - 13) * 0.3));
      gl.uniform4fv(gl.getUniformLocation(programs.composite, 'u_shadow'), [r, g, b, a * fade]);
      const [lr, lg, lb, la] = this.colors.light ?? [0, 0, 0, 0];
      gl.uniform4fv(gl.getUniformLocation(programs.composite, 'u_light'), [lr, lg, lb, la * fade]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    this.drawSidewalks(gl, args, 1);
  }

  /**
   * The same sidewalks drawn faintly over the 3D buildings, so streets hidden behind a tower still
   * show through it. Placed above the buildings; it shares this layer's buffers and shadow mask.
   */
  readonly through: CustomLayerInterface = {
    id: 'sun-on-the-street-through',
    type: 'custom',
    renderingMode: '2d',
    render: (glIn, args) => {
      const gl = glIn as WebGL2RenderingContext;
      if (!this.programs || !this.fbo || this.idle()) return;
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.drawSidewalks(gl, args, 0.1);
    },
  };

  private drawSidewalks(gl: WebGL2RenderingContext, args: CustomRenderMethodInput, strength: number) {
    const programs = this.programs!;
    const size = [this.fbo!.width, this.fbo!.height];
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fbo!.texture);
    const p = programs.sidewalk;
    gl.useProgram(p);
    gl.uniform1f(gl.getUniformLocation(p, 'u_strength'), strength);
    gl.uniform1i(gl.getUniformLocation(p, 'u_through'), strength < 1 ? 1 : 0);
    gl.uniformMatrix4fv(gl.getUniformLocation(p, 'u_matrix'), false, this.matrix(args));
    gl.uniform2fv(gl.getUniformLocation(p, 'u_viewport'), [size[0] / 2, size[1] / 2]);
    gl.uniform1i(gl.getUniformLocation(p, 'u_mask'), 0);
    gl.uniform2fv(gl.getUniformLocation(p, 'u_size'), size);
    gl.uniform1i(gl.getUniformLocation(p, 'u_mode'), this.mode);
    gl.uniform1f(gl.getUniformLocation(p, 'u_day'), this.day);
    gl.uniform3fv(gl.getUniformLocation(p, 'u_sun'), this.colors.sun);
    gl.uniform3fv(gl.getUniformLocation(p, 'u_shade'), this.colors.shade);
    const zoom = this.map?.getZoom() ?? 16;
    const base = Math.min(11, Math.max(2.4, 3.3 * 2 ** (zoom - 16))) * devicePixelRatio;
    gl.uniform1f(gl.getUniformLocation(p, 'u_shadeAlpha'), Math.min(0.95, Math.max(0.3, 0.3 + (zoom - 13.5) * 0.35)));
    const ab = gl.getAttribLocation(p, 'a_ab');
    const extra = gl.getAttribLocation(p, 'a_extra');
    gl.enableVertexAttribArray(ab);
    gl.enableVertexAttribArray(extra);
    for (const glow of strength < 1 ? [0] : [1, 0]) {
      gl.uniform1i(gl.getUniformLocation(p, 'u_glow'), glow);
      gl.uniform1f(gl.getUniformLocation(p, 'u_width'), glow ? base * 2.6 : strength < 1 ? base * 0.55 : base);
      for (const [key, entry] of this.tiles) {
        if (this.drawn && !this.drawn.has(key)) continue;
        if (!entry.sidewalks) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, entry.sidewalks.buffer);
        gl.vertexAttribPointer(ab, 4, gl.FLOAT, false, 28, 0);
        gl.vertexAttribPointer(extra, 3, gl.FLOAT, false, 28, 16);
        gl.drawArrays(gl.TRIANGLES, 0, entry.sidewalks.count);
      }
    }
    gl.disableVertexAttribArray(ab);
    gl.disableVertexAttribArray(extra);
  }
}
