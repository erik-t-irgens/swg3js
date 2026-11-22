// The air's interface (the GPU port's pass 2, wave 1, the design's 2.1 and 2.2): what the drawers of the sky, the sun
// discs, the haze pass and the see-through things' fog node call, and what the air's maker keeps behind it. Written first
// and kept stable, so both halves of the wave code against one surface.
//
// Pure: plain types, the tables' sizes, the arithmetic of their mappings (each one also written in the tables' node
// graphs, `airTables.ts`, and held to these by the node tests), and the one holder `AIR` the WebGPU side fills. Nothing of
// three's WebGPU build is imported here, so a module the WebGL path loads may import this one (rule 1); three's core is
// imported only for the kept vectors and colours of the frame record.
//
// Units. Inside the air every length is a kilometre and every coefficient is per kilometre (Hillaire's convention); a
// distance handed in by a drawer is in metres and the helpers say so. Every light the air hands out (the sky's radiance,
// the haze's in-scattered light, the sun's illuminance) is in the scene's light units: the factor `AIR_UNITS.scene` makes
// a clear Tatooine noon's sun at the ground light the world as today's clear Tatooine noon does (`SWG_MAIN_LIGHT` 2.4 times
// that row's scale on its colour, `TODAY_NOON_KEY`), and every other light the air makes is in the ratio physics gives it
// to that sun (the design's 2.1).
import * as THREE from 'three';

/** A node of three's shading language (`three/tsl`); typed loosely, as every graph of the port is. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AirNode = any;

/** The four tables' sizes (the design's 2.1): texels across, down and (the haze) deep. */
export const AIR_SIZES = {
  /** Transmittance to the top of the air, by height and the cosine of the view's zenith angle (Bruneton's mapping). */
  transmittance: { width: 256, height: 64 },
  /** Multiple scattering's share, by the sun's cosine (across) and height (down), Hillaire's 2020 approximation. */
  multiScatter: { width: 32, height: 32 },
  /** The sky's radiance about the camera, by the view's azimuth from the sun (across) and its elevation (down). */
  skyView: { width: 192, height: 108 },
  /** The haze: in-scattered light and transmittance along the frame camera's rays, out to `HAZE_REACH_M`. */
  haze: { width: 32, height: 32, depth: 32 },
} as const;

/** How far the haze volume reaches from the camera, metres (the design's 2.2): the sky view and the transmittance beyond. */
export const HAZE_REACH_M = 24_000;

// ---------------------------------------------------------------- the haze volume's slices

/**
 * Where a distance from the camera falls in the haze volume's depth, as a texture coordinate in [0, 1]: the slices are
 * laid by the square of the coordinate (`d = reach · w²`), so the near air, where the eye reads haze against things it
 * knows, has most of the 32. A slice's texel centre `(k + 0.5) / 32` holds the haze at `d((k + 0.5) / 32)`; nearer than
 * slice 0's centre (5.9 m) the drawer reads slice 0, which is the haze of six metres of air, nothing to the eye.
 */
export function hazeSliceW(distanceM: number): number {
  const d = distanceM > 0 ? distanceM : 0;
  const w = Math.sqrt(d / HAZE_REACH_M);
  return w < 1 ? w : 1;
}

/** The distance from the camera, metres, a depth coordinate of the haze volume stands for (`hazeSliceW`'s inverse). */
export function hazeSliceDistanceM(w: number): number {
  const c = w > 0 ? (w < 1 ? w : 1) : 0;
  return HAZE_REACH_M * c * c;
}

// ---------------------------------------------------------------- the transmittance table (Bruneton 2017's mapping)

/** A unit range made a texture coordinate that lands on the first and last texels' centres (Bruneton's sub-uv). */
export function unitToTexel(x: number, size: number): number {
  return 0.5 / size + x * (1 - 1 / size);
}

/** A texture coordinate on texel centres made a unit range again (`unitToTexel`'s inverse). */
export function texelToUnit(u: number, size: number): number {
  return (u - 0.5 / size) / (1 - 1 / size);
}

/**
 * The transmittance table's coordinates for a point `r` km from the planet's centre and the cosine `mu` of a ray's zenith
 * angle there, into `out` as [u, v]: `v` is the height as the share of the horizon distance from the top (`rho / H`), `u`
 * the distance to the top of the air between its least and most at that height. `bottom` and `top` are the planet's and
 * the air's radii, km.
 */
export function transmittanceUv(r: number, mu: number, bottom: number, top: number, out: Float64Array | number[], width: number = AIR_SIZES.transmittance.width, height: number = AIR_SIZES.transmittance.height): void {
  const H = Math.sqrt(top * top - bottom * bottom);
  const rr = r > bottom ? (r < top ? r : top) : bottom;
  const rho = Math.sqrt(Math.max(0, rr * rr - bottom * bottom));
  const disc = rr * rr * (mu * mu - 1) + top * top;
  const d = Math.max(0, -rr * mu + Math.sqrt(Math.max(0, disc)));
  const dMin = top - rr;
  const dMax = rho + H;
  const xMu = dMax > dMin ? (d - dMin) / (dMax - dMin) : 0;
  const xR = rho / H;
  out[0] = unitToTexel(xMu < 0 ? 0 : xMu > 1 ? 1 : xMu, width);
  out[1] = unitToTexel(xR < 0 ? 0 : xR > 1 ? 1 : xR, height);
}

/** The height `r` (km from the centre) and zenith cosine `mu` a transmittance texel centre stands for, into `out` as [r, mu]. */
export function transmittanceRMu(u: number, v: number, bottom: number, top: number, out: Float64Array | number[], width: number = AIR_SIZES.transmittance.width, height: number = AIR_SIZES.transmittance.height): void {
  const xMu = texelToUnit(u, width);
  const xR = texelToUnit(v, height);
  const H = Math.sqrt(top * top - bottom * bottom);
  const rho = H * xR;
  const r = Math.sqrt(rho * rho + bottom * bottom);
  const dMin = top - r;
  const dMax = rho + H;
  const d = dMin + xMu * (dMax - dMin);
  const mu = d === 0 ? 1 : (H * H - rho * rho - d * d) / (2 * r * d);
  out[0] = r;
  out[1] = mu < -1 ? -1 : mu > 1 ? 1 : mu;
}

// ---------------------------------------------------------------- the multiple-scattering table

/** The multiple-scattering table's coordinates for a height `r` and the sun's zenith cosine `muS`, into `out` as [u, v]. */
export function multiScatterUv(r: number, muS: number, bottom: number, top: number, out: Float64Array | number[], width: number = AIR_SIZES.multiScatter.width, height: number = AIR_SIZES.multiScatter.height): void {
  const x = 0.5 + 0.5 * muS;
  const y = (r - bottom) / (top - bottom);
  out[0] = unitToTexel(x < 0 ? 0 : x > 1 ? 1 : x, width);
  out[1] = unitToTexel(y < 0 ? 0 : y > 1 ? 1 : y, height);
}

/** The height `r` (km from the centre) and the sun's zenith cosine a multiple-scattering texel centre stands for, into `out` as [r, muS]. */
export function multiScatterRMu(u: number, v: number, bottom: number, top: number, out: Float64Array | number[], width: number = AIR_SIZES.multiScatter.width, height: number = AIR_SIZES.multiScatter.height): void {
  const x = texelToUnit(u, width);
  const y = texelToUnit(v, height);
  out[0] = bottom + (y < 0 ? 0 : y > 1 ? 1 : y) * (top - bottom);
  out[1] = (x < 0 ? 0 : x > 1 ? 1 : x) * 2 - 1;
}

// ---------------------------------------------------------------- the sky view

/**
 * The angle below the horizontal at which the planet's edge stands for an eye `r` km from the centre (radians, ≥ 0): the
 * sky view's middle row is the true horizon, not the eye's level.
 */
export function horizonDip(r: number, bottom: number): number {
  const s = bottom / (r > bottom ? r : bottom);
  return Math.acos(s > 1 ? 1 : s);
}

/**
 * The sky view's coordinates for a view whose elevation above the eye's level is `elevation` (radians) and whose azimuth
 * from the sun's is `azimuth` (radians, either way: the table is the half the sun's plane mirrors), into `out` as [u, v].
 * Across: `u = sqrt(azimuth / π)` on texel centres, so the side of the sun, where the glow changes fastest, has most of the
 * columns. Down: `v` 0 at the zenith, 0.5 at the true horizon (`horizonDip` below the eye's level), 1 at the nadir, each
 * half by the square root of its angle from the horizon, so rows crowd the horizon where the colour turns.
 */
export function skyViewUv(elevation: number, azimuth: number, dip: number, out: Float64Array | number[]): void {
  const a = Math.abs(azimuth);
  const x = Math.sqrt((a > Math.PI ? Math.PI : a) / Math.PI);
  const fromHorizon = elevation + dip;
  let y: number;
  if (fromHorizon >= 0) {
    const span = Math.PI / 2 + dip;
    const t = fromHorizon / span;
    y = 0.5 - 0.5 * Math.sqrt(t > 1 ? 1 : t);
  } else {
    const span = Math.PI / 2 - dip;
    const t = -fromHorizon / (span > 1e-6 ? span : 1e-6);
    y = 0.5 + 0.5 * Math.sqrt(t > 1 ? 1 : t);
  }
  out[0] = unitToTexel(x, AIR_SIZES.skyView.width);
  out[1] = unitToTexel(y, AIR_SIZES.skyView.height);
}

/** The elevation and azimuth (radians) a sky-view texel centre stands for (`skyViewUv`'s inverse), into `out` as [elevation, azimuth]. */
export function skyViewAngles(u: number, v: number, dip: number, out: Float64Array | number[]): void {
  const x = texelToUnit(u, AIR_SIZES.skyView.width);
  const y = texelToUnit(v, AIR_SIZES.skyView.height);
  const xc = x < 0 ? 0 : x > 1 ? 1 : x;
  out[1] = xc * xc * Math.PI;
  if (y <= 0.5) {
    const t = (0.5 - y) / 0.5;
    out[0] = t * t * (Math.PI / 2 + dip) - dip;
  } else {
    const t = (y - 0.5) / 0.5;
    out[0] = -dip - t * t * (Math.PI / 2 - dip);
  }
}

// ---------------------------------------------------------------- what the drawers read

/**
 * The air's own numbers for this frame, kept and rewritten in place by the air's maker once a frame (the twin's,
 * `airTwin.ts`), read by the drawers and the world: nothing here is made per frame. Directions are unit world vectors (+Y
 * up); lights are in the scene's units, linear.
 */
export interface AirFrame {
  /** Whether the air is drawing this frame (WebGPU, a planet with a sky, the setting at ours). */
  on: boolean;
  /** The casting sun's direction (the day's `sunDir`, whatever moves it). */
  readonly sunDir: THREE.Vector3;
  /** The moon's (the day's `moonDir`). */
  readonly moonDir: THREE.Vector3;
  /** A second sun's (Tatooine's pair), and whether this world has one. */
  readonly sun2Dir: THREE.Vector3;
  sun2: boolean;
  /** The casting sun's illuminance at the top of the air, scene units (its colour times its strength times `AIR_UNITS.scene`). */
  readonly sunTop: THREE.Color;
  /** The second sun's, black on a world with one star. */
  readonly sun2Top: THREE.Color;
  /** The moon's (the sun's, times the share a nearly full moon sends back, until wave 5's phases). */
  readonly moonTop: THREE.Color;
  /** What reaches the camera of each, through the air (the twin's transmittance at the camera's height). */
  readonly sunHere: THREE.Color;
  readonly sun2Here: THREE.Color;
  readonly moonHere: THREE.Color;
  /** The sun disc's angular radius, radians (the record's). */
  sunRadius: number;
  /** The camera's height above the planet's surface, km (the air's datum: the world's sea level). */
  heightKm: number;
  /** The clear-day visibility in force for this world (its dial) and this frame's after the weather, km. */
  clearVisibilityKm: number;
  visibilityKm: number;
  /**
   * What the rain and wet surfaces take in place of the scene's fog (the design's 2.1, "a fog-equivalent density and
   * colour"): the exponential-squared density per metre whose fog reaches 98% at this frame's visibility, and the air's
   * colour at the horizon averaged round the sky.
   */
  fogDensity: number;
  readonly fogColour: THREE.Color;
  /** The weather's overcast, 0 to 1 (the storm fade of the discs, as the sky's `setOvercast` takes it). */
  overcast: number;
  /** The steer toward SWG's colours in force (0 realism first; the world's dial). */
  steer: number;
  /** The per-channel gain the steer puts on everything the air adds (the sky's radiance and the haze's light); 1 at 0. */
  readonly gain: THREE.Vector3;
}

/** The frame record, made once: the air's maker writes it, everything else reads it. */
export function makeAirFrame(): AirFrame {
  return {
    on: false,
    sunDir: new THREE.Vector3(0, 1, 0),
    moonDir: new THREE.Vector3(0, -1, 0),
    sun2Dir: new THREE.Vector3(0, 1, 0),
    sun2: false,
    sunTop: new THREE.Color(1, 1, 1),
    sun2Top: new THREE.Color(0, 0, 0),
    moonTop: new THREE.Color(0, 0, 0),
    sunHere: new THREE.Color(1, 1, 1),
    sun2Here: new THREE.Color(0, 0, 0),
    moonHere: new THREE.Color(0, 0, 0),
    sunRadius: 0.5 * 0.0093,
    heightKm: 0.5,
    clearVisibilityKm: 40.5,
    visibilityKm: 40.5,
    fogDensity: 0.5,
    fogColour: new THREE.Color(0.5, 0.5, 0.5),
    overcast: 0.5,
    steer: 0.5,
    gain: new THREE.Vector3(1, 1, 1),
  };
}

/**
 * The tables and their readers on WebGPU (`airTables.ts` makes it; nothing makes it on WebGL). Each reader is a function
 * of three's shading language a drawer calls while building its graph, never per frame: it hands back a node over the
 * tables' textures and the air's uniform nodes, so the graph reads this frame's tables whatever it was built over.
 */
export interface AirTables {
  /** The four textures (linear, half floats): read them only through the readers below, which carry their mappings. */
  readonly transmittance: THREE.Texture;
  readonly multiScatter: THREE.Texture;
  readonly skyView: THREE.Texture;
  /** A 3D texture (`Storage3DTexture`): rgb the light the air adds between the camera and a slice, a its mean transmittance. */
  readonly haze: THREE.Texture;
  /**
   * The sky's radiance toward a unit world direction (a vec3 node), scene units (vec3), the steer's gain applied, the sun's
   * disc not in it (the discs are the drawer's: `transmittanceToSpace` and `nodes.sunTop`).
   */
  skyRadiance(dir: AirNode): AirNode;
  /** The transmittance (vec3) from the camera through the air to space along a unit world direction (vec3 node); 0 into the ground. */
  transmittanceToSpace(dir: AirNode): AirNode;
  /**
   * The haze for a point the camera sees: `ndc` the point's place on the screen in normalised device coordinates (vec2,
   * x right, y up, −1 to 1, the frame camera's, without the edge smoothing's nudge) and `distanceM` its distance from the
   * camera in metres (float). Answers vec4: rgb the light the air adds in front of it (scene units, the gain applied), a
   * the share of the point's own light that gets through. Past `HAZE_REACH_M` it answers the reach's values: the drawer
   * takes the sky view and the transmittance beyond.
   */
  hazeAt(ndc: AirNode, distanceM: AirNode): AirNode;
  /** The air's uniform nodes, for a drawer's own arithmetic (each written once a frame from `AIR.frame`). */
  readonly nodes: AirNodes;
  /**
   * Once a game frame, after the camera is placed and before the scene's passes and the edge smoothing's nudge: the sky view
   * and the haze volume drawn for this camera, and the transmittance and multiple scattering drawn again first where the
   * record moved. The air's maker calls it (the world); a drawer never does.
   */
  frame(camera: THREE.PerspectiveCamera): void;
  /** Whether every table has been drawn at least once (the first `frame`, behind the loading screen). */
  readonly ready: boolean;
  /** What `__debug.sky()` reports of the tables: their last rebuild (when, why, how many), and the record in force. */
  report(): Record<string, unknown>;
}

/** The air's uniform nodes (vec3 unless said), each written from `AIR.frame` once a frame by the air's maker. */
export interface AirNodes {
  sunDir: AirNode;
  sun2Dir: AirNode;
  moonDir: AirNode;
  /** Top-of-air illuminances, scene units. */
  sunTop: AirNode;
  sun2Top: AirNode;
  moonTop: AirNode;
  /** Float: the disc's angular radius, radians. */
  sunRadius: AirNode;
  /** Float: the camera's height above the surface, km. */
  heightKm: AirNode;
  /** The steer's gain on what the air adds. */
  gain: AirNode;
  /** Float: the overcast, 0 to 1. */
  overcast: AirNode;
}

/**
 * The scene's light units against the air's: `scene` turns a physical illuminance (the record's sun strength through the
 * air, per unit of the sun's own) into the scene's, set once at load from Tatooine's clear record at its noon so that sun
 * lights as today's clear Tatooine noon does (`airTwin.ts`'s `sceneUnits` and `TODAY_NOON_KEY`: 2.4 times the row's scale
 * on its colour, 1.903 in luminance). Every light of the air is multiplied by it.
 */
export const AIR_UNITS = { scene: 1.5 };

/**
 * The one holder (filled by the air's maker): the frame record, the tables on WebGPU (null on WebGL and until they are
 * made), and SWG's own lighting of this hour as the sky's ramps gave it before the twin wrote over it (the night floor's
 * and the steer's reference, kept in place).
 */
export const AIR = {
  frame: makeAirFrame(),
  tables: null as AirTables | null,
  /** SWG's colours of this hour, copied from `SwgSky.lighting` before the twin writes it (kept colours, linear). */
  swg: {
    main: new THREE.Color(1, 1, 1),
    mainScale: 0.5,
    ambient: new THREE.Color(0.3, 0.3, 0.3),
    ambientScale: 0.5,
    fill: new THREE.Color(0, 0, 0),
    fillScale: 0.5,
    bounce: new THREE.Color(0, 0, 0),
    bounceScale: 0.5,
    fog: new THREE.Color(0.5, 0.5, 0.5),
    fogDensity: 0.5,
    clear: new THREE.Color(0.5, 0.5, 0.6),
  },
  /**
   * SWG's own lighting at the night's middle (`nightFloor.ts`'s `NIGHT_INDEX`) for the sky's mix in force, read off the
   * ramps whenever the mix moves (`SwgSky.lightingAt`): the night floor's brightness, held at every hour until wave 2.
   * Black (so no floor) until the first read.
   */
  swgNight: {
    main: new THREE.Color(0, 0, 0),
    mainScale: 0.5,
    ambient: new THREE.Color(0, 0, 0),
    ambientScale: 0.5,
    fill: new THREE.Color(0, 0, 0),
    fillScale: 0.5,
    bounce: new THREE.Color(0, 0, 0),
    bounceScale: 0.5,
    fog: new THREE.Color(0, 0, 0),
  },
};
