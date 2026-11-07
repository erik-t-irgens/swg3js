// The race drawer's second wave: a course action carries what it moved (DESIGN.md §2.7, §2.11). The real Course tool over
// the real editing (`courseRig.ts`): a row of ours set on the ground where a course is drawn is carried by the carve's change
// under it, in the course's own batch, and one undo puts both back byte for byte; a bridge standing over a crossing and a
// row under it are never carried; with `touchUps: 'keep'` the sculpt's deltas a moved stretch left are counted for the notes
// and left, and with `'clear'` written to nought in the same action, one undo putting all three back; Clear old touch-ups
// writes what was left as an action of its own.
//
// Run: node tools/swg/tests/courseCarry.test.ts
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { courseRig, idle, landFile, land, WORLD, type CourseRig } from './courseRig.ts';
import { courseCtx, drawTrack } from '../../../src/editor/courseEdit.ts';
import { trackFileText, type TrackDef } from '../../../src/race/trackFile.ts';
import { COURSE_TUNE } from '../../../src/race/courseTune.ts';
import { CourseCarve } from '../../../src/swg/terrain/courseCarve.ts';
import { deltaBytes, heightsFileText, tileIdOf } from '../../../src/world/editFiles/heightsFile.ts';
import type { PlacementRow } from '../../../src/story/placements.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const ctx = courseCtx(land);
/** A straight-ish sprint along raw x at z 0, 10 m over the land. */
const sprint = (): TrackDef => ({ ...(drawTrack('run', 'Run', [{ x: -150, z: 0, y: land(-150, 0) + 10 }, { x: 0, z: 2, y: land(0, 2) + 10 }, { x: 150, z: 0, y: land(150, 0) + 10 }], false, ctx) as TrackDef), at: 1_700_000_000_000 });
const row = (id: string, x: number, z: number, y: number): PlacementRow => ({ id, kind: 'prop', pack: 'world', model: 'crate', x, y, z, q: [1, 0, 0, 0], ground: y, at: 1_700_000_000_000 }) as PlacementRow;
// (Each row carries its own moment: a row with none is put back by an undo stamped with the undo's, by design.)
const carveAt = (tracks: TrackDef[], x: number, z: number): number => {
  const s = new CourseCarve();
  s.set(tracks);
  return s.carveAt(land(x, z), x, z);
};
const rowOf = (r: CourseRig, id: string): PlacementRow => r.h.rowsOf('world').get(id)!;

// ---------------------------------------------------------------- 1. a row on the ground carried with the course

{
  const t = sprint();
  // A crate on the road's line and one on its shoulder, on the raw ground; one far off.
  const r = courseRig({ rows: [row('on-road', 40, 1, land(40, 1)), row('on-shoulder', -60, 15, land(-60, 15)), row('far', 400, 400, land(400, 400))] });
  await r.c.arm();
  const before = { tracks: r.h.files.tracks ?? null, world: r.h.files.world };
  const said = await r.c.write('Run drawn', null, t);
  await idle(r);
  const now = r.tracks();
  const onRoad = rowOf(r, 'on-road');
  const onShoulder = rowOf(r, 'on-shoulder');
  const wantRoad = carveAt(now, 40, 1);
  const wantShoulder = carveAt(now, -60, 15);
  ok(r.c.last.ok && Math.abs(onRoad.y - wantRoad) < 0.002 && Math.abs((onRoad.ground ?? 0) - wantRoad) < 0.002, `a row of ours on the road's line is carried to the road (${onRoad.y.toFixed(3)} m, the carve ${wantRoad.toFixed(3)}): ${said}`);
  ok(Math.abs(onShoulder.y - wantShoulder) < 0.002 && onShoulder.y > land(-60, 15) + 0.1, `and one on its shoulder by the carve's change under it (${(onShoulder.y - land(-60, 15)).toFixed(3)} m up)`);
  ok(rowOf(r, 'far').y === land(400, 400) && r.c.carried.rows === 2, 'a row the change does not reach stays where it stood; two carried');
  ok(r.h.e.history.actions.length === 1 && r.h.batches.length === 1 && r.h.batches[0].length === 3, "all in the course's own batch: one write, one action (the track and the two rows)");
  await r.h.e.undo(1);
  await idle(r);
  ok((r.h.files.tracks ?? null) === before.tracks && r.h.files.world === before.world, 'one undo puts the course and the rows back byte for byte');
  await r.h.e.redo(1);
  await idle(r);
  ok(Math.abs(rowOf(r, 'on-road').y - wantRoad) < 0.002 && r.tracks().length === 1, 'and a redo carries them again');
  r.c.disarm();
}

// ---------------------------------------------------------------- 2. a bridge over a crossing, and a row under it, never carried

{
  const e8 = drawTrack('eight', 'Eight', [{ x: -180, z: 0, y: 3 }, { x: -90, z: 90, y: 8 }, { x: 90, z: -90, y: 8 }, { x: 180, z: 0, y: 3 }, { x: 90, z: 90, y: 0 }, { x: -90, z: -90, y: 0 }], true, courseCtx(() => 0)) as TrackDef;
  const text = trackFileText(WORLD, 'raw', [e8]);
  // A bridge on the deck at the crossing, a row on the lower road under it, a row on the lower road clear of the deck, and a
  // row on the ground beside the far loop.
  const was = (): TrackDef[] => r.tracks();
  const r = courseRig({ tracks: text, rows: [row('bridge', 0, 0, 8), row('under', 2, 2, 0), row('plain', 40, 40, 0), row('beside', -195, 0, land(-195, 0))] });
  landFile(r);
  await r.c.arm();
  r.c.pick('eight');
  // The lower road lowered 2 m (nodes 4 and 5), and node 0 moved 20 m out. The carve under a crossing is the lower road's,
  // so only a change of the lower road moves the ground under the bridge: with the guard gone, both rows would be carried.
  const moved: TrackDef = JSON.parse(JSON.stringify(r.tracks()[0]));
  const ns = moved.course!.paths[0].nodes;
  ns[0] = { ...ns[0], x: ns[0].x - 20 };
  ns[4] = { ...ns[4], y: ns[4].y - 2 };
  ns[5] = { ...ns[5], y: ns[5].y - 2 };
  const under = (x: number, z: number): number => carveAt([moved], x, z) - carveAt(was(), x, z);
  const u0 = under(0, 0);
  const u2 = under(2, 2);
  const u40 = under(40, 40);
  ok(Math.abs(u0) > 1 && Math.abs(u2) > 1 && Math.abs(u40) > 1, `the change moves the ground under the bridge and the row beneath it (${u0.toFixed(2)} m, ${u2.toFixed(2)} m): the precondition, so only the guard can hold them`);
  await r.c.write('lower road lowered', r.tracks()[0], moved);
  await idle(r);
  ok(rowOf(r, 'bridge').y === 8 && rowOf(r, 'under').y === 0, 'a bridge over the crossing and a row under it are never carried');
  ok(Math.abs(rowOf(r, 'plain').y - (0 + u40)) < 0.002, `a row on the lower road clear of the deck is carried by the change under it (to ${rowOf(r, 'plain').y.toFixed(3)} m)`);
  ok(r.c.carried.rows >= 2 && rowOf(r, 'beside').y !== land(-195, 0), `and a row on the ground beside the far loop the change moved (${r.c.carried.rows} carried)`);
  r.c.disarm();
}

// ---------------------------------------------------------------- 3. the touch-ups a moved stretch leaves

{
  const t = sprint();
  // A sculpt's deltas over the whole of tile (1, 0) (raw x 64 to 126, z 0 to 62), each pole's its own past `touchNote`, the
  // first row under it. The road moved 30 m to +z, so the tile holds poles under the old reach only (the touch-ups), under
  // both reaches (the road still covers them), under the new alone, and under neither: only the first kind is a touch-up.
  const d = new Float32Array(32 * 32);
  for (let k = 0; k < d.length; k++) d[k] = Math.floor(k / 32) === 0 ? 0.3 : 1.5 + (k % 7) * 0.01;
  const heights = heightsFileText(WORLD, [{ id: tileIdOf(1, 0), d: deflateRawSync(Buffer.from(deltaBytes(d))).toString('base64'), on: '00000000', at: 1_700_000_000_000 }]);
  const SHIFT = 30;
  // The poles' classes by the stores of the course before and after, as the tool reads them (`sampleAt`, a weight over nought).
  const classes = (before: TrackDef, after: TrackDef): { want: boolean[]; old: number; both: number; fresh: number; none: number } => {
    const sB = new CourseCarve();
    sB.set([before]);
    const sA = new CourseCarve();
    sA.set([after]);
    const s = { T: 0.5, W: 0.5 };
    const want: boolean[] = [];
    let old = 0;
    let both = 0;
    let fresh = 0;
    let none = 0;
    for (let k = 0; k < d.length; k++) {
      const x = 64 + (k % 32) * 2;
      const z = Math.floor(k / 32) * 2;
      const b = sB.sampleAt(x, z, s).W > 0;
      const a = sA.sampleAt(x, z, s).W > 0;
      if (b && !a) old++;
      else if (b && a) both++;
      else if (a) fresh++;
      else none++;
      want.push(b && !a && Math.abs(d[k]) > COURSE_TUNE.touchNote);
    }
    return { want, old, both, fresh, none };
  };
  /** Every pole of tile (1, 0) as the heights file holds it now: nought where it is a touch-up, its own bits elsewhere. */
  const poleWise = (r: CourseRig, want: boolean[]): { wrong: number; zeroed: number } => {
    const now = r.heights().tile(1, 0);
    let wrong = 0;
    let zeroed = 0;
    for (let k = 0; k < d.length; k++) {
      const v = now ? now[k] : 0;
      if (want[k]) {
        if (v !== 0) wrong++;
        else zeroed++;
      } else if (!Object.is(v, d[k])) wrong++;
    }
    return { wrong, zeroed };
  };
  for (const mode of ['keep', 'clear'] as const) {
    const was = COURSE_TUNE.touchUps;
    COURSE_TUNE.touchUps = mode;
    try {
      const r = courseRig({ tracks: trackFileText(WORLD, 'raw', [t]), heights, rows: [row('carried', 100, 32, land(100, 32))] });
      landFile(r);
      await r.c.arm();
      r.c.pick('run');
      const before = { tracks: r.h.files.tracks ?? null, world: r.h.files.world, heights: r.h.files.heights ?? null };
      // The whole road moved 30 m to +z: the old reach and the new overlap inside the tile.
      const moved: TrackDef = JSON.parse(JSON.stringify(r.tracks()[0]));
      for (const n of moved.course!.paths[0].nodes) n.z += SHIFT;
      const cl = classes(r.tracks()[0], moved);
      const count = cl.want.filter(Boolean).length;
      ok(cl.old > 0 && cl.both > 0 && cl.fresh > 0 && cl.none > 0 && count > 0, `the tile holds poles of all four kinds (${cl.old} under the old reach alone, ${cl.both} under both, ${cl.fresh} under the new alone, ${cl.none} under neither): the precondition`);
      await r.c.write('moved', r.tracks()[0], moved);
      await idle(r);
      if (mode === 'keep') {
        ok(r.c.carried.touchLeft === count && (r.h.files.heights ?? null) === before.heights && r.c.notes.some((n) => /touch-ups left/.test(n)), `with touch-ups kept, exactly the ${count} poles under the old reach alone past touchNote are counted in the notes and left in the heights file`);
        const cleared = await r.c.clearTouchUps();
        await idle(r);
        const pw = poleWise(r, cl.want);
        ok(/written to nought/.test(cleared) && pw.wrong === 0 && pw.zeroed === count && r.h.e.history.actions.length === 2, `Clear old touch-ups writes exactly those to nought as an action of its own, every other pole of the tile kept to the bit (${cleared})`);
        ok(r.c.carried.touchLeft === 0 && !r.c.notes.some((n) => /touch-ups left/.test(n)) && /no touch-up left standing/.test(await r.c.clearTouchUps()), 'and once cleared the notes name them no longer, nor is there anything left to clear');
        await r.h.e.undo(1);
        await idle(r);
        ok((r.h.files.heights ?? null) === before.heights, 'and its undo puts them back');
      } else {
        const pw = poleWise(r, cl.want);
        ok(r.c.carried.cleared === count && pw.wrong === 0 && pw.zeroed === count && r.h.e.history.actions.length === 1, `with touch-ups cleared, exactly the ${count} poles under the old reach alone are written to nought in the course's own action, those under both reaches, the new alone and neither kept to the bit`);
        ok(Math.abs(rowOf(r, 'carried').y - land(100, 32)) > 0.01, 'the row the moved road now reaches carried in the same action');
        await r.h.e.undo(1);
        await idle(r);
        ok((r.h.files.tracks ?? null) === before.tracks && r.h.files.world === before.world && (r.h.files.heights ?? null) === before.heights, 'one undo puts all three back byte for byte (the course, the row, the heights)');
      }
      r.c.disarm();
    } finally {
      COURSE_TUNE.touchUps = was;
    }
  }
  // The touch-ups a move left are its world's: the world going (with the editor on, `worldGone`; or off, the next use finds
  // the mark moved), Clear old touch-ups writes nothing into the next world's heights file, whose tile of the same id holds
  // the owner's own sculpt there. Through the tool's own entries the world's going is found first and the touch-ups let go
  // (`worldGone`, "no touch-up left"); the method asked straight, before anything has found the world gone, refuses them
  // itself ("left on another world"). Each guard is held apart, so neither passes for the other.
  for (const way of ['act', 'debug', 'direct'] as const) {
    const was = COURSE_TUNE.touchUps;
    COURSE_TUNE.touchUps = 'keep';
    try {
      const r = courseRig({ tracks: trackFileText(WORLD, 'raw', [t]), heights });
      landFile(r);
      await r.c.arm();
      r.c.pick('run');
      const moved: TrackDef = JSON.parse(JSON.stringify(r.tracks()[0]));
      for (const n of moved.course!.paths[0].nodes) n.z += SHIFT;
      await r.c.write('moved', r.tracks()[0], moved);
      await idle(r);
      const left = r.c.carried.touchLeft;
      r.h.nextWorld();
      const other = new Float32Array(32 * 32).fill(3);
      const next = heightsFileText(WORLD, [{ id: tileIdOf(1, 0), d: deflateRawSync(Buffer.from(deltaBytes(other))).toString('base64'), on: '00000000', at: 1_700_000_000_000 }]);
      r.h.files.heights = next;
      const actions = r.h.e.history.actions.length;
      const said = way === 'act' ? await r.c.act('course:clearTouchUps') : way === 'debug' ? (await r.c.debug({ clearTouchUps: true })).said.join('; ') : await r.c.clearTouchUps();
      await idle(r);
      const words = way === 'direct' ? /left on another world/ : /no touch-up left standing/;
      ok(left > 0 && r.h.files.heights === next && r.h.e.history.actions.length <= actions && r.c.carried.touchLeft === 0 && !/written to nought/.test(said) && words.test(said), `${way}: the touch-ups a move left on one world (${left}) are never cleared into the next world's heights file (${said})`);
      r.c.disarm();
    } finally {
      COURSE_TUNE.touchUps = was;
    }
  }
  // The list holds only while the course it was measured against stands: the tool's own landing keeps it, a landing that
  // moves the course (an undo) lets it go, and so does a clear whose tiles have gone. A refused clear and one whose write
  // throws keep it, end their stroke, and leave the undo free.
  {
    const was = COURSE_TUNE.touchUps;
    COURSE_TUNE.touchUps = 'keep';
    try {
      const moveOnce = async (): Promise<CourseRig> => {
        const r = courseRig({ tracks: trackFileText(WORLD, 'raw', [t]), heights });
        landFile(r);
        await r.c.arm();
        r.c.pick('run');
        const moved: TrackDef = JSON.parse(JSON.stringify(r.tracks()[0]));
        for (const n of moved.course!.paths[0].nodes) n.z += SHIFT;
        await r.c.write('moved', r.tracks()[0], moved);
        await idle(r);
        return r;
      };
      const named = (r: CourseRig): boolean => r.c.notes.some((n) => /touch-ups left/.test(n));
      {
        const r = await moveOnce();
        const left = r.c.carried.touchLeft;
        r.c.landed();
        ok(left > 0 && r.c.carried.touchLeft === left && named(r), `the tool's own write landing keeps the ${left} touch-ups it measured`);
        await r.h.e.undo(1);
        await idle(r);
        r.c.landed();
        const heightsNow = r.h.files.heights ?? null;
        const said = await r.c.clearTouchUps();
        ok(r.c.carried.touchLeft === 0 && !named(r) && /no touch-up left standing/.test(said) && (r.h.files.heights ?? null) === heightsNow, `an undo that moves the course back lets them go: the notes name none and Clear old touch-ups writes nothing (${said})`);
        r.c.disarm();
      }
      {
        const r = await moveOnce();
        r.h.files.heights = null;
        const said = await r.c.clearTouchUps();
        ok(/no touch-up left to clear/.test(said) && r.c.carried.touchLeft === 0 && !named(r) && /no touch-up left standing/.test(await r.c.clearTouchUps()), `a clear whose tiles have gone lets the list go with the notes' line (${said})`);
        r.c.disarm();
      }
      for (const how of ['refused', 'thrown'] as const) {
        const r = await moveOnce();
        const left = r.c.carried.touchLeft;
        const host = r.h.host as unknown as { batch: (...a: unknown[]) => Promise<unknown> };
        const real = host.batch;
        host.batch = how === 'refused'
          ? async () => ({ ok: false, why: 'refused for the test', files: {}, ms: 0, built: Promise.resolve() })
          : async () => {
              throw new Error('thrown for the test');
            };
        const heightsNow = r.h.files.heights ?? null;
        let said = '';
        try {
          said = await r.c.clearTouchUps();
        } catch (e) {
          said = `threw out: ${String(e)}`;
        }
        await idle(r);
        host.batch = real;
        ok(!/threw out/.test(said) && !/written to nought/.test(said) && (r.h.files.heights ?? null) === heightsNow && r.c.carried.touchLeft === left && named(r), `a ${how} clear keeps the ${left} touch-ups, the notes still naming them (${said})`);
        ok(!r.h.e.stroking && (r.c as unknown as { writing: unknown }).writing === null, `and ends its stroke and its write, so nothing holds the undo after it (${how})`);
        const again = await r.c.clearTouchUps();
        await idle(r);
        ok(/written to nought/.test(again) && r.c.carried.touchLeft === 0, `so the next clear still writes them (${again})`);
        r.c.disarm();
      }
    } finally {
      COURSE_TUNE.touchUps = was;
    }
  }
}

console.log(`\ncourseCarry: ${checks} checks passed`);
