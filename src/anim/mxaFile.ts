// The neutral clip pack (`public/anims/mixamo/`): its index and its clip files, read by the game and written by the
// importer (`tools/anim/`). Nothing in a pack derives from the game's own files: it is the source's motion in the
// source's own frame (Y up, facing +Z, left +X, metres), each bone's world rotation as a delta from its rest pose,
// so one pack fits any skeleton the fitter is handed (`fit.ts`).
//
// A clip file (`<id>.mxa`) is a fixed header and two blocks:
//
//   0   4 bytes  'MXA1'
//   4   uint16   frames
//   6   uint16   bones
//   8   float32  duration, seconds (frame i stands at i * duration / (frames - 1))
//   12  int16    frames * bones * 4: each bone's delta D = Rworld(t) * Rworld(rest)^-1 as x, y, z, w times 32767,
//                frame by frame, bone by bone in the index's own bone order, the sign kept continuous down each
//                bone's frames so a reader may blend neighbouring frames linearly
//   ..  float32  frames * 3: the hips' travel from their rest place, metres
//
// Pure: no three.js, no DOM and no file system, so the importer, the game and the node tests run the same lines.

/** The pack's format number: a reader refuses any other. */
export const PACK_FORMAT = 1;
/** The rate clips are resampled to. A clip's own frames stand evenly over its duration, so the true rate is within a frame of this. */
export const PACK_FPS = 30;
export const MXA_MAGIC = 'MXA1';
export const MXA_HEADER_BYTES = 12;
const Q_SCALE = 32767;

/** One bone of the pack's skeleton: its name with the source's prefix stripped, its parent in the list, and where it rests (metres, the source's frame). */
export interface PackBone {
  name: string;
  /** Index of its parent in the bone list, -1 for the hips. */
  parent: number;
  rest: [number, number, number];
}

export interface FootMark {
  /** Seconds into the clip. */
  t: number;
  foot: 'L' | 'R';
}

/** One clip as the index lists it. */
export interface PackClipRow {
  /** Its id (`falling_flat_impact`); the game's clip name is `mx_<id>`. */
  id: string;
  file: string;
  frames: number;
  duration: number;
  loop: boolean;
  /** The hips' net displacement from the first frame to the last, metres. Recorded; the fitter takes it out. */
  travelNet: [number, number, number];
  /** How fast the body moves over the ground by its planted feet, m/s at the source's size; 0 where no foot is planted. */
  speed: number;
  /** Which way it moves, degrees: 0 forward, +90 left, -90 right, 180 back. */
  heading: number;
  /** Each moment a foot comes down. */
  feet: FootMark[];
  /** Where a one-off starts when the game plays it, seconds (the owner's trims). */
  trimStart: number;
  /**
   * For an airborne loop authored off the ground (the importer's table says which), how far its hips ride over their
   * rest on average, metres: the fitter takes it out, so the body rides in its capsule and not over it.
   */
  level?: number;
  /** For a mirrored twin, the clip it mirrors. */
  mirrorOf?: string;
  /** Whether the game loads it at start (the rest are fetched when the console asks). */
  use: boolean;
  /** The source file's name, relative to the imported folder. */
  source: string;
  /** A hash of the clip file's bytes, so a re-import is never served stale. */
  hash: string;
}

export interface PackIndex {
  format: number;
  fps: number;
  bones: PackBone[];
  clips: PackClipRow[];
}

/** One clip's samples. */
export interface ClipData {
  frames: number;
  bones: number;
  duration: number;
  /** frames * bones * 4, x y z w: each bone's world rotation delta from rest. */
  quats: Float32Array;
  /** frames * 3: the hips' travel from rest, metres. */
  travel: Float32Array;
}

/** The game's name for a pack clip. */
export const clipName = (id: string): string => `mx_${id}`;

/**
 * A name as a clip's id: lower case, every run of anything else one underscore (`Walking (1)` is `walking_1`). The
 * importer names a file's clip by it, and the console finds a clip by the same rule, so a file's own name asks for its clip.
 */
export function clipSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** When frame `i` of a clip stands, seconds: the one rule the importer samples by and the fitter times its tracks by. */
export function frameTime(i: number, frames: number, duration: number): number {
  return frames > 1 ? (i * duration) / (frames - 1) : 0;
}

/**
 * Each bone's frames given one sign: a quaternion and its negative are the same turn, and a reader that blends two
 * neighbouring frames linearly needs them on the same side. In place.
 */
export function continuousSign(quats: Float32Array, frames: number, bones: number): void {
  for (let b = 0; b < bones; b++) {
    for (let f = 1; f < frames; f++) {
      const a = ((f - 1) * bones + b) * 4;
      const c = (f * bones + b) * 4;
      const dot = quats[a] * quats[c] + quats[a + 1] * quats[c + 1] + quats[a + 2] * quats[c + 2] + quats[a + 3] * quats[c + 3];
      if (dot < 0) {
        quats[c] = -quats[c];
        quats[c + 1] = -quats[c + 1];
        quats[c + 2] = -quats[c + 2];
        quats[c + 3] = -quats[c + 3];
      }
    }
  }
}

/** A clip as its file's bytes. */
export function encodeMxa(clip: ClipData): Uint8Array {
  const { frames, bones } = clip;
  if (!(frames >= 1 && frames <= 65535) || !(bones >= 1 && bones <= 65535)) throw new Error(`a clip of ${frames} frames and ${bones} bones cannot be written`);
  if (clip.quats.length !== frames * bones * 4 || clip.travel.length !== frames * 3) throw new Error('a clip whose arrays do not match its counts cannot be written');
  const qBytes = frames * bones * 8;
  const out = new Uint8Array(MXA_HEADER_BYTES + qBytes + frames * 12);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = MXA_MAGIC.charCodeAt(i);
  dv.setUint16(4, frames, true);
  dv.setUint16(6, bones, true);
  dv.setFloat32(8, clip.duration, true);
  let at = MXA_HEADER_BYTES;
  for (let i = 0; i < clip.quats.length; i++, at += 2) {
    const v = Math.round(clip.quats[i] * Q_SCALE);
    dv.setInt16(at, v > Q_SCALE ? Q_SCALE : v < -Q_SCALE ? -Q_SCALE : v, true);
  }
  for (let i = 0; i < clip.travel.length; i++, at += 4) dv.setFloat32(at, clip.travel[i], true);
  return out;
}

/** A clip file read; throws on a file that is not one, cut short, or of counts that do not fit it. */
export function decodeMxa(bytes: ArrayBuffer | Uint8Array): ClipData {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.byteLength < MXA_HEADER_BYTES) throw new Error('not a clip file: too short');
  for (let i = 0; i < 4; i++) if (u8[i] !== MXA_MAGIC.charCodeAt(i)) throw new Error('not a clip file');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const frames = dv.getUint16(4, true);
  const bones = dv.getUint16(6, true);
  const duration = dv.getFloat32(8, true);
  const need = MXA_HEADER_BYTES + frames * bones * 8 + frames * 12;
  if (!frames || !bones || u8.byteLength !== need) throw new Error(`a clip file of ${frames} frames and ${bones} bones is ${need} bytes, and this one is ${u8.byteLength}`);
  if (!(duration >= 0) || !Number.isFinite(duration)) throw new Error('a clip file with no length');
  const quats = new Float32Array(frames * bones * 4);
  let at = MXA_HEADER_BYTES;
  for (let i = 0; i < quats.length; i += 4, at += 8) {
    const x = dv.getInt16(at, true), y = dv.getInt16(at + 2, true), z = dv.getInt16(at + 4, true), w = dv.getInt16(at + 6, true);
    // Made unit again: sixteen bits a component leaves a length a few parts in a hundred thousand off one.
    const n = Math.hypot(x, y, z, w) || 1;
    quats[i] = x / n;
    quats[i + 1] = y / n;
    quats[i + 2] = z / n;
    quats[i + 3] = w / n;
  }
  const travel = new Float32Array(frames * 3);
  for (let i = 0; i < travel.length; i++, at += 4) travel[i] = dv.getFloat32(at, true);
  return { frames, bones, duration, quats, travel };
}

/** The other side's bone for each bone (`LeftArm` for `RightArm`), itself for a bone of the middle. Throws when a side's twin is missing. */
export function mirrorMap(names: readonly string[]): Int32Array {
  const index = new Map(names.map((n, i) => [n, i]));
  const out = new Int32Array(names.length);
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    const twin = n.startsWith('Left') ? `Right${n.slice(4)}` : n.startsWith('Right') ? `Left${n.slice(5)}` : n;
    const j = index.get(twin);
    if (j === undefined) throw new Error(`${n} has no ${twin} to mirror onto`);
    out[i] = j;
  }
  return out;
}

/**
 * A clip's mirror image through the body's middle plane (left is +X): the left and right bones swapped, every delta
 * reflected ((x, y, z, w) to (x, -y, -z, w)) and the travel's x negated. A new clip; mirroring it again gives the first.
 */
export function mirrorClip(clip: ClipData, names: readonly string[]): ClipData {
  if (names.length !== clip.bones) throw new Error('the bone list is not the clip\'s');
  const twin = mirrorMap(names);
  const quats = new Float32Array(clip.quats.length);
  for (let f = 0; f < clip.frames; f++) {
    for (let b = 0; b < clip.bones; b++) {
      const from = (f * clip.bones + twin[b]) * 4;
      const to = (f * clip.bones + b) * 4;
      quats[to] = clip.quats[from];
      quats[to + 1] = -clip.quats[from + 1] + 0;
      quats[to + 2] = -clip.quats[from + 2] + 0;
      quats[to + 3] = clip.quats[from + 3];
    }
  }
  const travel = new Float32Array(clip.travel.length);
  for (let f = 0; f < clip.frames; f++) {
    travel[f * 3] = -clip.travel[f * 3] + 0;
    travel[f * 3 + 1] = clip.travel[f * 3 + 1];
    travel[f * 3 + 2] = clip.travel[f * 3 + 2];
  }
  return { frames: clip.frames, bones: clip.bones, duration: clip.duration, quats, travel };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(isNum);
const ID = /^[a-z0-9][a-z0-9_]{0,79}$/;

/**
 * An index as the game may use it, rebuilt field by field from whatever was parsed; a string saying why not otherwise.
 * A row that cannot be read is refused with the whole index: a pack is the importer's own output, and one that does
 * not hang together is a pack to import again, not to play half of.
 */
export function readPackIndex(raw: unknown): PackIndex | string {
  const o = raw as Partial<PackIndex> | null;
  if (!o || typeof o !== 'object') return 'the index is not an object';
  if (o.format !== PACK_FORMAT) return `the index is format ${String(o.format)}, and this build reads format ${PACK_FORMAT}`;
  if (!isNum(o.fps) || !Array.isArray(o.bones) || !Array.isArray(o.clips)) return 'the index has no fps, bones or clips';
  const bones: PackBone[] = [];
  for (const [i, b] of o.bones.entries()) {
    if (!b || typeof b.name !== 'string' || !b.name || !Number.isInteger(b.parent) || b.parent < -1 || b.parent >= i || !isVec3(b.rest)) return `bone ${i} cannot be read (a name, a parent before it in the list, a rest place)`;
    bones.push({ name: b.name, parent: b.parent, rest: [b.rest[0], b.rest[1], b.rest[2]] });
  }
  if (!bones.length || bones[0].parent !== -1) return 'the bone list does not begin with the hips';
  if (new Set(bones.map((b) => b.name)).size !== bones.length) return 'two bones share a name';
  const clips: PackClipRow[] = [];
  const seen = new Set<string>();
  for (const c of o.clips) {
    const id = c && typeof c.id === 'string' ? c.id : '';
    if (!ID.test(id) || seen.has(id)) return `a clip's id (${id || 'none'}) is not a plain word of its own`;
    seen.add(id);
    if (c.file !== `${id}.mxa`) return `${id}: its file is not ${id}.mxa`;
    if (!Number.isInteger(c.frames) || c.frames < 2 || !isNum(c.duration) || !(c.duration > 0)) return `${id}: no frames or no length`;
    if (!isVec3(c.travelNet) || !isNum(c.speed) || !isNum(c.heading) || !isNum(c.trimStart) || c.trimStart < 0 || c.trimStart >= c.duration) return `${id}: its travel, speed, heading or trim cannot be read`;
    if (!Array.isArray(c.feet) || !c.feet.every((m) => m && isNum(m.t) && (m.foot === 'L' || m.foot === 'R'))) return `${id}: its foot marks cannot be read`;
    if (typeof c.source !== 'string' || typeof c.hash !== 'string') return `${id}: no source or hash`;
    if (c.mirrorOf !== undefined && typeof c.mirrorOf !== 'string') return `${id}: mirrorOf is not a clip's id`;
    if (c.level !== undefined && !isNum(c.level)) return `${id}: its level is not a number`;
    clips.push({
      id,
      file: c.file,
      frames: c.frames,
      duration: c.duration,
      loop: c.loop === true,
      travelNet: [c.travelNet[0], c.travelNet[1], c.travelNet[2]],
      speed: c.speed,
      heading: c.heading,
      feet: c.feet.map((m) => ({ t: m.t, foot: m.foot })),
      trimStart: c.trimStart,
      ...(c.level !== undefined ? { level: c.level } : {}),
      ...(c.mirrorOf !== undefined ? { mirrorOf: c.mirrorOf } : {}),
      use: c.use === true,
      source: c.source,
      hash: c.hash,
    });
  }
  for (const c of clips) if (c.mirrorOf !== undefined && !seen.has(c.mirrorOf)) return `${c.id}: it mirrors ${c.mirrorOf}, which the index has not got`;
  return { format: PACK_FORMAT, fps: o.fps, bones, clips };
}
