// The space map's layers: what a zone's pack says is out there, turned into the marks the map draws;
// the view's own follow-and-turn state; and the small pools that keep a drawn frame free of new
// objects. Pure: no three, no DOM, no import.meta.env, so the node test drives every line of it.
//
// A pack's coordinates are the client's (X not mirrored), as `spaceData.ts` says, and the map draws in
// the game's frame, so X is mirrored here exactly as the streamer mirrors what it places. Anything the
// converter has already mirrored is written as `at` instead of x, y and z, and is taken as it stands:
// that is the one contract this module has with the pack, and it lets a nebula table that is mirrored
// on the way out and a station table that is not live side by side in one file.
//
// Everything here reads a pack loosely, so a pack converted before fields, nebulae and lanes existed
// simply gives those layers nothing. Nothing in this file knows a zone's name or any of the game's
// numbers; the test's data is all made up.

/** The map's switchable layers, in the order their boxes are shown. */
export type LayerId = 'stations' | 'points' | 'launch' | 'fields' | 'nebulae' | 'ships';

/** Each layer's box, and the zone-map icon the client drew it with (`space_ui/<icon>.png` in the packs). */
export const LAYERS: readonly { id: LayerId; label: string; icon: string }[] = [
  { id: 'stations', label: 'Stations', icon: 'zone_spacestation' },
  { id: 'points', label: 'Hyperspace', icon: 'zone_hyperspace' },
  { id: 'launch', label: 'Launch point', icon: 'zone_waypoint' },
  { id: 'fields', label: 'Asteroid fields', icon: 'zone_asteroids' },
  { id: 'nebulae', label: 'Nebulae', icon: 'zone_nebula' },
  { id: 'ships', label: 'Ships', icon: 'zone_ship' },
];

/** One thing the map shows and can name, in the GAME frame (metres). */
export interface MapMark {
  layer: LayerId;
  /** `<layer>:<id>`, the same every frame while the zone is loaded. */
  key: string;
  /** What the System Map would call this place (`<zone>:<id>`), or null when it cannot be jumped to. */
  destination: string | null;
  name: string;
  description: string;
  x: number;
  y: number;
  z: number;
  /** Metres: a station's or a field's or a nebula's size; 0 for a point. */
  radius: number;
  /** A nebula's own colour as r, g, b in 0..1; null for everything else. */
  colour: [number, number, number] | null;
  /** A field that runs along a spline: its control points, GAME frame; null for a round one. */
  spline: [number, number, number][] | null;
  /** How many docking lanes the pack gives the model this is drawn with; 0 where it gives none. */
  lanes: number;
  /** Made up by us rather than read from the client's files. */
  invented: boolean;
}

// ---- What the map needs of a pack. Everything is optional: an older pack gives empty layers. ----

interface PackPlace {
  x?: number;
  y?: number;
  z?: number;
  /** Already in the game's frame (the converter mirrored it); used in place of x, y, z. */
  at?: number[];
}

export interface MapPack {
  zone?: string;
  stations?: (PackPlace & { name?: string | null; title?: string; description?: string; radius?: number; model?: string })[];
  scenery?: (PackPlace & { name?: string | null; radius?: number; model?: string; invented?: boolean })[];
  hyperspace?: { points?: (PackPlace & { id?: string; name?: string; description?: string; source?: string })[] } | null;
  arrival?: (PackPlace & { kind?: string; planet?: string }) | null;
  /** Every asteroid field's centre, radius and spline; nothing on a pack converted before them. */
  fields?: (PackPlace & { name?: string | null; radius?: number; kind?: string; spline?: number[][]; invented?: boolean })[];
  /** Every nebula's centre, radius and colours; nothing on a pack converted before them. */
  nebulae?: (PackPlace & {
    name?: string | null;
    radius?: number;
    density?: number;
    facing?: { colour?: number[] } | null;
    colour?: number[];
  })[];
  /** The docking lanes each model has, so a station can say how many it offers. */
  lanes?: Record<string, { lanes?: unknown[] }>;
}

/** A client-frame position in the game's frame (never a negative zero), or an `at` taken as it stands. */
function place(p: PackPlace): { x: number; y: number; z: number } {
  if (Array.isArray(p.at) && p.at.length >= 3) return { x: Number(p.at[0]) || 0, y: Number(p.at[1]) || 0, z: Number(p.at[2]) || 0 };
  const x = Number(p.x) || 0;
  return { x: x === 0 ? 0 : -x, y: Number(p.y) || 0, z: Number(p.z) || 0 };
}

/**
 * A colour as r, g, b in 0..1 from whatever the pack holds: the table's four numbers (alpha first, as
 * the nebula table stores them), three numbers, or a named object. Null when there is nothing to read.
 */
export function rgbOf(v: unknown): [number, number, number] | null {
  if (Array.isArray(v)) {
    const n = v.map((x) => Number(x) || 0);
    if (n.length >= 4) return [n[1], n[2], n[3]];
    if (n.length === 3) return [n[0], n[1], n[2]];
    return null;
  }
  if (v && typeof v === 'object') {
    const o = v as { r?: number; g?: number; b?: number };
    if (typeof o.r === 'number') return [o.r, Number(o.g) || 0, Number(o.b) || 0];
  }
  return null;
}

/** A name made from an internal id when the files give none ("pirate_add" becomes "Pirate add"). */
export function labelFrom(id: string): string {
  const words = id.replace(/[_\-]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'unnamed';
}

/** A distance for the readout: metres under a kilometre, kilometres over it. */
export function distanceText(metres: number): string {
  if (!Number.isFinite(metres)) return '';
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(metres < 10000 ? 1 : 0)} km`;
}

/**
 * A field that runs along a spline is drawn as the belt itself and nothing else: the table's Radius
 * is the tube's thickness rather than a bounding sphere, so a shell of it at the centre would be a
 * small ball at one end of a long belt.
 */
export function drawnAsLine(mk: MapMark): boolean {
  return mk.layer === 'fields' && !!mk.spline && mk.spline.length > 1;
}

/** A round field and every nebula are drawn as a faint shell at their own radius. */
export function drawnAsShell(mk: MapMark): boolean {
  return (mk.layer === 'fields' || mk.layer === 'nebulae') && !drawnAsLine(mk);
}

/** Whether any mark belongs to a layer: the map falls back to the placed hulls while no station does. */
export function hasLayer(marks: readonly MapMark[], layer: LayerId): boolean {
  for (const mk of marks) if (mk.layer === layer) return true;
  return false;
}

/**
 * How many of each drawn thing a zone's marks want, so the pools can be grown to it before the first
 * frame draws them rather than by the frame that wants one more. Every layer is counted, whether it
 * is switched on or not, since switching one on must not be the thing that makes a mesh.
 */
export function poolWants(marks: readonly MapMark[], labelCap: number): { marks: number; shells: number; splines: number; labels: number } {
  let m = 0;
  let shells = 0;
  let splines = 0;
  for (const mk of marks) {
    if (drawnAsLine(mk)) splines++;
    else if (drawnAsShell(mk)) shells++;
    else m++;
  }
  return { marks: m, shells, splines, labels: Math.min(labelCap, marks.length) };
}

/**
 * Every mark a zone's pack gives, in the order the layers are listed. The zone's own name is only used
 * to make the System Map's keys; a pack without one makes none, and nothing can be jumped to from the map.
 */
export function marksOf(pack: MapPack | null | undefined): MapMark[] {
  const out: MapMark[] = [];
  if (!pack) return out;
  const zone = typeof pack.zone === 'string' ? pack.zone : '';
  const lanesOf = (model: string | undefined): number => {
    const m = model ? pack.lanes?.[model] : undefined;
    return Array.isArray(m?.lanes) ? m.lanes.length : 0;
  };
  for (const [i, s] of (pack.stations ?? []).entries()) {
    const id = String(s.name ?? '');
    const p = place(s);
    out.push({
      layer: 'stations',
      key: `stations:${id || i}`,
      destination: zone && id ? `${zone}:${id}` : null,
      name: s.title && s.title !== s.name ? s.title : labelFrom(id),
      description: s.description ?? '',
      x: p.x,
      y: p.y,
      z: p.z,
      radius: Number(s.radius) || 0,
      colour: null,
      spline: null,
      lanes: lanesOf(s.model),
      invented: false,
    });
  }
  // The zone's big scenery (a capital ship parked in it) rides the stations layer: it is the other
  // thing out there worth a name, and it is never somewhere a jump can end.
  for (const [i, s] of (pack.scenery ?? []).entries()) {
    const id = String(s.name ?? '');
    const p = place(s);
    out.push({
      layer: 'stations',
      key: `scenery:${id || i}`,
      destination: null,
      name: labelFrom(id),
      description: '',
      x: p.x,
      y: p.y,
      z: p.z,
      radius: Number(s.radius) || 0,
      colour: null,
      spline: null,
      lanes: lanesOf(s.model),
      invented: s.invented === true,
    });
  }
  for (const [i, h] of (pack.hyperspace?.points ?? []).entries()) {
    const id = String(h.id ?? '');
    const p = place(h);
    out.push({
      layer: 'points',
      key: `points:${id || i}`,
      destination: zone && id ? `${zone}:${id}` : null,
      name: h.name || labelFrom(id),
      description: h.description ?? '',
      x: p.x,
      y: p.y,
      z: p.z,
      radius: 0,
      colour: null,
      spline: null,
      lanes: 0,
      invented: h.source === 'invented',
    });
  }
  const a = pack.arrival;
  if (a && a.kind === 'launch') {
    const p = place(a);
    out.push({
      layer: 'launch',
      key: 'launch:launch',
      destination: zone ? `${zone}:launch` : null,
      name: 'Launch point',
      description: 'Where a ship climbing out of the planet’s sky comes out.',
      x: p.x,
      y: p.y,
      z: p.z,
      radius: 0,
      colour: null,
      spline: null,
      lanes: 0,
      invented: false,
    });
  }
  for (const [i, f] of (pack.fields ?? []).entries()) {
    const id = String(f.name ?? '');
    const p = place(f);
    const raw = Array.isArray(f.spline) ? f.spline : null;
    // A spline's control points are in the same frame as the field's own centre.
    const mirror = !(Array.isArray(f.at) && f.at.length >= 3);
    const spline = raw && raw.length > 1
      ? raw.map((c) => {
        const x = Number(c[0]) || 0;
        return [mirror && x !== 0 ? -x : x, Number(c[1]) || 0, Number(c[2]) || 0] as [number, number, number];
      })
      : null;
    out.push({
      layer: 'fields',
      key: `fields:${id || i}`,
      destination: null,
      // The field table's Name column is filled on 70 of the 214 retail rows, but it is a designer's
    // note as often as a label ("old tie patrol route attacked so much by nym that its no longer
    // used"), so a field is named for its place here and the pack's `name` is left to a reader who
    // wants the note.
      name: id ? labelFrom(id) : 'asteroid field',
      description: '',
      x: p.x,
      y: p.y,
      z: p.z,
      radius: Number(f.radius) || 0,
      colour: null,
      spline,
      lanes: 0,
      invented: f.invented === true,
    });
  }
  for (const [i, n] of (pack.nebulae ?? []).entries()) {
    const id = String(n.name ?? '');
    const p = place(n);
    out.push({
      layer: 'nebulae',
      key: `nebulae:${id || i}`,
      destination: null,
      name: id ? labelFrom(id) : 'nebula',
      description: '',
      x: p.x,
      y: p.y,
      z: p.z,
      radius: Number(n.radius) || 0,
      colour: rgbOf(n.facing?.colour) ?? rgbOf(n.colour),
      spline: null,
      lanes: 0,
      invented: false,
    });
  }
  return out;
}

// ---- The view: what it looks at, and whether it follows the ship. ----

/**
 * Invented: how the space map's mouse feels. Every number here is ours, and live through
 * `__debug.spaceMap({ turnPerPixel, zoomStep, distanceMin, distanceMax, pitchLimit })`.
 */
export const VIEW_TUNE = {
  /** Radians the view turns per pixel dragged. */
  turnPerPixel: 0.006,
  /** What one wheel notch multiplies the distance by. */
  zoomStep: 1.15,
  distanceMin: 60,
  distanceMax: 30000,
  /** How far up or down the view may be tipped, radians. */
  pitchLimit: 1.4,
  /**
   * How far the view sees, metres. The zones' nebulae reach about 17 km from the middle and are up
   * to 6 km across, so a fully zoomed-out view must reach well past `distanceMax` or the far side of
   * one is cut away.
   */
  far: 120000,
};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Where the space map looks, and whether it follows the ship. This is the flag the 2D map's own
 * "has been centred" used to share, which is why every slide of the view was undone on the next frame:
 * the two now live apart, and only `followShip` puts this one back on.
 */
export class MapView {
  follow = true;
  readonly target = { x: 0, y: 0, z: 0 };
  readonly orbit = { yaw: 0.6, pitch: 0.5, distance: 2500 };

  /** Opening the map, F, and the Follow button. */
  followShip(): void {
    this.follow = true;
  }

  /** Left-drag: turning never stops the view following. */
  turn(dx: number, dy: number): void {
    this.orbit.yaw -= dx * VIEW_TUNE.turnPerPixel;
    this.orbit.pitch = clamp(this.orbit.pitch + dy * VIEW_TUNE.turnPerPixel, -VIEW_TUNE.pitchLimit, VIEW_TUNE.pitchLimit);
  }

  /**
   * Right- or middle-drag: the point looked at slides across the screen and the view stops following.
   * `perPixel` is metres per screen pixel at the distance looked at; the two axes are the camera's own
   * right and up, handed in so that nothing here needs three.
   */
  pan(dx: number, dy: number, perPixel: number, rx: number, ry: number, rz: number, ux: number, uy: number, uz: number): void {
    this.target.x += (-dx * rx + dy * ux) * perPixel;
    this.target.y += (-dx * ry + dy * uy) * perPixel;
    this.target.z += (-dx * rz + dy * uz) * perPixel;
    this.follow = false;
  }

  /** The wheel, while following: the distance alone changes and the ship stays in the middle. */
  zoom(steps: number): void {
    const f = Math.pow(VIEW_TUNE.zoomStep, steps);
    this.orbit.distance = clamp(this.orbit.distance * f, VIEW_TUNE.distanceMin, VIEW_TUNE.distanceMax);
  }

  /**
   * The wheel over a point (the one under the cursor), while the view is free: the distance changes and
   * the point looked at moves toward or away from that point by the same share, so what is under the
   * cursor stays under it.
   */
  zoomToward(steps: number, px: number, py: number, pz: number): void {
    const before = this.orbit.distance;
    this.zoom(steps);
    const k = this.orbit.distance / before;
    this.target.x = px + (this.target.x - px) * k;
    this.target.y = py + (this.target.y - py) * k;
    this.target.z = pz + (this.target.z - pz) * k;
  }

  /** Double-clicking a mark: the view centres on it and stops following. */
  centreOn(x: number, y: number, z: number): void {
    this.target.x = x;
    this.target.y = y;
    this.target.z = z;
    this.follow = false;
  }

  /** Each frame, before the camera is placed: the ship's own place, taken only while following. */
  frameShip(x: number, y: number, z: number): void {
    if (!this.follow) return;
    this.target.x = x;
    this.target.y = y;
    this.target.z = z;
  }
}

// ---- Pools: everything the map draws is made once and moved, never made again. ----

/**
 * A fixed set of drawn things reused every frame. `begin`, then one `take` per thing wanted, then
 * `end`, which hides the ones nothing took. `made` only rises while the frame wants more than any
 * frame before it, which is what the test watches.
 */
export class Pool<T> {
  readonly items: T[] = [];
  made = 0;
  private n = 0;
  private readonly make: () => T;
  private readonly show: (item: T, on: boolean) => void;

  constructor(make: () => T, show: (item: T, on: boolean) => void) {
    this.make = make;
    this.show = show;
  }

  begin(): void {
    this.n = 0;
  }

  /**
   * Make up to `n` items now, hidden and unused, so that no drawn frame is the first to want one.
   * Growing a pool builds a material (and with it, the first time it is drawn, a program), which is
   * work that belongs with reading a zone rather than with a frame of it.
   */
  grow(n: number): void {
    while (this.items.length < n) {
      const item = this.make();
      this.show(item, false);
      this.items.push(item);
      this.made++;
    }
  }

  take(): T {
    if (this.n === this.items.length) {
      this.items.push(this.make());
      this.made++;
    }
    const item = this.items[this.n++];
    this.show(item, true);
    return item;
  }

  end(): void {
    for (let i = this.n; i < this.items.length; i++) this.show(this.items[i], false);
  }

  get used(): number {
    return this.n;
  }
}

/** One ship on the map, filled in place by the game each frame. */
export interface ShipMark {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  mine: boolean;
  label: string;
}

/**
 * The ships the map draws, written straight into entries the map owns: the game fills this instead of
 * building an array and a quaternion per ship per frame.
 */
export class ShipList {
  readonly items: ShipMark[] = [];
  made = 0;
  private n = 0;

  begin(): void {
    this.n = 0;
  }

  add(x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number, mine: boolean, label: string): void {
    if (this.n === this.items.length) {
      this.items.push({ x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, mine: false, label: '' });
      this.made++;
    }
    const s = this.items[this.n++];
    s.x = x;
    s.y = y;
    s.z = z;
    s.qx = qx;
    s.qy = qy;
    s.qz = qz;
    s.qw = qw;
    s.mine = mine;
    s.label = label;
  }

  get length(): number {
    return this.n;
  }

  /** The player's own mark, or null while they have none (a zone with nothing of theirs in it). */
  get mine(): ShipMark | null {
    for (let i = 0; i < this.n; i++) if (this.items[i].mine) return this.items[i];
    return null;
  }
}

/** One placed thing in the zone (a rock, or a station's hull), filled in place. */
export interface ObjectMark {
  x: number;
  y: number;
  z: number;
  radius: number;
  station: boolean;
}

/** The zone's placed objects, written into entries the map owns. Read once per zone, not per frame. */
export class ObjectList {
  readonly items: ObjectMark[] = [];
  private n = 0;

  begin(): void {
    this.n = 0;
  }

  add(x: number, y: number, z: number, radius: number, station: boolean): void {
    if (this.n === this.items.length) this.items.push({ x: 0, y: 0, z: 0, radius: 0, station: false });
    const o = this.items[this.n++];
    o.x = x;
    o.y = y;
    o.z = z;
    o.radius = radius;
    o.station = station;
  }

  get length(): number {
    return this.n;
  }
}
