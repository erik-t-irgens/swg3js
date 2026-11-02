// A loaded body dressed in a catalogue entry's look: `buildLook`'s own dressing (src/world/mobiles/look.ts), moved out unchanged
// so the world editor's dresser (Map-maker II's thirteenth wave) dresses its figure by the very lines the world stands a look
// by, and so a node test runs them over a stand-in body and the real customizer (look.ts imports the character, which node
// cannot load).
//
// Rule for this file (node runs it with type stripping): every import with its `.ts` extension, type imports only here, no
// enum, no namespace, no constructor parameter properties.

import type { Character } from '../../player/character.ts';
import type { MobileEntry } from './types.ts';

/** What dressing a body asks of it: its shape sliders, a piece put on out of a named wardrobe folder, and its colour recipes. */
export type DressBody = Pick<Character, 'setMorph' | 'wearItemFrom' | 'customizer'>;

/**
 * A loaded body dressed in an entry's look: the shape sliders, then each outfit piece from the wardrobe folder it names with
 * its own colours as that piece's private values, then the shared colours and the pieces' own over them, every colour recipe
 * drawn before it answers. The pieces that would not go on, by item id. `buildLook`'s own steps, and the world editor's
 * dresser's (Map-maker II's thirteenth wave), so the figure it dresses is the very look the world stands.
 */
export async function dressLook(character: DressBody, entry: Pick<MobileEntry, 'id' | 'morphs' | 'outfit' | 'custom'>, baseUrl: string): Promise<string[]> {
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
  return missing;
}
