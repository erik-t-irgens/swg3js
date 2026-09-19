// Mouse flight (src/space/mouseFlight.ts) and the NPC pilots' hand (src/space/pilot.ts): the cursor that stays where
// it is left, the stick it asks for (nothing inside the aim circle, full at the ring, toward the cursor), the guns'
// aim through the cursor and onto the lead, a held turn that keeps turning in flyShip's own integration, the skill's
// cap and lag on an NPC's stick, and the fight against a tier-1 TIE from the numbers: the turn rates, a TIE turning its
// hardest that a player who keeps the cursor on its lead must kill, the turnaround after a head-on pass, and the time
// on target each side needs. Synthetic numbers only: nothing from the client's files.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MOUSE_FLIGHT, aimCursor, circleRadius, clampTo, coneClamp, cursorOf, flightTune, gunAim, hullRay, insideCircle, moveCursor, radiusOf, ringRadius, stickFromCursor, viewRay, type Cursor, type FlightStick } from '../../../src/space/mouseFlight.ts';
import { PILOT_SKILL, aimPoint, offNose, skillOfTier, skillStick, steerToward, toLocal, type PilotSkill, type Stick } from '../../../src/space/pilot.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const DEG = Math.PI / 180;
/** The game's view: 60 degrees high. */
const TAN_HALF = Math.tan(30 * DEG);

// ---------------------------------------------------------------------------------------------
// The cursor and the stick.
{
  const rc = circleRadius(TAN_HALF);
  const rr = ringRadius(TAN_HALF);
  ok(near(rc, Math.tan(MOUSE_FLIGHT.circleDeg * DEG) / TAN_HALF) && rr > rc, 'circleRadius and ringRadius: the cones as cursor radii, the ring beyond the circle');
  ok(rr < 1, 'the ring fits inside the view vertically (a cursor at its reach is still on the screen)');
  const s: FlightStick = { x: 0, y: 0, turn: 0 };
  ok(stickFromCursor({ x: 0, y: 0 }, TAN_HALF, s).turn === 0 && s.x === 0 && s.y === 0, 'stickFromCursor: the middle turns nothing');
  ok(stickFromCursor({ x: rc * 0.99, y: 0 }, TAN_HALF, s).turn === 0, 'stickFromCursor: inside the circle turns nothing');
  const deadEnd = rc + (rr - rc) * MOUSE_FLIGHT.deadZone;
  ok(stickFromCursor({ x: 0, y: -(deadEnd - 1e-6) }, TAN_HALF, s).turn === 0, 'stickFromCursor: the dead zone past the rim turns nothing');
  stickFromCursor({ x: rr, y: 0 }, TAN_HALF, s);
  ok(near(s.x, 1) && near(s.y, 0) && near(s.turn, 1), 'stickFromCursor: full right at the ring (x > 0: flyShip turns right)');
  stickFromCursor({ x: 0, y: rr }, TAN_HALF, s);
  ok(near(s.y, 1) && near(s.x, 0), 'stickFromCursor: the cursor below pushes the nose down (y > 0)');
  stickFromCursor({ x: -rr * Math.SQRT1_2, y: -rr * Math.SQRT1_2 }, TAN_HALF, s);
  ok(s.x < 0 && s.y < 0 && near(Math.hypot(s.x, s.y), 1), 'stickFromCursor: up-left at the ring is a full stick up-left');
  let prev = -1;
  let rising = true;
  for (let i = 0; i <= 50; i++) {
    const t = stickFromCursor({ x: (rr * i) / 50, y: 0 }, TAN_HALF, s).turn;
    if (t < prev) rising = false;
    prev = t;
  }
  ok(rising, 'stickFromCursor: the stick never falls as the cursor goes out');

  // The cursor stays where it is left: no drift back to the middle, however long the mouse rests.
  const c: Cursor = { x: 0, y: 0 };
  moveCursor(c, 120, -40, 540, 1, false, TAN_HALF);
  const kept = { x: c.x, y: c.y };
  for (let i = 0; i < 600; i++) moveCursor(c, 0, 0, 540, 1, false, TAN_HALF);
  ok(near(c.x, kept.x) && near(c.y, kept.y) && near(kept.x, 120 / 540) && near(kept.y, -40 / 540), 'moveCursor: a pixel is a pixel (of 540 half-height), and ten seconds at rest leave the cursor where it was');
  moveCursor(c, 0, 40, 540, 1, true, TAN_HALF);
  ok(near(c.y, -80 / 540), 'moveCursor: inverted, a move down takes the cursor up');
  moveCursor(c, 1e5, 0, 540, 1, false, TAN_HALF);
  ok(near(Math.hypot(c.x, c.y), rr, 1e-9), 'moveCursor: kept on the ring when pushed past it');
  const a: Cursor = { x: 0, y: 0 };
  aimCursor(c, TAN_HALF, a);
  ok(near(Math.hypot(a.x, a.y), rc, 1e-9) && near(Math.atan2(a.y, a.x), Math.atan2(c.y, c.x), 1e-9), 'aimCursor: outside the circle the guns aim at its rim, toward the cursor');
  ok(insideCircle({ x: rc * 0.5, y: 0 }, TAN_HALF) && !insideCircle({ x: rc * 1.01, y: 0 }, TAN_HALF), 'insideCircle');
  ok(near(clampTo({ x: 3, y: 4 }, 1).x, 0.6), 'clampTo');

  // The view ray and back.
  const r = { x: 0, y: 0, z: 0 };
  viewRay({ x: 0, y: 0 }, TAN_HALF, r);
  ok(near(r.z, -1) && near(r.x, 0), 'viewRay: the middle looks down -Z');
  viewRay({ x: rc, y: 0 }, TAN_HALF, r);
  ok(near(Math.acos(-r.z), MOUSE_FLIGHT.circleDeg * DEG, 1e-9) && r.x > 0, 'viewRay: the circle\'s rim is the circle\'s angle off the middle (to the right)');
  viewRay({ x: 0.1, y: 0.2 }, TAN_HALF, r);
  const back = cursorOf(r, TAN_HALF, { x: 0, y: 0 })!;
  ok(near(back.x, 0.1, 1e-9) && near(back.y, 0.2, 1e-9) && r.y < 0, 'cursorOf undoes viewRay (a cursor below looks down)');
  ok(cursorOf({ x: 0, y: 0, z: 1 }, TAN_HALF, { x: 0, y: 0 }) === null, 'cursorOf: nothing for a direction behind the view');
  ok(near(radiusOf(30, TAN_HALF), 1, 1e-9), 'radiusOf: the view\'s half-angle is one half-height');
  // The cursor about the hull's nose (x left, y up, z the nose): the middle is the nose, right of it the hull's -X.
  const h = { x: 0, y: 0, z: 0 };
  hullRay({ x: 0, y: 0 }, TAN_HALF, h);
  ok(near(h.z, 1) && near(h.x, 0) && near(h.y, 0), 'hullRay: the middle is the nose (+Z)');
  hullRay({ x: rc, y: -rc }, TAN_HALF, h);
  ok(h.x < 0 && h.y > 0 && h.z > 0 && near(Math.hypot(h.x, h.y, h.z), 1, 1e-12), "hullRay: up and right of the middle is up and to the hull's right (-X), a unit vector");
  // The cockpit camera is the hull's turned half a turn about Y: hullRay is viewRay seen through it.
  const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const vr = viewRay({ x: 0.13, y: -0.07 }, TAN_HALF, new THREE.Vector3()).applyQuaternion(flip);
  hullRay({ x: 0.13, y: -0.07 }, TAN_HALF, h);
  ok(near(vr.x, h.x, 1e-12) && near(vr.y, h.y, 1e-12) && near(vr.z, h.z, 1e-12), "hullRay is the cockpit camera's viewRay in the hull's frame");
}

// ---------------------------------------------------------------------------------------------
// The guns' aim: through the cursor to where the guns cross, or onto the lead.
{
  const eye = { x: 0, y: 3, z: -10 };
  const ray = { x: 0, y: 0, z: 0 };
  const rc = circleRadius(TAN_HALF);
  // A camera looking down the world's +Z (turned half a turn about Y), the cursor at the rim, right.
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  viewRay({ x: rc, y: 0 }, TAN_HALF, ray);
  const w = new THREE.Vector3(ray.x, ray.y, ray.z).applyQuaternion(q);
  const rw = { x: w.x, y: w.y, z: w.z };
  const left = { x: 5, y: 0, z: 0 };
  const right = { x: -5, y: 0, z: 0 };
  const dl = { x: 0, y: 0, z: 0 };
  const dr = { x: 0, y: 0, z: 0 };
  gunAim(left, eye, rw, 300, null, 2 * DEG, dl);
  gunAim(right, eye, rw, 300, null, 2 * DEG, dr);
  const P = new THREE.Vector3(eye.x, eye.y, eye.z).addScaledVector(w, 300);
  const hitL = new THREE.Vector3(left.x, left.y, left.z).addScaledVector(new THREE.Vector3(dl.x, dl.y, dl.z), P.distanceTo(new THREE.Vector3(left.x, left.y, left.z)));
  const hitR = new THREE.Vector3(right.x, right.y, right.z).addScaledVector(new THREE.Vector3(dr.x, dr.y, dr.z), P.distanceTo(new THREE.Vector3(right.x, right.y, right.z)));
  ok(hitL.distanceTo(P) < 1e-6 && hitR.distanceTo(P) < 1e-6, 'gunAim: both guns\' bolts cross under the cursor at the convergence');
  ok(w.x < 0 && dl.x < 0, 'gunAim: the cursor right of the middle swings the guns to the view\'s right (the world\'s -X here)');
  const lead = { x: P.x + 4, y: P.y, z: P.z };
  ok(gunAim(left, eye, rw, 300, lead, 2 * DEG, dl) && near(new THREE.Vector3(left.x, left.y, left.z).addScaledVector(new THREE.Vector3(dl.x, dl.y, dl.z), 400).sub(new THREE.Vector3(lead.x, lead.y, lead.z)).cross(new THREE.Vector3(dl.x, dl.y, dl.z)).length(), 0, 1e-6), 'gunAim: a lead within the snap is taken exactly');
  const farLead = { x: P.x + 60, y: P.y, z: P.z };
  ok(!gunAim(left, eye, rw, 300, farLead, 2 * DEG, dl), 'gunAim: a lead beyond the snap is not');

  // The hard cone: no shot leaves further off the nose than the guns' cone (main.ts's SHIP_GUN_CONE, 12 degrees).
  const nose = { x: 0, y: 0, z: 1 };
  const inCone = { x: Math.sin(5 * DEG), y: 0, z: Math.cos(5 * DEG) };
  ok(!coneClamp(inCone, nose, 12 * DEG) && near(inCone.x, Math.sin(5 * DEG)), 'coneClamp: a shot inside the cone is left alone');
  const wide = new THREE.Vector3(1, 1, 0.3).normalize();
  const w2 = { x: wide.x, y: wide.y, z: wide.z };
  ok(coneClamp(w2, nose, 12 * DEG) && near(Math.acos(w2.z), 12 * DEG, 1e-9) && near(Math.hypot(w2.x, w2.y, w2.z), 1, 1e-12) && near(Math.atan2(w2.y, w2.x), Math.atan2(wide.y, wide.x), 1e-9), 'coneClamp: a shot off to the side is turned onto the cone\'s edge, on its own side, a unit vector');
  const back = { x: 0, y: 0, z: -1 };
  ok(coneClamp(back, nose, 12 * DEG) && near(back.z, 1), 'coneClamp: a shot straight behind comes out along the nose');
}

// ---------------------------------------------------------------------------------------------
// flyShip's own integration (Vehicle.flyShip: the stick asks for 1.5 times the rate about the ship's axes, eased by its inertia).
interface Body {
  pos: THREE.Vector3;
  a: THREE.Quaternion;
  spin: THREE.Vector3;
  cruise: number;
}
const qStep = new THREE.Quaternion();
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
function flyStep(b: Body, st: { x: number; y: number; roll: number }, rate: number, inertia: number, dt: number): void {
  const ease = Math.min(1, dt / inertia);
  const easeRoll = Math.min(1, (2 * dt) / inertia);
  b.spin.y += (-st.x * rate * 1.5 - b.spin.y) * ease;
  b.spin.x += (st.y * rate * 1.5 - b.spin.x) * ease;
  b.spin.z += (st.roll * rate * 1.6 - b.spin.z) * easeRoll;
  b.a.multiply(qStep.setFromAxisAngle(AY, b.spin.y * dt));
  b.a.multiply(qStep.setFromAxisAngle(AX, b.spin.x * dt));
  b.a.multiply(qStep.setFromAxisAngle(AZ, b.spin.z * dt));
  b.a.normalize();
  b.pos.addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(b.a), b.cruise * dt);
}
{
  // The cursor left out at the ring's right for three seconds: the ship keeps turning the whole time.
  const b: Body = { pos: new THREE.Vector3(), a: new THREE.Quaternion(), spin: new THREE.Vector3(), cruise: 200 };
  const c: Cursor = { x: 0, y: 0 };
  moveCursor(c, 1e4, 0, 540, 1, false, TAN_HALF);
  const s: FlightStick = { x: 0, y: 0, turn: 0 };
  let heading = 0;
  let last = 0;
  const dt = 1 / 60;
  let lastSecond = 0;
  for (let t = 0; t < 3; t += dt) {
    stickFromCursor(c, TAN_HALF, s);
    flyStep(b, { x: s.x, y: s.y, roll: 0 }, 1.1, 0.55, dt);
    const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(b.a);
    const h = Math.atan2(nose.x, nose.z);
    let d = h - last;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    heading += d;
    last = h;
    if (t >= 2 && t < 2 + dt) lastSecond = heading;
  }
  ok(heading < -3.5, `a cursor held at the ring turns a fighter more than 200 degrees in 3 s (${(-heading / DEG).toFixed(0)}), to its right (-X)`);
  ok(heading - lastSecond < -1.5, `and it is still turning at full rate in the third second (${((lastSecond - heading) / DEG).toFixed(0)} degrees)`);
  // The same hand under the old stick, which drifted back to the middle at 2.5 a second once the mouse stopped.
  let oldX = 1;
  let oldHeading = 0;
  const ob: Body = { pos: new THREE.Vector3(), a: new THREE.Quaternion(), spin: new THREE.Vector3(), cruise: 200 };
  for (let t = 0; t < 3; t += dt) {
    oldX -= oldX * Math.min(1, 2.5 * dt);
    flyStep(ob, { x: oldX, y: 0, roll: 0 }, 1.1, 0.55, dt);
  }
  const on = new THREE.Vector3(0, 0, 1).applyQuaternion(ob.a);
  oldHeading = Math.atan2(on.x, on.z);
  ok(Math.abs(oldHeading) < 60 * DEG, `where the old stick, flicked full and let rest, came round only ${(Math.abs(oldHeading) / DEG).toFixed(0)} degrees`);
}

// ---------------------------------------------------------------------------------------------
// The NPC's hand.
{
  const want: Stick = { x: 1, y: -1, roll: 0.5 };
  const held: Stick = { x: 0, y: 0, roll: 0 };
  const skill = { ...skillOfTier(1) };
  skillStick(want, skill, 1 / 60, held);
  ok(held.x > 0 && held.x < skill.stickMax * 0.1, 'skillStick: the hand does not jump to the stick it wants');
  for (let i = 0; i < 600; i++) skillStick(want, skill, 1 / 60, held);
  ok(near(Math.hypot(held.x, held.y), skill.stickMax, 1e-6) && near(held.x, -held.y, 1e-9) && near(held.roll, 0.5 * skill.stickMax, 1e-6), "skillStick: it settles on the wanted turn's direction, its reach capped at the tier's stickMax (not each axis: a diagonal is no faster)");
  const small: Stick = { x: 0, y: 0, roll: 0 };
  for (let i = 0; i < 600; i++) skillStick({ x: 0.2, y: 0.1, roll: 0 }, skill, 1 / 60, small);
  ok(near(small.x, 0.2, 1e-6) && near(small.y, 0.1, 1e-6), 'skillStick: a turn under the cap is left as it is');
  const instant: PilotSkill = { ...skill, stickMax: 1, response: 0 };
  const h2: Stick = { x: 0, y: 0, roll: 0 };
  skillStick({ x: 0, y: 2, roll: -3 }, instant, 1 / 60, h2);
  ok(near(h2.x, 0) && near(h2.y, 1) && near(h2.roll, -1), 'skillStick: a perfect hand (cap 1, response 0) is steerToward\'s stick at once, clamped');
  const h3: Stick = { x: 0, y: 0, roll: 0 };
  skillStick({ x: 1, y: -1, roll: 0.5 }, skill, 1 / 60, h3, true);
  ok(near(h3.x, 1) && near(h3.y, -1) && near(h3.roll, 0.5), 'skillStick: pulling away from something (urgent) is the whole stick at once, uncapped, as every pilot flew before');
  const slew: Stick = { x: 0, y: 0, roll: 0 };
  skillStick({ x: 1, y: 0, roll: 0 }, { ...skill, stickMax: 1 }, 0.1, slew);
  ok(near(slew.x, 0.1 / skill.response, 1e-12), 'skillStick: the hand moves the stick at full travel in `response` seconds, no faster');

  // The hand in the loop: a ship holding a fixed direction that starts off its nose, flown by steerToward through
  // the hand and flyShip's integration, settles on it for every tier and hull (rates 0.6 to 1.5, inertias 0.4 to 1.2).
  // A lag in the hand (as the first cut had) left a tier-1 pilot swinging 15 degrees either side for as long as it flew.
  {
    const bank = 35 * DEG; // the brain's TUNE.bankBeyond
    const dt = 1 / 60;
    let worst = 0;
    let worstAt = '';
    for (let tier = 1; tier <= 5; tier++) {
      for (const rate of [0.6, 0.9, 1.2, 1.5]) {
        for (const inertia of [0.4, 0.8, 1.2]) {
          for (const start of [0.05, 0.3, 1.5]) {
            const b: Body = { pos: new THREE.Vector3(), a: new THREE.Quaternion(), spin: new THREE.Vector3(), cruise: 150 };
            const phi = 0.7;
            const to = { x: Math.sin(start) * Math.cos(phi), y: Math.sin(start) * Math.sin(phi), z: Math.cos(start) };
            const local = { x: 0, y: 0, z: 0 };
            const want: Stick = { x: 0, y: 0, roll: 0 };
            const held: Stick = { x: 0, y: 0, roll: 0 };
            let late = 0;
            // From 15 s on: the slowest hull (0.6 rad/s, inertia 1.2) needs that long to come round 1.5 rad even with a
            // perfect hand (1.0 degrees off at 10 to 15 s with either); a weave would still be there at 25.
            for (let t = 0; t < 25; t += dt) {
              toLocal(b.a, to, local);
              if (t >= 15) late = Math.max(late, offNose(local));
              steerToward(local, bank, null, want);
              skillStick(want, PILOT_SKILL[tier], dt, held);
              flyStep(b, held, rate, inertia, dt);
            }
            if (late > worst) {
              worst = late;
              worstAt = `tier ${tier}, rate ${rate}, inertia ${inertia}, from ${start} rad`;
            }
          }
        }
      }
    }
    ok(worst < 1 * DEG, `skillStick in the loop: every tier holds a direction within a degree from 15 s on, from 0.05, 0.3 and 1.5 rad off, on every hull (worst ${(worst / DEG).toFixed(2)} degrees, ${worstAt})`);
  }
  let capRising = true;
  let respFalling = true;
  let scatterFalling = true;
  for (let t = 2; t <= 5; t++) {
    if (PILOT_SKILL[t].stickMax < PILOT_SKILL[t - 1].stickMax) capRising = false;
    if (PILOT_SKILL[t].response > PILOT_SKILL[t - 1].response) respFalling = false;
    if (PILOT_SKILL[t].scatterDeg > PILOT_SKILL[t - 1].scatterDeg) scatterFalling = false;
  }
  ok(capRising && respFalling && scatterFalling && PILOT_SKILL[5].stickMax < 1, 'PILOT_SKILL: every tier turns and aims at least as well as the one under it, and none has a perfect hand');
  ok(skillOfTier(0) === PILOT_SKILL[1] && skillOfTier(9) === PILOT_SKILL[5] && skillOfTier(2.6) === PILOT_SKILL[3], 'skillOfTier clamps and rounds');
  const was = flightTune();
  const t = flightTune({ circleDeg: 7, npc: { 2: { stickMax: 0.5 } } });
  ok(t.flight.circleDeg === 7 && MOUSE_FLIGHT.circleDeg === 7 && PILOT_SKILL[2].stickMax === 0.5 && t.npc[2].stickMax === 0.5, 'flightTune sets the flight\'s numbers and a tier\'s skill in place');
  flightTune({ circleDeg: was.flight.circleDeg, npc: { 2: { stickMax: was.npc[2].stickMax } } });
  ok(MOUSE_FLIGHT.circleDeg === was.flight.circleDeg && flightTune({ circleDeg: Number.NaN }).flight.circleDeg === was.flight.circleDeg && PILOT_SKILL[2].stickMax === was.npc[2].stickMax, 'flightTune ignores a number that is not finite (and the knobs are back as they were)');
}

// ---------------------------------------------------------------------------------------------
// The fight, from the numbers. Two fighters in space, flown kinematically in flyShip's integration: the player's stock
// X-wing (rate 1.1, inertia 0.55, four guns firing every 0.25 s) and a tier-1 TIE fighter (its family's agility 1.1: rate
// 1.21, inertia 0.5; two guns every 0.55 s), both 600 m/s bolts out to 512 m. The kill counts are the combat test's (a
// tier-1 TIE takes 14 of the stock X-wing's bolts from the front, the X-wing 22 of the TIE's). The player is a hand that
// keeps the cursor on the target's lead in the cockpit view: it sees the lead 0.2 s late and carries on its motion over
// that delay (as an eye follows a thing moving), moves the cursor there at four half-heights a second at most (off the
// view or past the ring: to the ring on the lead's side), never rolls, and holds the trigger whenever the guns take the
// lead. Hit spheres (the TIE 3.5 m, the X-wing 5 m), the hand and the starts are the test's own invented numbers.
function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SIM = {
  dt: 1 / 60,
  bolt: 600,
  range: 512,
  player: { rate: 1.1, inertia: 0.55, radius: 5, interval: 0.25, kill: 22 },
  tie: { rate: 1.1 * 1.1, inertia: 0.55 / 1.1, radius: 3.5, interval: 0.55, kill: 14 },
  handDelay: 0.2,
  /** How far back the eye reads the lead's motion (s). */
  handMotion: 0.1,
  handSpeed: 4,
};
const noseOf = (b: Body) => new THREE.Vector3(0, 0, 1).applyQuaternion(b.a);
/** main.ts's SHIP_GUN_CONE: no bolt leaves further off the nose. */
const SHIP_GUN_CONE = 12 * DEG;
const velOf = (b: Body) => noseOf(b).multiplyScalar(b.cruise);

/**
 * The chase view as camera.ts places it (its CHASE_LAG 0.28 s, its chaseTilt 0.1 rad nose-down, 0.32 of the distance up):
 * the frame slerped toward the hull's, 21.7 m back for an X-wing at the default zoom. What the pilot sees on its screen.
 */
const FLIP = new THREE.Quaternion().setFromAxisAngle(AY, Math.PI);
class ChaseView {
  private readonly frame = new THREE.Quaternion();
  private started = false;
  readonly pos = new THREE.Vector3();
  private readonly inv = new THREE.Quaternion();
  readonly lag: number;
  readonly tilt: number;
  readonly back: number;
  constructor(lag = 0.28, tilt = 0.1, back = 21.7) {
    this.lag = lag;
    this.tilt = tilt;
    this.back = back;
  }
  follow(P: Body, dt: number): void {
    if (!this.started) {
      this.frame.copy(P.a);
      this.started = true;
    }
    this.frame.slerp(P.a, 1 - Math.exp(-dt / Math.max(1e-6, this.lag))).normalize();
    this.pos.set(0, this.back * 0.32, -this.back).applyQuaternion(this.frame).add(P.pos);
    this.inv.copy(this.frame).multiply(FLIP).multiply(new THREE.Quaternion().setFromAxisAngle(AX, -this.tilt)).invert();
  }
  /** Where a world point shows on this view's screen, as a cursor (half-heights from the middle); null behind it. */
  show(p: THREE.Vector3, out: Cursor): Cursor | null {
    const l = p.clone().sub(this.pos).applyQuaternion(this.inv);
    return cursorOf(l, TAN_HALF, out);
  }
}

/** The player's hand on the mouse, and its guns; on the cockpit's screen, or on a chase view's. */
class Hand {
  readonly cursor: Cursor = { x: 0, y: 0 };
  readonly stick: FlightStick = { x: 0, y: 0, turn: 0 };
  private readonly seen: Cursor[] = [];
  private readonly motion: Cursor[] = [];
  cool = 0;
  /** Steps with the target's lead inside the aim circle. */
  inCircle = 0;
  /** The furthest off the nose a bolt has left (radians). */
  worstOff = 0;
  readonly view: ChaseView | null;
  constructor(view: ChaseView | null = null) {
    this.view = view;
  }
  /** Where the lead shows (0.2 s late, carried on), the cursor moved toward it, the stick it asks for. */
  steer(P: Body, lead: THREE.Vector3): void {
    // The view drawn this step: placed after the hull's last move, as the game's camera is.
    this.view?.follow(P, SIM.dt);
    const loc = lead.clone().sub(P.pos).applyQuaternion(P.a.clone().invert());
    // The hull's frame to the cockpit camera's: x and z turned over (the camera looks down its -Z along the nose, +Z).
    const cam = { x: -loc.x, y: loc.y, z: -loc.z };
    const rr = ringRadius(TAN_HALF);
    const at: Cursor = { x: 0, y: 0 };
    if (!cursorOf(cam, TAN_HALF, at) || Math.hypot(at.x, at.y) > rr) {
      const l = Math.hypot(cam.x, cam.y);
      at.x = l < 1e-6 ? 0 : (cam.x / l) * rr;
      at.y = l < 1e-6 ? -rr : (-cam.y / l) * rr;
    } else if (this.view) {
      // On a chase view the hand sees the lead reticle and the cursor where the HUD draws them (the cursor's direction
      // about the nose at the lead's range, through the lagging, tilted camera) and moves the cursor by the gap between.
      const range = Math.max(1, lead.distanceTo(P.pos));
      const cursorAt = hullRay(this.cursor, TAN_HALF, new THREE.Vector3()).applyQuaternion(P.a).multiplyScalar(range).add(P.pos);
      const sl = this.view.show(lead, { x: 0, y: 0 });
      const sc = this.view.show(cursorAt, { x: 0, y: 0 });
      if (sl && sc) {
        at.x = this.cursor.x + (sl.x - sc.x);
        at.y = this.cursor.y + (sl.y - sc.y);
      }
    }
    if (insideCircle(at, TAN_HALF)) this.inCircle++;
    this.seen.push(at);
    const late = this.seen.length > Math.round(SIM.handDelay / SIM.dt) ? this.seen.shift()! : this.seen[0];
    const before = this.motion.length ? this.motion[0] : late;
    this.motion.push(late);
    if (this.motion.length > Math.round(SIM.handMotion / SIM.dt)) this.motion.shift();
    const k = SIM.handDelay / SIM.handMotion;
    const want = clampTo({ x: late.x + (late.x - before.x) * k, y: late.y + (late.y - before.y) * k }, rr);
    const mx = want.x - this.cursor.x;
    const my = want.y - this.cursor.y;
    const md = Math.hypot(mx, my);
    const step = SIM.handSpeed * SIM.dt;
    if (md > step) {
      this.cursor.x += (mx / md) * step;
      this.cursor.y += (my / md) * step;
    } else {
      this.cursor.x = want.x;
      this.cursor.y = want.y;
    }
    clampTo(this.cursor, rr);
    stickFromCursor(this.cursor, TAN_HALF, this.stick);
  }
  /**
   * The trigger, held while the guns take the lead within range: a bolt through the cursor (kept to the circle, about the
   * nose from the pilot's eye, as aimShip does whatever the view), onto the lead within the snap, kept to the guns' cone.
   */
  fire(P: Body, lead: THREE.Vector3 | null, bolts: Bolt[]): void {
    this.cool = Math.max(0, this.cool - SIM.dt);
    if (!lead || this.cool > 0 || lead.distanceTo(P.pos) > SIM.range) return;
    const ac = aimCursor(this.cursor, TAN_HALF, { x: 0, y: 0 });
    const ray = hullRay(ac, TAN_HALF, new THREE.Vector3()).applyQuaternion(P.a);
    const dir = { x: 0, y: 0, z: 0 };
    if (!gunAim(P.pos, P.pos, ray, lead.distanceTo(P.pos), lead, MOUSE_FLIGHT.snapDeg * DEG, dir)) return;
    const nose = noseOf(P);
    coneClamp(dir, nose, SHIP_GUN_CONE);
    this.worstOff = Math.max(this.worstOff, Math.acos(THREE.MathUtils.clamp(dir.x * nose.x + dir.y * nose.y + dir.z * nose.z, -1, 1)));
    bolts.push({ p: P.pos.clone(), v: new THREE.Vector3(dir.x, dir.y, dir.z).multiplyScalar(SIM.bolt).add(velOf(P)), life: SIM.range / SIM.bolt });
    this.cool += SIM.player.interval;
  }
}
interface Bolt {
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
}
/** Bolts a step on, each against the target's sphere; the hits. */
function stepBolts(bolts: Bolt[], target: Body, radius: number): number {
  let hits = 0;
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    const from = b.p.clone();
    b.p.addScaledVector(b.v, SIM.dt);
    b.life -= SIM.dt;
    const seg = b.p.clone().sub(from);
    const sl = seg.lengthSq();
    const k = sl > 0 ? THREE.MathUtils.clamp(target.pos.clone().sub(from).dot(seg) / sl, 0, 1) : 0;
    if (from.clone().addScaledVector(seg, k).distanceTo(target.pos) <= radius) {
      hits++;
      bolts.splice(i, 1);
    } else if (b.life <= 0) bolts.splice(i, 1);
  }
  return hits;
}
function leadOf(from: Body, to: Body, share = 1): THREE.Vector3 | null {
  const out = { x: 0, y: 0, z: 0 };
  return aimPoint(from.pos, velOf(from), to.pos, velOf(to), SIM.bolt, share, out) ? new THREE.Vector3(out.x, out.y, out.z) : null;
}

/**
 * The turn fight: the TIE starts 300 m ahead (within 60 degrees of the nose) at 150 m/s, pointed anywhere in the half
 * ahead, and turns as hard as its hand allows, in a plane of its own, for as long as the fight lasts; the player flies
 * the brain's own tail speed (the target's speed, closing on 250 m behind it). Seconds to the kill, or null within 60.
 */
function turnFight(seed: number, tieStick: Stick, view: ChaseView | null = null): { t: number | null; hits: number; worstOff: number } {
  const rng = seeded(seed);
  const P: Body = { pos: new THREE.Vector3(), a: new THREE.Quaternion(), spin: new THREE.Vector3(), cruise: 150 };
  const toN = new THREE.Vector3(rng() - 0.5, (rng() - 0.5) * 0.6, 1.2).normalize();
  const N: Body = { pos: toN.clone().multiplyScalar(300), a: new THREE.Quaternion(), spin: new THREE.Vector3(), cruise: 150 };
  N.a.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(rng() - 0.5, rng() - 0.5, 1.5).normalize());
  // Which way it turns: the stick's direction spun about the nose at random.
  const about = rng() * Math.PI * 2;
  const st: Stick = { x: tieStick.x * Math.cos(about) - tieStick.y * Math.sin(about), y: tieStick.x * Math.sin(about) + tieStick.y * Math.cos(about), roll: 0 };
  const hand = new Hand(view);
  const bolts: Bolt[] = [];
  let hits = 0;
  for (let t = 0; t < 60; t += SIM.dt) {
    const lead = leadOf(P, N);
    hand.steer(P, lead ?? N.pos);
    hand.fire(P, lead, bolts);
    P.cruise = THREE.MathUtils.clamp(N.cruise + (N.pos.distanceTo(P.pos) - 250) * 0.5, 0.4 * 280, 280);
    flyStep(P, { x: hand.stick.x, y: hand.stick.y, roll: 0 }, SIM.player.rate, SIM.player.inertia, SIM.dt);
    flyStep(N, st, SIM.tie.rate, SIM.tie.inertia, SIM.dt);
    hits += stepBolts(bolts, N, SIM.tie.radius);
    if (hits >= SIM.tie.kill) return { t, hits, worstOff: hand.worstOff };
  }
  return { t: null, hits, worstOff: hand.worstOff };
}

/**
 * The turnaround: the two have just passed head on, up to 30 m apart each way, both at 150 m/s, and turn back for each
 * other at once (the player's hand as above; the TIE by steerToward onto its lead, with its tier's hand, or as it flew
 * before). Seconds until the TIE's aim first sits within its gun cone (Infinity: not in 20 s).
 */
function turnaround(seed: number, skill: PilotSkill, oldHand: boolean): number {
  const rng = seeded(seed);
  const P: Body = { pos: new THREE.Vector3(), a: new THREE.Quaternion(), spin: new THREE.Vector3(), cruise: 150 };
  const N: Body = { pos: new THREE.Vector3((rng() - 0.5) * 60, (rng() - 0.5) * 60, -10), a: new THREE.Quaternion().setFromAxisAngle(AY, Math.PI + (rng() - 0.5) * 0.3), spin: new THREE.Vector3(), cruise: 150 };
  const hand = new Hand();
  const want: Stick = { x: 0, y: 0, roll: 0 };
  const held: Stick = { x: 0, y: 0, roll: 0 };
  for (let t = 0; t < 20; t += SIM.dt) {
    hand.steer(P, leadOf(P, N) ?? N.pos);
    const aim = leadOf(N, P, skill.lead) ?? P.pos.clone();
    const toAim = aim.clone().sub(N.pos);
    if (toAim.angleTo(noseOf(N)) < skill.gunConeDeg * DEG) return t;
    const loc = toAim.normalize().applyQuaternion(N.a.clone().invert());
    steerToward({ x: loc.x, y: loc.y, z: loc.z }, 35 * DEG, null, want);
    if (oldHand) {
      // As the brain flew before: steerToward's stick straight onto flyShip, each axis clamped on its own.
      held.x = want.x;
      held.y = want.y;
      held.roll = want.roll;
    } else skillStick(want, skill, SIM.dt, held);
    flyStep(P, { x: hand.stick.x, y: hand.stick.y, roll: 0 }, SIM.player.rate, SIM.player.inertia, SIM.dt);
    flyStep(N, held, SIM.tie.rate, SIM.tie.inertia, SIM.dt);
  }
  return Infinity;
}
{
  const N = 24;
  const tier1 = PILOT_SKILL[1];
  /** The tier-1 pilot as it was before this change: tighter shots, and its stick straight from steerToward. */
  const tier1Before: PilotSkill = { ...tier1, scatterDeg: 1.6, lead: 0.7, stickMax: 1, response: 0 };
  // The hardest turn a tier-1 TIE can hold now (its cap, in any direction), and before (steerToward filled both axes: 1.41).
  const hardNow: Stick = { x: tier1.stickMax, y: 0, roll: 0 };
  const hardBefore: Stick = { x: 1, y: 1, roll: 0 };
  let killsNow = 0;
  let killsChase = 0;
  let killsBefore = 0;
  let secondsNow = 0;
  let secondsChase = 0;
  let hitsBefore = 0;
  let worstCockpit = 0;
  let worstChase = 0;
  for (let i = 0; i < N; i++) {
    const a = turnFight(2000 + i * 7919, hardNow);
    if (a.t !== null) {
      killsNow++;
      secondsNow += a.t;
    }
    worstCockpit = Math.max(worstCockpit, a.worstOff);
    // The same fight on the chase view, the view a flown ship starts in: the hand reads the reticle and the cursor where
    // the HUD draws them through the lagging, tilted camera; the aim and the stick are the hull's either way.
    const c = turnFight(2000 + i * 7919, hardNow, new ChaseView());
    if (c.t !== null) {
      killsChase++;
      secondsChase += c.t;
    }
    worstChase = Math.max(worstChase, c.worstOff);
    const b = turnFight(2000 + i * 7919, hardBefore);
    if (b.t !== null) killsBefore++;
    hitsBefore += b.hits;
  }
  const rateNow = SIM.tie.rate * 1.5 * tier1.stickMax;
  const rateBefore = SIM.tie.rate * 1.5 * Math.SQRT2;
  const ratePlayer = SIM.player.rate * 1.5;
  console.log(`     turn rates: the player's X-wing ${ratePlayer.toFixed(2)} rad/s any way for as long as the cursor is held out (its old stick, clamped per axis like the NPCs', reached ${(ratePlayer * Math.SQRT2).toFixed(2)} on a diagonal while the mouse kept moving); a tier-1 TIE ${rateNow.toFixed(2)} now, up to ${rateBefore.toFixed(2)} before`);
  console.log(`     the turn fight: ${killsNow} of ${N} tier-1 TIEs turning their hardest killed now in the cockpit view (${(secondsNow / Math.max(1, killsNow)).toFixed(0)} s on average), ${killsChase} of ${N} in the chase view (${(secondsChase / Math.max(1, killsChase)).toFixed(0)} s); ${killsBefore} of ${N} against a TIE flying as it did before (${(hitsBefore / N).toFixed(1)} hits a fight)`);
  console.log(`     the furthest a bolt left off the nose: ${(worstCockpit / DEG).toFixed(1)} degrees in the cockpit view, ${(worstChase / DEG).toFixed(1)} in the chase view`);
  ok(ratePlayer > rateNow * 1.2, 'the player now out-turns a tier-1 TIE by a fifth or more (before, its diagonal out-turned anything the player could hold)');
  ok(killsNow === N, 'a player who keeps the cursor on the lead kills a tier-1 TIE turning as hard as it can, every time, within a minute (cockpit view)');
  ok(killsChase === N, 'and in the chase view, every time: the cursor is measured about the nose, so the camera\'s lag and tilt never keep the guns off what the ship chases');
  ok(worstCockpit <= SHIP_GUN_CONE + 1e-9 && worstChase <= SHIP_GUN_CONE + 1e-9, 'no bolt leaves further off the nose than the guns\' cone, in either view');
  ok(killsBefore <= N / 4, 'where a TIE turning as it could before got away three times in four or more');
  for (const tier of [2, 3, 5]) {
    let kills = 0;
    for (let i = 0; i < N; i++) if (turnFight(2000 + i * 7919, { x: PILOT_SKILL[tier].stickMax, y: 0, roll: 0 }).t !== null) kills++;
    console.log(`     (for the record: ${kills} of ${N} tier-${tier} TIEs turning their hardest, ${(SIM.tie.rate * 1.5 * PILOT_SKILL[tier].stickMax).toFixed(2)} rad/s, killed the same way)`);
  }

  let tieFirstNow = 0;
  let tieFirstBefore = 0;
  let beforeSum = 0;
  for (let i = 0; i < N; i++) {
    if (turnaround(3000 + i * 104729, tier1, false) < Infinity) tieFirstNow++;
    const b = turnaround(3000 + i * 104729, tier1Before, true);
    if (b < Infinity) {
      tieFirstBefore++;
      beforeSum += b;
    }
  }
  console.log(`     the turnaround: a tier-1 TIE brought its guns onto a player turning with it in ${tieFirstBefore} of ${N} before (in ${(beforeSum / Math.max(1, tieFirstBefore)).toFixed(1)} s), ${tieFirstNow} of ${N} now within 20 s`);
  ok(tieFirstBefore >= N * 0.75, 'before, after a head-on pass the TIE came round onto a player turning with it almost every time');
  ok(tieFirstNow <= N / 4, 'now it seldom does');

  // The exchange once on target: the player needs 14 bolts at 0.25 s, 3.5 s of fire; the TIE 22 at 0.55 s, 12.1 s,
  // and its scatter and its share of the lead miss many of those.
  const playerOnTarget = SIM.tie.kill * SIM.player.interval;
  const tieOnTarget = SIM.player.kill * SIM.tie.interval;
  const scatterAt300 = Math.tan(tier1.scatterDeg * DEG) * 300;
  console.log(`     on target: the player needs ${playerOnTarget.toFixed(1)} s of fire, a tier-1 TIE ${tieOnTarget.toFixed(1)} s with every bolt landing (its scatter ${scatterAt300.toFixed(1)} m at 300 m against a 5 m hull, its lead ${tier1.lead} of the full)`);
  ok(tieOnTarget > playerOnTarget * 3, "a tier-1 TIE needs more than three times the player's time on target");
}

console.log(`\n${checks} checks passed`);

