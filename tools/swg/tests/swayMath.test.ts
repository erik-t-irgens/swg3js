// The flora sway's arithmetic (`src/world/swayMath.ts`), the mirror its chunk must equal:
//
//   1. nothing moves at or below the canopy base, and the bend is continuous there;
//   2. the flutter is nought inside the trunk's radius;
//   3. a vertex a trunk primitive and a card primitive of one hand-built model share moves identically in both;
//   4. a planting at scale s moves s times as far, and the world displacement lies along the wind at any yaw;
//   5. the clock is seamless at its wrap for every whole-cycle frequency, and steps over the wrap;
//   6. no NaN at a height of nought, a scale of nought, no wind or a trunk of no radius;
//   7. the selection rule's words, and the canopy base, axis and trunk radius measured on the packs
//      (SWG3JS_PACKS, else assets-private) against the study's own numbers for the same models, where the study's
//      outputs sit beside the design (SWG3JS_SWAY_STUDY), else skipped with a note.
//
// Run: node tools/swg/tests/swayMath.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { classByName } from '../../../src/world/cardAlpha.ts';
import { prepareCardModel, registerPackCards } from '../../../src/world/cardRule.ts';
import { prepareSwayModel } from '../../../src/world/floraSway.ts';
import {
  CANOPY_MAX,
  RIGID,
  SOFT_PLANT,
  SWAY_DEFAULTS,
  cyclesPerWrap,
  measureSway,
  omegaOf,
  stepClock,
  swayHash,
  swayOffset,
  swayPeriod,
  swaySelected,
  type SwayFrame,
  type SwayModelState,
  type SwayShape,
  type SwayTune,
} from '../../../src/world/swayMath.ts';
import { floraPacks, glbJsonOf, glbScenes, isCardJson } from './glbThree.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

const tune = (o: Partial<SwayTune> = {}): SwayTune => ({ ...SWAY_DEFAULTS, ...o });
const frame = (o: Partial<SwayFrame> = {}): SwayFrame => ({ windX: Math.sin(0.8), windZ: Math.cos(0.8), strength: 0.7, t: 123.4, flutterOmega: omegaOf(cyclesPerWrap(0.45, 3600), 3600), eye: [0, 1.7, 0], ...o });
const stateOf = (shape: SwayShape, t: SwayTune = tune()): SwayModelState => ({ shape, omega: omegaOf(cyclesPerWrap(swayPeriod(shape.H, t), t.wrap), t.wrap), gain: 1 });
const matrixOf = (at: number[], yaw: number, scale: number): number[] => new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(scale, scale, scale)).elements.slice();
const len = (v: number[]) => Math.hypot(v[0], v[1], v[2]);
const out: [number, number, number] = [0, 0, 0];
const off = (p: number[], m: number[], model: SwayModelState, f = frame(), t = tune()) => [...swayOffset(out, p, m, model, f, t)];

const tree: SwayShape = { H: 12, c: 0.35, axisX: 0.3, axisZ: -0.2, rT: 0.4 };
const here = matrixOf([5, 0, 8], 0.4, 1);

// ---------------------------------------------------------------- 1. the canopy base

{
  const t = tune({ flutter: 0 });
  const model = stateOf(tree, t);
  let below = 0;
  for (let i = 0; i <= 40; i++) below = Math.max(below, len(off([1.5, (i / 40) * tree.c * tree.H, -0.7], here, model, frame(), t)));
  ok(below === 0, 'nothing moves at or below the canopy base, the trunk below the crown included');
  const at = len(off([1.5, tree.c * tree.H + 1e-6, -0.7], here, model, frame(), t));
  const near = len(off([1.5, tree.c * tree.H + 0.01, -0.7], here, model, frame(), t));
  const top = len(off([1.5, tree.H, -0.7], here, model, frame(), t));
  ok(at < 1e-9 && near < 1e-4 && top > 0.05, `the bend is continuous at the base (${at.toExponential(1)} just above, ${(near * 1000).toFixed(3)} mm a centimetre up, ${(top * 100).toFixed(1)} cm at the top)`);
  const bent = len(off([1.5, 0.2 * tree.H, -0.7], here, model, frame(), tune({ flutter: 0, trunk: 'bend' })));
  ok(bent > 0, "under trunk 'bend' the whole tree bends from the ground");
}

// ---------------------------------------------------------------- 2. the flutter inside the trunk

{
  const t = tune({ amp: 0 });
  const model = stateOf(tree, t);
  let inside = 0;
  let outside = 0;
  for (let i = 0; i < 200; i++) {
    const a = i * 2.4;
    const y = 2 + (i % 10);
    const rIn = (i % 7) * (tree.rT / 7);
    inside = Math.max(inside, len(off([tree.axisX + Math.cos(a) * rIn, y, tree.axisZ + Math.sin(a) * rIn], here, model, frame(), t)));
    const rOut = 2 * tree.rT + 0.3 + (i % 5) * 0.2;
    outside = Math.max(outside, len(off([tree.axisX + Math.cos(a) * rOut, y, tree.axisZ + Math.sin(a) * rOut], here, model, frame(), t)));
  }
  ok(inside === 0 && outside > 0.005, `the flutter is nought inside the trunk's radius and moves the leaves outside it (${(outside * 1000).toFixed(1)} mm at most)`);
}

// ---------------------------------------------------------------- 3. a shared vertex

{
  // A hand-built model: a trunk (opaque) from the ground to 8 m, a crown of cards from 5 m, one vertex in both.
  const trunk: number[] = [];
  for (let i = 0; i <= 16; i++) for (let k = 0; k < 6; k++) trunk.push(Math.cos(k) * 0.3, i * 0.5, Math.sin(k) * 0.3);
  const shared = [1.2, 6.5, -0.4];
  trunk.push(...shared);
  const cards: number[] = [...shared];
  for (let i = 0; i < 300; i++) cards.push(Math.cos(i) * 2.5 * Math.random(), 5 + Math.random() * 5, Math.sin(i) * 2.5 * Math.random());
  const shape = measureSway([
    { positions: trunk, card: false },
    { positions: cards, card: true },
  ]);
  const model = stateOf(shape);
  const fromTrunk = off(shared, here, model);
  const fromCard = off([cards[0], cards[1], cards[2]], here, model);
  ok(len(fromTrunk) > 0 && fromTrunk.every((v, i) => v === fromCard[i]), 'a vertex the trunk and a card share moves identically in both: sway is a function of place, never of material');
  ok(shape.c > 0.4 && shape.c < 0.6 && Math.abs(shape.H - 10) < 0.1, `its canopy base is where its cards begin (c ${shape.c.toFixed(3)}, H ${shape.H.toFixed(2)})`);
  const cardsOnly = measureSway([{ positions: cards, card: true }]);
  ok(cardsOnly.c === 0, 'a model of cards alone bends from the ground');
  const doubled = measureSway([
    { positions: trunk, card: false },
    { positions: cards, card: true },
    { positions: cards.slice(0, 450), card: true },
  ]);
  ok(doubled.c === shape.c && doubled.H === shape.H && doubled.rT === shape.rT, "the mirror's copied vertices, which sit where their originals do, never move the measurement");

  // The trunk itself: a straight one of radius 0.3 standing off the origin, eight points a ring every half metre to
  // 8 m, with a branch reaching 2.6 m out between 3 and 4 m and a crown of cards from 5 m. Its axis is where the
  // trunk stands, whatever the branch and the crown do above the lowest quarter, and its radius the trunk's own,
  // never the branch's reach (a radius taken as the largest would hold most of the crown still; one that drifts
  // with the branch lets the trunk inside the crown flutter).
  const ring = (cx: number, cz: number, y: number, r: number, out: number[]) => {
    for (let k = 0; k < 8; k++) out.push(cx + Math.cos((k * Math.PI) / 4) * r, y, cz + Math.sin((k * Math.PI) / 4) * r);
  };
  const straight: number[] = [];
  for (let i = 0; i <= 16; i++) ring(0.6, -0.4, i * 0.5, 0.3, straight);
  for (let i = 0; i < 10; i++) straight.push(0.6 + 0.5 + (i / 9) * 2.1, 3 + i / 9, -0.4);
  const crown: number[] = [];
  for (let i = 0; i < 200; i++) crown.push(0.6 + Math.cos(i * 0.7) * 2.5, 5 + (i % 51) / 10, -0.4 + Math.sin(i * 0.7) * 2.5);
  const t1 = measureSway([
    { positions: straight, card: false },
    { positions: crown, card: true },
  ]);
  ok(Math.abs(t1.axisX - 0.6) < 1e-9 && Math.abs(t1.axisZ + 0.4) < 1e-9, `the trunk's axis is where the trunk stands, off the origin (${t1.axisX.toFixed(4)}, ${t1.axisZ.toFixed(4)})`);
  ok(Math.abs(t1.rT - 0.3) < 1e-9, `its radius is the trunk's own 0.3, never the branch's reach (${t1.rT.toFixed(4)})`);
  // A leaning trunk: each ring's middle moves 0.15 m along x a metre up from (1, −0.5). The axis is the middle of the
  // lowest quarter's rings (the trunk where it meets the ground), not the whole trunk's, which leans 0.6 m further.
  const leaning: number[] = [];
  const low: number[] = [];
  for (let i = 0; i <= 16; i++) {
    const y = i * 0.5;
    ring(1 + 0.15 * y, -0.5, y, 0.25, leaning);
    if (y < 0.25 * 10) low.push(1 + 0.15 * y);
  }
  const t2 = measureSway([
    { positions: leaning, card: false },
    { positions: crown, card: true },
  ]);
  const want = low.reduce((s, x) => s + x, 0) / low.length;
  ok(Math.abs(t2.H - 10) < 1e-9 && Math.abs(t2.axisX - want) < 1e-9 && Math.abs(t2.axisZ + 0.5) < 1e-9, `a leaning trunk's axis follows the trunk where it meets the ground (${t2.axisX.toFixed(4)} against ${want.toFixed(4)}; the whole trunk's middle would be ${(1 + 0.15 * 4).toFixed(2)})`);
}

// ---------------------------------------------------------------- 4. scale and the wind

{
  const model = stateOf(tree);
  const p = [1.4, 9, -1.1];
  let worstScale = 0;
  let worstAlong = 0;
  for (const s of [0.5, 0.8, 1.6, 2.5]) {
    for (let k = 0; k < 8; k++) {
      const yaw = k * 0.83;
      const m1 = matrixOf([5, 0, 8], yaw, 1);
      const ms = matrixOf([5, 0, 8], yaw, s);
      // The world displacement is the planting's basis times the displacement in the model's frame.
      const world = (m: number[]) => new THREE.Vector3(...off(p, m, model)).applyMatrix3(new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().fromArray(m)));
      const w1 = world(m1);
      const ws = world(ms);
      worstScale = Math.max(worstScale, Math.abs(ws.length() - s * w1.length()) / Math.max(1e-9, s * w1.length()));
      // The horizontal part of the world displacement lies along the wind (the flutter adds an upward part).
      const f = frame();
      worstAlong = Math.max(worstAlong, Math.abs(ws.x * f.windZ - ws.z * f.windX) / Math.max(1e-9, Math.hypot(ws.x, ws.z)));
    }
  }
  ok(worstScale < 1e-6, `a planting at scale s moves s times as far, at any yaw (worst ${worstScale.toExponential(1)})`);
  ok(worstAlong < 1e-6, `and its displacement in the world lies along the wind whatever way the planting is turned (worst sine ${worstAlong.toExponential(1)})`);
}

// ---------------------------------------------------------------- 5. the wrap

{
  const t = tune();
  let worst = 0;
  let frequencies = 0;
  for (let H = 0.05; H < 70; H *= 1.3) {
    const shape: SwayShape = { ...tree, H };
    const model = stateOf(shape, t);
    for (const flutterCycles of [cyclesPerWrap(0.45, t.wrap), cyclesPerWrap(0.31, t.wrap), 1]) {
      const fo = omegaOf(flutterCycles, t.wrap);
      const a = off([1.4, 0.9 * H, -1.1], here, model, frame({ t: t.wrap, flutterOmega: fo }), t);
      const b = off([1.4, 0.9 * H, -1.1], here, model, frame({ t: 0, flutterOmega: fo }), t);
      worst = Math.max(worst, len([a[0] - b[0], a[1] - b[1], a[2] - b[2]]));
      frequencies++;
    }
  }
  ok(worst < 1e-9, `the sway at the wrap equals the sway at nought for every whole-cycle frequency (${frequencies} tried, worst ${worst.toExponential(1)} m)`);
  const before = stepClock(t.wrap - 0.01, 0.02, 0, t);
  ok(Math.abs(before - 0.01) < 1e-9 && stepClock(5, 1, 1, t) === 5 + 1 + t.rateGain && stepClock(5, 1, 1, { ...t, freeze: true }) === 5, 'the clock steps over its wrap, quickens with the wind and stands still frozen');
  ok(cyclesPerWrap(1e9, t.wrap) === 1 && cyclesPerWrap(0, t.wrap) >= 1, 'a period longer than the wrap, or of nought, still comes to a whole cycle');
}

// ---------------------------------------------------------------- 6. no NaN

{
  const shapes: SwayShape[] = [
    { H: 0, c: 0, axisX: 0, axisZ: 0, rT: 0 },
    { H: 1e-9, c: 1, axisX: 0, axisZ: 0, rT: 0 },
    { ...tree, rT: 0 },
  ];
  let finite = true;
  for (const shape of shapes) {
    const model = stateOf(shape);
    for (const m of [here, matrixOf([1, 2, 3], 0.3, 0), matrixOf([1, 2, 3], 0.3, 1e-12)]) {
      for (const f of [frame(), frame({ windX: 0, windZ: 0, strength: 0 }), frame({ strength: 1 })]) {
        for (const p of [[0, 0, 0], [tree.axisX, 5, tree.axisZ], [0, -3, 0], [2, 1e6, 2]]) {
          const v = off(p, m, model, f);
          if (!v.every(Number.isFinite)) finite = false;
        }
      }
    }
  }
  const empty = measureSway([]);
  ok(finite && Object.values(empty).every(Number.isFinite), 'no NaN at a height of nought, a scale of nought, no wind, a trunk of no radius or an empty model');
  // The phase hash in single precision, against the same worked as a GPU may work it, each product fused into the
  // sum after it (one rounding where the mirror makes two): a hash whose last product is about ten thousand moves
  // with every such rounding, and a phase that moves is a sway that does not match its mirror. The common form of
  // the hash, the one first written, is tried too, to show the check can tell.
  const fr = Math.fround;
  const f = (v: number) => fr(v - Math.floor(v));
  const fused = (x: number, z: number, keepUnder2: boolean) => {
    let a = f(fr(fr(x) * fr(0.1031)));
    let b = f(fr(fr(z) * fr(0.1031)));
    let c = f(fr(fr(x) * fr(0.1031)));
    const d = fr(a * fr(b + fr(33.33)) + fr(b * fr(c + fr(33.33)) + c * fr(a + fr(33.33))));
    a = keepUnder2 ? f(fr(a + d)) : fr(a + d);
    b = keepUnder2 ? f(fr(b + d)) : fr(b + d);
    c = keepUnder2 ? f(fr(c + d)) : fr(c + d);
    return keepUnder2 ? f(fr(fr(fr(a + b) * c) * 8)) : f(fr(fr(a + b) * c));
  };
  const unfusedOld = (x: number, z: number) => {
    let a = f(fr(fr(x) * fr(0.1031)));
    let b = f(fr(fr(z) * fr(0.1031)));
    let c = f(fr(fr(x) * fr(0.1031)));
    const d = fr(fr(a * fr(b + fr(33.33))) + fr(fr(b * fr(c + fr(33.33))) + fr(c * fr(a + fr(33.33)))));
    a = fr(a + d);
    b = fr(b + d);
    c = fr(c + d);
    return f(fr(fr(a + b) * c));
  };
  // A planting whose sum lands within a rounding of a whole number takes the other side of a fraction on one
  // side of the comparison: a phase all its own either way, and rare, so it is counted rather than measured.
  const turn = (e: number) => Math.min(Math.abs(e), 1 - Math.abs(e));
  const N = 20000;
  let movedNew = 0;
  let movedOld = 0;
  const errs: number[] = [];
  const bins = new Array(10).fill(0);
  for (let i = 0; i < N; i++) {
    const x = (Math.random() - 0.5) * 16000;
    const z = (Math.random() - 0.5) * 16000;
    const h = swayHash(x, z);
    const e = turn(h - fused(x, z, true));
    errs.push(e);
    if (e > 1e-3) movedNew++;
    if (turn(unfusedOld(x, z) - fused(x, z, false)) > 1e-3) movedOld++;
    bins[Math.min(9, Math.floor(h * 10))]++;
  }
  errs.sort((p, q) => p - q);
  const spread = Math.min(...bins) / Math.max(...bins);
  ok(movedOld > N * 0.01, `the common form of the hash moves by over a thousandth of a turn for ${((movedOld / N) * 100).toFixed(1)}% of plantings when a product is fused, so the check can tell`);
  ok(movedNew < N * 0.001 && errs[Math.floor(N * 0.99)] < 5e-4, `the phase hash moves by over a thousandth of a turn for ${movedNew} of ${N} plantings 8 km out when a GPU fuses its products (the 99th percentile ${errs[Math.floor(N * 0.99)].toExponential(1)})`);
  ok(spread > 0.5, `and spreads plantings' phases over the whole turn (the emptiest tenth holds ${(spread * 100).toFixed(0)}% of the fullest)`);
}

// ---------------------------------------------------------------- 7. the rule's words and the packs

{
  ok(swaySelected('decd_birch_lg', true) && swaySelected('swmp_shor_cattail_lg', false) && swaySelected('leaf_yavn_kiteplant', false), 'a model with a card sways, and a plant named soft sways with none');
  ok(!swaySelected('rock_crystl_tree_med', true) && !swaySelected('fngi_mushroom_clump', true) && !swaySelected('decd_wroshyr_stump_dead01', true) && !swaySelected('rock_lrg', false), 'nothing named rigid sways, cards or not');
  ok(SOFT_PLANT.test('grss_clump') && RIGID.test('decd_log_lg') && RIGID.test('tato_log') && !RIGID.test('flow_bauhin') && !RIGID.test('ever_jinapur_lg'), "the words are the measurement's: `grss` beside `grass`, `log` only as a word of its own");
  ok(CANOPY_MAX < 1, 'the canopy base is held under the top');
}

const PACKS = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private/', import.meta.url));
const STUDY = process.env.SWG3JS_SWAY_STUDY ?? '';
{
  const packs = floraPacks(PACKS);
  if (!packs.length) console.log(`skip the packs: no pack with flora under ${PACKS}`);
  else {
    // Every world's card shaders at once: a flora model's own cut-outs are its cards whatever is known (it is the
    // flora's), so what is registered only gives a card its class where its GLB says none.
    const names = new Set<string>();
    for (const p of packs) {
      if (p.manifest.cards) registerPackCards(p.manifest.cards);
      for (const d of p.manifest.categories.flora) for (const m of glbJsonOf(join(p.dir, d.file)).materials ?? []) if (isCardJson(m)) names.add(m.name ?? '');
    }
    registerPackCards(Object.fromEntries([...names].map((n) => [n, { blend: classByName(n) === 'blend', emissive: [0, 0, 0] }])));
    const shapes = new Map<string, { shape: SwayShape; sways: boolean }>();
    for (const p of packs) {
      for (const d of p.manifest.categories.flora) {
        if (shapes.has(d.id)) continue;
        const file = join(p.dir, d.file);
        if (!existsSync(file)) continue;
        const { scenes } = glbScenes(file);
        prepareCardModel(scenes, { flora: true, count: false }, 'cards');
        const model = prepareSwayModel(scenes, `test:${d.id}`, d.id, { flora: true, building: false });
        if (model) shapes.set(d.id, { shape: model.shape, sways: true });
        else {
          // A model that does not sway is measured all the same, to hold the numbers against the study's.
          const prims: { positions: Float64Array; card: boolean }[] = [];
          scenes[0].traverse((o) => {
            const m = o as THREE.Mesh;
            const pos = m.isMesh ? m.geometry.getAttribute('position') : null;
            if (!pos) return;
            const a = new Float64Array(pos.count * 3);
            for (let v = 0; v < pos.count; v++) {
              a[v * 3] = pos.getX(v);
              a[v * 3 + 1] = pos.getY(v);
              a[v * 3 + 2] = pos.getZ(v);
            }
            prims.push({ positions: a, card: (Array.isArray(m.material) ? m.material : [m.material]).some((x) => x.userData.swgCardBlend !== undefined) });
          });
          shapes.set(d.id, { shape: measureSway(prims), sways: false });
        }
      }
    }
    const sway = [...shapes.values()].filter((s) => s.sways).length;
    ok(shapes.size > 0 && [...shapes.values()].every((s) => Object.values(s.shape).every(Number.isFinite)), `every flora model on disk measures to finite numbers (${shapes.size} models, ${sway} sway)`);
    const study3 = STUDY && join(STUDY, 'shape3.out.json');
    if (!study3 || !existsSync(study3)) console.log('skip the study comparison: SWG3JS_SWAY_STUDY names no folder with the study outputs (shape.out.json, shape2.out.json, shape3.out.json)');
    else {
      type Row = { id: string; H: number; c: number; sways: boolean; kind: string };
      const rows3 = JSON.parse(readFileSync(study3, 'utf8')) as Row[];
      const rows2 = new Map((JSON.parse(readFileSync(join(STUDY, 'shape2.out.json'), 'utf8')) as { id: string; rT: number }[]).map((r) => [r.id, r]));
      const rows1 = new Map((JSON.parse(readFileSync(join(STUDY, 'shape.out.json'), 'utf8')) as { id: string; axisOff: number }[]).map((r) => [r.id, r]));
      let both = 0;
      let selection = 0;
      const differ: string[] = [];
      const hDiffer: string[] = [];
      let hOff = 0;
      const dc: number[] = [];
      const dr: number[] = [];
      const da: number[] = [];
      for (const r of rows3) {
        const s = shapes.get(r.id);
        if (!s) continue;
        both++;
        if (s.sways === r.sways) selection++;
        else differ.push(`${r.id} (${s.sways ? 'sways' : 'still'} here, ${r.kind})`);
        // A flat lily pad is held at a centimetre here and at a millimetre in the study.
        if (Math.abs(s.shape.H - Math.max(r.H, 0.01)) > 0.006) {
          hOff++;
          hDiffer.push(`${r.id} ${s.shape.H.toFixed(3)} against ${r.H}`);
        }
        if (r.kind === 'cards+opaque') dc.push(Math.abs(s.shape.c - r.c));
        const r2 = rows2.get(r.id);
        if (r2) dr.push(Math.abs(s.shape.rT - r2.rT) / Math.max(0.05, r2.rT));
        const r1 = rows1.get(r.id);
        if (r1) da.push(Math.abs(Math.hypot(s.shape.axisX, s.shape.axisZ) - r1.axisOff));
      }
      const q = (a: number[], p: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))] : 0);
      ok(both > 0 && selection === both, `the selection rule gives the study's answer on every model both measured (${selection} of ${both})${differ.length ? `: ${differ.join(', ')}` : ''}`);
      ok(hOff === 0, `the height is the study's on every one (${hOff} differ by more than half a centimetre)${hDiffer.length ? `: ${hDiffer.join(', ')}` : ''}`);
      console.log(`     canopy base against the study: median ${q(dc, 0.5).toFixed(4)}, 90th ${q(dc, 0.9).toFixed(4)}, worst ${q(dc, 1).toFixed(4)}; trunk radius (share) median ${q(dr, 0.5).toFixed(3)}, 90th ${q(dr, 0.9).toFixed(3)}; axis offset (m) median ${q(da, 0.5).toFixed(4)}, 90th ${q(da, 0.9).toFixed(4)}`);
      ok(q(dc, 0.9) <= 0.03 && q(dc, 0.5) <= 0.01, 'the canopy base is the study\'s to within 0.03 of the height on nine models in ten (the study counted a vertex every time a primitive listed it; the game counts a place once)');
      ok(q(dr, 0.9) <= 0.02, "the trunk radius is the study's to within 2% on nine in ten (the opaque vertices are counted as the study counted them)");
      ok(q(da, 0.9) <= 0.002, "the axis is the study's to within 2 mm on nine in ten");
    }
  }
}

console.log(`\nswayMath: ${passed} checks passed`);
