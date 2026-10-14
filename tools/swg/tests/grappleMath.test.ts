// The grapple's arithmetic that needs nothing but numbers (`src/player/grappleMath.ts`), and two lines of
// `grapple.ts` read as text: the gravity knob's add-back is asked only off 1 and only while swinging.
//
// Run: node tools/swg/tests/grappleMath.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GRAPPLE_RELEASE_MUTES,
  WALKABLE,
  aimTrue,
  armAimFor,
  camScaleFor,
  clipInto,
  dazeAt,
  grappleMutes,
  gravityAddBack,
  joltFor,
  leanAngleOf,
  leanEase,
  leanOf,
  leanToward,
  len2,
  len3,
  markShows,
  newRopeModes,
  ratchetDue,
  releasedHolds,
  ribbonWidth,
  riseOf,
  ropeModes,
  sagOf,
  shakeAt,
  slamCounts,
  slamHarm,
  staggerFor,
  swimLifts,
  teleported,
  underWater,
  wadeDragOf,
  wallFrictionSpare,
  windGainFor,
  type MarkKind,
} from '../../../src/player/grappleMath.ts';
import { SWIM_DEPTH } from '../../../src/player/swimStep.ts';

const grappleSrc = readFileSync(new URL('../../../src/player/grapple.ts', import.meta.url), 'utf8');
import { TERRAIN_GROUP, STILL_FLAGS } from '../../../src/player/grappleRope.ts';
import { Group, RAPIER } from '../../../src/core/physics.ts';
import { HUD_SIZES, chargeOuterHalo, grappleMarkInnerHalo } from '../../../src/ui/hudMath.ts';
import { HUD_SCALE_RANGE } from '../../../src/core/settings.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
let seed = 99;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

// The rope's words, over every combination.
{
  const m = newRopeModes();
  const tune = { slideOver: 7 };
  let good = true;
  let combos = 0;
  for (const attached of [false, true])
    for (const ground of [false, true])
      for (const swim of [false, true])
        for (const taut of [false, true])
          for (const held of [false, true])
            for (const latch of [false, true])
              for (const speed of [0, 6.9, 7.1, 20]) {
                combos++;
                ropeModes(attached, ground, swim, taut, held, latch, speed, tune, m);
                if (m.swinging !== (m.hanging || m.sliding)) good = false;
                if (m.sliding !== (attached && !swim && ground && (taut || held) && latch && speed > 7)) good = false;
                if (m.afloat && (m.hanging || m.sliding || m.swinging || m.latch || m.onGround)) good = false;
                if (m.afloat !== (attached && swim)) good = false;
                if (m.hanging !== (attached && !swim && !ground)) good = false;
                if (!attached && (m.taut || m.held || m.latch || m.swinging)) good = false;
              }
  ok(good, `over all ${combos} combinations: swinging is exactly hanging or sliding, sliding needs attached, the ground, held, the latch and the speed, and afloat is never hanging, sliding or swinging and clears the latch`);
}

// The swim's lift and the wading drag.
{
  const t = { swimLift: 45, swimLiftBand: 0 };
  ok(!swimLifts(44.9, true, t) && !swimLifts(80, false, t) && swimLifts(45.1, true, t), 'swimLifts is false under swimLift and with reel-in up, true past it with reel-in held');
  const band = { swimLift: 45, swimLiftBand: 3 };
  ok(!swimLifts(47, true, band, false) && swimLifts(48.1, true, band, false) && swimLifts(43, true, band, true) && !swimLifts(41.9, true, band, true), 'a band widens the line either way about swimLift by what it was last frame');
  const w = { wadeDrag: 1 };
  const d = SWIM_DEPTH;
  ok(wadeDragOf(0, w, d) === 0 && wadeDragOf(-2, w, d) === 0 && wadeDragOf(d, w, d) === 1 && wadeDragOf(3, w, d) === 1 && Math.abs(wadeDragOf(d / 2, w, d) - 0.5) < 1e-12, 'wadeDragOf is nought out of the water and scales to wadeDrag at the swim depth');
  ok(/wadeDragOf\(b\.depth, T, SWIM_DEPTH\)/.test(grappleSrc), "and the hook hands it the swim's own depth, swimStep's SWIM_DEPTH, never a second copy");
}

// Under the drawn water: a column there whose surface, the swell added, stands over the point; no column, never.
{
  ok(underWater(-1, 0, 0) && !underWater(0.5, 0, 0) && underWater(0.5, 0, 0.75) && !underWater(-1, Number.NEGATIVE_INFINITY, 0) && !underWater(-1, Number.NaN, 5), 'underWater: under a column (the swell counted), never where there is none');
}

// The mark refuses water.
{
  const t = { minRange: 1.5, range: 100 };
  const kinds: MarkKind[] = ['none', 'terrain', 'still', 'pane', 'water', 'door', 'prop', 'moving'];
  const shown = kinds.filter((k) => markShows(20, k, t));
  ok(shown.join(',') === 'terrain,still' && !markShows(20, 'water', t) && !markShows(1.4, 'still', t) && !markShows(100.1, 'terrain', t) && markShows(100, 'terrain', t), `the mark shows only on terrain and still things in range (${shown.join(', ')}), never on water`);
}

// The true aim.
{
  let worst = 0;
  let unit = 0;
  let found = 0;
  const out = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 20000; i++) {
    let ex = rand() * 2 - 1;
    let ey = rand() * 2 - 1;
    let ez = rand() * 2 - 1;
    const el = Math.hypot(ex, ey, ez) || 1;
    ex /= el;
    ey /= el;
    ez /= el;
    const sp = rand() * 60;
    const vx = (rand() * 2 - 1) * sp;
    const vy = (rand() * 2 - 1) * sp;
    const vz = (rand() * 2 - 1) * sp;
    const u = 150;
    const k = aimTrue(ex, ey, ez, vx, vy, vz, u, out);
    if (k <= 0) continue;
    found++;
    unit = Math.max(unit, Math.abs(Math.hypot(out.x, out.y, out.z) - 1));
    const wx = u * out.x + vx;
    const wy = u * out.y + vy;
    const wz = u * out.z + vz;
    const wl = Math.hypot(wx, wy, wz);
    worst = Math.max(worst, Math.hypot(wy * ez - wz * ey, wz * ex - wx * ez, wx * ey - wy * ex) / wl, (wx * ex + wy * ey + wz * ez) / wl > 0 ? 0 : 1);
  }
  ok(found > 19000 && worst < 1e-9 && unit < 1e-12, `aimTrue over ${found} random aims: the dart's own velocity plus the shooter's points along the line to the mark (worst ${worst.toExponential(1)}), its direction a unit vector`);
  ok(aimTrue(1, 0, 0, -200, 0, 0, 150, out) === 0, 'a shooter faster than the dart, away from the mark, has no true aim');
}

// The sag.
{
  let worst = 0;
  for (let i = 0; i < 1000; i++) {
    const D = rand() * 100;
    const s = rand() * 5;
    worst = Math.max(worst, Math.abs(sagOf(D, s) - Math.sqrt((3 * D * s) / 8)));
  }
  ok(worst < 1e-12 && sagOf(20, 0) === 0 && sagOf(20, -0.05) === 0 && sagOf(0, 1) === 0, 'sagOf is the shallow parabola, sqrt(3 D s / 8), and nothing with no slack: inside the taut band (slack less the band) the rope is straight');
}

// The mutes (§5.3).
{
  const out: string[] = [];
  const none = grappleMutes(out, false, false);
  const noneList = out.join(',');
  const outOn = grappleMutes(out, true, false);
  const onList = out.join(',');
  const swinging = grappleMutes(out, true, true);
  const swingList = out.join(',');
  ok(none === 0 && noneList === '', 'nothing is muted while the hook is not out');
  ok(outOn === 10 && onList === 'walk,crouch,flashlight,prone,kneel,emoteWheel,emote1,emote2,emote3,emote4', `while it is out: ${onList}`);
  ok(swinging === 11 && swingList === `${onList},jump`, 'and the jump as well while swinging');
  ok(GRAPPLE_RELEASE_MUTES.join(',') === 'jump,flashlight,walk', 'every let-go mutes the jump, the torch and the walk until their keys are up, never the crouch');
  const again = grappleMutes(out, true, true);
  ok(again === 11 && out.join(',') === swingList, 'asked again for the same list it keeps it as it is');
}

// The gravity knob, read as text: the add-back sits behind `gravity !== 1` and inside the swinging test.
{
  const src = readFileSync(new URL('../../../src/player/grapple.ts', import.meta.url), 'utf8');
  const calls = src.split('\n').filter((l) => l.includes('gravityAddBack(') && !l.includes('import'));
  ok(calls.length === 1 && /if \(T\.gravity !== 1 && m\.swinging\) vel\.y \+= gravityAddBack\(/.test(calls[0]), `nothing calls gravityAddBack at a scale of 1, nor off the rope: its one call is behind gravity !== 1 and swinging (${calls.length} call)`);
  ok(gravityAddBack(1, 9.8, 1 / 60) === 0 && Math.abs(gravityAddBack(0.6, 20.32, 1 / 60) - 0.4 * 20.32 / 60) < 1e-12, 'the add-back is (1 - scale) g dt');
}

// The clip: against nothing that moves it is the old clip's arithmetic to the bit; against a surface that moves,
// the speed into it is relative.
{
  let same = true;
  const out = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 20000; i++) {
    const v = { x: (rand() - 0.5) * 60, y: (rand() - 0.5) * 60, z: (rand() - 0.5) * 60 };
    let nx = rand() - 0.5;
    let ny = rand() - 0.5;
    let nz = rand() - 0.5;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const n = { x: nx, y: ny, z: nz };
    // The clip as it was before the relative measure, written out.
    const into0 = -(v.x * n.x + v.y * n.y + v.z * n.z);
    const old = into0 > 0 ? { x: v.x + n.x * into0, y: v.y + n.y * into0, z: v.z + n.z * into0, into: into0 } : { x: v.x, y: v.y, z: v.z, into: 0 };
    for (const rel of [true, false]) {
      const into = clipInto(v, n, null, rel, out);
      if (!Object.is(into, old.into) || !Object.is(out.x, old.x) || !Object.is(out.y, old.y) || !Object.is(out.z, old.z)) same = false;
    }
  }
  ok(same, 'clipInto with no surface velocity is the old clip by Object.is over random velocities and normals');
  const n = { x: -1, y: 0, z: 0 };
  const sv = { x: 40, y: 0, z: 0 };
  const v = { x: 46, y: 0, z: 0 };
  const into = clipInto(v, n, sv, true, out);
  ok(into === 6 && out.x === 40, `against a surface moving 40 m/s away from a body moving 46 after it, the speed into it is ${into} m/s and the clipped velocity is the surface's along the normal (${out.x})`);
  ok(clipInto(v, n, sv, false, out) === 46, 'measured absolute (clipRelative off) the same contact reads 46');
}

// The teleport guard at its edge.
{
  const t = { teleportMargin: 1 };
  const edge = 10 * (1 / 60) + 0.2 + 1;
  ok(!teleported(edge - 1e-9, 10, 1 / 60, 0.2, t) && teleported(edge + 1e-9, 10, 1 / 60, 0.2, t), "the teleport guard holds at a frame's speed, its correction and the margin, and lets go past them");
}

// The wall friction spares the sway.
{
  const out = { x: 0, y: 0, z: 0 };
  wallFrictionSpare({ x: 3, y: 0, z: 4 }, { x: 1, y: 0, z: 0 }, 6, 0.1, out);
  ok(out.x === 3 && Math.abs(out.z - 3.4) < 1e-12 && out.y === 0, `the sway's own direction is left alone (3) and the rest slowed by friction times dt (4 to ${out.z.toFixed(2)})`);
  wallFrictionSpare({ x: 3, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 6, 0.1, out);
  ok(Math.abs(out.x - 2.4) < 1e-12, 'with no sway the whole speed along the wall is slowed');
  wallFrictionSpare({ x: -3, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 6, 0.1, out);
  ok(Math.abs(out.x + 2.4) < 1e-12, 'speed against the sway is slowed as any other');
  wallFrictionSpare({ x: 0.2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 6, 0.1, out);
  ok(out.x === 0, 'and never turned round');
}

// The ribbon's least width.
{
  const t = { ropeWidth: 0.02, minPx: 1.5 };
  const near = ribbonWidth(1, 60, 1080, t);
  const far = ribbonWidth(100, 60, 1080, t);
  const perPx = (2 * 100 * Math.tan(Math.PI / 6)) / 1080;
  ok(near === 0.02 && Math.abs(far - 1.5 * perPx) < 1e-12 && ribbonWidth(100, 60, 2160, t) < far, `the ribbon is its own 2 cm near and never under 1.5 px far (${far.toFixed(3)} m at 100 m on 1080 lines; finer on 2160)`);
}

// The diamond clears the charge ring at every scale. The overlay's under-stroke widening is read off its file as text:
// hudCanvas.ts imports a page module node cannot load.
{
  const canvasSrc = readFileSync(new URL('../../../src/ui/hudCanvas.ts', import.meta.url), 'utf8');
  const OVERLAY_TUNE = { widen: Number(/export const OVERLAY_TUNE = \{[\s\S]*?\bwiden:\s*([\d.]+)/.exec(canvasSrc)?.[1] ?? Number.NaN) };
  ok(OVERLAY_TUNE.widen > 0, `the overlay widens its under-stroke by ${OVERLAY_TUNE.widen} px a side`);
  let worst = Infinity;
  for (let s = HUD_SCALE_RANGE.min; s <= HUD_SCALE_RANGE.max + 1e-9; s += 0.05) worst = Math.min(worst, grappleMarkInnerHalo(s, OVERLAY_TUNE.widen) - chargeOuterHalo(s, OVERLAY_TUNE.widen));
  ok(worst > 0, `the diamond's inner halo clears the charge ring's outer halo at every display scale (the narrowest gap ${worst.toFixed(2)} px; the diamond ${HUD_SIZES.grappleMark} px out on its axes)`);
}

// The lengths, the rise, the terrain bit and the still family's flags.
{
  let worst = 0;
  for (let i = 0; i < 10000; i++) {
    const x = (rand() - 0.5) * 2000;
    const y = (rand() - 0.5) * 2000;
    const z = (rand() - 0.5) * 2000;
    const h = Math.hypot(x, y, z);
    worst = Math.max(worst, Math.abs(len3(x, y, z) - h) / (h || 1), Math.abs(len2(x, y) - Math.hypot(x, y)) / (Math.hypot(x, y) || 1));
  }
  ok(worst < 1e-14, `len2 and len3 are the hypotenuse to ${worst.toExponential(1)} relative`);
  ok(Math.abs(riseOf(1, 1, 0) - 45) < 1e-12 && riseOf(0, 5, 0) === 90 && riseOf(3, 0, 4) === 0 && riseOf(0, 0, 0) === 0, 'the rise is the free span above level in degrees');
  ok(TERRAIN_GROUP === Group.terrain, "the rope's terrain bit is the physics' own Group.terrain");
  const F = RAPIER.QueryFilterFlags;
  ok(STILL_FLAGS === (F.EXCLUDE_SENSORS | F.EXCLUDE_KINEMATIC | F.EXCLUDE_DYNAMIC), "the still family's flags are the engine's own: no sensor, nothing kinematic, nothing dynamic");
}

// --- wave 2: the danger, the look and the sound, at the tune as it ships -----------------------------------
{
  const { GRAPPLE_DEFAULTS } = await import('../../../src/player/grapple.ts');
  const T = GRAPPLE_DEFAULTS;
  // The slam's table (§3.11): nothing up to 16.8, 3.1 a m/s over it, 60 at most, the whole health past 50.
  ok(slamHarm(16.8, 100, T) === 0 && slamHarm(16.79, 100, T) === 0, 'a slam costs nothing at 16.8 m/s and under');
  ok(slamHarm(28, 100, T) === 35, `20 m from level (28 m/s) costs ${slamHarm(28, 100, T)} (35)`);
  ok(slamHarm(19.8, 100, T) === 9 && slamHarm(24.2, 100, T) === 23 && slamHarm(34.2, 100, T) === 54, 'the design table: 9 at 19.8, 23 at 24.2, 54 at 34.2');
  ok(slamHarm(36.2, 100, T) === 60 && slamHarm(45, 100, T) === 60 && slamHarm(49.99, 100, T) === 60, 'held to 60 from 36.2 m/s to just under 50');
  ok(slamHarm(50, 100, T) === 100 && slamHarm(55, 73, T) === 73 && slamHarm(64, 1, T) === 1, 'and the whole of the health at 50 m/s and above');
  // What counts: a surface steeper than the climb, and never the haul's own push.
  ok(WALKABLE === Math.cos((55 * Math.PI) / 180), "the walkable line is the controller's own climb, cos 55 degrees");
  ok(!slamCounts(0.574, false) && !slamCounts(1, false) && slamCounts(0.57, false) && slamCounts(0, false) && slamCounts(-1, false), 'a floor (normal at least 0.574 up) is never a slam; a wall and a ceiling are');
  ok(!slamCounts(0, true) && !slamCounts(-1, true), 'and nothing is while F hauls');
  ok(staggerFor(23.2, T) === 0 && staggerFor(23.21, T) === T.stagger && staggerFor(50, T) === 0.5, 'past 23.2 m/s a slam staggers for half a second');
  ok(releasedHolds(16.81, T) && !releasedHolds(16.8, T), 'the flight after a let-go holds while faster than 16.8 m/s');
  // The daze and the shake.
  let dazeOk = true;
  let peak = 0;
  for (let t = 0; t <= 0.6; t += 0.0005) {
    const d = dazeAt(t, T);
    if (d > T.daze + 1e-12 || d < 0) dazeOk = false;
    peak = Math.max(peak, d);
  }
  ok(dazeAt(0, T) === 0 && dazeAt(T.stagger, T) === 0 && dazeAt(-1, T) === 0 && dazeAt(Number.POSITIVE_INFINITY, T) === 0, 'the daze is nought at the stagger\'s start, at its end, before and after');
  ok(Math.abs(dazeAt(T.dazeIn, T) - T.daze) < 1e-12 && dazeOk && Math.abs(peak - T.daze) < 1e-3, `and peaks at the daze (${T.daze}) at dazeIn (${T.dazeIn} s), never past it`);
  ok(dazeAt(0.3, { ...T, daze: 0 }) === 0, 'a daze of nought draws nothing');
  ok(shakeAt(0, T) === T.shake && Math.abs(shakeAt(T.shakeTime / 2, T) - T.shake / 2) < 1e-12 && shakeAt(T.shakeTime, T) === 0 && shakeAt(1, T) === 0, `the shake falls from ${T.shake} to nought over ${T.shakeTime} s and is nought after`);
  // The jolt, at full gravity as the first proposal's numbers at 0.6 (§3.11): the same slack gives the same jolt.
  ok(joltFor(T.joltFrom, T) === 0 && joltFor(3, T) === 0 && joltFor(1e6, T) === T.joltMax, 'the jolt is nought under joltFrom and never past joltMax');
  let worstJolt = 0;
  for (let slack = 0; slack <= 15; slack += 0.05) {
    const full = joltFor(Math.sqrt(2 * 20.32 * slack), T);
    const eased = joltFor(Math.sqrt(2 * 20.32 * 0.6 * slack), { joltFrom: 4, joltPer: 0.02, joltMax: 0.3 });
    worstJolt = Math.max(worstJolt, Math.abs(full - eased));
  }
  ok(worstJolt <= 0.02, `over slack of 0 to 15 m a catch at full gravity jolts within ${worstJolt.toFixed(4)} of the first proposal's at 0.6 (0.02)`);
  // The ratchet's cap: never more than tickMax in a second, at any reel up to 100 m/s and any frame rate.
  let worstRate = 0;
  for (const fps of [30, 60, 144, 240]) {
    for (const speed of [1, 6, 12, 30, 100]) {
      const dt = 1 / fps;
      let reeled = 0;
      let since = Number.POSITIVE_INFINITY;
      const at: number[] = [];
      for (let i = 0; i < fps * 5; i++) {
        since += dt;
        reeled += speed * dt;
        if (ratchetDue(reeled, since, T)) {
          at.push(i * dt);
          since = 0;
          reeled -= T.tickEvery;
        }
        if (reeled > T.tickEvery) reeled = T.tickEvery;
      }
      for (let k = 0; k < at.length; k++) {
        let n = 0;
        for (let j = k; j < at.length && at[j] - at[k] < 1 - 1e-9; j++) n++;
        worstRate = Math.max(worstRate, n);
      }
    }
  }
  ok(worstRate <= T.tickMax, `ratchetDue never answers more than ${T.tickMax} in any second, at 1 to 100 m/s of reel and 30 to 240 fps (the most in a second: ${worstRate})`);
  // The arm's reach, the camera's pull, the lean.
  const a = { x: 0, y: 0, z: 0 };
  const deg = (v: { x: number; y: number; z: number }) => (Math.atan2(-v.z, v.y) * 180) / Math.PI;
  armAimFor(0, Math.cos(Math.PI / 3), -Math.sin(Math.PI / 3), T, a);
  ok(Math.abs(deg(a) - 45) < 1e-9 && Math.abs(Math.hypot(a.x, a.y, a.z) - 1) < 1e-12, `a rope 60 degrees behind straight up is reached for at 45 (${deg(a).toFixed(3)})`);
  armAimFor(0.3, Math.cos(Math.PI / 6), -Math.sin(Math.PI / 6), T, a);
  ok(a.x === 0.3 && a.y === Math.cos(Math.PI / 6) && a.z === -Math.sin(Math.PI / 6), 'one 30 degrees behind is left alone, sideways share and all');
  armAimFor(0.2, -0.5, 0.8, T, a);
  ok(a.x === 0.2 && a.y === -0.5 && a.z === 0.8, 'and one in front is never touched');
  ok(camScaleFor(10, T) === 1 && camScaleFor(0, T) === 1 && camScaleFor(35, T) === 1.3 && camScaleFor(80, T) === 1.3 && Math.abs(camScaleFor(22.5, T) - 1.15) < 1e-12, 'the camera\'s scale is 1 at 10 m/s, 1.3 at 35, straight between');
  const q = { x: 9, y: 9, z: 9, w: 9 };
  leanOf({ x: 1, y: 1, z: 0 }, { tilt: 0 }, q);
  ok(Object.is(q.x, 0) && Object.is(q.y, 0) && Object.is(q.z, 0) && q.w === 1, 'leanOf at a tilt of nought is the identity, to the bit');
  leanOf({ x: 1, y: 1, z: 0 }, { tilt: 0.7 }, q);
  // The lean turns straight up toward the rope by 0.7 of its 45 degrees: straight up turned by it is the turn's
  // second column, (2(xy - wz), 1 - 2(x² + z²), 2(yz + wx)).
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.y * q.z + q.w * q.x);
  ok(Math.abs((Math.atan2(ux, uy) * 180) / Math.PI - 31.5) < 1e-9 && Math.abs(uz) < 1e-12, `and at 0.7 it tips straight up 31.5 degrees toward a rope 45 off upright (${((Math.atan2(ux, uy) * 180) / Math.PI).toFixed(3)})`);
  leanOf({ x: 0, y: 1, z: 0 }, { tilt: 0.7 }, q);
  ok(q.w === 1 && q.x === 0 && q.z === 0, 'a rope straight up is no lean at all');
  for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
    const level = (T.leanLevel * Math.PI) / 180;
    let ang = T.tilt * (Math.PI / 2);
    const first = leanEase(ang, dt, T);
    let frames = 0;
    while (ang > level && frames < 10000) {
      ang = leanEase(ang, dt, T);
      frames++;
    }
    ok(first > level && frames * dt <= T.leanOut + dt && frames > 1, `${Math.round(1 / dt)} fps: the largest lean (${Math.round(T.tilt * 90)} degrees) eases under leanLevel in ${(frames * dt).toFixed(3)} s (within leanOut ${T.leanOut}), never in one frame`);
  }
  // The quaternion ease reaches its target exactly, and moves no further than the step.
  const cur = { x: 0, y: 0, z: 0, w: 1 };
  const tgt = { x: 0, y: 0, z: 0, w: 1 };
  leanOf({ x: 1, y: 1, z: 0.3 }, { tilt: 0.7 }, tgt);
  const target = leanAngleOf(tgt);
  let steps = 0;
  while (leanAngleOf(cur) < target - 1e-9 && steps < 1000) {
    const before = leanAngleOf(cur);
    leanToward(cur, tgt, { step: 0.05, left: 0 }, cur);
    if (leanAngleOf(cur) - before > 0.05 + 1e-9) steps = 9999;
    steps++;
  }
  ok(steps < 1000 && cur.x === tgt.x && cur.w === tgt.w, `leanToward reaches its target exactly in ${steps} steps, none longer than the step`);
  leanToward(cur, { x: 0, y: 0, z: 0, w: 1 }, { step: 10, left: 0 }, cur);
  ok(cur.x === 0 && cur.y === 0 && cur.z === 0 && cur.w === 1, 'and back to upright exactly, the identity to the bit');
  ok(windGainFor(30, T) === 0, 'the speed wind ships off (windGain 0)');
  ok(windGainFor(12, { windGain: 0.5, windFrom: 12, windTo: 35 }) === 0 && windGainFor(35, { windGain: 0.5, windFrom: 12, windTo: 35 }) === 0.5, 'switched on, it is nought under 12 m/s and 0.5 at 35');
}

console.log(`\n${checks} checks passed`);
