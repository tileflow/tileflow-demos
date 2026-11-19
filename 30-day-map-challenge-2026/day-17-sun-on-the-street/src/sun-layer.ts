// A MapLibre custom layer that draws, for any sun position, without CPU work per frame:
//   1. the ground shadow of every loaded building: each wall is a quad whose top the vertex shader
//      slides along the shadow, drawn into an offscreen mask;
//   2. that mask over the ground, as the shadow, and a faint warm light where the sun reaches;
//   3. the sidewalks, sunlit where the mask is clear (or coloured by their minutes of sun).
// Positions are Web Mercator metres from `origin` (u east, v south).

import type {CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap} from 'maplibre-gl';

import {EARTH, mercX, mercY} from './mercator';
import {createSunPrograms} from './sun-programs';

export type SunLayerColors = {
  sun: [number, number, number];
  shade: [number, number, number];
  shadow: [number, number, number, number];
  /** A faint warm wash on the ground the sun reaches, so the light reads on the street itself. */
  light?: [number, number, number, number];
};

type TileBuffers = {walls?: {buffer: WebGLBuffer; count: number}; sidewalks?: {buffer: WebGLBuffer; count: number}};

export class SunLayer implements CustomLayerInterface {
  readonly id = 'sun-on-the-street';
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;
  origin: [number, number] = [0, 0];
  private map?: MapLibreMap;
  private drawn?: Set<string>;
  private gl?: WebGL2RenderingContext;
  private programs?: ReturnType<typeof createSunPrograms>;
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
    this.programs = createSunPrograms(this.gl);
    for (const run of this.pending.splice(0)) run();
  }

  onRemove() {
    const gl = this.gl;
    if (!gl) return;
    for (const key of [...this.tiles.keys()]) this.removeTile(key);
    if (this.fbo) (gl.deleteFramebuffer(this.fbo.framebuffer), gl.deleteTexture(this.fbo.texture));
    this.programs?.dispose();
    this.programs = undefined;
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
    const ox = mercX(this.origin[0]);
    const oy = mercY(this.origin[1]);
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
      gl.useProgram(programs.wall.program);
      gl.uniformMatrix4fv(programs.wall.uniforms.u_matrix, false, this.matrix(args));
      gl.uniform2fv(programs.wall.uniforms.u_shadow, this.shadow);
      const loc = programs.wall.attributes.a_wall;
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
      gl.useProgram(programs.composite.program);
      gl.uniform1i(programs.composite.uniforms.u_mask, 0);
      gl.uniform2fv(programs.composite.uniforms.u_size, size);
      // zoomed out, the ground shadow steps back so the sidewalks read first
      const [r, g, b, a] = this.colors.shadow;
      const zoomNow = this.map?.getZoom() ?? 16;
      const fade = Math.min(1, Math.max(0.45, 0.45 + (zoomNow - 13) * 0.3));
      gl.uniform4fv(programs.composite.uniforms.u_shadow, [r, g, b, a * fade]);
      const [lr, lg, lb, la] = this.colors.light ?? [0, 0, 0, 0];
      gl.uniform4fv(programs.composite.uniforms.u_light, [lr, lg, lb, la * fade]);
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
    const {program, uniforms, attributes} = programs.sidewalk;
    gl.useProgram(program);
    gl.uniform1f(uniforms.u_strength, strength);
    gl.uniform1i(uniforms.u_through, strength < 1 ? 1 : 0);
    gl.uniformMatrix4fv(uniforms.u_matrix, false, this.matrix(args));
    gl.uniform2fv(uniforms.u_viewport, [size[0] / 2, size[1] / 2]);
    gl.uniform1i(uniforms.u_mask, 0);
    gl.uniform2fv(uniforms.u_size, size);
    gl.uniform1i(uniforms.u_mode, this.mode);
    gl.uniform1f(uniforms.u_day, this.day);
    gl.uniform3fv(uniforms.u_sun, this.colors.sun);
    gl.uniform3fv(uniforms.u_shade, this.colors.shade);
    const zoom = this.map?.getZoom() ?? 16;
    const base = Math.min(11, Math.max(2.4, 3.3 * 2 ** (zoom - 16))) * devicePixelRatio;
    gl.uniform1f(uniforms.u_shadeAlpha, Math.min(0.95, Math.max(0.3, 0.3 + (zoom - 13.5) * 0.35)));
    const ab = attributes.a_ab;
    const extra = attributes.a_extra;
    gl.enableVertexAttribArray(ab);
    gl.enableVertexAttribArray(extra);
    for (const glow of strength < 1 ? [0] : [1, 0]) {
      gl.uniform1i(uniforms.u_glow, glow);
      gl.uniform1f(uniforms.u_width, glow ? base * 2.6 : strength < 1 ? base * 0.55 : base);
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
