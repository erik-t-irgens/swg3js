// The dents (src/world/volumetrics/airDents.ts; the volumetrics design's §2.7 and §9 Tests): the toroidal mapping (a
// world point's texel is the one the field stores and the ground reads, before and after the square moves, and the fade
// works each texel's world place back exactly); a stamp outside the square, or reaching past its edge, is never laid,
// and the ground reads nothing outside it; a stamp across a wrap line lands whole (its copies); the strips cleared are
// exactly the ones that left; a print's footprint at a person's scale, and the stamp's profile the shader's; the
// field's store in float32 (`Math.fround`) with the writes on the 10 Hz tick -- a scour pit held 120 s at impacts 2, 10
// and 30 and a mud print fading at heals 0.2 within 1% of float64 and alike at 60, 144 and 240 frames a second -- and the
// same run stored as half floats (research2's truncation toward nought) shown to fail, so the test can tell: a model of
// the store, which is all this section is (what the field's own chain gathers, lays and fades, at every rate, is
// `airMarks.test.ts`'s, through the real `AirField.update`); and the one-owner rule's table, through the real
// `AirField.dentStep` with a stand-in renderer.
//
// Plain type stripping; nothing here touches a GPU.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { AirDents, DENT_KIND, insideDentSquare, newDentSquare, placeDentSquare, stampCopies, stampProfile, toroidalTexel } from '../../../src/world/volumetrics/airDents.ts';
import { dentFade, tickClockIn, TICK } from '../../../src/world/volumetrics/airMath.ts';
import { AIR_TUNE } from '../../../src/world/volumetrics/airTune.ts';
import { AirField, newAirFrameInput } from '../../../src/world/volumetrics/airField.ts';
import { newVolTune } from '../../../src/world/volumetrics/volSettings.ts';
import { facingOf, PRINT_TUNE, sideOf, stanceOffset } from '../../../src/world/footprints.ts';
import type { FootStep } from '../../../src/audio/footsteps.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
let seed = 0x0d3e7a11;
const rand = (): number => {
  seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
  return (seed >>> 0) / 4294967296;
};
const P = AIR_TUNE.prints;
const SIZE = P.square;

// --- the toroidal mapping ---
{
  let same = true;
  let back = true;
  for (const n of [1024, 2048, 4096]) {
    const t = SIZE / n;
    for (let i = 0; i < 4000; i++) {
      const w = (rand() - 0.5) * 20000;
      // What the stamp writes at (u = fract(w / size), the texel under it) and what the ground reads with repeat
      // wrapping at w / size: one texel, `floor(w / t) mod n`, whatever the square.
      const u = w / SIZE - Math.floor(w / SIZE);
      if (Math.floor(u * n) !== toroidalTexel(w, t, n)) same = false;
    }
    // The fade works each texel's world texel back from the square's first: k0 + mod(i - k0, n), the shader's line.
    const sq = newDentSquare();
    for (let m = 0; m < 50; m++) {
      placeDentSquare(sq, (rand() - 0.5) * 20000, (rand() - 0.5) * 20000, SIZE, n);
      for (let j = 0; j < 40; j++) {
        const K = sq.k0x + Math.floor(rand() * n);
        const i = toroidalTexel((K + 0.5) * t, t, n);
        const mod = (a: number, b: number): number => a - b * Math.floor(a / b);
        if (sq.k0x + mod(i - sq.k0x, n) !== K) back = false;
      }
    }
  }
  ok(same, 'a world point\'s texel is the same where the stamp writes it and where the ground reads it, at every print detail and wherever the square stands');
  ok(back, 'and the fade works every texel\'s world place back exactly from where the square stands');
  const shader = readFileSync(new URL('../../../src/world/volumetrics/airShaders.ts', import.meta.url), 'utf8');
  ok(shader.includes('vec2 k = uDentSquare.xy + mod(i - uDentSquare.xy, uDentSquare.z);'), 'which is the fade shader\'s own line');
}

// --- the strips that left ---
{
  const sq = newDentSquare();
  placeDentSquare(sq, 0, 0, SIZE, 2048);
  ok(sq.placed && sq.all, 'the first placing clears everything');
  let exact = true;
  let alls = 0;
  let moves = 0;
  const n = 2048;
  const t = SIZE / n;
  for (let m = 0; m < 400; m++) {
    const old = { x: sq.k0x, z: sq.k0z };
    const big = rand() < 0.05;
    const cam = { x: old.x * t + SIZE / 2 + (rand() - 0.5) * (big ? 400 : 20), z: old.z * t + SIZE / 2 + (rand() - 0.5) * (big ? 400 : 20) };
    placeDentSquare(sq, cam.x, cam.z, SIZE, n);
    const leftCols = new Set<number>();
    const leftRows = new Set<number>();
    for (let i = 0; i < sq.colRuns; i++) for (let c = 0; c < sq.cols[i * 2 + 1]; c++) leftCols.add(sq.cols[i * 2] + c);
    for (let i = 0; i < sq.rowRuns; i++) for (let c = 0; c < sq.rows[i * 2 + 1]; c++) leftRows.add(sq.rows[i * 2] + c);
    if (Math.abs(sq.k0x - old.x) >= n || Math.abs(sq.k0z - old.z) >= n) {
      if (!sq.all) exact = false;
      alls++;
      continue;
    }
    moves++;
    const want = (from: number, to: number): Set<number> => {
      const s = new Set<number>();
      // The world columns of the new square that the old did not hold: the ground coming in, which takes the toroidal
      // texels of exactly the columns that left.
      for (let k = to; k < to + n; k++) if (k < from || k >= from + n) s.add(((k % n) + n) % n);
      return s;
    };
    const wc = want(old.x, sq.k0x);
    const wr = want(old.z, sq.k0z);
    const eq = (a: Set<number>, b: Set<number>): boolean => a.size === b.size && [...a].every((x) => b.has(x));
    if (!eq(leftCols, wc) || !eq(leftRows, wr) || sq.all) exact = false;
    // And no column or row both squares hold is cleared.
    for (let k = Math.max(old.x, sq.k0x); k < Math.min(old.x, sq.k0x) + n; k += 97) if (leftCols.has(((k % n) + n) % n)) exact = false;
  }
  ok(exact && moves > 300 && alls > 0, `over ${moves} moves the strips cleared are exactly the toroidal texels of the ground that came in (the ones that left), none the two squares share; ${alls} moves past the square clear it all`);
  placeDentSquare(sq, 0, 0, SIZE, 1024);
  ok(sq.all, 'and a new print detail clears it all');
}

// --- outside the square: nothing laid, nothing read ---
const fakeWorld = (dents: AirDents, gives = 85, medium = 85): void => {
  const n = 128;
  dents.window = { ox: -96, oz: -96, size: 192, cells: n, cell: 1.5, placed: true, moveX: 0, moveZ: 0, resets: 1 } as never;
  const response = new Uint8Array(n * n * 4);
  const colour = new Uint8Array(n * n * 4);
  for (let k = 0; k < n * n; k++) {
    response[k * 4 + 1] = 255;
    response[k * 4 + 2] = gives;
    colour[k * 4 + 3] = medium;
  }
  dents.raster = { n, known: new Uint8Array(n * n).fill(1), response, colour } as never;
};
{
  const dents = new AirDents({ value: null }, { value: null }, { value: new THREE.Vector4() });
  fakeWorld(dents);
  placeDentSquare(dents.square, 0, 0, SIZE, 2048);
  const x0 = dents.square.k0x * dents.square.t;
  ok(dents.oneShot(0, 0, 0.5, 0.5, 1, 0, 0.05, DENT_KIND.bowl) && dents.oneCount === 1, 'a stamp inside the square is owed');
  ok(!dents.oneShot(x0 + SIZE + 5, 0, 0.5, 0.5, 1, 0, 0.05, DENT_KIND.bowl) && !dents.oneShot(x0 + 0.3, 0, 0.5, 0.5, 1, 0, 0.05, DENT_KIND.bowl) && dents.counts.offSquare === 2 && dents.oneCount === 1, 'one outside the square, or reaching past its edge, is not: it would land on the texels that stand for the far side');
  ok(!dents.oneShot(0, 0, 0.5, 0.5, 1, 0, Number.NaN, 0) && !dents.oneShot(0, 0, 0.5, 0.5, 1, 0, -1, 0) && dents.oneCount === 1, 'nor a NaN or a negative depth');
  ok(insideDentSquare(dents.square, 0, 0, P.squareEdge) && !insideDentSquare(dents.square, x0 - 1, 0, 0) && !insideDentSquare(dents.square, x0 + 2, 0, P.squareEdge), 'a footstep is asked inside it by its edge band, outside it never');
  const g = readFileSync(new URL('../../../src/world/volumetrics/airGround.ts', import.meta.url), 'utf8');
  ok(g.includes('float gAirDIn = airEdge( ( gAirD - uAirDentP.xy ) / uAirDentP.z, uAirDentP.w / uAirDentP.z );') && g.includes('if ( gAirDIn > 0.0 ) {') && g.includes('if ( d <= 0.0 ) return 0.0;'), 'and the ground reads a dent only inside the square, fading across its edge band, nothing past it');
  const rock = new AirDents({ value: null }, { value: null }, { value: new THREE.Vector4() });
  fakeWorld(rock, 0);
  placeDentSquare(rock.square, 0, 0, SIZE, 2048);
  const water = new AirDents({ value: null }, { value: null }, { value: new THREE.Vector4() });
  fakeWorld(water, 85, 170);
  placeDentSquare(water.square, 0, 0, SIZE, 2048);
  ok(!rock.oneShot(0, 0, 0.5, 0.5, 1, 0, 0.05, 0) && !water.oneShot(0, 0, 0.5, 0.5, 1, 0, 0.05, 0) && rock.counts.noGive === 1 && water.counts.noGive === 1, 'nor on ground that gives nothing, or on a liquid');
  dents.buildBatch(0);
  ok(Math.abs(dents.stampB[2] - 0.05 * (85 / 255) * 3) < 1e-6, 'its depth is taken by how far the ground gives where it lands (sand one)');
}

// --- a stamp across a wrap line lands whole ---
{
  const dents = new AirDents({ value: null }, { value: null }, { value: new THREE.Vector4() });
  fakeWorld(dents);
  placeDentSquare(dents.square, 0, 0, SIZE, 2048);
  const cases: [number, number, number][] = [
    [30, 20, 1],
    [0.1, 20, 2],
    [20, -0.2, 2],
    [0.1, -0.1, 4],
  ];
  const out = new Int8Array(8);
  let right = true;
  let whole = true;
  for (const [x, z, want] of cases) {
    const along = 0.6;
    const across = 0.4;
    dents.oneShot(x, z, along, across, 1, 0, 0.05, DENT_KIND.bowl);
    const count = dents.buildBatch(0);
    const u = x / SIZE - Math.floor(x / SIZE);
    const v = z / SIZE - Math.floor(z / SIZE);
    const reach = (1.42 * Math.sqrt(along * along + across * across)) / SIZE;
    const named = stampCopies(u, v, reach, out);
    if (count !== want || named !== want) right = false;
    for (let c = 0; c < count; c++) if (Math.abs(dents.stampA[c * 4] - (u + out[c * 2])) > 1e-6 || Math.abs(dents.stampA[c * 4 + 1] - (v + out[c * 2 + 1])) > 1e-6) right = false;
    // Every point of the stamp's quad, wrapped into the field, lies in one of the copies' quads.
    for (let i = 0; i < 400; i++) {
      const du = (rand() * 2 - 1) * reach;
      const dv = (rand() * 2 - 1) * reach;
      const fu = u + du - Math.floor(u + du);
      const fv = v + dv - Math.floor(v + dv);
      let found = false;
      for (let c = 0; c < count && !found; c++) if (Math.abs(fu - dents.stampA[c * 4]) <= reach + 1e-9 && Math.abs(fv - dents.stampA[c * 4 + 1]) <= reach + 1e-9) found = true;
      if (!found) whole = false;
    }
  }
  ok(right, 'a stamp crossing one wrap line is drawn twice and one crossing both four times, at the copies stampCopies names');
  ok(whole, 'and every point of it lands in one of its copies: it lands whole');
}

// --- a print at a person's scale, and the profile the shader's ---
{
  const along = P.footAlong / 2;
  const across = P.footAcross / 2;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let lip = 0;
  let edge = 0;
  for (let i = 0; i <= 280; i++) {
    for (let j = 0; j <= 280; j++) {
      const lx = -1.4 + (i / 280) * 2.8;
      const ly = -1.4 + (j / 280) * 2.8;
      const d = stampProfile(DENT_KIND.foot, lx, ly);
      if (d < 0) lip++;
      if ((i === 0 || i === 280 || j === 0 || j === 280) && d !== 0) edge++;
      if (d > 0.05) {
        minX = Math.min(minX, lx * along);
        maxX = Math.max(maxX, lx * along);
        minY = Math.min(minY, ly * across);
        maxY = Math.max(maxY, ly * across);
      }
    }
  }
  const len = maxX - minX;
  const wide = maxY - minY;
  ok(len > 0.25 && len < 0.36 && wide > 0.08 && wide < 0.16, `a person's print is ${len.toFixed(3)} m heel to toe and ${wide.toFixed(3)} m across (a boot's)`);
  ok(Math.abs(stampProfile(DENT_KIND.foot, 0.42, 0) - 1) < 1e-12 && Math.abs(stampProfile(DENT_KIND.foot, -0.55, 0) - 1) < 1e-12 && stampProfile(DENT_KIND.foot, -0.05, 0.6) < 0.5, 'pressed full at the ball and the heel, less at the arch');
  ok(lip === 0 && edge === 0, 'a footprint raises no lip and is nought at its quad\'s edge: no hard border');
  ok(Math.abs(stampProfile(DENT_KIND.bowl, 0, 0) - 1) < 1e-3 && stampProfile(DENT_KIND.bowl, 1.08, 0) < -0.2 && Math.abs(stampProfile(DENT_KIND.bowl, 1.4, 0)) < 0.01, 'a bowl is full in its middle with a raised lip at its rim, nearly nought at its quad\'s edge');
  const shader = readFileSync(new URL('../../../src/world/volumetrics/airShaders.ts', import.meta.url), 'utf8');
  ok(shader.includes('vec2 lc = position.xy * 1.4;') && shader.includes('float bowl = 1.0 - smoothstep(0.0, 1.0, r);') && shader.includes('d = bowl * bowl - lip;') && shader.includes('float lipR = (r - 1.08) / 0.16;') && shader.includes('float lip = exp(-lipR * lipR) * 0.30;') && shader.includes('float toe = 1.0 - length(vec2((q.x - 0.42) / 0.58, q.y / 0.86));') && shader.includes('float heel = 1.0 - length(vec2((q.x + 0.55) / 0.42, q.y / 0.70));') && shader.includes('d = smoothstep(0.0, 0.55, clamp(max(toe, heel), 0.0, 1.0));'), 'and the profile is the stamp shader\'s, line for line, the bowl\'s too');
  // `dentStep` writes `facingOf`'s, `sideOf`'s and `stanceOffset`'s lines out (a number across a call boxed on the
  // moving frames): held to them here.
  const f = { x: 0, z: 0 };
  const s = { x: 0, z: 0 };
  let same = true;
  for (let i = 0; i < 200; i++) {
    const h = (rand() - 0.5) * 20;
    const scale = 0.2 + rand() * 2;
    facingOf(h, f);
    sideOf(h, s);
    for (const left of [true, false]) {
      const off = stanceOffset(PRINT_TUNE.stance, scale, left);
      const mine = PRINT_TUNE.stance * scale * (left ? -1 : 1);
      if (!Object.is(off, mine) || !Object.is(s.x * off, Math.cos(h) * mine) || !Object.is(s.z * off, -Math.sin(h) * mine) || !Object.is(f.x, Math.sin(h)) || !Object.is(f.z, Math.cos(h))) same = false;
    }
  }
  const field = readFileSync(new URL('../../../src/world/volumetrics/airField.ts', import.meta.url), 'utf8');
  ok(same && field.includes('q[0] = sx + cosH * off;') && field.includes('q[1] = sz - sinH * off;') && field.includes('q[4] = sinH;') && field.includes('q[5] = cosH;') && field.includes('const off = PRINT_TUNE.stance * scale * (left ? -1 : 1);'), "dentStep's facing, side and stance are footprints.ts's, to the bit");
}

// --- the arithmetic: float32 on the tick, and half floats shown to fail ---
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
/** research2's half-float store: truncated toward nought (and round to nearest, to show both). */
function half(x: number, mode: 'truncate' | 'nearest'): number {
  f32[0] = x;
  const b = u32[0];
  const sign = (b >>> 16) & 0x8000;
  const exp = ((b >>> 23) & 0xff) - 127 + 15;
  let mant = b & 0x7fffff;
  let h: number;
  if (exp >= 31) h = sign | 0x7c00;
  else if (exp <= 0) {
    if (exp < -10) h = sign;
    else {
      mant |= 0x800000;
      const shift = 14 - exp;
      h = mant >>> shift;
      if (mode === 'nearest') {
        const rem = mant & ((1 << shift) - 1);
        const halfway = 1 << (shift - 1);
        if (rem > halfway || (rem === halfway && h & 1)) h++;
      }
      h |= sign;
    }
  } else {
    h = (exp << 10) | (mant >>> 13);
    if (mode === 'nearest') {
      const rem = mant & 0x1fff;
      if (rem > 0x1000 || (rem === 0x1000 && h & 1)) h++;
    }
    h |= sign;
  }
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >>> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? Number.NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}
type Store = (x: number) => number;
const F64: Store = (x) => x;
const F32: Store = Math.fround;
const HALF: Store = (x) => half(x, 'truncate');
/** A scour pit held `seconds` at `impact`: gathered on the CPU in float64 (`slotDepth`), laid and faded on each tick. */
function pit(fps: number, impact: number, store: Store, seconds = 120, heals = 1): number {
  const clock = { acc: 0, dt: 1 / fps, ticks: 0 };
  const rate = P.scour * impact;
  let gathered = 0;
  let d = 0;
  for (let i = 0; i < seconds * fps; i++) {
    gathered += rate * clock.dt;
    tickClockIn(clock);
    if (clock.ticks > 0) {
      d = store(d + store(gathered));
      gathered = 0;
      d = store(d * store(dentFade(clock.ticks, heals)));
    }
  }
  return d;
}
/** A print pressed once at `depth` and faded on each tick at `heals`. */
function print(fps: number, depth: number, heals: number, store: Store, seconds = 120): number {
  const clock = { acc: 0, dt: 1 / fps, ticks: 0 };
  let d = store(depth);
  for (let i = 0; i < seconds * fps; i++) {
    tickClockIn(clock);
    if (clock.ticks > 0) d = store(d * store(dentFade(clock.ticks, heals)));
  }
  return d;
}
{
  const fpss = [60, 144, 240];
  const rel = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b);
  for (const impact of [2, 10, 30]) {
    const truth = pit(60, impact, F64);
    const got = fpss.map((fps) => pit(fps, impact, F32));
    const exact = fpss.map((fps) => pit(fps, impact, F64));
    ok(got.every((g) => rel(g, truth) < 0.01) && exact.every((e) => rel(e, truth) < 0.01), `a scour pit held 120 s at impact ${impact} is ${truth.toFixed(4)} m in float64 and ${got.map((g) => g.toFixed(4)).join(', ')} m in float32 at ${fpss.join(', ')} frames a second: within 1%, alike at every rate`);
    const halves = fpss.map((fps) => pit(fps, impact, HALF));
    ok(halves.some((h) => rel(h, truth) > 0.01), `stored as half floats it comes to ${halves.map((h) => h.toFixed(4)).join(', ')} m: the test can tell`);
  }
  // A mud print: a person's depth times mud's give, fading at mud's heals.
  const mudDepth = P.footDepth * 2.5;
  const truth = print(60, mudDepth, 0.2, F64);
  const got = fpss.map((fps) => print(fps, mudDepth, 0.2, F32));
  ok(truth > 0.02 && truth < mudDepth && got.every((g) => rel(g, truth) < 0.01), `a mud print ${mudDepth.toFixed(4)} m deep fading at heals 0.2 is ${truth.toFixed(4)} m after 120 s in float64 and ${got.map((g) => g.toFixed(4)).join(', ')} m in float32: within 1%, alike at every rate`);
  const halves = fpss.map((fps) => print(fps, mudDepth, 0.2, HALF));
  const nearest = print(60, mudDepth, 0.2, (x) => half(x, 'nearest'));
  ok(halves.every((h) => rel(h, truth) > 0.01) && rel(nearest, truth) > 0.01, `stored as half floats it comes to ${halves[0].toFixed(4)} m truncated and ${nearest.toFixed(4)} m rounded: the test can tell`);
  ok(TICK === 0.1 && Math.abs(dentFade(1, 1, 25) - Math.exp(-0.004)) < 1e-15, 'one tick fades a sand dent by exp(-0.1 / 25)');
}

// --- the one owner of a footprint ---
{
  const ext: Record<string, unknown> = {};
  const noop = (): void => {};
  const stub = (blend: boolean) =>
    ({
      autoClear: true,
      getContext: () => ({ getExtension: (name: string) => (name === 'EXT_float_blend' && !blend ? null : ext), RED: 6403, RG: 33319, IMPLEMENTATION_COLOR_READ_FORMAT: 35739, getParameter: (): number => 6408 }),
      getRenderTarget: (): null => null,
      setRenderTarget: noop,
      getClearAlpha: (): number => 1,
      getClearColor: (c: THREE.Color): THREE.Color => c,
      setClearColor: noop,
      render: noop,
      clear: noop,
      renderBufferDirect: noop,
      compile: noop,
      info: { programs: [] as unknown[] },
      properties: { get: (): object => ({}) },
    }) as unknown as THREE.WebGLRenderer;
  // Sand west of x 40, rock east of it, water north of z 40; the ground at nought.
  const ground = {
    sample(x: number, z: number, out: { h: number; family: number; medium: number }): boolean {
      out.h = 0;
      out.family = x >= 40 ? 2 : 1;
      out.medium = z >= 40 ? 2 : 1;
      return true;
    },
  };
  const make = (blend = true) => {
    const tune = newVolTune();
    tune.on = true;
    const field = new AirField(stub(blend), tune, { ground, boxes: null, hulls: [] });
    const table = new Uint8Array(3 * 4);
    table.set([255, 255, 85, 255], 4);
    table.set([0, 0, 0, 0], 8);
    field.raster.familyResponse = table;
    const inp = newAirFrameInput();
    inp.dt = 1 / 60;
    inp.reading = true;
    inp.ground = true;
    for (let i = 0; i < 20; i++) field.update(inp);
    return { field, tune, inp };
  };
  const step = (o: Partial<FootStep> = {}): FootStep => ({ key: 3, kind: 'player', label: 'you', surface: 'sand', from: 'terrain', x: 2, y: 0, z: 1, heading: 0.4, scale: 1, inside: false, deck: null, ground: null, ...o }) as FootStep;
  const rows: string[] = [];
  let right = true;
  const row = (name: string, field: AirField, s: FootStep, owned: boolean, laid: boolean): void => {
    const c = field.feetCounts;
    const decal = c.decal;
    const dents = c.dents;
    const queued = field.dents?.oneCount ?? 0;
    const got = field.dentStep(s);
    const decalLaid = c.decal - decal;
    const dentLaid = c.dents - dents;
    const newOnes = (field.dents?.oneCount ?? 0) - queued;
    const fine = got === owned && decalLaid === (owned ? 0 : 1) && dentLaid === (laid ? 1 : 0) && newOnes === (laid ? 1 : 0);
    if (!fine) right = false;
    rows.push(`${name}: ${got ? 'the air\'s' : 'the decal\'s'}${laid ? ', a dent' : ''}${fine ? '' : ' (WRONG)'}`);
  };
  const a = make();
  ok(a.field.dents !== null && a.field.floatBlend && a.field.dents.target !== null, 'a field on a browser that blends floats keeps dents');
  row('a step on sand', a.field, step(), true, true);
  row('the next too soon after it (a shuffle)', a.field, step({ x: 2.1 }), true, false);
  row('the other foot, a stride on', a.field, step({ x: 2.8 }), true, true);
  row('indoors', a.field, step({ x: 5, inside: true }), false, false);
  row('on a deck', a.field, step({ x: 6, deck: {} as never }), false, false);
  row('in the water', a.field, step({ x: 7, surface: null }), false, false);
  row('off the dent square', a.field, step({ x: 62 }), false, false);
  row('on rock', a.field, step({ x: 45 }), false, false);
  row('on a liquid cell', a.field, step({ x: 8, z: 45 }), false, false);
  row('on a crate over the sand', a.field, step({ x: 9, y: 1.5 }), false, false);
  row('on a thing the feet found under the foot', a.field, step({ x: 9.4, from: 'object' }), false, false);
  row('a stride on, the foot a third of a metre over the ground (still on it)', a.field, step({ x: 9.8, y: 0.3 }), true, true);
  a.tune.artPrints = 0;
  row('with the prints\' art dial at nought', a.field, step({ x: 10 }), false, false);
  a.tune.artPrints = 1;
  a.tune.fromFeet = false;
  row('with the feet switched off', a.field, step({ x: 11 }), false, false);
  a.tune.fromFeet = true;
  a.tune.prints = false;
  a.field.update(a.inp);
  row('with the prints switched off', a.field, step({ x: 12 }), false, false);
  a.tune.prints = true;
  a.inp.ground = false;
  a.field.update(a.inp);
  row('with the ground on its plain material', a.field, step({ x: 13 }), false, false);
  a.inp.ground = true;
  a.field.update(a.inp);
  // The one-shot queue full: the foot's own decal, never nothing.
  for (let i = 0; i < 200; i++) a.field.dents?.oneShot(-10 + (i % 20), -10 + Math.floor(i / 20), 0.3, 0.3, 1, 0, 0.01, 0);
  row('with this frame\'s stamps already full', a.field, step({ x: 14 }), false, false);
  a.tune.on = false;
  a.field.update(a.inp);
  row('with the master off', a.field, step({ x: 15 }), false, false);
  const b = make(false);
  ok(b.field.dents === null && b.field.floatBlend === false, 'a browser that cannot blend floats keeps no dents');
  row('on a browser that cannot blend floats', b.field, step(), false, false);
  for (const r of rows) console.log(`     ${r}`);
  ok(right && rows.length === 19, `the one-owner rule over ${rows.length} rows: a step is the air's (a dent, or nothing when too soon) or today's decal, never both and never neither`);
}

console.log(`\n${checks} checks passed`);
