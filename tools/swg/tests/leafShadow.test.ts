// No tree shades its own leaves (`src/world/leafShadow.ts`, the leaf shadow's half of `src/world/cardLight.ts`):
//
//   1. `crownExit` is what a brute-force march along the ray finds, for random points inside a crown, random
//      directions, headings and scales; and outside one, the crown's far side when it is ahead, nought when it is
//      behind, and when the ray passes it by the nearest slab's far side, never past the crown's own extent;
//   2. the skip's floor converts as 2 × |bias| × acne, and the bias a card's lookup is handed is the cascade's own
//      lowered by the floor and the skip, and exactly the cascade's own under `all`;
//   3. a hand-built tree with a wall 30 m toward the sun, judged the way the shadow map judges it: under `self`
//      no card is shaded by its own tree and every card the wall covers stays shaded; under `all` its own crown
//      shades it as before;
//   4. on the packs (SWG3JS_PACKS, else assets-private): every card material's crown box holds all its model's card
//      vertices at every level, a placed model's included, and no opaque material is marked;
//   5. `none` takes receiving off a card mesh of a tree that casts and off nothing else.
//
// Run: node tools/swg/tests/leafShadow.test.ts
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { classByName } from '../../../src/world/cardAlpha.ts';
import { CARD_LIGHT_TUNE, cardReceives, setCardLightTune } from '../../../src/world/cardLight.ts';
import { prepareCardModel, registerPackCards } from '../../../src/world/cardRule.ts';
import { acneFloor, crownExit, leafBias, shadowedBy, type LeafBox } from '../../../src/world/leafShadow.ts';
import { floraPacks, glbJsonOf, glbScenes, isCardJson } from './glbThree.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// ---------------------------------------------------------------- 1. the exit

{
  // Inside the crown (where every card is, its box grown by the sway): how far the ray stays in, by a march. Outside
  // it (a card can stand there only if something pushed it past its own pad), the slab test's own answer, worked out
  // by marching each axis apart -- the first slab the ray leaves, nought where it is leaving one already -- which is
  // the box's far side when the ray goes in ahead, nought when the box is behind, and when the ray passes the box by,
  // the far side of the slab it leaves first. Each march runs far enough to pass the box on every axis, in 20,000
  // steps, and is held to two of its own steps; a ray along an axis (far too long to march) is passed over here and
  // has its own check below.
  const worst = { inside: 0, ahead: 0, behind: 0, beside: 0 };
  const seen = { inside: 0, ahead: 0, behind: 0, beside: 0 };
  let passedOver = 0;
  for (let i = 0; i < 4000; i++) {
    const box: LeafBox = { min: [rnd(-5, 0), rnd(0, 3), rnd(-5, 0)], max: [rnd(0.5, 5), rnd(4, 12), rnd(0.5, 5)] };
    const inside = Math.random() < 0.5;
    const p = inside ? [rnd(box.min[0], box.max[0]), rnd(box.min[1], box.max[1]), rnd(box.min[2], box.max[2])] : [rnd(-10, 10), rnd(-5, 20), rnd(-10, 10)];
    // A sun direction, turned by a heading as a planting's turn would turn it.
    const h = rnd(0, Math.PI * 2);
    const el = rnd(0.05, 1.5);
    const d = [Math.cos(el) * Math.sin(h), Math.sin(el), Math.cos(el) * Math.cos(h)];
    const scale = rnd(0.5, 2);
    const exit = crownExit(box, p, d, scale);
    let reach = 0;
    for (let k = 0; k < 3; k++) reach = Math.max(reach, (Math.max(Math.abs(box.min[k] - p[k]), Math.abs(box.max[k] - p[k])) + 1) / Math.max(Math.abs(d[k]), 1e-9));
    if (reach > 4000) {
      passedOver++;
      continue;
    }
    const step = reach / 20000;
    const within = (k: number, t: number) => {
      const c = p[k] + d[k] * t;
      return c >= box.min[k] && c <= box.max[k];
    };
    // The whole box along the ray: where it is first and last inside.
    let first = -1;
    let last = -1;
    for (let t = 0; t < reach; t += step) {
      if (within(0, t) && within(1, t) && within(2, t)) {
        if (first < 0) first = t;
        last = t;
      } else if (first >= 0) break;
    }
    // Each axis apart: the last t at which its coordinate is within its slab, or none ahead.
    let slab = Infinity;
    for (let k = 0; k < 3; k++) {
      let lastK = -1;
      for (let t = 0; t < reach; t += step) {
        if (within(k, t)) lastK = t;
        else if (lastK >= 0) break;
      }
      slab = Math.min(slab, lastK);
    }
    /** How far off, in the march's own steps at this scale. */
    const steps = (got: number, want: number) => Math.abs(got - want) / (step * scale);
    if (inside) {
      seen.inside++;
      worst.inside = Math.max(worst.inside, steps(exit, last * scale));
    } else if (first >= 0) {
      seen.ahead++;
      worst.ahead = Math.max(worst.ahead, steps(exit, last * scale));
    } else if (slab < 0) {
      seen.behind++;
      worst.behind = Math.max(worst.behind, exit);
    } else {
      seen.beside++;
      worst.beside = Math.max(worst.beside, steps(exit, slab * scale));
    }
  }
  ok(seen.inside > 1000 && worst.inside <= 2, `crownExit from inside a crown is how far a march along the ray stays in, for random points, suns, headings and scales (${seen.inside} points, worst ${worst.inside.toFixed(2)} steps of the march)`);
  ok(seen.ahead > 20 && worst.ahead <= 2, `from outside with the crown ahead, the crown's far side (${seen.ahead} points, worst ${worst.ahead.toFixed(2)} steps)`);
  ok(seen.behind > 20 && worst.behind === 0, `from outside with the crown behind, or a slab the ray is leaving already, exactly nought (${seen.behind} points)`);
  ok(seen.beside > 20 && worst.beside <= 2 && passedOver < 200, `and from outside with the ray passing it by, the far side of the slab it leaves first (${seen.beside} points, worst ${worst.beside.toFixed(2)} steps; ${passedOver} rays along an axis passed over)`);
  const box: LeafBox = { min: [-1, 0, -1], max: [1, 2, 1] };
  ok(crownExit(box, [0, 1, 0], [0, 1, 0]) === 1 && crownExit(box, [0, 1, 0], [0, 1, 0], 2) === 2, 'straight up from the middle of a 2 m crown: a metre, two at scale two');
  ok(crownExit(box, [0, 5, 0], [0, 1, 0]) === 0 && Number.isFinite(crownExit(box, [0, 1, 0], [1, 0, 0])), 'a crown behind the point skips nothing, and a direction along an axis never divides by nought');
}

// ---------------------------------------------------------------- 2. the floor and the bias

{
  const bias = -0.0004;
  ok(Math.abs(acneFloor(bias, 4) - 2 * 0.0004 * 4) < 1e-15, 'the floor converts as 2 × |bias| × acne');
  ok(Math.abs(leafBias(bias, 0, 300, 4, 1) - (bias - acneFloor(bias, 4))) < 1e-15, 'a lookup with no skip is handed its cascade\'s bias lowered by the floor');
  ok(Math.abs(leafBias(bias, 6, 300, 4, 1) - (bias - acneFloor(bias, 4) - 6 / 300)) < 1e-15, 'and by the skip in the light\'s depth: metres over the range');
  ok(leafBias(bias, 6, 300, 4, 0) === bias, "under 'all' exactly the cascade's own, as before");
}

// ---------------------------------------------------------------- 3. a tree, its own crown and a wall

{
  const range = 470;
  const bias = -0.0003;
  const sun = (() => {
    const v = [0.4, 0.8, 0.45];
    const l = Math.hypot(v[0], v[1], v[2]);
    return v.map((x) => x / l);
  })();
  const crown: LeafBox = { min: [-3, 4, -3], max: [3, 10, 3] };
  /** A point's depth in the light's frame (distance from a plane far toward the sun). */
  const depth = (p: number[]) => 1000 - (p[0] * sun[0] + p[1] * sun[1] + p[2] * sun[2]);
  // The tree's own cards: points in its crown, each shaded by others of its own on the ray toward the sun.
  const cards: number[][] = [];
  for (let i = 0; i < 400; i++) cards.push([rnd(-2.8, 2.8), rnd(4.2, 9.8), rnd(-2.8, 2.8)]);
  /** The nearest occluder to the light on a point's ray, as the map keeps it: own cards within half a metre of the ray, and the wall. */
  const occluder = (p: number[], wall: boolean): number => {
    let best = Infinity;
    for (const q of cards) {
      const t = (q[0] - p[0]) * sun[0] + (q[1] - p[1]) * sun[1] + (q[2] - p[2]) * sun[2];
      if (t <= 0.05) continue;
      const off = Math.hypot(q[0] - p[0] - sun[0] * t, q[1] - p[1] - sun[1] * t, q[2] - p[2] - sun[2] * t);
      if (off < 0.5) best = Math.min(best, depth(q));
    }
    if (wall) best = Math.min(best, depth([p[0] + sun[0] * 30, p[1] + sun[1] * 30, p[2] + sun[2] * 30]));
    return best;
  };
  let ownShadedSelf = 0;
  let ownShadedAll = 0;
  let wallLit = 0;
  for (const p of cards) {
    const skip = crownExit(crown, p, sun);
    const occ = occluder(p, false);
    const self = Number.isFinite(occ) && shadowedBy(depth(p), occ, leafBias(bias, skip, range, 4, 1), range);
    const all = Number.isFinite(occ) && shadowedBy(depth(p), occ, leafBias(bias, skip, range, 4, 0), range);
    if (self) ownShadedSelf++;
    if (all) ownShadedAll++;
    const wallOcc = occluder(p, true);
    if (!shadowedBy(depth(p), wallOcc, leafBias(bias, skip, range, 4, 1), range)) wallLit++;
  }
  ok(ownShadedAll > 20, `under 'all' the tree's own crown shades its cards as before (${ownShadedAll} of ${cards.length})`);
  ok(ownShadedSelf === 0, "under 'self' no card is shaded by its own tree");
  ok(wallLit === 0, 'and every card a wall 30 m toward the sun covers stays shaded');
}

// ---------------------------------------------------------------- 4. the packs: the crown boxes

const PACKS = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private/', import.meta.url));
{
  const packs = floraPacks(PACKS);
  if (!packs.length) console.log(`skip the packs: no pack with flora under ${PACKS}`);
  else {
    // Every world's card shaders at once, on purpose, to hold every crown the rule can reach anywhere; that the game
    // knows a world's whole set as it loads is cardRule.test's check.
    const names = new Set<string>();
    for (const p of packs) for (const d of p.manifest.categories.flora) for (const m of glbJsonOf(join(p.dir, d.file)).materials ?? []) if (isCardJson(m)) names.add(m.name ?? '');
    registerPackCards(Object.fromEntries([...names].map((n) => [n, { blend: classByName(n) === 'blend', emissive: [0, 0, 0] }])));
    let boxes = 0;
    let outside = 0;
    let opaqueMarked = 0;
    let placed = 0;
    for (const p of packs) {
      const files: { file: string; flora: boolean }[] = p.manifest.categories.flora.map((d) => ({ file: join(p.dir, d.file), flora: true }));
      for (const d of p.manifest.categories.layout ?? []) {
        if (d.cells?.length || placed > 200) continue;
        const f = join(p.dir, d.file);
        if (!existsSync(f) || !(glbJsonOf(f).materials ?? []).some((m) => isCardJson(m) && names.has(m.name ?? ''))) continue;
        files.push({ file: f, flora: false });
        placed++;
      }
      for (const { file, flora } of files) {
        if (!existsSync(file)) continue;
        const { scenes } = glbScenes(file);
        prepareCardModel(scenes, { flora, count: false }, 'cards');
        for (const s of scenes) {
          s.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            const mat = m.material as THREE.MeshStandardMaterial;
            const box = mat.userData.swgLeaf as LeafBox | undefined;
            if (mat.userData.swgCardBlend === undefined) {
              if (box) opaqueMarked++;
              return;
            }
            if (!box) return;
            boxes++;
            const pos = m.geometry.getAttribute('position');
            const e = 1e-4;
            for (let v = 0; v < pos.count; v++) {
              const x = pos.getX(v);
              const y = pos.getY(v);
              const z = pos.getZ(v);
              if (x < box.min[0] - e || y < box.min[1] - e || z < box.min[2] - e || x > box.max[0] + e || y > box.max[1] + e || z > box.max[2] + e) {
                outside++;
                break;
              }
            }
          });
        }
      }
    }
    ok(boxes > 300, `every card material is given its crown's box (${boxes} card meshes at every level, ${placed} placed models among the models)`);
    ok(outside === 0, `and the box holds every card vertex of its model at every level (${outside} meshes poke out)`);
    ok(opaqueMarked === 0, 'no opaque material is marked');
  }
}

// ---------------------------------------------------------------- 5. none

{
  const card = new THREE.MeshStandardMaterial();
  card.userData.swgCardBlend = 'blend';
  const trunk = new THREE.MeshStandardMaterial();
  const was = CARD_LIGHT_TUNE.shadow;
  setCardLightTune({ shadow: 'none' });
  ok(!cardReceives(card, true) && cardReceives(card, false) && cardReceives(trunk, true), "'none' takes receiving off the card meshes of a tree that casts, and off no trunk and no shrub that casts nothing");
  setCardLightTune({ shadow: 'self' });
  ok(cardReceives(card, true) && cardReceives(trunk, true), "under 'self' every mesh receives: the skip is in the card's program");
  setCardLightTune({ shadow: was });
}

console.log(`\nleafShadow: ${passed} checks passed`);
