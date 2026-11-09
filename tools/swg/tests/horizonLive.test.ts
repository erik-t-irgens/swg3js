// The horizon pass's fourth wave: the edits followed live (DESIGN.md §6). The field is loaded through its own load over a
// made bake, the decode worker's own module answering behind a stand-in `Worker` and a recording renderer standing in for
// the card (as `horizonWindow.test.ts` drives it), and every frame is the field's own frame (`update`).
//
// `HeightOverlay.layRect` is `layAll` over just the rectangle (random rectangles, edits and a course), and a tile no store
// touches is put back to raw and lets its copy go. A sculpt stroke run through the real brush (`EditorSculpt`) round the
// real editing class (`editsHarness.ts`) at 30, 60 and 144 frames a second reaches the rings as it is made: after each
// stamp the card's fine heights are `fround(raw + d)` at every sample to the bit; the uploads cover every changed texel and
// nothing past a texel round the rectangles relayed; the recording renderer counts every `generateMipmap`, at most one a
// texture every `mipsEvery` while the stroke is held and one at its end; its undo puts the bake back to the bit with no raw
// copy kept. A course put in and a node dragged: laid nearest the eye a frame's share at a time, the field the course laid
// over the raw bake whole. The paint: a tile asked once however often named while its grid is on its way, once more when
// named after it came back; its albedo put up, a strip of the composition window asked, its mips made at its end. The
// shape window: a block taken again from the cache, one laid from its kept raw grid with no worker, one asked again.
// A copy of a baked world: the source's bake, the copy's own edit files by `editKeyOf`, never the source's.
// And the world's hand-overs, which node cannot load, pinned as text.
//
// Run: node tools/swg/tests/horizonLive.test.ts
import assert from 'node:assert/strict';
import { deflateRawSync, deflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GENERATOR_REVISION } from '../../../src/swg/terrain/generator.ts';
import { CourseCarve } from '../../../src/swg/terrain/courseCarve.ts';
import { HeightEdits } from '../../../src/swg/terrain/heightEdits.ts';
import { paintTileNumber } from '../../../src/swg/terrain/groundPaint.ts';
import { groundShift } from '../../../src/world/groundTiles.ts';
import { HORIZON_FORMAT, HORIZON_SECTIONS, encodeHeights, planBake, sectionSize, type HeightLattice } from '../../../src/world/horizon/horizonFile.ts';
import { HORIZON_TUNE, HoleGrid, LEAF } from '../../../src/world/horizon/horizonMath.ts';
import { HorizonField, RingSession, SHAPE_WHOLE_PAST, atlasLayout, shapeWholePast, type FieldGround, type OverlayStores, type PoleGenerate } from '../../../src/world/horizon/horizonField.ts';
import { HORIZON_TILE, HeightOverlay, samplesIn, type SampleRect } from '../../../src/world/horizon/horizonOverlay.ts';
import { RingCardDebt, horizonPaintKeys, type CardRect } from '../../../src/world/horizon/ringCardDebt.ts';
import { SHAPE_BLOCK, ShapeWindow, shapeSourceOf, type ShapeSource, type ShapeTerrain } from '../../../src/world/horizon/shapeWindow.ts';
import { EditorSculpt, type SculptHost } from '../../../src/editor/editorSculpt.ts';
import { SCULPT_TUNE } from '../../../src/editor/editorTune.ts';
import { toolFrame } from '../../../src/editor/tools.ts';
import { deltasOf, heightsFileText, readHeightsFile, tileIdOf, tileOfId, deltaBytes, type HeightTileRow } from '../../../src/world/editFiles/heightsFile.ts';
import { decodeLanded, layLanded } from '../../../src/world/editFiles/heightsLand.ts';
import { readWorldRow } from '../../../src/world/editFiles/worldsFile.ts';
import { editKeyOf, editKeyOfPack, planetOfWorld } from '../../../src/data/ourWorlds.ts';
import { PLANETS, packIdOf, type PlanetDef } from '../../../src/data/planets.ts';
import { fnv1aHeights } from '../../../src/swg/terrain/heightEdits.ts';
import { inflateTile, makeHarness } from './editsHarness.ts';
import { straight } from './carveFixtures.ts';
import { testCamera, testHole } from './horizonFixtures.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);
const same = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((v, k) => Object.is(v, b[k]));
let seed = 4404;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

// ---------------------------------------------------------------- 1. layRect is layAll over just the rectangle
{
  const lat: HeightLattice = { x0: -1504, z0: -1200, step: 8, nx: 300, nz: 260, lo: 0, q: 1 };
  const raw = new Float32Array(lat.nx * lat.nz);
  for (let j = 0; j < lat.nz; j++) for (let i = 0; i < lat.nx; i++) raw[j * lat.nx + i] = Math.fround(30 * Math.sin((lat.x0 + i * 8) / 211) + 0.07 * (lat.z0 + j * 8));
  const edits = new HeightEdits();
  for (let k = 0; k < 8; k++) {
    const d = new Float32Array(1024);
    for (let i = 0; i < d.length; i++) d[i] = Math.fround((rnd() - 0.4) * 7);
    edits.set(-22 + k * 4, -17 + (k % 3) * 4, d);
  }
  const course = new CourseCarve();
  course.set([straight('h4a', -1300, -400, -900, 20, { w: 5, sh: 6 }), straight('h4b', -1100, -500, -600, -12, { w: 3, sh: 4 })]);
  // The whole lay from raw, the authority (W2's own, held to the near ground's composition there).
  const whole = raw.slice();
  new HeightOverlay(lat).layAll(whole, edits, course);
  // Rectangle after rectangle over one copy, starting from the bake: the samples a rectangle holds are the whole lay's there.
  const o = new HeightOverlay(lat);
  const f = raw.slice();
  let off = 0;
  let outside = 0;
  let wrote = 0;
  let spanning = 0;
  let unanswered = 0;
  for (let n = 0; n < 60; n++) {
    const i0 = Math.floor(rnd() * lat.nx);
    const j0 = Math.floor(rnd() * lat.nz);
    const r: SampleRect = { i0, j0, i1: Math.min(lat.nx - 1, i0 + Math.floor(rnd() * 90)), j1: Math.min(lat.nz - 1, j0 + Math.floor(rnd() * 90)) };
    const before = f.slice();
    const got = o.layRect(f, edits, course, r);
    for (let j = 0; j < lat.nz; j++) {
      for (let i = 0; i < lat.nx; i++) {
        const k = j * lat.nx + i;
        const inR = i >= r.i0 && i <= r.i1 && j >= r.j0 && j <= r.j1;
        if (inR && !Object.is(f[k], whole[k])) off++;
        if (!inR && !Object.is(f[k], before[k])) outside++;
        // Every sample that changed is in one of the tiles answered (what the field puts on the card).
        if (!Object.is(f[k], before[k]) && !got.some((t) => i >= t.i0 && i <= t.i1 && j >= t.j0 && j <= t.j1)) unanswered++;
      }
    }
    for (const t of got) {
      wrote += (t.i1 - t.i0 + 1) * (t.j1 - t.j0 + 1);
      // A tile at a time (W4's review round): never a rectangle across two horizon tiles.
      if (Math.floor(t.i0 / HORIZON_TILE) !== Math.floor(t.i1 / HORIZON_TILE) || Math.floor(t.j0 / HORIZON_TILE) !== Math.floor(t.j1 / HORIZON_TILE)) spanning++;
    }
  }
  ok(off === 0 && outside === 0 && wrote > 0, `layRect over 60 random rectangles lays each one's samples as layAll lays them over the whole lattice (edits and two courses), to the bit, and writes nothing outside them (${wrote} samples written)`);
  ok(spanning === 0 && unanswered === 0, `and answers what it wrote a horizon tile at a time, every changed sample in a tile answered (${spanning} answers across two tiles, ${unanswered} changed and unanswered)`);
  // Every store let go, rectangles over every tile kept: the bake to the bit and no copy left.
  const o2 = new HeightOverlay(lat);
  const g = raw.slice();
  o2.layAll(g, edits, null);
  ok(o2.kept > 0, `a store laid over the bake keeps raw copies (${o2.kept} tiles)`);
  o2.layRect(g, null, null, { i0: 0, j0: 0, i1: lat.nx - 1, j1: lat.nz - 1 });
  ok(same(g, raw) && o2.kept === 0, 'the store let go and the whole lattice relaid: the bake to the bit, no raw copy kept');
  // A tile a store no longer touches, relaid over part of it only, lets its copy go once the whole tile is raw.
  const o3 = new HeightOverlay(lat);
  const h3 = raw.slice();
  const one = new HeightEdits();
  one.set(-22, -17, new Float32Array(1024).fill(2.5));
  o3.layAll(h3, one, null);
  const kept3 = o3.kept;
  const emptied = new HeightEdits();
  const r3 = samplesIn(lat, { x0: -22 * 64 - 8, z0: -17 * 64 - 8, x1: -21 * 64 + 8, z1: -16 * 64 + 8 })!;
  o3.layRect(h3, emptied, null, r3);
  ok(kept3 > 0 && o3.kept === 0 && same(h3, raw), `an undo's rectangle over the one tile a store held: the bake again and the copy let go (${kept3} kept before)`);
}

// ---------------------------------------------------------------- the field: the decode worker's own module, a recording card
type Msg = Record<string, unknown> & { type: string; id: number };
const toWorker: Msg[] = [];
const toField: unknown[] = [];
const workerSelf = {
  onmessage: null as null | ((e: { data: unknown }) => unknown),
  postMessage(m: unknown) {
    toField.push(structuredClone(m));
  },
};
(globalThis as unknown as { self: unknown }).self = workerSelf;
await import('../../../src/world/horizon/horizonDecodeWorker.ts');
const posts: Msg[] = [];
let fake: FakeWorker | null = null;
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: unknown = null;
  onmessageerror: unknown = null;
  constructor() {
    fake = this;
  }
  postMessage(m: Msg): void {
    posts.push(m);
    toWorker.push(m);
  }
  terminate(): void {}
}
(globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
async function pump(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  for (let round = 0; round < 100 && (toWorker.length || toField.length); round++) {
    while (toWorker.length) await workerSelf.onmessage!({ data: structuredClone(toWorker.shift()!) });
    while (toField.length) fake!.onmessage!({ data: toField.shift() });
    await new Promise((r) => setImmediate(r));
  }
}
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  let v!: T;
  void p.then((x) => {
    done = true;
    v = x;
  });
  for (let i = 0; i < 2000 && !done; i++) await pump();
  assert.ok(done, 'a step the field took never ended');
  return v;
}

interface Held {
  data: Uint8Array | Float32Array | Uint16Array;
  w: number;
  h: number;
  k: number;
}
const card = new Map<THREE.Texture, Held>();
/** Every region put up: the texture, where, and the clock; and every copy that made mips, with the clock. */
const regions: { dst: THREE.Texture; x: number; z: number; w: number; h: number }[] = [];
const mips: { dst: THREE.Texture; t: number }[] = [];
let clock = 0;
let outOfBounds = 0;
const renderer = {
  initTexture(t: THREE.Texture): void {
    const img = t.image as { data: Uint8Array | Float32Array | null; width: number; height: number };
    if (!img?.data) return;
    card.set(t, { data: img.data.slice(), w: img.width, h: img.height, k: img.data.length / (img.width * img.height) });
  },
  copyTextureToTexture(src: THREE.DataTexture, dst: THREE.Texture, region: THREE.Box2 | null, at: THREE.Vector2 | null): void {
    const s = src.image as unknown as { data: Uint8Array | Float32Array; width: number; height: number };
    const d = card.get(dst);
    if (!d) {
      outOfBounds++;
      return;
    }
    const k = s.data.length / (s.width * s.height);
    const x0 = region ? region.min.x : 0;
    const z0 = region ? region.min.y : 0;
    const w = region ? region.max.x - region.min.x : s.width;
    const h = region ? region.max.y - region.min.y : s.height;
    const dx = at ? at.x : 0;
    const dz = at ? at.y : 0;
    if (k !== d.k || dx < 0 || dz < 0 || dx + w > d.w || dz + h > d.h) {
      outOfBounds++;
      return;
    }
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) for (let c = 0; c < k; c++) d.data[((dz + j) * d.w + dx + i) * k + c] = s.data[((z0 + j) * s.width + x0 + i) * k + c];
    regions.push({ dst, x: dx, z: dz, w, h });
    // Three ends its copy with the whole chain made whenever the destination asks for it (`WebGLRenderer.copyTextureToTexture`).
    if (dst.generateMipmaps) mips.push({ dst, t: clock });
  },
} as unknown as THREE.WebGLRenderer;

// A made bake about an odd centre (horizonWindow's).
const centre = { x: 1269, z: -3601 };
const shift = groundShift(centre.x, centre.z);
const plan = planBake(1024, centre, { margin: 256, farMargin: 1024 });
const hRaw = (rx: number, rz: number) => 0.05 * rx - 0.03 * rz + 12 * Math.sin(rx / 97) + 8 * Math.cos(rz / 53);
const fill = (lat: { x0: number; z0: number; step: number; nx: number; nz: number }) => {
  const h = new Float32Array(lat.nx * lat.nz);
  for (let j = 0; j < lat.nz; j++) for (let i = 0; i < lat.nx; i++) h[j * lat.nx + i] = hRaw(lat.x0 + i * lat.step, lat.z0 + j * lat.step);
  return h;
};
const fe = encodeHeights(fill(plan.fine), plan.fine.nx, plan.fine.nz);
const ce = encodeHeights(fill(plan.coarse), plan.coarse.nx, plan.coarse.nz);
const famsOf = (lat: { nx: number; nz: number }) => Uint8Array.from({ length: lat.nx * lat.nz }, (_, k) => 1 + ((Math.floor((k % lat.nx) / 3) + Math.floor(Math.floor(k / lat.nx) / 4)) % 3));
const raws: Record<string, Uint8Array> = {
  heights: fe.bytes,
  families: famsOf(plan.ground),
  colour: Uint8Array.from({ length: plan.colour.nx * plan.colour.nz * 3 }, (_, k) => 40 + ((k * 37 + Math.floor(k / 7) * 11) % 200)),
  coarseHeights: ce.bytes,
  coarseFamilies: famsOf(plan.coarse),
  coarseColour: Uint8Array.from({ length: plan.coarse.nx * plan.coarse.nz * 3 }, (_, k) => 60 + ((k * 13) % 150)),
};
const header0 = {
  format: HORIZON_FORMAT,
  source: { generator: GENERATOR_REVISION, trn: { length: 1, sha1: 'x' }, inputs: 'y', centre, layers: { sha1: 'z', list: [] }, lifeDay: false, made: 'poles' },
  fine: { ...plan.fine, lo: fe.lo, q: fe.q },
  ground: plan.ground,
  colour: plan.colour,
  coarse: { ...plan.coarse, lo: ce.lo, q: ce.q },
};
const parts: Uint8Array[] = [];
const sections: { name: (typeof HORIZON_SECTIONS)[number]; offset: number; length: number; size: number }[] = [];
let at = 0;
for (const name of HORIZON_SECTIONS) {
  const z = new Uint8Array(deflateSync(raws[name]));
  sections.push({ name, offset: at, length: z.length, size: sectionSize(header0 as never, name) });
  parts.push(z);
  at += z.length;
}
const binAll = new Uint8Array(at);
for (let k = 0, o = 0; k < parts.length; o += parts[k].length, k++) binAll.set(parts[k], o);
const json = { ...header0, sections };
const L = plan.fine;
const tiler = { rank: (f: number) => (f * 37) % 11, layer: (f: number, c: number) => (f >= 1 && f <= 3 ? (f - 1) * 3 + (c % 3) : 0), corners: [0, 1, 2, 3] };
const arr = new Uint8Array(8 * 8 * 4 * 9);
for (let l = 0; l < 9; l++) for (let k = 0; k < 64; k++) arr.set([20 + 20 * l + (k % 8) * 3, 30 + 15 * l + Math.floor(k / 8) * 4, 60 + 10 * l, 255], (l * 64 + k) * 4);
const masks = new Uint8Array(32 * 32 * 3).map((_, k) => (k * 29) % 256);
const ground: FieldGround = { tiler, colour: arr, size: 8, depth: 9, masks, ms: 32, reference: { rgb: [0.5, 0.5, 0.5], luminance: 0.5 } };
/** The eye's raw place: the fine lattice's middle. */
const ex = L.x0 + 8 * Math.floor(L.nx / 2);
const ez = L.z0 + 8 * Math.floor(L.nz / 2);

/** A field loaded over the made bake with the stores given, its frames at a raw place. */
async function loadField(name: string, stores: OverlayStores, shapeSide = 0): Promise<{ field: HorizonField; session: RingSession; raw0: Float32Array; frameAt: (rx: number, rz: number) => void }> {
  const session = new RingSession(null);
  const field = new HorizonField(name, centre, shift);
  field.shapeSide = shapeSide;
  field.now = () => clock;
  const hole = new HoleGrid();
  const cam = testCamera();
  const loaded = await settle(field.load({ json: async () => json, bytes: async () => binAll.slice() }, ground, session, renderer, { x: centre.x - ex, z: ez - centre.z }, stores));
  assert.ok(loaded && field.state.state === 'ready', `the field ${name} loads`);
  // The decoded bake as loaded (before any overlay where the stores held none): what every lay is from.
  const raw0 = (field as unknown as { fineH: Float32Array }).fineH.slice();
  const frameAt = (rx: number, rz: number) => {
    const gx = centre.x - rx;
    const gz = rz - centre.z;
    cam.position.set(gx, 40, gz);
    cam.rotation.set(-0.2, 0.4, 0, 'YXZ');
    cam.updateMatrixWorld();
    const pcx = Math.floor(gx / LEAF);
    const pcz = Math.floor(gz / LEAF);
    testHole(hole, pcx, pcz, 6);
    field.update(session, cam, cam.position, 6, pcx, pcz, hole, true);
  };
  return { field, session, raw0, frameAt };
}

/** The card's fine heights (the atlas's fine rows) and the field's own, against `raw + d` with the stores as they stand. */
function heightsHeld(field: HorizonField, raw0: Float32Array, stores: OverlayStores, what: string): void {
  const want = raw0.slice();
  new HeightOverlay(L).layAll(want, stores.heights, stores.course);
  const fine = (field as unknown as { fineH: Float32Array }).fineH;
  const atlas = card.get(field.heights!)!;
  let offCard = 0;
  let offField = 0;
  for (let j = 0; j < L.nz; j++) {
    for (let i = 0; i < L.nx; i++) {
      if (!Object.is(atlas.data[j * atlas.w + i], want[j * L.nx + i])) offCard++;
      if (!Object.is(fine[j * L.nx + i], want[j * L.nx + i])) offField++;
    }
  }
  ok(offCard === 0 && offField === 0 && outOfBounds === 0, `${what}: the card's fine heights and the field's are the bake laid from raw with the stores as they stand, at every sample, to the bit${offCard || offField ? ` (${offCard} off on the card, ${offField} in the field)` : ''}`);
}

/** How many of the field's fine heights are not yet the bake laid from raw with the stores as they stand. */
function offLaid(field: HorizonField, raw0: Float32Array, stores: OverlayStores): number {
  const want = raw0.slice();
  new HeightOverlay(L).layAll(want, stores.heights, stores.course);
  const fine = (field as unknown as { fineH: Float32Array }).fineH;
  let off = 0;
  for (let k = 0; k < want.length; k++) if (!Object.is(fine[k], want[k])) off++;
  return off;
}

// The stores the field reads (the world hands it the terrain itself): its heights the store the brush writes into.
const stores = { heights: null as HeightEdits | null, course: null as CourseCarve | null };
const SIDE = 256;
const { field, raw0, frameAt } = await loadField('live', stores, SIDE);
const fineTex = (field as unknown as { fineN: THREE.Texture }).fineN;
const albedoTex = (field as unknown as { albedo: THREE.Texture }).albedo;
ok(!!fineTex && fineTex.generateMipmaps === false && albedoTex.generateMipmaps === false, 'once on the card the fine normals and the albedo keep generateMipmaps false (a region upload makes no mips)');
const staleNow = () => (field as unknown as { mipsStale: number }).mipsStale;

// ---------------------------------------------------------------- the shape window: its source over a stand-in near ground
const NP = 37;
/** Which blocks the near ground holds cached (half of them, by place). */
const cachedBlock = (bx: number, bz: number) => ((bx + bz) & 1) === 0;
const poleLay = (h: HeightEdits | null, x: number, z: number, v: number) => {
  const d = h ? h.poleDelta(Math.round(x / 2), Math.round(z / 2)) : 0;
  return d !== 0 ? Math.fround(v + d) : v;
};
let made = 0;
const terrain: ShapeTerrain = {
  sampler: {
    poleStep: 2,
    numberOfPoles: NP,
    copyInnerHeights(bx, bz, out) {
      if (!cachedBlock(bx, bz)) return false;
      for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) out[j * 32 + i] = poleLay(stores.heights, bx * 64 + i * 2, bz * 64 + j * 2, Math.fround(hRaw(bx * 64 + i * 2, bz * 64 + j * 2)));
      return true;
    },
    layBlockHeights(bx, bz, g) {
      const x0 = bx * 64 - 4;
      const z0 = bz * 64 - 4;
      for (let j = 0; j < NP; j++) for (let i = 0; i < NP; i++) g[j * NP + i] = poleLay(stores.heights, x0 + i * 2, z0 + j * 2, g[j * NP + i]);
    },
    blockStart: (bx, bz) => ({ x: bx * 64 - 4, z: bz * 64 - 4 }),
  },
  workerUp: true,
  generatePoles(sx, sz, n, step) {
    made++;
    const heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = Math.fround(hRaw(sx + i * step, sz + j * step));
    return Promise.resolve({ heights });
  },
};
field.useShape(shapeSourceOf(terrain));
const sh = field.shape!;
for (let n = 0; n < 60 && sh.made < sh.blocks * sh.blocks; n++) {
  frameAt(ex, ez);
  sh.stepTo(ex, ez);
  await pump();
}
ok(sh.made === sh.blocks * sh.blocks && sh.counts.cached > 0 && sh.counts.generated > 0, `the shape window round the eye made whole (${sh.counts.cached} blocks from the cache, ${sh.counts.generated} by the worker)`);
/** The shape window's every made pole against the raw ground with the store as it stands. */
function shapeHeld(what: string): void {
  let off = 0;
  for (let bz = sh.bz0; bz < sh.bz0 + sh.blocks; bz++) {
    for (let bx = sh.bx0; bx < sh.bx0 + sh.blocks; bx++) {
      const s = sh.slotOf(bx, bz);
      const c0 = (s % sh.blocks) * SHAPE_BLOCK;
      const r0 = Math.floor(s / sh.blocks) * SHAPE_BLOCK;
      for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) if (!Object.is(sh.heights[(r0 + j) * SIDE + c0 + i], poleLay(stores.heights, bx * 64 + i * 2, bz * 64 + j * 2, Math.fround(hRaw(bx * 64 + i * 2, bz * 64 + j * 2))))) off++;
    }
  }
  ok(off === 0, `${what}: the shape window's every pole is the near ground's own (raw, the store laid), to the bit${off ? ` (${off} off)` : ''}`);
}
shapeHeld('made');

// ---------------------------------------------------------------- 2. a sculpt stroke through the real brush, at three rates
const was = { ...SCULPT_TUNE };
SCULPT_TUNE.mode = 'raise';
SCULPT_TUNE.radius = 40;
SCULPT_TUNE.rate = 30;
SCULPT_TUNE.carry = false;
SCULPT_TUNE.keepOff = false;
HORIZON_TUNE.mipsEvery = 250;
const store = new HeightEdits();
stores.heights = store;
/** The rectangles the world hands the field, as sample rectangles (what an upload may reach a texel round). */
const relayed: SampleRect[] = [];
function sculptHost(h: ReturnType<typeof makeHarness>): SculptHost {
  return {
    edits: h.e,
    worldKind: () => 'ground',
    store: () => store,
    rawAt: (px, pz) => Math.fround(hRaw(px * 2, pz * 2)),
    toRaw: (x, z, o) => {
      o.x = centre.x - x;
      o.z = z + centre.z;
    },
    toGame: (x, z, o) => {
      o.x = centre.x - x;
      o.z = z - centre.z;
    },
    // The world's glue (`EditorEntry`'s host, then `World.heightsChanged` and `endHeightsStroke`), raw rectangles in hand.
    changed: (r, end) => {
      if (!(r.x0 <= r.x1)) {
        if (end) field.editEnd();
        return;
      }
      const s = samplesIn(L, { x0: r.x0 - 2, z0: r.z0 - 2, x1: r.x1 + 2, z1: r.z1 + 2 });
      if (s) relayed.push(s);
      field.relay(r.x0 - 2, r.z0 - 2, r.x1 + 2, r.z1 + 2, stores, 0, end);
    },
    feet: () => {},
    standing: () => [],
    lowestOf: () => null,
    fileRow: () => null,
    fileSize: () => ({ tiles: 0, bytes: 0 }),
    deflate: async (b) => deflateRawSync(Buffer.from(b)).toString('base64'),
    beginWork: () => {},
    noteStamp: () => {},
    say: () => {},
  };
}
let harness: ReturnType<typeof makeHarness> | null = null;
let sculpt: EditorSculpt | null = null;
for (const fps of [30, 60, 144]) {
  const h = makeHarness({ onHeights: async () => undefined });
  harness = h;
  const s = new EditorSculpt(sculptHost(h));
  sculpt = s;
  await s.arm();
  const f = toolFrame();
  f.valid = true;
  f.dt = 1 / fps;
  // Each rate's stroke in a place of its own inside the shape window.
  f.x = centre.x - (ex + (fps === 30 ? -150 : fps === 60 ? 0 : 150));
  f.z = ez - centre.z + 40;
  f.apply = true;
  regions.length = 0;
  mips.length = 0;
  relayed.length = 0;
  // The ground as this rate's stroke finds it (the strokes before it stay in the store).
  const before = raw0.slice();
  new HeightOverlay(L).layAll(before, store, null);
  const frames = Math.round(1.6 * fps);
  let worst = 0;
  for (let n = 0; n < frames; n++) {
    clock += 1000 / fps;
    s.frame(f);
    frameAt(ex, ez);
  }
  const heldUntil = clock;
  heightsHeld(field, raw0, stores, `${fps} fps, the stroke held 1.6 s`);
  const staleAtEnd = staleNow();
  f.apply = false;
  clock += 1000 / fps;
  s.frame(f);
  frameAt(ex, ez);
  // Mips: never two on one texture closer than `mipsEvery` while held, and the stale ones made at its end, once.
  const onNormals = mips.filter((m) => m.dst === fineTex);
  for (let k = 1; k < onNormals.length; k++) if (onNormals[k].t <= heldUntil) worst = Math.max(worst, onNormals[k].t - onNormals[k - 1].t < 250 ? 1 : 0);
  const atEnd = onNormals.filter((m) => m.t > heldUntil).length;
  const heldCount = onNormals.filter((m) => m.t <= heldUntil).length;
  ok(worst === 0 && heldCount >= 1 && heldCount <= Math.floor(1600 / 250) + 1 && atEnd === (staleAtEnd > 0 ? 1 : 0) && staleNow() === 0 && mips.every((m) => m.dst === fineTex), `${fps} fps: the fine normals' mips made by a flagged copy ${heldCount} times while held (never two within ${HORIZON_TUNE.mipsEvery} ms) and ${atEnd} at its end (${staleAtEnd} stale as it ended), none left stale; no other texture's`);
  // Uploads to the fine rows: each within a texel round a rectangle relayed, and every changed texel under one.
  const heights = field.heights!;
  const fineUps = regions.filter((r) => r.dst === heights && r.z < L.nz);
  let past = 0;
  for (const u of fineUps) if (!relayed.some((r) => u.x >= r.i0 - 1 && u.z >= r.j0 - 1 && u.x + u.w - 1 <= r.i1 + 1 && u.z + u.h - 1 <= r.j1 + 1)) past++;
  const want = raw0.slice();
  new HeightOverlay(L).layAll(want, store, null);
  let uncovered = 0;
  let changed = 0;
  for (let j = 0; j < L.nz; j++) {
    for (let i = 0; i < L.nx; i++) {
      if (Object.is(want[j * L.nx + i], before[j * L.nx + i])) continue;
      changed++;
      if (!fineUps.some((u) => i >= u.x && j >= u.z && i < u.x + u.w && j < u.z + u.h)) uncovered++;
    }
  }
  ok(past === 0 && uncovered === 0 && changed > 50, `${fps} fps: ${fineUps.length} uploads to the fine heights, none past a texel round a rectangle relayed, every changed texel under one (${changed} changed so far)`);
  shapeHeld(`${fps} fps, the stroke over`);
  await h.settle();
}
ok(sh.counts.relaid > 0 && sh.counts.reasked === 0, `the shape window's blocks were laid again under the stamps as they came, from the cache or their kept raw grid, none asked of the worker again (${sh.counts.relaid} blocks; ${sh.counts.reasked} asked again)`);
// An edit's end with nothing left to lay (the brush's last frame stamped nothing): the stale mips made at the next frame
// whatever the time (`World.endGroundStroke`'s `editEnd`).
{
  mips.length = 0;
  clock += 1000;
  store.set(Math.floor(ex / 64) + 3, Math.floor(ez / 64), new Float32Array(1024).fill(0.75));
  field.relay((Math.floor(ex / 64) + 3) * 64 - 2, Math.floor(ez / 64) * 64 - 2, (Math.floor(ex / 64) + 4) * 64 + 2, (Math.floor(ez / 64) + 1) * 64 + 2, stores, 0, false);
  frameAt(ex, ez);
  const first = mips.length;
  clock += 10;
  store.set(Math.floor(ex / 64) + 3, Math.floor(ez / 64), new Float32Array(1024).fill(1.25));
  field.relay((Math.floor(ex / 64) + 3) * 64 - 2, Math.floor(ez / 64) * 64 - 2, (Math.floor(ex / 64) + 4) * 64 + 2, (Math.floor(ez / 64) + 1) * 64 + 2, stores, 0, false);
  frameAt(ex, ez);
  const within = mips.length - first;
  clock += 10;
  field.editEnd();
  frameAt(ex, ez);
  ok(first === 1 && within === 0 && mips.length === 2 && staleNow() === 0, `a stamp's mips made at once after a quiet spell, none for a stamp within ${HORIZON_TUNE.mipsEvery} ms, and the edit's end makes the stale ones at the next frame (${first}, ${within}, ${mips.length})`);
  store.set(Math.floor(ex / 64) + 3, Math.floor(ez / 64), null);
  field.relay((Math.floor(ex / 64) + 3) * 64 - 2, Math.floor(ez / 64) * 64 - 2, (Math.floor(ex / 64) + 4) * 64 + 2, (Math.floor(ez / 64) + 1) * 64 + 2, stores, 0, true);
  frameAt(ex, ez);
}

// ---------------------------------------------------------------- 3. the undo: the bake again to the bit, no copy kept
{
  // `World.landHeights`'s rules over the undo's answer (`decodeLanded`, `layLanded`), each moved tile's raw rectangle relaid.
  const tiles = [...store.entries()].map((t) => ({ id: tileIdOf(t.tx, t.tz) }));
  const decoded = await decodeLanded([], tiles.map((t) => t.id), (b) => Promise.resolve(inflateTile(b)), deltasOf, tileOfId, () => {});
  const rect = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
  const n = layLanded(store, decoded, null, (tx, tz) => {
    rect.x0 = Math.min(rect.x0, tx * 64);
    rect.z0 = Math.min(rect.z0, tz * 64);
    rect.x1 = Math.max(rect.x1, (tx + 1) * 64);
    rect.z1 = Math.max(rect.z1, (tz + 1) * 64);
  });
  field.relay(rect.x0 - 2, rect.z0 - 2, rect.x1 + 2, rect.z1 + 2, stores, 0, true);
  clock += 16;
  frameAt(ex, ez);
  ok(n.moved > 0 && store.size === 0, `the undo's answer takes every tile out (${n.moved})`);
  heightsHeld(field, raw0, stores, 'the undo');
  ok(field.rawTilesKept === 0, 'and the bake is back with no raw copy kept');
  shapeHeld('the undo');
}

// ---------------------------------------------------------------- 4. a course put in, then a node dragged
{
  const course = new CourseCarve();
  stores.course = course;
  const cx = ex - 120;
  course.set([straight('live', cx - 300, cx + 300, ez - 60, 25, { w: 6, sh: 6 })]);
  // A store new to the ground: every edge to lay (`World.attachCourse`'s own call).
  course.allRects();
  HORIZON_TUNE.liveMs = 0;
  const order: number[] = [];
  const relay = field.relay.bind(field);
  field.relay = (x0, z0, x1, z1, st, grow, end) => {
    order.push(Math.hypot((x0 + x1) / 2 - ex, (z0 + z1) / 2 - ez));
    return relay(x0, z0, x1, z1, st, grow, end);
  };
  const queued = field.courseLater(course.rects, course.rectN, stores);
  let frames = 0;
  while (field.live.courseWaiting > 0 && frames < 500) {
    clock += 16;
    frameAt(ex, ez);
    frames++;
  }
  ok(queued > 0 && frames === queued && field.live.courseWaiting === 0, `a course's change cut into ${queued} pieces, one laid a frame at a share of nought (${frames} frames)`);
  ok(order[0] === Math.min(...order), 'the nearest piece to the eye laid first');
  heightsHeld(field, raw0, stores, 'a course put in');
  // A node dragged: the store made again; its edges' old and new rectangles laid.
  order.length = 0;
  HORIZON_TUNE.liveMs = 1000;
  course.set([straight('live', cx - 300, cx + 360, ez - 20, 31, { w: 6, sh: 6 })]);
  field.courseLater(course.rects, course.rectN, stores);
  mips.length = 0;
  clock += 16;
  frameAt(ex, ez);
  ok(field.live.courseWaiting === 0 && order.length > 0, `with a frame's share the change is laid in one frame (${order.length} pieces)`);
  heightsHeld(field, raw0, stores, 'a node dragged');
  ok(mips.length === 1 && mips[0].dst === fineTex, 'and its mips made once the last piece is laid');
  field.relay = relay;
  course.set([]);
  field.courseLater(course.rects, course.rectN, stores);
  clock += 16;
  frameAt(ex, ez);
  stores.course = null;
  heightsHeld(field, raw0, stores, 'the course taken out');
  ok(field.rawTilesKept === 0, 'and no raw copy is kept');
  HORIZON_TUNE.liveMs = 2;
}

/** A course taken out of the field again: its removed edges laid in frames, the store let go, the bake to the bit. */
function courseOut(course: CourseCarve, what: string): void {
  HORIZON_TUNE.liveMs = 1000;
  course.set([]);
  field.courseLater(course.rects, course.rectN, stores);
  for (let n = 0; n < 50 && field.live.courseWaiting > 0; n++) {
    clock += 16;
    frameAt(ex, ez);
  }
  stores.course = null;
  ok(offLaid(field, raw0, stores) === 0 && field.rawTilesKept === 0 && field.live.courseWaiting === 0, `${what}: the course taken out, the bake to the bit and no raw copy kept`);
  HORIZON_TUNE.liveMs = 2;
}

// ---------------------------------------------------------------- 4b. a course's end: the ring cards stood once the field's own pieces are laid
// The world's end (`World.endCourseChange`) comes once the near ground's queue is empty, which a course far from every cached
// block empties at once; the field's pieces are laid a frame's share at a time after it. The cards stand on the field's
// surface, so they are owed (`RingCardDebt`) and stood once nothing of the field's waits, each tile once however many of
// the change's rectangles meet it (a drag's old and new rectangles, two edges side by side).
{
  const course = new CourseCarve();
  stores.course = course;
  const cx = ex + 140;
  course.set([straight('cards', cx - 400, cx + 400, ez + 30, 18, { w: 6, sh: 6 }), straight('cards2', cx - 380, cx + 380, ez + 52, 22, { w: 5, sh: 5 })]);
  course.allRects();
  const n = course.rectN;
  // The change's rectangles in the game's frame (`World.queueCourseRects`), handed over twice (they overlap).
  const rects: CardRect[] = [];
  for (let k = 0; k < n; k++) {
    const r = course.rects[k];
    const ax = centre.x - r.x0;
    const bx = centre.x - r.x1;
    const az = r.z0 - centre.z;
    const bz = r.z1 - centre.z;
    rects.push({ x0: Math.min(ax, bx), z0: Math.min(az, bz), x1: Math.max(ax, bx), z1: Math.max(az, bz) });
  }
  const twice = [...rects, ...rects];
  // The far tiles standing round it (`World.ringCardTiles`, by "tx,tz").
  const standing = new Set<string>();
  const gx0 = Math.min(...rects.map((r) => r.x0));
  const gx1 = Math.max(...rects.map((r) => r.x1));
  const gz0 = Math.min(...rects.map((r) => r.z0));
  const gz1 = Math.max(...rects.map((r) => r.z1));
  for (let tz = Math.floor((gz0 - 600) / 512); tz <= Math.floor((gz1 + 600) / 512); tz++) for (let tx = Math.floor((gx0 - 600) / 512); tx <= Math.floor((gx1 + 600) / 512); tx++) standing.add(`${tx},${tz}`);
  HORIZON_TUNE.liveMs = 0;
  const queued = field.courseLater(course.rects, n, stores);
  const debt = new RingCardDebt();
  const stood = new Map<string, number>();
  let early = 0;
  let offAtStand = 0;
  const again = (tx: number, tz: number) => {
    const key = `${tx},${tz}`;
    stood.set(key, (stood.get(key) ?? 0) + 1);
    if (field.live.courseWaiting > 0) early++;
    offAtStand = Math.max(offAtStand, offLaid(field, raw0, stores));
  };
  // The near ground's queue empty at once: the end owes the cards over every rectangle and asks.
  const owed = debt.oweIn(standing, twice, twice.length, shift, 512, 16);
  debt.release(field.live.courseWaiting, standing, again);
  const atEnd = stood.size;
  let frames = 0;
  // Each frame the world asks before the field's frame lays its next piece (`stepCourseRelay`, then `update`).
  while ((field.live.courseWaiting > 0 || debt.owed.size > 0) && frames < 500) {
    debt.release(field.live.courseWaiting, standing, again);
    clock += 16;
    frameAt(ex, ez);
    frames++;
  }
  ok(queued > 1 && owed > 0 && atEnd === 0 && early === 0 && offAtStand === 0 && stood.size === owed, `a course's end with the field's ${queued} pieces still waiting: the ${owed} ring-card tiles it meets stood only once the last is laid, on the carved ground (${atEnd} stood at the end, ${early} early, ${offAtStand} samples uncarved as they stood)`);
  ok([...stood.values()].every((v) => v === 1) && debt.stood === owed, `each tile stood once however many of the change's ${twice.length} rectangles meet it (${debt.stood} stood)`);
  // A tile let go while owed is not stood; nothing owed asks nothing.
  debt.oweIn(standing, rects, 1, shift, 512, 16);
  const owedNow = debt.owed.size;
  const gone = [...debt.owed][0];
  standing.delete(gone);
  const stoodNow = debt.release(0, standing, again);
  ok(owedNow > 0 && stoodNow === owedNow - 1 && stood.get(gone) === 1 && debt.owed.size === 0 && debt.release(0, standing, again) === 0, `a tile let go while owed is dropped (${stoodNow} of ${owedNow} stood), and nothing owed stands nothing`);
  courseOut(course, 'the cards');
}

// ---------------------------------------------------------------- 4c. a held drag queues one piece a horizon tile
// A held drag hands its edges' old and new rectangles over at every preview tick (`World.queueCourseRects`): a rectangle
// meeting a tile that already waits grows that tile's piece, so a tile waits once however long the drag is held.
{
  const course = new CourseCarve();
  stores.course = course;
  const cx = ex - 60;
  course.set([straight('drag', cx - 300, cx + 300, ez + 90, 20, { w: 6, sh: 6 })]);
  course.allRects();
  HORIZON_TUNE.liveMs = 0;
  const span = HORIZON_TILE * L.step;
  const grow = L.step / 2;
  const tiles = new Set<number>();
  const meet = () => {
    for (let k = 0; k < course.rectN; k++) {
      const r = course.rects[k];
      const lx = Math.min(r.x0, r.x1) - grow;
      const hx = Math.max(r.x0, r.x1) + grow;
      const lz = Math.min(r.z0, r.z1) - grow;
      const hz = Math.max(r.z0, r.z1) + grow;
      for (let tz = Math.floor((lz - L.z0) / span); tz <= Math.floor((hz - L.z0) / span); tz++) for (let tx = Math.floor((lx - L.x0) / span); tx <= Math.floor((hx - L.x0) / span); tx++) tiles.add(tz * 4096 + tx);
    }
  };
  const merged0 = field.live.courseMerged;
  meet();
  field.courseLater(course.rects, course.rectN, stores);
  let handed = course.rectN;
  for (let tick = 1; tick <= 40; tick++) {
    course.set([straight('drag', cx - 300, cx + 300 + tick * 3, ez + 90 + tick, 20 + tick * 0.1, { w: 6, sh: 6 })]);
    meet();
    handed += course.rectN;
    field.courseLater(course.rects, course.rectN, stores);
  }
  const waiting = field.live.courseWaiting;
  ok(waiting > 0 && waiting <= tiles.size && field.live.courseMerged > merged0, `a held drag of 40 ticks with no frame between: ${handed} rectangles wait as ${waiting} pieces over the ${tiles.size} horizon tiles they meet (${field.live.courseMerged - merged0} grew a waiting piece)`);
  let frames = 0;
  while (field.live.courseWaiting > 0 && frames < 500) {
    clock += 16;
    frameAt(ex, ez);
    frames++;
  }
  ok(frames === waiting && offLaid(field, raw0, stores) === 0, `laid one a frame (${frames} frames), the grown pieces lay the course as it stands at the drop, to the bit`);
  courseOut(course, 'the drag');
}

// ---------------------------------------------------------------- 4d. two edits far apart, relaid by their union: a tile at a time
// A landed file's or an undo's rectangle is the union of every tile it moved (`World.landHeights`, `unionTile`): laid and put
// on the card tile by tile, never one box over the untouched tiles between the two edits.
{
  const az = Math.floor(ez / 64);
  const ax = Math.floor((L.x0 + 80) / 64) + 1;
  const bx = Math.floor((L.x0 + (L.nx - 1) * L.step - 80) / 64) - 1;
  assert.ok((bx - ax) * 64 >= 2 * HORIZON_TILE * L.step, `the two edits stand at least two horizon tiles apart (${(bx - ax) * 64} m)`);
  store.set(ax, az, new Float32Array(1024).fill(3));
  store.set(bx, az, new Float32Array(1024).fill(-2));
  regions.length = 0;
  field.relay(ax * 64 - 2, az * 64 - 2, (bx + 1) * 64 + 2, (az + 1) * 64 + 2, stores, 0, true);
  const ups = regions.filter((r) => (r.dst === field.heights && r.z < L.nz) || r.dst === fineTex);
  const widest = Math.max(0, ...ups.map((u) => Math.max(u.w, u.h)));
  const midI = Math.round(((ax + bx) * 32 - L.x0) / L.step);
  const overMiddle = ups.filter((u) => midI >= u.x && midI < u.x + u.w).length;
  ok(ups.length >= 4 && widest <= HORIZON_TILE + 2 && overMiddle === 0, `two edits ${(bx - ax) * 64} m apart relaid by their union: ${ups.length} uploads of at most ${widest} texels a side (a tile and a texel round it), none over the untouched ground between`);
  heightsHeld(field, raw0, stores, 'two edits far apart relaid by their union');
  store.set(ax, az, null);
  store.set(bx, az, null);
  field.relay(ax * 64 - 2, az * 64 - 2, (bx + 1) * 64 + 2, (az + 1) * 64 + 2, stores, 0, true);
  heightsHeld(field, raw0, stores, 'and let go by their union');
  ok(field.rawTilesKept === 0, 'and no raw copy is kept');
  clock += 16;
  frameAt(ex, ez);
}

// ---------------------------------------------------------------- 5. the paint: a tile asked once, once more if named after
{
  const tx = Math.floor(ex / 512);
  const tz = Math.floor(ez / 512);
  const key = paintTileNumber(tx, tz);
  let asks = 0;
  const waiting: (() => void)[] = [];
  const gen: PoleGenerate = (sx, sz, n, step) => {
    asks++;
    return new Promise((resolve) => {
      waiting.push(() => {
        const N = n * n;
        const shaders = new Int32Array(N);
        const children = new Uint8Array(N);
        const colors = new Uint8Array(N * 3);
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
          const k = j * n + i;
          shaders[k] = 1 + ((Math.abs(Math.floor((sx + i * step) / 16)) + asks) % 3);
          children[k] = (i * 7 + j * 3) & 255;
          colors.set([200, 40 + asks * 30, 90], k * 3);
        }
        resolve({ heights: new Float32Array(N), shaders, children, colors });
      });
    });
  };
  const albedoBefore = card.get(albedoTex)!.data.slice();
  mips.length = 0;
  const q = field.paintTiles([key, key], gen, stores);
  field.paintTiles([key], gen, stores);
  await new Promise((r) => setImmediate(r));
  ok(q === 1 && asks === 1 && field.live.merged === 2 && field.live.regenWaiting === 1, `a painted tile named three times while its grid is on its way is asked once (${asks} asked, ${field.live.merged} merged)`);
  waiting.shift()!();
  await new Promise((r) => setImmediate(r));
  field.paintTiles([key], gen, stores);
  ok(field.live.again === 1, 'named again once its grid came back, while it is composed: marked to be made once more');
  for (let n = 0; n < 50 && (waiting.length === 0 && field.live.regenWaiting > 0); n++) await pump();
  ok(asks === 2, `and asked once more after it is done (${asks} asked)`);
  waiting.shift()!();
  for (let n = 0; n < 50 && field.live.regenWaiting > 0; n++) await pump();
  const albedoAfter = card.get(albedoTex)!.data;
  let moved = 0;
  for (let k = 0; k < albedoAfter.length; k++) if (albedoAfter[k] !== albedoBefore[k]) moved++;
  ok(field.live.regenWaiting === 0 && field.live.paintTiles === 2 && moved > 0, `its albedo put up (${moved} bytes moved), nothing left waiting`);
  posts.length = 0;
  clock += 16;
  frameAt(ex, ez);
  ok(posts.some((m) => m.type === 'strip'), 'the next frame asks a strip of the composition window over what it made again');
  ok(mips.some((m) => m.dst === albedoTex) && mips.filter((m) => m.dst === albedoTex).length === 1, "and the albedo's mips made once, at its end");
  await pump();
  // The tiles a landing hands the far ground (`World.landPaint`, `paintRelease`): the moved ones, and every painted tile
  // besides where the palette's families moved; a stroke's own, as they were painted.
  const painted = new Map([[71, 1], [72, 1]]);
  const a = horizonPaintKeys(false, new Set([1, 2]), new Set([3]), painted.keys(), [80]);
  const b = horizonPaintKeys(true, new Set([1]), new Set([3]), painted.keys(), [80]);
  const c = horizonPaintKeys(true, [], [], null, null);
  ok(a.join() === '1,2,3' && b.join() === '1,3,71,72,80' && c.length === 0, `a paint landing hands the far ground the tiles that moved (${a.join()}), every painted tile too where the palette moved (${b.join()}), and nothing with no paint`);
}

// ---------------------------------------------------------------- 5b. a retune's whole albedo owes no flagged copy
// A region upload keeps its first texel for the next flagged copy (`upload`); a retune puts the whole albedo up with its
// chain made, so a copy still owed would write a texel kept from before over the retuned picture.
{
  const up = (field as unknown as { upload: (dst: THREE.Texture, d: Uint8Array, i0: number, j0: number, w: number, h: number, f: THREE.PixelFormat, t: THREE.TextureDataType, srgb: boolean) => void }).upload.bind(field);
  // Whatever is stale made now, so the last flagged copy is this frame's.
  up(albedoTex, new Uint8Array([9, 9, 9, 255]), 3, 3, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType, true);
  clock += 1000;
  frameAt(ex, ez);
  await pump();
  const every = HORIZON_TUNE.mipsEvery;
  HORIZON_TUNE.mipsEvery = 1e9;
  // A paint tile's albedo put up a moment before a ground knob moved.
  up(albedoTex, new Uint8Array([1, 2, 3, 4]), 5, 7, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType, true);
  const retunes = field.windowWork.retunes;
  field.retune();
  clock += 16;
  frameAt(ex, ez);
  await pump();
  const texel = () => {
    const h = card.get(albedoTex)!;
    return Array.from(h.data.subarray((7 * h.w + 5) * 4, (7 * h.w + 5) * 4 + 4)).join();
  };
  const retuned = texel();
  HORIZON_TUNE.mipsEvery = every;
  mips.length = 0;
  clock += 1000;
  frameAt(ex, ez);
  ok(field.windowWork.retunes === retunes + 1 && retuned !== '1,2,3,4' && texel() === retuned && !mips.some((m) => m.dst === albedoTex) && staleNow() === 0, `a retune landed over a stale albedo: no flagged copy follows it, and the retuned texel stands (${retuned}, now ${texel()})`);
  await pump();
}

// ---------------------------------------------------------------- 6. a shape block with neither the cache nor a raw grid: asked again
{
  const src = sh.source!;
  const bare: ShapeSource = { cached: () => false, make: src.make };
  sh.source = bare;
  const reasked = sh.counts.reasked;
  store.set(Math.floor(ex / 64), Math.floor(ez / 64), new Float32Array(1024).fill(1.5));
  field.relay(Math.floor(ex / 64) * 64 - 2, Math.floor(ez / 64) * 64 - 2, Math.floor(ex / 64) * 64 + 66, Math.floor(ez / 64) * 64 + 66, stores, 0, true);
  ok(sh.counts.reasked > reasked, `a block the near ground does not hold and that kept no raw grid is asked of the worker again (${sh.counts.reasked - reasked}), its heights standing meanwhile`);
  for (let n = 0; n < 20 && sh.made < sh.blocks * sh.blocks; n++) await pump();
  sh.source = src;
  shapeHeld('asked again and landed');
  store.set(Math.floor(ex / 64), Math.floor(ez / 64), null);
  field.relay(Math.floor(ex / 64) * 64 - 2, Math.floor(ez / 64) * 64 - 2, Math.floor(ex / 64) * 64 + 66, Math.floor(ez / 64) * 64 + 66, stores, 0, true);
  for (let n = 0; n < 20 && sh.made < sh.blocks * sh.blocks; n++) await pump();
  shapeHeld('let go');
}
Object.assign(SCULPT_TUNE, was);
void harness;
void sculpt;

// ---------------------------------------------------------------- 7. a copy of a baked world: its own edit files, never the source's
{
  const row = readWorldRow({ id: 'ours_h4_test_copy', kind: 'copy', of: 'tatooine', name: 'TEST copy' });
  assert.ok(typeof row !== 'string', 'the copy row reads');
  const copy = planetOfWorld(row as never, PLANETS);
  assert.ok(typeof copy !== 'string', `the copy is a planet (${String(copy)})`);
  const planet = copy as PlanetDef;
  const bakePack = packIdOf(planet);
  const key = editKeyOf(planet);
  ok(bakePack === 'tatooine' && key === 'ours_h4_test_copy' && editKeyOfPack(planet, bakePack) === key, `a copy of Tatooine reads its source's pack (${bakePack}: the bake the horizon command made) and keeps its edit files under its own key (${key})`);
  // A heights file each: the source's and the copy's, each a tile of its own deltas, written as the endpoint writes them.
  const fileOf = (world: string, tx: number, tz: number, v: number) => {
    const d = new Float32Array(1024).fill(v);
    return heightsFileText(world, [{ id: tileIdOf(tx, tz), d: deflateRawSync(Buffer.from(deltaBytes(d))).toString('base64'), on: fnv1aHeights(d) }]);
  };
  const ctx = Math.floor((ex + 40) / 64);
  const ctz = Math.floor(ez / 64);
  const files: Record<string, string> = { [`heights/${bakePack}.json`]: fileOf(bakePack, ctx, ctz, 9), [`heights/${key}.json`]: fileOf(key, ctx + 1, ctz, -4) };
  // What the world asks (`askHeights(this.editKey)`, the key `editKeyOfPack` gives): the copy's file, read under its own key.
  const text = files[`heights/${editKeyOfPack(planet, bakePack)}.json`];
  const read = readHeightsFile(text, key, 'ground', inflateTile);
  ok(!read.problem && read.rows.length === 1 && readHeightsFile(files[`heights/${bakePack}.json`], key, 'ground').problem !== null, "the copy's own file reads under its key, and the source's is refused under it (its header names the source)");
  const copyStore = new HeightEdits();
  layLanded(copyStore, await decodeLanded(read.rows as HeightTileRow[], [], (b) => Promise.resolve(inflateTile(b)), deltasOf, tileOfId, () => {}), null, () => {});
  const copyStores = { heights: copyStore, course: null };
  // The source's bake (the field named by the pack it reads) laid with the copy's stores at the arrival.
  const c = await loadField(bakePack, copyStores);
  // The bake as decoded (the same bake as the field above's, whose load laid nothing).
  c.raw0 = raw0;
  const fine = (c.field as unknown as { fineH: Float32Array }).fineH;
  let copyLaid = 0;
  let sourceLaid = 0;
  for (let j = 0; j < L.nz; j++) {
    for (let i = 0; i < L.nx; i++) {
      const k = j * L.nx + i;
      const x = L.x0 + i * 8;
      const tx = Math.floor(x / 64);
      const tz = Math.floor((L.z0 + j * 8) / 64);
      if (tx === ctx + 1 && tz === ctz && Object.is(fine[k], Math.fround(c.raw0[k] - 4))) copyLaid++;
      if (tx === ctx && tz === ctz && !Object.is(fine[k], c.raw0[k])) sourceLaid++;
    }
  }
  ok(copyLaid === 64 && sourceLaid === 0, `the copy's rings over its source's bake carry the copy's own heights (${copyLaid} samples 4 m down) and nothing of the source's file (${sourceLaid})`);
  // And live: a stroke in the copy lays its own store, as anywhere.
  copyStore.set(ctx, ctz + 2, new Float32Array(1024).fill(2));
  c.field.relay(ctx * 64 - 2, (ctz + 2) * 64 - 2, ctx * 64 + 66, (ctz + 2) * 64 + 66, copyStores, 0, true);
  heightsHeld(c.field, c.raw0, copyStores, "a stroke in the copy");
  c.field.dispose(null);
}

// ---------------------------------------------------------------- 8. the world's hand-overs (node cannot load it)
{
  const w = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const pin = (snip: string, what: string) => ok(w.includes(snip), `world.ts: ${what}`);
  pin("this.horizonField?.relay(swg.toSwgX(x1), swg.toSwgZ(z0), swg.toSwgX(x0), swg.toSwgZ(z1), swg, 0, end);", "a stroke's stamp (and an undo, a file landed) relays the far ground's bake under it from the terrain's own stores, the rectangle turned into the raw frame");
  // The field's own: a relay laid and put up a tile at a time, a course's pieces one a tile, a retune owing no flagged copy.
  const fsrc = readFileSync(new URL('../../../src/world/horizon/horizonField.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  ok(fsrc.includes('for (const t of this.overlay.layRect(fine, stores.heights, stores.course, r, this.laidTiles)) {\n        this.heightsMoved(t, null);'), 'horizonField.ts: a relay put on the card tile by tile');
  pin("const r = swg.relayRect(x0, z0, x1, z1);\n      this.groundWork.blocks += r.blocks;\n      this.groundWork.farGrids += r.far;\n      // The far ground's bake", 'after the near ground\'s own blocks are laid (the shape window copies them)');
  pin("this.ringCardsAgainIn(s.x0, s.z0, s.x1, s.z1);\n    this.horizonField?.editEnd();", "a stroke's end stands the ring cards again on the moved ground and owes the mips");
  pin('if (swg) this.horizonField?.courseLater(store.rects, n, swg);', "a course's dirty rectangles handed to the far ground's bake");
  pin('if (swg && this.horizonField) this.horizonField.shapeRelay(swg.toSwgX(x1), swg.toSwgZ(z0), swg.toSwgX(x0), swg.toSwgZ(z1));', 'every block the near ground lays for a course retaken by the shape window');
  pin("if (this.ringCardTiles.size) this.ringCardDebt.oweIn(this.ringCardTiles, this.courseRects, this.courseRectN, this.terrain.groundShift, FAR_TILE, FAR_TILE / FAR_RES);\n    this.standOwedRingCards();\n    this.courseRectN = 0;", "a course's end owes the ring cards over all its rectangles at once (each tile once) and asks, before its rectangles are let go");
  pin('this.ringCardDebt.oweIn(this.ringCardTiles, this.ringCardRect, 1, this.terrain.groundShift, FAR_TILE, FAR_TILE / FAR_RES);\n    this.standOwedRingCards();', "a stroke's end and a lake landed owe the cards over their rectangle and ask");
  pin('this.ringCardDebt.release(this.horizonField?.live.courseWaiting ?? 0, this.ringCardTiles, this.ringCardAgain);', "the owed cards stood only once nothing of the far ground's own pieces waits");
  pin('private stepCourseRelay(eye: THREE.Vector3): void {\n    // The ring cards an edit\'s end owes, stood once the far ground\'s own pieces are laid (a Set\'s size while none is owed).\n    if (this.ringCardDebt.owed.size) this.standOwedRingCards();\n    const swg = this.terrain.swg;', 'asked again every frame while any is owed, before the course\'s own early return');
  pin('private readonly ringCardAgain = (tx: number, tz: number): void => this.farCardsAgain(tx, tz);', 'an owed tile stood as a stroke stands it (`farCardsAgain`)');
  pin('this.ringCardTiles.clear();\n    this.ringCardDebt.clear();', 'the rings let go owe nothing');
  pin('this.courseEndOwed = false;\n    this.ringCardDebt.clear();', 'a new world owes nothing');
  pin('swg.postPaint(famKeys, colKeys, false, fl);\n      const asked = swg.repaint(x0, z0, x1, z1);', 'a paint stroke posts its tiles first');
  pin('this.horizonPaint(horizonPaintKeys(false, famKeys, colKeys, null, null));\n      return;', "then hands the far ground the tiles it painted");
  pin('const hk = horizonPaintKeys(familiesMoved, fam, col, this.groundPaint?.fam.keys() ?? null, this.groundPaint?.col.keys() ?? null);\n      if (hk.length) this.horizonPaint(hk);', "a paint landing (an undo, a file) hands it the tiles that moved, every painted tile when the palette moved");
  pin('if (horizon) this.horizonField?.relay(', "the rectangle's relay of the bake left out where the caller lays it whole (a late file)");
  pin('f.paintTiles(keys, (x, z, n, step) => swg.generatePoles(x, z, n, step), swg);', "through the live generator and the terrain's own stores");
  pin('this.forgetCameraWater();\n    // The far cards the rings stand made again under it (the horizon pass\'s W4): a card is dropped under the drawn water.\n    this.ringCardsAgainIn(x0, z0, x1, z1);', 'a lake landed stands the ring cards again under it (a far card is dropped under the drawn water)');
  // A copy: its edit files asked under its own key, the bake under the pack it reads.
  pin('this.packId = packId;\n    // The name this world\'s edit files are kept under (editKeyOf): its pack id, or a world of yours\' own id.\n    this.editKey = editKeyOfPack(planet, packId);', 'a world keeps its pack and its edit key apart');
  for (const ask of ['askHeights', 'askCourse', 'askPaint', 'askWater', 'askRemovals']) pin(`this.${ask}(this.editKey);`, `${ask} under the edit key`);
  pin('this.loadHorizon(this.packId, spawn)', "the bake read for the pack (a copy's, its source's)");
  pin('const stores = swg;', "the field's stores the terrain itself, which holds the edit key's files");
  const f = readFileSync(new URL('../../../src/world/horizon/horizonField.ts', import.meta.url), 'utf8');
  ok(/if \(this\.worker && !this\.windowAsked\) this\.askWindow\(\);\s*this\.stepLive\(\);\s*\}/.test(f), "horizonField.ts: the frame's own call steps the live edits after the window's ask");
  const atlas = atlasLayout(L.nx, L.nz, plan.coarse.nx, plan.coarse.nz, SIDE);
  void atlas;
}

// ---- wave h6a: the shape window made again at another side (the Graphics page's Terrain shape window moved in play), and a
// bake of 4 m loaded and ranged, through the field's own load, frame and `resizeShape` over the recording card.
{
  const none: OverlayStores = { heights: null, course: null };
  // The Terrain shape detail at the wider window's top: the window of 1,024 holds it to its own.
  const reachWas = HORIZON_TUNE.shapeReach;
  HORIZON_TUNE.shapeReach = 1550;
  const { field, session, frameAt } = await loadField('h6a', none, 1024);
  const blockH = (bx: number, bz: number) => 3 + bx * 0.25 - bz * 0.5;
  const standIn: ShapeSource = { cached: (bx, bz, out) => (out.fill(blockH(bx, bz)), true), make: () => null };
  field.useShape(standIn);
  for (let k = 0; k < 40; k++) frameAt(ex, ez);
  const before = field.heights!;
  const r1024 = { r2: field.rules.r2, r1: field.rules.r1, lod0: field.rules.lod0, side: field.rules.side };
  ok(field.shape!.side === 1024 && r1024.side === 1024 && field.shape!.made === field.shape!.blocks ** 2, `a field made with the window of 1,024 has it whole from the near ground's cache (${field.shape!.made} blocks), the rules' side its own`);
  // h6a's review: the old atlas let go when (and only when) a new one stands in its place, the field's list holding the new one.
  let beforeGone = 0;
  before.addEventListener('dispose', () => beforeGone++);
  ok(!field.resizeShape(1024), 'made again at the side in force, nothing is made');
  ok(beforeGone === 0 && field.textures.includes(before), 'and the atlas in force is kept');
  ok(field.resizeShape(2048), 'made again at 2,048 samples a side');
  const after = field.heights!;
  ok(beforeGone === 1 && !field.textures.includes(before) && field.textures.includes(after) && field.textures.filter((t) => t === after).length === 1, "the old heights atlas let go once, the field's own list holding the new one in its place (h6a's review)");
  const lay = atlasLayout(L.nx, L.nz, plan.coarse.nx, plan.coarse.nz, 2048);
  const held = card.get(after);
  ok(after !== before && before.image.width !== undefined && held !== undefined && held.w === lay.w && held.h === lay.h && session.uniforms.uHorizonHeights.value === after, `the heights atlas laid again at the window's new size and put on the card whole (${held?.w} by ${held?.h}), the session's sampler handed it`);
  ok(field.shape!.side === 2048 && field.shape!.source === standIn && field.shape!.made === 0 && field.rules.side === 2048, 'the new window empty, its source the old one\'s, the rules\' side moved');
  // Every fine and coarse sample on the card where it stood (the laid heights the field keeps), the window's block empty.
  const fine = (field as unknown as { fineH: Float32Array }).fineH;
  let off = 0;
  for (let j = 0; j < L.nz; j++) for (let i = 0; i < L.nx; i++) if (!Object.is(held!.data[j * held!.w + i], fine[j * L.nx + i])) off++;
  ok(off === 0, 'every fine sample on the card where it stood, to the bit');
  for (let k = 0; k < 120; k++) frameAt(ex, ez);
  ok(field.shape!.made === field.shape!.blocks ** 2 && r1024.r2 < 704 && field.rules.r2 === 1550, `filled again in play, the 2 m level reaching further (${Math.round(r1024.r2)} m to ${Math.round(field.rules.r2)} m at the Terrain shape detail ${HORIZON_TUNE.shapeReach} m)`);
  // h6a's review: past how many due blocks the window goes whole is a share of its own slots (96 of the window of 1,024's
  // 1,024, the same share of 2,048's 4,096), so a step of one block, which empties 2B - 1 slots, never puts the whole
  // window on the card in a frame: at 2,048 a diagonal step empties 127, past the 1,024 window's 96.
  ok(shapeWholePast(32) === SHAPE_WHOLE_PAST && shapeWholePast(64) === 384, `the whole upload past ${shapeWholePast(32)} due blocks at 1,024 and ${shapeWholePast(64)} at 2,048`);
  for (let k = 0; k < 40 && field.shape!.dirty; k++) frameAt(ex, ez);
  ok(field.shape!.dirty === 0, 'the window filled and every block on the card before it is moved');
  const w0 = field.shapeWork.wholes;
  const b0 = field.shapeWork.blocks;
  const regions0 = regions.length;
  frameAt(ex + SHAPE_BLOCK * 2, ez + SHAPE_BLOCK * 2);
  const stepped = field.shapeWork.blocks - b0;
  const wholeRegions = regions.slice(regions0).filter((r) => r.dst === after && r.w === 2048).length;
  ok(field.shapeWork.wholes === w0 && wholeRegions === 0 && stepped === 2 * field.shape!.blocks - 1 && field.shape!.dirty === 0, `a diagonal step of one block at 2,048 puts its ${stepped} emptied blocks on the card in its own frame, never the whole window (${field.shapeWork.wholes - w0} whole uploads)`);
  frameAt(ex + SHAPE_BLOCK * 2 * 20, ez + SHAPE_BLOCK * 2);
  ok(field.shapeWork.wholes === w0 + 1, 'a far move still puts the window on the card whole');
  // h6a's review: the console's memory counts the raw grid kept beside every block the terrain worker made (W4's `raws`).
  const rawN = 36 * 36;
  const maker: ShapeSource = { cached: () => false, make: (bx, bz) => Promise.resolve({ inner: new Float32Array(SHAPE_BLOCK * SHAPE_BLOCK).fill(blockH(bx, bz)), raw: new Float32Array(rawN) }) };
  field.useShape(maker);
  field.shape!.forget();
  for (let k = 0; k < 20 && field.shape!.made < field.shape!.blocks ** 2; k++) {
    frameAt(ex + SHAPE_BLOCK * 2 * 20, ez + SHAPE_BLOCK * 2);
    await new Promise((r) => setImmediate(r));
  }
  const nMade = field.shape!.blocks ** 2;
  const mb = field.megabytes();
  ok(field.shape!.made === nMade && field.shape!.counts.generated >= nMade && Math.abs(mb.shape * 1048576 - (2048 * 2048 * 4 + nMade * rawN * 4)) < 1, `the window's share of the CPU counts the raw grids the worker's blocks keep (${mb.shape.toFixed(1)} MB: 16 of heights and ${((nMade * rawN * 4) / 1048576).toFixed(1)} of raw grids)`);
  HORIZON_TUNE.shapeReach = reachWas;
  let afterGone = 0;
  after.addEventListener('dispose', () => afterGone++);
  field.dispose(session);
  ok(afterGone === 1, "the field let go with the atlas made at the new window (h6a's review)");
}
{
  // A bake of 4 m (the converter's `--step=4`): every other sample the 8 m bake's own lattice, the colour at 8 m.
  const p4 = planBake(1024, centre, { margin: 256, farMargin: 1024, step: 4 });
  ok(p4.fine.step === 4 && p4.fine.x0 === plan.fine.x0 && p4.fine.z0 === plan.fine.z0 && p4.fine.nx === 2 * (plan.fine.nx - 1) + 1 && JSON.stringify(p4.colour) === JSON.stringify(plan.colour) && JSON.stringify(p4.coarse) === JSON.stringify(plan.coarse) && JSON.stringify(p4.ground) === JSON.stringify(plan.ground), "a 4 m plan stands on the 8 m one's first sample over its very extent, its families, colours and coarse lattice the 8 m plan's");
  const fe4 = encodeHeights(fill(p4.fine), p4.fine.nx, p4.fine.nz);
  const raws4: Record<string, Uint8Array> = { ...raws, heights: fe4.bytes };
  const h4 = { ...header0, fine: { ...p4.fine, lo: fe4.lo, q: fe4.q } };
  const parts4: Uint8Array[] = [];
  const secs4: typeof sections = [];
  let at4 = 0;
  for (const name of HORIZON_SECTIONS) {
    const z = new Uint8Array(deflateSync(raws4[name]));
    secs4.push({ name, offset: at4, length: z.length, size: sectionSize(h4 as never, name) });
    parts4.push(z);
    at4 += z.length;
  }
  const bin4 = new Uint8Array(at4);
  for (let k = 0, o = 0; k < parts4.length; o += parts4[k].length, k++) bin4.set(parts4[k], o);
  const json4 = { ...h4, sections: secs4 };
  const session = new RingSession(null);
  const field = new HorizonField('h6a-4m', centre, shift);
  field.shapeSide = 1024;
  const loaded = await settle(field.load({ json: async () => json4, bytes: async () => bin4.slice() }, ground, session, renderer, { x: centre.x - ex, z: ez - centre.z }, null));
  ok(loaded && field.state.state === 'ready' && field.rules.bakeStep === 4 && field.header!.fine.step === 4, 'a 4 m bake loads, the rules told its step');
  field.useShape({ cached: (_bx, _bz, out) => (out.fill(1), true), make: () => null });
  const cam = testCamera();
  const hole = new HoleGrid();
  const gx = centre.x - ex;
  const gz = ez - centre.z;
  cam.position.set(gx, 40, gz);
  cam.updateMatrixWorld();
  testHole(hole, Math.floor(gx / LEAF), Math.floor(gz / LEAF), 6);
  field.update(session, cam, cam.position, 6, Math.floor(gx / LEAF), Math.floor(gz / LEAF), hole, true);
  const r = field.rules;
  ok(r.finest === -2 && r.r1 === 2 * r.r2 && r.lod0 >= 2 * r.r1, `the 4 m level reads the bake to twice the 2 m level's range and level 0 to twice that (${Math.round(r.r2)} / ${Math.round(r.r1)} / ${Math.round(r.lod0)} m)`);
  HORIZON_TUNE.shapeBake = false;
  field.update(session, cam, cam.position, 6, Math.floor(gx / LEAF), Math.floor(gz / LEAF), hole, true);
  ok(field.rules.r1 < 2 * field.rules.r2 && field.rules.r1 <= 926, `with shapeBake off the 8 m bake's ranges (${Math.round(field.rules.r1)} m, inside the window)`);
  HORIZON_TUNE.shapeBake = true;
  // The far ground's own reader at a 4 m sample: the sample as baked (its 16-bit store), exact.
  let worst = 0;
  for (let k = 0; k < 400; k++) {
    const i = 1 + ((k * 37) % (p4.fine.nx - 2));
    const j = 1 + ((k * 91) % (p4.fine.nz - 2));
    const want = fe4.lo + fe4.q * Math.round((hRaw(p4.fine.x0 + i * 4, p4.fine.z0 + j * 4) - fe4.lo) / fe4.q);
    worst = Math.max(worst, Math.abs(field.heightRaw(p4.fine.x0 + i * 4, p4.fine.z0 + j * 4) - want));
  }
  ok(worst < 1e-3, `its fine heights read back at every 4 m sample as stored (worst ${worst.toExponential(1)} m)`);
  const mb4 = field.megabytes();
  ok(mb4.card > 0 && mb4.cpu > 0, `its memory by the formats' arithmetic (${mb4.card.toFixed(1)} MB on the card, ${mb4.cpu.toFixed(1)} on the CPU)`);
  field.dispose(session);
}

void note;
console.log(`\nhorizonLive: ${checks} checks passed`);
