// The lens flare on WebGPU under our sky (the GPU port's pass 2, wave 3; the design's 2.9): the WebGL pass's own arithmetic
// (`lensFlare.ts`, every number of it `flareMath.ts`'s) with its three draws on node graphs over that pass's very uniforms,
// as the chain's other passes are ported (`gpuChainPasses.ts`). It follows the sun discs and, at night, the moon
// (`flareSources.ts`, written by the world), and it reads through the eye:
//
//   1. **The occlusion** (a 2 by 1 half-float target, a texel a source): 16 taps of the scene's depth over each source's disc
//      (a Vogel disc, the WebGL pass's 24 made 16 by the design), open where the depth lies at or beyond the distance the sky
//      draws it at, times the cloud sheets' own alpha along its line, times how bright the source looks on the screen (its
//      light a steradian, `FLARE_SEEN`, times the eye's exposure and the player's, between `FLARE_AIR.seenFrom` and `seenTo`:
//      a sun under the land or a moon in the day's blue flares none), smoothed against last frame's.
//   2. **The elements**: the WebGL pass's instanced quads at half size (a core glare, a veil, a starburst, a streak and seven
//      ghosts a source), each faded in its vertex graph by the visibility just drawn, so nothing is read back.
//   3. **The composite**: the elements laid on the picture under the knee and the ceiling in the light the screen shows (the
//      picture is stored pre-exposed, so its light on the screen is it times the eye's exposure over the store's, times the
//      player's), the flare's own light read as the screen's, so a flare at night is the flare at noon.
//
// Nothing here is loaded on the WebGL path; the chain registers it on WebGPU under our sky (`gpuChainPasses.ts`).

import * as THREE from 'three';
import * as TSL from 'three/tsl';
import { NodeMaterial } from 'three/webgpu';
import { LensFlarePass } from '../../core/fx/lensFlare.ts';
import type { FxFrameContext } from '../../core/fx/context.ts';
import { FX_CAMERA, type FxWarmItem } from '../../core/fx/pass.ts';
import { MAX_FLARE_SOURCES, SPIKE_PHASES } from '../../core/fx/flareMath.ts';
import { chainMaterial, graph, live, ref, storedOf, tex, type ChainGraph } from '../../core/gpu/gpuChain.ts';
import { liveTexture } from '../../core/gpu/gpuGround.ts';
import { singleSampled } from '../../core/gpu/gpuSsao.ts';
import { eyeExposureNode } from '../exposure/eyeBuffer.ts';
import { FLARE_SEEN } from './flareSources.ts';
import { FLARE_AIR } from './nightTune.ts';
import { CLOUD_TRACE } from '../clouds/cloudMarch.ts';
import { CLOUD_DRAW } from '../clouds/cloudTune.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { Fn, If, Loop, abs, atan, attribute, clamp, cos, dot, exp, float, floor, fract, int, inverseSqrt, ivec2, length, max, min, mix, mod, positionGeometry, pow, renderGroup, select, sin, smoothstep, sqrt, step, uniform, uv, varyingProperty, vec2, vec3, vec4 } = TSL as Any;

/** The flare's numbers on WebGPU that are not `flareMath.ts`'s: the design's 16 taps, and the WebGL Vogel disc's golden angle. */
export const GPU_FLARE = { taps: 16, golden: 2.3999632 } as const;

/** What the pass has done, for `__debug.flare()` and the node test. */
export const GPU_FLARE_STATS = { built: 0, drawn: 0 };

/** The frame's numbers the occlusion reads beside the WebGL pass's: each source's light a steradian, and the seen band. */
const SEEN = { radiance: new THREE.Vector4(0.5, 0.5, 0.5, 0.5), band: new THREE.Vector4(0.5, 0.5, 0.5, 0.5) };

/** A WebGL uniform holding an array of vectors: one uniform node a slot, each read by reference once a render. */
const refEach = (u: { value: unknown }): Any[] => (u.value as object[]).map((v) => uniform(v as never).setGroup(renderGroup));

/** One of two slots' values by a slot index node (0 or 1). */
const pick = (slot: Any, a: Any[]): Any => (a.length > 1 ? select(slot.equal(0), a[0], a[1]) : a[0]);

/** `fxHash` (`glsl.ts`'s FX_HASH): a fraction from a vec2, the WebGL text's numbers. */
const fxHash = (p: Any): Any => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));

/**
 * A depth slot's own fallback, of the scene's depth's kind (three takes a slot's sample type from the picture standing in it
 * as the graph is built: a colour fallback there would bind no depth texture), held single-sampled (`singleSampled`).
 */
function depthFallback(reversed: boolean): THREE.DepthTexture {
  const d = new THREE.DepthTexture(1, 1, reversed ? THREE.FloatType : THREE.UnsignedInt248Type);
  d.format = THREE.DepthStencilFormat;
  d.needsUpdate = true;
  singleSampled(d);
  return d;
}

/** A cloud slot's own fallback: an eight-bit picture, the kind the sky's cloud pictures are, linear-filtered with no mips. */
function cloudFallback(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const COMPONENT = ['x', 'y', 'z', 'w'] as const;

/**
 * The occlusion's graph (`lensFlare.ts`'s FLARE_OCCLUSION with 16 taps): a texel a source, its taps over the disc read from
 * the scene's depth (a WebGPU depth texture's first row is the top, so a tap at the WebGL pass's pixel y reads row H − 1 − y),
 * the cloud sheets along its line, the source's seen share, smoothed toward the raw value at the rise or fall rate.
 */
export function occlusionGraph(u: Record<string, { value: Any }>, reversed: boolean): ChainGraph {
  GPU_FLARE_STATS.built++;
  const m = chainMaterial('fx.gpu.flare.occlusion');
  const depth = liveTexture(u.tDepth as { value: THREE.Texture | null }, depthFallback(reversed));
  const prev = tex(u.tPrev);
  const clouds = [u.tCloud0, u.tCloud1, u.tCloud2, u.tCloud3].map((c) => liveTexture(c as { value: THREE.Texture | null }, cloudFallback()));
  const viewport = ref(u.uViewport);
  const nearFar = ref(u.uNearFar);
  const tanHalf = ref(u.uTanHalfFov);
  const rate = ref(u.uRate);
  const src = refEach(u.uSource);
  const srcDir = refEach(u.uSourceDir);
  const lods = refEach(u.uCloudLod);
  const cam = ref(u.uCameraPos);
  const cl = refEach(u.uCloud);
  const scroll = refEach(u.uCloudScroll);
  const fade = refEach(u.uCloudFade);
  const radiance = uniform(SEEN.radiance).setGroup(renderGroup);
  const band = uniform(SEEN.band).setGroup(renderGroup);
  // Pass 3, wave 1 (maker V): the clouds' trace (its alpha what gets through the cloud), read at the source's pixel on a frame
  // the march drew, in place of the four sheets (which the march hides); with the clouds off, the sheets as before.
  const trace = liveTexture(CLOUD_TRACE, traceFallback());
  const marching = cloudsMarchingNode();
  const N = GPU_FLARE.taps;
  m.fragmentNode = Fn(() => {
    const slot = int(floor(uv().x.mul(MAX_FLARE_SOURCES))).toVar('swgFlareSlot');
    const s = vec4(pick(slot, src)).toVar('swgFlareS');
    const sd = vec4(pick(slot, srcDir)).toVar('swgFlareSd');
    const lod = vec4(pick(slot, lods)).toVar('swgFlareLod');
    const was = float(prev.load(ivec2(slot, 0)).x).toVar('swgFlarePrev');
    // Every cloud sheet read at the top, before anything branches, along the source's line at its own mip level.
    const covers: Any[] = [];
    for (let k = 0; k < 4; k++) {
      const layer = cl[k];
      const dirY = max(sd.y, 0.011);
      const t = layer.x.sub(cam.y).div(dirY);
      const xz = cam.xz.add(sd.xz.mul(t));
      const dist = t.mul(length(sd.xz));
      const f = float(1).sub(smoothstep(fade[k].x, fade[k].y, dist));
      const a = float(clouds[k].sample(xz.div(layer.y).add(scroll[k])).level(lod[COMPONENT[k]]).w).toVar(`swgFlareCloud${k}`);
      const on = layer.z.greaterThan(0).and(sd.y.greaterThan(0.01)).and(t.greaterThan(0));
      covers.push(select(on, clamp(a.mul(layer.z).mul(f), 0, 1), float(0)));
    }
    // The trace's transmittance at the source's place (the WebGL pass's y up made a WebGPU picture's row from the top).
    const cloudT = float(trace.sample(vec2(clamp(s.x, 0, 1), clamp(float(1).sub(s.y), 0, 1))).level(0).w).toVar('swgFlareCloudT');
    const open = float(0).toVar('swgFlareOpen');
    const clear = float(1).toVar('swgFlareClear');
    If(s.w.greaterThan(0.5), () => {
      const centre = s.xy.mul(viewport);
      const skyDist = max(sd.w, 1);
      const range = nearFar.y.sub(nearFar.x);
      Loop(N, ({ i }: Any) => {
        const fi = float(i).toVar('swgFlareI');
        const r = sqrt(fi.add(0.5).div(N)).mul(s.z);
        const a = fi.mul(GPU_FLARE.golden);
        const px = centre.add(vec2(cos(a), sin(a)).mul(r)).toVar('swgFlarePx');
        const inside = px.x.greaterThanEqual(0).and(px.y.greaterThanEqual(0)).and(px.x.lessThan(viewport.x)).and(px.y.lessThan(viewport.y));
        const ndc = floor(px).add(0.5).div(viewport).mul(2).sub(1);
        const slope = ndc.mul(tanHalf);
        const viewZ = skyDist.mul(inverseSqrt(float(1).add(dot(slope, slope))));
        const gap = nearFar.x.mul(nearFar.y.sub(viewZ)).div(viewZ.mul(range));
        // The WebGL pass's pixel (its y up from the bottom) at the WebGPU texture's row (counted down from the top).
        const row = clamp(viewport.y.sub(1).sub(floor(px.y)), 0, viewport.y.sub(1));
        const col = clamp(floor(px.x), 0, viewport.x.sub(1));
        const d = float(depth.load(ivec2(int(col), int(row))).x).toVar('swgFlareD');
        const hit = reversed ? step(d, gap) : step(float(1).sub(d), gap);
        open.addAssign(select(inside, hit, float(0)));
      });
      open.divAssign(N);
      const sheets = float(1).sub(covers[0]).mul(float(1).sub(covers[1])).mul(float(1).sub(covers[2])).mul(float(1).sub(covers[3]));
      clear.assign(select(marching.greaterThan(0.5), clamp(cloudT, 0, 1), sheets));
    });
    // How bright the source looks on the screen: its light a steradian times the eye's exposure and the player's (`band.z`).
    const shown = pick(slot, [radiance.x, radiance.y]).mul(eyeExposureNode()).mul(band.z);
    const seen = smoothstep(band.x, max(band.y, band.x.add(1e-3)), shown);
    const raw = open.mul(clear).mul(seen);
    const k = select(raw.greaterThan(was), rate.x, rate.y);
    return vec4(clamp(mix(was, raw, k), 0, 1), open, clear, 1);
  })();
  return graph(m, 7, { uniforms: { uViewport: viewport, uNearFar: nearFar, uTanHalfFov: tanHalf, uRate: rate, uCameraPos: cam, marching }, textures: { tDepth: depth, tPrev: prev, tCloud0: clouds[0], tCloud1: clouds[1], tCloud2: clouds[2], tCloud3: clouds[3], tCloudTrace: trace } });
}

/** The clouds' trace slot's own fallback: one half-float texel all through (alpha one), the trace's own kind. */
function traceFallback(): THREE.DataTexture {
  const one = 0x3c00;
  const t = new THREE.DataTexture(new Uint16Array([one, one, one, one]), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** 1 on a frame the clouds' march drew (it stands before the flare in the chain), read once a render; a small whole number, never boxed. */
let MARCHING: Any = null;
function cloudsMarchingNode(): Any {
  if (!MARCHING) MARCHING = uniform(0).setGroup(renderGroup).onRenderUpdate(() => (CLOUD_DRAW.drew ? 1 : 0));
  return MARCHING;
}

/**
 * The elements' graph (`lensFlare.ts`'s FLARE_ELEMENTS_VERT and _FRAG): the WebGL pass's own instanced quads (its geometry:
 * `aShape`, `aTint`, `aSlot`), each placed and sized in its vertex graph and faded there by the visibility just drawn (read
 * with a load in the vertex stage), the shapes drawn in its fragment, added one and one into the flare's half-size target.
 */
export function elementsGraph(u: Record<string, { value: Any }>, geometry: THREE.BufferGeometry): ChainGraph {
  GPU_FLARE_STATS.built++;
  const m = new NodeMaterial();
  m.name = 'fx.gpu.flare.elements';
  m.depthTest = false;
  m.depthWrite = false;
  (m as Any).lights = false;
  m.fog = false;
  m.toneMapped = false;
  m.userData.swgChain = true;
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneFactor;
  m.blendEquation = THREE.AddEquation;
  m.transparent = true;
  const vis = tex(u.tVis);
  const src = refEach(u.uSource);
  const tint = refEach(u.uSourceTint);
  const shape = refEach(u.uSourceShape);
  const aspect = live(u.uAspect);
  const look = ref(u.uLook);
  const look2 = ref(u.uLook2);
  const aShape = attribute('aShape', 'vec4');
  const aTint = attribute('aTint', 'vec4');
  const aSlot = attribute('aSlot', 'float');
  // Assigned in the vertex graph and read in the fragment's.
  const vLocal = varyingProperty('vec2', 'swgFlareLocal');
  const vColor = varyingProperty('vec3', 'swgFlareColor');
  const vKind = varyingProperty('float', 'swgFlareKind');
  const vChroma = varyingProperty('float', 'swgFlareChroma');
  m.vertexNode = Fn(() => {
    const slot = int(aSlot.add(0.5)).toVar('swgFlareVSlot');
    const s = vec4(pick(slot, src)).toVar('swgFlareVS');
    const sh = vec3(pick(slot, shape)).toVar('swgFlareVSh');
    const ti = vec3(pick(slot, tint)).toVar('swgFlareVT');
    const kind = int(aShape.x.add(0.5)).toVar('swgFlareVKind');
    const gain = float(0).toVar('swgFlareGain');
    const half = vec2(0).toVar('swgFlareHalf');
    If(kind.equal(0), () => {
      gain.assign(look.x);
      half.assign(vec2(aShape.z.mul(sh.x)));
    })
      .ElseIf(kind.equal(1), () => {
        gain.assign(look.y);
        half.assign(vec2(aShape.z.mul(sh.y)));
      })
      .ElseIf(kind.equal(2), () => {
        gain.assign(look.z.mul(float(1).sub(s.w)));
        half.assign(vec2(min(aShape.z.mul(sh.y), look2.z)));
      })
      .ElseIf(kind.equal(3), () => {
        gain.assign(look.w.mul(float(1).sub(s.w.mul(0.5))));
        half.assign(vec2(aShape.z, look2.y.mul(6)));
      })
      .Else(() => {
        gain.assign(look2.x.mul(sh.z).mul(smoothstep(0.03, 0.2, length(s.xy))));
        half.assign(vec2(aShape.z));
      });
    const v = float(vis.load(ivec2(slot, 0)).x).toVar('swgFlareVis');
    const intensity = s.z.mul(v).mul(aShape.w).mul(gain).toVar('swgFlareInt');
    const p = s.xy.mul(aShape.y).add(positionGeometry.xy.mul(half));
    const out = vec4(p.x.div(aspect).mul(2), p.y.mul(2), 0, 1).toVar('swgFlarePos');
    vLocal.assign(positionGeometry.xy);
    vColor.assign(aTint.xyz.mul(ti).mul(intensity));
    vKind.assign(aShape.x);
    vChroma.assign(aTint.w);
    // Nothing to draw (or not a number): the quad outside the clip's box.
    If(intensity.greaterThanEqual(1e-4).not(), () => {
      out.assign(vec4(2, 2, 2, 1));
      vColor.assign(vec3(0));
    });
    return out;
  })();
  const p1 = SPIKE_PHASES[0];
  const p2 = SPIKE_PHASES[1];
  m.fragmentNode = Fn(() => {
    const local = vec2(vLocal).toVar('swgFlareL');
    const kind = int(vKind.add(0.5)).toVar('swgFlareK');
    const r = length(local).toVar('swgFlareR');
    const c = vec3(0).toVar('swgFlareC');
    const edge3 = (x: Any, a: number, b: number): Any => vec3(1).sub(smoothstep(vec3(a), vec3(b), x));
    If(kind.equal(0), () => {
      c.assign(vec3(exp(r.mul(r).mul(-5)).mul(float(1).sub(smoothstep(0.8, 1, r)))));
    })
      .ElseIf(kind.equal(1), () => {
        const f = max(float(1).sub(r), 0);
        c.assign(vec3(f.mul(f).mul(f)));
      })
      .ElseIf(kind.equal(2), () => {
        const a = select(dot(local, local).greaterThan(1e-12), atan(local.y, local.x), float(0));
        const q1 = a.mul(3).add(p1);
        const q2 = a.mul(3).add(p2);
        const len1 = float(0.6).add(fxHash(vec2(mod(floor(q1.div(Math.PI).add(0.5)), 6), 7)).mul(0.4));
        const len2 = float(0.6).add(fxHash(vec2(mod(floor(q2.div(Math.PI).add(0.5)), 6), 13)).mul(0.4));
        const spikes = pow(abs(cos(q1)), 80).mul(exp(r.div(len1).mul(-4))).add(pow(abs(cos(q2)), 160).mul(exp(r.div(len2).mul(-4))).mul(0.5));
        c.assign(vec3(spikes.mul(float(1).sub(smoothstep(0.9, 1, r)))));
      })
      .ElseIf(kind.equal(3), () => {
        const y = local.y.mul(6);
        const along = max(float(1).sub(abs(local.x)), 0);
        c.assign(vec3(exp(y.mul(y).mul(-2)).mul(along).mul(along).mul(along)));
      })
      .Else(() => {
        const rr = vec3(r.mul(float(1).sub(vChroma)), r, r.mul(float(1).add(vChroma)));
        If(kind.equal(4), () => {
          c.assign(edge3(rr, 0.75, 1));
        })
          .ElseIf(kind.equal(5), () => {
            const pa = abs(local);
            const h = max(pa.x.mul(0.8660254).add(pa.y.mul(0.5)), pa.y);
            const hh = vec3(h.mul(float(1).sub(vChroma)), h, h.mul(float(1).add(vChroma)));
            c.assign(edge3(hh, 0.85, 1).mul(0.8).add(edge3(hh, 0, 0.9).mul(0.2)));
          })
          .Else(() => {
            c.assign(vec3(1).sub(smoothstep(vec3(0), vec3(0.12), abs(rr.sub(0.85)))));
          });
      });
    return vec4(c.mul(vColor), 1);
  })();
  const mesh = new THREE.Mesh(geometry, m);
  mesh.frustumCulled = false;
  mesh.name = m.name;
  return { material: m, mesh, textures: 1, parts: { uniforms: { uAspect: aspect, uLook: look, uLook2: look2 }, textures: { tVis: vis } } };
}

/**
 * The composite's graph (`lensFlare.ts`'s FLARE_COMPOSITE, through the eye): the picture's light on the screen is its value
 * times the eye's exposure over the store's (`storedOf`) times the player's (`uExposure`), the flare's is its own value times
 * the player's (the WebGL pass's), the flare added under the knee and never past the ceiling in that light, and laid back in
 * the picture's units.
 */
export function compositeGraph(u: Record<string, { value: Any }>): ChainGraph {
  GPU_FLARE_STATS.built++;
  const m = chainMaterial('fx.gpu.flare.composite');
  const input = tex(u.tDiffuse);
  const flare = tex(u.tFlare);
  const exposure = live(u.uExposure);
  const knee = ref(u.uKnee);
  const debugOnly = live(u.uDebugOnly);
  const LUMA = vec3(0.2126, 0.7152, 0.0722);
  m.fragmentNode = Fn(() => {
    const at = uv();
    const c = vec4(input.sample(at)).toVar('swgFlareCol');
    const f = max(vec3(flare.sample(at).xyz), vec3(0)).toVar('swgFlareF');
    // The picture's light on the screen a unit of its value: the eye's exposure over the store's, times the player's.
    const shown = eyeExposureNode().div(storedOf()).mul(exposure).toVar('swgFlareShown');
    const lf = dot(f, LUMA).mul(exposure).toVar('swgFlareLf');
    const out = vec4(c).toVar('swgFlareOut');
    If(lf.greaterThanEqual(1e-5).and(lf.lessThan(1e4)), () => {
      If(debugOnly.greaterThan(0.5), () => {
        out.assign(vec4(f, 1));
      }).Else(() => {
        const l = dot(c.xyz, LUMA).mul(shown);
        const kn = float(1).sub(smoothstep(knee.x, knee.y, l));
        const add = min(lf.mul(kn), max(knee.y.sub(l), 0));
        // `add` is the screen's light added; laid back in the picture's units (the player's exposure is in both).
        out.assign(vec4(c.xyz.add(f.mul(add.div(lf)).mul(exposure.div(max(shown, 1e-30)))), c.w));
      });
    }).Else(() => {
      If(debugOnly.greaterThan(0.5), () => {
        out.assign(vec4(0, 0, 0, 1));
      });
    });
    return out;
  })();
  return graph(m, 2, { uniforms: { uExposure: exposure, uKnee: knee, uDebugOnly: debugOnly }, textures: { tDiffuse: input, tFlare: flare } });
}

/** A graph drawn into a target. */
function draw(r: Any, g: ChainGraph, into: THREE.RenderTarget | null): void {
  r.setRenderTarget(into);
  r.render(g.mesh, FX_CAMERA);
}

/** The flare pass on WebGPU: the WebGL pass's `enabled`, `prepare`, report and look; its three draws on the graphs above. */
export class GpuLensFlarePass extends LensFlarePass {
  private readonly occG: ChainGraph;
  private readonly elG: ChainGraph;
  private readonly compG: ChainGraph;

  constructor(renderer: THREE.WebGLRenderer) {
    super(renderer);
    const self = this as Any;
    this.occG = occlusionGraph(self.occMaterial.uniforms, (renderer as Any).reversedDepthBuffer === true);
    this.elG = elementsGraph(self.elementsMaterial.uniforms, self.elements.geometry);
    this.compG = compositeGraph(self.compositeMaterial.uniforms);
  }

  /** The WebGL pass's draws, each on its graph, with the seen band and each source's light written first. */
  render(ctx: FxFrameContext, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget | null): boolean {
    const r = ctx.renderer as Any;
    const self = this as Any;
    const rad = SEEN.radiance;
    rad.x = FLARE_SEEN.radiance[0];
    rad.y = MAX_FLARE_SOURCES > 1 ? FLARE_SEEN.radiance[1] : 0;
    const band = SEEN.band;
    band.x = FLARE_AIR.seenFrom;
    band.y = FLARE_AIR.seenTo;
    band.z = r.toneMappingExposure;
    // 1. How much of each source shows, smoothed.
    draw(r, this.occG, self.occWrite);
    // 2. The elements at half size, faded by it.
    self.elementsMaterial.uniforms.tVis.value = self.occWrite.texture;
    r.setRenderTarget(self.flareTarget);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.render(this.elG.mesh, FX_CAMERA);
    // 3. Onto the picture.
    const c = self.compositeMaterial.uniforms;
    c.tDiffuse.value = input.texture;
    c.tFlare.value = self.flareTarget.texture;
    draw(r, this.compG, output);
    if (this.probeWanted) {
      this.probeWanted = false;
      this.lastProbe = { error: "the probe reads the picture back at once, which WebGL's readback does and WebGPU's does not: `__debug.flare()` reports the sources, and a picture read asynchronously shows the flare" };
    }
    const t = self.occRead;
    self.occRead = self.occWrite;
    self.occWrite = t;
    self.drawnFrame = ctx.frame;
    GPU_FLARE_STATS.drawn++;
    return true;
  }

  /** The last visibility read back (WebGPU reads back only asynchronously): per slot [smoothed, depth open, cloud transmittance]. */
  private visKept: number[][] = [];

  /**
   * The console's read of the 2 by 1 visibility (`__debug.flare()`): on WebGPU a read is asynchronous, so this starts one and
   * answers the last one's (an empty list the first time; ask again a moment later).
   */
  readVisibility(): number[][] {
    const self = this as Any;
    const r = self.renderer as Any;
    if (typeof r.readRenderTargetPixelsAsync === 'function') {
      void (r.readRenderTargetPixelsAsync(self.occRead, 0, 0, MAX_FLARE_SOURCES, 1) as Promise<Uint16Array>)
        .then((buf) => {
          const out: number[][] = [];
          for (let i = 0; i < MAX_FLARE_SOURCES; i++) out.push([0, 1, 2].map((c) => Number(THREE.DataUtils.fromHalfFloat(buf[i * 4 + c]).toFixed(3))));
          this.visKept = out;
        })
        .catch(() => {});
    }
    return this.visKept;
  }

  /** Each graph against the very target it draws into: the occlusion's own, the flare's half-size one, a chain buffer. */
  materials(): FxWarmItem[] {
    const self = this as Any;
    return [
      { material: this.occG.material, object: this.occG.mesh, where: 'target', into: self.occWrite },
      { material: this.elG.material, object: this.elG.mesh, where: 'target', into: self.flareTarget },
      { material: this.compG.material, object: this.compG.mesh, where: 'target' },
    ];
  }

  dispose(): void {
    this.occG.material.dispose();
    this.elG.material.dispose();
    this.compG.material.dispose();
    super.dispose();
  }
}
