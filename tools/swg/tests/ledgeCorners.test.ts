// Wave 4 of the animations, its fix round: the owner's additions to the ledges made while the wave ran, and the room a hang,
// a shimmy, a hop and a climb take, on the real Rapier through the grapple's harness (the game's own movement and ledge
// calls, tools/swg/tests/grappleBody.ts), at 30, 60 and 144 frames a second:
//  - a shimmy goes round an outer corner and an inner corner and along a curved lip, turning to face each new face, with
//    no hand off its lip and no capsule in a wall; it stops at an inner corner whose wall rises past the lip (no lip goes
//    on), and before a crate standing at the knees;
//  - a lip rising and falling at 20 and 34 degrees is shimmied up and down whole, one at 40 (past `climb.lipSlope`) is not,
//    the hands within a centimetre of the lip under each and the body turned with the slope by `climb.lipTilt` of it;
//  - a hop reaches a lip on another face (a block's near side facing back across the gap) and one 5 m off at a reach of 6
//    (the slider's tops go to 8); a hop whose straight way meets a pillar arcs over it, never through it;
//  - a climb up carries the capsule out, up and in over the lip, never into the wall (the capsule worn, crouched on its
//    last leg).
import assert from 'node:assert/strict';
import { TestBody, box, ground, makePhysics, trunk, CAPSULE_RADIUS, STAND_HALF_HEIGHT, CROUCH_HALF_HEIGHT, type Physics } from './grappleBody.ts';
import { CLIMB_RANGES, CLIMB_TUNE, resetClimbTune, tuneClimb } from '../../../src/anim/climbTune.ts';
import { LEDGE_HANG, LEDGE_MOVE } from '../../../src/player/ledge.ts';
import { LEDGE_FACTS, LEDGE_ROLES } from '../../../src/anim/ledgeClips.ts';
import { RAPIER } from '../../../src/core/physics.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const n3 = (v: number) => v.toFixed(3);
const FPS = [30, 60, 144] as const;

function bodyAt(p: Physics, x: number, z: number, fps: number, y = 0): TestBody {
  const b = new TestBody(p);
  b.jka.forceLevel = 0;
  b.place(x, y, z);
  b.forward.set(0, 0, 1);
  b.right.set(-1, 0, 0);
  b.run(fps, 0.3);
  return b;
}
function runUntil(b: TestBody, fps: number, seconds: number, until: () => boolean): number {
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) {
    b.frame(1 / fps);
    if (until()) return (i + 1) / fps;
  }
  return Infinity;
}
function tap(b: TestBody, code: string, fps: number, also: string[] = []): void {
  for (const k of also) b.key(k, true);
  b.key(code, true);
  b.frame(1 / fps);
  b.key(code, false);
  for (const k of also) b.key(k, false);
}
const settled = (b: TestBody) => b.ledge.phase === LEDGE_HANG;
function grab(b: TestBody, fps: number): boolean {
  b.key('KeyW', true);
  tap(b, 'Space', fps);
  const t = runUntil(b, fps, 3, () => settled(b));
  b.key('KeyW', false);
  return Number.isFinite(t);
}

/** The capsule the body wears now (crouched or standing): its axis's two ends over the feet. */
function capsuleAxis(b: TestBody): [number, number] {
  const crouched = (b as unknown as { colliderCrouched: boolean }).colliderCrouched;
  const half = crouched ? CROUCH_HALF_HEIGHT : STAND_HALF_HEIGHT;
  return [b.pos.y + CAPSULE_RADIUS, b.pos.y + CAPSULE_RADIUS + 2 * half];
}
/** How deep the worn capsule reaches into an axis-aligned box, metres. */
function penBox(b: TestBody, mn: number[], mx: number[]): number {
  const [y0, y1] = capsuleAxis(b);
  let best = Infinity;
  for (let i = 0; i <= 16; i++) {
    const y = y0 + ((y1 - y0) * i) / 16;
    const ax = b.pos.x;
    const az = b.pos.z;
    const inside = ax > mn[0] && ax < mx[0] && y > mn[1] && y < mx[1] && az > mn[2] && az < mx[2];
    const d = inside
      ? -Math.min(ax - mn[0], mx[0] - ax, y - mn[1], mx[1] - y, az - mn[2], mx[2] - az)
      : Math.hypot(ax - Math.max(mn[0], Math.min(mx[0], ax)), y - Math.max(mn[1], Math.min(mx[1], y)), az - Math.max(mn[2], Math.min(mx[2], az)));
    best = Math.min(best, d);
  }
  return Math.max(0, CAPSULE_RADIUS - best);
}
/** How far a point (level) stands off a box's outline in its own top plane (its four top edges), metres. */
function offOutline(x: number, z: number, mn: number[], mx: number[]): number {
  const inside = x > mn[0] && x < mx[0] && z > mn[2] && z < mx[2];
  if (inside) return Math.min(x - mn[0], mx[0] - x, z - mn[2], mx[2] - z);
  return Math.hypot(x - Math.max(mn[0], Math.min(mx[0], x)), z - Math.max(mn[2], Math.min(mx[2], z)));
}
/** The lip under each hand at its rest spacing and half way in (the rail's own samples), each through `each`. */
function hands(b: TestBody, each: (x: number, y: number, z: number) => void): void {
  const L = b.ledge;
  if (L.phase !== LEDGE_HANG || L.rail.n === 0) return;
  const half = (Math.abs(LEDGE_FACTS[L.braced ? LEDGE_ROLES.braced.idle : LEDGE_ROLES.free.idle].span0) / 2) * b.ledgeScale;
  for (const k of [-1, -0.5, 0.5, 1]) {
    L.rail.q = L.barc + half * k;
    L.rail.sample();
    each(L.rail.sx, L.rail.sy, L.rail.sz);
  }
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// ---- 1. round an outer corner -----------------------------------------------------------------------------------------------
for (const fps of FPS) {
  const p = await makePhysics();
  ground(p, 0);
  const wall = [[-3, 0, 2], [1, 2.6, 4]];
  box(p, wall[0], wall[1]);
  p.stepOnce();
  const b = bodyAt(p, -0.5, 1.2, fps);
  ok(grab(b, fps), `${fps} fps: the lip grabbed facing it`);
  let pen = 0;
  let off = 0;
  b.key('KeyA', true);
  for (let i = 0; i < 6 * fps; i++) {
    b.frame(1 / fps);
    pen = Math.max(pen, penBox(b, wall[0], wall[1]));
    hands(b, (x, y, z) => (off = Math.max(off, offOutline(x, z, wall[0], wall[1]), Math.abs(y - 2.6))));
  }
  b.key('KeyA', false);
  const h = wrap(b.ledge.heading);
  ok(settled(b) && Math.abs(wrap(h + Math.PI / 2)) < 0.05 && b.pos.x > 1.2 && b.pos.z > 2.3, `${fps} fps: a shimmy left goes round the outer corner at x 1 and on along the side face, turned to face it (heading ${n3(h)}, body at ${n3(b.pos.x)}, ${n3(b.pos.z)})`);
  ok(off < 0.01, `${fps} fps:   every hand on the lip under it within a centimetre, frame by frame (worst ${(off * 1000).toFixed(2)} mm)`);
  ok(pen < 1e-3, `${fps} fps:   and the capsule never in the wall (worst ${(pen * 1000).toFixed(2)} mm)`);
}

// ---- 2. round an inner corner, and stopped at one whose wall rises past the lip -------------------------------------------
for (const fps of FPS) {
  for (const sideTop of [2.6, 4]) {
    const p = await makePhysics();
    ground(p, 0);
    const wall = [[-3, 0, 2], [3, 2.6, 3]];
    const side = [[1, 0, 0], [2, sideTop, 2]];
    box(p, wall[0], wall[1]);
    box(p, side[0], side[1]);
    p.stepOnce();
    const b = bodyAt(p, -0.5, 1.2, fps);
    ok(grab(b, fps), `${fps} fps: the lip grabbed (side block ${sideTop} m)`);
    let pen = 0;
    let off = 0;
    b.key('KeyA', true);
    for (let i = 0; i < 6 * fps; i++) {
      b.frame(1 / fps);
      pen = Math.max(pen, penBox(b, wall[0], wall[1]), penBox(b, side[0], side[1]));
      hands(b, (x, y, z) => (off = Math.max(off, Math.min(offOutline(x, z, wall[0], wall[1]), offOutline(x, z, side[0], side[1])), Math.abs(y - 2.6))));
    }
    b.key('KeyA', false);
    const h = wrap(b.ledge.heading);
    if (sideTop === 2.6) {
      ok(settled(b) && Math.abs(wrap(h - Math.PI / 2)) < 0.05 && b.pos.z < 1.5, `${fps} fps: a shimmy left goes round the inner corner onto the side block's lip, turned to face it (heading ${n3(h)}, body at ${n3(b.pos.x)}, ${n3(b.pos.z)})`);
      ok(off < 0.01, `${fps} fps:   every hand on the lip under it within a centimetre (worst ${(off * 1000).toFixed(2)} mm)`);
    } else {
      ok(settled(b) && Math.abs(h) < 1e-6 && b.pos.x < 1 - CAPSULE_RADIUS + 0.01, `${fps} fps: where the side block rises past the lip (no lip goes on) the shimmy stops before it (body x ${n3(b.pos.x)})`);
    }
    ok(pen < 1e-3, `${fps} fps:   the capsule never in either wall (worst ${(pen * 1000).toFixed(2)} mm)`);
  }
}

// A taller post standing flush at the wall's end (its face in line with the wall's): no lip goes on, and no hand is put on
// the post's top-less face (the probe takes a face only where the top it found stands over it).
for (const fps of FPS) {
  const p = await makePhysics();
  ground(p, 0);
  const wall = [[-3, 0, 2], [0.4, 2.6, 3]];
  const post = [[0.4, 0, 2], [0.6, 4, 3]];
  box(p, wall[0], wall[1]);
  box(p, post[0], post[1]);
  p.stepOnce();
  const b = bodyAt(p, -1, 1.2, fps);
  ok(grab(b, fps), `${fps} fps: grabbed beside a post standing flush at the wall's end`);
  let far = Number.NEGATIVE_INFINITY;
  let pen = 0;
  b.key('KeyA', true);
  for (let i = 0; i < 4 * fps; i++) {
    b.frame(1 / fps);
    hands(b, (x) => (far = Math.max(far, x)));
    pen = Math.max(pen, penBox(b, post[0], post[1]), penBox(b, wall[0], wall[1]));
  }
  b.key('KeyA', false);
  ok(settled(b) && far <= 0.4 + 1e-3 && pen < 1e-3, `${fps} fps: the shimmy stops at the post with every hand on the wall's own lip (furthest at x ${n3(far)}, the post from 0.4; capsule ${(pen * 1000).toFixed(2)} mm in)`);
}

// ---- 3. along a curved lip ----------------------------------------------------------------------------------------------------
for (const r of [1.2, 3]) {
  for (const fps of FPS) {
    const p = await makePhysics();
    ground(p, 0);
    trunk(p, 0, 3, r, 0, 2.6);
    p.stepOnce();
    const b = bodyAt(p, 0, 3 - r - 0.8, fps);
    ok(grab(b, fps), `${fps} fps: a round tower's lip grabbed (radius ${r})`);
    const h0 = b.ledge.heading;
    let off = 0;
    let pen = 0;
    b.key('KeyA', true);
    for (let i = 0; i < 6 * fps; i++) {
      b.frame(1 / fps);
      hands(b, (x, y, z) => (off = Math.max(off, Math.abs(Math.hypot(x, z - 3) - r), Math.abs(y - 2.6))));
      const [y0] = capsuleAxis(b);
      if (y0 < 2.6) pen = Math.max(pen, r + CAPSULE_RADIUS - Math.hypot(b.pos.x, b.pos.z - 3));
    }
    b.key('KeyA', false);
    const turned = Math.abs(wrap(b.ledge.heading - h0));
    ok(settled(b) && turned > (r < 2 ? 1.5 : 0.7), `${fps} fps: a shimmy follows the tower's curve round, turning with it (${n3((turned * 180) / Math.PI)} degrees in 6 s)`);
    ok(off < 0.01, `${fps} fps:   every hand on the curved lip within a centimetre (worst ${(off * 1000).toFixed(2)} mm)`);
    ok(pen < 1e-3, `${fps} fps:   and the capsule never in the tower (worst ${(pen * 1000).toFixed(2)} mm)`);
  }
}

// ---- 4. a lip rising and falling along its length --------------------------------------------------------------------------
for (const deg of [20, 34, 40]) {
  for (const fps of FPS) {
    const p = await makePhysics();
    ground(p, 0);
    const a = (deg * Math.PI) / 180;
    // A slab whose front face looks -z at z = 2, its top edge rising along +x (a cuboid turned about z), passing 2.6 at x 0.
    const hy = 1.5;
    p.world.createCollider(RAPIER.ColliderDesc.cuboid(8, hy, 1).setTranslation(Math.sin(a) * hy, 2.6 - Math.cos(a) * hy, 3).setRotation({ x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2) }));
    p.stepOnce();
    const lipAt = (x: number) => 2.6 + Math.tan(a) * x;
    const b = bodyAt(p, 0, 1.2, fps);
    ok(grab(b, fps), `${fps} fps: a lip sloping at ${deg} degrees grabbed`);
    let off = 0;
    const check = () => hands(b, (x, y, z) => (off = Math.max(off, Math.abs(y - lipAt(x)), Math.abs(z - 2))));
    check();
    const x0 = b.pos.x;
    b.key('KeyA', true);
    for (let i = 0; i < 3 * fps; i++) {
      b.frame(1 / fps);
      check();
    }
    b.key('KeyA', false);
    const xUp = b.pos.x;
    const tilt = b.ledge.tilt;
    b.key('KeyD', true);
    for (let i = 0; i < 3 * fps; i++) {
      b.frame(1 / fps);
      check();
    }
    b.key('KeyD', false);
    const xDown = b.pos.x;
    if (deg < CLIMB_TUNE.lipSlope) {
      ok(settled(b) && xUp - x0 > 1 && xUp - xDown > 1, `${fps} fps: at ${deg} degrees the shimmy goes up the slope and back down it (x ${n3(x0)} to ${n3(xUp)} and back to ${n3(xDown)})`);
      const want = Math.atan(Math.tan(a)) * CLIMB_TUNE.lipTilt;
      ok(Math.abs(tilt - want) < 0.02, `${fps} fps:   the body turned with the slope by lipTilt of it (${n3((tilt * 180) / Math.PI)} degrees, ${n3((want * 180) / Math.PI)} asked)`);
    } else ok(settled(b) && Math.abs(xUp - x0) < 0.01 && Math.abs(xDown - x0) < 0.01, `${fps} fps: at ${deg} degrees (past lipSlope ${CLIMB_TUNE.lipSlope}) the shimmy does not go along it either way (x ${n3(x0)}, ${n3(xUp)}, ${n3(xDown)})`);
    ok(off < 0.01, `${fps} fps:   each hand on the lip at its own height under it within a centimetre (worst ${(off * 1000).toFixed(2)} mm)`);
  }
}

// ---- 5. a crate at the knees stops the shimmy -------------------------------------------------------------------------------
for (const fps of FPS) {
  const p = await makePhysics();
  ground(p, 0);
  const wall = [[-3, 0, 2], [3, 2.6, 3]];
  const crate = [[1, 0, 1], [2, 1.9, 2]];
  box(p, wall[0], wall[1]);
  box(p, crate[0], crate[1]);
  p.stepOnce();
  const b = bodyAt(p, -0.8, 1.2, fps);
  ok(grab(b, fps), `${fps} fps: the lip over a crate's corner grabbed`);
  let pen = 0;
  b.key('KeyA', true);
  for (let i = 0; i < 6 * fps; i++) {
    b.frame(1 / fps);
    pen = Math.max(pen, penBox(b, crate[0], crate[1]));
  }
  b.key('KeyA', false);
  ok(settled(b) && b.pos.x < 1 - CAPSULE_RADIUS + 0.01 && pen < 1e-3, `${fps} fps: a shimmy toward a crate standing at the knees stops before it (body x ${n3(b.pos.x)}, worst ${(pen * 1000).toFixed(2)} mm into it)`);
}

// ---- 6. hops: over a pillar in the gap, to a block's near side, at a reach of 6 m --------------------------------------------
for (const fps of FPS) {
  {
    const p = await makePhysics();
    ground(p, 0);
    const A = [[-3, 0, 2], [0.6, 2.6, 3]];
    const B = [[1.4, 0, 2], [4, 2.6, 3]];
    const pil = [[0.8, 0, 1], [1.2, 1.5, 2]];
    for (const c of [A, B, pil]) box(p, c[0], c[1]);
    p.stepOnce();
    const b = bodyAt(p, 0, 1.2, fps);
    ok(grab(b, fps), `${fps} fps: grabbed beside a gap with a pillar standing in it`);
    tap(b, 'Space', fps, ['KeyA']);
    const hopping = b.ledge.phase === LEDGE_MOVE && b.ledge.move.kind === 'hop';
    let pen = 0;
    for (let i = 0; i < 3 * fps; i++) {
      b.frame(1 / fps);
      for (const c of [A, B, pil]) pen = Math.max(pen, penBox(b, c[0], c[1]));
    }
    ok(hopping && settled(b) && b.pos.x > 1.4, `${fps} fps: the hop across the gap goes, its way bent over the pillar its straight line meets (lands at x ${n3(b.pos.x)})`);
    ok(pen < 1e-3, `${fps} fps:   the capsule never in the pillar or either wall on the way (worst ${(pen * 1000).toFixed(2)} mm)`);
  }
  {
    const p = await makePhysics();
    ground(p, 0);
    const A = [[-3, 0, 2], [0.4, 2.6, 3]];
    const B = [[1.0, 0, 0.2], [2, 2.6, 3]];
    for (const c of [A, B]) box(p, c[0], c[1]);
    p.stepOnce();
    const b = bodyAt(p, -0.2, 1.2, fps);
    ok(grab(b, fps), `${fps} fps: grabbed beside a block standing across the way`);
    const h0 = b.ledge.heading;
    tap(b, 'Space', fps, ['KeyA']);
    let pen = 0;
    let between = 0;
    for (let i = 0; i < 3 * fps; i++) {
      b.frame(1 / fps);
      for (const c of [A, B]) pen = Math.max(pen, penBox(b, c[0], c[1]));
      const d = wrap(b.ledge.heading - h0);
      if (b.ledge.phase === LEDGE_MOVE && d > 0.2 && d < Math.PI / 2 - 0.2) between++;
    }
    ok(between > 0.2 * fps, `${fps} fps: the hop turns the body toward the other face as it goes (${between} frames part way round)`);
    const h = wrap(b.ledge.heading);
    ok(settled(b) && Math.abs(wrap(h - Math.PI / 2)) < 0.05 && Math.abs(b.ledge.lip.ex - 1) < 0.01, `${fps} fps: a hop reaches the lip of the block's near side, another face, and hangs facing it (heading ${n3(h)}, lip at x ${n3(b.ledge.lip.ex)})`);
    ok(pen < 1e-3, `${fps} fps:   the capsule never in either block on the way (worst ${(pen * 1000).toFixed(2)} mm)`);
  }
  {
    const p = await makePhysics();
    ground(p, 0);
    box(p, [-3, 0, 2], [0, 2.6, 3]);
    box(p, [5, 0, 2], [8, 2.8, 3]);
    p.stepOnce();
    const b = bodyAt(p, -0.5, 1.2, fps);
    ok(grab(b, fps), `${fps} fps: grabbed 5 m short of another wall`);
    tap(b, 'Space', fps, ['KeyA']);
    const refused = b.ledgeWords.includes('No ledge to hop to.');
    const words = tuneClimb({ hopSide: 6 });
    tap(b, 'Space', fps, ['KeyA']);
    runUntil(b, fps, 4, () => settled(b) && b.pos.x > 4);
    ok(refused && words.length === 0 && settled(b) && b.pos.x > 5 && Math.abs(b.ledge.lip.ey - 2.8) < 1e-3, `${fps} fps: at the brief's 1.5 the wall 5 m off is out of reach, refused in words; at a reach of 6 the hop goes to it (lands at x ${n3(b.pos.x)})`);
    resetClimbTune();
  }
}
ok(CLIMB_RANGES.hopSide.max >= 6 && CLIMB_RANGES.hopUp.max >= 6 && CLIMB_RANGES.lipSlope.max >= 35, `the hop's sliders go to ${CLIMB_RANGES.hopSide.max} m sideways and ${CLIMB_RANGES.hopUp.max} m up, past the brief's 6`);

// ---- 7. the climb up: out, up and in, never into the wall ---------------------------------------------------------------------
for (const fps of FPS) {
  for (const roof of [false, true]) {
    const p = await makePhysics();
    ground(p, 0);
    const wall = [[-3, 0, 2], [3, 2.6, 6]];
    const lid = [[-3, 3.85, 2.5], [3, 4.4, 4]];
    box(p, wall[0], wall[1]);
    if (roof) box(p, lid[0], lid[1]);
    p.stepOnce();
    const b = bodyAt(p, 0, 1.2, fps);
    ok(grab(b, fps), `${fps} fps: grabbed${roof ? ' under a roof 1.25 m over the top' : ''}`);
    tap(b, 'KeyW', fps);
    const climbing = b.ledge.phase === LEDGE_MOVE && b.ledge.move.kind === 'climb';
    let pen = 0;
    let crouchedLeg = false;
    let offLine = 0;
    let offPath = 0;
    for (let i = 0; i < 3 * fps; i++) {
      // The figure drawn (the body and its line-up) keeps the climb's straight line, while the capsule goes its own way.
      const m = b.ledge.move;
      const wasMove = b.ledge.phase === LEDGE_MOVE;
      b.frame(1 / fps);
      if (wasMove && b.ledge.phase === LEDGE_MOVE && m.kind === 'climb') {
        const u = Math.min(1, Math.max(0, (m.time - m.t0) / (m.T - m.t0)));
        const fx = m.fx + (m.tx - m.fx) * u + m.o0x + (m.o1x - m.o0x) * u;
        const fy = m.fy + (m.ty - m.fy) * u + m.o0y + (m.o1y - m.o0y) * u;
        const fz = m.fz + (m.tz - m.fz) * u + m.o0z + (m.o1z - m.o0z) * u;
        if (m.time - m.t0 > CLIMB_TUNE.ease + 1 / fps) offLine = Math.max(offLine, Math.hypot(b.pos.x + b.ledge.offX - fx, b.pos.y + b.ledge.offY - fy, b.pos.z + b.ledge.offZ - fz));
        offPath = Math.max(offPath, Math.hypot(b.pos.x - (m.fx + (m.tx - m.fx) * u), b.pos.y - (m.fy + (m.ty - m.fy) * u), b.pos.z - (m.fz + (m.tz - m.fz) * u)));
      }
      pen = Math.max(pen, penBox(b, wall[0], wall[1]), roof ? penBox(b, lid[0], lid[1]) : 0);
      if (b.ledge.crouchedNow) crouchedLeg = true;
    }
    ok(offPath > 0.2 && offLine < 0.02, `${fps} fps:   the capsule leaves the straight line by up to ${n3(offPath)} m while the figure drawn keeps it (within ${(offLine * 1000).toFixed(1)} mm, its line-up's own ease aside)`);
    ok(climbing && !b.ledge.holding && b.grounded && Math.abs(b.pos.y - 2.6) < 0.05 && crouchedLeg, `${fps} fps: the climb up${roof ? ' under the roof' : ''} ends on the top (feet ${n3(b.pos.y)}), crouched over it on its last leg`);
    ok(pen < 1e-3, `${fps} fps:   the capsule worn never in the wall${roof ? ' or the roof' : ''} on the way (worst ${(pen * 1000).toFixed(2)} mm)`);
  }
}

note('a climb\'s legs move only the capsule (the figure drawn keeps the climb\'s straight line); a hop\'s curve carries the figure with it');
console.log(`ledgeCorners: ${checks} checks passed`);
