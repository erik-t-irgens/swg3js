// The ground's fragment shader, assembled exactly as the game assembles it.
//
// Three separate injections write into it at `#include <common>` -- the ground's own textures, the
// weather's, and the bumps -- and each inserts at the **first** match, so the last one to run lands
// **first** in the file. That is how the bump maps were shipped declaring a `sampler2DArray` above
// the `precision` line that gives it a precision, and calling `groundSlope()` above every uniform
// and varying it reads. A shader that will not compile does not draw a worse ground; it draws none,
// and the whole terrain went with it.
//
// So this checks the one thing a reading of the code will not: that in the string the renderer is
// really handed, every name is declared before it is used.
//
// Run: node tools/swg/tests/groundShader.test.ts

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { injectGroundNormal } from '../../../src/world/terrainTextures.ts';
import { injectWetness } from '../../../src/world/wetness.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

/** The ground material's own injection, copied from `TerrainTextures.groundMaterial`. */
const GROUND_DECLS_END = '// <ground-declarations-end>';
function injectGround(shader: { fragmentShader: string; vertexShader: string; uniforms: Record<string, unknown>; defines?: Record<string, unknown> }, count: number): void {
  shader.defines = { ...(shader.defines ?? {}), TERRAIN_FAMILIES: count };
  shader.uniforms.uGround = { value: null };
  shader.uniforms.uGroundLayer = { value: new Float32Array(count) };
  shader.uniforms.uGroundSize = { value: new Float32Array(count) };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 aFamily;\nattribute vec3 aBary;\nvarying vec3 vFamily;\nvarying vec3 vBary;\nvarying vec2 vGroundXZ;')
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFamily = aFamily;\nvBary = aBary;\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nprecision highp sampler2DArray;\nuniform sampler2DArray uGround;\nuniform float uGroundLayer[TERRAIN_FAMILIES];\nuniform float uGroundSize[TERRAIN_FAMILIES];\nvarying vec3 vFamily;\nvarying vec3 vBary;\nvarying vec2 vGroundXZ;\nvec4 groundSample(float family) {\n  int id = clamp(int(family + 0.5), 0, TERRAIN_FAMILIES - 1);\n  return texture(uGround, vec3(vGroundXZ / uGroundSize[id], uGroundLayer[id]));\n}\n${GROUND_DECLS_END}`)
    .replace('#include <map_fragment>', '#include <map_fragment>\n{\n  vec3 w = vBary / max(vBary.x + vBary.y + vBary.z, 1e-4);\n  vec4 g = groundSample(vFamily.x) * w.x + groundSample(vFamily.y) * w.y + groundSample(vFamily.z) * w.z;\n  diffuseColor.rgb *= g.rgb;\n}');
}

function build(withBumps: boolean): { fragmentShader: string; vertexShader: string; uniforms: Record<string, unknown> } {
  const lib = THREE.ShaderLib.physical;
  const shader = { fragmentShader: lib.fragmentShader, vertexShader: lib.vertexShader, uniforms: {} as Record<string, unknown>, defines: {} as Record<string, unknown> };
  injectGround(shader, 16);
  injectWetness(shader as never, 'ground');
  if (withBumps) injectGroundNormal(shader, new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1), { value: 1 });
  return shader;
}

// ---------------------------------------------------------------- declared before used

{
  const f = build(true).fragmentShader;
  // The precision line is what gives `sampler2DArray` a precision at all: a uniform of that type
  // declared above it is an error on its own, whatever else is wrong.
  const precision = f.indexOf('precision highp sampler2DArray;');
  ok(precision >= 0, 'the ground declares a precision for its sampler arrays');
  ok(f.indexOf('uniform sampler2DArray uGroundNormal;') > precision, "and the bumps' own sampler is declared below it, not above");

  // Every name the bump block reads, against where it is declared.
  const use = f.indexOf('vec2 groundSlope(float family)');
  ok(use > 0, 'the bump block is in the shader at all');
  for (const [name, decl] of [
    ['uGroundSize', 'uniform float uGroundSize['],
    ['uGroundLayer', 'uniform float uGroundLayer['],
    ['vGroundXZ', 'varying vec2 vGroundXZ;'],
  ] as const) {
    const at = f.indexOf(decl);
    assert.ok(at >= 0 && at < use, `${name} is declared before groundSlope reads it`);
  }
  passed++;
  console.log('ok   and every uniform and varying it reads is declared above it');

  const called = f.indexOf('groundSlope(vFamily.x)');
  ok(called > use, 'the function is defined before the block that calls it');
  for (const [name, decl] of [
    ['vFamily', 'varying vec3 vFamily;'],
    ['vBary', 'varying vec3 vBary;'],
    ['uGroundNormalScale', 'uniform float uGroundNormalScale;'],
  ] as const) {
    const at = f.indexOf(decl);
    assert.ok(at >= 0 && at < called, `${name} is declared before the block that reads it`);
  }
  passed++;
  console.log('ok   as is everything the block itself reads');
}

// ---------------------------------------------------------------- the ground and the weather still agree

{
  const f = build(true).fragmentShader;
  // The ground's own relief must be laid down first and the rain rings over it, or a puddle's
  // surface is wiped out by the grain under it.
  const bump = f.indexOf('vec2 gs = (groundSlope(');
  const rings = f.indexOf('vec2 wetRing = rainRingSlope(');
  const anchor = f.indexOf('#include <normal_fragment_maps>');
  ok(anchor >= 0 && bump > anchor, 'the bump block is written at the normal stage, where a normal exists to change');
  ok(rings > bump, "and the rain's rings are written after it, so a puddle's surface is laid over the ground's grain rather than wiped out by it");
  ok(build(false).fragmentShader.indexOf('groundSlope') < 0, 'a pack with no bump maps gets a shader with no trace of them, which is the ground exactly as it was');
}

// ---------------------------------------------------------------- it refuses rather than breaks

{
  const shader = { fragmentShader: 'void main() {}', uniforms: {} as Record<string, { value: unknown }> };
  const wrote = injectGroundNormal(shader, null, { value: 1 });
  ok(!wrote && shader.fragmentShader === 'void main() {}', 'a shader with nowhere to put them is left exactly as it was, rather than handed something that will not compile');
}

console.log(`\n${passed} checks passed`);
