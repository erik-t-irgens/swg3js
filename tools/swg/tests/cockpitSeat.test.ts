// Where a ship's pilot looks from and sits: the hardpoint rules, the seat ray, the lift, the eye measured from a clip's
// joints, and the hovering cockpit's heading target, on synthetic numbers.
import assert from 'node:assert/strict';
import {
  COCKPIT_LEAD,
  COCKPIT_OFFSET_SHARE,
  EYE_OVER_PELVIS,
  SEAT_RULE,
  FIRST_PERSON_RAISE_MAX,
  LIFT_LIMIT,
  PELVIS_OVER_SEAT,
  SEATED_EYE_FALLBACK,
  SEATED_PELVIS_FALLBACK,
  bodyLift,
  chainPoint,
  clipLinks,
  cockpitYawStep,
  frameFileName,
  isEyeHardpoint,
  isGunHardpoint,
  isSeatHardpoint,
  mirroredOffset,
  offsetShare,
  pelvisOnSeat,
  riderOrigin,
  seatDropBelow,
  seatDropUsed,
  viewEye,
  type Quat,
  type Vec3,
} from '../../../src/vehicles/cockpitSeat.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const nearV = (a: readonly number[], b: readonly number[], eps = 1e-9) => a.length === b.length && a.every((x, i) => near(x, b[i], eps));

// The hardpoint rules: a gun is never a seat or an eye.
ok(isGunHardpoint('pilotmuzzle1'), 'pilotmuzzle1 is a gun');
ok(!isSeatHardpoint('pilotmuzzle1') && !isEyeHardpoint('pilotmuzzle1'), 'pilotmuzzle1 is neither a seat nor an eye');
ok(isEyeHardpoint('camera'), 'camera is an eye');
ok(isSeatHardpoint('pilot') && isSeatHardpoint('seat1'), 'pilot and seat1 are seats');
ok(isGunHardpoint('weapon1_neg1') && !isSeatHardpoint('weapon1_neg1') && !isEyeHardpoint('weapon1_neg1'), 'weapon1_neg1 is a gun and never a seat');
ok(!isGunHardpoint('engine_pos1') && !isSeatHardpoint('engine_pos1') && !isEyeHardpoint('engine_pos1'), 'engine_pos1 is none of them');

// The first-person offset: the converter mirrors X.
assert.deepEqual(mirroredOffset([0.2, 0.14, 0.1]), [-0.2, 0.14, 0.1]);
assert.deepEqual(mirroredOffset(null), [0, 0, 0]);
assert.deepEqual(mirroredOffset(undefined), [0, 0, 0]);
checks += 3;
console.log('ok   the first-person offset is mirrored in X, and nothing gives zeros');

// The seat ray.
{
  // A level triangle 0.8 under (0, 2, 0), covering the ray, wound either way.
  const level = (y: number, flip = false): number[] => (flip ? [-1, y, -1, 1, y, -1, 0, y, 1] : [-1, y, -1, 0, y, 1, 1, y, -1]);
  ok(near(seatDropBelow(level(1.2), 0, 2, 0)!, 0.8), 'a level triangle 0.8 under the point is found at 0.8');
  ok(near(seatDropBelow(level(1.2, true), 0, 2, 0)!, 0.8), 'wound the other way it is found as well');
  // A vertical triangle across the ray (in the plane x = 0) is ignored.
  const wall = [0, 0.5, -1, 0, 1.9, -1, 0, 1.2, 1];
  ok(seatDropBelow(wall, 0, 2, 0) === null, 'a vertical triangle across the ray is ignored');
  ok(seatDropBelow(level(1.7), 0, 2, 0) === null, 'a level triangle 0.3 under (above the window) is ignored');
  ok(seatDropBelow(level(0.5), 0, 2, 0) === null, 'a level triangle 1.5 under (below the window) is ignored');
  ok(near(seatDropBelow([...level(1.7), ...level(0.5), ...wall, ...level(1.2)], 0, 2, 0)!, 0.8), 'with all of them present the answer is still 0.8');
  // Slopes about the X axis through (0, 1.2, 0): |normal.y| = cos(tilt).
  const slope = (upY: number): number[] => {
    const s = Math.sqrt(1 - upY * upY); // the normal (0, upY, s): the surface rises -s/upY per metre of z
    const dy = s / upY;
    return [-1, 1.2 + dy, -1, 0, 1.2 - dy, 1, 1, 1.2 + dy, -1];
  };
  ok(near(seatDropBelow(slope(0.5), 0, 2, 0)!, 0.8, 1e-9), 'a slope with |normal.y| 0.5 is taken');
  ok(seatDropBelow(slope(0.3), 0, 2, 0) === null, 'a slope with |normal.y| 0.3 is not');
  ok(seatDropBelow([5, 1.2, 5, 6, 1.2, 6, 6, 1.2, 5], 0, 2, 0) === null, 'a triangle beside the ray gives null');
  // The nearest of two seats is the one taken.
  ok(near(seatDropBelow([...level(1.0), ...level(1.3)], 0, 2, 0)!, 0.7), 'the nearest seat under the point is taken');
}

// The lift.
ok(near(bodyLift(0.557, 0.708, 1, false), 0.251, 1e-12), 'a TIE seat lifts the body 0.251 in third person');
ok(near(bodyLift(0.557, 0.708, 1, true), FIRST_PERSON_RAISE_MAX, 1e-12), 'and 0.10 in first person');
ok(near(bodyLift(0.917, 0.708, 1, false), -0.109, 1e-12) && near(bodyLift(0.917, 0.708, 1, true), -0.109, 1e-12), 'a Y-wing seat lowers it 0.109 either way');
ok(near(bodyLift(1.5, 0.708, 1, false), -LIFT_LIMIT, 1e-12), 'a seat far below stops at the limit');
ok(bodyLift(null, 0.708, 1, false) === 0 && bodyLift(null, 0.708, 1, true) === 0, 'no seat, no lift');
ok(near(bodyLift(0.2, 0.708, 1.1, true), 0.11, 1e-12), 'at scale 1.1 the first-person cap is 0.11');
ok(near(bodyLift(0.8, 0.708 * 1.1, 1.1, false), 0.708 * 1.1 + 0.11 - 0.8, 1e-12), 'and PELVIS_OVER_SEAT counts 0.11');

// The pelvis for the logs.
ok(nearV(pelvisOnSeat([0, 2, 1], 0.8), [0, 2 - 0.8 + PELVIS_OVER_SEAT, 1 - 0.109], 1e-12), 'the pelvis sits 0.10 over the seat under the eye');
ok(nearV(pelvisOnSeat([0, 2, 1], null), [0 - EYE_OVER_PELVIS[0], 2 - EYE_OVER_PELVIS[1], 1 - EYE_OVER_PELVIS[2]], 1e-12), 'with no seat it hangs from the eye');

// A seeded random source, so a failure repeats.
let seed = 12345;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const randQuat = (): Quat => {
  // Shoemake's uniform quaternion.
  const u1 = rand(), u2 = rand() * 2 * Math.PI, u3 = rand() * 2 * Math.PI;
  const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
  return [a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)];
};
const randVec = (k = 3): Vec3 => [(rand() - 0.5) * 2 * k, (rand() - 0.5) * 2 * k, (rand() - 0.5) * 2 * k];
/** q * v by the rotation matrix, written independently of the module's own turn. */
const rotate = (q: Quat, v: Vec3): Vec3 => {
  const [x, y, z, w] = q;
  return [
    (1 - 2 * (y * y + z * z)) * v[0] + 2 * (x * y - z * w) * v[1] + 2 * (x * z + y * w) * v[2],
    2 * (x * y + z * w) * v[0] + (1 - 2 * (x * x + z * z)) * v[1] + 2 * (y * z - x * w) * v[2],
    2 * (x * z - y * w) * v[0] + 2 * (y * z + x * w) * v[1] + (1 - 2 * (x * x + y * y)) * v[2],
  ];
};

// riderOrigin: the figure's eye lands on the camera eye moved by exactly the offset.
{
  let good = true;
  for (let i = 0; i < 20; i++) {
    const q = randQuat();
    const eye = randVec(10);
    const seated = randVec(1.5);
    for (const offset of [[0, 0, 0] as Vec3, randVec(0.3)]) {
      const o = riderOrigin(eye, seated, q, offset);
      const r = rotate(q, seated);
      const qo = rotate(q, offset);
      const lhs: Vec3 = [o[0] + r[0], o[1] + r[1], o[2] + r[2]];
      const rhs: Vec3 = [eye[0] + qo[0], eye[1] + qo[1], eye[2] + qo[2]];
      if (!nearV(lhs, rhs, 1e-9)) good = false;
    }
  }
  ok(good, 'riderOrigin: origin + q*seatedEye = eye + q*offset for twenty random turns, with and without an offset');
}

// chainPoint.
{
  const s = Math.SQRT1_2;
  const yaw90: Quat = [0, s, 0, s];
  const id: Quat = [0, 0, 0, 1];
  ok(nearV(chainPoint([{ p: [0, 1, 0], q: yaw90 }, { p: [0, 0, 1], q: id }], [0, 0, 0]), [1, 1, 0], 1e-12), 'a parent turned 90 degrees about Y carries its child 1 m along Z to (1, 1, 0)');
  ok(nearV(chainPoint([{ p: [1, 2, 3], q: id }, { p: [0.5, -1, 2], q: id }], [0.1, 0.2, 0.3]), [1.6, 1.2, 5.3], 1e-12), 'an identity chain adds the positions');
}

// clipLinks then chainPoint: the eye measurement on a three-joint chain.
{
  const s = Math.SQRT1_2;
  const chain = [
    { name: 'root', restP: [0, 0.5, 0] as Vec3, restQ: [0, 0, 0, 1] as Quat },
    { name: 'spine', restP: [0, 0.3, 0] as Vec3, restQ: [0, 0, 0, 1] as Quat },
    { name: 'head', restP: [0, 0.4, 0] as Vec3, restQ: [0, 0, 0, 1] as Quat },
  ];
  const tracks = new Map<string, ArrayLike<number>>([
    ['spine.quaternion', [s, 0, 0, s, 0, 0, 0, 1]], // 90 degrees about X in its first key, something else after
    ['head.position', [0, 0.25, 0.05, 9, 9, 9]],
  ]);
  const links = clipLinks(chain, tracks);
  ok(nearV(links[0].p, [0, 0.5, 0]) && nearV(links[0].q, [0, 0, 0, 1]), 'an untracked root takes its rest values');
  ok(nearV(links[1].q, [s, 0, 0, s]) && nearV(links[2].p, [0, 0.25, 0.05]), 'tracked joints take their first keys');
  const head = chainPoint(links, [0, 0, 0]);
  // By hand: root at (0, 0.5, 0); spine 0.3 up from it, turned 90 degrees about X, so +Y goes to +Z and +Z to -Y;
  // the head's (0, 0.25, 0.05) in the spine's frame is (0, -0.05, 0.25).
  const byHand: Vec3 = [0, 0.5 + 0.3 - 0.05, 0.25];
  ok(nearV(head, byHand, 1e-12), 'the composed head equals the hand-composed point');
  // A figure 1.1 times the size (every joint's offset and the point in the head's frame scaled, the turns the same)
  // puts the head 1.1 times as far out: what applying the rig root's scale after the measurement relies on.
  const big = links.map((l) => ({ p: [l.p[0] * 1.1, l.p[1] * 1.1, l.p[2] * 1.1] as Vec3, q: l.q }));
  ok(nearV(chainPoint(big, [0, 0.0725 * 1.1, 0.09 * 1.1]), chainPoint(links, [0, 0.0725, 0.09]).map((n) => n * 1.1), 1e-12), 'a chain scaled 1.1 throughout gives the unscaled point times 1.1');
  const eye = chainPoint(links, [0, 0.0725, 0.09]);
  ok(nearV(eye, [0, byHand[1] - 0.09, byHand[2] + 0.0725], 1e-12), 'a point in the head joint\'s frame is carried through the whole chain');
}

// The hovering cockpit's heading target.
{
  const k = 0.0025;
  ok(cockpitYawStep(null, 1.2, 0, k) === 1.2, 'from nothing it starts at the hull\'s heading');
  ok(near(cockpitYawStep(null, 0.5, 100, k), 0.5 - 0.25, 1e-12), '100 px at k 0.0025 moves it by -0.25');
  ok(near(cockpitYawStep(null, 0.5, 1000, k), 0.5 - COCKPIT_LEAD, 1e-12), '1000 px stops at the lead');
  ok(near(cockpitYawStep(null, 0.5, -1000, k), 0.5 + COCKPIT_LEAD, 1e-12), 'the other way it stops at the lead too');
  // Across the seam: the hull at 3.1 rad, the target already 0.5 ahead past PI (3.6, which is -2.683).
  const h = 3.1;
  const t = cockpitYawStep(-2.683, h, -200, k); // wants 0.5 more to the left
  const d = Math.atan2(Math.sin(t - h), Math.cos(t - h));
  ok(Math.abs(d) <= COCKPIT_LEAD + 1e-12 && d > 0, 'a step across the seam stays within the lead');
  // Kept going: a held target converges nowhere past the lead.
  let target: number | null = null;
  for (let i = 0; i < 50; i++) target = cockpitYawStep(target, h, -50, k);
  ok(near(Math.atan2(Math.sin(target! - h), Math.cos(target! - h)), COCKPIT_LEAD, 1e-9), 'a mouse kept moving holds the target at the lead');
}

// The nudge table's key: a frame's file name without its folder.
ok(frameFileName('assets-private/ships/tie_fighter_cockpit_cockpit.glb') === 'tie_fighter_cockpit_cockpit.glb' && frameFileName(null) === '' && frameFileName('a\\b.glb') === 'b.glb', 'a frame file is keyed by its name without the folder');

// The constants agree.
ok(nearV(SEATED_EYE_FALLBACK.map((n, i) => n - SEATED_PELVIS_FALLBACK[i]), EYE_OVER_PELVIS, 1e-12), 'SEATED_EYE_FALLBACK - SEATED_PELVIS_FALLBACK equals EYE_OVER_PELVIS');

// The share of 1OFF a frame's view takes: the B-wing's half, all of it elsewhere.
ok(offsetShare('assets-private/ships/bwing_cockpit_cockpit.glb') === 0.5 && offsetShare('xwing_cockpit_cockpit.glb') === 1 && offsetShare(null) === 1, "the B-wing's frame takes half its 1OFF, any other frame all of it");
ok(Object.values(COCKPIT_OFFSET_SHARE).every((s) => s >= 0 && s <= 1), 'every listed share is within 0..1');
ok(nearV(viewEye([1, 2, 3], mirroredOffset([0, 0.14, 0.1]), 0.5), [1, 2.07, 3.05], 1e-12), "the B-wing's view eye is the camera point plus half of 1OFF");

// The seat rule: the eyes on the eye leave no cushion to place the body by; the cushion rule keeps the measured one.
ok(seatDropUsed(0.7, 'eyes') === null && seatDropUsed(0.7, 'cushion') === 0.7 && seatDropUsed(null, 'cushion') === null, "the 'eyes' rule places by no cushion, the 'cushion' rule by the one measured");
ok(SEAT_RULE.place === 'eyes' && seatDropUsed(0.557) === null, "the default rule is the owner's: the eyes on the eye");

// The placement, as Player.syncMount does it for a ship seated by the eye: the eye it hangs the body from is the view's
// own cockpitEye() (camera + share x offset) less the whole offset plus the frame file's 1OFF (mirrored), and the body
// goes eye - q*(seatedEye - nudge - lift). With the eyes on the eye (lift 0, no nudge) the figure's seated eyes land on
// the view eye exactly, for any share, turn, figure size and seated pose, in first and third person alike.
// Player.syncMount's formula is mirrored here, not imported (it lives in a class that needs a scene and a rig): this
// guards viewEye, seatDropUsed and what the garage stores, and a change to syncMount's own arithmetic must be copied in.
{
  let good = true;
  let worst = 0;
  for (let i = 0; i < 40; i++) {
    const q = randQuat();
    const camera = randVec(8);
    const authored: Vec3 = [(rand() - 0.5) * 0.4, rand() * 0.3, rand() * 0.3];
    const off = mirroredOffset(authored);
    const share = [0, 0.5, 1, rand()][i % 4];
    const view = viewEye(camera, off, share);
    // Player.syncMount's eye: cockpitEye() - cockpitOffset + (f with X mirrored).
    const hang: Vec3 = [view[0] - off[0] - authored[0], view[1] - off[1] + authored[1], view[2] - off[2] + authored[2]];
    const scale = 0.85 + rand() * 0.3;
    const seatedEye: Vec3 = [SEATED_EYE_FALLBACK[0] * scale, SEATED_EYE_FALLBACK[1] * scale, SEATED_EYE_FALLBACK[2] * scale];
    for (const firstPerson of [false, true]) {
      const lift = bodyLift(seatDropUsed(0.3 + rand()), EYE_OVER_PELVIS[1] * scale, scale, firstPerson);
      if (lift !== 0) good = false;
      const origin = riderOrigin(hang, [seatedEye[0], seatedEye[1] - lift, seatedEye[2]], q);
      const r = rotate(q, seatedEye);
      const eyesAt: Vec3 = [origin[0] + r[0], origin[1] + r[1], origin[2] + r[2]];
      worst = Math.max(worst, Math.hypot(eyesAt[0] - view[0], eyesAt[1] - view[1], eyesAt[2] - view[2]));
    }
  }
  ok(good && worst < 1e-9, `the seated eyes land on the view eye for forty ships, shares 0 to 1, both views (worst ${worst.toExponential(1)} m)`);
}
// The cushion rule, kept for a comparison: the same arithmetic lifts the body by bodyLift, so its eyes leave the eye by it.
{
  const drop = 0.557;
  const lift = bodyLift(seatDropUsed(drop, 'cushion'), EYE_OVER_PELVIS[1], 1, false);
  const origin = riderOrigin([0, 2, 0], [SEATED_EYE_FALLBACK[0], SEATED_EYE_FALLBACK[1] - lift, SEATED_EYE_FALLBACK[2]], [0, 0, 0, 1]);
  ok(near(origin[1] + SEATED_EYE_FALLBACK[1] - 2, lift, 1e-12) && near(lift, 0.251, 1e-12), "under the cushion rule a TIE's seated eyes stand 0.251 over the eye, as before");
}

console.log(`${checks} checks passed`);
