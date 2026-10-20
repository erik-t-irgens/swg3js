// Our own sky's reflection, captured without allocating (the performance pass's fifth wave): the dome rendered into
// one kept 128 px cube and filtered into one kept PMREM target in place, through a generator of the dome's own. With a
// stand-in generator that counts what it makes, the environment's texture is one object across ten captures and no
// target is made after the first; a cube of any other size is refused and filters nothing. Read as text (the world
// does not load under node): the dome's capture goes through its own generator, `domePmrem`, and never `fromScene`, the
// areas' own cube maps (the 'game' source) through the shared generator at their own size, and a capture hands the
// materials an environment only when it is another texture than the one they hold.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { DOME_CUBE, DomeCapture, cubeSizeOf, type DomeFilter } from '../../../src/world/envmap.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** A generator that makes a target only when it is handed none, as three's does, and writes down every call. */
class CountingFilter implements DomeFilter {
  made = 0;
  calls: { cube: THREE.Texture; into: THREE.WebGLRenderTarget | null }[] = [];
  compiled = 0;
  fromCubemap(cube: THREE.Texture, into: THREE.WebGLRenderTarget | null = null): THREE.WebGLRenderTarget {
    this.calls.push({ cube, into });
    if (into) return into;
    this.made++;
    // The height a 128 px cube's filtered target has in three: four times the cube (`envMapCubeUVHeight`).
    return new THREE.WebGLRenderTarget(3 * Math.max(DOME_CUBE, 16 * 7), 4 * DOME_CUBE);
  }
  compileCubemapShader(): void {
    this.compiled++;
  }
}

{
  const filter = new CountingFilter();
  const dome = new DomeCapture(filter);
  ok(cubeSizeOf(dome.cube.texture) === DOME_CUBE && DOME_CUBE === 128, 'the kept cube is 128 px a side, the size every environment here is filtered from');
  ok(dome.cube.texture.type === THREE.HalfFloatType && dome.camera.children.length === 6, 'a half-float cube with six cameras over it');
  let drawn = 0;
  const textures = new Set<THREE.Texture>();
  for (let i = 0; i < 10; i++) {
    const t = dome.capture((camera) => {
      ok(camera === dome.camera, `capture ${i + 1}: the dome is drawn by the kept cameras into the kept cube`);
      drawn++;
    });
    if (t) textures.add(t);
  }
  ok(drawn === 10 && dome.stats.captures === 10, 'ten captures draw the dome ten times');
  ok(textures.size === 1 && [...textures][0] === dome.target?.texture, 'and hand back one texture, the kept target\'s, all ten times');
  ok(filter.made === 1 && dome.stats.targetsMade === 1, `one target is made, by the first capture, and none after it (${filter.made})`);
  ok(filter.calls.length === 10 && filter.calls.every((c) => c.cube === dome.cube.texture) && filter.calls.slice(1).every((c) => c.into === dome.target), 'every capture after the first filters the kept cube into the kept target');
  // What keeps the kept target's height (the one in every reflective program's key) the 128 px cube's is that the dome's
  // generator is handed nothing but its own 128 px cube: the height three's generator gives a target is three's, which a
  // stand-in cannot say, so it is the cube's size and the refusal of any other that are held here.
  // A cube of any other size is refused: the generator's internals are 128's.
  const big = new THREE.WebGLCubeRenderTarget(256);
  ok(cubeSizeOf(big.texture) === 256, 'a 256 px cube (a space zone\'s own maps are) reads as 256');
  ok(dome.filterCube(big.texture) === null && dome.stats.refused === 1 && filter.calls.length === 10, 'and the dome\'s generator refuses it, filtering nothing');
  const none = new THREE.CubeTexture([]);
  ok(cubeSizeOf(none) === 0 && dome.filterCube(none) === null && dome.stats.refused === 2, 'as it refuses a cube with no faces');
}

// ---- the world's wiring, as text ----
{
  const world = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const refresh = world.slice(world.indexOf('  private refreshEnvironment('), world.indexOf('  private useEnvironment('));
  ok(/const dome = \(this\.dome \?\?= this\.makeDome\(this\.renderer\)\);/.test(refresh) && /const captured = dome\.capture\(\(camera\) => camera\.update\(renderer, sky\.domeScene\)\);/.test(refresh), "the dome's capture goes through its own kept cube and generator");
  const scene = refresh.indexOf('fromScene(sky.domeScene');
  ok((world.match(/fromScene\(sky\.domeScene/g) ?? []).length === 1 && scene > 0 && /if \(REFLECTIONS\.dome === 'scene'\) \{\s*const made = this\.pmrem\.fromScene\(sky\.domeScene, 0\.04, 1, 20000, \{ size: DOME_CUBE \}\);\s*this\.useEnvironment\(made\.texture, made\);\s*return;\s*\}/.test(refresh), "and through `fromScene`, which made a target every call, only when the console asks for the look before (`reflections({ dome: 'scene' })`)");
  ok(/dome: 'kept' \| 'scene' \} = \{ source: savedSource\(\), plain: 0, models: true, dome: 'kept' \};/.test(readFileSync(new URL('../../../src/world/envmap.ts', import.meta.url), 'utf8')), 'which is not the default');
  ok(/const target = pmrem\.fromCubemap\(tex\);/.test(refresh) && /this\.useEnvironment\(target\.texture, target\);/.test(refresh), "the 'game' source's own cube maps go through the shared generator, at their own size, into targets of their own");
  ok(/if \(captured\) this\.useEnvironment\(captured, null\);/.test(refresh), "and the dome's kept target is never handed over to be freed");
  // Found by the wave's smoke: the 'game' source on a world that borrows its sky threw as it was taken up, reading the
  // cube's files out of the world's own pack, which such a world has not got.
  ok(/usable\.faces\.map\(\(f\) => skyPack\.url\(f\)\)/.test(refresh) && !/this\.pack!\.url/.test(refresh) && /this\.swgSky = sky;\s*this\.skyPack = pack;/.test(world) && /this\.skyPack = null;/.test(world), "an area's own cube is read out of the pack the sky came from, a borrowed sky's included");
  const make = world.slice(world.indexOf('  private makeDome('), world.indexOf('  private refreshEnvironment('));
  ok(/new DomeCapture\(new THREE\.PMREMGenerator\(renderer\)\)/.test(make) && /dome\.domePmrem\.compileCubemapShader\(\);/.test(make) && /dome\.capture\(\(camera\) => camera\.update\(renderer, empty\)\);/.test(make), 'the dome has a generator of its own, warmed with one capture of an empty scene, which makes the kept target');
  const use = world.slice(world.indexOf('  private useEnvironment('), world.indexOf('  async reflectionsReady('));
  ok(/if \(this\.envTexture !== texture\) \{\s*this\.envTexture = texture;\s*setEnvironment\(texture, 1\);\s*\}/.test(use) && /if \(old && old !== own\) old\.dispose\(\);/.test(use), 'the materials are handed an environment only when it is another texture, and only a target of its own is freed');
  const warm = world.slice(world.indexOf('  warmUp(center'), world.indexOf('this.readySound();', world.indexOf('  warmUp(center')));
  ok(/this\.pmrem \?\?= this\.makePmrem\(this\.renderer\);\s*this\.dome \?\?= this\.makeDome\(this\.renderer\);/.test(warm), 'both are made behind the first loading screen');
  ok((world.match(/new DomeCapture\(/g) ?? []).length === 1 && !/this\.dome\.target\?\.dispose|this\.dome = null/.test(world), 'one for the session, never disposed or replaced');
}

console.log(`\n${checks} checks passed`);
