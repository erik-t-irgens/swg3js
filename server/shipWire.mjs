// The ship a player flies, as the relay passes it on in their hello: a garage id and its fit (a
// component name per chassis slot, paint values, a droid id). Dependency-free, shared by the relay and
// the tests. Everything is checked and kept small: a name is lower-case letters, digits and underscores,
// a paint value a whole number 0..255, and at most 24 slots and 8 paint values; anything else is dropped.
//
// A colour carried whole (a ship's or a speeder's colour picked from beyond its own palette) goes beside
// the paint and never in it: `paint` keeps the nearest colour of the hull's own palette, which every
// browser and every relay built before reads as it always has, and `colours` the colour itself, which
// only this relay passes on and only a browser built for it lays over `paint`. A browser built before
// therefore sees the nearest colour rather than the palette's first, and a relay built before drops
// `colours` as it drops anything it does not know.

const SLOT_KEY = /^[a-z0-9_]+$/;
const NAME = /^[a-z0-9_]*$/;
const PAINT_KEY = /^[A-Za-z0-9_/]+$/;
const SHIP_ID = /^[A-Za-z0-9_.\- ]+$/;

/**
 * What this server's hail says of paint (`paint`): 2 passes a fit's `colours` on, the colours carried whole
 * beside its paint. A server whose hail says nothing of paint drops them, so the others see the nearest
 * colour of the hull's own palette its `paint` carries (src/vehicles/shipFit.ts `fitForWire`).
 */
export const PAINT_VERSION = 2;

/**
 * The least a colour carried whole may be: `-(0xRRGGBB + 1)` runs from -1 (black) down to this (white). The
 * same number as src/player/texrender.ts's RAW_COLOUR_MIN, written again because this file imports nothing.
 */
export const RAW_COLOUR_MIN = -16777216;

/**
 * Whether a paint value's key is a colour (`index_color_1`, `/private/index_color_2`), which may take a
 * colour carried whole, rather than a choice of pattern (`index_texture_1`), which never may: a negative
 * choice would only ever be read as the first pattern.
 */
export function isColourKey(k) {
  return typeof k === 'string' && /(^|\/)index_color_\d+$/.test(k);
}

/**
 * A cleaned copy of a hello's `ship`, or undefined when it is not one: `{ id, fit: { components, paint, colours?, droid? } }`.
 * id: a string of at most 48 characters; components: at most 24, keys up to 24 characters, values up to 64;
 * paint: at most 8, keys up to 40 characters, values whole numbers 0..255; colours: at most 8, a colour's key
 * only (never a pattern's), values colours carried whole (RAW_COLOUR_MIN..-1), left out when there are none;
 * droid: up to 32 characters.
 */
export function cleanShip(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  if (typeof x.id !== 'string' || !x.id || x.id.length > 48 || !SHIP_ID.test(x.id)) return undefined;
  const fit = x.fit && typeof x.fit === 'object' && !Array.isArray(x.fit) ? x.fit : {};
  const components = {};
  let n = 0;
  const comps = fit.components && typeof fit.components === 'object' && !Array.isArray(fit.components) ? fit.components : {};
  for (const [k, v] of Object.entries(comps)) {
    if (n >= 24) break;
    if (k.length > 24 || !SLOT_KEY.test(k)) continue;
    if (typeof v !== 'string' || v.length > 64 || !NAME.test(v)) continue;
    components[k] = v;
    n++;
  }
  const paint = {};
  n = 0;
  const values = fit.paint && typeof fit.paint === 'object' && !Array.isArray(fit.paint) ? fit.paint : {};
  for (const [k, v] of Object.entries(values)) {
    if (n >= 8) break;
    if (k.length > 40 || !PAINT_KEY.test(k)) continue;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 255) continue;
    paint[k] = v;
    n++;
  }
  const colours = {};
  n = 0;
  const whole = fit.colours && typeof fit.colours === 'object' && !Array.isArray(fit.colours) ? fit.colours : {};
  for (const [k, v] of Object.entries(whole)) {
    if (n >= 8) break;
    if (k.length > 40 || !PAINT_KEY.test(k) || !isColourKey(k)) continue;
    if (typeof v !== 'number' || !Number.isInteger(v) || v > -1 || v < RAW_COLOUR_MIN) continue;
    colours[k] = v;
    n++;
  }
  const out = { id: x.id, fit: { components, paint } };
  if (n) out.fit.colours = colours;
  if (typeof fit.droid === 'string' && fit.droid && fit.droid.length <= 32 && NAME.test(fit.droid)) out.fit.droid = fit.droid;
  return out;
}
