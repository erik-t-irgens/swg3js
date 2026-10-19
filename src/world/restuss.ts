// Restuss in the game: what stands where in each of its two states, and the First Brigade of ours in the ruins.
//
// The converter writes the city both ways (`tools/swg/restuss.mjs`): the living launch city tagged
// `restuss=living`, its 35 ruins tagged `restuss=ruins`, the late camp's two dead pads tagged as the ruins' ports,
// and a `states.restuss` block in Rori's layout with the city's middle. What is tagged stands only in its state
// (`standsIn` in `worldState.ts`). What is not tagged is Core3's and everybody's: the camp, the cantinas and the
// First Brigade's camps outside the town stand in both. **In the ruins, Core3's own town -- its people and what the
// server stood in its streets on no building -- inside `RESTUSS_TUNE.circle` of the middle is skipped when
// standing, never taken off its list** (`personDormant`, `fittingDormant`), so every `stood:` name stays what it is
// in every browser; a fitting on a building that stands in both states stands with it.
//
// **The First Brigade of ours** (`rosterRows`): with nobody of the data's in the ruins, a few of the brigade stand
// guard among them, by a rule over the ruins themselves and nothing read from any server table -- for each ruin,
// with chance `share` by a hash of its own place, a post of `group` people standing `ring` metres outside its
// footprint on a side drawn by the same hash and clear of every other ruin's, facing out, each a body drawn by hash from the catalogue's
// `dressed_brigade_*` entries. A row names no creature, so its body's own entry answers for its numbers. Every
// number of it is the owner's to move (`RESTUSS_ROSTER_TUNE`, `__debug.restuss({ roster })`, the debug menu's
// sliders); the rows are always in Rori's list and stood only in the ruins (their tag), so no index anywhere
// depends on the state.
//
// Pure: no three, no page. Rule for this file (node runs it with type stripping for the tests): every import with
// its `.ts` extension, no enum, no namespace, no constructor parameter properties.

/** The world state Restuss is, and the tags of its two values. */
export const RESTUSS_KEY = 'restuss';
export const LIVING_TAG = 'restuss=living';
export const RUINS_TAG = 'restuss=ruins';

/**
 * The circle round the city's middle inside which Core3's town rows and fittings are skipped in the ruins, metres
 * [emu: Core3's no-spawn circle `restuss` is 700 m]. Live through `__debug.restuss({ tune: { circle } })`, read at
 * the next arrival.
 */
export const RESTUSS_TUNE = { circle: 700 };

/** Who stands at a post: as their body's catalogue entry says, or never fought (part of the furniture). */
export type RosterTemper = 'entry' | 'peaceful';

/**
 * The First Brigade of ours in the ruins, every number ours and the owner's to move (§10 Q8 of the pass's design).
 * Read at the next arrival on Rori (`__debug.restuss({ roster })`, the debug menu's sliders).
 */
export const RESTUSS_ROSTER_TUNE: { on: boolean; share: number; group: [number, number]; ring: number; spacing: number; temper: RosterTemper; respawn: number } = {
  // On: without them the ruins hold nobody at all.
  on: true,
  // Of the 35 ruins, the share that has a post beside it: about fourteen posts, a guard at most of the big ones.
  share: 0.4,
  // People at a post, least and most: a lone sentry up to a fire team.
  group: [1, 3],
  // Metres outside the ruin's own footprint where they stand: clear of its rubble, close enough to read as its guard.
  ring: 6,
  // Metres between two people at one post, along the ruin's side.
  spacing: 1.5,
  // As their body's catalogue entry says (the brigade's are defensive), so they fight when fought.
  temper: 'entry',
  // Seconds before one killed comes back: five minutes, which four in five of the server's own rows carry.
  respawn: 300,
};

/** A point's distance across the ground from a middle within `circle`: both in one frame, whichever it is. */
export function inRestussCircle(x: number, z: number, centre: { x: number; z: number } | null | undefined, circle: number = RESTUSS_TUNE.circle): boolean {
  if (!centre) return false;
  const dx = x - centre.x;
  const dz = z - centre.z;
  return dx * dx + dz * dz <= circle * circle;
}

/** The rows of a world's ports (or any list) that stand in its state now: `stands` on each row's own tag. */
export function portsInState<T extends { state?: string | null }>(rows: readonly T[], stands: (tag?: string | null) => boolean): T[] {
  return rows.filter((r) => stands(r.state));
}

/**
 * The circle Core3's town is skipped inside, where Restuss stands in ruins now: its middle in the frame the rows it
 * is asked of are in, and how far. Null in the living city, and on a world with no Restuss.
 */
export interface RuinsCircle {
  centre: { x: number; z: number };
  circle: number;
}

/** A standing row as `personDormant` reads it. */
export interface PersonLike {
  x: number;
  z: number;
  state?: string;
  src?: string;
  from?: string;
  ours?: boolean;
}

/**
 * Whether a standing row is skipped when the world's people are stood: one tagged with a state the world does not
 * stand in, and in the ruins every row of Core3's own (no herald, nobody of ours, nothing of the local overlay)
 * inside the circle. Never taken off its list: only skipped.
 */
export function personDormant(r: PersonLike, stands: (tag?: string | null) => boolean, ruins: RuinsCircle | null): boolean {
  if (r.state && !stands(r.state)) return true;
  if (!ruins) return false;
  const core3 = !r.src && r.from !== 'herald' && !r.ours;
  return core3 && inRestussCircle(r.x, r.z, ruins.centre, ruins.circle);
}

/** A fitting as `fittingDormant` reads it: the building it was stood on (`server:<world>` for none) and its place. */
export interface FittingLike {
  state?: string;
  building?: string;
  x: number;
  z: number;
}

/**
 * Whether a fitting is skipped when the world's fittings are stood: one tagged with a state the world does not
 * stand in, and in the ruins every one the server stood on no building (`server:<world>`, Core3's own street
 * furniture: the town square's crafting station) inside the circle. A fitting on a building is its building's:
 * on one of the city's it is tagged with the city already, and on one that stands in both states -- the late camp's
 * cloning facility, inside the circle -- it stands with its building in both.
 */
export function fittingDormant(f: FittingLike, stands: (tag?: string | null) => boolean, ruins: RuinsCircle | null): boolean {
  if (f.state && !stands(f.state)) return true;
  if (!ruins || !f.building?.startsWith('server:')) return false;
  return inRestussCircle(f.x, f.z, ruins.centre, ruins.circle);
}

/** A ruin as the roster reads it: its template, its raw place and turn (`[w, x, y, z]`), and its model's bounds. */
export interface RuinPlace {
  template: string;
  x: number;
  y: number;
  z: number;
  q: readonly number[];
  bounds: { min: readonly number[]; max: readonly number[] } | null;
}

/** Every ruin of a layout's objects (tagged `restuss=ruins`, standing out in the open), with its model's bounds. */
export function ruinsOf(objects: readonly { template: string; model: string; x: number; y: number; z: number; q: readonly number[]; contained?: boolean; state?: string }[], boundsOf: (model: string) => { min: readonly number[]; max: readonly number[] } | null | undefined): RuinPlace[] {
  const out: RuinPlace[] = [];
  for (const o of objects) {
    if (o.contained || o.state !== RUINS_TAG) continue;
    out.push({ template: o.template, x: o.x, y: o.y, z: o.z, q: o.q, bounds: boundsOf(o.model) ?? null });
  }
  return out;
}

/** One of ours at a post, as `StandingPeople` reads a row: in the snapshot's raw frame, which its `frame` carries. */
export interface RosterRow {
  who: string;
  id: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  cell: number;
  respawn: number;
  where: string;
  still: boolean;
  peaceful?: boolean;
  key: string;
  ours: boolean;
  src: 'ours';
  state: string;
}

/** FNV-1a over a string: the same text always draws the same, in every browser. */
function hashOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** A draw from nought up to but not including one, by a hash. */
function unit(text: string): number {
  return hashOf(text) / 4294967296;
}

/** The yaw a raw layout turn (`[w, x, y, z]`) holds, in the raw frame: the travel children's own arithmetic. */
function yawOf(q: readonly number[]): number {
  if (q.length < 4) return 0;
  const [w, x, y, z] = q;
  return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
}

/** The four sides a post may stand on, outward in the model's own frame: +x, -x, +z, -z. */
const SIDES: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * How far a body at a post must stand clear of another ruin's footprint, metres: the player's own capsule radius,
 * which the walk grid and the indoor paths take as every body's (not ours). A test of placement, not of feel: a
 * post's middle a hair outside a neighbouring ruin would still have the body in its rubble.
 */
const BODY_CLEAR = 0.35;

/** A ruin's footprint as the roster tests against it: its middle, its turn and its half sizes in its own frame. */
interface Footprint {
  x: number;
  z: number;
  cos: number;
  sin: number;
  hx: number;
  hz: number;
}

/**
 * The footprint of a ruin: its model's box read about its origin by the larger reach each way (`Math.abs` of each
 * corner), so a pack whose corners are the other way round, or a model not centred on its origin, is still all
 * inside it; 8 m each way where the pack has no bounds.
 */
function footprintOf(r: RuinPlace): Footprint {
  const b = r.bounds;
  const yaw = yawOf(r.q);
  return {
    x: r.x,
    z: r.z,
    cos: Math.cos(yaw),
    sin: Math.sin(yaw),
    hx: b ? Math.max(Math.abs(b.min[0]), Math.abs(b.max[0])) : 8,
    hz: b ? Math.max(Math.abs(b.min[2]), Math.abs(b.max[2])) : 8,
  };
}

/**
 * Whether a raw point stands inside a footprint grown by `BODY_CLEAR`: the point taken into the footprint's own frame
 * (the inverse of the turn `rosterRows` places by) and measured against its half sizes.
 */
function insideFootprint(f: Footprint, x: number, z: number): boolean {
  const dx = x - f.x;
  const dz = z - f.z;
  const lx = dx * f.cos - dz * f.sin;
  const lz = dx * f.sin + dz * f.cos;
  return Math.abs(lx) < f.hx + BODY_CLEAR && Math.abs(lz) < f.hz + BODY_CLEAR;
}

/**
 * The First Brigade of ours among the ruins: for each ruin, with chance `share` drawn by a hash of its own place, a
 * post of `group[0]` to `group[1]` people (by the same hash) standing `ring` metres outside its footprint on one
 * side, `spacing` apart along it, facing out, each a body drawn by hash from `bodies` (the catalogue's
 * `dressed_brigade_*` entries, any order). The footprint is the model's box read about its origin by the larger
 * reach each way (`footprintOf`). The side is drawn by the same hash; **a side where anybody of the post would stand
 * inside another ruin's footprint is passed over** for the next side round from it, and a ruin hemmed in on all four
 * has no post, since the filler blocks stand packed side by side and a post drawn onto the side two share stood in
 * the neighbour's rubble. Every ruin's footprint is known to every browser alike, so the side taken is too. Rows in
 * the raw frame, tagged `restuss=ruins`, naming no creature. None with the roster off, no ruin or no body.
 */
export function rosterRows(ruins: readonly RuinPlace[], bodies: readonly string[], tune: typeof RESTUSS_ROSTER_TUNE = RESTUSS_ROSTER_TUNE): RosterRow[] {
  const out: RosterRow[] = [];
  if (!tune.on || !ruins.length || !bodies.length) return out;
  const pool = [...bodies].sort();
  const least = Math.max(0, Math.round(Math.min(tune.group[0], tune.group[1])));
  const most = Math.max(least, Math.round(Math.max(tune.group[0], tune.group[1])));
  const prints = ruins.map(footprintOf);
  // The places a post on one side would stand at, written here and read at once.
  const px: number[] = [];
  const pz: number[] = [];
  for (let ri = 0; ri < ruins.length; ri++) {
    const r = ruins[ri];
    const f = prints[ri];
    // The ruin's own name in every browser: its template and its place to the decimetre.
    const name = `restuss:${r.template}@${Math.round(r.x * 10)},${Math.round(r.z * 10)}`;
    if (!(unit(`${name}:post`) < tune.share)) continue;
    const count = least + (hashOf(`${name}:count`) % (most - least + 1));
    if (!count) continue;
    const drawn = hashOf(`${name}:side`) % SIDES.length;
    let side = -1;
    for (let turn = 0; turn < SIDES.length && side < 0; turn++) {
      const s = (drawn + turn) % SIDES.length;
      const [sx, sz] = SIDES[s];
      // The middle of the side, `ring` out from the footprint, and the line along it the post stands on.
      const out0x = sx * (f.hx + tune.ring);
      const out0z = sz * (f.hz + tune.ring);
      px.length = 0;
      pz.length = 0;
      let clear = true;
      for (let k = 0; k < count && clear; k++) {
        const along = (k - (count - 1) / 2) * tune.spacing;
        // Along the side: across the outward direction.
        const lx = out0x + (sx === 0 ? along : 0);
        const lz = out0z + (sz === 0 ? along : 0);
        const x = r.x + (lx * f.cos + lz * f.sin);
        const z = r.z + (-lx * f.sin + lz * f.cos);
        // Its own ruin is behind it by `ring` already, which the owner may set to nought; every other one must clear it.
        for (let oi = 0; oi < prints.length; oi++) {
          if (oi !== ri && insideFootprint(prints[oi], x, z)) {
            clear = false;
            break;
          }
        }
        px.push(x);
        pz.push(z);
      }
      if (clear) side = s;
    }
    if (side < 0) continue;
    const [sx, sz] = SIDES[side];
    // Outward, turned into the raw frame (the travel children's arithmetic): what the post faces.
    const fx = sx * f.cos + sz * f.sin;
    const fz = -sx * f.sin + sz * f.cos;
    const heading = Math.atan2(fx, fz);
    for (let k = 0; k < count; k++) {
      const id = pool[hashOf(`${name}:${k}:body`) % pool.length];
      const key = `${hashOf(`${name}:${k}`).toString(16).padStart(8, '0')}:brigade`;
      out.push({
        who: '',
        id,
        x: px[k],
        y: r.y,
        z: pz[k],
        heading,
        cell: 0,
        respawn: tune.respawn,
        where: 'ours',
        still: true,
        ...(tune.temper === 'peaceful' ? { peaceful: true } : {}),
        key,
        ours: true,
        src: 'ours',
        state: RUINS_TAG,
      });
    }
  }
  return out;
}

/** The brigade's bodies of a catalogue's entries: every ready `dressed_brigade_*`, by id. */
export function brigadeBodies(entries: readonly { id: string; ready?: boolean }[]): string[] {
  return entries.filter((e) => e.id.startsWith('dressed_brigade_') && e.ready !== false).map((e) => e.id).sort();
}

/** Move `RESTUSS_TUNE` (`circle`, held to 100..2000 m); answers what moved. */
export function tuneRestuss(patch: Record<string, unknown> | null | undefined): string[] {
  const moved: string[] = [];
  if (!patch || typeof patch !== 'object') return moved;
  if (typeof patch.circle === 'number' && Number.isFinite(patch.circle)) {
    RESTUSS_TUNE.circle = Math.max(100, Math.min(2000, patch.circle));
    moved.push('circle');
  }
  return moved;
}

/** A switch's word: true or false, `'yes'` or `'no'`, `'on'` or `'off'`; null for anything else. */
function switchOf(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v === 'yes' || v === 'on') return true;
  if (v === 'no' || v === 'off') return false;
  return null;
}

/**
 * Move `RESTUSS_ROSTER_TUNE`, each number held to a sane range: `on` (a switch, or `'yes'`/`'no'`), `share` (0..1),
 * `group` ([least, most], 0..8), or `least` and `most` on their own (the sliders'), `ring` (0..30 m), `spacing`
 * (0.5..6 m), `temper` (`'entry'` or `'peaceful'`) and `respawn` (seconds, 0..3600, nought staying down). Answers what moved.
 */
export function tuneRestussRoster(patch: Record<string, unknown> | null | undefined): string[] {
  const moved: string[] = [];
  if (!patch || typeof patch !== 'object') return moved;
  const t = RESTUSS_ROSTER_TUNE;
  const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);
  const on = switchOf(patch.on);
  if (on !== null) {
    t.on = on;
    moved.push('on');
  }
  const share = num(patch.share, 0, 1);
  if (share !== null) {
    t.share = share;
    moved.push('share');
  }
  if (Array.isArray(patch.group) && patch.group.length === 2) {
    const a = num(patch.group[0], 0, 8);
    const b = num(patch.group[1], 0, 8);
    if (a !== null && b !== null) {
      t.group = [Math.round(Math.min(a, b)), Math.round(Math.max(a, b))];
      moved.push('group');
    }
  }
  const least = num(patch.least, 0, 8);
  if (least !== null) {
    t.group = [Math.round(least), Math.max(Math.round(least), t.group[1])];
    moved.push('least');
  }
  const most = num(patch.most, 0, 8);
  if (most !== null) {
    t.group = [Math.min(t.group[0], Math.round(most)), Math.round(most)];
    moved.push('most');
  }
  const ring = num(patch.ring, 0, 30);
  if (ring !== null) {
    t.ring = ring;
    moved.push('ring');
  }
  const spacing = num(patch.spacing, 0.5, 6);
  if (spacing !== null) {
    t.spacing = spacing;
    moved.push('spacing');
  }
  if (patch.temper === 'entry' || patch.temper === 'peaceful') {
    t.temper = patch.temper;
    moved.push('temper');
  }
  const respawn = num(patch.respawn, 0, 3600);
  if (respawn !== null) {
    t.respawn = Math.round(respawn);
    moved.push('respawn');
  }
  return moved;
}
