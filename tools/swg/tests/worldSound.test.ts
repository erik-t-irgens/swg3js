// The sound the world makes, without a browser: which of the sky's own rows every bed is playing at
// and how the day, the night and a room's bed cross over; the interior table's fallbacks; the game's
// placed sound objects, their cap and how each finds the room it stands in; the loops a particle
// effect names; and a weather channel's sound following the channel's share of the mix to silence.
//
// Nothing here makes an AudioContext or fetches anything: the mixer is a few lines of bookkeeping
// that record what was asked of it, because the tab this was built in can hear nothing and every
// judgement has to be a number.
import assert from 'node:assert/strict';
import { AMBIENCE_TUNE, Ambience, indexRooms, mixBeds, roomRowFor, type BedRow, type RoomRow } from '../../../src/audio/ambience.ts';
import { EmitterGrid, WORLD_SOURCE_TUNE, WorldEmitters, type LoopHost } from '../../../src/audio/emitters.ts';
import { OUTSIDE, type SoundSpace } from '../../../src/audio/distance.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

/** The part of the mixer these sources use, written down: every call is recorded, nothing sounds. */
class FakeMixer implements LoopHost {
  readonly grid = new EmitterGrid();
  /** Every id is a real template here, except the ones `missing` names. */
  readonly bank = { available: true, sources: null, missing: new Set<string>(), template: (id: string) => (this.bank.missing.has(id) ? null : { dim: 2 }) };
  readonly live = new Map<number, { id: string; gain: number; space: SoundSpace; loop: boolean; x: number; y: number; z: number }>();
  readonly started: string[] = [];
  readonly stopped: string[] = [];
  readonly prepared: string[] = [];
  /** Set to make every start fail, as the real mixer does while it is stepping simulated seconds. */
  refuse = false;
  private next = 1;

  play(id: string, options: { x?: number; y?: number; z?: number; space?: SoundSpace; loop?: boolean; gain?: number } = {}): number {
    // The real mixer returns 0 for a template it does not hold, for a pack that has not landed and
    // while `__debug.advance` is recording rather than playing. Nothing here may start a sound the
    // bank does not name, or the checks below would pass where the game would be silent.
    if (this.refuse || !this.bank.available || !this.bank.template(id)) return 0;
    const key = this.next++;
    this.live.set(key, { id, gain: options.gain ?? 1, space: { building: options.space?.building ?? -1, cell: options.space?.cell ?? -1 }, loop: !!options.loop, x: options.x ?? 0, y: options.y ?? 0, z: options.z ?? 0 });
    this.started.push(id);
    return key;
  }

  loop(id: string, options: { x?: number; y?: number; z?: number; space?: SoundSpace; gain?: number } = {}): number {
    const key = this.play(id, { ...options, loop: true });
    if (key) {
      const v = this.live.get(key)!;
      // The real mixer files every looping voice in the grid; the grid itself is the real one.
      this.grid.add(key, id, v.x, v.y, v.z, 12, false, v.space);
    }
    return key;
  }

  stop(key: number): void {
    const v = this.live.get(key);
    if (!v) return;
    this.stopped.push(v.id);
    this.live.delete(key);
    this.grid.remove(key);
  }

  move(key: number, x: number, y: number, z: number): void {
    const v = this.live.get(key);
    if (!v) return;
    v.x = x;
    v.y = y;
    v.z = z;
    this.grid.move(key, x, y, z);
  }

  setGain(key: number, gain: number): void {
    const v = this.live.get(key);
    if (v) v.gain = gain;
  }

  setSpace(key: number, space: SoundSpace): void {
    const v = this.live.get(key);
    if (v) {
      v.space.building = space.building;
      v.space.cell = space.cell;
    }
  }

  isPlaying(key: number): boolean {
    return this.live.has(key);
  }

  prepare(ids: Iterable<string>): void {
    for (const id of ids) this.prepared.push(id);
  }

  /** What is playing under one sound id, or null. */
  find(id: string): { gain: number; space: SoundSpace; loop: boolean } | null {
    for (const v of this.live.values()) if (v.id === id) return v;
    return null;
  }
}

const row = (over: Partial<RoomRow> = {}): RoomRow => ({ pob: 'default', cell: 'default', day: null, night: null, music: null, surface: 'stone', room: 22, ...over });

// ---- the interior table: a room's own row, its building's, then the game's own fallback ----
{
  const index = indexRooms([
    row({ pob: 'default', cell: 'default', day: 'sound/default_interior.snd', night: 'sound/default_interior.snd', surface: 'rock' }),
    row({ pob: 'thm_tato_cantina', cell: 'default', day: 'sound/amb_cantina_medium_lp.snd', night: 'sound/amb_cantina_medium_lp.snd', room: 7 }),
    row({ pob: 'mun_all_capitol_s01', cell: 'default', day: 'sound/amb_capitol_lobby_lp.snd', night: 'sound/amb_capitol_lobby_lp.snd', room: 7 }),
    row({ pob: 'mun_all_capitol_s01', cell: 'hall1', day: 'sound/amb_office_lp.snd', night: 'sound/amb_office_lp.snd' }),
  ]);
  ok(roomRowFor(index, 'mun_all_capitol_s01', 'hall1')?.day === 'sound/amb_office_lp.snd', "a room with a row of its own plays that row's bed");
  ok(roomRowFor(index, 'mun_all_capitol_s01', 'foyer1')?.day === 'sound/amb_capitol_lobby_lp.snd', "a room with none falls back to its building's own default row");
  ok(roomRowFor(index, 'thm_tato_cantina', 'default')?.room === 7, "and the cantina's room type comes through with it");
  ok(roomRowFor(index, 'poi_all_rebl_bunker_s01', 'r1')?.day === 'sound/default_interior.snd', "a building the table does not name at all falls back to the table's own default row");
  ok(roomRowFor(indexRooms([]), 'anything', 'anything') === null, 'and with no table at all there is simply no room bed');
  // Eighteen of the table's own rows name a sound the retail archives do not hold.
  const held = (id: string) => id !== 'sound/amb_office_lp.snd';
  ok(roomRowFor(index, 'mun_all_capitol_s01', 'hall1', held)?.day === 'sound/amb_capitol_lobby_lp.snd', 'a room whose own bed the archives do not hold falls through to the next row that names one it does');
  // Eleven rooms of the station the table came from name their bed with a trailing space on it.
  const spaced = indexRooms([row({ pob: 'thm_npe2_station', cell: 'sickbay', day: 'sound/amb_npe2_sickbay_lp.snd ', night: 'sound/amb_npe2_sickbay_lp.snd ' })]);
  ok(roomRowFor(spaced, 'thm_npe2_station', 'sickbay')?.day === 'sound/amb_npe2_sickbay_lp.snd', 'a row that names its bed with a trailing space still names the bed the bank holds');
}

// ---- every bed a building's rooms can play, asked for behind the loading screen ----
{
  const mixer = new FakeMixer();
  const a = new Ambience(mixer, '/');
  a.setRooms([
    row({ pob: 'default', cell: 'default', day: 'sound/default_interior.snd', night: 'sound/default_interior.snd' }),
    row({ pob: 'mun_all_capitol_s01', cell: 'default', day: 'sound/amb_capitol_lobby_lp.snd', night: 'sound/amb_capitol_lobby_lp.snd' }),
    row({ pob: 'mun_all_capitol_s01', cell: 'hall1', day: 'sound/amb_office_lp.snd', night: 'sound/amb_office_lp.snd' }),
    row({ pob: 'thm_tato_cantina', cell: 'default', day: 'sound/amb_cantina_medium_lp.snd', night: 'sound/amb_cantina_medium_lp.snd' }),
  ]);
  a.prepare([{ sounds: { day: ['sound/day.snd', null], night: ['sound/night.snd', null] } }], ['mun_all_capitol_s01']);
  ok(mixer.prepared.includes('sound/day.snd') && mixer.prepared.includes('sound/night.snd'), "every bed the planet's own sky rows can play is asked for at load");
  ok(mixer.prepared.includes('sound/amb_office_lp.snd'), "and so is a room whose bed is not its building's own default, which would otherwise be decoded on the frame you walked into it");
  ok(mixer.prepared.includes('sound/default_interior.snd') && !mixer.prepared.includes('sound/amb_cantina_medium_lp.snd'), "the table's own fallback comes too, and a building this planet does not hold does not");
}

// ---- the beds: the sky's own rows at the sky's own weights ----
{
  const rain: BedRow = { sounds: { day: ['sound/wtr_heavy_rain_large_lp.snd', 'sound/wtr_thunderstorm_hvy_os.snd'], night: ['sound/wtr_heavy_rain_large_lp.snd', 'sound/wtr_thunderstorm_hvy_os.snd'] }, weight: 0.25 };
  const clear: BedRow = { sounds: { day: ['sound/amb_grassland_outside.snd', null], night: ['sound/amb_night_lp.snd', null] }, weight: 0.75 };
  const out = new Map<string, number>();

  mixBeds(out, [clear, rain], 2, 1, null, 0);
  ok(near(out.get('sound/amb_grassland_outside.snd') ?? 0, 0.75) && near(out.get('sound/wtr_heavy_rain_large_lp.snd') ?? 0, 0.25), "each row's bed plays at the very weight the sky draws that row at");
  ok(near(out.get('sound/wtr_thunderstorm_hvy_os.snd') ?? 0, 0.25), "the row's second sound, its bed of quiet one-shots, comes in at the same weight");
  ok(!out.has('sound/amb_night_lp.snd'), 'and in full daylight the night beds are not asked for at all');

  mixBeds(out, [clear, rain], 2, 0, null, 0);
  ok(near(out.get('sound/amb_night_lp.snd') ?? 0, 0.75) && !out.has('sound/amb_grassland_outside.snd'), 'at night the row plays its night bed instead');

  mixBeds(out, [clear, rain], 2, 0.5, null, 0);
  ok(near(out.get('sound/amb_grassland_outside.snd') ?? 0, 0.375) && near(out.get('sound/amb_night_lp.snd') ?? 0, 0.375), 'half way through dusk both are at half their row');

  // Two rows of a mix naming the same bed (a planet's clear and light rows usually do).
  const same: BedRow = { sounds: { day: ['sound/amb_grassland_outside.snd', null], night: ['sound/amb_grassland_outside.snd', null] }, weight: 0.5 };
  mixBeds(out, [same, { ...same }], 2, 1, null, 0);
  ok(out.size === 1 && near(out.get('sound/amb_grassland_outside.snd') ?? 0, 1), 'two rows naming one bed play it once, at their weights together');

  const cantina = row({ pob: 'thm_tato_cantina', cell: 'default', day: 'sound/amb_cantina_medium_lp.snd', night: 'sound/amb_cantina_medium_lp.snd' });
  mixBeds(out, [clear, rain], 2, 1, cantina, 1);
  ok(out.size === 1 && near(out.get('sound/amb_cantina_medium_lp.snd') ?? 0, 1), 'inside, the room takes the whole frame and the street is gone');
  mixBeds(out, [clear, rain], 2, 1, cantina, 0.5);
  ok(near(out.get('sound/amb_cantina_medium_lp.snd') ?? 0, 0.5) && near(out.get('sound/amb_grassland_outside.snd') ?? 0, 0.375), 'half way through the doorway both the room and the area are at half');

  mixBeds(out, [{ sounds: null, weight: 1 }], 1, 1, null, 0);
  ok(out.size === 0, 'a row that names no ambient sound at all (a space zone) plays nothing');
}

// ---- the crossfades, over the seconds they are tuned to ----
{
  const mixer = new FakeMixer();
  const a = new Ambience(mixer, '/');
  a.tune.dayFade = 4;
  a.tune.roomFade = 1;
  const rows: BedRow[] = [{ sounds: { day: ['sound/day.snd', null], night: ['sound/night.snd', null] }, weight: 1 }];
  const ctx = { rows, rowCount: 1, daylight: 1, room: null as RoomRow | null, space: OUTSIDE, pass: false };
  for (let i = 0; i < 10; i++) a.update(0.1, ctx);
  ok(mixer.find('sound/day.snd')?.loop === true, "the area's day bed is playing, and as a loop");
  ok((mixer.find('sound/day.snd')?.gain ?? 0) === 1 && !mixer.find('sound/night.snd'), 'and it has the whole frame');

  // Dusk: the night bed comes in and the day bed goes out over the tuned seconds, not at once.
  ctx.daylight = 0;
  a.update(0.1, ctx);
  ok(near(mixer.find('sound/day.snd')?.gain ?? 0, 0.975, 1e-6), 'a step into dusk moves the day bed by a fortieth of the fade, not to nothing');
  for (let i = 0; i < 20; i++) a.update(0.1, ctx);
  ok(near(mixer.find('sound/day.snd')?.gain ?? 0, 0.475, 1e-6) && near(mixer.find('sound/night.snd')?.gain ?? 0, 0.525, 1e-6), 'half way through the fade the two beds share the frame');
  for (let i = 0; i < 20; i++) a.update(0.1, ctx);
  ok(near(mixer.find('sound/day.snd')?.gain ?? -1, 0) && near(mixer.find('sound/night.snd')?.gain ?? 0, 1), 'at the end of the fade the night bed has the whole frame and the day bed is at nothing');
  for (let i = 0; i < 40; i++) a.update(0.1, ctx);
  ok(!mixer.find('sound/day.snd') && near(mixer.find('sound/night.snd')?.gain ?? 0, 1), 'and once the day is clearly over its voice is let go rather than held at zero for ever');

  // A room takes the frame from the area, and gives it back.
  ctx.room = row({ pob: 'thm_tato_cantina', cell: 'default', day: 'sound/cantina.snd', night: 'sound/cantina.snd' });
  for (let i = 0; i < 5; i++) a.update(0.1, ctx);
  ok(near(mixer.find('sound/cantina.snd')?.gain ?? 0, 0.5, 1e-6) && near(mixer.find('sound/night.snd')?.gain ?? 0, 0.5, 1e-6), 'half a second through a doorway, the room and the street are at half each');
  for (let i = 0; i < 40; i++) a.update(0.1, ctx);
  ok(near(mixer.find('sound/cantina.snd')?.gain ?? 0, 1) && !mixer.find('sound/night.snd'), 'inside, the room has the frame and the street has been let go');
  ok((a.status().insideShare as number) === 1 && a.status().room === 'thm_tato_cantina|default', 'and the report names the room the beds came from');

  // The beds sit wherever the ear does, so the muffling rule never silences the room you are in.
  const inside: SoundSpace = { building: 7, cell: 3 };
  a.update(0.1, { ...ctx, space: inside });
  ok(mixer.find('sound/cantina.snd')?.space.building === 7, "a bed moves into the listener's own space rather than being muffled out of it");
}

// ---- beds with nothing converted, and beds the mixer refuses ----
{
  const mixer = new FakeMixer();
  mixer.bank.available = false;
  const a = new Ambience(mixer, '/');
  const rows: BedRow[] = [{ sounds: { day: ['sound/day.snd', null], night: ['sound/day.snd', null] }, weight: 1 }];
  for (let i = 0; i < 40; i++) a.update(0.1, { rows, rowCount: 1, daylight: 1, room: null, space: OUTSIDE, pass: true });
  ok(mixer.started.length === 0 && a.counts.bedsStarted === 0 && a.counts.bedsRefused === 0, 'with no sound pack nothing is started and nothing is refused: it is not even asked for');
  mixer.bank.available = true;
  a.update(0.1, { rows, rowCount: 1, daylight: 1, room: null, space: OUTSIDE, pass: true });
  ok(mixer.started.length === 1, 'and the moment the pack lands the bed comes in');
  a.leave();
  ok(mixer.live.size === 0, 'leaving the planet lets every bed go');
}

// ---- a bed the bank has no entry for at all (six of the planets' rows name one) ----
{
  const mixer = new FakeMixer();
  mixer.bank.missing.add('sound/amb_kashyyk_ryratt_trail_lvl01.snd');
  const a = new Ambience(mixer, '/');
  const rows: BedRow[] = [{ sounds: { day: ['sound/amb_kashyyk_ryratt_trail_lvl01.snd', null], night: ['sound/amb_kashyyk_ryratt_trail_lvl01.snd', null] }, weight: 1 }];
  for (let i = 0; i < 100; i++) a.update(0.1, { rows, rowCount: 1, daylight: 1, room: null, space: OUTSIDE, pass: true });
  ok(a.counts.bedsRefused === 1 && a.counts.bedsStarted === 0, 'a bed the bank does not hold is asked for once, not once a second for the life of the planet');
  ok((a.status().bedsMissingFromBank as string[])[0] === 'sound/amb_kashyyk_ryratt_trail_lvl01.snd', 'and the report names it, rather than filling the mixer’s own log with it');
}

// ---- arriving: the hour and the room as they are, not crossfaded into ----
{
  const mixer = new FakeMixer();
  const a = new Ambience(mixer, '/');
  const rows: BedRow[] = [{ sounds: { day: ['sound/day.snd', null], night: ['sound/night.snd', null] }, weight: 1 }];
  const inn = row({ pob: 'thm_tato_cantina', cell: 'default', day: 'sound/cantina.snd', night: 'sound/cantina.snd' });
  a.update(0.016, { rows, rowCount: 1, daylight: 0, room: inn, space: OUTSIDE, pass: false });
  ok(mixer.find('sound/cantina.snd') !== null && !mixer.find('sound/day.snd') && !mixer.find('sound/night.snd'), 'landing at midnight inside a cantina comes in as a cantina at midnight, with no twenty-second fade out of a day nobody heard');
}

// ---- the game's placed sound objects ----
{
  const mixer = new FakeMixer();
  const a = new Ambience(mixer, '/');
  // The converter writes the snapshot's own coordinates, unmirrored and uncentred; the game mirrors
  // X and takes the layout's centre off, as it does for every other placed object.
  a.adopt({
    format: 1,
    planet: 'tatooine',
    frame: 'snapshot',
    emitters: [
      { sound: 'sound/amb_crowd_lp.snd', template: 'object/soundobject/shared_crowd.iff', p: [3510, 2, 4980] },
      { sound: 'sound/amb_cantina_large_lp.snd', template: 'object/soundobject/shared_cantina.iff', p: [3488, 2, 4978], pob: 'thm_tato_cantina', cell: 2 },
      { sound: 'sound/item_sparks.snd', template: 'object/tangible/shared_sparks.iff', p: [3540, 1, 4958] },
    ],
    rooms: { 'thm_tato_cantina|default': { day: 'sound/amb_cantina_medium_lp.snd', night: 'sound/amb_cantina_medium_lp.snd', surface: 'stone', room: 7 } },
  });
  ok((a.status().sources as Record<string, number>).placed === 0 && a.status().emittersInPack === 3, 'the places are held until the layout centre they are measured against is known');
  a.setFrame(3500, 4958);
  ok((a.status().sources as Record<string, number>).placed === 3, "every sound object the planet's pack places joins the world");
  ok([...mixer.live.values()].some((v) => v.id === 'sound/amb_crowd_lp.snd' && near(v.x, -10) && near(v.z, 22)), 'and each stands where the layout would put it: X mirrored, the centre taken off');
  ok(mixer.prepared.includes('sound/amb_crowd_lp.snd'), 'and its sample is asked for at once, behind the loading screen');
  ok(mixer.find('sound/item_sparks.snd') !== null, 'an emitter in the open is playing (the grid decides whether it is heard)');
  ok(a.roomRow('thm_tato_cantina', 'default')?.day === 'sound/amb_cantina_medium_lp.snd', "a planet's own interior rows come with its places");

  // One emitter stands in a building: it looks for the room it is in, and only while it is near.
  let asked = 0;
  a.sources.spaceAt = (x) => {
    asked++;
    return x > 11 ? { building: 9, cell: 2 } : null;
  };
  a.sources.update(false);
  ok(asked === 0, 'nothing looks for its room between the grid’s passes');
  // Nothing is near until the grid has run a pass with the listener beside it.
  a.sources.update(true);
  ok(asked === 0, 'nor while the listener is nowhere near it, since its building has not been streamed');
  mixer.grid.step(1, 12, 2, 20);
  a.sources.update(true);
  ok(asked === 1 && mixer.find('sound/amb_cantina_large_lp.snd')?.space.building === 9, 'once the listener is beside it, it finds the room it stands in and moves into it');
  a.sources.update(true);
  ok(asked === 2, 'and it keeps asking, because the number a building is known by belongs to the object the streamer made for it');
  // The tile streams out and comes back: the same building, a new object, a new number.
  a.sources.spaceAt = (x) => (x > 11 ? { building: 14, cell: 2 } : null);
  a.sources.update(true);
  ok(mixer.find('sound/amb_cantina_large_lp.snd')?.space.building === 14, 'so walking out of a town and back leaves it in the building that is there now, not in one that has gone');
  ok(a.sources.hasEmitterIn({ building: 14, cell: 2 }), "and the room it stands in is still the room whose own bed it stands in for");

  a.leave();
  ok(mixer.live.size === 0 && (a.status().sources as Record<string, number>).placed === 0, 'leaving the planet lets every emitter go');
}

// ---- a sound object standing in the room you are in stands for the table's bed ----
{
  const mixer = new FakeMixer();
  const a = new Ambience(mixer, '/');
  a.adopt({ emitters: [{ sound: 'sound/amb_cantina_large_lp.snd', p: [0, 0, 0], pob: 'thm_tato_cantina', cell: 2 }] });
  a.setFrame(0, 0);
  a.sources.spaceAt = () => ({ building: 5, cell: 2 });
  mixer.grid.step(1, 0, 0, 0);
  a.sources.update(true);
  const inn = row({ pob: 'thm_tato_cantina', cell: 'default', day: 'sound/amb_cantina_medium_lp.snd', night: 'sound/amb_cantina_medium_lp.snd' });
  const rows: BedRow[] = [{ sounds: { day: ['sound/street.snd', null], night: ['sound/street.snd', null] }, weight: 1 }];
  const ctx = { rows, rowCount: 1, daylight: 1, room: inn, space: { building: 5, cell: 2 }, pass: true };
  for (let i = 0; i < 60; i++) a.update(0.1, ctx);
  ok(a.status().roomCoveredByEmitter === true, "the game's own sound object is found standing in the room the listener is in");
  ok(mixer.find('sound/amb_cantina_medium_lp.snd') === null, "so the interior table's bed for that room is left out and the chatter does not play twice");
  ok(mixer.find('sound/street.snd') === null && (a.status().insideShare as number) === 1, 'and the street outside is still faded away, because the listener is indoors all the same');
}

// ---- a planet whose places have not been converted ----
{
  const mixer = new FakeMixer();
  const a = new Ambience(mixer, '/');
  a.setRooms([row({ pob: 'default', cell: 'default', day: 'sound/default_interior.snd', night: 'sound/default_interior.snd' })]);
  a.adopt(null);
  const rows: BedRow[] = [{ sounds: { day: ['sound/day.snd', null], night: ['sound/day.snd', null] }, weight: 1 }];
  a.update(0.1, { rows, rowCount: 1, daylight: 1, room: a.roomRow('mun_tato_capitol_s01', 'foyer1'), space: OUTSIDE, pass: true });
  ok(a.status().pack === 'none' && mixer.started.length > 0, 'a planet with no places of its own still sounds, from its sky rows and the shared interior table');
  ok(a.roomRow('mun_tato_capitol_s01', 'foyer1')?.day === 'sound/default_interior.snd', 'and every room falls back to the table’s own default row');
}

// ---- the cap, and a source the mixer will not start ----
{
  const mixer = new FakeMixer();
  const a = new Ambience(mixer, '/', { cap: 4 });
  const emitters = [];
  for (let i = 0; i < 10; i++) emitters.push({ sound: `sound/e${i}.snd`, p: [i * 10, 0, 0] });
  a.adopt({ emitters });
  a.setFrame(0, 0);
  const s = a.status().sources as Record<string, unknown>;
  ok((s.placed as number) === 4 && ((s.counts as Record<string, number>).overCap ?? 0) >= 1, 'a pack with more emitters than the cap stops at the cap and says how many it left out');
}

// ---- and nothing else stops the walk: one missing sample, or a bank still in flight ----
{
  const mixer = new FakeMixer();
  mixer.bank.missing.add('sound/e3.snd');
  const a = new Ambience(mixer, '/');
  const emitters = [];
  for (let i = 0; i < 10; i++) emitters.push({ sound: `sound/e${i}.snd`, p: [i * 10, 0, 0] });
  a.adopt({ emitters });
  a.setFrame(0, 0);
  const s = a.status().sources as Record<string, unknown>;
  ok((s.placed as number) === 10, 'an emitter whose sound the bank does not hold does not take the nine after it with it');
  ok((s.missingSounds as string[]).join() === 'sound/e3.snd' && (s.counts as Record<string, number>).missing === 1, 'and it is named in the report rather than lost in silence');
  ok(mixer.live.size === 9, 'the other nine are playing');
}
{
  const mixer = new FakeMixer();
  mixer.bank.available = false;
  const a = new Ambience(mixer, '/');
  const emitters = [];
  for (let i = 0; i < 10; i++) emitters.push({ sound: `sound/e${i}.snd`, p: [i * 10, 0, 0] });
  a.adopt({ emitters });
  a.setFrame(0, 0);
  ok((a.status().sources as Record<string, number>).placed === 10 && mixer.live.size === 0, 'a planet whose places land before the bank does keeps every one of them, silent');
  mixer.bank.available = true;
  a.sources.retry();
  ok(mixer.live.size === 10, 'and the moment the bank lands they all come in');
}

// ---- a particle effect's own loop ----
{
  const mixer = new FakeMixer();
  const sources = new WorldEmitters(mixer);
  const waterfall = {};
  sources.attach(waterfall, 'sound/amb_waterfall_lg_lp.snd', 5, 0, 5, false);
  ok(mixer.find('sound/amb_waterfall_lg_lp.snd') !== null, 'a standing effect that names a sound keeps a loop where it is drawn');
  sources.moveAttached(waterfall, 9, 0, 9);
  ok(mixer.find('sound/amb_waterfall_lg_lp.snd') !== null && [...mixer.live.values()][0].x === 9, 'and the loop follows it');
  sources.attach(waterfall, 'sound/amb_waterfall_lg_lp.snd', 5, 0, 5, false);
  ok(mixer.live.size === 1, 'an effect asked twice keeps one loop, not two');
  sources.detach(waterfall);
  ok(mixer.live.size === 0, 'and the loop goes when the effect does');
}

// ---- a weather channel's own sound ----
{
  const mixer = new FakeMixer();
  const a = new Ambience(mixer, '/');
  const file = 'particles/fx_pt_rain_sheet_heavy.json';
  const thunder = 'sound/wtr_thunder_heavy.snd';
  a.weatherChannel(file, thunder, 0.8);
  ok(mixer.find(thunder) === null, "by default the thunder the rain sheets carry does not play: the storm rows carry their own, and the two would double");
  a.tune.weatherParticles = true;
  a.weatherChannel(file, thunder, 0.8);
  ok(near(mixer.find(thunder)?.gain ?? 0, 0.8), "switched on, it plays at the channel's own share of the mix");
  a.weatherChannel(file, thunder, 0.3);
  ok(near(mixer.find(thunder)?.gain ?? 0, 0.3), 'and it follows that share as the storm eases');
  a.weatherChannel(file, thunder, 0);
  ok(mixer.find(thunder) === null, 'to silence, where it is let go');
  ok((a.status().weatherChannels as unknown[]).length === 0, 'and a channel the weather has dropped leaves no record behind: the sky is dropped after the planet is left, and a record made then would show on the select screen');
  a.weatherChannel(file, thunder, 0.5);
  a.leave();
  ok(mixer.live.size === 0, 'and leaving the planet lets it go whatever it was doing');
}

// ---- the invented numbers are all in one place, and read back ----
{
  ok(AMBIENCE_TUNE.weatherParticles === false, "the owner's decision: the storm rows thunder, the rain sheets do not");
  ok(AMBIENCE_TUNE.dayFade === 20 && AMBIENCE_TUNE.roomFade === 1, 'the two crossfades are twenty seconds and one second');
  ok(WORLD_SOURCE_TUNE.cap === 1024 && WORLD_SOURCE_TUNE.spaceTries === 4 && WORLD_SOURCE_TUNE.spaceGiveUp === 40, "the emitters' cap and their room lookups are tuned in one place");
}

console.log(`\n${passed} checks passed`);
