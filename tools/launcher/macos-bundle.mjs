// Joins the two Mac builds into one download.
//
//   node tools/launcher/macos-bundle.mjs --arm64=<binary> --x64=<binary> --out=launcher-build
//     ->  launcher-build/swg3js-macos.tar.gz
//
// A Mac is either Apple silicon or Intel and a Node binary is built for one of them, so CI builds
// both and this puts them in a single universal binary with lipo. That leaves one file to download
// and no architecture for anyone to choose wrongly.
//
// Given only one of the two it makes a single-architecture binary instead and says so, which is what
// a local run on one machine gets.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

function run(cmd, args, what) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.error) throw new Error(`${cmd} is not on PATH, so ${what} cannot be done`);
  if (r.status !== 0) throw new Error(`${cmd} failed to ${what}`);
}

/** Double-clicking a plain Unix binary in Finder does nothing; a .command opens it in Terminal. */
const STARTER = `#!/bin/sh
# Double-click this to start swg3js. It opens the launcher in your browser; leave this window open
# while you play, and close it to stop the launcher.
cd "$(dirname "$0")" || exit 1
exec ./swg3js "$@"
`;

const README = `swg3js on macOS
===============

The quickest way, which macOS does not question, is to unpack from Terminal:

    tar -xzf swg3js-macos.tar.gz
    ./swg3js

Unpacking in Finder instead is fine, but macOS marks anything downloaded through a browser and will
refuse to run it the first time. Either strip that mark:

    xattr -dr com.apple.quarantine swg3js "Start swg3js.command"

or right-click "Start swg3js.command", choose Open, and confirm once. After that it starts normally.

The binary is signed ad-hoc, which is to say by nobody: enough to run, not enough for macOS to let it
run without being asked. It is the same program as swg3js.exe on Windows and keeps itself up to date
from the same release.
`;

function main() {
  const out = resolve(arg('out') ?? 'launcher-build');
  const slices = [['arm64', arg('arm64')], ['x64', arg('x64')]].filter(([, p]) => p).map(([a, p]) => [a, resolve(p)]);
  if (!slices.length) throw new Error('give at least one of --arm64=<binary> or --x64=<binary>');
  for (const [a, p] of slices) if (!existsSync(p)) throw new Error(`the ${a} binary is not at ${p}`);

  mkdirSync(out, { recursive: true });
  const stage = mkdtempSync(join(tmpdir(), 'swg3js-macos-'));
  const binary = join(stage, 'swg3js');

  if (slices.length === 2) {
    run('lipo', ['-create', '-output', binary, slices[0][1], slices[1][1]], 'join the two architectures');
  } else {
    copyFileSync(slices[0][1], binary);
    console.warn(`only the ${slices[0][0]} build was given, so this download runs on that alone`);
  }
  // lipo writes a fresh binary, so whatever signatures the slices carried are gone. Without one
  // macOS refuses to run it at all, and an ad-hoc signature is the most that can be given here.
  run('codesign', ['--sign', '-', '--force', binary], 'sign the joined binary ad-hoc');
  run('codesign', ['--verify', '--strict', binary], 'verify the signature it just wrote');
  chmodSync(binary, 0o755);

  const starter = join(stage, 'Start swg3js.command');
  writeFileSync(starter, STARTER);
  chmodSync(starter, 0o755);
  writeFileSync(join(stage, 'README.txt'), README);

  const archive = join(out, 'swg3js-macos.tar.gz');
  rmSync(archive, { force: true });
  // tar keeps the executable bit, which a zip made on one platform and opened on another may not.
  run('tar', ['-czf', archive, '-C', stage, 'swg3js', 'Start swg3js.command', 'README.txt'], 'make the archive');
  rmSync(stage, { recursive: true, force: true });

  const kinds = spawnSync('lipo', ['-archs', binary], { encoding: 'utf8' }).stdout?.trim();
  console.log(`built ${basename(archive)} (${(statSync(archive).size / 1048576).toFixed(1)} MB${kinds ? `, ${kinds}` : ''})`);
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
