import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {launch} from '../../scripts/qa/browser.mjs';

const root=new URL('./',import.meta.url);
const out=name=>fileURLToPath(new URL(name,root));
const viewer=new URL('../../public/',root);
const host='http://127.0.0.1:8526/';
const plans=[
  {id:'veneto',z:7.4,center:[10.35,44.65],width:2432,height:1376},
  {id:'padova',z:9.0,center:[11.8,45.28],width:2208,height:1242},
  {id:'laguna',z:10.8,center:[12.19,45.42],width:1984,height:1120},
  {id:'endpoint',z:11,center:[12.2525,45.4475],width:960,height:540}
];
const output=[];
const browser=await launch();
try{
 for(const plan of plans){
  const {id,z,center,width,height}=plan;
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:2,reducedMotion:'reduce'});
  const cdp=await page.context().newCDPSession(page);
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/detail/scale.mjs*',async req=>{
    const src=await readFile(new URL('detail/scale.mjs',viewer),'utf8');
    const fixed=src.replace("map.on('move',moving);map.on('moveend',end);map.on('resize',resize);",'')
      .replace('if(settled&&chart.press&&!chart.info','if(false&&settled&&chart.press&&!chart.info');
    await req.fulfill({contentType:'text/javascript',body:fixed});
  });
  await page.route('**/viewer.mjs*',async req=>{
    const src=await readFile(new URL('viewer.mjs',viewer),'utf8');
    await req.fulfill({contentType:'text/javascript',body:src.replace("Object.defineProperty(window,'tileflowWorld'","window.filmInk=s=>{time=s;draw();};Object.defineProperty(window,'tileflowWorld'")});
  });
  await page.goto(host+'?z='+z+'&lat='+center[1]+'&lon='+center[0]);
  await page.addStyleTag({content:'#credit,#network,.tileflow-branding,.tileflow-branding *{visibility:hidden !important}'});
  await page.waitForFunction(z=>{
    const a=window.tileflowWorld,d=a?.getState().design;
    return d?.quality==='exact'&&d.status==='ready'&&a.map.loaded()&&Math.abs(d.chartZoom-z)<.01;
  },z,{timeout:90000});
  await page.waitForTimeout(350);
  const metadata=await page.evaluate(async()=>{
    const a=tileflowWorld,m=a.map,d=a.getState().design;
    filmInk(18);
    await new Promise(resolve=>{m.once('render',resolve);m.triggerRepaint();});
    const project=coord=>{const p=m.project(coord);return [p.x*2,p.y*2];};
    const origin=project([4,44]),east=project([5,44]);
    const cr=document.querySelector('#credit').getBoundingClientRect();
    return {origin,dx:east[0]-origin[0],projection:m.getProjection().type,
      centerPixel:project(m.getCenter()),z:m.getZoom(),bounds:m.getBounds().toArray(),
      projectedCenter:m.getCenter().toArray(),tileMissing:d.missing,tiles:d.tiles,marks:d.gpuMarks,sheet:d.sheet,
      sources:d.credit,creditBoxDevicePx:[cr.x,cr.y,cr.right,cr.bottom].map(v=>v*2),words:d.labels};
  });
  if(id==='endpoint'){
    const lockup=page.locator('#map .tileflow-branding').first();
    const rect=await lockup.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
    if(!rect)throw Error('Missing native Tileflow branding');
    const left=Math.max(0,Math.floor(rect.x-8)),top=Math.max(0,Math.floor(rect.y-8));
    const right=Math.min(width,Math.ceil(rect.x+rect.width+8)),bottom=Math.min(height,Math.ceil(rect.y+rect.height+8));
    metadata.brandBoxDevicePx=[left,top,right,bottom].map(x=>x*2);
  }
  if(errors.length)throw Error(errors.join(';'));
  if(metadata.tileMissing)throw Error('Missing data for '+id+': '+JSON.stringify(metadata.tileMissing));
  const result=await cdp.send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width,height,scale:2},fromSurface:true,optimizeForSpeed:true});
  const png=Buffer.from(result.data,'base64');
  const file=id+'.png';
  const size=[png.readUInt32BE(16),png.readUInt32BE(20)];
  if(size[0]!==width*2||size[1]!==height*2)throw Error('Unexpected bitmap size '+size);
  await writeFile(out(file),png);
  output.push({id,file,size,credit:false,...metadata});
  await writeFile(out('registration.json'),JSON.stringify(output,null,2)+'\n');
  console.log(id,size,metadata.origin,metadata.dx,metadata.tiles,metadata.tileMissing,metadata.marks);
  if(id==='endpoint'){
    const [left,top,right,bottom]=metadata.brandBoxDevicePx.map(x=>x/2);
    await page.addStyleTag({content:'html,body{background:transparent!important}body *{visibility:hidden!important}body #map .tileflow-branding,body #map .tileflow-branding *{visibility:visible!important}'});
    await cdp.send('Emulation.setDefaultBackgroundColorOverride',{color:{r:0,g:0,b:0,a:0}});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const stamp=await cdp.send('Page.captureScreenshot',{format:'png',clip:{x:left,y:top,width:right-left,height:bottom-top,scale:2},fromSurface:true});
    await writeFile(out('wordmark.png'),Buffer.from(stamp.data,'base64'));
  }
  await page.close();
 }
}finally{await browser.close();}
