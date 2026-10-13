// The circles things put down in play keep the flora off, as the trees and the grass each read them (materials
// and ground pass, wave 5b): the real streamer, a real grass field and a terrain built in memory, driven in node.
//
// The static flora is drawn into a chunk once, so a circle kept for it is kept for good (`LayoutStreamer.unplace`
// says why); the grass is built again whenever a circle moves, so it reads only the circles still standing
// (`liveExclusionsFor`) and a house taken up gives its grass back. The checks:
//
//   1. a thing put down with a clearing tells the world once (`onFloraCircle`), and its circle is in both lists
//      of every 64 m bucket it reaches, each once however many buckets are asked
//   2. taken up, it tells the world again with the same circle; the grass's list lets it go while the trees'
//      keeps it, and every other circle stands in both
//   3. a permanent row's clearing (`keepFloraOff`) tells the world once, however often it is asked for, and stays
//      in both lists
//   4. a grass field hung on the streamer as the world hangs it: the tufts under a house put down are gone once
//      the chunk is built again, and back once it is taken up, the rest of the chunk as it was
//
// Run: node tools/swg/tests/floraCircles.test.ts
import assert from 'node:assert/strict';
import { THREE, makeStreamer } from './streamHarness.ts';
import { form, chunk, W, encode, ihdr } from './iffWriter.ts';
import { afd, header, rfam } from './radialFixture.ts';
import { shaderKey } from '../../../src/swg/terrain/shaderKey.ts';
import { readRadialFile, type RadialShaderEntry } from '../../../src/swg/terrain/radialFile.ts';
import type { RadialChild } from '../../../src/swg/terrain/flora.ts';
import { SwgTerrain } from '../../../src/world/swgTerrain.ts';
import { GrassField, grassMaterial, type GrassHost, type GrassSetup } from '../../../src/world/grass.ts';
import type { FloraCircle, GrassWorld } from '../../../src/world/grassMath.ts';
import { groundChunkOrigin } from '../../../src/world/groundTiles.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

const h = await makeStreamer();
const told: FloraCircle[] = [];
h.stream.onFloraCircle = (e) => void told.push(e);
const live = (cx: number, cz: number, out: FloraCircle[] = []) => {
  h.stream.liveExclusionsFor(cx, cz, out);
  return out;
};
const kept = (cx: number, cz: number) => h.stream.exclusionsFor(cx, cz) as FloraCircle[];

// ---------------------------------------------------------------- 1. put down

// A house with a 12 m clearing at the game's (60, 40): its circle reaches buckets (0,0) and (1,0).
const house = { model: 'house', template: 'home:G', x: 60, y: 0, z: 40, q: new THREE.Quaternion(), radius: 10, clear: 12 };
await h.stream.place(house);
ok(told.length === 1 && told[0].x === 60 && told[0].z === 40 && told[0].r === 12, 'a thing put down with a clearing tells the world of its circle once');
const circle = told[0];
ok(live(0, 0).includes(circle) && live(1, 0).includes(circle) && !live(2, 0).includes(circle), 'its circle stands in the grass\'s list of every bucket it reaches, and no other');
ok(kept(0, 0).includes(circle) && kept(1, 0).includes(circle), 'and in the trees\' list of the same buckets');
const both = live(1, 0, live(0, 0));
ok(both.filter((e) => e === circle).length === 1, 'asked of two buckets into one list, it is in the list once');

// ---------------------------------------------------------------- 2. taken up

// A second thing standing beside it, which stays.
await h.stream.place({ ...house, template: 'home:H', x: 20, z: 20, clear: 8 });
const other = told[1];
ok(h.stream.unplace('home:G'), 'the house is taken up');
ok(told.length === 3 && told[2] === circle, 'and tells the world again, with the very same circle, so the grass under it is built again');
ok(!live(0, 0).includes(circle) && !live(1, 0).includes(circle), 'the grass\'s list lets its circle go');
ok(kept(0, 0).includes(circle) && kept(1, 0).includes(circle), 'the trees\' list keeps it, as the trees already drawn round it do');
ok(live(0, 0).includes(other) && kept(0, 0).includes(other), 'the circle of the thing still standing is in both lists still');
ok(!h.stream.unplace('home:G') && told.length === 3, 'a second taking up of what is gone tells nothing');

// ---------------------------------------------------------------- 3. a permanent row's clearing

h.stream.keepFloraOff(-30, 90, 15);
h.stream.keepFloraOff(-30, 90, 15);
ok(told.length === 4 && told[3].x === -30 && told[3].r === 15, 'a permanent row\'s clearing tells the world once, however often it is asked for');
ok(live(-1, 1).includes(told[3]) && kept(-1, 1).includes(told[3]), 'and stands in both lists');

// ---------------------------------------------------------------- 4. the grass under a house put down and taken up

{
  const adta = () => chunk('ADTA', new W().i32(0).i32(0).i32(1).str('').bytes());
  const rect = form('BREC', form('0004', ihdr('rect'), chunk('DATA', new W().f32(-2000).f32(-2000).f32(2000).f32(2000).i32(0).f32(0).i32(0).i32(0).f32(0).f32(2).str('').i32(0).bytes())));
  const tgen = form('TGEN', form('0000', form('SGRP', form('0006')), form('FGRP', form('0008')), form('RGRP', form('0004', rfam(1, 'meadow', 1, ['radl_grass_test']))), form('EGRP', form('0002')), form('MGRP', form('0000')), form('MGRP', form('0000')), form('LYRS',
    form('LAYR', form('0003', ihdr('meadow'), adta(), rect, afd('AFDN', 1))),
  )));
  const swg = await SwgTerrain.create(encode(form('PTAT', form('0015', chunk('DATA', header(1, 0.42)), tgen, form('BAKE')))).slice().buffer as ArrayBuffer, [], 0, 0, async () => null);
  const shaders = new Map<string, RadialShaderEntry>([['radl_grass_test', { layer: 0, near: true, far: false, alphaRef: 4, kind: 'plain', width: 256, height: 256 }]]);
  const keys = new Map<RadialChild, string>();
  for (const f of swg.template.generator.radialGroup.families.values()) for (const c of f.children) keys.set(c, shaderKey(c.shader));
  const world: GrassWorld = { group: swg.template.generator.radialGroup, shaders, keyOf: (c) => keys.get(c)! };
  const file = readRadialFile({ radialFormat: 1, size: 256, layers: 1, shaders: Object.fromEntries(shaders) })!;
  const setup: GrassSetup = { src: swg, world, file, near: swg.template.flora.radial, far: swg.template.flora.farRadial, shift: swg.groundShift, reference: null };
  // Hung as the world hangs it: the streamer's live circles, and every circle that moves building the chunks under it again.
  const host: GrassHost = { circlesFor: (cx, cz, out) => h.stream.liveExclusionsFor(cx, cz, out), adopt: () => {}, chunkLoaded: () => true };
  const field = new GrassField(grassMaterial(), host);
  field.setWorld(setup);
  h.stream.onFloraCircle = (e) => field.circleChanged(e.x, e.z, e.r);
  const root = new THREE.Group();
  const o = groundChunkOrigin(3, 3, swg.groundShift, 64);
  swg.prepareArea(o.x - 4, o.z - 4, 72, true);
  field.chunkMade(3, 3, root);
  const eye = new THREE.Vector3(o.x + 32, 2, o.z + 32);
  field.update(eye, 9);
  /** The tufts of the chunk now, and those within `r` of (x, z). */
  const tufts = (x: number, z: number, r: number): { all: number; inside: number } => {
    const m = root.children[0] as THREE.Mesh | undefined;
    if (!m) return { all: 0, inside: 0 };
    const a = m.geometry.getAttribute('aSwgTuft') as THREE.InstancedBufferAttribute;
    let inside = 0;
    for (let i = 0; i < a.count; i++) if (Math.hypot(a.getX(i) - x, a.getZ(i) - z) <= r) inside++;
    return { all: a.count, inside };
  };
  const spot = { x: o.x + 30, z: o.z + 34 };
  const before = tufts(spot.x, spot.z, 10);
  ok(before.inside > 100, `a meadow stands where the house will go (${before.inside} tufts within 10 m of the spot, ${before.all} in the chunk)`);
  await h.stream.place({ ...house, template: 'home:M', x: spot.x, z: spot.z, clear: 10 });
  field.update(eye, 9);
  const under = tufts(spot.x, spot.z, 10);
  ok(under.inside === 0 && under.all === before.all - before.inside, `put down, the house's clearing takes the grass under it and nothing else (${under.all} tufts left)`);
  ok(h.stream.unplace('home:M'), 'taken up again');
  field.update(eye, 9);
  const after = tufts(spot.x, spot.z, 10);
  ok(after.inside === before.inside && after.all === before.all, `and the grass under it is back, the chunk as it was (${after.inside} within 10 m, ${after.all} in all)`);
  swg.dispose();
}

console.log(`\n${passed} passed`);
