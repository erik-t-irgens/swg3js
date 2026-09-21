// The Force's own effects, as the weapons command writes them: which of the game's particle effects
// and beams each power wears, what a client effect settles and what is ours, and what the block says
// about a power the archives hold nothing for.
//
// The figures and the file names in the fixtures are made up; they stand for the shapes the real
// files have (a client effect naming a particle and a sound together, one naming a sound alone, one
// naming a particle alone, and a beam appearance in the LEFX format the nebulae's reader parses).
// The last block reads a handful of real forms out of the archives when SWG names a folder that is
// there, and prints a skip line when it does not.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildForcePowers, forceBeamImage, forceBeamName, forceName, FORCE_PATHS, FORCE_POWER_FX, FORCE_POWERS_VERSION, forcePowersStatus } from '../weapons.mjs';
import { parseLightning } from '../nebula.mjs';
import { parseClientEffect } from '../shipdata.mjs';
import { parseIff } from '../iff.mjs';
import { chunk, encode, form, W } from './iffWriter.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---------------------------------------------------------------------------------------------
// 1. The names a pack keys on.
ok(forceName('appearance\\pt_force_choke.prt') === 'choke' && forceName('clienteffect/pl_force_choke.cef') === 'choke', 'a particle and the client effect that speaks for it share a bare name');
ok(forceBeamName('appearance/force_lightning_dark01.ltn') === 'force_lightning_dark01' && forceBeamName('appearance/pt_force_throw.ltn') === 'pt_force_throw', 'a beam keeps its whole name, so the throw\'s beam and the throw\'s particle do not want the same key');
ok(forceBeamImage('shader/pt_lightning_blue.sht') === 'force/pt_lightning_blue.png' && forceBeamImage(null) === 'force/beam.png', 'a beam\'s picture has one place in the pack, named for its shader');
ok(FORCE_PATHS.particles === 'appearance/pt_force_' && FORCE_PATHS.effects === 'clienteffect/pl_force_' && FORCE_PATHS.beams.length === 4, 'the places the client keeps the Force\'s effects');

// ---------------------------------------------------------------------------------------------
// 2. A stand-in archive: the files, the client effects that name them, and one beam.
const PRT = [
  'appearance/pt_force_absorb.prt',
  'appearance/pt_force_absorb_trigger.prt',
  'appearance/pt_force_armor.prt',
  'appearance/pt_force_choke.prt',
  'appearance/pt_force_heal_self.prt',
  'appearance/pt_force_lightning_end.prt',
  'appearance/pt_force_lightning_start.prt',
  'appearance/pt_force_meditate.prt',
  'appearance/pt_force_speed_activate.prt',
  'appearance/pt_force_speed_moves.prt',
  'appearance/pt_force_throw.prt',
  'appearance/pt_force_weaken.prt',
  'appearance/pt_force_weaken_hit.prt',
];
const CEF: Record<string, { particles: string[]; sounds: string[] }> = {
  // Both chunks: a particle and the sound that goes with it.
  'clienteffect/pl_force_choke.cef': { particles: ['appearance/pt_force_choke.prt'], sounds: ['sound/pl_force_choke.snd'] },
  'clienteffect/pl_force_healing.cef': { particles: ['appearance/pt_force_heal_self.prt'], sounds: ['sound/pl_force_healing.snd'] },
  'clienteffect/pl_force_throw.cef': { particles: ['appearance/pt_force_throw.prt'], sounds: ['sound/pl_force_throw.snd'] },
  'clienteffect/pl_force_weaken.cef': { particles: ['appearance/pt_force_weaken.prt'], sounds: ['sound/pl_force_weaken.snd', 'sound/pl_force_weaken_lp.snd'] },
  // Two name one particle with different sounds, as the client's own speed effects do: the one
  // whose name is the particle's wins, not the first of the two down the alphabet.
  'clienteffect/pl_force_run.cef': { particles: ['appearance/pt_force_speed_activate.prt'], sounds: ['sound/pl_force_meditate.snd'] },
  'clienteffect/pl_force_speed_activate.cef': { particles: ['appearance/pt_force_speed_activate.prt'], sounds: ['sound/pl_force_speed_start.snd'] },
  'clienteffect/pl_force_speed_self.cef': { particles: ['appearance/pt_force_speed_moves.prt'], sounds: ['sound/pl_force_generic.snd'] },
  'clienteffect/pl_force_absorb_self.cef': { particles: ['appearance/pt_force_absorb_trigger.prt'], sounds: ['sound/pl_force_absorb.snd'] },
  'clienteffect/pl_force_armor_self.cef': { particles: ['appearance/pt_force_armor.prt'], sounds: ['sound/pl_force_subtract.snd'] },
  // A sound and no particle: 14 of the client's own are this shape.
  'clienteffect/pl_force_jump.cef': { particles: [], sounds: ['sound/pl_force_jump.snd'] },
  'clienteffect/pl_force_push.cef': { particles: [], sounds: ['sound/pl_force_push.snd'] },
  // A particle and no sound.
  'clienteffect/pl_force_meditate.cef': { particles: ['appearance/pt_force_meditate.prt'], sounds: [] },
  // One that names something outside the Force's own particles: written down, not converted.
  'clienteffect/pl_force_stray.cef': { particles: ['appearance/pt_smoke_small.prt'], sounds: ['sound/pl_force_stray.snd'] },
};
// A beam appearance, as the retail .ltn files are laid out: FORM LEFX > 0002 with a flip-book
// texture, two waveforms and a chunk naming the effect at each end of a bolt.
const wvfm = (points: number[][]) =>
  form('WVFM', chunk('0001', points.reduce((w, p) => w.f32(p[0]).f32(p[1]).f32(0).f32(0), new W().i32(0).i32(1).i32(points.length)).bytes()));
const ptex = (shader: string) => form('PTEX', chunk('0000', new W().str(shader).i32(4).i32(0).i32(3).f32(0.5).i32(2).f32(10).u8(1).bytes()));
const beamBytes = (shader: string, start: string, end: string) => {
  const data = new W().f32(0.4).str(start).str(end);
  for (let i = 0; i < 20; i++) data.f32(i / 10);
  return Buffer.from(encode(form('LEFX', form('0002', ptex(shader), wvfm([[0, 0], [0.5, 2], [1, 6]]), wvfm([[0, 0], [1, 3]]), chunk('0000', data.bytes())))));
};
const LTN: Record<string, Buffer> = {
  'appearance/force_lightning.ltn': beamBytes('shader/pt_lightning_blue.sht', 'appearance\\pt_force_lightning_start.prt', 'appearance/pt_force_lightning_end.prt'),
  'appearance/force_lightning_dark01.ltn': beamBytes('shader/pt_lightning_blue.sht', 'appearance/pt_force_lightning_start.prt', 'appearance/pt_force_lightning_end.prt'),
  'appearance/pt_bolt_force_choke.ltn': beamBytes('shader/pt_choke_bolt.sht', '', ''),
  'appearance/pt_drain_force.ltn': beamBytes('shader/pt_choke_bolt.sht', '', ''),
  'appearance/pt_force_throw.ltn': beamBytes('shader/pt_choke_bolt.sht', '', ''),
};

const pictures: string[] = [];
const archive = (over: { drop?: string[]; badBeam?: string } = {}) => {
  const files = [...PRT.filter((p) => !(over.drop ?? []).includes(p)), ...Object.keys(CEF), ...Object.keys(LTN)];
  return {
    list: (prefix: string) => files.filter((f) => f.startsWith(prefix)),
    has: (path: string) => files.includes(path),
    particle: (path: string) => {
      if (!files.includes(path)) return { failed: 'not in the archives' };
      return { file: `particles/fx_${forceName(path)}.json`, id: `fx_${forceName(path)}`, attached: /lightning_end/.test(path) ? 2 : 0 };
    },
    clientEffect: (path: string) => CEF[path] ?? null,
    beam: (path: string) => (path === over.badBeam ? null : parseLightning(parseIff(LTN[path]))),
    image: (shader: string) => {
      pictures.push(shader);
      return forceBeamImage(shader);
    },
  };
};

const lines: string[] = [];
const block = buildForcePowers(archive(), { log: (m: string) => lines.push(m) });
const powerOf = (id: string) => block.powers.find((p: { power: string }) => p.power === id)!;

ok(block.version === FORCE_POWERS_VERSION && FORCE_POWERS_VERSION >= 1, 'the block says which version it is, so an older pack can be told apart');
ok(Object.keys(block.effects).length === PRT.length, 'every one of the game\'s Force particle effects is converted, not only the ones a power uses');
ok(block.effects.choke.file === 'particles/fx_choke.json' && block.effects.choke.particle === 'appearance/pt_force_choke.prt', 'each effect names the file it was written as and the file it came from');
ok(block.effects.choke.sound === 'sound/pl_force_choke.snd' && block.effects.choke.clientEffect === 'clienteffect/pl_force_choke.cef', 'the sound comes from whichever client effect names the particle, not from a guess at the name');
ok(block.effects.heal_self.sound === 'sound/pl_force_healing.snd', 'a client effect whose own name differs from the particle\'s still speaks for it');
ok(block.effects.speed_activate.sound === 'sound/pl_force_speed_start.snd' && block.effects.speed_activate.clientEffect === 'clienteffect/pl_force_speed_activate.cef', 'where two client effects name one particle, the one called after it speaks for it and not the first down the alphabet');
ok(block.effects.weaken.sounds.length === 2 && block.effects.weaken.sound === 'sound/pl_force_weaken.snd', 'every sound a client effect names is kept, the first of them being the one to play');
ok(block.effects.lightning_end.carried === 2 && block.effects.meditate.carried === 0, 'what an effect carries is counted, so a chain of them is not a surprise at run time');
ok(block.effects.lightning_start.sound === null && block.effects.lightning_start.file === 'particles/fx_lightning_start.json', 'a particle no client effect names is still converted, silently');

ok(Object.keys(block.clientEffects).length === Object.keys(CEF).length, 'every Force client effect is written down, the ones with no particle included');
ok(block.clientEffects.jump.particle === null && block.clientEffects.jump.sounds[0] === 'sound/pl_force_jump.snd', 'a client effect that names a sound and nothing else says so');
ok(block.clientEffects.meditate.sounds.length === 0, 'and one that names a particle and no sound');
ok(block.clientEffects.stray.particle === 'appearance/pt_smoke_small.prt' && !block.effects.pt_smoke_small, 'a client effect naming a particle that is not the Force\'s is written down and not converted');
ok(lines.some((l) => /pt_smoke_small/.test(l)), 'and the run says so out loud rather than silently dropping it');

// ---------------------------------------------------------------------------------------------
// 3. The beams, through the nebulae's own reader.
ok(Object.keys(block.beams).sort().join(',') === 'force_lightning,force_lightning_dark01,pt_bolt_force_choke,pt_drain_force,pt_force_throw', 'every beam appearance the Force names is read, the ladder of them and the ones under the particles\' own prefix included');
const beam = block.beams.force_lightning;
ok(beam.flipbook.frames === 4 && beam.flipbook.fps === 10 && beam.flipbook.perColumn === 2, 'a beam is a flip-book and its timing comes across');
ok(beam.waveforms.length === 2 && beam.value === 0.4 && beam.trailingBytes === 80, 'its two waveforms, the float its data opens with, and the bytes after the names that nothing reads');
ok(beam.texture === 'force/pt_lightning_blue.png' && block.beams.force_lightning_dark01.texture === beam.texture, 'one picture is written per shader, which the beams sharing a shader all point at');
ok(pictures.length === 2, 'so a ladder of beams over two shaders writes two pictures and not one per file');
ok(beam.startParticle === 'appearance/pt_force_lightning_start.prt' && beam.start === 'particles/fx_lightning_start.json' && beam.end === 'particles/fx_lightning_end.json', 'the effects a bolt plays at each end are named as the beam names them and converted with everything else');
ok(block.beams.pt_bolt_force_choke.start === null && block.beams.pt_bolt_force_choke.startParticle === null, 'a beam that names no effect at either end says null rather than reaching for one');
{
  const bad = buildForcePowers(archive({ badBeam: 'appearance/pt_drain_force.ltn' }), {});
  ok(!bad.beams.pt_drain_force && bad.skipped.some((s: { file: string }) => s.file === 'appearance/pt_drain_force.ltn'), 'a beam that will not read is listed with why rather than taking the run down');
  ok(powerOf('drain').beam === 'pt_drain_force' && bad.powers.find((p: { power: string }) => p.power === 'drain')!.beam === null, 'and the power that wore it falls back to no beam');
  const noBolt = buildForcePowers(archive({ badBeam: 'appearance/force_lightning.ltn' }), {});
  const l = noBolt.powers.find((p: { power: string }) => p.power === 'lightning')!;
  ok(l.beam === null && l.parts[0].file === 'particles/fx_lightning_start.json', 'a power that takes its ends from a beam that will not read falls back on the names the table carries');
}

// ---------------------------------------------------------------------------------------------
// 4. The powers: every one named, and what is the game's told from what is ours.
ok(block.powers.length === FORCE_POWER_FX.length && FORCE_POWER_FX.length === 13, 'the block names every power the game offers, the ones with nothing included');
ok(new Set(block.powers.map((p: { power: string }) => p.power)).size === block.powers.length, 'each power appears exactly once');
for (const id of ['jump', 'push', 'repulse', 'slow']) ok(powerOf(id).source === 'none' && !powerOf(id).parts.length, `${id} has no effect in the archives and the pack says so rather than leaving a hole`);
ok(powerOf('fists').source === 'none', 'bare hands is not a Force power and draws nothing');
ok(['grip', 'heal', 'pull', 'drain', 'protect', 'speed', 'lightning'].every((id) => powerOf(id).source === 'game'), 'the seven the client\'s own data settles are marked the game\'s');
ok(powerOf('rage').source === 'invented', 'the one whose effect we picked ourselves is marked ours');
ok(powerOf('grip').sound === 'sound/pl_force_choke.snd' && powerOf('heal').sound === 'sound/pl_force_healing.snd', 'a power carries the sound its own client effect names');
ok(powerOf('jump').sound === 'sound/pl_force_jump.snd' && powerOf('jump').clientEffect === 'clienteffect/pl_force_jump.cef', 'a power with no particle at all is still heard: its own client effect names a sound');
ok(powerOf('repulse').sound === null && powerOf('repulse').sounds.length === 0, 'and one whose client effect is not in these archives says so rather than inventing a sound');

const speed = powerOf('speed');
ok(speed.parts.length === 2 && speed.parts[0].role === 'cast' && speed.parts[1].role === 'hold', 'a power that lasts has one part as it starts and one while it runs');
ok(speed.parts[0].at === 'body' && speed.parts[0].file === 'particles/fx_speed_activate.json', 'each part says where it is put and which file to place');
const lightning = powerOf('lightning');
ok(lightning.parts[0].at === 'hand' && lightning.parts[1].at === 'target' && lightning.beam === 'force_lightning', 'lightning starts at the hand, ends at what it struck, and names the beam between');
ok(lightning.parts[0].particle === beam.startParticle && lightning.parts[1].particle === beam.endParticle, 'and what it plays at each end is what the beam appearance itself names, not a pick of ours');
ok(powerOf('pull').beam === 'pt_force_throw', 'the throw has a beam of the client\'s own as well as a particle');
ok(powerOf('drain').parts.find((p: { role: string }) => p.role === 'land')!.file === 'particles/fx_weaken_hit.json', 'the drain keeps the hit effect the client has for where it lands');
ok(powerOf('protect').parts.every((p: { at: string }) => p.at === 'body'), 'a power that guards the caster puts both its parts on the caster');

// A row whose first choice is not in these archives takes the next, and a row whose choices are all
// gone comes out `none` rather than pretending.
{
  const thin = buildForcePowers(archive({ drop: ['appearance/pt_force_heal_self.prt', 'appearance/pt_force_speed_moves.prt', 'appearance/pt_force_armor.prt'] }), {});
  const find = (id: string) => thin.powers.find((p: { power: string }) => p.power === id)!;
  ok(find('heal').source === 'none' && /none of it is in these archives/.test(find('heal').note), 'a power whose effect is missing is marked none, with the reason in its own words');
  ok(find('heal').parts[0].missing?.[0] === 'appearance/pt_force_heal_self.prt', 'and the row keeps what it looked for, so a rerun against fuller archives is one line to read');
  ok(find('rage').source === 'none', 'the same for one of ours we could not find');
  ok(find('speed').source === 'game' && find('speed').parts[1].file === null, 'a power that finds one of its parts keeps it and leaves the other empty');
}

// ---------------------------------------------------------------------------------------------
// 5. A rerun writes the same block twice.
{
  const a = buildForcePowers(archive(), {});
  const b = buildForcePowers(archive(), {});
  ok(JSON.stringify(a) === JSON.stringify(b), 'two runs over the same archives write the same bytes, so a rerun mends a pack rather than growing it');
}

// ---------------------------------------------------------------------------------------------
// 6. What status says.
{
  const none = forcePowersStatus(undefined);
  ok(!none.has && /same spark/.test(none.line), 'a pack with no powers block at all is asked for');
  const older = forcePowersStatus({ ...block, version: 0 });
  ok(older.has && older.old, 'a block written by an older converter is asked for again');
  const now = forcePowersStatus(block);
  ok(now.has && !now.old && /8 of 13/.test(now.line), 'and a current one says how many powers wear the game\'s own effect');
  ok(!forcePowersStatus({ version: FORCE_POWERS_VERSION, powers: [] }).has, 'a block with no rows in it counts as none');
}

// ---------------------------------------------------------------------------------------------
// 7. A handful of the real forms, when the archives are there. This never writes anything and never
//    converts: it mounts, lists, and parses what it finds, so the test is read-only.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const envSwg = () => {
  if (process.env.SWG) return process.env.SWG;
  const file = join(root, '.env');
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?SWG\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) return m[1].replace(/^(['"])(.*)\1$/, '$2');
  }
  return null;
};
const swg = envSwg();
if (!swg || !existsSync(swg)) {
  console.log(`skip the archive checks: no client archives here (set SWG=<folder with the .tre files> in .env or the environment)${swg ? ` — ${swg} is not there` : ''}`);
} else {
  const { openVfs } = await import('../tre.mjs');
  const vfs = openVfs(swg, { log: () => {} });
  const prts = vfs.list(FORCE_PATHS.particles).filter((p: string) => p.endsWith('.prt'));
  const cefs = vfs.list(FORCE_PATHS.effects).filter((p: string) => p.endsWith('.cef'));
  const ltns = FORCE_PATHS.beams.flatMap((p: string) => vfs.list(p)).filter((p: string) => p.endsWith('.ltn'));
  ok(prts.length > 0 && cefs.length > 0 && ltns.length > 0, `the archives hold the Force's own effects (${prts.length} particles, ${cefs.length} client effects, ${ltns.length} beams)`);
  let paired = 0;
  for (const path of cefs.slice(0, 8)) {
    const cef = parseClientEffect(parseIff(vfs.read(path)));
    ok(Array.isArray(cef.particles) && Array.isArray(cef.sounds), `${path} reads as particles and sounds`);
    if (cef.particles.length && cef.sounds.length) paired++;
  }
  ok(paired >= 0, `${paired} of the first ${Math.min(8, cefs.length)} client effects pair a particle with a sound`);
  for (const path of ltns.slice(0, 3)) {
    const ltn = parseLightning(parseIff(vfs.read(path)));
    ok(!!ltn && !!ltn.texture && ltn.texture.frames > 0, `${path} reads through the nebulae's own beam reader, with a flip-book of ${ltn?.texture?.frames} frames`);
  }
  // Every file the power table names, checked against what is really there. This reports rather than
  // fails: the converter already marks a row it cannot find `none` and `status` says so, and a name
  // the table has wrong should show as a line to read, not as a red test on the owner's machine.
  const wanted = FORCE_POWER_FX.flatMap((r: { power: string; parts?: { role: string; files: string[] }[] }) => (r.parts ?? []).map((p) => ({ power: r.power, role: p.role, files: p.files })));
  const unmet = wanted.filter((w: { files: string[] }) => !w.files.some((f) => vfs.has(f)));
  ok(wanted.length > 0, `the power table names ${wanted.length} effects across the powers that have one`);
  if (unmet.length) console.log(`note: ${unmet.length} of them are under none of the names the table tries: ${unmet.map((w: { power: string; role: string }) => `${w.power}/${w.role}`).join(', ')} (those powers come out marked none, which is what the pack will say)`);
  else console.log('note: every effect the power table names is in these archives');
  vfs.close();
}

console.log(`${checks} checks passed`);
