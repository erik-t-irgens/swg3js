// Builds the launcher binary: Node's own single-executable application, with the bootstrap
// (tools/launcher/bootstrap.cjs) as its script. The binary is a copy of the Node that runs this build
// with the bootstrap injected, so the player needs nothing installed; the Node version inside is the
// one running here (CI pins it).
//
//   npm run launcher:build          ->  launcher-build/swg3js.exe      (Windows)
//                                   ->  launcher-build/swg3js          (macOS, Linux)
//
// It builds for the machine it runs on: a Mach-O binary has to be made on a Mac, a PE on Windows. CI
// runs it once per platform. Neither is signed by a developer certificate, so both are warned about
// the first time they run; tools/launcher/README.md says how to get past that on each.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'launcher-build');
/** Windows wants the extension; a Unix program is named plainly and marked executable instead. */
export const binaryName = (platform = process.platform) => (platform === 'win32' ? 'swg3js.exe' : 'swg3js');
const BIN = join(OUT, binaryName());
const BLOB = join(OUT, 'sea-prep.blob');
const CONFIG = join(OUT, 'sea-config.json');
/** The fuse Node's single-executable support looks for (from Node's own documentation). */
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
/** The Mach-O segment Node's single-executable support reads its blob from on a Mac. */
const MACHO_SEGMENT = 'NODE_SEA';

/**
 * A Mach-O binary carries a code signature that covers its contents, and injecting the blob breaks it.
 * macOS refuses to run a binary whose signature does not match, with no message worth reading, so the
 * old signature is taken off before the injection and an ad-hoc one put on after. Ad-hoc means signed
 * by nobody: enough for the binary to run at all, not enough for Gatekeeper to let it run unremarked.
 */
function codesign(args, what) {
  const r = spawnSync('codesign', args, { stdio: 'inherit' });
  if (r.error) throw new Error(`codesign is not on PATH, so ${what} cannot be done (Xcode command line tools)`);
  if (r.status !== 0) throw new Error(`codesign failed to ${what}`);
}

async function main() {
  if (!['win32', 'darwin', 'linux'].includes(process.platform)) {
    throw new Error(`the launcher binary is built on Windows, macOS or Linux, not ${process.platform}`);
  }
  mkdirSync(OUT, { recursive: true });
  // The bootstrap must parse before it is sealed in.
  const check = spawnSync(process.execPath, ['--check', join(ROOT, 'tools', 'launcher', 'bootstrap.cjs')], { stdio: 'inherit' });
  if (check.status !== 0) throw new Error('the bootstrap does not parse');

  writeFileSync(CONFIG, `${JSON.stringify({
    main: join(ROOT, 'tools', 'launcher', 'bootstrap.cjs'),
    output: BLOB,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
  }, null, 2)}\n`);
  const prep = spawnSync(process.execPath, ['--experimental-sea-config', CONFIG], { stdio: 'inherit' });
  if (prep.status !== 0) throw new Error('Node did not write the preparation blob');

  rmSync(BIN, { force: true });
  copyFileSync(process.execPath, BIN);
  if (process.platform === 'darwin') codesign(['--remove-signature', BIN], 'take the old signature off');

  const { inject } = createRequire(import.meta.url)('postject');
  await inject(BIN, 'NODE_SEA_BLOB', readFileSync(BLOB), {
    sentinelFuse: FUSE,
    overwrite: true,
    ...(process.platform === 'darwin' ? { machoSegmentName: MACHO_SEGMENT } : {}),
  });

  if (process.platform === 'darwin') codesign(['--sign', '-', BIN], 'sign the binary ad-hoc');
  if (process.platform !== 'win32') chmodSync(BIN, 0o755);

  const arch = process.platform === 'win32' ? '' : ` ${process.arch}`;
  console.log(`built ${BIN} (${(statSync(BIN).size / 1048576).toFixed(1)} MB, Node ${process.version}${arch})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
