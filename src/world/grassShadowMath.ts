// The grass taking the sun's shadow (wave 8), as arithmetic: the lines `grass.ts`'s fragment stage runs for each
// fragment of a tuft (`swgGrassShadow`, at the point the vertex stage lifted toward the sun and interpolated), written
// out again so the node test and the browser's self-test can hold the program to them. Pure: no three.
//
// **Whose arithmetic.** The ambient occlusion pass already reads the sun's cascades outside three, and the grass
// reads them the same way, so the grass and the ground change cascade and fade out past the last at the same
// depths: the pick by linear depth against each cascade's end, the far fade (`cascadeShadowKeep`, imported from the
// pass's own mirror rather than said again, so the two cannot drift apart), and the bounds guard, a texel off the
// map or past its far plane lit. Ours: the lookup is moved toward the sun by a share of the tuft's larger side
// (`lift`), which keeps the texel a trunk's shadow falls on and only lowers the depth compared, so a tuft's own
// quads, and anything within that distance toward the sun, never shade it.
import { cascadeShadowKeep } from '../core/fx/ssaoMath.ts';

/** The cascades as the grass's uniforms hold them: each one's start and end as shares of `range`, the range in metres, and three's fade. */
export interface GrassCascades {
  /** Six numbers: start and end of cascades 0, 1 and 2. */
  ranges: ArrayLike<number>;
  range: number;
  fade: boolean;
}

/** Which cascade a fragment at linear depth `ld` (view depth over the range) looks in: the AO pass's own pick. */
export function grassCascadeOf(ld: number, ranges: ArrayLike<number>): 0 | 1 | 2 {
  return ld < ranges[1] ? 0 : ld < ranges[3] ? 1 : 2;
}

/** How much of the shadow a fragment at `ld` takes: the AO's `cascadeKeep`, which is three's CSM margin over the last cascade's far end. */
export function grassShadowKeep(ld: number, c: GrassCascades): number {
  return cascadeShadowKeep(ld, c.ranges[4], c.ranges[5], c.fade);
}

/**
 * Where a corner looks the shadow up, worked out in the vertex stage and interpolated to each fragment: its place
 * moved toward the sun (a unit vector) by `lift` times the tuft's larger side at its scale. Into `out`; allocates nothing.
 */
export function grassLiftPoint(px: number, py: number, pz: number, sun: { x: number; y: number; z: number }, lift: number, width: number, height: number, scale: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const d = lift * Math.max(width, height) * scale;
  out.x = px + sun.x * d;
  out.y = py + sun.y * d;
  out.z = pz + sun.z * d;
  return out;
}

/** Whether a shadow coordinate, after the divide and the bias, lies on its map: off it, or past its far plane, the fragment is lit. */
export function grassOnMap(x: number, y: number, z: number): boolean {
  return !(x < 0 || x > 1 || y < 0 || y > 1 || z > 1);
}

/** The shade a fragment is lit by: one hardware compare's answer (`lookup`, 0 shaded to 1 lit) taken at the cascade's intensity times the keep. */
export function grassShade(lookup: number, intensity: number, keep: number): number {
  return 1 + (lookup - 1) * intensity * keep;
}

/**
 * The whole line, for one fragment whose shadow coordinate the caller worked out (cascade `i`'s matrix times the
 * lifted point, divided by w): what the fragment stage's `swgGrassShadow` must answer. `depthAt` answers the map's
 * stored depth at a coordinate of cascade `i`, as a compare against `z` would read it (LessEqual: lit where `z` is
 * at or under it).
 */
export function grassShadeAt(ld: number, c: GrassCascades, intensity: number, coord: (i: number) => { x: number; y: number; z: number }, bias: ArrayLike<number>, depthAt: (i: number, x: number, y: number) => number): number {
  const keep = grassShadowKeep(ld, c);
  if (keep <= 0) return 1;
  const i = grassCascadeOf(ld, c.ranges);
  const s = coord(i);
  const z = s.z + bias[i];
  if (!grassOnMap(s.x, s.y, z)) return 1;
  const lookup = z <= depthAt(i, s.x, s.y) ? 1 : 0;
  return grassShade(lookup, intensity, keep);
}
