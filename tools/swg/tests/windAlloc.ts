// The unified wind's frame makes nothing (the volumetrics design's rule 4, wave 7a), in a node process of its own: the
// weather's W7 step (`stepWind7`: the observer's blend from the sky's mix, the pattern's level and heading, the travel
// with its memo, the phases frozen at their restarts and the quantile table read there, the pack, the wind at the player,
// the devils listed and moved) and the gust read at a point, over 100,000 frames at 60 a second -- standing still, then
// moving at 30 m/s, then through a 40 s level ramp (a level forced and let go) and a 4 s area fade (the sky's mix moving
// between two kinds) with the phases restarting all through -- the young generation read with no collection between,
// cleanest of three (`windMath.test.ts` runs it a dozen at once). Run with `--expose-gc --allow-natives-syntax`.
// Prints one line of JSON.
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import { WIND_DAY, WIND_FRAME, WIND_PROFILES, attachWind, setWindArm, standLocalDevil, stepWind7, windPattern, wind7Uniforms } from '../../../src/world/wind.ts';
import { gustFlat, newGustAt } from '../../../src/world/windMath.ts';

const gc = (globalThis as unknown as { gc?: (o?: { type: string }) => void }).gc;
if (!gc) {
  console.log(JSON.stringify({ skipped: 'run with --expose-gc' }));
  process.exit(0);
}
let scavenges = 0;
const watch = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
});
watch.observe({ entryTypes: ['gc'] });
const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

// A world of our own: five levels, clear at the bottom to a dust storm at the top, with devils by day.
const rows = [0, 1, 2, 3, 4].flatMap((l) => [0, 1, 2].map((r) => ({ weatherIndex: l, windSpeedScale: 2 + l * 2 + r * 0.3, cameraEffect: l >= 3 ? { kind: 'dust' } : l === 2 ? { kind: 'leaves' } : null })));
for (const k of Object.keys(WIND_PROFILES) as (keyof typeof WIND_PROFILES)[]) WIND_PROFILES[k].devils = 300;
attachWind('tatooine', 'tatooine', 1234567, [0.3, 0.25, 0.2, 0.15, 0.1], 5, rows);
setWindArm({ master: true, wind: true, devils: true, trees: true, art: 1 });
wind7Uniforms();

// The sky's mix: two blocks whose weights a fade moves (kept objects; the step reads them through the accessors).
const clear = { cameraEffect: null };
const dust = { cameraEffect: { kind: 'dust' } };
const mixWeights = new Float64Array([1, 0, 0, 0]);
const sky = {
  mixLength: 2,
  mixBlock: (i: number): typeof clear | typeof dust => (i === 0 ? clear : dust),
  mixWeights,
  lighting: { windSpeedScale: 6 },
};
const F = WIND_FRAME;
const g = newGustAt();
const pack = wind7Uniforms().uWind7.value;
const DT = 1 / 60;
// The measure's own clock as a class (an object literal's number fields took their numbers boxed: the harness must make
// nothing of its own).
class State {
  t = 1.79e9 + 0.5;
  frame = 0;
  mode = 0;
}
const state = new State();
WIND_DAY.now = 0.5;
WIND_DAY.length = 720;
standLocalDevil(0, 0, state.t, 1e9);

function step(): void {
  state.t += DT;
  state.frame++;
  F.t = state.t;
  F.level = 1.5;
  if (state.mode === 1) {
    F.px += 30 * DT;
    F.pz -= 12 * DT;
  } else if (state.mode === 2) {
    // A level held and let go every 40 s (its ramp), and the area fading between two kinds every 4 s.
    F.forced = state.frame % 4800 < 2400 ? 4 : null;
    const f = (state.frame % 480) / 480;
    mixWeights[0] = f < 0.5 ? 1 - 2 * f : 2 * f - 1;
    mixWeights[1] = 1 - mixWeights[0];
    sky.lighting.windSpeedScale = 4 + 6 * mixWeights[1];
  }
  stepWind7(sky);
  g.x = F.px + 20;
  g.z = F.pz - 7;
  gustFlat(g, pack);
}

function frames(n: number): void {
  for (let i = 0; i < n; i++) step();
}
try {
  new Function('f', '%NeverOptimizeFunction(f)')(frames);
} catch {
  // Without the flag the loop is left to the compiler.
}

async function measure(n: number): Promise<{ made: number; scavenges: number; frames: number }> {
  frames(30_000);
  let best = { made: Infinity, scavenges: Infinity, frames: n };
  for (let attempt = 0; attempt < 3; attempt++) {
    gc!();
    await tick();
    await tick();
    frames(10_000);
    gc!({ type: 'minor' });
    await tick();
    await tick();
    scavenges = 0;
    const before = young();
    frames(n);
    const made = young() - before;
    await tick();
    await tick();
    if (scavenges < best.scavenges || (scavenges === best.scavenges && made < best.made)) best = { made, scavenges, frames: n };
    if (best.scavenges === 0 && best.made <= 0) break;
  }
  return best;
}

F.px = 0;
F.pz = 0;
F.forced = null;
const still = await measure(100_000);
state.mode = 1;
const moving = await measure(100_000);
state.mode = 2;
const ramps = await measure(100_000);
const p = windPattern();
console.log(JSON.stringify({ still, moving, ramps, devils: p?.devilCount ?? 0, tests: p?.devilTests ?? 0, k: g.k, mean: F.mean, travel: F.travel }));
