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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COURSE_IN_SPACE, COURSE_LEG_STEP, corridorCircles, courseLegs, courseSpines, lapLength, legName, readTrack, readTrackFile, trackFileText, trackHash, trackSync, type TrackDef, type TrackRead } from '../../../src/race/trackFile.ts';
import { trackDigest } from '../../../src/race/raceGroup.ts';
import { nearestOn, spineNear } from '../../../src/race/coursePath.ts';
import { rawToGameX, rawToGameZ } from '../../../src/story/waypoints.ts';
import { parseJsonc } from '../../../src/story/jsonc.ts';
import { addShortcut, courseCtx, drawTrack, moveNode, setTrack } from '../../../src/editor/courseEdit.ts';
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

/**
 * The ids of a file's tracks that carry this wave's own fields (a `course`, or a grid or gate following the road: `path`,
 * `e`, `t`, `ow`), read off the file's own objects (a track the new reader refuses for a bad course is one of them too).
 * afcf394's reader cannot read those fields (it names them unknown and drops them), so a track carrying them is held to
 * this build's reader alone, and every other track of the file to afcf394's exactly. Parsed as the track reader parses
 * (JSONC): a comment the owner wrote into his file by hand is a file the reader takes, and read as plain JSON it named no
 * track at all, so his drawn course was held to afcf394's reader and failed the suite.
 */
function waveTracks(text: string): Set<string> {
  const out = new Set<string>();
  const doc = parseJsonc(text);
  if (doc.error || !doc.value || typeof doc.value !== 'object') return out;
  const tracks = (doc.value as { tracks?: unknown }).tracks;
  if (!Array.isArray(tracks)) return out;
  const anchored = (p: unknown, ow: boolean) => !!p && typeof p === 'object' && ['path', 'e', 't', ...(ow ? ['ow'] : [])].some((k) => k in (p as object));
  for (const r of tracks) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string') continue;
    // A gate past the road's own width or the old height (the race drawer's wave 3b: gates up to 2 km and 1 km), which the
    // readers before it refuse, is this build's too.
    const big = (g: unknown) => !!g && typeof g === 'object' && (Number((g as { w?: unknown }).w) > 80 || Number((g as { h?: unknown }).h) > 100);
    if (o.course !== undefined || anchored(o.grid, false) || (Array.isArray(o.gates) && o.gates.some((g) => anchored(g, true) || big(g)))) out.add(o.id);
  }
  return out;
}

/** A read with the tracks named by `ids` left out: their tracks, their skips and every field named under them. */
function without(r: TrackRead, ids: Set<string>): TrackRead {
  const mine = (s: string) => ids.has(s.slice(0, s.indexOf('.') < 0 ? s.length : s.indexOf('.')));
  return { tracks: r.tracks.filter((t) => !ids.has(t.id)), skipped: r.skipped.filter((s) => !ids.has(s.id)), unknown: r.unknown.filter((u) => !mine(u)), problem: r.problem };
}

// ---- Day one: against the race drawer's start out of git. ----
{
  const old = await loadOldMany(['src/race/trackFile.ts', 'src/race/trackPath.ts', 'src/race/raceGroup.ts'], ['src/race/trackFile.ts', 'src/race/raceGroup.ts'], PRE);
  const NEW: Parameters<typeof trace>[1] = { trackHash, trackFileText, courseLegs, corridorCircles, lapLength };
  const fixtureNew = trace(readTrackFile(FIXTURE, 'naboo', 'ground'), NEW, trackDigest, 'naboo');
  // The fixture's trace as afcf394's own modules make it, recorded once from them.
  const FIXTURE_TRACE = '67307415a2f1737a';
  // The fixture with a drawn course beside its plain tracks (a file the owner's first drawn course makes of his own): the
  // plain tracks are held to afcf394 exactly, the drawn one named apart. Its trace with the drawn track left out is the
  // fixture's own, whatever git answers.
  const drawnBeside = (() => {
    const flat0 = (x: number, z: number) => ({ x, z, y: 1 });
    const d = drawTrack('gamma', 'Gamma', [flat0(0, 0), flat0(300, 10), flat0(500, 200), flat0(250, 400), flat0(-50, 220)], true, courseCtx(() => 0)) as TrackDef;
    const doc = JSON.parse(FIXTURE) as { tracks: unknown[] };
    doc.tracks.push(JSON.parse(JSON.stringify(d)));
    return JSON.stringify(doc, null, 2);
  })();
  const mixedWave = waveTracks(drawnBeside);
  const mixedNew = without(readTrackFile(drawnBeside, 'naboo', 'ground'), mixedWave);
  ok(mixedWave.size === 1 && mixedWave.has('gamma') && waveTracks(FIXTURE).size === 0, "a drawn track is told apart from the plain ones by the file's own fields");
  ok(trace(mixedNew, NEW, trackDigest, 'naboo') === fixtureNew, "with the drawn track left out, a file holding one besides the fixture's plain tracks traces exactly as the fixture alone");
  // The same file with comments written into it by hand (the reader takes JSONC, and the batch writer drops them only at its
  // next write): its drawn track still named apart, its plain tracks still the fixture's.
  const commented = `// a line the owner wrote by hand\n${drawnBeside.replace('"tracks": [', '"tracks": [ /* and one within a line */')}`;
  const commentedWave = waveTracks(commented);
  const commentedNew = without(readTrackFile(commented, 'naboo', 'ground'), commentedWave);
  ok(readTrackFile(commented, 'naboo', 'ground').tracks.length === 3 && commentedWave.size === 1 && commentedWave.has('gamma'), `a file with comments written in by hand, which the reader takes, still names its drawn track apart (${[...commentedWave].join(', ') || 'none named'})`);
  ok(trace(commentedNew, NEW, trackDigest, 'naboo') === fixtureNew, 'and with it left out traces exactly as the fixture alone');
  if (old) {
    const [tf, rg] = old as unknown as [TF, RG];
    const OLD: Parameters<typeof trace>[1] = { trackHash: tf.trackHash, trackFileText: tf.trackFileText, courseLegs: tf.courseLegs, corridorCircles: tf.corridorCircles, lapLength: tf.lapLength };
    const fixtureOld = trace(tf.readTrackFile(FIXTURE, 'naboo', 'ground'), OLD, rg.trackDigest, 'naboo');
    ok(fixtureNew === fixtureOld, `the fixture reads, hashes, digests, gives its legs, circles and laps and writes exactly as ${PRE}'s modules (${fixtureNew.length} characters of trace)`);
    console.log(`note the fixture's trace hashes to ${sha(fixtureOld)}`);
    ok(sha(fixtureOld) === FIXTURE_TRACE, `${PRE}'s trace of the fixture is the one recorded (${sha(fixtureOld)})`);
    const mixedOld = without(tf.readTrackFile(drawnBeside, 'naboo', 'ground'), mixedWave);
    assert.deepStrictEqual(mixedNew, mixedOld, `the plain tracks of a file holding a drawn one read as ${PRE}'s reader reads them`);
    ok(trace(mixedNew, NEW, trackDigest, 'naboo') === trace(mixedOld, OLD, rg.trackDigest, 'naboo'), `and trace exactly as ${PRE}'s, the drawn track named apart`);
    const commentedOld = without(tf.readTrackFile(commented, 'naboo', 'ground'), commentedWave);
    assert.deepStrictEqual(commentedNew, commentedOld, `the plain tracks of a file with comments and a drawn track read as ${PRE}'s reader reads them`);
    ok(trace(commentedNew, NEW, trackDigest, 'naboo') === trace(commentedOld, OLD, rg.trackDigest, 'naboo'), `a file with comments written in by hand: its plain tracks trace exactly as ${PRE}'s, the drawn track named apart`);
    // The owner's own files, whatever they hold: every plain track held to afcf394 exactly, every track he drew with this
    // wave's tool named apart and held to this build's reader alone (afcf394 cannot read a course; never a reason to fail).
    // A folder he has emptied (the endpoint takes it away with his last track) is said, never a failure.
    const dir = join(REPO, 'public', 'tracks');
    const names = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.json')) : [];
    if (!names.length) console.log(`note public/tracks/ holds no track file (${existsSync(dir) ? 'empty' : 'not there'}): only the fixtures are held to ${PRE}`);
    for (const f of names) {
      const world = f.slice(0, -5);
      const text = readFileSync(join(dir, f), 'utf8');
      const wave = waveTracks(text);
      const fullNew = readTrackFile(text, world, 'ground');
      const rNew = without(fullNew, wave);
      const rOld = without(tf.readTrackFile(text, world, 'ground'), wave);
      assert.deepStrictEqual(rNew, rOld, `${f}'s plain tracks read as ${PRE}'s reader reads them`);
      ok(trace(rNew, NEW, trackDigest, world) === trace(rOld, OLD, rg.trackDigest, world), `public/tracks/${f}: ${rNew.tracks.length} plain tracks (${rNew.tracks.map((t) => t.id).join(', ') || 'none'}) read, hash, digest, legs, circles, laps and text exactly as ${PRE}'s`);
      ok(JSON.stringify(trackSync(rNew.tracks, rNew.tracks)) === JSON.stringify(tf.trackSync(rOld.tracks, rOld.tracks)) && JSON.stringify(trackSync([], rNew.tracks)) === JSON.stringify(tf.trackSync([], rOld.tracks)), `public/tracks/${f}'s plain tracks sync as ${PRE}'s`);
      // Said, never asserted: the file is his, and a course he mended by hand into one this build refuses is his to see.
      for (const id of wave) {
        const whole = fullNew.tracks.some((t) => t.id === id) && !fullNew.skipped.some((s) => s.id === id) && !fullNew.unknown.some((u) => u.startsWith(`${id}.`));
        console.log(`note public/tracks/${f}: ${id} carries a drawn course or following gates, which ${PRE}'s reader cannot read: left out of the comparison (${whole ? 'this build reads it whole' : 'this build does NOT read it whole'})`);
      }
    }
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
  // The course's own line built from the course's own numbers (never a feel dial's starting value, which the owner moves).
  const c = t.course!;
  const head = `"course": { "v": ${c.v}, "feather": ${JSON.stringify(c.feather)}, "crossing": ${JSON.stringify(c.crossing)}, "margin": ${c.margin}, "level": ${c.level}, "grass": ${JSON.stringify(c.grass)}, "wallOut": ${c.wallOut}, "wallHigh": ${c.wallHigh},`;
  ok(lines.some((l) => l.trim() === head), "the course's own numbers on one line after the gates");
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

// ---- A drawn course's corridor and lap (what the game reads: `track({ check })` and the lap shown). ----
{
  const plain = { ...t, course: undefined };
  const sp = courseSpines(t);
  const legs = courseLegs(t, t.grid, t.gates);
  const want = sp.reduce((n, s) => n + s.edges.reduce((m, ed) => m + Math.max(1, Math.ceil(ed.len / COURSE_LEG_STEP)), 0), 0);
  const gateLegs = courseLegs(plain, t.grid, t.gates);
  ok(legs.length === want && legs.length !== gateLegs.length, `a drawn course's legs follow its road, one every ${COURSE_LEG_STEP} m or less an edge (${legs.length}), never gate to gate (${gateLegs.length})`);
  const near = spineNear();
  let off = 0;
  let longest = 0;
  let halfOff = 0;
  for (const l of legs) {
    nearestOn(sp[l.path!], l.ax, l.az, near);
    off = Math.max(off, near.d);
    const hwA = near.hw;
    nearestOn(sp[l.path!], l.bx, l.bz, near);
    off = Math.max(off, near.d);
    halfOff = Math.max(halfOff, Math.abs(l.half - (Math.max(hwA, near.hw) + t.clear)));
    longest = Math.max(longest, Math.hypot(l.bx - l.ax, l.bz - l.az));
  }
  ok(off < 1e-6 && longest <= COURSE_LEG_STEP + 1e-9 && halfOff < 0.01, `every leg's ends on its road's spine (worst ${off.toExponential(1)} m), none longer than ${COURSE_LEG_STEP} m (${longest.toFixed(3)}), each as wide as the road there and the track's clear (worst ${halfOff.toFixed(4)} m off)`);
  // Carried out of the file's frame (the game's `trackRawToGame`, a centre off the origin): every end, the width as it was.
  const C = { x: 1234.5, z: -678.25 };
  const place = (x: number, z: number) => ({ x: rawToGameX(C.x, x), z: rawToGameZ(C.z, z) });
  const carried = courseLegs(t, t.grid, t.gates, place);
  ok(carried.length === legs.length && carried.every((l, i) => l.ax === place(legs[i].ax, legs[i].az).x && l.az === place(legs[i].ax, legs[i].az).z && l.bx === place(legs[i].bx, legs[i].bz).x && l.bz === place(legs[i].bx, legs[i].bz).z && l.half === legs[i].half), "the legs handed a carry are carried at every end, their widths as they were");
  ok(JSON.stringify(courseLegs(plain, t.grid, t.gates, place)) === JSON.stringify(gateLegs), 'a gate-only track takes no carry (its gates are already in the frame handed)');
  // The lap: the main line's own arclength, never the gate-to-gate lines.
  ok(lapLength(t, t.gates) === sp[0].length && lapLength(t, t.gates) !== lapLength(plain, t.gates), `a drawn circuit's lap is its main line's length (${sp[0].length.toFixed(2)} m), not the gates' (${lapLength(plain, t.gates).toFixed(2)} m)`);
  // A sprint's lap is its open main line's; a shortcut's spine adds legs of its own and leaves the lap the main line's.
  const flatS = (x: number, z: number) => ({ x, z, y: 1 });
  const dash = drawTrack('dash', 'Dash', [flatS(0, 0), flatS(300, 40), flatS(700, -20), flatS(1000, 60)], false, ctx) as TrackDef;
  ok(lapLength(dash, dash.gates) === courseSpines(dash)[0].length, "a drawn sprint's lap is its open main line's length");
  const main = t.course!.paths[0].nodes;
  const cut = addShortcut(t, [{ x: main[0].x, z: main[0].z, y: main[0].y }, flatS(250, 200), { x: main[2].x, z: main[2].z, y: main[2].y }], 'main', 'main', ctx) as TrackDef;
  const cutLegs = courseLegs(cut, cut.grid, cut.gates);
  ok(typeof cut !== 'string' && cutLegs.some((l) => l.path === 1) && lapLength(cut, cut.gates) === courseSpines(cut)[0].length, "a shortcut's road has legs of its own, and the lap is still the main line's");
  // A leg named in words: along a drawn road by its path and how far along it, a gate-only track's by its gates.
  const i = Math.floor(legs.length / 2);
  ok(legName(t, legs[i], i) === `the road at ${Math.round(legs[i].s!)} m` && legs[i].s! > 0, `a drawn road's leg named by how far along it (${legName(t, legs[i], i)})`);
  const j = cutLegs.findIndex((l) => l.path === 1);
  ok(legName(cut, cutLegs[j], j) === `shortcut ${cut.course!.paths[1].id} at 0 m`, `a shortcut's leg by its path (${legName(cut, cutLegs[j], j)})`);
  ok(legName(plain, gateLegs[0], 0) === 'grid to gate 0' && legName(plain, gateLegs[2], 2) === 'gate 1 to 2' && legName(plain, gateLegs[gateLegs.length - 1], gateLegs.length - 1) === `gate ${t.gates.length - 1} to 0`, "a gate-only track's legs by its gates, as ever");
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
  // A node broken by its own numbers (never a feel dial's starting value), and the break checked to have landed.
  const n0 = t.course!.paths[0].nodes[0];
  const broken = two.replace(`"w": ${n0.w}, "b": ${n0.b}`, `"w": 2, "b": ${n0.b}`);
  ok(broken !== two, "the node to break is found by its own numbers");
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
