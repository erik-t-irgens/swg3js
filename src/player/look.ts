// A character's look: the shape sliders, the height, the customization values (skin, hair and
// the like) and the outfit worn, put onto a parts character. The player's own comes from the
// saved character; another player's comes across the relay in their hello.
import type * as THREE from 'three';
import type { Appearance } from '../core/characters';
import type { Character } from './character';

export interface Look extends Appearance {
  /** The worn pieces by the names the character wears them under (catalogue ids, or the pack's part names). */
  outfit: string[];
}

/**
 * The shape, height and customization values, applied at once; nothing is changed that is already so.
 *
 * A key scoped to a mesh (`shirt_s03_m_l0|index_color_1`, or the remembered `hair|index_color_1`) is kept
 * even when nothing on the character reads it yet. A garment's or a hairstyle's recipes join the customizer
 * only with the wardrobe, and a fresh rig is coloured before it is dressed, so asking first whether a
 * recipe reads the key dropped every garment and hair colour a peer wore the first time they were seen.
 * Held in the customizer, the value is rendered by `reapply` the moment the piece that reads it arrives.
 *
 * A value the customizer already holds is not set again. Every colour or slider another player moves
 * sends their whole look a moment later, and setting it all again would render every texture they wear
 * once more for the one that changed.
 */
export function applyAppearance(c: Character, a: Appearance | null | undefined): void {
  if (!a) return;
  for (const [name, v] of Object.entries(a.morphs ?? {})) c.setMorph(name, v);
  if (a.height !== undefined) c.setHeight(a.height);
  const held = c.customizer?.values;
  const changed = Object.fromEntries(Object.entries(a.values ?? {}).filter(([k, v]) => (c.canCustomize(k) || k.includes('|')) && held?.get(k) !== v && (c.manifest.values?.[k] ?? c.manifest.values?.[k.replace(/^.*\//, '')]) !== v));
  if (Object.keys(changed).length) c.customizer?.setAll(changed);
}

/**
 * Put a rig that another character of the same species has just worn back to what this record asks.
 *
 * `applyAppearance` sets only what differs from what is held, which is right on a fresh rig and wrong on
 * one somebody else has just worn: the last character's colours would stay wherever this one keeps the
 * default, be played as this one's, and be saved into this record. So every value the customizer holds
 * that this record does not set goes back to the pack's own value, else its recipe's default, and a
 * private copy of a shared colour (the head's own skin) goes where that shared colour goes, so the head
 * and the body can never come out two colours. A value nothing reads, or one with nowhere to go back to
 * (a garment's colour of a piece this rig never loaded, the remembered hair colour), is forgotten at once;
 * one at its own default is forgotten too, and one put back to it is forgotten once that has rendered.
 * What is left holds only what this record set, so nothing of the last character is saved into it.
 */
export function putBackLook(c: Character, a: Appearance | null | undefined): void {
  const cz = c.customizer;
  if (!cz) return;
  const want = a?.values ?? {};
  const bare = (k: string) => k.replace(/^.*\|/, '').replace(/^.*\//, '');
  const vars = cz.variables();
  const defaults = new Map(vars.map((v) => [v.key, v.default]));
  const shared = new Map<string, { key: string; default: number }>();
  for (const v of vars) if (!v.private && !shared.has(bare(v.name))) shared.set(bare(v.name), v);
  const packValue = (k: string): number | undefined => c.manifest.values?.[k] ?? c.manifest.values?.[k.replace(/^.*\//, '')];
  /** A key's own resting value: its recipe's default, or for a shared key held under another spelling, that variable's. */
  const restOf = (k: string): number | undefined => defaults.get(k) ?? (k.includes('|') ? undefined : shared.get(bare(k))?.default);
  /** Where a key goes: what the record asks, else (a private copy of a shared colour) where that colour goes, else the pack's value or its rest. */
  const targetOf = (k: string): number | undefined => {
    if (k in want) return want[k];
    if (k.includes('|') && cz.isLinked(k)) {
      const s = shared.get(bare(k));
      if (s) return want[s.key] ?? want[bare(s.key)] ?? packValue(s.key) ?? s.default;
    }
    return packValue(k) ?? restOf(k);
  };
  const back: Record<string, number> = {};
  // The private copies after the shared colours: a shared one sets its copies, and a copy this record
  // names apart is then left as the record says.
  const copies: Record<string, number> = {};
  const settle: string[] = [];
  for (const [k, v] of [...cz.values]) {
    const asked = k in want;
    const target = targetOf(k);
    if (!asked && (target === undefined || !cz.affects(k))) {
      cz.values.delete(k);
      continue;
    }
    if (target === undefined) continue;
    if (target === v) {
      if (!asked && v === restOf(k)) cz.values.delete(k);
      continue;
    }
    (k.includes('|') ? copies : back)[k] = target;
    if (!asked && target === restOf(k)) settle.push(k);
  }
  const all = { ...back, ...copies };
  if (Object.keys(all).length) cz.setAll(all);
  if (settle.length) {
    void cz.settled().then(() => {
      for (const k of settle) if (cz.values.get(k) === restOf(k)) cz.values.delete(k);
    });
  }
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
  // The wardrobe's recipes join the customizer first, so the colours are set where they will be read
  // (a character whose own pack has no recipes gets its customizer from the wardrobe here, too).
  await c.catalogue(baseUrl).catch(() => null);
  applyAppearance(c, look);
  await dress(c, look.outfit ?? [], baseUrl);
}

/**
 * Dress a character in an outfit without a first-draw compile: every piece not yet loaded is loaded
 * hidden (Character.loadPiece), the colour recipes settle, each new mesh is prepared, and only then, in
 * one synchronous step, what is not in the outfit comes off and the outfit goes on (Character.putOn).
 * `alive()` is asked after every await; false stops without changing what is worn (the peer left, their
 * rig changed, a newer look arrived).
 */
export async function dressPrepared(c: Character, outfit: string[], baseUrl: string, prepare: (root: THREE.Object3D) => Promise<void>, alive: () => boolean, warn: (what: string) => void = () => {}): Promise<void> {
  const wornBefore = new Set(c.status().filter((p) => p.worn).map((p) => p.name));
  const on: string[] = [];
  const fresh: THREE.Object3D[] = [];
  for (const key of outfit) {
    const got = await c.loadPiece(key, baseUrl).catch(() => ({ found: false, meshes: [] as THREE.Object3D[] }));
    if (!alive()) return;
    if (!got.found) {
      warn(key);
      continue;
    }
    if (on.includes(key)) continue;
    on.push(key);
    // What is on show already has its programs; what goes on now is compiled first.
    if (!wornBefore.has(key)) fresh.push(...got.meshes);
  }
  await c.customizer?.settled();
  if (!alive()) return;
  for (const m of fresh) {
    await prepare(m);
    if (!alive()) return;
  }
  const off = c.status().filter((p) => p.worn && !p.body && !on.includes(p.name)).map((p) => p.name);
  c.putOn(on, off);
}

/** The shape, height and colours at once, then the outfit as `dressPrepared` puts it on. */
export async function applyLookPrepared(c: Character, look: Look | null | undefined, baseUrl: string, prepare: (root: THREE.Object3D) => Promise<void>, alive: () => boolean, warn?: (what: string) => void): Promise<void> {
  if (!look) return;
  // The wardrobe's recipes first, as `applyLook` does.
  await c.catalogue(baseUrl).catch(() => null);
  if (!alive()) return;
  applyAppearance(c, look);
  await dressPrepared(c, look.outfit ?? [], baseUrl, prepare, alive, warn);
}

/**
 * Which of a saved look's values go out on the wire: every shared one, and a mesh's own only while that
 * mesh is worn. A record keeps the colour of every shirt and hairstyle ever coloured, and the wire carries
 * the first 120 numbers (`WIRE.lookNumbers`), so sending the lot would one day push the ones on show off
 * the end. `worn` is `Character.wornMeshes()`.
 */
export function lookKeep(worn: ReadonlySet<string>): (key: string) => boolean {
  return (key) => {
    const bar = key.indexOf('|');
    return bar < 0 || worn.has(key.slice(0, bar));
  };
}

/** A look small enough to send: numbers rounded, the outfit's names kept short, and only the values `keep` keeps. */
export function packLook(a: Appearance, outfit: string[], keep?: (key: string) => boolean): Look {
  const morphs: Record<string, number> = {};
  for (const [k, v] of Object.entries(a.morphs ?? {})) if (Number.isFinite(v)) morphs[k] = Number(v.toFixed(3));
  const values: Record<string, number> = {};
  for (const [k, v] of Object.entries(a.values ?? {})) if (Number.isFinite(v) && (!keep || keep(k))) values[k] = v;
  return { morphs, values, height: Number((a.height ?? 0).toFixed(3)), outfit: outfit.slice(0, 40).map((s) => String(s).slice(0, 80)) };
}
