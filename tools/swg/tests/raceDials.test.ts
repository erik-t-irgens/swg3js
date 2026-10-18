// The racing dials (src/vehicles/raceDials.ts) and the dials' own arithmetic (src/ui/dials.ts): every slider the
// debug menu shows for `race` and `engines` moves the very number its console helper moves, through the helper's own
// setter, across the whole of its range; the console line the menu copies out sets exactly what was moved, read back
// through the same setters `__debug.race` and `__debug.engines` call; and Reset puts back the shipped numbers.
//
// Everything is run through the real tune tables. The checks that could pass by construction are avoided: a dial is
// read back through the table it names (never through its own `get`), and its range is held to what the helper's
// own clamps accept, so a slider can never show a value the game would not hold.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateArgs } from '../../../src/ui/debugModel.ts';
import { allDials, dialMoved, dialText, movedArgs, movedLine, readDials, resetDials, snapDial, stepDecimals, type Dial, type DialSet } from '../../../src/ui/dials.ts';
import { ENGINE_TUNE, tuneEngines } from '../../../src/vehicles/drivetrain.ts';
import { ENGINE_DIALS, RACE_DIALS, vehicleDialsFor } from '../../../src/vehicles/raceDials.ts';
import { RACE_BASE, RACE_GEN, RACE_TUNE, tuneBase, tuneRace } from '../../../src/vehicles/raceTune.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// --- 1. the dials' own arithmetic ---------------------------------------------------------------------------------

ok(stepDecimals(0.05) === 2 && stepDecimals(5) === 0 && stepDecimals(0.001) === 3 && stepDecimals(1e-7) === 7, 'a step is kept to its own decimals');
ok(snapDial(0.15000000000000002, 0, 1, 0.05) === 0.15, 'a slider at 0.15 writes 0.15, never a float\'s tail');
ok(snapDial(7.26, 2, 60, 0.5) === 7.5 && snapDial(-4, 2, 60, 0.5) === 2 && snapDial(99, 2, 60, 0.5) === 60, 'held to its range and on its step, counted from its least');
ok(snapDial(Number.NaN, 2, 60, 0.5) === 2, 'what is not a number is the least');
ok(snapDial(205, 200, 1368, 10) === 210 && snapDial(1368, 200, 1368, 10) === 1368, 'a range whose top is off the step still reaches its top');

/** A set of two made-up dials over a plain table, to try the arithmetic on. */
const table = { a: 1, b: 'x' as string, c: 0.5 };
const fake: DialSet = (() => {
  const groups = [
    {
      title: 'made up',
      dials: [
        { kind: 'number' as const, key: 'tune.a', label: 'a', note: '', min: 0, max: 10, step: 0.5, unit: 'm', get: () => table.a, set: (v: number) => ((table.a = v), []) },
        { kind: 'choice' as const, key: 'b', label: 'b', note: '', choices: ['x', 'y'], get: () => table.b, set: (v: string) => ((table.b = v), []) },
        { kind: 'number' as const, key: 'base.pod.c', label: 'c', note: '', min: 0, max: 1, step: 0.05, unit: '', get: () => table.c, set: (v: number) => ((table.c = v), []) },
      ] as Dial[],
    },
  ];
  return { helper: 'fake', groups, shipped: readDials(groups) };
})();
ok(movedArgs(fake) === '' && movedLine(fake) === '', 'nothing moved: no console line');
table.a = 3.5;
table.b = 'y';
ok(dialMoved(fake, allDials(fake)[0]) && dialMoved(fake, allDials(fake)[1]) && !dialMoved(fake, allDials(fake)[2]), 'a moved dial is told from one that stands where it shipped');
const args = movedArgs(fake);
ok(args === "{ tune: { a: 3.5 }, b: 'y' }", `the moved dials are the helper's own argument, nested by their keys (${args})`);
ok(movedLine(fake) === `__debug.fake(${args})`, 'and the whole console line names the helper');
const back = evaluateArgs(args);
ok(back.ok && JSON.stringify(back.args[0]) === JSON.stringify({ tune: { a: 3.5 }, b: 'y' }), 'the menu\'s own argument box reads it back as the same object');
ok(dialText(allDials(fake)[0]) === '3.5 m' && dialText(allDials(fake)[1]) === 'y', 'a value is shown with its unit, a choice as its word');
table.a = 3.25;
ok(dialText(allDials(fake)[0]) === '3.25 m', 'a value typed past its step\'s decimals is shown as it is, never rounded to a number that was not set');
table.a = 3.5;
{
  const crash = allDials(RACE_DIALS).find((d) => d.key === 'base.podracer.crashImpact');
  ok(!!crash && dialText(crash) === `${RACE_BASE.podracer.crashImpact} m/s · ${Math.round(RACE_BASE.podracer.crashImpact * 3.6)} km/h`, 'a speed is said in km/h as well');
}
resetDials(fake);
ok(table.a === 1 && table.b === 'x' && !allDials(fake).some((d) => dialMoved(fake, d)), 'Reset all puts every dial back where it shipped');
table.c = 0.5 + 1e-12;
ok(!dialMoved(fake, allDials(fake)[2]), 'a float\'s tail far under the step is not a move');
table.c = 0.5;

// --- 2. every racing dial moves the number its helper moves -------------------------------------------------------

const sets = [RACE_DIALS, ENGINE_DIALS];
ok(vehicleDialsFor('race') === RACE_DIALS && vehicleDialsFor('engines') === ENGINE_DIALS && vehicleDialsFor('perf') === null, 'race and engines have dials, and nothing else does');

/** The field a dial's key names, read straight off the table its helper writes, never through the dial. */
function fieldOf(set: DialSet, key: string): unknown {
  const p = key.split('.');
  if (set === ENGINE_DIALS) {
    assert.equal(p[0], 'tune');
    return (ENGINE_TUNE as unknown as Record<string, unknown>)[p[1]];
  }
  if (p[0] === 'tune') return (RACE_TUNE as unknown as Record<string, unknown>)[p[1]];
  assert.equal(p[0], 'base');
  return ((RACE_BASE as unknown as Record<string, Record<string, unknown>>)[p[1]] ?? {})[p[2]];
}

for (const set of sets) {
  const keys = new Set<string>();
  for (const d of allDials(set)) {
    ok(!keys.has(d.key), `${set.helper}: ${d.key} is one dial, not two`);
    keys.add(d.key);
    const shipped = set.shipped.get(d.key);
    ok(shipped !== undefined && fieldOf(set, d.key) === shipped, `${set.helper}: ${d.key} names a real field, and its shipped value is that field's`);
    ok(d.label.length > 0 && d.note.length > 20, `${set.helper}: ${d.key} says what it does`);
    if (d.kind === 'number') {
      ok(d.min < d.max && d.step > 0 && (shipped as number) >= d.min && (shipped as number) <= d.max, `${set.helper}: ${d.key}'s shipped ${shipped} lies inside its slider's ${d.min} to ${d.max}`);
      const gen = RACE_GEN.n;
      for (const v of [d.min, d.max, snapDial((d.min + d.max) / 2, d.min, d.max, d.step)]) {
        d.set(v);
        ok(fieldOf(set, d.key) === v, `${set.helper}: ${d.key} set to ${v} reads ${v} in the table (the helper holds the whole of the slider's range)`);
      }
      if (set === RACE_DIALS) ok(RACE_GEN.n > gen, `race: ${d.key} moved has every drive build its handling again`);
    } else {
      for (const c of d.choices) {
        d.set(c);
        ok(fieldOf(set, d.key) === c, `${set.helper}: ${d.key} set to ${c} reads ${c}`);
      }
    }
  }
  resetDials(set);
  ok(allDials(set).every((d) => fieldOf(set, d.key) === set.shipped.get(d.key)), `${set.helper}: Reset all leaves every field where it shipped`);
}

// The control: a dial whose slider reaches past what the helper accepts is caught by the check above.
{
  const d = allDials(RACE_DIALS).find((x) => x.key === 'tune.looseFall');
  assert.ok(d && d.kind === 'number');
  d.set(400);
  ok(RACE_TUNE.looseFall !== 400, 'control: past its own clamp the helper holds a number back, so a slider reaching there would be caught');
  resetDials(RACE_DIALS);
}

// --- 3. the console line sets exactly what was moved --------------------------------------------------------------

{
  const move = (set: DialSet, key: string, v: number | string) => {
    const d = allDials(set).find((x) => x.key === key);
    assert.ok(d, key);
    if (d.kind === 'number') d.set(v as number);
    else d.set(v as string);
  };
  move(RACE_DIALS, 'tune.hold', 'firm');
  move(RACE_DIALS, 'tune.looseFall', 12.5);
  move(RACE_DIALS, 'base.podracer.maxTurn', 80);
  move(RACE_DIALS, 'tune.ceiling', 750);
  move(ENGINE_DIALS, 'tune.fireRate', 0.3);
  const raceArgs = movedArgs(RACE_DIALS);
  const engineArgs = movedArgs(ENGINE_DIALS);
  ok(movedLine(RACE_DIALS).startsWith('__debug.race({') && movedLine(ENGINE_DIALS) === '__debug.engines({ tune: { fireRate: 0.3 } })', `the lines name their helpers (${movedLine(RACE_DIALS)})`);
  const wantRace = new Map(allDials(RACE_DIALS).filter((d) => dialMoved(RACE_DIALS, d)).map((d) => [d.key, d.get()]));
  ok(wantRace.size === 4, 'four racing dials moved');
  resetDials(RACE_DIALS);
  resetDials(ENGINE_DIALS);
  // Read back as `__debug.race` reads its argument: its `tune` through `tuneRace`, its `base` through `tuneBase`.
  const r = evaluateArgs(raceArgs);
  const e = evaluateArgs(engineArgs);
  assert.ok(r.ok && e.ok);
  const ro = r.args[0] as { tune?: Record<string, unknown>; base?: Parameters<typeof tuneBase>[0] };
  if (ro.tune) tuneRace(ro.tune);
  if (ro.base) tuneBase(ro.base);
  tuneEngines((e.args[0] as { tune: Record<string, unknown> }).tune);
  ok([...wantRace].every(([k, v]) => fieldOf(RACE_DIALS, k) === v), 'the race line, read back through the helper\'s own setters, sets every moved dial again');
  ok(ENGINE_TUNE.fireRate === 0.3, 'and the engines line, the engines\' number');
  ok(allDials(RACE_DIALS).filter((d) => dialMoved(RACE_DIALS, d)).length === 4, 'and nothing else');
  resetDials(RACE_DIALS);
  resetDials(ENGINE_DIALS);
}

// --- 4. the helpers read the lines as the dials write them --------------------------------------------------------

{
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8');
  ok(/if \(opts\.tune\) words\.push\(\.\.\.tuneRace\(opts\.tune\)\);\s*if \(opts\.base\) words\.push\(\.\.\.tuneBase\(opts\.base\)\);/.test(main), '__debug.race takes `tune` through tuneRace and `base` through tuneBase, as the line is written');
  ok(/if \(opts\.tune\) words\.push\(\.\.\.tuneEngines\(opts\.tune\)\);/.test(main), '__debug.engines takes `tune` through tuneEngines');
  ok(/dials: \(helper\) => vehicleDialsFor\(helper\)/.test(main), 'the game hands the debug menu these dials');
}

// --- 5. the pod's numbers move the racing bike with them ----------------------------------------------------------

{
  const turn = allDials(RACE_DIALS).find((d) => d.key === 'base.podracer.maxTurn');
  assert.ok(turn && turn.kind === 'number');
  turn.set(70);
  ok(RACE_BASE.speederbike.maxTurn === 70, 'the racing bike is made from the pod again, so a pod dial moves it too, as the group says');
  resetDials(RACE_DIALS);
}

console.log(`\nraceDials: ${checks} checks passed`);
