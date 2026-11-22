// The moons and planets in the sky: their Air form by quality tier, and the dials of their look (the GPU port's pass 2, wave
// 4a; the design's 2.5 and 2.6, the brief's items 5 and 6). Pure: no three, no page, so the node tests read the very rules
// the drawing reads.
//
// **The Air form** (the design's 2.6, the owner's option of 20 November): each body is drawn with its air Scattered (the
// body path, `src/sky/look/airProfile.js`: the march through the body's own shell, its limb's glow and the haze over its
// disc, lit by the star), Painted (the look's own painted layer: SWG's glow picture where it has one) or None. By the quality
// slider's tier (the design's own table):
//   - **Low**: Painted.
//   - **Medium**: Scattered on bodies under a quarter of the screen (`shareMost`), Painted on bigger ones.
//   - **High**: Scattered (12 steps through the shell).
//   - **Ultra**: Scattered, 16 steps.
// A body may name its own form (a look's, the console's), which wins over the tier. **The ground path never reads any of
// this** (the owner's condition): the air's tables, its haze and the far ground take their settings from the tier table
// and the air's own sizes alone (`bodySky.test.ts`, its part 2, holds each tier's ground settings the same with bodies
// Scattered, Painted or None, and no ground file reading this module).

/** The three forms of a body's air. */
export type BodyAirForm = 'scattered' | 'painted' | 'none';
export const BODY_AIR_FORMS: readonly BodyAirForm[] = ['scattered', 'painted', 'none'];

/** One tier's rule: its form, the march's steps when Scattered, and the largest share of the screen Scattered is kept to. */
export interface BodyTierRule {
  readonly form: BodyAirForm;
  readonly steps: number;
  readonly shareMost: number;
}

/**
 * The tiers' rules, Low to Ultra (`qualityTiers.ts`' `TIER_NAMES`' order), the design's table: Medium marches 8 steps (the
 * viewer's Low quality, within 15% of the direct sum on the limb), High 12 (the viewer's Medium, its default), Ultra 16 (the
 * viewer's High). A custom set of settings takes High's (the tier a new player starts on).
 */
export const BODY_TIERS: readonly BodyTierRule[] = [
  { form: 'painted', steps: 8, shareMost: Infinity },
  { form: 'scattered', steps: 8, shareMost: 0.25 },
  { form: 'scattered', steps: 12, shareMost: Infinity },
  { form: 'scattered', steps: 16, shareMost: Infinity },
];

/** The tier index `tierIndexOf` answers (0 Low to 3 Ultra, −1 a custom set) made a rule. */
export function tierRule(tierIndex: number): BodyTierRule {
  return BODY_TIERS[tierIndex >= 0 && tierIndex < BODY_TIERS.length ? tierIndex : 2];
}

/**
 * A body's air form this frame: its own (`override`, a look's or the console's) where it names one, else its tier's, Medium's
 * Scattered held to bodies under `shareMost` of the screen. A body with no air (a moon) has nothing to scatter: `none`.
 * A body drawn as SWG's `flat` picture (`BODY_TUNE.sphere` 0) takes Painted where its tier would scatter: the picture carries
 * its own painted shading, which the march's light from the real star does not follow, so the rim stood past the painted dark
 * limb and the two met in a seam (the review of pass 2, wave 4a, Naboo from Rori). An override still forces Scattered.
 */
export function bodyFormOf(tierIndex: number, share: number, override: BodyAirForm | null, hasAir: boolean, flat = false): BodyAirForm {
  if (!hasAir) return 'none';
  if (override) return override;
  const r = tierRule(tierIndex);
  if (r.form !== 'scattered' || flat) return r.form === 'none' ? 'none' : 'painted';
  return share < r.shareMost ? 'scattered' : 'painted';
}

/**
 * The share of the screen a disc of angular radius `rho` (radians) covers, seen through a camera of vertical field `fovY`
 * (radians) and `aspect`, in the picture plane: its area over the screen's (`π tan²ρ / (4 tan²(fov/2) · aspect)`), so a
 * disc filling the screen's height is about π/4 over the aspect. More than 1 when it overfills the screen.
 */
export function screenShareOf(rho: number, fovY: number, aspect: number): number {
  const t = Math.tan(rho < 1.5 ? rho : 1.5);
  const h = Math.tan(fovY * 0.5);
  return (Math.PI * t * t) / (4 * h * h * (aspect > 0 ? aspect : 1));
}

/**
 * The bodies' look dials (feel is the owner's; each start's reason beside it). Moved through `tuneBodies` (the console's
 * `__debug.skyBodies({ tune })` and the debug menu's `bodies` sliders), read by the drawing a frame.
 */
export const BODY_TUNE = {
  /**
   * How a body in SWG's look is shaded: 0 its flat picture with the shading SWG painted into it (the design's 2.5: "a place
   * still in SWG's look keeps today's flat picture" until wave 5 applies its system), 1 a sphere lit by the star from where
   * the star really is, the picture's colours its surface (the stand-in for a look; `discFill` its disc). 0 to start: the
   * design's rule.
   */
  sphere: 0,
  /**
   * A flat picture's reflectance: its colour (linear) times its painted alpha times this. 0.4 to start: SWG's moon pictures'
   * discs average about 0.3 in linear light times their alpha (the moon picture 0.45 at an alpha of 0.69), so a full SWG moon
   * reflects about 0.12 of the sun, as our moon does (its albedo 0.12), and by day it is as pale against the blue as ours.
   */
  flatAlbedo: 0.4,
  /**
   * A sphere's reflectance: the picture's colour (linear) times this. 0.3 to start: SWG's body pictures' colours average 0.2
   * to 0.45 in linear light, so a moon reflects about 0.12 of the sun, our moon's albedo.
   */
  sphereAlbedo: 0.3,
  /**
   * The share of a card's half width its sphere's disc reaches: 0.92 to start, since SWG's moon and planet pictures paint their
   * discs out to 0.44 to 0.46 of the picture's width from its middle (read off the converted pictures), so a lit sphere stands
   * where the painted disc stood.
   */
  discFill: 0.92,
  /** The limb's and the twilight's brightness over the physical air (the viewer's dials; 1 the physical air). */
  limb: 1,
  twilight: 1,
  /** The night side's fill (the viewer's `nightFill`): nought, as dark as space, the physical moon's (only the sky lights it). */
  nightFill: 0,
  /**
   * The most a white pixel of a body's picture may show on the screen, in the screen's white (its light through the air times
   * the eye's exposure), the whole disc scaled by one factor. 1 to start: SWG's moons are some twenty times our moon's width, so
   * at their physical surface light under a night's eye opened 16 stops a full one stood at about 5,000 times white and the
   * bloom spread it over the whole frame (seen at Mos Eisley's night); held at four times white it was a white disc with a wide
   * halo and its painted features lost; at one its brightest painted parts reach white and its features read, as a full moon's
   * do to the eye at night. By day the hold is far off (a white pixel of a moon is about a fifth of white against the blue), so
   * it binds at night and at dusk alone.
   */
  seenMost: 1,
  /**
   * SWG's own fading of its sky pictures by the hour (its ramp's alpha), kept (1) or left to the light alone (0). 0 to start:
   * the owner's ask that a moon by day be pale like ours: under the air a body shows by day as faintly as its light against
   * the blue makes it, and SWG's fade had hidden the extra bodies by day outright. Storms still fade them (one less the
   * overcast), and the moon still rides the light by night (SWG's rule for where, until wave 5).
   */
  swgFade: 0,
  /** The prover's switch (1: no card drawn, SWG's glow pictures as the sky leaves them): an A/B of the bodies' cost on one screen. */
  off: 0,
  /** The form every body takes whatever its tier (`'tier'`: the tier's): the console's and the prover's switch. */
  form: 'tier' as BodyAirForm | 'tier',
};

/** The ranges `tuneBodies` holds each number to. */
export const BODY_TUNE_RANGE = {
  sphere: [0, 1],
  flatAlbedo: [0, 2],
  sphereAlbedo: [0, 2],
  discFill: [0.5, 0.98],
  limb: [0, 4],
  twilight: [0, 4],
  nightFill: [0, 1],
  seenMost: [0.5, 1e6],
  swgFade: [0, 1],
  off: [0, 1],
} as const;

/** A count the dials move by. */
export const BODY_TUNE_STATE = { version: 0 };

/** Set the bodies' look from the console's argument: each number held to its range, the form to the forms; words for anything held or refused. */
export function tuneBodies(o: Record<string, unknown>): string[] {
  const said: string[] = [];
  if (!o || typeof o !== 'object') return ['bodies take { sphere, flatAlbedo, sphereAlbedo, discFill, limb, twilight, nightFill, seenMost, swgFade, form }'];
  const t = BODY_TUNE as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    if (k === 'form') {
      if (v === 'tier' || (BODY_AIR_FORMS as readonly unknown[]).includes(v)) BODY_TUNE.form = v as BodyAirForm | 'tier';
      else said.push(`form: one of tier, ${BODY_AIR_FORMS.join(', ')}`);
      continue;
    }
    const r = (BODY_TUNE_RANGE as Record<string, readonly [number, number]>)[k];
    if (!r) {
      said.push(`${k}: no such dial`);
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      said.push(`${k}: not a number`);
      continue;
    }
    const held = v < r[0] ? r[0] : v > r[1] ? r[1] : v;
    if (held !== v) said.push(`${k}: held to ${held}`);
    t[k] = held;
  }
  BODY_TUNE_STATE.version++;
  return said;
}
