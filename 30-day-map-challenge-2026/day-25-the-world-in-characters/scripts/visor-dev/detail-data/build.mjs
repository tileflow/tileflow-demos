import {build} from '../sdk/node_modules/esbuild/lib/main.js';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const here = new URL('./',import.meta.url);
const out = new URL('../../../public/detail/',here);
const checkout=process.argv[2]??process.env.TILEFLOW_SDK_CHECKOUT;
if (!checkout || execFileSync('git',['-C',checkout,'rev-parse','HEAD'],{encoding:'utf8'}).trim()!=='f6b85223e7859d80f27b13ae97ca4990406aa5b6') {
  throw new Error('Pass the Tileflow SDK checkout at f6b85223e7859d80f27b13ae97ca4990406aa5b6.');
}
// This public function has no dependencies, so a worker needs only its implementation.
const decoder=resolve(checkout,'packages/core/src/vector-tile-decode.ts');
await build({
  entryPoints:[fileURLToPath(new URL('worker-source.mjs',here))],
  plugins:[{name:'pinned-tileflow-decoder',setup(builder){
    builder.onResolve({filter:/^@tileflow\/core\/browser$/},()=>({path:decoder}));
  }}],
  outfile:fileURLToPath(new URL('worker.mjs',out)),bundle:true,minify:true,
  platform:'browser',format:'esm',target:'es2022',legalComments:'eof'
});
