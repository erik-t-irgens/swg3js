// A portable animation bundle: the clips of a converted character, lifted out of its GLB so they
// survive the model being converted again.
//
// This exists for the Jedi Academy clips. Importing those needs a Jedi Academy install, and a
// character that has been through `jka-clips` carries hundreds of clips that cannot be rebuilt
// without it -- so re-converting the model to add anything (morph targets, split meshes, new
// clothing) would throw them away. Saving them to a bundle first makes the model disposable and
// the animation work permanent.
//
// Layout: 'SWGC', uint32 version, uint32 JSON length, the JSON header, then one float32 blob.
// The header names the joints the tracks are ordered by and, for each clip, where its times and
// per-joint rotations and translations sit in the blob.

const MAGIC = 'SWGC';
const VERSION = 1;

/**
 * Pack extractClips output into one buffer. `meta` is whatever the GLB itself cannot hold and the
 * game still needs -- a Jedi Academy clip's loop flag and frame rate, a clip's playback speed.
 * Losing that is as bad as losing the clip: without the loop flags every attack repeats instead
 * of finishing on its last frame.
 */
export function packClips({ clips, joints, meta }) {
  const parts = [];
  let offset = 0;
  const put = (arr) => {
    const at = offset;
    parts.push(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength));
    offset += arr.length;
    return at;
  };
  const header = {
    joints,
    meta: meta ?? null,
    clips: clips.map((c) => {
      const times = put(c.times);
      const tracks = c.tracks.map((t) => ({ r: put(t.rotations), t: put(t.translations) }));
      return { name: c.name, frames: c.times.length, times, tracks };
    }),
  };
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const head = Buffer.alloc(12);
  head.write(MAGIC, 0, 'latin1');
  head.writeUInt32LE(VERSION, 4);
  head.writeUInt32LE(json.length, 8);
  return Buffer.concat([head, json, ...parts]);
}

/** Unpack a bundle into extractClips' shape. */
export function unpackClips(buf) {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== MAGIC) throw new Error('not a clip bundle (bad magic)');
  const version = buf.readUInt32LE(4);
  if (version !== VERSION) throw new Error(`clip bundle version ${version}, expected ${VERSION}`);
  const jsonLength = buf.readUInt32LE(8);
  const header = JSON.parse(buf.toString('utf8', 12, 12 + jsonLength));
  const blobStart = 12 + jsonLength;
  // The blob is float32 and may not be 4-byte aligned in the file, so copy rather than view.
  const floats = new Float32Array((buf.length - blobStart) / 4);
  for (let i = 0; i < floats.length; i++) floats[i] = buf.readFloatLE(blobStart + i * 4);
  const slice = (at, len) => floats.subarray(at, at + len);
  const clips = header.clips.map((c) => ({
    name: c.name,
    times: slice(c.times, c.frames),
    tracks: c.tracks.map((t) => ({ rotations: slice(t.r, c.frames * 4), translations: slice(t.t, c.frames * 3) })),
  }));
  return { clips, joints: header.joints, meta: header.meta ?? null };
}

/**
 * Reorder a bundle's tracks onto another skeleton's joints, by joint name. Joints the bundle does
 * not carry keep their bind pose, which is what a clip that leaves a joint alone means anyway.
 */
export function retargetClips({ clips, joints }, targetJoints) {
  const indexOf = new Map(joints.map((n, i) => [n, i]));
  const missing = targetJoints.filter((j) => !indexOf.has(j.name ?? j));
  const order = targetJoints.map((j) => indexOf.get(j.name ?? j));
  const out = clips.map((c) => ({
    name: c.name,
    times: c.times,
    tracks: order.map((src, i) => {
      if (src !== undefined) return c.tracks[src];
      const joint = targetJoints[i];
      const frames = c.times.length;
      const rotations = new Float32Array(frames * 4);
      const translations = new Float32Array(frames * 3);
      const r = joint.rotation ?? [1, 0, 0, 0];
      const t = joint.translation ?? [0, 0, 0];
      for (let f = 0; f < frames; f++) {
        rotations.set([r[1], r[2], r[3], r[0]], f * 4);
        translations.set(t, f * 3);
      }
      return { rotations, translations };
    }),
  }));
  return { clips: out, missing: missing.map((j) => j.name ?? j) };
}
