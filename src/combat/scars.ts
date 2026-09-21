// What a bolt leaves where it stops: which family of gun fired it, and the one seam through which
// the marks system is asked for the mark. Nothing here draws and nothing here imports three or
// rapier, so the rules a scar is named and laid by are the very rules a plain node test drives
// rather than a copy of them written out again (`bladeGlowMath.ts`, `gradeMath.ts` and
// `saberHit.ts` are the same arrangement). Every function a step can reach allocates nothing, down
// to the case-folded search the family rule is made of; the readout at the foot, which nothing but a
// console reaches, is the one that builds objects, and says so.
//
// **What is here and what is not.** The mark itself -- how wide each family is drawn, how long it
// lasts, how long its rim stays hot, the ring it is kept in and the sheet it wears -- is the marks
// system's (`src/world/marks.ts`, `MARKS`), and none of those numbers has a second home here. What
// is here is the bolt's half: which of the five families the gun that fired names, and whether a
// bolt leaves a mark at all.
//
// **Why a seam and not an import.** The marks system belongs to the app, which builds it, adds it
// to the scene and takes it down with the world; the combat code has no way to reach it and no
// business knowing what builds a mark. So the app registers it here, exactly as
// `setPeerRooms`/`peerRooms` in `docking.ts` is the seam between the docking code and whatever
// builds a room. With nothing registered a bolt still stops, still bursts and still sounds, and
// simply leaves nothing behind, which is the game as it was before scars existed.

import type { MarkPlace, ScarFamily, Vec3Like } from '../world/marks.ts';

export type { ScarFamily };

/** The five, in the order the readout prints them. */
export const SCAR_FAMILIES: readonly ScarFamily[] = ['bolt', 'rocket', 'slug', 'flame', 'lightning'];

/**
 * Whatever lays marks: the marks system in the game (`Marks` answers this exactly as it stands), a
 * counter in a test.
 */
export interface ScarSink {
  scar(family: ScarFamily, at: Vec3Like, normal: Vec3Like, opts?: MarkPlace | null): boolean;
}

export interface ScarTune {
  /**
   * 0 lays no scars at all, which is the game exactly as it was before bolts marked anything. The
   * one number the bolt side of this has: everything about how a mark looks is `MARKS`.
   */
  on: number;
}

/** Live through `__debug.scars({ on: 0 })`. */
export const SCARS: ScarTune = { on: 1 };

let sink: ScarSink | null = null;

/**
 * Register what lays marks (the wiring in `main.ts`), or null to stop laying them. Nothing calls it
 * with null today and nothing needs to: the marks system lives for the session and a world being
 * left clears its ring rather than taking it down. It takes null so that a sink can be dropped by
 * whatever one day does take it down, and so a test can put the seam back as it found it.
 */
export function setScars(s: ScarSink | null): void {
  sink = s;
}

/** What is laying marks just now, for the readout and for a test to check the wiring. */
export function scarSink(): ScarSink | null {
  return sink;
}

/**
 * Which family a gun's bolt marks with. Two questions, in this order, and the order is the whole of
 * the rule: the gun's **own type** first, because that is the classification the game already makes
 * of every gun on the rack (`gunTypeFor` in `guns.ts`, which reads the client's own weapon table
 * before it reads anything else), and its **weapon effect family** second, for a shot fired by
 * something that has no gun profile at all -- a turret, a creature's spit, a picture of somebody
 * else's shot off the wire.
 *
 * The order matters because the two disagree where it counts: the lightning rifle's effect family
 * is `rocket` (rocket 3 in the client's table is the lightning beam), and what it should leave on a
 * wall is a fork and not a crater.
 *
 * The mapping from one name to one family is `scarFamilyFor` below. This is the precedence and
 * nothing else.
 */
export function scarFamilyOf(gunType?: string | null, fxId?: string | null): ScarFamily {
  const byType = scarFamilyFor(gunType);
  if (byType !== 'bolt') return byType;
  return scarFamilyFor(fxId);
}

/**
 * One name, one family, and the **one home** of that rule: the client's own
 * `datatables/weapon/weapon.iff` families are `bolt`, `rocket` and the `projectile_*` set, and the
 * two the game's own rack makes plain. It lives on the gun side rather than in the marks system
 * because it is the gun side that knows both a gun's own type and its weapon effect family; the
 * marks are asked for a family and draw it, and hold no copy of this. That also keeps it where a
 * plain node test can reach it, since importing the marks would drag three and the audio bank in.
 */
export function scarFamilyFor(name?: string | null): ScarFamily {
  const s = name ?? '';
  if (!s) return 'bolt';
  if (has(s, 'projectile') || has(s, 'slug')) return 'slug';
  if (has(s, 'rocket') || has(s, 'missile') || has(s, 'launcher')) return 'rocket';
  if (has(s, 'flame') || has(s, 'fire')) return 'flame';
  if (has(s, 'lightning') || has(s, 'electric')) return 'lightning';
  return 'bolt';
}

/**
 * Whether `s` holds `needle`, ignoring case, without making a string of either. `name.toLowerCase()`
 * would be one short-lived string per call and two per shot for most guns, on every trigger pull of
 * every shooter in a firefight, and the header above promises otherwise. `needle` is always one of
 * the lower-case literals written out in the rule above, so only `s` is folded, and only over the
 * ASCII letters -- the names being read are a rack's ids and a pack's effect families, both written
 * by hand in this repository.
 */
function has(s: string, needle: string): boolean {
  const n = needle.length;
  for (let i = 0, last = s.length - n; i <= last; i++) {
    let j = 0;
    while (j < n) {
      let c = s.charCodeAt(i + j);
      if (c >= 65 && c <= 90) c += 32;
      if (c !== needle.charCodeAt(j)) break;
      j++;
    }
    if (j === n) return true;
  }
  return false;
}

/**
 * Whether a mark may be laid on the thing a collider belongs to: it may, when that thing holds
 * still. A mark is a quad put down in the world once and never asked about its surface again, so on
 * anything that moves -- a corpse whose limbs are still settling, a crate somebody can shove, a
 * parked hull -- it slides out of the surface within a second and then hangs in the air for the rest
 * of its life, since the only handle anything ever forgets is a streamed object's. The ground, a
 * wall, a building's shell and every streamed prop are fixed or have no body at all and take it.
 *
 * The collider is taken structurally rather than as a rapier type, so this module still imports
 * neither rapier nor three and is still driven by a plain node test.
 */
export function marksHold(c: { parent(): { isFixed(): boolean } | null } | null | undefined): boolean {
  if (!c) return false;
  const body = c.parent();
  return !body || body.isFixed();
}

/** The kept request: three objects for the life of the session, filled and handed over. */
const at: Vec3Like = { x: 0, y: 0, z: 0 };
const normal: Vec3Like = { x: 0, y: 1, z: 0 };
const place: MarkPlace = { owner: 0 };

/**
 * Lay one scar, and say whether anything took it. Refused, and counted as refused, when the marks
 * system is not wired, when `SCARS.on` is 0, and when the normal handed in is not a direction --
 * which is what a bolt stopping dead-on inside something gives, and a quad with no normal is a quad
 * edge-on to everything.
 *
 * `collider` is the handle of what stopped the bolt, so a mark laid on a crate goes down with the
 * crate when it streams out instead of hanging in the air where one used to stand; `MARK_WORLD` is
 * for the ground and the terrain, which are never streamed out from under a mark.
 *
 * It is never called for a shot fired inside a ship's rooms. Everything aboard lives in the hull's
 * frame and the marks are meshes in the world's, so a mark made there would either sit at the
 * world's origin or, carried out once, smear across the sky the moment the ship moved. Riding the
 * hull means a set of meshes under the hull's own group, which is the marks system's to give and
 * not the bolt's; until it does, a shot fired aboard bursts and sounds and marks nothing.
 */
export function layScar(family: ScarFamily, x: number, y: number, z: number, nx: number, ny: number, nz: number, collider: number): boolean {
  if (!(SCARS.on > 0) || !sink || !(nx * nx + ny * ny + nz * nz > 1e-12)) {
    SCAR_STATS.refused++;
    return false;
  }
  at.x = x;
  at.y = y;
  at.z = z;
  normal.x = nx;
  normal.y = ny;
  normal.z = nz;
  place.owner = collider;
  const laid = sink.scar(family, at, normal, place);
  if (!laid) {
    SCAR_STATS.refused++;
    return false;
  }
  SCAR_STATS.laid++;
  SCAR_STATS.byFamily[family]++;
  SCAR_STATS.lastFamily = family;
  return true;
}

/**
 * What the scars have done this session, for `__debug.scars()`. Numbers and one word only: a
 * readout that allocated would be a readout that could not be left switched on.
 */
export const SCAR_STATS = {
  laid: 0,
  refused: 0,
  byFamily: { bolt: 0, rocket: 0, slug: 0, flame: 0, lightning: 0 } as Record<ScarFamily, number>,
  lastFamily: '' as ScarFamily | '',
};

/** Forget the counts (a new world, or a run being measured from a known start). */
export function clearScarStats(): void {
  SCAR_STATS.laid = 0;
  SCAR_STATS.refused = 0;
  for (const f of SCAR_FAMILIES) SCAR_STATS.byFamily[f] = 0;
  SCAR_STATS.lastFamily = '';
}

/** Move the tuning live, as `__debug.scars({ on: 0 })` does; returns what is in force. */
export function tuneScars(opts?: Partial<ScarTune> | null): ScarTune {
  if (!opts) return SCARS;
  if (typeof opts.on === 'number' && Number.isFinite(opts.on)) SCARS.on = Math.max(0, opts.on);
  return SCARS;
}

/**
 * The readout: whether anything is laying marks at all, whether they are switched on, and what has
 * been laid and refused since the counts were last cleared. How a mark looks and how many of them
 * the ring holds is `__debug.marks()`, which is the marks system's own. Console only, so it may
 * allocate.
 */
export function scarReport(opts?: Partial<ScarTune> | null): {
  wired: boolean;
  on: boolean;
  laid: number;
  refused: number;
  byFamily: Record<ScarFamily, number>;
  last: string;
  tune: ScarTune;
} {
  if (opts) tuneScars(opts);
  return {
    wired: !!sink,
    on: SCARS.on > 0,
    laid: SCAR_STATS.laid,
    refused: SCAR_STATS.refused,
    byFamily: { ...SCAR_STATS.byFamily },
    last: SCAR_STATS.lastFamily,
    tune: { ...SCARS },
  };
}
