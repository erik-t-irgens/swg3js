// Skeletal appearances, as the client's clientSkeletalAnimation library reads them:
//   .sat  SMAT: mesh generators (.mgn/.lmg), skeleton templates (.skt), skeleton -> .lat map
//   .lmg  MLOD: one mesh generator per detail level
//   .mgn  SKMG: skinned mesh (positions, per-position joint weights, normals, per-shader
//         vertex index lists, texture coordinates, triangle lists)
//   .skt  SKTM: joints (name, parent, pre/post rotations, bind pose translation and rotation)
//   .lat  LATT: logical animation names -> animation templates (inline KFAT or PXAT proxies)
//   .ans  KFAT: keyframed rotations/translations per joint, or static values
// Joint frames compose as post * (animation * bind) * pre for rotation and bind + animation
// for translation (Skeleton::drawJointFramesNow), which this module bakes per frame.
import { childOf, childrenOf, isForm, parseIff, readCString } from './iff.mjs';

class R {
  constructor(buf) {
    this.b = buf;
    this.o = 0;
  }
  i8() { return this.b.readInt8(this.o++); }
  u8() { return this.b.readUInt8(this.o++); }
  i16() { const v = this.b.readInt16LE(this.o); this.o += 2; return v; }
  u16() { const v = this.b.readUInt16LE(this.o); this.o += 2; return v; }
  i32() { const v = this.b.readInt32LE(this.o); this.o += 4; return v; }
  u32() { const v = this.b.readUInt32LE(this.o); this.o += 4; return v; }
  f32() { const v = this.b.readFloatLE(this.o); this.o += 4; return v; }
  str() { const { value, next } = readCString(this.b, this.o); this.o = next; return value; }
  vec() { return [this.f32(), this.f32(), this.f32()]; }
  quat() { return [this.f32(), this.f32(), this.f32(), this.f32()]; } // w x y z
  get remaining() { return this.b.length - this.o; }
}

const versionForm = (root, tag) => {
  if (!isForm(root) || root.type !== tag) throw new Error(`expected ${tag}, got ${root.type ?? root.tag}`);
  const v = root.children.find(isForm);
  if (!v) throw new Error(`${tag}: no version form`);
  return v;
};

// ---------------------------------------------------------------------------------------------
// Skeleton (.skt)
export function parseSkeleton(root) {
  // A LOD skeleton (SLOD) holds one SKTM form per detail level, finest first.
  if (isForm(root) && root.type === 'SLOD') {
    const lod = root.children.find(isForm);
    const first = lod && childrenOf(lod, 'SKTM')[0];
    if (!first) throw new Error('SLOD: no skeleton inside');
    return parseSkeleton(first);
  }
  const v = versionForm(root, 'SKTM');
  const version = Number.parseInt(v.type, 10);
  if (version !== 2 && version !== 1) throw new Error(`SKTM: unsupported version ${v.type}`);
  const n = new R(childOf(v, 'INFO').data).i32();
  const names = new R(childOf(v, 'NAME').data);
  const parents = new R(childOf(v, 'PRNT').data);
  const pre = new R(childOf(v, 'RPRE').data);
  const post = new R(childOf(v, 'RPST').data);
  const bindT = new R(childOf(v, 'BPTR').data);
  const bindR = new R(childOf(v, 'BPRO').data);
  const joints = [];
  for (let i = 0; i < n; i++) joints.push({ name: names.str(), parent: parents.i32(), pre: pre.quat(), post: post.quat(), bindT: bindT.vec(), bindR: bindR.quat() });
  return { version, joints };
}

// ---------------------------------------------------------------------------------------------
// Skinned mesh generator (.mgn)
export function parseMgn(root) {
  const v = versionForm(root, 'SKMG');
  const version = Number.parseInt(v.type, 10);
  if (version < 3 || version > 4) throw new Error(`SKMG: unsupported version ${v.type}`);
  const info = new R(childOf(v, 'INFO').data);
  const maxTransformsPerVertex = info.i32();
  const maxTransformsPerShader = info.i32();
  const skeletonCount = info.i32();
  const transformCount = info.i32();
  const positionCount = info.i32();
  const weightDataCount = info.i32();
  const normalCount = info.i32();
  const shaderCount = info.i32();
  const blendTargetCount = info.i32();
  // version 4 adds four int16 occlusion counts; older headers end here
  const strings = (chunk, count) => {
    const r = new R(chunk.data);
    const out = [];
    for (let i = 0; i < count; i++) out.push(r.str().replace(/\\/g, '/'));
    return out;
  };
  const skeletons = strings(childOf(v, 'SKTM'), skeletonCount);
  const transforms = strings(childOf(v, 'XFNM'), transformCount);
  const positions = new Float32Array(positionCount * 3);
  {
    const r = new R(childOf(v, 'POSN').data);
    for (let i = 0; i < positionCount * 3; i++) positions[i] = r.f32();
  }
  const weightCounts = new Int32Array(positionCount);
  {
    const r = new R(childOf(v, 'TWHD').data);
    for (let i = 0; i < positionCount; i++) weightCounts[i] = r.i32();
  }
  const weightStart = new Int32Array(positionCount);
  for (let i = 1; i < positionCount; i++) weightStart[i] = weightStart[i - 1] + weightCounts[i - 1];
  const weightTransform = new Int32Array(weightDataCount);
  const weightValue = new Float32Array(weightDataCount);
  {
    const r = new R(childOf(v, 'TWDT').data);
    for (let i = 0; i < weightDataCount; i++) {
      weightTransform[i] = r.i32();
      weightValue[i] = r.f32();
    }
  }
  let normals = null;
  const norm = childOf(v, 'NORM');
  if (norm) {
    normals = new Float32Array(normalCount * 3);
    const r = new R(norm.data);
    for (let i = 0; i < normalCount * 3; i++) normals[i] = r.f32();
  }
  const shaders = [];
  for (const psdt of childrenOf(v, 'PSDT')) {
    const name = new R(childOf(psdt, 'NAME').data).str().replace(/\\/g, '/');
    const pidxR = new R(childOf(psdt, 'PIDX').data);
    const vertexCount = pidxR.i32();
    const positionIndices = new Int32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) positionIndices[i] = pidxR.i32();
    let normalIndices = null;
    const nidx = childOf(psdt, 'NIDX');
    if (nidx) {
      const r = new R(nidx.data);
      normalIndices = new Int32Array(vertexCount);
      for (let i = 0; i < vertexCount; i++) normalIndices[i] = r.i32();
    }
    const uvSets = [];
    const txci = childOf(psdt, 'TXCI');
    if (txci) {
      const r = new R(txci.data);
      const setCount = r.i32();
      const dims = [];
      for (let i = 0; i < setCount; i++) dims.push(r.i32());
      const tcsf = childOf(psdt, 'TCSF');
      if (tcsf) {
        const chunks = childrenOf(tcsf, 'TCSD');
        for (let i = 0; i < setCount && i < chunks.length; i++) {
          const rr = new R(chunks[i].data);
          const dim = dims[i];
          const data = new Float32Array(vertexCount * dim);
          for (let j = 0; j < vertexCount * dim; j++) data[j] = rr.f32();
          uvSets.push({ dim, data });
        }
      }
    }
    const triangles = [];
    const prim = childOf(psdt, 'PRIM');
    if (prim) {
      for (const c of prim.children) {
        if (isForm(c)) continue;
        const r = new R(c.data);
        const tag = c.tag.trim();
        if (tag === 'ITL') {
          const n = r.i32();
          for (let i = 0; i < n; i++) triangles.push(r.i32(), r.i32(), r.i32());
        } else if (tag === 'OITL') {
          const n = r.i32();
          for (let i = 0; i < n; i++) {
            r.i16(); // occlusion zone combination
            triangles.push(r.i32(), r.i32(), r.i32());
          }
        }
      }
    }
    shaders.push({ shader: name, vertexCount, positionIndices, normalIndices, uvSets, triangles: Int32Array.from(triangles) });
  }
  const occlusionZones = [];
  const ozn = childOf(v, 'OZN');
  if (ozn) {
    const r = new R(ozn.data);
    while (r.remaining > 0) occlusionZones.push(r.str());
  }
  return { version, maxTransformsPerVertex, maxTransformsPerShader, skeletons, transforms, positions, weightCounts, weightStart, weightTransform, weightValue, normals, shaders, blendTargetCount, occlusionZones };
}

/** .lmg: the mesh generator files by detail level (index 0 is the finest). */
export function parseLmg(root) {
  const v = versionForm(root, 'MLOD');
  return childrenOf(v, 'NAME').map((c) => new R(c.data).str().replace(/\\/g, '/'));
}

// ---------------------------------------------------------------------------------------------
// Skeletal appearance template (.sat)
export function parseSat(root) {
  const v = versionForm(root, 'SMAT');
  const info = new R(childOf(v, 'INFO').data);
  const meshCount = info.i32();
  const skeletonCount = info.i32();
  const meshes = [];
  {
    const r = new R(childOf(v, 'MSGN').data);
    for (let i = 0; i < meshCount; i++) meshes.push(r.str().replace(/\\/g, '/'));
  }
  const skeletons = [];
  {
    const r = new R(childOf(v, 'SKTI').data);
    for (let i = 0; i < skeletonCount; i++) skeletons.push({ file: r.str().replace(/\\/g, '/'), attachTo: r.str() });
  }
  const animationTables = new Map();
  const latx = childOf(v, 'LATX');
  if (latx) {
    const r = new R(latx.data);
    const n = r.i16();
    for (let i = 0; i < n; i++) animationTables.set(r.str().replace(/\\/g, '/').toLowerCase(), r.str().replace(/\\/g, '/'));
  }
  return { version: v.type, meshes, skeletons, animationTables };
}

// ---------------------------------------------------------------------------------------------
// Logical animation table (.lat)
export function parseLat(root) {
  const v = versionForm(root, 'LATT');
  const info = new R(childOf(v, 'INFO').data);
  const hierarchy = info.str();
  const count = info.i16();
  const entries = [];
  for (const anim of childrenOf(v, 'ANIM')) {
    const name = new R(childOf(anim, 'INFO').data).str().trim();
    const template = anim.children.find(isForm);
    entries.push(...flattenAnimationTemplate(template, name));
  }
  void count;
  return { hierarchy, entries };
}

/**
 * The keyframe animations an animation template form resolves to, unwrapping the selector
 * templates the client picks from at run time: KFAT (inline keyframes), PXAT (a .ans file),
 * SSAT (chosen by a named string variable; each value becomes "name:value"), SPAT (chosen by
 * speed; "name:speedN"), DRAT (chosen by direction; the forward one keeps the name, the
 * others get ":dirN"), TSCL (time scaled), AGAT (a loop with random emotes; the loop),
 * PBAT (priority blend; the primary component).
 */
export function flattenAnimationTemplate(form, name, timeScale = 1) {
  if (!form) return [{ name, kind: 'none' }];
  const v = form.children.find(isForm);
  switch (form.type) {
    case 'KFAT':
      return [{ name, kind: 'inline', form, timeScale }];
    case 'PXAT': {
      const target = new R(childOf(v, 'INFO').data).str().replace(/\\/g, '/');
      return [{ name, kind: 'file', file: target.includes('/') ? target : `appearance/animation/${target}${/\.ans$/i.test(target) ? '' : '.ans'}`, timeScale }];
    }
    case 'TSCL': {
      const scale = new R(childOf(v, 'INFO').data).f32();
      const child = v.children.filter(isForm)[0];
      return flattenAnimationTemplate(child, name, timeScale * (scale || 1));
    }
    case 'AGAT': {
      const loop = childOf(v, 'LOOP');
      const child = loop && loop.children.find(isForm);
      return flattenAnimationTemplate(child, name, timeScale);
    }
    case 'PBAT': {
      const primary = new R(childOf(v, 'INFO').data).i8();
      const comps = childrenOf(v, 'COMP');
      const child = (comps[primary] ?? comps[0])?.children.find(isForm);
      return flattenAnimationTemplate(child, name, timeScale);
    }
    case 'SPAT': {
      const children = v.children.filter(isForm);
      return children.flatMap((c, i) => flattenAnimationTemplate(c, `${name}:speed${i}`, timeScale));
    }
    case 'YWAT': {
      // Yaw selector: the straight-ahead animation keeps the name; turning variants get :left/:right.
      const out = [];
      for (const [tag, suffix] of [['NONE', ''], ['YNEG', ':left'], ['YPOS', ':right']]) {
        const holder = childOf(v, tag);
        const child = holder && holder.children.find(isForm);
        if (child) out.push(...flattenAnimationTemplate(child, `${name}${suffix}`, timeScale));
      }
      return out;
    }
    case 'DRAT': {
      const out = [];
      for (const dir of childrenOf(v, 'DIR')) {
        const code = new R(childOf(dir, 'INFO').data).i8();
        const child = dir.children.find(isForm);
        out.push(...flattenAnimationTemplate(child, code === 0 ? name : `${name}:dir${code}`, timeScale));
      }
      return out;
    }
    case 'SSAT': {
      const variable = new R(childOf(v, 'INFO').data).str();
      const anms = childOf(v, 'ANMS');
      const templates = anms ? anms.children.filter(isForm) : [];
      const values = new Map(); // template index -> value names
      const vals = childOf(v, 'VALS');
      if (vals) {
        const r = new R(vals.data);
        const n = r.i16();
        for (let i = 0; i < n; i++) {
          const value = r.str();
          const index = r.i16();
          values.set(index, [...(values.get(index) ?? []), value]);
        }
      }
      const dflt = childOf(v, 'DFLT');
      const defaultIndex = dflt ? new R(dflt.data).i16() : -1;
      const out = [];
      templates.forEach((t, i) => {
        const label = values.get(i)?.[0];
        const entryName = i === defaultIndex && !label ? name : `${name}:${label ?? i}`;
        for (const e of flattenAnimationTemplate(t, entryName, timeScale)) out.push({ ...e, variable, values: values.get(i) ?? [], isDefault: i === defaultIndex });
      });
      return out;
    }
    default:
      return [{ name, kind: form.type, timeScale }];
  }
}

// ---------------------------------------------------------------------------------------------
// Keyframe animation (.ans)
export function parseAnimation(root) {
  const v = versionForm(root, 'KFAT');
  const version = Number.parseInt(v.type, 10);
  if (version !== 3) throw new Error(`KFAT: unsupported version ${v.type}`);
  const info = new R(childOf(v, 'INFO').data);
  const fps = info.f32();
  const frameCount = info.i32();
  info.i32(); // transform info count
  const transforms = [];
  for (const xfin of childrenOf(childOf(v, 'XFRM'), 'XFIN')) {
    const r = new R(xfin.data);
    transforms.push({ name: r.str(), animatedRotation: r.i8() !== 0, rotationIndex: r.i32(), translationMask: r.u32(), xIndex: r.i32(), yIndex: r.i32(), zIndex: r.i32() });
  }
  const rotationChannels = [];
  const arot = childOf(v, 'AROT');
  if (arot) {
    for (const q of childrenOf(arot, 'QCHN')) {
      const r = new R(q.data);
      const n = r.i32();
      const keys = [];
      for (let i = 0; i < n; i++) keys.push({ frame: r.i32(), q: r.quat() });
      rotationChannels.push(keys);
    }
  }
  const staticRotations = [];
  const srot = childOf(v, 'SROT');
  if (srot) {
    const r = new R(srot.data);
    while (r.remaining >= 16) staticRotations.push(r.quat());
  }
  const translationChannels = [];
  const atrn = childOf(v, 'ATRN');
  if (atrn) {
    for (const c of childrenOf(atrn, 'CHNL')) {
      const r = new R(c.data);
      const n = r.i32();
      const keys = [];
      for (let i = 0; i < n; i++) keys.push({ frame: r.i32(), v: r.f32() });
      translationChannels.push(keys);
    }
  }
  const staticTranslations = [];
  const strn = childOf(v, 'STRN');
  if (strn) {
    const r = new R(strn.data);
    while (r.remaining >= 4) staticTranslations.push(r.f32());
  }
  return { version, fps, frameCount, transforms, rotationChannels, staticRotations, translationChannels, staticTranslations };
}

// ---------------------------------------------------------------------------------------------
// Quaternion helpers on [w, x, y, z] (the engine's product is the Hamilton product).
export function qmul(a, b) {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [aw * bw - ax * bx - ay * by - az * bz, aw * bx + bw * ax + (ay * bz - az * by), aw * by + bw * ay + (az * bx - ax * bz), aw * bz + bw * az + (ax * by - ay * bx)];
}
export function qnorm(q) {
  const m = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / m, q[1] / m, q[2] / m, q[3] / m];
}
function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) {
    d = -d;
    bb = [-b[0], -b[1], -b[2], -b[3]];
  }
  if (d > 0.9995) return qnorm([a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t]);
  const th = Math.acos(d);
  const sa = Math.sin((1 - t) * th) / Math.sin(th);
  const sb = Math.sin(t * th) / Math.sin(th);
  return [a[0] * sa + bb[0] * sb, a[1] * sa + bb[1] * sb, a[2] * sa + bb[2] * sb, a[3] * sa + bb[3] * sb];
}
function sampleRotation(keys, frame) {
  if (!keys.length) return [1, 0, 0, 0];
  if (frame <= keys[0].frame) return keys[0].q;
  for (let i = 1; i < keys.length; i++) {
    if (frame <= keys[i].frame) {
      const a = keys[i - 1];
      const b = keys[i];
      const t = b.frame === a.frame ? 0 : (frame - a.frame) / (b.frame - a.frame);
      return slerp(a.q, b.q, t);
    }
  }
  return keys[keys.length - 1].q;
}
function sampleValue(keys, frame) {
  if (!keys.length) return 0;
  if (frame <= keys[0].frame) return keys[0].v;
  for (let i = 1; i < keys.length; i++) {
    if (frame <= keys[i].frame) {
      const a = keys[i - 1];
      const b = keys[i];
      const t = b.frame === a.frame ? 0 : (frame - a.frame) / (b.frame - a.frame);
      return a.v + (b.v - a.v) * t;
    }
  }
  return keys[keys.length - 1].v;
}

/** Joint-local rotation and translation of every joint for one animation frame (SWG space). */
export function poseAtFrame(skeleton, animation, frame) {
  const byName = new Map(animation ? animation.transforms.map((t, i) => [t.name.toLowerCase(), i]) : []);
  return skeleton.joints.map((j) => {
    let animRot = [1, 0, 0, 0];
    let animT = [0, 0, 0];
    const ti = byName.get(j.name.toLowerCase());
    if (animation && ti !== undefined) {
      const t = animation.transforms[ti];
      animRot = t.animatedRotation ? sampleRotation(animation.rotationChannels[t.rotationIndex] ?? [], frame) : (animation.staticRotations[t.rotationIndex] ?? [1, 0, 0, 0]);
      const axis = (bit, index) => ((t.translationMask & bit) !== 0 ? sampleValue(animation.translationChannels[index] ?? [], frame) : (animation.staticTranslations[index] ?? 0));
      animT = [axis(0x08, t.xIndex), axis(0x10, t.yIndex), axis(0x20, t.zIndex)];
    }
    const rotation = qnorm(qmul(j.post, qmul(qmul(animRot, j.bindR), j.pre)));
    const translation = [j.bindT[0] + animT[0], j.bindT[1] + animT[1], j.bindT[2] + animT[2]];
    return { rotation, translation };
  });
}

// ---------------------------------------------------------------------------------------------
// Matrices (column-major 4x4) for the inverse bind matrices.
function matFromTR(q, t) {
  const [w, x, y, z] = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy), 0, 2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx), 0, 2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy), 0, t[0], t[1], t[2], 1];
}
function matMul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function matInvertRigid(m) {
  // rotation transpose, translation negated and rotated
  const r = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
  const t = [m[12], m[13], m[14]];
  r[12] = -(r[0] * t[0] + r[4] * t[1] + r[8] * t[2]);
  r[13] = -(r[1] * t[0] + r[5] * t[1] + r[9] * t[2]);
  r[14] = -(r[2] * t[0] + r[6] * t[1] + r[10] * t[2]);
  return r;
}

/** Mirror across the YZ plane, matching the converter's negated X: q -> (w, x, -y, -z), t.x -> -t.x. */
const mirrorQ = (q) => [q[0], q[1], -q[2], -q[3]];
const mirrorT = (t) => [-t[0], t[1], t[2]];

/**
 * Everything buildGlb needs for a skinned model: joint nodes with mirrored bind-pose TRS and
 * inverse bind matrices, plus baked animations (per frame keys) named by their logical name.
 */
export function skinData(skeleton, animations, { flipX = true } = {}) {
  const bind = poseAtFrame(skeleton, null, 0);
  const joints = skeleton.joints.map((j, i) => ({ name: j.name, parent: j.parent, rotation: flipX ? mirrorQ(bind[i].rotation) : bind[i].rotation, translation: flipX ? mirrorT(bind[i].translation) : bind[i].translation }));
  const world = [];
  const inverseBind = [];
  joints.forEach((j, i) => {
    const local = matFromTR(j.rotation, j.translation);
    world[i] = j.parent >= 0 ? matMul(world[j.parent], local) : local;
    inverseBind.push(matInvertRigid(world[i]));
  });
  const clips = [];
  for (const { name, animation } of animations) {
    const frames = Math.max(1, animation.frameCount);
    const times = new Float32Array(frames);
    const tracks = skeleton.joints.map(() => ({ rotations: new Float32Array(frames * 4), translations: new Float32Array(frames * 3) }));
    for (let f = 0; f < frames; f++) {
      times[f] = f / (animation.fps || 30);
      const pose = poseAtFrame(skeleton, animation, f);
      pose.forEach((p, i) => {
        const q = flipX ? mirrorQ(p.rotation) : p.rotation;
        const t = flipX ? mirrorT(p.translation) : p.translation;
        // glTF wants x y z w
        tracks[i].rotations.set([q[1], q[2], q[3], q[0]], f * 4);
        tracks[i].translations.set(t, f * 3);
      });
    }
    clips.push({ name, times, tracks, duration: times[frames - 1] });
  }
  return { joints, inverseBind, clips };
}

/** Vertex streams for one mesh generator's shader groups, as buildGlb primitives with skin data. */
export function skinnedPrimitives(mgn, skeleton) {
  const jointIndex = new Map(skeleton.joints.map((j, i) => [j.name.toLowerCase(), i]));
  const transformToJoint = mgn.transforms.map((t) => jointIndex.get(t.toLowerCase()) ?? -1);
  const groups = [];
  let unknownTransforms = 0;
  for (const s of mgn.shaders) {
    const n = s.vertexCount;
    const positions = new Float32Array(n * 3);
    const normals = mgn.normals && s.normalIndices ? new Float32Array(n * 3) : null;
    const uvs = s.uvSets[0] && s.uvSets[0].dim >= 2 ? new Float32Array(n * 2) : null;
    const joints = new Uint16Array(n * 4);
    const weights = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const p = s.positionIndices[i];
      positions.set(mgn.positions.subarray(p * 3, p * 3 + 3), i * 3);
      if (normals) {
        const ni = s.normalIndices[i];
        normals.set(mgn.normals.subarray(ni * 3, ni * 3 + 3), i * 3);
      }
      if (uvs) {
        const d = s.uvSets[0].dim;
        uvs[i * 2] = s.uvSets[0].data[i * d];
        uvs[i * 2 + 1] = s.uvSets[0].data[i * d + 1];
      }
      // Up to four strongest joints per vertex, renormalised.
      const start = mgn.weightStart[p];
      const list = [];
      for (let k = 0; k < mgn.weightCounts[p]; k++) {
        const j = transformToJoint[mgn.weightTransform[start + k]];
        if (j < 0) {
          unknownTransforms++;
          continue;
        }
        list.push([j, mgn.weightValue[start + k]]);
      }
      list.sort((a, b) => b[1] - a[1]);
      const top = list.slice(0, 4);
      const sum = top.reduce((a, [, w]) => a + w, 0) || 1;
      top.forEach(([j, w], k) => {
        joints[i * 4 + k] = j;
        weights[i * 4 + k] = w / sum;
      });
      if (!top.length) weights[i * 4] = 1;
    }
    groups.push({ shader: s.shader, primitives: [{ positions, normals, uvs, indices: Uint32Array.from(s.triangles), joints, weights }] });
  }
  return { groups, unknownTransforms };
}

/** Load and parse a file from the archives. */
export const readIff = (vfs, path) => parseIff(vfs.read(path));
