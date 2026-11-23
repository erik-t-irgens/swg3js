// What the eye does with the lights we carry and with the sun (the sky and light fix round, maker L): two dials of the
// `exposure` set that are not the eye's curve. The eye's own dials (`src/sky/exposure/eyeDials.ts`) take this file's group
// (`eyeLightsGroup`) into their set, and the eye's count reads `EYE_LIGHTS.top` where it takes its mean up to a percentile, so
// the debug menu's `exposure` sliders and `__debug.exposure({ lights: { carried, top } })` move them alike.
//
//   - **Carried lights**: the pooled flash lights (a lit blade's, the fighters' glows, shots, hits, powers) and the flashlight
//     light what they reach in the scene's own units, so a night's opened eye (+15 to +17 stops) blew his body and the ground
//     white under the saber or the flashlight while the blade itself, an emissive, kept its look through the eye's glow
//     factor. On WebGPU each such light now carries a flag its light node reads (`src/core/gpu/carriedLights.ts`): flagged,
//     its direct light is drawn times `exposure^(-carried)`, so at 1 it lights a surface as it did at an exposure of 1
//     whatever the eye does. The lights a room is lit by (a ship's rooms through the same pool, the rooms' own pool) carry no
//     flag: they light the room the eye adapts to.
//   - **The top percentile**: the eye takes its mean of the scene up to this share of the count, so the brightest share above
//     it (the sun's disc and the sky's glare round it, a lamp's core) is never counted; the disc alone is far under that share,
//     so counting everything moves the eye only slightly.
//
// Pure: no three, no DOM; a node test runs every piece of it.
import type { DialGroup, NumberDial } from '../ui/dials.ts';

/**
 * The dials (feel is the owner's: each starts where the brief says, with its reason here, and nobody tunes it by measuring).
 *   - `carried` 1: the share of the eye's exposure taken back off a carried light (its direct light times
 *     `exposure^(-carried)`): 1 keeps the light a blade or the flashlight casts as it looked before the eye, at an exposure of 1,
 *     however far the eye opens, as the emissive compensation keeps the blade's own glow; 0 lets it take the eye's whole
 *     exposure (at a moonlit night's +15 stops some 40,000 times brighter on the screen, which whitened his body and the
 *     ground: 23 to 31% of the picture clipped in the investigator's shots).
 *   - `top` 0.96: the percentile the eye's mean is taken up to, his demo's (the 40th to the 96th): the brightest 4% of the
 *     weighted view (the sun's disc, the sky's glare round it, a lamp's core, a sunlit wall's brightest stretch) is left out of
 *     the mean. 1 counts that 4% too, which closes the eye only a little: the sun's disc is a few hundred pixels, far under 4%
 *     of the count, so looking at the noon sun the target moved by 0.09 stops between 0.96 and 1 (the fix round's checker,
 *     `__debug.exposure` at Mos Eisley); lower values open the eye more (0.5: +0.56 stops there).
 *   - `blade` 1: a lit blade's light on WebGPU, as a share of what each blade asks of the pool (the hilt's 2.2 out to 6 m, the
 *     thrown one's 2.5, each orbiting one's 2; a fighter's 2 out to 5 m), now one slot a blade written in place each frame. 1 is
 *     the light the code always asked for; the old flashes, asked every frame and fading over 0.08 s, stacked to about 1.9
 *     times it at 60 frames a second, 0.75 at 30 and 3.1 at 144, so 1.9 is the 60-frame look of before.
 */
export const EYE_LIGHTS = { carried: 1, top: 0.96, blade: 1 };

/** The dials' ranges, the sliders' and the console's alike (the top never under the count's 40th percentile). */
export const EYE_LIGHTS_RANGE: { readonly [K in keyof typeof EYE_LIGHTS]: readonly [number, number] } = {
  carried: [0, 1],
  top: [0.5, 1],
  blade: [0, 4],
};

/** A count the dials move by, for a reader that keeps what it worked from them. */
export const EYE_LIGHTS_STATE = { version: 0 };

/**
 * The dials moved as the console writes them (`{ carried: 0.5, top: 0.98 }`): each held to its range; words for anything held
 * or refused.
 */
export function tuneEyeLights(o: unknown): string[] {
  if (!o || typeof o !== 'object') return ['lights: { carried, top, blade }'];
  const said: string[] = [];
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const r = (EYE_LIGHTS_RANGE as Record<string, readonly [number, number]>)[k];
    if (!r) {
      said.push(`lights.${k}: no such dial (carried, top, blade)`);
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      said.push(`lights.${k}: not a number`);
      continue;
    }
    const held = v < r[0] ? r[0] : v > r[1] ? r[1] : v;
    if (held !== v) said.push(`lights.${k}: held to ${held}`);
    (EYE_LIGHTS as Record<string, number>)[k] = held;
  }
  EYE_LIGHTS_STATE.version++;
  return said;
}

/**
 * A carried light's factor at the eye's exposure, as its light node works it on the card: `exposure^(-carried · flag)`, the
 * flag 1 for a carried light and 0 for a light a room is lit by (whose factor is then exactly 1).
 */
export function carriedFactor(exposure: number, flag: number): number {
  const e = exposure > 0 ? exposure : 1;
  return Math.pow(2, -Math.log2(e) * EYE_LIGHTS.carried * flag);
}

function dial(k: keyof typeof EYE_LIGHTS, label: string, step: number, unit: string, note: string): NumberDial {
  const [min, max] = EYE_LIGHTS_RANGE[k];
  return { kind: 'number', key: `lights.${k}`, label, note, min, max, step, unit, get: () => EYE_LIGHTS[k], set: (v) => tuneEyeLights({ [k]: v }) };
}

/** The two dials as one group of the `exposure` set (the eye's own set takes it). */
export function eyeLightsGroup(): DialGroup {
  return {
    title: 'Carried lights and the sun',
    note: "What the eye does with the light a blade, a shot or the flashlight casts on what is round it, and whether it counts the sun. WebGPU's.",
    dials: [
      dial('carried', 'Carried lights', 0.05, '', "The light a lit blade, the fighters' glows, shots, hits and the flashlight cast on bodies and the ground: 1 keeps it as it looked before the eye (at an exposure of 1) however far the eye opens, as the blade's own glow keeps its look; 0 lets it take the eye's whole exposure (a moonlit night's +15 stops whitens whatever it reaches). A ship's room lights are its own and never take it."),
      dial('top', "The eye's top percentile", 0.005, '', "The eye takes its mean of the scene up to this share of it: 0.96 (his demo's) leaves the brightest 4% of the view (the sun's disc, the sky's glare round it, a lamp's core, the brightest of a sunlit wall) out of the mean. 1 counts that too, which closes the eye only slightly (the sun's disc alone is far under 4% of the view and hardly moves it); lower opens the eye more."),
      dial('blade', 'Blade light', 0.05, '×', "A lit blade's light on what is round it, as a share of what the blade asks (the hilt's 2.2 out to 6 m), now the same at any frame rate: 1 is the light asked; the old flashes stacked to about 1.9 times it at 60 frames a second (0.75 at 30, 3.1 at 144), so 1.9 is the 60-frame look of before."),
    ],
  };
}
