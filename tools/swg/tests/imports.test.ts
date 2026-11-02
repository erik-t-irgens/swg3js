// The import pass (Map-maker II's tenth wave, `tools/swg/imports.mjs`): a glTF in the shape Blender's exporter writes, built
// here out of nothing of the game's (`blenderGlb.ts`), run through the pass and read back through the game's own
// `AssetPack` from a folder, with three's own GLTFLoader under it (the network, the image decoder and `self` stood in):
//
//   1. the source: one mesh on four nodes (two of them a linked duplicate, one under a turned parent, one mirrored by a
//      negative scale), a material double-sided, a transmissive pane, a punctual light, a normal map with no tangents, a
//      `-colonly` stand-in, a `-nocol` banner and a `_LOD1` level;
//   2. what the pass makes of it: every part where Blender put it (the bake, the winding of the mirrored copy), every
//      material named for its import and single-sided unless asked, the pane a blended `noShadow` one with no physical
//      extension left, no light, `swgNormalY` on the normal-mapped material, the collider extras by the collision rule,
//      the `lods` scene and its manifest entry agreeing, and the library's picture drawn;
//   3. read back through `AssetPack.load(..., { dir })`: the same parts at the same places with no node transform, the
//      materials as made (`normalYOf`), the stand-in out of `primitives` and in `colliderOnly`, no light, the levels; and a
//      file with a light put in the folder by hand held to the same;
//   4. the refusals in words (Draco, a cell beginning with a digit, a room's name), the record's rules, the command's flags,
//      a model made again sweeping its old files and one taken out leaving nothing, and the folder's size and the shipped
//      folder's note in its index;
//   5. the model's own borrowed looks laid under a row's (`withModelLooks`), a tint on one material kept on its picture;
//   and beside them: a slanted face under a scale not the same every way baked to its own normal, a leaf's back sheet, a strip
//   and a fan, the same model as a .gltf with its files beside it, a picture past --tex-max shrunk, `look: 'client'`'s
//   metal-rough copy, the reader's limits on a model's looks, a flora import read back from a folder (its shapes merged, its
//   leaf a card, its sway keyed by its made file, its cards forgotten by id) and its shapes in the walk grid's key.
//
// Run: node tools/swg/tests/imports.test.ts
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as THREE from 'three';
import { COLLISION_RULES, IMPORT_TUNE, LOOK_LIMITS, accessorValues, defaultRecord, dropImport, idOfStem, importModel, looksRefusal, nameRole, readRecord, readSource, recordFor, roomRefusal, sourceRefusals, tuneOf, writeImport } from '../imports.mjs';
import { readGlb } from '../sceneglb.mjs';
import { decodePng, encodePng } from '../png.mjs';
import { glbMeshes } from '../library.mjs';
import { gridEditsOf, importKeyOf, installPacks, readGlbTriangles, solidRowModel } from '../navgrid.mjs';
import { layoutKeyOf } from '../finalnames.mjs';
import { cube, domeNormalPng, plate, solidPng, writeRawGlb, writeRawGltf, yawQ, type RawGltf } from './blenderGlb.ts';
import { AssetPack, normalYOf, type LoadedModel } from '../../../src/world/assetPack.ts';
import { PLACEMENT_LIMITS, placementsFileText, readLooks, withModelLooks } from '../../../src/story/placements.ts';
import { lookWith } from '../../../src/editor/lookPick.ts';
import { forgetImportCards, isCardShader } from '../../../src/world/cardRule.ts';
import { swayModel } from '../../../src/world/floraSway.ts';

let checks = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
}

const tmp = mkdtempSync(join(tmpdir(), 'swg-imports-'));

// ---------------------------------------------------------------- 1. the source

/** The block: everything the design names in one file, in the exporter's own shape. */
function block(): RawGltf {
  return {
    materials: [
      { name: 'Stone', pbrMetallicRoughness: { baseColorFactor: [0.6, 0.6, 0.6, 1], metallicFactor: 0, roughnessFactor: 0.8 }, normalTexture: { index: 0 }, doubleSided: true },
      { name: 'Glass', pbrMetallicRoughness: { baseColorFactor: [0.8, 0.9, 1, 1], metallicFactor: 0, roughnessFactor: 0.05 }, doubleSided: true, extensions: { KHR_materials_transmission: { transmissionFactor: 1 }, KHR_materials_ior: { ior: 1.5 } } },
      { name: 'Metal', pbrMetallicRoughness: { baseColorFactor: [0.9, 0.9, 0.9, 1], metallicFactor: 1, roughnessFactor: 0.3 }, doubleSided: true },
    ],
    textures: [{ source: 0, sampler: 0 }],
    images: [{ name: 'bump', png: domeNormalPng(32) }],
    meshes: [
      { name: 'Cube', primitives: [cube(0)] },
      { name: 'Pane', primitives: [plate(1, 1)] },
      { name: 'Cube.001', primitives: [cube(0)] },
      { name: 'Banner', primitives: [cube(2)] },
    ],
    nodes: [
      { name: 'Base', mesh: 0, translation: [0, 1, 0] },
      { name: 'Arm', translation: [4, 0, 0], rotation: yawQ(Math.PI / 2), children: [2] },
      { name: 'ArmBlock', mesh: 0, translation: [0, 0.5, 2], scale: [0.5, 0.5, 0.5] },
      { name: 'Mirror', mesh: 0, translation: [-4, 1, 0], scale: [-1, 1, 1] },
      { name: 'Window', mesh: 1, translation: [0, 1, 1.05] },
      { name: 'Lamp', translation: [0, 3, 0], extensions: { KHR_lights_punctual: { light: 0 } } },
      { name: 'Stand-colonly', mesh: 2, translation: [0, 1, 0], scale: [1.2, 1.2, 1.2] },
      { name: 'Banner-nocol', mesh: 3, translation: [0, 2.5, 0], scale: [0.5, 0.1, 0.1] },
      { name: 'Block_LOD1', mesh: 2, translation: [0, 1, 0], scale: [2, 1, 1] },
      { name: 'Base.001', mesh: 0, translation: [0, 1, -4] },
    ],
    extensionsUsed: ['KHR_materials_transmission', 'KHR_materials_ior', 'KHR_lights_punctual'],
    extensions: { KHR_lights_punctual: { lights: [{ type: 'point', color: [1, 0.8, 0.6], intensity: 20, range: 8 }] } },
  };
}

const srcFile = join(tmp, 'Block.glb');
writeFileSync(srcFile, writeRawGlb(block()));
const RECORD = { id: 'test_block', name: 'TEST block', group: 'TEST', kind: 'prop', collision: 'triangles', look: 'pbr', lods: [25], doubleSided: ['Metal'], ship: false };

/** The drawn level-0 parts' boxes in the exporter's frame, as the nodes put them (the turned parent's child at x 5.5..6.5). */
const DRAWN = { min: [-5, 0, -5], max: [6.5, 2.6, 1.05] };
const WITH_STAND = { min: [-5, -0.2, -5], max: [6.5, 2.6, 1.2] };

/** A made GLB's primitives read back by the pass's own accessor reader: each one's material's name, corners, normals and triangles. */
function primsOf(glb: Buffer): { material: string; pos: Float64Array; nor: Float64Array; idx: Float64Array }[] {
  const g = readGlb(glb) as { json: { meshes: { primitives: { material: number; indices: number; attributes: Record<string, number> }[] }[]; materials: { name: string }[] }; bin: Buffer };
  const s = { json: g.json, buffers: [g.bin] };
  const out: { material: string; pos: Float64Array; nor: Float64Array; idx: Float64Array }[] = [];
  for (const mesh of g.json.meshes) for (const p of mesh.primitives) out.push({ material: g.json.materials[p.material]?.name ?? '', pos: accessorValues(s, p.attributes.POSITION).values, nor: accessorValues(s, p.attributes.NORMAL).values, idx: accessorValues(s, p.indices).values });
  return out;
}

/** How many of a primitive's triangles there are, and how many are wound against the normals at their corners. */
function windingOf(p: { pos: Float64Array; nor: Float64Array; idx: Float64Array }): { tris: number; against: number } {
  let against = 0;
  for (let t = 0; t + 2 < p.idx.length; t += 3) {
    const [a, b, c] = [p.idx[t] * 3, p.idx[t + 1] * 3, p.idx[t + 2] * 3];
    const u = [p.pos[b] - p.pos[a], p.pos[b + 1] - p.pos[a + 1], p.pos[b + 2] - p.pos[a + 2]];
    const v = [p.pos[c] - p.pos[a], p.pos[c + 1] - p.pos[a + 1], p.pos[c + 2] - p.pos[a + 2]];
    const f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    let d = 0;
    for (const k of [a, b, c]) d += f[0] * p.nor[k] + f[1] * p.nor[k + 1] + f[2] * p.nor[k + 2];
    if (d <= 0) against++;
  }
  return { tris: p.idx.length / 3, against };
}

/** A made GLB's pictures, decoded. */
function imagesOf(glb: Buffer): { width: number; height: number; rgba: Uint8Array }[] {
  const g = readGlb(glb) as { json: { images?: { bufferView: number }[]; bufferViews: { byteOffset?: number; byteLength: number }[] }; bin: Buffer };
  return (g.json.images ?? []).map((im) => {
    const v = g.json.bufferViews[im.bufferView];
    return decodePng(g.bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength))!;
  });
}

/** A tree: a trunk, a leaf card on top and its trunk's own shape (`collision-cyl`), `tall` metres to its crown. */
function treeSource(tall = 6, trunk = 0.4): RawGltf {
  return {
    materials: [
      { name: 'Bark', pbrMetallicRoughness: { baseColorFactor: [0.4, 0.3, 0.2, 1], metallicFactor: 0 } },
      { name: 'Leaf', pbrMetallicRoughness: { baseColorFactor: [0.3, 0.6, 0.2, 1], metallicFactor: 0 }, alphaMode: 'MASK', alphaCutoff: 0.5, doubleSided: true },
    ],
    meshes: [
      { name: 'Trunk', primitives: [cube(0)] },
      { name: 'Card', primitives: [plate(4, 1)] },
      { name: 'Shape', primitives: [cube()] },
    ],
    nodes: [
      { name: 'Trunk', mesh: 0, translation: [0, tall / 2, 0], scale: [0.3, tall / 2, 0.3] },
      { name: 'Crown', mesh: 1, translation: [0, tall, 0] },
      { name: 'collision-cyl', mesh: 2, translation: [0, 3, 0], scale: [trunk, 3, trunk] },
    ],
  };
}
const TREE_RECORD = { id: 'test_tree', kind: 'flora', collision: 'auto', look: 'pbr', ship: false };
/** A tree source written and imported. */
function importTree(tall = 6, trunk = 0.4) {
  const f = join(tmp, 'tree.glb');
  writeFileSync(f, writeRawGlb(treeSource(tall, trunk)));
  return importModel(readSource(f), TREE_RECORD, IMPORT_TUNE);
}

// ---------------------------------------------------------------- 2. the pass

const src = readSource(srcFile);
const made = importModel(src, RECORD, IMPORT_TUNE);
assert.ok(!made.refuse, `the block imports (${made.refuse?.join('; ')})`);
const out = readGlb(made.glb).json as {
  nodes: { name?: string; mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[]; extensions?: unknown }[];
  scenes: { name?: string; nodes: number[] }[];
  meshes: { name?: string; primitives: { material: number; attributes: Record<string, number> }[] }[];
  materials: { name: string; doubleSided?: boolean; alphaMode?: string; extensions?: Record<string, unknown>; extras?: Record<string, unknown>; pbrMetallicRoughness?: { baseColorFactor?: number[] } }[];
  extensionsUsed?: string[];
  extensions?: unknown;
};
const close = (a: number, b: number, e = 1e-4) => Math.abs(a - b) < e;
const boxIs = (b: { min: number[]; max: number[] }, want: { min: number[]; max: number[] }) => [0, 1, 2].every((k) => close(b.min[k], want.min[k]) && close(b.max[k], want.max[k]));

ok(boxIs(made.def.bounds, WITH_STAND), `the model's box is where Blender put every part of its own level, the stand-in included (${JSON.stringify(made.def.bounds)})`);
ok(out.nodes.every((n) => !n.translation && !n.rotation && !n.scale && !n.matrix), 'every node of the made GLB carries no transform: each matrix is baked into its vertices');
ok(made.entry.tri === 62 && made.entry.colTri === 62 && made.entry.collision === 'triangles', `62 triangles drawn (four copies of the block, the pane, the banner) and 62 collided under "triangles": the stand-in in, the banner out (${made.entry.tri}, ${made.entry.colTri})`);
ok(out.materials.every((m) => m.name.startsWith('test_block:')), `every material is named for its import (${out.materials.map((m) => m.name).join(', ')})`);
const mat = (name: string) => out.materials.find((m) => m.name === name)!;
ok(mat('test_block:Stone').doubleSided === false && mat('test_block:Metal:nocol').doubleSided === true, 'a material Blender wrote double-sided is single-sided, unless the record names it');
const glass = mat('test_block:Glass');
ok(glass.alphaMode === 'BLEND' && glass.extras?.noShadow === true && close(glass.pbrMetallicRoughness!.baseColorFactor![3], IMPORT_TUNE.glassAlpha) && !glass.extensions, 'the transmissive pane is a blended pane at the glass alpha, casting nothing, its physical extensions gone');
ok(!(out.extensionsUsed ?? []).some((e) => /transmission|ior|lights_punctual/.test(e)) && !out.extensions && out.nodes.every((n) => !n.extensions), `no physical extension and no light survives (${JSON.stringify(out.extensionsUsed ?? [])})`);
ok(made.notes.some((n: string) => /light\(s\) left out/.test(n)) && made.notes.some((n: string) => /material extensions left out/.test(n)), 'and the light and the extensions are said in its notes');
ok(mat('test_block:Stone').extras?.swgNormalY === -1 && mat('test_block:Metal:nocol').extras?.swgNormalY === undefined, 'the normal-mapped material with no tangents under it carries swgNormalY: -1; one with no normal map none');
ok(mat('test_block:Metal:nocol').extras?.swgCube === true && mat('test_block:Stone').extras?.swgCube === false, 'swgCube only where metallic');
ok(mat('test_block:Metal:nocol').extras?.swgNoCollide === true && mat('test_block:colonly').extras?.swgColliderOnly === true && mat('test_block:Stone').extras?.swgNoCollide === undefined, 'the -nocol banner wears swgNoCollide, the -colonly stand-in swgColliderOnly, and a plain part neither');
ok(out.scenes.length === 2 && out.scenes[1].name === 'lods' && out.nodes[out.scenes[1].nodes[0]].name === 'lod:1' && out.nodes[out.scenes[0].nodes[0]].name === 'model:test_block', 'the lower level is the `lods` scene\'s `lod:1`, the model\'s own level `model:<id>`');
ok(made.def.lods?.length === 2 && made.def.lods[1].level === 1 && made.def.lods[1].near === 25 && made.def.lods[1].tris === 12 && made.def.lods[0].far === 25, `and the manifest's entry agrees: level 1 takes over at the record's 25 m with its 12 triangles (${JSON.stringify(made.def.lods)})`);
const pic = made.picture ? decodePng(made.picture) : null;
let painted = 0;
if (pic) for (let i = 3; i < pic.rgba.length; i += 4) if (pic.rgba[i] > 0) painted++;
ok(!!pic && painted > 200 && made.entry.pic === `icons/test_block.${made.hash8}.png`, `the library's picture is drawn (${painted} pixels of it)`);

{
  // "auto": a stand-in named, so it alone collides and every drawn part is drawn and never collided.
  const auto = importModel(src, { ...RECORD, collision: 'auto' }, IMPORT_TUNE);
  ok(!auto.refuse && auto.entry.collision === 'stand-in' && auto.entry.colTri === 12, `"auto" with a -colonly piece named collides by the stand-in alone (${auto.entry.colTri} triangles)`);
  const j = readGlb(auto.glb).json as typeof out;
  // The model's own level (a lower level never collides, so its materials need no marker).
  const own = j.meshes[j.nodes[j.scenes[0].nodes[0]].mesh!].primitives.map((p) => j.materials[p.material]);
  ok(own.filter((m) => !m.extras?.swgColliderOnly).every((m) => m.extras?.swgNoCollide === true), 'and every drawn material of its own level is never collided');
  const none = importModel(src, { ...RECORD, collision: 'none' }, IMPORT_TUNE);
  ok(!none.refuse && none.entry.colTri === 0 && !(readGlb(none.glb).json as typeof out).materials.some((m) => m.extras?.swgColliderOnly), '"none" collides nothing and keeps no stand-in');
  ok(COLLISION_RULES.join() === 'auto,triangles,stand-in,none', 'the four collision rules');
}

{
  // A borrowed picture: named and never carried, a white texel in its slot where the material had none, the look on the def.
  const b = importModel(src, { ...RECORD, look: 'client', borrow: { Metal: { map: 'naboo:rock/shader/rock.sht', tint: '#c0a080' } } }, IMPORT_TUNE);
  const j = readGlb(b.glb).json as typeof out & { images?: { name?: string }[] };
  const metal = j.materials.find((m) => m.name === 'test_block:Metal:nocol')!;
  ok(!b.refuse && JSON.stringify(b.def.looks) === JSON.stringify([{ of: 'test_block:Metal:nocol', map: 'naboo:rock/shader/rock.sht', tint: '#c0a080' }]), `a borrow goes on the def as the model's own look, by the material's name in the model (${JSON.stringify(b.def.looks)})`);
  ok((metal.pbrMetallicRoughness as { baseColorTexture?: unknown }).baseColorTexture !== undefined && (j.images ?? []).some((im) => im.name === 'white') && b.notes.some((n: string) => /white one stands in/.test(n)), "a material with no picture of its own takes a white texel in the borrowed picture's slot, and says so");
  ok(!JSON.stringify(j).includes('naboo:rock'), 'and nothing of the borrowed picture is carried in the GLB');
  ok(typeof metal.extras?.swgSpec === 'object' && (metal.extras.swgSpec as { mode: string }).mode === 'phong' && mat('test_block:Stone').extras?.swgSpec === undefined, "look 'client' writes the client's highlight; 'pbr' none");
}

const tree = importTree();
{
  // A flora model: its leaf a card doubled with a back sheet, its own shapes into flora-collision.json, its manifest entry flora's.
  const t = tree;
  ok(!t.refuse && t.flora && t.def.appearance === 'imported/test_tree' && t.entry.collision === 'shapes', 'a flora model is filed as flora, its shapes keyed by its appearance');
  const cyl = t.collision?.shapes?.[0] as { t: string; c: number[]; r: number; h: number } | undefined;
  ok(!!cyl && cyl.t === 'cyl' && close(cyl.r, 0.4) && close(cyl.h, 6) && close(cyl.c[1], 0) && close(cyl.c[0], 0), `its collision-cyl a trunk of radius 0.4 and 6 m from the ground (${JSON.stringify(cyl)})`);
  const tj = readGlb(t.glb).json as typeof out;
  const leaf = tj.materials.find((m) => m.name === 'test_tree:Leaf')!;
  ok(!!leaf.extras?.swgCard && t.cards['test_tree:Leaf'] !== undefined && leaf.doubleSided === false, 'its leaf is a card of its own class, single-sided (the card rule draws it from its front)');
  ok(t.entry.tri === 12 + 4, `and its sheet is doubled with a back (${t.entry.tri} triangles: the trunk's 12 and the card's 2 twice)`);
  // The back sheet itself: the front's corners again, its normals turned round, each triangle the front's wound the other
  // way, and every triangle of the model (back and front) wound the way the normals at its corners face.
  const sheet = primsOf(t.glb).find((p) => p.material === 'test_tree:Leaf')!;
  const n = sheet.pos.length / 3;
  const half = n / 2;
  let turned = true;
  for (let i = 0; i < half * 3; i++) if (sheet.pos[half * 3 + i] !== sheet.pos[i] || sheet.nor[half * 3 + i] !== -sheet.nor[i]) turned = false;
  const front = sheet.idx.length / 2;
  let reversed = true;
  for (let k = 0; k < front; k += 3) if (sheet.idx[front + k] !== sheet.idx[k] + half || sheet.idx[front + k + 1] !== sheet.idx[k + 2] + half || sheet.idx[front + k + 2] !== sheet.idx[k + 1] + half) reversed = false;
  const w = primsOf(t.glb).map(windingOf);
  ok(turned && reversed && w.every((x) => x.against === 0) && w.reduce((s, x) => s + x.tris, 0) === 16, `the leaf's back sheet is its front's corners with their normals turned round, every triangle wound the other way, and all ${w.reduce((s, x) => s + x.tris, 0)} triangles face their normals`);
}

{
  // A slanted face under a size that is not the same every way, under a parent tipped 30 degrees about X: its normal is
  // carried by the matrix's inverse transposed and made unit again, which is the baked face's own normal; carried by the
  // matrix itself it would lean the other way.
  const k = Math.SQRT1_2 * Math.sqrt(2 / 3);
  const wedge: RawGltf = {
    materials: [{ name: 'Wedge', pbrMetallicRoughness: { metallicFactor: 0 } }],
    meshes: [{ name: 'Wedge', primitives: [{ positions: [1, 0, 0, 0, 1, 0, 0, 0, 1], normals: [k, k, k, k, k, k, k, k, k], indices: [0, 1, 2], material: 0 }] }],
    nodes: [
      { name: 'Tip', rotation: [Math.sin(Math.PI / 12), 0, 0, Math.cos(Math.PI / 12)], children: [1] },
      { name: 'Wedge', mesh: 0, translation: [0, 1, 0], scale: [2, 1, 0.5] },
    ],
  };
  const wf = join(tmp, 'wedge.glb');
  writeFileSync(wf, writeRawGlb(wedge));
  const wm = importModel(readSource(wf), { id: 'test_wedge', kind: 'prop', collision: 'auto', look: 'pbr', ship: false }, IMPORT_TUNE);
  const p = primsOf(wm.glb)[0];
  const ax = p.pos[3] - p.pos[0], ay = p.pos[4] - p.pos[1], az = p.pos[5] - p.pos[2];
  const bx = p.pos[6] - p.pos[0], by = p.pos[7] - p.pos[1], bz = p.pos[8] - p.pos[2];
  const g = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
  const gl = Math.hypot(g[0], g[1], g[2]);
  let worst = 0;
  let unit = 0;
  for (let i = 0; i < 3; i++) {
    const nx = p.nor[i * 3], ny = p.nor[i * 3 + 1], nz = p.nor[i * 3 + 2];
    worst = Math.max(worst, Math.hypot(nx - g[0] / gl, ny - g[1] / gl, nz - g[2] / gl));
    unit = Math.max(unit, Math.abs(Math.hypot(nx, ny, nz) - 1));
  }
  ok(!wm.refuse && worst < 1e-5 && unit < 1e-6, `a slanted face's baked normal is the baked face's own, unit length (off by ${worst.toExponential(1)}, length off by ${unit.toExponential(1)})`);
}

{
  // A strip and a fan, read as lists of triangles each wound the way the exporter's normals face, and the fan's every
  // triangle about its first corner (its middle here, at x 3).
  const quad = [-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0];
  const up = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
  const ring = [0, 0, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, -1, -1, 0];
  const strips: RawGltf = {
    materials: [{ name: 'Flat', pbrMetallicRoughness: { metallicFactor: 0 } }],
    meshes: [
      { name: 'Strip', primitives: [{ positions: quad, normals: up, indices: [0, 1, 2, 3], material: 0, mode: 5 }] },
      { name: 'Fan', primitives: [{ positions: ring, normals: [...up, 0, 0, 1], indices: [0, 1, 2, 3, 4], material: 0, mode: 6 }] },
    ],
    nodes: [
      { name: 'Strip', mesh: 0 },
      { name: 'Fan', mesh: 1, translation: [3, 0, 0] },
    ],
  };
  const sf = join(tmp, 'strips.glb');
  writeFileSync(sf, writeRawGlb(strips));
  const sm = importModel(readSource(sf), { id: 'test_strips', kind: 'prop', collision: 'auto', look: 'pbr', ship: false }, IMPORT_TUNE);
  const prims = primsOf(sm.glb);
  const w = prims.map(windingOf);
  let aboutMiddle = 0;
  for (const p of prims) {
    for (let t = 0; t + 2 < p.idx.length; t += 3) {
      if ([p.idx[t], p.idx[t + 1], p.idx[t + 2]].some((i) => p.pos[i * 3] === 3 && p.pos[i * 3 + 1] === 0)) aboutMiddle++;
    }
  }
  ok(!sm.refuse && sm.entry.tri === 5 && w.every((x) => x.against === 0) && aboutMiddle === 3 && sm.notes.some((s: string) => /strip or fan/.test(s)), `a strip and a fan are made five triangles, each wound the way its normals face, the fan's three all about its first corner, and said (${sm.entry.tri} triangles, ${w.map((x) => x.against).join('+')} against, ${aboutMiddle} about the fan's middle)`);
}

{
  // The same block written as Blender's "glTF Separate" writes it (a .gltf, its .bin beside it, its picture in a folder of
  // its own whose name has a space): read whole, the very same model, byte for byte.
  const gf = writeRawGltf(block(), join(tmp, 'separate'), 'Block');
  const fromGltf = importModel(readSource(gf), RECORD, IMPORT_TUNE);
  ok(!fromGltf.refuse && fromGltf.hash8 === made.hash8 && fromGltf.glb.equals(made.glb), `a .gltf with its .bin and its picture beside it imports the very model its .glb does (${fromGltf.hash8} and ${made.hash8})`);
}

{
  // A picture past --tex-max (an 8-bit PNG) shrunk to it, said; under it kept as it was.
  const wide = new Uint8Array(4096 * 16 * 4).fill(200);
  const pic: RawGltf = {
    materials: [{ name: 'Wide', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 } }],
    textures: [{ source: 0, sampler: 0 }],
    images: [{ name: 'wide', png: encodePng(4096, 16, wide) }],
    meshes: [{ name: 'Card', primitives: [plate(2, 0)] }],
    nodes: [{ name: 'Card', mesh: 0 }],
  };
  const pf = join(tmp, 'wide.glb');
  writeFileSync(pf, writeRawGlb(pic));
  const shrunk = importModel(readSource(pf), { id: 'test_wide', kind: 'prop', collision: 'auto', look: 'pbr', ship: false }, { ...IMPORT_TUNE, texMax: 2048 });
  const im = imagesOf(shrunk.glb)[0];
  ok(!shrunk.refuse && im.width === 2048 && im.height === 8 && shrunk.notes.some((s: string) => /shrunk to it/.test(s)), `a 4096 by 16 picture past a tex-max of 2048 is made 2048 by 8, and said (${im.width} by ${im.height})`);
  const kept = importModel(readSource(pf), { id: 'test_wide', kind: 'prop', collision: 'auto', look: 'pbr', ship: false }, { ...IMPORT_TUNE, texMax: 4096 });
  ok(imagesOf(kept.glb)[0].width === 4096, 'and one at the tex-max is kept as it was');
}

{
  // look 'client': the client's highlight is masked by the metal-rough picture's red, which glTF leaves to the exporter (an
  // ORM export packs its occlusion there), so the pass gives the metal-rough slot a copy with its red made one; its green
  // and blue (glTF's roughness and metalness) and an occlusion map on the same picture keep the original.
  const orm: RawGltf = {
    materials: [{ name: 'Packed', pbrMetallicRoughness: { metallicFactor: 1, roughnessFactor: 1, metallicRoughnessTexture: { index: 0 } }, occlusionTexture: { index: 0 } }],
    textures: [{ source: 0, sampler: 0 }],
    images: [{ name: 'orm', png: solidPng(8, [40, 128, 250, 255]) }],
    meshes: [{ name: 'Card', primitives: [plate(2, 0)] }],
    nodes: [{ name: 'Card', mesh: 0 }],
  };
  const of = join(tmp, 'orm.glb');
  writeFileSync(of, writeRawGlb(orm));
  const rec = { id: 'test_orm', kind: 'prop', collision: 'auto', ship: false };
  const client = importModel(readSource(of), { ...rec, look: 'client' }, IMPORT_TUNE);
  const cj = readGlb(client.glb).json as { materials: { pbrMetallicRoughness: { metallicRoughnessTexture: { index: number } }; occlusionTexture: { index: number } }[]; textures: { source: number }[] };
  const imgs = imagesOf(client.glb);
  const mrImg = imgs[cj.textures[cj.materials[0].pbrMetallicRoughness.metallicRoughnessTexture.index].source];
  const aoImg = imgs[cj.textures[cj.materials[0].occlusionTexture.index].source];
  ok(!client.refuse && [...mrImg.rgba.slice(0, 4)].join() === '255,128,250,255' && [...aoImg.rgba.slice(0, 4)].join() === '40,128,250,255', `under look 'client' the metal-rough slot's picture has its red made one, its roughness and metalness kept, and the occlusion map keeps the original (${[...mrImg.rgba.slice(0, 4)].join()} and ${[...aoImg.rgba.slice(0, 4)].join()})`);
  const pbr = importModel(readSource(of), { ...rec, look: 'pbr' }, IMPORT_TUNE);
  const pj = readGlb(pbr.glb).json as typeof cj;
  ok(pj.materials[0].pbrMetallicRoughness.metallicRoughnessTexture.index === pj.materials[0].occlusionTexture.index && imagesOf(pbr.glb).length === 1, "under 'pbr' the picture is carried as the file has it, one texture for both slots");
}

{
  // A model's looks held to the run-time reader's own limits: past them `readLooks` drops the whole list, so the pass refuses.
  ok(LOOK_LIMITS.looks === PLACEMENT_LIMITS.looks && LOOK_LIMITS.material === PLACEMENT_LIMITS.material, `the pass's limits on a model's looks are the reader's (${LOOK_LIMITS.looks} looks, names of ${LOOK_LIMITS.material})`);
  const many = (count: number, name = (i: number) => `M${i}`): RawGltf => ({
    materials: Array.from({ length: count }, (_, i) => ({ name: name(i), pbrMetallicRoughness: { metallicFactor: 0 } })),
    meshes: Array.from({ length: count }, (_, i) => ({ name: `Box${i}`, primitives: [cube(i)] })),
    nodes: Array.from({ length: count }, (_, i) => ({ name: `Box${i}`, mesh: i, translation: [i * 3, 1, 0] })),
  });
  const run = (doc: RawGltf, borrow: Record<string, unknown>) => {
    const f = join(tmp, 'many.glb');
    writeFileSync(f, writeRawGlb(doc));
    return importModel(readSource(f), { id: 'test_many', kind: 'prop', collision: 'triangles', look: 'pbr', ship: false, borrow }, IMPORT_TUNE);
  };
  const tint = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`M${i}`, { tint: '#808080' }]));
  const fits = run(many(LOOK_LIMITS.looks), tint(LOOK_LIMITS.looks));
  const over = run(many(LOOK_LIMITS.looks + 1), tint(LOOK_LIMITS.looks + 1));
  ok(!fits.refuse && readLooks(fits.def.looks)?.length === LOOK_LIMITS.looks && !!over.refuse && /past the 64 a model carries/.test(over.refuse[0]) && readLooks([...fits.def.looks, { of: 'test_many:extra', tint: '#808080' }]) === null, `${LOOK_LIMITS.looks} looks read whole in the game; one more, which the game would drop whole, is refused in words ("${over.refuse?.[0]}")`);
  const long = run(many(1, () => 'L'.repeat(115)), { ['L'.repeat(115)]: { tint: '#808080' } });
  ok(!!long.refuse && /named past 120 characters/.test(long.refuse[0]) && looksRefusal([{ of: 'test_many:ok', tint: '#808080' }]) === null, 'a borrowed material named past what a look can name is refused, and one within it is not');
  ok(typeof readRecord({ id: 'ok', borrow: { Stone: { map: `naboo:rock/${'x'.repeat(121)}` } } }) === 'string', "and a borrow naming a material past what the game reads is refused as the record is read");
}

{
  // The library's walker (which multiplies node matrices in) and the world (which reads a mesh's own vertices) agree on the made GLB.
  const lib = new THREE.Box3();
  for (const m of glbMeshes(made.glb)) for (let i = 0; i < m.positions.length; i += 3) lib.expandByPoint(new THREE.Vector3(m.positions[i], m.positions[i + 1], m.positions[i + 2]));
  ok(boxIs({ min: lib.min.toArray(), max: lib.max.toArray() }, DRAWN), `the library draws the drawn parts where Blender put them, the stand-in left out (${lib.min.toArray().map((v) => v.toFixed(2))} .. ${lib.max.toArray().map((v) => v.toFixed(2))})`);
}

// ---------------------------------------------------------------- 3. read back through the game's own AssetPack

const folder = join(tmp, 'site', 'imports-private');
writeImport(folder, made);
const SITE = 'http://imports.test/';
const realFetch = globalThis.fetch;
const g = globalThis as unknown as { self?: unknown; createImageBitmap?: unknown; ProgressEvent?: unknown };
const hadSelf = 'self' in g;
const hadProgress = 'ProgressEvent' in g;
const realBitmap = g.createImageBitmap;
let decoded = 0;
g.self ??= globalThis;
// Three's file loader reports its progress with a page's event, which node has not got.
g.ProgressEvent ??= class extends Event {
  constructor(type: string, init: Record<string, unknown> = {}) {
    super(type);
    Object.assign(this, init);
  }
};
g.createImageBitmap = async () => {
  decoded++;
  return { width: 32, height: 32, close() {} };
};
const served: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  if (url.startsWith('blob:')) return realFetch(input as RequestInfo, init);
  served.push(url);
  const root = `${SITE}`;
  const file = url.startsWith(root) ? join(tmp, 'site', ...url.slice(root.length).split('/')) : '';
  if (!file || !existsSync(file)) return new Response('missing', { status: 404, headers: { 'content-type': 'text/plain' } });
  const type = file.endsWith('.json') ? 'application/json' : file.endsWith('.glb') ? 'model/gltf-binary' : 'image/png';
  return new Response(readFileSync(file), { status: 200, headers: { 'content-type': type } });
}) as typeof fetch;

/** Every vertex of a list of primitives, in their geometry's own frame (the world draws nothing else). */
function boxOf(prims: { geometry: THREE.BufferGeometry }[]): THREE.Box3 {
  const b = new THREE.Box3();
  for (const p of prims) {
    p.geometry.computeBoundingBox();
    b.union(p.geometry.boundingBox!);
  }
  return b;
}

try {
  const pack = await AssetPack.load('imported', SITE, { dir: 'imports-private/' });
  ok(!!pack && pack.imported && !!pack.find('test_block'), 'the folder loads as a pack of its own, marked imported, its model found by id');
  ok(served.includes(`${SITE}imports-private/manifest.json`), 'its manifest asked from its own folder');
  // A folder of no house with rooms asks for no rooms' floors or doors (the eleventh wave's files): a file known not to be
  // there is never asked for, and this folder stands as it did at 441c2f6.
  ok(!served.some((u) => /imports-private\/(floors|doors)\.json/.test(u)), `and neither floors.json nor doors.json, holding no house with rooms (${served.filter((u) => u.startsWith(SITE)).map((u) => u.slice(SITE.length)).join(', ')})`);
  const loaded = (await pack!.model('test_block')) as LoadedModel;
  ok(served.some((u) => u === `${SITE}imports-private/${made.def.file}`), `its GLB fetched by its content-hashed name (${made.def.file})`);
  let moved = 0;
  loaded.scene.traverse((o) => {
    if (!o.position.equals(new THREE.Vector3()) || !o.quaternion.equals(new THREE.Quaternion()) || !o.scale.equals(new THREE.Vector3(1, 1, 1))) moved++;
  });
  ok(moved === 0, 'nothing in the loaded scene carries a transform');
  const drawn = boxOf(loaded.primitives);
  ok(boxIs({ min: drawn.min.toArray(), max: drawn.max.toArray() }, DRAWN), `the parts the world draws stand where Blender put them (${drawn.min.toArray().map((v) => v.toFixed(2))} .. ${drawn.max.toArray().map((v) => v.toFixed(2))})`);
  // The turned parent's child: a half-metre block at x 5.5..6.5 (the arm turned a quarter about up carries its z 2 to x 2).
  let arm = 0;
  for (const p of loaded.primitives) {
    const a = p.geometry.getAttribute('position');
    for (let i = 0; i < a.count; i++) if (close(a.getX(i), 6.5) && a.getY(i) <= 1.0001 && a.getY(i) >= -0.0001 && Math.abs(a.getZ(i)) <= 0.5001) arm++;
  }
  ok(arm >= 4, `the child of a turned parent stands at x 6.5 (${arm} corners there)`);
  // Every triangle's winding agrees with its normals: the mirrored copy's was turned with it.
  let against = 0;
  let tris = 0;
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const C = new THREE.Vector3();
  const N = new THREE.Vector3();
  for (const p of [...loaded.primitives, ...(loaded.colliderOnly ?? [])]) {
    const pos = p.geometry.getAttribute('position');
    const nor = p.geometry.getAttribute('normal');
    const idx = p.geometry.getIndex()!;
    for (let t = 0; t < idx.count; t += 3) {
      const i0 = idx.getX(t);
      const i1 = idx.getX(t + 1);
      const i2 = idx.getX(t + 2);
      A.fromBufferAttribute(pos, i0);
      B.fromBufferAttribute(pos, i1).sub(A);
      C.fromBufferAttribute(pos, i2).sub(A);
      N.fromBufferAttribute(nor, i0).add(new THREE.Vector3().fromBufferAttribute(nor, i1)).add(new THREE.Vector3().fromBufferAttribute(nor, i2));
      tris++;
      if (B.cross(C).dot(N) <= 0) against++;
    }
  }
  ok(tris === 74 && against === 0, `every one of the ${tris} triangles is wound the way its normals face, the mirrored copy's included`);
  const byName = (n: string) => loaded.primitives.map((p) => p.material).find((m) => m.name === n) as THREE.MeshStandardMaterial | undefined;
  const stone = byName('test_block:Stone')!;
  const metal = byName('test_block:Metal:nocol')!;
  const pane = byName('test_block:Glass')!;
  ok(!!stone && stone.side === THREE.FrontSide && metal.side === THREE.DoubleSide, 'loaded, the Blender-double-sided material is single-sided and the one the record names both');
  ok(!!pane && pane.transparent && close(pane.opacity, IMPORT_TUNE.glassAlpha) && pane.userData.noShadow === true && !(pane as unknown as { isMeshPhysicalMaterial?: boolean }).isMeshPhysicalMaterial, 'the pane loads a blended standard material, noShadow, with no transmission pass');
  ok(normalYOf(stone) === -1 && normalYOf(metal) === 1 && !!stone.normalMap && stone.normalScale.y === -1, "the normal map is read the glTF way: the marker turns the world's own override round (normalYOf -1), as three itself reads a map with no tangents");
  ok(metal.userData.swgNoCollide === true && stone.userData.swgNoCollide === undefined, 'the banner keeps swgNoCollide, the stone collides');
  ok(loaded.colliderOnly?.length === 1 && loaded.colliderOnly[0].material.userData.swgColliderOnly === true && !loaded.primitives.some((p) => p.material.userData.swgColliderOnly), 'the stand-in is in colliderOnly and never in primitives, which everything that draws reads');
  let lights = 0;
  loaded.scene.traverse((o) => void ((o as THREE.Light).isLight && lights++));
  ok(lights === 0, 'no light in the loaded scene');
  ok(!!loaded.levels && loaded.levels.length === 2 && loaded.levels[1].near === 25 && loaded.levels[1].primitives.length === 1 && loaded.levels[0].far === 25, 'the levels read from the `lods` scene as the manifest says');
  ok(boxIs({ min: loaded.bounds.min.toArray(), max: loaded.bounds.max.toArray() }, WITH_STAND), 'and the loaded bounds are the manifest\'s');
  ok(decoded >= 1, `its picture was decoded (${decoded})`);

  {
    // A file with a light, put in a folder by hand rather than made by the pass: the pack holds it to the same.
    const hand = join(tmp, 'site', 'imports');
    const lit = block();
    lit.materials = [{ name: 'test_lit:Stone', pbrMetallicRoughness: { metallicFactor: 0 } }];
    lit.meshes = [{ name: 'Cube', primitives: [cube(0)] }];
    lit.nodes = [{ name: 'Base', mesh: 0 }, { name: 'Lamp', translation: [0, 3, 0], extensions: { KHR_lights_punctual: { light: 0 } } }];
    delete lit.textures;
    delete lit.images;
    mkdirSync(hand, { recursive: true });
    writeFileSync(join(hand, 'test_lit.00000000.glb'), writeRawGlb(lit));
    writeFileSync(join(hand, 'manifest.json'), JSON.stringify({ planet: 'imported', categories: { layout: [{ id: 'test_lit', file: 'test_lit.00000000.glb', bounds: { min: [-1, -1, -1], max: [1, 1, 1] }, triangles: 12 }], flora: [] } }));
    const shipped = await AssetPack.load('imported', SITE, { dir: 'imports/' });
    const m = await shipped!.model('test_lit');
    let n = 0;
    for (const s of [m.scene]) s.traverse((o) => void ((o as THREE.Light).isLight && n++));
    ok(n === 0 && m.primitives.length === 1, 'a light in a file put in the folder by hand is taken out as it loads');
  }

  {
    // A flora import read back from a folder: its own shapes merged onto its entry out of the folder's flora-collision.json,
    // its leaf known for a card, and it measured for the sway under its made file's content-hashed name, never its id, so the
    // same id made again (taller) and read again, as the editor's Reload imports reads it, sways from its new shape.
    const trees = join(tmp, 'site', 'trees');
    writeImport(trees, tree);
    const pack = await AssetPack.load('imported', SITE, { dir: 'trees/' });
    const def = pack?.find('test_tree') as { collision?: { kind: string; shapes: { t: string; r: number; h: number }[] } } | undefined;
    ok(!!def?.collision && def.collision.shapes[0].t === 'cyl' && close(def.collision.shapes[0].r, 0.4) && close(def.collision.shapes[0].h, 6), `its own shapes are merged onto its entry as it loads (${JSON.stringify(def?.collision)})`);
    ok(isCardShader('test_tree:Leaf'), 'its leaf is known for a card from its folder\'s manifest');
    const first = await pack!.model('test_tree');
    const leafOf = (m: LoadedModel) => m.primitives.map((p) => p.material).find((x) => x.name === 'test_tree:Leaf')!;
    const key1 = leafOf(first).userData.swgSway as string;
    ok(key1 === `${SITE}trees/${tree.def.file}` && swayModel(key1)?.id === 'test_tree', `it is measured for the sway under its made file's name (${key1})`);
    const tall = importTree(12);
    ok(tall.def.file !== tree.def.file, 'the tree made again taller is another file');
    writeImport(trees, tall);
    // The editor's Reload imports lets the folder's packs go, its leaves forgotten by name, and reads it again.
    ok(forgetImportCards(['test_tree']) >= 1 && !isCardShader('test_tree:Leaf'), "letting the folder go forgets its models' leaves by name");
    const again = await AssetPack.load('imported', SITE, { dir: 'trees/' });
    const second = await again!.model('test_tree');
    const key2 = leafOf(second).userData.swgSway as string;
    ok(isCardShader('test_tree:Leaf') && key2 !== key1 && (swayModel(key2)?.shape.H ?? 0) > (swayModel(key1)?.shape.H ?? 0) + 4, `read again, its leaf is a card once more and it sways from its new height (${swayModel(key1)?.shape.H.toFixed(1)} m, now ${swayModel(key2)?.shape.H.toFixed(1)} m)`);
    ok(forgetImportCards(['test', 'test_tree_big']) === 0 && isCardShader('test_tree:Leaf'), 'and only the ids named are forgotten (an id its name begins with, or one beginning with its name, is not it)');
  }
} finally {
  globalThis.fetch = realFetch;
  g.createImageBitmap = realBitmap;
  if (!hadSelf) delete g.self;
  if (!hadProgress) delete g.ProgressEvent;
}

// ---------------------------------------------------------------- 3b. the walk grid's bake

{
  // The bake stands a solid imported row on its model's own triangles, the stand-in in and the -nocol banner out, and keys
  // the grid on the made file's content-hashed name, so a model made again is baked again.
  const nav = join(tmp, 'nav-imports');
  writeImport(nav, made);
  const packs = { importDirs: [nav], importManifestOf: (d: string) => JSON.parse(readFileSync(join(d, 'manifest.json'), 'utf8')), importCollisionOf: () => null };
  const found = solidRowModel({ pack: 'imported', model: 'test_block' }, packs);
  ok(!!found.file && found.file.endsWith(made.def.file) && found.absent.length === 0 && !found.flora && found.pack === 'imported', 'the bake finds an imported row\'s model in the folder that holds it');
  ok(solidRowModel({ pack: 'imported', model: 'not_made' }, packs).absent.join() === 'imported/not_made', 'and names one no folder holds, so the grid is asked for again once it is made');
  const tri = readGlbTriangles(found.file!);
  ok(tri.positions.length / 9 === 62, `it rasterises the triangles that collide: the stone and the pane (50) and the stand-in (12), never the banner nor the lower level (${tri.positions.length / 9})`);
  const keyDir = join(tmp, 'keyworld');
  mkdirSync(keyDir, { recursive: true });
  writeFileSync(join(keyDir, 'layout.json'), '{"objects":[]}');
  const plain = layoutKeyOf(keyDir, null, { texts: {} });
  ok(plain === layoutKeyOf(keyDir, null, { texts: {}, imports: [] }) && plain !== layoutKeyOf(keyDir, null, { texts: {}, imports: [made.def.file] }) && layoutKeyOf(keyDir, null, { texts: {}, imports: ['a.11111111.glb'] }) !== layoutKeyOf(keyDir, null, { texts: {}, imports: ['a.22222222.glb'] }), "the grid's key folds in the made files an imported row stands on, and a world with none keys as before");
  // gridEditsOf over a placements folder of the test's own: its imports folder beside it, a solid row of the model in the
  // world's file, the made file's name in the edits; a row in a room, or none, names none.
  const site = join(tmp, 'gridsite');
  mkdirSync(join(site, 'placements', 'world'), { recursive: true });
  writeImport(join(site, 'imports'), made);
  const row = { id: 'block-1', kind: 'prop', pack: 'imported', model: 'test_block', x: 10, y: 0, z: 20, q: [0, 0, 0, 1] };
  writeFileSync(join(site, 'placements', 'world', 'keyworld.json'), placementsFileText('keyworld', 'raw', [row] as never));
  const edits = gridEditsOf('keyworld', join(site, 'placements'), keyDir);
  ok(JSON.stringify(edits.imports) === JSON.stringify([made.def.file]) && edits.absent.length === 0, `the bake's edits name the made file a solid imported row stands on (${JSON.stringify(edits.imports)})`);
  writeFileSync(join(site, 'placements', 'world', 'keyworld.json'), placementsFileText('keyworld', 'raw', [{ ...row, inside: true }] as never));
  ok(gridEditsOf('keyworld', join(site, 'placements'), keyDir).imports === undefined, 'and a row in a room names none (the bake leaves a room\'s furniture to the room)');
  // A flora import: the bake reads its shapes out of the folder that holds it (through the install's own packs, as the bake
  // itself does), and since they are in no GLB, they go into the key beside the made file's name, so a trunk moved in
  // Blender and imported again asks for the grid again though its GLB is the very same file.
  writeImport(join(site, 'imports'), tree);
  const treeRow = { id: 'tree-1', kind: 'prop', pack: 'imported', model: 'test_tree', x: 30, y: 0, z: 20, q: [0, 0, 0, 1] };
  writeFileSync(join(site, 'placements', 'world', 'keyworld.json'), placementsFileText('keyworld', 'raw', [row, treeRow] as never));
  const own = solidRowModel(treeRow, installPacks(keyDir, null, join(site, 'placements')));
  const shape = (own.def as { collision?: { shapes: { t: string; r: number }[] } } | null)?.collision?.shapes?.[0];
  ok(own.flora && !!shape && shape.t === 'cyl' && close(shape.r, 0.4), `the bake stands an imported tree on its own collision-cyl out of its folder, never the guessed trunk (${JSON.stringify(shape)})`);
  const withTree = gridEditsOf('keyworld', join(site, 'placements'), keyDir).imports ?? [];
  const treeKey = withTree.find((n: string) => n.startsWith(`${tree.def.file}#`));
  ok(withTree.length === 2 && withTree.includes(made.def.file) && !!treeKey && treeKey === importKeyOf(own), `the key names the tree's made file with its shapes beside it (${withTree.join(', ')})`);
  const thicker = importTree(6, 0.6);
  ok(thicker.def.file === tree.def.file, 'the tree made again with a thicker trunk shape is the very same GLB');
  writeImport(join(site, 'imports'), thicker);
  const moved = gridEditsOf('keyworld', join(site, 'placements'), keyDir).imports ?? [];
  ok(moved.includes(made.def.file) && moved.some((n: string) => n.startsWith(`${tree.def.file}#`)) && !moved.includes(treeKey!), `and yet the key moves with its shapes (${moved.join(', ')})`);
  ok(layoutKeyOf(keyDir, null, { texts: {}, imports: withTree }) !== layoutKeyOf(keyDir, null, { texts: {}, imports: moved }), 'so the grid is asked for again');
}

// ---------------------------------------------------------------- 4. refusals, the record, the flags, the folder

{
  const draco = sourceRefusals({ extensionsUsed: ['KHR_draco_mesh_compression'], extensionsRequired: ['KHR_draco_mesh_compression'] });
  ok(draco.length === 1 && /Draco/.test(draco[0]) && /no decoder/.test(draco[0]), `Draco is refused in words ("${draco[0]}")`);
  ok(sourceRefusals({ extensionsUsed: ['EXT_meshopt_compression'] }).some((w: string) => /meshopt/.test(w)) && sourceRefusals({ extensionsUsed: ['KHR_texture_basisu'] }).some((w: string) => /KTX2/.test(w)) && sourceRefusals({ extensionsUsed: ['EXT_mesh_gpu_instancing'] }).some((w: string) => /GPU instancing/.test(w)), 'and so are meshopt, KTX2 and GPU instancing');
  ok(sourceRefusals({ extensionsRequired: ['EXT_something_new'] }).some((w: string) => /requires EXT_something_new/.test(w)), 'and an extension it does not know that the file requires');
  const d = importModel({ ...src, json: { ...src.json, nodes: [...src.json.nodes, { name: 'cell:17:4way', mesh: 0 }] } }, RECORD, IMPORT_TUNE);
  ok(!!d.refuse && d.refuse.some((w: string) => /begins with a digit/.test(w)), `a cell whose own name begins with a digit is refused in words ("${d.refuse?.[0]}")`);
  // A room's names that read are a house's rooms since the eleventh wave (`importRooms.test.ts`), and refuse nothing; one that
  // begins as a room's and does not read as one is refused in words, and a name merely beginning with the word is not one.
  ok(roomRefusal('portal:1:2') === null && roomRefusal('cell:1:hall') === null && /is not portal:<room>:<room>/.test(roomRefusal('portal:front') ?? '') && roomRefusal('Cellar') === null, "a room's names that read refuse nothing, one that does not read is refused in words, and a name merely beginning with the word is not one");
  const nothing = importModel({ ...src, json: { ...src.json, nodes: [{ name: 'Only-colonly', mesh: 0 }], scenes: [{ nodes: [0] }] } }, RECORD, IMPORT_TUNE);
  ok(!!nothing.refuse && /nothing drawn/.test(nothing.refuse[0]), 'a model with nothing drawn at its own level is refused');
}

{
  // Names on objects.
  const r = (n: string, x?: Record<string, unknown>) => nameRole(n, x ?? null);
  ok(r('Wall').role === 'draw' && r('Wall.001').base === 'Wall' && r('Stand-colonly').role === 'colonly' && r('Sign-nocol.003').role === 'nocol', "names: drawn, -colonly, -nocol, Blender's .001 left out");
  ok(r('Hut_LOD2').level === 2 && r('Stand-colonly_LOD1').role === 'colonly' && r('Stand-colonly_LOD1').level === 1 && r('Low_LOD1-nocol').level === 1 && r('Low_LOD1-nocol').role === 'nocol', '_LOD1.._LOD3 in either order with a role');
  ok(r('Hut_LOD4').badLevel === 4 && r('Hut_LOD4').level === 0, 'a level past three is said and taken for the model\'s own');
  ok(r('collision-cyl').role === 'shape' && r('collision-cyl').shape === 'cyl' && r('collision-box.002').shape === 'box' && r('collision-ball_trunk').shape === 'ball', 'collision-cyl, -box, -ball are a flora model\'s shapes');
  ok(r('Wall', { role: 'colonly' }).role === 'colonly' && r('Wall', { lod: 2 }).level === 2 && r('Wall', { shape: 'box' }).role === 'shape', 'a custom property role, lod or shape overrides the name');
}

{
  // The record.
  ok(idOfStem('My House.v2') === 'my_house_v2' && idOfStem('___') === 'model' && idOfStem('9lives') === '9lives', 'an id from a file\'s stem');
  const fresh = defaultRecord('Tall Tree');
  ok(fresh.id === 'tall_tree' && fresh.kind === 'prop' && fresh.collision === 'auto' && fresh.ship === false && fresh.name === 'Tall Tree', 'a source with no record is given every default, its id from its name');
  ok(typeof readRecord({ id: 'Bad Id' }) === 'string' && typeof readRecord({ id: 'ok', kind: 'house' }) === 'string' && typeof readRecord({ id: 'ok', lods: [50, 20] }) === 'string' && typeof readRecord({ id: 'ok', ship: 'yes' }) === 'string', 'a record of a wrong shape is refused in words (an id, a kind, falling lods, a ship that is not true or false)');
  ok(typeof readRecord({ id: 'ok', borrow: { Stone: { map: 'naboo:rock/shader' } } }) === 'object' && typeof readRecord({ id: 'ok', borrow: { Stone: { like: 'naboo:rock/a', tint: '#ffffff' } } }) === 'string' && typeof readRecord({ id: 'ok', borrow: { Stone: { map: 'texture/x.dds' } } }) === 'string', 'a borrow names <pack>:<model>/<material>, a material alone with no tint beside it');
  const kept = readRecord({ id: 'ok', licence: 'CC-BY 4.0', credit: 'somebody' });
  ok(typeof kept === 'object' && kept.licence === 'CC-BY 4.0' && kept.credit === 'somebody', "a third-party model's licence and credit are kept");
  const rf = recordFor(join(tmp, 'Nothing Here.glb'));
  ok(rf.made === true && rf.record.id === 'nothing_here' && !existsSync(rf.path), 'recordFor hands a fresh record for a source with none and writes nothing itself');
}

{
  // The flags.
  const t = tuneOf({ 'collision-budget': '5', lods: '10,20' });
  ok(typeof t === 'object' && t.collisionBudget === 5 && t.lods.join() === '10,20' && IMPORT_TUNE.collisionBudget === 10000, 'a flag moves its number for the run, never the table');
  ok(typeof tuneOf({ lods: '10,x' }) === 'string' && typeof tuneOf({ 'tex-max': '-1' }) === 'string', 'a flag of no shape is refused in words');
  const tight = importModel(src, RECORD, t as typeof IMPORT_TUNE);
  ok(tight.notes.some((n: string) => /past the budget of 5/.test(n) && /-colonly/.test(n)), 'past the collision budget the pass asks for a -colonly stand-in, as a note');
}

{
  // The folder: made again, its old files swept; taken out, nothing left of it.
  ok(importModel(src, { ...RECORD, lods: [40] }, IMPORT_TUNE).hash8 === made.hash8, 'what is in the manifest alone (where its levels take over) leaves the GLB and its name as they were');
  const again = importModel(src, { ...RECORD, doubleSided: true }, IMPORT_TUNE);
  ok(again.hash8 !== made.hash8, 'a change in the GLB changes its name');
  const w = writeImport(folder, again);
  const files = readdirSync(folder).filter((f) => f.startsWith('test_block.'));
  const icons = readdirSync(join(folder, 'icons')).filter((f) => f.startsWith('test_block.'));
  ok(w.swept === 2 && files.length === 1 && files[0] === again.def.file && icons.length === 1, `made again under the same id, its old GLB and picture are swept (${w.swept} swept, ${files.join(', ')})`);
  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
  const idx = JSON.parse(readFileSync(join(folder, 'imports.json'), 'utf8'));
  ok(manifest.planet === 'imported' && manifest.categories.layout.length === 1 && manifest.categories.layout[0].file === again.def.file && idx.entries.length === 1 && idx.entries[0].id === 'test_block', 'one entry in the manifest and the library\'s index, the new one');
  ok(dropImport(folder, 'test_block') && !readdirSync(folder).some((f) => f.endsWith('.glb')) && JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8')).categories.layout.length === 0, 'taken out, its files and entries are gone');
  ok(!dropImport(folder, 'test_block'), 'and taking it out again says there was none');
}

{
  // The folder's size in its index (every file in it but the index itself), which `__debug.imports()` reads, and the shipped
  // folder's note past the size a run of --ship was told, kept from that run and said again whenever the folder is written.
  const sizeOf = (dir: string, top = true): number => readdirSync(dir, { withFileTypes: true }).reduce((n, e) => (top && e.name === 'imports.json') || e.name.startsWith('.') ? n : n + (e.isDirectory() ? sizeOf(join(dir, e.name), false) : readFileSync(join(dir, e.name)).length), 0);
  const shipped = join(tmp, 'shipped-folder');
  const w = writeImport(shipped, made, Date.now(), { shipNote: 0.001 });
  const idx = JSON.parse(readFileSync(join(shipped, 'imports.json'), 'utf8'));
  ok(idx.bytes === sizeOf(shipped) && w.bytes === idx.bytes && idx.shipNote === 0.001 && idx.notes.length === 1 && /rides in every release/.test(idx.notes[0]) && w.notes.join() === idx.notes.join(), `the shipped folder's index says what it comes to (${idx.bytes} bytes) and that it is past its note ("${idx.notes[0]}")`);
  dropImport(shipped, 'test_block');
  const after = JSON.parse(readFileSync(join(shipped, 'imports.json'), 'utf8'));
  ok(after.shipNote === 0.001 && after.bytes === sizeOf(shipped) && after.bytes < 1048 && after.notes.length === 0, `emptied, it keeps its note's size and says nothing past it (${after.bytes} bytes)`);
  const priv = join(tmp, 'private-folder');
  writeImport(priv, made);
  const p = JSON.parse(readFileSync(join(priv, 'imports.json'), 'utf8'));
  ok(p.bytes === sizeOf(priv) && p.shipNote === undefined && p.notes.length === 0, 'and a private folder says its size and nothing of shipping');
}

// ---------------------------------------------------------------- 5. the model's looks under a row's

{
  const model = [{ of: 'test_block:Stone', map: 'naboo:rock/shader/rock.sht' }, { of: 'test_block:Metal', tint: '#808080' }];
  ok(withModelLooks(undefined, undefined) === undefined && withModelLooks([{ of: '*', tint: '#ffffff' }], null)?.length === 1, "a row of a model with no looks reads exactly its own (every converted model's)");
  const plain = withModelLooks(undefined, model)!;
  ok(plain.length === 2 && plain[0].map === 'naboo:rock/shader/rock.sht', 'a row with none wears its model\'s borrowed looks');
  const own = withModelLooks([{ of: 'test_block:Stone', tint: '#ff0000' }], model)!;
  const stone = own.find((l) => l.of === 'test_block:Stone')!;
  ok(own.length === 2 && stone.tint === '#ff0000' && stone.map === 'naboo:rock/shader/rock.sht', "a row's tint alone for a material is laid on the model's borrowed picture for it, as a tint for every material is");
  // The editor's Tint on one material of such a row writes exactly that entry (`lookWith`), and the picture is kept under it.
  const tinted = withModelLooks(lookWith(undefined, 'test_block:Stone', { tint: '#C04020' }), model)!;
  ok(JSON.stringify(tinted.find((l) => l.of === 'test_block:Stone')) === '{"of":"test_block:Stone","tint":"#c04020","map":"naboo:rock/shader/rock.sht"}', `the editor's Tint on one material of a model that borrows its picture keeps the picture (${JSON.stringify(tinted.find((l) => l.of === 'test_block:Stone'))})`);
  const metal = withModelLooks([{ of: 'test_block:Metal', tint: '#ff0000' }], model)!;
  ok(metal.find((l) => l.of === 'test_block:Metal')!.tint === '#ff0000' && metal.length === 2, "a row's tint over the model's own tint for a material is the row's");
  const ownMap = withModelLooks([{ of: 'test_block:Stone', map: 'tatooine:wall/plaster' }], model)!;
  ok(ownMap.find((l) => l.of === 'test_block:Stone')!.map === 'tatooine:wall/plaster' && !ownMap.find((l) => l.of === 'test_block:Stone')!.tint, "a row's own picture for a material is taken whole");
  const liked = withModelLooks([{ of: 'test_block:Stone', tint: '#ff0000' }], [{ of: 'test_block:Stone', like: 'naboo:rock/rock' }])!;
  ok(liked.length === 1 && liked[0].tint === '#ff0000' && !liked[0].like, "and a row's tint over a borrowed material, which takes no tint, is the row's own entry whole");
  const star = withModelLooks([{ of: '*', tint: '#00ff00' }], model)!;
  ok(star.find((l) => l.of === 'test_block:Stone')!.tint === '#00ff00' && star.find((l) => l.of === 'test_block:Stone')!.map === 'naboo:rock/shader/rock.sht' && star.find((l) => l.of === 'test_block:Metal')!.tint === '#808080', "a row's tint for every material lays its tint on a borrowed picture, never over the model's own tint");
  const wholly = withModelLooks([{ of: '*', like: 'tatooine:wall/plaster' }], model)!;
  ok(wholly.length === 1 && wholly[0].of === '*', "a row's own material for every material leaves the model's out");
}

rmSync(tmp, { recursive: true, force: true });
console.log(`\nimports: ${checks} checks passed`);
