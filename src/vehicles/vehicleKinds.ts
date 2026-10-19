// Which kind each of the gallery's vehicles is, and which part of a vehicle follows which kind.
//
// The kind used to be the first of five name patterns to match a vehicle's label, its template or its model, and a
// vehicle no pattern matched became a speeder bike; every "speeder" the bike pattern missed became a hover car that
// climbs with the view, which is how the Sith, Geonosian and swamp speeders and every landspeeder came to fly. The
// table below is the gallery's 62 vehicles and the one exhibit of ours beside them (Sebulba's pod) by their garage id,
// sorted by what each is: the open landspeeders and
// every multi-seat skiff, lifter and transport are bikes that race (the owner's answer), the Koro-2 and the Organa
// stay hover cars, the snowspeeder is an aircraft and the basilisk walks. The name rule stays as the fallback for an
// id the table lacks (a pack converted later), and `RACE_TUNE.kinds: 'names'` puts it back for everything.
//
// **What a vehicle is spawned as decides everything only the rider's own game runs** (the race drive and its base,
// the bike's two modes, the box it races as, the display, the race view); **what it is decides everything another
// player's screen draws** (a pod's seat and clips, any vehicle's own clips, a creature's saddle, the eye seat). The
// wire carries no kind, so the two screens can never disagree. `raceRoute` holds that rule in one place.
//
// Pure, so node loads it (`tools/swg/tests/vehicleKinds.test.ts`).
import { vehicleKindOf, type VehicleKind } from './vehicle.ts';
import { isPod } from './podSeat.ts';
import { RACE_BASE, RACE_BIKE_SIZES, RACE_TUNE } from './raceTune.ts';

/** A row: the kind, and `air` for a flyer that is an aircraft rather than a hover car. */
export interface VehicleKindRow {
  kind: VehicleKind;
  air?: true;
}

const POD: VehicleKindRow = { kind: 'podracer' };
const BIKE: VehicleKindRow = { kind: 'speederbike' };
const GROUND: VehicleKindRow = { kind: 'ground' };
const HOVER: VehicleKindRow = { kind: 'flyer' };
const AIR: VehicleKindRow = { kind: 'flyer', air: true };

/**
 * The gallery's vehicles by their garage id (the gallery label), each with the kind it is: 62 of the game's and one
 * exhibit of ours. Five came with SOE's last publishes, each at the kind the name rule already gives it, so the table
 * moves nothing: the single-pod airspeeder and its two trading-card templates fly, and SOE's own player AT-ST and
 * AT-XT templates walk (they draw the walkers `hoth_at_st` and `walker_at_xt` already draw, listed as every template is).
 */
export const VEHICLE_KINDS: Readonly<Record<string, VehicleKindRow>> = {
  a1_deluxe_floater: BIKE,
  air2_swoop_speeder: BIKE,
  barc_speeder: BIKE,
  // A war droid that walks on its own clips, as the walkers do.
  basilisk_war_droid: GROUND,
  fg_8t8_podracer: POD,
  flare_s_swoop: BIKE,
  flare_s_swoop_crafted: BIKE,
  geonosian_speeder: BIKE,
  gift_stap_speeder: BIKE,
  // Two seats, but a wheel on the ground with its own clips, not a skiff, lifter or transport.
  grievous_wheel_bike: GROUND,
  hoth_at_st: GROUND,
  // A levitating chair, not a speeder.
  hover_chair: HOVER,
  hoverlifter_speeder: BIKE,
  hoverlifter_speeder_crafted: BIKE,
  jetpack: AIR,
  // The owner: "more like flyers". It races when spawned as a bike.
  koro2_speeder: HOVER,
  landspeeder_ab1: BIKE,
  landspeeder_av21: BIKE,
  landspeeder_desert_skiff: BIKE,
  landspeeder_lava_skiff: BIKE,
  landspeeder_organa: HOVER,
  landspeeder_tantive4: BIKE,
  landspeeder_tantive4_adv: BIKE,
  landspeeder_usv5: BIKE,
  landspeeder_usv5_s02: BIKE,
  landspeeder_v35: BIKE,
  landspeeder_x31: BIKE,
  landspeeder_x34: BIKE,
  landspeeder_xp38: BIKE,
  light_bending_barc: BIKE,
  mechno_chair: GROUND,
  // A slow hover droid with walk clips; it races like every bike.
  mustafar_panning_droid: BIKE,
  pod_racer_balta_podracer: POD,
  pod_racer_ipg_longtail: POD,
  pod_racer_light_bending: POD,
  pod_racer_one: POD,
  pod_racer_two: POD,
  podracer_anakin: POD,
  // Sebulba's pod: an exhibit of ours (the converter's `GALLERY_EXHIBITS`), the archives' one pod no template names.
  podracer_sebulba: POD,
  ric_920_speeder: BIKE,
  // A six-seat floating platform.
  senate_pod: BIKE,
  single_pod_airspeeder: AIR,
  sith_speeder: BIKE,
  // An airspeeder that takes off and lands: the name rule missed it only because it says "snowspeeder".
  snowspeeder: AIR,
  speeder_ric_920: BIKE,
  speederbike: BIKE,
  // Named a bike by the game: an open two-seater like the landspeeders.
  speederbike_flash: BIKE,
  speederbike_swoop: BIKE,
  stap_speeder: BIKE,
  swamp_speeder: BIKE,
  tcg_8_air_speeder: AIR,
  tcg_8_single_pod_airspeeder: AIR,
  tcg_at_pt_walker: GROUND,
  tcg_hk47_jetpack: AIR,
  tcg_merr_sonn_jt12_jetpack: AIR,
  // An eleven-seat transport.
  tcg_military_transport: BIKE,
  // Eleven seats, but a flying gunship, not a ground transport.
  tcg_republic_gunship: AIR,
  temp_walker1: GROUND,
  walker_at_rt_camo: GROUND,
  walker_at_st: GROUND,
  walker_at_xt: GROUND,
  walker_at_xt_player: GROUND,
  xj6_air_speeder: AIR,
};

/** The kind by the old name rule: the label, then the template, then the model, else a speeder bike (marked as guessed). */
export function kindByNames(label: string, template: string | undefined, model: string | undefined): { kind: VehicleKind; inferred: boolean } {
  const kind = vehicleKindOf(label) ?? (template ? vehicleKindOf(template) : null) ?? (model ? vehicleKindOf(model) : null);
  return { kind: kind ?? 'speederbike', inferred: kind !== null };
}

/** The table's row for a garage id, while the switch and `kinds` say the table is used; null otherwise. */
export function kindRow(id: string): VehicleKindRow | null {
  if (!RACE_TUNE.on || RACE_TUNE.kinds !== 'table') return null;
  return Object.hasOwn(VEHICLE_KINDS, id) ? VEHICLE_KINDS[id] : null;
}

/** A gallery vehicle's kind: the table's row while it is used, else the name rule. A table row is never a guess. */
export function kindFor(def: { id: string; template?: string; model?: string }): { kind: VehicleKind; inferred: boolean } {
  const row = kindRow(def.id);
  if (row) return { kind: row.kind, inferred: true };
  return kindByNames(def.id, def.template, def.model);
}

/** Whether a flyer is a hover car rather than an aircraft by the table (undefined: the name rule decides, as before). */
export function hoverCarFor(id: string): boolean | undefined {
  const row = kindRow(id);
  return row ? !row.air : undefined;
}

/** Whether a kind races: every pod and every bike does. */
export function races(kind: VehicleKind): boolean {
  return kind === 'podracer' || kind === 'speederbike';
}

/** What a garage vehicle is, as the routing reads it. */
export interface RoutedDef {
  readonly id: string;
  readonly kind: VehicleKind;
  readonly source: string;
  readonly clipSpeeds?: Record<string, number>;
}

/**
 * Which part of a vehicle follows which kind. The drive (a pod's or a bike's), the bike's two modes and the box it
 * races as follow the kind it was spawned as; the seat and the clips follow what it is. A rig (a shuttle's) is never
 * routed. A creature keeps its saddle whatever it is tried as, and only the ships pack's own ships spawned as ships
 * sit by the cockpit eye.
 *
 * `box` is the rule the race box is chosen by (`raceBoxFor`): 'pod' the shared pod box, 'bike' the shared bike box
 * for a bike-sized vehicle and its own (capped) for anything bigger, 'own' its own model's box (capped when raced as
 * a bike), 'mesh' no race box at all.
 */
export function raceRoute(def: RoutedDef, kind: VehicleKind): { drive: 'pod' | 'bike' | null; modes: boolean; box: 'pod' | 'bike' | 'own' | 'mesh'; seat: 'pod' | 'own'; clips: 'pod' | 'own' | 'none'; saddle: boolean; eyeSeat: boolean } {
  const rig = def.source === 'rig';
  const drive = rig ? null : kind === 'podracer' ? 'pod' : kind === 'speederbike' ? 'bike' : null;
  const pod = isPod(def);
  let box: 'pod' | 'bike' | 'own' | 'mesh' = 'mesh';
  if (drive && RACE_TUNE.hull === 'box') box = drive === 'pod' ? (RACE_TUNE.podBox === 'shared' ? 'pod' : 'own') : RACE_TUNE.bikeBox === 'class' ? 'bike' : 'own';
  return {
    drive,
    modes: drive === 'bike',
    box,
    seat: pod ? 'pod' : 'own',
    clips: pod ? 'pod' : def.clipSpeeds && Object.keys(def.clipSpeeds).length ? 'own' : 'none',
    saddle: def.source === 'creature',
    eyeSeat: def.source === 'ship' && kind === 'ship',
  };
}

/**
 * The box a vehicle races as, width, height and length, or null for none: the shared pod box for anything raced as
 * a pod (while `podBox` is shared); the shared bike box for a bike no wider and no longer than `bikeSized` (while
 * `bikeBox` is the class); and otherwise its own model's box, each axis held to the pod box's when it is raced as a
 * bike, so no bike collides bigger than a pod. Sizes are taken as the distance between the corners, which a pack's
 * own bounds may hold either way round.
 */
export function raceBoxFor(route: { drive: 'pod' | 'bike' | null; box: 'pod' | 'bike' | 'own' | 'mesh' }, bounds: { min: readonly number[]; max: readonly number[] }, pod: readonly [number, number, number], bike: readonly [number, number, number], tune: { bikeSized: readonly [number, number] } = RACE_TUNE): [number, number, number] | null {
  if (!route.drive || route.box === 'mesh') return null;
  if (route.box === 'pod') return [pod[0], pod[1], pod[2]];
  const w = Math.abs(bounds.max[0] - bounds.min[0]);
  const h = Math.abs(bounds.max[1] - bounds.min[1]);
  const l = Math.abs(bounds.max[2] - bounds.min[2]);
  if (route.box === 'bike' && w <= tune.bikeSized[0] && l <= tune.bikeSized[1]) return [bike[0], bike[1], bike[2]];
  // A box a hair thick on any axis is not something the physics engine takes.
  const own: [number, number, number] = [Math.max(0.2, w), Math.max(0.2, h), Math.max(0.2, l)];
  if (route.drive === 'bike') for (let i = 0; i < 3; i++) own[i] = Math.min(own[i], pod[i]);
  return own;
}

/** What a spawn does about the race (`raceSpecFor`): the drive it attaches, what it writes into the spec, and its note. */
export interface RaceSpawn {
  /** The drive to attach (`attachRace`), or null: a kind that does not race, a rig, or the pass switched off. */
  drive: 'pod' | 'bike' | null;
  /** `VehicleSpec.hull` and `VehicleSpec.raceBox`: absent when nothing races, so the spec is today's to the field. */
  hull?: 'mesh' | 'box';
  raceBox?: [number, number, number];
  /** The spawn's line for the console ("races as a bike …"), or null. */
  note: string | null;
  route: ReturnType<typeof raceRoute>;
}

/**
 * The whole of what a spawn does about the race, by the kind the vehicle is spawned as (`raceRoute`): with the pass on
 * and a kind that races, the drive to attach, the race box beside its own hull where the rule gives one (else its own
 * hull alone, `hull: 'mesh'`) and the note; with the pass off, or for anything that does not race, nothing at all, so
 * the vehicle is built and driven exactly as before. The garage writes what this says and nothing else.
 */
export function raceSpecFor(def: RoutedDef, kind: VehicleKind, bounds: { min: readonly number[]; max: readonly number[] }, tune: { on: boolean; bikeSized: readonly [number, number] } = RACE_TUNE): RaceSpawn {
  const route = raceRoute(def, kind);
  if (!tune.on || !route.drive) return { drive: null, note: null, route };
  const box = raceBoxFor(route, bounds, RACE_BASE.podracer.box, RACE_BIKE_SIZES.box, tune);
  const note = raceNote(route, box, bounds, tune);
  return box ? { drive: route.drive, hull: 'box', raceBox: box, note, route } : { drive: route.drive, hull: 'mesh', note, route };
}

/** The note a spawn makes of how it races ("races, own box cut to 7 × 3 × 15 m"), or null for a vehicle that does not race. */
export function raceNote(route: { drive: 'pod' | 'bike' | null; box: 'pod' | 'bike' | 'own' | 'mesh' }, box: readonly number[] | null, bounds: { min: readonly number[]; max: readonly number[] }, tune: { bikeSized: readonly [number, number] } = RACE_TUNE): string | null {
  if (!route.drive) return null;
  const f = (n: number) => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));
  const kind = route.drive === 'pod' ? 'races as a pod' : 'races as a bike (U switches it to racing mode)';
  if (!box) return `${kind}, on its own hull`;
  const size = `${f(box[0])} × ${f(box[1])} × ${f(box[2])} m`;
  if (route.box === 'pod') return `${kind}, on the shared pod box ${size}`;
  const own = [Math.abs(bounds.max[0] - bounds.min[0]), Math.abs(bounds.max[1] - bounds.min[1]), Math.abs(bounds.max[2] - bounds.min[2])];
  if (route.box === 'bike' && own[0] <= tune.bikeSized[0] && own[2] <= tune.bikeSized[1]) return `${kind}, on the shared bike box ${size}`;
  const cut = box.some((n, i) => n < own[i] - 0.01);
  return `${kind}, ${cut ? 'own box cut to' : 'own box'} ${size}`;
}
