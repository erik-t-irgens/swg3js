// The gestures a person in a conversation is lent. The humanoid people's animation pack carries only ten of the
// body's emotes (`CURATED_ALL_B` in `tools/swg/mobiles.mjs`), and the conversation's gestures name the whole
// list, so at the start of a conversation the speaker is lent every gesture a species rig that is already
// parsed holds -- the speaker's own species' when it is in, else any, which in play is the player's own --
// exactly as a lightsaber carrier is lent its swings and a person in a mood its idle (`Mobile.lendClips`).
// Every humanoid shares the one skeleton, the clips are read-only animation data, and nothing is fetched or
// compiled. With no rig parsed nothing is lent and the speaker gestures with the ten it has and stands still
// for the rest, which the gesture rule already allows for (a clip the body has not got is never chosen).
//
// The map of a rig's gestures is made once per rig and shared by everybody lent from it.

import type * as THREE from 'three';

/** A rig's gestures by name: every `emt_` clip that is not an ambient idle (`_ag`), made once per rig. */
const lent = new WeakMap<readonly THREE.AnimationClip[], ReadonlyMap<string, THREE.AnimationClip>>();

/** The gestures of one rig's clips, made the first time and kept for as long as the clips are. */
export function gesturesOf(rig: readonly THREE.AnimationClip[]): ReadonlyMap<string, THREE.AnimationClip> {
  let m = lent.get(rig);
  if (!m) {
    const out = new Map<string, THREE.AnimationClip>();
    for (const c of rig) if (c.name.startsWith('emt_') && !c.name.endsWith('_ag')) out.set(c.name, c);
    m = out;
    lent.set(rig, m);
  }
  return m;
}

/** What lending needs of the world: the rig clips already parsed (`Character.parsedRigClips`) and a body to lend to. */
export interface LendDeps {
  parsedRigClips(prefer?: string): THREE.AnimationClip[] | null;
}

/** A speaker as lending needs it. */
export interface Lendee {
  readonly humanoid: boolean;
  readonly entry: { species?: string | null };
  lendClips(extra: ReadonlyMap<string, THREE.AnimationClip>): void;
}

/**
 * Lend a speaker every gesture of a parsed rig, its own species' first. Answers how many there were to lend:
 * nought for a body that is not a person on the humanoid skeleton, or before any rig is in.
 */
export function lendGestures(m: Lendee, deps: LendDeps): number {
  if (!m.humanoid) return 0;
  const rig = deps.parsedRigClips(m.entry.species ?? undefined);
  if (!rig) return 0;
  const g = gesturesOf(rig);
  if (g.size) m.lendClips(g);
  return g.size;
}
