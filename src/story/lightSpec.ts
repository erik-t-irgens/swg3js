// A light of the owner's own, as a row of the lights file and a light hung on a placed row both carry it (Map-maker II's wave of
// the rooms' lights): its type, colour, brightness, reach, falloff, a spot's cone, whether it asks for a shadow, and how it
// flickers. Read here once for both, so a lamp prop's own light and a lamp of the lights file can never read two ways.
//
//   { "type": "spot", "color": [1, 0.8, 0.6], "brightness": 1, "reach": 12, "cone": [25, 35], "shadow": true,
//     "flicker": { "shape": "candle", "rate": 6, "depth": 0.3 } }
//
// **The units are the room pool's own** (`src/world/roomLights.ts`): a point's or a spot's brightness is its value at 3 m in
// the game's rule (a game lamp's `at3`, about 0.2 for a dim lamp to 2 for a bright one), so the pool lights it at nine times
// that times the rooms' scale exactly as it lights one of the game's lamps, and the global dials reach both alike; a
// directional's brightness is a share of the rooms' own parallel light (1 is the game's). The reach is three's cut-off
// distance in metres, the falloff three's decay (absent: 2, the game's lamps'), a spot's cone its inner and outer half-angles
// in degrees (absent: 25 and 35). A colour is linear, each channel 0 to `LIGHT_LIMITS.color`.
//
// **A shadow is asked for, never promised**: `shadow: true` takes a shadow slot of the pool only where the session built
// any (the Graphics page's "Room light shadows", nought to begin with), else the light is lit without one and the editor says
// why; a directional's is kept and never drawn (three's cascades would read a room's casting directional as one of the sun's).
// A flicker is worked out from the shared clock and the light's own key (`src/world/lightFlicker.ts`), so every browser
// flickers alike with nothing sent.
//
// Pure, with no imports at all (src/story's rule: the server may import it as it stands). Rule for this file (node runs it with
// type stripping): no enum, no namespace, no constructor parameter properties.

/** The kinds of light: omnidirectional (what the game's rooms use), a lamp's cone, and the room's one directional light. */
export type LightType = 'point' | 'spot' | 'directional';
export const LIGHT_TYPES: readonly LightType[] = ['point', 'spot', 'directional'];

/** How a light flickers: not at all, a candle's wander, a slow pulse, a strobe, a failing tube's drop-outs. */
export type FlickerShape = 'none' | 'candle' | 'pulse' | 'strobe' | 'broken';
export const FLICKER_SHAPES: readonly FlickerShape[] = ['none', 'candle', 'pulse', 'strobe', 'broken'];

/** A flicker: its shape, how many times a second it moves, and how deep it dips (0 none, 1 to dark). */
export interface LightFlicker {
  shape: FlickerShape;
  rate: number;
  depth: number;
}

/** One light, as a row and an attachment carry it. */
export interface LightSpec {
  type: LightType;
  color: [number, number, number];
  brightness: number;
  /** Metres; absent on a directional, which has none. */
  reach?: number;
  falloff?: number;
  cone?: [number, number];
  shadow?: true;
  flicker?: LightFlicker;
}

/** The reader's backstops (ours): every build holds a light to them alike, so none is live. */
export const LIGHT_LIMITS = {
  /** A colour channel's most: linear, a little past white so a hot lamp can bloom. */
  color: 8,
  /** A point's or a spot's value at 3 m at most (the game's own top out under twenty), and a directional's share. */
  brightness: 100,
  /** A reach's least and most, metres: under a quarter of a metre lights nothing anybody sees. */
  reachLeast: 0.25,
  reach: 200,
  /** Three's decay: 0 (no falloff) to 4. */
  falloffMost: 4,
  /** A spot's half-angles, degrees: three takes up to a right angle less a hair. */
  coneLeast: 1,
  coneMost: 89,
  /** A flicker's rate, a second, and its depth. */
  rateLeast: 0.05,
  rateMost: 30,
};

/** A spot's cone where its light names none: 25 degrees full, 35 to the edge. */
export const DEFAULT_CONE: readonly [number, number] = [25, 35];

/** A point's or a spot's reach where its light names none (a directional's turned back into one), metres: a room's width. */
export const DEFAULT_REACH = 10;

/** The fields a light carries, in the order a file writes them. */
export const LIGHT_SPEC_FIELDS = ['type', 'color', 'brightness', 'reach', 'falloff', 'cone', 'shadow', 'flicker'] as const;

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** A colour of three channels within the backstop, or why not. */
export function readLightColour(v: unknown, what: string): [number, number, number] | string {
  if (!Array.isArray(v) || v.length !== 3) return `its ${what} is three numbers (red, green, blue, linear)`;
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const c = num(v[i]);
    if (c === undefined || c < 0 || c > LIGHT_LIMITS.color) return `its ${what}'s channels are 0 to ${LIGHT_LIMITS.color}`;
    out[i] = c;
  }
  return out;
}

/**
 * The light fields of an object (a lights file's row, an attachment's `light`) read and cleaned, or why it is refused. A
 * field of no shape is a refusal, never a guess: a light that lights wrong in silence is the one fault nobody finds.
 */
export function readLightSpec(o: Record<string, unknown>): LightSpec | string {
  if (!(LIGHT_TYPES as readonly unknown[]).includes(o.type)) return `its type is ${LIGHT_TYPES.join(', ')}`;
  const type = o.type as LightType;
  const color = readLightColour(o.color, 'colour');
  if (typeof color === 'string') return color;
  const b = num(o.brightness);
  if (b === undefined || b < 0 || b > LIGHT_LIMITS.brightness) return `its brightness is 0 to ${LIGHT_LIMITS.brightness}`;
  const out: LightSpec = { type, color, brightness: b };
  if (type === 'directional') {
    if (o.reach !== undefined) return 'a directional light has no reach';
    if (o.falloff !== undefined) return 'a directional light has no falloff';
    if (o.cone !== undefined) return 'a directional light has no cone';
  } else {
    const r = num(o.reach);
    if (r === undefined || r < LIGHT_LIMITS.reachLeast || r > LIGHT_LIMITS.reach) return `its reach is ${LIGHT_LIMITS.reachLeast} to ${LIGHT_LIMITS.reach} m`;
    out.reach = r;
    if (o.falloff !== undefined) {
      const f = num(o.falloff);
      if (f === undefined || f < 0 || f > LIGHT_LIMITS.falloffMost) return `its falloff is 0 to ${LIGHT_LIMITS.falloffMost}`;
      // Two is the game's lamps' own, written absent so one light has one spelling.
      if (f !== 2) out.falloff = f;
    }
  }
  if (o.cone !== undefined) {
    if (type !== 'spot') return 'only a spot has a cone';
    const c = o.cone;
    if (!Array.isArray(c) || c.length !== 2) return 'its cone is two angles in degrees, inner and outer';
    const a = num(c[0]);
    const z = num(c[1]);
    if (a === undefined || z === undefined || a < 0 || z < LIGHT_LIMITS.coneLeast || z > LIGHT_LIMITS.coneMost || a > z) return `its cone is an inner angle no wider than its outer, the outer ${LIGHT_LIMITS.coneLeast} to ${LIGHT_LIMITS.coneMost} degrees`;
    if (a !== DEFAULT_CONE[0] || z !== DEFAULT_CONE[1]) out.cone = [a, z];
  }
  if (o.shadow !== undefined) {
    if (o.shadow !== true && o.shadow !== false) return 'its shadow is true or false';
    if (o.shadow) out.shadow = true;
  }
  if (o.flicker !== undefined) {
    const f = o.flicker as Record<string, unknown> | null;
    if (!f || typeof f !== 'object' || Array.isArray(f)) return 'its flicker is { shape, rate, depth }';
    for (const k of Object.keys(f)) if (k !== 'shape' && k !== 'rate' && k !== 'depth') return `its flicker has no ${k}`;
    if (!(FLICKER_SHAPES as readonly unknown[]).includes(f.shape)) return `its flicker's shape is ${FLICKER_SHAPES.join(', ')}`;
    const rate = num(f.rate);
    const depth = num(f.depth);
    if (rate === undefined || rate < LIGHT_LIMITS.rateLeast || rate > LIGHT_LIMITS.rateMost) return `its flicker's rate is ${LIGHT_LIMITS.rateLeast} to ${LIGHT_LIMITS.rateMost} a second`;
    if (depth === undefined || depth < 0 || depth > 1) return "its flicker's depth is 0 to 1";
    // No flicker at all is written absent.
    if (f.shape !== 'none' && depth > 0) out.flicker = { shape: f.shape as FlickerShape, rate, depth };
  }
  return out;
}

/** A light's fields as an object of its own, in the file's order, absent fields left out (what a row or an attachment writes). */
export function lightSpecFields(s: LightSpec): Record<string, unknown> {
  const out: Record<string, unknown> = { type: s.type, color: [...s.color], brightness: s.brightness };
  if (s.reach !== undefined) out.reach = s.reach;
  if (s.falloff !== undefined) out.falloff = s.falloff;
  if (s.cone) out.cone = [...s.cone];
  if (s.shadow) out.shadow = true;
  if (s.flicker) out.flicker = { ...s.flicker };
  return out;
}

/** Two lights that light the same. */
export function sameLightSpec(a: LightSpec, b: LightSpec): boolean {
  return JSON.stringify(lightSpecFields(a)) === JSON.stringify(lightSpecFields(b));
}

/** A spot's cone in force: its own, or the default. */
export function coneOf(s: { cone?: readonly [number, number] }): readonly [number, number] {
  return s.cone ?? DEFAULT_CONE;
}
