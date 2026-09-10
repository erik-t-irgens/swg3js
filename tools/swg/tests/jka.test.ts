// Jedi Academy importer: a synthetic GLA and animation.cfg inside a stored zip, retargeted onto a
// small SWG-style skeleton whose bind pose differs from JKA's T pose.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openZip, openJkaBase, parseGla, parseAnimationCfg, planRetarget, retargetClip, importJkaClips, defaultJkaClips, BONE_MAP } from '../jka.mjs';

// --- helpers ---------------------------------------------------------------------------------
type Q = [number, number, number, number];
const qmul = (a: Q, b: Q): Q => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
const qconj = (q: Q): Q => [q[0], -q[1], -q[2], -q[3]];
const qaxis = (axis: number[], rad: number): Q => {
  const s = Math.sin(rad / 2);
  return [Math.cos(rad / 2), axis[0] * s, axis[1] * s, axis[2] * s];
};
const qrot = (q: Q, v: number[]) => {
  const r = qmul(qmul(q, [0, v[0], v[1], v[2]]), qconj(q));
  return [r[1], r[2], r[3]];
};
const matOf = (q: Q, t: number[]) => {
  const [w, x, y, z] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), t[0], 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), t[1], 2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y), t[2]];
};
const angleBetween = (a: Q, b: Q) => {
  const d = qmul(qconj(a), b);
  return 2 * Math.acos(Math.min(1, Math.abs(d[0])));
};

interface Bone { name: string; parent: number; local: { q: Q; t: number[] } }
/** Encode a GLA: bones with a base pose (frame 0 local transforms) and per-frame local transforms. */
function buildGla(bones: Bone[], frames: { q: Q; t: number[] }[][]): Buffer {
  const numBones = bones.length;
  // world base pose from locals
  const world: { q: Q; t: number[] }[] = [];
  const at = (i: number): { q: Q; t: number[] } => {
    if (world[i]) return world[i];
    const b = bones[i];
    if (b.parent < 0) world[i] = { q: b.local.q, t: b.local.t };
    else {
      const p = at(b.parent);
      const r = qrot(p.q, b.local.t);
      world[i] = { q: qmul(p.q, b.local.q), t: [p.t[0] + r[0], p.t[1] + r[1], p.t[2] + r[2]] };
    }
    return world[i];
  };
  bones.forEach((_, i) => at(i));
  const skelParts: Buffer[] = [];
  const offsets: number[] = [];
  let skelSize = numBones * 4;
  bones.forEach((b, i) => {
    const children = bones.map((c, j) => (c.parent === i ? j : -1)).filter((j) => j >= 0);
    const buf = Buffer.alloc(64 + 4 + 4 + 48 + 48 + 4 + children.length * 4);
    buf.write(b.name, 0, 'latin1');
    buf.writeUInt32LE(0, 64);
    buf.writeInt32LE(b.parent, 68);
    matOf(world[i].q, world[i].t).forEach((v, k) => buf.writeFloatLE(v, 72 + k * 4));
    // inverse is not read by the importer; leave zeros
    buf.writeInt32LE(children.length, 168);
    children.forEach((c, k) => buf.writeInt32LE(c, 172 + k * 4));
    offsets.push(skelSize);
    skelParts.push(buf);
    skelSize += buf.length;
  });
  const skel = Buffer.alloc(numBones * 4);
  offsets.forEach((o, i) => skel.writeInt32LE(o, i * 4));
  const skelBlock = Buffer.concat([skel, ...skelParts]);
  // pool: one entry per (frame, bone)
  const pool = Buffer.alloc(frames.length * numBones * 14);
  const index = Buffer.alloc(frames.length * numBones * 3);
  let k = 0;
  frames.forEach((frame, f) => {
    frame.forEach((b, i) => {
      const o = k * 14;
      b.q.forEach((v, c) => pool.writeUInt16LE(Math.round((v + 2) * 16383), o + c * 2));
      b.t.forEach((v, c) => pool.writeUInt16LE(Math.round((v + 512) * 64), o + 8 + c * 2));
      const io = (f * numBones + i) * 3;
      index[io] = k & 255;
      index[io + 1] = (k >> 8) & 255;
      index[io + 2] = (k >> 16) & 255;
      k++;
    });
  });
  const header = Buffer.alloc(100);
  header.write('2LGA', 0, 'latin1');
  header.writeInt32LE(6, 4);
  header.write('models/players/_humanoid/_humanoid', 8, 'latin1');
  header.writeFloatLE(1, 72);
  header.writeInt32LE(frames.length, 76);
  const ofsFrames = 100 + skelBlock.length;
  const pad = (4 - ((ofsFrames + index.length) % 4)) % 4;
  header.writeInt32LE(ofsFrames, 80);
  header.writeInt32LE(numBones, 84);
  header.writeInt32LE(ofsFrames + index.length + pad, 88);
  header.writeInt32LE(100 + numBones * 4, 92); // as real files: ofsSkel points at the first bone, past the offset table
  header.writeInt32LE(ofsFrames + index.length + pad + pool.length, 96);
  return Buffer.concat([header, skelBlock, index, Buffer.alloc(pad), pool]);
}

/** A stored (uncompressed) zip with the given files. */
function buildZip(files: Record<string, Buffer>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.write(name, 30, 'latin1');
    const cd = Buffer.alloc(46 + name.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    cd.write(name, 46, 'latin1');
    parts.push(local, data);
    central.push(cd);
    offset += local.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}

// --- a JKA-like skeleton (Quake space: x forward, y left, z up) with a T pose ------------------
const I: Q = [1, 0, 0, 0];
const jkaBones: Bone[] = [
  { name: 'model_root', parent: -1, local: { q: I, t: [0, 0, 0] } },
  { name: 'pelvis', parent: 0, local: { q: I, t: [0, 0, 40] } },
  { name: 'lower_lumbar', parent: 1, local: { q: I, t: [0, 0, 6] } },
  { name: 'upper_lumbar', parent: 2, local: { q: I, t: [0, 0, 6] } },
  { name: 'thoracic', parent: 3, local: { q: I, t: [0, 0, 8] } },
  { name: 'cervical', parent: 4, local: { q: I, t: [0, 0, 6] } },
  { name: 'cranium', parent: 5, local: { q: I, t: [0, 0, 4] } },
  { name: 'rclavical', parent: 4, local: { q: I, t: [0, -4, 2] } },
  { name: 'rhumerus', parent: 7, local: { q: I, t: [0, -4, 0] } }, // arm out to the right (-y) in a T pose
  { name: 'rradius', parent: 8, local: { q: I, t: [0, -12, 0] } },
  { name: 'rhand', parent: 9, local: { q: I, t: [0, -10, 0] } },
  { name: 'rfemurYZ', parent: 1, local: { q: I, t: [0, -4, -2] } },
  { name: 'rtibia', parent: 11, local: { q: I, t: [0, 0, -18] } },
  { name: 'rtalus', parent: 12, local: { q: I, t: [0, 0, -18] } },
];
// Frames hold each bone's change from the base pose, relative to its parent's change (the
// renderer chains them into the matrix that moves bind-space vertices). Frame 0: no change.
// Frame 1: hips dropped 4 units, and the right upper arm swung forward 90 degrees about its own
// pivot (about z, -y to +x): a rotation about the arm's base position p is T(p) R T(-p).
const frame0 = jkaBones.map(() => ({ q: I, t: [0, 0, 0] }));
const frame1 = frame0.map((b) => ({ q: [...b.q] as Q, t: [...b.t] }));
frame1[1].t = [0, 0, -4];
{
  const R = qaxis([0, 0, 1], Math.PI / 2);
  const pivot = [0, -4, 40 + 6 + 6 + 8 + 2]; // rhumerus base position: clavicle at y -4, z 62
  const rp = qrot(R, pivot);
  frame1[8] = { q: R, t: [pivot[0] - rp[0], pivot[1] - rp[1], pivot[2] - rp[2]] };
}
const glaBuf = buildGla(jkaBones, [frame0, frame1, frame1]);
const cfgText = `// synthetic\nBOTH_A1_T__B_\t1 2 -1 20\nBOTH_STAND2 0 1 -1 20\nBOTH_JUMP1 1 -2 0 10\n`;

// --- GLA parse -------------------------------------------------------------------------------
const gla = parseGla(glaBuf);
assert.equal(gla.numBones, jkaBones.length);
assert.equal(gla.numFrames, 3);
assert.equal(gla.bones[8].name, 'rhumerus');
assert.equal(gla.bones[8].parent, 7);
const b1 = gla.boneAt(1, 8);
assert.ok(Math.abs(b1.q[0] - Math.SQRT1_2) < 2e-4 && Math.abs(b1.q[3] - Math.SQRT1_2) < 2e-4, `rhumerus frame 1 quaternion ${b1.q}`);
assert.deepEqual(gla.boneAt(1, 1).t.map((v) => Math.round(v * 64) / 64), [0, 0, -4]);
assert.ok(Math.abs(gla.bones[1].basePose[11] - 40) < 1e-5, 'pelvis base height');

// --- animation.cfg ---------------------------------------------------------------------------
const cfg = parseAnimationCfg(cfgText);
assert.equal(cfg.size, 3);
assert.deepEqual(cfg.get('BOTH_A1_T__B_'), { name: 'BOTH_A1_T__B_', first: 1, count: 2, reverse: false, loop: -1, fps: 20 });
assert.equal(cfg.get('BOTH_JUMP1')!.reverse, true);
assert.equal(cfg.get('BOTH_JUMP1')!.loop, 0);

// --- an SWG-style skin (glTF space: z forward, y up, x left) whose arms hang down ---------------
// Joints carry local rotation [w,x,y,z] and translation, as skinData produces them.
const swgJoints = [
  { name: 'root', parent: -1, rotation: I, translation: [0, 0, 0] },
  { name: 'pelvis', parent: 0, rotation: I, translation: [0, 1.0, 0] },
  { name: 'spine1', parent: 1, rotation: I, translation: [0, 0.15, 0] },
  { name: 'spine2', parent: 2, rotation: I, translation: [0, 0.15, 0] },
  { name: 'spine3', parent: 3, rotation: I, translation: [0, 0.2, 0] },
  { name: 'neck', parent: 4, rotation: I, translation: [0, 0.15, 0] },
  { name: 'head', parent: 5, rotation: I, translation: [0, 0.1, 0] },
  { name: 'r_clavicle', parent: 4, rotation: I, translation: [-0.1, 0.05, 0] },
  { name: 'r_bicep', parent: 7, rotation: I, translation: [-0.1, 0, 0] }, // right side is -x in glTF space
  { name: 'r_forearm', parent: 8, rotation: I, translation: [0, -0.3, 0] }, // arm hangs down: A pose
  { name: 'r_wrist', parent: 9, rotation: I, translation: [0, -0.25, 0] },
  { name: 'r_thigh', parent: 1, rotation: I, translation: [-0.1, -0.05, 0] },
  { name: 'r_calf', parent: 11, rotation: I, translation: [0, -0.45, 0] },
  { name: 'r_foot', parent: 12, rotation: I, translation: [0, -0.45, 0] },
  { name: 'l_wrist', parent: 1, rotation: I, translation: [0.3, 0, 0] }, // unmapped side, keeps its bind pose
];
const plan = planRetarget(gla, swgJoints);
assert.equal(plan.report.matched.length, 13, plan.report.missing.join('; '));
assert.ok(plan.report.missing.every((m: string) => /^l/.test(m)), `unexpected misses: ${plan.report.missing}`);
assert.ok(Math.abs(plan.unitScale - 1.0 / 40) < 1e-9, `unit scale ${plan.unitScale}`);
const armAngle = plan.report.angles.find((a: { bone: string }) => a.bone === 'rhumerus')!.degrees;
assert.equal(armAngle, 90, 'the T-pose arm sits 90 degrees from the hanging arm');

// --- retarget: the swung arm should point forward (+z) on the SWG skeleton too -----------------
const clip = retargetClip(gla, cfg.get('BOTH_A1_T__B_')!, swgJoints, plan);
assert.equal(clip.frames, 2);
assert.ok(Math.abs(clip.times[1] - 0.05) < 1e-6);
assert.equal(clip.loop, false);
// world pose of the SWG joints at frame 0 of the clip (= JKA frame 1)
const world: { q: Q; t: number[] }[] = [];
swgJoints.forEach((j, i) => {
  const r = clip.tracks[i].rotations;
  const lq: Q = [r[3], r[0], r[1], r[2]];
  const lt = Array.from(clip.tracks[i].translations.subarray(0, 3));
  if (j.parent < 0) world[i] = { q: lq, t: lt };
  else {
    const p = world[j.parent];
    const rr = qrot(p.q, lt);
    world[i] = { q: qmul(p.q, lq), t: [p.t[0] + rr[0], p.t[1] + rr[1], p.t[2] + rr[2]] };
  }
});
const bicep = world[8];
const forearm = world[9];
const dir = [forearm.t[0] - bicep.t[0], forearm.t[1] - bicep.t[1], forearm.t[2] - bicep.t[2]];
const len = Math.hypot(...dir);
assert.ok(Math.abs(len - 0.3) < 1e-6, 'bone length is kept');
assert.ok(dir[2] / len > 0.99, `upper arm should point forward (+z), got ${dir.map((v) => v.toFixed(3))}`);
// hips dropped by 4 JKA units = 0.1 m
assert.ok(Math.abs(world[1].t[1] - 0.9) < 1e-6, `pelvis height ${world[1].t[1]}`);
// unmapped joints keep their bind pose
assert.ok(angleBetween(world[14].q, I) < 1e-6);
// the pose check reports the arm's swing and nothing else
{
  const { poseCheck } = await import('../jka.mjs');
  const check = poseCheck(clip, swgJoints, plan) as { bone: string; degrees: number }[];
  const arm = check.find((c) => c.bone === 'r_bicep')!;
  assert.equal(arm.degrees, 90, JSON.stringify(check));
  assert.equal(check.find((c) => c.bone === 'r_forearm')!.degrees, 90, 'the forearm swings with the upper arm');
  assert.ok(check.filter((c) => c.bone !== 'r_bicep' && c.bone !== 'r_forearm').every((c) => c.degrees === 0), JSON.stringify(check));
}
// the leg, untouched in JKA, stays hanging down
const thighDir = [world[12].t[0] - world[11].t[0], world[12].t[1] - world[11].t[1], world[12].t[2] - world[11].t[2]];
assert.ok(thighDir[1] < -0.44, `thigh should still point down, got ${thighDir}`);

// --- hips found as the thighs' shared parent when no joint is called pelvis; bones in any order ---
{
  const renamed = swgJoints.map((j) => (j.name === 'pelvis' ? { ...j, name: 'hipsocket' } : j));
  const p2 = planRetarget(gla, renamed);
  assert.ok(p2.report.matched.includes('pelvis -> hipsocket'), p2.report.matched.join(', '));
  // a JKA file that lists a child before its parent
  const shuffled: Bone[] = [
    { name: 'pelvis', parent: 1, local: { q: I, t: [0, 0, 40] } },
    { name: 'model_root', parent: -1, local: { q: I, t: [0, 0, 0] } },
    { name: 'lower_lumbar', parent: 0, local: { q: I, t: [0, 0, 6] } },
  ];
  const g2 = parseGla(buildGla(shuffled, [shuffled.map(() => ({ q: I, t: [0, 0, 0] }))]));
  const p3 = planRetarget(g2, swgJoints);
  const c2 = retargetClip(g2, { name: 'X', first: 0, count: 1, reverse: false, loop: -1, fps: 20 }, swgJoints, p3);
  assert.equal(c2.frames, 1);
  assert.ok(Math.abs(p3.unitScale - 1 / 40) < 1e-9);
}

// --- the same through a pk3 base folder ---------------------------------------------------------
const tmpDir = mkdtempSync(join(tmpdir(), "jka-"));
writeFileSync(join(tmpDir, "assets0.pk3"), buildZip({ 'models/players/_humanoid/_humanoid.gla': Buffer.alloc(10), 'models/players/_humanoid/animation.cfg': Buffer.from('BOTH_STAND2 0 1 -1 20\n') }));
writeFileSync(join(tmpDir, "assets1.pk3"), buildZip({ 'models/players/_humanoid/_humanoid.gla': glaBuf, 'models/players/_humanoid/animation.cfg': Buffer.from(cfgText) }));
const zip = openZip(join(tmpDir, "assets1.pk3"));
assert.ok(zip.has('MODELS/players/_humanoid/animation.cfg'));
assert.equal(zip.read('models/players/_humanoid/animation.cfg').toString(), cfgText);
zip.close();
const base = openJkaBase(tmpDir);
assert.equal(base.where('models/players/_humanoid/_humanoid.gla'), join(tmpDir, "assets1.pk3"), 'later archives win');
base.close();
const messages: string[] = [];
const r = importJkaClips(tmpDir, swgJoints, ['BOTH_A1_T__B_', 'BOTH_JUMP1', 'BOTH_NOPE'], { log: (m: string) => messages.push(m) });
assert.equal(r.clips.length, 2);
assert.deepEqual(r.info.missing, ['BOTH_NOPE']);
assert.equal(r.clips[1].name, 'BOTH_JUMP1');
assert.equal(r.clips[1].loop, true);
assert.ok(messages.some((m) => m.includes('13 bones matched')), messages.join('\n'));
assert.ok(defaultJkaClips().includes('BOTH_A3_TR_BL') && defaultJkaClips().includes('BOTH_FORCEJUMP1'));
assert.ok(defaultJkaClips().includes('BOTH_S2_S1_T_') && defaultJkaClips().includes('BOTH_R3_B__S1'), 'medium and strong starts and returns keep the fast stance suffix');
assert.ok(BONE_MAP.length >= 20);
console.log('jka: ok');
