// An animation pack's clips as the game plays them: the roles with the gender's own variant laid
// over them, the additive clips made additive once (never twice: the conversion rewrites the
// values in place), the aliases a CharacterRig looks for, and which roles the GLB cannot back.
//
// Rule for this file (it is run by node with type stripping for the tests): value imports only
// from three, relative imports only as `import type`, no enum, no namespace, no constructor
// parameter properties.
import * as THREE from 'three';
import type { AnimPack, Roles } from './types';

/** What these functions need of a loaded pack: its JSON, its clips by name, and which are additive. */
export interface PackClipSource {
  json: AnimPack;
  clips: Map<string, THREE.AnimationClip>;
  additive: Set<string>;
  /** The aliases made for a rig, per gender, kept so they are made once. */
  rigClips: Map<string, THREE.AnimationClip[]>;
}

/** The roles for a gender: the pack's, with `variants['gender:f']` (or `:m`) laid over them. */
export function rolesFor(pack: AnimPack, gender: 'm' | 'f' | null): Roles {
  const roles: Roles = { ...pack.roles, emotes: { ...(pack.roles.emotes ?? {}) } };
  const over = gender ? pack.variants?.[`gender:${gender}`] : undefined;
  if (over) {
    for (const [k, v] of Object.entries(over)) {
      if (v === undefined) continue;
      if (k === 'emotes' && v && typeof v === 'object') roles.emotes = { ...roles.emotes, ...(v as Record<string, string>) };
      else (roles as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return roles;
}

/**
 * Make every clip the pack marks additive into a delta from the bind pose (`roles.bind`), once.
 * `AnimationUtils.makeClipAdditive` rewrites the values in place and sets `blendMode` as its last
 * act, so the blend mode is the guard: a clip already converted is left alone, and a second call
 * changes nothing. Returns how many were converted now.
 */
export function makeAdditiveOnce(pack: PackClipSource): number {
  const bindName = pack.json.roles?.bind;
  const bind = bindName ? pack.clips.get(bindName) : undefined;
  let n = 0;
  for (const name of pack.additive) {
    const clip = pack.clips.get(name);
    if (!clip || clip === bind) continue;
    if (clip.blendMode === THREE.AdditiveAnimationBlendMode) continue;
    // Without the bind pose the first frame of the clip itself is the reference (three's own default).
    THREE.AnimationUtils.makeClipAdditive(clip, 0, bind ?? clip);
    n++;
  }
  return n;
}

/** The names the rig state machine looks for, from the roles. */
const ROLE_ALIASES: [keyof Roles, string][] = [
  ['idle', 'idle'],
  ['walk', 'walk'],
  ['run', 'run'],
  ['idleCombat', 'idle_combat'],
  ['walkCombat', 'walk_combat'],
  ['runCombat', 'run_combat'],
  ['down', 'trn_stand_to_incapacitated'],
  ['downLoop', 'loop_incapacitated'],
];

function alias(name: string, clip: THREE.AnimationClip): THREE.AnimationClip {
  // The same tracks, shared: an alias is a name, and the additive conversion (already done) is kept.
  const a = new THREE.AnimationClip(name, clip.duration, clip.tracks, clip.blendMode);
  a.userData = { ...clip.userData, aliasOf: clip.name };
  return a;
}

/**
 * The pack's clips under the names a CharacterRig looks for, alongside their own: each logical
 * name with one clip by that name, with several as `<logical>:speed<i>` slowest first; and the
 * roles as `idle`, `walk`, `run`, `idle_combat`, `walk_combat`, `run_combat`,
 * `trn_stand_to_incapacitated` (the death a fighter plays) and `loop_incapacitated`. Made after
 * the additive conversion, sharing the tracks, and kept on the pack per gender.
 */
export function rigClipsFromPack(pack: PackClipSource, gender: 'm' | 'f' | null): THREE.AnimationClip[] {
  const key = gender ?? '-';
  const kept = pack.rigClips.get(key);
  if (kept) return kept;
  makeAdditiveOnce(pack);
  const out: THREE.AnimationClip[] = [];
  const names = new Set<string>();
  const add = (c: THREE.AnimationClip) => {
    if (names.has(c.name)) return;
    names.add(c.name);
    out.push(c);
  };
  for (const c of pack.clips.values()) add(c);
  for (const [logical, list] of Object.entries(pack.json.logical ?? {})) {
    const clips = list.map((n) => pack.clips.get(n)).filter((c): c is THREE.AnimationClip => !!c);
    if (clips.length === 1) add(alias(logical, clips[0]));
    else clips.forEach((c, i) => add(alias(`${logical}:speed${i}`, c)));
  }
  const roles = rolesFor(pack.json, gender);
  for (const [role, name] of ROLE_ALIASES) {
    const clipName = roles[role];
    if (typeof clipName !== 'string') continue;
    const clip = pack.clips.get(clipName);
    if (!clip || names.has(name)) continue;
    add(alias(name, clip));
  }
  pack.rigClips.set(key, out);
  return out;
}

/** The roles that name a clip the GLB has not got (the role's name, with the list index for a list). */
export function missingRoles(roles: Roles, clips: ReadonlyMap<string, THREE.AnimationClip>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(roles)) {
    if (typeof v === 'string') {
      if (!clips.has(v)) out.push(k);
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        const name = typeof item === 'string' ? item : (item as { clip?: string })?.clip;
        if (name && !clips.has(name)) out.push(`${k}[${i}]`);
      });
    } else if (v && typeof v === 'object') {
      for (const [ek, ev] of Object.entries(v as Record<string, string>)) if (typeof ev === 'string' && !clips.has(ev)) out.push(`${k}.${ek}`);
    }
  }
  return out;
}

/** A line naming what a pack's roles give, for the console: "idle walk run · combat · 2 attacks · ranged · ...". */
export function describeRoles(r: Roles): string {
  const parts: string[] = [];
  parts.push([r.idle && 'idle', r.walk && 'walk', r.run && 'run'].filter(Boolean).join(' ') || 'no locomotion');
  if (r.idleCombat || r.gaitsCombat?.length) parts.push('combat');
  if (r.swim || r.swimIdle) parts.push('swims');
  if (r.hover || r.hoverIdle) parts.push('hovers');
  if (r.attacks?.length) parts.push(`${r.attacks.length} attack${r.attacks.length === 1 ? '' : 's'}`);
  if (r.ranged) parts.push(r.rangedAdditive ? 'ranged (additive)' : 'ranged');
  const hits = [r.hitLight && 'l', r.hitMedium && 'm', r.hitHeavy && 'h'].filter(Boolean).join('/');
  if (hits) parts.push(`hits ${hits}`);
  const down = [r.down && 'down', r.downLoop && 'loop', r.getUp && 'up'].filter(Boolean).join(' ');
  if (down) parts.push(down);
  if (r.knockdown) parts.push('knockdown');
  const emotes = Object.keys(r.emotes ?? {}).length;
  if (emotes) parts.push(`${emotes} emote${emotes === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
