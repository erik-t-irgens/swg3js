// The lightsaber glow's arithmetic, checked without a browser: the light curve, the brightness
// guard, the screen box the pass works in and the march that stops the light at walls. The shader
// in `src/core/fx/bladeGlow.ts` is built from the same constants and is meant to implement the same
// formulas; node compiles no GLSL, so what pins the shader itself is narrower: its real source is
// built here and read for each retune expression as written (the facing mix, the smoothing before
// the turn to the eye, the kept brightness, the ring taps and their closing), and scanned for a name
// declared twice in one scope, which is the one mistake a GLSL compiler refuses that no type check
// here would see (it once left the whole pass unlinked).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { bladeGlowShader } from '../../../src/core/fx/bladeGlow.ts';
import {
  BLADE_GLOW_GUARD,
  BLADE_GLOW_MARCH,
  BLADE_GLOW_MAX,
  BLADE_GLOW_TUNE,
  KEEP_ALBEDO_FLOOR,
  SMOOTH_RING_INNER,
  SMOOTH_RING_OUTER,
  closestOnSegment,
  distanceFade,
  emptyRect,
  facing,
  glowGuard,
  irradiance,
  keptAlbedo,
  lightRect,
  luminance,
  marchVisibility,
  marchWeight,
  pointIrradiance,
  radiance,
  ringNewell,
  segmentDistanceSq,
  smoothedNormal,
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
/** The floor as the shader writes it, a GLSL float literal. */
const KEEP_ALBEDO_FLOOR_TEXT = /[.eE]/.test(String(KEEP_ALBEDO_FLOOR)) ? String(KEEP_ALBEDO_FLOOR) : `${KEEP_ALBEDO_FLOOR}.0`;

/** One GLSL function's whole text, from its return type to its closing brace; '' when there is none. */
function glslFunction(glsl: string, name: string): string {
  const m = new RegExp(`\\b\\w+\\s+${name}\\s*\\(`).exec(glsl);
  if (!m) return '';
  const open = glsl.indexOf('{', m.index + m[0].length);
  if (open < 0) return '';
  let depth = 0;
  for (let j = open; j < glsl.length; j++) {
    if (glsl[j] === '{') depth++;
    else if (glsl[j] === '}' && --depth === 0) return glsl.slice(m.index, j + 1);
  }
  return '';
}

/**
 * Every name a GLSL source declares twice in one scope, as `function: name`. A small scanner and not a
 * compiler: it follows braces, a function's parameters (which share its body's scope in GLSL ES 3.00),
 * a for loop's own scope, and declarations of the built-in types, which is all these shaders write.
 * Where it is unsure it opens a new scope, so it can miss a fault but never invents one.
 */
function redeclared(glsl: string): string[] {
  const text = glsl
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/^\s*#[^\n]*/gm, ' ');
  const tokens = text.match(/[A-Za-z_]\w*|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+|\S/g) ?? [];
  const TYPES = new Set(['void', 'bool', 'int', 'uint', 'float', 'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4', 'uvec2', 'uvec3', 'uvec4', 'bvec2', 'bvec3', 'bvec4', 'mat2', 'mat3', 'mat4', 'sampler2D', 'sampler3D', 'samplerCube', 'sampler2DShadow', 'isampler2D', 'usampler2D']);
  const QUALIFIERS = new Set(['const', 'in', 'out', 'inout', 'highp', 'mediump', 'lowp', 'uniform', 'varying', 'attribute', 'flat', 'smooth', 'centroid']);
  const isIdent = (t: string | undefined) => !!t && /^[A-Za-z_]\w*$/.test(t) && !TYPES.has(t) && !QUALIFIERS.has(t);
  type Scope = { names: Set<string>; endsFor: Scope | null; forHeader: number; single: boolean };
  const scope = (): Scope => ({ names: new Set(), endsFor: null, forHeader: -1, single: false });
  const stack: Scope[] = [scope()];
  const out: string[] = [];
  let fnName = '';
  let paren = 0;
  let params: Scope | null = null;
  let paramsParen = -1;
  let paramsDone = false;
  let afterFor: Scope | null = null;
  const declare = (into: Scope, name: string) => {
    if (into.names.has(name)) out.push(`${fnName || '(global)'}: ${name}`);
    into.names.add(name);
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (afterFor && t !== '{') {
      // A loop whose body is one statement: its scope closes at that statement's end.
      afterFor.single = true;
      afterFor = null;
    }
    if (t === 'for' && tokens[i + 1] === '(') {
      const s = scope();
      s.forHeader = paren;
      stack.push(s);
      continue;
    }
    if (t === '(') {
      paren++;
      continue;
    }
    if (t === ')') {
      paren--;
      const top = stack[stack.length - 1];
      if (top.forHeader === paren && !top.single && afterFor === null && params === null) {
        top.forHeader = -1;
        afterFor = top;
      }
      if (params && paren === paramsParen) paramsDone = true;
      continue;
    }
    if (t === '{') {
      const s = scope();
      if (params && paramsDone) {
        s.names = params.names;
        params = null;
        paramsDone = false;
      } else if (afterFor) {
        s.endsFor = afterFor;
        afterFor = null;
      }
      stack.push(s);
      continue;
    }
    if (t === '}') {
      const s = stack.pop();
      if (s?.endsFor) stack.pop();
      if (stack.length === 1) fnName = '';
      continue;
    }
    if (t === ';') {
      const top = stack[stack.length - 1];
      if (top.single && paren === 0) stack.pop();
      if (params && paramsDone) {
        // A prototype, not a definition.
        params = null;
        paramsDone = false;
      }
      continue;
    }
    if (!TYPES.has(t) || !isIdent(tokens[i + 1])) continue;
    const name = tokens[i + 1];
    const next = tokens[i + 2];
    if (next === '(' && stack.length === 1) {
      // A function: overloads may share a name, so it is not declared; its parameters wait for its body.
      fnName = name;
      params = scope();
      paramsParen = paren;
      paramsDone = false;
      i++;
      continue;
    }
    if (params && !paramsDone) {
      declare(params, name);
      i++;
      continue;
    }
    if (next === '=' || next === ';' || next === ',' || next === '[' || next === ')') {
      declare(stack[stack.length - 1], name);
      i++;
    }
  }
  return out;
}

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
ok(wrapLambert(-T.wrap, T.wrap) === 0 && wrapLambert(-1, T.wrap) === 0, 'a surface turned away past the wrap takes none');
ok(near(wrapLambert(0, T.wrap), T.wrap / (1 + T.wrap), 1e-12), 'a surface side-on takes wrap / (1 + wrap)');

// --- the retune against the facets: the wrap, the facing-blind share, the kept brightness ---

ok(T.wrap >= 0.7 && T.wrap <= 1, `the wrap stands most of the way to 1 (${T.wrap}), where it was 0.3`);
ok(T.flat > 0 && T.flat < 1, `a share of the light (${T.flat}) ignores which way the surface faces`);
ok(facing(1, T) === 1, 'a surface facing the blade still takes all of it');
ok(near(facing(-1, T), T.flat, 1e-12), 'one turned right away takes the facing-blind share and no more');
{
  // Two faces of a body 40 degrees apart, both turned toward the blade: how far apart their light is,
  // which is the edge the eye sees. The retune must close most of that step.
  const was: typeof T = { ...T, wrap: 0.3, flat: 0 };
  const a = Math.cos((20 * Math.PI) / 180);
  const b = Math.cos((60 * Math.PI) / 180);
  const stepWas = facing(a, was) - facing(b, was);
  const stepNow = facing(a, T) - facing(b, T);
  ok(stepNow < stepWas * 0.6, `between two faces 40 degrees apart the light now steps ${stepNow.toFixed(3)}, where it stepped ${stepWas.toFixed(3)}`);
  let falls = true;
  for (let c = -1; c < 1 - 1e-9; c += 0.05) if (!(facing(c + 0.05, T) >= facing(c, T))) falls = false;
  ok(falls, 'and the light still never rises as a surface turns away');
}
ok(radiance(1, 1, T) === (irradiance(1, T) * T.albedo) / Math.PI, 'the floor under the blade takes the whole term, as before');
ok(near(radiance(1, -1, T), (irradiance(1, T) * T.flat * T.albedo) / Math.PI, 1e-12), 'a ceiling turned away takes the facing-blind share of it');
{
  const was: typeof T = { ...T, keep: 0 };
  ok(keptAlbedo(0.1, 1, 1, was) === 1 && keptAlbedo(0.9, 1, 1, was) === 1, 'with nothing kept the albedo is the hue alone, as the pass had it');
  ok(near(keptAlbedo(T.albedo, 1, 1, T), 1, 1e-12), 'a surface as bright as the assumed albedo is lit as before');
  ok(keptAlbedo(0.9, 1, 1, T) > 1 && keptAlbedo(0.05, 1, 1, T) < 1, 'a bright texel takes more of the light and a dark one less, so the detail shows');
  ok(near(keptAlbedo(5, 1, 1, T), 1 + (1 / T.albedo - 1) * T.keep, 1e-12), 'nothing brighter than the light ceiling counts for more than a white surface');
  ok(keptAlbedo(0.9, 1, 0, T) === 1, 'over a pixel taken for glow nothing is kept');
  ok(keptAlbedo(0, 1, 1, T) >= 1 - T.keep - 1e-12, `a black texel keeps ${(1 - T.keep).toFixed(2)} of the light, never none`);
}

// --- the smoothed normal: two rings round the pixel, Newell's sum, never across a silhouette ---

{
  ok(SMOOTH_RING_INNER.length === 8 && SMOOTH_RING_OUTER.length === 16, 'two rings, eight and sixteen taps: with the pixel, the 5 by 5 square');
  const all = [...SMOOTH_RING_INNER, ...SMOOTH_RING_OUTER];
  ok(new Set(all.map(([x, y]) => `${x},${y}`)).size === 24 && all.every(([x, y]) => Math.max(Math.abs(x), Math.abs(y)) === (SMOOTH_RING_INNER.some(([a, b]) => a === x && b === y) ? 1 : 2)), 'every tap of the square once, each in its own ring');
  const turns = (ring: readonly (readonly [number, number])[]) => {
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[(i + 1) % ring.length];
      s += x0 * y1 - x1 * y0;
    }
    return s;
  };
  ok(turns(SMOOTH_RING_INNER) > 0 && turns(SMOOTH_RING_OUTER) > 0, 'both rings run counter-clockwise on the screen');

  // A surface's points for a ring, at a view-space point P with a pixel `step` metres wide, from a height field z(x, y).
  const P = { x: 0, y: 0, z: -3 };
  const step = 0.01;
  const tapsOn = (ring: readonly (readonly [number, number])[], depth: (x: number, y: number) => number) =>
    ring.map(([i, j]) => ({ x: i * step, y: j * step, z: depth(i * step, j * step) - P.z }));
  const out = { x: 0, y: 0, z: 0 };
  // A plane tilted 30 degrees about x: its normal, smoothed, is its normal.
  const tilt = Math.tan(Math.PI / 6);
  const plane = (_x: number, y: number) => P.z + y * tilt;
  const nPlane = { x: 0, y: -Math.sin(Math.PI / 6), z: Math.cos(Math.PI / 6) };
  smoothedNormal(P, nPlane, tapsOn(SMOOTH_RING_INNER, plane), tapsOn(SMOOTH_RING_OUTER, plane), T, out);
  ok(near(out.x, nPlane.x, 1e-9) && near(out.y, nPlane.y, 1e-9) && near(out.z, nPlane.z, 1e-9), 'on a flat face the smoothed normal is the face\'s own');
  // A ridge: two faces each 25 degrees off the view meeting a tap's width to the right of the pixel,
  // which is on the left face. Its nearest-neighbour normal is the left face's; smoothed, it leans
  // toward the right face's, and stops short of it.
  const k = Math.tan((25 * Math.PI) / 180);
  const depth = (x: number) => P.z - Math.abs(x - step) * k + step * k;
  const left = { x: -Math.sin((25 * Math.PI) / 180), y: 0, z: Math.cos((25 * Math.PI) / 180) };
  ok(near(depth(-step) - depth(0), -step * k, 1e-12), 'the pixel is on the left face (its depth falls away to the left)');
  smoothedNormal(P, left, tapsOn(SMOOTH_RING_INNER, depth), tapsOn(SMOOTH_RING_OUTER, depth), T, out);
  ok(out.x > left.x + 0.05 && out.x < -left.x, `across a ridge the normal leans toward the other face and stops short of it (x ${out.x.toFixed(3)}, the faces' ${left.x.toFixed(3)} and ${(-left.x).toFixed(3)})`);
  // The same ridge with the smoothing off is the face's own.
  smoothedNormal(P, left, tapsOn(SMOOTH_RING_INNER, depth), tapsOn(SMOOTH_RING_OUTER, depth), { ...T, smooth: 0 }, out);
  ok(near(out.x, left.x, 1e-12) && near(out.z, left.z, 1e-12), 'with the smoothing at 0 it is the nearest-neighbour normal exactly');
  // A silhouette: the right half of the kernel is a wall 2 m behind. Those taps leave the plane and are
  // skipped, so the normal stays the near surface's.
  const sil = (x: number, y: number) => (x > step * 0.5 ? P.z - 2 : plane(x, y));
  smoothedNormal(P, nPlane, tapsOn(SMOOTH_RING_INNER, sil), tapsOn(SMOOTH_RING_OUTER, sil), T, out);
  ok(near(out.x, nPlane.x, 1e-6) && near(out.y, nPlane.y, 1e-6) && near(out.z, nPlane.z, 1e-6), 'taps across a silhouette are left out: the normal stays the near surface\'s');
  // Too few taps to close a ring: the nearest-neighbour normal.
  const lone = (x: number, y: number) => (Math.abs(x) + Math.abs(y) > step * 1.5 ? P.z - 5 : plane(x, y));
  smoothedNormal(P, nPlane, tapsOn(SMOOTH_RING_INNER, lone).slice(0, 2), [], T, out);
  ok(near(out.z, nPlane.z, 1e-12), 'fewer than three taps that count leave the normal as it was');
  // Always turned to face the eye.
  smoothedNormal(P, { x: -nPlane.x, y: -nPlane.y, z: -nPlane.z }, tapsOn(SMOOTH_RING_INNER, plane), tapsOn(SMOOTH_RING_OUTER, plane), T, out);
  ok(-(out.x * P.x + out.y * P.y + out.z * P.z) > 0, 'and it always faces the eye');
  const sum = { x: 0, y: 0, z: 0 };
  ok(ringNewell(tapsOn(SMOOTH_RING_INNER, plane), nPlane, T.smoothTol, sum) === 8 && sum.z > 0, "Newell's sum over a ring on a face toward the eye points at the eye");
}

// --- the shader carries every number the retune moves ---

{
  const src = readFileSync(new URL('../../../src/core/fx/bladeGlow.ts', import.meta.url), 'utf8');
  const missing = ['uFlat', 'uSmooth', 'uSmoothPx', 'uSmoothTol', 'uKeep'].filter((u) => !src.includes(`uniform float ${u};`) || !src.includes(`u.${u}.value = T.`));
  ok(missing.length === 0, `the pass declares and writes every retune uniform each frame${missing.length ? `: missing ${missing.join(', ')}` : ''}`);
  ok(src.includes("glslRing('RING_IN', SMOOTH_RING_INNER)") && src.includes("glslRing('RING_OUT', SMOOTH_RING_OUTER)"), 'and builds its rings from the very tables pinned above');
}

// --- the shader as built: the retune's expressions, and no name declared twice ---

{
  const frag = bladeGlowShader().fragmentShader;
  const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
  const text = flat(frag);
  const has = (line: string) => text.includes(flat(line));
  const fn = (name: string) => flat(glslFunction(frag, name));
  const light = fn('bladeLight');
  ok(light.length > 0 && fn('ringTap').length > 0 && fn('smoothNormal').length > 0, 'the built shader has its light, its ring tap and its smoothing');
  // facing(): the wrapped Lambert term with uFlat of it facing-blind.
  ok(light.includes(flat('float face = mix(clamp((dot(n, q / max(d, 1e-4)) + uWrap) / (1.0 + uWrap), 0.0, 1.0), 1.0, clamp(uFlat, 0.0, 1.0));')), 'the light takes facing(): mix(wrapLambert, 1, flat)');
  ok(light.includes(flat('vec3 contrib = uColor[i] * (irradiance(dd, d) * face);')), 'and every blade\'s light is its irradiance times that');
  // smoothedNormal(): the smoothing, guarded, ahead of the turn to face the eye.
  const smoothAt = light.indexOf(flat('if (uSmooth > 0.0) n = smoothNormal(P, n, px, size);'));
  const flipAt = light.indexOf(flat('if (dot(n, -P) < 0.0) n = -n;'));
  ok(smoothAt > 0 && flipAt > smoothAt, 'the normal is smoothed (only with the smoothing on) before it is turned to face the eye');
  const smooth = fn('smoothNormal');
  ok(smooth.includes(flat('vec3 n = mix(n0, m, clamp(uSmooth, 0.0, 1.0));')) && smooth.includes(flat('if (dot(m, n0) < 0.0) m = -m;')) && smooth.includes(flat('if (len < 1e-12) return n0;')), "the two rings' normal is mixed in by smooth, turned to n0's side, and n0 kept where no ring counted");
  ok((smooth.match(/if \(count >= 3\) sum \+= ring \+ cross\(prev, first\);/g) ?? []).length === 2, "each ring is closed (last tap to first) and added only with three taps or more, as ringNewell's");
  // ringNewell(): a tap leaving the plane by more than smoothTol of its length is skipped; the sum runs prev x S.
  const tap = fn('ringTap');
  ok(tap.includes(flat('if (len < 1e-9 || abs(dot(S, n0)) > uSmoothTol * len) return;')), 'a ring tap off the pixel\'s plane is left out, as ringNewell leaves it');
  ok(tap.includes(flat('if (count == 0) first = S;')) && tap.includes(flat('else sum += cross(prev, S);')) && tap.indexOf('prev = S;') > tap.indexOf('cross(prev, S)'), "and the taps are summed prev x S in order, the first kept for the closing");
  // keptAlbedo(): luminance over the ceiling over the assumed albedo, mixed in by keep and the guard.
  const keptAt = light.indexOf(flat('float kept = clamp(lum / max(uLitCeiling, 1e-3), 0.0, 1.0) / max(uAlbedo, KEEP_ALBEDO_FLOOR);'));
  const keepAt = light.indexOf(flat('albedo *= mix(1.0, kept, clamp(uKeep, 0.0, 1.0) * guard);'));
  ok(keptAt > light.indexOf('vec3 albedo =') && keepAt > keptAt && light.indexOf('return light * albedo') > keepAt, 'the albedo keeps the pixel\'s own brightness as keptAlbedo does, after the hue and before it is used');
  ok(has(`const float KEEP_ALBEDO_FLOOR = ${KEEP_ALBEDO_FLOOR_TEXT};`), 'with the floor the node copy uses');

  // No name declared twice in one scope. The scanner is checked first on the fault it was written for.
  const broken = frag.replace('float kept = clamp(', 'float own = clamp(').replace('mix(1.0, kept,', 'mix(1.0, own,');
  ok(redeclared(broken).includes('bladeLight: own'), "the scope scan finds a second `own` in bladeLight, the mistake that left the pass unlinked");
  ok(redeclared('void f(float a) { float b = 1.0; for (int i = 0; i < 2; i++) { float b = 2.0; } for (int i = 0; i < 2; i++) b += 1.0; }').length === 0, 'and passes a name declared again in a block or a loop of its own');
  const twice = redeclared(frag);
  ok(twice.length === 0, `no name in the built shader is declared twice in one scope${twice.length ? `: ${twice.join(', ')}` : ''}`);
}

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

// --- gathering the blades: the player's first, then the fighters and mobiles nearest the eye, eight at most ---

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

  // The catalogue's people (mobiles) are gathered with the fighters, the nearest of either first.
  collectBlades(out, [], fighters([blade(0, -9, 0xffffff), blade(0, -20, 0xffffff)]), eye, fighters([blade(0, -4, 0xff0000), null, blade(0, -15, 0xff0000)]));
  ok(out.count === 4 && out.items.slice(0, out.count).map((e) => -e.a.z).join() === '4,9,15,20', "a mobile's lit blade joins the fighters', nearest first");
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
  const src: LitSources = { world, effects, torch: null };
  ok(litCeiling(list, src) === 1 && calls.length === 0, 'an empty list reads 1 and asks nothing');
  collectBlades(list, [], [{ saber: { glowing: true, drawnBase: new THREE.Vector3(0, 1, -2), drawnTip: new THREE.Vector3(0, 2, -2), ignition: 1, color: new THREE.Color(1, 1, 1) } }, { saber: { glowing: true, drawnBase: new THREE.Vector3(0, 1, -8), drawnTip: new THREE.Vector3(0, 2, -8), ignition: 1, color: new THREE.Color(1, 1, 1) } }] as unknown as Npc[], eye);
  ok(near(litCeiling(list, src), 4.5 / Math.PI, 1e-9), 'the most over the blades of world plus pool, over pi');
  ok(calls.every((r) => r === T.range), "each read asks for the blade's reach");
  const torch = new THREE.SpotLight(0xffffff, 10, 0, Math.PI / 4, 0, 2);
  torch.position.copy(eye);
  src.torch = torch;
  // The near blade's middle is 2.06 m from the torch, within the reach, so the torch counts at full.
  ok(near(litCeiling(list, src), (1 + 2 + 10) / Math.PI, 1e-9), 'a torch on adds its light near where it is carried');
  // Carried 10 m behind the eye: 12 and 18 m from the two blades' middles, so it falls off past the reach.
  torch.position.set(0, 1.5, 10);
  const want = Math.max(1 + 2 + 10 / (12 - T.range) ** 2, 4 + 0.5 + 10 / (18 - T.range) ** 2);
  ok(near(litCeiling(list, src), want / Math.PI, 1e-9), "the torch is measured from where it is carried, not from the camera's eye");
  torch.position.copy(eye);
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
