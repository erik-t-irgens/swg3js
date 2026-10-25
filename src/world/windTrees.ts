// The trees' gust form (the volumetrics' wave 7a, the design's §2.17): a tree takes the gust at its own planting's place,
// so a gust walks through a forest tree by tree -- its sway's strength the mean's times `k` there, its bend's amplitude
// gaining the trees' share times the patch, its lean turned by the veer there (the flora's shared wind carries the heading
// alone under the arm, so the turn is taken once).
//
// **The sway chunk's text never changes**: `SWAY_FUNCTIONS` is in every swaying program and, joined with its pars, the
// grass's chunk to the byte, so an `#ifdef` added to it would change every flora program's source with the master off.
// The form is a rewrite of the chunk's output inside the sway wrap's own hook, all or nothing over its three anchors (the
// `swgWind` line, the `swgS` line and the `swgF` line under it), the ground variant's own pattern, applied right after
// `injectSway` under the key prefix `sway-wind7` (the depth materials' `swg-sway-depth-wind7`), and never to the grass,
// whose program is its own.
//
// **It is chosen at an arrival and never in play** (`chooseWindTrees`, from `World.load`): every swaying mesh casts through
// a custom depth material whose program comes only from a shadow-pass draw, so every flora material wrapped in an arrival
// that chose the form takes it, the world's warm-up draws the form's depth combinations behind the screen, and a material
// wrapped in an earlier arrival keeps the form it was wrapped in. With the unified wind off or its art at nought the form's
// branch is not taken (`uWind7`'s on is nought) and the tree sways as the plain chunk does.
import { CANOPY_MAX, FLUTTER_PHASE_PER_METRE, swayHash, type SwayFrame, type SwayModelState, type SwayTune } from './swayMath.ts';
import { WIND7_GLSL } from './windMath.ts';
import { wind7Uniforms } from './wind.ts';

/** The chunk's three lines the form rewrites (`swayMath.ts`'s `SWAY_FUNCTIONS`), each found exactly once or nothing is written. */
export const TREES_ANCHORS = [
  'vec3 swgWind = transpose( mat3( swgModel ) ) * vec3( uSwayWind.x, 0.0, uSwayWind.y );',
  'float swgS = clamp( uSwayWind.z, 0.0, 1.0 );',
  'float swgF = uSwayTune.y + ( 1.0 - uSwayTune.y ) * swgSwayStep( 0.0, 0.8, swgS );',
] as const;

/** What each anchor becomes: the line kept, the form after it under the unified wind's own branch. */
export const TREES_REWRITES = [
  `// The trees' gust form (wave 7a): the gust at this planting's place, its lean turned by the veer there.
	vec3 swgW7G = w7On() ? w7Gust( swgPlace.xz ) : vec3( 1.0, 0.0, 0.0 );
	vec2 swgW7Dir = vec2( uSwayWind.x, uSwayWind.y );
	if ( w7On() && swgW7G.y != 0.0 ) swgW7Dir = swgW7Turn( uSwayWind.x, uSwayWind.y, swgW7G.y );
	vec3 swgWind = transpose( mat3( swgModel ) ) * vec3( swgW7Dir.x, 0.0, swgW7Dir.y );`,
  `float swgS = clamp( uSwayWind.z, 0.0, 1.0 );
	if ( w7On() ) swgS = swgW7Strength( uSwayWind.z, swgW7G.x );`,
  `float swgF = uSwayTune.y + ( 1.0 - uSwayTune.y ) * swgSwayStep( 0.0, 0.8, swgS );
	if ( w7On() ) swgF = swgW7Bend( swgF, uWind7[ 6 ].z, swgW7G.z );`,
] as const;

/**
 * The form's own arithmetic, put in with the gust function: each a function written by its components, so the tests run
 * this very text as script (glslRun.ts) and hold the turn's sense to the air's own (`w7Target`).
 */
export const TREES_GLSL = /* glsl */ `
// The trees' gust form (wave 7a): the flora's wind direction (x, z) turned by a gust's veer, the way the air's own target
// turns its wind (w7Target).
vec2 swgW7Turn( float x, float z, float a ) {
	float c = cos( a );
	float s = sin( a );
	return vec2( x * c + z * s, z * c - x * s );
}
// The sway's strength under the gust at the planting: the flora's mean strength times k there, held to [0, 1].
float swgW7Strength( float s, float k ) {
	return clamp( s * k, 0.0, 1.0 );
}
// The bend's amplitude under a gust patch: the trees' share times the patch on it, held at most one (the sway's pad).
float swgW7Bend( float f, float trees, float inPatch ) {
	return min( 1.0, f * ( 1.0 + trees * inPatch ) );
}
`;

/** Where the gust function's declarations go: after three's own common chunk, ahead of the sway chunk `injectSway` put there. */
const COMMON = '#include <common>';

/** `text` with `from` replaced by `to`, or null where `from` is not found exactly once. */
function replaceOnce(text: string, from: string, to: string): string | null {
  const i = text.indexOf(from);
  if (i < 0 || text.indexOf(from, i + from.length) >= 0) return null;
  return text.slice(0, i) + to + text.slice(i + from.length);
}

/** The form's vertex text from the wrap's own (the sway chunk already in), every rewrite made or none (null). */
export function treesFormText(vertex: string): string | null {
  let v: string | null = vertex;
  for (let i = 0; i < TREES_ANCHORS.length; i++) if (v) v = replaceOnce(v, TREES_ANCHORS[i], TREES_REWRITES[i]);
  if (!v) return null;
  const c = v.indexOf(COMMON);
  if (c < 0) return null;
  const at = c + COMMON.length;
  return `${v.slice(0, at)}\n${WIND7_GLSL}${TREES_GLSL}${v.slice(at)}`;
}

/** What the form did this session, for the console and the Start's count. */
export const TREES_STATS = { chosen: false, arrivals: 0, applied: 0, missed: 0, colour: 0, depth: 0 };

let chosen = false;

/** The arrival's choice (`World.load`, before anything is wrapped or compiled): the master, `volWind` and `volWindTrees` on. */
export function chooseWindTrees(on: boolean): void {
  chosen = on;
  TREES_STATS.chosen = on;
  TREES_STATS.arrivals++;
}

/** Whether this arrival chose the form. */
export function windTreesChosen(): boolean {
  return chosen;
}

/** Whether any material has been wrapped in the form this session (its depth combinations are then warmed at every screen). */
let everUsed = false;
export function windTreesEverUsed(): boolean {
  return everUsed;
}

/**
 * The form into one compiled vertex stage, colour or depth, after `injectSway`: the three rewrites and the gust function,
 * all or nothing, and the unified wind's one uniform object by reference. Answers whether it wrote.
 */
export function applyTreesForm(shader: { vertexShader: string; uniforms: Record<string, unknown> }, depth: boolean): boolean {
  const v = treesFormText(shader.vertexShader);
  if (!v) {
    TREES_STATS.missed++;
    return false;
  }
  shader.vertexShader = v;
  shader.uniforms.uWind7 = wind7Uniforms().uWind7;
  TREES_STATS.applied++;
  if (depth) TREES_STATS.depth++;
  else TREES_STATS.colour++;
  everUsed = true;
  return true;
}

/** The console's report on the form. */
export function windTreesReport(): Record<string, unknown> {
  return {
    note: chosen ? 'the trees take each gust where they stand (chosen at this arrival)' : "the trees sway at the day's wind (the form is chosen at an arrival with the master, volWind and volWindTrees on)",
    ...TREES_STATS,
  };
}

// ---------------------------------------------------------------------------------------------- the mirror

/** What the form's mirror is handed of the gust at the planting's place (`gustFlat`'s answer there) and the pack. */
export interface TreesGust {
  on: boolean;
  k: number;
  veer: number;
  patch: number;
  /** The trees' share (the pack's `uWind7[6].z`). */
  trees: number;
}

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * The chunk's output with the form, line for line (`swayMath.ts`'s `swayOffset` with the three rewrites under `on`): the
 * mirror the test holds to the plain sway's by `Object.is` with the form's branch not taken.
 */
export function swayOffsetForm(out: [number, number, number], p: readonly number[], m: ArrayLike<number>, model: SwayModelState, f: SwayFrame, t: SwayTune, g: TreesGust): [number, number, number] {
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  if (!t.on || !(model.gain > 0)) return out;
  const H = Math.max(model.shape.H, 1e-3);
  const px = m[12];
  const py = m[13];
  const pz = m[14];
  const fade = 1 - smoothstep(t.fadeNear, t.fadeFar, Math.hypot(px - f.eye[0], py - f.eye[1], pz - f.eye[2]));
  if (fade <= 0) return out;
  let dx = f.windX;
  let dz = f.windZ;
  if (g.on && g.veer !== 0) {
    const c = Math.cos(g.veer);
    const s = Math.sin(g.veer);
    dx = f.windX * c + f.windZ * s;
    dz = f.windZ * c - f.windX * s;
  }
  let wx = m[0] * dx + m[2] * dz;
  let wy = m[4] * dx + m[6] * dz;
  let wz = m[8] * dx + m[10] * dz;
  const wl = Math.hypot(wx, wy, wz);
  if (wl > 1e-6) {
    wx /= wl;
    wy /= wl;
    wz /= wl;
  } else {
    wx = 0;
    wy = 0;
    wz = 0;
  }
  let s = Math.min(1, Math.max(0, f.strength));
  if (g.on) s = Math.min(1, Math.max(0, f.strength * g.k));
  let F = t.calm + (1 - t.calm) * smoothstep(0, 0.8, s);
  if (g.on) F = Math.min(1, F * (1 + g.trees * g.patch));
  const Ff = t.calm + (1 - t.calm) * s;
  const c = t.trunk === 'bend' ? 0 : Math.min(CANOPY_MAX, Math.max(0, model.shape.c));
  const h = Math.max(p[1], 0) / H;
  const bend = h > c ? ((h - c) / (1 - c)) ** 2 : 0;
  const phi = 2 * Math.PI * swayHash(px, pz);
  const osc = Math.sin(model.omega * f.t + phi) + 0.3 * Math.sin(2 * model.omega * f.t + 1.7 * phi);
  const A = t.amp * Math.sqrt(H);
  const k = A * F * (t.lean * F + osc) * bend;
  const off = smoothstep(model.shape.rT, 2 * model.shape.rT + 0.3, Math.hypot(p[0] - model.shape.axisX, p[2] - model.shape.axisZ));
  const fl = t.flutter * Ff * Math.sin(f.flutterOmega * f.t + phi + FLUTTER_PHASE_PER_METRE * (p[0] + p[1] + p[2])) * Math.min(h, 1) * off;
  const gg = model.gain * fade;
  out[0] = (wx * k + 0.6 * wx * fl) * gg;
  out[1] = (wy * k + (0.6 * wy + 0.8) * fl) * gg;
  out[2] = (wz * k + 0.6 * wz * fl) * gg;
  return out;
}
