// The game logic behind lava and the heat haze, as plain node checks: the runtime noise volume matches
// the client's statistics and tiles, the lava look is read from water.json leniently and falls back on
// its own, far lava settles to the right averages, and the heat sources' pure parts (the exact distance
// to a table's outline, the provider list, the plume buffer) keep what they promise.
import assert from 'node:assert/strict';
import { HEAT_NOISE_SIZE, heatNoiseData, mulberry32 } from '../../../src/world/heatNoiseData.ts';
import { decodeRamp, FALLBACK_LAVA_STYLE, groupLava, LAVA_TEXTURE_FACTOR, lavaFarValues, lavaStyleFor, noiseFits, readLavaInfo, standInRamp, type LavaStyle } from '../../../src/world/lavaStyle.ts';
import { HeatSources, PLUME_MIN_RADIUS, PlumeBuffer, plumeNoiseFrequency, polygonDistance2 } from '../../../src/world/heatSources.ts';
import { advanceEnginePhase, engineHeatOf, enginePlume, vehiclePlumes, type PlumeShape } from '../../../src/vehicles/enginePlumes.ts';
import type { Vehicle, VehicleKind } from '../../../src/vehicles/vehicle.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => { assert.ok(cond, msg); passed++; console.log(`ok   ${msg}`); };
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;
const f32 = Math.fround;

// --- the runtime noise (src/world/heatNoiseData.ts) ---------------------------------------------

{
  const N = HEAT_NOISE_SIZE;
  const a = heatNoiseData(N, 7);
  ok(N === 32 && a.length === N * N * N, `the runtime noise is 32³ bytes (${a.length})`);
  const b = heatNoiseData(N, 7);
  ok(a.every((v, i) => v === b[i]), 'the same seed gives the same volume');
  const c = heatNoiseData(N, 8);
  ok(c.some((v, i) => v !== a[i]), 'another seed gives another volume');
  const r = mulberry32(1);
  const first = [r(), r(), r()];
  ok(first.every((v) => v >= 0 && v < 1) && new Set(first).size === 3, 'mulberry32 gives distinct numbers in 0..1');

  let sum = 0;
  let sq = 0;
  for (const v of a) { sum += v; sq += v * v; }
  const mean = sum / a.length;
  const sd = Math.sqrt(sq / a.length - mean * mean);
  ok(mean / 255 >= 0.485 && mean / 255 <= 0.495, `its mean is the client's 0.49 (${(mean / 255).toFixed(4)})`);
  ok(sd / 255 >= 0.072 && sd / 255 <= 0.082, `its spread is the client's 0.077 (${(sd / 255).toFixed(4)})`);

  const at = (x: number, y: number, z: number) => a[((((z % N) + N) % N) * N + (((y % N) + N) % N)) * N + (((x % N) + N) % N)];
  const corr = (lag: number, axis: number) => {
    let s = 0;
    let n = 0;
    for (let z = 0; z < N; z += 2) for (let y = 0; y < N; y += 2) for (let x = 0; x < N; x += 2) {
      const p = at(x, y, z) - mean;
      const q = (axis === 0 ? at(x + lag, y, z) : axis === 1 ? at(x, y + lag, z) : at(x, y, z + lag)) - mean;
      s += p * q;
      n++;
    }
    return s / n / (sd * sd);
  };
  for (const axis of [0, 1, 2]) {
    const c2 = corr(2, axis);
    const c4 = corr(4, axis);
    const c8 = corr(8, axis);
    ok(c2 >= 0.65 && c2 <= 0.9 && c4 >= 0.25 && c4 <= 0.6 && Math.abs(c8) < 0.3, `axis ${axis}: correlation falls off as the client's does (lag 2 ${c2.toFixed(2)}, 4 ${c4.toFixed(2)}, 8 ${c8.toFixed(2)})`);
  }
  // The wrap falls on a lattice point (six cells over 32 texels put one at 0 and one at 16), where the
  // smoothstep is flat and a step is smaller than the average: so the step across the wrap is set
  // against the one across the lattice point inside (15 to 16), which has the same phase. A seam would
  // make it as big as a step between texels that have nothing to do with each other (16 apart).
  for (const axis of [0, 1, 2]) {
    let wrap = 0;
    let same = 0;
    let apart = 0;
    for (let u = 0; u < N; u++) for (let v = 0; v < N; v++) {
      const g = (i: number) => (axis === 0 ? at(i, u, v) : axis === 1 ? at(u, i, v) : at(u, v, i));
      wrap += Math.abs(g(0) - g(N - 1));
      same += Math.abs(g(N / 2) - g(N / 2 - 1));
      apart += Math.abs(g(N / 2) - g(0));
    }
    const ratio = wrap / same;
    ok(ratio >= 0.8 && ratio <= 1.25 && wrap < apart / 4, `axis ${axis}: a step across the wrap is like the same step inside, so it tiles (${ratio.toFixed(3)}; ${(wrap / apart).toFixed(3)} of an unrelated pair's)`);
  }
}

// --- the lava look (src/world/lavaStyle.ts) -----------------------------------------------------

const b64 = (bytes: number[]) => Buffer.from(bytes).toString('base64');
const valid = {
  loopTime: 10000,
  flow: [0, 0.02, 0],
  colorScale: 0.52,
  colorBias: 0.1,
  tcScale: 2,
  textureFactor: 0.2824,
  ramp: { width: 4, rgba: b64([...Array(16).keys()]) },
  mix: 'water/lava_mustafar_slow_s01.png',
  noise: { file: 'water/noise_volume_lava.r8', size: [128, 128, 128] },
};
{
  ok(JSON.stringify(readLavaInfo(valid)) === JSON.stringify(valid), 'a valid lava block reads back as written');
  const bad: [unknown, string][] = [
    [null, 'null'],
    ['lava', 'a string'],
    [[valid], 'an array'],
    [{ ...valid, loopTime: 0 }, 'loopTime 0'],
    [{ ...valid, loopTime: Number.NaN }, 'loopTime NaN'],
    [{ ...valid, flow: [0, 1] }, 'a flow of two'],
    [{ ...valid, tcScale: -1 }, 'a negative tcScale'],
    [{ ...valid, colorBias: 'x' }, 'a colorBias that is not a number'],
  ];
  for (const [raw, what] of bad) ok(readLavaInfo(raw) === null, `${what} is not a lava block`);
  const tf = readLavaInfo({ ...valid, textureFactor: 2 });
  ok(tf !== null && tf.textureFactor === null && tf.ramp !== null, 'a texture factor outside 0..1 is dropped and the rest kept');
  const r3 = readLavaInfo({ ...valid, ramp: { width: 3, rgba: 'AAAA' } });
  ok(r3 !== null && r3.ramp === null, 'a ramp only three wide is dropped');
  ok(readLavaInfo({ ...valid, ramp: { width: 4, rgba: 5 } })?.ramp === null, 'a ramp whose bytes are not a string is dropped');
  for (const mix of ['../x.png', '/x.png', '', 'water/../../x.png']) {
    const m = readLavaInfo({ ...valid, mix });
    ok(m !== null && m.mix === null && m.noise !== null, `a crust path ${JSON.stringify(mix)} that leaves the pack is dropped, the rest kept`);
  }
  ok(readLavaInfo({ ...valid, noise: { file: 'water/n.r8', size: [4, 4] } })?.noise === null, 'a noise size of two numbers is dropped');
  ok(readLavaInfo({ ...valid, noise: { file: 'water/n.r8', size: [4, 4, 1024] } })?.noise === null, 'a noise side past 512 is dropped');
  ok(readLavaInfo({ ...valid, noise: { file: '../n.r8', size: [4, 4, 4] } })?.noise === null, 'a noise file that leaves the pack is dropped');
}
{
  const stand = lavaStyleFor('s', undefined);
  ok(stand.key === 'stand-in:s' && stand.ramp === null && stand.noise === null && stand.mix === null && stand.loopTime === FALLBACK_LAVA_STYLE.loopTime, 'a shader with no entry gets the stand-in look, keyed by the shader');
  const entry = { kind: 'lava' as const, waterTypes: [1], tables: 1, global: false };
  ok(lavaStyleFor('s', entry).key === 'stand-in:s', 'an entry converted before the lava look gets the stand-in look');
  ok(lavaStyleFor('s', { ...entry, lava: null }).key === 'stand-in:s', 'an entry whose MATL could not be read gets the stand-in look');
  const client = lavaStyleFor('s', { ...entry, lava: { ...valid, flow: [0, 0.02, 0] as [number, number, number], noise: { file: 'water/n.r8', size: [128, 128, 128] as [number, number, number] } } });
  ok(client.key === 's' && client.loopTime === 10000 && client.tcScale === 2 && client.mix === valid.mix, 'a valid entry is the client\'s look, keyed by the shader');
  const noFactor = lavaStyleFor('s', { ...entry, lava: { ...valid, textureFactor: null } as never });
  ok(noFactor.textureFactor === LAVA_TEXTURE_FACTOR, 'a shader with no bloom factor glows with the retail lava\'s');
  stand.flow[1] = 99;
  ok(FALLBACK_LAVA_STYLE.flow[1] === 0.03, 'the stand-in handed out is a copy: changing it leaves the fallback alone');
}
{
  const bytes = [...Array(16).keys()].map((i) => i * 7);
  const d = decodeRamp({ width: 4, rgba: b64(bytes) });
  ok(d !== null && d.length === 16 && d.every((v, i) => v === bytes[i]), 'a ramp decodes to its bytes');
  ok(decodeRamp({ width: 4, rgba: b64(bytes.slice(0, 12)) }) === null, 'a ramp with the wrong byte count is not decoded');
  ok(decodeRamp({ width: 4, rgba: '!!!' }) === null && decodeRamp(null) === null, 'a ramp that is not base64, or none, is not decoded');
}
{
  const ramp = standInRamp();
  ok(ramp.length === 1024, 'the stand-in ramp is 256 RGBA texels');
  let rising = true;
  for (let i = 1; i < 256; i++) if (ramp[i * 4 + 3] < ramp[(i - 1) * 4 + 3]) rising = false;
  ok(rising, 'its alpha never falls');
  const glowAt = (i: number) => (ramp[i * 4 + 3] / 255) * LAVA_TEXTURE_FACTOR;
  ok(glowAt(100) < 0.203 && glowAt(115) > 0.213, `it crosses the glow thresholds between texel 100 and 115 (${glowAt(100).toFixed(4)}, ${glowAt(115).toFixed(4)})`);
  ok([ramp[0], ramp[1], ramp[2]].join() === '0,0,0' && [ramp[255 * 4], ramp[255 * 4 + 1], ramp[255 * 4 + 2]].join() === '255,224,96', 'it runs from black to the hot yellow');
  const mid = Math.round(0.5 * 255);
  ok(ramp[mid * 4] === 255 && Math.abs(ramp[mid * 4 + 1] - 0x8a) <= 2, `half way it is the orange stop (${ramp[mid * 4]}, ${ramp[mid * 4 + 1]})`);
}
ok(noiseFits(64, [4, 4, 4]) && !noiseFits(63, [4, 4, 4]) && !noiseFits(64, [4, 16]), 'a noise file fits only when it is exactly its size');
{
  const style: LavaStyle = { ...FALLBACK_LAVA_STYLE, colorScale: 1, colorBias: 0, textureFactor: 1 };
  const ramp = new Uint8Array(256 * 4);
  for (let i = 128; i < 256; i++) ramp[i * 4 + 3] = 255;
  const flat = new Uint8Array(1000).fill(200);
  const f = lavaFarValues(flat, ramp, 256, style, 0.4, 0.6);
  ok(near(f.indexMean, 200 / 255, 1e-6) && f.glowMean === 1, `over flat noise the far index is that noise's and every vein glows (${f.indexMean}, ${f.glowMean})`);
  const split = new Uint8Array(1000);
  split.fill(255, 500);
  const g = lavaFarValues(split, ramp, 256, style, 0.4, 0.6);
  ok(near(g.indexMean, 0.5, 0.01) && near(g.glowMean, 0.5, 0.01), `half dark, half bright averages to half an index and half a glow (${g.indexMean}, ${g.glowMean})`);
  const strided = lavaFarValues(split, ramp, 256, style, 0.4, 0.6, 7);
  ok(near(strided.indexMean, 0.5, 0.02), 'a stride samples the noise evenly');
}
{
  const groups = groupLava([{ shader: 'a', shaderSize: 64, n: 1 }, { shader: 'b', shaderSize: 64, n: 2 }, { shader: 'a', shaderSize: 64, n: 3 }, { shader: 'a', shaderSize: 2, n: 4 }]);
  const keys = [...groups.keys()];
  ok(keys.join() === 'a|64,b|64,a|2' && groups.get('a|64')!.map((t) => t.n).join() === '1,3' && groups.get('b|64')!.length === 1, `tables group by shader and size in first-seen order (${keys.join(' ')})`);
}

// --- the heat sources (src/world/heatSources.ts) ------------------------------------------------

{
  const square = [0, 0, 10, 0, 10, 10, 0, 10];
  ok(polygonDistance2(5, 5, square) === 0, 'inside a table is no distance at all');
  ok(near(polygonDistance2(15, 5, square), 25, 1e-9), 'beside it is the distance to the edge, squared');
  ok(near(polygonDistance2(15, 15, square), 50, 1e-9), 'off a corner is the distance to the corner, squared');
  // An L: the square with its top-right quarter cut away.
  const ell = [0, 0, 10, 0, 10, 5, 5, 5, 5, 10, 0, 10];
  ok(polygonDistance2(2, 8, ell) === 0 && polygonDistance2(8, 2, ell) === 0, 'inside either arm of an L is inside');
  ok(near(polygonDistance2(8, 7, ell), 4, 1e-9), `in the notch of an L it is the nearest edge, not the box (${polygonDistance2(8, 7, ell)})`);
  ok(polygonDistance2(0, 0, []) === Infinity, 'a table with no outline is infinitely far');
}
{
  const heat = new HeatSources();
  const ran: string[] = [];
  let removeA = () => {};
  removeA = heat.addProvider(() => { ran.push('a'); removeA(); });
  heat.addProvider(() => ran.push('b'));
  let added = false;
  heat.addProvider(() => {
    ran.push('c');
    if (!added) {
      added = true;
      heat.addProvider(() => ran.push('d'));
    }
  });
  const sink = { push: () => true };
  heat.runProviders(sink);
  ok(ran.join() === 'a,b,c,d', `a provider that removes itself does not skip the next, and one added during a run runs in it (${ran.join()})`);
  ran.length = 0;
  heat.runProviders(sink);
  ok(ran.join() === 'b,c,d' && heat.providerCount === 3, `the removed provider is gone the next time (${ran.join()})`);
  const v = heat.lavaVersion;
  heat.setLava([]);
  ok(heat.lavaVersion === v + 1 && heat.lava.length === 0, 'setting the lava bumps its version');
}
{
  const buf = new PlumeBuffer(2);
  buf.reset(0, 0, 0);
  ok(buf.push(0, 0, -5, 0, 0, -1, 2, 0.1, 0.5, 1, 0) && buf.push(0, 0, -6, 0, 0, -1, 2, 0.1, 0.5, 1, 0) && buf.count === 2, 'two plumes fit a buffer of two');
  ok(!buf.push(0, 0, -7, 0, 0, -1, 2, 0.1, 0.5, 1, 0) && buf.count === 2 && buf.pushed === 3, 'a third says the buffer is full');

  const b = new PlumeBuffer(8);
  b.reset(0, 0, 0);
  const degenerate: [string, number[]][] = [
    ['length 0', [0, 0, -5, 0, 0, -1, 0, 0.1, 0.5, 1, 0]],
    ['intensity 0', [0, 0, -5, 0, 0, -1, 2, 0.1, 0.5, 0, 0]],
    ['no direction', [0, 0, -5, 0, 0, 0, 2, 0.1, 0.5, 1, 0]],
    ['r0 NaN', [0, 0, -5, 0, 0, -1, 2, Number.NaN, 0.5, 1, 0]],
    ['r1 -1', [0, 0, -5, 0, 0, -1, 2, 0.1, -1, 1, 0]],
    ['a NaN origin', [Number.NaN, 0, -5, 0, 0, -1, 2, 0.1, 0.5, 1, 0]],
    ['an infinite phase', [0, 0, -5, 0, 0, -1, 2, 0.1, 0.5, 1, Infinity]],
  ];
  for (const [what, args] of degenerate) {
    const kept = (b.push as (...a: number[]) => boolean)(...args);
    ok(kept && b.count === 0, `a plume with ${what} is dropped and the buffer is not full`);
  }
  b.push(1, 2, 3, 0, 0, -3, 2, 0, 0.001, 1, 2.25);
  ok(b.count === 1 && b.shape[0] === f32(PLUME_MIN_RADIUS) && b.shape[1] === f32(PLUME_MIN_RADIUS), 'radii of 0 and 0.001 are raised to 0.02');
  ok(near(Math.hypot(b.dir[0], b.dir[1], b.dir[2]), 1, 1e-6) && b.dir[2] === -1, 'the direction is written unit length');
  ok(b.shape[3] === 0.25, 'the phase 2.25 is written as 0.25');
  ok(b.shape[2] === f32(plumeNoiseFrequency(PLUME_MIN_RADIUS)), 'the noise frequency is the end radius\'s');
  b.push(0, 0, -5, 0, 0, -1, 2, 0.1, 0.5, 9, 0);
  ok(b.dir[4 + 3] === 2, 'an intensity past 2 is held to 2');

  const far = new PlumeBuffer(4);
  far.range = 50;
  far.reset(0, 0, 0);
  far.push(0, 0, -300, 0, 0, -1, 2, 0.1, 0.5, 1, 0);
  ok(far.count === 0, 'a plume 300 m off is past a 50 m range');

  const small = new PlumeBuffer(4);
  small.focalPixels = 100;
  small.minPixels = 2;
  small.reset(0, 0, 0);
  small.push(0, 0, -100, 0, 0, -1, 1, 0.5, 0.5, 1, 0);
  ok(small.count === 0 && small.tooSmall === 1, 'a half-metre plume at 100 m is under two heat texels and skipped');
  small.push(0, 0, -100, 0, 0, -1, 1, 5, 5, 1, 0);
  ok(small.count === 1 && small.tooSmall === 1, 'a five-metre plume there is kept');

  const culled = new PlumeBuffer(4);
  culled.cull = () => false;
  culled.reset(0, 0, 0);
  culled.push(0, 0, -5, 0, 0, -1, 2, 0.1, 0.5, 1, 0);
  ok(culled.count === 0, 'a plume the cull turns down is skipped');
}
ok(plumeNoiseFrequency(0.01) === 1.5 && plumeNoiseFrequency(1) === 0.25, 'small plumes get finer noise, large ones the base');
{
  let inRange = true;
  for (let r = 0; r <= 10; r += 0.01) {
    const f = plumeNoiseFrequency(r);
    if (f < 0.25 || f > 1.5) inRange = false;
  }
  ok(inRange && plumeNoiseFrequency(Number.NaN) === 1.5, 'the frequency never leaves 0.25..1.5');
}

// --- the engines (src/vehicles/enginePlumes.ts) -------------------------------------------------

{
  ok(engineHeatOf(false, 1, 1, true, false) === 0, 'an engine that is not running gives no heat');
  ok(near(engineHeatOf(true, 0, 0, false, false), 0.3, 1e-12), 'a running engine at rest idles at 0.3');
  ok(near(engineHeatOf(true, 1, 1, true, false), 1.6, 1e-12), 'flat out and boosting is held to 1.6');
  ok(near(engineHeatOf(true, 1, 1, true, true), 0.8, 1e-12), 'the same overheated is halved');
  let rising = true;
  let last = -1;
  for (let s = 0; s <= 1.0001; s += 0.05) {
    const h = engineHeatOf(true, s, 0.5, false, false);
    if (h < last) rising = false;
    last = h;
  }
  ok(rising, 'the heat never falls as the speed rises');
  ok(engineHeatOf(true, 5, -3, false, false) === engineHeatOf(true, 1, 0, false, false), 'a share or throttle out of range is held to 0..1');
}
{
  const out: PlumeShape = { length: 0, r0: 0, r1: 0, intensity: 0, flow: 0 };
  const kinds: [VehicleKind, boolean, number, number][] = [
    ['ship', true, 1.6, 12],
    ['podracer', false, 1.2, 10],
    ['speederbike', false, 0.6, 6],
    ['flyer', false, 0.9, 6],
    ['ground', false, 1.4, 6],
  ];
  for (const [kind, ship, size, cap] of kinds) {
    let grows = true;
    let prevLength = -1;
    let prevIntensity = -1;
    let under = true;
    let radii = true;
    for (let h = 0; h <= 1.6001; h += 0.05) {
      for (const sz of [0.1, size, 7]) {
        enginePlume(kind, ship, sz, h, out);
        if (out.length > cap + 1e-9) under = false;
        if (!(out.r1 > out.r0 && out.r0 > 0)) radii = false;
      }
      enginePlume(kind, ship, size, h, out);
      if (out.length < prevLength - 1e-12 || out.intensity < prevIntensity - 1e-12) grows = false;
      prevLength = out.length;
      prevIntensity = out.intensity;
    }
    ok(grows, `${kind}: the plume's length and heat do not fall as the engine runs harder`);
    ok(under, `${kind}: the plume is never longer than ${cap} m`);
    ok(radii, `${kind}: the plume widens from a real nozzle (r1 > r0 > 0)`);
  }
  enginePlume('ship', true, 100, 1, out);
  ok(out.r0 <= 6 && out.r1 <= 6, 'no radius passes 6 m, whatever the size');
  enginePlume('speederbike', false, Number.NaN, Number.NaN, out);
  ok([out.length, out.r0, out.r1, out.intensity, out.flow].every(Number.isFinite), 'a size or heat that is not a number gives a plume of numbers');
}
{
  const stub = { spec: { kind: 'speederbike' as VehicleKind }, engineHeat: 1, enginePhase: 0.9 } as unknown as Vehicle;
  const shape: PlumeShape = { length: 0, r0: 0, r1: 0, intensity: 0, flow: 0 };
  enginePlume('speederbike', false, 0.4, 1, shape);
  const dt = 0.016;
  const expected = (0.9 + dt * shape.flow * plumeNoiseFrequency(shape.r1)) % 1;
  advanceEnginePhase(stub, 0.4, dt);
  ok(stub.enginePhase >= 0 && stub.enginePhase < 1 && near(stub.enginePhase, expected, 1e-12), `the exhaust phase moves by dt × flow × frequency, wrapped (${stub.enginePhase.toFixed(4)})`);
  for (let i = 0; i < 1000; i++) advanceEnginePhase(stub, 0.4, 0.05);
  ok(stub.enginePhase >= 0 && stub.enginePhase < 1, 'it stays in 0..1 however long it runs');
  const before = stub.enginePhase;
  advanceEnginePhase(stub, 0.4, Number.NaN);
  ok(stub.enginePhase === before, 'a step that is not a number leaves it where it was');
}
{
  // Stub vehicles: a group turned a quarter about Y (its -Z pointing along -X), glows at known places.
  // Column-major, as three keeps it: +X goes to -Z and +Z to +X.
  const quarter = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 10, 0, 20, 1];
  const at = (x: number, y: number, z: number) => ({ matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1] } });
  const bike = (heat: number, visible = true) =>
    ({
      spec: { kind: 'speederbike', ship: false },
      engineHeat: heat,
      enginePhase: 0.25,
      group: { visible, matrixWorld: { elements: quarter } },
      engines: [
        { object: at(9, 1, 19), size: 0.5, seed: 0 },
        { object: at(9, 1, 21), size: 0.5, seed: 0.618034 },
      ],
    }) as unknown as Vehicle;
  const buf = new PlumeBuffer(8);
  buf.reset(0, 0, 0);
  vehiclePlumes([bike(1), bike(0.01), bike(1, false)], buf);
  ok(buf.count === 2 && buf.pushed === 2, `only the running, visible vehicle's two engines give plumes (${buf.count})`);
  ok(buf.origin[0] === 9 && buf.origin[1] === 1 && buf.origin[2] === 19, 'a plume leaves from its glow');
  ok(near(buf.dir[0], -1, 1e-6) && near(buf.dir[1], 0, 1e-6) && near(buf.dir[2], 0, 1e-6), 'along the group\'s -Z, turned with it');
  const shape: PlumeShape = { length: 0, r0: 0, r1: 0, intensity: 0, flow: 0 };
  enginePlume('speederbike', false, 0.5, 1, shape);
  ok(near(buf.origin[3], shape.length, 1e-6) && near(buf.shape[0], shape.r0, 1e-6) && near(buf.shape[1], shape.r1, 1e-6), 'with the shape its kind and heat give');
  ok(near(buf.shape[4 + 3], (0.25 + 0.618034) % 1, 1e-6), 'each engine\'s phase is the vehicle\'s plus its own seed');
  const full = new PlumeBuffer(1);
  full.reset(0, 0, 0);
  vehiclePlumes([bike(1), bike(1)], full);
  ok(full.count === 1 && full.pushed === 2, 'a full buffer stops the walk at once');
}

console.log(`${passed} checks passed`);
