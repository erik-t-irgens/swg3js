// Climbing II, phase 3 (maker B): letting go of a bar, the flight, the catch and the landing (`climb.barFlight` 'fly'), and
// everything else round a bar (the crouch's drop, a hard blow, the water under it, other players' nearest pose, the action
// bar's words), through the game's own movement and climbing on the real Rapier (the grapple's harness,
// tools/swg/tests/grappleBody.ts, and the course's bars stood by tools/swg/tests/climbCourseBody.ts) at 30, 60, 144 and 240
// frames a second, and the game's own rig posed by the bar's hand-over (tools/swg/tests/climbFigure.ts):
//  - on `bars-2` to `bars-5`, a running jump with E onto the first bar, W pumping the swing, Space on the forward swing: the
//    next bar caught at every spacing the sliders reach (the boost raised for 4 and 5 m), bar after bar to the far platform
//    and a landing there, at every rate; from one state with the keys on the same steps, the flight and the catch step for
//    step the same at every rate, and keyed off the swing's own angle as a player's would be, the catch within a few
//    centimetres of each other at 30 and 240;
//  - a bar let go short of the next (4 m at the start's boost): the body falls, is handed to the movement past a grab, and
//    lands on the pit's floor; a let-go that meets ground plays the clip's own landing, a wall the falling clips;
//  - the pose: the flight's twin of the clip from the release on, its hips drawn at the flying body's middle, the drawn
//    figure eased from the swing's and onto the new bar at a catch, the clip's landing after a landing;
//  - the crouch drops straight down, Space under 'plain' is maker A's let-go, a hard blow knocks the body off, a flight into
//    water ends there and the body swims; a thin rail or a lower bar across the flight stops it as a wall does (the fix round's);
//  - another player's game told a free hang where its hands are on the grip, and the action bar's words;
//  - with `climb.barFlight` at 'plain' (and `climb.bars` 'off') none of it runs; the hand-overs only the game makes pinned as text.
//
// Run: node tools/swg/tests/climbBarsFly.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { figure, type Figure } from './climbFigure.ts';

const { RAPIER, FIXED_DT } = await import('../../../src/core/physics.ts');
const { TestBody, box, ground, makePhysics } = await import('./grappleBody.ts');
const { CLIMB_BARS_BEFORE, CLIMB_TUNE, climbSmooth3Before, resetClimbTune, tuneClimb } = await import('../../../src/anim/climbTune.ts');
const { BAR_CLIP, BAR_CLIP_NAMES, BAR_FACTS, BAR_FLIGHT_NAME, BAR_TIMES, measureBarFlight, measureBarTable } = await import('../../../src/anim/barClips.ts');
const { BAR_FLY, BAR_GRAB, BAR_NONE, BAR_SWING } = await import('../../../src/player/barSwing.ts');
const { driveBarClips, BAR_LAND_FADE } = await import('../../../src/player/hangClips.ts');
const { climbCourse } = await import('../../../src/anim/climbCourse.ts');
const { worldToCourse } = await import('../../../src/anim/climbCourseBuild.ts');
const { bodyAt, standPiece } = await import('./climbCourseBody.ts');
const { PeerHang, PeerHangIn } = await import('../../../src/player/peerHang.ts');
const { fillActions, newPromptState, PROMPT_WORDS } = await import('../../../src/ui/promptRules.ts');
const { REPO } = await import('./oldModules.ts');
type Body = InstanceType<typeof TestBody>;
type Phys = Awaited<ReturnType<typeof makePhysics>>;
type Stood = Awaited<ReturnType<typeof standPiece>>;

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const RATES = [30, 60, 144, 240] as const;
const DEG = 180 / Math.PI;
const fresh = () => resetClimbTune();
fresh();
/** The boost each spacing is caught at: the start's for 2 and 3 m, the slider raised for 4 and 5 (the sliders' reach). */
const BOOST: Record<string, number> = { 'bars-2': CLIMB_TUNE.barBoost, 'bars-3': CLIMB_TUNE.barBoost, 'bars-4': 3, 'bars-5': 4.5 };
/** "A few centimetres": the brief's bound between 30 and 240 frames a second. */
const FEW_CM = 0.05;
/** The boost added where the let-go is keyed on the frames every rate shares (a sixth of a second: anywhere in its window). */
const COMMON_MORE = 1;

// ---- the figure: the bar's clip and its flight's twin on the game's own rig ---------------------------------------------------
/** A figure with the bar's tables measured off it and the flight's twin made (the player's `animateBar`, once a rig). */
function barFigure(): { F: Figure; tab: NonNullable<ReturnType<typeof measureBarTable>>; flight: NonNullable<ReturnType<typeof measureBarFlight>> } {
  const F = figure();
  const tab = measureBarTable(F.rig as never)!;
  const twin = F.rig.twinClip(BAR_CLIP_NAMES[BAR_CLIP], BAR_FLIGHT_NAME);
  const flight = measureBarFlight(F.rig as never)!;
  if (!tab || !twin || !flight) throw new Error('the bar\'s clip is not on the figure');
  return { F, tab, flight };
}
{
  const { F, flight } = barFigure();
  const twin = F.rig.actions.get(BAR_FLIGHT_NAME);
  const main = F.rig.actions.get(BAR_CLIP_NAMES[BAR_CLIP]);
  ok(!!twin && !!main && twin !== main && twin.getClip().tracks === main.getClip().tracks && F.rig.twinClip(BAR_CLIP_NAMES[BAR_CLIP], BAR_FLIGHT_NAME), `the flight plays the bar's clip's twin: its very tracks under a name of its own (${BAR_FLIGHT_NAME}), made once a rig`);
  flight.hipsAt(BAR_TIMES.release);
  const yr = flight.y;
  flight.hipsAt(BAR_TIMES.land);
  const yl = flight.y;
  ok(yr > 1.6 && yl > 0.8 && yl < 1.1, `the flight's table: the clip's hips ${yr.toFixed(2)} m over its floor at the release (frame 52), ${yl.toFixed(2)} m at the landing (frame 63), its feet on its floor there`);
}

// ---- a swing on the course's bars ----------------------------------------------------------------------------------------------
/** A running jump at a piece's first bar with E held (the course's run start), as maker A's suite takes it. */
function runJump(s: Stood, b: Body, fps: number): void {
  const dt = 1 / fps;
  b.key('KeyW', true);
  b.key('KeyE', true);
  let jumped = false;
  for (let i = 0; i < 4 * fps; i++) {
    const c = worldToCourse(s.frame, s.piece, b.pos.x, b.pos.y, b.pos.z, { x: 0, y: 0, z: 0 });
    if (!jumped && c.z >= 4.2) {
      b.key('Space', true);
      jumped = true;
    } else b.key('Space', false);
    b.frame(dt);
    if (b.bar.holding || b.ledge.holding) break;
  }
  b.key('KeyE', false);
  b.key('Space', false);
}

/** What a run along a piece's bars did: the bars caught (their z), the catches' places, the flights' ends, and the landing. */
interface Run {
  caught: number[];
  at: [number, number, number][];
  ends: string[];
  landed: boolean;
  landY: number;
  startY: number;
  hipsWorst: number;
  gripWorst: number;
  flewTwin: number;
  landedTwin: boolean;
}

/**
 * From the first bar, a player's swinging: W held to pump, Space on the forward swing between 32 and 50 degrees once the swing
 * is past 55, bar after bar until the body lands (or `most` seconds). With a figure, every frame drawn (the player's own lines,
 * maker A's `drawBar`), the flight's hips and the swing's grip measured against the body.
 */
async function swingAlong(id: string, fps: number, boost: number, F?: ReturnType<typeof barFigure>, most = 30): Promise<Run> {
  fresh();
  tuneClimb({ barBoost: boost });
  const s = await standPiece(climbCourse({ pieces: [id] }).pieces[0]);
  const { b } = bodyAt(s, 'run', fps);
  const startY = b.pos.y;
  const dt = 1 / fps;
  runJump(s, b, fps);
  const r: Run = { caught: [b.bar.bar.az], at: [], ends: [], landed: false, landY: Number.NaN, startY, hipsWorst: 0, gripWorst: 0, flewTwin: 0, landedTwin: false };
  if (F) b.bar.flight = F.flight;
  let caughtAt = b.bar.catches;
  let pressed = false;
  for (let i = 0; i < most * fps; i++) {
    const B = b.bar;
    const th = B.th * DEG;
    const amp = (B.report() as { amplitude: number }).amplitude;
    // (Off the last bar, as a player would for the platform a metre on: at the bottom of the swing, not its front.)
    const last = r.caught.length >= 3;
    const want = B.phase === BAR_SWING && amp > (last ? 40 : 55) && B.om > 0 && (last ? th > -10 && th < 10 : th > 32 && th < 50) && !pressed;
    b.key('KeyW', B.onBar && !want);
    b.key('Space', want);
    if (want) pressed = true;
    const was = B.holding;
    const flying = B.phase === BAR_FLY;
    b.frame(dt);
    if (F) {
      if (was) drawBar(b, F, dt);
      else F.F.rig.update(dt);
      // The flight's figure after its ease: the clip's hips at the flying body's middle (led to the frame's time), its twin playing.
      if (flying && B.phase === BAR_FLY && B.outT === 0) {
        const h = hipsOf(F.F);
        const lead = B as unknown as { leadX: number; leadY: number; leadZ: number };
        r.hipsWorst = Math.max(r.hipsWorst, Math.hypot(h.x - (b.pos.x + lead.leadX), h.y - (b.pos.y + 0.8 + lead.leadY), h.z - (b.pos.z + lead.leadZ)));
        if (F.F.rig.overrideName === BAR_FLIGHT_NAME) r.flewTwin++;
      }
      // The swing after a catch, its reach done: the drawn grip on the new bar.
      if (B.phase === BAR_SWING && B.catches > 0) {
        const g = gripOf(F.F);
        r.gripWorst = Math.max(r.gripWorst, Math.hypot(g.x - (B.bar.ax + B.bar.ux * B.s), g.y - (B.bar.ay + B.bar.uy * B.s), g.z - (B.bar.az + B.bar.uz * B.s)));
      }
      if (B.landNow && F.F.rig.overrideName === BAR_FLIGHT_NAME && F.F.rig.overrideAt() >= BAR_TIMES.land - 1e-6) r.landedTwin = true;
    }
    if (B.catches > caughtAt) {
      caughtAt = B.catches;
      r.caught.push(B.bar.az);
      r.at.push([B.fromX, B.fromY, B.fromZ]);
      r.ends.push(B.flyEnd);
      pressed = false;
    }
    if (was && !B.holding) {
      r.ends.push(B.flyEnd || 'let go');
      pressed = false;
    }
    if (!B.holding && b.grounded && r.ends.length > 0) {
      r.landed = true;
      r.landY = b.pos.y;
      break;
    }
  }
  b.key('KeyW', false);
  b.key('Space', false);
  return r;
}

const X = new THREE.Vector3(1, 0, 0);
const V = new THREE.Vector3();
const G = new THREE.Vector3();
const T3 = new THREE.Vector3();
/** The game's bar frame on the figure after the body's (the player's `animateBar` and `placeVisual`'s `applyBarRoot`). */
function drawBar(b: Body, F: ReturnType<typeof barFigure>, dt: number): void {
  const B = b.bar;
  B.flight = F.flight;
  B.placeFigure(F.tab, F.F.root.scale.y, b.pos);
  driveBarClips(F.F.rig as never, B as never, dt, F.F.hang);
  F.F.group.position.set(b.pos.x, b.pos.y, b.pos.z);
  F.F.group.rotation.set(0, B.heading, 0);
  const c = Math.cos(B.heading);
  const s = Math.sin(B.heading);
  F.F.root.position.set(B.offX * c - B.offZ * s, B.offY, B.offX * s + B.offZ * c);
  F.F.root.quaternion.setFromAxisAngle(X, B.tilt);
  F.F.group.updateMatrixWorld(true);
}
const hipsOf = (F: Figure): THREE.Vector3 => {
  let root: THREE.Object3D | null = null;
  F.root.traverse((o) => {
    if (!root && (o as THREE.Bone).isBone && !(o.parent as THREE.Bone).isBone) root = o;
  });
  return (root as unknown as THREE.Object3D).getWorldPosition(V);
};
const gripOf = (F: Figure): THREE.Vector3 => {
  G.set(0, 0, 0);
  for (const n of ['lWrist', 'lIndex01', 'rWrist', 'rIndex01']) G.add(F.rig.boneNamed(n)!.getWorldPosition(T3));
  return G.multiplyScalar(0.25);
};

{
  const rows: string[] = [];
  const cmp: string[] = [];
  let all = true;
  let alike = true;
  let poseOk = true;
  for (const id of ['bars-2', 'bars-3', 'bars-4', 'bars-5']) {
    const runs: Run[] = [];
    for (const fps of RATES) {
      const r = await swingAlong(id, fps, BOOST[id], fps === 60 ? barFigure() : undefined);
      runs.push(r);
      // Three bars along the pit: the first caught by the running jump, the second and third from the flights, then the landing on
      // the far platform (its top as high as the start's floor).
      const good = r.caught.length === 3 && r.ends.slice(0, 2).every((e) => e === 'caught') && r.ends[2] === 'land' && r.landed && Math.abs(r.landY - r.startY) < 0.05;
      all &&= good;
      if (fps === 60) poseOk &&= r.hipsWorst < 0.01 && r.gripWorst < 0.015 && r.flewTwin > 0 && r.landedTwin;
      if (!good || fps === 30 || fps === 240) rows.push(`${id}@${fps} (boost ${BOOST[id]}): bars ${r.caught.map((z) => z.toFixed(0)).join(', ')}, ${r.ends.join(' then ')}, the feet ${(r.landY - r.startY).toFixed(3)} m off the start's floor`);
      if (fps === 60) rows.push(`${id}@60 drawn: the flight's hips ${(r.hipsWorst * 1000).toFixed(1)} mm off the body's middle, the grip ${(r.gripWorst * 1000).toFixed(1)} mm off the caught bar`);
    }
    // Keyed off the swing's own angle as a player's would be, the catch at 30 and at 240 a frame's angle apart: within a few centimetres.
    const a = runs[0];
    const z = runs[3];
    // (From a running jump each rate's grab already differs, the movement's own jump: a note, the comparison is made below from
    // one state.)
    const d = (k: number) => Math.hypot(a.at[k][0] - z.at[k][0], a.at[k][1] - z.at[k][1], a.at[k][2] - z.at[k][2]);
    alike &&= a.at.length === z.at.length;
    cmp.push(`${id}: ${(d(0) * 100).toFixed(1)} and ${(d(1) * 100).toFixed(1)} cm`);
  }
  ok(all, `on bars-2 to bars-5, a running jump with E onto the first bar, W pumping, Space on the forward swing: the next bar caught at every spacing the sliders reach (the boost raised to 3 and 4.5 m/s for 4 and 5 m), bar after bar, and off the last at the swing's bottom a landing on the far platform, at every rate (${rows.filter((x) => !x.includes('drawn')).join('; ')})`);
  ok(alike, `as many catches at 30 as at 240 frames a second (their places a running jump's grab apart, the movement's own jump differing by rate: ${cmp.join(', ')})`);
  ok(poseOk, `the flight's twin plays from the release, its hips drawn at the flying body's middle within a centimetre once eased; after a catch's reach the drawn grip is on the new bar; a landing plays the clip's own landing from frame 63 (${rows.filter((x) => x.includes('drawn')).join('; ')})`);
}

// ---- step for step the same at every rate ---------------------------------------------------------------------------------------
{
  // From a still hang on the first bar at a whole second, the physics' remainder put three tenths of a step in (maker A's trick:
  // no step's boundary on any rate's frame), the keys changed only on frames every rate stands at (a sixth of a second): W for six
  // seconds, then Space on the first such frame the swing goes forward between 10 and 60 degrees. Every rate's flight and catch
  // are the same steps.
  // And from the same state with Space keyed off the swing's own angle on each rate's own frames, as a player's press would be
  // (forward between 32 and 50 degrees): the press seen a frame of that rate late at most, the catch within a few centimetres.
  type Caught = { at: [number, number, number]; step: number; caught: boolean; end: string };
  async function fromOneState(id: string, fps: number, keyed: 'common' | 'frame'): Promise<Caught> {
    fresh();
    // (Keyed on a sixth of a second the let-go falls anywhere in the window, so a little more boost there to reach the bar.)
    tuneClimb({ barBoost: BOOST[id] + (keyed === 'common' ? COMMON_MORE : 0) });
    const s = await standPiece(climbCourse({ pieces: [id] }).pieces[0]);
    const { b } = bodyAt(s, 'run', fps);
    const dt = 1 / fps;
    runJump(s, b, fps);
    for (let i = 0; i < 2 * fps; i++) b.frame(dt);
    (b.physics as unknown as { acc: number }).acc = 0.3 * FIXED_DT;
    b.bar.th = 0;
    b.bar.om = 0;
    b.bar.s = 2;
    const s0 = b.physics.steps;
    const sixth = fps / 6;
    b.key('KeyW', true);
    for (let i = 0; i < 6 * fps; i++) b.frame(dt);
    // (W still held while waiting for the swing's front, so it stays at its largest; let go of with Space.)
    let gone = false;
    let end = '';
    let at: [number, number, number] = [Number.NaN, Number.NaN, Number.NaN];
    let step = -1;
    for (let k = 0; k < 60 * (keyed === 'frame' ? sixth : 1); k++) {
      const th = b.bar.th * DEG;
      const go = !gone && b.bar.phase === BAR_SWING && b.bar.om > 0 && th > 30 && th < 52;
      b.key('Space', go);
      if (go) {
        gone = true;
        b.key('KeyW', false);
      }
      for (let i = 0; i < (keyed === 'common' ? sixth : 1) && !end; i++) {
        const was = b.bar.phase === BAR_FLY;
        b.frame(dt);
        b.key('Space', false);
        // (Where the flight ended: a catch's body there, else the body where the flight left it, the step it did.)
        if (was && b.bar.phase !== BAR_FLY) {
          end = b.bar.flyEnd;
          at = end === 'caught' ? [b.bar.fromX, b.bar.fromY, b.bar.fromZ] : [b.pos.x, b.pos.y, b.pos.z];
          step = b.physics.steps - s0;
        }
      }
      if (end) break;
    }
    return { at, step, caught: end === 'caught', end };
  }
  const ids = ['bars-2', 'bars-3', 'bars-4', 'bars-5'];
  const common: Caught[][] = [];
  const frame: Caught[][] = [];
  for (const fps of RATES) {
    const c: Caught[] = [];
    const f: Caught[] = [];
    for (const id of ids) {
      c.push(await fromOneState(id, fps, 'common'));
      f.push(await fromOneState(id, fps, 'frame'));
    }
    common.push(c);
    frame.push(f);
  }
  let worst = 0;
  for (const per of common) for (let k = 0; k < per.length; k++) worst = Math.max(worst, ...per[k].at.map((v, j) => Math.abs(v - common[1][k].at[j])));
  // (The step count is read at a frame's end, which at 30 a second stands a step past a catch on the frame's first.)
  const sameEnds = common.every((per) => per.every((x, k) => x.end !== '' && x.end === common[1][k].end && Math.abs(x.step - common[1][k].step) <= 2));
  ok(sameEnds && worst < 1e-6, `from one state with the keys on the same steps, every rate's flight off a bar ends the same way at the same place, to ${worst.toExponential(1)} m (${ids.map((id, k) => `${id} ${common[1][k].end} by step ${common[1][k].step}`).join(', ')})`);
  const apart = ids.map((_, k) => Math.hypot(frame[0][k].at[0] - frame[3][k].at[0], frame[0][k].at[1] - frame[3][k].at[1], frame[0][k].at[2] - frame[3][k].at[2]));
  ok(frame.every((per) => per.every((x) => x.caught)), `from the same state with Space keyed off the swing's angle on each rate's own frames, as a player's press, the next bar caught at every rate`);
  // (A press is seen at a frame's start: at 30 a second up to a thirtieth late, which at the swing's 3 to 4 m/s is a let-go
  // 10 to 13 cm further round the swing, carried through the flight. The flight and the catch add nothing: the same press
  // moment is the same catch to the bit, above. A note, not a bound: the brief's few centimetres hold for the same press.)
  note(`a player's press keyed off the swing's angle on each rate's own frames: the catch at 30 and at 240 frames a second ${ids.map((id, k) => `${id} ${(apart[k] * 100).toFixed(1)} cm`).join(', ')} apart (the press seen up to a thirtieth of a second apart; the same press moment is the same catch, above)`);
  void FEW_CM;
}

// ---- short of the next: falling and landing ------------------------------------------------------------------------------------
{
  const rows: string[] = [];
  let falls = true;
  for (const fps of RATES) {
    fresh();
    const s = await standPiece(climbCourse({ pieces: ['bars-4'] }).pieces[0]);
    const { b } = bodyAt(s, 'run', fps);
    const startY = b.pos.y;
    const dt = 1 / fps;
    runJump(s, b, fps);
    b.key('KeyW', true);
    for (let i = 0; i < 6 * fps; i++) b.frame(dt);
    let gone = false;
    let end = '';
    let lowest = Infinity;
    for (let i = 0; i < 8 * fps; i++) {
      const th = b.bar.th * DEG;
      const go = !gone && b.bar.phase === BAR_SWING && b.bar.om > 0 && th > 32 && th < 50;
      b.key('Space', go);
      if (go) {
        gone = true;
        b.key('KeyW', false);
      }
      const was = b.bar.holding;
      b.frame(dt);
      if (was && !b.bar.holding) end = b.bar.flyEnd;
      lowest = Math.min(lowest, b.pos.y);
      if (gone && !b.bar.holding && b.grounded) break;
    }
    b.key('Space', false);
    const ok1 = end === 'fall' && b.bar.catches === 0 && b.grounded && !b.bar.holding && startY - b.pos.y > 2.5;
    falls &&= ok1;
    rows.push(`${fps}: ${end}, on the pit's floor ${(startY - b.pos.y).toFixed(2)} m under the start`);
  }
  ok(falls, `a bar let go short of the next (4 m at the start's boost): nothing caught, the body handed to the movement falling past a grab, and landing on the pit's floor (${rows.join('; ')})`);
}

// ---- the crouch, 'plain', a hard blow, the water, a wall ----------------------------------------------------------------------
/** A world with a bar `y` m over open ground across x at z 0 (and `more`). */
async function barWorld(y: number, more?: (p: Phys) => void): Promise<Phys> {
  const p = await makePhysics();
  ground(p, 0);
  p.world.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.035, 0.035).setTranslation(0, y, 0));
  more?.(p);
  p.stepOnce();
  return p;
}
async function hang(fps: number, y = 2.2, more?: (p: Phys) => void): Promise<Body> {
  const p = await barWorld(y, more);
  (p as unknown as { acc: number }).acc = 0;
  const b = new TestBody(p);
  b.jka.forceLevel = 0;
  b.place(0, 0, 0);
  b.forward.set(0, 0, 1);
  b.right.set(-1, 0, 0);
  b.heading = 0;
  b.run(fps, 0.5);
  b.key('KeyE', true);
  b.frame(1 / fps);
  b.key('KeyE', false);
  b.run(fps, 0.5);
  return b;
}
/** W held until the swing goes forward past `deg`, then `key` pressed for a frame. */
function pumpAndPress(b: Body, fps: number, key: string, deg = 30): void {
  const dt = 1 / fps;
  b.key('KeyW', true);
  for (let i = 0; i < 4 * fps; i++) b.frame(dt);
  for (let i = 0; i < 4 * fps; i++) {
    if (b.bar.phase === BAR_SWING && b.bar.om > 0 && b.bar.th * DEG > deg) break;
    b.frame(dt);
  }
  b.key('KeyW', false);
  b.key(key, true);
  b.frame(dt);
  b.key(key, false);
}
{
  const rows: string[] = [];
  let dropOk = true;
  let plainOk = true;
  let knockOk = true;
  let waterOk = true;
  let wallOk = true;
  let landOk = true;
  let railOk = true;
  for (const fps of RATES) {
    const dt = 1 / fps;
    // The crouch on a still hang: straight down, no flight, landing under the bar.
    {
      const b = await hang(fps);
      b.key('ControlLeft', true);
      b.frame(dt);
      b.key('ControlLeft', false);
      const off = !b.bar.holding && b.bar.flights === 0 && Math.hypot(b.vel.x, b.vel.z) < 1e-9;
      b.run(fps, 1);
      dropOk &&= off && b.grounded && Math.hypot(b.pos.x, b.pos.z) < 0.05;
      if (fps === 60) rows.push(`crouch: ${off ? 'off straight down' : 'not'}, landed ${Math.hypot(b.pos.x, b.pos.z).toFixed(3)} m from under the bar`);
    }
    // 'plain': Space hands the body the swing's own velocity and no flight (maker A's let-go).
    {
      tuneClimb({ barFlight: 'plain' });
      const b = await hang(fps);
      pumpAndPress(b, fps, 'Space');
      const v = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
      plainOk &&= !b.bar.holding && b.bar.flights === 0 && v > 1;
      fresh();
    }
    // A blow of the knock's size off a swing (the harness's own harm rule, as the player's takeDamage); a smaller one keeps it.
    {
      const b = await hang(fps);
      b.takeDamage(10, false, 'blow');
      b.frame(dt);
      const kept = b.bar.onBar;
      b.takeDamage(CLIMB_TUNE.barKnock, false, 'blow');
      b.frame(dt);
      knockOk &&= kept && !b.bar.holding && b.bar.flights === 0 && Math.hypot(b.vel.x, b.vel.z) < 1e-9;
      if (fps === 60) rows.push(`a blow of 10 kept the bar (${kept}), one of ${CLIMB_TUNE.barKnock} knocked the body off (${!b.bar.holding})`);
    }
    // Water under the bar 1.4 m deep: Space's flight ends in it and the body swims.
    {
      const b = await hang(fps);
      b.surface = () => 1.4;
      pumpAndPress(b, fps, 'Space', 10);
      let end = '';
      for (let i = 0; i < 2 * fps && !end; i++) {
        const was = b.bar.holding;
        b.frame(dt);
        if (was && !b.bar.holding) end = b.bar.flyEnd;
      }
      for (let i = 0; i < 3; i++) b.frame(dt);
      waterOk &&= end === 'water' && b.swimming && b.bar.landings === 0;
      if (fps === 60) rows.push(`water: the flight ended "${end}", swimming ${b.swimming}`);
    }
    // A wall from the ground to 3 m up, its face 1.45 m ahead of the bar (clear of the largest swing's capsule, 1.31 m): the
    // flight meets it before the feet meet the ground, the falling clips (no landing), the capsule never in it.
    {
      const b = await hang(fps, 2.2, (q) => box(q, [-3, 0, 1.45], [3, 3, 2], false));
      pumpAndPress(b, fps, 'Space', 10);
      let end = '';
      let deepest = 0;
      for (let i = 0; i < 2 * fps; i++) {
        const was = b.bar.holding;
        b.frame(dt);
        if (was && !b.bar.holding && !end) end = b.bar.flyEnd;
        deepest = Math.max(deepest, b.pos.z + 0.35 - 1.45);
      }
      wallOk &&= end === 'wall' && deepest < 0.02 && b.bar.landings === 0;
      if (fps === 60 || !(end === 'wall' && deepest < 0.02 && b.bar.landings === 0)) rows.push(`a wall ahead: the flight ended "${end}", the capsule's front ${(deepest * 100).toFixed(1)} cm into it at the most`);
    }
    // Ground under the flight (a bar 2.2 m over open ground, a let-go low on the swing): the clip's landing (no catch, no fall).
    {
      const b = await hang(fps);
      pumpAndPress(b, fps, 'Space', 10);
      let end = '';
      for (let i = 0; i < 2 * fps && !end; i++) {
        const was = b.bar.holding;
        b.frame(dt);
        if (was && !b.bar.holding) end = b.bar.flyEnd;
      }
      b.run(fps, 0.5);
      landOk &&= end === 'land' && b.bar.landings === 1 && b.grounded && b.pos.y < 0.05;
      if (fps === 60) rows.push(`over open ground: the flight ended "${end}", the feet ${b.pos.y.toFixed(3)} m up`);
    }
    // The fix round's: a thin rail across the flight's way at the hips' height, and a lower bar at the chest's (each bar-shaped,
    // under the hands: nothing the hands catch): the flight meets each as it meets a wall, the capsule never through it.
    for (const [what, y] of [
      ['a rail', 0.9],
      ['a lower bar', 1.2],
    ] as const) {
      const b = await hang(fps, 2.2, (q) => q.world.createCollider(RAPIER.ColliderDesc.cuboid(3, 0.03, 0.03).setTranslation(0, y, 1.2)));
      pumpAndPress(b, fps, 'Space', 40);
      const flew = b.bar.flights === 1;
      let end = '';
      let through = false;
      let deepest = 0;
      // (Measured while the bar holds the body, the flight and its last frame: what the movement does with the body after it,
      // stepping or sliding over a rail a few centimetres over the feet, is the movement's own.)
      for (let i = 0; i < 2 * fps; i++) {
        const was = b.bar.holding;
        b.frame(dt);
        if (was && !b.bar.holding && !end) end = b.bar.flyEnd;
        if (!was && !b.bar.holding) continue;
        // The capsule's segment (its middle 0.8 m over the feet, 0.45 either way) against the rod's axis (0.03 thick).
        const yc = Math.max(b.pos.y + 0.35, Math.min(b.pos.y + 1.25, y));
        const gap = Math.hypot(b.pos.z - 1.2, yc - y) - 0.35 - 0.03;
        deepest = Math.max(deepest, -gap);
        if (b.pos.z > 1.2 && b.pos.y + 0.35 < y && b.pos.y + 1.25 > y) through = true;
      }
      const good = flew && end === 'wall' && !through && deepest < 0.02 && b.bar.catches === 0;
      railOk &&= good;
      if (fps === 60 || !good) rows.push(`${what} ${y} m up across the flight at ${fps} fps: the flight ended "${end}", through it ${through}, the capsule ${(deepest * 100).toFixed(1)} cm into it at the most`);
    }
  }
  ok(railOk, `a thin rail and a lower bar across the flight (bar-shaped, under the hands) stop it as a wall does, the capsule never through either, at every rate (${rows.filter((x) => x.includes('across the flight')).join('; ')})`);
  ok(dropOk, 'the crouch key drops straight down off the bar: no flight, no level speed, landing under it, at every rate');
  ok(plainOk, 'under `climb.barFlight` \'plain\' Space is maker A\'s let-go: the swing\'s own velocity handed to the movement, no flight');
  ok(knockOk, `a blow of climb.barKnock (${CLIMB_TUNE.barKnock}) or more knocks the body off, straight down; a smaller one keeps the bar, at every rate`);
  ok(waterOk, 'a flight off a bar into water ends there and the body swims, at every rate');
  ok(wallOk, `a flight into a wall ends against it (the capsule never in it) with the falling clips, at every rate (${rows.filter((x) => x.startsWith('a wall')).join('; ')})`);
  ok(landOk, `a flight that meets ground under the feet is a landing (the clip's own, frame 63 on), at every rate (${rows.join('; ')})`);
}

// ---- another player's game, and the action bar ---------------------------------------------------------------------------------
{
  // On a still hang, the place the wire carries for a free hang (`peerPlace`): another player's game stands its free hang there
  // (`PeerHang`, its root lined up as the hang's own rule), and its drawn hands are on the grip.
  const b = await hang(60);
  const at = b.bar.peerPlace(new THREE.Vector3());
  const P = figure();
  P.rig.setState('hangFree' as never, 0, null);
  P.rig.update(0.4);
  P.group.position.copy(at);
  P.group.rotation.set(0, b.bar.heading, 0);
  P.root.position.set(0, 0, 0);
  P.group.updateMatrixWorld(true);
  const h = new PeerHang(() => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }), (hh, rr) => new RAPIER.Capsule(hh, rr));
  const q = new PeerHangIn();
  q.state = 'hangFree';
  q.x = at.x;
  q.y = at.y;
  q.z = at.z;
  q.heading = b.bar.heading;
  q.scale = 1;
  q.dt = 1 / 60;
  h.step(P.rig as never, null, q);
  P.group.updateMatrixWorld(true);
  const g = gripOf(P);
  const B = b.bar;
  const off = Math.hypot(g.x - (B.bar.ax + B.bar.ux * B.s), g.y - (B.bar.ay + B.bar.uy * B.s), g.z - (B.bar.az + B.bar.uz * B.s));
  ok(off < 0.12, `another player's game, told a free hang at the bar's \`peerPlace\` (the wire carries no swing), draws its hands ${(off * 100).toFixed(1)} cm off the grip: the nearest pose it has`);
  const F = barFigure();
  drawBar(b, F, 1 / 60);
  b.frame(1 / 60);
  drawBar(b, F, 1 / 60);
  ok(F.F.rig.describe().state === 'hangFree', 'with the hands on the bar the rig\'s state (what the wire carries) is the free hang\'s, under the bar\'s clip');

  const s = newPromptState();
  const out = Array.from({ length: 4 }, () => ({ action: '', code: '', label: '' }));
  const fill = (fields: Partial<typeof s>) => {
    Object.assign(s, newPromptState(), { live: true }, fields);
    const n = fillActions(s, out);
    return out.slice(0, n).map((a) => `${a.action}:${a.label}`);
  };
  const onBar = fill({ bar: 'hang' });
  const flying = fill({ bar: 'fly' });
  const ground1 = fill({ climb: 'ground', climbBar: true });
  const air = fill({ climb: 'air', climbBar: true, near: 'mount' });
  const lip = fill({ climb: 'ground' });
  ok(onBar.join(',') === `jump:${PROMPT_WORDS.barLetGo},crouch:${PROMPT_WORDS.barDrop}` && flying.length === 0, `on a bar the bar offers Space ${PROMPT_WORDS.barLetGo} and the crouch ${PROMPT_WORDS.barDrop} (${onBar.join(', ')}); in the flight nothing`);
  ok(ground1.join(',') === `mount:${PROMPT_WORDS.grabBar}` && air[0] === `mount:${PROMPT_WORDS.grabBar}` && lip.join(',') === `mount:${PROMPT_WORDS.climb}`, `a bar in reach is E ${PROMPT_WORDS.grabBar} where a lip is E ${PROMPT_WORDS.climb}, first while falling and last otherwise, as the climb's own`);
}

// ---- the switches' other settings, and the hand-overs ---------------------------------------------------------------------------
{
  climbSmooth3Before();
  const before = CLIMB_TUNE.barFlight === CLIMB_BARS_BEFORE.barFlight && CLIMB_BARS_BEFORE.barFlight === 'plain' && CLIMB_TUNE.bars === 'off';
  fresh();
  ok(before && CLIMB_TUNE.barFlight === 'fly', 'Smoothness III\'s put back (every older round\'s chain) puts the flight to \'plain\' with the bars \'off\'; the game ships it \'fly\'');
  const text = (f: string) => readFileSync(join(REPO, f), 'utf8').replace(/\r\n/g, '\n');
  const player = text('src/player/player.ts');
  const harness = text('tools/swg/tests/grappleBody.ts');
  const clips = text('src/player/hangClips.ts');
  const main = text('src/main.ts');
  const knock = 'if (this.hp < this.barHp) B.knock(this.barHp - this.hp);\n    this.barHp = this.hp;';
  ok(player.includes(knock) && harness.includes(knock), 'the player and the harness both knock the body off a bar by the health lost since its last frame on it');
  ok(/B\.swimLine = flat \+ world\.seaSwellOverFlat\(this\.pos\.x, this\.pos\.z, flat\) - SWIM_DEPTH;/.test(player) && /B\.swimLine = this\.surface\(this\.pos\.x, this\.pos\.z, this\.t\) - SWIM_DEPTH;/.test(harness), 'and hand the flight the water\'s swim line (the swim\'s own surface and depth) before it steps');
  ok(/this\.jka\.holdApex\(B\.apexY\);/.test(player) && /this\.jka\.holdApex\(B\.apexY\);/.test(harness), 'and hold the fall\'s memory where the bar says (the flight\'s top while flying), so a fall off a flight counts from its top');
  ok(/rig\.twinClip\(BAR_CLIP_NAMES\[BAR_CLIP\], BAR_FLIGHT_NAME\);\n        this\.barFlight = measureBarFlight\(rig\);/.test(player) && /this\.bar\.flight = this\.barTableRig === rig \? this\.barFlight : null;\n    this\.bar\.placeFigure\(/.test(player), 'the player makes the flight\'s twin and measures its table once a rig, and hands the bar the table before it places the figure');
  ok(/else if \(B\.landNow\) rig\.play\(B\.clipName, \{ from: BAR_TIMES\.land, fadeIn: BAR_LAND_FADE, hold: false, timeScale: 1,/.test(clips) && /rig\.setState\(B\.onBar \? 'hangFree' : 'air', 0, null, st\.hangFade\);/.test(clips) && BAR_LAND_FADE > 0, 'the hand-over plays a landing from frame 63 on the flight\'s twin, and stands the rig\'s state at the free hang\'s while the hands are on the bar');
  ok(main.includes(": p.bar.onBar && !p.aboard ? p.bar.peerPlace(leanedAt) : p.worldPos;") && main.includes('s.bar = p.bar.promptWord();') && main.includes("s.climbBar = s.climb !== '' && p.reachBar;"), 'the game sends the free hang\'s place while on a bar, and gathers the bar\'s words for the action bar');
  void BAR_GRAB;
  void BAR_NONE;
  void BAR_FACTS;
}
console.log(`climbBarsFly: ${checks} checks passed`);
