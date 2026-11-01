// A permanent row's looks (Map-maker II's seventh wave, Map-maker I's §2.7 `mats`): the copies of a model's materials a row
// wears when it is tinted, borrows another model's picture (`map`) or another model's material whole (`like`).
//
// **One copy per source material and look**, shared by every row wearing it, counted by the rows (and anything else) that
// hold it, made when the first is stood and, on the last one's going, kept as a spare for the world (worn again with no
// program built by a tier that comes back), the oldest past `SPARE_COPIES` and every one at the world's going forgotten by
// the world (`forget`: the portal renderer's set, the cascades' map, the scan's set) and then disposed. Disposed at once on
// the last one's going instead, a copy whose source no row draws took its program with it, and every tier coming back into
// reach built it again in play. **A texture is never disposed**: a copy's own
// picture is its source's or its donor's, which their own models hold. A tint and a borrowed picture keep their source's
// program (three keys a program on whether a map is there and on its channel, never on which texture), so a copy is put on
// its source's key once the world adopts it (its `userData`, which `clone` copies, carries every wrap the world applies); a
// borrowed material may change the key, which is why the world editor puts one on behind its curtain.
//
// **What is refused, in words** (never thrown; the row then wears its own material and the reason is noted): a picture
// borrowed onto a material with no picture, or from a donor whose picture is on another coordinate set (another program);
// a donor that is skinned (a person's or a creature's material is shared by many bodies and carries the person superset); a
// leaf card's material onto a geometry with no card plane; and a donor reading a second coordinate set (a picture, a normal
// map or a detail map on set 1) onto a geometry that has none, since an unset attribute reads as nought.
//
// Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no enum, no namespace, no
// constructor parameter properties.

import * as THREE from 'three';
import type { RowLook } from '../story/placements.ts';

/**
 * Every number of the looks, ours: live through `__debug.editor({ tune: { look: { ... } } })` and a slider under `editor`.
 * `tintStrength` is how much of a tint a copy takes: 1 multiplies the colour by the tint as written (the file's own word),
 * 0 leaves the model's colour. Feel, the owner's: a tint read in the dye picker's colours can look heavier on a dark
 * texture than on the swatch, and this is the one knob that says how heavy.
 */
export const LOOK_TUNE = {
  tintStrength: 1,
};

/** A donor's material as a look finds it: the material, the geometry it is drawn on, and whether that is skinned. */
export interface DonorPiece {
  material: THREE.Material;
  geometry: THREE.BufferGeometry;
  skinned: boolean;
}

/** How a look finds a donor's material by its name (`<pack>:<model>/<material>`): null where it is not loaded, or has none. */
export type DonorOf = (ref: string) => DonorPiece | null;

/** What the looks need of the world: its forgetting of a material, and what a copy must join that its source joined. */
export interface RowMaterialsDeps {
  /** A material leaving the world's sets (`World.forgetMaterials`), before it is disposed. */
  forget(materials: THREE.Material[]): void;
  /** A copy just made of `source` (the world registers a copy of a reflective material with its source's own strength). */
  onCopy?(copy: THREE.Material, source: THREE.Material): void;
}

/** One copy made: its key, its source, the look it wears, how many hold it. */
interface Copy {
  key: string;
  source: THREE.Material;
  material: THREE.Material;
  look: RowLook;
  count: number;
}

/**
 * The look of a list that applies to a material, by its name in the model: the entry naming it, else the `*` entry, else
 * null. A list names each material once (`readLooks`), so there is never more than one of either.
 */
export function lookFor(mats: readonly RowLook[], name: string): RowLook | null {
  let all: RowLook | null = null;
  for (const m of mats) {
    if (m.of === name) return m;
    if (m.of === '*') all = m;
  }
  return all;
}

/** The colour a tint multiplies by at a strength: white eased toward the tint (`#rrggbb`, sRGB, taken into the working space). */
export function tintColour(tint: string, strength: number, out = new THREE.Color()): THREE.Color {
  const t = new THREE.Color(tint);
  return out.setRGB(1, 1, 1).lerp(t, Math.min(1, Math.max(0, strength)));
}

/** Whether a geometry carries a second coordinate set (GLTFLoader's `uv1`). */
function hasUv1(g: THREE.BufferGeometry): boolean {
  return !!g.getAttribute('uv1');
}

/** Whether a material reads its picture, normal map or detail map on the second coordinate set. */
function readsSet1(m: THREE.Material): boolean {
  const s = m as THREE.MeshStandardMaterial;
  if ((s.map?.channel ?? 0) === 1 || (s.normalMap?.channel ?? 0) === 1 || (s.emissiveMap?.channel ?? 0) === 1) return true;
  return !!m.userData.swgDetail;
}

/**
 * Why a look cannot be put on a material drawn on `geometry`, in words, or null. A tint is never refused; a borrowed picture
 * needs a picture on the material and on the donor, on the same coordinate set, from a donor that is not skinned; a
 * borrowed material needs a donor that is not skinned, is no leaf card onto a geometry with no card plane, and reads no
 * second coordinate set onto a geometry that has none.
 */
export function lookRefusal(target: THREE.Material, look: RowLook, donor: DonorPiece | null, geometry: THREE.BufferGeometry): string | null {
  const ref = look.map ?? look.like;
  if (!ref) return null;
  if (!donor) return `its donor ${ref} is not loaded or has no such material`;
  if (donor.skinned) return `${ref} is a skinned body's material, shared by many bodies: borrow from a placed model`;
  if (look.map) {
    const own = (target as THREE.MeshStandardMaterial).map;
    const theirs = (donor.material as THREE.MeshStandardMaterial).map;
    if (!own) return `${target.name || 'this material'} has no picture to take another's in its place`;
    if (!theirs) return `${ref} has no picture to lend`;
    if ((own.channel ?? 0) !== (theirs.channel ?? 0)) return `${ref}'s picture is on another coordinate set`;
    return null;
  }
  // A card is known by the class the card rule gives it, or by the converter's own word before the rule has run.
  const card = donor.material.userData.swgCardBlend !== undefined || donor.material.userData.swgCard !== undefined;
  if (card && !geometry.getAttribute('cardPlane')) return `${ref} is a leaf card's material, and this geometry has no card plane`;
  if (readsSet1(donor.material) && !hasUv1(geometry)) return `${ref} reads a second coordinate set this geometry does not carry`;
  return null;
}

/** The key a copy is shared by: its source and the one look that applies to it (its `of` aside, so two lists alike there share it). */
function copyKey(source: THREE.Material, look: RowLook): string {
  return `${source.uuid}|${look.tint ?? ''}|${look.map ?? ''}|${look.like ?? ''}`;
}

/**
 * How many copies no row wears are kept for the world (`RowMaterials`' spares), each still in the world's sets with its
 * programs: a tier that comes back into reach wears its rows' copies again with no program built, as a plain row's model
 * materials, which its pack keeps, never need one. Past this many the oldest is forgotten and disposed, so an editing
 * session's tints, each a copy of its own, do not pile up in the sets the portal renderer walks. Not feel: a bound.
 */
export const SPARE_COPIES = 64;

/**
 * The copies of the looks standing now, and who holds each. One a session, cleared at every world's going. A copy no one
 * holds any more is kept as a spare for the world (`SPARE_COPIES`, oldest first out), so a tier unloaded and loaded again,
 * or a row taken down and stood again by a landed write, wears the very copy it wore and builds no program; every copy,
 * spares and all, is forgotten then disposed when the world goes (`clear`).
 */
export class RowMaterials {
  private readonly deps: RowMaterialsDeps;
  private readonly copies = new Map<string, Copy>();
  private readonly owned = new Map<object, Set<Copy>>();
  /** The copies no one holds, oldest first (each still in `copies`, at a count of nought). */
  private readonly spare: Copy[] = [];
  /** How many spares are kept (`SPARE_COPIES`; a test moves it). */
  spareMost = SPARE_COPIES;
  /** Each copy's source, by the copy: what the look picker reads a borrowed piece's own material by. */
  private readonly sources = new WeakMap<THREE.Material, THREE.Material>();
  /** What was refused, newest last, at most 32: the console's words. */
  readonly notes: string[] = [];
  /** How many copies were made and let go, for the console. */
  made = 0;
  disposed = 0;

  constructor(deps: RowMaterialsDeps) {
    this.deps = deps;
  }

  /** How many copies are held now (worn by a row, or held by the editor's ghost). */
  get count(): number {
    return this.copies.size - this.spare.length;
  }

  /** How many copies no one holds are kept for the world. */
  get spares(): number {
    return this.spare.length;
  }

  private note(words: string): void {
    if (this.notes.includes(words)) return;
    this.notes.push(words);
    if (this.notes.length > 32) this.notes.shift();
  }

  /**
   * The material a piece wears for a look: `source` itself where nothing of the list applies to it or the look is refused
   * (noted), else the look's copy, made the first time and held for `owner` (counted once an owner, however many pieces of
   * it wear the copy). At a stand or a tier's build, never in a frame.
   */
  wear(owner: object, source: THREE.Material, mats: readonly RowLook[], geometry: THREE.BufferGeometry, donorOf: DonorOf): THREE.Material {
    const look = lookFor(mats, source.name);
    if (!look) return source;
    const ref = look.map ?? look.like;
    const donor = ref ? donorOf(ref) : null;
    const why = lookRefusal(source, look, donor, geometry);
    if (why) {
      this.note(`${source.name || 'a material'}: ${why}`);
      return source;
    }
    const key = copyKey(source, look);
    let c = this.copies.get(key);
    if (!c) {
      c = { key, source, material: this.make(source, look, donor), look, count: 0 };
      this.copies.set(key, c);
      this.sources.set(c.material, source);
      this.made++;
      this.deps.onCopy?.(c.material, source);
    }
    let held = this.owned.get(owner);
    if (!held) {
      held = new Set();
      this.owned.set(owner, held);
    }
    if (!held.has(c)) {
      held.add(c);
      // A spare worn again: off the spares' list, the very material (and so the very programs) it had.
      if (c.count <= 0) this.unspare(c);
      c.count++;
    }
    return c.material;
  }

  /** A copy taken off the spares' list (worn again). */
  private unspare(c: Copy): void {
    const i = this.spare.indexOf(c);
    if (i >= 0) this.spare.splice(i, 1);
  }

  /**
   * A copy of `source` wearing `look`: its own clone with the tint multiplied into its colour and the donor's picture put
   * on, or the donor's material cloned whole (stripped of what is keyed to its own model: its sway, its crown, its
   * standing in a building's rooms, which is the source's) under the source's own name.
   */
  private make(source: THREE.Material, look: RowLook, donor: DonorPiece | null): THREE.Material {
    if (look.like && donor) {
      const c = donor.material.clone();
      delete c.userData.swgSway;
      delete c.userData.swgSwayForm;
      delete c.userData.swgLeaf;
      if (source.userData.interior) c.userData.interior = true;
      else delete c.userData.interior;
      c.name = source.name;
      c.userData.swgLookOf = donor.material.name;
      return c;
    }
    const c = source.clone();
    const s = c as THREE.MeshStandardMaterial;
    if (look.map && donor) s.map = (donor.material as THREE.MeshStandardMaterial).map;
    if (look.tint && s.color) s.color.copy((source as THREE.MeshStandardMaterial).color).multiply(tintColour(look.tint, LOOK_TUNE.tintStrength));
    return c;
  }

  /**
   * Every copy `from` holds held for `to` as well (the world editor's ghost leaving copies behind until the row it put down is
   * built: each holder let go of on its own).
   */
  share(from: object, to: object): void {
    const held = this.owned.get(from);
    if (!held || from === to) return;
    let mine = this.owned.get(to);
    if (!mine) {
      mine = new Set();
      this.owned.set(to, mine);
    }
    for (const c of held) {
      if (mine.has(c)) continue;
      mine.add(c);
      if (c.count <= 0) this.unspare(c);
      c.count++;
    }
  }

  /**
   * Every copy an owner held let go of. A copy no one holds any more is kept as a spare for the world (worn again by a tier
   * coming back with no program built); past `SPARE_COPIES` spares the oldest is forgotten by the world, then disposed.
   */
  release(owner: object): void {
    const held = this.owned.get(owner);
    if (!held) return;
    this.owned.delete(owner);
    for (const c of held) {
      c.count--;
      if (c.count <= 0) this.spare.push(c);
    }
    const over = this.spare.length - Math.max(0, this.spareMost);
    if (over > 0) this.drop(this.spare.splice(0, over));
  }

  /** Copies let go: out of the world's sets first, then disposed (a material's dispose frees its programs, never a texture). */
  private drop(gone: Copy[]): void {
    if (!gone.length) return;
    this.deps.forget(gone.map((c) => c.material));
    for (const c of gone) {
      this.copies.delete(c.key);
      c.material.dispose();
      this.disposed++;
    }
  }

  /** Every copy let go, spares and all: the world going. Forgotten, then disposed; never a texture. */
  clear(): void {
    const all = [...this.copies.values()];
    this.owned.clear();
    this.spare.length = 0;
    this.drop(all);
  }

  /** The tint strength moved (`LOOK_TUNE.tintStrength`): every tinted copy's colour worked out again. A uniform, nothing compiles. */
  retint(): number {
    let n = 0;
    const t = new THREE.Color();
    for (const c of this.copies.values()) {
      if (!c.look.tint || c.look.like) continue;
      const s = c.material as THREE.MeshStandardMaterial;
      if (!s.color) continue;
      s.color.copy((c.source as THREE.MeshStandardMaterial).color).multiply(tintColour(c.look.tint, LOOK_TUNE.tintStrength, t));
      n++;
    }
    return n;
  }

  /** A copy's source, or the material itself where it is no copy: what the look picker names a borrowed piece by. */
  sourceOf(m: THREE.Material): THREE.Material {
    return this.sources.get(m) ?? m;
  }

  /** Whether a material is one of the looks' copies. */
  isCopy(m: THREE.Material): boolean {
    return this.sources.has(m);
  }

  /** For the console: how many copies are held, how many kept spare, owners, made and disposed, and the refusals. */
  report(): { copies: number; spares: number; owners: number; made: number; disposed: number; notes: string[] } {
    return { copies: this.count, spares: this.spare.length, owners: this.owned.size, made: this.made, disposed: this.disposed, notes: [...this.notes] };
  }
}
