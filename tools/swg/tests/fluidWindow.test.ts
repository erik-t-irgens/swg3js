// The window that follows the camera (src/world/volumetrics/fluidWindow.ts) and the rasters it carries
// (airRaster.ts): the origin is a whole number of cells; a move of 0.3 cells leaves it and 1.6 moves it 2; the origin
// moves by exactly the whole cells it says it moved (the shifts every field carries from that move are the field's own,
// held through the real `AirField.update` in `airFrame.test.ts`); a jump past half the window resets; uv round trips; the
// ripples' uv meets the air's by `waterSim.ts`'s own arithmetic; and the strips: a window driven at 167 m/s at 30, 60
// and 144 frames a second over every air detail keeps no unknown cell once the strips are asked of cached ground.
//
// Plain type stripping: synthetic numbers only, nothing of the game's files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { edgeFade, fluidUv, fluidWorld, inWindow, newWindow, PLACE, placeWindow, rippleUvToAir, snapOrigin } from '../../../src/world/volumetrics/fluidWindow.ts';
import { AirRaster, shiftGrid, type GroundSample, type GroundSampler } from '../../../src/world/volumetrics/airRaster.ts';
import { VOL_RANGES } from '../../../src/world/volumetrics/volSettings.ts';
import { AIR_TUNE } from '../../../src/world/volumetrics/airTune.ts';
import { AirObstacles } from '../../../src/world/volumetrics/airObstacles.ts';
import type { SolidBox } from '../../../src/world/layoutStream.ts';
import * as THREE from 'three';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const SIZE = AIR_TUNE.window.size;
const JUMP = AIR_TUNE.window.jump;
let seed = 12345;
const rand = (): number => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};

// --- the origin is whole cells, and how it moves ---
for (const cells of VOL_RANGES.volAirDetail.options) {
  const cell = SIZE / cells;
  let whole = true;
  for (let i = 0; i < 200; i++) {
    const o = snapOrigin((rand() - 0.5) * 20000, SIZE, cell);
    if (Math.abs(o / cell - Math.round(o / cell)) > 1e-9) whole = false;
  }
  ok(whole, `${cells} cells: the origin is always a whole number of ${cell.toFixed(2)} m cells`);
  const w = newWindow();
  const k = 37;
  const c0 = k * cell + SIZE / 2;
  ok(placeWindow(w, c0, c0, SIZE, cells, JUMP) === PLACE.first, `${cells} cells: the first placing says so`);
  ok(placeWindow(w, c0 + 0.3 * cell, c0, SIZE, cells, JUMP) === PLACE.still && w.moveX === 0, `${cells} cells: a camera move of 0.3 cells leaves it`);
  ok(placeWindow(w, c0 + 1.6 * cell, c0 - 1.6 * cell, SIZE, cells, JUMP) === PLACE.moved && w.moveX === 2 && w.moveZ === -2, `${cells} cells: 1.6 cells moves it 2, both ways`);
  ok(placeWindow(w, c0 + 1.6 * cell + SIZE * 0.6, c0, SIZE, cells, JUMP) === PLACE.jump && w.moveX === 0, `${cells} cells: a move past half the window is a jump, which resets`);
  ok(placeWindow(w, c0, c0, SIZE, cells === 128 ? 96 : 128, JUMP) === PLACE.jump, `${cells} cells: a change of detail is a jump too, the fields made again at the new size`);
}

// --- the origin moves by exactly the whole cells the placing says ---
for (const cells of VOL_RANGES.volAirDetail.options) {
  const w = newWindow();
  placeWindow(w, 0, 0, SIZE, cells, JUMP);
  let whole = true;
  let moves = 0;
  for (let i = 0; i < 300; i++) {
    const wasX = w.ox;
    const wasZ = w.oz;
    const code = placeWindow(w, (rand() - 0.5) * SIZE * 0.9, (rand() - 0.5) * SIZE * 0.9, SIZE, cells, JUMP);
    if (code !== PLACE.moved && code !== PLACE.still) continue;
    if (code === PLACE.moved) moves++;
    if (!Number.isInteger(w.moveX) || !Number.isInteger(w.moveZ)) whole = false;
    if (Math.abs((w.ox - wasX) / w.cell - w.moveX) > 1e-6 || Math.abs((w.oz - wasZ) / w.cell - w.moveZ) > 1e-6) whole = false;
  }
  ok(whole && moves > 50, `${cells} cells: over ${moves} moves, the origin moved by exactly the whole cells the placing said, both ways`);
}

// --- uv ---
{
  const w = newWindow();
  placeWindow(w, 1234.5, -987.25, SIZE, 128, JUMP);
  const a = { x: 0, y: 0 };
  const b = { x: 0, y: 0 };
  let round = true;
  for (let i = 0; i < 500; i++) {
    const x = w.ox + rand() * SIZE;
    const z = w.oz + rand() * SIZE;
    fluidUv(w, x, z, a);
    fluidWorld(w, a.x, a.y, b);
    if (Math.abs(b.x - x) > 1e-6 || Math.abs(b.y - z) > 1e-6) round = false;
  }
  ok(round, 'fluidUv and fluidWorld round-trip');
  fluidUv(w, w.ox + SIZE, w.oz + SIZE * 0.25, a);
  ok(Math.abs(a.x - 1) < 1e-12 && Math.abs(a.y - 0.25) < 1e-12, 'u runs with world +X and v with world +Z: no sign flip');
  ok(inWindow(w, w.ox + 1, w.oz + 1) && !inWindow(w, w.ox - 1, w.oz + 1), 'inWindow is the square');
  ok(edgeFade(0.5, 0.5, 0.08) === 1 && edgeFade(0, 0.5, 0.08) === 0 && edgeFade(0.04, 0.5, 0.08) > 0 && edgeFade(0.04, 0.5, 0.08) < 1, 'the edge fade: nothing at the edge, all of it a band inside');
}

// --- the ripples' uv against waterSim.ts's own arithmetic ---
{
  const here = dirname(fileURLToPath(import.meta.url));
  const sim = readFileSync(join(here, '..', '..', '..', 'src', 'world', 'waterSim.ts'), 'utf8');
  ok(sim.includes('const u = (x - originX) / WINDOW;') && sim.includes('const v = 1 - (z - originZ) / WINDOW;'), "waterSim.ts's poke still maps u with world X and v against world Z");
  const pokeUv = (x: number, z: number, ox: number, oz: number, win: number) => ({ u: (x - ox) / win, v: 1 - (z - oz) / win });
  const w = newWindow();
  placeWindow(w, 40, -60, SIZE, 128, JUMP);
  const out = { x: 0, y: 0 };
  const want = { x: 0, y: 0 };
  let same = true;
  for (let i = 0; i < 500; i++) {
    const rox = -50 + rand() * 30;
    const roz = -150 + rand() * 30;
    const win = 64 + rand() * 128;
    const x = rox + rand() * win;
    const z = roz + rand() * win;
    const p = pokeUv(x, z, rox, roz, win);
    rippleUvToAir(p.u, p.v, rox, roz, win, w, out);
    fluidUv(w, x, z, want);
    if (Math.abs(out.x - want.x) > 1e-9 || Math.abs(out.y - want.y) > 1e-9) same = false;
  }
  ok(same, "a ripple's uv, made by waterSim's own rule, is the air's uv of the same point");
}

// --- shiftGrid ---
{
  const n = 6;
  const a = new Float32Array(n * n);
  for (let k = 0; k < a.length; k++) a[k] = k;
  shiftGrid(a, n, 1, 2, 1, -1);
  ok(a[0] === 1 * n + 2 && a[(n - 2) * n + (n - 3)] === (n - 1) * n + (n - 1) && a[n - 1] === -1 && a[(n - 1) * n] === -1, 'shiftGrid moves the content the other way and fills what comes in');
  // The raster's own shift: what comes in is unknown and carries the window's mean height (never a nought a shader would
  // read as ground at sea level), though the mean is no longer handed to shiftGrid (a number made every frame it moved).
  const r = new AirRaster();
  r.resize(8);
  const w = newWindow();
  placeWindow(w, 0, 0, SIZE, 8, JUMP);
  r.fillAll({ sample: (x: number, z: number, out: GroundSample) => ((out.h = 100 + x * 0.01 + z * 0.02), (out.family = 1), (out.medium = 1), true) }, w.ox, w.oz, w.cell);
  const mean = r.mean;
  r.shift(2, -1);
  let incoming = 0;
  let right = true;
  for (let k = 0; k < 64; k++) {
    if (r.known[k]) continue;
    incoming++;
    if (r.height[k] !== Math.fround(mean)) right = false;
  }
  ok(incoming === 2 * 8 + 1 * 8 - 2 && r.unknown === incoming && right, `a raster shifted 2 by -1 cells has ${incoming} cells come in unknown, each carrying the window's mean height (${mean.toFixed(2)} m)`);
}

// --- the strips at speed ---
{
  /** Cached ground everywhere (the window never outruns what is built): the strips alone must keep up. */
  const ground: GroundSampler = {
    sample(x: number, z: number, out: GroundSample): boolean {
      out.h = Math.sin(x * 0.01) * 4 + Math.cos(z * 0.013) * 3;
      out.family = 1;
      out.medium = 1;
      return true;
    },
  };
  for (const cells of VOL_RANGES.volAirDetail.options) {
    for (const fps of [30, 60, 144]) {
      const w = newWindow();
      const r = new AirRaster();
      r.resize(cells);
      let x = 0;
      const speed = 167;
      placeWindow(w, x, 0, SIZE, cells, JUMP);
      r.fill(ground, w.ox, w.oz, w.cell, 0, 0, AIR_TUNE.window.stripMargin, 100, () => 0);
      let worst = 0;
      let wrong = 0;
      for (let f = 0; f < fps * 4; f++) {
        x += speed / fps;
        const code = placeWindow(w, x, x * 0.3, SIZE, cells, JUMP);
        if (code === PLACE.moved) r.shift(w.moveX, w.moveZ);
        // No budget for the unknown at all: the strips alone, as the worst frame would have it.
        r.fill(ground, w.ox, w.oz, w.cell, w.moveX, w.moveZ, AIR_TUNE.window.stripMargin, 0, () => 0);
        if (r.unknown > worst) worst = r.unknown;
        // The height a cell holds is the ground at that cell's middle.
        const i = Math.floor(rand() * cells);
        const j = Math.floor(rand() * cells);
        const s: GroundSample = { h: 0, family: 0, medium: 0 };
        ground.sample(w.ox + (i + 0.5) * w.cell, w.oz + (j + 0.5) * w.cell, s);
        if (Math.abs(r.height[j * cells + i] - s.h) > 1e-4) wrong++;
      }
      ok(worst === 0 && wrong === 0, `${cells} cells at ${fps} fps, 167 m/s: no unknown cell once the strips are asked, and every cell holds its own ground`);
    }
  }
}

// --- the obstacles' gather ---
// A compound's box is not a wall: the first smoke in a browser found Mos Eisley's starport, one box 160 m across round
// its own courtyard, holding every texel of the window solid, so no dust was laid anywhere near the arrival. Its rooms
// (the halls round the courtyard) come after it and are kept for the volume alone, so its dust stays out of a hall seen
// through a door from outside (the design's risk 8) while the air and the dust flow through.
{
  const w = newWindow();
  placeWindow(w, 0, 0, SIZE, 128, JUMP);
  const boxes: SolidBox[] = [
    { x: 10, z: 5, hx: 6, hz: 4, cos: 1, sin: 0, top: 8, room: false },
    { x: -4, z: 2, hx: 80, hz: 75, cos: 1, sin: 0, top: 48, room: false },
    { x: -60, z: 2, hx: 12, hz: 30, cos: 1, sin: 0, top: 14, room: true },
    { x: 30, z: -20, hx: AIR_TUNE.obstacles.widest, hz: 3, cos: 0, sin: 1, top: 12, room: false },
  ];
  let roomsAsked = -1;
  const src = {
    forEachSolidBox(_x0: number, _z0: number, _x1: number, _z1: number, rec: SolidBox, visit: (b: SolidBox) => boolean, roomsOver?: number): void {
      roomsAsked = roomsOver ?? Infinity;
      for (const b of boxes) {
        Object.assign(rec, b);
        if (!visit(rec)) return;
      }
    },
  };
  const obs = new AirObstacles({ value: new THREE.Vector4() });
  obs.gather(src, w);
  ok(roomsAsked === AIR_TUNE.obstacles.widest, "the gather asks the streamer for the rooms of every box wider than obstacles.widest");
  ok(obs.count === 3 && obs.tooWide === 1 && obs.rooms === 1, 'a box wider than obstacles.widest is left out and counted; its room is kept; one exactly as wide is kept');
  ok(obs.largest === 80 && obs.largestX === -4 && obs.largestTop === 48, 'and the console is told the widest box, where it stands and how tall');
  const kept = obs.mesh.geometry.getAttribute('aBox').array as Float32Array;
  const turn = obs.mesh.geometry.getAttribute('aTurn');
  const t = turn.array as Float32Array;
  ok(kept[0] === 10 && kept[4] === -60 && kept[8] === 30 && turn.itemSize === 4, 'the boxes kept are the others, in the order they came');
  ok(t[3] === 1 && t[7] === 0 && t[6] === 14 && t[11] === 1, "a wall is drawn into both channels (its fourth number 1) and a compound's room into the volume's alone (0), at its own top");
  obs.dispose();
}

console.log(`\n${checks} checks passed`);
