// The far sea at the far ground's reach (the horizon pass's fifth wave, DESIGN.md §2.7, §7): the sea's flat far ring as
// `createGlobalWater` makes it (three's own RingGeometry), its outer row moved in place to the reach in force and put back
// to the bit at today's 9,000 m, never inside its inner row; the follow record's sea edge moving only by `seaStep`; its
// mask twins sharing the very attribute (pinned as text: `waterBodies.ts` cannot load in node); and the world's hand-overs.
//
// Run: node tools/swg/tests/horizonSea.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FarSea, HorizonFollow, applyFollow } from '../../../src/world/horizon/horizonSea.ts';
import { HORIZON_TUNE, SEA_BASE, newReachRules, reachRules } from '../../../src/world/horizon/horizonMath.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const WATER_NEAR = 3000;
const make = () => new THREE.RingGeometry(WATER_NEAR * 0.48, 9000, 96, 1).rotateX(-Math.PI / 2);
const g = make();
const made = Float32Array.from(g.getAttribute('position').array as Float32Array);
const sea = new FarSea(g);
ok(sea.rows.length === 97 && Math.abs(sea.inner - WATER_NEAR * 0.48) < 1e-3, `the outer row found by its radius (${sea.rows.length} vertices) and the inner radius kept (${sea.inner.toFixed(1)} m)`);
const pos = () => g.getAttribute('position').array as Float32Array;
const radii = (rows: Int32Array) => Array.from(rows, (i) => Math.hypot(pos()[i * 3], pos()[i * 3 + 2]));
sea.set(8000);
ok(radii(sea.rows).every((r) => Math.abs(r - 8000) < 1e-2), 'moved to the reach in force (8,000 m), every outer vertex at that radius');
let innerSame = true;
for (let i = 0; i < pos().length; i += 3) if (!sea.rows.includes(i / 3) && (pos()[i] !== made[i] || pos()[i + 2] !== made[i + 2])) innerSame = false;
ok(innerSame && radii(sea.rows).every((_, k) => pos()[sea.rows[k] * 3 + 1] === made[sea.rows[k] * 3 + 1]), "and nothing else of the ring moved (the inner row, the heights)");
ok(g.getAttribute('position').version > 0, 'the attribute is marked for upload');
sea.set(SEA_BASE);
let same = true;
for (let i = 0; i < made.length; i++) if (!Object.is(pos()[i], made[i])) same = false;
ok(same && sea.edge === SEA_BASE, "today's 9,000 m puts the ring back as RingGeometry made it, to the bit");
sea.set(500);
ok(Math.abs(radii(sea.rows)[0] - WATER_NEAR * 0.48 * 1.05) < 1e-2, 'never brought inside its inner row (a twentieth past it): no triangle turns over');
const v = g.getAttribute('position').version;
sea.set(500);
ok(g.getAttribute('position').version === v, 'and nothing is written when the edge already stands');
// The twins: a mesh on the same geometry reads the same attribute (three draws what the geometry holds).
const twin = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
ok(twin.geometry.getAttribute('position') === g.getAttribute('position'), 'a twin on the same geometry shares the attribute, so it follows with nothing written twice');
const waterBodies = readFileSync(new URL('../../../src/world/waterBodies.ts', import.meta.url), 'utf8');
ok(/const twin = new THREE\.Mesh\(mesh\.geometry, mask\);/.test(waterBodies) && /const twin = new THREE\.Mesh\(b\.mesh\.geometry, mask\);/.test(waterBodies), "the water's mask twins are made on the body's own geometry (waterBodies.ts)");

// The follow record: the sea's edge at the reach in force on the rings' first frame, then only past `seaStep`.
const f = new HorizonFollow();
const r = newReachRules();
const t = { ...HORIZON_TUNE, reach: 8000 };
r.eyeOver = 0;
r.bakeMost = Infinity;
r.fogDensity = 0;
reachRules(t, 6, true, r);
f.follow(r, 250);
ok(f.on && f.sea === 8000 && f.far === r.far && f.sky === r.skyRadius && f.groundSky === r.groundSky, "the rings' first frame: the sea at the reach in force at once, the far plane, the sky and the rays' sky the rules'");
r.fogDensity = 0.0003;
reachRules(t, 6, true, r);
const fogged = r.inForce;
f.follow(r, 250);
ok(fogged < 8000 && Math.abs(8000 - fogged) >= 250 ? f.sea === fogged : f.sea === 8000, `the fog trims the reach in force to ${fogged.toFixed(0)} m and the sea follows it past the step`);
const was = f.sea;
r.fogDensity = 0.000301;
reachRules(t, 6, true, r);
f.follow(r, 250);
ok(f.sea === was, 'a move of under a step leaves the sea where it stands (no write, no upload)');
f.base();
ok(Object.is(f.sea, SEA_BASE) && !f.on, "with no rings, today's 9,000 m");

// The world's hand-overs (world.ts cannot load in node): the ring it makes, the sea it follows, every frame's follow.
const world = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
ok(world.includes('this.waterFar = new THREE.Mesh(new THREE.RingGeometry(WATER_NEAR * 0.48, 9000, 96, 1).rotateX(-Math.PI / 2));') && world.includes('this.farSea = new FarSea(this.waterFar.geometry);'), 'the world keeps the far sea it makes, as it makes it');
ok(world.includes('this.horizonFollow.follow(field.rules);\n    this.applyHorizonFollow();') && world.includes('private applyHorizonFollow(): void {\n    applyFollow(this.horizonFollow, this.swgSky, this.farSea);\n  }'), "every drawn frame follows the rules and applies them to the sky and the far sea");
// h5's review round: what the follow record writes (`applyFollow`, the world's every frame): the sky's whole group scaled to
// its radius over today's 3,500 m and the flare's sky its own, both by the rules; at `base` nothing written at all.
{
  const group = new THREE.Group();
  let writes = 0;
  const sc = group.scale.setScalar.bind(group.scale);
  group.scale.setScalar = (k: number) => {
    writes++;
    return sc(k);
  };
  const sky = { group, flareSkyDistance: 3500 };
  const g3 = make();
  const s3 = new FarSea(g3);
  const f3 = new HorizonFollow();
  applyFollow(f3, sky, s3);
  ok(writes === 0 && Object.is(group.scale.x, 1) && Object.is(sky.flareSkyDistance, 3500) && s3.edge === SEA_BASE, "at today's numbers nothing is written: the sky's scale one, the flare's sky 3,500 m, the sea at 9,000 m");
  r.fogDensity = 0;
  r.eyeOver = 400;
  r.bakeMost = Infinity;
  reachRules(t, 6, true, r);
  f3.follow(r);
  applyFollow(f3, sky, s3);
  ok(group.scale.x === r.skyRadius / 3500 && group.scale.y === group.scale.x && group.scale.z === group.scale.x && sky.flareSkyDistance === r.flareSky && s3.edge === r.inForce && r.skyRadius > 3500, `the rings drawn: the sky's group scaled ${group.scale.x.toFixed(3)} (its radius ${r.skyRadius.toFixed(0)} m), the flare's sky ${r.flareSky.toFixed(0)} m, the sea at ${s3.edge.toFixed(0)} m`);
  const n = writes;
  applyFollow(f3, sky, s3);
  ok(writes === n, 'and nothing again while they stand');
  f3.base();
  applyFollow(f3, sky, s3);
  ok(group.scale.x === 1 && sky.flareSkyDistance === 3500 && s3.edge === SEA_BASE, "and back to today's when the rings go");
  applyFollow(f3, null, null);
  ok(true, 'with no sky and no sea, nothing to write');
}
{
  // `follow` with no step reads the tune's own (a frame hands no number across the call).
  const g2 = make();
  const s2 = new FarSea(g2);
  const f2 = new HorizonFollow();
  f2.sea = 7000;
  s2.follow(f2);
  ok(s2.edge === 7000, "the far sea follows the record's edge");
  const was = HORIZON_TUNE.seaStep;
  HORIZON_TUNE.seaStep = 1000;
  f2.on = true;
  f2.sea = 7000;
  r.fogDensity = 0;
  r.eyeOver = 0;
  reachRules(t, 6, true, r);
  f2.follow(r);
  ok(f2.sea === 8000, `the record's own step is the tune's (a move of ${8000 - 7000} m, at a step of 1,000, followed)`);
  HORIZON_TUNE.seaStep = was;
}
ok(/if \(!field \|\| !s \|\| !this\.horizonDrawn \|\| this\.planet\.space \|\| !s\.patch\.visible\) \{\s*\/\/[^\n]*\n\s*this\.horizonFollowBase\(\);\s*return;/.test(world), "and every frame with no rings puts today's numbers back (written only where they moved)");

console.log(`\nhorizonSea: ${checks} checks passed`);
