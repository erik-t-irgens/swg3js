// What the game asks the server for that belongs to one world's pack, and the public files a build ships, as
// `src/world/packFiles.ts` answers them (the performance pass's fifth wave), with a counting stand-in for fetch: a
// world that declares no pack asks for nothing of one, through the game's own readers; a kind of world the converter
// writes a file for none of is asked for none; the three readers of a world's `sounds.json` make one request; gates are
// asked only of a planet split into zones; the galaxy's cards ask for places only of ground worlds with a pack; a far
// world's map picture and pads are asked with no ask for its manifest; a 404, and only a 404, is remembered for the
// session (a missing space pack, the loading index and a shared file among them); a pack's manifest is the one probe
// the rest wait on; the built list of public files holds the tracked files on disk and nothing else, and on the dev
// server (no list) every placements and tracks file is asked for, the one a `placements:changed` names included; the
// player's own story's index is asked at every boot; and every rule of which files a kind of world can hold is held to
// the packs on disk, so no rule ever hides a file a pack has.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLANETS, planetById } from '../../../src/data/planets.ts';
import * as F from '../../../src/world/packFiles.ts';
import { Ambience } from '../../../src/audio/ambience.ts';
import { BodySounds } from '../../../src/audio/footsteps.ts';
import { CombatSounds } from '../../../src/audio/combatSounds.ts';
import { EmitterGrid, type LoopHost } from '../../../src/audio/emitters.ts';
import { ZoneGates } from '../../../src/world/zoneGates.ts';
import { forgetSpacePacks, loadSpacePack } from '../../../src/space/spaceData.ts';
import { AssetPack } from '../../../src/world/assetPack.ts';
import { mapMeta } from '../../../src/ui/mapImages.ts';
import { loadCloudPack } from '../../../src/world/cloudLook.ts';
import { OutdoorNav } from '../../../src/world/nav/outdoorNav.ts';
import { WildLife } from '../../../src/world/wildLife.ts';
import { CORE3_WORLDS } from '../core3.mjs';
import { shippedPublic } from '../../dev/shippedPublic.mjs';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const ROOT = new URL('../../../', import.meta.url);
const text = (p: string): string => readFileSync(new URL(p, ROOT), 'utf8').replace(/\r\n/g, '\n');

// ---- the stand-in: a site serving only what `served` holds (and a page for what `pages` holds), every ask written down ----

const served = new Map<string, unknown>();
/** Paths answered with the page itself and a 200, as `vite preview` answers a missing file. */
const pages = new Set<string>();
const asked: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL) => {
  const path = String(url).replace(/^\/+/, '');
  asked.push(path);
  if (served.has(path)) return new Response(JSON.stringify(served.get(path)), { status: 200, headers: { 'content-type': 'application/json' } });
  if (pages.has(path)) return new Response('<!doctype html><title>the page</title>', { status: 200, headers: { 'content-type': 'text/html' } });
  return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}) as typeof fetch;
const settle = () => new Promise((r) => setTimeout(r, 20));
const fresh = (): void => {
  F.forgetFiles();
  forgetSpacePacks();
  served.clear();
  pages.clear();
  asked.length = 0;
};
const askedFor = (pattern: RegExp): number => asked.filter((p) => pattern.test(p)).length;
/** The section of a source file from one line's start to the end of the method it opens. */
const methodOf = (src: string, head: string): string => {
  const at = src.indexOf(head);
  return at < 0 ? '' : src.slice(at, src.indexOf('\n  }\n', at));
};

/** The part of the mixer the world's sound readers touch, written down; nothing sounds. */
class QuietHost implements LoopHost {
  readonly grid = new EmitterGrid();
  readonly bank = { available: true, sources: null, template: () => ({ dim: 2 }) };
  play(): number {
    return 0;
  }
  loop(): number {
    return 0;
  }
  stop(): void {}
  move(): void {}
  setGain(): void {}
  setSpace(): void {}
  isPlaying(): boolean {
    return false;
  }
  prepare(): void {}
}

/** Every reader of a pack's own files this wave routed that loads under node, each asked once for one pack. */
async function driveReaders(packId: string): Promise<void> {
  await mapMeta(packId);
  await loadCloudPack(packId, '/');
  await new OutdoorNav().load(packId);
  await new WildLife().load(packId, '/');
  const gates = new ZoneGates();
  gates.use('/', packId);
  await settle();
}

try {
  // ---- a world that declares no pack asks for nothing of one ----
  {
    fresh();
    const declared = PLANETS.filter((p) => p.pack === false);
    ok(declared.length > 0 && declared.every((p) => F.packless(p)) && !F.packless(planetById('tatooine')), 'a world that declares `pack: false` is packless, and one that declares nothing is not');
    for (const planet of declared) {
      for (const file of ['sounds.json', 'gates.json', 'map.json', 'travel.json', 'fittings.json', 'pois.json', 'spawns.json', 'nav.json', 'clouds.json', 'space.json']) {
        const got = await F.packJson(planet.id, file, '/');
        ok(got === null, `${planet.id}: ${file} is answered null without a request`);
      }
      ok((await F.manifestText(planet.id, '/')) === null && (await F.packExists(planet.id, '/')) === false, `${planet.id}: and its manifest is never probed`);
      ok((await F.loadingPicture(planet, '/')) === null, `${planet.id}: and its loading screen asks for no picture`);
      ok((await AssetPack.load(planet.id, '/')) === null, `${planet.id}: \`AssetPack.load\` answers no pack, the manifest's ask being the probe`);
    }
    ok(asked.length === 0, `not one request in all (${asked.length})`);
    // The game's own readers, driven: the map picture, the measured sky, the walk grid, the server's people and the gates.
    for (const planet of declared) await driveReaders(planet.id);
    const ids = declared.map((p) => p.id).join('|');
    ok(askedFor(new RegExp(`assets-private/(${ids})/`)) === 0, `and the map picture's, the measured sky's, the walk grid's, the people's and the gates' readers ask for nothing of theirs either (${asked.filter((p) => new RegExp(`assets-private/(${ids})/`).test(p)).join(', ') || 'none'})`);
    const report = F.filesReport();
    ok(JSON.stringify(report.packless) === JSON.stringify(declared.map((p) => p.id)) && report.packless.includes('monument') && report.skipped.length > 0 && report.asked.every((a) => !new RegExp(`assets-private/(${ids})/`).test(a.url)), 'the console lists the worlds that declare no pack and every ask answered without one');
    // A world given content later drops the `false`, and every one of its files is asked for again.
    const monument = planetById('monument');
    const was = monument.pack;
    delete monument.pack;
    try {
      fresh();
      served.set('assets-private/monument/manifest.json', { categories: {} });
      served.set('assets-private/monument/travel.json', { version: 1, rows: [] });
      const travel = await F.packJson('monument', 'travel.json', '/');
      ok(travel !== null && askedFor(/monument\/manifest\.json$/) === 1 && askedFor(/monument\/travel\.json$/) === 1, 'a world that no longer says `pack: false` is asked for its files again, its manifest first');
    } finally {
      monument.pack = was;
    }
  }

  // ---- a kind of world the converter writes none of a file for is asked for none, through the game's own readers ----
  {
    fresh();
    const kinds = ['space_tatooine', 'gallery', 'dungeon1', 'kashyyyk_main', 'mustafar'];
    // Each pack converted, so that what is not asked for is the rule's doing and not a missing manifest's.
    for (const id of kinds) served.set(`assets-private/${id}/manifest.json`, { categories: {} });
    for (const id of kinds) await driveReaders(id);
    ok(askedFor(/space_tatooine\/(map|clouds|nav|spawns|gates)\.json$/) === 0, 'a space zone is asked for no map picture, measured sky, walk grid, people or gates');
    ok(askedFor(/gallery\/(map|clouds|nav|spawns|gates)\.json$/) === 0, 'nor is the gallery');
    ok(askedFor(/dungeon1\/map\.json$/) === 0 && askedFor(/dungeon1\/spawns\.json$/) === 1, "the copies' world is asked for no map picture, and for its people");
    ok(askedFor(/kashyyyk_main\/spawns\.json$/) === 0 && askedFor(/mustafar\/spawns\.json$/) === 0 && askedFor(/kashyyyk_main\/map\.json$/) === 1, "Kashyyyk's zones and Mustafar, which the server never populated, are asked for no `spawns.json`, and a zone for its map picture");
  }

  // ---- the pack's manifest is one probe for everybody ----
  {
    fresh();
    served.set('assets-private/tatooine/manifest.json', { categories: {} });
    const [exists, textOf] = await Promise.all([F.packExists('tatooine', '/'), F.manifestText('tatooine', '/')]);
    ok(exists && textOf !== null && askedFor(/tatooine\/manifest\.json$/) === 1, 'the probe and the load asking at once share one request for the manifest');
    ok((await F.packExists('tatooine', '/')) && askedFor(/tatooine\/manifest\.json$/) === 1, 'and the probe answers from what it knows after that');
    ok((await F.manifestText('lok', '/')) === null && (await F.manifestText('lok', '/')) === null && askedFor(/lok\/manifest\.json$/) === 1, 'a missing pack is asked for once a session');
    ok((await F.packJson('lok', 'travel.json', '/')) === null && askedFor(/lok\/travel\.json$/) === 0, 'and none of its files is asked for at all');
  }

  // ---- a 404 is remembered for the session, and only a 404 ----
  {
    fresh();
    served.set('assets-private/tatooine/manifest.json', { categories: {} });
    for (let i = 0; i < 2; i++) await F.packJson('tatooine', 'travel.json', '/');
    ok(askedFor(/tatooine\/travel\.json$/) === 1, 'a file of a converted pack that answered 404 is not asked again');
    for (let i = 0; i < 2; i++) await F.packJson('tatooine', 'nav.json', '/', { probe: false });
    ok(askedFor(/tatooine\/nav\.json$/) === 1, 'nor is one asked without the probe');
    ok(F.knownAbsent('tatooine', 'travel.json', '/') && !F.knownAbsent('tatooine', 'fittings.json', '/'), 'and it is known absent, where a file not yet asked for is not');
    pages.add('assets-private/tatooine/fittings.json');
    for (let i = 0; i < 2; i++) await F.packJson('tatooine', 'fittings.json', '/');
    ok(askedFor(/tatooine\/fittings\.json$/) === 2 && !F.knownAbsent('tatooine', 'fittings.json', '/'), 'a page handed back in its place is asked for again, and is not known absent');
    // The readers that keep their own answer for the session keep only a 404's.
    pages.add('assets-private/space_lok/space.json');
    for (let i = 0; i < 2; i++) await loadSpacePack('/', 'space_lok');
    ok(askedFor(/space_lok\/space\.json$/) === 2, 'a space zone whose file came back as a page is asked for again at the next showing');
    pages.add('assets-private/loading/index.json');
    for (let i = 0; i < 2; i++) await F.loadingPicture(planetById('tatooine'), '/');
    ok(askedFor(/loading\/index\.json$/) === 2, 'so is a loading index that came back as a page, at the next screen');
    pages.add('assets-private/tatooine/sounds.json');
    for (let i = 0; i < 2; i++) await F.packJson('tatooine', 'sounds.json', '/', { shared: true });
    ok(askedFor(/tatooine\/sounds\.json$/) === 2, 'and a shared file that came back as a page');
    fresh();
    served.set('assets-private/naboo/manifest.json', { categories: {} });
    for (let i = 0; i < 2; i++) await F.packJson('naboo', 'sounds.json', '/', { shared: true });
    for (let i = 0; i < 2; i++) await F.loadingPicture(planetById('naboo'), '/');
    ok(askedFor(/naboo\/sounds\.json$/) === 1 && askedFor(/loading\/index\.json$/) === 1, 'where a shared file and the loading index that answered 404 are asked for once');
  }

  // ---- a far world's map picture and pads, asked without its manifest ----
  {
    fresh();
    served.set('assets-private/naboo/map.json', { image: 'map.png', width: 16384 });
    const meta = await mapMeta('naboo');
    ok(meta !== null && meta.url === '/assets-private/naboo/map.png' && askedFor(/naboo\/map\.json$/) === 1 && askedFor(/naboo\/manifest\.json$/) === 0, "a far world's map picture (the galaxy tab, a travel terminal) is asked for with no ask for its manifest, which runs to megabytes");
    ok((await mapMeta('lok')) === null && askedFor(/lok\/map\.json$/) === 1 && askedFor(/lok\/manifest\.json$/) === 0, 'and an unconverted one costs its own one miss');
    served.set('assets-private/corellia/travel.json', { version: 3, rows: [] });
    ok((await F.packJson('corellia', 'travel.json', '/', { probe: false })) !== null && askedFor(/corellia\/manifest\.json$/) === 0, "a far world's pads the same way");
    const main = text('src/main.ts');
    const pads = methodOf(main, '  private padsOf(');
    ok(/const json = \(file: string\): Promise<unknown> => packJson\(pack, file, import\.meta\.env\.BASE_URL, \{ probe: false \}\);/.test(pads) && /json\('travel\.json'\), json\('pois\.json'\)/.test(pads), "and the game's pads (a ticket bought, a boarding) are read that way");
    ok(/packJson<\{ image\?: string; width\?: number; centre\?: \{ x: number; z: number \} \}>\(packId, 'map\.json', base\(\), \{ probe: false \}\)/.test(text('src/ui/mapImages.ts')), "as the map picture's reader is");
    const travel = methodOf(main, '  private async loadTravel(');
    const fittings = methodOf(main, '  private async loadFittings(');
    ok(/await packJson<\{ version\?: number; rows\?: TravelRow\[\]; rigs\?: Record<string, TravelRig> \}>\(pack, 'travel\.json', import\.meta\.env\.BASE_URL\);/.test(travel) && !/fetch\(/.test(travel), "an arrival's travel rows are read through the rule (`loadTravel`)");
    ok(/await packJson<\{ version\?: number; rows\?: FittingRow\[\] \}>\(pack, 'fittings\.json', import\.meta\.env\.BASE_URL\);/.test(fittings) && !/fetch\(/.test(fittings), "and its fittings (`loadFittings`)");
  }

  // ---- the three readers of a world's `sounds.json` make one request ----
  {
    fresh();
    served.set('assets-private/tatooine/manifest.json', { categories: {} });
    served.set('assets-private/tatooine/sounds.json', { format: 1, planet: 'tatooine', emitters: [], surfaces: { 'object/test_thing.iff': 'metal' }, rooms: {} });
    served.set('assets-private/naboo/manifest.json', { categories: {} });
    served.set('assets-private/naboo/sounds.json', { format: 1, planet: 'naboo', emitters: [], surfaces: {}, rooms: {} });
    const host = new QuietHost();
    const ambience = new Ambience(host, '/');
    const feet = new BodySounds(host, '/');
    const guns = new CombatSounds();
    guns.attach(host, '/');
    ambience.begin('tatooine');
    feet.begin('tatooine');
    guns.begin('tatooine');
    await settle();
    ok(askedFor(/tatooine\/sounds\.json$/) === 1, `the ambience, the feet and the guns asking for one world's sounds.json make one request (${askedFor(/tatooine\/sounds\.json$/)})`);
    ok((ambience.status() as { pack: string }).pack === 'loaded' && /1 object surfaces/.test(String((feet.status() as { packs: { surfaces: string } }).packs.surfaces)) && /1 object surfaces/.test(String((guns.status() as { tables: { surfaces: string } }).tables.surfaces)), 'and each of the three has it');
    for (const r of [ambience, feet, guns]) r.begin('naboo');
    await settle();
    for (const r of [ambience, feet, guns]) r.begin('tatooine');
    await settle();
    ok(askedFor(/tatooine\/sounds\.json$/) === 1 && askedFor(/naboo\/sounds\.json$/) === 1, 'a world left and come back to is not asked again while it is one of the last two');
    for (const r of [ambience, feet, guns]) r.begin('space_tatooine');
    await settle();
    ok(askedFor(/space_tatooine\/sounds\.json$/) === 0 && (ambience.status() as { pack: string }).pack === 'none', 'a space zone, for which the converter writes no sound places, is asked for none');
    for (const r of [ambience, feet, guns]) r.begin('monument');
    await settle();
    ok(askedFor(/monument\//) === 0, 'and neither is a world with no pack');
    ambience.leave();
    feet.leave();
    guns.leave();
  }

  // ---- gates only on a planet split into zones ----
  {
    fresh();
    served.set('assets-private/tatooine/manifest.json', { categories: {} });
    served.set('assets-private/kashyyyk_main/manifest.json', { categories: {} });
    served.set('assets-private/kashyyyk_main/gates.json', { format: 1, gates: [] });
    const gates = new ZoneGates();
    gates.use('/', 'tatooine');
    gates.use('/', 'space_tatooine');
    gates.use('/', 'monument');
    gates.use('/', 'kashyyyk_main');
    await settle();
    ok(askedFor(/gates\.json$/) === 1 && askedFor(/kashyyyk_main\/gates\.json$/) === 1, "gates.json is asked of a zone of a planet split into zones and of no other world");
    ok(F.packHolds('kashyyyk_hunting', 'gates.json') && !F.packHolds('mustafar', 'gates.json') && !F.packHolds('tatooine', 'gates.json'), 'the rule, by the world a pack belongs to');
  }

  // ---- the galaxy's cards ask for places only of ground worlds with a pack ----
  {
    fresh();
    for (const p of PLANETS) served.set(`assets-private/${p.id}/pois.json`, { pois: [] });
    const cards = PLANETS.filter((p) => !p.instances);
    // The cards ask by each planet's id, and a planet split into zones by each zone's pack (`fillPois`).
    const packsOf = cards.flatMap((p) => (p.zones?.length ? p.zones.map((z) => z.pack) : [p.id]));
    for (const id of packsOf) await F.packJson(id, 'pois.json', '/', { probe: false });
    const want = packsOf.filter((id) => {
      const w = F.worldOfPack(id)!;
      return !w.space && w.pack !== false && w.id !== 'gallery';
    });
    ok(askedFor(/pois\.json$/) === want.length && want.every((id) => asked.includes(`assets-private/${id}/pois.json`)), `the places are asked of the ${want.length} ground packs and of nothing else: no world that declares no pack, no space zone, not the gallery (${asked.length} asks in all)`);
    ok(!asked.some((p) => /manifest\.json$/.test(p)), 'without a probe of anybody\'s manifest at boot');
    const galaxy = text('src/ui/galaxyMap.ts');
    ok(/packJson<\{ pois\?: Poi\[\] \}>\(planetId, 'pois\.json', import\.meta\.env\.BASE_URL, \{ probe: false \}\)/.test(galaxy) && !/fetch\(`\$\{import\.meta\.env\.BASE_URL\}assets-private\/\$\{planetId\}\/pois\.json`\)/.test(galaxy), "the galaxy's own reader of the places asks through the rule (`loadPoisRaw`)");
  }

  // ---- a missing space pack is asked once a session ----
  {
    fresh();
    served.set('assets-private/space_naboo/space.json', { version: 3, zone: 'space_naboo', stations: [], hyperspace: { points: [] } });
    for (let i = 0; i < 3; i++) await loadSpacePack('/', 'space_sandbox');
    ok(askedFor(/space_sandbox\/space\.json$/) === 1, 'an unconverted space zone is asked for once, however often the galaxy tab is shown');
    const a = await loadSpacePack('/', 'space_naboo');
    const b = await loadSpacePack('/', 'space_naboo');
    ok(a !== null && a === b && askedFor(/space_naboo\/space\.json$/) === 1, 'and a converted one is kept as it always was');
    F.forgetFiles();
    forgetSpacePacks();
    await loadSpacePack('/', 'space_sandbox');
    ok(askedFor(/space_sandbox\/space\.json$/) === 2, 'forgetting both the files kept and the space zones kept asks again');
    const files = methodOf(text('src/main.ts'), '      files: (opts?: { forget?: boolean }) => {');
    ok(/if \(opts\?\.forget === true\) \{\s*forgetFiles\(\);\s*forgetSpacePacks\(\);\s*\}\s*return filesReport\(\);/.test(files), '`__debug.files({ forget: true })` forgets both');
    const galaxy = text('src/ui/galaxyMap.ts');
    ok(/SPACE_UNCONVERTED = 'not converted \(asked once this session\)/.test(galaxy) && /reload/.test(galaxy.slice(galaxy.indexOf('SPACE_UNCONVERTED ='), galaxy.indexOf('SPACE_UNCONVERTED =') + 200)), "the galaxy tab's note says the zone is asked once a session and seen after a reload");
  }

  // ---- floors and doors only for a pack with portal buildings ----
  {
    fresh();
    served.set('assets-private/space_naboo/manifest.json', { categories: { layout: [{ id: 'station', file: 'x.glb' }] } });
    served.set('assets-private/space_naboo/layout.json', { objects: [] });
    const pack = await AssetPack.load('space_naboo', '/');
    ok(pack !== null && askedFor(/space_naboo\/(floors|doors)\.json$/) === 0, 'a pack whose models have no cells is asked for no floors and no doors');
    served.set('assets-private/tatooine/manifest.json', { categories: { layout: [{ id: 'cantina', file: 'c.glb', cells: [{ index: 1, name: 'r1' }] }] } });
    await AssetPack.load('tatooine', '/');
    ok(askedFor(/tatooine\/floors\.json$/) === 1 && askedFor(/tatooine\/doors\.json$/) === 1, 'and one with a model with cells is asked for both');
  }

  // ---- the loading pictures, by their own index ----
  {
    fresh();
    served.set('assets-private/loading/index.json', { tatooine: { file: 'tatooine.png' }, late: { key: 'x' } });
    const t = await F.loadingPicture(planetById('tatooine'), '/');
    const k = await F.loadingPicture(planetById('kashyyyk'), '/');
    const m = await F.loadingPicture(planetById('mustafar'), '/');
    const l = await F.loadingPicture({ id: 'late' }, '/');
    ok(t === '/assets-private/loading/tatooine.png' && k === null && m === null, 'a world the loading index lists has its picture, and one it does not list has the stand-in, with no ask for a picture that is not there');
    ok(l === null, 'and the index\'s own stamp is no world');
    ok(askedFor(/loading\/index\.json$/) === 1 && askedFor(/\.png$/) === 0, 'the index is read once a session, and nothing asks for a picture here');
    // The converter writes the index in the shape the game reads it: keyed by planet id, each row naming its file.
    ok(/index\[id\] = \{ file: `\$\{id\}\.png`/.test(text('tools/swg/cli.mjs')), "the `loading` command writes each world's row under its planet id with the picture's file, which is what the game asks for");
  }

  // ---- the public files: the build's list, and the dev server's none ----
  {
    fresh();
    F.setShippedPublic(null);
    for (const path of ['placements/story/nowhere.json', 'placements/world/nowhere.json', 'tracks/nowhere.json']) ok(F.shippedAsk(path), `with the dev server's null list ${path} is asked for`);
    const res = await F.fetchPublic('placements/story/test_world.json', { cache: 'no-store' }, '/');
    ok(res !== null && askedFor(/placements\/story\/test_world\.json$/) === 1, "a file the editor's first save has just written for a world in no list is fetched (`placements:changed` reads it through `fetchPublic`)");
    const counted = F.filesReport();
    ok(counted.counts.missing === 0 && counted.counts.public.missing === 1 && counted.public.some((a) => /placements\/story\/test_world\.json$/.test(a.url)) && !counted.asked.some((a) => /placements\//.test(a.url)), "and the dev server's miss of it is counted among the public files, never among a pack's own (`counts.public`)");
    F.setShippedPublic(['tracks/tatooine.json', 'dem/monument/base16.raw']);
    ok(!F.shippedAsk('placements/story/tatooine.json') && F.shippedAsk('tracks/tatooine.json') && F.shippedAsk('./tracks/tatooine.json') && F.shippedAsk('/dem/monument/base16.raw') && !F.shippedAsk('/dem/canyon/base16.raw'), 'in a build only what its list holds is asked for, however the path is written');
    ok((await F.fetchPublic('placements/world/tatooine.json', undefined, '/')) === null && askedFor(/placements\/world\/tatooine\.json$/) === 0, 'and a file not in the build is answered null with no request');
    F.setShippedPublic(null);
    const main = text('src/main.ts');
    const handler = main.slice(main.indexOf("import.meta.hot.on('placements:changed'"), main.indexOf("import.meta.hot.on('tracks:changed'"));
    const reload = main.slice(main.indexOf('  private async reloadDressing('), main.indexOf('  private noteDressing('));
    const fetchBody = methodOf(main, '  private async fetchPlacements(');
    // Widened in the world editor's second wave on purpose: the word goes through `placementWord`, which drops a revision
    // the page has landed and otherwise reads the file again exactly as before.
    const word = methodOf(main, '  private placementWord(');
    ok(/this\.placementWord\(d\)/.test(handler) && /void this\.reloadDressing\(here, kind, d\.rev\);/.test(word) && /this\.fetchPlacements\(l, pack, frame\)/.test(reload) && /await fetchPublic\(placementsPath\(layer, pack\), \{ cache: 'no-store' \}, import\.meta\.env\.BASE_URL\);/.test(fetchBody), "the dev server's `placements:changed` reads the file again through `fetchPublic`, which with no list asks for it");
    ok(/await fetchPublic\(tracksPath\(world\), \{ cache: 'no-store' \}, import\.meta\.env\.BASE_URL\);/.test(methodOf(main, '  private async readTracks(')), "and a world's tracks are read the same way");
    ok(/import shippedPublic from 'virtual:shipped-public';\nsetShippedPublic\(shippedPublic\);/.test(main), 'the game hands the build\'s list over before anything asks');
    const vite = text('vite.config.ts');
    const plugin = vite.slice(vite.indexOf('function shippedPublicList('), vite.indexOf('function privateAssets('));
    ok(/build = config\.command === 'build';/.test(plugin) && /if \(!build\) return 'export default null;';/.test(plugin) && /return `export default \$\{JSON\.stringify\(shippedPublic\(ROOT\)\)\};`;/.test(plugin) && /shippedPublicList\(\)\]/.test(vite), 'the list is made only for a build; the dev server hands `null`, and no watcher keeps it current');
    // The launcher serves a folder the player names at run time at this address (`storyDir`), which no list made at
    // build time can know: the index is asked at every boot, whatever the build carries.
    const story = methodOf(main, '  private async reloadStory(');
    ok(/ownSetFiles\(import\.meta\.env\.BASE_URL\)\.catch\(\(\) => null\),/.test(story) && !/shippedAsk/.test(story) && !/story-private/.test(plugin), "the player's own story's index is no part of the list and is asked for at every boot, since the launcher serves a folder named at run time there");
    ok(/if \(planet\.dem && !shippedAsk\(`\$\{planet\.dem\.url\}\/base16\.raw`\)\)/.test(text('src/world/world.ts')), 'a real-elevation raster is asked for only where the build ships it');
  }

  // ---- the built list: the tracked files on disk, and nothing else ----
  {
    const root = new URL('../../../', import.meta.url);
    const rootPath = decodeURIComponent(root.pathname).replace(/^\/([A-Za-z]:)/, '$1');
    // A sanity check of this checkout, not of the rule (the scratch repository below is that): its committed track and
    // raster are listed.
    const list = shippedPublic(rootPath);
    if (spawnSync('git', ['rev-parse', '--git-dir'], { cwd: rootPath, encoding: 'utf8' }).status === 0) {
      ok(list.includes('tracks/tatooine.json') && list.includes('dem/monument/base16.raw') && list.every((p) => /^(tracks|placements|dem)\//.test(p)), `this checkout's list holds its committed track and raster, and nothing outside the three folders (${list.length})`);
    } else console.log('note this checkout is not a git checkout: the list of the repository itself is not checked');
    // The rule, in a scratch repository of our own, so nothing of this one is touched: a file committed and there is
    // listed; a file on disk and not committed is not (a placements file, a raster); a file committed and since taken
    // off the disk is not.
    const scratch = mkdtempSync(join(tmpdir(), 'packfiles-'));
    try {
      const run = (args: string[]) => spawnSync('git', args, { cwd: scratch, encoding: 'utf8' });
      if (run(['init', '-q']).status === 0) {
        mkdirSync(join(scratch, 'public', 'tracks'), { recursive: true });
        mkdirSync(join(scratch, 'public', 'placements', 'story'), { recursive: true });
        mkdirSync(join(scratch, 'public', 'dem', 'test_canyon'), { recursive: true });
        writeFileSync(join(scratch, 'public', 'tracks', 'test_world.json'), '{}');
        writeFileSync(join(scratch, 'public', 'tracks', 'test_gone.json'), '{}');
        writeFileSync(join(scratch, 'public', 'dem', 'test_canyon', 'base.json'), '{}');
        run(['add', 'public/tracks/test_world.json', 'public/tracks/test_gone.json', 'public/dem/test_canyon/base.json']);
        run(['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', 'test']);
        writeFileSync(join(scratch, 'public', 'placements', 'story', 'test_world.json'), '{}');
        writeFileSync(join(scratch, 'public', 'dem', 'test_canyon', 'base16.raw'), 'raster');
        rmSync(join(scratch, 'public', 'tracks', 'test_gone.json'));
        const got = shippedPublic(scratch);
        ok(JSON.stringify(got) === JSON.stringify(['dem/test_canyon/base.json', 'tracks/test_world.json']), `the list is the committed files still on disk: a placements file and a raster on disk and not committed are not listed (a release refuses them), nor is a committed file taken off the disk (${got.join(', ')})`);
      } else console.log('note git could not make a scratch repository: the rule of the list is not checked');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  // ---- the rules, by the converter's own lists, in both directions, and the packs on disk ----
  {
    ok(JSON.stringify([...F.SERVER_WORLDS].sort()) === JSON.stringify([...CORE3_WORLDS].sort()), "the worlds the server populated are the converter's own (`CORE3_WORLDS`)");
    // Asked for where the converter writes the file.
    for (const f of ['pois.json', 'sounds.json', 'nav.json', 'clouds.json', 'map.json', 'spawns.json']) ok(F.packHolds('tatooine', f), `a ground world the server populated is asked for its ${f}`);
    ok(F.packHolds('kashyyyk_main', 'map.json') && F.packHolds('kashyyyk_main', 'nav.json') && F.packHolds('dungeon1', 'spawns.json') && F.packHolds('dungeon1', 'nav.json'), "a zone of a split planet for its map picture and walk grid, the copies' world for its people and walk grid");
    // And for none where it writes none: these are what a rule loosened back to "ask everyone" would ask again.
    for (const f of ['pois.json', 'sounds.json', 'nav.json', 'clouds.json', 'map.json', 'spawns.json', 'gates.json']) {
      ok(!F.packHolds('space_tatooine', f) && !F.packHolds('gallery', f), `neither a space zone nor the gallery is asked for ${f}`);
    }
    ok(!F.packHolds('dungeon1', 'map.json'), "the copies' world is asked for no map picture");
    ok(!F.packHolds('kashyyyk_main', 'spawns.json') && !F.packHolds('mustafar', 'spawns.json') && !F.packHolds('kashyyyk_pob_dungeons', 'spawns.json'), 'no world the server never populated is asked for `spawns.json`');
    for (const p of PLANETS.filter((w) => w.pack === false)) ok(['pois.json', 'travel.json', 'manifest.json'].every((f) => !F.packHolds(p.id, f)), `${p.id}, which declares no pack, is held to no file at all`);
    ok(F.packHolds('test_unnamed', 'map.json') && F.packHolds('test_unnamed', 'spawns.json'), 'and a pack no world names is asked for every file, as it always was');
    const dir = process.env.SWG3JS_PACKS ?? join(decodeURIComponent(ROOT.pathname).replace(/^\/([A-Za-z]:)/, '$1'), 'assets-private');
    const gated = ['pois.json', 'sounds.json', 'nav.json', 'clouds.json', 'map.json', 'spawns.json', 'gates.json'];
    if (!existsSync(dir)) console.log(`note no packs at ${dir}: the rules are not held to any`);
    else {
      let packs = 0;
      const stillMissed: string[] = [];
      for (const pack of readdirSync(dir)) {
        const man = join(dir, pack, 'manifest.json');
        if (!existsSync(man) || !F.worldOfPack(pack)) continue;
        packs++;
        ok(!F.packless(F.worldOfPack(pack)), `${pack}: a converted pack belongs to no world that declares none`);
        for (const file of gated) {
          const has = existsSync(join(dir, pack, file));
          ok(F.packHolds(pack, file) || !has, `${pack}: the rule ${F.packHolds(pack, file) ? 'asks for' : 'skips'} ${file}, which the pack ${has ? 'has' : 'has not'}`);
          if (F.packHolds(pack, file) && !has) stillMissed.push(`${pack}/${file}`);
        }
        const manifest = JSON.parse(readFileSync(man, 'utf8')) as { categories?: Record<string, { cells?: unknown[] }[]> };
        const cells = Object.values(manifest.categories ?? {}).some((list) => list.some((d) => !!d.cells?.length));
        for (const file of ['floors.json', 'doors.json']) ok(cells || !existsSync(join(dir, pack, file)), `${pack}: ${file} is ${cells ? 'asked for (it has cells)' : 'not asked for, and it has none'}`);
      }
      console.log(`note ${packs} packs held to the rules; asked for and not there, once a session each: ${stillMissed.join(', ') || 'none'}`);
    }
  }
} finally {
  globalThis.fetch = realFetch;
  F.forgetFiles();
}

console.log(`${checks} checks passed`);
