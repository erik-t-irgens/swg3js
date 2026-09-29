// The client's own detail levels in the converter (step 7 of the frame-time wave): which levels a pack carries
// and the ranges it writes (tools/swg/lodlevels.mjs), a chain resolved over stand-in archives (a level that is
// a copy of the one before it, a sprite the converter cannot read, a level the artists left empty), the GLB's
// second scene (tools/swg/glb.mjs); then every retail `.lod` where the owner's archives are on this machine,
// and every converted pack that says it carries levels: each carried level has its `lod:<n>` node, the ranges
// are contiguous, and every object inside a building names the building and the room the snapshot put it in.
//
// Run: node tools/swg/tests/lodConvert.test.ts
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOD_FORMAT, LOD_PLACE, LOD_SCENE, carriedLevels, chainContiguous, groupStats, groupsBox, levelInPlace, lodLevelOfName, lodMeshesFor, lodNodeName, lodRanges, risingLevels } from '../lodlevels.mjs';
import { buildGlb } from '../glb.mjs';
import { parseIff } from '../iff.mjs';
import { detailLevels, exteriorAppearance, lodLevels, resolveParts } from '../appearance.mjs';
import { parseMesh } from '../msh.mjs';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string): void => console.log(`note ${what}`);

// ---------------------------------------------------------------------------------------------
// Which levels, and the ranges.
{
  ok([1, 2, 3, 4, 5, 6].map((n) => carriedLevels(n).join('.')).join(' ') === '0 0.1 0.2 0.2.3 0.2.4 0.3.5', 'a pack carries the finest and the lowest, and the middle on a chain of four or more');
  const levels = [
    { near: 0, far: 60 },
    { near: 60, far: 140 },
    { near: 140, far: 250 },
    { near: 250, far: 1000 },
  ];
  const r = lodRanges(levels, [0, 2, 3], [{ tris: 900, prims: 3 }, { tris: 200, prims: 1 }, { tris: 60, prims: 1 }]);
  ok(r.length === 3 && r[0].near === 0 && r[0].far === 140 && r[1].near === 140 && r[1].far === 250 && r[2].near === 250 && r[2].far === 1000 && r[1].level === 2 && r[2].tris === 60, 'a dropped level is drawn by the finer carried one, never the coarser: each carried range runs to the next carried level');
  ok(chainContiguous(r.map((x) => ({ near: x.near, far: x.far }))) && chainContiguous(levels) && !chainContiguous([{ near: 0, far: 50 }, { near: 60, far: 100 }]), 'the carried ranges are contiguous by construction; a gap in a chain is told');
  ok(lodNodeName(4) === 'lod:4' && lodLevelOfName('lod:4') === 4 && lodLevelOfName('lod4') === -1 && lodLevelOfName('cell:0:r0') === -1 && LOD_SCENE === 'lods' && LOD_FORMAT >= 1, "a lower level's node is named `lod:<n>`, read back exactly (GLTFLoader keeps the colon in `userData.name`)");
}

// ---------------------------------------------------------------------------------------------
// A chain over stand-in archives.
const tri = (n: number) => ({ shader: `shader/s${n}.sht`, primitives: [{ positions: new Float32Array(9), normals: null, uvs: null, indices: Uint16Array.from([0, 1, 2]) }] });
{
  // Five levels: 1 is a copy of 0, 3 is a sprite the converter cannot read, 4 is empty.
  const parts: Record<number, { mesh: string; transform: null }[] | 'spr'> = {
    0: [{ mesh: 'a_l0.msh', transform: null }],
    1: [{ mesh: 'a_l0.msh', transform: null }],
    2: [{ mesh: 'a_l2.msh', transform: null }],
    3: 'spr',
    4: [],
  };
  const deps = {
    exteriorAppearance: (_: unknown, p: string) => p,
    detailLevels: () => [0, 30, 60, 90, 180].map((near, i, a) => ({ near, far: a[i + 1] ?? 1000 })),
    resolveParts: (_: unknown, __: string, ___: number, n: number) => {
      const p = parts[n];
      if (p === 'spr') throw new Error('Unsupported appearance type: x.spr');
      return p;
    },
    meshGroups: (part: { mesh: string }) => [tri(part.mesh === 'a_l0.msh' ? 0 : 2)],
  };
  const r = lodMeshesFor(null, 'a.lod', [tri(0), tri(0)], deps);
  ok(!!r && r.lods.map((l: { level: number }) => l.level).join(',') === '0,2,4', `a five-level chain carries 0, the middle (2) and the lowest (4) (${r?.lods.map((l: { level: number }) => l.level).join(',')})`);
  ok(!!r && r.lods[2].prims === 0 && r.meshes.length === 1 && r.meshes[0].name === 'lod:2' && r.lods[0].prims === 2, "a level the artists left empty is carried as a range drawing nothing, with no node; the finest's counts are the model's own");
  // Lowest a sprite: the level before it is the lowest.
  parts[4] = 'spr';
  const s = lodMeshesFor(null, 'a.lod', [tri(0)], deps);
  ok(!!s && s.lods[s.lods.length - 1].level === 2 && s.lods.length === 2, 'a chain whose lowest is a sprite (and whose level before that is one too) takes the last level that reads as its lowest');
  // Every lower level a copy of the finest: nothing carried.
  parts[2] = [{ mesh: 'a_l0.msh', transform: null }];
  parts[4] = [{ mesh: 'a_l0.msh', transform: null }];
  ok(lodMeshesFor(null, 'a.lod', [tri(0)], deps) === null, 'a chain whose lower levels are all the finest again carries none: a switch between two copies of one mesh is a draw for nothing');
  ok(groupStats([tri(0), tri(1)]).prims === 2 && groupStats([tri(0)]).tris === 1, "a level's counts are its primitives and triangles");
}

// Only what the game's pick can draw, and only a level standing where the finest does.
/** A shader group of one triangle whose box is the given corners. */
const boxTri = (shader: string, min: number[], max: number[]) => ({ shader, primitives: [{ positions: Float32Array.from([...min, ...max, min[0], max[1], min[2]]), normals: null, uvs: null, indices: Uint16Array.from([0, 1, 2]) }] });
{
  ok(risingLevels([2, 3], (n: number) => [0, 60, 450, 400][n]).join(',') === '3' && risingLevels([2, 3], (n: number) => [0, 60, 140, 250][n]).join(',') === '2,3' && risingLevels([1, 2], () => 0).length === 0 && risingLevels([2, 3], (n: number) => [0, 0, 250, 250][n]).join(',') === '3', 'a level whose switch does not rise past the finer one kept is never drawn by the pick and is not carried; the coarser of two that clash is kept, and a switch at the eye never is');
  const fine = { min: [-10, 0, 57.4], max: [10, 5, 67.4] };
  ok(levelInPlace(fine, { min: [-10, 0, 57.8], max: [10, 5, 67] }) && !levelInPlace(fine, { min: [-10, 0, 27.4], max: [10, 5, 37] }) && !levelInPlace({ min: [-1000, 0, -1900], max: [1000, 360, 60] }, { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] }) && levelInPlace({ min: [0, 0, 0], max: [0.2, 0.2, 0.2] }, { min: [0.6, 0, 0], max: [0.8, 0.2, 0.2] }), `a lower level stands where the finest does: within ${LOD_PLACE.shift} of its diagonal (or ${LOD_PLACE.minShift} m) and at least ${LOD_PLACE.minSize} of its size; a temple level authored 30 m along, and a capital ship's one-metre cube, are not`);
  ok(JSON.stringify(groupsBox([boxTri('s', [1, 2, 3], [4, 5, 6])])) === JSON.stringify({ min: [1, 2, 3], max: [4, 5, 6] }) && groupsBox([]) === null, "a level's box is its positions'");
  // A chain whose middle's switch is past its lowest's (a palace's 450 then 400): the middle is never drawn and is not carried.
  const chain = (nears: number[], at: Record<number, number>) => ({
    exteriorAppearance: (_: unknown, p: string) => p,
    detailLevels: () => nears.map((near, i) => ({ near, far: nears[i + 1] ?? 1000 })),
    resolveParts: (_: unknown, __: string, ___: number, n: number) => [{ mesh: `l${n}.msh`, transform: null }],
    meshGroups: (part: { mesh: string }) => {
      const n = Number(/l(\d+)/.exec(part.mesh)![1]);
      const dz = at[n] ?? 0;
      return [boxTri(`shader/s${n}.sht`, [-10, 0, 57.4 + dz], [10, 5, 67.4 + dz])];
    },
  });
  const finest = [boxTri('shader/s0.sht', [-10, 0, 57.4], [10, 5, 67.4])];
  const palace = lodMeshesFor(null, 'p.lod', finest, chain([0, 100, 450, 400], {}));
  ok(!!palace && palace.lods.map((l: { level: number; near: number }) => `${l.level}@${l.near}`).join(' ') === '0@0 3@400' && palace.meshes.length === 1, `a middle whose switch is past the lowest's is left out; the lowest takes over where it did (${palace?.lods.map((l: { level: number; near: number }) => `${l.level}@${l.near}`).join(' ')})`);
  ok(lodMeshesFor(null, 'g.lod', finest, chain([0, 0, 0], {})) === null, 'a chain whose every switch is at the eye carries nothing: the model is drawn at its finest everywhere, not its heaviest level');
  const temple = lodMeshesFor(null, 't.lod', finest, chain([0, 60, 200, 300], { 1: -15, 2: -30, 3: -45 }));
  ok(temple === null, 'a chain whose every lower level stands somewhere else than the finest carries none');
  const half = lodMeshesFor(null, 'h.lod', finest, chain([0, 60, 200], { 2: -45 }));
  ok(!!half && half.lods.map((l: { level: number }) => l.level).join(',') === '0,1', 'and one whose lowest alone stands elsewhere takes the level before it as its lowest, as for a sprite');
}

// The detail map: every primitive under a material that names one has a second coordinate set for it.
{
  const onePx = Buffer.from('89504e470d0a1a0a', 'hex');
  const withDetail = (path: string) => ({ path, png: onePx, detail: { path: `${path}_detail`, png: onePx } });
  const prim = (second: boolean) => ({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals: null, uvs: new Float32Array([0, 0, 1, 0, 0, 1]), uvs2: second ? new Float32Array([0, 0, 4, 0, 0, 4]) : null, indices: Uint16Array.from([0, 1, 2]) });
  const textures = new Map([
    ['shader/side.sht', withDetail('texture/side')],
    ['shader/wall.sht', withDetail('texture/wall')],
    ['shader/far.sht', withDetail('texture/far')],
  ]);
  // The finest: `side` with no second set (a house's side, detailed nowhere in it), `wall` with one primitive
  // that has one and one that has not. The level: `side` with a second set, `wall` without one, and `far`
  // (a shader only the level uses) with one.
  const glb = buildGlb(
    [{ name: 'house', groups: [{ shader: 'shader/side.sht', primitives: [prim(false)] }, { shader: 'shader/wall.sht', primitives: [prim(true), prim(false)] }], hardpoints: [] }],
    { flipX: true, textures, lods: [{ name: 'lod:2', groups: [{ shader: 'shader/side.sht', primitives: [prim(true)] }, { shader: 'shader/wall.sht', primitives: [prim(false)] }, { shader: 'shader/far.sht', primitives: [prim(true)] }], hardpoints: [] }] },
  );
  const json = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
  const prims: { mesh: string; material: number; uv1: boolean }[] = [];
  for (const m of json.meshes) for (const p of m.primitives) prims.push({ mesh: m.name, material: p.material, uv1: p.attributes.TEXCOORD_1 !== undefined });
  const detailed = (i: number) => json.materials[i].extras?.swg?.detail !== undefined;
  ok(prims.every((p) => !detailed(p.material) || p.uv1), 'no primitive of the finest or of a lower level sits under a detail map with no second coordinate set for it');
  const side = prims.filter((p) => json.materials[p.material].name === 'shader/side.sht');
  ok(side.every((p) => !detailed(p.material)), "a shader the model's own meshes carry no second set for stays plain on the finest, whatever a lower level carries (the house the Housing tab puts down at its finest)");
  const wall = prims.filter((p) => json.materials[p.material].name === 'shader/wall.sht');
  ok(wall.filter((p) => detailed(p.material)).length === 1 && wall.filter((p) => !detailed(p.material)).length === 2 && new Set(wall.map((p) => p.material)).size === 2, 'a detailed shader keeps its detail map where the second set is, and a primitive without one takes a plain copy of the material, under the same name');
  const far = prims.filter((p) => json.materials[p.material].name === 'shader/far.sht');
  ok(far.length === 1 && detailed(far[0].material) && far[0].uv1, 'a shader only a lower level uses is decided over that level');
  const plainOnly = buildGlb([{ name: 'x', groups: [{ shader: 'shader/wall.sht', primitives: [prim(true)] }], hardpoints: [] }], { flipX: true, textures });
  const pj = JSON.parse(plainOnly.toString('utf8', 20, 20 + plainOnly.readUInt32LE(12)));
  ok(pj.materials.length === 1 && pj.materials[0].extras?.swg?.detail !== undefined, 'a model whose every primitive has its second set is written exactly as before: one material, detailed');
}

// ---------------------------------------------------------------------------------------------
// The GLB's second scene.
{
  const glb = buildGlb([{ name: 'cell:0:r0', groups: [tri(0), tri(1)], hardpoints: [] }], { flipX: true, textures: new Map(), lods: [{ name: 'lod:2', groups: [tri(1), tri(5)], hardpoints: [] }] });
  const len = glb.readUInt32LE(12);
  const json = JSON.parse(glb.toString('utf8', 20, 20 + len));
  ok(json.scene === 0 && json.scenes.length === 2 && json.scenes[1].name === LOD_SCENE && json.scenes[0].nodes.every((n: number) => json.nodes[n].name !== 'lod:2') && json.nodes[json.scenes[1].nodes[0]].name === 'lod:2', "the lower levels are a second scene named `lods`: every loader that reads the default scene sees exactly the model it always did");
  ok(json.materials.length === 3, 'a shader shared between levels is one material in the file (three shaders, three materials)');
  const plain = buildGlb([{ name: 'x', groups: [tri(0)], hardpoints: [] }], { flipX: true, textures: new Map() });
  const pj = JSON.parse(plain.toString('utf8', 20, 20 + plain.readUInt32LE(12)));
  ok(pj.scenes.length === 1 && !pj.scenes[0].name, 'a model with no lower levels is written exactly as before, one scene');
}

// ---------------------------------------------------------------------------------------------
// The owner's archives.
{
  let swg = process.env.SWG ?? '';
  const env = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (!swg && existsSync(env)) {
    for (const line of readFileSync(env, 'utf8').split(/\r?\n/)) {
      const m = /^\s*SWG\s*=\s*(.*?)\s*$/.exec(line);
      if (m) swg = m[1].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  if (!swg || !existsSync(swg)) note('no SWG install on this machine, so the retail chains are not read here');
  else {
    const { openVfs } = await import('../tre.mjs');
    const { isRetailByName } = await import('../manifest.mjs');
    const vfs = openVfs(swg, { filter: (f: string) => isRetailByName(f, statSync(join(swg, f)).size) !== null, log: () => {} });
    const lods = [...vfs.list('appearance/')].filter((p: string) => /\.lod$/i.test(p));
    let contiguous = 0;
    let read = 0;
    const sprChains: string[] = [];
    for (const p of lods) {
      let levels;
      try {
        levels = lodLevels(parseIff(vfs.read(p)));
      } catch {
        continue;
      }
      read++;
      if (chainContiguous(levels)) contiguous++;
      if (levels.some((l: { name: string }) => /\.spr$/i.test(l.name))) sprChains.push(p);
    }
    ok(read > 5000 && contiguous / read > 0.995, `of the ${read} retail detail chains, ${contiguous} are contiguous (each level takes over where the one before ends)`);
    // A real chain end to end: the converter's own mesh reader.
    const deps = {
      exteriorAppearance,
      detailLevels,
      resolveParts,
      meshGroups: (part: { mesh: string; transform: number[] | null }) => {
        const m = parseMesh(parseIff(vfs.read(part.mesh)));
        return m.groups;
      },
    };
    const capitol = 'appearance/mun_tato_capitol_s01.apt';
    if (vfs.has(capitol) || vfs.has('appearance/mun_tato_capitol_s01.pob')) {
      const src = vfs.has(capitol) ? capitol : 'appearance/mun_tato_capitol_s01.pob';
      const r = lodMeshesFor(vfs, src, [], deps);
      ok(!!r && r.lods.length >= 2 && r.meshes.every((m: { name: string }) => lodLevelOfName(m.name) > 0) && chainContiguous(r.lods), `a portal building's levels are its shell's (${src}: levels ${r?.lods.map((l: { level: number; near: number }) => `${l.level}@${l.near}`).join(' ')})`);
    } else note('the Tatooine capitol is not in these archives');
    let sprCarried = 0;
    let sprBad = 0;
    for (const p of sprChains) {
      const sprLevels = new Set<number>();
      lodLevels(parseIff(vfs.read(p))).forEach((l: { name: string }, i: number) => {
        if (/\.spr$/i.test(l.name)) sprLevels.add(i);
      });
      const r = lodMeshesFor(vfs, p, [], deps);
      if (!r) continue;
      sprCarried++;
      if (r.lods.some((l: { level: number }) => sprLevels.has(l.level))) sprBad++;
    }
    ok(sprChains.length > 0 && sprBad === 0, `a chain with a sprite level (${sprChains.length}, a picture the converter does not read) never carries it, and ${sprCarried} of them carry their other lower levels`);
  }
}

// ---------------------------------------------------------------------------------------------
// The converted packs.
{
  const root = fileURLToPath(new URL('../../../assets-private/', import.meta.url));
  let packs = 0;
  if (existsSync(root)) {
    for (const planet of readdirSync(root)) {
      const dir = join(root, planet);
      const mf = join(dir, 'manifest.json');
      const lf = join(dir, 'layout.json');
      if (!existsSync(mf) || !existsSync(lf)) continue;
      const manifest = JSON.parse(readFileSync(mf, 'utf8'));
      if ((manifest.lodFormat ?? 0) < LOD_FORMAT) continue;
      packs++;
      const defs: { id: string; file: string; lods?: { level: number; near: number; far: number; prims: number }[]; cells?: { index: number }[] }[] = [...(manifest.categories?.layout ?? []), ...(manifest.categories?.flora ?? [])];
      let withLods = 0;
      let badNodes = 0;
      let badRanges = 0;
      let notRising = 0;
      let misplaced = 0;
      let bareDetail = 0;
      let files = 0;
      type Gltf = { scenes?: { name?: string; nodes: number[] }[]; scene?: number; nodes: { name?: string; mesh?: number; children?: number[] }[]; meshes: { primitives: { material?: number; attributes: Record<string, number> }[] }[]; accessors: { min?: number[]; max?: number[] }[]; materials?: { extras?: { swg?: { detail?: number } } }[] };
      /** The box of what a node and its children draw, from the POSITION accessors' own bounds; a room of a building (cell past 0) left out. */
      const boxOf = (json: Gltf, n: number, box: { min: number[]; max: number[] }): void => {
        const node = json.nodes[n];
        const cell = /^cell[:_]?(\d+)/.exec(node.name ?? '');
        if (node.mesh !== undefined && !(cell && Number(cell[1]) > 0)) {
          for (const p of json.meshes[node.mesh].primitives) {
            const a = json.accessors[p.attributes.POSITION];
            if (!a?.min || !a.max) continue;
            for (let k = 0; k < 3; k++) {
              box.min[k] = Math.min(box.min[k], a.min[k]);
              box.max[k] = Math.max(box.max[k], a.max[k]);
            }
          }
        }
        for (const c of node.children ?? []) boxOf(json, c, box);
      };
      const empty = () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
      for (const d of defs) {
        const file = join(dir, d.file);
        // A particle effect placed as a model is its own JSON, not a GLB.
        const exists = /\.glb$/i.test(d.file) && existsSync(file);
        let json: Gltf | null = null;
        if (exists) {
          const b = readFileSync(file);
          json = JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12))) as Gltf;
          files++;
          // Every primitive under a material naming a detail map has the second coordinate set it samples.
          for (const m of json.meshes) for (const p of m.primitives) if (p.material !== undefined && json.materials?.[p.material]?.extras?.swg?.detail !== undefined && p.attributes.TEXCOORD_1 === undefined) bareDetail++;
        }
        if (!d.lods) continue;
        withLods++;
        if (!chainContiguous(d.lods) || d.lods[0].near !== 0 || d.lods[0].level !== 0) badRanges++;
        for (let i = 1; i < d.lods.length; i++) if (!(d.lods[i].near > d.lods[i - 1].near)) notRising++;
        if (!json) continue;
        const scene = (json.scenes ?? []).find((s) => s.name === LOD_SCENE);
        const names = new Set<number>((scene?.nodes ?? []).map((n: number) => lodLevelOfName(json!.nodes[n].name)));
        for (const l of d.lods.slice(1)) if ((l.prims > 0) !== names.has(l.level)) badNodes++;
        // Each lower level stands where the finest does.
        const fine = empty();
        for (const n of json.scenes?.[json.scene ?? 0]?.nodes ?? []) boxOf(json, n, fine);
        for (const n of scene?.nodes ?? []) {
          const low = empty();
          boxOf(json, n, low);
          if (Number.isFinite(fine.min[0]) && Number.isFinite(low.min[0]) && !levelInPlace(fine, low)) misplaced++;
        }
      }
      ok(badRanges === 0 && badNodes === 0 && withLods > 0, `${planet}: ${withLods} of ${defs.length} models carry levels; every carried level that draws anything has its lod:<n> node and none that draws nothing has one, and every model's ranges start at the eye and are contiguous`);
      ok(notRising === 0 && misplaced === 0, `${planet}: every carried level's switch is beyond the finer one's (none the pick could never draw), and every lower level stands where its finest does (${notRising}, ${misplaced} wrong)`);
      ok(bareDetail === 0 && files > 0, `${planet}: over ${files} model files, no primitive sits under a detail map with no second coordinate set for it (${bareDetail})`);
      const layout = JSON.parse(readFileSync(lf, 'utf8'));
      const objs: { contained?: boolean; cell?: number; in?: number; model: string }[] = layout.objects;
      const byId = new Map(defs.map((d) => [d.id, d]));
      let indoor = 0;
      let named = 0;
      let badHost = 0;
      // A building the pack carries as its shell alone (its rooms did not convert) has no rooms to name: its
      // furniture is found by the rooms' boxes at run time, and finds none, as before.
      let roomless = 0;
      for (const o of objs) {
        if (!o.contained) continue;
        indoor++;
        if (typeof o.in !== 'number') continue;
        named++;
        const host = objs[o.in];
        const hd = host && byId.get(host.model);
        if (!host || host.contained || !hd) badHost++;
        else if (!hd.cells) roomless++;
        else if (!(typeof o.cell === 'number' && o.cell > 0 && hd.cells.some((c) => c.index === o.cell))) badHost++;
      }
      if (indoor) ok(badHost === 0 && named > 0, `${planet}: ${named} of ${indoor} objects inside buildings name their building's own row and, where the pack carries its rooms, a room it has${roomless ? ` (${roomless} stand in a building carried as its shell alone)` : ''}`);
    }
  }
  if (!packs) note('no converted pack carries levels yet (npm run swg -- snapshot <swg-dir> all assets-private --radius=all --retail-only)');
}

console.log(`\n${checks} checks passed`);
