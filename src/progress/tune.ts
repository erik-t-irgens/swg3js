// Every number progression is ruled by, in one place: what a node costs and does, how a core skill's rating
// grows and what it steadies, how much a won fight pays (the payout's numbers are written here now and read by
// the encounters' wave), how long a record's lists may grow, and this browser's own pacing. Pure, and nothing
// imported, so the server runs this very file under node's type stripping as it runs the story's rules.
//
// Each number carries where it came from: **[doc]** the owner's own design document, **[ours]** invented
// here and the owner's to move, **[game]** the client's archives. Nothing here is the client's.
//
// **Two hosts, one record.** A host makes a batch under its own limits (`PROGRESS_LIMITS`, which a server
// moves with `--set progress.limits.<name>=n`) and writes every trim it decides as a change of its own; a
// batch another host made, and a record another host handed down or wrote into storage, are applied and read
// under `PROGRESS_BACKSTOP`, ten times each list and never moved by anybody, so two hosts whose limits differ
// never cut one record two ways (the story book's own rule, `BACKSTOP_LIMITS`). The rules' own caps (Skill
// Points, a core skill's XP, a pool's bank, the rested bonus) have a backstop of the same kind for the same
// reason, `PROGRESS_RULE_BACKSTOP`.

/** The rules every host works progress out by. A server keeps its own copy, which `--set progress.rules.<name>=n` moves. */
export const PROGRESS_RULES = {
  /** Skill Points a character has to spend, from creation, never earned [doc]. */
  spCap: 250,
  /** Days within which a surrendered node is learnt again for a share of its XP [doc]. */
  relearnDays: 30,
  /** That share [doc]. */
  relearnShare: 0.5,
  /** Credits to surrender a node, times its tier plus one: Novice 500 to Master 3,000 [ours]. */
  feePerTier: 500,
  /** A core skill's rating r needs `coreK x r^coreExp` XP in all: 40,000 to reach 100 [ours]. */
  coreK: 40,
  coreExp: 1.5,
  /**
   * 0 pays every pool against the one challenge level Skill Points spent give [doc]; 1 pays each core skill
   * against a challenge of its own, `1 + rating x 89 / 100`, and only the disciplines against Skill Points [ours].
   */
  coreChallenge: 0,
  /**
   * What each core skill does at 100 (a curve, met a hundredth at a time as the rating rises) and at its
   * milestones (met whole once reached). Every one [ours] but the 8 m roll, which is the doc's.
   */
  core: {
    marksmanship: {
      /** Hip and aimed spread at 100. */
      spread: 0.8,
      aimSpread: 0.8,
      /** 25, steady breath: the aimed spread after `steadyAfter` seconds aimed and still. */
      steady: 0.5,
      steadyAfter: 1,
      /** 50, snap aim: the view's per-frame blend to the shoulder, twice as fast as today's 0.15 (1 - 0.85 x 0.85). */
      aimRate: 0.2775,
    },
    melee: {
      /** The player's own saber swings, and the kicks' and bare hands' shove, at 100. */
      swing: 1.1,
      push: 1.25,
    },
    fortitude: {
      /** Whole health added at 100. */
      health: 25,
      /** A burn's seconds at 100, and again at 25 (faster stun recovery, read as burns). */
      burn: 0.75,
      burnMore: 0.5,
    },
    acrobatics: {
      /** Metres added to how far a fall hurts nothing, at 100. */
      safeExtra: 3,
      /** Added to what a landing roll divides a fall's harm by (3, so 10 at 100). */
      rollDivisor: 7,
      /** Air control at 100. */
      airAccel: 1.5,
      /** Seconds at the start of a roll no blow lands in, at 100. */
      iframes: 0.15,
      /** 25: a landing roll from no higher than this many metres takes nothing [doc]. */
      rollFree: 8,
      /** The grapple's sway, its push and its cap, at 100: a swing built a quarter harder (the grapple pass, §3.16). */
      grappleSwing: 1.25,
    },
  },
  /** What each Demolitions node does, by its name here (`demolitions.ts` names which node reads which). */
  demo: {
    /** Steady Arm: the throw's speed and its lift together, solved so the reference throw lands 25% further [ours, the doc's +25%]. */
    steadyArm: 1.136,
    /** Launcher Familiarity: the homing rocket's pick cone, as a cosine (26 degrees off the crosshair to 37) [ours]. */
    pickCos: 0.8,
    /** Quick Reload: the launcher's refire [ours, the doc's "-25% reload" read as refire]. */
    quickReload: 0.75,
    /** Demolition Expert: machines take this many times what they took [ours]. */
    expert: 1.5,
    /** Blast Discipline: your own blast on you [doc, -40%]. */
    blastDiscipline: 0.6,
    /** Shrapnel Casing: a grenade's and a charge's radius [doc, +20%]. */
    shrapnel: 1.2,
    /** Chain Detonation: a blast sets off charges within this share of its radius [ours]. */
    chainReach: 1,
    /** Det packs out at once with Detonite Handling, and with Chain Detonation [doc: "carry 3"]. */
    packs: 2,
    packsChain: 3,
    /** Twin Toss: grenades a throw, and the grenades' cooldown [ours]. */
    twinCount: 2,
    twinCooldown: 0.5,
    /** Improvised Ordnance: throws a grenade holds [ours, a stand-in for crafting]. */
    stock: 2,
    /** Ion & Concussion: seconds staggered within half the radius [ours]. */
    stagger: 0.5,
  },
  /** XP a dead member of a won fight is worth before its band [ours]. */
  base: 25,
  /** What each band of the challenge table pays of that [ours]: grey almost nothing, the top capped. */
  band: { grey: 0.02, green: 0.3, lightBlue: 0.6, blue: 0.85, white: 1, yellow: 1.1, orange: 1.2, red: 1.3, purple: 1.4 },
  /**
   * With no challenge table converted, the lowest gap (target's level less the challenge) of each band above
   * grey; a gap under green's is grey [ours]. The table itself is read the same way: each column the lowest
   * level of its band.
   */
  gaps: { green: -10, lightBlue: -6, blue: -3, white: 0, yellow: 1, orange: 4, red: 7, purple: 10 },
  /** The most one fight pays a pool [ours]. */
  encounterCap: 400,
  /** What a close loss pays of a win, and how close it must be: the members' health left at most this share [ours, the doc's 10-15%]. */
  trickle: 0.1,
  closeShare: 0.25,
  /** Diminishing returns on one creature: within this many seconds each repeat pays this much of the last, down to the floor [ours]. */
  drWindow: 900,
  drStep: 0.8,
  drFloor: 0.2,
  /** A first win over a creature, and on a planet, pays this much more each, at most `noveltyMax` together [ours]. */
  novelty: 0.5,
  noveltyMax: 1,
  /** The rested bonus: after this many seconds away, this much XP an hour up to the most, doubling what a fight pays until spent [ours]. */
  restedAfter: 14400,
  restedPerHour: 100,
  restedMax: 2000,
  /** XP a pool may gain in a minute, and the most the bucket holds [ours]. */
  perMinute: 600,
  bucketMax: 1800,
  /** The most XP a discipline's pool banks [ours]. */
  bankCap: 50000,
  /** Seconds after which a claim pays nothing, and for which its id is kept [ours]. */
  claimMaxAge: 600,
  /** A landing roll's XP for each point of health it saved, at most a roll, and at most in any `drWindow` [ours]. */
  rollPerHp: 2,
  rollCap: 120,
  rollWindowCap: 120,
  /** Seconds within which a payout to the same pool rewrites the log's row rather than adding one [ours]. */
  logMerge: 300,
  /** Every payout times this: the developer's knob [ours]. */
  xpRate: 1,
};

export type ProgressRules = typeof PROGRESS_RULES;

/** How long each list a record keeps may grow [ours]. A full record at every one is about 14 KB. */
export interface ProgressLimits {
  seen: number;
  recent: number;
  paid: number;
  bonus: number;
  log: number;
  nodes: number;
  gone: number;
}

/** The limits a host makes its own batches under. A server moves its own with `--set progress.limits.<name>=n`. */
export const PROGRESS_LIMITS: ProgressLimits = { seen: 200, recent: 100, paid: 100, bonus: 200, log: 120, nodes: 64, gone: 64 };

/**
 * What a record another host decided is held to: its batches, its record handed down, and that record read back
 * out of storage. Ten times each list, a backstop against nonsense and never a second judgement, and never
 * moved by anybody.
 */
export const PROGRESS_BACKSTOP: Readonly<ProgressLimits> = Object.freeze({ seen: 2000, recent: 1000, paid: 1000, bonus: 2000, log: 1200, nodes: 640, gone: 640 });

/**
 * This browser's own pacing, every number ours. A record handed up to a server shares the first seconds after a
 * claim with the item list (sent at once, up to 56 KB) and the story book (in 24,000-character pieces every half
 * second), under the relay's 64 KB a browser may send in a second: so it waits `offerDelay` after the claim is
 * answered and then goes a piece of `offerChunk` every `offerGap`.
 */
export const PROGRESS_TUNE = {
  /** Times a second the encounters are looked at and the queue is flushed. */
  hz: 4,
  /** Claims kept while nobody may change the record, for whoever holds it next. */
  claimQueue: 8,
  /** Milliseconds after the line has the claim before a record handed up starts going, and the piece it goes in, and the gap between pieces. */
  offerDelay: 1500,
  offerChunk: 8000,
  offerGap: 1000,
  /** Milliseconds a claim (or a `sync`) waits for its answer before it is sent once more, with the same id. */
  claimWait: 10000,
  /** Milliseconds between two claims sent out of the queue, under the two a second a server takes from one line. */
  claimGap: 600,
};

/** Bumped whenever a rule moves, so what was worked out of the old ones is worked out again. */
export const PROGRESS_STAMP = { rules: 0 };

/** The range each rule may be moved within, and whether it is a whole number. A rule not named here is not moved. */
const RULE_RANGE: Record<string, [number, number, boolean?]> = {
  spCap: [0, 10000, true],
  relearnDays: [0, 3650],
  relearnShare: [0, 1],
  feePerTier: [0, 1e6, true],
  coreK: [1, 1e6],
  coreExp: [0.5, 4],
  coreChallenge: [0, 1, true],
  base: [0, 1e5],
  encounterCap: [0, 1e6],
  trickle: [0, 1],
  closeShare: [0, 1],
  drWindow: [0, 86400],
  drStep: [0, 1],
  drFloor: [0, 1],
  novelty: [0, 10],
  noveltyMax: [0, 10],
  restedAfter: [0, 1e7],
  restedPerHour: [0, 1e6],
  restedMax: [0, 1e7],
  perMinute: [0, 1e7],
  bucketMax: [0, 1e8],
  bankCap: [0, 1e9],
  claimMaxAge: [1, 86400],
  rollPerHp: [0, 1000],
  rollCap: [0, 1e6],
  rollWindowCap: [0, 1e7],
  logMerge: [0, 86400],
  xpRate: [0, 100],
};

/** A table of numbers moved in place, each held to its range; answers whether anything moved. */
function moveNumbers(into: Record<string, unknown>, from: Record<string, unknown>, range: (key: string) => [number, number, boolean?] | null): boolean {
  let moved = false;
  for (const k of Object.keys(from)) {
    if (!Object.hasOwn(into, k) || typeof into[k] !== 'number') continue;
    const v = from[k];
    const r = range(k);
    if (!r || typeof v !== 'number' || !Number.isFinite(v)) continue;
    const next = Math.max(r[0], Math.min(r[1], r[2] ? Math.round(v) : v));
    if (next !== into[k]) {
      into[k] = next;
      moved = true;
    }
  }
  return moved;
}

/** The range of a number inside one of the nested tables: a factor, an amount, a share or a whole count, by its table. */
function nestedRange(table: string, key: string): [number, number, boolean?] {
  if (table === 'band') return [0, 100];
  if (table === 'gaps') return [-100, 100, true];
  if (table === 'demo') return key === 'packs' || key === 'packsChain' ? [1, 6, true] : key === 'twinCount' || key === 'stock' ? [1, 10, true] : [0, 100];
  // The core skills' effects: a health amount may be large, everything else is a factor, a share or a few metres or seconds.
  return key === 'health' ? [0, 10000] : [0, 100];
}

export interface ProgressTuneAsk {
  rules?: Record<string, unknown>;
  limits?: Partial<ProgressLimits>;
  tune?: Partial<typeof PROGRESS_TUNE>;
  backstop?: unknown;
}

/** A copy of the rules a host may move without moving anybody else's: the server keeps one of its own. */
export function copyRules(from: ProgressRules = PROGRESS_RULES): ProgressRules {
  return JSON.parse(JSON.stringify(from)) as ProgressRules;
}

/** Every table of the rules frozen, so nothing anybody moves can reach a copy that must never move. */
function freezeDeep<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o as Record<string, unknown>)) freezeDeep(v);
    Object.freeze(o);
  }
  return o;
}

/**
 * What a record another host decided is held to when it is read -- a server's record handed down, that record read
 * back out of storage, and every record a server reads back out of its own file -- in the rules' own caps: the
 * Skill Points a tree may spend, a core skill's XP, a pool's bank and the rested bonus, each at the top of the range
 * any host may move it to (`RULE_RANGE`), and fixed. The limits' backstop for the rules' caps: a server run with
 * `--set progress.rules.bankCap` moved up writes pools past this browser's own cap, and read back under anybody's
 * own rules that record would be cut -- on the server's restart, in the browser's copy, in its storage -- each way
 * its own, and the copies would part at one revision. A host's own rules decide only what that host pays and what
 * it takes from a browser handing a record up.
 */
export const PROGRESS_RULE_BACKSTOP: Readonly<ProgressRules> = freezeDeep(
  Object.assign(copyRules(PROGRESS_RULES), {
    spCap: RULE_RANGE.spCap[1],
    coreK: RULE_RANGE.coreK[1],
    coreExp: RULE_RANGE.coreExp[1],
    bankCap: RULE_RANGE.bankCap[1],
    restedMax: RULE_RANGE.restedMax[1],
  }),
);

/**
 * Move the rules of one host in place (this browser's `PROGRESS_RULES`, or a server's own copy), each number held to
 * its range: a top-level rule by name, or one in the nested tables (`band`, `gaps`, `demo`, `core.<skill>`).
 * Answers whether anything moved.
 */
export function moveRules(into: ProgressRules, r: Record<string, unknown>): boolean {
  let moved = moveNumbers(into as unknown as Record<string, unknown>, r, (k) => RULE_RANGE[k] ?? null);
  for (const table of ['band', 'gaps', 'demo'] as const) {
    const t = r[table];
    if (t && typeof t === 'object') moved = moveNumbers(into[table] as unknown as Record<string, unknown>, t as Record<string, unknown>, (k) => nestedRange(table, k)) || moved;
  }
  const core = r.core;
  if (core && typeof core === 'object') {
    for (const skill of Object.keys(into.core) as (keyof ProgressRules['core'])[]) {
      const t = (core as Record<string, unknown>)[skill];
      if (t && typeof t === 'object') moved = moveNumbers(into.core[skill] as unknown as Record<string, unknown>, t as Record<string, unknown>, (k) => nestedRange('core', k)) || moved;
    }
  }
  return moved;
}

/**
 * Move one host's limits in place, never past the backstop's own for each list; answers the ones held there, as
 * `seen 2000`. A list grown past the backstop would be cut the next time the record is read back under it.
 */
export function moveLimits(into: ProgressLimits, asked: Record<string, unknown>): string[] {
  const top = (k: string): number => (Object.hasOwn(PROGRESS_BACKSTOP, k) ? PROGRESS_BACKSTOP[k as keyof ProgressLimits] : 1);
  moveNumbers(into as unknown as Record<string, unknown>, asked, (k) => [1, top(k), true]);
  const held: string[] = [];
  for (const k of Object.keys(asked)) {
    const v = asked[k];
    if (Object.hasOwn(into, k) && typeof v === 'number' && Number.isFinite(v) && Math.round(v) > top(k)) held.push(`${k} ${top(k)}`);
  }
  return held;
}

/**
 * Move any of the rules, the limits or the pacing, each held to what makes sense, in place; the backstop is never
 * moved, and asking to move it is said rather than done. A limit is never moved past the backstop's own for its
 * list (said in `held`): a list this host grew past it would be cut, oldest first, the next time the record is
 * read back under the backstop, and a payment cut so could be paid twice. Answers the tables as they now stand.
 */
export function tuneProgress(o: ProgressTuneAsk): { rules: ProgressRules; limits: ProgressLimits; tune: typeof PROGRESS_TUNE; refused?: string; held?: string } {
  let moved = false;
  if (o.rules && typeof o.rules === 'object') moved = moveRules(PROGRESS_RULES, o.rules as Record<string, unknown>);
  const held: string[] = [];
  if (o.limits && typeof o.limits === 'object') held.push(...moveLimits(PROGRESS_LIMITS, o.limits as Record<string, unknown>));
  if (o.tune && typeof o.tune === 'object') {
    moveNumbers(PROGRESS_TUNE as unknown as Record<string, unknown>, o.tune as Record<string, unknown>, (k) => (k === 'hz' ? [1, 60] : k === 'claimQueue' ? [1, 100, true] : [0, 600000, true]));
  }
  if (moved) PROGRESS_STAMP.rules++;
  const out: { rules: ProgressRules; limits: ProgressLimits; tune: typeof PROGRESS_TUNE; refused?: string; held?: string } = { rules: PROGRESS_RULES, limits: PROGRESS_LIMITS, tune: PROGRESS_TUNE };
  if (o.backstop !== undefined) out.refused = 'the backstop is fixed: it is what a record another host decided is held to, and nobody moves it';
  if (held.length) out.held = `held at the backstop, which a record read back is cut to: ${held.join(', ')}`;
  return out;
}
