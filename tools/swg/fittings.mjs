// The other children of a building: everything the server stood in and around the game's own
// buildings that no world snapshot places.
//
// The `travel` command reads one `childObjects` block per starport and shuttleport and keeps the
// three things travel is made of. That block is on a hundred and sixty-eight building templates and
// carries a thousand and two children, and the rest of them are the fittings: the elevator panel
// beside a lift's doorway, the bank terminal outside a bank, the cloning and insurance terminals in
// a cloning facility, the hanging sign over a cantina's door, a guild hall's voting box. All of it
// was the server's, which is why no snapshot has it and why the rooms it belongs in look bare.
//
// Measured over the converted worlds: 714 children join a building this game really places, 710 of
// them resolve to an appearance the archives hold (two templates have no client side at all and are
// counted rather than guessed at), and **not one of the 710 stands within two and a half metres of
// a snapshot object drawn with the same model**, so nothing here doubles what is already there. The
// snapshots' own 1,465 terminals and signs are a different set in different places.
//
// A model's id is the **appearance's own base name**, not the template's, so templates that share
// an appearance share one model and one conversion: the four municipal hanging signs and the player
// house address sign are one sign, the three Jedi enclave terminals are one terminal. Twenty-four
// models cover all 710 things.
//
// **Nothing here may ever reach the repository.** The checkout is a third-party project under its
// own licence: this reads its data, never its code.
//
// Dependency-free but for node's own modules and this folder's readers; shared with
// tools/swg/tests/fittings.test.ts.

import { kindOfChild, readBuildingChildren } from './travel.mjs';

/** The pack this command writes. */
export const FITTINGS_PACK_VERSION = 1;

/**
 * Every building template that carries fittings, and what each carries.
 *
 * A child is a fitting when it is not one of the three things travel is made of -- those are the
 * `travel` command's and writing them twice would stand two terminals in one place. What is kept is
 * the child's own template, because which model draws it cannot be known without the archives and
 * this module never opens one.
 */
export function readFittingBuildings(scriptsDir) {
  return readBuildingChildren(scriptsDir, (t) => (kindOfChild(t) ? null : { template: String(t ?? '') }));
}

/**
 * The model id a fitting is drawn with: its appearance's own base name.
 *
 * Keying on the appearance rather than on the template is what makes two templates that look
 * identical one model in the pack, and it is also the name the snapshot's own objects already carry
 * for the same appearance, so a fitting and a snapshot prop of the same thing are one entry.
 */
export function modelIdOf(appearance) {
  const a = String(appearance ?? '').replace(/\\/g, '/');
  if (!a) return null;
  const base = a.split('/').pop() ?? '';
  const id = base.replace(/\.[^.]+$/, '');
  return id || null;
}

/**
 * Which model each fitting template is drawn with, and where that model's appearance lives.
 *
 * `appearanceOf(sharedTemplate)` is injected so this module opens no archive: the caller hands in
 * the converter's own template reader. A template the client has no `shared_` side for, or whose
 * shared side names no appearance, comes back with nothing and is counted rather than dropped in
 * silence.
 */
export function fittingModels(templates, appearanceOf) {
  const models = new Map();
  const missing = [];
  for (const t of templates) {
    const shared = String(t).replace(/\/([^/]+)$/, '/shared_$1');
    let appearance = null;
    try {
      appearance = appearanceOf(shared);
    } catch {
      appearance = null;
    }
    const id = modelIdOf(appearance);
    if (!id) {
      missing.push(t);
      continue;
    }
    models.set(t, { id, appearance: String(appearance).replace(/\\/g, '/').replace(/^\//, '') });
  }
  return { models, missing };
}

/** What the conversion prints and `status` reads. */
export function fittingCounts(rows) {
  return {
    things: rows.length,
    models: new Set(rows.map((r) => r.model)).size,
    buildings: new Set(rows.map((r) => r.building)).size,
    indoors: rows.filter((r) => r.cell > 0).length,
  };
}
