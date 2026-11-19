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

function link(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
  const program = gl.createProgram()!;
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
      const shader = gl.createShader(type)!;
      try {
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader compilation failed');
        gl.attachShader(program, shader);
      } finally {
        gl.deleteShader(shader); // Attached shaders live until their program is deleted.
      }
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Program link failed');
    return program;
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  }
}

export function createSunPrograms(gl: WebGL2RenderingContext) {
  const linked: WebGLProgram[] = [];
  function bind<U extends string, A extends string>(vs: string, fs: string, uniforms: U[], attributes: A[]) {
    const program = link(gl, vs, fs);
    linked.push(program);
    return {
      program,
      uniforms: Object.fromEntries(uniforms.map(name => [name, gl.getUniformLocation(program, name)])) as Record<U, WebGLUniformLocation | null>,
      attributes: Object.fromEntries(attributes.map(name => [name, gl.getAttribLocation(program, name)])) as Record<A, number>,
    };
  }
  const dispose = () => { for (const program of linked) gl.deleteProgram(program); };
  try {
    return {
      wall: bind(WALL_VS, WALL_FS, ['u_matrix', 'u_shadow'], ['a_wall']),
      composite: bind(COMPOSITE_VS, COMPOSITE_FS, ['u_mask', 'u_size', 'u_shadow', 'u_light'], []),
      sidewalk: bind(SIDEWALK_VS, SIDEWALK_FS, [
        'u_matrix', 'u_viewport', 'u_width', 'u_mask', 'u_size', 'u_mode', 'u_glow',
        'u_day', 'u_sun', 'u_shade', 'u_shadeAlpha', 'u_strength', 'u_through',
      ], ['a_ab', 'a_extra']),
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
