// The world editor's river mode (Map-maker II's sixth wave, `src/editor/editorWater.ts`), driven as the editor drives it
// (its frames, then its overlay) over a stand-in host and a stand-in world that keeps the rows a write lands. Held here:
// a river's heights (each its own ground and a rise, or held level where the ground under it rises) and its banks drawn
// as one outline; a river by clicks, written by a click near its last point: one write, one undo entry, its spine into the
// raw frame to a centimetre and its heights to a millimetre, its width, velocity and shader the tool's, points nearer than
// the spacing merged; a steep reach said in each of the three modes' words, and under 'fall' a fall row of the placements
// file written in the same action; a move, a raise, a width, a velocity and a slope limit each one exact write, a limit
// past the backstop and a lava shader refused; a removal; the session's first water body behind the curtain.
//
// Run: node tools/swg/tests/riverTool.test.ts
import assert from 'node:assert/strict';
import { EditorWater, riverHeights, riverOutline, type WaterHost } from '../../../src/editor/editorWater.ts';
import { WATER_TUNE, WATER_TUNE_DEFAULTS, tuneWater } from '../../../src/editor/editorTune.ts';
import { toolFrame } from '../../../src/editor/tools.ts';
import { screenView } from '../../../src/editor/gizmo.ts';
import { marksView } from '../../../src/ui/editorMarks.ts';
import { RIVER_TUNE } from '../../../src/world/ourWater.ts';
import type { WaterLakeRow, WaterRiverRow } from '../../../src/world/editFiles/waterFile.ts';
import type { RowChange } from '../../../src/editor/undo.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const CX = 1000;
const CZ = -500;

function standIn(opts: { flatBuilt: boolean; ground: (x: number, z: number) => number }) {
  const s = {
    rows: [] as WaterLakeRow[],
    rivers: [] as WaterRiverRow[],
    writes: [] as RowChange[][],
    labels: [] as string[],
    strokes: 0,
    curtains: 0,
    flatBuilt: opts.flatBuilt,
    said: [] as string[],
    placed: [] as RowChange[],
  };
  const edits = {
    beginStroke: (label: string) => ({ label, changes: [] as RowChange[] }),
    async strokeWrite(es: { label: string; changes: RowChange[] }, changes: RowChange[]): Promise<string | null> {
      s.writes.push(changes);
      s.labels.push(es.label);
      es.changes.push(...changes);
      for (const c of changes) {
        if (c.file !== 'water') {
          s.placed.push(c);
          continue;
        }
        s.rows = s.rows.filter((r) => r.id !== c.id);
        s.rivers = s.rivers.filter((r) => r.id !== c.id);
        const after = c.after as WaterLakeRow | WaterRiverRow | null;
        if (after?.kind === 'river') s.rivers.push({ ...after, at: 1 });
        else if (after) s.rows.push({ ...after, at: 1 } as WaterLakeRow);
        s.flatBuilt = true;
      }
      return null;
    },
    endStroke: (es: { changes: RowChange[] }) => {
      s.strokes++;
      return `${es.changes.length} row${es.changes.length === 1 ? '' : 's'} written`;
    },
    mintIds: (bases: string[]) => bases.map((b, i) => `${b}-${s.placed.length + i + 1}`),
  };
  const host: WaterHost = {
    edits: edits as never,
    worldKind: () => 'ground',
    rows: () => s.rows,
    rivers: () => s.rivers,
    toRaw: (x, z, out) => {
      out.x = CX - x;
      out.z = CZ + z;
    },
    toGame: (x, z, out) => {
      out.x = CX - x;
      out.z = z - CZ;
    },
    groundAt: (x, z) => opts.ground(x, z),
    heightAt: (x, z) => opts.ground(x, z),
    seaLevel: () => -Infinity,
    isLava: (shader) => !!shader && /lava/.test(shader),
    wantsCurtain: (lava) => lava || !s.flatBuilt,
    async curtain(_detail, work) {
      s.curtains++;
      return await work();
    },
    fallSource: async (thing) => ({ src: { kind: 'prop', pack: 'props', thing, template: 'object/static/test/shared_fall.iff' }, bounds: { min: [6.6, 39.76, 6.28], max: [-5.7, -37.63, -3.4] } }),
    dest: () => 'world',
    centre: () => ({ x: CX, z: CZ }),
    frame: () => 'raw',
    packId: () => 'naboo',
    cameraYaw: () => 0,
    underNotes: () => [],
    say: (words) => {
      s.said.push(words);
    },
  };
  return Object.assign(s, { host });
}

const view = screenView();
const marks = marksView();
const draw = { marks, radius: 0.5, ring() {} };
function frame(w: EditorWater, f: Partial<ReturnType<typeof toolFrame>>): void {
  const t = toolFrame();
  Object.assign(t, { apply: false, inverse: false, shift: false, sampled: false, valid: true, dt: 1 / 60, now: 1, sx: 400, sy: 300, dy: 0, lift: false }, f);
  w.step(t);
  w.overlay(draw as never, view);
}
async function click(w: EditorWater, x: number, y: number, z: number): Promise<void> {
  frame(w, { apply: true, x, y, z });
  frame(w, { x, y, z });
  for (let i = 0; i < 6; i++) await Promise.resolve();
}
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const decimals = (n: number): number => (String(n).split('.')[1] ?? '').length;

// --- the heights and the banks ---
{
  const g = [10, 9, 9.5, 8, 8.4];
  ok(riverHeights(g, 'ground', 0.5).join() === '10.5,9.5,10,8.5,8.9', "'ground': each point at its own ground and the rise");
  ok(riverHeights(g, 'level', 0.5).join() === '10.5,9.5,9.5,8.5,8.5', "'level': a point never higher than the one before it, so a reach where the ground rises is held level");
  ok(Number.isNaN(riverHeights([1, Number.NaN], 'level', 0)[1]), 'an unknown ground is unknown');
  const o = riverOutline([{ x: 0, z: 0, h: 5 }, { x: 10, z: 0, h: 4 }, { x: 20, z: 0, h: 3 }], 8);
  ok(o.pts.length === 12 && o.ys.length === 6, 'its banks are one outline: every point on the left bank, then back down the right');
  ok(o.pts[0] === 0 && o.pts[1] === -4 && o.pts[10] === 0 && o.pts[11] === 4 && o.ys[0] === 5 && o.ys[5] === 5 && o.ys[2] === 3, 'half its width either side of the spine, each point at its own height');
  ok(o.cx === 10 && o.cz === 0 && o.h === 4, 'its handle the spine\'s middle point');
}

tuneWater({ ...WATER_TUNE_DEFAULTS, mode: 'river', riverHeights: 'level', riverRise: 0.5, riverWidth: 6, riverVelocity: 2, shader: '' } as never);
RIVER_TUNE.steep = 'effects';

// --- a river by clicks ---
{
  // A valley floor falling a metre every 20 m eastward, rising again past x 60.
  const ground = (x: number): number => (x < 60 ? 10 - x / 20 : 7 + (x - 60) / 10);
  const s = standIn({ flatBuilt: false, ground });
  const w = new EditorWater(s.host);
  await w.arm();
  ok(w.armed, 'Z arms it');
  await click(w, 0, 10, 0);
  await click(w, 20.004, 9, 0.006);
  await click(w, 40, 8, 10);
  await click(w, 80, 8, 10);
  ok(w.draft.length === 4 && s.writes.length === 0, 'four clicks are four points of a spine, nothing written');
  await click(w, 80.5, 8, 10.5);
  await settle();
  ok(w.draft.length === 0 && s.writes.length === 1 && s.strokes === 1, 'a click near the last point writes it: one write, one undo entry');
  const row = s.writes[0][0].after as WaterRiverRow;
  ok(row.kind === 'river' && row.id === 'river-1' && row.name === 'River 1' && row.width === 6 && row.velocity === 2 && row.shader === null, `a river row: its id from its name, the tool's width (${row.width} m), velocity (${row.velocity} m/s) and the planet's own water`);
  ok(row.points.length === 4, 'its four points');
  ok(row.points[0][0] === CX - 0 && row.points[0][1] === CZ + 0 && row.points[3][0] === CX - 80, 'its spine written in the raw frame (x mirrored about the centre)');
  ok(row.points.every((p) => decimals(p[0]) <= 2 && decimals(p[1]) <= 2 && decimals(p[2]) <= 3), 'to a centimetre, its heights to a millimetre');
  ok(row.points[0][2] === 10.5 && row.points[2][2] === 8.5 && row.points[3][2] === 8.5, `its heights the ground and ${WATER_TUNE.riverRise} m, held level where the ground rises again (${row.points.map((p) => p[2]).join(', ')})`);
  ok(s.curtains === 1, "the session's first water body goes behind the curtain");
  ok(w.picked === row.id, 'and the tool picks it');

  // A move, a raise, its fields.
  await w.moveLake(row.id, 5, -2, 0);
  const moved = s.writes[1][0];
  const m = moved.after as WaterRiverRow;
  ok(moved.before !== null && (moved.before as WaterRiverRow).id === row.id && m.points.every((p, i) => Math.abs(p[0] - (row.points[i][0] - 5)) < 1e-9 && Math.abs(p[1] - (row.points[i][1] - 2)) < 1e-9 && p[2] === row.points[i][2]), 'a move is one change: every point moved by the offset in the raw frame, its heights as they were');
  await w.moveLake(row.id, 0, 0, 1.25);
  ok((s.writes[2][0].after as WaterRiverRow).points.every((p, i) => Math.abs(p[2] - (row.points[i][2] + 1.25)) < 1e-9), 'a raise lifts every point');
  await w.setLake(row.id, { width: 12.345, velocity: -0.5, fallFrom: 30 });
  const set = s.writes[3][0].after as WaterRiverRow;
  ok(set.width === 12.35 && set.velocity === -0.5 && set.fallFrom === 30, 'its width, velocity and slope limit written (the width to a centimetre)');
  await w.setLake(row.id, { fallFrom: null });
  ok(!('fallFrom' in (s.writes[4][0].after as WaterRiverRow)), 'a slope limit of none goes back to the tune');
  const before = s.writes.length;
  ok(/slope limit/.test(await w.setLake(row.id, { fallFrom: 120 })) && /width/.test(await w.setLake(row.id, { width: 5000 })) && /lava/.test(await w.setLake(row.id, { shader: 'lava_flow_a' })) && s.writes.length === before, 'a limit past the backstop, a width past it and a lava shader refused, nothing written');
  await w.remove(row.id);
  const out = s.writes[s.writes.length - 1][0];
  ok(out.after === null && s.rivers.length === 0 && s.labels[s.labels.length - 1] === `the river ${row.id} taken out`, 'a removal: one write, its row gone');
  ok(s.curtains === 1, 'none of those asked for a curtain once a water body stood');
}

// --- a steep reach, in each mode's words ---
{
  const s = standIn({ flatBuilt: true, ground: () => 0 });
  const w = new EditorWater(s.host);
  await w.arm();
  // Given surfaces: a 20-degree reach between the second and third points.
  const steep: [number, number, number][] = [[0, 0, 30], [40, 0, 29], [80, 0, 14.441], [120, 0, 13.9]];
  const effects = await w.writeRiver(steep, 'a river (console)', 'Steep', true);
  ok(/the game's fall effects stand where it runs past 12°/.test(effects) && s.writes[0].length === 1, `'effects': written as water, its fall effects said (${effects.split(' · ')[1]})`);
  RIVER_TUNE.steep = 'refuse';
  const refuse = await w.writeRiver(steep, 'a river (console)', 'Steep', true);
  ok(/not water past 12°: a fall goes here/.test(refuse) && s.writes[1].length === 1, "'refuse': written, its steep reach said to be no water, a fall to go there");
  RIVER_TUNE.steep = 'fall';
  const fall = await w.writeRiver(steep, 'a river (console)', 'Steep', true);
  const changes = s.writes[2];
  const fallRow = changes[1]?.after as { thing?: string; y?: number } | undefined;
  ok(/1 fall row written where it runs past 12°/.test(fall) && changes.length === 2 && changes[0].file === 'water' && changes[1].file === 'world' && !!fallRow, "'fall': a fall row of the placements file written in the same action as the river");
  ok(s.strokes === 3, 'each one undo entry');
  RIVER_TUNE.steep = 'effects';
  RIVER_TUNE.slopeMax = 25;
  const gentle = await w.writeRiver(steep, 'a river (console)', 'Steep', true);
  ok(!/12°|25°/.test(gentle), 'the slope limit moved past the reach: nothing said of it');
  RIVER_TUNE.slopeMax = 12;
  tuneWater({ shader: 'lava_flow_a' });
  const lava = await w.writeRiver(steep, 'a river (console)', 'Steep', true);
  ok(/lava/.test(lava) && s.strokes === 4, 'a river of lava is refused');
  tuneWater({ shader: '' });
  ok(/too close/.test(await w.writeRiver([[0, 0, 1], [1, 0, 1]], 'x', 'Short', true)), 'a river whose points stand within the spacing is refused');
  await w.writeRiver([[0, 0, 5], [20, 0, 4.5], [21.5, 0, 4.4], [40, 0, 4]], 'a river (console)', 'Merged', true);
  const merged = s.writes[s.writes.length - 1][0].after as WaterRiverRow;
  ok(merged.points.length === 3 && merged.points[1][0] === CX - 20 && merged.points[1][2] === 4.5 && merged.points[2][0] === CX - 40, `a point within ${RIVER_TUNE.spacingMin} m of the one kept before it is merged into it (three of four)`);
}

console.log(`riverTool: ${checks} checks passed`);
