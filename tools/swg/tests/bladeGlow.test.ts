// The lightsaber glow's arithmetic, checked without a browser: the light curve, the brightness
// guard, the screen box the pass works in and the march that stops the light at walls. The shader
// in `src/core/fx/bladeGlow.ts` is built from the same constants and implements the same formulas,
// so what is pinned here is what the GPU draws.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BLADE_GLOW_GUARD,
  BLADE_GLOW_MARCH,
  BLADE_GLOW_MAX,
  BLADE_GLOW_TUNE,
  closestOnSegment,
  distanceFade,
  emptyRect,
  glowGuard,
  irradiance,
  lightRect,
  luminance,
  marchVisibility,
  marchWeight,
  pointIrradiance,
  radiance,
  segmentDistanceSq,
  unionRect,
  wrapLambert,
  type UvRect,
  type Vec3Like,
} from '../../../src/core/fx/bladeGlowMath.ts';
import { createBladeList } from '../../../src/core/fx/bladeList.ts';
import { collectBlades, keepNearestGlow, litCeiling, type LitSources } from '../../../src/combat/bladeLights.ts';
import type { SaberBlade } from '../../../src/combat/saberBlade.ts';
import type { FighterGlow, Npc } from '../../../src/world/npcs.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const T = BLADE_GLOW_TUNE;

// --- the light curve ---

const e0 = irradiance(0, T);
ok(near(e0, T.knee, T.knee * 0.005), `at the blade the light levels off at the knee (${e0.toFixed(3)} against ${T.knee})`);
let strict = true;
for (let d = 0; d < 3.4 - 1e-9; d += 0.1) if (!(irradiance((d + 0.1) ** 2, T) < irradiance(d * d, T))) strict = false;
ok(strict, 'the light falls strictly all the way out from the blade to 3.4 m: no flat disc under a low blade');
ok(irradiance(T.range * T.range, T) === 0, `nothing at ${T.range} m`);
ok(irradiance(5 * 5, T) === 0 && irradiance(100 * 100, T) === 0, 'nothing beyond the range');
ok(near(irradiance(1, T), 2.0, 0.02), `2.0 at a metre (${irradiance(1, T).toFixed(3)})`);
ok(near(irradiance(4, T), 2.4 / (4 + T.core), 0.1 * (2.4 / (4 + T.core))), `at 2 m within a tenth of the old curve's 0.571 (${irradiance(4, T).toFixed(3)})`);
for (const [d, want] of [[0.5, 2.942], [1.5, 1.032], [2.5, 0.275], [3, 0.066]] as const) {
  ok(near(irradiance(d * d, T), want, 0.002), `${want} at ${d} m, as the design's table says`);
}

const under = radiance(1, 1, T);
ok(under > 0.25 && under < 0.33, `a floor a metre under the blade gains ${under.toFixed(3)} of the light's colour`);

// --- the wrapped Lambert term ---

ok(wrapLambert(1, T.wrap) === 1, 'a surface facing the blade takes all of it');
ok(wrapLambert(-0.3, T.wrap) === 0 && wrapLambert(-0.8, T.wrap) === 0, 'a surface turned away past the wrap takes none');
ok(near(wrapLambert(0, T.wrap), T.wrap / (1 + T.wrap), 1e-12), 'a surface side-on takes wrap / (1 + wrap)');

// --- the distance fade ---

ok(distanceFade(T.fadeFrom, T) === 1, `a blade ${T.fadeFrom} m away lights at full strength`);
ok(distanceFade(T.far, T) === 0, `a blade ${T.far} m away lights nothing`);
ok(near(distanceFade((T.fadeFrom + T.far) / 2, T), 0.5, 1e-12), 'half way between, half');

// --- the segment ---

{
  const a = { x: 0, y: 0, z: 0 };
  const b = { x: 0, y: 1, z: 0 };
  ok(near(closestOnSegment({ x: 3, y: 0.5, z: 0 }, a, b), 0.5, 1e-12), 'a point beside the middle is nearest the middle');
  ok(closestOnSegment({ x: 0, y: -2, z: 0 }, a, b) === 0 && closestOnSegment({ x: 1, y: 7, z: 0 }, a, b) === 1, 'points past the ends are clamped to them');
  ok(near(segmentDistanceSq({ x: 2, y: 0.5, z: 0 }, a, b), 4, 1e-12), 'a point 2 m beside the middle of a 1 m blade is 4 m squared away');
  ok(near(segmentDistanceSq({ x: 0, y: 3, z: 0 }, a, b), 4, 1e-12), 'a point 2 m past the tip is 4 m squared away');
  ok(near(segmentDistanceSq({ x: 1, y: 1, z: 0 }, a, a), 2, 1e-12), 'a blade of no length is a point');
}

// --- luminance, the light ceiling and the guard ---

ok(near(luminance(1, 1, 1), 1, 1e-12), 'white has luminance 1');
ok(near(pointIrradiance(1, 4, 4, 3.5, 2), 4, 1e-12), 'a light 0.5 m short of the reach is taken as a metre away');
ok(near(pointIrradiance(1, 4, 6.5, 3.5, 2), 4 / 9, 1e-12), 'a light 3 m past the reach falls off as 1/9');
ok(glowGuard(0.9, 1) === 1, 'a pixel under the light ceiling is a lit surface');
ok(glowGuard(2, 1) === 0, 'a pixel twice the ceiling is glow');
ok(glowGuard(3, 10) === 0, `a pixel at luminance ${BLADE_GLOW_GUARD.lumTo} is glow, whatever the ceiling`);
ok(glowGuard(1.2, 10) === 1, 'a pixel well under a bright ceiling is a lit surface');

// --- the screen box ---

{
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 9000);
  cam.position.set(0, 1.6, 4);
  cam.lookAt(0, 1, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements;
  const r: UvRect = { x0: 0, y0: 0, x1: 0, y1: 0 };
  const v = (x: number, y: number, z: number): Vec3Like => ({ x, y, z });

  ok(lightRect(v(0, 1, 0), v(0, 2, 0), T.range, vp, 0.05, r), 'a blade in front of the camera has a box on the screen');
  const m = new THREE.Vector3(0, 1.5, 0).project(cam);
  const mu = m.x * 0.5 + 0.5;
  const mv = m.y * 0.5 + 0.5;
  ok(mu >= r.x0 && mu <= r.x1 && mv >= r.y0 && mv <= r.y1, 'and the box holds the blade');
  ok(!lightRect(v(0, 1, 24), v(0, 2, 24), T.range, vp, 0.05, r), 'a blade 20 m behind the camera has none');
  ok(lightRect(v(0, 1.4, 3), v(0, 2.2, 3), T.range, vp, 0.05, r) && r.x0 === 0 && r.y0 === 0 && r.x1 === 1 && r.y1 === 1, 'a blade a metre in front of the eye has the whole screen');
  ok(!lightRect(v(40, 1, 4), v(40, 2, 4), T.range, vp, 0.05, r), 'a blade 40 m to the side has none, though its box has corners behind the eye');

  const all: UvRect = { x0: 0, y0: 0, x1: 0, y1: 0 };
  emptyRect(all);
  ok(all.x0 === Infinity && all.x1 === -Infinity, 'an empty box is nothing');
  unionRect(all, { x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.4 });
  unionRect(all, { x0: 0.25, y0: 0.1, x1: 0.6, y1: 0.35 });
  ok(all.x0 === 0.1 && all.y0 === 0.1 && all.x1 === 0.6 && all.y1 === 0.4, 'two boxes join into the box around both');
}

// --- the march ---

ok(marchWeight(BLADE_GLOW_MARCH.near) === 0, `light from ${BLADE_GLOW_MARCH.near} m is never marched`);
ok(marchWeight(BLADE_GLOW_MARCH.nearFull) === 1, `light from ${BLADE_GLOW_MARCH.nearFull} m is marched in full`);

{
  const tan = { x: Math.tan(Math.PI / 6) * (16 / 9), y: Math.tan(Math.PI / 6) };
  const nearPlane = 0.05;
  const n = { x: 0, y: 1, z: 0 };
  const uOf = (p: Vec3Like) => (p.x / (-p.z * tan.x)) * 0.5 + 0.5;
  const lerp = (a: Vec3Like, b: Vec3Like, t: number): Vec3Like => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
  /** A depth image that holds `depth` for u between the screen places of two points of the path, and far away elsewhere. */
  const band = (P: Vec3Like, Q: Vec3Like, t0: number, t1: number, depth: number) => {
    const a = uOf(lerp(P, Q, t0));
    const b = uOf(lerp(P, Q, t1));
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return (u: number) => (u >= lo && u <= hi ? depth : 9000);
  };

  const P = { x: -1, y: -0.8, z: -6 };
  const Q = { x: 0.5, y: 0.4, z: -5 };
  ok(marchVisibility(P, n, Q, 6, () => 9000, tan, nearPlane) === 1, 'open ground: the light gets through');
  ok(marchVisibility(P, n, Q, 6, band(P, Q, 0.35, 0.65, 5.45), tan, nearPlane) < 0.1, 'a wall across the path stops it');
  ok(marchVisibility(P, n, Q, 6, band(P, Q, 0.35, 0.65, 3.0), tan, nearPlane) === 1, 'something far in front of the path does not');
  ok(marchVisibility(P, n, Q, 6, band(P, Q, 0.35, 0.65, 7.0), tan, nearPlane) === 1, 'nor does something behind it');
  const Qs = { x: P.x + 0.3, y: P.y, z: P.z };
  ok(
    marchVisibility(P, n, Qs, 6, () => {
      throw new Error('a path too short to march read the depth');
    }, tan, nearPlane) === 1,
    'a path too short to march is clear, and reads no depth',
  );

  // The slack rule alone: a surface half a metre nearer the eye than the path's nearer end stands
  // between the camera and the path (a body in front of the ground), so it casts no shadow.
  const P2 = { x: -1.6, y: -1.2, z: -7.8 };
  const Q2 = { x: 0.3, y: 0.2, z: -5 };
  ok(marchVisibility(P2, n, Q2, 7.8, band(P2, Q2, 0.6, 0.95, 4.5), tan, nearPlane) === 1, 'a surface in front of the path casts no shadow on it');
  ok(marchVisibility(P2, n, Q2, 7.8, band(P2, Q2, 0.6, 0.95, 4.8), tan, nearPlane) === 0, 'the same surface within the slack of the path does');
  const march = BLADE_GLOW_MARCH as unknown as Record<string, number>;
  const slack = march.slack;
  march.slack = 1e6;
  try {
    ok(marchVisibility(P2, n, Q2, 7.8, band(P2, Q2, 0.6, 0.95, 4.5), tan, nearPlane) < 0.05, 'and without the slack rule the one in front would have darkened it');
  } finally {
    march.slack = slack;
  }

  // The blade behind the eye: the part of the path in front of the camera is still marched.
  const Q3 = { x: 0.5, y: 0.4, z: 2 };
  const wall = band(P, Q3, 0.2, 0.45, -lerp(P, Q3, 0.3).z - 0.25);
  ok(marchVisibility(P, n, Q3, 6, wall, tan, nearPlane) < 0.1, 'a wall in front of the camera stops the light of a blade behind it');

  // The ordered offset moves the taps by at most half a step and never turns a clear path dark.
  ok(marchVisibility(P, n, Q, 6, () => 9000, tan, nearPlane, 0.47) === 1 && marchVisibility(P, n, Q, 6, () => 9000, tan, nearPlane, -0.47) === 1, 'with the taps offset, open ground stays clear');
}

// --- gathering the blades: the player's first, then the fighters nearest the eye, eight at most ---

{
  type FakeBlade = { glowing: boolean; drawnBase: THREE.Vector3; drawnTip: THREE.Vector3; ignition: number; color: THREE.Color };
  const blade = (x: number, z: number, color: number, glowing = true, ignition = 1): FakeBlade => ({
    glowing,
    drawnBase: new THREE.Vector3(x, 1, z),
    drawnTip: new THREE.Vector3(x, 2, z),
    ignition,
    color: new THREE.Color(color),
  });
  const own = (list: FakeBlade[]) => list as unknown as SaberBlade[];
  const fighters = (list: (FakeBlade | null)[]) => list.map((saber) => ({ saber })) as unknown as Npc[];
  const eye = new THREE.Vector3(0, 1.5, 0);
  const out = createBladeList();

  // Ten fighters from 3 to 30 m, listed out of order, and the player's blade farther than the nearest of them.
  const dists = [21, 3, 30, 12, 6, 27, 9, 15, 24, 18];
  const colours = dists.map((d) => 0x100000 * (d % 15) + 0x00ff40);
  const many = fighters(dists.map((d, i) => blade(0, -d, colours[i])));
  const mine = blade(0, -5, 0x2060ff);
  ok(collectBlades(out, own([mine]), many, eye) === BLADE_GLOW_MAX && out.count === BLADE_GLOW_MAX, 'eleven lit blades give eight, the cap');
  ok(out.items[0].own && out.items[0].a.z === -5, "the player's blade comes first, though a fighter's is nearer");
  const kept = out.items.slice(1, out.count).map((e) => -e.a.z);
  ok(kept.join() === '3,6,9,12,15,18,21', 'then the fighters nearest first, and the three farthest left out');
  ok(out.items.slice(1, out.count).every((e) => !e.own), "no fighter's blade is marked as the player's");
  const white = new THREE.Color(colours[dists.indexOf(3)]).lerp(new THREE.Color(0xffffff), T.whiteness);
  ok(near(out.items[1].color.r, white.r, 1e-6) && near(out.items[1].color.g, white.g, 1e-6) && near(out.items[1].color.b, white.b, 1e-6), "each fighter's light is its own blade's colour, a little toward white");

  // Every blade of the player's that glows, in order, even with no fighter about.
  ok(collectBlades(out, own([blade(1, -2, 0xff0000), blade(0, -1, 0x00ff00, false), blade(-1, -2, 0x0000ff)]), [], eye) === 2, "the player's dark blade is left out");
  ok(out.items[0].a.x === 1 && out.items[1].a.x === -1 && out.items[0].own && out.items[1].own, "the player's lit blades in their own order");

  // Distance: nothing from 60 m, a faded light between 45 and 60, full nearer.
  collectBlades(out, [], fighters([blade(0, -60, 0xffffff), blade(0, -61, 0xffffff), blade(0, -80, 0xffffff)]), eye);
  ok(out.count === 0, 'a blade at 60 m or more gives no light');
  collectBlades(out, [], fighters([blade(0, -52, 0xffffff), blade(0, -10, 0xffffff, true, 0.5)]), eye);
  ok(out.count === 2 && out.items[0].a.z === -10 && out.items[0].intensity === 0.5 && out.items[0].ignition === 0.5, 'a half-lit blade near by gives half its light');
  ok(out.items[1].intensity > 0 && out.items[1].intensity < 1 && near(out.items[1].intensity, distanceFade(52, T), 1e-6), 'one at 52 m is faded by the distance');

  // Fighters with no saber or a dark one, and a list shorter than the last frame's.
  ok(collectBlades(out, [], fighters([null, blade(0, -4, 0xffffff, false)]), eye) === 0 && out.count === 0, 'no saber, or a dark one, gives nothing, and last frame\'s count is not kept');
  ok(collectBlades(out, [], [], eye) === 0, 'no blades at all is an empty list');
}

// --- the pooled lights the fighters' glows take with the glow pass off: the nearest two, nearest first ---

{
  const out: FighterGlow[] = [0, 1].map(() => ({ pos: new THREE.Vector3(), color: 0, d2: 0 }));
  const at = (x: number) => new THREE.Vector3(x, 0, 0);
  let n = 0;
  n = keepNearestGlow(out, n, at(5), 0xaa0000, 25);
  ok(n === 1 && out[0].color === 0xaa0000 && out[0].d2 === 25, 'into an empty list');
  n = keepNearestGlow(out, n, at(3), 0x00bb00, 9);
  ok(n === 2 && out[0].color === 0x00bb00 && out[1].color === 0xaa0000, 'a nearer second goes first');
  n = keepNearestGlow(out, n, at(4), 0x0000cc, 16);
  ok(n === 2 && out[0].color === 0x00bb00 && out[1].color === 0x0000cc && out[1].pos.x === 4, 'one between takes the second place and the farthest falls off');
  n = keepNearestGlow(out, n, at(9), 0xdddddd, 81);
  ok(n === 2 && out[0].d2 === 9 && out[1].d2 === 16, 'one farther than both, with the list full, is left out');
  n = keepNearestGlow(out, n, at(1), 0x111111, 1);
  ok(n === 2 && out[0].color === 0x111111 && out[1].color === 0x00bb00 && out[1].pos.x === 3, 'a nearest of all pushes the rest down, each keeping its own colour and place');
  ok(out[0] !== out[1], 'the two kept entries stay two objects');
  const tie: FighterGlow[] = [0, 1, 2].map(() => ({ pos: new THREE.Vector3(), color: 0, d2: 0 }));
  let m = keepNearestGlow(tie, 0, at(2), 1, 4);
  m = keepNearestGlow(tie, m, at(-2), 2, 4);
  ok(m === 2 && tie[0].color === 1 && tie[1].color === 2, 'at the same distance the first found stays first');
}

// --- the light ceiling: the brightest a white surface near the blades is from every other light ---

{
  const list = createBladeList();
  const eye = new THREE.Vector3(0, 1.5, 0);
  const calls: number[] = [];
  const world = { litIrradianceNear: (p: THREE.Vector3, reach: number) => (calls.push(reach), p.z < -5 ? 4 : 1) };
  const effects = { litIrradianceNear: (p: THREE.Vector3) => (p.z < -5 ? 0.5 : 2) };
  const src: LitSources = { world, effects, torch: null, eye };
  ok(litCeiling(list, src) === 1 && calls.length === 0, 'an empty list reads 1 and asks nothing');
  collectBlades(list, [], [{ saber: { glowing: true, drawnBase: new THREE.Vector3(0, 1, -2), drawnTip: new THREE.Vector3(0, 2, -2), ignition: 1, color: new THREE.Color(1, 1, 1) } }, { saber: { glowing: true, drawnBase: new THREE.Vector3(0, 1, -8), drawnTip: new THREE.Vector3(0, 2, -8), ignition: 1, color: new THREE.Color(1, 1, 1) } }] as unknown as Npc[], eye);
  ok(near(litCeiling(list, src), 4.5 / Math.PI, 1e-9), 'the most over the blades of world plus pool, over pi');
  ok(calls.every((r) => r === T.range), "each read asks for the blade's reach");
  const torch = new THREE.SpotLight(0xffffff, 10, 0, Math.PI / 4, 0, 2);
  src.torch = torch;
  // The near blade's middle is 2.06 m from the eye, within the reach, so the torch counts at full.
  ok(near(litCeiling(list, src), (1 + 2 + 10) / Math.PI, 1e-9), 'a torch on adds its light near the eye');
  torch.intensity = 0;
  ok(near(litCeiling(list, src), 4.5 / Math.PI, 1e-9), 'a torch at 0 adds nothing');
}

// --- the constants agree with one another and with the shader's sizes ---

ok(BLADE_GLOW_MAX === 8, 'eight blades a frame, the size of the uniform arrays');
ok(BLADE_GLOW_MARCH.steps === 8, 'eight taps a march');
ok(T.fadeFrom < T.far, 'the distance fade starts before it ends');
ok(BLADE_GLOW_MARCH.near < BLADE_GLOW_MARCH.nearFull, 'the march fades in over a distance');
ok(BLADE_GLOW_MARCH.skipEnd + BLADE_GLOW_MARCH.minSpan < BLADE_GLOW_MARCH.near, 'every path long enough to count is long enough to march');
ok(BLADE_GLOW_GUARD.ratioFrom < BLADE_GLOW_GUARD.ratioTo && BLADE_GLOW_GUARD.lumFrom < BLADE_GLOW_GUARD.lumTo, 'the guard fades in over a range');
ok(T.whiteness >= 0 && T.whiteness < 1 && T.hue >= 0 && T.hue <= 1 && T.glowDim > 0 && T.glowDim <= 1, 'the colour terms sit inside 0 to 1');

console.log(`\n${passed} checks passed`);
