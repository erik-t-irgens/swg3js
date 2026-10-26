// The volumetrics' clouds (the seventh wave's second half, the design's §14c): the feed (`airCloudsFeed.ts`), the holes'
// processor half (`airCloudHoles.ts`) and the pass (`airClouds.ts`), built in node under plain type stripping. Held here:
//
//   1. the drift integrated: an hour of a wind aloft that gusts and changes level, at 60 and 144 frames a second with the
//      streets on, moves every feature of the slab's frame and of each deck's pictures at its deck's own wind, at every
//      distance out to 20 km, followed through the programs' own reads run from their text (the march's `highBaseAt` and
//      `highDetailAt`, the weather pass's `alphaOf` through `pictureUv` and `streetOf`), signed, both picture phases;
//   2. each deck's wind the world's aloft (an area crossed changes no deck's speed), the slab's frame one, the bottom and
//      top pictures each at their own wind; every reader's fold (each deck's base, detail and hole read, run from the
//      march's text) moving no reader, signed;
//   3. the hole field, through the tick's own program (`holeTexel` and its rules) and the march's own read (`holeAt`): a
//      fold while a hole is open leaves it where it was and whole (the first cut's fold at 4,200 m read at 1,024 m wiped
//      it: the control), a capsule across the seam stamps exactly the texels its falloff covers, the toroidal clear when the
//      square moves and a stamp made in that tick landing where it was made, the fill alike at 60, 144 and 240 frames a
//      second and exactly the keep it is handed, each channel read by its own deck's offset, a friend's ride and a stood
//      shuttle's jet holing the low deck, the keep exactly one at h nought, the fine steps' box opened by a stamp and closed
//      by `liveFor`, and a ray walked by the march's own walk (`startAt`, `stepAt`, `fineAt`, `growAfter`) taking fine steps
//      across a box narrower than a full step on every jitter, a ray outside it stepping as before;
//   4. the feed: two rows blended by weight give the weighted coverage, a rain row with no sheet adds the overcast layer, a
//      dust storm's sunless row adds none, a loading picture adds nothing; the kind from the picture's spread; a clouds.json
//      with no `pictures` read as heaps at its coverage; the smear's phases cross-fade continuously and a restart carries
//      no weight; the smear's displacement held under its most by the programs' own `capped` and `capLen`; the weather
//      pass's `cutOf` and `deckOf` over the feed's own records; `cutFor` in the shader text against `cutForCover`;
//   4b. the low deck: Q22's rule, its floor over the eased ground, its wind and its frame's drift;
//   5. the dome's own uniform objects in the march by reference, so a row with no gradient lights the decks by its clear
//      colour; the calibration worker's curve equal to `coverCurve`'s on the same bytes, its answers taken in the order
//      they were asked;
//   6. the pass: the September's four bugs kept out, and a refusal in words for every one of §2.18's, which the game's
//      question before the scene is drawn (`wouldDraw`) shares.
//
// What node cannot compile, `__debug.clouds()` and the driven tab check in the browser (`W7b-notes.md`; the fix round's
// `scratch\w7bfix\compile.js` links all seven programs on both backends and draws the hole tick against its script).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { AIR_CLOUD_FRAGMENTS, AirCloudsPass } from '../../../src/core/fx/airClouds.ts';
import { AirCloudsFeed, cloudPicturesOf, cutForCurve, foldAt, layeredOfPicture, PictureImage, streetOf, wetOvercast, type CloudPictures, type CloudsSky } from '../../../src/world/volumetrics/airCloudsFeed.ts';
import { CloudHoles, HOLE_TICK, type CloudHull } from '../../../src/world/volumetrics/airCloudHoles.ts';
import { AIR_TUNE } from '../../../src/world/volumetrics/airTune.ts';
import { newVolTune, type VolTune } from '../../../src/world/volumetrics/volSettings.ts';
import { COVER_CUTS, coverCurve, cutForCover, CUT_FOR_GLSL, type CoverPoint } from '../../../src/core/fx/cloudMath.ts';
import { createContext } from '../../../src/core/fx/context.ts';
import { WIND_TUNE } from '../../../src/world/wind.ts';
import { FX_DEFAULTS, type FxSettings } from '../../../src/core/fxRegistry.ts';
import { glslFunctions, glslFunctionText } from './glslRun.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const here = dirname(fileURLToPath(import.meta.url));
const source = (p: string): string => readFileSync(join(here, '..', '..', '..', 'src', p), 'utf8').replace(/\r\n/g, '\n');
const f32 = Math.fround;
const t0 = performance.now();
const WIND_TUNE_ALOFT = WIND_TUNE.aloft;

// --- a stand-in sky: the feed's whole view of `SwgSky` ---
class StandInSky implements CloudsSky {
  mixLength = 1;
  mixWeights = new Float64Array([1, 0, 0, 0]);
  mixBlock(): null {
    return null;
  }
  lighting = { windSpeedScale: 3, shadowScale: 1, bounce: new THREE.Color(0.2, 0.2, 0.2), bounceScale: 1, ambient: new THREE.Color(0.3, 0.3, 0.35), ambientScale: 1 };
  sheetAloft = new Float64Array([8, 12, 0.2]);
  sheetAloftOn = true;
  domeUniforms = {
    uGradient: { value: null as THREE.Texture | null },
    uGradient2: { value: null as THREE.Texture | null },
    uGradientMix: { value: 0 },
    uTime: { value: 0.5 },
    uHasGradient: { value: 0 },
    uHasGradient2: { value: 0 },
    uClear: { value: new THREE.Color(0.42, 0.55, 0.71) },
  };
  /** Each deck's two images as the test sets them. */
  readonly decks: [PictureImage, PictureImage][] = [
    [new PictureImage(), new PictureImage()],
    [new PictureImage(), new PictureImage()],
  ];
  cloudImages(slot: 0 | 1, out: { readonly images: readonly [PictureImage, PictureImage] }): void {
    for (let m = 0; m < 2; m++) {
      const a = this.decks[slot][m];
      const b = out.images[m];
      b.file = a.file;
      b.weight = a.weight;
      b.size = a.size;
      b.speed = a.speed;
      b.repeat = a.repeat;
      b.texture = a.texture;
      b.scrollX = a.scrollX;
      b.scrollY = a.scrollY;
      b.scrolled = a.scrolled;
    }
  }
}
function image(file: string | null, weight: number, repeat: number, loaded = true): PictureImage {
  const im = new PictureImage();
  im.file = file;
  im.weight = weight;
  im.repeat = repeat;
  im.size = repeat / 105;
  im.texture = file && loaded ? new THREE.Texture() : null;
  im.scrolled = false;
  im.scrollX = 0;
  im.scrollY = 0;
  return im;
}
const PICTURES: CloudPictures = cloudPicturesOf({
  pictures: 2,
  tiles: {
    'heaps.png': { coverage: 0.2, spread: 0.6, brightness: 0.72, colour: [230, 232, 240] },
    'veil.png': { coverage: 0.5, spread: 0.1, brightness: 0.6, colour: [200, 205, 215] },
    'storm.png': { coverage: 0.8, spread: 0.2, brightness: 0.3, colour: [90, 95, 100] },
  },
})!;
function tuneOn(): VolTune {
  const t = newVolTune();
  t.on = true;
  t.clouds = true;
  t.cloudsSmear = true;
  t.cloudsLow = false;
  t.cloudsHoles = false;
  t.cloudsWeather = 512;
  t.cloudsSteps = 48;
  t.cloudsLight = 4;
  t.cloudsAmount = 1;
  t.cloudsBright = 1;
  t.cloudsArt = 1;
  t.cloudSheets = 0;
  return t;
}
function feedWith(sky: StandInSky): AirCloudsFeed {
  const f = new AirCloudsFeed();
  f.input.sky = sky;
  f.input.pictures = PICTURES;
  f.input.weatherOn = true;
  f.input.heading = 0.7;
  f.input.travel = 6;
  f.input.rain = 0;
  f.input.snow = 0;
  f.input.dust = 0;
  f.input.windClock = 0;
  f.input.camX = 0;
  f.input.camY = 2;
  f.input.camZ = 0;
  return f;
}

// The programs' own reads, run as script (`glslRun.ts`) over the feed's live uniform records: what the tests follow a
// feature through, so a sign or a period wrong in the GLSL fails here rather than only a feed that agrees with the test.
const V2 = (x: number, y: number): { x: number; y: number } => ({ x, y });
const V3 = (x: number, y: number, z: number): { x: number; y: number; z: number } => ({ x, y, z });
type XY = { x: number; y: number };
type XYZ = { x: number; y: number; z: number };
/** The weather pass's own picture read (`alphaOf` through `pictureUv` and `streetOf`): each call records where each phase's picture was read, phase A first. */
function pictureReads(U: AirCloudsFeed['weatherU']): { reads: XY[]; alphaOf: (...a: unknown[]) => number } {
  const reads: XY[] = [];
  const fns = glslFunctions(['streetOf', 'pictureUv', 'alphaOf'].map((n) => glslFunctionText(AIR_CLOUD_FRAGMENTS.weather, n)).join('\n'), ['alphaOf'], {
    vec2: V2,
    uSlabU: U.uSlabU.value,
    uSmearW: U.uSmearW.value,
    textureSize: () => V2(256, 256),
    textureLod: (_p: unknown, uv: XY) => {
      reads.push(uv);
      return { a: 0.5 };
    },
  });
  return { reads, alphaOf: fns.alphaOf };
}
/** The march's own volume coordinates over the march's live records (the base's and the detail's, each deck's). */
function volumeReads(M: AirCloudsFeed['marchU']): Record<'highBaseAt' | 'highDetailAt' | 'lowBaseAt' | 'lowDetailAt', (p: XYZ, d?: XY) => XYZ> {
  const names = ['highBaseAt', 'highDetailAt', 'lowBaseAt', 'lowDetailAt'];
  return glslFunctions(names.map((n) => glslFunctionText(AIR_CLOUD_FRAGMENTS.march, n)).join('\n'), names, { vec3: V3, uDriftH: M.uDriftH.value, uDriftL: M.uDriftL.value, uScale: M.uScale.value }) as unknown as Record<'highBaseAt' | 'highDetailAt' | 'lowBaseAt' | 'lowDetailAt', (p: XYZ, d?: XY) => XYZ>;
}

// --- 1. the drift integrated, an hour at 60 and 144 frames a second, with a level change and the streets on ---
{
  const bs = AIR_TUNE.clouds.baseScale;
  const ds = AIR_TUNE.clouds.detailScale;
  const wrap = (v: number, p: number): number => v - p * Math.round(v / p);
  const H = 0.7;
  const dist = [0, 1000, 5000, 20000];
  const zero = V2(0, 0);
  const run = (fps: number) => {
    const sky = new StandInSky();
    sky.decks[0][0] = image('heaps.png', 1, 945);
    sky.decks[1][0] = image('veil.png', 1, 1190);
    const f = feedWith(sky);
    f.input.heading = H;
    const t = tuneOn();
    const dt = 1 / fps;
    const U = f.weatherU;
    const pic = pictureReads(U);
    const vol = volumeReads(f.marchU);
    let worst3d = 0;
    let worstBase = 0;
    let worstDetail = 0;
    let worstPicA = 0;
    let worstPicB = 0;
    let followedA = 0;
    let followedB = 0;
    let worstSept = 0;
    let worstFirst = 0;
    let windows = 0;
    let restartsA = 0;
    let restartsB = 0;
    let restartWeight = 0;
    let folds = 0;
    let lastFold = foldAt(0, bs);
    // The September: its offset a time times the wind of the moment, in single precision (an illustration).
    let septTime = 0;
    let septStart = { x: 0, z: 0 };
    // Each distance's feature: where it stood at the window's start.
    const pts = dist.map((d) => ({ x: d * Math.sin(H + 1.3), z: d * Math.cos(H + 1.3) }));
    // The slab's and the bottom deck's winds summed over the window, metres (each deck's own record).
    let wSlab = { x: 0, z: 0 };
    let wDeck = { x: 0, z: 0 };
    // What each feature read at the window's start: the slab frame's base and detail coordinates, each phase's picture.
    const start = pts.map(() => ({ base: V3(0, 0, 0), detail: V3(0, 0, 0), a: V2(0, 0), b: V2(0, 0) }));
    let validA = false;
    let validB = false;
    // The processor's single-precision follow of the slab frame (the folded offset's precision).
    let D3 = new THREE.Vector4();
    // The first cut: each distance's feature along the frame's heading, and what the wind moved it over the window (an
    // illustration of the stretch the design turned down).
    const firstAt = dist.map((d) => d);
    const firstStart = dist.map((d) => d);
    let firstWant = 0;
    let s0 = 1;
    let dPrev = { x: 0, z: 0 };
    const readStart = (): void => {
      for (let i = 0; i < pts.length; i++) {
        const p = V3(pts[i].x, 0, pts[i].z);
        start[i].base = vol.highBaseAt(p);
        start[i].detail = vol.highDetailAt(p, zero);
        pic.reads.length = 0;
        pic.alphaOf(null, V2(p.x, p.z), U.uImgB0.value, U.uScrB0.value, U.uStrBA.value, U.uStrBB.value, zero, zero);
        start[i].a = pic.reads[0];
        start[i].b = pic.reads[1];
      }
      wSlab = { x: 0, z: 0 };
      wDeck = { x: 0, z: 0 };
      validA = true;
      validB = true;
    };
    for (let k = 0, n = 3600 * fps; k < n; k++) {
      const time = k * dt;
      // The wind aloft: a gust over a minute and a level change at the half hour.
      const vb = (time < 1800 ? 8 : 16) + 2 * Math.sin(time / 60);
      sky.sheetAloft[0] = vb;
      sky.sheetAloft[1] = vb * 1.4;
      sky.sheetAloft[2] = 0.2;
      f.input.dt = dt;
      const strA0 = U.uStrBA.value.clone();
      const strB0 = U.uStrBB.value.clone();
      f.update(t);
      const su = U.uSlabU.value;
      const du = U.uDeckU.value;
      // The September's offset and the first cut's stretch about the frame's origin, worked out of the same winds.
      septTime += dt;
      const vm = Math.hypot(su.x, su.y);
      const s1 = 1 + AIR_TUNE.clouds.stretch * vm;
      if (k === 0) {
        s0 = s1;
        dPrev = { x: f.dhx, z: f.dhz };
        D3 = f.marchU.uDriftH.value.clone();
        readStart();
        continue;
      }
      wSlab = { x: wSlab.x + su.x * dt, z: wSlab.z + su.y * dt };
      wDeck = { x: wDeck.x + du.x * dt, z: wDeck.z + du.y * dt };
      // Each phase's pictures followed while its streets stand; a restart weighs nothing.
      const stA = U.uStrBA.value;
      const stB = U.uStrBB.value;
      if (!stA.equals(strA0)) {
        restartsA++;
        restartWeight = Math.max(restartWeight, U.uSmearW.value.z);
        validA = false;
      }
      if (!stB.equals(strB0)) {
        restartsB++;
        restartWeight = Math.max(restartWeight, 1 - U.uSmearW.value.z);
        validB = false;
      }
      const fh = Math.sin(H + 0.1);
      const fc = Math.cos(H + 0.1);
      const dA0 = dPrev.x * fh + dPrev.z * fc;
      const dA1 = f.dhx * fh + f.dhz * fc;
      for (let i = 0; i < dist.length; i++) firstAt[i] = ((firstAt[i] + dA0) / s0) * s1 - dA1;
      firstWant += -(dA1 - dA0);
      s0 = s1;
      dPrev = { x: f.dhx, z: f.dhz };
      // Folds crossed.
      const fl = foldAt(f.dhx, bs);
      if (Math.abs(fl - lastFold) > bs / 2) folds++;
      lastFold = fl;
      // A window a second: each feature, carried by its deck's wind summed from its own record, must read where it read
      // at the window's start -- through the march's own coordinates and the weather pass's own picture read.
      if (k % fps === 0) {
        windows++;
        const D1 = f.marchU.uDriftH.value;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          // The processor's single-precision follow (the folded offset's precision at 20 km).
          const cx = f32(f32(p.x) + f32(D3.x));
          const cz = f32(f32(p.z) + f32(D3.y));
          const ax = p.x + wrap(cx - f32(D1.x) - p.x, bs);
          const az = p.z + wrap(cz - f32(D1.y) - p.z, bs);
          worst3d = Math.max(worst3d, Math.hypot(ax - p.x - wSlab.x, az - p.z - wSlab.z));
          // The march's own coordinates, signed: the feature carried downwind reads the same texel of each volume.
          const q = V3(p.x + wSlab.x, 0, p.z + wSlab.z);
          const b1 = vol.highBaseAt(q);
          const d1 = vol.highDetailAt(q, zero);
          worstBase = Math.max(worstBase, Math.hypot(wrap(b1.x - start[i].base.x, 1), wrap(b1.z - start[i].base.z, 1)) * bs);
          worstDetail = Math.max(worstDetail, Math.hypot(wrap(d1.x - start[i].detail.x, 1), wrap(d1.z - start[i].detail.z, 1)) * ds);
          // The weather pass's own picture read, each phase whose streets stood the whole window.
          const r = sky.decks[0][0].repeat;
          pic.reads.length = 0;
          pic.alphaOf(null, V2(p.x + wDeck.x, p.z + wDeck.z), U.uImgB0.value, U.uScrB0.value, U.uStrBA.value, U.uStrBB.value, zero, zero);
          if (validA) {
            worstPicA = Math.max(worstPicA, Math.hypot(wrap(pic.reads[0].x - start[i].a.x, 1), wrap(pic.reads[0].y - start[i].a.y, 1)) * r);
            followedA++;
          }
          if (validB) {
            worstPicB = Math.max(worstPicB, Math.hypot(wrap(pic.reads[1].x - start[i].b.x, 1), wrap(pic.reads[1].y - start[i].b.y, 1)) * r);
            followedB++;
          }
        }
        D3 = D1.clone();
        readStart();
        // The September: δ = d0·T0 − d1·T1 over the window, against the wind summed.
        const sx = -Math.sin(H + 0.1) * vm;
        const sz = -Math.cos(H + 0.1) * vm;
        const now = { x: f32(f32(sx) * f32(septTime)), z: f32(f32(sz) * f32(septTime)) };
        if (k > fps) worstSept = Math.max(worstSept, Math.abs(Math.hypot(septStart.x - now.x, septStart.z - now.z) - Math.hypot(sx, sz)));
        septStart = now;
        for (let i = 0; i < dist.length; i++) {
          if (dist[i] >= 20000) worstFirst = Math.max(worstFirst, Math.abs(firstAt[i] - firstStart[i] - firstWant));
          firstStart[i] = firstAt[i];
        }
        firstWant = 0;
      }
    }
    return { worst3d, worstBase, worstDetail, worstPicA, worstPicB, followedA, followedB, worstSept, worstFirst, windows, restartsA, restartsB, restartWeight, folds };
  };
  for (const fps of [60, 144]) {
    const r = run(fps);
    ok(r.windows >= 3599 && r.folds >= 3 && r.worst3d < 0.02, `${fps} fps, an hour with a level change: the slab frame's offset, folded and in single precision, carries every feature at 0, 1, 5 and 20 km at the slab's wind over every second, within ${r.worst3d.toFixed(4)} m (${r.folds} folds of the base's period crossed)`);
    ok(r.worstBase < 1e-3 && r.worstDetail < 1e-3, `${fps} fps: the march's own base and detail coordinates (highBaseAt, highDetailAt, run from its text) read the same texel of each volume for every feature carried downwind at the slab's wind, out to 20 km (${r.worstBase.toExponential(2)} and ${r.worstDetail.toExponential(2)} m)`);
    ok(r.followedA > 1000 && r.followedB > 1000 && r.worstPicA < 1e-3 && r.worstPicB < 1e-3, `${fps} fps: the weather pass's own picture read (alphaOf through pictureUv and streetOf, run from its text), each phase with its streets on, reads the same place of the bottom deck's picture for every feature carried at that deck's own wind out to 20 km (${r.worstPicA.toExponential(2)} and ${r.worstPicB.toExponential(2)} m over ${r.followedA} and ${r.followedB} follows)`);
    ok(r.restartsA > 0 && r.restartsB > 0 && r.restartWeight <= (2 / fps / AIR_TUNE.clouds.smearPeriod) * 2 + 1e-9, `${fps} fps: each phase's streets restart only while it weighs nothing (${r.restartsA} and ${r.restartsB} restarts, at most ${r.restartWeight.toExponential(2)})`);
    console.log(`note an illustration of the formulas the design turned down, worked out of the same winds (not a check): the September's time-times-speed offset runs its deck ${r.worstSept.toFixed(0)} m a second off the wind, and the first cut's stretch of the base about the frame's origin moves a feature 20 km out ${r.worstFirst.toFixed(1)} m a second off it`);
  }
}

// --- 2. each deck's wind the world's; the slab's frame one; each deck's pictures at its own wind; the folds ---
{
  const sky = new StandInSky();
  sky.decks[0][0] = image('heaps.png', 1, 945);
  sky.decks[1][0] = image('veil.png', 1, 1190);
  const f = feedWith(sky);
  const t = tuneOn();
  f.input.dt = 1 / 60;
  f.update(t);
  const du0 = f.weatherU.uDeckU.value.clone();
  const su0 = f.weatherU.uSlabU.value.clone();
  // An area crossed: the sky's own scale and its rows' pictures change, the world's wind aloft does not.
  sky.lighting.windSpeedScale = 11;
  sky.decks[0][0] = image('storm.png', 0.6, 700);
  sky.decks[0][1] = image('heaps.png', 0.4, 945);
  f.update(t);
  const du1 = f.weatherU.uDeckU.value;
  ok(du0.equals(du1) && su0.x === f.weatherU.uSlabU.value.x && su0.y === f.weatherU.uSlabU.value.y, "an area crossed (the sky's own wind scale and its pictures moved) changes no deck's wind: each is the world's wind aloft");
  const vb = Math.hypot(du1.x, du1.y);
  const vt = Math.hypot(du1.z, du1.w);
  const vs = Math.hypot(f.weatherU.uSlabU.value.x, f.weatherU.uSlabU.value.y);
  ok(Object.is(vb, Math.hypot(Math.sin(0.7) * 8, Math.cos(0.7) * 8)) && Math.abs(vt - 12) < 1e-9 && Math.abs(vs - 10) < 1e-9, `the bottom deck takes the wind aloft's ${vb.toFixed(2)} m/s, the top its own ${vt.toFixed(2)}, and the slab's one frame their mean (${vs.toFixed(2)})`);
  // With the sheets handed no wind aloft (the arm off and nothing held), the world's travel times the factors, floored.
  sky.sheetAloftOn = false;
  f.input.travel = 10;
  f.update(t);
  const A = { bottom: 0, top: 0 };
  const d = f.weatherU.uDeckU.value;
  A.bottom = Math.hypot(d.x, d.y);
  A.top = Math.hypot(d.z, d.w);
  ok(A.bottom > 0 && A.top > A.bottom, `with no wind aloft written the decks take the world's travel times their own factors (${A.bottom.toFixed(2)} and ${A.top.toFixed(2)} m/s), never the sky's own scale`);
  sky.sheetAloftOn = true;
  // The pictures' scrolls each at their own deck's wind: one frame's move of each, in metres.
  const before = { b: f.weatherU.uScrB0.value.clone(), t: f.weatherU.uScrT0.value.clone() };
  f.input.dt = 0.25;
  f.update(t);
  const mv = (a: THREE.Vector4, b: THREE.Vector4, r: number): number => {
    const w = (v: number) => v - Math.round(v);
    return Math.hypot(w(b.x - a.x), w(b.y - a.y)) * r;
  };
  const mb = mv(before.b, f.weatherU.uScrB0.value, 700);
  const mt = mv(before.t, f.weatherU.uScrT0.value, 1190);
  ok(mb > 0 && mt > mb, `each deck's pictures scroll at their own wind (the bottom's ${(mb / 0.25).toFixed(2)} m/s through its streets, the top's ${(mt / 0.25).toFixed(2)})`);
  // The folds: every reader of each deck's frame -- the march's base and detail coordinates and its hole read, the high
  // slab's and the low deck's, each run from the march's own text over the feed's live records -- read at a point either
  // side of a fold, signed: a reader's coordinate moves by exactly its own deck's wind a frame, never by a period, never
  // the other way. The low deck's periods are the high slab's times its scale and its hole offsets the low deck's.
  const sky2 = new StandInSky();
  sky2.decks[0][0] = image('heaps.png', 1, 945);
  sky2.sheetAloft[0] = 30;
  sky2.sheetAloft[1] = 30;
  sky2.sheetAloft[2] = 0;
  const g = feedWith(sky2);
  const tl = tuneOn();
  tl.cloudsLow = true;
  tl.cloudsHoles = true;
  g.input.lowForce = true;
  // The live records the readers see, single precision as the card is handed them (a copy written before each read).
  const M = g.marchU;
  const drift = { h: new THREE.Vector4(), l: new THREE.Vector4(), o: new THREE.Vector4() };
  const fold = glslFunctions(['highBaseAt', 'highDetailAt', 'lowBaseAt', 'lowDetailAt', 'holeAt'].map((n) => glslFunctionText(AIR_CLOUD_FRAGMENTS.march, n)).join('\n'), ['highBaseAt', 'highDetailAt', 'lowBaseAt', 'lowDetailAt', 'holeAt'], {
    vec2: V2,
    vec3: V3,
    uDriftH: drift.h,
    uDriftL: drift.l,
    uScale: M.uScale.value,
    uHoleOff: drift.o,
    uHoleP: M.uHoleP.value,
    uCamera: V3(3000, 0, 0),
    uHoles: null,
    // A stand-in field that hands back where it was read: the hole read's coordinate.
    textureLod: (_t: unknown, uv: XY) => ({ r: uv.x, g: uv.x }),
  }) as unknown as Record<string, (...a: unknown[]) => XYZ & number>;
  const p = V3(3000, 0, 0);
  const z0 = V2(0, 0);
  const bsz = AIR_TUNE.clouds.baseScale;
  const dsz = AIR_TUNE.clouds.detailScale;
  const lsc = AIR_TUNE.lowDeck.scale;
  const hsz = AIR_TUNE.holes.size;
  // Each reader: its period in metres, its coordinate's share of the period now, the offset it folds, its deck's wind along x.
  const readers: [string, number, () => number, () => number, () => number][] = [
    ['high slab base', bsz, () => fold.highBaseAt(p).x, () => M.uDriftH.value.x, () => g.weatherU.uSlabU.value.x],
    ['high slab detail', dsz, () => fold.highDetailAt(p, z0).x, () => M.uDriftH.value.z, () => g.weatherU.uSlabU.value.x],
    ['high slab holes', hsz, () => fold.holeAt(p, 1), () => M.uHoleOff.value.z, () => g.weatherU.uSlabU.value.x],
    ['low deck base', bsz * lsc, () => fold.lowBaseAt(p).x, () => M.uDriftL.value.x, () => g.lowWindU.uLowU.value.x],
    ['low deck detail', dsz * lsc, () => fold.lowDetailAt(p, z0).x, () => M.uDriftL.value.z, () => g.lowWindU.uLowU.value.x],
    ['low deck holes', hsz, () => fold.holeAt(p, 0), () => M.uHoleOff.value.x, () => g.lowWindU.uLowU.value.x],
  ];
  const copyIn = (): void => {
    const h = M.uDriftH.value;
    const l = M.uDriftL.value;
    const o = M.uHoleOff.value;
    drift.h.set(f32(h.x), f32(h.y), f32(h.z), f32(h.w));
    drift.l.set(f32(l.x), f32(l.y), f32(l.z), f32(l.w));
    drift.o.set(f32(o.x), f32(o.y), f32(o.z), f32(o.w));
  };
  g.input.heading = Math.PI / 2;
  g.input.dt = 1 / 60;
  const seen = readers.map(() => ({ crossed: 0, worst: 0 }));
  copyIn();
  let prevC = readers.map(([, , read]) => read());
  let prevO = readers.map(([, , , off]) => off());
  for (let k = 0; k < 60 * 300; k++) {
    g.update(tl);
    copyIn();
    for (let i = 0; i < readers.length; i++) {
      const [, per, read, off, wind] = readers[i];
      const c = read();
      const o = off();
      let dc = c - prevC[i];
      dc -= Math.round(dc);
      // Signed: the frame's offset fell by its deck's wind, so a fixed point's coordinate falls by as much.
      seen[i].worst = Math.max(seen[i].worst, Math.abs(dc * per + wind() / 60));
      if (Math.abs(o - prevO[i]) > per / 2) seen[i].crossed++;
      prevC[i] = c;
      prevO[i] = o;
    }
  }
  const lowWind = g.lowWindU.uLowU.value.x;
  for (let i = 0; i < readers.length; i++) {
    const s = seen[i];
    ok(s.crossed > 0 && s.worst < 0.01, `the ${readers[i][0]} read (run from the march's text) across its fold of ${readers[i][1]} m, crossed ${s.crossed} times in five minutes: a fixed point's coordinate falls by exactly its deck's wind a frame, within ${s.worst.toExponential(2)} m (single-precision offsets)`);
  }
  ok(lowWind > 0 && Math.abs(lowWind - g.weatherU.uSlabU.value.x) > 1, `the low deck's frame (${lowWind.toFixed(2)} m/s) and the high slab's (${g.weatherU.uSlabU.value.x.toFixed(2)}) differ here, so a reader handed the other deck's offset is caught`);
}

// --- 3. the hole field ---
// The tick's own program run texel by texel at a smaller field (`holeTexel` and every rule it calls, run from the program's
// own text, `glslRun.ts`), its output stored in single precision as the card stores it; and the march's own read of the
// field (`holeAt`, run from the march's text). A field read is its nearest texel, wrapped, as the tick reads it at texel
// centres and the march at the field's own repeat.
type Field = { field: Float32Array; n: number };
const fieldTap = (t: Field, uv: XY): { r: number; g: number } => {
  const n = t.n;
  const i = ((Math.floor(uv.x * n) % n) + n) % n;
  const j = ((Math.floor(uv.y * n) % n) + n) % n;
  return { r: t.field[(j * n + i) * 2], g: t.field[(j * n + i) * 2 + 1] };
};
const v4o = (): { x: number; y: number; z: number; w: number } => ({ x: 0, y: 0, z: 0, w: 0 });
const HOLE_ENV = {
  uPrev: { field: new Float32Array(0), n: 0 } as Field,
  uH: v4o(),
  uSqL: v4o(),
  uSqH: v4o(),
  uMove: v4o(),
  uCap: Array.from({ length: 64 }, v4o),
  textureSize: (t: Field) => V2(t.n, t.n),
  texture: fieldTap,
  vec2: V2,
};
const HOLE_FNS = glslFunctions(['wrapC', 'segDist', 'holeFill', 'holeKept', 'holeStamp', 'holeTexel'].map((n) => glslFunctionText(AIR_CLOUD_FRAGMENTS.holes, n)).join('\n'), ['holeTexel', 'holeStamp', 'segDist'], HOLE_ENV);
const holeTexel = HOLE_FNS.holeTexel as unknown as (u: number, v: number) => XY;
const HU = { H: new Float32Array(4), SL: new Float32Array(4), SH: new Float32Array(4), MV: new Float32Array(4), cap: new Float32Array(256) };
const copy4 = (a: Float32Array, o: { x: number; y: number; z: number; w: number }, at = 0): void => {
  o.x = a[at];
  o.y = a[at + 1];
  o.z = a[at + 2];
  o.w = a[at + 3];
};
/** A tick the holes owe drawn through the program's own text, as the pass draws it (`prepareTick`, then the tick, then `drawn`). */
function drawTick(holes: CloudHoles, field: Float32Array, n = 128): Float32Array {
  if (!holes.prepareTick(HU.H, HU.SL, HU.SH, HU.MV, HU.cap)) return field;
  const E = HOLE_ENV;
  copy4(HU.H, E.uH);
  copy4(HU.SL, E.uSqL);
  copy4(HU.SH, E.uSqH);
  copy4(HU.MV, E.uMove);
  for (let i = 0; i < 64; i++) copy4(HU.cap, E.uCap[i], i * 4);
  E.uPrev.field = field;
  E.uPrev.n = n;
  const out = new Float32Array(n * n * 2);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const h = holeTexel((i + 0.5) / n, (j + 0.5) / n);
      out[(j * n + i) * 2] = h.x;
      out[(j * n + i) * 2 + 1] = h.y;
    }
  }
  holes.drawn();
  return out;
}
/** The march's own hole read (`holeAt`, run from its text) at a world point: the camera, the offsets and the field handed as the feed and the pass hand them. */
const MARCH_HOLE = { uCamera: V3(0, 0, 0), uHoleOff: v4o(), uHoleP: { x: AIR_TUNE.holes.size, y: AIR_TUNE.holes.edge, z: 0, w: 0 }, uHoles: { field: new Float32Array(0), n: 0 } as Field };
const marchHoleAt = glslFunctions(glslFunctionText(AIR_CLOUD_FRAGMENTS.march, 'holeAt'), ['holeAt'], { ...MARCH_HOLE, vec2: V2, textureLod: fieldTap }).holeAt as unknown as (p: XYZ, ch: number) => number;
/** The march's read at world (x, z) in a channel, the camera at (camX, camZ), the channel's frame offset unwrapped (folded at the field's size as the feed folds it). */
function holeRead(field: Float32Array, n: number, camX: number, camZ: number, x: number, z: number, offX: number, offZ: number, ch: number): number {
  const size = AIR_TUNE.holes.size;
  MARCH_HOLE.uCamera.x = camX;
  MARCH_HOLE.uCamera.z = camZ;
  const o = MARCH_HOLE.uHoleOff;
  o.x = ch === 0 ? foldAt(offX, size) : 0;
  o.y = ch === 0 ? foldAt(offZ, size) : 0;
  o.z = ch === 1 ? foldAt(offX, size) : 0;
  o.w = ch === 1 ? foldAt(offZ, size) : 0;
  MARCH_HOLE.uHoles.field = field;
  MARCH_HOLE.uHoles.n = n;
  return marchHoleAt(V3(x, 0, z), ch);
}
/** The raw texel a world point's frame point lands on (what the tick wrote there, inside the square or out of it). */
function texelAt(field: Float32Array, n: number, x: number, z: number, offX: number, offZ: number, ch: number): number {
  const size = AIR_TUNE.holes.size;
  const t = fieldTap({ field, n }, V2((x + foldAt(offX, size)) / size - Math.floor((x + foldAt(offX, size)) / size), (z + foldAt(offZ, size)) / size - Math.floor((z + foldAt(offZ, size)) / size)));
  return ch === 0 ? t.r : t.g;
}
const N = 128;
/** A stand-in hull: shown, airborne, of a radius, at a place the test moves. */
function hull(id: number, x: number, y: number, z: number, radius = 10): CloudHull & { pos: { x: number; y: number; z: number } } {
  return { group: { visible: true, id }, spec: { fly: { floor: 1.5 } }, airborne: true, altitude: 300, pos: { x, y, z }, radius };
}
{
  // A fold while a hole is open: the deck's frame offset runs across a multiple of the field's 1,024 m and of the base's
  // 4,200 m while the hole fills; the hole stays where it was punched in the drifting deck, and whole.
  const run = (firstCut: boolean) => {
    const holes = new CloudHoles();
    holes.camX = 0;
    holes.camZ = 0;
    holes.low.on = true;
    holes.low.bottom = 200;
    holes.low.top = 380;
    holes.high.on = false;
    let field = new Float32Array(N * N * 2);
    const h = hull(7, 0, 300, 0);
    // Two ticks over the deck: the second stamps a capsule.
    let D = 4200 - 30;
    holes.low.dx = firstCut ? foldAt(D, 4200) : D;
    holes.step(HOLE_TICK + 1e-6, [h], null, null);
    field = drawTick(holes, field);
    h.pos.x = 1;
    holes.step(HOLE_TICK, [h], null, null);
    field = drawTick(holes, field);
    // The hull leaves; the deck drifts 60 m in a second, across the folds.
    h.pos.y = 5000;
    const at = { x: 0.5, z: 0 };
    const v0 = holeRead(field, N, 0, 0, at.x, at.z, holes.low.dx, holes.low.dz, 0);
    for (let k = 0; k < 20; k++) {
      D += 3;
      at.x -= 3;
      holes.low.dx = firstCut ? foldAt(D, 4200) : D;
      holes.step(HOLE_TICK, [h], null, null);
      field = drawTick(holes, field);
    }
    return { v0, v1: holeRead(field, N, 0, 0, at.x, at.z, firstCut ? foldAt(D, 4200) : D, 0, 0) };
  };
  const ours = run(false);
  const first = run(true);
  const keep = Math.exp((-HOLE_TICK * 20) / AIR_TUNE.holes.fill);
  ok(ours.v0 > 0.9 && ours.v1 > ours.v0 * keep * 0.95, `a hole open while its deck's offset folds at 4,200 m (and at 1,024): still where it was punched in the drifting deck, ${ours.v1.toFixed(3)} of it after two seconds' fill (${(ours.v0 * keep).toFixed(3)} by the fill alone)`);
  ok(first.v0 > 0.9 && first.v1 < 0.05, `the control: the first cut's offset folded at 4,200 m and read at 1,024 m moves the square at the fold and wipes the hole (${first.v1.toFixed(3)} left)`);
}
{
  // A capsule across the field's seam stamps whole: the same capsule either side of a multiple of 1,024 m sets as many texels.
  const size = AIR_TUNE.holes.size;
  const stamped = (offset: number): number => {
    const holes = new CloudHoles();
    holes.camX = offset;
    holes.camZ = 0;
    holes.low.on = true;
    holes.low.bottom = 200;
    holes.low.top = 380;
    holes.low.dx = 0;
    holes.low.dz = 0;
    let field = new Float32Array(N * N * 2);
    holes.punchAt(offset - 40, 300, 0, 30);
    holes.punchAt(offset + 40, 300, 0, 30);
    field = drawTick(holes, field);
    let n = 0;
    for (let i = 0; i < N * N; i++) if (field[i * 2] > 0.5) n++;
    return n;
  };
  // The same capsule 296 m on (a whole number of texels, so it lies on the grid alike), clear of the seam.
  const across = stamped(size * 3);
  const inside = stamped(size * 3 + 296);
  // Half strength six tenths of the way through the falloff: the capsule's 80 m by 2 · 24 m with its two round ends, in
  // texels of the field's metres (the stamp's own falloff, never a width the test chose).
  const texel = size / N;
  let want = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const rx = (i + 0.5) * texel - size * Math.round(((i + 0.5) * texel) / size);
      const rz = (j + 0.5) * texel - size * Math.round(((j + 0.5) * texel) / size);
      if (Math.min(Math.hypot(rx + 40, rz), Math.hypot(rx - 40, rz)) < 24) want++;
    }
  }
  ok(across === inside && across === want, `a stamp across the field's seam sets every texel it would anywhere else (${across} against ${inside}), exactly the texels whose middles lie within half strength of its two points (${want}: six tenths to the whole of a 30 m radius)`);
  // The stamp's own falloff, from the program's text: whole within six tenths of its radius, none past it, half at 0.8.
  const stamp = HOLE_FNS.holeStamp as unknown as (...a: number[]) => number;
  let falloff = true;
  for (let d = 0; d <= 40; d += 0.25) {
    const v = stamp(d, 0, 0, -10, 0, 10, 30, 1);
    const wantV = d <= 18 ? 1 : d >= 30 ? 0 : 1 - (((d - 18) / 12) ** 2) * (3 - (2 * (d - 18)) / 12);
    if (Math.abs(v - wantV) > 1e-12) falloff = false;
  }
  ok(falloff && stamp(0, 5, 0, -10, 0, 10, 30, 0.7) === 0.7,"the tick's stamp (holeStamp, run from its text) is its strength within six tenths of its radius of the capsule's segment, nought past the radius, and smooth between");
  // The toroidal clear: the camera moves 300 m; what left the square is cleared, what stayed is kept, and a stamp made in
  // the very tick of the move lands where it was made.
  const holes = new CloudHoles();
  holes.camX = 0;
  holes.camZ = 0;
  holes.low.on = true;
  holes.low.bottom = 200;
  holes.low.top = 380;
  let field = new Float32Array(N * N * 2);
  holes.punchAt(-450, 300, 0, 40);
  holes.punchAt(100, 300, 0, 40);
  field = drawTick(holes, field);
  const westBefore = texelAt(field, N, -450, 0, 0, 0, 0);
  const keptBefore = holeRead(field, N, 0, 0, 100, 0, 0, 0, 0);
  holes.camX = 300;
  holes.punchAt(250, 300, -100, 40);
  field = drawTick(holes, field);
  const west = texelAt(field, N, -450, 0, 0, 0, 0);
  const kept = holeRead(field, N, 300, 0, 100, 0, 0, 0, 0);
  const moved = holeRead(field, N, 300, 0, 250, -100, 0, 0, 0);
  const notThere = holeRead(field, N, 300, 0, -50, -100, 0, 0, 0);
  ok(westBefore > 0.9 && keptBefore > 0.9 && west === 0 && kept > 0.9, `the square moved 300 m: a hole that left it is cleared (its texel stands for new ground: ${west}), one still in it is kept where the march reads it (${kept.toFixed(3)})`);
  ok(moved > 0.9 && notThere === 0, `a stamp made in the tick the square moved lands where it was made, in this tick's square (${moved.toFixed(3)} there, ${notThere} at the last tick's place)`);
}
{
  // The march reads each channel by its own deck's offset, the feed's own records: the low deck's hole where the low deck
  // drifts, the high slab's where the slab does, at two frames hundreds of metres apart.
  const sky = new StandInSky();
  sky.decks[0][0] = image('heaps.png', 1, 945);
  const f = feedWith(sky);
  const t = tuneOn();
  t.cloudsLow = true;
  t.cloudsHoles = true;
  f.input.lowForce = true;
  f.input.dt = 0;
  f.dlx = 1913.25;
  f.dlz = -377.5;
  f.dhx = -611.75;
  f.dhz = 2489;
  f.update(t);
  const holes = f.holes;
  const lowY = 0.5 * (holes.low.bottom + holes.low.top);
  ok(holes.low.on && holes.high.on && holes.low.dx === f.dlx && holes.high.dx === f.dhx, "the feed hands the holes each deck's band and its own frame's offset");
  holes.punchAt(60, lowY, 40, 30);
  holes.punchAt(-80, 1900, -30, 30);
  let field = new Float32Array(N * N * 2);
  field = drawTick(holes, field);
  // The march's read with the feed's own hole offsets (folded at the field's size by the feed, not the test).
  const o = f.marchU.uHoleOff.value;
  MARCH_HOLE.uCamera.x = f.input.camX;
  MARCH_HOLE.uCamera.z = f.input.camZ;
  MARCH_HOLE.uHoleOff.x = o.x;
  MARCH_HOLE.uHoleOff.y = o.y;
  MARCH_HOLE.uHoleOff.z = o.z;
  MARCH_HOLE.uHoleOff.w = o.w;
  MARCH_HOLE.uHoles.field = field;
  MARCH_HOLE.uHoles.n = N;
  const lowHere = marchHoleAt(V3(60, lowY, 40), 0);
  const highHere = marchHoleAt(V3(-80, 1900, -30), 1);
  const lowThere = marchHoleAt(V3(-80, lowY, -30), 0);
  const highThere = marchHoleAt(V3(60, 1900, 40), 1);
  ok(lowHere > 0.9 && highHere > 0.9 && lowThere < 0.05 && highThere < 0.05, `the march (holeAt, run from its text) reads the low deck's hole by the low deck's offset (${lowHere.toFixed(3)}) and the slab's by the slab's (${highHere.toFixed(3)}), and neither where the other was punched (${lowThere.toFixed(3)}, ${highThere.toFixed(3)})`);
  // Punched by what the world hands the holes besides its own hulls: another player's ride and a stood shuttle's jet, each
  // stamping where it flew through the low deck; a ride on foot (kind nought) punches nothing, and a hull alone stamps
  // only where it is.
  const rides = { n: 2, x: Float64Array.of(150, -260), y: Float64Array.of(lowY, lowY), z: Float64Array.of(0, 200), half: Float64Array.of(4, 4), key: Float64Array.of(7, 8), kind: Uint8Array.of(1, 0) };
  const jets = { n: 1, x: Float64Array.of(-200), y: Float64Array.of(lowY - 10), z: Float64Array.of(-150), key: Float64Array.of(3) };
  const lone = hull(41, 330, lowY, 330);
  holes.reset();
  holes.dtIn = HOLE_TICK + 1e-6;
  holes.stepKept([lone], rides, jets);
  rides.x[0] = 160;
  rides.x[1] = -250;
  lone.pos.x = 340;
  holes.dtIn = HOLE_TICK;
  holes.stepKept([lone], rides, jets);
  field = drawTick(holes, new Float32Array(N * N * 2));
  MARCH_HOLE.uHoles.field = field;
  const ride = marchHoleAt(V3(155, lowY, 0), 0);
  const jet = marchHoleAt(V3(-200, lowY, -150), 0);
  const onFoot = marchHoleAt(V3(-255, lowY, 200), 0);
  const hullHole = marchHoleAt(V3(335, lowY, 330), 0);
  ok(ride > 0.9 && jet > 0.9 && onFoot < 0.05 && hullHole > 0.9, `another player's ride (${ride.toFixed(3)}) and a stood shuttle's jet (${jet.toFixed(3)}) each hole the low deck where they flew, a ride on foot does not (${onFoot.toFixed(3)}), and the world's own hull holes it where it flew (${hullHole.toFixed(3)})`);
  holes.reset();
  holes.dtIn = HOLE_TICK + 1e-6;
  holes.stepKept([lone], null, null);
  lone.pos.x = 350;
  holes.dtIn = HOLE_TICK;
  holes.stepKept([lone], null, null);
  field = drawTick(holes, new Float32Array(N * N * 2));
  MARCH_HOLE.uHoles.field = field;
  ok(marchHoleAt(V3(155, lowY, 0), 0) < 0.05 && marchHoleAt(V3(-200, lowY, -150), 0) < 0.05 && marchHoleAt(V3(345, lowY, 330), 0) > 0.9, 'with no rides and no jets handed over, the hull stands in for neither: only its own place is holed');
}
{
  // The fill alike at 60, 144 and 240 frames a second on the 10 Hz clock, through the tick's own program (a smaller field:
  // the hole's middle stands well inside it).
  const n = 64;
  const fill = (fps: number): { value: number; keep: number } => {
    const holes = new CloudHoles();
    holes.camX = 0;
    holes.camZ = 0;
    holes.low.on = true;
    holes.low.bottom = 200;
    holes.low.top = 380;
    let field = new Float32Array(n * n * 2);
    holes.punchAt(0, 300, 0, 60);
    field = drawTick(holes, field, n);
    const dt = 1 / fps;
    // The keep the field was handed over every tick it drew, multiplied as the card multiplies it (single precision).
    let keep = 1;
    for (let k = 0; k * dt < 20.05; k++) {
      holes.step(dt, [], null, null);
      if (holes.ticksOwed > 0) keep = f32(keep * f32(Math.exp((-HOLE_TICK * holes.ticksOwed) / AIR_TUNE.holes.fill)));
      field = drawTick(holes, field, n);
    }
    return { value: holeRead(field, n, 0, 0, 0, 0, 0, 0, 0), keep };
  };
  const a = fill(60);
  const b = fill(144);
  const c = fill(240);
  ok(a.value > 0.3 && Math.abs(a.value - b.value) < 1e-6 && Math.abs(a.value - c.value) < 1e-6, `a hole fills alike at 60, 144 and 240 frames a second (${a.value.toFixed(6)}, ${b.value.toFixed(6)}, ${c.value.toFixed(6)} after 20 s)`);
  // With no blur the hole's middle is its stamp times exactly the keep over every tick: the tick's own fill, by the clock.
  const blurWas = AIR_TUNE.holes.blur;
  AIR_TUNE.holes.blur = 0;
  let sharp: { value: number; keep: number };
  try {
    sharp = fill(60);
  } finally {
    AIR_TUNE.holes.blur = blurWas;
  }
  const byClock = Math.exp(-20 / AIR_TUNE.holes.fill);
  ok(Math.abs(sharp.value - sharp.keep) < 1e-6 && Math.abs(sharp.value - byClock) < 0.01, `with no blur a hole's middle fills by exactly the keep the tick is handed (${sharp.value.toFixed(6)} against ${sharp.keep.toFixed(6)}), which is the fill's own clock (${byClock.toFixed(4)} after 20 s at ${AIR_TUNE.holes.fill} s)`);
  // The keep exactly one at h nought, the march's own function run.
  const keepFn = glslFunctions(glslFunctionText(AIR_CLOUD_FRAGMENTS.march, 'holeKeep'), ['holeKeep'], { uHoleP: { x: 1024, y: 32, z: AIR_TUNE.holes.edgeLift, w: AIR_TUNE.holes.edgeSoft } }).holeKeep as unknown as (h: number, n: number) => number;
  let one = true;
  for (let n = 0; n <= 1.0001; n += 0.01) if (!Object.is(keepFn(0, n), 1)) one = false;
  ok(one && keepFn(1, 0.5) < 1e-9 && keepFn(0.5, 0.9) > 0 && keepFn(0.5, 0.9) <= 1, 'the march keeps exactly one of a sample at h nought (Object.is, every detail value), none at a full hole over a mean detail, and closes raggedly in between');
}
{
  // The fine steps' box: a stamp opens it, `liveFor` closes it, a ray outside it steps as before.
  const holes = new CloudHoles();
  holes.camX = 0;
  holes.camZ = 0;
  holes.low.on = true;
  holes.low.bottom = 200;
  holes.low.top = 380;
  holes.low.dx = 1234.5;
  const lo = new Float32Array(4);
  const hi = new Float32Array(4);
  const step = new Float32Array(2);
  holes.liveBoxes(lo, hi, step);
  const closed = lo[0] > lo[2] && step[0] === 0;
  holes.punchAt(50, 300, -20, 30);
  holes.liveBoxes(lo, hi, step);
  const open = lo[0] <= 50 - 30 + 1e-3 && lo[2] >= 50 + 30 - 1e-3 && lo[1] <= -50 + 1e-3 && lo[3] >= 10 - 1e-3 && step[0] === Math.max(15, AIR_TUNE.holes.fineStep);
  for (let k = 0; k * 0.5 < AIR_TUNE.holes.liveFor + 1; k++) holes.step(0.5, [], null, null);
  holes.liveBoxes(lo, hi, step);
  ok(closed && open && lo[0] > lo[2] && step[0] === 0 && hi[0] > hi[2], `a stamp opens its deck's live box in the world round the hole (fine steps of ${Math.max(15, AIR_TUNE.holes.fineStep)} m), and ${AIR_TUNE.holes.liveFor} s after its last stamp it is shut`);
  // The march's walk, its four rules run from its own text (`startAt`, `stepAt`, `fineAt`, `growAfter`), and the march's
  // loop pinned to them as text below: a ray walked through a deck as `marchDeck` walks it.
  const M = AIR_CLOUD_FRAGMENTS.march;
  const walkNames = ['startAt', 'stepAt', 'fineAt', 'growAfter'];
  const smear2 = { x: 0, y: 0, z: AIR_TUNE.clouds.stepGrow, w: AIR_TUNE.clouds.stepMost };
  const walkOf = (text: string) => glslFunctions(walkNames.map((nm) => glslFunctionText(text, nm)).join('\n'), walkNames, { uSmear2: smear2 }) as unknown as Record<'startAt' | 'stepAt' | 'fineAt' | 'growAfter', (...a: number[]) => number>;
  const W = walkOf(M);
  /** A ray walked from ta to tb in `steps` full steps (the march's loop's own control), the box [fa, fb]; the fine samples and every sample's place. */
  const walk = (w: typeof W, ta: number, tb: number, steps: number, jitter: number, fa: number, fb: number, fineLen: number, fineMost: number, shapeAt: (t: number) => number): { fine: number[]; all: number[] } => {
    const stepLen = (tb - ta) / steps;
    let fineLeft = fineMost;
    let t = w.startAt(ta, stepLen, jitter, fa, fb, fineLen, fineLeft);
    let grow = 1;
    let full = 0;
    const fine: number[] = [];
    const all: number[] = [];
    for (let i = 0; i < 128 + 32; i++) {
      if (t > tb) break;
      const fineF = w.fineAt(t, fa, fb, fineLeft);
      const sl = w.stepAt(t, fa, fb, fineLen, fineLeft, stepLen * grow);
      if (!(fineF > 0.5)) {
        if (full >= steps) break;
        full += 1;
      }
      all.push(t);
      if (fineF > 0.5) fine.push(t);
      grow = w.growAfter(grow, shapeAt(t), fineF);
      if (fineF > 0.5) fineLeft -= 1;
      t += sl;
    }
    return { fine, all };
  };
  // The chase view at the low deck's height: a level ray through the deck (16 steps over its 6 km reach, 375 m each), a
  // ship's hole 180 m ahead (radius 60: the box 120 to 240 m, fine steps of 30 m), every jitter the march's own pattern
  // gives and a thousand more; cloud everywhere, and empty sky before the box in a second pass.
  const LD = AIR_TUNE.lowDeck;
  const fineLen = Math.max(AIR_TUNE.holes.fineStep, 30);
  const jitters = [...Array.from({ length: 16 }, (_, b) => (b + 0.5) / 16), ...Array.from({ length: 1000 }, (_, i) => i / 1000)];
  let worstMissed = 0;
  let worstSpacing = 0;
  let fewest = Infinity;
  for (const shape of [() => 1, (tt: number) => (tt < 100 ? 0 : 1)]) {
    for (const j of jitters) {
      const r = walk(W, 0, LD.reach, LD.steps, j, 120, 240, fineLen, AIR_TUNE.holes.fineMost, shape);
      if (!r.fine.length) worstMissed++;
      fewest = Math.min(fewest, r.fine.length);
      for (let i = 1; i < r.fine.length; i++) worstSpacing = Math.max(worstSpacing, r.fine[i] - r.fine[i - 1]);
    }
  }
  // The control: the same walk with the step's cut and the start's own taken back out of the program's text (the first cut's
  // rules) misses the box on most jitters.
  const oldText = M.replace('if (t < fa) return min(full, fa - t + 0.01 * fineLen);', '').replace('if (fineLen > 0.0 && fineLeft > 0.0 && fa <= fb) t = min(t, fa + fineLen * jitter);', '');
  const old = walkOf(oldText);
  let oldMissed = 0;
  for (const j of jitters) if (!walk(old, 0, LD.reach, LD.steps, j, 120, 240, fineLen, AIR_TUNE.holes.fineMost, () => 1).fine.length) oldMissed++;
  ok(oldText !== M && worstMissed === 0 && fewest >= Math.floor(120 / fineLen) && worstSpacing <= fineLen + 1e-9, `a ray across a live hole's box narrower than one full step (120 m against 375) takes fine steps on every jitter (at least ${fewest}, never more than ${fineLen} m apart), with cloud before it or none; the first cut's rules missed it on ${oldMissed} of ${jitters.length}`);
  ok(oldMissed > jitters.length / 2, `the control: walked by the first cut's rules (no cut at the box, the start jittered past it), ${((100 * oldMissed) / jitters.length).toFixed(0)}% of the rays step over the box`);
  // The growth: a sample only a fade emptied is still cloud and keeps the step; an empty one grows it; a fine one leaves it.
  ok(W.growAfter(2.56, 0.4, 0) === 1 && W.growAfter(1, 0, 0) === AIR_TUNE.clouds.stepGrow && W.growAfter(AIR_TUNE.clouds.stepMost, 0, 0) === AIR_TUNE.clouds.stepMost && W.growAfter(2.56, 0, 1) === 2.56 && W.growAfter(2.56, 1, 1) === 2.56, 'the step grows only over empty deck (never over a sample only the near or the reach fade emptied), to its most, and a fine sample leaves it as it was');
  // A ray outside every live box walks exactly as before: the start and the step the old rules' to the bit.
  let asBefore = true;
  for (const full of [12.5, 33.3, 104]) {
    for (const tt of [0, 50, 800, 4000]) {
      if (!Object.is(W.stepAt(tt, 1e9, -1e9, 5, 32, full), full) || !Object.is(W.stepAt(tt, 100, 200, 5, 0, full), full)) asBefore = false;
      if (!Object.is(W.startAt(tt, full, 0.37, 1e9, -1e9, 5, 32), tt + full * 0.37) || !Object.is(W.startAt(tt, full, 0.37, 100, 200, 5, 0), tt + full * 0.37)) asBefore = false;
    }
  }
  ok(asBefore && W.stepAt(150, 100, 200, 5, 3, 40) === 5 && W.fineAt(150, 100, 200, 3) === 1 && W.fineAt(150, 100, 200, 0) === 0, 'a ray outside every live box (or with no fine steps left) starts and steps exactly as before (Object.is), and one inside takes the fine step while it has fine steps left');
  // The march's loop walks by these very rules, in this order (the text the walk above stands for).
  const loop = M.slice(M.indexOf('void marchDeck('), M.indexOf('void main()'));
  ok(
    loop.includes('float t = startAt(ta, stepLen, jitter, fa, fb, fineLen, fineLeft);') &&
      /float fineF = fineAt\(t, fa, fb, fineLeft\);\n\s+bool fine = fineF > 0\.5;\n\s+float sl = stepAt\(t, fa, fb, fineLen, fineLeft, stepLen \* grow\);\n\s+if \(!fine\) \{\n\s+if \(full >= steps\) break;\n\s+full \+= 1\.0;/.test(loop) &&
      loop.indexOf('float shape = d;') > loop.indexOf('if (hv > 0.0) d *= holeKeep(hv, n);') &&
      loop.indexOf('float shape = d;') < loop.indexOf('if (slab == 0) d *= 1.0 - smoothstep(uLow.w * (1.0 - uLowP.y), uLow.w, t);') &&
      loop.indexOf('float shape = d;') < loop.indexOf('if (uNear.y > uNear.x) d *= smoothstep(uNear.x, uNear.y, t);') &&
      /grow = growAfter\(grow, shape, fineF\);\n\s+if \(fine\) \{\n\s+fineLeft -= 1\.0;\n\s+fineSince \+= 1\.0;\n\s+\}\n\s+t \+= sl;/.test(loop),
    "the march's loop walks by startAt, fineAt, stepAt and growAfter in the order the walk above runs them, the growth reading the deck's density before the reach and near fades"
  );
}

// --- 4. the feed ---
{
  // Two rows blended by weight: the weighted coverage a deck.
  const sky = new StandInSky();
  sky.decks[0][0] = image('heaps.png', 0.7, 945);
  sky.decks[0][1] = image('storm.png', 0.3, 700);
  const f = feedWith(sky);
  const t = tuneOn();
  f.input.dt = 1 / 60;
  f.update(t);
  const g = AIR_TUNE.clouds.gain;
  const want = 0.7 * Math.min(0.2 * g, 1) + 0.3 * Math.min(0.8 * g, 1);
  ok(Math.abs(f.coverBottom - want) < 1e-12 && f.weatherU.uImgB0.value.y === 0.7 && f.weatherU.uImgB1.value.y === 0.3, `two rows blended by weight give the deck their weighted coverage (${f.coverBottom.toFixed(3)}), each image at its own weight`);
  // A loading picture adds nothing.
  sky.decks[0][1] = image('storm.png', 0.3, 700, false);
  f.update(t);
  ok(Math.abs(f.coverBottom - 0.7 * Math.min(0.2 * g, 1)) < 1e-12 && f.weatherU.uImgB1.value.y === 0 && f.pictures[1] === null, 'a picture still loading adds nothing (weight nought, no picture bound: never the white stand-in a sheet binds)');
  // A rain row with no sheet adds the overcast layer; a dust storm's sunless row adds none.
  const rain = new StandInSky();
  const fr = feedWith(rain);
  fr.input.rain = 1;
  fr.input.dt = 1 / 60;
  fr.update(t);
  ok(fr.overcast === 1 && fr.weatherU.uOver.value.z === 1 && fr.weatherU.uOver.value.w === 1 && fr.coverBottom > 0.9 && fr.why === null, `a rain row hanging no sheet adds the wet overcast's layer to both decks (coverage ${fr.coverBottom.toFixed(2)}), drawn`);
  rain.lighting.shadowScale = 0;
  fr.input.rain = 0;
  fr.input.dust = 1;
  fr.update(t);
  ok(fr.overcast === 0 && fr.weatherU.uOver.value.x === 0 && fr.why !== null && fr.why.includes('dust storm'), `a dust storm's sunless row adds no overcast and stands the decks down ("${fr.why}")`);
  ok(wetOvercast(0, 0, 0, 0) === 1 && wetOvercast(0, 0, 1, 0) === 0 && wetOvercast(0.4, 0.7, 1, 0) === 0.7 && wetOvercast(0, 0, 0, 1) === 0, 'the wet overcast: rain, snow, or a sunless row that is not a dust storm');
  // The kind from the picture's spread over its mean.
  ok(layeredOfPicture(PICTURES.tiles.get('veil.png')) === 1 && layeredOfPicture(PICTURES.tiles.get('heaps.png')) === 0 && layeredOfPicture(null) === 0, 'a picture whose alpha barely varies is a layer, a patchy one heaps, and one with no numbers heaps');
  // A clouds.json with no `pictures`: heaps at its coverage.
  const old = cloudPicturesOf({ tiles: { 'a.png': { coverage: 0.3, brightness: 0.7 } } } as never)!;
  const p = old.tiles.get('a.png')!;
  ok(!old.numbered && p.spread === null && p.colour === null && p.coverage === 0.3 && layeredOfPicture(p) === 0, 'a clouds.json from before the pictures\' numbers is read as heaps at its own coverage (npm run swg -- clouds assets-private --no-noise asked)');
  // The smear's phases cross-fade continuously and a restart carries no weight.
  const s2 = new StandInSky();
  s2.decks[0][0] = image('heaps.png', 1, 945);
  const fs = feedWith(s2);
  const dt = 1 / 60;
  let worstStep = 0;
  let prevW = -1;
  let restartW = 0;
  let restarts = 0;
  for (let k = 0; k < 60 * AIR_TUNE.clouds.smearPeriod * 3; k++) {
    const a0 = fs.weatherU.uStrBA.value.clone();
    const b0 = fs.weatherU.uStrBB.value.clone();
    s2.sheetAloft[0] = 8 + 6 * Math.sin(k * 0.001);
    fs.input.dt = dt;
    fs.update(t);
    const w = fs.weatherU.uSmearW.value.z;
    if (prevW >= 0) worstStep = Math.max(worstStep, Math.abs(w - prevW));
    prevW = w;
    if (k > 0 && !a0.equals(fs.weatherU.uStrBA.value)) {
      restarts++;
      restartW = Math.max(restartW, w);
    }
    if (k > 0 && !b0.equals(fs.weatherU.uStrBB.value)) {
      restarts++;
      restartW = Math.max(restartW, 1 - w);
    }
  }
  const P = AIR_TUNE.clouds.smearPeriod;
  ok(worstStep <= (2 * dt) / P + 1e-9 && restarts >= 4 && restartW <= (2 * dt) / P + 1e-9, `the smear's two phases cross-fade continuously (at most ${worstStep.toExponential(2)} a frame) and each restarts its streets only as it weighs nothing (${restarts} restarts, at most ${restartW.toExponential(2)})`);
  // The displacement held under its most: the feed hands the cap, and every displacement the programs make goes through it.
  ok(fs.weatherU.uSmearW.value.w === AIR_TUNE.clouds.smearMost && fs.marchU.uSmear2.value.x === AIR_TUNE.clouds.detailSmearMost && fs.marchU.uLowP.value.z === AIR_TUNE.lowDeck.smearMost, 'the feed hands every smear its most: the pictures\', the detail\'s and the low deck\'s');
  const W = AIR_CLOUD_FRAGMENTS.weather;
  const M = AIR_CLOUD_FRAGMENTS.march;
  ok(['capped(gB * uSmearW.x, uSmearW.w)', 'capped(gB * uSmearW.y, uSmearW.w)', 'capped(gT * uSmearW.x, uSmearW.w)', 'capped(gT * uSmearW.y, uSmearW.w)'].every((s) => W.includes(s)) && ['capLen(v * uSmear.y, uSmear2.x)', 'capLen(v * uSmear.z, uSmear2.x)', 'capLen(v * uSmear.y, uLowP.z)', 'capLen(v * uSmear.z, uLowP.z)'].every((s) => M.includes(s)) && W.includes('pictureUv(x, dA, stA, r, scr.x, scr.y)') && W.includes('pictureUv(x, dB, stB, r, scr.z, scr.w)') && (W.match(/streetOf\(vec2\(x\.x - d\.x, x\.y - d\.y\), st\)/g) ?? []).length === 1 && !/w7Gust\(/.test(M), "every displacement the pictures and the detail take goes through its cap, and the march never evaluates the gusts a sample (it reads the weather pass's)");
  // In a storm (a gust of thirty metres a second off the mean, a phase ninety seconds old): the cap holds, the programs'
  // own `capped` and `capLen` run from their text.
  const capped = glslFunctions(glslFunctionText(W, 'capped'), ['capped'], { vec2: V2 }).capped as unknown as (d: XY, most: number) => XY;
  const capLen = glslFunctions(glslFunctionText(M, 'capLen'), ['capLen'], { vec2: V2 }).capLen as unknown as (d: XY, most: number) => XY;
  const len = (v: XY): number => Math.hypot(v.x, v.y);
  const storm = V2(30 * 90 * 0.6, 30 * 90 * 0.8);
  const small = V2(3.25, -7.5);
  const cs = capped(storm, AIR_TUNE.clouds.smearMost);
  const cl = capLen(storm, AIR_TUNE.clouds.detailSmearMost);
  const cLow = capLen(storm, AIR_TUNE.lowDeck.smearMost);
  const same = (a: XY, b: XY): boolean => Object.is(a.x, b.x) && Object.is(a.y, b.y);
  ok(Math.abs(len(cs) - AIR_TUNE.clouds.smearMost) < 1e-9 && Math.abs(cs.x / cs.y - 0.75) < 1e-12 && Math.abs(len(cl) - AIR_TUNE.clouds.detailSmearMost) < 1e-9 && Math.abs(len(cLow) - AIR_TUNE.lowDeck.smearMost) < 1e-9 && same(capped(small, 400), small) && same(capLen(small, 65), small) && same(capped(V2(0, 0), 400), V2(0, 0)), `a storm's gust over a whole phase (${30 * 90} m uncapped) moves a picture ${AIR_TUNE.clouds.smearMost} m at the most, the high slab's detail ${AIR_TUNE.clouds.detailSmearMost} and the low deck's ${AIR_TUNE.lowDeck.smearMost}, along its own heading (capped and capLen run from their text); a displacement under its most is untouched`);
}
{
  // The weather pass's cut and opacity of an image and of a deck (`cutOf`, `deckOf`, with `cutFor`, run from its text) over
  // the feed's own records: a heaps picture at its mean alpha cuts the billow at its gained coverage, a layer covers its
  // extent thinly, two images blend by weight, and a rain row with no sheet is the overcast at its own thickness.
  const sky = new StandInSky();
  sky.decks[0][0] = image('heaps.png', 0.7, 945);
  sky.decks[0][1] = image('storm.png', 0.3, 700);
  const f = feedWith(sky);
  const t = tuneOn();
  f.input.dt = 1 / 60;
  const curve: CoverPoint[] = COVER_CUTS.map((c, i) => ({ cut: c, sky: Math.max(0, 0.98 - i * 0.07) }));
  f.setCurve('high', curve, 0);
  f.update(t);
  const U = f.weatherU;
  const cover = U.uCover.value;
  const pairs = Array.from({ length: 16 }, (_, i) => V2(cover[i * 2], cover[i * 2 + 1]));
  const env = { vec2: V2, uLook: U.uLook.value, uOver: U.uOver.value, uCover: pairs, uCoverN: U.uCoverN.value };
  const W = AIR_CLOUD_FRAGMENTS.weather;
  const fns = glslFunctions([CUT_FOR_GLSL, glslFunctionText(W, 'cutOf'), glslFunctionText(W, 'deckOf')].join('\n'), ['cutOf', 'deckOf'], env) as unknown as { cutOf: (a: number, img: unknown) => XY; deckOf: (c0: XY, w0: number, c1: XY, w1: number, po: number) => XY };
  const C = AIR_TUNE.clouds;
  const img0 = U.uImgB0.value;
  const img1 = U.uImgB1.value;
  const heaps = fns.cutOf(img0.z, img0);
  const storm = fns.cutOf(img1.z, img1);
  const g0 = Math.min(C.gain * PICTURES.tiles.get('heaps.png')!.coverage, 1);
  const g1 = Math.min(C.gain * PICTURES.tiles.get('storm.png')!.coverage, 1);
  // Each image by its kind as the feed reads it (heaps nought, a layer one): a heaps cut at its coverage drawn whole, a
  // layer at the extent and its alpha's share of the thickness.
  const kindCut = (g: number, w: number): number => cutForCover(g, curve) * (1 - w) + cutForCover(C.extent, curve) * w;
  const kindOp = (g: number, w: number): number => 1 - w + Math.min(Math.max(g * C.thin, 0), 1) * w;
  ok(img0.w === 0 && img1.w === 1 && Math.abs(heaps.x - cutForCover(g0, curve)) < 1e-6 && heaps.y === 1 && Math.abs(storm.x - kindCut(g1, 1)) < 1e-6 && Math.abs(storm.y - kindOp(g1, 1)) < 1e-12, `a heaps picture at its mean alpha cuts the billow at its own gained coverage (${heaps.x.toFixed(4)} for ${g0.toFixed(2)}, cutForCover's), drawn whole; the storm's even picture, a layer by the feed's reading, covers the extent at ${storm.y.toFixed(3)} of the thickness`);
  const deck = fns.deckOf(heaps, img0.y, storm, img1.y, U.uOver.value.z);
  const wantCut = (0.7 * kindCut(g0, 0) + 0.3 * kindCut(g1, 1)) / (0.7 + 0.3);
  const wantOp = Math.min(0.7 * kindOp(g0, 0) + 0.3 * kindOp(g1, 1), 1);
  ok(U.uOver.value.z === 0 && Math.abs(deck.x - wantCut) < 1e-6 && Math.abs(deck.y - wantOp) < 1e-12 && Math.abs(f.coverBottom - (0.7 * g0 + 0.3 * g1)) < 1e-12, `two images blend by the feed's own weights (0.7 and 0.3) into the deck's cut ${deck.x.toFixed(4)} and opacity ${deck.y.toFixed(3)}, with no overcast where the rows hang pictures; the coverage the feed counts for them ${f.coverBottom.toFixed(3)}`);
  // A layer: the same picture read as a veil covers the extent, at its alpha's share of the thickness.
  const veil = { x: img0.x, y: 1, z: 0.5, w: 1 };
  const layer = fns.cutOf(0.5, veil);
  ok(Math.abs(layer.x - cutForCover(C.extent, curve)) < 1e-6 && Math.abs(layer.y - Math.min(Math.max(C.gain * 0.5 * C.thin, 0), 1)) < 1e-12, `a layer covers the deck's extent (${C.extent}) at the thinness its alpha gives (${layer.y.toFixed(3)})`);
  // A rain row hanging no sheet: the overcast's share alone.
  const rain = new StandInSky();
  const fr = feedWith(rain);
  fr.input.rain = 1;
  fr.input.dt = 1 / 60;
  fr.setCurve('high', curve, 0);
  fr.update(t);
  const envR = { vec2: V2, uLook: fr.weatherU.uLook.value, uOver: fr.weatherU.uOver.value, uCover: pairs, uCoverN: fr.weatherU.uCoverN.value };
  const fr2 = glslFunctions([CUT_FOR_GLSL, glslFunctionText(W, 'cutOf'), glslFunctionText(W, 'deckOf')].join('\n'), ['deckOf'], envR) as unknown as { deckOf: (c0: XY, w0: number, c1: XY, w1: number, po: number) => XY };
  const ov = fr.weatherU.uOver.value;
  const over = fr2.deckOf(V2(1, 0), 0, V2(1, 0), 0, ov.z);
  ok(ov.z === 1 && Math.abs(over.x - cutForCover(ov.x * C.extent, curve)) < 1e-6 && Math.abs(over.y - C.overcastThick) < 1e-12 && fns.deckOf(V2(1, 0), 0, V2(1, 0), 0, 0).y === 0, `a rain row with no sheet is the overcast alone: cut at its cover times the extent, at its own thickness (${over.y}); a deck with nothing in it draws nothing`);
}
{
  // `cutFor` in the shader text against `cutForCover`, over the manifest's curve where it is converted, a stand-in otherwise.
  let curve: CoverPoint[] = COVER_CUTS.map((c, i) => ({ cut: c, sky: Math.max(0, 0.98 - i * 0.07) }));
  let from = 'a stand-in curve';
  try {
    const man = JSON.parse(readFileSync(join(here, '..', '..', '..', 'assets-private', 'clouds', 'manifest.json'), 'utf8')) as { cover?: CoverPoint[] };
    if (Array.isArray(man.cover) && man.cover.length > 1) {
      curve = man.cover;
      from = 'the manifest\'s curve';
    }
  } catch {
    /* no noise converted on this machine: the stand-in */
  }
  const pairs = curve.slice(0, 16).map((p) => ({ x: p.cut, y: p.sky }));
  const cutFor = glslFunctions(CUT_FOR_GLSL, ['cutFor'], { uCover: pairs, uCoverN: pairs.length }).cutFor as unknown as (c: number) => number;
  const flat = new Float32Array(32);
  for (let i = 0; i < 16; i++) {
    flat[i * 2] = i < curve.length ? curve[i].cut : 1;
    flat[i * 2 + 1] = i < curve.length ? curve[i].sky : 0;
  }
  let same = true;
  let cpu = true;
  for (let c = 0; c <= 1.0001; c += 0.005) {
    if (Math.abs(cutFor(c) - cutForCover(c, curve)) > 1e-12) same = false;
    if (Math.abs(cutForCurve(c, flat, Math.min(curve.length, 16)) - cutForCover(c, curve)) > 1e-6) cpu = false;
  }
  ok(same && cpu, `the weather pass's cutFor, run from its own text, and the low deck's cut on the processor are cutForCover over ${from}, at every coverage`);
}

// --- 4b. the low deck: when it stands (Q22), where (over the eased ground), and how it drifts ---
{
  const LD = AIR_TUNE.lowDeck;
  const lowCurve: CoverPoint[] = COVER_CUTS.map((c, i) => ({ cut: c, sky: Math.max(0, 0.95 - i * 0.06) }));
  const lowFeed = (): { f: AirCloudsFeed; sky: StandInSky; t: VolTune } => {
    const sky = new StandInSky();
    sky.decks[0][0] = image('heaps.png', 1, 945);
    const f = feedWith(sky);
    f.setCurve('low', lowCurve, 0);
    const t = tuneOn();
    t.cloudsLow = true;
    t.cloudsHoles = true;
    f.input.dt = 1 / 60;
    return { f, sky, t };
  };
  // Q22: no low deck on a fair day; one in rain, in snow and under a sunless sky that is no dust storm; the console's hold
  // either way; none with its switch off or in space.
  const state = (set: (f: AirCloudsFeed, sky: StandInSky, t: VolTune) => void): { low: number; steps: number; cut: number } => {
    const { f, sky, t } = lowFeed();
    set(f, sky, t);
    f.update(t);
    return { low: f.low, steps: f.marchU.uLow.value.z, cut: f.marchU.uLowP.value.x };
  };
  const fair = state(() => {});
  const rain = state((f) => (f.input.rain = 1));
  const snow = state((f) => (f.input.snow = 0.6));
  const sunless = state((_f, sky) => (sky.lighting.shadowScale = 0));
  const held = state((f) => (f.input.lowForce = true));
  const heldOff = state((f) => {
    f.input.rain = 1;
    f.input.lowForce = false;
  });
  const switchedOff = state((f, _s, t) => {
    f.input.rain = 1;
    t.cloudsLow = false;
  });
  const inSpace = state((f) => {
    f.input.rain = 1;
    f.input.space = true;
  });
  ok(fair.low === 0 && fair.steps === 0 && fair.cut === 1, 'Q22: no low deck on a fair day (no steps marched, its cut past the billow)');
  ok(rain.low === 1 && rain.steps === LD.steps && Math.abs(rain.cut - cutForCover(1, lowCurve)) < 1e-6 && snow.low === 0.6 && sunless.low === 1, `a low deck in rain (cut at the low deck's own curve's ${rain.cut.toFixed(3)}), in snow at its share and under a sunless sky that is no dust storm`);
  ok(held.low === 1 && heldOff.low === 0 && switchedOff.low === 0 && inSpace.low === 0, "the console's hold stands one on a fair day and takes one down in rain; none with the low deck's switch off or in space");
  // Its floor over the cached ground under the camera: taken at once at first, eased over `groundEase` after, never read
  // with no ground (the camera's own height less two then).
  {
    const { f, t } = lowFeed();
    f.input.rain = 1;
    let g = 500;
    f.input.groundAt = () => g;
    f.update(t);
    const first = f.marchU.uLow.value.x;
    const depth = f.marchU.uLow.value.y - f.marchU.uLow.value.x;
    g = 800;
    let rising = true;
    let last = first;
    let at10 = 0;
    for (let k = 1; k <= 60 * 60; k++) {
      f.update(t);
      const x = f.marchU.uLow.value.x;
      if (x < last - 1e-9 || x > g + LD.floor + 1e-9) rising = false;
      last = x;
      if (k === 60 * LD.groundEase) at10 = x;
    }
    const after = f.marchU.uLow.value.x;
    // After one ease the floor has come about (1 − 1/e) of the way (the ground's new height is read within half a second).
    const share = (at10 - first) / 300;
    ok(first === 500 + LD.floor && Math.abs(depth - LD.depth) < 1e-9 && rising && share > 0.6 && share < 0.65 && Math.abs(after - (800 + LD.floor)) < 300 * Math.exp(-59 / LD.groundEase) + 1e-6, `the low deck's floor stands ${LD.floor} m over the ground under the camera (taken at once: ${first}), ${LD.depth} m deep, and follows the ground rising 300 m eased (${(share * 100).toFixed(1)}% of the way after ${LD.groundEase} s, never past it)`);
    const { f: f2, t: t2 } = lowFeed();
    f2.input.rain = 1;
    f2.input.camY = 77;
    f2.update(t2);
    ok(f2.marchU.uLow.value.x === 75 + LD.floor, 'with no ground to read the floor stands over the camera less two metres');
  }
  // How it drifts: each feature of the low deck's frame (the march's own lowBaseAt and lowDetailAt, run from its text, and
  // its hole read) carried by the low deck's own wind reads the same place; that wind along the weather's heading at the
  // world's travel times the low deck's factor, never under the floor.
  {
    const { f, t } = lowFeed();
    f.input.rain = 1;
    const vol = volumeReads(f.marchU);
    const zero = V2(0, 0);
    const wrap = (v: number, p: number): number => v - p * Math.round(v / p);
    const bl = AIR_TUNE.clouds.baseScale * LD.scale;
    const dl = AIR_TUNE.clouds.detailScale * LD.scale;
    let worst = 0;
    let worstDir = 0;
    let worstSpeed = 0;
    let moved = 0;
    const fps = 60;
    for (let s = 0; s < 600; s++) {
      // The world's travel changes from minute to minute; the heading turns slowly.
      f.input.travel = 1 + 8 * Math.abs(Math.sin(s / 60));
      f.input.heading = 0.4 + s * 0.001;
      const pts = [V3(0, 300, 0), V3(1000, 300, -400), V3(-5000, 300, 2500)];
      const b0 = pts.map((p) => vol.lowBaseAt(p));
      const d0 = pts.map((p) => vol.lowDetailAt(p, zero));
      let wx = 0;
      let wz = 0;
      for (let k = 0; k < fps; k++) {
        f.input.dt = 1 / fps;
        f.update(t);
        const lu = f.lowWindU.uLowU.value;
        const du = f.weatherU.uDeckU.value;
        wx += lu.x / fps;
        wz += lu.y / fps;
        const vl = Math.hypot(lu.x, lu.y);
        worstDir = Math.max(worstDir, Math.abs(lu.x / vl - du.x / Math.hypot(du.x, du.y)), Math.abs(lu.y / vl - du.y / Math.hypot(du.x, du.y)));
        worstSpeed = Math.max(worstSpeed, Math.abs(vl - Math.max(f.input.travel * WIND_TUNE_ALOFT.low, WIND_TUNE_ALOFT.floor)));
      }
      moved += Math.hypot(wx, wz);
      for (let i = 0; i < pts.length; i++) {
        const q = V3(pts[i].x + wx, 300, pts[i].z + wz);
        const b1 = vol.lowBaseAt(q);
        const d1 = vol.lowDetailAt(q, zero);
        worst = Math.max(worst, Math.hypot(wrap(b1.x - b0[i].x, 1), wrap(b1.z - b0[i].z, 1)) * bl, Math.hypot(wrap(d1.x - d0[i].x, 1), wrap(d1.z - d0[i].z, 1)) * dl);
      }
    }
    ok(worst < 1e-3 && moved > 1000, `ten minutes of a changing travel: every feature of the low deck's frame, through the march's own lowBaseAt and lowDetailAt, carried ${moved.toFixed(0)} m by the low deck's own wind reads the same place of each volume (${worst.toExponential(2)} m)`);
    ok(worstDir < 1e-12 && worstSpeed < 1e-9, `the low deck's wind blows along the weather's heading as the bottom deck's does (${worstDir.toExponential(1)}), at the world's travel times its factor ${WIND_TUNE_ALOFT.low}, floored at ${WIND_TUNE_ALOFT.floor} m/s`);
  }
}

// --- 5. the dome by reference; the calibration worker ---
{
  const f = new AirCloudsFeed();
  const pass = new AirCloudsPass(f);
  const sky = new StandInSky();
  pass.bindDome(sky.domeUniforms);
  const bound = pass.domeBound();
  const all = (['uGradient', 'uGradient2', 'uGradientMix', 'uTime', 'uHasGradient', 'uHasGradient2', 'uClear'] as const).every((k) => bound[k] === sky.domeUniforms[k]);
  ok(all, "the dome's seven uniform objects are the march's own, by reference: whatever the sky writes into them this frame the decks read");
  ok(/vec3 g1 = uHasGradient > 0\.5 \? texture\(uGradient, vec2\(uTime, 0\.999\)\)\.rgb : uClear;/.test(AIR_CLOUD_FRAGMENTS.march) && /vec3 g2 = uHasGradient2 > 0\.5 \? texture\(uGradient2, vec2\(uTime, 0\.999\)\)\.rgb : uClear;/.test(AIR_CLOUD_FRAGMENTS.march) && AIR_CLOUD_FRAGMENTS.march.includes('vec3 zenith = mix(g1, g2, uGradientMix);'), "a row with no gradient (the dome's own flag nought) lights a deck's top by the dome's clear colour, never white: the dome's own ternary over its own flags");
  sky.domeUniforms.uClear.value.setRGB(0.1, 0.2, 0.3);
  ok((pass.domeBound().uClear.value as THREE.Color).r === 0.1, 'a colour the sky writes is the one the march reads, with nothing copied');
  pass.dispose();
}
{
  // The worker's curve against `coverCurve` on the same bytes.
  const rnd = (() => {
    let s = 12345;
    return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) & 0xffff) / 0xffff;
  })();
  const bs = 16;
  const dsz = 8;
  const base = new Uint8Array(bs ** 3 * 4);
  const detail = new Uint8Array(dsz ** 3 * 4);
  for (let i = 0; i < base.length; i++) base[i] = Math.floor(rnd() * 255);
  for (let i = 0; i < detail.length; i++) detail[i] = Math.floor(rnd() * 255);
  const g = globalThis as unknown as Record<string, unknown>;
  const posted: { id: number; curves: { which: string; cover: CoverPoint[] }[]; error?: string }[] = [];
  g.self = { onmessage: null, postMessage: (m: never) => void posted.push(m) };
  const fetchWas = g.fetch;
  g.fetch = async (url: string) => ({ ok: true, status: 200, arrayBuffer: async () => (url.includes('base') ? base.slice().buffer : detail.slice().buffer) });
  try {
    await import('../../../src/world/volumetrics/cloudCalibrate.worker.ts');
    const march = { steps: 16, density: 0.055, detailBite: 0.32, erodeBite: 0.35, feather: 0.22, bottom: 1500, top: 2300, baseScale: 4200, detailScale: 260 };
    const low = { ...march, bottom: 0, top: 180, baseScale: 4200 * 0.3, detailScale: 260 * 0.3 };
    (g.self as { onmessage: (e: { data: unknown }) => void }).onmessage({ data: { id: 3, baseUrl: '/base.bin', detailUrl: '/detail.bin', baseSize: bs, detailSize: dsz, rays: 8, jobs: [{ which: 'high', march, decks: 2 }, { which: 'low', march: low, decks: 1 }] } });
    for (let i = 0; i < 200 && !posted.length; i++) await new Promise((r) => setTimeout(r, 5));
    const a = posted[0];
    const wantHigh = coverCurve(base, detail, bs, dsz, march, 2, undefined, 8);
    const wantLow = coverCurve(base, detail, bs, dsz, low, 1, undefined, 8);
    ok(!!a && !a.error && a.id === 3 && JSON.stringify(a.curves[0].cover) === JSON.stringify(wantHigh) && JSON.stringify(a.curves[1].cover) === JSON.stringify(wantLow) && wantLow.length === COVER_CUTS.length, "the calibration worker's curves (the high deck's two-deck profile and the low deck's one) are coverCurve's on the same bytes, to the bit");
  } finally {
    g.fetch = fetchWas;
    delete g.self;
  }
}

{
  // The worker's answers taken in the order they were asked, whatever order they arrive in: each ask a job of its own, a
  // later one can answer first, and a deck put back at the manifest's own march counts as asked then.
  const f = new AirCloudsFeed();
  const manifest: CoverPoint[] = COVER_CUTS.map((c, i) => ({ cut: c, sky: Math.max(0, 0.98 - i * 0.07) }));
  f.setNoise(new THREE.Data3DTexture(), new THREE.Data3DTexture(), manifest, 0.9);
  const posted: { id: number; jobs: { which: string }[] }[] = [];
  const F = f as unknown as { worker: unknown; noiseFiles: unknown };
  F.worker = { postMessage: (m: { id: number; jobs: { which: string }[] }) => void posted.push(m), terminate: () => {} };
  F.noiseFiles = { baseUrl: '/b', detailUrl: '/d', baseSize: 4, detailSize: 2 };
  const curveOf = (k: number): CoverPoint[] => COVER_CUTS.map((c, i) => ({ cut: c, sky: Math.max(0, 0.9 - i * 0.05 * k) }));
  const C = AIR_TUNE.clouds;
  const densityWas = C.density;
  try {
    f.calibrateCheck(1);
    C.density = 0.07;
    f.calibrateCheck(1);
    C.density = densityWas;
    f.calibrateCheck(1);
  } finally {
    C.density = densityWas;
  }
  const asked = posted.map((p) => `${p.id}:${p.jobs.map((j) => j.which).join('+')}`).join(' ');
  // The third ask answers first, then the second (whose high curve the manifest's own march has since overtaken), then the first.
  f.takeCalibration({ id: 3, curves: [{ which: 'low', cover: curveOf(3) }], ms: 41 });
  f.takeCalibration({ id: 2, curves: [{ which: 'high', cover: curveOf(5) }, { which: 'low', cover: curveOf(2) }], ms: 77 });
  f.takeCalibration({ id: 1, curves: [{ which: 'low', cover: curveOf(1) }], ms: 12 });
  const high = f.weatherU.uCover.value;
  const low = f.lowCover;
  ok(asked === '1:low 2:high+low 3:low' && f.calibration.high === 'manifest' && Object.is(high[3], f32(manifest[1].sky)) && Object.is(low[3], f32(curveOf(3)[1].sky)) && f.calibration.ms === 41 && f.calibration.at > 0, `the calibration's answers taken in the order they were asked (${asked}): a high curve overtaken by the manifest's own march and a low one overtaken by a later ask are dropped however late they land; when it was taken (${f.calibration.at.toFixed(0)} ms into the run) apart from how long its job took (${f.calibration.ms} ms)`);
}

// --- 6. the pass: the September's four bugs kept out, and every refusal in words ---
{
  const f = new AirCloudsFeed();
  const pass = new AirCloudsPass(f);
  const target = new THREE.WebGLRenderTarget(4, 4, { depthTexture: new THREE.DepthTexture(4, 4) });
  const ctx = createContext({} as THREE.WebGLRenderer, { ...FX_DEFAULTS }, target);
  const on: FxSettings = { ...FX_DEFAULTS, volumetrics: true, volClouds: true, volCloudsAmount: 1 };
  pass.setSize(1600, 900, on);
  ok(pass.reason(ctx)?.includes('no noise volumes') === true && !pass.enabled(ctx) && !pass.wouldDraw(false, false), 'with no noise on the card it refuses in words (and the sheets stay)');
  f.noiseUploaded = true;
  f.why = null;
  ok(pass.reason(ctx) === null && pass.enabled(ctx) && pass.wouldDraw(false, false), 'with the noise up and a sky to draw, it draws');
  for (const [field, words] of [
    ['space', 'space'],
    ['portalView', 'building'],
    ['inside', 'building'],
    ['cameraSubmerged', 'under water'],
  ] as const) {
    (ctx as unknown as Record<string, boolean>)[field] = true;
    const r = pass.reason(ctx);
    // What the game asks before the scene is drawn, handed the very verdicts the frame's context holds: never yes where
    // the pass refuses, or the sheets come down with nothing drawn for them.
    const would = pass.wouldDraw(ctx.space, ctx.inside, ctx.portalView, ctx.cameraSubmerged);
    ok(r !== null && r.includes(words) && !pass.enabled(ctx) && !would, `${field}: it refuses ("${r}"), and the game's question before the scene is drawn says so too (the sheets stay)`);
    (ctx as unknown as Record<string, boolean>)[field] = false;
  }
  ok(pass.wouldDraw(ctx.space, ctx.inside, ctx.portalView, ctx.cameraSubmerged) === pass.enabled(ctx) && pass.enabled(ctx), 'with nothing refusing, the game\'s question and the pass agree that it draws');
  for (const why of ['a dust storm has the sky (the dust stands the decks down)', 'this sky has nothing to draw']) {
    f.why = why;
    ok(pass.reason(ctx) === why && !pass.wouldDraw(false, false), `the sky's own refusal: "${why}"`);
  }
  f.why = null;
  pass.setSize(1600, 900, { ...on, volCloudsAmount: 0 });
  ok(pass.reason(ctx)?.includes('at 0') === true && !pass.wouldDraw(false, false), 'an amount of nought refuses with a reason, and the sheets come back (the September composited a copy)');
  pass.setSize(1600, 900, { ...on, volumetrics: false });
  ok(pass.reason(ctx)?.includes('master is off') === true, 'with the master off it refuses');
  pass.setSize(1600, 900, on);
  ok(pass.materials().every((m) => (m.material as THREE.ShaderMaterial).blending === THREE.NoBlending) && AIR_CLOUD_FRAGMENTS.march.includes('depth < uFar * 0.999') && !/\bfxHalfTaps\s*\(|import[^;]*\bfxHalfTaps\b|FX_HALF_TAPS/.test(source('core/fx/airClouds.ts')), "the September's bugs kept out: every material says NoBlending, a far-plane texel is sky, the upsample is its own size's");
  pass.setSize(1600, 900, { ...on, volCloudsResolution: 0.5 });
  ok((pass.report().size as number[])[0] === 800 && (pass.report().size as number[])[1] === 450, "the march's target is its setting's share of the screen");
  pass.dispose();
}

const ms = Math.round(performance.now() - t0);
console.log(`(${ms} ms)`);
console.log(`\n${checks} checks passed`);
