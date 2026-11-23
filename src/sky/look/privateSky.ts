// His imported looks in the game, in development alone (the GPU port's pass 2, wave 5, maker L; the design's 2.10 seam: imported
// pictures and meshes "only where present, else the generated twin, else SWG's picture", read by the dev server alone). Behind
// each loading screen on the dev server the game asks for his looks of imported pictures and the places that wear them
// (`privateSkyDev.ts`, reached only under `import.meta.env.DEV`, from `tools/dev/skyPrivate.mjs`: his file of choices, his
// private table and his imported folder, read in place), and lays them here (`applyPrivateSky`); a place whose look is one of
// them, every picture and mesh it wears in that folder, wears it, drawn whole as the viewer draws it (`lookBody.ts`); any other
// keeps its generated twin from the Save to game, or SWG's picture.
//
// **Never in a build**: this module holds no address of the dev server's and asks for nothing; the asking module is imported
// under `import.meta.env.DEV` alone, which every build makes false, so a build (a `SWG3JS_NO_PRIVATE=1` one too) carries neither
// it nor its addresses, and here nothing is ever laid (`PRIVATE_SKY.on` false). The game's one hook for every picture and mesh a
// look names (`build.js`' `setPictureSource`) answers a shipped photo's path under `sky/pictures/`, a name his imported folder
// holds where the dev server laid one, and nothing (a 404, the fallbacks) for anything else.
//
// Rule for this file (node runs it with type stripping for the tests): every value import with its `.ts` extension, nothing
// that touches the page at load.

import { BODIES_PICTURES, type BodyLook } from './bodiesFile.ts';
import { makeLook, usePrivateLooks } from './looks.js';

/** What the last screen laid of his imported looks (development alone; `on` false in every build). */
export const PRIVATE_SKY: { on: boolean; from: string; why: string; base: string; looks: Record<string, BodyLook>; uses: Record<string, string>; files: Set<string>; reads: number } = {
  on: false,
  from: '',
  why: 'not asked (development alone)',
  base: '',
  looks: {},
  uses: {},
  files: new Set(),
  reads: 0,
};

/**
 * The game's picture hook (`build.js`' `setPictureSource`): a shipped photo by its path under the site's `sky/` folder, and a name
 * his imported folder holds where the dev server laid one; anything else nothing. `base` the site's base address.
 */
export function gamePictureSource(base: string): (name: string) => string | null {
  return (name: string) => {
    if (!name) return null;
    if (name.startsWith(BODIES_PICTURES.replace(/^sky\//, ''))) return `${base}sky/${name}`;
    if (PRIVATE_SKY.on && PRIVATE_SKY.files.has(name)) return PRIVATE_SKY.base + encodeURIComponent(name);
    return null;
  };
}

/** Every picture and mesh a look wears (the dev server's `namesOfLook`, the same rule). */
export function namesOfLook(look: Record<string, unknown> | null | undefined): string[] {
  const out: string[] = [];
  if (!look || typeof look !== 'object') return out;
  if (typeof look.mesh === 'string' && look.mesh) out.push(look.mesh + '.fbx');
  const layers = (look.layers && typeof look.layers === 'object' ? look.layers : {}) as Record<string, Record<string, unknown>>;
  for (const L of Object.values(layers)) {
    if (!L || typeof L !== 'object' || L.on === false) continue;
    if (typeof L.tex === 'string' && L.tex) out.push(L.tex);
    if (typeof L.mesh === 'string' && L.mesh) out.push(L.mesh + '.fbx');
    const flow = L.flow as Record<string, unknown> | undefined;
    if (flow && flow.on && typeof flow.tex === 'string' && flow.tex) out.push(flow.tex);
  }
  return out;
}

/** The look his file of choices puts at a place, where it is one of his imported looks and all it wears is here; else null. */
export function privateLookOf(place: string): { id: string; look: BodyLook } | null {
  if (!PRIVATE_SKY.on) return null;
  const id = PRIVATE_SKY.uses[place];
  const look = id ? PRIVATE_SKY.looks[id] : null;
  if (!look) return null;
  // the sphere every look stands on is ours where his is not here (build.js's own sphere), so only the rest must be present
  for (const n of namesOfLook(look as unknown as Record<string, unknown>)) if (n !== 'planet_01_mesh.fbx' && !PRIVATE_SKY.files.has(n)) return null;
  return { id: `own:${id}`, look };
}

/**
 * The dev server's answer laid (`privateSkyDev.ts`'s alone): his looks made whole, the places that wear them, the files his
 * folder holds and the address it serves them at, the private table's meshes, halos and rings handed to `looks.js`. An answer
 * that is not one (`{ why }`, or nothing) lays none.
 */
export function applyPrivateSky(raw: Record<string, unknown> | null, base: string): void {
  PRIVATE_SKY.reads++;
  if (!raw || typeof raw.why === 'string' || !raw.looks) {
    PRIVATE_SKY.on = false;
    PRIVATE_SKY.why = raw && typeof raw.why === 'string' ? raw.why : 'no answer';
    return;
  }
  usePrivateLooks({ meshes: raw.meshes, halos: raw.halos, rings: raw.rings, parts: {} }, String(raw.from ?? ''));
  const looks: Record<string, BodyLook> = {};
  for (const [id, l] of Object.entries(raw.looks as Record<string, Record<string, unknown>>)) looks[id] = makeLook(l) as unknown as BodyLook;
  PRIVATE_SKY.looks = looks;
  PRIVATE_SKY.uses = { ...(raw.uses as Record<string, string>) };
  PRIVATE_SKY.files = new Set(Array.isArray(raw.files) ? (raw.files as string[]) : []);
  PRIVATE_SKY.from = String(raw.from ?? '');
  PRIVATE_SKY.base = base;
  PRIVATE_SKY.on = true;
  PRIVATE_SKY.why = '';
}

/** What `__debug.lookBodies()` says of his imported looks. */
export function privateSkyReport(): Record<string, unknown> {
  return {
    on: PRIVATE_SKY.on,
    from: PRIVATE_SKY.from,
    why: PRIVATE_SKY.why,
    looks: Object.keys(PRIVATE_SKY.looks).length,
    places: Object.keys(PRIVATE_SKY.uses).length,
    files: PRIVATE_SKY.files.size,
    reads: PRIVATE_SKY.reads,
  };
}
