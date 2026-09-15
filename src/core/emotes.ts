// Emotes: the game's own clips (emt_wave1, emt_bow2, the dances and the sits), named for people,
// and the eight of them a player keeps on the wheel, in this browser.
//
// A dance is the dance loop's branch for a style (loop_skill:speed2:dance_N, N the visual id the
// performance table gives each dance: 1 basic, 3 rhythmic, 15 footloose...; the odd ones are the
// novice loops, the even ones the full dances), and its flourishes are skill_action_1..8's
// branches for the same style, played over the loop on the number keys the way the game's
// /flourish did.

export const EMOTE_SLOTS = 8;
const KEY = 'swg.emotes';

/** The dances by visual id, as the performance table names them (datatables/performance/performance.iff). */
export const DANCES: Record<number, string> = {
  1: 'basic', 2: 'basic 2', 3: 'rhythmic', 4: 'rhythmic 2', 5: 'exotic', 6: 'exotic 2', 7: 'exotic 3', 8: 'exotic 4',
  9: 'popular', 10: 'popular 2', 11: 'lyrical', 12: 'lyrical 2', 13: 'poplock', 14: 'poplock 2', 15: 'footloose', 16: 'footloose 2',
  17: 'formal', 18: 'formal 2', 19: 'jazzy', 20: 'jazzy 2', 21: 'theatrical', 22: 'theatrical 2', 23: 'bunduki', 24: 'bunduki 2',
  25: 'peiyi (novice)', 26: 'peiyi', 27: 'freestyle', 28: 'freestyle 2', 29: 'breakdance', 30: 'breakdance 2', 31: 'tumble', 32: 'tumble 2',
};

/** The number of flourishes a dance has: skill_action_1 to skill_action_8. */
export const FLOURISHES = 8;

/** A dance loop clip: loop_skill:speed2:dance_N. */
export function isDanceClip(name: string): boolean {
  return /^loop_skill:speed2:dance_\d+$/.test(name);
}

/** The dance style a loop or flourish clip is for (its selector value, "dance_18"), or null. */
export function danceOf(clip: string): string | null {
  const m = /:(dance_\d+)$/.exec(clip);
  return m ? m[1] : null;
}

/** A flourish: one of skill_action_1..8's branches, played over a dance loop. */
export function isFlourishClip(name: string): boolean {
  return /^skill_action_\d+(:|$)/.test(name);
}

/** Whether a clip is an emote, a dance or a sit, by the game's naming; the ambient (_ag) idles NPCs play are left out. */
export function isEmoteClip(name: string): boolean {
  if (isDanceClip(name) || name === 'loop_sitting_ground') return true;
  return /^(emt_|emote_?|dance_|social_)/.test(name) && !/^(lower|upper):/.test(name) && !/_ag$/.test(name);
}

/** Whether an emote keeps going until the player moves (a dance, a sit) rather than playing once. */
export function loopsEmote(name: string): boolean {
  return isDanceClip(name) || /^dance_/.test(name) || name === 'loop_sitting_ground';
}

/** "emt_wave1" reads as "Wave 1", "loop_skill:speed2:dance_3" as "Dance: rhythmic", "loop_sitting_ground" as "Sit". */
export function prettyEmote(clip: string): string {
  if (isDanceClip(clip)) {
    const n = Number(danceOf(clip)!.slice(6));
    return `Dance: ${DANCES[n] ?? `style ${n}`}`;
  }
  if (clip === 'loop_sitting_ground') return 'Sit';
  let s = clip.replace(/^(emt_|emote_?|social_)/, '');
  const dance = /^dance_/.test(s);
  s = s.replace(/^dance_/, '').replace(/_/g, ' ').replace(/(\D)(\d+)$/, '$1 $2').replace(/\s+/g, ' ').trim();
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return dance ? `Dance: ${s}` : s;
}

/** Every emote clip the rig has, as choices: the emotes by name, then the sit, then the dances by their number. */
export function emoteChoices(clips: string[]): { clip: string; label: string }[] {
  const out = clips.filter(isEmoteClip).map((clip) => ({ clip, label: prettyEmote(clip) }));
  const rank = (c: { clip: string }) => (isDanceClip(c.clip) ? 2 : c.clip === 'loop_sitting_ground' ? 1 : 0);
  return out.sort((a, b) => rank(a) - rank(b) || (isDanceClip(a.clip) ? Number(danceOf(a.clip)!.slice(6)) - Number(danceOf(b.clip)!.slice(6)) : a.label.localeCompare(b.label)));
}

/** The wheel's eight slots, a clip name or null each. */
export function loadEmotes(): (string | null)[] {
  const out: (string | null)[] = new Array(EMOTE_SLOTS).fill(null);
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    if (Array.isArray(saved)) for (let i = 0; i < EMOTE_SLOTS; i++) out[i] = typeof saved[i] === 'string' && saved[i] ? saved[i] : null;
  } catch {
    /* none saved */
  }
  return out;
}

export function saveEmotes(list: (string | null)[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, EMOTE_SLOTS)));
  } catch {
    /* no storage: the wheel lasts the session */
  }
}

/** A first wheel for a rig that has these clips: the usual greetings, a sit and a dance, where the rig has them. */
export function defaultEmotes(clips: string[]): (string | null)[] {
  const has = new Set(clips);
  const pick = (...names: string[]) => names.find((n) => has.has(n)) ?? null;
  const wanted = [
    pick('emt_wave1', 'emt_wave', 'emt_wave_1', 'emt_wave_hail', 'emt_salute1'),
    pick('emt_bow2', 'emt_bow', 'emt_bow_1', 'emt_curtsey'),
    pick('emt_applause_polite', 'emt_cheer', 'emt_clap_rousing', 'emt_celebrate'),
    pick('emt_laugh', 'emt_belly_laugh', 'emt_laugh_1', 'emt_giggle'),
    pick('emt_point_forward', 'emt_point', 'emt_point_1', 'emt_beckon'),
    pick('emt_shrug_shoulders', 'emt_shrug', 'emt_shrug_1', 'emt_shake_head_no'),
    pick('loop_sitting_ground', 'emt_flex_biceps', 'emt_thumb_up', 'emt_yes'),
    pick('loop_skill:speed2:dance_2', 'loop_skill:speed2:dance_1', 'dance_basic', 'dance_rhythmic'),
  ];
  // Whatever the rig lacks by those names, the first emotes it does have fill in.
  const rest = emoteChoices(clips).map((c) => c.clip).filter((c) => !wanted.includes(c));
  return wanted.map((w) => w ?? rest.shift() ?? null);
}
