// People of ours in the buildings the data leaves empty.
//
// The towns' screenplays fill the cantinas, starports and capitols the emulator cared about, and leave
// most of the rest standing empty: of the civic buildings the worlds place, every bank the design
// counted, most clinics and hotels, and all but a handful of the houses have nobody in them at all. A
// building the data has put anybody in is the data's and is left exactly as it is; one it has left empty
// is given a few people of ours, as many as its kind would hold (a cantina six to ten, a bank two or
// three, a house none or one), each drawn from its own town's lists as the town's own crowd is.
//
// **Seats first.** A building's own furniture is in the snapshot, placed inside its rooms: a chair, a
// stool, a couch, a cantina's booth. Each is found in its room by where it stands, and somebody sits on
// it facing the way it faces -- the seat's own +Z, which is measured rather than guessed: of the 686
// retail seats with a table within two and a half metres on the desert world, 443 face it along +Z and
// 43 face away (Corellia 58 and 1). Then open floor, on the room's own walkable mesh, clear of the walls
// and of whatever stands in the room.
//
// **Nobody stays for ever.** Each stays a while, gets up, walks out through a door and is gone; a little
// later somebody new walks in through a door to the place left. Who stands in a building when you arrive
// is already inside, some of the way through their stay.
//
// Every number here is ours; the counts per kind are the design's (its W6). Pure: a building comes in as
// its template, its seats, its rooms' floors and a way into the world's frame, so the node test builds
// one by hand. Rule for this file (node runs it with type stripping): relative imports only as
// `import type` or with their `.ts`, no enum, no namespace, no constructor parameter properties.
import { fitsAt, heightIn, type NavFloor } from '../nav/navMesh.ts';
import { roll } from '../spawnSeed.ts';

/** The kinds of building people of ours stand in. */
export type FillKind = 'cantina' | 'starport' | 'hotel' | 'medical' | 'bank' | 'guild' | 'theater' | 'capitol' | 'association' | 'house';

/** Every number of the fillers, all of them ours; live through `__debug.ours({ tune })`. */
export const FILLER_TUNE = {
  /** How many of ours stand in an empty building of each kind, least and most (the design's numbers; D11 for a house). */
  cantina: [6, 10] as [number, number],
  starport: [3, 6] as [number, number],
  hotel: [2, 4] as [number, number],
  medical: [2, 4] as [number, number],
  bank: [2, 3] as [number, number],
  guild: [2, 4] as [number, number],
  theater: [3, 6] as [number, number],
  capitol: [3, 6] as [number, number],
  association: [2, 4] as [number, number],
  house: [0, 1] as [number, number],
  /** Seconds one stays before getting up and leaving, least and most (the design's numbers). */
  stay: [90, 300] as [number, number],
  /** Seconds after one leaves before somebody new comes in to the place left, least and most. */
  gap: [10, 40] as [number, number],
  /** Metres from a building's edge within which its people are stood, and past which they are put away. */
  build: 30,
  drop: 70,
  /** How far in front of a seat one sits down from and gets up to, metres: the seat itself is solid. */
  front: 0.7,
  /** How near that spot counts as there, metres. */
  reach: 1.3,
  /** Radians added to a seat's own forward: nought, since its +Z is measured to be the way it faces. */
  seatTurn: 0,
  /** How far a spot on open floor stands clear of the floor's edge (a wall), metres. */
  clearance: 0.5,
  /** How far apart two spots are at least, and how far a spot on open floor stands from any furnishing, metres. */
  spacing: 1.3,
  /** Square metres of walkable floor a room must have for anybody to be stood on it. */
  minArea: 6,
  /** How many draws a spot on open floor is given before the room is taken to have no more room. */
  tries: 12,
  /**
   * The empty rule's two margins, metres: the building's model box is grown by `dataGrow` before a person
   * of the data's is looked for in it (a person the converter put a hand's breadth out of their room is
   * still in it), and the data's rows are looked for within the building's radius plus `dataReach`.
   */
  dataGrow: 1,
  dataReach: 8,
};

export type FillerTune = typeof FILLER_TUNE;

/**
 * The kind of building a template is, or null for one nobody of ours stands in. A guard house and a
 * gate house are military and not homes; a shuttleport is open ground. The order matters where a name
 * says two things: a guild's theatre is a theatre.
 */
export function fillKindOf(template: string): FillKind | null {
  const t = template.toLowerCase();
  if (!t.startsWith('object/building/')) return null;
  if (/guard_house|gate_house|shuttleport/.test(t)) return null;
  if (/capitol/.test(t)) return 'capitol';
  if (/theater/.test(t)) return 'theater';
  if (/starport/.test(t)) return 'starport';
  if (/cantina/.test(t)) return 'cantina';
  if (/hotel/.test(t)) return 'hotel';
  if (/bank/.test(t)) return 'bank';
  if (/association_hall/.test(t)) return 'association';
  if (/hospital|cloning|medical/.test(t)) return 'medical';
  if (/guild_/.test(t)) return 'guild';
  if (/housing|house/.test(t)) return 'house';
  return null;
}

/**
 * Whether people of ours stand on a world at all: never on Kashyyyk or Mustafar (the owner's D13), which
 * the emulator never populated, so there is no town's list to draw a person from and nothing to be
 * faithful to.
 */
export function oursAllowedOn(world: string): boolean {
  return !!world && !/^(kashyyyk|mustafar)/.test(world);
}

/** How many of ours stand in one building of a kind, drawn from the building's own seed. */
export function fillCount(kind: FillKind, seed: number, tune: FillerTune = FILLER_TUNE): number {
  const pair = tune[kind];
  const lo = Math.min(pair[0], pair[1]);
  const hi = Math.max(pair[0], pair[1]);
  return Math.min(hi, lo + Math.floor(roll(seed, 1) * (hi - lo + 1)));
}

/** A building's own seed: its template and where it stands, rounded, which every browser has alike. */
export function buildingSeed(template: string, x: number, z: number): number {
  const key = `${template}|${Math.round(x)}|${Math.round(z)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Whether a placed object is something to sit on, by its template's own file name. */
export function isSeat(template: string): boolean {
  const name = template.slice(template.lastIndexOf('/') + 1).toLowerCase();
  return /chair|stool|couch|sofa|bench|seat/.test(name) && !/table|lamp|pilot/.test(name);
}

/**
 * The way a seat faces, as a heading (`atan2(x, z)`, a body's own convention): its local +Z turned by
 * its quaternion, which is the world's once the object is placed, plus `turn`.
 */
export function seatHeading(q: { x: number; y: number; z: number; w: number }, turn = 0): number {
  const fx = 2 * (q.x * q.z + q.w * q.y);
  const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
  return Math.atan2(fx, fz) + turn;
}

/** A model's box as its low and high corners, taken componentwise whichever corner the pack wrote first, grown by `grow`. */
export function boxOf(a: readonly number[], b: readonly number[], grow = 0): { lo: number[]; hi: number[] } {
  return {
    lo: [0, 1, 2].map((i) => Math.min(a[i], b[i]) - grow),
    hi: [0, 1, 2].map((i) => Math.max(a[i], b[i]) + grow),
  };
}

/** Whether a point in the box's own frame lies in it. */
export function insideBox(l: { x: number; y: number; z: number }, box: { lo: readonly number[]; hi: readonly number[] }): boolean {
  return l.x >= box.lo[0] && l.x <= box.hi[0] && l.y >= box.lo[1] && l.y <= box.hi[1] && l.z >= box.lo[2] && l.z <= box.hi[2];
}

/**
 * A point carried by a 4x4 matrix given as its sixteen numbers in column order (three's
 * `Matrix4.elements`), written into `out`: an affine matrix, as every placed building's is.
 */
export function throughMatrix(e: ArrayLike<number>, x: number, y: number, z: number, out: { x: number; y: number; z: number }): void {
  out.x = e[0] * x + e[4] * y + e[8] * z + e[12];
  out.y = e[1] * x + e[5] * y + e[9] * z + e[13];
  out.z = e[2] * x + e[6] * y + e[10] * z + e[14];
}

/** A place one of the data's people stands at, as the empty rule reads it: where, and whether the data stood it in a room. */
export interface DataPlace {
  x: number;
  y: number;
  z: number;
  inside: boolean;
}

/**
 * Whether one of the data's people stands in a building: stood in a room by the data (`inside`), and at
 * a place that, carried into the building's own frame (`inverse`, the world into the building's, as
 * sixteen numbers in column order), lies in the building's box. A person the data stood out in the open
 * is never in a building, however near its walls or its porch: a vendor at a cantina's door does not make
 * the cantina the data's.
 */
export function standsInside(p: DataPlace, box: { lo: readonly number[]; hi: readonly number[] }, inverse: ArrayLike<number>, scratch: { x: number; y: number; z: number }): boolean {
  if (!p.inside) return false;
  throughMatrix(inverse, p.x, p.y, p.z, scratch);
  return insideBox(scratch, box);
}

/** A building as the empty rule reads it: where it stands, how far it reaches, its model's box and the way into its own frame. */
export interface BuildingFrame {
  x: number;
  z: number;
  radius: number;
  bounds: { min: readonly number[]; max: readonly number[] };
  /** The world into the building's own frame, as a matrix's sixteen numbers in column order. */
  inverse: ArrayLike<number>;
}

/** The data's own people as the empty rule asks after them (`StandingPeople.anyStanding`). */
export interface DataPeople {
  anyStanding(x: number, z: number, reach: number, inside: (st: DataPlace) => boolean): boolean;
}

/**
 * Whether the data leaves a building empty, which is the only kind anybody of ours is stood in: nobody of
 * the data's among the rows within the building's radius and `dataReach` stands inside it (`standsInside`,
 * over the model's box grown by `dataGrow`, read whichever corner the pack wrote first). The rule that says
 * a building is the data's and is left exactly as it is.
 */
export function leftEmpty(b: BuildingFrame, people: DataPeople, tune: FillerTune = FILLER_TUNE): boolean {
  const box = boxOf(b.bounds.min, b.bounds.max, tune.dataGrow);
  const scratch = { x: 0, y: 0, z: 0 };
  return !people.anyStanding(b.x, b.z, b.radius + tune.dataReach, (st) => standsInside(st, box, b.inverse, scratch));
}

/** A placed object in or near a building, as the furnishing reads it. */
export interface Furnishing {
  x: number;
  y: number;
  z: number;
  template: string;
  q: { x: number; y: number; z: number; w: number };
}

/**
 * A building's furniture, read out of the placed objects near it: every one standing in one of its rooms
 * (`cellOf` answers the room, 0 for none) is something an open-floor spot keeps clear of (`avoid`), and
 * every seat among them (`isSeat`) in a room that is not a lift shaft (`shafts`) is a seat somebody may
 * sit on, facing its own +Z turned by `turn` (`seatHeading`). Written into the two lists, which are
 * emptied first.
 */
export function furnish(
  objects: readonly Furnishing[],
  cellOf: (o: Furnishing) => number,
  shafts: ReadonlySet<number>,
  turn: number,
  seats: SeatCandidate[],
  avoid: { x: number; z: number }[],
): void {
  seats.length = 0;
  avoid.length = 0;
  for (const o of objects) {
    const cell = cellOf(o);
    if (cell <= 0) continue;
    avoid.push({ x: o.x, z: o.z });
    if (shafts.has(cell) || !isSeat(o.template)) continue;
    seats.push({ x: o.x, y: o.y, z: o.z, heading: seatHeading(o.q, turn), cell });
  }
}

/** A seat found in a room, in the world's frame. */
export interface SeatCandidate {
  x: number;
  y: number;
  z: number;
  heading: number;
  cell: number;
}

/** A room's walkable floor as the planning reads it, and how to carry a point of it into the world. */
export interface FloorRoom {
  cell: number;
  floor: NavFloor;
  /** A point in the building's own frame into the world's, written into `out`. */
  toWorld(x: number, y: number, z: number, out: { x: number; y: number; z: number }): void;
}

/** Where one of ours stands in a building, in the world's frame. */
export interface FillSpot {
  x: number;
  y: number;
  z: number;
  /** The way it faces while it is there. */
  heading: number;
  cell: number;
  /** A seat: it sits there, and walks to and from the spot `front` metres in front of it. */
  seat: boolean;
  frontX: number;
  frontZ: number;
}

/** How big each triangle of a floor is, flat, as a running total: the draw of a point weights by it. */
export function floorAreas(floor: NavFloor): Float64Array {
  const out = new Float64Array(floor.count);
  const v = floor.verts;
  let total = 0;
  for (let t = 0; t < floor.count; t++) {
    const a = floor.tris[t * 3] * 3;
    const b = floor.tris[t * 3 + 1] * 3;
    const c = floor.tris[t * 3 + 2] * 3;
    total += Math.abs((v[b] - v[a]) * (v[c + 2] - v[a + 2]) - (v[c] - v[a]) * (v[b + 2] - v[a + 2])) / 2;
    out[t] = total;
  }
  return out;
}

/** A point on a floor by three draws: a triangle weighted by its size, then a point evenly inside it. Null for a floor with no area. */
export function floorPoint(floor: NavFloor, areas: Float64Array, u1: number, u2: number, u3: number): { x: number; y: number; z: number } | null {
  const total = areas.length ? areas[areas.length - 1] : 0;
  if (!(total > 0)) return null;
  const want = u1 * total;
  let t = 0;
  while (t < areas.length - 1 && areas[t] < want) t++;
  let s = u2;
  let r = u3;
  if (s + r > 1) {
    s = 1 - s;
    r = 1 - r;
  }
  const v = floor.verts;
  const a = floor.tris[t * 3] * 3;
  const b = floor.tris[t * 3 + 1] * 3;
  const c = floor.tris[t * 3 + 2] * 3;
  const x = v[a] + s * (v[b] - v[a]) + r * (v[c] - v[a]);
  const z = v[a + 2] + s * (v[b + 2] - v[a + 2]) + r * (v[c + 2] - v[a + 2]);
  return { x, y: heightIn(floor, t, x, z), z };
}

/**
 * Where a building's people of ours stand: up to `count` places, the seats first -- in an order drawn
 * from the building's seed, so which seats are taken is the same in every browser -- and then open floor,
 * a room drawn by how much floor it has and a point in it clear of the walls (`clearance`), of every other
 * place and of whatever furnishes the room (`avoid`, the room's placed objects, seats included). A room
 * with less than `minArea` of floor is passed over. Fewer than `count` where the building has no more
 * room. Pure: the seats, the rooms and the furnishings come in, and nothing is asked of the world.
 */
export function planSpots(seats: readonly SeatCandidate[], rooms: readonly FloorRoom[], avoid: readonly { x: number; z: number }[], count: number, seed: number, tune: FillerTune = FILLER_TUNE): FillSpot[] {
  const out: FillSpot[] = [];
  if (count <= 0) return out;
  const far = (x: number, z: number, list: readonly { x: number; z: number }[], d: number): boolean => {
    for (const p of list) if (Math.hypot(p.x - x, p.z - z) < d) return false;
    return true;
  };
  // The seats in a drawn order.
  const order = seats.map((s, i) => ({ s, key: roll(seed, 1000 + i) })).sort((a, b) => a.key - b.key);
  for (const { s } of order) {
    if (out.length >= count) break;
    if (!far(s.x, s.z, out, tune.spacing * 0.5)) continue;
    const h = s.heading;
    out.push({ x: s.x, y: s.y, z: s.z, heading: h, cell: s.cell, seat: true, frontX: s.x + Math.sin(h) * tune.front, frontZ: s.z + Math.cos(h) * tune.front });
  }
  if (out.length >= count) return out;
  // Then open floor, a room at a time by its share of the building's floor.
  const usable = rooms.map((r) => ({ r, areas: floorAreas(r.floor) })).filter((x) => x.areas.length && x.areas[x.areas.length - 1] >= tune.minArea);
  const total = usable.reduce((a, x) => a + x.areas[x.areas.length - 1], 0);
  if (!(total > 0)) return out;
  const w = { x: 0, y: 0, z: 0 };
  let k = 0;
  for (let n = out.length; n < count; n++) {
    let placed = false;
    for (let attempt = 0; attempt < tune.tries && !placed; attempt++, k++) {
      let pick = roll(seed, 2000 + k * 5) * total;
      let room = usable[usable.length - 1];
      for (const u of usable) {
        const a = u.areas[u.areas.length - 1];
        if (pick < a) {
          room = u;
          break;
        }
        pick -= a;
      }
      const p = floorPoint(room.r.floor, room.areas, roll(seed, 2000 + k * 5 + 1), roll(seed, 2000 + k * 5 + 2), roll(seed, 2000 + k * 5 + 3));
      if (!p || !fitsAt(room.r.floor, p.x, p.y, p.z, tune.clearance)) continue;
      room.r.toWorld(p.x, p.y, p.z, w);
      if (!far(w.x, w.z, out, tune.spacing) || !far(w.x, w.z, avoid, tune.spacing)) continue;
      const heading = roll(seed, 2000 + k * 5 + 4) * Math.PI * 2 - Math.PI;
      out.push({ x: w.x, y: w.y, z: w.z, heading, cell: room.r.cell, seat: false, frontX: w.x, frontZ: w.z });
      placed = true;
    }
    if (!placed) break;
  }
  return out;
}

/**
 * One place in a building and who is in it: nobody (`empty`, until `nextAt`), somebody walking in to
 * it, somebody there (until `leaveAt`), or somebody walking out. `life` counts the people it has had,
 * and every draw a place makes is drawn from its seed and its life, so the same building is the same
 * in every browser.
 */
export type SlotState = 'empty' | 'entering' | 'staying' | 'leaving';

export interface FillSlot {
  state: SlotState;
  life: number;
  nextAt: number;
  leaveAt: number;
}

/** A draw of a place's own, for its life and question. */
export function slotDraw(seed: number, slot: number, life: number, what: number): number {
  return roll(seed, 10000 + slot * 4096 + (life & 1023) * 4 + what);
}

function span(pair: readonly [number, number], u: number): number {
  return Math.min(pair[0], pair[1]) + u * Math.abs(pair[1] - pair[0]);
}

/**
 * A place as it stands when its building is first met: somebody in it, some of the way through their
 * stay, so a room walked into is a room people have been in for a while rather than one everybody is
 * about to leave at once.
 */
export function openSlot(slot: FillSlot, now: number, seed: number, index: number, tune: FillerTune = FILLER_TUNE): void {
  slot.state = 'staying';
  slot.life = 0;
  slot.nextAt = 0;
  slot.leaveAt = now + span(tune.stay, slotDraw(seed, index, 0, 0)) * slotDraw(seed, index, 0, 1);
}

/**
 * One step of a place: somebody new comes in once its wait is out, sits or stands once they get there,
 * gets up once their stay is out, and is gone once they are out of the building, when the place waits
 * for the next. `arrived` says the one walking in has got there, `out` that the one leaving is out.
 * Answers the state it is in now.
 */
export function stepSlot(slot: FillSlot, now: number, arrived: boolean, out: boolean, seed: number, index: number, tune: FillerTune = FILLER_TUNE): SlotState {
  switch (slot.state) {
    case 'empty':
      if (now >= slot.nextAt) slot.state = 'entering';
      break;
    case 'entering':
      if (arrived) {
        slot.state = 'staying';
        slot.leaveAt = now + span(tune.stay, slotDraw(seed, index, slot.life, 0));
      }
      break;
    case 'staying':
      if (now >= slot.leaveAt) slot.state = 'leaving';
      break;
    case 'leaving':
      if (out) leaveSlot(slot, now, seed, index, tune);
      break;
  }
  return slot.state;
}

/** A place left, by whatever way its person went: empty until somebody new comes, which is the next life. */
export function leaveSlot(slot: FillSlot, now: number, seed: number, index: number, tune: FillerTune = FILLER_TUNE): void {
  slot.state = 'empty';
  slot.life++;
  slot.nextAt = now + span(tune.gap, slotDraw(seed, index, slot.life, 2));
}
