// Which air a body in the sky has (the GPU port's pass 2, wave 4a; the design's 2.6, "which record wins"): a body that is a
// ground world uses that world's own record (the game's, `src/sky/air/airParams.ts`, at its own dials, so its ground sky and
// its rim change together), a body with no ground (a gas giant, Tralus) its look's own record (the viewer's starts,
// `src/sky/look/airProfile.js`'s `airStartFor`), and a moon none. Until the owner's looks name each place's bodies (Save to
// game, the viewer's `bodies.json`), SWG's own sky pictures are told apart by the world they show. Pure: no three, no page.
import { AIR_FIELD_COUNT, applyHazeDials, airDialsOf, setVisibility, worldRecord } from '../air/airParams.ts';
import { airStartFor, makeTables, recordKey, recordLength, recordOf, type AirProfileTables } from '../look/airProfile.js';

/** What a sky picture shows: a ground world (its id), a body of air but no ground, a moon, or no body at all (a sun, a ship). */
export type BodyAir = { kind: 'world'; world: string } | { kind: 'giant' } | { kind: 'temperate' } | { kind: 'airless' } | { kind: 'none' };

/**
 * A sky picture's body, by the world its file names (SWG's `cels_<world>` pictures; anything else a moon): Naboo, Corellia and
 * the rest are ground worlds of the game; Endor's is the gas giant it circles; Tralus has no ground of ours, so a temperate
 * world's air; a sun picture or a ship is no body (it keeps its flat picture and draws as ever).
 */
export function bodyOfPicture(file: string | null | undefined): BodyAir {
  const f = String(file ?? '').toLowerCase();
  const name = f.slice(f.lastIndexOf('/') + 1).replace(/\.[a-z0-9]+$/, '');
  if (!name || /^sun|_sun|star|destroyer|ship/.test(name)) return { kind: 'none' };
  const m = /^cels_(?:cpoint_)?([a-z0-9]+)$/.exec(name);
  if (m) {
    const w = m[1];
    if (w === 'endor') return { kind: 'giant' };
    if (w === 'tralus' || w === 'drall' || w === 'selonia') return { kind: 'temperate' };
    if (WORLDS_WITH_AIR.has(w)) return { kind: 'world', world: w };
  }
  return { kind: 'airless' };
}

/** The ground worlds a sky picture may show, by their game ids. */
const WORLDS_WITH_AIR = new Set(['naboo', 'corellia', 'tatooine', 'dantooine', 'lok', 'talus', 'rori', 'dathomir', 'kashyyyk', 'yavin4', 'mustafar']);

/** Whether a body has any air to draw. */
export function hasAir(b: BodyAir): boolean {
  return b.kind === 'world' || b.kind === 'giant' || b.kind === 'temperate';
}

/**
 * A body's air record (`AIR_FIELD_COUNT` numbers, the game's layout and the viewer's alike), or null for none: a ground world's
 * own at its dials (its clear-day visibility and haze colour: the world's base record, unfitted, since the fit reads the sky of
 * the world one stands on), a giant's or a temperate world's from the viewer's starts.
 */
export function bodyRecord(b: BodyAir): Float64Array | null {
  if (b.kind === 'world') {
    const r = worldRecord(b.world);
    setVisibility(r, airDialsOf(b.world).visibilityKm);
    applyHazeDials(b.world, r);
    return r;
  }
  if (b.kind === 'giant') return recordOf(airStartFor('gasgiant'));
  if (b.kind === 'temperate') return recordOf(airStartFor('temperate'));
  return null;
}

/**
 * The record a body's tables are made from, by its numbers (the bake cache's key: the same numbers make the same tables). Pass 2,
 * wave 6: a record with no smoke or ash is keyed by its 28 numbers as before the layer came (`recordLength`), so every table the
 * browser kept is found again; one with the layer by all `AIR_FIELD_COUNT`.
 */
export function bodyTablesKey(rec: ArrayLike<number>): string {
  return `air-${recordLength(rec)}:${recordKey(rec)}`;
}
/** The record's whole count (the game's layout and the viewer's), for the tests. */
export const BODY_RECORD_FIELDS = AIR_FIELD_COUNT;

/** A body's three tables (the transmittance, the multiple scattering, the sky's light on its ground), the viewer's own. */
export function makeBodyTables(rec: ArrayLike<number>): AirProfileTables {
  return makeTables(rec);
}
