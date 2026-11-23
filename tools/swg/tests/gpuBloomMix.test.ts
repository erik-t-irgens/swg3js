// The sky and light fix round, maker E, in node: the owner's demo's bloom under our sky on WebGPU (`src/core/gpu/
// gpuBloomMix.ts`), the stored ceiling it rests on (`gpuChain.ts`'s sanitize, `airHaze.ts`), the output's one dither (wave 4b's
// `src/sky/night/dither.ts`: the round's own was dropped at the two lines' merge), and the Graphics page's Bloom strength row
// on WebGPU (`bloomMix`). Node
// draws nothing, so the pictures are a browser's; held here:
//  1. the demo's numbers: its thirteen-tap down's weights and Karis groups, its tent, its six half-size levels, each a weighted
//     mean (so no level holds more than the picture's most), and the ceiling's six times inside a half float;
//  2. the pass over a stand-in renderer: the downs largest first, the ups back up, the mix over the picture where it stands, the
//     first down reading the chain's input, the strength the setting's, nothing drawn when it is nought, the levels sized;
//  3. the graphs: the first level's Karis weights read the eye's exposure over the store's, the others not; the up adds one and
//     one, the mix blends by its alpha and one less it, both keeping the picture's alpha; chain materials all;
//  4. the warm-up: every graph against the very target it draws into, four pipelines' worth of graphs;
//  5. the spine: our sky draws the demo's bloom, SWG's sky three's, and the sanitize's and the haze's ceilings;
//  6. the dither, once: the output graph's own step adds one dither (wave 4b's, the demo's noise in it), onto the canvas alone,
//     the output pass adds none of its own, and its dial is the `stars` set's, none in the `exposure` set;
//  7. the row: `bloomMix` 0 to 0.12, 0.04 to start, on WebGPU under our sky in place of `bloomStrength`.
//
// Run: node tools/swg/tests/gpuBloomMix.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GpuMixBloomPass, MIX_BLOOM_FIXED, downGraph, mixBloomSizes } from '../../../src/core/gpu/gpuBloomMix.ts';
import { CHAIN_NUMBERS } from '../../../src/core/gpu/gpuChain.ts';
import { EYE_ATTR } from '../../../src/sky/exposure/eyeBuffer.ts';
import { PRE_ATTR } from '../../../src/sky/exposure/preExpose.ts';
import { DITHER_TUNE, ign } from '../../../src/sky/night/ditherTune.ts';
import { nightDialSet } from '../../../src/sky/night/nightTune.ts';
import { toCanvasNode } from '../../../src/core/gpu/inlineOutput.ts';
import { eyeDialSet } from '../../../src/sky/exposure/eyeDials.ts';
import { FX_DEFAULTS, FX_KNOBS } from '../../../src/core/fxRegistry.ts';
import * as TSL from 'three/tsl';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (f: string): string => readFileSync(join(ROOT, f), 'utf8');
let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  console.log(`ok   ${msg}`);
};
const near = (a: number, b: number, eps: number): boolean => Math.abs(a - b) <= eps;
/** Whether a node graph reaches `target` (a node, or the attribute a buffer node holds), walking nodes' own fields. */
const reaches = (graphRoot: Any, target: Any): boolean => {
  const seen = new Set<unknown>();
  const walk = (x: Any, depth: number): boolean => {
    if (x === target) return true;
    if (!x || typeof x !== 'object' || seen.has(x) || depth > 60) return false;
    seen.add(x);
    if (Array.isArray(x)) return x.some((y) => walk(y, depth + 1));
    if (!x.isNode && depth > 0 && !x.isStorageBufferAttribute && !(x.isBufferAttribute)) return false;
    for (const k of Object.keys(x)) if (k !== 'parents' && walk(x[k], depth + 1)) return true;
    return false;
  };
  return walk(graphRoot, 0);
};

// ---------------------------------------------------------------- 1. the demo's numbers
{
  const F = MIX_BLOOM_FIXED;
  const D = F.down;
  ok(near(D.plainMiddle + 4 * D.plainCorner + 4 * D.plainEdge + 4 * D.plainInner, 1, 1e-15), "the plain down's thirteen weights (an eighth the middle, a thirty-second each corner, a sixteenth each edge, an eighth each inner) sum to one: a weighted mean, the demo's `e*0.125 + (a+c+g+i)*0.03125 + (b+d+f+h)*0.0625 + (j+k+l+m)*0.125`");
  ok(near(4 * D.group + D.middleGroup, 1, 1e-15) && D.outer === 2 && D.inner === 1, "the Karis down's five groups weigh an eighth each and the middle a half (the demo's 0.125 and 0.5), its taps two and one source texels out");
  ok(F.tent.middle + 4 * F.tent.edge + 4 * F.tent.corner === F.tent.sum && F.tent.sum === 16, "the up's tent is the demo's 4, 2 and 1 over 16");
  ok(F.luma[0] === 0.2126 && F.luma[1] === 0.7152 && F.luma[2] === 0.0722, "its luminance the demo's own (Rec. 709)");
  // The demo's loop: `while (sizes.length < 6 && bw > 2 && bh > 2) { bw = max(1, bw >> 1); bh = max(1, bh >> 1); sizes.push(...) }`.
  const demo = (w: number, h: number): string => {
    const s: string[] = [];
    let bw = w;
    let bh = h;
    while (s.length < 6 && bw > 2 && bh > 2) {
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
      s.push(`${bw}x${bh}`);
    }
    if (!s.length) s.push('1x1');
    return s.join(' ');
  };
  const sizes: [number, number][] = Array.from({ length: 6 }, () => [0, 0] as [number, number]);
  for (const [w, h] of [[1920, 1080], [1600, 900], [2560, 1440], [3840, 2160], [801, 451], [12, 7], [3, 3], [2, 2], [1, 1]]) {
    const n = mixBloomSizes(w, h, sizes);
    const ours = sizes.slice(0, n).map((s) => `${s[0]}x${s[1]}`).join(' ');
    ok(ours === demo(w, h), `${w} by ${h}: the levels ${ours}, the demo's own loop's`);
  }
  // The stored ceiling: every filter a weighted mean, so a level holds at most the picture's most; the up adds six levels.
  const S = CHAIN_NUMBERS.sanitize.stored;
  ok(S * F.levels < 65504 && 2 * S * F.levels > 65504 && Math.log2(S) % 1 === 0, `the stored ceiling ${S}: six levels of it summed (${S * F.levels}) stay under a half float's 65,504, twice it would not, a power of two`);
  ok(S / 15 > 500, `and some ${Math.round(S / 15)} times the 15 that is white on the screen once exposed, so a sun's disc and a hazy aureole keep their shape into the bloom`);
}

// ---------------------------------------------------------------- 2. the pass over a stand-in renderer
{
  const calls: string[] = [];
  let target: Any = null;
  const r: Any = {
    setRenderTarget(t: Any) {
      target = t;
    },
    render(m: Any) {
      calls.push(`${m.name}>${target === input ? 'input' : target ? target.texture.name : 'canvas'}`);
    },
  };
  const input: Any = new THREE.RenderTarget(1920, 1080, { type: THREE.HalfFloatType, depthBuffer: false });
  const pass = new GpuMixBloomPass(1920, 1080, 0.04);
  const settings: Any = { ...FX_DEFAULTS };
  const ctx: Any = { renderer: r, settings };
  ok(pass.id === 'bloom' && pass.timerLabel === 'pass:bloom', "it is the registry's bloom, timed as the bloom");
  ok(pass.enabled(ctx) && settings.bloomMix === 0.04, 'with the row at its 0.04 it draws');
  settings.bloomMix = 0;
  ok(!pass.enabled(ctx) && pass.reason(ctx) === 'bloom strength is zero', 'at nought it draws nothing and says why');
  settings.bloomMix = 0.08;
  pass.prepare(ctx);
  ok((pass as Any).k.strength === 0.08, "the strength is the row's, taken in its prepare");
  ok(pass.render(ctx, input, null) === false, 'it changes the picture where it stands (the runner swaps nothing)');
  const want = [
    'fx.gpu.bloomMix.downKaris>fx.gpu.bloomMix.level0',
    ...[1, 2, 3, 4, 5].map((i) => `fx.gpu.bloomMix.down>fx.gpu.bloomMix.level${i}`),
    ...[4, 3, 2, 1, 0].map((i) => `fx.gpu.bloomMix.up>fx.gpu.bloomMix.level${i}`),
    'fx.gpu.bloomMix.mix>input',
  ];
  ok(calls.join() === want.join(), `the six downs largest first (the first Karis), the five ups back up, the mix over the picture (${calls.length} draws)`);
  ok(pass.levels[0].width === 960 && pass.levels[0].height === 540 && pass.levels[5].width === 30 && pass.levels[5].height === 16, 'the levels sized half the picture down to a sixty-fourth');
  const p: Any = pass;
  ok(p.input.value === input.texture, "the first down reads the chain's input as it stands this frame");
  ok(near(p.downTexel[0].x, 1 / 1920, 1e-15) && near(p.downTexel[1].x, 1 / 960, 1e-15) && near(p.upTexel[0].x, 1 / 480, 1e-15) && near(p.mixTexel.x, 1 / 960, 1e-15), "each down steps in its source's texels, each up in its smaller level's, the mix in the first level's (the demo's `pp.xy`)");
  ok(near(p.k.inv, 1 / 96, 1e-15), 'the mix divides the tent by 16 times the six levels (the demo\'s `16.0 * pp.z`)');
  calls.length = 0;
  input.setSize(1280, 720);
  pass.render(ctx, input, null);
  ok(pass.levels[0].width === 640 && near(p.downTexel[0].x, 1 / 1280, 1e-15) && calls.length === 12, 'a picture of another size sizes the levels again at its next draw');
  // 4. the warm-up.
  const items = pass.materials();
  const names = new Set(items.map((it) => it.material.name));
  ok(items.length === 12 && names.size === 4, `every graph is warmed (12 items) and they are four graphs' code: ${[...names].join(', ')}`);
  ok(items.slice(0, 11).every((it, i) => it.where === 'target' && it.into === pass.levels[i < 6 ? i : i - 6]) && items[11].where === 'target' && items[11].into === undefined, 'each down and up against the very level it draws into, the mix against a chain buffer (the picture it blends over)');
  ok(pass.levels.every((t) => t.depthBuffer === false && t.stencilBuffer === false && t.texture.type === THREE.HalfFloatType && t.samples === 0), "the levels are half floats with no depth and no stencil, the chain buffers' kind the warm-up compiles against");
  // 3. the graphs' materials.
  const up: Any = items[6].material;
  const mix: Any = items[11].material;
  ok(up.blending === THREE.CustomBlending && up.blendSrc === THREE.OneFactor && up.blendDst === THREE.OneFactor && up.blendSrcAlpha === THREE.ZeroFactor && up.blendDstAlpha === THREE.OneFactor && up.premultipliedAlpha === false, 'an up adds its tent into the level, one and one, the alpha kept (the demo\'s up pipeline)');
  ok(mix.blending === THREE.CustomBlending && mix.blendSrc === THREE.SrcAlphaFactor && mix.blendDst === THREE.OneMinusSrcAlphaFactor && mix.blendSrcAlpha === THREE.ZeroFactor && mix.blendDstAlpha === THREE.OneFactor && mix.premultipliedAlpha === false, 'the mix lays the bloom over the picture by the strength and one less it (`mix(hdr, bloom, strength)`), the alpha kept');
  for (const it of items) {
    const m: Any = it.material;
    if (!(m.isNodeMaterial === true && m.depthTest === false && m.depthWrite === false && m.toneMapped === false && m.fog === false && m.userData.swgChain === true)) ok(false, `${m.name}: a chain material`);
  }
  ok(true, 'every graph is a chain material: no depth, no fog, no tone mapping, never stored pre-exposed');
  // A `Fn`'s body runs only when three builds the graph (the night sky's lesson), so its reads are held as the file's text.
  const src = read('src/core/gpu/gpuBloomMix.ts');
  const body = src.slice(src.indexOf('export function downGraph('), src.indexOf('function tentOf('));
  ok(/if \(karis\) \{\s*const ex = max\(eyeExposureNode\(\)\.div\(storedOf\(\)\), 1e-4\);/.test(body) && /const kw = \(x: Any, share: number\): Any => float\(share\)\.div\(float\(1\)\.add\(dot\(x, LUM\)\.mul\(ex\)\)\);/.test(body), "the first level's Karis weights are the demo's `share / (1 + luma · exposure)`, the exposure the eye's over the store's");
  ok((body.match(/eyeExposureNode\(\)/g) ?? []).length === 1 && !/eyeExposureNode|storedOf/.test(src.slice(src.indexOf('function tentOf('), src.indexOf('/** A graph drawn into a target. */'))), 'the other downs, the ups and the mix read neither: plain weighted means');
  ok(EYE_ATTR.isStorageBufferAttribute === true && PRE_ATTR.isStorageBufferAttribute === true, "the two buffers they read are the eye's and the store's own");
  const karis = downGraph({ value: null }, new THREE.Vector2(1, 1), true, 'k');
  ok(karis.textures === 1 && Object.keys(karis.parts.textures).length === 1, 'a down binds one picture however many taps');
  pass.dispose();
}

// ---------------------------------------------------------------- 5. the spine and the ceilings
{
  const passes = read('src/core/gpu/gpuChainPasses.ts');
  ok(/fx\.registerPass\(skyOurs\(\) \? new GpuMixBloomPass\(width, height, settings\.bloomMix\) : new GpuBloomPass\(width, height, settings\.bloomStrength\)\);/.test(passes), "the spine draws the demo's bloom under our sky (its own row) and three's under SWG's sky (its row), each read at load");
  ok(/clamp\(out, vec3\(0\), vec3\(CHAIN_NUMBERS\.sanitize\.stored\)\)/.test(read('src/sky/air/airHaze.ts')), "the haze pass, after the sanitize, holds to the sanitize's own stored ceiling, never to a lower one of its own");
  ok(CHAIN_NUMBERS.sanitize.ceiling === 256 && CHAIN_NUMBERS.sanitize.stored === 8192, "SWG's sky keeps the WebGL text's 256; ours 8192 stored");
}

// ---------------------------------------------------------------- 6. the dither, once
// Both lines dithered the output: this round's own (`outputDither.ts`, its dial `ditherDial.ts` in the `exposure` set) and
// wave 4b's (`src/sky/night/dither.ts`, `ditherTune.ts`, the `stars` set's dial, held whole by `skyHeldGame.test.ts`). The
// merge of 22 November kept wave 4b's alone, so the picture is dithered once: held here as the graph is built and as the
// files hold it.
{
  // The noise in the dither kept is the demo's `ign` (Jimenez's interleaved gradient, three's own sum).
  const fract = (v: number): number => v - Math.floor(v);
  let same = true;
  for (let x = 0; x < 64; x += 3.5) for (let y = 0; y < 64; y += 2.5) if (Math.abs(ign(x, y) - fract(52.9829189 * fract(0.06711056 * x + 0.00583715 * y))) > 1e-12) same = false;
  ok(same, "the noise is the demo's `ign`: fract(52.9829189 · fract(dot(p, (0.06711056, 0.00583715))))");
  // The output pass's own graph, built as `gpuChainPasses.ts` builds it, its output step run as three runs it.
  const passes = read('src/core/gpu/gpuChainPasses.ts');
  const chain = read('src/core/gpu/gpuChain.ts');
  ok(!/withOutputDither|outputDither|ditherOut\(/.test(passes) && !existsSync(join(ROOT, 'src/core/gpu/outputDither.ts')) && !existsSync(join(ROOT, 'src/sky/exposure/ditherDial.ts')), "the output pass adds no dither of its own: this round's piece is gone");
  ok((chain.match(/ditheredOut\(/g) ?? []).length === 1, "the chain's output graph dithers in one place (wave 4b's `ditheredOut`)");
  const { outputGraph } = await import('../../../src/core/gpu/gpuChain.ts');
  const g: Any = outputGraph({ tDiffuse: { value: null } });
  const out = g.material.setupOutput(null, (TSL as Any).vec4(0.5, 0.5, 0.5, 1));
  // Every holder (a node or a node's list) that holds the canvas gate itself: one a dither, since each gates once.
  const holders = (root: Any, target: Any): number => {
    const seen = new Set<unknown>();
    let n = 0;
    const walk = (x: Any, depth: number): void => {
      if (!x || typeof x !== 'object' || x === target || seen.has(x) || depth > 80) return;
      seen.add(x);
      if (!Array.isArray(x) && !x.isNode && depth > 0) return;
      let direct = false;
      for (const k of Array.isArray(x) ? x.keys() : Object.keys(x)) {
        if (k === 'parents') continue;
        const v = x[k as Any];
        if (v === target) direct = true;
        else walk(v, depth + 1);
      }
      if (direct) n++;
    };
    walk(root, 0);
    return n;
  };
  ok(reaches(out, toCanvasNode()) && holders(out, toCanvasNode()) === 1, `the output material's own output takes the dither after three's arithmetic, gated on the draw going onto the canvas, once (${holders(out, toCanvasNode())} gate)`);
  const eyeKeys = eyeDialSet().groups.flatMap((gr) => gr.dials.map((d) => d.key));
  const starKeys = nightDialSet().groups.flatMap((gr) => gr.dials.map((d) => d.key));
  ok(!eyeKeys.some((k) => /dither/i.test(k)) && starKeys.includes('dither') && DITHER_TUNE.amount === 1, "its one slider is the `stars` set's (the debug menu's Sky and light), 1 level to start; none in the `exposure` set");
  ok(!/tuneOutputDither|'dither' in o\) said/.test(read('src/main.ts')), "the console's `exposure({ dither })` is gone with it (`stars({ dither })` is the dial)");
}

// ---------------------------------------------------------------- 7. the row
{
  const k = FX_KNOBS.find((x) => x.key === 'bloomMix') as Any;
  ok(k && k.pass === 'bloom' && k.min === 0 && k.max === 0.12 && k.label === 'Bloom strength' && FX_DEFAULTS.bloomMix === 0.04, "WebGPU's Bloom strength under our sky is a share from 0 to 0.12, 0.04 to start (the demo's slider and default)");
  ok(k.format(0) === 'Off' && k.format(0.04) === '4.0%' && /no threshold/.test(k.hint), 'its words say what it is now: a share, no threshold');
  const old = FX_KNOBS.find((x) => x.key === 'bloomStrength') as Any;
  ok(old && old.min === 0.05 && old.max === 1.5 && FX_DEFAULTS.bloomStrength === 0.35, "WebGL's (and SWG's sky's) row stays as it was");
  const main = read('src/main.ts');
  ok(/if \(key === 'bloomStrength' && GPU\.webgpu && SKY_AT_LOAD\.ours\) return \{ hide: true \};/.test(main) && /if \(key === 'bloomMix' && !\(GPU\.webgpu && SKY_AT_LOAD\.ours\)\) return \{ hide: true \};/.test(main), 'the page shows one of the two: ours on WebGPU under our sky, the old one everywhere else');
}

console.log(`gpuBloomMix: ${checks} checks passed`);
