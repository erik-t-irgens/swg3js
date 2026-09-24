// The outdoor walkability grid, and the search over it. Pure numbers: no three, no physics, no
// browser, nothing allocated after the grid is decoded -- so a node test can draw a world by hand
// and walk a body across it.
//
// The grid is what `tools/swg/navgrid.mjs` bakes: one nibble a cell at the terrain's own two
// metres, where 0 is blocked, 1..13 is the rank of the walkable region the cell is in (1 being the
// largest on the world), 14 is some other, smaller region, and 15 is a portal building's own
// footprint -- which is not blocked and is not ours either, because the indoor pathing from pass 6
// has that building's own authored floor and takes over at the door.
//
// Beside it is a coarse plane, one byte per `coarse` fine cells, carrying the same rank where
// enough of the fine cells under it are walkable. The search is in two passes because of it: a
// whole world is sixty-seven million fine cells, which nothing may search on a frame, and about a
// million coarse ones, which a search crosses in a few milliseconds. The coarse pass finds the
// shape of the route; a fine pass repairs each hop the coarse plane was too blunt to get right; and
// a line-of-sight string-pull throws away every corner the body did not need.
//
// The corners are the whole of the runtime's job. The bodies' own steering is not touched: they are
// handed a corner instead of a goal, exactly as they already are indoors, which is the one thing
// the route measurements were unambiguous about -- waypoints every twenty-five metres along the
// same path, without a sight test between them, arrived nought times in twenty.

/** The shape of the files this reads; a pack that says anything else is passed over. */
export const NAV_GRID_VERSION = 1;

/** Nibble values, as the converter writes them. */
export const NAV_BLOCKED = 0;
export const NAV_RANKS = 13;
export const NAV_OTHER = 14;
export const NAV_INDOOR = 15;

export interface OutdoorHeader {
  version: number;
  planet: string;
  /** Metres a fine cell, and fine cells a coarse one. */
  cell: number;
  coarse: number;
  nx: number;
  nz: number;
  cnx: number;
  cnz: number;
  /** World coordinates of the low corner of cell (0, 0). The pack's centre is not the map's. */
  x0: number;
  z0: number;
  fineBytes: number;
  coarseBytes: number;
  edgeBytes: number;
}

export interface OutdoorTune {
  /** How far a body or a goal standing on a blocked cell may be pulled onto open ground, metres. */
  snap: number;
  /** A goal further than this from any open cell is not a place anything can be sent, metres. */
  goalSnap: number;
  /**
   * Under this, a plain sight test is the whole answer and no search runs at all: at thirty metres
   * today's steering arrives nine times in ten and takes the straight line when it does, so the ten
   * thousand times commoner case must not pay for a grid search.
   */
  straight: number;
  /**
   * At most this many coarse cells opened in one search. It is not a guess: the longest legitimate
   * route there is -- corner to corner of the largest world's largest walkable region -- opened
   * 22,518 of them, so this is about twice the worst real answer and everything past it is a search
   * that is not going to answer.
   */
  coarseExpand: number;
  /**
   * At most this many fine cells opened repairing one hop. The corridor itself holds at most
   * `maxSlots` x `coarse`^2 cells (2,048 x 64 = 131,072), so a figure above that could never bind
   * and this one is deliberately under it.
   */
  fineExpand: number;
  /**
   * The real budget, in milliseconds, checked every few thousand expansions in both searches. The
   * counts above are this machine's arithmetic; this is the promise a frame actually needs, and it
   * is what keeps the same grid honest on a machine half this speed. 0 turns the clock off, which
   * is what a test that wants an answer to depend on nothing but the world sets.
   */
  planMs: number;
  /**
   * How many coarse cells the goal-side flood may walk before it gives up saying anything. It runs
   * on every plan, before the ordinary search, and it is what turns "this step could not settle
   * it" into "the plane holds no route", which can then be remembered. 0 turns it off.
   */
  componentCap: number;
  /**
   * How greedy the coarse search is. One is the shortest route and the widest search; above one it
   * leans toward the goal and opens fewer cells for a slightly longer route.
   */
  weight: number;
  /** How greedy the fine search inside the corridor is. It need not be shortest, only walkable. */
  fineWeight: number;
  /** The longest leg a string-pull will make, metres. Shorter legs are safer and cost more corners. */
  pullCap: number;
  /** How many nodes past a failed sight test the string-pull keeps looking before it gives up. */
  pullMiss: number;
  /** Coarse cells either side of the coarse route the fine search may walk in, and once more if it fails. */
  corridor: number;
  corridorAgain: number;
  /**
   * How far along the coarse route one plan works out in detail, metres. A whole world's route is
   * found coarsely and cheaply; only this much of it is turned into real corners, and the body asks
   * again when it has walked them, exactly as it does indoors when it leaves a room.
   */
  horizon: number;
  /** At most this many searches in one step of the simulation, over every body there is. */
  perStep: number;
}

export const OUTDOOR_TUNE: OutdoorTune = {
  snap: 8,
  goalSnap: 40,
  straight: 80,
  coarseExpand: 30000,
  fineExpand: 120000,
  planMs: 20,
  componentCap: 4000,
  weight: 1.25,
  fineWeight: 1.6,
  pullCap: 300,
  pullMiss: 8,
  corridor: 1,
  corridorAgain: 3,
  horizon: 400,
  perStep: 1,
};

/**
 * What a plan came to. `corners` is only meaningful for 'found'.
 *
 * 'unreachable' and 'unjoined' are deliberately two words, because they are two different facts and
 * only one of them is about the world. 'unreachable' is the **ranks**: the goal stands on ground
 * that is a different walkable region from the body's, which is the one thing only the bake can say
 * and which will not change. 'unjoined' is the **coarse plane**: the ground is one region and the
 * sixteen-metre plane the first pass searches cannot join the two ends of it, which is the plane's
 * own blindness and not the world's. Before these were told apart every refusal of the plane was
 * reported as 'unreachable', which said something false about the ground in a console line whose
 * whole job is to say what the bake knows.
 */
export type PlanOutcome = 'found' | 'straight' | 'nowhere' | 'unreachable' | 'unjoined' | 'spent';

/**
 * How many pairs of coarse cells already shown to be unjoined are remembered. It is the difference
 * between paying for that answer once and paying for it every `retry` seconds for as long as the
 * body stands there, for every body that asks: the plane's components do not change while a world
 * is loaded, so the answer is permanent and the ring is shared by everything that plans.
 */
const REFUSED = 64;

/** The clock, where there is one. A search that cannot read a clock is bounded by its counts alone. */
const NOW: () => number = typeof performance === 'object' && performance && typeof performance.now === 'function'
  ? () => performance.now()
  : () => 0;

/** How many expansions between two looks at the clock. Reading it every cell would cost more than it saves. */
const CLOCK_STRIDE = 2048;

export interface OutdoorGrid {
  header: OutdoorHeader;
  /** One nibble a cell, low nibble first. */
  fine: Uint8Array;
  /** One byte a coarse cell: 0 nothing to offer, else the majority rank under it. */
  coarse: Uint8Array;
  /**
   * Which of its eight neighbours each coarse cell really joins, one bit each in the order the
   * neighbour offsets are written out (the middle left out). A share test alone is a lie about the
   * ground -- two coarse cells can each be a third walkable with not one pair of open fine cells
   * touching across the border between them -- and this is the fine grids own answer, baked.
   */
  edges: Uint8Array;
}

/**
 * The scratch one search runs in. Made once per grid and written into, never allocated again, which
 * is why it is handed in rather than made: a plan must cost nothing but its own arithmetic.
 */
export class OutdoorWork {
  readonly cg: Float32Array;
  readonly cParent: Int32Array;
  readonly cStamp: Int32Array;
  /**
   * Cells already expanded. Both searches lean toward the goal (`weight`, `fineWeight` above one),
   * which makes the estimate inconsistent, and an inconsistent estimate re-opens a cell every time
   * a cheaper way to it turns up -- measured at seventeen times over on one four-hundred-metre
   * corridor, a quarter of a million cells where there were fourteen thousand. Expanding each cell
   * once costs a slightly longer route and is the difference between a millisecond and a hitch.
   */
  readonly cClosed: Int32Array;
  readonly heapK: Int32Array;
  readonly heapF: Float64Array;
  /**
   * The corridor: which coarse cells the fine search may walk in, as a slot number each, stamped so
   * nothing is ever cleared. It is what keeps the fine search off a world of sixty-seven million
   * cells -- the arrays below are sized by the corridor and not by the world.
   */
  readonly slot: Int32Array;
  readonly slotStamp: Int32Array;
  readonly slotCell: Int32Array;
  slots = 0;
  slotAt = 0;
  /** The fine search, indexed by slot and the cell's place inside its coarse cell. */
  readonly fg: Float32Array;
  readonly fParent: Int32Array;
  readonly fStamp: Int32Array;
  readonly fClosed: Int32Array;
  readonly fHeapK: Int32Array;
  readonly fHeapF: Float64Array;
  /** The route as x, z pairs, before and after the string-pull. */
  readonly raw: Float64Array;
  readonly pulled: Float64Array;
  /** The coarse route unwound. Written, never made. */
  readonly chain: Int32Array;
  rawCount = 0;
  pulledCount = 0;
  /** The generation the stamps are compared against, so nothing is ever cleared. */
  stampAt = 0;
  fStampAt = 0;
  /** What the last search cost, for the console. */
  opened = 0;
  fineOpened = 0;
  widened = 0;
  /** How many coarse cells the goal-side flood walked, and what it settled: 1 joined, 0 not, -1 capped. */
  floodOpened = 0;
  flood = 0;
  /** The coarse cells the last plan really started and ended at, after every snap: for the console. */
  startCoarse = -1;
  goalCoarse = -1;
  /**
   * Pairs of coarse cells the plane has already been shown not to join, oldest overwritten. Written
   * only for an answer that is a fact about the plane and not about a budget, so remembering one
   * can never turn a search that merely ran out of time into a refusal.
   */
  readonly refusedA = new Int32Array(REFUSED).fill(-1);
  readonly refusedB = new Int32Array(REFUSED).fill(-1);
  refusedAt = 0;
  /** How many plans were answered out of that ring rather than searched. */
  remembered = 0;

  /** Forget every refusal. Nothing in play calls it: a work object is made afresh with each world. */
  forget(): void {
    this.refusedA.fill(-1);
    this.refusedB.fill(-1);
    this.refusedAt = 0;
  }

  /**
   * `maxSlots` is how many coarse cells one corridor may hold, which is what sizes every fine
   * array here. A four-hundred-metre horizon with the wider corridor is about twelve hundred of
   * them, so two thousand is room to spare; it is a constructor argument rather than a knob because
   * moving it means making the arrays again.
   */
  constructor(header: OutdoorHeader, maxSlots = 2048) {
    const coarseCells = header.cnx * header.cnz;
    this.cg = new Float32Array(coarseCells);
    this.cParent = new Int32Array(coarseCells);
    this.cStamp = new Int32Array(coarseCells);
    this.cClosed = new Int32Array(coarseCells);
    this.heapK = new Int32Array(coarseCells + 1);
    this.heapF = new Float64Array(coarseCells + 1);
    this.slot = new Int32Array(coarseCells);
    this.slotStamp = new Int32Array(coarseCells);
    const cap = Math.max(256, Math.min(maxSlots, coarseCells));
    this.slotCell = new Int32Array(cap);
    const per = header.coarse * header.coarse;
    const win = cap * per;
    this.fg = new Float32Array(win);
    this.fParent = new Int32Array(win);
    this.fStamp = new Int32Array(win);
    this.fClosed = new Int32Array(win);
    // Four entries a cell: with a closed set a cell is pushed once for every cheaper way to it
    // that turns up, and a heap that runs out would drop the very entry the route needed.
    this.fHeapK = new Int32Array(win * 4 + 1);
    this.fHeapF = new Float64Array(win * 4 + 1);
    // A coarse route across a whole world is at most its diagonal in coarse cells; the fine path is
    // sampled down to fit here, since the string-pull throws away all but the corners anyway.
    const pts = Math.max(2048, Math.min(1 << 16, header.cnx + header.cnz + 64));
    this.raw = new Float64Array(pts * 2);
    this.pulled = new Float64Array(pts * 2);
    this.chain = new Int32Array(pts);
  }
}

// ---- reading the grid ---------------------------------------------------------------------------

/**
 * Turn a header and the inflated bytes into a grid, or null when the file says anything this does
 * not read. Nothing about a pack converted before this exists reaches here at all.
 */
export function decodeGrid(header: OutdoorHeader, bytes: Uint8Array): OutdoorGrid | null {
  if (!header || header.version !== NAV_GRID_VERSION) return null;
  if (!(header.nx > 0) || !(header.nz > 0) || !(header.cell > 0) || !(header.coarse > 0)) return null;
  const fineBytes = Math.ceil((header.nx * header.nz) / 2);
  const coarseBytes = header.cnx * header.cnz;
  if (bytes.length < fineBytes + coarseBytes * 2) return null;
  return {
    header,
    fine: bytes.subarray(0, fineBytes),
    coarse: bytes.subarray(fineBytes, fineBytes + coarseBytes),
    edges: bytes.subarray(fineBytes + coarseBytes, fineBytes + coarseBytes * 2),
  };
}

/** The nibble at a fine cell index. */
export function nibbleAt(g: OutdoorGrid, k: number): number {
  const b = g.fine[k >> 1];
  return k & 1 ? b >> 4 : b & 0x0f;
}

/** Fine cell index of a world point, or -1 outside the world. */
export function cellOf(g: OutdoorGrid, x: number, z: number): number {
  const h = g.header;
  const i = Math.floor((x - h.x0) / h.cell);
  const j = Math.floor((z - h.z0) / h.cell);
  if (i < 0 || j < 0 || i >= h.nx || j >= h.nz) return -1;
  return j * h.nx + i;
}

/** The middle of a fine cell, in world x. */
export function cellX(g: OutdoorGrid, k: number): number {
  const h = g.header;
  return h.x0 + ((k % h.nx) + 0.5) * h.cell;
}

export function cellZ(g: OutdoorGrid, k: number): number {
  const h = g.header;
  return h.z0 + (Math.floor(k / h.nx) + 0.5) * h.cell;
}

/** Open ground: walkable and outside every building's footprint. */
export function isOpen(g: OutdoorGrid, k: number): boolean {
  if (k < 0) return false;
  const v = nibbleAt(g, k);
  return v > NAV_BLOCKED && v < NAV_INDOOR;
}

/** Whether a fine cell stands inside a portal building's own footprint. */
export function isIndoor(g: OutdoorGrid, k: number): boolean {
  return k >= 0 && nibbleAt(g, k) === NAV_INDOOR;
}

/** 0 blocked, 1..13 a ranked region, 14 some smaller region, 15 indoor; -1 off the world. */
export function regionAt(g: OutdoorGrid, x: number, z: number): number {
  const k = cellOf(g, x, z);
  return k < 0 ? -1 : nibbleAt(g, k);
}

/**
 * The nearest open cell to a point, within `metres`, searched ring by ring so the first answer is
 * the nearest. A body really does stand on cells this grid calls blocked -- it is two metres and
 * the body is 0.7 m wide, and the margin refuses more than the body would -- so nothing here may
 * assume a body is standing anywhere in particular.
 */
export function nearestOpen(g: OutdoorGrid, x: number, z: number, metres: number): number {
  const h = g.header;
  const k0 = cellOf(g, x, z);
  if (k0 >= 0 && isOpen(g, k0)) return k0;
  const i0 = Math.floor((x - h.x0) / h.cell);
  const j0 = Math.floor((z - h.z0) / h.cell);
  const rings = Math.max(1, Math.ceil(metres / h.cell));
  for (let r = 1; r <= rings; r++) {
    for (let d = -r; d <= r; d++) {
      for (let s = 0; s < 4; s++) {
        const i = s < 2 ? i0 + d : s === 2 ? i0 - r : i0 + r;
        const j = s === 0 ? j0 - r : s === 1 ? j0 + r : j0 + d;
        if (i < 0 || j < 0 || i >= h.nx || j >= h.nz) continue;
        const k = j * h.nx + i;
        if (isOpen(g, k)) return k;
      }
    }
  }
  return -1;
}

/**
 * Whether a body could walk the straight line between two world points. A voxel walk over the fine
 * cells, refusing a diagonal step between two blocked ones -- a body cannot slip between two
 * corners and a search that lets it walks the drawn body through a wall.
 */
export function lineClear(g: OutdoorGrid, ax: number, az: number, bx: number, bz: number): boolean {
  const h = g.header;
  let i = Math.floor((ax - h.x0) / h.cell);
  let j = Math.floor((az - h.z0) / h.cell);
  const i1 = Math.floor((bx - h.x0) / h.cell);
  const j1 = Math.floor((bz - h.z0) / h.cell);
  if (i < 0 || j < 0 || i >= h.nx || j >= h.nz) return false;
  if (i1 < 0 || j1 < 0 || i1 >= h.nx || j1 >= h.nz) return false;
  if (!isOpen(g, j * h.nx + i)) return false;
  const dx = bx - ax;
  const dz = bz - az;
  const stepI = dx > 0 ? 1 : -1;
  const stepJ = dz > 0 ? 1 : -1;
  const tDeltaX = dx === 0 ? Infinity : Math.abs(h.cell / dx);
  const tDeltaZ = dz === 0 ? Infinity : Math.abs(h.cell / dz);
  const nextX = h.x0 + (i + (dx > 0 ? 1 : 0)) * h.cell;
  const nextZ = h.z0 + (j + (dz > 0 ? 1 : 0)) * h.cell;
  let tMaxX = dx === 0 ? Infinity : (nextX - ax) / dx;
  let tMaxZ = dz === 0 ? Infinity : (nextZ - az) / dz;
  let guard = 0;
  const cap = h.nx + h.nz + 4;
  while ((i !== i1 || j !== j1) && guard++ < cap) {
    if (tMaxX < tMaxZ) {
      i += stepI;
      tMaxX += tDeltaX;
    } else if (tMaxZ < tMaxX) {
      j += stepJ;
      tMaxZ += tDeltaZ;
    } else {
      // Exactly through a corner: both of the cells it passes between must be open.
      if (!isOpen(g, j * h.nx + (i + stepI)) || !isOpen(g, (j + stepJ) * h.nx + i)) return false;
      i += stepI;
      j += stepJ;
      tMaxX += tDeltaX;
      tMaxZ += tDeltaZ;
    }
    if (i < 0 || j < 0 || i >= h.nx || j >= h.nz) return false;
    if (!isOpen(g, j * h.nx + i)) return false;
  }
  return guard < cap;
}

// ---- the searches -------------------------------------------------------------------------------

const SQRT2 = Math.SQRT2;

/** The octile distance between two cells: the exact cost of an unobstructed eight-connected walk. */
function octile(di: number, dj: number): number {
  const a = Math.abs(di);
  const b = Math.abs(dj);
  return a > b ? a - b + SQRT2 * b : b - a + SQRT2 * a;
}

/**
 * Push, or refuse. A typed array silently drops a write past its end, so a heap that overflowed
 * would go on counting entries it does not hold and read zeros for them, which is a search that
 * quietly answers nonsense. Refusing instead can only make a search find nothing, which is a word
 * the caller already has.
 */
function heapPush(heapK: Int32Array, heapF: Float64Array, n: number, k: number, f: number): number {
  if (n + 1 >= heapK.length) return n;
  let i = n;
  heapK[i] = k;
  heapF[i] = f;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heapF[p] <= heapF[i]) break;
    const tk = heapK[p];
    const tf = heapF[p];
    heapK[p] = heapK[i];
    heapF[p] = heapF[i];
    heapK[i] = tk;
    heapF[i] = tf;
    i = p;
  }
  return n + 1;
}

function heapSift(heapK: Int32Array, heapF: Float64Array, n: number): void {
  let i = 0;
  for (;;) {
    const l = 2 * i + 1;
    const r = l + 1;
    let m = i;
    if (l < n && heapF[l] < heapF[m]) m = l;
    if (r < n && heapF[r] < heapF[m]) m = r;
    if (m === i) break;
    const tk = heapK[m];
    const tf = heapF[m];
    heapK[m] = heapK[i];
    heapF[m] = heapF[i];
    heapK[i] = tk;
    heapF[i] = tf;
    i = m;
  }
}

/**
 * A* over the coarse plane, eight-connected with no diagonal corner cutting. Returns the goal cell
 * when it arrived, -1 when the plane holds no route, or -2 when the budget ran out first -- which
 * are three different things and must not be answered alike: no route means the body may be told
 * so, and a spent budget means only that this step could not settle it.
 */
export function coarseSearch(g: OutdoorGrid, w: OutdoorWork, startC: number, goalC: number, tune: OutdoorTune = OUTDOOR_TUNE, deadline = Infinity): number {
  const h = g.header;
  const cnx = h.cnx;
  const cnz = h.cnz;
  const stamp = ++w.stampAt;
  w.opened = 0;
  if (startC < 0 || goalC < 0) return -1;
  if (!g.coarse[startC] || !g.coarse[goalC]) return -1;
  const gi = goalC % cnx;
  const gj = Math.floor(goalC / cnx);
  let n = 0;
  w.cg[startC] = 0;
  w.cParent[startC] = -1;
  w.cStamp[startC] = stamp;
  n = heapPush(w.heapK, w.heapF, n, startC, w.cg[startC] + octile((startC % cnx) - gi, Math.floor(startC / cnx) - gj) * tune.weight);
  while (n > 0) {
    const k = w.heapK[0];
    const f = w.heapF[0];
    n--;
    w.heapK[0] = w.heapK[n];
    w.heapF[0] = w.heapF[n];
    heapSift(w.heapK, w.heapF, n);
    const j = Math.floor(k / cnx);
    const i = k - j * cnx;
    const gk = w.cg[k];
    if (f > gk + octile(i - gi, j - gj) * tune.weight + 1e-6) continue;
    if (k === goalC) return k;
    if (w.cClosed[k] === stamp) continue;
    w.cClosed[k] = stamp;
    if (++w.opened > tune.coarseExpand) return -2;
    // The clock, not the count, is the promise a frame needs; the count is this machine's guess at
    // it. Read every `CLOCK_STRIDE` expansions, which costs nothing and bounds the answer anyway.
    if (w.opened % CLOCK_STRIDE === 0 && NOW() > deadline) return -2;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const jj = j + dj;
        const ii = i + di;
        if (jj < 0 || ii < 0 || jj >= cnz || ii >= cnx) continue;
        const kk = jj * cnx + ii;
        if (!g.coarse[kk]) continue;
        // The baked edge, not the share: a neighbour that is walkable and does not join is a wall.
        const idx = (dj + 1) * 3 + (di + 1);
        if (!(g.edges[k] & (1 << (idx < 4 ? idx : idx - 1)))) continue;
        const nd = gk + (di && dj ? SQRT2 : 1);
        if (w.cClosed[kk] === stamp) continue;
        if (w.cStamp[kk] === stamp && w.cg[kk] <= nd) continue;
        w.cStamp[kk] = stamp;
        w.cg[kk] = nd;
        w.cParent[kk] = k;
        // Pushed with the value as the array rounded it, so the stale-pop test above compares two
        // numbers that were arithmetic-for-arithmetic the same and never throws a live entry away.
        n = heapPush(w.heapK, w.heapF, n, kk, w.cg[kk] + octile(ii - gi, jj - gj) * tune.weight);
      }
    }
  }
  return -1;
}

/**
 * Whether the coarse plane joins `from` to `to`, walked by the very edges the search walks:
 * **1** it does, **0** it does not -- `from`'s whole component was enumerated and `to` was not in
 * it -- and **-1** the flood walked `cap` cells and settled nothing.
 *
 * It exists because the A* above is not symmetric in cost. A search from the body's own cell stops
 * of its own accord the moment the body's component is exhausted, so a body standing in a small
 * pocket is answered in a few hundred expansions. A **goal** in a small pocket is the opposite: the
 * search opens the body's whole component -- on the largest world that is 886,597 coarse cells --
 * looking for a cell that was never going to be in it, and the budget is all that ever stops it.
 * Measured on the shipped grid, that was 200,001 expansions and 44.5 ms, against 6.7 ms for the
 * longest route there really is, and it is not a rare shape of goal: 1.44% of the largest region's
 * ground stands in such a pocket, about one goal in seventy on the open desert.
 *
 * So every plan walks the **goal's** component first, capped, and a component small enough to
 * enumerate settles the question outright, which is what lets the answer be remembered rather than
 * paid for again every few seconds for ever. It runs before the A* rather than after it because it
 * is cheap enough to ask always: capped at 4,000 it costs 0.079 ms, measured on the shipped grid,
 * against a plan's own 0.05 to 0.3 ms -- and 4,000 covers every pocket that world has, whose
 * largest is 2,374 coarse cells and of whose 8,725 all but nine are 256 cells or fewer.
 */
export function coarseJoins(g: OutdoorGrid, w: OutdoorWork, from: number, to: number, cap: number): number {
  const h = g.header;
  w.floodOpened = 0;
  if (from < 0 || to < 0 || !g.coarse[from] || !g.coarse[to]) return 0;
  if (from === to) return 1;
  const stamp = ++w.stampAt;
  w.cStamp[from] = stamp;
  // The coarse heap's own array, which nothing else is using yet: it holds one entry per coarse
  // cell and a component can be no bigger than that, so a plain stack in it can never overflow.
  const stack = w.heapK;
  let top = 0;
  stack[top++] = from;
  while (top > 0) {
    const k = stack[--top];
    if (++w.floodOpened > cap) return -1;
    const j = Math.floor(k / h.cnx);
    const i = k - j * h.cnx;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const jj = j + dj;
        const ii = i + di;
        if (jj < 0 || ii < 0 || jj >= h.cnz || ii >= h.cnx) continue;
        const kk = jj * h.cnx + ii;
        if (w.cStamp[kk] === stamp || !g.coarse[kk]) continue;
        const idx = (dj + 1) * 3 + (di + 1);
        if (!(g.edges[k] & (1 << (idx < 4 ? idx : idx - 1)))) continue;
        if (kk === to) return 1;
        w.cStamp[kk] = stamp;
        if (top >= stack.length) return -1;
        stack[top++] = kk;
      }
    }
  }
  return 0;
}

/** The coarse route, start first, into `w.chain`. Returns how many cells long it is, or 0. */
export function unwindCoarse(w: OutdoorWork, end: number): number {
  let hops = 0;
  // Counted with a bound as well as an end. The parents are always this search's own and the start
  // carries -1, so the chain cannot loop -- but a walk with no bound is one that can hang the game
  // if it ever does, and the bound costs nothing.
  for (let k = end; k >= 0 && hops <= w.chain.length; k = w.cParent[k]) hops++;
  if (hops > w.chain.length) return 0;
  let at = hops;
  for (let k = end; k >= 0; k = w.cParent[k]) w.chain[--at] = k;
  return hops;
}

/**
 * Mark the corridor the fine search may walk in: the coarse cells `from`..`to` of the route just
 * unwound, and every one within `pad` of them. Each gets a slot, and the fine arrays are indexed by
 * that slot -- which is the whole trick, because it makes the fine search's cost the corridor's
 * size and not the world's. Returns the number of slots, or 0 when the corridor overflowed.
 */
export function markCorridor(g: OutdoorGrid, w: OutdoorWork, from: number, to: number, pad: number): number {
  const h = g.header;
  const gen = ++w.slotAt;
  w.slots = 0;
  for (let n = from; n <= to; n++) {
    const ci = w.chain[n] % h.cnx;
    const cj = Math.floor(w.chain[n] / h.cnx);
    for (let dj = -pad; dj <= pad; dj++) {
      for (let di = -pad; di <= pad; di++) {
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= h.cnx || j >= h.cnz) continue;
        const c = j * h.cnx + i;
        if (w.slotStamp[c] === gen) continue;
        if (w.slots >= w.slotCell.length) return 0;
        w.slotStamp[c] = gen;
        w.slot[c] = w.slots;
        w.slotCell[w.slots] = c;
        w.slots++;
      }
    }
  }
  return w.slots;
}

/**
 * A* over the fine cells inside the corridor. It is the real path a body would walk -- every cell
 * two metres, every diagonal checked against both of the cells it passes between -- and its cost is
 * the corridor's, which is bounded. Writes the path into `w.raw`, sampled down to fit, and returns
 * how many points it wrote.
 *
 * It does not have to be the shortest path. `fineWeight` leans it toward the goal and opens far
 * fewer cells for a route the string-pull is going to straighten anyway.
 */
export function corridorSearch(g: OutdoorGrid, w: OutdoorWork, startK: number, goalK: number, tune: OutdoorTune = OUTDOOR_TUNE, deadline = Infinity): number {
  const h = g.header;
  const per = h.coarse * h.coarse;
  const gen = w.slotAt;
  /** A fine world cell's index in the corridor's own arrays, or -1 when it is outside it. */
  const inside = (k: number): number => {
    const j = Math.floor(k / h.nx);
    const i = k - j * h.nx;
    const c = Math.floor(j / h.coarse) * h.cnx + Math.floor(i / h.coarse);
    if (w.slotStamp[c] !== gen) return -1;
    return w.slot[c] * per + (j % h.coarse) * h.coarse + (i % h.coarse);
  };
  const s = inside(startK);
  const t = inside(goalK);
  if (s < 0 || t < 0) return 0;
  const stamp = ++w.fStampAt;
  const gi = goalK % h.nx;
  const gj = Math.floor(goalK / h.nx);
  let n = 0;
  w.fg[s] = 0;
  w.fParent[s] = -1;
  w.fStamp[s] = stamp;
  n = heapPush(w.fHeapK, w.fHeapF, n, s, w.fg[s] + octile((startK % h.nx) - gi, Math.floor(startK / h.nx) - gj) * tune.fineWeight);
  // The world cell each corridor index stands for, so the path can be unwound without a second map.
  const worldOf = (idx: number): number => {
    const c = w.slotCell[Math.floor(idx / per)];
    const r = idx % per;
    const ci = c % h.cnx;
    const cj = Math.floor(c / h.cnx);
    return (cj * h.coarse + Math.floor(r / h.coarse)) * h.nx + (ci * h.coarse + (r % h.coarse));
  };
  let opened = 0;
  let found = -1;
  while (n > 0) {
    const idx = w.fHeapK[0];
    const f = w.fHeapF[0];
    n--;
    w.fHeapK[0] = w.fHeapK[n];
    w.fHeapF[0] = w.fHeapF[n];
    heapSift(w.fHeapK, w.fHeapF, n);
    if (idx === t) {
      found = idx;
      break;
    }
    const k = worldOf(idx);
    const j = Math.floor(k / h.nx);
    const i = k - j * h.nx;
    const gk = w.fg[idx];
    // A cell pushed more than once is popped more than once; without this the same cell is opened
    // again for every improvement it ever had, which on one corridor was eight times over.
    if (f > gk + octile(i - gi, j - gj) * tune.fineWeight + 1e-6) continue;
    if (w.fClosed[idx] === stamp) continue;
    w.fClosed[idx] = stamp;
    if (++opened > tune.fineExpand) break;
    if (opened % CLOCK_STRIDE === 0 && NOW() > deadline) break;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const jj = j + dj;
        const ii = i + di;
        if (jj < 0 || ii < 0 || jj >= h.nz || ii >= h.nx) continue;
        const world = jj * h.nx + ii;
        if (!isOpen(g, world)) continue;
        if (di && dj && (!isOpen(g, j * h.nx + ii) || !isOpen(g, jj * h.nx + i))) continue;
        const kk = inside(world);
        if (kk < 0) continue;
        const nd = gk + (di && dj ? SQRT2 : 1);
        if (w.fClosed[kk] === stamp) continue;
        if (w.fStamp[kk] === stamp && w.fg[kk] <= nd) continue;
        w.fStamp[kk] = stamp;
        w.fg[kk] = nd;
        w.fParent[kk] = idx;
        n = heapPush(w.fHeapK, w.fHeapF, n, kk, w.fg[kk] + octile(ii - gi, jj - gj) * tune.fineWeight);
      }
    }
  }
  w.fineOpened = opened;
  if (found < 0) return 0;
  let steps = 0;
  for (let k = found; k >= 0; k = w.fParent[k]) steps++;
  const capPts = Math.floor(w.raw.length / 2);
  // Sampled down rather than refused: eight metres between raw points is far finer than any corner
  // the string-pull will keep, and a ten-kilometre path is more cells than a buffer wants to hold.
  const step = Math.max(1, Math.ceil(steps / (capPts - 1)));
  let at = steps;
  let count = 0;
  // Walk it backwards into the buffer's tail, then reverse: the parents run goal-to-start.
  for (let k = found; k >= 0; k = w.fParent[k]) {
    at--;
    if (at % step !== 0 && at !== 0 && at !== steps - 1) continue;
    if (count >= capPts) break;
    const world = worldOf(k);
    w.raw[count * 2] = cellX(g, world);
    w.raw[count * 2 + 1] = cellZ(g, world);
    count++;
  }
  for (let a = 0, b = count - 1; a < b; a++, b--) {
    const x = w.raw[a * 2];
    const z = w.raw[a * 2 + 1];
    w.raw[a * 2] = w.raw[b * 2];
    w.raw[a * 2 + 1] = w.raw[b * 2 + 1];
    w.raw[b * 2] = x;
    w.raw[b * 2 + 1] = z;
  }
  return count;
}

/**
 * Throw away every corner the body did not need: each node is the farthest point still in clear
 * sight of the last. It is the sight test and not the spacing that matters -- nodes every
 * twenty-five metres along the same path with no sight test between them arrived nought times in
 * twenty, and the same path string-pulled arrived every time.
 */
export function stringPull(g: OutdoorGrid, raw: Float64Array, rawCount: number, out: Float64Array, tune: OutdoorTune = OUTDOOR_TUNE): number {
  if (rawCount <= 0) return 0;
  const cap = Math.floor(out.length / 2);
  let count = 0;
  let anchor = 0;
  let ax = raw[0];
  let az = raw[1];
  while (anchor < rawCount - 1 && count < cap) {
    let best = anchor + 1;
    let misses = 0;
    for (let k = anchor + 1; k < rawCount; k++) {
      const x = raw[k * 2];
      const z = raw[k * 2 + 1];
      if (Math.hypot(x - ax, z - az) > tune.pullCap) break;
      if (lineClear(g, ax, az, x, z)) {
        best = k;
        misses = 0;
      } else if (++misses >= tune.pullMiss) break;
    }
    anchor = best;
    ax = raw[anchor * 2];
    az = raw[anchor * 2 + 1];
    out[count * 2] = ax;
    out[count * 2 + 1] = az;
    count++;
  }
  return count;
}

/**
 * The nearest open cell to a point that stands in a given region, within `metres`. A goal snapped
 * into a walled pocket beside the body's own ground is the commonest false "you cannot get there",
 * so the search is told which ground counts. `rank` above the ranked regions means "any", because
 * the bake cannot tell one small region from another.
 */
export function nearestOpenIn(g: OutdoorGrid, x: number, z: number, metres: number, rank: number): number {
  if (rank > NAV_RANKS) return nearestOpen(g, x, z, metres);
  const h = g.header;
  const i0 = Math.floor((x - h.x0) / h.cell);
  const j0 = Math.floor((z - h.z0) / h.cell);
  const rings = Math.max(1, Math.ceil(metres / h.cell));
  const hit = (i: number, j: number): number => {
    if (i < 0 || j < 0 || i >= h.nx || j >= h.nz) return -1;
    const k = j * h.nx + i;
    return nibbleAt(g, k) === rank ? k : -1;
  };
  let k = hit(i0, j0);
  if (k >= 0) return k;
  for (let r = 1; r <= rings; r++) {
    for (let d = -r; d <= r; d++) {
      k = hit(i0 + d, j0 - r);
      if (k >= 0) return k;
      k = hit(i0 + d, j0 + r);
      if (k >= 0) return k;
      k = hit(i0 - r, j0 + d);
      if (k >= 0) return k;
      k = hit(i0 + r, j0 + d);
      if (k >= 0) return k;
    }
  }
  return -1;
}

/** The nearest coarse cell the plane offers, within `rings` coarse cells; the one given back if none. */
function nearestCoarse(g: OutdoorGrid, c: number, rings: number): number {
  const h = g.header;
  const i0 = c % h.cnx;
  const j0 = Math.floor(c / h.cnx);
  for (let r = 1; r <= rings; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di;
        const j = j0 + dj;
        if (i < 0 || j < 0 || i >= h.cnx || j >= h.cnz) continue;
        if (g.coarse[j * h.cnx + i]) return j * h.cnx + i;
      }
    }
  }
  return c;
}

/**
 * The whole plan: from where a body stands to where it is being sent, as corners in `w.pulled`.
 *
 * It answers one of six things, and they are deliberately different words. 'straight' is the
 * ordinary thirty-metre chase, where the line is clear and there is nothing to add, which is the
 * ten-thousand-times-commoner case and must not pay for a search. 'nowhere' is a goal with no open
 * ground near it at all. 'unreachable' is a goal on walkable ground this body's ground is not
 * joined to -- which is the one thing only the bake can say, and the reason a body can be told a
 * place cannot be walked to instead of leaning on a wall all evening. 'unjoined' is the sixteen-
 * metre plane refusing what the ground allows, which is a fact about the plane and is remembered.
 * 'spent' is a budget that ran out, which says nothing about the world at all and must never be
 * read as a refusal or remembered. 'found' is corners.
 */
export function planRoute(
  g: OutdoorGrid,
  w: OutdoorWork,
  sx: number,
  sz: number,
  gx: number,
  gz: number,
  tune: OutdoorTune = OUTDOOR_TUNE,
): PlanOutcome {
  const h = g.header;
  w.rawCount = 0;
  w.pulledCount = 0;
  w.fineOpened = 0;
  w.widened = 0;
  w.floodOpened = 0;
  w.flood = 0;
  w.opened = 0;
  w.startCoarse = -1;
  w.goalCoarse = -1;
  const deadline = tune.planMs > 0 ? NOW() + tune.planMs : Infinity;
  const startK = nearestOpen(g, sx, sz, tune.snap);
  if (startK < 0) return 'nowhere';
  const startRank = nibbleAt(g, startK);
  const goalK = nearestOpenIn(g, gx, gz, tune.goalSnap, startRank);
  if (goalK < 0) return nearestOpen(g, gx, gz, tune.goalSnap) < 0 ? 'nowhere' : 'unreachable';
  const sxc = cellX(g, startK);
  const szc = cellZ(g, startK);
  const gxc = cellX(g, goalK);
  const gzc = cellZ(g, goalK);
  if (Math.hypot(gxc - sxc, gzc - szc) <= tune.straight && lineClear(g, sxc, szc, gxc, gzc)) return 'straight';

  const coarseOf = (k: number): number => {
    const j = Math.floor(k / h.nx);
    const i = k - j * h.nx;
    return Math.floor(j / h.coarse) * h.cnx + Math.floor(i / h.coarse);
  };
  // A body standing in a coarse cell the plane refuses (a narrow yard, a ledge) still has to start
  // somewhere: take the nearest coarse cell that is offered.
  let startC = coarseOf(startK);
  let goalC = coarseOf(goalK);
  if (!g.coarse[startC]) startC = nearestCoarse(g, startC, 3);
  if (!g.coarse[goalC]) goalC = nearestCoarse(g, goalC, 3);
  w.startCoarse = startC;
  w.goalCoarse = goalC;
  // A pair the plane has already been shown not to join is answered without a search. The plane
  // does not change while a world is loaded, so this cannot go stale, and without it the one goal
  // in seventy that lands in a pocket of the plane costs its whole budget again every `retry`
  // seconds, for ever, for every body that asks.
  for (let i = 0; i < w.refusedA.length; i++) {
    if (w.refusedA[i] === startC && w.refusedB[i] === goalC) {
      w.remembered++;
      return 'unjoined';
    }
  }
  const refuse = (): PlanOutcome => {
    w.refusedA[w.refusedAt] = startC;
    w.refusedB[w.refusedAt] = goalC;
    w.refusedAt = (w.refusedAt + 1) % w.refusedA.length;
    return 'unjoined';
  };
  // The cheap question, asked from the goal's end, before the expensive one is asked from the
  // body's. The A* below costs the **body's** component, so a body in a pocket is answered in a few
  // hundred expansions and a body on the open desert whose goal is in a pocket is answered by the
  // budget alone -- which was 200,001 expansions and 36 to 44 ms on the shipped grid, against 6.6 ms
  // for the longest route the world really has. The flood costs the **goal's** component, capped,
  // and that is the other way round, so the two together are bounded by whichever end is smaller.
  //
  // The cap is what makes it affordable to ask always rather than only after a failure: a flood
  // that runs to a cap of 4,000 costs 0.079 ms, measured, against a plan's own 0.05 to 0.3 ms, and
  // 4,000 covers every one of the largest world's 8,725 pockets -- the biggest is 2,374 coarse
  // cells and 8,716 of them are 256 or fewer.
  if (tune.componentCap > 0) {
    w.flood = coarseJoins(g, w, goalC, startC, tune.componentCap);
    if (w.flood === 0) return refuse();
  }
  const end = coarseSearch(g, w, startC, goalC, tune, deadline);
  if (end === -2) return 'spent';
  // The search exhausted the body's own component without reaching the goal: the plane holds no
  // route between them, whatever the ground under it says, and that will be true next time too.
  if (end < 0) return refuse();

  const hops = unwindCoarse(w, end);
  if (!hops) return 'spent';

  // Only the next stretch is planned in detail. The coarse route across a whole world is cheap; the
  // fine cells under it are not -- eight kilometres of corridor is a quarter of a million of them,
  // which is tens of milliseconds and belongs to no single frame. So the fine search runs as far as
  // `horizon` along the route and the body asks again when it has walked its corners out, which is
  // what the agent already does indoors when it leaves a room.
  let last = hops - 1;
  const hx = cellX(g, startK);
  const hz = cellZ(g, startK);
  for (let n = 1; n < hops; n++) {
    const ci = w.chain[n] % h.cnx;
    const cj = Math.floor(w.chain[n] / h.cnx);
    const mx = h.x0 + (ci * h.coarse + h.coarse * 0.5) * h.cell;
    const mz = h.z0 + (cj * h.coarse + h.coarse * 0.5) * h.cell;
    if (Math.hypot(mx - hx, mz - hz) >= tune.horizon) {
      last = n;
      break;
    }
  }
  let fineGoal = goalK;
  if (last < hops - 1) {
    const ci = w.chain[last] % h.cnx;
    const cj = Math.floor(w.chain[last] / h.cnx);
    const mid = (cj * h.coarse + (h.coarse >> 1)) * h.nx + (ci * h.coarse + (h.coarse >> 1));
    const open = isOpen(g, mid) ? mid : nearestOpen(g, cellX(g, mid), cellZ(g, mid), h.coarse * h.cell);
    if (open >= 0) fineGoal = open;
    else last = hops - 1;
  }

  // The coarse route says where to look; the fine search inside its corridor says where to walk. A
  // corridor one coarse cell either side is a band three coarse cells wide, which is enough on open
  // ground and not always enough in a town, so a corridor that finds nothing is widened once.
  let count = 0;
  for (let attempt = 0; attempt < 2 && count === 0; attempt++) {
    const pad = attempt === 0 ? tune.corridor : tune.corridorAgain;
    if (attempt > 0) w.widened++;
    if (!markCorridor(g, w, 0, last, pad)) break;
    count = corridorSearch(g, w, startK, fineGoal, tune, deadline);
  }
  if (count === 0) return 'spent';
  w.rawCount = count;
  w.pulledCount = stringPull(g, w.raw, count, w.pulled, tune);
  return w.pulledCount > 0 ? 'found' : 'spent';
}

