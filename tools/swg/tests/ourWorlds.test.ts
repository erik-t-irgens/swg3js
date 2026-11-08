// The worlds of yours (the race drawer's fourth wave, DESIGN.md §5c): the worlds file's reader and writer, the merge into the
// planet list (with no file the list is the game's to the object), the one rule every edit file is named by (`editKeyOf`,
// held over every world in PLANETS to 3a1fc8e's own paths, out of git and by a recorded hash), a copy writing nothing under
// its source's name (through the batch and the endpoint's own file rule), a copy standing nothing but terrain and buildings,
// the planet a row makes, a ground made in the browser, the sky in parts, the world row's weather and the water's colour.
//
// Run: node tools/swg/tests/ourWorlds.test.ts
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PLANETS, packIdOf, type PlanetDef } from '../../../src/data/planets.ts';
import { OUR_WORLDS, copySourcePack, editKeyOf, editKeyOfPack, isCopy, layWorldWeather, mergeOurWorlds, ourWaterLook, placesPackOf, planetOfWorld, planetsVersion, readWithin, standsLife, waysPackOf, worldSeedOf } from '../../../src/data/ourWorlds.ts';
import { WORLDS_FILE_VERSION, WORLDS_LIMITS, isWorldId, mintWorldId, readWorldRow, readWorldsFile, sameWorldRow, worldWithExtras, worldsFileText, type WorldRow } from '../../../src/world/editFiles/worldsFile.ts';
import { CLIMATE_MOST } from '../../../src/world/editFiles/locationsFile.ts';
import { EditorWorlds, arrivalHeadingOf, skyCannotWords, type WorldsHost } from '../../../src/editor/editorWorlds.ts';
import { EDIT_FILE_KINDS, SHARED_EDIT_KINDS, editFilePath, outsideFilePath, placementsPath } from '../../../src/story/placementPath.ts';
import { tracksPath } from '../../../src/race/trackPath.ts';
import { applyPlacementBatch, olderWorldsEndpoint, worldsKind } from '../../../src/world/placementEdits.ts';
import { packHolds, worldOfPack } from '../../../src/world/packFiles.ts';
import { madeDemPatch } from '../../../src/world/demTerrain.ts';
import { bodiesOf, mixSky, prefixFor, skyAsks, type SkySource } from '../../../src/world/skyParts.ts';
import type { SkyData } from '../../../src/world/sky.ts';
import { fileFor, worldKinds } from '../../dev/placementsEndpoint.mjs';
import { loadOldMany, REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

/** The commit before this wave, whose edit paths every world of the game's keeps (the race drawer's W3b). */
const BEFORE = '3a1fc8e';
/** Recorded from 3a1fc8e's own `packIdOf`, `editFilePath`, `placementsPath` and `tracksPath` over its every world and zone (below). */
const BEFORE_PATHS = '89299623cfd98220';

const NEW_ROW: WorldRow = { id: 'ours_race_map', kind: 'new', name: 'Race map', size: 8192, start: { kind: 'flat', height: 12 }, ground: { pack: 'lok', base: 'lok_dirt' }, sky: { colours: 'tatooine', clouds: 'naboo', suns: [{ pic: 'tatooine/sun', el: 50, az: 135, size: 0.3 }, { pic: 'naboo/sun', el: 20, az: 200, size: 0.2 }], moons: [{ pic: 'naboo/moon', el: 30, az: 300, size: 0.2 }] }, weather: { climate: [3, 1, 0, 0], kind: 'rain' }, water: { color: 0x336699, opacity: 0.6 }, gravity: 15 };
const COPY_ROW: WorldRow = { id: 'ours_dant_copy', kind: 'copy', of: 'dantooine', name: 'Dantooine copy', water: { color: 0x112233, opacity: 0.5 } };

// ---- day one: no worlds file, the list and every key are the game's ----
const gameIds = PLANETS.map((p) => p.id).join(',');
const listBefore = PLANETS;
const lengthBefore = PLANETS.length;
{
  const v = planetsVersion();
  mergeOurWorlds([]);
  ok(PLANETS === listBefore && PLANETS.length === lengthBefore && PLANETS.map((p) => p.id).join(',') === gameIds && planetsVersion() === v, 'with no worlds the planet list is the game\'s to the object, the order and the version');
  ok(PLANETS.every((p) => !p.ours), 'and no world of the game\'s carries a row of ours');
  ok(PLANETS.every((p) => standsLife(p) && !isCopy(p)), 'every world of the game\'s stands its life (people, wildlife, travel, fittings, sounds, gates)');
}

// ---- editKeyOf over every world in PLANETS, held to 3a1fc8e's own paths ----
const pathsOf = (planets: readonly PlanetDef[], key: (p: PlanetDef, z?: string) => string, kinds: readonly string[], file: (k: string, w: string) => string, layer: (l: 'story' | 'world', w: string) => string, track: (w: string) => string): string[] => {
  const out: string[] = [];
  for (const p of planets) {
    for (const z of p.zones?.length ? p.zones.map((x) => x.id) : [undefined]) {
      const k = key(p, z);
      out.push(`${p.id}|${z ?? ''}|${k}`);
      for (const kind of kinds) out.push(file(kind, k));
      out.push(layer('story', k), layer('world', k), track(k));
    }
  }
  return out;
};
{
  const oldKinds = EDIT_FILE_KINDS.filter((k) => k !== 'worlds');
  const now = pathsOf(PLANETS, (p, z) => editKeyOf(p, z), oldKinds, (k, w) => editFilePath(k as never, w), placementsPath, tracksPath);
  ok(PLANETS.every((p) => (p.zones?.length ? p.zones.map((z) => z.id) : [undefined]).every((z) => editKeyOf(p, z) === packIdOf(p, z) && editKeyOfPack(p, packIdOf(p, z)) === packIdOf(p, z))), `editKeyOf is packIdOf for every one of the game's ${PLANETS.length} worlds and every zone`);
  const hash = createHash('sha1').update(now.join('\n')).digest('hex').slice(0, 16);
  const old = await loadOldMany(['src/data/planets.ts', 'src/story/placementPath.ts', 'src/race/trackPath.ts'], ['src/data/planets.ts', 'src/story/placementPath.ts', 'src/race/trackPath.ts'], BEFORE);
  if (old) {
    const [P, PP, TP] = old as [{ PLANETS: PlanetDef[]; packIdOf: (p: PlanetDef, z?: string) => string }, { EDIT_FILE_KINDS: string[]; editFilePath: (k: string, w: string) => string; placementsPath: (l: 'story' | 'world', w: string) => string }, { tracksPath: (w: string) => string }];
    const then = pathsOf(P.PLANETS, P.packIdOf, PP.EDIT_FILE_KINDS, PP.editFilePath, PP.placementsPath, TP.tracksPath);
    ok(JSON.stringify(PP.EDIT_FILE_KINDS) === JSON.stringify(oldKinds), `the kinds before are ${BEFORE}'s, in its order (the worlds kind is the one added)`);
    ok(then.join('\n') === now.join('\n'), `every edit path of every world and zone is ${BEFORE}'s, by its own packIdOf and path functions (${then.length} paths)`);
  } else note(`git cannot hand ${BEFORE} over: held by the recorded hash alone`);
  if (BEFORE_PATHS === 'RECORD_ME') note(`record BEFORE_PATHS = '${hash}'`);
  else ok(hash === BEFORE_PATHS, `and the paths hash as recorded from ${BEFORE} (${hash})`);
}

// ---- the worlds file ----
{
  ok(editFilePath('worlds', 'tatooine') === 'placements/worlds/all.json' && SHARED_EDIT_KINDS.includes('worlds'), 'one worlds file every world shares (worlds/all.json)');
  ok(isWorldId('ours_race_map') && !isWorldId('tatooine') && !isWorldId('ours_') && !isWorldId('ours_Race') && !isWorldId(`ours_${'a'.repeat(36)}`), "a world of yours' id is ours_ and a-z, 0-9 and _ (40 at most), never a world of the game's");
  ok(PLANETS.every((p) => !isWorldId(p.id) && (p.zones ?? []).every((z) => !isWorldId(z.pack))), "no world or pack of the game's has such an id");
  ok(mintWorldId('Race map!', new Set()) === 'ours_race_map' && mintWorldId('Race map', new Set(['ours_race_map'])) === 'ours_race_map_2', 'an id minted from its name, a number after it where taken');
  const unknown: string[] = [];
  const r = readWorldRow({ ...NEW_ROW, at: 5, later: 1 }, unknown);
  ok(typeof r !== 'string' && sameWorldRow(r, { ...NEW_ROW, at: 5 }) && unknown.join() === 'ours_race_map.later', 'a new world reads whole, a field this build does not read named');
  ok(typeof readWorldRow(COPY_ROW) !== 'string', 'a copy reads');
  ok(readWorldRow({ ...COPY_ROW, size: 4096 }) === "a copy takes its source's terrain and ground, never its own size", 'a copy naming a size of its own is refused in words');
  ok(typeof readWorldRow({ ...NEW_ROW, size: 100 }) === 'string' && typeof readWorldRow({ ...NEW_ROW, sky: { suns: [1, 2, 3, 4] } }) === 'string' && typeof readWorldRow({ ...NEW_ROW, sky: { moons: Array(5).fill({ pic: 'a/moon', el: 1, az: 1, size: 0.1 }) } }) === 'string', 'a size past the range, four suns and five moons are refused');
  const text = worldsFileText([worldWithExtras(NEW_ROW, { later: 1 }), COPY_ROW as unknown as Record<string, unknown>]);
  const back = readWorldsFile(text);
  ok(back.problem === null && back.rows.length === 2 && back.rows[0].id === 'ours_dant_copy' && back.unknown.join() === 'ours_race_map.later', `the file writes a row a line, sorted by id, read back whole (version ${WORLDS_FILE_VERSION})`);
  ok(worldsFileText(back.rows.map((x) => x as unknown as Record<string, unknown>)).length > 0 && readWorldsFile('{ "version": 2, "rows": [] }').problem !== null, 'a file of another version does not read');
  ok(olderWorldsEndpoint("#0's file is story, world, removed, people, heights, paint, water, locations, looks, solid, lights, lightsAll or tracks") && !olderWorldsEndpoint("#0's file is story, world, removed, people, heights, paint, water, locations, looks, solid, lights, lightsAll, worlds or tracks"), "an endpoint from before the worlds is told by its own words");
}

// ---- the planet a row makes ----
const game = PLANETS.filter((p) => !p.ours);
{
  const n = planetOfWorld(NEW_ROW, game) as PlanetDef;
  ok(typeof n !== 'string' && n.pack === false && n.extra === true && n.dem?.made === 'flat' && n.dem.height === 12 && n.dem.size === 8192 && n.terrain.amplitude === 0 && n.terrain.base === 12, 'a new flat world: no pack, a made flat ground at its height and size, off the galaxy');
  ok(n.borrowSky === 'tatooine' && n.ground?.pack === 'lok' && n.ground.fallback === 'lok_dirt' && n.ground.rules.length === 0 && n.gravity === 15 && n.creatures.count === 0 && n.props.treeDensity === 0, 'its sky borrowed, its ground the lent pack with the base family, its gravity, nothing standing');
  ok(Math.abs(n.sky.sunElevation - (50 * Math.PI) / 180) < 1e-12 && Math.abs(n.sky.sunAzimuth - (135 * Math.PI) / 180) < 1e-12 && n.sky.suns === 2, "the first sun's elevation and azimuth place the light's path, and the dome counts the suns");
  const noise = planetOfWorld({ ...NEW_ROW, start: { kind: 'noise', base: 5, amplitude: 90, frequency: 0.0018, octaves: 4, ridged: 0.5, flatten: 2.4, detail: 0.6 } }, game) as PlanetDef;
  ok(noise.dem?.made === 'noise' && noise.terrain.amplitude === 90 && noise.terrain.base === 5, 'a test terrain start: the game\'s own noise with its numbers');
  const raster = planetOfWorld({ ...NEW_ROW, start: { kind: 'raster', of: 'monument' } }, game) as PlanetDef;
  const mon = game.find((p) => p.id === 'monument')!;
  ok(raster.dem?.url === mon.dem!.url && raster.dem.size === mon.dem!.size && !raster.dem.made, 'a raster start: that real-elevation world\'s raster');
  ok(typeof planetOfWorld({ ...NEW_ROW, start: { kind: 'raster', of: 'tatooine' } }, game) === 'string', 'a raster start of a world with none is refused');
  const rules = planetOfWorld({ ...NEW_ROW, ground: { pack: 'lok', base: 'x', rules: 'canyon' } }, game) as PlanetDef;
  ok(typeof rules !== 'string' && rules.ground!.rules.length > 0 && typeof planetOfWorld({ ...NEW_ROW, ground: { pack: 'naboo', base: 'x', rules: 'canyon' } }, game) === 'string', "a world's elevation rules taken only with their own pack's families");
  const c = planetOfWorld(COPY_ROW, game) as PlanetDef;
  const dant = game.find((p) => p.id === 'dantooine')!;
  ok(c.zones?.length === 1 && c.zones[0].pack === 'dantooine' && packIdOf(c) === 'dantooine' && editKeyOf(c) === 'ours_dant_copy' && c.pack === undefined, "a copy reads its source's pack (packIdOf) and keeps its edits under its own id (editKeyOf)");
  ok(c.creatures.count === 0 && JSON.stringify(c.terrain) === JSON.stringify(dant.terrain) && c.gravity === dant.gravity && isCopy(c) && !standsLife(c), "and stands its source's terrain, and no life");
  const zoned = planetOfWorld({ ...COPY_ROW, of: 'kashyyyk_hunting' }, game) as PlanetDef;
  ok(typeof zoned !== 'string' && packIdOf(zoned) === 'kashyyyk_hunting', "a copy of one of a planet's zones reads that zone's pack");
  for (const [of, what] of [['space_tatooine', 'a space zone'], ['dungeon1', 'the world of copies'], ['monument', 'a real-elevation world'], ['nowhere', 'no world']] as const) ok(typeof planetOfWorld({ ...COPY_ROW, of }, game) === 'string' && copySourcePack(of, game) === null, `a copy of ${what} is refused in words`);
}

// ---- the merge, and what a copy moves of the game's packs ----
{
  const v = planetsVersion();
  const got = mergeOurWorlds([NEW_ROW, COPY_ROW, { ...COPY_ROW, id: 'ours_bad', of: 'space_naboo' }]);
  ok(PLANETS === listBefore && PLANETS.slice(0, lengthBefore).map((p) => p.id).join(',') === gameIds && PLANETS.length === lengthBefore + 2, "worlds of yours merged in place after the game's, the game's order untouched");
  ok(got.merged.join() === 'ours_race_map,ours_dant_copy' && got.refused.length === 1 && got.refused[0].id === 'ours_bad' && planetsVersion() !== v, 'a row that makes no world is refused and named, and the version moves');
  ok(worldOfPack('dantooine')?.id === 'dantooine' && worldOfPack('ours_dant_copy')?.id === 'ours_dant_copy', "a copy is never its source's pack's world");
  ok(packHolds('dantooine', 'spawns.json') && !packHolds('ours_dant_copy', 'spawns.json') && packHolds('ours_dant_copy', 'nav.json') && !packHolds('ours_race_map', 'manifest.json'), "Dantooine's own files are asked as before; the copy asks its own grid, a new world nothing");
  ok(placesPackOf('ours_dant_copy').pack === 'dantooine' && placesPackOf('ours_dant_copy').centreOnly && !placesPackOf('dantooine').centreOnly && placesPackOf('dantooine').pack === 'dantooine', "a copy's places are its own over its source's centre alone");
  mergeOurWorlds([]);
  ok(PLANETS === listBefore && PLANETS.map((p) => p.id).join(',') === gameIds && OUR_WORLDS.merged.length === 0, 'and taken out again, the list is the game\'s');
}

// ---- a copy writes nothing under its source's name (the batch, the endpoint's file rule) ----
{
  const root = mkdtempSync(join(tmpdir(), 'rd-w4-batch-'));
  try {
    const dir = join(root, 'placements');
    mkdirSync(join(dir, 'worlds'), { recursive: true });
    writeFileSync(join(dir, 'worlds', 'all.json'), worldsFileText([NEW_ROW, COPY_ROW] as unknown as Record<string, unknown>[]));
    const worlds = worldKinds(dir);
    ok(worlds.get('ours_dant_copy') === 'ground' && worlds.get('ours_race_map') === 'ground' && worlds.get('dantooine') === 'ground', "the endpoint knows each world of yours by its own id, from the file as it stands");
    ok(!worldKinds(null).has('ours_dant_copy'), 'and none without the file');
    const ctx = { worlds, now: 1_800_000_000_000 };
    // The key the page hands its batches: `App.editKey()`'s own words (`editKeyOf(this.world.planet, this.zone)`, pinned as
    // text below, with `packId: () => this.editWorld()`) over the copy as it stands merged in the planet list, in its one zone.
    mergeOurWorlds([COPY_ROW]);
    const merged = PLANETS.find((p) => p.id === COPY_ROW.id)!;
    const key = editKeyOf(merged, merged.zones?.[0]?.id);
    mergeOurWorlds([]);
    ok(key === 'ours_dant_copy' && key !== packIdOf(merged), "the page's edit key on the copy (editKeyOf over the merged planet and its zone) is the copy's own id, never its pack");
    const out = applyPlacementBatch({ op: 'batch', world: key, edits: [{ file: 'locations', put: { id: 'world', kind: 'world', climate: [1, 2] } }] }, {}, ctx as never) as { status: number; body: { files: Record<string, { file: string }> } };
    const files = Object.values(out.body.files ?? {}).map((f) => f.file);
    // What this proves is the endpoint's half: handed the copy's key, it writes under that key alone. That the page hands that
    // key is the check above and the pins below.
    ok(out.status === 200 && files.length > 0 && files.every((f) => f.includes('ours_dant_copy') && !f.includes('dantooine.json')), `the endpoint, handed the copy's key, writes its own files alone (${files.join(', ')})`);
    ok(fileFor(dir, 'heights', key).endsWith(join('heights', 'ours_dant_copy.json')) && fileFor(dir, 'tracks', key).endsWith(join('tracks', 'ours_dant_copy.json')) && fileFor(dir, 'world', key).endsWith(join('world', 'ours_dant_copy.json')), "and the endpoint puts every kind's file under the copy's own name");
    const made = applyPlacementBatch({ op: 'batch', world: 'tatooine', edits: [{ file: 'worlds', put: { kind: 'new', name: 'Another', size: 4096 }, was: null }] }, { worlds: readFileSync(join(dir, 'worlds', 'all.json'), 'utf8') }, ctx as never) as { status: number; body: { files: { worlds?: { file: string; put: WorldRow[] } } } };
    ok(made.status === 200 && made.body.files.worlds?.file === 'public/placements/worlds/all.json' && made.body.files.worlds.put[0].id === 'ours_another' && worldsKind.idOk('ours_another'), 'a world is made in one batch wherever the editor stands, its id minted from its name');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---- a ground made in the browser ----
{
  const flat = madeDemPatch('flat', 1000, 7, { base: 0, amplitude: 0 });
  ok(flat.heightAt(0, 0, () => 99) === 7 && flat.heightAt(499, -499, () => 99) === 7 && flat.heightAt(600, 0, () => 99) === null && flat.minHeight === 7, 'a flat made ground: its height over the square, the planet\'s own beyond it');
  const noise = madeDemPatch('noise', 1000, 0, { base: 10, amplitude: 40 });
  ok(noise.heightAt(100, 100, () => 33) === 33 && noise.minHeight === -30 && noise.maxHeight === 50, "a test terrain made ground: the planet's own noise, its bands from the noise's numbers");
}

// ---- the sky in parts ----
{
  const body = (file: string, size = 0.3) => ({ shader: `${file}.sht`, size, glowShader: '', glowSize: size * 2, image: { file: `texture/${file}.png`, alphaMode: 'BLEND', hasAlpha: true }, glowImage: null });
  const block = (name: string, weatherIndex: number, tag: string) => ({ name, weatherIndex, gradientSky: `texture/${tag}_grad.png`, cloudBottom: { file: `texture/${tag}_low.png`, size: 1, speed: 1 }, cloudTop: { file: `texture/${tag}_high.png`, size: 1, speed: 1 }, ramp: { rows: 1, rgba: tag }, shadows: true, fog: { enabled: true, min: 1, max: 2 }, dayEnvironment: null, nightEnvironment: null, windSpeedScale: 1, cameraEffect: null });
  const sky = (tag: string, celestials = 0): SkyData => ({ planet: tag, dayNightSplit: 0.5, sunElevationDegrees: 45, sun: body(`${tag}_sun`), supplementalSun: { ...body(`${tag}_sun2`), yaw: 10, pitch: 5 }, moon: body(`${tag}_moon`), supplementalMoon: null, celestials: Array.from({ length: celestials }, (_, i) => body(`${tag}_c${i}`)), stars: { count: 100, colors: null }, nightSky: null, skybox: null, blocks: [block('a', 0, tag), block('b', 1, tag)] }) as unknown as SkyData;
  const base = sky('base', 2);
  const frozen = JSON.stringify(base);
  const A: SkySource = { data: sky('aaa'), prefix: prefixFor('base', 'aaa') };
  const B: SkySource = { data: sky('bbb'), prefix: prefixFor('base', 'bbb') };
  ok(prefixFor('base', 'base') === '' && A.prefix === '../aaa/', "a part's files are re-rooted into its own pack's folder, the base's own left as they are");
  const none = mixSky(base, { colours: null, clouds: null, bodies: null });
  ok(JSON.stringify(none.data) === frozen && none.said.length === 0, 'with no part named the sky is the base\'s own');
  const mixed = mixSky(base, { colours: A, clouds: B, bodies: { suns: [{ pic: 'aaa/sun', el: 40, az: 90, size: 0.5 }, { pic: 'bbb/sun2', el: 10, az: 180, size: 0.2 }, { pic: 'base/c1', el: 60, az: 270, size: 0.1 }], moons: [{ pic: 'bbb/moon', el: 30, az: 0, size: 0.2 }, { pic: 'nowhere/moon', el: 30, az: 0, size: 0.2 }], skies: new Map([['base', { data: base, prefix: '' }], ['aaa', A], ['bbb', B]]) } });
  const d = mixed.data;
  ok(JSON.stringify(base) === frozen, 'the base sky is never written');
  ok(d.blocks.every((b, i) => b.gradientSky === `../aaa/texture/aaa_grad.png` && b.ramp?.rgba === 'aaa' && b.weatherIndex === i), "the colours (gradient, ramp, fog) are taken from their own sky's block of the same weather level");
  ok(d.blocks.every((b) => b.cloudBottom?.file === '../bbb/texture/bbb_low.png' && b.cloudTop?.file === '../bbb/texture/bbb_high.png'), 'and the cloud layers separately from another');
  ok(d.blocks.map((b) => b.name).join() === 'a,b' && d.stars?.count === 100, "the weather's families stay the base's own");
  ok(mixSky(base, { colours: null, clouds: 'none', bodies: null }).data.blocks.every((b) => !b.cloudBottom && !b.cloudTop), 'clouds of none take every layer away');
  ok(d.sun?.image?.file === '../aaa/texture/aaa_sun.png' && d.sun.size === 0.5 && d.sun.glowSize === 1 && d.supplementalSun === null, 'the first sun rides the light, its picture out of its sky, sized with its glow');
  ok(d.sunElevationDegrees === 45, "and the sky's data keeps its own elevation: where the first sun stands is the planet's (planetOfWorld), which nothing in the sky's data moves");
  ok(d.moon?.image?.file === '../bbb/texture/bbb_moon.png' && d.supplementalMoon === null, 'the first moon the night\'s');
  ok(d.celestials.length === 2 && d.celestials[0].image?.file === '../bbb/texture/bbb_sun2.png' && d.celestials[0].yaw === 180 && d.celestials[0].pitch === 10 && d.celestials[1].image?.file === 'texture/base_c1.png' && d.celestials[1].yaw === 270, "every other body fixed where it is placed (the sky's own extra bodies given way)");
  ok(mixed.said.length === 1 && /nowhere\/moon/.test(mixed.said[0]), 'a body no sky here has is said, not drawn');
  const sunsOnly = mixSky(base, { colours: null, clouds: null, bodies: { suns: [], moons: null, skies: new Map() } }).data;
  ok(sunsOnly.sun === null && sunsOnly.moon !== null && sunsOnly.moon.image?.file === 'texture/base_moon.png', 'no suns asked keeps no sun and the sky\'s own moon');
  ok(bodiesOf('base', base).map((b) => b.pic).join() === 'base/sun,base/sun2,base/moon,base/c0,base/c1', 'a sky offers its sun, its second sun, its moon and its fixed bodies by name');
  // The light still comes from the first sun's path: the sky makes sprites and never a light, so a body more or fewer moves
  // nothing of the scene's light count (CLAUDE.md's rule).
  const skyText = readFileSync(join(REPO, 'src/world/sky.ts'), 'utf8');
  const partsText = readFileSync(join(REPO, 'src/world/skyParts.ts'), 'utf8');
  ok(!/new THREE\.[A-Za-z]*Light\b/.test(skyText) && !/from 'three'/.test(partsText) && !/Light\(/.test(partsText), 'the sky makes no light and its parts touch nothing of three: the light count never moves with the suns');
}

// ---- the world row's weather, and the water's colour ----
{
  const n = planetOfWorld(NEW_ROW, game) as PlanetDef;
  const rows: { id: string; kind: string; climate?: number[]; weather?: string }[] = [{ id: 'town', kind: 'city' }];
  ok(layWorldWeather(game[0], rows) === rows && layWorldWeather(planetOfWorld({ ...NEW_ROW, weather: undefined }, game) as PlanetDef, rows) === rows, "a world of the game's, and one of yours naming no weather, keep their very rows");
  const laid = layWorldWeather(n, rows);
  ok(laid.length === 2 && laid[1].kind === 'world' && laid[1].weather === 'rain' && laid[1].climate?.join() === '3,1,0,0', "a world of yours' weather is a world row of its own where its file has none");
  const own = layWorldWeather(n, [{ id: 'w', kind: 'world', weather: 'snow' }]);
  ok(own[0].weather === 'snow' && own[0].climate?.join() === '3,1,0,0', "and laid under the file's own world row, which wins");
  const look = { color: '#2e7fbb', opacity: 0.75, source: 'shader' };
  ok(ourWaterLook(look, game[0]) === look && ourWaterLook(look, n).color === '#336699' && ourWaterLook(look, n).opacity === 0.6, "a world of yours' water colour is its sea's and lakes' and every new lake's; a world of the game's keeps the look");
}

// ---- the hand-overs only the game makes, as text ----
{
  const world = readFileSync(join(REPO, 'src/world/world.ts'), 'utf8');
  const main = readFileSync(join(REPO, 'src/main.ts'), 'utf8');
  const galaxy = readFileSync(join(REPO, 'src/ui/galaxyMap.ts'), 'utf8');
  const water = readFileSync(join(REPO, 'src/world/waterBodies.ts'), 'utf8');
  for (const [text, line, what] of [
    [world, 'this.editKey = editKeyOfPack(planet, packId);', 'the world keeps its edit key beside its pack'],
    [world, 'this.askHeights(this.editKey);', 'its heights asked by the edit key'],
    [world, 'this.askPaint(this.editKey);', 'its paint'],
    [world, 'this.askWater(this.editKey);', 'its water'],
    [world, 'this.askRemovals(this.editKey);', 'its removals'],
    [world, 'this.askPeople(this.editKey);', 'its people'],
    [world, 'this.askLights(this.editKey);', 'its lights'],
    [world, 'this.askCourse(this.editKey);', 'its courses'],
    [world, 'await outdoorNav.load(this.editKey);', 'its walk grid, a copy\'s its own'],
    [world, "await wildLife.load(standsLife(planet) ? this.packId : '', import.meta.env.BASE_URL", 'a copy stands no wildlife and no people of the data'],
    [world, 'this.ambience?.begin(packId, standsLife(planet));', 'nor a placed sound'],
    [world, 'if (standsLife(this.planet)) ambientPeople.step(dt, this.simTime, playerPos, this.ambientDeps());', 'nor a person of ours'],
    [world, 'const sky = await SwgSky.load(pack, mix ?? undefined);', 'the sky made from its parts'],
    [main, 'const placesFor = editKeyOf(planet, this.zone);', 'the arrival reads its places by the edit key'],
    [main, 'const dressingPack = editKeyOf(planet, this.zone);', 'its permanent rows'],
    [main, 'void this.enterPlaced(editKeyOf(planet, this.zone));', "the player's own things there"],
    [main, '      if (standsLife(planet)) {\n        standing = this.loadTravel(packIdOf(planet, this.zone)).catch(() => undefined);', 'a copy stands no travel or fittings'],
    [main, 'if (this.world.generation === dressingGen && this.editKey() === dressingPack && standsLife(planet)) void this.standSeats(dressingPack);', 'nor seats of ours'],
    [main, "this.zoneGates.use(import.meta.env.BASE_URL, standsLife(planet) ? packIdOf(planet, this.zone) : planet.id);", 'nor gates'],
    [main, '    const here = this.editKey();\n    const kind = d?.kind ?? d?.layer;', "the dev server's word read by the edit key"],
    [main, '  private editWorld(): string {\n    return this.editKey();', 'the editor writes by the edit key'],
    [main, 'm.pack = editKeyOf(planet, this.zone);', "the story's world is the edit key"],
    [main, 'rt.world = () => this.editKey();', "the story's runtime too"],
    [main, 'const [physics, worlds] = await Promise.all([Physics.create(), readWithin(readOurWorlds(), 4000)]);', 'the boot waits for the worlds file a few seconds at most'],
    [main, 'mergeOurWorlds(worlds.value);', 'the boot merges the worlds file'],
    [main, '  if (worlds.late) {', 'and a read that answered after the wait'],
    [main, '    void worlds.late.then((rows) => {\n      if (rows?.length) app.landLateWorlds(rows);', 'is landed when it comes'],
    [main, '  landLateWorlds(rows: WorldRow[]): void {\n    this.landWorlds(rows);', 'through the very landing a write takes'],
    // A copy stands none of SOE's ways (`waysPackOf`, run above): every way's reader takes its pack from it.
    [main, '    const pack = waysPackOf(this.world.planet, this.zone);\n    if (!c || pack === null) return null;\n    const at = this.player.worldPos;\n    return { pack, at: toRaw(at.x, at.y, at.z, c) };', 'the place SOE\'s ways are asked of (lifts, guides, launchers, clone droids) is none on a copy'],
    [main, '    const pack = waysPackOf(this.world.planet, this.zone);\n    if (!c || pack === null) return null;\n    const raw = toRaw(x, y, z, c);\n    return gateLanding(ngeWays.now, pack, raw[0], raw[2]);', 'nor a gate\'s landing'],
    [main, '    const pack = waysPackOf(this.world.planet, this.zone);\n    if (!c || pack === null) return null;\n    const raw = toRaw(at.x, at.y, at.z, c);\n    const got = copyStartAt(ngeWays.now, pack, raw[0], raw[2]);', 'nor a grid zone\'s copy start'],
    [main, "      const pack = waysPackOf(this.world.planet, this.zone) ?? '';\n      if (this.entranceSet.pack !== pack)", 'nor a dungeon\'s way in'],
    [main, "      const e = thing ? entrancesOf(waysPackOf(this.world.planet, this.zone) ?? '').find((x) => x.template === thing.template) : null;", 'nor the way in taken'],
    // The page's edit key reaches every reader and writer of an edit file (finding 12: the sweep below lists the calls, these
    // the hand-overs that feed them).
    [main, '          packId: () => this.editWorld(),', "the editor's batches name the edit key"],
    [main, '    reload(here, d.rev);', "the dev server's word reads a file again by the edit key"],
    [main, '    this.world.heightsSource = (pack, kind) => this.fetchHeights(pack, kind);', "the world's asks go to the page's readers as they are handed (the edit key)"],
    [main, '    this.world.paintSource = (pack, kind) => this.fetchPaint(pack, kind);', 'its paint'],
    [main, '    this.world.waterSource = (pack, kind) => this.fetchWater(pack, kind);', 'its water'],
    [main, '    this.world.removalsSource = (pack, kind) => this.fetchRemovals(pack, kind);', 'its removals'],
    [main, '    this.world.peopleSource = (pack, kind) => this.fetchPeople(pack, kind);', 'its people'],
    [main, '    const dressingFiles = this.fetchDressing(dressingPack, dressingKind);', 'the arrival reads its permanent rows by the edit key'],
    [main, '    const trackFile = this.fetchTracks(dressingPack, dressingKind, true);', 'and its tracks'],
    [main, '    void this.placesFileOf(placesFor)', 'and its places'],
    [main, '  private editKey(): string {\n    return editKeyOf(this.world.planet, this.zone);', "the page's edit key is editKeyOf's"],
    [main, '    if (!standsLife(planet)) {\n      this.clearTravelStood(false);\n      this.clearFittingsStood(false);', "a copy forgets the travel and fittings the world it came from left, at its arrival's start"],
    [galaxy, 'await this.fillPackPois(p, holder, editKeyOf(p), undefined, false);', "the galaxy's cards read a world's places by its edit key"],
    [water, 'return ourWaterLook(waterLookFor(shader, this.data, planet?.water ?? null), planet);', "the water takes a world of yours' colour"],
  ] as const) ok(text.replace(/\r\n/g, '\n').includes(line), what);
}

// ---- the text sweep: every edit file named in src/ and tools/, each traced to the edit key ----
{
  // Every call of the path functions outside the tests, by file and argument, and where that argument comes from. A call not
  // in this table fails: a new reader or writer of an edit file must name its world by `editKeyOf` and be listed here. The
  // table matches the calls' text alone, never where an argument came from: those origins are held by the hand-overs pinned
  // above (the world's asks, the dev server's word, the arrival's reads, the editor's batches), so a new call is a new pin.
  const KNOWN: Record<string, string> = {
    "src/main.ts|editFilePath|fileKind, pack ?? 'all'": 'readLightsRows: World.askLights(editKey) or the shared file',
    "src/main.ts|editFilePath|'heights', pack": 'readHeights and reloadHeights: World.askHeights(editKey), placementWord(editKey)',
    'src/main.ts|editFilePath|kind, pack': 'readEditRows: World.askRemovals/askPeople(editKey)',
    "src/main.ts|editFilePath|'locations', pack": 'reloadLocations: placementWord(editKey)',
    "src/main.ts|editFilePath|'looks', 'all'": 'shared',
    "src/main.ts|editFilePath|'paint', pack": 'readPaint and reloadPaint: World.askPaint(editKey), placementWord(editKey)',
    "src/main.ts|editFilePath|'people', pack": 'reloadPeople: placementWord(editKey)',
    "src/main.ts|editFilePath|'removed', pack": 'reloadRemovals: placementWord(editKey)',
    "src/main.ts|editFilePath|'water', pack": 'readWater and reloadWater: World.askWater(editKey), placementWord(editKey)',
    "src/main.ts|editFilePath|'worlds', 'all'": 'shared',
    'src/main.ts|placementsPath|l, here': '__debug.placements: here = this.editKey()',
    'src/main.ts|placementsPath|layer, pack': 'fetchPlacements: fetchDressing(dressingPack = editKeyOf), reloadDressing(placementWord editKey)',
    "src/main.ts|placementsPath|'world', here": 'exampleDressing: here = this.editKey()',
    'src/main.ts|tracksPath|world': 'reloadTracks: fetchTracks(dressingPack = editKeyOf), placementWord(editKey), this.editKey()',
    'src/race/trackEdits.ts|tracksPath|world': "the tracks endpoint's own world (the page hands the edit key)",
    'src/race/trackPath.ts|tracksPath|world: string': 'definition',
    'src/story/placementPath.ts|editFilePath|kind: EditFileKind, world: string': 'definition',
    'src/story/placementPath.ts|outsideFilePath|kind: OutsideFileKind, world: string': 'definition',
    'src/story/placementPath.ts|placementsPath|layer: PlacementLayer, world: string': 'definition',
    "src/ui/galaxyMap.ts|editFilePath|'locations', planetId": 'locationsOf: loadPoisRaw(key), every caller an edit key (placesFileOf(editKeyOf), the cards by editKeyOf, the map source mapped)',
    "src/world/mobiles/catalogue.ts|editFilePath|'looks', 'all'": 'shared',
    'src/world/permanentEdit.ts|placementsPath|dest, world': 'destinationFile: the editor host packId() = editWorld() = editKey',
    "src/world/placementEdits.ts|editFilePath|'heights', world": "the batch's own world (the page hands editWorld() = editKey)",
    'src/world/placementEdits.ts|editFilePath|k, world': "the batch's own world",
    "src/world/placementEdits.ts|editFilePath|kind, shared ? 'all' : world": "the batch's own world",
    "src/world/placementEdits.ts|editFilePath|'locations', world": "the batch's own world",
    "src/world/placementEdits.ts|editFilePath|'looks', 'all'": 'shared',
    "src/world/placementEdits.ts|editFilePath|'paint', world": "the batch's own world",
    "src/world/placementEdits.ts|editFilePath|'people', world": "the batch's own world",
    "src/world/placementEdits.ts|editFilePath|'removed', world": "the batch's own world",
    "src/world/placementEdits.ts|editFilePath|'solid', 'all'": 'shared',
    "src/world/placementEdits.ts|editFilePath|'water', world": "the batch's own world",
    "src/world/placementEdits.ts|editFilePath|'worlds', 'all'": 'shared',
    "src/world/placementEdits.ts|outsideFilePath|'tracks', world": "the batch's own world",
    'src/world/placementEdits.ts|placementsPath|layer, world': "the batch's own world",
  };
  const { readdirSync, statSync } = await import('node:fs');
  const found = new Set<string>();
  const walk = (d: string): void => {
    for (const name of readdirSync(join(REPO, d))) {
      const rel = `${d}/${name}`;
      if (name === 'tests' || name === 'node_modules') continue;
      if (statSync(join(REPO, rel)).isDirectory()) walk(rel);
      else if (/\.(ts|mjs)$/.test(name)) {
        const text = readFileSync(join(REPO, rel), 'utf8');
        for (const m of text.matchAll(/\b(editFilePath|placementsPath|outsideFilePath|tracksPath)\(([^)]*)\)/g)) found.add(`${rel}|${m[1]}|${m[2]}`);
      }
    }
  };
  walk('src');
  walk('tools');
  const stray = [...found].filter((k) => !(k in KNOWN));
  const gone = Object.keys(KNOWN).filter((k) => !found.has(k));
  ok(stray.length === 0, `every call naming an edit file in src/ and tools/ is traced to the edit key (${found.size} calls)${stray.length ? `: not ${stray.join('; ')}` : ''}`);
  ok(gone.length === 0, `and the table names no call that is gone${gone.length ? `: ${gone.join('; ')}` : ''}`);
  const navgrid = readFileSync(join(REPO, 'tools/swg/navgrid.mjs'), 'utf8');
  ok(/readFileSync\(join\(folder, kind, `\$\{world\}\.json`\), 'utf8'\)/.test(navgrid) && /out\.push\(\{ id: r\.id, pack, packDir: join\(dir, pack\), outDir: join\(dir, r\.id\) \}\)/.test(navgrid), "the walk grid's bake reads a world's edit files by the key it is handed, and a copy is handed its own id over its source's pack");
}

// ---- the review round (W4-review.txt's twelve findings) ----
{
  const RAD = Math.PI / 180;
  // 1. A copy's first sun places the light (the planet's own path), and nothing but the planet's numbers does.
  const dant = game.find((p) => p.id === 'dantooine')!;
  const sunny = planetOfWorld({ ...COPY_ROW, sky: { suns: [{ pic: 'naboo/sun', el: 22, az: 250, size: 0.3 }] } }, game) as PlanetDef;
  ok(Math.abs(sunny.sky.sunElevation - 22 * RAD) < 1e-12 && Math.abs(sunny.sky.sunAzimuth - 250 * RAD) < 1e-12, "a copy's first sun places the light's path by its elevation and azimuth");
  const plain = planetOfWorld(COPY_ROW, game) as PlanetDef;
  ok(plain.sky.sunElevation === dant.sky.sunElevation && plain.sky.sunAzimuth === dant.sky.sunAzimuth && sunny.sky.top === dant.sky.top, "and a copy naming no sun keeps its source's");
  ok(!/sunElevationDegrees/.test(readFileSync(join(REPO, 'src/world/skyParts.ts'), 'utf8')), "the sky's parts write no elevation nothing reads");

  // 2. A copy stands none of SOE's ways (gates, lifts, guides, launchers, clone droids, a dungeon's way in).
  for (const id of ['kashyyyk', 'mustafar', 'yavin4']) {
    const src = game.find((p) => p.id === id);
    if (!src) continue;
    for (const z of src.zones?.length ? src.zones.map((x) => x.id) : [undefined]) ok(waysPackOf(src, z) === packIdOf(src, z), `a world of the game's asks its ways of its own pack (${id}${z ? ` ${z}` : ''})`);
    const copy = planetOfWorld({ id: `ours_${id}_copy`, kind: 'copy', of: packIdOf(src), name: 'c' }, game) as PlanetDef;
    ok(typeof copy !== 'string' && waysPackOf(copy, copy.zones?.[0]?.id) === null, `a copy of ${id} asks none`);
  }
  const mainText = readFileSync(join(REPO, 'src/main.ts'), 'utf8');
  ok(!/(gateLanding|copyStartAt|cloneFor|wayLiftAt|wayAt)\(ngeWays\.now, packIdOf/.test(mainText) && !/entrancesOf\(packIdOf/.test(mainText), "no reader of SOE's ways or a dungeon's way in takes the pack outright");

  // 3. A copy names its source by the pack it reads, and reads that very pack: every ground world and zone of the game's.
  let round = 0;
  for (const p of game) {
    if (p.space || p.instances || p.pack === false) continue;
    for (const z of p.zones?.length ? p.zones.map((x) => x.id) : [undefined]) {
      const of = packIdOf(p, z);
      const c = planetOfWorld({ id: 'ours_round', kind: 'copy', of, name: 'r' }, game);
      assert.ok(copySourcePack(of, game) === of && typeof c !== 'string' && packIdOf(c) === of, `${p.id}${z ? ` ${z}` : ''}: a copy of ${of} reads ${typeof c === 'string' ? c : packIdOf(c)}`);
      round++;
    }
  }
  ok(round > 20, `a copy of every ground world and zone reads the pack it names (${round})`);
  const early = planetOfWorld({ id: 'ours_old', kind: 'copy', of: packIdOf(game.find((p) => p.id === 'kashyyyk_early')!), name: 'o' }, game) as PlanetDef;
  ok(packIdOf(early) === 'kashyyyk' && early.seed === game.find((p) => p.id === 'kashyyyk_early')!.seed, 'a copy of the early Kashyyyk is the early Kashyyyk, never Kachirho');

  // 4. The source's water, a copy's and a raster start's, with the row's colour laid over it.
  ok(plain.water?.level === dant.water!.level && plain.water.color === 0x112233 && plain.water.opacity === 0.5, "a copy takes its source's water at its level, in its own colour");
  const rasters = game.filter((p) => p.dem && !p.dem.made && !p.ours);
  for (const r of rasters) {
    const n = planetOfWorld({ ...NEW_ROW, start: { kind: 'raster', of: r.id } }, game) as PlanetDef;
    ok(r.water ? n.water?.level === r.water.level && n.water.color === 0x336699 : !n.water, `a new world on ${r.id}'s raster takes its water${r.water ? ` at ${r.water.level} m` : ' (none)'}`);
  }
  ok(!(planetOfWorld(NEW_ROW, game) as PlanetDef).water && rasters.some((r) => r.water), 'a flat start has no water of its own (and some raster world has)');

  // 5. The procedural dome has no weather: said, and its fields greyed.
  const domeRow = { ...NEW_ROW, sky: undefined } as WorldRow;
  ok(/weather/.test(skyCannotWords(domeRow)) && !/weather/.test(skyCannotWords(NEW_ROW)) && skyCannotWords({ ...domeRow, weather: undefined }) === '', 'the procedural dome says it takes no weather, only where one is named');

  // 6 and 7. What the sky in parts reads (`skyAsks`, the very function `skyMixFor` asks).
  ok(skyAsks(undefined, 'base') === null && skyAsks({ colours: 'base' }, 'base') === null && skyAsks({ clouds: 'base' }, 'base') === null, 'a sky naming nothing, or only the base itself, reads nothing and draws as before');
  const none = skyAsks({ clouds: 'none' }, 'base');
  ok(none?.clouds === 'none' && none.colours === null && none.bodies === null, 'clouds of none are asked as none');
  const blank = skyAsks({ colours: 'naboo' }, 'dantooine');
  ok(blank?.colours === 'naboo' && blank.clouds === 'naboo', "blank cloud layers on a copy are the colours' own sky's, never the source's");
  ok(skyAsks({ colours: 'naboo', clouds: 'lok' }, 'dantooine')?.clouds === 'lok' && skyAsks({ colours: 'naboo', clouds: 'dantooine' }, 'dantooine')?.clouds === null, "named clouds are that pack's, and the base pack's own are the base's");
  const bodies = skyAsks({ suns: [{ pic: 'naboo/sun', el: 1, az: 2, size: 0.3 }, { pic: 'base/sun2', el: 1, az: 2, size: 0.3 }], moons: [{ pic: 'naboo/moon', el: 1, az: 2, size: 0.2 }, { pic: 'lok/c0', el: 1, az: 2, size: 0.2 }] }, 'base');
  ok(bodies?.bodies?.packs.join() === 'base,naboo,lok' && bodies.bodies.suns?.length === 2 && bodies.bodies.moons?.length === 2 && bodies.colours === null && bodies.clouds === null, "the bodies read the base's sky first, then each picture's, each once");
  const worldText = readFileSync(join(REPO, 'src/world/world.ts'), 'utf8').replace(/\r\n/g, '\n');
  ok(worldText.includes('    const ask = skyAsks(worldRowOfPlanet(this.planet)?.sky, basePack);\n    if (!ask) return null;') && worldText.includes("    const clouds = ask.clouds === 'none' ? 'none' : ask.clouds ? await read(ask.clouds) : null;") && worldText.includes('      for (const pack of ask.bodies.packs) {'), 'and the world reads exactly what skyAsks asks');

  // 8. "Arrival here" only into a draft of the world standing, looking where the camera looks.
  const said: string[] = [];
  let standing: PlanetDef = game.find((p) => p.id === 'tatooine')!;
  const host: WorldsHost = { putRows: async () => '1 row written', rows: () => [], planet: () => standing, zone: () => undefined, here: () => ({ x: 10, z: 20, y: 5, heading: 1.25 }), travel: () => {}, say: (w) => void said.push(w), skiesNote: () => '' };
  const ed = new EditorWorlds(host);
  await ed.act('worlds:new');
  const draftId = String(ed.draft!.id);
  const off = (): boolean => !!ed.sections()[1].buttons!.find((b) => b.act === 'worlds:arrival')!.off;
  ok(off() && !!ed.arrivalRefusal(), "'Arrival here' is greyed in a new world's draft opened on another world");
  await ed.act('worlds:arrival');
  ok(ed.draft!.arrival === undefined && /no arrival set/.test(said.at(-1) ?? ''), 'and pressed anyway it writes nothing and says why');
  ed.openDraft({ ...NEW_ROW, id: 'ours_race_map' }, false);
  standing = planetOfWorld(NEW_ROW, game) as PlanetDef;
  await ed.act('worlds:arrival');
  const a = ed.draft!.arrival as { x: number; z: number; y: number; heading: number };
  ok(!off() && a.x === 10 && a.z === 20 && a.y === 5 && a.heading === 1.25, "on the world itself it takes the camera's place and heading");
  ok(draftId.startsWith('ours_'), 'the new draft has an id of its own');
  for (const yaw of [0, 0.7, -2.1, 3]) {
    const h = arrivalHeadingOf(yaw);
    assert.ok(Math.abs(Math.sin(h) + Math.sin(yaw)) < 1e-12 && Math.abs(Math.cos(h) + Math.cos(yaw)) < 1e-12, `heading of yaw ${yaw}`);
  }
  ok(true, "an arrival's heading faces where the camera looks (a body faces (sin h, cos h), the camera (-sin yaw, -cos yaw))");
  ok(readFileSync(join(REPO, 'src/editor/editorEntry.ts'), 'utf8').includes('heading: arrivalHeadingOf(this.fly.yaw) } : null;'), "and the editor hands the camera's own yaw");
  // 1 (the form). The first moon rides the night: no elevation or azimuth of its own on the form.
  const labels = ed.sections()[1].fields!.map((f) => f.label);
  ok(labels.includes('Moon 1 picture') && !labels.includes('Moon 1 elevation') && !labels.includes('Moon 1 azimuth') && labels.includes('Sun 1 elevation'), "the form offers the first moon no elevation or azimuth (it rides the night's light)");
  // 5 (the form). Weather fields greyed under the dome, live under a converted sky's colours.
  const weatherAct = (): (string | null)[] => ed.sections()[1].fields!.filter((f) => /^(Weather kind|Climate)/.test(f.label)).map((f) => f.act);
  ok(weatherAct().length === 2 && weatherAct().every((x) => typeof x === 'string'), 'with a converted sky the weather fields take a value');
  ed.openDraft({ ...NEW_ROW, sky: undefined }, false);
  ok(weatherAct().length === 2 && weatherAct().every((x) => x === null), "under the procedural dome they stand greyed, saying they need a converted sky's colours");

  // 9. A climate of noughts is refused, as the locations world row refuses one.
  ok(typeof readWorldRow({ ...NEW_ROW, weather: { climate: [0, 0, 0] } }) === 'string' && typeof readWorldRow({ ...NEW_ROW, weather: { climate: [0, 2] } }) !== 'string' && WORLDS_LIMITS.climate === CLIMATE_MOST, "a climate gives some level a weight above nought, and as many levels as the locations row takes");

  // 10. Two ids of one length are two grounds.
  const seeds = new Set<number>();
  for (let i = 0; i < 200; i++) seeds.add(worldSeedOf(`ours_${String(i).padStart(3, '0')}`));
  ok(worldSeedOf('ours_y') !== worldSeedOf('ours_z') && seeds.size >= 199 && (planetOfWorld({ ...NEW_ROW, id: 'ours_y' }, game) as PlanetDef).seed !== (planetOfWorld({ ...NEW_ROW, id: 'ours_z' }, game) as PlanetDef).seed, `a new world's seed is its whole id's (${seeds.size} of 200 ids of one length apart)`);

  // 11. A worlds file that answers after the boot's wait is landed when it comes.
  const slow = new Promise<string[]>((r) => setTimeout(() => r(['ours_late']), 60));
  const timed = await readWithin(slow, 10);
  ok(timed.value === null && timed.late === slow && (await timed.late)?.[0] === 'ours_late', 'a read past the wait is handed back to be landed, never thrown away');
  const quick = await readWithin(Promise.resolve(['ours_now']), 1000);
  ok(quick.value?.[0] === 'ours_now' && quick.late === null, 'and one within it is the answer');
}

console.log(`\nourWorlds: ${checks} checks passed`);
