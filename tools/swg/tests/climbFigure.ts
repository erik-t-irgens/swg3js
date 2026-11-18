// Climbing II, Smoothness II, items 3 to 5 and 9: a posed figure on the climbing harness's body (tools/swg/tests/grappleBody.ts),
// as smooth2Rig's: the game's own rig (src/player/rig.ts's `CharacterRig`, its parts stood in), the pack's own clips fitted to
// the converted human male, the game's own hang hand-over (`driveHangClips`), the ledge's and the wall's own limbs
// (`limbsFor`, src/player/limbPlace.ts's solves), and the figure's spheres measured off the converted human male's own rest
// mesh by the game's own measure (src/player/bodySpheres.ts), cleared by the game's own `BodySpheres.clearOut` with the game's
// own mask (`climbMask`) between the line-up and the solves, as the player's `placeHangLimbs` and `placeWallLimbs` do.
//
// What the player does round them (where its root is put, the wall's clips handed to the rig) is the player's own few lines,
// written again here; tools/swg/tests/smooth2Body.test.ts pins them as text.
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { join } from 'node:path';
import * as THREE from 'three';

const charStub = 'export class Character { static async load() { throw new Error("no pack in a test"); } }';
const hook = `import { existsSync } from 'node:fs';
export async function resolve(s, c, next) {
  if (s === './character' || s === './character.ts' || s.endsWith('/player/character') || s.endsWith('/player/character.ts')) {
    return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(charStub)}), shortCircuit: true };
  }
  if (s.startsWith('.') && !/\\.[a-z]+$/.test(s) && c.parentURL && existsSync(new URL(s + '.ts', c.parentURL))) return next(s + '.ts', c);
  return next(s, c);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { CharacterRig } = await import('../../../src/player/rig.ts');
const { driveHangClips } = await import('../../../src/player/hangClips.ts');
const { MixamoPack } = await import('../../../src/anim/mixamoPack.ts');
const { LEDGE_IDS, ledgeClipName } = await import('../../../src/anim/ledgeClips.ts');
const { WALL_CLIP_NAMES, WALL_IDS, wallClipName } = await import('../../../src/anim/wallClips.ts');
const { BAR_IDS } = await import('../../../src/anim/barClips.ts');
const { ROPE_IDS } = await import('../../../src/anim/ropeClips.ts');
const { LimbPlace } = await import('../../../src/player/limbPlace.ts');
const { CLIMB_TUNE } = await import('../../../src/anim/climbTune.ts');
const { STILL_FLAGS } = await import('../../../src/player/stairSense.ts');
const { BodySpheres, measureSpheres } = await import('../../../src/player/bodySpheres.ts');
const { clearClimb, climbWorst, notePlaced, settleClimb } = await import('../../../src/player/climbClear.ts');
const { figureScaleOf } = await import('../../../src/player/peerHang.ts');
const { glbSkeleton, speciesBodies, targetSkeleton } = await import('./animFixtures.ts');
const { REPO } = await import('./oldModules.ts');
const { glbSphereSource, speciesBodyFiles } = await import('./sphereFixtures.ts');
const { RAPIER } = await import('./grappleBody.ts');
type TestBody = import('./grappleBody.ts').TestBody;
type Rig = InstanceType<typeof CharacterRig>;
type Spheres = InstanceType<typeof BodySpheres>;
type Limbs = InstanceType<typeof LimbPlace>;
type HangState = import('../../../src/player/hangClips.ts').HangClipState;

const body = speciesBodies(REPO).find((x) => x.id === 'human_male');
/** Whether the converted human male is here (his skeleton and his mesh): the figure's tests note it and skip where not. */
export const HAVE_BODY = !!body && speciesBodyFiles(REPO, 'human_male').length > 0;
const target = body ? glbSkeleton(body.body) : targetSkeleton();
const packDir = join(REPO, 'public', 'anims', 'mixamo');
const pack = new MixamoPack({
  enabled: () => true,
  index: async () => readFileSync(join(packDir, 'index.json'), 'utf8'),
  clip: async (file: string) => {
    const b = readFileSync(join(packDir, file));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  },
  breath: async () => {},
  // (And the crouched walk, whose head the duck reads at its deepest: Smoothness II's item 4.)
  // (And Climbing II, phase 3's bar clip, which its suites pose: src/anim/barClips.ts.)
  // (And phase 4's rope clips: src/anim/ropeClips.ts.)
  also: [...LEDGE_IDS, ...WALL_IDS, 'crouched_walking', ...BAR_IDS, ...ROPE_IDS],
  now: () => performance.now(),
});
const info = console.info;
console.info = () => {};
/** The pack's clips fitted to the human male (the ledge's and the wall's among them). */
export const FIGURE_CLIPS = await pack.clipsFor(target as never, 'hands');
console.info = info;
/** The human male's spheres, measured off his own rest mesh by the game's own measure. */
export const FIGURE_SPHERES = HAVE_BODY ? measureSpheres(glbSphereSource(speciesBodyFiles(REPO, 'human_male'))) : [];

/** A figure: the body's group, the rig's root, the rig, its bones, its limbs' solve and its spheres. */
export interface Figure {
  group: THREE.Group;
  root: THREE.Group;
  rig: Rig;
  bones: THREE.Bone[];
  lp: Limbs;
  spheres: Spheres;
  hang: HangState;
  wallRate: { rate: number; fade: number };
  /** Whether the last frame's spheres were the climb's (the player's `spheresClimb`). */
  climbing: boolean;
}

/** A new figure (its own skeleton, rig, limbs and spheres). */
export function figure(): Figure {
  const group = new THREE.Group();
  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.fromArray(target.base.p);
  inner.quaternion.fromArray(target.base.q);
  root.add(inner);
  const bones: THREE.Bone[] = [];
  target.joints.forEach((j) => {
    const b = new THREE.Bone();
    b.name = j.name;
    b.position.fromArray(j.restP);
    b.quaternion.fromArray(j.restQ);
    bones.push(b);
    (j.parent < 0 ? inner : bones[j.parent]).add(b);
  });
  group.add(root);
  const rig = CharacterRig.fromCharacter({ group: root, clips: FIGURE_CLIPS } as never);
  const spheres = new BodySpheres({ ball: (r) => new RAPIER.Ball(r), contact: () => new RAPIER.ShapeContact(0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }) });
  spheres.use(rig, FIGURE_SPHERES);
  return { group, root, rig, bones, lp: new LimbPlace(null), spheres, hang: { posePlaying: '', hangFade: { fade: CLIMB_TUNE.ease }, ladderRate: { rate: 1, fade: CLIMB_TUNE.ease } }, wallRate: { rate: 0.5, fade: 0.15 }, climbing: false };
}

/** The figure's size the ledges are handed (the player's `ledgeScale`). */
export const figureScale = (F: Figure): number => figureScaleOf(F.rig as never);

/** The player's `clearFigure`: its glue round the game's own `clearClimb` (the push, a reaching hand moved out), before the solves. */
function clearFigure(b: TestBody, F: Figure, dt: number): void {
  const S = F.spheres;
  if (CLIMB_TUNE.bodyClear !== 'spheres' || !S.ready) return;
  if (!F.climbing) S.reset();
  F.climbing = true;
  const onWall = b.wall.holding && !b.ledge.holding;
  clearClimb(S, F.lp, F.rig as never, b.physics.world as never, b.filter, dt, b.pos.x, b.pos.y + b.colliderOffsetY, b.pos.z, onWall ? F.lp.wall[3] : b.ledge.lip.nx, onWall ? F.lp.wall[5] : b.ledge.lip.nz);
}

/** The game's hang frame on the figure after the body's (the player's `animateHang`, `placeVisual`'s root, `placeHangLimbs`). */
export function drawHang(b: TestBody, F: Figure, dt: number): void {
  const L = b.ledge;
  driveHangClips(F.rig, L, dt, F.hang);
  F.group.position.set(b.pos.x, b.pos.y, b.pos.z);
  F.group.rotation.set(0, L.heading, 0);
  const h = L.heading;
  F.root.position.set(L.offX * Math.cos(h) - L.offZ * Math.sin(h), L.offY, L.offX * Math.sin(h) + L.offZ * Math.cos(h));
  F.root.quaternion.set(0, 0, 0, 1);
  if (L.tilted) L.applyTilt(F.root);
  F.group.updateMatrixWorld(true);
  L.limbsFor(F.lp, F.rig as never, null);
  notePlaced(F.lp);
  clearFigure(b, F, dt);
  F.lp.filter = b.filter;
  F.lp.place(F.rig as never, b.physics.world, null);
  settleFigure(b, F);
  F.group.updateMatrixWorld(true);
}

/** The player's `settleFigure`: the game's own `settleClimb`, after the solves. */
function settleFigure(b: TestBody, F: Figure): void {
  if (CLIMB_TUNE.bodyClear !== 'spheres' || !F.spheres.ready) return;
  settleClimb(F.spheres, F.lp, F.rig as never, b.physics.world as never, b.filter);
}

/** The game's wall frame on the figure after the body's (the player's `animateWall`, `applyWallRoot`, `placeWallLimbs`). */
export function drawWall(b: TestBody, F: Figure, dt: number): void {
  const W = b.wall;
  const rig = F.rig;
  if (W.startClip) rig.play(ledgeClipName(W.startClip), { from: W.startFrom, fadeIn: W.startFade, hold: false });
  if (W.rigState) {
    if (W.rigState === 'wallStill') rig.prefer('wallStill', wallClipName(W.rigClip));
    else if (W.rigState === 'wallLeft' || W.rigState === 'wallRight') rig.prefer(W.rigState, WALL_CLIP_NAMES[W.rigClip] ?? wallClipName(W.rigClip));
    F.wallRate.rate = W.rate;
    F.wallRate.fade = CLIMB_TUNE.ease;
    rig.nearestNext = CLIMB_TUNE.transitions === 'blend';
    rig.setState(W.rigState as never, 0, null, F.wallRate);
    rig.nearestNext = false;
  } else rig.setState(W.stood ? 'idle' : 'air', 0, null, F.hang.hangFade);
  rig.update(dt);
  F.group.position.set(b.pos.x, b.pos.y, b.pos.z);
  F.group.rotation.set(0, W.heading, 0);
  const c = Math.cos(W.heading);
  const s = Math.sin(W.heading);
  F.root.position.set(W.offX * c - W.offZ * s, W.offY, W.offX * s + W.offZ * c);
  F.root.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), W.lean);
  F.group.updateMatrixWorld(true);
  rig.twistTorso(0, 0);
  if (!W.holding) {
    if (F.lp.busy) F.lp.reset();
    return;
  }
  F.lp.filter = b.filter;
  W.limbsFor(F.lp, rig as never, b.physics.world as never, null);
  notePlaced(F.lp);
  clearFigure(b, F, dt);
  F.lp.place(rig as never, b.physics.world, null);
  settleFigure(b, F);
  F.group.updateMatrixWorld(true);
}

/** The figure's frame after the body's: the hang's, the wall's, or nothing climbing (its climb's push let go, as the player's). */
export function drawClimb(b: TestBody, F: Figure, dt: number): 'hang' | 'wall' | '' {
  if (b.wall.holding && !b.ledge.holding) {
    drawWall(b, F, dt);
    return 'wall';
  }
  if (b.ledge.holding) {
    drawHang(b, F, dt);
    return 'hang';
  }
  F.climbing = false;
  return '';
}

/** The worst a sphere of the figure stands in anything still now (after the frame), the climb's own mask, metres; and which. */
export function sphereWorst(b: TestBody, F: Figure): { depth: number; part: string } {
  F.group.updateMatrixWorld(true);
  const d = climbWorst(F.spheres, F.lp, b.physics.world as never, b.filter);
  return { depth: d, part: d > 0 ? F.spheres.parts[F.spheres.worstAt].id : '' };
}
