// A click on a place of ours on a world with no pack lands there (Map-maker II's eighth wave, DESIGN.md §2.10): Monument has
// no layout, so the teleport used to wait ten seconds for a layout centre that never came and then did nothing. The places
// file is measured about (0, 0) there (the galaxy's loader answers that centre), the world stands its places about the same
// (`World.placeFrame`: the layout's centre, or the stand-in (0, 0) a world with no pack is given at once), and the teleport,
// the places named round the eye and the ports read `placeFrame`. Held through the real `placeFromPois`, the real index and the
// real planet table, with the game's own reads pinned as text: a place of ours merged into Monument's list lands, by the
// teleport's own arithmetic, exactly where the index says the place is.
//
// Run: node tools/swg/tests/teleportPackless.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLANETS } from '../../../src/data/planets.ts';
import { centreAgrees, LOADING_TUNE, placeFromPois } from '../../../src/world/loadingTune.ts';
import { PlaceIndex, mergeLocations, type MapPlace } from '../../../src/world/places.ts';
import type { LocationRow } from '../../../src/world/editFiles/locationsFile.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const read = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const monument = PLANETS.find((p) => p.id === 'monument');
ok(!!monument && monument.pack === false && !!monument.dem, 'Monument is a real-elevation world with no pack');

{
  // The galaxy's loader: a world with no pack's places file is measured about (0, 0).
  const galaxy = read('src/ui/galaxyMap.ts');
  ok(/center: f\.center \?\? \(packless \? \{ x: 0, z: 0 \} : null\)/.test(galaxy), "the places file of a world with no pack answers the centre (0, 0)");
  // The world: a stand-in centre at once where there is no layout.
  const world = read('src/world/world.ts');
  ok(/get placeFrame\(\): \{ x: number; z: number \} \| null \{\s*return this\.layoutCenter \?\? this\.placeStandIn;/.test(world) && /this\.placeStandIn = \{ x: 0, z: 0 \};/.test(world), 'the world stands its places about its layout centre, or (0, 0) on a world with no pack');
}

{
  // The teleport's two reads, the places named round the eye and the ports, all on placeFrame.
  const main = read('src/main.ts');
  ok(/for \(let i = 0; i < 100 && !this\.world\.placeFrame; i\+\+\) await new Promise\(\(r\) => setTimeout\(r, 100\)\);\s*\/\/ A travel that did not reach the world/.test(main), "the teleport to another world waits on placeFrame, which a world with no pack answers at once");
  ok(/if \(centreAgrees\(this\.world\.placeFrame, centre, LOADING_TUNE\.centreSlack\)\) return;/.test(main), "and holds its place to the centre it travelled by");
  ok(/const c = this\.world\.placeFrame;\s*if \(!c\) return;\s*this\.traveling = true;/.test(main), 'a teleport on the world stands the place about placeFrame');
  ok(!/this\.world\.layoutCenter;\s*if \(!c\) return;\s*this\.traveling = true;/.test(main) && !/!this\.world\.layoutCenter; i\+\+/.test(main), 'and never on the layout centre a world with no pack never gets');
  ok(/private placesHere\(\): NamedPlace\[\] \{[\s\S]*?const c = this\.world\.placeFrame;/.test(main) && /private portsHere\(\): Port\[\] \{\s*const c = this\.world\.placeFrame;/.test(main), 'the places named round the eye and the ports read placeFrame');
}

{
  // A place of ours on Monument, clicked: the teleport's own arithmetic lands it where the index stands the place.
  const rows: LocationRow[] = [{ id: 'lookout', kind: 'landmark', name: 'The Lookout', shape: { kind: 'circle', c: [-1820.5, 640.25], r: 80 } }];
  const merged = mergeLocations([] as MapPlace[], rows);
  const poi = merged[0];
  ok(merged.length === 1 && poi.name === 'The Lookout', "the place is a row of Monument's places list");
  const centre = { x: 0, z: 0 };
  const g = placeFromPois(centre, poi);
  ok(g.x === 1820.5 && g.z === 640.25, 'the travel there is worked out about (0, 0), x mirrored');
  ok(centreAgrees(centre, { x: 0, z: 0 }, LOADING_TUNE.centreSlack), "and the world's own frame agrees with it, so no second screen");
  const idx = new PlaceIndex().build({ rows, centre });
  ok(idx.placeAt(g.x, g.z)?.id === 'lookout', 'the spot it lands on is inside the place, by the index the city line and the loading screen read');
  // The same-world branch, the game's own two lines read out of the teleport and run on the place: about placeFrame they
  // land on the very spot `placeFromPois` does.
  const main = read('src/main.ts');
  const lines = /const c = this\.world\.placeFrame;\s*if \(!c\) return;\s*this\.traveling = true;[\s\S]*?\n(\s*const gx = [^\n]+;)\n(\s*const gz = [^\n]+;)\n\s*this\.showLoadingLine\(planet, zoneId, \{ x: gx, z: gz \}\);/.exec(main);
  ok(!!lines && /^\s*const gx = -\(poi\.x - c\.x\);$/.test(lines[1]) && /^\s*const gz = poi\.z - c\.z;$/.test(lines[2]), "the teleport on the world stands the place by the world's own mirror about placeFrame (x mirrored, both recentred)");
  const run = new Function('poi', 'c', `${lines?.[1] ?? ''}\n${lines?.[2] ?? ''}\nreturn { gx, gz };`) as (p: { x: number; z: number }, c: { x: number; z: number }) => { gx: number; gz: number };
  const same = run(poi, centre);
  ok(same.gx === g.x && same.gz === g.z, 'and run on the place, a click on the world itself lands on the same spot as a travel there');
  const off = { x: 512.5, z: -77.25 };
  const viaPois = placeFromPois(off, poi);
  const viaClick = run(poi, off);
  ok(viaClick.gx === viaPois.x && viaClick.gz === viaPois.z, 'about a centre off the origin too (a converted world)');
}

console.log(`teleportPackless: ${checks} checks passed`);
