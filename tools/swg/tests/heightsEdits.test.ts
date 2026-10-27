// A sculpt stroke written and undone (Map-maker II, DESIGN.md §2.4), through the brush's real glue (`EditorSculpt`) round the
// real editing class (`editsHarness.ts`, whose every write is the endpoint's own batch on file texts), every answer landed
// into the store by the world's own rules (`heightsLand.ts`: the rows kept at once, the tiles inflated, laid by difference,
// none a stroke under way holds touched) and the brush naming each tile by those rows (as `World.heightRows`), never by the
// file's text: a stroke is one action and one batch however many stamps it took; undone and done again, the heights file is
// back byte for byte each way (a tile the stroke made gone with its file); carry writes the rows it moves and the tiles in
// one batch, one undo putting both back.
//
// Then the two the fix round found: a second stroke begun while the first's answer is still being inflated keeps every pole
// it stamped (the answer is never laid over a tile the stroke holds), in the drawn store and in the file it writes; and carry
// reads a row's place in the file's own frame, held where the game's frame is a shift as well as a mirror and the stroke is
// off to one side.
//
// Run: node tools/swg/tests/heightsEdits.test.ts
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { makeHarness, propRow } from './editsHarness.ts';
import { EditorSculpt, type SculptHost } from '../../../src/editor/editorSculpt.ts';
import { SCULPT_TUNE } from '../../../src/editor/editorTune.ts';
import { toolFrame } from '../../../src/editor/tools.ts';
import { HeightEdits } from '../../../src/swg/terrain/heightEdits.ts';
import { deltasOf, readHeightsFile, tileOfId, type HeightTileRow } from '../../../src/world/editFiles/heightsFile.ts';
import { decodeLanded, HeightRows, layLanded } from '../../../src/world/editFiles/heightsLand.ts';
import { inflateTile } from './editsHarness.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const was = { ...SCULPT_TUNE };
const RAW = 10;

/** The world's side of the heights, as `World.landHeights` runs it: its store, its rows, and how long the tiles take to inflate. */
interface Ground {
  store: HeightEdits;
  rows: HeightRows;
  sculpt: EditorSculpt | null;
  /** Milliseconds the next landing's inflate takes (the browser's stream is a task or more). */
  delay: number;
  held: number;
  land(put: unknown[], deleted: string[]): Promise<number>;
}
function ground(): Ground {
  const g: Ground = {
    store: new HeightEdits(),
    rows: new HeightRows(),
    sculpt: null,
    delay: 0,
    held: 0,
    async land(put, deleted) {
      // `World.landHeights`'s order: the rows at once, the tiles inflated, then laid by difference past what a stroke holds.
      g.rows.land(put as HeightTileRow[], deleted);
      const wait = g.delay;
      const decoded = await decodeLanded(put as HeightTileRow[], deleted, async (b) => {
        if (wait) await new Promise((r) => setTimeout(r, wait));
        return inflateTile(b);
      }, deltasOf, tileOfId, () => {});
      const n = layLanded(g.store, decoded, (tx, tz) => !!g.sculpt?.holds(tx, tz), () => {});
      g.held += n.held;
      return n.moved;
    },
  };
  return g;
}
function hostOver(h: ReturnType<typeof makeHarness>, g: Ground, centreX = 0): SculptHost {
  return {
    edits: h.e,
    worldKind: () => 'ground',
    store: () => g.store,
    rawAt: () => RAW,
    // The game's frame: the file's raw frame mirrored in x about the centre (the harness's `toGame` for its rows).
    toRaw: (x, z, o) => {
      o.x = centreX - x;
      o.z = z;
    },
    toGame: (x, z, o) => {
      o.x = centreX - x;
      o.z = z;
    },
    changed: () => {},
    feet: () => {},
    standing: () => h.host.standing(),
    lowestOf: () => 0,
    fileRow: (id) => g.rows.get(id) ?? null,
    fileSize: () => ({ tiles: g.rows.size, bytes: g.rows.bytes }),
    deflate: async (b) => deflateRawSync(Buffer.from(b)).toString('base64'),
    beginWork: () => {},
    noteStamp: () => {},
    say: () => {},
  };
}
/** A tile's deltas as the file holds them now, or null. */
function fileTile(h: ReturnType<typeof makeHarness>, id: string): Float32Array | null {
  const text = h.files.heights;
  if (!text) return null;
  const row = readHeightsFile(text, 'tatooine', 'ground').rows.find((r) => r.id === id);
  if (!row) return null;
  const d = deltasOf(inflateTile(row.d));
  return typeof d === 'string' ? null : d;
}

try {
  SCULPT_TUNE.mode = 'raise';
  SCULPT_TUNE.radius = 30;
  SCULPT_TUNE.rate = 30;
  SCULPT_TUNE.carry = true;
  SCULPT_TUNE.keepOff = true;
  {
    // A crate of ours on the ground at the stroke's middle (its ground recorded as the file has it), and one off the ground.
    const g = ground();
    const h = makeHarness({ rows: [propRow('crate-1', -4, 2, { y: RAW, ground: RAW }), propRow('lamp-1', 3, -3, { y: RAW + 4, ground: RAW })], onHeights: (p, d) => g.land(p, d) });
    const s = new EditorSculpt(hostOver(h, g));
    g.sculpt = s;
    await s.arm();
    const f = toolFrame();
    f.valid = true;
    f.dt = 1 / 30;
    f.x = 0;
    f.z = 0;
    f.apply = true;
    for (let i = 0; i < 20; i++) s.frame(f);
    f.apply = false;
    s.frame(f);
    await h.settle();
    await h.settle();
    const tiles = h.files.heights ? readHeightsFile(h.files.heights, 'tatooine', 'ground', inflateTile).rows.length : 0;
    ok(h.e.history.actions.length === 1 && h.batches.length === 1, `a stroke of 20 stamps is one action and one batch (${tiles} tiles written)`);
    ok(tiles >= 1 && /"id": "0,0"/.test(h.files.heights ?? '') && /"id": "-1,-1"/.test(h.files.heights ?? ''), 'its tiles are written to the heights file');
    ok(g.rows.size === tiles && g.rows.bytes > 0, `the world's rows are the file's as it was written (${g.rows.size} tiles, about ${g.rows.bytes} bytes)`);
    const crate = h.rowOf('crate-1')!;
    const lamp = h.rowOf('lamp-1')!;
    ok(crate.y > RAW + 0.1 && Math.abs((crate.ground as number) - crate.y) < 0.001 && h.batches[0].some((e) => e.file === 'world'), `carry moved the crate standing on the ground with it, in the same batch (up ${(crate.y - RAW).toFixed(3)} m)`);
    ok(lamp.y === RAW + 4, 'and left the lamp standing off the ground where it was');
    const done = { ...h.files };
    await h.e.undo(1);
    await h.settle();
    ok(h.files.heights === null && h.rowOf('crate-1')!.y === RAW, 'undone, the heights file is gone (every tile the stroke made) and the crate back where it stood');
    ok(g.store.size === 0 && g.rows.size === 0, "and the undo's answer, landed by the world's rules, takes every tile out of the store and the rows");
    await h.e.redo(1);
    await h.settle();
    ok(h.files.heights === done.heights && h.files.world === done.world, 'done again, both files are what the stroke wrote, byte for byte');
    ok(g.store.size === tiles && g.rows.size === tiles, 'and the redo lands every tile back into the store and the rows');
    // A second stroke over the file the first wrote (the store as the redo landed it), then its undo: the file is the first's.
    f.apply = true;
    f.x = 20;
    for (let i = 0; i < 10; i++) s.frame(f);
    f.apply = false;
    s.frame(f);
    await h.settle();
    await h.settle();
    ok(h.e.history.actions.length === 2 && h.files.heights !== done.heights, 'a second stroke over the first changes the file');
    await h.e.undo(1);
    await h.settle();
    ok(h.files.heights === done.heights && h.files.world === done.world, "its undo puts the first stroke's file back byte for byte, every tile's own moment kept");
  }

  // The race: a stroke begun while the last one's answer is still inflating keeps every pole it stamped.
  {
    const g = ground();
    const h = makeHarness({ onHeights: (p, d) => g.land(p, d) });
    const s = new EditorSculpt(hostOver(h, g));
    g.sculpt = s;
    await s.arm();
    const f = toolFrame();
    f.valid = true;
    f.dt = 1 / 30;
    f.x = 0;
    f.z = 0;
    // Stroke A at the middle, its answer taking 60 ms to inflate.
    g.delay = 60;
    SCULPT_TUNE.radius = 30;
    f.apply = true;
    for (let i = 0; i < 20; i++) s.frame(f);
    f.apply = false;
    s.frame(f);
    await h.settle();
    const aMid = g.store.poleDelta(0, 0);
    // Stroke B begins at once (A's write has returned, its landing has not), stamps at the middle too.
    g.delay = 0;
    f.apply = true;
    for (let i = 0; i < 5; i++) s.frame(f);
    const bMid = g.store.poleDelta(0, 0);
    // A's answer lands now, under B.
    await new Promise((r) => setTimeout(r, 90));
    await h.settle();
    const midAfterLanding = g.store.poleDelta(0, 0);
    // B goes on 40 m off at a small radius (never reaching the middle again), then is let go and written.
    SCULPT_TUNE.radius = 8;
    f.x = -40;
    for (let i = 0; i < 5; i++) s.frame(f);
    f.apply = false;
    s.frame(f);
    await h.settle();
    await h.settle();
    SCULPT_TUNE.radius = 30;
    const written = fileTile(h, '0,0');
    ok(bMid > aMid + 0.1, `stroke B stamped over A at the middle before A's answer landed (${aMid.toFixed(3)} m to ${bMid.toFixed(3)} m)`);
    ok(g.held > 0 && Object.is(midAfterLanding, bMid), `A's answer, landing under B, leaves every tile B holds as B stamped it (${g.held} held)`);
    ok(!!written && Object.is(written[0], bMid) && h.e.history.actions.length === 2, `and B's file holds the poles B stamped before the landing (the middle at ${written?.[0].toFixed(3)} m), two actions`);
  }

  // Carry reads a row's place in the file's own frame: the game's frame a mirror and a shift (centre 250), the stroke to one side.
  {
    const C = 250;
    const g = ground();
    const h = makeHarness({ centre: { x: C, z: 0 }, rows: [propRow('crate-2', 25, 6, { y: RAW, ground: RAW })], onHeights: (p, d) => g.land(p, d) });
    const s = new EditorSculpt(hostOver(h, g, C));
    g.sculpt = s;
    await s.arm();
    const f = toolFrame();
    f.valid = true;
    f.dt = 1 / 30;
    // The stroke at raw (10, 0): game x = 250 - 10.
    f.x = C - 10;
    f.z = 0;
    f.apply = true;
    for (let i = 0; i < 15; i++) s.frame(f);
    f.apply = false;
    s.frame(f);
    const moved = g.store.bilinear(25, 6);
    await h.settle();
    await h.settle();
    const crate = h.rowOf('crate-2')!;
    ok(moved > 0.05 && Math.abs(crate.y - (RAW + moved)) < 0.0011 && Math.abs((crate.ground as number) - crate.y) < 0.001, `the crate on the stroke's flank is carried by the ground's move at its own raw place (${moved.toFixed(3)} m, written ${(crate.y - RAW).toFixed(3)} m)`);
  }
} finally {
  Object.assign(SCULPT_TUNE, was);
}

console.log(`\nheightsEdits: ${checks} checks passed`);
