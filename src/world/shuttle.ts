// Where a shuttle will take you from where you are standing, and what the game charged for it.
//
// All of this is the game's own and none of it needed converting again: every planet's `pois.json`
// already names its starports and shuttleports with their places, and `galaxy.json` already carries
// the 30 routes between worlds with their fares and the one local fare each world charges. Both have
// been in the packs since the `maps` command was written and nothing has ever read them for anything
// but drawing lines on the galaxy map.
//
// The rules below are the client's own as far as they go:
//
//   - A **shuttleport** takes you to another port on the same world, at that world's local fare.
//   - A **starport** does the same and also takes you to another world, at the routes table's own
//     price -- which is **directed**: the fare from one world to another is not the fare back, and
//     a pair the table names only one way round can only be flown one way.
//   - Where it lands you is the destination's own port and never the world's spawn point.
//
// What is ours: how near you have to be standing to use one, and the order the destinations are
// listed in. The reach is `SHUTTLE_TUNE` and is live; the order is nearest-first for the ports on
// this world and then the other worlds by name, since a list of eighteen names wants some order and
// the client's own is not in the archives.
//
// Pure: no three, no fetch, no DOM. Rule for this file (node runs it with type stripping for the
// tests): relative imports only as `import type`, no enum, no namespace, no constructor parameter
// properties.

/** A place a shuttle stands, in the **world's** own frame rather than the snapshot's. */
export interface Port {
  name: string;
  x: number;
  z: number;
  kind: 'starport' | 'shuttleport';
}

/** One entry of a `pois.json`, as the packs carry it (the snapshot's frame, unmirrored). */
export interface PoiRow {
  name: string;
  x: number;
  z: number;
  kind: string;
}

/** The shuttle fares, as `galaxy.json` carries them. */
export interface FareTable {
  /** Directed: `from` and `to` are pack ids, and the pair the other way round may be priced apart. */
  routes: { from: string; to: string; price: number }[];
  /** What one world charges to move you about inside itself, by pack id. */
  local: Record<string, number>;
}

/** Somewhere a shuttle will take you. */
export interface Ride {
  /** Another port on this world, or another world entirely. */
  kind: 'local' | 'world';
  /** What to call it on the panel. */
  name: string;
  /** What it costs, in the game's own credits. */
  price: number;
  /** A local ride: where on this world it lands, in the world's own frame. */
  to?: { x: number; z: number };
  /** A ride to another world: the pack id the routes table named. */
  pack?: string;
  /** How far off it is, metres, for a local ride. */
  away?: number;
}

/** Every number of the shuttle that is ours. Live through `__debug.shuttle`. */
export const SHUTTLE_TUNE = {
  /**
   * How near a port you have to stand to take a shuttle, metres.
   *
   * A port in the packs is a **point** with no reach of its own (`r` is 0 on every one of them), and
   * the building it names can be fifty metres across, so this is generous on purpose: it is the
   * radius of "you are at the starport", not of "you are touching the terminal".
   */
  reach: 40,
  /** How close two ports have to be before the nearer one is the only one offered, metres. */
  same: 5,
};

/**
 * The ports in a pack's own places, brought into the world's frame.
 *
 * Snapshot space is mirrored in X and centred on the layout centre, which is the streamer's own
 * transform and not the pack's -- so it is applied here exactly as `LayoutStreamer` applies it, and
 * a pack whose centre moves needs no rerun.
 */
export function portsOf(pois: readonly PoiRow[], centre: { x: number; z: number }): Port[] {
  const out: Port[] = [];
  for (const p of pois) {
    if (p.kind !== 'starport' && p.kind !== 'shuttleport') continue;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    out.push({ name: p.name, x: -(p.x - centre.x), z: p.z - centre.z, kind: p.kind });
  }
  return out;
}

/** The port somebody standing at `at` is at, or null. The nearest one wins where two overlap. */
export function portAt(ports: readonly Port[], at: { x: number; z: number }, tune = SHUTTLE_TUNE): Port | null {
  let best: Port | null = null;
  let bestD = Infinity;
  for (const p of ports) {
    const d = Math.hypot(p.x - at.x, p.z - at.z);
    if (d > tune.reach || d >= bestD) continue;
    bestD = d;
    best = p;
  }
  return best;
}

/**
 * Where a shuttle will take you from `from`, on the world whose pack is `pack`.
 *
 * `label` turns a pack id into what to call that world on the panel; a pack it has no name for is
 * left out, which is how a route to a world this game does not carry is dropped rather than offered
 * and then refused.
 */
export function ridesFrom(
  from: Port,
  ports: readonly Port[],
  pack: string,
  fares: FareTable,
  label: (pack: string) => string | null,
  tune = SHUTTLE_TUNE,
): Ride[] {
  const local: Ride[] = [];
  const localPrice = Math.max(0, Math.round(fares.local?.[pack] ?? 0));
  for (const p of ports) {
    const away = Math.hypot(p.x - from.x, p.z - from.z);
    // The port you are standing at, and anything sharing its spot, is not somewhere to go.
    if (away <= tune.same) continue;
    local.push({ kind: 'local', name: p.name, price: localPrice, to: { x: p.x, z: p.z }, away });
  }
  local.sort((a, b) => (a.away ?? 0) - (b.away ?? 0));
  // Only a starport leaves the world, which is the client's own division and the reason the packs
  // name the two kinds apart at all.
  if (from.kind !== 'starport') return local;
  const worlds: Ride[] = [];
  const seen = new Set<string>();
  for (const r of fares.routes ?? []) {
    if (r.from !== pack || r.to === pack || seen.has(r.to)) continue;
    const name = label(r.to);
    if (!name) continue;
    seen.add(r.to);
    worlds.push({ kind: 'world', name, price: Math.max(0, Math.round(r.price)), pack: r.to });
  }
  worlds.sort((a, b) => a.name.localeCompare(b.name));
  return [...local, ...worlds];
}

/**
 * Where a shuttle arriving on another world puts you down: its own starport, else any port it has.
 *
 * It takes the pack's **own rows** rather than ports in a world frame, because that is what the
 * caller has before it has travelled: the destination's snapshot centre is not known until its pack
 * has loaded, and the game's own teleport takes a raw row and mirrors it itself once it is there.
 *
 * A world with no port at all in its pack answers null and the caller lands at the world's own
 * spawn, which is what every travel did before this existed.
 */
export function landingOn<T extends PoiRow>(pois: readonly T[]): T | null {
  return pois.find((p) => p.kind === 'starport') ?? pois.find((p) => p.kind === 'shuttleport') ?? null;
}

/** What the fare reads as on the panel: the game's own number with its thousands marked. */
export function fareText(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return 'free';
  return `${Math.round(price).toLocaleString('en-GB')} credits`;
}
