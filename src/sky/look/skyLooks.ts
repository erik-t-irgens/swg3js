// His looks worn by the bodies of a ground sky (the GPU port's pass 2, wave 4b, maker A; the brief's part A, "looks on
// bodies"): behind the loading screen, before the bodies are made (`World.loadBodies`), each card whose place the Save to game
// gives a generated look (`lookOfPlace`) has that look baked on the card (`GPU.rt.looks`, `lookBake.ts`), or read from the
// browser's storage, and made into the card's disc picture (`discPicture`: the sphere face on, the look's surface toned as its
// layer tones it and its clouds laid over, the disc where the card's sphere reads it). The card is handed to the bodies with
// that picture for its map (`SkyBodyCard.map`), so the drawing wears it; a card whose place names no look, whose look is not
// generated, or whose bake was put off past the screen's budget keeps SWG's picture until the next loading screen.
//
// **Lit as a sphere**: a card wearing a look is listed in `SKY_LOOK_CARDS` by its disc (`skyLookOf(card.disc)`), the hook the
// bodies' drawing reads to light it as a sphere (the card's `sphere` 1 and its own reflectance, the look's colours being its
// albedo) whatever `BODY_TUNE.sphere` says for SWG's pictures, so its air's rim follows the look rather than a painted limb.
// Until the drawing reads it, `__debug.skyBodies({ tune: { sphere: 1 } })` lights every body so.
//
// Three's core only (a `DataTexture`), so the world may load it on either renderer; it is called on WebGPU alone, with the
// runtime's looks handed in. Nothing here runs in a frame.

import * as THREE from 'three';
import type { SkyBodyCard } from '../bodies/bodyCard.ts';
import type { GpuLooks } from '../../core/gpuSwitch.ts';
import { BODY_TUNE } from '../bodies/bodyTier.ts';
import { LOOK_BAKE_TUNE, LOOKS_WORN, discPicture, lookOfPlace, skyPlaceId } from './lookPictures.ts';
import { SKY_BODIES } from './bodiesFile.ts';

/** What a card wears: its place, the look's id and name, its disc picture, how its pictures were had, its reflectance. */
export interface SkyLookCard {
  readonly place: string;
  readonly id: string;
  readonly name: string;
  readonly map: THREE.DataTexture;
  readonly how: string;
  /**
   * The sphere's reflectance for this card: 1, since a look's colours are its albedo as the viewer draws them (SWG's
   * pictures' colours are not, hence `BODY_TUNE.sphereAlbedo`'s 0.3 for them).
   */
  readonly albedo: number;
  /** The longitude facing the eye and the tilt the disc was made at, degrees. */
  readonly faceLonDeg: number;
  readonly tiltDeg: number;
}

/** The cards of the sky now hung that wear a look, by their disc mesh: the bodies' drawing's hook. */
export const SKY_LOOK_CARDS = new WeakMap<THREE.Object3D, SkyLookCard>();

/** The look a card wears, or null (SWG's picture). */
export function skyLookOf(disc: THREE.Object3D | null | undefined): SkyLookCard | null {
  return disc ? (SKY_LOOK_CARDS.get(disc) ?? null) : null;
}

/**
 * The longitude of a worn look that faces the eye, degrees: 0 to start, the bake's middle (`u = 0.5`), the side the viewer's
 * Look tab shows first; a body stands still in a ground sky until wave 5 turns it. Feel is the owner's.
 */
export const SKY_LOOK_TUNE = { faceLonDeg: 0 };

/** One disc picture as a texture the card samples: sRGB, mips, clamped (its edges are empty). */
function discTexture(px: Uint8Array, size: number, name: string): THREE.DataTexture {
  const t = new THREE.DataTexture(px, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.name = name;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/** What one screen wore, for `__debug.sky({ looks: true })` and the dispose. */
export interface SkyLooksWorn {
  cards: SkyBodyCard[];
  textures: THREE.Texture[];
}

/**
 * A sky's cards dressed in his looks (behind its loading screen): `sky` the viewer's id of the sky (its pack's), `cards` the
 * sky's own. Answers the cards to hand the bodies (a card wearing a look a copy with its disc picture for its map, the rest
 * as they were) and the textures made, which the caller lets go with the sky.
 */
export async function wearSkyLooks(sky: string, cards: readonly SkyBodyCard[], looks: GpuLooks): Promise<SkyLooksWorn> {
  const out: SkyBodyCard[] = [];
  const textures: THREE.Texture[] = [];
  const counts: Record<string, number> = {};
  LOOKS_WORN.worn = [];
  LOOKS_WORN.at = new Date().toISOString();
  // The screen's budget whole for its looks (the bodies' own air tables begin it again when they are made).
  if (SKY_BODIES.file) looks.beginScreen();
  for (const card of cards) {
    const nameKey = card.slot === 'celestial' ? skyPlaceId(sky, 'celestial', card.file) : card.slot;
    counts[nameKey] = (counts[nameKey] ?? 0) + 1;
    const place = skyPlaceId(sky, card.slot, card.file, counts[nameKey]);
    const hit = lookOfPlace(place);
    if (!hit) {
      out.push(card);
      continue;
    }
    const t0 = performance.now();
    const pics = await looks.bake(hit.id, hit.look, LOOK_BAKE_TUNE.skySize);
    if (!pics) {
      LOOKS_WORN.worn.push({ place, look: hit.id, wears: "SWG's picture (put off to the next loading screen)" });
      out.push(card);
      continue;
    }
    const S = LOOK_BAKE_TUNE.discSize;
    const tilt = Number(hit.look.adjust?.tilt) || 0;
    const px = discPicture(pics, hit.look, { size: S, fill: BODY_TUNE.discFill, faceLonDeg: SKY_LOOK_TUNE.faceLonDeg, tiltDeg: tilt });
    // The bake's own pictures let go once the disc is made (the fixer of pass 2, wave 4b): the storage holds them for the next screen.
    looks.release(hit.look, LOOK_BAKE_TUNE.skySize);
    const map = discTexture(px, S, `look ${hit.id}`);
    textures.push(map);
    const worn: SkyLookCard = { place, id: hit.id, name: hit.look.name, map, how: pics.how, albedo: 1, faceLonDeg: SKY_LOOK_TUNE.faceLonDeg, tiltDeg: tilt };
    SKY_LOOK_CARDS.set(card.disc, worn);
    LOOKS_WORN.worn.push({ place, look: hit.id, name: hit.look.name, pictures: pics.how, size: pics.width, clouds: !!pics.clouds, discMs: Number((performance.now() - t0).toFixed(1)) });
    out.push({ ...card, map });
  }
  return { cards: out, textures };
}

/**
 * At a loading screen's start, once its Save to game is read: the bake kit of every look the zone's places wear asked for
 * ahead (`GpuLooks.warm`, never awaited), so their pipelines land while the world loads and the bodies' bake behind the same
 * screen finds them made. `zone` the viewer's id of the zone (a ground sky's or a space zone's: its pack's); a space zone's
 * looks at the space size. Nothing with no file, or a file naming none of the zone's places.
 */
export function warmZoneLooks(zone: string, looks: GpuLooks): number {
  const f = SKY_BODIES.file;
  if (!f || !zone) return 0;
  const most = zone.startsWith('space_') ? LOOK_BAKE_TUNE.spaceSize : LOOK_BAKE_TUNE.skySize;
  let n = 0;
  for (const place of Object.keys(f.uses)) {
    if (!place.startsWith(zone + ':')) continue;
    const hit = lookOfPlace(place);
    if (!hit) continue;
    n++;
    void looks.warm(hit.look, most).catch(() => {});
  }
  return n;
}

/** A screen's looks let go with its sky: their cards out of the hook, their textures disposed. */
export function dropSkyLooks(worn: SkyLooksWorn | null): void {
  if (!worn) return;
  for (const c of worn.cards) SKY_LOOK_CARDS.delete(c.disc);
  for (const t of worn.textures) t.dispose();
}
