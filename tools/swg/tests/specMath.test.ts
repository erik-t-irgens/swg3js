// The client's own highlight, as arithmetic (`src/world/specMath.ts`, which `specular.ts` injects line for line
// and `__debug.specSelfTest()` draws against).
//
// What is pinned, rather than what is easy:
//
//  - **The peak is the colour times the mask**, relative to a white surface facing the same light, for the
//    pairs of colour and power the converted models really carry (read out of the packs' own GLBs, or a
//    handful of the archives' commonest where there are none), until the cap.
//  - **The falloff is the power's own**, off the peak, for the same real pairs: at the peak every power gives
//    one, so the peak alone says nothing of the power.
//  - **The width is the client's**: at the median power of 20 the plain highlight is 15 degrees wide at half
//    its height, measured off the shape and not worked out from the closed form, and so is the band's.
//  - **The band is the client's**: it peaks at N.H 0.8 at 0.85 of the colour, and is multiplied by N.L.
//  - **The film is taken by the weather**: the wetter of the surface and its puddle, or the snow on it.
//  - **The cap holds**: glass's colour of 10 is drawn as a white surface facing the light and no brighter.
//  - **No NaN anywhere**: N.H below nought (pow of a negative is NaN, and a NaN pixel is a screen-sized
//    black box once the bloom has spread it), a power of nought or less, a light straight behind the eye.
//
// Run: node tools/swg/tests/specMath.test.ts
import assert from 'node:assert/strict';
import { closeSync, existsSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import {
  BAND_PEAK_NH,
  SPEC_MODE_CODE,
  SPEC_TUNE,
  bandShape,
  blinnShape,
  clientSpecular,
  filmShare,
  halfWidthDeg,
  relativePeak,
  specShape,
  specValues,
  weatherShare,
  type SpecTune,
  type Vec3,
} from '../../../src/world/specMath.ts';
import { PACKS, glbsUnder } from './materialsHarness.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string) => console.log(`note ${s}`);
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const TUNE: SpecTune = { use: 'client', gain: 1, cap: 1, film: 1, gate: 0 };
const WHITE: Vec3 = [Math.PI, Math.PI, Math.PI];
const unit = (x: number, y: number, z: number): Vec3 => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
};

// ---------------------------------------------------------------- the defaults

ok(SPEC_TUNE.use === 'client' && SPEC_TUNE.gain === 1 && SPEC_TUNE.cap === 1 && SPEC_TUNE.film === 1 && SPEC_TUNE.gate === 0, "the tune starts at the client's own strength, the cap at a white surface, the full film in rain and no N.L gate");
ok(SPEC_MODE_CODE.none === 0 && SPEC_MODE_CODE.phong === 1 && SPEC_MODE_CODE.aniso === 2, 'the modes are the codes the shader branches on');

// ---------------------------------------------------------------- what a material says, made safe

{
  const v = specValues({ mode: 'aniso', color: [0.5, 0.25, 0.125], power: 20, mask: 'NRML.a' });
  ok(v.mode === 2 && v.color.join() === '0.5,0.25,0.125' && v.power === 20, "a material's own extras become its uniforms as they stand");
  ok(specValues({ mode: 'phong', color: [1, 1], power: 20 }).mode === 0, 'a colour that is not three numbers draws no highlight rather than a NaN');
  ok(specValues({ mode: 'phong', color: [1, Number.NaN, 1], power: 20 }).mode === 0, 'nor does one with a NaN in it');
  ok(specValues({ mode: 'gloss', color: [1, 1, 1], power: 20 }).mode === 0, 'a mode it does not know is none');
  const inherited = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'].map((mode) => specValues({ mode, color: [1, 1, 1], power: 20 }).mode);
  ok(inherited.every((m) => m === 0), `and so is a name every object inherits, rather than a function handed to a uniform (${inherited.join(', ')})`);
  ok(specValues(undefined).mode === 0 && specValues(null).power === 0, 'and a material that says nothing says no highlight');
  const neg = specValues({ mode: 'phong', color: [-1, 2, 3], power: -5 });
  ok(neg.color[0] === 0 && neg.power === 0, 'a negative colour or power is held at nought');
}

// ---------------------------------------------------------------- the peak, from real MATLs

/** The JSON chunk of a GLB, read without the rest of the file (a species rig is 200 MB of clips). */
function glbJson(file: string): { materials?: { name?: string; extras?: { swgSpec?: { mode?: string; color?: number[]; power?: number } } }[] } | null {
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(20);
    if (readSync(fd, head, 0, 20, 0) < 20 || head.toString('latin1', 0, 4) !== 'glTF' || head.toString('latin1', 16, 20) !== 'JSON') return null;
    const len = head.readUInt32LE(12);
    const body = Buffer.alloc(len);
    readSync(fd, body, 0, len, 20);
    return JSON.parse(body.toString('utf8'));
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

{
  const pairs = new Map<string, { mode: string; s: number; p: number; shader: string }>();
  for (const folder of ['tatooine', 'weapons', join('wardrobe', 'human_male'), join('characters', 'human_male'), 'flora', 'ships']) {
    const dir = join(PACKS, folder);
    if (!existsSync(dir)) continue;
    for (const f of glbsUnder(dir, 60)) {
      for (const m of glbJson(f)?.materials ?? []) {
        const s = m.extras?.swgSpec;
        if (!s || (s.mode !== 'phong' && s.mode !== 'aniso') || !Array.isArray(s.color)) continue;
        for (const channel of s.color) pairs.set(`${s.mode}|${channel}|${s.power}`, { mode: s.mode, s: channel, p: s.power ?? 0, shader: m.name ?? '' });
      }
    }
  }
  const real = pairs.size > 0;
  if (!real) {
    note(`no pack converted at material format 6 under ${PACKS}: the archives' commonest colours and powers stand in`);
    for (const [mode, s, p] of [['phong', 0.5, 20], ['phong', 1, 20], ['phong', 0.5, 35], ['aniso', 0.413, 20], ['phong', 1.5, 30], ['phong', 10, 8], ['phong', 6, 40]] as const) pairs.set(`${mode}|${s}|${p}`, { mode, s, p, shader: '(stand-in)' });
  }
  // The peak relative to a white surface facing the light: drawn at the mirror direction (N = L = V) for the
  // plain highlight and at the band's own N.H with N.L its best for the band, then divided by a white surface's
  // light, which is the light over pi.
  let worst = 0;
  let worstAt = '';
  let checked = 0;
  for (const { mode, s, p, shader } of pairs.values()) {
    const code = SPEC_MODE_CODE[mode as 'phong' | 'aniso'];
    for (const mask of [1, 0.5, 0.2]) {
      const out: Vec3 = [0, 0, 0];
      let peak = 0;
      if (code === 1) {
        const n: Vec3 = [0, 0, 1];
        clientSpecular(out, WHITE, [s, s, s], mask, code, p, n, n, n, TUNE);
        peak = (out[0] * Math.PI) / WHITE[0];
      } else {
        // The band's peak with N.L at its best: L along N and the eye turned so the half vector makes N.H
        // exactly 0.8 (the eye at twice the half vector's angle off the normal).
        const r = 2 * Math.acos(BAND_PEAK_NH);
        clientSpecular(out, WHITE, [s, s, s], mask, code, p, [0, 0, 1], [0, 0, 1], [Math.sin(r), 0, Math.cos(r)], TUNE);
        peak = (out[0] * Math.PI) / WHITE[0];
      }
      const want = Math.min((code === 2 ? 0.85 : 1) * s * mask, TUNE.cap);
      const err = Math.abs(peak - want);
      if (err > worst) {
        worst = err;
        worstAt = `${shader} ${mode} s ${s} p ${p} mask ${mask}: ${peak.toFixed(4)} against ${want.toFixed(4)}`;
      }
      if (!near(relativePeak(s, mask, code, p, TUNE), Math.min((code === 2 ? bandShape(BAND_PEAK_NH, p) : 1) * s * mask, TUNE.cap), 1e-12)) worst = Infinity;
      checked++;
    }
  }
  ok(worst < 2e-3, `the peak is the specular colour times the mask relative to a white surface facing the light (0.85 of it on the band), until the cap, over ${checked} colour, power and mask cases ${real ? `from ${pairs.size} the converted models carry` : 'standing in for them'} (worst ${worst.toFixed(5)}${worstAt ? `, ${worstAt}` : ''})`);

  // At the peak every power is one (N.H 1 to any power, the band's base 1 to any power), so the peak alone says
  // nothing of the power. Off it, the same pairs against the closed forms written out here and not through the
  // file's own shapes: the plain highlight 10 and 25 degrees off the mirror is cos to the power, and the band at
  // N.H 0.9 and 0.7 is one less the distance of 1.25 N.H from one, to 0.15 of the power, less 0.15.
  let offWorst = 0;
  let offAt = '';
  let offChecked = 0;
  const bandClosed = (nh: number, p: number) => Math.max(0, Math.pow(1 - Math.abs(1 - 1.25 * nh), 0.15 * p) - 0.15);
  for (const { mode, s, p, shader } of pairs.values()) {
    const code = SPEC_MODE_CODE[mode as 'phong' | 'aniso'];
    for (const mask of [1, 0.5]) {
      const out: Vec3 = [0, 0, 0];
      for (const off of code === 1 ? [10, 25] : [0.9, 0.7]) {
        let got = 0;
        let want = 0;
        if (code === 1) {
          // L and V together, turned off the normal: H is L, N.H is cos of the turn.
          const a = (off * Math.PI) / 180;
          const lv: Vec3 = [Math.sin(a), 0, Math.cos(a)];
          clientSpecular(out, WHITE, [s, s, s], mask, code, p, [0, 0, 1], lv, lv, TUNE);
          got = (out[0] * Math.PI) / WHITE[0];
          want = Math.min(s * mask * Math.pow(Math.cos(a), p), TUNE.cap);
        } else {
          // L along N (N.L one) and the eye turned so N.H is the value asked for.
          const r = 2 * Math.acos(off);
          clientSpecular(out, WHITE, [s, s, s], mask, code, p, [0, 0, 1], [0, 0, 1], [Math.sin(r), 0, Math.cos(r)], TUNE);
          got = (out[0] * Math.PI) / WHITE[0];
          want = Math.min(s * mask * bandClosed(off, p), TUNE.cap);
        }
        const err = Math.abs(got - want);
        if (err > offWorst) {
          offWorst = err;
          offAt = `${shader} ${mode} s ${s} p ${p} mask ${mask} at ${off}: ${got.toFixed(5)} against ${want.toFixed(5)}`;
        }
        offChecked++;
      }
    }
  }
  ok(offWorst < 1e-9, `off the peak the falloff is the power's own, over ${offChecked} cases from the same pairs: (N.H)^p on the plain highlight, the band's own curve on the band (worst ${offWorst.toExponential(2)}${offAt ? `, ${offAt}` : ''})`);
}

// ---------------------------------------------------------------- the width and the band

{
  const w = halfWidthDeg(20);
  ok(near(w, 15, 0.5), `at power 20 the plain highlight is ${w.toFixed(2)} degrees wide at half its height, the client's 15`);
  ok(halfWidthDeg(40) < w && halfWidthDeg(8) > w, 'a higher power is narrower and a lower one broader');
  let best = 0;
  let bestAt = 0;
  for (let i = 0; i <= 10000; i++) {
    const nh = i / 10000;
    const b = bandShape(nh, 20);
    if (b > best) {
      best = b;
      bestAt = nh;
    }
  }
  ok(near(bestAt, 0.8, 1e-3) && near(best, 0.85, 1e-9), `the band peaks at N.H ${bestAt.toFixed(4)} at ${best.toFixed(4)} of the colour: the client's 0.8 and 0.85`);
  ok(bandShape(1, 20) < 0.5 && bandShape(0.4, 20) < 0.25, 'and falls away either side of it, so hair shines in a ring and not a dot');
  // How wide the ring is, which is what the power sets: at 20 the band is (1 - |1 - 1.25 N.H|)^3 - 0.15, at half
  // its height (0.425) where the base is 0.575 to the third root, so between N.H (1 - d) / 1.25 and (1 + d) / 1.25
  // with d = 1 - 0.575^(1/3). Found on the shape by bisection either side of the peak, not from that form.
  const d = 1 - Math.cbrt(0.575);
  const halfAt = (lo: number, hi: number, rising: boolean) => {
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (bandShape(mid, 20) > 0.425 === rising) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  };
  const inner = halfAt(0, BAND_PEAK_NH, true);
  const outer = halfAt(BAND_PEAK_NH, 1, false);
  ok(near(inner, (1 - d) / 1.25, 1e-9) && near(outer, (1 + d) / 1.25, 1e-9), `at power 20 the band is at half its height from N.H ${inner.toFixed(4)} to ${outer.toFixed(4)}, ${((Math.acos(inner) - Math.acos(outer)) * 180 / Math.PI).toFixed(1)} degrees of half vector: the client's own width`);
  ok(specShape(2, 0.8, 0.5, 20) === bandShape(0.8, 20) * 0.5 && specShape(2, 0.8, -0.3, 20) === 0, 'the band is multiplied by N.L, nought on a face turned from the light');
  ok(specShape(1, 0.9, -0.5, 20) === blinnShape(0.9, 20), 'the plain highlight takes no N.L at all, as the client drew it');
}

// ---------------------------------------------------------------- the cap, the gain, the gate and the film

{
  const out: Vec3 = [0, 0, 0];
  const n: Vec3 = [0, 0, 1];
  clientSpecular(out, WHITE, [10, 10, 10], 1, 1, 8, n, n, n, TUNE);
  ok(near((out[0] * Math.PI) / WHITE[0], 1, 1e-12), "glass's colour of 10 is held at a white surface facing the light: no blob in the bloom");
  clientSpecular(out, WHITE, [10, 10, 10], 1, 1, 8, n, n, n, { ...TUNE, cap: 2 });
  ok(near((out[0] * Math.PI) / WHITE[0], 2, 1e-12), 'and the cap is a knob');
  clientSpecular(out, [2, 1, 0.5], [10, 10, 10], 1, 1, 8, n, n, n, TUNE);
  ok(near(out[0], 2 / Math.PI, 1e-12) && near(out[2], 0.5 / Math.PI, 1e-12), "each channel is held at that channel of the light's own white surface");
  clientSpecular(out, WHITE, [0.5, 0.5, 0.5], 1, 1, 20, n, n, n, { ...TUNE, gain: 2 });
  ok(near((out[0] * Math.PI) / WHITE[0], 1, 1e-12), 'the gain multiplies the term before the cap');
  // A face turned from the light can still catch the plain highlight in the client (it has no N.L); the gate takes it away.
  const l = unit(0, -0.05, 1);
  const turned: Vec3 = unit(0, 1, 0.02);
  clientSpecular(out, WHITE, [1, 1, 1], 1, 1, 2, turned, l, unit(0, 1, 0.2), TUNE);
  const open = out[0];
  clientSpecular(out, WHITE, [1, 1, 1], 1, 1, 2, turned, l, unit(0, 1, 0.2), { ...TUNE, gate: 1 });
  ok(open > 0 && out[0] === 0, 'with no gate a face just turned from the light keeps its highlight, as the client drew it; at gate 1 it has none');
  clientSpecular(out, WHITE, [1, 1, 1], 1, 0, 20, n, n, n, TUNE);
  ok(out[0] === 0 && out[1] === 0 && out[2] === 0, 'mode none draws nothing');
  ok(filmShare(0, TUNE) === 0 && filmShare(0.6, TUNE) === 0.6 && filmShare(3, TUNE) === 1, "a dry surface draws the client's term alone, a wet one keeps three's GGX by how wet it is");
  ok(filmShare(0, { ...TUNE, film: 0 }) === 0 && filmShare(1, { ...TUNE, film: 0.5 }) === 0.5, 'times the film knob');
  ok(filmShare(0, { ...TUNE, use: 'three' }) === 1, "and the switch to three's GGX takes all of it");
  ok(weatherShare(0.3, 0.6, 0) === 0.6 && weatherShare(0.3, 0, 0) === 0.3 && weatherShare(0, 0, 0) === 0, 'the film is taken by the wetter of the surface and its puddle');
  ok(weatherShare(0, 0, 0.8) === 0.8 && weatherShare(0.2, 0.1, 0.9) === 0.9 && filmShare(weatherShare(0, 0, 1), TUNE) === 1, "and by the snow lying on it: settled snow is matt through roughness, which the client's term never reads, so under snow the highlight is three's at the snow's roughness");
}

// ---------------------------------------------------------------- no NaN anywhere

{
  let bad = 0;
  const out: Vec3 = [0, 0, 0];
  for (const power of [-5, 0, 1e-9, 1, 3, 20, 200, 1e6]) {
    for (let i = -20; i <= 20; i++) {
      const nh = i / 10;
      for (const nl of [-1, -0.5, 0, 0.5, 1]) {
        for (const mode of [0, 1, 2]) {
          const s = specShape(mode, nh, nl, power);
          if (!Number.isFinite(s) || s < 0) bad++;
        }
      }
    }
    for (const mode of [1, 2]) {
      // A light straight behind the eye (L = -V), a degenerate normal, and everything in between.
      clientSpecular(out, WHITE, [1, 1, 1], 1, mode, power, [0, 0, 1], [0, 0, -1], [0, 0, 1], TUNE);
      if (!out.every(Number.isFinite)) bad++;
      clientSpecular(out, WHITE, [1, 1, 1], 1, mode, power, [0, 0, 0], unit(1, 1, 1), [0, 0, 1], TUNE);
      if (!out.every(Number.isFinite)) bad++;
      clientSpecular(out, WHITE, [1, 1, 1], 1, mode, power, [0, 0, -1], unit(0, 0.3, 1), [0, 0, 1], { ...TUNE, gate: 0.5 });
      if (!out.every(Number.isFinite)) bad++;
    }
  }
  ok(bad === 0, 'no NaN and nothing below nought for N.H from -2 to 2, N.L either side, powers from below nought to a million, a light behind the eye or a normal of nothing');
  ok(blinnShape(-0.5, 20) === Math.pow(1e-6, 20) && blinnShape(0.5, 0) === 1, 'N.H below nought is held to nought before the power (never pow of a negative), and a power of nought is a flat one, as pow(x, 0) is');
}

console.log(`\nspecMath: ${passed} checks passed`);
