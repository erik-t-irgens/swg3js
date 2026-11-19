// Climbing II, phase 6: the vaults' and the clamber's clips (the owner's Swinging folder: `Jumping.fbx`, `Jumping (1).fbx`,
// `Jumping (2).fbx`, "great for when sprinting to automatically clamber over obstacles that are appropriate"; `Jump Over.fbx`, a
// dive over an obstacle and a roll; `Running Jump.fbx`, a clamber up a waist-high ledge from a run) and what the game reads of each.
//
// Each was authored over an obstacle of its own, which the clip does not carry: the game reads off the clip where its hands and
// feet are and when (`measureVault`, the rule below, on the human male the pack fits its clips for, its level travel put back:
// the pack strips each clip's level travel as a straight ramp over its length, src/anim/fit.ts), and fits the clip to the
// obstacle met (src/player/vault.ts): the clip whose hand meets the top is chosen, its figure lifted or lowered by the
// difference while the hand is on the top, its flight stretched to the obstacle's depth. `vaultClips.test.ts` measures every
// clip again from the pack and holds this table to it.
//
// What the measure found (the human male, seconds into each clip, metres along the clip's own travel):
//  - `jumping`: a one-handed vault (the left hand on the top at 0.848 m), the take-off from the left foot.
//  - `jumping_1`: a two-handed vault (the left hand first, at 0.965 m; the right at 0.93), the take-off from the right foot.
//  - `jumping_2`: `jumping_1`'s very file (the import's own hash, a65457313204, is the same for both): kept, and never chosen
//    over its twin, since its hand stands at the same height.
//  - `jump_over`: a dive, the feet leaving the ground together, the hips 2 m up over its middle, the hands down on the ground
//    beyond and a roll up onto the feet.
//  - `running_jump`: the clamber; the owner's own moments win (a hand on the top at 0.50 s, a foot at 0.73 s, the second foot
//    at 1.07 s, "If we were to keep running, I'd want to not play all of the rest"), where the measure says 0.533 s for the
//    hand (one frame from his) and the feet's own rest at 0.6 to 0.73 s and 1.0 to 1.03 s.
//
// Pure: numbers and names only.

/** What a clip is to the game: a vault over (a hand on the top), a dive over (the hands down beyond it), a clamber onto. */
export type VaultKind = 'vault' | 'dive' | 'clamber';

/** One clip's measured numbers (human male metres, seconds into the clip); see the header. */
export interface VaultClipFacts {
  kind: VaultKind;
  dur: number;
  /** The level travel the pack strips over the whole clip, metres along its forward (the ramp the figure is drawn less). */
  net: number;
  /** The last foot off the ground before the flight. */
  leave: number;
  /** A vault's first hand at rest on the top; a dive's hands down on the ground beyond; a clamber's hand on the top (the owner's). */
  touch: number;
  /** A vault's hands off the top; a dive's hands off the ground into the roll; a clamber's first foot on the top (the owner's). */
  lift: number;
  /** A vault's first foot back on the ground; a dive's feet down after the roll; a clamber's second foot on the top (the owner's: its cut). */
  land: number;
  /** The hips' highest between `leave` and `touch` (a dive is placed by it: its apex over the obstacle's middle). */
  apex: number;
  /** The touching hand's lowest while it rests (a vault's: the top it was authored over; a dive's: the ground beyond). */
  hand: number;
  /** Along the travel: the touching hand at `touch`, the landing foot at `land`, the hips at `apex`, and the feet at `leave`. */
  handZ: number;
  landZ: number;
  apexZ: number;
  leaveZ: number;
  /** A clamber's top (its feet's standing height on it over the ground), and its near face along the travel (the leading foot rising past the top's height); nought for the others. */
  top: number;
  face: number;
  /** The body's path: the hips along the travel at the clip's moments (each a time and a place, the times rising, the places never falling back). */
  pathT: readonly number[];
  pathZ: readonly number[];
}

/** The measured table (generated in node on the human male; `vaultClips.test.ts` measures it again). */
export const VAULT_FACTS: Readonly<Record<string, VaultClipFacts>> = {
  jumping: {
    kind: 'vault', dur: 1.1667, net: 4.849, leave: 0.2667, touch: 0.4667, lift: 0.6667, land: 0.8667, apex: 0.4667,
    hand: 0.848, handZ: 2.221, landZ: 3.645, apexZ: 1.706, leaveZ: 1.096, top: 0, face: 0,
    pathT: [0, 0.2667, 0.4667, 0.6667, 0.8667, 1.1667],
    pathZ: [-0.054, 1.024, 1.706, 2.608, 3.441, 4.795],
  },
  jumping_1: {
    kind: 'vault', dur: 1.2, net: 4.127, leave: 0.1, touch: 0.5333, lift: 0.7333, land: 0.9, apex: 0.4,
    hand: 0.965, handZ: 1.858, landZ: 3.32, apexZ: 1.315, leaveZ: 0.266, top: 0, face: 0,
    pathT: [0, 0.1, 0.4, 0.5333, 0.7333, 0.9, 1.2],
    pathZ: [-0.054, 0.329, 1.315, 1.829, 2.628, 3.146, 4.072],
  },
  jumping_2: {
    kind: 'vault', dur: 1.2, net: 4.127, leave: 0.1, touch: 0.5333, lift: 0.7333, land: 0.9, apex: 0.4,
    hand: 0.965, handZ: 1.858, landZ: 3.32, apexZ: 1.315, leaveZ: 0.266, top: 0, face: 0,
    pathT: [0, 0.1, 0.4, 0.5333, 0.7333, 0.9, 1.2],
    pathZ: [-0.054, 0.329, 1.315, 1.829, 2.628, 3.146, 4.072],
  },
  jump_over: {
    kind: 'dive', dur: 2.25, net: 8.548, leave: 0.5, touch: 1.3333, lift: 1.4333, land: 1.7333, apex: 0.9333,
    hand: 0.052, handZ: 5.976, landZ: 7.572, apexZ: 4.366, leaveZ: 2.333, top: 0, face: 0,
    pathT: [0, 0.5, 0.9333, 1.3333, 1.4333, 1.7333, 2.25],
    pathZ: [-0.054, 2.582, 4.366, 6.11, 6.61, 7.261, 8.479],
  },
  // (A clamber's touch, lift and land are the owner's: the hand on the top, the first foot on it, the second foot, where it is
  // cut; the rest the measure's, its own touch 0.5333 s, one frame from his.)
  running_jump: {
    kind: 'clamber', dur: 2.1667, net: 2.172, leave: 0.5333, touch: 0.5, lift: 0.73, land: 1.07, apex: 0.5333,
    hand: 0.996, handZ: 2.131, landZ: 2.127, apexZ: 1.465, leaveZ: 1.591, top: 0.9601, face: 1.857,
    pathT: [0, 0.5, 0.5333, 0.73, 1.07, 2.1667],
    pathZ: [-0.054, 1.378, 1.465, 1.758, 2.021, 2.117],
  },
};

/** The vaults over a top, each to be chosen by its hand's height (`jumping_2` is `jumping_1`'s twin; see the header). */
export const VAULT_OVER: readonly string[] = ['jumping', 'jumping_1', 'jumping_2'];
/** The dive over a long low obstacle, and the clamber onto a waist-high ledge. */
export const VAULT_DIVE = 'jump_over';
export const VAULT_CLAMBER = 'running_jump';

/** Every clip the vaults ask the pack for (`PackIo.also`, beside the poles'). */
export const VAULT_IDS: readonly string[] = Object.keys(VAULT_FACTS);

/** Each clip's rig name (the pack's `mx_` prefix), made once (nothing names a clip anew on a frame). */
export const VAULT_CLIP_NAMES: Readonly<Record<string, string>> = Object.fromEntries(VAULT_IDS.map((id) => [id, `mx_${id}`]));

/** The body's place along the travel at clip time `t` (the path's anchors joined straight; held at its ends), human male metres. */
export function vaultPathAt(f: VaultClipFacts, t: number): number {
  const T = f.pathT;
  const Z = f.pathZ;
  const n = T.length;
  if (t <= T[0]) return Z[0];
  for (let i = 1; i < n; i++) {
    if (t <= T[i]) {
      const u = (t - T[i - 1]) / (T[i] - T[i - 1]);
      return Z[i - 1] + (Z[i] - Z[i - 1]) * u;
    }
  }
  return Z[n - 1];
}

/** The clip time at which the path stands at `z` (the path's inverse; its first time at a flat stretch; held at its ends). */
export function vaultTimeAt(f: VaultClipFacts, z: number): number {
  const T = f.pathT;
  const Z = f.pathZ;
  const n = T.length;
  if (z <= Z[0]) return T[0];
  for (let i = 1; i < n; i++) {
    if (z <= Z[i]) {
      const dz = Z[i] - Z[i - 1];
      return dz > 1e-9 ? T[i - 1] + ((z - Z[i - 1]) / dz) * (T[i] - T[i - 1]) : T[i - 1];
    }
  }
  return T[n - 1];
}

/** The pack's ramp at clip time `t`: how far the stripped level travel has gone (`net` over the whole clip), human male metres. */
export function vaultRampAt(f: VaultClipFacts, t: number): number {
  return (f.net * t) / f.dur;
}

// ---- the measure ----------------------------------------------------------------------------------------------------------------

/** A hand slower than this (m/s, in the clip's original world) has come to rest (a mechanic: `HAND_MOVING`'s own, handTimes.ts). */
export const VAULT_MOVING = 1;
/**
 * A hand faster than this has left what it rested on (a mechanic: a planted hand's grip point drifts at up to 1.2 m/s as the palm
 * rolls over it, `jumping`'s measured, so the lift asks half as much again as the rest does).
 */
export const VAULT_LIFTING = 1.5;
/** An ankle under its lowest height in the clip and this much more is on the ground (a mechanic: the ankle's lift as a heel rolls). */
export const VAULT_FOOT_SLACK = 0.045;

/** A clip's samples at its own frames: each joint's place (x, y, z a sample), its level travel put back. */
export interface VaultSamples {
  /** Seconds between two samples. */
  readonly dt: number;
  readonly kind: VaultKind;
  /** The hips, the left hand's grip and the right's (between the wrist and the index knuckle), the left ankle and the right. */
  readonly hips: ArrayLike<number>;
  readonly lh: ArrayLike<number>;
  readonly rh: ArrayLike<number>;
  readonly la: ArrayLike<number>;
  readonly ra: ArrayLike<number>;
  /** The level travel the pack stripped over the clip (`net`), carried for the table. */
  readonly net: number;
}

/** A point's speed into sample `k` (its samples already in the original world), m/s. */
function speedInto(p: ArrayLike<number>, k: number, dt: number): number {
  const dx = p[k * 3] - p[(k - 1) * 3];
  const dy = p[k * 3 + 1] - p[(k - 1) * 3 + 1];
  const dz = p[k * 3 + 2] - p[(k - 1) * 3 + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz) / dt;
}

/**
 * The first sample at or past `from` at which hand `p` comes to rest (moving into it, still into the next), under the hips, and
 * (where `up` is handed) with both ankles off the ground there, and (where `under` is finite) under that height; -1 for none.
 */
function restsAt(s: VaultSamples, p: ArrayLike<number>, from: number, n: number, up: ((k: number) => boolean) | null, under: number): number {
  for (let k = Math.max(1, from); k + 1 < n; k++) {
    if (speedInto(p, k, s.dt) < VAULT_MOVING || speedInto(p, k + 1, s.dt) >= VAULT_MOVING) continue;
    if (p[k * 3 + 1] >= s.hips[k * 3 + 1] || p[k * 3 + 1] >= under) continue;
    if (up && !up(k)) continue;
    return k;
  }
  return -1;
}

/** The last sample past `from` before hand `p` leaves what it rests on (`VAULT_LIFTING`); -1 for none. */
function liftsAt(s: VaultSamples, p: ArrayLike<number>, from: number, n: number): number {
  for (let k = from + 1; k < n; k++) if (speedInto(p, k, s.dt) >= VAULT_LIFTING) return k - 1;
  return -1;
}

/**
 * The rule. The ground is the ankles' lowest over the clip, and an ankle under it and `VAULT_FOOT_SLACK` is down. Touch: a
 * vault's first hand to come to rest under the hips with both feet up; a dive's the same, down near the ground (under it and
 * 0.3 m: the hands on the ground beyond); a clamber's first hand to come to rest under the hips from two frames before the
 * owner's own moment (`touchHint`). Leave: the last sample before the touch with a foot down (the take-off), or where the hand
 * touches before the take-off (a clamber's), the sample before both feet are first up after it. Apex: the hips' highest between
 * leave and touch. Lift: the last sample before the touching hand, and the other where it rested by then, leaves (`VAULT_LIFTING`).
 * Land: the first sample past the lift with an ankle down. The hand's height: the touching hand's lowest between touch and lift;
 * its place along the travel at touch; the landing ankle's at land; the feet's mean at leave. A clamber's top: its ankles' mean
 * height at its end over the ground; its face: where the leading ankle first rises within 5 cm of that top, along the travel.
 */
export function measureVault(s: VaultSamples, touchHint = 0): Omit<VaultClipFacts, 'pathT' | 'pathZ' | 'dur'> & { leaveK: number; touchK: number; liftK: number; landK: number; apexK: number } {
  const n = Math.min(s.hips.length, s.lh.length, s.rh.length, s.la.length, s.ra.length) / 3;
  let ground = Infinity;
  for (let k = 0; k < n; k++) ground = Math.min(ground, s.la[k * 3 + 1], s.ra[k * 3 + 1]);
  const down = (a: ArrayLike<number>, k: number) => a[k * 3 + 1] < ground + VAULT_FOOT_SLACK;
  const bothUp = (k: number) => !down(s.la, k) && !down(s.ra, k);
  const clamber = s.kind === 'clamber';
  const from = clamber ? Math.max(1, Math.round(touchHint / s.dt) - 2) : 1;
  const under = s.kind === 'dive' ? ground + 0.3 : Infinity;
  const tl = restsAt(s, s.lh, from, n, clamber ? null : bothUp, under);
  const tr = restsAt(s, s.rh, from, n, clamber ? null : bothUp, under);
  let touchK = tl < 0 ? tr : tr < 0 ? tl : Math.min(tl, tr);
  if (touchK < 0) touchK = 0;
  const first = tl >= 0 && (tr < 0 || tl <= tr) ? s.lh : s.rh;
  const other = first === s.lh ? s.rh : s.lh;
  let leaveK = 0;
  if (bothUp(touchK)) {
    for (let k = touchK; k >= 0; k--) {
      if (!bothUp(k)) {
        leaveK = k;
        break;
      }
    }
  } else {
    leaveK = touchK;
    for (let k = touchK; k < n; k++) {
      if (bothUp(k)) {
        leaveK = k - 1;
        break;
      }
    }
  }
  let apexK = leaveK;
  const lo = Math.min(leaveK, touchK);
  const hi = Math.max(leaveK, touchK);
  for (let k = lo; k <= hi; k++) if (s.hips[k * 3 + 1] > s.hips[apexK * 3 + 1]) apexK = k;
  let liftK = liftsAt(s, first, touchK, n);
  if (liftK < 0) liftK = touchK;
  const otherRest = restsAt(s, other, Math.max(1, Math.min(leaveK, touchK)), n, null, under);
  if (otherRest >= 0 && otherRest <= liftK) {
    const ol = liftsAt(s, other, otherRest, n);
    if (ol > liftK) liftK = ol;
  }
  let landK = -1;
  for (let k = liftK + 1; k < n; k++) {
    if (down(s.la, k) || down(s.ra, k)) {
      landK = k;
      break;
    }
  }
  if (landK < 0) landK = n - 1;
  const landing = down(s.la, landK) ? s.la : s.ra;
  let hand = Infinity;
  for (let k = touchK; k <= liftK; k++) hand = Math.min(hand, first[k * 3 + 1]);
  let top = 0;
  let face = 0;
  if (clamber) {
    top = (s.la[(n - 1) * 3 + 1] + s.ra[(n - 1) * 3 + 1]) / 2 - ground;
    const want = ground + top - 0.05;
    // The leading ankle: the one that rises past the top's height first.
    let best = Infinity;
    for (const a of [s.la, s.ra]) {
      for (let k = 1; k < n; k++) {
        const y0 = a[(k - 1) * 3 + 1];
        const y1 = a[k * 3 + 1];
        if (y0 < want && y1 >= want) {
          const u = (want - y0) / (y1 - y0);
          const z = a[(k - 1) * 3 + 2] + (a[k * 3 + 2] - a[(k - 1) * 3 + 2]) * u;
          if (k < best) {
            best = k;
            face = z;
          }
          break;
        }
      }
    }
  }
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  const r3 = (v: number) => Math.round(v * 1e3) / 1e3;
  return {
    kind: s.kind,
    net: r3(s.net),
    leave: r4(leaveK * s.dt),
    touch: r4(touchK * s.dt),
    lift: r4(liftK * s.dt),
    land: r4(landK * s.dt),
    apex: r4(apexK * s.dt),
    hand: r3(hand),
    handZ: r3(first[touchK * 3 + 2]),
    landZ: r3(landing[landK * 3 + 2]),
    apexZ: r3(s.hips[apexK * 3 + 2]),
    leaveZ: r3((s.la[leaveK * 3 + 2] + s.ra[leaveK * 3 + 2]) / 2),
    top: r4(top),
    face: r3(face),
    leaveK,
    touchK,
    liftK,
    landK,
    apexK,
  };
}

/**
 * The path's anchors: the hips along the travel at the clip's start, its moments (sorted, each once) and its end, made never to
 * fall back (a hips' sway back within a stride is no travel back).
 */
export function vaultPathOf(times: readonly number[], hipsZ: (t: number) => number): { t: number[]; z: number[] } {
  const ts = [...new Set(times.map((t) => Math.round(t * 1e4) / 1e4))].sort((a, b) => a - b);
  const z: number[] = [];
  for (const t of ts) z.push(Math.round(Math.max(z.length ? z[z.length - 1] : -Infinity, hipsZ(t)) * 1e3) / 1e3);
  return { t: ts, z };
}
