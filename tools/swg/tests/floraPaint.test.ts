// The flora paint's rules (Map-maker II's fourth wave, DESIGN.md §2.6), held over the converted worlds' own flora tables:
//   - an add is the client's own test: a recipe adding a family the world plants, at the world's density, lays over an empty
//     grid exactly what the world's own affector (`AffectorFloraStatic`, `AffectorFloraDynamic`) lays there at the same
//     amount, family and choice by `Object.is` (painting the very family the world planted gives back its own planting);
//   - clear zeroes all four maps under a whole tile, thin keeps its share within a tenth, a feathered amount plants that
//     share of the density within a tenth; a thin keeps the share it names and never its complement (a fifth at 0.2), an
//     amount scales what a thin and a clear take away (at half amount 0.6 and a half kept), what they leave is the world's
//     own; a remove takes its one family off (all at full amount, about half at half) and no other;
//   - a cell's amount reaches the poles round it by the bilinear weights: a corner pole every time, half a cell along
//     about half, half along both about a quarter, a whole cell along never;
//   - a road's or a river's poles (the generator's `roadMap`) are never painted unless the recipe says `roads`, and with it
//     they are;
//   - one point's arithmetic (`floraPoint`, a real-elevation world's planter and Mustafar's) is the grid's at every pole;
//   - the worker's paint, fed by the message, lays the same flora as the main thread's (both cores);
//   - Mustafar's baked trees take the paint where a recipe reaches them (a stand-in source with a baked map), and keep the
//     baked trees elsewhere to the bit; on a road (the sampler's `roadAt`) only a recipe that says `roads` reaches them.
//
// Run: node tools/swg/tests/floraPaint.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { AffectorFloraDynamic, AffectorFloraStatic, createChunkData } from '../../../src/swg/terrain/generator.ts';
import { FLORA_OPS, GroundPaint, PAINT_TILE, familyIdOf, type FloraRecipe } from '../../../src/swg/terrain/groundPaint.ts';
import { TerrainWorkerCore } from '../../../src/swg/terrain/workerCore.ts';
import { FloraPlanter, type FloraSource } from '../../../src/world/flora.ts';
import { groundWorlds, loadWorld, PACKS, sampleBlocks } from './terrainHarness.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

/** A paint whose every cell of a raw rectangle holds `recipe` at `amount`. */
function paintRect(p: GroundPaint, x0: number, z0: number, x1: number, z1: number, recipe: number, amount: number): void {
  const c = p.cell;
  for (let cz = Math.floor(z0 / c); cz <= Math.ceil(z1 / c); cz++) {
    for (let cx = Math.floor(x0 / c); cx <= Math.ceil(x1 / c); cx++) {
      const tx = Math.floor(cx / p.n);
      const tz = Math.floor(cz / p.n);
      const t = p.floraTile(tx, tz, true)!;
      const o = ((cz - tz * p.n) * p.n + (cx - tx * p.n)) * 2;
      t[o] = recipe;
      t[o + 1] = amount;
    }
  }
  p.boundsAgain();
}

const worlds = groundWorlds();
if (!worlds.length) note(`no converted worlds under ${PACKS}: the world half is skipped`);

// ---------------------------------------------------------------- the add is the client's own test

{
  let held = 0;
  for (const name of worlds) {
    const w = loadWorld(name);
    if (!w) continue;
    const g = w.template.generator;
    // Families whose own density is under one where the world has any, so the client's test decides pole by pole.
    const pick = <T extends { children: unknown[]; id: number; density: number }>(list: T[]) => list.find((f) => f.children.length && f.id > 0 && f.id < 256 && f.density > 0.05 && f.density < 0.95) ?? list.find((f) => f.children.length && f.id > 0 && f.id < 256);
    const tree = pick([...g.floraGroup.families.values()]);
    const grass = pick([...g.radialGroup.families.values()]);
    if (!tree || !grass) continue;
    const n = 36;
    const step = 2;
    const sx = 1000;
    const sz = -2000;
    // The world's own affectors over an empty grid, at amount 1 and the family's own density.
    const own = createChunkData(sx, sz, n, step, g.fractalGroup, g.shaderGroup, g.bitmapGroup, g.floraGroup, g.environmentGroup, g.rampGroup, g.radialGroup);
    const a = new AffectorFloraStatic('AFSC');
    a.familyId = tree.id;
    const b = new AffectorFloraDynamic('AFDN');
    b.familyId = grass.id;
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      a.affect(sx + x * step, sz + z * step, x, z, 1, own);
      b.affect(sx + x * step, sz + z * step, x, z, 1, own);
    }
    // The paint over another empty grid: one recipe adding both at their own density, every cell at full amount.
    const d = createChunkData(sx, sz, n, step, g.fractalGroup, g.shaderGroup, g.bitmapGroup, g.floraGroup, g.environmentGroup, g.rampGroup, g.radialGroup);
    const p = new GroundPaint();
    const missing = p.resolveRecipes([{ trees: { add: { pack: name, name: tree.name } }, grass: { add: { pack: name, name: grass.name } } }], g.floraGroup, g.radialGroup, name);
    paintRect(p, sx - 8, sz - 8, sx + n * step + 8, sz + n * step + 8, 1, 255);
    p.floraInto(d);
    const same = (x: Uint8Array, y: Uint8Array) => x.length === y.length && x.every((v, i) => Object.is(v, y[i]));
    const planted = own.floraCollidable.filter((v, i) => i % 2 === 0 && v !== 0).length;
    ok(!missing.length && same(own.floraCollidable, d.floraCollidable) && same(own.radialNear, d.radialNear) && planted > 0, `${name}: adding ${tree.name} and ${grass.name} at their own density lays exactly what the world's own affectors lay (${planted} trees of ${n * n} poles), family and choice by Object.is`);
    held++;
    if (held >= 3) break;
  }
  if (worlds.length) ok(held > 0, `the add was held to the client's own affectors on ${held} worlds`);
}

// ---------------------------------------------------------------- clear, thin, a feathered amount, roads

const world = worlds.includes('naboo') ? 'naboo' : worlds[0];
const loaded = world ? loadWorld(world) : null;
if (loaded) {
  const g = loaded.template.generator;
  const s = loaded.sampler;
  const tree = [...g.floraGroup.families.values()].find((f) => f.children.length && f.id > 0 && f.id < 256)!;
  const blocks = sampleBlocks(loaded.template, 40, 777);
  // The world's own four maps over every sampled block, and the same blocks made with each recipe painted over them whole.
  const own = blocks.map((b) => {
    const st = s.blockStart(b.bx, b.bz);
    return { st, g: s.generate(st.x, st.z, s.numberOfPoles, s.poleStep) };
  });
  const run = (recipes: FloraRecipe[], amount: number) => {
    const p = new GroundPaint();
    const missing = p.resolveRecipes(recipes, g.floraGroup, g.radialGroup, world);
    for (const { st } of own) paintRect(p, st.x - 8, st.z - 8, st.x + 80, st.z + 80, 1, amount);
    s.paint = p;
    try {
      return { missing, grids: own.map(({ st }) => s.generate(st.x, st.z, s.numberOfPoles, s.poleStep)) };
    } finally {
      s.paint = null;
    }
  };
  const count = (m: Uint8Array) => {
    let k = 0;
    for (let i = 0; i < m.length; i += 2) if (m[i] !== 0) k++;
    return k;
  };
  const sum = (grids: { floraCollidable: Uint8Array; floraNonCollidable: Uint8Array; radialNear: Uint8Array; radialFar: Uint8Array }[], key: 'floraCollidable' | 'floraNonCollidable' | 'radialNear' | 'radialFar') => grids.reduce((t, x) => t + count(x[key]), 0);
  const ownGrids = own.map((o) => o.g);
  const ownAll = ['floraCollidable', 'floraNonCollidable', 'radialNear', 'radialFar'].map((k) => sum(ownGrids, k as never));
  note(`${world}: the world's own over ${blocks.length} blocks: trees ${ownAll[0]}, plants ${ownAll[1]}, grass ${ownAll[2]}, far ${ownAll[3]}`);

  const clear = run([{ trees: 'clear', plants: 'clear', grass: 'clear', far: 'clear', roads: true }], 255);
  const cleared = ['floraCollidable', 'floraNonCollidable', 'radialNear', 'radialFar'].map((k) => sum(clear.grids, k as never));
  ok(!clear.missing.length && cleared.every((v) => v === 0) && ownAll.some((v) => v > 0), `a recipe clearing all four classes (and the roads) at full amount zeroes all four maps under its cells (${ownAll.join(', ')} to nought)`);

  const thin = run([{ trees: { thin: 0.5 }, grass: { thin: 0.5 }, roads: true }], 255);
  const tt = sum(thin.grids, 'floraCollidable');
  const tg = sum(thin.grids, 'radialNear');
  ok(ownAll[0] > 100 && Math.abs(tt / ownAll[0] - 0.5) < 0.1 && (ownAll[2] < 100 || Math.abs(tg / ownAll[2] - 0.5) < 0.1), `thin to a half keeps its share within a tenth: trees ${tt} of ${ownAll[0]}, grass ${tg} of ${ownAll[2]}`);
  const unthinned = thin.grids.every((x, i) => x.floraNonCollidable.every((v, j) => Object.is(v, ownGrids[i].floraNonCollidable[j])));
  ok(unthinned, 'a class the recipe keeps is the world\'s own by Object.is');

  // The share a thin keeps is the share it names, never its complement, and an amount scales what it takes away: at 0.2
  // and full amount a fifth stands, at 0.2 and half amount 1 - 0.5·0.8 (0.6); a clear at half amount takes about half.
  const halfAmt = 128 / 255;
  const tri = run([{ trees: { thin: 0.2 }, roads: true }], 255);
  const triHalf = run([{ trees: { thin: 0.2 }, roads: true }], 128);
  const clearHalf = run([{ trees: 'clear', roads: true }], 128);
  const k1 = sum(tri.grids, 'floraCollidable') / ownAll[0];
  const k2 = sum(triHalf.grids, 'floraCollidable') / ownAll[0];
  const k3 = sum(clearHalf.grids, 'floraCollidable') / ownAll[0];
  ok(ownAll[0] > 100 && Math.abs(k1 - 0.2) < 0.05 && Math.abs(k2 - (1 - halfAmt * 0.8)) < 0.05, `a thin to a fifth keeps ${k1.toFixed(3)} at full amount (0.2) and ${k2.toFixed(3)} at half amount (${(1 - halfAmt * 0.8).toFixed(3)}): the share it names, scaled by the amount`);
  ok(Math.abs(k3 - (1 - halfAmt)) < 0.05, `a clear at half amount takes about half: ${k3.toFixed(3)} kept (${(1 - halfAmt).toFixed(3)})`);
  // What a thin or clear leaves stands as the world's own (the family and its choice), never another.
  const kept = (grids: { floraCollidable: Uint8Array }[]) => grids.every((x, i) => {
    const o = ownGrids[i].floraCollidable;
    for (let k = 0; k < o.length; k += 2) if (x.floraCollidable[k] !== 0 && (x.floraCollidable[k] !== o[k] || x.floraCollidable[k + 1] !== o[k + 1])) return false;
    return true;
  });
  ok(kept(tri.grids) && kept(triHalf.grids) && kept(clearHalf.grids), 'every tree a thin or a clear leaves is the world\'s own, family and choice');

  // A remove takes one family off and no other: the commonest tree family the world plants here, at full amount every one
  // of it, at half amount about half; every other family by Object.is.
  {
    const counts = new Map<number, number>();
    for (const x of ownGrids) for (let k = 0; k < x.floraCollidable.length; k += 2) if (x.floraCollidable[k]) counts.set(x.floraCollidable[k], (counts.get(x.floraCollidable[k]) ?? 0) + 1);
    const ranked = [...counts].sort((a, b) => b[1] - a[1]);
    const target = ranked[0] ? g.floraGroup.families.get(ranked[0][0]) : undefined;
    if (!target || ranked.length < 2) note(`${world}'s sampled blocks hold fewer than two tree families: the remove's check of the others is skipped`);
    if (target) {
      const rem = run([{ trees: { remove: { pack: world, name: target.name } }, roads: true }], 255);
      const remHalf = run([{ trees: { remove: { pack: world, name: target.name } }, roads: true }], 128);
      let left = 0;
      let leftHalf = 0;
      let othersSame = true;
      rem.grids.forEach((x, i) => {
        const o = ownGrids[i].floraCollidable;
        for (let k = 0; k < o.length; k += 2) {
          if (o[k] === target.id) {
            if (x.floraCollidable[k] === target.id) left++;
            if (remHalf.grids[i].floraCollidable[k] === target.id) leftHalf++;
          } else if (x.floraCollidable[k] !== o[k] || x.floraCollidable[k + 1] !== o[k + 1] || remHalf.grids[i].floraCollidable[k] !== o[k]) othersSame = false;
        }
      });
      const all = ranked[0][1];
      ok(!rem.missing.length && left === 0 && Math.abs(leftHalf / all - (1 - halfAmt)) < 0.1 && othersSame, `a remove of ${target.name} takes every one of its ${all} trees off at full amount and keeps ${(leftHalf / all).toFixed(3)} at half (${(1 - halfAmt).toFixed(3)}), and every other family stands as the world's own${ranked.length < 2 ? ' (no other family here)' : ` (${ranked.length - 1} others)`}`);
    }
  }

  // The feather: a cell's amount reaches the poles round it by the bilinear weights, a whole cell either way. Isolated
  // cells at full amount (one in five each way) over an empty grid, a family added at density one (a pole plants exactly
  // where the coordinate hash's float falls under the amount it is laid): the corner pole every time, a pole half a cell
  // along about half the time, half along both about a quarter, and a pole a whole cell along never.
  {
    const p = new GroundPaint();
    p.resolveRecipes([{ trees: { add: { pack: world, name: tree.name }, density: 1 }, roads: true }], g.floraGroup, g.radialGroup, world);
    const t = p.floraTile(0, 0, true)!;
    for (let cz = 5; cz < 100; cz += 5) for (let cx = 5; cx < 100; cx += 5) {
      const o = (cz * p.n + cx) * 2;
      t[o] = 1;
      t[o + 1] = 255;
    }
    p.boundsAgain();
    const n = 210;
    const d = createChunkData(0, 0, n, 2, g.fractalGroup, g.shaderGroup, g.bitmapGroup, g.floraGroup, g.environmentGroup, g.rampGroup, g.radialGroup);
    p.floraInto(d);
    const on = (i: number, j: number) => d.floraCollidable[(j * n + i) * 2] === tree.id;
    let cells = 0;
    let corner = 0;
    let halfX = 0;
    let halfZ = 0;
    let quarter = 0;
    let away = 0;
    for (let cz = 5; cz < 100; cz += 5) for (let cx = 5; cx < 100; cx += 5) {
      // The cell's corner is at (4 cx, 4 cz): pole (2 cx, 2 cz); poles 2 m along are half a cell, 4 m a whole one.
      const i = 2 * cx;
      const j = 2 * cz;
      cells++;
      if (on(i, j)) corner++;
      if (on(i + 1, j)) halfX++;
      if (on(i - 1, j)) halfX++;
      if (on(i, j + 1)) halfZ++;
      if (on(i, j - 1)) halfZ++;
      if (on(i + 1, j + 1)) quarter++;
      if (on(i - 1, j - 1)) quarter++;
      if (on(i + 2, j)) away++;
      if (on(i, j + 2)) away++;
    }
    const hx = halfX / (2 * cells);
    const hz = halfZ / (2 * cells);
    const q = quarter / (2 * cells);
    ok(corner === cells && away === 0 && Math.abs(hx - 0.5) < 0.1 && Math.abs(hz - 0.5) < 0.1 && Math.abs(q - 0.25) < 0.1, `a cell's amount reaches the poles round it bilinearly: over ${cells} isolated cells the corner pole plants every time, half a cell along ${hx.toFixed(3)} (x) and ${hz.toFixed(3)} (z) of the time (0.5), half along both ${q.toFixed(3)} (0.25), a whole cell along never`);
  }

  // A feathered amount: on an empty map (trees cleared by a first pass of the world's own being empty is not available, so
  // count only poles the world left bare) an add at half the amount plants about half the density.
  const add = (amount: number) => run([{ trees: { add: { pack: world, name: tree.name }, density: 1 }, roads: true }], amount);
  const full = add(255);
  const half = add(128);
  let bare = 0;
  let fullOn = 0;
  let halfOn = 0;
  full.grids.forEach((x, i) => {
    const o = ownGrids[i].floraCollidable;
    for (let k = 0; k < o.length; k += 2) {
      if (o[k] !== 0) continue;
      bare++;
      if (x.floraCollidable[k] === tree.id) fullOn++;
      if (half.grids[i].floraCollidable[k] === tree.id) halfOn++;
    }
  });
  ok(bare > 1000 && fullOn === bare && Math.abs(halfOn / bare - 128 / 255) < 0.1, `an add at density one plants every bare pole at full amount (${fullOn} of ${bare}) and about half at half the amount (${(halfOn / bare).toFixed(3)} against ${(128 / 255).toFixed(3)})`);

  // Roads: the poles the generator marked (`roads`) keep the world's own whatever the recipe, unless it says `roads`. The
  // blocks are found where a road or a river is: up to 600 sampled blocks a world searched for a few that hold one.
  let roadPoles = 0;
  let roadKept = true;
  let roadPainted = true;
  let offRoadSame = true;
  for (const rw of ['tatooine', 'corellia', 'naboo', 'talus', 'rori'].filter((x) => worlds.includes(x))) {
    if (roadPoles > 200) break;
    const lw = loadWorld(rw);
    if (!lw) continue;
    const ls = lw.sampler;
    const lg = lw.template.generator;
    const fam = [...lg.floraGroup.families.values()].find((f) => f.children.length && f.id > 0 && f.id < 256);
    if (!fam) continue;
    const found: { x: number; z: number }[] = [];
    for (const b of sampleBlocks(lw.template, 600, 99)) {
      const st = ls.blockStart(b.bx, b.bz);
      const gr = ls.generate(st.x, st.z, ls.numberOfPoles, ls.poleStep);
      if (gr.roads!.some((v) => v !== 0)) found.push(st);
      if (found.length >= 4) break;
    }
    for (const st of found) {
      const make = (roads: boolean | null) => {
        if (roads === null) return ls.generate(st.x, st.z, ls.numberOfPoles, ls.poleStep);
        const p = new GroundPaint();
        p.resolveRecipes([{ trees: { add: { pack: rw, name: fam.name }, density: 1 }, ...(roads ? { roads: true } : {}) }], lg.floraGroup, lg.radialGroup, rw);
        paintRect(p, st.x - 8, st.z - 8, st.x + 80, st.z + 80, 1, 255);
        ls.paint = p;
        try {
          return ls.generate(st.x, st.z, ls.numberOfPoles, ls.poleStep);
        } finally {
          ls.paint = null;
        }
      };
      const own = make(null);
      const off = make(false);
      const on = make(true);
      for (let k = 0; k < own.roads!.length; k++) {
        if (own.roads![k]) {
          roadPoles++;
          if (off.floraCollidable[k * 2] !== own.floraCollidable[k * 2] || off.floraCollidable[k * 2 + 1] !== own.floraCollidable[k * 2 + 1]) roadKept = false;
          if (on.floraCollidable[k * 2] !== fam.id) roadPainted = false;
        } else if (off.floraCollidable[k * 2] !== on.floraCollidable[k * 2] || off.floraCollidable[k * 2 + 1] !== on.floraCollidable[k * 2 + 1]) offRoadSame = false;
      }
    }
  }
  if (roadPoles) ok(roadKept && roadPainted && offRoadSame, `a road's or a river's ${roadPoles} poles keep the world's own under a recipe that does not say roads, and take it under one that does; every other pole alike either way`);
  else note('no sampled block of a converted world holds a road or a river here (roadByte.test.ts says where they are)');

  // One point's arithmetic is the grid's at every pole (a real-elevation world's planter reads it, and Mustafar's).
  {
    const p = new GroundPaint();
    p.resolveRecipes([{ trees: { add: { pack: world, name: tree.name }, density: 0.7 }, grass: 'clear' }, { trees: { thin: 0.3 }, plants: { add: { pack: world, name: tree.name } } }], g.floraGroup, g.radialGroup, world);
    // A ragged patch of two recipes at feathered amounts.
    for (let cz = 0; cz < 40; cz++) for (let cx = 0; cx < 40; cx++) {
      const t = p.floraTile(0, 0, true)!;
      const o = (cz * p.n + cx) * 2;
      t[o] = (cx + cz) % 3 === 0 ? 0 : 1 + ((cx * 7 + cz) % 2);
      t[o + 1] = t[o] ? 40 + ((cx * 13 + cz * 5) % 216) : 0;
    }
    p.boundsAgain();
    const d = createChunkData(0, 0, 70, 2, g.fractalGroup, g.shaderGroup, g.bitmapGroup, g.floraGroup, g.environmentGroup, g.rampGroup, g.radialGroup);
    // A base of the world's own families to thin and clear.
    for (let i = 0; i < d.floraCollidable.length; i += 2) {
      d.floraCollidable[i] = i % 6 === 0 ? tree.id : 0;
      d.floraCollidable[i + 1] = (i * 7) % 255;
      d.radialNear[i] = i % 4 === 0 ? 1 : 0;
    }
    const base = { trees: d.floraCollidable.slice(), grass: d.radialNear.slice(), plants: d.floraNonCollidable.slice() };
    p.floraInto(d);
    const out = { family: 0, choice: 0 };
    let agree = true;
    for (let z = 0; z < 70; z++) for (let x = 0; x < 70; x++) {
      const i = (z * 70 + x) * 2;
      for (const [c, m, b] of [[0, d.floraCollidable, base.trees], [1, d.floraNonCollidable, base.plants], [2, d.radialNear, base.grass]] as const) {
        p.floraPoint(c, x * 2, z * 2, b[i], b[i + 1], false, out);
        if (out.family !== m[i] || out.choice !== m[i + 1]) agree = false;
      }
    }
    ok(agree, 'one point\'s arithmetic (`floraPoint`) answers the grid\'s at every pole of a ragged patch of two recipes at feathered amounts, all three classes');
  }

  // The worker's copy lays the same flora (fed by the message), at its init and by a paint message.
  {
    const p = new GroundPaint();
    p.resolveRecipes([{ trees: { thin: 0.4 }, grass: { add: { pack: world, name: [...g.radialGroup.families.values()].find((f) => f.children.length)?.name ?? tree.name }, density: 0.8 } }], g.floraGroup, g.radialGroup, world);
    const st = own[0].st;
    paintRect(p, st.x, st.z, st.x + 60, st.z + 60, 1, 200);
    const trn = readFileSync(join(PACKS, world, 'terrain.trn'));
    const bytes = trn.buffer.slice(trn.byteOffset, trn.byteOffset + trn.byteLength) as ArrayBuffer;
    const core = new TerrainWorkerCore();
    core.handle({ type: 'init', trn: bytes.slice(0), layers: [], bitmaps: [], ramps: [], paint: p.message(null, null, true), rev: 1 });
    const later = new TerrainWorkerCore();
    later.handle({ type: 'init', trn: bytes.slice(0), layers: [], bitmaps: [], ramps: [] });
    later.handle({ type: 'paint', rev: 2, paint: p.message(null, null, false, p.flo.keys()) });
    s.paint = p;
    const here = s.generate(st.x, st.z, s.numberOfPoles, s.poleStep);
    s.paint = null;
    const gen = (c: TerrainWorkerCore) => c.handle({ type: 'generate', id: 1, startX: st.x, startZ: st.z, n: s.numberOfPoles, step: s.poleStep }).message as unknown as Record<string, Uint8Array>;
    const same = (m: Record<string, Uint8Array>) => ['floraCollidable', 'floraNonCollidable', 'radialNear', 'radialFar', 'roads'].every((k) => m[k].every((v, i) => Object.is(v, (here as unknown as Record<string, Uint8Array>)[k][i])));
    ok(same(gen(core)) && same(gen(later)), "the worker's paint, handed at its init or by a paint message naming the flora tiles, lays the main thread's flora and road maps by Object.is");
  }

  // Another world's flora, and a family the table has not got, are refused in words and keep the class.
  {
    const p = new GroundPaint();
    const m = p.resolveRecipes([{ trees: { add: { pack: 'elsewhere', name: tree.name } }, grass: { add: { pack: world, name: 'no such family' } }, plants: 'clear' }], g.floraGroup, g.radialGroup, world);
    ok(m.length === 2 && /scatter brush/.test(m[0]) && /no family of that name/.test(m[1]) && p.recOp[4] === FLORA_OPS.keep && p.recOp[6] === FLORA_OPS.keep && p.recOp[5] === FLORA_OPS.clear, "a recipe naming another world's flora or a family the table has not got keeps that class and says why; its other classes stand");
    ok(typeof familyIdOf({ families: new Map([[300, { name: 'x', density: 1 }]]) }, { pack: 'p', name: 'x' }, 'p') === 'string', "a family whose id is past the flora maps' byte is refused");
  }
}

// ---------------------------------------------------------------- Mustafar's baked trees

{
  // A stand-in source with a baked map (every 16 m tile family 7) and nothing generated, as Mustafar's planter reads it.
  const kinds = new Map<number, string>([
    [7, 'appearance/baked_tree.apt'],
    [9, 'appearance/painted_tree.apt'],
  ]);
  const child = (family: number) => ({ familyId: family, appearance: kinds.get(family) as string, weight: 1, shouldSway: false, displacement: 0, period: 0, alignToTerrain: false, shouldScale: false, minScale: 1, maxScale: 1 });
  const paint = new GroundPaint();
  const flora = { families: new Map([[7, { name: 'baked', density: 1 }], [9, { name: 'painted', density: 0.5 }]]) };
  paint.resolveRecipes([{ trees: 'clear' }, { trees: { add: { pack: 'mustafar', name: 'painted' }, density: 1 } }], flora, null, 'mustafar');
  // Recipe 1 (clear) over the raw square x 0..256, z 0..256; recipe 2 (add) over x 256..512.
  paintRect(paint, 0, 0, 252, 120, 1, 255);
  paintRect(paint, 260, 0, 508, 120, 2, 255);
  // A road over raw x 300..400 (inside the adding recipe's reach), as the sampler's `roadAt` answers it.
  let roadOn = false;
  const roadAt = (x: number) => roadOn && x >= 300 && x < 400;
  const src = (p: GroundPaint | null): FloraSource => ({
    template: {
      mapWidthInMeters: 16384,
      flora: { collidable: { tileBorder: 0, tileSize: 16, minimumDistance: 0, maximumDistance: 0, seed: 0 }, nonCollidable: { tileSize: 8, tileBorder: 0, maximumDistance: 50, minimumDistance: 0, seed: 0 }, legacyMap: false, collidableMap: { getValue: () => 7 } as never },
      generator: { floraGroup: { createFlora: (family: number) => (kinds.has(family) ? child(family) : null) } },
    },
    toSwgX: (x) => -x,
    toSwgZ: (z) => z,
    toGameX: (x) => -x,
    toGameZ: (z) => z,
    sampler: { excludedAt: () => false, floraAt: () => ({ family: 0, choice: 0 }), roadAt: (x: number) => roadAt(x) },
    paint: p,
  });
  const modelOf = () => ({ primitives: [{ geometry: new THREE.BoxGeometry(1, 1, 1), material: new THREE.MeshBasicMaterial(), cell: 0 }], radius: 1, height: 4, def: undefined });
  const baked = modelOf();
  const added = modelOf();
  const models = new Map<string, unknown>([[kinds.get(7)!, baked], [kinds.get(9)!, added]]);
  const plantAll = (p: GroundPaint | null) => {
    const planter = new FloraPlanter(src(p), models as never);
    const out: { x: number; z: number; f: string }[] = [];
    // Game chunks over raw x 0..512 (game x -512..0), z 0..256.
    for (let cx = -8; cx < 0; cx++) for (let cz = 0; cz < 4; cz++) {
      const built = planter.buildForChunk(cx, cz, () => 0, []);
      for (let i = 0; i < built.data.n; i++) out.push({ x: built.data.x[i], z: built.data.z[i], f: (built.data.models[i] as unknown) === baked ? 'baked' : (built.data.models[i] as unknown) === added ? 'painted' : '?' });
    }
    return { out, planter };
  };
  const bare = plantAll(null);
  const painted = plantAll(paint);
  const inClear = (x: number, z: number) => -x >= 0 && -x < 248 && z >= 0 && z < 116;
  const inAdd = (x: number, z: number) => -x >= 264 && -x < 504 && z >= 0 && z < 116;
  ok(bare.out.some((p) => inClear(p.x, p.z)) && !painted.out.some((p) => inClear(p.x, p.z)), "Mustafar's baked trees are taken off where a clearing recipe reaches them");
  // Past every painted cell's reach (a cell's amount is laid a whole cell either way): z from 128 on.
  const outside = (list: { x: number; z: number; f: string }[]) => list.filter((p) => p.z >= 128).map((p) => `${p.x},${p.z},${p.f}`).join(';');
  ok(outside(bare.out).length > 0 && outside(bare.out) === outside(painted.out), 'and past every painted cell the baked trees stand where they stood, to the place and the family');
  const inAddNow = painted.out.filter((p) => inAdd(p.x, p.z));
  const addedPainted = painted.planter.missing.size === 0 && inAddNow.length > 0 && inAddNow.length === bare.out.filter((p) => inAdd(p.x, p.z)).length && inAddNow.every((p) => p.f === 'painted');
  ok(addedPainted, 'an adding recipe at density one puts its family on every baked tile it reaches (the same count of trees, the painted family)');

  // A road through the adding recipe's reach (the planter asks the sampler's `roadAt` at each baked tree): a recipe that does
  // not say `roads` leaves the baked trees on it as they were, and one that does paints them as everywhere else.
  roadOn = true;
  const onRoad = (p: { x: number; z: number }) => inAdd(p.x, p.z) && -p.x >= 300 && -p.x < 400;
  const keptOff = plantAll(paint).out;
  const roads = new GroundPaint();
  roads.resolveRecipes([{ trees: 'clear' }, { trees: { add: { pack: 'mustafar', name: 'painted' }, density: 1 }, roads: true }], flora, null, 'mustafar');
  for (const [k, v] of paint.flo) roads.flo.set(k, v.slice());
  roads.boundsAgain();
  const paintedToo = plantAll(roads).out;
  roadOn = false;
  const roadBaked = bare.out.filter(onRoad);
  const offRoadSame = keptOff.filter((p) => inAdd(p.x, p.z) && !onRoad(p)).every((p) => p.f === 'painted');
  ok(roadBaked.length > 0 && keptOff.filter(onRoad).length === roadBaked.length && keptOff.filter(onRoad).every((p) => p.f === 'baked') && offRoadSame, `on a road a recipe that does not say roads leaves Mustafar's ${roadBaked.length} baked trees there as they stood, and paints every other tree it reaches`);
  ok(paintedToo.filter(onRoad).length === roadBaked.length && paintedToo.filter(onRoad).every((p) => p.f === 'painted'), 'and one that says roads paints the trees on the road too');
}

console.log(`\nfloraPaint: ${checks} checks passed`);
