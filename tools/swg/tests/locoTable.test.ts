// The speed classes' table (src/anim/locoTable.ts) held to the pack this checkout carries: every way and class names
// a clip the pack holds and the game loads; each clip's written heading is the pack's own measurement, rounded; the
// rule that turns the body; the speeds' starts against the measured ones; what another player's figure plays, for
// every way and class, worked out from what crosses the wire with the figure facing any way; and the tune and its
// dials (locoTune.ts, locoDials.ts).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCO_DIALS, locoDialsFor } from '../../../src/anim/locoDials.ts';
import { factsOf, phaseAt, phaseGap, rateFor, sharedRate, timeAtPhase } from '../../../src/anim/locoPhase.ts';
import { CLIP_HEADING, DIRS, GUN_UP, LOCO_TABLE, PLAIN, SPEED_SLOTS, allPicks, dirOf, fillSpeeds, locoPick, nominalHeading, peerBackState, peerCarryState, peerLocoState, peerPick, speedOf, tableClips, topClass, travelDeg, wrapDeg, type LocoPick } from '../../../src/anim/locoTable.ts';
import { PeerIn, PeerLoco } from '../../../src/anim/peerLoco.ts';
import { LOCO_RANGES, LOCO_SWITCH, LOCO_TUNE, LOCO_TUNE_SHIPPED, locoSwitchOn, tuneLoco, type LocoTune } from '../../../src/anim/locoTune.ts';
import { clipName, readPackIndex } from '../../../src/anim/mxaFile.ts';
import { allDials, movedArgs, movedLine, resetDials, type NumberDial } from '../../../src/ui/dials.ts';
import { CLIPS, rowFor } from '../../anim/mixamoClips.mjs';
import { repoRoot } from './animFixtures.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const root = repoRoot(import.meta.url);
const index = readPackIndex(JSON.parse(readFileSync(join(root, 'public', 'anims', 'mixamo', 'index.json'), 'utf8')));
if (typeof index === 'string') throw new Error(index);
const row = (id: string) => index.clips.find((c) => c.id === id);
const T = (): LocoTune => JSON.parse(JSON.stringify(LOCO_TUNE_SHIPPED)) as LocoTune;

// ---- the table is whole ------------------------------------------------------------------------------------------------
{
  let cells = 0;
  const missing: string[] = [];
  for (let dir = 0; dir < 8; dir++) {
    for (let cls = 1; cls <= 4; cls++) {
      for (const [tired, gun] of [[false, PLAIN], [true, PLAIN], [false, GUN_UP], [true, GUN_UP]] as const) {
        const p = locoPick(dir, cls, tired, gun);
        cells++;
        if (!p) {
          missing.push(`${DIRS[dir]}${cls}`);
          continue;
        }
        const r = row(p.id);
        if (!r || !r.use || !r.loop || !r.feet.some((m) => m.foot === 'L') || !(r.speed > 0.3) || p.clip !== clipName(p.id)) missing.push(`${DIRS[dir]}${cls}:${p.id}`);
      }
    }
  }
  ok(missing.length === 0, `every way (8), class (4) and variant (plain, tired, a blaster up, both) names a clip the pack holds, marked for the game, a loop with a left-foot mark and a measured speed (${cells} cells; ${missing.join(' ') || 'none missing'})`);
  ok(locoPick(-1, 2) === null && locoPick(8, 2) === null, 'no way, no clip');
  const ids = tableClips();
  ok(ids.length === 20 && new Set(ids).size === 20, `the table names twenty clips in all (${ids.length})`);
  // The brief, cell by cell.
  const id = (mz: number, mx: number, cls: number, tired = false, up = false) => locoPick(dirOf(mz, mx), cls, tired, up ? GUN_UP : PLAIN)!.id;
  ok(id(1, 0, 1) === 'standard_walk' && id(1, 0, 2) === 'slow_run' && id(1, 0, 3) === 'running' && id(1, 0, 4) === 'fast_run' && id(1, 0, 2, true) === 'drunk_run_forward', 'forward: the standard walk, the slow run, the run, the fast run; tired, the jog is the drunk run');
  ok(id(1, 0, 3, true) === 'running' && id(1, 0, 1, true) === 'standard_walk' && id(-1, 0, 2, true) === 'jog_backward', 'and only the forward jog has a tired clip');
  ok(id(-1, 0, 1) === 'walking_backwards' && id(-1, 0, 2) === 'jog_backward' && id(-1, 0, 3) === 'running_backward' && id(-1, 0, 4) === 'running_backward', 'backward: the backward walk, jog and run, and the run again for a sprint asked');
  ok(id(0, -1, 1) === 'walk_strafe_left' && id(0, 1, 1) === 'walk_strafe_right' && id(0, -1, 2) === 'jog_strafe_left' && id(0, 1, 2) === 'jog_strafe_left_mirrored' && id(0, -1, 3) === 'left_strafe' && id(0, 1, 3) === 'left_strafe_mirrored', 'sideways: the slow strafes at the walk (the owner\'s answer: the brief\'s sideways "speed 0" is what walking sideways plays), the jog strafe and the strafe, the right-hand jog and run their mirror images');
  ok(id(0, -1, 1, false, true) === 'walk_strafe_left' && id(0, 1, 1, true, true) === 'walk_strafe_right' && id(0, -1, 2, false, true) === 'jog_strafe_left' && id(1, 0, 1, false, true) === 'standard_walk' && id(1, 0, 2, true, true) === 'drunk_run_forward', 'with a blaster up or not: sideways, forward and the tired jog are what they are without one');
  ok([0, 2, 4, 6].every((d) => [1, 2, 3, 4].every((c) => !/_strafe_walking$/.test(locoPick(d, c)!.id) && !/_strafe_walking$/.test(locoPick(d, c, false, GUN_UP)!.id))), 'the strafe walks (the brief\'s sideways "speed 1") are never what a straight way plays: they stay in the table for the walked forward diagonals alone');
  // With a blaster up a diagonal never turns the body: its own jog clip at every class, at the class's own speed.
  const up = (mz: number, mx: number, cls: number) => locoPick(dirOf(mz, mx), cls, false, GUN_UP)!;
  ok([1, 2, 3].every((c) => up(1, 1, c).id === 'jog_forward_diagonal' && up(1, -1, c).id === 'jog_forward_diagonal_mirrored' && up(-1, 1, c).id === 'jog_backward_diagonal' && up(-1, -1, c).id === 'jog_backward_diagonal_mirrored' && up(1, 1, c).turn === 0 && up(-1, -1, c).turn === 0), 'with a blaster up and kept square a diagonal plays its own jog clip at every class and the body stays square to the view: a body turned 45 degrees for a strafe cannot also hold a barrel on the crosshair');
  ok(up(1, 1, 1).key === 'walk' && up(1, 1, 1).state === 'walk' && up(1, 1, 3).key === 'run' && up(1, 1, 3).state === 'run' && up(-1, 1, 1).state === 'walk' && up(-1, 1, 3).state === 'run' && up(1, 0, 3).id === 'running' && up(0, 1, 3).id === 'left_strafe_mirrored', 'at the class\'s own speed and under the class\'s own state; forward, backward and sideways are as they are without a gun');
  ok(id(1, 1, 2) === 'jog_forward_diagonal' && id(1, -1, 2) === 'jog_forward_diagonal_mirrored' && id(-1, 1, 2) === 'jog_backward_diagonal' && id(-1, -1, 2) === 'jog_backward_diagonal_mirrored', 'the diagonals\' jogs are their own clips: to the right as the files are, to the left mirrored');
  ok(id(1, -1, 1) === 'left_strafe_walking' && id(1, 1, 1) === 'right_strafe_walking' && id(1, -1, 3) === 'left_strafe' && id(1, 1, 3) === 'left_strafe_mirrored', 'a forward diagonal\'s walk and run are the strafe walks and the strafes');
  ok(id(-1, -1, 1) === 'walking_backwards' && id(-1, 1, 1) === 'walking_backwards' && id(-1, -1, 3) === 'running_backward' && id(-1, 1, 3) === 'running_backward', 'and a backward diagonal\'s the backward walk and run');
  ok(topClass(dirOf(1, 0)) === 4 && [1, 2, 3, 4, 5, 6, 7].every((d) => topClass(d) === 3) && locoPick(dirOf(0, -1), 4)!.cls === 3, 'only forward sprints: every other way gives its run');
  // The states: names every build has a clip for, and never the ones Jedi Academy's back-pedal is sent under.
  ok(allPicks().every((p) => p.state === (p.cls === 1 ? 'walk' : 'run')), 'every cell puts the rig in `walk` (the walk class) or `run` (every other), whichever way it goes: a build from before the classes, or a figure without the imported clips, has a clip for both, and neither is the state Jedi Academy\'s own back-pedal is sent under');
  // A gait and a posture are a field and a row more.
  ok(typeof LOCO_TABLE.stand.F.cells[1] === 'object' && Object.keys(LOCO_TABLE).join() === 'stand', 'the forward walk is named by gait and the table is keyed by posture, so a gait is one field and a crouched set one row');
  // The importer's table marks exactly these.
  const marked = Object.entries(CLIPS).filter(([cid, r]) => (r as { use?: boolean }).use && ids.includes(cid)).map(([cid]) => cid);
  const twins = ids.filter((cid) => cid.endsWith('_mirrored'));
  ok(ids.filter((cid) => !cid.endsWith('_mirrored')).every((cid) => marked.includes(cid)) && twins.every((cid) => rowFor(cid.replace(/_mirrored$/, '')).mirror && rowFor(cid.replace(/_mirrored$/, '')).use && row(cid)!.mirrorOf === cid.replace(/_mirrored$/, '')), 'the importer\'s table marks every one of them for the game, the four mirrored twins through the clips they mirror: a fresh import writes the pack the table expects');
}

// ---- headings and the body's turn ------------------------------------------------------------------------------------------
{
  const off: string[] = [];
  let worst = 0;
  for (const id of tableClips()) {
    const r = row(id)!;
    const d = Math.abs(wrapDeg(r.heading - CLIP_HEADING[id]));
    worst = Math.max(worst, d);
    if (nominalHeading(r.heading) !== CLIP_HEADING[id]) off.push(id);
  }
  ok(off.length === 0 && worst < 3, `each clip's written heading is the pack's own measurement rounded to the nearest 45 degrees (the furthest measurement ${worst.toFixed(1)} degrees off its nominal)`);
  ok(nominalHeading(-179.4) === 180 && nominalHeading(179.9) === 180 && nominalHeading(-45.6) === -45 && nominalHeading(92.1) === 90 && nominalHeading(0.3) === 0 && wrapDeg(-180) === 180 && wrapDeg(270) === -90, 'a heading rounds to 0, +-45, +-90, +-135 or 180, never -180');
  ok(Object.is(nominalHeading(-5), 0) && Object.is(nominalHeading(-0.2), 0) && Object.is(nominalHeading(355), 0) && nominalHeading(-200) === 180 && nominalHeading(250) === -90, 'and a little to the right of forward is nought itself, not a negative nought (which is no whole number to the engine, and would be made afresh at every asking)');
  ok(travelDeg(dirOf(1, 0)) === 0 && travelDeg(dirOf(1, -1)) === 45 && travelDeg(dirOf(0, -1)) === 90 && travelDeg(dirOf(-1, -1)) === 135 && travelDeg(dirOf(-1, 0)) === 180 && travelDeg(dirOf(-1, 1)) === -135 && travelDeg(dirOf(0, 1)) === -90 && travelDeg(dirOf(1, 1)) === -45 && dirOf(0, 0) === -1, 'the keys\' way is an angle from the view, left positive');
  // The rule: the body is turned by the travel's angle less the clip's heading, so that turned so, the clip's own
  // heading carries the body the way the keys ask. Checked against the pack's measured headings, not the written ones.
  let far = 0;
  for (const p of allPicks()) {
    const measured = row(p.id)!.heading;
    const goes = wrapDeg(p.turn + measured);
    far = Math.max(far, Math.abs(wrapDeg(goes - travelDeg(p.dir))));
  }
  ok(far < 3, `turned by the rule, every clip's own measured heading carries the body the way the keys ask, to within ${far.toFixed(1)} degrees`);
  const turn = (mz: number, mx: number, cls: number) => locoPick(dirOf(mz, mx), cls)!.turn;
  ok([1, 2, 3, 4].every((c) => turn(1, 0, c) === 0 && turn(-1, 0, c) === 0 && turn(0, 1, c) === 0 && turn(0, -1, c) === 0), 'forward, backward and sideways never turn the body from the view: backing up and strafing face forward');
  ok(turn(1, 1, 2) === 0 && turn(1, -1, 2) === 0 && turn(-1, 1, 2) === 0 && turn(-1, -1, 2) === 0, 'nor do the diagonals\' jogs, which have clips of their own');
  ok(turn(1, 1, 1) === 45 && turn(1, -1, 1) === -45 && turn(1, 1, 3) === 45 && turn(1, -1, 3) === -45, 'a strafe used for a forward diagonal turns the body 45 degrees the other way (forward and right: to the left)');
  ok(turn(-1, 1, 1) === 45 && turn(-1, -1, 1) === -45 && turn(-1, 1, 3) === 45 && turn(-1, -1, 3) === -45, 'and a backward clip used for a backward diagonal 45 degrees (back and right: to the left, so the back points back and right)');
  // Honest: a clip laid in the wrong cell is caught by the rule above.
  ok(Math.abs(wrapDeg(locoPick(dirOf(1, 1), 2)!.turn + row('jog_forward_diagonal_mirrored')!.heading - travelDeg(dirOf(1, 1)))) > 80, 'the same check on the mirrored diagonal laid in the right-hand cell is 90 degrees out, so a swapped cell would fail it');
}

// ---- speeds ----------------------------------------------------------------------------------------------------------------
/**
 * The table's clips' speeds as the importer measured them when the paces were started (91e62d9's index, under the hips
 * over every planted frame). Its measure was mended since and every clip now reads a few per cent faster, but the paces
 * are the owner's dials and were left where they started (the clips' playback rates move instead): each start is held
 * to the speed it was started from, and each is said beside its clip's own speed now, which the owner may set it to.
 */
const STARTED_FROM: Record<string, number> = {
  standard_walk: 1.444, slow_run: 2.853, drunk_run_forward: 2.375, running: 5.47, fast_run: 5.539, left_strafe_walking: 1.697, right_strafe_walking: 1.642,
  walk_strafe_left: 0.591, walk_strafe_right: 0.591, jog_strafe_left: 2.889, jog_strafe_left_mirrored: 2.889, left_strafe: 4.331, left_strafe_mirrored: 4.331,
  jog_forward_diagonal: 2.656, jog_forward_diagonal_mirrored: 2.656, walking_backwards: 1.28, jog_backward: 2.252, running_backward: 2.931,
  jog_backward_diagonal: 2.176, jog_backward_diagonal_mirrored: 2.176,
};
{
  const t = T();
  const own: string[] = [];
  const said: string[] = [];
  const beside: string[] = [];
  ok(tableClips().every((id) => STARTED_FROM[id] !== undefined) && Object.keys(STARTED_FROM).length === tableClips().length, 'every clip of the table has the speed its pace was started from');
  // A diagonal's jog clip used for its walk and run with a blaster up: at the class's own dial, the very speed the
  // way has at that class without a gun, so a gun never changes how fast anybody goes.
  const upCells = new Set<string>();
  let upWrong = 0;
  for (const p of allPicks()) {
    const v = speedOf(t, p), m = STARTED_FROM[p.id];
    if (/diagonal/.test(p.id) && p.key !== 'jog') {
      upCells.add(`${DIRS[p.dir]} ${p.key}`);
      if (v !== speedOf(t, locoPick(p.dir, p.cls)!)) upWrong++;
      continue;
    }
    beside.push(`${DIRS[p.dir]} ${p.key} ${v} (${p.id} ${row(p.id)!.speed})`);
    if (Math.abs(v - m) <= 0.045) own.push(p.id);
    else said.push(`${DIRS[p.dir]} ${p.key} ${v} (its clip ${m})`);
  }
  ok(upCells.size === 8 && upWrong === 0 && ['FL', 'FR', 'BL', 'BR'].every((d) => upCells.has(`${d} walk`) && upCells.has(`${d} run`)), `with a blaster up the four diagonals' walks and runs (${upCells.size} cells) move at the very speed they have without one`);
  // The owner's own speeds, pinned on 2026-11-15 after he tried the paces, are the starts; the two he did not name (the
  // backward walks) stay where the paces were started, at the backward walk's own 1.28.
  const OWNER = { forward: { walk: 1.66, jog: 4, tired: 3.5, run: 6, sprint: 7 }, back: { walk: 1.28, jog: 3, run: 4 }, side: { walk: 1.44, jog: 4, run: 6 }, forwardDiag: { walk: 1.66, jog: 4, run: 6 }, backDiag: { walk: 1.28, jog: 3, run: 4 } };
  ok(JSON.stringify(t.speed) === JSON.stringify(OWNER), `every pace starts at the owner's own speed of 2026-11-15 (${JSON.stringify(t.speed)})`);
  ok(t.speed.back.walk === STARTED_FROM.walking_backwards && t.speed.backDiag.walk === STARTED_FROM.walking_backwards, 'and the two he did not name, the backward walks, where they were started: the backward walk\'s own 1.28');
  ok(t.speed.forward.sprint > t.speed.forward.run && t.speed.forward.run > t.speed.forward.jog && t.speed.forward.jog > t.speed.forward.tired && t.speed.forward.tired > t.speed.forward.walk, 'forward the classes still rise: walk, tired jog, jog, run, sprint');
  note(`the paces as started (91e62d9's index, kept for the record): ${said.length + own.length} cells, ${own.length} of them at their clip's speed then`);
  ok(tableClips().every((id) => row(id)!.speed >= STARTED_FROM[id] - 0.04), 'no clip of the table measures slower now than when its pace was started (the mended measure reads the stride, which the old one read low)');
  note(`each pace beside its clip's own speed now: ${beside.join('; ')}`);
  // What a frame reads: every dial at its own place in one array, which is each pick's own speed.
  const each = T();
  let n = 0;
  for (const g of Object.values(each.speed) as Record<string, number>[]) for (const k of Object.keys(g)) g[k] = 1 + ++n * 0.125;
  const speeds = new Float64Array(SPEED_SLOTS).fill(-1);
  fillSpeeds(each, speeds);
  ok(n === SPEED_SLOTS && new Set(speeds).size === SPEED_SLOTS && allPicks().every((p) => speeds[p.slot] === speedOf(each, p)), `a frame's array of the class speeds holds every dial of the tune once (${SPEED_SLOTS}), and each cell's own place in it is the cell's own speed (every dial given a number no other has)`);
  // The band.
  ok(rateFor(2.85, 2.85, 0.6, 1.6) === 1 && rateFor(1, 2.85, 0.6, 1.6) === 0.6 && rateFor(9, 2.85, 0.6, 1.6) === 1.6 && Math.abs(rateFor(9, 2.85, 0.6, 1.6, 2) - 9 / 2.85) < 1e-12 && rateFor(40, 2.85, 0.6, 1.6, 2) === 3.2 && rateFor(3, 0, 0.6, 1.6) === 1, 'a clip plays at the ground speed over its own, held inside the band, whose top Force Speed\'s factor raises; a clip of unknown speed at 1');
}

// ---- the stride --------------------------------------------------------------------------------------------------------------
{
  const f = factsOf(row('slow_run')!, 1)!;
  ok(Math.abs(f.cycle - row('slow_run')!.duration) < 1e-9 && Math.abs(f.leftAt - 0.2048) < 1e-9 && f.speed === row('slow_run')!.speed, 'a stride is a clip\'s length, counted from its left foot\'s landing, at its feet\'s speed');
  const d = factsOf(row('drunk_run_forward')!, 0.9)!;
  ok(Math.abs(d.cycle - row('drunk_run_forward')!.duration / 2) < 1e-9 && Math.abs(d.speed - row('drunk_run_forward')!.speed * 0.9) < 1e-12, 'a clip of two strides (the tired jog) has half its length as its stride, and a stride\'s speed is scaled to the skeleton it was fitted to');
  ok(factsOf(row('jumping_down')!, 1) === null && factsOf(row('treading_water')!, 1) === null && factsOf(row('falling_idle')!, 1) === null, 'a landing, a swim and a fall have no stride');
  ok(phaseAt(f.leftAt, f) === 0 && Math.abs(phaseAt(f.leftAt + f.cycle / 2, f) - 0.5) < 1e-12 && Math.abs(phaseAt(0, f) - (1 - f.leftAt / f.cycle)) < 1e-12, 'phase 0 is the left foot landing');
  let worst = 0;
  for (const id of tableClips()) {
    const s = factsOf(row(id)!, 1)!;
    for (let k = 0; k < 40; k++) {
      const ph = k / 40;
      const at = timeAtPhase(ph, s, row(id)!.duration);
      worst = Math.max(worst, phaseGap(phaseAt(at, s), ph));
      assert.ok(at >= 0 && at < row(id)!.duration + 1e-9, `${id}: a time inside the clip`);
    }
  }
  ok(worst < 1e-9, 'a time asked for a phase is a time inside the clip at that phase, for every clip of the table');
  ok(phaseGap(0.98, 0.01) < 0.031 && Math.abs(phaseGap(0.2, 0.7) - 0.5) < 1e-12 && Math.abs(phaseGap(0.1, 0.8) - 0.3) < 1e-12 && sharedRate(1, 2, 0) === 1 && sharedRate(1, 2, 1) === 2 && sharedRate(1, 2, 0.5) === 1.5 && sharedRate(1, 2, 7) === 2 && sharedRate(1, 2, 0.25) === 1.25 && sharedRate(3, 1, 0.25) === 2.5, 'two phases are apart the short way round; a fade\'s shared rate runs from the outgoing clip\'s to the incoming one\'s, nearer the outgoing one\'s early on');
  // In the pack the right foot lands about half a stride after the left, in every clip of the table.
  const halves = tableClips().map((id) => {
    const r = row(id)!, s = factsOf(r, 1)!;
    const right = r.feet.filter((m) => m.foot === 'R')[0];
    return [id, phaseAt(right.t, s)] as const;
  });
  ok(halves.every(([, ph]) => ph > 0.3 && ph < 0.7), `counted from the left foot's landing, every clip's right foot lands about half a stride on (${Math.min(...halves.map((h) => h[1])).toFixed(2)} to ${Math.max(...halves.map((h) => h[1])).toFixed(2)}): two clips at one phase have the same foot down`);
}

// ---- another player's figure ---------------------------------------------------------------------------------------------
{
  // At the speeds the paces were started at and with the slow strafe sideways (62143fe's tune), which the numbers below
  // are written for; the owner's speeds and the other sideways walks are held the same way by locoPolish.test.ts.
  const t = T();
  t.speed = { forward: { walk: 1.44, jog: 2.85, tired: 2.38, run: 4.9, sprint: 6.35 }, back: { walk: 1.28, jog: 2.25, run: 2.93 }, side: { walk: 0.59, jog: 2.89, run: 4.33 }, forwardDiag: { walk: 1.67, jog: 2.66, run: 4.33 }, backDiag: { walk: 1.28, jog: 2.18, run: 2.93 } };
  t.sideWalkClip = 'strafe';
  const RAD = Math.PI / 180;
  const speedOfClip = (c: string) => row(c.replace(/^mx_/, ''))!.speed;
  const rig = { has: () => true, speedOut: 0, readSpeed(c: string) { this.speedOut = speedOfClip(c); return true; } };
  const f = new PeerIn();
  /**
   * What a sender's game puts on the wire for a cell, with its view turned `view` degrees: the state (a gun's carry
   * by walk or run), the heading (the body's: the view turned by the rule), the speed, and the velocity its figure
   * is then heard at (the travel: the view turned by the way the keys go, read `off` degrees out). A body facing
   * (sin h, cos h) with +x to its left, as the game's is.
   */
  const send = (p: LocoPick, view: number, gun: string, off = 0, speed = speedOf(t, p)): string => {
    const travel = (view + travelDeg(p.dir) + off) * RAD;
    f.vx = Math.sin(travel) * speed;
    f.vz = Math.cos(travel) * speed;
    f.heading = (view + p.turn) * RAD;
    f.speed = speed;
    f.dt = 1 / 60;
    return gun ? `${gun}${p.cls <= 1 ? 'Walk' : 'Run'}` : p.state;
  };
  const wrong: string[] = [];
  let n = 0;
  for (const view of [0, 37, 140, -100, 180]) {
    for (let dir = 0; dir < 8; dir++) {
      for (let cls = 1; cls <= 4; cls++) {
        for (const [tired, variant] of [[false, PLAIN], [true, PLAIN], [false, GUN_UP]] as const) {
          // Bare-handed, or a gun in any carry (relaxed, or up with the square diagonals switched off); a cell of
          // the square diagonals only with a gun up.
          for (const gun of variant === GUN_UP ? ['gunReady', 'gunAim'] : ['', 'gun', 'gunReady', 'gunAim']) {
            const sent = locoPick(dir, cls, tired, variant)!;
            const state = send(sent, view, gun, ((n % 3) - 1) * 9);
            const got = new PeerLoco().resolve(t, rig, state, f);
            n++;
            if (!got || got.id !== sent.id) wrong.push(`${DIRS[dir]}${cls}${tired ? 't' : ''}${variant || ''}${gun}@${view}: ${sent.id} seen as ${got?.id}`);
          }
        }
      }
    }
  }
  ok(wrong.length === 0, `for every way, class and variant, bare-handed and with a gun in each carry, with the sender's view turned five ways round, the figure's own record names the very clip the sender plays, from the state, the heading and the velocity it is heard at (the travel read up to 9 degrees off) and the speed (${n} cases; ${wrong.slice(0, 4).join('; ') || 'none wrong'})`);
  // Honest: the heading sent is what the travel is measured against. A figure facing 140 degrees and going to its
  // left is no figure going to its left if the heading is left out.
  const left = locoPick(dirOf(0, -1), 2)!;
  const st = send(left, 140, '');
  const real = new PeerLoco().resolve(t, rig, st, f)!.id;
  f.heading = 0;
  ok(real === 'jog_strafe_left' && new PeerLoco().resolve(t, rig, st, f)!.id !== 'jog_strafe_left', 'and the same velocity read against a heading of nought names another clip, so the check above can fail');
  ok(peerPick(t, 'idle', 0, 3) === null && peerPick(t, 'crouchWalk', 0, 2) === null && peerPick(t, 'swim', 0, 2) === null && peerPick(t, 'runSaber', 0, 5) === null && peerPick(t, 'walkSaber', 0, 2) === null && !peerLocoState('seated'), 'a state that is no walk or run on foot (standing, crouched, swimming, the saber\'s own run and walk) is left to its own clip');
  ok(peerPick(t, 'runBack', 180, 2.25) === null && peerPick(t, 'walkBack', 180, 1.28) === null && !peerLocoState('runBack') && !peerLocoState('walkBack') && !peerLocoState('strafeLeft'), 'and so is Jedi Academy\'s own back-pedal: the classes never send its states, so a figure backing up under one is blocking or fighting and plays that game\'s clip');
  ok(peerPick(t, 'run', 0, 2.5)!.id === 'drunk_run_forward' && peerPick(t, 'run', 0, 2.8)!.id === 'slow_run' && peerPick(t, 'run', 0, 4.4)!.id === 'running' && peerPick(t, 'run', 0, 6)!.id === 'fast_run' && peerPick(t, 'walk', 0, 2.8)!.id === 'standard_walk', 'the class is the one whose speed is nearest, on the side of the walk the state says');
  ok(peerPick(t, 'walk', 90, 0.7)!.id === 'walk_strafe_left' && peerPick(t, 'walk', 90, 1.5)!.id === 'left_strafe_walking' && peerPick(t, 'run', 90, 3)!.id === 'jog_strafe_left' && peerPick(t, 'run', -90, 4.2)!.id === 'left_strafe_mirrored' && peerPick(t, 'run', 180, 2.3)!.id === 'jog_backward' && peerPick(t, 'walk', -170, 1.2)!.id === 'walking_backwards' && peerPick(t, 'run', -140, 2.2)!.id === 'jog_backward_diagonal', 'and the way is the travel\'s own against the heading, any of the eight: a state says the side of the walk and nothing of the way');
  ok(peerCarryState('gunRun') === 'gunIdle' && peerCarryState('gunWalk') === 'gunIdle' && peerCarryState('gunReadyRun') === 'gunReadyIdle' && peerCarryState('gunReadyWalk') === 'gunReadyIdle' && peerCarryState('gunAimWalk') === 'gunAimIdle' && peerCarryState('gunAimRun') === 'gunAimIdle' && peerCarryState('run') === null && peerCarryState('walk') === null, 'with a gun a peer\'s upper body keeps the standing pose of the same carry (relaxed, ready or aimed) over the table\'s legs; bare-handed the clip has the whole body');
  ok(peerBackState('run', 180) === 'runBack' && peerBackState('walk', -150) === 'walkBack' && peerBackState('run', 135) === 'runBack' && peerBackState('run', 100) === null && peerBackState('run', 0) === null && peerBackState('gunRun', 180) === null && peerBackState('runSaber', 180) === null, 'on a rig without the table\'s clips a figure sent `walk` or `run` and going backward plays its own back-pedal rather than a run forward');

  // One figure, frame by frame: gathering speed it does not flick through the slower classes.
  const peer = new PeerLoco();
  const seen: string[] = [];
  const step = (p: LocoPick, speed: number, seconds: number, view = 0, off = 0, gun = '') => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      const got = peer.resolve(t, rig, send(p, view, gun, off, speed), f);
      const name = got?.id ?? '-';
      if (seen[seen.length - 1] !== name) seen.push(name);
    }
  };
  const run = locoPick(0, 3)!;
  step(run, 4.9, 1);
  ok(peerPick(t, 'run', 0, 5.9)!.id === 'fast_run', 'at 5.9 m/s the nearest class is the sprint');
  step(run, 5.9, 0.1); // a message or two at another class's speed
  step(run, 4.9, 0.5);
  ok(seen.join() === 'running', `a figure whose speed says another class for a tenth of a second keeps its clip (${seen.join(' ')})`);
  step(run, 6.35, 0.5);
  ok(seen.join() === 'running,fast_run' && Math.abs(peer.rate - 6.35 / row('fast_run')!.speed) < 1e-9, 'and takes the new class once it has stood the tune\'s moment, at the rate that matches its speed');
  // The settle is the tune's own moment, counted in seconds: a class that stands a shade under it is not taken.
  const settle = (seconds: number, fps: number) => {
    const who = new PeerLoco();
    for (let i = 0; i < 30; i++) who.resolve(t, rig, send(run, 0, '', 0, 4.9), f);
    let last = '';
    for (let i = 0; i < Math.round(seconds * fps); i++) {
      send(run, 0, '', 0, 6.35);
      f.dt = 1 / fps;
      last = who.resolve(t, rig, 'run', f)!.id;
    }
    return last;
  };
  ok([30, 60, 144].every((fps) => settle(t.peer.settle - 0.05, fps) === 'running' && settle(t.peer.settle + 0.05, fps) === 'fast_run'), `a class is taken once it has stood ${t.peer.settle} s, the same at 30, 60 and 144 frames a second`);
  step(locoPick(dirOf(0, -1), 2)!, 2.89, 0.02);
  ok(seen[seen.length - 1] === 'jog_strafe_left', 'another way is taken at once');
  // The rate: inside the tune's band with its top doubled, of the clip that is playing.
  const fastest = new PeerLoco();
  fastest.resolve(t, rig, send(run, 0, '', 0, 40), f);
  const slowest = new PeerLoco();
  slowest.resolve(t, rig, send(locoPick(0, 1)!, 0, '', 0, 0.2), f);
  ok(fastest.rate === t.rate.max * 2 && slowest.rate === t.rate.min, 'a figure\'s clip plays at its speed over the clip\'s own, inside the tune\'s band with its top doubled (a peer under Force Speed says so only by how fast it goes)');
  const held = new PeerLoco();
  for (let i = 0; i < 30; i++) held.resolve(t, rig, send(run, 0, '', 0, 4.9), f);
  held.resolve(t, rig, send(run, 0, '', 0, 6.3), f);
  ok(held.pick!.id === 'running' && Math.abs(held.rate - 6.3 / row('running')!.speed) < 1e-9, 'while a new class has not yet stood its moment the rate is worked out for the clip that is playing, not the one that may replace it');
  for (const [state, natural, want] of [['run', 0, 1], ['run', NaN, 1]] as const) {
    const odd = new PeerLoco();
    odd.resolve(t, { has: () => true, speedOut: 0, readSpeed() { this.speedOut = natural; return true; } }, send(run, 0, '', 0, 4.9) && state, f);
    assert.ok(odd.rate === want, 'a clip of no known speed plays at 1');
  }
  ok(true, 'and a clip whose own speed is not known plays at 1');
  // Ground that deflects a body: its travel lies a few degrees from its heading, and its legs keep their way.
  const hill = new PeerLoco();
  const ways: string[] = [];
  const climb = (tune: typeof t, who: PeerLoco, deg: number, seconds: number, view = 0) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      const state = send(run, view, 'gun', deg, 4.9);
      const p = who.resolve(tune, rig, state, f);
      if (ways[ways.length - 1] !== p!.id) ways.push(p!.id);
    }
  };
  climb(t, hill, 0, 0.5, 70);
  climb(t, hill, -20, 0.5, 70);
  climb(t, hill, -30, 0.5, 70);
  climb(t, hill, -14, 0.5, 70);
  ok(ways.join() === 'running', `a runner whose travel a slope turns up to 30 degrees from its heading keeps its forward clip (${ways.join(' ')})`);
  climb(t, hill, -45, 0.05, 70);
  ok(ways.join() === 'running,jog_forward_diagonal', 'a real change of way, 45 degrees, is taken at once');
  climb(t, hill, -14, 0.3, 70);
  ok(ways.join() === 'running,jog_forward_diagonal', 'and held the same way coming back');
  climb(t, hill, 0, 0.05, 70);
  ok(ways.join() === 'running,jog_forward_diagonal,running', 'until the travel is the other clip\'s again');
  const loose = JSON.parse(JSON.stringify(t)) as LocoTune;
  loose.peer.hold = 0;
  ways.length = 0;
  const flick = new PeerLoco();
  climb(loose, flick, 0, 0.2);
  climb(loose, flick, -25, 0.2);
  ok(ways.join() === 'running,jog_forward_diagonal', 'with the hold at nought the same slope changes the legs at the halfway line: the hold is what keeps them');
  const off = T();
  off.on = false;
  const st2 = send(run, 0, '', 0, 4.9);
  const noClips = { has: () => false, speedOut: 0, readSpeed: () => false };
  const still = new PeerLoco();
  f.vx = 0;
  f.vz = 0;
  f.speed = 0;
  const stood = still.resolve(t, rig, 'run', f);
  send(run, 0, '', 0, 4.9);
  ok(new PeerLoco().resolve(off, rig, st2, f) === null && new PeerLoco().resolve(t, noClips, st2, f) === null && stood === null, 'with the classes off, on a rig without the clips, or standing still, the answer is the state\'s own clip');
  // And what the caller then reads for a figure going backward on such a rig: how its travel lay against its heading.
  const back = new PeerLoco();
  back.resolve(t, noClips, send(locoPick(dirOf(-1, 0), 2)!, 55, ''), f);
  const fwd = new PeerLoco();
  fwd.resolve(off, rig, send(run, 55, ''), f);
  ok(Math.abs(Math.abs(back.rel) - 180) < 1e-6 && peerBackState('run', back.rel) === 'runBack' && Math.abs(fwd.rel) < 1e-6 && peerBackState('run', fwd.rel) === null, 'the figure keeps how its travel lay against its heading whether or not the table answered, so a rig without the clips can still tell backing up from running');
  // Pressed to a wall: the figure still says it runs and is heard standing. Its legs keep the way they last went
  // (its own game plays the strafe on the spot); one never heard moving is taken to go forward.
  const strafe = locoPick([0, 1, 2, 3, 4, 5, 6, 7].find((d) => travelDeg(d) === 90)!, 2)!;
  const pressed = new PeerLoco();
  const stateL = send(strafe, 40, '', 0, 2.89);
  for (let i = 0; i < 10; i++) pressed.resolve(t, rig, stateL, f);
  const moved = pressed.pick?.id;
  f.vx = 0;
  f.vz = 0;
  let kept = true;
  for (let i = 0; i < 60; i++) if (pressed.resolve(t, rig, stateL, f)?.id !== strafe.id) kept = false;
  ok(moved === strafe.id && strafe.heading === 90 && kept && Math.abs(pressed.rel - strafe.heading) < 1e-9, `a figure strafing left that stops against a wall, still saying it runs, keeps the strafe (${strafe.id})`);
  const fresh = new PeerLoco();
  const first = fresh.resolve(t, rig, stateL, f);
  ok(first !== null && first.heading === 0 && fresh.rel === 0, 'one never heard moving is taken to go forward');
  f.speed = 0;
  ok(pressed.resolve(t, rig, stateL, f) === null && pressed.rel === 0, 'and once it says it stands the way is let go');
  // The feet's dial reaches another player's legs as it reaches the player's own.
  const feet = T();
  const jogger = new PeerLoco();
  const stJ = send(locoPick(0, 2)!, 0, '');
  jogger.resolve(feet, rig, stJ, f);
  const asIs = jogger.rate;
  feet.rate.feet = 1.1;
  jogger.resolve(feet, rig, stJ, f);
  ok(asIs > feet.rate.min * 1.2 && asIs < feet.rate.max && Math.abs(jogger.rate - asIs / 1.1) < 1e-12, "`rate.feet` slows another player's legs by the same share");
}

// ---- the tune and its dials ----------------------------------------------------------------------------------------------
{
  const numbers: string[] = [];
  const walk = (o: Record<string, unknown>, path: string) => {
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === 'object') walk(v as Record<string, unknown>, path ? `${path}.${k}` : k);
      else if (typeof v === 'number') numbers.push(path ? `${path}.${k}` : k);
    }
  };
  walk(LOCO_TUNE as unknown as Record<string, unknown>, '');
  ok(numbers.sort().join() === Object.keys(LOCO_RANGES).sort().join(), `every number of the tune has a range, and every range a number (${numbers.length})`);
  ok(JSON.stringify(LOCO_TUNE) === JSON.stringify(LOCO_TUNE_SHIPPED), 'the tune stands as shipped');
  ok(!('walkKey' in LOCO_TUNE) && !('aimSlowStrafe' in LOCO_TUNE), 'the walk key is a hold and nothing else, and the slow strafe is the sideways walk whatever is in hand: neither is a switch (the owner\'s answers)');
  const dials = allDials(LOCO_DIALS);
  const keys = dials.map((d) => d.key);
  const choiceKeys = ['tune.on', 'tune.gunSquare', 'tune.sprintFight', 'tune.sideWalkClip', 'tune.gunCarry.pistol', 'tune.gunCarry.carbine', 'tune.gunCarry.rifle', 'tune.gunCarry.heavy'];
  ok(numbers.every((p) => keys.includes(`tune.${p}`)) && choiceKeys.every((k) => keys.includes(k)) && new Set(keys).size === keys.length && dials.length === numbers.length + choiceKeys.length, `every number of the tune is a slider, and its two switches, its choice of what a fight's key does to a sprint, of what walking sideways plays and of what each kind of gun's pace plays out of combat are choices (${dials.length} dials)`);
  ok(locoDialsFor('loco') === LOCO_DIALS && locoDialsFor('anim') === null, 'the debug menu is handed them for `loco` and for nothing else');
  // Each number dial moves its own number through the helper's own setter, and is held to its range.
  let moved = 0;
  for (const d of dials) {
    if (d.kind !== 'number') continue;
    const was = (d as NumberDial).get();
    const to = was === d.max ? d.min : d.max;
    d.set(to);
    if ((d as NumberDial).get() === to) moved++;
    const words = d.set(d.max + 1000);
    assert.ok((d as NumberDial).get() === d.max && words.length === 1, `${d.key} is held to its range and says so`);
  }
  ok(moved === dials.filter((d) => d.kind === 'number').length && JSON.stringify(LOCO_TUNE) !== JSON.stringify(LOCO_TUNE_SHIPPED), 'each slider moves its own number, held to its range');
  const line = movedLine(LOCO_DIALS);
  ok(line.startsWith('__debug.loco({tune:{') || line.startsWith('__debug.loco({ tune: {'), `the line the menu copies out is the helper's own argument (${line.slice(0, 60)}...)`);
  resetDials(LOCO_DIALS);
  ok(JSON.stringify(LOCO_TUNE) === JSON.stringify(LOCO_TUNE_SHIPPED) && movedArgs(LOCO_DIALS) === '', 'and a reset puts every one back');
  // The choices take the words the dials show, and the line they write sets what it says.
  const onDial = dials.find((d) => d.key === 'tune.on')!;
  onDial.set('off');
  ok(LOCO_TUNE.on === false, 'the classes\' switch goes off from its dial');
  ok(tuneLoco({ on: 'on' }).length === 0 && LOCO_TUNE.on === true, 'and back on by the word the dial\'s own line writes');
  const square = dials.find((d) => d.key === 'tune.gunSquare')!;
  square.set('off');
  ok(LOCO_TUNE.gunSquare === false && tuneLoco({ gunSquare: true }).length === 0 && LOCO_TUNE.gunSquare === true && tuneLoco({ gunSquare: 'sometimes' }).length === 1, 'the square diagonals\' switch the same; a switch takes true or false and says so of anything else');
  const fight = dials.find((d) => d.key === 'tune.sprintFight')!;
  ok(fight.kind === 'choice' && (fight as { choices: readonly string[] }).choices.join() === 'ends,muted' && (fight as { get: () => string }).get() === 'ends', 'what a fight\'s key does to a sprint is a choice of its two words, standing at \'ends\'');
  fight.set('muted');
  ok(LOCO_TUNE.sprintFight === 'muted' && tuneLoco({ sprintFight: 'ends' }).length === 0 && LOCO_TUNE.sprintFight === 'ends' && tuneLoco({ sprintFight: true }).length === 1 && LOCO_TUNE.sprintFight === 'ends', 'its dial sets the rule, the word its line writes sets it back, and anything but its two words is said and sets nothing');
  ok(tuneLoco({ speed: { forward: { run: 5.2 } } }).length === 0 && LOCO_TUNE.speed.forward.run === 5.2 && tuneLoco({ speed: { forward: { run: LOCO_TUNE_SHIPPED.speed.forward.run } } }).length === 0, 'a nested patch sets one number');
  const words = tuneLoco({ speed: { forward: { hop: 3 } }, nothing: 1, rate: 4, shift: { dropDelay: 'soon' }, walkKey: 'hold', __proto__: { on: false } });
  ok(words.length === 5 && JSON.stringify(LOCO_TUNE) === JSON.stringify(LOCO_TUNE_SHIPPED), `a name it has not got, a group given a number and a number given a word are each said and set nothing (${words.join('; ')})`);
  ok(tuneLoco(null).length === 1 && tuneLoco([1]).length === 1, 'and a patch that is no object is said');
  ok(locoSwitchOn(() => null) && locoSwitchOn(() => '1') && !locoSwitchOn(() => '0') && locoSwitchOn(() => { throw new Error('no storage'); }), 'the classes are on at load unless the stored switch is 0; a page that refuses storage has them on');
  ok(LOCO_SWITCH === 'swg.loco' && readFileSync(join(root, 'README.md'), 'utf8').includes("localStorage['swg.loco'] = '0'") && /LOCO_TUNE\.on = locoSwitchOn\(\(\) => localStorage\.getItem\(LOCO_SWITCH\)\);/.test(readFileSync(join(root, 'src', 'main.ts'), 'utf8')), 'the stored switch is read under the very name the README gives, `swg.loco`');
}

console.log(`\n${checks} checks passed`);
