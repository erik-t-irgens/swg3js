// The lit blades as the effects see them: gathered once a frame from the renderers that drew them
// (the player's six and every fighter's), nearest first, with how bright a surface near them can be
// from every other light, which the glow pass needs to tell a lit surface from a glow.
import * as THREE from 'three';
import type { SaberBlade } from './saberBlade';
import type { FighterGlow } from '../world/npcs';
import type { FxBladeList } from '../core/fx/bladeList';
import { BLADE_GLOW_MAX, BLADE_GLOW_TUNE, distanceFade, luminance, radiance, segmentDistanceSq } from '../core/fx/bladeGlowMath.ts';

const WHITE = new THREE.Color(0xffffff);
const mid = new THREE.Vector3();
/** Fighters' lit blades gathered this frame, kept between frames (grows only when more fighters than ever have blades out). */
const candidates: { blade: SaberBlade | null; d2: number }[] = [];
/** Anything that may hold a lit blade: a fighter (`Npc`) or a person from the catalogue (`Mobile`). */
export interface BladeHolder {
  readonly saber: SaberBlade | null;
}
const NONE: readonly BladeHolder[] = [];

/** Adds each holder's lit blade within `far2` of the eye to the candidates from `n`; returns the new count. */
function gather(holders: readonly BladeHolder[], eye: THREE.Vector3, far2: number, n: number): number {
  for (const f of holders) {
    const b = f.saber;
    if (!b?.glowing) continue;
    const d2 = segmentDistanceSq(eye, b.drawnBase, b.drawnTip);
    if (d2 > far2) continue;
    const c = candidates[n] ?? (candidates[n] = { blade: null, d2 });
    c.blade = b;
    c.d2 = d2;
    n++;
  }
  return n;
}

/**
 * The lit blades for the effects, this frame: the player's first (all of them that glow), then the
 * fighters' and the catalogue people's (`more`) nearest the eye, up to BLADE_GLOW_MAX, none farther
 * than the tune's `far`. Each carries its drawn segment, its colour a little toward white, its
 * ignition, and its ignition times the distance fade. No allocation once the candidate list has grown.
 */
export function collectBlades(out: FxBladeList, own: readonly SaberBlade[], fighters: readonly BladeHolder[], eye: THREE.Vector3, more: readonly BladeHolder[] = NONE): number {
  const T = BLADE_GLOW_TUNE;
  const far2 = T.far * T.far;
  out.count = 0;
  for (const blade of own) if (blade.glowing) put(out, blade, true, eye);
  let n = gather(fighters, eye, far2, 0);
  n = gather(more, eye, far2, n);
  // The nearest into the room left: a selection, at most BLADE_GLOW_MAX passes over n.
  for (let k = 0; out.count < BLADE_GLOW_MAX && k < n; k++) {
    let best = k;
    for (let j = k + 1; j < n; j++) if (candidates[j].d2 < candidates[best].d2) best = j;
    const tmp = candidates[k];
    candidates[k] = candidates[best];
    candidates[best] = tmp;
    put(out, candidates[k].blade!, false, eye);
  }
  // Drop what this frame did not keep, so a disposed fighter's renderer is not held.
  for (let k = 0; k < candidates.length; k++) candidates[k].blade = null;
  return out.count;
}

function put(out: FxBladeList, blade: SaberBlade, own: boolean, eye: THREE.Vector3): void {
  if (out.count >= BLADE_GLOW_MAX) return;
  const T = BLADE_GLOW_TUNE;
  const fade = distanceFade(Math.sqrt(segmentDistanceSq(eye, blade.drawnBase, blade.drawnTip)), T);
  const intensity = blade.ignition * fade;
  if (intensity <= 0.002) return;
  const e = out.items[out.count++];
  e.a.copy(blade.drawnBase);
  e.b.copy(blade.drawnTip);
  e.color.copy(blade.color).lerp(WHITE, T.whiteness);
  e.ignition = blade.ignition;
  e.intensity = intensity;
  e.own = own;
}

/**
 * Keeps the `out.length` nearest glows in `out`, nearest first: places one at squared distance `d2`
 * among the `n` already kept (after every one no farther), shifting the farther ones down and letting
 * the farthest fall off when the list is full; one farther than every kept one in a full list is left
 * out. The entries are kept objects, reordered in place. Returns the new count.
 */
export function keepNearestGlow(out: FighterGlow[], n: number, pos: THREE.Vector3, color: number, d2: number): number {
  let k = Math.min(n, out.length);
  while (k > 0 && out[k - 1].d2 > d2) k--;
  if (k >= out.length) return n;
  // The free entry, or the farthest, which falls off; the entries between shift down one.
  const end = Math.min(n, out.length - 1);
  const slot = out[end];
  for (let j = end; j > k; j--) out[j] = out[j - 1];
  out[k] = slot;
  slot.pos.copy(pos);
  slot.color = color;
  slot.d2 = d2;
  return n < out.length ? n + 1 : n;
}

/** What the light ceiling reads. World and Effects each implement `litIrradianceNear`. */
export interface LitSources {
  world: { litIrradianceNear(p: THREE.Vector3, reach: number): number };
  effects: { litIrradianceNear(p: THREE.Vector3, reach: number): number };
  /** The hand torch while it is on, else null. */
  torch: THREE.SpotLight | null;
  eye: THREE.Vector3;
}

/**
 * The brightest a white surface near the listed blades can be from every light but the blades: the
 * most, over the blades, of the world's, the pooled lights' and the torch's irradiance luminance near
 * each blade's middle, over PI. 1 when the list is empty. The glow pass takes a pixel much brighter
 * than this for additive glow.
 */
export function litCeiling(list: FxBladeList, src: LitSources): number {
  if (list.count === 0) return 1;
  const reach = BLADE_GLOW_TUNE.range;
  let e = 0;
  for (let i = 0; i < list.count; i++) {
    const bl = list.items[i];
    mid.copy(bl.a).lerp(bl.b, 0.5);
    let here = src.world.litIrradianceNear(mid, reach) + src.effects.litIrradianceNear(mid, reach);
    const t = src.torch;
    if (t && t.intensity > 0) here += (luminance(t.color.r, t.color.g, t.color.b) * t.intensity) / Math.pow(Math.max(1, src.eye.distanceTo(mid) - reach), t.decay);
    if (here > e) e = here;
  }
  return e / Math.PI;
}

/**
 * For the console: what a neutral surface at `p`, facing each listed blade, gains from it (one
 * channel of a white light, from the CPU copy of the shader without the march or the hue), times
 * `strength`. Fills `out` per blade and returns the sum.
 */
export function lightAt(p: THREE.Vector3, list: FxBladeList, strength: number, out: number[]): number {
  out.length = 0;
  let total = 0;
  for (let i = 0; i < list.count; i++) {
    const bl = list.items[i];
    const v = radiance(segmentDistanceSq(p, bl.a, bl.b), 1, BLADE_GLOW_TUNE) * bl.intensity * strength;
    out.push(v);
    total += v;
  }
  return total;
}
