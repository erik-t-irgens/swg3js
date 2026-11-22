// A space zone's distant particle systems (the GPU port's pass 2, wave 3: Kessel's Maw), the converter's reader and the game's
// reading of what it writes:
//  1. `parseSpaceDistant` reads every DIST form of a terrain file laid out as the client's are (the path, six floats, a byte),
//     the place, the turn and whether it rides with the camera, and leaves out a chunk too short to hold them;
//  2. `distantBasis` is a turn (orthonormal, no mirror left in it), the X mirror of the client's object turn, and its forward is
//     where `sunDirection` puts a yaw and a pitch (the frame convention the file's celestials and lights are already drawn by);
//  3. `distantEntry` writes the place mirrored in X, the kind and the reach; `spaceZoneStatus` asks again for a pack without
//     the list (in `space.test.ts`);
//  4. the game's own reading (`src/space/distant.ts`): which systems are placed, the pull that keeps a riding one's angle, its
//     matrix a frame (riding with the eye or standing), and the set's build, frame, retune and dispose through stand-in effects;
//  5. where converted packs stand (`SWG3JS_SPACE_PACKS`, else `assets-private/`), Kessel's and Kashyyyk's packs read through the
//     same code: Kessel's three black holes placed and pulled out at their angles, Kashyyyk's asteroid standing at its place.
//
// Run: node tools/swg/tests/spaceDistant.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { distantBasis, distantEntry, distantKind, parseSpaceDistant } from '../space.mjs';
import { parseIff } from '../iff.mjs';
import { chunk, encode, form, W } from './iffWriter.ts';
import { DISTANT_TUNE, DistantSet, distantMatrixInto, distantPlan, pullOf, type DistantDeps } from '../../../src/space/distant.ts';
import { sunDirection } from '../../../src/space/suns.ts';
import type { DistantSystem } from '../../../src/space/spaceData.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
let checks = 0;
const ok = (cond: unknown, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, e = 1e-5): boolean => Math.abs(a - b) <= e;

// ---------------------------------------------------------------- 1. the reader
const dist = (path: string, f: number[], byte: number, extra: number[] = []) => {
  const w = new W().str(path);
  for (const v of f) w.f32(v);
  w.u8(byte);
  for (const b of extra) w.u8(b);
  return form('DIST', chunk('0000', w.bytes()));
};
const trn = form(
  'STAT',
  form(
    '0000',
    form('CLEA', chunk('0000', new W().f32(0).f32(0).f32(0.3).bytes())),
    form('PLAN', chunk('0000', new W().str('appearance/planet_test.pln').f32(1).f32(2).f32(3).bytes())),
    dist('appearance/pt_blackhole_03.prt', [0, 0, -200, 0, -70, -25], 1),
    dist('appearance\\pt_test_asteroid.prt', [200, 50, 375, -60, 0, 0], 0),
    dist('appearance/pt_starfield_02.prt', [1200, 0, -1200, 0, 0, 0], 1),
    // Too short to hold the six floats and the byte: left out.
    form('DIST', chunk('0000', new W().str('appearance/pt_short.prt').f32(1).f32(2).bytes())),
  ),
);
const read = parseSpaceDistant(parseIff(Buffer.from(encode(trn))));
ok(read.length === 3, `every DIST with its six floats and its byte is read, a short one left out (${read.length})`);
ok(read[0].appearance === 'appearance/pt_blackhole_03.prt' && read[0].at.join(',') === '0,0,-200' && near(read[0].yaw, 0) && near(read[0].pitch, -70) && near(read[0].roll, -25) && read[0].infinite === true, 'the path, the place, the yaw, pitch and roll, and the byte that says it rides with the camera');
ok(read[1].appearance === 'appearance/pt_test_asteroid.prt' && read[1].infinite === false && read[1].at.join(',') === '200,50,375', "a path's slashes are turned, and a byte of nought stands it in the world");

// ---------------------------------------------------------------- 2. the turn
const M = (b: number[]): THREE.Matrix3 => new THREE.Matrix3().set(b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8]);
ok(distantBasis(0, 0, 0).join(',') === '1,0,0,0,1,0,0,0,1', 'no turn is the identity');
let worstOrtho = 0;
let worstSun = 0;
let det = 1;
for (const [y, p, r] of [[0, -70, -25], [0, 0, 50], [0, -90, 25], [-45, 0, 0], [0, 90, 0], [90, 0, 0], [-60, 0, 0], [33, 17, -71], [170, -40, 12]]) {
  const b = distantBasis(y, p, r);
  const m = M(b);
  const t = m.clone().transpose().multiply(m).elements;
  for (let i = 0; i < 9; i++) worstOrtho = Math.max(worstOrtho, Math.abs(t[i] - (i % 4 === 0 ? 1 : 0)));
  det = Math.min(det, m.determinant());
  // The forward (third column) is where a yaw then a pitch put the turned frame's forward: minus `sunDirection`, which gives the
  // way toward a light shining down that forward, in the game's axes.
  const s = sunDirection(y, p);
  worstSun = Math.max(worstSun, Math.abs(b[2] + s.x), Math.abs(b[5] + s.y), Math.abs(b[8] + s.z));
}
ok(worstOrtho < 1e-5 && det > 0.99999, `every turn is a rotation: orthonormal to ${worstOrtho.toExponential(1)}, determinant ${det.toFixed(6)} (no mirror left in it)`);
ok(worstSun < 1e-5, `its forward is where the celestials' and lights' own convention puts a yaw and a pitch (within ${worstSun.toExponential(1)})`);
// A yaw of 90 turns the client's forward (+Z) to the client's +X, which is the game's -X.
const y90 = distantBasis(90, 0, 0);
ok(near(y90[2], -1) && near(y90[5], 0) && near(y90[8], 0), 'a yaw of 90 turns the forward onto the game\'s -X (the client\'s +X, mirrored)');
// The roll turns about the forward and leaves it where it was.
const rolled = distantBasis(0, 0, 50);
ok(near(rolled[2], 0) && near(rolled[5], 0) && near(rolled[8], 1) && !near(rolled[0], 1), 'a roll turns about the forward and leaves it');

// ---------------------------------------------------------------- 3. the entry
const e0 = distantEntry(read[0], 'particles/fx_pt_blackhole_03.json', 75);
const e1 = distantEntry(read[1], 'particles/fx_pt_test_asteroid.json', 570.004);
const e2 = distantEntry(read[2], null, null);
ok(e0.at.join(',') === '0,0,-200' && e1.at.join(',') === '-200,50,375' && Object.is(e0.at[0], 0), "the place is mirrored in X into the game's frame (a nought stays a plain nought)");
ok(e0.kind === 'feature' && e2.kind === 'starfield' && distantKind('appearance/pt_starfield_04.prt') === 'starfield' && distantKind('appearance/pt_kashyyyk_exploding_asteroid.prt') === 'feature', "the client's particle star fields are told from a zone's own features");
ok(e0.infinite && !e1.infinite && e0.file === 'particles/fx_pt_blackhole_03.json' && e2.file === null && e0.radius === 75 && e1.radius === 570 && e2.radius === null, 'the file, whether it rides, and the reach ride along; a system that did not convert has no file');
ok(e0.turn.pitch === -70 && e0.turn.roll === -25 && e0.basis.join() === distantBasis(0, -70, -25).join(), "the file's own turn is kept beside the basis");

// ---------------------------------------------------------------- 4. the game's reading
const pack = { distant: [e0, e1, e2] as DistantSystem[] };
const was = { ...DISTANT_TUNE };
const plan = distantPlan(pack);
ok(plan.length === 2 && plan[0].file === e0.file && plan[1].file === e1.file, 'the riding black hole and the standing asteroid are placed; a system with no file is not');
ok(distantPlan({ distant: [e0, distantEntry(read[2], 'particles/fx_pt_starfield_02.json', 900)] as DistantSystem[] }).length === 1, "the client's star fields wait on their switch (off)");
DISTANT_TUNE.starfields = true;
ok(distantPlan({ distant: [e0, distantEntry(read[2], 'particles/fx_pt_starfield_02.json', 900)] as DistantSystem[] }).length === 2, 'and are placed with it on');
DISTANT_TUNE.starfields = was.starfields;
ok(distantPlan(null).length === 0 && distantPlan({ distant: undefined }).length === 0 && distantPlan({ distant: [] }).length === 0, 'an older pack, or a zone with none, places nothing');
DISTANT_TUNE.on = false;
ok(distantPlan(pack).length === 0, 'and the switch off places nothing');
DISTANT_TUNE.on = true;
// The pull: a riding system nearer than `pullTo` is pulled out to it and scaled by the same ratio (its angle the file's).
const bh = plan[0];
ok(near(bh.size, DISTANT_TUNE.pullTo / 200) && near(bh.offset, 200) && plan[1].size === 1, `the black hole 200 m off is pulled out by ${bh.size} to ${DISTANT_TUNE.pullTo} m; the standing asteroid is never pulled`);
ok(pullOf(e0, 0) === 1 && pullOf(e0, 150) === 1 && pullOf(e1, 6000) === 1, 'no pull with the dial at nought, none inward, none for a standing one');
const keepReach = (bh.reach * 200 + 40) >= DISTANT_TUNE.pullTo + (e0.radius ?? 0) * bh.size;
ok(keepReach && plan[1].reach * 200 > 9000, `each is kept running past where it is drawn (reach ${bh.reach}: ${bh.reach * 200} m, past the 9 km far plane)`);
// The matrix: the eye plus the place times the pull for a riding one, the place for a standing one; the turn by columns.
const out = new Float32Array(16);
const eye = { x: -5872.25, y: 31.5, z: 2010.75 };
distantMatrixInto(bh, eye, out);
const m4 = new THREE.Matrix4().fromArray(out);
const pos = new THREE.Vector3().setFromMatrixPosition(m4);
ok(near(pos.x, eye.x, 1e-2) && near(pos.y, eye.y, 1e-2) && near(pos.z, eye.z - 200 * bh.size, 1e-2), 'a riding system stands at the eye plus its place times its pull');
const fwd = new THREE.Vector3(0, 0, 1).transformDirection(m4);
ok(near(fwd.x, e0.basis[2], 1e-6) && near(fwd.y, e0.basis[5], 1e-6) && near(fwd.z, e0.basis[8], 1e-6) && Math.abs(m4.determinant() - 1) < 1e-5, 'its turn is the basis, carried by columns, with no scale in the matrix');
distantMatrixInto(plan[1], eye, out);
ok(out[12] === -200 && out[13] === 50 && out[14] === 375 && out[15] === 1, 'a standing system stands at its place whatever the eye');
// The angle a riding system covers is the file's: its reach over its distance, pulled or not.
ok(near(((e0.radius ?? 0) * bh.size) / (200 * bh.size), (e0.radius ?? 0) / 200), 'pulled out, it covers the very angle the file gives it');

// The set, through stand-in effects that record what they are asked.
const log: string[] = [];
const handles: Any[] = [];
const deps: DistantDeps = {
  prepare: async (file) => {
    log.push(`prepare ${file}`);
    return true;
  },
  place: (file, matrix, o) => {
    const h = { file, at: new THREE.Vector3().setFromMatrixPosition(matrix), size: o.size, reach: o.reach, moves: 0, removed: false };
    handles.push(h);
    log.push(`place ${file}`);
    return h;
  },
  move: (h: Any, matrix) => {
    h.at.setFromMatrixPosition(matrix);
    h.moves++;
  },
  resize: (h: Any, size) => {
    h.size = size;
  },
  remove: (h: Any) => {
    h.removed = true;
  },
};
const set = (await DistantSet.build(deps, pack, eye, () => true))!;
ok(!!set && log.slice(0, 2).every((l) => l.startsWith('prepare')) && log.filter((l) => l.startsWith('place')).length === 2, 'every effect is prepared before anything is placed (behind the screen, so the warm-up builds them)');
ok(handles[0].reach === bh.reach && near(handles[0].size, bh.size) && handles[1].size === 1, 'each is placed with its reach and its pull as its size');
const eye2 = { x: eye.x + 1000.5, y: eye.y - 20, z: eye.z + 3 };
set.frame(eye2);
ok(handles[0].moves === 1 && handles[1].moves === 0 && near(handles[0].at.x, eye2.x, 1e-2) && near(handles[0].at.z, eye2.z - 200 * bh.size, 1e-2), 'a frame moves the riding one with the eye and leaves the standing one');
DISTANT_TUNE.pullTo = 0;
set.retune();
ok(handles[0].size === 1 && near(handles[0].at.z, eye2.z - 200, 1e-2) && handles[1].size === 1, 'the pull moved to nought resizes it to the file\'s own and stands it at the file\'s own place, live');
DISTANT_TUNE.pullTo = was.pullTo;
DISTANT_TUNE.on = false;
set.retune();
ok(handles.every((h) => h.removed), 'the switch off takes every placed effect out');
DISTANT_TUNE.on = true;
const before = handles.length;
set.retune();
ok(handles.length === before + 2 && log.filter((l) => l.startsWith('prepare')).length === 2, 'and on places them again from what was prepared, preparing nothing');
set.dispose();
ok(handles.slice(before).every((h) => h.removed), 'the set taken out with its zone takes its effects with it');
const dropped = await DistantSet.build(deps, pack, eye, () => false);
ok(dropped === null && handles.length === before + 2, 'a load dropped while it prepared places nothing');
Object.assign(DISTANT_TUNE, was);

// ---------------------------------------------------------------- 5. converted packs, where they stand
const packs = process.env.SWG3JS_SPACE_PACKS || join(ROOT, 'assets-private');
const packOf = (zone: string): Any | null => {
  const f = join(packs, zone, 'space.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
};
const kessel = packOf('space_light1');
if (!kessel || !Array.isArray(kessel.distant)) console.log(`note: no Kessel pack with its distant systems under ${packs} (converted before them, or none): the space command since this wave writes them`);
else {
  const holes = kessel.distant.filter((d: Any) => d.kind === 'feature');
  ok(holes.length === 3 && holes.every((d: Any) => d.infinite && /pt_blackhole_0[234]\.prt$/.test(d.appearance) && typeof d.file === 'string' && existsSync(join(packs, 'space_light1', d.file))), "Kessel's pack carries its three black holes, riding with the camera, each effect's file in the pack");
  const kp = distantPlan(kessel);
  ok(kp.length === 3 && kp.every((p) => p.entry.kind === 'feature' && p.size > 1 && near(p.offset * p.size, DISTANT_TUNE.pullTo, 1e-6)), `the game places exactly those three, each pulled out to ${DISTANT_TUNE.pullTo} m (offsets ${kp.map((p) => Math.round(p.offset)).join(', ')} m)`);
  for (const p of kp) {
    const f = JSON.parse(readFileSync(join(packs, 'space_light1', p.file), 'utf8'));
    ok(Array.isArray(f.groups) && f.groups.length > 0, `${p.file}: a converted effect the game's particles read (${f.groups.length} group)`);
  }
}
const kash = packOf('space_kashyyyk');
if (!kash || !Array.isArray(kash.distant)) console.log(`note: no Kashyyyk pack with its distant systems under ${packs}`);
else {
  const kp = distantPlan(kash);
  ok(kp.length === 1 && !kp[0].entry.infinite && /pt_kashyyyk_exploding_asteroid\.prt$/.test(kp[0].entry.appearance) && kp[0].size === 1, "Kashyyyk's exploding asteroid is placed standing in the world, at its own size");
  ok(kash.distant.filter((d: Any) => d.kind === 'starfield').length === 6, "and its six star fields are carried and wait on their switch");
}

console.log(`spaceDistant: ${checks} checks passed`);
