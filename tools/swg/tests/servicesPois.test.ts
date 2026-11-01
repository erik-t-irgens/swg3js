// The game's own services and no-build data in a world's places file (Map-maker II's eighth wave, the owner's amendment of
// 2026-10-31): the server's planetary map categories read off Core3's templates (`readMapCategories`), its region rows flagged
// NOBUILDZONEAREA kept beside the rest (`readRegions`' `noBuild`), both in the committed reference and read through the very
// source every command reads (`core3Source`); a service's kind by its category (the ports left to the places list, the
// terminals by their subcategory, a cloning category on a thing that is not a building a Force shrine); the services joined to
// a world's things one per spot; the no-build rows in the raw frame; `pois.json` carrying both as lists of their own beside
// `pois`, so no reader of the places list sees a new row; and `status` asking for `pois` again while a file carries neither.
// Over the converted packs where `assets-private` is there: every launch world's file carries both lists, Tatooine's cantinas,
// banks and shrines among its services.
//
// Run: node tools/swg/tests/servicesPois.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { noBuildOf, serviceKindOf, servicesOf } from '../../../tools/swg/places.mjs';
import { core3Source } from '../../../tools/swg/core3ref.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const read = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

{
  // A kind by its category.
  ok(serviceKindOf('cantina', undefined, 'object/building/tatooine/shared_cantina_tatooine.iff') === 'cantina' && serviceKindOf('bank', undefined, 'x') === 'bank', "a service's kind is its category");
  ok(serviceKindOf('starport', undefined, 'x') === null && serviceKindOf('shuttleport', undefined, 'x') === null && serviceKindOf(undefined, undefined, 'x') === null, 'the ports are the places list\'s own rows, and no category is none');
  ok(serviceKindOf('terminal', 'terminal_bank', 'x') === 'terminal_bank' && serviceKindOf('terminal', 'terminal_mission', 'x') === 'terminal_mission' && serviceKindOf('terminal', 'terminal_bazaar', 'x') === 'terminal_bazaar' && serviceKindOf('terminal', 'terminal_travel', 'x') === 'terminal', 'a terminal by its subcategory (bank, bazaar, mission), any other a plain terminal');
  ok(serviceKindOf('cloningfacility', undefined, 'object/building/tatooine/shared_cloning_tatooine.iff') === 'cloningfacility' && serviceKindOf('cloningfacility', undefined, 'object/tangible/jedi/shared_force_shrine_stone.iff') === 'shrine', 'a cloning category on a building is a cloning facility, on anything else a Force shrine');
}

{
  // Joined to a world's things, one per spot.
  const cats = new Map<string, { cat: string; sub?: string }>([
    ['object/building/a/shared_cantina.iff', { cat: 'cantina' }],
    ['object/tangible/terminal/shared_terminal_bank.iff', { cat: 'terminal', sub: 'terminal_bank' }],
    ['object/building/a/shared_starport.iff', { cat: 'starport' }],
  ]);
  const things = [
    { template: 'object/building/a/shared_cantina.iff', x: 10.123, z: -5 },
    { template: 'object/building/a/shared_cantina.iff', x: 10.5, z: -5.2 },
    { template: 'object/tangible/terminal/shared_terminal_bank.iff', x: 12, z: -5, state: 'restuss=living' },
    { template: 'object/building/a/shared_starport.iff', x: 100, z: 100 },
    { template: 'object/static/shared_rock.iff', x: 0, z: 0 },
  ];
  const s = servicesOf(things, cats);
  ok(s.length === 2 && s[0].kind === 'cantina' && s[0].x === 10.12 && s[1].kind === 'terminal_bank' && s[1].sub === 'terminal_bank' && s[1].state === 'restuss=living', 'a cantina placed twice on one spot is one, a bank terminal keeps its state, the port and the rock are none');
  ok(servicesOf(things, null).length === 0, 'with no categories (no reference) there are none');
  const n = noBuildOf(
    things,
    [
      { name: 'edge', shape: 'rect', x: -10, z: -10, x2: 10.555, z2: 10 },
      { name: 'round', shape: 'circle', x: 1, z: 2, r: 30 },
      { name: 'hoop', shape: 'ring', x: 1, z: 2, r: 30, inner: 10 },
      { name: 'odd', shape: 'cone', x: 0, z: 0 },
    ],
    (t: string) => (t.includes('cantina') ? 32 : t.includes('starport') ? 0 : null),
  );
  ok(n.filter((r: { from: string }) => r.from === 'region').length === 3 && n[0].x2 === 10.56 && n[2].inner === 10, "Core3's areas kept as a rectangle, a circle and a ring (a shape it does not draw left out), to the centimetre");
  ok(n.filter((r: { from: string }) => r.from === 'radius').length === 2 && n[3].t === 'object/building/a/shared_cantina.iff' && n[3].r === 32, "every thing whose template sets a no-build radius over nought, by its place, radius and template");
}

{
  // The committed reference, read as every command reads it.
  const src = core3Source();
  ok(src.kind === 'reference' && !src.missing, 'the Core3 reference is there and read');
  const cats = src.readMapCategories() as Map<string, { cat: string; sub?: string }>;
  ok(cats.size === 134, `the server's map lists ${cats.size} templates`);
  ok(cats.get('object/building/tatooine/shared_cantina_tatooine.iff')?.cat === 'cantina' && [...cats.keys()].every((k) => /^object\/.*\/shared_[^/]+\.iff$/.test(k)), "each keyed by its shared template, as a layout names it");
  const regions = src.readRegions() as Map<string, { noBuild: { name: string; shape: string }[] }>;
  let total = 0;
  for (const [, r] of regions) total += r.noBuild.length;
  ok(regions.size === 10 && total === 886, `Core3's no-build areas over the ten launch worlds: ${total}`);
  ok([...regions.values()].every((r) => r.noBuild.every((n) => n.shape === 'circle' || n.shape === 'rect' || n.shape === 'ring')), 'each a circle, a rectangle or a ring');
  const index = JSON.parse(read('tools/swg/core3ref/index.json')) as { readers?: Record<string, unknown> } & Record<string, unknown>;
  ok(JSON.stringify(index).includes('readMapCategories'), "the reference's index names the new reader");
}

{
  // The converter writes both lists beside the places, and status asks again for a file with neither.
  const cli = read('tools/swg/cli.mjs');
  ok(/pois, services, noBuild \}, vfs, 'pois'\);/.test(cli), "pois.json carries services and noBuild as lists of their own beside pois");
  ok(/else if \(!Array\.isArray\(pois\.services\) \|\| !Array\.isArray\(pois\.noBuild\)\) need\(`pois <swg-dir> all \$\{dir\} --retail-only`/.test(cli), 'status asks for pois again while a world\'s file carries neither');
  ok(/const noBuild = noBuildOf\(topLevel, mapData\.regions\.get\(planet\)\?\.noBuild \?\? \[\], \(t\) => resolveTemplateParam\(vfs, t, 'noBuildRadius', noBuildFloat, radiusCache\)\);/.test(cli), "the radius is the template chain's own noBuildRadius");
  const core3 = read('tools/swg/core3.mjs');
  ok(/export function readMapCategories\(/.test(core3) && /NOBUILDZONEAREA/.test(core3), 'Core3 is read for its map categories and its no-build areas, each in one function');
}

{
  // Over the converted packs.
  const root = new URL('../../../assets-private/', import.meta.url);
  const worlds = ['corellia', 'dantooine', 'dathomir', 'endor', 'lok', 'naboo', 'rori', 'talus', 'tatooine', 'yavin4'];
  const have = worlds.filter((w) => existsSync(new URL(`${w}/pois.json`, root)));
  if (!have.length) console.log('note no converted packs here: the packs are left out');
  else {
    let services = 0;
    let regions = 0;
    let radii = 0;
    const stale: string[] = [];
    for (const w of have) {
      const f = JSON.parse(readFileSync(new URL(`${w}/pois.json`, root), 'utf8')) as { services?: { kind: string }[]; noBuild?: { from: string }[]; pois: unknown[] };
      if (!Array.isArray(f.services) || !Array.isArray(f.noBuild)) {
        stale.push(w);
        continue;
      }
      services += f.services.length;
      regions += f.noBuild.filter((n) => n.from === 'region').length;
      radii += f.noBuild.filter((n) => n.from === 'radius').length;
    }
    if (stale.length) console.log(`note ${stale.join(', ')} converted before the services (status asks for pois)`);
    else {
      ok(services > 1000 && regions === 886 && radii > 500, `the launch worlds' files: ${services} services, ${regions} of Core3's no-build areas, ${radii} placed things' radii`);
      const tat = JSON.parse(readFileSync(new URL('tatooine/pois.json', root), 'utf8')) as { services: { kind: string }[] };
      const kinds = new Set(tat.services.map((s) => s.kind));
      ok(['cantina', 'bank', 'shrine', 'cloningfacility', 'terminal_mission'].every((k) => kinds.has(k)), `Tatooine's services carry its cantinas, banks, shrines, cloning facilities and mission terminals (${[...kinds].sort().join(', ')})`);
    }
  }
}

console.log(`servicesPois: ${checks} checks passed`);
