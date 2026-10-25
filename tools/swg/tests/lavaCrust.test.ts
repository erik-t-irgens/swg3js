// The lava's crust carried by the liquid's current (the volumetrics' fifth wave, the design's §2.9; `airLiquid.ts`'s
// `lavaCrustMaterial`): the twin is the lava's own text with exactly its carry made in (all of it or none, null where the
// base's text has moved), keyed by a define of its own, every uniform object shared with its base by reference (so the
// flow's clock and the far means the world writes into the base reach it) and the session's liquid record beside them;
// the base's text and key never move, and the twin's replacements undone, last first, give the base's text back to the
// byte; the carry's work said in this test's own words (the world place written and read, the shift first, the noise and
// the picture through the carried reads); the twin's own `lavaCrustShift` and `lavaCrustNoise`, run as script, are
// continuous where each phase restarts (the restarting one weighs nought there) and read each phase's carry by its own
// seconds; and the twin's text passes the GLSL scans.
//
// The lava's module names its neighbours without an extension, so this suite registers the off-proof's loader over
// today's tree alone (`airLoader.mjs`).
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './airTrees.ts';
import { glslVariant, redeclared, reservedWords, unbalanced, undefinedCalls, uniformNames } from './glslScan.ts';
import { glslFunctionText, glslFunctions } from './glslRun.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const SRC = join(REPO, 'src');
register(pathToFileURL(join(REPO, 'tools', 'swg', 'tests', 'airLoader.mjs')).href, import.meta.url, { data: { roots: [SRC], packageBase: join(REPO, 'package.json') } });
const load = async (p: string): Promise<Record<string, unknown>> => (await import(pathToFileURL(join(SRC, p)).href)) as Record<string, unknown>;
const L = (await load('world/volumetrics/airLiquid.ts')) as typeof import('../../../src/world/volumetrics/airLiquid.ts');
const LAVA = (await load('world/lava.ts')) as typeof import('../../../src/world/lava.ts');
const STYLE = (await load('world/lavaStyle.ts')) as typeof import('../../../src/world/lavaStyle.ts');

// --- the twin ---
{
  const tex = LAVA.standInLavaTextures();
  let all = true;
  for (const mix of [false, true]) {
    const t = mix ? { ...tex, mix: tex.ramp } : tex;
    const base = LAVA.createLavaMaterial(STYLE.FALLBACK_LAVA_STYLE, 2, t);
    const before = `${base.customProgramCacheKey()}|${JSON.stringify(base.defines)}|${base.vertexShader}|${base.fragmentShader}`;
    const twin = L.lavaCrustMaterial(base);
    if (!twin) {
      all = false;
      continue;
    }
    const after = `${base.customProgramCacheKey()}|${JSON.stringify(base.defines)}|${base.vertexShader}|${base.fragmentShader}`;
    if (before !== after) all = false;
    const text = L.lavaCrustText(base.vertexShader, base.fragmentShader);
    if (!text || text.vertex !== twin.vertexShader || text.fragment !== twin.fragmentShader) all = false;
    // Exactly its carry made in: each replacement's text is in the twin once, and taken out again, last first, the
    // base's own text comes back to the byte.
    const undo = (s: string, edits: readonly (readonly [string, string])[]): string | null => {
      let out: string | null = s;
      for (const [from, to] of [...edits].reverse()) {
        if (out === null) return null;
        const i = out.indexOf(to);
        if (i < 0 || out.indexOf(to, i + to.length) >= 0) return null;
        out = out.slice(0, i) + from + out.slice(i + to.length);
      }
      return out;
    };
    if (undo(twin.vertexShader, L.LAVA_CRUST_EDITS.vertex) !== base.vertexShader || undo(twin.fragmentShader, L.LAVA_CRUST_EDITS.fragment) !== base.fragmentShader) all = false;
    // What the carry must say, in this test's own words (so a replacement emptied of its work is caught however the
    // module spells it): the vertex stage writes the world place the fragment reads, and the fragment works the shift out
    // first, takes the main noise and the crust's picture through the carried reads, and declares the shift's globals.
    const vOk = twin.vertexShader.includes('varying vec3 vLavaWorld;') && twin.vertexShader.includes('vLavaWorld = world.xyz;');
    const fOk = twin.fragmentShader.includes('  lavaCrustShift();') && twin.fragmentShader.includes('float index = lavaCrustNoise(tNoise, vNoiseTc, lavaGx, lavaGy) * uColorScale + uColorBias;') && twin.fragmentShader.includes('vec3 crust = lavaCrustMix(tMix, vNoiseTc.xz + index * 0.1, lavaGx.xz, lavaGy.xz);') && /\nvec3 lavaCrustA;\nvec3 lavaCrustB;\nfloat lavaCrustK;\n/.test(twin.fragmentShader);
    if (!vOk || !fOk) all = false;
    if ((twin.defines as Record<string, string>).LAVA_AIR !== '' || (base.defines as Record<string, string>).LAVA_AIR !== undefined) all = false;
    if (mix !== ((twin.defines as Record<string, string>).USE_MIX === '')) all = false;
    // Every uniform object shared by reference, the session's record beside them.
    for (const k of Object.keys(base.uniforms)) if (twin.uniforms[k] !== base.uniforms[k]) all = false;
    for (const k of Object.keys(L.LIQUID_U)) if (twin.uniforms[k] !== (L.LIQUID_U as unknown as Record<string, unknown>)[k]) all = false;
    // Every uniform its text declares is on it.
    const defs = new Set(Object.keys(twin.defines as Record<string, unknown>));
    const declared = uniformNames(glslVariant(twin.fragmentShader, defs)).concat(uniformNames(glslVariant(twin.vertexShader, defs)));
    if (declared.some((n) => !(n in twin.uniforms) && !['modelMatrix', 'viewMatrix', 'projectionMatrix', 'cameraPosition', 'isOrthographic'].includes(n))) all = false;
    // The flow's clock written into the base reaches the twin.
    base.uniforms.uFlowTime.value = 7.25;
    if (twin.uniforms.uFlowTime.value !== 7.25) all = false;
    const f = glslVariant(twin.fragmentShader, defs);
    if (reservedWords(f).length || unbalanced(f) !== '' || redeclared(f).length || twin.fragmentShader.includes('`')) all = false;
    const calls = undefinedCalls(f).filter((c) => !['texture2D'].includes(c));
    if (calls.length) {
      console.log(`     calls not defined: ${calls.join(', ')}`);
      all = false;
    }
    twin.dispose();
    base.dispose();
  }
  ok(all, "the crust twin, with and without the crust's picture: the base's text and key untouched, the twin's text exactly its carry made in, a define of its own, every uniform object shared with its base (the flow's clock reaches it) and the session's liquid record beside them; its text passes the scans");
  ok(L.lavaCrustText('void main() {}', 'void main() {}') === null, "a base whose text has moved gets no twin at all (null), never a twin half made");
}

// --- the crust's phases, through the twin's own shift and noise ---
{
  // The twin's own `lavaCrustShift` and `lavaCrustNoise`, out of its compiled text, run as script (`glslRun.ts`) over a
  // one-dimensional crust: the noise picture n(x) a smooth pattern, the current c along the axis at the full share and
  // the window's middle, every axis and scale one. The phases come from the field's own arithmetic (`crustPhaseIn`).
  const tex = LAVA.standInLavaTextures();
  const base = LAVA.createLavaMaterial(STYLE.FALLBACK_LAVA_STYLE, 2, { ...tex, mix: tex.ramp });
  const twin = L.lavaCrustMaterial(base)!;
  const noise = (x: number) => Math.sin(x * 1.7) + 0.5 * Math.sin(x * 4.3 + 1);
  const c = 0.8;
  const cycle = 3;
  const P = { x: 0, y: 1, z: 1, w: 0 };
  const Q = { x: 0, y: 0, z: 0, w: 1 / cycle };
  const globals = 'vec3 lavaCrustA;\nvec3 lavaCrustB;\nfloat lavaCrustK;\n';
  const fns = glslFunctions(globals + glslFunctionText(twin.fragmentShader, 'lavaCrustShift') + '\n' + glslFunctionText(twin.fragmentShader, 'lavaCrustNoise'), ['lavaCrustShift', 'lavaCrustNoise'], {
    uAirLiquidP: P,
    uAirLiquidQ: Q,
    uTcAxes: 1,
    uNoiseScale: 1,
    vLavaWorld: { xz: 0 },
    airLiquidAt: () => ({ x: c, y: 0, z: 1 }),
    vec3: (...a: number[]) => a[0],
    texture: (t: (x: number) => number, tc: number) => ({ r: t(tc) }),
    textureGrad: (t: (x: number) => number, tc: number) => ({ r: t(tc) }),
  });
  const crustAt = (): number => {
    fns.lavaCrustShift();
    return fns.lavaCrustNoise(noise, 0.3, 0, 0) as number;
  };
  const out = { tA: 0, tB: 0, wB: 0 };
  const rec = L.newCrustPhase();
  let continuous = true;
  let worst = 0;
  let placed = true;
  let prev = Number.NaN;
  for (let i = 0; i <= 30000; i++) {
    const t = i * 1e-3;
    L.crustPhasesIn(t, cycle, out);
    rec.time = t;
    rec.cycle = cycle;
    L.crustPhaseIn(rec);
    if (rec.tA !== out.tA || rec.tB !== out.tB || rec.wB !== out.wB) continuous = false;
    if (out.tA < 0 || out.tA >= cycle || out.tB < 0 || out.tB >= cycle || out.wB < 0 || out.wB > 1) continuous = false;
    Q.x = rec.tA;
    Q.y = rec.tB;
    Q.z = rec.wB;
    const v = crustAt();
    // Where one phase weighs it all, the crust is that phase's own read, carried by the current over its own seconds.
    if (rec.wB === 0 && Math.abs(v - noise(0.3 - c * rec.tA)) > 1e-12) placed = false;
    if (rec.wB === 1 && Math.abs(v - noise(0.3 - c * rec.tB)) > 1e-12) placed = false;
    if (Number.isFinite(prev)) worst = Math.max(worst, Math.abs(v - prev));
    prev = v;
  }
  ok(continuous && worst < 0.02, `the crust's two phases: each phase's seconds within its cycle, the record's form the arguments' to the bit, and the twin's own blended crust, run, moves at most ${worst.toFixed(4)} a millisecond across 30 s and ten restarts (no jump where a phase starts again)`);
  ok(placed, "where a phase weighs the whole crust, the twin reads the noise carried by the current over that phase's own seconds (phase A by A's, B by B's)");
  L.crustPhasesIn(0, cycle, out);
  ok(out.tA === 0 && out.wB === 1, 'phase A starts again from nought where it weighs nought (B carries the whole crust there)');
  L.crustPhasesIn(cycle / 2, cycle, out);
  ok(Math.abs(out.tB) < 1e-12 && out.wB === 0, 'and B where B weighs nought');
  // At a share of nought the twin's noise is the base's own sample, by the uniform branch.
  P.y = 0;
  ok(crustAt() === noise(0.3), "at the lava's art share of nought the twin reads the base's own noise, by its branch");
  ok(/vec3 lavaCrustMix\(sampler2D tex, vec2 uv, vec2 gx, vec2 gy\) \{\n  vec3 plain = texture2D\(tex, uv\)\.rgb;\n  if \(lavaCrustK <= 0\.0\) return plain;\n  return mix\(textureGrad\(tex, uv - lavaCrustA\.xz, gx, gy\)\.rgb, textureGrad\(tex, uv - lavaCrustB\.xz, gx, gy\)\.rgb, uAirLiquidQ\.z\);/.test(twin.fragmentShader), "and the crust's picture blends its two carried reads exactly as the noise does (A by A's shift, B by B's, B's weight)");
  twin.dispose();
  base.dispose();
}

// --- the chooser ---
{
  const plain = {};
  const crust = {};
  ok(L.lavaMaterialFor({ on: false, current: true, lava: true, field: true, softOff: false }, plain, crust) === plain && L.lavaMaterialFor({ on: true, current: false, lava: true, field: true, softOff: false }, plain, crust) === crust, "the lava's chooser: today's material by identity with the master off, the crust with the lava on whatever the water's current");
}

console.log(`\n${checks} checks passed`);
