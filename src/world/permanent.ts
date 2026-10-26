// What a world stands for good: its permanent placements, both layers, and what of them stands now.
//
// The rows are read by `src/story/placements.ts`; this keeps them per world and brings what stands to what
// they say, through whatever the caller hands it (the world's `standPlacement` and `unplaceBuilding` in the
// game, the real streamer in a node test). Every sync is **one plan over both layers at once**, buildings
// stood before props, so a thing standing in a building finds its host as it is filed; the streamer re-hosts
// what was filed before its building for the case a sync cannot order (a story row stood before the world
// edit that holds it).
//
// A row that cannot stand is skipped and named, never thrown: its pack is not on this machine (`noPack`), its
// model is not in the pack (`noModel`), the other layer holds its id (`clash`), it is a building in a space
// zone (`space`, as a house is refused there), or the world is the dungeons' world of copies (`copies`: a row
// stands at its raw place, so it would turn up in one copy of the forty-eight). On the dev server a row the
// placement editor has taken in hand (`lift`) is down and stays down (`inHand`) until it is put back
// (`restore`) or saved (`land`).
//
// **A world that has gone takes its rows with it.** Every call asks the world's generation and treats a new
// one as a world with nothing standing, so nothing here ever takes down a key in the world that came after,
// and nothing answers a question about the next world (the guard, the pick-up key's words) with the last
// world's rows.
//
// **A guard is metres round the thing's own footprint**, the model's box turned the way it stands, never a
// circle round its origin: a house's origin is its doorstep, and a circle there reached out into the street
// in front and left its back rooms open.
//
// Pure: no three, no rapier, no DOM. Rule for this file (node runs it with type stripping for the tests):
// every import with its `.ts` extension, no enum, no namespace, no constructor parameter properties.

import { mergeLayers, placementKey, radiusOfBounds, rowHash, scaleOf, syncPlan, toGame, type GamePlace, type PlacementEntry, type PlacementFrame, type PlacementLayer, type PlacementPack, type PlacementRead, type PlacementRow } from '../story/placements.ts';
import { standsIn } from './worldState.ts';

/** Every number here is ours. Live through `__debug.placements({ tune })`. */
export const DRESSING_TUNE = {
  /** How long a world's ground waits for the rows' flora circles before it is built anyway, milliseconds. */
  floraWaitMs: 1500,
  /** How long a loading screen, and the seats, wait for the dressing to be filed, milliseconds. */
  standWaitMs: 6000,
  /** Metres within which the pick-up key says a permanent thing is part of this world. */
  nearReach: 6,
  /** Metres round a story-layer row a player's own prop may not stand, where the row says nothing. */
  guard: 1.5,
  /** Metres the ground under a row may have moved before the editor flags it. */
  drift: 0.5,
};

/** What kind of world the rows are in: decides the frame and what is skipped. */
export type WorldKind = 'ground' | 'space' | 'copies';
/** Why a row does not stand; `inHand` is one the dev server's editor has taken up (`lift`), which comes back with `restore` or `land`. */
export type SkipReason = 'badRow' | 'clash' | 'noPack' | 'noModel' | 'copies' | 'space' | 'inHand' | 'otherState';
const REASONS: readonly SkipReason[] = ['badRow', 'clash', 'noPack', 'noModel', 'copies', 'space', 'inHand', 'otherState'];

/** A model's own box, in its own frame. Either corner may come first: spans are taken, never corners (the BOX lesson). */
export interface PlacementBox {
  min: readonly number[];
  max: readonly number[];
}

/** What standing one row gave. */
export interface StandAnswer {
  /** Its model's own box, in its own frame, at the size it stands (its scale taken in), or null for a model with none. */
  bounds: PlacementBox | null;
  /**
   * What the stand set aside of the row and why, in words, or absent: a scale on a building with rooms (none this pass),
   * a flora row's three scales taken as its largest. Said on the console and in the editor's lists, never a refusal.
   */
  note?: string;
  /**
   * Settles once its model is in and its programs are built, where it was filed into a tier already
   * standing; otherwise at once, the tier's own build being what does the work. What a loading screen waits
   * on, since asking whether the tiers round the player stand says nothing of a model still loading into one.
   */
  built?: Promise<unknown>;
}

/**
 * What one row is stood as: its model, where it stands in the game's frame, and whether it is solid, three
 * ways as the streamer takes it (`true` solid, `false` never, absent by its size). `q` is three's order and may
 * be a buffer the caller fills again for the next row, so it is read at once and never kept.
 */
export interface DressingStand {
  key: string;
  model: string;
  x: number;
  y: number;
  z: number;
  q: readonly [number, number, number, number];
  inside: boolean;
  solid?: boolean;
  clear?: number;
  effectsOf?: string;
  /**
   * The ground world a world row's model comes from (`PlacementRow.from`): the stand looks its model up in that pack
   * first, a light guest standing behind the world (`LayoutStreamer.standPermanent`). Absent, this world's own.
   */
  from?: string;
  /** Its scale along its own axes (`PlacementRow.scale`), absent for none: what the streamer sets aside it decides and says. */
  scale?: readonly [number, number, number];
}

/**
 * How a row is stood, decided in one place for the game and its node test alike. A props row is the props
 * catalogue's thing (its model, and its template as what it really is, so its client data's fire and the
 * surface it is made of come with it); a gallery or world row is its model. Solid unless the row says
 * otherwise -- a permanent thing is walked round -- **except a seat or a table** (`furniture` answers that of
 * the thing's template), which is never solid unless its row says `solid: true`: a permanent one is counted as
 * the world's own (`World.dataPlacedNear`), so the seats of ours are not stood where it is, and the seated
 * person the data puts on it is a dynamic body that a collider under it pushes off its seat, which is why the
 * seats and tables of ours are never solid either. Null for a thing the catalogue does not hold, or a row with
 * no model.
 */
/**
 * A props catalogue thing as `dressingStandOf`'s `thingOf` reads one: a prop of ours, which no template names, stands
 * with an empty template, so it is no seat or table and carries no client data's effects.
 */
export function propStandOf(def: { model: string; template: string | null } | null): { model: string; template: string } | null {
  return def ? { model: def.model, template: def.template ?? '' } : null;
}

export function dressingStandOf(row: PlacementRow, g: GamePlace, key: string, thingOf: (thing: string) => { model: string; template: string } | null, furniture: (template: string) => boolean): DressingStand | null {
  // A row's scale rides along only where it has one, so a row with none stands exactly as it always did.
  const at = { key, x: g.x, y: g.y, z: g.z, q: g.q, inside: !!row.inside, ...(row.clear && row.clear > 0 ? { clear: row.clear } : {}), ...(row.scale !== undefined ? { scale: scaleOf(row) } : {}) };
  if (row.pack === 'props') {
    const def = row.thing ? thingOf(row.thing) : null;
    if (!def) return null;
    return { ...at, model: def.model, solid: standsSolid(row, furniture(def.template)), effectsOf: def.template };
  }
  if (!row.model) return null;
  // A gallery or world row's template is what it really is, handed on as the thing's own is: what its client data
  // hangs on it (a world's brazier burns) and what `World.dataPlacedNear` counts a permanent chair as the world's own by.
  // And its `from`, the world its model comes from. A row naming neither stands exactly as it always did.
  return { ...at, model: row.model, solid: standsSolid(row, false), ...(row.template ? { effectsOf: row.template } : {}), ...(row.from && row.pack === 'world' ? { from: row.from } : {}) };
}

/**
 * Whether a row stands solid: its own word where it says one, else solid -- except a props row whose thing is a
 * seat or a table (`furniture`, asked of the thing's template), which is passable (`dressingStandOf`'s rule, and
 * the one the editor's Solid shows and turns, so the two can never disagree).
 */
export function standsSolid(row: Pick<PlacementRow, 'solid' | 'pack'>, furniture: boolean): boolean {
  return row.solid ?? (row.pack === 'props' ? !furniture : true);
}

/** Metres round a stood row a player's own thing may not stand: its row's own, else the tune's on a story row, else none. Read live, so the tune moves it. */
export function guardOf(s: StoodRow): number {
  return s.row.guard ?? (s.layer === 'story' ? DRESSING_TUNE.guard : 0);
}

/** Whether a stood row can have a guard at all, whatever the tune says: what the frame's kept list holds. */
function mayGuard(s: StoodRow): boolean {
  return s.row.guard !== undefined ? s.row.guard > 0 : s.layer === 'story';
}

/**
 * A row's footprint on the ground, written into `out`: the way its turn carries its own +X along the ground
 * (`ex`, `ez`, a unit vector; its own +Z when +X stands straight up), and the reach of its box's eight corners,
 * turned the way it stands, along that way (`u0`..`u1`) and across it (`v0`..`v1`), from its origin. Upright,
 * that is exactly the box's own spans; tipped, it is the rectangle round what the box covers of the ground.
 * `q` is three's order, `[x, y, z, w]`.
 */
export function footprintOf(bounds: PlacementBox | null, q: readonly [number, number, number, number], out: { ex: number; ez: number; u0: number; u1: number; v0: number; v1: number }): void {
  const [qx, qy, qz, qw] = q;
  // v turned by q: v + 2w(q × v) + 2 q × (q × v).
  const turn = (vx: number, vy: number, vz: number, k: 0 | 1 | 2): number => {
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);
    if (k === 0) return vx + qw * tx + (qy * tz - qz * ty);
    if (k === 1) return vy + qw * ty + (qz * tx - qx * tz);
    return vz + qw * tz + (qx * ty - qy * tx);
  };
  let ex = turn(1, 0, 0, 0);
  let ez = turn(1, 0, 0, 2);
  let len = Math.hypot(ex, ez);
  if (len < 1e-6) {
    // Its +X stands straight up: its +Z then lies along the ground, and is the way across.
    const bx = turn(0, 0, 1, 0);
    const bz = turn(0, 0, 1, 2);
    const blen = Math.hypot(bx, bz) || 1;
    ex = bz / blen;
    ez = -bx / blen;
    len = 1;
  }
  out.ex = ex / len;
  out.ez = ez / len;
  out.u0 = out.u1 = out.v0 = out.v1 = 0;
  if (!bounds || bounds.min.length < 3 || bounds.max.length < 3) return;
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (let c = 0; c < 8; c++) {
    const cx = c & 1 ? Math.max(bounds.min[0], bounds.max[0]) : Math.min(bounds.min[0], bounds.max[0]);
    const cy = c & 2 ? Math.max(bounds.min[1], bounds.max[1]) : Math.min(bounds.min[1], bounds.max[1]);
    const cz = c & 4 ? Math.max(bounds.min[2], bounds.max[2]) : Math.min(bounds.min[2], bounds.max[2]);
    const wx = turn(cx, cy, cz, 0);
    const wz = turn(cx, cy, cz, 2);
    const u = wx * out.ex + wz * out.ez;
    const v = wz * out.ex - wx * out.ez;
    if (u < u0) u0 = u;
    if (u > u1) u1 = u;
    if (v < v0) v0 = v;
    if (v > v1) v1 = v;
  }
  out.u0 = u0;
  out.u1 = u1;
  out.v0 = v0;
  out.v1 = v1;
}

/** What standing the rows needs of the world. */
export interface PermanentDeps {
  /**
   * Stand one row at its place in the game's frame, filed under `key`, at once (the filing is synchronous;
   * its model may load after): its model's box and what to wait on for it to be built, or null when its model
   * is not in its pack.
   */
  stand(row: PlacementRow, game: GamePlace, key: string): StandAnswer | null;
  /** Take what stands under `key` down. */
  unstand(key: string): void;
  /**
   * Take what stands under many keys down in one call, in the order given (props before the buildings they may stand
   * in): a sync's removals handed over at once, so a thousand rows taken out are one pass over the streamer's lists
   * (`LayoutStreamer.unplaceMany`) and not a thousand. Absent, `unstand` is asked a key at a time.
   */
  unstandMany?(keys: readonly string[]): void;
  /** Whether a row's pack is on this machine and in hand now; `from`, the world a world row's model comes from, where it names one. */
  packReady(pack: PlacementPack, from?: string): boolean;
  /** The world's generation now (`World.generation`). */
  generation(): number;
  /** What a row is called in words; its id when absent. */
  label?(row: PlacementRow): string;
}

/**
 * One row standing: kept, so the frame's guard asks nothing new of anything. Its row, layer and name are
 * brought up to date by every sync, re-stood or not (a row renamed, or moved to the other layer unchanged,
 * stands as it stood and is called and guarded as it reads now).
 */
export interface StoodRow {
  key: string;
  row: PlacementRow;
  layer: PlacementLayer;
  hash: string;
  /** Where it stands in the game's frame: its origin, which for a house is its doorstep. */
  x: number;
  y: number;
  z: number;
  /** Half the wider of its box's spans: its size on the ground as the pack files it. */
  radius: number;
  /** Its footprint on the ground, in its own turned frame (`footprintOf`). */
  ex: number;
  ez: number;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  label: string;
  /** What its stand set aside of it, in words (`StandAnswer.note`), or absent. */
  note?: string;
}

/** What one write did to one layer's file, as the page lands it (`landChanges`): the rows put, as stamped, and the ids taken out. */
export interface LayerChange {
  layer: PlacementLayer;
  put: readonly PlacementRow[];
  deleted: readonly string[];
}

/** What `report` says of one layer. */
export interface LayerReport {
  source: 'file' | 'none';
  problem: string | null;
  rows: number;
  stood: number;
  skipped: Record<SkipReason, number>;
  unknown: string[];
}

/**
 * The circles a world's ground keeps its plants off before it is first built: every row of both layers that
 * asks for some (`clear`), the clashing story row left out as the sync leaves it out, in the frame its file
 * is written in (`raw` on a planet, `game` in a space zone). None in the world of copies, where nothing stands.
 */
export function keepOffOf(story: PlacementRead | null, world: PlacementRead | null, kind: WorldKind): { raw: { x: number; z: number; r: number }[]; game: { x: number; z: number; r: number }[] } {
  const out = { raw: [] as { x: number; z: number; r: number }[], game: [] as { x: number; z: number; r: number }[] };
  if (kind === 'copies') return out;
  for (const { row } of mergeLayers(story?.rows ?? [], world?.rows ?? []).rows) {
    if (!row.clear || !(row.clear > 0)) continue;
    if (kind === 'space' && row.kind === 'building') continue;
    (kind === 'space' ? out.game : out.raw).push({ x: row.x, z: row.z, r: row.clear });
  }
  return out;
}

export class PermanentLayer {
  private readonly deps: PermanentDeps;
  private world = '';
  private centre: { x: number; z: number } | null = null;
  private kind: WorldKind = 'ground';
  private gen = -1;
  private readonly files: Record<PlacementLayer, PlacementRead | null> = { story: null, world: null };
  private readonly stood = new Map<string, StoodRow>();
  /** The stood rows that can have a guard, for the frame's question; how wide each is is read live (`guardOf`). */
  private guarded: StoodRow[] = [];
  /** Why each row that is not standing is not, by its key (the reading's skips are kept apart, by layer). */
  private readonly skips = new Map<string, { id: string; layer: PlacementLayer; kind: string; why: SkipReason }>();
  /**
   * The rows the dev server's editor has taken in hand (`lift`), by key: taken down, and treated by every sync
   * as rows that are not to stand, so a file read again while one is in hand never stands it a second time
   * under the ghost, and putting it down unmoved stands it again (`land`), which a sync that still believed it
   * stood would never do.
   */
  private readonly lifted = new Set<string>();
  private readonly place: GamePlace = { x: 0, y: 0, z: 0, q: [0, 0, 0, 1] };

  constructor(deps: PermanentDeps) {
    this.deps = deps;
  }

  /** The frame this world's files are written in. */
  get frame(): PlacementFrame {
    return this.kind === 'space' ? 'game' : 'raw';
  }

  /** Which world the rows are this world's for, and its generation, or `''` before any. */
  get worldId(): string {
    return this.world;
  }

  get generation(): number {
    return this.gen;
  }

  /**
   * A new world: the last one's rows and what stood of them are forgotten (the world went, and its things
   * with it), and every later call is checked against `generation`.
   */
  enter(world: string, centre: { x: number; z: number } | null, kind: WorldKind, generation: number): void {
    this.world = world;
    this.centre = centre ? { x: centre.x, z: centre.z } : null;
    this.kind = kind;
    this.gen = generation;
    this.files.story = null;
    this.files.world = null;
    this.forgetStanding();
    this.lifted.clear();
  }

  /**
   * Whether the world these rows are for is still the one up. Every question asks it, so a world arrived at
   * with no stand of its own (its pack failed, a jump's swap refused) is never answered with the last world's
   * rows. One compare, nothing made, so the frame's guard may ask it.
   */
  private current(): boolean {
    return this.gen >= 0 && this.deps.generation() === this.gen;
  }

  /** Nothing stands any more, as far as this knows (the world it stood in has gone). */
  private forgetStanding(): void {
    this.stood.clear();
    this.guarded = [];
    this.skips.clear();
  }

  /**
   * One layer's file read again (null: there is none): what stands is brought to both layers as they read
   * now, in one plan. Nothing is done for a world that has gone. Answers what to wait on for the rows stood
   * now to be built (`StandAnswer.built`).
   */
  setLayer(layer: PlacementLayer, read: PlacementRead | null): Promise<unknown>[] {
    if (!this.current()) {
      this.forgetStanding();
      return [];
    }
    this.files[layer] = read;
    return this.sync();
  }

  /** Both layers at once, as a world arrives: one plan, so neither layer's rows are stood twice. */
  setLayers(story: PlacementRead | null, world: PlacementRead | null): Promise<unknown>[] {
    if (!this.current()) {
      this.forgetStanding();
      return [];
    }
    this.files.story = story;
    this.files.world = world;
    return this.sync();
  }

  /**
   * A row taken in hand by the dev server's editor: taken down here and now (whoever stands in a building's
   * rooms is stood on its doorstep first, as any taking down does), and left down by every sync until it is
   * put back (`restore`) or saved (`land`). Answers the row as it stood, for the hand to carry, or null when
   * nothing stands under the key in this world.
   */
  lift(key: string): StoodRow | null {
    if (!this.current()) return null;
    const s = this.stood.get(key);
    if (!s) return null;
    this.deps.unstand(key);
    this.stood.delete(key);
    this.lifted.add(key);
    this.skips.set(key, { id: s.row.id, layer: s.layer, kind: s.row.kind, why: 'inHand' });
    this.guarded = [...this.stood.values()].filter(mayGuard);
    return s;
  }

  /** A row taken in hand given back unchanged (Escape, a refused save): stood again as its file says. */
  restore(key: string): Promise<unknown>[] {
    if (!this.lifted.delete(key) || !this.current()) return [];
    return this.sync();
  }

  /**
   * A save answered: both layers as the endpoint wrote them, and the row that was in hand (`key`, null for a
   * thing never stood) no longer held down, in one plan, so a row saved where it stood is stood again and one
   * saved somewhere else is stood there, once.
   */
  land(key: string | null, story: PlacementRead | null, world: PlacementRead | null): Promise<unknown>[] {
    if (key) this.lifted.delete(key);
    return this.setLayers(story, world);
  }

  /** Whether a row is in the editor's hand. */
  inHand(key: string): boolean {
    return this.current() && this.lifted.has(key);
  }

  /** Bring what stands to what both layers say; answers what to wait on for what was stood to be built. */
  private sync(): Promise<unknown>[] {
    const merged = mergeLayers(this.files.story?.rows ?? [], this.files.world?.rows ?? []);
    this.skips.clear();
    for (const id of merged.clashes) this.skips.set(placementKey(id), { id, layer: 'story', kind: this.files.story?.rows.find((r) => r.id === id)?.kind ?? '', why: 'clash' });
    const want: PlacementEntry[] = [];
    for (const e of merged.rows) {
      const key = placementKey(e.row.id);
      // A row of a world state this world does not stand in (Restuss's rubble in the living city) is filed nowhere and
      // never taken out of its file; a state changes only at an arrival, so nothing is filed or unfiled mid-world.
      const why: SkipReason | null = this.lifted.has(key) ? 'inHand' : this.kind === 'copies' ? 'copies' : this.kind === 'space' && e.row.kind === 'building' ? 'space' : e.row.state && !standsIn(e.row.state) ? 'otherState' : !this.deps.packReady(e.row.pack, e.row.from) ? 'noPack' : null;
      if (why) this.skips.set(key, { id: e.row.id, layer: e.layer, kind: e.row.kind, why });
      else want.push(e);
    }
    const standing = new Map<string, string>();
    for (const [key, s] of this.stood) standing.set(key, s.hash);
    const plan = syncPlan(standing, want);
    // Down first, props before the buildings they may stand in, so nothing is let go of by a building only to
    // be taken down a moment later.
    const down = [...plan.remove, ...plan.change.map((e) => placementKey(e.row.id))];
    this.takeDown(down);
    // Then up, buildings first (the plan's own order): changes and additions alike.
    const up = [...plan.change, ...plan.add];
    const builds: Promise<unknown>[] = [];
    const stoodNow = this.standUp(up, builds);
    // What stood already and stands unchanged is called, layered and guarded as its row reads now: a row's
    // words and the layer it is in are not part of how it stands, so nothing re-stands it, but O's words and
    // the guard's width are read off the row and its layer.
    for (const e of want) {
      const key = placementKey(e.row.id);
      if (stoodNow.has(key)) continue;
      const s = this.stood.get(key);
      if (!s) continue;
      s.row = e.row;
      s.layer = e.layer;
      s.label = this.deps.label?.(e.row) ?? e.row.id;
    }
    this.guarded = [...this.stood.values()].filter(mayGuard);
    return builds;
  }

  /** Keys taken down, props before the buildings they may stand in, in one call where the world takes one (`unstandMany`). */
  private takeDown(down: string[]): void {
    if (!down.length) return;
    down.sort((a, b) => (this.stood.get(a)?.row.kind === 'building' ? 1 : 0) - (this.stood.get(b)?.row.kind === 'building' ? 1 : 0));
    if (this.deps.unstandMany) this.deps.unstandMany(down);
    else for (const key of down) this.deps.unstand(key);
    for (const key of down) this.stood.delete(key);
  }

  /** Rows stood, buildings first; answers the keys stood, and pushes what to wait on for each to be built into `builds`. */
  private standUp(up: PlacementEntry[], builds: Promise<unknown>[]): Set<string> {
    up.sort((a, b) => (a.row.kind === 'building' ? 0 : 1) - (b.row.kind === 'building' ? 0 : 1));
    const stoodNow = new Set<string>();
    for (const e of up) {
      const key = placementKey(e.row.id);
      stoodNow.add(key);
      const g = toGame(e.row, this.centre, this.frame, this.place);
      const answer = this.deps.stand(e.row, g, key);
      if (answer === null) {
        this.skips.set(key, { id: e.row.id, layer: e.layer, kind: e.row.kind, why: 'noModel' });
        continue;
      }
      if (answer.built) builds.push(answer.built);
      const s: StoodRow = { key, row: e.row, layer: e.layer, hash: rowHash(e.row), x: g.x, y: g.y, z: g.z, radius: radiusOfBounds(answer.bounds), ex: 1, ez: 0, u0: 0, u1: 0, v0: 0, v1: 0, label: this.deps.label?.(e.row) ?? e.row.id, ...(answer.note ? { note: answer.note } : {}) };
      footprintOf(answer.bounds, g.q, s);
      this.stood.set(key, s);
    }
    return stoodNow;
  }

  /**
   * A write of the world editor's landed by difference (DESIGN.md §2.11): each layer's held rows patched with what the
   * write put and took out (by id, through an index kept beside each file's rows), and what stands brought to them **over
   * the changed ids alone**, by the very rules a whole sync uses -- the world edit winning a clash, a row in hand left
   * down, a state, a pack, a building in space -- so it stands and takes down exactly what a whole `setLayers` over the
   * files as they now read would, and costs the page what changed rather than the file's size. `landed` are rows the
   * editor held down (`lift`) that the write has now put somewhere: no longer held. Nothing is done for a world that has
   * gone. Answers what to wait on for the rows stood to be built.
   */
  landChanges(changes: readonly LayerChange[], landed: readonly string[] = []): Promise<unknown>[] {
    if (!this.current()) {
      this.forgetStanding();
      return [];
    }
    for (const key of landed) this.lifted.delete(key);
    const ids = new Set<string>();
    for (const c of changes) {
      const f = this.files[c.layer] ?? { rows: [], skipped: [], unknown: [], problem: null };
      const byId = new Map<string, number>();
      f.rows.forEach((r, i) => byId.set(r.id, i));
      let appended = false;
      const gone = new Set<string>();
      for (const id of c.deleted) {
        if (byId.has(id)) gone.add(id);
        ids.add(id);
      }
      for (const row of c.put) {
        ids.add(row.id);
        gone.delete(row.id);
        const i = byId.get(row.id);
        if (i !== undefined) f.rows[i] = row;
        else {
          byId.set(row.id, f.rows.length);
          f.rows.push(row);
          appended = true;
        }
      }
      if (gone.size) f.rows = f.rows.filter((r) => !gone.has(r.id));
      // The file is written one line a row sorted by id; the rows read back from it are in that order, and so are these.
      if (appended) f.rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      this.files[c.layer] = f.rows.length || f.problem || f.skipped.length ? f : null;
    }
    for (const l of landed) {
      const id = l.startsWith(placementKey('')) ? l.slice(placementKey('').length) : l;
      ids.add(id);
    }
    const storyBy = new Map<string, PlacementRow>();
    const worldBy = new Map<string, PlacementRow>();
    for (const r of this.files.story?.rows ?? []) if (ids.has(r.id)) storyBy.set(r.id, r);
    for (const r of this.files.world?.rows ?? []) if (ids.has(r.id)) worldBy.set(r.id, r);
    const down: string[] = [];
    const up: PlacementEntry[] = [];
    for (const id of ids) {
      const key = placementKey(id);
      this.skips.delete(key);
      const w = worldBy.get(id);
      const s = storyBy.get(id);
      if (w && s) this.skips.set(key, { id, layer: 'story', kind: s.kind, why: 'clash' });
      const e: PlacementEntry | null = w ? { row: w, layer: 'world' } : s ? { row: s, layer: 'story' } : null;
      const why: SkipReason | null = !e ? null : this.lifted.has(key) ? 'inHand' : this.kind === 'copies' ? 'copies' : this.kind === 'space' && e.row.kind === 'building' ? 'space' : e.row.state && !standsIn(e.row.state) ? 'otherState' : !this.deps.packReady(e.row.pack, e.row.from) ? 'noPack' : null;
      if (e && why) this.skips.set(key, { id, layer: e.layer, kind: e.row.kind, why });
      const was = this.stood.get(key);
      if (!e || why) {
        if (was) down.push(key);
        continue;
      }
      if (!was) up.push(e);
      else if (was.hash !== rowHash(e.row)) {
        down.push(key);
        up.push(e);
      } else {
        was.row = e.row;
        was.layer = e.layer;
        was.label = this.deps.label?.(e.row) ?? e.row.id;
      }
    }
    this.takeDown(down);
    const builds: Promise<unknown>[] = [];
    this.standUp(up, builds);
    this.guarded = [...this.stood.values()].filter(mayGuard);
    return builds;
  }

  /** The row standing under a key, or null (and null for every key once the world it stood in has gone). */
  rowOf(key: string): StoodRow | null {
    if (!this.current()) return null;
    return this.stood.get(key) ?? null;
  }

  /** Every row standing now; none once the world they stood in has gone. */
  get standing(): Iterable<StoodRow> {
    return this.current() ? this.stood.values() : [];
  }

  /** How many rows stand now. */
  get count(): number {
    return this.current() ? this.stood.size : 0;
  }

  /** The nearest row standing within `reach` metres of a point of the game's frame, of one kind if asked; null for none. */
  nearest(at: { x: number; y: number; z: number }, reach: number, kind?: 'prop' | 'building'): StoodRow | null {
    if (!this.current()) return null;
    let best: StoodRow | null = null;
    let bestD = reach;
    for (const s of this.stood.values()) {
      if (kind && s.row.kind !== kind) continue;
      const d = Math.hypot(s.x - at.x, s.y - at.y, s.z - at.z);
      if (d > bestD) continue;
      bestD = d;
      best = s;
    }
    return best;
  }

  /**
   * The nearest row whose guard a circle of `r` metres about (x, z) reaches, or null: what refuses a
   * player's own thing there. A guard is metres past the row's own footprint -- its box turned the way it
   * stands (`footprintOf`) -- so a story table's guard reaches past its edge, and a story house's covers its
   * back rooms as well as its doorstep and reaches no further into the street than its guard. How wide each
   * guard is is read now (`guardOf`), so the tune moves rows already standing. Asked every frame something is
   * in hand, so it walks a kept list and makes nothing.
   */
  guardedAt(x: number, z: number, r: number): StoodRow | null {
    if (!this.current()) return null;
    const list = this.guarded;
    let best: StoodRow | null = null;
    let bestD = Infinity;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const guard = guardOf(s);
      if (!(guard > 0)) continue;
      // The point in the row's own turned frame, and how far it is outside the footprint either way.
      const dx = x - s.x;
      const dz = z - s.z;
      const u = dx * s.ex + dz * s.ez;
      const v = dz * s.ex - dx * s.ez;
      const du = u < s.u0 ? s.u0 - u : u > s.u1 ? u - s.u1 : 0;
      const dv = v < s.v0 ? s.v0 - v : v > s.v1 ? v - s.v1 : 0;
      const d2 = du * du + dv * dv;
      const reach = guard + r;
      if (d2 >= reach * reach || d2 >= bestD) continue;
      bestD = d2;
      best = s;
    }
    return best;
  }

  /**
   * For the console: per layer whether it has a file and what came of it, every row with its layer, its key and
   * where it stands or why it does not, and what the reading refused. `current` says whether the world it
   * speaks of is still the one up; once it has gone, every question above answers nothing.
   */
  report(): { world: string; current: boolean; frame: PlacementFrame; kind: WorldKind; layers: Record<PlacementLayer, LayerReport>; rows: { id: string; layer: PlacementLayer; key: string; kind: string; label: string; stood: boolean; why: SkipReason | null }[]; refused: { layer: PlacementLayer; id: string; why: string }[] } {
    const blank = (): Record<SkipReason, number> => ({ badRow: 0, clash: 0, noPack: 0, noModel: 0, copies: 0, space: 0, inHand: 0, otherState: 0 });
    const layers = {} as Record<PlacementLayer, LayerReport>;
    const refused: { layer: PlacementLayer; id: string; why: string }[] = [];
    for (const layer of ['story', 'world'] as const) {
      const f = this.files[layer];
      const skipped = blank();
      if (f) {
        skipped.badRow = f.skipped.length;
        for (const s of f.skipped) refused.push({ layer, id: s.id, why: s.why });
        if (f.problem) refused.push({ layer, id: '(the file)', why: f.problem });
      }
      layers[layer] = { source: f ? 'file' : 'none', problem: f?.problem ?? null, rows: f?.rows.length ?? 0, stood: 0, skipped, unknown: f?.unknown ?? [] };
    }
    const rows: { id: string; layer: PlacementLayer; key: string; kind: string; label: string; stood: boolean; why: SkipReason | null }[] = [];
    for (const s of this.stood.values()) {
      layers[s.layer].stood++;
      rows.push({ id: s.row.id, layer: s.layer, key: s.key, kind: s.row.kind, label: s.label, stood: true, why: null });
    }
    for (const [key, s] of this.skips) {
      layers[s.layer].skipped[s.why]++;
      rows.push({ id: s.id, layer: s.layer, key, kind: s.kind, label: s.id, stood: false, why: s.why });
    }
    for (const l of ['story', 'world'] as const) for (const r of REASONS) if (!layers[l].skipped[r]) delete (layers[l].skipped as Partial<Record<SkipReason, number>>)[r];
    return { world: this.world, current: this.current(), frame: this.frame, kind: this.kind, layers, rows, refused };
  }

  /** The file a layer last read for this world, or null. */
  fileOf(layer: PlacementLayer): PlacementRead | null {
    return this.files[layer];
  }

  /** The world whose files this holds, or '' once that world has gone: `report().world` with nothing worked out. */
  get worldIn(): string {
    return this.current() ? this.world : '';
  }
}
