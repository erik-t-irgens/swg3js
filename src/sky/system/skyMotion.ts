// Skies in motion in the game (the GPU port's pass 2, wave 5, maker S; the design's 2.11, the brief's part S and the
// owner's answers of 21 November on days and orbits). A world whose star system the owner applied in the space body viewer
// (Apply, then Save to game: `public/sky/bodies.json`'s `systems`) draws its sky from that system's clockwork
// (`system.js`, one copy the viewer and the game import), each frame allocating nothing:
//   - **its own day**: one steady spin per world (`dayHours`, 2 to 6 hours, night as long as day at the equator), at the
//     play area's latitude and longitude, under an axial tilt held at a fixed time of year (no seasons ever). The day's
//     length and its place in the shared day are this file's (`lengthSeconds`, `phase`), which `DayCycle`, the shared clock,
//     the server (`server/clock.mjs`'s `worldDays`) and the story's hour all read, so two browsers on one world and the
//     server see one hour;
//   - **everything not under your feet in real time** at its lore rates (orbits in real days, every body's own spin in real
//     hours): the sky's time `T` is real days since `system.js`'s `EPOCH_MS`, taken from the day's own unbroken count
//     (`DayCycle.count`, the design's "one sky time"), so a moon never jumps where a day turns over, and with the shared
//     clock it is that clock's real time to the bit;
//   - **phases, eclipses, giantshine and the night light**: each body's lit share and lit side from where it and the star
//     really are; a body in front of a sun covers a share of it (`cover`), which dims the sun's light and the air's
//     (`sunShare`, `sun2Share`); the night light aims at the brightest body up, its light the bodies' lit share by their
//     size against the world's own SWG moon (`moonShare`, 1 is today's nearly full moon), tinted by their colour;
//   - **Tatooine's pair** as one item: the second sun beside the caster at the system's line angle, `separation` degrees
//     between the two discs' edges as the game draws them (the star table's radii times the disc size dial), so the pair
//     stays inside the caster's arc (rises after, sets before) at the draft's line angle and never overlaps.
//
// A world the file does not apply has no motion (`skyMotionFor` answers null) and every reader keeps today's sky exactly.
//
// **The drawing's interface** (what maker L's bodies, maker V's viewer and maker M's map read): `SKY_MOTION.now` is the
// motion of the world on screen (null elsewhere); after `DayCycle.update` each frame its kept arrays hold, for every item
// `j` of `items` (every body but the world you stand on, a group's members and each sun of a pair each its own):
//   dir[3j..3j+2]   its direction from the eye in the game's sky frame (+Y up, +X where the sun sets, -Z toward the noon sun
//                   of the north: the frame `SwgSky.place` hangs cards in), unit length;
//   light[3j..]     the direction from it toward its star (its lit side), in the same frame;
//   lit[j]          the share of its face we see lit (0 new, 1 full);
//   dist[j]         its distance from us in the model's units (astronomical units: nearer draws in front);
//   cover[j]        for a star, the share of its bright disc something nearer covers (an eclipse);
//   spinTurn[j]     its own turn now as a share of its own day, 0 to 1 (a giant's bands), 0 for a body that does not turn;
// and `items[j]` says what it is: its name, body, kind, the SWG place it stands for here (`place`, `slot`, `picture`; null
// and 'none' for a lore body SWG's sky has no place for, which the drawing hangs a card of its own for), the look the
// system names (`look`), its size (`sizeDeg`, the angle its square fills, as SWG's squares are read), its colour and
// brightness, and whether it is drawn. Nothing here touches three or a page: node runs it as it stands.

import { compileSystem, makeSkyState, skyAtNext, EPOCH_MS, DAY_MS, NIGHT_REF_SIZE, SHEET_SHARE, POLE_ELEVATION } from './system.js';
import { appliedSystemOf, worldDayOf, type SystemsRecord } from './worldDays.ts';
import { DISC_FILL } from './places.js';
import { EXTRA_PLACES } from './extraPlaces.js';
import { DISC_TUNE } from '../skyDials.ts';
import { PAIR_MOVES, PAIR_TUNE, casterOf, secondOf } from '../stars.ts';
// (the sky round's maker P: B's poses and C's sizes, one pure module the viewer's ground view calls too)
import { bodyPosesInto, distanceKitOf, largestSizeDeg, poseKitOf, sizesInto, type DistanceKit, type PoseKit, type PoseModel, type PoseState } from './bodyPose.ts';
import { beltKitOf, beltsInto, type BeltKit } from './beltSky.ts';
// (the sky round's maker L: D to G, the light between the bodies, one pure module the motion calls at the end of its frame)
import { SkyShade } from './skyShade.ts';

const DEG = Math.PI / 180;

/**
 * SWG's pole in the sky (+Y up, +Z north): where a version 1 system's day turns the bodies (`system.js`' `POLE_ELEVATION`, 22.5
 * degrees up over +Z), the celestial frame's pole for such a system. A typed array, so the frame reads plain numbers
 * (the fixer of pass 2, wave 6).
 */
const SWG_POLE = new Float64Array([0, Math.sin(POLE_ELEVATION * DEG), Math.cos(POLE_ELEVATION * DEG)]);

/**
 * The motion's dials (the owner's to set; feel and look are his, each starts where the reason beside it says):
 *   - `giantshine`: a giant's light at night (Yavin Prime over Yavin 4, Endor's giant over its forest moon) as a share of what
 *     its lit area against the world's own SWG moon gives. 1 to start: a giant reflects by the very rule a moon does (its
 *     lit share times its area against SWG's moon, whose full face is today's night light), so the owner's red giantshine is
 *     what the giant's size and phase make of it; 0 leaves the night to the moons.
 *   - `tint`: how much of a body's own colour its night light takes (0 white as SWG's moon is today, 1 its colour at full,
 *     luminance kept). 1 to start, so Yavin Prime's light is its orange and the night under it red (the owner's "red
 *     giantshine at night").
 *   - `eclipse`: how much of a covered sun's light an eclipse takes (1 all of the covered share, 0 none). 1 to start: a
 *     body in front of a sun hides that share of it, as it is drawn.
 */
export const MOTION_TUNE = {
  giantshine: 1,
  tint: 1,
  eclipse: 1,
  /**
   * (The sky round's maker P, the brief's C) "Size follows distance", 0 to 1: how much a body's drawn size follows its true
   * distance from the world one stands on. A body's size setting is its size at its average distance (`bodyPose.ts`'
   * `distanceKitOf`), so at 1 it grows as it comes near and shrinks as it goes far (Kef Bir from Endor's forest moon 4.4 times
   * wider at its nearest than at its farthest), at 0 it keeps its setting at every distance as before. 1 to start: the owner's
   * word ("planets don't change size dependent on their distance from you ... it looks like Kef Bir is orbiting ME").
   */
  distanceSize: 1,
};

/**
 * A body's share of the cards' draw order under an applied system (the fixer of pass 2, wave 5). Every body of a ground sky
 * stands at one draw order, and three orders a tie by the card's depth on the screen, which is no body's distance: where two
 * overlap, the one drawn last covered the other whichever was nearer. Added to that order, a nearer body is drawn later,
 * 0.9 / (1 + its distance in AU), under one step of order at any distance.
 */
export function nearOrder(distAu: number): number {
  return distAu > 0 ? 0.9 / (1 + distAu) : 0.9;
}
/** The dials' ranges (the console's and the sliders' alike). */
export const MOTION_RANGE = { giantshine: [0, 4], tint: [0, 1], eclipse: [0, 1], distanceSize: [0, 1] } as const;

/** Which of SWG's slots a place is: the game's card for it (`SwgSky`'s sun, second sun, moon, second moon, a celestial). */
export type MotionSlot = 'sun' | 'sun2' | 'moon' | 'moon2' | 'celestial' | 'extra' | 'none';

/** One place of a world's sky as the game has it: SWG's slots and celestials, and the owner's extra places of that world. */
export interface SkyPlace {
  id: string;
  slot: MotionSlot;
  /** The celestial's index in the sky's list (a slot's -1). */
  index: number;
  /** The angle its square fills, degrees (SWG's `2 atan(size / 3)`; an extra place's start). */
  sizeDeg: number;
  /** A celestial's picture by its file's name (`cels_ice_moon`), else null. */
  picture: string | null;
  /** A painted sheet of moons (the owner's night-sky places), never a body. */
  sheet: boolean;
}

/** What `skyPlacesOf` reads of a converted sky (`SkyData`'s shape; plain numbers and names). */
export interface SkyPlaceSource {
  sun?: { size: number } | null;
  supplementalSun?: { size: number } | null;
  moon?: { size: number } | null;
  supplementalMoon?: { size: number } | null;
  celestials?: readonly { size: number; image?: { file: string } | null }[];
  /** (The sky round's fixer) his sizes for the world's own extra places, degrees across (`groundPlaces.ts`), else absent. */
  placeSizes?: Readonly<Record<string, number>>;
}

/** A square of SWG size `size` (half-wide 3 m out) as the angle it fills, degrees: `places.js`' `skySquareDegrees`. */
export function squareDegrees(size: number): number {
  return (2 * Math.atan((size > 0 ? size : 0) / 3)) / DEG;
}

/** A picture's name from its file (`sky/cels_ice_moon.png` -> `cels_ice_moon`), as the viewer's places name it. */
export function pictureNameOf(file: string | null | undefined): string | null {
  if (!file) return null;
  return file.replace(/^.*\//, '').replace(/\.\w+$/, '');
}

/**
 * Every place of a world's sky, by id, as the viewer's places name them (`places.js`' `buildPlaces`): `<world>:sun`,
 * `:sun2`, `:moon`, `:moon2`, `<world>:celestial:<picture>` (a second of one picture `#2`), and the owner's extra places of
 * that world (`looks.js`' `EXTRA_PLACES`). Made once at an arrival.
 */
export function skyPlacesOf(world: string, d: SkyPlaceSource | null): Map<string, SkyPlace> {
  const out = new Map<string, SkyPlace>();
  if (d) {
    const slot = (k: 'sun' | 'sun2' | 'moon' | 'moon2', c: { size: number } | null | undefined): void => {
      if (c) out.set(`${world}:${k}`, { id: `${world}:${k}`, slot: k, index: -1, sizeDeg: squareDegrees(c.size), picture: null, sheet: false });
    };
    slot('sun', d.sun);
    slot('sun2', d.supplementalSun);
    slot('moon', d.moon);
    slot('moon2', d.supplementalMoon);
    const counts: Record<string, number> = {};
    (d.celestials ?? []).forEach((c, i) => {
      const name = pictureNameOf(c.image?.file) ?? 'unnamed';
      counts[name] = (counts[name] ?? 0) + 1;
      const id = `${world}:celestial:${name}${counts[name] > 1 ? '#' + counts[name] : ''}`;
      out.set(id, { id, slot: 'celestial', index: i, sizeDeg: squareDegrees(c.size), picture: name, sheet: false });
    });
  }
  // (the sky round's fixer) an extra place's size his Place tab set (`placeSizes`, laid by `groundPlaces.ts`), else its start
  const own = d?.placeSizes ?? null;
  for (const e of EXTRA_PLACES) {
    if (e.zone !== world || out.has(e.id) || e.kind === 'body') continue;
    const set = own !== null && typeof own[e.id] === 'number' && own[e.id] > 0 ? own[e.id] : null;
    out.set(e.id, { id: e.id, slot: 'extra', index: -1, sizeDeg: set ?? e.start.size ?? 20, picture: null, sheet: e.kind === 'sheet' });
  }
  return out;
}

// ---------------------------------------------------------------- which sky a world follows, and its day

export { appliedSystemOf, worldDayOf, worldHourAt, worldDaysOf, type SystemsRecord, type WorldDay } from './worldDays.ts';
// ---------------------------------------------------------------- one world's sky in motion

/** What one item is (made once at an arrival; never written in play). */
export interface MotionItem {
  readonly index: number;
  readonly name: string;
  /** The system body's id (a pair's two suns share it, a group's members share theirs). */
  readonly body: string;
  /** The body's kind: star, pair (each of its two suns), planet, giant, moon, group (a member), station, comet. */
  readonly kind: string;
  readonly star: boolean;
  /** Whether the sky draws it (a body not drawn, a place linked twice drawn once, a place the system hides). */
  readonly drawn: boolean;
  /** The place it stands for in this world's sky (`yavin4:celestial:yavin_prime`), or null: a lore body SWG has no place for. */
  readonly place: string | null;
  /** Which of SWG's slots that place is in this sky ('extra' an owner's extra place, 'none' no place in this sky). */
  readonly slot: MotionSlot;
  /** A celestial place's index in the sky's list, else -1. */
  readonly celestial: number;
  /** A celestial place's picture name, else null. */
  readonly picture: string | null;
  /** The look the system names for it (else the file's `uses` names one for its place), or null. */
  readonly look: string | null;
  /** The angle its square fills, degrees: its own size in the system, else its place's, else its kind's (`system.js`). */
  readonly sizeDeg: number;
  /** The share of its square its bright disc fills (a star's `DISC_FILL`; a moon's disc fills its card, the drawing's own). */
  readonly discFill: number;
  readonly colour: string | null;
  /** A star's share of the light (Tatoo II 0.8), else 0. */
  readonly brightness: number;
  /** A painted sheet of moons, never a body (it hides no sun). */
  readonly sheet: boolean;
  /** Its own spin, degrees a real day (a giant's bands), 0 for none. */
  readonly spinDeg: number;
  /** The world you stand on goes round it locked: it stands still in your sky, phasing once a day. */
  readonly holdsStill: boolean;
  /** For the second sun of a pair, the first's index; else -1. */
  readonly pairOf: number;
}

interface Dir3 {
  x: number;
  y: number;
  z: number;
}

type Model = {
  version: 1 | 2;
  m: number;
  items: { body: number; place: string | null; look: string | null; name: string; size: number; star: boolean; drawn: boolean; member: boolean; colour?: string | null; brightness?: number; pair?: number }[];
  hidden: Set<string>;
  itemStar: Uint8Array;
  itemDrawn: Uint8Array;
  itemSheet: Uint8Array;
  itemSize: Float64Array;
  itemSpin?: Float64Array;
  itemPair?: Int16Array;
  pairA?: Int16Array;
  pairB?: Int16Array;
  pairAngle?: Float64Array;
  casterJ?: number;
  lat?: number;
  dayDays?: number;
  lonDeg?: number;
  worldI: number;
  parent: Int16Array;
  lockDay?: Float64Array;
  sys: { bodies: { id: string; kind: string; separation?: number; turns?: number }[] };
};
type State = {
  T: number;
  next: number;
  /** The system's space into the sky (row after row): the bodies' turn, the stars' too (the fixer of pass 2, wave 6). */
  R: Float64Array;
  dir: Float64Array;
  light: Float64Array;
  lit: Float64Array;
  dist: Float64Array;
  cover: Float64Array;
  poleSky: Float64Array;
  daylight: number;
  night: number;
  hour: number;
  day: { hours: number; normalized: number; ratio: number; isDay: boolean; sun: Dir3 };
};

/** A colour `#rrggbb` as linear light of luminance 1, into `out` (white for none). Made once at an arrival. */
function tintOf(hex: string | null | undefined, out: Float64Array, at: number): void {
  let r = 1;
  let g = 1;
  let b = 1;
  if (typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex)) {
    const lin = (v: number): number => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    r = lin(parseInt(hex.slice(1, 3), 16));
    g = lin(parseInt(hex.slice(3, 5), 16));
    b = lin(parseInt(hex.slice(5, 7), 16));
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (l > 1e-6) {
      r /= l;
      g /= l;
      b /= l;
    } else r = g = b = 1;
  }
  out[at] = r;
  out[at + 1] = g;
  out[at + 2] = b;
}

/** The shared record the drawing reads: the motion of the world on screen, or null (SWG's sky, today's day). */
export const SKY_MOTION: { now: SkyMotion | null } = { now: null };

/**
 * One world's sky under its applied system: made once at an arrival (`skyMotionFor`), then `at(count)` once a frame from the
 * day's unbroken count, writing every kept field below. Allocates nothing in `at`.
 */
export class SkyMotion {
  readonly rule: 'system' | 'one-world';
  /** The system's key in the file (a star system's id, or `v1:<world>`). */
  readonly id: string;
  readonly name: string;
  /** The sky's world (its pack, as the places name it) and the game's planet it stands for. */
  readonly world: string;
  readonly planet: string;
  readonly version: 1 | 2;
  readonly items: readonly MotionItem[];
  readonly m: number;
  /** Version 2: the world's own day (its length in real seconds, `DayCycle.phase` for it), else 0 and 0 (the game's own day). */
  readonly lengthSeconds: number;
  readonly phase: number;
  readonly lonTurn: number;
  readonly dayDays: number;
  /** Version 2 owns the world's day (its hour, its sun); version 1 keeps the game's day and places the bodies alone. */
  readonly ownsDay: boolean;
  /** The size of the world's SWG moon (its `moon` slot's square, degrees): the night light's unit (`moonShare` 1). */
  readonly moonRefDeg: number;

  // ---- each frame (kept: written in place by `at`)
  readonly dir: Float64Array;
  readonly light: Float64Array;
  readonly lit: Float64Array;
  readonly dist: Float64Array;
  readonly cover: Float64Array;
  readonly spinTurn: Float64Array;
  /**
   * (The sky round's maker P, the brief's B and C) each item's drawn size now (degrees: its setting at its mean distance, grown
   * and shrunk with its true distance by `MOTION_TUNE.distanceSize`), its mean, nearest and farthest distance (AU, worked once
   * here), the largest it is ever drawn (its picture's size), and its pose: nine numbers an item, the look's x, its axis and its
   * meridian as columns in the sky's frame, held in the system's frame and turned into the sky by its turn (`bodyPose.ts`).
   * `locked` an item that keeps one face to its parent (its look does not turn of itself); `ownSpinDeg` the spin its look turns by.
   */
  readonly sizeNow: Float64Array;
  readonly meanDist: Float64Array;
  readonly nearDist: Float64Array;
  readonly farDist: Float64Array;
  readonly largestDeg: Float64Array;
  readonly pose: Float64Array;
  readonly locked: Uint8Array;
  readonly ownSpinDeg: Float64Array;
  /** (Maker P, the brief's J) the drawn belts' numbers for the night's band (`beltSky.ts`' layout), and how many are drawn. */
  readonly belts: Float64Array;
  beltCount = 0;
  private readonly poseKit: PoseKit;
  private readonly distKit: DistanceKit;
  readonly beltKit: BeltKit;
  /** The sky's time, real days since `EPOCH_MS` (version 2), or the sky time on the game's clock (version 1). */
  T = Number.NaN;
  /** The play area's hour of its own day (version 2), 0 to 24, 12 its sun's highest at the equator. */
  hour = 0.5;
  /** SWG's light time from where the casting sun really is (0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight), and the rest of the day's words. */
  normalized = 0.5;
  ratio = 0.5;
  isDay = false;
  /** The casting sun, the pair's second (-1 none) and the brightest night body (-1 none), by item index. */
  casterJ = -1;
  secondJ = -1;
  nightJ = -1;
  /** Their directions (the caster's, the second's, the night body's or straight down with none), kept records. */
  readonly sun: Dir3 = { x: 0, y: 0.5, z: -0.5 };
  readonly sun2: Dir3 = { x: 0, y: 0.5, z: -0.5 };
  readonly nightDir: Dir3 = { x: 0, y: -0.5, z: 0.5 };
  /** The share of the stars' light reaching the ground (an eclipse takes some), and each sun's own share left. */
  daylight = 0.5;
  sunShare = 0.5;
  sun2Share = 0.5;
  /** The night light against today's (SWG's nearly full moon of the world's own size, 1), and its colour (luminance 1). */
  moonShare = 0.5;
  readonly moonTint = new Float64Array(3);
  /** The system's own night brightness (1 a full 20-degree moon straight up), for the console. */
  night = 0.5;
  /**
   * (The fixer of pass 2, wave 6: the owner's late addition 2) The world's own celestial frame in the sky now, nine numbers
   * column after column: its equator's reference (the system's fixed +X laid into the world's equator), the equator a quarter
   * turn on, and the pole (version 2 the world's own axis, standing at the play area's latitude over its true north; version
   * 1 SWG's pole, about which its day turns the bodies). Written by `at`, so the night's stars (`skyTurn.ts`'
   * `celestialFrameInto`) turn with the world's own spin, its sidereal day, and share one sky with the sun and the bodies.
   */
  readonly celestial = new Float64Array(9);
  /** The sky time `celestial` was written at (NaN before the first `at`). */
  celestialAt = Number.NaN;

  private readonly model: Model;
  private readonly state: State;
  /** Each item's night-light weight (a giant's or a sheet's share, its size against the moon's squared) and colour. */
  private readonly weight: Float64Array;
  private readonly isGiant: Uint8Array;
  private readonly tints: Float64Array;
  /** The pair's game-drawn apart (radians, centre to centre), its line angle and whether there is one. */
  private readonly pairGap: number;
  private readonly pairAngle: number;
  private readonly discA: number;
  private readonly discB: number;
  private readonly hemi: number;
  /**
   * Pass 2, wave 6 (maker K): what this system says to the pair's two dials of the `sky` helper (`stars.ts`' `PAIR_TUNE`): its
   * Line angle as the dial's angle (the line angle plus 90, so its -90 below is the dial's 0) and its middles' distance as the
   * sky draws them now; null with no pair. The loading screen sets the dials to it (`World.followMotion`, `pairDialsFrom`).
   */
  readonly pairSays: { angleDeg: number; distanceDeg: number } | null;
  /** `PAIR_MOVES.n` when this motion was made: the pair stands by the system's own numbers until the dials are moved by hand. */
  private readonly pairMovesAt: number;
  /**
   * (The sky round's maker L, the brief's D to G) the light between the bodies (`skyShade.ts`): each sun's direct light and the
   * air's through an eclipse, written over `cover`, `sunShare`, `sun2Share` and `daylight` at the end of each `at`, and every
   * drawn body's casters for its look's own light. Null only where it could not be made (the motion stands as before).
   */
  readonly shade: SkyShade | null;

  constructor(rule: 'system' | 'one-world', id: string, sys: Record<string, unknown>, world: string, planet: string, places: Map<string, SkyPlace>) {
    this.rule = rule;
    this.id = id;
    this.name = typeof sys.name === 'string' ? sys.name : id;
    this.world = world;
    this.planet = planet;
    const sizeOf = (pid: string): number | null => places.get(pid)?.sizeDeg ?? null;
    const sheetOf = (pid: string): boolean => places.get(pid)?.sheet === true;
    const model = compileSystem(sys, sizeOf, sheetOf, { world, placeExists: (pid: string) => places.has(pid) }) as unknown as Model;
    this.model = model;
    this.state = makeSkyState(model) as unknown as State;
    this.version = model.version === 2 ? 2 : 1;
    this.ownsDay = this.version === 2;
    const day = this.version === 2 ? worldDayOf(sys, world) : null;
    this.lengthSeconds = day ? day.lengthSeconds : 0;
    this.phase = day ? day.phase : 0;
    this.lonTurn = day ? day.lonTurn : 0;
    this.dayDays = day ? day.dayDays : 0;
    const m = model.m;
    this.m = m;
    this.dir = this.state.dir;
    this.light = this.state.light;
    this.lit = this.state.lit;
    this.dist = this.state.dist;
    this.cover = this.state.cover;
    this.spinTurn = new Float64Array(m);
    // (maker P: B and C) the pose's rules and the distances, worked once here (the clockwork sampled on a state of its own)
    const pm = model as unknown as PoseModel;
    this.poseKit = poseKitOf(pm);
    this.distKit = distanceKitOf(pm);
    this.meanDist = this.distKit.mean;
    this.nearDist = this.distKit.near;
    this.farDist = this.distKit.far;
    this.sizeNow = Float64Array.from(model.itemSize);
    this.largestDeg = new Float64Array(m);
    for (let j = 0; j < m; j++) this.largestDeg[j] = largestSizeDeg(pm, this.distKit, j);
    this.pose = new Float64Array(9 * m);
    this.locked = new Uint8Array(m);
    this.ownSpinDeg = this.poseKit.spinDeg;
    for (let j = 0; j < m; j++) this.locked[j] = this.poseKit.locked[model.items[j].body];
    // (maker P: J) the belts the system draws (a belt's Drawn tick), their numbers written each frame
    this.beltKit = beltKitOf(pm);
    this.belts = new Float64Array(this.beltKit.stride * Math.max(1, this.beltKit.count));
    this.weight = new Float64Array(m);
    this.isGiant = new Uint8Array(m);
    this.tints = new Float64Array(3 * m);
    const moonPlace = places.get(`${world}:moon`);
    this.moonRefDeg = moonPlace && moonPlace.sizeDeg > 0 ? moonPlace.sizeDeg : 10;
    const items: MotionItem[] = [];
    const bodies = model.sys.bodies;
    const holdsStillBody = this.version === 2 && model.lockDay && model.lockDay[model.worldI] > 0 ? model.parent[model.worldI] : -1;
    for (let j = 0; j < m; j++) {
      const it = model.items[j];
      const b = bodies[it.body];
      const place = it.place;
      const p = place ? places.get(place) : undefined;
      const hidden = !!place && model.hidden.has(place);
      const kind = it.member ? 'group' : b.kind;
      const star = !!model.itemStar[j];
      const spinDeg = this.version === 2 ? (model.itemSpin?.[j] ?? 0) : (b.turns ?? 0) * 360;
      items.push({
        index: j,
        name: it.name,
        body: b.id,
        kind,
        star,
        drawn: !!model.itemDrawn[j] && !hidden,
        place: place ?? null,
        slot: p ? p.slot : 'none',
        celestial: p ? p.index : -1,
        picture: p ? p.picture : null,
        look: it.look ?? null,
        sizeDeg: model.itemSize[j],
        discFill: star ? DISC_FILL : 1,
        colour: it.colour ?? null,
        brightness: star ? (it.brightness ?? 1) : 0,
        sheet: !!model.itemSheet[j],
        spinDeg,
        holdsStill: it.body === holdsStillBody,
        pairOf: model.itemPair ? model.itemPair[j] : -1,
      });
      const s = model.itemSize[j] / this.moonRefDeg;
      this.isGiant[j] = b.kind === 'giant' ? 1 : 0;
      this.weight[j] = star || !items[j].drawn ? 0 : s * s * (model.itemSheet[j] ? SHEET_SHARE : 1);
      tintOf(it.colour, this.tints, 3 * j);
    }
    this.items = items;
    // The pair: the second sun at the system's line angle, the gap between the two discs' edges as the game draws them.
    const pa = model.pairA && model.pairA.length ? model.pairA[0] : -1;
    const pb = model.pairB && model.pairB.length ? model.pairB[0] : -1;
    this.secondJ = pb;
    this.casterJ = this.version === 2 ? (model.casterJ ?? -1) : model.itemStar.indexOf(1);
    const pairBody = pb >= 0 ? bodies[model.items[pb].body] : null;
    this.pairGap = (pairBody?.separation ?? 1.5) * DEG;
    this.pairAngle = model.pairAngle && model.pairAngle.length ? model.pairAngle[0] : -Math.PI / 2;
    const c = casterOf(planet);
    const s2 = secondOf(planet);
    this.discA = (c ? c.radiusDeg : 0.27) * DEG;
    this.discB = (s2 ? s2.radiusDeg : c ? c.radiusDeg : 0.27) * DEG;
    this.hemi = (model.lat ?? 0) < 0 ? -1 : 1;
    if (pa >= 0 && pb >= 0 && this.casterJ !== pa && this.casterJ !== pb) this.secondJ = -1;
    // Pass 2, wave 6 (maker K): the dials' agreement. The system's Line angle and the dial's angle are one direction measured
    // from one place (below), the dial 90 more; the dial's distance is middle to middle, the system's separation edge to edge.
    let ang = this.pairAngle / DEG + 90;
    if (ang > 180) ang -= 360;
    this.pairSays = this.secondJ >= 0 ? { angleDeg: Math.round(ang * 1e6) / 1e6, distanceDeg: Math.round((((this.discA + this.discB) * DISC_TUNE.size + this.pairGap) / DEG) * 1e6) / 1e6 } : null;
    this.pairMovesAt = PAIR_MOVES.n;
    // (maker L: D to G) the light between the bodies, made last: it reads the items, the casting sun and the mean distances
    let shade: SkyShade | null = null;
    try {
      shade = new SkyShade(this, model as unknown as ConstructorParameters<typeof SkyShade>[1], planet);
    } catch {
      shade = null;
    }
    this.shade = shade;
  }

  /** The sky's time `T` for the day's unbroken count (`DayCycle.count`): version 2's real days, version 1's sky time. */
  timeOfCount(count: number): number {
    if (this.version === 2) return (count - this.lonTurn) * this.dayDays;
    // Version 1 runs on the game's own day: its sky time is the calendar day plus the light time of the hour, the hours
    // before 06:00 the night before's (`system.js`' `skyTime`, worked here so no number crosses a call).
    const day = Math.floor(count);
    const t = count - day;
    let r = t - 0.25;
    r -= Math.floor(r);
    let n = r < 0.7 ? 0.5 * (r / 0.7) : 0.5 + 0.5 * ((r - 0.7) / 0.3);
    if (n >= 1) n = 0;
    return day + n - (t < 0.25 ? 1 : 0);
  }

  /**
   * The sky at the day's unbroken count (`day.count`, `DayCycle`'s: read off the record, so no number crosses the call):
   * every item's place, light, phase, distance and cover, the pair as the game draws it, the night light and the day's words.
   * Allocates nothing.
   */
  at(day: { readonly count: number }): void {
    const count = day.count;
    // `timeOfCount`, in place.
    let T: number;
    if (this.version === 2) T = (count - this.lonTurn) * this.dayDays;
    else {
      const whole = Math.floor(count);
      const t = count - whole;
      let r = t - 0.25;
      r -= Math.floor(r);
      let n = r < 0.7 ? 0.5 * (r / 0.7) : 0.5 + 0.5 * ((r - 0.7) / 0.3);
      if (n >= 1) n = 0;
      T = whole + n - (t < 0.25 ? 1 : 0);
    }
    const M = this.model;
    const st = this.state;
    st.next = T;
    skyAtNext(M, st);
    this.T = T;
    // (maker P: C, B, J) each item's drawn size by its distance, its pose turned into the sky, and the drawn belts' numbers
    sizesInto(M as unknown as PoseModel, st as unknown as PoseState, this.distKit, MOTION_TUNE, this.sizeNow);
    bodyPosesInto(M as unknown as PoseModel, st as unknown as PoseState, this.poseKit, this.pose);
    if (this.beltKit.count > 0) this.beltCount = beltsInto(M as unknown as PoseModel, st as unknown as PoseState, this.beltKit, this.belts);
    // (The fixer of pass 2, wave 6) the world's celestial frame for the night's stars: its pole the axis the bodies turn about
    // (version 2 the world's own, `poleSky`; version 1 SWG's), taken back into the system's space (R's transpose), the
    // system's +X laid into that equator, and the three turned into the sky by R. Arrays read and written: nothing made.
    {
      const R = st.R;
      const C = this.celestial;
      if (this.version === 2) {
        C[6] = st.poleSky[0];
        C[7] = st.poleSky[1];
        C[8] = st.poleSky[2];
      } else {
        C[6] = SWG_POLE[0];
        C[7] = SWG_POLE[1];
        C[8] = SWG_POLE[2];
      }
      const P0 = C[6];
      const P1 = C[7];
      const P2 = C[8];
      const Ax = R[0] * P0 + R[3] * P1 + R[6] * P2;
      const Ay = R[1] * P0 + R[4] * P1 + R[7] * P2;
      const Az = R[2] * P0 + R[5] * P1 + R[8] * P2;
      let ux = 1 - Ax * Ax;
      let uy = -Ax * Ay;
      let uz = -Ax * Az;
      let ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
      if (ul < 1e-6) {
        // the axis along the system's +X: its +Y laid into the equator instead
        ux = -Ay * Ax;
        uy = 1 - Ay * Ay;
        uz = -Ay * Az;
        ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
        if (ul < 1e-12) ul = 1;
      }
      ux /= ul;
      uy /= ul;
      uz /= ul;
      const vx = Ay * uz - Az * uy;
      const vy = Az * ux - Ax * uz;
      const vz = Ax * uy - Ay * ux;
      C[0] = R[0] * ux + R[1] * uy + R[2] * uz;
      C[1] = R[3] * ux + R[4] * uy + R[5] * uz;
      C[2] = R[6] * ux + R[7] * uy + R[8] * uz;
      C[3] = R[0] * vx + R[1] * vy + R[2] * vz;
      C[4] = R[3] * vx + R[4] * vy + R[5] * vz;
      C[5] = R[6] * vx + R[7] * vy + R[8] * vz;
      this.celestialAt = T;
    }
    const m = this.m;
    const dir = st.dir;
    // The pair, as the game draws it: the second beside the caster along the system's line, the gap between the edges of the
    // two discs the air draws (the star table's radii times the disc size dial), toward or away from the sky's pole.
    const a = this.casterJ;
    const b = this.secondJ;
    if (a >= 0 && b >= 0) {
      const a3 = 3 * a;
      const b3 = 3 * b;
      const PX = st.poleSky[0];
      const PY = st.poleSky[1];
      const PZ = st.poleSky[2];
      const dx = dir[a3];
      const dy = dir[a3 + 1];
      const dz = dir[a3 + 2];
      let tx = dy * PZ - dz * PY;
      let ty = dz * PX - dx * PZ;
      let tz = dx * PY - dy * PX;
      let tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (tl < 1e-9) {
        tx = 1;
        ty = 0;
        tz = 0;
        tl = 1;
      }
      tx /= tl;
      ty /= tl;
      tz /= tl;
      const pd = PX * dx + PY * dy + PZ * dz;
      let nx = PX - pd * dx;
      let ny = PY - pd * dy;
      let nz = PZ - pd * dz;
      let nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nl < 1e-9) {
        nx = dy * tz - dz * ty;
        ny = dz * tx - dx * tz;
        nz = dx * ty - dy * tx;
        nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (nl < 1e-12) nl = 1;
      }
      const k = this.hemi / nl;
      nx *= k;
      ny *= k;
      nz *= k;
      // Pass 2, wave 6 (maker K): the system's own numbers until the pair's dials are moved by hand after this motion's screen,
      // then the dials (`PAIR_TUNE`: the angle less 90 as the line angle, the distance middle to middle). Fields read, no call.
      const own = PAIR_MOVES.n === this.pairMovesAt;
      const lineAngle = own ? this.pairAngle : ((PAIR_TUNE.angleDeg - 90) * Math.PI) / 180;
      const ca = Math.cos(lineAngle);
      const sa = Math.sin(lineAngle);
      const ox = ca * tx + sa * nx;
      const oy = ca * ty + sa * ny;
      const oz = ca * tz + sa * nz;
      const apart = own ? (this.discA + this.discB) * DISC_TUNE.size + this.pairGap : (PAIR_TUNE.belowDeg * Math.PI) / 180;
      const cc = Math.cos(apart);
      const sc = Math.sin(apart);
      const qx = cc * dx + sc * ox;
      const qy = cc * dy + sc * oy;
      const qz = cc * dz + sc * oz;
      dir[b3] = qx;
      dir[b3 + 1] = qy;
      dir[b3 + 2] = qz;
      st.light[b3] = -qx;
      st.light[b3 + 1] = -qy;
      st.light[b3 + 2] = -qz;
      this.sun2.x = qx;
      this.sun2.y = qy;
      this.sun2.z = qz;
    }
    // Each sun's share of its light left by what covers it: the share of the disc the game draws (the star table's radius
    // times the disc size dial, as the pair's gap is worked) that a nearer body's disc covers. The system's own cover sizes a
    // star by its SWG square's bright disc (Yavin's is 59 degrees, its disc 6.5 in radius), which would dim a sun the eye still
    // sees whole; the cover written here is the one every reader takes (`cover`, the air, the day).
    if (a >= 0) {
      this.rsNow = this.discA * DISC_TUNE.size;
      this.coverOf(a);
    }
    if (b >= 0) {
      this.rsNow = this.discB * DISC_TUNE.size;
      this.coverOf(b);
    }
    const e = MOTION_TUNE.eclipse;
    let lightAll = 0;
    let lightSum = 0;
    for (let k = 0; k < m; k++) {
      if (!this.items[k].star || !this.items[k].drawn) continue;
      const br = this.items[k].brightness;
      lightAll += br;
      lightSum += br * (1 - e * st.cover[k]);
    }
    if (a >= 0) {
      const a3 = 3 * a;
      this.sun.x = dir[a3];
      this.sun.y = dir[a3 + 1];
      this.sun.z = dir[a3 + 2];
      this.sunShare = 1 - e * st.cover[a];
    } else this.sunShare = 1;
    this.sun2Share = b >= 0 ? 1 - e * st.cover[b] : 1;
    this.daylight = lightAll > 0 ? lightSum / lightAll : 1;
    // The night light: the brightest body up by what it sends (its lit share, its size against the world's SWG moon squared,
    // its height), and every body up together against SWG's nearly full moon, tinted by their colours.
    let best = -1;
    let bestL = 0;
    let sum = 0;
    let tr = 0;
    let tg = 0;
    let tb = 0;
    const gs = MOTION_TUNE.giantshine;
    const lit = st.lit;
    for (let j = 0; j < m; j++) {
      const w = this.weight[j];
      if (w === 0) continue;
      const up = dir[3 * j + 1];
      if (!(up > 0)) continue;
      // (maker P: C) its light by the area it is drawn at now (its weight is its setting's)
      const grow = this.sizeNow[j] / this.items[j].sizeDeg;
      const l = lit[j] * w * grow * grow * (this.isGiant[j] ? gs : 1);
      if (!(l > 0)) continue;
      sum += l;
      tr += l * this.tints[3 * j];
      tg += l * this.tints[3 * j + 1];
      tb += l * this.tints[3 * j + 2];
      const seen = l * up;
      if (seen > bestL) {
        bestL = seen;
        best = j;
      }
    }
    this.nightJ = best;
    this.moonShare = sum;
    const tint = MOTION_TUNE.tint;
    if (sum > 0) {
      const lr = tr / sum;
      const lg = tg / sum;
      const lb = tb / sum;
      this.moonTint[0] = 1 + tint * (lr - 1);
      this.moonTint[1] = 1 + tint * (lg - 1);
      this.moonTint[2] = 1 + tint * (lb - 1);
    } else {
      this.moonTint[0] = 1;
      this.moonTint[1] = 1;
      this.moonTint[2] = 1;
    }
    if (best >= 0) {
      const n3 = 3 * best;
      this.nightDir.x = dir[n3];
      this.nightDir.y = dir[n3 + 1];
      this.nightDir.z = dir[n3 + 2];
    } else {
      // No body up: the night light comes from straight under the land (the air sends nothing from there).
      this.nightDir.x = 0;
      this.nightDir.y = -1;
      this.nightDir.z = 0;
    }
    this.night = st.night;
    // Each item's own turn now, a share of its own day.
    for (let j = 0; j < m; j++) {
      const sd = this.items[j].spinDeg;
      if (sd === 0) {
        this.spinTurn[j] = 0;
        continue;
      }
      const turns = (T * sd) / 360;
      this.spinTurn[j] = turns - Math.floor(turns);
    }
    // The day's words: version 2's from where its casting sun really is; version 1's are the game's own day (`DayCycle`).
    if (this.version === 2) {
      const d = st.day;
      this.hour = st.hour;
      this.normalized = d.normalized;
      this.ratio = d.ratio;
      this.isDay = d.isDay;
    }
    // (maker L: D to G) each sun's direct light and the air's through an eclipse (over `cover`, the shares and the daylight
    // above), and every drawn body's casters; objects handed over, no number
    if (this.shade !== null) this.shade.frame(this, st as unknown as Parameters<SkyShade['frame']>[1], MOTION_TUNE);
  }

  /** The disc's angular radius `coverOf` works with (radians), written before each call so no number crosses it. */
  private rsNow = 0.5;

  /**
   * The share of star `k`'s disc (of radius `rsNow`) that nearer bodies' discs cover, written into `cover[k]`: `system.js`'
   * overlap of two discs summed over every drawn body that is not a star or a sheet and stands nearer, held to 1. Allocates
   * nothing.
   */
  private coverOf(k: number): void {
    const st = this.state;
    const dir = st.dir;
    const dist = st.dist;
    const rs = this.rsNow;
    const k3 = 3 * k;
    let covered = 0;
    for (let j = 0; j < this.m; j++) {
      const it = this.items[j];
      if (it.star || it.sheet || !it.drawn || dist[j] >= dist[k]) continue;
      const j3 = 3 * j;
      const c = dir[k3] * dir[j3] + dir[k3 + 1] * dir[j3 + 1] + dir[k3 + 2] * dir[j3 + 2];
      const d = Math.acos(c < -1 ? -1 : c > 1 ? 1 : c);
      const a = rs;
      // (maker P: C) the size it is drawn at now hides the sun, as drawn
      const b = (this.sizeNow[j] * DEG) / 2;
      if (d >= a + b) continue;
      const lo = a < b ? a : b;
      if (d <= Math.abs(a - b)) {
        covered += Math.PI * lo * lo;
        continue;
      }
      const ca = (d * d + a * a - b * b) / (2 * d * a);
      const cb = (d * d + b * b - a * a) / (2 * d * b);
      const kk = (-d + a + b) * (d + a - b) * (d - a + b) * (d + a + b);
      covered += a * a * Math.acos(ca < -1 ? -1 : ca > 1 ? 1 : ca) + b * b * Math.acos(cb < -1 ? -1 : cb > 1 ? 1 : cb) - 0.5 * Math.sqrt(kk > 0 ? kk : 0);
    }
    const share = covered / (Math.PI * rs * rs);
    st.cover[k] = share > 1 ? 1 : share;
  }
  /** What the console and the tests read: the system, the day, every item's place and light now. */
  report(): Record<string, unknown> {
    const r3 = (a: ArrayLike<number>, at: number): number[] => [a[at], a[at + 1], a[at + 2]].map((v) => Number(v.toFixed(4)));
    const deg = (y: number): number => Number(((Math.asin(y > 1 ? 1 : y < -1 ? -1 : y) * 180) / Math.PI).toFixed(2));
    return {
      rule: this.rule,
      system: this.id,
      name: this.name,
      world: this.world,
      version: this.version,
      T: Number(this.T.toFixed(6)),
      at: Number.isFinite(this.T) && this.version === 2 ? new Date(EPOCH_MS + this.T * DAY_MS).toISOString() : null,
      day: this.ownsDay ? { hours: Number((this.lengthSeconds / 3600).toFixed(3)), hour: Number(this.hour.toFixed(3)), normalized: Number(this.normalized.toFixed(4)), isDay: this.isDay } : "the game's own (version 1)",
      daylight: Number(this.daylight.toFixed(4)),
      sunShare: Number(this.sunShare.toFixed(4)),
      sun2Share: this.secondJ >= 0 ? Number(this.sun2Share.toFixed(4)) : null,
      moonShare: Number(this.moonShare.toPrecision(4)),
      moonTint: Array.from(this.moonTint, (v) => Number(v.toFixed(3))),
      night: Number(this.night.toPrecision(4)),
      nightBody: this.nightJ >= 0 ? this.items[this.nightJ].name : null,
      tune: { ...MOTION_TUNE },
      items: this.items.map((it, j) => ({
        name: it.name,
        kind: it.kind,
        place: it.place,
        slot: it.slot,
        look: it.look,
        drawn: it.drawn,
        sizeDeg: Number(it.sizeDeg.toFixed(3)),
        // (maker P: C) drawn now at its distance, against its mean, nearest and farthest
        sizeNowDeg: Number(this.sizeNow[j].toFixed(3)),
        meanAu: Number(this.meanDist[j].toPrecision(4)),
        nearAu: Number(this.nearDist[j].toPrecision(4)),
        farAu: Number(this.farDist[j].toPrecision(4)),
        ...(this.locked[j] ? { locked: true } : {}),
        dir: r3(this.dir, 3 * j),
        upDeg: deg(this.dir[3 * j + 1]),
        lit: Number(this.lit[j].toFixed(4)),
        cover: it.star ? Number(this.cover[j].toFixed(4)) : undefined,
        distAu: Number(this.dist[j].toPrecision(4)),
        ...(it.holdsStill ? { holdsStill: true } : {}),
      })),
    };
  }
}

/**
 * The motion for a world from the bodies file's `systems`, or null where none applies (today's sky exactly). `world` is the
 * sky's world as the places name it (its pack), `planet` the game's planet (its star table), `sky` its converted sky (the
 * places' sizes). Made once at an arrival.
 */
export function skyMotionFor(systems: SystemsRecord | null | undefined, world: string, planet: string, sky: SkyPlaceSource | null): SkyMotion | null {
  const a = appliedSystemOf(systems, world);
  if (!a) return null;
  try {
    return new SkyMotion(a.rule, a.id, a.sys, world, planet, skyPlacesOf(world, sky));
  } catch {
    return null;
  }
}

/** The night reference's size (degrees) the night brightness of `system.js` counts in (a full 20-degree moon straight up is 1). */
export const NIGHT_REF_DEG = NIGHT_REF_SIZE;
