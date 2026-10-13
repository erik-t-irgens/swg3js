// The radial affectors painting their two maps (materials and ground pass, wave 5b).
//
// AFDN (near: the grass) and AFDF (far: the far hills' tree cards) were parsed and thrown away. They now paint
// two maps of their own with the static flora's own arithmetic over the radial group (the engine's, read):
// remove-all clears a pole; otherwise a generator seeded with the pole's coordinate hash draws its first float
// against the amount times the family's density (or the affector's override), an add takes the next float as
// the child's choice, and a replace removes one family. The checks:
//
//   1. a terrain built in memory: every pole of an add is the family exactly where a draw worked out here from
//      scratch says so, with its choice; the density override is used in place of the family's; a replace takes
//      away its own family and leaves another's; a remove-all clears both near and far where it reaches; the far
//      affector paints the far map alone; and under a feathered circle the draw lands under the boundary's own
//      amount times the density, pole by pole, near and far
//   2. the converted worlds: heights, families, alternates, colours, the static flora and every other map are bit
//      for bit the same with the radial affectors live as with them switched off (the road clearing off too, so
//      only the radial maps can differ), the radial maps really are painted somewhere, and they are, to the pole,
//      what the engine's rule written out again here paints over the world's own boundaries, feathers and
//      densities
//
// Run: node tools/swg/tests/radialAffect.test.ts
import assert from 'node:assert/strict';
import { form, chunk, W, encode, ihdr } from './iffWriter.ts';
import { afd, header, rfam } from './radialFixture.ts';
import { FastRandomGenerator, hashTuple } from '../../../src/swg/terrain/flora.ts';
import { AffectorFloraDynamic, TERRAIN_GROUND_TUNE, type ChunkData, type Layer } from '../../../src/swg/terrain/generator.ts';
import { parseTerrainTemplate, TerrainSampler } from '../../../src/swg/terrain/trn.ts';
import { groundWorlds, loadWorld, PACKS, sampleBlocks } from './terrainHarness.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string) => console.log(`note ${s}`);

const adta = () => chunk('ADTA', new W().i32(0).i32(0).i32(1).str('').bytes());
const rect = (x0: number, z0: number, x1: number, z1: number) => form('BREC', form('0004', ihdr('rect'), chunk('DATA', new W().f32(x0).f32(z0).f32(x1).f32(z1).i32(0).f32(0).i32(0).i32(0).f32(0).f32(2).str('').i32(0).bytes())));
const circle = (x: number, z: number, r: number) => form('BCIR', form('0002', ihdr('circle'), chunk('DATA', new W().f32(x).f32(z).f32(r).i32(0).f32(0).bytes())));
const layer = (name: string, ...items: ReturnType<typeof form>[]) => form('LAYR', form('0003', ihdr(name), adta(), ...items));

// ---------------------------------------------------------------- 1. a terrain built in memory

{
  const rgrp = form('RGRP', form('0004', rfam(1, 'grass', 0.6, ['radl_grass_a', 'radl_grass_b']), rfam(2, 'flowers', 1, ['radl_flower']), rfam(3, 'far trees', 0.5, ['radl_tree_card'])));
  const tgen = form('TGEN', form('0000', form('SGRP', form('0006')), form('FGRP', form('0008')), rgrp, form('EGRP', form('0002')), form('MGRP', form('0000')), form('MGRP', form('0000')), form('LYRS',
    layer('grass', rect(-100, -100, 100, 100), afd('AFDN', 1)),
    layer('flowers', rect(-100, 40, 100, 100), afd('AFDN', 2, 1, 0, 1, 0.3)),
    layer('mown', rect(-100, -100, 100, -40), afd('AFDN', 1, 0)),
    layer('far', rect(-100, -100, 100, 100), afd('AFDF', 3)),
    layer('clearing', circle(0, 0, 12), afd('AFDN', 1, 1, 1), afd('AFDF', 1, 1, 1)),
  )));
  const t = parseTerrainTemplate(encode(form('PTAT', form('0015', chunk('DATA', header()), tgen, form('BAKE')))));
  const s = new TerrainSampler(t);
  const n = s.numberOfPoles;
  /** The draw worked out here: whether a family of this density lands on the pole, and its choice. */
  const draw = (wx: number, wz: number, density: number) => {
    const r = new FastRandomGenerator(hashTuple(wx, wz));
    const hit = r.randomFloat() <= density;
    return { hit, choice: hit ? Math.floor(r.randomFloat() * 255) : 0 };
  };
  let grassRight = 0;
  let grassAll = 0;
  let flowerRight = 0;
  let flowerAll = 0;
  let mown = 0;
  let mownKept = 0;
  let cleared = 0;
  let clearedAll = 0;
  let farRight = 0;
  let farAll = 0;
  let grassSeen = 0;
  // Four blocks about the origin: x and z from -68 to 66 m, which every layer above reaches into.
  for (const [bx, bz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
    const st = s.blockStart(bx, bz);
    const g = s.generate(st.x, st.z, n, s.poleStep);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const wx = st.x + i * 2;
        const wz = st.z + j * 2;
        const k = (j * n + i) * 2;
        const nearF = g.radialNear[k];
        const nearC = g.radialNear[k + 1];
        const farF = g.radialFar[k];
        if (Math.hypot(wx, wz) <= 11) {
          clearedAll++;
          if (nearF === 0 && farF === 0) cleared++;
          continue;
        }
        if (Math.hypot(wx, wz) < 13) continue;
        // The far map, on its own: the far trees' density 0.5.
        farAll++;
        const fd = draw(wx, wz, 0.5);
        if ((fd.hit ? farF === 3 : farF === 0) && (!fd.hit || g.radialFar[k + 1] === fd.choice)) farRight++;
        if (wz > 41 && wz < 99) {
          // The flowers paint over the grass where their override (0.3, not the family's 1) lands; elsewhere the grass stands.
          flowerAll++;
          const fl = draw(wx, wz, 0.3);
          const gr = draw(wx, wz, 0.6);
          const want = fl.hit ? 2 : gr.hit ? 1 : 0;
          const wantChoice = fl.hit ? fl.choice : gr.hit ? gr.choice : 0;
          if (nearF === want && nearC === wantChoice) flowerRight++;
        } else if (wz < -41) {
          // Mown: a replace of family 1 where its own draw lands takes the grass the add put there; where it does not, the grass stays.
          const gr = draw(wx, wz, 0.6);
          if (gr.hit) {
            mown++;
            // The replace rolls the same pole's draw against the same density, so it removes exactly what the add put.
            if (nearF === 0) mownKept++;
          }
        } else if (wz > -39 && wz < 39) {
          grassAll++;
          const gr = draw(wx, wz, 0.6);
          if ((gr.hit ? nearF === 1 && nearC === gr.choice : nearF === 0)) grassRight++;
          if (nearF) grassSeen++;
        }
      }
    }
  }
  ok(grassAll > 100 && grassRight === grassAll, `an add paints its family exactly where the pole's own draw lands under the family's density, with the draw's next float as its choice (${grassRight} of ${grassAll})`);
  ok(grassSeen > grassAll * 0.4 && grassSeen < grassAll * 0.8, `and lands about as often as the density says (${grassSeen} of ${grassAll} at 0.6)`);
  ok(flowerAll > 100 && flowerRight === flowerAll, `the density override is used in place of the family's own, and a later add paints over an earlier one (${flowerRight} of ${flowerAll})`);
  ok(mown > 20 && mownKept === mown, `a replace takes its own family away (${mownKept} of ${mown})`);
  ok(clearedAll > 50 && cleared === clearedAll, `a remove-all clears near and far alike wherever it reaches (${cleared} of ${clearedAll})`);
  ok(farAll > 100 && farRight === farAll, `the far affector paints the far map alone, by its own draw (${farRight} of ${farAll})`);
}

// ---------------------------------------------------------------- 1b. under a feathered boundary

{
  // One family of density 0.8 painted near and far by a circle feathered over three quarters of its radius: across
  // the feather the layer hands its affectors an amount under one, and the draw must land under that amount times
  // the density, pole by pole, not under the density alone.
  const R = 40;
  const F = 0.75;
  const CX = 6;
  const CZ = -10;
  const rgrp = form('RGRP', form('0004', rfam(1, 'ferns', 0.8, ['radl_fern']), rfam(2, 'far ferns', 0.8, ['radl_fern_card'])));
  const feathered = form('BCIR', form('0002', ihdr('feathered'), chunk('DATA', new W().f32(CX).f32(CZ).f32(R).i32(0).f32(F).bytes())));
  const tgen = form('TGEN', form('0000', form('SGRP', form('0006')), form('FGRP', form('0008')), rgrp, form('EGRP', form('0002')), form('MGRP', form('0000')), form('MGRP', form('0000')), form('LYRS',
    layer('ferns', feathered, afd('AFDN', 1), afd('AFDF', 2)),
  )));
  const t = parseTerrainTemplate(encode(form('PTAT', form('0015', chunk('DATA', header()), tgen, form('BAKE')))));
  const s = new TerrainSampler(t);
  const n = s.numberOfPoles;
  const density = Math.fround(0.8);
  /** The circle's own amount at a world point (`BoundaryCircle`, linear feather), as the layer stores it, in single precision. */
  const amountAt = (wx: number, wz: number): number => {
    const d2 = (wx - CX) ** 2 + (wz - CZ) ** 2;
    if (d2 > R * R) return 0;
    const inner2 = (R * (1 - F)) ** 2;
    return Math.fround(d2 <= inner2 ? 1 : 1 - (d2 - inner2) / (R * R - inner2));
  };
  let right = 0;
  let all = 0;
  let band = 0;
  let featherOnly = 0;
  let close = 0;
  for (const [bx, bz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
    const st = s.blockStart(bx, bz);
    const g = s.generate(st.x, st.z, n, s.poleStep);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const wx = st.x + i * 2;
        const wz = st.z + j * 2;
        const a = amountAt(wx, wz);
        if (a <= 0) continue;
        const r = new FastRandomGenerator(hashTuple(wx, wz));
        const first = r.randomFloat();
        const choice = Math.floor(r.randomFloat() * 255);
        // A draw within a hair of its threshold is left out: the layer works the amount in its sample space.
        if (Math.abs(first - a * density) < 1e-5) {
          close++;
          continue;
        }
        const hit = first <= a * density;
        const k = (j * n + i) * 2;
        all++;
        if (a < 1) {
          band++;
          if (!hit && first <= density) featherOnly++;
        }
        if ((hit ? g.radialNear[k] === 1 && g.radialNear[k + 1] === choice && g.radialFar[k] === 2 && g.radialFar[k + 1] === choice : g.radialNear[k] === 0 && g.radialFar[k] === 0)) right++;
      }
    }
  }
  ok(all > 500 && band > 300 && right === all, `under a feathered circle a pole holds the family exactly where its draw lands under the boundary's amount times the density, near and far (${right} of ${all}, ${band} of them in the feather, ${close} too close to call)`);
  ok(featherOnly > 30, `and the feather really thins them: ${featherOnly} poles in it would hold the family were the amount left out`);
}

// ---------------------------------------------------------------- 2. the converted worlds

/** The amounts the layers handed the radial affectors in the last generation, and how many were under one. */
const handed = { calls: 0, feathered: 0 };
/**
 * The engine's rule written out again here, from its description and not from `AffectorFloraDynamic`: put in
 * place of each live affector's own, the maps it paints must be the generator's own to the pole, every real
 * boundary's feather and every real family's density included.
 */
function ownAffect(this: AffectorFloraDynamic, wx: number, wz: number, x: number, z: number, amount: number, d: ChunkData): void {
  if (amount <= 0) return;
  handed.calls++;
  if (amount < 1) handed.feathered++;
  const map = this.tag === 'AFDN' ? d.radialNear : d.radialFar;
  const k = (z * d.numberOfPoles + x) * 2;
  if (this.removeAll) {
    map[k] = 0;
    map[k + 1] = 0;
    return;
  }
  const family = d.radialGroup.families.get(this.familyId);
  if (!family || !this.familyId) return;
  const r = new FastRandomGenerator(hashTuple(wx, wz));
  if (r.randomFloat() > amount * (this.densityOverride ? this.densityOverrideDensity : family.density)) return;
  if (this.operation === 1) {
    map[k] = this.familyId;
    map[k + 1] = Math.floor(r.randomFloat() * 255);
  } else if (this.operation === 0 && map[k] === this.familyId) {
    map[k] = 0;
    map[k + 1] = 0;
  }
}

const worlds = groundWorlds().filter((w) => ['tatooine', 'naboo', 'yavin4', 'lok', 'dathomir'].includes(w));
if (!worlds.length) note(`no converted Tatooine, Naboo, Yavin 4, Lok or Dathomir under ${PACKS}: only the terrain built in memory was checked`);
const keep = TERRAIN_GROUND_TUNE.roadsClearFlora;
TERRAIN_GROUND_TUNE.roadsClearFlora = false;
let featheredWorlds = 0;
try {
  for (const name of worlds) {
    const world = loadWorld(name)!;
    const s = world.sampler;
    const radials: AffectorFloraDynamic[] = [];
    const walk = (layers: readonly Layer[]) => {
      for (const l of layers) {
        for (const a of l.affectors) if (a instanceof AffectorFloraDynamic) radials.push(a);
        walk(l.layers);
      }
    };
    walk(world.template.generator.layers);
    const blocks = sampleBlocks(world.template, 24, 777);
    const maps = ['heights', 'shaders', 'children', 'colors', 'excluded', 'floraCollidable', 'floraNonCollidable', 'environments', 'seasonal'] as const;
    let same = 0;
    let painted = 0;
    let poles = 0;
    let ruled = 0;
    handed.calls = 0;
    handed.feathered = 0;
    for (const b of blocks) {
      const st = s.blockStart(b.bx, b.bz);
      const on = s.generate(st.x, st.z, s.numberOfPoles, s.poleStep);
      // Off as they were when they were inert: still active, so every layer is pruned, and lays its families on the
      // pattern, exactly as before (the engine counts an affector of any kind there), doing nothing when called.
      for (const a of radials) a.affect = () => {};
      const off = s.generate(st.x, st.z, s.numberOfPoles, s.poleStep);
      // And by the rule written out here.
      for (const a of radials) a.affect = ownAffect;
      const own = s.generate(st.x, st.z, s.numberOfPoles, s.poleStep);
      for (const a of radials) delete (a as { affect?: unknown }).affect;
      if (maps.every((m) => (on[m] as ArrayLike<number>).length === (off[m] as ArrayLike<number>).length && (on[m] as Uint8Array).every((v, i) => Object.is(v, (off[m] as Uint8Array)[i])))) same++;
      if (on.radialNear.every((v, i) => v === own.radialNear[i]) && on.radialFar.every((v, i) => v === own.radialFar[i])) ruled++;
      for (let k = 0; k < on.radialNear.length; k += 2) {
        poles++;
        if (on.radialNear[k] || on.radialFar[k]) painted++;
      }
    }
    ok(same === blocks.length, `${name}: heights, families, alternates, colours, the static flora and every other map bit for bit the same with the ${radials.length} radial affectors live as without them (${same} of ${blocks.length} blocks)`);
    ok(painted > 0, `${name}: and the radial maps are painted (${painted} of ${poles} poles near or far)`);
    ok(ruled === blocks.length, `${name}: the radial maps are the engine's rule written out here to the pole, over the world's own boundaries, feathers and densities (${ruled} of ${blocks.length} blocks; ${handed.feathered} of the ${handed.calls} amounts the layers handed over were under one)`);
    if (handed.feathered) featheredWorlds++;
  }
  if (worlds.length) ok(featheredWorlds > 0, `a real world's own feathers were among what was checked (${featheredWorlds} of ${worlds.length} worlds handed a radial affector an amount under one)`);
} finally {
  TERRAIN_GROUND_TUNE.roadsClearFlora = keep;
}

console.log(`\n${passed} passed`);
