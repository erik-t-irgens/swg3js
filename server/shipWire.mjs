// The ship a player flies, as the relay passes it on in their hello: a garage id and its fit (a
// component name per chassis slot, paint values, a droid id). Dependency-free, shared by the relay and
// the tests. Everything is checked and kept small: a name is lower-case letters, digits and underscores,
// a paint value a whole number 0..255, and at most 24 slots and 8 paint values; anything else is dropped.

const SLOT_KEY = /^[a-z0-9_]+$/;
const NAME = /^[a-z0-9_]*$/;
const PAINT_KEY = /^[A-Za-z0-9_/]+$/;
const SHIP_ID = /^[A-Za-z0-9_.\- ]+$/;

/**
 * A cleaned copy of a hello's `ship`, or undefined when it is not one: `{ id, fit: { components, paint, droid? } }`.
 * id: a string of at most 48 characters; components: at most 24, keys up to 24 characters, values up to 64;
 * paint: at most 8, keys up to 40 characters, values whole numbers 0..255; droid: up to 32 characters.
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
  const out = { id: x.id, fit: { components, paint } };
  if (typeof fit.droid === 'string' && fit.droid && fit.droid.length <= 32 && NAME.test(fit.droid)) out.fit.droid = fit.droid;
  return out;
}
