// Nothing made by a frame of the air with the smoke and ash on (the GPU port's pass 2, wave 6, part A): the twin's frame over
// Mustafar's plume and its glow from below (its column tables read by a frame's own register path, the plume's phase, the
// glow's climb written in), steady and summing (the sun moving so the hemisphere is summed again, night and day), each in
// twelve fresh processes, run in two waves of six (the owner's machine: never more than six of these at once).
//   node tools/swg/tests/airSmokeAlloc.test.ts
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AirTwin, DEPTH_FLOATS, IN, PSI_FLOATS, SMOKE_FLOATS, TWIN_STEPS, buildDepthTable, buildPsiTable, buildSmokeTable, steerGain, writeTwinLighting } from '../../../src/sky/air/airTwin.ts';
import { applyHazeDials, setVisibility, smokeOn, worldRecord } from '../../../src/sky/air/airParams.ts';

const ALLOC = process.argv.includes('--alloc');

if (ALLOC) {
  const v8 = await import('node:v8');
  const { PerformanceObserver } = await import('node:perf_hooks');
  const gc = (globalThis as unknown as { gc: (o?: unknown) => void }).gc;
  let collections = 0;
  new PerformanceObserver((l) => (collections += l.getEntries().length)).observe({ entryTypes: ['gc'] });
  const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;
  const turn = () => new Promise((r) => setImmediate(r));
  const rec = worldRecord('mustafar');
  setVisibility(rec, 40);
  applyHazeDials('mustafar', rec);
  if (!smokeOn(rec)) throw new Error("Mustafar's plume is not on at its start");
  const depth = new Float64Array(DEPTH_FLOATS);
  buildDepthTable(rec, depth);
  const smoke = new Float64Array(SMOKE_FLOATS);
  buildSmokeTable(rec, smoke);
  const psi = new Float64Array(PSI_FLOATS);
  buildPsiTable(rec, depth, psi, TWIN_STEPS.psiDirs, TWIN_STEPS.psi, smoke);
  const tw = new AirTwin();
  tw.useDepth(depth);
  tw.useSmoke(smoke);
  tw.useRecord(rec, psi);
  tw.glowScale = 2.4287;
  tw.sunTop.fill(2.4);
  tw.moonTop.fill(5e-6);
  const c = () => ({ r: 0.5, g: 0.5, b: 0.5 });
  const lighting = () => ({ main: c(), mainScale: 0, ambient: c(), ambientScale: 0, bounce: c(), bounceScale: 0, fill: c(), fillScale: 0, fog: c(), fogDensity: 0 });
  const swg = lighting();
  const L = lighting();
  const g = { x: 0.5, y: 0.5, z: 0.5 };
  const recs = [tw.record, rec];
  const psis = [psi, psi];
  const w = new Float64Array([0.5, 0.5]);
  const walk = { k: 0, e: 0.5 };
  const summing = process.argv.includes('--summing');
  const step = (): void => {
    walk.k = (walk.k + 1) % 1000;
    // A summing frame: the sun swept from a day to a night (the glow's sums with it), the weather's weights moving.
    walk.e = summing ? -0.6 + walk.k * 0.0016 : 0.6;
    if (summing) {
      w[0] = walk.k / 1000;
      w[1] = 1 - w[0];
      tw.blendRows(recs, psis, w, 2);
    }
    const cs = Math.cos(walk.e);
    const sn = Math.sin(walk.e);
    const inp = tw.inp;
    inp[IN.sx] = cs;
    inp[IN.sy] = sn;
    inp[IN.sz] = 0.1;
    inp[IN.mx] = -cs;
    inp[IN.my] = -sn;
    inp[IN.mz] = -0.1;
    inp[IN.s2x] = cs;
    inp[IN.s2y] = sn;
    inp[IN.s2z] = 0.1;
    inp[IN.heightKm] = 0.2;
    tw.sun2 = false;
    tw.frame();
    writeTwinLighting(tw.out, swg, L);
    steerGain(tw.out, swg.fog, g);
  };
  const n = summing ? 8000 : 20000;
  for (let k = 0; k < 10; k++) {
    for (let i = 0; i < (summing ? 300 : 6000); i++) step();
    await turn();
  }
  let best = Number.NaN;
  let clean = 0;
  for (let tries = 0; tries < 12 && clean < 3; tries++) {
    for (let i = 0; i < n / 5; i++) step();
    gc({ type: 'minor' });
    await turn();
    await turn();
    const c0 = collections;
    const b = young();
    for (let i = 0; i < n; i++) step();
    const a = young();
    await turn();
    await turn();
    if (collections === c0) {
      const per = (a - b) / n;
      best = clean === 0 ? per : Math.min(best, per);
      clean++;
    }
  }
  console.log(JSON.stringify({ frame: clean === 0 ? 'no clean window' : best, sums: tw.out.sums }));
  process.exit(0);
} else {
  let checks = 0;
  const me = fileURLToPath(import.meta.url);
  const one = (kind: 'steady' | 'summing'): Promise<number | string> =>
    new Promise((res) => {
      const args = ['--expose-gc', me, '--alloc', ...(kind === 'summing' ? ['--summing'] : [])];
      const ch = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      ch.stdout.on('data', (b) => (out += b));
      ch.stderr.on('data', (b) => (err += b));
      ch.on('close', () => {
        try {
          res(JSON.parse(out.trim().split('\n').pop() ?? '').frame as number | string);
        } catch {
          res(`no answer: ${err.slice(0, 300)}`);
        }
      });
    });
  for (const kind of ['steady', 'summing'] as const) {
    const runs: (number | string)[] = [];
    for (let wave = 0; wave < 2; wave++) runs.push(...(await Promise.all(Array.from({ length: 6 }, () => one(kind)))));
    const said = runs.map((x) => (typeof x === 'number' ? `${x.toFixed(3)} B` : x));
    if (!runs.every((x) => typeof x === 'number' && x < 0.5)) {
      console.log(`FAIL a ${kind} frame of the twin over Mustafar's plume and glow makes nothing in 12 of 12 fresh processes (${said.join(', ')})`);
      process.exit(1);
    }
    checks++;
    console.log(`ok   a ${kind} frame of the twin over Mustafar's plume and glow (its column tables, the plume's phase, the glow's climb, the lighting written) makes nothing in 12 of 12 fresh processes (${said.join(', ')})`);
  }
  console.log(`\nairSmokeAlloc: ${checks} checks passed`);
}
