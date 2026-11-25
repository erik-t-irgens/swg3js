// The sky's bodies as the system has them (the GPU port's sky round, maker P: the brief's A, B, C, I and J), under node with the
// viewer's own drafts as the applied systems and stand-in skies (made-up sizes, no converted file):
//   1. C, size by distance: each item's mean, nearest and farthest distance from the world one stands on; drawn at its setting
//      at its mean, `2 atan(radius / distance)` now at the dial's 1 and its setting to the bit at 0; a moon of the world one
//      stands on at its setting to the bit at every moment; a star and a sheet untouched; the size the cover and night use;
//   2. B, the pose: three columns square to each other; the axis and the meridian held in the system's frame (the system's turn
//      taken back off them constant over a day); a ringed moon's light on its axis fixed over a night while its axis tips with
//      the sky; a locked moon's meridian on the line to its parent; a body's own spin none where it is locked;
//   3. I, the viewer and the game agree: the viewer's own model (`compileSystem`, `skyAt`, `modelPoseOf`) and the game's motion
//      (`SkyMotion.at`) at one moment give the same poses and sizes to the bit;
//   4. A, one route: under an applied system every drawn body (not a star, not a sheet) is planned at its motion item, its card
//      of SWG's standing down for it, a sun picture's place too (no card), a body with no look on SWG's place left to SWG's
//      picture, a hidden place left out, the picture sized for its nearest; with no system the plans are the base's to the field
//      (the base's `lookWorld.ts` out of git);
//   5. J, the belts: none drawn while the Drawn tick is off; a ticked belt's plane, middle and sun turned into the sky by the
//      system's turn; the band's dials held to their ranges.
//
// Run: node tools/swg/tests/skyBodies.test.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { draftSystem } from '../../../src/sky/system/drafts.js';
import { compileSystem, makeSkyState, skyAt } from '../../../src/sky/system/system.js';
import { MOTION_TUNE, skyMotionFor, skyPlacesOf, type SkyMotion } from '../../../src/sky/system/skyMotion.ts';
import { bodyPosesInto, distanceKitOf, drawnSizeDeg, modelPoseOf, poseKitOf, poseQuatInto, type PoseModel } from '../../../src/sky/system/bodyPose.ts';
import { BELT_RANGE, BELT_STRIDE, BELT_TUNE, tuneBelts } from '../../../src/sky/system/beltSky.ts';
import * as LW from '../../../src/sky/bodies/lookWorld.ts';
import * as BF from '../../../src/sky/look/bodiesFile.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let checks = 0;
const ok = (cond: boolean, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  console.log(`ok   ${msg}`);
};
const DEG = Math.PI / 180;
const near = (a: number, b: number, e: number): boolean => Math.abs(a - b) <= e;

// Stand-in skies: SWG's slots and celestials at sizes of our own.
const SKY: Any = { sun: { size: 0.6 }, moon: { size: 0.5 }, supplementalMoon: { size: 0.25 }, celestials: [{ size: 1, image: { file: 'sky/cels_moon_earthy01.png' } }, { size: 1, image: { file: 'sky/cels_endor.png' } }, { size: 1, image: { file: 'sky/cels_moon_mercury.png' } }] };
const applied = (id: string, mutate?: (s: Any) => void): Any => {
  const s = JSON.parse(JSON.stringify(draftSystem(id)));
  mutate?.(s);
  return { [id]: s && { ...s, applied: true } } as Any;
};
const motionOf = (id: string, world: string, mutate?: (s: Any) => void): SkyMotion => {
  const sys = applied(id, mutate);
  // the file's `systems` holds the system itself with its applied mark (the reader's shape)
  const m = skyMotionFor({ [id]: { ...sys[id] } } as Any, world, world, SKY);
  if (!m) throw new Error(`no motion for ${world}`);
  return m;
};
const at = (m: SkyMotion, count: number): void => m.at({ count });
const col = (P: Float64Array, j: number, c: number): [number, number, number] => [P[9 * j + 3 * c], P[9 * j + 3 * c + 1], P[9 * j + 3 * c + 2]];
const dot3 = (a: ArrayLike<number>, b: ArrayLike<number>): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** The system's turn taken back off a sky direction (R's transpose). */
const back = (R: Float64Array, v: ArrayLike<number>): [number, number, number] => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];
const stOf = (m: SkyMotion): Any => (m as Any).state;
const modelOf = (m: SkyMotion): Any => (m as Any).model;
const itemNamed = (m: SkyMotion, body: string): number => m.items.findIndex((it) => it.body === body);

// ---------------------------------------------------------------- 1. C: size by distance
{
  const m = motionOf('endor', 'endor');
  const kef = itemNamed(m, 'kefbir');
  const giant = itemNamed(m, 'giant');
  ok(kef >= 0 && giant >= 0, "Endor's draft seen from the forest moon: Kef Bir and the giant are items");
  ok(m.nearDist[kef] < m.meanDist[kef] && m.meanDist[kef] < m.farDist[kef], `Kef Bir's distance moves: nearest ${m.nearDist[kef].toFixed(4)}, mean ${m.meanDist[kef].toFixed(4)}, farthest ${m.farDist[kef].toFixed(4)} AU`);
  ok(m.meanDist[giant] === m.nearDist[giant] && m.farDist[giant] - m.nearDist[giant] < 1e-15, "the giant the forest moon goes round stands at one distance (to rounding): its mean is that distance to the bit");
  const was = MOTION_TUNE.distanceSize;
  let worst = 0;
  let saw = 0;
  for (let k = 0; k < 40; k++) {
    at(m, 20000 + k * 0.37);
    const s = m.items[kef].sizeDeg;
    const want = (2 * Math.atan((Math.tan((s * DEG) / 2) * m.meanDist[kef]) / m.dist[kef])) / DEG;
    worst = Math.max(worst, Math.abs(m.sizeNow[kef] - want));
    saw = Math.max(saw, m.sizeNow[kef] / s);
  }
  ok(m.sizeNow[giant] === m.items[giant].sizeDeg, 'the giant held at its setting');
  ok(worst < 1e-12 && saw > 1.2, `at the dial's 1 Kef Bir is drawn 2 atan(radius / distance) at every moment (worst ${worst.toExponential(1)} degrees), up to ${saw.toFixed(2)} times its setting`);
  MOTION_TUNE.distanceSize = 0;
  let same = true;
  for (let k = 0; k < 20; k++) {
    at(m, 20000 + k * 0.53);
    for (let j = 0; j < m.items.length; j++) if (m.sizeNow[j] !== m.items[j].sizeDeg) same = false;
  }
  ok(same, "at the dial's 0 every body is drawn at its setting to the bit, as before");
  MOTION_TUNE.distanceSize = 0.5;
  at(m, 20000.4);
  const half = m.items[kef].sizeDeg + 0.5 * (drawnSizeDeg(m.items[kef].sizeDeg, m.meanDist[kef], m.dist[kef], 1) - m.items[kef].sizeDeg);
  ok(near(m.sizeNow[kef], half, 1e-12), 'between, the setting and the true size mixed by the dial');
  MOTION_TUNE.distanceSize = was;
  ok(near(m.largestDeg[kef], drawnSizeDeg(m.items[kef].sizeDeg, m.meanDist[kef], m.nearDist[kef], 1), 1e-12) && m.largestDeg[kef] > m.items[kef].sizeDeg, "its picture is sized for its nearest (the largest it is drawn)");
  const t = motionOf('tive', 'taanab');
  let fixed = true;
  for (let k = 0; k < 30; k++) {
    at(t, 21000 + k * 0.29);
    for (const it of t.items) if (!it.star && t.sizeNow[it.index] !== it.sizeDeg) fixed = false;
  }
  ok(fixed, "Taanab's moons go round Taanab itself: each at its setting to the bit at every moment");
  for (const it of m.items) if (it.star) ok(m.sizeNow[it.index] === it.sizeDeg, `a star (${it.name}) keeps its setting`);
  // the cover takes the size drawn: a body grown over the sun covers more of it (the overlap worked over the drawn size)
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../src/sky/system/skyMotion.ts'), 'utf8');
  ok(/const b = \(this\.sizeNow\[j\] \* DEG\) \/ 2;/.test(src), "the eclipse's cover works over the size drawn now (`coverOf`)");
}

// ---------------------------------------------------------------- 2. B: the pose
{
  const m = motionOf('endor', 'endor');
  const giant = itemNamed(m, 'giant');
  const kef = itemNamed(m, 'kefbir');
  let square = 0;
  let worstHeld = 0;
  let worstMer = 0;
  let firstA: number[] | null = null;
  let firstM: number[] | null = null;
  let tipped = 0;
  for (let k = 0; k < 48; k++) {
    at(m, 20000 + k / 48);
    const P = m.pose;
    for (let j = 0; j < m.items.length; j++) {
      const X = col(P, j, 0);
      const Y = col(P, j, 1);
      const Z = col(P, j, 2);
      square = Math.max(square, Math.abs(dot3(X, Y)), Math.abs(dot3(Y, Z)), Math.abs(dot3(X, Z)), Math.abs(dot3(X, X) - 1), Math.abs(dot3(Y, Y) - 1), Math.abs(dot3(Z, Z) - 1));
    }
    const R = stOf(m).R as Float64Array;
    const A = back(R, col(P, giant, 1));
    const M2 = back(R, col(P, giant, 2));
    if (!firstA) {
      firstA = A;
      firstM = M2;
    }
    worstHeld = Math.max(worstHeld, Math.acos(Math.min(1, dot3(A, firstA))) / DEG);
    worstMer = Math.max(worstMer, Math.acos(Math.min(1, dot3(M2, firstM!))) / DEG);
    tipped = Math.max(tipped, Math.acos(Math.min(1, Math.abs(P[9 * giant + 4]))) / DEG);
  }
  ok(square < 1e-12, `every pose three unit columns square to each other (worst ${square.toExponential(1)})`);
  ok(worstHeld < 1e-5 && worstMer < 1e-5, `the giant's axis and meridian held in the system's frame over the forest moon's day (the system's turn taken off them: ${worstHeld.toExponential(1)} and ${worstMer.toExponential(1)} degrees)`);
  ok(tipped > 5, `while in the sky its axis stands ${tipped.toFixed(1)} degrees off the sky's up at its most (the ground's frame would hold it up)`);
  // the axial tilt: the giant's axis leans 6 degrees from its orbit's pole about the node line
  const M = modelOf(m);
  const gi = M.itemBody[giant];
  const A0 = back(stOf(m).R, col(m.pose, giant, 1));
  const N = [M.basis[9 * gi + 6], M.basis[9 * gi + 7], M.basis[9 * gi + 8]];
  ok(near(Math.acos(dot3(A0, N)) / DEG, 6, 1e-9), "the giant's axis leans its axial tilt (6 degrees in the draft) from its orbit's pole");
  // a locked moon's meridian on the line to its parent
  at(m, 20000.31);
  const ki = M.itemBody[kef];
  const st = stOf(m);
  const toP = [st.pos[3 * M.parent[ki]] - st.pos[3 * ki], st.pos[3 * M.parent[ki] + 1] - st.pos[3 * ki + 1], st.pos[3 * M.parent[ki] + 2] - st.pos[3 * ki + 2]];
  const Ak = back(st.R, col(m.pose, kef, 1));
  const Mk = back(st.R, col(m.pose, kef, 2));
  const d = dot3(toP, Ak);
  const perp = [toP[0] - d * Ak[0], toP[1] - d * Ak[1], toP[2] - d * Ak[2]];
  const pl = Math.sqrt(dot3(perp, perp));
  ok(m.locked[kef] === 1 && near(dot3(Mk, perp) / pl, 1, 1e-12), "Kef Bir (locked) turns its meridian to the giant it goes round");
  ok(m.ownSpinDeg[kef] === 0 && m.items[kef].spinDeg !== 0, 'a locked body takes no turn of its own (its face held by its pose)');
  ok(m.ownSpinDeg[giant] === m.items[giant].spinDeg && m.ownSpinDeg[giant] > 0, "the giant turns its bands at its own day (30 hours in the draft)");
  // Taanab's ringed moon over a night: its axis tips with the sky, the light on its axis fixed by its orbit
  const t = motionOf('tive', 'taanab');
  const ice = itemNamed(t, 'icemoon');
  let sunLatLo = 99;
  let sunLatHi = -99;
  let upLo = 99;
  let upHi = -99;
  for (let k = 0; k <= 16; k++) {
    at(t, 21000 + (0.5 * k) / 16);
    const Y = col(t.pose, ice, 1);
    const L = [t.light[3 * ice], t.light[3 * ice + 1], t.light[3 * ice + 2]];
    const lat = Math.asin(dot3(L, Y)) / DEG;
    sunLatLo = Math.min(sunLatLo, lat);
    sunLatHi = Math.max(sunLatHi, lat);
    const up = Math.asin(Y[1]) / DEG;
    upLo = Math.min(upLo, up);
    upHi = Math.max(upHi, up);
  }
  ok(sunLatHi - sunLatLo < 0.05, `Taanab's ringed moon over half its world's day: the sun's latitude on it held (${sunLatLo.toFixed(3)} to ${sunLatHi.toFixed(3)} degrees: its orbit's, not the observer's day)`);
  ok(upHi - upLo > 5, `while its axis tips with the sky (${upLo.toFixed(1)} to ${upHi.toFixed(1)} degrees over the horizon's plane)`);
  // the turn written as a quaternion is the pose
  const q = { _x: 0, _y: 0, _z: 0, _w: 1 };
  poseQuatInto(t.pose, ice, q);
  const qq = new THREE.Quaternion(q._x, q._y, q._z, q._w);
  const y = new THREE.Vector3(0, 1, 0).applyQuaternion(qq);
  const z = new THREE.Vector3(0, 0, 1).applyQuaternion(qq);
  const Yp = col(t.pose, ice, 1);
  const Zp = col(t.pose, ice, 2);
  ok(near(y.x, Yp[0], 1e-12) && near(y.y, Yp[1], 1e-12) && near(y.z, Yp[2], 1e-12) && near(z.x, Zp[0], 1e-12) && near(z.y, Zp[1], 1e-12) && near(z.z, Zp[2], 1e-12), "the axis group's turn takes the look's +y to the axis and its +z to the meridian (three's own quaternion)");
}

// ---------------------------------------------------------------- 3. I: the viewer's model and the game's motion agree
{
  for (const [id, world] of [['endor', 'endor'], ['tive', 'taanab'], ['mustafar', 'mustafar'], ['karthakk', 'lok']] as const) {
    const m = motionOf(id, world);
    const places = skyPlacesOf(world, SKY);
    const sys = JSON.parse(JSON.stringify(draftSystem(id)));
    // the viewer's own model, as the page makes it (`starModel`), at the game's moment
    const vm: Any = compileSystem(sys, (pid: string) => places.get(pid)?.sizeDeg ?? null, (pid: string) => places.get(pid)?.sheet === true, { world, placeExists: (pid: string) => places.has(pid) });
    const vs: Any = makeSkyState(vm);
    let worstP = 0;
    let worstS = 0;
    for (let k = 0; k < 12; k++) {
      at(m, 20500 + k * 0.611);
      skyAt(vm, m.T, vs);
      const mp = modelPoseOf(vm, vs, MOTION_TUNE.distanceSize);
      for (let i = 0; i < m.pose.length; i++) worstP = Math.max(worstP, Math.abs(mp.poses[i] - m.pose[i]));
      for (let j = 0; j < m.items.length; j++) worstS = Math.max(worstS, Math.abs(mp.sizes[j] - m.sizeNow[j]));
    }
    ok(worstP === 0 && worstS === 0, `${world}: the viewer's own model and the game's motion give the same poses and drawn sizes to the bit at twelve moments`);
  }
}

// ---------------------------------------------------------------- 4. A: one route under an applied system
{
  const disc = (w: number): Any => {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    d.scale.setScalar(w);
    return d;
  };
  const sky = new THREE.Group();
  const gen = (name: string): Any => ({ name, kind: 'sphere', generated: { recipe: 'moon', seed: 3, dials: {} }, layers: {} });
  // Mustafar: its moon slot holds SWG's sun picture (no card); his looks on the system's bodies
  const mu = motionOf('mustafar', 'mustafar');
  const file: Any = { version: 1, looks: { nurL: gen('Nur'), jL: gen('Jestefad'), lL: gen('Lefrani') }, uses: { 'mustafar:moon': 'nurL', 'mustafar:celestial:jestefad': 'jL', 'mustafar:celestial:lefrani': 'lL' }, systems: {} };
  BF.SKY_BODIES.file = file;
  const plans = LW.skyLookPlans('mustafar', [], sky, 60, LW.SKY_CARD_REACH, mu, () => gen('preset'));
  const placesOf = plans.map((p) => p.place).sort();
  ok(JSON.stringify(placesOf) === JSON.stringify(['mustafar:celestial:jestefad', 'mustafar:celestial:lefrani', 'mustafar:moon']), `Mustafar with no card of SWG's: Nur at its sun-picture moon slot and both giants planned (${placesOf.join(', ')})`);
  ok(plans.every((p) => p.byMotion && (p.item ?? -1) >= 0 && p.order === -5), 'each by the motion route at its item, ordered by its distance');
  ok(LW.motionLookPlaces(plans).has('mustafar:moon'), "the sky is told to put SWG's sun picture at Nur's place away");
  const nurJ = itemNamed(mu, 'nur');
  const nurPlan = plans.find((p) => p.place === 'mustafar:moon')!;
  ok(near(nurPlan.halfRad, (mu.largestDeg[nurJ] * Math.PI) / 360, 1e-12), "its picture sized for the largest it is drawn");
  // the same system hiding Nur's place: left out
  const hid = motionOf('mustafar', 'mustafar', (s) => s.hide.push('mustafar:moon'));
  const hidPlans = LW.skyLookPlans('mustafar', [], sky, 60, LW.SKY_CARD_REACH, hid, () => gen('preset'));
  ok(!hidPlans.some((p) => p.place === 'mustafar:moon') && hidPlans.length === 2, 'a place the system hides stays hidden');
  // Endor: SWG's cards for Kef Bir (its moon slot) and the giant (a celestial) stand down for the motion's route; a body on SWG's
  // place with no look keeps SWG's picture (left to the sky)
  const en = motionOf('endor', 'endor');
  BF.SKY_BODIES.file = { version: 1, looks: { gL: gen('giant') }, uses: { 'endor:celestial:cels_endor': 'gL' }, systems: {} } as Any;
  const cards: Any[] = [
    { disc: disc(400), glow: null, file: 'sky/cels_endor.png', map: null, air: { kind: 'giant' }, slot: 'celestial' },
    { disc: disc(200), glow: null, file: 'sky/moon_single.png', map: null, air: { kind: 'airless' }, slot: 'moon' },
  ];
  const ep = LW.skyLookPlans('endor', cards, sky, 60, LW.SKY_CARD_REACH, en, () => gen('preset'));
  const g = ep.find((p) => p.place === 'endor:celestial:cels_endor');
  ok(!!g && g.byMotion === true && g.card === cards[0] && g.item === itemNamed(en, 'giant'), "the giant on SWG's card is drawn by the motion's route, its card standing down for it");
  ok(!ep.some((p) => p.place === 'endor:moon'), "Kef Bir on SWG's moon slot with no look of his keeps SWG's picture there (placed, sized and ordered by the system)");
  ok(LW.lookPlaces(ep).has('endor:celestial:cels_endor'), "the giant's card needs no disc picture (drawn whole)");
  // with no system: the base's plans to the field (the base's lookWorld.ts out of git)
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, '../../..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skybodies-'));
  try {
    const base = execFileSync('git', ['show', '34a650c:src/sky/bodies/lookWorld.ts'], { cwd: root, encoding: 'utf8' });
    // its own imports made absolute into the tree (the modules beside it are the tree's: only lookWorld.ts moved)
    const abs = base.replace(/from '(\.\.?\/[^']+)'/g, (_m, p) => `from '${pathToFileURL(path.resolve(root, 'src/sky/bodies', p)).href}'`);
    const file2 = path.join(tmp, 'lookWorld.base.ts');
    fs.writeFileSync(file2, abs);
    const B: Any = await import(pathToFileURL(file2).href);
    BF.SKY_BODIES.file = { version: 1, looks: { gL: gen('giant'), mL: gen('moon') }, uses: { 'endor:celestial:cels_endor': 'gL', 'endor:moon': 'mL' }, systems: {} } as Any;
    const strip = (ps: Any[]): string => JSON.stringify(ps.map((p) => ({ place: p.place, id: p.id, item: p.item, order: p.order, halfRad: p.halfRad, card: cards.indexOf(p.card), byMotion: !!p.byMotion, rec: !!p.record })));
    const now = strip(LW.skyLookPlans('endor', cards, sky, 60, LW.SKY_CARD_REACH, null, () => gen('preset')));
    const was = strip(B.skyLookPlans('endor', cards, sky, 60, B.SKY_CARD_REACH, null, () => gen('preset')));
    ok(now === was && now.length > 2, "with no applied system the plans are the base's (34a650c) to the field");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  BF.SKY_BODIES.file = null;
}

// ---------------------------------------------------------------- 5. J: the belts
{
  const k0 = motionOf('karthakk', 'lok');
  ok(k0.beltKit.count === 0 && k0.beltCount === 0, "the Spine of Lok with its Drawn tick off draws nothing (the draft's)");
  const k1 = motionOf('karthakk', 'lok', (s) => {
    s.bodies.find((b: Any) => b.id === 'spine').drawn = true;
  });
  ok(k1.beltKit.count === 1 && k1.beltKit.names[0] === 'The Spine of Lok', 'its Drawn tick on: one belt drawn');
  ok(!k1.items.some((it) => it.body === 'spine' && it.drawn), "its item stays undrawn (no body, no cover, no look: the band is its drawing)");
  let held = 0;
  let worstMid = 0;
  for (let k = 0; k < 24; k++) {
    at(k1, 22000 + k / 24);
    const B = k1.belts;
    const R = stOf(k1).R as Float64Array;
    const n = back(R, [B[0], B[1], B[2]]);
    const M: Any = modelOf(k1);
    const i = B[12];
    const N = [M.basis[9 * i + 6], M.basis[9 * i + 7], M.basis[9 * i + 8]];
    held = Math.max(held, Math.abs(1 - dot3(n, N)));
    // its middle (the sun) is the sun's way
    worstMid = Math.max(worstMid, Math.abs(1 - (B[3] * B[8] + B[4] * B[9] + B[5] * B[10])));
  }
  ok(held < 1e-12, "the belt's plane is the system's, turned into the sky by its turn, at every hour");
  ok(worstMid < 1e-12 && near(k1.belts[7], 0.95, 1e-12), "its middle is its sun's way, its radius the draft's 0.95 AU");
  const lok = (k1 as Any).model.worldI;
  ok(k1.belts[6] > 0.85 && k1.belts[6] < 0.95, `Lok stands ${k1.belts[6].toFixed(3)} AU from the Spine's middle, inside its ring`);
  const saved = { ...BELT_TUNE };
  tuneBelts({ lux: 9, width: -1, thick: Number.NaN });
  ok(BELT_TUNE.lux === BELT_RANGE.lux[1] && BELT_TUNE.width === BELT_RANGE.width[0] && BELT_TUNE.thick === saved.thick, "the band's dials held to their ranges, a number that is none ignored");
  Object.assign(BELT_TUNE, saved);
  ok(BELT_STRIDE === 14 && lok >= 0, 'the layout the band reads');
}

console.log(`\nskyBodies: ${checks} checks passed`);
