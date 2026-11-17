#!/usr/bin/env node
// The animation importer's command line:
//
//   npm run anims -- import "<folder of .fbx>" [--out public/anims/mixamo] [--quiet]
//
// Reads every FBX under the folder (never writes there) and writes the neutral clip pack the game ships. See README.md.
import { fileURLToPath } from 'node:url';
import { defaultOut, importFolder, reportLines } from './importer.mjs';

const args = process.argv.slice(2);
const command = args.shift();
const flags = new Map();
const rest = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) {
    const eq = a.indexOf('=');
    if (eq > 0) flags.set(a.slice(2, eq), a.slice(eq + 1));
    else if (a === '--out' && i + 1 < args.length) flags.set('out', args[++i]);
    else flags.set(a.slice(2), 'true');
  } else rest.push(a);
}

if (command !== 'import' || rest.length !== 1) {
  console.log('usage: npm run anims -- import "<folder of .fbx>" [--out public/anims/mixamo] [--quiet]');
  process.exit(command ? 1 : 0);
}

const out = flags.get('out') ?? defaultOut(fileURLToPath(import.meta.url));
try {
  const result = importFolder(rest[0], out, { log: flags.has('quiet') ? () => {} : (line) => console.log(line) });
  for (const line of reportLines(result, out)) console.log(line);
  if (result.failed.length || result.restDiffers.length) process.exitCode = 2;
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
