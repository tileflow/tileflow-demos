import {build} from 'esbuild';
import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const dest=resolve(process.argv[2]??join(here,'../../../public/runtime'));
const checkout=process.argv[3]??process.env.TILEFLOW_SDK_CHECKOUT;
const revision='f6b85223e7859d80f27b13ae97ca4990406aa5b6';
if (!checkout) throw new Error('Pass the built Tileflow SDK checkout path as the second argument.');
if (execFileSync('git',['-C',checkout,'rev-parse','HEAD'],{encoding:'utf8'}).trim()!==revision) {
  throw new Error('Build this map with Tileflow SDK '+revision);
}
if (execFileSync('git',['-C',checkout,'status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()) {
  throw new Error('The pinned Tileflow source contains local changes.');
}
const aliases=new Map();
for (const pkg of ['core','dom','interactions']) {
  const dir=resolve(checkout,'packages',pkg);
  const json=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));
  for (const [subpath,value] of Object.entries(json.exports)) {
    if (!value.import)continue;
    const name=json.name+(subpath==='.'?'':'/'+subpath.slice(2));
    aliases.set(name,join(dir,value.import));
  }
}
const sdkPlugin={name:'fixed-tileflow-sdk',setup(builder){
  builder.onResolve({filter:/^@tileflow\//},args=>aliases.has(args.path)?{path:aliases.get(args.path)}:undefined);
  builder.onResolve({filter:/^maplibre-gl$/},()=>({path:'./renderer/maplibre-gl.mjs',external:true}));
}};
const maplibre=dirname(fileURLToPath(import.meta.resolve('maplibre-gl')));
const renderer=join(dest,'renderer');
await mkdir(renderer,{recursive:true});
await build({entryPoints:[join(here,'entry.mjs')],outfile:join(dest,'tileflow.mjs'),bundle:true,
  format:'esm',target:'es2022',platform:'browser',minify:true,legalComments:'inline',plugins:[sdkPlugin]});
for (const file of ['maplibre-gl.mjs','maplibre-gl-worker.mjs','maplibre-gl-shared.mjs','maplibre-gl.css']) {
  await copyFile(join(maplibre,file),join(renderer,file));
}
await copyFile(join(dirname(maplibre),'LICENSE.txt'),join(renderer,'LICENSE.txt'));
const notices=[];
for (const file of ['LICENSE','NOTICE','TRADEMARKS.md','packages/core/THIRD_PARTY_NOTICES.md']) {
  notices.push('Tileflow SDK / '+file+'\n\n'+await readFile(join(checkout,file),'utf8'));
}
await writeFile(join(dest,'TILEFLOW-NOTICES.txt'),notices.join('\n\n'));
