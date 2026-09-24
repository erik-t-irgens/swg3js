// When something happens inside a clip: the frames SWG's own animations mark, the frames Jedi
// Academy's text file marks, the hilts' hums, and the clip names a species pack's list has to
// agree with. Synthetic IFF and synthetic text throughout, so nothing here needs the archives
// or a Jedi Academy install.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { chunk, encode, form, W } from './iffWriter.ts';
import { parseIff } from '../iff.mjs';
import { parseLat } from '../skeletal.mjs';
import { nameLocomotion } from '../clipnames.mjs';
import {
  CLIP_EVENTS_FORMAT,
  clipEventEntry,
  clipEventStatus,
  clipTiming,
  footEventOf,
  isDroppedEvent,
  jkaClipEvents,
  parseAnimEvents,
  parseClipMessages,
  soundEventOf,
} from '../clipevents.mjs';
import { JKA_SOUND_FORMAT, checkPlayedFrames, eventSoundFiles, jkaSoundStatus, parseSab, readSabers, resolveJkaFile } from '../jkasound.mjs';
import { readMobileClientData, readSpeciesClientData } from '../soundsources.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const buf = (u8: Uint8Array) => Buffer.from(u8);

// ------------------------------------------------------------------ the animation's own marks

/** FORM MSGS: an INFO count, then one MESG per message (frame count, name, that many frames). */
const mesg = (name: string, frames: number[]) => {
  const w = new W().i16(frames.length).str(name);
  for (const f of frames) w.i16(f);
  return chunk('MESG', w.bytes());
};
const msgs = (...messages: ReturnType<typeof mesg>[]) => form('MSGS', chunk('INFO', new W().i16(messages.length).bytes()), ...messages);
/** A compressed clip: FORM CKAT > 0001 > INFO (float rate, int16 frame count). */
const ckat = (fps: number, frames: number, ...rest: ReturnType<typeof form>[]) => form('CKAT', form('0001', chunk('INFO', new W().f32(fps).i16(frames).bytes()), ...rest));
/** An uncompressed clip: FORM KFAT > 0003 > INFO (float rate, int32 frame count, int32 count). */
const kfat = (fps: number, frames: number, ...rest: ReturnType<typeof form>[]) => form('KFAT', form('0003', chunk('INFO', new W().f32(fps).i32(frames).i32(0).bytes()), ...rest));

const run = parseIff(buf(encode(ckat(30, 22, msgs(mesg('event_footstep', [6, 17]))))));
const runTiming = clipTiming(run);
ok(runTiming!.fps === 30 && runTiming!.frames === 22, 'a compressed clip reads its rate and frame count from its version form without decoding a channel');
const runMsgs = parseClipMessages(run)!;
ok(runMsgs.declared === 1 && runMsgs.events.length === 2, 'one message with two frames is two events, and the INFO count names the messages, not the events');
const runEntry = clipEventEntry(run)!;
ok(runEntry.events[0].name === 'event_footstep' && runEntry.events[0].frame === 6, 'an event keeps its name as the file writes it and the frame as written');
ok(Math.abs(runEntry.events[0].f - 6 / 22) < 1e-4 && Math.abs(runEntry.events[1].f - 17 / 22) < 1e-4, 'the fraction is the frame over the clip frame count');

const wide = parseIff(buf(encode(kfat(24, 100, msgs(mesg('event_vocalize', [50]))))));
ok(clipTiming(wide)!.frames === 100 && clipTiming(wide)!.fps === 24, 'an uncompressed clip writes its frame count as an int32 and reads the same way');
ok(clipEventEntry(wide)!.events[0].f === 0.5, 'a mark halfway through a clip is a half');

// A clip that only marks shots or hardpoint effects carries nothing the sound needs.
ok(isDroppedEvent('fire1') && isDroppedEvent('fire4_2') && isDroppedEvent('hpevent_root_takeoff'), 'the shot marks and the hardpoint marks are dropped');
ok(isDroppedEvent('cameracut_cam0') && isDroppedEvent('createwpn') && isDroppedEvent('destroywpn'), 'so are the camera cuts and the marks that put a weapon in a hand, which no client data answers');
ok(!isDroppedEvent('event_footstep') && !isDroppedEvent('swing_whp1') && !isDroppedEvent('sound_rancor_walk'), 'every other mark is kept, whatever it is named');
const shots = clipEventEntry(parseIff(buf(encode(ckat(30, 10, msgs(mesg('fire1', [2]), mesg('hpevent_root_land', [4])))))))!;
ok(shots.events.length === 0 && shots.dropped === 2, 'a clip that marks only shots keeps no events and says how many it dropped');
const mixed = clipEventEntry(parseIff(buf(encode(ckat(30, 10, msgs(mesg('fire1', [2]), mesg('event_hitground', [8])))))))!;
ok(mixed.events.length === 1 && mixed.events[0].name === 'event_hitground', 'a clip that marks both keeps the one and drops the other');

ok(parseClipMessages(parseIff(buf(encode(ckat(30, 10))))) === null, 'a clip with no MSGS form marks nothing');
ok(clipEventEntry(parseIff(buf(encode(ckat(30, 10))))) === null, 'and gets no record');
ok(clipTiming(parseIff(buf(encode(form('SKMG', chunk('INFO', new Uint8Array(8))))))) === null, 'a file that is not a keyframe animation has no timing');
ok(clipTiming(parseIff(buf(encode(ckat(30, 0))))) === null, 'nor has a clip whose own INFO gives no frame count, so nothing is written against a made-up length');
const untimed = clipEventEntry(parseIff(buf(encode(ckat(30, 0, msgs(mesg('event_footstep', [40])))))))!;
ok(untimed.untimed === true && untimed.events.length === 0, 'a clip that marks something but cannot be timed is counted apart and writes no event');

// A mark on the frame after the last keyframe: 1,524 of the retail set sit there.
const onEnd = clipEventEntry(parseIff(buf(encode(ckat(30, 55, msgs(mesg('event_footstep', [55])))))))!;
ok(onEnd.atEnd === 1 && onEnd.events[0].end === true && onEnd.events[0].f === 1, "a mark on the frame after the last keyframe keeps its frame, is marked as the clip's end and is counted");
ok(runEntry.atEnd === 0 && runEntry.events[0].end === undefined, 'and an ordinary mark carries no such flag');
const msgCheck = parseClipMessages(parseIff(buf(encode(ckat(30, 10, msgs(mesg('event_footstep', [2]), mesg('event_vocalize', [4])))))))!;
ok(msgCheck.declared === 2 && msgCheck.messages === 2 && msgCheck.trailing === 0 && msgCheck.short === 0, 'the INFO count, the messages read and the bytes left over are reported, so a message block that stops parsing to the byte is counted');

// The frame written in the file is the frame the message names, not a time: a clip played at
// twice the rate still marks the same frame, and the fraction is what carries it across.
const fast = clipEventEntry(parseIff(buf(encode(ckat(60, 22, msgs(mesg('event_footstep', [6])))))))!;
ok(fast.fps === 60 && Math.abs(fast.events[0].f - runEntry.events[0].f) < 1e-9, 'two clips of the same length at different rates mark the same fraction');

// ------------------------------------------------------------------- Jedi Academy's own marks

const CFG = `
BOTH_RUN2 4000 26 0 40
BOTH_ATTACK_BACK 5000 29 -1 20
BOTH_MELEE1 6000 15 -1 20
BOTH_A1_T__B_ 7000 12 -1 20
BOTH_DEAD1 8000 -10 -1 20
`;
const EVENTS = `
// a comment line, and a blank one follows

UPPEREVENTS
{
\tBOTH_ATTACK_BACK     AEV_SOUNDCHAN   3 CHAN_AUTO   sound/weapons/saber/saberhup%d.wav   4 6  0
\tBOTH_ATTACK_BACK     AEV_SOUNDCHAN  14 CHAN_AUTO   sound/weapons/saber/saberhup%d.wav   4 6  0
\tBOTH_ATTACK_BACK     AEV_SOUNDCHAN  20 CHAN_AUTO   sound/weapons/saber/saberhup%d.wav   7 9  0
\tBOTH_MELEE1          AEV_SOUNDCHAN   2 CHAN_AUTO   sound/weapons/melee/swing%d.wav      1 4  0
\tBOTH_DEAD1           AEV_SOUNDCHAN   2 CHAN_AUTO   *death%d.wav                         1 3  0
\tBOTH_RUN2            AEV_SOUNDCHAN  99 CHAN_AUTO   sound/player/land1.wav               0 0  0
\tBOTH_NOSUCHANIM      AEV_SOUNDCHAN   1 CHAN_AUTO   sound/player/roll1.wav               0 0  0
\tBOTH_MELEE1          AEV_EFFECT      5 saber/saber_clash.efx *blade1 0
}
LOWEREVENTS
{
\tBOTH_RUN2            AEV_FOOTSTEP    8 footstep_heavy_r 0
\tBOTH_RUN2            AEV_FOOTSTEP   20 footstep_heavy_l 0
\tBOTH_ATTACK_BACK     AEV_FOOTSTEP   13 footstep_r 30
}
`;
const cfg = new Map(
  CFG.trim()
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .map(([name, first, count, loop, fps]) => [name, { name, first: Number(first), count: Math.abs(Number(count)), reverse: Number(count) < 0, loop: Number(loop), fps: Number(fps) }]),
);

const rows = parseAnimEvents(EVENTS);
ok(rows.length === 11 && rows.filter((r) => r.half === 'upper').length === 8, 'the two blocks split the lines into an upper and a lower half, and comments are dropped');
const swing = soundEventOf(rows[0])!;
ok(swing.type === 'sound' && swing.sound === 'sound/weapons/saber/saberhup%d.wav' && swing.range![0] === 4 && swing.range![1] === 6, 'a numbered sound keeps its pattern and the range it may draw from');
const voice = soundEventOf(rows.find((r) => r.anim === 'BOTH_DEAD1')!)!;
ok(voice.type === 'voice' && voice.voice === 'death%d' && voice.range![1] === 3, "a line starting with a star is the character's own voice set, not a file");
const foot = footEventOf(rows.find((r) => r.type === 'AEV_FOOTSTEP')!);
ok(foot.foot === 'r' && foot.heavy === true, 'a footstep line says which foot lands and whether it lands hard');

const jka = jkaClipEvents(EVENTS, cfg);
ok(jka.clips.BOTH_RUN2.lower.length === 2 && !jka.clips.BOTH_RUN2.upper, 'a run marks two footsteps in its lower half and nothing in its upper');
ok(Math.abs(jka.clips.BOTH_RUN2.lower[0].f - 8 / 26) < 1e-4, "the fraction is the frame over the animation's own frame count, which the config gives");
ok(jka.clips.BOTH_RUN2.frames === 26 && jka.clips.BOTH_RUN2.fps === 40, 'the clip carries its frame count and rate, so a reader can take the frame straight');
ok(jka.clips.BOTH_ATTACK_BACK.upper.length === 3 && jka.clips.BOTH_ATTACK_BACK.lower.length === 1, 'a back attack whooshes in the upper half while a foot lands in the lower');
ok(!jka.clips.BOTH_A1_T__B_, 'an ordinary attack marks nothing, so the swing at its start is the runtime to decide');
ok(jka.outside === 1 && !jka.clips.BOTH_RUN2.upper, "a frame past the clip's own last one is counted and left out rather than clamped");
ok(jka.unknown === 1, 'a line naming an animation the config does not list is counted and left out');
ok(Math.abs(jka.clips.BOTH_DEAD1.upper[0].f - (10 - 1 - 2) / 10) < 1e-4 && jka.clips.BOTH_DEAD1.upper[0].frame === 10 - 1 - 2, 'a clip the config plays backwards has both its frame and its fraction turned round with it, so the two cannot disagree');
ok(jka.clips.BOTH_MELEE1.upper.some((e: { type: string }) => e.type === 'effect'), 'an effect line is kept beside the sounds, marked as an effect');
ok(jka.voices.join(',') === 'death%d', 'the voice sets are listed once each');
ok(jka.sounds.has('sound/weapons/melee/swing%d.wav'), 'every sound name the events use is collected for the copy');
ok(jka.sounds.get('sound/weapons/saber/saberhup%d.wav').ranges.length === 2, 'a name written on several lines with different index ranges keeps every range, not the last one');
ok(jka.clips.BOTH_ATTACK_BACK.lower[0].chance === 30, 'a line that only plays sometimes keeps its chance');

// ---------------------------------------------------------------------------- the hilts (.sab)

const SAB = `
// a comment
single_1
{
\tname\t\t@MENUS_SINGLE_HILT1
\tsaberType\tSABER_SINGLE
\tsoundOn\t\t"sound/weapons/saber/saberon.wav"
\tsoundLoop\t"sound/weapons/saber/saberhum4.wav"
\tsoundOff\t"sound/weapons/saber/saberoff.wav"
\tsaberLength\t40
}

/* a block comment holding a
   soundLoop "sound/weapons/saber/saberhum9.wav" that must not be read */

empty
{
\tsaberType\tSABER_SINGLE
\tsoundOn\t"sound/null.wav"
\tsoundLoop\t"sound/null.wav"
\tsoundOff\t"sound/null.wav"
}

sith_sword
{
\tname\t"Glory of the Sith"
\tsaberType\tSABER_SITH_SWORD
}
`;
const hilts = parseSab(SAB);
ok(hilts.length === 3 && hilts[0].id === 'single_1', 'a .sab file is a name, a brace block and one field a line');
ok(hilts[0].fields.soundloop === 'sound/weapons/saber/saberhum4.wav', 'a field value loses its quotes and its key is found whatever its case');
ok(hilts[2].fields.name === 'Glory of the Sith', 'a quoted value may hold spaces');
ok(!hilts.some((h) => h.fields.soundloop === 'sound/weapons/saber/saberhum9.wav'), 'a field inside a block comment is not a field');

// The archives hold a name with the other extension about as often as with the one written.
const archive = new Set(['sound/weapons/saber/saberon.mp3', 'sound/weapons/saber/saberhum4.wav', 'sound/weapons/saber/saberoff.mp3', 'sound/weapons/melee/swing1.mp3', 'sound/weapons/melee/swing2.mp3', 'sound/weapons/melee/swing4.mp3']);
const fakeBase = { has: (n: string) => archive.has(n.toLowerCase()), read: (n: string) => Buffer.from(n) };
ok(resolveJkaFile(fakeBase, 'sound/weapons/saber/saberon.wav') === 'sound/weapons/saber/saberon.mp3', 'a .wav that is really an .mp3 is found under the other extension');
ok(resolveJkaFile(fakeBase, 'sound/weapons/saber/saberhum4.wav') === 'sound/weapons/saber/saberhum4.wav', 'a name that is right is taken as it is');
ok(resolveJkaFile(fakeBase, 'sound/weapons/saber/nothing.wav') === null, 'a name with no file either way is missing');
ok(eventSoundFiles(fakeBase, 'sound/weapons/melee/swing%d.wav', [[1, 3]]).length === 2, 'a numbered set takes every file of its range that the archives hold');
ok(eventSoundFiles(fakeBase, 'sound/weapons/melee/swing%d.wav', [[1, 1], [4, 4]]).length === 2, 'and a name drawn from two ranges takes both, rather than whichever line came last');
ok(eventSoundFiles(fakeBase, 'sound/weapons/melee/swing%d.wav', [[1, 2], [2, 4]]).length === 3, 'overlapping ranges are one set, each file once');
ok(eventSoundFiles(fakeBase, 'sound/weapons/saber/saberon.wav', null)[0] === 'sound/weapons/saber/saberon.mp3', 'a plain name is one file');

const sabBase = { has: fakeBase.has, read: (n: string) => (n === 'ext_data/sabers/x.sab' ? Buffer.from(SAB) : Buffer.from('')) };
const sabers = readSabers(sabBase, ['ext_data/sabers/x.sab']);
ok(sabers.single_1.loop === 'sound/weapons/saber/saberhum4.wav' && sabers.single_1.on === 'sound/weapons/saber/saberon.mp3', 'a hilt keeps the hum, the ignition and the shut-off it names, resolved to files that exist');
ok(!sabers.sith_sword, 'a hilt that names no sound is left out');
ok(!sabers.empty, "a hilt whose sounds are the engine's silence is left out");

// ------------------------------------------------------- the clip names a species pack shares

/** FORM LATT > 0000 > INFO (hierarchy, count), then one ANIM form per logical name. */
const pxat = (file: string) => form('PXAT', form('0000', chunk('INFO', new W().str(file).bytes())));
const spat = (...branches: ReturnType<typeof form>[]) => form('SPAT', form('0000', ...branches));
const anim = (name: string, template: ReturnType<typeof form>) => form('ANIM', chunk('INFO', new W().str(name).bytes()), template);
const lat = form(
  'LATT',
  form('0000', chunk('INFO', new W().str('appearance/skeleton/all_b.skt').i16(2).bytes()), anim('loop_standing', spat(pxat('appearance/animation/a_run.ans'), pxat('appearance/animation/a_idle.ans'), pxat('appearance/animation/a_walk.ans'))), anim('emt_wave', pxat('appearance/animation/a_wave.ans'))),
);
const speeds: Record<string, number> = { 'appearance/animation/a_run.ans': 5.4, 'appearance/animation/a_idle.ans': 0, 'appearance/animation/a_walk.ans': 1.6 };
const named = nameLocomotion(parseLat(parseIff(buf(encode(lat)))).entries, (e: { file: string }) => ({ locomotionSpeed: speeds[e.file] ?? 0 }));
const byClip = new Map(named.map((e: { clip: string; file: string }) => [e.clip, e.file]));
ok(byClip.get('idle') === 'appearance/animation/a_idle.ans', 'the still branch of the standing loop is the idle, whatever order the table lists it in');
ok(byClip.get('walk') === 'appearance/animation/a_walk.ans' && byClip.get('run') === 'appearance/animation/a_run.ans', 'the slowest and fastest moving branches are the walk and the run');
ok(byClip.get('emt_wave') === 'appearance/animation/a_wave.ans', 'an entry that is not a locomotion loop keeps its own name');
ok(named.filter((e: { name: string }) => /:speed0$/.test(e.name)).length === 1 && named.find((e: { name: string }) => e.name === 'loop_standing:speed0')!.file === 'appearance/animation/a_idle.ans', 'the speed branches are renumbered by the speed their animation carries, so speed0 is the still one');

// ------------------------------------------- which client data a creature or a person reads

/** A template parameter chunk: the name, then a present-byte and the string. */
const strParam = (name: string, value: string) => chunk('XXXX', new Uint8Array([...[...name].map((c) => c.charCodeAt(0)), 0, 1, ...[...value].map((c) => c.charCodeAt(0)), 0]));
const template = (type: string, base: string | null, params: ReturnType<typeof strParam>[]) =>
  form(type, ...(base ? [form('DERV', chunk('XXXX', new W().str(base).bytes()))] : []), form('0000', chunk('PCNT', new W().i32(0).bytes())), form('SHOT', form('0010', chunk('PCNT', new W().i32(params.length).bytes()), ...params)));
const cldf = form('CLDF', form('0000', chunk('CSND', new W().str('footstep').str('sound/fs_out_sand.snd').bytes())));

const files = new Map<string, Buffer>([
  ['object/mobile/shared_acklay.iff', buf(encode(template('SCOT', null, [strParam('clientDataFile', 'clientdata/creature/client_shared_cr_acklay.cdf')])))],
  // A creature whose own template names nothing and whose base does.
  ['object/mobile/shared_acklay_young.iff', buf(encode(template('SCOT', 'object/mobile/shared_acklay.iff', [])))],
  // A creature naming a path with no file behind it, where exactly one file of that name is
  // in the tree under another folder.
  ['object/mobile/shared_bol.iff', buf(encode(template('SCOT', null, [strParam('clientDataFile', 'clientdata/client_shared_cr_bol.cdf')])))],
  // One naming a file that is nowhere, and one naming none at all.
  ['object/mobile/shared_ghost.iff', buf(encode(template('SCOT', null, [strParam('clientDataFile', 'clientdata/creature/client_shared_cr_ghost.cdf')])))],
  ['object/mobile/shared_ackbar.iff', buf(encode(template('SCOT', null, [])))],
  ['clientdata/creature/client_shared_cr_acklay.cdf', buf(encode(cldf))],
  ['clientdata/creature/client_shared_cr_bol.cdf', buf(encode(cldf))],
  ['object/creature/player/shared_human_male.iff', buf(encode(template('SCOT', null, [strParam('clientDataFile', 'clientdata/player/client_shared_player_human_m.cdf'), strParam('appearanceFilename', 'appearance/hum_m.sat')])))],
  // The Bothans have no footstep map of their own; their chain ends at the human's.
  ['object/creature/player/shared_bothan_male.iff', buf(encode(template('SCOT', 'object/creature/player/shared_human_male.iff', [strParam('appearanceFilename', 'appearance/bth_m.sat')])))],
  ['clientdata/player/client_shared_player_human_m.cdf', buf(encode(cldf))],
]);
const vfs = {
  has: (p: string) => files.has(p.toLowerCase()),
  read: (p: string) => files.get(p.toLowerCase())!,
  list: (prefix: string) => [...files.keys()].filter((k) => k.startsWith(prefix)),
};
const mobiles = readMobileClientData(vfs);
ok(mobiles['object/mobile/shared_acklay.iff'] === 'clientdata/creature/client_shared_cr_acklay.cdf', 'a mobile template joins the client data file it names');
ok(mobiles['object/mobile/shared_acklay_young.iff'] === 'clientdata/creature/client_shared_cr_acklay.cdf', 'a template naming none takes the first one up its chain, as the client does');
ok(mobiles['object/mobile/shared_bol.iff'] === 'clientdata/creature/client_shared_cr_bol.cdf', 'a path with no file behind it takes the one file of that name elsewhere in the tree');
ok(!('object/mobile/shared_ghost.iff' in mobiles) && !('object/mobile/shared_ackbar.iff' in mobiles), 'a template naming a file that is nowhere, or naming none, joins nothing');
const narrowed = readMobileClientData(vfs, { keep: (f: string) => f.includes('acklay') });
ok(Object.keys(narrowed).length === 2, 'the map is narrowed to the client data the bank holds, so nothing is written that could not be looked up');

const species = readSpeciesClientData(vfs);
ok(species.human_male.clientData === 'clientdata/player/client_shared_player_human_m.cdf' && species.human_male.appearance === 'appearance/hum_m.sat', "a species joins its own footstep map and its body's appearance");
ok(species.bothan_male.clientData === 'clientdata/player/client_shared_player_human_m.cdf', "a species with no map of its own takes the one its chain names, rather than one guessed from its name");
ok(species.bothan_male.appearance === 'appearance/bth_m.sat', 'and keeps its own body all the same');

// ------------------------------------------------------------------------------------- status

const packOf = (clips: string[]) => () => ({ clips });
const good = {
  format: CLIP_EVENTS_FORMAT,
  counts: { animations: 8351, marked: 3308, kept: 2517, events: 21728 },
  clips: { 'appearance/animation/a_run.ans': { frames: 22, fps: 30, events: [] } },
  species: { tables: { 'appearance/lat/all_m.lat': { run: 'appearance/animation/a_run.ans', idle: 'appearance/animation/a_idle.ans' } }, species: { human_male: { table: 'appearance/lat/all_m.lat' } } },
  mobiles: { 'object/mobile/shared_x.iff': 'clientdata/creature/client_shared_x.cdf' },
  jka: { clips: { BOTH_RUN2: {} }, voices: [] },
};
const readOf = (data: unknown) => () => data;
ok(clipEventStatus('out', readOf(null)).need !== null, 'no clip events at all is a gap, and status says what it costs');
const fine = clipEventStatus('out', readOf(good), { packs: packOf(['run', 'idle', 'BOTH_RUN2']) });
ok(fine.need === null && fine.line.includes('5043 animations mark none') && fine.line.includes('791 only shots'), 'a full set needs nothing, and the line tells an animation that marks nothing from one that marks only shots');
const drifted = clipEventStatus('out', readOf(good), { packs: packOf(['run', 'idle', 'sprint']) });
ok(drifted.need !== null && drifted.need.includes('sprint'), "a species pack holding a clip the stored table does not names the clip rather than going silent");
// Which way this drift can point, which the first version of both this check and this test had
// backwards. The stored table is the archives as they were when `sounds` last ran, so a pack
// carrying a name it has not got is a pack that is NEWER -- and a pack that is older cannot drift
// at all, since it simply holds fewer names. Asking for the species was therefore an ask no run
// could ever satisfy: `status` printed it again after every one, for ever.
ok(drifted.species === undefined, 'and does not ask for the species, which is the one step that cannot mend it');
ok(/sounds/i.test(drifted.need!) && /cannot mend/i.test(drifted.need!), 'it names the sounds pack as the old one and says plainly that reconverting the species will not help');
{
  // The other direction, to prove it is not a signal: a pack holding fewer names than the table is
  // every pack in the game, since the curated list is a fraction of the table's own.
  const older = clipEventStatus('out', readOf(good), { packs: packOf(['run']) });
  ok(older.need === null && older.species === undefined, 'a pack carrying fewer names than the table is not drift and is never asked about');
}
const branched = { ...good, species: { ...good.species, tables: { 'appearance/lat/all_m.lat': { ...good.species.tables['appearance/lat/all_m.lat'], 'loop_combat_standing:speed1': 'appearance/animation/a_cs.ans' } } } };
const branches = clipEventStatus('out', readOf(branched), { packs: packOf(['run', 'idle', 'loop_combat_standing:speed1', 'idle:happy']) });
ok(branches.need === null && branches.species === undefined, "a branch the table keys whole, and a mood the table knows by its logical name, are neither of them drift");
const noJka = clipEventStatus('out', readOf({ ...good, jka: undefined }), { packs: packOf(['run']) });
ok(noJka.need !== null && noJka.need.includes('--jka'), 'with no Jedi Academy half, status asks for it by the option that brings it');
const older = clipEventStatus('out', readOf({ ...good, format: 0 }), { packs: packOf(['run']) });
ok(older.need !== null && /older converter/.test(older.need), 'a file from an older converter is asked for again');

// --------------------------------- the frame counts the events were written against, checked

const played = { BOTH_WALK_DUAL: { loop: true, fps: 20, frames: 14 }, BOTH_RUN2: { loop: true, fps: 40, frames: 26 }, BOTH_NOTHERE: { frames: 9 } };
const agree = checkPlayedFrames({ BOTH_RUN2: { frames: 26 }, BOTH_ATTACK_BACK: { frames: 29 } }, played);
ok(agree.checked === 1 && agree.differ.length === 0, 'a clip the player rig does not carry is not checked, and one it does and agrees with is not a difference');
const clash = checkPlayedFrames({ BOTH_WALK_DUAL: { frames: 26 } }, played);
ok(clash.differ.length === 1 && clash.differ[0].config === 26 && clash.differ[0].played === 14, "a clip marked against a frame count the player rig does not play is named with both numbers, which is what a mod's animation config does to the walks");

const byJson: Record<string, unknown> = {
  [join('out', 'sounds', 'jka.json')]: { format: JKA_SOUND_FORMAT, files: { a: 1 }, sabers: { single_1: {} }, clipCheck: clash },
  [join('out', 'sounds', 'clipEvents.json')]: good,
};
const jkaBad = jkaSoundStatus('out', (p: string) => byJson[p] ?? null);
ok(jkaBad.need !== null && jkaBad.need.includes('BOTH_WALK_DUAL') && jkaBad.line.includes('BOTH_WALK_DUAL'), 'status names the clash rather than letting a footstep land a quarter of a walk out');
const jkaGone = jkaSoundStatus('out', (p: string) => (p === join('out', 'sounds', 'clipEvents.json') ? good : null));
ok(jkaGone.need !== null && jkaGone.need.includes('--jka'), 'and with the clips there but no sound files at all it asks for them, rather than saying nothing');
ok(jkaSoundStatus('out', () => null).line === null, 'with neither, it stays quiet: nothing was ever asked of Jedi Academy');

console.log(`\n${checks} checks passed`);
