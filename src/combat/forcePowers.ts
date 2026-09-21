// The Force powers a Jedi can put in the number slots: what each is called, costs and does, in
// words; the Jedi kit does them. The four the game started with, and more after Jedi Academy
// (Pull, Grip, Heal, Protect, Drain, Rage), The Force Unleashed (Repulse) and Jedi: Survivor
// (Slow), and bare hands. A tap power fires on the key; a hold power lasts while the key is
// down; a toggle stays on until the key again, or the Force runs out. The Bounty Hunter's
// gadgets (gadgets.ts) fill the same slots the same way.
//
// And what each one *looks* like. The game's own Force effects are in the archives -- 37
// `pt_force_*.prt` particles, the `pl_force_*.cef` client effects that pair a particle with a
// sound, and the lightning beams -- and the weapons command converts them into the weapons pack as
// a `powers` block, a row per power. Two things are kept apart here and must stay apart:
//
//  - **Which effect a power wears is the pack's.** The game's own table of powers was its server's
//    and is not in the archives, so the pairing is ours, but it is made once, in the converter, and
//    written into the pack with a word saying whether the client's own `.cef` settles it or we did.
//    Nothing here holds a second copy of it; `fx.expect` below is a *key*, not a file, and is used
//    only to find a row the converter keyed by the game's own effect name rather than by our id.
//  - **When it is placed is this side's.** The pack's own row says what is drawn as the power fires,
//    what stands while it lasts and what plays where it arrives, and where each goes; `jedi.ts` is
//    what knows when those moments are, and `fx.place` here is only what answers when a row does
//    not say.
//
// A power whose row the pack has not got -- an older weapons pack, a power the archives have
// nothing for -- places nothing and looks exactly as it did before any of this existed. That is
// the whole of the fallback, and it is why `__debug.powers()` prints both what the pack said and
// what was asked of it.
//
// Nothing here imports three or rapier: the rules a power's effect is named and found by are the
// very rules a plain node test can drive (`saberHit.ts` and `scars.ts` are the same arrangement).
// Everything a frame can reach allocates nothing; the readout at the foot is the one that builds
// objects, and says so.

export type PowerKind = 'tap' | 'hold' | 'toggle';

/**
 * What a power sounds like. The sounds are the game's own `pl_force_*` templates, which come in two
 * shapes: a single `pl_force_<name>` for something that happens at once, and a start, a loop and an
 * end for something that lasts. WHICH set goes with which power is ours: the game's own table of
 * powers is the server's and is not in the archives, so the pairings below are read off the names
 * (choking for the grip, lightning for the lightning, strength for rage, healing for heal) and the
 * three that have no obvious partner -- pull, slow and protect -- are named in the hand-off as
 * guesses. Nothing here invents a sound: every id is a template the converter writes.
 *
 * Where the pack's own row names the sound the client effect carried, that one wins for a power
 * that fires once (`powerVoice` below), since it is the game's own answer to the same question.
 */
export interface PowerSounds {
  /** One sound, for a power that fires and is done. */
  once?: string;
  /** A power that lasts: one as it comes on, a loop while it does, one as it goes. */
  start?: string;
  loop?: string;
  end?: string;
}

/** Where a power's own effect is placed. */
export type PowerPlace =
  /** On the body using it: the heal's rise, the speed's blur, the shield. */
  | 'self'
  /** Just ahead of the body, at the hand, where a held power leaves it. */
  | 'hand'
  /** On what it reached. */
  | 'target';

/**
 * How one power wears the game's own effect. It holds no file and no pairing: both are the pack's,
 * whose row is looked up by the power's own id and, failing that, by `expect`. What is here is what
 * this side answers with when the pack's row does not say -- where an effect goes -- and what the
 * readout prints for a power the pack has no row for at all.
 */
export interface PowerFx {
  /**
   * The game's own name for the effect this power wears (`pt_force_<expect>.prt`), used only as a
   * second key into the pack's rows, and null for a power the archives have nothing for at all.
   */
  expect: string | null;
  /** Where an effect of this power's goes when the pack's own row does not say. */
  place: PowerPlace;
  /**
   * Whether the pairing is the client's own -- a `pl_force_*.cef` names the particle and the sound
   * together -- or ours, or there is nothing in the archives to pair with at all. Nothing here
   * invents a file: an invented pairing is one of the game's own effects worn by a power the game's
   * own table never had.
   */
  source: 'game' | 'invented' | 'none';
  /** Said plainly in the readout, for a power whose look is not the game's. */
  note?: string;
}

export interface PowerDef {
  id: string;
  name: string;
  /** Shown on the slot: a one-off cost, or a drain a second. */
  cost: string;
  kind: PowerKind;
  blurb: string;
  /** The game's own sounds for it (above); a power with none is silent. */
  sound?: PowerSounds;
  /** How it wears the game's own effect; a power with none places nothing and looks as it always did. */
  fx?: PowerFx;
}

/** A power that lasts, as the game's names have it: `pl_force_<x>_start`, `_lp` and `_end`. */
const lasting = (name: string): PowerSounds => ({ start: `sound/pl_force_${name}_start.snd`, loop: `sound/pl_force_${name}_lp.snd`, end: `sound/pl_force_${name}_end.snd` });
/** One that fires and is done. */
const once = (name: string): PowerSounds => ({ once: `sound/pl_force_${name}.snd` });

/** A power the archives have nothing for: it looks exactly as it did before the effects existed. */
const noFx = (note: string): PowerFx => ({ expect: null, place: 'self', source: 'none', note });

export const POWERS: PowerDef[] = [
  // The four with nothing in the archives at all (`pl_force_jump`, `_push`, `_blast` and `_tangle`
  // name a sound and no particle): each keeps the ring and the flash it has always thrown, and the
  // pack says so rather than leaving a hole.
  { id: 'jump', name: 'Force Jump', cost: '20', kind: 'tap', blurb: 'A leap eleven metres up, steered where you look.', sound: once('jump'), fx: noFx('the client effect names a sound and no particle: the ring is ours and is what it always was') },
  { id: 'speed', name: 'Force Speed', cost: '6/s', kind: 'toggle', blurb: 'Twice as fast on foot while it lasts.', sound: lasting('speed'), fx: { expect: 'speed_moves', place: 'self', source: 'game' } },
  { id: 'push', name: 'Force Push', cost: '25', kind: 'tap', blurb: 'Throws everything ahead of you away, and vehicles too.', sound: once('push'), fx: noFx('the client effect names a sound and no particle: the ring is ours and is what it always was') },
  // INVENTED: the game's own "force throw" set is the one that drags a body about, which is what
  // Pull does here.
  { id: 'pull', name: 'Force Pull', cost: '20', kind: 'tap', blurb: 'Drags everything ahead of you to your feet.', sound: once('throw'), fx: { expect: 'throw', place: 'self', source: 'game' } },
  { id: 'lightning', name: 'Force Lightning', cost: '18/s', kind: 'hold', blurb: 'A bolt at whatever is nearest ahead, hurting it while it lasts.', sound: { start: 'sound/pl_force_lightning_begin.snd', loop: 'sound/pl_force_lightning_lp.snd', end: 'sound/pl_force_lightning_end.snd' }, fx: { expect: 'lightning_start', place: 'hand', source: 'invented', note: "the eleven lightning particles are under names no client effect reaches, so which is the hand's and which the strike's is ours" } },
  { id: 'drain', name: 'Force Drain', cost: '10/s', kind: 'hold', blurb: 'Draws life out of what is nearest ahead and into you.', sound: lasting('weaken'), fx: { expect: 'weaken', place: 'hand', source: 'game' } },
  { id: 'grip', name: 'Force Grip', cost: '12/s', kind: 'hold', blurb: 'Lifts the creature under the crosshair and holds it in the air, choking it; let go to throw it.', sound: lasting('choke'), fx: { expect: 'choke', place: 'target', source: 'game' } },
  { id: 'repulse', name: 'Force Repulse', cost: '40', kind: 'tap', blurb: 'A blast in every direction that throws everything near you away.', sound: once('blast'), fx: noFx('the client effect names a sound and no particle: the blast is ours and is what it always was') },
  // INVENTED: the game has nothing for slowing a creature down, so the tangle -- a thing held where
  // it stands -- stands in for it.
  { id: 'slow', name: 'Force Slow', cost: '25', kind: 'tap', blurb: 'The creature under the crosshair lives at a crawl for five seconds.', sound: once('tangle'), fx: noFx('the tangle names a sound and no particle: the ring is ours and is what it always was') },
  { id: 'heal', name: 'Force Heal', cost: '30', kind: 'tap', blurb: 'Mends thirty-five health at once.', sound: once('healing'), fx: { expect: 'heal_self', place: 'self', source: 'game' } },
  // INVENTED: absorb is the nearest thing the game has to a guard held up, and it is a single
  // sound with no loop of its own, so the generic loop and end carry it while it lasts.
  { id: 'protect', name: 'Force Protect', cost: '5/s', kind: 'toggle', blurb: 'What hurts you counts for a third while it lasts.', sound: { start: 'sound/pl_force_absorb.snd', loop: 'sound/pl_force_generic_lp.snd', end: 'sound/pl_force_generic_end.snd' }, fx: { expect: 'absorb', place: 'self', source: 'game' } },
  // INVENTED: the game never had a rage, so nothing in the archives is its own; the armour is the
  // one effect of the game's that reads as something held about the body, and it is worn here with
  // that said plainly rather than left as the same blue spark every other power used to throw.
  { id: 'rage', name: 'Force Rage', cost: 'health', kind: 'toggle', blurb: 'Ten seconds faster and half again as hard with the blade, at a cost in health; then a rest.', sound: lasting('strength'), fx: { expect: 'armor', place: 'self', source: 'invented', note: "the game had no rage of its own: the armour's own effect is worn for it" } },
  { id: 'fists', name: 'Bare Hands', cost: 'none', kind: 'toggle', blurb: 'The saber put away: punches on the left mouse, kicks on the right, brawling the way the game did.' },
];

/** The number keys' actions, one per slot. */
export const SLOT_ACTIONS = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6'] as const;

export const DEFAULT_LOADOUT = ['jump', 'speed', 'push', 'lightning'];
/** How many number slots there are (1 to 6). */
export const SLOT_COUNT = 6;

export function powerById(id: string): PowerDef | undefined {
  return POWERS.find((p) => p.id === id);
}

// ---- the pack's own rows ----

/**
 * One row of the weapons pack's `powers` block: what the converter found for one power. Every field
 * is optional, because a pack converted before this wave has none of them and a power the archives
 * have nothing for has only the word saying so.
 */
export interface PowerFxRow {
  /** Our power's id, when the rows are a list rather than an object keyed by it. */
  power?: string;
  /** The game's own effect name the row was made from (`choke`, `heal_self`), the second key. */
  name?: string;
  /**
   * What it draws, in order: each part carries the moment it belongs to (`cast` as the power fires,
   * `hold` while it lasts, `land` where it arrives), where it goes (`hand`, `body`, `target`) and
   * the converted particle, pack-relative as a gun's own effects are. A part the archives had
   * nothing for carries no file and says what it looked for.
   */
  parts?: PowerFxPart[];
  /** The beam appearance this power is drawn with, a row of the block's own `beams`. */
  beam?: string | null;
  /** The sound the client effect names. */
  sound?: string | null;
  /** Whether the pairing is the game's own, ours, or there is nothing in the archives at all. */
  source?: string;
  /** Why it is what it is, in the converter's own words. */
  note?: string | null;
}

/** One thing a power draws, at one moment, in one place. */
export interface PowerFxPart {
  role?: string;
  at?: string;
  /** The converted particle, pack-relative; null when the archives held none of the files it tried. */
  file?: string | null;
  /** The particle it came from, for the readout. */
  particle?: string | null;
  sound?: string | null;
  /** What it looked for and did not find. */
  missing?: string[];
}

/**
 * The block as the weapons pack carries it: the powers themselves, and beside them everything the
 * command read on the way (every Force particle, every client effect, every beam appearance), which
 * the beam pool reads for its own picture and which nothing here needs.
 */
export interface ForcePowersPack {
  version?: number;
  powers?: PowerFxRow[];
  beams?: Record<string, { start?: string | null; end?: string | null }>;
  effects?: Record<string, unknown>;
  clientEffects?: Record<string, unknown>;
}

/** One thing a power draws, resolved: the file, and where this side puts it. */
export interface PowerPart {
  file: string;
  place: PowerPlace;
}

/**
 * What one power resolved to, worked out once when a pack is adopted and then only read. Three
 * moments at most, because that is what the pack's own rows have: one as it fires, one held while
 * it lasts, one where it arrives.
 */
export interface PowerEffect {
  cast: PowerPart | null;
  hold: PowerPart | null;
  land: PowerPart | null;
  /** The beam appearance the power is drawn with, when it has one; the beam pool's, never placed here. */
  beam: string | null;
  sound: string | null;
  /** The pack's word: 'game', 'invented' or 'none'. */
  source: string;
  note: string | null;
  /**
   * Parts left to the beam pool: a beam appearance names the effect at each of its own two ends and
   * plays them itself, so a row whose parts are those very files must not place them a second time.
   */
  viaBeam: number;
}

export interface ForceFxTune {
  /** 0 places no Force effect at all, which is the game exactly as it was before they existed. */
  on: number;
  /** The least seconds between two effects placed on a body a held power is hurting. */
  hitEvery: number;
  /** Metres ahead of the body an effect at the hand stands. */
  handAhead: number;
  /** Metres above the feet it stands. */
  handUp: number;
  /** Metres above the feet an effect on the body itself stands. */
  selfUp: number;
  /** Where up a struck body its own effect stands, as a share of its half height. */
  targetShare: number;
  /**
   * Whether a placed Force effect also plays whatever sounds its own emitters name. 0 (the default)
   * leaves every power's voice to the sabers, which already play the sound the client effect named
   * (`powerVoice`): a `pt_force_*` emitter that names the same sound its `pl_force_*.cef` does
   * would otherwise be heard twice, once from each side. 1 lets the effect speak for itself as well,
   * which is the way to hear whether a particle carries a sound the `.cef` never named.
   */
  fxSound: number;
}

/**
 * Every number the powers' own effects have. All of them are ours -- the archives say what an effect
 * looks like and nothing about where a power holds it -- and all of them are live through
 * `__debug.powers({ handUp: 1.2 })`.
 */
export const FORCE_FX: ForceFxTune = { on: 1, hitEvery: 0.25, handAhead: 0.4, handUp: 1.35, selfUp: 0.1, targetShare: 1, fxSound: 0 };

/**
 * What the powers' effects have done, for the readout. Numbers and one word only. The counts start
 * afresh at every world load (`prepareForceEffects` clears them), so what `__debug.powers()` prints
 * is what the powers have asked for on *this* world and can be read against a known start; a travel,
 * a jump or a change of character is that start.
 */
export const FORCE_FX_STATS = {
  /** Effects placed since the counts were cleared, and how many were asked for with nothing to place. */
  placed: 0,
  missing: 0,
  /** The last power to place one, and the file it placed. */
  last: '',
  lastFile: '',
};

/** The rows the pack gave us, by our own power id. Rebuilt whenever a pack is adopted. */
const resolved = new Map<string, PowerEffect>();
/** The manifest object the rows were read from, so the same one is never read twice. */
let readFrom: object | null = null;
/** What became of the last adoption, for the readout. */
let packState = 'no weapons pack yet';
/** The voices the sounds are played through: one kept object per power, made when a pack is adopted. */
const voices = new Map<string, PowerDef>();

/**
 * Read the `powers` block off a weapons manifest. It is handed the manifest itself rather than the
 * block, so that the one place that knows where the block lives is here; it is safe to call on
 * every frame (the same object is read once) and safe to call with anything at all.
 *
 * Returns true when this call read a pack it had not read before.
 */
export function adoptPowerPack(manifest: unknown): boolean {
  if (!manifest || typeof manifest !== 'object' || manifest === readFrom) return false;
  readFrom = manifest as object;
  const block = (manifest as { powers?: unknown }).powers;
  return adoptPowerEffects(block);
}

/**
 * The block itself, for a test and for anything that reads a pack by hand. Two shapes are taken,
 * because reading a pack must never be a version check: the block as the command writes it (a
 * `powers` list of rows beside everything it read on the way), and a bare list or an object keyed
 * by the power, which is what a pack written any other sensible way would be.
 */
export function adoptPowerEffects(block: unknown): boolean {
  resolved.clear();
  voices.clear();
  if (!block || typeof block !== 'object') {
    packState = 'the weapons pack has no powers block: every power looks as it did before the Force had effects';
    return false;
  }
  const pack = block as ForcePowersPack;
  const inner: unknown = Array.isArray(block) ? block : (pack.powers ?? block);
  const rows: PowerFxRow[] = [];
  if (Array.isArray(inner)) {
    for (const row of inner) if (row && typeof row === 'object') rows.push(row as PowerFxRow);
  } else if (inner && typeof inner === 'object') {
    for (const [key, row] of Object.entries(inner as Record<string, unknown>)) {
      if (!row || typeof row !== 'object') continue;
      const r = { ...(row as PowerFxRow) };
      r.power ??= key;
      r.name ??= key;
      rows.push(r);
    }
  }
  const beams = pack.beams ?? {};
  for (const def of POWERS) {
    const fx = def.fx;
    if (!fx) continue;
    // Our own id first, and the game's own effect name after it: a converter that keyed its rows by
    // `choke` rather than by `grip` is read correctly without either side having to know about it.
    const expect = fx.expect;
    const row = rows.find((r) => r.power === def.id) ?? (expect ? rows.find((r) => r.name === expect || r.power === expect) : undefined);
    if (!row) continue;
    // What the row's own beam plays at its two ends. The beam pool holds those itself for as long
    // as the beam lasts, so a part that *is* one of them is the pool's and is counted, not placed:
    // placed here as well, the lightning's start would stand at the hand twice.
    const ends = row.beam ? beams[row.beam] : undefined;
    const got: PowerEffect = { cast: null, hold: null, land: null, beam: row.beam ?? null, sound: row.sound ?? null, source: typeof row.source === 'string' ? row.source : fx.source, note: row.note ?? fx.note ?? null, viaBeam: 0 };
    for (const part of row.parts ?? []) {
      const file = part?.file;
      if (!file) continue;
      if (ends && (file === ends.start || file === ends.end)) {
        got.viaBeam++;
        continue;
      }
      const role = part.role === 'hold' ? 'hold' : part.role === 'land' ? 'land' : 'cast';
      // The pack says where it goes; our own `place` is what answers when it does not.
      const place: PowerPlace = part.at === 'hand' ? 'hand' : part.at === 'target' ? 'target' : part.at === 'body' ? 'self' : fx.place;
      got[role] ??= { file, place };
    }
    resolved.set(def.id, got);
    // The voice: the power's own sounds, with the one the client effect names in front for a power
    // that fires once. A power that lasts keeps our start, loop and end, which the `.cef` has no
    // answer for. Made here, once, so nothing builds an object in a frame.
    const sound = row.sound;
    if (sound && def.sound && def.sound.once !== sound) voices.set(def.id, { ...def, sound: { ...def.sound, once: sound } });
    else if (sound && !def.sound) voices.set(def.id, { ...def, sound: { once: sound } });
  }
  packState = rows.length ? `${resolved.size} of ${POWERS.filter((p) => p.fx).length} powers have a row` : 'the powers block is empty';
  return resolved.size > 0;
}

/** What the pack gave a power, or null when it gave it nothing. */
export function powerEffect(id: string): PowerEffect | null {
  return resolved.get(id) ?? null;
}

/**
 * The power as the sounds should hear it: the pack's own sound in front where it has one, else the
 * power itself. One kept object per power, never one made here.
 */
export function powerVoice(def: PowerDef | null | undefined): PowerDef | null | undefined {
  if (!def) return def;
  return voices.get(def.id) ?? def;
}

/** Every file the powers can place, for the warm-up. One array, built only when it is asked for. */
export function forceFxFiles(): string[] {
  const out: string[] = [];
  for (const fx of resolved.values()) {
    for (const part of [fx.cast, fx.hold, fx.land]) if (part && !out.includes(part.file)) out.push(part.file);
  }
  return out;
}

/** Whatever prepares a particle effect: `ParticleEffects` answers it exactly as it stands. */
export interface ForceFxPreparer {
  prepare(file: string, renderer?: unknown): Promise<boolean>;
}

/**
 * Every effect the powers can place, made ready behind the loading screen: its batch built hidden
 * in the scene and its textures uploaded, so the warm-up compiles it and no power builds a program
 * on the frame it is first used. It is the world's load that calls it, beside the space zone's own
 * warp effects, and it is idempotent -- a second call over the same files prepares nothing again.
 *
 * It is also where the counts start again, because this is the one call that happens once per world
 * and before any power has been used in it: a readout whose `placed` and `missing` had been adding
 * up since the tab was opened could not be read against anything.
 *
 * Returns how many files were made ready.
 */
export async function prepareForceEffects(fx: ForceFxPreparer | null | undefined, renderer: unknown, manifest: unknown): Promise<number> {
  adoptPowerPack(manifest);
  clearForceFxStats();
  if (!fx) return 0;
  const files = forceFxFiles();
  let ready = 0;
  for (const file of files) if (await fx.prepare(file, renderer)) ready++;
  return ready;
}

/** A power placed one of its effects. */
export function noteForceFx(id: string, file: string): void {
  FORCE_FX_STATS.placed++;
  FORCE_FX_STATS.last = id;
  FORCE_FX_STATS.lastFile = file;
}

/** A power asked for one and the pack had none. */
export function noteForceFxMissing(): void {
  FORCE_FX_STATS.missing++;
}

/** Forget the counts (a new world, or a run being measured from a known start). */
export function clearForceFxStats(): void {
  FORCE_FX_STATS.placed = 0;
  FORCE_FX_STATS.missing = 0;
  FORCE_FX_STATS.last = '';
  FORCE_FX_STATS.lastFile = '';
}

/** The floors that keep the rules finite. */
const FLOOR: Record<keyof ForceFxTune, number> = { on: 0, hitEvery: 0.01, handAhead: -4, handUp: -4, selfUp: -4, targetShare: 0, fxSound: 0 };

/** Move the tuning live, as `__debug.powers({ handUp: 1.2 })` does; returns what is in force. */
export function tuneForceFx(opts?: Partial<ForceFxTune> | null): ForceFxTune {
  if (!opts) return FORCE_FX;
  for (const key of Object.keys(FORCE_FX) as (keyof ForceFxTune)[]) {
    const v = opts[key];
    if (typeof v === 'number' && Number.isFinite(v)) FORCE_FX[key] = Math.max(FLOOR[key], v);
  }
  return FORCE_FX;
}

/** One line of the readout: a power and everything known about how it looks. */
export interface PowerFxLine {
  power: string;
  name: string;
  /** What it draws as it fires, while it lasts and where it arrives, each as `<file> at <place>`. */
  cast: string | null;
  hold: string | null;
  land: string | null;
  beam: string | null;
  sound: string | null;
  /** 'game', 'invented', 'none', or ours with a word saying the pack had no row. */
  whose: string;
  note: string | null;
}

/**
 * The readout: every power, the effect it wears, where it is placed and whether that pairing is the
 * game's own or ours -- and, for a power with nothing, the reason in words. Passing any of the
 * tuning's numbers moves them first. Console only, so it may allocate.
 */
export function forceFxReport(opts?: Partial<ForceFxTune> | null): {
  pack: string;
  on: boolean;
  placed: number;
  missing: number;
  last: string;
  powers: PowerFxLine[];
  tune: ForceFxTune;
} {
  if (opts) tuneForceFx(opts);
  const powers: PowerFxLine[] = [];
  const shown = (part: PowerPart | null): string | null => (part ? `${part.file} at the ${part.place === 'self' ? 'body' : part.place}` : null);
  for (const def of POWERS) {
    if (!def.fx) continue;
    const got = resolved.get(def.id);
    const whose = got?.source ?? (def.fx.source === 'none' ? 'none' : `${def.fx.source} (no row in the pack)`);
    powers.push({
      power: def.id,
      name: def.name,
      cast: shown(got?.cast ?? null),
      hold: shown(got?.hold ?? null),
      land: shown(got?.land ?? null),
      beam: got?.beam ? `${got.beam}${got.viaBeam ? ` (and ${got.viaBeam} of its own ends)` : ''}` : null,
      sound: got?.sound ?? def.sound?.once ?? def.sound?.start ?? null,
      whose,
      note: got?.note ?? def.fx.note ?? null,
    });
  }
  return { pack: packState, on: FORCE_FX.on > 0, placed: FORCE_FX_STATS.placed, missing: FORCE_FX_STATS.missing, last: FORCE_FX_STATS.last ? `${FORCE_FX_STATS.last}: ${FORCE_FX_STATS.lastFile}` : '', powers, tune: { ...FORCE_FX } };
}
