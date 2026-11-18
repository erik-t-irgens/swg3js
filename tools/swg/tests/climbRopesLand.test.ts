// Climbing II, phase 4 (maker B): letting go of a rope into a landing (`climb.ropeLand` 'lips', src/player/ropeSwing.ts's
// `release`, `predict`, `classify`, the flight and the landing, their clips src/anim/ropeClips.ts's `ROPE_LAND_*` and their
// hand-over src/player/hangClips.ts's `driveRopeClips`), and everything else round a rope (a hard blow, the water, other
// players' nearest pose, the action bar's words), through the game's own movement and climbing on the real Rapier (the
// grapple's harness, tools/swg/tests/grappleBody.ts, and the course's rope landings stood by tools/swg/tests/climbCourseBody.ts)
// at 30, 60, 144 and 240 frames a second, and the game's own rig posed by the hand-over (tools/swg/tests/climbFigure.ts):
//  - the clips' landings measured on the human male as the game's table has them (each band's braced foot's reach and the
//    second its feet are stood);
//  - the course's rope landings: a rope over level floor with a platform ahead at a level, a knee, a between and a waist lip,
//    and one with nothing ahead, opt-in (`ropeLands`) and kept out of every other row's list;
//  - on each, E grabbed standing, A pumping, Space on the forward swing: the flight foreseen and flown on the physics' steps,
//    the band the lip's height under the feet names, the landing's clip from the owner's second, the body stood on the top;
//    the same band and the same stand at every rate, the capsule never in the platform; with nothing ahead the plain let-go, a
//    fall and the movement's own landing;
//  - the figure: the flight's hips drawn at the flying body's middle, the drawn lower ankle never under the top as the landing's
//    offset eases out, the feet on the top after;
//  - under 'plain' Space is maker A's let-go; a hard blow knocks the body off, a small one keeps the rope; the water under the
//    hanging body lets go into the swim, a flight into water ends there;
//  - another player's game told a free hang at the rope's `peerPlace`, and the action bar's words;
//  - a digest of the landings' every frame at the shipped settings and with the round's put back (`CLIMB_ROPES_BEFORE`), and the
//    hand-overs only the game makes, pinned as text.
// (Grabbing at every height, climbing to the top and the end and stopping there, and pumping alike at 30 and 240 are maker A's
// `climbRopes.test.ts`.)
//
// Run: node tools/swg/tests/climbRopesLand.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { figure, HAVE_BODY, type Figure } from './climbFigure.ts';

const { RAPIER } = await import('../../../src/core/physics.ts');
const { CLIMB_ROPES_BEFORE, CLIMB_TUNE, climbBarsBefore, climbRopesBefore, resetClimbTune, tuneClimb } = await import('../../../src/anim/climbTune.ts');
const { ROPE_BAND_CLIPS, ROPE_BAND_FROM, ROPE_BAND_NAMES, ROPE_CLIP_NAMES, ROPE_FACTS, ROPE_FLIGHT_CLIP, ROPE_LAND_FACTS, ROPE_SWING, ROPE_SWING_TWIN, ROPE_TIMES, measureRopeLandTables, measureRopeTables } = await import('../../../src/anim/ropeClips.ts');
const { ROPE_FLY, ROPE_LAND, ROPE_NONE } = await import('../../../src/player/ropeSwing.ts');
const { driveRopeClips } = await import('../../../src/player/hangClips.ts');
const { climbCourse, courseIds, extraIds, COURSE_TWO_IDS, ROPE_LAND_TOPS, ropeLandIds } = await import('../../../src/anim/climbCourse.ts');
const { pieceLabel } = await import('../../../src/anim/climbLabels.ts');
const { bodyAt, standPiece, tap } = await import('./climbCourseBody.ts');
const { PeerHang, PeerHangIn } = await import('../../../src/player/peerHang.ts');
const { fillActions, newPromptState, PROMPT_WORDS } = await import('../../../src/ui/promptRules.ts');
const { readPeerRope, newPeerRope } = await import('../../../src/net/peerRope.ts');
const { LEDGE_REST } = await import('../../../src/anim/ledgeClips.ts');
const { LEDGE_CAPSULE } = await import('../../../src/player/ledge.ts');
const { SWIM_DEPTH } = await import('../../../src/player/swimStep.ts');
const { REPO } = await import('./oldModules.ts');
type Stood = Awaited<ReturnType<typeof standPiece>>;
type Body = ReturnType<typeof bodyAt>['b'];

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
/** The let-go: on the forward swing, once the swing is past this far (the course's lips are laid for a let-go there). */
const LET_GO = 28 / DEG;
/** The capsule's middle over the feet (the rope's `ROPE_MID`). */
const MID = LEDGE_CAPSULE.r + LEDGE_CAPSULE.stand;
const BANDS = ['level', 'knee', 'between', 'waist'] as const;

// ---- the clips' landings, measured on the game's own rig ---------------------------------------------------------------------
{
  const F = figure();
  const L = measureRopeLandTables(F.rig as never);
  ok(L !== null, "the flight's and the four landings' tables are measured off the game's own rig (the let-go clips in the pack)");
  const k = F.root.scale.y;
  const tolR = HAVE_BODY ? 0.01 : 0.3;
  const tolS = HAVE_BODY ? 1 / 30 + 1e-6 : 0.6;
  const rows: string[] = [];
  let same = true;
  for (let b = 0; b < 4; b++) {
    const t = L!.land[b];
    const reach = t.reach * k;
    same &&= Math.abs(reach - ROPE_LAND_FACTS.reach[b]) < tolR && Math.abs(t.stand - ROPE_LAND_FACTS.stand[b]) < tolS;
    rows.push(`${ROPE_BAND_NAMES[b]} from ${ROPE_BAND_FROM[b].toFixed(3)} s: the braced foot ${reach.toFixed(3)} m ahead of the hips, the feet stood at ${t.stand.toFixed(3)} s`);
  }
  ok(same, `each band's braced foot's reach at its start and the second its feet are stood, as the game's table has them (${rows.join('; ')})`);
  ok(ROPE_BAND_CLIPS.join() === `mx_swinging,mx_swing_to_land_1,mx_swing_to_land,mx_swing_into_wall` && ROPE_FLIGHT_CLIP === 'mx_swinging', 'the bands play the owner\'s clips: level the swinging clip (the flight\'s own), knee swing_to_land_1, between swing_to_land, waist swing_into_wall, by their rig names made once');
  ok(Math.abs(ROPE_BAND_FROM[1] - ROPE_TIMES.landKnee) < 1e-12 && Math.abs(ROPE_BAND_FROM[2] - ROPE_TIMES.landBetween) < 1e-12 && Math.abs(ROPE_BAND_FROM[3] - ROPE_TIMES.landWaist) < 1e-12 && Math.abs(ROPE_TIMES.landLevel - 31 / 30) < 1e-12, "the landings begin at the owner's seconds (knee 1.33, between and level's let-go 1.03, waist 0.93), the level one going on from the flight's own clip at its foot's touch");
  ok(ROPE_TIMES.levelHold < ROPE_TIMES.levelTouch && ROPE_TIMES.levelTouch > ROPE_TIMES.landLevel, `the flight's clip runs from its let-go (${ROPE_TIMES.landLevel.toFixed(3)} s) to its foot's touch (${ROPE_TIMES.levelTouch.toFixed(3)} s), its frame before held while the flight is longer`);
  if (!HAVE_BODY) note("no converted human male: the clips measured on the tests' own skeleton");
}

// ---- the course's rope landings ------------------------------------------------------------------------------------------------
{
  const all = climbCourse({ ropeLands: true }).pieces.map((p) => p.id);
  const plain = climbCourse().pieces.map((p) => p.id);
  const ids = ropeLandIds();
  ok(ids.join() === 'rope-land-level,rope-land-knee,rope-land-between,rope-land-waist,rope-land-none' && ids.every((id) => all.includes(id)), `the rope's landings are five pieces (${ids.join(', ')}), stood with \`ropeLands\``);
  ok(ids.every((id) => !plain.includes(id) && !courseIds().includes(id) && !COURSE_TWO_IDS.includes(id) && !extraIds().includes(id)), "and only with it: no other list of the course's holds them, so every digest of the course before them stands as it was");
  const c = climbCourse({ ropeLands: true, pieces: ids });
  const tops = c.pieces.map((p) => (p.numbers?.top as number | undefined) ?? null);
  ok(tops.slice(0, 4).every((t, i) => t === ROPE_LAND_TOPS[BANDS[i]]) && tops[4] === null && c.pieces.every((p) => p.kind === 'rope' && p.solids.some((s) => s.role === 'rope')), `each a rope from a beam over level floor, the platform's top ${BANDS.map((b) => `${b} ${ROPE_LAND_TOPS[b]} m`).join(', ')} over the floor (the feet hang 1.25 m up at the let-go: a lip in each band), and one with nothing ahead`);
  const labels = c.pieces.map((p) => pieceLabel(p).title);
  ok(labels.every((l) => /^Rope swing/.test(l)) && labels[4] === 'Rope swing with nothing ahead' && labels[2].includes('between knee and waist'), `each with a label of its own (${labels.join('; ')})`);
}

// ---- the figure: the flight's and the landings' clips on the game's own rig, and the plant -------------------------------------
const X = new THREE.Vector3(1, 0, 0);
const VA = new THREE.Vector3();
const VB = new THREE.Vector3();
const VH = new THREE.Vector3();
interface RopeFigure {
  F: Figure;
  tab: NonNullable<ReturnType<typeof measureRopeTables>>;
}
function ropeFigure(): RopeFigure {
  const F = figure();
  const tab = measureRopeTables(F.rig as never)!;
  F.rig.twinClip(ROPE_CLIP_NAMES[ROPE_SWING], ROPE_SWING_TWIN);
  return { F, tab };
}
/** The figure's root's lowest ankle in its own frame, scaled (the player's `plantRopeFeet`'s reading). */
function ankleLowOf(F: Figure): number {
  F.root.updateMatrixWorld(true);
  F.rig.boneNamed('lAnkle')!.getWorldPosition(VA);
  F.rig.boneNamed('rAnkle')!.getWorldPosition(VB);
  F.root.worldToLocal(VA);
  F.root.worldToLocal(VB);
  return (VA.y < VB.y ? VA.y : VB.y) * F.root.scale.y;
}
/** The game's rope frame on the figure after the body's (the player's `animateRope`, `placeVisual`'s plant and `applyRopeRoot`). */
function draw(b: Body, R: RopeFigure, dt: number): void {
  const S = b.rope;
  const F = R.F;
  S.landTables = measureCache.get(F) ?? null;
  S.placeFigure(R.tab, F.root.scale.y, b.pos);
  driveRopeClips(F.rig as never, S as never, dt, F.hang);
  F.group.position.set(b.pos.x, b.pos.y, b.pos.z);
  F.group.rotation.set(0, S.heading, 0);
  if (S.offset && S.plantY === S.plantY) {
    S.ankleLow = ankleLowOf(F);
    S.plantFeet(b.pos);
  }
  const c = Math.cos(S.heading);
  const s = Math.sin(S.heading);
  F.root.position.set(S.offX * c - S.offZ * s, S.offY, S.offX * s + S.offZ * c);
  F.root.quaternion.setFromAxisAngle(X, S.tilt);
  F.group.updateMatrixWorld(true);
}
const measureCache = new Map<Figure, ReturnType<typeof measureRopeLandTables>>();
const hipsOf = (F: Figure): THREE.Vector3 => {
  let root: THREE.Object3D | null = null;
  F.root.traverse((o) => {
    if (!root && (o as THREE.Bone).isBone && !(o.parent as THREE.Bone).isBone) root = o;
  });
  return (root as unknown as THREE.Object3D).getWorldPosition(VH);
};
const lowAnkleY = (F: Figure): number => {
  const a = F.rig.boneNamed('lAnkle')!.getWorldPosition(VA).y;
  const c = F.rig.boneNamed('rAnkle')!.getWorldPosition(VB).y;
  return a < c ? a : c;
};

// ---- a let-go into each landing -----------------------------------------------------------------------------------------------
/** A piece's rope grabbed standing by it (E), A held 9 s pumping the swing, the let-go waited for on the forward swing. */
async function onSwing(id: string, fps: number): Promise<{ s: Stood; b: Body }> {
  const s = await standPiece(climbCourse({ ropeLands: true, pieces: [id] }).pieces[0]);
  const { b } = bodyAt(s, 'stand', fps);
  b.rope.ropes = s.ropes;
  tap(b, 'KeyE', fps);
  for (let i = 0; i < fps; i++) b.frame(1 / fps);
  b.key('KeyA', true);
  for (let i = 0; i < 9 * fps; i++) b.frame(1 / fps);
  for (let i = 0; i < 6 * fps && !(b.rope.om > 0 && b.rope.th >= LET_GO); i++) b.frame(1 / fps);
  b.key('KeyA', false);
  return { s, b };
}
/** How far the body's capsule (its segment 0.35 to 1.25 m over the feet, 0.35 round) reaches into a box in the world, metres (≤ 0 clear). */
function intoBox(b: Body, lo: readonly number[], hi: readonly number[]): number {
  let worst = -Infinity;
  for (let i = 0; i <= 12; i++) {
    const y = b.pos.y + LEDGE_CAPSULE.r + (i / 12) * (2 * LEDGE_CAPSULE.stand);
    const dx = Math.max(lo[0] - b.pos.x, 0, b.pos.x - hi[0]);
    const dy = Math.max(lo[1] - y, 0, y - hi[1]);
    const dz = Math.max(lo[2] - b.pos.z, 0, b.pos.z - hi[2]);
    const d = Math.hypot(dx, dy, dz);
    // Inside the box: how deep the point is (negative distance), else how far off.
    const inside = dx === 0 && dy === 0 && dz === 0 ? -Math.min(b.pos.x - lo[0], hi[0] - b.pos.x, y - lo[1], hi[1] - y, b.pos.z - lo[2], hi[2] - b.pos.z) : d;
    worst = Math.max(worst, LEDGE_CAPSULE.r - inside);
  }
  return worst;
}
{
  const rows: string[] = [];
  const outcome = new Map<string, string[]>();
  let bandsOk = true;
  let stoodOk = true;
  let clearOk = true;
  let clipsOk = true;
  let flightOk = true;
  let plantOk = true;
  let feetOk = true;
  let promptOk = true;
  let noneOk = true;
  for (const fps of RATES) {
    const dt = 1 / fps;
    for (let bi = 0; bi < 5; bi++) {
      const id = bi < 4 ? `rope-land-${BANDS[bi]}` : 'rope-land-none';
      const { s, b } = await onSwing(id, fps);
      const ground = s.frame.ref(s.piece);
      const top = bi < 4 ? ground + ROPE_LAND_TOPS[BANDS[bi]] : Number.NaN;
      // The figure drawn from the let-go on (a fresh rig a run: what each rate draws is its own).
      const F = ropeFigure();
      measureCache.set(F.F, measureRopeLandTables(F.F.rig as never));
      draw(b, F, dt);
      const held = b.rope.onRope;
      const promptHang = b.rope.promptWord();
      b.key('Space', true);
      b.frame(dt);
      b.key('Space', false);
      draw(b, F, dt);
      const flew = b.rope.phase === ROPE_FLY;
      const band = b.rope.band;
      const promptFly = b.rope.promptWord();
      let deepest = -Infinity;
      let landClip = '';
      let landFrom = Number.NaN;
      let hipsWorst = 0;
      let plantWorst = -Infinity;
      let wasLand = false;
      let end = '';
      let endedAt = -1;
      for (let i = 0; i < 4 * fps; i++) {
        const ph = b.rope.phase;
        b.frame(dt);
        draw(b, F, dt);
        if (ph !== ROPE_NONE && b.rope.phase === ROPE_NONE && !end) {
          end = b.rope.flyEnd || 'plain';
          endedAt = i;
        }
        if (b.rope.phase === ROPE_FLY || b.rope.phase === ROPE_LAND || (end && i - endedAt < 2)) {
          if (bi < 4) deepest = Math.max(deepest, intoBox(b, [-2, ground, 9.5], [2, top, 12.5]));
        }
        if (b.rope.phase === ROPE_LAND && !wasLand) {
          wasLand = true;
          landClip = b.rope.airClip;
          landFrom = b.rope.airT;
        }
        // In the flight, once eased in from the swing's placement: the drawn hips at the flying body's middle (led by at most a step).
        if (b.rope.phase === ROPE_FLY && b.rope.flyT > CLIMB_TUNE.ease + 2 * dt) {
          const h = hipsOf(F.F);
          hipsWorst = Math.max(hipsWorst, Math.hypot(h.x - b.pos.x, h.y - (b.pos.y + MID), h.z - b.pos.z));
        }
        // As the landing's drawn offset eases out: the drawn lower ankle never under the top (its own rest over it).
        if (end === 'landed' && b.rope.offset && b.rope.plantY === b.rope.plantY) plantWorst = Math.max(plantWorst, top + LEDGE_REST.ankle * (b.rope.hang / ROPE_FACTS.hang) - lowAnkleY(F.F));
      }
      const feetAfter = bi < 4 ? lowAnkleY(F.F) - (top + LEDGE_REST.ankle * (b.rope.hang / ROPE_FACTS.hang)) : 0;
      const standZ = b.pos.z;
      const feet = b.pos.y - ground;
      const key = `${b.rope.band}:${end}:${standZ.toFixed(2)}:${feet.toFixed(2)}`;
      const list = outcome.get(id) ?? [];
      list.push(key);
      outcome.set(id, list);
      promptOk &&= held && promptHang === 'hang' && (bi === 4 ? promptFly === '' : promptFly === 'fly');
      if (bi < 4) {
        bandsOk &&= held && flew && band === bi && end === 'landed' && b.rope.landings[bi] === 1 && b.rope.plains === 0;
        stoodOk &&= Math.abs(b.pos.y - top) < 0.01 && b.grounded && standZ > 9.5 + LEDGE_CAPSULE.r && b.rope.flights === 1;
        clearOk &&= deepest < 0.02;
        clipsOk &&= landClip === ROPE_BAND_CLIPS[bi] && Math.abs(landFrom - (bi === 0 ? ROPE_TIMES.levelTouch : ROPE_BAND_FROM[bi])) < 1 / 30 + 1e-9;
        flightOk &&= hipsWorst < 0.12;
        plantOk &&= plantWorst < 0.005;
        feetOk &&= Math.abs(feetAfter) < 0.06;
        if (fps === 60 || !(held && flew && band === bi && end === 'landed')) rows.push(`${id} at ${fps}: ${flew ? `flew, the ${ROPE_BAND_NAMES[band] ?? 'no'} band, ended "${end}" on the top ${(b.pos.y - ground).toFixed(2)} m up, ${(standZ - 9.5).toFixed(2)} m in past the face, the capsule ${(deepest * 100).toFixed(1)} cm into the platform at the most; the drawn hips ${(hipsWorst * 100).toFixed(1)} cm off the flying body's middle; the drawn ankle ${(plantWorst * 100).toFixed(1)} cm under the top at the most as the landing eased out, ${(feetAfter * 100).toFixed(1)} cm off it after` : 'never flew'}`);
      } else {
        noneOk &&= held && !flew && b.rope.flights === 0 && b.rope.plains === 1 && b.grounded && Math.abs(feet) < 0.05 && standZ > 6;
        if (fps === 60 || !noneOk) rows.push(`${id} at ${fps}: ${flew ? 'flew' : 'let go the plain way'}, ${b.rope.plains} plain let-go, the feet ${feet.toFixed(2)} m up ${(standZ - 5).toFixed(2)} m on, ${b.grounded ? 'on the ground' : 'not on the ground'}`);
      }
    }
  }
  ok(bandsOk, `on each landing piece, E standing by the rope, A pumping 9 s, Space on the forward swing: the flight foreseen and flown, landed in the band its lip's height names, at every rate (${rows.filter((r) => !r.includes('none')).join('; ')})`);
  ok(stoodOk, 'and the body stood on the top (its feet on it to the centimetre, on the ground, in past the face), at every rate');
  ok(clearOk, 'the capsule never in the platform through the flight and the landing (less than 2 cm, the controller\'s own skin), at every rate');
  ok(clipsOk, "each band plays its own clip from the owner's second (the level one the flight's own clip on from its foot's touch)");
  ok(flightOk, 'the flight\'s figure: once eased in from the swing, its hips drawn at the flying body\'s middle (within 12 cm: the frame\'s own time past the last step, at the flight\'s speed)');
  ok(plantOk, "as the landing's drawn offset eases out (the rig's crossfade into the crouch), the drawn lower ankle never under the top, at every rate");
  ok(feetOk, 'and after it the drawn feet on the top (within 6 cm: the crouch the test\'s figure ends in, the game\'s next state its movement\'s own)');
  ok(noneOk, `with nothing ahead, Space is the plain let-go: a fall and the movement's own landing on the floor beyond, at every rate (${rows.filter((r) => r.includes('none')).join('; ')})`);
  ok(promptOk, "on the rope the rope's words are the hang's (Space let go, the crouch drop), in the flight none");
  const alike: string[] = [];
  let alikeOk = true;
  for (const [id, list] of outcome) {
    const parts = list.map((k) => k.split(':'));
    const z = parts.map((p) => Number(p[2]));
    const same = parts.every((p) => p[0] === parts[0][0] && p[1] === parts[0][1]) && Math.max(...z) - Math.min(...z) < (id === 'rope-land-none' ? 0.2 : 0.011);
    alikeOk &&= same;
    alike.push(`${id}: ${list.join(' / ')}`);
  }
  ok(alikeOk, `the same band, the same end and the same stand at 30, 60, 144 and 240 frames a second (to a centimetre; with nothing ahead the movement's own landing, within its own few centimetres) (${alike.join('; ')})`);
}

// ---- 'plain', a hard blow, the water -------------------------------------------------------------------------------------------
{
  const rows: string[] = [];
  let plainOk = true;
  let knockOk = true;
  let waterOk = true;
  let flyWaterOk = true;
  for (const fps of RATES) {
    const dt = 1 / fps;
    // 'plain': Space hands the body the swing's own velocity and no flight (maker A's let-go), a lip ahead or none.
    {
      tuneClimb({ ropeLand: 'plain' });
      const { b } = await onSwing('rope-land-waist', fps);
      tap(b, 'Space', fps);
      const v = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
      plainOk &&= !b.rope.holding && b.rope.flights === 0 && b.rope.plains === 1 && v > 1 && b.rope.casts >= 0;
      fresh();
    }
    // A blow of 10 keeps the rope; one of the bar's knock knocks the body off, straight down (no flight, no level speed).
    {
      const { b } = await onSwing('rope-land-level', fps);
      b.takeDamage(10, false, 'blow');
      b.frame(dt);
      const kept = b.rope.onRope;
      b.takeDamage(CLIMB_TUNE.barKnock, false, 'blow');
      b.frame(dt);
      knockOk &&= kept && !b.rope.holding && b.rope.flights === 0 && Math.hypot(b.vel.x, b.vel.z) < 1e-9;
      if (fps === 60) rows.push(`a blow of 10 kept the rope (${kept}), one of ${CLIMB_TUNE.barKnock} knocked the body off (${!b.rope.holding})`);
    }
    // The water risen round the hanging body's feet (the swim's own line): it lets go, straight down, into the swim.
    {
      const s = await standPiece(climbCourse({ ropeLands: true, pieces: ['rope-land-none'] }).pieces[0]);
      const { b } = bodyAt(s, 'stand', fps);
      b.rope.ropes = s.ropes;
      tap(b, 'KeyE', fps);
      for (let i = 0; i < fps; i++) b.frame(dt);
      const held = b.rope.onRope;
      const feet = b.pos.y;
      b.surface = () => feet + SWIM_DEPTH + 0.2;
      let end = '';
      for (let i = 0; i < 2 * fps && !end; i++) {
        const was = b.rope.holding;
        b.frame(dt);
        if (was && !b.rope.holding) end = b.rope.flyEnd || 'plain';
      }
      for (let i = 0; i < fps; i++) b.frame(dt);
      waterOk &&= held && end === 'water' && b.swimming;
      if (fps === 60 || !(held && end === 'water' && b.swimming)) rows.push(`water at the hanging feet at ${fps}: let go "${end}", swimming ${b.swimming}`);
    }
    // A flight that crosses into water past the let-go (the water deep past 7 m on, the platform's face 9.5): it ends there and the body swims.
    {
      const { s, b } = await onSwing('rope-land-waist', fps);
      const ground = s.frame.ref(s.piece);
      b.surface = (_x: number, z: number) => (z > 8.7 ? ground + 2.6 : Number.NEGATIVE_INFINITY);
      tap(b, 'Space', fps);
      const flew = b.rope.flights === 1;
      let end = '';
      for (let i = 0; i < 2 * fps && !end; i++) {
        const was = b.rope.holding;
        b.frame(dt);
        if (was && !b.rope.holding) end = b.rope.flyEnd;
      }
      for (let i = 0; i < 3; i++) b.frame(dt);
      flyWaterOk &&= flew && end === 'water' && b.rope.landings.every((n) => n === 0) && b.swimming;
      if (fps === 60 || !(flew && end === 'water')) rows.push(`a flight into water at ${fps}: flew ${flew}, ended "${end}", swimming ${b.swimming}`);
    }
  }
  ok(plainOk, "under `climb.ropeLand` 'plain' Space is maker A's let-go: the swing's own velocity handed to the movement, no flight, a lip ahead or none");
  ok(knockOk, `a blow of climb.barKnock (${CLIMB_TUNE.barKnock}) or more knocks the body off the rope, straight down; a smaller one keeps it, at every rate (${rows.filter((r) => r.startsWith('a blow')).join('; ')})`);
  ok(waterOk, `water risen to the swim's line at the hanging feet lets go of the rope, straight down, into the swim, at every rate (${rows.filter((r) => r.startsWith('water')).join('; ')})`);
  ok(flyWaterOk, `a flight off the rope into water ends there and the body swims, at every rate (${rows.filter((r) => r.startsWith('a flight')).join('; ')})`);
}

// ---- another player's game, and the action bar ---------------------------------------------------------------------------------
{
  // On a still hang, the place the wire carries for a free hang (`peerPlace`): another player's game stands its free hang there
  // (`PeerHang`), its drawn hands near the grip on the rope.
  const s = await standPiece(climbCourse({ ropeLands: true, pieces: ['rope-land-none'] }).pieces[0]);
  const { b } = bodyAt(s, 'stand', 60);
  b.rope.ropes = s.ropes;
  tap(b, 'KeyE', 60);
  for (let i = 0; i < 120; i++) b.frame(1 / 60);
  const R = b.rope;
  const at = R.peerPlace(new THREE.Vector3());
  const P = figure();
  P.rig.setState('hangFree' as never, 0, null);
  P.rig.update(0.4);
  P.group.position.copy(at);
  P.group.rotation.set(0, R.heading, 0);
  P.root.position.set(0, 0, 0);
  P.group.updateMatrixWorld(true);
  const h = new PeerHang(() => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }), (hh, rr) => new RAPIER.Capsule(hh, rr));
  const q = new PeerHangIn();
  q.state = 'hangFree';
  q.x = at.x;
  q.y = at.y;
  q.z = at.z;
  q.heading = R.heading;
  q.scale = 1;
  q.dt = 1 / 60;
  h.step(P.rig as never, null, q);
  P.group.updateMatrixWorld(true);
  const G = new THREE.Vector3();
  for (const n of ['lWrist', 'lIndex01', 'rWrist', 'rIndex01']) G.add(P.rig.boneNamed(n)!.getWorldPosition(new THREE.Vector3()));
  G.multiplyScalar(0.25);
  const r = R.rope!;
  const g = R.s + R.e;
  const sn = Math.sin(R.thDraw);
  const off = Math.hypot(G.x - (r.ax + g * sn * R.fx), G.y - (r.ay - g * Math.cos(R.thDraw)), G.z - (r.az + g * sn * R.fz));
  ok(off < 0.15, `another player's game, told a free hang at the rope's \`peerPlace\` (the wire carries no swing), draws its hands ${(off * 100).toFixed(1)} cm off the grip on the rope: the nearest pose it has`);
  // The rope itself goes as a held rope with its anchor twice and nothing else (`ropeForWire`), which another player's game reads
  // as one anchor, the rope drawn from it to their hand with no dart.
  const pr = newPeerRope();
  const read = readPeerRope([1, 0, r.ax, r.ay, r.az, r.ax, r.ay, r.az], undefined, 0, pr);
  ok(read && pr.kind === 1 && pr.hung && pr.count === 1 && pr.pts[0] === r.ax, "a hanging rope's mark (its anchor twice) reads as a held rope of one point, marked hung");
  const hook = newPeerRope();
  readPeerRope([1, 0, 3, 12, -2, 1, 6, -1], undefined, 0, hook);
  ok(!hook.hung && hook.count === 2, "and a hook's held rope is never taken for one");

  const st = newPromptState();
  const out = Array.from({ length: 4 }, () => ({ action: '', code: '', label: '' }));
  const fill = (fields: Partial<typeof st>) => {
    Object.assign(st, newPromptState(), { live: true }, fields);
    const n = fillActions(st, out);
    return out.slice(0, n).map((a) => `${a.action}:${a.label}`);
  };
  const onRope = fill({ bar: R.promptWord() });
  const ground1 = fill({ climb: 'ground', climbBar: true });
  ok(onRope.join(',') === `jump:${PROMPT_WORDS.barLetGo},crouch:${PROMPT_WORDS.barDrop}`, `on a rope the bar offers Space ${PROMPT_WORDS.barLetGo} and the crouch ${PROMPT_WORDS.barDrop} (${onRope.join(', ')})`);
  ok(ground1.join(',') === `mount:${PROMPT_WORDS.grabBar}`, `and a rope in reach is E ${PROMPT_WORDS.grabBar} (${ground1.join(', ')})`);
}

// ---- the fixer's: the ropes swing on whatever has the body, the carry asks its room, a top's edge -----------------------------
{
  const { courseToWorld } = await import('../../../src/anim/climbCourseBuild.ts');
  const { HangingRope } = await import('../../../src/player/hangingRope.ts');
  /** A piece's rope grabbed standing by it, pumped by A for 9 s and let go of on the forward swing past `at`; `more` adds colliders to its world first. */
  const swingWith = async (id: string, fps: number, at: number, more?: (s: Stood) => void): Promise<{ s: Stood; b: Body }> => {
    const s = await standPiece(climbCourse({ ropeLands: true, pieces: [id] }).pieces[0]);
    if (more) {
      more(s);
      s.physics.stepOnce();
    }
    const { b } = bodyAt(s, 'stand', fps);
    b.rope.ropes = s.ropes;
    tap(b, 'KeyE', fps);
    for (let i = 0; i < fps; i++) b.frame(1 / fps);
    b.key('KeyA', true);
    for (let i = 0; i < 9 * fps; i++) b.frame(1 / fps);
    for (let i = 0; i < 6 * fps && !(b.rope.om > 0 && b.rope.th >= at); i++) b.frame(1 / fps);
    b.key('KeyA', false);
    return { s, b };
  };
  /** A box of the piece's own frame stood as a still collider; its corners in the world back. */
  const boxIn = (s: Stood, a: readonly number[], c: readonly number[]): { lo: number[]; hi: number[] } => {
    const w = { x: 0, y: 0, z: 0 };
    courseToWorld(s.frame, s.piece, a[0], a[1], a[2], w);
    const p = [w.x, w.y, w.z];
    courseToWorld(s.frame, s.piece, c[0], c[1], c[2], w);
    const q = [w.x, w.y, w.z];
    const lo = [0, 1, 2].map((i) => Math.min(p[i], q[i]));
    const hi = [0, 1, 2].map((i) => Math.max(p[i], q[i]));
    s.physics.world.createCollider(RAPIER.ColliderDesc.cuboid((hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2).setTranslation((hi[0] + lo[0]) / 2, (hi[1] + lo[1]) / 2, (hi[2] + lo[2]) / 2));
    return { lo, hi };
  };

  // 1. A rope let go of into a landing swings on through the flight and the landing (it hung still at its let-go angle), and
  // every rope nobody holds is swung exactly once a frame whatever has the body: a second rope far off, held to a rope swung
  // alone frame by frame, through the standing, the grab's frame, the hang, the let-go, the flight, the landing and after.
  {
    const rows: string[] = [];
    let movesOk = true;
    let onceOk = true;
    const at2: number[] = [];
    for (const fps of [30, 144]) {
      fresh();
      const dt = 1 / fps;
      const s = await standPiece(climbCourse({ ropeLands: true, pieces: ['rope-land-knee'] }).pieces[0]);
      const { b } = bodyAt(s, 'stand', fps);
      const far = new HangingRope('a far rope', b.pos.x + 60, b.pos.y + 8, b.pos.z);
      const ref = new HangingRope('its twin, swung alone', b.pos.x + 60, b.pos.y + 8, b.pos.z);
      far.th = ref.th = 0.5;
      b.rope.ropes = s.ropes.concat([far]);
      const frame = () => {
        b.frame(dt);
        ref.dt = dt;
        ref.stepFree();
        onceOk &&= far.th === ref.th && far.om === ref.om;
      };
      b.key('KeyE', true);
      frame();
      b.key('KeyE', false);
      for (let i = 0; i < fps; i++) frame();
      b.key('KeyA', true);
      for (let i = 0; i < 9 * fps; i++) frame();
      for (let i = 0; i < 6 * fps && !(b.rope.om > 0 && b.rope.th >= LET_GO); i++) frame();
      b.key('KeyA', false);
      const r = s.ropes[0];
      b.key('Space', true);
      frame();
      b.key('Space', false);
      const th0 = r.th;
      let air = 0;
      let moved = 0;
      let landedTh = Number.NaN;
      for (let i = 0; i < 2 * fps - 1; i++) {
        const was = r.th;
        const ph = b.rope.phase;
        frame();
        if (ph === ROPE_FLY || ph === ROPE_LAND) {
          air++;
          if (r.th !== was) moved++;
          if (b.rope.phase === ROPE_NONE) landedTh = r.th;
        }
      }
      at2.push(r.th);
      for (let i = 0; i < fps; i++) frame();
      movesOk &&= air > 0 && moved >= air / 3 && Math.abs(landedTh - th0) > 5 / DEG && b.rope.flyEnd === 'landed';
      rows.push(`${fps}: let go at ${(th0 * DEG).toFixed(2)}°, ${air} frames flying and landing, the rope stepped on ${moved} of them, ${(landedTh * DEG).toFixed(2)}° as the landing ended, ${(at2[at2.length - 1] * DEG).toFixed(2)}° 2 s after the let-go`);
    }
    ok(movesOk, `a rope let go of into a landing swings on by itself through the flight and the landing, on the physics' own steps (${rows.join('; ')})`);
    ok(Math.abs(at2[0] - at2[1]) < 1 / DEG, `and alike at 30 and 144 frames a second (${(at2[0] * DEG).toFixed(2)}° and ${(at2[1] * DEG).toFixed(2)}° two seconds after the let-go)`);
    ok(onceOk, "and a rope nobody holds is swung exactly once a frame whatever has the body (a far one held to its twin swung alone, to the bit, through the standing, the grab's frame, the hang, the let-go, the flight, the landing and after)");
  }

  // 2. A landing whose carry up the face and in over the top meets something (a lintel over the lip: a low window with room to
  // stand behind it) is the plain let-go, the capsule never in what it would have met; the same lintel high enough for the
  // standing body to pass under still lands.
  {
    const rows: string[] = [];
    let refusedOk = true;
    let passOk = true;
    const id = 'rope-land-knee';
    const top = ROPE_LAND_TOPS.knee;
    for (const fps of [30, 144]) {
      for (const over of [1.0, 1.75]) {
        fresh();
        let lintel = { lo: [0, 0, 0], hi: [0, 0, 0] };
        const { b } = await swingWith(id, fps, LET_GO, (s) => {
          lintel = boxIn(s, [-2, top + over, 9.5], [2, top + over + 0.25, 9.75]);
        });
        b.key('Space', true);
        b.frame(1 / fps);
        b.key('Space', false);
        let deepest = -Infinity;
        for (let i = 0; i < 4 * fps; i++) {
          b.frame(1 / fps);
          deepest = Math.max(deepest, intoBox(b, lintel.lo, lintel.hi));
        }
        const R = b.rope;
        if (over < 1.5) refusedOk &&= R.flights === 0 && R.plains === 1 && deepest < 0.005;
        else passOk &&= R.flights === 1 && R.landings[1] === 1 && R.flyEnd === 'landed' && b.grounded && deepest < 0.005;
        rows.push(`${fps} fps, the lintel ${over} m over the top: ${R.flights ? `flew and ${R.flyEnd || 'flew on'} (${ROPE_BAND_NAMES[R.band] ?? 'no band'})` : `the plain let-go (${R.plains})`}, the capsule ${(deepest * 100).toFixed(1)} cm into the lintel at the most`);
      }
    }
    ok(refusedOk, `a landing whose carry meets a lintel over its lip is the plain let-go, the body never carried into it, at 30 and 144 (${rows.filter((r) => r.includes(' 1 m')).join('; ')})`);
    ok(passOk, `and the same lintel high enough for the standing body to pass under still lands, in its band, under it (${rows.filter((r) => r.includes('1.75 m')).join('; ')})`);
    // The carry rises where the landing will begin, the flight's very steps replayed (the waist clip's braced foot reaches 0.72 m
    // ahead of the hips, so it begins that far off the face), never where the flight would have met the face: a ledge standing
    // out from over the face, clear of the flight under it and of a body risen beside the face, but over that begin, refuses it.
    const rows2: string[] = [];
    let beginOk = true;
    const wt = ROPE_LAND_TOPS.waist;
    for (const fps of [30, 144]) {
      fresh();
      let over = { lo: [0, 0, 0], hi: [0, 0, 0] };
      const { b } = await swingWith('rope-land-waist', fps, LET_GO, (s) => {
        over = boxIn(s, [-2, wt + 0.95, 8.5], [2, wt + 1.15, 8.75]);
      });
      b.key('Space', true);
      b.frame(1 / fps);
      b.key('Space', false);
      let deepest = -Infinity;
      for (let i = 0; i < 4 * fps; i++) {
        b.frame(1 / fps);
        deepest = Math.max(deepest, intoBox(b, over.lo, over.hi));
      }
      const R = b.rope;
      beginOk &&= R.flights === 0 && R.plains === 1 && deepest < 0.005;
      rows2.push(`${fps} fps: ${R.flights ? `flew and ${R.flyEnd || 'flew on'}` : 'the plain let-go'}, the capsule ${(deepest * 100).toFixed(1)} cm into the ledge at the most`);
    }
    ok(beginOk, `and the carry is asked where the landing will begin (the flight's steps replayed to the clip's reach off the face): a ledge over that place, clear of the flight under it, refuses the waist landing (${rows2.join('; ')})`);
    // And asked again where the flight meets what it lands on (`flyStep`): a platform of our own (its lip 1.45 m up, a knee landing
    // whose clip reaches no further than the capsule's own radius, so it is begun where the flight meets the face), and a beam
    // stood just in past that face after the let-go (a door shut while the body flies), clear of the flying body and of the
    // stand, in the carry's way alone: the flight ends where it meets the face, the body never carried into the beam.
    const rows3: string[] = [];
    let shutOk = true;
    for (const fps of [30, 144]) {
      fresh();
      const top3 = 1.45;
      const { s: s3, b: b3 } = await swingWith('rope-land-none', fps, LET_GO, (s) => {
        boxIn(s, [-2, 0, 9.5], [2, top3, 12.5]);
      });
      b3.key('Space', true);
      b3.frame(1 / fps);
      b3.key('Space', false);
      const flewFirst = b3.rope.phase === ROPE_FLY && b3.rope.band >= 0;
      const shut = boxIn(s3, [-2, top3 + 1.0, 9.53], [2, top3 + 1.25, 9.74]);
      let deepest3 = -Infinity;
      for (let i = 0; i < 4 * fps; i++) {
        b3.frame(1 / fps);
        deepest3 = Math.max(deepest3, intoBox(b3, shut.lo, shut.hi));
      }
      shutOk &&= flewFirst && b3.rope.flyEnd === 'wall' && b3.rope.landings.every((n) => n === 0) && deepest3 < 0.005;
      rows3.push(`${fps} fps: ${flewFirst ? `flew to a ${ROPE_BAND_NAMES[b3.rope.band]} landing` : `never flew to a landing (${b3.rope.flights} flights)`}, ended "${b3.rope.flyEnd}", the capsule ${(deepest3 * 100).toFixed(1)} cm into the beam at the most`);
    }
    ok(shutOk, `a beam stood in the carry's way after the let-go ends the flight where it meets the face, the body never carried into it (${rows3.join('; ')})`);
    // A top too thin to stand on in past its face (a wall 0.25 m thick at a knee's height) is no landing: the plain let-go, where
    // the body was stood in the air beyond it.
    const rows4: string[] = [];
    let thinOk = true;
    for (const fps of [30, 144]) {
      fresh();
      const { b: b4 } = await swingWith('rope-land-none', fps, LET_GO, (s) => {
        boxIn(s, [-2, 0, 9.5], [2, ROPE_LAND_TOPS.knee, 9.75]);
      });
      b4.key('Space', true);
      b4.frame(1 / fps);
      b4.key('Space', false);
      for (let i = 0; i < 4 * fps; i++) b4.frame(1 / fps);
      const R4 = b4.rope;
      thinOk &&= R4.flights === 0 && R4.plains === 1;
      rows4.push(`${fps} fps: ${R4.flights ? `flew and ${R4.flyEnd}, stood ${b4.pos.y.toFixed(2)} m up at ${b4.pos.z.toFixed(2)}` : 'the plain let-go'}`);
    }
    ok(thinOk, `a top too thin to stand on in past its face is no landing, the plain let-go (${rows4.join('; ')})`);
  }

  // 3. A level landing whose flight meets the top's very edge with the body's middle out past the face (a let-go a little late on
  // the level piece) is stood in past the face on the top, not on the corner outside it; one met on the top proper stands where
  // its feet came down.
  {
    const rows: string[] = [];
    let edgeOk = true;
    let overOk = true;
    const top = ROPE_LAND_TOPS.level;
    for (const [fps, at] of [[60, 30], [60, 32], [30, 30], [144, 30]] as const) {
      fresh();
      const { s, b } = await swingWith('rope-land-level', fps, at / DEG);
      const ground = s.frame.ref(s.piece);
      const letAt = b.rope.th * DEG;
      b.key('Space', true);
      b.frame(1 / fps);
      b.key('Space', false);
      let deepest = -Infinity;
      for (let i = 0; i < 4 * fps; i++) {
        b.frame(1 / fps);
        deepest = Math.max(deepest, intoBox(b, [-2, ground, 9.5], [2, ground + top, 12.5]));
      }
      const R = b.rope;
      const z = b.pos.z;
      const landed = R.flyEnd === 'landed' && R.landings[0] === 1;
      // Wherever a level landing stood the body, its middle is over the top (past the face) and its feet on it, the capsule out of the platform.
      overOk &&= !landed || (z > 9.5 && Math.abs(b.pos.y - ground - top) < 0.012 && b.grounded && deepest < 0.02);
      // The edge's own case (60 fps, 30 degrees, the review's): stood in past the face by the capsule's radius and `ropeLandIn`.
      if (fps === 60 && at === 30) edgeOk &&= landed && Math.abs(z - (9.5 + LEDGE_CAPSULE.r + CLIMB_TUNE.ropeLandIn)) < 0.02;
      rows.push(`${fps} fps let go at ${letAt.toFixed(2)}°: ${landed ? `landed level, the body's middle ${(z - 9.5).toFixed(3)} m in past the face, ${(b.pos.y - ground - top).toFixed(3)} m over the top` : R.plains ? 'the plain let-go' : `ended ${R.flyEnd}`}, the capsule ${(deepest * 100).toFixed(1)} cm into the platform at the most`);
    }
    ok(edgeOk, `a level landing met on the top's edge with the body's middle out past the face is stood in past it (${rows[0]})`);
    ok(overOk, `and wherever a level landing stands the body, its middle is over the top and its feet on it, the capsule clear of the platform (${rows.join('; ')})`);
  }

  // 4. The course's landings are laid for the figure standing: each platform's lip at the middle of its band (scaled) over the
  // feet at the proof's let-go, where they sat in the bands' lower parts and a taller figure landed each a band lower (the
  // review's human male at the height slider's top, `figureScaleOf` 1.11, landed the knee piece level in the game). A figure
  // of another size, on a course laid for it, lands each piece in its own band at 30 and 144.
  {
    const { ROPE_LAND_LIPS, ROPE_LAND_MID, ropeLandFeet, ropeLandTops } = await import('../../../src/anim/climbCourse.ts');
    const f1 = ropeLandFeet(1);
    ok(ROPE_LAND_MID === LEDGE_CAPSULE.r + LEDGE_CAPSULE.stand && BANDS.every((b) => Math.abs(ROPE_LAND_TOPS[b] - f1 - ROPE_LAND_LIPS[b]) <= 0.005), `the human male's platforms stand each band's middle over the feet at a 28-degree let-go (the feet ${f1.toFixed(3)} m up: ${BANDS.map((b) => `${b} ${ROPE_LAND_TOPS[b]} m`).join(', ')})`);
    const rows: string[] = [];
    let sizesOk = true;
    for (const k of [0.85, 1.11]) {
      const tops = ropeLandTops(k);
      for (const fps of [30, 144]) {
        for (let bi = 0; bi < 4; bi++) {
          fresh();
          const s = await standPiece(climbCourse({ ropeLands: true, pieces: [`rope-land-${BANDS[bi]}`], ropeScale: k }).pieces[0]);
          const { b } = bodyAt(s, 'stand', fps);
          (b as unknown as { ledgeScale: number }).ledgeScale = k;
          b.rope.ropes = s.ropes;
          tap(b, 'KeyE', fps);
          for (let i = 0; i < fps; i++) b.frame(1 / fps);
          b.key('KeyA', true);
          for (let i = 0; i < 9 * fps; i++) b.frame(1 / fps);
          let prev = 1e9;
          for (let i = 0; i < 8 * fps; i++) {
            if (b.rope.om > 0 && b.rope.th >= LET_GO && prev < LET_GO) break;
            prev = b.rope.th;
            b.frame(1 / fps);
          }
          b.key('KeyA', false);
          tap(b, 'Space', fps);
          for (let i = 0; i < 3 * fps; i++) b.frame(1 / fps);
          const R = b.rope;
          const landed = R.flyEnd === 'landed' && R.landings[bi] === 1 && Math.abs(b.pos.y - s.frame.ref(s.piece) - tops[BANDS[bi]]) < 0.012;
          sizesOk &&= landed;
          if (!landed || (fps === 30 && bi === 1)) rows.push(`${k} at ${fps}: the ${BANDS[bi]} piece (${tops[BANDS[bi]]} m) ${R.flyEnd === 'landed' ? `landed ${ROPE_BAND_NAMES[R.band]}` : R.plains ? 'let go the plain way' : `ended ${R.flyEnd}`}`);
        }
      }
    }
    ok(sizesOk, `a figure of 0.85 and of 1.11 the human male's size, on a course laid for it, lands every piece in its own band and stands on its top, at 30 and 144 (${rows.join('; ')})`);
    const label = pieceLabel(climbCourse({ ropeLands: true, pieces: ['rope-land-knee'] }).pieces[0]);
    ok(/28 degrees/.test(label.what) && /your size/.test(label.what) && /band below/.test(label.what), `and each landing's label says what it is laid for and which way the band goes ("${label.what}")`);
  }
  fresh();
}

// ---- the digest: every frame of the landings, at the shipped settings and with the round put back -----------------------------
/**
 * The shipped settings (recorded from this run's first pass, 2026-11-18, d255d2ba…; recorded again by the fixer the same day
 * once the course's platforms stood at the bands' middles, `ropeLandTops`, so every landing's frames moved).
 */
const SHIPPED = { digest: 'f39ac4a20346a14f87baeaff4069a50d778d122803ff8d5a019e351b4936e9a6', frames: 30925 };
/** `CLIMB_ROPES_BEFORE`: the ropes 'off' (the rope its column, never grabbed) and the let-go 'plain'. */
const BEFORE = { digest: 'fcb21944ef884692fe9af49712b45bf07b18581edfbdd3b34a11735f66d6162f', frames: 45070 };
async function landingTrace(fps: number, id: string, h: ReturnType<typeof createHash>): Promise<{ frames: number; ended: string }> {
  const s = await standPiece(climbCourse({ ropeLands: true, pieces: [id] }).pieces[0]);
  const { b } = bodyAt(s, 'stand', fps);
  b.rope.ropes = s.ropes;
  const row = new Float64Array(12);
  let frames = 0;
  const rec = () => {
    const R = b.rope;
    row[0] = b.pos.x;
    row[1] = b.pos.y;
    row[2] = b.pos.z;
    row[3] = b.vel.x;
    row[4] = b.vel.y;
    row[5] = b.vel.z;
    row[6] = R.phase;
    row[7] = R.band;
    row[8] = R.th;
    row[9] = R.om;
    row[10] = R.landT;
    row[11] = b.grounded ? 1 : 0;
    h.update(new Uint8Array(row.buffer));
    frames++;
  };
  const run = (n: number, done: () => boolean = () => false) => {
    for (let i = 0; i < n && !done(); i++) {
      b.frame(1 / fps);
      rec();
    }
  };
  b.key('KeyE', true);
  run(1);
  b.key('KeyE', false);
  run(fps);
  b.key('KeyA', true);
  run(9 * fps);
  run(6 * fps, () => b.rope.om > 0 && b.rope.th >= LET_GO);
  b.key('KeyA', false);
  b.key('Space', true);
  run(1);
  b.key('Space', false);
  run(3 * fps);
  return { frames, ended: b.rope.flyEnd || (b.rope.plains ? 'plain' : 'held') };
}
for (const [what, want, before] of [["at the round's shipped settings", SHIPPED, false], ['with the round put back (`CLIMB_ROPES_BEFORE`)', BEFORE, true]] as const) {
  fresh();
  if (before) climbRopesBefore();
  const h = createHash('sha256');
  let frames = 0;
  const ends: string[] = [];
  for (const fps of RATES) {
    for (const id of ropeLandIds()) {
      const t = await landingTrace(fps, id, h);
      frames += t.frames;
      ends.push(t.ended);
    }
  }
  const digest = h.digest('hex');
  console.log(`     ${what}: ${frames} frames, digest ${digest}`);
  if (!before) ok(ends.filter((e) => e === 'landed').length === 16 && ends.filter((e) => e === 'plain').length === 4, `${what}: sixteen landings and four plain let-goes over the five pieces at four rates (${ends.join(', ')})`);
  else ok(ends.every((e) => e === 'held'), `${what}: E never takes the rope (its column stood in its place), so nothing is let go of (${ends.join(', ')})`);
  ok(frames === want.frames && digest === want.digest, `... and every frame of it is as it was to the bit (${frames} frames, the trace's digest ${digest.slice(0, 16)})`);
}
fresh();

// ---- the switches' other settings, and the hand-overs ----------------------------------------------------------------------------
{
  climbBarsBefore();
  const before = CLIMB_TUNE.ropeLand === CLIMB_ROPES_BEFORE.ropeLand && CLIMB_ROPES_BEFORE.ropeLand === 'plain' && CLIMB_TUNE.ropes === 'off';
  fresh();
  ok(before && CLIMB_TUNE.ropeLand === 'lips', "phase 3's put back (and so every older round's chain) puts the let-go to 'plain' with the ropes 'off'; the game ships it 'lips'");
  const text = (f: string) => readFileSync(join(REPO, f), 'utf8').replace(/\r\n/g, '\n');
  const player = text('src/player/player.ts');
  const harness = text('tools/swg/tests/grappleBody.ts');
  const clips = text('src/player/hangClips.ts');
  const main = text('src/main.ts');
  const remote = text('src/net/remoteRopes.ts');
  const knock = 'if (this.hp < this.ropeHp) R.knock(this.ropeHp - this.hp);\n    this.ropeHp = this.hp;';
  ok(player.includes(knock) && harness.includes(knock), 'the player and the harness both knock the body off a rope by the health lost since its last frame on it');
  ok(/R\.swimLine = flat \+ world\.seaSwellOverFlat\(this\.pos\.x, this\.pos\.z, flat\) - SWIM_DEPTH;/.test(player) && /R\.swimLine = this\.surface\(this\.pos\.x, this\.pos\.z, this\.t\) - SWIM_DEPTH;/.test(harness), "and hand the rope the water's swim line (the swim's own surface and depth) before it steps");
  ok(/this\.jka\.holdApex\(R\.apexY\);\n    this\.grounded = R\.landedNow;/.test(player) && /this\.jka\.holdApex\(R\.apexY\);\n    this\.grounded = R\.landedNow;/.test(harness), "and hold the fall's memory where the rope says (the flight's top while flying), a landing ended stood");
  ok(/this\.ropeLandTables = measureRopeLandTables\(rig\);/.test(player) && /this\.rope\.landTables = this\.ropeTablesRig === rig \? this\.ropeLandTables : null;\n    this\.rope\.placeFigure\(/.test(player), 'the player measures the landings\' tables once a rig and hands the rope them before it places the figure');
  ok(/if \(this\.rope\.offset && this\.rope\.plantY === this\.rope\.plantY\) this\.plantRopeFeet\(rig\);\n\s+if \(this\.rope\.offset\) this\.applyRopeRoot\(\);/.test(player) && /R\.ankleLow = \(ropePlantA\.y < ropePlantB\.y \? ropePlantA\.y : ropePlantB\.y\) \* rig\.root\.scale\.y;\n    R\.plantFeet\(this\.pos\);/.test(player), "and plants the drawn feet on the top (the rope's own `plantFeet`) before it draws the figure, as the tests' figure does");
  ok(/rig\.setState\(R\.landedNow \? 'crouch' : 'air', 0, null, st\.hangFade\);/.test(clips) && /rig\.overrideSeekAt = R\.airT;\n      rig\.overrideSeekNow\(R\.airClip\);/.test(clips) && /if \(rig\.overrideName !== R\.swingName && rig\.overrideName !== R\.airClip\) return;/.test(clips), "the hand-over: the flight's and the landing's clip put at the rope's time through the rig's own fields, let go into the crouch after a landing (else the falling loop), and let go of where nothing else did");
  ok(/if \(!s\.bar\) s\.bar = p\.rope\.promptWord\(\);/.test(main) && /if \(s\.climb !== '' && p\.reachRope\) s\.climbBar = true;/.test(main) && /this\.reachRope = this\.rope\.canGrab\(/.test(player), "the game gathers the rope's words for the action bar, and E's grab where a rope is in reach");
  ok(/const hung = p\.rope\.onRope && !g\.out && !p\.aboard && !p\.eva \? p\.rope\.rope : null;/.test(main) && /const gr = \[1, 0, n2\(hung\.ax\), n2\(hung\.ay\), n2\(hung\.az\), n2\(hung\.ax\), n2\(hung\.ay\), n2\(hung\.az\)\];/.test(main), "the game sends a hanging rope held as a held rope whose anchor comes twice");
  ok(/if \(r\.hung\) r\.dart!\.visible = false;/.test(remote) && /const hungNow = rope\.hung \|\| r\.hung;/.test(remote), "another player's game draws it with no dart, and hears no bite or let-go of it");
  ok(/ropeLands\?: boolean/.test(main) && /climbCourse\(\{ pieces: o\.pieces, gap: o\.gap, extras, ropeLands, ropeScale \}\)/.test(main) && main.includes("const ropeLands = o.ropeLands ?? CLIMB_TUNE.ropes === 'on';"), "the console's course stands the rope's landings (`climbTest({ ropeLands })`), unless said only while `climb.ropes` is 'on', so under 'off' the course is the one before them");
  ok(main.includes('const ropeScale = this.player.ledgeScale();') && /climbCourse\(\{ pieces: o\.pieces, gap: o\.gap, floor, extras, ropeLands, ropeScale \}\)/.test(main), "and lays them for the figure standing (the player's own ledge scale, which the rope's bands scale by)");
  // The fixer: the ropes nobody holds are swung once a frame, at the very top of the update ahead of every way out of it, in the
  // player and the harness alike, and nowhere else.
  const upd = player.indexOf('  update(dt: number, input: Input, cam: ThirdPersonCamera, world: World): void {');
  const tickAt = player.indexOf('this.rope.tickRopes(dt);', upd);
  const swing = text('src/player/ropeSwing.ts');
  ok(upd >= 0 && tickAt > upd && tickAt < player.indexOf('if (this.ragdoll) {', upd) && player.split('this.rope.tickRopes(').length === 2, "the player swings the ropes nobody holds once a frame, at the top of its update ahead of every way out (dead, the editor's flight, a ride, a bar, the rope itself, a ledge, a wall)");
  ok(harness.indexOf('this.rope.tickRopes(dt);') > harness.indexOf('  frame(dt: number): void {') && harness.indexOf('this.rope.tickRopes(dt);') < harness.indexOf('if (this.bar.holding) {\n      this.barFrame(dt);') && harness.split('this.rope.tickRopes(').length === 2, 'and the harness at the same place in its frame');
  ok(swing.split('this.freeRopes()').length === 2 && /tickRopes\(dt: number\): void \{\n    this\.dtNow = dt;\n    this\.freeRopes\(\);\n  \}/.test(swing), "and the rope's own frames swing none (the hang's step and `tick` once did, so a let-go into a landing froze its rope and a grab's frame swung the others twice)");
}
console.log(`climbRopesLand: ${checks} checks passed`);
