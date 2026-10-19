// What every skinned mesh is made into as it loads (src/core/skinnedLoad.ts), checked without a browser: a skinned glTF
// written here (joints as unsigned shorts, and as bytes) loaded through three's own GLTFLoader with the plugin comes
// out with Float32 joint indices of the very same values, its morph targets padded to their rung with every name kept;
// a geometry a frame has drawn already is left as it is and counted; every `new GLTFLoader(` under src/ goes through
// `surfaces.withPlugin` or registers `skinnedPlugin` (the rig's animation-only loader excepted); and the joint
// re-pointing a worn piece takes and the effects' skinned stand-ins write floats.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { floatJoints, floatSkinIndex, noteUploaded, SKINNED_LOAD, SKINNED_STATS, skinnedPlugin, wasUploaded } from '../../../src/core/skinnedLoad.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** A GLB of one skinned triangle on two joints, its joints as `joints` (5121 bytes or 5123 shorts), with `morphs` targets. */
function skinnedGlb(jointType: 5121 | 5123, morphs: number): ArrayBuffer {
  const parts: Uint8Array[] = [];
  let offset = 0;
  const views: { buffer: number; byteOffset: number; byteLength: number }[] = [];
  const add = (bytes: Uint8Array): number => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      parts.push(new Uint8Array(pad));
      offset += pad;
    }
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength });
    parts.push(bytes);
    offset += bytes.byteLength;
    return views.length - 1;
  };
  const f32 = (a: number[]): Uint8Array => new Uint8Array(new Float32Array(a).buffer);
  const position = add(f32([0, 0, 0, 1, 0, 0, 0, 1, 0]));
  const normal = add(f32([0, 0, 1, 0, 0, 1, 0, 0, 1]));
  // Joints 0 and 1 in an order that is not the identity, so a value lost on the way would show.
  const jointValues = [1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0];
  const joints = add(jointType === 5121 ? new Uint8Array(jointValues) : new Uint8Array(new Uint16Array(jointValues).buffer));
  const weights = add(f32([1, 0, 0, 0, 0.5, 0.5, 0, 0, 1, 0, 0, 0]));
  const targets: { POSITION: number; NORMAL: number }[] = [];
  const accessors: Record<string, unknown>[] = [
    { bufferView: position, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
    { bufferView: normal, componentType: 5126, count: 3, type: 'VEC3' },
    { bufferView: joints, componentType: jointType, count: 3, type: 'VEC4' },
    { bufferView: weights, componentType: 5126, count: 3, type: 'VEC4' },
  ];
  for (let m = 0; m < morphs; m++) {
    const pv = add(f32([0.1 * (m + 1), 0, 0, 0, 0, 0, 0, 0, 0]));
    const nv = add(f32([0, 0, 0, 0, 0, 0, 0, 0, 0]));
    accessors.push({ bufferView: pv, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [0.1 * (m + 1), 0, 0] });
    accessors.push({ bufferView: nv, componentType: 5126, count: 3, type: 'VEC3' });
    targets.push({ POSITION: accessors.length - 2, NORMAL: accessors.length - 1 });
  }
  const bin = new Uint8Array(offset + ((4 - (offset % 4)) % 4));
  let at = 0;
  for (const p of parts) {
    bin.set(p, at);
    at += p.byteLength;
  }
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [{ mesh: 0, skin: 0, name: 'body' }, { name: 'root', children: [2] }, { name: 'spine', translation: [0, 1, 0] }],
    meshes: [{ name: 'body', primitives: [{ attributes: { POSITION: 0, NORMAL: 1, JOINTS_0: 2, WEIGHTS_0: 3 }, ...(morphs ? { targets } : {}) }], ...(morphs ? { extras: { targetNames: Array.from({ length: morphs }, (_, i) => `slider_${i}`) } } : {}) }],
    skins: [{ joints: [1, 2] }],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: views,
    accessors,
  };
  let text = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (text.byteLength % 4)) % 4;
  if (jpad) {
    const t = new Uint8Array(text.byteLength + jpad);
    t.set(text);
    t.fill(0x20, text.byteLength);
    text = t;
  }
  const total = 12 + 8 + text.byteLength + 8 + bin.byteLength;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, text.byteLength, true);
  dv.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(out, 20, text.byteLength).set(text);
  const binAt = 20 + text.byteLength;
  dv.setUint32(binAt, bin.byteLength, true);
  dv.setUint32(binAt + 4, 0x004e4942, true);
  new Uint8Array(out, binAt + 8, bin.byteLength).set(bin);
  return out;
}

function load(buffer: ArrayBuffer, plugin: boolean): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  if (plugin) loader.register(skinnedPlugin);
  return new Promise((resolve, reject) => loader.parse(buffer, '', (g) => resolve(g.scene), reject));
}

function skinnedIn(root: THREE.Object3D): THREE.SkinnedMesh {
  let s: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) s = o as THREE.SkinnedMesh;
  });
  assert.ok(s, 'the loaded model has a skinned mesh');
  return s!;
}

const valuesOf = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): number[] => {
  const out: number[] = [];
  for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out.push(a.getComponent(i, c));
  return out;
};

// ---- 1. Through three's own loader, with the plugin. ----
ok(SKINNED_LOAD.floatJoints && SKINNED_LOAD.morphLadder, 'both hatches are on where nothing says otherwise (node has no storage)');
for (const type of [5123, 5121] as const) {
  const plain = skinnedIn(await load(skinnedGlb(type, 3), false));
  const widened = skinnedIn(await load(skinnedGlb(type, 3), true));
  const before = plain.geometry.getAttribute('skinIndex');
  const after = widened.geometry.getAttribute('skinIndex') as THREE.BufferAttribute;
  const word = type === 5123 ? 'unsigned shorts' : 'bytes';
  ok(!(before.array instanceof Float32Array), `without the plugin the loader keeps the file's ${word}`);
  ok(after.array instanceof Float32Array && after.itemSize === 4, `with it the joints of a file written as ${word} come out as Float32`);
  ok(valuesOf(after).join(',') === valuesOf(before).join(','), `of the very same values (${valuesOf(after).join(',')})`);
  ok(widened.geometry.morphAttributes.position.length === 7 && widened.geometry.morphAttributes.normal.length === 7, 'and its three morph targets padded to the rung of seven, normals too');
  ok(widened.morphTargetInfluences!.length === 7 && widened.morphTargetInfluences!.slice(3).every((v) => v === 0), 'its influences extended to match, the new ones at nought');
  ok(Object.entries(widened.morphTargetDictionary!).every(([k, v]) => k === `slider_${v}`) && Object.keys(widened.morphTargetDictionary!).length === 3, 'and every target keeps its own name at its own index, none added');
}
ok(SKINNED_STATS.joints >= 2 && SKINNED_STATS.padded >= 2 && SKINNED_STATS.byRung[7] >= 2, 'the plugin counts what it did (joints widened, geometries padded and to which rung)');

// ---- 2. A geometry a frame has drawn already is left as it is, and counted. ----
{
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  const joints = new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4);
  g.setAttribute('skinIndex', joints);
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const s = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial());
  noteUploaded(joints);
  const was = SKINNED_STATS.metDrawn;
  const n = floatJoints(s);
  ok(n === 0 && g.getAttribute('skinIndex') === joints, 'a geometry whose joints a frame has uploaded is left with its own attribute (replacing it would orphan the buffer)');
  ok(SKINNED_STATS.metDrawn === was + 1, 'and counted (reached here through `noteUploaded`: in the game the plugin widens every model before a frame can draw it, so the count is nought by construction and no check)');
  // One the plugin widened is marked, so three's own upload of it marks it drawn: what the marker says is read here,
  // before and after the upload three would make, so a widened attribute that lost its marker fails.
  const fresh = new THREE.BufferGeometry();
  fresh.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  fresh.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4));
  fresh.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const fs = new THREE.SkinnedMesh(fresh, new THREE.MeshBasicMaterial());
  floatJoints(fs);
  const widened = fresh.getAttribute('skinIndex') as THREE.BufferAttribute;
  ok(widened.array instanceof Float32Array && !wasUploaded(widened), 'a widened attribute is not marked drawn before any frame has uploaded it');
  (widened as unknown as { onUploadCallback(): void }).onUploadCallback.call(widened);
  ok(wasUploaded(widened), "and three's own upload of it (its `onUploadCallback`) marks it drawn");
  ok(floatJoints(fs) === 0 && fresh.getAttribute('skinIndex') === widened, 'a geometry widened once is left alone after (already floats)');
  const made = floatSkinIndex([1, 0, 0, 0], 4);
  ok(!wasUploaded(made), 'and a joint attribute made as floats (a worn piece re-pointed by name) is unmarked until drawn');
  (made as unknown as { onUploadCallback(): void }).onUploadCallback.call(made);
  ok(wasUploaded(made), 'then marked as three uploads it');
}

// ---- 3. Every GLTF loader under src/ that can meet a skinned mesh goes through the plugin. ----
{
  const srcDir = fileURLToPath(new URL('../../../src/', import.meta.url));
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) files.push(p);
    }
  };
  walk(srcDir);
  const bare: string[] = [];
  let loaders = 0;
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    let at = text.indexOf('new GLTFLoader(');
    while (at >= 0) {
      // A comment that names the call is no loader.
      const lineStart = text.lastIndexOf('\n', at) + 1;
      const line = text.slice(lineStart, at);
      if (!/^\s*(\/\/|\*)/.test(line) && !line.includes('`')) {
        loaders++;
        const before = text.slice(Math.max(0, at - 80), at);
        const after = text.slice(at, at + 160);
        const ok = /withPlugin\(\s*$/.test(before) || /^new GLTFLoader\(\)\s*\.register\(skinnedPlugin\)/.test(after);
        if (!ok && !f.replace(/\\/g, '/').endsWith('player/rig.ts')) bare.push(`${f.slice(srcDir.length)}:${text.slice(0, at).split('\n').length}`);
      }
      at = text.indexOf('new GLTFLoader(', at + 1);
    }
  }
  ok(loaders >= 10, `the loaders under src/ were found (${loaders})`);
  ok(bare.length === 0, `every one goes through surfaces.withPlugin or registers skinnedPlugin, the rig's excepted (${bare.join(', ') || 'none bare'})`);
}

// ---- 4. The joint re-pointing and the effects' skinned stand-ins write floats. ----
{
  const read = (rel: string): string => readFileSync(fileURLToPath(new URL(`../../../src/${rel}`, import.meta.url)), 'utf8');
  const character = read('player/character.ts');
  const remap = character.slice(character.indexOf('function remapSkin'), character.indexOf('/** The blade\'s axis'));
  ok(remap.includes('floatSkinIndex(') && !remap.includes('Uint16Array'), "a worn piece's joints re-pointed by name come out as floats (`remapSkin`)");
  for (const rel of ['core/fx/geometry.ts', 'core/fx/velocity.ts', 'world/floraSway.ts']) {
    const lines = read(rel).split('\n').filter((l) => l.includes("'skinIndex'") && l.includes('setAttribute'));
    ok(lines.length > 0 && lines.every((l) => l.includes('Float32BufferAttribute')), `${rel}'s skinned stand-ins write their joints as floats`);
  }
}

console.log(`\n${checks} checks passed`);
