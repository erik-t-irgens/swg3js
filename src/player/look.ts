// A character's look: the shape sliders, the height, the customization values (skin, hair and
// the like) and the outfit worn, put onto a parts character. The player's own comes from the
// saved character; another player's comes across the relay in their hello.
import type { Appearance } from '../core/characters';
import type { Character } from './character';

export interface Look extends Appearance {
  /** The worn pieces by the names the character wears them under (catalogue ids, or the pack's part names). */
  outfit: string[];
}

/** The shape, height and customization values, applied at once; nothing is changed that is already so. */
export function applyAppearance(c: Character, a: Appearance | null | undefined): void {
  if (!a) return;
  for (const [name, v] of Object.entries(a.morphs ?? {})) c.setMorph(name, v);
  if (a.height !== undefined) c.setHeight(a.height);
  const changed = Object.fromEntries(Object.entries(a.values ?? {}).filter(([k, v]) => c.canCustomize(k) && (c.manifest.values?.[k] ?? c.manifest.values?.[k.replace(/^.*\//, '')]) !== v));
  if (Object.keys(changed).length) c.customizer?.setAll(changed);
}

/** Dress the character in an outfit: everything else comes off, each piece goes on by the name it was worn under. */
export async function dress(c: Character, outfit: string[], baseUrl: string, warn: (what: string) => void = () => {}): Promise<void> {
  for (const p of c.status()) if (p.worn && !p.body) c.remove(p.name);
  for (const key of outfit) {
    const on = (await c.wear(key)) || (await c.wearItem(key, baseUrl).catch(() => false));
    if (!on) warn(key);
  }
}

export async function applyLook(c: Character, look: Look | null | undefined, baseUrl: string): Promise<void> {
  if (!look) return;
  applyAppearance(c, look);
  await dress(c, look.outfit ?? [], baseUrl);
}

/** A look small enough to send: numbers rounded, the outfit's names kept short. */
export function packLook(a: Appearance, outfit: string[]): Look {
  const morphs: Record<string, number> = {};
  for (const [k, v] of Object.entries(a.morphs ?? {})) if (Number.isFinite(v)) morphs[k] = Number(v.toFixed(3));
  const values: Record<string, number> = {};
  for (const [k, v] of Object.entries(a.values ?? {})) if (Number.isFinite(v)) values[k] = v;
  return { morphs, values, height: Number((a.height ?? 0).toFixed(3)), outfit: outfit.slice(0, 40).map((s) => String(s).slice(0, 80)) };
}
