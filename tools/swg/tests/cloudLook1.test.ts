// The clouds' look wave, round 1 (the GPU port's pass 3): light and sampling, and the map's two cheap shape lines.
//   1. the angle terms once a ray: each body's three octaves' phases worked from the ray's cosine and each sample's falls from
//      its depth give the octaves exactly, the rim lobe at nought; the rim lobe keeps the phase whole and sharpens the forward peak;
//   2. light by depth: wave 1's powder exactly where the rims read the sample's own density and there is no glow; dark rims with
//      the light behind, the inner glow with it ahead, by the depth toward the light; the sky's light under the cloud above;
//   3. dusk from below: the sun lights a cloud over its own height's horizon, and the clouds' light way stays the sun's while it
//      does though the land's has turned to the moon;
//   4. the map: with the domes, the turrets and the clusters at nought the texel is the base's to the bit (the base loaded out
//      of git); at their starts the tops are domed and turreted and the cover gathers in clusters with holes, its mean held;
//   5. the march's text: the cheap pass's step back, the detail's fade, the curved decks, the sky's light and the rims.
//
// Run: node tools/swg/tests/cloudLook1.test.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLOUD_LAYER_MAX, CLOUD_STACK_FLOATS, CLOUD_TYPE_FLOATS, cleanLayer, newStackFrame, packStack, packTypes, type CloudLayer } from '../../../src/sky/clouds/cloudLayers.ts';
import { CLOUD_MAP_TUNE, CloudMapFrame, PLAN_FLOATS, TexelOut, evalTexel, planRings } from '../../../src/sky/clouds/cloudMap.ts';
import { LIGHT_NUM, depthLightOf, hgOf, lightLookNumbers, octaveFallsOf, octavesOf, octavesWith, phaseOf, powderOf, rayPhasesOf, skyLightOf, sunLightsClouds } from '../../../src/sky/clouds/cloudLight.ts';
import { CLOUD_LOOK } from '../../../src/sky/clouds/cloudShape.ts';
import { CLOUD_FEED, CLOUD_TUNE } from '../../../src/sky/clouds/cloudTune.ts';
import { CLOUD_U, GpuCloudPass } from '../../../src/sky/clouds/cloudMarch.ts';
import { AIR } from '../../../src/sky/air/airApi.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const root = new URL('../../../', import.meta.url);
const src = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const fileUrl = (p: string): string => pathToFileURL(new URL(p, root).pathname.replace(/^\/([A-Za-z]:)/, '$1')).href;

// ---------------------------------------------------------------------------------------------- 1. the angle terms once a ray
{
  const L = lightLookNumbers();
  const ph: number[] = [0, 0, 0];
  const fa: number[] = [0, 0, 0];
  let same = true;
  let n = 0;
  for (const c of [-1, -0.7, -0.2, 0, 0.3, 0.8, 0.97, 1]) {
    rayPhasesOf(LIGHT_NUM, L, c, 0, 0.9, ph);
    for (const tau of [0, 0.01, 0.3, 1, 4, 20, 80]) {
      octaveFallsOf(LIGHT_NUM, L, tau, fa);
      if (octavesWith(LIGHT_NUM, fa, ph) !== octavesOf(LIGHT_NUM, L, tau, c)) same = false;
      n++;
    }
  }
  ok(same, `a ray's phases and a sample's falls give wave 1's octaves to the bit with no rim (${n} cases)`);
  // The rim lobe mixed in keeps the phase whole over the sphere and sharpens the forward peak.
  let sum = 0;
  const steps = 20000;
  for (let i = 0; i < steps; i++) {
    const c = -1 + (2 * (i + 0.5)) / steps;
    sum += rayPhasesOf(LIGHT_NUM, L, c, 0.3, 0.9, ph)[0] * 2 * Math.PI * (2 / steps);
  }
  ok(Math.abs(sum - 1) < 2e-3, `single scattering's phase with the rim mixed in still integrates to one (${sum.toFixed(4)})`);
  const plain = phaseOf(LIGHT_NUM, L, 1, 0.995);
  const rimmed = rayPhasesOf(LIGHT_NUM, L, 0.995, 0.3, 0.9, ph)[0];
  ok(rimmed > 1.5 * plain && hgOf(LIGHT_NUM, 0.9, 0.995) > plain, `the rim lobe sharpens the silver lining toward the sun (${plain.toFixed(2)} to ${rimmed.toFixed(2)} a steradian)`);
}

// ---------------------------------------------------------------------------------------------- 2. light by depth, the sky's light
{
  const L = lightLookNumbers();
  let same = true;
  for (const sig of [0, 1e-5, 1e-3, 0.01, 0.06, 0.2]) for (const c of [-1, -0.4, 0, 0.5, 1]) if (depthLightOf(LIGHT_NUM, L, 0, sig * L.powderDepth, c) !== powderOf(LIGHT_NUM, L, sig, c)) same = false;
  ok(same, "with the rims read by the sample's own density and no glow, the light is wave 1's powder to the bit");
  ok(Math.abs(depthLightOf(LIGHT_NUM, L, 0.4, 0, -1) - (1 - L.powder)) < 1e-12, 'with the light behind, the skin (no depth toward the light) keeps one less the powder: a dark rim');
  ok(depthLightOf(LIGHT_NUM, L, 0.4, 6, -1) > 0.999, 'with the light behind, a crevice deep toward the light keeps its whole light: bright');
  ok(Math.abs(depthLightOf(LIGHT_NUM, L, 0.4, 6, 1) - 1.4) < 1e-4 && depthLightOf(LIGHT_NUM, L, 0.4, 0, 1) === 1, 'with the light ahead, the deep heart glows by the glow while the thin edge keeps its own (the phase\'s silver lining)');
  ok(skyLightOf(LIGHT_NUM, 0, 1, 0.08) === 1 && skyLightOf(LIGHT_NUM, 5, 0, 0.08) === 1, 'no cloud above, or the dial at nought, leaves the sky\'s light whole (wave 2\'s)');
  ok(Math.abs(skyLightOf(LIGHT_NUM, 200, 1, 0.08) - 0.08) < 1e-9 && skyLightOf(LIGHT_NUM, 1, 1, 0.08) < 0.45, 'under a storm\'s column the sky\'s light falls to its least: a dark base');
  ok(CLOUD_LOOK.skyAbove > 0 && CLOUD_LOOK.rimsByDepth === 1 && CLOUD_LOOK.rim > 0 && CLOUD_LOOK.glow > 0 && CLOUD_LOOK.skyBorrow > 0, 'the round\'s light starts on (every strength a dial of his)');
}

// ---------------------------------------------------------------------------------------------- 3. dusk from below
{
  const deg = Math.PI / 180;
  ok(sunLightsClouds(Math.sin(-2 * deg), 8) && !sunLightsClouds(Math.sin(-4 * deg), 8), 'a sun two degrees down still lights an 8 km top (the dip there is 2.9 degrees), four down does not');
  ok(sunLightsClouds(Math.sin(0.1 * deg), 0) && !sunLightsClouds(Math.sin(-0.1 * deg), 0), 'at the datum the horizon is the level');
  const f = AIR.frame;
  const keep = { sun: f.sunDir.clone(), light: f.lightDir.clone(), st: f.sunTop.clone(), mt: f.moonTop.clone(), h: f.heightKm, stack: CLOUD_FEED.stack, count: CLOUD_FEED.count, p0z: CLOUD_U.p0.z };
  try {
    const stack = new Float32Array(CLOUD_STACK_FLOATS);
    stack[0] = 1500;
    stack[1] = 8000;
    stack[2] = 1;
    stack[7] = 1;
    CLOUD_FEED.stack = stack;
    CLOUD_FEED.count = 1;
    CLOUD_U.p0.z = 20;
    f.heightKm = 0.02;
    f.moonDir.set(0.3, 0.8, 0.1).normalize();
    f.lightDir.copy(f.moonDir);
    f.sunTop.setRGB(0.6, 0.3, 0.1);
    f.moonTop.setRGB(1e-6, 1e-6, 1e-6);
    const way = (GpuCloudPass.prototype as unknown as { lightWay(): { x: number; y: number; z: number } }).lightWay;
    f.sunDir.set(Math.cos(-2 * deg), Math.sin(-2 * deg), 0);
    ok(way.call({}) === f.sunDir, "two degrees down, with the land's light the moon's, the clouds' light march still looks toward the sun");
    f.sunDir.set(Math.cos(-4 * deg), Math.sin(-4 * deg), 0);
    ok(way.call({}) === f.lightDir, "four degrees down, under every layer's horizon, it looks the air's way (the moon's)");
    f.sunDir.set(Math.cos(-2 * deg), Math.sin(-2 * deg), 0);
    f.sunTop.setRGB(0, 0, 0);
    ok(way.call({}) === f.lightDir, 'a sun whose light is gone (a totality) never takes the light march from the moon');
  } finally {
    f.sunDir.copy(keep.sun);
    f.lightDir.copy(keep.light);
    f.sunTop.copy(keep.st);
    f.moonTop.copy(keep.mt);
    f.heightKm = keep.h;
    CLOUD_FEED.stack = keep.stack;
    CLOUD_FEED.count = keep.count;
    CLOUD_U.p0.z = keep.p0z;
  }
}

// ---------------------------------------------------------------------------------------------- 4. the map
const types = new Float32Array(CLOUD_TYPE_FLOATS);
packTypes(types);
function stackOf(layers: CloudLayer[]): { stack: Float32Array; n: number } {
  const fr = newStackFrame();
  fr.groundY = 0;
  fr.level = 0;
  fr.hour = 0;
  fr.wet = 1;
  const stack = new Float32Array(CLOUD_STACK_FLOATS);
  return { stack, n: packStack(layers, fr, stack) };
}
{
  const dir = mkdtempSync(join(tmpdir(), 'cloudlook1-'));
  try {
    const old = execFileSync('git', ['show', '9a2071e:src/sky/clouds/cloudMap.ts'], { cwd: new URL('.', root), encoding: 'utf8' })
      .replace("from './cloudLayers.ts'", `from '${fileUrl('src/sky/clouds/cloudLayers.ts')}'`)
      .replace("from '../../world/weatherSchedule.ts'", `from '${fileUrl('src/world/weatherSchedule.ts')}'`);
    const file = join(dir, 'cloudMapBase.ts');
    writeFileSync(file, old);
    const base = (await import(pathToFileURL(file).href)) as { evalTexel: typeof evalTexel; TexelOut: typeof TexelOut; CloudMapFrame: typeof CloudMapFrame };
    const decks: CloudLayer[][] = [
      [cleanLayer({ name: 'cu', types: ['cumulus'], shares: [1], cover: [0.4, 0.4, 0.4, 0.4, 0.4] }, null)],
      [cleanLayer({ name: 'mix', types: ['cumulus', 'stratocumulus'], shares: [1, 1], cover: [0.6, 0.6, 0.6, 0.6, 0.6] }, null)],
      [cleanLayer({ name: 'st', types: ['stratus'], shares: [1], cover: [0.5, 0.5, 0.5, 0.5, 0.5] }, null)],
    ];
    const drift = new Float64Array(CLOUD_LAYER_MAX * 4);
    drift[0] = 4321.5;
    drift[1] = -876.25;
    const plan = new Float64Array(PLAN_FLOATS);
    const T0 = { ...CLOUD_MAP_TUNE, cellLife: 0, cellDome: 0, cellTurrets: 0, clusters: 0 };
    const T1 = { ...CLOUD_MAP_TUNE, cellLife: 0 };
    const a = new TexelOut();
    const b = new base.TexelOut();
    const fr = new CloudMapFrame();
    const frB = new base.CloudMapFrame();
    let same = true;
    let cases = 0;
    let domed = 0;
    let differs = 0;
    for (const layers of decks) {
      const { stack, n } = stackOf(layers);
      planRings(stack, n, { camX: 123.5, camZ: -456.25 }, drift, T1, plan);
      for (let tz = -128; tz < 128; tz += 3) {
        for (let tx = -128; tx < 128; tx += 3) {
          evalTexel(stack, types, plan, fr, T0, 0, 0, tx, tz, a);
          base.evalTexel(stack, types, plan, frB, T0, 0, 0, tx, tz, b);
          if (a.cover !== b.cover || a.top !== b.top || a.mix !== b.mix || a.wet !== b.wet) same = false;
          cases++;
          evalTexel(stack, types, plan, fr, T1, 0, 0, tx, tz, a);
          if (a.cover !== b.cover || a.top !== b.top) differs++;
          if (b.cover > 0.05 && a.top < b.top - 1e-6) domed++;
        }
      }
    }
    ok(same, `with the domes, the turrets and the clusters at nought the map's texel is the base's to the bit (${cases} texels, three decks)`);
    ok(differs > cases / 4 && domed > 100, `at their starts the texels move (${differs} of ${cases}) and tops fall from the middle (${domed} lower)`);
    // Clusters and holes: blocks of cells, their covers spread wider than the even field's, the mean held.
    const { stack, n } = stackOf([decks[0][0]]);
    planRings(stack, n, { camX: 0, camZ: 0 }, drift, T1, plan);
    const blockSpread = (T: typeof T1): { mean: number; sd: number; clear: number } => {
      const blocks: number[] = [];
      let all = 0;
      let k = 0;
      let clear = 0;
      for (let bz = -128; bz < 128; bz += 32) {
        for (let bx = -128; bx < 128; bx += 32) {
          let s = 0;
          for (let z = 0; z < 32; z += 2) for (let x = 0; x < 32; x += 2) {
            evalTexel(stack, types, plan, fr, T, 0, 0, bx + x, bz + z, a);
            s += a.cover;
            all += a.cover;
            k++;
          }
          const m = s / 256;
          blocks.push(m);
          if (m < 0.02) clear++;
        }
      }
      const mean = blocks.reduce((p, q) => p + q, 0) / blocks.length;
      const sd = Math.sqrt(blocks.reduce((p, q) => p + (q - mean) * (q - mean), 0) / blocks.length);
      return { mean: all / k, sd, clear };
    };
    const even = blockSpread({ ...T1, clusters: 0 });
    const grouped = blockSpread(T1);
    ok(grouped.sd > 1.5 * even.sd, `the cover gathers in clusters: its spread over blocks of four cells ${even.sd.toFixed(3)} even, ${grouped.sd.toFixed(3)} clustered`);
    ok(Math.abs(grouped.mean - even.mean) < 0.35 * even.mean, `and the mean cover holds near the layer's (${even.mean.toFixed(3)} even, ${grouped.mean.toFixed(3)} clustered)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const gpu = src('src/sky/clouds/cloudMapGpu.ts');
  ok(/const t5v = tune\.element\(int\(5\)\);/.test(gpu) && /\.mul\(env\)\.mul\(kc\)\.min\(1\.1\)/.test(gpu) && /float\(1\)\.sub\(t5v\.x\)\.add\(t5v\.x\.mul\(sqrt\(v\)\)\)/.test(gpu) && /saltN\(seed, SALT_TURRETS\)/.test(gpu) && /SALT_CLUSTERS\), t2v\.x\)/.test(gpu), "the card's map takes the domes, the turrets and the clusters line for line with the twin");
  ok(/out\[20\] = T\.cellDome;\s*out\[21\] = T\.cellTurrets;\s*out\[22\] = T\.clusters;/.test(src('src/sky/clouds/cloudMap.ts')), "the map's tune hands them on in its sixth vector");
}

// ---------------------------------------------------------------------------------------------- 5. the march's text
{
  const m = src('src/sky/clouds/cloudMarch.ts');
  ok(/const q = vec4\(densP\(p, y\)\)\.toVar\('swgCloudProbe'\);\s*If\(q\.x\.greaterThan\(1e-7\), \(\) => \{\s*fine\.assign\(1\);\s*empty\.assign\(0\);\s*grow\.assign\(1\);\s*\}\)\.Else\(\(\) => \{/.test(m), 'the cheap pass steps back where it meets cloud (the step not taken) and walks on with the full shape');
  ok(/If\(T3\.x\.greaterThan\(0\.5\)\.and\(empty\.greaterThanEqual\(T3\.z\)\), \(\) => \{\s*fine\.assign\(0\);/.test(m), 'past a heap it goes back to the cheap pass after its empty samples');
  ok(/erosion: form === 'probe' \? float\(0\) : R\.l0\.y/.test(m), "the cheap pass's shape has no erosion, so it is never less than the full shape's");
  ok(/const dw = float\(1\)\.sub\(smoothstep\(R\.t4\.x, R\.t4\.y, far\)\)/.test(m) && /If\(dw\.greaterThan\(0\), \(\) => \{/.test(m), "the detail fades out with distance and its reads are skipped past its far end");
  ok(/const heightOf = \(q: Any\): Any => camY\.add\(q\.y\)\.add\(q\.x\.mul\(q\.x\)\.add\(q\.z\.mul\(q\.z\)\)\.mul\(T3\.w\)\);/.test(m) && /band\.x\.sub\(T3\.w\.mul\(rb\)\.mul\(rb\)\)/.test(m) && CLOUD_TUNE.curveRadius === 0, 'the decks curve only as an option (flat to start), every sample and band through one height');
  ok(/const sky = skyLightOf\(LIGHT_NODE, d\.z, L8\.x, L8\.z\);/.test(m) && /ambUp\.add\(ambSun\.mul\(exp\(tau\.mul\(L8\.w\)\.negate\(\)\)\)\)\.mul\(sky\)/.test(m), "the ambient is the sky's light through the cloud above, its sunward third taken by the light march's depth");
  ok(/const depthIn = mix\(sig\.mul\(L4\.x\), tauN, L7\.w\);/.test(m) && /if \(k === DEPTH_STEPS - 1\) tauN\.assign\(tau\);/.test(m), "the rims and the glow read the light march's first steps' depth");
  ok(/const phS = phaseRay\(n\.sunDir, 'S'\);/.test(m) && /octavesWith\(LIGHT_NODE, falls, ph\)/.test(m) && !/octavesOf\(LIGHT_NODE/.test(m), 'the phases are worked once a ray and the octaves once a sample, for every body');
  ok(/const ld = this\.lightWay\(\);/.test(m), "the light march's way is the clouds' own (the sun while it lights them)");
  ok(CLOUD_TUNE.probe === 0 && CLOUD_TUNE.detailNear < CLOUD_TUNE.detailFar, 'the cheap pass is a dial that starts off (measured dearer than the full shape at every step), the detail fades from near to far');
}

console.log(`\ncloudLook1: ${checks} checks passed`);
