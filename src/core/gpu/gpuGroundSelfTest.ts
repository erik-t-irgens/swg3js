// The ground's and the far rings' self tests on WebGPU (the GPU port's step 5, items 1 and 2).
//
// `__debug.groundSelfTest()` is the WebGL test's own strip of tiles (`terrainTextures.ts`'s `groundSelfTest`), drawn
// through the site's own material (`groundTilesMaterial`, whose stand-in is the tile program's node graph, `gpuGround.ts`)
// and read back, every pixel held to `groundMath.ts` within the WebGL test's own tolerance: the colour under the four tint
// modes, both ways round, both opposite rules and the hard step, the colour under the cloud tile, the bump's lean and gloss,
// the flat shine under one light, and the ground up close (the side pictures and the relief) as on WebGL. Three things differ
// from the WebGL test, each said in the answer: the readback is three's asynchronous one, a WebGPU texture's first row its
// top; what it counts as built while the knobs move is pipelines made for its own strip alone (`WARM_STATS.selfTestMade`);
// and the test's material is keyed apart from the session's ground (three 0.187 keeps one built graph a program key).
//
// `__debug.horizon({ selfTest: true })` is the WebGL test's two parts -- each tile array layer's mean held to the card's
// own top mip (`meansVerdict`), and the ring program's textures counted -- plus the ring's arithmetic held to
// `horizonMath.ts`: the node functions the ring's vertex stage is made of (`ringDistLevelN`, `ringLevelOfN`,
// `ringEdgeLevelN`, `ringMorphN`, `ringDropN`, `ringReachN`, `bakeHeightN`) run on the GPU over cases of every branch and
// read back against `ringDistLevel`, `ringLevelOf`, `ringEdgeLevel`, `ringMorphAxis`, `ringDrop`, `ringReach` and
// `bakeHeightAt`. The textures are counted off the ring's own WGSL as three builds it for the game's scene (each stage's
// sampled textures against WebGPU's limit), the shadow maps and three's own lookups among them.

import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { CLOUD_PERIOD, LUMA, bumpNormal, cloudShade, cloudUv, composeTile, flatShine, srgbDecode, tintGamma, type MaskSample, type TintReference } from '../../world/groundMath.ts';
import { maskCode } from '../../world/groundTiles.ts';
import { GROUND_RELIEF_WANTED, GROUND_TILES_KEY, GROUND_TRI_WANTED, groundTilesMaterial, makeGroundTileUniforms, setGroundClock } from '../../world/terrainTextures.ts';
import { makeRingUniforms, type RingUniforms } from '../../world/horizon/horizonRings.ts';
import { LEAF, PATCH, bakeHeightAt, ringDistLevel, ringDrop, ringEdgeDistance, ringEdgeLevel, ringLevelOf, ringMorphAxis, ringReach, type BakeGrid } from '../../world/horizon/horizonMath.ts';
import { MEANS_STRIDE, meansVerdict, type FieldGround } from '../../world/horizon/horizonField.ts';
import { layerMeans } from '../../world/horizon/horizonDecode.ts';
import { GROUND_GPU_STATS, GROUND_VIEW_CARRY, bakeHeightN, liveTexture, ringHeightAtN, ringDistLevelN, ringDropN, ringEdgeLevelN, ringLevelOfN, ringMorphN, ringNodes, ringReachN, ringVertexN } from './gpuGround.ts';
import { GPU_LOOKS, LOOKS_AT_LOAD } from './looks.ts';
import { WARM_PATCH, WARM_STATS } from './patchWarm.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// Three's node functions, taken untyped: the graphs here are built of nodes whose types three's declarations cannot follow.
const { Fn, float, floor, int, screenCoordinate, select, uniform, uniformArray, vec2, vec4 } = TSL as Any;

/** A half-float target's pixels as floats, the rows turned so row nought is the bottom (as WebGL reads them). */
async function readHalf(renderer: Any, rt: THREE.RenderTarget, W: number, H: number): Promise<Float32Array> {
  const raw = (await renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H)) as Uint16Array;
  const out = new Float32Array(W * H * 4);
  for (let j = 0; j < H; j++) {
    const from = (H - 1 - j) * W * 4;
    for (let i = 0; i < W * 4; i++) out[j * W * 4 + i] = THREE.DataUtils.fromHalfFloat(raw[from + i]);
  }
  return out;
}

export async function groundSelfTestGpu(renderer: Any): Promise<Record<string, unknown>> {
  if (!LOOKS_AT_LOAD.ground) return { renderer: 'WebGPU', ok: false, note: "the ground's part is left out at load (localStorage['swg.gpu.ground'] = '0'): step 3's plain ground draws, with nothing of the tile program to hold" };
  const u = makeGroundTileUniforms();
  const solids: [number, number, number][] = [
    [200, 40, 30],
    [30, 180, 60],
    [40, 60, 210],
    [230, 220, 40],
    [150, 90, 200],
  ];
  const layerCount = solids.length + 1;
  const colourData = new Uint8Array(2 * 2 * 4 * layerCount);
  const put = (layer: number, x: number, y: number, c: [number, number, number]) => {
    const o = (layer * 4 + y * 2 + x) * 4;
    colourData[o] = c[0];
    colourData[o + 1] = c[1];
    colourData[o + 2] = c[2];
    colourData[o + 3] = 255;
  };
  for (let y = 0; y < 2; y++) {
    put(0, 0, y, [220, 30, 30]);
    put(0, 1, y, [30, 30, 220]);
  }
  solids.forEach((c, i) => {
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) put(i + 1, x, y, c);
  });
  const colour = new THREE.DataArrayTexture(colourData, 2, 2, layerCount);
  colour.colorSpace = THREE.SRGBColorSpace;
  colour.wrapS = colour.wrapT = THREE.RepeatWrapping;
  colour.minFilter = colour.magFilter = THREE.LinearFilter;
  colour.generateMipmaps = false;
  colour.needsUpdate = true;
  const bumps: [number, number, number, number][] = [
    [170, 128, 230, 40],
    [96, 150, 235, 200],
    [128, 84, 222, 120],
    [150, 176, 214, 0],
    [128, 128, 255, 255],
    [108, 112, 244, 80],
  ];
  const bumpData = new Uint8Array(2 * 2 * 4 * layerCount);
  bumps.forEach((b, layer) => {
    for (let t = 0; t < 4; t++) bumpData.set(b, (layer * 4 + t) * 4);
  });
  const bump = new THREE.DataArrayTexture(bumpData, 2, 2, layerCount);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.minFilter = bump.magFilter = THREE.LinearFilter;
  bump.generateMipmaps = false;
  bump.needsUpdate = true;
  const maskTexels = [
    [255, 0, 0, 0],
    [255, 0, 255, 0],
    [255, 255, 255, 0],
  ];
  const maskData = new Uint8Array(4 * 3);
  maskTexels.forEach((m, k) => maskData.set(m, k * 4));
  const masks = new THREE.DataArrayTexture(maskData, 2, 2, 3);
  masks.format = THREE.RedFormat;
  masks.wrapS = masks.wrapT = THREE.ClampToEdgeWrapping;
  masks.minFilter = masks.magFilter = THREE.LinearFilter;
  masks.generateMipmaps = false;
  masks.needsUpdate = true;
  const CS = 16;
  const cloudTexel = (x: number, y: number) => Math.round(128 + 100 * Math.sin((2 * Math.PI * (x + 0.5)) / CS) * Math.cos((4 * Math.PI * (y + 0.5)) / CS));
  const cloudData = new Uint8Array(CS * CS * 4);
  for (let y = 0; y < CS; y++) {
    for (let x = 0; x < CS; x++) {
      const a = cloudTexel(x, y);
      cloudData.set([a, a, a, 255], (y * CS + x) * 4);
    }
  }
  const clouds = new THREE.DataTexture(cloudData, CS, CS, THREE.RGBAFormat);
  clouds.wrapS = clouds.wrapT = THREE.RepeatWrapping;
  clouds.minFilter = clouds.magFilter = THREE.LinearFilter;
  clouds.generateMipmaps = false;
  clouds.needsUpdate = true;
  // The set's own stand-ins kept (a graph made over them binds them first; the test's textures take their places).
  const standIns = [u.uGround.value, u.uGroundBump.value, u.uGroundMask.value, u.uGroundClouds.value];
  u.uGround.value = colour;
  u.uGroundBump.value = bump;
  u.uGroundMask.value = masks;
  u.uGroundClouds.value = clouds;
  u.uGroundFrame.value.set(0, 0, 1, 0);
  const reference: TintReference = { rgb: [0.62, 0.55, 0.5], luminance: 0.56 };
  u.uGroundTintRef.value.set(reference.rgb[0], reference.rgb[1], reference.rgb[2], reference.luminance);
  const clock = 37.5 + 3 * CLOUD_PERIOD;
  setGroundClock(clock, u);
  const cap = 1.6;
  const cases: { layers: number[]; codes: number[] }[] = [];
  for (let bits = 1; bits < 15; bits++) cases.push({ layers: [0, 1 + (bits % 5), 0, 0], codes: [maskCode(bits), 0, 0] });
  cases.push({ layers: [1, 2, 3, 3], codes: [maskCode(2 | 8), maskCode(4), 0] });
  cases.push({ layers: [2, 3, 4, 5], codes: [maskCode(2), maskCode(4), maskCode(8)] });
  cases.push({ layers: [0, 0, 0, 0], codes: [0, 0, 0] });
  const tintBytes: [number, number, number][] = [
    [179, 140, 107],
    [250, 245, 235],
  ];
  const tints = tintBytes.map((c) => c.map((b) => b / 255) as [number, number, number]);
  const bright = tints[1];
  const capBinds = cap / (bright[0] * LUMA[0] + bright[1] * LUMA[1] + bright[2] * LUMA[2]) < 1 / reference.luminance && bright.some((c, i) => c / reference.rgb[i] > cap);
  const tiles = cases.length;
  const tileSize = 4;
  const pxPerTile = 16;
  const W = tiles * pxPerTile;
  const H = pxPerTile;
  const vcount = tiles * 6;
  const pos = new Float32Array(vcount * 3);
  const nor = new Float32Array(vcount * 3);
  const lay = new Uint8Array(vcount * 4);
  const bl = new Uint8Array(vcount * 4);
  const ti = new Uint8Array(vcount * 3);
  let v = 0;
  cases.forEach((c, i) => {
    const corner = (gx: number, gz: number, s2: number, t2: number) => {
      pos.set([gx, 0, gz], v * 3);
      nor.set([0, 1, 0], v * 3);
      lay.set(c.layers, v * 4);
      bl.set([c.codes[0], c.codes[1], c.codes[2], s2 * 3 + t2], v * 4);
      ti.set(tintBytes[i % 2], v * 3);
      v++;
    };
    const x0 = i * tileSize;
    corner(x0 + 4, 0, 0, 0);
    corner(x0, 0, 2, 0);
    corner(x0 + 4, 4, 0, 2);
    corner(x0, 0, 2, 0);
    corner(x0, 4, 2, 2);
    corner(x0 + 4, 4, 0, 2);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute('aGroundLayers', new THREE.BufferAttribute(lay, 4));
  geometry.setAttribute('aGroundBlend', new THREE.BufferAttribute(bl, 4));
  geometry.setAttribute('aGroundTint', new THREE.BufferAttribute(ti, 3, true));
  // The site's own material, its stand-in the tile program's node graph; keyed apart from the session's ground, since three
  // keeps one built graph a key and the session's reads the session's uniforms.
  const material = groundTilesMaterial(u, null);
  material.customProgramCacheKey = () => `${GROUND_TILES_KEY}-gpu-self-test`;
  material.side = THREE.DoubleSide;
  const scene = new THREE.Scene();
  const unlitMesh = new THREE.Mesh(geometry, material);
  unlitMesh.frustumCulled = false;
  unlitMesh.userData.swgSelfTest = true;
  scene.add(unlitMesh);
  const litScene = new THREE.Scene();
  const litMesh = new THREE.Mesh(geometry, material);
  litMesh.frustumCulled = false;
  litMesh.userData.swgSelfTest = true;
  litScene.add(litMesh);
  const sun = new THREE.DirectionalLight(0xffffff, Math.PI);
  sun.position.set(0, 10, 0);
  litScene.add(sun);
  const camera = new THREE.OrthographicCamera(0, tiles * tileSize, 0, -tileSize, 0.1, 20);
  camera.position.set(0, 10, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const rt = new THREE.RenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false, samples: 0 });
  const previous = renderer.getRenderTarget();
  const clearColour = renderer.getClearColor(new THREE.Color());
  const clearAlpha = renderer.getClearAlpha();
  const ownCount = WARM_PATCH.applied;
  const pipelines = (): number => (ownCount ? WARM_STATS.selfTestMade : (renderer._pipelines?.caches?.size ?? -1));
  const runs: { name: string; pixels: number; maxError: number }[] = [];
  let builtOnKnobs = 0;
  const detail = { flatSame: !GROUND_TRI_WANTED && !GROUND_RELIEF_WANTED, steepTurns: !GROUND_TRI_WANTED, reliefNearMoves: !GROUND_RELIEF_WANTED };
  const texel = (k: number, x: number, y: number) => maskTexels[k][Math.min(1, Math.max(0, y)) * 2 + Math.min(1, Math.max(0, x))] / 255;
  const sample: MaskSample = (kind, uu, vv) => {
    const fx = uu * 2 - 0.5;
    const fy = vv * 2 - 0.5;
    const x = Math.floor(fx);
    const y = Math.floor(fy);
    const ax = fx - x;
    const ay = fy - y;
    return (texel(kind, x, y) * (1 - ax) + texel(kind, x + 1, y) * ax) * (1 - ay) + (texel(kind, x, y + 1) * (1 - ax) + texel(kind, x + 1, y + 1) * ax) * ay;
  };
  const wrap = (i: number) => ((i % CS) + CS) % CS;
  const cloudAt = (uv: [number, number]) => {
    const fx = uv[0] * CS - 0.5;
    const fy = uv[1] * CS - 0.5;
    const x = Math.floor(fx);
    const y = Math.floor(fy);
    const ax = fx - x;
    const ay = fy - y;
    const c = (i: number, j: number) => cloudTexel(wrap(i), wrap(j)) / 255;
    return (c(x, y) * (1 - ax) + c(x + 1, y) * ax) * (1 - ay) + (c(x, y + 1) * (1 - ax) + c(x + 1, y + 1) * ax) * ay;
  };
  const decodeByte = (b: number) => srgbDecode(b / 255);
  const stripe = (uu: number, out: number[]) => {
    const f = (((uu * 2 - 0.5) % 2) + 2) % 2;
    const x = Math.floor(f);
    const a = f - x;
    const c0 = x === 0 ? [220, 30, 30] : [30, 30, 220];
    const c1 = x === 0 ? [30, 30, 220] : [220, 30, 30];
    for (let c = 0; c < 3; c++) out[c] = decodeByte(c0[c]) * (1 - a) + decodeByte(c1[c]) * a;
  };
  const tintOut: [number, number, number] = [0, 0, 0];
  const uv: [number, number] = [0, 0];
  const normalOut: [number, number, number] = [0, 0, 0];
  const lookWas = GPU_LOOKS.ground;
  const buildsBefore = GROUND_GPU_STATS.builds.tiles;
  let failed: string | null = null;
  try {
    GPU_LOOKS.ground = true;
    // Its views are read straight off its own targets, which nothing tone-maps after (the game's frames drawn in its awaits
    // show a view, should one be on, uncarried for those frames).
    GROUND_VIEW_CARRY.on = false;
    const drawn = new Set<THREE.Scene>();
    const draw = async (sc: THREE.Scene): Promise<Float32Array> => {
      const before = pipelines();
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      renderer.render(sc, camera);
      renderer.setRenderTarget(previous);
      renderer.setClearColor(clearColour, clearAlpha);
      const px = await readHalf(renderer, rt, W, H);
      if (drawn.has(sc)) builtOnKnobs += Math.max(0, pipelines() - before);
      drawn.add(sc);
      return px;
    };
    type Run = { name: string; mode: number; mirror: number; add: boolean; painted: boolean; view: number };
    const list: Run[] = [
      { name: "the client's masks, normalised tint", mode: 2, mirror: 1, add: false, painted: true, view: 1 },
      { name: 'the pictures the old way round', mode: 2, mirror: -1, add: false, painted: true, view: 1 },
      { name: "the client's own tint", mode: 1, mirror: 1, add: false, painted: true, view: 1 },
      { name: 'the tint per channel', mode: 3, mirror: 1, add: false, painted: true, view: 1 },
      { name: 'no tint, opposite corners added', mode: 0, mirror: 1, add: true, painted: true, view: 1 },
      { name: 'the masks stepped at a half', mode: 0, mirror: 1, add: false, painted: false, view: 1 },
      { name: 'under the cloud layer', mode: 2, mirror: 1, add: false, painted: true, view: 2 },
      { name: 'under the cloud layer, the old way round', mode: 2, mirror: -1, add: false, painted: true, view: 2 },
      { name: "the bump's lean and gloss", mode: 0, mirror: 1, add: false, painted: true, view: 3 },
      { name: "the bump's lean and gloss, the old way round", mode: 0, mirror: -1, add: false, painted: true, view: 3 },
      { name: 'the flat shine under one light', mode: 0, mirror: 1, add: false, painted: true, view: 0 },
    ];
    for (const run of list) {
      u.uGroundTint.value.set(run.mode, cap, 0, 0);
      u.uGroundFrame.value.z = run.mirror;
      u.uGroundLook.value.set(run.add ? 1 : 0, run.painted ? 1 : 0, run.view, 0);
      u.uGroundCloud.value.x = 0;
      u.uGroundCloud.value.y = 1;
      let pixels: Float32Array;
      let lit0: Float32Array | null = null;
      if (run.view === 0) {
        u.uGroundShine.value.set(0, 0, 1, 0);
        lit0 = await draw(litScene);
        u.uGroundShine.value.set(0, 1, 1, 0);
        pixels = await draw(litScene);
      } else {
        u.uGroundShine.value.set(0, 0, 1, 0);
        pixels = await draw(scene);
      }
      let worst = 0;
      let counted = 0;
      for (let j = 0; j < H; j++) {
        const gz = tileSize - ((j + 0.5) / H) * tileSize;
        for (let i = 0; i < W; i++) {
          const gx = ((i + 0.5) / W) * tiles * tileSize;
          const tile = Math.floor(gx / tileSize);
          const inX = gx - tile * tileSize;
          if (inX < 0.3 || inX > tileSize - 0.3 || gz < 0.3 || gz > tileSize - 0.3) continue;
          const c = cases[tile];
          const s = 1 - inX / tileSize;
          const t = gz / tileSize;
          const terrainX = -gx;
          const uu = (run.mirror * terrainX) / tileSize;
          const at = (j * W + i) * 4;
          const got = (ch: number) => pixels[at + ch];
          if (run.view === 3 || run.view === 0) {
            const b = composeTile((k, out) => {
              const L = bumps[c.layers[k]];
              for (let ch = 0; ch < 4; ch++) out[ch] = L[ch] / 255;
            }, c.codes, s, t, sample, run.add, run.painted, [0, 0, 0, 0]);
            if (run.view === 3) {
              bumpNormal(b, run.mirror, 1, normalOut);
              for (let ch = 0; ch < 3; ch++) worst = Math.max(worst, Math.abs(got(ch) - (normalOut[ch] * 0.5 + 0.5)));
              worst = Math.max(worst, Math.abs(got(3) - b[3]));
            } else {
              const want = flatShine(Math.PI, b[3], 1);
              for (let ch = 0; ch < 3; ch++) worst = Math.max(worst, Math.abs(got(ch) - lit0![at + ch] - want));
            }
            counted++;
            continue;
          }
          tintGamma(tints[tile % 2], run.mode, reference, cap, tintOut);
          const layer = (k: number, out: number[]) => {
            const L = c.layers[k];
            if (L === 0) stripe(uu, out);
            else for (let ch = 0; ch < 3; ch++) out[ch] = decodeByte(solids[L - 1][ch]);
          };
          const albedo = composeTile(layer, c.codes, s, t, sample, run.add, run.painted, [0, 0, 0]);
          const alpha = run.view === 2 ? cloudAt(cloudUv(terrainX, gz, run.mirror, clock, uv)) : 0;
          for (let ch = 0; ch < 3; ch++) {
            let want = albedo[ch] * srgbDecode(tintOut[ch]);
            if (run.view === 2) want *= cloudShade(want, alpha, 1);
            worst = Math.max(worst, Math.abs(got(ch) - want));
          }
          counted++;
        }
      }
      runs.push({ name: run.name, pixels: counted, maxError: Number(worst.toFixed(4)) });
    }
    if (GROUND_TRI_WANTED || GROUND_RELIEF_WANTED) {
      u.uGroundTint.value.set(0, cap, 0, 0);
      u.uGroundFrame.value.z = 1;
      u.uGroundLook.value.set(0, 1, 1, 0);
      const same = (p: Float32Array, q: Float32Array) => p.every((x, k) => x === q[k]);
      const triWas = u.uGroundTri.value.x;
      const reliefWas = u.uGroundRelief.value.clone();
      u.uGroundTri.value.x = 0;
      u.uGroundRelief.value.w = 0;
      const a = await draw(scene);
      u.uGroundTri.value.x = 1;
      u.uGroundRelief.value.set(0.05, 6, 0.5, 1);
      let b = await draw(scene);
      detail.flatSame = same(a, b);
      const last = tiles - 1;
      const spread = (p: Float32Array, alongX: boolean) => {
        let lo = Infinity;
        let hi = -Infinity;
        for (let k = 3; k < pxPerTile - 3; k++) {
          const i = alongX ? last * pxPerTile + k : last * pxPerTile + pxPerTile / 2;
          const j = alongX ? H / 2 : k;
          const r = p[(j * W + i) * 4];
          lo = Math.min(lo, r);
          hi = Math.max(hi, r);
        }
        return hi - lo;
      };
      if (GROUND_TRI_WANTED) {
        const nAttr = geometry.getAttribute('normal') as THREE.BufferAttribute;
        for (let k = 0; k < vcount; k++) nAttr.setXYZ(k, 1, 0, 0);
        nAttr.needsUpdate = true;
        u.uGroundRelief.value.w = 0;
        b = await draw(scene);
        detail.steepTurns = spread(a, true) > 0.05 && spread(a, false) < 0.01 && spread(b, true) < 0.01 && spread(b, false) > 0.05;
        for (let k = 0; k < vcount; k++) nAttr.setXYZ(k, 0, 1, 0);
        nAttr.needsUpdate = true;
      }
      if (GROUND_RELIEF_WANTED) {
        u.uGroundTri.value.x = 0;
        u.uGroundRelief.value.set(0.4, 100, 0.5, 1);
        b = await draw(scene);
        detail.reliefNearMoves = !same(a, b);
      }
      u.uGroundTri.value.x = triWas;
      u.uGroundRelief.value.copy(reliefWas);
    }
  } catch (e) {
    failed = String((e as Error)?.message ?? e).slice(0, 300);
  } finally {
    GPU_LOOKS.ground = lookWas;
    GROUND_VIEW_CARRY.on = true;
    renderer.setRenderTarget(previous);
    renderer.setClearColor(clearColour, clearAlpha);
    material.dispose();
    geometry.dispose();
    for (const t of [colour, bump, masks, clouds, ...standIns]) t.dispose();
    sun.dispose();
    rt.dispose();
  }
  const worst = runs.reduce((a, r) => Math.max(a, r.maxError), 0);
  return {
    renderer: 'WebGPU',
    ok: failed === null && worst < 0.01 && runs.length === 11 && runs.every((r) => r.pixels > 0) && capBinds && builtOnKnobs === 0 && detail.flatSame && detail.steepTurns && detail.reliefNearMoves,
    runs,
    capBinds,
    builtOnKnobs,
    upClose: detail,
    graphBuilds: GROUND_GPU_STATS.builds.tiles - buildsBefore,
    failed,
    note: "WebGL's own strip and cases, drawn through the tile program's node graph (gpuGround.ts) via the site's own material and read back asynchronously (a WebGPU texture's first row its top, turned), every pixel a texel's breadth inside its tile, in linear colour, held to groundMath (composeTile, tintGamma, cloudUv and cloudShade, bumpNormal) and the flat shine to flatShine, worst under 0.01, WebGL's own tolerance; the bright tiles' tint at the gain cap; pipelines made for its own strip alone while the knobs moved (must be 0)",
  };
}

// ---------------------------------------------------------------- the far rings

/** What the world hands the rings' self test: the field's ground tables, the session's uniforms and patch, and the game's view. */
export interface HorizonSelfTestInput {
  ground: FieldGround | null;
  groundArray: THREE.Texture | null;
  patch: THREE.Mesh;
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** The session's ring uniforms and the field's own lattices, for the bake's heights on the GPU against akeHeightAt. */
  uniforms?: RingUniforms;
  fine?: BakeGrid | null;
  coarse?: BakeGrid | null;
  /** The field's shape window (its 2 m heights round the eye), for the ring's height there against `ShapeWindow.ringHeight`. */
  shape?: { placed: boolean; gi0: number; gj0: number; side: number; step: number; ringHeight(rx: number, rz: number, bake: number, fade: number): number } | null;
}

/** Each stage's sampled textures in a WGSL source, by their bindings' names. */
export function sampledTexturesOf(wgsl: string): string[] {
  const out: string[] = [];
  const re = /var\s+([A-Za-z0-9_]+)\s*:\s*(texture_[A-Za-z0-9_]+)/g;
  for (const m of wgsl.matchAll(re)) if (!m[2].startsWith('texture_storage')) out.push(m[1]);
  return out;
}

export async function horizonSelfTestGpu(renderer: Any, o: HorizonSelfTestInput): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { renderer: 'WebGPU' };
  const previous = renderer.getRenderTarget();
  // 1. Each layer's mean against the card's own top mip (WebGL's `selfTest` first part).
  const g = o.ground;
  const arr = o.groundArray as THREE.DataArrayTexture | null;
  const img = arr?.image as { width: number; depth: number } | undefined;
  if (g && arr && img?.width && img.depth) {
    const depth = img.depth;
    const top = Math.floor(Math.log2(img.width));
    const target = new THREE.RenderTarget(depth, 1, { type: THREE.FloatType, depthBuffer: false });
    const m = new MeshBasicNodeMaterial();
    m.depthTest = false;
    m.depthWrite = false;
    const base = liveTexture({ value: arr }, arr);
    m.colorNode = vec4(base.sample(vec2(0.5, 0.5)).depth(int(floor(screenCoordinate.x))).level(float(top)).rgb, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
    quad.frustumCulled = false;
    quad.userData.swgSelfTest = true;
    const scene = new THREE.Scene();
    scene.add(quad);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    try {
      renderer.setRenderTarget(target);
      renderer.render(scene, cam);
      renderer.setRenderTarget(previous);
      const px = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, depth, 1)) as Float32Array;
      const v = meansVerdict(px, layerMeans(g.colour, g.size, g.depth, MEANS_STRIDE), layerMeans(g.colour, g.size, g.depth, 1), depth);
      out.means = { layers: depth, topMip: top, worstLevels: v.worstLevels, worstLayer: v.worstLayer, within: v.within, everyTexelWorst: v.exactWorst, strideWorst: v.strideWorst, overTwo: v.overTwo };
    } catch (e) {
      out.means = { failed: String((e as Error)?.message ?? e).slice(0, 300) };
    } finally {
      renderer.setRenderTarget(previous);
      target.dispose();
      m.dispose();
      quad.geometry.dispose();
    }
  } else out.means = { skipped: 'no tile arrays held' };
  // 2. The ring program's textures, each stage's, off its own WGSL as three builds it for the game's scene.
  try {
    const sh = (await renderer.debug.getShaderAsync(o.scene, o.camera, o.patch)) as { vertexShader: string; fragmentShader: string };
    // Kept for the console's own reading (`globalThis.__swgRingWgsl`): the ring's WGSL as three built it for the game's scene.
    (globalThis as Any).__swgRingWgsl = sh;
    const vs = sampledTexturesOf(sh.vertexShader);
    const fs = sampledTexturesOf(sh.fragmentShader);
    const most = renderer.backend?.device?.limits?.maxSampledTexturesPerShaderStage ?? 16;
    out.samplers = { vertex: { units: vs.length, names: vs }, fragment: { units: fs.length, names: fs }, most, within: vs.length <= most && fs.length <= most };
  } catch (e) {
    out.samplers = { failed: String((e as Error)?.message ?? e).slice(0, 300) };
  }
  // 3. The ring's arithmetic on the GPU against `horizonMath.ts`, its parts and then its vertex stage whole.
  out.arithmetic = await ringArithmetic(renderer);
  out.vertex = await ringVertexCheck(renderer);
  // 4. The session's own bake, as the ring's vertex stage reads it out of the heights atlas, against the field's lattices.
  out.bake = o.uniforms && o.fine && o.coarse ? await sessionBake(renderer, o.uniforms, o.fine, o.coarse, o.shape ?? null) : { skipped: 'no lattices handed over' };
  renderer.setRenderTarget(previous);
  const m = out.means as { within?: boolean; skipped?: string };
  const s = out.samplers as { within?: boolean };
  const a = out.arithmetic as { ok?: boolean };
  const bk = out.bake as { ok?: boolean; skipped?: string };
  const vx = out.vertex as { ok?: boolean };
  out.ok = (m.within === true || m.skipped !== undefined) && s.within === true && a.ok === true && vx.ok === true && (bk.ok === true || bk.skipped !== undefined);
  out.note = "the layer means against the card's top mip (meansVerdict), the ring's sampled textures a stage off its own WGSL against WebGPU's limit (three's shadow maps and lookups among them), the ring's own node functions run on the GPU against horizonMath (worst under 1e-3 of the value's own size), and the ring's vertex stage whole (ringVertexN, the very function the ring's draw calls) over patch and skirt vertices of every level, morph and reach, against HORIZON_RING_VERTEX written out over horizonMath (worst under a millimetre); the shape window's share and the vertex normal are the bake test's and the arithmetic's";
  return out;
}

/**
 * The session's own bake on the GPU: `bakeHeightN` over the session's very ring uniforms (the heights atlas as the world
 * bound it, the lattices' frames and sizes), at places spread over the fine extent and past it, against `bakeHeightAt` over
 * the field's own lattices. Worst under a centimetre (the atlas is the lattices' own floats).
 */
async function sessionBake(renderer: Any, u: RingUniforms, fine: BakeGrid, coarse: BakeGrid, shape: HorizonSelfTestInput['shape']): Promise<Record<string, unknown>> {
  const pts: [number, number][] = [];
  const fx1 = fine.x0 + (fine.nx - 1) * fine.step;
  const fz1 = fine.z0 + (fine.nz - 1) * fine.step;
  const cx1 = coarse.x0 + (coarse.nx - 1) * coarse.step;
  const cz1 = coarse.z0 + (coarse.nz - 1) * coarse.step;
  for (let i = 0; i < 24; i++) for (let j = 0; j < 8; j++) pts.push([fine.x0 + ((i + 0.37) / 24) * (fx1 - fine.x0), fine.z0 + ((j + 0.61) / 8) * (fz1 - fine.z0)]);
  for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) pts.push([coarse.x0 + ((i + 0.29) / 16) * (cx1 - coarse.x0), coarse.z0 + ((j + 0.53) / 4) * (cz1 - coarse.z0)]);
  // And the shape window's own places (its 2 m heights, where the ring reads them), held to `ShapeWindow.ringHeight`.
  const bakeOnly = pts.length;
  const placed = !!shape?.placed && u.uHorizonShape.value.w > 0.5;
  if (placed && shape) for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) pts.push([(shape.gi0 + ((i + 0.41) / 16) * (shape.side - 1)) * shape.step, (shape.gj0 + ((j + 0.67) / 16) * (shape.side - 1)) * shape.step]);
  const n = pts.length;
  const P = uniformArray(
    pts.map(([x, z]) => new THREE.Vector4(x, z, 0, 0)),
    'vec4',
  );
  const r = ringNodes(u);
  const m = new MeshBasicNodeMaterial();
  m.depthTest = false;
  m.depthWrite = false;
  m.fragmentNode = Fn(() => {
    const p = P.element(int(floor(screenCoordinate.x)));
    return vec4(bakeHeightN(r, p.x, p.y), ringHeightAtN(r, p.x, p.y).x, 0, 1);
  })();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
  quad.frustumCulled = false;
  quad.userData.swgSelfTest = true;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const target = new THREE.RenderTarget(n, 1, { type: THREE.FloatType, depthBuffer: false });
  const previous = renderer.getRenderTarget();
  let worst = 0;
  let worstAt: [number, number] | null = null;
  let shapeWorst = 0;
  const sample: Record<string, number>[] = [];
  try {
    renderer.setRenderTarget(target);
    renderer.render(scene, cam);
    renderer.setRenderTarget(previous);
    const px = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, n, 1)) as Float32Array;
    pts.forEach(([x, z], k) => {
      const bake = bakeHeightAt(fine, coarse, x, z);
      const shaped = k >= bakeOnly && shape ? shape.ringHeight(x, z, bake, u.uHorizonShapeAt.value.z) : bake;
      const want = k >= bakeOnly ? shaped : bake;
      const got = k >= bakeOnly ? px[k * 4 + 1] : px[k * 4];
      if (k >= bakeOnly) shapeWorst = Math.max(shapeWorst, Math.abs(got - want));
      const d = Math.abs(got - want);
      if (d > worst) {
        worst = d;
        worstAt = [x, z];
      }
      if (k % 37 === 0) sample.push({ x: Math.round(x), z: Math.round(z), gpu: Number(got.toFixed(2)), cpu: Number(want.toFixed(2)) });
    });
  } catch (e) {
    return { failed: String((e as Error)?.message ?? e).slice(0, 300), ok: false };
  } finally {
    renderer.setRenderTarget(previous);
    target.dispose();
    m.dispose();
    quad.geometry.dispose();
  }
  return { places: n, shapePlaces: n - bakeOnly, worstMetres: Number(worst.toFixed(4)), shapeWorstMetres: placed ? Number(shapeWorst.toFixed(4)) : 'the shape window is not read here', worstAt, sample, ok: worst < 0.01 };
}

/** The ring's node functions over every branch, drawn into a float target a case a texel, against `horizonMath.ts`. */
async function ringArithmetic(renderer: Any): Promise<Record<string, unknown>> {
  // A small bake: a fine lattice 5 by 4 at 8 m from (100, 200), a coarse 4 by 4 at 64 m from (-64, 0), in one atlas.
  const fine: BakeGrid = { x0: 100, z0: 200, step: 8, nx: 5, nz: 4, h: Array.from({ length: 20 }, (_, i) => 10 + 3.5 * Math.sin(i * 1.7) + i * 0.25) };
  const coarse: BakeGrid = { x0: -64, z0: 0, step: 64, nx: 4, nz: 4, h: Array.from({ length: 16 }, (_, i) => -20 + 7 * Math.cos(i * 0.9) + i) };
  const aw = Math.max(fine.nx, coarse.nx);
  const ah = fine.nz + coarse.nz;
  const atlas = new Float32Array(aw * ah);
  for (let j = 0; j < fine.nz; j++) for (let i = 0; i < fine.nx; i++) atlas[j * aw + i] = fine.h[j * fine.nx + i];
  for (let j = 0; j < coarse.nz; j++) for (let i = 0; i < coarse.nx; i++) atlas[(fine.nz + j) * aw + i] = coarse.h[j * coarse.nx + i];
  const heights = new THREE.DataTexture(atlas, aw, ah, THREE.RedFormat, THREE.FloatType);
  heights.needsUpdate = true;
  const u: RingUniforms = makeRingUniforms();
  u.uHorizonHeights.value = heights;
  u.uHorizonFine.value.set(fine.x0, fine.z0, fine.step, 0);
  u.uHorizonCoarse.value.set(coarse.x0, coarse.z0, coarse.step, 3);
  u.uHorizonSizes.value.set(fine.nx, fine.nz, coarse.nx, coarse.nz);
  const r = ringNodes(u);
  // The cases: x, y, z, w each case's four inputs.
  type Case = { a: [number, number, number, number]; b: [number, number, number, number]; want: [number, number, number, number] };
  const lod0 = 1400;
  const morph = 0.3;
  const cases: Case[] = [];
  const dists = [0, 500, 1400, 1700, 2600, 2900, 5000, 11000, 30000];
  const shapes: [number, number, number][] = [
    [300, 700, 0],
    [300, 700, -1],
    [300, 700, -2],
  ];
  for (const d of dists) {
    for (const s of shapes) {
      for (const e of [-40, 0, 30, 64, 100, 200, 450, 1000]) {
        const vv = 123.37 + d * 0.37;
        const w = (d % 7) * 0.61;
        const node = (e % 3) - 0.5;
        cases.push({
          a: [d, e, vv, w],
          b: [node, s[0], s[1], s[2]],
          want: [ringLevelOf(d, lod0, morph, s[0], s[1], s[2], 0.15), ringEdgeLevel(e, 64, morph), ringMorphAxis(vv, 3.5, w, node), ringDistLevel(d, lod0, morph)],
        });
      }
    }
  }
  const reachCases: Case[] = [];
  for (const [dx, dz] of [
    [0, 0],
    [100, 50],
    [3000, -4000],
    [-7000, 2000],
  ])
    for (const e of [-10, 0, 100, 300])
      for (const [rx, rz] of [
        [104, 205],
        [116.5, 219],
        [132, 224],
        [80, 190],
        [-30, 100],
        [180, 40],
        [99.99, 200],
      ])
        reachCases.push({ a: [dx, dz, e, rx], b: [rz, 0, 0, 0], want: [ringReach(dx, dz, 4200), ringDrop(e, 2.5, 256, 0), ringDrop(e, 2.5, 256, 1), bakeHeightAt(fine, coarse, rx, rz)] });
  const all = cases.length + reachCases.length;
  const A = uniformArray(
    [...cases, ...reachCases].map((c) => new THREE.Vector4(...c.a)),
    'vec4',
  );
  const B = uniformArray(
    [...cases, ...reachCases].map((c) => new THREE.Vector4(...c.b)),
    'vec4',
  );
  const split = cases.length;
  const m = new MeshBasicNodeMaterial();
  m.depthTest = false;
  m.depthWrite = false;
  // The fragment written whole (three forces an opaque material's colour alpha to one, and the fourth channel is a result).
  m.fragmentNode = Fn(() => {
    const i = int(floor(screenCoordinate.x));
    const a = A.element(i);
    const b = B.element(i);
    const lod = float(lod0);
    const mo = float(morph);
    const first = vec4(ringLevelOfN(a.x, lod, mo, vec4(b.y, b.z, b.w, 0), float(0.15)), ringEdgeLevelN(a.y, float(64), mo), ringMorphN(a.z, float(3.5), a.w, b.x), ringDistLevelN(a.x, lod, mo));
    const second = vec4(ringReachN(a.x, a.y, float(4200)), ringDropN(a.z, float(2.5), float(256), float(0)), ringDropN(a.z, float(2.5), float(256), float(1)), bakeHeightN(r, a.w, b.x));
    return select(i.lessThan(split), first, second);
  })();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
  quad.frustumCulled = false;
  quad.userData.swgSelfTest = true;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const target = new THREE.RenderTarget(all, 1, { type: THREE.FloatType, depthBuffer: false });
  const previous = renderer.getRenderTarget();
  const worst = { level: 0, edge: 0, morph: 0, dist: 0, reach: 0, drop: 0, height: 0 };
  const misses: Record<string, unknown>[] = [];
  let failed: string | null = null;
  try {
    renderer.setRenderTarget(target);
    renderer.render(scene, cam);
    renderer.setRenderTarget(previous);
    const px = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, all, 1)) as Float32Array;
    const rel = (got: number, want: number) => Math.abs(got - want) / Math.max(1, Math.abs(want));
    [...cases, ...reachCases].forEach((c, k) => {
      const p = [px[k * 4], px[k * 4 + 1], px[k * 4 + 2], px[k * 4 + 3]];
      if (p.some((x, q) => rel(x, c.want[q]) > 1e-3) && misses.filter((s) => (s.k as number) >= split === k >= split).length < 6) misses.push({ k, a: c.a, b: c.b, got: p, want: c.want });
      if (k < split) {
        worst.level = Math.max(worst.level, rel(p[0], c.want[0]));
        worst.edge = Math.max(worst.edge, rel(p[1], c.want[1]));
        worst.morph = Math.max(worst.morph, rel(p[2], c.want[2]));
        worst.dist = Math.max(worst.dist, rel(p[3], c.want[3]));
      } else {
        worst.reach = Math.max(worst.reach, rel(p[0], c.want[0]));
        worst.drop = Math.max(worst.drop, rel(p[1], c.want[1]), rel(p[2], c.want[2]));
        worst.height = Math.max(worst.height, rel(p[3], c.want[3]));
      }
    });
  } catch (e) {
    failed = String((e as Error)?.message ?? e).slice(0, 300);
  } finally {
    renderer.setRenderTarget(previous);
    target.dispose();
    m.dispose();
    quad.geometry.dispose();
    heights.dispose();
  }
  const most = Math.max(...Object.values(worst));
  const fmt = Object.fromEntries(Object.entries(worst).map(([k, x]) => [k, Number(x.toExponential(2))]));
  return { cases: all, worst: fmt, misses, failed, ok: failed === null && most < 1e-3 };
}

/**
 * `HORIZON_RING_VERTEX` written out over `horizonMath.ts`: a vertex's place in the game's frame and its edge distance, for an
 * instance `a` (corner x, corner z, level, side) and a patch or skirt vertex `p`, the shape window not read.
 */
function ringVertexCpu(a: readonly number[], p: readonly number[], u: RingUniforms, frame: THREE.Vector4, fine: BakeGrid, coarse: BakeGrid): [number, number, number, number] {
  const [ax, az, gL, side] = a;
  const [px, py, pz] = p;
  const E = u.uHorizonEye.value;
  const Q = u.uHorizonSquare.value;
  const M = u.uHorizonMorph.value;
  const D = u.uHorizonDrop.value;
  const G = u.uHorizonGrid.value;
  const S = u.uHorizonShape.value;
  const gQ = (LEAF / PATCH) * Math.pow(2, gL);
  let gI = px;
  let gJ = pz;
  let hang = 0;
  if (side > 0.5) {
    if (side < 1.5) [gI, gJ] = [px, 0];
    else if (side < 2.5) [gI, gJ] = [PATCH, px];
    else if (side < 3.5) [gI, gJ] = [px, PATCH];
    else [gI, gJ] = [0, px];
    hang = py > 1.5 ? 1 : 0;
  }
  const gVx = ax + gI * gQ;
  const gVz = az + gJ * gQ;
  const gH0 = bakeHeightAt(fine, coarse, frame.x - gVx, gVz + frame.y);
  const d = Math.sqrt((gVx - E.x) ** 2 + (gH0 - E.y) ** 2 + (gVz - E.z) ** 2);
  const gD = ringLevelOf(d, M.x, M.y, S.x, S.y, S.z, u.uHorizonShapeAt.value.w);
  const gE = ringEdgeLevel(ringEdgeDistance(gVx, gVz, Q.x, Q.y, Q.z, Q.w), M.z, M.y);
  const gW = Math.min(gD, gE, M.w);
  let gMx = ringMorphAxis(gVx, G.x, gW, gL);
  let gMz = ringMorphAxis(gVz, G.y, gW, gL);
  const k = ringReach(gMx - E.x, gMz - E.z, E.w);
  gMx = E.x + (gMx - E.x) * k;
  gMz = E.z + (gMz - E.z) * k;
  const edge = ringEdgeDistance(gMx, gMz, Q.x, Q.y, Q.z, Q.w);
  const h = bakeHeightAt(fine, coarse, frame.x - gMx, gMz + frame.y);
  return [gMx, h - ringDrop(edge, D.x, D.y, D.z) - hang * D.w, gMz, edge];
}

/**
 * The ring's vertex stage whole on the GPU: `ringVertexN`, the very composition the ring's draw calls (its node functions in
 * order, the skirts' sides and hang, the morph, the reach, the drop), run a case a texel over a small bake of its own and
 * held to `ringVertexCpu`. The arithmetic part holds the parts; this holds how they are put together.
 */
async function ringVertexCheck(renderer: Any): Promise<Record<string, unknown>> {
  const fine: BakeGrid = { x0: 100, z0: 200, step: 8, nx: 5, nz: 4, h: Array.from({ length: 20 }, (_, i) => 10 + 3.5 * Math.sin(i * 1.7) + i * 0.25) };
  const coarse: BakeGrid = { x0: -64, z0: 0, step: 64, nx: 4, nz: 4, h: Array.from({ length: 16 }, (_, i) => -20 + 7 * Math.cos(i * 0.9) + i) };
  const aw = Math.max(fine.nx, coarse.nx);
  const ah = fine.nz + coarse.nz;
  const atlas = new Float32Array(aw * ah);
  for (let j = 0; j < fine.nz; j++) for (let i = 0; i < fine.nx; i++) atlas[j * aw + i] = fine.h[j * fine.nx + i];
  for (let j = 0; j < coarse.nz; j++) for (let i = 0; i < coarse.nx; i++) atlas[(fine.nz + j) * aw + i] = coarse.h[j * coarse.nx + i];
  const heights = new THREE.DataTexture(atlas, aw, ah, THREE.RedFormat, THREE.FloatType);
  heights.needsUpdate = true;
  const u: RingUniforms = makeRingUniforms();
  u.uHorizonHeights.value = heights;
  u.uHorizonFine.value.set(fine.x0, fine.z0, fine.step, 0);
  u.uHorizonCoarse.value.set(coarse.x0, coarse.z0, coarse.step, 3);
  u.uHorizonSizes.value.set(fine.nx, fine.nz, coarse.nx, coarse.nz);
  // An eye inside a hole, a reach that pulls the far corners in, levels down to the 2 m one, a drop with a hang.
  u.uHorizonEye.value.set(10, 25, 120, 200);
  u.uHorizonSquare.value.set(-20, 90, 40, 150);
  u.uHorizonMorph.value.set(120, 0.3, 16, 5);
  u.uHorizonDrop.value.set(2.5, 40, 0, 1.5);
  u.uHorizonGrid.value.set(0.5, -1.5, 0, 0);
  u.uHorizonShape.value.set(40, 90, -2, 0);
  u.uHorizonShapeAt.value.set(2, 1024, 16, 0.2);
  const frame = new THREE.Vector4(40, -30, -1, 0);
  const cases: { a: number[]; p: number[] }[] = [];
  for (const gL of [-2, -1, 0, 1, 2]) {
    const node = LEAF * Math.pow(2, gL);
    for (const [ci, cj] of [
      [-1, 1],
      [0, 2],
    ]) {
      const a = [0.5 + node * ci, -1.5 + node * cj, gL, 0];
      for (const i of [0, 3, 8]) for (const j of [0, 3, 8]) cases.push({ a, p: [i, 0, j, 0] });
      for (const side of [1, 2, 3, 4]) for (const i of [0, 3, 8]) for (const y of [1, 2]) cases.push({ a: [a[0], a[1], gL, side], p: [i, y, 0, 0] });
    }
  }
  const n = cases.length;
  const A = uniformArray(
    cases.map((c) => new THREE.Vector4(c.a[0], c.a[1], c.a[2], c.a[3])),
    'vec4',
  );
  const B = uniformArray(
    cases.map((c) => new THREE.Vector4(c.p[0], c.p[1], c.p[2], c.p[3])),
    'vec4',
  );
  const r = ringNodes(u);
  const fr = uniform(frame);
  const m = new MeshBasicNodeMaterial();
  m.depthTest = false;
  m.depthWrite = false;
  m.fragmentNode = Fn(() => {
    const i = int(floor(screenCoordinate.x));
    const o = ringVertexN(r, fr, A.element(i), B.element(i));
    return vec4(o.pos.x, o.pos.y, o.pos.z, o.edge);
  })();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
  quad.frustumCulled = false;
  quad.userData.swgSelfTest = true;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const target = new THREE.RenderTarget(n, 1, { type: THREE.FloatType, depthBuffer: false });
  const previous = renderer.getRenderTarget();
  let worst = 0;
  let failed: string | null = null;
  const misses: Record<string, unknown>[] = [];
  const reached = { pulledIn: 0, morphed: 0, skirts: 0 };
  try {
    renderer.setRenderTarget(target);
    renderer.render(scene, cam);
    renderer.setRenderTarget(previous);
    const px = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, n, 1)) as Float32Array;
    cases.forEach((c, k) => {
      const want = ringVertexCpu(c.a, c.p, u, frame, fine, coarse);
      const got = [px[k * 4], px[k * 4 + 1], px[k * 4 + 2], px[k * 4 + 3]];
      const d = Math.max(...got.map((x, q) => Math.abs(x - want[q])));
      if (d > 0.01 && misses.length < 6) misses.push({ k, a: c.a, p: c.p, got: got.map((x) => Number(x.toFixed(3))), want: want.map((x) => Number(x.toFixed(3))) });
      worst = Math.max(worst, d);
      if (Math.hypot(want[0] - u.uHorizonEye.value.x, want[2] - u.uHorizonEye.value.z) > u.uHorizonEye.value.w - 1e-3) reached.pulledIn++;
      if (c.a[3] > 0.5) reached.skirts++;
      const gQ = (LEAF / PATCH) * Math.pow(2, c.a[2]);
      const gx = c.a[0] + c.p[0] * gQ;
      if (c.a[3] < 0.5 && Math.abs(want[0] - gx) > 1e-6) reached.morphed++;
    });
  } catch (e) {
    failed = String((e as Error)?.message ?? e).slice(0, 300);
  } finally {
    renderer.setRenderTarget(previous);
    target.dispose();
    m.dispose();
    quad.geometry.dispose();
    heights.dispose();
  }
  return { cases: n, worstMetres: Number(worst.toExponential(2)), reached, misses, failed, ok: failed === null && worst < 0.01 };
}
