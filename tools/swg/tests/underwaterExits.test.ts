// The underwater pass's exits variant (Map-maker II's fifth wave, DESIGN.md §2.7's "looking out of a dry room through a
// doorway under water"): a second material of the pass, drawn in its place only on a frame whose camera stands dry in a
// building one of whose exits stands under water, grading only the region the portal stencil leaves for the world seen
// through the exits. Held here:
// - today's look is untouched: its fragment program's text is 49e5960's to the character (out of git), so its program and
//   its key are today's;
// - the variant's text is today's with exactly two pieces put in (`exitsFragment`), so it is a key of its own, and the
//   GLSL scanner finds in it nothing it does not find in today's (a name declared twice, an unbalanced bracket, a call to a
//   function nobody defines, a reserved word);
// - its frames (`exitsDraws`): only dry, in a building's rooms, an exit under water, the switch on, built and coloured;
// - the registry holds it (`FX_PASS_VARIANTS`) under the names the pass gives its materials, the pass warms both behind
//   every loading screen, its mask reads the stencil the portal renderer leaves and writes none, and the installer hands
//   the pass its host.
//
// Run: node tools/swg/tests/underwaterExits.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { EXITS_HEAD, EXITS_SAMPLER, EXITS_STENCIL, UNDERWATER_REGION_FRAG, exitsDraws, exitsFragment, exitsUnderWater, type ExitWaterAsk, type ExitWaterFound, type ExitsAsk } from '../../../src/core/fx/underwaterExits.ts';
import { lakeTable, surfaceOf } from '../../../src/world/ourWater.ts';
import * as GLSL from '../../../src/core/fx/glsl.ts';
import { FX_PASS_VARIANTS, FX_PASSES } from '../../../src/core/fxRegistry.ts';
import * as MATH from '../../../src/core/fx/underwaterMath.ts';
import { UNDERWATER_TUNE } from '../../../src/core/fx/underwaterMath.ts';
import { redeclared, reservedWords, unbalanced, undefinedCalls } from './glslScan.ts';
import { oldTexts, REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);
const read = (f: string) => readFileSync(join(REPO, f), 'utf8').replace(/\r\n/g, '\n');

/** The look's fragment program as the pass builds it: its template literal out of the file, `${NAME}` filled from glsl.ts. */
function lookFragment(source: string): { raw: string; full: string } {
  const at = source.indexOf('const UNDERWATER = {');
  assert.ok(at >= 0, 'the look is where it was');
  const head = 'fragmentShader: /* glsl */ `';
  const from = source.indexOf(head, at) + head.length;
  const to = source.indexOf('`,', from);
  const raw = source.slice(from, to);
  // glsl.ts's chunks, and the look's own numbers out of underwaterMath.ts (the noise's period and its fine scale).
  const names: Record<string, unknown> = { ...GLSL, ...MATH };
  const full = raw.replace(/\$\{(\w+)\}/g, (_m, name: string) => {
    const v = names[name];
    assert.ok(typeof v === 'string' || typeof v === 'number', `${name} is one of glsl.ts's or underwaterMath.ts's`);
    return String(v);
  });
  return { raw, full };
}

const now = read('src/core/fx/underwater.ts');
const today = lookFragment(now);

{
  // Today's look, untouched.
  const old = oldTexts(['src/core/fx/underwater.ts'], '49e5960')?.get('src/core/fx/underwater.ts');
  if (!old) note("git cannot hand 49e5960's underwater.ts over: today's text is not compared");
  else ok(lookFragment(old).raw === today.raw && today.raw.length > 1000, "today's look's fragment program is 49e5960's to the character: its program and its key are today's");
  ok(/super\(UNDERWATER\);/.test(now), 'and the pass is still made of it');
}

{
  // The variant's text.
  const v = exitsFragment(today.full);
  ok(v !== null, "the variant's text is made from today's (its two anchors there once each)");
  ok(v !== today.full, 'a text of its own, so a program and a key of its own');
  ok(v!.replace(EXITS_SAMPLER, '').replace(EXITS_HEAD, '') === today.full, "today's text with exactly the two pieces put in and nothing taken out");
  ok(v!.split('uniform sampler2D tRegion;').length === 2 && /if \(texture2D\(tRegion, vUv\)\.r < 0\.5\)/.test(v!), 'the region mask declared once and read at the head of main');
  ok(exitsFragment('void main() {}') === null && exitsFragment(today.full.replace('varying vec2 vUv;', '')) === null, 'a text missing an anchor makes no variant (all of it or none)');
  const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  ok(same(redeclared(v!), redeclared(today.full)), 'no name declared twice that today\'s text does not already declare twice');
  ok(unbalanced(v!) === unbalanced(today.full), 'its brackets balance as today\'s do');
  ok(same(undefinedCalls(v!), undefinedCalls(today.full)), 'it calls no function today\'s does not');
  ok(same(reservedWords(v!), reservedWords(today.full)), 'and uses no reserved word');
  ok(undefinedCalls(UNDERWATER_REGION_FRAG).length === 0 && unbalanced(UNDERWATER_REGION_FRAG) === '', "the region mask's own program is a whole program");
}

{
  // Its frames.
  const all: ExitsAsk = { cameraSubmerged: false, portalView: true, exitWater: true, on: true, built: true, strength: 1 };
  ok(exitsDraws(all), 'dry, in a building\'s rooms, an exit under water, on, built and coloured: the variant draws');
  const offs: [keyof ExitsAsk, unknown][] = [['cameraSubmerged', true], ['portalView', false], ['exitWater', false], ['on', false], ['built', false], ['strength', 0]];
  ok(offs.every(([k, v]) => !exitsDraws({ ...all, [k]: v } as ExitsAsk)), 'and any one of those wanting, it does not (under water today\'s look draws instead)');
  ok(UNDERWATER_TUNE.exits === true, 'the switch ships on (off, a submerged doorway shows clear air, as it always did)');
  ok(/private exitsWanted\(ctx: FxFrameContext\): boolean \{[\s\S]*?return exitsDraws\(a\);/.test(now), 'the pass decides its frames by exitsDraws');
  ok(/return ctx\.cameraSubmerged \|\| this\.exitsWanted\(ctx\);/.test(now) && /this\.exitsNow = this\.exitsWanted\(ctx\);/.test(now), 'today\'s look draws under water and the variant on its own frames, never both');
}

{
  // Which exits stand under water from inside a building (`exitsUnderWater`, the arithmetic `World.exitWaterOf` asks): each
  // exit's middle carried through the building's own matrix (three's, turned by a quarter and a bit), the surface over it
  // asked of a lake of ours (`surfaceOf`, the rule every reader asks), lava stepped over, the deepest kept.
  const world = new THREE.Object3D();
  world.position.set(100, 2, -40);
  world.rotation.y = 1.9;
  world.updateMatrixWorld(true);
  const m = world.matrixWorld.elements;
  // Exits of the building's own frame: a door at ground height on its +x side, one 4 m up on its -z side, one far out on +z.
  const exits = [{ centroid: [6, 1, 0] }, { centroid: [0, 5, -6] }, { centroid: [0, 1, 40] }];
  const inWorld = (c: number[]): THREE.Vector3 => new THREE.Vector3(c[0], c[1], c[2]).applyMatrix4(world.matrixWorld);
  // A lake of ours over the first two exits (at their own places in the world), its level 9 m, none over the third.
  const a = inWorld(exits[0].centroid);
  const b = inWorld(exits[1].centroid);
  const lake = lakeTable({ id: 'over-doors', kind: 'lake', h: 9, points: [[-(Math.min(a.x, b.x) - 3), Math.min(a.z, b.z) - 3], [-(Math.max(a.x, b.x) + 3), Math.min(a.z, b.z) - 3], [-(Math.max(a.x, b.x) + 3), Math.max(a.z, b.z) + 3], [-(Math.min(a.x, b.x) - 3), Math.max(a.z, b.z) + 3]], shader: null }, (x) => -x, (z) => z);
  const lavaAt = { x: Number.NaN, z: Number.NaN };
  const ask: ExitWaterAsk = {
    x: 0.5,
    y: 0.5,
    z: 0.5,
    h: 0.5,
    surface() {
      ask.h = surfaceOf([lake], ask.x, ask.z);
    },
    lava: () => Math.abs(ask.x - lavaAt.x) < 0.01 && Math.abs(ask.z - lavaAt.z) < 0.01,
  };
  const found: ExitWaterFound = { under: false, depth: 0.5, x: 0.5, z: 0.5, surface: 0.5 };
  ok(exitsUnderWater(exits, m, ask, found) && found.under, 'a building with exits under a lake of ours: an exit under water');
  ok(Math.abs(found.depth - (9 - a.y)) < 1e-9 && Math.abs(found.x - a.x) < 1e-9 && Math.abs(found.z - a.z) < 1e-9 && found.surface === 9, `the deepest kept (the ground-floor door, ${found.depth.toFixed(2)} m under, at its place in the world through the building's turned matrix, not the higher door's ${(9 - b.y).toFixed(2)})`);
  // The deepest is lava: stepped over, and the next under water kept.
  lavaAt.x = a.x;
  lavaAt.z = a.z;
  ok(exitsUnderWater(exits, m, ask, found) && Math.abs(found.depth - (9 - b.y)) < 1e-9 && Math.abs(found.x - b.x) < 1e-9, 'a lava exit is never water: the next exit under water is kept');
  lavaAt.x = b.x;
  lavaAt.z = b.z;
  ok(exitsUnderWater(exits, m, ask, found) && Math.abs(found.depth - (9 - a.y)) < 1e-9, 'and lava at a shallower exit leaves the deeper one');
  lavaAt.x = Number.NaN;
  // Every exit dry, or the building turned so no exit stands under the lake.
  const dry: ExitWaterAsk = { ...ask, surface() { dry.h = -Infinity; }, lava: () => false };
  ok(!exitsUnderWater(exits, m, dry, found) && !found.under && found.depth === 0, 'no water over any exit: none under water (under false, depth nought)');
  const turned = new THREE.Object3D();
  turned.position.copy(world.position);
  turned.rotation.y = 1.9 + Math.PI;
  turned.updateMatrixWorld(true);
  ok(!exitsUnderWater([exits[0]], turned.matrixWorld.elements, ask, found), 'the same door with the building turned half round stands out of the lake: dry (the matrix is read, not the building\'s origin)');
  const over: ExitWaterAsk = { ...ask, surface() { over.h = 0.5; }, lava: () => false };
  ok(!exitsUnderWater(exits, m, over, found), 'a surface under every exit is no exit under water');
  // The world asks it, and sets the look's colour only when the look is another.
  const worldText = read('src/world/world.ts');
  // The method's own text, by its first line through its closing brace (the camera's record has a guard of the same words).
  const head = '  exitWaterOf(view: Building | null, out:';
  const from = worldText.indexOf(head);
  let to = from;
  for (let depth = 0, i = worldText.indexOf('{', worldText.indexOf('): boolean {', from)); i < worldText.length; i++) {
    if (worldText[i] === '{') depth++;
    else if (worldText[i] === '}' && --depth === 0) {
      to = i + 1;
      break;
    }
  }
  const exitWaterOf = from >= 0 ? worldText.slice(from, to) : '';
  ok(/if \(!exitsUnderWater\(exits, view\.matrix\.elements, this\.exitAsk, found\)\) return false;/.test(exitWaterOf), 'World.exitWaterOf asks exitsUnderWater over the building\'s own matrix');
  ok(/a\.h = this\.terrain\.waterHeightAt\(a\.x, a\.z\);/.test(worldText) && /lava: \(\) => this\.lavaAt\(this\.exitAsk\.x, this\.exitAsk\.y, this\.exitAsk\.z\) > -Infinity,/.test(worldText), 'its ask is the terrain\'s own surface and the lava\'s column');
  ok(/if \(out\.look !== look\) \{\s*out\.look = look;\s*out\.color\.set\(look\.color\);\s*out\.opacity = look\.opacity;\s*\}/.test(exitWaterOf) && !/out\.color\.set\(look\.color\);\s*out\.opacity = look\.opacity;\s*return true;/.test(exitWaterOf), "and the look's colour is set only when the look is another (a colour set from its string parses it again: a frame under one water sets nothing)");
}

{
  // The registry, the warm-up, the mask's stencil, the installer.
  const v = FX_PASS_VARIANTS.find((x) => x.pass === 'underwater' && x.id === 'exits');
  ok(!!v && FX_PASSES.some((p) => p.id === v.pass), 'the registry holds the variant under its pass');
  ok(!!v && v.materials.every((m) => now.includes(`'${m}'`)), `under the very names the pass gives its materials (${v?.materials.join(', ')})`);
  ok(/if \(this\.exitsMaterial\) out\.push\(\{ material: this\.exitsMaterial \}, \{ material: this\.regionMaterial, where: 'target' \}\);/.test(now), 'both are warmed with the pass\'s own behind every loading screen');
  ok(EXITS_STENCIL === 2 && /rm\.stencilFunc = THREE\.EqualStencilFunc;\s*rm\.stencilRef = EXITS_STENCIL;\s*rm\.stencilFuncMask = 0xff;\s*rm\.stencilWriteMask = 0x00;/.test(now), 'the mask reads the stencil the portal renderer leaves on the exits (2) and writes none');
  ok(/createSharedDepthTarget\(postfx, \{ format: THREE\.RedFormat, type: THREE\.UnsignedByteType, name: 'fx\.underwater\.region' \}\)/.test(now), "into a target sharing the scene's depth and stencil, as the ambient occlusion's region is");
  ok(/postfx\.registerPass\(new UnderwaterPass\(underwaterHostFor\(postfx\)\)\);/.test(read('src/core/fx/install.ts')), 'the installer hands the pass its host');
}

console.log(`underwaterExits: ${checks} checks passed`);
