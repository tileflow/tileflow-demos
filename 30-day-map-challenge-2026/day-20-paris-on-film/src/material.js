import {ANCHOR,cellAt,GRID,RADIUS,TILE,world} from './grid.js';

const RANGES=[8292,5633,8305,5640], Z14=16384;
const vertex=`#version 300 es
layout(location=0) in vec3 point; layout(location=1) in vec3 normal;
layout(location=2) in float kind; layout(location=3) in float contact;
uniform mat4 matrix; uniform float heightScale;
out vec3 position, n; out float surface, openness;
void main(){
  position=vec3(point.xy*${(TILE/(4096*4)).toFixed(12)},point.z/64.);
  n=normal; surface=kind; openness=contact;
  gl_Position=matrix*vec4(position.xy,position.z*heightScale,1.);
}`;
const fragment=`#version 300 es
precision highp float;
uniform sampler2D ao,preview,flows;
uniform vec2 origin,hours,selection;
uniform float phase,show,detail,localFade,zoom,hasPreview,bearing;
in vec3 position,n; in float surface,openness;
layout(location=0) out vec4 color;
layout(location=1) out vec4 pick;
vec2 cellFor(vec2 p){
  float b=p.y/1.5,a=p.x/1.732050808-p.y/3.;
  vec3 cube=vec3(a,b,-a-b), rounded=floor(cube+.5), delta=abs(rounded-cube);
  if(delta.x>delta.y && delta.x>delta.z)rounded.x=-rounded.y-rounded.z;
  else if(delta.y>delta.z)rounded.y=-rounded.x-rounded.z;
  return rounded.xy;
}
vec2 composition(vec2 cell,float slot){
  ivec2 at=ivec2(cell)+${GRID/2};
  if(any(lessThan(at,ivec2(0)))||any(greaterThanEqual(at,ivec2(${GRID}))))return vec2(0.);
  return texelFetch(flows,at+ivec2(0,int(slot)*${GRID}),0).rg;
}
vec3 dye(vec2 value){
  float film=smoothstep(.22,.78,value.r);
  vec3 pale=mix(vec3(.72,.84,1.),vec3(1.,.78,.63),film);
  vec3 strong=mix(vec3(.43,.39,.91),vec3(.98,.34,.47),film);
  return mix(vec3(1.),mix(pale,strong,smoothstep(.25,.94,value.g)),value.g);
}
void main(){
  vec2 uv=position.xy/${TILE.toFixed(8)};
  if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))discard;
  bool ground=surface<.5;
  vec2 reference=vec2(1.,0.);
  if(ground && hasPreview>.5 && detail<1.)reference=texture(preview,uv).rg;
  vec2 xy=origin+position.xy;
  vec2 geoXY=xy+vec2(0.,(1.-detail)*reference.g*63.75*.66);
  vec2 gridPoint=geoXY/${RADIUS.toFixed(1)}, cell=cellFor(gridPoint);
  vec2 a=composition(cell,hours.x),b=composition(cell,hours.y);
  float magnitude=mix(a.g,b.g,phase);
  vec3 pigment=mix(dye(a),dye(b),phase);
  float reach=localFade*smoothstep(12.35,13.32,zoom);
  vec2 border=min(xy-vec2(${(RANGES[0]-ANCHOR[0])*TILE},${(RANGES[1]-ANCHOR[1])*TILE}),
                  vec2(${(RANGES[2]+1-ANCHOR[0])*TILE},${(RANGES[3]+1-ANCHOR[1])*TILE})-xy);
  reach*=smoothstep(0.,250.,min(border.x,border.y));
  float alpha=mix(magnitude*.63*show,1.,reach);
  if(alpha<.002)discard;
  vec3 normal=normalize(n);
  float side=1.-clamp(normal.z,0.,1.);
  float shadow=texture(ao,uv).r;
  vec3 base=vec3(.985,.981,.971);
  float absorb=.25;
  if(surface>.5 && surface<1.5){base=vec3(.932,.944,.920);absorb=.24;}
  if(surface>1.5 && surface<2.5){base=vec3(.824,.880,.894);absorb=.16;}
  if(surface>2.5 && surface<3.5){base=vec3(.942,.943,.949);absorb=.21;}
  bool architecture=surface>3.5 && surface<5.6;
  if(architecture){base=vec3(.986,.983,.977);absorb=.61+.19*side;}
  if(surface>5.6 && surface<6.5){base=vec3(.945,.951,.929);absorb=.36;}
  if(surface>6.5 && surface<7.5){base=vec3(.78,.77,.79);absorb=.71;}
  if(surface>7.5){base=vec3(.989,.973,.945);absorb=.66;}
  if(ground && detail<1.) {
    base*=mix(.48+.52*reference.r,1.,detail);
    absorb=mix(.45+reference.g*.23,.25,detail);
  }
  absorb=mix(.95,absorb,reach);
  absorb*=1.-.13*smoothstep(16.0,18.5,zoom);
  // Pigment belongs to the surface. Daylight and the pearl reflection are then applied separately.
  vec3 albedo=base*mix(vec3(1.),pigment,absorb*show);
  vec3 light=normalize(vec3(-.52,-.55,.88));
  float diffuse=max(0.,dot(normal,light));
  float illumination=.865+.145*diffuse;
  if(surface<3.5)illumination=1.-.10*shadow;
  else illumination-=.055*(1.-openness);
  vec3 view=normalize(vec3(-sin(bearing)*.45,cos(bearing)*.45,.94));
  float silk=architecture?.080*pow(max(0.,dot(normal,normalize(light+view))),15.):0.;
  // An understated architectural rhythm is stamped into the porcelain at street scale.
  // Use the geometric face tangent so the window pattern cannot slide when the camera rotates.
  float street=smoothstep(16.1,17.35,zoom);
  if(architecture && street>0. && side>.80 && position.z>2.6){
    vec3 face=cross(dFdx(position),dFdy(position));
    vec2 axis=normalize(vec2(face.y,-face.x)+vec2(1.e-9));
    if(axis.x<0.)axis=-axis;
    vec2 room=vec2(dot(xy,axis)/3.65,position.z/3.22);
    vec2 pane=fract(room)-vec2(.5,.48);
    vec2 d=abs(pane)-vec2(.118,.186);
    float sd=length(max(d,0.))+min(max(d.x,d.y),0.)-.04;
    float aa=clamp(fwidth(sd),.012,.095);
    float glass=1.-smoothstep(-aa,aa,sd);
    float lip=exp(-abs(sd)*31.)*smoothstep(.06,.22,pane.y);
    illumination+=street*(lip*.033-glass*(.049+.034*(.5+pane.y)));
  }
  vec3 shaded=albedo*illumination+silk*vec3(1.,.987,.974);
  vec2 local=abs(gridPoint-vec2(1.732050808*(cell.x+cell.y*.5),1.5*cell.y));
  float edge=.8660254-max(local.x,dot(local,vec2(.5,.8660254)));
  if(distance(cell,selection)<.2)shaded=mix(shaded,vec3(.43,.33,.53),.39*(1.-smoothstep(0.,max(fwidth(edge)*1.2,.003),edge)));
  color=vec4(shaded*alpha,alpha);pick=vec4((cell+vec2(128.))/255.,0.,1.);
}`;
const screenVert=`#version 300 es
out vec2 uv;
void main(){uv=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(uv*2.-1.,0.,1.);}`;
const screenFrag=`#version 300 es
precision highp float;
uniform sampler2D image,depthImage;
uniform vec4 camera;
in vec2 uv;out vec4 color;
float lum(vec3 c){return dot(c,vec3(.3,.59,.11));}
float depthAt(vec2 p){float z=texture(depthImage,p).r;return camera.x*camera.y/(camera.y-z*(camera.y-camera.x));}
void main(){
  vec2 pixel=1./vec2(textureSize(image,0));
  vec4 mid=texture(image,uv);
  if(mid.a<.999){color=mid;return;}
  float z=depthAt(uv);vec2 slope=clamp(vec2(dFdx(z),dFdy(z)),vec2(-1.8),vec2(1.8));
  float occlusion=0.;
  const vec2 directions[8]=vec2[8](vec2(1,0),vec2(-1,0),vec2(0,1),vec2(0,-1),vec2(.707,.707),vec2(-.707,.707),vec2(.707,-.707),vec2(-.707,-.707));
  for(int i=0;i<8;i++)for(int j=0;j<2;j++){
    float radius=camera.z*(j==0?.52:1.25);
    vec2 offset=directions[i]*radius;
    float diff=z+dot(slope,offset)-depthAt(uv+pixel*offset);
    float obstruction=smoothstep(.55,.55+radius*.73,diff)*(1.-smoothstep(radius*3.,radius*9.,diff));
    occlusion+=obstruction;
  }
  vec3 aa=mid.rgb;
  vec3 a=texture(image,uv+pixel*vec2(-.9,-.9)).rgb,b=texture(image,uv+pixel*vec2(.9,-.9)).rgb;
  vec3 c=texture(image,uv+pixel*vec2(-.9,.9)).rgb,d=texture(image,uv+pixel*vec2(.9,.9)).rgb;
  float low=min(min(lum(a),lum(b)),min(lum(c),lum(d))),high=max(max(lum(a),lum(b)),max(lum(c),lum(d)));
  if(high-low>.043){
    vec2 direction=vec2(-(lum(a)+lum(b)-lum(c)-lum(d)),lum(a)+lum(c)-lum(b)-lum(d));
    direction=clamp(direction/(min(abs(direction.x),abs(direction.y))+.032),vec2(-3.),vec2(3.))*pixel;
    vec3 samplePair=(texture(image,uv-direction*.28).rgb+texture(image,uv+direction*.28).rgb)*.5;
    aa=mix(aa,samplePair,.76);
  }
  color=vec4(aa*(1.-occlusion*.014*camera.w),1.);
}`;

function program(gl,vs,fs){
  const p=gl.createProgram();
  for(const [kind,src] of [[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]){
    const s=gl.createShader(kind);gl.shaderSource(s,src);gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));
    gl.attachShader(p,s);gl.deleteShader(s);
  }
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));
  return p;
}
function texture(gl,filter=gl.LINEAR){
  const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
  for(const f of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,f,filter);
  for(const f of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,f,gl.CLAMP_TO_EDGE);
  return t;
}
function mesh(gl,vertices,indices,ranges){
  const vao=gl.createVertexArray();gl.bindVertexArray(vao);
  const v=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,v);gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);
  for(const [id,size,type,norm,offset] of [[0,3,gl.SHORT,false,0],[1,3,gl.BYTE,true,6],[2,1,gl.UNSIGNED_BYTE,false,9],[3,1,gl.UNSIGNED_BYTE,true,10]]){
    gl.enableVertexAttribArray(id);gl.vertexAttribPointer(id,size,type,norm,12,offset);
  }
  const i=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,i);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.STATIC_DRAW);
  gl.bindVertexArray(null);return {vao,v,i,count:indices.length,ranges};
}
function releaseMesh(gl,m){
  if(m){gl.deleteVertexArray(m.vao);gl.deleteBuffer(m.v);gl.deleteBuffer(m.i);}
}
function tileMatrix(m,x,y){
  // Compose in double precision before uploading, to keep street corners stable at deep zoom.
  const out=new Float32Array(16),scale=1/(Z14*TILE);
  for(let k=0;k<4;k++){
    out[k]=m[k]*scale;out[k+4]=m[k+4]*scale;out[k+8]=m[k+8]*scale;
    out[k+12]=m[k]*x/Z14+m[k+4]*y/Z14+m[k+12];
  }return out;
}
async function bitmap(url){
  const r=await fetch(url);if(!r.ok)throw Error(url);
  return createImageBitmap(await r.blob(),{colorSpaceConversion:'none',premultiplyAlpha:'none'});
}
async function geometry(x,y){
  const r=await fetch(import.meta.env.BASE_URL+'maqueta/'+x+'-'+y+'.mesh.gz');if(!r.ok)throw Error('City mesh '+r.status);
  let data=await r.arrayBuffer();
  const magic=new Uint8Array(data,0,2);
  if(magic[0]===31 && magic[1]===139){
    data=await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  const [v,i]=new Uint32Array(data,0,2);
  return [new Uint8Array(data,8,v*12),new Uint32Array(data,8+v*12,i),new Int32Array(data,8+v*12+i*4)];
}
export class FilmMaterial{
  id='paris-film-material';type='custom';renderingMode='3d';
  cache=new Map();slot=0;previous=0;changed=0;show=true;selected=[999,999];
  constructor(data,onFirstPaint){this.data=data;this.onFirstPaint=onFirstPaint;}
  onAdd(map,gl){
    this.map=map;this.gl=gl;this.p=program(gl,vertex,fragment);this.screen=program(gl,screenVert,screenFrag);
    this.u=Object.fromEntries(['matrix','heightScale','ao','preview','flows','origin','hours','selection','phase','show','detail','localFade','hasPreview','zoom','bearing'].map(k=>[k,gl.getUniformLocation(this.p,k)]));
    this.screenTex=gl.getUniformLocation(this.screen,'image');this.screenDepth=gl.getUniformLocation(this.screen,'depthImage');this.camera=gl.getUniformLocation(this.screen,'camera');
    const raw=new ArrayBuffer(48),view=new DataView(raw);
    [[0,0],[16384,0],[0,16384],[16384,16384]].forEach(([x,y],n)=>{view.setInt16(12*n,x,true);view.setInt16(12*n+2,y,true);view.setInt8(12*n+8,127);view.setUint8(12*n+10,255);});
    this.plane=mesh(gl,new Uint8Array(raw),new Uint32Array([0,1,2,2,1,3]));
    this.flows=texture(gl,gl.NEAREST);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RG8,GRID,GRID*2,0,gl.RG,gl.UNSIGNED_BYTE,null);
    this.blank=texture(gl);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB8,1,1,0,gl.RGB,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0]));
    this.setData(this.data);
  }
  target(w,h){
    const gl=this.gl;
    if(this.frame && this.w===w && this.h===h)return;
    this.freeTarget();this.w=w;this.h=h;this.frame=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,this.frame);
    this.images=[0,1].map(n=>{const t=texture(gl,n===0?gl.LINEAR:gl.NEAREST);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0+n,gl.TEXTURE_2D,t,0);return t;});
    this.depth=texture(gl,gl.NEAREST);gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT24,w,h,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,this.depth,0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Could not prepare the city model.');
  }
  freeTarget(){const gl=this.gl;if(this.frame){this.images.forEach(t=>gl.deleteTexture(t));gl.deleteTexture(this.depth);gl.deleteFramebuffer(this.frame);this.frame=null;}}
  setData(data){
    this.data=data;
    const gl=this.gl;if(!gl)return;
    this.previous=this.slot;this.slot=1-this.slot;this.changed=performance.now();
    gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.flows);
    gl.texSubImage2D(gl.TEXTURE_2D,0,0,this.slot*GRID,GRID,GRID,gl.RG,gl.UNSIGNED_BYTE,data.texels);
    gl.activeTexture(gl.TEXTURE0);this.map?.triggerRepaint();
  }
  request(t,key,load){
    if(t[key] || t[key+'Pending'] || (t[key+'Retry']||0)>performance.now())return;
    t[key+'Pending']=true;
    load().then(payload=>{
      if(!this.map || t.evicted){if(payload.close)payload.close();return;}
      t[key+'Data']=payload;this.map.triggerRepaint();
    }).catch(()=>{t[key+'Pending']=false;t[key+'Retry']=performance.now()+2000;});
  }
  resource(x,y,large,medium){
    const id=x+','+y;let t=this.cache.get(id);
    if(!t){t={};this.cache.set(id,t);}
    t.used=performance.now();
    if(large){this.request(t,'mesh',()=>geometry(x,y));this.request(t,'ao',()=>bitmap(import.meta.env.BASE_URL+'maqueta/'+x+'-'+y+'.webp'));}
    if(medium && !t.mesh)this.request(t,'preview',()=>bitmap(import.meta.env.BASE_URL+'relieve/s/'+x+'-'+y+'.webp'));
    const gl=this.gl;
    if(t.meshData){t.mesh=mesh(gl,...t.meshData);t.meshData=null;t.born=performance.now();}
    for(const k of ['preview','ao'])if(t[k+'Data']){
      const img=t[k+'Data'];t[k]=texture(gl);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB8,gl.RGB,gl.UNSIGNED_BYTE,img);gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
      img.close();t[k+'Data']=null;
    }
    return t;
  }
  free(t){const gl=this.gl;t.evicted=true;releaseMesh(gl,t.mesh);for(const k of ['ao','preview']){if(t[k])gl.deleteTexture(t[k]);t[k+'Data']?.close();}}
  pick(point,lngLat){
    const gl=this.gl;if(!this.frame)return cellAt(lngLat.lng,lngLat.lat);
    const prev=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),out=new Uint8Array(4);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,this.frame);gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(Math.min(this.w-1,Math.max(0,Math.floor(point.x*this.w/this.map.getCanvas().clientWidth))),Math.min(this.h-1,Math.max(0,this.h-1-Math.floor(point.y*this.h/this.map.getCanvas().clientHeight))),1,1,gl.RGBA,gl.UNSIGNED_BYTE,out);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,prev);
    return out[3]?[out[0]-128,out[1]-128]:cellAt(lngLat.lng,lngLat.lat);
  }
  render(gl,args){
    const map=this.map,z=map.getZoom(),b=map.getBounds(),[x0,y0]=world(b.getWest(),b.getNorth()),[x1,y1]=world(b.getEast(),b.getSouth());
    if(z<9 || x1<RANGES[0] || y1<RANGES[1] || x0>RANGES[2]+1 || y0>RANGES[3]+1){this.freeTarget();if(this.onFirstPaint){this.onFirstPaint();this.onFirstPaint=null;}return;}
    const prev=gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),viewport=gl.getParameter(gl.VIEWPORT);
    this.target(gl.drawingBufferWidth,gl.drawingBufferHeight);gl.bindFramebuffer(gl.FRAMEBUFFER,this.frame);
    gl.viewport(0,0,this.w,this.h);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.STENCIL_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);
    gl.colorMask(true,true,true,true);gl.enable(gl.DEPTH_TEST);gl.depthMask(true);gl.depthRange(0,1);gl.depthFunc(gl.LEQUAL);
    gl.clearColor(0,0,0,0);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.p);const u=this.u;
    gl.uniform1i(u.ao,0);gl.uniform1i(u.preview,1);gl.uniform1i(u.flows,2);
    gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.flows);
    const phase=Math.min(1,(performance.now()-this.changed)/320),cluster=Math.min(1,Math.max(0,(z-13.55)*2));
    gl.uniform1f(u.phase,phase);gl.uniform2f(u.hours,this.previous,this.slot);gl.uniform1f(u.show,this.show?1:0);
    gl.uniform2fv(u.selection,this.selected);gl.uniform1f(u.zoom,z);gl.uniform1f(u.localFade,1);gl.uniform1f(u.bearing,map.getBearing()*Math.PI/180);
    let ready=true,moving=phase<1;
    for(let y=Math.max(RANGES[1],Math.floor(y0));y<=Math.min(RANGES[3],Math.floor(y1));y++)
      for(let x=Math.max(RANGES[0],Math.floor(x0));x<=Math.min(RANGES[2],Math.floor(x1));x++){
        gl.activeTexture(gl.TEXTURE0);
        const t=this.resource(x,y,z>13.55,z>12.32);
        const detail=t.mesh ? Math.min(cluster,Math.max(0,(performance.now()-t.born)/220)) : 0;
        moving ||= !!(t.mesh && detail<cluster);
        ready &&= z>13.55 ? !!t.mesh : !!t.preview || z<12.32;
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,t.ao||this.blank);
        gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,t.preview||this.blank);
        gl.uniformMatrix4fv(u.matrix,false,tileMatrix(args.defaultProjectionData.mainMatrix,x,y));
        gl.uniform2f(u.origin,(x-ANCHOR[0])*TILE,(y-ANCHOR[1])*TILE);
        gl.uniform1f(u.heightScale,detail);gl.uniform1f(u.hasPreview,t.preview?1:0);gl.uniform1f(u.detail,detail);
        gl.bindVertexArray(this.plane.vao);gl.drawElements(gl.TRIANGLES,6,gl.UNSIGNED_INT,0);
        if(detail>.005){
          gl.bindVertexArray(t.mesh.vao);
          const ranges=t.mesh.ranges;
          if(z<15.4 || !ranges?.length){gl.drawElements(gl.TRIANGLES,t.mesh.count,gl.UNSIGNED_INT,0);}
          else{
            const spread=(Math.tan(map.getPitch()*Math.PI/180)+.55)*4096/TILE;
            for(let k=0;k<ranges.length;k+=7){
              const pad=ranges[k+6]*spread;
              if(ranges[k+4]+pad<(x0-x)*4096 || ranges[k+5]+pad<(y0-y)*4096 ||
                 ranges[k+2]-pad>(x1-x)*4096 || ranges[k+3]-pad>(y1-y)*4096)continue;
              gl.drawElements(gl.TRIANGLES,ranges[k+1],gl.UNSIGNED_INT,ranges[k]*4);
            }
          }
        }
      }
    gl.bindVertexArray(null);gl.bindFramebuffer(gl.FRAMEBUFFER,prev);gl.viewport(...viewport);
    gl.disable(gl.DEPTH_TEST);gl.depthMask(false);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.screen);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.images[0]);gl.uniform1i(this.screenTex,0);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.depth);gl.uniform1i(this.screenDepth,1);
    const scale=this.w/map.getCanvas().clientWidth;
    gl.uniform4f(this.camera,args.nearZ,args.farZ,Math.min(22,Math.max(2.8,4.5*2**(z-14.5)))*scale,cluster);
    gl.drawArrays(gl.TRIANGLES,0,3);
    if(this.cache.size>36)for(const [id,t] of this.cache)if(performance.now()-t.used>1500){this.free(t);this.cache.delete(id);}
    if(ready && this.onFirstPaint){this.onFirstPaint();this.onFirstPaint=null;}
    if(moving)map.triggerRepaint();
  }
  onRemove(map,gl){for(const t of this.cache.values())this.free(t);this.cache.clear();releaseMesh(gl,this.plane);this.freeTarget();gl.deleteTexture(this.flows);gl.deleteTexture(this.blank);gl.deleteProgram(this.p);gl.deleteProgram(this.screen);this.map=null;}
}
