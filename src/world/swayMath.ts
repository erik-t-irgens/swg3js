// Flora sway, as arithmetic: the GLSL chunk every swaying flora program and its shadow carry, its JavaScript
// mirror, how a model's shape is measured, which models sway, and the laws and the quantiser. All of it is
// ours: the owner saw nothing sway in the original (answer 11), and asked for the grass at least, then the
// canopies, never the trunks. Pure: no three, no DOM. Wave 5b's grass reuses the chunk and the uniforms.
//
// **One field over every primitive of a swaying model**, never decided by material: card vertices within 15 cm
// of opaque geometry are a median 1.7% and a 90th percentile 33% of a model's cards, and a card bent while the
// branch under it stood still would open a gap up to a whole bend (a leaf card 20 cm off its branch on a 25 m
// tree in a storm). The bend starts at the model's own **canopy base** c, the 5th percentile of its card vertex
// heights over its height (median 0.31), as ((h − c)/(1 − c))², which holds a median 48.5% of each tree's
// opaque vertices at exactly nought: the visible trunk below the crown does not move, the trunk inside the
// crown and the branches move with it, which is what keeps the leaves on them. A flutter, weighted off the
// trunk's axis and radius (measured per model: the axis is up to 66% of the radius off the origin on leaning
// trees), adds leaf motion. Sway is a function of place, so a mirrored copy of a vertex moves exactly with its
// original, and a planting at scale s sways s times as far.
//
// **Nothing view-dependent**: the depth material shares the chunk, and in the shadow pass `cameraPosition` and
// `viewMatrix` are the cascade's camera, so the distance fade reads `uSwayEye`, a uniform of ours. **Whole
// cycles per wrap**: the clock is wrapped on the processor at `wrap` seconds (an unwrapped float32 time steps by
// 16 ms after three days) and every frequency is a whole number of cycles in that wrap, so the wrap is seamless.

/** Sway's knobs (`__debug.sway`): every one ours. Uniforms and live unless noted. */
export interface SwayTune {
  /** Sway at all (amplitude nought when off). */
  on: boolean;
  /** Top amplitude per √metre of height: a 1 m tuft 6 cm, a 13 m tree 22 cm, a 52 m tree 43 cm in a storm. */
  amp: number;
  /** The share left on a still day. */
  calm: number;
  /** The steady downwind lean, times the wind's factor. */
  lean: number;
  /** Period = base · H^pow: 1 m 0.9 s, 13 m 2.5 s, 52 m 4.4 s (quantised on write). */
  periodBase: number;
  periodPow: number;
  /** The leaves' flutter amplitude, metres, and its period. */
  flutter: number;
  flutterPeriod: number;
  /** How much a storm quickens the clock. */
  rateGain: number;
  /** `'still'`: the trunk below the crown does not move (the owner's); `'bend'`: c nought, the whole tree bends from the ground. */
  trunk: 'still' | 'bend';
  /** Sway fades out with distance from the eye, against shimmer at the edge. */
  fadeNear: number;
  fadeFar: number;
  /** Shadows sway with the leaves (the depth material hung or not). */
  shadow: boolean;
  /** The clock's wrap, seconds (load). */
  wrap: number;
  /** `'weather'`, or a strength held for looking. */
  wind: 'weather' | number;
  /** Stop the clock. */
  freeze: boolean;
  /** `'water'`: runs with the water, so the meadow keeps moving under an open panel (decision 11); `'sim'`: stops with the creatures and the falls. */
  clock: 'water' | 'sim';
}

export const SWAY_DEFAULTS: Readonly<SwayTune> = {
  on: true,
  amp: 0.06,
  calm: 0.3,
  lean: 0.4,
  periodBase: 0.9,
  periodPow: 0.4,
  flutter: 0.025,
  flutterPeriod: 0.45,
  rateGain: 0.5,
  trunk: 'still',
  fadeNear: 100,
  fadeFar: 250,
  shadow: true,
  wrap: 3600,
  wind: 'weather',
  freeze: false,
  clock: 'water',
};

/** The flutter's phase a metre along the model: neighbouring leaves flutter out of step. */
export const FLUTTER_PHASE_PER_METRE = 1.3;
/** The canopy base is held under this, so a model whose cards all sit at its top still bends over a span. */
export const CANOPY_MAX = 0.95;

/** One model's shape: its height, canopy base (a share of the height), trunk axis (x, z) and trunk radius, metres in its own frame. */
export interface SwayShape {
  H: number;
  c: number;
  axisX: number;
  axisZ: number;
  rT: number;
}

/** One primitive's positions (three a vertex, the model's own frame) and whether it is a card. */
export interface SwayPrimitive {
  positions: ArrayLike<number>;
  card: boolean;
}

/**
 * A model's shape from its finest level's primitives, each card position counted once (welded to a millimetre),
 * so the mirror's copied vertices, which sit where their originals do, never count twice: H the highest point
 * (never under a centimetre); c the 5th percentile of the card vertices' heights over H (nought with no card,
 * and nought for a model of cards alone, which bends from the ground); the axis the middle, in x and z, of the
 * opaque vertices in the lowest quarter of the height (of the card vertices there when nothing is opaque); the
 * trunk radius the median distance from that axis of the opaque vertices between 15% and half the height.
 */
export function measureSway(prims: readonly SwayPrimitive[]): SwayShape {
  const seenCard = new Set<string>();
  const card: number[] = [];
  const cardXyz: number[] = [];
  const opaque: number[] = [];
  let H = 0;
  for (const p of prims) {
    const a = p.positions;
    for (let i = 0; i + 2 < a.length; i += 3) {
      const x = a[i];
      const y = a[i + 1];
      const z = a[i + 2];
      if (y > H) H = y;
      // Only a card's vertices can have been copied by the mirror; the opaque ones are counted as the model has them.
      if (!p.card) {
        opaque.push(x, y, z);
        continue;
      }
      const key = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
      if (seenCard.has(key)) continue;
      seenCard.add(key);
      card.push(y);
      cardXyz.push(x, y, z);
    }
  }
  H = Math.max(H, 0.01);
  // A model of cards alone (a bush, a fern) bends from the ground: its canopy is the whole of it.
  let c = 0;
  if (card.length && opaque.length) {
    card.sort((p, q) => p - q);
    c = Math.min(CANOPY_MAX, Math.max(0, card[Math.min(card.length - 1, Math.floor(card.length * 0.05))] / H));
  }
  const low = (list: number[]) => {
    let sx = 0;
    let sz = 0;
    let n = 0;
    for (let i = 0; i < list.length; i += 3) {
      if (list[i + 1] >= 0.25 * H) continue;
      sx += list[i];
      sz += list[i + 2];
      n++;
    }
    return n ? { x: sx / n, z: sz / n } : null;
  };
  const axis = (opaque.length ? low(opaque) : low(cardXyz)) ?? { x: 0, z: 0 };
  const radii: number[] = [];
  for (let i = 0; i < opaque.length; i += 3) {
    const y = opaque[i + 1];
    if (y < 0.15 * H || y > 0.5 * H) continue;
    radii.push(Math.hypot(opaque[i] - axis.x, opaque[i + 2] - axis.z));
  }
  radii.sort((p, q) => p - q);
  const rT = radii.length ? radii[Math.floor(radii.length / 2)] : 0;
  return { H, c, axisX: axis.x, axisZ: axis.z, rT };
}

/**
 * Plants whose id names something soft sway though they carry no card (cattails, reeds, the kiteplant). The
 * words are the ones the measurement of 269 swaying models was made with: `grss` as well as `grass`, since
 * some of the packs spell it so.
 */
export const SOFT_PLANT = /leaf|flow|fern|grass|grss|reed|cattail|bamboo|kiteplant|sprig|scrubwort|bauhin|smallflora|vine|weed|thistle/i;
/**
 * And nothing whose id names something rigid sways, cards or not (the mushrooms, crystal bushes, shells, stumps).
 * `log` only as a word of its own and `crystl` beside `crystal`, as that measurement read them.
 */
export const RIGID = /rock|stone|boulder|pebble|(^|_)log|stump|fallen|crystl|crystal|shroom|mushroom|fngi|skull|bone|debris|shell|coral|cactus|world_root/i;

/** Whether a model sways: it carries a card or its id names a soft plant, and its id names nothing rigid. */
export function swaySelected(id: string, hasCard: boolean): boolean {
  return (hasCard || SOFT_PLANT.test(id)) && !RIGID.test(id);
}

/** A model's sway period by our law, seconds. */
export function swayPeriod(H: number, t: Pick<SwayTune, 'periodBase' | 'periodPow'>): number {
  return t.periodBase * Math.pow(Math.max(H, 0.01), t.periodPow);
}

/** The whole number of cycles a period comes to in the wrap (never under one). */
export function cyclesPerWrap(period: number, wrap: number): number {
  return Math.max(1, Math.round(wrap / Math.max(period, 1e-3)));
}

/** The angular frequency of a whole number of cycles per wrap. */
export function omegaOf(cycles: number, wrap: number): number {
  return (2 * Math.PI * cycles) / wrap;
}

/** A model's largest excursion from where it was modelled, in its own metres, at the strongest wind the chunk takes: what its spheres and crown box are padded by. */
export function swayExcursion(H: number, t: Pick<SwayTune, 'amp' | 'lean' | 'flutter'>): number {
  return t.amp * Math.sqrt(Math.max(H, 0.01)) * (t.lean + 1.3) + t.flutter;
}

/** The clock stepped: at `1 + rateGain × strength`, wrapped. */
export function stepClock(t: number, dt: number, strength: number, tune: Pick<SwayTune, 'rateGain' | 'wrap' | 'freeze'>): number {
  if (tune.freeze) return t;
  const next = t + dt * (1 + tune.rateGain * Math.min(1, Math.max(0, strength)));
  return next >= tune.wrap ? next % tune.wrap : next;
}

const fr = Math.fround;
const fract = (v: number) => fr(v - Math.floor(v));

/**
 * The planting's phase hash, as the shader works it in single precision. Every step is held under 2 before the
 * last product: the common form of this hash multiplies two numbers near 70 and 140 and takes the fraction of
 * about ten thousand, where a float keeps three decimals, so one GPU's fused multiply-add moved a storm's phase
 * by a hundredth of a turn and the sway 3 mm off its mirror.
 */
export function swayHash(x: number, z: number): number {
  let qx = fract(fr(fr(x) * fr(0.1031)));
  let qy = fract(fr(fr(z) * fr(0.1031)));
  let qz = fract(fr(fr(x) * fr(0.1031)));
  const d = fr(fr(qx * fr(qy + fr(33.33))) + fr(fr(qy * fr(qz + fr(33.33))) + fr(qz * fr(qx + fr(33.33)))));
  qx = fract(fr(qx + d));
  qy = fract(fr(qy + d));
  qz = fract(fr(qz + d));
  return fract(fr(fr(fr(qx + qy) * qz) * 8));
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** The frame's shared state the chunk reads: the wind, the clock, the eye. */
export interface SwayFrame {
  /** The wind's heading in the world, unit (x, z), and its strength 0..1. */
  windX: number;
  windZ: number;
  strength: number;
  /** The wrapped clock, seconds. */
  t: number;
  /** The flutter's angular frequency (quantised). */
  flutterOmega: number;
  eye: [number, number, number];
}

/** One model's own: its shape, its quantised angular frequency and whether it sways (gain 1) or not (0). */
export interface SwayModelState {
  shape: SwayShape;
  omega: number;
  gain: number;
}

/**
 * The displacement of one vertex `p` (the model's own frame) of a planting whose world matrix is `m` (sixteen
 * numbers, column-major, three's own: the model's matrix times the instance's), in the model's own frame (the
 * shader adds it to `transformed`): the bend downwind with its steady lean, and the flutter off the trunk, faded
 * by the planting's distance from the eye. The mirror the shader must equal.
 */
export function swayOffset(out: [number, number, number], p: readonly number[], m: ArrayLike<number>, model: SwayModelState, f: SwayFrame, t: SwayTune): [number, number, number] {
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
  // The wind into the model's frame: the transpose of its basis (a turn and a scale) times the world's, unit.
  let wx = m[0] * f.windX + m[2] * f.windZ;
  let wy = m[4] * f.windX + m[6] * f.windZ;
  let wz = m[8] * f.windX + m[10] * f.windZ;
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
  const s = Math.min(1, Math.max(0, f.strength));
  const F = t.calm + (1 - t.calm) * smoothstep(0, 0.8, s);
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
  const g = model.gain * fade;
  out[0] = (wx * k + 0.6 * wx * fl) * g;
  out[1] = (wy * k + (0.6 * wy + 0.8) * fl) * g;
  out[2] = (wz * k + 0.6 * wz * fl) * g;
  return out;
}

/**
 * The chunk's declarations and its one function, the shader's half of `swayOffset`: the shared uniforms
 * (`uSwayWind` the heading x, z, the strength and the switch; `uSwayTune` the amplitude, calm, lean and
 * flutter; `uSwayTime` the clock, the flutter's frequency and the trunk rule; `uSwayEye`; `uSwayFade`) and a
 * model's own (`uSwayShape`: H, c, the trunk's radius and the gain; `uSwayAxis`: the axis and the frequency).
 * Every name starts `swg` or `uSway`. It never reads `cameraPosition` or `viewMatrix`.
 *
 * In three parts, joined into one text for every tree (`SWAY_PARS`): the shared uniforms, a model's own two, and
 * the functions. The grass (`grass.ts`) takes the shared ones and the functions as they stand and declares a
 * model's two as plain globals it writes per tuft, so every tuft of every chunk is one call of this very function.
 */
export const SWAY_SHARED_PARS = /* glsl */ `
uniform vec4 uSwayWind;
uniform vec4 uSwayTune;
uniform vec4 uSwayTime;
uniform vec3 uSwayEye;
uniform vec2 uSwayFade;
`;
export const SWAY_MODEL_PARS = /* glsl */ `uniform vec4 uSwayShape;
uniform vec4 uSwayAxis;
`;
export const SWAY_FUNCTIONS = /* glsl */ `float swgSwayHash( const in vec2 swgP ) {
	vec3 swgQ = fract( vec3( swgP.xyx ) * 0.1031 );
	swgQ = fract( swgQ + dot( swgQ, swgQ.yzx + 33.33 ) );
	return fract( ( swgQ.x + swgQ.y ) * swgQ.z * 8.0 );
}
float swgSwayStep( const in float swgE0, const in float swgE1, const in float swgX ) {
	float swgT = clamp( ( swgX - swgE0 ) / ( swgE1 - swgE0 ), 0.0, 1.0 );
	return swgT * swgT * ( 3.0 - 2.0 * swgT );
}
vec3 swgSwayOffset( const in vec3 swgP, const in mat4 swgModel ) {
	if ( uSwayWind.w < 0.5 || uSwayShape.w <= 0.0 ) return vec3( 0.0 );
	float swgH = max( uSwayShape.x, 1e-3 );
	vec3 swgPlace = swgModel[ 3 ].xyz;
	float swgFade = 1.0 - swgSwayStep( uSwayFade.x, uSwayFade.y, length( swgPlace - uSwayEye ) );
	if ( swgFade <= 0.0 ) return vec3( 0.0 );
	vec3 swgWind = transpose( mat3( swgModel ) ) * vec3( uSwayWind.x, 0.0, uSwayWind.y );
	float swgWindLen = length( swgWind );
	swgWind = swgWindLen > 1e-6 ? swgWind / swgWindLen : vec3( 0.0 );
	float swgS = clamp( uSwayWind.z, 0.0, 1.0 );
	float swgF = uSwayTune.y + ( 1.0 - uSwayTune.y ) * swgSwayStep( 0.0, 0.8, swgS );
	float swgFf = uSwayTune.y + ( 1.0 - uSwayTune.y ) * swgS;
	float swgC = uSwayTime.z > 0.5 ? 0.0 : clamp( uSwayShape.y, 0.0, ${CANOPY_MAX.toFixed(2)} );
	float swgHf = max( swgP.y, 0.0 ) / swgH;
	float swgBendT = swgHf > swgC ? ( swgHf - swgC ) / ( 1.0 - swgC ) : 0.0;
	float swgBend = swgBendT * swgBendT;
	float swgPhi = 6.28318530718 * swgSwayHash( swgPlace.xz );
	float swgOsc = sin( uSwayAxis.z * uSwayTime.x + swgPhi ) + 0.3 * sin( 2.0 * uSwayAxis.z * uSwayTime.x + 1.7 * swgPhi );
	float swgA = uSwayTune.x * sqrt( swgH );
	float swgK = swgA * swgF * ( uSwayTune.z * swgF + swgOsc ) * swgBend;
	float swgOff = swgSwayStep( uSwayShape.z, 2.0 * uSwayShape.z + 0.3, length( swgP.xz - uSwayAxis.xy ) );
	float swgFl = uSwayTune.w * swgFf * sin( uSwayTime.y * uSwayTime.x + swgPhi + ${FLUTTER_PHASE_PER_METRE.toFixed(1)} * ( swgP.x + swgP.y + swgP.z ) ) * min( swgHf, 1.0 ) * swgOff;
	vec3 swgD = swgWind * swgK + ( 0.6 * swgWind + vec3( 0.0, 0.8, 0.0 ) ) * swgFl;
	return swgD * ( uSwayShape.w * swgFade );
}
`;
/** The whole chunk as every tree's program carries it. */
export const SWAY_PARS = SWAY_SHARED_PARS + SWAY_MODEL_PARS + SWAY_FUNCTIONS;

/** Right after `#include <begin_vertex>`, in the colour program and the depth program alike. */
export const SWAY_APPLY = /* glsl */ `
{
	mat4 swgSwayModel = modelMatrix;
	#ifdef USE_INSTANCING
		swgSwayModel = modelMatrix * instanceMatrix;
	#endif
	transformed += swgSwayOffset( transformed, swgSwayModel );
}
`;
