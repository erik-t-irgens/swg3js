// Race tracks and runs (src/race/): the track file's reader and its frames, the swept gate crossing, a run's order,
// laps, wrong way, finish, put-back and bests, its clock on the physics' own fixed steps through the real accumulator
// with the game's own Vehicle and race drive, the editor's pure edits, the character mark, and the committed TEST
// course (its file, its limits, and with the converted packs present its gentle ground and an empty corridor).
//
// Nothing is game data but the TEST course's own file, which is authored content laid on the world's ground; the
// course's check reads the converted packs only when they are there (`SWG3JS_PACKS` or `assets-private/`), and prints
// counts.
//
// Run: node tools/swg/tests/raceTrack.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { FIXED_DT, Physics } from '../../../src/core/physics.ts';
import { Vehicle, specFor, type DriveInput } from '../../../src/vehicles/vehicle.ts';
import { RACE_CLOCK, attachRace, type RaceGround } from '../../../src/vehicles/raceDrive.ts';
import { RACE_BASE, RACE_TUNE } from '../../../src/vehicles/raceTune.ts';
import { kindFor, raceRoute } from '../../../src/vehicles/vehicleKinds.ts';
import { CROSS_BACKWARD, CROSS_FORWARD, CROSS_NONE, GATE_BELOW, GATE_STRIDE, bakeGate, crossGate, gateCorners, headingTurn, newSegment, turnHeading } from '../../../src/race/gates.ts';
import { TRACK_LIMITS, corridorCircles, corridorHits, courseLegs, lapLength, readTrack, readTrackFile, trackFileOf, trackFileText, trackInGame, trackSync, tracksPath, type TrackDef } from '../../../src/race/trackFile.ts';
import { RUN_ACT, RUN_EVENT, RUN_STEP, RaceRun, STAND_LIFT, bestOf, mergeBest, newRunWorld, putBackSpawn, raceBestKey, raceDelta, raceTime, runBestOf, runInput, runKindFor, runStep, type RaceBestBook } from '../../../src/race/raceRun.ts';
import { TRACK_TUNE, tuneTrack } from '../../../src/race/trackTune.ts';
import { deleteGate, insertGate, moveGateTo, nudgeGate, resizeGate } from '../../../src/race/trackEdits.ts';
import { fromGame, toGame } from '../../../src/story/placements.ts';
import { characterMark } from '../../../src/net/session.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const close = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

/** A track of round numbers (raw frame): a square circuit of four gates, a hundred metres a side. */
function squareTrack(over: Partial<TrackDef> = {}): TrackDef {
  const turn = (h: number) => {
    const q = fromGame({ x: 0, y: 0, z: 0, q: headingTurn(h) }, null, 'raw').q;
    return [q[0], q[1], q[2], q[3]] as [number, number, number, number];
  };
  return {
    id: 'square',
    name: 'TEST: square',
    kind: 'circuit',
    laps: 2,
    for: ['podracer', 'speederbike'],
    clear: 10,
    grid: { x: 0, y: 1, z: -30, q: turn(0) },
    gates: [
      { x: 0, y: 1, z: 0, q: turn(0), w: 24, h: 40 },
      { x: 0, y: 1, z: 100, q: turn(0), w: 24, h: 40 },
      { x: 100, y: 1, z: 100, q: turn(Math.PI), w: 24, h: 40 },
      { x: 100, y: 1, z: 0, q: turn(Math.PI), w: 24, h: 40 },
    ],
    ...over,
  };
}

// --- 1. the reader ------------------------------------------------------------------------------------------------

{
  const t = squareTrack();
  const text = trackFileText('tatooine', 'raw', [t]);
  const read = readTrackFile(text, 'tatooine', 'ground');
  ok(read.problem === null && read.skipped.length === 0 && read.tracks.length === 1, 'a good file reads, every track kept');
  ok(JSON.stringify(read.tracks[0]) === JSON.stringify(t), 'and a track reads back to the very numbers it was written with');
  ok(trackFileText('tatooine', 'raw', read.tracks) === text, 'and written again it is the same text, line for line');
  const lines = text.split('\n');
  ok(lines.filter((l) => /^\s+\{ "x": .*"w": 24, "h": 40 \}/.test(l)).length === 4, 'one line a gate, so a gate moved is one line changed');
  const bad = (why: string, file: string, frameKind: 'ground' | 'space' = 'ground', world = 'tatooine') => {
    const r = readTrackFile(file, world, frameKind);
    ok(r.problem !== null && r.tracks.length === 0, `a bad header refuses the whole file: ${why} (${r.problem})`);
  };
  bad('it does not read', '{ "version": 1, ');
  bad('not an object', '[1, 2]');
  bad('another version', text.replace('"version": 1', '"version": 2'));
  bad("another world's", text, 'ground', 'naboo');
  bad('the wrong frame for a space zone', text, 'space');
  bad('no tracks list', '{ "version": 1, "world": "tatooine", "frame": "raw" }');
  // Bad tracks: each skipped and named, the rest kept.
  const o = JSON.parse(text);
  const good = o.tracks[0];
  const variants: [string, Record<string, unknown>][] = [
    ['id', { id: 'Bad Id' }],
    ['a forbidden id', { id: 'constructor' }],
    ['name', { name: '' }],
    ['kind', { kind: 'loop' }],
    ['laps', { laps: 0 }],
    ['a sprint of two laps', { kind: 'sprint', laps: 2 }],
    ['for', { for: ['xwing'] }],
    ['for twice', { for: ['podracer', 'podracer'] }],
    ['clear past its most', { clear: TRACK_LIMITS.clearMost + 1 }],
    ['grid', { grid: { x: 0, y: 0, z: 0 } }],
    ['one gate', { gates: [good.gates[0]] }],
    ['a gate too narrow', { gates: [{ ...good.gates[0], w: TRACK_LIMITS.widthLeast - 0.01 }, good.gates[1]] }],
    ['a gate too wide', { gates: [{ ...good.gates[0], w: TRACK_LIMITS.widthMost + 1 }, good.gates[1]] }],
    ['a gate too low', { gates: [{ ...good.gates[0], h: TRACK_LIMITS.heightLeast - 1 }, good.gates[1]] }],
    ['a gate too tall', { gates: [{ ...good.gates[0], h: TRACK_LIMITS.heightMost + 1 }, good.gates[1]] }],
    ['a gate too far out across', { gates: [{ ...good.gates[0], x: TRACK_LIMITS.reach + 1 }, good.gates[1]] }],
    ['a grid too far out along', { grid: { ...good.grid, z: -(TRACK_LIMITS.reach + 1) } }],
    ['a gate too far up', { gates: [{ ...good.gates[0], y: TRACK_LIMITS.height + 1 }, good.gates[1]] }],
    ['a turn that is not one', { gates: [{ ...good.gates[0], q: [1, 1, 0, 0] }, good.gates[1]] }],
  ];
  for (const [what, patch] of variants) {
    const f = { ...o, tracks: [{ ...good, id: 'kept' }, { ...good, ...patch, id: patch.id ?? 'refused' }] };
    const r = readTrackFile(JSON.stringify(f), 'tatooine', 'ground');
    ok(r.problem === null && r.tracks.length === 1 && r.tracks[0].id === 'kept' && r.skipped.length === 1, `a bad track is skipped and named, the rest kept: ${what} (${r.skipped[0]?.why})`);
  }
  // And every limit is a limit, not a refusal: a track at each of them reads.
  const L = TRACK_LIMITS;
  const edge = { ...good, gates: [{ ...good.gates[0], w: L.widthLeast, h: L.heightLeast, x: L.reach }, { ...good.gates[1], w: L.widthMost, h: L.heightMost, z: -L.reach, y: L.height }], grid: { ...good.grid, x: -L.reach } };
  ok(typeof readTrack(edge) !== 'string', `a gate ${L.widthLeast} and ${L.widthMost} m wide, ${L.heightLeast} and ${L.heightMost} m tall, ${L.reach} m out and ${L.height} m up reads`);
  // Limits: a file past its tracks, a second track of one id, too many gates.
  const many = { ...o, tracks: Array.from({ length: TRACK_LIMITS.tracks + 3 }, (_, i) => ({ ...good, id: `t${i}` })) };
  const rm = readTrackFile(JSON.stringify(many), 'tatooine', 'ground');
  ok(rm.tracks.length === TRACK_LIMITS.tracks && rm.skipped.length === 3, `${TRACK_LIMITS.tracks} tracks a file, the rest skipped and named`);
  const twice = { ...o, tracks: [good, good] };
  ok(readTrackFile(JSON.stringify(twice), 'tatooine', 'ground').skipped[0]?.why === 'a second track under the same id', 'a second track of one id is skipped');
  const gates = Array.from({ length: TRACK_LIMITS.gates + 1 }, (_, i) => ({ ...good.gates[0], z: i * 10 }));
  ok(typeof readTrack({ ...good, gates }) === 'string', `${TRACK_LIMITS.gates} gates a track at most`);
  const unknown: string[] = [];
  readTrack({ ...good, colour: 'red', gates: [{ ...good.gates[0], tilt: 1 }, good.gates[1]] }, unknown);
  ok(unknown.includes('square.colour') && unknown.includes('square.gates[0].tilt'), 'a field this build does not read is noted, never refused');
  ok(readTrackFile(trackFileText('space_tatooine', 'game', [t]), 'space_tatooine', 'space').tracks.length === 1, "a space zone's file is in the game's own frame");
  ok(tracksPath('tatooine') === 'tracks/tatooine.json' && trackFileOf('tatooine.json')?.world === 'tatooine' && trackFileOf('.tatooine.json.tmp') === null && trackFileOf('sub/x.json') === null && trackFileOf('a.txt') === null, "the dev server's watcher names a world's file and nothing else (a dot name, a folder, another kind)");
}

// --- 2. the frames ------------------------------------------------------------------------------------------------

{
  const t = squareTrack();
  const centre = { x: -1376, z: -3576 };
  const g = trackInGame(t, centre, 'raw');
  ok(t.gates.every((gate, i) => JSON.stringify(toGame(gate, centre, 'raw')) === JSON.stringify({ x: g.gates[i].x, y: g.gates[i].y, z: g.gates[i].z, q: g.gates[i].q })), "every gate is carried into the game's frame by the placements' own toGame");
  const back = fromGame(g.gates[2], centre, 'raw');
  ok(close(back.x, t.gates[2].x, 1e-9) && close(back.z, t.gates[2].z, 1e-9) && back.q.every((n, i) => close(n, t.gates[2].q[i], 1e-12)), 'and back again to the very place');
  // A gate dropped facing a heading in the game faces that heading once read back and baked.
  for (const h of [0, 0.7, -2.1, Math.PI]) {
    const raw = fromGame({ x: 5, y: 1, z: 7, q: headingTurn(h) }, centre, 'raw');
    const game = toGame(raw, centre, 'raw');
    const baked = new Float64Array(GATE_STRIDE);
    bakeGate({ ...game, w: 24, h: 40 }, baked, 0);
    ok(close(Math.atan2(baked[3], baked[5]), h <= Math.PI && h > -Math.PI ? h : Math.atan2(Math.sin(h), Math.cos(h)), 1e-9) && close(turnHeading(game.q), Math.atan2(Math.sin(h), Math.cos(h)), 1e-9), `a gate dropped facing ${h.toFixed(2)} rad faces it through the file and back`);
  }
}

// --- 3. the swept crossing ----------------------------------------------------------------------------------------

{
  // The research's trials, at the halved speeds: a gate in the open, paths at 166.7 and 97.2 m/s turning at up to 1.2
  // rad/s and bobbing 0.5 to 3.5 m, crossing it, at 144, 60, 30 and 20 fps with 30% jitter clamped at a twentieth.
  // The body is moved as the game moves it: on the physics' own fixed steps, at the velocity the frame before them
  // commanded. The truth is the same body's own steps, crossed on 1 ms samples of its motion between them.
  const gate = new Float64Array(GATE_STRIDE);
  bakeGate({ x: 0, y: 0, z: 0, q: [0, 0, 0, 1], w: 24, h: 40 }, gate, 0);
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const s = newSegment();
  let missed = 0;
  let falseCrossings = 0;
  let worst = 0;
  // Crossings: trials whose path really passes through the window (half the paths wander past it, and those are drawn
  // again until each speed and rate has 400 that cross, 3,200 in all), and paths drawn.
  let trials = 0;
  let drawn = 0;
  let shortCells = 0;
  for (const speed of [166.7, 97.2]) {
    for (const fps of [144, 60, 30, 20]) {
      let found = 0;
      for (let k = 0; found < 400 && k < 4000; k++) {
        drawn++;
        // The body's own steps: its place at every fixed step, its velocity held from the frame before.
        const steps: { t: number; x: number; y: number; z: number }[] = [];
        let x = (rand() - 0.5) * 12;
        let z = -speed * (0.4 + rand() * 0.4);
        let y = 2;
        let heading = (rand() - 0.5) * 0.6;
        // The turn rate wanders within 1.2 rad/s, quickly enough that the heading itself stays within about 0.6 rad.
        const turnAmp = rand() * 1.2;
        const turnF = 2 + rand() * 4;
        const bobF = 1 + rand() * 3;
        const phase = rand() * Math.PI * 2;
        let t = 0;
        let acc = 0;
        let clock = 0;
        const frames: { t: number; x: number; y: number; z: number }[] = [{ t: 0, x, y, z }];
        steps.push({ t: 0, x, y, z });
        while (z < speed * 0.5 && t < 3) {
          const dt = Math.min(0.05, (1 / fps) * (1 + (rand() - 0.5) * 0.6));
          t += dt;
          // The frame's command: heading and bob.
          heading += turnAmp * Math.sin(turnF * t + phase) * dt;
          const vx = Math.sin(heading) * speed;
          const vz = Math.cos(heading) * speed;
          const vy = 1.5 * bobF * Math.cos(bobF * t + phase);
          // The fixed steps this frame takes (`stepsAhead`, at most four).
          acc += dt;
          let n = 0;
          while (acc >= FIXED_DT && n < 4) {
            acc -= FIXED_DT;
            n++;
            x += vx * FIXED_DT;
            z += vz * FIXED_DT;
            y = Math.max(0.5, Math.min(3.5, y + vy * FIXED_DT));
            clock += FIXED_DT;
            steps.push({ t: clock, x, y, z });
          }
          if (n === 4) acc = 0;
          frames.push({ t: clock, x, y, z });
        }
        // The truth: 1 ms samples along the body's own steps.
        let truth = Number.NaN;
        for (let i = 1; i < steps.length && Number.isNaN(truth); i++) {
          const a = steps[i - 1];
          const b = steps[i];
          const m = Math.max(1, Math.round((b.t - a.t) / 0.001));
          for (let j = 1; j <= m; j++) {
            const f0 = (j - 1) / m;
            const f1 = j / m;
            s.x0 = a.x + (b.x - a.x) * f0;
            s.y0 = a.y + (b.y - a.y) * f0;
            s.z0 = a.z + (b.z - a.z) * f0;
            s.x1 = a.x + (b.x - a.x) * f1;
            s.y1 = a.y + (b.y - a.y) * f1;
            s.z1 = a.z + (b.z - a.z) * f1;
            if (crossGate(gate, 0, s) === CROSS_FORWARD) {
              truth = a.t + (b.t - a.t) * (f0 + (f1 - f0) * s.t);
              break;
            }
          }
        }
        // The swept test, frame to frame.
        let got = Number.NaN;
        for (let i = 1; i < frames.length; i++) {
          const a = frames[i - 1];
          const b = frames[i];
          s.x0 = a.x;
          s.y0 = a.y;
          s.z0 = a.z;
          s.x1 = b.x;
          s.y1 = b.y;
          s.z1 = b.z;
          if (crossGate(gate, 0, s) === CROSS_FORWARD) {
            got = a.t + (b.t - a.t) * s.t;
            break;
          }
        }
        if (Number.isNaN(truth)) {
          // A path that never passes through the window must not be read as crossing it either.
          if (!Number.isNaN(got)) falseCrossings++;
          continue;
        }
        found++;
        trials++;
        if (Number.isNaN(got)) missed++;
        else worst = Math.max(worst, Math.abs(got - truth));
      }
      if (found < 400) shortCells++;
    }
  }
  ok(trials === 3200 && shortCells === 0, `3,200 crossing trials, 400 at each of 166.7 and 97.2 m/s and 144, 60, 30 and 20 fps with jitter (${drawn} paths drawn for them; the rest passed the window by)`);
  ok(missed === 0, `${trials} crossings: none missed`);
  ok(falseCrossings === 0, `and of the ${drawn - trials} paths that pass the window by, none read as crossing it`);
  ok(worst < 1e-5, `and every crossing timed within 0.01 ms of the body's own steps (worst ${(worst * 1000).toFixed(6)} ms)`);
  // The cost of a call, half of them crossings.
  const segs = Array.from({ length: 1024 }, (_, i) => {
    const q = newSegment();
    q.x0 = (i % 7) - 3;
    q.y0 = 2;
    q.z0 = -1 - (i % 3);
    q.x1 = q.x0;
    q.y1 = 2;
    q.z1 = i % 2 ? 2 : -0.5;
    return q;
  });
  let hits = 0;
  for (let i = 0; i < 2e5; i++) hits += crossGate(gate, 0, segs[i & 1023]);
  const N = 2e6;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) hits += crossGate(gate, 0, segs[i & 1023]);
  const ns = Number(process.hrtime.bigint() - t0) / N;
  ok(ns < 50 && hits !== 0, `a crossing test costs ${ns.toFixed(1)} ns a call (under 50)`);
  // The window: through the plane outside it is no crossing, and a backward one is said as such.
  const w = newSegment();
  Object.assign(w, { x0: 20, y0: 2, z0: -1, x1: 20, y1: 2, z1: 1 });
  ok(crossGate(gate, 0, w) === CROSS_NONE, 'through the plane outside the window is no crossing');
  Object.assign(w, { x0: 0, y0: 50, z0: -1, x1: 0, y1: 50, z1: 1 });
  ok(crossGate(gate, 0, w) === CROSS_NONE, 'nor over its top');
  Object.assign(w, { x0: 0, y0: 2, z0: 1, x1: 0, y1: 2, z1: -1 });
  ok(crossGate(gate, 0, w) === CROSS_BACKWARD, 'and through it the wrong way is backward');
  const corners = new Float64Array(12);
  gateCorners(gate, 0, corners, 0);
  ok(close(corners[0], -12, 1e-9) && close(corners[1], -5, 1e-9) && close(corners[7], 35, 1e-9), 'its corners are its window: 24 wide, from an eighth of its 40 below its place to the rest above');
  // What the crossing accepts is the outline the overlay draws, held edge by edge on a gate turned and tilted: a
  // segment through the gate's plane a millimetre inside each edge's middle crosses, a millimetre outside does not. The
  // plane's normal and the inward ways come from the corners alone, not from the baked row the test reads.
  {
    const tilted = new Float64Array(GATE_STRIDE);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.7, 0.1, 'YXZ'));
    bakeGate({ x: 30, y: 4, z: -20, q: [q.x, q.y, q.z, q.w], w: 18, h: 32 }, tilted, 0);
    const c = new Float64Array(12);
    gateCorners(tilted, 0, c, 0);
    const P = (k: number) => new THREE.Vector3(c[k * 3], c[k * 3 + 1], c[k * 3 + 2]);
    const mid = P(0).add(P(1)).add(P(2)).add(P(3)).multiplyScalar(0.25);
    const n = P(1).sub(P(0)).cross(P(3).sub(P(0))).normalize();
    const seg = newSegment();
    let edgesHeld = 0;
    const edgeNames = ['bottom', 'right', 'top', 'left'];
    const wrong: string[] = [];
    for (let k = 0; k < 4; k++) {
      const m = P(k).add(P((k + 1) % 4)).multiplyScalar(0.5);
      const inward = mid.clone().sub(m).normalize();
      for (const [side, d] of [['inside', 0.001], ['outside', -0.001]] as const) {
        const p = m.clone().addScaledVector(inward, d);
        Object.assign(seg, { x0: p.x - n.x, y0: p.y - n.y, z0: p.z - n.z, x1: p.x + n.x, y1: p.y + n.y, z1: p.z + n.z });
        const fwd = crossGate(tilted, 0, seg);
        Object.assign(seg, { x0: p.x + n.x, y0: p.y + n.y, z0: p.z + n.z, x1: p.x - n.x, y1: p.y - n.y, z1: p.z - n.z });
        const back = crossGate(tilted, 0, seg);
        const want = side === 'inside';
        if ((fwd === CROSS_FORWARD) === want && (back === CROSS_BACKWARD) === want && (want || (fwd === CROSS_NONE && back === CROSS_NONE))) edgesHeld++;
        else wrong.push(`${edgeNames[k]} ${side}: ${fwd}, ${back}`);
      }
    }
    ok(edgesHeld === 8, `the window the crossing tests is the outline drawn: through a millimetre inside each of its four edges it crosses either way, a millimetre outside it does not${wrong.length ? ` (${wrong.join('; ')})` : ''}`);
    const place = new THREE.Vector3(30, 4, -20);
    const bottom = P(0).add(P(1)).multiplyScalar(0.5);
    const top = P(2).add(P(3)).multiplyScalar(0.5);
    ok(close(P(0).distanceTo(P(3)), 32, 1e-9) && close(P(0).distanceTo(P(1)), 18, 1e-9) && close(place.distanceTo(bottom), 32 * GATE_BELOW, 1e-9) && close(place.distanceTo(top), 32 * (1 - GATE_BELOW), 1e-9), "and it is the gate's own 18 by 32 m, an eighth of it below the gate's place");
  }
}

// --- 4. a run: order, laps, wrong way, the finish, the put-back --------------------------------------------------

/** A run of a track in the game's frame (centre nought), with a fake hull moved by hand. */
function runOf(t: TrackDef, best: Parameters<typeof bestOf>[0] = null, kind: 'podracer' | 'speederbike' = 'podracer'): { run: RaceRun; hull: { pos: { x: number; y: number; z: number } }; go: (x: number, z: number, seconds: number) => void; events: { kind: number; gate: number; lap: number; time: number; delta: number }[] } {
  const g = trackInGame(t, null, 'raw');
  const run = new RaceRun(t, 'test', kind, 'pod', g.grid, g.gates, 1.25, bestOf(best, raceBestKey('test', t.id), kind));
  const hull = { pos: { x: g.grid.x, y: g.grid.y - 1.25, z: g.grid.z } };
  const events: { kind: number; gate: number; lap: number; time: number; delta: number }[] = [];
  run.standing(hull.pos.x, hull.pos.y, hull.pos.z);
  /** One "frame": the watch tests from its mark to the hull's place, then the clock moves on, then the hull moves. */
  const go = (x: number, z: number, seconds: number) => {
    run.cross(hull);
    for (let k = 0; k < run.eventCount; k++) events.push(run.eventAt(k));
    run.clearEvents();
    run.advance(seconds);
    hull.pos.x = x;
    hull.pos.z = z;
  };
  return { run, hull, go, events };
}

/** Drive a hull round a list of points in the game's frame at a speed, a frame at a time. */
function driveRound(r: ReturnType<typeof runOf>, pts: { x: number; z: number }[], speed: number, dt: number): void {
  for (const p of pts) {
    const from = { x: r.hull.pos.x, z: r.hull.pos.z };
    const d = Math.hypot(p.x - from.x, p.z - from.z);
    const n = Math.max(1, Math.ceil(d / (speed * dt)));
    for (let i = 1; i <= n; i++) r.go(from.x + ((p.x - from.x) * i) / n, from.z + ((p.z - from.z) * i) / n, dt);
  }
  r.go(r.hull.pos.x, r.hull.pos.z, dt);
}

{
  const t = squareTrack();
  const g = trackInGame(t, null, 'raw');
  const r = runOf(t);
  ok(r.run.phase === 'countdown' && r.run.clock === -TRACK_TUNE.countdown, `a run counts down ${TRACK_TUNE.countdown} s at its grid`);
  // Standing through the countdown: nothing crossed, go at nought.
  for (let i = 0; i < 200; i++) r.go(r.hull.pos.x, r.hull.pos.z, 1 / 60);
  ok(r.run.phase === 'racing' && r.events.filter((e) => e.kind === RUN_EVENT.go).length === 1 && r.run.seq === 0, 'go once at nought, and standing at the grid crosses nothing');
  // The game's frame: the square is mirrored in x. Round it twice: grid, gate 0, 1, 2, 3, 0, 1, 2, 3, 0.
  const corner = (i: number) => ({ x: g.gates[i].x, z: g.gates[i].z });
  const outside = (i: number, d: number) => {
    const q = g.gates[i].q;
    const fx = 2 * (q[0] * q[2] + q[3] * q[1]);
    const fz = 1 - 2 * (q[0] * q[0] + q[1] * q[1]);
    return { x: g.gates[i].x + fx * d, z: g.gates[i].z + fz * d };
  };
  driveRound(r, [outside(0, 5), corner(1), outside(1, 5), corner(2), outside(2, 5), corner(3), outside(3, 5), corner(0), outside(0, 5)], 50, 1 / 60);
  ok(r.run.lap === 2 && r.run.lapTimes.length === 1 && r.events.filter((e) => e.kind === RUN_EVENT.lap).length === 1, `a lap is done at gate 0 once every gate has been crossed in order (${raceTime(r.run.lapTimes[0])})`);
  ok(r.events.filter((e) => e.kind === RUN_EVENT.gate).map((e) => e.gate).join(',') === '0,1,2,3', 'the gates in order, gate 0 opening the first lap');
  const lap1 = r.run.lapTimes[0];
  const lapEvent = r.events.find((e) => e.kind === RUN_EVENT.lap);
  const gateTimes = r.events.filter((e) => e.kind === RUN_EVENT.gate && e.gate > 0).map((e) => e.time);
  ok(!!lapEvent && lapEvent.time === lap1 && r.run.bestSplits?.[0] === lap1 && r.run.bestSplits.slice(1).every((t, i) => t === gateTimes[i]), "the lap's own time stands at gate 0's split, and a first lap is the best, its splits the gates' own times");
  // Gate 2 skipped (driven past outside its window): it is still the next, and 3 counts for nothing.
  const before = r.run.seq;
  driveRound(r, [corner(1), outside(1, 5), { x: g.gates[2].x - 60, z: g.gates[2].z + 60 }, { x: g.gates[2].x - 60, z: g.gates[2].z - 60 }, corner(3)], 50, 1 / 60);
  ok(r.run.next === 2 && r.run.seq === before + 1, 'a gate missed stays the next gate, and the one after it counts for nothing');
  // The wrong way: back through gate 2 against it, said once, and it stays the next gate.
  const g2back = outside(2, 5);
  const g2front = outside(2, -5);
  const seqWrong = r.run.seq;
  driveRound(r, [g2back, g2front, outside(2, -20)], 30, 1 / 60);
  ok(r.events.filter((e) => e.kind === RUN_EVENT.wrongWay).length === 1 && r.run.wrongWay && r.run.next === 2 && r.run.seq === seqWrong, 'crossed the wrong way it says so once, and the gate is still the next');
  // Round the gate outside its window and back through it the wrong way again: still said once, until it is crossed
  // the right way.
  const off = (i: number, across: number, along: number) => {
    const o = i * GATE_STRIDE;
    const gg = r.run.gates;
    return { x: gg[o] + gg[o + 6] * across + gg[o + 3] * along, z: gg[o + 2] + gg[o + 8] * across + gg[o + 5] * along };
  };
  driveRound(r, [off(2, 30, -20), off(2, 30, 5), g2back, g2front], 30, 1 / 60);
  ok(r.events.filter((e) => e.kind === RUN_EVENT.wrongWay).length === 1 && r.run.wrongWay && r.run.next === 2 && r.run.seq === seqWrong, 'crossed the wrong way a second time it says nothing more, and the gate is still the next');
  driveRound(r, [g2back, corner(3), outside(3, 5), corner(0), outside(0, 5)], 50, 1 / 60);
  ok(r.run.phase === 'finished' && r.run.lapTimes.length === 2 && Number.isFinite(r.run.total) && r.events.filter((e) => e.kind === RUN_EVENT.finish).length === 1, `a circuit finishes at its last lap (${raceTime(r.run.total)} in all)`);
  ok(!r.run.wrongWay, 'and the right way clears the wrong way');
  // A sprint ends at its last gate.
  const sprint = { ...squareTrack(), id: 'line', kind: 'sprint' as const, laps: 1 };
  const s = runOf(sprint);
  for (let i = 0; i < 200; i++) s.go(s.hull.pos.x, s.hull.pos.z, 1 / 60);
  const sg = trackInGame(sprint, null, 'raw');
  driveRound(s, [{ x: sg.gates[0].x, z: sg.gates[0].z + 5 }, { x: sg.gates[1].x, z: sg.gates[1].z + 5 }, { x: sg.gates[1].x - 50, z: sg.gates[1].z + 5 }, { x: sg.gates[2].x - 5, z: sg.gates[2].z + 5 }, { x: sg.gates[2].x - 5, z: sg.gates[3].z - 5 }], 40, 1 / 60);
  ok(s.run.phase === 'finished' && s.run.seq === 4 && s.run.lapTimes.length === 1 && close(s.run.lapTimes[0], s.run.total, 1e-12), 'a sprint ends at its last gate, its one lap its total');
  // The put-back: at the last gate crossed, facing the next, and before the first, at the grid facing gate 0.
  const p = runOf(squareTrack());
  for (let i = 0; i < 200; i++) p.go(p.hull.pos.x, p.hull.pos.z, 1 / 60);
  p.run.goDown();
  const atGrid = p.run.putBackPlace();
  ok(p.run.phase === 'down' && close(atGrid.x, g.grid.x, 1e-9) && close(atGrid.z, g.grid.z, 1e-9) && close(atGrid.heading, Math.atan2(g.gates[0].x - g.grid.x, g.gates[0].z - g.grid.z), 1e-9), 'down before the first gate it is put back at the grid, facing gate 0');
  // The grid is a body's place (the editor writes it where the body stands) and a gate a hull's middle (dropped at it):
  // the put-back hands back the body's place either way.
  ok(atGrid.y === g.grid.y, `and at the grid's own height, the body's place the countdown stood it at (${atGrid.y} m, the grid ${g.grid.y} m)`);
  p.run.backUp(atGrid.x, atGrid.y, atGrid.z);
  driveRound(p, [outside(0, 5), corner(1), outside(1, 5)], 50, 1 / 60);
  const clockAt = p.run.clock;
  p.run.goDown();
  ok(!p.run.putBackDue, 'a put-back waits');
  for (let i = 0; i < Math.ceil(TRACK_TUNE.putBack * 60) + 1; i++) p.run.advance(1 / 60);
  const at = p.run.putBackPlace();
  ok(p.run.putBackDue && p.run.clock > clockAt + TRACK_TUNE.putBack - 1e-9, `and is due once ${TRACK_TUNE.putBack} s of the run's own clock have gone, the clock running all the while`);
  ok(close(at.x, g.gates[1].x, 1e-9) && close(at.z, g.gates[1].z, 1e-9) && close(at.heading, Math.atan2(g.gates[2].x - g.gates[1].x, g.gates[2].z - g.gates[1].z), 1e-9), 'at the last gate crossed (gate 1), facing the next (gate 2)');
  ok(close(at.y, g.gates[1].y - p.run.midY, 1e-12), `with the hull's middle at the gate's own height (the body ${at.y} m under a gate at ${g.gates[1].y} m)`);
  const spawnAt = putBackSpawn(p.run, 3);
  ok(spawnAt.y === 3 + STAND_LIFT && putBackSpawn(p.run, -50).y === at.y && spawnAt.kind === p.run.kind, `and spawned there never under the floor (${STAND_LIFT} m over it at least), as the kind the run was raced as`);
  p.run.backUp(at.x, at.y, at.z);
  const seqBack = p.run.seq;
  driveRound(p, [outside(1, 1)], 30, 1 / 60);
  ok(p.run.phase === 'racing' && p.run.seq === seqBack, 'back up it races on, and the place it was stood at is no crossing');
  // The kind it is raced as and comes back as: the kind it was spawned as, whatever the vehicle is. A Koro-2 is neither
  // pod nor bike of its own (`kindFor`); spawned as a bike it races a bike's tracks, comes back a bike and keeps a bike's best.
  const own = kindFor({ id: 'koro2_speeder' }).kind;
  const both = squareTrack();
  const podOnly = squareTrack({ for: ['podracer'] });
  ok(own !== 'podracer' && own !== 'speederbike' && runKindFor(both, own).kind === null, `a Koro-2 spawned as itself (a ${own}) races no track`);
  ok(runKindFor(podOnly, 'speederbike').kind === null && runKindFor(podOnly, 'podracer').kind === 'podracer', 'a track raced as pods alone refuses it spawned as a bike, and takes it spawned as a pod');
  const raced = runKindFor(both, 'speederbike');
  const k = runOf(both, null, raced.kind ?? 'podracer');
  for (let i = 0; i < 200; i++) k.go(k.hull.pos.x, k.hull.pos.z, 1 / 60);
  k.run.goDown();
  const back = putBackSpawn(k.run, 0);
  ok(raced.kind === 'speederbike' && k.run.kind === 'speederbike' && back.kind === 'speederbike' && raceRoute({ id: 'koro2_speeder', kind: own, source: 'gallery' } as never, back.kind).drive === 'bike', 'spawned as a bike it is raced as a bike, and a crash spawns it again as a bike, driven as one');
  const keptBike = runBestOf(undefined, k.run, { lap: 50 }, {}, 1);
  const bikeKey = raceBestKey('test', both.id);
  ok(keptBike.lap && bestOf(keptBike.book, bikeKey, 'speederbike')?.lap === 50 && bestOf(keptBike.book, bikeKey, 'podracer') === null, "and its best is kept under the bike's kind, never a pod's");
  const main = src('../../../src/main.ts');
  ok(
    /const raced = runKindFor\(t, v\.spec\.kind\);\s*if \(!raced\.kind\) return raced\.why;\s*const kind = raced\.kind;/.test(main) &&
      /new RaceRun\(t, world, kind, def\.id, /.test(main) &&
      /const at = putBackSpawn\(run, this\.courseFloor\(pre\.x, pre\.z\)\);\s*const v = await this\.world\.spawnVehicle\(def, new THREE\.Vector3\(at\.x, at\.y, at\.z\), at\.heading, at\.kind, true, this\.fitFor\(def\)\);/.test(main) &&
      /const out = runBestOf\(c\.raceBest, run, got, levels, Date\.now\(\)\);/.test(main),
    "the game asks these very rules with the kind the vehicle was spawned as: its run, its put-back's spawn and its best",
  );
  ok(/const moded = race\.modes && race\.mode !== 'racing' && !race\.setMode\(v, 'racing'\);/.test(main) && /if \(moded\) this\.messages\.system\('racing mode: a timed run races the bike'\);/.test(main) && /if \(v\.race\.modes && v\.race\.mode !== 'racing' && !v\.race\.setMode\(v, 'racing'\)\) mode = ', in racing mode';/.test(main), 'a bike a run puts in racing mode (at its start and at a put-back) says so on the message line');
  ok(/if \(this\.raceRun !== run \|\| run\.phase !== 'down'/.test(main), 'and only while the run still stands waiting for it');
  // The wreck's own materials are held until the put-back's hull is prepared: disposed at the wreck they released two
  // sprite programs nothing else used, which the put-back then built on a live frame (seen in the smoke check).
  const world = src('../../../src/world/world.ts');
  ok(/this\.world\.disposeVehicle\(v, this\.raceRun\?\.live && v === this\.runVehicle \? this\.runKept : undefined\);/.test(main) && /run\.backUp\(v\.pos\.x, v\.pos\.y, v\.pos\.z\);[\s\S]{0,160}this\.world\.releaseVehicleMaterials\(this\.runKept\);/.test(main) && (main.match(/this\.world\.releaseVehicleMaterials\(this\.runKept\);/g) ?? []).length === 3 && /if \(keep\) \{[\s\S]{0,400}for \(const m of v\.ownedMaterials\) keep\.push\(m\);/.test(world), "a wrecked run hull's own materials are held until its put-back is prepared, and let go then, at the run's end or when it is cleared");
  // The race view's target is a heading of the world's: one left from before the hull was turned at the grid or a
  // put-back would turn it off the course at go (the smoke check's first start ran past gate 0 for want of this).
  ok(/v\.race\.standAt\(v, x, at, z, heading\);[\s\S]{0,200}this\.aimRaceViewAt\(heading\);/.test(main) && /this\.aimRaceViewAt\(at\.heading\);\s*if \(v\.race\) v\.race\.watch = run;/.test(main) && /private aimRaceViewAt\(heading: number\): void \{\s*this\.raceView\.target = heading;\s*this\.raceView\.yaw = heading \+ Math\.PI;[\s\S]{0,140}this\.cam\.yaw = heading \+ Math\.PI;/.test(main), "a hull stood at the grid or put back has the race view's target and camera turned to its new heading");
}

// --- 4b. splits against a best handed over, and the game's step of a run -----------------------------------------

{
  // A lap against a best the character kept: each gate's split set against the best lap's split there, the lap
  // against the best lap, and a faster lap's splits the new best's.
  const t = squareTrack();
  const g = trackInGame(t, null, 'raw');
  const book: RaceBestBook = { [raceBestKey('test', t.id)]: { podracer: { lap: 1000, at: 0, levels: {}, splits: [1000, 1, 2, 3] } } };
  const r = runOf(t, book);
  ok(r.run.bestLap === 1000 && r.run.bestSplits?.join() === '1000,1,2,3', 'a run starts from the best lap the character kept on that track as that kind, and its splits');
  for (let i = 0; i < 200; i++) r.go(r.hull.pos.x, r.hull.pos.z, 1 / 60);
  const ahead = (i: number, d: number) => {
    const o = i * GATE_STRIDE;
    return { x: r.run.gates[o] + r.run.gates[o + 3] * d, z: r.run.gates[o + 2] + r.run.gates[o + 5] * d };
  };
  driveRound(r, [ahead(0, 5), { x: g.gates[1].x, z: g.gates[1].z }, ahead(1, 5), { x: g.gates[2].x, z: g.gates[2].z }, ahead(2, 5), { x: g.gates[3].x, z: g.gates[3].z }, ahead(3, 5), { x: g.gates[0].x, z: g.gates[0].z }, ahead(0, 5)], 50, 1 / 60);
  const gates1 = r.events.filter((e) => e.kind === RUN_EVENT.gate && e.lap === 1 && e.gate > 0);
  ok(gates1.length === 3 && gates1.every((e) => e.delta === e.time - [1000, 1, 2, 3][e.gate] && e.delta > 0), `each gate's split is set against the best lap's split there (${gates1.map((e) => `gate ${e.gate} ${raceDelta(e.delta)}`).join(', ')})`);
  const lap = r.events.find((e) => e.kind === RUN_EVENT.lap);
  ok(!!lap && lap.delta === lap.time - 1000 && lap.delta < 0, `and the lap against the best lap (${lap ? raceDelta(lap.delta) : 'none'})`);
  ok(r.run.bestLap === lap?.time && r.run.bestSplits?.[0] === lap.time && gates1.every((e) => r.run.bestSplits?.[e.gate] === e.time), "a faster lap is the best lap now, and its splits the best's, which the game keeps");
  // Lap 2 is set against lap 1's own splits.
  driveRound(r, [{ x: g.gates[1].x, z: g.gates[1].z }, ahead(1, 5)], 25, 1 / 60);
  const g1lap2 = r.events.find((e) => e.kind === RUN_EVENT.gate && e.lap === 2 && e.gate === 1);
  const g1lap1 = gates1.find((e) => e.gate === 1);
  ok(!!g1lap2 && !!g1lap1 && close(g1lap2.delta, g1lap2.time - g1lap1.time, 1e-12) && g1lap2.delta > 0, `and the next lap against it: gate 1 at half the speed is ${g1lap2 ? raceDelta(g1lap2.delta) : 'none'}`);
}

{
  // The game's step of a run (`runStep`, which `App.stepRun` asks and does the side effects of), with a stand-in hull.
  const t = squareTrack();
  const fresh = () => {
    const g = trackInGame(t, null, 'raw');
    const run = new RaceRun(t, 'test', 'podracer', 'pod', g.grid, g.gates, 1.25, null);
    const w = newRunWorld();
    Object.assign(w, { simulate: true, steps: 1, hull: true, mounted: true, racing: true });
    return { run, w };
  };
  const toGo = (run: RaceRun, w: ReturnType<typeof newRunWorld>) => {
    let n = 0;
    while (run.phase === 'countdown' && n < 10000) {
      runStep(run, w);
      n++;
    }
    return n;
  };
  {
    const { run, w } = fresh();
    const steps = toGo(run, w);
    ok(steps === Math.round(TRACK_TUNE.countdown / RUN_STEP) && run.clock === 0, `go comes on the ${steps}th fixed step of the countdown's ${TRACK_TUNE.countdown} s, with the clock at nought`);
    const was = run.clock;
    w.simulate = false;
    w.steps = 3;
    for (let i = 0; i < 30; i++) runStep(run, w);
    ok(run.clock === was, "with play stood still the step moves the run's clock not at all, whatever steps the physics takes");
    w.simulate = true;
    w.steps = 1;
    w.destroyed = true;
    w.disposed = true;
    ok(runStep(run, w) === RUN_ACT.wrecked && run.phase === 'down', 'a hull wrecked (and disposed with it, as the world disposes a wreck) puts the run down');
    w.hull = false;
    w.destroyed = false;
    w.disposed = false;
    w.mounted = false;
    let asked = 0;
    let firstAsk = -1;
    let other = 0;
    for (let i = 1; i <= 400; i++) {
      const act = runStep(run, w);
      if (act === RUN_ACT.putBack) {
        asked++;
        if (firstAsk < 0) firstAsk = i;
        // The game starts spawning it, and says so for every step after.
        w.placing = true;
      } else if (act !== RUN_ACT.none) other++;
    }
    // The step on which the run's own clock, a sixtieth at a time from the wreck, first stands `putBack` past it.
    let due = 0;
    for (let c = run.downAt; !(c >= run.downAt + TRACK_TUNE.putBack); c += RUN_STEP) due++;
    ok(asked === 1 && other === 0 && firstAsk === due && due >= Math.round(TRACK_TUNE.putBack / RUN_STEP), `the put-back is asked for once and nothing else meanwhile, on the step ${TRACK_TUNE.putBack} s of the run's clock after the wreck (step ${firstAsk})`);
    run.backUp(0, 0, 0);
    w.placing = false;
    w.hull = true;
    w.mounted = true;
    ok(run.phase === 'racing' && runStep(run, w) === RUN_ACT.none, 'back up, the run races on');
    w.riderDown = true;
    ok(runStep(run, w) === RUN_ACT.died, 'a rider who dies ends it');
  }
  {
    const { run, w } = fresh();
    toGo(run, w);
    w.disposed = true;
    ok(runStep(run, w) === RUN_ACT.gone && run.phase === 'racing', 'a hull taken away without a wreck (a garage clear) ends the run rather than putting it back');
  }
  {
    const { run, w } = fresh();
    w.mounted = false;
    ok(runStep(run, w) === RUN_ACT.gotOff, 'a rider off the hull ends it, in the countdown too');
    w.mounted = true;
    w.racing = false;
    ok(runStep(run, w) === RUN_ACT.leftRacing, 'and so does a bike out of racing mode');
    w.riderDown = true;
    run.goDown();
    w.hull = false;
    ok(runStep(run, w) === RUN_ACT.died, 'and a rider dead while the hull is down');
  }
  {
    // A run over keeps its block until its rider is off its hull (an ended one as a finished one).
    const { run, w } = fresh();
    run.end('stopped');
    ok(runStep(run, w) === RUN_ACT.none, 'a run ended in words stays on the screen while its rider is on its hull');
    w.mounted = false;
    ok(runStep(run, w) === RUN_ACT.clear, 'and is cleared once they are off it');
    w.mounted = true;
    w.hull = false;
    ok(runStep(run, w) === RUN_ACT.clear, 'or once it has no hull');
  }
  // The game does these rules' side effects and nothing of its own.
  const main = src('../../../src/main.ts');
  const stepRun = main.slice(main.indexOf('  private stepRun('), main.indexOf('  private readonly runWorld = newRunWorld();'));
  ok(/w\.simulate = simulate;\s*w\.steps = simulate \? this\.physics\.stepsAhead\(dt\) : 0;/.test(stepRun) && /const act = runStep\(run, w\);/.test(stepRun) && /act === RUN_ACT\.putBack\) void this\.putBack\(\);/.test(stepRun) && /act === RUN_ACT\.clear\) this\.clearRun\(\);/.test(stepRun) && /act === RUN_ACT\.gone\) this\.endRun\(/.test(stepRun) && !/advanceSteps|goDown/.test(stepRun), "the game's stepRun writes the world into the record, asks runStep, and moves the clock or puts a run down nowhere else");
  ok(/w\.destroyed = !!v\?\.destroyed;\s*w\.disposed = !!v\?\.disposed;\s*w\.mounted = v !== null && p\.mounted === v;\s*w\.racing = !v\?\.race\?\.modes \|\| v\.race\.mode === 'racing';\s*w\.placing = this\.runPlacing;/.test(stepRun), 'with the hull as it stands');
  ok(/if \(run && this\.gateShapesFor === run && \(run\.live \|\| run\.phase === 'finished' \|\| run\.phase === 'ended'\)\)/.test(main), 'and draws a run ended in words with its note, as a finished one');
  // A group race (Racer wave 4a): the game's half of it, which raceTogether's test drives only through stand-in hooks, so
  // a line lost here would leave every member counting down on their own three seconds, or saying nothing to the group,
  // while every test of the rules and the module still passed.
  const startRun = main.slice(main.indexOf('  private async startRun('), main.indexOf('  private stepRun('));
  ok(
    /const at = group \? gridSlot\(\{ x: places\.grid\.x, y: places\.grid\.y, z: places\.grid\.z, heading \}, group\.slot, kind\) : places\.grid;/.test(startRun) &&
      /if \(group\) \{\s*run\.sharedStart = group\.race\.at;\s*syncGroupCountdown\(run, sharedClock\.now\(\) - sharedClock\.lagNow\(\)\);\s*\}/.test(startRun) &&
      main.includes('const words = await this.startRun(race.track, { race, slot });'),
    "a member's group run stands at its own slot behind the grid and counts down to the leader's moment on the shared clock",
  );
  ok(/if \(simulate && run\.phase === 'countdown' && Number\.isFinite\(run\.sharedStart\)\) syncGroupCountdown\(run, sharedClock\.now\(\) - sharedClock\.lagNow\(\)\);/.test(stepRun), "and its countdown is read off the shared clock on frames play is simulated, only while it counts down");
  const takeEvents = main.slice(main.indexOf('  private takeRunEvents('), main.indexOf('  private keepRaceBest('));
  const endRun = main.slice(main.indexOf('  private endRun('), main.indexOf('  private clearRun('));
  ok(
    /if \(Number\.isFinite\(run\.sharedStart\)\) this\.raceTogether\.ranLap\(e\.lap, e\.time, run\.lapTimes\.reduce\(/.test(takeEvents) &&
      /if \(Number\.isFinite\(run\.sharedStart\)\) this\.raceTogether\.ranFinish\(e\.time\);/.test(takeEvents) &&
      /run\.end\(why\);\s*\/\/[^\n]*\n\s*if \(Number\.isFinite\(run\.sharedStart\)\) this\.raceTogether\.ranOut\(why\);/.test(endRun),
    "a group run's laps, its finish and its end before the finish are said to the group",
  );
}

// --- 5. the run's clock through the real accumulator -------------------------------------------------------------

{
  type G = (x: number, z: number) => number;
  const FLAT: G = () => 0;
  const reader: RaceGround = { near: (x, z) => FLAT(x, z), far: (i, j) => FLAT(i * 16, j * 16), farStep: 16, farX: () => 0, farZ: () => 0, water: () => -Infinity };
  const BOUNDS = { min: [-3, 0, -6], max: [3, 2.5, 6] };
  const sprintAlong = (): TrackDef => {
    const q = fromGame({ x: 0, y: 0, z: 0, q: headingTurn(0) }, null, 'raw').q;
    const turn = [q[0], q[1], q[2], q[3]] as [number, number, number, number];
    return { id: 'line', name: 'TEST: line', kind: 'sprint', laps: 1, for: ['podracer'], clear: 0, grid: { x: 0, y: 2, z: 0, q: turn }, gates: [100, 350, 700, 1100].map((z) => ({ x: 0, y: 2, z, q: turn, w: 30, h: 40 })) };
  };
  interface Outcome {
    gateTimes: number[];
    truth: number[];
    total: number;
    /** The physics' steps taken before the frame go fired in, and that frame's; frames whose steps the run was told wrong. */
    goBefore: number;
    goN: number;
    stepsTold: number;
    /** The most the hull moved across the ground while the countdown held it (m). */
    countdownMoved: number;
    startEarned: boolean;
    /** Whether the drive was ever given the start boost, and the run's clock when it was. */
    boostOn: boolean;
    boostAt: number;
    /** The step the start boost ended on with W still down: the speed it began at and the one before, against the cap. */
    capEnd: { h: number; hPrev: number; cap: number } | null;
    pausedHeld: boolean;
    /** Whether gate 1 was found on the first live frame after the pause, in the segment that spans it. */
    pauseCrossFirst: boolean;
  }
  /**
   * A standing-start sprint ridden as the game rides it: each frame the drive's input made (W down as `w` says by the
   * run's clock), the run's own rules over it (`runInput`), the hull's step (the watch tests), the run's step (`runStep`:
   * the clock moved on by the steps about to be taken), the physics. A pause (`pauseAtGate1`) is opened at the frame
   * the body has just carried its middle past gate 1 and the watch has not looked yet, so the crossing falls in the
   * segment that spans the pause; play stood still is the game's: no drive input, the run's step told play is not
   * simulated, the physics stepping on.
   *
   * The truth is the physics' own steps, counted from the run's start and never read off the run's clock: step k is at
   * `k × FIXED_DT − countdown`, and a gate is crossed at the share of the step its plane falls in.
   */
  async function ride(fps: number, opts: { w?: (clock: number) => boolean; pauseAtGate1?: boolean } = {}): Promise<Outcome> {
    RACE_CLOCK.live = true;
    const physics = await Physics.create();
    const heights = new Float32Array(61 * 61);
    physics.createHeightfield(-1200, -400, 2400, 60, heights);
    const spec = specFor('podracer', 'pod', 'pod', BOUNDS);
    spec.hull = 'box';
    spec.raceBox = [7, 3, 15];
    const v = new Vehicle(spec, new THREE.Group(), physics, new THREE.Scene(), 0, 1.5, 0, 0);
    physics.stepOnce();
    const race = attachRace(v, 'pod', { ground: reader })!;
    race.setLevels('max', v);
    const t = sprintAlong();
    const g = trackInGame(t, null, 'raw');
    const midY = (BOUNDS.min[1] + BOUNDS.max[1]) / 2;
    const countdown = TRACK_TUNE.countdown;
    const run = new RaceRun(t, 'test', 'podracer', 'pod', g.grid, g.gates, midY, null);
    run.standing(v.pos.x, v.pos.y, v.pos.z);
    race.watch = run;
    const world = newRunWorld();
    Object.assign(world, { hull: true, mounted: true, racing: true });
    // The body's own steps, counted on simulated frames only: the physics' step wrapped.
    const steps: { k: number; z: number }[] = [{ k: 0, z: v.body.translation().z }];
    let counted = 0;
    let counting = true;
    let inFrame = 0;
    const ph = physics as unknown as { stepWorld: () => boolean };
    const inner = ph.stepWorld.bind(physics);
    ph.stepWorld = () => {
      const r = inner();
      inFrame++;
      if (counting) {
        counted++;
        steps.push({ k: counted, z: v.body.translation().z });
      }
      return r;
    };
    const input: DriveInput = { throttle: 0, steer: 0, heading: 0, boost: false, hop: false, up: false, down: false, vertical: 0 };
    const w = opts.w ?? (() => true);
    const dt = 1 / fps;
    const times: number[] = [];
    const out: Outcome = { gateTimes: times, truth: [], total: Number.NaN, goBefore: -1, goN: -1, stepsTold: 0, countdownMoved: 0, startEarned: false, boostOn: false, boostAt: Number.NaN, capEnd: null, pausedHeld: true, pauseCrossFirst: false };
    const x0 = v.body.translation().x;
    const z0 = v.body.translation().z;
    let paused = false;
    let firstAfterPause = false;
    let hPrev = Number.NaN;
    const take = () => {
      for (let k = 0; k < run.eventCount; k++) {
        const e = run.eventAt(k);
        if (e.kind === RUN_EVENT.gate) {
          times[e.gate] = e.time;
          if (e.gate === 1 && firstAfterPause) out.pauseCrossFirst = true;
        }
      }
      run.clearEvents();
    };
    for (let f = 0; f < fps * 60 && run.phase !== 'finished'; f++) {
      if (opts.pauseAtGate1 && !paused && run.seq === 1 && v.body.translation().z >= g.gates[1].z) {
        // A panel opened: play stands still for half a second of frames, as the game stands it still.
        paused = true;
        RACE_CLOCK.live = false;
        counting = false;
        const clockWas = run.clock;
        const zWas = v.body.translation().z;
        for (let k = 0; k < Math.round(fps / 2); k++) {
          v.update(dt, physics, null, FLAT);
          world.simulate = false;
          world.steps = physics.stepsAhead(dt);
          runStep(run, world);
          physics.step(dt);
        }
        out.pausedHeld = run.clock === clockWas && Math.abs(v.body.translation().z - zWas) < 1e-6;
        RACE_CLOCK.live = true;
        counting = true;
        firstAfterPause = true;
      }
      input.throttle = w(run.clock) ? 1 : 0;
      input.steer = 0;
      input.heading = 0;
      input.boost = false;
      runInput(run, input, race);
      const masked = run.phase === 'countdown';
      const h = race.h;
      const boostWas = race.startBoost;
      if (boostWas > 1 && !out.boostOn) {
        out.boostOn = true;
        out.boostAt = run.clock;
      }
      v.update(dt, physics, input, FLAT);
      take();
      firstAfterPause = false;
      // The start boost ending with W still down: the speed the step began at against the cap, and the one before.
      if (boostWas > 1 && race.startBoost === 1 && !out.capEnd && input.throttle > 0) out.capEnd = { h, hPrev, cap: TRACK_TUNE.startCap * race.plainTop() };
      hPrev = h;
      const phaseWas = run.phase;
      const before = counted;
      world.simulate = true;
      world.steps = physics.stepsAhead(dt);
      runStep(run, world);
      if (phaseWas === 'countdown' && run.phase !== 'countdown') {
        out.goBefore = before;
        out.goN = world.steps;
      }
      inFrame = 0;
      physics.step(dt);
      if (inFrame !== world.steps) out.stepsTold++;
      if (masked) {
        const p = v.body.translation();
        out.countdownMoved = Math.max(out.countdownMoved, Math.hypot(p.x - x0, p.z - z0));
      }
    }
    // One more look, for a crossing on the very last steps.
    v.update(dt, physics, input, FLAT);
    take();
    out.truth = g.gates.map((gate) => {
      for (let i = 1; i < steps.length; i++) {
        const a = steps[i - 1];
        const b = steps[i];
        if (a.z < gate.z && b.z >= gate.z) return (a.k + (gate.z - a.z) / (b.z - a.z)) * FIXED_DT - countdown;
      }
      return Number.NaN;
    });
    out.total = run.total;
    out.startEarned = run.startEarned;
    RACE_CLOCK.live = true;
    return out;
  }
  const totals: number[] = [];
  const goStep = Math.round(TRACK_TUNE.countdown / FIXED_DT);
  for (const fps of [144, 120, 60, 20]) {
    // W held from the first frame: the countdown holds the hull, and a W down from before the window earns nothing.
    const o = await ride(fps);
    const worst = Math.max(...o.truth.map((tr, i) => Math.abs(tr - o.gateTimes[i])));
    ok(o.stepsTold === 0 && o.goBefore < goStep && goStep <= o.goBefore + o.goN, `${fps} fps: go fires in the frame whose fixed steps reach the countdown's ${goStep}th (after ${o.goBefore}, with ${o.goN} more), the run told every frame's steps`);
    ok(o.gateTimes.length === 4 && Number.isFinite(worst) && worst < 1e-3, `${fps} fps: every gate timed within a millisecond of the instant the physics' own steps, counted from the start, carry its middle through it (worst ${(worst * 1000).toFixed(4)} ms)`);
    ok(o.countdownMoved < 1e-6 && !o.startEarned && !o.boostOn, `${fps} fps: W held through the countdown moves the hull not at all (${o.countdownMoved.toExponential(1)} m) and earns no start boost`);
    totals.push(o.total);
  }
  // The run's clock is held to the body's own steps above, at every rate, to a millisecond; what differs between the
  // rates is where the body is, which is the drive's. Its speed is worked out once a frame and held over every fixed step
  // the frame takes, at the speed the frame ends at, so while it gathers speed a frame of three steps (20 fps) runs about
  // half a frame ahead of a frame of one: measured, 16 ms over the sprint at 20 fps and 3 ms at 144. The design asked a
  // hundredth across all four rates; the three that take a step or less a frame meet it, and 20 fps is held to the half
  // frame the drive's own stepping explains. Mending it is the drive's (its speed worked out a fixed step at a time) and
  // would move the held traces of the drive's earlier waves.
  const spread = Math.max(totals[0], totals[1], totals[2]) - Math.min(totals[0], totals[1], totals[2]);
  ok(spread < 0.01, `a standing-start sprint of 1.1 km takes the same to a hundredth of a second at 144, 120 and 60 fps (${totals.slice(0, 3).map((t) => t.toFixed(3)).join(', ')} s)`);
  ok(Math.abs(totals[3] - totals[2]) < 0.5 / 20, `and at 20 fps within the half frame the drive's speed held over a frame's three steps leads by (${totals[3].toFixed(3)} s against ${totals[2].toFixed(3)} s)`);
  const plain = await ride(60);
  const paused = await ride(60, { pauseAtGate1: true });
  ok(paused.pausedHeld, "while play stands still the run's clock does not move and the hull holds where it is");
  const pausedWorst = Math.max(...paused.truth.map((tr, i) => Math.abs(tr - paused.gateTimes[i])));
  ok(paused.pauseCrossFirst && pausedWorst < 1e-3 && Math.abs(paused.gateTimes[1] - plain.gateTimes[1]) < 1e-3 && Math.abs(paused.total - plain.total) < 1e-3, `a gate whose crossing falls in the segment that spans a pause is found on the first step after it and timed as though there had been none (${(Math.abs(paused.gateTimes[1] - plain.gateTimes[1]) * 1000).toFixed(4)} ms off the run with no pause, ${(pausedWorst * 1000).toFixed(4)} ms off the steps)`);
  // The start's window: W pressed within it earns the boost; held from before it, or first pressed after it, nothing.
  const startWin = TRACK_TUNE.startWindow;
  const boosted = await ride(60, { w: (c) => c >= -0.1 });
  ok(boosted.startEarned && boosted.boostOn && boosted.boostAt >= 0 && boosted.gateTimes[0] < plain.gateTimes[0] - 0.05, `W pressed a tenth before go earns the start boost, put on the drive only once the clock has reached go (at ${boosted.boostAt.toFixed(3)} s), and the first gate comes sooner (${plain.gateTimes[0].toFixed(3)} s against ${boosted.gateTimes[0].toFixed(3)} s)`);
  const capEnd = boosted.capEnd;
  ok(!!capEnd && capEnd.h >= capEnd.cap && capEnd.hPrev < capEnd.cap, `with W still down the boost ends on the step the speed passes ${TRACK_TUNE.startCap} of the plain top (${capEnd ? `${capEnd.hPrev.toFixed(1)} then ${capEnd.h.toFixed(1)} m/s against ${capEnd.cap.toFixed(1)}` : 'it never ended'})`);
  const late = await ride(60, { w: (c) => c >= startWin + 0.05 });
  ok(!late.startEarned && !late.boostOn, `W first pressed after the window (${startWin} s past go) earns nothing`);
  const early = await ride(60, { w: (c) => c >= -startWin - 0.2 });
  ok(!early.startEarned && !early.boostOn, `and W pressed before the window opens and held through it earns nothing`);
  const main = src('../../../src/main.ts');
  ok(/if \(this\.raceRun\?\.live && pilot === this\.runVehicle\) runInput\(this\.raceRun, drive, pilot\.race\);/.test(main) && !/private runInput\(/.test(main), "the game's drive input goes through these very rules (`runInput`), and through nothing of its own");
  ok(RUN_STEP === FIXED_DT, "and the run's step is the physics' own fixed step");
  const drive = src('../../../src/vehicles/raceDrive.ts');
  const watchAt = drive.indexOf('if (this.watch) this.watch.cross(v);');
  ok(watchAt > drive.indexOf('this.lvNow.z = lv.z;') && watchAt < drive.indexOf('const parts = RaceDrive.PARTS;') && drive.indexOf('if (!RACE_CLOCK.live) {') < watchAt, "the drive hands its hull to the run's watch as each live step begins, before any part of it moves the hull, and never while paused");
  ok(RACE_TUNE.on, 'the race pass is on (the run rides on it)');

  // A hull stood somewhere on purpose at speed (a run's grid, a put-back: `RaceDrive.standAt`), the real Vehicle and race
  // drive: nothing of the move is read as a hit or carried on the odometer, and it stands still, facing where it was turned.
  {
    RACE_CLOCK.live = true;
    const physics = await Physics.create();
    const heights = new Float32Array(61 * 61);
    physics.createHeightfield(-1200, -400, 2400, 60, heights);
    const spec = specFor('podracer', 'pod', 'pod', BOUNDS);
    spec.hull = 'box';
    spec.raceBox = [7, 3, 15];
    const v = new Vehicle(spec, new THREE.Group(), physics, new THREE.Scene(), 0, 1.5, 0, 0);
    physics.stepOnce();
    const race = attachRace(v, 'pod', { ground: reader })!;
    race.setLevels('max', v);
    const go: DriveInput = { throttle: 1, steer: 0, heading: 0, boost: false, hop: false, up: false, down: false, vertical: 0 };
    for (let f = 0; f < 60 * 4; f++) {
      v.update(1 / 60, physics, go, FLAT);
      physics.step(1 / 60);
    }
    const fast = race.h;
    const hp0 = v.hp;
    const hitAt = race.lastHit.at;
    const odoBefore = race.odo;
    race.standAt(v, v.pos.x + 40, 1.5, v.pos.z + 6, 1.2);
    const marks = { odo: race.odo, swept: race.sweptTo };
    const r0 = v.body.rotation();
    const stoodFacing = turnHeading([r0.x, r0.y, r0.z, r0.w]);
    const still: DriveInput = { throttle: 0, steer: 0, heading: null, boost: false, hop: false, up: false, down: false, vertical: 0 };
    let odoMost = 0;
    for (let f = 0; f < 60; f++) {
      v.update(1 / 60, physics, still, FLAT);
      physics.step(1 / 60);
      odoMost = Math.max(odoMost, race.odo);
    }
    const r = v.body.rotation();
    const lv = v.body.linvel();
    ok(fast > 80 && v.hp === hp0 && !v.destroyed && race.lastHit.at === hitAt, `stood elsewhere from ${fast.toFixed(1)} m/s, the hull takes no hit for the move (health ${v.hp} of ${hp0}, wrecked: ${v.destroyed})`);
    ok(Math.abs(race.h) < 0.5 && Math.hypot(lv.x, lv.z) < 0.5, `and stands still there a second on (${race.h.toFixed(3)} m/s on the drive, ${Math.hypot(lv.x, lv.z).toFixed(3)} on the body)`);
    ok(close(stoodFacing, 1.2, 1e-6) && race.heading === 1.2 && close(turnHeading([r.x, r.y, r.z, r.w]), 1.2, 1e-3), `facing the heading it was stood at, the moment it is stood and a second on (${stoodFacing.toFixed(4)}, then ${turnHeading([r.x, r.y, r.z, r.w]).toFixed(4)} rad)`);
    ok(odoBefore > 100 && marks.odo === 0 && marks.swept === 0 && odoMost < 1, `with every sweep's mark begun afresh: the odometer from ${odoBefore.toFixed(0)} m to nought, and ${odoMost.toFixed(2)} m on it a second later`);
  }
}

// --- 6. bests and the character mark -----------------------------------------------------------------------------

{
  const key = raceBestKey('tatooine', 'test_dune_loop');
  let book: RaceBestBook | undefined;
  const a = mergeBest(book, key, 'podracer', { lap: 70.2, at: 1, levels: { top: 5 }, splits: [70.2, 20, 40] });
  ok(a.lap && !a.total && bestOf(a.book, key, 'podracer')?.lap === 70.2, 'a first lap is a best');
  const b = mergeBest(a.book, key, 'podracer', { lap: 72, at: 2, levels: {} });
  ok(!b.lap && b.book === a.book, 'a slower lap is not, and the book is left as it was');
  const c = mergeBest(a.book, key, 'podracer', { lap: 69, at: 3, levels: { top: 3 }, splits: [69, 19, 39] });
  ok(c.lap && bestOf(c.book, key, 'podracer')?.lap === 69 && bestOf(c.book, key, 'podracer')?.levels.top === 3 && bestOf(c.book, key, 'podracer')?.splits?.[1] === 19, 'a faster one is, with its own splits and the levels it was set at');
  const d = mergeBest(c.book, key, 'speederbike', { lap: 90, total: 280, at: 4, levels: {} });
  ok(d.lap && d.total && bestOf(d.book, key, 'speederbike')?.lap === 90 && bestOf(d.book, key, 'podracer')?.lap === 69, 'kept under the kind raced as: a bike\'s best beside a pod\'s, neither touching the other');
  const e = mergeBest(d.book, key, 'podracer', { total: 215, at: 5, levels: {} });
  ok(e.total && !e.lap && bestOf(e.book, key, 'podracer')?.total === 215 && bestOf(e.book, key, 'podracer')?.lap === 69, 'a total falls on its own, the best lap kept');
  const f = mergeBest(e.book, key, 'podracer', { total: 230, lap: 75, at: 6, levels: {} });
  ok(!f.total && !f.lap, 'a best only ever falls');
  ok(bestOf({ constructor: { podracer: { lap: 1, at: 0, levels: {} } } } as never, 'prototype', 'podracer') === null && bestOf({}, 'constructor', 'podracer') === null, "a book is read by its own keys alone, never the language's");
  ok(raceTime(69.94) === '1:09.9' && raceTime(5.05) === '5.0' && raceDelta(-0.84) === '-0.8' && raceDelta(1.26) === '+1.3', 'times at tenths, and differences signed');
  // The mark: unchanged for a record with no bests, moved by one.
  const rec = { name: 'Kel', outfit: ['shirt'], items: [{ kind: 'wear', id: 'shirt' }] };
  const plain = characterMark(rec);
  ok(characterMark({ ...rec, raceBest: undefined }) === plain && characterMark({ ...rec, raceBest: {} }) === plain, 'a record with no best times keeps the mark it had before there were tracks');
  ok(characterMark({ ...rec, raceBest: d.book }) !== plain, 'and a best is a change worth settling');
  const session = src('../../../src/net/session.ts');
  ok(/if \(c\.raceBest && Object\.keys\(c\.raceBest\)\.length\) parts\.push\(`r:\$\{stableJson\(c\.raceBest\)\}`\);/.test(session) && !/parts\.push\(`r:/.test(session.slice(0, session.indexOf('const tinted'))), 'the mark takes the bests under r:, a letter nothing else uses');
}

// --- 7. the editor's edits keep the file valid --------------------------------------------------------------------

{
  const t = squareTrack();
  const here = { x: 50, y: 3, z: 50, q: fromGame({ x: 0, y: 0, z: 0, q: headingTurn(1) }, null, 'raw').q as [number, number, number, number] };
  const edits: [string, TrackDef | string][] = [
    ['here', moveGateTo(t, 1, here)],
    ['insert after', insertGate(t, 1, here, { w: 20, h: 30 })],
    ['insert before the first', insertGate(t, -1, here, { w: 20, h: 30 })],
    ['nudge', nudgeGate(t, 2, { x: 1, y: 1, z: -1, yaw: 5 }, 'raw')],
    ['resize', resizeGate(t, 3, { w: 500, h: 1 })],
    ['delete', deleteGate(t, 0)],
  ];
  for (const [what, e] of edits) {
    assert.ok(typeof e !== 'string', `${what}: ${e}`);
    const read = readTrackFile(trackFileText('tatooine', 'raw', [e]), 'tatooine', 'ground');
    ok(read.problem === null && read.skipped.length === 0 && read.tracks.length === 1, `the editor's ${what} leaves a track the file reads`);
  }
  const resized = resizeGate(t, 3, { w: 500, h: 1 }) as TrackDef;
  ok(resized.gates[3].w === TRACK_LIMITS.widthMost && resized.gates[3].h === TRACK_LIMITS.heightLeast, "a size past the reader's limits is held to them");
  ok(typeof deleteGate(deleteGate(deleteGate(t, 0) as TrackDef, 0) as TrackDef, 0) === 'string', `a track keeps ${TRACK_LIMITS.gatesLeast} gates`);
  ok(typeof moveGateTo(t, 9, here) === 'string', 'an edit of a gate that is not there is refused in words');
  // A nudge is the driver's: to the right, up, ahead and turned left, the same whichever frame the file is in.
  const game = squareTrack();
  game.gates = game.gates.map((gate) => {
    const p = toGame(gate, null, 'raw');
    return { x: p.x, y: p.y, z: p.z, q: [p.q[3], p.q[0], p.q[1], p.q[2]] as [number, number, number, number], w: gate.w, h: gate.h };
  });
  const rawNudged = nudgeGate(t, 1, { x: 1, z: 2, yaw: 10 }, 'raw') as TrackDef;
  const gameNudged = nudgeGate(game, 1, { x: 1, z: 2, yaw: 10 }, 'game') as TrackDef;
  const rawInGame = toGame(rawNudged.gates[1], null, 'raw');
  const gameInGame = toGame(gameNudged.gates[1], null, 'game');
  ok(close(rawInGame.x, gameInGame.x, 0.011) && close(rawInGame.z, gameInGame.z, 0.011) && close(turnHeading(rawInGame.q), turnHeading(gameInGame.q), 1e-4), 'a nudge moves a gate the same way in a file of either frame');
  const before = toGame(t.gates[1], null, 'raw');
  ok(close(rawInGame.x, before.x - 1, 0.011) && close(rawInGame.z, before.z + 2, 0.011) && close(turnHeading(rawInGame.q) - turnHeading(before.q), (10 * Math.PI) / 180, 1e-4), "a gate facing +z nudged one to the right moves to -x (the driver's right), two ahead along +z, and its heading grows by the turn");
  // A track being laid has no gates, and every gate dropped is kept as it is laid; the file's own rule waits for a save.
  const laid: TrackDef = { ...t, gates: [] };
  const one = insertGate(laid, -1, here, { w: 24, h: 40 });
  ok(typeof one !== 'string' && one.gates.length === 1, 'the first gate of a track being laid is kept, though a file wants two');
  ok(typeof readTrack(one) === 'string', 'and the file\'s own reader still refuses a track of one gate');
  const sync = trackSync([t], [{ ...t, gates: [t.gates[0], t.gates[1]] }, { ...t, id: 'other' }]);
  ok(sync.changed.join() === 'square' && sync.added.join() === 'other' && !sync.removed.length && trackSync([t], []).removed.join() === 'square', 'a file read again says which tracks it added, changed and took out');
}

// --- 8. the corridor ----------------------------------------------------------------------------------------------

{
  const t = squareTrack();
  const legs = courseLegs(t, t.grid, t.gates);
  ok(legs.length === 5 && legs[0].half === Math.max(t.clear, 12), "a circuit's legs: grid to gate 0, gate to gate, and the last gate back to 0, each its clear or half its gate wide");
  const hits = corridorHits(legs, [
    { x: 0, z: 50, r: 0.5, what: 'on the line' },
    { x: 13, z: 50, r: 2, what: 'just touching' },
    { x: 20, z: 50, r: 2, what: 'clear of it' },
    { x: 50, z: 50, r: 30, what: 'a wide thing in the middle' },
  ]);
  ok(hits.map((h) => h.thing.what).join('|') === 'on the line|just touching', `what stands within a leg's half-width (with its own size) is in the corridor, and nothing else (${hits.map((h) => h.thing.what).join(', ')})`);
  const circles = corridorCircles(t, t.grid, t.gates);
  const worstGap = (() => {
    let worst = Infinity;
    for (const l of legs) {
      for (let k = 0; k <= 200; k++) {
        const x = l.ax + ((l.bx - l.ax) * k) / 200;
        const z = l.az + ((l.bz - l.az) * k) / 200;
        // The perpendicular either side, at `clear`.
        const len = Math.hypot(l.bx - l.ax, l.bz - l.az);
        const px = -(l.bz - l.az) / len;
        const pz = (l.bx - l.ax) / len;
        for (const side of [-1, 1]) {
          const qx = x + px * t.clear * side;
          const qz = z + pz * t.clear * side;
          const inside = circles.some((c) => Math.hypot(c.x - qx, c.z - qz) <= c.r + 1e-9);
          if (!inside) worst = Math.min(worst, -1);
        }
      }
    }
    return worst;
  })();
  ok(worstGap > 0, `the corridor's circles (${circles.length}) keep the plants off ${t.clear} m either side of every leg`);
  ok(corridorCircles({ ...t, clear: 0 }, t.grid, t.gates).length === 0, 'and a track that asks for no clearing keeps none');
  ok(close(lapLength(t, t.gates), 400, 1e-9), 'a lap of the square is 400 m');
}

// --- 9. the committed TEST course ---------------------------------------------------------------------------------

{
  const file = new URL('../../../public/tracks/tatooine.json', import.meta.url);
  ok(existsSync(file), 'the TEST course ships: public/tracks/tatooine.json is there');
  const text = readFileSync(file, 'utf8');
  const read = readTrackFile(text, 'tatooine', 'ground');
  ok(read.problem === null && read.skipped.length === 0 && read.unknown.length === 0, 'it reads, every track and field');
  const t = read.tracks.find((x) => x.id === 'test_dune_loop');
  ok(!!t && t.name.startsWith('TEST:') && t.kind === 'circuit' && t.laps === 3 && t.for.includes('podracer') && t.for.includes('speederbike') && !!t.note && /test course/i.test(t.note), 'TEST: Dune Loop, a circuit of three laps for both kinds, its note saying it is a test course');
  ok(!!t && t.gates.length >= TRACK_LIMITS.gatesLeast && t.gates.length <= TRACK_LIMITS.gates && t.clear <= TRACK_LIMITS.clearMost && t.gates.every((g) => g.w >= TRACK_LIMITS.widthLeast && g.w <= TRACK_LIMITS.widthMost && g.h >= TRACK_LIMITS.heightLeast && g.h <= TRACK_LIMITS.heightMost), 'and inside every limit');
  ok(trackFileText('tatooine', 'raw', read.tracks) === text.replace(/\r\n/g, '\n'), 'written as the editor writes a file, line for line');
  const km = t ? lapLength(t, t.gates) / 1000 : 0;
  ok(km > 5 && km < 9, `about seven kilometres a lap (${km.toFixed(2)} km)`);
  const PACKS = process.env.SWG3JS_PACKS ?? join(import.meta.dirname, '../../../assets-private');
  const dir = join(PACKS, 'tatooine');
  if (!t || !existsSync(join(dir, 'layout.json')) || !existsSync(join(dir, 'terrain.trn'))) note('the corridor and ground checks need the converted Tatooine pack: passed over');
  else {
    const { packGround, plantingsNear, placedThings, spawnThings, groundAt } = await import('./courseThings.ts');
    const g = packGround(dir);
    assert.ok(g);
    // Gentle: no 32 m stretch of the gate-to-gate lines steeper than the real-ground test's 0.08.
    let worst = 0;
    const legs = courseLegs(t, t.grid, t.gates);
    for (const l of legs) {
      const len = Math.hypot(l.bx - l.ax, l.bz - l.az);
      const n = Math.max(1, Math.ceil(len / 32));
      let last = groundAt(g, l.ax, l.az);
      for (let k = 1; k <= n; k++) {
        const h = groundAt(g, l.ax + ((l.bx - l.ax) * k) / n, l.az + ((l.bz - l.az) * k) / n);
        worst = Math.max(worst, Math.abs(h - last) / (len / n));
        last = h;
      }
    }
    ok(worst <= 0.08, `every stretch of it is gentle (its steepest 32 m: ${worst.toFixed(3)}, at most 0.08)`);
    const things = [...placedThings(dir), ...spawnThings(dir, PACKS), ...plantingsNear(g, legs, 30)];
    const hits = corridorHits(legs, things);
    ok(hits.length === 0, `and its corridor check finds nothing in the way: no placed thing, trunk, post, lair or camp (${things.length} things near it read${hits.length ? `; ${hits.slice(0, 3).map((h) => h.thing.what).join(', ')}` : ''})`);
    // Every gate can be passed through: a hull riding at its height over the ground there carries its middle inside the
    // window, a metre clear of either edge, for every kind the track is raced as. `y` is absolute, so a gate laid under the
    // ground or high over it would read and could never be lapped.
    const out: string[] = [];
    for (const kind of t.for) {
      const base = RACE_BASE[kind];
      t.gates.forEach((gate, i) => {
        const mid = groundAt(g, gate.x, gate.z) + base.ride + base.box[1] / 2;
        const lo = gate.y - gate.h * GATE_BELOW;
        const hi = gate.y + gate.h * (1 - GATE_BELOW);
        if (!(mid >= lo + 1 && mid <= hi - 1)) out.push(`gate ${i} as a ${kind}: middle ${mid.toFixed(2)} m, window ${lo.toFixed(1)} to ${hi.toFixed(1)}`);
      });
    }
    ok(out.length === 0, `and a ${t.for.join(' or ')} riding over the ground carries its middle through every one of its ${t.gates.length} gates' windows${out.length ? ` (${out.slice(0, 3).join('; ')})` : ''}`);
  }
}

// --- 10. the keys and the tune ------------------------------------------------------------------------------------

{
  const { DEFAULT_BINDINGS, DEV_ONLY_ACTIONS, controlsActions } = await import('../../../src/core/input.ts');
  ok(DEFAULT_BINDINGS.trackGate.join() === 'Numpad0' && DEV_ONLY_ACTIONS.has('trackGate') && !controlsActions(false).includes('trackGate'), "the editor's gate key is Numpad0, the dev server's alone, off a release's Controls page");
  const others = Object.entries(DEFAULT_BINDINGS).filter(([a, keys]) => a !== 'trackGate' && keys.includes('Numpad0'));
  ok(others.length === 0, 'and no other default is on it');
  const main = src('../../../src/main.ts');
  ok(/if \(import\.meta\.env\.DEV && this\.trackHeld && input\.pressedAction\('trackGate'\)\)/.test(main) && main.indexOf("input.pressedAction('trackGate')") > main.indexOf('private stepVehicles('), 'read only on the dev server, with a track in hand, inside stepVehicles');
  const words = tuneTrack({ countdown: 99, nope: 1, putBack: 'x' } as never);
  ok(TRACK_TUNE.countdown === 10 && words.length === 3, `the tune holds a number to its range and names what it refused (${words.join('; ')})`);
  tuneTrack({ countdown: 3 });
  ok(/warm\?: \{ at: readonly \{ x: number; z: number \}\[\]; waitMs: number \}/.test(main) && /await this\.settle\(30000, \{ at: curtain\.warmAt, waitMs: TRACK_TUNE\.warmWaitMs \}\);/.test(main), "a run's curtain warms the models along its gates and compiles them behind the loading screen");
}

console.log(`\nraceTrack: ${checks} checks passed`);
