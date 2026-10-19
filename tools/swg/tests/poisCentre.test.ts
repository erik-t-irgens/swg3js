// What a travel to a place on another world trusts (the performance pass's first wave): that a world's `pois.json` is
// measured about the very centre its layout is, so a place worked out from that file before the world loads stands
// where the loaded world's own teleport would stand it. Over the packs (`SWG3JS_PACKS`, else `assets-private`; skipped
// with a note where there are none), every world carrying both files has equal centres. Only the head of each
// `layout.json` is read, since the file is tens of megabytes and its centre is its second key. Nothing of either file
// is printed but the pack's name and the two centres.
import assert from 'node:assert/strict';
import { closeSync, existsSync, openSync, readFileSync, readdirSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { centreAgrees, LOADING_TUNE } from '../../../src/world/loadingTune.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const PACKS = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private/', import.meta.url));

/** The centre at the head of a layout file, read from its first few kilobytes only. */
function layoutCentre(file: string): { x: number; z: number } | null {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(4096);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const head = buf.toString('utf8', 0, n);
    const m = /"center"\s*:\s*\{\s*"x"\s*:\s*(-?[\d.eE+-]+)\s*,\s*"z"\s*:\s*(-?[\d.eE+-]+)\s*\}/.exec(head);
    return m ? { x: Number(m[1]), z: Number(m[2]) } : null;
  } finally {
    closeSync(fd);
  }
}

if (!existsSync(PACKS)) {
  console.log(`note no packs at ${PACKS}: nothing to hold the centres to`);
} else {
  let both = 0;
  const off: string[] = [];
  for (const name of readdirSync(PACKS)) {
    const pois = join(PACKS, name, 'pois.json');
    const layout = join(PACKS, name, 'layout.json');
    if (!existsSync(pois) || !existsSync(layout)) continue;
    both++;
    const p = (JSON.parse(readFileSync(pois, 'utf8')) as { center?: { x: number; z: number } | null }).center ?? null;
    const l = layoutCentre(layout);
    if (!centreAgrees(p, l, LOADING_TUNE.centreSlack)) off.push(`${name}: pois ${JSON.stringify(p)}, layout ${JSON.stringify(l)}`);
  }
  if (!both) console.log('note no pack here carries both a pois.json and a layout.json');
  else ok(off.length === 0, `every one of the ${both} worlds with both files has its places measured about its layout's own centre${off.length ? ` (${off.join('; ')})` : ''}`);
}

console.log(`\npoisCentre: ${checks} checks passed`);
