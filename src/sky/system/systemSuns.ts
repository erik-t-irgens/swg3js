// The sun from the applied system (the GPU port's sky round, maker L; the brief `A:\swg3js\port\SKY-BODIES.md`, item H: "size
// of sun and color of sun based on the system you're in"). Behind a loading screen, before the motion, the air's record, the
// disc and the flare read a sun, the star system the bodies file applies to the world one stands on says its suns
// (`stars.ts`' `SYSTEM_SUNS`, read by `casterOf` and `secondOf` for that world alone):
//   - **colour**: the star's colour in the viewer read as the black body nearest it (`kelvinOfColour`), the temperature the
//     air sends; a star with none keeps the table's;
//   - **brightness**: the star's own (the caster's 1 for every draft, Tatoo II's 0.8), the strength the air scales it by;
//   - **size**: the table's real disc for the world's caster times the star's size in the system over the size of the
//     world's own SWG sun card (`<world>:sun`), the square the system's sizes are read in, so a star sized as SWG's card is the
//     table's real disc and Tatoo II at "about 0.70 of Tatoo I" is 0.70 of it; with no SWG sun card, the caster's own size is the
//     reference. The disc grows and shrinks with the star's true distance in the game's frame (`SkyShade.sunScale`, C's rule).
// A world the file does not apply (and every world on WebGL, in space, under SWG's sky) keeps the table exactly
// (`clearSystemSuns`). Pure: no three, no page.
import { compileSystem } from './system.js';
import { appliedSystemOf, type SystemsRecord } from './worldDays.ts';
import { skyPlacesOf, type SkyPlaceSource } from './skyMotion.ts';
import { SYSTEM_SUNS, kelvinOfColour, starsOf, type SunSpec } from '../stars.ts';

/** What the last screen set, for the console and the before-and-after sheet: the table's suns and the system's. */
export const SYSTEM_SUNS_SAID: { planet: string; system: string | null; table: readonly SunSpec[]; caster: SunSpec | null; second: SunSpec | null; note: string } = { planet: '', system: null, table: [], caster: null, second: null, note: 'not set' };

/** No system's word: every world's suns the table's (each screen begins here). */
export function clearSystemSuns(): void {
  SYSTEM_SUNS.planet = '';
  SYSTEM_SUNS.caster = null;
  SYSTEM_SUNS.second = null;
  SYSTEM_SUNS_SAID.planet = '';
  SYSTEM_SUNS_SAID.system = null;
  SYSTEM_SUNS_SAID.table = [];
  SYSTEM_SUNS_SAID.caster = null;
  SYSTEM_SUNS_SAID.second = null;
  SYSTEM_SUNS_SAID.note = 'no applied system';
}

type Model = {
  version: number;
  m: number;
  casterJ?: number;
  itemStar: Uint8Array;
  itemSize: Float64Array;
  itemPair?: Int16Array;
  pairA?: Int16Array;
  pairB?: Int16Array;
  items: { name: string; colour?: string | null; brightness?: number }[];
};

/**
 * The suns an applied system gives a world (its pack `world`, the game's `planet`, its converted sky's places `sky`), or null
 * where the file applies none (or a version 1 sky, which names no star of its own). Pure: the tests' and `useSystemSuns`'.
 */
export function systemSunsOf(systems: SystemsRecord | null | undefined, world: string, planet: string, sky: SkyPlaceSource | null): { system: string; caster: SunSpec; second: SunSpec | null; note: string } | null {
  const a = appliedSystemOf(systems, world);
  if (!a || a.rule !== 'system') return null;
  const places = skyPlacesOf(world, sky);
  let model: Model;
  try {
    model = compileSystem(a.sys, (pid: string) => places.get(pid)?.sizeDeg ?? null, (pid: string) => places.get(pid)?.sheet === true, { world, placeExists: (pid: string) => places.has(pid) }) as unknown as Model;
  } catch {
    return null;
  }
  if (model.version !== 2) return null;
  const cj = model.casterJ ?? -1;
  if (cj < 0) return null;
  const table = starsOf(planet).suns;
  const base = table[0];
  const sunCard = places.get(`${world}:sun`);
  const ref = sunCard && sunCard.sizeDeg > 0 ? sunCard.sizeDeg : model.itemSize[cj] > 0 ? model.itemSize[cj] : 1;
  const specOf = (j: number, fallback: SunSpec): SunSpec => {
    const it = model.items[j];
    const k = kelvinOfColour(it.colour ?? null);
    const size = model.itemSize[j] > 0 ? model.itemSize[j] : ref;
    const br = typeof it.brightness === 'number' && Number.isFinite(it.brightness) ? it.brightness : fallback.strength;
    return { name: it.name || fallback.name, kelvin: k ?? fallback.kelvin, radiusDeg: Number(((base.radiusDeg * size) / ref).toFixed(5)), strength: br > 0 ? br : 0 };
  };
  const caster = specOf(cj, base);
  // the pair's second, where the caster is one of a pair
  let second: SunSpec | null = null;
  const pa = model.pairA && model.pairA.length ? model.pairA[0] : -1;
  const pb = model.pairB && model.pairB.length ? model.pairB[0] : -1;
  if (pa >= 0 && pb >= 0 && (cj === pa || cj === pb)) second = specOf(cj === pa ? pb : pa, table[1] ?? base);
  const note = `${sunCard ? `sizes against ${world}:sun's square of ${sunCard.sizeDeg.toFixed(2)} degrees` : "sizes against the caster's own"}`;
  return { system: a.id, caster, second, note };
}

/**
 * Behind a loading screen, before the motion and the air are made (`World.loadSky`): the applied system's suns for the world
 * one stands on, or the table's where none applies. Never in a frame.
 */
export function useSystemSuns(systems: SystemsRecord | null | undefined, world: string, planet: string, sky: SkyPlaceSource | null): void {
  clearSystemSuns();
  const s = systemSunsOf(systems, world, planet, sky);
  SYSTEM_SUNS_SAID.planet = planet;
  SYSTEM_SUNS_SAID.table = starsOf(planet).suns;
  if (!s) {
    SYSTEM_SUNS_SAID.note = 'no applied system of version 2: the table';
    return;
  }
  SYSTEM_SUNS.planet = planet;
  SYSTEM_SUNS.caster = s.caster;
  SYSTEM_SUNS.second = s.second;
  SYSTEM_SUNS_SAID.system = s.system;
  SYSTEM_SUNS_SAID.caster = s.caster;
  SYSTEM_SUNS_SAID.second = s.second;
  SYSTEM_SUNS_SAID.note = s.note;
}
