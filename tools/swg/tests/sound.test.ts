// The sound bank: the sound template's 28 fields, the WAV reader, the client data that
// says which sound belongs to which event, and the tables that put a sound in a room, on a
// door, on a weapon and under a foot. Synthetic IFF throughout, so nothing needs the archives.
import assert from 'node:assert/strict';
import { chunk, encode, encodeRoots, form, W } from './iffWriter.ts';
import { CATEGORIES, MUSIC_CATEGORIES, SOUND_FORMAT, convertSounds, iffRoots, packSoundNames, parseSoundTemplate, readMp3, readPackJson, readWav, resolveSample, soundStatus, templateEntry } from '../sound.mjs';
import { floatParam, parseClientDataSounds, parseSurfaceTemplate, readClientData, readClientEffects, readSceneSounds, readSoundTables, roomRows, soundsOfClientData } from '../soundsources.mjs';
import { PLACES_FORMAT, SURFACE_TYPES, convertSoundPlaces, placedSounds, placesStatus, pobNameOf, roomsFor } from '../soundplaces.mjs';
import { flattenWithWorldTransforms, parseSnapshot } from '../ws.mjs';
import { parseIff } from '../iff.mjs';
import { parseDatatable } from '../datatable.mjs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const buf = (u8: Uint8Array) => Buffer.from(u8);
/** The readers take a parsed tree, as the converter hands them one. */
const parseIffOf = (node: ReturnType<typeof form>) => parseIff(buf(encode(node)));

// ---------------------------------------------------------------- the template

/** The 28 fields as the client writes them, in order, with everything not named left at zero. */
type Fields = Partial<Record<number, number>>;
function settings(fields: Fields, floats = new Set([0, 1, 2, 3, 6, 7, 8, 9, 17, 18, 19, 20, 22, 23, 24, 25, 27])) {
  const w = new W();
  for (let i = 0; i < 28; i++) {
    const v = fields[i] ?? 0;
    if (floats.has(i)) w.f32(v);
    else w.i32(v);
  }
  return w.bytes();
}
function soundChunk(samples: string[], fields: Fields) {
  const w = new W().i32(samples.length);
  for (const s of samples) w.str(s);
  return new Uint8Array([...w.bytes(), ...settings(fields)]);
}
const sd2d = (samples: string[], fields: Fields) => form('SD2D', chunk('0003', soundChunk(samples, fields)));
const sd3d = (samples: string[], fields: Fields) => form('SD3D', sd2d(samples, fields), chunk('0001', new Uint8Array(0)));

const bantha = parseSoundTemplate(buf(encode(sd3d(['sample/cr_bantha_hit_hvy.wav'], { 1: 0.3, 4: 1, 5: 1, 10: 6, 16: 2, 18: 0.85, 19: 1, 21: 2, 23: -2.5, 26: 5, 27: 20 }))));
ok(bantha.dim === 3 && bantha.samples.length === 1 && bantha.samples[0] === 'sample/cr_bantha_hit_hvy.wav', 'an SD3D template is a sound with a place in the world and names its sample');
ok(bantha.delay[0] === 0 && Math.abs(bantha.delay[1] - 0.3) < 1e-6, 'fields 0 and 1 are the random start delay');
ok(bantha.loops[0] === 1 && bantha.loops[1] === 1, 'fields 4 and 5 are the loop count');
ok(bantha.category === 6 && bantha.priority === 5 && bantha.full === 20, 'the category, the priority and the metres of full volume');
ok(bantha.volume.mode === 2 && Math.abs(bantha.volume.range[0] - 0.85) < 1e-6 && bantha.volume.range[1] === 1, 'the volume is drawn for each play, between its two values');
ok(bantha.pitch.mode === 2 && Math.abs(bantha.pitch.range[0] + 2.5) < 1e-6, 'the pitch shift is in semitones and may be negative');

const bed = parseSoundTemplate(buf(encode(sd2d(['sample/amb_grass_lp.wav'], { 2: 1.5, 3: 1.5, 4: -1, 5: -1, 8: 1.5, 9: 1.5, 14: 1, 15: 1, 16: 2, 18: 0.38, 19: 0.38, 26: 2, 27: 4 }))));
ok(bed.dim === 2 && bed.loops[0] === -1 && bed.fadeIn[0] === 1.5 && bed.fadeOut[1] === 1.5 && bed.fadeModes[0] === 1, 'an ambience bed is 2D, loops for ever and fades in and out');

const oneShots = parseSoundTemplate(buf(encode(sd2d(['a.wav', 'b.wav'], { 0: 2, 1: 5, 4: -1, 5: -1, 6: 15, 7: 30, 13: 2, 18: 0.03, 19: 0.05, 26: 2 }))));
ok(oneShots.gap[0] === 15 && oneShots.gap[1] === 30 && oneShots.gapMode === 2, 'the random one-shot bed waits 15 to 30 seconds and draws its gap again each time');

const ordered = parseSoundTemplate(buf(encode(sd2d(['a.wav'], { 10: 8, 11: 2, 26: 1 }))));
ok(ordered.order === 2 && ordered.category === 8, 'play order 2 is in the order written');

// The 528 voice-over files are an SD2D form with a stray empty chunk after it at the top level.
const twoRoots = buf(encodeRoots([sd2d(['voice/sample/vo_line.wav'], { 10: 13, 26: 9 }), chunk('0001', new Uint8Array(0))]));
ok(iffRoots(twoRoots).length === 2, 'iffRoots sees both top-level nodes');
const vo = parseSoundTemplate(twoRoots);
ok(vo.dim === 2 && vo.category === 13, 'a voice-over template reads from its first root form and the stray chunk is ignored');
assert.throws(() => parseSoundTemplate(buf(encode(form('SSHT', chunk('NAME', new Uint8Array([0])))))), 'a file that is not a sound template is refused');
checks++;
console.log('ok   a file that is not a sound template is refused');

const entry = templateEntry(bantha);
ok(entry.full === 20 && entry.loops === undefined && entry.gap === undefined && entry.volume.mode === 2, 'a pack entry leaves out the fields that are at their resting value');
ok(CATEGORIES[6] === 'vocalization' && MUSIC_CATEGORIES.has(8) && MUSIC_CATEGORIES.has(9) && !MUSIC_CATEGORIES.has(0), 'the categories are named and music and player music are the two left out');

// ---------------------------------------------------------------- the WAV reader

function wav({ rate = 22050, channels = 1, bits = 16, frames = 100, loop = null as null | [number, number] }) {
  const dataBytes = frames * channels * (bits / 8);
  const fmt = new W().u16(1).u16(channels).u32(rate).u32(rate * channels * (bits / 8)).u16(channels * (bits / 8)).u16(bits).bytes();
  const smpl = loop ? new W().u32(0).u32(0).u32(0).u32(60).u32(0).u32(0).u32(0).u32(1).u32(0).u32(0).u32(0).u32(loop[0]).u32(loop[1]).u32(0).u32(0).bytes() : null;
  const riffChunk = (id: string, body: Uint8Array) => [...[...id].map((c) => c.charCodeAt(0)), ...new W().u32(body.length).bytes(), ...body];
  const body = [
    ...[...'WAVE'].map((c) => c.charCodeAt(0)),
    ...riffChunk('fmt ', fmt),
    ...(smpl ? riffChunk('smpl', smpl) : []),
    ...riffChunk('data', new Uint8Array(dataBytes)),
  ];
  return Buffer.from([...[...'RIFF'].map((c) => c.charCodeAt(0)), ...new W().u32(body.length).bytes(), ...body]);
}
const plain = readWav(wav({ frames: 22050 }));
ok(plain.ok && plain.rate === 22050 && plain.channels === 1 && plain.bits === 16 && plain.frames === 22050 && Math.abs(plain.seconds - 1) < 1e-9, 'a 16-bit mono WAV reads its rate, its frames and its length in seconds');
const looped = readWav(wav({ frames: 1000, loop: [100, 900] }));
ok(looped.ok && looped.loop!.start === 100 && looped.loop!.end === 900, 'a sampler chunk gives the loop points');
ok(!readWav(Buffer.alloc(64)).ok && readWav(Buffer.alloc(64)).why === 'zero-filled', 'a file the archives hold as zeros is refused, and says why');
ok(!readWav(Buffer.from('not audio at all, not even close')).ok, 'anything that is not a RIFF WAV is refused');

// ---------------------------------------------------------------- the MP3 reader

/** MPEG 1 Layer III, 44,100 Hz, 128 kbit/s, stereo, with a Xing frame count when asked for. */
function mp3({ frames = 0, bytes = 4096, id3 = 0 }) {
  const head = [0xff, 0xfb, 0x90, 0x00];
  const body = new Uint8Array(bytes);
  body.set(head, 0);
  if (frames) {
    // The Xing tag sits after the side information: 32 bytes for MPEG 1 stereo.
    const at = 4 + 32;
    body.set([...'Xing'].map((c) => c.charCodeAt(0)), at);
    new DataView(body.buffer).setUint32(at + 4, 1);
    new DataView(body.buffer).setUint32(at + 8, frames);
  }
  if (!id3) return Buffer.from(body);
  const tag = new Uint8Array(10 + id3);
  tag.set([...'ID3'].map((c) => c.charCodeAt(0)), 0);
  tag[3] = 3;
  tag[6] = (id3 >> 21) & 0x7f;
  tag[7] = (id3 >> 14) & 0x7f;
  tag[8] = (id3 >> 7) & 0x7f;
  tag[9] = id3 & 0x7f;
  return Buffer.from([...tag, ...body]);
}
const xing = readMp3(mp3({ frames: 38 }));
ok(xing.ok && xing.rate === 44100 && xing.channels === 2 && Math.abs(xing.seconds - (38 * 1152) / 44100) < 1e-9 && !xing.estimated, 'an MP3 with a frame count gives its rate, its channels and its true length');
const cbr = readMp3(mp3({ bytes: 16000 }));
ok(cbr.ok && cbr.estimated === true && Math.abs(cbr.seconds - 1) < 0.01, 'one without a frame count has its length worked out from the bit rate, and says it is an estimate');
ok(readMp3(mp3({ frames: 38, id3: 1000 })).ok, 'an ID3 tag in front of the audio is stepped over');
ok(!readMp3(Buffer.alloc(512)).ok, 'a file with no MPEG frame in it at all is refused');

// ---------------------------------------------------------------- client data

const cstrs = (...s: string[]) => {
  const w = new W();
  for (const x of s) w.str(x);
  return w.bytes();
};
const clientData = form(
  'CLDF',
  form(
    '0000',
    chunk('CEFT', cstrs('footstep', 'clienteffect/cr_footstep_large.cef')),
    chunk('CSND', cstrs('hitheavy', 'sound\\cr_bantha_hit_heavy.snd')),
    chunk('EVNT', cstrs('sneeze', 'voice/sound/voice_pl_hum_m_sneeze.snd')),
    chunk('ASND', cstrs('sound/cr_bantha_idle_breathe.snd')),
    form('DAMA', chunk('INFO', new Uint8Array([...new W().f32(0.5).f32(0.75).bytes(), ...cstrs('clienteffect/veh_thruster_damage_1.cef')])), chunk('ASND', cstrs('sound/item_fire_small.snd'))),
    form('VTHR', chunk('INFO', new W().f32(0.25).bytes()), chunk('VSND', cstrs('engine_sound', 'sound/eng_idle_yt1300.snd', 'sound/eng_accel_yt1300.snd', 'sound/eng_decel_yt1300.snd', 'sound/eng_run_yt1300.snd', 'sound/item_fire_small.snd', '', '', ''))),
    form('VGEF', chunk('INFO', new Uint8Array([1, ...cstrs('sound/amb_river_large_lp.snd', 'ground_effect_0', 'appearance/pt_vehicle_water_trail.prt')]))),
    form('ENGS', form('INTS', chunk('INFO', new Uint8Array([...cstrs('engine_sound1', 'sound/eng_run_xwing.snd'), ...new W().f32(0.7).f32(1).f32(-16).f32(0).f32(0.3).f32(0.3).bytes()])))),
    form('DSTR', chunk('INFO', cstrs('clienteffect/cbt_explode_xwing.cef'))),
    form('DSEF', form('ASNL', chunk('SDAS', cstrs('sound/shp_capital_destruction_lp.snd')))),
    chunk('WING', new Uint8Array([...cstrs('object/tangible/ship/attachment/wing/shared_xwing_wing_pos_s01.iff'), ...cstrs('@@sound/wings_open_xwing.snd')])),
  ),
);
const cd = parseClientDataSounds(parseIffOf(clientData))!;
ok(cd.events!.footstep === 'clienteffect/cr_footstep_large.cef' && cd.events!.hitheavy === 'sound/cr_bantha_hit_heavy.snd' && cd.events!.sneeze === 'voice/sound/voice_pl_hum_m_sneeze.snd', 'CEFT, CSND and EVNT are all event name then path, and backslashes come out as slashes');
ok(cd.ambient === 'sound/cr_bantha_idle_breathe.snd', 'a top-level ASND is the object\'s own looping sound');
ok(cd.damage!.length === 1 && cd.damage![0].from === 0.5 && cd.damage![0].to === 0.75 && cd.damage![0].sound === 'sound/item_fire_small.snd', 'a damage state is two floats, its effect and its own loop');
const th = cd.thrusters![0];
ok(th.level === 0.25 && th.idle === 'sound/eng_idle_yt1300.snd' && th.accel!.includes('accel') && th.decel!.includes('decel') && th.run!.includes('run') && th.damaged.length === 1, 'a thruster names the idle, speed-up, slow-down and run loops, then the sounds of its damage');
ok(cd.ground![0].water === true && cd.ground![0].sound === 'sound/amb_river_large_lp.snd', 'a ground effect over water carries the water sound');
ok(cd.engines![0].slot === 'engine_sound1' && cd.engines![0].sound === 'sound/eng_run_xwing.snd' && cd.engines![0].params.length === 6 && cd.engines![0].params[2] === -16, 'a ship engine part names its slot, its run loop and six floats that are not decoded');
ok(cd.destroyed === 'clienteffect/cbt_explode_xwing.cef', 'DSTR is the effect played when it is destroyed');
ok(cd.extra!.includes('sound/shp_capital_destruction_lp.snd'), 'a sound in a form nothing reads is still kept, as a flat list');
ok(cd.extra!.includes('sound/wings_open_xwing.snd'), 'a path written with @@ in front of it is the same path');
ok(!cd.extra!.some((p) => !/^(sound|voice|clienteffect|music|player_music)\//.test(p)), 'nothing in that list carries the bytes written before it');
const named = soundsOfClientData(cd);
ok(named.includes('sound/eng_run_yt1300.snd') && named.includes('clienteffect/cr_footstep_large.cef') && named.length === new Set(named).size + (named.length - new Set(named).size), 'every sound and effect the entry names comes back in one list');
ok(parseClientDataSounds(parseIffOf(form('CLDF', form('0000', chunk('CSSI', cstrs('/private/index_color_1')))))) === null, 'a client data file with no sound in it is left out');

// ---------------------------------------------------------------- the tables

const dt = (columns: string[], types: string[], rows: (string | number)[][]) => {
  const c = new W().i32(columns.length);
  for (const x of columns) c.str(x);
  const t = new W();
  for (const x of types) t.str(x);
  const r = new W().i32(rows.length);
  for (const row of rows) row.forEach((v, i) => (types[i][0] === 's' ? r.str(String(v)) : types[i][0] === 'f' ? r.f32(Number(v)) : r.i32(Number(v))));
  return form('DTII', form('0001', chunk('COLS', c.bytes()), chunk('TYPE', t.bytes()), chunk('ROWS', r.bytes())));
};
const rooms = roomRows(parseDatatable(parseIffOf(dt(
  ['PobName', 'Cell Name', 'Day sound/ambient Sound (2d .snd)', 'Night sound/ambient Sound (2d .snd)', 'First Music (2d .snd)', 'Surface Type', 'Room Type'],
  ['s', 's', 's', 's', 's', 's', 'i'],
  [['thm_tato_cantina', 'lobby', 'sound/amb_cantina_large_lp.snd', 'sound/amb_cantina_large_lp.snd', '', 'stone', 7], ['default', 'default', 'sound/default_interior.snd', '', '', 'rock', 22]],
))));
ok(rooms.length === 2 && rooms[0].pob === 'thm_tato_cantina' && rooms[0].day === 'sound/amb_cantina_large_lp.snd' && rooms[0].surface === 'stone' && rooms[0].room === 7, 'a room row gives the building, the cell, its day and night beds, what the floor is and its room type');
ok(rooms[1].night === null && rooms[1].music === null, 'an empty cell in the room table is nothing, not an empty path');

const files = new Map<string, Buffer>();
const put = (p: string, node: ReturnType<typeof form>) => files.set(p, buf(encode(node)));
put('datatables/interior/interior.iff', dt(['PobName', 'Cell Name', 'Day sound/ambient Sound (2d .snd)', 'Night sound/ambient Sound (2d .snd)', 'Surface Type', 'Room Type'], ['s', 's', 's', 's', 's', 'i'], [['thm_tato_cantina', 'lobby', 'sound/amb_cantina_large_lp.snd', 'sound/amb_cantina_large_lp.snd', 'stone', 7]]));
put('datatables/player/sounds.iff', dt(['name', 'path'], ['s', 's'], [['backpack_open', 'sound/ui_backpack_open.snd'], ['button_confirm', 'sound/ui_button_confirm.snd']]));
put('datatables/weapon/combat_effects_melee.iff', dt(['Weapon', 'Attack Sound', 'Attack Sound Pitch', 'Hit Target Sound', 'Hit Sound Pitch'], ['s', 's', 'f', 's', 'f'], [['onehandLightsaber', 'sound/wep_lightsaber_swing.snd', 0, 'sound/wep_lightsaber_hit.snd', 0]]));
put('datatables/weapon/combat_effects_ranged.iff', dt(['Weapon', 'Muzzle Sound', 'Hit Target Sound', 'Hit Nothing Sound', 'Hit Ricochet Sound'], ['s', 's', 's', 's', 's'], [['pistol', 'sound/wep_pistol_fire.snd', 'sound/wep_hit.snd', '', '']]));
put('datatables/appearance/door_style.iff', dt(['doorStyleName', 'openBeginEffect', 'openEndEffect', 'closeBeginEffect', 'closeEndEffect'], ['s', 's', 's', 's', 's'], [['metal_style_01', 'clienteffect/door_open_metal_style_01.cef', '', '', ''], ['dummy', '', '', '', '']]));
put('datatables/space/ship_power_sounds.iff', dt(['type', 'engine_disabled', 'engine_enabled'], ['s', 's', 's'], [['xwing', 'sound/sys_engine_power_decrease.snd', 'sound/sys_engine_power_increase.snd']]));
put('datatables/space/ship_hit_sounds.iff', dt(['type', 'shield', 'armor', 'component', 'chassis'], ['s', 's', 's', 's', 's'], [['xwing', 'sound/cbt_hit_shield_xwing.snd', 'sound/cbt_hit_armor_xwing.snd', 'sound/cbt_hit_component_xwing.snd', 'sound/cbt_hit_chassis.snd'], ['', 'sound/cbt_hit_shield.snd', 'sound/cbt_hit_armor.snd', '', '']]));
put('datatables/space/ship_chassis.iff', dt(['name', 'flyby_sound', 'hit_sound_group'], ['s', 's', 's'], [['xwing', 'sound/eng_flyby_xwing.snd', 'xwing'], ['arc170', '', '']]));
put('abstract/terrain_surface/grass.iff', form('STER', form('0000', chunk('PCNT', new W().i32(2).bytes()), chunk('XXXX', new Uint8Array([...cstrs('cover'), 1, 0x20, ...new W().f32(0.5).bytes()])), chunk('XXXX', new Uint8Array([...cstrs('surfaceType'), 1, ...cstrs('grass')])))));
const vfs = {
  has: (p: string) => files.has(p),
  read: (p: string) => files.get(p)!,
  list: (text: string) => [...files.keys()].filter((k) => k.includes(text)),
  stat: (p: string) => (files.has(p) ? { size: files.get(p)!.length } : null),
};
const sources = readSoundTables(vfs);
ok(sources.rooms.length === 1 && sources.interface.backpack_open === 'sound/ui_backpack_open.snd', 'the room table and the interface table are read');
ok(sources.melee[0].attack === 'sound/wep_lightsaber_swing.snd' && sources.melee[0].hit === 'sound/wep_lightsaber_hit.snd' && sources.ranged[0].muzzle === 'sound/wep_pistol_fire.snd', 'the melee and ranged weapon tables give each weapon its swing and its hit');
ok(Object.keys(sources.doorStyles).length === 1 && sources.doorStyles.metal_style_01.openBegin!.endsWith('.cef') && sources.doorEffects.length === 1, 'a door style with no effect at all is left out, and the effects it names are collected');
ok(sources.shipPower.xwing.engine_enabled === 'sound/sys_engine_power_increase.snd' && sources.shipHits.xwing.shield!.includes('shield_xwing'), 'the ship power and hit tables are read whole');
ok(sources.shipHits.default?.shield === 'sound/cbt_hit_shield.snd' && !('' in sources.shipHits), 'the hit table\'s fallback row is called default, as the power table spells its own');
ok(sources.flyby.xwing === 'sound/eng_flyby_xwing.snd' && sources.hitGroups.xwing === 'xwing' && !('arc170' in sources.flyby), 'a chassis with no flyby sound is left out');
ok(sources.surfaces['abstract/terrain_surface/grass.iff'].type === 'grass' && sources.surfaces['abstract/terrain_surface/grass.iff'].cover === 0.5, 'a terrain surface template gives the surface under a foot and how much of the ground it covers');
ok(floatParam(Buffer.from([1, 0x20, 0, 0, 0, 0x3f])) === 0.5, 'a float parameter carries the delta byte between its type and its value, as an integer one does');
ok(parseSurfaceTemplate(parseIffOf(form('STER', form('0000', chunk('XXXX', new Uint8Array([...cstrs('surfaceType'), 1, ...cstrs('sand')]))))))?.type === 'sand', 'a surface template with no cover still names its surface');

// ---------------------------------------------------------------- the whole command

const dir = mkdtempSync(join(tmpdir(), 'swg-sound-'));
try {
  files.set('sound/cr_bantha_hit_heavy.snd', buf(encode(sd3d(['sample/cr_bantha_hit_hvy.wav'], { 10: 6, 26: 5, 27: 20 }))));
  files.set('sound/amb_cantina_large_lp.snd', buf(encode(sd2d(['sample/amb_cantina_large_lp.wav'], { 4: -1, 5: -1, 26: 2, 27: 8 }))));
  files.set('sound/music_figrin_dan_song_1.snd', buf(encode(sd2d(['sample/mus_figrin.wav'], { 10: 8, 26: 1 }))));
  files.set('sound/music_theme.snd', buf(encode(sd2d(['sample/mus_theme.wav'], { 10: 8, 26: 1 }))));
  files.set('sound/cr_lost.snd', buf(encode(sd3d(['d:/swg/current/data/sku.0/sys.client/built/creature/sample/cr_boar_wolf_vocalize.wav'], { 10: 6, 26: 5 }))));
  files.set('sound/cr_gone.snd', buf(encode(sd3d(['sample/never_shipped.wav'], { 10: 6, 26: 5 }))));
  files.set('sample/cr_bantha_hit_hvy.wav', wav({ frames: 4410 }));
  files.set('sample/amb_cantina_large_lp.wav', wav({ frames: 44100, loop: [10, 44000] }));
  files.set('sample/mus_figrin.wav', wav({ frames: 8820 }));
  files.set('sample/mus_theme.wav', wav({ frames: 8820 }));
  files.set('sample/cr_boar_wolf_vocalize.wav', wav({ frames: 2205 }));
  files.set('clienteffect/cr_footstep_large.cef', buf(encode(form('CLEF', form('0001', chunk('PSND', cstrs('sound/cr_generic_large_fs_walk.snd')))))));
  files.set('clienteffect/mus_theme_start.cef', buf(encode(form('CLEF', form('0001', chunk('PSND', cstrs('sound/music_theme.snd')))))));
  files.set('clientdata/client_shared_instrument_organ.cdf', buf(encode(form('CLDF', form('0000', chunk('ASND', cstrs('sound/music_figrin_dan_song_1.snd')))))));
  files.set('clientdata/creature/client_shared_cr_bantha.cdf', buf(encode(form('CLDF', form('0000', chunk('CEFT', cstrs('footstep', 'clienteffect/cr_footstep_large.cef')))))));
  // Five creature voices in the archives are written with no extension at all.
  files.set('clientdata/creature/client_shared_cr_gualama.cdf', buf(encode(form('CLDF', form('0000', chunk('CSND', cstrs('attackheavy', 'sound/cr_gualama_attack_hvy')))))));
  files.set('sound/cr_gualama_attack_hvy.snd', buf(encode(sd3d(['sample/cr_bantha_hit_hvy.wav'], { 10: 6, 26: 5 }))));
  // The jump's stage sounds: category 8, named by the scene rather than by anything in a room.
  files.set('sound/ship_hyperspace_begin.snd', buf(encode(sd2d(['sample/shp_hyper.wav'], { 10: 8, 26: 1 }))));
  files.set('sample/shp_hyper.wav', wav({ frames: 11025 }));
  files.set('scene/hyperspace.iff', buf(encode(form('HYPR', form('0000', chunk('STG1', cstrs('@@sound/ship_hyperspace_begin.snd')))))));
  // The music manager's scenes are the score and stay out, whatever they name.
  files.set('scene/game_music_manager.iff', buf(encode(form('SMGR', form('0000', chunk('DATA', cstrs('sound/music_theme.snd')))))));
  // Two beds whose names are the same letters with the underscores in other places.
  files.set('sound/amb_a_b.snd', buf(encode(sd2d(['sample/cr_bantha_hit_hvy.wav'], { 4: -1, 5: -1, 26: 2 }))));
  files.set('sound/amb_ab.snd', buf(encode(sd2d(['sample/cr_bantha_hit_hvy.wav'], { 4: -1, 5: -1, 26: 2 }))));
  // A planet pack already converted: a bed the archives never held, one the bank has, one whose
  // name has an underscore in the wrong place, and one that two templates would answer to.
  mkdirSync(join(dir, 'tatooine'), { recursive: true });
  writeFileSync(join(dir, 'tatooine', 'sky.json'), JSON.stringify({ rows: [{ ambient: 'sound/amb_never_shipped.snd' }, { ambient: 'sound/amb_cantina_large_lp.snd' }, { ambient: 'sound/amb_cantinalarge_lp.snd' }, { ambient: 'sound/amb__a_b.snd' }] }));

  ok(resolveSample(vfs, 'd:/swg/current/data/sku.0/sys.client/built/creature/sample/cr_boar_wolf_vocalize.wav') === 'sample/cr_boar_wolf_vocalize.wav', 'a sample named by the absolute path of the machine that built it is found under sample/');
  ok(resolveSample(vfs, 'sample/never_shipped.wav') === 'sample/never_shipped.wav', 'a sample that is nowhere keeps the name it was given, so it shows up as missing');
  files.set('sample/deep.wav', wav({ frames: 10 }));
  ok(resolveSample(vfs, 'd:/built/music/beds/sample/deep.wav') === 'sample/deep.wav', 'an exporter path with two such folders in it is taken from the deeper one');
  files.delete('sample/deep.wav');

  const scenes = readSceneSounds(vfs);
  ok(scenes['scene/hyperspace.iff']?.[0] === 'sound/ship_hyperspace_begin.snd', 'a scene file\'s sounds are swept out in the order it writes them, with the @@ taken off');
  ok(packSoundNames(dir).get('sound/amb_never_shipped.snd') === 'tatooine/sky.json', 'the sounds a converted pack names are found in its own JSON');

  const r = convertSounds(vfs, dir, { log: () => {} });
  const bank = JSON.parse(readFileSync(join(dir, 'sounds', 'sounds.json'), 'utf8'));
  ok(bank.format === SOUND_FORMAT && Object.keys(bank.templates).length === r.templates, 'the bank is written with its format and every ported template');
  ok(!('sound/music_theme.snd' in bank.templates) && r.leftOut === 1, 'background music is left out');
  ok(bank.templates['sound/music_figrin_dan_song_1.snd']?.placedMusic === true && r.placedMusic === 1, 'music a sound object plays in the world is ported all the same, and marked');
  ok(bank.templates['sound/ship_hyperspace_begin.snd']?.keptMusic === 'scene' && r.sceneMusic === 1, 'a sound a scene plays is kept although the client files it under music, and is not put on the ambience slider');
  ok(!('sound/music_theme.snd' in bank.templates), 'the music manager\'s scenes are the score, and naming a piece there does not keep it');
  ok(bank.templates['sound/cr_lost.snd'].samples[0] === 'sample/cr_boar_wolf_vocalize.wav', 'a template written with an exporter path names the sample where it really is');
  ok(bank.templates['sound/cr_gone.snd'].silent === true && r.missing.includes('sample/never_shipped.wav'), 'a template whose every sample is missing is kept and marked silent, so a lookup never throws');
  ok(bank.samples['sample/amb_cantina_large_lp.wav'].loop[0] === 10, 'a sample that loops part of itself keeps its loop points');
  ok(bank.samples['sample/cr_bantha_hit_hvy.wav'].loop === undefined, 'one that loops whole does not');
  ok(readFileSync(join(dir, 'sounds', 'samples', 'sample', 'cr_bantha_hit_hvy.wav')).length === files.get('sample/cr_bantha_hit_hvy.wav')!.length, 'the samples are copied as they are, under their archive path');
  const again = convertSounds(vfs, dir, { log: () => {} });
  ok(again.copied === 0 && r.copied > 0, 'a second run writes no audio again');
  const events = JSON.parse(readFileSync(join(dir, 'sounds', 'events.json'), 'utf8'));
  ok(events.clientEffects['clienteffect/cr_footstep_large.cef'].sounds[0] === 'sound/cr_generic_large_fs_walk.snd', 'a client effect is kept as the sounds it plays');
  ok(events.dangling.includes('sound/cr_generic_large_fs_walk.snd'), 'a sound the game names and the archives have no template for is listed rather than left to be discovered as silence');
  ok(!events.dangling.includes('sound/music_theme.snd') && events.leftOutButNamed.includes('sound/music_theme.snd'), 'a sound that is in the archives but was left out as music is reported apart from one that is nowhere');
  ok(events.packGaps['sound/amb_never_shipped.snd'] === 'tatooine/sky.json' && !('sound/amb_cantina_large_lp.snd' in events.packGaps), 'a sound an already converted pack asks for and the bank has not got is named with the pack that asks');
  ok(bank.aliases['sound/amb_cantinalarge_lp.snd'] === 'sound/amb_cantina_large_lp.snd' && !('sound/amb_cantinalarge_lp.snd' in events.packGaps), 'a name that differs from the file only in where an underscore falls is written as an alias, not as a hole');
  ok(bank.aliases['sound/amb__a_b.snd'] === undefined && events.dangling.includes('sound/amb__a_b.snd'), 'a name two templates would answer to claims neither, and is reported as a hole');
  ok(events.clientData['clientdata/creature/client_shared_cr_gualama.cdf'].events.attackheavy === 'sound/cr_gualama_attack_hvy.snd' && r.repaired === 1, 'an event sound written without its extension gets it back when that file is there');
  ok(events.scenes['scene/hyperspace.iff'].length === 1, 'what each scene names is written into the pack, for whatever comes to play it');
  const cdOnly = readClientData(vfs);
  ok(Object.keys(cdOnly).length === 3 && readClientEffects(vfs, null)['clienteffect/cr_footstep_large.cef'] !== undefined, 'only the client data files that name a sound are kept, and every client effect is read');

  const status = soundStatus(dir, readPackJson);
  ok(status.need === null && status.line.includes('templates'), 'status is happy with a bank that holds everything');
  ok(soundStatus(join(dir, 'nothing'), readPackJson).need!.includes('no sound bank'), 'status asks for the command when there is no bank at all');
  const partial = mkdtempSync(join(tmpdir(), 'swg-sound-part-'));
  try {
    convertSounds(vfs, partial, { only: 'sound/amb_', log: () => {} });
    ok(soundStatus(partial, readPackJson).need!.includes('only the templates'), 'a bank converted with --only asks to be converted whole');
    convertSounds(vfs, partial, { samples: false, log: () => {} });
    ok(soundStatus(partial, readPackJson).need!.includes('no audio'), 'a bank converted without its audio asks to be converted again');
  } finally {
    rmSync(partial, { recursive: true, force: true });
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// ------------------------------------------------- where a planet's sounds are (soundplaces.mjs)

// A synthetic world: a cantina with a sound object in one of its cells and a band that carries its
// own cell index, a torch standing on its own, a wooden catwalk, a rock, a sound object whose
// client data names an effect instead of a sound, a torch in a cell with no building over it, one
// buried deeper than the container walk goes, and one whose place is not a number. Nothing here
// needs the archives. Every name in this section is prefixed, because later waves append sections
// of their own to this file and a second `const world` would be a syntax error, not a red check.
const placesParams = (...params: ReturnType<typeof chunk>[]) => form('SHOT', form('0000', chunk('PCNT', new W().i32(params.length).bytes()), ...params));
const placesStr = (name: string, value: string) => chunk('XXXX', new Uint8Array([...cstrs(name), 1, ...cstrs(value)]));
const placesNum = (name: string, value: number) => chunk('XXXX', new Uint8Array([...cstrs(name), 1, 0x20, ...new W().i32(value).bytes()]));
/** A snapshot NODE: its id, its container, which template, which cell, and where. Children nest inside it. */
const placesNode = (id: number, containedBy: number, templateIndex: number, cellIndex: number, pos: number[], children: ReturnType<typeof form>[] = []) =>
  form('NODE', form('0000', chunk('DATA', new W().i32(id).i32(containedBy).i32(templateIndex).i32(cellIndex).f32(1).f32(0).f32(0).f32(0).f32(pos[0]).f32(pos[1]).f32(pos[2]).f32(4).u32(0).bytes()), ...children));
const placesOtnl = (names: string[]) => {
  const w = new W().i32(names.length);
  for (const n of names) w.str(n);
  return chunk('OTNL', w.bytes());
};

const placesFiles = new Map<string, Buffer>();
const placesPut = (p: string, node: ReturnType<typeof form>) => placesFiles.set(p, buf(encode(node)));
const PLACES_CANTINA = 'object/building/tatooine/shared_cantina.iff';
const PLACES_CELL = 'object/cell/shared_cell.iff';
const PLACES_SOUNDOBJ = 'object/soundobject/shared_soundobject_cantina_large.iff';
const PLACES_BAND = 'object/soundobject/shared_soundobject_band.iff';
const PLACES_TORCH = 'object/tangible/furniture/all/shared_frn_all_tiki_torch_s1.iff';
const PLACES_CATWALK = 'object/static/structure/general/shared_catwalk.iff';
const PLACES_ROCK = 'object/static/shared_rock.iff';
const PLACES_BROKEN = 'object/soundobject/shared_soundobject_broken.iff';
const placesTemplates = [PLACES_CANTINA, PLACES_CELL, PLACES_SOUNDOBJ, PLACES_TORCH, PLACES_CATWALK, PLACES_ROCK, PLACES_BROKEN, PLACES_BAND];
placesPut(PLACES_CANTINA, placesParams(placesStr('portalLayoutFilename', 'appearance/thm_tato_cantina.pob')));
placesPut(PLACES_CELL, placesParams(placesNum('surfaceType', 0)));
placesPut(PLACES_SOUNDOBJ, placesParams(placesStr('clientDataFile', 'clientdata/soundobject/shared_soundobject_cantina_large.cdf')));
placesPut(PLACES_BAND, placesParams(placesStr('clientDataFile', 'clientdata/soundobject/shared_soundobject_band.cdf')));
placesPut(PLACES_TORCH, placesParams(placesStr('clientDataFile', 'clientdata/furniture/shared_frn_all_tiki_torch_s1.cdf'), placesNum('surfaceType', 0)));
placesPut(PLACES_CATWALK, placesParams(placesNum('surfaceType', 3)));
placesPut(PLACES_ROCK, placesParams(placesNum('surfaceType', 0)));
placesPut(PLACES_BROKEN, placesParams(placesStr('clientDataFile', 'clientdata/soundobject/shared_soundobject_broken.cdf')));
placesPut('clientdata/soundobject/shared_soundobject_cantina_large.cdf', form('CLDF', form('0000', chunk('ASND', cstrs('sound/amb_cantina_large_lp.snd')))));
placesPut('clientdata/soundobject/shared_soundobject_band.cdf', form('CLDF', form('0000', chunk('ASND', cstrs('sound/amb_band_lp.snd')))));
placesPut('clientdata/furniture/shared_frn_all_tiki_torch_s1.cdf', form('CLDF', form('0000', chunk('ASND', cstrs('sound\\item_tiki_torch.snd')))));
placesPut('clientdata/soundobject/shared_soundobject_broken.cdf', form('CLDF', form('0000', chunk('ASND', cstrs('clienteffect/not_a_sound.cef')))));
// A torch nine containers deep inside a second cantina, which is further than the walk goes.
let placesDeep = placesNode(30, 29, 3, 0, [0, 0, 1]);
for (let i = 29; i >= 21; i--) placesDeep = placesNode(i, i - 1, 5, 0, [0, 0, 0], [placesDeep]);
placesPut('snapshot/testland.ws', form('WSNP', form('0001',
  form('NODS',
    placesNode(1, 0, 0, 0, [100, 5, 200], [placesNode(2, 1, 1, 3, [0, 0, 0], [placesNode(3, 2, 2, 0, [1, 0.5, 2]), placesNode(8, 2, 7, 3, [2, 0.5, 3])])]),
    placesNode(4, 0, 3, 0, [10, 0, 20]),
    placesNode(5, 0, 4, 0, [30, 0, 40]),
    placesNode(6, 0, 5, 0, [50, 0, 60]),
    placesNode(7, 0, 6, 0, [70, 0, 80]),
    placesNode(9, 0, 1, 2, [500, 0, 500], [placesNode(10, 9, 3, 0, [1, 0, 1])]),
    placesNode(20, 0, 0, 0, [900, 0, 900], [placesDeep]),
    placesNode(40, 0, 3, 0, [NaN, 0, 5]),
  ),
  placesOtnl(placesTemplates),
)));
placesPut('datatables/interior/interior.iff', dt(
  ['PobName', 'Cell Name', 'Day sound/ambient Sound (2d .snd)', 'Night sound/ambient Sound (2d .snd)', 'First Music (2d .snd)', 'Surface Type', 'Room Type'],
  ['s', 's', 's', 's', 's', 's', 'i'],
  [
    ['default', 'default', 'sound/default_interior.snd', 'sound/default_interior.snd', '', 'rock', 22],
    ['thm_tato_cantina', 'default', 'sound/amb_cantina_large_lp.snd', 'sound/amb_cantina_large_lp.snd', '', 'stone', 7],
    ['thm_tato_cantina', 'stage', 'sound/amb_cantina_large_lp.snd', '', 'sound/music_figrin_dan_song_1.snd', 'wood', 7],
    ['mun_nboo_theed_palace', 'lobby', 'sound/amb_palace_lp.snd', '', '', 'stone', 22],
  ],
));
const placesVfs = { has: (p: string) => placesFiles.has(p), read: (p: string) => placesFiles.get(p)!, list: (t: string) => [...placesFiles.keys()].filter((k) => k.includes(t)) };

ok(pobNameOf('appearance/mun_tato_capitol_s01.pob') === 'mun_tato_capitol_s01' && pobNameOf('appearance\\thm_tato_cantina.pob') === 'thm_tato_cantina' && pobNameOf(null) === null, 'a portal layout file gives the room table\'s key: its name without its folder or its extension');
ok(SURFACE_TYPES[1] === 'metal' && SURFACE_TYPES[2] === 'stone' && SURFACE_TYPES[3] === 'wood' && SURFACE_TYPES[0] === undefined, 'the surfaces a planet can place are named as a body\'s own steps name them, and 0 is no surface of its own');

const placesSnap = parseSnapshot(parseIff(placesVfs.read('snapshot/testland.ws')));
const placesFound = placedSounds(placesVfs, placesSnap, flattenWithWorldTransforms(placesSnap));
ok(placesFound.emitters.length === 5, 'every placed object whose client data names its own looping sound is an emitter, and nothing else is');
const placesInCantina = placesFound.emitters.find((e) => e.template === PLACES_SOUNDOBJ)!;
ok(placesInCantina.p[0] === 101 && placesInCantina.p[1] === 5.5 && placesInCantina.p[2] === 202, 'an emitter inside a building is placed in the world, through its cell and its building');
ok(placesInCantina.pob === 'thm_tato_cantina' && placesInCantina.cell === 3 && placesInCantina.bp![0] === 100, 'it carries the building it is in, which of its cells, and where that building stands');
const placesBand = placesFound.emitters.find((e) => e.template === PLACES_BAND)!;
ok(placesBand.cell === 3 && placesBand.pob === 'thm_tato_cantina', 'one that carries a room of its own is in that room, which is the room its cell object gives as well');
const placesTorch = placesFound.emitters.find((e) => e.p[0] === 10)!;
ok(placesTorch.sound === 'sound/item_tiki_torch.snd' && placesTorch.pob === undefined && placesTorch.cell === undefined, 'one standing out in the world carries no building, and its path\'s backslashes come out as slashes');
const placesOrphan = placesFound.emitters.find((e) => e.p[0] === 501)!;
ok(placesOrphan.cell === 2 && placesOrphan.pob === undefined, 'one in a room whose building the world does not name keeps its room and is counted as having no building');
const placesBuried = placesFound.emitters.find((e) => e.p[0] === 900)!;
ok(placesBuried.pob === undefined && placesBuried.cell === undefined, 'one buried deeper in containers than the walk goes is written where it stands, with no building guessed for it');
ok(!placesFound.emitters.some((e) => !Number.isFinite(e.p[0])), 'one whose place is not a number is left out rather than stood at the world\'s origin');
ok(placesFound.emitters.slice(0, 2).every((e) => e.template.startsWith('object/soundobject/')) && !placesFound.emitters[2].template.startsWith('object/soundobject/'), 'the objects placed for their sound alone come first, so a game that can hold only so many holds those');
ok(!placesFound.emitters.some((e) => e.template === PLACES_BROKEN), 'an object whose own loop names something that is not a sound template is left out');
ok(placesFound.pobs[PLACES_CANTINA] === 'thm_tato_cantina' && Object.keys(placesFound.pobs).length === 1, 'every placed building names its portal layout, which is how its rooms are found');
ok(placesFound.surfaces[PLACES_CATWALK] === 'wood' && placesFound.surfaces[PLACES_ROCK] === undefined && placesFound.surfaces[PLACES_TORCH] === undefined, 'a template with a surface of its own is written, and the ones with none are not');

const placesRooms = roomsFor(roomRows(parseDatatable(parseIff(placesVfs.read('datatables/interior/interior.iff')))), new Set(['thm_tato_cantina']));
ok(placesRooms['thm_tato_cantina|stage'].surface === 'wood' && placesRooms['thm_tato_cantina|stage'].music === 'sound/music_figrin_dan_song_1.snd' && placesRooms['thm_tato_cantina|default'].room === 7, 'the room rows of the buildings a planet places come with it, keyed by building and cell');
ok(placesRooms['default|default'] !== undefined && placesRooms['mun_nboo_theed_palace|lobby'] === undefined, 'the table\'s own fallback row comes too, and a building this planet does not place does not');
ok(placesRooms['thm_tato_cantina|stage'].night === undefined, 'an empty cell in the table is left out rather than written as an empty path');

const placesDir = mkdtempSync(join(tmpdir(), 'swg-places-'));
try {
  mkdirSync(join(placesDir, 'testland'), { recursive: true });
  writeFileSync(join(placesDir, 'testland', 'manifest.json'), JSON.stringify({ planet: 'testland' }));
  mkdirSync(join(placesDir, 'nowhere'), { recursive: true });
  writeFileSync(join(placesDir, 'nowhere', 'manifest.json'), JSON.stringify({ planet: 'nowhere' }));
  const written = convertSoundPlaces(placesVfs, placesDir, { planets: ['testland', 'nowhere', 'unconverted'], log: () => {} });
  ok(written.length === 1 && written[0].planet === 'testland' && written[0].emitters === 5, 'a planet the archives place nothing for is passed over rather than written empty');
  ok(!existsSync(join(placesDir, 'unconverted')), 'and a planet with no pack of its own is given neither a file nor a directory');
  const pack = JSON.parse(readFileSync(join(placesDir, 'testland', 'sounds.json'), 'utf8'));
  ok(pack.format === PLACES_FORMAT && pack.planet === 'testland' && pack.frame === 'snapshot', 'the planet\'s sounds are written with their format and the frame their places are in');
  ok(pack.emitters.length === 5 && pack.soundObjects === 2 && pack.rooms['thm_tato_cantina|stage'] !== undefined && pack.surfaces[PLACES_CATWALK] === 'wood', 'the file holds the emitters, how many of them were placed for their sound alone, the rooms of the buildings placed and what is underfoot');

  mkdirSync(join(placesDir, 'elsewhere'), { recursive: true });
  writeFileSync(join(placesDir, 'elsewhere', 'manifest.json'), JSON.stringify({ planet: 'elsewhere' }));
  const st = placesStatus(placesDir, ['testland', 'elsewhere', 'unconverted'], readPackJson);
  ok(st.need!.includes('elsewhere') && !st.need!.includes('testland') && !st.need!.includes('unconverted'), 'status asks for a planet that has a pack and no placed sounds, and says nothing about one with no pack at all');
  writeFileSync(join(placesDir, 'elsewhere', 'sounds.json'), JSON.stringify({ format: 0, planet: 'elsewhere', emitters: [] }));
  ok(placesStatus(placesDir, ['testland', 'elsewhere'], readPackJson).need!.includes('older'), 'and asks again for one written before the converter changed shape');
  writeFileSync(join(placesDir, 'elsewhere', 'sounds.json'), JSON.stringify({ format: PLACES_FORMAT, planet: 'elsewhere', emitters: [] }));
  ok(placesStatus(placesDir, ['testland', 'elsewhere'], readPackJson).need === null, 'and is happy once both are there');
  const many = placesStatus(placesDir, ['testland', 'a', 'b', 'c', 'd', 'e', 'f'], (p: string) => (p.endsWith('manifest.json') || readPackJson(p) ? { planet: 'x' } : null));
  ok(many.need!.includes('and 2 more') && !many.need!.includes(', f'), 'a fresh tree asks for the first few planets by name and counts the rest');
} finally {
  rmSync(placesDir, { recursive: true, force: true });
}

console.log(`${checks} checks passed`);
