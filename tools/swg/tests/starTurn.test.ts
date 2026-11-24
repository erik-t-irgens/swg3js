// The stars turn with the ground world's own spin about its own axis under an applied star system (the GPU port's pass 2,
// wave 6, its fixer: the owner's late addition 2): `skyMotion.ts`' `SkyMotion.celestial` (the world's celestial frame in the
// sky, written by the day's `at`), `skyTurn.ts`' `celestialFrameInto`, and the night's branch in `nightGpu.ts`. Under node,
// with the viewer's own drafts (`drafts.js`) as the applied systems:
//   1. a world not applied keeps today's turn exactly: `nightFrameInto` is the base's (1b2a6c6, out of git) to the text, the
//      night calls it as before where no motion is, and the new rule fed SWG's own day frame turned by the sun answers it;
//   2. under an applied system of version 2 (the Tatoo draft at Tatooine, the Yavin draft at Yavin 4) the celestial pole stands
//      at the play area's latitude over its true north, the stars' field turns about that pole and no other, and over one of the
//      world's own days a star's hour angle gains on the sun's by the world's year (its sidereal day), the sun's coming round
//      whole; the galaxy's tilt keeps its meaning (its pole the tilt dial off the world's);
//   3. under a version 1 system (a one-world sky) the stars turn about SWG's pole, the bodies' own.
// Nothing allocated in a frame is held by `nightAlloc.test.ts` (half its frames under the Tatoo draft) and `skyMotionAlloc`.
//
// Run: node tools/swg/tests/starTurn.test.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { draftSystem, draftV1For } from '../../../src/sky/system/drafts.js';
import { skyMotionFor, type SkyMotion } from '../../../src/sky/system/skyMotion.ts';
import { DAY_AXIS, NOON, QUARTER, celestialFrameInto, nightFrameInto, tiltFrameInto } from '../../../src/sky/night/skyTurn.ts';
import { tiltOf } from '../../../src/sky/night/nightTune.ts';

let checks = 0;
const ok = (cond: boolean, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  console.log(`ok   ${msg}`);
};
const DEG = Math.PI / 180;
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p: string): string => readFileSync(ROOT + p, 'utf8');
const BASE = '1b2a6c6';
const fnText = (src: string, name: string): string => {
  const at = src.indexOf(`export function ${name}(`);
  if (at < 0) return '';
  const end = src.indexOf('\n}\n', at);
  return src.slice(at, end + 2);
};

// Stand-in skies: SWG's slots at sizes of our own (no converted file is read).
const SKY = { sun: { size: 0.6 }, supplementalSun: { size: 0.55 }, moon: { size: 0.5 }, supplementalMoon: { size: 0.25 }, celestials: [] };

// ---------------------------------------------------------------- 1. a world not applied: today's turn exactly
{
  let base = '';
  try {
    base = execFileSync('git', ['show', `${BASE}:src/sky/night/skyTurn.ts`], { cwd: ROOT, encoding: 'utf8' });
  } catch {
    base = '';
  }
  const tree = read('src/sky/night/skyTurn.ts');
  ok(base.length > 0 && fnText(base, 'nightFrameInto').length > 200 && fnText(tree, 'nightFrameInto') === fnText(base, 'nightFrameInto') && fnText(tree, 'tiltFrameInto') === fnText(base, 'tiltFrameInto'), `SWG's turn (\`nightFrameInto\`) and the tilt's frame are ${BASE}'s to the character`);
  const ng = read('src/sky/night/nightGpu.ts');
  ok(/const motion = SKY_MOTION\.now;\n\s+if \(motion !== null && motion\.celestialAt === motion\.T\) celestialFrameInto\(this\.tilt, motion\.celestial, this\.u\.frame\.elements\);\n\s+else nightFrameInto\(this\.tilt, f\.sunDir, this\.u\.frame\.elements\);/.test(ng), 'the night turns by the world\'s own frame only under a motion that has run this frame, and by SWG\'s turn read off the sun otherwise (the old line)');
  // The new rule handed SWG's own day frame turned by the sun's day angle answers SWG's turn: one rule, two frames.
  const tilt = new Float64Array(9);
  tiltFrameInto(23, 140, tilt);
  const a = new Float64Array(9);
  const b = new Float64Array(9);
  const cel = new Float64Array(9);
  let worst = 0;
  for (let k = 0; k < 48; k++) {
    const ang = (k / 48) * 2 * Math.PI;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const sun = { x: s * QUARTER.x + c * NOON.x, y: s * QUARTER.y + c * NOON.y, z: s * QUARTER.z + c * NOON.z };
    nightFrameInto(tilt, sun, a);
    // the day frame (QUARTER, NOON, the upper pole) turned about the day's axis by the angle
    const P = { x: -DAY_AXIS.x, y: -DAY_AXIS.y, z: -DAY_AXIS.z };
    cel[0] = c * QUARTER.x - s * NOON.x;
    cel[1] = c * QUARTER.y - s * NOON.y;
    cel[2] = c * QUARTER.z - s * NOON.z;
    cel[3] = sun.x;
    cel[4] = sun.y;
    cel[5] = sun.z;
    cel[6] = P.x;
    cel[7] = P.y;
    cel[8] = P.z;
    celestialFrameInto(tilt, cel, b);
    for (let i = 0; i < 9; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  }
  ok(worst < 1e-12, `fed SWG's day frame as the sun turns it, the world's rule is SWG's turn (worst ${worst.toExponential(2)} over 48 hours)`);
}

// ---------------------------------------------------------------- helpers: a frame, an hour angle, a turn's axis
const night = (m: SkyMotion, planet: string, count: number, out: Float64Array): void => {
  m.at({ count });
  const t = tiltOf(planet);
  const tilt = new Float64Array(9);
  tiltFrameInto(t.tiltDeg, t.nodeDeg, tilt);
  celestialFrameInto(tilt, m.celestial, out);
};
/** A direction's hour angle about the pole `P` (the sky's frame: +Y up, +Z north), degrees, west of the upper meridian. */
const hourAngle = (P: ArrayLike<number>, p0: number, x: number, y: number, z: number): number => {
  // the upper meridian: up laid into the pole's equator; west a quarter turn on (the sky's +X is west)
  const px = P[p0];
  const py = P[p0 + 1];
  const pz = P[p0 + 2];
  let mx = -py * px;
  let my = 1 - py * py;
  let mz = -py * pz;
  const ml = Math.hypot(mx, my, mz);
  mx /= ml;
  my /= ml;
  mz /= ml;
  // west = meridian x pole turned so +X (west) reads positive at the equator's west point
  let wx = my * pz - mz * py;
  let wy = mz * px - mx * pz;
  let wz = mx * py - my * px;
  if (wx < 0) {
    wx = -wx;
    wy = -wy;
    wz = -wz;
  }
  return Math.atan2(x * wx + y * wy + z * wz, x * mx + y * my + z * mz) / DEG;
};
const wrap = (d: number): number => {
  let v = d % 360;
  if (v > 180) v -= 360;
  if (v < -180) v += 360;
  return v;
};

// ---------------------------------------------------------------- 2. an applied system of version 2
const v2Cases: { system: string; world: string; planet: string }[] = [
  { system: 'tatoo', world: 'tatooine', planet: 'tatooine' },
  { system: 'yavin', world: 'yavin4', planet: 'yavin4' },
];
for (const c of v2Cases) {
  const m = skyMotionFor({ [c.system]: draftSystem(c.system) }, c.world, c.planet, SKY);
  ok(!!m && m.version === 2 && m.ownsDay, `${c.world}: the ${c.system} draft applies as a system of version 2, owning the world's day`);
  if (!m) continue;
  const model = (m as unknown as { model: { lat: number; period: Float64Array; yearOf: Int16Array; worldI: number } }).model;
  const latDeg = model.lat / DEG;
  // the pole at the latitude's height over true north, at every hour of a day
  let worstUp = 0;
  let worstAz = 0;
  for (let k = 0; k < 24; k++) {
    m.at({ count: 40 + k / 24 });
    const C = m.celestial;
    const up = Math.asin(Math.max(-1, Math.min(1, C[7]))) / DEG;
    worstUp = Math.max(worstUp, Math.abs(up - Math.abs(latDeg)));
    // true north (+Z) for a northern latitude, true south (-Z) for a southern one: the pole stands in the meridian
    worstAz = Math.max(worstAz, Math.abs(C[6]));
    const sign = latDeg >= 0 ? 1 : -1;
    if (!(sign * C[8] >= 0)) worstAz = 9;
  }
  ok(worstUp < 1e-9 && worstAz < 1e-9, `${c.world}: the celestial pole stands ${Math.abs(latDeg).toFixed(2)} degrees up (the play area's latitude ${latDeg.toFixed(2)}) over true ${latDeg >= 0 ? 'north' : 'south'} at every hour (worst ${worstUp.toExponential(1)} degrees, ${worstAz.toExponential(1)} off the meridian)`);
  // the stars' field turns about that pole: the turn between two moments a short way apart has the pole for its axis
  const f0 = new Float64Array(9);
  const f1 = new Float64Array(9);
  let worstAxis = 0;
  for (let k = 0; k < 8; k++) {
    const at = 40 + k / 8;
    night(m, c.planet, at, f0);
    night(m, c.planet, at + 0.01, f1);
    // Q = F1 F0^T; its axis from the antisymmetric part
    const q = (r: number, s: number): number => f1[r] * f0[s] + f1[3 + r] * f0[3 + s] + f1[6 + r] * f0[6 + s];
    let ax = q(2, 1) - q(1, 2);
    let ay = q(0, 2) - q(2, 0);
    let az = q(1, 0) - q(0, 1);
    const al = Math.hypot(ax, ay, az);
    ax /= al;
    ay /= al;
    az /= al;
    const C = m.celestial;
    const cos = Math.abs(ax * C[6] + ay * C[7] + az * C[8]);
    worstAxis = Math.max(worstAxis, Math.acos(Math.min(1, cos)) / DEG);
  }
  ok(worstAxis < 0.05, `${c.world}: the stars turn about the world's own pole and no other (the turn's axis within ${worstAxis.toFixed(4)} degrees of it over a day)`);
  // the galaxy's tilt keeps its meaning: the galactic pole stands the tilt dial off the world's celestial pole
  night(m, c.planet, 40.3, f0);
  const t = tiltOf(c.planet);
  const C = m.celestial;
  const gAngle = Math.acos(Math.max(-1, Math.min(1, f0[3] * C[6] + f0[4] * C[7] + f0[5] * C[8]))) / DEG;
  ok(Math.abs(gAngle - t.tiltDeg) < 1e-9, `${c.world}: the galactic pole stands ${gAngle.toFixed(3)} degrees off the world's celestial pole, the tilt dial's ${t.tiltDeg}`);
  // over one of the world's own days a star's hour angle gains on the sun's by the world's year (its sidereal day)
  const steps = 400;
  let sunSum = 0;
  let starSum = 0;
  let sunWas = 0;
  let starWas = 0;
  const star = { x: 0.6, y: 0.48, z: 0.64 };
  for (let k = 0; k <= steps; k++) {
    const at = 40 + k / steps;
    night(m, c.planet, at, f0);
    const sx = f0[0] * star.x + f0[3] * star.y + f0[6] * star.z;
    const sy = f0[1] * star.x + f0[4] * star.y + f0[7] * star.z;
    const sz = f0[2] * star.x + f0[5] * star.y + f0[8] * star.z;
    const hs = hourAngle(m.celestial, 6, m.sun.x, m.sun.y, m.sun.z);
    const hst = hourAngle(m.celestial, 6, sx, sy, sz);
    if (k > 0) {
      sunSum += wrap(hs - sunWas);
      starSum += wrap(hst - starWas);
    }
    sunWas = hs;
    starWas = hst;
  }
  const yearDays = model.yearOf[model.worldI] >= 0 ? model.period[model.yearOf[model.worldI]] : 0;
  const expect = yearDays > 0 ? (360 * m.dayDays) / yearDays : 0;
  const gain = starSum - sunSum;
  ok(Math.abs(Math.abs(sunSum) - 360) < 0.5, `${c.world}: the sun comes round its whole hour angle in the world's day (${sunSum.toFixed(3)} degrees in ${(m.dayDays * 24).toFixed(2)} real hours)`);
  ok(Math.abs(Math.abs(gain) - expect) < Math.max(0.02 * expect, 1e-6) && Math.sign(gain) === Math.sign(sunSum), `${c.world}: a star's hour angle gains ${gain.toFixed(4)} degrees on the sun's in that day, the world's year of ${yearDays.toFixed(2)} real days giving ${expect.toFixed(4)} (its sidereal day ${((m.dayDays * 24 * 360) / (360 + expect)).toFixed(4)} real hours)`);
}

// ---------------------------------------------------------------- 3. a version 1 sky: SWG's pole, the bodies' own
{
  const m = skyMotionFor({ 'v1:dathomir': draftV1For('dathomir') }, 'dathomir', 'dathomir', SKY);
  ok(!!m && m.version === 1, 'a first-round one-world sky (Dathomir) applies as version 1');
  if (m) {
    let worst = 0;
    for (let k = 0; k < 12; k++) {
      m.at({ count: 12 + k / 12 });
      const C = m.celestial;
      worst = Math.max(worst, Math.abs(C[6] + DAY_AXIS.x), Math.abs(C[7] + DAY_AXIS.y), Math.abs(C[8] + DAY_AXIS.z));
      // the frame is a proper turn: unit, square, right-handed
      const d01 = C[0] * C[3] + C[1] * C[4] + C[2] * C[5];
      const cz = C[1] * C[5] - C[2] * C[4] - C[6];
      worst = Math.max(worst, Math.abs(d01), Math.abs(cz), Math.abs(Math.hypot(C[0], C[1], C[2]) - 1));
    }
    ok(worst < 1e-12, `Dathomir: the stars' pole is SWG's (22.5 degrees up over +Z), where its system's day turns the bodies, the frame a proper turn (worst ${worst.toExponential(1)})`);
  }
}

console.log(`\nstarTurn: ${checks} checks passed`);
