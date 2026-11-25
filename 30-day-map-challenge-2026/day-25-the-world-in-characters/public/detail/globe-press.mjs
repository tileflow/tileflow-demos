// One instanced draw for the geographic punctuation. Names remain native
// Tileflow symbols. The vertex shader uses the projection supplied by the map.
import {atlas} from './glyph-metrics.mjs';

const id='globe-printing-press';
const metrics=Object.entries(atlas.metrics);
const codes=new Map(metrics.map(([char],i)=>[char,i]));
const words='globe-words',ink='globe-ink';
const blank={ready:false,tick(){},destroy(){}};
const frozen=new WeakMap();
const radians=Math.PI/180;
const mercatorY=lat=> (1-Math.asinh(Math.tan(Math.max(-89.999,Math.min(89.999,lat))*radians))/Math.PI)/2;

function inkData(collection,layers) {
  const byKind=new Map(layers.map((l,i)=>[l.filter[2],i]));
  const ordered=Array.from({length:layers.length},()=>[]);
  let count=0;
  for(const f of collection.features){
    const cls=byKind.get(f.properties.kind),glyph=codes.get(f.properties.char);
    if(cls===undefined||glyph===undefined)throw Error('Unsupported globe ink geometry');
    const part=f.geometry.type==='MultiPoint'?f.geometry.coordinates:f.geometry.type==='Point'?[f.geometry.coordinates]:null;
    if(!part)throw Error('Unexpected globe geometry');
    ordered[cls].push({part,glyph,p:f.properties});count+=part.length;
  }
  const stride=8,packed=new Float32Array(count*stride);
  let index=0;
  for(let cls=0;cls<ordered.length;cls++)for(const {part,glyph,p} of ordered[cls]){
    const angle=(p.rot||0)*radians,tier=Number(p.tier===1);
    for(const [lon,lat] of part){
      packed[index++]=(lon+180)/360;packed[index++]=mercatorY(lat);
      packed[index++]=1/Math.max(.0087,Math.cos(lat*radians));
      packed[index++]=Math.cos(angle);packed[index++]=Math.sin(angle);
      packed[index++]=glyph;packed[index++]=cls;packed[index++]=tier;
    }
  }
  return {packed,count};
}

function evaluated(expr,z,tier){
  if(typeof expr==='number')return expr;
  if(expr[0]==='case')return evaluated(tier?expr[2]:expr[3],z,tier);
  if(expr[0]!=='interpolate')throw Error('Unexpected typographic style');
  let left=expr[3],value=evaluated(expr[4],z,tier);
  if(z<=left)return value;
  for(let i=5;i<expr.length;i+=2){
    const right=expr[i],next=evaluated(expr[i+1],z,tier);
    if(z<=right)return value+(next-value)*(z-left)/(right-left);
    left=right;value=next;
  }
  return value;
}
const fragment=`#version 300 es
precision highp float;
uniform sampler2D fontAtlas;
uniform float dpr;
in vec2 uv;
in vec4 color;
in float size;
out vec4 pixel;
void main(){
  float g=.105*24./(max(.01,size)*dpr);
  float a=smoothstep(.75-g,.75+g,texture(fontAtlas,uv).r)*color.a;
  pixel=vec4(color.rgb*a,a);
}`;
function compile(gl,type,source){
  const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const msg=gl.getShaderInfoLog(s);gl.deleteShader(s);throw Error(msg);}
  return s;
}
function programFor(gl,shader,layers,colors){
  const source=`#version 300 es
precision highp float;
${shader.define}
${shader.vertexShaderPrelude}
layout(location=0)in vec3 anchor; // normalised Mercator x/y and sec(latitude)
layout(location=1)in vec2 rotation;
layout(location=2)in vec3 glyphClassTier;
uniform vec4 rects[${metrics.length}],uvs[${metrics.length}],inks[${layers.length}];
uniform vec3 specs[${layers.length}]; // font px, full alpha, tier-one alpha
uniform vec2 motion[${layers.length}];
uniform vec4 camera; // world size, centre cosine, focal length, globe fraction
uniform vec2 viewport;
out vec2 uv;out vec4 color;out float size;
void main(){
  int g=int(glyphClassTier.x+.5),k=int(glyphClassTier.y+.5);
  vec2 point=vec2(float(gl_VertexID%2),float(gl_VertexID/2));
  vec4 center=projectTile(anchor.xy);
  // Map-aligned text follows the actual surface tangent and its latitude scale.
  float perspective=clamp(.5+.5*center.w/camera.z,0.,4.);
  size=specs[k].x;
  vec2 local=rects[g].xy+point*rects[g].zw;
  local.y+=.72; // source text offset is -.10 em; the shared atlas uses -.13
  local=vec2(rotation.x*local.x-rotation.y*local.y,rotation.y*local.x+rotation.x*local.y);
  float correction=mix(1.,camera.y*anchor.z,camera.w);
  vec2 delta=local*(size/24.)*perspective*correction/camera.x;
  gl_Position=projectTile(anchor.xy+delta);
  // On the native globe, projectTile computes clip z from its horizon plane.
  // Clip the whole letter as soon as its anchor passes behind the Earth.
  if(center.z>center.w)gl_Position=vec4(2.,2.,2.,1.);
  gl_Position.xy+=motion[k]*vec2(2.,-2.)/viewport*gl_Position.w;
  uv=uvs[g].xy+point*uvs[g].zw;color=inks[k];
  color.a=mix(specs[k].y,specs[k].z,glyphClassTier.z);
}`;
  const p=gl.createProgram(),v=compile(gl,gl.VERTEX_SHADER,source),f=compile(gl,gl.FRAGMENT_SHADER,fragment);
  gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const msg=gl.getProgramInfoLog(p);gl.deleteProgram(p);throw Error(msg);}
  const names=['u_projection_matrix','u_projection_fallback_matrix','u_projection_tile_mercator_coords','u_projection_clipping_plane','u_projection_transition','rects[0]','uvs[0]','inks[0]','specs[0]','motion[0]','camera','viewport','fontAtlas','dpr'];
  const u=Object.fromEntries(names.map(k=>[k,gl.getUniformLocation(p,k)]));
  gl.useProgram(p);gl.uniform4fv(u['rects[0]'],metrics.flatMap(([,m])=>m.rect));
  gl.uniform4fv(u['uvs[0]'],metrics.flatMap(([,m])=>m.uv.map((n,i)=>n/(i%2?atlas.height:atlas.width))));
  gl.uniform4fv(u['inks[0]'],colors);gl.uniform1i(u.fontAtlas,0);
  return {p,u};
}
async function install(map){
  const layers=map.getStyle().layers.filter(l=>l.source===ink && l.type==='symbol');
  if(!layers.length)return blank;
  const [data,response]=await Promise.all([map.getSource(ink).getData(),fetch(new URL('./glyph-atlas.bin',import.meta.url))]);
  if(!response.ok)return blank;
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length!==atlas.width*atlas.height)return blank;
  const {packed,count}=inkData(data,layers);if(!count)return blank;
  const colors=layers.flatMap(l=>{const n=Number.parseInt(l.paint['text-color'].slice(1),16);return [(n>>16)/255,((n>>8)&255)/255,(n&255)/255,1];});
  const original=layers.map(l=>[l.id,l.layout.visibility||'visible']);
  let texture,vao,vbo,time=0,disabled=false,shown=false,settled=false,lastZoom,priorProgram;
  const programs=new Map(),sizes=new Float32Array(layers.length*3),motions=new Float32Array(layers.length*2);
  const tide=layers.findIndex(l=>l.id==='globe-tide'),road=layers.findIndex(l=>l.id==='globe-road-flow');
  let resolveReady;const painted=new Promise(r=>{resolveReady=r;});
  function finish(ok){if(!settled){settled=true;resolveReady(ok);}}
  function native(visible){
    if(!map.getStyle())return;
    for(const [key,old] of original)if(map.getLayer(key))map.setLayoutProperty(key,'visibility',visible?old:'none');
  }
  function resources(gl){
    vao=gl.createVertexArray();vbo=gl.createBuffer();gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,vbo);
    gl.bufferData(gl.ARRAY_BUFFER,packed,gl.STATIC_DRAW);
    for(const [i,n,offset] of [[0,3,0],[1,2,12],[2,3,20]]){
      gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,n,gl.FLOAT,false,32,offset);gl.vertexAttribDivisor(i,1);
    }
    gl.bindVertexArray(null);gl.bindBuffer(gl.ARRAY_BUFFER,null);
    texture=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,atlas.width,atlas.height,0,gl.RED,gl.UNSIGNED_BYTE,bytes);
    for(const [k,val] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,k,val);
    gl.bindTexture(gl.TEXTURE_2D,null);
  }
  const layer={id,type:'custom',renderingMode:'2d',onAdd(_m,gl){resources(gl);},
    render(gl,args){
      if(disabled)return;
      try{
        const shader=args.shaderData,variant=shader.variantName,d=args.defaultProjectionData;
        let prog=programs.get(variant);
        if(!prog){prog=programFor(gl,shader,layers,colors);programs.set(variant,prog);}
        const {p,u}=prog,cv=map.getCanvas(),z=map.getZoom(),width=cv.clientWidth,height=cv.clientHeight;
        if(!width||!height)return;
        gl.useProgram(p);gl.bindVertexArray(vao);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.disable(gl.DEPTH_TEST);gl.disable(gl.STENCIL_TEST);gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
        gl.uniformMatrix4fv(u.u_projection_matrix,false,d.mainMatrix);
        gl.uniformMatrix4fv(u.u_projection_fallback_matrix,false,d.fallbackMatrix);
        gl.uniform4fv(u.u_projection_tile_mercator_coords,d.tileMercatorCoords);
        gl.uniform4fv(u.u_projection_clipping_plane,d.clippingPlane);
        gl.uniform1f(u.u_projection_transition,d.projectionTransition);
        gl.uniform4f(u.camera,512*2**z,Math.cos(Math.min(85.051129,Math.abs(map.getCenter().lat))*radians),height/(2*Math.tan(args.fov/2)),d.projectionTransition);
        gl.uniform2f(u.viewport,width,height);gl.uniform1f(u.dpr,cv.width/width);
        if(lastZoom!==z||priorProgram!==p){
          layers.forEach((l,i)=>{sizes[i*3]=evaluated(l.layout['text-size'],z,0);sizes[i*3+1]=evaluated(l.paint['text-opacity'],z,0);sizes[i*3+2]=evaluated(l.paint['text-opacity'],z,1);});
          gl.uniform3fv(u['specs[0]'],sizes);lastZoom=z;priorProgram=p;
        }
        const a=time*Math.PI/6;
        if(tide>=0){motions[tide*2]=Math.sin(a)*1.55;motions[tide*2+1]=(Math.cos(a)-1)*.47;}
        if(road>=0)motions[road*2]=Math.sin(a)*1.2;
        gl.uniform2fv(u['motion[0]'],motions);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,count);gl.bindVertexArray(null);
        if(!shown){shown=true;queueMicrotask(()=>{if(disabled)return;native(false);finish(true);});}
      }catch(e){disabled=true;console.warn('Tileflow globe is using its native text layers.',e);queueMicrotask(()=>{native(true);finish(false);});}
    },
    onRemove(_m,gl){for(const {p} of programs.values())gl.deleteProgram(p);programs.clear();gl.deleteVertexArray(vao);gl.deleteBuffer(vbo);gl.deleteTexture(texture);finish(false);}
  };
  map.addLayer(layer,map.getStyle().layers.find(l=>l.source===words)?.id);map.triggerRepaint();
  if(!await painted){if(map.getLayer(id))map.removeLayer(id);return blank;}
  return {ready:true,count,tick(seconds){if(!disabled){time=seconds;map.triggerRepaint();}},destroy(){
    disabled=true;native(true);if(map.getLayer(id))map.removeLayer(id);frozen.delete(map);
  }};
}
export function createGlobePress(map){
  if(!frozen.has(map))frozen.set(map,install(map).catch(e=>{console.warn('Tileflow globe is using its native text layers.',e);return blank;}));
  return frozen.get(map);
}
