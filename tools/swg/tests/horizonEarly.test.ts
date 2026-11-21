// The far ground's bake begun early and its colours on several threads (the GPU port's pass 1, wave 8, cut 2:
// `HORIZON_TUNE.early`, `HORIZON_TUNE.albedoThreads`), held to the one-word, one-thread decode byte for byte, on a stand-in
// world whose families stand in patches (tiles of one to four layers, many signatures, the same ones met again in every
// row) and whose masks are soft (so a tile's colour as worked and as the memo's 32-bit float differ):
//   1. the albedo's rows composed in slices and stitched (`composeAlbedoRows`, `stitchAlbedo`) against `composeAlbedo`, at
//      every share from one to seven slices; and the stitch's own rule on a cell made to sit on a byte's edge, where the
//      memo's float and the worked double round to two bytes: the stitch writes the memo's where an earlier slice met the
//      signature, and the double where none did;
//   2. the decode cut in two (`beginBake`, `finishBake`), with its albedo on one thread and on four, against `decodeBake`,
//      and today's `decodeBake` against the base commit's own (out of git, else a recorded hash);
//   3. the decode worker's own module behind stand-in Workers, its helpers on real message ports: the one-word decode, the
//      decode with three helpers, the begin and the compose with none and with three, and a made world's make with none
//      and with three, every array the same; the same overlay and window asked after each answered with the same bytes
//      (what the worker keeps); a helper lost has its slice made by the decode worker, the same bytes;
//   4. the field itself (`HorizonField.load`, and `begin` then `load`), with the owner's height edits laid at the load and a
//      paint and a dropped building's ground made again after it: every texture as the card holds it, the heights kept and
//      the pyramid the same both ways; a bake begun early whose ground has no tile arrays, and one let go while begun, let
//      their worker and helpers go and answer nothing.
//
// Run: node tools/swg/tests/horizonEarly.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import * as THREE from 'three';
import { GENERATOR_REVISION } from '../../../src/swg/terrain/generator.ts';
import { HeightEdits } from '../../../src/swg/terrain/heightEdits.ts';
import { groundShift, NO_SHIFT } from '../../../src/world/groundTiles.ts';
import { ALBEDO_SCALE, albedoSlices, beginBake, composeAlbedo, composeAlbedoRows, decodeBake, encByte, finishBake, stitchAlbedo, type AlbedoSlice, type DecodedBake, type TileTables } from '../../../src/world/horizon/horizonDecode.ts';
import { MadeGround, makeBake, type MadeGroundSpec } from '../../../src/world/horizon/horizonDem.ts';
import { HORIZON_FORMAT, HORIZON_SECTIONS, encodeHeights, planBake, sectionSize, type HorizonHeader } from '../../../src/world/horizon/horizonFile.ts';
import { HORIZON_TUNE } from '../../../src/world/horizon/horizonMath.ts';
import { HorizonField, RingSession, albedoThreadsHeld, tileTablesOf, type FieldGround, type PoleGenerate } from '../../../src/world/horizon/horizonField.ts';
import { tuneHorizon } from '../../../src/world/horizon/horizonDials.ts';
import { atBase } from './atBase.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);
const hashOf = (arrays: ArrayLike<number>[], extra = ''): string => {
  const h = createHash('sha1');
  for (const a of arrays) {
    const v = a as unknown as { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
    h.update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  }
  h.update(extra);
  return h.digest('hex').slice(0, 16);
};
const digest = (d: DecodedBake) => hashOf([d.fine, d.coarse, d.fineNormal, d.albedo, d.coarseAlbedo, d.window, d.tint, ...d.pyramid.lo, ...d.pyramid.hi], JSON.stringify(d.place));
const BASE = 'f24dd65';

// ---------------------------------------------------------------- the stand-in world: its bake, its ground and its tables
let seed = 9137;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
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
// Families in patches of every size (tiles of one to four layers everywhere), and a band where every two by two of corners
// is four families.
const F = 5;
const famsOf = (lat: { nx: number; nz: number }) =>
  Uint8Array.from({ length: lat.nx * lat.nz }, (_, k) => {
    const i = k % lat.nx;
    const j = Math.floor(k / lat.nx);
    if (j % 37 < 4) return 1 + (i % 2) + 2 * (j % 2);
    return 1 + ((Math.floor(i / 3) + Math.floor(j / 4) + ((i * j) % 7 === 0 ? 1 : 0)) % F);
  });
const fam = famsOf(plan.ground);
const colourBytes = Uint8Array.from({ length: plan.colour.nx * plan.colour.nz * 3 }, (_, k) => 40 + ((k * 37 + Math.floor(k / 7) * 11) % 200));
const raw: Record<string, Uint8Array> = {
  heights: fe.bytes,
  families: fam,
  colour: colourBytes,
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
  const z = new Uint8Array(deflateSync(raw[name]));
  sections.push({ name, offset: at, length: z.length, size: sectionSize(header0 as never, name) });
  parts.push(z);
  at += z.length;
}
const binAll = new Uint8Array(at);
let o = 0;
for (const p of parts) {
  binAll.set(p, o);
  o += p.length;
}
const json = { ...header0, sections };
const header = json as unknown as HorizonHeader;
const C = plan.colour;

// The world's ground as the field reads it: a tiler, arrays whose layers each hold a gradient, and soft masks.
const tiler = { rank: (f: number) => (f * 37) % 11, layer: (f: number, c: number) => (f >= 1 && f <= F ? (f - 1) * 3 + (c % 3) : 0), corners: [0, 1, 2, 3] };
const size = 8;
const depth = F * 3;
const arr = new Uint8Array(size * size * 4 * depth);
for (let l = 0; l < depth; l++) for (let k = 0; k < size * size; k++) arr.set([20 + 13 * l + (k % 8) * 3, 30 + 11 * l + Math.floor(k / 8) * 4, 60 + 9 * l, 255], (l * size * size + k) * 4);
const ms = 32;
const masks = new Uint8Array(ms * ms * 3);
for (let y = 0; y < ms; y++) {
  for (let x = 0; x < ms; x++) {
    const u = (x + 0.5) / ms;
    const v = (y + 0.5) / ms;
    const s = (t: number) => Math.min(1, Math.max(0, t));
    masks[y * ms + x] = Math.round(255 * s((0.75 - u) * 3.2) * s((0.75 - v) * 3.2));
    masks[ms * ms + y * ms + x] = Math.round(255 * s((0.6 - u) * 4));
    masks[2 * ms * ms + y * ms + x] = Math.round(255 * (1 - s((u - 0.4) * 4) * s((v - 0.4) * 4)));
  }
}
const ground: FieldGround = { tiler, colour: arr, size, depth, masks, ms, reference: { rgb: [0.55, 0.5, 0.45], luminance: 0.5 } };
const tables: TileTables = tileTablesOf(ground);
// A second set of tables of its own (random means, the additive masks), so the rule is not one table's accident.
const means2 = new Float32Array(256 * 3);
for (let l = 0; l < depth; l++) for (let k = 0; k < 3; k++) means2[l * 3 + k] = 0.05 + 0.4 * rnd();
const tables2: TileTables = { ...tables, means: means2, add: true, tintMode: 2, gainCap: 1.6 };

// ---------------------------------------------------------------- 1. the albedo's rows in slices, stitched
for (const [name, t] of [['the ground\'s tables', tables], ['random means, additive masks', tables2]] as const) {
  const whole = composeAlbedo(t, header, fam, colourBytes);
  const wholeHash = hashOf([whole.rgba]);
  let againSeen = 0;
  for (let n = 1; n <= 7; n++) {
    const b = albedoSlices(C.nz, n);
    ok(b.length === n + 1 && b[0] === 0 && b[n] === C.nz && b.every((v, k) => k === 0 || v >= b[k - 1]), `${name}: ${n} slices cut the ${C.nz} rows in order (${b.join(', ')})`);
    // Each slice composed from its own rows of colour, as a helper is handed them.
    const slices: AlbedoSlice[] = [];
    for (let k = 0; k < n; k++) slices.push(composeAlbedoRows(t, header, fam, colourBytes.slice(b[k] * C.nx * 3, b[k + 1] * C.nx * 3), b[k], b[k + 1], b[k]));
    const st = stitchAlbedo(header, slices);
    let off = 0;
    for (let q = 0; q < whole.rgba.length; q++) if (st.rgba[q] !== whole.rgba[q]) off++;
    ok(off === 0 && hashOf([st.rgba]) === wholeHash, `${name}: ${n} slice${n > 1 ? 's' : ''} stitched are the one-thread albedo byte for byte (${st.again} cells summed again)`);
    ok(st.memo === whole.memo, `${name}: and meet the one walk's ${whole.memo} signatures between them (${st.memo})`);
    againSeen = Math.max(againSeen, st.again);
    if (n > 1) {
      // Laid without the stitch's second sum, the slices still carry the double where the walk carried the memo's float.
      let carried = 0;
      for (const sl of slices.slice(1)) {
        const firstMet = new Set<number>();
        for (const s0 of slices.slice(0, slices.indexOf(sl))) for (let m = 0; m < s0.cell.length; m++) firstMet.add(s0.sigHi[m] * 4294967296 + (s0.sigLo[m] >>> 0));
        for (let m = 0; m < sl.cell.length; m++) if (firstMet.has(sl.sigHi[m] * 4294967296 + (sl.sigLo[m] >>> 0))) carried++;
      }
      ok(carried === 0 ? st.again === 0 : st.again > 0, `${name}: ${n} slices: every cell where a slice met first a signature an earlier one met is summed again (${carried} such meetings)`);
    }
  }
  ok(againSeen > 0, `${name}: the fixture does reach the second sum (up to ${againSeen} cells)`);
}
// The stitch's rule where it decides a byte: a one-cell-wide lattice of two rows (4 m cells, one tile each), the same
// signature met in both, its colour on an sRGB byte's edge so the double and the memo's float round apart.
{
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2;
    if (encByte(mid) >= 101) hi = mid;
    else lo = mid;
  }
  const edge = hi * ALBEDO_SCALE;
  const enc = (x: number) => encByte(Math.min(1, Math.max(0, x / ALBEDO_SCALE)));
  // A double beside the edge whose 32-bit float lies over it (or under it): the first of a fine walk across it.
  let v = edge;
  for (let d = -6e-8; d <= 6e-8; d += 1e-10) {
    if (enc(edge + d) !== enc(Math.fround(edge + d))) {
      v = edge + d;
      break;
    }
  }
  ok(enc(v) !== enc(Math.fround(v)), `a colour on a byte's edge: the double ${v} is byte ${enc(v)}, the memo's float ${Math.fround(v)} byte ${enc(Math.fround(v))}`);
  const h2 = { colour: { x0: 0, z0: 0, step: 4, nx: 1, nz: 2 } } as unknown as HorizonHeader;
  const cellOf = (j: number, lo2: number, hi2: number): AlbedoSlice => ({ j0: j, j1: j + 1, rgba: Uint8Array.of(enc(v), enc(v), enc(v), 0), sigLo: Int32Array.of(lo2), sigHi: Int32Array.of(hi2), cell: Int32Array.of(j), slot: Int32Array.of(0), at: Int32Array.of(0), vals: Float64Array.of(v, v, v, 1, 1, 1), ms: 0 });
  const met = stitchAlbedo(h2, [cellOf(0, 5, 9), cellOf(1, 5, 9)]);
  ok(met.rgba[4] === enc(Math.fround(v)) && met.rgba[0] === enc(v) && met.again === 1, "met again in a later slice, the cell takes the memo's float (the one walk's hit); its first meeting keeps the double");
  const fresh = stitchAlbedo(h2, [cellOf(0, 5, 9), cellOf(1, 6, 9)]);
  ok(fresh.rgba[4] === enc(v) && fresh.again === 0, 'a signature no earlier slice met keeps the double (the one walk met it first there too)');
}

// ---------------------------------------------------------------- 2. the decode cut in two, against the one word and the base
// The eye in the bake's raw frame (about the raw origin, the bake's lattices round it).
const eye = { rx: -100, rz: 60 };
const S = 128;
const oneWord = await decodeBake(header, binAll.slice(), tables, centre, shift, eye, S);
const oneHash = digest(oneWord);
{
  const b1 = await beginBake(header, binAll.slice(), centre, shift);
  ok(digest(finishBake(b1, tables, eye, S, null)) === oneHash, `the decode begun and finished on one thread is the one word's, every array and the window's place (${oneHash})`);
  const b4 = await beginBake(header, binAll.slice(), centre, shift);
  const bounds = albedoSlices(header.colour.nz, 4);
  const shared = stitchAlbedo(header, [0, 1, 2, 3].map((k) => composeAlbedoRows(tables, header, b4.s.families, b4.s.colour, bounds[k], bounds[k + 1], 0)));
  ok(digest(finishBake(b4, tables, eye, S, shared)) === oneHash, 'and with its albedo on four threads');
  // The base commit's one-word decode of this fixture, recorded for a checkout git cannot hand the base over in.
  const RECORDED = 'eebf85cf5f3af08f';
  const old = await atBase<{ decodeBake: typeof decodeBake }>('src/world/horizon/horizonDecode.ts', BASE).catch(() => null);
  if (old) {
    const was = digest(await old.decodeBake(header, binAll.slice(), tables, centre, shift, eye, S));
    ok(was === oneHash, `today's one-word decode is ${BASE}'s to the byte (${was})`);
    if (RECORDED) ok(was === RECORDED, `and ${BASE}'s hashes as recorded`);
  } else if (RECORDED) {
    note(`git cannot hand ${BASE} over: the one word held to its recorded hash alone`);
    ok(oneHash === RECORDED, `today's one-word decode hashes as ${BASE}'s did (${oneHash})`);
  } else note(`git cannot hand ${BASE} over and no hash is recorded: the one word is held to the cut decode alone`);
}

// ---------------------------------------------------------------- 3. the decode worker's own module, its helpers on real ports
type Msg = Record<string, unknown> & { type: string; id?: number };
const toWorker: Msg[] = [];
const toField: unknown[] = [];
const workerSelf = {
  onmessage: null as null | ((e: { data: unknown }) => unknown),
  postMessage(m: unknown, transfer: Transferable[] = []) {
    toField.push(structuredClone(m, { transfer: transfer as never }));
  },
};
(globalThis as unknown as { self: unknown }).self = workerSelf;
await import('../../../src/world/horizon/horizonDecodeWorker.ts');
ok(typeof workerSelf.onmessage === 'function', "the decode worker's own module runs here, behind stand-in Workers");
/** The stand-in Worker: what is posted is cloned with its transfers, as a real worker's message is; a helper may be made to never start. */
class FakeWorker {
  static made: FakeWorker[] = [];
  static swallowHelper = -1;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessageerror: unknown = null;
  terminated = false;
  helper = false;
  constructor() {
    FakeWorker.made.push(this);
  }
  postMessage(m: Msg, transfer: Transferable[] = []): void {
    if (m.type === 'helper') {
      this.helper = true;
      if (FakeWorker.made.filter((w) => w.helper).indexOf(this) === FakeWorker.swallowHelper) return;
    } else if (m.type !== 'helperLost') answerTo = this;
    toWorker.push(structuredClone(m, { transfer: transfer as never }));
  }
  terminate(): void {
    this.terminated = true;
  }
}
let answerTo: FakeWorker | null = null;
(globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
const turn = () => new Promise((r) => setImmediate(r));
/** The worker reads what was posted, concurrently as a worker's handlers run, and the field what it answered, until quiet. */
async function pump(): Promise<void> {
  await turn();
  for (let round = 0; round < 50 && (toWorker.length || toField.length); round++) {
    while (toWorker.length) void workerSelf.onmessage!({ data: toWorker.shift() });
    while (toField.length) answerTo?.onmessage?.({ data: toField.shift() });
    await turn();
  }
}
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  let v!: T;
  void p.then((x) => {
    done = true;
    v = x;
  });
  for (let i = 0; i < 4000 && !done; i++) await pump();
  assert.ok(done, 'a step never ended');
  return v;
}
/** One word (or two) posted straight to the worker's module, and its answer of a kind. */
async function ask(msgs: { m: Msg; transfer?: Transferable[] }[], want: string): Promise<Record<string, unknown>> {
  const fake = new FakeWorker();
  const got: Record<string, unknown>[] = [];
  fake.onmessage = (e) => got.push(e.data as Record<string, unknown>);
  for (const { m, transfer } of msgs) fake.postMessage(m, transfer ?? []);
  return settle(
    (async () => {
      for (;;) {
        const hit = got.find((g) => g.type === want || g.type === 'error');
        if (hit) return hit;
        await turn();
      }
    })(),
  );
}
/** Three helpers made as the field makes them: the module's own `helper` word, each handed one end of a channel. */
function helpers(n: number): MessagePort[] {
  const ports: MessagePort[] = [];
  for (let k = 0; k < n; k++) {
    const ch = new MessageChannel();
    new FakeWorker().postMessage({ type: 'helper', id: 0, port: ch.port2 }, [ch.port2]);
    ports.push(ch.port1);
  }
  return ports;
}
const decodeMsg = (ports: MessagePort[]) => {
  const bin = binAll.slice();
  return { m: { type: 'decode', id: 1, header, bin: bin.buffer, tables, centre, shift: { ...shift }, eye, S, ...(ports.length ? { ports } : {}) }, transfer: [bin.buffer, ...ports] as Transferable[] };
};
const beginMsg = (ports: MessagePort[]) => {
  const bin = binAll.slice();
  return { m: { type: 'begin', id: 1, header, bin: bin.buffer, centre, shift: { ...shift }, ...(ports.length ? { ports } : {}) }, transfer: [bin.buffer, ...ports] as Transferable[] };
};
const composeMsg = { m: { type: 'compose', id: 1, tables, eye, S } };
// The same overlay and window asked of what each way kept: the poles and colours of a rectangle made again, then a window elsewhere.
const ovPoles = { x0: 4 * Math.floor((C.x0 + 300) / 4), z0: 4 * Math.floor((C.z0 + 260) / 4), n: 24, m: 18, fam: Uint8Array.from({ length: 24 * 18 }, (_, k) => 1 + (k % 4)), choice: Uint8Array.from({ length: 24 * 18 }, (_, k) => (k * 11) & 255) };
const ovCells = { i0: 40, j0: 35, w: 12, h: 9, rgb: Uint8Array.from({ length: 12 * 9 * 3 }, (_, k) => (k * 29) & 255) };
async function afterwards(): Promise<string> {
  const ov = (await ask([{ m: { type: 'overlay', id: 3, poles: ovPoles, cells: ovCells, i0: 40, j0: 35, i1: 51, j1: 43 } }], 'overlay')) as { fine: { rgba: Uint8Array }; coarse: { rgba: Uint8Array } };
  const place = { ox: Math.floor(C.x0 / 4) + 20, oz: Math.floor(C.z0 / 4) + 30, S: 96, ci0: 10, cj0: 15, T: 50 };
  const w = (await ask([{ m: { type: 'window', id: 2, place } }], 'window')) as { window: Uint16Array; tint: Uint8Array };
  return hashOf([ov.fine.rgba, ov.coarse.rgba, w.window, w.tint]);
}
const answers: Record<string, { bake: string; after: string }> = {};
for (const [name, msgs, n] of [
  ['the one-word decode (today)', () => [decodeMsg([])], 0],
  ['the decode with three helpers', () => [decodeMsg(helpers(3))], 3],
  ['the begin and the compose', () => [beginMsg([]), composeMsg], 0],
  ['the begin and the compose with three helpers', () => [beginMsg(helpers(3)), composeMsg], 3],
] as const) {
  const r = await ask(msgs() as { m: Msg; transfer?: Transferable[] }[], 'decoded');
  ok(r.type === 'decoded', `${name}: answered with the bake (${r.type}${r.message ? `: ${r.message}` : ''}, ${n} helpers)`);
  answers[name] = { bake: digest(r.d as DecodedBake), after: await afterwards() };
}
for (const name of Object.keys(answers)) {
  ok(answers[name].bake === oneHash, `${name}: every array and the window's place the one word's (${answers[name].bake})`);
  ok(answers[name].after === answers['the one-word decode (today)'].after, `${name}: an overlay and a window asked after it answered with the same bytes (${answers[name].after})`);
}
// A helper that never starts (its worker failed to load) is said lost by the field, before its slice is asked or while it
// is waited for; the decode worker makes its slice either way.
for (const when of ['before its slice is asked', 'while its slice is waited for'] as const) {
  const ports = helpers(3);
  // The second helper's port answers nothing: its far end is held here, the rows it is handed noted and never answered.
  const silent = new MessageChannel();
  let asked = false;
  silent.port2.onmessage = () => (asked = true);
  const lostPorts = [ports[0], silent.port1, ports[2]];
  ports[1].close();
  const fake = new FakeWorker();
  const got: Record<string, unknown>[] = [];
  fake.onmessage = (e) => got.push(e.data as Record<string, unknown>);
  const bin = binAll.slice();
  fake.postMessage({ type: 'decode', id: 1, header, bin: bin.buffer, tables, centre, shift: { ...shift }, eye, S, ports: lostPorts }, [bin.buffer, ...lostPorts]);
  if (when === 'before its slice is asked') fake.postMessage({ type: 'helperLost', id: 0, slot: 2 });
  else {
    for (let i = 0; i < 4000 && !asked; i++) await pump();
    ok(asked && !got.some((g) => g.type === 'decoded'), 'a decode whose helper never answers waits for it');
    fake.postMessage({ type: 'helperLost', id: 0, slot: 2 });
  }
  const r = await settle(
    (async () => {
      for (;;) {
        const hit = got.find((g) => g.type === 'decoded' || g.type === 'error');
        if (hit) return hit;
        await turn();
      }
    })(),
  );
  silent.port2.close();
  ok(r.type === 'decoded' && digest(r.d as DecodedBake) === oneHash, `a helper lost ${when}: the decode worker makes its slice itself, the same bytes`);
}
// A made world (h6b) with tables: its make with none and with three helpers.
const NAMES: [string, number][] = [['sand', 2], ['rock', 3], ['grass', 4], ['dirt', 5]];
const RULES = { pack: 'lok', fallback: 'sand', rules: [{ family: 'rock', aboveSlope: 12 }, { family: 'grass', belowElevation: 30, fuzz: 8 }, { family: 'dirt', aboveHollow: 0.3 }] };
const madeSpec: MadeGroundSpec = {
  world: 'early',
  size: 1024,
  made: 'noise',
  height: 0,
  source: null,
  detail: 0,
  lift: 0,
  terrain: { base: 3, amplitude: 60, frequency: 0.004, octaves: 4, ridged: 0.3, flatten: 1.2, detail: 0 },
  seed: 4242,
  families: { spec: RULES as never, names: NAMES, lift: 0, baseId: -1 },
  wash: null,
  plain: null,
} as MadeGroundSpec;
{
  const made: string[] = [];
  for (const n of [0, 3]) {
    const ports = helpers(n);
    const r = await ask([{ m: { type: 'make', id: 1, spec: madeSpec, tables, centre: { x: 0, z: 0 }, shift: { ...NO_SHIFT }, eye: { rx: 40, rz: -60 }, S, ...(ports.length ? { ports } : {}) }, transfer: ports }], 'decoded');
    ok(r.type === 'decoded' && !!(r.d as DecodedBake).header, `a made world's make with ${n} helpers answers with its bake and its header`);
    made.push(digest(r.d as DecodedBake));
  }
  const fams = makeBake(new MadeGround(madeSpec)).families;
  ok(new Set(fams).size > 2, `the made world stands several families (${[...new Set(fams)].join(', ')})`);
  ok(made[0] === made[1], `and its every array is the same with three helpers as with none (${made[0]})`);
}

// ---------------------------------------------------------------- 4. the field itself: begun early, on four threads, as before
// A recording renderer: the card as the field put it up, whole uploads and region copies alike.
interface Held {
  data: Uint8Array | Uint16Array | Float32Array | Uint32Array;
  w: number;
  h: number;
  k: number;
}
function recorder(card: Map<THREE.Texture, Held>): THREE.WebGLRenderer {
  return {
    initTexture(t: THREE.Texture): void {
      const img = t.image as { data: Held['data'] | null; width: number; height: number };
      if (!img?.data) return;
      card.set(t, { data: img.data.slice(), w: img.width, h: img.height, k: img.data.length / (img.width * img.height) });
    },
    copyTextureToTexture(src: THREE.DataTexture, dst: THREE.Texture, region: THREE.Box2 | null, at2: THREE.Vector2 | null): void {
      const s = src.image as unknown as { data: Held['data']; width: number; height: number };
      const d = card.get(dst);
      if (!d) return;
      const k = s.data.length / (s.width * s.height);
      const x0 = region ? region.min.x : 0;
      const z0 = region ? region.min.y : 0;
      const w = region ? region.max.x - region.min.x : s.width;
      const h = region ? region.max.y - region.min.y : s.height;
      const dx = at2 ? at2.x : 0;
      const dz = at2 ? at2.y : 0;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) for (let c = 0; c < k; c++) d.data[((dz + j) * d.w + dx + i) * k + c] = s.data[((z0 + j) * s.width + x0 + i) * k + c];
    },
  } as unknown as THREE.WebGLRenderer;
}
const gen: PoleGenerate = async (startX, startZ, n, step) => {
  const N = n * n;
  const heights = new Float32Array(N);
  const shaders = new Int32Array(N);
  const children = new Uint8Array(N);
  const colors = new Uint8Array(N * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = startX + i * step;
      const z = startZ + j * step;
      const k = j * n + i;
      heights[k] = Math.fround(hRaw(x, z) + 3 * Math.sin(x / 13));
      shaders[k] = 1 + ((Math.abs(Math.floor(x / 12)) + Math.abs(Math.floor(z / 20))) % 3);
      children[k] = Math.abs(x * 7 + z * 13) & 255;
      colors[k * 3] = Math.abs(x * 3) & 255;
      colors[k * 3 + 1] = Math.abs(z * 5) & 255;
      colors[k * 3 + 2] = 128;
    }
  }
  return { heights, shaders, children, colors };
};
// The owner's heights: a few 64 m tiles of edits round the eye (the store's own keys are the raw frame's).
const edits = new HeightEdits();
for (let k = 0; k < 5; k++) {
  const d = new Float32Array(1024);
  for (let i = 0; i < d.length; i++) d[i] = Math.fround(Math.sin(i * 0.1 + k) * 4);
  edits.set(Math.floor(eye.rx / 64) + k - 2, Math.floor(eye.rz / 64) + (k % 2), d);
}
const stores = { heights: edits, course: null };
// A paint's rectangle and a dropped building's ground, made again after the load.
const asks = [
  { x0: eye.rx - 60, z0: eye.rz - 30, x1: eye.rx + 40, z1: eye.rz + 70, heights: false },
  { x0: eye.rx + 120, z0: eye.rz - 140, x1: eye.rx + 200, z1: eye.rz - 60, heights: true },
];
const fetcher = () => ({ json: async () => json, bytes: async () => binAll.slice() });
type Arm = { early: boolean; threads: number };
async function fieldArm(arm: Arm): Promise<{ hashes: Record<string, string>; field: HorizonField; threads: number; fakes: FakeWorker[] }> {
  HORIZON_TUNE.early = arm.early;
  tuneHorizon({ albedoThreads: arm.threads });
  const from = FakeWorker.made.length;
  const card = new Map<THREE.Texture, Held>();
  const session = new RingSession(null);
  const field = new HorizonField('early', centre, shift);
  const gEye = { x: centre.x - eye.rx, z: eye.rz - centre.z };
  if (arm.early) field.begin(fetcher());
  const loaded = await settle(field.load(fetcher(), ground, session, recorder(card), gEye, stores));
  ok(loaded && field.state.state === 'ready', `the field ${arm.early ? 'begun early' : 'loaded in one word'} on ${arm.threads} thread${arm.threads > 1 ? 's' : ''} stands`);
  await settle(field.regenerate(asks, gen, stores));
  const u = session.uniforms;
  const hashes: Record<string, string> = {};
  for (const k of ['uHorizonHeights', 'uHorizonFineN', 'uHorizonAlbedo', 'uHorizonCoarseAlbedo', 'uHorizonWindow', 'uHorizonTint'] as const) {
    const held = card.get(u[k].value as THREE.Texture);
    hashes[k] = held ? hashOf([held.data]) : 'none';
  }
  const f = field as unknown as { fineH: Float32Array; coarseH: Float32Array };
  hashes.kept = hashOf([f.fineH, f.coarseH, ...field.pyramid!.lo, ...field.pyramid!.hi]);
  hashes.place = JSON.stringify(field.place);
  hashes.overlays = JSON.stringify({ ...field.overlays, layMs: 0 });
  return { hashes, field, threads: field.albedoThreads, fakes: FakeWorker.made.slice(from) };
}
{
  const today = await fieldArm({ early: false, threads: 1 });
  ok(today.hashes.uHorizonAlbedo !== 'none' && today.hashes.uHorizonHeights !== 'none' && today.field.overlays.tilesLaid > 0 && today.field.overlays.regenDone === asks.length, `as before: the owner's edits laid over ${today.field.overlays.tilesLaid} tiles at the load, both rectangles made again after it`);
  ok(today.threads === 1 && today.fakes.length === 1, 'one thread, one worker');
  today.field.dispose(null);
  // The threads are held under this machine's cores less one (`albedoThreadsHeld`): every count gives the same bytes.
  const held = albedoThreadsHeld();
  for (const arm of [
    { early: true, threads: 1 },
    { early: false, threads: 4 },
    { early: true, threads: 4 },
  ]) {
    const r = await fieldArm(arm);
    const want = Math.min(arm.threads, held);
    const what = `begun ${arm.early ? 'early' : 'as before'}, on ${want} thread${want > 1 ? 's' : ''}`;
    ok(r.threads === want && r.fakes.length === want, `${what}: the decode worker and ${want - 1} helpers made`);
    for (const k of Object.keys(today.hashes)) ok(r.hashes[k] === today.hashes[k], `${what}: ${k} as before (${r.hashes[k]})`);
    ok(r.fakes.filter((w) => w.helper).every((w) => w.terminated), `${what}: its helpers let go once the bake is in`);
    r.field.dispose(null);
  }
  // A bake begun early whose ground has no tile arrays: refused in today's words, its worker and helpers let go, whether
  // the load comes while the begin still fetches (no worker is made at all) or after it handed the bake over.
  HORIZON_TUNE.early = true;
  tuneHorizon({ albedoThreads: 4 });
  const gEye = { x: centre.x - eye.rx, z: eye.rz - centre.z };
  for (const when of ['while it fetches', 'once its bake is handed over'] as const) {
    const from = FakeWorker.made.length;
    const refused = new HorizonField('early', centre, shift);
    refused.begin(fetcher());
    if (when === 'once its bake is handed over') for (let i = 0; i < 400 && FakeWorker.made.length - from < Math.min(4, held); i++) await pump();
    const noGround = await settle(refused.load(fetcher(), null, new RingSession(null), recorder(new Map()), gEye, stores));
    for (let i = 0; i < 20; i++) await pump();
    const made = FakeWorker.made.slice(from);
    ok(!noGround && refused.state.state === 'refused' && /tile arrays are not loaded/.test('why' in refused.state ? refused.state.why : ''), `begun early with no tile arrays, refused ${when}: in load's own words`);
    ok(when === 'while it fetches' ? made.length === 0 : made.length === Math.min(4, held) && made.every((w) => w.terminated), when === 'while it fetches' ? 'and no worker is made' : 'and its decode worker and its helpers let go');
  }
  ok(albedoThreadsHeld(1) === 1 && albedoThreadsHeld(2) === 1 && albedoThreadsHeld(4) === 3 && albedoThreadsHeld(16) === 15, "the threads held under a machine's cores less one, never under one");
  // Let go while begun: the load answers nothing and leaves nothing running.
  const from2 = FakeWorker.made.length;
  const gone = new HorizonField('early', centre, shift);
  gone.begin(fetcher());
  for (let i = 0; i < 20; i++) await pump();
  gone.dispose(null);
  const after = await settle(gone.load(fetcher(), ground, new RingSession(null), recorder(new Map()), gEye, stores));
  ok(!after && FakeWorker.made.slice(from2).every((w) => w.terminated), 'let go while begun: the load answers false and the worker and helpers are let go');
  // The threads are whole and one to four, whatever is typed.
  for (const [v, want] of [[0, 1], [2.6, 3], [9, 4], [-3, 1]] as const) {
    tuneHorizon({ albedoThreads: v });
    ok(HORIZON_TUNE.albedoThreads === want, `albedoThreads ${v} is held at ${want}`);
  }
}
HORIZON_TUNE.early = false;
HORIZON_TUNE.albedoThreads = 1;
console.log(`\nhorizonEarly: ${checks} checks passed`);
// A bake begun and let go before its compose leaves the ports it was handed open in the module, which a real worker's
// `terminate` closes and a stand-in cannot: the process is ended here rather than held by them.
process.exit(0);
