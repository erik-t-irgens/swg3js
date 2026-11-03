// A track's drawn course in the track file (src/race/trackFile.ts, the race drawer's DESIGN.md §2.2):
//
// - **day one**: every track file under `public/tracks/` (the owner's as it stands, whatever it holds) and a fixture of
//   hand-shaped tracks read, hash, digest, sync, write (byte for byte) and give their corridor's legs, circles and lap exactly
//   as the race drawer's start (afcf394)'s `trackFile.ts`, `trackPath.ts` and `raceGroup.ts` loaded out of git do: deep equal
//   reads, string-equal hashes and digests, equal texts. Where git cannot hand the old files over, the fixture's trace is held
//   to a hash recorded from them;
// - a course read, refused whole for any bad node, number or anchor and in a space zone, written one node a line, read back
//   equal; the hash and the digest move with a node and not with a renamed track; anchors kept; a field this build does not
//   read refuses nothing; the head line of a track with a course is the head line of the same track without one.
//
// Run: node tools/swg/tests/courseFile.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COURSE_IN_SPACE, corridorCircles, courseLegs, lapLength, readTrack, readTrackFile, trackFileText, trackHash, trackSync, type TrackDef, type TrackRead } from '../../../src/race/trackFile.ts';
import { trackDigest } from '../../../src/race/raceGroup.ts';
import { courseCtx, drawTrack, moveNode, setTrack } from '../../../src/editor/courseEdit.ts';
import { loadOldMany, REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);

const PRE = 'afcf394';
const turn = (h: number): [number, number, number, number] => [Math.cos(h / 2), 0, -Math.sin(h / 2), 0];

/** A fixture of hand-shaped tracks: a gate-only circuit with a note, a time and a field this build does not read; a sprint. */
const FIXTURE = `{
  "version": 1,
  "world": "naboo",
  "frame": "raw",
  "tracks": [
    {
      "id": "alpha", "name": "Alpha", "note": "a note", "kind": "circuit", "laps": 2, "for": ["podracer"], "clear": 6, "at": 1700000000000, "need": [1, 2],
      "grid": { "x": 10.5, "y": 2, "z": -3, "q": ${JSON.stringify(turn(0.3))} },
      "gates": [
        { "x": 20, "y": 3, "z": 0, "q": ${JSON.stringify(turn(0.4))}, "w": 24, "h": 40 },
        { "x": 220, "y": 4.5, "z": 90, "q": ${JSON.stringify(turn(1.4))}, "w": 30, "h": 30 },
        { "x": 60, "y": 2, "z": 300.25, "q": ${JSON.stringify(turn(2.8))}, "w": 14, "h": 25 }
      ]
    },
    {
      "id": "beta", "name": "Beta", "kind": "sprint", "for": ["speederbike", "podracer"], "clear": 0,
      "grid": { "x": -100, "y": 0, "z": -100, "q": [1, 0, 0, 0] },
      "gates": [
        { "x": -90, "y": 1, "z": -90, "q": [1, 0, 0, 0], "w": 10, "h": 20, "hint": "left" },
        { "x": 400, "y": 1, "z": 300, "q": [0.9238795325112867, 0, -0.3826834323650898, 0], "w": 12, "h": 20 }
      ]
    }
  ]
}
`;

type TF = typeof import('../../../src/race/trackFile.ts');
type RG = typeof import('../../../src/race/raceGroup.ts');

/** Everything a track file is read and written into, as one trace (the reads, hashes, digests, legs, circles, laps, the text). */
function trace(read: TrackRead, f: { trackHash: TF['trackHash']; trackFileText: TF['trackFileText']; courseLegs: TF['courseLegs']; corridorCircles: TF['corridorCircles']; lapLength: TF['lapLength'] }, digest: RG['trackDigest'], world: string): string {
  const out: unknown[] = [read];
  for (const t of read.tracks) out.push(f.trackHash(t), digest(t), f.courseLegs(t, t.grid, t.gates), f.corridorCircles(t, t.grid, t.gates), f.lapLength(t, t.gates));
  out.push(f.trackFileText(world, 'raw', read.tracks));
  return JSON.stringify(out);
}

// ---- Day one: against the race drawer's start out of git. ----
{
  const old = await loadOldMany(['src/race/trackFile.ts', 'src/race/trackPath.ts', 'src/race/raceGroup.ts'], ['src/race/trackFile.ts', 'src/race/raceGroup.ts'], PRE);
  const NEW: Parameters<typeof trace>[1] = { trackHash, trackFileText, courseLegs, corridorCircles, lapLength };
  const fixtureNew = trace(readTrackFile(FIXTURE, 'naboo', 'ground'), NEW, trackDigest, 'naboo');
  // The fixture's trace as afcf394's own modules make it, recorded once from them.
  const FIXTURE_TRACE = '67307415a2f1737a';
  if (old) {
    const [tf, rg] = old as unknown as [TF, RG];
    const OLD: Parameters<typeof trace>[1] = { trackHash: tf.trackHash, trackFileText: tf.trackFileText, courseLegs: tf.courseLegs, corridorCircles: tf.corridorCircles, lapLength: tf.lapLength };
    const fixtureOld = trace(tf.readTrackFile(FIXTURE, 'naboo', 'ground'), OLD, rg.trackDigest, 'naboo');
    ok(fixtureNew === fixtureOld, `the fixture reads, hashes, digests, gives its legs, circles and laps and writes exactly as ${PRE}'s modules (${fixtureNew.length} characters of trace)`);
    console.log(`note the fixture's trace hashes to ${sha(fixtureOld)}`);
    ok(sha(fixtureOld) === FIXTURE_TRACE, `${PRE}'s trace of the fixture is the one recorded (${sha(fixtureOld)})`);
    const dir = join(REPO, 'public', 'tracks');
    let files = 0;
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      const world = f.slice(0, -5);
      const text = readFileSync(join(dir, f), 'utf8');
      const rNew = readTrackFile(text, world, 'ground');
      const rOld = tf.readTrackFile(text, world, 'ground');
      assert.deepStrictEqual(rNew, rOld, `${f} reads as ${PRE}'s reader reads it`);
      ok(trace(rNew, NEW, trackDigest, world) === trace(rOld, OLD, rg.trackDigest, world), `public/tracks/${f}: ${rNew.tracks.length} tracks (${rNew.tracks.map((t) => t.id).join(', ')}) read, hash, digest, legs, circles, laps and text exactly as ${PRE}'s`);
      ok(JSON.stringify(trackSync(rNew.tracks, rNew.tracks)) === JSON.stringify(tf.trackSync(rOld.tracks, rOld.tracks)) && JSON.stringify(trackSync([], rNew.tracks)) === JSON.stringify(tf.trackSync([], rOld.tracks)), `public/tracks/${f} syncs as ${PRE}'s`);
      files++;
    }
    ok(files >= 1, `every track file under public/tracks/ held (${files})`);
  } else {
    ok(sha(fixtureNew) === FIXTURE_TRACE, `git cannot hand ${PRE}'s modules over: the fixture's trace is held to the hash recorded from them (${sha(fixtureNew)})`);
  }
}

// ---- A course read, written, read back. ----
const ctx = courseCtx(() => 0);
const flat = (x: number, z: number) => ({ x, z, y: 1.234 });
const drawn = drawTrack('eight', 'Eight', [flat(0, 0), flat(300.123, 10), flat(500, 200), flat(250, 400.006), flat(-50, 220)], true, ctx);
assert.ok(typeof drawn !== 'string', String(drawn));
const t = drawn as TrackDef;
{
  const text = trackFileText('naboo', 'raw', [t]);
  const lines = text.split(/\r?\n/);
  const nodeLines = lines.filter((l) => /^\s+\{ "x": .*"c": "(smooth|straight)"/.test(l));
  ok(nodeLines.length === t.course!.paths[0].nodes.length, `the course is written one node a line (${nodeLines.length} lines)`);
  ok(lines.some((l) => /^\s+"course": \{ "v": 1, "feather": "easeInOut", "crossing": "wall", "margin": 2, "level": 1, "grass": "clear", "wallOut": 0\.5, "wallHigh": 8,$/.test(l)), "the course's own numbers on one line after the gates");
  const back = readTrackFile(text, 'naboo', 'ground');
  ok(!back.problem && !back.skipped.length && back.tracks.length === 1, 'the written course reads back with nothing refused');
  assert.deepStrictEqual(back.tracks[0], t);
  ok(true, 'the course read back is the track written, field for field');
  ok(trackFileText('naboo', 'raw', back.tracks) === text, 'and writes again to the very same text');
  const hundredth = (n: number) => Math.round(n * 100) / 100 === n;
  ok(t.course!.paths.every((p) => p.nodes.every((n) => [n.x, n.y, n.z, n.w, n.b, n.sh].every(hundredth))), 'every number of a drawn course is a hundredth');
  ok(t.gates.every((g) => g.path === 'main' && typeof g.e === 'number' && typeof g.t === 'number') && t.grid.path === 'main', 'the placed gates and the grid carry their anchors, and read back with them');
  // A drawn road keeps the plants off by its own mask (the second wave's), never by circles along the gate-to-gate line.
  ok(corridorCircles(t, t.grid, t.gates).length === 0 && corridorCircles({ ...t, course: undefined }, t.grid, t.gates).length > 0, 'a track with a course lays no corridor circles, the same track without one does');
  // Two nodes nearer than the edge's least merged as the course is written (the later of the pair goes).
  const close = drawTrack('close', 'Close', [flat(0, 0), flat(300, 10), flat(301.2, 10.5), flat(500, 200), flat(250, 400)], true, ctx) as TrackDef;
  ok(typeof close !== 'string' && close.course!.paths[0].nodes.length === 4, `two nodes 1.3 m apart are one as the course is written (${typeof close === 'string' ? close : close.course!.paths[0].nodes.length} nodes)`);
}

// ---- The hash and the digest. ----
{
  const plain: TrackDef = JSON.parse(JSON.stringify(t));
  delete plain.course;
  for (const g of plain.gates) {
    delete g.path;
    delete g.e;
    delete g.t;
  }
  ok(trackHash(t) !== trackHash(readTrack(JSON.parse(JSON.stringify(plain))) as TrackDef), 'a track with a course hashes otherwise than the same track without one');
  const moved = moveNode(t, 'main', 2, 510, 205, ctx) as TrackDef;
  ok(trackHash(moved) !== trackHash(t) && trackDigest(moved) !== trackDigest(t), 'a node moved changes the track\'s hash and its digest');
  const renamed = setTrack(t, { name: 'Another name' }) as TrackDef;
  ok(trackHash(renamed) === trackHash(t) && trackDigest(renamed) === trackDigest(t), 'a track renamed keeps its hash and its digest');
  ok(trackSync([t], [moved]).changed.includes('eight'), 'trackSync calls a moved node a changed track');
}

// ---- The head line of a track with a course is the head line without one. ----
{
  const plain = { ...t } as TrackDef;
  delete plain.course;
  const withLine = trackFileText('naboo', 'raw', [t]).split(/\r?\n/)[6];
  const without = trackFileText('naboo', 'raw', [plain]).split(/\r?\n/)[6];
  ok(withLine === without && withLine.includes('"id": "eight"'), 'the head line of a track with a course is the head line of the same track without one');
}

// ---- Refused whole. ----
{
  const bad = (what: string, mutate: (o: Record<string, unknown>) => void, kind: 'ground' | 'space' = 'ground') => {
    const o = JSON.parse(JSON.stringify(t)) as Record<string, unknown>;
    mutate(o);
    const r = readTrack(o, [], 2, kind);
    ok(typeof r === 'string', `refused: ${what} (${typeof r === 'string' ? r : 'read'})`);
  };
  const course = (o: Record<string, unknown>) => o.course as { paths: { id: string; nodes: Record<string, unknown>[] }[] } & Record<string, unknown>;
  bad('a node too narrow', (o) => (course(o).paths[0].nodes[1].w = 3));
  bad('a node banked past 45 degrees', (o) => (course(o).paths[0].nodes[1].b = 46));
  bad('a shoulder past 64 m', (o) => (course(o).paths[0].nodes[1].sh = 65));
  bad('an edge neither smooth nor straight', (o) => (course(o).paths[0].nodes[1].c = 'wiggly'));
  bad('two nodes nearer than 2 m', (o) => {
    const n = course(o).paths[0].nodes;
    n[1].x = (n[0].x as number) + 1;
    n[1].z = n[0].z;
  });
  bad('a margin past 16 m', (o) => (course(o).margin = 17));
  bad('a course of another version', (o) => (course(o).v = 2));
  bad('a main line joined to something', (o) => (course(o).paths[0].nodes[0].j = 'main'));
  bad('a gate following a path the course has not got', (o) => ((o.gates as Record<string, unknown>[])[1].path = 'nowhere'));
  bad("a gate on an edge past the path's last", (o) => ((o.gates as Record<string, unknown>[])[1].e = 99));
  bad('a gate with half an anchor', (o) => delete (o.gates as Record<string, unknown>[])[1].t);
  bad("a gate's own width with no anchor", (o) => {
    const g = (o.gates as Record<string, unknown>[])[1];
    delete g.path;
    delete g.e;
    delete g.t;
    g.ow = 1;
  });
  bad('a course on a sprint whose main line is closed into three nodes it does not have', (o) => {
    o.kind = 'sprint';
    delete o.laps;
    course(o).paths[0].nodes = course(o).paths[0].nodes.slice(0, 1);
  });
  bad('a course in a space zone', () => {}, 'space');
  const r = readTrack(JSON.parse(JSON.stringify(t)), [], 2, 'space');
  ok(r === COURSE_IN_SPACE, `a course in a space zone's file is refused in its own words ("${r}")`);
  // A file: a bad course makes its track bad, and only that track.
  const two = trackFileText('naboo', 'raw', [t, { id: 'other', name: 'Other', kind: 'sprint', laps: 1, for: ['podracer'], clear: 0, grid: { x: 0, y: 0, z: 0, q: [1, 0, 0, 0] }, gates: [{ x: 1, y: 0, z: 1, q: [1, 0, 0, 0], w: 10, h: 10 }, { x: 100, y: 0, z: 1, q: [1, 0, 0, 0], w: 10, h: 10 }] }]);
  const broken = two.replace('"w": 24, "b": 0', '"w": 2, "b": 0');
  const rf = readTrackFile(broken, 'naboo', 'ground');
  ok(rf.tracks.length === 1 && rf.tracks[0].id === 'other' && rf.skipped.length === 1 && rf.skipped[0].id === 'eight', 'a bad course makes its whole track skipped and named, and no other');
}

// ---- A field this build does not read refuses nothing. ----
{
  const o = JSON.parse(JSON.stringify(t));
  o.course.paths[0].nodes[2].surface = 'sand';
  o.course.later = true;
  o.gates[1].need = 'required';
  const unknown: string[] = [];
  const r = readTrack(o, unknown);
  ok(typeof r !== 'string', 'a course, a node and a gate carrying fields this build does not read are read all the same');
  ok(unknown.includes('eight.course.paths[0].nodes[2].surface') && unknown.includes('eight.course.later') && unknown.includes('eight.gates[1].need'), `and each is named (${unknown.join(', ')})`);
}

console.log(`\ncourseFile: ${checks} checks passed`);
