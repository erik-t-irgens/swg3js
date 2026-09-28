// One upload range kept per attribute (src/world/uploadRange.ts). A particle batch is refilled every frame
// whether or not anything draws it, and three empties an attribute's range list only when it uploads it,
// so the weather's batches, refilled on every frame a room with no exit in sight skips drawing them, piled
// up one range object an attribute a frame through three's own `addUpdateRange`. Checked here on real
// three attributes, with three's own upload merge run over what is left, and nothing made in a frame (run
// with node --expose-gc for that one).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import v8 from 'node:v8';
import * as THREE from 'three';
import { keepUploadRange, type UploadRange } from '../../../src/world/uploadRange.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** Three's own upload (`WebGLAttributes.updateBuffer`), with the GL taken out: sort, merge in place, clear. Answers the merged ranges. */
function upload(attr: THREE.BufferAttribute): { start: number; count: number }[] {
  const r = attr.updateRanges;
  r.sort((a, b) => a.start - b.start);
  let m = 0;
  for (let i = 1; i < r.length; i++) {
    const prev = r[m];
    const cur = r[i];
    if (cur.start <= prev.start + prev.count + 1) prev.count = Math.max(prev.count, cur.start + cur.count - prev.start);
    else r[++m] = cur;
  }
  if (r.length) r.length = m + 1;
  const out = r.map((x) => ({ start: x.start, count: x.count }));
  attr.clearUpdateRanges();
  return out;
}

// ---- Refilled on frames nothing draws, the list stays one range. ----
{
  const attr = new THREE.BufferAttribute(new Float32Array(4096 * 12), 3);
  const kept: UploadRange = { start: 0, count: 0 };
  for (let f = 0; f < 10000; f++) {
    keepUploadRange(attr.updateRanges, kept, 0, ((f * 37) % 4000) * 12);
    attr.needsUpdate = true;
  }
  ok(attr.updateRanges.length === 1 && attr.updateRanges[0] === kept, 'ten thousand frames refilled with nothing drawn leave one range in the list, the kept one');
  ok(kept.start === 0 && kept.count === 3999 * 12, 'and it covers the most any of those frames wrote');
  const up = upload(attr);
  ok(up.length === 1 && up[0].start === 0 && up[0].count === 3999 * 12 && attr.updateRanges.length === 0, "three's upload takes it whole and empties the list");
  keepUploadRange(attr.updateRanges, kept, 0, 120);
  ok(attr.updateRanges.length === 1 && kept.count === 120, 'the next frame after an upload asks for only what that frame wrote');
}

// ---- Three's own way, for the record: one object a call, never emptied until drawn. ----
{
  const attr = new THREE.BufferAttribute(new Float32Array(1200), 3);
  for (let f = 0; f < 600; f++) attr.addUpdateRange(0, 120);
  ok(attr.updateRanges.length === 600, `three's addUpdateRange left ${attr.updateRanges.length} ranges after 600 undrawn frames: why the batches keep their own`);
}

// ---- A range somebody else put there is widened over, never dropped. ----
{
  const attr = new THREE.BufferAttribute(new Float32Array(1200), 3);
  const kept: UploadRange = { start: 0, count: 0 };
  attr.updateRanges.push({ start: 300, count: 60 });
  keepUploadRange(attr.updateRanges, kept, 0, 120);
  ok(attr.updateRanges.length === 1 && kept.start === 0 && kept.count === 360, "a list holding another writer's range becomes the kept one spanning both");
  keepUploadRange(attr.updateRanges, kept, 900, 30);
  ok(kept.start === 0 && kept.count === 930, 'and a later ask past it widens it again');
}

// ---- The particle batches use it, and nothing in them calls three's own. ----
{
  const src = readFileSync(new URL('../../../src/world/particles.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  ok(!/\.addUpdateRange\(/.test(src) && (src.match(/keepUploadRange\(/g) ?? []).length === 3, "particles.ts hands each of a batch's three attributes its kept range and never calls three's addUpdateRange");
}

// ---- Nothing made in a frame. ----
{
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc) {
    const attrs = [0, 1, 2].map(() => new THREE.BufferAttribute(new Float32Array(4096 * 12), 3));
    const kept: UploadRange[] = [0, 1, 2].map(() => ({ start: 0, count: 0 }));
    const frame = (f: number) => {
      for (let a = 0; a < 3; a++) keepUploadRange(attrs[a].updateRanges, kept[a], 0, ((f * 13) % 4000) * 12);
    };
    for (let f = 0; f < 20000; f++) frame(f);
    const young = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;
    gc();
    const before = young();
    for (let f = 0; f < 5000; f++) frame(f);
    const per = (young() - before) / 5000;
    ok(per < 1, `refilling three attributes a frame with nothing drawn makes no garbage (${per.toFixed(2)} bytes a frame)`);
  } else console.log('skip nothing made in a frame: run with node --expose-gc to measure');
}

console.log(`\n${checks} checks passed`);
