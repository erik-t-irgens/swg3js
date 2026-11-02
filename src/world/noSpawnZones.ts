// The no-spawn zones of a world's removal file (Map-maker II's twelfth wave, DESIGN.md §2.13): where nothing of the world's
// own life stands -- no lair, herd or camp; no person of the data's, the heralds', the overlay's, the brigade's or the owner's
// own placed people; no person of ours -- by the very shape test the places of ours are drawn and refused by (`zoneShape.ts`'s
// `zoneAt`), so a city he outlined as no-build is made no-spawn by the same outline. **No-spawn, not no-enter**: a creature
// from outside may chase somebody in, and a patroller of a row outside may walk across.
//
// Every zone is in the file's frame (raw on a planet, about the layout's centre; about (0, 0) on a world with no pack), which is
// the frame the wildlife's sites and the people's rows are read in, so neither carries anything: the sites ask a zone in that
// frame, the people's rows as the pack wrote them (`StandingPeople`'s `removed`), the people of ours from the game's frame
// carried back (`gameAt`).
//
// Pure: imports this folder's zone test and the removal file's reader's types alone. Rule for this file (node runs it with
// type stripping): every import with its `.ts` extension, no enum, no namespace, no constructor parameter properties.

import { ZoneList, zoneAt, zoneTouches } from './zoneShape.ts';
import type { RemovalRow, ZoneKeep, ZoneShapeRow } from '../story/removals.ts';
import { zoneKeeps } from '../story/removals.ts';
import type { SpawnArea } from './mobiles/lairs.ts';

/** One zone as read, with what it keeps away. */
export interface NoSpawnZone {
  id: string;
  name: string;
  shape: ZoneShapeRow;
  keeps: readonly ZoneKeep[];
}

/** The zones of a file's rows (its `z:` rows), in the file's order (by id). */
export function zonesOf(rows: readonly RemovalRow[]): NoSpawnZone[] {
  const out: NoSpawnZone[] = [];
  for (const r of rows) {
    if (!r.id.startsWith('z:') || !r.shape) continue;
    out.push({ id: r.id, name: r.name ?? r.id.slice(2), shape: r.shape, keeps: zoneKeeps(r) });
  }
  return out;
}

/** A zone's shape added to a list under `tag`. */
export function addZoneShape(list: ZoneList, s: ZoneShapeRow, tag: number): void {
  if (s.kind === 'circle') list.addCircle(s.c[0], s.c[1], s.r, tag);
  else if (s.kind === 'rect') list.addRect(s.min[0], s.min[1], s.max[0], s.max[1], tag);
  else {
    const xz = new Float64Array(s.pts.length * 2);
    for (let i = 0; i < s.pts.length; i++) {
      xz[i * 2] = s.pts[i][0];
      xz[i * 2 + 1] = s.pts[i][1];
    }
    list.addPoly(xz, tag);
  }
}

/**
 * A zone as the wildlife's laying reads one (`SpawnArea`, `src: 'zone'`): a circle and a rectangle in the area's own
 * shapes, an outline as `shape: 'poly'` with its points, which `lairs.ts`'s `inside` answers through the same test. Never
 * written into the pack: concatenated onto `noSpawn` at the laying's call.
 */
export function spawnAreaOf(z: NoSpawnZone): SpawnArea {
  const s = z.shape;
  if (s.kind === 'circle') return { name: z.id, shape: 'circle', x: s.c[0], z: s.c[1], r: s.r, groups: [], cap: 0, src: 'zone' };
  if (s.kind === 'rect') return { name: z.id, shape: 'rect', x: s.min[0], z: s.min[1], x2: s.max[0], z2: s.max[1], groups: [], cap: 0, src: 'zone' };
  return { name: z.id, shape: 'poly', x: s.pts[0][0], z: s.pts[0][1], pts: s.pts.map((p) => [p[0], p[1]] as [number, number]), groups: [], cap: 0, src: 'zone' };
}

/** The wildlife's zones: those that keep `wild`. */
export function wildAreasOf(zones: readonly NoSpawnZone[]): SpawnArea[] {
  return zones.filter((z) => z.keeps.includes('wild')).map(spawnAreaOf);
}

/** A row of the people as the zone rule reads one: its stand point, how far it roams, and its round, in the file's frame. */
export interface ZonedRow {
  x: number;
  z: number;
  roam?: number;
  route?: readonly { x: number; z: number }[];
}

/**
 * The zones of a world kept as two lists, by what they keep (`people`, `ours`), each in the file's frame, and asked many
 * times at an arrival and at each landing, never in a frame.
 */
export class ZoneSet {
  readonly zones: readonly NoSpawnZone[];
  private readonly people = new ZoneList();
  private readonly ours = new ZoneList();

  constructor(zones: readonly NoSpawnZone[]) {
    this.zones = zones;
    for (let i = 0; i < zones.length; i++) {
      if (zones[i].keeps.includes('people')) addZoneShape(this.people, zones[i].shape, i);
      if (zones[i].keeps.includes('ours')) addZoneShape(this.ours, zones[i].shape, i);
    }
  }

  get empty(): boolean {
    return this.zones.length === 0;
  }

  /**
   * Whether a row of the people stands in a zone keeping `people`, by the overlay's own rule (`rowKeptOff`): its stand point
   * within a zone grown by its roam, or any point of its round inside one. Answers the zone's index, or -1.
   */
  rowZone(r: ZonedRow): number {
    if (!this.people.count) return -1;
    const roam = typeof r.roam === 'number' && r.roam > 0 ? r.roam : 0;
    const at = zoneAt(this.people, r.x, r.z, roam);
    if (at >= 0) return this.people.tag[at];
    for (const p of r.route ?? []) {
      const k = zoneAt(this.people, p.x, p.z, 0);
      if (k >= 0) return this.people.tag[k];
    }
    return -1;
  }

  /** Whether a point (the file's frame) is inside a zone keeping `ours`, or within `r` of one; its index, or -1. */
  oursZone(x: number, z: number, r = 0): number {
    if (!this.ours.count) return -1;
    const at = zoneAt(this.ours, x, z, r);
    return at >= 0 ? this.ours.tag[at] : -1;
  }
}

/** A point of the game's frame carried into a file's raw frame about `centre` (the mirror every placed object goes through). */
export function rawOf(gx: number, gz: number, centre: { x: number; z: number }): { x: number; z: number } {
  return { x: centre.x - gx, z: gz + centre.z };
}

/**
 * How the default of ours sizes the rim a lair's site keeps off a zone (`ZONE_TUNE.margin`): `spread`, the site's footprint
 * half and the herd's spread (no body of a rim site stands inside, Map-maker II §2.16), or `middle`, the site's middle alone.
 * Its tune and the test live in `lairs.ts`, which lays the sites.
 */
export type ZoneMargin = 'spread' | 'middle';

/** Whether a zone (by its own list) touches a circle about a point: what the console's lists and the editor's notes ask. */
export function zoneTouchesCircle(z: NoSpawnZone, x: number, zz: number, r: number): boolean {
  const list = new ZoneList();
  addZoneShape(list, z.shape, 0);
  return zoneTouches(list, 0, x, zz, r);
}
