// The hand torch (F): where it is carried, where it points and how bright it may be. It is one
// spot light that never leaves the scene and is only turned up and down, since a light that comes
// and goes changes the light count and that recompiles every program in the world; everything here
// is a uniform of that one light, so moving any of it builds nothing.
//
// Two faults this answers. It was carried at the camera, which in third person stands metres behind
// the body, so the cone went straight through the player's back and, casting no shadow, lit what the
// body should have hidden. And at 260 candela with three's falloff, 1 / max(d^decay, 0.01), a wall at
// arm's length took hundreds of times the sun's irradiance (2.4) and tone mapping turned it white. So
// in third person the torch is carried at the head and aimed at the crosshair's point, and its
// intensity is capped by how far that point is, from one ray a frame along the view.
//
// Every number is ours and live through `__debug.torch`. No imports, so a node test reads the very
// arithmetic the game runs; nothing here allocates.

export interface TorchTune {
  /** Candela with nothing near: the light as it always was. */
  intensity: number;
  /** Metres where three's cutoff takes it to nothing, and how far the aiming ray looks. */
  distance: number;
  /** The cone's half angle, radians, and the share of it that is soft edge. */
  angle: number;
  penumbra: number;
  /** Three's falloff exponent. */
  decay: number;
  /** The most irradiance the torch may put on what the crosshair rests on (the sun gives about 2.4). */
  maxIrradiance: number;
  /** Third person: how far in front of the head, along the beam, the torch is carried... */
  ahead: number;
  /** ...how far to the right of it (a hand at the shoulder)... */
  side: number;
  /** ...and how far above the eyes. */
  rise: number;
  /** A crosshair point less than this far in front of the torch (beside or behind it) is not aimed at: the beam goes down the view. */
  minAhead: number;
}

/** The torch's numbers, live: the game writes them onto the light every frame it is on. */
export const TORCH_TUNE: TorchTune = {
  intensity: 260,
  distance: 70,
  angle: 0.42,
  penumbra: 0.45,
  decay: 1.6,
  maxIrradiance: 7,
  ahead: 0.3,
  side: 0.18,
  rise: 0.04,
  minAhead: 0.25,
};

export interface TorchVec {
  x: number;
  y: number;
  z: number;
}

/** Where the torch is this frame: its place, the point it looks at, and how far off what it is aimed at is (Infinity: nothing). */
export interface TorchPose {
  source: TorchVec;
  target: TorchVec;
  aimed: number;
}

export function newTorchPose(): TorchPose {
  return { source: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, aimed: Infinity };
}

/**
 * The intensity that puts no more than `maxIrradiance` on a surface `d` metres off along the beam,
 * by three's own falloff (1 / max(d^decay, 0.01)), and never more than the tune's own intensity.
 * Nothing aimed at (Infinity, or not a number) leaves the torch as it is.
 */
export function torchIntensity(d: number, t: TorchTune): number {
  if (!Number.isFinite(d)) return t.intensity;
  return Math.min(t.intensity, t.maxIrradiance * Math.max(Math.pow(Math.max(0, d), t.decay), 0.01));
}

/**
 * Place the torch. `eye` is the camera's place and `look` its unit forward; `up` is the view's unit
 * up (the hull's aboard); `hit` is how far along `look` the crosshair meets something, Infinity when
 * nothing within the torch's reach. `head` is the character's eyes in third person and null in first
 * person (or a cockpit), where the torch stays at the eye as it always was.
 *
 * In third person the torch is carried at the head, `rise` up, `side` to the right and `ahead` along
 * the view, and aimed from there at the crosshair's point, so the cone starts in front of the body.
 * A crosshair point beside or behind the torch (something between the camera and the head) is not
 * aimed at: the beam goes down the view, and nothing is known to be in front of it.
 */
export function placeTorch(eye: TorchVec, look: TorchVec, up: TorchVec, head: TorchVec | null, hit: number, t: TorchTune, out: TorchPose): TorchPose {
  const reach = Math.max(0.1, t.distance);
  const s = out.source;
  const p = out.target;
  if (!head) {
    s.x = eye.x;
    s.y = eye.y;
    s.z = eye.z;
    const d = Number.isFinite(hit) ? Math.max(0.1, hit) : reach;
    p.x = eye.x + look.x * d;
    p.y = eye.y + look.y * d;
    p.z = eye.z + look.z * d;
    out.aimed = Number.isFinite(hit) ? Math.max(0, hit) : Infinity;
    return out;
  }
  // Right of the view: look x up, flattened to nothing when the view looks straight along the up.
  let rx = look.y * up.z - look.z * up.y;
  let ry = look.z * up.x - look.x * up.z;
  let rz = look.x * up.y - look.y * up.x;
  const rl = Math.hypot(rx, ry, rz);
  if (rl > 1e-6) {
    rx /= rl;
    ry /= rl;
    rz /= rl;
  } else rx = ry = rz = 0;
  s.x = head.x + up.x * t.rise + rx * t.side + look.x * t.ahead;
  s.y = head.y + up.y * t.rise + ry * t.side + look.y * t.ahead;
  s.z = head.z + up.z * t.rise + rz * t.side + look.z * t.ahead;
  if (Number.isFinite(hit)) {
    const px = eye.x + look.x * hit;
    const py = eye.y + look.y * hit;
    const pz = eye.z + look.z * hit;
    const ax = px - s.x;
    const ay = py - s.y;
    const az = pz - s.z;
    if (ax * look.x + ay * look.y + az * look.z >= t.minAhead) {
      p.x = px;
      p.y = py;
      p.z = pz;
      out.aimed = Math.hypot(ax, ay, az);
      return out;
    }
  }
  p.x = s.x + look.x * reach;
  p.y = s.y + look.y * reach;
  p.z = s.z + look.z * reach;
  out.aimed = Infinity;
  return out;
}
