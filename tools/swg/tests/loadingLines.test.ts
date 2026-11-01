// A loading screen's line (Map-maker II's eighth wave, DESIGN.md §2.10): one of the lines of the smallest place of ours
// holding the destination, drawn by a hash of the moment (the same moment draws the same line, and over many moments every
// line is drawn); a place with none leaves the place round it, then the world row, to say one; the world row's for a
// destination in no place; and the planet's own description where the file has none. The game writes the line once the
// destination's file is read and never waits for it (`App.showLoadingLine`, `LoadingScreen.setBlurb`).
//
// Run: node tools/swg/tests/loadingLines.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadingLine, pickLine } from '../../../src/world/places.ts';
import type { LocationRow } from '../../../src/world/editFiles/locationsFile.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const DESC = 'A desert world.';
const rows: LocationRow[] = [
  { id: 'world', kind: 'world', loading: ['W1', 'W2'] },
  { id: 'region', kind: 'area', shape: { kind: 'rect', min: [-1000, -1000], max: [1000, 1000] }, loading: ['R1'] },
  { id: 'town', kind: 'city', shape: { kind: 'circle', c: [100, 100], r: 200 }, loading: ['T1', 'T2', 'T3'] },
  { id: 'quiet', kind: 'place', shape: { kind: 'circle', c: [-500, -500], r: 50 } },
];

{
  ok(['T1', 'T2', 'T3'].includes(loadingLine(rows, { x: 120, z: 90 }, 1234, DESC)), 'a destination in a town takes one of the town\'s lines (the smallest place holding it)');
  ok(loadingLine(rows, { x: 120, z: 90 }, 1234, DESC) === loadingLine(rows, { x: 120, z: 90 }, 1234, DESC), 'the same moment draws the same line');
  const seen = new Set<string>();
  for (let t = 0; t < 400; t++) seen.add(loadingLine(rows, { x: 120, z: 90 }, 1_790_000_000_000 + t * 9973, DESC));
  ok(seen.size === 3, `over many moments every one of the town's lines is drawn (${[...seen].sort().join(', ')})`);
  ok(loadingLine(rows, { x: 800, z: -800 }, 1, DESC) === 'R1', 'out of the town, the region round it');
  ok(loadingLine(rows, { x: -500, z: -500 }, 1, DESC) === 'R1', "a place with no lines of its own leaves the place round it to say one");
  ok(['W1', 'W2'].includes(loadingLine(rows, { x: 5000, z: 5000 }, 1, DESC)), "in no place, the world row's");
  ok(['W1', 'W2'].includes(loadingLine(rows, null, 1, DESC)), "and where the destination is not known, the world row's");
  ok(loadingLine(rows.filter((r) => r.id !== 'world'), { x: 5000, z: 5000 }, 1, DESC) === DESC, "with no world row, the planet's own description");
  ok(loadingLine([], { x: 120, z: 90 }, 1, DESC) === DESC && loadingLine([], null, 1, DESC) === DESC, "and with no file, the planet's own description, as every screen before");
  ok(pickLine([], 5) === null && pickLine(['only'], 5) === 'only', 'a list of none draws nothing, a list of one its one');
}

{
  // The game's hand-overs: the line is asked of the destination's own file and the screen's own planet.
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  ok(/if \(!f\.locations\.length \|\| !this\.loadingScreen\.showingPlanet\(planet\.id\)\) return;/.test(main), "a world with no file leaves the screen's own line (the planet's description) as it was, and a line for a trip overtaken is never written");
  ok(/const raw = at && c \? \{ x: c\.x - at\.x, z: at\.z \+ c\.z \} : null;\s*this\.loadingScreen\.setBlurb\(placeLoadingLine\(inState\(f\.locations\), raw, moment, planet\.description\)\);/.test(main), "the destination carried into the file's raw frame about its centre, and the line drawn from the rows standing now");
  ok(/this\.showLoadingLine\(planet, zoneId, \{ x: gx, z: gz \}\);/.test(main) && /this\.showLoadingLine\(planet, zoneId, opts\?\.at \?\? null\);/.test(main), 'a teleport to a place and a travel both ask for it');
  // Every arrival asks for it with where it stands (the session's first world from `play`, a ticket's landing, a world's own
  // arrival, the spot a travel stands, the spawn), and an arrival at its spawn asks again once the spawn is judged on the
  // real ground, while the screen is still up for that world.
  const arrive = /private arrive\(planet: PlanetDef, zoneId\?: string, at\?: THREE\.Vector3, home: ArrivalPlace \| null = null\): void \{([\s\S]*?)\n  \}\n/.exec(main)?.[1] ?? '';
  ok(/const stand = at \?\? this\.spawn;[\s\S]{0,400}?this\.showLoadingLine\(planet, this\.zone, stand\);/.test(arrive), 'every arrival asks for the line of the place it stands in');
  ok(/this\.spawn\.copy\(clearSpawn\);\s*p\.reset\(clearSpawn\.clone\(\)\.setY\(clearSpawn\.y \+ 0\.1\)\);[\s\S]{0,200}?this\.showLoadingLine\(planet, this\.zone, clearSpawn\);\s*return;/.test(arrive), 'and an arrival at its spawn asks again once the spawn is judged on the real ground');
  ok(/private async play\(c: SavedCharacter\): Promise<void> \{[\s\S]*?this\.loadingScreen\.show\(planet, planet\.name,[\s\S]*?this\.arrive\(planet, c\.zone,/.test(main), "the session's first world is an arrival, so it asks too");
  ok(/private showLoadingLine\([\s\S]*?const moment = this\.loadingScreen\.lineMoment;/.test(main), "every ask of one screen draws by the screen's own moment, so a place's line never flickers between its lines");
  const loading = readFileSync(new URL('../../../src/ui/loading.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  ok(/setBlurb\(text: string\): void \{\s*if \(this\.blurb\.textContent !== text\) this\.blurb\.textContent = text;/.test(loading), "the screen writes the line only when it differs (setBlurb)");
  ok(/if \(!this\.visible \|\| this\.hiding\) \{\s*this\.shownAt = performance\.now\(\);\s*this\.lineMoment = Date\.now\(\);\s*\}/.test(loading), "and takes its moment once, as it comes up, not again while it stands");
}

console.log(`loadingLines: ${checks} checks passed`);
