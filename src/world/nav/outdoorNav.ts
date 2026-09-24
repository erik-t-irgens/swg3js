// The game's side of the outdoor pathing: it holds one world's baked walkability grid and hands a
// body the next corner to walk to. Nothing more -- what the body then does with that corner is the
// body's own steering, unchanged, exactly as it is indoors.
//
// It degrades in the same three steps the indoor pathing does, and for the same reason:
//
//   1. A pack with no `nav.json` answers null at once and every body steers exactly as it did
//      before there was any of this. That is the whole of the rule that a world nobody has run the
//      new command over must play as it plays today.
//   2. With a grid, a goal within `straight` metres whose line is clear answers null as well --
//      because there is nothing to add. At thirty metres today's rule already arrives nine times in
//      ten and takes the straight line when it does, so the ten-thousand-times-commoner case must
//      not pay for a search, and baked data costs nothing when it is not read.
//   3. Further than that, the corners of a real route: a coarse pass over the whole world for the
//      shape of it, a fine pass inside that corridor for the ground, and a line-of-sight
//      string-pull to throw away every corner the body did not need.
//
// And it can say one thing nothing else in the game can: that a place cannot be walked to at all.
// A world has a hundred thousand separate walkable regions and 97% of the ground is one of them, so
// the bake's own region ranks turn "it never arrived" into an answer before the body sets off.
import { NAV_TUNE, type NavTune } from './navMesh.ts';
import type { NavAgent } from './navAgent.ts';
import {
  NAV_GRID_VERSION,
  NAV_INDOOR,
  NAV_RANKS,
  OUTDOOR_TUNE,
  OutdoorWork,
  cellOf,
  decodeGrid,
  isOpen,
  nibbleAt,
  planRoute,
  regionAt,
  type OutdoorGrid,
  type OutdoorHeader,
  type OutdoorTune,
  type PlanOutcome,
} from './outdoorGrid.ts';

/**
 * The numbers the shared `NavAgent` reads that are the outdoor path's rather than a room's. A
 * corner three hundred metres off is not a doorjamb: the indoor `reach` of 0.45 m would have a body
 * running at five metres a second circle its own waypoint, and `goalMoved` of two metres would
 * replan a four-kilometre route every stride the thing it is chasing takes.
 */
export interface OutdoorAgentTune {
  /** How near a corner counts as reached, metres. */
  reach: number;
  /** A goal that has moved at least this far asks for a fresh route, metres. */
  goalMoved: number;
  /** At most one fresh route this often for one body, seconds on the simulated clock. */
  every: number;
  /** After a search that found nothing, this long before another is tried, seconds. */
  retry: number;
  /**
   * How long a body may hold a route it is making no headway on before the corners are thrown away
   * and a fresh one is asked for, seconds. 0 turns the watch off.
   *
   * It is here because the grid is a two-metre picture of the ground taken at conversion and the
   * world the body walks in is not: a placement whose model the pack has not got, geometry too thin
   * for the rasteriser to catch, anything the engine disagrees with. A body leaning on one of those
   * reaches no corner, so its corner list never runs out, and with a goal that is standing still
   * nothing else in `NavAgent.wants` would ever ask again -- the body would push at that corner for
   * the rest of the evening. The body's own steering still side-steps as it always did; this is
   * what makes it ask the grid a second question once it has got round whatever it met.
   */
  stuck: number;
  /** Ground covered within `stuck` seconds that counts as headway, metres. */
  stuckMoved: number;
}

export const OUTDOOR_AGENT: OutdoorAgentTune = {
  reach: 3,
  goalMoved: 25,
  every: 1,
  retry: 5,
  stuck: 3,
  stuckMoved: 2,
};

export interface OutdoorStatus {
  /** Whether a grid is loaded at all: false is a world nobody has run the command over. */
  ready: boolean;
  planet: string;
  cell: number;
  nx: number;
  nz: number;
  bytes: number;
  /** Searches asked for, and what they came to. */
  asked: number;
  found: number;
  straight: number;
  unreachable: number;
  /** The coarse plane could not join the two ends although the ground is one region. */
  unjoined: number;
  nowhere: number;
  spent: number;
  /** Searches put off to the next step because this one had spent its budget. */
  deferred: number;
  /** Plans answered out of the refusal ring with no search at all. */
  remembered: number;
  /** Routes thrown away because the body was making no headway on them. */
  unstuck: number;
  /** What the last search that really ran cost. */
  lastCoarse: number;
  lastFine: number;
  lastFlood: number;
  lastCorners: number;
  lastMs: number;
  /**
   * The worst one search has cost since the game started, milliseconds. The counters above are the
   * session's and not the world's, as the indoor pathing's are: a travel does not clear them.
   */
  worstMs: number;
  tune: OutdoorTune;
  agent: OutdoorAgentTune;
}

/** The thing a `NavAgent` keys its path on while it is outdoors; there is no building out here. */
const OUTDOORS: object = { outdoors: true };

const NO_GRID = "[nav] this world has no outdoor walkability grid: bodies outdoors steer straight at their goal, exactly as they did before there was any pathing. Run `npm run swg -- navgrid <planet> assets-private` to give it one.";

export class OutdoorNav {
  private grid: OutdoorGrid | null = null;
  private work: OutdoorWork | null = null;
  private bytes = 0;
  private planet = '';
  /** Bumped on every load and unload, so a fetch that lands after a travel is thrown away. */
  private token = 0;
  private saidNoGrid = false;
  private stepAt = Number.NaN;
  private stepPlans = 0;
  private asked = 0;
  private foundCount = 0;
  private straightCount = 0;
  private unreachableCount = 0;
  private unjoinedCount = 0;
  private nowhereCount = 0;
  private spentCount = 0;
  private deferred = 0;
  private unstuckCount = 0;
  private lastCoarse = 0;
  private lastFine = 0;
  private lastFlood = 0;
  private lastCorners = 0;
  private lastMs = 0;
  private worstMs = 0;
  /** The corner handed back: its own object, never a new one. */
  private readonly out = { x: 0, z: 0 };
  /**
   * What the shared agent reads. It is a `NavTune` because `NavAgent` takes one, and only four of
   * its fields are ever read there, which are exactly the four in `OUTDOOR_AGENT`.
   */
  private readonly agentTune: NavTune = { ...NAV_TUNE, ...OUTDOOR_AGENT };
  readonly tune: OutdoorTune = OUTDOOR_TUNE;
  readonly agent: OutdoorAgentTune = OUTDOOR_AGENT;

  get ready(): boolean {
    return this.grid !== null;
  }

  /**
   * Fetch and decode one world's grid. A world with no grid, a header this build does not read, a
   * browser with no `DecompressionStream` and a fetch that simply fails all come to the same thing:
   * no grid, and every body steers as it always did.
   */
  async load(planetId: string, baseUrl?: string): Promise<boolean> {
    this.unload();
    const mine = this.token;
    // The same folder every other per-planet file comes out of. Asked for rather than handed in so
    // the wiring is one call; a node test hands one in and never reaches this line.
    const root = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    const base = baseUrl ?? `${root}assets-private/${planetId}/`;
    try {
      const hr = await fetch(`${base}nav.json`);
      if (!hr.ok || !(hr.headers.get('content-type') ?? '').includes('json')) return false;
      const header = (await hr.json()) as OutdoorHeader;
      if (!header || header.version !== NAV_GRID_VERSION) return false;
      const br = await fetch(`${base}${(header as unknown as { file?: string }).file ?? 'nav.bin'}`);
      if (!br.ok) return false;
      const packed = new Uint8Array(await br.arrayBuffer());
      const bytes = await inflateRaw(packed);
      if (!bytes) return false;
      if (mine !== this.token) return false;
      return this.adopt(planetId, header, bytes);
    } catch {
      return false;
    }
  }

  /**
   * Take a grid that has already been fetched and inflated. It is the whole tail of `load`, and it
   * is its own method because a node test has no `fetch` and no `DecompressionStream` and should
   * still be able to hand this the very bytes the converter wrote.
   */
  adopt(planetId: string, header: OutdoorHeader, bytes: Uint8Array): boolean {
    const grid = decodeGrid(header, bytes);
    if (!grid) return false;
    this.grid = grid;
    this.work = new OutdoorWork(header);
    this.bytes = bytes.length;
    this.planet = header.planet ?? planetId;
    this.saidNoGrid = false;
    return true;
  }

  /** Let the world's grid go. Everything it held is one object, so this is the whole of it. */
  unload(): void {
    this.token++;
    this.grid = null;
    this.work = null;
    this.bytes = 0;
    this.planet = '';
    this.stepAt = Number.NaN;
    this.stepPlans = 0;
    this.lastCoarse = 0;
    this.lastFine = 0;
    this.lastFlood = 0;
    this.lastCorners = 0;
    this.lastMs = 0;
  }

  /** 0 blocked, 1..13 a ranked region, 14 some smaller region, 15 indoor; -1 with no grid at all. */
  region(x: number, z: number): number {
    return this.grid ? regionAt(this.grid, x, z) : -1;
  }

  /**
   * Whether a body standing here could walk to there at all. It answers false only when the bake is
   * sure -- two different ranked regions -- and true whenever it does not know, because a body that
   * refuses an errand it could have walked is worse than one that tries and fails.
   */
  reachable(x: number, z: number, goalX: number, goalZ: number): boolean {
    const g = this.grid;
    if (!g) return true;
    const a = regionAt(g, x, z);
    const b = regionAt(g, goalX, goalZ);
    if (a <= 0 || b <= 0 || a > NAV_RANKS || b > NAV_RANKS) return true;
    return a === b;
  }

  /**
   * The next corner a body outdoors should walk to on its way to a point, in the world's frame, or
   * null when there is nothing to add to walking straight at it.
   *
   * `radius` is the body's own half-width, and is read for nothing today: the grid was baked with
   * the player's own 0.35 m already grown into it, so a fatter body walks the same corridor. It is
   * in the signature because the indoor call takes one and the two call sites are the same line.
   */
  corner(agent: NavAgent, x: number, _y: number, z: number, goalX: number, _goalY: number, goalZ: number, _radius: number, now: number): { x: number; z: number } | null {
    const g = this.grid;
    const w = this.work;
    if (!g || !w) {
      if (!this.saidNoGrid) {
        this.saidNoGrid = true;
        console.info(NO_GRID);
      }
      return null;
    }
    this.watchProgress(agent, x, z, now);
    if (agent.wants(OUTDOORS, -1, goalX, goalZ, now, this.agentTune)) {
      // A budget a step, so a squad ordered across a planet at once cannot all search on the same
      // frame; whoever is turned away keeps the route it has and asks again on the next one.
      if (now !== this.stepAt) {
        this.stepAt = now;
        this.stepPlans = 0;
      }
      if (this.stepPlans >= this.tune.perStep) {
        this.deferred++;
      } else {
        this.stepPlans++;
        this.asked++;
        this.plan(agent, g, w, x, z, goalX, goalZ, now);
      }
    }
    if (!agent.advance(x, z, this.agentTune)) return null;
    const c = agent.corner();
    if (!c) return null;
    this.out.x = c.x;
    this.out.z = c.z;
    return this.out;
  }

  /**
   * Throw a route away when the body has stopped getting anywhere on it.
   *
   * It is the one rule that answers for the difference between the grid and the world the body is
   * really standing in, and it has to live here rather than in `NavAgent.wants`: a body that has
   * corners, reaches none of them and is chasing something that is standing still satisfies none of
   * that method's conditions and would never ask again. Clearing the agent is what asks -- `wants`
   * then sees an empty corner list -- and `every` still holds it to one fresh route a second.
   *
   * A body with no corners is not watched at all: there is nothing to be stuck on, and today's
   * steering is doing whatever it always did.
   */
  private watchProgress(agent: NavAgent, x: number, z: number, now: number): void {
    const stuck = this.agent.stuck;
    // Only an outdoor path of this agent's is watched. The same agent carries the indoor path as
    // well, and a body that has just stepped out of a door still holds the room's corners for the
    // one frame before `wants` throws them away: measured against those, it would look stuck.
    if (!(stuck > 0) || agent.building !== OUTDOORS || agent.at >= agent.count) {
      agent.moveX = Number.NaN;
      return;
    }
    if (!Number.isFinite(agent.moveX)) {
      agent.moveX = x;
      agent.moveZ = z;
      agent.movedAt = now;
      return;
    }
    const dx = x - agent.moveX;
    const dz = z - agent.moveZ;
    if (dx * dx + dz * dz >= this.agent.stuckMoved * this.agent.stuckMoved) {
      agent.moveX = x;
      agent.moveZ = z;
      agent.movedAt = now;
      return;
    }
    if (now - agent.movedAt < stuck) return;
    agent.clear();
    agent.moveX = x;
    agent.moveZ = z;
    agent.movedAt = now;
    this.unstuckCount++;
  }

  private plan(agent: NavAgent, g: OutdoorGrid, w: OutdoorWork, x: number, z: number, goalX: number, goalZ: number, now: number): void {
    const t0 = typeof performance === 'object' ? performance.now() : 0;
    const outcome: PlanOutcome = planRoute(g, w, x, z, goalX, goalZ, this.tune);
    this.lastMs = typeof performance === 'object' ? performance.now() - t0 : 0;
    if (this.lastMs > this.worstMs) this.worstMs = this.lastMs;
    this.lastCoarse = w.opened;
    this.lastFine = w.fineOpened;
    this.lastFlood = w.floodOpened;
    if (outcome === 'found') {
      const room = agent.corners;
      const n = Math.min(w.pulledCount, Math.floor(room.length / 2));
      for (let i = 0; i < n; i++) {
        room[i * 2] = w.pulled[i * 2];
        room[i * 2 + 1] = w.pulled[i * 2 + 1];
      }
      this.lastCorners = n;
      this.foundCount++;
      agent.took(OUTDOORS, -1, goalX, goalZ, now, n);
      return;
    }
    this.lastCorners = 0;
    if (outcome === 'straight') this.straightCount++;
    else if (outcome === 'unreachable') this.unreachableCount++;
    else if (outcome === 'unjoined') this.unjoinedCount++;
    else if (outcome === 'nowhere') this.nowhereCount++;
    else this.spentCount++;
    // Every other answer is the same to the body: no corners, and today's steering. They are counted
    // apart because they mean quite different things to whoever is reading the console.
    //
    // 'straight' is the one that must not be recorded as a failure. It is not a search that came to
    // nothing -- it is "the line is clear, there is nothing to add" -- and a failed agent is held
    // for `retry` and stops watching its goal while it waits, so a thirty-metre chase that became a
    // three-hundred-metre one would stand there for five seconds before asking for its first route.
    agent.took(OUTDOORS, -1, goalX, goalZ, now, 0, outcome !== 'straight');
  }

  /** Whether a world point stands inside a portal building's own footprint. */
  indoors(x: number, z: number): boolean {
    const g = this.grid;
    if (!g) return false;
    const k = cellOf(g, x, z);
    return k >= 0 && nibbleAt(g, k) === NAV_INDOOR;
  }

  /** Whether a world point is ground this grid calls walkable at all. */
  walkable(x: number, z: number): boolean {
    const g = this.grid;
    return g ? isOpen(g, cellOf(g, x, z)) : true;
  }

  status(): OutdoorStatus {
    const h = this.grid?.header;
    return {
      ready: this.grid !== null,
      planet: this.planet,
      cell: h?.cell ?? 0,
      nx: h?.nx ?? 0,
      nz: h?.nz ?? 0,
      bytes: this.bytes,
      asked: this.asked,
      found: this.foundCount,
      straight: this.straightCount,
      unreachable: this.unreachableCount,
      unjoined: this.unjoinedCount,
      nowhere: this.nowhereCount,
      spent: this.spentCount,
      deferred: this.deferred,
      remembered: this.work?.remembered ?? 0,
      unstuck: this.unstuckCount,
      lastCoarse: this.lastCoarse,
      lastFine: this.lastFine,
      lastFlood: this.lastFlood,
      lastCorners: this.lastCorners,
      lastMs: Number(this.lastMs.toFixed(3)),
      worstMs: Number(this.worstMs.toFixed(3)),
      tune: this.tune,
      agent: this.agent,
    };
  }

  /** Move one of the invented numbers for a run; anything else is left alone. */
  set(values: Partial<OutdoorTune & OutdoorAgentTune>): OutdoorStatus {
    for (const k of Object.keys(values) as (keyof (OutdoorTune & OutdoorAgentTune))[]) {
      const v = (values as Record<string, unknown>)[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      if (k in this.agent) {
        (this.agent as unknown as Record<string, number>)[k] = v;
        (this.agentTune as unknown as Record<string, number>)[k] = v;
      } else if (k in this.tune) {
        (this.tune as unknown as Record<string, number>)[k] = v;
      }
    }
    return this.status();
  }
}

/**
 * Inflate a raw-deflate stream with the browser's own decompressor. There is no fallback: a browser
 * without `DecompressionStream` simply has no grid, and every body in it steers as it always did.
 */
async function inflateRaw(packed: Uint8Array): Promise<Uint8Array | null> {
  const ctor = (globalThis as unknown as { DecompressionStream?: new (format: string) => TransformStream<Uint8Array, Uint8Array> }).DecompressionStream;
  if (!ctor) return null;
  try {
    const stream = new Blob([packed as unknown as BlobPart]).stream().pipeThrough(new ctor('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * The one instance. Like the indoor `worldNav` it holds nothing but a cache, and both the
 * creatures' manager and the fighters' read it, so a world's grid is decoded once for both.
 */
export const outdoorNav = new OutdoorNav();
