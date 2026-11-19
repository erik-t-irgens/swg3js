// Climbing II, phase 6 (vaults and clambers), maker B's items 3 and 4, through the game's own movement and climbing on the real
// Rapier (the grapple's harness, `TestBody`) at 30, 60, 144 and 240 frames a second while moving:
//  - item 3, never: a sprint at a 0.9 m by 0.8 m obstacle with the placing hand full, crouched by the key, prone, kneeling or
//    swimming, under 'sprint' (and crouched under 'run'), is today's to the bit (its every frame the same as under 'off'), and so is
//    one into something that moves (a crate on the top, a door's leaf in front, a crate where the feet would come down: each refused
//    as 'moves', the still world alone having taken it), while a crate out of the way refuses nothing; a face too high is the wall
//    as today; the vehicle's refusal, the duck's and the hand's, pinned as text (this harness has no vehicle);
//  - item 4: the hands full while a vault holds the body (the player's `climbHolds`: the fight's and the use key muted, the hook
//    refused, no emote), the chase camera following the body as a run's does and never the climbing's ease (which trails a body
//    running on at the sprint by its ease times its speed for good, measured through the follow itself), the body's place (what
//    the chase follows) moving through each vault with no jump at any rate, and what the wire carries of each kind (`wireState`: the
//    falling loop in a vault's and a dive's flight, crouched in a dive's roll and a clamber's climb, standing at a whole clamber's
//    end, the run elsewhere) by the vault's own clock, the same at every rate, its place the figure's hips less their rest height.
//
// Run: node tools/swg/tests/climbVaultsNever.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBody, box, ground, makePhysics, RAPIER } from './grappleBody.ts';
import { RATES } from './climbCourseBody.ts';
import { SPRINT_SHARE } from './climbVaultsBody.ts';
import { REPO } from './oldModules.ts';
import { MOVE_TUNE, resetMoveTune, tuneMove } from '../../../src/anim/moveTune.ts';
import { CLIMB_TUNE, resetClimbTune } from '../../../src/anim/climbTune.ts';
import { VAULT_FACTS } from '../../../src/anim/vaultClips.ts';
import { VAULT_MOVER_FLAGS } from '../../../src/player/vault.ts';
import { ClimbCamFollow } from '../../../src/player/climbCam.ts';
import { ThirdPersonCamera } from '../../../src/core/camera.ts';
import { LEDGE_REST } from '../../../src/anim/ledgeClips.ts';
import { climbCourse } from '../../../src/anim/climbCourse.ts';
import { pieceLabel } from '../../../src/anim/climbLabels.ts';
import type { Physics } from '../../../src/core/physics.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const text = (rel: string) => readFileSync(join(REPO, rel), 'utf8').replace(/\r\n/g, '\n');
const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** The camera's input, nothing moved (as smooth2Cam's). */
const CAM_INPUT = { locked: false, mouseDX: 0, mouseDY: 0, wheel: 0 } as never;

resetMoveTune();
resetClimbTune();

/** A box that moves: a dynamic body (`kind` 'dynamic', resting on what is under it) or a kinematic one (a door's leaf, held where it is). */
function mover(P: Physics, kind: 'dynamic' | 'kinematic', min: number[], max: number[]): void {
  const desc = kind === 'dynamic' ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.kinematicPositionBased();
  const body = P.world.createRigidBody(desc.setTranslation((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2));
  P.world.createCollider(RAPIER.ColliderDesc.cuboid((max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2).setFriction(0.8), body);
}

/** What a scene's run came to: its every frame hashed, whether anything vaulted, the verdicts met, and the vault's frames. */
interface Run {
  hash: string;
  vaulted: number;
  verdicts: Set<string>;
  /**
   * The body's place on each frame the vault held it, the place the chase follows (the figure's own way: `Vault.unride`, the review's
   * round), the vault's clock and what the wire would carry.
   */
  path: { x: number; y: number; z: number; fx: number; fy: number; fz: number; t: number; wire: string | null; crouched: boolean; camera: boolean }[];
  speed: number;
  endZ: number;
  /** The review's round: how far the capsule ever stood inside the obstacle while the vault held it (metres), and inside anything else watched. */
  inside: number;
  insideOther: number;
}

/** A scene: the obstacle (or ledge) and whatever else stands, the body's posture, and the keys held besides W. */
interface Scene {
  /** The obstacle's top and depth along +z from its face at z 3 (a clamber's ledge: deep). */
  top: number;
  depth: number;
  extra?: (P: Physics) => void;
  set?: (b: InstanceType<typeof TestBody>) => void;
  keys?: string[];
  /** Where the body starts along +z (a slow posture starts nearer, so it meets the face within the run). */
  start?: number;
  /** The review's round: a box watched for the capsule's reach into it (a second wall, a bench, a post), besides the obstacle. */
  watch?: [number[], number[]];
}

const SEEDF = new Float64Array(5);
async function drive(sc: Scene, fps: number, rule: 'off' | 'sprint' | 'run', seconds = 4): Promise<Run> {
  resetMoveTune();
  tuneMove({ vault: rule });
  const P = await makePhysics();
  ground(P, 0);
  box(P, [-1, 0, 3], [1, sc.top, 3 + sc.depth]);
  sc.extra?.(P);
  P.stepOnce();
  const b = new TestBody(P);
  b.place(0, 0, sc.start ?? -14);
  b.forward.set(0, 0, 1);
  b.right.set(-1, 0, 0);
  b.heading = 0;
  b.speedScale = SPRINT_SHARE;
  b.sprinting = true;
  sc.set?.(b);
  b.key('KeyW', true);
  for (const k of sc.keys ?? []) b.key(k, true);
  const h = createHash('sha256');
  const verdicts = new Set<string>();
  const path: Run['path'] = [];
  const V = b.vault;
  let inside = 0;
  let insideOther = 0;
  for (let i = 0; i < seconds * fps; i++) {
    b.frame(1 / fps);
    SEEDF[0] = b.pos.x;
    SEEDF[1] = b.pos.y;
    SEEDF[2] = b.pos.z;
    SEEDF[3] = b.heading;
    SEEDF[4] = b.vel.y;
    h.update(new Uint8Array(SEEDF.buffer));
    if (V.verdict) verdicts.add(V.verdict);
    if (V.holding) {
      const fo = V.unride({ x: b.pos.x, y: b.pos.y, z: b.pos.z });
      path.push({ x: b.pos.x, y: b.pos.y, z: b.pos.z, fx: fo.x, fy: fo.y, fz: fo.z, t: V.t, wire: V.wireState(), crouched: V.crouchedNow, camera: V.cameraCollider() !== null });
      inside = Math.max(inside, b.penetrationInBox([-1, 0, 3], [1, sc.top, 3 + sc.depth]));
    }
    if (sc.watch) insideOther = Math.max(insideOther, b.penetrationInBox(sc.watch[0], sc.watch[1]));
  }
  const run: Run = { hash: h.digest('hex'), vaulted: V.vaults + V.dives + V.clambers, verdicts, path, speed: V.speed, endZ: b.pos.z, inside, insideOther };
  resetMoveTune();
  return run;
}

// ---- item 3: never ---------------------------------------------------------------------------------------------------------------
const VAULT: Scene = { top: 0.9, depth: 0.8 };
const NEVER: { what: string; sc: Scene; rule?: 'sprint' | 'run'; verdict?: string }[] = [
  { what: 'with the placing hand full', sc: { ...VAULT, set: (b) => (b.placingHand = true) } },
  // (The crouch's pace is half the run's and the prone's a metre a second: each starts near enough to meet the face in the run, so
  // only the refusal keeps it off; the sprint's pace is stood in by the harness whatever the posture.)
  { what: 'crouched by the key', sc: { ...VAULT, keys: ['ControlLeft'], start: -4 } },
  { what: "crouched by the key under 'run'", sc: { ...VAULT, keys: ['ControlLeft'], start: -4 }, rule: 'run' },
  { what: 'prone', sc: { ...VAULT, set: (b) => (b.prone = true), start: -1 } },
  { what: 'kneeling', sc: { ...VAULT, set: (b) => (b.kneeling = true) } },
  // (Swimming takes the feet off the ground, which refuses a vault by itself: the refusal's own line is pinned as text below.)
  { what: 'swimming (water 1.6 m deep over the ground)', sc: { ...VAULT, set: (b) => (b.surface = () => 1.6) } },
  { what: 'into a crate resting on the top (it moves)', sc: { ...VAULT, extra: (P) => mover(P, 'dynamic', [-0.2, 0.9, 3.25], [0.2, 1.3, 3.55]) }, verdict: 'moves' },
  { what: "into a door's leaf (kinematic) between the body and the face", sc: { ...VAULT, extra: (P) => mover(P, 'kinematic', [-1, 0, 2.6], [1, 2.2, 2.7]) }, verdict: 'moves' },
  { what: "with a crate (kinematic, 0.6 m: under the face's upper ray) in the way short of the face", sc: { ...VAULT, extra: (P) => mover(P, 'kinematic', [-1, 0, 1.5], [1, 0.6, 1.9]) }, verdict: 'moves' },
  { what: 'with a crate where the feet would come down (it moves)', sc: { ...VAULT, extra: (P) => mover(P, 'dynamic', [-0.3, 0, 4.4], [0.3, 0.6, 5.0]) }, verdict: 'moves' },
  { what: 'into a face too high (1.6 m)', sc: { top: 1.6, depth: 0.8 }, verdict: 'high' },
  // The review's round (finding 1): the capsule's own corridor, past the far side down to where the feet come down, under the room over
  // the top: a second wall (0.8 m tall, 0.35 m past the far side) and a bench (0.45 m, 0.2 m past it), both still, both refused.
  { what: 'with a second wall (0.8 m, still) 0.35 m past the far side', sc: { ...VAULT, extra: (P) => box(P, [-1, 0, 4.15], [1, 0.8, 4.35]), watch: [[-1, 0, 4.15], [1, 0.8, 4.35]] }, verdict: 'way' },
  { what: 'with a bench (0.45 m, still) 0.2 m past the far side', sc: { ...VAULT, extra: (P) => box(P, [-1, 0, 4.0], [1, 0.45, 4.4]), watch: [[-1, 0, 4.0], [1, 0.45, 4.4]] }, verdict: 'way' },
];
for (const fps of RATES) {
  // The control: the same obstacle with nothing in the way, and with a crate that moves out of the way (beside the run).
  const plain = await drive(VAULT, fps, 'sprint');
  const off = await drive(VAULT, fps, 'off');
  ok(plain.vaulted === 1 && plain.hash !== off.hash, `@${fps}: the control: a sprint at the 0.9 by 0.8 m obstacle vaults it`);
  const aside = await drive({ ...VAULT, extra: (P) => mover(P, 'dynamic', [3, 0, 3], [3.6, 0.6, 3.6]) }, fps, 'sprint');
  ok(aside.vaulted === 1 && !aside.verdicts.has('moves'), `@${fps}: a crate that moves out of the way (3 m aside) refuses nothing: vaulted`);
  for (const n of NEVER) {
    const a = await drive(n.sc, fps, n.rule ?? 'sprint');
    const b = await drive(n.sc, fps, 'off');
    ok(a.vaulted === 0 && a.hash === b.hash && (!n.verdict || a.verdicts.has(n.verdict)), `@${fps}: ${n.what}: no vault, every frame as under 'off'${n.verdict ? ` (refused as '${n.verdict}')` : ''}`);
  }
}
ok(VAULT_MOVER_FLAGS === (RAPIER.QueryFilterFlags.EXCLUDE_FIXED | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS), "what moves is the engine's own: every body but the fixed (and the bodiless), never a sensor (another player)");

// ---- the review's round: the capsule's own corridor, and the capsule kept out of the obstacle ----------------------------------------
for (const fps of RATES) {
  // A post (still, 2 m) beside the run-in, 0.2 to 0.35 m off its line a metre short of the face: refused while it stands in the
  // capsule's breadth; the movement then turns the body aside on it as under 'off', and once past it the way is clear.
  const post: Scene = { ...VAULT, extra: (P) => box(P, [0.2, 0, 1.9], [0.35, 2, 2.05]), watch: [[0.2, 0, 1.9], [0.35, 2, 2.05]] };
  const a = await drive(post, fps, 'sprint');
  ok(a.verdicts.has('way') && a.insideOther < 1e-3, `@${fps}: a post beside the run-in a metre short of the face: refused while it stands in the capsule's way ('way'), and the capsule never in it (${r3(a.insideOther)} m)`);
  // The capsule never inside what it vaults, dives over or clambers onto (it rides over the top, or waits at the face while it rises),
  // crouched while it is kept so, and the camera passing the obstacle all the while (under 'pass').
  for (const K of [VAULT, { top: 0.9, depth: 1.5 }, { top: 1.0, depth: 6 }] as Scene[]) {
    const r = await drive(K, fps, 'sprint');
    ok(r.vaulted === 1 && r.inside < 1e-3 && r.path.some((s) => s.crouched) && r.path.every((s) => s.camera), `@${fps}: the ${K.top} by ${K.depth} m piece: the capsule never inside it (${r3(r.inside)} m), crouched while kept off it, the camera's block passing it all the while`);
  }
}
{
  // Under 'block' the camera's block passes nothing.
  resetClimbTune();
  CLIMB_TUNE.barCamera = 'block';
  const r = await drive(VAULT, 60, 'sprint');
  ok(r.vaulted === 1 && r.path.every((s) => !s.camera), "under `climb.barCamera` 'block' the obstacle blocks the camera as any wall does");
  resetClimbTune();
}

// ---- item 4: the camera, through the follow itself and the body's place ---------------------------------------------------------
{
  // The climbing's eased follow behind a body running at the sprint's speed: it trails by its ease times the speed and is never caught.
  const F = new ClimbCamFollow();
  const v = 7;
  const dt = 1 / 60;
  let z = 0;
  let on = true;
  for (let i = 0; i < 180; i++) {
    z += v * dt;
    on = F.step(0, 0, z, dt, i < 60, CLIMB_TUNE.camEase, 0, 0, v);
  }
  const lag = z - F.z;
  // (Its target is held for each frame at the frame's end, so it trails by the ease less half a frame's travel.)
  ok(on && lag > v * (CLIMB_TUNE.camEase - dt) && lag < v * CLIMB_TUNE.camEase, `the climbing's eased follow, handed a body running on at ${v} m/s, still trails it by about its ease times its speed two seconds after (${r3(lag)} m; the ease ${CLIMB_TUNE.camEase} s) and is never caught: so a vault, whose run goes on, takes none of it`);
}
const KINDS: { kind: string; sc: Scene }[] = [
  { kind: 'vault', sc: VAULT },
  { kind: 'dive', sc: { top: 0.9, depth: 1.5 } },
  { kind: 'clamber', sc: { top: 1.0, depth: 6 } },
];
const wires: Record<string, string[]> = {};
for (const K of KINDS) {
  for (const fps of RATES) {
    const r = await drive(K.sc, fps, 'sprint');
    ok(r.vaulted === 1, `@${fps}: a sprint at the ${K.sc.top} by ${K.sc.depth} m piece: a ${K.kind}`);
    // What the chase follows (the figure's own way: the body's place less what the capsule is kept off the obstacle, the review's
    // round) from the frame before the vault on: no frame's step more than the clip's own fastest travel over a frame (its path at its
    // rate, a vault's stretch eased in), so the chase never jumps.
    let most = 0;
    let mostY = 0;
    for (let i = 1; i < r.path.length; i++) {
      const a = r.path[i - 1];
      const c = r.path[i];
      most = Math.max(most, Math.hypot(c.fx - a.fx, c.fz - a.fz) * fps);
      mostY = Math.max(mostY, Math.abs(c.fy - a.fy) * fps);
    }
    note(`@${fps}: ${K.kind}: the chase's point moves at most ${r3(most)} m/s across the ground and ${r3(mostY)} m/s up or down while the vault holds it (it came at ${r3(r.speed)} m/s)`);
    ok(most < 3 * r.speed && mostY < 3 * r.speed, `@${fps}: ${K.kind}: the chase's point never jumps (no frame's step past three times the incoming speed's travel)`);
    // What the wire carries, by the vault's own clock: one window of each, in order.
    const f = VAULT_FACTS[r.path.length ? (K.kind === 'dive' ? 'jump_over' : K.kind === 'clamber' ? 'running_jump' : 'jumping') : 'jumping'];
    const seq: string[] = [];
    let byClock = true;
    for (const s of r.path) {
      const w = s.wire ?? 'run';
      if (seq[seq.length - 1] !== w) seq.push(w);
      const want = f.kind === 'vault' ? (s.t >= f.leave && s.t < f.land ? 'air' : 'run') : f.kind === 'dive' ? (s.t >= f.leave && s.t < f.touch ? 'air' : s.t >= f.touch && s.t < f.land ? 'crouch' : 'run') : s.t >= f.touch && s.t < f.land ? 'crouch' : s.t >= f.land ? 'idle' : 'run';
      if (want !== w) byClock = false;
    }
    wires[`${K.kind}@${fps}`] = seq;
    ok(byClock, `@${fps}: ${K.kind}: the wire's pose (${seq.join(', ')}) is the clip's own moments by the vault's clock`);
  }
  const seqs = RATES.map((fps) => wires[`${K.kind}@${fps}`].join(','));
  ok(seqs.every((s) => s === seqs[0]), `${K.kind}: the wire's poses come in the same order at every rate (${seqs[0]})`);
}
{
  // A whole clamber (the sprint let go before its cut): standing on the top from its second foot on.
  const r = await drive({ top: 1.0, depth: 6, set: (b) => (b.sprinting = false) }, 60, 'run');
  ok(r.vaulted === 1 && r.path.some((s) => s.wire === 'idle'), "a clamber played whole (no sprint held, 'run') tells the wire it stands from its second foot on the top");
  // The place: the falling loop's feet under the figure's hips by their rest height, scaled to the figure.
  const P = await makePhysics();
  ground(P, 0);
  box(P, [-1, 0, 3], [1, 0.9, 3.8]);
  P.stepOnce();
  const b = new TestBody(P);
  b.place(0, 0, -14);
  b.forward.set(0, 0, 1);
  b.right.set(-1, 0, 0);
  b.speedScale = SPRINT_SHARE;
  b.sprinting = true;
  b.key('KeyW', true);
  let k = Number.NaN;
  for (let i = 0; i < 4 * 60 && !(k === k); i++) {
    b.frame(1 / 60);
    if (b.vault.holding) k = b.vault.k;
  }
  const V = b.vault;
  const out = { x: 0, y: 0, z: 0 };
  // Hips at `along` past the vault's start, `up` over the ground it left.
  const at = (along: number, up: number) => V.peerPlace(out, V.x0 + V.ux * along, V.y0 + up, V.z0 + V.uz * along);
  const rest = k * LEDGE_REST.hips;
  at(V.face + V.depth / 2, V.top + rest + 0.4);
  ok(Math.abs(out.y - (V.y0 + V.top + 0.4)) < 1e-12 && Math.abs(out.x - (V.x0 + V.ux * (V.face + V.depth / 2))) < 1e-12, `the falling loop stood with its feet the hips' rest height (${LEDGE_REST.hips} m times the figure's ${r3(k)}) under this figure's hips`);
  at(V.face + V.depth / 2, 1.0);
  ok(Math.abs(out.y - (V.y0 + V.top)) < 1e-12, `hips over the obstacle too low for the hanging legs to clear it: the feet on its top (${r3(V.top)} m), never through it`);
  at(V.face - 1, 0.5);
  ok(Math.abs(out.y - V.y0) < 1e-12, 'short of the face, never under the ground it left');
  at(V.face + V.depth + 1, 0.5);
  ok(Math.abs(out.y - V.y1) < 1e-12, 'past the far side, never under the ground beyond');
}

// ---- the review's round (finding 2): the real chase camera over a landing on lower ground behind the top -------------------------
{
  // The course as it stood on Tatooine: a 0.9 by 0.8 m obstacle on a slab reaching 0.75 m past it, its top 0.79 m over the ground
  // beyond. The camera is the game's own orbit (pitch 0.12 behind the body), its block the game's own (`Physics.cameraBlock`) handed
  // the collider the vault's rule passes (`Vault.cameraCollider`, as the player's `barCamera`), its target the place the chase follows
  // (`Vault.unride`). Handed nothing to pass (the control), the landing's line grazed the top's edge for a frame and pulled the orbit
  // in some six metres and out again.
  const steps = async (fps: number, pass: boolean): Promise<{ worst: number; vaulted: number }> => {
    resetMoveTune();
    const P = await makePhysics();
    box(P, [-20, -1.79, -20], [20, -0.79, 40]);
    box(P, [-3, -0.79, -20], [3, 0, 7.55]);
    box(P, [-1.5, 0, 6], [1.5, 0.9, 6.8]);
    P.stepOnce();
    (P as unknown as { acc: number }).acc = 0;
    const b = new TestBody(P);
    b.jka.forceLevel = 0;
    b.place(0, 0.02, 0);
    b.forward.set(0, 0, 1);
    b.right.set(-1, 0, 0);
    b.heading = 0;
    b.run(fps, 0.3);
    b.speedScale = SPRINT_SHARE;
    b.sprinting = true;
    b.key('KeyW', true);
    const cam = new ThirdPersonCamera(16 / 9);
    cam.yaw = Math.PI;
    cam.pitch = 0.12;
    const blocked = (a: { x: number; y: number; z: number }, c: { x: number; y: number; z: number }) => P.cameraBlock(a, c, b.body, false, pass && b.vault.offset ? b.vault.cameraCollider() : null);
    const target = cam.camera.position.clone();
    const last = cam.camera.position.clone();
    let worst = 0;
    for (let i = 0; i < 3 * fps; i++) {
      b.frame(1 / fps);
      target.set(b.pos.x, b.pos.y, b.pos.z);
      if (b.vault.rideY !== 0 || b.vault.holdBack !== 0) b.vault.unride(target);
      cam.update(CAM_INPUT, target, blocked, 1 / fps);
      if (i > 0) worst = Math.max(worst, cam.camera.position.distanceTo(last));
      last.copy(cam.camera.position);
    }
    return { worst, vaulted: b.vault.vaults };
  };
  for (const fps of RATES) {
    const on = await steps(fps, true);
    const off = await steps(fps, false);
    ok(on.vaulted === 1 && on.worst < 1 && off.worst > 3, `@${fps}: a vault landing 0.79 m down past the top: the chase's largest step a frame ${r3(on.worst)} m, the obstacle passed by its block (handed nothing to pass, it popped ${r3(off.worst)} m)`);
  }
}

// ---- the course's words for its obstacles -----------------------------------------------------------------------------------------
{
  const pieces = climbCourse({}).pieces.filter((p) => p.kind === 'obstacle' && /^(obstacle|clamber)-/.test(p.id));
  resetMoveTune();
  tuneMove({ vault: 'off' });
  const off = pieces.map((p) => pieceLabel(p));
  ok(off.every((l) => l.what === 'Vaults and clambers come with phase 6'), "under `move.vault` 'off' the course's obstacles say what 5333b88's said");
  resetMoveTune();
  const on = pieces.map((p) => ({ id: p.id, l: pieceLabel(p) }));
  ok(on.every(({ id, l }) => (id.startsWith('clamber') ? /clamber onto it/.test(l.what) : id.startsWith('obstacle-1.3') ? /Too high/.test(l.what) : /a vault, or a dive/.test(l.what))), "under 'sprint' each says what a sprint at it does: a vault or a dive, a clamber, or a wall too high (the 1.3 m ones)");
}

// ---- what only the game hands over, pinned as text --------------------------------------------------------------------------------
{
  const pl = text('src/player/player.ts');
  ok(pl.includes("    if (this.swimming || this.crouching || this.duck.crouch || this.prone || this.kneeling || this.mounted !== null || this.piloting !== null || this.noclip || this.eva || (this.handPlacing?.() ?? false)) vi.busy = true;\n    vi.self = this.body;"), "the player's sense refuses the placing hand, swimming, crouched (by the key or the duck), prone, kneeling, a vehicle ridden or flown, noclip and space, and hands the vault its own body to leave out of what moves");
  ok(pl.includes('  get climbHolds(): boolean {\n    // (Climbing II, phase 6, maker B:') && pl.includes('    if (this.vault.holding) return true;\n    // (Climbing II, phase 5: and on a pole.)'), "over an obstacle the hands are full (`climbHolds`): the fight's keys and the use key muted, the hook refused (`s.climbing = this.climbHolds;`), no emote");
  ok(pl.includes('    s.climbing = this.climbHolds;'), "the hook's refusal reads it");
  ok(pl.includes("const climbing = CLIMB_TUNE.camera === 'eased' && this.climbHolds && !this.vault.holding;"), "and the chase camera's climbing ease never takes a vault");
  const gb = text('tools/swg/tests/grappleBody.ts');
  ok(gb.includes('if (this.swimming || crouching || this.duck.crouch || this.prone || this.kneeling || this.placingHand) vi.busy = true;\n      vi.self = this.body;') && gb.includes('|| this.pole.holding || this.vault.holding;'), "the harness refuses the same, and holds the use key off the climb while a vault holds the body");
  const main = text('src/main.ts');
  ok(main.includes("    const vaultWire = p.vault.wireState();\n    const vaultAt = this.vaultPeerAt(leanedAt);\n") && main.includes("    const edRet = this.editor?.returnPlace ?? null;\n    const at = edRet ? leanedAt.set(edRet.x, edRet.y, edRet.z) : vaultAt ? vaultAt : leans ?") && main.includes("    const hips = p.vault.wireState() === 'air' && !p.aboard ? (p.rig?.bone('root') ?? null) : null;\n    // (The review's round: out of the flight, the figure's own way where the capsule is kept off the obstacle, raised or held back:\n    // `Vault.unride`, the place the chase follows; the body's own place otherwise.)\n    if (!hips) return !p.aboard && (p.vault.rideY !== 0 || p.vault.holdBack !== 0) ? p.vault.unride(out.copy(p.worldPos)) : null;\n    hips.getWorldPosition(vaultHips);\n    return p.vault.peerPlace(out, vaultHips.x, vaultHips.y, vaultHips.z);"), "the state sent stands the falling loop under the figure's hips in a vault's flight (`vaultPeerAt`), and out of it the figure's own way where the capsule is kept off the obstacle (the review's round)");
  // The review's round: the hand-overs only the game makes of the capsule kept off the obstacle and the camera's pass.
  ok(pl.includes('    V.step(this, vi, advance);\n    // (The review\'s round: the capsule crouched while the vault keeps it off the obstacle, raised onto its top or held at its face.)\n    this.setCrouchCollider(V.crouchedNow);') && gb.includes('    V.step(this, vi, advance);\n    // (The review\'s round: the capsule crouched while the vault keeps it off the obstacle, as the player\'s.)\n    this.setCrouchCollider(V.crouchedNow);'), "the player and the harness wear the crouched capsule while the vault keeps it off the obstacle");
  ok(pl.includes('    if (this.vault.rideY !== 0 || this.vault.holdBack !== 0) return this.vault.unride(this.followPoint.copy(this.worldPos));\n    const lag = this.drawn.offset;'), "the chase follows the figure's own way (`rawFollowAt`), never the capsule kept off the obstacle");
  ok(pl.includes('    const vaulted = this.vault.offset ? this.vault.cameraCollider() : null;\n    if (vaulted) return vaulted;') && main.includes('this.physics.cameraBlock(from, to, player.body, this.world.inside, player.barCamera())'), "the camera's block is handed the obstacle vaulted (`barCamera`), as a bar's or a pole's");
  ok(main.includes("s: p.mounted ? 'seated' : (vaultWire ?? rig?.describe().state ?? 'idle'), v: n2(p.vault.holding ? p.vault.speed : Math.hypot(p.vel.x, p.vel.z)),"), "and carries the vault's nearest pose, and the speed it runs with");
  const peers = text('src/net/remotePlayers.ts');
  const states = /const STATES: Set<string> = new Set\(\[([^\]]*)\]\)/.exec(peers)?.[1] ?? '';
  ok(["'air'", "'crouch'", "'idle'"].every((s) => states.includes(s)) && peers.includes("r.state = STATES.has(s.s) ? s.s : 'idle';"), "another player's game takes each pose the wire carries of a vault as a state of its own (never refused to the idle)");
  ok(main.includes('const head = rig?.boneFor(\'head\');') && main.includes('head.getWorldPosition(this.eyePoint);'), 'the first-person eye is the drawn head, which the vault puts on its clip\'s path (`applyVaultRoot`)');
}
resetMoveTune();
resetClimbTune();
console.log(`climbVaultsNever: ${checks} checks passed`);
