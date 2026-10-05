// Which recipe meshes a worn piece is drawn with, and which of a character's meshes are a garment's: the
// names a thing's colours are written under (`tintValues`) and the ones a saved look leaves out once a
// garment's colours are its thing's. Kept out of `Character` so the node tests run them as the game does
// (the character's own module cannot be loaded in node: its constructor carries a parameter property).
import { recipeMeshOf } from './customizer.ts';

/**
 * The recipe meshes a part is drawn with, by the name it is worn under: its loaded meshes, less the
 * loader's `_<n>` (a mesh with several materials loads as one mesh a material, `body_m_l0_1`, while the
 * recipes and every key they read name the converter's mesh); else the species pack's own part of that
 * name; else the catalogue item's parts. The last two work before the part is loaded, which is when the
 * select screen works out a record's colours. Each once, in the order met.
 */
export function pieceMeshes(loaded: readonly { name: string }[] | null | undefined, packPart: string | null | undefined, catalogueParts: readonly { name: string }[] | null | undefined): string[] {
  if (loaded) return [...new Set(loaded.map((m) => recipeMeshOf(m.name)))];
  if (packPart) return [packPart];
  return catalogueParts ? [...new Set(catalogueParts.map((p) => p.name))] : [];
}

/**
 * Every garment mesh a character could hold a colour under: `known` (every garment the wardrobe and the
 * species pack hold, `garmentMeshesOf`) and every loaded part that is neither the body nor a hairstyle,
 * on or off, under both the loaded name and the recipe's. A new set, `known` untouched.
 */
export function garmentMeshesOn(parts: Iterable<{ body: boolean; hair: boolean; meshes: readonly { name: string }[] }>, known: ReadonlySet<string>): Set<string> {
  const out = new Set<string>(known);
  for (const p of parts) {
    if (p.body || p.hair) continue;
    for (const m of p.meshes) {
      out.add(m.name);
      out.add(recipeMeshOf(m.name));
    }
  }
  return out;
}
