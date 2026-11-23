// Our sky on WebGPU (the GPU port's pass 2, wave 1; the design's 2.1 and 2.4): the dome drawn from the air's sky view, and
// each star of the world's system a disc that reddens and dims through the world's air (`src/sky/stars.ts`). It stands in
// for the dome's `ShaderMaterial` (`sky.ts` registers it as the dome's `gpuStandIn` under our sky), so the dome keeps its
// mesh, its render order and its state; SWG's sun pictures are not shown under it (`sky.ts`), and the moons and the stars
// stay SWG's until waves 3 and 4.
//
//   - **The sky**: the air's radiance toward the dome's own direction (`AIR.tables.skyRadiance`), which is the sky view.
//   - **The discs**: the casting sun at the day's own place and, on Tatooine, its companion `PAIR_TUNE.belowDeg` under it
//     (the air's maker writes both directions, `AIR.frame`), each its top-of-air light (`sunTop`, `sun2Top`) spread over its
//     disc with a limb that darkens toward the edge (`DISC_TUNE.limb`), times the air's transmittance toward it, so a disc low
//     over the horizon is red and dim and one under it is gone; under storms each fades by one less the overcast, until pass
//     3's clouds stand in front of it. In the reflections' capture (`SwgSky.domeScene`, marked `swgSkyCapture`; pass 2, wave
//     2, maker B, `src/sky/capture/`) each disc is spread to at least `CAPTURE_TUNE.sunDeg` of radius, its light kept whole, so
//     it never falls between the cube's texels, and capped at `CAPTURE_TUNE.sunCap` times its own light a steradian, so a
//     shiny surface shows the sun without a sparkle; the world's discs are drawn as ever (the spread nought, the cap unreached).
//   - **The night**: the air's own (pass 2, wave 2 retired wave 1's night floor); the eye makes it readable
//     (`src/sky/exposure/`).
//
// Nothing here is loaded on the WebGL path. Every number of look is a dial (`DISC_TUNE`), read once a render.

import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { AIR } from './airApi.ts';
import { casterOf, secondOf } from '../stars.ts';
import { DISC_TUNE } from '../skyDials.ts';
import { GPU_LOOK } from '../../core/gpu/gpuLook.ts';
import { markMotion } from '../../core/gpu/motion.ts';
import { CAPTURE_TUNE } from '../capture/captureTune.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { Fn, clamp, float, length, max, min, mix, normalize, positionLocal, renderGroup, smoothstep, sqrt, uniform, vec3, vec4 } = TSL as Any;

/** The world's discs' spread and cap: none spread, a cap no disc reaches (a disc's light a steradian is under 1e5 of its own). */
const WORLD_CAP = 1e9;

/** Whether the render three is drawing is the reflections' capture (its scene marked `swgSkyCapture`, `SwgSky.domeScene`). */
const inCapture = (f: Any): boolean => f?.scene?.userData?.swgSkyCapture === true;

/** A disc's least radius in this render, in radians (pass 2, wave 2): `CAPTURE_TUNE.sunDeg` in the capture, nought in the world. */
export function discLeastRadius(f: Any): number {
  return inCapture(f) ? (CAPTURE_TUNE.sunDeg * Math.PI) / 180 : 0;
}

/** The most a disc sends a steradian in this render, as a share of its light (pass 2, wave 2): `CAPTURE_TUNE.sunCap` in the capture. */
export function discMostLight(f: Any): number {
  return inCapture(f) ? CAPTURE_TUNE.sunCap : WORLD_CAP;
}

/** The share of a disc's light the world shows (`DISC_TUNE.stops`, each a halving); the capture keeps it whole. */
export function discSeen(f: Any): number {
  return inCapture(f) ? 1 : 2 ** DISC_TUNE.stops;
}

/** A dial read once a render, in the shared render group (an object uniform is written only at a full refresh). */
const dial = (read: () => number): Any => uniform(read()).setGroup(renderGroup).onRenderUpdate(read);

/** What the sky has built, for `__debug.sky()`. */
export const AIR_SKY_STATS = { built: 0, withoutTables: 0 };

/**
 * A star's disc toward `dir` (a unit vec3 node): its centre `sun` (unit), its angular radius `r` (radians), `top` its light at
 * the top of the air (vec3): the radiance (vec3) a direction inside the disc sees, nought outside. The chord stands in for the
 * angle (within a millionth at a disc's size), the light spread so the disc as a whole sends `top` (the limb's mean is one
 * less a third of it). `cap` (pass 2, wave 2) is the most a direction may take a steradian, as a share of `top`: the
 * reflections' capture's `CAPTURE_TUNE.sunCap`, and in the world a number no disc reaches.
 */
function disc(dir: Any, sun: Any, r: Any, top: Any, limb: Any, edge: Any, cap: Any): Any {
  const a = length(dir.sub(sun));
  const x = clamp(a.div(max(r, 1e-6)), 0, 1);
  const mu = sqrt(max(float(1).sub(x.mul(x)), 0));
  const shade = float(1).sub(limb.mul(float(1).sub(mu))).div(float(1).sub(limb.div(3)));
  const inside = float(1).sub(smoothstep(float(1).sub(edge), float(1), a.div(max(r, 1e-6))));
  const area = r.mul(r).mul(Math.PI);
  return top.mul(min(shade.div(max(area, 1e-12)), cap).mul(inside));
}

/**
 * The dome's material under our sky, for a world (`planet`, a PLANETS id, for its stars' sizes) whose dome writes its
 * horizon and clear colours into `horizon` and `zenith` (today's dome, the stand-in's before the tables). Built once a sky; with no air's
 * tables yet it is today's stand-in, as SWG's sky draws it.
 */
export function airSkyMaterial(planet: string, horizon: THREE.Color, zenith: THREE.Color): THREE.Material {
  const m = new MeshBasicNodeMaterial();
  m.name = 'gpu: our sky';
  m.fog = false;
  const h = uniform(horizon).setGroup(renderGroup);
  const z = uniform(zenith).setGroup(renderGroup);
  const up = dial(() => GPU_LOOK.skyZenithAt);
  const dir = normalize(positionLocal);
  const today = mix(h, z, smoothstep(float(0), up, dir.y));
  const tables = AIR.tables;
  if (!tables) {
    AIR_SKY_STATS.withoutTables++;
    m.colorNode = today;
    return markMotion(m, 'sky');
  }
  AIR_SKY_STATS.built++;
  const n = tables.nodes;
  // The second disc's size is the table's against the caster's: the air's record carries the caster's own.
  const c = casterOf(planet);
  const s2 = secondOf(planet);
  const ratio = s2 ? s2.radiusDeg / c.radiusDeg : 1;
  const limb = dial(() => DISC_TUNE.limb);
  const edge = dial(() => DISC_TUNE.edge);
  const gain = dial(() => DISC_TUNE.gain);
  // Pass 2, wave 2 (maker B): in the reflections' capture (the scene three draws, read once a render) each disc spread to at
  // least `CAPTURE_TUNE.sunDeg` of radius and capped at `sunCap` of its light a steradian (`captureTune.ts` says why); in the
  // world neither (the least radius nought, the cap one no disc reaches).
  const capLeast = uniform(0.5).setGroup(renderGroup).onRenderUpdate(discLeastRadius);
  const capMost = uniform(0.5).setGroup(renderGroup).onRenderUpdate(discMostLight);
  const seen = uniform(1).setGroup(renderGroup).onRenderUpdate(discSeen);
  m.colorNode = Fn(() => {
    const d = dir.toVar('swgSkyDir');
    // Every table read at the top, before anything else.
    const sky = vec3(tables.skyRadiance(d)).toVar('swgSkyL');
    const t = vec3(tables.transmittanceToSpace(d)).toVar('swgSkyT');
    const sun1 = disc(d, n.sunDir, max(n.sunRadius, capLeast), n.sunTop, limb, edge, capMost);
    const sun2 = disc(d, n.sun2Dir, max(n.sunRadius.mul(ratio), capLeast), n.sun2Top, limb, edge, capMost);
    const discs = sun1.add(sun2).mul(t).mul(float(1).sub(clamp(n.overcast, 0, 1))).mul(gain).mul(seen);
    return vec4(sky.add(discs), 1);
  })();
  return markMotion(m, 'sky');
}
