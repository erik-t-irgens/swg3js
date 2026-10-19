// The NPC ship ladder above tier 5 (src/space/tierLadder.ts) and its three readers: the loadout's grade
// (`pickLoadout`), the pilot's skill (`skillOfTier`) and the strength formulas (`tierDurability`, `tierDamage`).
//
// Day one: for tiers 1 to 5, and every number round them a caller could hand in, each reader answers exactly what it
// answered at the pass's base, loaded out of git beside today's (`atBase.ts`), and, where git cannot answer, the trace
// is held to the hash written down here from that base. Above 5 they read tier 5 at the default table; a moved table
// moves them; a tier above `top` reads as `top`. Synthetic components only: no number from the client's files.
//
// Run: node tools/swg/tests/tierLadder.test.ts
import assert from 'node:assert/strict';
import { TIER_LADDER_TUNE, gradeTier, ladderLine, skillTier, strengthTier, tuneTierLadder } from '../../../src/space/tierLadder.ts';
import { TIER_GRADE, pickLoadout, seeded } from '../../../src/space/loadout.ts';
import { PILOT_SKILL, skillOfTier } from '../../../src/space/pilot.ts';
import { tierDamage, tierDurability } from '../../../src/space/shipStats.ts';
import type { ComponentDef, FitDef, FitSlot } from '../../../src/vehicles/shipFit.ts';
import { PASS_BASE, atBase, traceHash } from './atBase.ts';
import { readFileSync } from 'node:fs';
import { TIER_DIALS, shipDialsFor } from '../../../src/space/tierDials.ts';
import { allDials, dialMoved, movedArgs, movedLine, resetDials, snapDial } from '../../../src/ui/dials.ts';
import { evaluateArgs } from '../../../src/ui/debugModel.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (what: string) => console.log(`note ${what}`);

// A small graded pool and one fit: every system and a gun, each slot offering a grade 1 to 5 piece.
const pool: ComponentDef[] = [];
const words = ['cheap', 'standard', 'improved', 'elite', 'prototype'];
for (const [cls, type, pre] of [['rct_0', 'reactor', 'rct'], ['shd_0', 'shield', 'shd'], ['arm_0', 'armor', 'arm'], ['eng_0', 'engine', 'eng'], ['wpn_0', 'weapon', 'wpn']] as const) {
  for (const w of words) pool.push({ name: `${pre}_kuat_${w}${pre === 'wpn' ? '_blaster' : ''}`, type, compat: cls, label: w, template: `object/tangible/ship/components/${type}/shared_${pre}_${w}.iff`, ...(pre === 'wpn' ? { weapon: { projectile: 4, speed: 600, range: 512 } } : {}) });
}
const slot = (name: string, compat: string, stock: string): FitSlot => ({ slot: name, compat: [compat], stock, looks: [] });
const fit: FitDef = { chassis: 'test_tier1', droid: 'computer', paint: null, slots: [slot('reactor', 'rct_0', 'rct_kuat_standard'), slot('shield_0', 'shd_0', 'shd_kuat_standard'), slot('armor_0', 'arm_0', 'arm_kuat_standard'), slot('engine', 'eng_0', 'eng_kuat_standard'), slot('weapon_0', 'wpn_0', 'wpn_kuat_standard_blaster')] };

/** The sweep the day-one checks run: every whole tier from -1 to 5 and the numbers between them a caller might hand in. */
const LOW = [-1, 0, 0.4, 0.5, 1, 1.49, 1.5, 2, 2.5, 3, 3.7, 4, 4.5, 5, 5.2, 5.49, NaN];
type Loadout = { pickLoadout: typeof pickLoadout; seeded: typeof seeded };
type Pilot = { skillOfTier: typeof skillOfTier };
type Stats = { tierDurability: typeof tierDurability; tierDamage: typeof tierDamage };
const trace = (L: Loadout, P: Pilot, S: Stats) => LOW.map((t) => [t, JSON.stringify(L.pickLoadout(fit, pool, t, 4, L.seeded(11))), JSON.stringify(P.skillOfTier(t)), S.tierDurability(t), S.tierDamage(t)]);
/** That trace from the functions at the pass's base, measured once (`traceHash`); held where git cannot hand them over. */
const BASE_TRACE = 'c828f8690df2';

{
  const today = trace({ pickLoadout, seeded }, { skillOfTier }, { tierDurability, tierDamage });
  const [L, P, S] = await Promise.all([atBase<Loadout>('src/space/loadout.ts'), atBase<Pilot>('src/space/pilot.ts'), atBase<Stats>('src/space/shipStats.ts')]);
  if (L && P && S) {
    const then = trace(L, P, S);
    const same = then.every((row, i) => row.every((v, k) => Object.is(v, today[i][k])));
    ok(same, `day one: pickLoadout, skillOfTier, tierDurability and tierDamage answer for tiers -1 to 5 exactly as at the pass's base (${PASS_BASE.slice(0, 7)}), by Object.is`);
    const now = traceHash(then);
    if (now !== BASE_TRACE) note(`the base's trace hashes to ${now}; write it as BASE_TRACE so a checkout without git still holds today's to it`);
    else ok(true, `and that trace is the one written down here (${BASE_TRACE})`);
  } else {
    note(`git cannot hand over the readers as they stood at ${PASS_BASE.slice(0, 7)}: today's are held to the trace written down here alone`);
    ok(traceHash(today) === BASE_TRACE, `day one: today's readers give the base's trace for tiers -1 to 5 (${traceHash(today)}, written ${BASE_TRACE})`);
  }
}

// Above 5, at the default table: every tier reads as tier 5.
{
  const at = (t: number) => [JSON.stringify(pickLoadout(fit, pool, t, 4, seeded(11))), skillOfTier(t), tierDurability(t), tierDamage(t)];
  const five = at(5);
  ok([6, 7, 8, 9, 10].every((t) => at(t).every((v, k) => Object.is(v, five[k]))), 'tiers 6 to 10 fly, fit and fight as tier 5 at the default table');
  ok(tierDurability(10) === 0.6 + 0.2 * 5 && tierDamage(10) === 0.7 + 0.15 * 5, 'a tier 10 is as hard to kill and hits as hard as a tier 5, not 2.6 and 2.2 times');
  ok(TIER_LADDER_TUNE.top === 10, 'the top is tier 10');
}

// A tier above the top reads as the top: each row the top reads is given a value no other row and no fallback has, so
// a reader that ignored the top (or held it to 10 whatever the table said) would answer something else.
{
  const saved = JSON.parse(JSON.stringify(TIER_LADDER_TUNE));
  tuneTierLadder({ grade: { 10: 2 }, skill: { 10: 3 }, strength: { 10: 1 } });
  ok(gradeTier(11) === 2 && skillTier(11) === 3 && strengthTier(14) === 1 && skillOfTier(12) === PILOT_SKILL[3], 'a tier above 10 reads tier 10\'s rows');
  tuneTierLadder({ top: 7, grade: { 7: 4 }, skill: { 7: 2 }, strength: { 7: 3 } });
  ok(TIER_LADDER_TUNE.top === 7 && gradeTier(9) === 4 && skillTier(10) === 2 && strengthTier(9) === 3 && tierDurability(9) === 0.6 + 0.2 * 3, 'a top moved to 7 reads every tier above it as tier 7, its rows and nothing else');
  ok(gradeTier(6) === 5 && strengthTier(6) === 5, 'and a tier under the top still reads its own row');
  Object.assign(TIER_LADDER_TUNE, saved);
}

// A moved table moves them, and only above 5.
{
  const saved = JSON.parse(JSON.stringify(TIER_LADDER_TUNE));
  tuneTierLadder({ grade: { 8: 3 }, skill: { 8: 2 }, strength: { 8: 4 } });
  ok(gradeTier(8) === 3 && skillOfTier(8) === PILOT_SKILL[2] && tierDurability(8) === 0.6 + 0.2 * 4 && tierDamage(8) === 0.7 + 0.15 * 4, 'a tier the table moves reads its new rows');
  ok(TIER_GRADE[gradeTier(8)] === 3 && JSON.stringify(pickLoadout(fit, pool, 8, 4, seeded(11))) === JSON.stringify(pickLoadout(fit, pool, 3, 4, seeded(11))), 'and the loadout of a moved tier is the loadout of the tier it reads as');
  ok(gradeTier(5) === 5 && skillTier(5) === 5 && strengthTier(5) === 5 && gradeTier(7) === 5, 'tiers 1 to 5 and the tiers not moved are untouched');
  tuneTierLadder({ grade: { 4: 1, 11: 2 }, skill: { 8: 9 }, nonsense: 1 } as never);
  ok(TIER_LADDER_TUNE.grade[4] === undefined && TIER_LADDER_TUNE.grade[11] === undefined && TIER_LADDER_TUNE.skill[8] === 5 && !('nonsense' in TIER_LADDER_TUNE), 'a tier outside 6 to 10 is ignored, a value past 5 is held to 5, an unknown name is not added');
  tuneTierLadder({ top: 4 });
  ok(TIER_LADDER_TUNE.top === 6, 'the top is held to 6 at the least');
  Object.assign(TIER_LADDER_TUNE, saved);
  ok(/tiers 6 to 10 read as/.test(ladderLine()), 'the console line names the ladder');
}

// The debug menu's dials (src/space/tierDials.ts): each slider moves the very row of the table its key names, read
// straight off the table and never through the dial; the line the menu copies out is `npcShips`'s own argument and,
// read back as the helper reads it, sets exactly what was moved; Reset puts the shipped table back; and tiers 1 to 5
// read as they always did whatever the dials say.
{
  const saved = JSON.parse(JSON.stringify(TIER_LADDER_TUNE));
  ok(shipDialsFor('npcShips') === TIER_DIALS && shipDialsFor('race') === null, 'npcShips has the ladder\'s dials, and nothing else here does');
  const field = (key: string): unknown => {
    const [head, row, tier] = key.split('.');
    assert.equal(head, 'ladder');
    return row === 'top' ? TIER_LADDER_TUNE.top : (TIER_LADDER_TUNE as unknown as Record<string, Record<string, number>>)[row][tier];
  };
  const dials = allDials(TIER_DIALS);
  ok(dials.length === 16 && new Set(dials.map((d) => d.key)).size === 16, `three rows of five tiers and the top, each one dial (${dials.length})`);
  for (const d of dials) {
    assert.ok(d.kind === 'number');
    ok(field(d.key) === TIER_DIALS.shipped.get(d.key) && d.note.length > 20, `${d.key}: names a real row of the table, which shipped at ${TIER_DIALS.shipped.get(d.key)}, and says what it does`);
    for (const v of [d.min, d.max, snapDial((d.min + d.max) / 2, d.min, d.max, d.step)]) {
      const words = d.set(v);
      ok(field(d.key) === v && words.length === 0, `${d.key} set to ${v} reads ${v} in the table`);
    }
  }
  const low = [1, 2, 3, 4, 5].map((t) => [gradeTier(t), skillTier(t), strengthTier(t)].join());
  ok(low.every((s, i) => s === [i + 1, i + 1, i + 1].join()), 'moving the dials leaves tiers 1 to 5 reading their own rows');
  resetDials(TIER_DIALS);
  ok(dials.every((d) => field(d.key) === TIER_DIALS.shipped.get(d.key)), 'Reset all puts every row back where it shipped');
  const grade8 = dials.find((d) => d.key === 'ladder.grade.8')!;
  const top = dials.find((d) => d.key === 'ladder.top')!;
  assert.ok(grade8.kind === 'number' && top.kind === 'number');
  grade8.set(3);
  top.set(9);
  const line = movedLine(TIER_DIALS);
  ok(line === '__debug.npcShips({ ladder: { grade: { 8: 3 }, top: 9 } })', `the line names the helper and the two dials moved, a tier written as its number (${line})`);
  ok(grade8.set(7).length === 1 && TIER_LADDER_TUNE.grade[8] === 5, 'a number typed past the slider is held by the helper, and said');
  resetDials(TIER_DIALS);
  const back = evaluateArgs(movedArgs(TIER_DIALS) || '{ ladder: { grade: { 8: 3 }, top: 9 } }');
  assert.ok(back.ok);
  tuneTierLadder((back.args[0] as { ladder: Parameters<typeof tuneTierLadder>[0] }).ladder);
  ok(TIER_LADDER_TUNE.grade[8] === 3 && TIER_LADDER_TUNE.top === 9 && dials.filter((d) => dialMoved(TIER_DIALS, d)).length === 2, 'read back as npcShips reads its ladder, the line sets those two again and nothing else');
  Object.assign(TIER_LADDER_TUNE, saved);
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8');
  ok(/if \(opts\.ladder !== true\) tuneTierLadder\(opts\.ladder\);/.test(main), '__debug.npcShips takes its ladder through tuneTierLadder, as the line is written');
  ok(/dials: \(helper\) => vehicleDialsFor\(helper\) \?\? shipDialsFor\(helper\)/.test(main), 'and the game hands the debug menu these dials');
}

console.log(`\n${passed} checks passed`);
