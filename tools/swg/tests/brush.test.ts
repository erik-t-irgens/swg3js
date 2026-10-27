// The world editor's scatter brush (DESIGN.md §2.8, map-maker wave 3): its rules (`brush.ts`) and its glue
// (`editorBrush.ts`) round the real editing class, whose every write goes through the endpoint's own batch on file texts
// (`editsHarness.ts`). A paint stamp fills the disc toward the target density, counting what of its own entries stands in
// it and never past it; the spacing holds against everything standing and every plant of the stamp; the slope, height and
// water filters and what stands keep plants off; an entry meant for the water may stand in it; the same seed over the same
// ground gives the same rows; a stroke is one undo entry, undone and done again byte for byte; an erase stroke takes its
// share of its own rows in the destination file and nothing else; the stamps come at one rate whatever the frame rate; the
// ring projects its points and says which are behind the eye; and the brush's frame and its ring make nothing (twelve
// processes at once, `editorAllocOwn.ts brush`). Every number here is a fixture's, never the owner's tune.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeHarness, propRow } from './editsHarness.ts';
import { BRUSH_TUNE } from '../../../src/editor/editorTune.ts';
import { RING_STEPS, brushCount, brushRandom, brushRing, brushTarget, eraseStamp, meantForWater, paintStamp, pickEntry, ringAsk, startClock, stampsDue, type BrushGround, type BrushNear, type BrushTune } from '../../../src/editor/brush.ts';
import { EditorBrush, blockedAt, brushNearOf, type BrushHost, type BrushNearThing, type BrushNearWorld, type BrushPlaced, type BrushSource } from '../../../src/editor/editorBrush.ts';
import { libraryView, type LibraryEntry } from '../../../src/editor/libraryModel.ts';
import { toGame, type PlacementLayer, type PlacementRow } from '../../../src/story/placements.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** A fixture's tune: a disc 8 m across at 2 a 100 m² (4 plants), 1.5 m apart, every filter open. */
function tune(over: Partial<BrushTune> = {}): BrushTune {
  return { radius: 8, density: 2, spacing: 1.5, rate: 8, randomYaw: true, scaleMin: 0.8, scaleMax: 1.2, align: false, alignMax: 10, slopeMin: 0, slopeMax: 30, heightOn: false, heightMin: -1000, heightMax: 10000, keepOffWater: true, keepOffStanding: true, eraseShare: 1, tries: 8, ...over };
}
const flat: BrushGround = { ground: () => 0, water: () => Number.NaN, blocked: () => false };
const one = [{ key: 'props:tree', weight: 1, water: false }];
const d2 = (a: { x: number; z: number }, b: { x: number; z: number }) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

/** A props entry of the library, as the index lists one. */
const propEntry = (id: string): LibraryEntry => ({ s: 'props', p: 'props', id, m: '', n: null, g: '', t: null, sz: [0, 0, 0], tri: 0, pic: null, f: 0 });
/** The library the brush's near reads rows by: a chair (the brush's entry in these strokes) and a stool. */
const VIEW = libraryView([propEntry('chair'), propEntry('stool')]);
/** A placed object of the world's (never a row of the files), with its box, standing in the game's frame. */
type Thing = BrushPlaced & { box: { min: number[]; max: number[] } };
/** What `brushNearOf` reads of the world, over a harness's files (their rows standing) and these placed objects. */
function worldOver(hh: { host: { standing(): Iterable<{ id: string; row: PlacementRow; layer: PlacementLayer; x: number; z: number }> } }, things: readonly Thing[] = []): BrushNearWorld<Thing> {
  return {
    view: VIEW,
    here: 'tatooine',
    rows: hh.host.standing(),
    placedOfRow: () => null,
    forEachPlacedIn: (rect, visit) => {
      for (const o of things) if (o.x >= rect.x0 && o.x <= rect.x1 && o.z >= rect.z0 && o.z <= rect.z1 && !visit(o)) return;
    },
    boxOf: (o) => o.box,
  };
}
/** A brush host over a harness, by the game's own near: a chair (or `src`) to paint with, flat known ground by default. */
function hostOver(hh: ReturnType<typeof makeHarness>, o: { src?: Partial<BrushSource>; ground?: (x: number, z: number) => number; things?: Thing[]; dest?: () => PlacementLayer } = {}): BrushHost {
  return {
    edits: hh.e,
    source: async (key) => ({ key, id: 'chair', src: { kind: 'prop', pack: 'props', thing: 'chair', template: 'object/tangible/test/shared_chair.iff' } as never, bounds: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }, water: false, ...o.src }),
    near: (cx, cz, reach, keys) => brushNearOf(worldOver(hh, o.things ?? []), cx, cz, reach, keys),
    ground: o.ground ?? (() => 0),
    water: () => Number.NaN,
    centre: () => ({ x: 0, z: 0 }),
    frame: () => 'raw',
    packId: () => 'tatooine',
    inSpace: () => false,
    dest: o.dest ?? (() => 'world'),
    cameraYaw: () => 0,
    say: () => {},
  };
}

{
  // The generator and the draw by weight.
  const a = brushRandom(42);
  const b = brushRandom(42);
  const c = brushRandom(43);
  const sa = Array.from({ length: 8 }, () => a());
  const sb = Array.from({ length: 8 }, () => b());
  const sc = Array.from({ length: 8 }, () => c());
  ok(sa.every((v, i) => v === sb[i]) && sa.some((v, i) => v !== sc[i]) && sa.every((v) => v >= 0 && v < 1), 'the same seed draws the same numbers in [0, 1), another seed others');
  const w = [
    { key: 'a', weight: 1, water: false },
    { key: 'b', weight: 0, water: false },
    { key: 'c', weight: 3, water: false },
  ];
  ok(pickEntry(w, 0) === 0 && pickEntry(w, 0.24) === 0 && pickEntry(w, 0.26) === 2 && pickEntry(w, 0.999) === 2, 'an entry is drawn by its weight, one of weight nought never');
  ok(pickEntry([{ key: 'z', weight: 0, water: false }], 0.5) === -1 && pickEntry([], 0.5) === -1, 'and none where nothing weighs anything');
  ok(brushTarget({ radius: 8, density: 2 }) === Math.round(0.02 * Math.PI * 64) && brushTarget({ radius: 0, density: 5 }) === 0, `the target is the density over the disc (${brushTarget({ radius: 8, density: 2 })} at 8 m and 2 a 100 m²)`);
  ok(meantForWater('swmp_reeds_a') && meantForWater('lily_pad') && meantForWater('uwtr_seagrass') && !meantForWater('tree_oak'), "an entry is meant for the water by the radial flora's own rule");
}

{
  // A paint stamp fills toward the target, counting its own rows standing, never past it.
  const t = tune();
  const target = brushTarget(t);
  const plants = paintStamp(t, 0, 0, one, [], flat, brushRandom(7), 0);
  ok(plants.length === target, `an empty disc is filled to its target (${plants.length} of ${target})`);
  ok(plants.every((p) => p.x * p.x + p.z * p.z <= t.radius * t.radius + 1e-9 && p.y === 0), 'every plant inside the disc, on the ground');
  ok(plants.every((p, i) => plants.every((q, j) => i === j || d2(p, q) >= t.spacing * t.spacing)), `and every two at least the spacing apart (${t.spacing} m)`);
  ok(plants.every((p) => p.scale >= t.scaleMin && p.scale <= t.scaleMax && p.yaw >= 0 && p.yaw < Math.PI * 2), 'at a scale between its least and most, at a turn of its own');
  const mine: BrushNear[] = plants.map((p) => ({ x: p.x, z: p.z, mine: true }));
  ok(paintStamp(t, 0, 0, one, mine, flat, brushRandom(8), 0).length === 0 && brushCount(0, 0, t.radius, mine) === target, 'a disc already at its target paints nothing more');
  const half = mine.slice(0, 2);
  const more = paintStamp(t, 0, 0, one, half, flat, brushRandom(9), 0);
  ok(more.length === target - 2, `a disc half full is filled to its target and no further (${more.length} more)`);
  // Spacing holds against what stands that is not its own, too.
  const others: BrushNear[] = Array.from({ length: 30 }, (_, i) => ({ x: Math.cos(i) * (i % 8), z: Math.sin(i) * (i % 8), mine: false }));
  const spaced = paintStamp(t, 0, 0, one, others, flat, brushRandom(10), 0);
  ok(spaced.every((p) => others.every((o) => d2(p, o) >= t.spacing * t.spacing)), `the spacing holds against everything standing (${spaced.length} planted among 30 others)`);
  ok(paintStamp(tune({ randomYaw: false }), 0, 0, one, [], flat, brushRandom(7), 1.25).every((p) => p.yaw === 1.25), "with the turn not drawn, each takes the camera's heading");
}

{
  // The filters.
  const t = tune();
  const slope = (deg: number): BrushGround => ({ ground: (x) => x * Math.tan((deg * Math.PI) / 180), water: () => Number.NaN, blocked: () => false });
  ok(paintStamp(t, 0, 0, one, [], slope(40), brushRandom(1), 0).length === 0, 'ground steeper than the slope filter takes nothing');
  ok(paintStamp(tune({ slopeMax: 45 }), 0, 0, one, [], slope(40), brushRandom(1), 0).length > 0, 'and the filter opened takes it');
  ok(paintStamp(tune({ slopeMin: 10 }), 0, 0, one, [], flat, brushRandom(1), 0).length === 0, 'flat ground under a least slope takes nothing');
  ok(paintStamp(tune({ heightOn: true, heightMin: 5, heightMax: 50 }), 0, 0, one, [], flat, brushRandom(1), 0).length === 0, 'ground outside the height filter takes nothing');
  ok(paintStamp(tune({ heightOn: true, heightMin: -5, heightMax: 5 }), 0, 0, one, [], flat, brushRandom(1), 0).length > 0, 'and within it, as before');
  const wet: BrushGround = { ground: () => 0, water: () => 1, blocked: () => false };
  ok(paintStamp(t, 0, 0, one, [], wet, brushRandom(1), 0).length === 0, 'the drawn water takes nothing');
  ok(paintStamp(t, 0, 0, [{ key: 'reeds', weight: 1, water: true }], [], wet, brushRandom(1), 0).length > 0, 'unless the entry is meant for the water');
  ok(paintStamp(tune({ keepOffWater: false }), 0, 0, one, [], wet, brushRandom(1), 0).length > 0, 'or the filter is off');
  const unknown: BrushGround = { ground: () => Number.NaN, water: () => Number.NaN, blocked: () => false };
  ok(paintStamp(t, 0, 0, one, [], unknown, brushRandom(1), 0).length === 0, 'ground not known takes nothing');
  const blocked: BrushGround = { ground: () => 0, water: () => Number.NaN, blocked: (x) => x > 0 };
  const kept = paintStamp(t, 0, 0, one, [], blocked, brushRandom(1), 0);
  ok(kept.length > 0 && kept.every((p) => p.x <= 0), 'and nothing inside what stands');
  // What stands, by its turned box: a box 4 m across at (3, 0), turned a quarter, and a row of its own not boxed.
  const near: BrushNearThing[] = [
    { x: 3, z: 0, mine: false, box: { min: [-2, 0, -1], max: [2, 3, 1] }, q: [0, Math.SQRT1_2, 0, Math.SQRT1_2] },
    { x: -3, z: 0, mine: true, box: { min: [-2, 0, -2], max: [2, 3, 2] }, q: [0, 0, 0, 1] },
  ];
  ok(blockedAt(near, 3, 1.5) && !blockedAt(near, 4.5, 0) && !blockedAt(near, -3, 0), "a point inside what stands is blocked by its box as it is turned, a row of the brush's own is spaced and never boxed");
}

{
  // The same seed over the same ground gives the same rows.
  const t = tune({ density: 6 });
  const a = paintStamp(t, 3, -2, one, [], flat, brushRandom(1234), 0);
  const b = paintStamp(t, 3, -2, one, [], flat, brushRandom(1234), 0);
  const c = paintStamp(t, 3, -2, one, [], flat, brushRandom(1235), 0);
  ok(a.length > 4 && JSON.stringify(a) === JSON.stringify(b), `the same seed plants the same rows (${a.length})`);
  ok(JSON.stringify(a) !== JSON.stringify(c), 'and another seed others');
}

{
  // An erase stamp: its own rows in the disc, each with the chance `eraseShare`.
  const near: BrushNear[] = [
    { x: 0, z: 0, mine: true },
    { x: 2, z: 2, mine: true },
    { x: 1, z: 0, mine: false },
    { x: 20, z: 0, mine: true },
  ];
  ok(JSON.stringify(eraseStamp({ radius: 8, eraseShare: 1 }, 0, 0, near, brushRandom(1))) === '[0,1]', 'the whole share takes every row of its own in the disc, none of anything else and none outside');
  ok(eraseStamp({ radius: 8, eraseShare: 0 }, 0, 0, near, brushRandom(1)).length === 0, 'a share of nought takes nothing');
  const many: BrushNear[] = Array.from({ length: 400 }, (_, i) => ({ x: (i % 20) * 0.3 - 3, z: Math.floor(i / 20) * 0.3 - 3, mine: true }));
  const n = eraseStamp({ radius: 8, eraseShare: 0.5 }, 0, 0, many, brushRandom(5)).length;
  ok(n > 160 && n < 240 && JSON.stringify(eraseStamp({ radius: 8, eraseShare: 0.5 }, 0, 0, many, brushRandom(5))) === JSON.stringify(eraseStamp({ radius: 8, eraseShare: 0.5 }, 0, 0, many, brushRandom(5))), `half the share takes about half (${n} of 400), the same half for the same seed`);
}

{
  // The stamps come at one rate whatever the frame rate.
  const over = (fps: number, seconds: number, rate: number) => {
    const clock = { owed: 0 };
    startClock(clock);
    let n = 0;
    let most = 0;
    const frames = Math.round(fps * seconds);
    for (let i = 0; i < frames; i++) {
      const k = stampsDue(clock, 1 / fps, rate);
      n += k;
      most = Math.max(most, k);
    }
    return { n, most, owed: clock.owed };
  };
  const at = [20, 60, 144].map((fps) => over(fps, 3, 8));
  ok(at.every((a) => Math.abs(a.n - (1 + 3 * 8)) <= 1), `a stroke of three seconds at 8 a second stamps ${at.map((a) => a.n).join(', ')} times at 20, 60 and 144 frames a second (${1 + 3 * 8} by the rate)`);
  const long = over(2, 3, 30);
  ok(long.most === 4 && long.owed <= 1, `and a long frame stamps at most four, carrying nothing past them (${long.owed} stamp owed after three half-second frames at 30 a second)`);
  const clock = { owed: 0 };
  startClock(clock);
  ok(stampsDue(clock, 0, 8) === 1, "a stroke's first frame stamps at once");
}

{
  // The ring: its points on the ground round the aim, those behind the eye said so.
  const vp = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, 0, 0]);
  // A plain projection down -Z from the origin: a point at z < 0 is in front, z > 0 behind.
  const at = { x: 0.5, z: 0.5, y: 0.5 };
  const g = {
    at,
    sample(): void {
      at.y = 2;
    },
  };
  const out = new Float64Array(RING_STEPS * 2);
  const vis = new Uint8Array(RING_STEPS);
  const a = ringAsk();
  a.cx = 0;
  a.cy = 0;
  a.cz = -20;
  a.radius = 8;
  a.w = 1600;
  a.h = 900;
  brushRing(a, g, vp, out, vis);
  ok(vis.every((v) => v === 1) && out.every((v) => Number.isFinite(v)), 'a ring in front of the eye is all shown');
  a.cz = 0;
  brushRing(a, g, vp, out, vis);
  const shown = vis.reduce((s, v) => s + v, 0);
  ok(shown > 0 && shown < RING_STEPS, `one about the eye is shown only where it is in front (${shown} of ${RING_STEPS})`);
}

{
  // A stroke through the real editing class: one undo entry, undone and done again byte for byte; an erase stroke after.
  const h = makeHarness({ rows: [propRow('keep', 40, 40)] });
  const said: string[] = [];
  const thing = 'chair';
  const host: BrushHost = {
    edits: h.e,
    source: async (key) => ({ key, id: thing, src: { kind: 'prop', pack: 'props', thing, template: 'object/tangible/test/shared_chair.iff' } as never, bounds: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }, water: false }),
    // The game's own rule for what stands near (`brushNearOf`, what `EditorEntry.brushNear` hands the world to).
    near: (cx, cz, reach, keys) => brushNearOf(worldOver(h), cx, cz, reach, keys),
    ground: () => 0,
    water: () => Number.NaN,
    centre: () => ({ x: 0, z: 0 }),
    frame: () => 'raw',
    packId: () => 'tatooine',
    inSpace: () => false,
    dest: () => 'world',
    cameraYaw: () => 0,
    say: (w) => said.push(w),
  };
  const brush = new EditorBrush(host);
  const was = { ...BRUSH_TUNE };
  Object.assign(BRUSH_TUNE, tune());
  try {
    ok(brush.toggle('props:chair') && brush.has('props:chair'), 'an entry chosen for the brush (a Shift+click)');
    await brush.arm(null);
    ok(brush.armed, 'armed with it');
    const before = h.files.world;
    const said1 = await brush.strokeAt(0, 0, 'paint', 3, 77);
    const rows = [...h.rowsOf('world').values()].filter((r) => r.id !== 'keep');
    const target = brushTarget(BRUSH_TUNE);
    ok(rows.length === target && /seed 77/.test(said1), `a stroke of three stamps planted ${rows.length} rows (the target ${target}: the first stamp filled it, the rest counted it)`);
    ok(h.e.history.actions.length === 1 && h.e.history.actions[0].label === 'paint' && h.e.history.actions[0].changes.length === target, 'and is one undo entry');
    ok(rows.every((r) => r.thing === 'chair' && r.pack === 'props' && (r.scale === undefined || (typeof r.scale === 'number' && r.scale >= 0.8 && r.scale <= 1.2))), 'each an ordinary row of the entry, at a scale of its own');
    const g0 = rows.map((r) => toGame(r as PlacementRow, { x: 0, z: 0 }, 'raw'));
    ok(g0.every((g) => g.x * g.x + g.z * g.z <= 64 + 1e-6), 'every one in the disc');
    const after = h.files.world;
    await h.e.undo(1);
    ok(h.files.world === before, 'undone, the file is as it was byte for byte');
    await h.e.redo(1);
    ok(h.files.world === after, 'done again, byte for byte');
    // The same seed again over the same ground, in another file: the same rows.
    const h2 = makeHarness({ rows: [propRow('keep', 40, 40)] });
    const b2 = new EditorBrush({ ...host, edits: h2.e, near: (cx, cz, reach, keys) => brushNearOf(worldOver(h2), cx, cz, reach, keys) });
    b2.toggle('props:chair');
    await b2.arm(null);
    await b2.strokeAt(0, 0, 'paint', 3, 77);
    const places = (m: Map<string, PlacementRow>) => [...m.values()].filter((r) => r.id !== 'keep').map((r) => `${r.x},${r.z},${r.q.join(',')},${r.scale ?? 1}`).sort().join(' ');
    ok(places(h2.rowsOf('world')) === places(h.rowsOf('world')), 'the same seed over the same ground gives the same rows');
    // A second stroke at the same place: the disc is full, nothing more.
    const said2 = await brush.strokeAt(0, 0, 'paint', 2, 78);
    ok([...h.rowsOf('world').values()].length === target + 1 && h.e.history.actions.length === 1, `a disc at its target takes nothing more, and records nothing (${said2})`);
    // Erased: every row of its own taken, the row that is not its own kept, one undo entry.
    const said3 = await brush.strokeAt(0, 0, 'erase', 1, 79);
    ok([...h.rowsOf('world').keys()].join(',') === 'keep' && h.e.history.actions.length === 2 && h.e.history.actions[1].label === 'erase', `an erase stroke takes its own rows and keeps the rest, one entry (${said3})`);
    await h.e.undo(1);
    ok(h.files.world === after, 'and undone, they stand again byte for byte');
    // The buttons: a stroke begun as the left button goes down and ended as it comes up, one entry.
    await h.e.undo(1);
    const a = brush.ask;
    a.cx = 0;
    a.cz = 0;
    a.valid = true;
    a.dt = 1 / 60;
    a.paint = true;
    for (let i = 0; i < 30; i++) {
      brush.frame();
      await h.settle();
    }
    ok(brush.mode === 'paint' && h.e.stroking, 'held, the left button paints a stroke');
    a.paint = false;
    brush.frame();
    await h.settle();
    ok(brush.mode === null && !h.e.stroking && h.e.history.actions.length === 1 && h.e.history.actions[0].label === 'paint' && [...h.rowsOf('world').values()].length === target + 1, 'let go, the stroke is one entry, at the target');
    brush.disarm();
    ok(!brush.armed, 'let go of');
  } finally {
    Object.assign(BRUSH_TUNE, was);
  }
}

{
  // What stands near, by the game's own rule (`brushNearOf`): a row is the brush's own by its library entry whatever its
  // id, in either file; another entry's row and a placed object are not, and only space it or keep it off; an erase takes
  // the destination file's own rows and nothing else; a paint writes into the destination file.
  const was = { ...BRUSH_TUNE };
  Object.assign(BRUSH_TUNE, tune({ density: 6 }));
  try {
    const h = makeHarness({ rows: [propRow('stool-a', 1, 0, { thing: 'stool' }), propRow('my-chair', -2, 0)], story: [propRow('story-chair', 0, 2)] });
    const rock: Thing = { template: 'object/tangible/test/shared_rock.iff', contained: false, x: -4, z: 4, q: { x: 0, y: 0, z: 0, w: 1 }, box: { min: [-1.5, 0, -1.5], max: [1.5, 2, 1.5] } };
    const keys = new Set(['props:chair']);
    const near = brushNearOf(worldOver(h, [rock]), 0, 0, 12, keys);
    const by = (id: string) => near.find((n) => n.id === id);
    ok(by('my-chair')?.mine === true && by('story-chair')?.mine === true && by('story-chair')?.layer === 'story' && by('stool-a')?.mine === false, "a chair row is the brush's own whatever its id and whichever file it is in, a stool row is not");
    ok(near.some((n) => !n.id && n.box === rock.box && !n.mine), 'and a placed object of the world is listed with its box, never its own');
    const dest: { file: PlacementLayer } = { file: 'world' };
    const brush = new EditorBrush(hostOver(h, { things: [rock], dest: () => dest.file }));
    brush.toggle('props:chair');
    await brush.arm(null);
    const target = brushTarget(BRUSH_TUNE);
    await brush.strokeAt(0, 0, 'paint', 1, 11);
    const painted = [...h.rowsOf('world').values()].filter((r) => r.thing === 'chair' && r.id !== 'my-chair');
    ok(painted.length === target - 2, `the brush's own rows in the disc are counted toward its target, in both files (${painted.length} planted of ${target}, two standing)`);
    const games = painted.map((r) => h.gameOf(r.id)!);
    const stool = h.gameOf('stool-a')!;
    ok(games.every((g) => d2(g, stool) >= BRUSH_TUNE.spacing ** 2 - 1e-6), "another entry's row spaces the plants");
    ok(games.every((g) => !(Math.abs(g.x - rock.x) <= 1.5 && Math.abs(g.z - rock.z) <= 1.5)), 'and none stands inside the placed object\'s box');
    await brush.strokeAt(0, 0, 'erase', 1, 12);
    ok(h.rowsOf('world').has('stool-a') && h.rowsOf('story').has('story-chair') && ![...h.rowsOf('world').values()].some((r) => r.thing === 'chair'), "an erase stroke takes the destination file's own rows and keeps another entry's and the other file's");
    dest.file = 'story';
    await brush.strokeAt(0, 0, 'paint', 1, 13);
    ok([...h.rowsOf('story').values()].filter((r) => r.thing === 'chair' && r.id !== 'story-chair').length === target - 1 && ![...h.rowsOf('world').values()].some((r) => r.thing === 'chair'), 'and a paint writes into the destination file');
  } finally {
    Object.assign(BRUSH_TUNE, was);
  }
}

{
  // The stamp's reach takes in what stands past the disc within the spacing: a ring of another entry's rows just outside
  // it is spaced from as everything inside is.
  const was = { ...BRUSH_TUNE };
  Object.assign(BRUSH_TUNE, tune({ density: 20, tries: 20 }));
  try {
    const ring = Array.from({ length: 56 }, (_, i) => propRow(`ring${i}`, Math.cos((i / 56) * Math.PI * 2) * 8.6, Math.sin((i / 56) * Math.PI * 2) * 8.6, { thing: 'stool' }));
    const h = makeHarness({ rows: ring });
    const brush = new EditorBrush(hostOver(h));
    brush.toggle('props:chair');
    await brush.arm(null);
    await brush.strokeAt(0, 0, 'paint', 1, 21);
    const plants = [...h.rowsOf('world').values()].filter((r) => r.thing === 'chair').map((r) => h.gameOf(r.id)!);
    const rings = ring.map((r) => h.gameOf(r.id)!);
    const near = plants.filter((p) => Math.hypot(p.x, p.z) > 6);
    ok(near.length > 0 && plants.every((p) => rings.every((r) => d2(p, r) >= BRUSH_TUNE.spacing ** 2 - 1e-6)), `no plant stands within the spacing of a row just outside the disc (${plants.length} planted, ${near.length} near its edge)`);
  } finally {
    Object.assign(BRUSH_TUNE, was);
  }
}

{
  // A thing stands by its box's lowest point on the ground at its scale; leaned to the ground with `align`; a building by
  // its origin at its own size, never leaned, with its patch's plants kept off.
  const was = { ...BRUSH_TUNE };
  try {
    Object.assign(BRUSH_TUNE, tune({ scaleMin: 1.5, scaleMax: 1.5 }));
    const h = makeHarness({});
    const deep = new EditorBrush(hostOver(h, { src: { bounds: { min: [-0.5, -2, -0.5], max: [0.5, 1, 0.5] } } }));
    deep.toggle('props:chair');
    await deep.arm(null);
    await deep.strokeAt(0, 0, 'paint', 1, 31);
    const rows = [...h.rowsOf('world').values()];
    ok(rows.length > 0 && rows.every((r) => Math.abs(r.y - 3) < 2e-3 && r.scale === 1.5), `a box reaching 2 m under its origin, at a scale of 1.5, stands 3 m up so its lowest point is on the ground (${rows.map((r) => r.y).join(', ')})`);
    const tilt = Math.tan((10 * Math.PI) / 180);
    Object.assign(BRUSH_TUNE, tune({ align: true, alignMax: 10, slopeMax: 30 }));
    const h2 = makeHarness({});
    const leaned = new EditorBrush(hostOver(h2, { ground: (x) => x * tilt }));
    leaned.toggle('props:chair');
    await leaned.arm(null);
    await leaned.strokeAt(0, 0, 'paint', 1, 32);
    const lr = [...h2.rowsOf('world').values()];
    ok(lr.length > 0 && lr.every((r) => Math.abs(r.q[1]) + Math.abs(r.q[3]) > 0.02), `with align on, on ground 10° steep every plant is leaned toward it (${lr.length} planted)`);
    Object.assign(BRUSH_TUNE, tune({ align: true, alignMax: 10, slopeMax: 30, scaleMin: 0.8, scaleMax: 1.2 }));
    const h3 = makeHarness({});
    const houses = new EditorBrush(hostOver(h3, { ground: (x) => x * tilt, src: { id: 'house', src: { kind: 'building', pack: 'gallery', model: 'house', template: 'object/building/player/shared_test_house.iff' } as never, bounds: { min: [-10, -16, -10], max: [10, 8, 10] }, building: true, clear: 12.5 } }));
    houses.toggle('buildings:house');
    await houses.arm(null);
    await houses.strokeAt(0, 0, 'paint', 1, 33);
    const hr = [...h3.rowsOf('world').values()];
    const ground = (r: PlacementRow) => h3.gameOf(r.id)!.x * tilt;
    ok(hr.length > 0 && hr.every((r) => r.kind === 'building' && Math.abs(r.y - ground(r)) < 2e-3), `a building stands by its origin on the ground, never by its box 16 m under it (${hr.map((r) => r.y.toFixed(2)).join(', ')})`);
    ok(hr.every((r) => r.scale === undefined && Math.abs(r.q[1]) < 1e-9 && Math.abs(r.q[3]) < 1e-9 && r.clear === 12.5), 'at its own size, turned about up alone, with its patch kept clear of plants');
  } finally {
    Object.assign(BRUSH_TUNE, was);
  }
}

{
  // While the brush is armed no click picks, no drag boxes and the right button does not orbit (the editing's own frame,
  // through the real editing class).
  let armed = false;
  const fly = makeHarness({ rows: [propRow('a', 0, 0)], brushArmed: () => armed });
  fly.e.sel.pick(['a'], 'set');
  fly.input.heldActs.add('altAttack');
  fly.step();
  const orbitsUnarmed = (fly.e as unknown as { orbiting: boolean }).orbiting;
  armed = true;
  fly.step();
  const orbitsArmed = (fly.e as unknown as { orbiting: boolean }).orbiting;
  ok(orbitsUnarmed && !orbitsArmed, 'the right button orbits the selection in Fly, but not with the brush armed (it erases)');
  armed = false;
  const point = makeHarness({ rows: [propRow('a', 0, 0)], point: true, brushArmed: () => armed });
  const press = () => {
    point.pointer.pressed = 1;
    point.pointer.buttons = 1;
    point.step();
  };
  press();
  const boxesUnarmed = (point.e as unknown as { boxing: boolean }).boxing;
  point.pointer.buttons = 0;
  point.pointer.released = 1;
  point.step();
  armed = true;
  press();
  const boxesArmed = (point.e as unknown as { boxing: boolean }).boxing;
  point.pointer.buttons = 0;
  point.step();
  ok(boxesUnarmed && !boxesArmed, 'a press on empty ground in Point begins a box, but not with the brush armed (it paints)');
  point.e.sel.pick(['a'], 'set');
  point.pointer.clicked = true;
  point.step();
  ok(point.e.sel.size === 1, 'a click with the brush armed picks nothing and lets nothing go');
  armed = false;
  point.pointer.clicked = true;
  point.step();
  ok(point.e.sel.size === 0, 'and unarmed, the same click on empty ground lets the selection go');
}

{
  // The brush's frame and its ring make nothing (twelve processes at once, each asserted).
  const file = fileURLToPath(new URL('./editorAllocOwn.ts', import.meta.url));
  const run = () =>
    new Promise<{ frames: number; made: number; scavenges: number; ringShown: number; armed: boolean; stroke: string | null; skipped?: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', file, 'brush'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('close', (code) => {
        const line = out.trim().split('\n').pop() ?? '';
        if (code !== 0) {
          const lines = err.trim().split('\n');
          reject(new Error(`the allocation child exited ${code}: ${lines.find((l) => /Error/.test(l))?.trim() ?? lines.pop() ?? line}`));
          return;
        }
        try {
          resolve(JSON.parse(line));
        } catch {
          reject(new Error(`the allocation child printed nothing that reads: ${line || '(nothing)'}`));
        }
      });
    });
  const all = await Promise.all(Array.from({ length: 12 }, run));
  const skipped = all.find((a) => a.skipped);
  if (skipped) console.log(`note the allocation measure was skipped: ${skipped.skipped}`);
  else
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      ok(a.armed && a.stroke === null && a.ringShown > 0 && a.scavenges === 0 && a.made < 0.1 * a.frames, `process ${i + 1} of 12: the armed brush's frame and its ring make ${Math.max(0, a.made)} bytes over ${a.frames} frames (${a.scavenges} collections, ${a.ringShown} ring points shown)`);
    }
}

console.log(`\n${checks} checks passed`);
