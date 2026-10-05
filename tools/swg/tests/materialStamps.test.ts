// What tells a pack converted before material format 6 from one converted after (the materials pass, wave 1).
//
// `player`, `parts` and `species` stamped nothing on what they wrote, which is the hole that kept the saber
// clips and the aimed blaster poses unconverted on an install for months: nothing would ever have asked
// for them again. So `status` now reads a stamp on every command that writes materials -- the creatures,
// the player's entry, every parts.json and the species index, each space zone and the sandbox, the spawns'
// manifest and each world's travel file -- and for the three that never had one also a thing only the new
// conversion makes, read off the model itself: a textured material carrying `extras.swgSpec`. These run
// `status` on folders made here (never on assets-private) and read what it asks for; a parts.json that
// `clips-apply` rewrites keeps its stamp; the mobiles units are signed with the format; and the two commands
// that kept a model because its file was there (travel's terminals, the spawns' nests) convert it again when
// the record they wrote last time stands for an older format, or the stamp would be written over old models.
//
// Run: node tools/swg/tests/materialStamps.test.ts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packClips } from '../clipbundle.mjs';
import { buildGlb, glbSpecStamped } from '../glb.mjs';
import { extractClips, replaceClips, writeGlb } from '../glbclips.mjs';
import { readGlb } from '../glbclips.mjs';
import { sandboxPack, sandboxStatus } from '../sandbox.mjs';
import { SPAWNS_FORMAT, nestModels } from '../spawnpack.mjs';
import { MATERIAL_FORMAT, materialStale } from '../surface.mjs';
import { travelModelsToConvert } from '../travel.mjs';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const onePx = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5690000000049454e44ae426082', 'hex');

/** A one-triangle model under one textured material, written by the converter's own writer: with the format-6 fields, or as a pack from before. */
function model(stamped: boolean): Buffer {
  const entry = { path: 'texture/body.dds', png: onePx, ...(stamped ? { spec: { mode: 'phong', color: [0.5, 0.5, 0.5], power: 20, mask: 'MAIN.a' }, cube: false } : {}) };
  const tri = { positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0), normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1), uvs: Float32Array.of(0, 0, 1, 0, 0, 1), indices: Uint16Array.of(0, 1, 2) };
  return buildGlb([{ name: 'body', groups: [{ shader: 'shader/body.sht', primitives: [tri] }] }], { textures: new Map([['shader/body.sht', entry]]) });
}

{
  ok(glbSpecStamped(readGlb(model(true)).json) === true && glbSpecStamped(readGlb(model(false)).json) === false, 'a model written at format 6 says so on its textured material, and one from before does not');
  const untextured = buildGlb([{ name: 'm', groups: [{ shader: 'shader/x.sht', primitives: [{ positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0), normals: null, uvs: null, indices: Uint16Array.of(0, 1, 2) }] }] }], { textures: new Map() });
  ok(glbSpecStamped(readGlb(untextured).json) === null, 'and a model with no textured material says nothing either way, so the next one listed is asked');
}

/** What `status --json` asks for on a folder: each step's command and every reason given for it. */
function asked(dir: string): { command: string; reasons: string[] }[] {
  const run = spawnSync(process.execPath, [cli, 'status', dir, '--json'], { encoding: 'utf8', maxBuffer: 64 * 1048576 });
  return JSON.parse(run.stdout).steps;
}
const askedFor = (steps: { command: string; reasons: string[] }[], command: string) => steps.filter((s) => s.command === command).some((s) => s.reasons.some((r) => r.includes(`material format ${MATERIAL_FORMAT}`)));

const dir = mkdtempSync(join(tmpdir(), 'swg3js-material-stamps-'));
try {
  const write = (rel: string, data: string | Buffer) => {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), data);
  };
  const json = (rel: string, v: unknown) => write(rel, JSON.stringify(v));
  const player = (extra: object) => ({ players: [{ id: 'human_male', file: 'player/human_male.glb', template: 'object/creature/player/shared_human_male.iff', wear: ['shirt'], clips: ['loop_swim'], moods: false, ...extra }] });
  const parts = (extra: object) => ({ id: 'human_male', parts: [{ name: 'body', file: 'body.glb' }], clips: ['walk', 'run', 'idle'], moods: false, ...extra });
  const index = (extra: object) => ({ species: [{ id: 'human_male', morphs: [], variables: [], jkaClips: 0 }], ...extra });
  const zone = (extra: object) => ({ version: 3, zone: 'space_tatooine', title: 'Tatoo System', stations: [], planets: [], arrival: { kind: 'launch' }, hyperspace: { points: [] }, ...extra });

  // Every pack from before: no stamp anywhere, and models with no format-6 field.
  json('creatures/manifest.json', { creatures: [] });
  json('player/manifest.json', player({}));
  write('player/human_male.glb', model(false));
  json('characters/human_male/parts.json', parts({}));
  write('characters/human_male/body.glb', model(false));
  json('characters/index.json', index({}));
  json('space_tatooine/space.json', zone({}));
  let steps = asked(dir);
  for (const command of ['creatures', 'player', 'parts', 'species', 'space']) ok(askedFor(steps, command), `with no stamp, status asks for ${command} again for the material format`);

  // Stamped, but the models are still the old ones: the named product decides for the three that never had a stamp.
  json('player/manifest.json', player({ materialFormat: MATERIAL_FORMAT }));
  json('characters/human_male/parts.json', parts({ materialFormat: MATERIAL_FORMAT }));
  json('characters/index.json', index({ materialFormat: MATERIAL_FORMAT }));
  steps = asked(dir);
  for (const command of ['player', 'parts', 'species']) ok(askedFor(steps, command), `a ${command} stamp over models with no format-6 field is still asked for: the model itself is read`);

  // Stamped, and the models carry the fields: nothing about the materials is asked for.
  json('creatures/manifest.json', { materialFormat: MATERIAL_FORMAT, creatures: [] });
  write('player/human_male.glb', model(true));
  write('characters/human_male/body.glb', model(true));
  json('space_tatooine/space.json', zone({ materialFormat: MATERIAL_FORMAT }));
  steps = asked(dir);
  for (const command of ['creatures', 'player', 'parts', 'species', 'space']) ok(!askedFor(steps, command), `stamped and made at format ${MATERIAL_FORMAT}, ${command} is not asked for the material format`);

  // An older stamp is as old as none.
  json('creatures/manifest.json', { materialFormat: MATERIAL_FORMAT - 1, creatures: [] });
  json('characters/index.json', index({ materialFormat: MATERIAL_FORMAT - 1 }));
  steps = asked(dir);
  ok(askedFor(steps, 'creatures') && askedFor(steps, 'species'), 'and an older stamp is asked for as an absent one is');

  // The mobiles catalogue: planned before the format, its units still match the signatures it holds, so only
  // the catalogue's own stamp can say a run would find them stale.
  const catalogue = (extra: object) => ({ format: 1, options: { source: { retailOnly: true, archives: 1, key: 'k' } }, appearances: {}, packs: {}, wearables: {}, wardrobes: {}, entries: [], failed: [], ...extra });
  json('mobiles/catalogue.json', catalogue({}));
  ok(askedFor(asked(dir), 'mobiles'), 'a mobiles catalogue planned before the material format is asked for again');
  json('mobiles/catalogue.json', catalogue({ materialFormat: MATERIAL_FORMAT }));
  ok(!askedFor(asked(dir), 'mobiles'), 'and one planned at it is not');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// The sandbox is listed and never asked for, and says when its models are older.
{
  const pack = sandboxPack({ planets: [], points: [], fields: [], hyperspace: { points: [] }, skyZone: 'space_tatooine', seed: 1 });
  ok(pack.materialFormat === MATERIAL_FORMAT && !sandboxStatus(pack).stale, 'a sandbox written now is stamped and current');
  const { materialFormat: _drop, ...older } = pack;
  ok(sandboxStatus(older).stale && /material format/.test(sandboxStatus(older).line), 'and one with no stamp says its models are older');
}

// Travel and the spawns, asked for on a world and a fleet made here: a world with objects whose travel.json is
// current in every other way, and a fleet whose spawns are current in every other way, each with no stamp, then
// with one.
{
  const src = readFileSync(cli, 'utf8');
  const travelVersion = Number(/const TRAVEL_PACK_VERSION = (\d+);/.exec(src)?.[1]);
  const fleet = mkdtempSync(join(tmpdir(), 'swg3js-material-travel-'));
  try {
    const put = (rel: string, v: unknown) => {
      mkdirSync(join(fleet, rel, '..'), { recursive: true });
      writeFileSync(join(fleet, rel), JSON.stringify(v));
    };
    // A world converted at this format carries its surface counts, and one whose detail levels are old must still
    // be asked for them: the counts' tally once sat between the two asks and took the second's `else` for itself.
    put('tatooine/manifest.json', { planet: 'tatooine', materialFormat: MATERIAL_FORMAT, lodFormat: 0, surfaceCounts: { otherSets: 1, shineUnread: 2, normalSecondSet: 3 }, categories: { layout: [] } });
    put('tatooine/layout.json', { planet: 'tatooine', objects: [{ template: 'object/tangible/furniture/shared_chair.iff', x: 0, y: 0, z: 0 }] });
    put('tatooine/travel.json', { version: travelVersion, planet: 'tatooine', rows: [] });
    put('mobiles/catalogue.json', { format: 1, materialFormat: MATERIAL_FORMAT, options: { source: { retailOnly: true, archives: 1, key: 'k' } }, appearances: {}, packs: {}, wearables: {}, wardrobes: {}, entries: [], failed: [] });
    put('tatooine/spawns.json', { format: SPAWNS_FORMAT, statics: [] });
    put('spawns/manifest.json', { format: SPAWNS_FORMAT, creatures: {} });
    let steps = asked(fleet);
    ok(steps.some((s) => s.command === 'snapshot' && s.reasons.some((r) => /detail levels/.test(r))) && !askedFor(steps, 'snapshot'), "a world at this material format with its surface counts and old detail levels is asked for the snapshot for its detail levels, and not for its materials");
    ok(askedFor(steps, 'travel'), "status asks for travel again, for the material format and saying so, for a world's travel.json with no stamp");
    ok(askedFor(steps, 'spawns'), "and for the spawns when the fleet's manifest has no stamp");
    put('tatooine/travel.json', { version: travelVersion, materialFormat: MATERIAL_FORMAT - 1, planet: 'tatooine', rows: [] });
    put('spawns/manifest.json', { format: SPAWNS_FORMAT, materialFormat: MATERIAL_FORMAT - 1, creatures: {} });
    steps = asked(fleet);
    ok(askedFor(steps, 'travel') && askedFor(steps, 'spawns'), 'and for both when the stamp is older');
    put('tatooine/travel.json', { version: travelVersion, materialFormat: MATERIAL_FORMAT, planet: 'tatooine', rows: [] });
    put('spawns/manifest.json', { format: SPAWNS_FORMAT, materialFormat: MATERIAL_FORMAT, creatures: {} });
    steps = asked(fleet);
    ok(!askedFor(steps, 'travel') && !askedFor(steps, 'spawns'), 'and for neither, for the material format, once both are stamped with it');
  } finally {
    rmSync(fleet, { recursive: true, force: true });
  }
  ok(/version: TRAVEL_PACK_VERSION, materialFormat: MATERIAL_FORMAT/.test(src) && /\.\.\.\(options\.swg \? \{ materialFormat: MATERIAL_FORMAT \} : \{\}\)/.test(src), 'both write the stamp they are read for, the spawns only from a run that made its models');
  const mobiles = readFileSync(new URL('../mobiles.mjs', import.meta.url), 'utf8');
  ok((mobiles.match(/f: MOBILES_FORMAT, m: MATERIAL_FORMAT/g) ?? []).length === 3 && !/f: MOBILES_FORMAT, a: ANIM_FORMAT, m:/.test(mobiles), 'the mobiles models, their colour variants and the wearable folders are signed with the material format, and the animation packs are not');
}

// What a stamp asked for must redo: a run keeps a model because its file is there only while the record it
// wrote last time stood for the current material format. The very functions the two commands run.
{
  ok(materialStale(null) && materialStale({}) && materialStale({ materialFormat: MATERIAL_FORMAT - 1 }) && !materialStale({ materialFormat: MATERIAL_FORMAT }), 'no record, a record with no stamp and an older stamp are all older; the current one is not');

  // Travel: its own models (an appearance, no source) are converted again under an older or absent record, and a
  // world's own model of the same id (the snapshot's, with a source) never is.
  const terminal = { id: 'ksk_all_travel', file: 'ksk_all_travel.glb', appearance: 'appearance/ksk_all_travel.apt' };
  const worldsShuttle = { id: 'shuttle', file: 'shuttle.glb', source: 'object/building/shared_shuttle.iff' };
  const other = { id: 'bench', file: 'bench.glb', source: 'x' };
  const rowsName = new Set(['ksk_all_travel', 'shuttle']);
  const redo = travelModelsToConvert([other, terminal, worldsShuttle], rowsName, true);
  ok(redo.convert.map(([id]) => id).join() === 'ksk_all_travel' && !redo.layout.includes(terminal) && redo.layout.includes(worldsShuttle) && redo.layout.includes(other), "under an older record travel's own terminal is taken out and converted again, and the world's own shuttle and everything else are kept");
  const keep = travelModelsToConvert([other, terminal, worldsShuttle], rowsName, false);
  ok(keep.convert.length === 0 && keep.layout.length === 3, 'under a current one nothing already there is converted again');
  const fresh = travelModelsToConvert([other], rowsName, false);
  ok(fresh.convert.map(([id]) => id).join() === 'ksk_all_travel,shuttle', 'and a model the rows name that the world lacks is converted whatever the record says');
  ok(travelModelsToConvert([terminal], new Set(['shuttle']), true).convert.map(([id]) => id).join() === 'shuttle', 'a model no row names is neither converted nor taken out');

  // The spawns' nests: a file already on disk is converted again under an older record, one file once however
  // many templates share it, and each template keeps its own copy of what the conversion measured.
  const run = (stale: boolean, onDisk: string[]) => {
    const converted: string[] = [];
    const out = nestModels(['t/mound_a', 't/mound_b', 't/bramble', 't/broken', 't/gone'], {
      resolve: (t: string) => (t === 't/gone' ? null : { id: t === 't/bramble' ? 'bramble' : t === 't/broken' ? 'broken' : 'mound', source: `appearance/${t}.apt` }),
      exists: (id: string) => onDisk.includes(id),
      convert: (id: string) => {
        if (id === 'broken') throw new Error('will not convert');
        converted.push(id);
        return { bounds: { min: [0, 0, 0], max: [1, 1, 1] }, triangles: 12 };
      },
      stale,
    });
    return { ...out, converted };
  };
  const old = run(true, ['mound', 'bramble']);
  ok(old.converted.join() === 'mound,bramble' && old.made === 3 && old.failed === 2, 'under an older record every nest on disk is converted again, each file once, and a template that will not resolve or convert is counted as failed');
  ok(old.nests['t/mound_a'].triangles === 12 && old.nests['t/mound_b'].triangles === 12 && old.nests['t/mound_a'] !== old.nests['t/mound_b'], 'two templates sharing a file both carry what its conversion measured, each in a copy of its own');
  const current = run(false, ['mound']);
  ok(current.converted.join() === 'bramble' && current.nests['t/mound_a'].file === 'nests/mound.glb' && current.nests['t/mound_a'].triangles === undefined, 'under a current record a nest on disk is kept and only the missing one is converted');
}

// A parts.json that `clips-apply` rewrites keeps its stamp (and so would the player's, which `jka-clips` rewrites the same way).
{
  const scratch = mkdtempSync(join(tmpdir(), 'swg3js-clips-apply-'));
  try {
    const rigJson = {
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }],
      scene: 0,
      nodes: [
        { name: 'root', children: [1], rotation: [0, 0, 0, 1], translation: [0, 0, 0] },
        { name: 'spine', rotation: [0, 0, 0, 1], translation: [0, 1, 0] },
      ],
      skins: [{ joints: [0, 1] }],
      buffers: [{ byteLength: 0 }],
    };
    const clip = { name: 'BOTH_STAND1', times: Float32Array.of(0, 1 / 30), tracks: [0, 1].map(() => ({ rotations: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1), translations: Float32Array.of(0, 0, 0, 0, 0, 0) })) };
    const rig = join(scratch, 'rig.glb');
    writeFileSync(rig, writeGlb(rigJson, Buffer.alloc(0)));
    const bundle = extractClips(replaceClips(writeGlb(rigJson, Buffer.alloc(0)), [clip]));
    writeFileSync(join(scratch, 'jka.clips'), packClips({ ...bundle, meta: { jkaClips: { BOTH_STAND1: { loop: true, fps: 30, frames: 2 } }, clipSpeeds: {} } }));
    writeFileSync(join(scratch, 'parts.json'), JSON.stringify({ id: 'human_male', materialFormat: MATERIAL_FORMAT, parts: [] }));
    const run = spawnSync(process.execPath, [cli, 'clips-apply', rig, join(scratch, 'jka.clips')], { encoding: 'utf8' });
    const after = JSON.parse(readFileSync(join(scratch, 'parts.json'), 'utf8'));
    ok(run.status === 0 && after.materialFormat === MATERIAL_FORMAT && Object.keys(after.jkaClips ?? {}).includes('BOTH_STAND1'), 'clips-apply rewrites parts.json with the clips it carried and keeps its material stamp');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

console.log(`\nmaterial stamps: ${passed} checks passed`);
