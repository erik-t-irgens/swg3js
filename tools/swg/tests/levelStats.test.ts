// A body's numbers at a level of the console's choosing (src/world/levelStats.ts): the catalogue's own
// curve, copied into the runtime by value and held here against the converter's, and the rows nearest a
// level read the way the catalogue reads one row.
//
// Where the owner's catalogue is converted the rule is also run over it, to see that it gives every row
// back its own numbers when asked for that row's own level alone.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CORE3_CURVE, LEVEL_SAMPLES, curveOf, levelSamples, statsAtLevel, type LevelSample } from '../../../src/world/levelStats.ts';
import { CORE3_MAP } from '../mobiles.mjs';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// --- the curve is the catalogue's --------------------------------------------------------------------

{
  const map = CORE3_MAP as Record<string, number>;
  const differs = Object.entries(CORE3_CURVE).filter(([k, v]) => map[k] !== v);
  ok(differs.length === 0, `the runtime's curve is the converter's, number for number${differs.length ? `: ${differs.map(([k]) => k).join(', ')}` : ''}`);
  // The catalogue's own worked example: a pool of 405 and a damage of 70 to 75 is 191 and 18.
  const s = curveOf(405, 72.5);
  ok(s.hp === 191 && s.damage === 18, `a pool of 405 and a mean damage of 72.5 give ${s.hp} and ${s.damage}, as the catalogue stands such a body`);
  const lo = curveOf(0, 0);
  const hi = curveOf(1e12, 1e12);
  ok(lo.hp === CORE3_CURVE.hpBase && lo.damage === CORE3_CURVE.damageBase && hi.hp === CORE3_CURVE.hpMax && hi.damage === CORE3_CURVE.damageMax, 'and it is clamped at both ends as the catalogue clamps it');
}

// --- reading the rows --------------------------------------------------------------------------------

{
  const entries = [
    { kind: 'npc', stats: { source: 'core3', core3: { level: 10, ham: [900, 1100], damage: [90, 110] } } },
    { kind: 'dressed', stats: { source: 'core3', core3: { level: 12, ham: [1000, 1200], damage: [100, 120] } } },
    { kind: 'creature', stats: { source: 'core3', core3: { level: 10, ham: [4000, 5000], damage: [300, 320] } } },
    { kind: 'npc', stats: { source: 'heuristic', core3: { level: 10, ham: [900, 1100], damage: [90, 110] } } },
    { kind: 'npc', stats: { source: 'core3', core3: { level: 0, ham: [900], damage: [1, 2] } } },
    { kind: 'npc', stats: { source: 'core3', core3: { level: 20, ham: null, damage: [1, 2] } } },
    { kind: 'npc', stats: null },
  ];
  const rows = levelSamples(entries);
  ok(rows.length === 3, `only rows the emulator wrote with a level, a pool and a damage are read (${rows.length} of ${entries.length})`);
  ok(rows[0].ham === 900 && rows[0].damage === 100 && rows[0].person && !rows[2].person, "each row's first pool and mean damage, and whether it is a person");
  const at10 = statsAtLevel(10, rows, true, 1);
  ok(!!at10 && at10.hp === curveOf(900, 100).hp && at10.damage === curveOf(900, 100).damage && at10.near[0] === 10, "a person at a level a row has is that row's numbers through the curve");
  const beast = statsAtLevel(10, rows, false, 1);
  ok(!!beast && beast.hp === curveOf(4000, 310).hp, 'a creature is read from the creatures, which run on other pools at the same level');
  const mid = statsAtLevel(11, rows, true, 2);
  ok(!!mid && mid.rows === 2 && mid.hp === curveOf(950, 105).hp && mid.near[0] === 10 && mid.near[1] === 12, 'between two rows, the middle of the two, and the span it was read from');
  ok(statsAtLevel(10, rows.filter((r) => !r.person), true, 1)?.hp === curveOf(4000, 310).hp, "a kind with no rows of its own is read from everybody's");
  ok(statsAtLevel(0, rows, true) === null && statsAtLevel(10, [], true) === null && statsAtLevel(Number.NaN, rows, true) === null, 'no level, or no rows at all, is no answer: the body keeps its own numbers');
  ok(LEVEL_SAMPLES > 1, `the rows read about a level: the nearest ${LEVEL_SAMPLES}`);
}

// --- over the owner's catalogue, where it is converted ------------------------------------------------

{
  const file = join('assets-private', 'mobiles', 'catalogue.json');
  if (!existsSync(file)) console.log('note no mobiles catalogue here, so the rule is not run over the real one');
  else {
    const cat = JSON.parse(readFileSync(file, 'utf8')) as { entries: { id: string; kind: string; stats: { source?: string; hp?: number; damage?: number; core3?: unknown } }[] };
    const rows: LevelSample[] = levelSamples(cat.entries);
    ok(rows.length > 100, `${rows.length} of the catalogue's rows carry their emulator level, pool and damage`);
    // Asked for a row's own level with that one row alone, the rule gives the row back the numbers the
    // catalogue stood it with: the same curve over the same two figures.
    let same = 0;
    let asked = 0;
    for (const e of cat.entries) {
      const one = levelSamples([e]);
      if (!one.length) continue;
      asked++;
      const s = statsAtLevel(one[0].level, one, one[0].person, 1);
      if (s && s.hp === e.stats.hp && s.damage === e.stats.damage) same++;
    }
    ok(asked > 0 && same === asked, `every row asked for its own level alone is given its own numbers back (${same} of ${asked})`);
    const person60 = statsAtLevel(60, rows, true);
    ok(!!person60 && person60.hp > curveOf(0, 0).hp && person60.near[0] <= 60 && person60.near[1] >= 50, `a person at level 60 reads ${person60?.hp} health and ${person60?.damage} a blow off the rows at levels ${person60?.near.join(' to ')}`);
  }
}

console.log(`\n${checks} checks passed`);
