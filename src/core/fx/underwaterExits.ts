// The underwater pass's exits variant, its pure half (Map-maker II's fifth wave, DESIGN.md §2.7's "looking out of a dry
// room through a doorway under water"): which frames it draws on, the text of its program (today's look with the region
// mask put in, nothing taken out), the region mask's own program and the stencil it reads. `underwater.ts` builds the
// materials from these; a node test runs them (the pass's own file imports what node cannot load).
//
// Pure: no imports. Rule for this file (node runs it with type stripping): no enum, no namespace, no constructor
// parameter properties.

/** The stencil the portal renderer leaves on the world seen through a building's exits from inside it (`applyFxStencil`'s 2). */
export const EXITS_STENCIL = 2;

/** The exits' region mask: where the stencil says the world is seen through an exit, the material's own test doing the work. */
export const UNDERWATER_REGION_FRAG = /* glsl */ `
  void main() { gl_FragColor = vec4(1.0); }
`;

/**
 * The exits variant's fragment program: today's text with two pieces put in and nothing taken out -- the region mask's
 * sampler before `vUv`, and at the head of `main` every pixel outside the mask handed through as it came -- so the world
 * seen through a submerged exit from a dry room is graded by today's very arithmetic, while today's own material keeps its
 * text and its key. All of it or none: a text whose anchors are not there once each answers null.
 */
export function exitsFragment(text: string): string | null {
  const varying = 'varying vec2 vUv;';
  const main = 'void main() {';
  if (text.split(varying).length !== 2 || text.split(main).length !== 2) return null;
  return text
    .replace(varying, `${EXITS_SAMPLER}${varying}`)
    .replace(main, `${main}${EXITS_HEAD}`);
}

/** The two pieces `exitsFragment` puts in, so a test can take them back out and find today's text. */
export const EXITS_SAMPLER = 'uniform sampler2D tRegion;\n    ';
export const EXITS_HEAD = "\n      // Outside the exits' region (the rooms, a wall, anything not the world seen through an exit): as it came.\n      if (texture2D(tRegion, vUv).r < 0.5) {\n        gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb, 1.0);\n        return;\n      }";

/** What decides an exits frame, the frame context's own words. */
export interface ExitsAsk {
  /** The camera under water itself: today's look, never the variant. */
  cameraSubmerged: boolean;
  /** The camera stands in a building's rooms (the portal renderer's building view). */
  portalView: boolean;
  /** One of that building's exits stands under water (`World.exitWaterOf`). */
  exitWater: boolean;
  /** The switch (`UNDERWATER_TUNE.exits`). */
  on: boolean;
  /** The variant was built (a host gave it its region target and today's text took the pieces). */
  built: boolean;
  /** The underwater colour strength (the variant moves no picture, so the shimmer's strength alone draws nothing). */
  strength: number;
}

/**
 * Whether the exits variant draws this frame: the camera dry, in a building's rooms, one of whose exits stands under water,
 * the switch on, the variant built and the colour strength above nought. Every other frame draws today's look or nothing.
 */
export function exitsDraws(a: ExitsAsk): boolean {
  return !a.cameraSubmerged && a.portalView && a.exitWater && a.on && a.built && a.strength > 0;
}

/**
 * What `exitsUnderWater` asks of the world about one point of the game's frame, a kept record the world writes once: the
 * point (`x`, `y`, `z`, written before each ask), the water's surface over it (`h`, written by `surface()`: the very rule
 * every reader asks, `Terrain.waterHeightAt`, -Infinity for none), and whether the water over it is lava (`lava()`). The
 * numbers ride the record, never a call's arguments or answer, so a frame that asks makes nothing.
 */
export interface ExitWaterAsk {
  x: number;
  y: number;
  z: number;
  h: number;
  surface(): void;
  lava(): boolean;
}

/** What `exitsUnderWater` found, a kept record: whether an exit stands under water, the deepest's depth, its place and surface. */
export interface ExitWaterFound {
  under: boolean;
  depth: number;
  x: number;
  z: number;
  surface: number;
}

/**
 * Whether any of a building's exits stands under water seen from inside it (`World.exitWaterOf`, the frame's word to the
 * exits variant): each exit's middle (`centroid`, the building's own frame, `roomAirMath.ts`'s apertures) carried into the
 * world through the building's matrix (`m`, column-major as three keeps it, its last row the affine one), the surface over
 * it asked, the deepest exit under water that is not lava kept -- its depth under the surface, its place and the surface
 * -- and a lava exit stepped over, never taken as water. `found` is written whatever the answer (under and depth nought for
 * none). Pure: the world hands it the ask, the matrix and the record, and a node test runs it.
 */
export function exitsUnderWater(exits: readonly { centroid: readonly number[] }[], m: ArrayLike<number>, ask: ExitWaterAsk, found: ExitWaterFound): boolean {
  found.under = false;
  found.depth = 0;
  let best = 0;
  for (let i = 0; i < exits.length; i++) {
    const c = exits[i].centroid;
    const x = m[0] * c[0] + m[4] * c[1] + m[8] * c[2] + m[12];
    const y = m[1] * c[0] + m[5] * c[1] + m[9] * c[2] + m[13];
    const z = m[2] * c[0] + m[6] * c[1] + m[10] * c[2] + m[14];
    ask.x = x;
    ask.y = y;
    ask.z = z;
    ask.surface();
    const d = ask.h - y;
    if (!(d > best)) continue;
    if (ask.lava()) continue;
    best = d;
    found.x = x;
    found.z = z;
    found.surface = ask.h;
  }
  if (!(best > 0)) return false;
  found.under = true;
  found.depth = best;
  return true;
}
