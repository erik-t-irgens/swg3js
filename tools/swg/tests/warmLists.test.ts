// The two closed warm lists the morph ladder makes (the performance pass's second wave): the motion blur's velocity
// variants (`WARM_VARIANTS` in src/core/fx/velocityMath.ts) and the skinned bodies' depth combinations
// (`skinnedDepthCombos` in src/world/floraSway.ts). Each must cover every rung of the ladder by every way its program
// key can differ for a skinned primitive -- alpha or not for a velocity variant; the side three draws the shadow from,
// and plain, pictured or cut for a depth program -- and nothing read off the packs is committed. With the ladder's hatch
// off both are the first wave's (its fourteen variants, no depth combinations), so the hatch compares against the old
// way rather than a mix of the two. With the packs on disk
// (SWG3JS_PACKS, else assets-private) every converted skinned primitive's combination, padded to its rung, must be
// inside both lists; that part prints counts only.
import assert from 'node:assert/strict';
import { closeSync, existsSync, openSync, readdirSync, readSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { variantKey, WARM_VARIANTS, warmVariants } from '../../../src/core/fx/velocityMath.ts';
import { skinnedDepthCombos } from '../../../src/world/floraSway.ts';
import { morphRung, PERSON_KEYS_TUNE, warmLadder } from '../../../src/world/personKeys.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const LADDER = PERSON_KEYS_TUNE.morphLadder;
const velocityKeys = new Set(WARM_VARIANTS.map(variantKey));

// ---- 1. The velocity variants: two rigid, and every rung by alpha. ----
ok(WARM_VARIANTS.length === 2 + LADDER.length * 2, `the velocity warm list is ${WARM_VARIANTS.length}: two rigid and every rung by alpha`);
ok(velocityKeys.size === WARM_VARIANTS.length, 'and no two of them share a key');
for (const alpha of [false, true]) ok(velocityKeys.has(variantKey({ skinned: false, morphs: 0, morphNormals: false, morphColors: false, alpha })), `the rigid variant ${alpha ? 'with' : 'without'} alpha is in it`);
for (const rung of LADDER) {
  for (const alpha of [false, true]) ok(velocityKeys.has(variantKey({ skinned: true, morphs: rung, morphNormals: rung > 0, morphColors: false, alpha })), `the skinned variant at m${rung}${rung ? ' with morph normals' : ''} ${alpha ? 'with' : 'without'} alpha is in it`);
}

// ---- 2. The skinned depth combinations: every rung by side by kind, 27. ----
const sideWord = (s: THREE.Side): string => (s === THREE.FrontSide ? 'back' : s === THREE.DoubleSide ? 'double' : 'front');
const kindOf = (m: THREE.MeshStandardMaterial): string => (m.map && m.alphaTest > 0 ? 'cut' : m.map ? 'map' : 'plain');
const depthKey = (rung: number, normals: boolean, side: string, kind: string): string => `m${rung} n${+normals} ${side} ${kind}`;
const combos = skinnedDepthCombos('warmLists.test');
const depthKeys = new Set<string>();
for (const s of combos) {
  const m = s.material as THREE.MeshStandardMaterial;
  const rung = s.geometry.morphAttributes.position?.length ?? 0;
  depthKeys.add(depthKey(rung, !!s.geometry.morphAttributes.normal, sideWord(m.side), kindOf(m)));
}
ok(combos.length === LADDER.length * 3 * 3 && depthKeys.size === combos.length, `the depth list is ${combos.length}, every one its own key`);
for (const rung of LADDER) for (const side of ['back', 'double', 'front']) for (const kind of ['plain', 'map', 'cut']) ok(depthKeys.has(depthKey(rung, rung > 0, side, kind)), `m${rung} drawn from ${side === 'double' ? 'both sides' : `the ${side}`}, ${kind}, is in it`);
ok(combos.every((s) => s.isSkinnedMesh && s.castShadow && !s.frustumCulled && s.geometry.getAttribute('skinIndex').array instanceof Float32Array), 'every one is a skinned caster, never culled, with joints stored as floats as every skinned mesh is at load');
ok(skinnedDepthCombos('warmLists.test') === combos, 'a set asked for twice is the same list (kept for the session)');
ok(skinnedDepthCombos('warmLists.test, another set') !== combos, 'and another light set has its own');

// ---- 2b. With the ladder's hatch off, the lists are the first wave's: the hatch is the old way, not a hybrid. ----
{
  ok(warmLadder(true) === LADDER && warmLadder(false) === null, 'the warm lists read the ladder with the hatch on and none with it off');
  ok(WARM_VARIANTS.map(variantKey).join() === warmVariants(warmLadder()).map(variantKey).join(), "this session's warm list is the one its hatch says (node has no storage: on)");
  const old = warmVariants(null).map(variantKey);
  const waveOne = [
    ...[false, true].map((alpha) => variantKey({ skinned: false, morphs: 0, morphNormals: false, morphColors: false, alpha })),
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((m) => variantKey({ skinned: true, morphs: m, morphNormals: m > 0, morphColors: false, alpha: false })),
    ...[0, 2, 3, 4].map((m) => variantKey({ skinned: true, morphs: m, morphNormals: m > 0, morphColors: false, alpha: true })),
  ];
  ok(old.length === 14 && old.join() === waveOne.join(), `with no ladder the velocity warm list is the first wave's fourteen, written out here as they stood (${old.length})`);
  ok(skinnedDepthCombos('warmLists.test, hatch off', null).length === 0, 'and no skinned depth combination is warmed, as before the ladder (the counts are the packs\' own then)');
  ok(skinnedDepthCombos('warmLists.test', null) !== combos, 'the list kept for a set with the ladder is not the one without it');
}

// ---- 3. Every converted skinned primitive, padded, is inside both lists (counts only). ----
const PACKS = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private/', import.meta.url));
const FOLDERS = ['wardrobe', 'characters', 'player', join('mobiles', 'models'), join('mobiles', 'wearables'), join('mobiles', 'variants'), 'weapons', 'creatures', 'gallery', 'travel'];
interface GltfJson {
  nodes?: { mesh?: number; skin?: number }[];
  meshes?: { primitives?: { attributes: Record<string, number>; targets?: Record<string, number>[]; material?: number }[] }[];
  materials?: { alphaMode?: string; doubleSided?: boolean; pbrMetallicRoughness?: { baseColorTexture?: unknown } }[];
}
function glbJson(file: string): GltfJson | null {
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(20);
    readSync(fd, head, 0, 20, 0);
    if (head.readUInt32LE(0) !== 0x46546c67 || head.readUInt32LE(16) !== 0x4e4f534a) return null;
    const body = Buffer.alloc(head.readUInt32LE(12));
    readSync(fd, body, 0, body.length, 20);
    return JSON.parse(body.toString('utf8')) as GltfJson;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}
function glbs(dir: string, out: string[]): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) glbs(p, out);
    else if (e.name.endsWith('.glb') && e.name !== 'rig.glb') out.push(p);
  }
  return out;
}
{
  const files = FOLDERS.flatMap((f) => glbs(join(PACKS, f), []));
  if (!files.length) console.log(`skip the packs: no skinned model folder under ${PACKS}`);
  else {
    let primitives = 0;
    let pastTop = 0;
    const missedVelocity = new Map<string, number>();
    const missedDepth = new Map<string, number>();
    const seenVelocity = new Set<string>();
    const seenDepth = new Set<string>();
    const pastTopFiles: string[] = [];
    for (const file of files) {
      const j = glbJson(file);
      if (!j?.meshes) continue;
      const skinned = new Set<number>();
      for (const n of j.nodes ?? []) if (n.skin !== undefined && n.mesh !== undefined) skinned.add(n.mesh);
      for (const mi of skinned) {
        for (const p of j.meshes[mi]?.primitives ?? []) {
          primitives++;
          const t = p.targets?.length ?? 0;
          const rung = morphRung(t);
          if (rung > LADDER[LADDER.length - 1]) {
            pastTop++;
            if (pastTopFiles.length < 8) pastTopFiles.push(`${relative(PACKS, file)} m${t}`);
            continue;
          }
          const normals = t > 0 && (p.targets ?? []).some((x) => x.NORMAL !== undefined);
          const colours = (p.targets ?? []).some((x) => x.COLOR_0 !== undefined);
          const mat = p.material !== undefined ? j.materials?.[p.material] : undefined;
          const map = !!mat?.pbrMetallicRoughness?.baseColorTexture;
          const cut = mat?.alphaMode === 'MASK' && map;
          const vKey = variantKey({ skinned: true, morphs: rung, morphNormals: normals, morphColors: colours, alpha: cut });
          seenVelocity.add(vKey);
          if (!velocityKeys.has(vKey)) missedVelocity.set(vKey, (missedVelocity.get(vKey) ?? 0) + 1);
          const dKey = depthKey(rung, normals, mat?.doubleSided ? 'double' : 'back', cut ? 'cut' : map ? 'map' : 'plain');
          seenDepth.add(dKey);
          if (!depthKeys.has(dKey)) missedDepth.set(dKey, (missedDepth.get(dKey) ?? 0) + 1);
        }
      }
    }
    console.log(`     ${primitives} skinned primitives over ${files.length} models; ${seenVelocity.size} velocity variants and ${seenDepth.size} depth combinations among them after the ladder; ${pastTop} past the top`);
    ok(primitives > 0, 'the packs hold skinned primitives to check');
    ok(missedVelocity.size === 0, `every one's velocity variant, padded to its rung, is in the warm list (${[...missedVelocity].map(([k, n]) => `${k}:${n}`).join(' ') || 'none missed'})`);
    ok(missedDepth.size === 0, `every one's depth combination, padded to its rung, is in the warm list (${[...missedDepth].map(([k, n]) => `${k}:${n}`).join(' ') || 'none missed'})`);
    ok(pastTop === 0, `no converted skinned primitive carries more targets than the top rung, so none keeps its own count (${pastTopFiles.join(', ') || 'none'})`);
  }
}

console.log(`\n${checks} checks passed`);
