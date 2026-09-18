// A person from the catalogue as a finished look: a parts character (a player species for a dressed
// NPC, or the NPC's own parts model) with the entry's shape sliders and colours, and its outfit on,
// each piece in its own colours, the textures drawn before anything is cloned. A look is fixed by
// its entry, so one prototype serves every spawn of it: the clones share its geometry, its rendered
// textures and its materials, and so its compiled programs.
//
// No rig is fetched: a species rig is two hundred megabytes of clips, and an NPC plays its animation
// pack, which the mobile's animator binds to the clone by joint name.
import * as THREE from 'three';
import { Character } from '../../player/character';
import type { MobileCatalogue } from './catalogue';
import type { MobileEntry } from './types';

export interface BuiltLook {
  /** The prototype: the character's group, its skeleton and every mesh worn, dressed and coloured. */
  scene: THREE.Group;
  /** Outfit pieces that would not go on, by item id: reported once, and the spawner says the outfit is short. */
  missing: string[];
  /** Where the body came from, for the console. */
  source: string;
}

/** The key a look is cached under in the asset cache (never a file path, so it cannot collide with a model's). */
export function lookKey(entry: MobileEntry): string {
  return `look:${entry.id}`;
}

/** Whether an entry stands on a look (a parts body) rather than a plain model. */
export function isLook(entry: MobileEntry, cat: MobileCatalogue): boolean {
  if (entry.kind === 'dressed') return true;
  return cat.appearanceOf(entry)?.form === 'parts';
}

/** The folder, under assets-private/, whose parts.json is the body: a dressed entry's species, or the NPC's own parts model. */
export function lookFolder(entry: MobileEntry, cat: MobileCatalogue): string | null {
  if (entry.kind === 'dressed') return entry.species ? `characters/${entry.species}/` : null;
  const app = cat.appearanceOf(entry);
  if (!app || app.form !== 'parts') return null;
  return app.file.replace(/[^/]*$/, '');
}

/**
 * Build an entry's look: the body (and, for its own parts model, what the model wears by default),
 * the shape sliders, the shared colours (`custom`), then each outfit item from the wardrobe folder
 * the catalogue names, with its own colours as that item's private values; then wait until every
 * colour recipe has been drawn. Throws when the body will not load; a piece that will not go on is
 * left off and named in `missing`.
 */
export async function buildLook(baseUrl: string, entry: MobileEntry, cat: MobileCatalogue): Promise<BuiltLook> {
  const folder = lookFolder(entry, cat);
  if (!folder) throw new Error(`${entry.id} has no parts body to build`);
  const dressed = entry.kind === 'dressed';
  // A dressed body starts bare (its outfit is the catalogue's, not the species pack's default
  // clothes); an NPC's own parts model wears what it was converted wearing.
  const character = await Character.load(baseUrl, dressed ? (entry.species ?? 'human_male') : (entry.appearance ?? entry.id), dressed ? [] : undefined, { dir: folder, skipRig: true });
  for (const [name, v] of Object.entries(entry.morphs ?? {})) character.setMorph(name, v);
  const missing: string[] = [];
  const itemValues: Record<string, number> = {};
  for (const o of entry.outfit ?? []) {
    const dir = `${baseUrl}assets-private/${o.wardrobe.replace(/\/?$/, '/')}`;
    let on = false;
    try {
      on = await character.wearItemFrom(dir, o.item, o.part);
    } catch (err) {
      console.warn(`mobiles: ${entry.id}: ${o.item} would not go on`, err);
    }
    if (!on) {
      missing.push(o.item);
      continue;
    }
    // Each piece's own colours are private to its meshes, which the recipes name as the part.
    for (const [name, v] of Object.entries(o.values ?? {})) itemValues[`${o.part}|${name}`] = v;
  }
  const cz = character.customizer;
  if (cz) {
    // After every piece is on, so each recipe that reads a value is active. The template's colours
    // are named without their path (`index_color_skin`): set as shared, they also reach every
    // private copy of the same name on every mesh (the head's skin follows the body's), whether or
    // not a shared one exists. A name nothing reads is kept and does nothing.
    const custom = entry.custom ?? {};
    if (Object.keys(custom).length) cz.setAll(custom);
    if (Object.keys(itemValues).length) cz.setAll(itemValues);
    await cz.settled();
  }
  const scene = character.group;
  scene.name = `look:${entry.id}`;
  scene.updateMatrixWorld(true);
  return { scene, missing, source: `${folder}parts.json${missing.length ? `, ${missing.length} piece${missing.length === 1 ? '' : 's'} short` : ''}` };
}
