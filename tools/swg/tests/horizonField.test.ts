// The far ground's field held to its own promises (the horizon pass's first wave, its review round): a decode worker that
// fails to load, dies, sends what does not read, says the bake did not decode, or says nothing at all answers the load
// with the far tiles and words, never a wait for good; once the rings stand, a detail window that fails is a note and
// the state stays; a load let go while it fetches or decodes stops there, makes no worker after and binds nothing; the
// heights' normals read at their own step's mips (a 16 m bake one less); the camera's frustum is three's own planes to
// the bit, written out; the horizon fade's sky is carried into the program's output space; and the debug menu's reach is
// the console's (held to 500 to 32,000 m, the measurement told).
//
// Run: node tools/swg/tests/horizonField.test.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DETAIL_SIZE } from '../../../src/world/horizon/horizonDecode.ts';
import { HorizonField, RingSession, copyDome, type FieldFetch, type FieldGround, type DomeUniforms } from '../../../src/world/horizon/horizonField.ts';
import { HORIZON_FORMAT, HORIZON_SECTIONS, planBake } from '../../../src/world/horizon/horizonFile.ts';
import { HORIZON_TUNE, cameraFrustum } from '../../../src/world/horizon/horizonMath.ts';
import { HORIZON_DIALS, HORIZON_WATCH, REACH_RANGE } from '../../../src/world/horizon/horizonDials.ts';
import { RING_TEXT, ringMipOffset } from '../../../src/world/horizon/horizonRings.ts';
import { GENERATOR_REVISION } from '../../../src/swg/terrain/generator.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- a fake worker, told what to do
type Mode = 'error' | 'messageerror' | 'silent' | 'refuse' | 'decode';
let mode: Mode = 'decode';
let made = 0;
let last: FakeWorker | null = null;
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string; preventDefault(): void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  constructor() {
    made++;
    last = this;
  }
  postMessage(m: { type: string; id: number; header?: ReturnType<typeof header> }): void {
    if (m.type !== 'decode') return;
    setTimeout(() => {
      if (this.terminated) return;
      if (mode === 'error') this.onerror?.({ message: 'it would not load', preventDefault() {} });
      else if (mode === 'messageerror') this.onmessageerror?.();
      else if (mode === 'refuse') this.onmessage?.({ data: { type: 'error', id: 1, message: 'a section would not inflate' } });
      else if (mode === 'decode') this.onmessage?.({ data: { type: 'decoded', id: 1, d: decoded(m.header!) } });
    }, 5);
  }
  terminate(): void {
    this.terminated = true;
  }
}
(globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;

const centre = { x: 0, z: 0 };
const header = (step16 = false) => {
  const p = planBake(step16 ? 512 : 256, centre, { margin: 64, farMargin: 256, ...(step16 ? { fineMost: 40 } : {}) });
  return {
    format: HORIZON_FORMAT,
    source: { generator: GENERATOR_REVISION, trn: { length: 1, sha1: 'x' }, inputs: 'y', centre, layers: { sha1: 'z', list: [] }, lifeDay: false, made: 'poles' },
    fine: { ...p.fine, lo: 0, q: 1 },
    ground: p.ground,
    colour: p.colour,
    coarse: { ...p.coarse, lo: 0, q: 1 },
    sections: HORIZON_SECTIONS.map((name) => ({ name, offset: 0, length: 1, size: 1 })),
  };
};
const decoded = (h: ReturnType<typeof header>) => ({
  fine: new Float32Array(h.fine.nx * h.fine.nz),
  coarse: new Float32Array(h.coarse.nx * h.coarse.nz),
  fineNormal: new Uint8Array(h.fine.nx * h.fine.nz * 2),
  coarseNormal: new Uint8Array(h.coarse.nx * h.coarse.nz * 2),
  albedo: new Uint8Array(h.colour.nx * h.colour.nz * 4),
  coarseAlbedo: new Uint8Array(h.coarse.nx * h.coarse.nz * 4),
  pyramid: { x0: 0, z0: 0, n: 1, levels: 1, lo: [new Float32Array(1)], hi: [new Float32Array(1)] },
  detail: new Uint8Array(DETAIL_SIZE * DETAIL_SIZE),
  ms: { inflate: 0, heights: 0, normals: 0, albedo: 0, pyramid: 0, detail: 0, memo: 0 },
});
const ground: FieldGround = {
  tiler: { rank: (f) => f, layer: (f, c) => (f + c) & 7, corners: [0, 1, 2, 3] },
  colour: new Uint8Array(4 * 4 * 4 * 2),
  size: 4,
  depth: 2,
  masks: new Uint8Array(4 * 4 * 3),
  ms: 4,
  reference: null,
};
const session = new RingSession(null);
const standIn = session.uniforms.uHorizonFineH.value;
const fetchOf = (h: ReturnType<typeof header>, hold?: Promise<void>): FieldFetch => ({
  json: async () => {
    if (hold) await hold;
    return h;
  },
  bytes: async () => new Uint8Array(8),
});
const loadWith = async (m: Mode, h = header(), waitMs = 60000) => {
  mode = m;
  const f = new HorizonField('test', centre, { x: 0, z: 0 });
  f.decodeWaitMs = waitMs;
  const t0 = performance.now();
  const done = await f.load(fetchOf(h), ground, session, null, { x: 0, z: 0 });
  return { f, done, ms: performance.now() - t0 };
};

// ---------------------------------------------------------------- the worker's failures answer the load
{
  const a = await loadWith('error');
  ok(!a.done && a.f.state.state === 'refused' && /failed/.test((a.f.state as { why: string }).why) && last!.terminated, `a worker that fails to load answers the load at once with the far tiles, in words (${(a.f.state as { why: string }).why})`);
  const b = await loadWith('messageerror');
  ok(!b.done && b.f.state.state === 'refused' && /does not read/.test((b.f.state as { why: string }).why), 'one that sends what does not read, the same');
  const c = await loadWith('refuse');
  ok(!c.done && c.f.state.state === 'refused' && /did not decode/.test((c.f.state as { why: string }).why), "one that says the bake did not decode, the same");
  const d = await loadWith('silent', header(), 60);
  ok(!d.done && d.f.state.state === 'refused' && /said nothing/.test((d.f.state as { why: string }).why) && d.ms < 2000 && last!.terminated, `one that says nothing is given up after its bound and let go (${d.ms.toFixed(0)} ms at a bound of 60)`);
  ok(session.uniforms.uHorizonFineH.value === standIn, "and none of them binds anything: the session's stand-ins stand");
}

// ---------------------------------------------------------------- once ready: a detail window's failure is a note
{
  const r = await loadWith('decode');
  ok(r.done && r.f.state.state === 'ready' && session.uniforms.uHorizonFineH.value !== standIn, 'a worker that decodes readies the rings and binds its textures');
  last!.onmessage?.({ data: { type: 'error', id: 2, message: 'out of memory' } });
  ok(r.f.state.state === 'ready' && /detail window/.test(r.f.note ?? ''), `a detail window that fails afterwards leaves the rings ready, a note (${r.f.note})`);
  last!.onerror?.({ message: 'gone', preventDefault() {} });
  ok(r.f.state.state === 'ready' && /stays as it is/.test(r.f.note ?? ''), 'and the worker dying afterwards the same');
  r.f.dispose(session);
  ok(session.uniforms.uHorizonFineH.value !== r.f.fine, "let go, the session's stand-ins go back");
}

// ---------------------------------------------------------------- a load let go on its way
{
  mode = 'decode';
  const before = made;
  const shown = session.uniforms.uHorizonFineH.value;
  let open!: () => void;
  const hold = new Promise<void>((r) => (open = r));
  const f = new HorizonField('test', centre, { x: 0, z: 0 });
  const p = f.load(fetchOf(header(), hold), ground, session, null, { x: 0, z: 0 });
  f.dispose(session);
  open();
  const done = await p;
  await wait(20);
  ok(!done && made === before && session.uniforms.uHorizonFineH.value === shown, 'a load let go while it fetches stops there: no worker made, nothing bound');
  // Let go while it decodes, the worker then answering anyway: answered at once, and the late answer binds nothing.
  const g = new HorizonField('test', centre, { x: 0, z: 0 });
  const t0 = performance.now();
  const q = g.load(fetchOf(header()), ground, session, null, { x: 0, z: 0 });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  g.dispose(session);
  const qd = await q;
  await wait(20);
  ok(made === before + 1 && !qd && performance.now() - t0 < 1000 && session.uniforms.uHorizonFineH.value === shown && g.state.state !== 'ready','one let go while it decodes answers at once (whatever awaits it is not held) and binds nothing, its worker answering or not');
}

// ---------------------------------------------------------------- the normals' mips by the bake's own steps
{
  const r = await loadWith('decode', header(true));
  const h = r.f.header!;
  const u = session.uniforms;
  ok(h.fine.step === 16 && u.uHorizonFine.value.w === 1 && u.uHorizonCoarse.value.w === 3, `a 16 m bake binds its fine normals a mip down and its coarse three (${u.uHorizonFine.value.w}, ${u.uHorizonCoarse.value.w})`);
  r.f.dispose(session);
  const s = await loadWith('decode');
  ok(s.f.header!.fine.step === 8 && u.uHorizonFine.value.w === 0 && u.uHorizonCoarse.value.w === 3 && ringMipOffset(64) === 3, 'an 8 m bake none and three');
  s.f.dispose(session);
  const v = RING_TEXT.VERTEX_PARS;
  ok(v.includes('max( lod - uHorizonFine.w, 0.0 )') && v.includes('max( lod - uHorizonCoarse.w, 0.0 )') && !/lod - 3\.0/.test(v), 'and the vertex normal reads each lattice at the level less its own mips');
}

// ---------------------------------------------------------------- the frustum, three's planes written out
{
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 30000);
  const m = new THREE.Matrix4();
  const ours = new THREE.Frustum();
  const theirs = new THREE.Frustum();
  let off = 0;
  let seed = 9;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let s = 0; s < 400; s++) {
    const reversed = s % 2 === 0;
    Object.defineProperty(cam, 'reversedDepth', { value: reversed, configurable: true });
    cam.fov = 30 + 60 * rnd();
    cam.far = 2000 + 30000 * rnd();
    cam.updateProjectionMatrix();
    cam.position.set((rnd() - 0.5) * 9000, rnd() * 2500, (rnd() - 0.5) * 9000);
    cam.rotation.set((rnd() - 0.5) * 2.5, rnd() * 6.3, (rnd() - 0.5) * 0.4, 'YXZ');
    cam.updateMatrixWorld();
    cameraFrustum(cam, m, ours);
    theirs.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse), THREE.WebGLCoordinateSystem, reversed);
    for (let k = 0; k < 6; k++) {
      const a = ours.planes[k];
      const b = theirs.planes[k];
      if (!Object.is(a.normal.x, b.normal.x) || !Object.is(a.normal.y, b.normal.y) || !Object.is(a.normal.z, b.normal.z) || !Object.is(a.constant, b.constant)) off++;
    }
  }
  ok(off === 0, `the camera's frustum is three's own six planes to the bit on 400 cameras, reversed depth and not (${off} off)`);
}

// ---------------------------------------------------------------- the horizon fade in the program's output space
{
  const top = RING_TEXT.FRAGMENT_TOP;
  const fade = RING_TEXT.FRAGMENT_FADE;
  const pars = RING_TEXT.FRAGMENT_PARS;
  const raw = (t: string) => (t.match(/ringSky\(/g) ?? []).length - (t.match(/ringOut\( ringSky\(/g) ?? []).length;
  ok(raw(top) === 0 && raw(fade) === 0 && /ringOut\( ringSky\(/.test(top) && /ringOut\( ringSky\(/.test(fade), "the fade's sky (and the fog's cheap path's) goes through ringOut before it is mixed in");
  ok(/vec3 gTo = ringOut\( uHorizonFog \);/.test(fade) && /gTo = fogColor;/.test(fade), "the dome's own fog colour too, three's fogColor as three's fog mixes it");
  const body = pars.slice(pars.indexOf('vec3 ringOut('), pars.indexOf('}', pars.indexOf('vec3 ringOut(')) + 1);
  ok(/#ifdef TONE_MAPPING\s+c = toneMapping\( c \);\s+#endif\s+return linearToOutputTexel\( vec4\( c, 1\.0 \) \)\.rgb;/.test(body), "ringOut is the program's own tone mapping (where three defines one) and its own output encoding, as the dome's pixels take them");
}

// ---------------------------------------------------------------- the dome copied into one vector's fields
{
  const dome = {
    uGradient: { value: null },
    uGradient2: { value: null },
    uGradientMix: { value: 0.375 },
    uTime: { value: 0.625 },
    uHasGradient: { value: 1 },
    uHasGradient2: { value: 0 },
    uClear: { value: new THREE.Color(0.25, 0.5, 0.75) },
    uHorizonFog: { value: new THREE.Color(0.5, 0.5, 0.5) },
  } as unknown as DomeUniforms;
  const vec = session.uniforms.uRingDome.value;
  copyDome(session.uniforms, dome);
  ok(vec === session.uniforms.uRingDome.value && vec.x === 0.625 && vec.y === 1 && vec.z === 0 && vec.w === 0.375 && session.uniforms.uClear.value.b === 0.75, "the dome's four numbers go into the one vector the snippet reads under their names");
  ok(['uTime', 'uHasGradient', 'uHasGradient2', 'uGradientMix'].every((n) => new RegExp(`#define ${n} uRingDome\\.[xyzw]`).test(RING_TEXT.FRAGMENT_PARS) && new RegExp(`#undef ${n}`).test(RING_TEXT.FRAGMENT_PARS)), 'each under its own name, round ringSky alone');
}

// ---------------------------------------------------------------- the reach slider is the console's
{
  const dial = HORIZON_DIALS.groups.flatMap((g) => g.dials).find((d) => d.key === 'tune.reach') as { set(v: number): void } | undefined;
  let told = 0;
  HORIZON_WATCH.moved = () => told++;
  const was = HORIZON_TUNE.reach;
  dial!.set(99999);
  ok(HORIZON_TUNE.reach === REACH_RANGE[1] && told === 1, `the Reach slider is held to the console's top (${HORIZON_TUNE.reach} m) and the measurement told`);
  dial!.set(10);
  ok(HORIZON_TUNE.reach === REACH_RANGE[0] && told === 2, 'and its bottom');
  const look = HORIZON_DIALS.groups.flatMap((g) => g.dials).find((d) => d.key === 'tune.fogCheap') as { set(v: number): void };
  look.set(0.99);
  ok(told === 2, 'a slider the measurement does not follow tells it nothing');
  HORIZON_WATCH.moved = null;
  HORIZON_TUNE.reach = was;
  HORIZON_TUNE.fogCheap = 0.996;
}

console.log(`\nhorizonField: ${checks} checks passed`);
