// Chairs and tables of ours, under the people the data sits down.
//
// A town's screenplay seats its people -- `npc_sitting_chair`, `npc_sitting_table`, the eating one -- and
// the live game's server stood the furniture they sat on. That furniture never shipped: Mos Eisley's
// cantina places some twenty-five objects in its back and private rooms and nothing at all in the main
// room or its alcoves, the buildout tables have none, and the emulator places none either, so fourteen
// patrons of that room sat on the air. Their rows are the best evidence there is of where the chairs
// stood, and every number of the placement is read off them: a chair under each one sitting, at its own
// place and facing its own way (a chair's +Z is the way it faces, measured in `ambient/fillers.ts`, and
// the one patron of that cantina who does sit on a real chair is a tenth of a metre from it), and a table
// in front of each one sat at a table, those whose tables would stand within `share` of one another
// sharing one. **All of it is ours**, inferred from the rows rather than read from anything, and so is
// every number below; only the models are the game's -- Tatooine's own cantina chairs and tables, for
// every cantina on every world, until something better turns up.
//
// Only where the data sits somebody down: a room with nobody seated in it is left as it is. And never
// over what the data already has: a seat of the snapshot's under a sitter, or a table of its beside a
// table's spot, stands for ours (of the 75 chair rows over the ten worlds, 29 had no seat within 0.9 m;
// of the 17 table rows, 14 had no table within 1.6 m).
//
// Pure: rows in, places out, the world asked through two callbacks. Rule for this file (node runs it with
// type stripping): relative imports only as `import type` or with their `.ts`, no enum, no namespace, no
// constructor parameter properties.

/** What a sitting row sits on. */
export type SeatKind = 'chair' | 'table';

/**
 * Every number of the seats, all of them ours; live through `__debug.seats({ tune })`, which stands them
 * all again. The models are the props pack's (and Tatooine's own pack's) copies of the game's cantina
 * furniture: its two single chairs (the second of its three is a bench for two) and its three tables.
 */
export const SEAT_TUNE = {
  /** Whether any are stood at all. */
  on: true,
  /** Whether a row sat out in the open (a town's trainers, its idlers) gets one too, on the ground under it. */
  outdoors: true,
  chairs: ['thm_frn_chair_s01', 'thm_frn_chair_s03'] as string[],
  tables: ['thm_frn_table_s01', 'thm_frn_table_s02', 'thm_frn_table_s03'] as string[],
  /** Metres from a table sitter to the middle of the table in front of it: past the knees, under the arms. */
  ahead: 0.85,
  /** Metres within which two tables' spots are one table, and a chair sitter's spot joins a table. */
  share: 1.5,
  /** A seat of the data's this near a sitter, in metres, is the one it sits on, and none of ours is stood. */
  seatNear: 0.9,
  /** A table of the data's this near a table's middle, in metres, is that table. */
  tableNear: 1.6,
  /** How far above or below counts as the same floor, metres: a cantina's balcony is not its bar. */
  level: 1.2,
  /** Radians added to a chair's facing; nought, since a chair's +Z is the way it faces. */
  seatTurn: 0,
};

export type SeatTune = typeof SEAT_TUNE;

/** The seat a mood sits on: a chair, a chair at a table, or none (sitting on the ground, standing). */
export function seatOfMood(mood: string | null | undefined): SeatKind | null {
  if (!mood) return null;
  if (/^npc_sitting_table/.test(mood)) return 'table';
  if (/^npc_sitting_chair/.test(mood)) return 'chair';
  return null;
}

/** One row somebody sits at, in the world's frame: where the body is stood, the way it faces and what it sits on. */
export interface SeatedRow {
  /** The row's own key, the same in every browser and every run (pack format 2). */
  key: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  inside: boolean;
  sits: SeatKind;
}

/** A chair or a table of ours, in the world's frame, ready to be stood. */
export interface SeatProp {
  /** Its own name: the row's key for a chair, the first sitter's for a table. */
  key: string;
  kind: SeatKind;
  model: string;
  x: number;
  y: number;
  z: number;
  /** Its turn about up, radians, a body's own convention (`atan2(x, z)`). */
  yaw: number;
  inside: boolean;
}

/** What the planning asks of the world: whether the data already has one near, and the ground's height out in the open. */
export interface SeatWorld {
  /** Whether a seat (`kind` chair) or a table of the data's stands within `reach` of a point on the same floor. */
  has(kind: SeatKind, x: number, y: number, z: number, reach: number, level: number): boolean;
  ground(x: number, z: number): number;
}

/** What a plan came to, for the console: the props, and how many the data already had. */
export interface SeatPlan {
  props: SeatProp[];
  /** Sitters whose own seat the data already has, and tables the data already has. */
  had: { chairs: number; tables: number };
  /** Tables shared by more than one sitter. */
  shared: number;
}

/** One of a list, by a key: the same in every browser for the same key. */
export function pickBy<T>(list: readonly T[], key: string): T {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return list[(h >>> 0) % list.length];
}

/** Whether a placed object's template is a table to sit at: its own file name says so, and a lamp on one is not one. */
export function isTableTemplate(template: string): boolean {
  const name = template.slice(template.lastIndexOf('/') + 1).toLowerCase();
  return /table|tbl/.test(name) && !/lamp|holo|terminal/.test(name);
}

interface TableSpot {
  x: number;
  y: number;
  z: number;
  inside: boolean;
  /** The sitters it gathers, the first of whom names it. */
  keys: string[];
  /** The sum of the spots it was made from, so its middle is their mean. */
  sx: number;
  sz: number;
  n: number;
}

/**
 * The chairs and tables of ours for a world's sitting rows. A chair under every sitter, at its place and
 * facing its way, unless the data has a seat within `seatNear`; a table in front of every one sat at a
 * table, at `ahead`, the spots within `share` of one another one table at their mean, and every chair
 * sitter whose own spot falls within `share` of that table drawing it to them too -- a group round one
 * table is two at it and three in chairs, and the table stands where they all face; and none where the
 * data has a table within `tableNear`. The rows are taken in their keys' order, so the same rows make the
 * same plan whatever order a pack wrote them in. Indoors a prop stands on the row's own floor; out in the
 * open on the ground under it.
 */
export function planSeats(rows: readonly SeatedRow[], world: SeatWorld, tune: SeatTune = SEAT_TUNE): SeatPlan {
  const plan: SeatPlan = { props: [], had: { chairs: 0, tables: 0 }, shared: 0 };
  if (!tune.on || !tune.chairs.length) return plan;
  const sitting = rows.filter((r) => (r.inside || tune.outdoors) && Number.isFinite(r.x) && Number.isFinite(r.z) && Number.isFinite(r.heading)).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const floorOf = (r: { x: number; y: number; z: number; inside: boolean }): number => (r.inside ? r.y : world.ground(r.x, r.z));
  for (const r of sitting) {
    const y = floorOf(r);
    if (world.has('chair', r.x, y, r.z, tune.seatNear, tune.level)) {
      plan.had.chairs++;
      continue;
    }
    plan.props.push({ key: r.key, kind: 'chair', model: pickBy(tune.chairs, r.key), x: r.x, y, z: r.z, yaw: r.heading + tune.seatTurn, inside: r.inside });
  }
  if (!tune.tables.length) return plan;
  // The tables: a spot in front of each one sat at a table, the near ones one table.
  const spots: TableSpot[] = [];
  const near = (s: TableSpot, x: number, y: number, z: number, inside: boolean): boolean => s.inside === inside && Math.abs(s.y - y) <= tune.level && Math.hypot(s.x - x, s.z - z) <= tune.share;
  for (const r of sitting) {
    if (r.sits !== 'table') continue;
    const x = r.x + Math.sin(r.heading) * tune.ahead;
    const z = r.z + Math.cos(r.heading) * tune.ahead;
    const y = floorOf(r);
    const s = spots.find((t) => near(t, x, y, z, r.inside));
    if (s) {
      s.keys.push(r.key);
      s.sx += x;
      s.sz += z;
      s.n++;
      s.x = s.sx / s.n;
      s.z = s.sz / s.n;
    } else spots.push({ x, y, z, inside: r.inside, keys: [r.key], sx: x, sz: z, n: 1 });
  }
  // Those in chairs round it draw it toward where they face too, once, so a table with one at it and three
  // round it in chairs stands in the middle of all four rather than in front of the one.
  for (const s of spots) {
    const cx = s.x;
    const cz = s.z;
    for (const r of sitting) {
      if (r.sits !== 'chair') continue;
      const x = r.x + Math.sin(r.heading) * tune.ahead;
      const z = r.z + Math.cos(r.heading) * tune.ahead;
      if (s.inside !== r.inside || Math.abs(floorOf(r) - s.y) > tune.level || Math.hypot(x - cx, z - cz) > tune.share) continue;
      s.keys.push(r.key);
      s.sx += x;
      s.sz += z;
      s.n++;
    }
    s.x = s.sx / s.n;
    s.z = s.sz / s.n;
  }
  for (const s of spots) {
    if (world.has('table', s.x, s.y, s.z, tune.tableNear, tune.level)) {
      plan.had.tables++;
      continue;
    }
    if (s.keys.length > 1) plan.shared++;
    const key = `table:${s.keys[0]}`;
    plan.props.push({ key, kind: 'table', model: pickBy(tune.tables, key), x: s.x, y: s.y, z: s.z, yaw: pickBy([0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4], key), inside: s.inside });
  }
  return plan;
}

/**
 * Move any of `SEAT_TUNE`, live; answers which it moved. A number, a switch or a list of model names is
 * only ever replaced by one of its own kind (a list by a list of names that is not empty), so a typo in
 * the console cannot turn the reach into a word or leave a world with no model to draw a chair with.
 */
export function tuneSeats(t: Record<string, unknown> | null | undefined, tune: SeatTune = SEAT_TUNE): string[] {
  const moved: string[] = [];
  if (!t || typeof t !== 'object') return moved;
  const into = tune as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(t)) {
    if (!Object.prototype.hasOwnProperty.call(into, key)) continue;
    const had = into[key];
    if (typeof had === 'number' && typeof value === 'number' && Number.isFinite(value)) into[key] = value;
    else if (typeof had === 'boolean' && typeof value === 'boolean') into[key] = value;
    else if (Array.isArray(had) && Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string' && v.length > 0)) into[key] = [...value];
    else continue;
    moved.push(key);
  }
  return moved;
}

/** What a plan comes to, by kind and model, for the console. */
export function seatTally(props: readonly SeatProp[]): { chairs: number; tables: number; indoors: number; byModel: Record<string, number> } {
  const byModel: Record<string, number> = {};
  let chairs = 0;
  let tables = 0;
  let indoors = 0;
  for (const p of props) {
    byModel[p.model] = (byModel[p.model] ?? 0) + 1;
    if (p.kind === 'chair') chairs++;
    else tables++;
    if (p.inside) indoors++;
  }
  return { chairs, tables, indoors, byModel };
}
