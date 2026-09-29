// The client's own detail levels at run time (steps 7 and 8 of the frame-time wave): the pick with its band
// of hysteresis, the packing by level, the shadow rule, the ride bias and the eye's speed it is read from
// (src/world/lodLevels.ts); a placed model's level group driven from eyes all round it (src/world/levelGroup.ts,
// three under node: each level's store holds exactly the copies the pick puts there, the whole-group shortcuts
// agree with the pick copy by copy, and a sweep allocates nothing); the flora's region batches
// (src/world/floraBatch.ts: chunks coming and going and eyes moving, rebuilt a few regions at a time, must end
// as a from-scratch pack of the same plantings at the same levels); and the world's wiring, read as text.
//
// Run: node --expose-gc tools/swg/tests/lodLevels.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { constants as perfConstants, PerformanceObserver } from 'node:perf_hooks';
import v8 from 'node:v8';
import * as THREE from 'three';
import { drawnLevels, eyeSpeed, LOD_LEVEL_DEFAULTS, LOD_LEVEL_TUNE, levelCasts, levelOf, packLevels, RIDE_LOD_DEFAULTS, rideLodBias, steppedBias, sweepDue, type LodLevelTune, type RideLodTune } from '../../../src/world/lodLevels.ts';
import { LevelGroup } from '../../../src/world/levelGroup.ts';
import { FloraField, packFromScratch, FLORA_REGION, type FloraChunkData } from '../../../src/world/floraBatch.ts';
import type { LoadedModel, ModelLevel, Primitive } from '../../../src/world/assetPack.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/**
 * What `calls` runs of `run` allocate, measured the way the rule reads ("a frame allocates nothing"), not by
 * what survives a collection: the young generation's use before and after with no collection in between, and
 * how many scavenges ran meanwhile (any at all means more was made than the young generation holds). The run
 * is warmed first so what is measured is the optimised code a session runs, and it is handed whole numbers
 * only, since a fractional number in unoptimised code is itself an allocation.
 */
async function allocationOf(run: (i: number) => void, calls: number, warm = 4000): Promise<{ perCall: number; scavenges: number; measured: boolean }> {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (!gc) return { perCall: 0, scavenges: 0, measured: false };
  for (let i = 0; i < warm; i++) run(i);
  let scavenges = 0;
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
  });
  obs.observe({ entryTypes: ['gc'] });
  gc();
  await new Promise((r) => setImmediate(r));
  scavenges = 0;
  const young = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;
  const before = young();
  for (let i = 0; i < calls; i++) run(warm + i);
  const after = young();
  await new Promise((r) => setImmediate(r));
  obs.disconnect();
  return { perCall: Math.max(0, after - before) / calls, scavenges, measured: true };
}

/** A small seeded generator, so a failure repeats. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// The pick.
{
  const nears = [0, 60, 140, 250];
  ok(levelOf(10, nears, 4, 1, 0.1, -1) === 0 && levelOf(60, nears, 4, 1, 0.1, -1) === 1 && levelOf(200, nears, 4, 1, 0.1, -1) === 2 && levelOf(900, nears, 4, 1, 0.1, -1) === 3, 'with no history a copy is at the last level whose switch distance it has reached');
  ok(levelOf(59, nears, 4, 2, 0.1, -1) === 0 && levelOf(121, nears, 4, 2, 0.1, -1) === 1 && levelOf(30, nears, 4, 0.5, 0.1, -1) === 1, 'the scale multiplies every switch distance (a bias over 1 keeps the finest out farther)');
  // Walked out and back across the 60 m line: nothing changes until the whole band is crossed.
  let lv = 0;
  const out: number[] = [];
  for (const d of [50, 58, 61, 63, 65, 67, 64, 58, 55, 53, 50]) {
    lv = levelOf(d, nears, 4, 1, 0.1, lv);
    out.push(lv);
  }
  ok(out.join(',') === '0,0,0,0,0,1,1,1,1,0,0', `a copy walked out and back across a switch holds its level inside the band either side (${out.join(',')})`);
  ok(levelOf(500, nears, 4, 1, 0.1, 1) === 3 && levelOf(5, nears, 4, 1, 0.1, 3) === 0, 'a jump far past the band takes the level the distance picks, both ways');
  ok(levelOf(900, nears, 4, 1, 0.1, -1, 1000) === 3 && levelOf(1050, nears, 4, 1, 0.1, -1, 1000) === 3 && levelOf(1101, nears, 4, 1, 0.1, -1, 1000) === 4 && levelOf(950, nears, 4, 1, 0.1, 4, 1000) === 4 && levelOf(899, nears, 4, 1, 0.1, 4, 1000) === 3, "past the chain's last far (with a band) a copy is drawn at nothing, and comes back only inside the band");
  ok(levelOf(99999, nears, 4, 1, 0.1, -1) === 3, 'with no last far the lowest level holds at any distance');
  ok(levelOf(10, [0], 1, 1, 0.1, -1) === 0 && levelOf(5000, [0], 1, 1, 0.1, -1) === 0, 'a model with one level is always at it');
}

// The packing.
{
  const r = rng(7);
  let good = true;
  const start = new Int32Array(6);
  for (let trial = 0; trial < 200; trial++) {
    const n = Math.floor(r() * 40);
    const levels = new Int8Array(n);
    for (let i = 0; i < n; i++) levels[i] = Math.floor(r() * 5);
    const order = new Int32Array(n);
    packLevels(levels, n, 5, start, order);
    // Naive: each bucket's indices in order.
    let at = 0;
    for (let b = 0; b < 5; b++) {
      if (start[b] !== at) good = false;
      for (let i = 0; i < n; i++) if (levels[i] === b && order[at++] !== i) good = false;
    }
    if (start[5] !== n || at !== n) good = false;
  }
  ok(good, 'a pack by level is a stable counting sort: each level\'s copies in their own order, and where each level begins');
}

// The shadow rule and the sweep's clock.
{
  const t: LodLevelTune = { ...LOD_LEVEL_DEFAULTS };
  ok(levelCasts(true, 0, 3, 0, 30, t) && levelCasts(true, 0, 3, 90, 30, t) && !levelCasts(false, 0, 3, 0, 30, t), 'the finest casts as it always did, wherever the cascades end');
  ok(levelCasts(true, 1, 3, 60, 30, t) && !levelCasts(true, 2, 3, 60, 30, t) && levelCasts(true, 2, 3, 20, 30, t) && !levelCasts(true, 1, 2, 60, 30, t), "the design's rule: the lowest level alone casts nothing once its switch is past the second cascade; the middle one casts as the finest does (the second cascade ends at 31 m at the owner's 80 m shadows, where most middles take over)");
  ok(!levelCasts(true, 1, 3, 60, 30, { ...t, shadowLevelMax: 1 }) && levelCasts(true, 0, 3, 60, 30, { ...t, shadowLevelMax: 9 }) && levelCasts(true, 2, 3, 400, 30, { ...t, shadowLevelMax: -1 }), 'the rule reaches the middle only when asked to, never the finest, and below 0 it is off');
  ok(levelCasts(true, 2, 3, 400, Number.POSITIVE_INFINITY, t) && levelCasts(true, 2, 3, 400, Number.NaN, t), 'with no cascades known every level casts');
  ok(sweepDue(0.25, 0, t) && sweepDue(0, 8, t) && !sweepDue(0.2, 7.9, t), 'a sweep is due every quarter second or eight metres the eye moves');
  const dl = (n: number[]) => drawnLevels(n).join(',');
  ok(dl([0, 60, 250]) === '0,1,2' && dl([0, 450, 400]) === '0,2' && dl([0, 0, 0]) === '0' && dl([0, 200, 150]) === '0,2' && dl([0, 250, 250]) === '0,2' && dl([0, 0, 90]) === '0,2', "only the levels the pick can ever draw are kept: switches that rise, none at the eye, the coarser of two that clash (a chain every switch of which is at 0 is its finest alone)");
  // The pick itself agrees: over every distance, a level `drawnLevels` drops for a switch that does not rise is
  // never picked. (A switch at the eye is dropped on purpose: the pick would draw that level in place of the
  // finest at every distance, which is how one gallery hull drew a level five times its finest's triangles.)
  let dropPicked = 0;
  for (const nears of [[0, 450, 400], [0, 200, 150], [0, 250, 250], [0, 60, 30, 400]]) {
    const keep = new Set(drawnLevels(nears));
    for (let d = 0; d < 1200; d += 7) if (!keep.has(levelOf(d, nears, nears.length, 1, 0, -1))) dropPicked++;
  }
  ok(dropPicked === 0, 'and the pick, given the whole chain, never draws a level that was dropped for a switch that does not rise');
  ok(LOD_LEVEL_TUNE.on === true && LOD_LEVEL_TUNE.bias === 1 && LOD_LEVEL_TUNE.hysteresis === 0.1 && LOD_LEVEL_TUNE.sweepMetres === 8 && LOD_LEVEL_TUNE.sweepSeconds === 0.25 && LOD_LEVEL_TUNE.shadowLevelMax === 0 && LOD_LEVEL_TUNE.regionsPerFrame === 2 && LOD_LEVEL_TUNE.hideBeyond === false && Object.isFrozen(LOD_LEVEL_DEFAULTS), 'the levels ship on as designed: the client\'s own distances, a tenth of band, a sweep each 8 m or quarter second, two flora regions a frame, nothing hidden past a chain');
}

// Step 8: the ride bias.
{
  const on: RideLodTune = { ...RIDE_LOD_DEFAULTS, on: true };
  ok(rideLodBias(0, on) === 1 && rideLodBias(20, on) === 1 && Math.abs(rideLodBias(50, on) - 2) < 1e-9 && Math.abs(rideLodBias(110, on) - 4) < 1e-9 && rideLodBias(150, on) === 5 && rideLodBias(1e6, on) === 5, 'the bias is 1 + (speed - 20) / 30 above 20 m/s, at most 5');
  ok(rideLodBias(150, { ...on, on: false }) === 1, 'and 1 at any speed with it off');
  ok(RIDE_LOD_DEFAULTS.on === false && Object.isFrozen(RIDE_LOD_DEFAULTS), 'it ships off: on a flown trip it saved nothing, and on a ride it cost 1.7 ms at the median and 2.9 at the 95th with the same draws');
  // Stepped: a bias moving a little every frame would re-sweep everything every frame.
  let applied = 1;
  let changes = 0;
  for (let i = 0; i <= 600; i++) {
    const raw = rideLodBias(20 + (130 * i) / 600, on);
    const next = steppedBias(raw, applied, RIDE_LOD_DEFAULTS.step);
    if (next !== applied) changes++;
    applied = next;
  }
  ok(changes <= 17 && applied === 5, `a speed rising smoothly from 20 to 150 m/s over 600 frames changes the bias in force ${changes} times, in quarter steps, not on every frame`);
  ok(steppedBias(1, 2.5, 0.25) === 1 && steppedBias(2.6, 2.5, 0.25) === 2.5 && steppedBias(2.8, 2.5, 0.25) === 2.75 && steppedBias(3.3, 3.3, 0) === 3.3, 'back to 1 at once when the speed falls under the threshold, held within a step, and followed exactly with no step');
  let v = 0;
  for (let i = 0; i < 180; i++) v = eyeSpeed(v, 150 / 60, 1 / 60, on);
  ok(Math.abs(v - 150) < 1, `the eye's speed eases to a steady 150 m/s within three seconds (${v.toFixed(1)})`);
  const before = v;
  v = eyeSpeed(v, 4000, 1 / 60, on);
  ok(v === before && eyeSpeed(v, 1, 0, on) === before, 'a teleport is not a speed, and a frame of no time changes nothing');
}

// ---------------------------------------------------------------------------------------------
// A placed model's level group, with three under node.
const geo = new THREE.BoxGeometry(2, 2, 2);
const mat = (name: string): THREE.Material => {
  const m = new THREE.MeshBasicMaterial();
  m.name = name;
  return m;
};
const prim = (name: string): Primitive => ({ geometry: geo, material: mat(name), cell: -1 });

{
  const levels: ModelLevel[] = [
    { near: 0, far: 60, level: 0, primitives: [prim('fine-a'), prim('fine-b')] },
    { near: 60, far: 250, level: 2, primitives: [prim('mid')] },
    { near: 250, far: 1000, level: 3, primitives: [prim('low')] },
  ];
  const r = rng(11);
  const copies = Array.from({ length: 300 }, () => ({ x: (r() - 0.5) * 1200, y: 0, z: (r() - 0.5) * 1200, q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28) }));
  const scene = new THREE.Scene();
  const made: THREE.InstancedMesh[] = [];
  const g = new LevelGroup(copies, levels, new THREE.Vector3(0, 1, 0), 1.8, (p, n) => {
    const mesh = new THREE.InstancedMesh(p.geometry, p.material, n);
    mesh.castShadow = true;
    scene.add(mesh);
    made.push(mesh);
    return mesh;
  }, true);
  ok(made.length === 4 && g.draws.length === 3 && g.draws[0].meshes.length === 2 && g.draws[0].meshes[0].instanceMatrix === g.draws[0].meshes[1].instanceMatrix, "a mesh for every piece of every level, the pieces of one level reading one instance store");
  ok(g.draws[0].count === 300 && g.draws[1].count === 0 && g.draws[2].count === 0 && made.filter((m) => m.visible).length === 2, 'before any sweep every copy is at the finest, which is what the streamer drew before, and an empty level is hidden');
  // Every sweep's stores hold exactly the copies the pick puts at each level, and what the card is handed
  // matches: a store whose copies changed is marked for upload (its version rises) over a range covering
  // every copy it holds, and each mesh's sphere (what the frustum, the cascades and the exit narrowing test)
  // holds every copy it draws.
  const tmp = new THREE.Matrix4();
  const expect = new THREE.Matrix4();
  let badLevel = 0;
  let badMatrix = 0;
  let badCount = 0;
  let badUpload = 0;
  let badSphere = 0;
  let uploads = 0;
  let shortcuts = 0;
  const lvPrev = new Int8Array(300).fill(0);
  const membersOf = (k: number): string => Array.from({ length: 300 }, (_, i) => i).filter((i) => g.level[i] === k).join(',');
  // What each level's store held, and its version, as the last sweep left them.
  const members: string[] = g.draws.map((_, k) => membersOf(k));
  const versions: number[] = g.draws.map((d) => d.attr.version);
  const f = Math.fround;
  const close = (a: THREE.Matrix4, b: THREE.Matrix4) => a.elements.every((v, i) => Math.abs(v - b.elements[i]) < 1e-3);
  const at = new THREE.Vector3();
  /** The checks after one sweep, from the copies' own places. */
  const checkGroup = (ex: number, ey: number, ez: number): void => {
    for (let i = 0; i < 300; i++) {
      const c = copies[i];
      // The group keeps each copy's middle in single precision.
      const want = levelOf(Math.sqrt((f(c.x) - ex) ** 2 + (f(c.y + 1) - ey) ** 2 + (f(c.z) - ez) ** 2), [0, 60, 250], 3, 1, 0.1, lvPrev[i]);
      if (g.level[i] !== want) badLevel++;
      lvPrev[i] = g.level[i];
    }
    for (let k = 0; k < 3; k++) {
      const d = g.draws[k];
      let n = 0;
      for (let i = 0; i < 300; i++) {
        if (g.level[i] !== k) continue;
        tmp.fromArray(d.attr.array as Float32Array, n * 16);
        expect.compose(new THREE.Vector3(copies[i].x, copies[i].y, copies[i].z), copies[i].q, new THREE.Vector3(1, 1, 1));
        if (!close(tmp, expect)) badMatrix++;
        for (const m of d.meshes) if (!m.boundingSphere || !m.boundingSphere.containsPoint(at.set(copies[i].x, copies[i].y, copies[i].z))) badSphere++;
        n++;
      }
      if (n !== d.count || d.meshes.some((m) => m.count !== n || m.visible !== n > 0)) badCount++;
      const key = membersOf(k);
      if (key !== members[k] && n > 0) {
        // Changed: marked for upload, over at least every copy it holds.
        const range = d.attr.updateRanges[0];
        if (d.attr.version === versions[k] || !range || range.start > 0 || range.start + range.count < n * 16) badUpload++;
        uploads++;
      }
      members[k] = key;
      versions[k] = d.attr.version;
    }
  };
  for (let trial = 0; trial < 150; trial++) {
    const ex = (r() - 0.5) * 3000;
    const ez = (r() - 0.5) * 3000;
    const ey = r() * 200;
    const settledBefore = (g as unknown as { settled: number }).settled;
    g.sweep(ex, ey, ez, 1, 30);
    if ((g as unknown as { settled: number }).settled >= 0 && settledBefore !== (g as unknown as { settled: number }).settled) shortcuts++;
    checkGroup(ex, ey, ez);
  }
  ok(badLevel === 0 && badMatrix === 0 && badCount === 0, `over 150 eyes all round it, every copy is at the level the pick gives it (the band included), and each level's store holds exactly those copies in order, shown only when it holds any (${badLevel}, ${badMatrix}, ${badCount} wrong)`);
  ok(badUpload === 0 && uploads > 20, `every store whose copies changed is marked for upload over a range holding all of them (${uploads} uploads, ${badUpload} wrong)`);
  ok(badSphere === 0, "and every level mesh's sphere holds every copy it draws, so the frustum, the cascades and the exit narrowing never cull one that stands in view");
  ok(shortcuts > 0, `the whole group is settled at once where every copy is past its lowest switch or inside its first (${shortcuts} times)`);
  // The shadow rule: the lowest level, whose switch (250 m) is past a 30 m second cascade, casts nothing; the middle one casts.
  g.sweep(0, 0, 0, 1, 30);
  ok(g.draws[0].meshes.every((m) => m.castShadow) && g.draws[1].meshes.every((m) => m.castShadow) && g.draws[2].meshes.every((m) => !m.castShadow), 'the lowest level, whose switch is past the second cascade, casts nothing; the finest and the middle cast as the finest did');
  g.sweep(0, 0, 0, 1, Number.POSITIVE_INFINITY);
  ok(g.draws[2].meshes.every((m) => m.castShadow), 'and it casts again once no cascade is known, with nothing repacked');
  g.sweep(0, 0, 0, 1, 300);
  ok(g.draws[2].meshes.every((m) => m.castShadow), 'or once the second cascade reaches past its switch');
  // The rule's reach moved from the console: the next sweep follows it with nothing repacked.
  g.sweep(0, 0, 0, 1, 30);
  LOD_LEVEL_TUNE.shadowLevelMax = 1;
  g.sweep(0, 0, 0, 1, 30);
  const reachMiddle = g.draws[1].meshes.every((m) => !m.castShadow) && g.draws[2].meshes.every((m) => !m.castShadow) && g.draws[0].meshes.every((m) => m.castShadow);
  LOD_LEVEL_TUNE.shadowLevelMax = -1;
  g.sweep(0, 0, 0, 1, 30);
  const reachOff = g.meshes.every((m) => m.castShadow);
  LOD_LEVEL_TUNE.shadowLevelMax = LOD_LEVEL_DEFAULTS.shadowLevelMax;
  g.sweep(0, 0, 0, 1, 30);
  ok(reachMiddle && reachOff && g.draws[1].meshes.every((m) => m.castShadow) && g.draws[2].meshes.every((m) => !m.castShadow), 'the rule reaching the middle, off, and back as shipped, each taken by the next sweep with the eye and the cascades where they were');
  // Off: every copy at the finest.
  LOD_LEVEL_TUNE.on = false;
  g.sweep(2000, 0, 2000, 1, 30);
  ok(g.draws[0].count === 300 && g.draws[1].count === 0 && g.draws[2].count === 0, 'with the levels switched off every copy is drawn at its finest, wherever the eye is');
  LOD_LEVEL_TUNE.on = true;
  // Not ready: nothing shown until its programs exist.
  const h = new LevelGroup(copies.slice(0, 10), levels, new THREE.Vector3(), 1, (p, n) => new THREE.InstancedMesh(p.geometry, p.material, n), false);
  ok(h.meshes.every((m) => !m.visible), 'a group whose programs do not exist yet shows nothing');
  h.setReady();
  ok(h.draws[0].meshes.every((m) => m.visible) && h.draws[1].meshes.every((m) => !m.visible), 'and once they do, each level as its copies say');
  // Nothing allocated by sweeps, repacks included: the eye hops about the group so nearly every sweep repacks.
  let repacked = 0;
  const alloc = await allocationOf((i) => {
    if (g.sweep(((i * 37) % 61) * 20 - 600, 3, ((i * 53) % 59) * 20 - 600, 1, 30)) repacked++;
  }, 3000);
  if (alloc.measured) ok(alloc.scavenges === 0 && alloc.perCall < 16 && repacked > 1500, `3,000 sweeps, ${repacked} of them repacking, allocate nothing: ${alloc.perCall.toFixed(1)} bytes a sweep, ${alloc.scavenges} collections of the young generation`);
  else console.log('skip  run with --expose-gc to check that a sweep allocates nothing');
}

// A small cluster walked away from and back, a metre at a time, across every switch: the whole-group
// shortcuts must never settle it where the pick, band and all, would not have each copy.
{
  const levels: ModelLevel[] = [
    { near: 0, far: 60, level: 0, primitives: [prim('fine')] },
    { near: 60, far: 250, level: 2, primitives: [prim('mid')] },
    { near: 250, far: 1000, level: 3, primitives: [prim('low')] },
  ];
  const r = rng(5);
  const copies = Array.from({ length: 20 }, () => ({ x: r() * 4, y: 0, z: r() * 4, q: new THREE.Quaternion() }));
  const g = new LevelGroup(copies, levels, new THREE.Vector3(0, 1, 0), 1.8, (p, n) => new THREE.InstancedMesh(p.geometry, p.material, n), true);
  const prev = new Int8Array(20).fill(0);
  const f = Math.fround;
  let bad = 0;
  let settles = 0;
  const path: number[] = [];
  for (let x = 0; x <= 400; x++) path.push(x);
  for (let x = 400; x >= 0; x--) path.push(x);
  for (const x of path) {
    const before = (g as unknown as { settled: number }).settled;
    g.sweep(x, 1, 2, 1, 30);
    if ((g as unknown as { settled: number }).settled >= 0 && (g as unknown as { settled: number }).settled !== before) settles++;
    for (let i = 0; i < 20; i++) {
      const c = copies[i];
      const want = levelOf(Math.sqrt((f(c.x) - x) ** 2 + (f(c.y + 1) - 1) ** 2 + (f(c.z) - 2) ** 2), [0, 60, 250], 3, 1, 0.1, prev[i]);
      if (g.level[i] !== want) bad++;
      prev[i] = g.level[i];
    }
  }
  ok(bad === 0 && settles >= 2, `walked out 400 m and back a metre at a time, every copy of a small cluster is where the pick puts it at every step, the shortcuts settling it whole ${settles} times and never inside a band`);
}

// ---------------------------------------------------------------------------------------------
// The flora's region batches.
{
  const r = rng(23);
  const mk = (name: string, levelCount: number): LoadedModel => {
    const primitives = [prim(`${name}-0a`), prim(`${name}-0b`)];
    const levels: ModelLevel[] | null = levelCount > 1 ? Array.from({ length: levelCount }, (_, k) => ({ near: k === 0 ? 0 : 25 * k * k, far: 1000, level: k, primitives: k === 0 ? primitives : [prim(`${name}-${k}`)] })) : null;
    return { def: { id: name, file: '', bounds: { min: [-1, 0, -1], max: [1, 2, 1] }, triangles: 12 }, scene: new THREE.Group(), primitives, radius: 1 + r() * 2, height: 2, interiorBoxes: [], bounds: new THREE.Box3(), portals: [], levels };
  };
  const models = [mk('tree', 3), mk('shrub', 2), mk('rock', 1), mk('palm', 4)];
  const chunkOf = (cx: number, cz: number): { cx: number; cz: number; data: FloraChunkData; flags: { group: { visible: boolean }; trees: { visible: boolean }; plants: { visible: boolean } } } => {
    const n = Math.floor(r() * 30);
    const data: FloraChunkData = { n, models: [], mats: new Float32Array(n * 16), x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), scale: new Float32Array(n), collidable: new Uint8Array(n) };
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const x = cx * 64 + r() * 64;
      const z = cz * 64 + r() * 64;
      const s = 0.7 + r() * 0.8;
      data.models.push(models[Math.floor(r() * models.length)]);
      m4.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)).toArray(data.mats, i * 16);
      data.x[i] = x;
      data.z[i] = z;
      data.scale[i] = s;
      data.collidable[i] = r() < 0.3 ? 1 : 0;
    }
    return { cx, cz, data, flags: { group: { visible: true }, trees: { visible: true }, plants: { visible: true } } };
  };
  const root = new THREE.Group();
  let madeMeshes = 0;
  const field = new FloraField(root, () => madeMeshes++);
  const live = new Map<string, ReturnType<typeof chunkOf>>();
  const levelCount = (m: LoadedModel) => (m.levels ? m.levels.length : 1);
  // Each planting's level worked out here, apart from the field: by the pick from its own distance, with the
  // band against the level this test last gave it, and "not drawn" (the level count) where the reach or the
  // ground hides it, which also forgets its history.
  const expected = new Map<string, Int8Array>();
  const expectLevels = (ex: number, ey: number, ez: number, scale: number): void => {
    for (const [key, c] of live) {
      const exp = expected.get(key)!;
      for (let i = 0; i < c.data.n; i++) {
        const m = c.data.models[i];
        const count = levelCount(m);
        const shown = c.flags.group.visible && (c.data.collidable[i] ? c.flags.trees.visible : c.flags.plants.visible);
        if (!shown) exp[i] = count;
        else if (count <= 1) exp[i] = 0;
        else {
          const dx = c.data.x[i] - ex;
          const dy = c.data.y[i] - ey;
          const dz = c.data.z[i] - ez;
          exp[i] = levelOf(Math.sqrt(dx * dx + dy * dy + dz * dz), m.levels!.map((l) => l.near), count, scale, LOD_LEVEL_TUNE.hysteresis, exp[i] >= count ? -1 : exp[i]);
        }
      }
    }
  };
  let mismatches = 0;
  let wrongLevel = 0;
  let wrongCast = 0;
  let staleCast = 0;
  let badUpload = 0;
  let badSphere = 0;
  let rounds = 0;
  let coarse = 0;
  const at = new THREE.Vector3();
  const FARS = [30, Number.POSITIVE_INFINITY, 80, 12];
  /** Every batch's shadow against the rule, from what the test itself packed (the biggest planting's scale per batch). */
  const castsWrong = (scale: number, maxScale: Map<string, number>): number => {
    let wrong = 0;
    for (const b of field.batches()) {
      const levels = b.model.levels;
      const count = levels ? levels.length : 1;
      const base = b.model.radius * (maxScale.get(`${b.region}|${b.model.def.id}|${b.level}`) ?? 0) >= 1.2;
      const cast = levelCasts(base, b.level, count, (levels ? levels[b.level].near : 0) * scale, field.cascadeFar);
      for (const mesh of b.meshes) if (mesh.castShadow !== cast) wrong++;
    }
    return wrong;
  };
  for (let step = 0; step < 60; step++) {
    // Chunks come and go round a wandering centre.
    const px = Math.floor((r() - 0.5) * 20);
    const pz = Math.floor((r() - 0.5) * 20);
    for (let k = 0; k < 12; k++) {
      const cx = px + Math.floor((r() - 0.5) * 12);
      const cz = pz + Math.floor((r() - 0.5) * 12);
      const key = `${cx},${cz}`;
      if (live.has(key) && r() < 0.5) {
        field.remove(key);
        live.delete(key);
        expected.delete(key);
      } else if (!live.has(key)) {
        const c = chunkOf(cx, cz);
        live.set(key, c);
        expected.set(key, new Int8Array(c.data.n).fill(-1));
        field.add(key, cx, cz, c.data, c.flags);
      }
    }
    // The reach hides some chunks' plants, a basement some chunk's ground.
    for (const c of live.values()) {
      c.flags.plants.visible = r() < 0.7;
      c.flags.group.visible = r() < 0.95;
    }
    field.cascadeFar = FARS[step % FARS.length];
    const ex = px * 64 + r() * 64;
    const ez = pz * 64 + r() * 64;
    const scale = 0.5 + r();
    field.sweep(ex, 20, ez, scale);
    expectLevels(ex, 20, ez, scale);
    // A few regions a frame, until none waits.
    let guard = 0;
    while (field.pending && guard++ < 1000) field.rebuild(2);
    rounds++;
    // The field's levels against the ones worked out here.
    for (const [key, c] of live) {
      const lv = field.levelsOfChunk(key)!;
      const exp = expected.get(key)!;
      for (let i = 0; i < c.data.n; i++) {
        if (lv[i] !== exp[i]) wrongLevel++;
        if (exp[i] > 0 && exp[i] < levelCount(c.data.models[i])) coarse++;
      }
    }
    // Every region's batches against a from-scratch pack of the same plantings at the levels worked out here.
    const want = packFromScratch([...live.entries()].map(([key, c]) => ({ cx: c.cx, cz: c.cz, data: c.data, level: expected.get(key)! })), levelCount);
    const have = field.snapshot();
    // The biggest planting's scale in each batch, by that same pack.
    const maxScale = new Map<string, number>();
    const per = FLORA_REGION / 64;
    for (const [key, c] of live) {
      const exp = expected.get(key)!;
      const rk = `${Math.floor(c.cx / per)},${Math.floor(c.cz / per)}`;
      for (let i = 0; i < c.data.n; i++) {
        const m = c.data.models[i];
        if (exp[i] < 0 || exp[i] >= levelCount(m)) continue;
        const k = `${rk}|${m.def.id}|${exp[i]}`;
        maxScale.set(k, Math.max(maxScale.get(k) ?? 0, c.data.scale[i]));
      }
    }
    wrongCast += castsWrong(scale, maxScale);
    // Where the second cascade ends moved with no rebuild at all: every batch's shadow follows at once.
    field.cascadeFar = FARS[(step + 1) % FARS.length];
    staleCast += castsWrong(scale, maxScale);
    field.cascadeFar = FARS[step % FARS.length];
    // And the rule's own reach moved from the console: the next sweep (the same eye, so no level moves) follows it.
    if (step % 10 === 5) {
      for (const reachTo of [1, -1, 0]) {
        LOD_LEVEL_TUNE.shadowLevelMax = reachTo;
        field.sweep(ex, 20, ez, scale);
        if (field.pending) staleCast++;
        staleCast += castsWrong(scale, maxScale);
      }
      LOD_LEVEL_TUNE.shadowLevelMax = LOD_LEVEL_DEFAULTS.shadowLevelMax;
    }
    // What the card is handed: a store marked for upload over every planting it holds, and each mesh's
    // sphere holding every planting it draws.
    for (const b of field.batches()) {
      if (!b.count || !b.attr) continue;
      const range = b.attr.updateRanges[0];
      if (b.attr.version === 0 || !range || range.start > 0 || range.start + range.count < b.count * 16) badUpload++;
      const a = b.attr.array as Float32Array;
      for (let j = 0; j < b.count; j++) {
        at.set(a[j * 16 + 12], a[j * 16 + 13], a[j * 16 + 14]);
        for (const mesh of b.meshes) if (!mesh.boundingSphere || !mesh.boundingSphere.containsPoint(at)) badSphere++;
      }
    }
    const canon = (rows: ArrayLike<number>): string => {
      const mats: string[] = [];
      for (let i = 0; i < rows.length; i += 16) mats.push(Array.from(rows).slice(i, i + 16).map((v) => v.toFixed(3)).join(','));
      return mats.sort().join('|');
    };
    for (const [key, byModel] of want) {
      const got = have.get(key);
      for (const [m, rows] of byModel) {
        for (let lv = 0; lv < rows.length; lv++) {
          const g = got?.get(m)?.[lv] ?? new Float32Array(0);
          if (canon(rows[lv]) !== canon(g)) mismatches++;
        }
      }
    }
    // And nothing drawn that the pack does not hold.
    for (const [key, byModel] of have) {
      for (const [m, rows] of byModel) {
        for (let lv = 0; lv < rows.length; lv++) {
          const w = want.get(key)?.get(m)?.[lv];
          if (rows[lv].length && !w) mismatches++;
        }
      }
    }
    // The levels themselves: a hidden planting is not drawn, a drawn one is at the pick.
    for (const [key, c] of live) {
      const lv = field.levelsOfChunk(key)!;
      for (let i = 0; i < c.data.n; i++) {
        const shown = c.flags.group.visible && (c.data.collidable[i] ? c.flags.trees.visible : c.flags.plants.visible);
        const count = levelCount(c.data.models[i]);
        if (!shown && lv[i] !== count) mismatches++;
        if (shown && !(lv[i] >= 0 && lv[i] < count)) mismatches++;
      }
    }
  }
  ok(wrongLevel === 0 && coarse > 200, `over ${rounds} rounds every planting is at the level the pick gives it from its own distance, the band, the scale and the reach included, worked out apart from the field (${wrongLevel} wrong; ${coarse} drawn at a coarser level)`);
  ok(mismatches === 0, `and the batches, rebuilt two regions at a time as chunks come and go, the reach and the ground hide some and the eye moves, end as a from-scratch pack of those plantings at those levels, region by region`);
  ok(wrongCast === 0 && staleCast === 0, `every batch casts by the rule (the lowest level nothing once its switch is past the second cascade) after each rebuild, and again the moment the cascade's end moves with nothing rebuilt (${wrongCast}, ${staleCast} wrong)`);
  ok(badUpload === 0 && badSphere === 0, `every batch holding plantings is marked for upload over all of them, and its meshes' spheres hold every planting they draw (${badUpload}, ${badSphere} wrong)`);
  ok(madeMeshes > 0 && root.children.length > 0, `and the batches are real meshes under the root (${root.children.length})`);
  const drawn = root.children.filter((o) => o.visible).length;
  const counted = (root.children as THREE.InstancedMesh[]).filter((m) => m.count > 0).length;
  ok(drawn === counted, 'a batch is shown only while it holds a planting');
  field.setShown(false);
  ok(root.children.every((o) => !o.visible), 'with the switch off no batch is shown (the chunks draw their own)');
  field.setShown(true);
  ok(root.children.filter((o) => o.visible).length === counted, 'and on again, the same batches as before');
  const regionsBefore = field.measure().regions;
  for (const key of [...live.keys()]) field.remove(key);
  field.rebuild(Number.POSITIVE_INFINITY);
  ok(field.measure().regions === 0 && root.children.length === 0 && regionsBefore > 0, 'a region every chunk has left is let go whole: its meshes out of the root');
  // A steady walk over a fixed field: after one pass over the path (which grows every batch it will need),
  // the sweeps and the rebuilds they cause allocate nothing.
  for (let cx = -6; cx < 6; cx++) {
    for (let cz = -3; cz < 3; cz++) {
      const c = chunkOf(cx, cz);
      field.add(`${cx},${cz}`, cx, cz, c.data, c.flags);
    }
  }
  field.cascadeFar = 30;
  field.rebuild(Number.POSITIVE_INFINITY);
  const rebuiltBefore = field.stats.rebuilds;
  const walk = await allocationOf((i) => {
    const t = i % 400;
    field.sweep((t < 200 ? t : 400 - t) * 4 - 400, 20, 32, 1);
    field.rebuild(2);
  }, 2400, 2400);
  const rebuilt = field.stats.rebuilds - rebuiltBefore;
  if (walk.measured) ok(walk.scavenges === 0 && walk.perCall < 16 && rebuilt > 500, `2,400 frames of a walk back and forth, ${rebuilt} region rebuilds in all, allocate nothing: ${walk.perCall.toFixed(1)} bytes a frame, ${walk.scavenges} collections of the young generation`);
  else console.log('skip  run with --expose-gc to check that the flora allocates nothing');
  field.dispose();
  ok(root.children.length === 0, 'and a field let go takes every batch out of the root');
  ok(FLORA_REGION === 256, 'a flora region is the placed objects\' own 256 m');
}

// ---------------------------------------------------------------------------------------------
// The wiring, read as text: world.ts, the streamer and main.ts drag the whole game in.
{
  const src = (p: string) => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const world = src('world/world.ts');
  const stream = src('world/layoutStream.ts');
  const pack = src('world/assetPack.ts');
  const main = src('main.ts');
  ok(/perf\.begin\(SEC\.levels\);\s*this\.sweepDetail\(camPos, dt\);\s*perf\.end\(SEC\.levels\);/.test(world), 'every update puts the placed objects and the plants at their levels from the eye');
  ok(/this\.streamFar\(center, Infinity\);[\s\S]{0,400}this\.sweepDetail\(center, 0, true\);/.test(world), 'and an arrival does it behind the screen, every flora region written at once');
  ok(/private disposeChunk\(c: Chunk\): void \{\s*this\.floraField\?\.remove\(c\.key\);/.test(world) && /this\.floraField\.add\(key, cx, cz, floraData, chunk\);/.test(world), 'a chunk made hands its plantings to the region batches, and one dropped takes them back');
  ok(/this\.floraField\?\.dispose\(\);\s*this\.floraField = null;\s*this\.flora = null;/.test(world), 'a world let go disposes the batches before it lets go of the planter');
  ok(/plantReachOf\(this\.floraTemplate, FLORA_TUNE\) \/ this\.rideBias/.test(world), 'the plant reach is divided by the ride bias');
  ok(/const scale = LOD_LEVEL_TUNE\.bias \/ this\.rideBias;/.test(world) && /this\.rideBias = steppedBias\(rideLodBias\(this\.eyeSpeedNow, RIDE_LOD_TUNE\), this\.rideBias, RIDE_LOD_TUNE\.step\);/.test(world), "the switch distances are the tune's bias over the ride's, and the ride's moves in steps");
  ok(/ff\.rebuild\(force \|\| this\.behindScreen \? Number\.POSITIVE_INFINITY : LOD_LEVEL_TUNE\.regionsPerFrame\);/.test(world), 'every waiting flora region is rebuilt at once behind a screen or when forced (an arrival), a few a frame otherwise');
  ok(/this\.floraField = null;\s*if \(!this\.sceneOnly\) \{\s*this\.floraField = new FloraField\(/.test(world), "a captured place draws its flora per chunk at its finest, as the plant reach keeps every plant there, and never waits on a batch a scene's first frame is drawn before");
  ok(/if \(t\.levels\.length\) \{\s*const gone = new Set\(t\.levels\);[\s\S]{0,160}this\.levelGroups\.length = k;/.test(stream) && /const lg = this\.levelOfMesh\.get\(mesh\);\s*if \(lg\) \{\s*lg\.setReady\(\);/.test(stream), 'a tier unloaded takes its level groups with it, and a tier revealed shows each level as its copies say');
  ok(/const shell = model\.def\.cells\?\.find\(\(c\) => c\.index === 0\)\?\.bounds;/.test(stream), "a portal building's copies are measured from its shell cell's box, which is what its levels draw, never the box of all its rooms");
  ok(/if \(levelled && levelled\.length && prim\.cell <= 0\) all = all\.filter\(\(p\) => p\.contained\);/.test(stream), "a levelled model's outdoor copies are drawn by its level group and nowhere else; its copies in rooms keep the finest");
  ok(/for \(const lv of lowerLevels\(m\)\) for \(const prim of lv\.primitives\) out\.push\(prim\.material\);/.test(pack), "a pack's lower levels' materials are among the ones a world forgets before the pack disposes them");
  ok(/const kept = drawnLevels\(lods\.map\(\(l\) => l\.near\)\);\s*if \(kept\.length < 2\) return null;/.test(pack), 'a pack converted before the converter dropped the levels the pick can never draw is read with only the ones it can');
  ok(/registerPerfSwitch\('lodLevels'/.test(main) && /registerPerfSwitch\('floraRegions'/.test(main) && /registerPerfSwitch\('rideLodBias'/.test(main), 'the three switches are registered with the frame report');
}

console.log(`\n${checks} checks passed`);
