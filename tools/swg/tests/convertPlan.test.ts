// The conversion's plan: where the two installs are, what order the steps go in, what may run
// beside what, and what happens to the steps behind one that failed.
//
// The to-do below is fixed: it is every command `status` can ask for, written the way `status
// --json` writes one (the folders as `@SWG` and `@JKA`, the arguments already split), so the plan
// is pinned against the converter's own list rather than against whatever this machine happens to
// be missing today. The little scheduler at the bottom is the three rules the runner applies --
// wait for what you need, never hold a lock somebody else holds, and a lone step runs alone --
// applied to the plan's own fields, so what is tested is the plan and not a copy of the runner.
import assert from 'node:assert/strict';
import { COST, STEP_FACTS, convertPlan, costOf, factsFor, findInstalls, locksFor, parseRegistryDump, pathsFromRecords, planLines, runnable, steamLibraries, wardrobeFolder } from '../convertPlan.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// A folder with a space in it on purpose: every argument stays one argument, whatever the shell.
const SWG = 'C:\\Star Wars Galaxies\\client';
const JKA = 'D:\\Steam\\steamapps\\common\\Jedi Academy\\GameData';
const OUT = 'C:\\swg3js\\assets-private';

type Step = { args: string[]; reason: string; jka?: string | null };
const step = (line: string, reason = 'it is missing', jka: string | null = null): Step => ({ args: line.split(' ').map((a) => a.replace(/\u0001/g, ' ')), reason, jka });

// Every command status can ask for, in the order status asks.
const TODO = {
  format: 1,
  dir: OUT,
  done: false,
  unreadable: [],
  steps: [
    step(`snapshot @SWG all ${OUT} --radius=all --retail-only`, 'dathomir has no pack'),
    step(`snapshot @SWG tatooine ${OUT}\\tatooine --center=auto --radius=all --retail-only`, 'tatooine has no objects'),
    step(`snapshot @SWG naboo ${OUT}\\naboo --center=auto --radius=all --retail-only`, 'naboo has no objects'),
    step(`terrain @SWG all ${OUT} --retail-only`, 'lok has no ground textures'),
    step(`sky @SWG all ${OUT} --retail-only`, 'lok has no sky'),
    step(`water @SWG all ${OUT} --retail-only`, 'lok has no water.json'),
    step(`pois @SWG all ${OUT} --retail-only`, 'lok has no pois.json'),
    step(`creatures @SWG ${OUT} --retail-only`, 'no creatures converted'),
    step(`player @SWG ${OUT} --retail-only`, 'no player character converted', 'takes'),
    step(`parts @SWG ${OUT} --retail-only`, 'the parts rig lacks the named idle, walk and run clips'),
    step(`clips-save ${OUT}\\player\\human_male.glb ${OUT}\\player\\jka.clips --only=BOTH_`, 'the parts rig has 0 of the player\'s 40 Jedi Academy clips'),
    step(`clips-apply ${OUT}\\characters\\human_male\\rig.glb ${OUT}\\player\\jka.clips`, 'the parts rig has 0 of the player\'s 40 Jedi Academy clips'),
    step(`species @SWG ${OUT} --retail-only`, 'no species index'),
    step(`wardrobe @SWG ${OUT} --retail-only`, 'NPC outfit pieces wear from wardrobe/human_male'),
    step(`wardrobe @SWG ${OUT} --retail-only --gender=female`, 'NPC outfit pieces wear from wardrobe/human_female'),
    step(`wardrobe @SWG ${OUT} --retail-only --template=object/creature/player/shared_ithorian_male.iff`, 'NPC outfit pieces wear from wardrobe/ithorian_male'),
    step(`wardrobe @SWG ${OUT} --retail-only --template=object/creature/player/shared_ithorian_female.iff --gender=female`, 'NPC outfit pieces wear from wardrobe/ithorian_female'),
    step(`mobiles @SWG ${OUT} --retail-only --skip-existing`, '900 mobile models missing'),
    step(`weapons @SWG ${OUT} --retail-only`, 'no weapons converted'),
    step(`ships @SWG ${OUT} --retail-only`, 'no ships converted'),
    step(`space @SWG all ${OUT} --retail-only`, 'space zones missing'),
    step(`maps @SWG ${OUT} --retail-only`, 'the galaxy map has no shuttle routes'),
    // The three lines status really asks for on a first conversion: the bank on its own (twice
    // over, from the sound half and from the ship-sound half), the bank with Jedi Academy's own,
    // and the bank with every planet's placed sounds after it. The first two are one command line
    // once the folders are filled in; the third does everything they do and more.
    step(`sounds @SWG ${OUT} --retail-only`, 'no sound bank', 'takes'),
    step(`sounds @SWG ${OUT} --retail-only --jka=@JKA`, 'the clip events have no Jedi Academy half', 'needs'),
    step(`sounds @SWG ${OUT} all --retail-only`, 'no placed sounds for tatooine', 'takes'),
    step(`flibberty @SWG ${OUT} --retail-only`, 'a command from a converter newer than this plan'),
  ],
};

const plan = convertPlan(TODO, { swg: SWG, jka: JKA, out: OUT });
const at = (command: string) => plan.steps.filter((s) => s.command === command);
const one = (command: string) => {
  const hits = at(command);
  assert.equal(hits.length, 1, `one ${command} step`);
  return hits[0];
};
const index = (command: string) => plan.steps.findIndex((s) => s.command === command);

// ------------------------------------------------------------------ the arguments a step is run with
ok(plan.steps.length === 24 && plan.skipped.length === 0, 'every step status asked for is a step to run when both installs are in hand');
ok(one('player').args.includes(SWG) && !one('player').args.includes('@SWG'), 'the client folder is put in where status wrote @SWG');
ok(one('player').args.filter((a) => a === SWG).length === 1 && one('player').args.length === 5, 'a folder with a space in it stays one argument');
ok(one('player').args.includes(`--jka=${JKA}`), 'a command that is better for Jedi Academy is given it');
ok(!one('clips-save').args.includes('--retail-only'), 'a command that reads no archives is not given --retail-only');
ok(one('weapons').args.includes('--retail-only'), 'every command that reads the archives runs retail-only');
const noJka = convertPlan(TODO, { swg: SWG, jka: '', out: OUT });
ok(noJka.skipped.length === 1 && noJka.skipped[0].command === 'sounds' && /Jedi Academy/.test(noJka.skipped[0].skip), 'a step that needs Jedi Academy is left out by name when there is none');
ok(runnable(noJka).length === 24 && !runnable(noJka).some((s) => s.args.some((a) => a.includes('@JKA'))), 'with no Jedi Academy nothing is run with an unfilled @JKA');
ok(!runnable(noJka).some((s) => s.args.some((a) => a.startsWith('--jka='))), 'and nothing is given a Jedi Academy folder it has not got');
ok(noJka.steps.length === 25 && noJka.steps.filter((s) => s.skip).length === 1, 'the step left out is still in the plan, carrying why, so a run can say so');
ok(runnable(noJka).every((s) => (s.after ?? []).every((k) => !noJka.skipped.some((x) => x.key === k))), 'and nothing is left waiting for work that will not be done');
ok(noJka.notes.some((n) => /left out/.test(n)), 'the plan says out loud that it left something out');
ok(convertPlan(TODO, { swg: SWG, jka: JKA, out: OUT, only: ['ships', 'space'] }).steps.length === 2, '--only runs that much of it');
const onlyShips = convertPlan(TODO, { swg: SWG, jka: JKA, out: OUT, only: ['ships'] });
ok(onlyShips.steps[0].after.length === 0, 'a step whose dependency is not in this run waits for nothing: status asks only for what is left');
ok(onlyShips.steps[0].missing!.includes('mobiles') && onlyShips.notes.some((n) => /mobiles/.test(n) && /--only/.test(n)), 'but a dependency --only took out is not the same as one status never asked for, and is said out loud');
ok(convertPlan({ ...TODO, steps: TODO.steps.filter((s) => s.args[0] !== 'mobiles') }, { swg: SWG, jka: JKA, out: OUT, only: ['ships'] }).notes.every((n) => !/--only/.test(n)), 'and nothing is said about a dependency status did not ask for, which is one that is already done');

// ------------------------------------------------------------------ one run that does another's work
ok(at('sounds').length === 1 && at('sounds')[0].args.includes('all'), 'the sound bank is not converted twice: the run that also writes the planets\' places is the one kept');
ok(/no sound bank/.test(at('sounds')[0].reason) && /placed sounds/.test(at('sounds')[0].reason), 'and it carries every reason both were asked for');
ok(plan.notes.some((n) => /sound bank is converted once/.test(n)), 'and the plan says so, since a step status asked for is not in the list');
ok(runnable(noJka).filter((s) => s.command === 'sounds').length === 1, 'the fold happens with no Jedi Academy too');
ok(noJka.skipped[0].args.some((a) => a.startsWith('--jka=')), 'and the step left out is the Jedi Academy one, which no fold may swallow: its sentence is about itself');

// ------------------------------------------------------------------ the order
const before = (a: string, b: string) => index(a) >= 0 && index(b) >= 0 && index(a) < index(b);
ok(before('snapshot', 'terrain') && before('snapshot', 'sky') && before('snapshot', 'water') && before('snapshot', 'pois') && before('snapshot', 'maps'), 'the planets are converted before what is written into their packs');
ok(before('player', 'parts') && before('parts', 'clips-apply') && before('clips-save', 'clips-apply'), 'the character, then its parts, then the clips carried onto them');
ok(before('wardrobe', 'species') && before('species', 'mobiles') && before('mobiles', 'ships') && before('ships', 'sounds'), 'the wardrobes, the species, the mobiles, the ships and then the sounds');
const waits = (command: string, on: string) => at(command).length > 0 && at(command).every((step) => (step.after ?? []).some((key) => plan.steps.find((s) => s.key === key)?.command === on));
ok(waits('maps', 'snapshot') && waits('maps', 'terrain'), 'the maps wait for the pack and for the terrain file they read the ground width from');
ok(waits('ships', 'mobiles'), 'the ships wait for the mobiles, whose astromech models they hang on a hull');
ok(waits('sounds', 'ships') && waits('sounds', 'species') && waits('sounds', 'snapshot'), 'the sounds wait for the ships, the species packs and the planets they are joined to');
ok(waits('mobiles', 'species') && waits('mobiles', 'wardrobe'), 'the mobiles wait for the index and the wardrobes their NPCs are dressed from');
ok(waits('species', 'wardrobe') && waits('parts', 'wardrobe'), 'whatever writes the species index waits for the wardrobes it names');
ok(waits('species', 'clips-save'), 'the species rigs wait for the bundle they take their Jedi Academy clips from, and not only for the step that puts it on the parts rig');
{
  // The round a first conversion really has, and the one this was got wrong on for a long time:
  // `status` cannot ask for `clips-apply` until the parts rig exists, so on the round where `parts`
  // and `species` first become askable together, `clips-apply` is no step of the run and is taken
  // as already done. Only `clips-save`, which reads the player pack alone, is askable then -- so it
  // is the one that has to hold `species` back. Without it every species but the parts rig's own
  // came out with no saber swings, no jumps and no rolls, and nothing said so.
  const round = { format: 1, dir: OUT, done: false, unreadable: [], steps: [
    step(`parts @SWG ${OUT} --retail-only`, 'the parts rig lacks the named idle, walk and run clips'),
    step(`clips-save ${OUT}\\player\\human_male.glb ${OUT}\\player\\jka.clips --only=BOTH_`, 'the player pack has Jedi Academy clips and no bundle'),
    step(`species @SWG ${OUT} --retail-only`, 'no species index'),
    step(`wardrobe @SWG ${OUT} --retail-only`, 'NPC outfit pieces wear from wardrobe/human_male'),
  ] };
  const early = convertPlan(round, { swg: SWG, jka: JKA, out: OUT });
  const sp = early.steps.find((s) => s.command === 'species')!;
  const save = early.steps.find((s) => s.command === 'clips-save')!;
  ok(sp.after.includes(save.key), 'and does so on the very round where the clip pair is only half askable');
  ok(early.steps.indexOf(save) < early.steps.indexOf(sp), 'so the bundle is made before the rigs that read it are written');
}
ok(at('wardrobe').every((s) => s.after.length === 0) && one('creatures').after.length === 0 && one('weapons').after.length === 0, 'the wardrobes, the creatures and the weapons wait for nothing at all');
const place = new Map(plan.steps.map((s, i) => [s.key, i]));
ok(plan.steps.every((s, i) => (s.after ?? []).every((k) => place.get(k)! < i)), 'the plan is printed in an order it could really be run in: nothing stands before what it waits for');
ok(plan.notes.every((n) => !/wait for each other/.test(n)), 'nothing in the plan waits for itself');

// ------------------------------------------------------------------ what may run beside what
const clash = (a: string, b: string) => a === b || plan.steps.find((s) => s.key === a)!.locks.some((l) => plan.steps.find((s) => s.key === b)!.locks.includes(l));
const wardrobes = at('wardrobe');
ok(wardrobes.length === 4 && new Set(wardrobes.map((s) => s.locks.join())).size === 4, 'the four wardrobe runs hold four different folders');
ok(!clash(wardrobes[0].key, wardrobes[1].key) && !clash(wardrobes[2].key, wardrobes[3].key), 'two wardrobe runs may run at the same time');
const planets = at('snapshot').filter((s) => s.args[2] !== 'all');
ok(planets.length === 2 && !clash(planets[0].key, planets[1].key), 'two planets convert at the same time');
ok(clash(at('snapshot').find((s) => s.args[2] === 'all')!.key, planets[0].key), 'a run over every planet holds each planet the run names as well');
ok(clash(one('maps').key, one('terrain').key) && clash(one('sky').key, one('water').key), 'everything that writes into the planet packs is held apart');
const placedSounds = at('sounds').find((s) => s.args.includes('all'))!;
ok(clash(placedSounds.key, one('maps').key), 'a sounds run that writes each planet\'s own sounds is held apart from the packs');
ok(!locksFor('sounds', ['sounds', SWG, OUT, '--retail-only']).some((l) => l.startsWith('pack')), 'and one that writes only the bank holds no pack at all');
ok(locksFor('sounds', ['sounds', SWG, OUT, 'tatooine', '--retail-only']).includes('pack:tatooine'), 'while one given a planet holds that planet');
ok(!clash(one('weapons').key, one('creatures').key) && !clash(one('space').key, at('snapshot')[0].key), 'the weapons, the creatures and the space zones tread on nothing');
ok(one('flibberty').alone === true && one('flibberty').needs.length === 0, 'a command this plan has never heard of runs on its own');
ok(plan.steps.filter((s) => s.alone).length === 1, 'and it is the only one that does');
ok(factsFor('snapshot') !== null && factsFor('flibberty') === null, 'the facts are there for the commands the converter has and for no others');

// ------------------------------------------------------------------ what it is thought to cost
ok(at('snapshot').find((s) => s.args[2] === 'all')!.cost.seconds > planets[0].cost.seconds * 4, 'every planet costs a good deal more than one');
ok(plan.steps.every((s) => s.cost.seconds > 0 && s.cost.bytes >= 0.3 * 1024 ** 3), 'every step carries a time and at least what mounting the archives holds');
ok(plan.seconds > one('player').cost.seconds + one('parts').cost.seconds, 'the plan knows its longest chain is longer than any one step in it');
ok(plan.steps.every((s) => s.cost.memoryMb === Math.round(s.cost.bytes / 1024 ** 2)), 'the memory is given in megabytes as well');
// The memory half of the model is the half that has to be wrong in the safe direction, so nothing in
// the table may be budgeted below what any step was really seen to hold, and a step nobody has run is
// budgeted above all of them. A measurement that comes in above the ceiling fails here rather than
// oversubscribing the machine in the dark.
const facts = Object.entries(STEP_FACTS);
ok(facts.every(([, f]) => typeof (f as any).measured === 'string' && /\d+(\.\d+)? s/.test((f as any).measured) && /MB/.test((f as any).measured)), 'every step in the table says what it was really seen to cost');
const seen = facts.map(([, f]) => Number(/([\d,]+) MB/.exec((f as any).measured)![1].replace(/,/g, '')));
ok(facts.every(([, f], i) => (f as any).bytes / 1024 ** 2 >= seen[i]), 'and is budgeted at or above it, because a peak seen once is not a ceiling');
ok(COST.UNMEASURED_BYTES / 1024 ** 2 > Math.max(...seen), 'a step nobody has run is budgeted above every step anybody has');
ok(costOf('flibberty', []).bytes === COST.UNKNOWN_BYTES && COST.UNKNOWN_BYTES >= COST.UNMEASURED_BYTES, 'and so is a command this plan has never heard of');
ok(costOf('sounds', ['sounds', SWG, OUT]).bytes === STEP_FACTS.sounds.bytes, 'a measured step is budgeted at what the table says');

// ------------------------------------------------------------------ the folder each wardrobe run writes
ok(wardrobeFolder(['wardrobe', SWG, OUT]) === 'human_male', 'a wardrobe run with nothing said writes the men\'s human folder');
ok(wardrobeFolder(['wardrobe', SWG, OUT, '--gender=female']) === 'human_female', 'with --gender=female, the women\'s');
ok(wardrobeFolder(['wardrobe', SWG, OUT, '--template=object/creature/player/shared_ithorian_male.iff']) === 'ithorian_male', 'a template names the species');
ok(wardrobeFolder(['wardrobe', SWG, OUT, '--template=object/creature/player/shared_ithorian_male.iff', '--gender=female']) === 'ithorian_female', 'and the gender wins over the template\'s own, as the converter has it');
// The converter puts the gender on by replacing one the template's name carries, never by adding one,
// so a template with no gender in its name writes one folder for both. Spelled the other way round,
// these two runs would hold two different locks and be free to run at once into the same folder.
ok(wardrobeFolder(['wardrobe', SWG, OUT, '--template=object/creature/player/shared_wookiee.iff']) === wardrobeFolder(['wardrobe', SWG, OUT, '--template=object/creature/player/shared_wookiee.iff', '--gender=female']), 'a template with no gender in its name writes the one folder whichever gender is asked for');
ok(locksFor('wardrobe', ['wardrobe', SWG, OUT, '--template=object/creature/player/shared_wookiee.iff']).some((l) => locksFor('wardrobe', ['wardrobe', SWG, OUT, '--template=object/creature/player/shared_wookiee.iff', '--gender=female']).includes(l)), 'so the two runs of it are held apart');

// ------------------------------------------------------------------ the plan in words
const lines = planLines(plan);
ok(lines.length > plan.steps.length && lines[0].includes('24 steps'), 'the plan prints a line of its own and more than one line a step');
ok(lines.some((l) => l.includes('waits for nothing')) && lines.some((l) => l.includes('holds')), 'it says what each step waits for and what it holds');
ok(planLines(noJka).some((l) => l.includes('left out')), 'and it says what was left out');

// ------------------------------------------------------------------ where the installs are
const dump = [
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{4b}',
  '    DisplayName    REG_SZ    Star Wars Galaxies',
  '    InstallLocation    REG_SZ    E:\\Games\\Star Wars Galaxies',
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{9c}',
  '    DisplayName    REG_SZ    Some Other Game',
  '    InstallLocation    REG_SZ    E:\\Games\\Other',
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\123',
  '    gameName    REG_SZ    Star Wars Jedi Knight - Jedi Academy',
  '    path    REG_SZ    F:\\GOG\\Jedi Academy',
].join('\r\n');
const records = parseRegistryDump(dump);
ok(records.length === 3 && records[0].values.DisplayName === 'Star Wars Galaxies', 'a registry dump reads as one record per key with its values');
ok(pathsFromRecords(records, /star\s*wars\s*galaxies/i).join() === 'E:\\Games\\Star Wars Galaxies', 'only the records that name the game give up their folder');
ok(pathsFromRecords(records, /jedi\s*academy/i).join() === 'F:\\GOG\\Jedi Academy', 'a record that names the game in another value is found too');
ok(steamLibraries('"libraryfolders"\n{\n "0"\n {\n  "path"  "C:\\\\Program Files (x86)\\\\Steam"\n }\n "1"\n {\n  "path"  "B:\\\\Steam"\n }\n}').length === 2, 'Steam says where its other libraries are and both are read');

// What decides whether a record gave up a folder is what was taken, never which value names it
// carried. An empty InstallLocation is common in Windows' own uninstall entries, and the folder the
// uninstaller stands in is the fallback written for exactly that record.
const empties = parseRegistryDump(
  [
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Uninstall\\{a}',
    '    DisplayName    REG_SZ    Star Wars Galaxies',
    '    InstallLocation    REG_SZ    ',
    '    UninstallString    REG_SZ    "G:\\Games\\SWG\\unins000.exe"',
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Uninstall\\{b}',
    '    DisplayName    REG_SZ    Star Wars Galaxies Test',
    '    InstallLocation    REG_SZ    not a folder at all',
    '    DisplayIcon    REG_SZ    H:\\SWG2\\swg.exe,0',
  ].join('\r\n'),
);
ok(empties.length === 2 && empties[0].values.InstallLocation === '', 'a value that is there and empty is read as empty rather than as absent');
ok(pathsFromRecords(empties, /star\s*wars\s*galaxies/i).join() === 'G:\\Games\\SWG,H:\\SWG2', 'a record whose install folder is empty, or is not a folder, still gives up its uninstaller\'s');
const unread: string[] = [];
const mangled = parseRegistryDump(['HKEY_LOCAL_MACHINE\\SOFTWARE\\Uninstall\\{c}', '    DisplayName    REG_SZ    Star Wars Galaxies', '    InstallLocation    REG_SZ    E:\\Sp\uFFFDl\\SWG'].join('\r\n'));
ok(pathsFromRecords(mangled, /star\s*wars\s*galaxies/i, (p) => unread.push(p)).length === 0 && unread.length === 1, 'a folder whose name could not be read is not tried as a folder, and is said instead');

const fake = {
  env: {},
  envText: `SWG=${SWG}\nJKA=${JKA}\n`,
  platform: 'win32' as const,
  registry: () => dump,
  readText: () => '',
  usualSwg: ['Z:\\nowhere'],
  usualJka: ['Z:\\nowhere'],
  checks: {
    swg: (dir: string) => (dir === SWG || dir.startsWith('E:\\Games\\Star Wars Galaxies') ? { ok: true, sentence: 'the client' } : { ok: false, sentence: `${dir} holds no .tre archives, so it is not a Star Wars Galaxies client folder.` }),
    jka: (dir: string) => (dir === JKA || dir.startsWith('F:\\GOG\\Jedi Academy') ? { ok: true, sentence: 'Jedi Academy' } : { ok: false, sentence: `${dir} has no base\\assets0.pk3.` }),
  },
};
const fromEnv = findInstalls(fake);
ok(fromEnv.swg.ok && fromEnv.swg.path === SWG && fromEnv.swg.from.includes('.env'), 'the .env is read before anything is searched for');
const fromWindows = findInstalls({ ...fake, envText: '' });
ok(fromWindows.swg.path === 'E:\\Games\\Star Wars Galaxies' && fromWindows.jka.path!.startsWith('F:\\GOG\\Jedi Academy'), "with no .env, Windows' own record of its installed games is read");
ok(fromWindows.swg.from.includes('Windows') && fromWindows.searched.length >= 2, 'and it says where it found it and what it looked at');
const nowhere = findInstalls({ ...fake, envText: '', registry: () => '' });
ok(!nowhere.swg.ok && !nowhere.jka.ok && nowhere.searched.length === 2, 'when there is nothing to find it says so rather than guessing');
ok(nowhere.searched.every((line) => line.includes('Z:\\nowhere')) && nowhere.swg.sentence.length > 10, 'and every place it looked is named, with a sentence a person can act on');
const staleEnv = findInstalls({ ...fake, envText: 'SWG=Q:\\moved away\n', registry: () => '' });
ok(!staleEnv.swg.ok && staleEnv.swg.sentence.startsWith('SWG in .env') && staleEnv.swg.sentence.includes('Q:\\moved away'), 'a .env pointing somewhere the folder no longer is says so by name rather than "choose a folder"');
const named = findInstalls({ ...fake, swg: 'Q:\\typo' });
ok(!named.swg.ok && /no \.tre archives/.test(named.swg.sentence), 'a folder named on the command line that is wrong is the answer, in the words the launcher already uses');
ok(named.searched.filter((l) => l.includes('Q:\\typo')).length === 1 && !named.searched.some((l) => l.includes('Z:\\nowhere')), 'and nothing else is tried behind the asker\'s back');

// ------------------------------------------------------------------ running it, by the runner's own rules
type Ran = { key: string; from: number; to: number };
function simulate(steps: typeof plan.steps, { jobs = 4, fails = new Set<string>(), memory = 8 * 1024 ** 3 } = {}) {
  const state = new Map(steps.map((s) => [s.key, 'waiting']));
  const running = new Map<string, { step: (typeof steps)[number]; until: number }>();
  const ran: Ran[] = [];
  let now = 0;
  const sweep = () => {
    for (let again = true; again; ) {
      again = false;
      for (const s of steps) {
        if (state.get(s.key) !== 'waiting') continue;
        if (!s.after.some((k) => state.get(k) === 'failed' || state.get(k) === 'skipped')) continue;
        state.set(s.key, 'skipped');
        again = true;
      }
    }
  };
  for (let guard = 0; guard < 1000; guard++) {
    sweep();
    for (;;) {
      const next = steps.find((s) => {
        if (state.get(s.key) !== 'waiting' || !s.after.every((k) => state.get(k) === 'done')) return false;
        if (running.size >= jobs) return false;
        if (s.alone && running.size) return false;
        for (const r of running.values()) {
          if (r.step.alone) return false;
          if (r.step.locks.some((l) => s.locks.includes(l))) return false;
        }
        if (running.size === 0) return true;
        let used = 0;
        for (const r of running.values()) used += r.step.cost.bytes;
        return used + s.cost.bytes <= memory;
      });
      if (!next) break;
      state.set(next.key, 'running');
      running.set(next.key, { step: next, until: now + next.cost.seconds });
      ran.push({ key: next.key, from: now, to: now + next.cost.seconds });
    }
    if (!running.size) break;
    now = Math.min(...[...running.values()].map((r) => r.until));
    for (const [key, r] of [...running]) {
      if (r.until > now) continue;
      running.delete(key);
      state.set(key, fails.has(key) ? 'failed' : 'done');
    }
  }
  return { state, ran, seconds: now };
}

const commandOf = (key: string) => plan.steps.find((s) => s.key === key)!.command;
const overlapping = (ran: Ran[]) => ran.flatMap((a, i) => ran.slice(i + 1).filter((b) => b.from < a.to && a.from < b.to).map((b) => [a.key, b.key] as const));
const run = simulate(runnable(plan));
ok([...run.state.values()].every((s) => s === 'done'), 'with nothing failing, every step runs');
ok(overlapping(run.ran).every(([a, b]) => !clash(a, b)), 'no two steps that hold the same folder ever run at the same time');
ok(!overlapping(run.ran).some(([a, b]) => commandOf(a) === 'flibberty' || commandOf(b) === 'flibberty'), 'the step this plan does not know ran with nothing beside it');
ok(overlapping(run.ran).some(([a, b]) => commandOf(a) === 'wardrobe' && commandOf(b) === 'wardrobe'), 'and the wardrobes really did run together');
ok(run.seconds < plan.steps.reduce((n, s) => n + s.cost.seconds, 0), 'running them several at a time is shorter than running them one after another');

const broken = simulate(runnable(plan), { fails: new Set([wardrobes[0].key]) });
const after = ['parts', 'species', 'mobiles', 'ships', 'sounds'];
ok(after.every((c) => at(c).every((s) => broken.state.get(s.key) === 'skipped')), 'a step whose dependency failed is never started');
ok(!broken.ran.some((r) => after.includes(commandOf(r.key))), 'and never runs at all, not even a moment of it');
ok(broken.state.get(one('creatures').key) === 'done' && broken.state.get(one('space').key) === 'done' && broken.state.get(wardrobes[1].key) === 'done', 'what did not need it is converted all the same');
ok(broken.state.get(one('weapons').key) === 'done' && at('snapshot').every((s) => broken.state.get(s.key) === 'done'), 'including the long ones');

// The runner is the other half of this, and takes a plan's steps as they are: this is the seam.
let runner: any = null;
try {
  runner = await import('../convertRun.mjs');
} catch {
  runner = null;
}
if (runner?.normaliseSteps) {
  const normalised = runner.normaliseSteps(runnable(plan));
  ok(normalised.problems.length === 0 && normalised.steps.length === runnable(plan).length, 'the runner takes the plan\'s steps with nothing to say about them');
  const mine = new Set(placedSounds.after);
  const theirs = new Set(normalised.steps.find((s: any) => s.key === placedSounds.key).waitFor);
  ok(mine.size === theirs.size && [...mine].every((k) => theirs.has(k)), 'and waits for exactly what the plan said it should');
} else console.log('note the runner is not in this checkout, so the seam between the two was not checked');

// And the driver, which is what really hands one to the other.
let drive: any = null;
try {
  drive = await import('../convertDrive.mjs');
} catch {
  drive = null;
}
if (drive?.stepsForRunner) {
  const handed = drive.stepsForRunner(noJka);
  ok(handed.run.length === runnable(noJka).length, 'the driver hands the runner every step that can be run');
  ok(handed.skipped.length === noJka.skipped.length && /Jedi Academy/.test(handed.skipped[0].because), 'and keeps the one it cannot, with why, to say at the end');
  ok(handed.run.every((s: any) => s.cost.seconds > 0 && s.cost.bytes > 0 && Array.isArray(s.locks)), 'the two modules spell a step the same way');
} else console.log('note the driver is not in this checkout, so the seam through it was not checked');

console.log(`${checks} checks passed`);
