// A belt seen from the ground (the GPU port's sky round "the sky's bodies as the system has them", maker P: the brief's J, the
// owner's question of 24 November: "Will I be able to see the Spine of Lok from Lok's surface?"). A belt is no single body in
// one direction: it is a ring of rocks and dust round its parent, so from a world inside it or near it (Lok at 0.908 AU, the
// Spine at 0.95) it is a band across the whole sky along the belt's plane, its nearest stretch widest, brightest away from the
// sun at night where its rocks face us lit (as Earth's gegenschein), and from far off a faint arc. The night sky draws it as a
// band of its own (`src/sky/night/beltBand.ts`), turned by the system's own turn as the bodies and the stars are.
//
// This is the pure half: which belts the system draws (a belt's Drawn tick, which `system.js` keeps on the body while it makes
// every belt's item undrawn, so its model, its digests and every other reader stand as they were), and each one's numbers in the
// sky's frame a frame (allocating nothing): the belt's plane, where its middle and the sun are from the eye, its radius. The
// band's look (its width, brightness and colour) is the drawing's, from the belt's look and `BELT_TUNE`.

import type { PoseModel, PoseState } from './bodyPose.ts';

/**
 * The band's dials (feel and look are the owner's; each start's reason beside it). `__debug.sky({ motion: { belts } })` and the
 * `sky` helper's sliders move them live.
 *   - `lux`: the band's luminance (cd/m2) where it is thickest and lit full on, before the air in front: 3e-4 to start, between
 *     Earth's gegenschein (some 1.7e-4, a sky of 22 magnitudes an arcsecond squared) and the Milky Way's bright clouds (some
 *     1e-3), so a belt dense with dust reads as a soft band beside the Milky Way under a dark sky and never outshines a moon.
 *   - `thick`: the belt's half thickness as a share of its radius, per unit of its look's Thickness: 0.25 to start, so the
 *     Spine's look (0.3) stands 0.07 of its radius above and below its plane, about our own asteroid belt's spread of
 *     inclinations (most rocks within 10 to 15 degrees of its plane seen from its middle).
 *   - `width`: the belt's half width across its radius, as a share of its radius: 0.05 to start (a belt a tenth of its radius
 *     wide, narrower than our main belt's 2.2 to 3.3 AU, as the drafts' belts are a "spine" and a ring round Hoth's star).
 *   - `surge`: the brightening of its rocks seen with the sun right behind the eye (the opposition surge of rough rocks, some
 *     forty to sixty percent over a few degrees for our asteroids): 0.5 to start.
 *   - `rocks`: how many brighter rocks stand among the dust, as a share of the band's cells where it is thickest: 0.04 to start,
 *     "a few brighter rocks among the dust".
 *   - `rockGain` (the sky round's fixer: it was a fixed number of the band's program): a brighter rock's light at its middle
 *     against the dust's where it stands, 12 to start. A rock is spread over some 0.03 degrees (about a pixel), so at 12 it
 *     stands some two and a half magnitudes over the dust about it, a point the eye picks out of the band without its
 *     outshining the stars beside it; 0 leaves the dust alone.
 */
export const BELT_TUNE = { lux: 3e-4, thick: 0.25, width: 0.05, surge: 0.5, rocks: 0.04, rockGain: 12 };
export const BELT_RANGE: Record<keyof typeof BELT_TUNE, readonly [number, number]> = {
  lux: [0, 0.01],
  thick: [0.01, 2],
  width: [0.005, 0.5],
  surge: [0, 3],
  rocks: [0, 0.5],
  rockGain: [0, 100],
};

/** At most this many belts drawn on one world (the band's program holds this many, fixed, so no pipeline is built in play). */
export const BELT_MOST = 2;
/**
 * One belt's numbers in `beltsInto`'s array, `BELT_STRIDE` apart: its plane's normal (sky, 0..2), the way from the eye to its
 * middle (3..5) and that distance (6, AU), its radius (7, AU), the way to the sun (8..10) and its distance (11, AU), its body's
 * index in the model (12), drawn (13).
 */
export const BELT_STRIDE = 14;

/** A model's belts (made once at an arrival). */
export interface BeltKit {
  readonly count: number;
  readonly stride: number;
  /** Each drawn belt's body index, and its look's id (the system's), in order. */
  readonly bodies: Int16Array;
  readonly looks: readonly (string | null)[];
  readonly names: readonly string[];
}

/** The model's belts the system draws: a belt body whose Drawn tick is on, at most `BELT_MOST`. Made once. */
export function beltKitOf(M: PoseModel & { radius?: Float64Array }): BeltKit {
  const bodies: number[] = [];
  const looks: (string | null)[] = [];
  const names: string[] = [];
  const B = M.sys.bodies as readonly { id: string; kind: string; drawn?: boolean; look?: string | null; name?: string }[];
  for (let i = 0; i < B.length && bodies.length < BELT_MOST; i++) {
    const b = B[i];
    if (b.kind !== 'belt' || b.drawn === false || i === M.worldI || M.parent[i] < 0) continue;
    bodies.push(i);
    looks.push(typeof b.look === 'string' ? b.look : null);
    names.push(b.name ?? b.id);
  }
  return { count: bodies.length, stride: BELT_STRIDE, bodies: Int16Array.from(bodies), looks, names };
}

/**
 * Each drawn belt's numbers now into `out` (the sky's frame, from the model and its state as `skyAt` last left them): answers
 * how many. Allocates nothing.
 */
export function beltsInto(M: PoseModel & { radius?: Float64Array }, st: PoseState, kit: BeltKit, out: Float64Array): number {
  const R = st.R;
  const pos = st.pos;
  const basis = st.basis ?? M.basis;
  const w3 = 3 * M.worldI;
  const s3 = 3 * M.sunI;
  for (let k = 0; k < kit.count; k++) {
    const i = kit.bodies[k];
    const o = k * BELT_STRIDE;
    const b9 = 9 * i;
    const Nx = basis[b9 + 6];
    const Ny = basis[b9 + 7];
    const Nz = basis[b9 + 8];
    out[o] = R[0] * Nx + R[1] * Ny + R[2] * Nz;
    out[o + 1] = R[3] * Nx + R[4] * Ny + R[5] * Nz;
    out[o + 2] = R[6] * Nx + R[7] * Ny + R[8] * Nz;
    const p3 = 3 * M.parent[i];
    let cx = pos[p3] - pos[w3];
    let cy = pos[p3 + 1] - pos[w3 + 1];
    let cz = pos[p3 + 2] - pos[w3 + 2];
    let cl = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (cl < 1e-12) {
      cx = 0;
      cy = 0;
      cz = 1;
      cl = 1e-12;
    }
    const ux = cx / cl;
    const uy = cy / cl;
    const uz = cz / cl;
    out[o + 3] = R[0] * ux + R[1] * uy + R[2] * uz;
    out[o + 4] = R[3] * ux + R[4] * uy + R[5] * uz;
    out[o + 5] = R[6] * ux + R[7] * uy + R[8] * uz;
    out[o + 6] = cl;
    out[o + 7] = M.radius ? M.radius[i] : 1;
    let sx = pos[s3] - pos[w3];
    let sy = pos[s3 + 1] - pos[w3 + 1];
    let sz = pos[s3 + 2] - pos[w3 + 2];
    let sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (sl < 1e-12) {
      sx = 0;
      sy = 1;
      sz = 0;
      sl = 1e-12;
    }
    const vx = sx / sl;
    const vy = sy / sl;
    const vz = sz / sl;
    out[o + 8] = R[0] * vx + R[1] * vy + R[2] * vz;
    out[o + 9] = R[3] * vx + R[4] * vy + R[5] * vz;
    out[o + 10] = R[6] * vx + R[7] * vy + R[8] * vz;
    out[o + 11] = sl;
    out[o + 12] = i;
    out[o + 13] = 1;
  }
  return kit.count;
}

/** Moves to the band's dials, each held to its range; answers them as they stand. */
export function tuneBelts(o: Partial<Record<keyof typeof BELT_TUNE, number>> | null | undefined): typeof BELT_TUNE {
  if (o && typeof o === 'object') {
    for (const k of Object.keys(BELT_TUNE) as (keyof typeof BELT_TUNE)[]) {
      const v = o[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const [lo, hi] = BELT_RANGE[k];
      BELT_TUNE[k] = v < lo ? lo : v > hi ? hi : v;
    }
  }
  return BELT_TUNE;
}
