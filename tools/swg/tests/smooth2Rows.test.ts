// Climbing II, Smoothness II, item 9: the course's extra rows driven again with every switch of Smoothness II on, and (9b) the
// owner's new pieces driven too (`freePieces` at the end of src/anim/climbCourse.ts: the free twins of every lip kind, the
// traverses and the climbing walls), with only the owner's keys, through the game's own movement and climbing on the real
// Rapier at 30, 60, 144 and 240 frames a second.
//  1. The extra rows: tools/swg/tests/climbRows.test.ts run as it stands with Smoothness II's switches on (`SWG3JS_ROWS_AFTER`):
//     every one of its behaviour checks holds as at 'before', and its whole trace is held to a digest of its own (with the
//     switches at 'before' it is the smoothness round's, which that file holds), so what moved it is these switches alone.
//  2. The owner's pieces, each driven by its own kind with the figure on the body (tools/swg/tests/climbFigure.ts): what the
//     body did, piece by piece (grabbed braced or free, how far it shimmied, which lips the hops and ladders reached, whether a
//     climbing wall was topped out), written out; held: each lip-piece grabbed free where the piece is a free twin, and
//     braced where it is braced, every placed hand within 1.2 cm of its place, and the trunk's and the legs' spheres held
//     to no more frames over 1 cm than with item 3 at 'before'. Their whole trace is held to a digest too.
// Nothing of a piece's geometry is moved to make a drive pass (the pieces are the owner's test bed).
//
// Run: node tools/swg/tests/smooth2Rows.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';

process.env.SWG3JS_ROWS_AFTER = '1';
await import('./climbRows.test.ts');
delete process.env.SWG3JS_ROWS_AFTER;

const { climbCourse, extraIds } = await import('../../../src/anim/climbCourse.ts');
const { courseWayToWorld, worldToCourse } = await import('../../../src/anim/climbCourseBuild.ts');
const { resetClimbTune: resetShipped, climbSmooth3Before, tuneClimb } = await import('../../../src/anim/climbTune.ts');
// (Smoothness III's switches at their other setting too: this suite holds Smoothness II's climbing.)
const resetClimbTune = (): void => {
  resetShipped();
  climbSmooth3Before();
};
const { resetMoveTune: resetMoveShipped, moveSmooth3Before } = await import('../../../src/anim/moveTune.ts');
// (Smoothness III's body switches at their other setting too: this suite holds the body before it.)
const resetMoveTune = (): void => {
  resetMoveShipped();
  moveSmooth3Before();
};
const { LEDGE_HANG, WAYK_HOP } = await import('../../../src/player/ledge.ts');
const { SPHERE_COUNT, SPHERES_TRUNK } = await import('../../../src/player/bodySpheres.ts');
const { PLACED } = await import('../../../src/player/climbClear.ts');
const { bodyAt, nearestLip, runUntil, shimmy, standPiece, tap } = await import('./climbCourseBody.ts');
const { drawClimb, figure, figureScale, HAVE_BODY, sphereWorst } = await import('./climbFigure.ts');
type TestBody = import('./grappleBody.ts').TestBody;
type Stood = import('./climbCourseBody.ts').Stood;

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const RATES = [30, 60, 144, 240] as const;
const FREE_PIECES = extraIds().slice(18);
/** The digest of every frame of every drive of the owner's pieces, at every rate. */
const RECORDED = 'c3f1f0372b9286274d099d980566c1086830c6889822b2454257059616c331ad';
const trace = createHash('sha256');
let frames = 0;
const piece = (id: string) => climbCourse({ extras: true, pieces: [id] }).pieces[0];
const hangs = (b: TestBody) => b.ledge.phase === LEDGE_HANG;
const nameOf = (s: Stood, b: TestBody) => (b.ledge.holding ? nearestLip(s, b.ledge.lip.ex, b.ledge.lip.ey, b.ledge.lip.ez).name : '-');
const GV = new THREE.Vector3();

ok(FREE_PIECES.length === 31 && FREE_PIECES[0] === 'free-corner-outer-90' && FREE_PIECES[FREE_PIECES.length - 1] === 'climbwall-free-small', `the owner's pieces after the extra rows: ${FREE_PIECES.length}, from ${FREE_PIECES[0]} to ${FREE_PIECES[FREE_PIECES.length - 1]}`);

/** A standing jump with E held from its frame: the grab. */
function jumpE(b: TestBody, fps: number): boolean {
  b.key('KeyE', true);
  tap(b, 'Space', fps);
  runUntil(b, fps, 2.5, () => hangs(b));
  b.key('KeyE', false);
  return hangs(b);
}
/** The view turned to the wall the body faces (W means up). */
function faceWall(b: TestBody): void {
  b.forward.set(Math.sin(b.heading), 0, Math.cos(b.heading));
  b.right.set(-Math.cos(b.heading), 0, Math.sin(b.heading));
}
/** A step by held keys, as the extra rows': a ladder-like hold by the keys alone, else a cue that shows taken by Space. */
function step(s: Stood, b: TestBody, fps: number, keys: string[]): string {
  const L = b.ledge;
  const from = nameOf(s, b);
  if (keys.length === 1 && keys[0] === 'KeyW') faceWall(b);
  for (const k of keys) b.key(k, true);
  let how = 'none';
  runUntil(b, fps, 4, () => {
    if (L.cueKind === WAYK_HOP && L.cue >= 0.99) {
      how = 'cue';
      return true;
    }
    if (hangs(b) && nameOf(s, b) !== from) {
      how = 'ladder';
      return true;
    }
    return !L.holding;
  });
  if (how === 'cue') tap(b, 'Space', fps);
  for (const k of keys) b.key(k, false);
  runUntil(b, fps, 3, () => (hangs(b) && nameOf(s, b) !== from) || !L.holding);
  runUntil(b, fps, 0.3, () => false);
  return `${nameOf(s, b)}:${how}`;
}
/** The view turned back past the look-away's threshold, then Space (the hop behind). */
function behind(s: Stood, b: TestBody, fps: number): string {
  const from = nameOf(s, b);
  const v = b.heading + Math.PI * (160 / 180);
  b.forward.set(Math.sin(v), 0, Math.cos(v));
  b.right.set(-Math.cos(v), 0, Math.sin(v));
  runUntil(b, fps, 0.5, () => false);
  tap(b, 'Space', fps);
  runUntil(b, fps, 3, () => (hangs(b) && nameOf(s, b) !== from) || (!b.ledge.holding && b.grounded));
  runUntil(b, fps, 0.3, () => false);
  faceWall(b);
  return `${nameOf(s, b)}:behind`;
}

interface Measure {
  frames: number;
  deep: number;
  worst: number;
  handOff: number;
}
/** The figure on the body, measuring every climbing frame: the trunk's and legs' spheres, each placed hand off its place. */
function watchFigure(b: TestBody): Measure {
  const F = figure();
  b.ledgeScale = figureScale(F);
  const M: Measure = { frames: 0, deep: 0, worst: 0, handOff: 0 };
  const hold = b.frame.bind(b);
  b.frame = (dt: number) => {
    hold(dt);
    if (!drawClimb(b, F, dt)) return;
    sphereWorst(b, F);
    let d = 0;
    for (let i = 0; i < SPHERE_COUNT; i++) if ((SPHERES_TRUNK >>> i) & 1 && F.spheres.after[i] > d) d = F.spheres.after[i];
    M.frames++;
    if (d > 0.01) M.deep++;
    if (d > M.worst) M.worst = d;
    if (b.ledge.holding) {
      for (let side = 0; side < 2; side++) {
        if (!(PLACED[side] >= 0.99 && F.lp.handW[side] >= 0.99)) continue;
        const g = F.lp.gripNow(F.rig as never, side, null, GV);
        if (g) M.handOff = Math.max(M.handOff, Math.hypot(g.x - F.lp.hand[side * 3], g.y - F.lp.hand[side * 3 + 1], g.z - F.lp.hand[side * 3 + 2]));
      }
    }
  };
  return M;
}

/** One drive of one of the owner's pieces at one rate, with item 3 on or off: what the body did, in words. */
async function drive(id: string, fps: number, clear: boolean): Promise<{ words: string; m: Measure; braced: boolean | null; hash: string; frames: number }> {
  resetClimbTune();
  resetMoveTune();
  if (!clear) tuneClimb({ bodyClear: 'before' });
  const s = await standPiece(piece(id));
  const p = s.piece;
  const startName = p.starts.some((q) => q.name === 'stand') ? 'stand' : p.starts.some((q) => q.name === 'onA') ? 'onA' : 'first';
  const { b, w } = bodyAt(s, startName, fps);
  const m = HAVE_BODY ? watchFigure(b) : { frames: 0, deep: 0, worst: 0, handOff: 0 };
  const words: string[] = [];
  let braced: boolean | null = null;
  if (id.startsWith('climbwall-')) {
    // A climbing wall: E at its foot and W held, hand over hand to the top (the wall climb on a braced one; the holds hopped on a free one).
    b.key('KeyE', true);
    b.key('KeyW', true);
    runUntil(b, fps, 2, () => b.wall.holding || hangs(b));
    b.key('KeyE', false);
    words.push(b.wall.holding ? 'on the wall' : hangs(b) ? `hung on ${nameOf(s, b)}` : 'nothing taken');
    if (hangs(b)) braced = b.ledge.braced;
    if (b.wall.holding) {
      runUntil(b, fps, 16, () => !b.wall.holding && !b.ledge.holding);
      b.key('KeyW', false);
    } else {
      b.key('KeyW', false);
      for (let k = 0; k < 8 && hangs(b); k++) words.push(step(s, b, fps, ['KeyW']));
    }
    const at = worldToCourse(s.frame, s.piece, b.pos.x, b.pos.y, b.pos.z, { x: 0, y: 0, z: 0 });
    words.push(b.grounded ? `on its feet at ${at.y.toFixed(1)} m${b.ledge.lastLetGo === 'climbed up' ? ', climbed up onto the top' : ''}` : 'in the air');
  } else {
    const grabbed = jumpE(b, fps);
    braced = grabbed ? b.ledge.braced : null;
    words.push(grabbed ? `${braced ? 'braced' : 'free'} on ${nameOf(s, b)}` : 'no grab');
    if (grabbed) {
      if (/^free-(corner|bend|curve|slope|steps)/.test(id)) {
        const d = shimmy(s, b, w, 'KeyD', fps);
        runUntil(b, fps, 0.3, () => false);
        const a = shimmy(s, b, w, 'KeyA', fps);
        words.push(`D ${d.moved.toFixed(2)} m (${d.why}, turned ${d.turned.toFixed(0)}), A ${a.moved.toFixed(2)} m (${a.why}, turned ${a.turned.toFixed(0)})`);
      } else if (/^free-gap-side/.test(id)) words.push(step(s, b, fps, ['KeyD']));
      else if (/^free-gap-updown/.test(id)) words.push(step(s, b, fps, ['KeyW']));
      else if (/^free-gap-diag/.test(id)) words.push(step(s, b, fps, ['KeyW', 'KeyD']));
      else if (/^free-gap-behind/.test(id)) words.push(behind(s, b, fps));
      else if (/^free-ladder/.test(id)) {
        for (let k = 0; k < 5 && hangs(b); k++) words.push(step(s, b, fps, ['KeyW']));
      } else if (/^traverse-/.test(id)) {
        for (let k = 0; k < 8 && hangs(b); k++) {
          const was = nameOf(s, b);
          const r = step(s, b, fps, ['KeyD']);
          words.push(r);
          if (r.startsWith(was) || r.startsWith('-')) {
            // No hop that way: the shimmy along what it holds.
            const sh = shimmy(s, b, w, 'KeyD', fps);
            words.push(`shimmied ${sh.moved.toFixed(2)} m (${sh.why})`);
            if (!(sh.moved > 0.05)) break;
          }
        }
      }
    }
  }
  const hash = w.hash.digest('hex');
  b.physics.world.removeRigidBody(b.body);
  return { words: words.join(' | '), m, braced, hash, frames: w.frames };
}

for (const fps of RATES) {
  for (const id of FREE_PIECES) {
    const on = await drive(id, fps, true);
    trace.update(`${id}@${fps} ${on.hash} ${on.words}\n`);
    frames += on.frames;
    console.log(`row  ${id} @${fps}: ${on.words}`);
    if (!HAVE_BODY) continue;
    const off = await drive(id, fps, false);
    ok(on.words === off.words, `${id} @${fps}: the body did the same with item 3 on as off (its push is the figure's alone)`);
    const free = id.startsWith('free-') || id.endsWith('-free') || id.includes('-free-');
    if (on.braced !== null && !id.startsWith('climbwall-')) ok(on.braced === !free, `${id} @${fps}: grabbed ${on.braced ? 'braced' : 'free'}, as the piece means`);
    ok(on.m.handOff <= Math.max(0.012, off.m.handOff + 0.005), `${id} @${fps}: every placed hand as near its place as before, within half a centimetre (worst ${(on.m.handOff * 100).toFixed(1)} cm, 'before' ${(off.m.handOff * 100).toFixed(1)})`);
    ok(on.m.deep <= off.m.deep, `${id} @${fps}: no more frames with the trunk or a leg over 1 cm in anything still than before (${on.m.deep} of ${on.m.frames}, 'before' ${off.m.deep}; worst ${(on.m.worst * 100).toFixed(1)} cm, 'before' ${(off.m.worst * 100).toFixed(1)})`);
  }
}
const digest = trace.digest('hex');
console.log(`digest ${digest} over ${frames} frames`);
if (RECORDED === 'pending') note('no digest recorded yet');
else ok(digest === RECORDED, `the owner's pieces' whole trace at every rate is the one recorded (${digest.slice(0, 16)}, ${frames} frames)`);
resetClimbTune();
resetMoveTune();
void courseWayToWorld;
console.log(`smooth2Rows: ${checks} checks passed`);
