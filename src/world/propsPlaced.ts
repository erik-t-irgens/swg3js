// The props a player has put down: what is standing, where, and how it is kept.
//
// A house and a prop are kept quite differently and the difference is the owner's. A house is the
// server's: how many there are, whose they are and that two are not in one spot are all things a
// second browser could disagree about, so nothing stands until the server says so, and with no
// server a house lasts the session. A prop is furniture. Nobody argues about a chair, there is no
// lot count and no upkeep, and the owner asked plainly that one put down should still be there next
// time -- **on the server, or on this machine when there is no server**.
//
// So this keeps them here, per world, in the browser's own storage, and is written so the server
// half is the same rows sent rather than a second way of doing it: `adopt` takes a list from
// anywhere, `mine` hands one back, and nothing in the file knows where the list came from.
//
// A row is the **thing's** id and not the model's. Dozens of props share an appearance, and a chair
// put down is that chair; which model it is drawn with is the pack's business and may change when a
// pack is converted again.
//
// Pure of three and of rapier: it asks the game for everything, so a node test can be the game.

/** One prop standing in a world. */
export interface PlacedProp {
  /** This one, minted when it was put down and never reused, so two of a kind are two things. */
  thing: string;
  /** The prop's catalogue id: what it is. */
  id: string;
  x: number;
  y: number;
  z: number;
  /** Its turn, about all three axes. */
  q: [number, number, number, number];
  /**
   * Whether it was put down in a room.
   *
   * Kept on the row rather than worked out when it is stood, because it is the placing player who
   * knows: a row is stood on arrival, from across the world, where nobody is standing in that room
   * and nothing about the point says which side of a wall it is on.
   */
  inside?: boolean;
}

/** What the store needs of the game. */
export interface PlacedDeps {
  /** Stand one; answers whether it went up. */
  stand(row: PlacedProp): Promise<boolean>;
  /** Take one down again, by the key it was stood under. */
  clear(thing: string): void;
}

/** Where this browser keeps them. One key a world, so travelling never mixes two. */
export function propsKey(world: string): string {
  return `swg.props.${world}`;
}

/** Every number here is ours. */
export const PLACED_TUNE = {
  /**
   * The most one player may have standing in one world.
   *
   * Not a rule of the game's -- there was none, a player's furniture was bounded by their lots --
   * but a browser that stood ten thousand chairs would stop drawing anything, and a number nobody
   * will reach in play is better than finding out the hard way.
   */
  most: 500,
};

/**
 * A new thing's id: the moment plus a little randomness.
 *
 * The same shape the backpack's own `mintThing` uses and for the same reason -- two of a kind must
 * be tellable apart, and the id must be one no other browser will mint. It is not
 * `crypto.randomUUID`, because a page served without a secure context has none.
 */
export function mintThing(now: number, rnd: () => number): string {
  const tail = Math.floor(rnd() * 0x10000000).toString(36);
  return `${now.toString(36)}${tail}`;
}

/** A row read back from storage, or null when it is not one. Nothing trusts what it finds there. */
export function readRow(raw: unknown): PlacedProp | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const x = num(r.x);
  const y = num(r.y);
  const z = num(r.z);
  const q = Array.isArray(r.q) && r.q.length === 4 ? r.q.map(num) : null;
  if (typeof r.id !== 'string' || !r.id || x === null || y === null || z === null) return null;
  if (!q || q.some((v) => v === null)) return null;
  const thing = typeof r.thing === 'string' && r.thing ? r.thing : '';
  if (!thing) return null;
  return { thing, id: r.id, x, y, z, q: q as [number, number, number, number], ...(r.inside ? { inside: true } : {}) };
}

/** What a list of rows comes to, for the console. */
export function placedTally(rows: readonly PlacedProp[]): { placed: number; kinds: number } {
  return { placed: rows.length, kinds: new Set(rows.map((r) => r.id)).size };
}

/**
 * The props standing in the world this browser is in.
 *
 * One of these for the session; a travel hands it the new world's rows and it stands them.
 */
export class PlacedProps {
  private rows: PlacedProp[] = [];
  private world = '';
  /** What is really up, by thing id, so a removal is exact. */
  private readonly up = new Set<string>();
  /** Why the last stand was refused, for the console. */
  note = '';

  get all(): readonly PlacedProp[] {
    return this.rows;
  }

  get standing(): number {
    return this.up.size;
  }

  /**
   * Which world the store is in, or '' for none.
   *
   * Worth reporting, because an empty one is the whole reason nothing could be put down: every `put`
   * answers "there is no world to put it in" and the cause is nowhere near the press.
   */
  get inWorld(): string {
    return this.world;
  }

  /**
   * Come to a world: read what is kept for it and stand the lot.
   *
   * Not awaited by whoever arrives -- standing a hundred models is a hundred loads -- and every
   * stand checks the world has not changed under it.
   */
  async enter(world: string, store: { get(key: string): string | null }, deps: PlacedDeps): Promise<void> {
    this.world = world;
    this.rows = [];
    this.up.clear();
    let raw: unknown;
    try {
      raw = JSON.parse(store.get(propsKey(world)) ?? '[]');
    } catch {
      raw = [];
    }
    for (const r of Array.isArray(raw) ? raw : []) {
      const row = readRow(r);
      if (row) this.rows.push(row);
    }
    const mine = this.world;
    for (const row of [...this.rows]) {
      if (this.world !== mine) return;
      if (await deps.stand(row)) this.up.add(row.thing);
    }
  }

  /** Leave a world: nothing is forgotten, but nothing here is standing any more. */
  leave(): void {
    this.world = '';
    this.rows = [];
    this.up.clear();
  }

  /** Put one down and keep it. Answers the row, or null with `note` saying why not. */
  async put(id: string, at: { x: number; y: number; z: number }, q: [number, number, number, number], inside: boolean, deps: PlacedDeps, save: (world: string, rows: readonly PlacedProp[]) => void, now = Date.now(), rnd = Math.random): Promise<PlacedProp | null> {
    if (!this.world) {
      this.note = 'there is no world to put it in';
      return null;
    }
    if (this.rows.length >= PLACED_TUNE.most) {
      this.note = `${PLACED_TUNE.most} things is as many as one world will hold`;
      return null;
    }
    const row: PlacedProp = { thing: mintThing(now, rnd), id, x: at.x, y: at.y, z: at.z, q, ...(inside ? { inside: true } : {}) };
    if (!(await deps.stand(row))) {
      this.note = 'it would not stand there';
      return null;
    }
    this.rows.push(row);
    this.up.add(row.thing);
    save(this.world, this.rows);
    this.note = '';
    return row;
  }

  /** Take one back up. Answers the row that went, or null. */
  take(thing: string, deps: PlacedDeps, save: (world: string, rows: readonly PlacedProp[]) => void): PlacedProp | null {
    const i = this.rows.findIndex((r) => r.thing === thing);
    if (i < 0) return null;
    const [row] = this.rows.splice(i, 1);
    this.up.delete(thing);
    deps.clear(thing);
    save(this.world, this.rows);
    return row;
  }

  /** The one nearest a point within `reach`, for "pick that up". */
  nearest(at: { x: number; y: number; z: number }, reach: number): PlacedProp | null {
    let best: PlacedProp | null = null;
    let bestD = reach;
    for (const r of this.rows) {
      const d = Math.hypot(r.x - at.x, r.y - at.y, r.z - at.z);
      if (d <= bestD) {
        bestD = d;
        best = r;
      }
    }
    return best;
  }

  /** Rows handed in from somewhere else (a server), in place of the browser's own. */
  adopt(world: string, rows: readonly PlacedProp[]): void {
    this.world = world;
    this.rows = rows.map((r) => ({ ...r }));
  }
}

/** One for the session, as the wildlife's and the standing people's are. */
export const placedProps = new PlacedProps();
