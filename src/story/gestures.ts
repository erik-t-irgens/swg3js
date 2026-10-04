// Which gesture a line of a conversation is said with, worked out at play time and never written into the
// tree: a line's `gesture` slot left out is the rule's to fill, and a slot filled by hand -- by the owner, or
// one day by a cutscene editor, which writes only those slots -- wins. Pure: the line, the speaker as the
// rule needs it and the last gesture played go in, and a clip (or stillness) comes out, so a node test runs
// thousands of lines through the very function the game runs.
//
// **The rule** (the conversation research's, over the NGE's own measured rates):
//   1. A hand-picked gesture wins: `null` is none, `emt_x` that clip, `@agree` a pick within that family,
//      a name the game's scripts used for one of ours (`explain`, `dismiss`) its clip, and `mood:<name>` a
//      change of the speaker's idle for the rest of the conversation.
//   2. The speaker's body gates it: somebody seated, lying, dead or restrained plays no whole-body clip (it
//      would stand them up); a body plays only the clips its skeleton has; the same clip never twice running;
//      and at most one gesture every `gap + 1` lines unless the cue is strong.
//   3. The family, the first that matches: the writer's `tone`, a stage direction (`*sigh*`), a keyword, a
//      `!` or a `?`, `explainWords` words or more, the speaker's mood; and then the speaker's diction turns a
//      greeting or a farewell into a salute (the military, a stormtrooper) or a bow (the fancy).
//   4. Whether to gesture at all, by the rates the NGE's own lines show (`GESTURE_TUNE`).
//   5. Every line given no clip is given the speaker's mood idle, on purpose: stillness is a gesture too,
//      which is what keeps "every line gets a gesture" true.
//
// Everything is drawn from `hash(tree, node, line)` (`seed.ts`), so a line always plays the same gesture in
// every browser with nothing sent between them. The player's own answer gestures only on a strong cue -- yes
// a nod, no a shake of the head, thanks a thank -- or by hand.
//
// What is the game's: the clip names, which are the humanoid body's own emotes. The families, the aliases,
// the keywords and every number are ours, out of the research (the owner judges `explain` by eye).

import { seedRoll } from './seed.ts';

/** Every number the rule runs on, ours, live through `__debug.gestures`. */
export const GESTURE_TUNE = {
  /** The share of lines with no other cue that gesture. */
  base: 0.28,
  /** Of lines ending `!`. */
  exclaim: 0.42,
  /** Of lines ending `?`. */
  question: 0.25,
  /** Of lines with a strong cue: a laugh, a farewell, a refusal, a threat, a greeting. */
  strong: 0.38,
  /** Of lines of three words or fewer. */
  short: 0.15,
  /** Lines this long or longer explain, hands and all. */
  explainWords: 25,
  /** Lines that rest after a gesture before another, unless the cue is strong. */
  gap: 1,
  /** Every line moves, for comparison: the rates and the rest between gestures are skipped. */
  every: false,
};

/** Set any of those, a number only by a number and the switch only by a switch. */
export function tuneGestures(o?: Partial<typeof GESTURE_TUNE> | null): typeof GESTURE_TUNE {
  if (!o) return GESTURE_TUNE;
  const into = GESTURE_TUNE as unknown as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!(k in GESTURE_TUNE)) continue;
    const v = (o as Record<string, unknown>)[k];
    const had = into[k];
    if (typeof had === 'number' && typeof v === 'number' && Number.isFinite(v)) into[k] = k === 'gap' || k === 'explainWords' ? Math.max(0, Math.round(v)) : Math.max(0, Math.min(1, v));
    else if (typeof had === 'boolean' && typeof v === 'boolean') into[k] = v;
  }
  return GESTURE_TUNE;
}

/** The families and their clips (the research's table, every clip on the humanoid body's own list), and three of ours for tone and diction. */
export const GESTURE_FAMILIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  greet: ['emt_wave1', 'emt_wave2', 'emt_wave_hail', 'emt_bow2', 'emt_nod_head_once'],
  farewell: ['emt_wave2', 'emt_wave_on_dismissing', 'emt_salute2', 'emt_bow3'],
  thanks: ['emt_thank', 'emt_bow2', 'emt_nod_head_multiple'],
  agree: ['emt_nod_head_once', 'emt_nod', 'emt_nod_head_multiple', 'emt_thumb_up'],
  refuse: ['emt_shake_head_no', 'emt_wave_on_dismissing', 'emt_shake_head_disgust', 'emt_refuse_offer_formal'],
  apology: ['emt_apologize', 'emt_standing_placate', 'emt_embarrassed'],
  laugh: ['emt_laugh', 'emt_belly_laugh', 'emt_laugh_titter', 'emt_laugh_cackle'],
  threat: ['emt_pound_fist_palm', 'emt_point_accusingly', 'emt_wave_finger_warning', 'emt_shakefist', 'emt_backhand_threaten'],
  sad: ['emt_sigh_deeply', 'emt_weeping', 'emt_slump_head'],
  self: ['emt_point_to_self', 'emt_pose_proudly'],
  direction: ['emt_point_away', 'emt_point_forward', 'emt_point_left', 'emt_point_right', 'emt_wave_on_directing'],
  question: ['emt_shrug_hands', 'emt_shrug_shoulders', 'emt_rub_chin_thoughtful', 'emt_scratch_head', 'emt_huh'],
  explain: ['emt_conversation_1', 'emt_conversation_2', 'emt_tap_head', 'emt_rub_chin_thoughtful'],
  emphatic: ['emt_gesticulate_wildly', 'emt_pound_fist_palm', 'emt_applause_excited'],
  nervous: ['emt_nervous', 'emt_check_wrist_device', 'emt_look_left', 'emt_look_right'],
  secret: ['emt_whisper', 'emt_shush'],
  // Ours: a warm line, a formal one, a salute and a cough.
  warm: ['emt_nod_head_once', 'emt_nod_head_multiple', 'emt_thumb_up'],
  formal: ['emt_bow2', 'emt_bow3', 'emt_nod_head_once'],
  salute: ['emt_salute1', 'emt_salute2'],
  bow: ['emt_bow2', 'emt_bow3', 'emt_bow4'],
  cough: ['emt_cough_polite'],
});

/**
 * The names the game's own scripts gave gestures that are on neither the humanoid body's list nor a family's,
 * and the clip of ours each means (the research's alias table). `explain` is two clips, drawn between.
 */
export const GESTURE_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  explain: ['emt_conversation_1', 'emt_conversation_2'],
  dismiss: ['emt_wave_on_dismissing'],
  greet: ['emt_wave1'],
  goodbye: ['emt_wave2'],
  bow: ['emt_bow2'],
  threaten: ['emt_backhand_threaten'],
  handshake_tandem: ['emt_tandem_handshake'],
  thumbs_up: ['emt_thumb_up'],
  threaten_combat: ['emt_shakefist'],
  hug_tandem: ['emt_tandem_hug'],
  hi5_tandem: ['emt_tandem_hi5'],
  ashamed: ['emt_embarrassed'],
});

/** The tones a writer may give a line, and the family each means. */
export const TONES = ['warm', 'curt', 'angry', 'sad', 'nervous', 'formal', 'amused', 'threat', 'secret'] as const;
export type Tone = (typeof TONES)[number];
const TONE_FAMILY: Readonly<Record<Tone, string>> = Object.freeze({ warm: 'warm', curt: 'refuse', angry: 'threat', sad: 'sad', nervous: 'nervous', formal: 'formal', amused: 'laugh', threat: 'threat', secret: 'secret' });

/** A stage direction written into a line (`*sigh*`), and the family it means. */
const STAGE: [RegExp, string][] = [
  [/sigh/, 'sad'],
  [/cough/, 'cough'],
  [/laugh|chuckle|giggle|snicker/, 'laugh'],
  [/shrug/, 'question'],
  [/nod/, 'agree'],
  [/bow/, 'formal'],
  [/wave/, 'greet'],
  [/whisper/, 'secret'],
  [/cr(y|ies)|sob|weep/, 'sad'],
  [/point/, 'direction'],
  [/salute/, 'salute'],
];

/** Keyword families, tried in this order (the research's). The text is lower-cased and its quotes made plain first. */
const KEYWORDS: [string, RegExp][] = [
  ['laugh', /\b(ha(ha)+|heh|hah|hehe|laugh(s|ing)?|funny)\b/],
  ['greet', /\b(hello|greetings|welcome|good (morning|day|evening|afternoon)|hail|hi there|well met)\b/],
  ['farewell', /\b(goodbye|good-bye|farewell|safe travels|see you|take care|until next time|be seeing you|so long|good luck)\b/],
  ['thanks', /\b(thank(s| you)?|grateful|appreciated?|much obliged)\b/],
  ['apology', /\b(sorry|apologi[sz]e|forgive me|my apologies|pardon me|my mistake)\b/],
  // A bare no or yes counts only where a sentence or a clause begins ("No.", "Well, yes.", "TEST: No"), so a
  // "no" in the middle of a line ("there is no cargo") is no refusal.
  ['refuse', /(?:^|[.!?:;,])\s*\W*(no|nope|never)\b|\b(not a chance|absolutely not|i refuse|i won't|i will not|out of the question|forget it|no way)\b/],
  ['agree', /(?:^|[.!?:;,])\s*\W*(yes|yeah|aye|indeed|of course|certainly|very well|agreed|sure|okay|ok|right then)\b|\b(i agree|you're right|good idea|it's a deal)\b/],
  ['threat', /\b(kill you|you'll die|regret (this|it)|last warning|or else|i warn(ed)? you|watch yourself|threaten(s|ed)?|destroy you|hurt you)\b/],
  ['sad', /\b(alas|grief|mourn(ing)?|tragic|sorrow|so sad|heartbroken|passed away)\b/],
  ['self', /\b(my name is|call me|i am the|i'm the|myself)\b/],
  ['direction', /\b(over there|that way|this way|to the (north|south|east|west)|on your (left|right)|down the (road|street|hall)|follow the|head (north|south|east|west))\b/],
];

/** Families whose lines gesture at the strong rate. */
const STRONG_RATE: ReadonlySet<string> = new Set(['laugh', 'farewell', 'refuse', 'threat', 'greet']);
/** Families strong enough to gesture without resting since the last. */
const STRONG_GAP: ReadonlySet<string> = new Set(['laugh', 'threat', 'greet', 'refuse']);
/** The moods that pose a body off its feet (`SEATED_MOOD` in the mobiles' own `moodIdle.ts`, which this folder may not import). */
const STILL_MOOD = /sitting|lying|meditate|dead|restrained/;

/** The words of a line, its quotes made plain and lower-cased: what the keywords read. */
function plain(text: string): string {
  return text.replace(/[‘’]/g, "'").toLowerCase();
}

/** How many words a line has, its stage directions left out. */
export function wordCount(text: string): number {
  let n = 0;
  for (const w of text.replace(/\*[^*]*\*/g, ' ').split(/\s+/)) if (w) n++;
  return n;
}

/** What a filled slot means, or null for a slot that is not a gesture at all. */
export type GestureSlot = { kind: 'clips'; clips: readonly string[] } | { kind: 'family'; family: string } | { kind: 'mood'; mood: string };

const CLIP = /^emt_[a-z0-9_]{1,60}$/;
const MOOD = /^mood:([a-z0-9_]{1,60})$/;

/**
 * A filled slot read: a family (`@agree`), a mood (`mood:sad`), an alias (`explain`), a clip (`emt_bow2`, or
 * its name without `emt_`). An ambient idle (`_ag`) is no gesture. Null for anything else.
 */
export function readSlot(slot: string): GestureSlot | null {
  if (typeof slot !== 'string') return null;
  if (slot.startsWith('@')) return GESTURE_FAMILIES[slot.slice(1)] && Object.hasOwn(GESTURE_FAMILIES, slot.slice(1)) ? { kind: 'family', family: slot.slice(1) } : null;
  const m = MOOD.exec(slot);
  if (m) return { kind: 'mood', mood: m[1] };
  if (Object.hasOwn(GESTURE_ALIASES, slot)) return { kind: 'clips', clips: GESTURE_ALIASES[slot] };
  const clip = slot.startsWith('emt_') ? slot : `emt_${slot}`;
  return CLIP.test(clip) && !clip.endsWith('_ag') ? { kind: 'clips', clips: [clip] } : null;
}

/** Every clip the rule can name: what a body is lent, and what the test holds against the body's own list. */
export function gestureClips(): string[] {
  const out = new Set<string>();
  for (const f of Object.keys(GESTURE_FAMILIES)) for (const c of GESTURE_FAMILIES[f]) out.add(c);
  for (const a of Object.keys(GESTURE_ALIASES)) for (const c of GESTURE_ALIASES[a]) out.add(c);
  for (const c of REPLY_CLIPS) out.add(c);
  return [...out].sort();
}

/** The speaker, as the rule needs it. */
export interface GestureSpeaker {
  /** Seated, lying down, dead or restrained: no whole-body clip. */
  still: boolean;
  /** Whether its body has a clip. */
  has(clip: string): boolean;
  /** The mood it stands in, which a line with no other cue takes its family from. */
  mood?: string | null;
  /** How it speaks: `military`, `stormtrooper` and `fancy` change a greeting and a farewell. */
  diction?: string | null;
}

/** What the rule remembers between lines of one conversation: the last clip, and how many lines since it. */
export interface GestureMemory {
  last: string | null;
  since: number;
}

export function newGestureMemory(): GestureMemory {
  return { last: null, since: Number.POSITIVE_INFINITY };
}

/** One line as the rule reads it. `slot` left undefined is the rule's to fill; null is none, by hand. */
export interface GestureLine {
  tree: string;
  node: string;
  line: number;
  text: string;
  tone?: string | null;
  slot?: string | null;
}

/**
 * What a line is said with: a clip, or none. `kind` says why: `hand` (the slot's own), `auto` (the rule's),
 * `still` (the speaker's mood idle, chosen), `none` (a slot written null) or `mood` (the slot changes the idle
 * for the rest of the talk, to `mood`).
 */
export interface GesturePick {
  clip: string | null;
  kind: 'hand' | 'auto' | 'still' | 'none' | 'mood';
  family: string | null;
  mood?: string;
  why: string;
}

/**
 * How a speaker speaks, from the side they stand on and the body they are stood as (the client's reaction
 * dictions are a later wave's): a stormtrooper, the military of either side, the fancy, or nobody in
 * particular. Ours.
 */
export function dictionOf(side: string | null | undefined, body: string): string | null {
  if (/storm_?trooper|scout_?trooper|snow_?trooper|sand_?trooper|dark_?trooper/.test(body)) return 'stormtrooper';
  if (side === 'imperial' || side === 'rebel') return 'military';
  if (/noble|aristocrat|royal|senator|politician|courtier/.test(body)) return 'fancy';
  return null;
}

/** The family a line's words, tone and speaker give it, or null for a line with no cue. */
export function familyOf(text: string, tone: string | null | undefined, speaker: Pick<GestureSpeaker, 'mood' | 'diction'>): string | null {
  let family: string | null = tone && Object.hasOwn(TONE_FAMILY, tone) ? TONE_FAMILY[tone as Tone] : null;
  const words = plain(text);
  if (!family) {
    const stage = /\*([^*]{1,40})\*/.exec(words);
    if (stage) for (const [re, f] of STAGE) if (re.test(stage[1])) {
      family = f;
      break;
    }
  }
  if (!family) for (const [f, re] of KEYWORDS) if (re.test(words)) {
    family = f;
    break;
  }
  if (!family) {
    const end = words.trim().replace(/["')\]]+$/, '');
    if (end.endsWith('!')) family = 'emphatic';
    else if (end.endsWith('?')) family = 'question';
  }
  if (!family && wordCount(text) >= GESTURE_TUNE.explainWords) family = 'explain';
  if (!family && speaker.mood) {
    const m = speaker.mood;
    if (/angry/.test(m)) family = 'threat';
    else if (/sad/.test(m)) family = 'sad';
    else if (/worried|nervous/.test(m)) family = 'nervous';
    else if (/happy|entertained/.test(m)) family = 'warm';
  }
  if (family === 'greet' || family === 'farewell') {
    if (speaker.diction === 'military' || speaker.diction === 'stormtrooper') family = 'salute';
    else if (speaker.diction === 'fancy') family = 'bow';
  }
  return family;
}

/** The share of lines like this one that gesture. */
export function rateOf(text: string, family: string | null): number {
  const t = GESTURE_TUNE;
  if (family && STRONG_RATE.has(family)) return t.strong;
  if (wordCount(text) <= 3) return t.short;
  const end = text.trim().replace(/["')\]]+$/, '');
  if (end.endsWith('!')) return t.exclaim;
  if (end.endsWith('?')) return t.question;
  return t.base;
}

/** One of `clips` the body has and did not play last, drawn from the line's own seed; null when none is left. */
function draw(clips: readonly string[], line: GestureLine, speaker: GestureSpeaker, last: string | null, avoidLast: boolean): string | null {
  let n = 0;
  for (const c of clips) if (speaker.has(c) && (!avoidLast || c !== last)) n++;
  if (!n) return null;
  let k = Math.floor(seedRoll(line.tree, line.node, line.line, 'clip') * n);
  for (const c of clips) {
    if (!speaker.has(c) || (avoidLast && c === last)) continue;
    if (k-- === 0) return c;
  }
  return null;
}

/** The speaker's mood idle, chosen: the line says nothing with its hands. */
function still(family: string | null, why: string): GesturePick {
  return { clip: null, kind: 'still', family, why };
}

/** The gesture one line of the speaker's is said with. Pure, and the same for the same line every time. */
export function pickGesture(line: GestureLine, speaker: GestureSpeaker, memory: GestureMemory): GesturePick {
  if (line.slot === null) return { clip: null, kind: 'none', family: null, why: 'none, by hand' };
  const stillBody = speaker.still || (!!speaker.mood && STILL_MOOD.test(speaker.mood));
  if (typeof line.slot === 'string') {
    const s = readSlot(line.slot);
    if (!s) return still(null, `${line.slot} is not a gesture`);
    if (s.kind === 'mood') return { clip: null, kind: 'mood', family: null, mood: s.mood, why: `the idle turns to ${s.mood}` };
    if (stillBody) return still(null, 'seated, lying or held: no whole-body clip');
    if (s.kind === 'family') {
      const clip = draw(GESTURE_FAMILIES[s.family], line, speaker, memory.last, true);
      return clip ? { clip, kind: 'hand', family: s.family, why: `@${s.family}, by hand` } : still(s.family, `the body has none of @${s.family} it did not just play`);
    }
    const clip = draw(s.clips, line, speaker, memory.last, false);
    return clip ? { clip, kind: 'hand', family: null, why: 'by hand' } : still(null, `the body has no ${s.clips.join(' or ')}`);
  }
  if (stillBody) return still(null, 'seated, lying or held: no whole-body clip');
  const family = familyOf(line.text, line.tone, speaker);
  const every = GESTURE_TUNE.every;
  if (!every && memory.since < GESTURE_TUNE.gap && !(family && STRONG_GAP.has(family))) return still(family, 'resting after the last gesture');
  const rate = rateOf(line.text, family);
  if (!every && seedRoll(line.tree, line.node, line.line, 'gesture') >= rate) return still(family, `not this line (one in ${Math.round(1 / Math.max(rate, 1e-3))})`);
  const fam = family ?? 'explain';
  const clip = draw(GESTURE_FAMILIES[fam], line, speaker, memory.last, true);
  return clip ? { clip, kind: 'auto', family: fam, why: family ? fam : 'no cue: explaining' } : still(fam, `the body has none of ${fam} it did not just play`);
}

/** The memory moved on by one line's pick. */
export function rememberGesture(memory: GestureMemory, pick: GesturePick): void {
  if (pick.clip) {
    memory.last = pick.clip;
    memory.since = 0;
  } else memory.since++;
}

/** The player's own clips for a strong answer: yes, no, thanks. */
const REPLY_CLIPS = ['emt_nod_head_once', 'emt_shake_head_no', 'emt_thank'] as const;
const REPLY_FAMILY: Readonly<Record<string, string>> = Object.freeze({ agree: 'emt_nod_head_once', refuse: 'emt_shake_head_no', thanks: 'emt_thank' });

/**
 * The gesture the player says an answer with: the slot's own, and otherwise only a strong cue's -- a yes is a
 * nod, a no a shake of the head, thanks a thank. Null for none.
 */
export function replyGesture(text: string, slot: string | null | undefined, has: (clip: string) => boolean): string | null {
  if (slot === null) return null;
  if (typeof slot === 'string') {
    const s = readSlot(slot);
    if (!s || s.kind === 'mood') return null;
    const clips = s.kind === 'family' ? GESTURE_FAMILIES[s.family] : s.clips;
    for (const c of clips) if (has(c)) return c;
    return null;
  }
  const words = plain(text);
  for (const [f, re] of KEYWORDS) {
    if (!re.test(words)) continue;
    const clip = REPLY_FAMILY[f];
    return clip && has(clip) ? clip : null;
  }
  return null;
}
