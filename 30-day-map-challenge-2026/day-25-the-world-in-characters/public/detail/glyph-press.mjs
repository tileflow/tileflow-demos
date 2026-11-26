import {streetZoom} from './street-scale.mjs?v=grounded-type-1';
// Draws instanced font glyphs inside Tileflow's WebGL render pass. Every atlas
// cell is one measured glyph of the same local JetBrains Mono used by the style.
import {atlas} from './glyph-metrics.mjs';
import {createInkHandoff,paperMatrix} from './ink-handoff.mjs?v=grounded-type-1';

const id='atlas-printing-press',metrics=Object.values(atlas.metrics);
const glyphCodes=Object.keys(atlas.metrics);
const lineGlyph=['~','–','-','═','━'].map(char=>'g=='+glyphCodes.indexOf(char)).join(' || ');
// Preserve spacing along a road or river as the camera advances. The weight
// of the ink has a gentler optical growth until the next chart is drawn.
export function inkScale(deltaZoom){
  const mapScale=2**deltaZoom;
  const thickness=mapScale<=1?mapScale:1-.28*Math.expm1(-(mapScale-1)/.28);
  return [Math.min(2.25,mapScale),thickness];
}
const vertex=`#version 300 es
precision highp float;
layout(location=0) in vec4 positionSizeAngle;
layout(location=1) in vec2 glyphAndMotion;
layout(location=2) in vec4 ink;
uniform vec4 rects[${metrics.length}];
uniform vec4 texRects[${metrics.length}];
uniform vec2 origin,axisX,axisY,viewport,water;
uniform vec2 scale;
uniform int phase;
uniform vec2 paperOrigin;
uniform mat2 screenToPaper;
uniform vec4 oldExtent;
uniform float handoff,side;
out vec2 uv;
out vec4 color;
out float fontSize;
out float coverage;
void main(){
  int g=int(glyphAndMotion.x+.5);
  int motion=int(glyphAndMotion.y+.5);
  vec2 p=vec2(float(gl_VertexID%2),float(gl_VertexID/2));
  fontSize=positionSizeAngle.z*scale.y;
  vec2 offset=(rects[g].xy+p*rects[g].zw)*(fontSize/24.);
  if(glyphAndMotion.y<0.)offset.x*=-glyphAndMotion.y;
  if(motion!=1 && (${lineGlyph}))offset.x*=scale.x/scale.y;
  float c=cos(positionSizeAngle.w),s=sin(positionSizeAngle.w);
  offset=vec2(c*offset.x-s*offset.y,s*offset.x+c*offset.y);
  vec2 xy=origin+axisX*positionSizeAngle.x+axisY*positionSizeAngle.y+offset;
  if(motion==1)xy+=water;
  gl_Position=vec4(xy/viewport*vec2(2.,-2.)+vec2(-1.,1.),0.,1.);
  uv=texRects[g].xy+p*texRects[g].zw;
  color=ink;
  coverage=1.;
  if(side!=0.){
    vec2 paper=screenToPaper*(xy-paperOrigin);
    vec2 margin=min(paper-oldExtent.xy,oldExtent.zw-paper);
    // Incoming coverage is immediately visible outside the old survey. Fade
    // only on the ground for which both editions actually have ink.
    float overlap=smoothstep(0.,1.4,min(margin.x,margin.y));
    float arrival=mix(1.,smoothstep(0.,1.,handoff),overlap);
    coverage=side>0.?arrival:1.-arrival;
  }
  if(motion>=2 && phase>=0){
    int i=(motion-2+4-phase)%4;
    color.a*=i==0?.97:i==1?.55:i==2?.20:.32;
  }
}`;
const fragment=`#version 300 es
precision highp float;
uniform sampler2D fontAtlas;
uniform float dpr;
in vec2 uv;
in vec4 color;
in float fontSize;
in float coverage;
out vec4 pixel;
void main(){
  float g=.105*24./(max(.01,fontSize)*dpr);
  float a=smoothstep(.75-g,.75+g,texture(fontAtlas,uv).r)*color.a;
  // Preserve the strength of ink shared by the two plates under source-over.
  // Without this compensation, a solid shared stroke loses 25% at mid-blend.
  if(coverage<1.)a*=coverage/(1.-.62*a*(1.-coverage));
  pixel=vec4(color.rgb*a,a);
}`;
function shader(gl,type,src){
  const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const why=gl.getShaderInfoLog(s);gl.deleteShader(s);throw Error(why);}
  return s;
}
function printingLayer(map,bytes){
  const handoff=createInkHandoff(), buffers=[];
  const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  let program,texture,loc,inkTime=null,disposed=false;
  function createBuffer(gl){
    const surface={vao:gl.createVertexArray(),vbo:gl.createBuffer(),loaded:null};
    buffers.push(surface);
    gl.bindVertexArray(surface.vao);gl.bindBuffer(gl.ARRAY_BUFFER,surface.vbo);
    for(const [i,size,type,normalize,offset] of [[0,4,gl.FLOAT,false,0],[1,2,gl.FLOAT,false,16],[2,4,gl.UNSIGNED_BYTE,true,24]]){
      gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,size,type,normalize,28,offset);gl.vertexAttribDivisor(i,1);
    }
    gl.bindVertexArray(null);gl.bindBuffer(gl.ARRAY_BUFFER,null);
    return surface;
  }
  function bindChart(gl,chart,other){
    let surface=buffers.find(s=>s.loaded===chart);
    if(!surface){
      surface=buffers.find(s=>!s.loaded || s.loaded!==other) || createBuffer(gl);
      gl.bindBuffer(gl.ARRAY_BUFFER,surface.vbo);gl.bufferData(gl.ARRAY_BUFFER,chart.data,gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER,null);surface.loaded=chart;
    }
    gl.bindVertexArray(surface.vao);
  }
  function chartBasis(chart){
    const [o,x,y]=chart.anchors.map(ll=>map.project(ll)),[dx,dy]=chart.step;
    return {o,xx:(x.x-o.x)/dx,xy:(x.y-o.y)/dx,yx:(y.x-o.x)/dy,yy:(y.y-o.y)/dy};
  }
  function viewportCoverage(chart){
    const canvas=map.getCanvas(),w=canvas.clientWidth,h=canvas.clientHeight;
    if(!chart.extent||!w||!h)return 0;
    const b=chartBasis(chart),[x0,y0,x1,y1]=chart.extent;
    const left=b.o.x+Math.min(b.xx*x0,b.xx*x1)+Math.min(b.yx*y0,b.yx*y1);
    const right=b.o.x+Math.max(b.xx*x0,b.xx*x1)+Math.max(b.yx*y0,b.yx*y1);
    const top=b.o.y+Math.min(b.xy*x0,b.xy*x1)+Math.min(b.yy*y0,b.yy*y1);
    const bottom=b.o.y+Math.max(b.xy*x0,b.xy*x1)+Math.max(b.yy*y0,b.yy*y1);
    return Math.max(0,Math.min(right,w)-Math.max(left,0))*Math.max(0,Math.min(bottom,h)-Math.max(top,0))/(w*h);
  }
  function release(gl){
    for(const surface of buffers.splice(0)){gl.deleteBuffer(surface.vbo);gl.deleteVertexArray(surface.vao);}
    if(texture)gl.deleteTexture(texture);if(program)gl.deleteProgram(program);
    program=texture=null;
  }
  const layer={id,type:'custom',renderingMode:'2d',onAdd(_map,gl){
    if(!gl.createVertexArray)throw Error('WebGL2 unavailable');
    try{
      const v=shader(gl,gl.VERTEX_SHADER,vertex),f=shader(gl,gl.FRAGMENT_SHADER,fragment);
      program=gl.createProgram();gl.attachShader(program,v);gl.attachShader(program,f);gl.linkProgram(program);
      gl.deleteShader(v);gl.deleteShader(f);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
      const names=['rects[0]','texRects[0]','origin','axisX','axisY','viewport','water','scale','phase','fontAtlas','dpr','paperOrigin','screenToPaper','oldExtent','side','handoff'];
      loc=Object.fromEntries(names.map(k=>[k,gl.getUniformLocation(program,k)]));gl.useProgram(program);
      gl.uniform4fv(loc['rects[0]'],metrics.flatMap(v=>v.rect));
      gl.uniform4fv(loc['texRects[0]'],metrics.flatMap(v=>v.uv.map((x,i)=>x/(i%2?atlas.height:atlas.width))));
      gl.uniform1i(loc.fontAtlas,0);
      createBuffer(gl);
      texture=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,atlas.width,atlas.height,0,gl.RED,gl.UNSIGNED_BYTE,bytes);
      for(const [key,val] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,key,val);
      gl.bindTexture(gl.TEXTURE_2D,null);gl.useProgram(null);
    }catch(e){release(gl);throw e;}
  },render(gl){
    if(!program||disposed||!handoff.first||map.getProjection().type!==handoff.first.projection)return;
    handoff.advance(performance.now());
    const first=handoff.first,second=handoff.second;
    if(!first.count&&!second)return;
    const basis=chartBasis(first);
    const canvas=map.getCanvas(),w=canvas.clientWidth,h=canvas.clientHeight;
    if(!w||!h)return;
    const zoom=map.getZoom();
    gl.useProgram(program);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.disable(gl.DEPTH_TEST);gl.disable(gl.STENCIL_TEST);gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform2f(loc.viewport,w,h);gl.uniform1f(loc.dpr,canvas.width/w);
    const clock=first.zoom<streetZoom?inkTime:null,t=clock??0;gl.uniform2f(loc.water,clock===null?0:Math.sin(t*Math.PI/6)*1.6,clock===null?0:Math.cos(t*Math.PI/6)*.65);
    gl.uniform1i(loc.phase,clock===null?-1:Math.floor(t*4)%4);
    function draw(chart,b,side,other){
      if(!chart.count)return;
      bindChart(gl,chart,other);
      gl.uniform2f(loc.origin,b.o.x,b.o.y);gl.uniform2f(loc.axisX,b.xx,b.xy);gl.uniform2f(loc.axisY,b.yx,b.yy);
      gl.uniform2fv(loc.scale,inkScale(zoom-chart.zoom));gl.uniform1f(loc.side,side);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,chart.count);
    }
    if(second){
      const frequency=2**(handoff.startedAtZoom-first.zoom)/29;
      const matrix=paperMatrix(basis.xx,basis.xy,basis.yx,basis.yy,frequency);
      if(matrix){
        gl.uniform2f(loc.paperOrigin,basis.o.x,basis.o.y);gl.uniformMatrix2fv(loc.screenToPaper,false,matrix);
        gl.uniform4fv(loc.oldExtent,first.extent?first.extent.map(v=>v*frequency):[-1e8,-1e8,1e8,1e8]);
        gl.uniform1f(loc.handoff,handoff.position);
        if(handoff.position<1)draw(first,basis,-1,second);
      }
      draw(second,chartBasis(second),matrix?1:0,first);
      map.triggerRepaint();
    }else draw(first,basis,0,null);
    gl.bindVertexArray(null);
  },onRemove(_map,gl){release(gl);}};
  return {layer,show(chart){handoff.select(chart,map.getZoom(),performance.now(),(chart?.zoom>=streetZoom||reduced?.matches),viewportCoverage);map.triggerRepaint();},tick(v){inkTime=v;},close(){disposed=true;handoff.select(null);}};
}
export function createGlyphPress(map,onUnavailable){
  let press=null,closed=false;
  const canvas=map.getCanvas();
  function install(){
    if(closed||!press||map.getLayer(id))return;
    const before=map.getStyle().layers.find(l=>['regional','local','staging'].includes(l.source));
    map.addLayer(press.layer,before?.id);
  }
  function reinstall(){
    if(closed)return;
    try{install();}catch(e){
      press?.close();press=null;
      map.off('webglcontextrestored',restore);
      canvas.removeEventListener('webglcontextrestored',restore);
      if(map.getLayer(id))map.removeLayer(id);
      onUnavailable?.(e);
    }
  }
  function restore(){
    // Native WebGL restoration and worker-pool rebuilds are distinct events;
    // the map may still be laying out its recreated style when either fires.
    if(closed||!press)return;
    map.off('style.load',reinstall);
    if(map.isStyleLoaded())reinstall();
    else map.once('style.load',reinstall);
  }
  const ready=(async()=>{
    try{
      const r=await fetch(new URL('./glyph-atlas.bin',import.meta.url));
      if(!r.ok||closed)return false;
      const bytes=new Uint8Array(await r.arrayBuffer());
      if(bytes.length!==atlas.width*atlas.height||closed)return false;
      press=printingLayer(map,bytes);
      install();
      map.on('webglcontextrestored',restore);canvas.addEventListener('webglcontextrestored',restore);
      return true;
    }catch(error){console.warn('The native glyph layout will handle this view.',error);press=null;return false;}
  })();
  return {ready,show(chart){press?.show(chart?.press||null);},tick(t){press?.tick(t);},destroy(){closed=true;map.off('webglcontextrestored',restore);map.off('style.load',reinstall);canvas.removeEventListener('webglcontextrestored',restore);press?.close();if(map.getLayer(id))map.removeLayer(id);press=null;}};
}
