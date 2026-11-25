import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {launch} from '../../scripts/qa/browser.mjs';
import {stage} from './stage.mjs';

const here=new URL('./',import.meta.url), local=p=>fileURLToPath(new URL(p,here));
const viewer=new URL('../../public/',here);
const host='http://127.0.0.1:8526/';
const width=960,height=540,ratio=2,n=210,firstFlat=141,lastGlobe=206;
const proof=process.argv.includes('--proof'), targets=new Set([0,30,60,90,105,120,135,141,150,159,168,177,186,195,201,209]);
const pole=[[-9.1393,38.7223],[2.1734,41.3851],[-3.7038,40.4168]];
const mix=(a,b,u)=>a+(b-a)*u;
const smooth=x=>{const u=Math.min(1,Math.max(0,x));return u*u*(3-2*u);};
function hermite(a,b,v0,v1,dt,u){
  return (2*u**3-3*u*u+1)*a+(u**3-2*u*u+u)*dt*v0+(-2*u**3+3*u*u)*b+(u**3-u*u)*dt*v1;
}
function orbitPose(i){
  const t=i/30,u=Math.max(0,(t-3)/4);
  // Three seconds of pure rotation. Latitude, physical diameter and the
  // position of both poles stay fixed while meridians cross the hemisphere.
  const lat=t<=3?26:hermite(26,40.25,0,.18,4,u);
  const lon=t<=3?-72.4+19.2*t:-14.8+(.58*u+(19.2-.58)*(1-(1-u)**8.4)/8.4)*4;
  const diam=.874*2**(2.34*smooth(u)),dx=210*(1-smooth((t-3)/2.35));
  return {lon,lat,diam,dx,t,ending:i===0||i===n-1};
}
const browser=await launch(),errors=[];
try{
  const ctx=await browser.newContext({viewport:{width,height},deviceScaleFactor:ratio,reducedMotion:'reduce'});
  const globe=await ctx.newPage(),gp=await ctx.newCDPSession(globe);
  globe.on('pageerror',e=>errors.push('orbit '+e.message));
  await globe.route(host+'v3-orbit',r=>r.fulfill({contentType:'text/html',body:stage.replace('pixelRatio:1.5','pixelRatio:2')}));
  await globe.goto(host+'v3-orbit');await globe.waitForFunction(()=>window.ready);
  await mkdir(local('frames'),{recursive:true});
  const meta=[];
  async function capture(cdp,name,i) {
    const png=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width,height,scale:ratio},optimizeForSpeed:true,fromSurface:true})).data,'base64');
    if(png.readUInt32BE(16)!==1920||png.readUInt32BE(20)!==1080)throw Error('Unexpected screen dimensions');
    await writeFile(local('frames/'+name+'-'+String(i).padStart(3,'0')+'.png'),png);
  }
  for(let i=0;i<n;i++){
    const pose=orbitPose(i),result=await globe.evaluate(x=>window.drawOrbit(x),pose);
    if(i===0){await globe.waitForTimeout(200);await globe.evaluate(x=>window.drawOrbit(x),pose);}
    meta.push({i,pose,globe:result});
    if(i<=lastGlobe&&(!proof||targets.has(i)))await capture(gp,'sphere',i);
  }
  await globe.close();
  const page=await ctx.newPage(),ap=await ctx.newCDPSession(page);
  page.on('pageerror',e=>errors.push('atlas '+e.message));
  await page.route('**/detail/scale.mjs*',async r=>{
    const js=await readFile(new URL('detail/scale.mjs',viewer),'utf8');
    const edited=js.replace("map.on('move',moving);map.on('moveend',end);map.on('resize',resize);",'')
      .replace('if(settled&&chart.press&&!chart.info','if(false&&settled&&chart.press&&!chart.info');
    await r.fulfill({contentType:'text/javascript',body:edited});
  });
  await page.route('**/viewer.mjs*',async r=>{
    const text=await readFile(new URL('viewer.mjs',viewer),'utf8');
    const edited=text.replace("Object.defineProperty(window,'tileflowWorld'","window.filmInk=t=>{time=t;draw()};Object.defineProperty(window,'tileflowWorld'")
      .replace('function desired(map,kind){','function desired(map,kind){return kind;');
    await r.fulfill({contentType:'text/javascript',body:edited});
  });
  await page.goto(host+'?z=5.25&lon=-3.55&lat=40.25');
  await page.waitForFunction(()=>{const a=window.tileflowWorld,d=a?.getState().design;return d?.quality==='exact'&&d.sheet==='peninsula'&&a.map.loaded();});
  const corners=await page.evaluate(()=>{
    const m=tileflowWorld.map;
    const pad=Math.min(110,Math.ceil(Math.min(innerWidth,innerHeight)*.13));
    return [[-pad+7,-pad+7],[innerWidth+pad-7,innerHeight+pad-7]].map(p=>m.unproject(p).toArray());
  });
  for(const row of meta.slice(firstFlat-2)){
    row.fitted=await page.evaluate(({row,pole})=>{
      const m=tileflowWorld.map,points=()=>pole.map(ll=>{const p=m.project(ll);return [p.x,p.y];});
      m.jumpTo({zoom:4.5,center:[row.pose.lon,row.pose.lat]});
      const target=Object.values(row.globe.points).map(p=>p.map(v=>v/2));
      const dist=p=>Math.hypot(p[0][0]-p[1][0],p[0][1]-p[1][1]);
      m.jumpTo({zoom:m.getZoom()+Math.log2(dist(target)/dist(points()))});
      const pp=points(),offset=[0,1].map(k=>pp.reduce((sum,p,i)=>sum+(p[k]-target[i][k])/3,0));
      m.jumpTo({center:m.unproject([innerWidth*.5+offset[0],innerHeight*.5+offset[1]])});
      return [...m.getCenter().toArray(),m.getZoom()];
    },{row,pole});
  }
  const anchor=172,landing=200/30,duration=landing-anchor/30,end=[-3.55,40.25,5.25],speed=[.58,.18,.16];
  const a=meta[anchor].fitted,prev=meta[anchor-1].fitted;
  for(const row of meta.slice(firstFlat)){
    const i=row.i,t=i/30;
    const camera=i<=anchor?row.fitted:t>=landing?end.map((v,k)=>v+(t-7)*speed[k]):
      a.map((v,k)=>hermite(v,end[k]-(7-landing)*speed[k],(v-prev[k])*30,speed[k],duration,(t-anchor/30)/duration));
    row.camera=camera;
    row.flat=await page.evaluate(async ({camera,corners,pole,t})=>{
      const m=tileflowWorld.map; m.jumpTo({center:camera.slice(0,2),zoom:camera[2]});window.filmInk(t);
      await new Promise(resolve=>{m.once('render',resolve);m.triggerRepaint()});
      const p=ll=>{const v=m.project(ll);return [2*v.x,2*v.y];};
      return {corners:corners.map(p),points:pole.map(p),stamp:tileflowWorld.getState().design.chartZoom};
    },{camera,corners,pole,t});
    if(!proof||targets.has(i))await capture(ap,'paper',i);
  }
  await page.evaluate(async()=>{
    const m=tileflowWorld.map;m.jumpTo({center:[-3.55,40.25],zoom:5.25});window.filmInk(7);
    await new Promise(resolve=>{m.once('render',resolve);m.triggerRepaint()});
  });
  const match=Buffer.from((await ap.send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width,height,scale:ratio},optimizeForSpeed:true,fromSurface:true})).data,'base64');
  await writeFile(local('match.png'),match);
  await writeFile(local('camera.json'),JSON.stringify({width,height,ratio,firstFlat,lastGlobe,frames:meta,errors},null,2));
  if(errors.length)throw Error(errors.join('; '));
  console.log('axial travel',meta[90].pose.lon-meta[0].pose.lon,'fit at reveal',meta[firstFlat].fitted,'anchor',a,'velocity',a.map((v,i)=>(v-prev[i])*30),'end',meta.at(-1).camera);
}finally{await browser.close();}
