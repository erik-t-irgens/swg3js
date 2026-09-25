// Laying the wild world out: lairs, herds and where they stand.
//
// The rules are pure, so this runs the real ones. Where the packs are converted it then lays out the
// **real** worlds and prints what comes of it, which is the only way to know that a rule tuned on a
// fixture does something sensible over four hundred and fifty real areas.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LAIR_TUNE,
  areaSpan,
  bodyAt,
  creatureAt,
  inside,
  lairHealth,
  lairSites,
  pointIn,
  reinforcements,
  respawnWait,
  rolls,
  seedOf,
  spreadOf,
  standingAt,
  wanted,
  weighted,
  type CreatureDef,
  type GroupEntry,
  type LairDef,
  type SpawnArea,
} from '../../../src/world/mobiles/lairs.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}

const circle = (r: number): SpawnArea => ({ name: 'a', shape: 'circle', x: 0, z: 0, r, groups: ['g'], cap: 64 });
const nest = (over: Partial<LairDef> = {}): LairDef => ({ kind: 'creature_lair', mobiles: [{ who: 'thing', n: 1 }], boss: [], cap: 15, nest: 'a.iff', building: '', people: false, ...over });
const herd = (over: Partial<LairDef> = {}): LairDef => nest({ nest: null, building: 'none', ...over });

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
  ok(seedOf('w', 'a', 0) !== seedOf('w', 'a', 1) && seedOf('w', 'a', 0) !== seedOf('w', 'b', 0), 'a seed is made from the world, the area and the index, so no two sites share one');
}

// ------------------------------------------------------------------ a point lands inside its shape
{
  const shapes: SpawnArea[] = [
    circle(500),
    { name: 'r', shape: 'ring', x: 100, z: -50, r: 900, inner: 500, groups: ['g'], cap: 64 },
    { name: 'b', shape: 'rect', x: -200, z: -400, x2: 600, z2: 100, groups: ['g'], cap: 64 },
  ];
  for (const s of shapes) {
    let all = true;
    for (let i = 0; i < 500; i++) if (!inside(s, ...(Object.values(pointIn(s, rolls(i))) as [number, number]))) all = false;
    ok(all, `every point drawn in a ${s.shape} lands inside it, its hole included`);
  }
  // Evenly over the area, not crowded into the middle: half the radius holds a quarter of them.
  const c = circle(1000);
  let innerHalf = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const p = pointIn(c, rolls(i * 31 + 7));
    if (Math.hypot(p.x, p.z) < 500) innerHalf++;
  }
  ok(Math.abs(innerHalf / N - 0.25) < 0.03, `points spread evenly over the ground rather than crowding the centre (${((innerHalf / N) * 100).toFixed(1)}% in the inner half, a quarter is even)`);
}

// ------------------------------------------------------------------ the weighted draw
{
  const list = [
    { lair: 'common', weight: 90 },
    { lair: 'rare', weight: 10 },
  ];
  let common = 0;
  for (let i = 0; i < 5000; i++) if (weighted(list, rolls(i))?.lair === 'common') common++;
  ok(Math.abs(common / 5000 - 0.9) < 0.03, `a weight of ninety against ten comes out about nine in ten (${((common / 5000) * 100).toFixed(1)}%)`);
  ok(weighted([], rolls(1)) === null, 'and an empty list draws nothing rather than throwing');
  const zero = [{ lair: 'a', weight: 0 }, { lair: 'b', weight: 0 }];
  ok(weighted(zero, rolls(1)) !== null, 'a list whose weights are all nought still gives one, since the data has such rows');
}

// ------------------------------------------------------------------ what stands at a site
{
  const groups: Record<string, GroupEntry[]> = { g: [{ lair: 'L', weight: 1, count: 15, size: 25, limit: -1, minDiff: 1, maxDiff: 8 }] };
  const small = lairSites('w', circle(100), groups);
  const big = lairSites('w', circle(4000), groups);
  ok(small.length === 1, 'a small ring holds one site');
  ok(big.length > 8 && big.length <= LAIR_TUNE.perArea, `a whole quarter of a world holds ${big.length}, capped at ${LAIR_TUNE.perArea}`);
  ok(lairSites('w', circle(100), {}).length === 0, 'and an area whose groups are missing holds none rather than a site with no lair');
  const again = lairSites('w', circle(4000), groups);
  ok(big.every((s, i) => s.x === again[i].x && s.z === again[i].z && s.lair === again[i].lair), 'laying the same area twice gives the same sites, which is the whole point of drawing them');

  // Guards and herds, and the owner's own count.
  const g = standingAt(nest(), 1);
  ok(g >= LAIR_TUNE.guards[0] && g <= LAIR_TUNE.guards[1], `a lair has ${LAIR_TUNE.guards[0]} or ${LAIR_TUNE.guards[1]} standing at it (${g})`);
  const h = standingAt(herd(), 1);
  ok(h >= LAIR_TUNE.herd[0] && h <= LAIR_TUNE.herd[1], `a herd with nothing to stand round has ${h}`);
  ok(spreadOf(herd()) > spreadOf(nest()), 'and a herd is spread wider than a guard, which keeps close to its nest');

  // A nest holds one kind, and its boss stands first.
  const many = nest({ mobiles: [{ who: 'a', n: 1 }, { who: 'b', n: 1 }] });
  const picks = new Set<string>();
  for (let i = 1; i < 6; i++) picks.add(creatureAt(many, 555, i) ?? '');
  ok(picks.size === 1, 'every ordinary body at one nest is the same kind, which is what a nest is');
  const withBoss = nest({ boss: [{ who: 'big', n: 1 }] });
  ok(creatureAt(withBoss, 1, 0) === 'big' && creatureAt(withBoss, 1, 1) !== 'big', 'a lair with a boss stands it first and the rest ordinary');

  // Bodies stand round the middle, not on it.
  const site = { key: 'k', area: 'a', lair: 'L', x: 1000, z: -1000, seed: 42 };
  for (let i = 0; i < 20; i++) {
    const b = bodyAt(site, i, LAIR_TUNE.guardSpread);
    const d = Math.hypot(b.x - site.x, b.z - site.z);
    assert.ok(d > 0 && d <= LAIR_TUNE.guardSpread + 1e-6, 'a body stands within its spread');
  }
  ok(true, 'every body stands round the middle and inside its own spread, so nothing is placed on top of the nest');
}

// ------------------------------------------------------------------ health, reinforcement, respawn
{
  const creatures: Record<string, CreatureDef> = {
    weak: { id: 'w', level: 3, hp: 90, hpMax: 110, damage: [5, 9], diet: 'herbivore', kind: 'herbivore', aggressive: false, herd: true, pack: false, social: '' },
    hard: { id: 'h', level: 80, hp: 4000, hpMax: 5000, damage: [400, 600], diet: 'carnivore', kind: 'carnivore', aggressive: true, herd: false, pack: true, social: '' },
  };
  const soft = lairHealth(nest({ mobiles: [{ who: 'weak', n: 1 }] }), creatures);
  const tough = lairHealth(nest({ mobiles: [{ who: 'hard', n: 1 }] }), creatures);
  ok(tough > soft, 'a nest of something dangerous takes longer to break than a nest of vermin');
  ok(soft >= LAIR_TUNE.healthRange[0] && tough <= LAIR_TUNE.healthRange[1], `and both stay inside the band (${soft} and ${tough})`);
  ok(lairHealth(nest({ mobiles: [{ who: 'nobody', n: 1 }] }), creatures) >= LAIR_TUNE.healthRange[0], 'a lair whose creature we have no numbers for still has health rather than none');

  ok(reinforcements(nest(), 4, 0) === 0, 'a lair just struck sends nobody: it has a clock');
  ok(reinforcements(nest(), 4, 99) === LAIR_TUNE.reinforce, 'once the clock is out it sends more');
  ok(reinforcements(nest({ cap: 5 }), 5, 99) === 0, "and never past the cap the server's own data puts on that nest");
  ok(reinforcements(nest({ cap: 5 }), 4, 99) === 1, 'sending only the room that is left');

  const w = respawnWait(7);
  ok(w >= LAIR_TUNE.respawn[0] && w <= LAIR_TUNE.respawn[1], `a broken lair stays broken for ${Math.round(w)} s, inside the band`);
}

// ------------------------------------------------------------------ what is standing now
{
  const sites = Array.from({ length: 40 }, (_, i) => ({ key: `k${i}`, area: 'a', lair: 'L', x: i * 50, z: 0, seed: i }));
  const none = new Set<string>();
  const first = wanted(sites, { x: 0, z: 0 }, none);
  ok(first.add.length === LAIR_TUNE.liveLairs, `at most ${LAIR_TUNE.liveLairs} stand at once, however many are near`);
  ok(first.add[0].key === 'k0' && first.add[1].key === 'k1', 'and the nearest go up first');
  const live = new Set(first.add.map((s) => s.key));
  const again = wanted(sites, { x: 0, z: 0 }, live);
  ok(again.add.length === 0 && again.drop.length === 0, 'standing still changes nothing, so nothing churns');
  const away = wanted(sites, { x: 3000, z: 0 }, live);
  ok(away.drop.length === live.size, 'walking away puts every one of them down');
  // A lair being fought is not dropped because a nearer one appeared.
  const held = new Set(['k30']);
  const near = wanted(sites, { x: 1500, z: 0 }, held);
  ok(!near.drop.includes('k30'), 'and one still in range is kept even while nearer ones are going up, so a fight is never interrupted');
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
      creatures: Record<string, CreatureDef>;
      nests: Record<string, { file: string }>;
    };
    let areas = 0;
    let sites = 0;
    let withNest = 0;
    let herds = 0;
    let noLair = 0;
    let bodies = 0;
    const worlds: string[] = [];
    for (const world of ['tatooine', 'naboo', 'corellia', 'dantooine', 'lok', 'endor', 'dathomir', 'yavin4', 'talus', 'rori']) {
      const f = join('assets-private', world, 'spawns.json');
      if (!existsSync(f)) continue;
      worlds.push(world);
      const pack = JSON.parse(readFileSync(f, 'utf8')) as { areas: SpawnArea[] };
      for (const a of pack.areas) {
        areas++;
        for (const s of lairSites(world, a, man.groups)) {
          sites++;
          const def = man.lairs[s.lair];
          if (!def) {
            noLair++;
            continue;
          }
          if (def.nest) withNest++;
          else herds++;
          bodies += standingAt(def, s.seed);
        }
      }
    }
    note(`${worlds.length} worlds, ${areas} areas -> ${sites} sites: ${withNest} lairs with a nest, ${herds} herds with none`);
    note(`${bodies} creatures in all if every one of them stood at once, which is why only ${LAIR_TUNE.liveLairs} are ever up`);
    ok(sites > 500, `the fleet lays ${sites} sites, which is a world with things in it rather than an empty one`);
    ok(noLair === 0, 'and every site names a lair the pack really carries');

    // The thing that would make a lair invisible: no model for its nest.
    let modelled = 0;
    let bare = 0;
    for (const [, def] of Object.entries(man.lairs)) {
      if (!def.nest) continue;
      if (man.nests?.[def.nest]) modelled++;
      else bare++;
    }
    note(`nests: ${modelled} of ${modelled + bare} have a model converted`);
    ok(modelled > 0, 'the nests a lair stands round are converted, so a lair is a thing you can see and hit');

    // Every creature a site could stand must reach a body, or the world has holes in it.
    let named = 0;
    let missing = 0;
    for (const [, def] of Object.entries(man.lairs)) {
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
