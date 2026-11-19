// Climbing II, the feedback round II, maker B's items on the game's own rig (tools/swg/tests/climbFigure.ts's figure: the game's
// hang hand-over `driveHangClips`, the ledge's own limbs, the limbs' own solve and the climb's sphere clearing), driven frame by
// frame through the grapple's harness on the real Rapier and the course's own pieces at 30, 60, 144 and 240 frames a second:
//  - 0d (`climb.freeCue` 'pull'): on a free hang (free-ladder-1.25's R0), W held cues the hop up as a small pull-up: the hands on
//    the grip within 2 cm all through it, the figure's hips risen `freeCueRise` over where the plain hang has them, eased in over
//    `freeCueIn` and back down when W is let go; then W and Space: the hop up as before (the body's every frame as under 'arms'),
//    started from where the cue left the figure (its hips moving no faster than a metre a second through the commit). 'arms':
//    today's, the hands off the grip and the body never rising;
//  - 0e (`climb.freeHopLegs` 'kick'): through that hop up, the free hang climb's leg kick laid under the hop's arms and the hips'
//    sway fed by the hop; 'stiff': none of either;
//  - 0f (`climb.ladderSway` 'sway'): up four rungs and down a free and a braced ladder, the hips' lag measured (a start lags, a stop
//    overshoots and settles), on the free one the free hang shimmy's legs laid one shimmy step a reach of the cycle, on the braced
//    one the feet kept where they stand without the sway (within a centimetre while the pelvis moves); 'stiff': nothing;
//  - 0g (`climb.freeBehind` 'reach'): a free hang looking back over its shoulder on free-gap-behind-2.0 and 3.0, W and Space,
//    jumps to the lip behind and catches it; 'side': it never does.
// Each alike at the four rates.
//
// Run: node tools/swg/tests/climbFb2Ledge.test.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { figure, figureScale, drawHang, HAVE_BODY, type Figure } from './climbFigure.ts';

const { climbCourse } = await import('../../../src/anim/climbCourse.ts');
const { CLIMB_TUNE, resetClimbTune, tuneClimb, LADDER_SWAY_LEGS } = await import('../../../src/anim/climbTune.ts');
const { resetMoveTune } = await import('../../../src/anim/moveTune.ts');
const { LEDGE_FACTS } = await import('../../../src/anim/ledgeClips.ts');
const { LEDGE_HANG, LEDGE_MOVE, SWAY_STEP } = await import('../../../src/player/ledge.ts');
const { FIXED_DT } = await import('../../../src/core/physics.ts');
const { bodyAt, nearestLip, runUntil, standPiece, tap, LOOK_BACK_DEG, RATES } = await import('./climbCourseBody.ts');
type TestBody = import('./grappleBody.ts').TestBody;
type Stood = import('./climbCourseBody.ts').Stood;

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
if (!HAVE_BODY) note('no converted human male here: the figure is the tests\' own skeleton');
const piece = (id: string) => climbCourse({ extras: true, pieces: [id] }).pieces[0];
const hangs = (b: TestBody) => b.ledge.phase === LEDGE_HANG;
const nameOf = (s: Stood, b: TestBody) => (b.ledge.holding ? nearestLip(s, b.ledge.lip.ex, b.ledge.lip.ey, b.ledge.lip.ez).name : '-');
const G = new THREE.Vector3();
const P = new THREE.Vector3();
const Q = new THREE.Vector3();
const bone = (F: Figure, name: string) => F.bones.find((b) => b.name === name)!;
/** The worst a placed hand (weight 0.99 or more) stands off its place on the grip now, metres. */
function handsOff(F: Figure): number {
  let worst = 0;
  for (let k = 0; k < 2; k++) {
    if (F.lp.handW[k] < 0.99) continue;
    const g = F.lp.gripNow(F.rig as never, k, null, G);
    if (g) worst = Math.max(worst, Math.hypot(g.x - F.lp.hand[k * 3], g.y - F.lp.hand[k * 3 + 1], g.z - F.lp.hand[k * 3 + 2]));
  }
  return worst;
}
const hipsY = (F: Figure) => bone(F, 'root').getWorldPosition(P).y;

ok(SWAY_STEP === FIXED_DT, `the sway is stepped on the physics' own step (${SWAY_STEP} s, FIXED_DT ${FIXED_DT})`);

/** A body grabbing the first lip of a piece with E and Space, the figure drawn every frame it holds; `each` after every frame. */
async function onPiece(id: string, start: string, fps: number, each: (b: TestBody, F: Figure) => void): Promise<{ s: Stood; b: TestBody; F: Figure }> {
  const s = await standPiece(piece(id));
  const { b } = bodyAt(s, start, fps);
  const F = figure();
  b.ledgeScale = figureScale(F);
  const draw = b.frame.bind(b);
  b.frame = (t: number) => {
    draw(t);
    if (b.ledge.holding) drawHang(b, F, 1 / fps);
    each(b, F);
  };
  b.key('KeyE', true);
  tap(b, 'Space', fps);
  runUntil(b, fps, 2.5, () => hangs(b));
  b.key('KeyE', false);
  runUntil(b, fps, 0.6, () => false);
  b.forward.set(Math.sin(b.ledge.heading), 0, Math.cos(b.ledge.heading));
  b.right.set(-Math.cos(b.ledge.heading), 0, Math.sin(b.ledge.heading));
  return { s, b, F };
}

// ---- 0d and 0e: the free hang's up cue, and the free hop up it commits to -----------------------------------------------------
interface CueRun {
  grabbed: boolean;
  rest: number;
  risen: number;
  back: number;
  handsWorst: number;
  riseFrames: number;
  backIn: number;
  hopped: string;
  path: number[];
  commitSpeed: number;
  kickFrames: number;
  kickMost: number;
  swayMost: number;
  handsWAtRise: number;
  scale: number;
}
async function cueRun(fps: number, mode: 'shipped' | 'before'): Promise<CueRun> {
  resetClimbTune();
  resetMoveTune();
  if (mode === 'before') tuneClimb({ freeCue: 'arms', freeHopLegs: 'stiff', ladderSway: 'stiff' });
  const R: CueRun = { grabbed: false, rest: 0, risen: 0, back: 0, handsWorst: 0, riseFrames: 0, backIn: Infinity, hopped: '', path: [], commitSpeed: 0, kickFrames: 0, kickMost: 0, swayMost: 0, handsWAtRise: 1, scale: 1 };
  let phase = 'pre';
  let lastHips = Number.NaN;
  let commitT = -1;
  let t = 0;
  let restSum = 0;
  let restN = 0;
  const { s, b, F } = await onPiece('free-ladder-1.25', 'stand', fps, (bb, FF) => {
    t += 1 / fps;
    const L = bb.ledge;
    if (!L.holding) return;
    const h = hipsY(FF);
    if (phase === 'rest') {
      restSum += h;
      restN++;
    }
    if (phase === 'cue' && L.cueRise > 0) {
      R.riseFrames++;
      R.handsWorst = Math.max(R.handsWorst, handsOff(FF));
      R.handsWAtRise = Math.min(R.handsWAtRise, FF.lp.handW[0], FF.lp.handW[1]);
      if (L.cueRise >= 1) R.risen = Math.max(R.risen, h);
    }
    if (phase === 'back' && L.cueRise === 0 && R.backIn === Infinity) R.backIn = t;
    if (phase === 'back') R.back = h;
    if (phase === 'hop') {
      R.path.push(bb.pos.x, bb.pos.y, bb.pos.z);
      if (L.phase === LEDGE_MOVE && commitT < 0) commitT = t;
      if (commitT >= 0 && t - commitT <= 0.3 && lastHips === lastHips) R.commitSpeed = Math.max(R.commitSpeed, Math.abs(h - lastHips) * fps);
      if (FF.lp.legsLaid) {
        R.kickFrames++;
        R.kickMost = Math.max(R.kickMost, FF.lp.legsMoved);
      }
      R.swayMost = Math.max(R.swayMost, Math.hypot(L.swayX, L.swayY, L.swayZ));
    }
    lastHips = h;
  });
  R.grabbed = hangs(b);
  R.scale = b.ledgeScale;
  phase = 'rest';
  runUntil(b, fps, 0.4, () => false);
  R.rest = restN > 0 ? restSum / restN : Number.NaN;
  phase = 'cue';
  b.key('KeyW', true);
  runUntil(b, fps, 1, () => false);
  b.key('KeyW', false);
  phase = 'back';
  t = 0;
  runUntil(b, fps, 0.6, () => false);
  phase = 'rest2';
  runUntil(b, fps, 0.2, () => false);
  b.key('KeyW', true);
  phase = 'cue';
  runUntil(b, fps, 1, () => false);
  phase = 'hop';
  t = 0;
  tap(b, 'Space', fps);
  b.key('KeyW', false);
  runUntil(b, fps, 3, () => false);
  R.hopped = nameOf(s, b);
  b.physics.world.removeRigidBody(b.body);
  return R;
}

const cueRows: string[] = [];
const kickMosts: number[] = [];
for (const fps of RATES) {
  const R = await cueRun(fps, 'shipped');
  const B = await cueRun(fps, 'before');
  const words = `free-ladder-1.25 @${fps}`;
  const want = CLIMB_TUNE.freeCueRise * R.scale;
  ok(R.grabbed && B.grabbed, `${words}: grabbed R0 under both settings`);
  ok(R.riseFrames > 0 && R.handsWorst <= 0.02 && R.handsWAtRise >= 0.99, `${words}, 'pull': the hands wholly on the grip and within 2 cm of it all through the cue (worst ${(R.handsWorst * 100).toFixed(2)} cm over ${R.riseFrames} frames)`);
  const rise = R.risen - R.rest;
  ok(Math.abs(rise - want) <= 0.01, `${words}, 'pull': the hips risen ${(rise * 100).toFixed(1)} cm over the plain hang's at the rise's full share (freeCueRise ${(want * 100).toFixed(1)} cm, within 1 cm)`);
  ok(Math.abs(R.back - R.rest) <= 0.01 && R.backIn <= CLIMB_TUNE.freeCueIn + 0.05, `${words}, 'pull': W let go, the hips back down within ${(R.backIn).toFixed(2)} s (freeCueIn ${CLIMB_TUNE.freeCueIn} s) to ${((R.back - R.rest) * 100).toFixed(2)} cm of the plain hang's`);
  ok(R.hopped === 'R1' && B.hopped === 'R1', `${words}: W and Space hop R0 to R1 under both (${R.hopped}, ${B.hopped})`);
  let same = R.path.length === B.path.length;
  for (let i = 0; same && i < R.path.length; i++) same = Object.is(R.path[i], B.path[i]);
  ok(same, `${words}: the hop's body every frame as under 'arms' (the commit as before; ${R.path.length / 3} frames)`);
  ok(R.commitSpeed <= 1, `${words}, 'pull': the hop starts from where the cue left the figure: its hips through the commit's first 0.3 s at most ${R.commitSpeed.toFixed(2)} m/s (no drop)`);
  ok(B.riseFrames === 0 && Math.abs(B.risen) === 0, `${words}, 'arms': no rise at all, as before`);
  ok(R.kickFrames > 0 && R.kickMost >= 0.2 && R.swayMost > 0.01, `${words}, 'kick': the free hang climb's leg kick laid under the hop's arms (${R.kickFrames} frames, the feet carried ${(R.kickMost * 100).toFixed(1)} cm at most) and the hips' sway fed (${(R.swayMost * 100).toFixed(1)} cm of lag at most)`);
  ok(B.kickFrames === 0 && B.swayMost === 0, `${words}, 'stiff': no legs laid and no sway (${B.kickFrames} frames, ${B.swayMost})`);
  kickMosts.push(R.kickMost);
  cueRows.push(`${fps}: risen ${(rise * 100).toFixed(1)} cm, hands ${(R.handsWorst * 100).toFixed(2)} cm, commit ${R.commitSpeed.toFixed(2)} m/s, kick ${(R.kickMost * 100).toFixed(1)} cm, sway ${(R.swayMost * 100).toFixed(1)} cm`);
}
ok(Math.max(...kickMosts) - Math.min(...kickMosts) <= 0.08, `the kick alike at the four rates (${cueRows.join('; ')})`);

// ---- 0f: the ladders' sway -------------------------------------------------------------------------------------------------------
interface LadderRun {
  seen: string[];
  lagMost: number;
  overshoot: boolean;
  settled: number;
  legsFrames: number;
  phaseOff: number;
  ankles: number[];
  pelvis: number[];
  movedMost: number;
}
async function ladderRun(id: string, fps: number, mode: 'sway' | 'stiff' | 'zero'): Promise<LadderRun> {
  resetClimbTune();
  resetMoveTune();
  if (mode === 'stiff') tuneClimb({ ladderSway: 'stiff' });
  if (mode === 'zero') tuneClimb({ swayAmount: 0 });
  const R: LadderRun = { seen: [], lagMost: 0, overshoot: false, settled: 0, legsFrames: 0, phaseOff: 0, ankles: [], pelvis: [], movedMost: 0 };
  let climbing = false;
  let stopped = -1;
  let t = 0;
  let upLag = 0;
  const shimDur = LEDGE_FACTS[LADDER_SWAY_LEGS].dur;
  let st: Stood | null = null;
  const { s, b } = await onPiece(id, 'stand', fps, (bb, FF) => {
    t += 1 / fps;
    const L = bb.ledge;
    if (!L.holding || !st) return;
    const n = nameOf(st, bb);
    if (hangs(bb) && R.seen[R.seen.length - 1] !== n) R.seen.push(n);
    const lag = Math.hypot(L.swayX, L.swayY, L.swayZ);
    R.lagMost = Math.max(R.lagMost, lag);
    if (climbing && L.swayY < upLag) upLag = L.swayY;
    if (stopped >= 0 && L.swayY > 0.002) R.overshoot = true;
    // (Settled: the last moment the lag stood over a millimetre, from the key let go: a crossing through nought is no settling.)
    if (stopped >= 0 && lag >= 0.001) R.settled = t - stopped;
    R.movedMost = Math.max(R.movedMost, FF.lp.legsMoved);
    // The free ladder's shimmy legs: one shimmy cycle a climb cycle (the legs' own seconds against the cycle's phase).
    const lx = L as unknown as { legId: string; legAt: number; upperSeek: number; cycDur: number };
    if (lx.legId === LADDER_SWAY_LEGS && lx.upperSeek === lx.upperSeek) {
      R.legsFrames++;
      let p = lx.upperSeek / lx.cycDur;
      p -= Math.floor(p);
      let d = lx.legAt / shimDur - p;
      d -= Math.round(d);
      R.phaseOff = Math.max(R.phaseOff, Math.abs(d));
    }
    // (Each against the figure's own root, so a push of the whole figure out of a face, which the climb's sphere clearing makes and
    // whose eased memory differs between two runs, is no difference of the feet's.)
    FF.root.getWorldPosition(Q);
    for (const name of ['lAnkle', 'rAnkle']) {
      bone(FF, name).getWorldPosition(P);
      R.ankles.push(P.x - Q.x, P.y - Q.y, P.z - Q.z);
    }
    bone(FF, 'root').getWorldPosition(P);
    R.pelvis.push(P.x - Q.x, P.y - Q.y, P.z - Q.z);
  });
  st = s;
  climbing = true;
  b.key('KeyW', true);
  runUntil(b, fps, 6, () => R.seen.length > 4);
  b.key('KeyW', false);
  climbing = false;
  stopped = t;
  runUntil(b, fps, 3, () => false);
  void upLag;
  b.physics.world.removeRigidBody(b.body);
  return R;
}

const lagRows: string[] = [];
for (const id of ['free-ladder-1', 'ladder-1']) {
  const lags: number[] = [];
  const settles: number[] = [];
  for (const fps of RATES) {
    const R = await ladderRun(id, fps, 'sway');
    const S = await ladderRun(id, fps, 'stiff');
    const words = `${id} @${fps}`;
    ok(R.seen.length > 4 && S.seen.length > 4, `${words}: up four rungs under both (${R.seen.join('>')})`);
    settles.push(R.settled);
    ok(R.lagMost > 0.01 && R.overshoot && R.settled < 2.5, `${words}, 'sway': the hips lag the climb (${(R.lagMost * 100).toFixed(1)} cm at most), overshoot at the stop and settle under a millimetre ${R.settled.toFixed(2)} s after the key is let go`);
    ok(S.lagMost === 0 && S.movedMost === 0 && S.legsFrames === 0, `${words}, 'stiff': no lag, no legs laid (${S.lagMost}, ${S.movedMost})`);
    if (id === 'free-ladder-1') ok(R.legsFrames > 0 && R.phaseOff <= 0.002, `${words}: the free hang shimmy's legs laid one shimmy cycle a climb cycle, phase-locked to the hands' reaches (${R.legsFrames} frames, off by ${R.phaseOff.toFixed(4)} of a cycle at most)`);
    else {
      // The braced feet kept: the drawn ankles with the sway against the same climb with none drawn (`swayAmount` 0), the pelvis moving.
      const Z = await ladderRun(id, fps, 'zero');
      let feet = 0;
      let pelvis = 0;
      const n = Math.min(R.ankles.length, Z.ankles.length);
      for (let i = 0; i < n; i += 3) feet = Math.max(feet, Math.hypot(R.ankles[i] - Z.ankles[i], R.ankles[i + 1] - Z.ankles[i + 1], R.ankles[i + 2] - Z.ankles[i + 2]));
      const m = Math.min(R.pelvis.length, Z.pelvis.length);
      for (let i = 0; i < m; i += 3) pelvis = Math.max(pelvis, Math.hypot(R.pelvis[i] - Z.pelvis[i], R.pelvis[i + 1] - Z.pelvis[i + 1], R.pelvis[i + 2] - Z.pelvis[i + 2]));
      ok(n === m * 2 && pelvis > 0.005 && feet <= 0.01, `${words}: the braced feet stay on the rungs: the drawn ankles (against the figure's root) within ${(feet * 100).toFixed(2)} cm of the same climb's with no sway drawn, while the pelvis moved ${(pelvis * 100).toFixed(2)} cm`);
    }
    lags.push(R.lagMost);
  }
  lagRows.push(`${id}: ${lags.map((l, i) => `${RATES[i]} ${(l * 100).toFixed(1)} cm`).join(', ')}`);
  ok(Math.max(...lags) - Math.min(...lags) <= 0.25 * Math.max(...lags) + 0.005 && Math.max(...settles) - Math.min(...settles) <= 0.1, `${id}: the lag alike at the four rates (${lagRows[lagRows.length - 1]}; settled ${settles.map((v) => v.toFixed(2)).join(', ')} s after the key)`);
}

// ---- 0g: a free hang's jump at a ledge behind it --------------------------------------------------------------------------------
for (const id of ['free-gap-behind-2.0', 'free-gap-behind-3.0']) {
  for (const fps of RATES) {
    for (const freeBehind of ['reach', 'side'] as const) {
      resetClimbTune();
      resetMoveTune();
      tuneClimb({ freeBehind });
      let look = 0;
      let lead = -1;
      let leadOff = 0;
      const { s, b } = await onPiece(id, 'onA', fps, (bb, FF) => {
        const L = bb.ledge;
        if (!L.holding || !hangs(bb)) return;
        look = Math.max(look, L.look);
        // The trailing hand stays on the grip while the leading one reaches back.
        if (L.look >= 0.99) {
          lead = L.lookSide > 0 ? 0 : 1;
          const k = 1 - lead;
          const g = FF.lp.gripNow(FF.rig as never, k, null, G);
          if (g && FF.lp.handW[k] >= 0.99) leadOff = Math.max(leadOff, Math.hypot(g.x - FF.lp.hand[k * 3], g.y - FF.lp.hand[k * 3 + 1], g.z - FF.lp.hand[k * 3 + 2]));
        }
      });
      const L = b.ledge;
      const from = nameOf(s, b);
      const v = L.heading + (LOOK_BACK_DEG * Math.PI) / 180;
      b.forward.set(Math.sin(v), 0, Math.cos(v));
      b.right.set(-Math.cos(v), 0, Math.sin(v));
      b.key('KeyW', true);
      runUntil(b, fps, 0.4, () => false);
      tap(b, 'Space', fps);
      b.key('KeyW', false);
      let left = false;
      runUntil(b, fps, 3.5, () => {
        if (L.phase !== LEDGE_HANG) left = true;
        return left && hangs(b) && nameOf(s, b) !== from;
      });
      const to = nameOf(s, b);
      const words = `${id} @${fps}, freeBehind ${freeBehind}`;
      const behinds = (L as unknown as { freeBehinds: number }).freeBehinds;
      if (freeBehind === 'reach') {
        ok(from === 'A' && look >= 0.99 && lead >= 0 && leadOff <= 0.02, `${words}: looking back the free hang looks away (the leading hand reaching back, the trailing one on the grip within ${(leadOff * 100).toFixed(2)} cm)`);
        ok(to === 'B' && behinds === 1, `${words}: W and Space jump to the ledge behind and catch it (${from} to ${to})`);
      } else ok(to !== 'B' && behinds === 0 && look === 0, `${words}: a free hang looking back reads as a side and never jumps behind, as before (${from} to ${to})`);
      b.physics.world.removeRigidBody(b.body);
    }
  }
}
resetClimbTune();
console.log(`climbFb2Ledge: ${checks} checks passed`);
