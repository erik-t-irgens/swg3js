// The clouds' march, shape, light and noise (the GPU port's pass 3, wave 1, maker V): the one shape function and the light's
// arithmetic run over numbers as the card's graph runs them over nodes, the march's dials and its switch, the noise frame's
// double-precision offsets (two cameras agree on a cloud's place, the drift's wrap never jumps a layer), the storm fades'
// rule, and a test for each of the September march's four bugs (`docs/lessons/volumetrics.md`). Node builds no WGSL, so what
// only the card runs is pinned as the files' text; the pictures are the browser's proof.
//
// Run: node tools/swg/tests/cloudMarch.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { CLOUD_LAYER_MAX, CLOUD_STACK_FLOATS, CLOUD_TYPES, CLOUD_TYPE_FLOATS, CLOUD_TYPE_TUNE, newCloudLayer, newStackFrame, packStack, packTypes } from '../../../src/sky/clouds/cloudLayers.ts';
import { CLOUD_LOOK, CLOUD_LOOK_RANGE, SHAPE_CALLS, SHAPE_NUM, blendProfile, newProfile, profileOf, shapeLookNumbers, shapeOf, tuneLook, type ShapeIn } from '../../../src/sky/clouds/cloudShape.ts';
import { LIGHT_NUM, LIGHT_STEPS, ambientShareOf, hgOf, lightLookNumbers, octavesOf, phaseOf, powderOf, stepLightOf } from '../../../src/sky/clouds/cloudLight.ts';
import { CLOUD_DRAW, CLOUD_FEED, CLOUD_TUNE, CLOUD_TUNE_RANGE, cloudsMarching, cloudsWhyNot, cloudsWouldDraw, rayEndM, setCloudsOn, stackDraws, stepAt, stormFadeOf, traceSizeOf, traceTexelOf, tuneMarch } from '../../../src/sky/clouds/cloudTune.ts';
import { pcg3Number, CLOUD_NOISE_SIZES, CLOUD_NOISE_SPEC } from '../../../src/sky/clouds/cloudNoise.ts';
import { CLOUD_U, GpuCloudPass, compositeGraph, streakInto, writeDials, writeOffsets } from '../../../src/sky/clouds/cloudMarch.ts';
import { AIR } from '../../../src/sky/air/airApi.ts';
import { markSeeTarget } from '../../../src/sky/air/airSee.ts';
import { markMotionTarget } from '../../../src/core/gpu/motion.ts';
import { FX_PASSES } from '../../../src/core/fxRegistry.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string): string => readFileSync(join(here, '../../../src', p), 'utf8').replace(/\r\n/g, '\n');

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;

// ------------------------------------------------------------------------------------------------ the shape

const types = new Float32Array(CLOUD_TYPE_FLOATS);
packTypes(types);
const look = shapeLookNumbers();
const prof = (t: string): ReturnType<typeof newProfile> => {
  const i = CLOUD_TYPES.indexOf(t as (typeof CLOUD_TYPES)[number]);
  return blendProfile(types, i, i, i, 1, 0, 0, newProfile());
};
const sIn = (o: Partial<ShapeIn<number>>): ShapeIn<number> => ({ h: 0.3, cover: 0.6, top: 1, edge: 0.5, layerDensity: 1, low0: 0.7, low1: 0.7, low2: 0.6, low3: 0.5, det0: 0.4, det1: 0.4, det2: 0.4, ...o });

{
  const cu = prof('cumulus');
  ok(profileOf(SHAPE_NUM, cu, 0) === 0 && profileOf(SHAPE_NUM, cu, 1) === 0, 'a cumulus has no density at its base and its top (the profile rises from the base and is gone at the top)');
  ok(profileOf(SHAPE_NUM, cu, cu.rise) > 0.99 && profileOf(SHAPE_NUM, cu, 0.25) > 0.99, "a cumulus's profile has risen whole by its rise share (its flat dark base)");
  const st = prof('stratus');
  ok(profileOf(SHAPE_NUM, st, 0.1) < profileOf(SHAPE_NUM, cu, 0.1), "a stratus's base is softer than a cumulus's (its profile rises slower)");
  ok(Math.abs(blendProfile(types, CLOUD_TYPES.indexOf('cumulus'), CLOUD_TYPES.indexOf('stratus'), 0, 0.5, 0.5, 0, newProfile()).rise - (cu.rise + st.rise) / 2) < 1e-6, "a mix's profile is its types' profiles weighed by the map's weights (half cumulus, half stratus: the mean rise)");
  ok(near(cu.density, CLOUD_TYPE_TUNE.cumulus.density, 1e-6) && near(cu.taper, CLOUD_TYPE_TUNE.cumulus.taper, 1e-6) && near(cu.erosion, CLOUD_TYPE_TUNE.cumulus.erosion, 1e-6), "the shape reads the contract's packed type slots (density p2.x, taper p2.z, erosion p1.z)");
}
{
  const cu = prof('cumulus');
  const zero = shapeOf(SHAPE_NUM, sIn({ cover: 0 }), cu, look);
  ok(zero === 0, 'no cover, no cloud, whatever the noise');
  let drawn = 0;
  let monotone = true;
  for (let a = 0; a <= 1; a += 0.1) {
    for (let b = 0; b <= 1; b += 0.1) {
      let prev = -1;
      for (let c = 0.05; c <= 1; c += 0.05) {
        const d = shapeOf(SHAPE_NUM, sIn({ cover: c, low0: a, low1: b, low2: b, low3: b }), cu, look);
        if (d < prev - 1e-9) monotone = false;
        prev = d;
        if (d > 0) drawn++;
      }
    }
  }
  ok(monotone, 'more cover never makes less cloud (over a grid of the shape noise)');
  ok(drawn > 50, `cover draws cloud over the shape noise (${drawn} of 2,420 points of the grid have density)`);
  const before = SHAPE_CALLS.numbers;
  shapeOf(SHAPE_NUM, sIn({}), cu, look);
  ok(SHAPE_CALLS.numbers === before + 1, 'the twin runs the one shape function (counted)');
}
{
  // A type is a vertical profile and an erosion, never a height: the function reads only the share of its layer.
  const cu = prof('cumulus');
  const a = shapeOf(SHAPE_NUM, sIn({ h: 0.4 }), cu, look);
  const b = shapeOf(SHAPE_NUM, sIn({ h: 0.4 }), cu, look);
  ok(a === b && a > 0, 'a cumulus at a height share draws the same wherever its layer stands (the shape reads no height but the share)');
  const march = src('sky/clouds/cloudMarch.ts');
  ok(march.includes('const h = y.sub(s0.x).div(max(s0.y.sub(s0.x), 1))'), "the march takes the share from the layer's own base and top (s0.xy), so a cumulus at 8 km draws as a cumulus");
}
{
  // The anvil: near the top a cumulonimbus's cover reaches out past its tower where a towering cumulus narrows.
  const cb = prof('cumulonimbus');
  const tw = prof('towering');
  const at = (p: ReturnType<typeof newProfile>): number => shapeOf(SHAPE_NUM, sIn({ h: 0.8, cover: 0.35, low0: 0.95, low1: 0.95, low2: 0.95, low3: 0.95, det0: 0.5, det1: 0.5, det2: 0.5 }), p, look);
  ok(at(cb) > at(tw), `near its top a cumulonimbus at a low cover spreads (density ${at(cb).toFixed(4)} against a towering cumulus's ${at(tw).toFixed(4)}): its anvil`);
}
{
  // The edge: a softer edge ramps the cover cut over a wider band of the shape noise.
  const cu = prof('cumulus');
  // The detail at one above the wispy band leaves no erosion, so the edge's own rule is what is measured.
  const at = (edge: number, b: number): number => shapeOf(SHAPE_NUM, sIn({ edge, cover: 0.5, low0: b, low1: b, low2: b, low3: b, det0: 1, det1: 1, det2: 1, h: 0.3 }), cu, look);
  let onset = -1;
  for (let b = 0; b <= 1.0001 && onset < 0; b += 0.001) if (at(0, b) > 0) onset = b;
  const b1 = onset + 0.08;
  ok(onset > 0 && at(0, b1) > at(1, b1) && at(1, b1) > 0 && at(0, onset - 0.01) === 0 && at(1, onset - 0.01) === 0, `a soft edge (1) ramps the cover cut over a wider band than a hard one (0): just past the cut ${at(1, b1).toFixed(4)} against ${at(0, b1).toFixed(4)}, nothing before it either way`);
}
{
  // The fixer's: in a mix each type's column stands its thickness over the tallest type's (`reach`), so a deck of fair cumulus
  // with storm towers keeps its heaps their own height; a layer of one type fills its whole thickness.
  const iCu = CLOUD_TYPES.indexOf('cumulus');
  const iCb = CLOUD_TYPES.indexOf('cumulonimbus');
  ok(prof('cumulus').reach === 1 && prof('cirrus').reach === 1, 'a layer of one type: its column is the whole layer');
  const heap = blendProfile(types, iCu, iCb, iCb, 1, 0, 0, newProfile());
  const tower = blendProfile(types, iCu, iCb, iCb, 0, 1, 0, newProfile());
  ok(near(heap.reach, CLOUD_TYPE_TUNE.cumulus.thickness / CLOUD_TYPE_TUNE.cumulonimbus.thickness, 1e-6) && tower.reach === 1, `in a cumulus and cumulonimbus deck the heaps stand ${heap.reach.toFixed(3)} of it and the towers the whole`);
  const at = (p: ReturnType<typeof newProfile>, h: number): number => shapeOf(SHAPE_NUM, sIn({ h, cover: 0.9, low0: 0.95, low1: 0.95, low2: 0.95, low3: 0.95, det0: 0.5, det1: 0.5, det2: 0.5 }), p, look);
  ok(at(heap, 0.05) > 0 && at(heap, 0.3) === 0 && at(tower, 0.3) > 0, "at three tenths of the deck a heap is gone and a tower stands (the heap's column a sixth of it)");
  const march = src('sky/clouds/cloudMarch.ts');
  ok(march.includes('const reach = q2.w.div(max(max(vec4(face.typeSlot(ta, 2)).w, vec4(face.typeSlot(tb, 2)).w), max(vec4(face.typeSlot(tc, 2)).w, 1)))') && march.includes('density: q2.x, reach },'), "the march's column is the twin's (the blended thickness over the tallest of the layer's three slots')");
  // The shape's windows are the look's dials (the anvil's from the published method), never numbers of the function.
  const shape = src('sky/clouds/cloudShape.ts');
  const body = shape.slice(shape.indexOf('export function shapeOf'), shape.indexOf('/** A profile record of numbers'));
  ok(!/0\.6\), o\.k\(0\.95|o\.k\(0\.35\)|o\.k\(0\.4\), s\.edge/.test(body) && body.includes('look.anvilFrom') && body.includes('look.anvilPower') && body.includes('look.taperFrom') && body.includes('look.bite') && body.includes('look.softBite'), "the taper's start, the anvil's window and power and the erosion's bites are the look's dials");
  ok(CLOUD_LOOK.anvilFrom === 0.7 && CLOUD_LOOK.anvilTo === 0.8 && CLOUD_LOOK.anvilPower === 0.5 && /GPU Pro 7/.test(shape), "the anvil starts at the published method's window and power, credited");
  const cb = prof('cumulonimbus');
  const top = (): number => shapeOf(SHAPE_NUM, sIn({ h: 0.9, cover: 0.3, low0: 0.95, low1: 0.95, low2: 0.95, low3: 0.95, det0: 0.5, det1: 0.5, det2: 0.5 }), cb, shapeLookNumbers());
  const before = top();
  tuneLook({ anvilPower: 0.1 });
  const spread = top();
  tuneLook({ anvilPower: 0.5 });
  ok(spread > before && top() === before, `the anvil's power is live: lower, the top spreads further (${spread.toFixed(4)} against ${before.toFixed(4)}), and back`);
  ok(src('sky/clouds/cloudMarch.ts').includes('l6.x = L.anvilFrom;') && src('sky/clouds/cloudDials.ts').includes('anvilPower:'), 'the march writes the new dials and the menu shows them');
}
{
  const said = tuneLook({ sigma: 99, nope: 1, erosion: 'x' as unknown as number });
  ok(CLOUD_LOOK.sigma === CLOUD_LOOK_RANGE.sigma[1] && said.length === 3, `the look's dials are held to their ranges and the rest refused in words (${said.join('; ')})`);
  CLOUD_LOOK.sigma = 0.06;
  CLOUD_LOOK.erosion = 1;
}

// ------------------------------------------------------------------------------------------------ the light

{
  const L = lightLookNumbers();
  for (const g of [-0.25, 0, 0.65]) {
    let sum = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const c = -1 + (2 * (i + 0.5)) / n;
      sum += hgOf(LIGHT_NUM, g, c) * 2 * Math.PI * (2 / n);
    }
    ok(near(sum, 1, 2e-3), `Henyey-Greenstein's phase at g ${g} sums to one over the sphere (${sum.toFixed(4)})`);
  }
  ok(phaseOf(LIGHT_NUM, L, 1, 1) > 5 * phaseOf(LIGHT_NUM, L, 1, -1), 'the two lobes look toward the light far brighter than away (the silver lining)');
  ok(phaseOf(LIGHT_NUM, L, 1, -1) > hgOf(LIGHT_NUM, L.forward, -1), 'the back lobe lights a face seen with the light behind (more than the forward lobe alone)');
  let prev = Infinity;
  let falls = true;
  for (let tau = 0; tau < 30; tau += 0.5) {
    const v = octavesOf(LIGHT_NUM, L, tau, 0.3);
    if (v > prev + 1e-12) falls = false;
    prev = v;
  }
  ok(falls, 'the octaves only darken as the light march thickens');
  const deep = octavesOf(LIGHT_NUM, L, 20, 0.3) / (Math.exp(-20) * phaseOf(LIGHT_NUM, L, 1, 0.3));
  ok(deep > 1e3, `deep in a cloud the octaves keep far more light than one scattering would (${deep.toExponential(1)} times)`);
  ok(powderOf(LIGHT_NUM, L, 0.0001, 1) === 1, 'no powder toward the light (the silver lining is the edge lit)');
  ok(near(powderOf(LIGHT_NUM, L, 1e-6, -1), 1 - L.powder, 1e-4), "a thin edge seen with the light behind keeps one less the powder's share");
  ok(near(stepLightOf(LIGHT_NUM, 2, 0.05, 1e4), 2, 1e-9) && stepLightOf(LIGHT_NUM, 2, 0, 10) === 0, "a step's light is its source times what the step takes (an opaque step its whole source, a clear one none)");
  ok(ambientShareOf(LIGHT_NUM, 100, 1, 1, 0.45) === 4 && ambientShareOf(LIGHT_NUM, 0.001, 1, 1, 0.45) === 0.25, "the ambient's height factor is held to a quarter and four times the camera's");
  ok(near(ambientShareOf(LIGHT_NUM, 1, 1, 0, 0.45), 0.45, 1e-9) && near(ambientShareOf(LIGHT_NUM, 1, 1, 1, 0.45), 1, 1e-9), "a layer's belly takes the belly's share of the ambient, its top the whole");
  ok(LIGHT_STEPS.ends.length === 7 && LIGHT_STEPS.ends[6] === 1 && LIGHT_STEPS.ends.every((e, i) => i === 0 || e > LIGHT_STEPS.ends[i - 1]), 'the light march is six steps in a cone and one far, their ends rising to the reach');
}

// ------------------------------------------------------------------------------------------------ the march's dials and its switch

{
  const s = [0, 0];
  traceSizeOf(1600, 900, s);
  ok(s[0] === 800 && s[1] === 450, 'the trace of a 1600 by 900 display is 800 by 450 (half each way)');
  traceSizeOf(3840, 2160, s);
  ok(s[0] * s[1] <= CLOUD_TUNE.rayBudget && near(s[0] / s[1], 16 / 9, 0.01), `a 4K display's trace is held to the ray budget, its shape kept (${s[0]} by ${s[1]})`);
  ok(stepAt(10) === CLOUD_TUNE.nearStep && stepAt(999) === CLOUD_TUNE.nearStep, 'the first kilometre from the lens is stepped finely');
  ok(stepAt(100_000) === CLOUD_TUNE.farStep && stepAt(10_000) === 10_000 * CLOUD_TUNE.grow, "past it a step is its distance's share, never past the longest");
  const said = tuneMarch({ steps: 999, reach: 'x' as unknown as number, bogus: 1 });
  ok(CLOUD_TUNE.steps === CLOUD_TUNE_RANGE.steps[1] && said.length === 3, `the march's dials are held to their ranges and the rest refused in words (${said.join('; ')})`);
  CLOUD_TUNE.steps = 128;
}
{
  ok(stormFadeOf(0.8, 0.1, 0, false) === 0.8, 'with the march not drawing the storm fade is the overcast, as it was');
  ok(stormFadeOf(0.8, 0.1, 0, true) === 0.1 && stormFadeOf(0.8, 0.1, 0.6, true) === 0.6, "where the march draws, only a dust storm's and a fog's fades stay (the clouds cover the sky)");
  const world = src('world/world.ts');
  ok(/this\.skyAir\.overcast = wst\.enabled \? stormFadeOf\(wfx\.overcast, wfx\.dust, wst\.kind === 'fog' \? wfx\.overcast : 0, cloudsMarching\(\)\) : 0;/.test(world), "the world's air takes its storm fade through that rule, on WebGPU under our sky alone (inside `GPU.webgpu && this.skyAir`)");
  const main = src('main.ts');
  ok(main.includes('if (sky) sky.sheets = GPU.webgpu ? !cloudsMarching() : true;'), "SWG's sheets stand down on WebGPU while the march draws; WebGL keeps them as it did");
}
{
  setCloudsOn(false);
  CLOUD_DRAW.ready = false;
  ok(!cloudsWouldDraw(false, false, true) && /off/.test(cloudsWhyNot(false, false, true) ?? ''), 'the switch starts off, and says so');
  setCloudsOn(true);
  ok(!cloudsWouldDraw(false, false, true) && /waiting/.test(cloudsWhyNot(false, false, true) ?? ''), 'on but not yet built, nothing draws and it says what it waits on');
  CLOUD_DRAW.ready = true;
  CLOUD_FEED.stack = null;
  ok(!cloudsWouldDraw(false, false, true) && /no layer/.test(cloudsWhyNot(false, false, true) ?? ''), 'ready with no stack, nothing draws');
  const stack = new Float32Array(CLOUD_STACK_FLOATS);
  const f = newStackFrame();
  f.level = 1;
  f.hour = 0;
  f.groundY = 10;
  const layers = [newCloudLayer('cumulus'), newCloudLayer('cirrus')];
  const n = packStack(layers, f, stack);
  CLOUD_FEED.stack = stack;
  CLOUD_FEED.count = n;
  ok(stackDraws(stack, n) && cloudsWouldDraw(false, false, true) && cloudsMarching(), 'with a layer on and some cover it draws');
  ok(!cloudsWouldDraw(true, false, true) && !cloudsWouldDraw(false, true, true) && !cloudsWouldDraw(false, false, false), "never in space, under water, or where the air is not drawing (SWG's Sky row)");
  layers[0].on = false;
  layers[1].cover = [0, 0, 0, 0, 0];
  packStack(layers, f, stack);
  ok(!stackDraws(stack, n) && !cloudsWouldDraw(false, false, true), 'every layer off or clear: nothing draws (no copy of the picture at full cost)');
  setCloudsOn(false);
  CLOUD_DRAW.ready = false;
  CLOUD_FEED.stack = null;
}

// ------------------------------------------------------------------------------------------------ the noise frame

{
  // Two cameras far apart see one world point at one noise coordinate (the offsets worked in doubles on the main thread).
  const stack = new Float32Array(CLOUD_STACK_FLOATS);
  const f = newStackFrame();
  const L = [newCloudLayer('cirrus', 'veil')];
  const n = packStack(L, f, stack);
  const streaks = new Float64Array(CLOUD_LAYER_MAX * 2);
  streakInto(L[0].types, L[0].shares, L[0].seed, L[0].turn, streaks, 0);
  ok(near(streaks[0], CLOUD_TYPE_TUNE.cirrus.stretch, 1e-9), "a cirrus layer streaks by the cirrus's stretch");
  const drift = new Float64Array(CLOUD_LAYER_MAX * 4);
  const coord = (camX: number, camZ: number, px: number, pz: number): [number, number] => {
    writeOffsets(CLOUD_U, stack, n, drift, streaks, { x: camX, z: camZ });
    const o = CLOUD_U.off[0];
    const o2 = CLOUD_U.off2[0];
    const s = CLOUD_U.streak[0].x;
    const rx = px - camX;
    const rz = pz - camZ;
    const along = (rx * o2.z + rz * o2.w) / s;
    const across = rz * o2.z - rx * o2.w;
    const tile = CLOUD_U.streak[0].y;
    const u = along / tile + o.x;
    const v = across / tile + o.y;
    return [u - Math.floor(u), v - Math.floor(v)];
  };
  drift[0] = 123_456.75;
  drift[1] = -98_765.5;
  const a = coord(1_234_567.25, -2_345_678.5, 1_240_000, -2_350_000);
  const b = coord(1_250_000.5, -2_340_000.25, 1_240_000, -2_350_000);
  const wrapGap = (x: number, y: number): number => Math.min(Math.abs(x - y), 1 - Math.abs(x - y));
  ok(wrapGap(a[0], b[0]) < 1e-6 && wrapGap(a[1], b[1]) < 1e-6, `two cameras 16 km apart, a thousand km from the world's middle, put one point of a streaked layer at one noise place (${wrapGap(a[0], b[0]).toExponential(1)}, ${wrapGap(a[1], b[1]).toExponential(1)} of a tile)`);
  // The full drift crossing the contract's 65,536 m wrap moves the noise by the drift alone, with no jump.
  drift[0] = 65_535.9;
  const c0 = coord(0, 0, 500, 500);
  drift[0] = 65_536.1;
  const c1 = coord(0, 0, 500, 500);
  const moved = Math.hypot(wrapGap(c0[0], c1[0]), wrapGap(c0[1], c1[1])) * CLOUD_U.streak[0].y;
  ok(Math.log2(CLOUD_U.streak[0].y) % 1 === 0 && 65536 % CLOUD_U.streak[0].y === 0, `the layer's shape tile follows its cell size as a power of two dividing the drift's wrap (${CLOUD_U.streak[0].y} m for cells of ${L[0].cellSize} m)`);
  ok(moved < 0.5, `a streaked layer's noise moves ${moved.toFixed(3)} m when its full drift crosses 65,536 m (0.2 m of drift: no jump)`);
  ok([...CLOUD_U.off[0].toArray()].every((v) => v >= 0 && v < 1), "every offset is a share of its tile in [0, 1): nothing measured from the world's middle reaches the card");
  writeDials(CLOUD_U);
  ok(CLOUD_U.t1.y === CLOUD_TUNE.reach && CLOUD_U.l1.y === CLOUD_LOOK.shapeTile && CLOUD_U.l4.w === CLOUD_LOOK.cone, "the dials reach the card's vectors each frame");
}
{
  const o = [0, 0, 0];
  const p = [0, 0, 0];
  pcg3Number(1, 2, 3, o);
  pcg3Number(1, 2, 3, p);
  ok(o.every((v, i) => v === p[i] && v >= 0 && v < 1), 'the noise hash (PCG3D) is the same every time, in [0, 1)');
  const noise = src('sky/clouds/cloudNoise.ts');
  ok((noise.match(/1664525/g) ?? []).length >= 6 && (noise.match(/1013904223/g) ?? []).length >= 6, "the card's hash and its twin share the paper's constants");
  ok(CLOUD_NOISE_SIZES.shape === 128 && CLOUD_NOISE_SIZES.detail === 32 && CLOUD_NOISE_SIZES.curl === 128 && CLOUD_NOISE_SIZES.shape % CLOUD_NOISE_SPEC.slabs === 0, 'the noise: a 128 cubed shape volume baked in whole slabs, a 32 cubed detail volume and a 128 square curl picture');
  ok(CLOUD_NOISE_SPEC.shape.worley.every((f) => Number.isInteger(f)) && Number.isInteger(CLOUD_NOISE_SPEC.shape.perlinFreq), 'every octave is a whole number of cells a tile, so each picture tiles');
  ok(Math.log2(CLOUD_LOOK.shapeTile) % 1 === 0 && Math.log2(CLOUD_LOOK.detailTile) % 1 === 0 && 65536 % CLOUD_LOOK.shapeTile === 0, "the noise tiles are powers of two of metres dividing the contract's drift wrap");
  ok(/storageTexture3D\(out, ivec3/.test(noise) && /\.compute\(\(N \* N \* per\), \[64\]\)/.test(noise), 'the shape volume is written on compute, a slab at a time');
}

// ------------------------------------------------------------------------------------------------ the September march's four bugs

// A stand-in scene target with its see-through layer, and the air's tables as the graphs' makers read them at their build.
const depth = new THREE.DepthTexture(64, 36, THREE.FloatType);
const target = new THREE.RenderTarget(64, 36, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: true, samples: 0, depthTexture: depth, count: 3 });
target.texture.name = 'fx.scene';
markMotionTarget(target);
markSeeTarget(target);
const keepTables = AIR.tables;
AIR.tables = { nodes: {}, ready: true } as Any;
{
  // 1. A full-screen pass writes its target outright: the composite is opaque, never blended, and writes its alpha as one.
  // Pass 3, wave 2 (maker T): the composite reads the trace by `{ value }` (the resolved history, or flight mode's whole trace).
  const trace = new THREE.RenderTarget(8, 8, { type: THREE.HalfFloatType, count: 2 });
  const g = compositeGraph(CLOUD_U, { input: { value: null }, trace: { light: { value: trace.textures[0] }, dist: { value: trace.textures[1] } }, depth, see: target.textures[2], reversed: true });
  ok(g.material.blending === THREE.NoBlending && g.material.transparent === false, "1. the composite is opaque and never blended (an alpha read as coverage drew nothing where the scene's alpha was nought)");
  const march = src('sky/clouds/cloudMarch.ts');
  ok(/return vec4\(clamp\(select\(bad, c\.rgb, outC\), vec3\(0\), vec3\(CHAIN_NUMBERS\.sanitize\.stored\)\), 1\);/.test(march), '1. and its every pixel is written with an alpha of one');
  // 2. A sky pixel is the sky, never a surface at the far plane.
  ok(rayEndM(0, 0.05, 9000, true, 1, 50_000) === 50_000 && rayEndM(1, 0.05, 9000, false, 1, 50_000) === 50_000, '2. a depth texel that holds the clear runs the ray to the reach (50 km), never the far plane (9 km)');
  ok(near(rayEndM(0.05 / 30, 0.05, 9000, true, 1, 50_000), 30, 0.5) && rayEndM(0.5, 0.05, 9000, false, 1.2, 50_000) < 0.2, '2. a solid stops the ray at its own distance');
  ok(march.includes('select(skyDepth(dz, s.reversed), float(1e9), rayLengthOf(') && march.includes('select(skyDepth(dz, s.reversed), T1.y, rayLengthOf('), '2. the march and the composite both read the clear as the sky (the reach), by the same test');
  // 3. The trace is read at its own size, whatever share of the display it is marched at.
  for (const share of [0.25, 0.5, 1]) {
    const w = Math.ceil(1600 * share);
    ok(near(traceTexelOf(0.5, w), w / 2 - 0.5, 1e-9) && near(traceTexelOf(0, w), -0.5, 1e-9), `3. at a trace share of ${share} the screen's middle reads the trace's middle (its own ${w} texels)`);
  }
  // Pass 3, wave 2 (maker T): the taps moved into `cloudResolve.ts`' `traceTapsOf` (the composite's and the motion's one read),
  // handed the size of the very picture read this frame (`CLOUD_RU.ct`: the resolved history's, or flight mode's whole trace's).
  const resolve = src('sky/clouds/cloudResolve.ts');
  ok(resolve.includes('const tc = st.mul(size).sub(0.5);') && march.includes("traceTapsOf(tl, td, CT.xy, st, dist, T2.y, 'C')") && march.includes('R.ct.x = next.width;') && march.includes('R.ct.x = this.whole.width;') && /CLOUD_U\.tr\.x = tw;\s*\n\s*CLOUD_U\.tr\.y = th;/.test(march), "3. the composite's taps are the trace's own size, written from the trace as it is sized and read");
  // 4. Nothing to draw draws nothing and says why.
  const r: Any = { reversedDepthBuffer: true, getRenderTarget: () => null, setRenderTarget() {}, render() {}, compileAsync: () => Promise.resolve(), compileComputeAsync: () => Promise.resolve(), compute() {} };
  const pass = new GpuCloudPass(r, target);
  const ctx: Any = { space: false, cameraUnderwater: true, cameraSubmerged: false };
  setCloudsOn(false);
  ok(!pass.enabled(ctx) && pass.materials().length === 0, '4. with the switch off the pass is never on and asks for no pipeline (the base frame exactly)');
  ok(/off/.test(pass.reason(ctx) ?? ''), `4. and says why ("${pass.reason(ctx)}")`);
  setCloudsOn(true);
  ok(!pass.enabled(ctx) && /waiting/.test(pass.reason(ctx) ?? ''), `4. on, before its parts land, it draws nothing ("${pass.reason(ctx)}")`);
  ok(pass.render(ctx, { width: 64, height: 36, texture: new THREE.Texture() } as Any, {} as Any) === false, '4. and a render with no graph built answers that it drew nothing (the chain passes its picture on)');
  ok(src('sky/clouds/cloudMarch.ts').split('ctx.cameraSubmerged').length === 3 && !src('sky/clouds/cloudMarch.ts').includes('ctx.cameraUnderwater'), 'under water is the camera really submerged (the safe answer with its margin is true in plain air near water, and stood the march down over a street)');
  setCloudsOn(false);
  pass.dispose();
  trace.dispose();
}
AIR.tables = keepTables;

// ------------------------------------------------------------------------------------------------ the chain, the flare and the registry

{
  const at = FX_PASSES.findIndex((p) => p.id === 'clouds');
  const haze = FX_PASSES.findIndex((p) => p.id === 'haze');
  const taa = FX_PASSES.findIndex((p) => p.id === 'taa');
  ok(at > haze && at < taa, "the clouds' pass stands after the haze and before the edge smoothing in the registry");
  const chain = src('core/gpu/gpuChainPasses.ts');
  ok(/\['haze', null\],\n[^\n]*\n\s*\['clouds', null\],\n[^\n]*\n\s*\['taa', null\],/.test(chain), "the WebGPU chain ports it between the haze and the smoothing, the spine's own (`gpuChainPasses.ts` loads no node: held as its text)");
  ok(/if \(skyOurs\(\)\) fx\.registerPass\(new GpuHazePass[^\n]*\n[^\n]*\n[^\n]*\n\s*if \(skyOurs\(\)\) fx\.registerPass\(new GpuCloudPass\(renderer, fx\.sceneTarget\)\);/.test(chain), "the spine registers it right after the haze, under our sky alone (SWG's Sky row has none)");
  const flare = src('sky/night/gpuFlare.ts');
  ok(flare.includes("clear.assign(select(marching.greaterThan(0.5), clamp(cloudT, 0, 1), sheets));"), "the flare reads the cloud's transmittance at the sun's pixel on a frame the march drew, the sheets otherwise");
  ok(flare.includes('onRenderUpdate(() => (CLOUD_DRAW.drew ? 1 : 0))'), "its switch is the march's own word for the frame, a small whole number (never boxed)");
  const march = src('sky/clouds/cloudMarch.ts');
  const body = march.slice(march.indexOf('function densityFn('), march.indexOf("// ---------------------------------------------------------------- the march's graph"));
  const samples = body.match(/\.sample\([^;]*?\)\.level\(0\)/g) ?? [];
  const reads = (body.match(/(?<!face)\.sample\(/g) ?? []).length;
  ok(body.length > 0 && reads === samples.length && samples.length === 3, `every picture the density reads inside the march's loops is read at a named level (${samples.length} of ${reads}, the map's face apart: WGSL refuses a plain read in a loop that differs per pixel)`);
  ok(src('sky/clouds/cloudMapGpu.ts').includes('.depth(l).level(0)'), "and so is the map's face, which it calls there (the map's maker's)");
  ok(march.includes('Loop({ start: int(0), end: int(CLOUD_STEPS_MOST)') && march.includes('cs.greaterThanEqual(steps)'), "the march's loop is built to its most and walks the dial's steps (a change of steps builds nothing)");
  ok(march.includes('shapeOf(\n            SHAPE_NODE,'), "the march's density is the one shape function handed nodes");
}

console.log(`\ncloudMarch: ${checks} checks passed`);
