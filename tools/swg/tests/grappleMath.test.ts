// The grapple's arithmetic that needs nothing but numbers (`src/player/grappleMath.ts`), and two lines of
// `grapple.ts` read as text: the gravity knob's add-back is asked only off 1 and only while swinging.
//
// Run: node tools/swg/tests/grappleMath.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GRAPPLE_RELEASE_MUTES,
  aimTrue,
  clipInto,
  grappleMutes,
  gravityAddBack,
  len2,
  len3,
  markShows,
  newRopeModes,
  ribbonWidth,
  riseOf,
  ropeModes,
  sagOf,
  swimLifts,
  teleported,
  underWater,
  wadeDragOf,
  wallFrictionSpare,
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

console.log(`\n${checks} checks passed`);
