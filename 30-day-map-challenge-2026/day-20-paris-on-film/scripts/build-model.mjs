import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const app = fileURLToPath(new URL('../', import.meta.url));
export function buildModel() {
  const temp = mkdtempSync(join(tmpdir(), 'paris-on-film-'));
  try {
    execFileSync(process.execPath, ['scripts/geometria.mjs', temp, 'public/datos/teselas/14'], {cwd: app, stdio: 'inherit'});
    execFileSync(process.execPath, ['scripts/maqueta.mjs', temp, 'model', 'model/trees'], {cwd: app, stdio: 'inherit'});
  } finally {
    rmSync(temp, {recursive: true, force: true});
  }
}
