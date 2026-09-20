// What the machines sound like, without a browser: which of the game's own files each of a ship's
// engine loops comes from, the idle, speed-up and slow-down loops found beside a run loop by name,
// the run loop of the family a chassis's flyby names, the Doppler arithmetic, and the frame's own
// work -- one voice a ship for the ones you are not flying, two for the one you are, a wing sounding
// once when it starts to move, a flyby sounding once as a ship goes past, and the hit, destruction,
// power, jump and lift sounds coming out of the tables the converter writes.
//
// Nothing here makes an AudioContext or fetches anything: the mixer is a few lines of bookkeeping
// that record what was asked of it, because the tab this was built in can hear nothing and every
// judgement has to be a number.
import assert from 'node:assert/strict';
import {
  VehicleSounds,
  VEHICLE_TUNE,
  baseName,
  bestName,
  dopplerSemitones,
  engineFromClientData,
  engineMix,
  flatName,
  runFromFlyby,
  siblingLoops,
  speedShare,
  undamagedThruster,
  type SoundVehicle,
  type VehicleEventsPack,
  type VehicleTables,
} from '../../../src/audio/vehicleSounds.ts';
import { EmitterGrid } from '../../../src/audio/emitters.ts';
import type { SoundSpace } from '../../../src/audio/distance.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};

/** The part of the mixer the machines use, written down: every call is recorded, nothing sounds. */
class FakeMixer {
  readonly grid = new EmitterGrid();
  readonly bank = { available: true, sources: null, template: (id: string) => (this.has === null || this.has.has(id) ? { dim: 3 } : null) };
  /** The templates the pack holds; null means "every one asked for". */
  has: Set<string> | null = null;
  readonly started: { id: string; loop: boolean; gain: number; pitch: number; space: SoundSpace }[] = [];
  readonly stopped: number[] = [];
  readonly prepared: string[] = [];
  readonly loops = new Map<number, string>();
  readonly gains = new Map<number, number>();
  readonly pitches = new Map<number, number>();
  /** The building each living voice is in, as it was started and as it has been moved since. */
  readonly spaces = new Map<number, number>();
  refuse = false;
  private next = 1;

  play(id: string, o: { gain?: number; pitch?: number; space?: SoundSpace; loop?: boolean } = {}): number {
    if (this.refuse) return 0;
    this.started.push({ id, loop: !!o.loop, gain: o.gain ?? 1, pitch: o.pitch ?? 0, space: { building: o.space?.building ?? -1, cell: o.space?.cell ?? -1 } });
    const key = this.next++;
    this.spaces.set(key, o.space?.building ?? -1);
    return key;
  }

  loop(id: string, o: { gain?: number; pitch?: number; space?: SoundSpace } = {}): number {
    const key = this.play(id, { ...o, loop: true });
    if (key) this.loops.set(key, id);
    return key;
  }

  stop(key: number): void {
    this.stopped.push(key);
    this.loops.delete(key);
  }

  move(): void {}
  setGain(key: number, gain: number): void {
    this.gains.set(key, gain);
  }
  setPitch(key: number, semitones: number): void {
    this.pitches.set(key, semitones);
  }
  setSpace(key: number, space: SoundSpace): void {
    this.spaces.set(key, space.building);
  }
  isPlaying(key: number): boolean {
    return this.loops.has(key);
  }
  /** The key a living loop of this sound is on, or 0: which voice holds which sound is the whole question. */
  keyOf(id: string): number {
    for (const [key, sound] of this.loops) if (sound === id) return key;
    return 0;
  }
  prepare(ids: Iterable<string>): void {
    for (const id of ids) this.prepared.push(id);
  }

  /** The ids of the one-shots only: a loop is a voice that lives on, and the checks below read them apart. */
  shots(): string[] {
    return this.started.filter((s) => !s.loop).map((s) => s.id);
  }
  living(): string[] {
    return [...this.loops.values()];
  }
  clear(): void {
    this.started.length = 0;
    this.stopped.length = 0;
  }
}

/** A vehicle as the sound side sees one; the game's `Vehicle` carries the same fields. */
function makeVehicle(over: Partial<SoundVehicle> & { id: string; ship?: boolean }): SoundVehicle {
  const pos = { x: 0, y: 0, z: 0 };
  return {
    pos,
    speed: 0,
    destroyed: false,
    disposed: false,
    onWater: false,
    spec: { id: over.id, label: over.id, maxSpeed: 100, animal: false, ship: over.ship ?? false },
    def: { id: over.id },
    fit: null,
    wings: { length: 0, target: false },
    ...over,
  } as SoundVehicle;
}

/** The parts of the two packs these checks use, shaped exactly as the converter writes them. */
const EVENTS: VehicleEventsPack = {
  clientData: {
    'clientdata/ship/component/eng_xwing_pos_s01.cdf': {
      engines: [
        { slot: 'engine_on1', sound: 'sound/eng_run_xwing.snd' },
        { slot: 'engine_on1', sound: 'sound/eng_run_dmg25_lp.snd' },
      ],
    },
    'clientdata/ship/component/eng_awing_pos_s01.cdf': { engines: [{ slot: 'engine_on1', sound: 'sound/eng_run_awing.snd' }] },
    'clientdata/ship/client_shared_xwing.cdf': { destroyed: 'clienteffect/cbt_explode_xwing.cef' },
    'clientdata/ship/client_shared_tiefighter.cdf': { ambient: 'sound/eng_run_tie.snd', destroyed: 'clienteffect/cbt_explode_tiefighter.cef' },
    'clientdata/ship/client_shared_yt1300.cdf': {
      thrusters: [{ level: 0, name: 'engine_sound', idle: 'sound/eng_idle_yt1300.snd', accel: 'sound/eng_accel_yt1300.snd', decel: 'sound/eng_decel_yt1300.snd', run: 'sound/eng_run_yt1300.snd' }],
      destroyed: 'clienteffect/cbt_explode_yt1300.cef',
    },
    // The one boardable hull in the archives that also carries `FORM INTS` rows, and its row is the
    // booster's rocket loop, exactly as every other `INTS` row in the pack is.
    'clientdata/ship/client_shared_sorosuub_space_yacht.cdf': {
      interior: [{ slot: 'engine_sound1', sound: 'sound/shp_booster_rocket_lp.snd' }],
    },
    'clientdata/vehicle/speeder_bike.iff': {
      thrusters: [{ level: 0, name: 'engine_sound_0', idle: 'sound/veh_speederbike_idle_lp.snd', accel: 'sound/veh_speederbike_accel.snd', decel: 'sound/veh_speederbike_decel.snd', run: 'sound/veh_speederbike_run_lp.snd' }],
      ground: [{ water: true, sound: 'sound/amb_river_large_lp.snd' }],
    },
  },
  clientEffects: {
    'clienteffect/cbt_explode_xwing.cef': { sounds: ['sound/shp_hit_death.snd'], particle: 'appearance/pt_explosion_space_md.prt' },
  },
};

const TABLES: VehicleTables = {
  flyby: { player_awing: 'sound/eng_flyby_awing.snd', player_xwing: 'sound/eng_flyby_xwing.snd' },
  hitGroups: { player_xwing: 'xwing', player_tiefighter: 'tie' },
  shipHits: {
    default: { shield: 'sound/cbt_hit_shield.snd', armor: 'sound/cbt_hit_armor.snd', component: 'sound/cbt_hit_component.snd', chassis: 'sound/cbt_hit_chassis.snd' },
    xwing: { shield: 'sound/cbt_hit_shield_xwing.snd', armor: 'sound/cbt_hit_armor_xwing.snd', component: 'sound/cbt_hit_component_xwing.snd', chassis: 'sound/cbt_hit_chassis.snd' },
  },
  shipPower: {
    default: { default_enabled: 'sound/sys_gen_power_increase.snd', default_disabled: 'sound/sys_gen_power_decrease.snd', engine_disabled: 'sound/sys_engine_power_decrease.snd' },
    xwing: { default_enabled: 'sound/sys_rebel_power_increase.snd', default_disabled: 'sound/sys_rebel_power_decrease.snd', engine_disabled: 'sound/sys_engine_power_decrease.snd' },
  },
  rooms: [
    { pob: 'default', cell: 'default', day: 'sound/default_interior.snd', night: null, surface: 'stone' },
    { pob: 'yt1300', cell: 'default', day: 'sound/amb_yt1300_int_lp.snd', night: 'sound/amb_yt1300_int_lp.snd', surface: 'metal' },
    // The retail table's three ship rows share a bed and do not share a floor.
    { pob: 'sorosuub_space_yacht', cell: 'default', day: 'sound/amb_yt1300_int_lp.snd', night: 'sound/amb_yt1300_int_lp.snd', surface: 'carpet' },
  ],
};

// ---- the names ----
{
  ok(flatName('Speeder_Bike.iff') === 'speederbikeiff', 'a name is matched on its letters and digits alone');
  ok(baseName('object/tangible/ship/attachment/engine/shared_xwing_engine_pos_s01.iff') === 'xwing_engine_pos_s01', "a template's own name is taken without its folder, its shared_ and its extension");
  const index = [
    { key: 'clientdata/vehicle/speeder_bike.iff', flat: 'speederbike' },
    { key: 'clientdata/vehicle/swoop_bike.iff', flat: 'swoopbike' },
    { key: 'clientdata/vehicle/landspeeder.iff', flat: 'landspeeder' },
  ];
  ok(bestName('speederbike', index) === 'clientdata/vehicle/speeder_bike.iff', 'a spelling that differs only in its underscores matches exactly');
  ok(bestName('landspeeder_x34', index) === 'clientdata/vehicle/landspeeder.iff', 'a name nothing matches exactly takes the longest one it contains');
  ok(bestName('nothing_like_it', index) === null, 'a name with nothing near it matches nothing at all');
}

// ---- the engine sets ----
{
  const kin = siblingLoops('sound/eng_run_xwing.snd');
  ok(kin.idle === 'sound/eng_idle_xwing.snd' && kin.accel === 'sound/eng_accel_xwing.snd' && kin.decel === 'sound/eng_decel_xwing.snd', "the idle, speed-up and slow-down loops sit beside a run loop under the game's own naming");
  ok(siblingLoops('sound/eng_run_tie_defender_lp.snd').idle === 'sound/eng_idle_tie_defender_lp.snd', 'only the word `run` is swapped: the rest of the name is kept');
  ok(siblingLoops('sound/shp_eng_arc_170_run.snd').idle === 'sound/shp_eng_arc_170_idle.snd', 'a run loop that ends in `run` is read the same way');
  ok(siblingLoops('sound/eng_run_xwing.snd', (id) => id.includes('idle')).accel === null, 'a sibling the pack has no template for is left out');
  ok(siblingLoops(null).run === undefined && siblingLoops(null).idle === null, 'nothing at all gives nothing');

  const part = engineFromClientData(EVENTS.clientData!['clientdata/ship/component/eng_xwing_pos_s01.cdf']);
  ok(part?.run === 'sound/eng_run_xwing.snd' && part.source === 'part', "an engine part's first row is its undamaged run loop, and the three damage loops after it are not taken for it");
  ok(part?.idle === 'sound/eng_idle_xwing.snd', 'a part that names only a run loop still idles, from the loop beside it');

  const tie = engineFromClientData(EVENTS.clientData!['clientdata/ship/client_shared_tiefighter.cdf']);
  ok(tie?.run === 'sound/eng_run_tie.snd' && tie.source === 'hull ASND', "a hull's own looping sound is its engine when no part speaks for it");

  const yt = engineFromClientData(EVENTS.clientData!['clientdata/ship/client_shared_yt1300.cdf']);
  ok(yt?.source === 'VSND' && yt.idle === 'sound/eng_idle_yt1300.snd' && yt.accel === 'sound/eng_accel_yt1300.snd', 'a thruster set gives all four loops itself, and they are taken over the ones found by name');

  ok(undamagedThruster(EVENTS.clientData!['clientdata/ship/client_shared_yt1300.cdf'])?.level === 0, 'the undamaged thruster set is the one whose damage level is nothing');
  ok(undamagedThruster({ thrusters: [{ level: 0.5, run: 'a' }, { level: 0, run: 'b' }] })?.run === 'b', 'a damaged set first in the file does not stand in for the undamaged one');
  ok(engineFromClientData(null) === null && engineFromClientData({}) === null, 'a file that names no engine gives no set');
}

// ---- the flyby family ----
{
  ok(runFromFlyby('sound/eng_flyby_awing.snd') === 'sound/eng_run_awing.snd', "a chassis's flyby names its engine family, and the run loop of that family is its engine");
  ok(runFromFlyby('sound/eng_flyby_firespray.snd', (id) => id.endsWith('_lp.snd')) === 'sound/eng_run_firespray_lp.snd', 'a family whose run loop is spelt with `_lp` is found too');
  ok(runFromFlyby('sound/eng_flyby_nothing.snd', () => false) === null, 'a family the pack holds no run loop for gives nothing');
  ok(runFromFlyby('sound/eng_run_awing.snd') === null && runFromFlyby(null) === null, 'only a flyby sound is read this way');
}

// ---- the arithmetic ----
{
  ok(Math.abs(dopplerSemitones(0)) < 1e-9, 'a ship neither closing nor opening is at its own pitch');
  ok(dopplerSemitones(100) > 0 && dopplerSemitones(-100) < 0, 'a ship closing rises in pitch and one going away falls');
  ok(dopplerSemitones(100000) === VEHICLE_TUNE.doppler && dopplerSemitones(-100000) === -VEHICLE_TUNE.doppler, 'the shift is capped either way, so a jump speed is not an octave');
  ok(speedShare(50, 100) === 0.5 && speedShare(-200, 100) === 1 && speedShare(0, 0) === 0, 'the share of top speed is read from the speed either way and never leaves 0 to 1');
  const mix = engineMix(VEHICLE_TUNE.crossAt);
  ok(Math.abs(mix.run - 1) < 1e-9 && Math.abs(mix.idle) < 1e-9, 'the run loop is at full and the idle gone by the crossing share');
  ok(engineMix(0).idle === 1 && engineMix(0).run === 0, 'standing still is the idle alone');
}

// ---- the frame's own work ----
{
  const host = new FakeMixer();
  const sounds = new VehicleSounds();
  sounds.attach(host as never, '');
  sounds.adoptEvents(EVENTS);
  sounds.setTables(TABLES);
  sounds.setListener(0, 0, 0, { building: -1, cell: -1 });

  const mine = makeVehicle({ id: 'xwing', ship: true, def: { id: 'xwing', chassis: 'player_xwing', attachments: [{ kind: 'wing', sound: 'sound/wings_open_xwing.snd' }], fit: { slots: [{ slot: 'engine', looks: [{ parts: [{ template: 'object/tangible/ship/attachment/engine/shared_xwing_engine_pos_s01.iff' }] }] }] } }, fit: { looks: { engine: 0 } }, wings: { length: 2, target: false } });
  const other = makeVehicle({ id: 'tiefighter', ship: true, def: { id: 'tiefighter', chassis: 'player_tiefighter' } });
  other.pos.x = 300;

  sounds.update(0.1, [mine, other], mine, null);
  const report = sounds.status() as { machines: { id: string; from: string; run: string | null }[] };
  const xw = report.machines.find((m) => m.id === 'xwing')!;
  ok(xw.from === 'part' && xw.run === 'sound/eng_run_xwing.snd', "a fitted ship's engine is its own engine part's run loop, which is why a refit changes what it sounds like");
  ok(report.machines.find((m) => m.id === 'tiefighter')!.from === 'hull ASND', "a hull with no part the pack can name falls back to the hull's own loop");
  ok(host.living().includes('sound/eng_idle_xwing.snd') && host.living().includes('sound/eng_run_xwing.snd'), 'the ship the player flies holds both loops, crossfaded by speed');
  ok(host.living().filter((id) => id.includes('_tie')).length === 1 && host.living().includes('sound/eng_idle_tie.snd'), 'a ship the player is not flying holds one voice, not two: standing still, that is its idle');

  // The wings: one sound when they start to move, whatever they do next.
  host.clear();
  sounds.update(0.1, [mine, other], mine, null);
  ok(host.shots().length === 0, 'a frame in which nothing changed sounds nothing at all');
  (mine.wings as { target: boolean }).target = true;
  sounds.update(0.1, [mine, other], mine, null);
  ok(host.shots().includes('sound/wings_open_xwing.snd'), 'a wing sounds when it starts to open');
  host.clear();
  sounds.update(0.1, [mine, other], mine, null);
  ok(!host.shots().includes('sound/wings_open_xwing.snd'), 'and not again while it swings');

  // Speeding up and slowing down, and the loops' gains following the speed.
  host.clear();
  (mine as { speed: number }).speed = 90;
  sounds.update(0.1, [mine, other], mine, null);
  ok(host.shots().includes('sound/eng_accel_xwing.snd'), "opening the throttle plays the speed-up loop found beside the part's run loop");
  const runKey = [...host.loops.entries()].find(([, id]) => id === 'sound/eng_run_xwing.snd')![0];
  const idleKey = [...host.loops.entries()].find(([, id]) => id === 'sound/eng_idle_xwing.snd')![0];
  ok((host.gains.get(runKey) ?? 0) === 1 && (host.gains.get(idleKey) ?? 1) === 0, 'at speed the run loop is all of it and the idle is silent');
  ok((host.pitches.get(runKey) ?? 0) > 0, 'and the engine is asked for a higher pitch than it had at rest');

  // A ship going past the ear: once, and not once a frame.
  host.clear();
  for (let i = 0; i < 6; i++) {
    other.pos.x = 100 - i * 20;
    sounds.update(0.1, [mine, other], mine, null);
  }
  ok(host.shots().filter((id) => id === 'sound/eng_flyby_tie.snd').length === 0, 'a hull whose chassis the table gives no flyby makes none');
  const awing = makeVehicle({ id: 'awing', ship: true, def: { id: 'awing', chassis: 'player_awing' } });
  host.clear();
  for (let i = 0; i < 6; i++) {
    awing.pos.x = 100 - i * 20;
    sounds.update(0.1, [mine, awing], mine, null);
  }
  ok(host.shots().filter((id) => id === 'sound/eng_flyby_awing.snd').length === 1, 'a ship that goes past the ear at speed whooshes once, not once a frame');

  // A vehicle gone takes its voices with it.
  const held = host.loops.size;
  sounds.update(0.1, [mine], mine, null);
  ok(host.loops.size < held && !host.living().includes('sound/eng_run_awing.snd'), 'a vehicle that leaves the world gives its voices back');
}

// ---- the joins the converter writes, which always win over a name match ----
//
// Shaped exactly as the converter's own `shipSoundJoins` returns them. Every one of these is
// optional: the checks above are the same game with none of them, which is what a player who has
// not reconverted has.
{
  const host = new FakeMixer();
  const sounds = new VehicleSounds();
  sounds.attach(host as never, '');
  sounds.adoptEvents({
    ...EVENTS,
    clientData: { ...EVENTS.clientData, 'clientdata/ship/client_shared_gunship.cdf': { ambient: 'sound/eng_run_gunship_lp.snd' } },
    ships: {
      // The name would reach the X-wing's part; the join says otherwise, and the join is the
      // template chain, which is the only thing that really knows.
      engines: { 'object/tangible/ship/attachment/engine/shared_xwing_engine_pos_s01.iff': 'clientdata/ship/component/eng_awing_pos_s01.cdf' },
      shipEngines: { tiebomber: 'clientdata/ship/component/eng_xwing_pos_s01.cdf' },
      power: { tiebomber: 'tie' },
      kin: { 'sound/eng_run_gunship_lp.snd': { idle: 'sound/eng_idle_imp_gunship.snd' } },
      lifts: { rise: 'sound/item_elevator_rise_lp.snd' },
      combat: { hulls: { tiebomber: ['sound/cbt_explode_tie.snd'] } },
    },
  });
  sounds.setTables(TABLES);
  sounds.setListener(0, 0, 0, { building: -1, cell: -1 });

  const fitted = makeVehicle({
    id: 'xwing',
    ship: true,
    def: { id: 'xwing', chassis: 'player_xwing', fit: { slots: [{ slot: 'engine', looks: [{ parts: [{ template: 'object/tangible/ship/attachment/engine/shared_xwing_engine_pos_s01.iff' }] }] }] } },
    fit: { looks: { engine: 0 } },
  });
  const noPart = makeVehicle({ id: 'tiebomber', ship: true, def: { id: 'tiebomber' } });
  const gunship = makeVehicle({ id: 'gunship', ship: true, def: { id: 'gunship' } });
  sounds.update(0.1, [fitted, noPart, gunship], null, null);
  const by = Object.fromEntries((sounds.status() as { machines: { id: string; run: string | null; idle: string | null; from: string; power: string }[] }).machines.map((m) => [m.id, m]));
  ok(by.xwing.run === 'sound/eng_run_awing.snd', "the converter's own join between a part and its client data wins over the name match that stands in for it");
  ok(by.tiebomber.from === 'part' && by.tiebomber.run === 'sound/eng_run_xwing.snd', 'a hull whose engine is no part it wears reaches one all the same, through the join written for exactly that');
  ok(by.tiebomber.power === 'tie', "and the power set is the one the converter worked out off that hull's own chassis row, not one guessed here");
  ok(by.gunship.idle === 'sound/eng_idle_imp_gunship.snd', 'an idle the converter found in the archives beside a run loop is taken over the one its name would suggest');

  host.clear();
  sounds.lift(true, 0, 0, 0);
  ok(host.shots()[0] === 'sound/item_elevator_rise_lp.snd', "the lift's own sounds come from the pack when it names them");
  host.clear();
  sounds.shipDown('tiebomber', null, 0, 0, 0);
  ok(host.shots()[0] === 'sound/cbt_explode_tie.snd', "and a hull's destruction sounds come straight from the join rather than through the effect it names");
}

// ---- a wing going past together, and the census of what is silent ----
{
  const host = new FakeMixer();
  const sounds = new VehicleSounds();
  sounds.attach(host as never, '');
  sounds.adoptEvents(EVENTS);
  sounds.setTables(TABLES);
  sounds.setListener(0, 0, 0, { building: -1, cell: -1 });
  const wing = [0, 1, 2, 3].map((i) => makeVehicle({ id: 'awing', ship: true, def: { id: `awing${i}`, chassis: 'player_awing' } }));
  const ear = makeVehicle({ id: 'xwing', ship: true, def: { id: 'xwing', chassis: 'player_xwing' } });
  for (let f = 0; f < 6; f++) {
    for (const v of wing) v.pos.x = 100 - f * 20;
    sounds.update(0.1, [...wing, ear], ear, null);
  }
  ok(host.shots().filter((id) => id === 'sound/eng_flyby_awing.snd').length === 1, 'four ships going past abreast whoosh once between them, not once each');

  // What is silent is a count of the machines standing in the world, not of how often the question
  // was asked: a hull with no engine anywhere in the pack is the one number that says why it is mute.
  const mute = makeVehicle({ id: 'star_destroyer', ship: true, def: { id: 'star_destroyer' } });
  sounds.update(0.1, [...wing, ear, mute], ear, null);
  sounds.update(0.1, [...wing, ear, mute], ear, null);
  const counts = (sounds.status() as { counts: { engines: number; silent: number; resolved: number } }).counts;
  ok(counts.engines === 5 && counts.silent === 1, 'the census counts the five machines with an engine and the one without');
  ok(counts.resolved >= counts.engines, 'and the tally of how often a set was worked out is kept apart from it');
}

// ---- a living voice is re-pointed when the sound it should be playing changes ----
//
// The shape every one of these guards against is a voice that goes on playing what it started with:
// a ship stands in the world for a frame before anyone climbs into it, and the one voice it holds
// then must become the idle and run pair of a flown ship, go back to one when you step off, and
// follow a refit to whatever the new part sounds like.
{
  const host = new FakeMixer();
  const sounds = new VehicleSounds();
  sounds.attach(host as never, '');
  sounds.adoptEvents(EVENTS);
  sounds.setTables(TABLES);
  sounds.setListener(0, 0, 0, { building: -1, cell: -1 });
  const ship = makeVehicle({
    id: 'xwing',
    ship: true,
    def: {
      id: 'xwing',
      chassis: 'player_xwing',
      fit: {
        slots: [
          {
            slot: 'engine',
            looks: [
              { parts: [{ template: 'object/tangible/ship/attachment/engine/shared_xwing_engine_pos_s01.iff' }] },
              { parts: [{ template: 'object/tangible/ship/attachment/engine/shared_awing_engine_pos_s01.iff' }] },
            ],
          },
        ],
      },
    },
    fit: { looks: { engine: 0 } },
  });

  // It stands there first, as every ship the garage spawns does.
  sounds.update(0.1, [ship], null, null);
  ok(host.living().length === 1 && host.living()[0] === 'sound/eng_idle_xwing.snd', 'a ship nobody is flying holds one voice, its idle');
  const parkedKey = host.keyOf('sound/eng_idle_xwing.snd');

  // Climb in and open the throttle.
  (ship as { speed: number }).speed = 95;
  sounds.update(0.1, [ship], ship, null);
  ok(host.living().includes('sound/eng_run_xwing.snd'), 'climbing in and flying it plays the run loop, and not the idle a second time');
  ok(host.living().filter((id) => id === 'sound/eng_idle_xwing.snd').length === 1, 'the voice that was holding the idle was re-pointed rather than left holding it');
  ok(host.keyOf('sound/eng_run_xwing.snd') !== parkedKey && host.stopped.includes(parkedKey), "and the voice it was on was given back, not left running under the ship's new one");
  const runKey = host.keyOf('sound/eng_run_xwing.snd');
  sounds.update(0.1, [ship], ship, null);
  ok((host.gains.get(runKey) ?? 0) === 1 && (host.gains.get(host.keyOf('sound/eng_idle_xwing.snd')) ?? 1) === 0, 'at speed the run loop is all of it and the idle beside it is silent');

  // The ear moves into the hull: its own engine goes with it rather than being muffled by its own walls.
  sounds.setListener(0, 0, 0, { building: 7, cell: -1 });
  sounds.update(0.1, [ship], ship, null);
  ok(host.spaces.get(runKey) === 7, "the engine of the ship you are on is in the room the ear is in, whatever room it was started in");

  // A refit: a different look in the engine slot, and a different sound out of it.
  (ship.fit as { looks: Record<string, number> }).looks.engine = 1;
  sounds.update(0.1, [ship], ship, null);
  const after = sounds.status() as { machines: { id: string; run: string | null }[] };
  ok(after.machines[0].run === 'sound/eng_run_awing.snd', "a refit works the new part's own run loop out");
  ok(host.living().includes('sound/eng_run_awing.snd') && !host.living().includes('sound/eng_run_xwing.snd'), 'and the voice plays it, rather than going on with the engine that was taken off');

  // Step off at rest: one voice again, and it is the idle, not the run.
  (ship as { speed: number }).speed = 0;
  sounds.update(0.1, [ship], ship, null);
  sounds.update(0.1, [ship], null, null);
  ok(host.living().length === 1 && host.living()[0] === 'sound/eng_idle_awing.snd', 'stepping off a ship standing still leaves its idle running, not the run loop it was flown with');
}

// ---- a speeder, its water, and the hum inside a hull ----
{
  const host = new FakeMixer();
  const sounds = new VehicleSounds();
  sounds.attach(host as never, '');
  sounds.adoptEvents(EVENTS);
  sounds.setTables(TABLES);
  sounds.setListener(0, 0, 0, { building: -1, cell: -1 });
  const bike = makeVehicle({ id: 'speederbike', def: { id: 'speederbike' } });
  sounds.update(0.1, [bike], bike, null);
  ok(host.living().includes('sound/veh_speederbike_idle_lp.snd'), "a ground vehicle's own client data is found by name when the converter has written no join for it");
  host.clear();
  (bike as { speed: number }).speed = 50;
  sounds.update(0.1, [bike], bike, null);
  ok(host.shots().includes('sound/veh_speederbike_accel.snd'), 'pulling away plays the speed-up sound once');
  host.clear();
  (bike as { speed: number }).speed = 0;
  sounds.update(0.1, [bike], bike, null);
  ok(host.shots().includes('sound/veh_speederbike_decel.snd'), 'and slowing to a stop plays the slow-down sound');
  (bike as { onWater: boolean }).onWater = true;
  sounds.update(0.1, [bike], bike, null);
  ok(host.living().includes('sound/amb_river_large_lp.snd'), "over water the vehicle's own ground effect sounds");
  (bike as { onWater: boolean }).onWater = false;
  sounds.update(0.1, [bike], bike, null);
  ok(!host.living().includes('sound/amb_river_large_lp.snd'), 'and it stops when the water does');

  // The hum inside a hull is the interior table's row for it, and nothing else.
  const yt = makeVehicle({ id: 'yt1300', ship: true, def: { id: 'yt1300', chassis: 'player_yt1300' } });
  host.clear();
  sounds.update(0.1, [yt], yt, yt);
  ok(host.living().includes('sound/amb_yt1300_int_lp.snd'), "a hull's rooms hum with the interior table's own row for it while you are aboard");
  const yacht = makeVehicle({ id: 'sorosuub_space_yacht', ship: true, def: { id: 'sorosuub_space_yacht' } });
  host.clear();
  sounds.update(0.1, [yacht], yacht, yacht);
  ok(host.living().includes('sound/amb_yt1300_int_lp.snd') && !host.living().includes('sound/shp_booster_rocket_lp.snd'), "and a hull whose own client data names the booster's rocket loop hums with the table's row all the same, since that loop is a thruster firing and not a room");
  // A second one of these, with no client data at all, over the same mixer: the first lets its own
  // voices go first, or its hum would still be living under the checks below.
  sounds.leave();
  const plain = makeVehicle({ id: 'yt1300_decorated_01', ship: true, def: { id: 'yt1300_decorated_01' } });
  const bare = new VehicleSounds();
  bare.attach(host as never, '');
  bare.adoptEvents({ clientData: {} });
  bare.setTables(TABLES);
  host.clear();
  bare.update(0.1, [plain], plain, plain);
  ok(host.living().includes('sound/amb_yt1300_int_lp.snd'), "a decorated hull with nothing of its own takes the interior table's row for the hull it decorates");
  host.clear();
  bare.update(0.1, [plain], plain, null);
  ok(host.stopped.length > 0 && !host.living().includes('sound/amb_yt1300_int_lp.snd'), 'and the hum stops when you step off');

  ok(sounds.deckSurface('yt1300') === 'metal' && sounds.deckSurface('yt1300_decorated_01') === 'metal', "a hull's deck is what the interior table's own row says its floor is, a decorated one included");
  ok(sounds.deckSurface('sorosuub_space_yacht') === 'carpet', 'and a hull the table gives a floor of its own is walked on as that floor, not as metal');
  ok(sounds.deckSurface('xwing') === null && sounds.deckSurface(null) === null, 'and a hull the table names no room for says nothing, which leaves the caller to decide');
}

// ---- what the world calls in ----
{
  const host = new FakeMixer();
  const sounds = new VehicleSounds();
  sounds.attach(host as never, '');
  sounds.adoptEvents(EVENTS);
  sounds.setTables(TABLES);

  sounds.shipHit('player_xwing', 'shield', 0, 0, 0);
  ok(host.shots().at(-1) === 'sound/cbt_hit_shield_xwing.snd', "a blow takes the hit sound of the group its chassis names");
  sounds.shipHit('player_nothing', 'armor', 0, 0, 0);
  ok(host.shots().at(-1) === 'sound/cbt_hit_armor.snd', "a chassis the table does not name takes the fallback row, as the client's own empty-named row did");
  host.clear();
  sounds.shipHit('player_xwing', 'component', 0, 0, 0, 'engine');
  ok(host.shots().includes('sound/sys_engine_power_decrease.snd'), 'a blow that takes a part with it plays that system powering down');
  host.clear();
  sounds.shipHit('player_xwing', 'component', 0, 0, 0, 'weapon_0');
  ok(host.shots().includes('sound/sys_rebel_power_decrease.snd'), "a slot with a number on it is read as its system (weapon_0 is the weapons), and a system the set names no sound for falls back to that set's own");

  host.clear();
  sounds.shipDown('xwing', null, 0, 0, 0);
  ok(host.shots().includes('sound/shp_hit_death.snd'), "a hull blowing up plays the sounds of the effect its own client data names it destroyed by");
  host.clear();
  sounds.shipDown('tiefighter', null, 0, 0, 0);
  ok(host.shots().length === 0, 'a hull whose effect the pack holds no sound for is silent rather than wrong');

  host.clear();
  sounds.jump('enter', 'sound/ship_hyperspace_begin.snd', 0, 0, 0);
  sounds.jump('transit', null, 0, 0, 0);
  ok(host.shots().length === 1 && host.shots()[0] === 'sound/ship_hyperspace_begin.snd', "a jump stage sounds what the pack's own scene names, and a stage the pack names nothing for is silent");

  host.clear();
  const tones = { activate: 'sound/tgt_on.snd', deactivate: 'sound/tgt_off.snd', acquiring: 'sound/tgt_seek.snd', acquired: 'sound/tgt_lock.snd' };
  const ship = {};
  sounds.target(tones, ship, false);
  sounds.target(tones, ship, false);
  ok(host.shots().filter((id) => id === 'sound/tgt_on.snd').length === 1, 'the target tone sounds when a ship is picked and not again while it stays picked');
  sounds.target(tones, ship, true);
  ok(host.shots().at(-1) === 'sound/tgt_lock.snd', 'and the lock tone the first time the guns have a solution on it');
  // Whether the guns have a line on a target is worked out from scratch every frame, so one hovering
  // at the edge of the bolt's reach flips it over and over; the pair does not sound again at once.
  sounds.target(tones, ship, false);
  sounds.target(tones, ship, true);
  ok(host.shots().at(-1) === 'sound/tgt_lock.snd' && host.shots().filter((id) => id === 'sound/tgt_lock.snd').length === 1, 'a solution flickering in and out does not ratchet the lock tone');
  sounds.target(tones, null, false);
  ok(host.shots().at(-1) === 'sound/tgt_off.snd', 'letting the pick go sounds the other way');

  host.clear();
  sounds.lift(true, 1, 2, 3);
  sounds.lift(false, 1, 2, 3);
  ok(host.shots()[0] === 'sound/item_elevator_02_rise.snd' && host.shots()[1] === 'sound/item_elevator_02_descend.snd', 'a lift going up and one going down are the two sounds the game has for it');
}

// ---- a mixer with nothing behind it ----
{
  const sounds = new VehicleSounds();
  const v = makeVehicle({ id: 'xwing', ship: true });
  sounds.setListener(0, 0, 0, { building: -1, cell: -1 });
  sounds.update(0.1, [v], v, null);
  sounds.shipHit('player_xwing', 'shield', 0, 0, 0);
  sounds.lift(true, 0, 0, 0);
  sounds.leave();
  ok((sounds.status().counts as { noHost: number }).noHost > 0, 'with no mixer at all nothing throws and every ask is counted, which is what a game with no sound pack does');
}

// ---- the power sounds as the player gets on and off ----
{
  const host = new FakeMixer();
  const sounds = new VehicleSounds();
  sounds.attach(host as never, '');
  sounds.adoptEvents(EVENTS);
  sounds.setTables(TABLES);
  sounds.setListener(0, 0, 0, { building: -1, cell: -1 });
  const xw = makeVehicle({ id: 'xwing', ship: true, def: { id: 'xwing', chassis: 'player_xwing' } });
  sounds.update(0.1, [xw], null, null);
  host.clear();
  sounds.update(0.1, [xw], xw, null);
  ok(host.shots().includes('sound/sys_rebel_power_increase.snd'), "climbing into a ship powers it up with its own faction's set, which its hit group names");
  host.clear();
  sounds.update(0.1, [xw], null, null);
  ok(host.shots().includes('sound/sys_rebel_power_decrease.snd'), 'and stepping out powers it down');
}

console.log(`\n${passed} checks passed`);
