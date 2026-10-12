// The props a player has put down: what is standing, where, and how it is kept.
//
// The owner asked plainly that a thing put down should still be there next time -- **on the server, or
// on this machine when there is no server**. With a server that keeps them (its hail says `props`), a
// player's props are the server's, seen by everybody on that world (`src/net/propsKept.ts` stands them,
// `server/propsKept.mjs` decides); with none, they are this machine's, and this is where they are kept:
// per world, in the browser's own storage, shared by every character played on it, as its houses are.
//
// Rows this machine keeps wait for a game with no server. They are never handed up to a server on their
// own, and while a server keeps the player's things they are read and not stood (`enter`'s `stand`,
// `takeDownAll`); the moment it no longer does, they stand again (`standAll`).
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

/** How a prop in hand is given up: Escape (`back`), Put away (`away`), or a travel and the select screen (`keep`). */
export type LetGo = 'back' | 'away' | 'keep';

/**
 * What becomes of a prop given up while in hand, `pickedUp` saying whether it came out of the world:
 * `gone` thrown away for good, which writes nothing back (the row left the store when it was picked
 * up, and the Props tab is a catalogue with nothing to hand back); `stand` put back where it stood as
 * the same thing; `write` written back and not stood, since the world is going; `nothing` for one
 * taken fresh from the tab, which has nowhere to go back to.
 */
export function letGoOf(how: LetGo, pickedUp: boolean): 'gone' | 'stand' | 'write' | 'nothing' {
  if (how === 'away') return 'gone';
  if (!pickedUp) return 'nothing';
  return how === 'keep' ? 'write' : 'stand';
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
  /**
   * Whether these rows stand: this machine keeps the player's things. Off while a server keeps them, when the
   * rows are read and kept and nothing is stood (`enter`'s `stand`, `takeDownAll`, `standAll`).
   */
  private live = false;
  /** Which run of standing is in force: taking everything down, or a later run, moves it on and stops the one before. */
  private round = 0;
  /**
   * Which world load the rows stand in: coming to a world and leaving one move it on. A stand that lands after one
   * went with the world it was stood in, and is taken down here only while nothing of the next world stands or
   * goes up under its key, which it would otherwise take down instead.
   */
  private visit = 0;
  /**
   * Stands still going up, by thing, each with the promise that lands it: a run, a put-back or a change of keeper
   * that meets one already on its way waits on that one rather than starting a second under the same key, which
   * would file the key twice in the streamer and leave a copy no take-down can reach.
   */
  private readonly going = new Map<string, { ticket: number; run: Promise<boolean> }>();
  /** The number the next stand in `going` is filed under, so one let go of by an arrival never lets go of a later one. */
  private ticket = 0;
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

  /** Whether these rows stand (this machine keeps the player's things), for the console. */
  get standingHere(): boolean {
    return this.live;
  }

  /**
   * Come to a world: read what is kept for it, and stand the lot unless a server keeps the player's things
   * (`stand` false), when they are read and wait.
   *
   * Not awaited by whoever arrives -- standing a hundred models is a hundred loads -- and every
   * stand checks the world has not changed under it.
   */
  async enter(world: string, store: { get(key: string): string | null }, deps: PlacedDeps, stand = true): Promise<void> {
    this.world = world;
    this.rows = [];
    this.up.clear();
    this.going.clear();
    this.round++;
    this.visit++;
    this.live = false;
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
    if (stand) await this.standAll(deps);
  }

  /**
   * Stand every row not standing: this machine keeps the player's things from now on. A run is its own: one
   * taken over by a later run, or by everything being taken down, stands nothing more. A row already going up
   * is left to the stand on its way (`standOne`), which stands it as it lands if the rows still want it.
   */
  async standAll(deps: PlacedDeps): Promise<void> {
    this.live = true;
    const round = ++this.round;
    const visit = this.visit;
    for (const row of [...this.rows]) {
      if (this.round !== round || this.visit !== visit) return;
      if (this.up.has(row.thing) || this.going.has(row.thing)) continue;
      await this.standOne(row, deps);
    }
  }

  /**
   * Take every row down, and keep them: a server keeps the player's things from now on, and these wait on
   * this machine for a game with no server. Nothing is forgotten and nothing is written. One still going up
   * goes straight back down as it lands, unless the rows are stood again first.
   */
  takeDownAll(deps: PlacedDeps): void {
    this.live = false;
    this.round++;
    for (const thing of this.up) deps.clear(thing);
    this.up.clear();
  }

  /** Leave a world: nothing is forgotten, but nothing here is standing any more. */
  leave(): void {
    this.world = '';
    this.rows = [];
    this.up.clear();
    this.going.clear();
    this.round++;
    this.visit++;
    this.live = false;
  }

  /** Whether one is still going up, for the console and the tests. */
  isGoing(thing: string): boolean {
    return this.going.has(thing);
  }

  /**
   * Stand one row, once: a stand already on its way for the same thing is the one waited on, never a second
   * under its key. As it lands: in a world since left it went with that world, and is taken down here only while
   * nothing of this world stands or goes up under its key; otherwise it stands if these rows still want it (this
   * machine keeps them, and the row is still kept), and goes straight back down if not. Answers whether it stands.
   */
  private standOne(row: PlacedProp, deps: PlacedDeps): Promise<boolean> {
    const already = this.going.get(row.thing);
    if (already) return already.run.then(() => this.up.has(row.thing));
    const going = { ticket: ++this.ticket, run: Promise.resolve(false) };
    this.going.set(row.thing, going);
    going.run = this.land(row, deps, this.visit, going.ticket);
    return going.run;
  }

  /** The landing of one `standOne`: see there. */
  private async land(row: PlacedProp, deps: PlacedDeps, visit: number, ticket: number): Promise<boolean> {
    const thing = row.thing;
    try {
      const up = await deps.stand(row);
      if (this.visit !== visit) {
        if (up && !this.up.has(thing) && !this.going.has(thing)) deps.clear(thing);
        return false;
      }
      if (up && this.live && !this.up.has(thing) && this.rows.some((r) => r.thing === thing)) {
        this.up.add(thing);
        return true;
      }
      if (up) deps.clear(thing);
      return false;
    } finally {
      if (this.going.get(thing)?.ticket === ticket) this.going.delete(thing);
    }
  }

  /** Put one down and keep it. Answers the row, or null with `note` saying why not. */
  async put(id: string, at: { x: number; y: number; z: number }, q: [number, number, number, number], inside: boolean, deps: PlacedDeps, save: (world: string, rows: readonly PlacedProp[]) => void, now = Date.now(), rnd = Math.random): Promise<PlacedProp | null> {
    if (!this.world) {
      this.note = 'there is no world to put it in';
      return null;
    }
    if (!this.live) {
      this.note = 'a server keeps your things here, not this machine';
      return null;
    }
    if (this.rows.length >= PLACED_TUNE.most) {
      this.note = `${PLACED_TUNE.most} things is as many as one world will hold`;
      return null;
    }
    const row: PlacedProp = { thing: mintThing(now, rnd), id, x: at.x, y: at.y, z: at.z, q, ...(inside ? { inside: true } : {}) };
    const world = this.world;
    const up = await deps.stand(row);
    // The world may have changed while the model loaded (a travel, the select screen): the row is the
    // world it was put down in's, and must never be filed into the next one's store or stood there.
    if (this.world !== world) {
      if (up) deps.clear(row.thing);
      this.note = 'the world changed while it was being put down';
      return null;
    }
    // Or a server took the player's things over in the wait: what this machine keeps stands no longer, and a
    // thing taken fresh is not kept here to wait for a game with no server.
    if (!this.live) {
      if (up) deps.clear(row.thing);
      this.note = 'a server took your things over while it was being put down';
      return null;
    }
    if (!up) {
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

  /**
   * Put a row that was picked up back: the very same thing, under its own id, not a new one minted.
   *
   * The row goes back into the store **before** anything is awaited, so it is written down in the
   * same breath as the call even when standing it cannot finish: a travel lets go of a prop in hand
   * just before the world under it goes, and a re-put that waited on a model load used to land in a
   * world that had already gone, after the pick-up had taken the row out of the store, and the
   * thing was lost. With `stand` false it is only written down (the world is going anyway) and is
   * stood with everything else the next time the world is entered.
   *
   * Answers whether it is standing now. A row already in the store is not written twice.
   */
  async restore(row: PlacedProp, deps: PlacedDeps, save: (world: string, rows: readonly PlacedProp[]) => void, stand = true): Promise<boolean> {
    if (!this.world) {
      this.note = 'there is no world to put it back in';
      return false;
    }
    if (!this.rows.some((r) => r.thing === row.thing)) {
      this.rows.push({ ...row });
      save(this.world, this.rows);
    }
    // Kept and not stood while a server keeps the player's things: it waits on this machine with the rest.
    if (!stand || !this.live || this.up.has(row.thing)) return this.up.has(row.thing);
    // The world may change while the model loads, or everything be taken down in the wait: the row is kept either
    // way, and only a stand in the world it was put back into, still wanted as it lands, counts (`standOne`).
    if (await this.standOne(row, deps)) {
      this.note = '';
      return true;
    }
    this.note = 'it could not be stood again just now; it is kept, and stands the next time you come here';
    return false;
  }

  /**
   * Write a row into one world's keeping without standing it, whichever world this store is in now.
   *
   * For a row whose world has been left while it was in flight: a prop picked up, moved and refused
   * at its new spot goes back where it stood, and if a travel came while the new spot was being tried
   * the store is already another world's (or none), so the row goes straight into its own world's
   * stored list and stands with everything else on the next visit -- never into this store's rows,
   * which are another world's, and never lost. Answers whether it was written.
   */
  keepIn(world: string, row: PlacedProp, store: { get(key: string): string | null }, save: (world: string, rows: readonly PlacedProp[]) => void): boolean {
    if (!world) return false;
    if (world === this.world) {
      if (!this.rows.some((r) => r.thing === row.thing)) {
        this.rows.push({ ...row });
        save(this.world, this.rows);
      }
      return true;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(store.get(propsKey(world)) ?? '[]');
    } catch {
      raw = [];
    }
    const rows: PlacedProp[] = [];
    for (const r of Array.isArray(raw) ? raw : []) {
      const read = readRow(r);
      if (read) rows.push(read);
    }
    if (!rows.some((r) => r.thing === row.thing)) rows.push({ ...row });
    save(world, rows);
    return true;
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
