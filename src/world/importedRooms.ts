// A house of the owner's own with rooms as the game reads it (Map-maker II's eleventh wave, `__debug.imports({ rooms })`): its
// cells, their doorways, their lights (each point light's range and brightness by the room pool's own rule), their floors
// (built by the indoor nav's own reader) and its doors with whether the style each names is known. Pure, so the node test
// reads a house the very way the console does.
//
// Rule for this file (node runs it with type stripping for the tests): every value import with its `.ts` extension, no
// constructor parameter properties, nothing that touches the page at load.
import type { PackModelDef } from './assetPack.ts';
import type { DoorsFile, DoorStyleRow } from './doorMath.ts';
import { buildFloor, type FloorSource } from './nav/navMesh.ts';
import { pointLightAt3, pointLightRange } from './roomLights.ts';

/** One room of a house as the console prints it. */
export interface RoomReport {
  index: number;
  name: string;
  bounds: { min: number[]; max: number[] };
  doorways: { portal: number; to: number; window: boolean }[];
  /** Its own fill (type 0), its parallel lights (type 1) and its point lights with their range and value at 3 m. */
  ambient: number;
  parallel: number;
  points: { at: number[]; range: number; at3: number }[];
  /** Its floor as the indoor nav builds it, or null for a room with none. */
  floor: { triangles: number; vertices: number; openEdges: number } | null;
}

/** A house as the console prints it: its rooms, how many doorways, and its doors with where each style was found. */
export interface RoomsReport {
  model: string;
  rooms: RoomReport[];
  doorways: number;
  doors: { portal: number; style: string; cells: number[]; found: 'own' | 'gallery' | 'none' }[];
}

/**
 * A model's rooms as the game reads them, or null for a model with none. `doors` is its pack's doors table and `gallery` the
 * player's own gallery pack's styles (null where there is none): a door whose style neither names stands no door.
 */
export function roomsReport(def: PackModelDef, doors: DoorsFile | null, gallery: Record<string, DoorStyleRow> | null): RoomsReport | null {
  if (!def.cells?.length) return null;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const rooms = def.cells.map((c): RoomReport => {
    const lights = c.lights ?? [];
    const built = c.floor ? buildFloor(c.floor as FloorSource) : null;
    return {
      index: c.index,
      name: c.name,
      bounds: c.bounds,
      doorways: (c.portals ?? []).map((p) => ({ portal: p.geometry, to: p.target, window: !p.passable })),
      ambient: lights.filter((l) => l.type === 0).length,
      parallel: lights.filter((l) => l.type === 1).length,
      points: lights.filter((l) => l.type !== 0 && l.type !== 1).map((l) => ({ at: l.position, range: pointLightRange(l.attenuation), at3: r3(pointLightAt3(l.attenuation)) })),
      floor: built ? { triangles: built.count, vertices: built.verts.length / 3, openEdges: built.openEdges } : null,
    };
  });
  const own = doors?.styles ?? {};
  const has = (o: Record<string, unknown> | null, k: string) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const rows = doors?.models?.[def.id] ?? [];
  return {
    model: def.id,
    rooms,
    doorways: def.portals?.length ?? 0,
    doors: rows.map((d) => ({ portal: d.portal, style: d.style, cells: d.cells, found: has(own, d.style) ? 'own' : has(gallery, d.style) ? 'gallery' : 'none' })),
  };
}
