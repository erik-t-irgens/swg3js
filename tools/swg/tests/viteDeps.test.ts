// The game's Vite meets no dependency in play (the GPU port's pass 2, wave 6, maker K; the owner's Mac of 23 November): every bare
// import under `src/` (the game's modules and the space body viewer's shared ones in `src/sky/look/` and `src/sky/system/`) is named
// in `tools/dev/prebundled.mjs`, which `vite.config.ts` hands its optimiser as `optimizeDeps.include`, so a module a pull brings
// can never make three again behind a page that keeps the old copy. Node's own modules, Vite's virtual ones and type-only imports
// are not the page's and are left out. In the browser the proof is a fresh Vite with an empty dependency cache that says nothing
// of new dependencies after the page loads (the wave's maker K, `A:\swg3js\port\scratch\p2w6-makerK\`).
//
// Run: node tools/swg/tests/viteDeps.test.ts
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PREBUNDLED } from '../../dev/prebundled.mjs';

let checks = 0;
const ok = (cond: boolean, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  console.log(`ok   ${msg}`);
};
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function files(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|js|mjs)$/.test(n) && !n.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** Every bare specifier a module asks the page for: static imports and re-exports (not type-only), bare imports, dynamic imports. */
function bareOf(text: string): string[] {
  const out: string[] = [];
  const statics = /^\s*(import|export)\s+(?!type\b)([^;'"]*?\bfrom\s*)?['"]([^'"]+)['"]/gm;
  for (const m of text.matchAll(statics)) out.push(m[3]);
  for (const m of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out.filter((s) => !s.startsWith('.') && !s.startsWith('/') && !s.startsWith('node:') && !s.startsWith('virtual:'));
}

const want = new Map<string, string>();
for (const f of files(join(ROOT, 'src'))) {
  for (const s of bareOf(readFileSync(f, 'utf8'))) if (!want.has(s)) want.set(s, relative(ROOT, f));
}
ok(want.has('three') && want.has('three/webgpu') && want.has('three/addons/loaders/FBXLoader.js') && want.has('@dimforge/rapier3d-compat'), `the scan finds the page's dependencies (${want.size}, three's addons among them)`);
const missing = [...want.keys()].filter((s) => !PREBUNDLED.includes(s));
ok(missing.length === 0, `every bare import under src/ is made at the server's start${missing.length ? `; missing: ${missing.map((s) => `${s} (${want.get(s)})`).join(', ')}` : ''}`);
const stale = PREBUNDLED.filter((s: string) => !want.has(s));
ok(stale.length === 0, `and the list names nothing the game no longer imports${stale.length ? `: ${stale.join(', ')}` : ''}`);
const config = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
ok(config.includes("import { PREBUNDLED } from './tools/dev/prebundled.mjs';") && config.includes('optimizeDeps: { include: PREBUNDLED }'), "the game's Vite hands the list to its optimiser");

console.log(`\nviteDeps: ${checks} checks passed`);
