// The race drawer's second wave: a course's change is laid again a budget at a time (DESIGN.md §2.4, §2.11). On the real
// `SwgTerrain` in node: a change's dirty rectangles are a list and never their union (two far-apart edges queue the blocks
// under each and none between); an undo of a 5 km course moved whole is laid again over many frames, no frame spending more
// than `COURSE_TUNE.relayMs` and one block, nearest the focus first, the far grids with it; the waiting lists empty and the
// ground is the ground made afresh. A world with no converted terrain's pole grid (`CourseGrid`) the same, on a stand-in
// clock. The world's own share (the far tiles' rewrite, the end's air, depth and grass told per
// rectangle, the shadows, the plantings) is held as text, since `world.ts` does not load in node.
//
// Run: node tools/swg/tests/courseRebuild.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SwgTerrain } from '../../../src/world/swgTerrain.ts';
import { CourseCarve, CourseGrid, type CarveTrack } from '../../../src/swg/terrain/courseCarve.ts';
import { COURSE_TUNE } from '../../../src/race/courseTune.ts';
import { node, track } from './carveFixtures.ts';
import { groundWorlds, PACKS } from './terrainHarness.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

function centreOf(world: string): { x: number; z: number } | null {
  const file = join(PACKS, world, 'layout.json');
  if (!existsSync(file)) return null;
  const m = /"center"\s*:\s*\{\s*"x"\s*:\s*(-?[\d.]+)\s*,\s*"z"\s*:\s*(-?[\d.]+)/.exec(readFileSync(file, 'utf8').slice(0, 8000));
  return m ? { x: Number(m[1]), z: Number(m[2]) } : null;
}
/** A 5 km circuit of ten nodes round the raw origin, moved by (`dx`, `dz`). */
function bigLoop(dx: number, dz: number): CarveTrack {
  const nodes = [];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    nodes.push(node(Math.cos(a) * 780 + dx, Math.sin(a) * 780 + dz, 10 + 4 * Math.sin(a * 3), { w: 24, sh: 8 }));
  }
  return track('big', 'circuit', [{ id: 'main', nodes }]);
}

const all = groundWorlds();
const world = ['dantooine', 'tatooine'].find((w) => all.includes(w)) ?? all[0];
if (!world) note(`no converted world under ${PACKS}: nothing here can be checked`);
else {
  const c = centreOf(world)!;
  const dir = join(PACKS, world);
  const bytes = (rel: string): ArrayBuffer | null => {
    const f = join(dir, rel);
    if (!existsSync(f)) return null;
    const b = readFileSync(f);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  const trn = bytes('terrain.trn')!;
  const fetchBytes = async (f: string) => bytes(f);
  // 1. A list, never the union: two short far-apart roads.
  {
    const store = new CourseCarve();
    const sw = await SwgTerrain.create(trn, [], c.x, c.z, fetchBytes, { course: store });
    // Cache a 20 x 3 band of blocks along raw x, and two short roads at its two ends.
    for (let bx = -10; bx < 10; bx++) for (let bz = -1; bz <= 1; bz++) sw.sampler.generateBlock(bx, bz);
    const n = store.set([track('a', 'sprint', [{ id: 'main', nodes: [node(-600, 0, 5, { c: 'straight' }), node(-560, 0, 5, { c: 'straight' })] }]), track('b', 'sprint', [{ id: 'main', nodes: [node(560, 0, 5, { c: 'straight' }), node(600, 0, 5, { c: 'straight' })] }])]);
    const waiting = sw.courseLater(store.rects, n);
    ok(n === 2 && waiting > 0 && waiting <= 12, `two short roads 1.1 km apart are ${n} rectangles, and the blocks under them alone wait (${waiting} of the 60 cached, the union's would be every one between)`);
    sw.stepCourse(Infinity, Number.NaN, Number.NaN, () => 0, () => {});
    // A road where far grids stand: the plain count the frame asks (`courseWaitingCount`) counts the far grids waiting with
    // the blocks, or a change under far grids alone would never be stepped and the far ring keep the ground of before.
    for (let tx = -2; tx <= 1; tx++) for (let tz = -2; tz <= 1; tz++) sw.farGrid(sw.toGameX(0) + tx * 512, sw.toGameZ(0) + tz * 512, 512, 32, true);
    const m = store.set([track('c', 'sprint', [{ id: 'main', nodes: [node(100, 900, 5, { c: 'straight' }), node(160, 900, 5, { c: 'straight' })] }])]);
    sw.courseLater(store.rects, m);
    const w = sw.courseWaiting;
    const count = sw.courseWaitingCount;
    ok(w.far > 0 && count === w.blocks + w.far, `a change under far grids waits on them (${w.blocks} blocks, ${w.far} far grids), and the plain count the frame asks counts both (${count})`);
    sw.stepCourse(Infinity, Number.NaN, Number.NaN, () => 0, () => {});
  }
  // 2. A 5 km course moved whole and undone, a budget at a time.
  {
    const store = new CourseCarve();
    store.set([bigLoop(0, 0)]);
    const sw = await SwgTerrain.create(trn, [], c.x, c.z, fetchBytes, { course: store });
    // The blocks under the whole course cached, and the far grids round it.
    const cached: [number, number][] = [];
    for (let bx = -14; bx <= 13; bx++)
      for (let bz = -14; bz <= 13; bz++) {
        const d = Math.hypot((bx + 0.5) * 64, (bz + 0.5) * 64);
        if (Math.abs(d - 780) > 120) continue;
        sw.sampler.generateBlock(bx, bz);
        cached.push([bx, bz]);
      }
    for (let tx = -2; tx <= 1; tx++) for (let tz = -2; tz <= 1; tz++) sw.farGrid(sw.toGameX(0) + tx * 512, sw.toGameZ(0) + tz * 512, 512, 32, true);
    const before = new Map(cached.map(([bx, bz]) => [`${bx},${bz}`, sw.sampler.generateBlock(bx, bz).heights.slice()]));
    // Moved 300 m whole (every edge), then undone: the undo's change is the whole course again.
    sw.courseLater(store.rects, store.set([bigLoop(300, 0)]));
    sw.stepCourse(Infinity, Number.NaN, Number.NaN, () => 0, () => {});
    const n = store.set([bigLoop(0, 0)]);
    const queued = sw.courseLater(store.rects, n);
    let frames = 0;
    let worst = 0;
    let worstItem = 0;
    let laidBlocks = 0;
    let laidFar = 0;
    let firstD = -1;
    const real = () => performance.now();
    // The plain count every frame asks (`courseWaitingCount`, which makes no record) is the record's blocks and far grids
    // together at every frame, the frames where far grids alone wait among them.
    let countBad = 0;
    let farOnly = 0;
    while (sw.courseWaiting.blocks + sw.courseWaiting.far > 0 && frames < 100000) {
      const w = sw.courseWaiting;
      if (sw.courseWaitingCount !== w.blocks + w.far) countBad++;
      if (w.blocks === 0 && w.far > 0) farOnly++;
      const t0 = performance.now();
      let last = t0;
      sw.stepCourse(COURSE_TUNE.relayMs, sw.toGameX(780), sw.toGameZ(0), real, (far, gx0, gz0, gx1, gz1) => {
        const t = performance.now();
        worstItem = Math.max(worstItem, t - last);
        last = t;
        if (far) laidFar++;
        else {
          laidBlocks++;
          if (firstD < 0) firstD = Math.hypot((gx0 + gx1) / 2 - sw.toGameX(780), (gz0 + gz1) / 2 - sw.toGameZ(0));
        }
      });
      worst = Math.max(worst, performance.now() - t0);
      frames++;
    }
    ok(frames > 5 && laidBlocks > 0 && laidFar > 0, `an undo of a 5 km course moved whole (${n} rectangles, ${queued} blocks and far grids waiting) is laid again over ${frames} frames: ${laidBlocks} blocks and ${laidFar} far grids`);
    ok(worst <= COURSE_TUNE.relayMs + 2 * worstItem + 1, `no frame spends more than the budget and one block (worst ${worst.toFixed(2)} ms against ${COURSE_TUNE.relayMs} ms and a block's ${worstItem.toFixed(2)} ms)`);
    ok(firstD >= 0 && firstD < 200, `nearest the focus first (the first block laid ${firstD.toFixed(0)} m from it)`);
    let bad = '';
    for (const [key, h] of before) {
      const [bx, bz] = key.split(',').map(Number);
      if (!sw.sampler.generateBlock(bx, bz).heights.every((v, i) => Object.is(v, h[i]))) bad ||= key;
    }
    ok(!bad && sw.courseWaiting.blocks === 0 && sw.courseWaiting.far === 0, `the waiting lists empty and every block back to its bits${bad ? ` (apart at ${bad})` : ''}`);
    ok(countBad === 0 && sw.courseWaitingCount === 0, `the plain count the frame asks is the blocks and the far grids waiting at every frame (${frames} frames${farOnly ? `, ${farOnly} with far grids alone` : ''}), nought at the end`);
  }
}

// 2b. A world with no converted terrain: its pole grid laid again a budget at a time. A stand-in clock that moves a fixed
// tick at every read, so the budget's count of tiles is exact: no step makes more than the budget's ticks (one at the
// least), the tiles go nearest the focus first, and the end is the grid made afresh.
{
  const store = new CourseCarve();
  store.set([bigLoop(0, 0)]);
  const grid = new CourseGrid(store);
  grid.all();
  grid.step(Infinity, 0, 0, () => 0);
  grid.later(store.rects, store.set([bigLoop(300, 0)]));
  grid.step(Infinity, 0, 0, () => 0);
  const n = store.set([bigLoop(0, 0)]);
  grid.later(store.rects, n);
  const queued = grid.pending;
  const TICK = 0.75;
  let clock = 0;
  const now = () => (clock += TICK);
  const most = Math.max(1, Math.ceil(COURSE_TUNE.relayMs / TICK));
  let steps = 0;
  let worstMade = 0;
  let laid = 0;
  let lastD = -1;
  let ordered = true;
  while (grid.pending > 0 && steps < 100000) {
    const made = grid.step(COURSE_TUNE.relayMs, 780, 0, now, (x0, z0, x1, z1) => {
      const d = Math.hypot((x0 + x1) / 2 - 780, (z0 + z1) / 2);
      if (d + 1e-9 < lastD) ordered = false;
      lastD = d;
      laid++;
    });
    worstMade = Math.max(worstMade, made);
    steps++;
  }
  ok(queued > most && steps > 1 && worstMade <= most && laid === queued, `an undo of a 5 km course on a pole grid (${queued} tiles waiting) is laid over ${steps} steps, none making more than the budget's ${most} tiles (worst ${worstMade})`);
  ok(ordered, 'the tiles are laid nearest the focus first, every step after the last');
  const fresh = new CourseGrid(store);
  fresh.all();
  fresh.step(Infinity, 0, 0, () => 0);
  const tilesOf = (g: CourseGrid) => (g as unknown as { tiles: Map<number, Float32Array> }).tiles;
  const a = tilesOf(grid);
  const b = tilesOf(fresh);
  let apart = '';
  if (a.size !== b.size) apart = `${a.size} tiles against ${b.size}`;
  for (const [k, t] of b) {
    const u = a.get(k);
    if (!u || !t.every((v, i) => Object.is(v, u[i]))) apart ||= `tile ${k}`;
  }
  ok(!apart && grid.pending === 0, `and the grid ends as one made afresh, every tile to the bit${apart ? ` (apart: ${apart})` : ''}`);
}

// 3. The world's own share, as text.
{
  const w = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  ok(/if \(swg\) swg\.stepCourse\(COURSE_TUNE\.relayMs, fx, fz, nowMs, this\.courseRelaid\);/.test(w), "the world lays a change's waiting blocks a budget a frame, nearest its focus (the editor's cursor, else the eye)");
  ok(/this\.courseWork\.blocks\+\+;\s*for \(const c of this\.chunks\.values\(\)\) \{\s*if \(!rectMeetsChunk\(c\.origin\.x, c\.origin\.z, CHUNK_SIZE, x0, z0, x1, z1\)\) continue;\s*this\.groundDirty\.add\(c\.key\);\s*this\.floraDirty\.add\(c\.key\);/.test(w), 'each block laid puts the chunks over it on the rewrite and replant lists');
  ok(/if \(rectMeetsChunk\(o\.x, o\.z, FAR_TILE, x0, z0, x1, z1, FAR_TILE \/ FAR_RES\)\) this\.farDirty\.add\(key\);/.test(w), 'each far grid laid puts the far tiles over it on a list of their own');
  ok(/for \(let k = 0; k < this\.courseRectN; k\+\+\) \{\s*const r = this\.courseRects\[k\];\s*this\.air\?\.raster\.forget\(r\.x0, r\.z0, r\.x1, r\.z1\);\s*if \(this\.waterMaterials\.length\) refreshWaterDepth\(r\.x0, r\.z0, r\.x1, r\.z1, this\.depthHeightAt\);\s*this\.grass\?\.circleChanged\(/.test(w), "a change's end tells the air, the water's depth and the grass per rectangle, never their union");
  ok(/this\.shadowHold\.dirtyAll\(\);/.test(w.slice(w.indexOf('private endCourseChange'), w.indexOf('private endCourseChange') + 1400)), "and makes the sun's held shadow maps dirty");
  ok(/this\.stepFarDirty\(/.test(w), 'the far tiles waiting are rewritten in the rewrite\'s own step');
}

console.log(`\ncourseRebuild: ${checks} checks passed`);
