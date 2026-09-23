// What being on fire does to the **player**: how a burn is taken, how it is paid for, and when the
// two lines are said. Pure, and it imports nothing, so a node test runs exactly what the game runs.
//
// **Every number in this file is ours.** The client had a fire state and a chime for it, and the
// archives say nothing at all about what it took off you or how often -- that was the server's and
// it did not ship. So the affliction itself comes from whoever lit it (a dps and a length of time,
// the one contract `Hittable.afflict` has always had), and the only numbers here are the ones that
// decide how the arithmetic is spent: how often a blow lands, and the guard on how long one
// affliction may keep you alight.
//
// Why a separate file at all, when the creatures, the fighters and the mobiles each keep the same
// pair of numbers inside their own update: those three lose a fraction of a hit point a frame and
// nobody sees it happen. The player's is felt -- it locks the regeneration out, it flashes the
// screen and it says a line -- so it has to land in blows rather than in crumbs, it has to say
// exactly one line when it starts and one when it goes out, and the total it costs has to come to
// what was asked for. That is four rules with edges, and rules with edges belong somewhere a node
// test can reach them.
//
// Nothing in here knows about a player, a world or a message line: `PlayerTarget` holds the state
// and takes the affliction, `Player.update` spends it on the same clock as the regeneration delay,
// and the caller says the words.

/**
 * One burn, all of it. It is a plain record so that the one the game uses can live on
 * `PlayerTarget` (which is what strikers reach) while the stepping happens in `Player.update`
 * (which is what pauses with a panel), with no third object in between.
 */
export interface PlayerBurn {
  /** Damage a second while it lasts, as whoever lit it asked for. */
  dps: number;
  /** Seconds of it left. 0 is not burning, and is the only thing anything outside need test. */
  left: number;
  /** Seconds since the last blow was paid for; what turns a fraction a frame into a blow a second. */
  clock: number;
  /**
   * Whether the "you are on fire" line has been said for this burn. It is here rather than in the
   * caller so that a burn lit and put out between two steps can never say the second line without
   * the first, and so that clearing the burn (a travel, a death) is silent by construction.
   */
  said: boolean;
}

/**
 * Ours, all three, live through `__debug.burn`.
 *
 * The client's own fire state is a chime and a look. What it cost, and how often, was the server's
 * and is in no archive, so there is deliberately nothing here pretending to be the client's.
 */
export const PLAYER_BURN = {
  /**
   * The switch. Off, nothing can set the player alight and a fire already lit goes out at the next
   * step in silence -- so the game is exactly what it was before this, which is the same shape the
   * lava's own switch has.
   */
  on: true,
  /**
   * Seconds between one blow and the next. A burn spent a fraction of a hit point a frame would
   * lock the regeneration out for ever (every blow sets that delay to five seconds) and would flash
   * the screen sixty times a second; a blow a second reads as burning and leaves the delay meaning
   * what it means everywhere else. The remainder is never lost **here**: whatever the clock holds
   * when the burn runs out is handed over in one last blow, so what this module asks for comes to
   * exactly `dps x seconds` however the frames fall.
   *
   * What becomes of a blow once it is handed over is the game's, and the game refuses some of them:
   * a rider's, and one falling due on the first simulated frame after a pause, where the record's
   * callback is still the frame before's and that frame was not simulating. So the total asked for
   * is exact and the total *paid* is that less whatever the game's own rule about what may hurt the
   * player refused -- which is a sentence worth having here rather than a promise that is not kept.
   */
  tick: 1,
  /**
   * The most seconds one affliction may set the player alight for. It is a guard and not a rule:
   * every burn in the game today is three seconds, so it never binds, and it is here because the
   * player is the one body whose burn is sat through rather than watched. Set it to `Infinity` for
   * the other bodies' behaviour exactly.
   */
  cap: 20,
};

/** The keys `__debug.burn` may write. */
export type PlayerBurnTune = Partial<Pick<typeof PLAYER_BURN, 'on' | 'tick' | 'cap'>>;

/** A burn that is not burning. */
export function newPlayerBurn(): PlayerBurn {
  return { dps: 0, left: 0, clock: 0, said: false };
}

/**
 * Everything forgotten, in silence: a death, a travel, a respawn, the switch going off. `said` goes
 * back with the rest, which is what makes the silence structural -- the next burn says its own
 * first line and nothing says a last one for this.
 */
export function clearBurn(b: PlayerBurn): void {
  b.dps = 0;
  b.left = 0;
  b.clock = 0;
  b.said = false;
}

/**
 * Set alight for a while. **The greater of `dps x seconds` wins**, which is the rule the creatures,
 * the fighters and the mobiles have always used, so a weak burn never cuts a strong one short and
 * two burns never stack into something neither striker asked for.
 *
 * Returns whether anything was written, which is only ever read by the console and the test: the
 * line is said by the step, not here, because a burn taken while the game is paused is not yet
 * something that has happened to anybody.
 *
 * Nothing that is not a finite, positive pair of numbers is taken. The other bodies do not guard
 * this and have got away with it; the player's would be a burn of NaN seconds that no death, no
 * travel and no tick could ever end.
 */
export function takeBurn(b: PlayerBurn, dps: number, seconds: number): boolean {
  if (!PLAYER_BURN.on) return false;
  if (!Number.isFinite(dps) || !Number.isFinite(seconds) || dps <= 0 || seconds <= 0) return false;
  const cap = PLAYER_BURN.cap > 0 ? PLAYER_BURN.cap : 0;
  const left = Number.isFinite(cap) ? Math.min(seconds, cap) : seconds;
  if (dps * left < b.dps * b.left) return false;
  // The clock is **not** put back: a burn renewed a tenth of a second before its blow lands should
  // land it, or standing in a fire that re-lights faster than the tick would never cost anything.
  // It is **re-priced**, though, and that is not the same thing. The seconds it holds were gathered
  // under the fire that is being replaced and are owed at *that* fire's rate; left alone they would
  // be paid at the new one's, so a burn of 1 a second that had gathered nine tenths of a second
  // unpaid, upgraded to 100, would charge 90 for them instead of nine tenths. Scaling the clock by
  // the ratio keeps the money exactly (`oldDps x clock` is what is owed, before and after) and
  // leaves the timing where it was to within the difference between the two rates. It does not bite
  // today, because every burn in the game is the same 8 a second; it is here because the day one of
  // them is not is not the day to discover it.
  //
  // Re-pricing downward (a gentle fire over a fierce one) can leave the clock holding more than a
  // tick, which `stepBurn` then pays off one blow a step until it is level. That is deliberate: the
  // seconds really are owed, and the choice is between paying them in a short burst and forgiving
  // them. Nothing in the game can reach it, since no two burns in it differ in rate.
  if (b.dps > 0 && b.clock > 0 && dps !== b.dps) b.clock = (b.clock * b.dps) / dps;
  b.dps = dps;
  b.left = left;
  return true;
}

/** What one step of a burn came to. One kept object: see `stepBurn`. */
export interface BurnStep {
  /** Damage to hand to the player's own damage path this step; 0 on most steps. */
  damage: number;
  /** This is the first step of a burn: say so, once. */
  started: boolean;
  /** The burn ran out on this step: say so, once. A burn cleared rather than spent ends silently. */
  ended: boolean;
}

/**
 * How little of a burn is nothing at all. Not a rule and not a number anybody may tune: it is the
 * slack a hundred and eighty additions of a sixtieth leave behind. Without it a three-second burn
 * ends a frame late with a last blow of a ten-trillionth of a hit point, which is a real blow as far
 * as the regeneration lockout and the red flash are concerned.
 */
const BURN_EPS = 1e-9;

/**
 * The one result, refilled. `stepBurn` is called once a frame from one place while a burn lasts, so
 * a kept object is right and a fresh one would be a small allocation a frame for the length of every
 * fire; the one rule it imposes is that the caller reads it before calling again, and the only
 * caller does.
 */
const stepResult: BurnStep = { damage: 0, started: false, ended: false };

/**
 * Spend `dt` seconds of the burn. Returns what this step owes and which of the two lines, if either,
 * falls due.
 *
 * The arithmetic in one breath: the clock gathers the seconds, a blow of `dps x tick` lands whenever
 * it has gathered a whole tick, and whatever it still holds when the burn runs out is paid at once.
 * So a burn of 8 a second for 3 seconds is three blows of 8 and nothing left over, and a burn of
 * 8 for 2.5 is 8, 8 and 4. The clock is wound back by one tick rather than put to zero, which is
 * the opposite of what the lava's own tick does and for the opposite reason: the lava charges a
 * share of a life for *standing somewhere* and must not charge twice for one long frame, while a
 * burn has a total it was asked for and must come to it.
 */
export function stepBurn(b: PlayerBurn, dt: number): BurnStep {
  const r = stepResult;
  r.damage = 0;
  r.started = false;
  r.ended = false;
  if (!(b.left > 0)) return r;
  // Switched off under a fire that is already lit: out, in silence, exactly as the lava's switch
  // forgets what it was doing rather than announcing an end it did not bring about.
  if (!PLAYER_BURN.on) {
    clearBurn(b);
    return r;
  }
  if (!Number.isFinite(dt) || dt <= 0) return r;
  if (!b.said) {
    b.said = true;
    r.started = true;
  }
  const step = Math.min(b.left, dt);
  b.left -= step;
  b.clock += step;
  const tick = Number.isFinite(PLAYER_BURN.tick) && PLAYER_BURN.tick > 0 ? PLAYER_BURN.tick : 1;
  if (b.left <= BURN_EPS) {
    // The last of it. Whatever the clock holds is owed, so the burn comes to exactly what was asked
    // for however the frames fell, and the burn is forgotten in the same step it is announced.
    r.damage = b.dps * b.clock;
    r.ended = true;
    clearBurn(b);
    return r;
  }
  if (b.clock >= tick) {
    r.damage = b.dps * tick;
    b.clock -= tick;
  }
  return r;
}

/** Write the knobs, ignoring anything that is not a finite number (or a boolean where one goes). */
export function tunePlayerBurn(t: PlayerBurnTune | undefined): typeof PLAYER_BURN {
  if (!t) return PLAYER_BURN;
  if (typeof t.on === 'boolean') PLAYER_BURN.on = t.on;
  if (typeof t.tick === 'number' && Number.isFinite(t.tick) && t.tick > 0) PLAYER_BURN.tick = t.tick;
  // Infinity is a real answer here -- "no guard at all" -- so it is the one non-finite value taken.
  if (typeof t.cap === 'number' && t.cap > 0) PLAYER_BURN.cap = t.cap;
  return PLAYER_BURN;
}

/** The burn as it stands and the numbers in force, for the console. */
export function burnReport(b: PlayerBurn): {
  on: boolean;
  burning: boolean;
  dps: number;
  left: number;
  clock: number;
  said: boolean;
  tick: number;
  cap: number;
  /**
   * What the **next** blow will come to; 0 when nothing is burning. It is not always a whole tick's
   * worth: the last blow of a burn pays whatever the clock holds, so a burn with less left than the
   * clock needs to reach a tick ends with a smaller one.
   */
  perTick: number;
  /**
   * What the rest of this burn will cost before it goes out. The seconds already gathered on the
   * clock are part of it -- they are unpaid and the last blow pays them -- so this is `dps` times
   * `left + clock` and not `dps x left`, which understates it by up to a whole tick's worth and is
   * the number the owner would be reading while judging the cadence.
   */
  toCome: number;
} {
  const tick = PLAYER_BURN.tick > 0 ? PLAYER_BURN.tick : 1;
  return {
    on: PLAYER_BURN.on,
    burning: b.left > 0,
    dps: b.dps,
    left: b.left,
    clock: b.clock,
    said: b.said,
    tick,
    cap: PLAYER_BURN.cap,
    // A whole tick when the seconds still to come can reach one (clock plus left), and the whole of
    // what is unpaid when they cannot, which is the last blow exactly.
    perTick: b.left > 0 ? b.dps * Math.min(tick, b.clock + b.left) : 0,
    toCome: b.left > 0 ? b.dps * (b.left + b.clock) : 0,
  };
}
