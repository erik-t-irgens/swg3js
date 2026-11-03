// The lights files read into what the room pool asks of one room (Map-maker II's wave of the rooms' lights): which rows reach
// a copy of a building, and of those, cell by cell, the narrowest edit of a light, the narrowest fill, and every light added,
// narrowest scope first (`RoomEditsFor`, which `planRoomLights` in `roomLights.ts` lays on the room rule).
//
// **Narrowest wins** for what edits one thing -- a light's edit, a room's fill -- whole, never merged across scopes: one copy's
// row over this world's, this world's over every world's. **Every light added is lit**, whatever its scope, since two lights of
// two scopes are two lights; a narrower `edit` naming a wider light's id switches it off or changes it for its own scope alone.
// A row whose room no longer bears its name in the building (a model converted again with its cells moved) is left out and
// named (`stale`), never laid on another room.
//
// Pure: imports only the lights file's types and readers. Rule for this file (node runs it with type stripping): every import
// with its `.ts` extension, no enum, no namespace, no constructor parameter properties.

import { specOfRow, type LightRow } from './editFiles/lightsFile.ts';
import type { AddedLightLike, FillEditLike, LightEditLike, RoomEditsFor } from './roomLights.ts';

/** A cell as the index reads it: its index and its own name. */
export interface NamedCell {
  index: number;
  name: string;
}

/** A light hung on a placed row standing in a room (`attach`'s `light`): its key, the cell it stands in, and the light added. */
export interface AttachedRoomLight extends AddedLightLike {
  cell: number;
}

/** What one room's edits came to, beside the answers the plan asks: the rows that named a room that is not there. */
export interface RoomEditsAnswer extends RoomEditsFor {
  /** The rows reaching this copy, narrowest scope first (what the editor's markers and lists show). */
  rows: readonly LightRow[];
  stale: readonly LightRow[];
}

const NO_ROWS: readonly LightRow[] = [];

/** The lights files in force, indexed by copy and by model. */
export class RoomLightEdits {
  /** Every row of this world's file and the shared one, as read (the console's and the editor's). */
  readonly world: readonly LightRow[];
  readonly all: readonly LightRow[];
  private readonly byCopy = new Map<string, LightRow[]>();
  private readonly worldByModel = new Map<string, LightRow[]>();
  private readonly allByModel = new Map<string, LightRow[]>();
  /** Every light standing outdoors (this pass a mark: nothing lights it). */
  readonly outdoor: readonly LightRow[];

  constructor(world: readonly LightRow[], all: readonly LightRow[]) {
    this.world = world;
    this.all = all;
    const outdoor: LightRow[] = [];
    for (const r of world) {
      if (r.scope === 'outdoor') outdoor.push(r);
      else if (r.scope === 'copy' && r.copy) push(this.byCopy, r.copy, r);
      else if (r.scope === 'world' && r.model) push(this.worldByModel, r.model, r);
    }
    for (const r of all) if (r.scope === 'all' && r.model) push(this.allByModel, r.model, r);
    this.outdoor = outdoor;
  }

  /** Whether any row edits any room (nothing to lay on the rule at all, and the pool plans as it always did). */
  get empty(): boolean {
    return this.byCopy.size === 0 && this.worldByModel.size === 0 && this.allByModel.size === 0;
  }

  /** Every row reaching one copy of a building (its copy key, null for one with none) of a model, narrowest scope first. */
  rowsFor(copy: string | null, model: string): LightRow[] {
    const own = copy ? (this.byCopy.get(copy) ?? NO_ROWS).filter((r) => r.model === model) : NO_ROWS;
    return [...own, ...(this.worldByModel.get(model) ?? NO_ROWS), ...(this.allByModel.get(model) ?? NO_ROWS)];
  }

  /**
   * One room's edits for the plan: the rows reaching this copy laid out by cell, each answered narrowest first. `cells` are
   * the building's own (a row whose cell's name is not its room is stale); `attached` the lights hung on rows standing in
   * its rooms, after the file's own added lights of their cell.
   */
  forRoom(copy: string | null, model: string, cells: readonly NamedCell[], attached: readonly AttachedRoomLight[] = []): RoomEditsAnswer {
    const rows = this.rowsFor(copy, model);
    const stale: LightRow[] = [];
    const nameOf = new Map<number, string>();
    for (const c of cells) nameOf.set(c.index, c.name);
    const edits = new Map<string, LightRow>();
    const fills = new Map<number, LightRow>();
    const added = new Map<number, AddedLightLike[]>();
    const where = copy ?? model;
    for (const r of rows) {
      if (r.cell === undefined || nameOf.get(r.cell) !== r.room) {
        stale.push(r);
        continue;
      }
      if (r.kind === 'edit') {
        const k = `${r.cell}\u0000${typeof r.of}\u0000${r.of}`;
        // Narrowest first: the first row met for a light is its edit.
        if (!edits.has(k)) edits.set(k, r);
      } else if (r.kind === 'fill') {
        if (!fills.has(r.cell)) fills.set(r.cell, r);
      } else {
        const spec = specOfRow(r);
        if (!spec || !r.pos) continue;
        let list = added.get(r.cell);
        if (!list) added.set(r.cell, (list = []));
        list.push({ key: r.id, spec, pos: r.pos, ...(r.q ? { q: r.q } : {}), where });
      }
    }
    for (const a of attached) {
      let list = added.get(a.cell);
      if (!list) added.set(a.cell, (list = []));
      list.push(a);
    }
    return {
      rows,
      stale,
      edit: (cell, of) => {
        const r = edits.get(`${cell}\u0000${typeof of}\u0000${of}`);
        return r ? editOf(r) : null;
      },
      fill: (cell) => {
        const r = fills.get(cell);
        return r ? fillOf(r) : null;
      },
      added: (cell) => added.get(cell) ?? NO_ADDED,
    };
  }
}

const NO_ADDED: readonly AddedLightLike[] = [];

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  let list = m.get(k);
  if (!list) m.set(k, (list = []));
  list.push(v);
}

/** An edit row as the plan reads it. */
export function editOf(r: LightRow): LightEditLike {
  const e: LightEditLike = {};
  if (r.off) e.off = true;
  if (r.scale !== undefined) e.scale = r.scale;
  if (r.color) e.color = r.color;
  if (r.reach !== undefined) e.reach = r.reach;
  if (r.shadow !== undefined) e.shadow = r.shadow;
  return e;
}

/** A fill row as the plan reads it. */
export function fillOf(r: LightRow): FillEditLike {
  const f: FillEditLike = {};
  if (r.scale !== undefined) f.scale = r.scale;
  if (r.color) f.color = r.color;
  return f;
}

/** No lights files at all. */
export const NO_LIGHT_EDITS = new RoomLightEdits([], []);
