// What the importer measures of a clip, from the pack's own samples (each bone's world rotation delta from rest and
// the hips' travel): where the bones are, whether it loops, how far it travels, when each foot is planted, how fast and
// which way the planted feet say the body moves, and when each foot comes down. Pure: it reads a clip and the bone
// list and nothing else, so a mirrored twin is measured exactly as its original is, and the node test measures a walk
// it made itself.

/** Rotate a vector by a quaternion read from an array (x, y, z, w at `at`). */
function rotate(q, at, x, y, z, out) {
  const qx = q[at], qy = q[at + 1], qz = q[at + 2], qw = q[at + 3];
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out[0] = x + qw * tx + (qy * tz - qz * ty);
  out[1] = y + qw * ty + (qz * tx - qx * tz);
  out[2] = z + qw * tz + (qx * ty - qy * tx);
  return out;
}

/**
 * Every bone's place at a frame, metres in the source's frame, into `out` (bones * 3). A bone stands where its parent
 * stands plus its rest offset from that parent turned by the parent's delta; the hips stand at their rest plus the travel.
 */
export function posePositions(clip, bones, frame, out = new Float64Array(bones.length * 3)) {
  const v = [0, 0, 0];
  for (let b = 0; b < bones.length; b++) {
    const bone = bones[b];
    if (bone.parent < 0) {
      out[b * 3] = bone.rest[0] + clip.travel[frame * 3];
      out[b * 3 + 1] = bone.rest[1] + clip.travel[frame * 3 + 1];
      out[b * 3 + 2] = bone.rest[2] + clip.travel[frame * 3 + 2];
      continue;
    }
    const p = bones[bone.parent];
    rotate(clip.quats, (frame * clip.bones + bone.parent) * 4, bone.rest[0] - p.rest[0], bone.rest[1] - p.rest[1], bone.rest[2] - p.rest[2], v);
    out[b * 3] = out[bone.parent * 3] + v[0];
    out[b * 3 + 1] = out[bone.parent * 3 + 1] + v[1];
    out[b * 3 + 2] = out[bone.parent * 3 + 2] + v[2];
  }
  return out;
}

/** The angle between two frames' deltas of one bone, degrees. */
function angleBetween(q, a, b) {
  const dot = Math.abs(q[a] * q[b] + q[a + 1] * q[b + 1] + q[a + 2] * q[b + 2] + q[a + 3] * q[b + 3]);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

/**
 * The importer's numbers of judgement. They sort clips for a report and a default; the table (`mixamoClips.mjs`)
 * overrides any of them a clip at a time.
 */
export const ANALYZE = {
  /** A clip loops when no bone's first and last poses differ by more than this, degrees... */
  loopAngle: 6,
  /** ...and the hips end no further than this from the height they began at, metres. */
  loopHeight: 0.03,
  /** A foot is planted while its ankle or its toe is within this of the lowest that point gets in the clip, metres... */
  plantNear: 0.035,
  /** ...and moves up or down no faster than this, m/s. */
  plantStill: 0.45,
  /** A foot whose ankle never comes within this of its standing height is never on the ground at all (a hang, a fall, a swim stroke), metres. */
  floorNear: 0.12,
  /** A foot off the ground for fewer frames than this never left it (a step's swing is a dozen frames; a heel rolling onto a toe is one or two)... */
  minLift: 4,
  /** ...and one on the ground for fewer than this never came down. */
  minPlant: 2,
  /** A clip whose planted feet say the body moves at least this fast goes somewhere, m/s, and its feet are looked at again... */
  goes: 0.35,
  /** ...keeping as planted only a foot that moves back under the hips at this share of that speed or more. */
  withBody: 0.4,
};

const FEET = [
  { foot: 'L', ankle: 'LeftFoot', toe: 'LeftToeBase' },
  { foot: 'R', ankle: 'RightFoot', toe: 'RightToeBase' },
];

/**
 * A foot's planted frames with the noise taken out: first a lift shorter than `minLift` frames is filled in, then a
 * plant shorter than `minPlant` is dropped. A run touching either end of a clip that does not loop is left as it is
 * (nothing says how long it really was); in a loop the two ends are one run.
 */
export function settle(flags, minLift, minPlant, cyclic) {
  const n = flags.length;
  const out = flags.slice();
  if (n < 3) return out;
  for (const [value, min] of [[false, minLift], [true, minPlant]]) {
    // Every run of `value`, as [start, length]; in a loop a run over the seam is one run.
    const runs = [];
    let i = 0;
    while (i < n) {
      if (out[i] !== value) { i++; continue; }
      let j = i;
      while (j < n && out[j] === value) j++;
      runs.push([i, j - i]);
      i = j;
    }
    if (!runs.length || runs[0][1] === n) continue;
    if (cyclic && runs.length > 1 && runs[0][0] === 0 && runs[runs.length - 1][0] + runs[runs.length - 1][1] === n) {
      const tail = runs.pop();
      runs[0] = [tail[0], tail[1] + runs[0][1]];
    }
    for (const [start, length] of runs) {
      const atEdge = !cyclic && (start === 0 || start + length >= n);
      if (length >= min || atEdge) continue;
      for (let k = 0; k < length; k++) out[(start + k) % n] = !value;
    }
  }
  return out;
}

/**
 * A clip measured. `ground: false` (the table's word for a clip with no ground under it: a swim, a fall, a hang)
 * leaves the feet out: no plants, no speed, no marks.
 */
export function analyzeClip(clip, bones, { ground = true, tune = ANALYZE } = {}) {
  const { frames } = clip;
  const index = new Map(bones.map((b, i) => [b.name, i]));
  const last = frames - 1;
  // Whether it loops: every bone ends as it began, and the hips at the height they began at.
  let endAngle = 0;
  for (let b = 0; b < clip.bones; b++) endAngle = Math.max(endAngle, angleBetween(clip.quats, b * 4, (last * clip.bones + b) * 4));
  const endRise = clip.travel[last * 3 + 1] - clip.travel[1];
  const loop = endAngle <= tune.loopAngle && Math.abs(endRise) <= tune.loopHeight;
  const travelNet = [clip.travel[last * 3] - clip.travel[0], endRise, clip.travel[last * 3 + 2] - clip.travel[2]];

  // Every frame's ankles, toes and hips.
  const pose = new Float64Array(bones.length * 3);
  const dt = frames > 1 ? clip.duration / (frames - 1) : 0;
  const tracks = FEET.map((f) => ({ ...f, a: index.get(f.ankle), t: index.get(f.toe), ankle: new Float64Array(frames * 3), toe: new Float64Array(frames * 3) }));
  const hips = new Float64Array(frames * 3);
  for (let f = 0; f < frames; f++) {
    posePositions(clip, bones, f, pose);
    hips.set(pose.subarray(0, 3), f * 3);
    for (const tr of tracks) {
      if (tr.a === undefined || tr.t === undefined) continue;
      tr.ankle.set(pose.subarray(tr.a * 3, tr.a * 3 + 3), f * 3);
      tr.toe.set(pose.subarray(tr.t * 3, tr.t * 3 + 3), f * 3);
    }
  }
  // How high the lower foot stands over the source's floor at each frame: an ankle's height less its standing height.
  const floorOf = (f) => {
    let low = Infinity;
    for (const tr of tracks) {
      if (tr.a === undefined) continue;
      low = Math.min(low, tr.ankle[f * 3 + 1] - bones[tr.a].rest[1], tr.toe[f * 3 + 1] - bones[tr.t].rest[1]);
    }
    return Number.isFinite(low) ? low : 0;
  };
  const footHeight = new Float64Array(frames);
  for (let f = 0; f < frames; f++) footHeight[f] = floorOf(f);

  // A velocity at a frame, by the frames either side of it (the neighbours across the seam for a loop).
  const span = loop ? last : frames;
  const vel = (arr, f, k) => {
    if (frames < 2 || dt <= 0) return 0;
    let a = f - 1, b = f + 1;
    if (loop) {
      a = (a + span) % span;
      b = b % span;
      // Across the seam a travelling loop's place jumps by its net travel, which is no motion.
      let d = arr[b * 3 + k] - arr[a * 3 + k];
      if (b < a) d += travelNet[k];
      return d / (2 * dt);
    }
    a = Math.max(0, a);
    b = Math.min(last, b);
    return b > a ? (arr[b * 3 + k] - arr[a * 3 + k]) / ((b - a) * dt) : 0;
  };

  const feet = [];
  let sumX = 0, sumZ = 0, sumLen = 0, samples = 0;
  const planted = { L: 0, R: 0 };
  if (ground && frames > 2) {
    const count = loop ? last : frames;
    // Each foot's frames near its lowest and still up and down, and which of its two points says so.
    const rows = [];
    for (const tr of tracks) {
      if (tr.a === undefined || tr.t === undefined) continue;
      let lowA = Infinity, lowT = Infinity;
      for (let f = 0; f < frames; f++) {
        lowA = Math.min(lowA, tr.ankle[f * 3 + 1]);
        lowT = Math.min(lowT, tr.toe[f * 3 + 1]);
      }
      // A foot that never comes down to where a standing foot is has nothing under it.
      if (lowA - bones[tr.a].rest[1] > tune.floorNear) continue;
      const flags = new Array(count);
      const vx = new Float64Array(count), vz = new Float64Array(count);
      for (let f = 0; f < count; f++) {
        const aOn = tr.ankle[f * 3 + 1] - lowA <= tune.plantNear && Math.abs(vel(tr.ankle, f, 1)) <= tune.plantStill;
        const tOn = tr.toe[f * 3 + 1] - lowT <= tune.plantNear && Math.abs(vel(tr.toe, f, 1)) <= tune.plantStill;
        flags[f] = aOn || tOn;
        const p = !aOn && tOn ? tr.toe : tr.ankle;
        // The body moves over the ground as fast as the planted foot moves back under the hips.
        vx[f] = -(vel(p, f, 0) - vel(hips, f, 0));
        vz[f] = -(vel(p, f, 2) - vel(hips, f, 2));
      }
      rows.push({ foot: tr.foot, flags, vx, vz });
    }
    const measure = (keep) => {
      feet.length = 0;
      sumX = sumZ = sumLen = samples = 0;
      planted.L = planted.R = 0;
      for (const row of rows) {
        const on = settle(row.flags.map((v, f) => v && keep(row, f)), tune.minLift, tune.minPlant, loop);
        for (let f = 0; f < count; f++) {
          if (!on[f]) continue;
          planted[row.foot]++;
          sumX += row.vx[f];
          sumZ += row.vz[f];
          sumLen += Math.hypot(row.vx[f], row.vz[f]);
          samples++;
          const before = f > 0 ? on[f - 1] : loop ? on[count - 1] : true;
          if (!before) feet.push({ t: Number((f * dt).toFixed(4)), foot: row.foot });
        }
      }
    };
    measure(() => true);
    // A second look for a clip that goes somewhere: a foot swinging forward skims the ground as low and as level as a
    // planted one, and what tells them apart is which way it moves under the hips. Only a foot moving back against
    // the body's own way, at a fair share of its speed, is on the ground.
    const first = samples ? Math.hypot(sumX, sumZ) / samples : 0;
    if (first >= tune.goes) {
      const ux = sumX / (first * samples), uz = sumZ / (first * samples);
      measure((row, f) => row.vx[f] * ux + row.vz[f] * uz >= tune.withBody * first);
    }
  }
  feet.sort((a, b) => a.t - b.t || (a.foot < b.foot ? -1 : 1));
  const speed = samples ? sumLen / samples : 0;
  // 0 forward (+Z), +90 left (+X).
  const heading = samples && speed >= 0.1 ? (Math.atan2(sumX, sumZ) * 180) / Math.PI : 0;
  return {
    loop,
    endAngle,
    endRise,
    travelNet,
    speed,
    heading,
    feet,
    planted,
    /** How high the lower foot stands over the floor at a time, metres (blended between frames). */
    footHeightAt(t) {
      if (frames < 2 || dt <= 0) return footHeight[0] ?? 0;
      const x = Math.min(last, Math.max(0, t / dt));
      const i = Math.min(last - 1, Math.floor(x));
      return footHeight[i] + (footHeight[i + 1] - footHeight[i]) * (x - i);
    },
    /** How far the hips stand from where they began at a time, level (metres), for saying what a trim skips. */
    hipsAt(t) {
      const x = Math.min(last, Math.max(0, dt > 0 ? t / dt : 0));
      const i = Math.min(Math.max(0, last - 1), Math.floor(x));
      const k = x - i;
      const j = Math.min(last, i + 1);
      return [hips[i * 3] + (hips[j * 3] - hips[i * 3]) * k, hips[i * 3 + 1] + (hips[j * 3 + 1] - hips[i * 3 + 1]) * k, hips[i * 3 + 2] + (hips[j * 3 + 2] - hips[i * 3 + 2]) * k];
    },
  };
}
