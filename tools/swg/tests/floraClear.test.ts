// How far a placed object keeps flora off it. The rule is pure, so this runs exactly what the game
// runs. Every number here is invented for the test: the real reaches come from each model's own
// bounds in a planet's manifest.
//
// The case that matters is the one that was live for years: the snapshot's `radius` is a streaming
// distance, not a size, and reading it as a size emptied eight worlds of flora.
import assert from 'node:assert/strict';
import { FLORA_CLEAR, floraClearRadius, modelReach, type FloraClearTune } from '../../../src/world/floraClear.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

const model = (dx: number, dy: number, dz: number) => ({ min: [-dx / 2, 0, -dz / 2], max: [dx / 2, dy, dz / 2] });
const tune = (patch: Partial<FloraClearTune> = {}): FloraClearTune => ({ ...FLORA_CLEAR, ...patch });

{
  // The reach is the larger horizontal half-extent, so a long wall clears along its length.
  ok(near(modelReach(model(8, 7, 2.5)), 4), "a wall's reach is half its longest side on the ground, not half its diagonal");
  ok(near(modelReach(model(2, 15, 2)), 1), 'a tower is as wide as it is wide, however tall it stands');
  ok(Number.isNaN(modelReach(null)), 'a model the pack does not carry has no reach of its own');
  ok(Number.isNaN(modelReach({ min: [0, 0], max: [1, 1] })), 'and neither has a corner pair that is not three numbers');
}

{
  // CLAUDE.md: a mesh's BOX chunk holds the larger corner first, and packs converted before that was
  // understood carry them the other way round. The reach must not care which is called which.
  const right = { min: [-4, 0, -1.25], max: [4, 7, 1.25] };
  const swapped = { min: [4, 7, 1.25], max: [-4, 0, -1.25] };
  ok(near(modelReach(right), modelReach(swapped)), 'the two corners are taken componentwise, so a pack with them the other way round measures the same');
}

{
  // The bug, in one check: a small building with a huge streaming radius.
  const bounds = model(8, 7, 2.5);
  const asSnapshot = floraClearRadius(512, bounds, tune({ rule: 'snapshot' }));
  const asModel = floraClearRadius(512, bounds, tune());
  ok(asSnapshot > 60, `the old rule clears a whole neighbourhood for an eight-metre wall (${asSnapshot} m)`);
  ok(near(asModel, 6), 'the model rule clears the wall and two metres more');
  ok(asModel < asSnapshot, 'so nothing that was clear before stops being clear: the new disc is inside the old one');
}

{
  // The cap is a guard on both rules, not a number to tune. One world carries 40,130 m.
  ok(floraClearRadius(40130, null, tune({ rule: 'snapshot' })) === FLORA_CLEAR.cap, 'the old rule is capped too, so one bad figure cannot empty a world');
  ok(floraClearRadius(40130, null, tune()) === FLORA_CLEAR.cap, 'and a model the pack lacks falls back to the snapshot, capped');
  ok(floraClearRadius(1e9, model(4, 4, 4), tune()) === 4, 'a model we do have is measured, whatever the snapshot claims');
}

{
  // Small things keep no flora off at all, which is what the old rule's `radius >= 1` said.
  ok(floraClearRadius(0.4, model(0.4, 0.2, 0.4), tune()) === 0, 'a streetlamp clears nothing');
  ok(floraClearRadius(0.4, model(0.4, 0.2, 0.4), tune({ rule: 'snapshot' })) === 0, 'and did not under the old rule either');
  ok(floraClearRadius(200, model(2, 3, 2), tune()) === 3, 'a metre-wide post clears itself and the pad, not its load distance');
}

{
  // Nothing may throw or answer nonsense: this runs once per placed object at load, 16,000 times on
  // one world, and a NaN reaches the exclusion index.
  for (const r of [Number.NaN, Infinity, -1, 0]) {
    const v = floraClearRadius(r, null, tune());
    ok(Number.isFinite(v) && v >= 0, `a snapshot radius of ${r} answers a real number (${v})`);
  }
  const v = floraClearRadius(10, { min: [Number.NaN, 0, 0], max: [1, 1, 1] }, tune());
  ok(Number.isFinite(v) && v >= 0, 'and so does a model whose bounds carry a NaN');
}

console.log(`\n${passed} checks passed`);
