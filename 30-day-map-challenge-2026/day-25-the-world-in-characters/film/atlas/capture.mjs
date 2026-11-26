import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {launch} from '../../scripts/qa/browser.mjs';
import {createServer, get} from 'node:http';

const dir=new URL('./',import.meta.url);
const viewer=new URL('../../public/',dir);
const base='http://127.0.0.1:8526/';
const viewport={width:1200,height:800},ratio=3,zoom=5.94,center=[1.5,39.25];
const tile=[840,450],cells=[5,7],w=tile[0]*cells[0],h=tile[1]*cells[1];
await mkdir(new URL('tiles/',dir),{recursive:true});

const enriched=process.argv.includes('--east');
const out=enriched?new URL('enhanced/',dir):dir;
let local=base,server;
if(enriched){
  await mkdir(new URL('tiles/',out),{recursive:true});
  const gazetteer=await readFile(new URL('iberia-middle.json',out));
  server=createServer((req,res)=>{
    if(new URL(req.url,base).pathname==='/detail/iberia-middle.json'){
      res.writeHead(200,{'content-type':'application/json'});res.end(gazetteer);return;
    }
    const upstream=get(new URL(req.url,base),source=>{
      res.writeHead(source.statusCode,source.headers);source.pipe(res);
    });
    upstream.on('error',()=>{res.writeHead(502);res.end();});
  });
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  local='http://127.0.0.1:'+server.address().port+'/';
}
const browser=await launch();
try {
  const page=await browser.newPage({viewport,deviceScaleFactor:ratio,reducedMotion:'reduce'});
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/detail/scale.mjs*',async route=>{
    const src=await readFile(new URL('detail/scale.mjs',viewer),'utf8');
    await route.fulfill({contentType:'text/javascript',body:src
      .replace("function styleCamera(c){","function styleCamera(c){return 'regional';")
      .replace("map.on('move',moving);map.on('moveend',end);map.on('resize',resize);","")
      .replace("if(settled&&chart.press&&!chart.info","if(false&&settled&&chart.press&&!chart.info")});
  });
  await page.route('**/detail/projector.mjs*',async route=>{
    const src=await readFile(new URL('detail/projector.mjs',viewer),'utf8');
    // Lay out the entire paper in one collision space, using the native map's
    // projected basis. Tileflow still validates loading against its real viewport.
    const edited=src.replace('const focus=[c.w/2',`const real=c; c={...c,w:${w},h:${h}}; const focus=[c.w/2`)
      .replace('const p=map.project(ll);','const p=map.project(ll);p.x+=(c.w-real.w)/2;p.y+=(c.h-real.h)/2;')
      .replace('return a;','return {...a,w:real.w,h:real.h};');
    await route.fulfill({contentType:'text/javascript',body:edited});
  });
  await page.goto(local+`?z=${zoom}&lat=${center[1]}&lon=${center[0]}`);
  await page.waitForFunction(()=>{const api=window.tileflowWorld,d=api?.getState().design;return d?.sheet==='peninsula'&&d?.status==='ready'&&d.quality==='exact'&&d.gpuMarks>5000&&api.map.loaded();},null,{timeout:60000});
  const plan=await page.evaluate(({w,h,tile,cells})=>{
    const m=tileflowWorld.map,point=ll=>{const p=m.project(ll);return [p.x+w/2-innerWidth/2,p.y+h/2-innerHeight/2];};
    const origin=point([4,44]),east=point([5,44]);
    const tiles=[];
    for(let r=0;r<cells[1];r++)for(let c=0;c<cells[0];c++){
      const x=(c+.5)*tile[0]-w/2+innerWidth/2,y=(r+.5)*tile[1]-h/2+innerHeight/2;
      tiles.push({r,c,center:m.unproject([x,y]).toArray()});
    }
    return {origin,dx:east[0]-origin[0],corners:[[-22,25],[-22,55],[25,55],[25,25]].map(point),tiles,design:structuredClone(tileflowWorld.getState().design)};
  },{w,h,tile,cells});
  const cdp=await page.context().newCDPSession(page);
  const summary={w,h,ratio,zoom,center,tile,cells,projection:'equalEarth',...plan};
  await writeFile(new URL('register.json',out),JSON.stringify(summary,null,2));
  console.log('sheet',plan.design.sheet,'marks',plan.design.gpuMarks,'origin',plan.origin,'dx',plan.dx,'bounds',plan.corners);
  for(const {c,r,center:where} of plan.tiles){
    const sample=await page.evaluate(async({where,zoom})=>{
      const m=tileflowWorld.map;
      m.jumpTo({center:where,zoom});
      await new Promise(ok=>{m.once('idle',ok);m.triggerRepaint();});
      const o=m.project([4,44]),e=m.project([5,44]);
      return {origin:[o.x,o.y],dx:e.x-o.x,requests:tileflowWorld.getState().design.stats.requests};
    },{where,zoom});
    const screenOrigin=[plan.origin[0]-c*tile[0]+(viewport.width-tile[0])/2,
      plan.origin[1]-r*tile[1]+(viewport.height-tile[1])/2];
    const err=Math.hypot(...sample.origin.map((x,i)=>x-screenOrigin[i]));
    if(err>.08||Math.abs(sample.dx-plan.dx)>.001||sample.requests!==plan.design.stats.requests)
      throw Error('Tile registration changed on '+c+','+r+' '+JSON.stringify({err,sample,screenOrigin}));
    const shot=await cdp.send('Page.captureScreenshot',{format:'png',clip:{x:(viewport.width-tile[0])/2,y:(viewport.height-tile[1])/2,width:tile[0],height:tile[1],scale:ratio},fromSurface:true,optimizeForSpeed:true});
    await writeFile(new URL('tiles/'+r+'-'+c+'.png',out),Buffer.from(shot.data,'base64'));
    console.log('tile',r,c);
  }
  if(errors.length)throw Error(errors.join('\n'));
} finally {await browser.close();server?.close();}
