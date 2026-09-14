// Emotes: the game's own clips (emt_wave, emt_bow, dance_basic and the rest), named for
// people, and the eight of them a player keeps on the wheel, in this browser.

export const EMOTE_SLOTS = 8;
const KEY = 'swg.emotes';

/** Whether a clip is an emote or a dance, by the game's naming. */
export function isEmoteClip(name: string): boolean {
  return /^(emt_|emote_?|dance_|social_|sit_|std_)/.test(name) && !/^(lower|upper):/.test(name);
}

/** "emt_wave_1" reads as "Wave 1", "dance_basic" as "Dance: basic", "emt_bow" as "Bow". */
export function prettyEmote(clip: string): string {
  let s = clip.replace(/^(emt_|emote_?|social_)/, '');
  const dance = /^dance_/.test(s);
  s = s.replace(/^dance_/, '').replace(/_/g, ' ').trim();
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return dance ? `Dance: ${s}` : s;
}

/** Every emote clip the rig has, as choices, dances after the rest, each sorted by name. */
export function emoteChoices(clips: string[]): { clip: string; label: string }[] {
  const out = clips.filter(isEmoteClip).map((clip) => ({ clip, label: prettyEmote(clip) }));
  return out.sort((a, b) => (a.label.startsWith('Dance') === b.label.startsWith('Dance') ? a.label.localeCompare(b.label) : a.label.startsWith('Dance') ? 1 : -1));
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

/** A first wheel for a rig that has these clips: the usual greetings and one dance, where the rig has them. */
export function defaultEmotes(clips: string[]): (string | null)[] {
  const has = new Set(clips);
  const pick = (...names: string[]) => names.find((n) => has.has(n)) ?? null;
  const wanted = [
    pick('emt_wave', 'emt_wave_1', 'emt_greet', 'emt_salute'),
    pick('emt_bow', 'emt_bow_1', 'emt_curtsey'),
    pick('emt_cheer', 'emt_cheer_1', 'emt_clap'),
    pick('emt_laugh', 'emt_laugh_1', 'emt_giggle'),
    pick('emt_point', 'emt_point_1', 'emt_beckon'),
    pick('emt_shrug', 'emt_shrug_1', 'emt_no'),
    pick('emt_flex', 'emt_thumbs_up', 'emt_yes'),
    pick('dance_basic', 'dance_basic_1', 'dance_rhythmic'),
  ];
  // Whatever the rig lacks by those names, the first emotes it does have fill in.
  const rest = emoteChoices(clips).map((c) => c.clip).filter((c) => !wanted.includes(c));
  return wanted.map((w) => w ?? rest.shift() ?? null);
}
