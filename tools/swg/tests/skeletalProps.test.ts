// The skeletal props (cli.mjs `convertSat`'s `bake`, skeletal.mjs `bakePose`, props.mjs `PROPS_SKELETAL_FORMAT`): a
// template whose appearance is a skeleton's is stood still and written as an ordinary prop's model.
//
// `bakePose` is run on a skeleton and a mesh made here: the bind pose moves nothing, a pose carries each vertex and
// normal by its weighted joint, the joints, weights and blend targets are dropped, the whole is set down on its lowest
// point and its box is mirrored as the converter's boxes are; the model `buildGlb` writes of it carries no skin, no
// joints and no weights, which is what makes the streamer stand, cast and cull it as any other prop and build nothing
// for it in play.
//
// Then the props command itself is run as a child over a miniature install written here (a skeleton, a skinned mesh,
// an animation table whose idle turns the upper joint, the `.sat` that names them, and a static `.apt` over a mesh of
// the very same stem), the two stood as props of ours through the table hook (`SWG3JS_OURS`): with no pose named the
// skeletal one stands at its idle's first frame, read off its GLB's own positions; with `--skeletal-pose=bind` at its
// bind pose, which the manifest keeps and a later run naming no pose takes; and the static one keeps a model of its own
// rather than wearing the skeleton stood still (a family drops the extension, which once made the Hoth AT-ST display
// wear the walker).
//
// Then, on a props pack on disk converted with the skeletal props (`SWG3JS_PACKS`, else assets-private), every skeletal
// model is held to the same: no skin in its GLB, its own positions standing on their lowest point, worn by props, a
// `.sat`'s model always marked skeletal and no other, and some standing at their idle unless the pack was converted at
// the bind pose; a pack converted before is a note.
//
// Run: node tools/swg/tests/skeletalProps.test.ts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bakePose } from '../skeletal.mjs';
import { buildGlb } from '../glb.mjs';
import { PROPS_SKELETAL_FORMAT } from '../props.mjs';
import { readGlb } from '../glbclips.mjs';
import { chunk, encode, form, W } from './iffWriter.ts';
import { writeToc, writeTre } from './tocWriter.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const near = (a: number, b: number, e = 1e-5) => Math.abs(a - b) <= e;

// Two joints: a root at the origin and a child one metre up, both unturned in their bind.
const I = [1, 0, 0, 0];
const skeleton = { joints: [{ name: 'root', parent: -1, pre: I, post: I, bindR: I, bindT: [0, 0, 0] }, { name: 'child', parent: 0, pre: I, post: I, bindR: I, bindT: [0, 1, 0] }] };
// Vertex 0 on the root, half a metre up; vertex 1 on the child, a metre out along x from it; vertex 2 shared half and half.
const prim = () => ({
  positions: new Float32Array([0, 0.5, 0, 1, 1, 0, 1, 1, 0]),
  normals: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]),
  uvs: new Float32Array([0, 0, 1, 0, 1, 1]),
  indices: new Uint32Array([0, 1, 2]),
  joints: new Uint16Array([0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]),
  weights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0]),
  targets: [{ name: 'test_blend', positions: new Float32Array(9), normals: null }],
});
const meshes = () => [{ name: 'test_mesh', groups: [{ shader: 'shader/test.sht', primitives: [prim()] }], blendTargets: [] }];

{
  const b = bakePose(meshes(), skeleton, null);
  const p = b.meshes[0].groups[0].primitives[0];
  ok(near(b.lift, -0.5) && near(p.positions[1], 0) && near(p.positions[4], 0.5) && near(p.positions[3], 1), `the bind pose moves nothing but the set-down on the lowest point (lift ${b.lift})`);
  ok(!('joints' in p) && !('weights' in p) && !('targets' in p) && p.uvs && p.indices.length === 3, 'the joints, weights and blend targets are dropped; the coordinates and triangles kept');
  ok(near(b.bounds!.min[0], -1) && near(b.bounds!.max[0], 0) && near(b.bounds!.min[1], 0) && near(b.bounds!.max[1], 0.5), `its box is mirrored across x as the converter's are, and stands on nought (${JSON.stringify(b.bounds)})`);
}
{
  // The child turned a quarter about z: its vertex a metre out along x goes a metre up from the child joint.
  const s = Math.SQRT1_2;
  const pose = [{ rotation: I, translation: [0, 0, 0] }, { rotation: [s, 0, 0, s], translation: [0, 1, 0] }];
  const b = bakePose(meshes(), skeleton, pose);
  const p = b.meshes[0].groups[0].primitives[0];
  // Before the set-down: vertex 0 (0, 0.5, 0), vertex 1 (0, 2, 0), vertex 2 half of each pose of (1, 1, 0): ((1 + 0)/2, (1 + 2)/2, 0).
  ok(near(b.lift, -0.5) && near(p.positions[0], 0) && near(p.positions[1], 0) && near(p.positions[3], 0, 1e-5) && near(p.positions[4], 1.5) && near(p.positions[6], 0.5) && near(p.positions[7], 1), `a pose carries each vertex by its weighted joints (${[...p.positions].map((v) => v.toFixed(3)).join(' ')})`);
  ok(near(p.normals![3], 0, 1e-5) && near(p.normals![4], 1) && near(p.normals![0], 1) && near(Math.hypot(p.normals![6], p.normals![7], p.normals![8]), 1), 'and each normal by the same joints, kept of unit length');
}
{
  const b = bakePose(meshes(), skeleton, null);
  const glb = buildGlb(b.meshes, { flipX: true, textures: new Map() });
  const len = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + len).toString('utf8'));
  const attrs = json.meshes.flatMap((m: { primitives: { attributes: Record<string, number>; targets?: unknown }[] }) => m.primitives.map((pr) => pr.attributes));
  ok(!json.skins && !json.animations && attrs.every((a: Record<string, number>) => a.POSITION !== undefined && a.JOINTS_0 === undefined && a.WEIGHTS_0 === undefined), 'the model written of it carries no skin, no joints, no weights and no clips: an ordinary prop, which nothing compiles for in play');
}

// ---------------------------------------------------------------------------------------------------------
// A model's drawn extent, off its GLB's own POSITION accessors (min and max, as written: X already mirrored), and
// whether it carries a skin; never off the manifest's bounds, which `bakePose` itself wrote.
type GlbJson = { skins?: unknown; meshes?: { primitives: { attributes: Record<string, number> }[] }[]; accessors: { min?: number[]; max?: number[] }[] };
function drawnExtent(file: string): { min: number[]; max: number[]; skinned: boolean } | null {
  const { json } = readGlb(readFileSync(file)) as { json: GlbJson };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let skinned = !!json.skins;
  for (const m of json.meshes ?? []) {
    for (const p of m.primitives) {
      if (p.attributes.JOINTS_0 !== undefined || p.attributes.WEIGHTS_0 !== undefined) skinned = true;
      const a = json.accessors[p.attributes.POSITION];
      if (!a?.min || !a?.max) continue;
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], a.min[k]);
        max[k] = Math.max(max[k], a.max[k]);
      }
    }
  }
  return Number.isFinite(min[1]) ? { min, max, skinned } : null;
}

// ---------------------------------------------------------------------------------------------------------
// The props command over a miniature install. Two joints, `root` at the origin and `child` a metre up; a quad whose
// lower edge rides the root half a metre up and whose upper edge rides the child two metres up; an idle whose one frame
// turns the child a quarter about X, which folds the upper edge forward a metre and down to a metre up. Set on its
// lowest point, the idle stands half a metre tall and a metre deep, the bind pose a metre and a half tall and flat.
{
  const q = (w: number, x: number, y: number, z: number) => new W().f32(w).f32(x).f32(y).f32(z);
  const bytes = (n: ReturnType<typeof form>) => Buffer.from(encode(n));
  const twoQ = (a: number[], b: number[]) => new Uint8Array([...q(a[0], a[1], a[2], a[3]).bytes(), ...q(b[0], b[1], b[2], b[3]).bytes()]);
  const I = [1, 0, 0, 0];
  const skeleton = form('SKTM', form('0002',
    chunk('INFO', new W().i32(2).bytes()),
    chunk('NAME', new W().str('root').str('child').bytes()),
    chunk('PRNT', new W().i32(-1).i32(0).bytes()),
    chunk('RPRE', twoQ(I, I)),
    chunk('RPST', twoQ(I, I)),
    chunk('BPTR', new W().f32(0).f32(0).f32(0).f32(0).f32(1).f32(0).bytes()),
    chunk('BPRO', twoQ(I, I)),
    chunk('JROR', new W().u32(0).u32(0).bytes())));
  const mesh = form('SKMG', form('0004',
    chunk('INFO', new W().i32(1).i32(2).i32(1).i32(2).i32(4).i32(4).i32(1).i32(1).i32(0).i16(0).i16(0).i16(0).i16(0).bytes()),
    chunk('SKTM', new W().str('appearance/skeleton/test_statue.skt').bytes()),
    chunk('XFNM', new W().str('root').str('child').bytes()),
    chunk('POSN', new W().f32(-1).f32(0.5).f32(0).f32(1).f32(0.5).f32(0).f32(1).f32(2).f32(0).f32(-1).f32(2).f32(0).bytes()),
    chunk('TWHD', new W().i32(1).i32(1).i32(1).i32(1).bytes()),
    chunk('TWDT', new W().i32(0).f32(1).i32(0).f32(1).i32(1).f32(1).i32(1).f32(1).bytes()),
    chunk('NORM', new W().f32(0).f32(0).f32(1).bytes()),
    form('PSDT',
      chunk('NAME', new W().str('shader/test_statue.sht').bytes()),
      chunk('PIDX', new W().i32(4).i32(0).i32(1).i32(2).i32(3).bytes()),
      chunk('NIDX', new W().i32(0).i32(0).i32(0).i32(0).bytes()),
      form('PRIM', chunk('INFO', new W().i32(1).bytes()), chunk('ITL ', new W().i32(2).i32(0).i32(1).i32(2).i32(0).i32(2).i32(3).bytes())))));
  const s = Math.SQRT1_2;
  const idle = form('KFAT', form('0003',
    chunk('INFO', new W().f32(30).i32(2).i32(2).bytes()),
    form('XFRM',
      chunk('XFIN', new W().str('root').i8(0).i32(0).u32(0).i32(0).i32(0).i32(0).bytes()),
      chunk('XFIN', new W().str('child').i8(0).i32(1).u32(0).i32(0).i32(0).i32(0).bytes())),
    chunk('SROT', twoQ(I, [s, s, 0, 0])),
    chunk('STRN', new W().f32(0).bytes())));
  const table = form('LATT', form('0001',
    chunk('INFO', new W().str('appearance/ash/test_statue.ash').i16(1).bytes()),
    form('ANIM', chunk('INFO', new W().str('idle').bytes()), form('PXAT', form('0000', chunk('INFO', new W().str('appearance/animation/test_statue_idle.ans').bytes()))))));
  const sat = form('SMAT', form('0003',
    chunk('INFO', new W().i32(1).i32(1).i32(0).bytes()),
    chunk('MSGN', new W().str('appearance/mesh/test_statue.mgn').bytes()),
    chunk('SKTI', new W().str('appearance/skeleton/test_statue.skt').str('').bytes()),
    chunk('LATX', new W().i16(1).str('appearance/skeleton/test_statue.skt').str('appearance/lat/test_statue.lat').bytes())));
  // A static mesh of the same stem (`test_statue`), a triangle a metre across, behind an `.apt` of another name.
  const vtx = Buffer.alloc(3 * 32);
  [[0, 0, 0], [1, 0, 0], [0, 1, 0]].forEach((p, i) => {
    const o = i * 32;
    vtx.writeFloatLE(p[0], o);
    vtx.writeFloatLE(p[1], o + 4);
    vtx.writeFloatLE(p[2], o + 8);
    vtx.writeFloatLE(1, o + 20);
    vtx.writeFloatLE(p[0], o + 24);
    vtx.writeFloatLE(p[1], o + 28);
  });
  const vinfo = Buffer.alloc(8);
  vinfo.writeUInt32LE(1 | 4 | (1 << 8) | (1 << 12), 0);
  vinfo.writeInt32LE(3, 4);
  const pinfo = Buffer.alloc(6);
  pinfo.writeInt32LE(9, 0);
  pinfo[4] = 1;
  const indx = Buffer.alloc(10);
  indx.writeInt32LE(3, 0);
  for (let i = 0; i < 3; i++) indx.writeUInt16LE(i, 4 + i * 2);
  const staticMesh = form('MESH', form('0005', form('SPS ', form('0001',
    chunk('CNT ', new W().i32(1).bytes()),
    form('0001', chunk('NAME', new W().str('shader/test_statue_still.sht').bytes()), chunk('INFO', new W().i32(1).bytes()),
      form('0001', chunk('INFO', new Uint8Array(pinfo)), form('VTXA', form('0003', chunk('INFO', new Uint8Array(vinfo)), chunk('DATA', new Uint8Array(vtx)))), chunk('INDX', new Uint8Array(indx))))))));
  const apt = form('APT ', form('0000', chunk('NAME', new W().str('appearance/mesh/test_statue.msh').bytes())));
  const files: [string, Buffer][] = [
    ['appearance/skeleton/test_statue.skt', bytes(skeleton)],
    ['appearance/mesh/test_statue.mgn', bytes(mesh)],
    ['appearance/animation/test_statue_idle.ans', bytes(idle)],
    ['appearance/lat/test_statue.lat', bytes(table)],
    ['appearance/test_statue.sat', bytes(sat)],
    ['appearance/mesh/test_statue.msh', bytes(staticMesh)],
    ['appearance/test_statue_apt.apt', bytes(apt)],
  ];
  const root = mkdtempSync(join(tmpdir(), 'swg3js-skeletal-props-'));
  try {
    const install = join(root, 'install');
    const out = join(root, 'out');
    mkdirSync(install, { recursive: true });
    const placed = writeTre(join(install, 'test_props_00.tre'), files.map(([, b]) => ({ bytes: b })));
    writeToc(join(install, 'sku0_client.toc'), ['test_props_00.tre'], files.map(([name], i) => ({ name, tree: 0, ...placed[i] })));
    const tableFile = join(root, 'test_ours.json');
    writeFileSync(tableFile, JSON.stringify({ format: 1, note: 'TEST', rows: [
      { appearance: 'appearance/test_statue.sat', menu: 'props', name: 'TEST statue' },
      { appearance: 'appearance/test_statue_apt.apt', menu: 'props', name: 'TEST statue base' },
    ] }));
    type Manifest = { skeletalFormat?: number; skeletalPose?: string; models: { id: string; file: string; appearance: string; skeletal?: string }[]; props: { id: string; model: string; ours?: boolean }[]; skipped: { why: string }[] };
    const props = (...flags: string[]) => {
      const run = spawnSync(process.execPath, [fileURLToPath(new URL('../cli.mjs', import.meta.url)), 'props', install, out, '--no-icons', ...flags], { encoding: 'utf8', maxBuffer: 64 * 1048576, env: { ...process.env, SWG: '', SWG3JS_OURS: tableFile } });
      const file = join(out, 'props', 'manifest.json');
      if (run.status !== 0 || !existsSync(file)) console.log(run.stdout, run.stderr);
      return { m: JSON.parse(readFileSync(file, 'utf8')) as Manifest, said: run.stdout };
    };
    const still = (m: Manifest) => m.models.find((x) => x.appearance === 'appearance/test_statue.sat');
    const plain = (m: Manifest) => m.models.find((x) => x.appearance === 'appearance/mesh/test_statue.msh');
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;

    const first = props();
    const sm = still(first.m);
    const pm = plain(first.m);
    ok(!!sm && sm.skeletal === 'idle' && first.m.skeletalPose === 'idle' && (first.m.skeletalFormat ?? 0) >= PROPS_SKELETAL_FORMAT && !first.m.skipped.some((x) => /skeletal/.test(x.why)), `the props command stands a skeletal appearance as a prop of its own, at its idle's first frame where its table has one, and says so in the manifest (${sm ? `${sm.id}: ${sm.skeletal}` : 'none'}; ${first.m.skipped.map((x) => x.why).join('; ') || 'nothing left out'})`);
    ok(!!sm && !!pm && sm.id !== pm.id && !pm.skeletal && first.m.props.find((p) => p.id === 'ours_test_statue')?.model === sm.id && first.m.props.find((p) => p.id === 'ours_test_statue_apt')?.model === pm.id, `a skeletal model and a static one of the same stem are two models, each prop wearing its own (${sm?.id}, ${pm?.id})`);
    const idleDrawn = sm ? drawnExtent(join(out, 'props', sm.file)) : null;
    ok(!!idleDrawn && !idleDrawn.skinned && near(idleDrawn.min[1], 0) && near(idleDrawn.max[1], 0.5) && near(Math.abs(idleDrawn.max[2] - idleDrawn.min[2]), 1), `its model has no skin and stands, by its own positions, in the idle's fold: on nought, half a metre tall, a metre deep (${idleDrawn ? `${idleDrawn.min.map((v) => v.toFixed(3)).join(',')} to ${idleDrawn.max.map((v) => v.toFixed(3)).join(',')}` : 'no positions'})`);

    const bind = props('--skeletal-pose=bind');
    const bindDrawn = still(bind.m) ? drawnExtent(join(out, 'props', still(bind.m)!.file)) : null;
    ok(still(bind.m)?.skeletal === 'bind' && bind.m.skeletalPose === 'bind' && !!bindDrawn && near(bindDrawn.min[1], 0) && near(bindDrawn.max[1], 1.5) && near(bindDrawn.max[2] - bindDrawn.min[2], 0), `--skeletal-pose=bind stands it at its bind pose, flat and a metre and a half tall, and the manifest says so (${bindDrawn ? `${bindDrawn.max[1].toFixed(3)} tall, ${(bindDrawn.max[2] - bindDrawn.min[2]).toFixed(3)} deep` : 'no positions'})`);
    const kept = props();
    ok(still(kept.m)?.skeletal === 'bind' && kept.m.skeletalPose === 'bind' && /kept from the last run/.test(kept.said), 'a later run that names no pose keeps the bind pose the pack was last converted at, and says so');
    const back = props('--skeletal-pose=idle');
    ok(still(back.m)?.skeletal === 'idle' && back.m.skeletalPose === 'idle', '--skeletal-pose=idle puts its own idle back');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------------
// The props pack on disk.
const packs = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private/', import.meta.url));
const manifestFile = join(packs, 'props', 'manifest.json');
if (!existsSync(manifestFile)) console.log(`note: no props pack at ${manifestFile}; the pack checks are skipped`);
else {
  const m = JSON.parse(readFileSync(manifestFile, 'utf8')) as { skeletalFormat?: number; skeletalPose?: string; models: { id: string; file: string; appearance?: string; skeletal?: string; bounds?: { min: number[]; max: number[] } }[]; props: { model: string; template: string | null }[]; skipped: { why: string }[] };
  if ((m.skeletalFormat ?? 0) < PROPS_SKELETAL_FORMAT) console.log('note: the props pack was converted before the skeletal props; its pack checks are skipped (status asks for it)');
  else {
    const still = m.models.filter((x) => x.skeletal);
    const idles = still.filter((x) => x.skeletal === 'idle').length;
    ok(still.length > 0 && !m.skipped.some((s) => s.why === 'skeletal appearance'), `a pack converted with the skeletal props stands them still (${still.length} models: ${idles} at their idle's first frame, ${still.length - idles} at the bind pose) and leaves none out for being skeletal`);
    // At their idle unless the pack was converted at the bind pose: a run that stood every one at its bind pose by
    // mistake would pass every other check here.
    ok(m.skeletalPose === 'bind' ? idles === 0 : idles > 0, `the pose the pack says it was converted at is the one its models stand in (${m.skeletalPose ?? 'idle'}: ${idles} at an idle)`);
    const worn = new Set(m.props.map((p) => p.model));
    ok(still.every((x) => worn.has(x.id)), 'every skeletal model is worn by a prop');
    // One model one source kind: a `.sat`'s model is always a skeleton stood still, and no other model is.
    const mixed = m.models.filter((x) => /\.sat$/i.test(x.appearance ?? '') !== !!x.skeletal).map((x) => `${x.id} (${x.appearance})`);
    ok(!mixed.length, `a skeleton's model is marked skeletal and nothing else is, so no static prop wears a skeleton stood still (${mixed.slice(0, 5).join(', ') || 'none'})`);
    const skinned: string[] = [];
    const floating: string[] = [];
    const lost: string[] = [];
    for (const x of still) {
      const f = join(packs, 'props', x.file);
      if (!existsSync(f)) {
        lost.push(x.id);
        continue;
      }
      const drawn = drawnExtent(f);
      if (!drawn || drawn.skinned) skinned.push(x.id);
      else if (Math.abs(drawn.min[1]) > 0.01) floating.push(`${x.id} ${drawn.min[1].toFixed(3)}`);
    }
    ok(!lost.length, `every skeletal model the manifest names is on disk (${lost.slice(0, 5).join(', ') || 'all'})`);
    ok(!skinned.length, `no skeletal prop's model carries a skin or joints (${skinned.slice(0, 5).join(', ') || 'none'})`);
    ok(!floating.length, `every one stands on its lowest point, by its own positions (${floating.slice(0, 5).join(', ') || 'all'})`);
  }
}

console.log(`\n${passed} checks passed`);
