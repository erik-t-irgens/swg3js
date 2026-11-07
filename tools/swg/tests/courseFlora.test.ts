// The race drawer's second wave: what grows and stands on a drawn course's road is kept off it (DESIGN.md §2.7). On a real
// `FloraPlanter` over a stand-in terrain and a real Rapier world in node: with no course the planting is afcf394's by
// identity (that commit's `flora.ts` out of git beside today's, and a trace recorded from it held with or without git);
// after a course lands no planting stands within the road
// plus its track's `clear`, exactly those that did are gone, and every planting left stands on the carved ground, its
// colliders with it. No procedural prop stands there (held as text: `props.ts` does not load in node). The grass's and the
// far cards' masks: a tuft or a card on a road whose course keeps its grass clear is left out, every other placed as
// before, and a square no course reaches is no mask at all.
//
// Run: node tools/swg/tests/courseFlora.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Physics } from '../../../src/core/physics.ts';
import { FloraPlanter } from '../../../src/world/flora.ts';
import { plantingColliders } from '../../../src/world/chunkPhysics.ts';
import { CHUNK_SIZE } from '../../../src/world/terrain.ts';
import { CourseCarve, type CarveTrack } from '../../../src/swg/terrain/courseCarve.ts';
import { FAR_CARD_DEFAULTS, GRASS_DEFAULTS, GRASS_SWAY_DEFAULTS, candidateCapacity, fillRoadMask, onRoadMask, placeFarCards, placeGrass, placeStats, roadMask, tuftBuffers, type FarSamples, type GrassWorld } from '../../../src/world/grassMath.ts';
import { SWAY_DEFAULTS } from '../../../src/world/swayMath.ts';
import { SwgTerrain } from '../../../src/world/swgTerrain.ts';
import { groundChunkOrigin } from '../../../src/world/groundTiles.ts';
import { shaderKey } from '../../../src/swg/terrain/shaderKey.ts';
import type { RadialChild } from '../../../src/swg/terrain/flora.ts';
import type { RadialShaderEntry } from '../../../src/swg/terrain/radialFile.ts';
import { form, chunk, W, encode, ihdr, mfrc } from './iffWriter.ts';
import { afd, header, rfam } from './radialFixture.ts';
import { node, straight, track } from './carveFixtures.ts';
import { loadOld } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

const storeOf = (ts: CarveTrack[]): CourseCarve => {
  const s = new CourseCarve();
  s.set(ts);
  return s;
};

// ---------------------------------------------------------------- 1. the planter

// A stand-in terrain whose collidable flora map plants a tree on every 16 m tile (the raw frame's x is the game's mirrored).
const kinds = new Map<number, string>([[1, 'appearance/parts_tree.apt']]);
const child = (family: number) => ({ familyId: family, appearance: kinds.get(family) as string, weight: 1, shouldSway: false, displacement: 0, period: 0, alignToTerrain: false, shouldScale: false, minScale: 1, maxScale: 1 });
const swg = {
  template: {
    mapWidthInMeters: 16384,
    flora: { collidable: { tileBorder: 0.4 }, nonCollidable: { tileSize: 8, tileBorder: 0, maximumDistance: 50 }, legacyMap: true, collidableMap: null },
    generator: { floraGroup: { createFlora: (family: number) => (kinds.has(family) ? child(family) : null) } },
  },
  toSwgX: (x: number) => -x,
  toSwgZ: (z: number) => z,
  toGameX: (x: number) => -x,
  toGameZ: (z: number) => z,
  sampler: {
    excludedAt: () => false,
    floraAt: (_x: number, _z: number, collidable: boolean) => (collidable ? { family: 1, choice: 0.5 } : { family: 0, choice: 0 }),
  },
};
const model = (radius: number, height: number, def: unknown) => ({ primitives: [{ geometry: new THREE.BoxGeometry(1, 1, 1), material: new THREE.MeshBasicMaterial(), cell: 0 }], radius, height, def });
const models = new Map<string, unknown>([['appearance/parts_tree.apt', model(2, 8, { collision: { kind: 'cylinder', shapes: [{ t: 'cyl', c: [0, 0, 0], r: 0.6, h: 6 }] } })]]);
const rawGround = (x: number, z: number) => 20 + x * 0.03 - z * 0.02;
// A road along raw z at raw x 32 (game x -32), 16 m wide, 6 m over the ground, through chunks (-1, 0) and (-1, 1); its
// track keeps 2 m clear past it (so its shoulder reaches past what is kept clear).
const road = track('road', 'sprint', [{ id: 'main', nodes: [node(32, -200, 28, { w: 16, sh: 8, c: 'straight' }), node(32, 300, 18, { w: 16, sh: 8, c: 'straight' })] }], {}, 2);
const course = storeOf([road]);
const carved = (gx: number, gz: number) => course.carveAt(rawGround(-gx, gz), -gx, gz);
const flat = (gx: number, gz: number) => rawGround(-gx, gz);
const onCourse = (gx: number, gz: number) => course.roadAt(-gx, gz, 0);
const CHUNKS: [number, number][] = [
  [-1, 0],
  [-1, 1],
  [0, 0],
  [-2, 1],
];

/**
 * The no-course planting's trace over `CHUNKS`: its colliders and planting data as JSON, hashed (FNV-1a over the text). The
 * data's models are counted, not written: a model's geometry carries a fresh uuid every run.
 */
function plantingTrace(p: { buildForChunk: FloraPlanter['buildForChunk'] }): string {
  let h = 2166136261;
  for (const [cx, cz] of CHUNKS) {
    const r = p.buildForChunk(cx, cz, flat, []);
    const s = JSON.stringify(r.colliders) + '|' + JSON.stringify({ ...r.data, models: r.data.models.length });
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
/** Recorded from afcf394's `flora.ts` over this stand-in: held whether or not git answers (`SWG3JS_NO_OLD=1`). */
const PLANTING_TRACE = 'cafd19dd';
{
  const Old = (await loadOld<{ FloraPlanter: typeof FloraPlanter }>(['src/world/flora.ts'], 'src/world/flora.ts', 'afcf394'))?.FloraPlanter;
  const now = new FloraPlanter(swg as never, models as never);
  if (!Old) note("git cannot hand afcf394's flora.ts over: the planter's day one is held to the trace recorded from it");
  else {
    const old = new Old(swg as never, models as never);
    let same = true;
    for (const [cx, cz] of CHUNKS) {
      const a = old.buildForChunk(cx, cz, flat, []);
      const b = now.buildForChunk(cx, cz, flat, []);
      if (JSON.stringify(a.colliders) !== JSON.stringify(b.colliders) || JSON.stringify(a.data) !== JSON.stringify(b.data)) same = false;
    }
    ok(same && now.onCourse === null, "with no course (`onCourse` null) every chunk's plantings, colliders and planting data are afcf394's");
    const was = plantingTrace(new Old(swg as never, models as never));
    ok(was === PLANTING_TRACE, `and afcf394's own planting is the trace recorded from it (${was})`);
  }
  ok(now.onCourse === null && plantingTrace(new FloraPlanter(swg as never, models as never)) === PLANTING_TRACE, `with no course the planting is the trace recorded from afcf394 (${PLANTING_TRACE})`);
  // A course landed: the planter keeps off its road plus `clear`, and plants on the carved ground.
  const before = CHUNKS.map(([cx, cz]) => now.buildForChunk(cx, cz, carved, []).colliders);
  now.onCourse = onCourse;
  const after = CHUNKS.map(([cx, cz]) => now.buildForChunk(cx, cz, carved, []).colliders);
  let gone = 0;
  let onRoad = 0;
  let unexplained = 0;
  for (let i = 0; i < CHUNKS.length; i++) {
    for (const c of before[i]) {
      const kept = after[i].some((d) => d.x === c.x && d.z === c.z);
      if (onCourse(c.x, c.z)) onRoad++;
      if (!kept) {
        gone++;
        if (!onCourse(c.x, c.z)) unexplained++;
      }
    }
  }
  const standing = after.flat();
  ok(onRoad > 0 && gone === onRoad && unexplained === 0 && !standing.some((c) => onCourse(c.x, c.z)), `after a course lands no planting stands within its road plus its clear: the ${onRoad} that did are gone and no other`);
  // Every collider of what is left on the carved ground (the world's own stand: a heightfield, then the plantings).
  const physics = await Physics.create();
  const cols: RAPIER.Collider[] = [];
  plantingColliders(physics, standing, carved, cols);
  physics.stepOnce();
  let off = 0;
  let parts = 0;
  for (const c of standing) {
    const near = cols.find((k) => Math.hypot(k.translation().x - c.x, k.translation().z - c.z) < 0.01);
    if (!near) continue;
    parts++;
    const half = (near as unknown as { halfHeight(): number }).halfHeight();
    if (Math.abs(near.translation().y - half - carved(c.x, c.z)) > 0.05) off++;
  }
  ok(parts > 0 && off === 0, `every planting's collider stands on the carved ground (${parts} trunks)`);
  // Beside the road the carve lifts the ground: a planting there stands on the carve, never the raw ground.
  const beside = standing.find((c) => Math.abs(carved(c.x, c.z) - flat(c.x, c.z)) > 0.5);
  ok(!!beside, 'and one beside the road, on its shoulder, stands on the carved ground where it differs from the raw by more than half a metre');
}

// ---------------------------------------------------------------- 2. the procedural props

{
  // `props.ts` carries a constructor parameter property, which node's type stripping refuses, so the props are held as
  // text: the skip is asked before anything else of a place (the attempts the same, so every place it does not leave out
  // stands where it stood), and the world hands it the course's rule on the plain path and composes it with the paint's
  // own on a painted real-elevation chunk.
  const src = (f: string) => readFileSync(new URL(`../../../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const props = src('src/world/props.ts');
  ok(/if \(exclude\.some\(\(e\) => Math\.hypot\(x - e\.x, z - e\.z\) < e\.r\)\) continue;\s*if \(skip && skip\(x, z\)\) continue;\s*const h = terrain\.heightAt\(x, z\);/.test(props), "a procedural prop's place is asked of the skip before its ground, its attempts unmoved");
  const world = src('src/world/world.ts');
  ok(/\} else \(\{ group, colliders \} = this\.props\.buildForChunk\(cx, cz, this\.terrain, exclude, this\.courseSkip \?\? undefined\)\);/.test(world), "the world's plain path hands the props the course's rule");
  ok(/const onRoad = this\.courseSkip;\s*const own = this\.props\.buildForChunk\(cx, cz, this\.terrain, exclude, onRoad \? \(x, z\) => src\.ownsAt\(x, z\) \|\| onRoad\(x, z\) : \(x, z\) => src\.ownsAt\(x, z\)\);/.test(world), "and a painted real-elevation chunk's own props the paint's rule or the course's");
  ok(/return \(x, z\) => s\.roadAt\(c\.cx - x, z \+ c\.cz, 0\);/.test(world), 'the rule is the road plus its clear, the game\'s x mirrored about the layout\'s centre into the raw frame');
}
// ---------------------------------------------------------------- 3. the grass's and the far cards' masks

{
  // A synthetic terrain (grassPlace's own shape): a meadow everywhere near and far trees everywhere far, on gentle hills.
  const adta = () => chunk('ADTA', new W().i32(0).i32(0).i32(1).str('').bytes());
  const layer = (name: string, ...items: ReturnType<typeof form>[]) => form('LAYR', form('0003', ihdr(name), adta(), ...items));
  const rect = (x0: number, z0: number, x1: number, z1: number) => form('BREC', form('0004', ihdr('rect'), chunk('DATA', new W().f32(x0).f32(z0).f32(x1).f32(z1).i32(0).f32(0).i32(0).i32(0).f32(0).f32(2).str('').i32(0).bytes())));
  const accn = (r: number, g: number, b: number) => form('ACCN', form('0000', ihdr('colour'), chunk('DATA', new W().i32(0).u8(r).u8(g).u8(b).bytes())));
  const mgrp = form('MGRP', form('0000', form('MFAM', chunk('DATA', new W().i32(1).str('hills').bytes()), mfrc(1337, { oct: 3, freq: 2, amp: 0.5, sx: 0.02, sy: 0.02 }))));
  const ahfr = form('AHFR', form('0003', ihdr('hills'), form('DATA', chunk('PARM', new W().i32(1).i32(1).f32(6).bytes()))));
  const rgrp = form('RGRP', form('0004', rfam(1, 'meadow', 1, [{ shader: 'radl_grass_test', w: [0.5, 0.75], h: [1, 1.5], aspect: true, sway: [0.13, 0.3] }]), rfam(2, 'far trees', 0.5, [{ shader: 'radl_far_tree_test', w: [8, 8], h: [20, 26] }])));
  const tgen = form('TGEN', form('0000', form('SGRP', form('0006')), form('FGRP', form('0008')), rgrp, form('EGRP', form('0002')), mgrp, form('MGRP', form('0000')), form('LYRS', layer('hills', ahfr), layer('meadow', rect(-2000, -2000, 2000, 2000), afd('AFDN', 1, 1, 0, 1, 0.6), afd('AFDF', 2), accn(90, 160, 60)))));
  const t = await SwgTerrain.create(encode(form('PTAT', form('0015', chunk('DATA', header(1, 0.42)), tgen, form('BAKE')))).slice().buffer as ArrayBuffer, [], 0, 0, async () => null);
  const shaders = new Map<string, RadialShaderEntry>([
    ['radl_grass_test', { layer: 0, near: true, far: false, alphaRef: 4, kind: 'plain', width: 256, height: 256 }],
    ['radl_far_tree_test', { layer: 3, near: false, far: true, alphaRef: 32, kind: 'fade', width: 128, height: 256 }],
  ]);
  const keys = new Map<RadialChild, string>();
  for (const f of t.template.generator.radialGroup.families.values()) for (const c of f.children) keys.set(c, shaderKey(c.shader));
  const world: GrassWorld = { group: t.template.generator.radialGroup, shaders, keyOf: (c) => keys.get(c)! };
  // A layout centre far from nought (every converted world's): the mask carries a game point into the raw frame as
  // `cx - x, z + cz`, so a road at raw x `CX - 24` crosses the game's chunk at (0, 0) at game x 24, its nodes' z moved by
  // `CZ`. Read about nought, a mask that dropped the centre would be the same; read here, it is off or on the wrong ground.
  const CX = 137;
  const CZ = -91;
  const RX = CX - 24.6;
  const grassRoad = storeOf([track('g2', 'sprint', [{ id: 'main', nodes: [node(RX, -300 + CZ, 5, { w: 10, c: 'straight' }), node(RX, 600 + CZ, 5, { w: 10, c: 'straight' })] }], { grass: 'clear' })]);
  const kept = storeOf([track('k', 'sprint', [{ id: 'main', nodes: [node(RX, -300 + CZ, 5, { w: 10, c: 'straight' }), node(RX, 600 + CZ, 5, { w: 10, c: 'straight' })] }], { grass: 'keep' })]);
  const o = groundChunkOrigin(0, 0, t.groundShift, 64);
  t.prepareArea(o.x - 4, o.z - 4, 72, true);
  const near = t.template.flora.radial;
  const place = (mask: ReturnType<typeof roadMask> | null): Float32Array => {
    const out = tuftBuffers(candidateCapacity(near, 64));
    placeGrass(t, world, near, o.x, o.z, 64, [], GRASS_DEFAULTS, GRASS_SWAY_DEFAULTS, SWAY_DEFAULTS, out, placeStats(), mask);
    return out.tuft.slice(0, out.count * 4);
  };
  const m = roadMask();
  fillRoadMask(grassRoad, CX, CZ, o.x, o.z, 64, m);
  let poleBad = 0;
  for (let k = 0; k < m.n; k++) for (let i = 0; i < m.n; i++) if ((m.bits[k * m.n + i] !== 0) !== grassRoad.roadAt(CX - (o.x + i * m.step), o.z + k * m.step + CZ, 1)) poleBad++;
  ok(m.on && m.step === 2 && poleBad === 0, `a chunk's road mask is the road whose course keeps its grass clear at every one of its ${m.n * m.n} poles, the game's points carried about a centre of (${CX}, ${CZ})`);
  const keepMask = roadMask();
  fillRoadMask(kept, CX, CZ, o.x, o.z, 64, keepMask);
  const farMask = roadMask();
  fillRoadMask(grassRoad, CX, CZ, o.x + 4000, o.z, 64, farMask);
  ok(!keepMask.on && !farMask.on, "a course that keeps its grass, and a square no course reaches, are no mask at all");
  const all = place(null);
  const masked = place(m);
  const list = (a: Float32Array) => {
    const out: string[] = [];
    for (let i = 0; i < a.length; i += 4) out.push(`${a[i].toFixed(4)},${a[i + 1].toFixed(4)},${a[i + 2].toFixed(4)}`);
    return out;
  };
  /**
   * Which tufts the mask must drop, worked out here and never by `onRoadMask` (what the placing itself asks): a tuft reads the
   * pole nearest it on the square's own lattice, and is dropped exactly where the road covers that pole, read off the store.
   */
  const dropped = (gx: number, gz: number, x0: number, z0: number, step: number, n: number, road: CourseCarve): boolean => {
    const i = Math.round((gx - x0) / step);
    const k = Math.round((gz - z0) / step);
    if (i < 0 || k < 0 || i >= n || k >= n) return false;
    return road.roadAt(CX - (x0 + i * step), z0 + k * step + CZ, 1);
  };
  const la = list(all);
  const lb = new Set(list(masked));
  let onMask = 0;
  let wrong = 0;
  for (let i = 0; i < all.length; i += 4) {
    const on = dropped(all[i], all[i + 2], o.x, o.z, 2, Math.floor(64 / 2) + 1, grassRoad);
    const has = lb.has(la[i / 4]);
    if (on) onMask++;
    if (on === has) wrong++;
  }
  ok(onMask > 0 && wrong === 0 && lb.size === la.length - onMask, `a tuft whose nearest pole the road covers is left out (${onMask} of ${la.length}) and every other placed as with no mask, read off the store and never the mask`);
  // And the tufts wholly on the road are gone, those wholly off it kept, whatever the poles: five points (the tuft's own and a
  // pole's step each way) all on the road, or none.
  let onWhole = 0;
  let offWhole = 0;
  let wholeBad = 0;
  for (let i = 0; i < all.length; i += 4) {
    const gx = all[i];
    const gz = all[i + 2];
    const at = [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]].map(([dx, dz]) => grassRoad.roadAt(CX - (gx + dx), gz + dz + CZ, 1));
    const has = lb.has(la[i / 4]);
    if (at.every(Boolean)) {
      onWhole++;
      if (has) wholeBad++;
    } else if (!at.some(Boolean)) {
      offWhole++;
      if (!has) wholeBad++;
    }
  }
  ok(onWhole > 0 && offWhole > 0 && wholeBad === 0, `every tuft standing wholly on the road is left out (${onWhole}) and every one wholly off it placed (${offWhole})`);
  ok(list(place(roadMask())).join('|') === la.join('|'), 'a mask that is off places exactly as no mask');
  // The far cards on a far tile.
  const FAR_TILE = 512;
  const FAR_RES = 32;
  const STEP = FAR_TILE / FAR_RES;
  const fo = groundChunkOrigin(0, 0, t.groundShift, FAR_TILE);
  const fg = t.farGrid(fo.x, fo.z, FAR_TILE, FAR_RES, true)!;
  const samples: FarSamples = { heights: fg.heights, colors: fg.colors, radialFar: fg.radialFar, n: FAR_RES + 3, step: STEP, gx0: fo.x - STEP, gz0: fo.z - STEP };
  const far = t.template.flora.farRadial;
  const cards = (mask: ReturnType<typeof roadMask> | null): Float32Array => {
    const out = tuftBuffers(candidateCapacity(far, FAR_TILE));
    placeFarCards(t, world, far, fo.x, fo.z, FAR_TILE, samples, 2.5, () => [], FAR_CARD_DEFAULTS, out, placeStats(), mask);
    return out.tuft.slice(0, out.count * 4);
  };
  const fm = roadMask();
  // A wider road for a far tile (its cards stand a 32 m tile apart): 40 m across.
  const wideRoad = storeOf([track('w', 'sprint', [{ id: 'main', nodes: [node(RX, -300 + CZ, 5, { w: 40, c: 'straight' }), node(RX, 900 + CZ, 5, { w: 40, c: 'straight' })] }], { grass: 'clear' })]);
  fillRoadMask(wideRoad, CX, CZ, fo.x, fo.z, FAR_TILE, fm);
  const ca = cards(null);
  const cb = new Set(list(cards(fm)));
  const lca = list(ca);
  let cardsOn = 0;
  let cardsWrong = 0;
  for (let i = 0; i < ca.length; i += 4) {
    const on = dropped(ca[i], ca[i + 2], fo.x, fo.z, 8, Math.floor(FAR_TILE / 8) + 1, wideRoad);
    if (on) cardsOn++;
    if (on === cb.has(lca[i / 4])) cardsWrong++;
  }
  ok(fm.on && fm.step === 8 && cardsOn > 0 && cardsWrong === 0 && cb.size === lca.length - cardsOn, `a far tile's mask (poles ${fm.step} m apart) leaves out the cards whose nearest pole the road covers (${cardsOn} of ${lca.length}) and places every other as before`);
  void onRoadMask;
}

console.log(`\ncourseFlora: ${checks} checks passed`);
void CHUNK_SIZE;
