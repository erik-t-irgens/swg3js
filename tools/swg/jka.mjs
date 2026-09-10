// Jedi Knight: Jedi Academy animations for the SWG player. Reads the humanoid skeleton and its
// animation file straight from a locally owned install (base/assets*.pk3), and retargets chosen
// clips onto the converted SWG skeleton so the game can play them alongside SWG's own.
//
// Formats (from OpenJK, rd-common/mdx_format.h and qcommon/matcomp.cpp):
//   .gla  mdxaHeader_t { "2LGA", version, name[64], fScale, numFrames, ofsFrames, numBones,
//         ofsCompBonePool, ofsSkel, ofsEnd }. Right after the header: numBones int32 offsets
//         (counted from the end of the header) to mdxaSkel_t { name[64], flags, parent,
//         basePose 3x4, basePoseInv 3x4, numChildren, children[] }. At ofsFrames: 3-byte little-endian indices, (frame * numBones + bone),
//         into the pool at ofsCompBonePool of 14-byte bones: four uint16 quaternion parts
//         (w x y z, value / 16383 - 2) and three uint16 translations (value / 64 - 512). A pool
//         bone is the bone's transform relative to its parent; the base pose matrices are in
//         model space.
//   animation.cfg  lines of "NAME firstFrame numFrames loopFrames fps" (negative numFrames
//         plays backwards, loopFrames -1 means no loop).
//   .pk3  plain zip archives (stored or deflate), later archive numbers override earlier ones.
//
// Quake space is x forward, y left, z up; the converter's glTF space is z forward, y up, x left,
// so the mapping is a permutation with no mirror. Rest poses differ (JKA stands in a T pose,
// SWG's bind pose does not), so each mapped bone carries an alignment from its JKA rest direction
// to its SWG rest direction, and the JKA bone's world-space change from rest is applied to the
// SWG bone in that aligned frame. Quaternions here are [w, x, y, z].
import { closeSync, openSync, readSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

// ---------------------------------------------------------------------------------------------
// pk3 (zip) reading, by ranges so gigabyte archives are never loaded whole.
function readRange(fd, offset, length) {
  const buf = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const n = readSync(fd, buf, done, length - done, offset + done);
    if (n <= 0) break;
    done += n;
  }
  return buf.subarray(0, done);
}

/** Open a zip archive: { entries: Map<lowercase name, entry>, read(name) -> Buffer, close() }. */
export function openZip(file) {
  const fd = openSync(file, 'r');
  const size = statSync(file).size;
  const tail = readRange(fd, Math.max(0, size - 66000), Math.min(size, 66000));
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    closeSync(fd);
    throw new Error(`${file}: not a zip archive`);
  }
  const count = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  const cd = readRange(fd, cdOffset, cdSize);
  const entries = new Map();
  let o = 0;
  for (let i = 0; i < count && o + 46 <= cd.length; i++) {
    if (cd.readUInt32LE(o) !== 0x02014b50) break;
    const method = cd.readUInt16LE(o + 10);
    const compressed = cd.readUInt32LE(o + 20);
    const uncompressed = cd.readUInt32LE(o + 24);
    const nameLen = cd.readUInt16LE(o + 28);
    const extraLen = cd.readUInt16LE(o + 30);
    const commentLen = cd.readUInt16LE(o + 32);
    const offset = cd.readUInt32LE(o + 42);
    const name = cd.toString('utf8', o + 46, o + 46 + nameLen).replace(/\\/g, '/');
    entries.set(name.toLowerCase(), { name, method, compressed, uncompressed, offset });
    o += 46 + nameLen + extraLen + commentLen;
  }
  return {
    file,
    entries,
    has: (name) => entries.has(name.toLowerCase()),
    read(name) {
      const e = entries.get(name.toLowerCase());
      if (!e) throw new Error(`${name}: not in ${file}`);
      const local = readRange(fd, e.offset, 30);
      if (local.readUInt32LE(0) !== 0x04034b50) throw new Error(`${name}: bad local header in ${file}`);
      const dataStart = e.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      const raw = readRange(fd, dataStart, e.compressed);
      if (e.method === 0) return raw;
      if (e.method === 8) return inflateRawSync(raw);
      throw new Error(`${name}: unsupported zip method ${e.method}`);
    },
    close: () => closeSync(fd),
  };
}

/**
 * A view over every pk3 under a Jedi Academy base folder (or the GameData folder above it),
 * later archives winning: { has(name), read(name), archives, close() }.
 */
export function openJkaBase(dir) {
  let base = dir;
  if (!existsSync(join(base, 'assets0.pk3')) && existsSync(join(base, 'base', 'assets0.pk3'))) base = join(base, 'base');
  if (!existsSync(base)) throw new Error(`${dir}: not found`);
  const files = readdirSync(base).filter((f) => f.toLowerCase().endsWith('.pk3')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!files.length) throw new Error(`${base}: no .pk3 archives (expected assets0.pk3 .. assets3.pk3)`);
  const archives = files.map((f) => openZip(join(base, f)));
  const find = (name) => {
    for (let i = archives.length - 1; i >= 0; i--) if (archives[i].has(name)) return archives[i];
    return null;
  };
  return {
    base,
    archives: files,
    has: (name) => find(name) !== null,
    read(name) {
      const a = find(name);
      if (!a) throw new Error(`${name}: not in any archive under ${base}`);
      return a.read(name);
    },
    where: (name) => find(name)?.file ?? null,
    /** The archive a file is read from (later archives win). */
    archiveOf: (name) => {
      const a = find(name);
      if (!a) throw new Error(`${name}: not in any archive under ${base}`);
      return a;
    },
    close: () => archives.forEach((a) => a.close()),
  };
}

// ---------------------------------------------------------------------------------------------
// GLA (Ghoul2 animation) reading.
const MAX_QPATH = 64;

function cstr(buf, o, n) {
  const end = buf.indexOf(0, o);
  return buf.toString('latin1', o, end < 0 || end > o + n ? o + n : end);
}

/** Parse a .gla file: skeleton with base pose and a frame reader. */
export function parseGla(buf) {
  if (buf.length < 100 || buf.toString('latin1', 0, 4) !== '2LGA') throw new Error('not a GLA file (missing 2LGA ident)');
  const version = buf.readInt32LE(4);
  const name = cstr(buf, 8, MAX_QPATH);
  const scale = buf.readFloatLE(72);
  const numFrames = buf.readInt32LE(76);
  const ofsFrames = buf.readInt32LE(80);
  const numBones = buf.readInt32LE(84);
  const ofsCompBonePool = buf.readInt32LE(88);
  // The bone offset table follows the 100-byte header, and its entries count from the same place
  // (the renderer ignores the header's ofsSkel for this).
  const HEADER = 100;
  const bones = [];
  for (let i = 0; i < numBones; i++) {
    const so = HEADER + buf.readInt32LE(HEADER + i * 4);
    if (so + MAX_QPATH + 8 + 48 > buf.length) throw new Error(`bone ${i}: skeleton entry at ${so} runs past the file (${buf.length} bytes)`);
    const basePose = [];
    for (let k = 0; k < 12; k++) basePose.push(buf.readFloatLE(so + MAX_QPATH + 8 + k * 4));
    bones.push({ name: cstr(buf, so, MAX_QPATH), flags: buf.readUInt32LE(so + MAX_QPATH), parent: buf.readInt32LE(so + MAX_QPATH + 4), basePose });
  }
  const poolCount = Math.floor((buf.length - ofsCompBonePool) / 14);
  /** Bone `b` of frame `f` relative to its parent: { q: [w,x,y,z], t: [x,y,z] }. */
  const boneAt = (f, b) => {
    const io = ofsFrames + (f * numBones + b) * 3;
    const index = buf[io] | (buf[io + 1] << 8) | (buf[io + 2] << 16);
    if (index >= poolCount) throw new Error(`frame ${f} bone ${b}: pool index ${index} beyond the pool (${poolCount})`);
    const po = ofsCompBonePool + index * 14;
    const q = [0, 1, 2, 3].map((k) => buf.readUInt16LE(po + k * 2) / 16383 - 2);
    const t = [4, 5, 6].map((k) => buf.readUInt16LE(po + k * 2) / 64 - 512);
    return { q, t };
  };
  return { version, name, scale, numFrames, numBones, bones, boneAt };
}

/** Parse animation.cfg into a map of upper-case name -> { first, count, loop, fps, reverse }. */
export function parseAnimationCfg(text) {
  const out = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 5 || !/^[A-Z]/i.test(parts[0])) continue;
    const first = Number(parts[1]);
    const count = Number(parts[2]);
    const loop = Number(parts[3]);
    const fps = Number(parts[4]);
    if (![first, count, loop, fps].every(Number.isFinite)) continue;
    out.set(parts[0].toUpperCase(), { name: parts[0].toUpperCase(), first, count: Math.abs(count), reverse: count < 0, loop, fps: Math.abs(fps) || 20 });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Quaternion and matrix helpers ([w, x, y, z]; matrices row-major 3x4).
const qmul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
const qconj = (q) => [q[0], -q[1], -q[2], -q[3]];
function qnorm(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
function qrot(q, v) {
  const r = qmul(qmul(q, [0, v[0], v[1], v[2]]), qconj(q));
  return [r[1], r[2], r[3]];
}
/** Quaternion from a 3x3 rotation held in a row-major 3x4 matrix. */
function qfromMat(m) {
  const tr = m[0] + m[5] + m[10];
  let q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [0.25 * s, (m[9] - m[6]) / s, (m[2] - m[8]) / s, (m[4] - m[1]) / s];
  } else if (m[0] > m[5] && m[0] > m[10]) {
    const s = Math.sqrt(1 + m[0] - m[5] - m[10]) * 2;
    q = [(m[9] - m[6]) / s, 0.25 * s, (m[1] + m[4]) / s, (m[2] + m[8]) / s];
  } else if (m[5] > m[10]) {
    const s = Math.sqrt(1 + m[5] - m[0] - m[10]) * 2;
    q = [(m[2] - m[8]) / s, (m[1] + m[4]) / s, 0.25 * s, (m[6] + m[9]) / s];
  } else {
    const s = Math.sqrt(1 + m[10] - m[0] - m[5]) * 2;
    q = [(m[4] - m[1]) / s, (m[2] + m[8]) / s, (m[6] + m[9]) / s, 0.25 * s];
  }
  return qnorm(q);
}
/** Shortest rotation taking unit vector a to unit vector b. */
function qbetween(a, b) {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d < -0.999999) {
    // Opposite: turn half a circle about any axis perpendicular to a.
    let axis = [0, -a[2], a[1]];
    if (Math.hypot(...axis) < 1e-6) axis = [-a[2], 0, a[0]];
    const l = Math.hypot(...axis);
    return [0, axis[0] / l, axis[1] / l, axis[2] / l];
  }
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return qnorm([1 + d, c[0], c[1], c[2]]);
}
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
const vnorm = (a) => {
  const l = vlen(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Quake (x forward, y left, z up) to the converter's glTF space (z forward, y up, x left). */
const toGltfV = (v) => [v[1], v[2], v[0]];
const toGltfQ = (q) => [q[0], q[2], q[3], q[1]];

// ---------------------------------------------------------------------------------------------
// Retargeting.

/**
 * Which SWG joint plays each JKA humanoid bone, by name patterns tried in order. The chain
 * column names the JKA child whose position gives the bone's rest direction.
 */
export const BONE_MAP = [
  { jka: 'pelvis', swg: [/^pelvis$/i, /^hips?$/i, /pelvis/i], chain: 'lower_lumbar', rootMotion: true },
  { jka: 'lower_lumbar', swg: [/^spine_?1$/i, /^spine$/i, /^lower_?spine/i, /^spine_?a$/i], chain: 'upper_lumbar' },
  { jka: 'upper_lumbar', swg: [/^spine_?2$/i, /^mid_?spine/i, /^spine_?b$/i], chain: 'thoracic' },
  { jka: 'thoracic', swg: [/^spine_?3$/i, /^chest$/i, /^upper_?spine/i, /^torso$/i, /^spine_?c$/i], chain: 'cervical' },
  { jka: 'cervical', swg: [/^neck_?1?$/i, /neck/i], chain: 'cranium' },
  { jka: 'cranium', swg: [/^head$/i, /^head_?1$/i, /head/i], chain: null },
  { jka: 'rclavical', swg: [/^r_?clav/i, /^r_?collar/i, /^r_?shoulder$/i], chain: 'rhumerus' },
  { jka: 'rhumerus', swg: [/^r_?bicep$/i, /^r_?upper_?arm$/i, /^r_?arm$/i, /^r_?humerus$/i], chain: 'rradius' },
  { jka: 'rradius', swg: [/^r_?forearm$/i, /^r_?fore_?arm$/i, /^r_?lower_?arm$/i, /^r_?elbow$/i], chain: 'rhand' },
  { jka: 'rhand', swg: [/^r_?wrist$/i, /^r_?hand$/i], chain: null },
  { jka: 'lclavical', swg: [/^l_?clav/i, /^l_?collar/i, /^l_?shoulder$/i], chain: 'lhumerus' },
  { jka: 'lhumerus', swg: [/^l_?bicep$/i, /^l_?upper_?arm$/i, /^l_?arm$/i, /^l_?humerus$/i], chain: 'lradius' },
  { jka: 'lradius', swg: [/^l_?forearm$/i, /^l_?fore_?arm$/i, /^l_?lower_?arm$/i, /^l_?elbow$/i], chain: 'lhand' },
  { jka: 'lhand', swg: [/^l_?wrist$/i, /^l_?hand$/i], chain: null },
  { jka: 'rfemurYZ', swg: [/^r_?thigh$/i, /^r_?upper_?leg$/i, /^r_?leg$/i, /^r_?femur$/i, /^r_?hip$/i], chain: 'rtibia' },
  { jka: 'rtibia', swg: [/^r_?calf$/i, /^r_?shin$/i, /^r_?lower_?leg$/i, /^r_?knee$/i, /^r_?tibia$/i], chain: 'rtalus' },
  { jka: 'rtalus', swg: [/^r_?foot$/i, /^r_?ankle$/i], chain: null },
  { jka: 'lfemurYZ', swg: [/^l_?thigh$/i, /^l_?upper_?leg$/i, /^l_?leg$/i, /^l_?femur$/i, /^l_?hip$/i], chain: 'ltibia' },
  { jka: 'ltibia', swg: [/^l_?calf$/i, /^l_?shin$/i, /^l_?lower_?leg$/i, /^l_?knee$/i, /^l_?tibia$/i], chain: 'ltalus' },
  { jka: 'ltalus', swg: [/^l_?foot$/i, /^l_?ankle$/i], chain: null },
];

/** World rotation and position of every JKA bone at a frame (or the base pose when frame < 0), in glTF space. */
function jkaWorld(gla, frame) {
  const out = new Array(gla.numBones);
  // Bones are not stored parents-first, so resolve each one's chain on demand.
  const world = (b) => {
    if (out[b]) return out[b];
    const bone = gla.bones[b];
    let q;
    let t;
    if (frame < 0) {
      const m = bone.basePose;
      q = qfromMat(m);
      t = [m[3], m[7], m[11]];
    } else {
      const local = gla.boneAt(frame, b);
      const lq = qnorm(local.q);
      if (bone.parent >= 0 && bone.parent !== b) {
        const p = world(bone.parent);
        q = qnorm(qmul(p.q, lq));
        const r = qrot(p.q, local.t);
        t = [p.t[0] + r[0], p.t[1] + r[1], p.t[2] + r[2]];
      } else {
        q = lq;
        t = local.t;
      }
    }
    out[b] = { q, t };
    return out[b];
  };
  for (let b = 0; b < gla.numBones; b++) world(b);
  return out.map((w) => ({ q: toGltfQ(w.q), t: toGltfV(w.t) }));
}

/** World rotation and position of every SWG joint in its bind pose from the skin's local joints. */
function swgBindWorld(joints) {
  const out = new Array(joints.length);
  const world = (i) => {
    if (out[i]) return out[i];
    const j = joints[i];
    if (j.parent >= 0 && j.parent !== i) {
      const p = world(j.parent);
      const r = qrot(p.q, j.translation);
      out[i] = { q: qnorm(qmul(p.q, j.rotation)), t: [p.t[0] + r[0], p.t[1] + r[1], p.t[2] + r[2]] };
    } else out[i] = { q: qnorm(j.rotation), t: [...j.translation] };
    return out[i];
  };
  joints.forEach((_, i) => world(i));
  return out;
}

/**
 * Plan the retarget: which SWG joint each JKA bone drives and the per-bone alignment between
 * rest directions. Returns { pairs, unitScale, report } where report lists what matched.
 */
export function planRetarget(gla, joints, map = BONE_MAP) {
  const jkaIndex = new Map(gla.bones.map((b, i) => [b.name.toLowerCase(), i]));
  const findSwg = (patterns) => {
    for (const p of patterns) {
      const i = joints.findIndex((j) => p.test(j.name));
      if (i >= 0) return i;
    }
    return -1;
  };
  const jkaBase = jkaWorld(gla, -1);
  const swgBind = swgBindWorld(joints);
  const pairs = [];
  const missing = [];
  for (const m of map) {
    const j = jkaIndex.get(m.jka.toLowerCase());
    let s = findSwg(m.swg);
    if (s < 0 && m.rootMotion) {
      // No joint called pelvis or hips: the hips are whatever both thighs hang from.
      const thighs = map.filter((x) => /femur/i.test(x.jka)).map((x) => findSwg(x.swg)).filter((i) => i >= 0);
      const parents = [...new Set(thighs.map((i) => joints[i].parent))];
      if (parents.length === 1 && parents[0] >= 0) s = parents[0];
    }
    if (j === undefined || s < 0) {
      missing.push(`${m.jka} -> ${j === undefined ? 'no such JKA bone' : 'no SWG joint matched'}`);
      continue;
    }
    pairs.push({ ...m, j, s });
  }
  const bySwg = new Map(pairs.map((p) => [p.s, p]));
  const byJka = new Map(pairs.map((p) => [p.j, p]));
  // Rest direction of each bone: towards its chain child, in both skeletons.
  const angles = [];
  for (const p of pairs) {
    const child = p.chain ? byJka.get(jkaIndex.get(p.chain.toLowerCase())) : null;
    if (child) {
      const dj = vnorm(vsub(jkaBase[child.j].t, jkaBase[p.j].t));
      const ds = vnorm(vsub(swgBind[child.s].t, swgBind[p.s].t));
      p.align = qbetween(dj, ds);
      angles.push({ bone: p.jka, degrees: Math.round((Math.acos(Math.max(-1, Math.min(1, dj[0] * ds[0] + dj[1] * ds[1] + dj[2] * ds[2]))) * 180) / Math.PI) });
    } else p.align = null;
  }
  // Leaf bones take their parent's alignment.
  for (const p of pairs) {
    if (p.align) continue;
    let parent = gla.bones[p.j].parent;
    while (parent >= 0 && !(byJka.get(parent)?.align)) parent = gla.bones[parent].parent;
    p.align = parent >= 0 ? byJka.get(parent).align : [1, 0, 0, 0];
  }
  const pelvis = pairs.find((p) => p.rootMotion);
  const unitScale = pelvis && jkaBase[pelvis.j].t[1] > 1e-3 ? swgBind[pelvis.s].t[1] / jkaBase[pelvis.j].t[1] : 0.0254;
  return { pairs, bySwg, jkaBase, swgBind, unitScale, report: { matched: pairs.map((p) => `${p.jka} -> ${joints[p.s].name}`), missing, angles } };
}

/**
 * Retarget one animation.cfg entry onto the SWG skeleton. Returns a clip in the converter's skin
 * clip shape: { name, times, tracks: [{ rotations (x y z w per frame), translations }], duration }.
 */
export function retargetClip(gla, entry, joints, plan, { name = entry.name, fps = entry.fps } = {}) {
  const frames = Math.max(1, entry.count);
  const times = new Float32Array(frames);
  const tracks = joints.map(() => ({ rotations: new Float32Array(frames * 4), translations: new Float32Array(frames * 3) }));
  const { pairs, bySwg, jkaBase, swgBind, unitScale } = plan;
  for (let f = 0; f < frames; f++) {
    times[f] = f / fps;
    const frame = entry.reverse ? entry.first + entry.count - 1 - f : entry.first + f;
    if (frame < 0 || frame >= gla.numFrames) throw new Error(`${entry.name}: frame ${frame} outside the file's ${gla.numFrames} frames`);
    const anim = jkaWorld(gla, frame);
    // New world rotation of every SWG joint: mapped joints follow their JKA bone's change from
    // rest (turned into the SWG rest frame), the rest keep their bind rotation under their parent.
    const world = [];
    joints.forEach((j, i) => {
      const p = bySwg.get(i);
      const parent = j.parent >= 0 ? world[j.parent] : null;
      let q;
      let t;
      if (p) {
        const delta = qmul(anim[p.j].q, qconj(jkaBase[p.j].q));
        const aligned = qmul(qmul(p.align, delta), qconj(p.align));
        q = qnorm(qmul(aligned, swgBind[i].q));
      } else q = parent ? qnorm(qmul(parent.q, j.rotation)) : qnorm(j.rotation);
      let localT = j.translation;
      if (p?.rootMotion) {
        // The hips carry the crouch and lift of a move: the JKA pelvis' world offset from rest,
        // in metres, taken into the parent's frame.
        const d = vsub(anim[p.j].t, jkaBase[p.j].t).map((v) => v * unitScale);
        const inParent = parent ? qrot(qconj(parent.q), d) : d;
        localT = [j.translation[0] + inParent[0], j.translation[1] + inParent[1], j.translation[2] + inParent[2]];
      }
      if (parent) {
        const r = qrot(parent.q, localT);
        t = [parent.t[0] + r[0], parent.t[1] + r[1], parent.t[2] + r[2]];
      } else t = [...localT];
      world.push({ q, t });
      const local = parent ? qnorm(qmul(qconj(parent.q), q)) : q;
      tracks[i].rotations.set([local[1], local[2], local[3], local[0]], f * 4);
      tracks[i].translations.set(localT, f * 3);
    });
  }
  return { name, times, tracks, duration: times[frames - 1], loop: entry.loop >= 0, fps, frames, source: entry.name };
}

/** The JKA clips the game asks for by default: saber attacks of the three single styles, the moves around them, jumps and rolls. */
export function defaultJkaClips() {
  const quads = ['T__B_', 'TL_BR', '_L__R', 'BL_TR', 'BR_TL', '_R__L', 'TR_BL'];
  const starts = ['T_', 'TL', '_L', 'BL', 'BR', '_R', 'TR'];
  const returns = ['B_', 'BR', '_R', 'TR', 'TL', '_L', 'BL'];
  const from = ['BR', '_R', 'TR', 'T_', 'TL', '_L', 'BL'];
  const names = [];
  for (const s of [1, 2, 3]) {
    for (const q of quads) names.push(`BOTH_A${s}_${q}`);
    for (const q of starts) names.push(`BOTH_S${s}_S1_${q}`);
    for (const q of returns) names.push(`BOTH_R${s}_${q}_S1`);
    for (const a of from) for (const b of from) if (a !== b) names.push(`BOTH_T${s}_${a}_${b}`);
    for (const q of from) names.push(`BOTH_B${s}_${q}___`);
  }
  names.push('BOTH_STAND2', 'BOTH_SABERFAST_STANCE', 'BOTH_SABERSLOW_STANCE', 'BOTH_STAND1TO2', 'BOTH_STAND2TO1');
  names.push('BOTH_JUMP1', 'BOTH_JUMPBACK1', 'BOTH_JUMPLEFT1', 'BOTH_JUMPRIGHT1', 'BOTH_INAIR1', 'BOTH_LAND1', 'BOTH_LAND2', 'BOTH_FORCEJUMP1', 'BOTH_FORCEINAIR1', 'BOTH_FORCELAND1');
  names.push('BOTH_FLIP_F', 'BOTH_FLIP_B', 'BOTH_FLIP_L', 'BOTH_FLIP_R', 'BOTH_ROLL_F', 'BOTH_ROLL_B', 'BOTH_ROLL_L', 'BOTH_ROLL_R');
  names.push('BOTH_LUNGE2_B__T_', 'BOTH_FORCELEAP2_T__B_', 'BOTH_JUMPFLIPSTABDOWN', 'BOTH_JUMPFLIPSLASHDOWN1', 'BOTH_ATTACK_BACK', 'BOTH_A2_STABBACK1', 'BOTH_CROUCHATTACKBACK1', 'BOTH_ROLL_STAB');
  return names;
}

/**
 * Read the humanoid skeleton and animations from a Jedi Academy install and retarget `wanted`
 * clips onto `joints` (the converter's skin joints for the SWG player). Returns { clips, info }.
 */
export function importJkaClips(jkaDir, joints, wanted = defaultJkaClips(), { log = () => {} } = {}) {
  const base = openJkaBase(jkaDir);
  try {
    const glaPath = 'models/players/_humanoid/_humanoid.gla';
    const cfgPath = 'models/players/_humanoid/animation.cfg';
    if (!base.has(glaPath)) throw new Error(`${glaPath} is not in the archives under ${base.base}`);
    if (!base.has(cfgPath)) throw new Error(`${cfgPath} is not in the archives under ${base.base}`);
    // A mod may replace the skeleton file; its frame numbers only make sense with the
    // animation.cfg shipped beside it, so read both from the same archive.
    const glaFrom = base.where(glaPath);
    const source = base.archiveOf(glaPath);
    const cfgFrom = source.has(cfgPath) ? source.file : base.where(cfgPath);
    const gla = parseGla(source.read(glaPath));
    const cfg = parseAnimationCfg((source.has(cfgPath) ? source.read(cfgPath) : base.read(cfgPath)).toString('latin1'));
    log(`${glaPath} (${glaFrom}): ${gla.numBones} bones, ${gla.numFrames} frames; ${cfgPath} (${cfgFrom}): ${cfg.size} animations`);
    if (cfgFrom !== glaFrom) log(`WARNING: the skeleton and its animation.cfg come from different archives; frame ranges may not match`);
    const plan = planRetarget(gla, joints);
    log(`retarget: ${plan.report.matched.length} bones matched (${plan.report.matched.join(', ')}); scale ${plan.unitScale.toFixed(4)} m per unit`);
    if (plan.report.missing.length) log(`retarget: unmatched: ${plan.report.missing.join('; ')}; the SWG joints are ${joints.map((j) => j.name).join(', ')}`);
    log(`retarget: rest-direction differences: ${plan.report.angles.map((a) => `${a.bone} ${a.degrees}°`).join(', ')}`);
    const clips = [];
    const missing = [];
    for (const name of wanted) {
      const entry = cfg.get(name.toUpperCase());
      if (!entry || !entry.count) {
        missing.push(name);
        continue;
      }
      clips.push(retargetClip(gla, entry, joints, plan));
    }
    return { clips, info: { bones: gla.numBones, frames: gla.numFrames, animations: cfg.size, matched: plan.report.matched, missingBones: plan.report.missing, angles: plan.report.angles, unitScale: plan.unitScale, missing } };
  } finally {
    base.close();
  }
}
