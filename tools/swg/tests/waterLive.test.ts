// The world editor's water tool, live (Map-maker II's fifth wave, `src/editor/editorWater.ts`), driven as the editor drives
// it -- its frames (`step`, then `overlay` from the frame's view) -- over a stand-in host and a stand-in world that lands
// every write by `planLakeLanding`, the very plan `World.landWater` stands lakes by. Held here: a lake by clicks (three
// points and a click by the first closes it at its level), a lake traced from a seed, a fall between two ends; a move, a
// raise and a removal each one write and one undo entry, its rows exact; the landing moving only the lake written, so a lake
// is one body added or removed by difference; the curtain asked for where the world says a first lake or a lava lake wants
// it, and never otherwise; Escape giving a draft up, F taking the mouse only with a lake picked.
//
// Run: node tools/swg/tests/waterLive.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { EditorWater, clickLevel, fallPlacement, waterTool, type WaterHost } from '../../../src/editor/editorWater.ts';
import { yawOfTurn, yawTurn } from '../../../src/world/permanentEdit.ts';
import { scaleOf, toGame, type PlacementRow } from '../../../src/story/placements.ts';
import { WATER_TUNE, WATER_TUNE_DEFAULTS, tuneWater } from '../../../src/editor/editorTune.ts';
import { toolFrame } from '../../../src/editor/tools.ts';
import { screenView } from '../../../src/editor/gizmo.ts';
import { marksView } from '../../../src/ui/editorMarks.ts';
import { planLakeLanding, surfaceOf, lakeTable } from '../../../src/world/ourWater.ts';
import type { WaterLakeRow } from '../../../src/world/editFiles/waterFile.ts';
import type { RowChange } from '../../../src/editor/undo.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** A world's frame about a centre (a converted world's mirror): raw x = cx - gx, raw z = cz + gz. */
const CX = 1000;
const CZ = -500;

/** The stand-in world: its lakes, the bodies a landing makes and takes by difference, its curtain's word. */
function standIn(opts: { flatBuilt: boolean; sea: number; ground: (x: number, z: number) => number }) {
  const s = {
    rows: [] as WaterLakeRow[],
    bodiesAdded: 0,
    bodiesRemoved: 0,
    landings: [] as string[][],
    writes: [] as RowChange[][],
    strokes: 0,
    curtains: 0,
    inCurtain: false,
    wroteInCurtain: 0,
    flatBuilt: opts.flatBuilt,
    said: [] as string[],
    placeRows: new Map<string, unknown>(),
  };
  const edits = {
    beginStroke: (label: string) => ({ label, changes: [] as RowChange[] }),
    async strokeWrite(es: { changes: RowChange[] }, changes: RowChange[]): Promise<string | null> {
      s.writes.push(changes);
      if (s.inCurtain) s.wroteInCurtain++;
      es.changes.push(...changes);
      // The endpoint stamps every put; the world lands the water by difference.
      const put: WaterLakeRow[] = [];
      const deleted: string[] = [];
      for (const c of changes) {
        if (c.file === 'water') {
          if (c.after) put.push({ ...(c.after as WaterLakeRow), at: 1 });
          else deleted.push(c.id);
        } else if (c.after) s.placeRows.set(c.id, c.after);
      }
      if (put.length || deleted.length) {
        const plan = planLakeLanding(s.rows, put, deleted);
        s.rows = plan.rows;
        s.landings.push([...plan.moved]);
        // One body taken out and one stood for every lake that moved and still stands; one taken out for one gone.
        for (const id of plan.moved) {
          if (s.bodies.has(id)) {
            s.bodies.delete(id);
            s.bodiesRemoved++;
          }
          if (plan.rows.some((r) => r.id === id)) {
            s.bodies.add(id);
            s.bodiesAdded++;
          }
        }
        if (put.length) s.flatBuilt = true;
      }
      return null;
    },
    endStroke: (es: { changes: RowChange[] }) => {
      s.strokes++;
      return `${es.changes.length} row${es.changes.length === 1 ? '' : 's'} written`;
    },
    mintIds: (bases: string[]) => bases.map((b, i) => `${b}-${s.placeRows.size + i + 1}`),
  };
  const host: WaterHost = {
    edits: edits as never,
    worldKind: () => 'ground',
    rows: () => s.rows,
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
    seaLevel: () => opts.sea,
    isLava: (shader) => !!shader && /lava/.test(shader),
    wantsCurtain: (lava) => lava || !s.flatBuilt,
    async curtain(_detail, work) {
      s.curtains++;
      s.inCurtain = true;
      try {
        return await work();
      } finally {
        s.inCurtain = false;
      }
    },
    fallSource: async (thing) => (thing === 'waterfall_all_thin_forked' ? { src: { kind: 'prop', pack: 'props', thing, template: 'object/static/naboo/shared_waterfall_all_thin_forked.iff' }, bounds: { min: [6.6, 39.76, 6.28], max: [-5.7, -37.63, -3.4] } } : `${thing} is not in the props catalogue`),
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
  return Object.assign(s, { bodies: new Set<string>(), host });
}

/** One frame of the tool as the editor gives it: the buttons, the aim, F and the mouse, then the overlay from the view. */
const view = screenView();
const marks = marksView();
const draw = { marks, radius: 0.5, ring() {} };
function frame(w: EditorWater, f: Partial<ReturnType<typeof toolFrame>>): void {
  const t = toolFrame();
  Object.assign(t, { apply: false, inverse: false, shift: false, sampled: false, valid: true, dt: 1 / 60, now: 1, sx: 400, sy: 300, dy: 0, lift: false }, f);
  w.step(t);
  w.overlay(draw as never, view);
}
/** A click: the button down one frame, up the next. */
async function click(w: EditorWater, x: number, y: number, z: number, inverse = false): Promise<void> {
  frame(w, inverse ? { inverse: true, x, y, z } : { apply: true, x, y, z });
  frame(w, { x, y, z });
  for (let i = 0; i < 4; i++) await Promise.resolve();
}
const settle = () => new Promise((r) => setTimeout(r, 0));

tuneWater({ ...WATER_TUNE_DEFAULTS, mode: 'clicks', levelFrom: 'lowest' } as never);

{
  // A lake by clicks on a world whose lake programs are not built yet: behind the curtain.
  const ground = (x: number) => 10 + x * 0.01;
  const s = standIn({ flatBuilt: false, sea: -50, ground });
  const w = new EditorWater(s.host);
  await w.arm();
  ok(w.armed, 'Z arms it on a ground world');
  await click(w, 0, 10, 0);
  await click(w, 30, 10.3, 0);
  await click(w, 30, 10.3, 30);
  ok(w.draft.length === 3 && s.writes.length === 0, 'three clicks are three points of an outline, nothing written');
  await click(w, 2, 10, 1);
  await settle();
  ok(w.draft.length === 0 && s.writes.length === 1 && s.strokes === 1, 'a click by the first point closes it: one write, one undo entry');
  const row = s.writes[0][0].after as WaterLakeRow;
  ok(row.h === clickLevel([10, 10.3, 10.3], 'lowest', 0, WATER_TUNE.rise) && row.points.length === 3, `at the lowest ground under its points (${row.h} m), three points`);
  ok(row.points[0][0] === CX - 0 && row.points[1][0] === CX - 30 && row.points[2][1] === CZ + 30, 'its points written in the raw frame (x mirrored about the centre)');
  ok(s.curtains === 1 && s.wroteInCurtain === 1, "the session's first lake goes behind the curtain, its write inside it");
  ok(s.bodies.has(row.id) && s.bodiesAdded === 1 && w.picked === row.id, 'landed, it is one body, and the tool picks it');

  // A second lake, now the programs are built: no curtain; its landing moves it alone.
  await click(w, 100, 11, 0);
  await click(w, 140, 11, 0);
  await click(w, 140, 11, 40);
  await click(w, 100.5, 11, 0.5);
  await settle();
  ok(s.curtains === 1 && s.writes.length === 2, 'the second lake goes on with no curtain');
  ok(s.landings[1].length === 1 && s.bodiesAdded === 2 && s.bodiesRemoved === 0, 'and its landing moves it alone: the first lake keeps its body');
  const second = s.writes[1][0].after as WaterLakeRow;

  // A move, a raise, a removal: each one write, each exact.
  const before = s.rows.find((r) => r.id === second.id)!;
  await w.moveLake(second.id, 5, -2, 0);
  const moved = s.writes[2][0];
  const after = moved.after as WaterLakeRow;
  ok(s.writes[2].length === 1 && moved.before === before && after.h === before.h, 'a move is one change, the row before as it stood');
  ok(after.points.every((p, i) => Math.abs(p[0] - (before.points[i][0] - 5)) < 1e-9 && Math.abs(p[1] - (before.points[i][1] - 2)) < 1e-9), 'every point moved by the offset, in the raw frame (x mirrored)');
  ok(s.landings[2].length === 1 && s.bodiesRemoved === 1 && s.bodiesAdded === 3, 'landed: its one body taken out and stood again, no other');
  await w.moveLake(second.id, 0, 0, 2.5);
  ok((s.writes[3][0].after as WaterLakeRow).h === before.h + 2.5, 'a raise moves its level alone');
  await w.moveLake(second.id, 0, 0, -50 - (before.h + 2.5) + 0.004);
  ok((s.writes[4][0].after as WaterLakeRow).h === -50 + WATER_TUNE.seaNudge, 'a level brought within a centimetre of the sea is raised clear of it');
  await w.remove(second.id);
  ok(s.writes[5][0].after === null && !s.bodies.has(second.id) && s.bodies.size === 1 && s.strokes === 6, 'a removal takes its body out: one write, one undo entry each');

  // The file keeps a centimetre and a millimetre as written figures: Helensar's smoke wrote 749.9300000000001 and
  // -11856.880000000001 while the step was multiplied back.
  await w.writeLake([[-6326.004, -11863.371], [-6310.001, -11765.86], [-6270, -11856.88]], 749.93004, 'a lake of awkward figures', 'console');
  const odd = s.writes[s.writes.length - 1][0].after as WaterLakeRow;
  const decimals = (n: number) => (String(n).split('.')[1] ?? '').length;
  ok(decimals(odd.h) <= 3 && odd.points.every(([x, z]) => decimals(x) <= 2 && decimals(z) <= 2), `its level to the millimetre and its points to the centimetre, as figures (${odd.h}, ${odd.points[2].join(', ')})`);
  await w.remove(odd.id);

  // A lava lake goes behind the curtain whatever the session built.
  tuneWater({ shader: 'lava_flow_a' });
  await w.writeLake([[0, 0], [10, 0], [10, 10]], 20, 'a lava lake', 'console');
  ok(s.curtains === 2, 'a lava lake goes behind the curtain');
  tuneWater({ shader: '' });
  // And so does every other change to one, each of which makes the lava again: moved, its look changed to water, taken out.
  const lavaId = s.rows.find((r) => r.shader === 'lava_flow_a')!.id;
  await w.moveLake(lavaId, 1, 0, 0);
  ok(s.curtains === 3 && s.wroteInCurtain === 3, 'a lava lake moved goes behind the curtain, its write inside it');
  await w.setLake(lavaId, { shader: null });
  ok(s.curtains === 4, 'a lava lake made water goes behind the curtain (the lava is made again without it)');
  await w.setLake(lavaId, { shader: 'lava_flow_a' });
  ok(s.curtains === 5, 'and water made lava');
  await w.remove(lavaId);
  ok(s.curtains === 6 && s.wroteInCurtain === 6 && !s.rows.some((r) => r.id === lavaId), 'a lava lake taken out goes behind the curtain, its write inside it');
  const curtainsBefore = s.curtains;
  await w.writeLake([[0, 0], [10, 0], [10, 10]], 20, 'a plain lake', 'console');
  const plainId = w.picked!;
  await w.remove(plainId);
  ok(s.curtains === curtainsBefore && !s.rows.some((r) => r.id === plainId), 'a lake of water put on and taken out with the programs built asks for no curtain');

  // Escape: a draft given up; then a picked lake let go.
  await click(w, 500, 1, 500);
  ok(w.draft.length === 1 && w.escape() && w.draft.length === 0, 'Escape gives a draft up');
  w.picked = s.rows[0].id;
  ok(w.holdsMouse(true) && !w.holdsMouse(false), 'F takes the mouse only with a lake picked');
  ok(w.escape() && w.picked === null && !w.holdsMouse(true), 'Escape lets the picked lake go');
  ok(!w.escape(), 'and with nothing of its own under way, Escape lets the tool go');
  // RMB takes a point back.
  await click(w, 0, 1, 0);
  await click(w, 5, 1, 0);
  await click(w, 0, 1, 0, true);
  ok(w.draft.length === 1, 'RMB takes the last point back');
}

{
  // A lake traced from a seed: a bowl 30 m round at its seed's ground and a metre more.
  const bowl = (x: number, z: number) => ((x - 50) ** 2 + (z - 50) ** 2) / 100;
  const s = standIn({ flatBuilt: true, sea: -Infinity, ground: bowl });
  const w = new EditorWater(s.host);
  tuneWater({ mode: 'trace', traceRise: 9, levelFrom: 'lowest' });
  await w.arm();
  await click(w, 50, 0, 50);
  await settle();
  const row = s.writes[0]?.[0].after as WaterLakeRow | undefined;
  ok(!!row && row.h === 9 && row.points.length >= 8, `a click in a basin traces it at its seed's ground and ${WATER_TUNE.traceRise} m (${row?.points.length} points)`);
  const t = lakeTable(row!, (x) => CX - x, (z) => z - CZ);
  ok(surfaceOf([t], 50, 50) === 9 && surfaceOf([t], 50, 100) === -Infinity, 'the lake written covers its basin and not past the rim');
  tuneWater({ mode: 'clicks', traceRise: WATER_TUNE_DEFAULTS.traceRise });
}

{
  // A fall between two ends.
  const s = standIn({ flatBuilt: true, sea: -Infinity, ground: () => 0 });
  const w = new EditorWater(s.host);
  tuneWater({ mode: 'fall', fallWidth: 8, fallDepth: 1, fallTurn: 0 });
  await w.arm();
  await click(w, 10, 40, 0);
  ok(!!w.fallTop && s.writes.length === 0, "the first click is the fall's top");
  await click(w, 10, 0, 10);
  await settle();
  const ch = s.writes[0]?.[0];
  ok(!!ch && ch.file === 'world' && ch.before === null, 'the second writes one row into the placements file');
  const p = fallPlacement({ x: 10, y: 40, z: 0 }, { x: 10, y: 0, z: 10 }, { min: [6.6, 39.76, 6.28], max: [-5.7, -37.63, -3.4] }, 8, 1, 0, 0, 1)!;
  ok(Math.abs(p.scale[1] * (39.76 + 37.63) - 40) < 1e-9 && Math.abs(p.y + 39.76 * p.scale[1] - 40) < 1e-9, "its model's height spans the drop and its top stands at the top");
  ok(Math.abs(p.scale[0] * (6.6 + 5.7) - 8) < 1e-9 && Math.abs(p.yaw) < 1e-9, 'its width is the width asked, and it faces from its top toward its bottom');
  // Where it stands: its box's middle on the ground at the bottom's place (the share's default), turned with it. Stood at
  // the run's middle, a fall down Tatooine's smoke plateau's 56-degree flank was inside the slope but for its top 2 m.
  const mid = (q: NonNullable<typeof p>, box: { min: number[]; max: number[] }) => {
    const mx = ((box.min[0] + box.max[0]) / 2) * q.scale[0];
    const mz = ((box.min[2] + box.max[2]) / 2) * q.scale[2];
    return { x: q.x + mx * Math.cos(q.yaw) + mz * Math.sin(q.yaw), z: q.z - mx * Math.sin(q.yaw) + mz * Math.cos(q.yaw) };
  };
  const box = { min: [6.6, 39.76, 6.28], max: [-5.7, -37.63, -3.4] };
  const m1 = mid(p, box);
  ok(Math.abs(m1.x - 10) < 1e-9 && Math.abs(m1.z - 10) < 1e-9, `its box's middle stands at its foot (${m1.x.toFixed(3)}, ${m1.z.toFixed(3)})`);
  const pTop = fallPlacement({ x: 10, y: 40, z: 0 }, { x: 10, y: 0, z: 10 }, box, 8, 1, 0, 0, 1, 0)!;
  const pMid = fallPlacement({ x: 10, y: 40, z: 0 }, { x: 10, y: 0, z: 10 }, box, 8, 1, 0, 0, 1, 0.5)!;
  const turned = fallPlacement({ x: 0, y: 40, z: 0 }, { x: -10, y: 0, z: 0 }, box, 8, 1, 0, 0, 1)!;
  const mt = mid(turned, box);
  ok(Math.abs(mid(pTop, box).z) < 1e-9 && Math.abs(mid(pMid, box).z - 5) < 1e-9 && Math.abs(mt.x + 10) < 1e-9 && Math.abs(mt.z) < 1e-9, 'a share of 0 stands it at its top, a half at the middle, and turned a quarter its middle still stands at its foot');
  const row = ch.after as unknown as { thing: string; scale: number[]; x: number; z: number };
  ok(row.thing === 'waterfall_all_thin_forked' && Array.isArray(row.scale) && Math.abs(row.scale[1] - p.scale[1]) < 1e-3, 'the row is the fall model at that scale');
  ok(fallPlacement({ x: 0, y: 1, z: 0 }, { x: 0, y: 0.5, z: 0 }, { min: [0, 0, 0], max: [1, 1, 1] }, 8, 1, 0, 0, 1) === null, 'a drop under the least is no fall');
  // The tool hands the tune's share to the placing: at 0 the same two clicks stand the fall at its top, its run (10 m along
  // z) nearer than at its foot.
  tuneWater({ fallAlong: 0 });
  await click(w, 10, 40, 0);
  await click(w, 10, 0, 10);
  await settle();
  const atTop = s.writes[1]?.[0]?.after as unknown as { x: number; z: number } | undefined;
  ok(!!atTop && Math.abs(Math.abs(atTop.z - row.z) - 10) < 0.01 && Math.abs(atTop.x - row.x) < 0.01, `the share the tune names reaches the row (${row.z} at its foot, ${atTop?.z} at its top)`);

  // The turn the row is written with is the turn its place was worked out for: its quaternion is the yaw's own
  // (`yawTurn`), and read back out of the file (`toGame`) and stood by three at its scale, the model's box's middle on the
  // ground lands at the fall's foot, for a run neither along x nor along z.
  const top = { x: 3, y: 30, z: -4 };
  const foot = { x: -6, y: 1, z: 8 };
  const pt = fallPlacement(top, foot, box, 8, 1, 0, 0, 1)!;
  const want = yawTurn(pt.yaw);
  ok(pt.q.every((v, i) => Math.abs(v - want[i]) < 1e-12) && Math.abs(pt.yaw - Math.atan2(foot.x - top.x, foot.z - top.z)) < 1e-12, "a fall's turn is its yaw's own quaternion, facing from its top toward its foot");
  tuneWater({ fallAlong: 1 });
  await click(w, top.x, top.y, top.z);
  await click(w, foot.x, foot.y, foot.z);
  await settle();
  const turnedRow = s.writes[s.writes.length - 1]?.[0]?.after as unknown as PlacementRow | undefined;
  ok(!!turnedRow, 'the turned fall is written');
  const g = toGame(turnedRow!, { x: CX, z: CZ }, 'raw');
  ok(Math.abs(yawOfTurn(g.q) - pt.yaw) < 1e-5, `read back out of the file its turn is the yaw it was worked out for (${yawOfTurn(g.q).toFixed(5)} against ${pt.yaw.toFixed(5)})`);
  const o = new THREE.Object3D();
  o.position.set(g.x, g.y, g.z);
  o.quaternion.set(g.q[0], g.q[1], g.q[2], g.q[3]);
  const [sx, sy, sz] = scaleOf(turnedRow!);
  o.scale.set(sx, sy, sz);
  o.updateMatrixWorld(true);
  const middle = new THREE.Vector3((box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2).applyMatrix4(o.matrixWorld);
  ok(Math.abs(middle.x - foot.x) < 0.01 && Math.abs(middle.z - foot.z) < 0.01, `stood by three, its box's middle stands at its foot (${middle.x.toFixed(3)}, ${middle.z.toFixed(3)} against ${foot.x}, ${foot.z})`);
  const topOfModel = new THREE.Vector3(0, Math.max(box.min[1], box.max[1]), 0).applyMatrix4(o.matrixWorld);
  ok(Math.abs(topOfModel.y - top.y) < 0.01, `and its model's top at the fall's top (${topOfModel.y.toFixed(3)})`);
  tuneWater({ mode: 'clicks', fallAlong: WATER_TUNE_DEFAULTS.fallAlong });
}

{
  // The Tools list's entry.
  const s = standIn({ flatBuilt: true, sea: -Infinity, ground: () => 0 });
  const w = new EditorWater(s.host);
  const t = waterTool(w);
  ok(t.id === 'water' && t.action === 'editorWater' && t.owns('apply') && t.owns('inverse') && !t.owns('middle'), 'the water tool is the list\'s entry on Z, owning both buttons');
  ok(!!t.overlay && !!t.holdsMouse && !!t.deleteKey && !!t.escape && !!t.wheel, 'with its overlay, its F, its Delete, its Escape and its wheel');
}

{
  // The armed tool's frame makes nothing (`editorAllocOwn.ts water`, twelve processes at once, each asserted): its step, its
  // overlay over three lakes of forty points with one picked, and every mark drawn -- with nothing held, with F held and the
  // mouse moving (the raise carried on), with the picked lake's square dragged, and with an outline under way.
  const file = fileURLToPath(new URL('./editorAllocOwn.ts', import.meta.url));
  type Measure = { frames: number; made: number; scavenges: number; raiseMade: number; raiseScavenges: number; dragMade: number; dragScavenges: number; draftMade: number; draftScavenges: number; lakes: number; raising: boolean; dragging: boolean; hot: number; draftPoints: number; draftDrawn: number; skipped?: string };
  const run = () =>
    new Promise<Measure>((resolve, reject) => {
      const child = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', file, 'water'], { stdio: ['ignore', 'pipe', 'pipe'] });
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
  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    const line = 0.05 * a.frames;
    const per = (v: number) => (Math.max(0, v) / a.frames).toFixed(3);
    ok(a.lakes === 3 && a.raising && a.dragging && a.hot === 3 && a.draftPoints === 3 && a.draftDrawn === 4, `process ${i + 1} of 12: each window was what it says (three lakes drawn, the raise carried, the square grabbed and dragged, three points and the aim in the draft)`);
    ok(a.scavenges === 0 && a.made < line && a.raiseScavenges === 0 && a.raiseMade < line && a.dragScavenges === 0 && a.dragMade < line && a.draftScavenges === 0 && a.draftMade < line, `process ${i + 1} of 12: the armed water tool's frame makes ${per(a.made)} bytes a frame steady, ${per(a.raiseMade)} raising, ${per(a.dragMade)} dragging and ${per(a.draftMade)} with an outline under way, over ${a.frames} frames each with no collection`);
  }
}

console.log(`waterLive: ${checks} checks passed`);
