// The grapple's arithmetic that needs nothing but numbers (`src/player/grappleMath.ts`), and two lines of
// `grapple.ts` read as text: the gravity knob's add-back is asked only off 1 and only while swinging.
//
// Run: node tools/swg/tests/grappleMath.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GRAPPLE_RELEASE_MUTES,
  THING_RELEASE_MUTES,
  WALKABLE,
  aimTrue,
  armAimFor,
  brakeBudget,
  brakeBudgetIn,
  camScaleFor,
  clipInto,
  clipIntoRec,
  hullStill,
  hullStillIn,
  parkedLevel,
  parkedLevelIn,
  reducedShare,
  reducedShareIn,
  slipCatch,
  slipCatchIn,
  slipLeft,
  slipLeftIn,
  slipReelExcess,
  slipReelExcessIn,
  slipsTurn,
  slipsTurnIn,
  towing,
  towingIn,
  dazeAt,
  grappleMutes,
  gravityAddBack,
  joltFor,
  kindBites,
  kindHolds,
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
  turnByQuat,
  underWater,
  wadeDragOf,
  wallFrictionSpare,
  whoMoves,
  windGainFor,
  type MarkKind,
} from '../../../src/player/grappleMath.ts';
import { SWIM_DEPTH } from '../../../src/player/swimStep.ts';
import { newBoxHit, quadMeetsBox, rayBox, spanDepth } from '../../../src/player/grappleBox.ts';

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

// The mark refuses water. From wave 3 it shows on a loose prop too, which the dart hooks and the mass rule judges;
// the range is handed in as the stat table reads it.
{
  const t = { minRange: 1.5 };
  const kinds: MarkKind[] = ['none', 'terrain', 'still', 'pane', 'water', 'door', 'prop', 'moving'];
  const at = (dist: number, range: number) => ({ dist, range });
  const shown = kinds.filter((k) => markShows(k, at(20, 100), t));
  ok(shown.join(',') === 'terrain,still,prop' && !markShows('water', at(20, 100), t) && !markShows('still', at(1.4, 100), t) && !markShows('terrain', at(100.1, 100), t) && markShows('terrain', at(100, 100), t), `the mark shows only on terrain, still things and loose props in range (${shown.join(', ')}), never on water`);
  ok(kinds.filter(kindHolds).join(',') === 'terrain,still' && kinds.filter(kindBites).join(',') === 'terrain,still,prop', 'an anchor is terrain or a still thing; the dart bites those and a loose prop');
  ok(markShows('still', at(150, 200), t) && !markShows('still', at(150, 100), t), 'and the range is the one handed in, so a range progress raised reaches further');
}

// The mass rule (wave 3, §3.14): who the rope moves.
{
  const tune = { heavyRatio: 2 };
  ok(whoMoves(true, 20, 40, 80, tune) === 'player' && whoMoves(true, 1e9, 40, 80, tune) === 'player', 'anything still: the player, whatever it weighs');
  ok(whoMoves(false, 20, 40, 80, tune) === 'thing' && whoMoves(false, 40, 40, 80, tune) === 'thing', 'a 20 kg prop at a 40 kg strength comes to you, and one at the strength exactly');
  ok(whoMoves(false, 120, 40, 80, tune) === 'both' && whoMoves(false, 160, 40, 80, tune) === 'both', 'past the strength and up to twice the player\'s 80 kg: a tug-of-war');
  ok(whoMoves(false, 400, 40, 80, tune) === 'player' && whoMoves(false, 160.01, 40, 80, tune) === 'player', 'past that the player is moved (a speeder bike, 320 kg, is past it)');
  ok(whoMoves(false, 20, 10, 80, tune) === 'both', 'a prop heavier than a weakened tether is no longer pulled to you');
}

// A point carried into a prop's frame and back (wave 3).
{
  let worst = 0;
  const v = { x: 0, y: 0, z: 0 };
  const a = { x: 0, y: 0, z: 0 };
  const back = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 2000; i++) {
    let qx = rand() - 0.5;
    let qy = rand() - 0.5;
    let qz = rand() - 0.5;
    let qw = rand() - 0.5;
    const ql = Math.hypot(qx, qy, qz, qw);
    qx /= ql;
    qy /= ql;
    qz /= ql;
    qw /= ql;
    const q = { x: qx, y: qy, z: qz, w: qw };
    v.x = 10 * (rand() - 0.5);
    v.y = 10 * (rand() - 0.5);
    v.z = 10 * (rand() - 0.5);
    turnByQuat(q, v, false, a);
    // Against the rotation matrix of q, written out.
    const mx = (1 - 2 * (qy * qy + qz * qz)) * v.x + 2 * (qx * qy - qz * qw) * v.y + 2 * (qx * qz + qy * qw) * v.z;
    const my = 2 * (qx * qy + qz * qw) * v.x + (1 - 2 * (qx * qx + qz * qz)) * v.y + 2 * (qy * qz - qx * qw) * v.z;
    const mz = 2 * (qx * qz - qy * qw) * v.x + 2 * (qy * qz + qx * qw) * v.y + (1 - 2 * (qx * qx + qy * qy)) * v.z;
    turnByQuat(q, a, true, back);
    worst = Math.max(worst, Math.abs(a.x - mx), Math.abs(a.y - my), Math.abs(a.z - mz), Math.abs(back.x - v.x), Math.abs(back.y - v.y), Math.abs(back.z - v.z));
  }
  ok(worst < 1e-12, `turnByQuat turns a point as the quaternion's matrix does, and its inverse turns it back (worst ${worst.toExponential(1)} over 2000)`);
  const same = { x: 1, y: 2, z: 3 };
  turnByQuat({ x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }, same, false, same);
  ok(Math.abs(same.x - 3) < 1e-12 && Math.abs(same.y - 2) < 1e-12 && Math.abs(same.z + 1) < 1e-12, 'and it may write over the point it was handed (a quarter turn about y: (1, 2, 3) to (3, 2, -1))');
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
  // A loose prop on the line (wave 3a): the reels do nothing to it, so only the torch (F, the yank) and the emotes.
  const held = grappleMutes(out, true, false, true);
  const heldList = out.join(',');
  ok(held === 6 && heldList === 'flashlight,emoteWheel,emote1,emote2,emote3,emote4', `with a prop on the line only ${heldList}: the walk, the crouch and the postures are the player's`);
  const back = grappleMutes(out, true, false);
  ok(back === 10 && out.join(',') === onList && THING_RELEASE_MUTES.join(',') === 'flashlight', "and back on an anchor the whole list again; a prop's let-go owes the torch alone");
}

// The gravity knob, read as text: the add-back sits behind `gravity !== 1` and inside the swinging test.
{
  const src = readFileSync(new URL('../../../src/player/grapple.ts', import.meta.url), 'utf8');
  const calls = src.split('\n').filter((l) => l.includes('gravityAddBack(') && !l.includes('import'));
  // Two calls from wave 3: the still rope's step and the step of a rope on a hull, each behind the very same guard.
  ok(calls.length === 2 && calls.every((c) => /if \(T\.gravity !== 1 && m\.swinging\) vel\.y \+= gravityAddBack\(/.test(c)), `nothing calls gravityAddBack at a scale of 1, nor off the rope: each of its calls (the still rope's and a hull's) is behind gravity !== 1 and swinging (${calls.length} calls)`);
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

// Vehicles on the rope (wave 3b, §3.18): the reduced mass's share, the slip at its edges, the parked brake and its
// budget, the tow's hold and a hull's stillness band.
{
  ok(reducedShare(80, 320) === 0.2 && Math.abs(reducedShare(80, 880) - 1 / 12) < 1e-15 && reducedShare(80, Infinity) === 0, `a bike (320 kg) takes a fifth of an 80 kg player's catch, a pod (880) a twelfth, a hull that takes no pull nothing (${reducedShare(80, 900).toFixed(4)} for a 900 kg pod)`);
  const S = { slipKeep: 12, slipDecel: 60, slipTurn: 80, slipReel: 15, slipCorr: 0.25 };
  const dt = 1 / 60;
  ok(slipCatch(12, 12, S, dt) === 12 && slipLeft(12, 12, S, dt) === 1, 'a catch of 12 m/s with the whole allowance left is taken whole, and leaves the slip decel a frame (1 m/s) of it');
  ok(slipCatch(13, 12, S, dt) === 13 && slipLeft(13, 12, S, dt) === 0, 'one of 13 is taken whole too (the allowance and a frame of slipDecel) and spends it all');
  ok(slipCatch(14, 12, S, dt) === 13 && slipCatch(5, 0, S, dt) === 1, 'past it only the frame of slipDecel is taken: 13 of 14, and 1 of 5 once the allowance is spent');
  ok(slipLeft(0.5, 0, S, dt) === 0 && slipLeft(0.5, 6, S, dt) === 6, 'the allowance is never below nought, and a catch under the frame of slipDecel spends none of it');
  ok(!slipsTurn(80 * 10, 10, S) && slipsTurn(80 * 10 + 1, 10, S) && !slipsTurn(1e6, 0.5, S), 'a turn slips past 80 m/s² across the rope (exactly 80 holds) and never on a span of half a metre or less');
  ok(slipReelExcess(15 * dt, S, dt) === 0 && Math.abs(slipReelExcess(0.5, S, dt) - (0.5 - 0.25)) < 1e-15, 'a hull dragging a point away at 15 m/s is no slip; at 30 m/s over a frame of 60 fps the excess (0.25 m) pays out');
  const P = { parkHold: 0.6 };
  const g = 20.32;
  const per = 0.6 * 320 * g;
  const at144 = brakeBudget(0, 320, g, 1 / 144, P);
  const full144 = brakeBudget(at144 * 10, 320, g, 1 / 144, P);
  const full30 = brakeBudget(0, 320, g, 1 / 30, P);
  ok(Math.abs(at144 - per / 144) < 1e-9 && Math.abs(full144 - per / 60) < 1e-9 && Math.abs(full30 - per / 30) < 1e-9, `the brake's budget refills by parkHold x M x g a second and holds one physics step's worth at 144 fps (${full144.toFixed(2)} N s) and a frame's at 30 (${full30.toFixed(2)})`);
  // At 144 fps the rope pulls hardest on the frames that carry a physics step, two or three apart. Carried, the budget
  // meets 89% of the brake a second there (a gap of three frames is a fifth over one step's worth, and 24 of the second's
  // 60 gaps are threes) and all of it on every second frame; spent per pull call and never carried (the amendment's
  // first rule) it met 41%. The design said the carried budget meets the same brake on every second or third frame:
  // measured, every second frame does, every third 79%, the steps' own frames 89%.
  const second = (pulls: (f: number) => boolean, carried = true) => {
    let budget = 0;
    let held = 0;
    const out = { x: 0, z: 0, budget: 0, held: 0 };
    for (let f = 0; f < 144; f++) {
      budget = carried ? brakeBudget(budget, 320, g, 1 / 144, P) : per / 144;
      if (!pulls(f)) continue;
      held += parkedLevel({ x: 1e6, z: 0 }, true, budget, out);
      budget = out.budget;
    }
    return held;
  };
  // Which frames carry a step: the accumulator's own rule (a step whenever a sixtieth has gathered).
  const stepFrames = new Set<number>();
  {
    let acc = 0;
    for (let f = 0; f < 144; f++) {
      acc += 1 / 144;
      if (acc >= 1 / 60) {
        stepFrames.add(f);
        while (acc >= 1 / 60) acc -= 1 / 60;
      }
    }
  }
  const one = second(() => true);
  const two = second((f) => f % 2 === 0);
  const steps = second((f) => stepFrames.has(f));
  const perCall = second((f) => stepFrames.has(f), false);
  ok(Math.abs(two / one - 1) < 0.02 && steps / one > 0.85 && perCall / one < 0.5, `at 144 fps a pull on every frame, every second frame and the frames that carry a physics step meets ${one.toFixed(0)}, ${two.toFixed(0)} and ${steps.toFixed(0)} N s of brake a second; spent per call and never carried, ${perCall.toFixed(0)}`);
  const out = { x: 0, z: 0, budget: 0, held: 0 };
  const hang = 80 * g * (1 / 60);
  const heldHang = parkedLevel({ x: hang, z: 0 }, true, per / 60, out);
  ok(heldHang === hang && out.x === 0 && out.z === 0 && Math.abs(out.budget - (per / 60 - hang)) < 1e-9, `a steady hang's level pull (${hang.toFixed(2)} N s a frame) is held whole by a braked bike's budget (${(per / 60).toFixed(2)})`);
  const catchJ = 12 * 80;
  const heldCatch = parkedLevel({ x: 0, z: catchJ }, true, per / 60, out);
  ok(Math.abs(heldCatch - per / 60) < 1e-9 && Math.abs(out.z - (catchJ - per / 60)) < 1e-9 && out.budget === 0, `a catch (${catchJ} N s) spends the budget and the rest passes over the brake (${out.z.toFixed(2)})`);
  const heldOff = parkedLevel({ x: 3, z: 4 }, false, 100, out);
  ok(heldOff === 0 && out.x === 3 && out.z === 4 && out.budget === 100, 'an unbraked hull holds nothing back and spends no budget');
  ok(towing(true, 0.29, { towHold: 0.3 }) && !towing(true, 0.3, { towHold: 0.3 }) && !towing(false, 0, { towHold: 0.3 }), 'a tow holds within towHold of the last pull on a hull, and never off one');
  const L = { hullLag: 0.02 };
  ok(hullStill(0.02, false, L) && !hullStill(0.0201, false, L), 'a hull is still up to hullLag and moving past it');
  ok(!hullStill(0.0101, true, L) && hullStill(0.01, true, L), 'once taken for moving it is still again only under half of it (the band)');
  // The forms the hook calls every frame take their numbers in a kept record and answer in it; the plain forms above are
  // those same lines through a record of the file's own, so each is checked once. What the record form adds is the slots.
  const nums = new Float64Array(5);
  nums.set([14, 12, dt]);
  slipCatchIn(nums, S);
  const tookIn = nums[0];
  nums.set([tookIn, 12, dt]);
  slipLeftIn(nums, S);
  const leftIn = nums[0];
  nums.set([80, 320]);
  reducedShareIn(nums);
  const shareIn = nums[0];
  nums.set([0, 320, g, 1 / 30]);
  brakeBudgetIn(nums, P);
  const budgetIn = nums[0];
  nums.set([0.5, dt]);
  slipReelExcessIn(nums, S);
  const reelIn = nums[0];
  nums.set([801, 10]);
  const turnsIn = slipsTurnIn(nums, S);
  nums[0] = 0.29;
  const towIn = towingIn(true, nums, { towHold: 0.3 });
  nums[0] = 0.0201;
  const stillIn = hullStillIn(nums, false, L);
  const parkedIn = { x: 0, z: 0, budget: per / 60, held: -1 };
  parkedLevelIn({ x: hang, z: 0 }, true, parkedIn);
  ok(
    tookIn === 13 && leftIn === 0 && shareIn === 0.2 && budgetIn === brakeBudget(0, 320, g, 1 / 30, P) && reelIn === slipReelExcess(0.5, S, dt) && turnsIn && towIn && !stillIn && parkedIn.held === hang && parkedIn.x === 0 && Math.abs(parkedIn.budget - (per / 60 - hang)) < 1e-9,
    'the record forms the hook calls every frame answer in their own slots what the plain forms answer (the budget going in where it comes out, and what the brake held beside it)',
  );
  // clipInto and its record-writing sibling are one arithmetic.
  let same = true;
  for (let k = 0; k < 2000; k++) {
    const v = { x: rand() * 20 - 10, y: rand() * 20 - 10, z: rand() * 20 - 10 };
    const n = { x: rand() - 0.5, y: rand() - 0.5, z: rand() - 0.5 };
    const nl = Math.hypot(n.x, n.y, n.z);
    n.x /= nl;
    n.y /= nl;
    n.z /= nl;
    const sv = k % 3 === 0 ? null : { x: rand() * 4 - 2, y: rand() * 4 - 2, z: rand() * 4 - 2 };
    const rel = k % 2 === 0;
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 0 };
    const res = { into: 0 };
    const into = clipInto(v, n, sv, rel, a);
    clipIntoRec(v, n, sv, rel, b, res);
    if (!Object.is(into, res.into) || !Object.is(a.x, b.x) || !Object.is(a.y, b.y) || !Object.is(a.z, b.z)) same = false;
  }
  ok(same, 'clipInto and clipIntoRec answer alike over 2,000 random contacts, by Object.is');
}

// The oriented box (`grappleBox.ts`, built in wave 3b for another player's vehicle, which wave 3c rides; its comparison
// with the engine's own cuboid is that wave's test 13): its answers against a point-by-point march.
{
  const p = Float64Array.of(1, 2, 3);
  const a = Math.PI / 6;
  const q = Float64Array.of(0.1 * Math.sin(a / 2), Math.sin(a / 2) * 0.99, 0, Math.cos(a / 2));
  const ql = Math.hypot(q[0], q[1], q[2], q[3]);
  for (let i = 0; i < 4; i++) q[i] /= ql;
  const half = Float64Array.of(1, 0.5, 2);
  // Inside, by turning the point into the box's frame the long way (a rotation matrix from the quaternion).
  const [qx, qy, qz, qw] = q;
  const m = [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qx * qz - qy * qw), 2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qx * qw), 2 * (qx * qz + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy)];
  const inside = (x: number, y: number, z: number) => {
    const dx = x - p[0];
    const dy = y - p[1];
    const dz = z - p[2];
    const lx = m[0] * dx + m[1] * dy + m[2] * dz;
    const ly = m[3] * dx + m[4] * dy + m[5] * dz;
    const lz = m[6] * dx + m[7] * dy + m[8] * dz;
    return Math.abs(lx) < half[0] && Math.abs(ly) < half[1] && Math.abs(lz) < half[2];
  };
  const hit = newBoxHit();
  const o = new Float64Array(3);
  const d = new Float64Array(3);
  let rays = 0;
  let agree = 0;
  let hits = 0;
  for (let k = 0; k < 2000; k++) {
    o[0] = p[0] + (rand() - 0.5) * 12;
    o[1] = p[1] + (rand() - 0.5) * 12;
    o[2] = p[2] + (rand() - 0.5) * 12;
    if (inside(o[0], o[1], o[2])) continue;
    // Aimed near the box's middle, a little either way.
    d[0] = p[0] + (rand() - 0.5) * 3 - o[0];
    d[1] = p[1] + (rand() - 0.5) * 3 - o[1];
    d[2] = p[2] + (rand() - 0.5) * 3 - o[2];
    const dl = Math.hypot(d[0], d[1], d[2]);
    d[0] /= dl;
    d[1] /= dl;
    d[2] /= dl;
    rays++;
    let march = -1;
    for (let t = 0; t <= 20; t += 0.001) {
      if (inside(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t)) {
        march = t;
        break;
      }
    }
    const met = rayBox(o, d, 20, p, q, half, hit);
    if (met) hits++;
    if (met ? march >= 0 && Math.abs(hit.toi - march) < 2e-3 && Math.abs(Math.hypot(hit.nx, hit.ny, hit.nz) - 1) < 1e-9 && hit.nx * d[0] + hit.ny * d[1] + hit.nz * d[2] < 0 : march < 0) agree++;
  }
  ok(agree === rays && hits > rays / 4, `a ray against a turned box meets it where a millimetre march does, with a unit normal facing the ray, and misses it where the march does (${agree} of ${rays}, ${hits} hits)`);
  const mid = Float64Array.of(p[0], p[1], p[2]);
  const far = Float64Array.of(p[0] + 20, p[1], p[2]);
  ok(Math.abs(spanDepth(far, mid, p, q, half, 64) - 0.5) < 1e-9 && spanDepth(far, Float64Array.of(p[0] + 20, p[1] + 5, p[2]), p, q, half) === 0, "a span to the box's middle reaches its least half-size deep, one clear of it nothing");
  let quads = 0;
  let missed = 0;
  const quad = new Float64Array(12);
  for (let k = 0; k < 1000; k++) {
    for (let i = 0; i < 12; i++) quad[i] = p[i % 3] + (rand() - 0.5) * 8;
    // A point of either of the quad's two triangles inside the box means it meets: never a false miss. (The pivot at
    // the start, the hand at the start and at the end; then the hand at the end, the pivot at the end and at the start.)
    let any = false;
    for (const [i0, i1, i2] of [
      [0, 6, 9],
      [9, 3, 0],
    ]) {
      for (let s = 0; s <= 24 && !any; s++) {
        for (let t = 0; t <= 24 - s && !any; t++) {
          const u = s / 24;
          const w = t / 24;
          const x = quad[i0] + (quad[i1] - quad[i0]) * u + (quad[i2] - quad[i0]) * w;
          const y = quad[i0 + 1] + (quad[i1 + 1] - quad[i0 + 1]) * u + (quad[i2 + 1] - quad[i0 + 1]) * w;
          const z = quad[i0 + 2] + (quad[i1 + 2] - quad[i0 + 2]) * u + (quad[i2 + 2] - quad[i0 + 2]) * w;
          if (inside(x, y, z)) any = true;
        }
      }
    }
    if (!any) continue;
    quads++;
    if (!quadMeetsBox(quad, p, q, half)) missed++;
  }
  for (let i = 0; i < 12; i++) quad[i] = p[i % 3] + 30 + i;
  ok(quads > 50 && missed === 0 && !quadMeetsBox(quad, p, q, half), `a swept quad with any point in the box always meets it (${quads} quads, ${missed} missed), and one far off never`);
  // And never a false meeting. A point's distance to the box moves by no more than the point does, and every point of a
  // triangle sampled at 24 steps a side lies within one sample cell's longest edge of a sample, so a quad whose every
  // sample stands further off the box than that is clear of it for certain, and must not meet it.
  const away = (x: number, y: number, z: number) => {
    const dx = x - p[0];
    const dy = y - p[1];
    const dz = z - p[2];
    const lx = Math.max(Math.abs(m[0] * dx + m[1] * dy + m[2] * dz) - half[0], 0);
    const ly = Math.max(Math.abs(m[3] * dx + m[4] * dy + m[5] * dz) - half[1], 0);
    const lz = Math.max(Math.abs(m[6] * dx + m[7] * dy + m[8] * dz) - half[2], 0);
    return Math.hypot(lx, ly, lz);
  };
  let clear = 0;
  let falseHits = 0;
  let nearest = Infinity;
  for (let k = 0; k < 3000; k++) {
    for (let i = 0; i < 12; i++) quad[i] = p[i % 3] + (rand() - 0.5) * 10;
    let least = Infinity;
    let cell = 0;
    for (const [i0, i1, i2] of [
      [0, 6, 9],
      [9, 3, 0],
    ]) {
      const e = (a: number, b: number) => Math.hypot(quad[a] - quad[b], quad[a + 1] - quad[b + 1], quad[a + 2] - quad[b + 2]);
      cell = Math.max(cell, e(i0, i1) / 24, e(i1, i2) / 24, e(i2, i0) / 24);
      for (let s = 0; s <= 24; s++) {
        for (let t = 0; t <= 24 - s; t++) {
          const u = s / 24;
          const w = t / 24;
          const x = quad[i0] + (quad[i1] - quad[i0]) * u + (quad[i2] - quad[i0]) * w;
          const y = quad[i0 + 1] + (quad[i1 + 1] - quad[i0 + 1]) * u + (quad[i2 + 1] - quad[i0 + 1]) * w;
          const z = quad[i0 + 2] + (quad[i1 + 2] - quad[i0 + 2]) * u + (quad[i2 + 2] - quad[i0 + 2]) * w;
          least = Math.min(least, away(x, y, z));
        }
      }
    }
    if (!(least > cell + 1e-6)) continue;
    clear++;
    nearest = Math.min(nearest, least - cell);
    if (quadMeetsBox(quad, p, q, half)) falseHits++;
  }
  ok(clear > 100 && falseHits === 0, `and a swept quad clear of the box for certain never meets it (${clear} quads within 5 m of its middle, the nearest ${nearest.toFixed(3)} m clear, ${falseHits} false meetings)`);
}

console.log(`\n${checks} checks passed`);
