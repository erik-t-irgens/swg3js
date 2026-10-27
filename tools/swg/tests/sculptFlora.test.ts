// A stroke's replant (Map-maker II, DESIGN.md §2.4): on a real `FloraPlanter` over a stub terrain and a real Rapier world in
// node, a chunk raised and lowered under a planting with the client's own parts and one with a guessed trunk. The chunk's
// physics is the world's own (`chunkHeightfield` for the ground, `plantingColliders` for the plantings, the two calls
// `World.addChunkPhysics` makes). After the replant -- the plantings planted again on the new ground and the physics remade
// from them -- every collider stands on the new ground: the part where the planting now stands, the guessed trunk's half
// height positive and its foot on the ground; and both checks fail when the heightfield alone is remade from the plantings
// as they were (the design's first cut).
//
// Run: node tools/swg/tests/sculptFlora.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Physics } from '../../../src/core/physics.ts';
import { FloraPlanter } from '../../../src/world/flora.ts';
import { plantingColliders } from '../../../src/world/chunkPhysics.ts';
import { CHUNK_RES, CHUNK_SIZE, chunkHeightfield } from '../../../src/world/terrain.ts';
import type { Collider } from '../../../src/world/props.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// The world stands a chunk's plantings by the very function this test asks, right after the heightfield.
{
  const src = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const add = /private addChunkPhysics\(c: Chunk\): void \{[\s\S]*?\n  \}/.exec(src)?.[0] ?? '';
  ok(/cols\.push\(chunkHeightfield\(this\.physics, c\)\);\s*\/\/[^\n]*\n\s*plantingColliders\(this\.physics, c\.colliders, this\.chunkGroundAt, cols\);/.test(add), 'the world stands a chunk\'s plantings through plantingColliders, after its heightfield');
}

// A stub terrain the planter reads its flora maps from: one tree on one 16 m tile, the rest bare.
const kinds = new Map<number, string>([
  [1, 'appearance/parts_tree.apt'],
  [2, 'appearance/guess_tree.apt'],
]);
const child = (family: number) => ({ familyId: family, appearance: kinds.get(family) as string, weight: 1, shouldSway: false, displacement: 0, period: 0, alignToTerrain: false, shouldScale: false, minScale: 1, maxScale: 1 });
const swg = {
  template: {
    mapWidthInMeters: 16384,
    flora: { collidable: { tileBorder: 0 }, nonCollidable: { tileSize: 8, tileBorder: 0, maximumDistance: 50 }, legacyMap: true, collidableMap: null },
    generator: { floraGroup: { createFlora: (family: number) => (kinds.has(family) ? child(family) : null) } },
  },
  toSwgX: (x: number) => -x,
  toSwgZ: (z: number) => z,
  toGameX: (x: number) => -x,
  toGameZ: (z: number) => z,
  sampler: {
    excludedAt: () => false,
    floraAt: (x: number, z: number, collidable: boolean) => {
      if (!collidable) return { family: 0, choice: 0 };
      const tx = Math.floor(x / 16);
      const tz = Math.floor(z / 16);
      if (tx === -1 && tz === 1) return { family: 1, choice: 0.5 };
      if (tx === -3 && tz === 2) return { family: 2, choice: 0.5 };
      return { family: 0, choice: 0 };
    },
  },
};
const model = (radius: number, height: number, def: unknown) => ({ primitives: [{ geometry: new THREE.BoxGeometry(1, 1, 1), material: new THREE.MeshBasicMaterial(), cell: 0 }], radius, height, def });
// The client's own shapes: one upright trunk from the planting's foot 6 m up. The other has no word, and is guessed.
const models = new Map<string, unknown>([
  ['appearance/parts_tree.apt', model(2, 8, { collision: { kind: 'cylinder', shapes: [{ t: 'cyl', c: [0, 0, 0], r: 0.6, h: 6 }] } })],
  ['appearance/guess_tree.apt', model(1.2, 9, undefined)],
]);
const planter = new FloraPlanter(swg as never, models as never);
const physics = await Physics.create();

let delta = 0;
const ground = (x: number, z: number) => 20 + x * 0.02 - z * 0.01 + delta;
const origin = { x: 0, z: 0 };
const heightsOf = (): Float32Array => {
  const n = CHUNK_RES;
  const h = new Float32Array((n + 1) * (n + 1));
  for (let xi = 0; xi <= n; xi++) for (let zi = 0; zi <= n; zi++) h[xi * (n + 1) + zi] = ground(origin.x + xi * (CHUNK_SIZE / n), origin.z + zi * (CHUNK_SIZE / n));
  return h;
};
/** The chunk's physics as the world makes it: its heightfield, then its plantings. */
const stand = (colliders: readonly Collider[]): RAPIER.Collider[] => {
  const cols: RAPIER.Collider[] = [chunkHeightfield(physics, { origin, heights: heightsOf() })];
  plantingColliders(physics, colliders, ground, cols);
  physics.stepOnce();
  return cols;
};
const drop = (cols: RAPIER.Collider[]) => {
  for (const c of cols) physics.removeCollider(c);
};
const plant = () => planter.buildForChunk(0, 0, ground, []).colliders;

/** Where each tree's foot is, and its collider's own top and foot, read off the engine. */
function trunks(cols: RAPIER.Collider[], colliders: readonly Collider[]) {
  const out: { kind: 'parts' | 'guess'; x: number; z: number; foot: number; top: number; half: number }[] = [];
  for (const p of colliders) {
    const near = cols.slice(1).find((c) => Math.hypot(c.translation().x - p.x, c.translation().z - p.z) < 0.01);
    if (!near) {
      out.push({ kind: p.parts ? 'parts' : 'guess', x: p.x, z: p.z, foot: Number.NaN, top: Number.NaN, half: Number.NaN });
      continue;
    }
    const t = near.translation();
    const half = (near as unknown as { halfHeight(): number }).halfHeight();
    out.push({ kind: p.parts ? 'parts' : 'guess', x: p.x, z: p.z, foot: t.y - half, top: t.y + half, half });
  }
  return out;
}
/** Every collider stands on the ground under its foot now: a part at the planting's foot, a guessed trunk from half a metre under it, its top the planting's. */
function standsOnGround(cols: RAPIER.Collider[], colliders: readonly Collider[]): string {
  const why: string[] = [];
  for (const t of trunks(cols, colliders)) {
    const g = ground(t.x, t.z);
    if (!(t.half > 0)) why.push(`the ${t.kind === 'parts' ? 'part' : 'guessed trunk'} has no positive half height`);
    else if (t.kind === 'parts' && Math.abs(t.foot - g) > 0.05) why.push(`the part's foot stands ${(t.foot - g).toFixed(2)} m off the ground`);
    else if (t.kind === 'guess' && Math.abs(t.foot - (g - 0.5)) > 0.05) why.push(`the guessed trunk's foot stands ${(t.foot - g + 0.5).toFixed(2)} m off its half metre under the ground`);
    else if (t.kind === 'guess' && Math.abs(t.top - (g + 9)) > 0.05) why.push(`the guessed trunk's top stands ${(t.top - g - 9).toFixed(2)} m off the planting's`);
  }
  return why.join('; ');
}

const before = plant();
ok(before.length === 2 && before.some((c) => c.parts) && before.some((c) => !c.parts), 'the chunk plants one tree with the client\'s own parts and one guessed');
for (const [name, d] of [
  ['raised', 12],
  ['lowered', -12],
] as const) {
  delta = 0;
  const was = plant();
  delta = d;
  // A ray sideways at the old trees' height, past each planting: what still stands where the ground was before the stroke.
  const hit = { toi: 0, nx: 0, ny: 0, nz: 0, handle: -1 };
  const sidewaysAt = (list: readonly Collider[]): number => {
    let n = 0;
    for (const p of list) {
      const g = ground(p.x, p.z);
      if (physics.aimHit(p.x - 5, g - d + 7.5, p.z, 1, 0, 0, 10, false, hit)) n++;
    }
    return n;
  };
  // The design's first cut: the heightfield remade, the plantings' colliders made from the plantings as they were.
  const stale = stand(was);
  const staleWhy = standsOnGround(stale, was);
  // Its trunks still stand at the old height (a lowered stroke's invisible walls): the sideways ray's control.
  const staleSideways = d < 0 ? sidewaysAt(was) : 0;
  drop(stale);
  // The stroke's replant: planted again on the new ground, the physics remade whole from it.
  const now = plant();
  const fresh = stand(now);
  const freshWhy = standsOnGround(fresh, now);
  const sideways = d < 0 ? sidewaysAt(now) : 0;
  drop(fresh);
  ok(freshWhy === '', `${name} 12 m: after the replant every collider stands on the new ground (the part at the planting's foot, the guessed trunk's half height positive and its foot on the ground)${freshWhy ? `: ${freshWhy}` : ''}`);
  ok(/part/.test(staleWhy) && /guessed trunk/.test(staleWhy), `${name} 12 m: with the heightfield alone remade, neither does (${staleWhy})`);
  if (d < 0) ok(staleSideways > 0 && sideways === 0, `lowered: a ray sideways at the old trees' height meets the stale trunks with the heightfield alone remade (${staleSideways}), and nothing after the replant`);
}

console.log(`\nsculptFlora: ${checks} checks passed`);
