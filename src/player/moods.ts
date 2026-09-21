// A mood, as one word. It is two things that happen to share a name, and this file is the join.
//
// The game kept them in two tables. The human animation table carries a `mood` string selector whose
// values pick a branch of the **standing loop**, so a body in one of them stands differently; the
// chat table carries a much longer list of names, which coloured what you said and never touched the
// body at all. Seven names are in both, which is why a mood set here writes both halves rather than
// picking one: the body takes the animation branch **when the pack has one**, and the chat takes the
// mood **always**. `/mood angry` therefore does both, and a mood the animation table never heard of
// still marks what you say.
//
// Two things about that table were measured leaf by leaf with the path-keeping flattener rather than
// assumed, and both of them are written into the rules here:
//
// - **The mood selector sits under the still branch alone.** The walk and the run carry no mood
//   selector at all, so there is no such thing as a walk that changes with a mood, in this game or in
//   the one it is drawn from. `MOOD_STATES` in `rig.ts` is the idle for that reason.
// - **Ten of the table's forty values name the default branch** -- they are the plain breathing loop
//   under another name. Four of the moods offered below are among them, so "this pack has no branch
//   for it" and "there is no branch for it and there never will be" are two different answers and are
//   two different words in `MoodBody`. Dressing the second as the first would send the owner back to
//   a conversion that cannot change it.
//
// What is here and what is not:
//
// - The moods this game offers are the list below, and it is ours: the animation table's other
//   values are the entertainers' grooves and the scene NPCs' poses (sitting at a table, eating,
//   using a terminal, and three that are a single frame of a body lying dead) and are nobody's mood.
//   `NOT_A_MOOD` is what keeps them off `/mood`'s list and out of what it accepts, whatever a pack
//   carries. Which of the moods carries a branch in a *converted pack* is the pack's answer, never
//   this list's -- `rig.moodValues()` says, and a pack converted before the moods says "none", which
//   must read as "not yet" and leave the body exactly as it was.
// - The chat table's own names are not converted by any command yet, so `known.chat` is how a later
//   conversion hands them in. Nothing in this file writes them out: a list read from the archives
//   belongs in a pack, not in the repository.
//
// Nothing here imports anything (`lookAt.ts`, `gradeMath.ts` and `bladeGlowMath.ts` are the same
// arrangement), so `tools/swg/tests/moods.test.ts` drives the rules the game runs rather than a copy
// of them written out again. Nothing here allocates on a frame: the game asks it when a mood is set
// and when a line of chat is heard, and never in `update`.

/**
 * What the animation table has for a mood, which is three answers and not two:
 *
 * - `branch` -- a branch of its own, so a pack converted with the moods stands differently in it and
 *   one converted before them has nothing yet. This is the only value for which "not in this pack
 *   yet" is a true thing to say.
 * - `default` -- the table names the value and points it at the **default** branch: the plain
 *   breathing loop. There is nothing to convert, no conversion will ever add one, and a body in it
 *   stands exactly as a body in no mood does. Measured, not guessed.
 * - `none` -- the animation table never heard of the name. A chat-only mood: it marks what you say
 *   and leaves the body alone.
 */
export type MoodBody = 'branch' | 'default' | 'none';

/** One mood the game offers, as the two tables see it. */
export interface MoodDef {
  /** The word typed after `/mood`, lower case: the animation table's value and the chat table's name alike. */
  id: string;
  /** How it is spelled on the screen. */
  label: string;
  /** What the animation table has for it: a branch of its own, the default branch, or nothing. */
  body: MoodBody;
  /** The chat table has the same name, so the game shipped it as a mood you could say things in. */
  chat: boolean;
}

/**
 * Mood names a pack or a later conversion hands in, beside the offered list. `body` is what the
 * rig's own pack carries (`rig.moodValues()`); `chat` is for whatever converts the chat table's
 * names one day. Both are optional and both may be empty, which is the ordinary case today.
 */
export interface MoodSource {
  body?: Iterable<string>;
  chat?: Iterable<string>;
}

/**
 * The moods the game offers. Eleven, out of the animation table's forty values, and the choice is
 * the design's: the rest are performances and scene poses rather than moods. Seven of them
 * (`sad`, `calm`, `neutral`, `worried`, `nervous`, `angry`, `happy`) are in the chat table as well,
 * and those are the ones where both halves happen; the other four are the animation table's alone
 * and carry their own name into the chat, which is what a mood with no chat entry of its own can do.
 *
 * Seven of the eleven carry a branch; **`calm`, `neutral`, `conversation` and `threaten` are the
 * default branch** -- the table names them and points them at the plain breathing loop -- so nothing
 * is ever converted for them and a body in one of them stands as it always did. That is not a gap in
 * a pack, it is what the game's own table says, which is why they are `default` here and why
 * `moodNote` says so in different words from the ones it uses for a branch that has not been
 * converted yet. (`nervous` shares a branch with `worried` and `entertained` shares one with
 * `bored`; a shared branch is still a branch, and the pack's values list is what resolves it.)
 */
export const PLAYER_MOODS: readonly MoodDef[] = Object.freeze([
  Object.freeze({ id: 'calm', label: 'calm', body: 'default', chat: true }),
  Object.freeze({ id: 'neutral', label: 'neutral', body: 'default', chat: true }),
  Object.freeze({ id: 'happy', label: 'happy', body: 'branch', chat: true }),
  Object.freeze({ id: 'sad', label: 'sad', body: 'branch', chat: true }),
  Object.freeze({ id: 'angry', label: 'angry', body: 'branch', chat: true }),
  Object.freeze({ id: 'worried', label: 'worried', body: 'branch', chat: true }),
  Object.freeze({ id: 'nervous', label: 'nervous', body: 'branch', chat: true }),
  Object.freeze({ id: 'bored', label: 'bored', body: 'branch', chat: false }),
  Object.freeze({ id: 'entertained', label: 'entertained', body: 'branch', chat: false }),
  Object.freeze({ id: 'threaten', label: 'threaten', body: 'default', chat: false }),
  Object.freeze({ id: 'conversation', label: 'conversation', body: 'default', chat: false }),
]) as readonly MoodDef[];

/**
 * What is in the animation table beside the moods, and must never be offered as one however a pack
 * names it. The table's forty values are moods, the entertainers' performances and the scene NPCs'
 * poses in one list, and a pose is not something a walking player may wear: three of them are a
 * single frame of a body lying dead, which neither breathes nor walks, and the sitting ones stand a
 * body bolt upright in a chair pose with whatever is in its hands still in them. A mood is saved on
 * the character and sent to everybody else, so one typed word would follow the player about for good
 * and on every other screen too.
 *
 * It is a class of name rather than a list of values, so a pack converted later with a value this
 * file has never seen is refused when it is one of these kinds and offered when it is not:
 *
 * - `npc_*` the scene NPCs' poses (sitting, eating, drinking, at a terminal, meditating, the three
 *   death poses, the basic dance), `wookiee_*` the two restrained poses.
 * - `groove_*` and `themepark_*` the entertainers' performances, and `fishing`, which is one too.
 * - `default`, which is the plain clip and no mood at all, and the table's own spares (`ui`, and the
 *   `unnamed*` values a branch is padded with).
 */
const NOT_A_MOOD_PREFIX: readonly string[] = Object.freeze(['npc_', 'wookiee_', 'groove_', 'themepark_', 'unnamed']);
const NOT_A_MOOD: readonly string[] = Object.freeze(['default', 'ui', 'fishing']);

/**
 * Whether a value out of a pack (or out of a later conversion of the chat table) is a mood a player
 * may ask for, rather than a performance or a scene pose. A name the offered list already carries is
 * one by definition; everything else has to pass the classes above.
 */
export function isMoodValue(raw: unknown): boolean {
  const word = cleanMoodName(raw);
  if (!word) return false;
  if (PLAYER_MOODS.some((m) => m.id === word)) return true;
  if (NOT_A_MOOD.includes(word)) return false;
  return !NOT_A_MOOD_PREFIX.some((p) => word.startsWith(p));
}

/** The words that take a mood off again. Ours: the tables have no name for "none". */
export const MOOD_OFF: readonly string[] = Object.freeze(['none', 'off', 'clear', 'normal']);

export interface MoodTune {
  /** The most letters a mood name may have. A bound on nonsense, not a rule about moods. */
  nameChars: number;
  /** Whether a mood may pose the body at all. 0 is the switch that makes the game exactly what it was. */
  body: number;
  /** Whether a mood marks what you say. 0 leaves the chat line as it was. */
  chat: number;
  /** The most names `/mood` on its own lists in one line. */
  listCap: number;
}

/**
 * Every number the moods have. All of them are ours -- nothing in the archives says how long a mood
 * name may be or how one should be shown -- and they are live through `__debug.mood({ ... })`.
 */
export const MOOD_TUNE: MoodTune = {
  nameChars: 24,
  body: 1,
  chat: 1,
  listCap: 40,
};

/** The floors that keep the rules finite: none of these may go negative. */
const FLOOR: Record<keyof MoodTune, number> = { nameChars: 1, body: 0, chat: 0, listCap: 1 };

/** Move the tuning live, as `__debug.mood({ body: 0 })` does; returns what is in force. */
export function tuneMoods(opts?: Partial<MoodTune> | null): MoodTune {
  if (!opts) return MOOD_TUNE;
  for (const key of Object.keys(MOOD_TUNE) as (keyof MoodTune)[]) {
    const v = opts[key];
    if (typeof v === 'number' && Number.isFinite(v)) MOOD_TUNE[key] = Math.max(FLOOR[key], Math.round(v));
  }
  return MOOD_TUNE;
}

/** The characters a mood name is made of: the animation table's values are all of this class. */
const MOOD_NAME = /^[a-z0-9_]+$/;

/**
 * A typed word read as a mood name: trimmed, lower case, cut to length, and empty when it is not a
 * name at all. It is never parsed as anything and never reaches the page: a word from another
 * player crosses the wire as one of these and is shown with `textContent`.
 */
export function cleanMoodName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const word = raw.trim().toLowerCase().slice(0, Math.max(1, MOOD_TUNE.nameChars));
  return MOOD_NAME.test(word) ? word : '';
}

/** Whether a word asks for the mood to be taken off again. */
export function isMoodOff(raw: unknown): boolean {
  const word = cleanMoodName(raw);
  return !!word && MOOD_OFF.includes(word);
}

/** The offered mood of that name, or null. The offered list only: `findMood` is what a player's word goes through. */
export function moodDef(name: string): MoodDef | null {
  const want = cleanMoodName(name);
  if (!want) return null;
  return PLAYER_MOODS.find((m) => m.id === want) ?? null;
}

/**
 * What a typed word means: one of the offered moods, or a name a pack or the chat table hands in,
 * or null for a name that is in neither table -- or one that is in a table and is a pose rather than
 * a mood -- which is refused rather than set. A mood a pack carries that the offered list does not
 * name still poses the body: that is the pack speaking, and it is the one thing here that knows what
 * was really converted. A pose the pack carries is not a mood at any point (`isMoodValue`), so the
 * death and sitting poses the same conversion writes can never be worn by a walking player.
 */
export function findMood(name: string, known?: MoodSource | null): MoodDef | null {
  const want = cleanMoodName(name);
  if (!want) return null;
  const offered = moodDef(want);
  if (offered) return offered;
  if (!isMoodValue(want)) return null;
  const body = has(known?.body, want);
  const chat = has(known?.chat, want);
  if (!body && !chat) return null;
  return { id: want, label: want.replace(/_/g, ' '), body: body ? 'branch' : 'none', chat };
}

/** Whether a list of names, as a pack or a conversion hands it in, holds one. */
function has(list: Iterable<string> | undefined, want: string): boolean {
  if (!list) return false;
  for (const x of list) if (cleanMoodName(x) === want) return true;
  return false;
}

/**
 * Every mood a player may ask for, in the order `/mood` lists them: the offered ones first, in the
 * order the design put them, then anything a pack or the chat table carries that the list has not
 * already named, alphabetically. The performances and the scene poses a converted pack carries
 * beside the moods are left out, exactly as `findMood` refuses them: what is listed and what is
 * accepted have to be the same set, or a name is offered that cannot be set, or worse, set and never
 * offered. Console and chat only, so it may allocate.
 */
export function moodNames(known?: MoodSource | null): string[] {
  const out = PLAYER_MOODS.map((m) => m.id);
  const extra: string[] = [];
  for (const list of [known?.body, known?.chat]) {
    if (!list) continue;
    for (const raw of list) {
      const word = cleanMoodName(raw);
      if (!word || out.includes(word) || extra.includes(word) || !isMoodValue(word)) continue;
      extra.push(word);
    }
  }
  extra.sort();
  return out.concat(extra);
}

/** The line `/mood` on its own answers with: what there is, cut to the cap so it fits on one line. */
export function moodListLine(current: string, known?: MoodSource | null): string {
  const names = moodNames(known);
  const cap = Math.max(1, MOOD_TUNE.listCap);
  const shown = names.slice(0, cap).join(', ');
  const more = names.length > cap ? `, and ${names.length - cap} more` : '';
  const now = cleanMoodName(current);
  const wearing = now ? `you are ${now}. ` : 'you are in no mood. ';
  return `${wearing}moods: ${shown}${more}. /mood none takes it off.`;
}

/**
 * What a mood adds to a speaker's name in the chat, or '' for none. SWG marked what you said with
 * the mood you were in; this is that mark, and the switch that turns it off is `MOOD_TUNE.chat`.
 */
export function moodTag(name: string): string {
  if (MOOD_TUNE.chat <= 0) return '';
  const word = cleanMoodName(name);
  return word ? ` (${word.replace(/_/g, ' ')})` : '';
}

/**
 * The answer `/mood <name>` gives: what happened, in words, so that "the pack has no branch for it"
 * reads as a mood that was set and not as an error. `inBody` is the rig's own answer -- whether the
 * pack it is playing really had a branch -- and is false for every pack converted before the moods,
 * which is the ordinary case until the conversion has been run.
 *
 * The three body answers are three different sentences, and that is the point of `MoodBody`. "Not in
 * this pack yet" is said only where a conversion really would add one; a mood the game's own table
 * points at the default branch says so as a fact about the game rather than as a pending job, or the
 * owner is sent back to a conversion that can never change it.
 */
export function moodNote(mood: MoodDef | null, inBody: boolean): string {
  if (!mood) return 'you are in no mood at all now';
  if (inBody) return `you are ${mood.label}, and stand like it`;
  if (mood.body === 'branch') return `you are ${mood.label} (the body's ${mood.label} is not in this pack yet)`;
  if (mood.body === 'default') return `you are ${mood.label} (the game stands the same way in it, and always did)`;
  return `you are ${mood.label}`;
}

/** The readout: the tuning, the offered list, and what a pack carries. Console only, so it may allocate. */
export function moodReport(
  opts?: Partial<MoodTune> | null,
  state?: { mood: string; inBody: boolean; pack: string[] } | null,
): { tune: MoodTune; offered: string[]; inBoth: string[]; posed: string[]; plain: string[]; mood: string; inBody: boolean; pack: string[] } {
  if (opts) tuneMoods(opts);
  return {
    tune: { ...MOOD_TUNE },
    offered: PLAYER_MOODS.map((m) => m.id),
    /** The seven names that are in the animation table and the chat table alike. */
    inBoth: PLAYER_MOODS.filter((m) => m.body !== 'none' && m.chat).map((m) => m.id),
    /** The ones a conversion can pose: they have a branch of their own in the animation table. */
    posed: PLAYER_MOODS.filter((m) => m.body === 'branch').map((m) => m.id),
    /** The ones the game's own table points at the plain idle, which no conversion will ever change. */
    plain: PLAYER_MOODS.filter((m) => m.body === 'default').map((m) => m.id),
    mood: state?.mood ?? '',
    inBody: state?.inBody ?? false,
    pack: state?.pack ?? [],
  };
}
