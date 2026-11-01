// No-build zones for players (Map-maker II's eighth wave, DESIGN.md §2.10): a deed's ghost, the console's house (and the
// relay path's `tryOnly`, which makes every test and builds nothing) and a prop are refused inside a zone in its own words,
// a house given its height (`given`: one a server or this machine already holds) is stood inside one whatever it says, the
// world row's `cities: 'noBuild'` reaches the pack's own cities, Core3's no-build areas and the client's no-build radii (and
// never a city of ours, merged into the very list the game hands the index, that players may build in), and the editor only
// notes a zone. The answer is the game's own (`PlaceIndex.wordsAt`, which `App.noBuildHere` calls and nothing else): a house
// is asked about by its patch's middle and its clear circle, never its doorstep, which an off-centre patch turned a quarter
// tells apart both ways; a prop and the editor's prop note by its half-width. Day one: with no zone handed in, the ghost's and
// the prop's verdicts over a thousand spots are fc246b4's (out of git) to the field, and hash to the trace recorded from it,
// which holds where git cannot hand the old code over.
//
// Run: node tools/swg/tests/noBuild.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ghostVerdict, type GhostDeps } from '../../../src/world/placeGhost.ts';
import { patchOfBounds } from '../../../src/world/housePlace.ts';
import { NO_TURN, propVerdict, type PropDeps } from '../../../src/world/propPlace.ts';
import { buildingNotes, propNotes } from '../../../src/editor/devVerdict.ts';
import { PlaceIndex, PlaceIndexKeeper, mergeLocations, type MapPlace } from '../../../src/world/places.ts';
import type { LocationRow } from '../../../src/world/editFiles/locationsFile.ts';
import { loadOldMany } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const read = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);
/** Where the wave began, and what its ghost and prop answered over the day-one spots, hashed (see the day-one block). */
const PRE_WAVE = 'fc246b4';
const PRE_WAVE_VERDICTS = '1d34f62dc84fd119';

// A town of ours made no-build, about the centre (0, 0) (a real-elevation world's frame: raw x mirrored), and the world row's
// switch on, over the pack's own city and the game's no-build rows.
const rows: LocationRow[] = [
  { id: 'world', kind: 'world', cities: 'noBuild' },
  { id: 'town', kind: 'city', name: 'Dune Town', shape: { kind: 'circle', c: [-100, 0], r: 50 }, build: false },
];
const idx = new PlaceIndex().build({
  rows,
  centre: { x: 0, z: 0 },
  pois: [{ name: 'Mos Town', x: -400, z: 0, r: 120, kind: 'city' }],
  noBuild: [
    { from: 'region', name: 'old_quarter', shape: 'rect', x: -700, z: -20, x2: -660, z2: 20 },
    { from: 'radius', x: -900, z: 0, r: 32, t: 'object/building/tatooine/shared_bank_tatooine.iff' },
  ],
});
/** The game's own answer, the very function `App.noBuildHere` calls (pinned below). */
const zone = (what: 'house' | 'prop' | 'editor', index: PlaceIndex = idx) => (x: number, z: number, r: number): string | null => index.wordsAt(x, z, r, what);
const flat: GhostDeps = { heightAt: () => 0, waterAt: () => -Infinity, standing: () => [], zone: zone('house') };
const patch = patchOfBounds({ min: [-8, -2, -8], max: [8, 6, 8] });

{
  // A deed's ghost.
  ok(ghostVerdict(patch, { x: 100, z: 0 }, 0, flat).why === 'nobody may build in Dune Town', "a deed's ghost inside a town of ours made no-build is refused in its words");
  ok(ghostVerdict(patch, { x: 400, z: 0 }, 0, flat).why === 'nobody may build in Mos Town', "inside the game's own city under the world row's switch");
  ok(/the game keeps Old Quarter clear/.test(ghostVerdict(patch, { x: 680, z: 0 }, 0, flat).why ?? '') && /this close to/.test(ghostVerdict(patch, { x: 900, z: 0 }, 0, flat).why ?? ''), "inside a no-build area, beside a placed thing's no-build radius");
  ok(ghostVerdict(patch, { x: 250, z: 0 }, 0, flat).ok, 'between them it may stand');
  // The patch's own clear circle counts: a house whose middle is outside the town but whose ground reaches it is refused.
  const c = ghostVerdict(patch, { x: 160, z: 0 }, 0, flat);
  ok(!c.ok && c.why === 'nobody may build in Dune Town', `a house reaching the zone by its clear circle (${c.clear.toFixed(1)} m) is refused`);
  ok(ghostVerdict(patch, { x: 100, z: 0 }, 0, { ...flat, zone: undefined }).ok, 'with no zone handed in (the editor writing a permanent file) nothing is a zone');
  // The ground's and the water's words come first: a zone is asked after what is in the way.
  ok(ghostVerdict(patch, { x: 100, z: 0 }, 0, { ...flat, waterAt: () => 5 }).why === 'that is under water', 'the water is said before a zone');
}

{
  // A prop.
  const deps: PropDeps = { floorAt: () => 0, solidAt: () => false, zone: zone('prop') };
  const box = { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] };
  const v = propVerdict(box, { x: 100, y: 0, z: 0 }, NO_TURN, deps);
  ok(!v.ok && v.why === 'nobody may put things down in Dune Town', "a prop inside a zone is refused in a thing's words");
  ok(propVerdict(box, { x: 250, y: 0, z: 0 }, NO_TURN, deps).ok, 'outside every zone it may stand');
  const guarded = propVerdict(box, { x: 100, y: 0, z: 0 }, NO_TURN, { ...deps, reserved: () => 'the inn' });
  ok(/part of this world \(the inn\)/.test(guarded.why ?? ''), "a story's guard is said before a zone");
  ok(propVerdict(box, { x: 100, y: 0, z: 0 }, NO_TURN, { floorAt: () => 0, solidAt: () => false }).ok, 'with no zone handed in nothing is a zone');
}

{
  // The editor notes a zone and refuses nothing.
  const editorDeps: GhostDeps = { ...flat, zone: zone('editor') };
  const notes = buildingNotes(patch, { x: 100, z: 0 }, 0, editorDeps, 0, false, { notes: [], y: Number.NaN, blocker: null, refuses: false });
  ok(notes.notes.includes('inside Dune Town, where players may not build'), "the editor's house notes say a zone in its own words");
  const pn = propNotes({ min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }, { x: 100, y: 0, z: 0 }, NO_TURN, { floorAt: () => 0, solidAt: () => false, zone: zone('editor') }, false, []);
  ok(pn.includes('inside Dune Town, where players may not build'), "and its prop notes");
  const ed = read('src/editor/editorEntry.ts');
  ok((ed.match(/zone: \(x, z, r\) => host\.zoneNote\?\.\(x, z, r\) \?\? null,/g) ?? []).length === 2, "the editor's ghost and prop ask the game's zone in the editor's words");
  const main = read('src/main.ts');
  ok(/zoneNote: \(x, z, r\) => this\.noBuildHere\(x, z, r, 'editor'\),/.test(main), 'which the game answers from the same index');
}

{
  // A house is asked about by its patch's middle and its clear circle, never its doorstep: a patch reaching 40 m one way from
  // its origin and turned a quarter (its middle 20 m along the game's +x from the doorstep), beside a zone of 10 m.
  const lone = new PlaceIndex().build({ rows: [{ id: 'yard', kind: 'zone', name: 'The Yard', shape: { kind: 'circle', c: [-1000, 0], r: 10 }, build: false }], centre: { x: 0, z: 0 } });
  const long = patchOfBounds({ min: [-4, -2, 0], max: [4, 6, 40] });
  const turned = Math.PI / 2;
  const deps: GhostDeps = { heightAt: () => 0, waterAt: () => -Infinity, standing: () => [], zone: zone('house', lone) };
  const C = ghostVerdict(long, { x: 0, z: 0 }, turned, deps).clear;
  // The middle's circle reaches the yard and the doorstep's does not.
  const a = ghostVerdict(long, { x: 1000 - 20 - (10 + C - 5), z: 0 }, turned, deps);
  ok(!a.ok && a.why === 'nobody may build in The Yard', `a house whose middle's clear circle (${C.toFixed(1)} m) reaches a zone is refused though its doorstep is ${(25 + C).toFixed(1)} m off`);
  // The doorstep's circle reaches it and the middle's does not.
  const b = ghostVerdict(long, { x: 1000 + (10 + C - 5), z: 0 }, turned, deps);
  ok(b.ok, 'and one whose doorstep stands by the zone while its middle stands clear of it may stand');
  // The editor's note asks the same circle in its own words.
  const editorDeps: GhostDeps = { ...deps, zone: zone('editor', lone) };
  const na = buildingNotes(long, { x: 1000 - 20 - (10 + C - 5), z: 0 }, turned, editorDeps, 0, false, { notes: [], y: Number.NaN, blocker: null, refuses: false });
  const nb = buildingNotes(long, { x: 1000 + (10 + C - 5), z: 0 }, turned, editorDeps, 0, false, { notes: [], y: Number.NaN, blocker: null, refuses: false });
  ok(na.notes.includes('inside The Yard, where players may not build') && !nb.notes.some((n) => /The Yard/.test(n)), "and the editor's house note by the same middle and circle, both ways round");
  // A prop by its half-width: a box 4 m across whose middle stands 11 m from the yard's, a metre outside it.
  const wide = { min: [-2, 0, -2], max: [2, 1, 2] };
  const pd: PropDeps = { floorAt: () => 0, solidAt: () => false, zone: zone('prop', lone) };
  const pv = propVerdict(wide, { x: 1011, y: 0, z: 0 }, NO_TURN, pd);
  ok(!pv.ok && pv.why === 'nobody may put things down in The Yard', "a prop whose middle is outside a zone but whose half-width reaches into it is refused, in a thing's words");
  ok(propVerdict(wide, { x: 1013, y: 0, z: 0 }, NO_TURN, pd).ok, 'and one whose half-width falls short may stand');
  const pn = propNotes(wide, { x: 1011, y: 0, z: 0 }, NO_TURN, { floorAt: () => 0, solidAt: () => false, zone: zone('editor', lone) }, false, []);
  ok(pn.includes('inside The Yard, where players may not build'), "and the editor's prop note reaches it by the same half-width");
}

{
  // A city of ours players may build in stays open under the world row's switch: the game hands the index the merged places
  // list (`mergeLocations`), which carries our city as a row of kind city, and only the pack's own cities are the switch's.
  const ours: LocationRow[] = [
    { id: 'world', kind: 'world', cities: 'noBuild' },
    { id: 'open', kind: 'city', name: 'Open Town', shape: { kind: 'circle', c: [-3000, 0], r: 200 }, build: true },
    { id: 'shut', kind: 'city', name: 'Shut Town', shape: { kind: 'circle', c: [-4000, 0], r: 200 }, build: false },
  ];
  const pack: MapPlace[] = [{ name: 'Mos Town', x: -400, z: 0, r: 120, kind: 'city' }];
  const file = { locations: ours, pois: mergeLocations(pack, ours), noBuild: [] };
  ok(file.pois.length === 3 && file.pois[1].ours === true && file.pois[1].kind === 'city', 'the merged list carries both cities of ours as rows of kind city');
  const keeper = new PlaceIndexKeeper();
  const index = keeper.now(file, { x: 0, z: 0 }, 0, false, () => true);
  ok(index.counts.city === 1 && index.counts.ours === 1, `under the switch the pack's own city alone is the switch's, and the city of ours made no-build is ours (${JSON.stringify(index.counts)})`);
  ok(index.wordsAt(3000, 0, 0, 'house') === null, "a city of ours that says players may build in it is open, the world row's switch on");
  ok(index.wordsAt(4000, 0, 0, 'house') === 'nobody may build in Shut Town' && index.wordsAt(400, 0, 0, 'house') === 'nobody may build in Mos Town', 'while the one made no-build, and the game\'s own city, are shut');
}

{
  // The game's hand-overs: a player's own ghost and prop ask the zone, a permanent file's never does; `placeBuilding` asks it
  // only inside its `!given && !force` block, before the `tryOnly` answer; and the one answer is the index's own `wordsAt`.
  const main = read('src/main.ts');
  ok(/private noBuildHere\(x: number, z: number, r: number, what: 'house' \| 'prop' \| 'editor'\): string \| null \{\s*return this\.placesNow\(\)\.wordsAt\(x, z, r, what\);\s*\}/.test(main), "the game's one answer is the index's own wordsAt, the circle and the words handed on as they came");
  ok(/zone: \(x, z, r\) => \(this\.placing && this\.placing\.dest !== 'yours' \? null : this\.noBuildHere\(x, z, r, 'house'\)\),/.test(main), "a player's ghost asks the zone, and one bound for a permanent file does not");
  ok(/zone: \(x: number, z: number, r: number\) => \(this\.propPlacing && this\.propPlacing\.dest !== 'yours' \? null : this\.noBuildHere\(x, z, r, 'prop'\)\),/.test(main), "a player's prop the same");
  ok(/this\.world\.noBuildWords = \(x, z, r\) => this\.noBuildHere\(x, z, r, 'house'\);/.test(main), "the world's console house asks the game's own answer");
  const world = read('src/world/world.ts');
  const block = /if \(!given && !opts\.force\) \{([\s\S]*?)\n    \}\n    \/\/ Every test made and nothing built/.exec(world)?.[1] ?? '';
  ok(/const zoned = this\.noBuildWords\?\.\(mid\.x, mid\.z, clear\) \?\? null;\s*if \(zoned\) return \{ \.\.\.verdict, ok: false, key, x: at\.x, z: at\.z, yaw, clear, why: zoned, building: null \};/.test(block), "placeBuilding asks the zone inside its !given && !force block, in the zone's own words");
  ok((world.match(/this\.noBuildWords/g) ?? []).length === 1, 'and nowhere else: a house given its height is stood where it stands whatever a zone says');
  ok(/\n    if \(opts\.tryOnly\) return \{ ok: true/.test(world.slice(world.indexOf(block))), "the relay path's tryOnly is answered after it, so a zone refuses it too");
  ok(!/says nothing marks a no-build zone|nothing in the archives marks a no-build zone/i.test(world), "the old comment that nothing in the archives marks a no-build zone is gone");
}

{
  // Day one: with no zone handed in, today's ghost and prop verdicts are fc246b4's to the field, and their trace hashes to the
  // one recorded from fc246b4 (`PRE_WAVE_VERDICTS`), which is what holds on a machine where git cannot hand the old code over.
  const old = await loadOldMany(['src/world/placeGhost.ts', 'src/world/propPlace.ts'], ['src/world/placeGhost.ts', 'src/world/propPlace.ts'], PRE_WAVE);
  const [og, op] = (old ?? [null, null]) as [typeof import('../../../src/world/placeGhost.ts') | null, typeof import('../../../src/world/propPlace.ts') | null];
  let s = 3;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  let differ = 0;
  const now: string[] = [];
  const then: string[] = [];
  for (let k = 0; k < 1000; k++) {
    const bump = rnd() * 3;
    const wet = rnd() < 0.1 ? 10 : -Infinity;
    const thing = rnd() < 0.2;
    const deps: GhostDeps = { heightAt: (x, z) => Math.sin(x * 0.05) * bump + Math.cos(z * 0.07) * bump, waterAt: () => wet, standing: () => (thing ? [{ x: 0, z: 0, radius: 400, template: 'object/building/shared_x.iff' }] : []) };
    const at = { x: rnd() * 400 - 200, z: rnd() * 400 - 200 };
    const yaw = rnd() * 6.28;
    const lift = rnd() * 2 - 1;
    const a = JSON.stringify(ghostVerdict(patch, at, yaw, deps, lift));
    now.push(a);
    if (og) {
      const b = JSON.stringify(og.ghostVerdict(patch, at, yaw, deps, lift));
      then.push(b);
      if (a !== b) differ++;
    }
    const pd: PropDeps = { floorAt: (x) => (x > 50 ? null : 0), solidAt: (_x, y) => y < -0.3 + rnd() * 0.01, reserved: thing ? () => 'the inn' : undefined };
    const box = { min: [-0.5, 0, -0.5], max: [0.5, rnd() * 2, 0.5] };
    const p = { x: at.x, y: rnd() - 0.5, z: at.z };
    s = (s + 7) >>> 0;
    const save = s;
    const pa = JSON.stringify(propVerdict(box, p, NO_TURN, pd));
    now.push(pa);
    if (op) {
      s = save;
      const pb = JSON.stringify(op.propVerdict(box, p, NO_TURN, pd));
      then.push(pb);
      if (pa !== pb) differ++;
    }
  }
  const hashNow = sha(now.join('\n'));
  if (!old) ok(hashNow === PRE_WAVE_VERDICTS, `git cannot hand ${PRE_WAVE} over: a thousand spots' ghost and prop verdicts with no zone handed in hash to the trace recorded from it (${hashNow})`);
  else {
    ok(differ === 0, `a thousand spots, a ghost's and a prop's verdict with no zone handed in, every field ${PRE_WAVE}'s (${differ} apart)`);
    const hashThen = sha(then.join('\n'));
    ok(hashThen === PRE_WAVE_VERDICTS && hashNow === PRE_WAVE_VERDICTS, `and ${PRE_WAVE}'s trace is the one recorded here for a machine where git cannot hand it over (${hashThen})`);
  }
}

console.log(`noBuild: ${checks} checks passed`);
