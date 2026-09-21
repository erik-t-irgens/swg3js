// Builds swg3js.exe: Node's own single-executable application, with the bootstrap
// (tools/launcher/bootstrap.cjs) as its script. The exe is a copy of the Node that runs this build with
// the bootstrap injected, so the player needs nothing installed; the Node version inside is the one
// running here (CI pins it).
//
//   npm run launcher:build          ->  launcher-build/swg3js.exe
//
// Windows only: the exe is a Windows program. It is not signed, so SmartScreen warns the first time it
// is run (the README says how to get past that).

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'launcher-build');
const EXE = join(OUT, 'swg3js.exe');
const BLOB = join(OUT, 'sea-prep.blob');
const CONFIG = join(OUT, 'sea-config.json');
/** The fuse Node's single-executable support looks for (from Node's own documentation). */
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

async function main() {
  if (process.platform !== 'win32') throw new Error('swg3js.exe is built on Windows (the CI builds it on a Windows runner).');
  mkdirSync(OUT, { recursive: true });
  // The bootstrap must parse before it is sealed in.
  const check = spawnSync(process.execPath, ['--check', join(ROOT, 'tools', 'launcher', 'bootstrap.cjs')], { stdio: 'inherit' });
  if (check.status !== 0) throw new Error('the bootstrap does not parse');
  writeFileSync(CONFIG, `${JSON.stringify({ main: join(ROOT, 'tools', 'launcher', 'bootstrap.cjs'), output: BLOB, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false }, null, 2)}\n`);
  const prep = spawnSync(process.execPath, ['--experimental-sea-config', CONFIG], { stdio: 'inherit' });
  if (prep.status !== 0) throw new Error('Node did not write the preparation blob');
  copyFileSync(process.execPath, EXE);
  const { inject } = createRequire(import.meta.url)('postject');
  await inject(EXE, 'NODE_SEA_BLOB', readFileSync(BLOB), { sentinelFuse: FUSE, overwrite: true });
  console.log(`built ${EXE} (${(statSync(EXE).size / 1048576).toFixed(1)} MB, Node ${process.version})`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
