// Marches every (sidewalk point, sun position) ray at once in a fragment shader, inside the worker,
// on an OffscreenCanvas. One pixel per ray: red is 1 when the point sees the sun. Returns false when
// the browser has no WebGL2 in workers, and the caller marches on the CPU instead.

const VS = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D u_height;  // building height per cell, Mercator metres
uniform highp sampler2D u_points;  // per point: cell coordinates
uniform highp sampler2D u_steps;   // per sun position: direction (cells), rise per cell, reach (cells)
uniform int u_size;
uniform int u_nsteps;
uniform int u_perRow;
uniform int u_points_n;
uniform int u_row0;
out vec4 color;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int step = p.x % u_nsteps;
  int point = (p.y + u_row0) * u_perRow + p.x / u_nsteps;
  if (point >= u_points_n) { color = vec4(0.0); return; }
  vec2 at = texelFetch(u_points, ivec2(point % 1024, point / 1024), 0).xy;
  vec4 sun = texelFetch(u_steps, ivec2(step, 0), 0);
  float size = float(u_size);
  float lit = 1.0;
  for (float d = 0.75; d <= sun.w; d += 0.75) {
    vec2 q = at + sun.xy * d;
    if (q.x < 0.0 || q.y < 0.0 || q.x >= size || q.y >= size) break;
    if (texelFetch(u_height, ivec2(q), 0).r > d * sun.z) { lit = 0.0; break; }
  }
  color = vec4(lit, 0.0, 0.0, 1.0);
}`;

type Gpu = {gl: WebGL2RenderingContext; program: WebGLProgram; canvas: OffscreenCanvas};
let gpu: Gpu | null | undefined;

function init(): Gpu | null {
  try {
    if (typeof OffscreenCanvas === 'undefined') return null;
    const canvas = new OffscreenCanvas(1, 1);
    const gl = canvas.getContext('webgl2', {antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false});
    if (!gl) return null;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link');
    gl.useProgram(program);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    return {gl, program, canvas};
  } catch (error) {
    console.warn('Sun on the street: marching on the CPU', error);
    return null;
  }
}

function texture(gl: WebGL2RenderingContext, unit: number, format: number, internal: number, w: number, h: number, data: Float32Array) {
  const t = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.FLOAT, data);
  return t;
}

const CELL = 2;

/**
 * Fills `out[point * steps + step]` with 1 where the point sees the sun. Heights and positions are
 * Mercator metres; `steps` holds, per sun position, the unit direction towards the sun, the rise per
 * metre (tan of the altitude) and the reach in metres.
 */
export function marchOnGpu(input: {
  height: Float32Array;
  size: number;
  maxHeight: number;
  pu: number[];
  pv: number[];
  gu0: number;
  gv0: number;
  steps: number[][];
  out: Uint8Array;
}): boolean {
  gpu ??= init();
  if (!gpu) return false;
  const {gl, program, canvas} = gpu;
  const {size, pu, pv, steps, out} = input;
  const n = pu.length;
  if (n === 0) return true;
  const ns = steps.length;
  const points = new Float32Array(1024 * Math.ceil(n / 1024) * 2);
  for (let i = 0; i < n; i++) {
    points[2 * i] = (pu[i] - input.gu0) / CELL;
    points[2 * i + 1] = (pv[i] - input.gv0) / CELL;
  }
  const sun = new Float32Array(ns * 4);
  steps.forEach(([du, dv, rise, reach], s) => sun.set([du, dv, rise * CELL, reach / CELL], s * 4));
  const textures = [
    texture(gl, 0, gl.RED, gl.R32F, size, size, input.height),
    texture(gl, 1, gl.RG, gl.RG32F, 1024, Math.ceil(n / 1024), points),
    texture(gl, 2, gl.RGBA, gl.RGBA32F, ns, 1, sun),
  ];
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, 'u_height'), 0);
  gl.uniform1i(gl.getUniformLocation(program, 'u_points'), 1);
  gl.uniform1i(gl.getUniformLocation(program, 'u_steps'), 2);
  gl.uniform1i(gl.getUniformLocation(program, 'u_size'), size);
  gl.uniform1i(gl.getUniformLocation(program, 'u_nsteps'), ns);
  gl.uniform1i(gl.getUniformLocation(program, 'u_points_n'), n);
  // several points per row keep the target within texture limits; a few rows per draw keep each
  // draw short, so the GPU stays responsive for the map
  const perRow = Math.max(1, Math.floor(4096 / ns));
  const width = perRow * ns;
  const rowsTotal = Math.ceil(n / perRow);
  const chunk = Math.max(1, Math.min(rowsTotal, Math.floor(400000 / width)));
  gl.uniform1i(gl.getUniformLocation(program, 'u_perRow'), perRow);
  const target = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, target);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, chunk);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
  if (canvas.width !== 1) canvas.width = 1;
  const pixels = new Uint8Array(width * chunk * 4);
  try {
    for (let row0 = 0; row0 < rowsTotal; row0 += chunk) {
      const rows = Math.min(chunk, rowsTotal - row0);
      gl.viewport(0, 0, width, rows);
      gl.uniform1i(gl.getUniformLocation(program, 'u_row0'), row0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.readPixels(0, 0, width, rows, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < width; c++) {
          const point = (row0 + r) * perRow + Math.floor(c / ns);
          if (point >= n) break;
          out[point * ns + (c % ns)] = pixels[(r * width + c) * 4] > 127 ? 1 : 0;
        }
    }
    return !gl.isContextLost() && gl.getError() === gl.NO_ERROR;
  } catch (error) {
    console.warn('Sun on the street: GPU march failed', error);
    return false;
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    for (const t of [...textures, target]) gl.deleteTexture(t);
  }
}
