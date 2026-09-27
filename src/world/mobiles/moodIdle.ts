// The idle a person stands in when the data gave it a mood.
//
// A town's row says how its person stood -- `sad`, `npc_sitting_chair`, `npc_standing_drinking` -- and
// that mood is the animation table's own `mood` selector, which reaches the standing idle and nothing
// else (CLAUDE.md, the moods lesson). The mobiles packs keep only the calm branch, so a body is lent the
// branch from a species rig that is already parsed, exactly as a lightsaber carrier is lent its swings:
// every humanoid shares the one skeleton, the clips are read-only and cost no bytes, and nothing is ever
// fetched for it. A mood the rig has no branch for (`conversation`, `neutral`, `npc_imperial`: ten of the
// forty are the plain breathing loop under another name) leaves the body in its own pack's idle, which is
// what "no branch" has always meant.
//
// Pure: plain data in and a name or a clip out, so a node test drives it with a hand-written table and
// clips that are only names. The one type it takes from `mobile.ts` is erased when node runs it.
import type * as THREE from 'three';
import type { MobileExtras } from './mobile.ts';

/** A rig's selector branches by clip, as its parts manifest writes them. */
export type RigVariants = Readonly<Record<string, { variable: string; values: readonly string[] }>>;

/**
 * The rig's clip for a mood, or null when it has no branch for it: the branch named for the value, else
 * the one whose values hold it (a shared branch is named for its first value: `nervous` is `idle:worried`).
 * Only a branch under the `mood` variable counts, and the plain idle is never an answer -- the caller
 * keeps the body's own idle then, which is its own pack's and fits it better than a lent one.
 */
export function moodIdleName(value: string | null | undefined, variants: RigVariants | null | undefined, has: (clip: string) => boolean): string | null {
  if (!value) return null;
  const exact = `idle:${value}`;
  if (has(exact) && (!variants?.[exact] || variants[exact].variable === 'mood')) return exact;
  for (const [clip, v] of Object.entries(variants ?? {})) {
    if (v.variable !== 'mood' || !clip.startsWith('idle:')) continue;
    if (v.values.includes(value) && has(clip)) return clip;
  }
  return null;
}

/** Each rig's clips by name, made the first time a mood is asked of it and kept for as long as its clips are. */
const clipsByName = new WeakMap<readonly { name: string }[], Map<string, { name: string }>>();

/**
 * The clip a mood picks out of a species rig that is already parsed: the rig whose URL holds `prefer`
 * (a species id) when it is in, else any, and its branch for the mood (`moodIdleName`) among the clips
 * that rig really has. Null when no rig is in or it has no branch for the mood. `rigs` is the parsed
 * rigs by URL and `variants` their manifests' branch tables by the same URL (`Character.parsedRigMood`
 * hands over its own two maps); nothing is fetched and nothing waited for.
 */
export function pickMoodClip<C extends { name: string }>(mood: string, rigs: ReadonlyMap<string, readonly C[]>, variants: ReadonlyMap<string, RigVariants>, prefer?: string): C | null {
  let url: string | null = null;
  for (const u of rigs.keys()) {
    if (prefer && u.includes(`/characters/${prefer}/`)) {
      url = u;
      break;
    }
    url ??= u;
  }
  if (!url) return null;
  const clips = rigs.get(url)!;
  let byName = clipsByName.get(clips) as Map<string, C> | undefined;
  if (!byName) {
    byName = new Map(clips.map((c) => [c.name, c]));
    clipsByName.set(clips, byName);
  }
  const found = byName;
  const name = moodIdleName(mood, variants.get(url), (c) => found.has(c));
  return name ? (found.get(name) ?? null) : null;
}

/**
 * A body's extras with a mood's idle laid over them: the lent clip added to what it plays, and its idle
 * role pointed at it, so every branch that stands it idle stands it in the mood and a fight still takes
 * it out of it. Every other role, clip and field is kept as it was. Nothing to lay over is the extras as
 * they were, the very object.
 */
export function withMood(extras: MobileExtras | undefined, idle: THREE.AnimationClip | null): MobileExtras | undefined {
  if (!idle) return extras;
  const clips = new Map(extras?.clips ?? []);
  clips.set(idle.name, idle);
  return { ...extras, clips, roles: { ...extras?.roles, idle: idle.name } };
}

/** The moods that pose a body off its feet: sitting, lying, meditating, the dead. Such a body never wanders. */
export const SEATED_MOOD = /sitting|lying|meditate|dead|restrained/;

/**
 * The mood a row stands in: its own, or, for a giver the server sat down (`sit`, its `position = SIT`)
 * with none written, the chair's. The server's SIT was a posture, not a mood; the chair's idle is the one
 * branch that poses it. Null for a row with neither.
 */
export function moodOfRow(r: { mood?: string | null; sit?: boolean }): string | null {
  if (r.mood) return r.mood;
  return r.sit ? 'npc_sitting_chair' : null;
}
