// Skies of his own worlds (the GPU port's wave between pass 3's second and the look wave; the owner's of 24 November: "create
// skies for custom places ... Monument or Utapau as examples"): a world of his (its own id, the edit key) that an applied star
// system names among its grounds stands under that system over the sky it borrows (`worldDays.ts`' `systemWorldOf`,
// `skyMotion.ts`' `lent`), its own day the server's and the story's too; the lender's cards stand down but its sun card
// (`SwgSky.useMotion`, `skyLookPlans`); his worlds' air by their own id first and the lender's second (`applyFileAir`'s
// `lends`, the viewer's `worldAir` through Save to game); the viewer lists his worlds as grounds (`viewer/ourWorlds.mjs`); the
// Utapau draft stands on his Utapau world. Every world of the game's, and his with no system of its own, as before.
//
// Run: node tools/swg/tests/ownSkies.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanSystem, compileSystem, makeSkyState, skyAt } from '../../../src/sky/system/system.js';
import { draftSystem, draftSystemOf } from '../../../src/sky/system/drafts.js';
import { systemWorldOf, worldDaysOf, appliedSystemOf } from '../../../src/sky/system/worldDays.ts';
import { skyMotionFor, skyPlacesOf } from '../../../src/sky/system/skyMotion.ts';
import { systemSunsOf } from '../../../src/sky/system/systemSuns.ts';
import { skyLookPlans } from '../../../src/sky/bodies/lookWorld.ts';
import { applyFileAir, cleanBodiesFile } from '../../../src/sky/look/bodiesFile.ts';
import { airDialsOf, AIR_FILE_FIELDS } from '../../../src/sky/air/airParams.ts';
import { PLANETS } from '../../../src/data/planets.ts';
// @ts-ignore a plain module of the viewer's
import { gameBodiesFile } from '../../../viewer/gameBodies.mjs';
// @ts-ignore a plain module of the viewer's
import { ourWorldRows, ourWorldsOf } from '../../../viewer/ourWorlds.mjs';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let checks = 0;
const ok = (cond: boolean, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  console.log(`ok   ${msg}`);
};

// A stand-in of a lent sky's places (Tatooine's shape: two suns, two moons, a celestial; made-up sizes, no converted file read).
const LENT = { sun: { size: 0.55 }, supplementalSun: { size: 0.55 }, moon: { size: 0.3 }, supplementalMoon: { size: 0.15 }, celestials: [{ size: 0.4, image: { file: 'sky/cels_moon_earthy01.png' } }] };
/** A scratch system of Monument's own (a world of his with no pack): a star, the world, a moon, a giant and a belt. */
const MONUMENT = cleanSystem({
  version: 2, id: 'own_monument', name: 'Monument test system',
  grounds: [{ world: 'monument', body: 'm', lat: 37, lon: 20, dayHours: 3, season: 0 }],
  bodies: [
    { id: 'sun', kind: 'star', name: 'Test star', colour: '#ffd8a8', size: 24 },
    { id: 'm', kind: 'planet', name: 'Monument', parent: 'sun', period: 400, radius: 1.1, spinHours: 30, axialTilt: 20 },
    { id: 'moonA', kind: 'moon', name: 'Test moon', parent: 'm', period: 12, radius: 0.0016, size: 6, locked: true, colour: '#c0b8a8' },
    { id: 'giant', kind: 'giant', name: 'Test giant', parent: 'sun', period: 4000, radius: 5, size: 2, colour: '#d9a070' },
    { id: 'belt', kind: 'belt', name: 'Test belt', parent: 'sun', period: 900, radius: 2.5, drawn: true },
  ],
}) as Record<string, unknown>;
const systems = { own_monument: MONUMENT, tatoo: draftSystem('tatoo'), utapau: draftSystem('utapau') } as Record<string, unknown>;

console.log('\n== which world a sky\'s system is looked up under');
{
  ok(JSON.stringify(systemWorldOf(systems, 'tatooine', 'tatooine')) === JSON.stringify({ world: 'tatooine', lent: null }), "a world of the game's: its own pack, nothing lent (as before)");
  ok(JSON.stringify(systemWorldOf(systems, 'monument', 'tatooine')) === JSON.stringify({ world: 'monument', lent: 'tatooine' }), 'Monument named by a system of its own: that system, over the sky it borrows');
  ok(JSON.stringify(systemWorldOf({ tatoo: systems.tatoo }, 'monument', 'tatooine')) === JSON.stringify({ world: 'tatooine', lent: null }), "Monument with no system of its own: its lender's, as before");
  ok(JSON.stringify(systemWorldOf(systems, 'ours_race_map_2', 'lok')) === JSON.stringify({ world: 'ours_race_map_2', lent: 'lok' }), 'his Utapau world under the Utapau draft applied: its own system over Lok\'s sky');
  ok(JSON.stringify(systemWorldOf(systems, 'kashyyyk_main', 'kashyyyk_main')) === JSON.stringify({ world: 'kashyyyk_main', lent: null }) && systemWorldOf(null, 'monument', 'tatooine').lent === null, 'a world whose edit key is its pack, and no file at all: as before');
  ok(systemWorldOf({ v1x: { version: 1 }, ['v1:monument']: { version: 1, world: 'monument', bodies: [] } }, 'monument', 'tatooine').lent === null, 'a first-round one-world sky never makes a world of his its own system (version 2 alone)');
}

console.log('\n== the motion of a world of his under its own system');
const mo = skyMotionFor(systems as Any, 'monument', 'monument', LENT, 'tatooine')!;
{
  ok(!!mo && mo.lent === 'tatooine' && mo.world === 'monument' && mo.id === 'own_monument', `a motion of its own (${mo?.id}), lent Tatooine's sky`);
  ok(mo.items.every((it) => it.place === null && it.slot === 'none'), 'no body stands on an SWG place: every one is hung as the system\'s own');
  ok(mo.ownsDay && mo.lengthSeconds === 3 * 3600 && mo.casterJ >= 0 && mo.items[mo.casterJ].name === 'Test star', `its own day (${mo.lengthSeconds / 3600} h) and its own star as the sun`);
  ok(mo.beltKit.count === 1, 'its belt drawn');
  ok((mo.report() as Any).lent === 'tatooine', "the console says what it lends");
  const tat = skyMotionFor(systems as Any, 'tatooine', 'tatooine', LENT)!;
  ok(tat.lent === null && !('lent' in (tat.report() as Any)) && tat.items.some((it) => it.place === 'tatooine:sun'), "Tatooine's own motion lends nothing and its report is as before");
  ok(skyMotionFor(systems as Any, 'monument', 'monument', LENT, 'monument')?.lent === null, 'a world lent itself is no lend');
  // the viewer's model of the same system from the same ground, at the same moments: the same sky to the bit
  const M = compileSystem(MONUMENT, () => null, () => false, { world: 'monument', placeExists: () => false }) as Any;
  const O = makeSkyState(M) as Any;
  let worst = 0;
  for (let k = 0; k < 40; k++) {
    const count = 9.8e5 + k * 0.137;
    mo.at({ count });
    skyAt(M, mo.T, O);
    for (let i = 0; i < 3 * mo.m; i++) worst = Math.max(worst, Math.abs(mo.dir[i] - O.dir[i]));
  }
  ok(worst === 0 && M.m === mo.m, `the game's motion and the viewer's model agree to the bit at 40 moments (worst ${worst})`);
  ok(mo.items.every((it, j) => it.sizeDeg === M.itemSize[j]), 'and every body\'s size is the viewer\'s');
  // the sun's size is read against the lent sky's sun card (as SWG's own sun card is for a world of the game's)
  const suns = systemSunsOf(systems as Any, 'monument', 'monument', LENT)!;
  const card = skyPlacesOf('monument', LENT).get('monument:sun')!.sizeDeg;
  ok(!!suns && suns.system === 'own_monument' && Math.abs(suns.caster.radiusDeg - Number(((0.267 * 24) / card).toFixed(5))) < 1e-9, `its star's disc is the plain star's times its size over the lent sun card (${suns?.caster.radiusDeg} degrees)`);
}

console.log('\n== the lender\'s cards stand down under a world\'s own system');
{
  const fake = (slot: string, file: string | null): Any => ({ held: null, slot, file, disc: { scale: { x: 100 }, parent: null, renderOrder: -5 }, air: { kind: 'airless' } });
  const cards = [fake('moon', null), fake('celestial', 'sky/cels_moon_earthy01.png')];
  const presetFor = (): Any => ({ id: 'preset', look: { kind: 'sphere', layers: {}, generated: { recipe: 'moon', seed: 1, dials: {} } } });
  const lentPlans = skyLookPlans('tatooine', cards, {} as Any, 60, 3500, mo, presetFor);
  ok(lentPlans.every((p) => p.byMotion === true && p.card === null), `over a lent sky every plan is a body of the system's own (${lentPlans.length}), none a card of the lender's`);
  const free = skyLookPlans('tatooine', cards, {} as Any, 60, 3500, { ...mo, items: mo.items, lent: null } as Any, presetFor);
  ok(free.length === lentPlans.length, 'and with no card wearing a look the plans are the same set either way (the second loop draws only cards of his looks)');
}

console.log('\n== his worlds\' air: their own first, the lender\'s second');
{
  const file = cleanBodiesFile({ version: 1, looks: {}, uses: {}, systems: {}, air: { tatooine: { visibilityKm: 22, radiusKm: 3400 } }, pictures: {} }).file!;
  applyFileAir(file, { monument: 'tatooine' });
  ok(airDialsOf('monument').visibilityKm === 22 && AIR_FILE_FIELDS.monument?.radiusKm === 3400, "Monument with no air of its own takes Tatooine's saved air");
  const own = cleanBodiesFile({ version: 1, looks: {}, uses: {}, systems: {}, air: { tatooine: { visibilityKm: 22 }, monument: { visibilityKm: 90 } }, pictures: {} }).file!;
  applyFileAir(own, { monument: 'tatooine' });
  ok(airDialsOf('monument').visibilityKm === 90, 'with its own, its own');
  applyFileAir(file, null);
  ok(airDialsOf('monument').visibilityKm === 40 && !AIR_FILE_FIELDS.monument && airDialsOf('tatooine').visibilityKm === 22, "no lend named (a world of the game's): Monument back to its start, Tatooine its own");
  applyFileAir(null, null);
  ok(airDialsOf('tatooine').visibilityKm === 40, 'and no file: every world as before');
  // the viewer's Save to game writes a world's own air by its id, and a file with none as before
  const data = { looks: {}, uses: {}, starSystems: {}, systems: {}, pictures: {}, worlds: [], twins: {} };
  const none = gameBodiesFile(data, { at: 'x' });
  const some = gameBodiesFile({ ...data, worldAir: { ours_race_map_2: { mode: 'scattered', visibilityKm: 18, hazeColour: '#ffe0c0' }, 'Bad Key': { visibilityKm: 1 } } }, { at: 'x' });
  ok(JSON.stringify(none.air) === '{}' && JSON.stringify(gameBodiesFile({ ...data, worldAir: {} }, { at: 'x' })) === JSON.stringify(none), 'Save to game with no world air of his writes the file as before');
  ok(some.air.ours_race_map_2?.visibilityKm === 18 && !some.air['Bad Key'], "his Utapau world's own air written by its id, a key that is no world dropped");
  const read = cleanBodiesFile(JSON.parse(JSON.stringify(some))).file!;
  ok((read.air.ours_race_map_2 as Any)?.visibilityKm === 18, "and the game's reader keeps it");
}

console.log('\n== the viewer lists his worlds as grounds');
{
  const rows = ourWorldRows(JSON.stringify({ version: 1, rows: [{ id: 'ours_race_map_2', kind: 'new', name: 'Utapau', sky: { colours: 'lok' } }, { id: 'ours_copy', kind: 'copy', of: 'naboo', name: 'A copy' }, { id: 'not_ours', name: 'x' }, { id: 'ours_dome', kind: 'new', name: 'Dome' }] }));
  ok(JSON.stringify(rows.map((r: Any) => [r.id, r.lender])) === JSON.stringify([['ours_race_map_2', 'lok'], ['ours_copy', 'naboo'], ['ours_dome', null]]), "the worlds file's rows: a new world borrows its colours' sky, a copy its source's, a dome none; a row with no id of his left out");
  ok(ourWorldRows('not json').length === 0 && ourWorldRows('{ "rows": [ // a note\n { "id": "ours_a", "name": "A" } ] }').length === 1, 'a broken file gives none; one with comments is read');
  const all = ourWorldsOf(PLANETS, rows);
  const builtIn = all.filter((w: Any) => w.kind === 'built-in').map((w: Any) => `${w.id}/${w.lender}`);
  ok(builtIn.includes('monument/tatooine') && builtIn.every((s: string) => PLANETS.some((p) => p.pack === false && `${p.id}/${p.borrowSky}` === s)), `the built-in worlds with no pack that borrow a sky (${builtIn.join(', ')})`);
  ok(all.length === builtIn.length + 3 && all.some((w: Any) => w.id === 'ours_race_map_2' && w.name === 'Utapau'), 'then his worlds file\'s, each once');
  // (the wave's fixer) a copy draws its source's pack, as the game loads it (`copySourcePack`): a zone's pack first, then a
  // planet's id read as its first zone's pack (the early Kashyyyk, the one world whose id is no pack, is `kashyyyk`'s)
  const kash = ourWorldsOf(PLANETS, ourWorldRows(JSON.stringify({ rows: [{ id: 'ours_k', kind: 'copy', of: 'kashyyyk_early', name: 'K' }, { id: 'ours_h', kind: 'copy', of: 'kashyyyk_hunting', name: 'H' }, { id: 'ours_m', kind: 'copy', of: 'kashyyyk', name: 'M' }] })));
  const lenderOf = (id: string): unknown => kash.find((w: Any) => w.id === id)?.lender;
  ok(lenderOf('ours_k') === 'kashyyyk' && lenderOf('ours_h') === 'kashyyyk_hunting' && lenderOf('ours_m') === 'kashyyyk', "a copy draws its source's pack as the game reads it: the early Kashyyyk's kashyyyk, a zone's own, and `kashyyyk` the early world's pack before the planet's id");
  const src = readFileSync(new URL('../../../viewer/app.js', import.meta.url), 'utf8');
  ok(/for \(const p of state\.places\) if \(!p\.stand\) out\.uses\[p\.id\]/.test(src), "a world of his's ground place is never written into his file of choices");
}

console.log('\n== the Utapau draft');
{
  const u = draftSystem('utapau') as Any;
  ok(!!u && u.grounds.length === 1 && u.grounds[0].world === 'ours_race_map_2' && draftSystemOf('ours_race_map_2') === 'utapau', 'it stands on his Utapau world (its id in his worlds file)');
  const moons = u.bodies.filter((b: Any) => b.kind === 'moon').length + (u.bodies.find((b: Any) => b.kind === 'group')?.members.length ?? 0);
  ok(moons === 9 && u.bodies.filter((b: Any) => b.kind === 'moon' && b.drawn).length === 4, `nine moons, four drawn (${moons})`);
  ok(u.bodies.find((b: Any) => b.kind === 'planet').period === 351 && u.bodies.find((b: Any) => b.kind === 'planet').spinHours === 27 && u.grounds[0].dayHours === 4.5, "SWAPI's year and day, the game's day its lore day over six (4.5 h)");
  ok(u.bodies.every((b: Any) => !b.places || b.places.length === 0), 'no body names an SWG place');
  ok(appliedSystemOf({ utapau: u }, 'ours_race_map_2')?.id === 'utapau', 'applied, his Utapau world follows it');
  const days = worldDaysOf({ utapau: u, own_monument: MONUMENT });
  ok(days.ours_race_map_2?.lengthSeconds === 4.5 * 3600 && days.monument?.lengthSeconds === 3 * 3600, "the server's table gives both worlds of his their own day (the relay's and the story's hour, `clock.mjs`)");
}

console.log(`\nownSkies: ${checks} checks passed`);
