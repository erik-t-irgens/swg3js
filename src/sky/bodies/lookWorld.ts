// Which bodies of a world wear a look the game draws whole (the GPU port's pass 2, wave 5, maker L: `lookBody.ts` draws them):
// a ground sky's cards and the applied system's extra bodies, a space zone's planets, each with its look and its air's record.
// The world calls these behind its loading screens (`World.loadBodies`, `World.loadSpaceBodies`) and hands the plans to the
// runtime (`GPU.rt.lookBodies.make`); nothing here runs in a frame. Three's core types only.
//
// **What a place wears**: the look the applied system names for the body (maker S's `SkyMotion` item), else the Save to
// game's `uses` for its place, a generated look either way (numbers every player's game bakes alike); in development alone, his
// own look of imported pictures where its pictures are on this machine (`privateSky.ts`), its generated twin otherwise. An
// extra body of an applied system (no card of SWG's) that names no look wears the viewer's preset of its kind's recipe.

import type * as THREE from 'three';
import type { SkyBodyCard } from './bodyCard.ts';
import type { BodyCardState } from './skyBody.ts';
import type { LookBodyPlan } from './lookBody.ts';
import { bodyRecord } from './bodyAir.ts';
import { SKY_BODIES, type BodyLook, type SpacePlace } from '../look/bodiesFile.ts';
import { skyDirection, yawPitchOf } from '../system/places.js';
import { bakeable, skyPlaceId } from '../look/lookPictures.ts';
import { privateLookOf } from '../look/privateSky.ts';
import { spaceBodyAir, spacePlaceIds } from '../../space/spaceAir.ts';

/** The motion's items as these plans read them (maker S's `SkyMotion.items`). */
export interface PlanMotion {
  readonly items: readonly { readonly place: string | null; readonly look: string | null; readonly drawn: boolean; readonly slot: string; readonly sizeDeg: number; readonly kind: string; readonly name: string; readonly star: boolean; readonly sheet: boolean }[];
  /** (The sky round's maker P, C) the largest each item is ever drawn (degrees), its picture's size; absent, its setting. */
  readonly largestDeg?: Float64Array;
}

/** A look by its id in the file: a generated one, else none. */
function fileLook(id: string | null | undefined): { id: string; look: BodyLook } | null {
  const f = SKY_BODIES.file;
  if (!f || !id) return null;
  const look = f.looks[id];
  return look && bakeable(look) ? { id, look } : null;
}

/** The look a place wears: his own of imported pictures in development where they are here, else the system's, else the file's. */
export function lookForPlace(place: string, systemLook: string | null): { id: string; look: BodyLook } | null {
  const own = privateLookOf(place);
  if (own) return own;
  return fileLook(systemLook) ?? fileLook(SKY_BODIES.file?.uses[place]);
}

/**
 * A ground sky's plans: each card of SWG's whose place wears a look (its record marked to stand down for it), then each extra
 * body of the applied system. `sky` the viewer's id of the sky, `cards` the sky's own, `group` the sky's group (the cards hang
 * there), `fovDeg` the camera's vertical field, `skyRadius` where SWG's cards hang.
 */
export function skyLookPlans(sky: string, cards: readonly SkyBodyCard[], group: THREE.Object3D, fovDeg: number, skyRadius: number, motion: PlanMotion | null, presetFor: (kind: string) => BodyLook | null): LookBodyPlan[] {
  const plans: LookBodyPlan[] = [];
  const counts: Record<string, number> = {};
  // each card of SWG's by its place (the viewer's id)
  const cardAt = new Map<string, SkyBodyCard>();
  for (const card of cards) {
    if (card.held) continue;
    const nameKey = card.slot === 'celestial' ? skyPlaceId(sky, 'celestial', card.file) : card.slot;
    counts[nameKey] = (counts[nameKey] ?? 0) + 1;
    cardAt.set(skyPlaceId(sky, card.slot, card.file, counts[nameKey]), card);
  }
  // (The sky round's maker P, the brief's A: one route under an applied system.) Every body the system names (drawn, not a star,
  // not a painted sheet) is drawn by its look at the motion's place, size, light and pose, whatever SWG's slot holds there (a
  // card of SWG's stands down for it: its record marked, `markLookDrawn`; a picture with no card, as Mustafar's sun picture in its
  // moon slot, is put away by the sky, `SwgSky.lookStands`). Its look: the system's, else the file's for its place, else (a
  // body with no place of SWG's) its kind's preset; a body on SWG's place with no look of his keeps SWG's picture there, placed,
  // sized and ordered by the system (`SwgSky.placeByMotion`). A place the system hides stays hidden (its item is undrawn).
  const used = new Set<string>();
  if (motion) {
    for (let j = 0; j < motion.items.length; j++) {
      const it = motion.items[j];
      if (!it.drawn || it.star || it.sheet) continue;
      const place = it.place ?? `${sky}:system:${it.name}`;
      if (used.has(place)) continue;
      const card = it.place ? cardAt.get(it.place) ?? null : null;
      const onSwg = it.slot !== 'extra' && it.slot !== 'none';
      const hit = lookForPlace(place, it.look) ?? (onSwg ? null : presetHit(it.kind, presetFor));
      if (!hit) continue;
      used.add(place);
      const deg = motion.largestDeg ? motion.largestDeg[j] : it.sizeDeg;
      plans.push({ place, id: hit.id, look: hit.look, record: card && card.air.kind === 'world' ? bodyRecord(card.air) : null, where: 'sky', card, item: j, byMotion: true, group, order: -5, halfRad: ((deg > 0 ? deg : 1) * Math.PI) / 360, fovDeg });
    }
  }
  // SWG's cards the system does not draw by look (no system, or a place it does not name: SWG's rule there, as before)
  for (const [place, card] of cardAt) {
    if (used.has(place)) continue;
    let item = -1;
    if (motion) {
      for (let j = 0; j < motion.items.length; j++) {
        if (motion.items[j].place === place && !motion.items[j].star) {
          item = j;
          break;
        }
      }
    }
    const hit = lookForPlace(place, item >= 0 ? motion!.items[item].look : null);
    if (!hit) continue;
    const tanD = (0.5 * card.disc.scale.x) / (skyRadius > 0 ? skyRadius : 1);
    plans.push({
      place,
      id: hit.id,
      look: hit.look,
      record: card.air.kind === 'world' ? bodyRecord(card.air) : null,
      where: 'sky',
      card,
      item,
      group: card.disc.parent ?? group,
      order: card.disc.renderOrder,
      halfRad: Math.atan(tanD > 0 ? tanD : 0.01),
      fovDeg,
    });
  }
  return plans;
}

/**
 * (The sky round's maker P, A) The places a sky's plans draw by the motion's route (an item of the applied system), which the
 * sky puts SWG's own pictures away for, whatever they are (`SwgSky.lookStands`).
 */
export function motionLookPlaces(plans: readonly LookBodyPlan[]): Set<string> {
  const out = new Set<string>();
  for (const p of plans) if (p.byMotion) out.add(p.place);
  return out;
}

/** Where SWG's cards hang in a ground sky (`sky.ts`' `SKY_RADIUS`): a card's width over it is its angle's tangent. */
export const SKY_CARD_REACH = 3500;

/** The places a sky's plans draw whole (wave 4b's disc pictures are made only for the rest: `wearSkyLooks`). */
export function lookPlaces(plans: readonly LookBodyPlan[]): Set<string> {
  const out = new Set<string>();
  for (const p of plans) if (p.card) out.add(p.place);
  return out;
}

/** Each planned card's record told its look draws it (its card, twin and halo stand down: `SkyBodies.frame`). */
export function markLookDrawn(plans: readonly LookBodyPlan[]): void {
  for (const p of plans) {
    const st = p.card?.disc.userData.swgBodyCard as BodyCardState | undefined;
    if (st) st.lookDrawn = true;
  }
}

function presetHit(kind: string, presetFor: (kind: string) => BodyLook | null): { id: string; look: BodyLook } | null {
  const look = presetFor(kind);
  return look ? { id: `preset:${kind}`, look } : null;
}

/**
 * A space place he moved in the space body viewer (pass 2, wave 5; the file's `places`): `dir` (the planet's unit direction as the
 * game reads the zone's file, X mirrored) turned to his yaw and pitch, each where he set it, the other kept (`places.js`' own
 * reading of a zone's planet, `yawPitchOf` and `skyDirection`). Written into `dir` in place.
 */
export function placeSpaceBody(place: SpacePlace, dir: { x: number; y: number; z: number }): void {
  if (place.yaw === undefined && place.pitch === undefined) return;
  const was = yawPitchOf(dir);
  const d = skyDirection(place.yaw ?? was.yaw, place.pitch ?? was.pitch);
  dir.x = d.x;
  dir.y = d.y;
  dir.z = d.z;
}

/** A space body's radius for its size across (degrees) where the zone hangs it `distance` away: the viewer's size read back. */
export function spaceBodyRadiusOf(sizeDeg: number, distance: number): number {
  const half = ((sizeDeg > 0 ? sizeDeg : 0.01) * Math.PI) / 360;
  return distance * Math.sin(half < Math.PI / 2 ? half : Math.PI / 2);
}

/** A space zone's planets as the world hung them (its sphere, the radius it was built at, its row in the zone's file). */
export interface SpacePlanetHung {
  readonly mesh: THREE.Mesh;
  readonly radius: number;
  readonly index: number;
}

/**
 * A space zone's plans: each planet whose place wears a look (`<zone>:<appearance>`, `#n` where it repeats), its air the
 * ground world's own record where it is one. `appearances` the zone's file's planets in order.
 */
export function spaceLookPlans(zone: string, appearances: readonly string[], planets: readonly SpacePlanetHung[], group: THREE.Object3D, fovDeg: number): LookBodyPlan[] {
  const ids = spacePlaceIds(zone, appearances);
  const plans: LookBodyPlan[] = [];
  for (const p of planets) {
    const place = ids[p.index];
    if (!place) continue;
    const hit = lookForPlace(place, null);
    if (!hit) continue;
    const air = spaceBodyAir(appearances[p.index]);
    const mp = p.mesh.position;
    const d = Math.sqrt(mp.x * mp.x + mp.y * mp.y + mp.z * mp.z);
    const s = d > 1e-6 ? (p.radius * p.mesh.scale.x) / d : 0.1;
    plans.push({
      place,
      id: hit.id,
      look: hit.look,
      record: air.kind === 'world' ? bodyRecord(air) : null,
      where: 'space',
      mesh: p.mesh,
      radius: p.radius,
      item: -1,
      group,
      order: p.mesh.renderOrder,
      halfRad: Math.asin(s < 0.999 ? s : 0.999),
      fovDeg,
    });
  }
  return plans;
}
