/**
 * How many sounds may play at once, and which gives way. Pure bookkeeping over integer keys: no
 * Web Audio, no allocation once the pools are made, so a node test can crowd it.
 *
 * The client's own voice limits are not in the archives, so every number here is INVENTED. They sit
 * together in VOICE_TUNE and `__debug.audio({ voices: { ... } })` moves them live.
 *
 * A sound's rank is its template priority first (0 wins), then how loud it would actually be. When
 * the pool is full the lowest-ranked voice gives way if the newcomer outranks it; otherwise a
 * one-shot is dropped and a loop is refused a slot and kept as a virtual voice by its owner, which
 * asks again on the next grid pass and resumes at its own clock's offset rather than from the top.
 */

export interface VoiceTune {
  /** INVENTED: positional slots. */
  positional: number;
  /** INVENTED: slots for sounds with no place (the cantina beds, a 2D template). */
  flat: number;
  /** INVENTED: the interface's own slots, which never compete with the world. */
  ui: number;
}

export const VOICE_TUNE: VoiceTune = { positional: 40, flat: 16, ui: 4 };

/** Which pool a want goes in. */
export type VoicePool = 'positional' | 'flat' | 'ui';

export interface VoiceWant {
  /** The caller's own handle. Any positive integer; 0 means nobody, so no slot ever reads as free by mistake. */
  key: number;
  /** The template's priority, 0 highest to 9. */
  priority: number;
  /** How loud it would be where the listener stands, 0 to 1. */
  gain: number;
  pool: VoicePool;
}

export interface VoiceGrant {
  /** The slot taken, or -1 when the newcomer was refused. */
  slot: number;
  /** The key that gave way, or 0. */
  stolen: number;
}

/** a outranks b: priority first, then the louder one. */
export function outranks(aPriority: number, aGain: number, bPriority: number, bGain: number): boolean {
  if (aPriority !== bPriority) return aPriority < bPriority;
  return aGain > bGain;
}

class Pool {
  readonly size: number;
  readonly owner: Int32Array;
  readonly priority: Int32Array;
  readonly gain: Float32Array;

  constructor(size: number) {
    this.size = size;
    this.owner = new Int32Array(size);
    this.priority = new Int32Array(size);
    this.gain = new Float32Array(size);
  }

  get used(): number {
    let n = 0;
    for (let i = 0; i < this.size; i++) if (this.owner[i]) n++;
    return n;
  }
}

const POOLS: readonly VoicePool[] = ['positional', 'flat', 'ui'];
/** Pool and slot in one integer, so a grant allocates nothing: pool index above, slot below. */
const packHeld = (pool: VoicePool, slot: number) => POOLS.indexOf(pool) * 65536 + slot;
const heldPool = (held: number) => POOLS[Math.floor(held / 65536)];
const heldSlot = (held: number) => held % 65536;

export class VoiceBudget {
  readonly tune: VoiceTune;
  private readonly pools: Record<VoicePool, Pool>;
  /** key -> its pool and slot, packed into one number. */
  private readonly slotOf = new Map<number, number>();
  /**
   * Counters for the headless report. `refusedCount` is asks refused, not sounds lost: a loop kept
   * as a virtual voice asks again on every grid pass, and each ask that fails is counted here. The
   * mixer's own counters tell the two apart.
   */
  stolenCount = 0;
  refusedCount = 0;

  constructor(tune: VoiceTune = VOICE_TUNE) {
    this.tune = tune;
    this.pools = {
      positional: new Pool(Math.max(1, tune.positional)),
      flat: new Pool(Math.max(1, tune.flat)),
      ui: new Pool(Math.max(1, tune.ui)),
    };
  }

  /** Ask for a slot. A key that already holds one keeps it and only has its rank refreshed. */
  request(want: VoiceWant): VoiceGrant {
    const held = this.slotOf.get(want.key);
    if (held !== undefined) {
      const p = this.pools[heldPool(held)];
      p.priority[heldSlot(held)] = want.priority;
      p.gain[heldSlot(held)] = want.gain;
      return { slot: heldSlot(held), stolen: 0 };
    }
    const pool = this.pools[want.pool];
    for (let i = 0; i < pool.size; i++) {
      if (!pool.owner[i]) {
        this.take(want, pool, i);
        return { slot: i, stolen: 0 };
      }
    }
    // Full: the weakest voice in the pool gives way only if the newcomer really outranks it.
    let worst = -1;
    for (let i = 0; i < pool.size; i++) {
      if (worst < 0 || outranks(pool.priority[worst], pool.gain[worst], pool.priority[i], pool.gain[i])) worst = i;
    }
    if (worst >= 0 && outranks(want.priority, want.gain, pool.priority[worst], pool.gain[worst])) {
      const stolen = pool.owner[worst];
      this.slotOf.delete(stolen);
      this.take(want, pool, worst);
      this.stolenCount++;
      return { slot: worst, stolen };
    }
    this.refusedCount++;
    return { slot: -1, stolen: 0 };
  }

  /** The voice ended, or its owner let it go. */
  release(key: number): void {
    const held = this.slotOf.get(key);
    if (held === undefined) return;
    const p = this.pools[heldPool(held)];
    p.owner[heldSlot(held)] = 0;
    p.priority[heldSlot(held)] = 9;
    p.gain[heldSlot(held)] = 0;
    this.slotOf.delete(key);
  }

  /** The grid's pass moved a voice: its rank follows, so the next newcomer steals the right one. */
  update(key: number, priority: number, gain: number): void {
    const held = this.slotOf.get(key);
    if (held === undefined) return;
    const p = this.pools[heldPool(held)];
    p.priority[heldSlot(held)] = priority;
    p.gain[heldSlot(held)] = gain;
  }

  slot(key: number): number {
    const held = this.slotOf.get(key);
    return held === undefined ? -1 : heldSlot(held);
  }

  poolOf(key: number): VoicePool | null {
    const held = this.slotOf.get(key);
    return held === undefined ? null : heldPool(held);
  }

  has(key: number): boolean {
    return this.slotOf.has(key);
  }

  clear(): void {
    for (const name of POOLS) {
      const p = this.pools[name];
      p.owner.fill(0);
      p.priority.fill(9);
      p.gain.fill(0);
    }
    this.slotOf.clear();
  }

  /** What a hidden tab can read instead of listening. */
  status(): { positional: number; flat: number; ui: number; size: VoiceTune; stolen: number; refused: number } {
    return {
      positional: this.pools.positional.used,
      flat: this.pools.flat.used,
      ui: this.pools.ui.used,
      size: { positional: this.pools.positional.size, flat: this.pools.flat.size, ui: this.pools.ui.size },
      stolen: this.stolenCount,
      refused: this.refusedCount,
    };
  }

  private take(want: VoiceWant, pool: Pool, slot: number): void {
    pool.owner[slot] = want.key;
    pool.priority[slot] = want.priority;
    pool.gain[slot] = want.gain;
    this.slotOf.set(want.key, packHeld(want.pool, slot));
  }
}

/** Keys handed out to voices and looping sources; never 0, so "nobody" can be stored as falsy. */
export function keySource(): () => number {
  let next = 1;
  return () => next++;
}
