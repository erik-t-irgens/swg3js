// The levels `lods` makes for the models the client gave none (the GPU port's pass 1, wave 7: tools/swg/madelods.mjs), run
// as the real command over a small pack made up here with the converter's own GLB writer (never assets-private): a
// smooth two-piece model with vertex colours on one piece, a portal building whose shell is smooth and whose room is
// not, a rough one the simplifier cannot touch within the threshold, a tiny one, and one carrying the client's own
// levels. It holds the triangle counts and where each level switches, every attribute of every piece kept (names,
// kinds, material, index kind), the error under the threshold (by the simplifier's own figure and by measuring every
// original corner against each level's surface), no corner moved, the border where the model is split kept whole, the
// rooms and a model with levels of its own left byte for byte, a second run changing no byte, a file whose rows were
// lost put back and made again to the same bytes, a dry run writing nothing, `status` asking once and then quiet (and
// again when a model it looked at changes), and the game's side: its pick drawing every made level, the made levels'
// own bias moving their switches live in a level group while the client's stay, and the sweep allocating nothing (in
// twelve fresh processes, the child section below).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PerformanceObserver } from 'node:perf_hooks';
import v8 from 'node:v8';
import * as THREE from 'three';
import { buildGlb } from '../glb.mjs';
import { MATERIAL_FORMAT } from '../surface.mjs';
import { LOD_FORMAT, LOD_SCENE, chainContiguous, levelInPlace, lodLevelOfName } from '../lodlevels.mjs';
import { MADE_LOD, MADE_LOD_FORMAT, madeLodsKey, madeScene, readAccessor, readGlb, stripMade, switchNear, writeGlb } from '../madelods.mjs';
import { LOD_LEVEL_DEFAULTS, LOD_LEVEL_TUNE, chainNears, drawnLevels, levelOf } from '../../../src/world/lodLevels.ts';
import { LevelGroup } from '../../../src/world/levelGroup.ts';
import { AssetPack, type LoadedModel } from '../../../src/world/assetPack.ts';
import { LOD_DIALS, lodDialsFor } from '../../../src/world/lodDials.ts';
import { movedArgs } from '../../../src/ui/dials.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const env = { ...process.env, SWG: '', SWG3JS_PLACEMENTS: '' };
const run = (args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', maxBuffer: 64 * 1048576, env });

/** A seeded generator, so a failure repeats. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

type Prim = { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint16Array; colors?: Uint8Array };
/** A height field over [x0, x1] by [z0, z1] in `nx` by `nz` cells, its normals by finite differences. */
function field(nx: number, nz: number, x0: number, x1: number, z0: number, z1: number, h: (x: number, z: number) => number, colours = false): Prim {
  const vx = nx + 1;
  const vz = nz + 1;
  const positions = new Float32Array(vx * vz * 3);
  const normals = new Float32Array(vx * vz * 3);
  const uvs = new Float32Array(vx * vz * 2);
  const colors = colours ? new Uint8Array(vx * vz * 4) : undefined;
  for (let j = 0; j < vz; j++) {
    for (let i = 0; i < vx; i++) {
      const v = j * vx + i;
      const x = x0 + ((x1 - x0) * i) / nx;
      const z = z0 + ((z1 - z0) * j) / nz;
      positions.set([x, h(x, z), z], v * 3);
      const e = 1e-3;
      const nxv = -(h(x + e, z) - h(x - e, z)) / (2 * e);
      const nzv = -(h(x, z + e) - h(x, z - e)) / (2 * e);
      const len = Math.sqrt(nxv * nxv + 1 + nzv * nzv);
      normals.set([nxv / len, 1 / len, nzv / len], v * 3);
      uvs.set([x / 4, z / 4], v * 2);
      if (colors) colors.set([200, 120 + (i % 50), 60, 255], v * 4);
    }
  }
  const indices = new Uint16Array(nx * nz * 6);
  let k = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * vx + i;
      indices.set([a, a + vx, a + 1, a + 1, a + vx, a + vx + 1], k);
      k += 6;
    }
  }
  return { positions, normals, uvs, indices, ...(colors ? { colors } : {}) };
}
const bump = (x: number, z: number) => 1.5 * Math.exp(-(x * x + z * z) / 18) + 0.2 * Math.sin(x * 0.4);
const box = (s: number): Prim => {
  const p = [-s, 0, -s, s, 0, -s, s, 0, s, -s, 0, s, -s, s, -s, s, s, -s, s, s, s, -s, s, s];
  const ix = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
  return { positions: Float32Array.from(p), normals: new Float32Array(24).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), uvs: new Float32Array(16), indices: Uint16Array.from(ix) };
};
const boundsOf = (prims: Prim[]) => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) for (let i = 0; i < p.positions.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], p.positions[i + k]);
    max[k] = Math.max(max[k], p.positions[i + k]);
  }
  return { min, max };
};

const sha = (f: string) => createHash('sha1').update(readFileSync(f)).digest('hex');
const hashAll = (dir: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n);
      if (statSync(f).isDirectory()) walk(f);
      else out[f.slice(dir.length)] = sha(f);
    }
  };
  walk(dir);
  return out;
};

/** The distance from a point to a triangle (Ericson's closest point). */
function pointTri(p: number[], a: number[], b: number[], c: number[]): number {
  const sub = (u: number[], v: number[]) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  let q: number[];
  if (d1 <= 0 && d2 <= 0) q = a;
  else {
    const bp = sub(p, b);
    const d3 = dot(ab, bp);
    const d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) q = b;
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        q = [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]];
      } else {
        const cp = sub(p, c);
        const d5 = dot(ab, cp);
        const d6 = dot(ac, cp);
        if (d6 >= 0 && d5 <= d6) q = c;
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6);
            q = [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]];
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
              q = [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])];
            } else {
              const denom = 1 / (va + vb + vc);
              const v = vb * denom;
              const w = vc * denom;
              q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
            }
          }
        }
      }
    }
  }
  const d = sub(p, q);
  return Math.sqrt(dot(d, d));
}

type Gltf = { scenes: { name?: string; nodes: number[]; extras?: unknown }[]; scene?: number; nodes: { name?: string; mesh?: number }[]; meshes: { primitives: { attributes: Record<string, number>; indices: number; material?: number }[] }[]; accessors: { componentType: number; type: string; normalized?: boolean; count: number }[] };
/** The triangles (as corner places) and the attribute names of each piece of a mesh, by its node's name. */
function meshByName(json: Gltf, bin: Buffer, name: string) {
  const node = json.nodes.find((n) => n.name === name);
  if (!node || node.mesh === undefined) return null;
  return json.meshes[node.mesh].primitives.map((p) => {
    const pos = readAccessor(json, bin, p.attributes.POSITION).data as Float32Array;
    const idx = Array.from(readAccessor(json, bin, p.indices).data as ArrayLike<number>);
    return { prim: p, pos, idx };
  });
}

// ---------------------------------------------------------------- the sweep's allocation, in a process of its own
// Asked by the check near the end in twelve fresh processes at once (`--alloc=` the made chain's rows): a level group of
// the made chain and one of the client's beside it, swept as the checks before it sweep them (the made levels' bias moved
// to 2 and back), then 4,000 sweeps, and the least of three windows of 3,000 sweeps no collection fell inside, each after
// 2,000 more and two turns of the event loop (`testing.md`). Measured in the test's own process instead, about one run in
// fifteen opened its one window while the sweep's optimised build was still in flight, the sweep running in baseline code
// that boxes every number it works, and read 620 to 777 B a sweep.
const allocArg = process.argv.find((a) => a.startsWith('--alloc='));
if (allocArg) {
  const chain = JSON.parse(decodeURIComponent(allocArg.slice('--alloc='.length))) as { level: number; near: number; far: number }[];
  const gcNow = (globalThis as { gc?: (o?: unknown) => void }).gc!;
  let collections = 0;
  new PerformanceObserver((l) => (collections += l.getEntries().length)).observe({ entryTypes: ['gc'] });
  const young = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;
  const turn = () => new Promise((res) => setImmediate(res));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  const mat = new THREE.MeshBasicMaterial();
  const levelsOf = (made: boolean) => chain.map((x, k) => ({ near: x.near, far: x.far, level: x.level, primitives: [{ geometry: geo, material: mat, cell: -1 }], ...(made && k > 0 ? { made: true } : {}) }));
  const d = Math.min(chain[1].near * 1.5, (chain[1].near + chain[2].near) / 2);
  const copies = Array.from({ length: 8 }, (_, i) => ({ x: d * Math.cos(i), y: 0, z: d * Math.sin(i), q: new THREE.Quaternion() }));
  const make = (p: { geometry: THREE.BufferGeometry; material: THREE.Material }, n: number) => new THREE.InstancedMesh(p.geometry, p.material, n);
  const madeGroup = new LevelGroup(copies, levelsOf(true), new THREE.Vector3(), 0.5, make, true);
  const clientGroup = new LevelGroup(copies, levelsOf(false), new THREE.Vector3(), 0.5, make, true);
  madeGroup.sweep(0, 0, 0, 1, 1000);
  clientGroup.sweep(0, 0, 0, 1, 1000);
  LOD_LEVEL_TUNE.madeBias = 2;
  madeGroup.sweep(0, 0, 0, 1, 1000);
  clientGroup.sweep(0, 0, 0, 1, 1000);
  LOD_LEVEL_TUNE.madeBias = LOD_LEVEL_DEFAULTS.madeBias;
  madeGroup.sweep(0, 0, 0, 1, 1000);
  let at = 0;
  const sweep = () => {
    madeGroup.sweep(((at * 37) % 61) * 2 - 60, 3, ((at * 53) % 59) * 2 - 60, 1, 30);
    at++;
  };
  for (let i = 0; i < 4000; i++) sweep();
  let best = Number.POSITIVE_INFINITY;
  for (let w = 0; w < 3; w++) {
    for (let tries = 0; tries < 6; tries++) {
      for (let i = 0; i < 2000; i++) sweep();
      gcNow({ type: 'minor' });
      await turn();
      await turn();
      const c0 = collections;
      const before = young();
      for (let i = 0; i < 3000; i++) sweep();
      const grown = young() - before;
      await turn();
      await turn();
      if (collections === c0) {
        best = Math.min(best, grown / 3000);
        break;
      }
    }
  }
  console.log(JSON.stringify({ perSweep: Number.isFinite(best) ? best : null }));
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'swg3js-made-lods-'));
try {
  const pack = join(dir, 'tatooine');
  mkdirSync(pack, { recursive: true });
  // 1. A smooth model in two pieces split along z = 0, the second with vertex colours.
  const domeA = field(40, 20, -6, 6, -6, 0, bump);
  const domeB = field(40, 20, -6, 6, 0, 6, bump, true);
  // 2. A portal building: a smooth shell, and a room the pass must never touch.
  const shell = field(32, 32, -8, 8, -8, 8, (x, z) => 3 + Math.cos(x * 0.2) * Math.cos(z * 0.2));
  const room = field(12, 12, -6, 6, -6, 6, () => 0.1);
  // 3. Rough: heights at random over 3 m, nothing the simplifier can take within the threshold.
  const r = rng(11);
  const rough = field(24, 24, -1.5, 1.5, -1.5, 1.5, () => r() * 1.5);
  // 4. Tiny. 5. One with the client's own levels.
  const tiny = box(0.5);
  const owned = field(20, 20, -4, 4, -4, 4, bump);
  const ownedLow = box(4);
  const glbs: Record<string, Buffer> = {
    'dome.glb': buildGlb([{ name: 'dome', groups: [{ shader: 'shader/a.sht', primitives: [domeA] }, { shader: 'shader/b.sht', primitives: [domeB] }], hardpoints: [] }]),
    'house.glb': buildGlb([
      { name: 'cell:0:shell', groups: [{ shader: 'shader/shell.sht', primitives: [shell] }], hardpoints: [] },
      { name: 'cell:1:room', groups: [{ shader: 'shader/room.sht', primitives: [room] }], hardpoints: [] },
    ]),
    'rough.glb': buildGlb([{ name: 'rough', groups: [{ shader: 'shader/a.sht', primitives: [rough] }], hardpoints: [] }]),
    'tiny.glb': buildGlb([{ name: 'tiny', groups: [{ shader: 'shader/a.sht', primitives: [tiny] }], hardpoints: [] }]),
    'owned.glb': buildGlb([{ name: 'owned', groups: [{ shader: 'shader/a.sht', primitives: [owned] }], hardpoints: [] }], { lods: [{ name: 'lod:2', groups: [{ shader: 'shader/a.sht', primitives: [ownedLow] }], hardpoints: [] }] }),
  };
  for (const [f, b] of Object.entries(glbs)) writeFileSync(join(pack, f), b);
  const tris = (ps: Prim[]) => ps.reduce((a, p) => a + p.indices.length / 3, 0);
  const def = (id: string, prims: Prim[], extra: Record<string, unknown> = {}) => ({ id, source: `appearance/${id}.apt`, file: `${id}.glb`, bounds: boundsOf(prims), triangles: tris(prims), textured: 0, shaders: prims.length, parts: 1, ...extra });
  const ownedRows = [{ level: 0, near: 0, far: 30, tris: tris([owned]), prims: 1 }, { level: 2, near: 30, far: 1000, tris: 12, prims: 1 }];
  const manifest = {
    planet: 'tatooine',
    materialFormat: MATERIAL_FORMAT,
    lodFormat: LOD_FORMAT,
    categories: {
      layout: [
        def('dome', [domeA, domeB]),
        def('house', [shell, room], { cells: [{ index: 0, name: 'shell', bounds: boundsOf([shell]) }, { index: 1, name: 'room', bounds: boundsOf([room]) }], portals: [] }),
        def('rough', [rough]),
        def('tiny', [tiny]),
        def('owned', [owned], { lods: ownedRows }),
      ],
      flora: [],
    },
  };
  writeFileSync(join(pack, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(pack, 'layout.json'), JSON.stringify({ planet: 'tatooine', center: { x: 0, z: 0 }, objects: ['dome', 'house', 'rough', 'tiny', 'owned'].map((m, i) => ({ template: `object/static/shared_${m}.iff`, model: m, x: i * 30, y: 0, z: 0, q: [1, 0, 0, 0], radius: 8 })) }));
  const original = hashAll(dir);

  const lodsAsked = (): { ran: boolean; asked: string[] } => {
    const st = run(['status', dir, '--json']);
    let plan: { steps?: { command: string; reasons: string[] }[] } = {};
    try {
      plan = JSON.parse(st.stdout);
    } catch {
      plan = {};
    }
    const ran = st.status === 0 && Array.isArray(plan.steps) && plan.steps.length > 0;
    return { ran, asked: (plan.steps ?? []).filter((s) => s.command === 'lods').flatMap((s) => s.reasons) };
  };

  // status, before: asked, once, naming the pack.
  let st = lodsAsked();
  ok(st.ran && st.asked.length === 1 && /tatooine's models with no levels of their own have had none made/.test(st.asked[0]), `status asks for lods on a pack never through it (${st.asked.join('; ')})`);

  // A dry run writes nothing.
  const dry = run(['lods', dir, '--dry-run']);
  ok(dry.status === 0 && /a dry run, nothing written/.test(dry.stdout) && JSON.stringify(hashAll(dir)) === JSON.stringify(original), 'a dry run says what it would make and writes nothing');

  // The run.
  const first = run(['lods', dir, '--retail-only']);
  ok(first.status === 0 && /--retail-only changes nothing/.test(first.stdout) && /tatooine: 2 models given/.test(first.stdout), `the command runs over the pack, saying --retail-only changes nothing for it (${first.stdout.split('\n').filter((l) => /tatooine:/.test(l)).join(' ').trim()}; ${first.stderr.trim().slice(0, 300)})`);
  const after = JSON.parse(readFileSync(join(pack, 'manifest.json'), 'utf8'));
  const by = (id: string) => after.categories.layout.find((d: { id: string }) => d.id === id);
  const afterHashes = hashAll(dir);

  // The models with nothing to make, and the one with its own levels: byte for byte.
  for (const f of ['rough.glb', 'tiny.glb', 'owned.glb']) ok(afterHashes[`\\tatooine\\${f}`] === original[`\\tatooine\\${f}`] || afterHashes[`/tatooine/${f}`] === original[`/tatooine/${f}`], `${f} is left byte for byte as it was`);
  ok(!by('rough').lods && !by('tiny').lods && JSON.stringify(by('owned').lods) === JSON.stringify(ownedRows), "and their manifest entries too: no rows for the rough and the tiny ones, the owned one's own rows untouched");
  ok(/no level under 0\.8 of its triangles within 0\.02 of its size/.test(first.stdout) && /under 256 triangles/.test(first.stdout), 'the run says why each was given none');

  // The two-piece model.
  const rows = by('dome').lods as { level: number; near: number; far: number; tris: number; prims: number; made?: boolean; error?: number }[];
  const total = tris([domeA, domeB]);
  ok(Array.isArray(rows) && rows.length === 4 && rows[0].level === 0 && rows[0].near === 0 && rows[0].tris === total && rows[0].prims === 2 && rows.slice(1).every((r, i) => r.made === true && r.level === i + 1), `the smooth model gets three made levels, numbered 1 to 3 after its own (${rows?.map((r) => `${r.level}@${r.near}m ${r.tris}t`).join(' ')})`);
  ok(rows.slice(1).every((r, i) => r.tris <= rows[i].tris * MADE_LOD.keepShare && r.tris > 0) && rows[1].tris <= total * 0.55 && rows[3].tris <= total * 0.2, `each level has at most ${MADE_LOD.keepShare} of the triangles of the one before, about a half, a quarter and an eighth of ${total} (${rows.map((r) => r.tris).join(', ')})`);
  ok(chainContiguous(rows) && rows.slice(1).every((r, i) => r.near > rows[i].near) && rows[3].far === 1e9, 'its ranges start at the eye, are contiguous and rise, and the lowest has no far limit, as the client\'s rows are');
  const scale = 12; // the model's largest side: 12 m across x and z.
  ok(rows.slice(1).every((r) => (r.error ?? Infinity) <= MADE_LOD.maxError * scale), `every level's own error is under ${MADE_LOD.maxError} of the model's size (${rows.slice(1).map((r) => `${((r.error ?? 0) * 100).toFixed(2)} cm`).join(', ')} of ${MADE_LOD.maxError * scale * 100} cm)`);
  // The row's error is kept to a hundredth of a millimetre and its switch to a centimetre, each rounded from the same figure.
  ok(rows.slice(1).every((r) => Math.abs(r.near - switchNear(r.error ?? 0)) <= 0.02), `and each switches in where that error comes to the reference pixel (switchNear: ${rows.slice(1).map((r) => `${r.near} m against ${switchNear(r.error ?? 0).toFixed(3)}`).join(', ')})`);

  const doneGlb = readGlb(readFileSync(join(pack, 'dome.glb')));
  const djson = doneGlb.json as Gltf;
  const ms = madeScene(djson);
  ok(!!ms && djson.scenes.length === 2 && djson.scenes[1].name === LOD_SCENE && (djson.scene ?? 0) === 0, 'the levels are the second scene, `lods`, marked as made; the default scene is still the model');
  const names = ms!.nodes.map((n) => djson.nodes[n].name);
  ok(names.join() === 'lod:1,lod:2,lod:3' && names.every((n, i) => lodLevelOfName(n) === rows[i + 1].level), `each row that draws has its lod:<n> node (${names.join(', ')})`);
  const srcA = meshByName(djson, doneGlb.bin, 'dome')!;
  const fineCorners = new Set<string>();
  for (const piece of srcA) for (let i = 0; i < piece.pos.length; i += 3) fineCorners.add(`${piece.pos[i]},${piece.pos[i + 1]},${piece.pos[i + 2]}`);
  // The border between the two pieces: every corner at z = 0.
  const seam = new Set<string>();
  for (const piece of srcA) for (let i = 0; i < piece.pos.length; i += 3) if (piece.pos[i + 2] === 0) seam.add(`${piece.pos[i]},${piece.pos[i + 1]},${piece.pos[i + 2]}`);
  let badAttrs = 0;
  let moved = 0;
  let seamLost = 0;
  let worst = 0;
  let misplaced = 0;
  let badCount = 0;
  for (let k = 1; k <= 3; k++) {
    const level = meshByName(djson, doneGlb.bin, `lod:${k}`)!;
    let count = 0;
    for (const piece of level) {
      count += piece.idx.length / 3;
      const src = srcA.find((s) => s.prim.material === piece.prim.material)!;
      // Every attribute of its source piece, of the same kind, under the same material and index kind.
      const a = Object.keys(src.prim.attributes).sort().join();
      const b = Object.keys(piece.prim.attributes).sort().join();
      if (a !== b) badAttrs++;
      for (const name of Object.keys(src.prim.attributes)) {
        const x = djson.accessors[src.prim.attributes[name]];
        const y = djson.accessors[piece.prim.attributes[name]];
        if (!y || x.componentType !== y.componentType || x.type !== y.type || !!x.normalized !== !!y.normalized) badAttrs++;
      }
      if (djson.accessors[src.prim.indices].componentType !== djson.accessors[piece.prim.indices].componentType) badAttrs++;
      // No corner moved: each is one of the model's own.
      const corners = new Set<string>();
      for (let i = 0; i < piece.pos.length; i += 3) {
        const key = `${piece.pos[i]},${piece.pos[i + 1]},${piece.pos[i + 2]}`;
        corners.add(key);
        if (!fineCorners.has(key)) moved++;
      }
      // The split kept whole: every corner of the border is still in each piece.
      for (const s of seam) if (!corners.has(s)) seamLost++;
    }
    if (count !== rows[k].tris || level.length !== rows[k].prims) badCount++;
    // The surface: how far each of the model's own corners lies from this level's triangles.
    const triangles: number[][][] = [];
    for (const piece of level) for (let i = 0; i < piece.idx.length; i += 3) triangles.push([0, 1, 2].map((c) => Array.from(piece.pos.subarray(piece.idx[i + c] * 3, piece.idx[i + c] * 3 + 3))));
    for (const piece of srcA) {
      for (let i = 0; i < piece.pos.length; i += 3) {
        const p = [piece.pos[i], piece.pos[i + 1], piece.pos[i + 2]];
        let best = Infinity;
        for (const t of triangles) {
          const d = pointTri(p, t[0], t[1], t[2]);
          if (d < best) best = d;
        }
        if (best > worst) worst = best;
      }
    }
    const fineBox = { min: [-6, 0, -6], max: [6, 2, 6] };
    const lowBox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const piece of level) for (let i = 0; i < piece.pos.length; i += 3) for (let c = 0; c < 3; c++) {
      lowBox.min[c] = Math.min(lowBox.min[c], piece.pos[i + c]);
      lowBox.max[c] = Math.max(lowBox.max[c], piece.pos[i + c]);
    }
    if (!levelInPlace(fineBox, lowBox)) misplaced++;
  }
  ok(badAttrs === 0, 'every piece of every level keeps every attribute of its source piece (positions, normals, coordinates, the colours), of the same kind, under the same material and index kind');
  ok(badCount === 0, "each level's nodes hold the triangles and the pieces its row says");
  ok(moved === 0, 'no corner of any level moved: each is one of the model\'s own');
  ok(seamLost === 0 && seam.size === 41, `the border where the model is split is kept whole at every level, in both pieces (${seam.size} corners, ${seamLost} lost)`);
  ok(worst <= 2 * MADE_LOD.maxError * scale, `measured, every corner of the model lies within ${(worst * 100).toFixed(2)} cm of every level's surface, inside twice the threshold (${2 * MADE_LOD.maxError * scale * 100} cm)`);
  ok(misplaced === 0, 'and every level stands where the finest does');

  // The portal building: levels of its shell, its room untouched.
  const houseRows = by('house').lods;
  const hg = readGlb(readFileSync(join(pack, 'house.glb')));
  const hjson = hg.json as Gltf;
  const roomBefore = readGlb(glbs['house.glb']).json as Gltf;
  ok(Array.isArray(houseRows) && houseRows[0].tris === tris([shell]) && houseRows[0].prims === 1 && houseRows.length >= 2, `a portal building's levels are its shell's: the finest row counts the shell alone (${houseRows?.map((x: { tris: number }) => x.tris).join(', ')})`);
  const shellMat = hjson.meshes[hjson.nodes.find((n) => n.name === 'cell:0:shell')!.mesh!].primitives[0].material;
  ok(madeScene(hjson)!.nodes.every((n) => hjson.meshes[hjson.nodes[n].mesh!].primitives.every((p) => p.material === shellMat)), "every made piece wears the shell's material, none the room's");
  const roomOf = (j: Gltf, b: Buffer) => JSON.stringify(meshByName(j, b, 'cell:1:room')!.map((p) => [Array.from(p.pos), p.idx]));
  ok(roomOf(hjson, hg.bin) === roomOf(roomBefore, readGlb(glbs['house.glb']).bin) && JSON.stringify(hjson.scenes[0]) === JSON.stringify(roomBefore.scenes[0]), 'the room and the default scene are what they were');

  // Put back: the file before the pass, to the byte.
  const back = stripMade(doneGlb.json, doneGlb.bin);
  ok(back.stripped && writeGlb(back.json, back.bin).equals(glbs['dome.glb']), "stripping the made scene gives back the converter's own file, byte for byte");

  // status, after: quiet.
  st = lodsAsked();
  ok(st.ran && st.asked.length === 0 && after.madeLods?.format === MADE_LOD_FORMAT && after.madeLods.key === madeLodsKey(pack, after), `status asks for it no more (the stamp: ${JSON.stringify(after.madeLods)})`);

  // A second run changes no byte.
  const second = run(['lods', dir]);
  ok(second.status === 0 && /2 already/.test(second.stdout) && JSON.stringify(hashAll(dir)) === JSON.stringify(afterHashes), 'a second run changes no byte of the pack');

  // A manifest written again round a kept file (its rows gone): the file put back and made again, to the same bytes.
  const lost = JSON.parse(readFileSync(join(pack, 'manifest.json'), 'utf8'));
  delete lost.categories.layout.find((d: { id: string }) => d.id === 'dome').lods;
  delete lost.madeLods;
  writeFileSync(join(pack, 'manifest.json'), JSON.stringify(lost, null, 2));
  st = lodsAsked();
  ok(st.asked.length === 1, 'a manifest that lost its rows and its stamp is asked for again');
  const third = run(['lods', dir]);
  ok(third.status === 0 && /1 made again/.test(third.stdout) && JSON.stringify(hashAll(dir)) === JSON.stringify(afterHashes), 'the file it lost them round is put back and made again, and the pack comes out as the first run left it, to the byte');

  // A model it looked at changes (written again at another size): asked again, and quiet once run.
  writeFileSync(join(pack, 'rough.glb'), Buffer.concat([readFileSync(join(pack, 'rough.glb')), Buffer.alloc(4)]));
  st = lodsAsked();
  ok(st.asked.length === 1 && /changed since/.test(st.asked[0]), `a model it looked at that changed since is asked about again (${st.asked.join('; ')})`);
  run(['lods', dir]);
  ok(lodsAsked().asked.length === 0, 'and once run, it is quiet');

  // ---------------------------------------------------------------------------------------------
  // The pack read by the game's own loader (`AssetPack`, three's GLTFLoader under it; the network, `self`, the page's progress
  // event and the image decoder stood in, as imports.test.ts stands them in): the made rows reach the model's levels marked
  // `made` (`modelLevels`), so the made levels' bias moves them in play, and a model with the client's own levels has none.
  {
    const SITE = 'http://made-lods.test/';
    const realFetch = globalThis.fetch;
    const g = globalThis as unknown as { self?: unknown; createImageBitmap?: unknown; ProgressEvent?: unknown };
    const hadSelf = 'self' in g;
    const hadProgress = 'ProgressEvent' in g;
    const realBitmap = g.createImageBitmap;
    g.self ??= globalThis;
    g.ProgressEvent ??= class extends Event {
      constructor(type: string, init: Record<string, unknown> = {}) {
        super(type);
        Object.assign(this, init);
      }
    };
    g.createImageBitmap = async () => ({ width: 4, height: 4, close() {} });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      if (url.startsWith('blob:')) return realFetch(input as RequestInfo, init);
      const file = url.startsWith(SITE) ? join(dir, ...url.slice(SITE.length).split('/')) : '';
      if (!file || !existsSync(file)) return new Response('missing', { status: 404, headers: { 'content-type': 'text/plain' } });
      return new Response(readFileSync(file), { status: 200, headers: { 'content-type': file.endsWith('.json') ? 'application/json' : 'model/gltf-binary' } });
    }) as typeof fetch;
    try {
      const loader = await AssetPack.load('tatooine', SITE, { dir: 'tatooine/' });
      const dome = loader ? ((await loader.model('dome')) as LoadedModel | null) : null;
      const own = loader ? ((await loader.model('owned')) as LoadedModel | null) : null;
      const dl = dome?.levels ?? [];
      const madeRows = (JSON.parse(readFileSync(join(pack, 'manifest.json'), 'utf8')).categories.layout.find((x: { id: string }) => x.id === 'dome').lods as { made?: boolean; prims: number }[]);
      ok(dl.length === madeRows.length && dl[0].made === undefined && dl.slice(1).every((l, k) => l.made === true && l.primitives.length === madeRows[k + 1].prims), `the game's pack loader reads the made model's ${dl.length} levels, every made one marked made with its pieces, the finest not (${dl.map((l) => (l.made ? 'made' : 'own')).join(', ')})`);
      ok(!!own?.levels && own.levels.length === 2 && own.levels.every((l) => l.made === undefined), "and the model with the client's own levels reads none marked made");
    } finally {
      globalThis.fetch = realFetch;
      g.createImageBitmap = realBitmap;
      if (!hadSelf) delete g.self;
      if (!hadProgress) delete g.ProgressEvent;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // The game's side.
  // The pick draws every made level (their switches rise), and the made levels' own bias moves only theirs.
  ok(drawnLevels(rows.map((x) => x.near)).length === rows.length, "the game's pick can draw every made level");
  const out = new Float32Array(4);
  chainNears(rows, 2, out);
  const client = new Float32Array(2);
  chainNears(ownedRows, 2, client);
  ok(Array.from(out).every((v, i) => Math.abs(v - Math.fround(rows[i].near * 2)) < 1e-6) && client[1] === 30, 'the made levels\' bias doubles a made chain\'s switches and leaves the client\'s own where they were');
  // A level group of each kind, copies standing between the first made switch and twice it.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  const mat = new THREE.MeshBasicMaterial();
  const levelsOf = (src: typeof rows, made: boolean) => src.map((x, k) => ({ near: x.near, far: x.far, level: x.level, primitives: [{ geometry: geo, material: mat, cell: -1 }], ...(made && k > 0 ? { made: true } : {}) }));
  const n1 = rows[1].near;
  const n2 = rows[2].near;
  const d = Math.min(n1 * 1.5, (n1 + n2) / 2) * 1;
  const copies = Array.from({ length: 8 }, (_, i) => ({ x: d * Math.cos(i), y: 0, z: d * Math.sin(i), q: new THREE.Quaternion() }));
  const make = (p: { geometry: THREE.BufferGeometry; material: THREE.Material }, n: number) => new THREE.InstancedMesh(p.geometry, p.material, n);
  const madeGroup = new LevelGroup(copies, levelsOf(rows, true), new THREE.Vector3(), 0.5, make, true);
  const clientGroup = new LevelGroup(copies, levelsOf(rows, false), new THREE.Vector3(), 0.5, make, true);
  madeGroup.sweep(0, 0, 0, 1, 1000);
  clientGroup.sweep(0, 0, 0, 1, 1000);
  const atLevel = (g: LevelGroup, k: number) => Array.from(g.level).every((l) => l === k);
  const madeAt1 = atLevel(madeGroup, levelOf(d, rows.map((x) => x.near), 4, 1, LOD_LEVEL_TUNE.hysteresis, -1));
  LOD_LEVEL_TUNE.madeBias = 2;
  madeGroup.sweep(0, 0, 0, 1, 1000);
  clientGroup.sweep(0, 0, 0, 1, 1000);
  const madeAtBias = atLevel(madeGroup, 0);
  const clientStayed = atLevel(clientGroup, levelOf(d, rows.map((x) => x.near), 4, 1, LOD_LEVEL_TUNE.hysteresis, -1));
  LOD_LEVEL_TUNE.madeBias = LOD_LEVEL_DEFAULTS.madeBias;
  madeGroup.sweep(0, 0, 0, 1, 1000);
  ok(madeAt1 && madeAtBias && clientStayed && atLevel(madeGroup, levelOf(d, rows.map((x) => x.near), 4, 1, LOD_LEVEL_TUNE.hysteresis, -1)), `copies ${d.toFixed(1)} m off stand at the made level their distance picks, go to the finest once the made levels' bias is 2 (the next sweep, with the eye where it was), and come back at 1; a group of the client's own levels at the same distances never moves with it`);
  // The flora field the same way: a made plant and one of the client's own, planted at one distance.
  {
    const nears = [0, 5, 10];
    const plant = (made: boolean, name: string) => {
      const primitives = [{ geometry: geo, material: mat, cell: -1 }];
      const levels = nears.map((near, k) => ({ near, far: k < 2 ? nears[k + 1] : 1e9, level: k, primitives, ...(made && k > 0 ? { made: true } : {}) }));
      return { def: { id: name, file: '', bounds: { min: [-1, 0, -1], max: [1, 2, 1] }, triangles: 12 }, scene: new THREE.Group(), primitives, radius: 1, height: 2, interiorBoxes: [], bounds: new THREE.Box3(), portals: [], levels };
    };
    const models = [plant(true, 'made'), plant(false, 'own')];
    const n = 2;
    const mats = new Float32Array(n * 16);
    for (let i = 0; i < n; i++) new THREE.Matrix4().makeTranslation(7, 0, i).toArray(mats, i * 16);
    const data = { n, models, mats, x: Float32Array.of(7, 7), y: new Float32Array(n), z: Float32Array.of(0, 1), scale: Float32Array.of(1, 1), collidable: new Uint8Array(n) };
    const { FloraField } = await import('../../../src/world/floraBatch.ts');
    const field = new FloraField(new THREE.Group(), () => {});
    field.add('c', 0, 0, data as unknown as Parameters<typeof field.add>[3], { group: { visible: true }, trees: { visible: true }, plants: { visible: true } });
    field.sweep(0, 0, 0, 1);
    const at1 = Array.from(field.levelsOfChunk('c')!).join();
    LOD_LEVEL_TUNE.madeBias = 2;
    field.sweep(0, 0, 0, 1);
    const at2 = Array.from(field.levelsOfChunk('c')!).join();
    LOD_LEVEL_TUNE.madeBias = LOD_LEVEL_DEFAULTS.madeBias;
    field.sweep(0, 0, 0, 1);
    const back = Array.from(field.levelsOfChunk('c')!).join();
    field.dispose();
    ok(at1 === '1,1' && at2 === '0,1' && back === '1,1', `a made plant 7 m off stands at its made level, at its finest once the made levels' bias is 2 and back at 1, while the client's own plant beside it stays (${at1} | ${at2} | ${back})`);
  }
  // The sweep with a made chain allocates nothing: twelve fresh processes at once, each handed this chain's rows (the
  // child at the top of this file).
  {
    const me = fileURLToPath(import.meta.url);
    const arg = `--alloc=${encodeURIComponent(JSON.stringify(rows.map((x) => ({ level: x.level, near: x.near, far: x.far }))))}`;
    const answers = await Promise.all(
      Array.from({ length: 12 }, () =>
        new Promise<string>((done) => {
          const ch = spawn(process.execPath, ['--expose-gc', me, arg], { stdio: ['ignore', 'pipe', 'pipe'], env });
          let said = '';
          let err = '';
          ch.stdout.on('data', (b) => (said += b));
          ch.stderr.on('data', (b) => (err += b));
          ch.on('close', () => done(said.trim().split('\n').pop() || `no answer: ${err.slice(0, 300)}`));
        }),
      ),
    );
    const per = answers.map((s) => {
      try {
        return (JSON.parse(s) as { perSweep: number | null }).perSweep;
      } catch {
        return undefined;
      }
    });
    const words = per.map((x, k) => (x === undefined ? `no answer (${answers[k].slice(0, 160)})` : x === null ? 'no clean window' : `${x.toFixed(2)} B`)).join(', ');
    ok(per.every((x) => typeof x === 'number' && x < 16), `3,000 sweeps of a made chain allocate nothing in 12 of 12 fresh processes, each the least of three clean windows (${words} a sweep)`);
  }

  // The dials: the made levels' switch joins the detail levels' own, set through the console helper handed in.
  const dial = LOD_DIALS.groups.flatMap((g) => g.dials).find((x) => x.key === 'tune.madeBias');
  ok(LOD_DIALS.helper === 'lod' && !!dial && LOD_DIALS.groups.flatMap((g) => g.dials).some((x) => x.key === 'tune.bias') && LOD_DIALS.shipped.get('tune.madeBias') === 1, "the debug menu's `lod` dials hold the made levels' switch beside every level's, shipped at 1");
  const handed: unknown[] = [];
  lodDialsFor('lod', (t) => handed.push(t));
  if (dial && dial.kind === 'number') dial.set(1.5);
  ok(JSON.stringify(handed) === '[{"madeBias":1.5}]' && LOD_LEVEL_TUNE.madeBias === 1, 'a dial is set through `__debug.lod({ tune })` itself, which the menu hands in');
  LOD_LEVEL_TUNE.madeBias = 1.5;
  ok(movedArgs(LOD_DIALS).includes('madeBias'), `and what moved is copied out as that helper's own line (${movedArgs(LOD_DIALS)})`);
  LOD_LEVEL_TUNE.madeBias = LOD_LEVEL_DEFAULTS.madeBias;
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${checks} checks passed`);
