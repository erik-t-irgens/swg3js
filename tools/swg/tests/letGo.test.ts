// What the world takes down for good is let go by three's WebGPU renderer too (pass 2, wave 5, agent P: the lag).
//
// Three's WebGPU renderer keeps every render object in a strong set and lets one go only when its object, its material or its
// lights node dispatches `dispose`, so a mesh taken out of the scene for good while its material lives on (a terrain chunk's
// ground on the session's tile material, every caster on the shadow pass's own material) was held for the session with its
// whole group (`src/world/letGo.ts` says how it was found). This suite:
//   1. pins three's own text the fix rests on (the build the game runs): the set, the three listeners, `Object3D.dispose`;
//   2. runs `letGoDrawn`: one `dispose` on every object under a root on WebGPU, none on WebGL;
//   3. runs three's own `RenderObjects` and `RenderObject` (read out of the build, their cache keys stood in) over a chunk drawn
//      in the world pass and a shadow pass, then the world's own `disposeChunk` (read out of world.ts) against the base's
//      (a3e46ff, read out of git): the base's leaves the ground mesh's render objects in three's set, the tree's leaves none,
//      and a stand-in drawn beside it keeps its own;
//   4. holds every other take-down this wave mended as text: each far tile taken out of the ground's root, the old plantings
//      a replant takes down and a grass chunk's mesh are let go.
// node tools/swg/tests/letGo.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as THREE from 'three';
import { ChainMap } from 'three/tsl';
import { GPU } from '../../../src/core/gpuSwitch.ts';
import { keeperLike, letGoDrawn, LET_GO_STATS } from '../../../src/world/letGo.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const BASE = 'a3e46ff';

// ---- 1. Three's own text the fix rests on (the build the game runs). ----

const WEBGPU = read('node_modules/three/build/three.webgpu.js');
const CORE = read('node_modules/three/build/three.core.js');
/** A top-level class of a build, its `class X {` line to the `}` closing it at the first column. */
function classOf(src: string, name: string): string {
  const at = src.indexOf(`\nclass ${name} {\n`);
  assert.ok(at >= 0, `three's build has class ${name}`);
  const end = src.indexOf('\n}\n', at + 1);
  return src.slice(at + 1, end + 2);
}
const RO = classOf(WEBGPU, 'RenderObject');
const ROS = classOf(WEBGPU, 'RenderObjects');
ok(/this\._renderObjects = new Set\(\);/.test(ROS) && /this\._renderObjects\.add\( renderObject \);/.test(ROS) && /this\._renderObjects\.delete\( renderObject \);/.test(ROS), "three's RenderObjects keeps every render object in a strong Set, struck off only by the render object's own onDispose");
ok(/this\.object\.addEventListener\( 'dispose', this\.onObjectDispose \);/.test(RO) && /this\.material\.addEventListener\( 'dispose', this\.onMaterialDispose \);/.test(RO) && /this\.lightsNode\.addEventListener\( 'dispose', this\.onLightsNodeDispose \);/.test(RO), "three's RenderObject is disposed by its object's, its material's or its lights node's `dispose` alone");
ok(/this\.onGeometryDispose = \(\) => \{\s*this\._geometries\.deleteNodeAttributes\( this \);\s*this\._geometries\.deleteVertexState\( this \);/.test(RO) && !/this\.onGeometryDispose = \(\) => \{[^}]*this\.dispose\(\)/.test(RO), "a geometry's `dispose` lets its render object's attributes go, never the render object (so disposing a chunk's ground geometry held it)");
ok(/class Object3D extends EventDispatcher \{[\s\S]*?\n\tdispose\(\) \{\s*this\.dispatchEvent\( \{ type: 'dispose' \} \);\s*\}/.test(CORE), "three's Object3D.dispose dispatches `dispose` and frees nothing (what letGoDrawn dispatches on its own)");

// ---- 2. letGoDrawn: every object under a root on WebGPU, nothing on WebGL. ----

const tree = (): { root: THREE.Group; all: THREE.Object3D[] } => {
  const root = new THREE.Group();
  const a = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  const g = new THREE.Group();
  const b = new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), 2);
  g.add(b);
  root.add(a, g);
  return { root, all: [root, a, g, b] };
};
const count = (all: THREE.Object3D[]) => {
  const n = new Map<THREE.Object3D, number>();
  for (const o of all) o.addEventListener('dispose', () => n.set(o, (n.get(o) ?? 0) + 1));
  return n;
};
{
  GPU.webgpu = false;
  const t = tree();
  const n = count(t.all);
  ok(letGoDrawn(t.root) === 0 && n.size === 0, 'on WebGL letGoDrawn dispatches nothing (the old lines stand as they were)');
  GPU.webgpu = true;
  const was = LET_GO_STATS.objects;
  const k = letGoDrawn(t.root);
  ok(k === 4 && t.all.every((o) => n.get(o) === 1) && LET_GO_STATS.objects - was === 4, 'on WebGPU letGoDrawn dispatches one `dispose` on every object under the root, the root too');
  ok(letGoDrawn(null) === 0 && letGoDrawn(undefined) === 0, 'nothing to let go answers nought');
  ok(t.all.every((o) => !!o.parent || o === t.root) && (t.all[1] as THREE.Mesh).geometry.attributes !== undefined, 'letting go frees nothing of the object (its place in its group, its geometry and material stand)');
}

// ---- 3. Three's own render objects over a chunk, the world's own disposeChunk, the base's and the tree's. ----

const idName = /this\.id = (\S+) \+\+;/.exec(RO)?.[1] ?? '_id';
const keysDecl = /\n(const (\S+) = \[ null, null, null, null \];\nconst (\S+) = \[ null, null, null, null, null \];)\n/.exec(WEBGPU);
assert.ok(keysDecl, "three's chain keys for RenderObjects");
const three = new Function('ChainMap', `let ${idName} = 0;\n${keysDecl![1]}\n${RO}\n${ROS}\nreturn { RenderObject, RenderObjects };`)(ChainMap) as {
  RenderObject: { prototype: Record<string, unknown> };
  RenderObjects: new (...a: unknown[]) => { get(...a: unknown[]): unknown; _renderObjects: Set<{ object: THREE.Object3D }> };
};
// Its cache keys stood in (they read the node system, which a node test has none of); everything about its life is three's.
three.RenderObject.prototype.getDynamicCacheKey = () => '';
three.RenderObject.prototype.getCacheKey = () => '';
three.RenderObject.prototype.getGeometryCacheKey = () => '';
ok(typeof three.RenderObjects === 'function', "three's own RenderObjects and RenderObject are read out of the build and run");

interface StandInChunk { key: string; cx: number; cz: number; group: THREE.Group; physics: null }
function method(src: string[], name: string): string {
  const at = src.findIndex((l) => new RegExp(`^  (?:private |static |async |readonly )*${name}\\(`).test(l));
  assert.ok(at >= 0, `found ${name}`);
  for (let i = at + 1; i < src.length; i++) if (src[i] === '  }') return src.slice(at, i + 1).join('\n');
  throw new Error(`${name} has no end`);
}
function worldLines(text: string): { prototype: Record<string, (...a: unknown[]) => unknown> } {
  const src = text.split('\n');
  const body = `class WorldLines {\n${method(src, 'disposeChunk')}\n}\n`;
  const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function('THREE', 'letGoDrawn', `${js}\nreturn WorldLines;`)(THREE, letGoDrawn) as { prototype: Record<string, (...a: unknown[]) => unknown> };
}
const TREE_WORLD = read('src/world/world.ts');
const BASE_WORLD = execFileSync('git', ['show', `${BASE}:src/world/world.ts`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }).replace(/\r\n/g, '\n');

/** A chunk drawn by three's own render objects in the world pass and a shadow pass, the stand-in drawn beside it, its world's lines run. */
function run(text: string, webgpu = true): { before: number; drawn: number; after: number; chunkLeft: number; standInLeft: number; tileListeners: number } {
  GPU.webgpu = webgpu;
  const renderer = { _currentSourceMaterial: null as THREE.Material | null };
  const stub = { delete() {}, deleteVertexState() {}, deleteNodeAttributes() {}, deleteForRender() {} };
  const objects = new three.RenderObjects(renderer, stub, stub, stub, stub, {});
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const lightsNode = new THREE.EventDispatcher();
  const context = {};
  // The session's materials: the ground's tile material and the shadow pass's own, which outlive every chunk.
  const tileMaterial = new THREE.MeshStandardMaterial();
  const shadowMaterial = new THREE.MeshBasicMaterial();
  const plantMaterial = new THREE.MeshStandardMaterial();
  const chunkRoot = new THREE.Group();
  scene.add(chunkRoot);
  const group = new THREE.Group();
  const ground = new THREE.Mesh(new THREE.BufferGeometry(), tileMaterial);
  const props = new THREE.Group();
  const trees = new THREE.InstancedMesh(new THREE.BufferGeometry(), plantMaterial, 3);
  props.add(trees);
  group.add(ground, props);
  chunkRoot.add(group);
  const standIn = new THREE.InstancedMesh(new THREE.BufferGeometry(), plantMaterial, 1);
  const before = objects._renderObjects.size;
  const draw = (o: THREE.Mesh) => {
    objects.get(o, o.material, scene, camera, lightsNode, context, null, 'world');
    renderer._currentSourceMaterial = o.material as THREE.Material;
    objects.get(o, shadowMaterial, scene, camera, lightsNode, context, null, 'shadow');
    renderer._currentSourceMaterial = null;
  };
  for (const o of [ground, trees, standIn]) draw(o);
  const drawn = objects._renderObjects.size;
  const W = worldLines(text);
  const world = {
    floraField: { remove() {} },
    terrain: { forgetChunkFamilies() {} },
    grass: { chunkGone() {} },
    chunkRoot,
    removeChunkPhysics() {},
  };
  const chunk: StandInChunk = { key: '0,0', cx: 0, cz: 0, group, physics: null };
  W.prototype.disposeChunk.call(world, chunk);
  const left = [...objects._renderObjects];
  const inChunk = (o: THREE.Object3D) => { let a: THREE.Object3D | null = o; while (a) { if (a === group) return true; a = a.parent; } return false; };
  const tileListeners = ((tileMaterial as unknown as { _listeners?: Record<string, unknown[]> })._listeners?.dispose ?? []).length;
  return { before, drawn, after: left.length, chunkLeft: left.filter((r) => inChunk(r.object)).length, standInLeft: left.filter((r) => r.object === standIn).length, tileListeners };
}
const base = run(BASE_WORLD);
ok(base.drawn - base.before === 6, `three made two render objects a drawable (the world pass and the shadow pass): ${base.drawn - base.before} for three`);
ok(base.chunkLeft === 2 && base.tileListeners === 2, `the base's disposeChunk (${BASE}) leaves the ground mesh's two render objects in three's set, each listening on the session's tile material (the shadow pass's as its source): the whole chunk held (${base.chunkLeft} left, ${base.tileListeners} listeners)`);
const after = run(TREE_WORLD);
ok(after.chunkLeft === 0 && after.tileListeners === 0, `the tree's disposeChunk lets every render object of the chunk go (${after.chunkLeft} left, ${after.tileListeners} listeners on the tile material)`);
ok(after.standInLeft === 2 && base.standInLeft === 2, 'a stand-in drawn beside the chunk keeps its own render objects (its pipelines) both ways');
{
  // On WebGL the tree's lines dispatch nothing, as the base's did (three's WebGL renderer keeps no such set).
  const r = run(TREE_WORLD, false);
  ok(r.chunkLeft === base.chunkLeft && r.tileListeners === base.tileListeners, "with the switch at WebGL the tree's disposeChunk dispatches nothing, as the base's");
  GPU.webgpu = false;
}

// ---- 4. The other take-downs, as text. ----

const W = TREE_WORLD.split('\n');
const removals = W.map((l, i) => (/^\s+this\.chunkRoot\.remove\(t\);$/.test(l) ? i : -1)).filter((i) => i >= 0);
ok(removals.length >= 5 && removals.every((i) => W.slice(i + 1, i + 5).some((l) => /^\s+letGoDrawn\(t\);$/.test(l))), `every far tile taken out of the ground's root is let go (${removals.length} sites)`);
const replant = method(W, 'replantChunk');
ok(/old\.traverse[\s\S]*?\n\s+letGoDrawn\(old\);/.test(replant) && /c\.extra\.traverse[\s\S]*?\n\s+letGoDrawn\(c\.extra\);/.test(replant), "a replant lets the old plantings and a real-elevation world's old props go");
const GRASS = read('src/world/grass.ts').split('\n');
const drop = method(GRASS, 'drop');
ok(/c\.mesh\.geometry\.dispose\(\);\s*\n(?:\s*\/\/.*\n)*\s*letGoDrawn\(c\.mesh\);/.test(drop), "a grass chunk's mesh is let go as it is dropped");
ok(/letGoDrawn\(c\.group\);/.test(method(W, 'disposeChunk')), 'disposeChunk lets the chunk go after taking it down');
const MOBILE = read('src/world/mobiles/mobile.ts').split('\n');
const mobileDispose = method(MOBILE, 'dispose');
const VEHICLE = read('src/vehicles/vehicle.ts').split('\n');
ok(/scene\.remove\(this\.group\);[\s\S]*?\n\s+letGoDrawn\(this\.group\);\n  \}/.test(method(VEHICLE, 'dispose')), "a vehicle disposed lets its hull go (its pieces wear the garage's own materials, which outlive it)");
// ---- 5. The ground's keepers (the fixer of pass 2, wave 5): a teleport drops every chunk at once and builds nothing. ----
//
// Three releases a pipeline when the last render object drawn with it goes (`Pipelines.delete` at `usedTimes` 0), so once
// chunks were let go a teleport that dropped them all released the ground's pipeline and the chunks made where it landed built
// it again by a draw (the checker's finding: one a move). Here three's own render objects run over a stand-in of its pipeline
// count (a key a material, pass and vertex layout; used on each render object's first get, given back as it goes), with the
// world's own `keepGround`, `groundKeepersNow` and `disposeChunk` read out of world.ts and the real `keeperLike`.
{
  const src = TREE_WORLD.split('\n');
  const body = `class WorldLines {\n${method(src, 'disposeChunk')}\n${method(src, 'keepGround')}\n${method(src, 'groundKeepersNow')}\n}\n`;
  const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const KW = new Function('THREE', 'letGoDrawn', 'keeperLike', 'GPU', `${js}\nreturn WorldLines;`)(THREE, letGoDrawn, keeperLike, GPU) as { prototype: Record<string, (...a: unknown[]) => unknown> };
  /** What three's vertex layout key reads of a geometry, stood in: each attribute's name, array kind, width and normalisation. */
  const layoutOf = (g: THREE.BufferGeometry) => Object.entries(g.attributes).map(([n, a]) => `${n}:${(a as THREE.BufferAttribute).array.constructor.name}:${a.itemSize}:${(a as THREE.BufferAttribute).normalized}`).join('|') + `|index:${g.index?.array.constructor.name ?? 'none'}`;
  /** A chunk's ground geometry laid out as the terrain lays one (`Terrain.buildChunk`): 48 vertices. */
  const chunkGeometry = () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(48 * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(48 * 3), 3));
    g.setAttribute('aGroundLayers', new THREE.BufferAttribute(new Uint8Array(48 * 4), 4));
    g.setAttribute('aGroundBlend', new THREE.BufferAttribute(new Uint8Array(48 * 4), 4));
    g.setAttribute('aGroundTint', new THREE.BufferAttribute(new Uint8Array(48 * 3), 3, true));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(48), 1));
    return g;
  };
  const cycle = (keep: boolean, webgpu = true) => {
    GPU.webgpu = webgpu;
    const pipes = new Map<string, { used: number }>();
    const held = new Map<object, string>();
    let built = 0;
    let released = 0;
    const pipelines = {
      delete(ro: object) {
        const key = held.get(ro);
        if (key === undefined) return;
        held.delete(ro);
        const p = pipes.get(key)!;
        if (--p.used === 0) {
          pipes.delete(key);
          released++;
        }
      },
    };
    const stub = { delete() {}, deleteVertexState() {}, deleteNodeAttributes() {}, deleteForRender() {} };
    const renderer = { _currentSourceMaterial: null as THREE.Material | null };
    const objects = new three.RenderObjects(renderer, stub, stub, pipelines, stub, {});
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const lightsNode = new THREE.EventDispatcher();
    const frame = {};
    const sweep = {};
    const tileMaterial = new THREE.MeshStandardMaterial();
    const shadowMaterial = new THREE.MeshBasicMaterial();
    const getUse = (o: THREE.Mesh, m: THREE.Material, pass: string, context: object) => {
      const ro = objects.get(o, m, scene, camera, lightsNode, context, null, pass) as object;
      if (held.has(ro)) return;
      const key = `${m.uuid}/${pass}/${layoutOf(o.geometry)}`;
      let p = pipes.get(key);
      if (!p) {
        p = { used: 0 };
        pipes.set(key, p);
        built++;
      }
      p.used++;
      held.set(ro, key);
    };
    const draw = (o: THREE.Mesh, context: object) => {
      getUse(o, o.material as THREE.Material, 'world', context);
      renderer._currentSourceMaterial = o.material as THREE.Material;
      if (o.castShadow) getUse(o, shadowMaterial, 'shadow', context);
      renderer._currentSourceMaterial = null;
    };
    const chunkRoot = new THREE.Group();
    scene.add(chunkRoot);
    const world = {
      floraField: { remove() {} },
      terrain: { forgetChunkFamilies() {} },
      grass: { chunkGone() {} },
      chunkRoot,
      removeChunkPhysics() {},
      groundKeepers: new Map<THREE.Material, THREE.Mesh>(),
      chunkMaterial: tileMaterial as THREE.Material | null,
      groundTilesMat: tileMaterial,
      groundAirMat: null,
    };
    const make = (cx: number) => {
      const group = new THREE.Group();
      const ground = new THREE.Mesh(chunkGeometry(), tileMaterial);
      ground.castShadow = true;
      ground.receiveShadow = true;
      if (keep) W5.keepGround.call(world, ground);
      group.add(ground);
      chunkRoot.add(group);
      return { key: `${cx},0`, cx, cz: 0, group, physics: null, ground };
    };
    const W5 = KW.prototype;
    // The arrival: chunks made, the screen's sweep compiles what the scene holds and the keepers (and draws them into the shadow maps).
    const first = [make(0), make(1)];
    for (const c of first) draw(c.ground, sweep);
    const keepers = keep ? (W5.groundKeepersNow.call(world) as THREE.Mesh[]) : [];
    for (const k of keepers) draw(k, sweep);
    const atScreen = built;
    // Play: the chunks drawn by frames.
    for (const c of first) draw(c.ground, frame);
    const inPlayBefore = built - atScreen;
    // A teleport: every chunk dropped at once, then the chunks where it lands made and drawn.
    for (const c of first) W5.disposeChunk.call(world, c);
    const releasedAtDrop = released;
    const landed = [make(5), make(6)];
    for (const c of landed) draw(c.ground, frame);
    return { built, atScreen, inPlayBefore, inPlay: built - atScreen, releasedAtDrop, keepers, world, first, objects, tileMaterial };
  };
  const bare = cycle(false);
  ok(bare.inPlayBefore === 0 && bare.inPlay === 2 && bare.releasedAtDrop === 2, `without a keeper a teleport releases the ground's two pipelines (world and shadow) as the last chunk goes, and the chunks where it lands build both by a draw (${bare.inPlay} built in play): the checker's finding`);
  const kept = cycle(true);
  const k = kept.keepers[0];
  ok(kept.keepers.length === 1 && k.material === kept.tileMaterial && k.parent === null && k.castShadow && k.receiveShadow && k.frustumCulled === false, `one keeper for the session's tile material, never in a scene, casting and receiving as a chunk does (${kept.keepers.length})`);
  ok(layoutOf(k.geometry) === layoutOf(kept.first[0].ground.geometry) && k.geometry.attributes.position.count === 3, `the keeper is laid out as a chunk is (${layoutOf(k.geometry)}), three vertices`);
  ok(kept.inPlay === 0 && kept.releasedAtDrop === 0, `with the keeper a teleport releases nothing and the chunks where it lands build nothing in play (${kept.inPlay} built, ${kept.releasedAtDrop} released)`);
  {
    // A keeper whose material no chunk can wear any more is let go at the next screen, its render objects with it.
    const w = kept.world;
    const other = new THREE.MeshStandardMaterial();
    w.chunkMaterial = other;
    w.groundTilesMat = other;
    const before = kept.objects._renderObjects.size;
    const left = KW.prototype.groundKeepersNow.call(w) as THREE.Mesh[];
    ok(left.length === 0 && w.groundKeepers.size === 0 && kept.objects._renderObjects.size === before - 2, `a keeper of a material no chunk wears is let go at the next screen (${before - kept.objects._renderObjects.size} render objects with it)`);
  }
  const gl = cycle(true, false);
  ok(gl.keepers.length === 0 && gl.world.groundKeepers.size === 0, 'on WebGL no keeper is made (three keeps no render objects there)');
  GPU.webgpu = false;
  ok(/mesh\.castShadow = this\.groundShadows === 'on';\n\s+this\.keepGround\(mesh\);/.test(TREE_WORLD), 'every chunk made offers its ground to the keepers (`createChunk`)');
  ok(/const keepers = this\.groundKeepersNow\(\);\n\s+for \(const k of keepers\) objects\.push\(k\);/.test(method(src, 'compileEverything')), "the screen's sweep compiles the keepers with the world's other stand-ins");
  ok(/for \(const k of this\.groundKeepers\.values\(\)\) if \(k\.castShadow\) keepers\.push\(k\);\n\s+const drawn: THREE\.Object3D\[\] = \[\.\.\.standIns, \.\.\.plain, \.\.\.skinned, batched, \.\.\.keepers\];/.test(method(src, 'compileShadowDepth')), 'the shadow warm draws the casting keepers into the shadow maps');
  ok(/this\.chunkMaterial = want;\n\s+for \(const c of this\.chunks\.values\(\)\) \{\n\s+this\.keepGround\(c\.ground\);/.test(method(src, 'syncGroundMaterial')), 'a ground swap offers the material now worn to the keepers');
}

ok(/this\.holder\?\.parent\?\.remove\(this\.holder\);\s*\n(?:\s*\/\/.*\n)*\s*letGoDrawn\(this\.holder\);/.test(mobileDispose) && /this\.inner\.remove\(this\.model\);\s*\n\s*letGoDrawn\(this\.model\);/.test(mobileDispose), "a body taken down lets its model and its weapon's copy go (their materials are its cached look's and the rack's, which outlive it)");

console.log(`\n${checks} checks passed`);
