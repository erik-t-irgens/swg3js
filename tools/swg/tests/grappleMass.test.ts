// The mass rule and the loose props on the grapple's rope (Grapple wave 3a, the design's §3.14 and §3.16), against real
// Rapier: the player's own capsule, controller and movement stepped in the player's own order by `grappleBody.ts`, and
// the loose props stood the pool's own way (`loadLooseProps`) and stepped by the pool's own `stepLooseProps` where the
// game's world steps it, between the player's update and the physics' step, so the mesh the hook reads is a physics
// step behind its body as it is in the game. A dart fired at a crate hooks it; F yanks it in and it drops where it came
// to, never thrown back out; with no F the rope is a tether that drags it once walked out past its length; the rope's
// end rides the crate's own frame as it turns; a crate the pool recalls, one dragged toward where the pool would
// recall it, one too heavy by the knob, one whose straight span stays blocked, the fire key, the pool gone and a place
// written without a reset each let go, or are refused, as the design says, and a hard landing does not; and nothing of
// a hooked prop touches the body, whose walk, crouch and landing roll stay the player's. The hook's numbers read through
// the player's stats: an empty record steps exactly as wave 2's code did, to the bit, a table that moves them is obeyed
// (a range past 100 m reached, the haul's lip-over moved), and Acrobatics builds a swing faster. Every check that moves
// a body runs at 144, 60 and 30 frames a second unless it says otherwise. The hook's own arithmetic on a prop is held to
// nothing in a node process of its own (`grappleAllocOwn.ts prop`), as wave 1's is.
//
// Nothing is read from the game's files.
//
// Run: node --expose-gc tools/swg/tests/grappleMass.test.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GRAPPLE_DEFAULTS, GRAPPLE_PLAYER_MASS, GRAPPLE_TUNE, tuneGrapple, type GrappleStats } from '../../../src/player/grapple.ts';
import { teleported, whoMoves } from '../../../src/player/grappleMath.ts';
import { JKA, UNIT } from '../../../src/player/jkaMove.ts';
import { PlayerStats } from '../../../src/player/playerStats.ts';
import { PROPS, dropLooseProps, hookablePropAhead, hookablePropAt, loadLooseProps, propsDebug, stepLooseProps, type HookableProp } from '../../../src/world/looseProps.ts';
import { emptyRecord, fnv32 } from '../../../src/progress/record.ts';
import { xpCap } from '../../../src/progress/core.ts';
import { PROGRESS_RULES } from '../../../src/progress/tune.ts';
import type { StatId } from '../../../src/progress/stats.ts';
import { RAPIER, TestBody, THREE, box, ground, makePhysics } from './grappleBody.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);
const FPS = [144, 60, 30];
const r2 = (v: number) => Number(v.toFixed(2));
const LOST = PROPS.lost;

/** Every number back as it ships, between scenarios. */
const fresh = () => {
  Object.assign(GRAPPLE_TUNE, GRAPPLE_DEFAULTS);
  PROPS.lost = LOST;
};

/** The pool's own body behind a prop, for what the hook never asks of it (its weight, its speed). */
const bodyOf = (p: HookableProp) => (p as unknown as { body: RAPIER.RigidBody }).body;

/**
 * A world the game's way with the pool stood round the arrival at the origin on flat ground, a body to stand in it, the
 * pool's own lookup hung on the hook, the pool stepped where the game's world steps it (after the player's update,
 * before the physics' step), and the hook's words kept.
 */
async function propScene() {
  fresh();
  const physics = await makePhysics();
  ground(physics, 0, 700);
  const host = { scene: new THREE.Scene(), physics, forgetMaterials: () => {} };
  loadLooseProps(host, new THREE.Vector3(0, 0, 0), () => 0, false);
  physics.stepOnce();
  const b = new TestBody(physics);
  b.grapple.propAt = hookablePropAt;
  b.beforeStep = (dt) => stepLooseProps(dt, b.pos);
  const said: string[] = [];
  b.grapple.say = (s) => said.push(s);
  return { physics, b, host, said };
}

/** One frame of the game's loop for the body, the pool stepped inside it where the game steps it (`beforeStep`). */
function frame(b: TestBody, dt: number): void {
  b.frame(dt);
}

function run(b: TestBody, fps: number, seconds: number, each?: (t: number) => boolean | void): void {
  const dt = 1 / fps;
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) {
    frame(b, dt);
    if (each?.((i + 1) * dt)) return;
  }
}

function tap(b: TestBody, code: string, dt: number): void {
  b.key(code, true);
  frame(b, dt);
  b.key(code, false);
}

/**
 * Stood at (x, 0, z), 15 m by default, from the first crate of the pool's first ring (which stands at (0, 0, 7) from the
 * arrival), the props let settle, and that crate found by the pool's own look ahead. Every ring stands a prop on each
 * of the four ways out from the middle, 14 m out on the third, so a line to the first crate from much past 21 m along
 * the middle meets a ball first: from further off the body stands to one side.
 */
function standByCrate(b: TestBody, fps: number, z = 22, x = 0): { prop: HookableProp; handle: number } {
  b.place(x, 0, z);
  b.forward.set(0, 0, 1);
  b.right.set(-1, 0, 0);
  run(b, fps, 1);
  const hand = b.hand();
  const dir = new THREE.Vector3(0, 0.3, 7).sub(hand).normalize();
  const found = hookablePropAhead(hand, dir, 30, 0.999);
  assert.ok(found && found.prop.label === 'crate', 'the first crate of the first ring stands where the pool puts it');
  return found;
}

/** Fire at the prop's middle through the game's own fire (the mark from the hand), and step until it holds or 1 s. */
function hookIt(b: TestBody, prop: HookableProp, fps: number): number {
  const c = prop.mesh.position;
  b.fireAt = { x: c.x, y: c.y, z: c.z };
  tap(b, 'Mouse3', 1 / fps);
  let t = 1 / fps;
  run(b, fps, 1, (s) => {
    t = s;
    return b.grapple.holding;
  });
  return t;
}

const handDist = (b: TestBody, p: HookableProp) => {
  const c = p.mesh.position;
  return Math.hypot(c.x - b.pos.x, c.y - (b.pos.y + GRAPPLE_TUNE.ropeY), c.z - b.pos.z);
};

// =============================================================================================================
// 1. Who moves: the mass rule's table, and what the hook makes of the pool's own crate.
{
  const t = GRAPPLE_DEFAULTS;
  ok(whoMoves(true, 20, t.strength, GRAPPLE_PLAYER_MASS, t) === 'player', 'whoMoves: anything still moves the player');
  ok(whoMoves(false, 20, t.strength, GRAPPLE_PLAYER_MASS, t) === 'thing', 'a 20 kg prop at the 40 kg strength comes to you');
  ok(whoMoves(false, 120, t.strength, GRAPPLE_PLAYER_MASS, t) === 'both', '120 kg is a tug-of-war (up to twice the player\'s 80)');
  ok(whoMoves(false, 400, t.strength, GRAPPLE_PLAYER_MASS, t) === 'player', '400 kg moves the player');
  ok(GRAPPLE_PLAYER_MASS === 80 && GRAPPLE_DEFAULTS.strength === 40 && GRAPPLE_DEFAULTS.heavyRatio === 2 && PROPS.mass === 20, "the player's 80 kg (the controller's own), the strength's 40, the ratio's 2 and a prop's 20, as the design has them");
}

// =============================================================================================================
// 2. The yank, in the game's frame order: F held as the dart bites, the crate comes in and drops where it came to,
// never thrown back out. Hooked at 15 m and looked at, it drops at the feet; looked away from, it is pulled to a point
// beside the hand and drops there; hooked at 23 m, past what the grip's 14 m/s covers in `yankMost`, the clock ends the
// yank with the crate still coming, and it drops where the clock left it. The end once held the crate at its mesh's
// place, which in this order is a physics step behind its body, and that hold threw it back out along its last step at
// the grip's own speed (27 m out at 60 and 30 fps; the order the test first ran in, the pool after the step, hid it).
type YankCase = 'at' | 'aside' | 'far';
async function yankRun(fps: number, kind: YankCase) {
  const { b, said } = await propScene();
  const { prop, handle } = kind === 'far' ? standByCrate(b, fps, 29, -8) : standByCrate(b, fps);
  const dt = 1 / fps;
  const start = b.pos.clone();
  const from = handDist(b, prop);
  const body = bodyOf(prop);
  b.key('KeyF', true);
  const c = prop.mesh.position;
  b.fireAt = { x: c.x, y: c.y, z: c.z };
  tap(b, 'Mouse3', dt);
  // Looked away: the view the yank pulls along turned square off the crate's line (the fire wrote it toward the crate).
  if (kind === 'aside') {
    const v = b.grapple.view;
    v.dirX = 1;
    v.dirY = 0;
    v.dirZ = 0;
  }
  const flatOf = () => {
    const t = body.translation();
    return Math.hypot(t.x - b.pos.x, t.z - b.pos.z);
  };
  const r = { bitAt: -1, inAt: -1, lengthAtBite: 0, bent: 0, weightless: false, inDist: Infinity, maxBodyMove: 0, speedAfter: -1, flatAt: 0, farthestAfter: 0 };
  run(b, fps, 5, (s) => {
    const g = b.grapple;
    if (g.holding && r.bitAt < 0) {
      r.bitAt = s;
      r.lengthAtBite = g.rope.length;
    }
    if (g.holding && g.rope.n !== 0) r.bent++;
    if (g.holding && g.yanking && body.gravityScale() === 0) r.weightless = true;
    if (r.bitAt >= 0 && r.inAt < 0 && g.lastLetGo === 'yanked') {
      r.inAt = s;
      r.inDist = g.thingDist;
      const v = body.linvel();
      r.speedAfter = Math.hypot(v.x, v.y, v.z);
      r.flatAt = flatOf();
    }
    if (r.inAt >= 0) r.farthestAfter = Math.max(r.farthestAfter, flatOf());
    r.maxBodyMove = Math.max(r.maxBodyMove, b.pos.distanceTo(start));
    return r.inAt >= 0 && s > r.inAt + 1.5;
  });
  b.key('KeyF', false);
  const v = body.linvel();
  return { ...r, from, b, prop, handle, said, rest: Math.hypot(v.x, v.y, v.z), flat: flatOf(), y: body.translation().y, weight: body.gravityScale() };
}
for (const fps of FPS) {
  const dt = 1 / fps;
  const a = await yankRun(fps, 'at');
  const g = a.b.grapple;
  ok(a.bitAt > 0 && Math.abs(a.lengthAtBite - a.from) < 0.6 && a.from > 14.5 && a.from < 15.5, `${fps} fps: the dart hooks the crate ${r2(a.from)} m off, the rope landing at its reach (${r2(a.lengthAtBite)} m)`);
  ok(a.inAt > 0 && a.inAt - a.bitAt <= GRAPPLE_TUNE.yankMost + 1e-9 && a.inDist <= GRAPPLE_TUNE.arriveReach, `${fps} fps: F held from the bite brings it within ${GRAPPLE_TUNE.arriveReach} m of the rope point in ${r2(a.inAt - a.bitAt)} s (under ${GRAPPLE_TUNE.yankMost}), and the rope lets go (${r2(a.inDist)} m)`);
  ok(a.weightless && a.bent === 0, `${fps} fps: weightless on the way in, the grip's own hold, and the rope to it never bent`);
  ok(g.state === 'off' && a.weight === 1 && a.flat < 1.6 && a.rest < 0.3 && a.y < 0.5, `${fps} fps: it drops at the feet (${r2(a.flat)} m out, at rest, on the ground) with its weight back`);
  ok(a.speedAfter >= 0 && a.speedAfter < 1 && a.farthestAfter < a.flatAt + 0.6, `${fps} fps: stopped where it came to, never thrown back out (${r2(a.speedAfter)} m/s after the let-go, ${r2(a.flatAt)} m out then and ${r2(a.farthestAfter)} at the farthest after: no further than a crate's width of tumble as it lands)`);
  ok(a.maxBodyMove < 1e-6 && a.said.length === 0, `${fps} fps: and the body never moved for any of it (${a.maxBodyMove.toExponential(1)} m), with nothing said`);
  ok(hookablePropAt(a.handle) === a.prop && a.prop.recalls === 0, `${fps} fps: the crate is still the pool's, never put back on its stand`);
  const s = await yankRun(fps, 'aside');
  ok(s.b.grapple.lastLetGo === 'yanked' && s.speedAfter >= 0 && s.speedAfter < 1 && s.farthestAfter < s.flatAt + 0.6 && s.flat < 2.5 && s.rest < 0.3 && s.weight === 1, `${fps} fps: looked away from, it comes to the point beside the hand and drops there (${r2(s.speedAfter)} m/s after, ${r2(s.flatAt)} m out then, ${r2(s.farthestAfter)} at the farthest after, ${r2(s.flat)} at rest at ${r2(s.rest)} m/s, let go ${s.b.grapple.lastLetGo})`);
  const f = await yankRun(fps, 'far');
  const ran = f.inAt - f.bitAt;
  ok(f.from > 22.5 && f.from < 23.5 && f.b.grapple.lastLetGo === 'yanked' && ran >= GRAPPLE_TUNE.yankMost - 2 * dt - 1e-9 && ran <= GRAPPLE_TUNE.yankMost + 1e-9 && f.inDist > GRAPPLE_TUNE.arriveReach, `${fps} fps: hooked ${r2(f.from)} m off, the yank is ended by its clock at ${r2(ran)} s (${GRAPPLE_TUNE.yankMost}) with the crate still ${r2(f.inDist)} m off`);
  ok(f.speedAfter >= 0 && f.speedAfter < 1 && f.farthestAfter < f.flatAt + 0.6 && f.rest < 0.3 && f.weight === 1, `${fps} fps: and it drops where the clock left it, ${r2(f.flatAt)} m out (${r2(f.speedAfter)} m/s after, ${r2(f.farthestAfter)} m at the farthest), its weight back`);
  note(`${fps} fps: at the crate, bite at ${r2(a.bitAt)} s, in at ${r2(a.inAt)} s`);
}

// =============================================================================================================
// 3. The tether: with no F, walking away past the rope's length drags the crate behind; the body walks as if it carried
// nothing, frame for frame, against the same walk with no shot at all.
for (const fps of FPS) {
  const walk = async (shoot: boolean) => {
    const { b } = await propScene();
    const { prop } = standByCrate(b, fps);
    const dt = 1 / fps;
    // The same frames either way: a press, at the crate or at nothing, and half a second for the dart.
    const c = prop.mesh.position;
    b.fireAt = shoot ? { x: c.x, y: c.y, z: c.z } : null;
    tap(b, 'Mouse3', dt);
    run(b, fps, 0.5);
    const holding = b.grapple.holding;
    const len = b.grapple.rope.length;
    const z0 = b.pos.z;
    const crate0 = prop.mesh.position.clone();
    const trace: number[] = [];
    let highest = 0;
    let bent = 0;
    b.key('KeyW', true);
    run(b, fps, 3, () => {
      trace.push(b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z);
      highest = Math.max(highest, prop.mesh.position.y);
      if (b.grapple.holding && b.grapple.rope.n !== 0) bent++;
      return b.pos.z >= z0 + 5;
    });
    b.key('KeyW', false);
    run(b, fps, 0.5, () => {
      trace.push(b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z);
    });
    const g = b.grapple;
    g.placeThingEnd();
    const p = g.rope.pts;
    const reach = Math.hypot(p[0] - b.pos.x, p[1] - (b.pos.y + GRAPPLE_TUNE.ropeY), p[2] - b.pos.z);
    return { b, prop, holding, len, reach, walked: b.pos.z - z0, dragged: prop.mesh.position.z - crate0.z, highest, bent, trace, kept: g.holding };
  };
  const a = await walk(true);
  const z = await walk(false);
  ok(a.holding && a.kept && a.walked >= 5, `${fps} fps: hooked at ${r2(a.len)} m and walked ${r2(a.walked)} m away with the line in`);
  ok(Math.abs(a.reach - a.len) < 0.5 && a.dragged > 4, `${fps} fps: the crate is dragged ${r2(a.dragged)} m after the body and held within 0.5 m of the rope's length (${r2(a.reach)} of ${r2(a.len)} m)`);
  ok(a.highest < 0.45 && a.bent === 0, `${fps} fps: along the ground, keeping its weight (its middle never more than ${r2(a.highest)} m up), the rope never bent`);
  let same = a.trace.length === z.trace.length;
  for (let i = 0; same && i < a.trace.length; i++) if (!Object.is(a.trace[i], z.trace[i])) same = false;
  ok(same, `${fps} fps: and every place and velocity of the body is the walk with no shot, by Object.is (${a.trace.length / 6} frames)`);
}

// =============================================================================================================
// 4. A crate the pool recalls mid-yank (its own `recall`, which teleports the very body back to its stand, so it still
// answers by its collider): the rope lets go on that frame, in words.
for (const fps of FPS) {
  const { b, said } = await propScene();
  const { prop, handle } = standByCrate(b, fps);
  const dt = 1 / fps;
  b.key('KeyF', true);
  hookIt(b, prop, fps);
  run(b, fps, 0.2);
  const yanking = b.grapple.holding && b.grapple.yanking;
  (prop as unknown as { recall(): void }).recall();
  frame(b, dt);
  b.key('KeyF', false);
  const g = b.grapple;
  ok(yanking && g.state === 'off' && g.lastLetGo === 'recalled' && said.includes('The line came loose.'), `${fps} fps: recalled mid-yank, the rope lets go the very next frame ("${said.join('; ')}")`);
  ok(hookablePropAt(handle) === prop && prop.recalls === 1 && bodyOf(prop).gravityScale() === 1, `${fps} fps: though the same crate still answers by its collider, back on its stand with its weight`);
}

// =============================================================================================================
// 5. Dragged toward where the pool would put it back: the rope lets go `tetherStandMargin` short of `PROPS.lost` from the
// crate's stand, and the pool never recalls it. `PROPS.lost` is moved to 40 m for the run (it is a live knob), so the
// walk is 35 m and not 395.
for (const fps of FPS) {
  const { b, said } = await propScene();
  const { prop } = standByCrate(b, fps);
  PROPS.lost = 40;
  hookIt(b, prop, fps);
  const stand = new THREE.Vector3(prop.stand.x, prop.stand.y, prop.stand.z);
  const margin = PROPS.lost - GRAPPLE_TUNE.tetherStandMargin;
  let atLetGo = -1;
  let farthest = 0;
  let highest = 0;
  b.key('KeyW', true);
  run(b, fps, 14, () => {
    const d = prop.mesh.position.distanceTo(stand);
    farthest = Math.max(farthest, d);
    if (b.grapple.holding) highest = Math.max(highest, prop.mesh.position.y);
    if (!b.grapple.holding && atLetGo < 0) atLetGo = d;
    return atLetGo >= 0;
  });
  b.key('KeyW', false);
  run(b, fps, 2, () => {
    farthest = Math.max(farthest, prop.mesh.position.distanceTo(stand));
  });
  const report = propsDebug() as { recalled: number };
  ok(b.grapple.lastLetGo === 'loose' && said.includes('The line came loose.') && atLetGo >= margin && atLetGo < margin + 0.6, `${fps} fps: dragged off its stand, the rope lets go ${r2(atLetGo)} m from it, ${GRAPPLE_TUNE.tetherStandMargin} m short of the pool's ${PROPS.lost} ("${said.join('; ')}")`);
  ok(prop.recalls === 0 && report.recalled === 0 && farthest < PROPS.lost, `${fps} fps: and the pool never recalls it (farthest ${r2(farthest)} m)`);
  // Dragged 30 m along the line, it rides the ground: carried along the rope's line whole it rode up toward the hand.
  ok(highest < 0.45, `${fps} fps: and over the whole drag it keeps to the ground (its middle never more than ${r2(highest)} m up, a crate's half 0.3)`);
  PROPS.lost = LOST;
}

// =============================================================================================================
// 6. Too heavy: a prop past the tether's strength by the knob is refused by the dart, in words, and nothing is held.
{
  for (const [strength, ratio, word] of [
    [10, 2, 'both'],
    [10, 0.1, 'player'],
  ] as const) {
    const { b, said } = await propScene();
    const { prop } = standByCrate(b, 60);
    tuneGrapple({ strength, heavyRatio: ratio });
    const c = prop.mesh.position;
    b.fireAt = { x: c.x, y: c.y, z: c.z };
    const markOn = (() => {
      tap(b, 'Mouse3', 1 / 60);
      return b.grapple.mark.kind;
    })();
    let held = false;
    run(b, 60, 1.5, () => {
      held ||= b.grapple.holding;
    });
    ok(markOn === 'prop' && b.grapple.whoMovesFor(prop.mass) === word && !held && b.grapple.state === 'off' && said.includes('Too heavy to pull.') && b.grapple.counts.misses === 1, `at a strength of ${strength} kg and a ratio of ${ratio}, the 20 kg crate (${word}) is shown, fired at, refused in words and never held ("${said.join('; ')}")`);
  }
}

// =============================================================================================================
// 7. The straight span blocked: a wall stood across it for less than `tetherBlocked` holds; one left there lets go
// once it has blocked the span that long, in words.
for (const fps of FPS) {
  const { b, physics, said } = await propScene();
  const { prop } = standByCrate(b, fps);
  hookIt(b, prop, fps);
  const dt = 1 / fps;
  const wall = () => box(physics, [-3, 0, 14.5], [3, 4, 15], false);
  const brief = wall();
  run(b, fps, 0.15);
  // Taken away, and the world stepped at once, so no query meets a collider the engine has dropped.
  physics.world.removeCollider(brief, false);
  physics.stepOnce();
  run(b, fps, 0.3);
  const heldThroughBrief = b.grapple.holding && b.grapple.thingBlocked === 0;
  wall();
  let firstBlocked = -1;
  let letGoAt = -1;
  run(b, fps, 2, (t) => {
    if (firstBlocked < 0 && b.grapple.thingBlocked > 0) firstBlocked = t - dt;
    if (!b.grapple.holding) {
      letGoAt = t;
      return true;
    }
  });
  const held = letGoAt - firstBlocked;
  ok(heldThroughBrief, `${fps} fps: a wall across the span for 0.15 s holds, and the blocked clock starts again after it`);
  ok(b.grapple.lastLetGo === 'blocked' && said.includes('The line fouled and let go.') && held > GRAPPLE_TUNE.tetherBlocked - 1e-9 && held <= GRAPPLE_TUNE.tetherBlocked + 2 * dt + 1e-9, `${fps} fps: one left there lets go after ${r2(held)} s blocked (past ${GRAPPLE_TUNE.tetherBlocked})`);
}

// =============================================================================================================
// 8. Every way out gives the prop its weight back: a place written by a reset in mid-yank, and F let go mid-yank, which
// leaves it a tether where it got to.
for (const fps of FPS) {
  const { b } = await propScene();
  const { prop } = standByCrate(b, fps);
  b.key('KeyF', true);
  hookIt(b, prop, fps);
  run(b, fps, 0.3);
  const midway = b.grapple.yanking && bodyOf(prop).gravityScale() === 0;
  b.key('KeyF', false);
  frame(b, 1 / fps);
  const tether = b.grapple.holding && !b.grapple.yanking && bodyOf(prop).gravityScale() === 1 && b.grapple.rope.length < 14;
  b.key('KeyF', true);
  run(b, fps, 0.2);
  const again = b.grapple.yanking && bodyOf(prop).gravityScale() === 0;
  b.place(0, 0, 30);
  b.key('KeyF', false);
  ok(midway && tether && again, `${fps} fps: F let go mid-yank gives the weight back at once and leaves a tether as long as the crate got to (${r2(b.grapple.rope.length)} m)`);
  ok(b.grapple.state === 'off' && b.grapple.lastLetGo === 'reset' && bodyOf(prop).gravityScale() === 1, `${fps} fps: and a reset mid-yank lets go with the weight given back`);
}

// =============================================================================================================
// 9. On the rope to a prop the body is its own: Space jumps (never a boost), and the bar says `light`.
{
  const { b } = await propScene();
  const { prop } = standByCrate(b, 60);
  hookIt(b, prop, 60);
  const word = b.grapple.promptWord();
  const jumps = b.jumped;
  tap(b, 'Space', 1 / 60);
  run(b, 60, 0.2);
  ok(word === 'light' && b.jumped === jumps + 1 && b.grapple.counts.boosts === 0 && b.grapple.holding, `with a crate on the line the bar says "${word}", Space jumps as ever and nothing boosts`);
}

// =============================================================================================================
// 9b. The rest of the body is the player's too: the reels lent the walk's and the crouch's keys on an anchor do nothing
// to a prop, so neither is muted. Shift walks at the walk's speed and reels nothing, X crouches, and a crouch held with
// a move key as the feet touch down off a 5 m ledge is Jedi Academy's landing roll. Muted as on an anchor, Shift ran
// and the crouch, and its roll, were lost for nothing. And that hard landing is no teleport: the guard measures the
// move against the speed before it (a landing takes the fall's speed off before the step after the move), as the
// anchor's does; measured against the speed after it, it let go of the crate on the landing frame.
async function ledge(fps: number, h: number, walk: boolean) {
  const { b, physics } = await propScene();
  box(physics, [-3, 0, 23], [3, h, 29]);
  physics.stepOnce();
  b.place(0, h, 23.6);
  b.forward.set(0, 0, -1);
  b.right.set(1, 0, 0);
  run(b, fps, 0.5);
  const hand = b.hand();
  const found = hookablePropAhead(hand, new THREE.Vector3(0, 0.3, 7).sub(hand).normalize(), 30, 0.999);
  assert.ok(found, 'the first crate is in view from the ledge');
  hookIt(b, found.prop, fps);
  const hooked = b.grapple.holding;
  // Shift with S: back along the ledge at the walk's speed, dragging the crate, the reel never read.
  let top = 0;
  let reeled = false;
  if (walk) {
    b.key('ShiftLeft', true);
    b.key('KeyS', true);
    run(b, fps, 0.5, () => {
      top = Math.max(top, Math.hypot(b.vel.x, b.vel.z));
      reeled ||= b.grapple.keys.reelIn || b.grapple.keys.reelOut;
    });
    b.key('KeyS', false);
    b.key('ShiftLeft', false);
    run(b, fps, 0.2);
  }
  const walked = b.grapple.holding;
  // The guard's margin narrowed for the fall, so a landing frame's drop can pass it: the old reading's verdict is
  // worked out beside the game's on every frame, to show the case is met.
  tuneGrapple({ teleportMargin: 0.1 });
  b.key('KeyX', true);
  run(b, fps, 0.1);
  b.rolled = false;
  b.key('KeyW', true);
  let prev = b.pos.clone();
  let oldWould = false;
  let fell = 0;
  let still = true;
  let landedAt = -1;
  // Until the roll out of the landing is done and a little after: walked on, crouched, the body would meet the pool's
  // ball standing 14 m out on the way to the crate and step up onto it, a move the controller makes on its own and the
  // narrowed margin here, never the game's own metre, would take for a teleport.
  run(b, fps, 2.5, (s) => {
    if (b.grapple.holding) {
      const moved = b.pos.distanceTo(prev);
      oldWould ||= teleported(moved, Math.hypot(b.vel.x, b.vel.y, b.vel.z), 1 / fps, 0, GRAPPLE_TUNE);
    } else still = false;
    fell = Math.max(fell, -b.vel.y);
    prev = b.pos.clone();
    if (landedAt < 0 && fell > 5 && b.grounded) landedAt = s;
    return landedAt >= 0 && s > landedAt + 0.6;
  });
  b.key('KeyW', false);
  b.key('KeyX', false);
  const kept = still && b.grapple.holding && b.grapple.lastLetGo !== 'moved';
  return { h, hooked, walked, top, reeled, rolled: b.rolled, landed: b.pos.y < 0.5, oldWould, fell, kept, why: `${b.grapple.state} ${b.grapple.lastLetGo || '-'} y ${r2(b.pos.y)}` };
}
for (const fps of [60, 30]) {
  const first = await ledge(fps, 5, true);
  const walkSpeed = JKA.speed * JKA.walkScale * UNIT;
  ok(first.hooked && first.walked && Math.abs(first.top - walkSpeed) < 0.1 && !first.reeled, `${fps} fps: with a crate on the line Shift walks (${r2(first.top)} m/s at the most: the walk's ${r2(walkSpeed)}, never the run's ${r2(JKA.speed * UNIT)}) and reads as no reel`);
  ok(first.rolled && first.landed, `${fps} fps: X held, then W, off the 5 m ledge: the crouch is the player's and the landing rolls (${first.rolled})`);
  // Where in its last frame's fall the body meets the ground decides how far that frame drops it, so the same walk off
  // ledges a few centimetres apart meets it at every phase of a frame.
  const runs = [first];
  for (const h of [5.03, 5.06, 5.09, 5.12, 5.15, 5.18, 5.21]) runs.push(await ledge(fps, h, false));
  const held = runs.filter((d) => d.kept && d.landed).length;
  const oldLost = runs.filter((d) => d.oldWould).length;
  ok(held === runs.length && oldLost > 0, `${fps} fps: and a hard landing (${r2(first.fell)} m/s) keeps the crate on the line off every ledge (${held} of ${runs.length}), where the guard read after the move would have let go off ${oldLost} of them${held === runs.length ? '' : `: ${runs.map((d) => `${d.h} m ${d.why}`).join('; ')}`}`);
}

// =============================================================================================================
// 9c. The rope's end is kept in the prop's own frame (§3.14): a crate turned before the bite, struck off its middle, then
// yawed, tilted and set spinning on the line still has the rope ending on the very point the dart struck, carried with
// it, and the face's normal turned with it. What the hook was handed at the bite is caught as it is handed (its mesh's
// pose and the point), and the end is worked out from the crate's mesh as the pool last wrote it, which is what the hook
// reads. The two wrong readings (no frame at all, and the turn the wrong way round) are worked out beside it, to show the
// turn is large enough to tell them apart.
for (const fps of FPS) {
  const { b } = await propScene();
  const { prop } = standByCrate(b, fps);
  const body = bodyOf(prop);
  const q0 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7);
  body.setRotation({ x: q0.x, y: q0.y, z: q0.z, w: q0.w }, true);
  run(b, fps, 0.5);
  const g = b.grapple;
  let bite: { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3; n: THREE.Vector3 } | null = null;
  const attach = g.attachThing.bind(g);
  g.attachThing = (bb, p, h, x, y, z, nx, ny, nz, col, ph) => {
    const m = p.mesh;
    bite = { p: new THREE.Vector3(m.position.x, m.position.y, m.position.z), q: new THREE.Quaternion(m.quaternion.x, m.quaternion.y, m.quaternion.z, m.quaternion.w), s: new THREE.Vector3(x, y, z), n: new THREE.Vector3(nx, ny, nz) };
    attach(bb, p, h, x, y, z, nx, ny, nz, col, ph);
  };
  const c = prop.mesh.position;
  b.fireAt = { x: c.x + 0.17, y: c.y + 0.12, z: c.z };
  tap(b, 'Mouse3', 1 / fps);
  run(b, fps, 1, () => g.holding);
  const caught = bite as { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3; n: THREE.Vector3 } | null;
  assert.ok(g.holding && caught, 'the crate is hooked');
  const turnedAtBite = Math.abs(caught.q.y) > 0.3;
  // Yawed and tilted, and set spinning.
  const q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, 1.9, -0.3));
  body.setRotation({ x: q1.x, y: q1.y, z: q1.z, w: q1.w }, true);
  body.setAngvel({ x: 2, y: 1, z: 0.5 }, true);
  run(b, fps, 3 / 60);
  g.placeThingEnd();
  const m = prop.mesh;
  const qNow = new THREE.Quaternion(m.quaternion.x, m.quaternion.y, m.quaternion.z, m.quaternion.w);
  const pNow = new THREE.Vector3(m.position.x, m.position.y, m.position.z);
  const local = caught.s.clone().sub(caught.p).applyQuaternion(caught.q.clone().invert());
  const want = local.clone().applyQuaternion(qNow).add(pNow);
  const pts = g.rope.pts;
  const off = Math.hypot(pts[0] - want.x, pts[1] - want.y, pts[2] - want.z);
  const noFrame = pNow.clone().add(caught.s.clone().sub(caught.p)).distanceTo(want);
  const backwards = caught.s.clone().sub(caught.p).applyQuaternion(caught.q).applyQuaternion(qNow.clone().invert()).add(pNow).distanceTo(want);
  const nWant = caught.n.clone().applyQuaternion(caught.q.clone().invert()).applyQuaternion(qNow);
  const an = g.rope.anchorNormal;
  const nOff = Math.hypot(an[0] - nWant.x, an[1] - nWant.y, an[2] - nWant.z);
  ok(g.holding && turnedAtBite && local.length() > 0.2 && off < 0.002 && nOff < 1e-6, `${fps} fps: turned before the bite and turned again on the line, the rope ends ${r2(off * 1000)} mm from the struck point carried with the crate, its normal turned with it`);
  ok(noFrame > 0.1 && backwards > 0.1, `${fps} fps: where kept with no frame it would end ${r2(noFrame)} m off, and turned the wrong way round ${r2(backwards)} m off`);
}

// =============================================================================================================
// 9d. The other ways a hooked prop lets go (§3.10), each on its own: the fire key pressed again (owing the torch alone a
// mute, its key the yank's: a Shift held through it walks on); the pool gone with its world (nothing asked of the
// prop after it); and a place written without a reset (the guard's `moved`).
for (const fps of FPS) {
  const dt = 1 / fps;
  {
    const { b } = await propScene();
    const { prop } = standByCrate(b, fps);
    b.key('KeyF', true);
    hookIt(b, prop, fps);
    b.key('ShiftLeft', true);
    run(b, fps, 0.2);
    const yanking = b.grapple.yanking && bodyOf(prop).gravityScale() === 0;
    tap(b, 'Mouse3', dt);
    const g = b.grapple;
    ok(yanking && g.state === 'off' && g.lastLetGo === 'fire' && bodyOf(prop).gravityScale() === 1, `${fps} fps: the fire key pressed in mid-yank lets go, the crate's weight given back`);
    ok(b.input.muted('flashlight') && !b.input.muted('walk') && !b.input.muted('jump'), `${fps} fps: and with F and Shift still held, the torch alone waits for its key to come up; the walk is the player's as it was`);
    b.key('ShiftLeft', false);
    b.key('KeyF', false);
    frame(b, dt);
  }
  {
    const { b, host, said } = await propScene();
    const { prop } = standByCrate(b, fps);
    b.key('KeyF', true);
    hookIt(b, prop, fps);
    run(b, fps, 0.2);
    const yanking = b.grapple.yanking;
    // Every call the hook could make on the prop, counted from the moment its pool is gone.
    let asked = 0;
    const p = prop as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const name of ['holdAt', 'stop', 'release', 'giveWeightBack']) {
      const f = p[name].bind(prop);
      p[name] = (...a: unknown[]) => {
        asked++;
        return f(...a);
      };
    }
    dropLooseProps(host);
    run(b, fps, 0.2);
    b.key('KeyF', false);
    const g = b.grapple;
    ok(yanking && g.state === 'off' && g.lastLetGo === 'loose' && said.includes('The line came loose.') && asked === 0, `${fps} fps: the pool gone with its world in mid-yank, the rope lets go in words and nothing more is asked of the prop (${asked} calls)`);
  }
  {
    const { b, said } = await propScene();
    const { prop } = standByCrate(b, fps);
    hookIt(b, prop, fps);
    run(b, fps, 0.2);
    const held = b.grapple.holding;
    b.pos.x += 3;
    frame(b, dt);
    const g = b.grapple;
    ok(held && g.state === 'off' && g.lastLetGo === 'moved' && said.length === 0 && bodyOf(prop).gravityScale() === 1, `${fps} fps: a place written 3 m off without a reset lets go (moved), saying nothing`);
  }
}

// =============================================================================================================
// 10. The hook's numbers through the player's stats (§3.16): an empty record steps a swing, a reel, a haul and a mark
// exactly as wave 2's code did, to the bit; a table that moves them is obeyed; and Acrobatics builds a swing faster.
{
  // Wave 2's swing, measured through the hook as it stood before this wave (commit e9b2a43, the same scene, the same
  // frames) and written out here: every place, velocity and rope length of the trace below as one FNV-1a over its text.
  // Comparing the new code with itself (no stats against the empty record) shows only that an empty record is no
  // stats; this shows that both are what the game did before the table was read at all. A deliberate change to the
  // swing moves it, and the line below prints the new one.
  const WAVE2_SWING: Record<number, string> = { 144: '11572033', 60: '3b53723e', 30: '3f4a88f5' };
  const traceText = (t: number[]) => t.map((v) => (Object.is(v, -0) ? '-0' : String(v))).join(',');
  const swingTrace = async (fps: number, stats: GrappleStats | null) => {
    fresh();
    const physics = await makePhysics();
    let top: RAPIER.Collider | null = null;
    top = box(physics, [-0.5, 40, -0.5], [0.5, 41, 0.5], false);
    physics.stepOnce();
    const b = new TestBody(physics);
    if (stats) b.grapple.stats = stats;
    b.place(0, 40 - 0.05 - 15 - GRAPPLE_TUNE.ropeY, 0);
    physics.stepOnce();
    b.hook(0, 40, 0, 0, -1, 0, top, 15);
    b.forward.set(1, 0, 0);
    b.right.set(0, 0, 1);
    const trace: number[] = [];
    let top2 = 0;
    const phase = (keys: string[], seconds: number) => {
      for (const k of keys) b.key(k, true);
      run(b, fps, seconds, () => {
        trace.push(b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.grapple.rope.length);
        top2 = Math.max(top2, Math.hypot(b.vel.x, b.vel.y, b.vel.z));
      });
      for (const k of keys) b.key(k, false);
    };
    phase(['KeyD'], 2);
    const swung = top2;
    phase(['ShiftLeft'], 0.5);
    phase(['KeyX'], 0.5);
    phase(['KeyF'], 0.6);
    return { trace, swung, b };
  };
  for (const fps of FPS) {
    const none = await swingTrace(fps, null);
    const empty = await swingTrace(fps, new PlayerStats());
    let same = none.trace.length === empty.trace.length;
    for (let i = 0; same && i < none.trace.length; i++) if (!Object.is(none.trace[i], empty.trace[i])) same = false;
    ok(same && none.swung > 3, `${fps} fps: a swing swayed, reeled in, reeled out and hauled through the player's empty stats is the swing with none, by Object.is (${none.trace.length / 7} frames)`);
    const print = fnv32(traceText(empty.trace));
    ok(print === WAVE2_SWING[fps] && fnv32(traceText(none.trace)) === WAVE2_SWING[fps], `${fps} fps: and both are wave 2's swing to the bit (${print}, wave 2 ${WAVE2_SWING[fps]})`);
    const acro = new PlayerStats();
    const rec = emptyRecord('cgrapple');
    rec.core.acrobatics = xpCap(PROGRESS_RULES);
    acro.update(rec);
    const trained = await swingTrace(fps, acro);
    ok(Object.is(acro.apply('grapple.swing', 1), 1.25) && trained.swung > none.swung * 1.1, `${fps} fps: with Acrobatics at 100 (the swing times 1.25) the sway builds the swing to ${r2(trained.swung)} m/s in 2 s, against ${r2(none.swung)} without`);
  }
  // A table that moves the range, the reel and the haul is read at every site: the reel at half, the haul at half, and a
  // mark past the shorter reach refused.
  const moved = (over: Partial<Record<StatId, number>>): GrappleStats => ({ apply: (id: StatId, base: number) => (id in over ? (over[id] as number) : base) });
  {
    const { b: plain } = await (async () => {
      fresh();
      const physics = await makePhysics();
      const top = box(physics, [-0.5, 40, -0.5], [0.5, 41, 0.5], false);
      physics.stepOnce();
      const b = new TestBody(physics);
      b.grapple.stats = moved({ 'grapple.reel': 3, 'grapple.yank': 9 });
      b.place(0, 40 - 0.05 - 15 - GRAPPLE_TUNE.ropeY, 0);
      physics.stepOnce();
      b.hook(0, 40, 0, 0, -1, 0, top, 15);
      return { b };
    })();
    const len0 = plain.grapple.rope.length;
    plain.key('ShiftLeft', true);
    run(plain, 60, 1);
    plain.key('ShiftLeft', false);
    const reeled = len0 - plain.grapple.rope.length;
    const y0 = plain.pos.y;
    plain.key('KeyF', true);
    run(plain, 60, 0.5);
    plain.key('KeyF', false);
    const hauled = plain.pos.y - y0;
    ok(Math.abs(reeled - 3) < 0.05 && hauled > 3.5 && hauled < 5, `a table with the reel at 3 m/s and the haul at 9 reels ${r2(reeled)} m in a second and hauls ${r2(hauled)} m in half of one`);
  }
  {
    const { b } = await propScene();
    const { prop } = standByCrate(b, 60);
    b.grapple.stats = moved({ 'grapple.range': 14 });
    ok(Object.is(b.grapple.range, 14), "and the range the hook reaches is the table's");
    const c = prop.mesh.position;
    b.fireAt = { x: c.x, y: c.y, z: c.z };
    tap(b, 'Mouse3', 1 / 60);
    ok(!b.grapple.mark.shows && b.grapple.mark.kind === 'prop' && b.grapple.mark.distance > 14 && b.grapple.out === false, `with the range at 14 m the crate's face ${r2(b.grapple.mark.distance)} m off shows no mark and is not fired at (${b.lastFireRefusal})`);
  }
  // A range raised past the tune's 100 m is reached at every site that reads it: the mark shows a wall 120 m off, the
  // dart flies that far and bites, the rope lands at its whole reach, and a reel-out pays it out past it. At the tune's
  // own 100 the same wall shows no mark.
  {
    const far = async (stats: GrappleStats | null) => {
      fresh();
      const physics = await makePhysics();
      ground(physics, 0, 700);
      const wall = box(physics, [-20, 0, -125], [20, 40, -120]);
      physics.stepOnce();
      const b = new TestBody(physics);
      if (stats) b.grapple.stats = stats;
      b.place(0, 0, 0);
      b.forward.set(0, 0, -1);
      b.right.set(1, 0, 0);
      run(b, 60, 0.5);
      b.fireAt = { x: 0, y: GRAPPLE_TUNE.ropeY, z: -120 };
      tap(b, 'Mouse3', 1 / 60);
      const shown = b.grapple.mark.shows;
      run(b, 60, 1.5, () => b.grapple.attached);
      return { b, shown, wall };
    };
    const raised = await far(moved({ 'grapple.range': 150 }));
    const g = raised.b.grapple;
    const bit = g.attached ? g.rope.length : 0;
    raised.b.key('KeyX', true);
    run(raised.b, 60, 2);
    raised.b.key('KeyX', false);
    const paid = g.rope.length;
    ok(raised.shown && g.attached && bit > 119 && bit < 121, `with the range at 150 m the wall 120 m off is marked, the dart reaches it and the rope lands at ${r2(bit)} m`);
    ok(paid > bit + 5 && paid <= 150, `and a reel-out pays it out past the tune's 100 m to ${r2(paid)} m`);
    const plain = await far(null);
    ok(!plain.shown && !plain.b.grapple.out, `at the tune's own 100 m the same wall shows no mark and nothing is fired (${plain.b.lastFireRefusal})`);
  }
  // The haul's lip-over starts when the next step of the haul would reach the shortest, and the step is the haul's speed
  // as the table reads it: at 30 fps with the haul at 9 m/s it starts within 9/30 m of `minFree`, where the tune's own 18
  // would start it 18/30 m out. Hanging under a 20 m roof's lip, the anchor 4 m back on the roof.
  {
    fresh();
    const physics = await makePhysics();
    ground(physics, 0);
    const bld = box(physics, [-10, 0, -10], [0, 20, 10]);
    physics.stepOnce();
    const b = new TestBody(physics);
    b.grapple.stats = moved({ 'grapple.yank': 9 });
    b.forward.set(1, 0, 0);
    b.right.set(0, 0, 1);
    b.place(-0.6, 20, 0);
    physics.stepOnce();
    run(b, 30, 0.3);
    b.hook(-4, 20, 0, 0, 1, 0, bld, 12);
    b.key('KeyW', true);
    run(b, 30, 6, (t) => {
      if (t >= 0.6) b.key('KeyW', false);
    });
    b.key('KeyF', true);
    // The free rope the haul judged the lip-over by is what the frame before it left (the lip-over pays out slack as it
    // starts, so the frame it starts on leaves more).
    let startFree = -1;
    let freeBefore = b.grapple.rope.free();
    let arrived = false;
    run(b, 30, 8, () => {
      if (startFree < 0 && b.grapple.lipping) startFree = freeBefore;
      freeBefore = b.grapple.rope.free();
      arrived = b.grapple.lastLetGo === 'arrived';
      return arrived;
    });
    b.key('KeyF', false);
    const lipAt = GRAPPLE_TUNE.minFree + Math.max(GRAPPLE_TUNE.lipTrigger, 9 / 30);
    ok(startFree > 0 && startFree <= lipAt + 1e-9 && arrived, `with the haul at 9 m/s the lip-over starts ${r2(startFree)} m of free rope out (within ${r2(lipAt)}; the tune's 18 would start it within ${r2(GRAPPLE_TUNE.minFree + 18 / 30)}), and the haul still arrives standing on the roof`);
  }
}

// =============================================================================================================
// 11. The hook's own arithmetic on a prop, in a node process of its own: the tether, the yank and F let go mid-yank,
// with the engine's answers kept, held to nothing a frame.
{
  const alone = JSON.parse(
    execFileSync(process.execPath, ['--expose-gc', fileURLToPath(new URL('./grappleAllocOwn.ts', import.meta.url)), 'prop'], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .pop() ?? '{}',
  ) as { skipped?: string; frames: number; made: number; scavenges: number; seen: Record<string, number>; hookedOnce: boolean; yankedOnce: boolean; holding: boolean; bends: number };
  if (alone.skipped) note(`the allocation measure was skipped: ${alone.skipped}`);
  else {
    const missed = Object.entries(alone.seen ?? {}).filter(([, n]) => n === 0).map(([k]) => k);
    note(`in a process of its own: ${JSON.stringify(alone.seen)}`);
    ok(alone.hookedOnce && alone.yankedOnce && alone.holding && alone.bends === 0 && missed.length === 0, `a prop hooked, yanked in to its end, hooked again, dragged, yanked and let up, its mark shown, still held and never bent (${missed.join(', ') || 'nothing missed'})`);
    ok(alone.scavenges === 0 && alone.made < 0.2 * alone.frames, `and over ${alone.frames} such frames the hook's own code makes ${Math.max(0, alone.made)} bytes (under 0.2 B a frame, ${alone.scavenges} collections)`);
  }
}

// The last pool let go, as a world going lets its own go.
dropLooseProps({ scene: new THREE.Scene(), physics: null as never, forgetMaterials: () => {} });
fresh();
console.log(`\n${checks} checks passed`);
