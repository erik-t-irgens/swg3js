// The far ground's composition window held end to end (the horizon pass's third wave, its review round). The field is
// driven through its own load, the strips a walk brings, a teleport, a resize, two regenerates and a retune, with the
// decode worker's own module answering every ask (`horizonDecodeWorker.ts` run in node behind a stand-in `Worker`, each
// message cloned as a real one is) and a recording renderer standing in for the card (`initTexture` putting a texture up
// whole, `copyTextureToTexture` by region and position). After every step the window and tint textures as the card holds
// them are the window made whole where it now stands (`wholeWindow`, the overlays laid), byte for byte; the uniforms bound
// are where it stands; and each ask is posted once. The program's own `ringWindowAt` is then run as script
// (`glslRun.ts`) over those very textures and uniforms at random raw places, held to the decode's own unpacking and to a
// bilinear of the colour lattice between cell centres, inside the window and just outside it. And: a regenerate is a
// strip of what it made and never a whole window; a window ask the worker fails is asked again, up to its retries; a
// retune reuses the load's layer means; a console knob that moves none of the tables asks no retune.
//
// Run: node tools/swg/tests/horizonWindow.test.ts
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import * as THREE from 'three';
import { GENERATOR_REVISION } from '../../../src/swg/terrain/generator.ts';
import { GROUND_DRAW_TUNE, groundShift } from '../../../src/world/groundTiles.ts';
import { HORIZON_FORMAT, HORIZON_SECTIONS, encodeHeights, planBake, sectionSize, type HorizonHeader } from '../../../src/world/horizon/horizonFile.ts';
import { HORIZON_TUNE, HoleGrid, LEAF } from '../../../src/world/horizon/horizonMath.ts';
import { HorizonField, RingSession, WINDOW_RETRIES, tableKnobs, tileTablesOf, type FieldGround, type PoleGenerate } from '../../../src/world/horizon/horizonField.ts';
import { clipRect, poleTiles, unpackWindow, wholeWindow, windowPlace, windowTiles, type ColourOverride, type IndexRect, type PoleOverride, type TileTables } from '../../../src/world/horizon/horizonDecode.ts';
import { REGEN_STEP, overridesOf, regenPlan, type RawRect } from '../../../src/world/horizon/horizonOverlay.ts';
import { RING_TEXT } from '../../../src/world/horizon/horizonRings.ts';
import { glslFunctionText, glslFunctions } from './glslRun.ts';
import { testCamera, testHole } from './horizonFixtures.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---------------------------------------------------------------- the decode worker's own module, behind a stand-in Worker
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
ok(typeof workerSelf.onmessage === 'function', "the decode worker's own module runs here, behind a stand-in Worker");

/** Every message the field posted, as posted (the objects themselves, before any clone). */
const posts: Msg[] = [];
/** A kind of ask the worker answers with an error, once (`failNext`) or every time (`failAlways`). */
let failNext: string | null = null;
let failAlways: string | null = null;
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

/** The worker reads what was posted (each cloned), and the field what it answered, until both are quiet. */
async function pump(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  for (let round = 0; round < 100 && (toWorker.length || toField.length); round++) {
    while (toWorker.length) {
      const m = toWorker.shift()!;
      if (failNext === m.type || failAlways === m.type) {
        if (failNext === m.type) failNext = null;
        toField.push({ type: 'error', id: m.id, message: 'a stand-in failure' });
        continue;
      }
      await workerSelf.onmessage!({ data: structuredClone(m) });
    }
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

// ---------------------------------------------------------------- a recording renderer: the card as the field put it up
interface Held {
  data: Uint8Array | Uint16Array | Float32Array;
  w: number;
  h: number;
  k: number;
}
const card = new Map<THREE.Texture, Held>();
let outOfBounds = 0;
const renderer = {
  initTexture(t: THREE.Texture): void {
    const img = t.image as { data: Uint8Array | Uint16Array | Float32Array | null; width: number; height: number };
    if (!img?.data) return;
    card.set(t, { data: img.data.slice(), w: img.width, h: img.height, k: img.data.length / (img.width * img.height) });
  },
  copyTextureToTexture(src: THREE.DataTexture, dst: THREE.Texture, region: THREE.Box2 | null, at: THREE.Vector2 | null): void {
    const s = src.image as unknown as { data: Uint8Array | Uint16Array | Float32Array; width: number; height: number };
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
    if (k !== d.k || x0 < 0 || z0 < 0 || x0 + w > s.width || z0 + h > s.height || dx < 0 || dz < 0 || dx + w > d.w || dz + h > d.h) {
      outOfBounds++;
      return;
    }
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) for (let c = 0; c < k; c++) d.data[((dz + j) * d.w + dx + i) * k + c] = s.data[((z0 + j) * s.width + x0 + i) * k + c];
  },
} as unknown as THREE.WebGLRenderer;

// ---------------------------------------------------------------- a made bake about an odd centre
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
// Families in patches of every size, so tiles of one to four layers stand everywhere.
const famsOf = (lat: { nx: number; nz: number }) => Uint8Array.from({ length: lat.nx * lat.nz }, (_, k) => {
  const i = k % lat.nx;
  const j = Math.floor(k / lat.nx);
  return 1 + ((Math.floor(i / 3) + Math.floor(j / 4) + ((i * j) % 7 === 0 ? 1 : 0)) % 3);
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

// The world's ground as the field reads it: a tiler whose ranks a test can turn round (the order knob's move), arrays whose
// layers each hold a gradient (so a mean is not any one texel), and masks.
let rankFlip = false;
const tiler = {
  rank: (f: number) => (rankFlip ? 10 - ((f * 37) % 11) : (f * 37) % 11),
  layer: (f: number, c: number) => (f >= 1 && f <= 3 ? (f - 1) * 3 + (c % 3) : 0),
  corners: [0, 1, 2, 3],
};
const size = 8;
const depth = 9;
const arr = new Uint8Array(size * size * 4 * depth);
for (let l = 0; l < depth; l++) for (let k = 0; k < size * size; k++) arr.set([20 + 20 * l + (k % 8) * 3, 30 + 15 * l + Math.floor(k / 8) * 4, 60 + 10 * l, 255], (l * size * size + k) * 4);
const ms = 32;
const masks = new Uint8Array(ms * ms * 3);
for (let k = 0; k < masks.length; k++) masks[k] = (k * 29) % 256;
const ground: FieldGround = { tiler, colour: arr, size, depth, masks, ms, reference: { rgb: [0.5, 0.5, 0.5], luminance: 0.5 } };

// ---------------------------------------------------------------- the field, its frames, and what the card must hold
const reachWas = HORIZON_TUNE.detailReach;
HORIZON_TUNE.detailReach = 0;
const session = new RingSession(null);
const field = new HorizonField('window', centre, shift);
const hole = new HoleGrid();
const cam = testCamera();
const eyeRaw = { rx: -100, rz: 60 };
/** A frame of the rings with the eye at a raw place (the world's own call). */
function frameAt(rx: number, rz: number): void {
  eyeRaw.rx = rx;
  eyeRaw.rz = rz;
  const gx = centre.x - rx;
  const gz = rz - centre.z;
  cam.position.set(gx, 40, gz);
  cam.rotation.set(-0.2, 0.4, 0, 'YXZ');
  cam.updateMatrixWorld();
  const pcx = Math.floor(gx / LEAF);
  const pcz = Math.floor(gz / LEAF);
  testHole(hole, pcx, pcz, 6);
  field.update(session, cam, cam.position, 6, pcx, pcz, hole, true);
}
const overlays = { poles: [] as PoleOverride[], cells: [] as ColourOverride[] };
let tablesNow: TileTables = tileTablesOf(ground);
/** The window and tint textures as the card holds them against the window made whole where the field says it stands, the uniforms with them. */
function cardHolds(what: string): { window: Uint16Array; tint: Uint8Array } {
  const p = field.place;
  const u = session.uniforms;
  const W = card.get(u.uHorizonWindow.value);
  const T = card.get(u.uHorizonTint.value);
  const want = wholeWindow(tablesNow, header, fam, colourBytes, overlays.poles, overlays.cells, p);
  let off = 0;
  if (!W || !T || W.data.length !== want.window.length || T.data.length !== want.tint.length) off = -1;
  else {
    for (let k = 0; k < want.window.length; k++) if (W.data[k] !== want.window[k]) off++;
    for (let k = 0; k < want.tint.length; k++) if (T.data[k] !== want.tint[k]) off++;
  }
  ok(off === 0 && outOfBounds === 0, `${what}: the card holds the window made whole where it stands, byte for byte (S ${p.S}, T ${p.T}${off ? `, ${off} texels off` : ''})`);
  const there = windowPlace(eyeRaw.rx, eyeRaw.rz, p.S, C);
  const wv = u.uHorizonWin.value;
  const wc = u.uHorizonWinC.value;
  ok(there.ox === p.ox && there.oz === p.oz && there.ci0 === p.ci0 && there.cj0 === p.cj0 && wv.x === p.ox && wv.y === p.oz && wv.z === p.S && wv.w === p.T && wc.x === p.ci0 && wc.y === p.cj0, `${what}: it stands round the eye, and the uniforms bound say where (window ${wv.x}, ${wv.y}, ${wv.z}, ${wv.w}; cells ${wc.x}, ${wc.y})`);
  return want;
}
let mark = 0;
const since = (): Msg[] => posts.slice(mark);
const markNow = () => (mark = posts.length);

// ---------------------------------------------------------------- the load: the decode's whole window
{
  const fetch = { json: async () => json, bytes: async () => binAll.slice() };
  const loaded = await settle(field.load(fetch, ground, session, renderer, { x: centre.x - eyeRaw.rx, z: eyeRaw.rz - centre.z }));
  ok(loaded && field.state.state === 'ready' && posts.length === 1 && posts[0].type === 'decode', 'the field loads the made bake through the decode worker\'s own module, one decode asked');
  ok(field.place.S === windowTiles(0) && field.place.ci0 !== field.place.cj0, `the decode's window stands at the side the distance asks (${field.place.S}), its cells not the same each way (${field.place.ci0}, ${field.place.cj0})`);
  cardHolds('the load');
  markNow();
  frameAt(eyeRaw.rx, eyeRaw.rz);
  frameAt(eyeRaw.rx + 8, eyeRaw.rz - 8);
  ok(since().length === 0, 'a frame whose eye stands within a strip of the middle asks nothing');
}

// ---------------------------------------------------------------- the strips a walk brings, across both seams, both ways
for (const [dx, dz, what] of [[50, 0, 'a strip east'], [0, -45, 'a strip south'], [37, 41, 'a strip each way'], [-130, 12, 'a long strip west'], [-40, -90, 'back across both seams']] as const) {
  markNow();
  frameAt(eyeRaw.rx + dx * 4, eyeRaw.rz + dz * 4);
  const asked = since();
  ok(asked.length === 1 && asked[0].type === 'strip', `${what}: one strip asked (${asked.map((m) => m.type).join(', ')})`);
  frameAt(eyeRaw.rx, eyeRaw.rz);
  ok(since().length === 1, `${what}: nothing more asked while it is on its way`);
  await pump();
  cardHolds(what);
}

// ---------------------------------------------------------------- the program's own addressing, over the card as it stands
/**
 * `ringWindowAt`, its own text out of the program, run over the card's textures and the uniforms bound, at random raw
 * places inside the window and up to 40 m outside it; held to `unpackWindow` over the window made whole and to a bilinear
 * of the colour lattice between cell centres (the overlays' cells over the bake's), and the tile's place in it.
 */
function addressing(what: string, want: { window: Uint16Array }, winOverride?: THREE.Vector4): void {
  const u = session.uniforms;
  let badFetch = 0;
  const v4 = (x: number, y = x, z = x, w = x) => ({ x, y, z, w });
  const env = {
    uHorizonWin: winOverride ?? u.uHorizonWin.value,
    uHorizonWinC: u.uHorizonWinC.value,
    uHorizonColour: u.uHorizonColour.value,
    uHorizonWindow: u.uHorizonWindow.value,
    uHorizonTint: u.uHorizonTint.value,
    vec2: (x: number, y = x) => ({ x, y }),
    vec3: (x: number, y = x, z = x) => ({ x, y, z }),
    vec4: v4,
    ivec2: (x: number, y: number) => ({ x, y }),
    mod: (x: number, y: number) => x - y * Math.floor(x / y),
    groundTintOf: (c: { x: number; y: number; z: number }) => c,
    texelFetch: (tex: THREE.Texture, q: { x: number; y: number }) => {
      const t = card.get(tex)!;
      if (!Number.isInteger(q.x) || !Number.isInteger(q.y) || q.x < 0 || q.y < 0 || q.x >= t.w || q.y >= t.h) badFetch++;
      const k = (q.y * t.w + q.x) * 4;
      return { x: t.data[k], y: t.data[k + 1], z: t.data[k + 2], w: t.data[k + 3] };
    },
    // GL's linear filter, wrapping: what the tint texture's sampler does.
    textureLod: (tex: THREE.Texture, uv: { x: number; y: number }) => {
      const t = card.get(tex)!;
      const x = uv.x * t.w - 0.5;
      const y = uv.y * t.h - 0.5;
      const i0 = Math.floor(x);
      const j0 = Math.floor(y);
      const fx = x - i0;
      const fy = y - j0;
      const m = (v: number, s: number) => ((v % s) + s) % s;
      const px = (i: number, j: number, c: number) => t.data[(m(j, t.h) * t.w + m(i, t.w)) * 4 + c] / 255;
      const ch = (c: number) => (px(i0, j0, c) * (1 - fx) + px(i0 + 1, j0, c) * fx) * (1 - fy) + (px(i0, j0 + 1, c) * (1 - fx) + px(i0 + 1, j0 + 1, c) * fx) * fy;
      return { rgb: { x: ch(0), y: ch(1), z: ch(2) } };
    },
  };
  const glsl = [
    'vec4 vGroundLayers = vec4( 0.0 );',
    'vec4 vGroundBlend = vec4( 0.0 );',
    'vec2 vGroundTile = vec2( 0.0 );',
    'vec3 vGroundTint = vec3( 1.0 );',
    'float gRingCount = 0.0;',
    glslFunctionText(RING_TEXT.FRAGMENT_PARS, 'ringWindowAt'),
    'vec4 outLayers() { return vGroundLayers; }',
    'vec4 outBlend() { return vGroundBlend; }',
    'vec2 outTile() { return vGroundTile; }',
    'vec3 outTint() { return vGroundTint; }',
    'float outCount() { return gRingCount; }',
  ].join('\n');
  const g = glslFunctions(glsl, ['ringWindowAt', 'outLayers', 'outBlend', 'outTile', 'outTint', 'outCount'], env) as unknown as {
    ringWindowAt(raw: { x: number; y: number }): boolean;
    outLayers(): { x: number; y: number; z: number; w: number };
    outBlend(): { x: number; y: number; z: number };
    outTile(): { x: number; y: number };
    outTint(): { x: number; y: number; z: number };
    outCount(): number;
  };
  const p = field.place;
  const Tw = winOverride ? winOverride.w : p.T;
  const cellRgb = (i: number, j: number, c: number): number => {
    const ci = Math.min(C.nx - 1, Math.max(0, i));
    const cj = Math.min(C.nz - 1, Math.max(0, j));
    for (let q = overlays.cells.length - 1; q >= 0; q--) {
      const ov = overlays.cells[q];
      const a = ci - ov.i0;
      const b = cj - ov.j0;
      if (a >= 0 && b >= 0 && a < ov.w && b < ov.h) return ov.rgb[(b * ov.w + a) * 3 + c] / 255;
    }
    return colourBytes[(cj * C.nx + ci) * 3 + c] / 255;
  };
  const layers = [0, 0, 0, 0];
  const codes = [0, 0, 0];
  let seed = 77;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let inside = 0;
  let outside = 0;
  let wrong = 0;
  let first = '';
  for (let s = 0; s < 4000; s++) {
    const x = p.ox * 4 - 40 + rnd() * (p.S * 4 + 80);
    const z = p.oz * 4 - 40 + rnd() * (p.S * 4 + 80);
    const tx = Math.floor(x / 4);
    const tz = Math.floor(z / 4);
    const cx = (x - C.x0) / C.step;
    const cz = (z - C.z0) / C.step;
    const rcx = Math.floor(cx) - p.ci0;
    const rcz = Math.floor(cz) - p.cj0;
    const inTile = tx >= p.ox && tz >= p.oz && tx < p.ox + p.S && tz < p.oz + p.S;
    const inCell = rcx >= 0 && rcz >= 0 && rcx + 1 < Tw && rcz + 1 < Tw;
    const m = (v: number) => ((v % p.S) + p.S) % p.S;
    const count = inTile ? unpackWindow(want.window, (m(tz) * p.S + m(tx)) * 4, layers, codes) : 0;
    const expect = inTile && inCell && count !== 0;
    const got = g.ringWindowAt({ x, y: z });
    let bad = got !== expect;
    if (!bad && got && !winOverride) {
      const L = g.outLayers();
      const B = g.outBlend();
      const t = g.outTile();
      const tint = g.outTint();
      const fx = cx - Math.floor(cx);
      const fz = cz - Math.floor(cz);
      const i = Math.floor(cx);
      const j = Math.floor(cz);
      const wantTint = [0, 1, 2].map((c) => (cellRgb(i, j, c) * (1 - fx) + cellRgb(i + 1, j, c) * fx) * (1 - fz) + (cellRgb(i, j + 1, c) * (1 - fx) + cellRgb(i + 1, j + 1, c) * fx) * fz);
      bad =
        L.x !== layers[0] || L.y !== layers[1] || L.z !== layers[2] || L.w !== layers[3] ||
        B.x !== codes[0] || B.y !== codes[1] || B.z !== codes[2] || g.outCount() !== count ||
        Math.abs(t.x - (x / 4 - tx)) > 1e-9 || Math.abs(t.y - (z / 4 - tz)) > 1e-9 ||
        Math.abs(tint.x - wantTint[0]) > 1e-6 || Math.abs(tint.y - wantTint[1]) > 1e-6 || Math.abs(tint.z - wantTint[2]) > 1e-6;
      if (bad && !first) first = `at ${x.toFixed(2)}, ${z.toFixed(2)}: layers ${[L.x, L.y, L.z, L.w]} want ${layers}, codes ${[B.x, B.y, B.z]} want ${codes}, tint ${[tint.x, tint.y, tint.z].map((v) => v.toFixed(4))} want ${wantTint.map((v) => v.toFixed(4))}`;
    } else if (bad && !first) first = `at ${x.toFixed(2)}, ${z.toFixed(2)}: in the window ${got}, want ${expect}`;
    if (bad) wrong++;
    if (expect) inside++;
    else outside++;
  }
  ok(wrong === 0 && badFetch === 0 && inside > 1000 && outside > 50, `${what}: ringWindowAt, run as script over the card and the uniforms, reads every place as the window's own unpacking and the colour lattice's bilinear between cell centres (${inside} inside, ${outside} out${first ? `; first wrong ${first}` : ''})`);
}
addressing('after the strips', cardHolds('before the addressing'));
// The tint window's own bound: a place whose bilinear's second cell the tint window does not hold reads the far albedo.
{
  const p = field.place;
  addressing('a tint window held short by 40 cells', cardHolds('the same card'), new THREE.Vector4(p.ox, p.oz, p.S, p.T - 40));
}

// ---------------------------------------------------------------- a teleport past the window: one strip of all of it
{
  markNow();
  frameAt(eyeRaw.rx + 2600, eyeRaw.rz - 1900);
  const asked = since();
  ok(asked.length === 1 && asked[0].type === 'strip' && (asked[0].tiles as IndexRect[]).length === 1 && (asked[0].tiles as IndexRect[])[0].w === field.place.S, 'a teleport past the window asks one strip holding all of it');
  await pump();
  cardHolds('a teleport');
  markNow();
  frameAt(-100, 60);
  await pump();
  cardHolds('and back');
}

// ---------------------------------------------------------------- a resize: one whole window, new textures
{
  const before = session.uniforms.uHorizonWindow.value;
  HORIZON_TUNE.detailReach = 200;
  markNow();
  frameAt(eyeRaw.rx, eyeRaw.rz);
  const asked = since();
  ok(asked.length === 1 && asked[0].type === 'window', `a ground detail distance moved asks one whole window (${asked.map((m) => m.type).join(', ')})`);
  await pump();
  ok(field.place.S === windowTiles(200) && session.uniforms.uHorizonWindow.value !== before, `it stands at its new side (${field.place.S}) in textures of its own`);
  cardHolds('a resize');
}

// ---------------------------------------------------------------- a regenerate: a strip of what it made, never the whole window
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
      shaders[k] = 1 + ((Math.abs(Math.floor(x / 12)) + Math.abs(Math.floor(z / 20))) % 3);
      children[k] = Math.abs(x * 7 + z * 13) & 255;
      colors[k * 3] = Math.abs(x * 3) & 255;
      colors[k * 3 + 1] = Math.abs(z * 5) & 255;
      colors[k * 3 + 2] = 128;
    }
  }
  return { heights, shaders, children, colors };
};
/** What the field's regenerate hands the worker for a rectangle, worked out here from the same grid, to lay over what is expected. */
async function expectOverlay(r: RawRect): Promise<{ poles: PoleOverride; cells: ColourOverride }> {
  const p = regenPlan(C, r)!;
  const g = (await gen(p.startX, p.startZ, p.n, REGEN_STEP))!;
  return overridesOf(C, p, g);
}
{
  const r: RawRect & { heights: boolean } = { x0: eyeRaw.rx - 60, z0: eyeRaw.rz - 30, x1: eyeRaw.rx + 40, z1: eyeRaw.rz + 70, heights: false };
  const ov = await expectOverlay(r);
  const wholes = field.windowWork.wholes;
  const texels = field.windowWork.texels;
  markNow();
  await settle(field.regenerate([r], gen, null));
  overlays.poles.push(ov.poles);
  overlays.cells.push(ov.cells);
  ok(since().length === 1 && since()[0].type === 'overlay', 'a regenerate hands the worker its overlay');
  markNow();
  frameAt(eyeRaw.rx, eyeRaw.rz);
  const asked = since();
  const p = field.place;
  const tiles: IndexRect[] = [];
  const cells: IndexRect[] = [];
  clipRect(poleTiles(ov.poles), p.ox, p.oz, p.S, tiles);
  clipRect({ x0: ov.cells.i0, z0: ov.cells.j0, w: ov.cells.w, h: ov.cells.h }, p.ci0, p.cj0, p.T, cells);
  ok(asked.length === 1 && asked[0].type === 'strip' && JSON.stringify(asked[0].tiles) === JSON.stringify(tiles) && JSON.stringify(asked[0].cells) === JSON.stringify(cells), `the next frame asks a strip of the tiles and cells it made again and nothing else (${asked.map((m) => m.type).join(', ')}: ${JSON.stringify(asked[0]?.tiles)})`);
  await pump();
  const area = tiles.reduce((a, t) => a + t.w * t.h, 0) + cells.reduce((a, t) => a + t.w * t.h, 0);
  ok(field.windowWork.wholes === wholes && field.windowWork.texels - texels === area, `it lands as a strip: no whole window put up, ${field.windowWork.texels - texels} texels put up for a window of ${p.S * p.S}`);
  cardHolds('a regenerate');
  markNow();
  frameAt(eyeRaw.rx, eyeRaw.rz);
  ok(since().length === 0, 'and nothing is asked again once it has landed');
  // One reaching past the window's edge (its east side, inside the bake) is clipped to what the window holds.
  const east = (p.ox + p.S) * 4;
  const e: RawRect & { heights: boolean } = { x0: east - 70, z0: p.oz * 4 + 300, x1: east + 80, z1: p.oz * 4 + 420, heights: false };
  const ov2 = await expectOverlay(e);
  const reach2 = poleTiles(ov2.poles);
  ok(reach2.x0 + reach2.w > p.ox + p.S && reach2.x0 < p.ox + p.S, `the second regenerate reaches past the window's east side (tiles ${reach2.x0} to ${reach2.x0 + reach2.w - 1}, the window to ${p.ox + p.S - 1})`);
  await settle(field.regenerate([e], gen, null));
  overlays.poles.push(ov2.poles);
  overlays.cells.push(ov2.cells);
  markNow();
  frameAt(eyeRaw.rx, eyeRaw.rz);
  const edge = since();
  ok(edge.length === 1 && edge[0].type === 'strip' && (edge[0].tiles as IndexRect[]).every((t) => t.x0 >= p.ox && t.z0 >= p.oz && t.x0 + t.w <= p.ox + p.S && t.z0 + t.h <= p.oz + p.S), 'a regenerate reaching past the window is clipped to what the window holds');
  await pump();
  cardHolds('a regenerate at the edge');
  addressing('after the regenerates', cardHolds('the overlays laid'));
}

// ---------------------------------------------------------------- a retune: the tables made again over the load's means
{
  const decodeMeans = (posts[0].tables as TileTables).means;
  rankFlip = true;
  const was = tablesNow;
  tablesNow = tileTablesOf(ground);
  markNow();
  field.retune();
  frameAt(eyeRaw.rx, eyeRaw.rz);
  const asked = since();
  ok(asked.length === 1 && asked[0].type === 'retune' && (asked[0].tables as TileTables).means === decodeMeans, `a retune asks once, its tables over the load's own layer means (${asked.map((m) => m.type).join(', ')})`);
  const retunes = field.windowWork.retunes;
  await pump();
  const before = wholeWindow(was, header, fam, colourBytes, overlays.poles, overlays.cells, field.place).window;
  const now = cardHolds('a retune').window;
  let moved = 0;
  for (let k = 0; k < now.length; k++) if (now[k] !== before[k]) moved++;
  ok(field.windowWork.retunes === retunes + 1 && moved > 0, `and its window is composed under the new tables (${moved} texels moved by the order turned round)`);
}

// ---------------------------------------------------------------- a window ask the worker fails is asked again, up to its retries
{
  failNext = 'retune';
  markNow();
  field.retune();
  frameAt(eyeRaw.rx, eyeRaw.rz);
  await pump();
  ok(/asked again/.test(field.note ?? '') && field.state.state === 'ready', `a retune the worker fails is a note (${field.note})`);
  frameAt(eyeRaw.rx, eyeRaw.rz);
  const asked = since();
  ok(asked.length === 2 && asked.every((m) => m.type === 'retune'), `and is asked again at the next frame (${asked.map((m) => m.type).join(', ')})`);
  await pump();
  cardHolds('a retune asked again');
  // A strip carrying a regenerate's rectangles that fails leaves them waiting for the next.
  const r: RawRect & { heights: boolean } = { x0: eyeRaw.rx + 20, z0: eyeRaw.rz - 90, x1: eyeRaw.rx + 110, z1: eyeRaw.rz - 10, heights: false };
  const ov = await expectOverlay(r);
  await settle(field.regenerate([r], gen, null));
  overlays.poles.push(ov.poles);
  overlays.cells.push(ov.cells);
  failNext = 'strip';
  markNow();
  frameAt(eyeRaw.rx, eyeRaw.rz);
  await pump();
  frameAt(eyeRaw.rx, eyeRaw.rz);
  const again = since();
  ok(again.length === 2 && again.every((m) => m.type === 'strip') && JSON.stringify(again[0].tiles) === JSON.stringify(again[1].tiles), `a regenerate's strip the worker fails is asked again with what it carried (${again.map((m) => m.type).join(', ')})`);
  await pump();
  cardHolds('a strip asked again');
  // Failing every time: asked again WINDOW_RETRIES times, then given up until a new cause.
  failAlways = 'retune';
  markNow();
  field.retune();
  for (let i = 0; i < WINDOW_RETRIES + 4; i++) {
    frameAt(eyeRaw.rx, eyeRaw.rz);
    await pump();
  }
  const tries = since().filter((m) => m.type === 'retune').length;
  ok(tries === 1 + WINDOW_RETRIES && /given up/.test(field.note ?? ''), `a retune that always fails is asked ${tries} times (once and ${WINDOW_RETRIES} again), then given up in words (${field.note})`);
  failAlways = null;
  markNow();
  frameAt(eyeRaw.rx, eyeRaw.rz);
  ok(since().length === 0, 'given up, a frame asks nothing');
  field.retune();
  frameAt(eyeRaw.rx, eyeRaw.rz);
  ok(since().length === 1 && since()[0].type === 'retune', 'and a new retune asks again');
  await pump();
  cardHolds('a retune after giving up');
  // A strip asks itself again while the eye stays off the middle, so the cap is what stops one that always fails.
  failAlways = 'strip';
  markNow();
  for (let i = 0; i < WINDOW_RETRIES + 4; i++) {
    frameAt(-100 + 60 * 4, 60);
    await pump();
  }
  const strips = since().filter((m) => m.type === 'strip').length;
  ok(strips === 1 + WINDOW_RETRIES && /given up/.test(field.note ?? ''), `a strip that always fails is asked ${strips} times, then given up (${field.note})`);
  failAlways = null;
  markNow();
  field.retune();
  frameAt(eyeRaw.rx, eyeRaw.rz);
  await pump();
  frameAt(eyeRaw.rx, eyeRaw.rz);
  ok(since().length === 1 && since()[0].type === 'retune', 'a new cause asks again, and the retune puts the window round the eye whole');
  cardHolds('a strip given up, then a retune');
}

// ---------------------------------------------------------------- the ids: a window's error never read as an overlay's
{
  // Past many asks (the window's ids ran into the overlays' 10 and up before the review round), an error for the window in
  // flight is still the window's, and the window is asked again.
  const ids = posts.filter((m) => m.type === 'strip' || m.type === 'window' || m.type === 'retune').map((m) => m.id);
  const overlayIds = posts.filter((m) => m.type === 'overlay').map((m) => m.id);
  ok(ids.some((i) => i >= 10) && ids.every((i) => i % 2 === 0) && overlayIds.every((i) => i % 2 === 1) && !ids.some((i) => overlayIds.includes(i)), `the window's ids (${ids.length} asks, up to ${Math.max(...ids)}) and the overlays' (${overlayIds.join(', ')}) never meet`);
}

// ---------------------------------------------------------------- the knobs a retune follows
{
  const t = GROUND_DRAW_TUNE;
  const keep = { colour: t.colour, gainCap: t.gainCap, opposite: t.opposite, masks: t.masks, order: t.order, children: t.children, childCorner: [...t.childCorner], shine: t.shine, flat: t.flat, mirror: t.mirror, clouds: { ...t.clouds } };
  const k0 = tableKnobs();
  const moves: [string, () => void][] = [
    ['colour', () => (t.colour = t.colour === 'off' ? 'client' : 'off')],
    ['gainCap', () => (t.gainCap += 0.25)],
    ['opposite', () => (t.opposite = t.opposite === 'add' ? 'max' : 'add')],
    ['masks', () => (t.masks = !t.masks)],
    ['order', () => (t.order = t.order === 'first' ? 'last' : 'first')],
    ['children', () => (t.children = !t.children)],
    ['childCorner', () => (t.childCorner = ['ne'])],
  ];
  const quiet: [string, () => void][] = [
    ['shine', () => (t.shine = t.shine === 'flat' ? 'off' : 'flat')],
    ['flat', () => (t.flat += 0.1)],
    ['mirror', () => (t.mirror = !t.mirror)],
    ['clouds', () => (t.clouds.on = !t.clouds.on)],
  ];
  const restore = () => Object.assign(t, { ...keep, childCorner: [...keep.childCorner], clouds: { ...keep.clouds } });
  const moved = moves.filter(([, m]) => {
    m();
    const k = tableKnobs();
    restore();
    return k !== k0;
  }).length;
  const still = quiet.filter(([, m]) => {
    m();
    const k = tableKnobs();
    restore();
    return k === k0;
  }).length;
  ok(moved === moves.length && still === quiet.length && tableKnobs() === k0, `the tables' key moves with each knob the tables read (${moved} of ${moves.length}) and with none they do not (${still} of ${quiet.length}): a view or a shine moved asks no retune`);
}

field.dispose(session);
HORIZON_TUNE.detailReach = reachWas;
console.log(`\nhorizonWindow: ${checks} checks passed`);
