// The far tree cards to the horizon (the horizon pass's fifth wave, DESIGN.md §1b Q11): the field's own GLSL run as script.
// Its hash and rolls are read statement by statement by their shape and held to flora.ts's `hashTuple` and
// `FastRandomGenerator`; its card (`fieldCard`, the very text the program runs, its two integer divisions and its instance
// id the only words put into script's terms) is run for every instance of level nought round a far tile and held to what
// the game's own `placeFarCards` stands in that tile, card for card (place, height, yaw, size, picture, flags, tint), so
// the hand-over changes nothing but who draws a card; the levels' squares tile the ground once each; the families' table
// walks as `RadialFamily.choose` picks; the program is the grass's text with its three lines made the field's, all or none,
// scanned as a compiler would; and the world's hand-overs are pinned.
//
// Run: node tools/swg/tests/horizonCardField.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import * as THREE from 'three';
import { CARD_ASPECT, CARD_CIRCLE, CARD_FIELD_ANCHORS, CARD_FIELD_GLSL, CARD_FIELD_TUNE, CARD_KEPT, CARD_TABLE_WIDTH, CARD_WET, CardField, CardFieldSession, cardFamilyTable, cardFieldFrom, cardFieldKeep, cardFieldLevels, cardFieldVertex, inflateCards, markExcluded, tuneCardField } from '../../../src/world/horizon/cardField.ts';
import { FAR_CARD_HANDOVER, FAR_CARD_TUNE, GRASS_FRAGMENT, GRASS_UNIFORMS, GRASS_VERTEX, writeGrassUniforms } from '../../../src/world/grass.ts';
import { FAR_CARD_DEFAULTS, TUFT_FAR, TUFT_GLOW, jitterOf, placeFarCards, placeStats, tuftBuffers, type FarSamples, type GrassSource, type GrassWorld } from '../../../src/world/grassMath.ts';
import { LEAF, PATCH, bakeHeightAt, newRingSurface, ringDistLevel, ringDrop, ringEdgeDistance, ringEdgeLevel, ringSurfaceAt, type BakeGrid } from '../../../src/world/horizon/horizonMath.ts';
import { heightsAtlas } from '../../../src/world/horizon/horizonField.ts';
import { FastRandomGenerator, RadialFamily, hashTuple, type RadialChild } from '../../../src/swg/terrain/flora.ts';
import type { RadialShaderEntry } from '../../../src/swg/terrain/radialFile.ts';
import type { FloraTiling } from '../../../src/swg/terrain/trn.ts';
import { planBake, planCards } from '../../../src/world/horizon/horizonFile.ts';
import { groundShift } from '../../../src/world/groundTiles.ts';
import { makeRingUniforms } from '../../../src/world/horizon/horizonRings.ts';
import { groundTileUniforms } from '../../../src/world/terrainTextures.ts';
import { GLSL_SCALARS, glslFunctionText, glslFunctions } from './glslRun.ts';
import { glslVariant, redeclared, reservedWords, unbalanced, undefinedCalls, uniformNames } from './glslScan.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const norm = (s: string) => s.replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- the hash and the rolls, read by their shape
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
const bitsOf = (x: number): number => {
  f32[0] = x;
  return u32[0];
};
const floatOf = (b: number): number => {
  u32[0] = b >>> 0;
  return f32[0];
};
function fieldHash(src: string) {
  const m = /uint fieldMix\( uint k \) \{([\s\S]*?)\n\}/.exec(src);
  if (!m) throw new Error('no fieldMix');
  const steps: ((k: number) => number)[] = [];
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line === 'return k;') continue;
    const add = /^k \+= k << (\d+)u;$/.exec(line);
    const xs = /^k \^= k >> (\d+)u;$/.exec(line);
    if (add) {
      const s = Number(add[1]);
      steps.push((k) => (k + ((k << s) >>> 0)) >>> 0);
    } else if (xs) {
      const s = Number(xs[1]);
      steps.push((k) => (k ^ (k >>> s)) >>> 0);
    } else throw new Error(`fieldMix: a statement of no known shape: ${line}`);
  }
  const mix = (k0: number) => steps.reduce((k, f) => f(k), k0 >>> 0);
  const so = /return fieldMix\( fieldMix\( floatBitsToUint\( x \) \) \^ fieldMix\( floatBitsToUint\( z \) \^ (0x[0-9a-fA-F]+)u \) \);/.exec(src);
  if (!so) throw new Error('no fieldSeedOf of the known shape');
  const zx = Number(so[1]);
  const seedOf = (x: number, z: number) => mix((mix(bitsOf(x)) ^ mix((bitsOf(z) ^ zx) >>> 0)) >>> 0);
  const sd = /int ps = int\( h & (0x[0-9a-fA-F]+)u \);\s*gFieldI = ps == 0 \? (\d+) : ps;/.exec(src);
  const rr = /int k = gFieldI \/ (\d+);\s*gFieldI = (\d+) \* \( gFieldI - k \* (\d+) \) - (\d+) \* k;\s*if \( gFieldI < 0 \) gFieldI \+= (\d+);\s*return uintBitsToFloat\( \( uint\( gFieldI \) >> (\d+)u \) \| (0x[0-9a-fA-F]+)u \) - 1\.0;/.exec(src);
  if (!sd || !rr) throw new Error('no fieldSeed or fieldRandom of the known shape');
  const st = { i: 0 };
  const seed = (h: number) => {
    const ps = (h & Number(sd[1])) >>> 0;
    st.i = ps === 0 ? Number(sd[2]) : ps;
  };
  const random = () => {
    const k = Math.trunc(st.i / Number(rr[1]));
    st.i = Number(rr[2]) * (st.i - k * Number(rr[3])) - Number(rr[4]) * k;
    if (st.i < 0) st.i += Number(rr[5]);
    return floatOf(((st.i >>> Number(rr[6])) | Number(rr[7])) >>> 0) - 1;
  };
  return { seedOf, seed, random };
}
const H = fieldHash(CARD_FIELD_GLSL);
{
  let bad = 0;
  let s = 7;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let n = 0; n < 20000; n++) {
    const tile = [24, 30, 32, 42, 48][n % 5];
    const tx = Math.floor((rnd() * 2 - 1) * 1200);
    const tz = Math.floor((rnd() * 2 - 1) * 1200);
    const h = H.seedOf(tx * tile, tz * tile);
    if (h !== hashTuple(tx * tile, tz * tile)) bad++;
    H.seed(h);
    const g = new FastRandomGenerator(hashTuple(tx * tile, tz * tile));
    for (let k = 0; k < 6; k++) if (H.random() !== g.randomFloat()) bad++;
  }
  ok(bad === 0, "the field's hash and rolls are flora.ts's hashTuple and FastRandomGenerator over 20,000 far tiles, every roll to the bit");
}

// ---------------------------------------------------------------- a world of the field's own: its lattice, its families
const centre = { x: 1001, z: -517 };
const shift = groundShift(centre.x, centre.z);
const plan = planBake(4000, centre);
const L = planCards(plan.fine, centre);
ok(L.step === 16 && ((centre.x - L.x0 - shift.x) % 16 + 16) % 16 === 0 && ((L.z0 - centre.z - shift.z) % 16 + 16) % 16 === 0, "the cards' lattice stands on the far grids' own (game x = shift.x + 16 i, as a far tile's samples)");
const rgba = new Uint8Array(L.nx * L.nz * 4);
for (let j = 0; j < L.nz; j++)
  for (let i = 0; i < L.nx; i++) {
    const o = (j * L.nx + i) * 4;
    const h = hashTuple(i * 3.5, j * 7.25);
    rgba[o] = h & 255;
    rgba[o + 1] = (h >>> 8) & 255;
    rgba[o + 2] = (h >>> 16) & 255;
    rgba[o + 3] = (h >>> 24) % 5; // families 0 (none) to 4 (no children)
  }
const child = (shader: string, weight: number, minW: number, maxW: number, minH: number, maxH: number, aspect: boolean): RadialChild => ({ familyId: 0, shader, weight, distance: 10, minWidth: minW, maxWidth: maxW, minHeight: minH, maxHeight: maxH, maintainAspect: aspect, shouldSway: false, displacement: 0, period: 1, alignToTerrain: false, createPlus: false });
const families = new Map<number, RadialFamily>();
const fam = (id: number, kids: RadialChild[]) => {
  const f = new RadialFamily(id);
  for (const k of kids) f.children.push(k);
  families.set(id, f);
};
fam(1, [child('a', 1, 4.5, 8.25, 6, 12.5, false), child('b', 2, 3, 3.5, 9, 18, true), child('c', 3, 10, 14, 20, 28, false)]);
fam(2, [child('d', 5, 6, 6, 8, 16, false), child('gone', 1, 2, 4, 2, 4, false)]);
fam(3, [child('e', 1, 12, 16, 24, 32, true)]);
fam(4, []);
const entry = (layer: number, alphaRef: number, kind: RadialShaderEntry['kind']): RadialShaderEntry => ({ layer, near: false, far: true, alphaRef, kind, width: 256, height: 256 });
const shaders = new Map<string, RadialShaderEntry>([['a', entry(3, 96, 'plain')], ['b', entry(5, 128, 'glow')], ['c', entry(7, 64, 'fade')], ['d', entry(1, 200, 'plain')], ['e', entry(2, 32, 'plain')]]);
const world: GrassWorld = { group: { families } as unknown as GrassWorld['group'], shaders, keyOf: (c) => c.shader };
const tiling: FloraTiling = { minimumDistance: 0, maximumDistance: 600, tileSize: 32, tileBorder: 6, seed: 0 };
const jitter = jitterOf(tiling, null, FAR_CARD_DEFAULTS.jitterMin);
const groundAt = (gx: number, gz: number) => 40 + Math.sin(gx * 0.003) * 30 + Math.cos(gz * 0.002) * 20;

// The families' table as RadialFamily.choose picks.
{
  const t = cardFamilyTable(world);
  let bad = 0;
  for (const [id, f] of families) {
    if (!f.children.length) {
      if (t.data[id * CARD_TABLE_WIDTH * 4] !== -1) bad++;
      continue;
    }
    for (let k = 0; k < 4000; k++) {
      const r = Math.fround(k / 4000 + 1 / 9001);
      let pick = 0;
      for (let c = 0; c < f.children.length; c++)
        if (r <= t.data[(id * CARD_TABLE_WIDTH + c * 2) * 4]) {
          pick = c;
          break;
        }
      if (f.children[pick] !== f.choose(r)) bad++;
    }
  }
  const b = t.data[(1 * CARD_TABLE_WIDTH + 1 * 2) * 4 + 3];
  const gone = t.data[(2 * CARD_TABLE_WIDTH + 1 * 2) * 4 + 1];
  ok(bad === 0 && t.families === 3 && t.children === 3, `the table's shares pick as RadialFamily.choose picks (16,000 rolls), a family with no child none (${t.families} families with children, at most ${t.children} children)`);
  ok(b === (TUFT_FAR | TUFT_GLOW | CARD_ASPECT) && gone === -1, "a child's flags its kind's and its aspect's, a child with no picture layer -1 (no card, never another child)");
}

// ---------------------------------------------------------------- fieldCard run as script, against placeFarCards
const tableData = cardFamilyTable(world).data;
const vec4o = (x: number, y: number, z: number, w: number) => ({ x, y, z, w });
// The bake's two lattices over the fixture's ground (raw frame), and the heights atlas the program reads them from (h5's
// review round: the field stands its cards on the drawn ring's own triangles, read through the ring's own functions).
const bakeGrid = (x0: number, z0: number, step: number, nx: number, nz: number): BakeGrid => {
  const h = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = groundAt(centre.x - (x0 + i * step), z0 + j * step - centre.z);
  return { x0, z0, step, nx, nz, h };
};
const fineB = bakeGrid(-3200, -4400, 8, 701, 701);
const coarseB = bakeGrid(-12000, -13000, 64, 376, 376);
const atlas = { w: Math.max(fineB.nx, coarseB.nx), h: heightsAtlas(fineB.h, fineB.nx, fineB.nz, coarseB.h, coarseB.nx, coarseB.nz) };
const env: Record<string, unknown> = {
  ...GLSL_SCALARS,
  ivec2: (x: number, y: number) => ({ x, y }),
  vec3: (x: number, y: number, z: number) => ({ x, y, z }),
  vec4: (a: number | { x: number; y: number; z: number }, b: number, c?: number, d?: number) => (typeof a === 'object' ? vec4o(a.x, a.y, a.z, b) : vec4o(a, b, c!, d!)),
  exp2: (x: number) => 2 ** x,
  log2: Math.log2,
  texelFetch: (tex: string | { w: number; h: Float32Array }, p: { x: number; y: number }) => {
    if (typeof tex === 'object') return { r: tex.h[p.y * tex.w + p.x] };
    if (tex === 'cards') {
      const o = (p.y * L.nx + p.x) * 4;
      const r = rgba[o] / 255;
      const g = rgba[o + 1] / 255;
      const b = rgba[o + 2] / 255;
      return { x: r, y: g, z: b, w: rgba[o + 3] / 255, a: rgba[o + 3] / 255, rgb: { x: r, y: g, z: b } };
    }
    const o = (p.y * CARD_TABLE_WIDTH + p.x) * 4;
    return vec4o(tableData[o], tableData[o + 1], tableData[o + 2], tableData[o + 3]);
  },
  uFieldCards: 'cards',
  uFieldTable: 'table',
  uFieldLattice: vec4o(L.x0, L.z0, L.step, 3),
  uFieldSize: vec4o(L.nx, L.nz, tiling.tileSize, jitter),
  uFieldPlace: vec4o(128, 1, 1, 0),
  uFieldEye: vec4o(0, 0, 0, 0),
  uGroundFrame: vec4o(centre.x, centre.z, 1, 0),
  // The square far off and the levels held at nought for the hand-over's own check (level 0's 8 m triangles, the far tiles').
  uHorizonSquare: vec4o(-100000, -100000, -99000, -99000),
  uHorizonDrop: vec4o(2.5, 256, 0, 16),
  uHorizonEye: vec4o(0, 0, 0, 8000),
  uHorizonMorph: vec4o(1e9, 0.3, 1e9, 12),
  uHorizonGrid: vec4o(shift.x, shift.z, 0, 0),
  uHorizonShape: vec4o(1, 1, 0, 0),
  uHorizonShapeAt: vec4o(2, 1, 16, 0.15),
  uHorizonFine: vec4o(fineB.x0, fineB.z0, 8, 0),
  uHorizonCoarse: vec4o(coarseB.x0, coarseB.z0, 64, 3),
  uHorizonSizes: vec4o(fineB.nx, fineB.nz, coarseB.nx, coarseB.nz),
  uHorizonHeights: atlas,
  position: { z: 0 },
  IID: { v: 0 },
  fieldSeedOf: H.seedOf,
  fieldSeed: H.seed,
  fieldRandom: H.random,
};
const RING_FNS = ['ringDistLevel', 'ringLevelOf', 'ringEdgeLevel', 'bakeTap', 'bakeLerp', 'bakeCoarse', 'bakeHeight', 'ringEdgeDistance', 'ringDrop'];
const FIELD_FNS = ['fieldBase', 'fieldInFiner', 'fieldPlaceAxis', 'fieldScale', 'fieldVertex', 'fieldSurface', 'fieldLevel', 'fieldCard'];
const scriptText = [
  'vec4 aSwgTuft;\nvec4 aSwgSize;\nvec4 aSwgTint;\nvec4 aSwgSway;\nvec3 aSwgNormal;',
  // The ring's functions as the field's own text carries them (picked from the ring's, never a copy), then the field's.
  ...[...RING_FNS, ...FIELD_FNS].map((n) => glslFunctionText(CARD_FIELD_GLSL, n)),
  // The test's own readers of the globals (the function bodies above are the program's).
  'float outTuft( int k ) { return k == 0 ? aSwgTuft.x : k == 1 ? aSwgTuft.y : k == 2 ? aSwgTuft.z : aSwgTuft.w; }',
  'float outSize( int k ) { return k == 0 ? aSwgSize.x : k == 1 ? aSwgSize.y : k == 2 ? aSwgSize.z : aSwgSize.w; }',
  'float outTint( int k ) { return k == 0 ? aSwgTint.x : k == 1 ? aSwgTint.y : k == 2 ? aSwgTint.z : aSwgTint.w; }',
].join('\n');
// Only the integer divisions and the instance id are put into script's terms (script divides in floats; the id is the instance's).
const asScript = scriptText.replace('gl_InstanceID / nn', 'Math.trunc( IID.v / nn )').replace('kI / n;', 'Math.trunc( kI / n );').replaceAll('gl_InstanceID', 'IID.v');
ok(asScript.includes('Math.trunc( IID.v / nn )') && asScript.includes('Math.trunc( kI / n );'), "fieldCard's two integer divisions found and run as such");
const G = glslFunctions(asScript, [...FIELD_FNS, 'outTuft', 'outSize', 'outTint'], env);
// The ring's surface as the far tiles' cards stand on it (horizonMath, the CPU's own), over the same lattices.
const surf = newRingSurface();
const surfaceSet = () => {
  const sq = env.uHorizonSquare as { x: number; y: number; z: number; w: number };
  const dr = env.uHorizonDrop as { x: number; y: number; z: number };
  Object.assign(surf, { fine: fineB, coarse: coarseB, cx: centre.x, cz: centre.z, sx: shift.x, sz: shift.z, sq0: sq.x, sq1: sq.y, sq2: sq.z, sq3: sq.w, drop: dr.x, fade: dr.y, everywhere: dr.z });
};
surfaceSet();
{
  // A far tile of the game's own, and the field's level nought round it.
  const ox = 512 * 2 + shift.x;
  const oz = 512 * -3 + shift.z;
  const step = 16;
  const n = 32 + 3;
  const gx0 = ox - step;
  const gz0 = oz - step;
  const heights = new Float32Array(n * n);
  const colors = new Uint8Array(n * n * 3);
  const radialFar = new Uint8Array(n * n * 2);
  for (let k = 0; k < n; k++)
    for (let i = 0; i < n; i++) {
      const rx = centre.x - (gx0 + i * step);
      const rz = centre.z + (gz0 + k * step);
      const li = (rx - L.x0) / step;
      const lk = (rz - L.z0) / step;
      assert.ok(Number.isInteger(li) && Number.isInteger(lk), 'a far tile sample stands on the cards lattice');
      const o = (lk * L.nx + li) * 4;
      const s = k * n + i;
      colors[s * 3] = rgba[o];
      colors[s * 3 + 1] = rgba[o + 1];
      colors[s * 3 + 2] = rgba[o + 2];
      radialFar[s * 2] = rgba[o + 3];
    }
  // The far tile's cards on the ring's own level-0 surface (W2), as the game hands them `HorizonField.surfaceAt`.
  const samples: FarSamples = { heights, colors, radialFar, n, step, gx0, gz0, surfaceAt: (gx, gz) => ringSurfaceAt(surf, gx, gz) };
  const src: GrassSource = { radialPoleIfCached: () => false, waterAt: () => -Infinity, toSwgX: (gx) => centre.x - gx, toSwgZ: (gz) => centre.z + gz, toGameX: (x) => centre.x - x, toGameZ: (z) => z - centre.z };
  const out = tuftBuffers(4096);
  placeFarCards(src, world, tiling, ox, oz, 512, samples, 0, () => [], { ...FAR_CARD_DEFAULTS, water: 'keep' }, out, placeStats(), null);
  const eye = env.uFieldEye as { x: number; y: number };
  eye.x = centre.x - (ox + 256);
  eye.y = centre.z + (oz + 256);
  const field: number[][] = [];
  for (let id = 0; id < 128 * 128; id++) {
    (env.IID as { v: number }).v = id;
    if (!G.fieldCard()) continue;
    const gx = G.outTuft(0);
    const gz = G.outTuft(2);
    if (gx < ox || gx >= ox + 512 || gz < oz || gz >= oz + 512) continue;
    field.push([gx, G.outTuft(1), gz, G.outTuft(3), G.outSize(0), G.outSize(1), G.outSize(2), G.outSize(3), G.outTint(0), G.outTint(1), G.outTint(2), G.outTint(3)]);
  }
  let matched = 0;
  let worst = 0;
  for (let c = 0; c < out.count; c++) {
    const a = c * 4;
    // The game's buffers are float32: the field's own numbers stood in them as the card stands them.
    const f = field.find((q) => Math.fround(q[0]) === out.tuft[a] && Math.fround(q[2]) === out.tuft[a + 2]);
    if (!f) continue;
    const want = [out.tuft[a], out.tuft[a + 1], out.tuft[a + 2], out.tuft[a + 3], out.size[a], out.size[a + 1], out.size[a + 2], out.size[a + 3], out.tint[a], out.tint[a + 1], out.tint[a + 2], out.tint[a + 3]];
    let d = 0;
    for (let k = 0; k < 12; k++) d = Math.max(d, Math.abs(Math.fround(f[k]) - want[k]));
    worst = Math.max(worst, d);
    if (d < 1e-5) matched++;
  }
  ok(out.count > 50 && field.length === out.count && matched === out.count, `fieldCard stands every card a far tile's placeFarCards stands in its tile and no other (${out.count} cards, ${matched} alike to ${worst.toExponential(1)} in place, height, yaw, size, picture, flags and tint)`);

  const sq = env.uHorizonSquare as { x: number; y: number; z: number; w: number };
  const sqWas = { ...sq };
  const inTile = (gx: number, gz: number) => gx >= ox && gx < ox + 512 && gz >= oz && gz < oz + 512;
  // h5's review round: the near ground's square is never the field's (its cards there are the far tiles', hidden over the
  // trees shown, lifted over the trees hidden): a square over the tile's west half stands no field card in it.
  {
    Object.assign(sq, { x: ox - 1000, y: oz - 1000, z: ox + 256, w: oz + 1000 });
    const west = field.filter((q) => q[0] < ox + 256).length;
    let inside = 0;
    let outside = 0;
    for (let id = 0; id < 128 * 128; id++) {
      (env.IID as { v: number }).v = id;
      if (!G.fieldCard()) continue;
      const gx = G.outTuft(0);
      const gz = G.outTuft(2);
      if (!inTile(gx, gz)) continue;
      if (gx > sq.x && gx < sq.z && gz > sq.y && gz < sq.w) inside++;
      else outside++;
    }
    ok(west > 20 && inside === 0 && outside === field.length - west, `no field card inside the near square (${west} of the tile's ${field.length} stood there before it came, none now; the ${outside} outside as they were)`);
    Object.assign(sq, sqWas);
  }
  // h5's review round: a card stands on the ring as it is drawn there, its level's own triangles (horizonMath's
  // `ringSurfaceAt` at the level's step, never the bake's bilinear): levels made coarse fast round the eye (lod0 150 m), the
  // square far off, the edge's level never the lesser.
  {
    const eyeG = env.uHorizonEye as { x: number; y: number; z: number; w: number };
    const morph = env.uHorizonMorph as { x: number; y: number; z: number; w: number };
    const eWas = { ...eyeG };
    const mWas = { ...morph };
    Object.assign(eyeG, { x: ox + 256, y: 60, z: oz + 256 });
    Object.assign(morph, { x: 150, y: 0.3, z: 64, w: 12 });
    // A near square to the north-west, so the edge's level is the lesser beside it.
    Object.assign(sq, { x: ox - 600, y: oz - 600, z: ox + 200, w: oz + 200 });
    surfaceSet();
    let n = 0;
    let off = 0;
    let bilinearOff = 0;
    let byEdge = 0;
    const levels = new Set<number>();
    for (let id = 0; id < 128 * 128; id++) {
      (env.IID as { v: number }).v = id;
      if (!G.fieldCard()) continue;
      const gx = G.outTuft(0);
      const gz = G.outTuft(2);
      const rx = centre.x - gx;
      const rz = gz + centre.z;
      const b = bakeHeightAt(fineB, coarseB, rx, rz);
      const d = Math.hypot(gx - eyeG.x, b - eyeG.y, gz - eyeG.z);
      const edge = ringEdgeDistance(gx, gz, sq.x, sq.y, sq.z, sq.w);
      const byD = ringDistLevel(d, morph.x, morph.y);
      const byE = ringEdgeLevel(edge, morph.z, morph.y);
      if (Math.floor(byE) < Math.floor(byD)) byEdge++;
      const lv = Math.floor(Math.min(Math.max(Math.min(Math.min(byD, byE), morph.w), 0), 24));
      levels.add(lv);
      const want = ringSurfaceAt(surf, gx, gz, (LEAF / PATCH) * 2 ** lv);
      off = Math.max(off, Math.abs(G.outTuft(1) - want));
      if (Math.abs(want - (b - ringDrop(edge, 2.5, 256, 0))) > 0.05) bilinearOff++;
      n++;
    }
    ok(n > 500 && off < 1e-6 && levels.size >= 3 && Math.max(...levels) >= 3 && byEdge > 20, `every card stands on its ring level's own triangle, the level the vertex stage draws there (${n} cards over levels ${[...levels].sort((a, b) => a - b).join(', ')}, ${byEdge} of them at the edge's lesser level, off by ${off.toExponential(1)} m)`);
    ok(bilinearOff > 50, `and not on the bake's bilinear, which ${bilinearOff} of them would have stood on by more than 5 cm`);
    Object.assign(eyeG, eWas);
    Object.assign(morph, mWas);
    Object.assign(sq, sqWas);
    surfaceSet();
  }
}

// ---------------------------------------------------------------- the levels' squares, each place one level's
{
  let twice = 0;
  let none = 0;
  const cells = 128;
  const tile = 32;
  let s = 3;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let k = 0; k < 4000; k++) {
    const ex = (rnd() * 2 - 1) * 9000;
    const ez = (rnd() * 2 - 1) * 9000;
    // Inside the coarsest square wherever the eye stands in its snapped cell: half its side less two of its cells.
    const half = (cells / 2) * tile * 8 - 2 * tile * 8;
    const px = ex + (rnd() * 2 - 1) * half;
    const pz = ez + (rnd() * 2 - 1) * half;
    let claims = 0;
    for (let b = 0; b < 4; b++) {
      const cell = tile * 2 ** b;
      const ix = Math.floor(px / cell);
      const iz = Math.floor(pz / cell);
      const bx = G.fieldBase(ex, cell, cells);
      const bz = G.fieldBase(ez, cell, cells);
      if (ix < bx || ix >= bx + cells || iz < bz || iz >= bz + cells) continue;
      if (b > 0 && G.fieldInFiner(ix, iz, cell, ex, ez, cells)) continue;
      claims++;
    }
    if (claims > 1) twice++;
    if (claims === 0) none++;
  }
  ok(twice === 0 && none === 0, `every place within the coarsest square is one level's cell exactly (4,000 places, ${twice} twice, ${none} none): no card drawn twice, no gap between levels`);
  ok(G.fieldScale(500, 600, 8000, 1200) === 0 && G.fieldScale(700, 600, 8000, 1200) === 1 && G.fieldScale(8000, 600, 8000, 1200) === 0 && Math.abs(G.fieldScale(7400, 600, 8000, 1200) - 0.5) < 1e-12, 'none before the hand-over, whole to the end\'s band, shrinking across it');
  ok(cardFieldFrom(600, cardFieldKeep(2, 512, 6, 64)) === 600 && cardFieldFrom(1500, cardFieldKeep(2, 512, 6, 64)) === 1024 && cardFieldLevels(16000, 128, 24, 6) === 5 && cardFieldLevels(1000, 128, 24, 6) === 1, 'the hand-over never past the far grids the rings keep; enough levels to reach the reach');
  // h5's review round: what the hand-over keeps for the far tiles holds the whole near square (the selection's own square,
  // the chunks' and one more, the ground's shift with it) wherever the eye stands in its chunk, at every Ground detail radius.
  let short = 0;
  let s2 = 11;
  const rnd2 = () => ((s2 = (s2 * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let k = 0; k < 4000; k++) {
    const r = 3 + Math.floor(rnd2() * 7);
    const sx = rnd2() * 2;
    const sz = rnd2() * 2;
    const ex = (rnd2() - 0.5) * 20000;
    const ez = (rnd2() - 0.5) * 20000;
    const pcx = Math.floor(ex / 64);
    const pcz = Math.floor(ez / 64);
    const x0 = (pcx - r - 1) * LEAF + sx;
    const z0 = (pcz - r - 1) * LEAF + sz;
    const x1 = (pcx + r + 2) * LEAF + sx;
    const z1 = (pcz + r + 2) * LEAF + sz;
    const far = Math.hypot(Math.max(Math.abs(ex - x0), Math.abs(ex - x1)), Math.max(Math.abs(ez - z0), Math.abs(ez - z1)));
    if (far > cardFieldKeep(1, 512, r, 64)) short++;
  }
  ok(short === 0 && cardFieldKeep(1, 512, 9, 64) > 512 && cardFieldKeep(2, 512, 9, 64) === 1024, `the far tiles' cards are kept over the whole near square, never handed to the field there (4,000 eyes, radii 3 to 9: ${short} short; ${cardFieldKeep(1, 512, 9, 64)} m at radius 9 on one far grid)`);
}

// ---------------------------------------------------------------- the program: the grass's text made the field's, all or none
{
  for (const a of Object.values(CARD_FIELD_ANCHORS)) ok(GRASS_VERTEX.split(a).length === 2, `the grass's line is there exactly once: ${a.split('\n')[0].trim()}`);
  const v = cardFieldVertex(GRASS_VERTEX);
  ok(!v.includes('attribute vec4 aSwgTuft') && v.includes('if ( !fieldCard() ) {') && v.includes('swgScale = fieldScale( swgDist, uFieldEye.z, uFieldEye.w, uFieldFade.x );') && v.indexOf('if ( !fieldCard() )') < v.indexOf('int swgFlags'), "the attributes out, the card made first in main, the far reach the field's");
  let threw = false;
  try {
    cardFieldVertex(GRASS_VERTEX.replace(CARD_FIELD_ANCHORS.scale, 'swgScale = 1.0;'));
  } catch {
    threw = true;
  }
  ok(threw, 'a grass text whose line has moved throws: nothing of the field is made');
  const resolve = (s: string): string => s.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_m, name: string) => resolve((THREE.ShaderChunk as unknown as Record<string, string>)[name]));
  for (const defs of [new Set<string>(), new Set(['USE_FOG', 'FOG_EXP2'])]) ok(redeclared(glslVariant(resolve(v), defs)).length === 0, `no name declared twice in one scope${defs.size ? ' with fog' : ''}`);
  const grassCalls = new Set(undefinedCalls(resolve(GRASS_VERTEX)));
  const own = undefinedCalls(resolve(v)).filter((c) => !grassCalls.has(c));
  ok(own.length === 0 && reservedWords(v).length === 0 && !unbalanced(v), `the field calls nothing it does not define beyond what the grass's own text does (${own.join(', ') || 'none'}), no reserved word, brackets balanced`);
  const session = new CardFieldSession(makeRingUniforms(), groundTileUniforms());
  const u = session.material.uniforms;
  const declared = uniformNames(`${v}\n${GRASS_FRAGMENT}`);
  const three = new Set(['cameraPosition', 'viewMatrix', 'projectionMatrix', 'modelMatrix', 'modelViewMatrix', 'normalMatrix', 'isOrthographic', 'logDepthBufFC', 'toneMappingExposure']);
  const lacking = declared.filter((n) => !(n in u) && !three.has(n));
  ok(lacking.length === 0, `every uniform the field's program declares is the material's (${lacking.join(', ') || 'none lacking'})`);
  ok(u.uFieldEye === session.uniforms.uFieldEye && session.mesh.frustumCulled === false && !session.mesh.castShadow && session.material.userData.unlit === true,"the field's own uniforms by reference, never culled or cast, unlit as the grass");
  const ring = makeRingUniforms();
  const s2 = new CardFieldSession(ring, groundTileUniforms());
  ok(s2.material.uniforms.uHorizonHeights === ring.uHorizonHeights && s2.material.uniforms.uHorizonFine === ring.uHorizonFine, "the ring's heights and lattices by reference: a world's bake is the field's the moment it is the ring's");
}

// ---------------------------------------------------------------- the world's field: excluded samples, the file, the knobs
{
  const copy = Uint8Array.from(rgba);
  const ex = markExcluded(copy, L, (rx) => (rx < L.x0 + 100 * L.step ? CARD_CIRCLE : CARD_KEPT), world);
  let left = 0;
  for (let j = 0; j < L.nz; j++) for (let i = 0; i < 100; i++) if (copy[(j * L.nx + i) * 4 + 3]) left++;
  ok(ex.dropped > 0 && left === 0 && ex.wet === 0, `a sample in a circle has its family taken out (${ex.dropped} taken out)`);
  // h5's review round: under the drawn water a sample keeps only its children meant for water (`placeFarCards`' own rule):
  // its family's wet row stands those and no other, a family with none is taken out, and a dry sample keeps its own row.
  {
    const wf = new Map<number, RadialFamily>();
    const add = (id: number, kids: RadialChild[]) => {
      const f = new RadialFamily(id);
      for (const k of kids) f.children.push(k);
      wf.set(id, f);
    };
    add(1, [child('reed_land', 3, 1, 2, 1, 2, false), child('swmp_reeds_a', 1, 2, 3, 2, 3, false)]);
    add(2, [child('fern', 1, 1, 2, 1, 2, false)]);
    const wsh = new Map<string, RadialShaderEntry>([['reed_land', entry(4, 90, 'plain')], ['swmp_reeds_a', entry(6, 90, 'plain')], ['fern', entry(8, 90, 'plain')]]);
    const ww: GrassWorld = { group: { families: wf } as unknown as GrassWorld['group'], shaders: wsh, keyOf: (c) => c.shader };
    const lat = { x0: 0, z0: 0, step: 16, nx: 4, nz: 1 };
    const px = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 2]);
    // The first and third samples dry, the second and fourth under the water.
    const m = markExcluded(px, lat, (rx) => (rx === 16 || rx === 48 ? CARD_WET : CARD_KEPT), ww);
    const row = px[7];
    const t = cardFamilyTable(ww, m.wetRows).data;
    const layer = (r: number, c: number) => t[(r * CARD_TABLE_WIDTH + c * 2) * 4 + 1];
    const share = (r: number, c: number) => t[(r * CARD_TABLE_WIDTH + c * 2) * 4];
    ok(px[3] === 1 && px[11] === 2 && row !== 0 && row !== 1 && row !== 2 && px[15] === 0 && m.wet === 1 && m.dropped === 1 && m.wetRows.get(row) === 1, `a sample under water moves to its family's wet row (${row}), one of no family meant for water is taken out, the dry ones keep theirs`);
    ok(layer(row, 0) === -1 && layer(row, 1) === 6 && layer(1, 0) === 4 && layer(1, 1) === 6 && share(row, 0) === share(1, 0) && share(row, 1) === share(1, 1), "the wet row stands the reeds and nothing else, at the family's own shares (a child not meant for water: no card, never another)");
  }
  const cf = new CardField(Uint8Array.from(rgba), L, world, null);
  ok(cf.cards.image.width === L.nx && cf.table.image.width === CARD_TABLE_WIDTH && cf.megabytes() > 0, "the world's field: its cards and its table as textures, megabytes by the formats' arithmetic");
  cf.dispose();
  const back = await inflateCards(new Uint8Array(deflateSync(rgba)));
  ok(back.length === rgba.length && back.every((b, i) => b === rgba[i]), "the cards' section inflates in the browser's own way to the bytes the converter deflated");
  const was = { ...CARD_FIELD_TUNE };
  tuneCardField({ cells: 130, grow: 9, levelsMost: 0 });
  ok(CARD_FIELD_TUNE.cells === 132 && CARD_FIELD_TUNE.grow === 2 && CARD_FIELD_TUNE.levelsMost === 1, 'the knobs held to their ranges, the cells to a multiple of four');
  Object.assign(CARD_FIELD_TUNE, was);
  ok(CARD_FIELD_TUNE.on === false, 'the field starts off (§1b Q11: off until its cost is known)');
  // The far cards' hand-over, through the grass's own uniform writer: off, the far cards' reach and band as ever; on, out to
  // the field's start with no band (the field draws the rest); off again, back as they were.
  const g = GRASS_UNIFORMS.uSwgGrassReach.value;
  writeGrassUniforms(null);
  const plain = [g.z, g.w];
  FAR_CARD_HANDOVER.on = true;
  FAR_CARD_HANDOVER.keep = 300;
  writeGrassUniforms(null);
  const handed = [g.z, g.w];
  FAR_CARD_HANDOVER.on = false;
  writeGrassUniforms(null);
  ok(plain[0] === (FAR_CARD_TUNE.reach ?? 500) && Math.abs(plain[1] - FAR_CARD_TUNE.fadeBand) < 1e-6 && Math.abs(handed[0] - Math.min(plain[0], 300)) < 1e-6 && Math.abs(handed[1] - 1e-4) < 1e-9 && g.z === plain[0] && g.w === plain[1], `the far cards hand over at the field's start with no band (${handed.map((x) => +x.toFixed(4)).join(', ')}) and come back as they were (${plain.join(', ')})`);
  // h5's review round: the hand-over follows the far reach moved in play (the Far tree card distance, a console hold),
  // worked out by the grass's writer at every write, never kept from the field's making.
  const heldReach = FAR_CARD_TUNE.reach;
  FAR_CARD_HANDOVER.on = true;
  FAR_CARD_HANDOVER.keep = 1024;
  FAR_CARD_TUNE.reach = 800;
  writeGrassUniforms(null);
  const at800 = [FAR_CARD_HANDOVER.from, g.z];
  FAR_CARD_TUNE.reach = 600;
  writeGrassUniforms(null);
  const at600 = [FAR_CARD_HANDOVER.from, g.z];
  FAR_CARD_TUNE.reach = 1500;
  writeGrassUniforms(null);
  const at1500 = [FAR_CARD_HANDOVER.from, g.z];
  FAR_CARD_TUNE.reach = heldReach;
  FAR_CARD_HANDOVER.on = false;
  writeGrassUniforms(null);
  ok(at800[0] === 800 && at800[1] === 800 && at600[0] === 600 && at600[1] === 600 && at1500[0] === 1024 && at1500[1] === 1024, `the field's start and the far tiles' cut follow the far reach (800, 600 and 1,500 m: ${at800[0]}, ${at600[0]}, ${at1500[0]}), never kept from the making`);
}

// ---------------------------------------------------------------- the world's and the game's hand-overs (they cannot load in node)
{
  const w = norm(readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8'));
  const m = norm(readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8'));
  const set = norm(readFileSync(new URL('../../../src/core/settings.ts', import.meta.url), 'utf8'));
  ok(w.includes('if (CARD_FIELD_TUNE.on && this.horizonDrawn) {\n              await this.loadCardField();'), "an arrival makes the field after the bake and the radial flora are joined, behind its screen");
  ok(w.includes('// The far tree cards\' field goes with the bake it stands on (the fifth wave).\n    this.dropCardField();'), 'the field goes with the bake');
  ok(w.includes('if (this.cardField && this.cardSession) this.stepCardField(this.cardSession, field);'), 'a drawn frame steps the field after the rings');
  ok(w.includes('FAR_CARD_HANDOVER.on = true;\n    FAR_CARD_HANDOVER.keep = cardFieldKeep(HORIZON_TUNE.farGridRadius, FAR_TILE, this.viewRadius, CHUNK_SIZE);\n    writeGrassUniforms(setup);'), "the far tiles' cards handed over at the field's own start, kept over the near square");
  ok(w.includes('const keep = cardFieldKeep(HORIZON_TUNE.farGridRadius, FAR_TILE, this.viewRadius, CHUNK_SIZE);\n    if (FAR_CARD_HANDOVER.keep !== keep) {\n      FAR_CARD_HANDOVER.keep = keep;\n      writeGrassUniforms(this.grassWorld);\n    }\n    a.from = FAR_CARD_HANDOVER.from;'), 'a frame moves what the hand-over keeps when the Ground detail radius or the far grids\' radius moved, and reads the start the writer worked out');
  ok(w.includes("const dropWater = FAR_CARD_TUNE.water === 'drop';") && w.includes('return g === g && swg.waterAt(gx, gz) > g ? CARD_WET : CARD_KEPT;') && w.includes('return CARD_CIRCLE;'), "the field's samples are judged by the far tiles' own tests: a circle out, the water only while the far cards drop what stands there");
  ok(m.includes('if (CARD_FIELD_TUNE.on && this.world.horizonDrawn) await this.world.loadCardField();') && m.includes("await this.groundCurtain('the far tree cards', async () => {"), 'in play the field is made behind a curtain, never on a frame');
  ok(m.includes('CARD_FIELD_TUNE.on = S.farCardsHorizon;') && /farCardsHorizon: false,/.test(set), "the Graphics page's switch, off by default");
}

console.log(`\nhorizonCardField: ${checks} checks passed`);
