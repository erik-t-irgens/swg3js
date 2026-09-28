// Laying the wild world out: lairs, herds and camps, and where they stand.
//
// The rules are pure, so this runs the real ones. Where the packs are converted it then lays out the
// **real** worlds and prints what comes of it, which is the only way to know that a rule tuned on a
// fixture does something sensible over four hundred and fifty real areas.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CORE3_HEALTH,
  LAIR_CONDITION,
  LAIR_TUNE,
  WORLD_BOX,
  areaAt,
  areaSize,
  bodyAt,
  CAMP_TURN,
  campLayout,
  clearOfPieces,
  inPieces,
  coverage,
  creatureAt,
  flatEnough,
  gridSites,
  inside,
  isCamp,
  lairLevelOf,
  levelOf,
  nestHealth,
  nudgeSite,
  oneKind,
  refused,
  reinforcements,
  respawnWait,
  rolls,
  seedOf,
  spreadOf,
  standingAt,
  wanted,
  weighted,
  type GroupEntry,
  type LairDef,
  type LairSite,
  type SpawnArea,
} from '../../../src/world/mobiles/lairs.ts';
import { CORE3_MAP } from '../mobiles.mjs';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}

const circle = (r: number, name = 'a', x = 0, z = 0, groups = ['g']): SpawnArea => ({ name, shape: 'circle', x, z, r, groups, cap: 64 });
const worldArea = (groups = ['w']): SpawnArea => ({ name: 'world', shape: 'rect', x: 0, z: 0, x2: 0, z2: 0, groups, cap: 2048, world: true });
const nest = (over: Partial<LairDef> = {}): LairDef => ({ kind: 'creature_lair', mobiles: [{ who: 'thing', n: 1 }], boss: [], cap: 15, nest: 'a.iff', building: '', people: false, ...over });
const herd = (over: Partial<LairDef> = {}): LairDef => nest({ nest: null, building: 'none', ...over });
const camp = (over: Partial<LairDef> = {}): LairDef => nest({ kind: 'npc_theater', nest: 'object/building/poi/c.iff', building: 'theater', people: true, ...over });
const entry = (lair: string, over: Partial<GroupEntry> = {}): GroupEntry => ({ lair, weight: 1, count: 15, size: 25, limit: -1, minDiff: 1, maxDiff: 8, ...over });

// ------------------------------------------------------------------ the numbers must not be rolled
{
  const a = rolls(1234);
  const b = rolls(1234);
  ok(a() === b() && a() === b(), 'the same seed gives the same stream, which is what lets two browsers lay the same world');
  ok(rolls(1234)() !== rolls(1235)(), 'and a different seed a different one');
  const many: number[] = [];
  const r = rolls(7);
  for (let i = 0; i < 4000; i++) many.push(r());
  ok(many.every((v) => v >= 0 && v < 1), 'every number is inside nought to one');
  const mean = many.reduce((s, v) => s + v, 0) / many.length;
  ok(Math.abs(mean - 0.5) < 0.02, `and they sit about the middle (mean ${mean.toFixed(3)}), so nothing it decides is lopsided`);
  ok(seedOf('w', 'a', 0) !== seedOf('w', 'a', 1) && seedOf('w', 'a', 0) !== seedOf('w', 'b', 0), 'a seed is made from the world, a name and an index, so no two sites share one');
}

// ------------------------------------------------------------------ shapes, and which area a point is in
{
  ok(inside(circle(500), 300, 0) && !inside(circle(500), 600, 0), 'a circle holds what is within its radius');
  const ring: SpawnArea = { name: 'r', shape: 'ring', x: 0, z: 0, r: 900, inner: 500, groups: ['g'], cap: 64 };
  ok(inside(ring, 700, 0) && !inside(ring, 100, 0), 'a ring keeps its hole');
  const box: SpawnArea = { name: 'b', shape: 'rect', x: -200, z: -400, x2: 600, z2: 100, groups: ['g'], cap: 64 };
  ok(inside(box, 0, 0) && !inside(box, 700, 0), 'a rectangle is its own box');
  ok(Math.abs(areaSize(circle(100)) - Math.PI * 1e4) < 1e-6 && areaSize(box) === 800 * 500, 'an area knows how much ground it covers');

  const big = circle(3000, 'big');
  const small = circle(200, 'small', 100, 0);
  const all = () => true;
  ok(areaAt([big, small], 100, 50, all) === small, 'a point in two areas belongs to the smaller, as the server would have drawn it from whichever the player stood in most narrowly');
  ok(areaAt([big, small], 2000, 0, all) === big, 'and to the bigger where only that one holds it');
  const w = worldArea();
  ok(areaAt([w, big], 5000, 5000, all) === w, "a point no area holds belongs to the world-wide one, whose own shape is a placeholder");
  ok(areaAt([w, big], 0, 0, all) === big, 'and never where a real area holds it, since the world-wide one is only the fallback');
  ok(areaAt([big], 5000, 0, all) === null, 'with no world-wide area, a point outside every area has none');
  ok(areaAt([big, small], 100, 50, (a) => a !== small) === big, 'an area with nothing this pack can put down is passed over');

  const plain: SpawnArea = { ...circle(100, 'town'), groups: [] };
  const ringOnly: SpawnArea = { ...circle(100, 'ring'), groups: [], world: true };
  ok(refused([plain], 0, 0, false) && refused([plain], 0, 0, true), 'a place nothing may stand refuses every site');
  ok(!refused([ringOnly], 0, 0, false) && refused([ringOnly], 0, 0, true), "a town's ring keeps out only the world-wide area's sites, as the server's own rule did");
}

// ------------------------------------------------------------------ the weighted draw, the levels
{
  const list = [
    { lair: 'common', weight: 90 },
    { lair: 'rare', weight: 10 },
  ];
  let common = 0;
  for (let i = 0; i < 5000; i++) if (weighted(list, rolls(i))?.lair === 'common') common++;
  ok(Math.abs(common / 5000 - 0.9) < 0.03, `a weight of ninety against ten comes out about nine in ten (${((common / 5000) * 100).toFixed(1)}%)`);
  ok(weighted([], rolls(1)) === null, 'and an empty list draws nothing rather than throwing');
  ok(weighted([{ lair: 'a', weight: 0 }, { lair: 'b', weight: 0 }], rolls(1)) !== null, 'a list whose weights are all nought still gives one, since the data has such rows');

  const seen = [0, 0, 0, 0, 0];
  const r = rolls(99);
  for (let i = 0; i < 20000; i++) seen[levelOf(r()) - 1]++;
  const shares = seen.map((n) => n / 20000);
  ok(shares.every((s, i) => Math.abs(s - LAIR_TUNE.levels[i]) < 0.015), `building levels come out at their weights (${shares.map((s) => s.toFixed(2)).join(', ')})`);
  ok(levelOf(0) === 1 && levelOf(0.9999) === 5, 'and span one to five');

  ok(lairLevelOf({ minDiff: 20, maxDiff: 30 }, 0.5, 0) === 20 && lairLevelOf({ minDiff: 20, maxDiff: 30 }, 0.5, 0.9999) === 30, "a lair's own level runs its group's whole band");
  const open = lairLevelOf({ minDiff: 40, maxDiff: 500 }, 0.9999, 0.9999);
  ok(open >= 45 && open <= 50, `and a band with no ceiling (500) is five to ten past its floor, as the server read it (${open})`);
}

// ------------------------------------------------------------------ the grid
{
  const groups: Record<string, GroupEntry[]> = { g: [entry('L')], w: [entry('W')], s: [entry('S')] };
  const tune = { ...LAIR_TUNE, cell: 240, fill: 0.6 };
  const areas = [circle(4000)];
  const a = gridSites('w', areas, [], groups, tune);
  const b = gridSites('w', areas, [], groups, tune);
  ok(a.length > 200 && a.every((s, i) => s.key === b[i].key && s.x === b[i].x && s.z === b[i].z && s.lair === b[i].lair && s.level === b[i].level), `laying the same world twice lays the same ${a.length} sites, which is the whole point of drawing them`);
  ok(gridSites('v', areas, [], groups, tune).some((s, i) => a[i] && (s.x !== a[i].x || s.z !== a[i].z)), 'and another world lays its own');
  ok(a.every((s) => inside(areas[0], s.x, s.z)), 'every site lies in an area that may put something down');
  // The cells: at most one site each, inside its own cell.
  const cells = new Set(a.map((s) => s.key));
  ok(cells.size === a.length && a.every((s) => {
    const [, i, j] = s.key.split(':').map(Number);
    return s.x >= i * tune.cell && s.x < (i + 1) * tune.cell && s.z >= j * tune.cell && s.z < (j + 1) * tune.cell;
  }), 'each cell holds at most one site, drawn inside that cell');
  // The share of cells: about `fill` of those the area covers, less the gap.
  const covered = (Math.PI * 4000 * 4000) / (tune.cell * tune.cell);
  ok(a.length / covered > 0.45 && a.length / covered < 0.62, `about ${tune.fill} of the cells the area covers hold a site, less those the gap takes (${(a.length / covered).toFixed(2)})`);
  const full = gridSites('w', areas, [], groups, { ...tune, fill: 1 });
  ok(full.length > a.length, `every cell filled lays more (${full.length} against ${a.length})`);

  // The gap: no two sites nearer than the server's gap and the larger footprint.
  let nearest = Infinity;
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) nearest = Math.min(nearest, Math.hypot(a[i].x - a[j].x, a[i].z - a[j].z));
  ok(nearest >= LAIR_TUNE.gap + 25, `no two sites stand nearer than the server's gap plus the footprint (${nearest.toFixed(0)} m, at least ${LAIR_TUNE.gap + 25})`);
  const loose = gridSites('w', areas, [], groups, { ...tune, gap: 0 });
  ok(loose.length > a.length, `and without the gap more stand (${loose.length}), so it is the gap that spaced them`);

  // The smallest area wins, and the world-wide one fills everywhere else.
  const w = worldArea();
  const s = circle(600, 'small', 1000, 1000, ['s']);
  const laid = gridSites('w', [w, s], [], groups, tune);
  const inSmall = laid.filter((x) => inside(s, x.x, x.z));
  ok(inSmall.length > 0 && inSmall.every((x) => x.area === 'small' && x.lair === 'S'), `every site inside the small area is its own (${inSmall.length}), not the world's`);
  ok(laid.filter((x) => !inside(s, x.x, x.z)).every((x) => x.area === 'world' && x.lair === 'W'), 'and every other site across the whole world is the world-wide area\'s');
  ok(laid.every((x) => Math.abs(x.x) <= 8000 && Math.abs(x.z) <= 8000), 'and nothing is laid off the edge of the world');

  // The places nothing may stand.
  const town: SpawnArea = { ...circle(1500, 'town', -3000, -3000), groups: [] };
  const ring: SpawnArea = { ...circle(1500, 'ring', 3000, -3000), groups: [], world: true };
  const inRing = circle(700, 'newbie', 3000, -3000, ['s']);
  const kept = gridSites('w', [w, inRing], [town, ring], groups, tune);
  ok(!kept.some((x) => inside(town, x.x, x.z)), 'nothing stands in a town');
  ok(kept.some((x) => inside(inRing, x.x, x.z)) && !kept.some((x) => inside(ring, x.x, x.z) && x.area === 'world'), "and a town's ring keeps out the world's sites while its own newbie area still lays them");

  // Levels drawn per site.
  ok(new Set(a.map((x) => x.level)).size === 5 && a.every((x) => x.lairLevel >= 1 && x.lairLevel <= 8), 'every site draws its building level (all five come up) and its own level inside its band');
}

// ------------------------------------------------------------------ what stands at a site
{
  const g = standingAt(nest(), { seed: 1, level: 3 });
  ok(g >= LAIR_TUNE.guards[0] && g <= LAIR_TUNE.guards[1], `a nest has ${LAIR_TUNE.guards[0]} or ${LAIR_TUNE.guards[1]} standing at it (${g}), the owner's own count`);
  // The server's rule for a camp or a herd: a third of its limit, and one more at level four or five.
  ok(standingAt(camp({ cap: 15 }), { seed: 1, level: 1 }) === 5 && standingAt(camp({ cap: 15 }), { seed: 1, level: 3 }) === 5, 'a camp whose limit is fifteen stands five at the lower levels');
  ok(standingAt(camp({ cap: 15 }), { seed: 1, level: 4 }) === 6 && standingAt(herd({ cap: 15 }), { seed: 1, level: 5 }) === 6, 'and six at four or five, a herd the same, as the server\'s own sum gives');
  ok(standingAt(herd({ cap: 9 }), { seed: 1, level: 2 }) === 3 && standingAt(herd({ cap: 2 }), { seed: 1, level: 1 }) === 1 && standingAt(herd({ cap: 0 }), { seed: 1, level: 1 }) === 1, 'a smaller limit stands fewer, and never nobody');
  ok(spreadOf(herd()) > spreadOf(nest()), 'a herd is spread wider than a guard, which keeps close to its nest');
  ok(oneKind(nest()) && !oneKind(herd()) && !oneKind(camp()) && isCamp(camp()) && !isCamp(nest()), 'a nest holds one kind; a herd and a camp do not, and only a camp is a camp');

  // A nest holds one kind, and its boss stands first; a camp and a herd draw every body on its own.
  const many = [{ who: 'a', n: 1 }, { who: 'b', n: 1 }];
  const picks = new Set<string>();
  for (let i = 1; i < 6; i++) picks.add(creatureAt(nest({ mobiles: many }), 555, i) ?? '');
  ok(picks.size === 1, 'every ordinary body at one nest is the same kind, which is what a nest is');
  const withBoss = nest({ boss: [{ who: 'big', n: 1 }] });
  ok(creatureAt(withBoss, 1, 0) === 'big' && creatureAt(withBoss, 1, 1) !== 'big', 'a lair with a boss stands it first and the rest ordinary');
  let mixed = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) seen.add(creatureAt(camp({ mobiles: many }), seed, i) ?? '');
    if (seen.size > 1) mixed++;
  }
  ok(mixed > 40, `a camp draws each of its people on its own, so ${mixed} of 50 camps stand both kinds, where one nest stands one`);
  const weightedList = [{ who: 'leader', n: 1 }, { who: 'pack', n: 3 }];
  let pack = 0;
  for (let seed = 1; seed <= 400; seed++) for (let i = 0; i < 5; i++) if (creatureAt(herd({ mobiles: weightedList }), seed, i) === 'pack') pack++;
  ok(Math.abs(pack / 2000 - 0.75) < 0.04, `and draws them by the list's own weights, as the server's weighted list does (${((pack / 2000) * 100).toFixed(0)}% of three to one)`);
  ok(creatureAt(camp({ mobiles: many }), 7, 3) === creatureAt(camp({ mobiles: many }), 7, 3), 'the same site and index draw the same body in every browser');

  // Bodies stand round the middle, not on it.
  const site = { x: 1000, z: -1000, seed: 42 };
  for (let i = 0; i < 20; i++) {
    const b = bodyAt(site, i, LAIR_TUNE.guardSpread);
    const d = Math.hypot(b.x - site.x, b.z - site.z);
    assert.ok(d > 0 && d <= LAIR_TUNE.guardSpread + 1e-6, 'a body stands within its spread');
  }
  ok(true, 'every body stands round the middle and inside its own spread, so nothing is placed on top of the nest');
}

// ------------------------------------------------------------------ a nest's health, reinforcement, respawn
{
  ok(CORE3_HEALTH.base === CORE3_MAP.hpBase && CORE3_HEALTH.scale === CORE3_MAP.hpScale && CORE3_HEALTH.min === CORE3_MAP.hpMin && CORE3_HEALTH.max === CORE3_MAP.hpMax, "a nest's health is carried by the converter's own health curve, number for number, so it is on the creatures' scale");
  const at = (level: number, lairLevel: number, seed = 5): number => nestHealth({ seed, level, lairLevel });
  ok(at(1, 10) < at(2, 10) && at(2, 10) < at(3, 10) && at(3, 10) < at(4, 10) && at(4, 10) < at(5, 10), `a higher building level is a tougher nest (${[1, 2, 3, 4, 5].map((l) => at(l, 10)).join(', ')} at level ten)`);
  ok(at(3, 60) > at(3, 10), 'and a lair of a higher level is tougher at the same building level');
  const most = Math.round(CORE3_HEALTH.base + CORE3_HEALTH.scale * Math.sqrt(LAIR_CONDITION.max));
  ok(at(5, 400) === most, `the server's ceiling of ${LAIR_CONDITION.max} is ${most} here, and nothing goes past it`);
  let lo = Infinity;
  let hi = 0;
  for (let s = 0; s < 500; s++) {
    const h = at(1 + (s % 5), 5 + (s % 60), s);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  ok(lo >= CORE3_HEALTH.min && hi <= most && hi > lo * 3, `nests differ, which is the owner's reason for the server's numbers (${lo} to ${hi})`);
  ok(at(3, 30, 9) === at(3, 30, 9), 'and the same site draws the same health in every browser');

  ok(reinforcements(nest(), 4, 0) === 0, 'a lair just struck sends nobody: it has a clock');
  ok(reinforcements(nest(), 4, 99) === LAIR_TUNE.reinforce, 'once the clock is out it sends more');
  ok(reinforcements(nest({ cap: 5 }), 5, 99) === 0, "and never past the cap the server's own data puts on that nest");
  ok(reinforcements(nest({ cap: 5 }), 4, 99) === 1, 'sending only the room that is left');

  const w = respawnWait(7);
  ok(w >= LAIR_TUNE.respawn[0] && w <= LAIR_TUNE.respawn[1], `a broken lair stays broken for ${Math.round(w)} s, inside the band`);
}

// ------------------------------------------------------------------ what is standing now
{
  const sites = Array.from({ length: 40 }, (_, i): LairSite => ({ key: `k${i}`, area: 'a', lair: 'L', x: i * 50, z: 0, seed: i, size: 25, level: 3, lairLevel: 10 }));
  const none = new Set<string>();
  const first = wanted(sites, { x: 0, z: 0 }, none);
  ok(first.add.length === LAIR_TUNE.liveLairs, `at most ${LAIR_TUNE.liveLairs} stand at once, however many are near`);
  ok(first.add[0].key === 'k0' && first.add[1].key === 'k1', 'and the nearest go up first');
  const live = new Set(first.add.map((s) => s.key));
  const again = wanted(sites, { x: 0, z: 0 }, live);
  ok(again.add.length === 0 && again.drop.length === 0, 'standing still changes nothing, so nothing churns');
  const away = wanted(sites, { x: 3000, z: 0 }, live);
  ok(away.drop.length === live.size, 'walking away puts every one of them down');
  const held = new Set(['k30']);
  const near = wanted(sites, { x: 1500, z: 0 }, held);
  ok(!near.drop.includes('k30'), 'and one still in range is kept even while nearer ones are going up, so a fight is never interrupted');
}

// ------------------------------------------------------------------ onto ground somebody can walk
{
  const all = () => true;
  ok(nudgeSite(10, 20, all, 30)?.x === 10, 'a site on open ground stays where it was laid');
  // A lake twenty metres across round the site: the nearest shore is found, the same every time.
  const lake = (x: number, z: number) => Math.hypot(x, z) > 20;
  const out = nudgeSite(0, 0, lake, 30);
  ok(!!out && Math.hypot(out.x, out.z) > 20 && Math.hypot(out.x, out.z) <= 22.1, `a site in a lake moves to its nearest shore (${out ? Math.hypot(out.x, out.z).toFixed(1) : '-'} m out)`);
  const again = nudgeSite(0, 0, lake, 30);
  ok(!!again && again.x === out!.x && again.z === out!.z, 'and to the same point every time, so every browser holding the grid moves it alike');
  ok(nudgeSite(0, 0, (x, z) => Math.hypot(x, z) > 40, 30) === null, 'one with no open ground within reach is dropped');

  // The server's own test of the ground: no more than fifteen metres of rise over twenty metres.
  ok(flatEnough(0, 0, () => 5) && flatEnough(0, 0, (x) => 0.7 * x), 'level ground passes, and so does a slope rising fourteen metres over the twenty');
  ok(!flatEnough(0, 0, (x) => 0.8 * x) && !flatEnough(0, 0, (x, z) => (x > 5 && z > 5 ? 30 : 0)), 'a slope rising sixteen over them does not, nor a cliff in one corner');
  ok(LAIR_TUNE.flatReach === 10 && LAIR_TUNE.flatRise === 15, "and the numbers are the server's own (a square ten metres either way, fifteen metres of rise)");
  // A steep flank rising to a shelf thirty metres along.
  const hill = (x: number) => (x < 30 ? 1.2 * x : 36);
  ok(!flatEnough(0, 0, hill), 'the steep flank itself is refused');
  const walked = nudgeSite(0, 0, (x, z) => flatEnough(x, z, hill), 60);
  ok(!!walked && flatEnough(walked.x, walked.z, hill) && walked.x > 20, `and a site on it moves up onto the shelf, ground the server would have used (${walked ? walked.x.toFixed(0) : '-'} m along)`);
}

// ------------------------------------------------------------------ a camp's pieces
{
  const models = { 'tent.glb': { bounds: { min: [-2, 0, -1], max: [2, 2, 1] } }, 'stool.glb': { bounds: { min: [-0.3, 0, -0.3], max: [0.3, 0.3, 0.3] } } };
  const pieces = [
    { model: 'tent.glb', place: [5, 0, 0], angles: [90, 0, 0] },
    { model: 'stool.glb', place: [0, 0.3, 3], angles: [0, 0, 0] },
  ];
  const flat = campLayout(pieces, models, 0);
  ok(flat[0].x === -5 && flat[0].z === 0, "a piece's place is mirrored in x with its camp, as every placed object is");
  ok(Math.abs(flat[0].yaw + Math.PI / 2) < 1e-9, 'and its yaw turned to its negative');
  ok(flat[1].lift === 0.3 && flat[1].x === -0 && flat[1].z === 3, "and a piece set on another keeps its lift, which is the client data's own");
  ok(Math.abs(flat[0].radius - Math.hypot(4, 2) / 2) < 1e-9, "a footprint holds the whole of the model's box");
  const turned = campLayout(pieces, models, Math.PI / 2);
  ok(Math.abs(turned[0].x - 0) < 1e-9 && Math.abs(turned[0].z - 5) < 1e-9 && Math.abs(turned[0].yaw - 0) < 1e-9, "and the whole camp turns about its middle as three turns an object, the pieces' own turns with it");
  ok(CAMP_TURN === 0, "a camp stands at the server's own turn, which is none: `spawnTheater` sets its building's place and nothing else");

  // Its people stand clear of it.
  const spot = clearOfPieces(-5, 0.2, flat);
  ok(Math.hypot(spot.x - flat[0].cx, spot.z - flat[0].cz) >= flat[0].radius + 0.6 - 1e-9, 'a spot inside a tent is moved out of it, so nobody is stood on its roof or in its box');
  const free = clearOfPieces(10, 10, flat);
  ok(free.x === 10 && free.z === 10, 'and a spot already clear is left where it was');
  ok(inPieces(-5, 0.2, flat) && !inPieces(spot.x, spot.z, flat) && !inPieces(10, 10, flat), 'and whether a spot is inside a piece is the same footprint the clearing measures');
}

// ------------------------------------------------------------------ coverage, on a fixture world
{
  // A world whose one area is its eastern half: a site can only be in reach of that half and a strip.
  const east: SpawnArea = { name: 'east', shape: 'rect', x: 0, z: -8000, x2: 8000, z2: 8000, groups: ['g'], cap: 64 };
  const groups = { g: [entry('L')] };
  const sites = gridSites('fixture', [east], [], groups);
  const got = coverage(sites, WORLD_BOX, 60);
  ok(got.points === 3600, 'coverage is measured over sixty by sixty points of the whole square');
  ok(got.share > 0.35 && got.share < 0.5, `a world with things in half of it has a site in reach of about half of it (${(got.share * 100).toFixed(1)}%)`);
  ok(coverage([], WORLD_BOX).share === 0 && coverage([{ x: 0, z: 0 }], { x0: -10, z0: -10, x1: 10, z1: 10 }, 4).share === 1, 'and nothing covers nothing, while one site covers a patch round it wholly');
  const denser = coverage(gridSites('fixture', [east], [], groups, { ...LAIR_TUNE, fill: 1 }), WORLD_BOX, 60);
  ok(denser.share >= got.share, `every cell filled covers at least as much (${(denser.share * 100).toFixed(1)}%)`);
}

// ------------------------------------------------------------------ the real worlds, where converted
{
  const manFile = join('assets-private', 'spawns', 'manifest.json');
  if (!existsSync(manFile)) {
    note('no spawns pack here, so the rules above stand on their own');
  } else {
    const man = JSON.parse(readFileSync(manFile, 'utf8')) as {
      groups: Record<string, GroupEntry[]>;
      lairs: Record<string, LairDef>;
      creatures: Record<string, unknown>;
      nests: Record<string, { file: string }>;
      camps?: Record<string, unknown[]>;
    };
    let sites = 0;
    let nests = 0;
    let camps = 0;
    let herds = 0;
    let noLair = 0;
    let bodies = 0;
    let least = 1;
    const worlds: string[] = [];
    for (const world of ['tatooine', 'naboo', 'corellia', 'dantooine', 'lok', 'endor', 'dathomir', 'yavin4', 'talus', 'rori']) {
      const f = join('assets-private', world, 'spawns.json');
      if (!existsSync(f)) continue;
      worlds.push(world);
      const pack = JSON.parse(readFileSync(f, 'utf8')) as { areas: SpawnArea[]; noSpawn: SpawnArea[] };
      const laid = gridSites(world, pack.areas, pack.noSpawn, man.groups);
      const share = coverage(laid, WORLD_BOX).share;
      least = Math.min(least, share);
      note(`${world}: ${laid.length} sites, ${(share * 100).toFixed(1)}% of the world within ${LAIR_TUNE.build} m of one`);
      for (const s of laid) {
        sites++;
        const def = man.lairs[s.lair];
        if (!def) {
          noLair++;
          continue;
        }
        if (isCamp(def)) camps++;
        else if (oneKind(def)) nests++;
        else herds++;
        bodies += standingAt(def, s);
      }
    }
    if (worlds.length) {
      note(`${worlds.length} worlds -> ${sites} sites: ${nests} nests, ${camps} camps, ${herds} herds; ${(bodies / Math.max(1, sites)).toFixed(1)} bodies a site`);
      ok(least >= 0.6, `every world has a site within reach of at least ${(least * 100).toFixed(0)}% of it, which is what the grid is for (the old division reached 17 to 30)`);
      ok(noLair === 0, 'and every site names a lair the pack really carries');
    }

    // The thing that would make a lair invisible: no model for its nest, or no pieces for its camp.
    let modelled = 0;
    let bare = 0;
    let pieced = 0;
    let campsBare = 0;
    for (const def of Object.values(man.lairs)) {
      if (!def.nest) continue;
      if (isCamp(def)) {
        if (man.camps?.[def.nest]) pieced++;
        else campsBare++;
      } else if (man.nests?.[def.nest]) modelled++;
      else bare++;
    }
    note(`nests: ${modelled} of ${modelled + bare} have a model converted; camps: ${pieced} of ${pieced + campsBare} have their pieces`);
    ok(modelled > 0, 'the nests a lair stands round are converted, so a lair is a thing you can see and hit');

    // Every creature a site could stand must reach a body, or the world has holes in it.
    let named = 0;
    let missing = 0;
    for (const def of Object.values(man.lairs)) {
      for (const m of [...def.mobiles, ...def.boss]) {
        named++;
        if (!man.creatures[m.who]) missing++;
      }
    }
    note(`${named} creature slots over every lair, ${missing} of them naming something the pack has no body for`);
    ok(missing / Math.max(1, named) < 0.06, 'nearly every creature a lair names reaches a body this game can draw');
  }
}

console.log(`\n${passed} checks passed`);
