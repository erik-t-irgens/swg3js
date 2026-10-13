// The ground mesh on the client's own height points (materials and ground pass, wave 5, step 1), built by the
// game's own `Terrain` over the game's own `SwgTerrain` on every converted world (SWG3JS_PACKS, else
// assets-private), with the generator running here as it runs in the browser when there is no worker.
//
// A near chunk put a vertex every 2 m from a multiple of 64 in game space, and game x is the layout centre
// less the terrain's x, so on every world whose centre is odd in an axis every vertex stood a metre off a pole
// and the client's fans were never drawn. On each world, for chunks near the world's middle:
//
//   1. the chunk's origin is `groundChunkOrigin`'s, and every vertex of its grid falls on a pole
//   2. the mesh is the client's fan surface: every triangle, sampled inside, stands at the height the
//      terrain's own fan sampler gives there (the very function its collision height is read through)
//   3. the physics heightfield stands where the mesh does: made by `chunkHeightfield`, the one function the world
//      adds every chunk's through (which the world's own source is read for), a ray down at every vertex meets
//      it at that vertex's height; put at the bucket's corner, as before, it misses on every world the shift moves
//   4. a far tile is moved with the near ground, its samples on poles; and its cut (`makeFarTileCut`, `coverFrom`,
//      `writeKept`), with chunks loaded in and beside it, cuts exactly the quads that lie inside a loaded chunk's
//      ground and keeps exactly those that touch none, both ways, each quad lying wholly inside the ground of the
//      chunk the cut gives it, so no sliver opens between the near and the far ground
//   5. built with a tiler, every triangle carries one tile whole: its three vertices the same layers and codes,
//      the four families its tile's corners hold (read straight off the terrain) behind them, each vertex its
//      own place in that tile, and the colour map at its own pole; then, with the game's own tiler over the
//      pack's own lookups (`tileLookups`, `makeTiler`), every layer is the child its family's first corner's own
//      choice byte picks (read off the terrain), ranked by the pack's priority, near and far: a far tile's 16 m
//      quad taken as a tile, its corners the far grid's own four samples, its places the quad's corners and its
//      tint the grid's own bytes
//
// Run: node tools/swg/tests/groundAlign.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { Physics } from '../../../src/core/physics.ts';
import { SwgTerrain } from '../../../src/world/swgTerrain.ts';
import { CHUNK_RES, CHUNK_SIZE, chunkHeightfield, Terrain, type ChunkTiler } from '../../../src/world/terrain.ts';
import { groundChunkOrigin, maskCode, NO_SHIFT, tilePlace, type GroundTiler } from '../../../src/world/groundTiles.ts';
import { coverFrom, makeFarTileCut, writeKept } from '../../../src/world/farTile.ts';
import { assembleTileArrays, makeTiler, tileEntries, tileLookups, type ShaderFamilyDef } from '../../../src/world/terrainTextures.ts';
import { childIndexOf } from '../../../src/swg/terrain/generator.ts';
import type { PlanetDef } from '../../../src/data/planets.ts';
import { groundWorlds, PACKS } from './terrainHarness.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string) => console.log(`note ${s}`);
const mod = (v: number, m: number) => ((v % m) + m) % m;

const planet = { id: 'test', seed: 1, palette: { low: 0x808080, mid: 0x808080, high: 0x808080, slope: 0x808080, shore: 0x808080 }, terrain: { base: 0, amplitude: 10, frequency: 0.01, octaves: 1, ridged: 0, flatten: 1, detail: 0 }, water: null } as unknown as PlanetDef;

function centreOf(world: string): { x: number; z: number } | null {
  const file = join(PACKS, world, 'layout.json');
  if (!existsSync(file)) return null;
  const m = /"center"\s*:\s*\{\s*"x"\s*:\s*(-?[\d.]+)\s*,\s*"z"\s*:\s*(-?[\d.]+)/.exec(readFileSync(file, 'utf8').slice(0, 8000));
  return m ? { x: Number(m[1]), z: Number(m[2]) } : null;
}

async function terrainOf(world: string): Promise<Terrain | null> {
  const c = centreOf(world);
  if (!c) return null;
  const dir = join(PACKS, world);
  const bytes = (rel: string): ArrayBuffer | null => {
    const f = join(dir, rel);
    if (!existsSync(f)) return null;
    const b = readFileSync(f);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  const trn = bytes('terrain.trn');
  if (!trn) return null;
  const swg = await SwgTerrain.create(trn, [], c.x, c.z, async (file) => bytes(file));
  const t = new Terrain(planet);
  t.attachSwg(swg);
  return t;
}

const onPole = (v: number) => {
  const m = mod(v, 2);
  return Math.abs(m) <= 1e-3 || Math.abs(m - 2) <= 1e-3;
};

const worlds = groundWorlds();
if (!worlds.length) note(`no converted worlds under ${PACKS}: nothing here can be checked without them`);

const physics = worlds.length ? await Physics.create() : null;
const CHUNKS: [number, number][] = [
  [0, 0],
  [-1, 2],
  [3, -2],
];
const n = CHUNK_RES;
const gridTris = n * n * 2;

// The world adds every chunk's heightfield through the one function this test asks (`chunkHeightfield`), and
// through nothing else: put back at the bucket's corner there, the floor would stand off the drawn ground again.
{
  const src = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8');
  const add = /private addChunkPhysics\(c: Chunk\): void \{[\s\S]*?\n  \}/.exec(src)?.[0] ?? '';
  ok(/cols\.push\(chunkHeightfield\(this\.physics, c\)\)/.test(add) && !/createHeightfield\(/.test(src), "the world puts each chunk's heightfield where its mesh starts through chunkHeightfield, and makes no heightfield any other way");
}

// The far tiles' cut is asked of these chunks: some inside the tile at the origin, two beside it.
const LOADED: [number, number][] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [3, 5],
  [7, 7],
  [2, 6],
  [-1, 0],
  [8, 3],
];

const results: { world: string; offPole: number; fanWorst: number; fieldWorst: number; oldFieldWorst: number; relief: number; farOff: number; cutWrong: number; cutQuads: number; moved: boolean }[] = [];
for (const world of worlds) {
  const terrain = await terrainOf(world);
  if (!terrain) continue;
  const swg = terrain.swg!;
  const shift = terrain.groundShift;
  let offPole = 0;
  let fanWorst = 0;
  let fieldWorst = 0;
  let oldFieldWorst = 0;
  let lowest = Infinity;
  let highest = -Infinity;
  let originsMatch = true;
  for (const [cx, cz] of CHUNKS) {
    terrain.prepareChunk(cx, cz, true);
    const built = terrain.buildChunk(cx, cz);
    const { geometry, heights, origin } = built;
    const want = groundChunkOrigin(cx, cz, shift, CHUNK_SIZE);
    if (origin.x !== want.x || origin.z !== want.z) originsMatch = false;
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    let minX = Infinity;
    let minZ = Infinity;
    // 1 and 2: every grid triangle's corners on poles, and the triangle on the fan surface.
    for (let t = 0; t < gridTris; t++) {
      const p = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, t * 3 + k));
      for (const v of p) {
        minX = Math.min(minX, v.x);
        minZ = Math.min(minZ, v.z);
        if (!onPole(swg.toSwgX(v.x)) || !onPole(swg.toSwgZ(v.z))) offPole++;
      }
      for (const [a, b, c] of [
        [1 / 3, 1 / 3, 1 / 3],
        [0.7, 0.2, 0.1],
        [0.1, 0.7, 0.2],
        [0.2, 0.1, 0.7],
      ]) {
        const x = p[0].x * a + p[1].x * b + p[2].x * c;
        const z = p[0].z * a + p[1].z * b + p[2].z * c;
        const y = p[0].y * a + p[1].y * b + p[2].y * c;
        fanWorst = Math.max(fanWorst, Math.abs(y - swg.sampler.heightAt(swg.toSwgX(x), swg.toSwgZ(z))));
      }
    }
    if (minX !== origin.x || minZ !== origin.z) originsMatch = false;
    // 3: the heightfield, made the world's way, and one put where it used to be.
    if (physics) {
      const field = chunkHeightfield(physics, built);
      const old = physics.createHeightfield(cx * CHUNK_SIZE + 4096, cz * CHUNK_SIZE, CHUNK_SIZE, CHUNK_RES, heights);
      physics.stepOnce();
      for (let i = 0; i <= n; i += 3) {
        for (let j = 0; j <= n; j += 3) {
          const x = origin.x + i * 2;
          const z = origin.z + j * 2;
          const h = swg.sampler.heightAt(swg.toSwgX(x), swg.toSwgZ(z));
          lowest = Math.min(lowest, h);
          highest = Math.max(highest, h);
          const d = physics.groundDistance(x, h + 50, z, 200);
          fieldWorst = Math.max(fieldWorst, d === null ? Infinity : Math.abs(h + 50 - d - h));
          // The old placement, moved 4096 m aside so the two never meet: its vertex at the bucket's corner.
          const xo = cx * CHUNK_SIZE + i * 2;
          const dOld = physics.groundDistance(xo + 4096, h + 50, z, 200);
          const hOld = swg.sampler.heightAt(swg.toSwgX(xo), swg.toSwgZ(z));
          oldFieldWorst = Math.max(oldFieldWorst, dOld === null ? 0 : Math.abs(h + 50 - dOld - hOld));
        }
      }
      physics.removeCollider(field);
      physics.removeCollider(old);
    }
    geometry.dispose();
  }
  // 4: a far tile moved with the near ground, and its cut.
  const tile = terrain.buildFarTile(0, 0, 512, 32, true)!;
  const u = tile.userData as { fullIndex: ArrayLike<number>; ox: number; oz: number; n: number; step: number };
  const fo = groundChunkOrigin(0, 0, shift, 512);
  let farOff = u.ox === fo.x && u.oz === fo.z ? 0 : 1;
  const fp = tile.getAttribute('position') as THREE.BufferAttribute;
  for (let k = 0; k < fp.count; k += 7) {
    if (!onPole(swg.toSwgX(fp.getX(k)))) farOff++;
    if (!onPole(swg.toSwgZ(fp.getZ(k)))) farOff++;
  }
  const cut = makeFarTileCut(u.fullIndex, u.n, u.ox, u.oz, u.step, CHUNK_SIZE, shift);
  coverFrom(cut, (cx, cz) => LOADED.some(([a, b]) => a === cx && b === cz));
  const grounds = LOADED.map(([cx, cz]) => groundChunkOrigin(cx, cz, shift, CHUNK_SIZE));
  let cutWrong = 0;
  let cutQuads = 0;
  for (let j = 0; j < u.n; j++) {
    for (let i = 0; i < u.n; i++) {
      const x0 = u.ox + i * u.step;
      const z0 = u.oz + j * u.step;
      const x1 = x0 + u.step;
      const z1 = z0 + u.step;
      const inside = grounds.some((g) => x0 >= g.x && x1 <= g.x + CHUNK_SIZE && z0 >= g.z && z1 <= g.z + CHUNK_SIZE);
      const touches = grounds.some((g) => Math.min(x1, g.x + CHUNK_SIZE) - Math.max(x0, g.x) > 1e-6 && Math.min(z1, g.z + CHUNK_SIZE) - Math.max(z0, g.z) > 1e-6);
      const own = groundChunkOrigin(cut.colChunk[i], cut.rowChunk[j], shift, CHUNK_SIZE);
      const inOwn = x0 >= own.x && x1 <= own.x + CHUNK_SIZE && z0 >= own.z && z1 <= own.z + CHUNK_SIZE;
      const covered = cut.covered[j * u.n + i] === 1;
      if (covered) cutQuads++;
      if (!inOwn || (covered ? !inside : touches)) cutWrong++;
    }
  }
  const kept = writeKept(cut, tile);
  if (kept !== u.n * u.n - cutQuads) cutWrong++;
  tile.dispose();
  ok(originsMatch, `${world}: every chunk's ground starts at groundChunkOrigin's corner, its least vertex`);
  results.push({ world, offPole, fanWorst, fieldWorst, oldFieldWorst, relief: highest - lowest, farOff, cutWrong, cutQuads, moved: shift.x !== NO_SHIFT.x || shift.z !== NO_SHIFT.z });
  swg.dispose();
}

if (results.length) {
  const off = results.filter((r) => r.offPole > 0);
  ok(off.length === 0, `on all ${results.length} worlds every vertex of every chunk's grid falls on a pole${off.length ? `: not on ${off.map((r) => `${r.world} (${r.offPole})`).join(', ')}` : ''}`);
  const worstFan = results.reduce((a, r) => Math.max(a, r.fanWorst), 0);
  ok(worstFan < 2e-3, `and the mesh is the client's fan surface: sampled inside every triangle, at most ${(worstFan * 1000).toFixed(2)} mm from the height the terrain's fan sampler gives`);
  const worstField = results.reduce((a, r) => Math.max(a, r.fieldWorst), 0);
  ok(worstField < 2e-3, `the physics heightfield chunkHeightfield makes meets a ray at every vertex at that vertex's height (worst ${(worstField * 1000).toFixed(2)} mm)`);
  // A world whose ground under these chunks is flat (a town's plaza, the dungeons' plain) cannot tell the two apart.
  const movedWorlds = results.filter((r) => r.moved && r.relief > 0.5);
  const stillOff = movedWorlds.filter((r) => r.oldFieldWorst < 0.01);
  ok(movedWorlds.length === 0 || stillOff.length === 0, `while put at the bucket's corner, as before, it stands off the poles' heights on every world the shift moves whose ground there is not flat (${movedWorlds.map((r) => `${r.world} ${r.oldFieldWorst.toFixed(2)} m`).join(', ') || 'none here'}; flat there: ${results.filter((r) => r.moved && r.relief <= 0.5).map((r) => r.world).join(', ') || 'none'})`);
  const farOff = results.filter((r) => r.farOff > 0);
  ok(farOff.length === 0, `a far tile stands where groundChunkOrigin puts it, every sample on a pole${farOff.length ? `: not on ${farOff.map((r) => r.world).join(', ')}` : ''}`);
  const cutWrong = results.filter((r) => r.cutWrong > 0);
  const quads = [...new Set(results.map((r) => r.cutQuads))];
  ok(cutWrong.length === 0 && quads.length === 1 && quads[0] === 6 * 16, `and its cut takes out exactly the quads lying inside a loaded chunk's ground (${quads.join(' or ')} of them: the six chunks in the tile, sixteen quads each) and keeps every quad that touches none, both ways, each inside the ground of the chunk the cut gives it${cutWrong.length ? `: wrong on ${cutWrong.map((r) => `${r.world} (${r.cutWrong})`).join(', ')}` : ''}`);
}

// ---------------------------------------------------------------- 5. a chunk and a far tile built with a tiler

/** The pack's own lookups as the game makes them, its pictures stood in by one texel each (the layers are what count here). */
function packTiler(world: string, swg: SwgTerrain): { tiler: ChunkTiler & { refresh(): void }; childLayers: Map<number, number[]>; priority: Map<number, number> } | null {
  const f = join(PACKS, world, 'terrain', 'shaders.json');
  if (!existsSync(f)) return null;
  const file = JSON.parse(readFileSync(f, 'utf8')) as { version?: number; families: ShaderFamilyDef[] };
  if ((file.version ?? 0) < 4) return null;
  const families = file.families.filter((x) => x.children?.length);
  const entries = tileEntries(families, false);
  const arrays = assembleTileArrays(families, entries, entries.map(() => true), 1, { colour: () => [0, 0, 0, 255], normal: () => null, gloss: () => null })!;
  const group = swg.template.generator.shaderGroup;
  const planetFamilies = new Map<number, string>([...group.families.values()].map((x) => [x.id, x.name]));
  const { childLayers, priority } = tileLookups(planetFamilies, families, arrays.childLayersByName);
  return { tiler: makeTiler(childLayers, priority, group, false), childLayers, priority };
}

/** A tile's layers and codes worked out here from its four corners (SW, SE, NW, NE), bottom first by rank, ties by the corners' order. */
function expectTile(fams: number[], choices: number[], rank: (f: number) => number, layerOf: (f: number, choice: number) => number): { layers: number[]; codes: number[] } {
  const distinct = [...new Set(fams)].sort((a, b) => rank(a) - rank(b) || fams.indexOf(a) - fams.indexOf(b));
  const layers = [0, 1, 2, 3].map((i) => {
    const f = distinct[Math.min(i, distinct.length - 1)];
    return layerOf(f, choices[fams.indexOf(f)]);
  });
  const codes = [1, 2, 3].map((i) => (i < distinct.length ? maskCode(fams.reduce((b, f, c) => b | (f === distinct[i] ? 1 << c : 0), 0)) : 0));
  return { layers, codes };
}

for (const world of ['tatooine', 'naboo']) {
  if (!worlds.includes(world)) {
    note(`no ${world} under ${PACKS}: its tiles are not checked here`);
    continue;
  }
  const terrain = (await terrainOf(world))!;
  const swg = terrain.swg!;
  const order = new Map([...swg.template.generator.shaderGroup.families.keys()].map((id, i) => [id, i]));
  // A layer per family, so the test can name the family a layer stands for.
  const tiler: GroundTiler & { census: Float64Array } = { rank: (f) => order.get(f) ?? 999, layer: (f) => f, corners: [0, 1, 2, 3], census: new Float64Array(5) };
  terrain.tiler = tiler as ChunkTiler;
  terrain.prepareChunk(1, -1, true);
  const { geometry } = terrain.buildChunk(1, -1);
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const lay = geometry.getAttribute('aGroundLayers') as THREE.BufferAttribute;
  const bl = geometry.getAttribute('aGroundBlend') as THREE.BufferAttribute;
  const ti = geometry.getAttribute('aGroundTint') as THREE.BufferAttribute;
  ok(!!lay && !!bl && !!ti && !geometry.getAttribute('aFamily') && !geometry.getAttribute('color'), `${world}: a chunk built with a tiler carries its tiles (layers, codes and tint) and not the families of before`);
  ok(lay.array instanceof Uint8Array && bl.array instanceof Uint8Array && ti.array instanceof Uint8Array && ti.normalized && !lay.normalized, 'in bytes: the layers and codes as they stand, the tint normalised');
  let whole = true;
  let corners = true;
  let places = true;
  let tints = true;
  const st: [number, number] = [0, 0];
  /** The terrain-space corner of the 4 m tile a triangle lies in, from its middle. */
  const tileOf = (g: THREE.BufferGeometry, t: number) => {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    let mx = 0;
    let mz = 0;
    for (let k = 0; k < 3; k++) {
      mx += p.getX(t * 3 + k) / 3;
      mz += p.getZ(t * 3 + k) / 3;
    }
    return { tx0: 4 * Math.floor(swg.toSwgX(mx) / 4), tz0: 4 * Math.floor(swg.toSwgZ(mz) / 4) };
  };
  const cornersAt = (tx0: number, tz0: number): [number, number][] => [
    [tx0, tz0],
    [tx0 + 4, tz0],
    [tx0, tz0 + 4],
    [tx0 + 4, tz0 + 4],
  ];
  for (let t = 0; t < gridTris; t++) {
    for (let k = 1; k < 3; k++) for (let q = 0; q < 4; q++) {
      if (lay.getComponent(t * 3 + k, q) !== lay.getComponent(t * 3, q)) whole = false;
      if (q < 3 && bl.getComponent(t * 3 + k, q) !== bl.getComponent(t * 3, q)) whole = false;
    }
    const { tx0, tz0 } = tileOf(geometry, t);
    const fams = cornersAt(tx0, tz0).map(([x, z]) => swg.sampler.shaderAt(x, z));
    const want = expectTile(fams, [0, 0, 0, 0], (f) => order.get(f) ?? 999, (f) => f);
    for (let i = 0; i < 4; i++) if (lay.getComponent(t * 3, i) !== want.layers[i]) corners = false;
    for (let i = 0; i < 3; i++) if (bl.getComponent(t * 3, i) !== want.codes[i]) corners = false;
    for (let k = 0; k < 3; k++) {
      tilePlace(bl.getComponent(t * 3 + k, 3), st);
      const x = swg.toSwgX(pos.getX(t * 3 + k));
      const z = swg.toSwgZ(pos.getZ(t * 3 + k));
      if (Math.abs(tx0 + st[0] * 4 - x) > 1e-3 || Math.abs(tz0 + st[1] * 4 - z) > 1e-3) places = false;
      const c = swg.colorIfCached(pos.getX(t * 3 + k), pos.getZ(t * 3 + k));
      // The bytes as stored: a normalised attribute's own reader hands them back over 255.
      const raw = ti.array as Uint8Array;
      const o = (t * 3 + k) * 3;
      if (c === null || raw[o] !== ((c >> 16) & 255) || raw[o + 1] !== ((c >> 8) & 255) || raw[o + 2] !== (c & 255)) tints = false;
    }
  }
  ok(whole, 'every triangle\'s three vertices carry the same layers and codes: a tile whole on each triangle');
  ok(corners, "every triangle's layers are its tile's corner families as the terrain holds them, bottom first, each overlay's mask the corners it holds");
  ok(places, 'each vertex carries its own place in its tile, which is where it stands in the terrain\'s own 4 m grid');
  ok(tints, 'and the colour map at its own pole');
  const cells = tiler.census[1] + tiler.census[2] + tiler.census[3] + tiler.census[4];
  ok(cells === n * n, `the chunk's ${cells} cells are each counted once, by how many families their tile holds`);
  geometry.dispose();

  // The game's own tiler over the pack's own lookups: the choice each layer draws, near and far.
  const real = packTiler(world, swg);
  if (!real) {
    note(`${world}'s pack is from before terrain shaders version 4: the game's tiler is not run over it here`);
    swg.dispose();
    continue;
  }
  const group = swg.template.generator.shaderGroup;
  const rank = (f: number) => real.priority.get(f) ?? 20000 + f;
  const layerOf = (f: number, choice: number) => {
    const list = real.childLayers.get(f);
    return list ? (list[childIndexOf(group.families.get(f), choice)] ?? list[0]) : 0;
  };
  terrain.tiler = real.tiler;
  const near = terrain.buildChunk(1, -1).geometry;
  const nl = near.getAttribute('aGroundLayers') as THREE.BufferAttribute;
  const nb = near.getAttribute('aGroundBlend') as THREE.BufferAttribute;
  let nearRight = true;
  let notFirst = 0;
  for (let t = 0; t < gridTris; t++) {
    const { tx0, tz0 } = tileOf(near, t);
    const at = cornersAt(tx0, tz0);
    const fams = at.map(([x, z]) => swg.sampler.shaderAt(x, z));
    const choices = at.map(([x, z]) => swg.sampler.childAt(x, z) ?? -1);
    const want = expectTile(fams, choices, rank, layerOf);
    for (let i = 0; i < 4; i++) {
      const got = nl.getComponent(t * 3, i);
      if (got !== want.layers[i]) nearRight = false;
      const f = [...new Set(fams)].sort((a, b) => rank(a) - rank(b) || fams.indexOf(a) - fams.indexOf(b))[Math.min(i, new Set(fams).size - 1)];
      if (got !== real.childLayers.get(f)?.[0]) notFirst++;
    }
    for (let i = 0; i < 3; i++) if (nb.getComponent(t * 3, i) !== want.codes[i]) nearRight = false;
  }
  ok(nearRight && notFirst > 0, `${world}: with the game's own tiler every layer is the alternate its family's first corner's own choice byte picks, ranked by the pack's priority (${notFirst} of the chunk's layers draw an alternate past the first)`);
  near.dispose();

  // A far tile: each 16 m quad a tile of its own, its corners the far grid's own samples.
  const far = terrain.buildFarTile(0, 0, 512, 32, true)!;
  const o = groundChunkOrigin(0, 0, terrain.groundShift, 512);
  const grid = swg.farGrid(o.x, o.z, 512, 32, true)!;
  const fu = far.userData as { fullIndex?: ArrayLike<number>; n: number; ox: number; oz: number; step: number };
  const step = 512 / 32;
  const w = 32 + 3;
  const fl = far.getAttribute('aGroundLayers') as THREE.BufferAttribute;
  const fb = far.getAttribute('aGroundBlend') as THREE.BufferAttribute;
  const ft = far.getAttribute('aGroundTint') as THREE.BufferAttribute;
  const fpos = far.getAttribute('position') as THREE.BufferAttribute;
  ok(!!fl && !!fb && !!ft && !far.getAttribute('aFamily') && !!fu.fullIndex && fu.ox === o.x && fu.oz === o.z, `${world}: a far tile built with a tiler carries its tiles too, at the near ground's shifted corner, with its whole index kept for its cut`);
  let farLayers = true;
  let farPlaces = true;
  let farTints = true;
  let farDistinct = 0;
  const g = (col: number, row: number) => row * w + col;
  for (let t = 0; t < fpos.count / 3; t++) {
    let mx = 0;
    let mz = 0;
    for (let k = 0; k < 3; k++) {
      mx += fpos.getX(t * 3 + k) / 3;
      mz += fpos.getZ(t * 3 + k) / 3;
    }
    const i = Math.floor((mx - o.x) / step);
    const j = Math.floor((mz - o.z) / step);
    // The quad's corners in the terrain's own frame: its south-west is the game's high x and low z.
    const sw = g(i + 2, j + 1);
    const se = g(i + 1, j + 1);
    const nw = g(i + 2, j + 2);
    const ne = g(i + 1, j + 2);
    const fams = [sw, se, nw, ne].map((k) => grid.shaders[k]);
    const choices = [sw, se, nw, ne].map((k) => grid.children[k]);
    if (new Set(fams).size > 1) farDistinct++;
    const want = expectTile(fams, choices, rank, layerOf);
    for (let k = 0; k < 3; k++) {
      for (let q = 0; q < 4; q++) if (fl.getComponent(t * 3 + k, q) !== want.layers[q]) farLayers = false;
      for (let q = 0; q < 3; q++) if (fb.getComponent(t * 3 + k, q) !== want.codes[q]) farLayers = false;
      const vx = fpos.getX(t * 3 + k);
      const vz = fpos.getZ(t * 3 + k);
      tilePlace(fb.getComponent(t * 3 + k, 3), st);
      const swX = swg.toSwgX(o.x + (i + 1) * step);
      const swZ = swg.toSwgZ(o.z + j * step);
      if (Math.abs(swX + st[0] * step - swg.toSwgX(vx)) > 1e-3 || Math.abs(swZ + st[1] * step - swg.toSwgZ(vz)) > 1e-3) farPlaces = false;
      const vi = Math.round((vx - o.x) / step);
      const vj = Math.round((vz - o.z) / step);
      const s = ((vj + 1) * w + vi + 1) * 3;
      const raw = ft.array as Uint8Array;
      if (raw[(t * 3 + k) * 3] !== grid.colors[s] || raw[(t * 3 + k) * 3 + 1] !== grid.colors[s + 1] || raw[(t * 3 + k) * 3 + 2] !== grid.colors[s + 2]) farTints = false;
    }
  }
  ok(farLayers && farDistinct > 0, `every far triangle carries its 16 m quad whole: the far grid's own four corner samples, bottom first by the pack's priority, each the alternate its first corner's choice picks, each overlay's mask its corners (${farDistinct} quads hold more than one family)`);
  ok(farPlaces, 'each far vertex its own place in its quad, which is a corner of it');
  ok(farTints, "and the far grid's own colour at its own sample");
  far.dispose();
  swg.dispose();
}

console.log(`\n${passed} checks passed`);
