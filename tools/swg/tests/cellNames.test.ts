// Map-maker II's groundwork (DESIGN.md §3, W0, research6 §8.1): a portal cell's index and name read from the original node
// name GLTFLoader keeps (`userData.name`) before the sanitised `name`, which strips the colons and so reads
// `cell:17:4way_intersect1` as cell 174. The original is on the node only: a cell of several primitives (several materials) is
// a Group whose child meshes carry only the sanitised mesh name, so both read sites take the nearest object carrying one.
//
//   1. A GLB built in node through the converter's own writer (`glb.mjs`), a cell `cell:17:4way_intersect1` of two
//      primitives and `cell:2:hall` of one, loaded through three's own GLTFLoader: every mesh of both read by both sites
//      (`meshCellOf`, the pack's; `cellIndexOf` and `cellNameOf`, the rooms') to 17 and `4way_intersect1`, 2 and `hall`;
//      where e6c2578's rule (the pack's own regex, and its `cells.ts` loaded out of git) reads 174 for both shapes.
//   2. Every cell node of every GLB on disk (SWG3JS_PACKS, else assets-private), read from its JSON chunk and stood up as
//      GLTFLoader stands it, then read through the game's own `cells.ts` (every read site, a child mesh of a group cell
//      included): every one reads as the index and name it was written under, the reader reads the index e6c2578's did (its
//      own `cells.ts` out of git) for every cell whose own name does not begin with a digit, and the ones it changes are named.
//
// Run: node tools/swg/tests/cellNames.test.ts
import assert from 'node:assert/strict';
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildGlb } from '../glb.mjs';
import { cellIndexOf, cellNameOf, meshCellOf, ownCellIndex } from '../../../src/vehicles/cells.ts';
import { loadOld } from './oldModules.ts';
import { PACKS } from './materialsHarness.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

const tri = () => ({
  count: 3,
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
  colors: null,
  uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
  uvs2: null,
  indices: new Uint16Array([0, 1, 2]),
});
const glb = buildGlb(
  [
    { name: 'cell:17:4way_intersect1', groups: [{ shader: 'shader/a.sht', primitives: [tri()] }, { shader: 'shader/b.sht', primitives: [tri()] }] },
    { name: 'cell:2:hall', groups: [{ shader: 'shader/a.sht', primitives: [tri()] }] },
  ],
  { flipX: true },
);
const buf = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
const scene = await new Promise<THREE.Group>((resolve, reject) => new GLTFLoader().parse(buf, '', (g) => resolve(g.scene), reject));
const meshes: THREE.Mesh[] = [];
scene.traverse((o) => {
  if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
});
const of = (m: THREE.Mesh) => (/hall/.test(m.name) || /hall/.test(m.parent?.name ?? '') ? 'hall' : 'way');
ok(meshes.length === 3 && meshes.filter((m) => of(m) === 'way').length === 2 && meshes.some((m) => of(m) === 'way' && m.parent !== scene && !m.userData.name), 'the two-primitive cell loads as a group of two meshes carrying no original name of their own');
for (const m of meshes) {
  const want = of(m) === 'way' ? { i: 17, n: '4way_intersect1' } : { i: 2, n: 'hall' };
  ok(meshCellOf(m) === want.i && cellIndexOf(m) === want.i && cellNameOf(m) === want.n, `${m.name}: the pack's and the rooms' reads give cell ${want.i} "${want.n}"`);
}
const cellNode = scene.children.find((c) => c.userData.name === 'cell:17:4way_intersect1')!;
ok(ownCellIndex(cellNode) === 17 && meshes.filter((m) => of(m) === 'way').every((m) => ownCellIndex(m) === -1), "the cell's own node is cell 17 and its child meshes are no cell's own node");

// e6c2578's rule reads both shapes of the digit-leading cell as 174: the pack's regex as it stood, and its cells.ts.
const oldPack = (o: THREE.Object3D) => {
  const m = /^cell[:_]?(\d+)/.exec(o.name) ?? /^cell[:_]?(\d+)/.exec(o.parent?.name ?? '');
  return m ? Number(m[1]) : -1;
};
ok(meshes.filter((m) => of(m) === 'way').every((m) => oldPack(m) === 174), "e6c2578's pack rule read the two-primitive cell's meshes as cell 174");
const oldCells = await loadOld<{ cellIndexOf(o: THREE.Object3D): number; cellNameOf(o: THREE.Object3D): string }>(['src/vehicles/cells.ts'], 'src/vehicles/cells.ts');
if (oldCells) ok(meshes.filter((m) => of(m) === 'way').every((m) => oldCells.cellIndexOf(m) === 174 && oldCells.cellNameOf(m).startsWith('way_intersect1')), "and its rooms' rule cell 174, named \"way_intersect1\" (and the loader's own suffix)");
else note('git cannot hand e6c2578 over here: the old rooms rule is not loaded');

// Every pack on disk: the cells today's rule and the new one read differently, by their own names.
{
  /** A GLB's JSON chunk, read from the head of the file alone. */
  const jsonOf = (file: string): { nodes?: { name?: string }[] } | null => {
    const fd = openSync(file, 'r');
    try {
      const head = Buffer.alloc(20);
      if (readSync(fd, head, 0, 20, 0) < 20 || head.readUInt32LE(0) !== 0x46546c67) return null;
      const len = head.readUInt32LE(12);
      const body = Buffer.alloc(len);
      readSync(fd, body, 0, len, 20);
      const text = body.toString('utf8');
      return text.includes('"cell:') ? JSON.parse(text) : null;
    } finally {
      closeSync(fd);
    }
  };
  const glbs: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (e.endsWith('.glb')) glbs.push(p);
    }
  };
  if (existsSync(PACKS)) walk(PACKS);
  const sanitize = (n: string) => THREE.PropertyBinding.sanitizeNodeName(n);
  let cells = 0;
  const changed = new Map<string, string[]>();
  let digitOnly = true;
  // Read through the game's own reader (`cells.ts`), never a copy of its rule: each cell node stood up as GLTFLoader stands it
  // (the original in `userData.name`, the stripped name as `name`), with a child mesh of a cell of several primitives under it
  // (the stripped mesh name, no original), and every read site asked; e6c2578's own `cells.ts` (out of git) and its pack
  // regex asked of the stripped names alone, as they read them.
  let wrong = '';
  for (const f of glbs) {
    const j = jsonOf(f);
    if (!j?.nodes) continue;
    for (const n of j.nodes) {
      const name = n.name ?? '';
      const m = /^cell:(\d+):(.*)$/.exec(name);
      if (!m) continue;
      cells++;
      const node = new THREE.Group();
      node.name = sanitize(name);
      node.userData.name = name;
      const child = new THREE.Mesh();
      child.name = `${node.name}_1`;
      node.add(child);
      const now = meshCellOf(child);
      if (!wrong && !(now === Number(m[1]) && ownCellIndex(node) === now && cellIndexOf(child) === now && ownCellIndex(child) === -1 && cellNameOf(child) === m[2])) wrong = `${name} in ${f.slice(PACKS.length + 1)}`;
      // As e6c2578 read it: the stripped names alone (its rooms' cells.ts where git hands it over, its pack regex otherwise).
      const bare = new THREE.Group();
      bare.name = node.name;
      const bareChild = new THREE.Mesh();
      bareChild.name = child.name;
      bare.add(bareChild);
      const before = /^cell[:_]?(\d+)/.exec(bareChild.name) ?? /^cell[:_]?(\d+)/.exec(bare.name);
      const was = oldCells ? oldCells.cellIndexOf(bareChild) : before ? Number(before[1]) : -1;
      if (now === was) continue;
      if (!/^\d/.test(m[2])) digitOnly = false;
      const k = `${m[1]}:${m[2]}`;
      const list = changed.get(k) ?? [];
      list.push(f.slice(PACKS.length + 1));
      changed.set(k, list);
    }
  }
  if (!cells) note(`no portal cells in any GLB under ${PACKS}: the packs' check is skipped`);
  else {
    ok(!wrong, `every cell node of every pack reads through the game's own reader (the pack's and the rooms' read sites) as the index and name it was written under${wrong ? `; not ${wrong}` : ''}`);
    ok(digitOnly, `over ${cells} cell nodes in ${glbs.length} GLBs, the new rule changes the index of no cell whose own name does not begin with a digit`);
    const names = [...changed.keys()];
    ok(names.every((k) => ['22:16a', '17:4way_intersect1', '18:4way_intersect2'].includes(k)), `the cells it changes are the three named (${names.map((k) => `${k} in ${changed.get(k)!.length} model${changed.get(k)!.length === 1 ? '' : 's'}`).join('; ') || 'none on this install'})`);
  }
}

console.log(`\ncellNames: ${checks} checks passed`);
