import {readFile, writeFile} from 'node:fs/promises';
import {launch} from '../../scripts/qa/browser.mjs';
const here=new URL('./',import.meta.url);
const old=new URL('../', here);
const med=JSON.parse(await readFile(new URL('med/journey.json',old)));
const orbit=JSON.parse(await readFile(new URL('orbit/camera.json',old)));
const knots=[
  [0,5.25,.16],[1.7,5.55,.18],[3.6,5.84,.11],[5.9,6.00,.055],
  [6.85,6.07,.12],[7.6,6.26,.47],[8.5,6.95,1.15],[9.15,7.87,1.64],
  [9.9,9.28,2.0],[10.47,10.35,1.65],[11,11,.65]
];
function zoom(t) {
  const k=Math.min(knots.length-2,knots.findLastIndex(p=>t>=p[0]));
  const [a,za,va]=knots[k],[b,zb,vb]=knots[k+1],h=b-a,u=(t-a)/h;
  return (1+2*u)*(1-u)**2*za+u*(1-u)**2*h*va+u*u*(3-2*u)*zb+u*u*(u-1)*h*vb;
}
const poses=orbit.frames.filter(r=>r.camera).map(r=>({i:r.i,center:r.camera.slice(0,2),z:r.camera[2]}));
for(const [i,p] of med.poses.entries())poses.push({i:i+210,center:p.center,z:zoom(i/30)});
const browser=await launch();
try {
  const page=await browser.newPage({viewport:{width:960,height:540},deviceScaleFactor:2,reducedMotion:'reduce'});
  const host='http://127.0.0.1:8526/';
  await page.goto(host+'?z=11&lon=12.2525&lat=45.4475');
  await page.waitForFunction(()=>window.tileflowWorld?.getState()?.design?.quality==='exact'&&window.tileflowWorld?.map?.loaded());
  const credit=page.locator('#credit');
  const creditBox=await credit.boundingBox();
  if(!creditBox)throw Error('Street attribution is missing');
  await credit.screenshot({path:new URL('credit.png',here).pathname});
  const frames=await page.evaluate(poses=>{
    const m=tileflowWorld.map;
    const point=ll=>{const p=m.project(ll);return [2*p.x,2*p.y];};
    return poses.map(p=>{
      m.jumpTo({center:p.center,zoom:p.z});
      const origin=point([4,44]),second=point([5,44]);
      return {...p,origin,dx:second[0]-origin[0],lagoon:point([12.2525,45.4475]),madrid:point([-3.7038,40.4168])};
    });
  },poses);
  await writeFile(new URL('flight.json',here),JSON.stringify({frames,creditBox},null,2));
}finally {await browser.close();}
