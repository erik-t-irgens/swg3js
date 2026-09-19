// Which star lights a space zone, and what stops the light from carrying past it.
//
// The game's files never say which star is the sun. A zone's terrain file gives a handful of star
// sprites (a disc, a glow, or both, at a yaw and a pitch) and two parallel lights, and in ten of the
// twelve zones the first light points between 28 and 119 degrees away from the brightest star, so
// taking the file's light as the sun lights the ship from empty sky. The rules here are therefore
// OURS, not the game's, and every pick says which rule chose it so the console can show it.
//
// One pick serves everything that needs a sun -- the main light and its shadows, the lens flare and
// the god rays -- so they can never disagree. A star within a few degrees of the sun is folded in as
// a companion: it takes the flare's second slot and gets no light of its own, which is how a zone
// with a close pair of suns shows both without changing the number of lights in the scene.
//
// Nothing is imported but the flare's own constants (a module that imports nothing itself), so the
// game and `tools/swg/tests/suns.test.ts` run exactly the same code.
// The `.ts` is what lets plain node run this module and its test (tsconfig allows it; Vite is happy either way).
import { MAX_FLARE_SOURCES, SECOND_STAR_RATIO } from '../core/fx/flareMath.ts';

/** A star sprite of a space zone, as the pack's `space.celestials` gives it. */
export interface SunStarSprite {
  shader: string;
  size: number;
  yaw: number;
  pitch: number;
  /** Whether the sprite's texture is there; one without is never drawn and never counts. */
  hasImage: boolean;
}

/** One of a zone's parallel lights, as the pack gives it. */
export interface SunZoneLight {
  yaw: number;
  pitch: number;
}

/** The star sprites that share one direction: the zone's idea of a single star. */
export interface SunStarGroup {
  yaw: number;
  pitch: number;
  /** The largest `cels_star` back in the group (the disc), 0 without one. */
  discSize: number;
  /** The largest `starglow` in the group, 0 without one. */
  glowSize: number;
  /** How bright it reads: the glow plus a quarter of the disc, which is the lens flare's own ranking. */
  score: number;
  /** The flare's amplitude for this group, filled by `pickSuns` for the sources it returns. */
  weight: number;
}

/** How the sun was chosen. `glow` and `disc` are our two rules; `light` is the fallback for a zone with no star at all. */
export type SunRule = 'glow' | 'disc';
export const SUN_RULES: readonly SunRule[] = ['glow', 'disc'];

/** A direction in this engine's axes (the sky's mirrored X), as three plain numbers. */
export interface SunDirection {
  x: number;
  y: number;
  z: number;
}

export interface SunPick {
  /** Our brightness rule, our disc rule, or the zone's own first light where it has no stars. */
  chosenBy: SunRule | 'light';
  /** Towards the sun, unit length. */
  dir: SunDirection;
  /** The star chosen, or null where the zone has no star sprite and the file's light stands in. */
  sun: SunStarGroup | null;
  /** A star within COMPANION_DEGREES of the sun: the flare's second slot, and no light of its own. */
  companion: SunStarGroup | null;
  /** With no companion, the next brightest star when it is nearly as bright as the sun: the flare's second slot, as before. */
  second: SunStarGroup | null;
  /** Every group the zone has, brightest first. */
  groups: SunStarGroup[];
  /** Degrees between the zone's own first light and the sun chosen; null when the zone has no light. */
  lightOffDegrees: number | null;
}

/**
 * How near a second star must be to the sun to be its companion, in degrees. INVENTED: the two
 * retail pairs are 2 and 5 degrees apart and no other star in any zone is nearer than 33 degrees
 * to its zone's sun, so anything from about 8 to 30 would pick the same pairs.
 */
export const COMPANION_DEGREES = 6;

/**
 * Every number of this sky that we chose rather than read, live through
 * `__debug.suns({ companionDegrees, skyShare, standInDistance })` and saved nowhere.
 * `companionDegrees` and `skyShare` take effect at once; `standInDistance` is read when a zone's
 * bodies are built, so it shows on the next arrival.
 *
 * `skyShare`: in space a pixel counts as open sky only past this share of the far plane, so a
 * station or an asteroid six kilometres away blocks the god rays instead of shining through them.
 * (Over a planet the rays keep their own 2.5 km, where the sky really is the far terrain.)
 *
 * `standInDistance`: metres, INVENTED. A zone's planets and moons are pictures on the sky with no
 * true distance, so what writes depth for them stands here. It is a distance and not a share of the
 * far plane because the far plane is not a constant: a jump pulls the camera's in to a few hundred
 * metres while the tunnel is closed, and a zone loaded in that moment would have put every
 * stand-in in the ship's face for the life of the zone. Three constraints set 7500 m at the
 * camera's 9000 m far plane: beyond everything the streamer places (its widest tier reaches 1700 m
 * times the space reach of 3, plus the widest model's own radius); under `skyShare` of the far
 * plane by far more than the depth buffer's step out there (about 70 m a step at 24 bits with a
 * 0.05 m near plane), so a planet always stops the rays; and inside the far plane, so it is drawn.
 */
export const SPACE_SKY_TUNE = { companionDegrees: COMPANION_DEGREES, skyShare: 0.92, standInDistance: 7500 };

/** Tune them live (`__debug.suns`); every one is held where it cannot break the band the stand-in sits in. */
export function tuneSpaceSky(patch: { companionDegrees?: number; skyShare?: number; standInDistance?: number }): typeof SPACE_SKY_TUNE {
  if (patch.companionDegrees !== undefined) SPACE_SKY_TUNE.companionDegrees = clamp(patch.companionDegrees, 0, 90);
  if (patch.skyShare !== undefined) SPACE_SKY_TUNE.skyShare = clamp(patch.skyShare, 0.2, 0.9999);
  if (patch.standInDistance !== undefined) SPACE_SKY_TUNE.standInDistance = clamp(patch.standInDistance, 100, 100000);
  return SPACE_SKY_TUNE;
}

/** Depth past which a pixel counts as open sky, in metres: the far plane's share in space, the far terrain's distance over a planet. */
export function skyDistanceFor(space: boolean, far: number, groundDistance: number): number {
  return space ? far * SPACE_SKY_TUNE.skyShare : groundDistance;
}

/**
 * Where a sky body's depth stand-in stands, and how much sky it covers: far enough out that
 * everything real in the zone draws in front of it, and exactly the body's own half-angle wide.
 *
 * The body itself is drawn near and small, so that it is lit and sorted with the sky, and writes no
 * depth at all; the stand-in writes only depth. It is a cap of a sphere centred on the camera, so
 * every point of it is the same distance away in every direction and none of it can cross the far
 * plane. It must be real geometry: a `THREE.Sprite` takes its whole face's depth from its centre's
 * (three's sprite program moves only x and y in view space), so a wide body far off the view axis
 * would have laid a screen-filling quad across the view at a few hundred metres and hidden the
 * zone. The stand-in never stands nearer than the far side of the body it stands for.
 */
export function spaceBodyStandIn(radius: number, distance: number): { distance: number; halfAngle: number } {
  const d = Math.max(SPACE_SKY_TUNE.standInDistance, distance + Math.max(0, radius));
  const sin = clamp(radius / Math.max(1e-3, distance), 0, 1);
  return { distance: d, halfAngle: Math.asin(sin) };
}

/**
 * The depth a point of the stand-in writes: the depth buffer holds distance along the camera's own
 * forward axis, not distance from the camera, so a point of the cap `angle` off that axis is
 * nearer in depth by its cosine. Everything the frame's depth is read against -- the rays' sky
 * test above all -- must hold for the whole cap, corner of the screen included.
 */
export function standInViewDepth(distance: number, angleOffAxis: number): number {
  return distance * Math.cos(clamp(angleOffAxis, 0, Math.PI / 2));
}

/**
 * Which of the environment file's own bodies a sky builds, and how many it leaves standing. Every
 * space zone's environment file is the same ground sky -- a sun, two moons and two planet pictures
 * -- copied byte for byte into all of them, with none at all for the orbit added last, so in space
 * none of it is built: no sprite, no material, no program.
 */
export function environmentBodies(space: boolean, present: readonly unknown[]): { build: boolean; leftOut: number } {
  return { build: !space, leftOut: space ? present.filter((b) => !!b).length : 0 };
}

/** Towards a body the client places by yawing then pitching (degrees), in this engine's axes: the same convention as the sky's sprites. */
export function sunDirection(yawDeg: number, pitchDeg: number): SunDirection {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const c = Math.cos(pitch);
  return { x: c * Math.sin(yaw), y: Math.sin(pitch), z: -c * Math.cos(yaw) };
}

/**
 * How a space zone's star stands in the sky: its quad's own +Z turned onto the way back to the
 * camera (the sky group's origin, which is where the camera always is), then rolled about that axis
 * by the roll the file gives. Returned as a quaternion (x, y, z, w) worked out exactly as three
 * would, so the game and the test cannot drift apart. `dir` is the way the star hangs, unit length.
 *
 * A quad turned once like this faces the camera for the life of the zone and costs nothing per
 * frame, because the group follows the camera's place and never turns -- which is the whole reason
 * the stars are quads and not sprites, a sprite being upright on the screen and so rolling with the
 * camera while the sky it belongs to stays where it is.
 */
export function starQuadTurn(dir: SunDirection, rollDegrees: number): [number, number, number, number] {
  // Back along the way the star hangs, which is the way to the camera.
  const nx = -dir.x;
  const ny = -dir.y;
  const nz = -dir.z;
  // The turn from (0, 0, 1) onto that: the cross product, and one plus the dot.
  let x = -ny;
  let y = nx;
  let z = 0;
  let w = 1 + nz;
  if (w < 1e-8) {
    // Straight behind: half a turn, about an axis across the quad (the one three itself picks).
    x = 0;
    y = -1;
    z = 0;
    w = 0;
  }
  const len = Math.hypot(x, y, z, w) || 1;
  x /= len;
  y /= len;
  z /= len;
  w /= len;
  // Times a turn about the quad's own Z, which that first turn has pointed at the camera.
  const half = (rollDegrees * Math.PI) / 360;
  const s = Math.sin(half);
  const c = Math.cos(half);
  return [x * c + y * s, y * c - x * s, z * c + w * s, w * c - z * s];
}

/** Degrees between two yaw/pitch places on the sky. */
export function degreesApart(aYaw: number, aPitch: number, bYaw: number, bPitch: number): number {
  const a = sunDirection(aYaw, aPitch);
  const b = sunDirection(bYaw, bPitch);
  const dot = clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1);
  return (Math.acos(dot) * 180) / Math.PI;
}

/**
 * The zone's star sprites gathered into groups by the direction they share, brightest first. The
 * score is the flare's own: the largest glow plus a quarter of the largest disc, so a big bare disc
 * never outranks a blazing glow. Ties break by yaw then pitch, so the order never depends on the
 * file's order.
 */
export function starGroups(sprites: readonly SunStarSprite[]): SunStarGroup[] {
  const byPlace = new Map<string, SunStarGroup>();
  for (const s of sprites) {
    if (!s || !s.hasImage) continue;
    const key = `${s.yaw}|${s.pitch}`;
    let g = byPlace.get(key);
    if (!g) {
      g = { yaw: s.yaw, pitch: s.pitch, discSize: 0, glowSize: 0, score: 0, weight: 0 };
      byPlace.set(key, g);
    }
    const size = s.size > 0 ? s.size : 0;
    if (s.shader.includes('starglow')) g.glowSize = Math.max(g.glowSize, size);
    else if (s.shader.includes('cels_star')) g.discSize = Math.max(g.discSize, size);
  }
  const out: SunStarGroup[] = [];
  for (const g of byPlace.values()) {
    if (g.glowSize <= 0 && g.discSize <= 0) continue;
    g.score = g.glowSize + 0.25 * g.discSize;
    out.push(g);
  }
  out.sort((a, b) => b.score - a.score || a.yaw - b.yaw || a.pitch - b.pitch);
  return out;
}

/**
 * Which star is this zone's sun, which star keeps it company, and which way the light comes from.
 *
 * `glow` (the default) takes the brightest group by the flare's own ranking, so the light and the
 * flare always agree. `disc` takes the largest disc instead, which is the other reading of "the star
 * you can see"; the two differ most where a big dim disc hangs away from a small blazing glow.
 * A zone with no star sprite at all keeps the file's first light, as before.
 */
export function pickSuns(sprites: readonly SunStarSprite[], lights: readonly SunZoneLight[], rule: SunRule = 'glow'): SunPick {
  const groups = starGroups(sprites);
  const light = lights[0] ?? null;
  const lightDir = light ? sunDirection(light.yaw, light.pitch) : null;
  if (!groups.length) {
    return { chosenBy: 'light', dir: lightDir ?? { x: 0, y: 0, z: -1 }, sun: null, companion: null, second: null, groups, lightOffDegrees: null };
  }
  // Only a star with a glow may be the sun, under either rule. The flare draws a star from its
  // glow, so a sun without one would light the zone from a place the flare could not follow and
  // leave the orbit with no flare at all -- the very thing one pick for everything is meant to
  // stop. A zone of bare discs is lit by the largest of them and simply has nothing to flare.
  const glowing = groups.filter((g) => g.glowSize > 0);
  const candidates = glowing.length ? glowing : groups;
  let sun = candidates[0];
  if (rule === 'disc') {
    // The largest disc; among equal discs the brighter glow, which keeps the order settled.
    for (const g of candidates) if (g.discSize > sun.discSize || (g.discSize === sun.discSize && g.score > sun.score)) sun = g;
  }
  // The flare's amplitudes, as the flare has always scaled them: the sun near full, the second in proportion.
  sun.weight = Math.min(1, Math.max(0.4, sun.score));
  let companion: SunStarGroup | null = null;
  for (const g of groups) {
    if (g === sun || g.glowSize <= 0) continue;
    if (degreesApart(sun.yaw, sun.pitch, g.yaw, g.pitch) > SPACE_SKY_TUNE.companionDegrees) continue;
    if (!companion || g.score > companion.score) companion = g;
  }
  // With no companion the next brightest star keeps the flare's second slot, as it had before, but
  // only when it is nearly as bright: a faint star has no business flaring beside a sun.
  let second: SunStarGroup | null = null;
  if (!companion && MAX_FLARE_SOURCES > 1) {
    for (const g of groups) {
      if (g === sun || g.glowSize <= 0 || g.score < SECOND_STAR_RATIO * sun.score) continue;
      if (!second || g.score > second.score) second = g;
    }
  }
  const partner = companion ?? second;
  // Held to a full amplitude like the sun's own: under the disc rule the sun is not the brightest
  // star, so a partner brighter than it would otherwise be handed a weight above one.
  if (partner) partner.weight = sun.score > 0 ? Math.min(1, (sun.weight * partner.score) / sun.score) : 0;
  return {
    chosenBy: rule,
    dir: sunDirection(sun.yaw, sun.pitch),
    sun,
    companion,
    second,
    groups,
    lightOffDegrees: light ? degreesApart(sun.yaw, sun.pitch, light.yaw, light.pitch) : null,
  };
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
