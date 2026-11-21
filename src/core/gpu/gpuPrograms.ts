// Our own programs that stay, on WebGPU (the GPU port's step 5, items 3 to 6): the lava, the marks, the lightsaber blades,
// the client's particles (the quad batches, the weather's variant of them, the ribbons and the flip-books and solid quads
// written into them) and the hyperspace tunnel. On WebGL each is a `ShaderMaterial` of ours (`lava.ts`, `marks.ts`,
// `saberBlade.ts`, `particles.ts` and the weather's `WEATHER_PARTICLE_SHADER`, `hyperspaceTunnel.ts`); three's WebGPU
// renderer has no node class for one, so each site registers a node material here as its stand-in
// (`userData.gpuStandIn`, `fallback.ts`), drawn in its place with the original's render state (its blending, depth,
// side, stencil and polygon offset are read off the original by the backend at each draw).
//
// **One graph a kind, every material's own uniforms.** Three keeps one built node graph (and one pipeline) for every
// material whose cache key is equal, and a `ShaderMaterial`'s key is its text and its flags, never its uniforms: every
// particle batch, every blade's four ribbons, every lava look shares one key with the rest of its kind. So these graphs
// never hold a site's uniform object: each uniform is read at every draw off the material three is drawing
// (`frame.material.uniforms[name].value`, `own`, `OwnTexture`), in the object's own group, which is exactly the object
// WebGL's program reads, written or swapped in play (a blade's colour, a flip-book's map, the flow's clock, the fog). One
// node build serves a whole kind and a batch made in play builds nothing. Three refreshes an object's own group only when
// something about the object moved (`NodeMaterialObserver`), and a clock or a colour written in place moves nothing it
// watches, so every graph here asks for its object's refresh at every draw (`everyDraw`), as any node material with a node
// of its own is refreshed. The lava's crust, which WebGL keys by a define (`USE_MIX`, not in three's key either), is a
// uniform here: the crust is sampled always (from the ramp where there is none, as WebGL binds it) and taken only where the
// define is.
//
// **What each writes.** The lava, the particles and the tunnel write a colour WebGL then tone-maps and encodes
// (`tonemapping_fragment`, `colorspace_fragment`): written as it is, three's output pass does the same after every
// material. The marks and the blades write the canvas's own value with no tone mapping (`toneMapped: false`, no chunk): on
// WebGPU three tone-maps everything after, so each is carried back through three's ACES fit and the sRGB curve first
// (`asShown`, the ground's views' own: only into three's frame-buffer target, the Effects-off path; into the effects
// chain's scene target, step 6's, nothing is carried, as WebGL draws them into its own), and shows the same where it is drawn alone; where it blends over the scene WebGL
// blends the shown values and WebGPU the scene's, so a half-clear mark or a blade's add over a lit wall differs a little
// (measured by the picture pairs). Every number is the GLSL text's own, gathered per graph in `PROGRAM_NUMBERS` and held to
// the WebGL text by `gpuPrograms.test.ts`.

import * as THREE from 'three';
import { NodeMaterial, NodeUpdateType, Texture3DNode, TextureNode } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { asShownFB } from './gpuGround.ts';
import { LOOKS_AT_LOAD } from './looks.ts';
import { withMotionOutput } from './motion.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const {
  Discard,
  Fn,
  abs,
  atan,
  attribute,
  clamp,
  dot,
  exp,
  float,
  floor,
  fract,
  fwidth,
  ivec2,
  length,
  max,
  mix,
  mod,
  modelViewMatrix,
  positionLocal,
  positionWorld,
  property,
  select,
  sin,
  smoothstep,
  step,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} = TSL as Any;

/**
 * Every number the graphs are built from, each the WebGL text's own (`gpuPrograms.test.ts` reads the GLSL out of each
 * site's file and holds every literal there to these). Grouped by program.
 */
export const PROGRAM_NUMBERS = {
  lava: { farFrom: 2.0, farTo: 8.0, crustShift: 0.1, crustHalf: 0.5, crustSpan: 2.0, glowBase: 1.0, rampV: 0.5 },
  marks: {
    unborn: 0.0,
    saberKind: 0.5,
    saberSoft: 0.35,
    saberChar: [0.06, 0.035, 0.025],
    saberHotEdge: [1.0, 0.25, 0.05],
    saberHotMiddle: [1.0, 0.85, 0.5],
    saberHotReach: 0.5,
    saberCool: 0.8,
    cellInset: 0.002,
    cellOutset: 0.998,
    scarBelow: 5.5,
    lightningAbove: 4.5,
    printBelow: 6.5,
  },
  blade: { tipFrom: 0.0, tipIn: 0.04, endFrom: 0.9, endTo: 1.0 },
  particles: { cut: 0.002 },
  tunnel: {
    hash: [0.1031, 33.33],
    turn: 0.15915494,
    streakOn: 0.62,
    lineWidth: 0.07,
    tailIn: 0.08,
    tailFrom: 0.1,
    sharpGain: 1.5,
    /** The mean a cell under a pixel fades to, as the GLSL writes it: three factors, multiplied in the graph. */
    mean: [0.38, 0.07, 0.45],
    headBase: 0.6,
    radialFloor: 1e-5,
    footFloor: 1e-4,
    ragCells: 40.0,
    ragSeed: 7.0,
    ragDepth: 0.14,
    cutReach: 1.15,
    rimWidth: 0.06,
    twist: 0.3,
    layers: [
      { cols: 64.0, rows: 6.0, seed: 0.0, speed: 1.0, gain: 1.0, shift: 0.0 },
      { cols: 96.0, rows: 10.0, seed: 17.0, speed: 1.45, gain: 0.7, shift: 0.37 },
      { cols: 150.0, rows: 15.0, seed: 41.0, speed: 2.1, gain: 0.5, shift: 0.71 },
    ],
    aheadFrom: -0.3,
    aheadTo: 1.0,
    deep: [0.004, 0.012, 0.05],
    near: [0.03, 0.08, 0.28],
    band: [0.015, 0.04, 0.12],
    bandTurns: 18.849556,
    bandAlong: 9.0,
    bandRate: 2.2,
    streak: [0.55, 0.75, 1.0],
    streakGain: 2.6,
    core: [0.85, 0.93, 1.0],
    coreFrom: 0.8,
    coreGain: 3.0,
    rim: [0.6, 0.8, 1.0],
    rimGain: 1.8,
  },
} as const;

/** Graphs built and stand-ins made, by kind, for `__debug.gpu()` (one build serves a kind: see the header). */
export const PROGRAM_GPU_STATS = { lava: 0, marks: 0, blades: 0, particles: 0, weatherParticles: 0, tunnel: 0 };

// ---------------------------------------------------------------- reading the drawn material's own uniforms

interface Frame {
  material?: { uniforms?: Record<string, { value: unknown } | undefined> } | null;
}

/** One of the drawn material's own uniforms, by name, read at every draw: the very object WebGL's program reads. */
function own(name: string, init: unknown): Any {
  return uniform(init as never).onObjectUpdate((f: Frame) => f.material?.uniforms?.[name]?.value);
}

/**
 * A texture the drawn material holds in one of its uniforms, read at every draw: every sample is a clone of one base (one
 * binding, three's own `referenceNode`), and each clone takes the drawn material's picture, writing it through to the base.
 * Until a material has drawn, a fallback of the same kind stands in, so the binding always holds a real texture.
 */
function ownClass(Base: Any): Any {
  return class extends Base {
    ownName = '';
    fallback: THREE.Texture | null = null;
    constructor(value: THREE.Texture, uvNode: Any = null, levelNode: Any = null, biasNode: Any = null) {
      super(value, uvNode, levelNode, biasNode);
      this.updateType = NodeUpdateType.OBJECT;
      this.setUpdateMatrix(false);
    }
    update(frame: Frame): void {
      const t = (frame.material?.uniforms?.[this.ownName]?.value as THREE.Texture | null | undefined) ?? this.fallback;
      if (t && this.value !== t) this.value = t;
    }
    clone(): Any {
      const n = super.clone();
      n.ownName = this.ownName;
      n.fallback = this.fallback;
      n.setUpdateMatrix(false);
      return n;
    }
  };
}
const OwnTexture = ownClass(TextureNode);
const OwnTexture3D = ownClass(Texture3DNode);

function ownTexture(name: string, fallback: THREE.Texture, three = false): Any {
  const n = new (three ? OwnTexture3D : OwnTexture)(fallback) as Any;
  n.ownName = name;
  n.fallback = fallback;
  return n;
}

/**
 * The fallbacks: one texel of each kind a binding needs before its first draw, made once. Three writes a graph's texture
 * code from the texture its node holds as the graph is built (a texture filtered nearest both ways is fetched with
 * `textureLoad`, with no sampler), and shares one binding between two nodes holding the same texture (its uniform hash is
 * the texture's uuid): so a sampled slot's fallback is filtered linearly, as the pictures drawn there are, and two slots
 * of one graph never share a fallback (the lava's ramp and crust each have their own).
 */
let fallbacks: { white: THREE.DataTexture; crust: THREE.DataTexture; float: THREE.DataTexture; volume: THREE.Data3DTexture } | null = null;
function fallbackTextures(): NonNullable<typeof fallbacks> {
  if (!fallbacks) {
    const plainWhite = (): THREE.DataTexture => {
      const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.needsUpdate = true;
      return t;
    };
    const white = plainWhite();
    const crust = plainWhite();
    const float = new THREE.DataTexture(new Float32Array([1e9]), 1, 1, THREE.RedFormat, THREE.FloatType);
    float.needsUpdate = true;
    const volume = new THREE.Data3DTexture(new Uint8Array([128]), 1, 1, 1);
    volume.format = THREE.RedFormat;
    volume.type = THREE.UnsignedByteType;
    volume.wrapS = volume.wrapT = volume.wrapR = THREE.RepeatWrapping;
    volume.minFilter = THREE.LinearFilter;
    volume.magFilter = THREE.LinearFilter;
    volume.needsUpdate = true;
    fallbacks = { white, crust, float, volume };
  }
  return fallbacks;
}

/**
 * The object's own group refreshed at every draw: three rewrites an object's uniforms only when its matrix, its material's
 * fields or its geometry moved, and a value written in place (a clock, a colour, a flip-book's map in a uniform) moves none
 * of them. Three's own observer, told the graph has nodes of its own, as every node material with a node property is.
 */
const observerOf = NodeMaterial.prototype.setupObserver;
function everyDraw(m: Any): void {
  m.setupObserver = function (this: Any, builder: Any): Any {
    const o = observerOf.call(this, builder);
    o.hasNode = true;
    return o;
  };
}

/** A node material of the kind every graph here is: unlit, its fragment the whole of it, no fog of three's unless asked. */
function program(name: string, fog: boolean): Any {
  const m = new NodeMaterial() as Any;
  m.name = name;
  m.lights = false;
  m.fog = fog;
  everyDraw(m);
  // Pass 1, wave 5: a fragment of its own writes every output of a scene target that carries the motion (`motion.ts`).
  withMotionOutput(m);
  return m;
}

const v3 = (c: readonly number[]): Any => vec3(c[0], c[1], c[2]);

/**
 * The fragment: what must be taken before anything branches (`first`, each assigned to a property at the top), where it is
 * dropped, and what it writes. Three writes a `select` out as an `if` and a node out where it is first read, so a sample or a
 * derivative read first inside a `select` is taken inside a branch, undefined wherever the quad's lanes part; a graph whose
 * sample is read under a per-pixel `select` hands it here (the lava's crust and ramp). All three are kept on the material as
 * `gpuParts` for the node test, which walks them (a function's body is built only by a builder).
 */
function finish(m: Any, out: Any, gone: Any | null, first: readonly (readonly [Any, Any])[] = []): void {
  m.fragmentNode =
    gone || first.length
      ? Fn(() => {
          // What must be taken where the whole quad runs, before anything branches: three writes a `select` out as an `if`,
          // and a sample or a derivative first read inside one is undefined wherever the quad's lanes part.
          for (const [p, v] of first) p.assign(v);
          if (gone) Discard(gone);
          return out;
        })()
      : out;
  m.gpuParts = { out, gone, first: first.map(([, v]) => v) };
}

// ---------------------------------------------------------------- 3. the lava

/**
 * The client's lava (`lava.ts`'s `LAVA_VERT` and `LAVA_FRAG`): the noise volume at the world place turned by the look's
 * axes and scaled, moved by the flow; the ramp read by the noise's index, faded to its mean where the veins are under a
 * pixel; the crust under the low half; the glow pushed past bloom's threshold. Scene fog through three's own (WebGL's
 * `fog_fragment` over the scene's), tone-mapped after.
 */
export function lavaNode(): NodeMaterial {
  const k = PROGRAM_NUMBERS.lava;
  const fb = fallbackTextures();
  const m = program('gpu: lava', true);
  PROGRAM_GPU_STATS.lava++;
  const axes = own('uTcAxes', new THREE.Matrix3());
  const scale = own('uNoiseScale', 1);
  const flow = own('uFlow', new THREE.Vector3());
  const flowTime = own('uFlowTime', 0);
  const tc = varying(axes.mul(positionWorld).mul(scale).sub(flow.mul(flowTime)), 'vNoiseTc');
  const noise = ownTexture('tNoise', fb.volume, true);
  const ramp = ownTexture('tRamp', fb.white);
  const crustTex = ownTexture('tMix', fb.crust);
  // The define WebGL keys the crust by (`USE_MIX`), read off the drawn material: three's key does not see a define.
  const crustOn = uniform(0).onObjectUpdate((f: Any) => (f.material?.defines?.USE_MIX !== undefined ? 1 : 0));
  const texels = own('uNoiseTexels', 1);
  const colorScale = own('uColorScale', 1);
  const colorBias = own('uColorBias', 0);
  const factor = own('uTextureFactor', 1);
  const indexMean = own('uIndexMean', 0.5);
  const glowMean = own('uGlowMean', 0);
  const intensity = own('uIntensity', 1);
  const glowK = own('uGlow', 0);
  const glowFrom = own('uGlowFrom', 0);
  const glowTo = own('uGlowTo', 1);
  const w = fwidth(tc).mul(texels);
  const farOf = smoothstep(k.farFrom, k.farTo, max(w.x, max(w.y, w.z)));
  const index0 = noise.sample(tc).r.mul(colorScale).add(colorBias);
  const indexOf = mix(index0, indexMean, farOf);
  // Every sample and the derivative taken at the top of the fragment, as WebGL takes them, before the crust's branch (a
  // `select` is an `if`: read first inside it, the crust and the ramp were sampled where the quad parts along every edge of
  // the crust, at mips nobody chose).
  const far = property('float', 'gLavaFar');
  const index = property('float', 'gLavaIndex');
  const lava = property('vec4', 'gLavaRamp');
  const crust = property('vec3', 'gLavaCrust');
  const first = [
    [far, farOf],
    [index, indexOf],
    [lava, ramp.sample(vec2(clamp(indexOf, 0, 1), k.rampV))],
    [crust, crustTex.sample(tc.xz.add(indexOf.mul(k.crustShift))).rgb],
  ] as const;
  const crusted = select(index.lessThan(k.crustHalf), mix(crust, lava.rgb, clamp(index, 0, 1).mul(k.crustSpan)), lava.rgb);
  const rgb0 = select(crustOn.greaterThan(0.5), crusted, lava.rgb);
  const glow = mix(smoothstep(glowFrom, glowTo, lava.a.mul(factor)), glowMean, far);
  finish(m, vec4(rgb0.mul(intensity.mul(float(k.glowBase).add(glowK.mul(glow)))), 1), null, first);
  return m as NodeMaterial;
}

// ---------------------------------------------------------------- 4. the marks

/**
 * The marks (`marks.ts`'s `VERT` and `FRAG`): each quad's kind, birth, life and glow off its attributes; the saber's stroke
 * drawn as it always was, everything else one cell of the hand-drawn sheet coloured by its kind; the canvas's own value,
 * carried back through the tone curve.
 */
export function marksNode(): NodeMaterial {
  const k = PROGRAM_NUMBERS.marks;
  const fb = fallbackTextures();
  const m = program('gpu: marks', false);
  PROGRAM_GPU_STATS.marks++;
  const vUv = varying(uv(), 'vMarkUv');
  const vBorn = varying(attribute('aBorn', 'float'), 'vMarkBorn');
  const vKind = varying(attribute('aKind', 'float'), 'vMarkKind');
  const vLife = varying(attribute('aLife', 'float'), 'vMarkLife');
  const vGlow = varying(attribute('aGlow', 'float'), 'vMarkGlow');
  const time = own('uTime', 0);
  const sheet = ownTexture('uSheet', fb.white);
  const fadeAt = own('uFade', 0.8);
  const cells = own('uCells', 1);
  const edge = own('uEdge', 0.8);
  const scarWeight = own('uScarWeight', 1);
  const printWeight = own('uPrintWeight', 1);
  const coolAlpha = own('uCoolAlpha', 1);
  const scarChar = own('uScarChar', new THREE.Vector3());
  const scarHot = own('uScarHot', new THREE.Vector3());
  const lightningChar = own('uLightningChar', new THREE.Vector3());
  const lightningHot = own('uLightningHot', new THREE.Vector3());
  const printChar = own('uPrintChar', new THREE.Vector3());
  const rimHot = own('uRimHot', new THREE.Vector3());
  const age = time.sub(vBorn);
  const fade = float(1).sub(smoothstep(vLife.mul(fadeAt), vLife, age));
  const glow = select(vGlow.greaterThan(0), float(1).sub(smoothstep(0, vGlow, age)), float(0));
  // The saber's stroke.
  const x = abs(vUv.x.mul(2).sub(1));
  const across = float(1).sub(smoothstep(k.saberSoft, 1, x));
  const sHot = mix(v3(k.saberHotEdge), v3(k.saberHotMiddle), float(1).sub(smoothstep(0, k.saberHotReach, x)));
  const sCol = mix(v3(k.saberChar), sHot, glow);
  const sAlpha = across.mul(fade).mul(mix(k.saberCool, 1, glow));
  // A cell of the sheet, sampled for every quad (outside any branch, which WGSL asks of a sample).
  const cell = vKind.sub(1);
  const at = vec2(cell.add(clamp(vUv.x, k.cellInset, k.cellOutset)).div(cells), clamp(vUv.y, k.cellInset, k.cellOutset));
  const d = vUv.mul(2).sub(1);
  const shape = sheet.sample(at).a.mul(float(1).sub(smoothstep(edge, 1, length(d))));
  const scar = vKind.lessThan(k.scarBelow);
  const print = vKind.lessThan(k.printBelow);
  const lightning = vKind.greaterThan(k.lightningAbove);
  const ch = select(scar, select(lightning, lightningChar, scarChar), select(print, printChar, vec3(0)));
  const hot = select(scar, select(lightning, lightningHot, scarHot), select(print, printChar, rimHot));
  const weight = select(scar, scarWeight, select(print, printWeight, float(1)));
  const cCol = mix(ch, hot, glow);
  const cAlpha = shape.mul(fade).mul(weight).mul(mix(coolAlpha, 1, glow));
  const saber = vKind.lessThan(k.saberKind);
  const col = select(saber, sCol, cCol);
  const alpha = select(saber, sAlpha, cAlpha);
  // WebGL writes the canvas's own value (no chunk): written as it is under the inline output (swgRawOut), carried back only into three's frame-buffer target.
  m.swgRawOut = true;
  finish(m, asShownFB(vec4(col, alpha)), vBorn.lessThan(k.unborn).or(age.lessThan(0)).or(age.greaterThan(vLife)).or(alpha.lessThanEqual(0)));
  return m as NodeMaterial;
}

// ---------------------------------------------------------------- 5. the lightsaber blades

/**
 * A blade's ribbon (`saberBlade.ts`'s `RIBBON_VERT` and `RIBBON_FRAG`): across the ribbon the light falls off from the
 * middle (none at all where the soft edge is at the rim: a smear), along it the base and the tip are capped, the alpha
 * folded into the colour for the additive blend; the canvas's own value, carried back through the tone curve.
 */
export function bladeNode(): NodeMaterial {
  const k = PROGRAM_NUMBERS.blade;
  const m = program('gpu: lightsaber blade', false);
  PROGRAM_GPU_STATS.blades++;
  const vUv = varying(uv(), 'vBladeUv');
  const vFade = varying(attribute('aFade', 'float'), 'vBladeFade');
  const colour = own('uColor', new THREE.Color());
  const bright = own('uBright', 1);
  const soft = own('uSoft', 0);
  const x = abs(vUv.x.mul(2).sub(1));
  const across0 = select(soft.greaterThanEqual(1), float(1), float(1).sub(smoothstep(soft, 1, x)));
  const across = across0.mul(across0);
  const along = smoothstep(k.tipFrom, k.tipIn, vUv.y).mul(float(1).sub(smoothstep(k.endFrom, k.endTo, vUv.y)));
  // WebGL writes the canvas's own value (no chunk): written as it is under the inline output (swgRawOut), carried back only into three's frame-buffer target.
  m.swgRawOut = true;
  finish(m, asShownFB(vec4(colour.mul(across.mul(along).mul(vFade).mul(bright)), 1)), null);
  return m as NodeMaterial;
}

// ---------------------------------------------------------------- 6. the client's particles and the hyperspace tunnel

/**
 * A particle batch (`particles.ts`'s `VERT` and `FRAG`): the picture times the quad's colour, the fog worked out per vertex
 * from the batch's own density dimming glows and veiling smoke, the near-clear dropped. `weather` is the weather's own
 * variant (`weather.ts`'s `WEATHER_PARTICLE_SHADER`, its only user): below its column's top in the roof map, or inside the
 * ship being flown, dropped first.
 */
export function particlesNode(weather: boolean): NodeMaterial {
  const k = PROGRAM_NUMBERS.particles;
  const fb = fallbackTextures();
  const m = program(weather ? 'gpu: weather particles' : 'gpu: particles', false);
  if (weather) PROGRAM_GPU_STATS.weatherParticles++;
  else PROGRAM_GPU_STATS.particles++;
  const density = own('uFogDensity', 0);
  const fogColour = own('uFogColor', new THREE.Color());
  const additive = own('uAdditive', 0);
  const map = ownTexture('map', fb.white);
  const vUv = varying(uv(), 'vParticleUv');
  const vColour = varying(attribute('aColor', 'vec4'), 'vParticleColor');
  const d = length(modelViewMatrix.mul(vec4(positionLocal, 1)).xyz);
  const vFog = varying(float(1).sub(exp(density.mul(density).negate().mul(d).mul(d))), 'vParticleFog');
  const vWorld = weather ? varying(positionWorld, 'vWeatherPos') : null;
  const roofMap = weather ? ownTexture('uRoofMap', fb.float) : null;
  const roofGrid = weather ? own('uRoofGrid', new THREE.Vector4()) : null;
  const killSlack = weather ? own('uKillSlack', 0) : null;
  const hullOn = weather ? own('uHullOn', 0) : null;
  const hullToLocal = weather ? own('uHullToLocal', new THREE.Matrix4()) : null;
  const hullMin = weather ? own('uHullMin', new THREE.Vector3()) : null;
  const hullMax = weather ? own('uHullMax', new THREE.Vector3()) : null;
  const t = map.sample(vUv);
  const c = t.mul(vColour);
  const rgb = mix(mix(c.rgb, fogColour, vFog), c.rgb.mul(float(1).sub(vFog)), additive);
  let gone = c.a.lessThanEqual(k.cut);
  if (weather) {
    // Below its column's top: the nearest cell, as RoofGrid.topAt; a cell off the grid is never a roof.
    const g = floor(vWorld.xz.sub(roofGrid.xy).div(roofGrid.z));
    const inside = g.x.greaterThanEqual(0).and(g.y.greaterThanEqual(0)).and(g.x.lessThan(roofGrid.w)).and(g.y.lessThan(roofGrid.w));
    const cellAt = ivec2(clamp(g, vec2(0), max(roofGrid.ww.sub(1), vec2(0))));
    const top = roofMap.load(cellAt).r;
    const under = inside.and(vWorld.y.lessThan(top.sub(killSlack)));
    const h = hullToLocal.mul(vec4(vWorld, 1)).xyz;
    const inHull = hullOn.greaterThan(0.5).and(h.x.greaterThan(hullMin.x)).and(h.y.greaterThan(hullMin.y)).and(h.z.greaterThan(hullMin.z)).and(h.x.lessThan(hullMax.x)).and(h.y.lessThan(hullMax.y)).and(h.z.lessThan(hullMax.z));
    gone = gone.or(under).or(inHull);
  }
  finish(m, vec4(rgb, c.a), gone);
  return m as NodeMaterial;
}

/** The tunnel's hash (`hash12`), on any vec2 node. */
function hash12(p: Any): Any {
  const h = PROGRAM_NUMBERS.tunnel.hash;
  const p3 = fract(vec3(p.x, p.y, p.x).mul(h[0]));
  const q = p3.add(dot(p3, p3.yzx.add(h[1])));
  return fract(q.x.add(q.y).mul(q.z));
}

/**
 * The hyperspace tunnel (`hyperspaceTunnel.ts`'s `VERTEX` and `FRAGMENT`): three layers of streaks round the axis, faded to
 * their mean where a cell is under a pixel, the part not yet formed (or already gone) cut with a ragged edge and a glowing
 * rim, the bands winding down the funnel and the white the tunnel runs toward. Tone-mapped after.
 */
export function tunnelNode(): NodeMaterial {
  const k = PROGRAM_NUMBERS.tunnel;
  const m = program('gpu: hyperspace tunnel', false);
  PROGRAM_GPU_STATS.tunnel++;
  const vP = varying(positionLocal, 'vTunnelP');
  const time = own('uTime', 0);
  const cover = own('uCover', 0);
  const opening = own('uOpening', 0);
  const spin = own('uSpin', 0);
  const speed = own('uSpeed', 1);
  const glowK = own('uGlow', 1);
  const streaks = (turn: Any, z: Any, cols: number, rows: number, seed: number, rate: Any, wa: Any, wz: Any): Any => {
    const u = turn.mul(cols);
    const vv = z.mul(rows).add(time.mul(rate));
    const cell = vec2(mod(floor(u), cols), floor(vv));
    const r = hash12(cell.add(seed));
    const on = step(k.streakOn, r);
    const wu = wa.mul(cols);
    const wv = wz.mul(rows);
    const width = wu.add(k.lineWidth);
    const line = float(1).sub(smoothstep(0, width, abs(fract(u).sub(0.5)))).mul(float(k.lineWidth).div(width));
    const fv = fract(vv);
    const tail = smoothstep(0, k.tailIn, fv).mul(float(1).sub(smoothstep(k.tailFrom, 1, fv)));
    const sharp = clamp(float(1).sub(max(wu, wv).mul(k.sharpGain)), 0, 1);
    return mix(float(k.mean[0]).mul(k.mean[1]).mul(k.mean[2]), on.mul(line).mul(tail).mul(r.add(k.headBase)), sharp);
  };
  const radial = length(vP.xy);
  const turn = select(radial.greaterThan(k.radialFloor), atan(vP.y, vP.x).mul(k.turn).add(0.5), float(0));
  const z = vP.z;
  const wa = length(fwidth(vP.xy)).div(max(radial, k.footFloor)).mul(k.turn);
  const wz = fwidth(z);
  const rag = hash12(vec2(floor(turn.mul(k.ragCells)), k.ragSeed)).mul(k.ragDepth);
  const keep = select(opening.greaterThan(0.5), mix(-k.cutReach, k.cutReach, cover).sub(z.add(rag)), z.sub(rag).sub(mix(k.cutReach, -k.cutReach, cover)));
  const rim = float(1).sub(smoothstep(0, k.rimWidth, keep));
  const a = fract(turn.add(time.mul(spin)).add(z.mul(k.twist)));
  const [l0, l1, l2] = k.layers;
  const s = streaks(fract(a.add(l0.shift)), z, l0.cols, l0.rows, l0.seed, speed.mul(l0.speed), wa, wz)
    .mul(l0.gain)
    .add(streaks(fract(a.add(l1.shift)), z, l1.cols, l1.rows, l1.seed, speed.mul(l1.speed), wa, wz).mul(l1.gain))
    .add(streaks(fract(a.add(l2.shift)), z, l2.cols, l2.rows, l2.seed, speed.mul(l2.speed), wa, wz).mul(l2.gain));
  const ahead = smoothstep(k.aheadFrom, k.aheadTo, z);
  const band = float(0.5).add(sin(a.mul(k.bandTurns).add(z.mul(k.bandAlong)).sub(time.mul(k.bandRate))).mul(0.5));
  let col = mix(v3(k.deep), v3(k.near), ahead);
  col = col.add(v3(k.band).mul(band).mul(ahead));
  col = col.add(v3(k.streak).mul(s).mul(k.streakGain).mul(glowK));
  col = col.add(v3(k.core).mul(smoothstep(k.coreFrom, 1, z)).mul(k.coreGain).mul(glowK));
  col = col.add(v3(k.rim).mul(rim).mul(k.rimGain).mul(glowK));
  finish(m, vec4(col, 1), keep.lessThan(0));
  return m as NodeMaterial;
}

/** Which of these the WebGPU side draws, by what was taken in at load (`localStorage['swg.gpu.<part>'] = '0'` leaves one out). */
export function programsReport(): Record<string, unknown> {
  return {
    lava: LOOKS_AT_LOAD.lava ? "the client's lava, a node graph reading each lava material's own uniforms (gpuPrograms.ts)" : "step 3's stand-in: the ramp's middle colour (localStorage['swg.gpu.lava'] = '0')",
    marks: LOOKS_AT_LOAD.marks ? 'the blaster, saber and footprint marks, one graph for both sheets (gpuPrograms.ts)' : "not drawn (localStorage['swg.gpu.marks'] = '0')",
    blades: LOOKS_AT_LOAD.blades ? "every blade's ribbons, one graph for all of them (gpuPrograms.ts)" : "not drawn (localStorage['swg.gpu.blades'] = '0')",
    particles: LOOKS_AT_LOAD.particles ? "the client's particles (every batch, the ribbons and flip-books and solid quads in them) and the weather's variant, one graph a kind (gpuPrograms.ts)" : "not drawn (localStorage['swg.gpu.particles'] = '0')",
    tunnel: LOOKS_AT_LOAD.tunnel ? 'the hyperspace tunnel (gpuPrograms.ts)' : "not drawn (localStorage['swg.gpu.tunnel'] = '0')",
    graphsBuilt: { ...PROGRAM_GPU_STATS },
    by: 'each uniform read at every draw off the drawn material, so one graph serves a kind and a batch or a blade made in play builds nothing',
  };
}
