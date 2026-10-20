// The sun's cascades drawn by age (the performance pass's sixth wave, src/world/shadowCadence.ts): the age rule over
// scripted frames at 30, 60, 120 and 144 a second, the stagger and the dirty rules; the guards against three's own cascade
// fitting run in node (its real `CSM` with the game's camera, cascades, fade and shadow cameras' range by the game's own
// `shadowCameraFar`), the camera standing, walking and turning, under a high, a noon and a low sun, held boxes one to
// seven frames old, with the depth that ships (`farDepth` 'whole', `coverDeep` 0, the owner's Q8) and the old depth to
// compare -- wherever a hold passes, every ground sample of the band the fresh box holds the held box holds, no ground
// sample lies past the held map's deep end (by more than `coverDeep` of what the fresh map held, with the old depth), and
// the held light is never more than `coverHigh` nearer the slice; and the real `ShadowHold.decide` asked every one of
// those holds answers as `holdCovers` does over three's own matrices (its own written-out copies of the light frames, the
// band, its corners and the depths), an exact tie on the cover line apart; the holds it must refuse refused by their own
// reasons and a cascade asked and not drawn made dirty; the old depth's far cut-off as a fact of three's fitting and the
// shipped depth's none; the schedule turning at 90 degrees a second through the real `decide`; the band and its corners
// against the shader's own arithmetic and a real camera; the mover reach; the sun step; and day one: with the cadence off
// every cascade is due every frame with nothing put back, and `refreshCascadeBoxes` today gives the frusta it gave at the
// wave's base, out of git.
//
// Everything is synthetic: the game's camera and cascade numbers, nothing read from the game's files.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { CascadeClock, SHADOW_PASS_TUNE, ShadowHold, ShadowMovers, bandCorners, cascadeBand, dueCascades, holdCovers, moverReaches, shadowCameraFar, sunMoved, tuneShadowPass, type ShadowReason } from '../../../src/world/shadowCadence.ts';
import { refreshCascadeBoxes } from '../../../src/world/bodyCull.ts';
import { atBase } from './atBase.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const TUNE0 = { ...SHADOW_PASS_TUNE, maxAgeMs: [...SHADOW_PASS_TUNE.maxAgeMs] };
const resetTune = (): void => {
  Object.assign(SHADOW_PASS_TUNE, { ...TUNE0, maxAgeMs: SHADOW_PASS_TUNE.maxAgeMs });
  SHADOW_PASS_TUNE.maxAgeMs.length = 0;
  SHADOW_PASS_TUNE.maxAgeMs.push(...TUNE0.maxAgeMs);
};

// ---- 1. The age rule, the stagger, over scripted frames. ----
/** Run `frames` decisions at `hz` with every map drawn when due; answers the draws a cascade and the oldest map ever shown. */
function schedule(hz: number, frames: number, ages: number[], stagger = true): { draws: number[]; worstShown: number[]; bothFar: number; due: ShadowReason[][] } {
  const tune = { ...SHADOW_PASS_TUNE, maxAgeMs: ages, cadence: true, stagger };
  const c = new CascadeClock();
  c.n = 3;
  const out: ShadowReason[] = ['first', 'first', 'first'];
  const draws = [0, 0, 0];
  const worstShown = [0, 0, 0];
  let bothFar = 0;
  const due: ShadowReason[][] = [];
  const dt = 1000 / hz;
  for (let f = 0; f < frames; f++) {
    const now = f * dt;
    for (let i = 0; i < 3; i++) c.hasMap[i] = 1;
    dueCascades(c, now, tune, out);
    due.push([...out]);
    let far = 0;
    for (let i = 0; i < 3; i++) {
      if (out[i] !== 'held') {
        c.drawnAt[i] = now;
        c.valid[i] = 1;
        c.dirty[i] = 0;
        draws[i]++;
        // Two far cascades on one frame count only where both are due by age alone (a first or dirty one never waits).
        if (i > 0 && out[i] === 'age') far++;
      }
      const shown = now - c.drawnAt[i];
      if (f > 10 && shown > worstShown[i]) worstShown[i] = shown;
    }
    if (far > 1) bothFar++;
  }
  return { draws, worstShown, bothFar, due };
}
{
  const N = 1440;
  for (const hz of [30, 60, 120, 144]) {
    const s = schedule(hz, N, [0, 13, 41]);
    const dt = 1000 / hz;
    ok(s.draws[0] === N, `${hz} Hz: the near map drawn every frame`);
    ok(s.worstShown[1] <= 13 + dt + 1e-9 && s.worstShown[2] <= 41 + dt + 1e-9, `${hz} Hz: no map ever shown older than its age plus one frame (middle ${s.worstShown[1].toFixed(1)} ms, far ${s.worstShown[2].toFixed(1)} ms)`);
    ok(s.bothFar === 0, `${hz} Hz: the middle and far maps are never drawn on one frame (the stagger)`);
  }
  const s144 = schedule(144, N, [0, 13, 41]);
  ok(Math.abs(s144.draws[2] - N / 6) <= N / 60 && s144.draws[1] >= N / 3 && s144.draws[1] <= N / 2 + 1, `144 Hz at [0, 13, 41]: the far map every sixth frame (${s144.draws[2]} of ${N}) and the middle every second, a frame later where the two meet (${s144.draws[1]})`);
  const free144 = schedule(144, N, [0, 13, 41], false);
  ok(Math.abs(free144.draws[1] - N / 2) <= 1 && Math.abs(free144.draws[2] - N / 6) <= 1, `144 Hz without the stagger: the middle exactly every second frame (${free144.draws[1]}) and the far every sixth (${free144.draws[2]})`);
  const s60 = schedule(60, N, [0, 13, 41], false);
  ok(s60.draws[1] === N && Math.abs(s60.draws[2] - N / 3) <= 1, `60 Hz without the stagger: the middle every frame (${s60.draws[1]}), the far every third (${s60.draws[2]})`);
  const today = schedule(144, 300, [0, 0, 0]);
  ok(today.draws.every((d) => d === 300) && today.due.slice(1).every((r) => r.every((x) => x === 'age')), '[0, 0, 0]: every cascade drawn every frame, never staggered (today exactly)');
  // The stagger alone: both far cascades due by age on one frame, the older map first and the other a frame later.
  const c = new CascadeClock();
  c.n = 3;
  c.valid.fill(1);
  c.hasMap.fill(1);
  c.drawnAt[0] = 990;
  c.drawnAt[1] = 980;
  c.drawnAt[2] = 940;
  const out: ShadowReason[] = ['first', 'first', 'first'];
  const tune = { ...SHADOW_PASS_TUNE, maxAgeMs: [0, 13, 41], cadence: true, stagger: true };
  dueCascades(c, 1000, tune, out);
  ok(out[0] === 'age' && out[1] === 'held' && out[2] === 'age', `both due by age: the far map (older) drawn, the middle held a frame (${out.join(' ')})`);
  c.guard[1] = 'cover';
  dueCascades(c, 1000, tune, out);
  ok(out[1] === 'cover' && out[2] === 'age', 'a cascade a guard refused is never held back by the stagger');
  c.guard[1] = '';
  c.dirty[1] = 1;
  dueCascades(c, 1000, tune, out);
  ok(out[1] === 'dirty' && out[2] === 'age', 'nor is a dirty one');
  c.dirty[1] = 0;
  c.hasMap[2] = 0;
  dueCascades(c, 1000, tune, out);
  ok(out[2] === 'first' && out[1] === 'age', 'a null map is drawn (first), and never staggered');
  c.hasMap[2] = 1;
  dueCascades(c, 1000, { ...tune, cadence: false }, out);
  ok(out.every((r) => r === 'age'), 'cadence off: every cascade drawn');
}

// ---- 2. The band and its corners, against the shader's own arithmetic and a real camera. ----
const ASPECT = 1600 / 900;
const camera = new THREE.PerspectiveCamera(60, ASPECT, 0.05, 9000);
const MAX_FAR = 320;
const csm = new CSM({ camera, parent: new THREE.Scene(), cascades: 3, maxFar: MAX_FAR, mode: 'practical', shadowMapSize: 2048, lightDirection: new THREE.Vector3(0.3, -1, 0.2).normalize(), lightIntensity: 2, lightMargin: 150, lightNear: 1, lightFar: 150 + MAX_FAR });
csm.fade = true;
csm.updateFrustums();
/** Each shadow camera's depth by the game's own formula (`shadowCameraFar`, which `World.applyShadowQuality` uses): 'whole' ships (Q8), 'slice' the old depth. */
const setRange = (whole: boolean): void => {
  for (const l of csm.lights) {
    const w = l.shadow.camera.right - l.shadow.camera.left;
    l.shadow.camera.near = 1;
    l.shadow.camera.far = shadowCameraFar(whole ? 'whole' : 'slice', 150, MAX_FAR, w);
    l.shadow.camera.updateProjectionMatrix();
  }
};
setRange(true);
ok(csm.lights[2].shadow.camera.far > 900 && csm.lights[1].shadow.camera.far === 470 && csm.lights[0].shadow.camera.far === 470, `the depth that ships: the far map's range reaches its whole slice (${csm.lights[2].shadow.camera.far.toFixed(0)} m), the near and middle keep 470 m`);
{
  // CSMShader.js, written out from its text: cascade = CSM_cascades[i]; margin = 0.25 * pow(closestEdge, 2.0);
  // csmx = cascade.x - margin / 2.0; csmy = cascade.y + margin / 2.0; the last cascade has no csmy limit (its far end ours: the slice's).
  const span = Math.min(camera.far, MAX_FAR) - camera.near;
  const breaks = csm.breaks;
  const out = new Float64Array(2);
  let worst = 0;
  for (let i = 0; i < breaks.length; i++) {
    cascadeBand(breaks, Math.min(camera.far, MAX_FAR), camera.near, i, out);
    const x = i > 0 ? breaks[i - 1] : 0;
    const y = breaks[i];
    const csmx = x - (0.25 * x ** 2) / 2;
    const csmy = y + (0.25 * y ** 2) / 2;
    const near = Math.max(camera.near, csmx * span);
    const far = i === breaks.length - 1 ? y * span : csmy * span;
    worst = Math.max(worst, Math.abs(out[0] - near), Math.abs(out[1] - far));
  }
  ok(worst < 1e-9, `each cascade's band is the shader's csmx..csmy over the shadow distance, the last to its slice's end (off by ${worst})`);
  cascadeBand(breaks, Math.min(camera.far, MAX_FAR), camera.near, 1, out);
  ok(Math.abs(out[0] - 52.7) < 0.3 && Math.abs(out[1] - 120.5) < 0.3, `the middle band at the game's camera is 52.7 to 120.5 m (${out[0].toFixed(1)} to ${out[1].toFixed(1)})`);
  // The corners: at each distance the frustum's own corners, as a real camera unprojects them.
  camera.position.set(3, 2, -5);
  camera.rotation.set(-0.2, 1.1, 0.05, 'YXZ');
  camera.updateMatrixWorld();
  const corners = Array.from({ length: 8 }, () => new THREE.Vector3());
  const th = Math.tan(THREE.MathUtils.degToRad(30));
  bandCorners(camera.matrixWorld, th * ASPECT, th, 20, 90, corners);
  let off = 0;
  const ndc = new THREE.Vector3();
  for (const c of corners) {
    ndc.copy(c).project(camera);
    off = Math.max(off, Math.abs(Math.abs(ndc.x) - 1), Math.abs(Math.abs(ndc.y) - 1));
    const d = c.clone().applyMatrix4(camera.matrixWorldInverse).z;
    off = Math.max(off, Math.min(Math.abs(d + 20), Math.abs(d + 90)));
  }
  ok(off < 1e-6, `the band's eight corners are the real camera's own frustum corners at the band's two distances (off by ${off.toExponential(1)})`);
}

// ---- 3. Coverage against three's own fitting. ----
const SUNS: Record<string, THREE.Vector3> = {
  high: new THREE.Vector3(0.4, 0.82, -0.2).normalize(),
  noon: new THREE.Vector3(0.83, 0.51, -0.21).normalize(),
  low: new THREE.Vector3(0.96, 0.17, -0.2).normalize(),
};
const th = Math.tan(THREE.MathUtils.degToRad(30));
const tmp = new THREE.Vector3();
const inverseFor = (l: THREE.DirectionalLight, pos: THREE.Vector3, tgt: THREE.Vector3, out: THREE.Matrix4): THREE.Matrix4 => {
  l.position.copy(pos);
  l.target.position.copy(tgt);
  l.updateMatrixWorld();
  l.target.updateMatrixWorld();
  l.shadow.updateMatrices(l);
  return out.copy(l.shadow.camera.matrixWorldInverse);
};
const across = (inv: THREE.Matrix4, half: number, p: THREE.Vector3): number => (tmp.copy(p).applyMatrix4(inv), half - Math.max(Math.abs(tmp.x), Math.abs(tmp.y)));
const pose = (yawDeg: number, pitchDeg: number, z: number): void => {
  camera.position.set(0, 1.8, z);
  camera.rotation.set(THREE.MathUtils.degToRad(pitchDeg), THREE.MathUtils.degToRad(yawDeg), 0, 'YXZ');
  camera.updateMatrixWorld();
};
/** Ground samples (to 60 m up) between two distances along the view. */
const groundSamples = (zn: number, zf: number, out: THREE.Vector3[]): number => {
  let n = 0;
  for (let k = 0; k <= 10; k++) {
    const d = zn + ((zf - zn) * k) / 10;
    for (let a = 0; a <= 12; a++) {
      for (let b = 0; b <= 12; b++) {
        const p = out[n] ?? (out[n] = new THREE.Vector3());
        p.set((-1 + a / 6) * th * ASPECT * d, (-1 + b / 6) * th * d, -d).applyMatrix4(camera.matrixWorld);
        if (p.y >= -0.5 && p.y <= 60) n++;
      }
    }
  }
  return n;
};
{
  const samples: THREE.Vector3[] = [];
  const corners = Array.from({ length: 8 }, () => new THREE.Vector3());
  const band = new Float64Array(2);
  const heldInv = new THREE.Matrix4();
  const freshInv = new THREE.Matrix4();
  const heldPos = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const heldTgt = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const MOTIONS = [
    { name: 'standing', turn: 0, walk: 0 },
    { name: 'walking 6 m/s', turn: 0, walk: 6 },
    { name: 'riding 40 m/s', turn: 0, walk: 40 },
    { name: 'turning 15', turn: 15, walk: 0 },
    { name: 'turning 45', turn: 45, walk: 0 },
    { name: 'turning 90', turn: 90, walk: 0 },
    { name: 'turning 180', turn: 180, walk: 0 },
    { name: 'turning 360', turn: 360, walk: 0 },
  ];
  // The real `ShadowHold.decide`, asked the very same holds: its own copies of the guards (the light frames it writes out
  // by hand, the band and its corners off the view it reads, the sun's step, the depths) must answer what `holdCovers`
  // answers over three's own matrices, case by case, or a guard that every case below holds could be disconnected in
  // play with nothing failing.
  for (const l of csm.lights) l.shadow.map = {} as THREE.WebGLRenderTarget;
  const real = new ShadowHold();
  real.bind(csm.lights);
  const freshPos = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const freshTgt = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const expected: string[] = ['', '', ''];
  // How near each case's cover test stands to its own line: the least, over the band's corners, of the held box's spare
  // less what the rule asks of it. Three snaps every box to whole texels, so a held box very often stands exactly where the
  // fresh one does at some corner, and there the line is a tie that two ways of working the same matrix out (three's, and
  // `decide`'s own written out by hand, 1e-13 apart) may break either way: such a case is a tie, not a disagreement.
  const slack = [0, 0, 0];
  const coverSlack = (heldInv: THREE.Matrix4, freshInv: THREE.Matrix4, half: number, margin: number, cs: THREE.Vector3[]): number => {
    // The decisive corner's: the cover test refuses when the least of these is under nought.
    let least = Infinity;
    for (const c of cs) {
      const held = across(heldInv, half, c);
      const fresh = across(freshInv, half, c);
      least = Math.min(least, held - Math.min(margin, fresh));
    }
    return Math.abs(least);
  };
  let ties = 0;
  const run = (whole: boolean, coverDeep: number): { holds: number; passed: number; lostAcross: number; pastDeep: number; tooHigh: number; outer: number; freshPasses: boolean; reasons: Record<string, number>; decideAgrees: number; decideDiffers: string[]; ties: number } => {
    setRange(whole);
    const tune = { ...SHADOW_PASS_TUNE, coverDeep };
    // `decide` reads the live table: the same `coverDeep`, and ages long enough that only a guard draws a map.
    const keptDeep = SHADOW_PASS_TUNE.coverDeep;
    const keptAges = [...SHADOW_PASS_TUNE.maxAgeMs];
    SHADOW_PASS_TUNE.coverDeep = coverDeep;
    SHADOW_PASS_TUNE.maxAgeMs.splice(0, SHADOW_PASS_TUNE.maxAgeMs.length, 0, 1e9, 1e9);
    let holds = 0;
    let passed = 0;
    let lostAcross = 0;
    let pastDeep = 0;
    let tooHigh = 0;
    let outer = 0;
    let freshPasses = true;
    let decideAgrees = 0;
    ties = 0;
    const decideDiffers: string[] = [];
    const reasons: Record<string, number> = {};
    for (const sun of Object.values(SUNS)) {
      csm.lightDirection.copy(sun).negate();
      for (const fps of [30, 60, 144]) {
        for (const ageFrames of [1, 3, 7]) {
          const age = ageFrames / fps;
          for (const m of MOTIONS) {
            for (let yaw0 = 0; yaw0 < 360; yaw0 += 30) {
              for (const pitch of [-25, -10, 0]) {
                pose(yaw0 - m.turn * age, pitch, m.walk * age);
                csm.update();
                for (let i = 1; i < 3; i++) {
                  heldPos[i].copy(csm.lights[i].position);
                  heldTgt[i].copy(csm.lights[i].target.position);
                }
                // Every map drawn at this earlier pose, as `drawn` records a pass three drew.
                real.dirtyAll();
                real.decide(csm.lights, csm, camera, 0, null);
                for (const l of csm.lights) l.shadow.needsUpdate = false;
                real.drawn(csm.lights, true, false);
                pose(yaw0, pitch, 0);
                csm.update();
                for (let i = 0; i < 3; i++) {
                  freshPos[i].copy(csm.lights[i].position);
                  freshTgt[i].copy(csm.lights[i].target.position);
                }
                for (let i = 1; i < 3; i++) {
                  const l = csm.lights[i];
                  const fp = freshPos[i];
                  const ft = freshTgt[i];
                  const half = l.shadow.camera.right;
                  const far = l.shadow.camera.far;
                  inverseFor(l, fp, ft, freshInv);
                  inverseFor(l, heldPos[i], heldTgt[i], heldInv);
                  cascadeBand(csm.breaks, MAX_FAR, camera.near, i, band);
                  bandCorners(camera.matrixWorld, th * ASPECT, th, band[0], band[1], corners);
                  const heldDepth = heldPos[i].dot(sun);
                  const freshDepth = fp.dot(sun);
                  // A fresh fit always passes.
                  if (holdCovers(corners, freshInv, freshInv, half, sun, freshDepth, freshDepth, far, tune) !== '') freshPasses = false;
                  holds++;
                  const r = holdCovers(corners, heldInv, freshInv, half, sun, heldDepth, freshDepth, far, tune);
                  expected[i] = r || 'held';
                  slack[i] = coverSlack(heldInv, freshInv, half, tune.coverMargin, corners);
                  reasons[r || 'held'] = (reasons[r || 'held'] ?? 0) + 1;
                  if (r !== '') continue;
                  passed++;
                  if (freshDepth - heldDepth > tune.coverHigh + 1e-6) tooHigh++;
                  const n = groundSamples(band[0], band[1], samples);
                  for (let k = 0; k < n; k++) {
                    const p = samples[k];
                    if (across(freshInv, half, p) >= 0 && across(heldInv, half, p) < 0) lostAcross++;
                    const s = p.dot(sun);
                    const freshHolds = s >= freshDepth - far;
                    if (whole && coverDeep === 0) {
                      if (s < heldDepth - far - 1e-6) pastDeep++;
                    } else if (freshHolds && heldDepth - far - s > coverDeep + 1e-6) pastDeep++;
                  }
                  // The outer fade band of the last cascade (320 to 360 m), counted and not asserted.
                  if (i === 2) {
                    const m2 = groundSamples(MAX_FAR, MAX_FAR * 1.125, samples);
                    for (let k = 0; k < m2; k++) if (across(freshInv, half, samples[k]) >= 0 && across(heldInv, half, samples[k]) < 0) outer++;
                  }
                }
                // The real decide over the same hold: the fit as `csm.update` left it (the loop above moved the far
                // lights to work three's own matrices out), then its answer for each held cascade against holdCovers'.
                for (let i = 0; i < 3; i++) {
                  csm.lights[i].position.copy(freshPos[i]);
                  csm.lights[i].target.position.copy(freshTgt[i]);
                }
                real.decide(csm.lights, csm, camera, 10, null);
                for (let i = 1; i < 3; i++) {
                  const pair = `${real.reason[i]} ${expected[i]}`;
                  if (real.reason[i] === expected[i]) decideAgrees++;
                  else if ((pair === 'held cover' || pair === 'cover held') && slack[i] < 1e-6) {
                    decideAgrees++;
                    ties++;
                  } else if (decideDiffers.length < 6) decideDiffers.push(`cascade ${i}: decide ${real.reason[i]}, holdCovers ${expected[i]} (${slack[i].toExponential(1)} m off the line)`);
                }
              }
            }
          }
        }
      }
    }
    SHADOW_PASS_TUNE.coverDeep = keptDeep;
    SHADOW_PASS_TUNE.maxAgeMs.splice(0, SHADOW_PASS_TUNE.maxAgeMs.length, ...keptAges);
    setRange(true);
    return { holds, passed, lostAcross, pastDeep, tooHigh, outer, freshPasses, reasons, decideAgrees, decideDiffers, ties };
  };
  // What ships: every map's depth reaching its band (`farDepth` 'whole', Q8) and the deep guard exact (`coverDeep` 0).
  const shipped = run(true, SHADOW_PASS_TUNE.coverDeep);
  console.log(`     farDepth 'whole', coverDeep ${SHADOW_PASS_TUNE.coverDeep} (what ships): ${shipped.passed} of ${shipped.holds} holds pass (${Object.entries(shipped.reasons).map(([k, v]) => `${k} ${v}`).join(', ')}); the outer fade band past 320 m: ${shipped.outer} ground samples the fresh box holds and a passed hold does not (counted, not asserted)`);
  ok(SHADOW_PASS_TUNE.coverDeep === 0, 'the deep guard ships exact (coverDeep 0, the owner\'s Q8)');
  ok(shipped.freshPasses, 'a fresh fit always passes the guards');
  ok(shipped.passed > shipped.holds / 4, `the guards pass a good share of holds over every motion, rate, age and sun (${shipped.passed} of ${shipped.holds})`);
  ok(shipped.lostAcross === 0, `across the light, wherever a hold passes, every ground sample of the band the fresh box holds the held box holds (${shipped.lostAcross} lost)`);
  ok(shipped.pastDeep === 0, `in depth, no ground sample of the band lies past a passed hold's deep end at all (${shipped.pastDeep})`);
  ok(shipped.tooHigh === 0, `and the held light is never more than coverHigh nearer the slice (${shipped.tooHigh})`);
  ok(shipped.decideAgrees === shipped.holds && shipped.ties < shipped.holds / 200, `the real ShadowHold.decide answers every one of those holds as holdCovers does over three's own matrices (${shipped.decideAgrees} of ${shipped.holds}, ${shipped.ties} of them exact ties on the cover line${shipped.decideDiffers.length ? `: ${shipped.decideDiffers.join('; ')}` : ''})`);
  // The old depth, the `farDepth` switch's other value, with the deep guard the wave first had (10 m), to compare.
  const old = run(false, 10);
  console.log(`     farDepth 'slice', coverDeep 10 (the old depth): ${old.passed} of ${old.holds} holds pass (${Object.entries(old.reasons).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  ok(old.lostAcross === 0 && old.pastDeep === 0 && old.tooHigh === 0, `with the old depth no passed hold loses ground across the light, none lets a sample the fresh map holds fall more than coverDeep past its deep end, none stands more than coverHigh nearer (${old.lostAcross}, ${old.pastDeep}, ${old.tooHigh})`);
  ok(old.decideAgrees === old.holds && old.ties < old.holds / 200, `and decide answers those as holdCovers does too (${old.decideAgrees} of ${old.holds}, ${old.ties} exact ties${old.decideDiffers.length ? `: ${old.decideDiffers.join('; ')}` : ''})`);

  // The far cut-off the old depth left, a fact of three's fitting: the fresh far map leaves ground of its own slice past
  // its deep end on most headings across the sun, the middle map never; with the depth that ships, none at all.
  csm.lightDirection.copy(SUNS.noon).negate();
  const sunYaw = THREE.MathUtils.radToDeg(Math.atan2(-SUNS.noon.x, -SUNS.noon.z));
  const clips = (whole: boolean): { far: number; poses: number; mid: number } => {
    setRange(whole);
    let far = 0;
    let poses = 0;
    let mid = 0;
    for (const rel of [60, 75, 90, -60, -75, -90]) {
      for (const pitch of [-25, -10, 0]) {
        pose(sunYaw + rel, pitch, 0);
        csm.update();
        for (let i = 1; i < 3; i++) {
          const l = csm.lights[i];
          const deep = l.position.dot(SUNS.noon) - l.shadow.camera.far;
          const x = csm.breaks[i - 1] * MAX_FAR;
          const y = csm.breaks[i] * MAX_FAR;
          const n = groundSamples(x, y, samples);
          let clip = false;
          for (let k = 0; k < n; k++) if (samples[k].dot(SUNS.noon) < deep) clip = true;
          if (i === 2) {
            poses++;
            if (clip) far++;
          } else if (clip) mid++;
        }
      }
    }
    setRange(true);
    return { far, poses, mid };
  };
  const was = clips(false);
  ok(was.far > was.poses / 2 && was.mid === 0, `the old depth's cut-off: across the sun at noon the fresh far map left ground of its own slice past its deep end in ${was.far} of ${was.poses} poses, the middle map in ${was.mid} (if this fails, three's fitting or the range has changed)`);
  const now = clips(true);
  ok(now.far === 0 && now.mid === 0, `the depth that ships leaves none: ${now.far} of ${now.poses} poses for the far map, ${now.mid} for the middle (Q8)`);
}

// ---- 3b. The holds the guards must refuse, through the real `ShadowHold.decide`. ----
// Each case draws every map at a pose (as `drawn` records a pass three drew), moves the record the hold keeps for the far
// map as the case says, and asks `decide` for the same view: a held light carried far across the light is refused as
// `cover`, one moved far toward the sun (its map's deep end raised off the band) as `deep`, one moved toward the slice
// past `coverHigh` as `high`, one turned 0.3 degrees off the sun as `sun`; and a cascade asked and not drawn (three never
// cleared its `needsUpdate`) is `dirty` on the next frame.
{
  resetTune();
  setRange(true);
  for (const l of csm.lights) l.shadow.map = {} as THREE.WebGLRenderTarget;
  SHADOW_PASS_TUNE.maxAgeMs.splice(0, SHADOW_PASS_TUNE.maxAgeMs.length, 0, 1e9, 1e9);
  csm.lightDirection.copy(SUNS.noon).negate();
  const hold = new ShadowHold();
  hold.bind(csm.lights);
  const sun = SUNS.noon;
  const lightX = new THREE.Vector3();
  const lightY = new THREE.Vector3();
  new THREE.Matrix4().lookAt(new THREE.Vector3(), csm.lightDirection, new THREE.Vector3(0, 1, 0)).extractBasis(lightX, lightY, new THREE.Vector3());
  const drawAll = (): void => {
    pose(40, -10, 0);
    csm.update();
    hold.dirtyAll();
    hold.decide(csm.lights, csm, camera, 0, null);
    for (const l of csm.lights) l.shadow.needsUpdate = false;
    hold.drawn(csm.lights, true, false);
  };
  const ask = (move: (pos: THREE.Vector3, tgt: THREE.Vector3) => void): string => {
    drawAll();
    move(hold.pos[2], hold.tgt[2]);
    csm.update();
    hold.decide(csm.lights, csm, camera, 10, null);
    return hold.reason[2];
  };
  const unmoved = ask(() => {});
  const across = ask((p, t) => {
    const d = lightX.clone().multiplyScalar(300);
    p.add(d);
    t.add(d);
  });
  const deep = ask((p, t) => {
    const d = sun.clone().multiplyScalar(900);
    p.add(d);
    t.add(d);
  });
  const high = ask((p, t) => {
    const d = sun.clone().multiplyScalar(-(SHADOW_PASS_TUNE.coverHigh + 10));
    p.add(d);
    t.add(d);
  });
  const turned = ask((p, t) => {
    t.copy(p).add(csm.lightDirection.clone().applyAxisAngle(lightX, THREE.MathUtils.degToRad(0.3)));
  });
  ok(unmoved === 'held' && across === 'cover' && deep === 'deep' && high === 'high' && turned === 'sun', `decide refuses each by its own reason (unmoved ${unmoved}, carried 300 m across ${across}, 900 m toward the sun ${deep}, ${SHADOW_PASS_TUNE.coverHigh + 10} m toward the slice ${high}, turned 0.3 degrees ${turned})`);
  // A cascade asked for and not drawn: three left its needsUpdate standing.
  drawAll();
  csm.update();
  hold.dirtyAll();
  hold.decide(csm.lights, csm, camera, 20, null);
  for (let i = 0; i < 2; i++) csm.lights[i].shadow.needsUpdate = false;
  hold.drawn(csm.lights, true, false);
  csm.update();
  hold.decide(csm.lights, csm, camera, 30, null);
  ok(hold.reason[2] === 'dirty' && hold.reason[1] === 'held', `a cascade asked for and not drawn is dirty on the next frame, one drawn is held (${hold.reason.slice(0, 3).join(' ')})`);
  void lightY;
  resetTune();
}

// ---- 4. The schedule turning, through the real `ShadowHold.decide` at 144 Hz, held noon, 90 degrees a second. ----
// What ships (`farDepth` 'whole', `coverDeep` 0) is asserted; the old depth with the deep guard the wave first had (10 m)
// is run beside it to compare, and the old depth with the exact guard printed, which is why 'whole' is what makes 0 cheap.
{
  const turning = (whole: boolean, coverDeep: number): { draws: number[]; frames: number; why: Record<string, number> } => {
    resetTune();
    SHADOW_PASS_TUNE.coverDeep = coverDeep;
    setRange(whole);
    const lights = csm.lights;
    for (const l of lights) l.shadow.map = {} as THREE.WebGLRenderTarget;
    const hold = new ShadowHold();
    hold.bind(lights);
    const movers = new ShadowMovers();
    csm.lightDirection.copy(SUNS.noon).negate();
    const frames = 144 * 6;
    const draws = [0, 0, 0];
    const why: Record<string, number> = {};
    let yaw = 0;
    for (let f = 0; f < frames + 144; f++) {
      const now = (f * 1000) / 144;
      yaw += 90 / 144;
      pose(yaw, -10, 0);
      csm.update();
      hold.decide(lights, csm, camera, now, movers);
      for (let i = 0; i < 3; i++) {
        const s = lights[i].shadow;
        if (s.autoUpdate) {
          s.needsUpdate = false;
          if (f >= 144) draws[i]++;
        }
        if (f >= 144) why[hold.reason[i]] = (why[hold.reason[i]] ?? 0) + 1;
      }
      hold.drawn(lights, true, false);
    }
    resetTune();
    setRange(true);
    return { draws, frames, why };
  };
  const say = (label: string, r: { draws: number[]; frames: number; why: Record<string, number> }): string => `${label}: middle drawn on ${((100 * r.draws[1]) / r.frames).toFixed(0)}% of frames, far on ${((100 * r.draws[2]) / r.frames).toFixed(0)}% (${Object.entries(r.why).map(([k, v]) => `${k} ${v}`).join(', ')})`;
  const shipped = turning(true, 0);
  console.log(`     turning 90 degrees a second at 144 Hz, noon, ${say("farDepth 'whole', coverDeep 0 (what ships)", shipped)}`);
  ok(shipped.draws[0] === shipped.frames, 'the near map every frame');
  ok(shipped.draws[2] <= shipped.frames / 3 && shipped.draws[1] <= (2 * shipped.frames) / 3, `what ships draws the far map on at most one frame in three (${shipped.draws[2]} of ${shipped.frames}) and the middle on at most two in three (${shipped.draws[1]})`);
  const old = turning(false, 10);
  console.log(`     ${say("farDepth 'slice', coverDeep 10 (the old depth)", old)}`);
  ok(old.draws[2] <= old.frames / 3 && old.draws[1] <= (2 * old.frames) / 3, `the old depth with a 10 m deep guard, to compare, draws the far map on at most one frame in three too (${old.draws[2]} of ${old.frames})`);
  const exactOld = turning(false, 0);
  console.log(`     ${say("farDepth 'slice', coverDeep 0 (the old depth, guard exact)", exactOld)}`);
}

// ---- 5. The mover's reach. ----
{
  const cam = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const near = new Float64Array(2);
  const bands: [number, number][] = [];
  for (let i = 0; i < 3; i++) {
    cascadeBand(csm.breaks, MAX_FAR, camera.near, i, near);
    bands.push([near[0], near[1]]);
  }
  let underNear = 0;
  let underFar = 0;
  let poses = 0;
  for (const [name, sun] of Object.entries({ ...SUNS, ten: new THREE.Vector3(Math.cos(THREE.MathUtils.degToRad(10)), Math.sin(THREE.MathUtils.degToRad(10)), 0) })) {
    const tan = sun.y / Math.hypot(sun.x, sun.z);
    for (let h = 0; h < 360; h += 10) {
      const a = THREE.MathUtils.degToRad(h);
      // A 3 m hull (its middle 1.5 m over the ground, a radius of 1.5) under a camera 6 m behind it and 2.5 m up.
      fwd.set(-Math.sin(a), 0, -Math.cos(a));
      cam.set(Math.sin(a) * 6, 2.5, Math.cos(a) * 6);
      poses++;
      if (moverReaches(0, 1.5, 0, 1.5, 0, cam, fwd, tan, bands[0][0], bands[0][1], 470)) underNear++;
      if (moverReaches(0, 1.5, 0, 1.5, 0, cam, fwd, tan, bands[1][0], bands[1][1], 470) || moverReaches(0, 1.5, 0, 1.5, 0, cam, fwd, tan, bands[2][0], bands[2][1], 470)) {
        underFar++;
        console.log(`     the rider's own hull reached a far band (${name}, heading ${h})`);
      }
    }
  }
  ok(underNear === poses && underFar === 0, `a 3 m hull under a third-person camera reaches the near band on every heading under a high, a noon, a low and a 10-degree sun, and never the middle or far (${underNear} of ${poses}, ${underFar})`);
  fwd.set(0, 0, -1);
  cam.set(0, 2, 0);
  const tan = SUNS.noon.y / Math.hypot(SUNS.noon.x, SUNS.noon.z);
  ok(moverReaches(0, 1.5, -150, 1.5, 0, cam, fwd, tan, bands[2][0], bands[2][1], 470) && !moverReaches(0, 1.5, -150, 1.5, 0, cam, fwd, tan, bands[0][0], bands[0][1], 470), 'one 150 m ahead reaches the far band and not the near one');
  // A hull 100 m up over ground at 0, 20 m ahead: its shadow falls up to (100 + r) / tan from it, ahead or behind, so it
  // reaches every band that span meets along the view, and the answer is that arithmetic for each band.
  const upReach = Math.min(470, (100 + 3) / tan);
  const d = 20;
  const span = upReach + 3;
  let agrees = true;
  let reached = 0;
  for (const [n0, f0] of bands) {
    const want = d - span < f0 && d + span > n0;
    const got = moverReaches(0, 100, -20, 3, 0, cam, fwd, tan, n0, f0, 470);
    if (want !== got) agrees = false;
    if (got) reached++;
  }
  ok(agrees && reached === 3, `a hull 100 m up reaches the bands its shadow can fall in, all three here (${upReach.toFixed(0)} m of reach)`);
  ok(moverReaches(0, 1.5, -5, 1, Number.NaN, cam, fwd, tan, bands[2][0], bands[2][1], 470) && moverReaches(0, 1.5, -5, 1, Number.NaN, cam, fwd, tan, bands[1][0], bands[1][1], 470), 'a mover whose ground is unknown reaches every band (its reach taken as the cap)');
}

// ---- 6. The sun step. ----
{
  const a = new THREE.Vector3(0.3, -1, 0.2).normalize();
  const b = a.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(0.2));
  const c = a.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(0.3));
  ok(!sunMoved(a, b, 0.25) && sunMoved(a, c, 0.25) && !sunMoved(a, a.clone().multiplyScalar(3), 0.25), 'the sun step: 0.2 degrees holds, 0.3 does not, and a direction of another length is the same direction');
}

// ---- 7. The tune: clamps and refusals. ----
{
  resetTune();
  const words = tuneShadowPass({ maxAgeMs: { 2: 5000, 1: 33 }, coverDeep: -4, cadence: 'yes', nope: 1 } as Record<string, unknown>);
  ok(SHADOW_PASS_TUNE.maxAgeMs[1] === 33 && SHADOW_PASS_TUNE.maxAgeMs[2] === 1000 && SHADOW_PASS_TUNE.coverDeep === 0 && SHADOW_PASS_TUNE.cadence === true && words.length === 4, `an age as an object of indices, held at 1000; a number held at its range; a flag that is not one and a name it does not hold refused, each said (${words.join('; ')})`);
  tuneShadowPass({ maxAgeMs: [0, 0, 0] });
  ok(SHADOW_PASS_TUNE.maxAgeMs.join() === '0,0,0', 'an array sets every age');
  resetTune();
}

// ---- 8. Day one: the cadence off is today; `refreshCascadeBoxes` untouched since the wave's base. ----
{
  resetTune();
  SHADOW_PASS_TUNE.cadence = false;
  const lights = csm.lights;
  for (const l of lights) l.shadow.map = {} as THREE.WebGLRenderTarget;
  const hold = new ShadowHold();
  const movers = new ShadowMovers();
  csm.lightDirection.copy(SUNS.noon).negate();
  let allDue = true;
  let putBack = false;
  for (let f = 0; f < 200; f++) {
    pose(f * 1.7, -10, f * 0.3);
    csm.update();
    const fresh = lights.map((l) => l.position.clone());
    hold.decide(lights, csm, camera, f * 7, movers);
    for (let i = 0; i < 3; i++) {
      if (!lights[i].shadow.autoUpdate || hold.reason[i] === 'held') allDue = false;
      if (!lights[i].position.equals(fresh[i])) putBack = true;
      lights[i].shadow.needsUpdate = false;
    }
    hold.drawn(lights, true, false);
  }
  ok(allDue && !putBack, 'cadence off: every cascade due every frame, every light\'s autoUpdate true after every decide, and no pose ever put back');
  resetTune();
  const base = await atBase<{ refreshCascadeBoxes: typeof refreshCascadeBoxes }>('src/world/bodyCull.ts', 'c36a1ee');
  if (!base) console.log('skip the base\'s refreshCascadeBoxes out of git (git cannot answer here)');
  else {
    const a: THREE.Frustum[] = [];
    const b: THREE.Frustum[] = [];
    let differs = 0;
    for (let k = 0; k < 60; k++) {
      pose(k * 13, -20 + (k % 5) * 6, k * 2);
      csm.update();
      for (const l of lights) l.position.x += (k % 3) * 0.37;
      base.refreshCascadeBoxes(lights, a);
      refreshCascadeBoxes(lights, b);
      for (let i = 0; i < lights.length; i++) {
        for (let p = 0; p < 6; p++) {
          const pa = a[i].planes[p];
          const pb = b[i].planes[p];
          if (pa.constant !== pb.constant || !pa.normal.equals(pb.normal)) differs++;
        }
      }
    }
    ok(differs === 0, `refreshCascadeBoxes today gives the frusta the wave's base (c36a1ee, out of git) gave, plane for plane, over 60 light poses (${differs} differ)`);
  }
}

// ---- 9. The debug menu's dials: each moves its own number through the console's own setter, and the line keeps them. ----
{
  resetTune();
  const { SHADOW_DIALS, shadowDialsFor } = await import('../../../src/world/shadowDials.ts');
  const { allDials, dialMoved, movedLine, resetDials } = await import('../../../src/ui/dials.ts');
  ok(shadowDialsFor('shadowPass') === SHADOW_DIALS && shadowDialsFor('crowd') === null, 'the debug menu finds the shadow pass\'s sliders under `shadowPass` and nowhere else');
  const { SHADOW_SPLIT_TUNE } = await import('../../../src/world/shadowSplits.ts');
  const SPLITS0 = JSON.stringify(SHADOW_SPLIT_TUNE);
  const keys = allDials(SHADOW_DIALS).map((d) => d.key);
  ok(keys.join() === 'splits.nearReach,splits.midReach,splits.soft.0,splits.soft.1,splits.soft.2,tune.maxAgeMs.1,tune.maxAgeMs.2,tune.fastMover,tune.coverDeep', `the sliders are the numbers of the owner's eye and nothing else (${keys.join(', ')})`);
  // Both tables, flattened to one record of their own numbers, so a slider is caught moving a number of the other.
  const both = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(SHADOW_PASS_TUNE)) out[`tune.${k}`] = JSON.stringify(v);
    for (const [k, v] of Object.entries(SHADOW_SPLIT_TUNE)) out[`splits.${k}`] = JSON.stringify(v);
    return out;
  };
  const strays: string[] = [];
  for (const d of allDials(SHADOW_DIALS)) {
    if (d.kind !== 'number') continue;
    resetDials(SHADOW_DIALS);
    const was = both();
    const v = d.get() === d.max ? d.min : d.max;
    d.set(v);
    const after = both();
    const moved = Object.keys(after).filter((k) => after[k] !== was[k]);
    if (d.get() !== v || moved.length !== 1 || !d.key.startsWith(moved[0]) || !dialMoved(SHADOW_DIALS, d)) strays.push(`${d.key} (${moved.join(', ')})`);
  }
  ok(strays.length === 0, `each slider moves its own number and no other (${strays.join('; ') || 'all'})`);
  resetDials(SHADOW_DIALS);
  allDials(SHADOW_DIALS).find((d) => d.key === 'tune.maxAgeMs.2')!.set(100);
  const line = movedLine(SHADOW_DIALS);
  ok(line === '__debug.shadowPass({ tune: { maxAgeMs: { 2: 100 } } })', `the line that keeps them is the console's own (${line})`);
  resetDials(SHADOW_DIALS);
  allDials(SHADOW_DIALS).find((d) => d.key === 'splits.nearReach')!.set(24);
  const splitLine = movedLine(SHADOW_DIALS);
  ok(splitLine === '__debug.shadowPass({ splits: { nearReach: 24 } })', `and a split's line is the console's own too (${splitLine})`);
  resetDials(SHADOW_DIALS);
  ok(JSON.stringify(SHADOW_PASS_TUNE.maxAgeMs) === JSON.stringify(TUNE0.maxAgeMs) && SHADOW_PASS_TUNE.fastMover === TUNE0.fastMover && SHADOW_PASS_TUNE.coverDeep === TUNE0.coverDeep && JSON.stringify(SHADOW_SPLIT_TUNE) === SPLITS0, 'Reset all puts every number back where it shipped, the splits included');
  // The line, pasted back, sets exactly that.
  tuneShadowPass({ maxAgeMs: { 2: 100 } });
  ok(SHADOW_PASS_TUNE.maxAgeMs.join() === '0,13,100', 'and the line pasted back sets exactly that');
  resetTune();
}

console.log(`\n${checks} checks passed`);
