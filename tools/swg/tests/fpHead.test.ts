// First person's head (src/player/headHide.ts): the shadow-only layer against the portal
// renderer's cameras, which bones and triangles are the head, the index partition a hooded robe
// is drawn through, the rule that decides whole, split or nothing per worn item, the draw hooks,
// the single-model hider, and the rule over the converted packs when they are on this machine.
// Plain node over the pure module; portalRender.ts and world.ts are not importable here, but the
// one layer test both make (markActor's skip, passesOf's actor) is the registry's isShadowOnly,
// which case 1 calls. The cull Character.cull runs on a split mesh is headHide's cullIndex (case 4b).
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { readGlb } from '../glbclips.mjs';
import { FX_LAYERS, isShadowOnly } from '../../../src/core/fxRegistry.ts';
import { HEAD_WEAR_TEMPLATE, HEAD_ZONES, HeadHider, HeadSplitView, SHADOW_ONLY_MASK, countSet, cullIndex, headBoneFlags, headRule, headTriangleFlags, partitionHead, splitsMesh, type HeadFacts } from '../../../src/player/headHide.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// --- 1: the layer ----------------------------------------------------------------------------
{
  ok(SHADOW_ONLY_MASK === 1 << FX_LAYERS.shadowOnly, 'the shadow-only mask is the registry layer\'s bit');
  ok(FX_LAYERS.shadowOnly !== FX_LAYERS.heat, 'the shadow-only layer is not the heat\'s');
  const head = new THREE.Layers();
  head.mask = SHADOW_ONLY_MASK;
  const probe = new THREE.Layers();
  probe.enableAll();
  ok(head.test(probe), 'the shadow probe (every layer) sees a shadow-only mesh, so the shadow maps draw it');
  const doll = new THREE.Layers();
  doll.enableAll();
  ok(head.test(doll), 'the wardrobe doll\'s camera (enableAll) sees it, so the doll shows the whole character');
  const worldPass = new THREE.Layers();
  worldPass.set(0);
  worldPass.enable(31);
  const roomPass = new THREE.Layers();
  roomPass.set(1);
  roomPass.enable(31);
  const heat = new THREE.Layers();
  heat.set(FX_LAYERS.heat);
  ok(!head.test(worldPass), 'the world pass (0 + 31) does not see it');
  ok(!head.test(roomPass), 'the room pass (1 + 31) does not see it');
  ok(!head.test(heat), 'the heat pass does not see it');
  // markActor skips a mesh whose mask is shadow-only (isShadowOnly); passesOf counts it an actor (the same call).
  ok(isShadowOnly(head.mask), 'isShadowOnly (markActor\'s skip, passesOf\'s actor) holds for a shadow-only mask');
  ok(isShadowOnly(SHADOW_ONLY_MASK) && head.isEnabled(FX_LAYERS.shadowOnly), 'headHide\'s mask is the one isShadowOnly tests');
  const fresh = new THREE.Layers();
  const marked = new THREE.Layers();
  marked.mask = 1 | (1 << 31);
  const heatMesh = new THREE.Layers();
  heatMesh.set(FX_LAYERS.heat);
  ok(!isShadowOnly(fresh.mask) && !isShadowOnly(marked.mask) && !isShadowOnly(heatMesh.mask) && !isShadowOnly(0), 'a fresh mask (1), a marked one (1 | 1 << 31), a heat mesh and no layer at all are not shadow-only');
  // markActor's body, as written in portalRender.ts, on each.
  const mark = (l: THREE.Layers) => {
    if (!isShadowOnly(l.mask)) l.enable(31);
  };
  mark(head);
  mark(fresh);
  ok(head.mask === SHADOW_ONLY_MASK, 'marking a hidden head leaves it on the shadow layer alone, out of every view pass');
  ok(fresh.isEnabled(31) && fresh.isEnabled(0), 'marking a fresh mesh puts it on the actor layer');
}

// --- 2: head bones ---------------------------------------------------------------------------
function skeletonTree() {
  const root = new THREE.Bone(); root.name = 'root';
  const spine3 = new THREE.Bone(); spine3.name = 'spine3';
  const neck = new THREE.Bone(); neck.name = 'neck';
  const head = new THREE.Bone(); head.name = 'Head';
  const jaw = new THREE.Bone(); jaw.name = 'jaw';
  const lEye = new THREE.Bone(); lEye.name = 'lEye';
  const lClav = new THREE.Bone(); lClav.name = 'lClav';
  root.add(spine3);
  spine3.add(neck, lClav);
  neck.add(head);
  head.add(jaw, lEye);
  return { root, spine3, neck, head, jaw, lEye, lClav, bones: [root, spine3, neck, head, jaw, lEye, lClav] };
}
{
  const t = skeletonTree();
  const flags = headBoneFlags(t.bones, t.head);
  ok([...flags].join('') === '0001110', 'the head bones are exactly Head, jaw and lEye');
  ok(countSet(headBoneFlags(t.bones, null)) === 0, 'with no head bone nothing is the head');
}

// --- 3: head triangles -----------------------------------------------------------------------
{
  // Joint 1 is the head, joint 0 is not.
  const inHead = Uint8Array.from([0, 1]);
  const idx4 = (rows: number[][]) => new THREE.BufferAttribute(Uint16Array.from(rows.flat()), 4);
  const w4 = (rows: number[][]) => new THREE.BufferAttribute(Float32Array.from(rows.flat()), 4);
  const oneHead = headTriangleFlags([0, 1, 2], 1, idx4([[1, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), w4([[0.6, 0.4, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0]]), inHead);
  ok(oneHead[0] === 1, 'one vertex 0.6 on the head and two at 0 marks the triangle');
  const weak = headTriangleFlags([0, 1, 2], 1, idx4([[1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0]]), w4([[0.4, 0.6, 0, 0], [0.4, 0.6, 0, 0], [0.4, 0.6, 0, 0]]), inHead);
  ok(weak[0] === 0, 'three vertices at 0.4 on the head do not');
  const norm = new THREE.BufferAttribute(Uint8Array.from([128, 127, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0]), 4, true);
  const normalized = headTriangleFlags([0, 1, 2], 1, idx4([[1, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), norm, inHead);
  ok(normalized[0] === 1, 'a normalized Uint8 weight of 128/255 reads as 0.502 and counts');
  const loose = headTriangleFlags(null, 2, idx4([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [1, 0, 0, 0], [0, 0, 0, 0]]), w4([[1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0]]), inHead);
  ok(loose[0] === 0 && loose[1] === 1, 'a geometry with no index reads consecutive triples');
}

// --- 4: partition ----------------------------------------------------------------------------
{
  const index = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const p = partitionHead(index, Uint8Array.from([1, 0, 1, 0]), [5, 6, 7, 8]);
  ok([...p.index].join(',') === '3,4,5,9,10,11,0,1,2,6,7,8', 'the index runs triangles 1, 3, 0, 2: the body in order, then the head in order');
  ok(p.zones!.join(',') === '6,8,5,7', 'the zones move with their triangles');
  ok(p.headFrom === 2, 'the head starts at triangle 2');
  ok([...p.index].sort((a, b) => a - b).join(',') === index.join(','), 'every triangle is there once');
  const none = partitionHead(index, new Uint8Array(4), null);
  ok([...none.index].join(',') === index.join(',') && none.headFrom === 4 && none.zones === null, 'with no head the index is unchanged and the head starts at the triangle count');
}

// --- 4b: a split mesh culled (Character.cull's bookkeeping) ------------------------------------
{
  const index = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  // Head triangles 0 and 2 in zone combination 0, body triangles 1 and 3 in combination 1.
  const p = partitionHead(index, Uint8Array.from([1, 0, 1, 0]), [0, 1, 0, 1]);
  const bodyGone = cullIndex(p.index, p.zones!, [false, true], p.headFrom);
  ok([...bodyGone.index].join(',') === '0,1,2,6,7,8' && bodyGone.body === 0, 'the body\'s combination covered: the head\'s triangles 0 and 2 are kept, still last, and nothing lies ahead of them');
  const headGone = cullIndex(p.index, p.zones!, [true, false], p.headFrom);
  ok([...headGone.index].join(',') === '3,4,5,9,10,11' && headGone.body === 2, 'the head\'s combination covered: the body\'s triangles 1 and 3 are kept and both are body');
  const nothing = cullIndex(p.index, p.zones!, [false, false], p.headFrom);
  ok([...nothing.index].join(',') === [...p.index].join(',') && nothing.body === p.headFrom, 'nothing covered: the partitioned index as it was, the body the whole head start');

  // Mixed: five triangles, the head 0 and 2; combination 0 (triangles 0 and 3) covered.
  const five = Array.from({ length: 15 }, (_, i) => i);
  const q = partitionHead(five, Uint8Array.from([1, 0, 1, 0, 0]), [0, 1, 1, 0, 2]);
  ok(q.headFrom === 3 && q.zones!.join(',') === '1,0,2,0,1', 'five triangles partition to 1, 3, 4 | 0, 2 with their zones');
  const c = cullIndex(q.index, q.zones!, [true, false, false], q.headFrom);
  ok([...c.index].join(',') === '3,4,5,12,13,14,6,7,8' && c.body === 2, 'combination 0 covered drops triangles 3 and 0: 1 and 4 kept as body, the head\'s 2 kept last');
  // The eye's draw after that cull, through the hooks, as Character.cull leaves them.
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(15 * 3), 3));
  g.setIndex(new THREE.BufferAttribute(c.index, 1));
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  const view = new HeadSplitView(mesh, { hidden: true });
  view.count = c.body * 3;
  (mesh.onBeforeRender as (...a: unknown[]) => void)(null, null, null, g, mesh.material, null);
  const drawn = [...c.index.slice(0, g.drawRange.count)].join(',');
  (mesh.onAfterRender as (...a: unknown[]) => void)(null, null, null, g, mesh.material, null);
  ok(drawn === '3,4,5,12,13,14', 'in first person the eye draws exactly the kept body triangles, 1 and 4, and no head');

  ok(splitsMesh('split', 3, 0), 'a split item\'s mesh with head triangles and no groups is split');
  ok(!splitsMesh('split', 0, 0), 'a split item\'s mesh with no head triangles of its own is not');
  ok(!splitsMesh('split', 3, 2), 'a mesh with groups is never split (three intersects each group with the draw range)');
  ok(!splitsMesh('whole', 3, 0) && !splitsMesh('none', 3, 0), 'a whole or untouched item\'s mesh is not split');
}

// --- 5: the rule -----------------------------------------------------------------------------
{
  const rule = (f: Partial<HeadFacts>) => {
    const r = headRule({ body: false, defs: [], triangles: 100, headTriangles: 0, ...f });
    return `${r.rule}/${r.why}`;
  };
  ok(rule({ kind: 'hair', headTriangles: 100 }) === 'whole/hair', 'hair: whole, by being hair');
  ok(rule({ template: 'object/tangible/wearables/hat/shared_hat_loveday_halo_01.iff', headTriangles: 0 }) === 'whole/template', 'the halo (a hat template, no zones, nothing skinned to the head): whole, by its template');
  ok(rule({ body: true, defs: [{ zoneCombinations: [['skull'], ['face'], ['neck'], ['skull', 'face']] }], headTriangles: 95 }) === 'whole/zones', 'a species head (every combination in head zones): whole, by its zones');
  ok(rule({ body: true, defs: [{ occludes: ['skull'], zoneCombinations: [['chest'], ['torso_f', 'torso_b'], ['l_arm']] }], headTriangles: 0 }) === 'none/skin', 'the Mon Calamari body (hides only skull, nothing on the head): none');
  ok(rule({ body: true, defs: [{ zoneCombinations: [['chest'], ['waist_b']] }], triangles: 1892, headTriangles: 6 }) === 'split/skin', 'the Ithorian body (6 of 1892 on the head): split');
  ok(rule({ defs: [{ occludes: ['chest', 'skull'], zoneCombinations: [['chest'], ['skull', 'chest']] }], headTriangles: 54 }) === 'split/garment', 'a Kashyyykian chest plate (hides chest and skull, 54 % on the head): split, never whole');
  ok(rule({ defs: [{ zoneCombinations: [['skull', 'chest', 'torso_b'], ['waist_b']] }], headTriangles: 15 }) === 'split/skin', 'the hood-up robe (hides nothing, 15 % on the head): split, by its skin');
  ok(rule({ defs: [{ occludes: ['skull', 'face'], zoneCombinations: [['skull']] }], headTriangles: 0 }) === 'whole/zones', 'the Mandalorian Imperial helmet (combinations [["skull"]], skinned to spine3): whole, by its zones');
  ok(rule({ defs: [{ occludes: ['skull', 'face', 'sideburn_l', 'sideburn_r'] }], headTriangles: 0 }) === 'whole/covers', 'a helmet that hides only head zones and has no combinations: whole, by what it covers');
  ok(rule({ headTriangles: 74 }) === 'whole/skin', 'a helmet with no zones (74 % on the head): whole, by its skin');
  ok(rule({ defs: [{ occludes: ['chest'], zoneCombinations: [['chest']] }], headTriangles: 0 }) === 'none/garment', 'a shirt (hides chest, nothing on the head): none');
}

// --- 6: the draw hooks -----------------------------------------------------------------------
{
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 3), 3));
  g.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  const state = { hidden: false };
  const view = new HeadSplitView(mesh, state);
  view.count = 6;
  const call = (hook: 'onBeforeRender' | 'onAfterRender') =>
    (mesh[hook] as (...a: unknown[]) => void)(null, null, null, g, mesh.material, null);
  call('onBeforeRender');
  ok(g.drawRange.count === Infinity, 'out of first person the eye draws the whole mesh');
  state.hidden = true;
  call('onBeforeRender');
  ok(g.drawRange.count === 6, 'in first person the eye draws the indices ahead of the head');
  call('onAfterRender');
  ok(g.drawRange.count === Infinity, 'after the draw the range is whole again, for the shadow pass and every clone');
  ok(mesh.clone().onBeforeRender === THREE.Object3D.prototype.onBeforeRender, 'a clone (the wardrobe doll) does not carry the hooks, so it draws the whole mesh');
}

// --- 7: the single model ---------------------------------------------------------------------
{
  const t = skeletonTree();
  const skeleton = new THREE.Skeleton(t.bones);
  const headJoint = t.bones.indexOf(t.head);
  const spineJoint = t.bones.indexOf(t.spine3);
  /** A skinned mesh of `tris` triangles, the listed ones weighted wholly to the head. */
  const skinned = (name: string, tris: number, onHead: number[]) => {
    const g = new THREE.BufferGeometry();
    const n = tris * 3;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let v = 0; v < n; v++) {
      si[v * 4] = onHead.includes(Math.floor(v / 3)) ? headJoint : spineJoint;
      sw[v * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.setIndex(Array.from({ length: n }, (_, i) => i));
    const m = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial());
    m.name = name;
    m.bind(skeleton);
    return m;
  };
  const root = new THREE.Group();
  root.add(t.root);
  const helmet = skinned('helmet', 2, [0, 1]);
  const robe = skinned('robe', 4, [1]);
  // The robe's skin with two material groups: it cannot be split, so the single model takes it whole.
  const cloak = skinned('cloak', 4, [1]);
  cloak.geometry.addGroup(0, 6, 0);
  cloak.geometry.addGroup(6, 6, 0);
  const cloakIndex = [...cloak.geometry.getIndex()!.array].join(',');
  const goggles = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  goggles.name = 'goggles';
  t.head.add(goggles);
  root.add(helmet, robe, cloak);
  // As attachRig leaves them: marked actors.
  root.traverse((o) => o.layers.enable(31));
  const before = new Map<THREE.Object3D, number>();
  root.traverse((o) => before.set(o, o.layers.mask));
  const h = HeadHider.forModel(root, t.head);
  const rows = new Map(h.rows.map((r) => [r.name, r]));
  ok(rows.get('helmet')?.rule === 'whole' && rows.get('robe')?.rule === 'split' && rows.get('goggles')?.rule === 'whole', 'rows: the helmet whole, the robe split, the plain mesh under the head bone whole');
  ok([...robe.geometry.getIndex()!.array].join(',') === '0,1,2,6,7,8,9,10,11,3,4,5', 'the split mesh\'s index has its body triangles first, the head last');
  const cloakRow = rows.get('cloak');
  ok(cloakRow?.rule === 'whole' && cloakRow.why === 'skin' && cloakRow.headTriangles === 1 && [...cloak.geometry.getIndex()!.array].join(',') === cloakIndex, 'a mesh with groups that would be split goes whole, its index untouched');
  h.set(true);
  ok(helmet.layers.mask === SHADOW_ONLY_MASK && goggles.layers.mask === SHADOW_ONLY_MASK && cloak.layers.mask === SHADOW_ONLY_MASK, 'hidden: the whole ones are on the shadow layer alone');
  ok(cloak.onBeforeRender === THREE.Object3D.prototype.onBeforeRender, 'the unsplit mesh with groups carries no draw hooks');
  ok(robe.layers.mask === before.get(robe), 'hidden: the split one keeps its layers');
  (robe.onBeforeRender as (...a: unknown[]) => void)(null, null, null, robe.geometry, robe.material, null);
  ok(robe.geometry.drawRange.count === 9, 'hidden: the split one\'s eye draws its three body triangles');
  (robe.onAfterRender as (...a: unknown[]) => void)(null, null, null, robe.geometry, robe.material, null);
  ok(h.rows.every((r) => r.hiddenNow), 'hidden: every row says so');
  h.set(false);
  ok(helmet.layers.mask === before.get(helmet) && goggles.layers.mask === before.get(goggles) && cloak.layers.mask === before.get(cloak), 'shown: the saved masks come back exactly');
  (robe.onBeforeRender as (...a: unknown[]) => void)(null, null, null, robe.geometry, robe.material, null);
  ok(robe.geometry.drawRange.count === Infinity, 'shown: the split one draws whole');
  const bare = new THREE.Group();
  const t2 = skeletonTree();
  bare.add(t2.root);
  const sk2 = new THREE.Skeleton(t2.bones);
  const a = skinned('a', 2, []);
  const b = skinned('b', 2, [0]);
  a.bind(sk2);
  b.bind(sk2);
  bare.add(a, b);
  const none = HeadHider.forModel(bare, null);
  ok(none.rows.length === 2 && none.rows.every((r) => r.rule === 'whole' && r.why === 'no head bone'), 'with no head bone every skinned mesh goes whole');
}

// --- 8: the converted packs ------------------------------------------------------------------
const packs = new URL('../../../assets-private/', import.meta.url);
if (!existsSync(new URL('wardrobe/human_male/wardrobe.json', packs))) {
  console.log('skip the converted-pack checks: assets-private/wardrobe/human_male/wardrobe.json is not on this machine');
} else {
  type Glb = { json: any; bin: Buffer };
  const COMP: Record<number, { new (buf: ArrayBufferLike, off: number, len: number): ArrayLike<number> & { BYTES_PER_ELEMENT: number }; BYTES_PER_ELEMENT: number }> = {
    5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
  } as never;
  const NUM: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  /** One accessor as a BufferAttribute: its own component type, the view's stride, and `normalized`. */
  const accessor = (g: Glb, i: number): THREE.BufferAttribute => {
    const a = g.json.accessors[i];
    const bv = g.json.bufferViews[a.bufferView];
    const T = COMP[a.componentType];
    const n = NUM[a.type];
    const bytes = T.BYTES_PER_ELEMENT;
    const stride = bv.byteStride ? bv.byteStride / bytes : n;
    const base = g.bin.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    // A copy, so the typed array is aligned whatever the offset.
    const raw = g.bin.buffer.slice(base, base + ((a.count - 1) * stride + n) * bytes);
    const all = new T(raw, 0, (a.count - 1) * stride + n);
    const Ctor = T as unknown as { new (len: number): Float32Array };
    const out = new Ctor(a.count * n) as unknown as number[];
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = all[k * stride + c];
    return new THREE.BufferAttribute(out as unknown as Float32Array, n, !!a.normalized);
  };
  /** Triangles and head triangles of one GLB, each skinned mesh node against its own skin. */
  const cache = new Map<string, { triangles: number; headTriangles: number }>();
  const measure = (file: string) => {
    let r = cache.get(file);
    if (r) return r;
    const g = readGlb(readFileSync(file)) as Glb;
    const nodes = g.json.nodes as { name?: string; mesh?: number; skin?: number; children?: number[] }[];
    // Every node as an object with its parents, so a joint's chain up to the head is there.
    const objs = nodes.map((nd) => {
      const b = new THREE.Bone();
      b.name = nd.name ?? '';
      return b;
    });
    nodes.forEach((nd, i) => (nd.children ?? []).forEach((c) => objs[i].add(objs[c])));
    r = { triangles: 0, headTriangles: 0 };
    for (const nd of nodes) {
      if (nd.mesh === undefined || nd.skin === undefined) continue;
      const joints = (g.json.skins[nd.skin].joints as number[]).map((j) => objs[j]);
      const head = joints.find((b) => /^head$/i.test(b.name)) ?? null;
      const inHead = headBoneFlags(joints, head);
      for (const prim of g.json.meshes[nd.mesh].primitives) {
        if (prim.attributes.JOINTS_0 === undefined || prim.attributes.WEIGHTS_0 === undefined) continue;
        const si = accessor(g, prim.attributes.JOINTS_0);
        const sw = accessor(g, prim.attributes.WEIGHTS_0);
        const index = prim.indices !== undefined ? accessor(g, prim.indices).array as ArrayLike<number> : null;
        const tris = Math.floor((index ? index.length : si.count) / 3);
        const flags = headTriangleFlags(index, tris, si, sw, inHead);
        r.triangles += tris;
        r.headTriangles += countSet(flags);
      }
    }
    cache.set(file, r);
    return r;
  };
  type Item = { id: string; kind?: string; template?: string; parts: { file: string; occludes?: string[]; zoneCombinations?: string[][]; body?: boolean }[] };
  const judge = (dir: URL, item: Item, body: boolean) => {
    let triangles = 0;
    let headTriangles = 0;
    let missing = 0;
    for (const p of item.parts) {
      const f = new URL(p.file, dir);
      if (!existsSync(f)) {
        missing++;
        continue;
      }
      const m = measure(fileURLToPath(f));
      triangles += m.triangles;
      headTriangles += m.headTriangles;
    }
    return { ...headRule({ kind: item.kind, template: item.template, body, defs: item.parts, triangles, headTriangles }), triangles, headTriangles, missing };
  };

  const t0 = performance.now();
  let judged = 0;
  const wardrobeDirs = readdirSync(new URL('wardrobe/', packs)).filter((d) => existsSync(new URL(`wardrobe/${d}/wardrobe.json`, packs)));
  const tally: Record<string, number> = {};
  const byId = new Map<string, ReturnType<typeof judge>>();
  const templateMisses: string[] = [];
  const garmentWhole: string[] = [];
  for (const w of wardrobeDirs) {
    const dir = new URL(`wardrobe/${w}/`, packs);
    const cat = JSON.parse(readFileSync(new URL('wardrobe.json', dir), 'utf8')) as { items: Item[] };
    for (const item of cat.items) {
      if (!item.parts?.length) continue;
      const r = judge(dir, item, false);
      judged++;
      tally[`${r.rule}:${r.why}`] = (tally[`${r.rule}:${r.why}`] ?? 0) + 1;
      if (w === 'human_male') byId.set(item.id, r);
      if ((item.kind === 'hair' || HEAD_WEAR_TEMPLATE.test(item.template ?? '')) && r.rule !== 'whole') templateMisses.push(`${w}/${item.id}`);
      if (item.parts.some((p) => (p.occludes ?? []).some((z) => !HEAD_ZONES.has(z))) && r.rule === 'whole') garmentWhole.push(`${w}/${item.id} ${r.why}`);
    }
  }
  const rule = (id: string) => {
    const r = byId.get(id);
    assert.ok(r, `${id} is in the human male wardrobe`);
    return r!;
  };
  for (const id of ['hat_s02', 'hat_twilek_s03', 'hat_loveday_halo_01', 'armor_stormtrooper_helmet', 'helmet_atat', 'goggles_s01', 'goggles_s06']) {
    const r = rule(id);
    ok(r.rule === 'whole', `${id} is hidden whole (${r.why}, ${r.headTriangles}/${r.triangles} on the head)`);
  }
  {
    const r = rule('armor_mandalorian_imperial_helmet');
    ok(r.rule === 'whole' && r.why === 'zones', `armor_mandalorian_imperial_helmet is hidden whole by its zones (${r.headTriangles}/${r.triangles} on the head by skin)`);
    const ris = rule('armor_ris_helmet');
    ok(ris.rule === 'whole' && ris.why === 'covers', `armor_ris_helmet is hidden whole by what it covers (${ris.headTriangles}/${ris.triangles})`);
  }
  for (const id of ['robe_s05_h1', 'exar_cultist_hood_up']) {
    const r = rule(id);
    const share = r.headTriangles / r.triangles;
    ok(r.rule === 'split' && share > 0.05 && share < 0.3, `${id} is split: ${r.headTriangles}/${r.triangles} = ${share.toFixed(2)} on the head, the rest kept`);
  }
  {
    const r = rule('armor_kashyyykian_hunting_chestplate');
    ok(r.rule === 'split', `armor_kashyyykian_hunting_chestplate is split (${r.why}, ${r.headTriangles}/${r.triangles})`);
    const shirt = rule('shirt_s03');
    ok(shirt.rule === 'none', `shirt_s03 loses nothing (${shirt.why}, ${shirt.headTriangles}/${shirt.triangles})`);
  }
  ok(templateMisses.length === 0, `every hair and hair/, hat/, helmet/, goggles/ template item in ${wardrobeDirs.length} wardrobes is whole${templateMisses.length ? `; not: ${templateMisses.slice(0, 8).join(', ')}` : ''}`);
  ok(garmentWhole.length === 0, `no item that hides a zone outside the head is whole${garmentWhole.length ? `; whole: ${garmentWhole.slice(0, 8).join(', ')}` : ''}`);

  const species = readdirSync(new URL('characters/', packs)).filter((d) => existsSync(new URL(`characters/${d}/parts.json`, packs)));
  const wrong: string[] = [];
  let heads = 0;
  for (const s of species) {
    const dir = new URL(`characters/${s}/`, packs);
    const manifest = JSON.parse(readFileSync(new URL('parts.json', dir), 'utf8')) as { parts: (Item['parts'][number] & { name: string })[] };
    for (const def of manifest.parts) {
      const r = judge(dir, { id: def.name, parts: [def] }, !!def.body);
      judged++;
      const isHead = /_head_l0$/.test(def.name);
      if (isHead) heads++;
      if (isHead !== (r.rule === 'whole')) wrong.push(`${s}/${def.name} ${r.rule}:${r.why}`);
    }
  }
  ok(heads === species.length && wrong.length === 0, `in ${species.length} species packs each *_head_l0 part is whole and no other part is${wrong.length ? `; wrong: ${wrong.join(', ')}` : ''}`);
  const ms = performance.now() - t0;
  console.log(`     ${judged} items and parts judged in ${ms.toFixed(0)} ms (${(ms / Math.max(1, judged)).toFixed(2)} ms each): ${JSON.stringify(tally)}`);
}

console.log(`\n${checks} checks passed`);
