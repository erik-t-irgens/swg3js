// Reflections on WebGPU (the GPU port's step 4, item 2): our own sky captured and filtered by three's WebGPU generator,
// handed to every registered material by the registry and its rules (`src/world/envmap.ts`), which do not change.
//
// The capture is `DomeCapture` itself, the WebGL path's own class, given three's WebGPU `PMREMGenerator` as its filter:
// the dome rendered into one kept 128 px cube and filtered into one kept target in place at every capture, so the texture
// every reflective surface holds is the same object for the session and a capture makes nothing. Three's WebGPU generator
// makes a cube with mip levels (at least 256 a side: it raises a smaller source to that), which is its own filter and not
// 0.185's flat picture the WebGL path keeps: the GGX levels are three 0.187's own. Since pass 2, wave 2 the sky it captures
// is the sky as drawn (the air's dome or SWG's, the moons and pictures, the skybox, in space the planets and the nebulae
// where WebGPU draws them), a face a frame by its own draws and the filter on a seventh (`src/sky/capture/skyCapture.ts`,
// made here with the dome and reached as `sky`).
//
// The black stand-in every registered material carries while the world has none is made here by the same generator from
// six black faces, the water's own recipe (`waterBodies.ts`), so the stand-in and the capture are textures of one kind:
// swapping one for the other is a picture three binds anew, never a pipeline built (three 0.187's environment node reads
// a material's `envMap` once an object, so a swapped texture reaches the draw). A swapped in-place capture is the same
// object, so it reaches the draw with nothing at all.
//
// The 'game' source (an area's own cube maps, `__debug.reflections({ source: 'game' })`) goes through a second generator
// of its own, at the cube's own size, into a target of its own the world frees when it is replaced, as on WebGL; the
// `fromScene` comparison (`reflections({ dome: 'scene' })`) is WebGL's alone and the dome is kept here either way.
//
// `localStorage['swg.gpu.env'] = '0'` and a reload leave all of it out (no stand-in, no capture: every registered
// material's `envMap` stays null, step 3's plain node copy); `__debug.gpu({ look: { env: false } })` hands the registry
// the black stand-in live, which reflects and fills nothing.

import * as THREE from 'three';
import { PMREMGenerator } from 'three/webgpu';
import { DOME_CUBE, DomeCapture, type DomeFilter } from '../../world/envmap.ts';
import type { GpuEnvironment } from '../gpuSwitch.ts';
import { GPU_LOOKS, LOOKS_AT_LOAD } from './looks.ts';
import { SkyCapture } from '../../sky/capture/skyCapture.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Six black faces of the dome's size, as the water's own black stand-in is made. */
function blackCube(): THREE.CubeTexture {
  const faces: HTMLCanvasElement[] = [];
  for (let i = 0; i < 6; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = DOME_CUBE;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, DOME_CUBE, DOME_CUBE);
    faces.push(canvas);
  }
  const cube = new THREE.CubeTexture(faces);
  cube.colorSpace = THREE.SRGBColorSpace;
  cube.needsUpdate = true;
  return cube;
}

/** The environment on WebGPU: made once at start, after `init()`, on WebGPU alone. */
export function makeGpuEnvironment(renderer: Any): GpuEnvironment {
  const atLoad = LOOKS_AT_LOAD.env;
  // The dome's own generator, as on WebGL (`DomeCapture` says why it must be its own): the black stand-in is filtered by it
  // too, which builds its three filter programs' pipelines at start, behind the first loading screen.
  const domeGen: Any = atLoad ? new PMREMGenerator(renderer) : null;
  // Pass 2, wave 2 (maker B): the filter's own draws named for the card's timer (`framePerf.ts`'s `sectionOfPass`): three draws
  // each level of the filter as its one box mesh, handed to `render` as the scene.
  if (domeGen?._boxMesh) domeGen._boxMesh.userData.swgSkyFilter = true;
  let areaGen: Any = null;
  let standIn: THREE.Texture | null = null;
  let error: string | null = null;
  if (atLoad) {
    try {
      const cube = blackCube();
      standIn = domeGen.fromCubemap(cube).texture as THREE.Texture;
      cube.dispose();
    } catch (err) {
      error = String((err as Error)?.message ?? err).slice(0, 300);
      standIn = null;
    }
  }
  let dome: DomeCapture | null = null;
  // Pass 2, wave 2 (maker B): the real sky's capture over the dome, a face a frame and the filter on a seventh
  // (`src/sky/capture/skyCapture.ts`), made with it.
  let sky: SkyCapture | null = null;
  const stats = { domesMade: 0, areaCubesFiltered: 0 };
  return {
    get capturing() {
      return atLoad && standIn !== null && GPU_LOOKS.env;
    },
    get standIn() {
      return standIn;
    },
    get sky() {
      return sky;
    },
    makeDome(): DomeCapture {
      if (!dome) {
        dome = new DomeCapture(domeGen as DomeFilter);
        sky = new SkyCapture(dome);
        stats.domesMade++;
        // Warmed with one capture of an empty scene, which makes the kept target, as `World.makeDome` does on WebGL.
        try {
          dome.capture((camera) => camera.update(renderer, new THREE.Scene()));
        } catch (err) {
          error = String((err as Error)?.message ?? err).slice(0, 300);
        }
      }
      return dome;
    },
    filterCube(cube: THREE.Texture): THREE.RenderTarget {
      areaGen ??= new PMREMGenerator(renderer);
      stats.areaCubesFiltered++;
      return areaGen.fromCubemap(cube) as THREE.RenderTarget;
    },
    report() {
      const t = dome?.target ?? null;
      return {
        atLoad,
        live: GPU_LOOKS.env,
        by: atLoad ? "three's WebGPU PMREMGenerator: our sky into the kept 128 px cube, filtered in place into a kept cube with mip levels (three 0.187's own filter, its least size 256)" : "left out at load (localStorage['swg.gpu.env'] = '0'): no stand-in and no capture, every registered material's envMap null (step 3)",
        standIn: standIn ? { size: (standIn.image as Any)?.[0]?.width ?? (standIn as Any).source?.data?.[0]?.width ?? null, mips: (standIn as Any).mipmaps?.length ?? null } : null,
        dome: dome ? { captures: dome.stats.captures, targetsMade: dome.stats.targetsMade, refused: dome.stats.refused, mips: (t?.texture as Any)?.mipmaps?.length ?? null, size: (t as Any)?.width ?? null } : 'not made yet (the first world makes it)',
        steps: sky ? sky.report() : null,
        areaCubesFiltered: stats.areaCubesFiltered,
        notOnWebGPU: "the 'scene' capture (reflections({ dome: 'scene' })) is WebGL's: the kept dome is used either way; the previews keep their own WebGL studio",
        error,
      };
    },
  };
}
