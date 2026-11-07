// The race drawer's second wave: the walk grid follows a world's drawn courses (DESIGN.md §2.7, `tools/swg/navgrid.mjs`,
// `tools/swg/finalnames.mjs`). The bake lays the carve before the heights, the game's own order (held as text, and by a
// bake: a step a heights file puts across a raised road blocks the road there, which a carve laid after the heights would
// have flattened away); a raised road's embankment blocks its steep sides and leaves its surface walkable. The key folds the
// courses' stamp only where a drawn course exists: a gate moved, a track renamed, a wall toggled, `clear`, `grass`,
// `wallOut`, `wallHigh` changed and a gate-only track leave the key as it was; a node moved changes it; its line endings do
// not. Every grid on disk keys as afcf394's `layoutKeyOf` keyed it (no track file is read here), and a fixture pack of the
// test's own keys as the hash recorded from it, git or none. `tracksFolder()` answers
// null where `placementsFolder()` does, and a grid with no key over a world with a drawn course is named stale in words.
//
// It reads the converted packs on disk (`assets-private`); a world not converted is said and stepped over.
//
// Run: node tools/swg/tests/courseGrid.test.ts
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateRawSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { oldTexts, REPO } from './oldModules.ts';
import { buildNavGrid, courseStamp, gridEditsOf, gridTrackText, tracksFolder, walkThroughTemplates } from '../navgrid.mjs';
import { gridLayoutStale, layoutKeyOf } from '../finalnames.mjs';
import { placementsFolder } from '../placementsStatus.mjs';
import { deltaBytes, heightsFileText, tileIdOf } from '../../../src/world/editFiles/heightsFile.ts';
import { readTrackFile, trackFileText, type TrackDef } from '../../../src/race/trackFile.ts';
import { courseCtx, drawTrack } from '../../../src/editor/courseEdit.ts';

let passed = 0;
function ok(cond: unknown, msg: string): void {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
}
function note(msg: string): void {
  console.log(`note ${msg}`);
}

const PACKS = join(REPO, 'assets-private');
const PLAIN = { world: 'none', texts: { heights: null, water: null, world: null, story: null } };
const wt = walkThroughTemplates();
const nibbleOf = (nibbles: Uint8Array, k: number): number => (k & 1 ? nibbles[k >> 1] >> 4 : nibbles[k >> 1] & 0x0f);
const walkable = (v: number): boolean => v >= 1 && v <= 14;

// ---------------------------------------------------------------- the order, as text

{
  const bake = readFileSync(join(REPO, 'tools/swg/navgrid.mjs'), 'utf8').replace(/\r\n/g, '\n');
  const carve = bake.indexOf('courses.layIn(ask);');
  const heights = bake.indexOf('heightEdits.lay(heights, heights, cx - x0, -pole, cz + z0, pole, pnx, pnz);');
  const check = bake.indexOf('worstHeight = Math.max(worstHeight');
  ok(carve > 0 && heights > carve && check > 0 && check < carve, 'the bake carves the drawn courses into its raw poles after the check that they are the generator\'s, and lays the heights file over the carve');
  ok(/const courses = gridCourses\(edits, log\);/.test(bake) && /ask\.x0 = cx - x0;\s*ask\.dx = -pole;\s*ask\.z0 = cz \+ z0;\s*ask\.dz = pole;\s*ask\.nx = pnx;\s*ask\.nz = pnz;\s*ask\.widen = 0;/.test(bake), "over the bake's own lattice in the raw frame, with no far widening (a block's carve)");
  ok(/const tracks = gridTrackText\(world, folder\);\s*if \(tracks\) \{\s*edits\.tracks = tracks\.text;\s*edits\.course = tracks\.stamp;\s*\}/.test(bake), "`gridEditsOf` reads the track file beside the placements folder and keeps it only where a course is drawn");
  const fin = readFileSync(join(REPO, 'tools/swg/finalnames.mjs'), 'utf8').replace(/\r\n/g, '\n');
  ok(/if \(typeof edits\?\.course === 'string' && edits\.course\) h\.update\('\\n \\ncourses\\n'\)\.update\(edits\.course\.replace\(\/\\r\\n\/g, '\\n'\)\);/.test(fin), "and the key folds the courses' stamp in, its line endings folded");
}

// ---------------------------------------------------------------- the stamp

{
  const ctx = courseCtx(() => 10);
  const pts = [
    { x: -100, z: 0, y: 10 },
    { x: 100, z: 0, y: 12 },
    { x: 100, z: 150, y: 14 },
    { x: -100, z: 150, y: 12 },
  ];
  const t = drawTrack('loop', 'Loop', pts, true, ctx) as TrackDef;
  assert.ok(typeof t !== 'string', String(t));
  const base = courseStamp([t]);
  const copy = (): TrackDef => JSON.parse(JSON.stringify(t));
  const edits: [string, (k: TrackDef) => void, boolean][] = [
    ['a gate moved', (k) => (k.gates[1] = { ...k.gates[1], x: k.gates[1].x + 3 }), false],
    ['the track renamed', (k) => (k.name = 'Another'), false],
    ['a wall toggled', (k) => (k.course!.paths[0].nodes[1] = { ...k.course!.paths[0].nodes[1], wall: 'left' }), false],
    ['`clear` changed', (k) => (k.clear = k.clear + 5), false],
    ['`grass` changed', (k) => (k.course!.grass = k.course!.grass === 'clear' ? 'keep' : 'clear'), false],
    ['`wallOut` changed', (k) => (k.course!.wallOut = k.course!.wallOut + 1), false],
    ['`wallHigh` changed', (k) => (k.course!.wallHigh = k.course!.wallHigh + 1), false],
    ['the laps changed', (k) => (k.laps = k.laps + 1), false],
    ['a node moved', (k) => (k.course!.paths[0].nodes[2] = { ...k.course!.paths[0].nodes[2], x: k.course!.paths[0].nodes[2].x + 1 }), true],
    ['a node raised', (k) => (k.course!.paths[0].nodes[2] = { ...k.course!.paths[0].nodes[2], y: k.course!.paths[0].nodes[2].y + 1 }), true],
    ['a node widened', (k) => (k.course!.paths[0].nodes[0] = { ...k.course!.paths[0].nodes[0], w: k.course!.paths[0].nodes[0].w + 2 }), true],
    ['the falloff changed', (k) => (k.course!.feather = k.course!.feather === 'linear' ? 'easeIn' : 'linear'), true],
    ['the margin changed', (k) => (k.course!.margin = k.course!.margin + 1), true],
    ['the crossing changed', (k) => (k.course!.crossing = k.course!.crossing === 'wall' ? 'slope' : 'wall'), true],
    // Wave 3b's review round: what wave 3b adds to the ground moves the key too.
    ['a node made to follow the land', (k) => (k.course!.paths[0].nodes[1] = { ...k.course!.paths[0].nodes[1], cut: false }), true],
    ['a hole put on the road', (k) => (k.course!.ground = [{ kind: 'hole', path: 'main', e: 1, t: 0.5, off: 0, turn: 0, l: 10, w: 8, h: 2, soft: 1 }]), true],
    ['a brush chunk written', (k) => (k.course!.brush = [{ path: 'main', k: 2, a: -1, n: 3, d: 'AAAA' }]), true],
    ['a node\'s brush lattice moved', (k) => {
      k.course!.paths[0].nodes.forEach((n, i) => (n.bs = i * 200));
      k.course!.paths[0].bl = 900;
    }, true],
  ];
  for (const [what, edit, moves] of edits) {
    const k = copy();
    edit(k);
    ok((courseStamp([k]) !== base) === moves, `${what} ${moves ? 'changes' : 'leaves'} the courses' stamp`);
  }
  const gateOnly: TrackDef = { ...copy(), course: undefined };
  delete (gateOnly as { course?: unknown }).course;
  ok(courseStamp([gateOnly]) === '' && courseStamp([]) === '', 'a gate-only track, and no track, stamp nothing');
  ok(courseStamp([gateOnly, t]) === base && courseStamp([t, gateOnly]) === base, "a gate-only track beside a drawn one leaves the stamp as the drawn one's alone, in either order");
  // Read through the folder as the bake reads it: a placements folder with a tracks folder beside it.
  const root = mkdtempSync(join(tmpdir(), 'rd-w2-grid-'));
  try {
    const placed = join(root, 'placements');
    mkdirSync(placed);
    mkdirSync(join(root, 'tracks'));
    ok(tracksFolder(placed) === join(root, 'tracks') && tracksFolder(null) === null, '`tracksFolder` is the folder beside the placements folder, and none where there is none');
    writeFileSync(join(root, 'tracks', 'naboo.json'), trackFileText('naboo', 'raw', [t]));
    const got = gridTrackText('naboo', placed);
    ok(!!got && got.stamp === base, 'a track file with a drawn course is read and stamped');
    writeFileSync(join(root, 'tracks', 'naboo.json'), trackFileText('naboo', 'raw', [t]).replace(/\n/g, '\r\n'));
    ok(gridTrackText('naboo', placed)?.stamp === base, 'and its line endings fold');
    writeFileSync(join(root, 'tracks', 'naboo.json'), trackFileText('naboo', 'raw', [gateOnly]));
    ok(gridTrackText('naboo', placed) === null && gridTrackText('dantooine', placed) === null, 'a file of gate-only tracks, and no file, are none to the bake');
    const env = process.env.SWG3JS_PLACEMENTS;
    process.env.SWG3JS_PLACEMENTS = '';
    try {
      ok(placementsFolder() === null && tracksFolder() === null, "with `SWG3JS_PLACEMENTS` empty there is no placements folder, so no track file either (the owner's own courses never reach a fixture's grid)");
    } finally {
      if (env === undefined) delete process.env.SWG3JS_PLACEMENTS;
      else process.env.SWG3JS_PLACEMENTS = env;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- every grid on disk, against afcf394's key

const OLD = 'afcf394';
async function oldKey(): Promise<{ layoutKeyOf: typeof layoutKeyOf; done: () => void } | null> {
  const files = ['tools/swg/finalnames.mjs'];
  const texts = oldTexts(files, OLD);
  if (!texts) return null;
  const tmp = mkdtempSync(join(tmpdir(), 'rd-w2-old-'));
  for (const f of files) {
    const from = resolve(REPO, f, '..');
    const point = (p: string): string => pathToFileURL(resolve(from, p)).href;
    const text = texts
      .get(f)!
      .replace(/from '(\.\.?\/[^']+)'/g, (_m, p: string) => `from '${point(p)}'`)
      .replace(/import\('(\.\.?\/[^']+)'\)/g, (_m, p: string) => `import('${point(p)}')`)
      .replace(/import\.meta\.url/g, `'${pathToFileURL(resolve(REPO, f)).href}'`);
    writeFileSync(join(tmp, f.split('/').pop()!), text);
  }
  const fin = await import(pathToFileURL(join(tmp, 'finalnames.mjs')).href);
  return { layoutKeyOf: fin.layoutKeyOf, done: () => rmSync(tmp, { recursive: true, force: true }) };
}
{
  const old = await oldKey();
  try {
    if (!old) note(`git could not hand over ${OLD}'s key: the comparison is not made here`);
    else {
      let keys = 0;
      for (const name of existsSync(PACKS) ? readdirSync(PACKS) : []) {
        const dir = join(PACKS, name);
        if (!existsSync(join(dir, 'nav.json')) || !existsSync(join(dir, 'layout.json'))) continue;
        // The edits as the bake reads them with no placements folder (no file of the owner's is read).
        const edits = gridEditsOf(name, null, dir);
        assert.equal(layoutKeyOf(dir, wt, edits), old.layoutKeyOf(dir, wt, edits), `${name}: the key is ${OLD}'s`);
        keys++;
      }
      ok(keys > 0 || !existsSync(PACKS), `every grid on disk keys as ${OLD}'s layoutKeyOf keyed it (${keys} grids)`);
    }
  } finally {
    old?.done();
  }
}

// ---------------------------------------------------------------- a fixture pack's key, recorded
//
// The grids on disk above are compared only where git answers and only on an install that has packs. A fixture pack of
// this test's own (a layout naming one template the walk-through set reaches, a terrain of fixed bytes) is keyed over the
// edit shapes of before -- none, the plain edits, every field the key folds but the courses', and those with a gate-only
// track file (a course stamp of nothing) -- and the keys are held to the hash recorded from afcf394's `layoutKeyOf`, whether
// or not git answers (`SWG3JS_NO_OLD=1`); where it answers, afcf394's own keys are held to the same hash.

/** Recorded from afcf394's `finalnames.mjs` `layoutKeyOf` over the fixture pack and edit shapes below. */
const FIXTURE_KEYS = 'cb0cdbd8';
{
  const root = mkdtempSync(join(tmpdir(), 'rd-w2-key-'));
  try {
    writeFileSync(join(root, 'layout.json'), '{\r\n  "center": { "x": 12, "z": -40 },\r\n  "objects": [{ "template": "object/tangible/fern.iff" }, { "template": "object/tangible/rock.iff", "contained": 3 }]\r\n}\r\n');
    writeFileSync(join(root, 'terrain.trn'), Buffer.from(Array.from({ length: 256 }, (_, i) => (i * 37 + 11) & 0xff)));
    const fern = new Set(['object/tangible/fern.iff']);
    const full = { world: 'fixture', texts: { heights: 'heights\r\nrow', water: 'water', world: 'world\nrow', story: null }, absent: ['gallery/house.glb'], soeRivers: 'v1:2', imports: ['imports/hut-0123456789ab.glb'], removedGrid: 'o:x@1,2,3' };
    const gateOnly = trackFileText('fixture', 'raw', [{ id: 'g', name: 'G', kind: 'sprint', laps: 1, clear: 6, grid: { x: 0, y: 0, z: 0, h: 0 }, gates: [], at: 1 } as unknown as TrackDef]);
    const shapes: [ReadonlySet<string> | null, unknown][] = [
      [null, null],
      [null, PLAIN],
      [wt, PLAIN],
      [fern, PLAIN],
      [fern, full],
      [fern, { ...full, tracks: gateOnly, course: '' }],
    ];
    const keysOf = (f: typeof layoutKeyOf): string => shapes.map(([w, e]) => f(root, w as never, e as never)).join(',');
    const sha = (s: string): string => {
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
      return h.toString(16).padStart(8, '0');
    };
    const now = sha(keysOf(layoutKeyOf));
    const old = await oldKey();
    try {
      if (old) {
        const was = sha(keysOf(old.layoutKeyOf));
        ok(was === FIXTURE_KEYS, `${OLD}'s own keys over the fixture pack are the hash recorded from it (${was})`);
      } else note(`git could not hand over ${OLD}'s key: the fixture's keys are held to the hash recorded from it`);
    } finally {
      old?.done();
    }
    ok(now === FIXTURE_KEYS, `a fixture pack keys over every edit shape of before (no course drawn) as ${OLD}'s layoutKeyOf did (${FIXTURE_KEYS})`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- the key and the stale words over a drawn course

{
  const dir = join(PACKS, 'watertabletest');
  if (!existsSync(join(dir, 'layout.json'))) note('watertabletest is not converted: the key over a drawn course is not checked here');
  else {
    const t = drawTrack('road', 'Road', [{ x: -60, z: 0, y: 5 }, { x: 60, z: 0, y: 5 }], false, courseCtx(() => 5)) as TrackDef;
    const stamp = courseStamp([t]);
    const plainKey = layoutKeyOf(dir, wt, PLAIN);
    const withCourse = { ...PLAIN, world: 'watertabletest', tracks: trackFileText('watertabletest', 'raw', [t]), course: stamp };
    ok(layoutKeyOf(dir, wt, withCourse) !== plainKey && layoutKeyOf(dir, wt, { ...withCourse, course: '' }) === plainKey, 'the key folds the stamp only where a course is drawn');
    ok(layoutKeyOf(dir, wt, { ...withCourse, course: stamp.replace(/\n/g, '\r\n') }) === layoutKeyOf(dir, wt, withCourse), "and the stamp's line endings do not move it");
    ok(gridLayoutStale({ nx: 1 }, dir, null, wt, withCourse) === "was baked before the world's drawn race courses carved its ground" && gridLayoutStale({ nx: 1 }, dir, null, wt, PLAIN) === null, 'a grid with no key over a world with a drawn course is named stale, in words; over none it is not');
    ok(/drawn courses/.test(gridLayoutStale({ layoutKey: 'abcdef012345' }, dir, null, wt, withCourse) ?? ''), "a grid keyed otherwise names the drawn courses among what may have moved");
  }
}

// ---------------------------------------------------------------- a bake over a raised road and a heights step across it

{
  const world = 'watertabletest';
  const dir = join(PACKS, world);
  if (!existsSync(join(dir, 'nav.json'))) note(`${world} is not converted: the bake over a drawn course is not checked here`);
  else {
    const layout = JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf8')) as { center: { x: number; z: number }; terrain?: string };
    const trn = await import('../../../src/swg/terrain/trn.ts');
    const template = trn.parseTerrainTemplate(new Uint8Array(readFileSync(join(dir, layout.terrain ?? 'terrain.trn'))));
    for (const b of trn.bitmapFiles(template)) {
      const f = join(dir, b.file);
      if (existsSync(f)) trn.attachBitmap(template, b.familyId, new Uint8Array(readFileSync(f)));
    }
    const sampler = new trn.TerrainSampler(template);
    const plain = await buildNavGrid(dir, { walkThrough: wt, edits: PLAIN });
    const { nx, cell, x0, z0 } = plain.header as { nx: number; cell: number; x0: number; z0: number };
    const cx = layout.center.x;
    const cz = layout.center.z;
    const kOf = (rx: number, rz: number): number => Math.floor((rz - cz - z0) / cell) * nx + Math.floor((cx - rx - x0) / cell);
    // A straight road along raw x through tile (0, 0) and its neighbours, 14 m over the highest ground under it, on 2 m
    // shoulders: an embankment.
    let hi = -Infinity;
    for (let x = -96; x <= 96; x += 2) for (let z = -16; z <= 16; z += 2) hi = Math.max(hi, sampler.heightAt(x, z));
    const road = drawTrack('road', 'Road', [{ x: -96, z: 8, y: hi + 14 }, { x: 96, z: 8, y: hi + 14 }], false, courseCtx(() => hi + 14)) as TrackDef;
    for (const n of road.course!.paths[0].nodes) {
      n.sh = 2;
      n.w = 16;
    }
    const tracks = trackFileText(world, 'raw', [road]);
    // A heights step across the road: nought over the tile's first half along x, 4 m over its second.
    const step = new Float32Array(32 * 32);
    for (let lz = 0; lz < 32; lz++) for (let lx = 16; lx < 32; lx++) step[lz * 32 + lx] = 4;
    const heightsText = heightsFileText(world, [{ id: tileIdOf(0, 0), d: deflateRawSync(Buffer.from(deltaBytes(step))).toString('base64'), on: '00000000' }]);
    const courseOnly = await buildNavGrid(dir, { walkThrough: wt, edits: { ...PLAIN, world, tracks, course: courseStamp(readTrackFile(tracks, world, 'ground').tracks) } });
    const both = await buildNavGrid(dir, { walkThrough: wt, edits: { world, texts: { ...PLAIN.texts, heights: heightsText }, tracks, course: courseStamp(readTrackFile(tracks, world, 'ground').tracks) } });
    // The road's surface walkable (away from the step), its embankment's sides blocked where the plain ground was open.
    let surface = 0;
    let surfaceOpen = 0;
    for (let x = -80; x <= -10; x += 4) {
      surface++;
      if (walkable(nibbleOf(courseOnly.nibbles, kOf(x, 8)))) surfaceOpen++;
    }
    let sides = 0;
    let sidesClosed = 0;
    for (let x = -80; x <= 80; x += 4)
      for (const z of [8 - 9, 8 + 9]) {
        const k = kOf(x, z);
        if (!walkable(nibbleOf(plain.nibbles, k))) continue;
        sides++;
        if (!walkable(nibbleOf(courseOnly.nibbles, k))) sidesClosed++;
      }
    ok(surfaceOpen === surface && sides > 0 && sidesClosed === sides, `the bake reads the drawn course: a road 14 m over the ground walks all along (${surfaceOpen} of ${surface} cells) and its embankment's steep sides are closed (${sidesClosed} of ${sides} cells the plain ground walked)`);
    ok((courseOnly.header as { stats: { courses?: number } }).stats.courses === 1 && !('courses' in (plain.header as { stats: object }).stats), 'and its header says it carved one path, where a world with none writes the header it always did');
    // The step on the road: blocked where the heights file's step crosses it (laid over the carve), open on either side.
    const stepAt = kOf(32, 8);
    const before = kOf(20, 8);
    const after = kOf(44, 8);
    ok(walkable(nibbleOf(courseOnly.nibbles, stepAt)) && !walkable(nibbleOf(both.nibbles, stepAt)) && walkable(nibbleOf(both.nibbles, before)) && walkable(nibbleOf(both.nibbles, after)), "a heights file's 4 m step across the road blocks the road at the step (the heights laid over the carve: laid under it, the road would be flat there) and leaves it walkable either side");
    // Wave 3b's review round: the track's own brush strokes are baked too. A chunk raising the road 6 m from 32 m along (raw x
    // -64) to 62 m (x -34) across its whole width: the bake inflates it (as the game does), so the road steps up 6 m within a
    // cell at x -64 and is blocked there, where the course alone walks.
    const cells = new Float32Array(16 * 9).fill(6);
    const chunk = deflateRawSync(Buffer.from(cells.buffer)).toString('base64');
    const stroked: TrackDef = JSON.parse(JSON.stringify(road));
    stroked.course!.brush = [{ path: 'main', k: 1, a: -4, n: 9, d: chunk }];
    const tracks2 = trackFileText(world, 'raw', [stroked]);
    const stamp2 = courseStamp(readTrackFile(tracks2, world, 'ground').tracks);
    ok(stamp2 !== courseStamp(readTrackFile(tracks, world, 'ground').tracks), 'a brush stroke on the road moves the courses\' stamp, so the key asks for a bake');
    const brushed = await buildNavGrid(dir, { walkThrough: wt, edits: { ...PLAIN, world, tracks: tracks2, course: stamp2 } });
    const rise = kOf(-65, 8);
    ok(walkable(nibbleOf(courseOnly.nibbles, rise)) && !walkable(nibbleOf(brushed.nibbles, rise)), "and the bake reads the stroke: the road's 6 m rise at its start is blocked, where the course alone walks");
  }
}

console.log(`\ncourseGrid: ${passed} checks passed`);
