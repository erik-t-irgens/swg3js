// "Draw as the game does" with the game's own air (the GPU port's pass 2, wave 4; the brief's item 3): the space body
// viewer's stage and place views drawn through the game's light, in place of the old viewer's `gamelook.js`, which drew a
// world's colour ramp and a copy of the game's last steps as they stood before pass 2. Here everything that makes the sky
// is the game's own code, run on the viewer's renderer:
//
//   - **the record and the fit**: the world's air (`AirRun`, `src/sky/air/airRun.ts`), its rows fitted from its converted
//     sky.json by the game's own fit worker, the mix's rows blended into the game's twin each frame; and (wave 5) the air
//     the game reads from the file Save to game writes (`applyFileAir`), so a look's air moves the viewer's ground sky as it
//     moves the game's at its next loading screen;
//   - **the tables**: the game's four (`makeAirTables`), drawn for the viewer's camera every frame;
//   - **the sky**: the game's dome (`airSkyMaterial`: the sky view toward each direction and the star's discs through the
//     air, at the game's disc dials, `DISC_TUNE`'s brightness in stops and size), on the place view's own sphere;
//   - **the day**: the game's `DayCycle` on SWG's path at the hour (the sun, the moon), the game's twin's lighting; and
//     (wave 5) a world whose star system the file applies follows it as the game does (`SkyMotion`, `src/sky/system/`):
//     the sun, the second sun, the night body, eclipses and the night light where the game puts them, at the day's count;
//   - **the night** (wave 5): the game's own night sky (`src/sky/night/`: its stars at their physical light, the Milky Way
//     baked for the world's system, the towns' glow), shown only below the level light the game hides it above;
//   - **the haze on solids** (wave 5): the stage's ground, a level ground at the eye's height round as the world is, lit by
//     the twin's own ground light and hazed at its own distance by the haze volume and the sky view as the game's haze pass
//     hazes every solid pixel (`airHaze.ts`' `airTerms`);
//   - **the eye**: a match's measured exposure handed over as JSON from the game (`__debug.sky({ match })`'s `json`); else
//     (pass 2, wave 6, maker K) the game's own adapting eye, as the game's Eye adaptation row draws it on: the game's eye pass
//     (`GpuEyePass`) measures the chain's buffer on the card and eases toward its answer at the game's pace, taken at once when
//     the world or the hour jumps as a loading screen takes it, and the output reads the eye's buffer; where the eye's
//     computes have not landed (or `eyeAdapts` is off), the game's "follow the sun" answer (`eyeFrameRun` over the twin's level
//     light, the row off, the merged eye's curve with the night's `low` and `share`). The viewer's scene is not stored
//     pre-exposed (its `pre` stands at 1, so the eye measures it straight);
//   - **the chain** (wave 5: the sky and light fix round's, in the game's order on WebGPU under our sky): the scene stored
//     into the chain's buffer through the sanitize (values not numbers zeroed, the brightest held to its 8192), the owner's
//     demo's bloom (`GpuMixBloomPass`: no threshold, the Graphics page's 4% laid over the picture as `mix(picture, bloom,
//     strength)` before the eye), the eye's exposure, the grade (`gradeMath.ts`'s `deriveGrade` over the twin's lighting,
//     its pivot in the exposed light), three's ACES at the player's compensation, the sRGB curve and the output's dither.
//     Before this wave the viewer drew three's thresholded bloom at 0.35 times 3, which blew every bright thing white.
//     WebGPU draws no vignette; neither does this. Not drawn: the edge smoothing, the occlusion, the flare, the clouds.
//
// The haze on bodies seen from the ground is the bodies' own (`airProfile.js` and the day wash in `skywash.js`); in the
// game it is `skyBody.ts`'s. A world with no converted sky (an added zone, a world not converted) keeps the plain view.
import * as THREE from 'three';
import { MeshBasicNodeMaterial, RenderPipeline } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { AIR, HAZE_REACH_M } from '../air/airApi.ts';
import { HAZE_NUMBERS } from '../air/airHaze.ts';
import { F } from '../air/airParams.ts';
import { AirRun } from '../air/airRun.ts';
import { makeAirTables } from '../air/airTables.ts';
import { IN as TWIN_IN, lightTransmittance } from '../air/airTwin.ts';
import { airSkyMaterial } from '../air/airSky.ts';
import { DayCycle } from '../../world/daycycle.ts';
import { EYE_IN, EYE_OUT, eyeFrameRun } from '../exposure/eyeRun.ts';
import { eyeExposureNode, writeEyeCpu } from '../exposure/eyeBuffer.ts';
import { GpuEyePass, eyeReady } from '../exposure/eyeGpu.ts';
import { createGradeParams, createGradeSource, deriveGrade, lookFor, LUMA, GRADE_PIVOT, type GradeParams, type GradeSource } from '../../core/fx/gradeMath.ts';
import { sanitizeGraph, type ChainGraph } from '../../core/gpu/gpuChain.ts';
import { GpuMixBloomPass } from '../../core/gpu/gpuBloomMix.ts';
import { FX_CAMERA } from '../../core/fx/pass.ts';
import { FX_DEFAULTS } from '../../core/fxRegistry.ts';
import { ditheredOut } from '../night/dither.ts';
import { NightSky, NIGHT_IN } from '../night/nightGpu.ts';
import { nightPlaceOf } from '../night/nightPlace.ts';
import { SKY_MOTION, skyMotionFor, type SkyMotion, type SkyPlaceSource } from '../system/skyMotion.ts';
import { CLIENT_DAY_SECONDS } from '../system/places.js';
import { applyFileAir, type BodiesFile } from './bodiesFile.ts';
// (the sky round's fixer, the brief's H and I) the world's places as the game lays them, and its suns from the applied system
import { groundPlacesMix } from './groundPlaces.ts';
import { useSystemSuns } from '../system/systemSuns.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { cameraProjectionMatrix, clamp, dot, float, Fn, log2, max, min, mix, normalize, positionLocal, positionView, pow, renderOutput, select, smoothstep, texture, uniform, vec3, vec4 } = TSL as Any;

/**
 * The game's numbers the chain reads (the settings' defaults; `src/core/fxRegistry.ts`): the bloom's share under our sky on
 * WebGPU (the Graphics page's Bloom strength, `bloomMix`, 4% to start: the owner's demo's), the player's compensation (the
 * Exposure row, nought stops to start).
 */
export const GAME = {
  bloomMix: typeof FX_DEFAULTS.bloomMix === 'number' ? FX_DEFAULTS.bloomMix : 0.04,
  /** Today's dome's horizon-to-zenith blend, for the plain view's own sky while a world's air is not yet made. */
  skyZenithAt: 0.45,
  /** Where the eye stands without a match: metres over the datum (the game's camera on open ground). */
  heightM: 2,
};

/** The stage source: a space zone in plain light (the old viewer's, for the look preview). */
export function stageSource(out: GradeSource): GradeSource {
  out.key[0] = out.key[1] = out.key[2] = 0.8;
  out.fill[0] = out.fill[1] = out.fill[2] = 0.3;
  out.air[0] = out.air[1] = out.air[2] = 0.5;
  out.night = 0;
  out.space = true;
  return out;
}

/** The grade's light in orbit: the zone's own lights (sky.json's space block), as `sky.ts` reads them. */
const s2l = (b: number): number => {
  const c = b / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const l2 = (v: unknown, o: number[], d: number): void => {
  if (Array.isArray(v) && v.length >= 3) {
    o[0] = s2l(v[0] * 255);
    o[1] = s2l(v[1] * 255);
    o[2] = s2l(v[2] * 255);
  } else o[0] = o[1] = o[2] = d;
};
export function spaceSource(zoneSky: Any, out: GradeSource): GradeSource {
  const s = zoneSky?.space;
  l2(s?.lights?.[0]?.diffuse, out.key, 0.8);
  l2(s?.ambient, out.fill, 0.3);
  l2(s?.clear, out.air, 0.5);
  out.night = 0;
  out.space = true;
  return out;
}

/**
 * A frame handed over from the game (`__debug.sky({ match })` answers its `json`): the world, the hour, the camera's turn
 * and field of view, and the frame's air (the mix's rows and weights, the camera's height, the overcast) and eye (the
 * exposure the game's card measured, the player's compensation); since wave 5 also where the player stood (the towns' glow
 * reads it) and the day's unbroken count (an applied system's bodies stand where that count puts them).
 */
export interface GameMatch {
  name: string;
  planet: string;
  time: number;
  camera: { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number; fov: number };
  stand?: { x: number; y: number; z: number } | null;
  count?: number | null;
  air?: { rows: number[]; weights: number[]; heightM: number; overcast: number } | null;
  eye?: { exposure: number; renderer: number } | null;
}

/** Whether a value handed in is a match the viewer can hold (anything else is refused whole). */
export function isGameMatch(v: unknown): v is GameMatch {
  const m = v as Record<string, Any> | null;
  const fin = (x: unknown): boolean => typeof x === 'number' && Number.isFinite(x);
  return !!m && typeof m === 'object' && typeof m.planet === 'string' && /^[a-z0-9_]+$/.test(m.planet) && fin(m.time) && !!m.camera && ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw', 'fov'].every((k) => fin(m.camera[k]));
}

/** One world's air in the viewer: its run, its sky's rows, its clear row, its dome once the tables exist, and its motion. */
interface WorldAir {
  world: string;
  run: AirRun | null;
  blocks: Any[];
  clear: number;
  ready: boolean;
  failed: string;
  dome: THREE.Material | null;
  /** The converted sky (its places' sizes, for the motion) and its towns' centre. */
  data: SkyPlaceSource | null;
  centre: { x: number; z: number } | null;
  /** The applied system's motion as the game makes it from the file (null: SWG's sky), and the file's revision it was made at. */
  motion: SkyMotion | null;
  motionAt: number;
  /** The place view's reading of that motion (`skyView`), made with it. */
  view: SkyView | null;
  /** Settled once its converted sky is read, or found missing (`loaded`). */
  read: Promise<void>;
  readDone: () => void;
}

/**
 * The place view's reading of an applied system as the game moves it (`placeview.js`' `where` reads `model` and `out` as it
 * reads the viewer's own `system.js` state): every number from maker S's `SkyMotion` (its directions, lights, distances, and
 * the pair and eclipses as the game draws them), the model's lookups made once from its items. `out.day` is the game's day.
 */
export interface SkyView {
  v2: boolean;
  game: true;
  motion: SkyMotion;
  model: {
    version: 1 | 2;
    hidden: Set<string>;
    itemOf: Map<string, number>;
    itemDrawn: Uint8Array;
    itemStar: Uint8Array;
    itemSize: Float64Array;
    itemSpin: Float64Array;
    itemBright: Float64Array;
    items: { turns: number; colour: string | null; name: string }[];
  };
  out: { dir: Float64Array; light: Float64Array; dist: Float64Array; T: number; daylight: number; night: number; day: DayView };
}

/** The game's day as `places.js`' `dayAt` answers one (the place view's SWG rule and its world-sun light read it). */
export interface DayView {
  hours: number;
  time: number;
  ratio: number;
  isDay: boolean;
  normalized: number;
  light: { x: number; y: number; z: number };
  sun: { x: number; y: number; z: number };
  moon: { x: number; y: number; z: number };
  clientTime: number;
  slotAlpha: number;
}

export function skyViewOf(motion: SkyMotion, day: DayView): SkyView {
  const m = motion.m;
  const itemOf = new Map<string, number>();
  // The game's rule (`sky.ts`' `useMotion`): a place stands for the first item that names it.
  for (const it of motion.items) if (it.place && !itemOf.has(it.place)) itemOf.set(it.place, it.index);
  const f64 = (f: (j: number) => number): Float64Array => Float64Array.from({ length: m }, (_, j) => f(j));
  const u8 = (f: (j: number) => boolean): Uint8Array => Uint8Array.from({ length: m }, (_, j) => (f(j) ? 1 : 0));
  return {
    v2: motion.version === 2,
    game: true,
    motion,
    model: {
      version: motion.version,
      hidden: new Set(),
      itemOf,
      itemDrawn: u8((j) => motion.items[j].drawn),
      itemStar: u8((j) => motion.items[j].star),
      itemSize: f64((j) => motion.items[j].sizeDeg),
      itemSpin: f64((j) => motion.items[j].spinDeg),
      itemBright: f64((j) => (motion.items[j].star ? motion.items[j].brightness : 1)),
      items: motion.items.map((it) => ({ turns: it.spinDeg / 360, colour: it.colour, name: it.name })),
    },
    out: { dir: motion.dir, light: motion.light, dist: motion.dist, T: motion.T, daylight: motion.daylight, night: motion.night, day },
  };
}

/** The lighting record the run writes (`SwgSky.lighting`'s fields), kept. */
function makeLighting(): Any {
  return {
    main: new THREE.Color(1, 1, 1), mainScale: 1, ambient: new THREE.Color(0.3, 0.3, 0.3), ambientScale: 1,
    fill: new THREE.Color(0, 0, 0), fillScale: 1, bounce: new THREE.Color(0, 0, 0), bounceScale: 1,
    fog: new THREE.Color(0.5, 0.5, 0.5), fogDensity: 0.0001, clear: new THREE.Color(0.5, 0.5, 0.6),
  };
}

export class GameLook {
  readonly S: Any;
  on = false;
  pipeline: Any = null;
  /** The demo's bloom (the game's own pass, drawn by hand here: its levels down, back up, and mixed over the buffer). */
  bloomPass: GpuMixBloomPass | null = null;
  readonly params: GradeParams = createGradeParams();
  readonly source: GradeSource = createGradeSource();
  readonly U: Record<string, Any>;
  readonly report: Record<string, Any>;
  /** The worlds' airs asked for, by world. */
  private readonly airs = new Map<string, WorldAir>();
  private tables: Any = null;
  private readonly day = new DayCycle(0, 1);
  private readonly mix = { mixLength: 1, mixBlocks: [null, null, null, null] as Any[], mixWeights: new Float64Array(4), mixBlock(i: number): object | null { return this.mixBlocks[i]; } };
  private readonly L = makeLighting();
  /** The frame held from the game, or null. */
  match: GameMatch | null = null;
  /** The world whose air drew this frame, or '' (the plain view). */
  drawn = '';
  /** The scene's target (multisampled, as the stage drew before) and the chain's one buffer (half floats, no depth: the game's kind). */
  private sceneRT: THREE.RenderTarget | null = null;
  private buffer: THREE.RenderTarget | null = null;
  private readonly sceneIn = { value: null as THREE.Texture | null };
  private sanitize: ChainGraph | null = null;
  private readonly size = new THREE.Vector2();
  private readonly chainCtx = { renderer: null as Any };
  /** The exposure last written into the eye's buffer (the bloom's first level weighs by it, as the game's does). */
  private eyeWritten = -1;
  /**
   * Pass 2, wave 6 (maker K): the game's adapting eye with no match held (the game's Eye adaptation row's start, on); false for
   * the follow-the-sun answer, to compare. The eye's pass (made with the chain, on WebGPU's backend alone), when the last frame
   * was taken, and the world and hour it was taken at (a jump is taken at once, as a loading screen takes it).
   */
  eyeAdapts = true;
  private eyePass: GpuEyePass | null = null;
  private eyeAt = 0;
  private eyeWorld = '';
  private eyeHours = -100;
  /** The game's file as the game would read it from what Save to game writes now (`setFile`), and its revision. */
  private file: BodiesFile | null = null;
  private fileRev = 0;
  /** Each world's saved air as last laid (so a change of it makes that world's air again), and the whole file's air last laid. */
  private readonly airKeys = new Map<string, string>();
  private airLaid = 'null';
  /** The night sky of the world drawn (one at a time: its band is 8 MB), and the world it is for. */
  private night: NightSky | null = null;
  private nightWorld = '';
  private nightMaking = '';
  /** The ground's material drawn as the game does (made once the tables exist) and its numbers. */
  private groundMat: THREE.Material | null = null;
  readonly groundU: Record<string, Any>;
  /** The game's day this frame as the place view reads one, kept. */
  readonly dayView: DayView = { hours: 12, time: 0.5, ratio: 0.25, isDay: true, normalized: 0.25, light: { x: 0, y: 1, z: 0 }, sun: { x: 0, y: 1, z: 0 }, moon: { x: 0, y: -1, z: 0 }, clientTime: 0, slotAlpha: 1 };

  constructor(S: Any) {
    this.S = S;
    this.day.swg = true;
    this.day.held = true;
    this.U = {
      exposure: uniform(1), comp: uniform(1), amount: uniform(1), balance: uniform(new THREE.Vector3(1, 1, 1)), shadow: uniform(new THREE.Vector3(1, 1, 1)), high: uniform(new THREE.Vector3(1, 1, 1)),
      split: uniform(0), sat: uniform(1), contrast: uniform(1), pivot: uniform(GRADE_PIVOT),
      // (pass 2, wave 6) 1 while the card's eye adapts: the output reads the eye's buffer, as the game's does
      adapting: uniform(0),
    };
    this.groundU = { light: uniform(new THREE.Color(0.05, 0.045, 0.04)), eyeM: uniform(GAME.heightM), reachM: uniform(5000) };
    this.report = { path: 'off', planet: '', params: this.params, source: this.source, air: null, eye: null, motion: null, night: null, bloom: null };
  }

  build(): void {
    const { renderer } = this.S;
    const U = this.U;
    const rt = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
    rt.texture.name = "viewer: the game's scene";
    const buf = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, samples: 0 });
    buf.texture.name = "viewer: the game's chain buffer";
    buf.texture.minFilter = THREE.LinearFilter;
    buf.texture.magFilter = THREE.LinearFilter;
    buf.texture.generateMipmaps = false;
    this.sceneRT = rt;
    this.buffer = buf;
    this.sceneIn.value = rt.texture;
    // The game's sanitize under our sky (values not numbers zeroed, the stored picture held to 8192) and its bloom.
    this.sanitize = sanitizeGraph({ tScene: this.sceneIn }, true);
    this.bloomPass = new GpuMixBloomPass(1, 1, GAME.bloomMix);
    // (pass 2, wave 6, maker K) the game's eye pass: its quarter copy and its two computes, asked as the chain is made
    if (renderer.backend?.isWebGPUBackend === true) this.eyePass = new GpuEyePass(renderer);
    const L = vec3(LUMA[0], LUMA[1], LUMA[2]);
    // grade.ts's fragment, line for line (as gpuChain.ts's gradeGraph draws it on WebGPU), in the exposed light
    const grade = Fn(([inp]: Any[]) => {
      const c0 = vec3(inp).toVar();
      const c = vec3(c0).toVar();
      const a = clamp(U.amount, 0.0, 1.0);
      const l0 = dot(c0, L).toVar();
      c.mulAssign(mix(vec3(1.0), U.balance, a));
      const t = clamp(log2(l0.add(1e-5)).sub(log2(U.pivot)).add(2.0).div(4.0), 0.0, 1.0);
      const w = float(1).sub(t.mul(t).mul(float(3).sub(t.mul(2))));
      c.mulAssign(mix(vec3(1.0), mix(U.high, U.shadow, w), U.split.mul(a)));
      c.mulAssign(l0.div(max(dot(c, L), 1e-7)));
      const mx = max(c.r, max(c.g, c.b));
      const mn = min(c.r, min(c.g, c.b));
      const s0 = mix(float(1), U.sat, a);
      const s = select(s0.greaterThan(1.0), float(1).add(s0.sub(1).mul(float(1).sub(mx.sub(mn).div(max(mx, 1e-7))))), s0);
      c.assign(max(mix(vec3(l0), c, s), 0.0));
      c.mulAssign(l0.div(max(dot(c, L), 1e-7)));
      const lc = U.pivot.mul(pow(l0.div(U.pivot), mix(float(1), U.contrast, a)));
      const g = smoothstep(U.pivot.div(32.0), U.pivot.div(4.0), l0).mul(float(1).sub(smoothstep(U.pivot.mul(8.0), U.pivot.mul(32.0), l0)));
      c.mulAssign(mix(l0, lc, g).div(max(l0, 1e-12)));
      return select(a.lessThanEqual(0.0).or(l0.lessThanEqual(1e-7)), c0, c);
    });
    // The output (the game's `outputGraph` and its inline output): the buffer times the eye's exposure, graded, three's ACES
    // at the player's compensation, the sRGB curve, and the dither of wave 4b onto the canvas.
    const pic = texture(buf.texture);
    // (pass 2, wave 6, maker K) the card's own exposure while its eye adapts, the main thread's answer otherwise
    const exposed = vec3(pic.rgb).mul(select(U.adapting.greaterThan(0.5), eyeExposureNode(), U.exposure));
    const graded = grade(exposed);
    const shown = renderOutput(vec4(graded.mul(U.comp), 1.0), THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace);
    const out = ditheredOut(shown, float(1));
    const pipe = new RenderPipeline(renderer);
    pipe.outputColorTransform = false;
    pipe.outputNode = vec4(vec4(out).rgb, 1.0);
    this.pipeline = pipe;
  }

  setOn(on: boolean): void {
    this.on = !!on;
    if (this.on && !this.pipeline) this.build();
  }

  /** The grade for this frame from `source` (filled by the caller) and the planet's own look, in the exposed light. */
  setGrade(planet: string, path: string): void {
    const look = lookFor(planet);
    // The pivot in the exposed light: the player's compensation alone (`gradePivot` of the renderer's exposure), as the game's
    // grade stands in the light the eye has already exposed.
    deriveGrade(this.source, look, this.rendererExposure(), this.params);
    const P = this.params;
    const U = this.U;
    U.balance.value.set(P.balance[0], P.balance[1], P.balance[2]);
    U.shadow.value.set(P.shadowTint[0], P.shadowTint[1], P.shadowTint[2]);
    U.high.value.set(P.highlightTint[0], P.highlightTint[1], P.highlightTint[2]);
    U.split.value = P.split;
    U.sat.value = P.saturation;
    U.contrast.value = P.contrast;
    U.pivot.value = P.pivot;
    U.amount.value = Math.max(0, Math.min(1, look?.strength ?? 1));
    U.comp.value = this.rendererExposure();
    this.report.path = path;
    this.report.planet = planet;
  }

  /** The player's compensation: a match's own, else nought stops (three's exposure 1). */
  private rendererExposure(): number {
    return this.match?.eye?.renderer && this.match.eye.renderer > 0 ? this.match.eye.renderer : 1;
  }

  /** The stage's eye (a look close up, in plain light): an exposure of 1, as before. */
  stageEye(): void {
    this.U.adapting.value = 0;
    this.setExposure(1);
  }

  /** The eye's exposure into the output and into the eye's buffer the bloom's first level reads (written only when it moved). */
  private setExposure(e: number): void {
    this.U.exposure.value = e;
    if (e !== this.eyeWritten) {
      this.eyeWritten = e;
      EYE_OUT.exposure = e;
      EYE_OUT.glow = 1;
      EYE_OUT.stops = Math.log2(e > 0 ? e : 1);
      writeEyeCpu();
    }
  }

  render(): void {
    const r = this.S.renderer;
    if (!(this.on && this.pipeline && this.sceneRT && this.buffer && this.sanitize && this.bloomPass)) {
      r.render(this.S.scene, this.S.camera);
      return;
    }
    r.getDrawingBufferSize(this.size);
    const w = Math.max(1, this.size.x | 0);
    const h = Math.max(1, this.size.y | 0);
    if (this.sceneRT.width !== w || this.sceneRT.height !== h) {
      this.sceneRT.setSize(w, h);
      this.buffer.setSize(w, h);
    }
    const auto = r.autoClear;
    const prev = r.getRenderTarget();
    try {
      // The scene into its target (cleared), then the chain as the game draws it: the sanitize into the buffer, and the bloom's
      // levels down, back up and mixed over the buffer where it stands (nothing cleared under them: the game's chain runs with
      // three's clearing off, `portalRender.ts`).
      r.autoClear = true;
      r.setRenderTarget(this.sceneRT);
      r.render(this.S.scene, this.S.camera);
      r.autoClear = false;
      r.setRenderTarget(this.buffer);
      r.render(this.sanitize.mesh, FX_CAMERA);
      this.chainCtx.renderer = r;
      // (pass 2, wave 6, maker K) the eye measured and eased on the card over the buffer, before the bloom (the game's order)
      if (this.eyePass && this.U.adapting.value > 0.5) this.eyePass.render(this.chainCtx as Any, this.buffer as Any, null);
      this.bloomPass.render(this.chainCtx as Any, this.buffer as Any, null);
    } finally {
      r.autoClear = auto;
      r.setRenderTarget(prev);
    }
    r.toneMappingExposure = 1;
    this.pipeline.render();
    this.report.bloom = { strength: GAME.bloomMix, levels: (this.bloomPass.report() as Any).levels };
  }

  // ---------------------------------------------------------------- the file the game reads

  /**
   * The game's bodies file as the game would read it from what Save to game writes now (the page makes it with
   * `gameBodiesFile` and the game's own reader, `cleanBodiesFile`), or null: its air laid as the game lays it behind a loading
   * screen (`applyFileAir`; a world whose saved air moved has its air made again), and its applied systems followed (each
   * world's motion made again). Called when a ground sky is built drawn as the game does.
   */
  setFile(file: BodiesFile | null): Record<string, unknown> {
    this.file = file;
    this.fileRev++;
    // the air laid only when the file's air moved (a dial set again is a fit asked again); (skies of his own worlds) a world of
    // his takes its own saved air first and its lender's second, as the game's screen lays it (`applyFileAir`'s `lends`)
    const airKey = JSON.stringify(file?.air ?? null) + JSON.stringify([...this.lends]);
    const laid = airKey !== this.airLaid ? applyFileAir(file, this.lendsRecord()) : { unchanged: true };
    this.airLaid = airKey;
    for (const a of [...this.airs.values()]) {
      const key = JSON.stringify(this.savedAirOf(file, a.world));
      if (this.airKeys.has(a.world) && this.airKeys.get(a.world) !== key) {
        // its saved air moved: the world's air is made again (its rows fitted with the new dials and fields)
        this.airs.delete(a.world);
        if (this.nightWorld === a.world) this.nightWorld = '';
      }
      this.airKeys.set(a.world, key);
    }
    return laid;
  }

  /** The applied system's motion for a world as the game makes it (`World.followMotion`'s `skyMotionFor`), or null. */
  private motionOf(a: WorldAir): SkyMotion | null {
    if (!this.file || !a.data) return null;
    if (a.motionAt !== this.fileRev) {
      a.motionAt = this.fileRev;
      // (the sky round's fixer, I) made over the world's places as the game lays them (`World.loadSky`: his Place tab's sizes over
      // SWG's sky, and an extra place's), its suns the applied system's first (`sunsOf`), so its sizes and eclipses are the game's
      this.sunsOf(a);
      // (skies of his own worlds) a world of his under its own system over the sky it borrows, as the game's screen makes it
      a.motion = skyMotionFor(this.file.systems as Any, a.world, gamePlanetOf(a.world), this.laidData(a), this.lends.get(a.world) ?? null);
      a.view = a.motion ? skyViewOf(a.motion, this.dayView) : null;
    }
    return a.motion;
  }

  // ---------------------------------------------------------------- (skies of his own worlds) a world of his over a borrowed sky

  /** Each world of his "draw as the game does" draws over a sky it borrows, by its own id: the converted sky it borrows. */
  private readonly lends = new Map<string, string>();
  /**
   * A world of his (its own id, as the System tab stands it) drawn over the converted sky it borrows (`from`, a pack), as the
   * game draws it: the air's rows and pictures the lender's, its own air and its own system by its own id. Before `useWorld`.
   */
  lend(world: string, from: string | null): void {
    if (!/^[a-z0-9_]+$/.test(world)) return;
    if (from && /^[a-z0-9_]+$/.test(from) && from !== world) this.lends.set(world, from);
    else this.lends.delete(world);
  }
  /** The lends as `applyFileAir` takes them: each world of his against its lender's planet. */
  private lendsRecord(): Record<string, string> | null {
    if (!this.lends.size) return null;
    const out: Record<string, string> = {};
    for (const [w, from] of this.lends) out[gamePlanetOf(w)] = gamePlanetOf(from);
    return out;
  }
  /** A world's saved air as the game reads it: its own, else (a world of his) its lender's. */
  private savedAirOf(file: BodiesFile | null, world: string): unknown {
    const own = file?.air?.[gamePlanetOf(world)];
    if (own) return own;
    const from = this.lends.get(world);
    return (from ? file?.air?.[gamePlanetOf(from)] : null) ?? null;
  }

  /** (The sky round's fixer, I) a world's converted sky with the file's ground places laid over it, as the game's screen lays them. */
  private laidData(a: WorldAir): SkyPlaceSource | null {
    if (!a.data) return null;
    // (skies of his own worlds) a world of his: the places he edited of the sky it borrows, as the game's screen lays them
    const laid = groundPlacesMix(this.lends.get(a.world) ?? a.world, (this.file as Any)?.places ?? null);
    return laid ? (laid(a.data as Any) as unknown as SkyPlaceSource) : a.data;
  }

  /**
   * (The sky round's fixer, H and I) the applied system's suns for the world drawn (`stars.ts`' `SYSTEM_SUNS`, one world's at a
   * time, as the game's screen sets them before its air is fitted), set again when the world drawn or the file changes, and its
   * rows fitted again under them (the fit's answer lays the system's star on them, `airRun.ts`).
   */
  private sunsFor = '';
  private sunsOf(a: WorldAir): void {
    if (!this.file || !a.data) return;
    const key = `${a.world}@${this.fileRev}`;
    if (this.sunsFor === key) return;
    this.sunsFor = key;
    useSystemSuns(this.file.systems as Any, a.world, gamePlanetOf(a.world), this.laidData(a) as Any);
    if (a.run && a.ready) a.run.ask();
  }

  /** The place view's reading of the world's applied system as the game moves it (`SkyView`), or null: SWG's sky. */
  skyView(world: string): SkyView | null {
    const a = this.airs.get(world);
    if (!a || !a.ready) return null;
    this.motionOf(a);
    return a.view;
  }

  /** The motion of a world (for the page: its items, its day's length, `timeOfCount`), or null. */
  motionFor(world: string): SkyMotion | null {
    const a = this.airs.get(world);
    return a ? this.motionOf(a) : null;
  }

  // ---------------------------------------------------------------- the world's air

  /** The world's air, asked for once (its sky.json read from the converted packs, its rows fitted in the game's worker). */
  useWorld(world: string): WorldAir {
    let a = this.airs.get(world);
    if (a) return a;
    let done = (): void => {};
    const read = new Promise<void>((r) => (done = r));
    a = { world, run: null, blocks: [], clear: 0, ready: false, failed: '', dome: null, data: null, centre: null, motion: null, motionAt: -1, view: null, read, readDone: done };
    this.airs.set(world, a);
    if (!this.airKeys.has(world)) this.airKeys.set(world, JSON.stringify(this.savedAirOf(this.file, world)));
    void this.loadWorld(a);
    return a;
  }

  /** Whether a world's air is made and drawing. */
  ready(world: string): boolean {
    return !!this.airs.get(world)?.ready;
  }

  /** Settles once a world's converted sky is read or found missing (its motion can then be made), asking for its air if not yet. */
  loaded(world: string): Promise<void> {
    if (!/^[a-z0-9_]+$/.test(world) || world.startsWith('space_')) return Promise.resolve();
    return this.useWorld(world).read;
  }

  /** The game's file "draw as the game does" follows (`setFile`), for the page and the checks. */
  get fileNow(): BodiesFile | null {
    return this.file;
  }

  private async loadWorld(a: WorldAir): Promise<void> {
    const planet = gamePlanetOf(a.world);
    // (skies of his own worlds) a world of his reads the converted sky it borrows; every other world its own, as before
    const src = this.lends.get(a.world) ?? a.world;
    try {
      const r = await fetch(`/assets-private/${encodeURIComponent(src)}/sky.json`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`no converted sky for ${src} (${r.status})`);
      const data = await r.json();
      if (!Array.isArray(data?.blocks) || !data.blocks.length || data.space) throw new Error(`${a.world}'s sky has no ground rows`);
      a.blocks = data.blocks;
      a.data = data as SkyPlaceSource;
      a.readDone();
      const c = data.blocks.findIndex((b: Any) => b && b.weatherIndex === 0);
      a.clear = c >= 0 ? c : 0;
      // (the sky round's fixer, H) the applied system's suns before the air is made and fitted, as the game's screen sets them
      this.sunsOf(a);
      const run = new AirRun(planet, { sunElevationDegrees: +data.sunElevationDegrees || 0, blocks: data.blocks }, (file) => `/assets-private/${encodeURIComponent(src)}/${file}`);
      a.run = run;
      run.ask();
      await run.ready();
      // One set of tables for the session (the game's own: `makeAirTables` keeps it in `AIR.tables`), following this world's twin.
      const t = makeAirTables(this.S.renderer, run.twin.record) as Any;
      t.follow(run.twin.record);
      this.tables = t;
      this.frameAir(a, 12);
      await t.warm(this.S.camera);
      // The game's dome, built once the tables exist (the graph reads them), on the place view's sphere about the camera.
      const m = airSkyMaterial(planet, new THREE.Color(0.5, 0.55, 0.6), new THREE.Color(0.3, 0.45, 0.7)) as Any;
      m.side = THREE.BackSide;
      m.depthWrite = false;
      m.depthTest = false;
      a.dome = m;
      a.ready = true;
      console.log(`[viewer] the game's air for ${a.world} (${planet}): ${a.blocks.length} rows fitted, the clear row ${a.clear}`);
      // The towns' middle (the night's glow reads the camera against it where no match says where the player stood).
      try {
        const p = await fetch(`/assets-private/${encodeURIComponent(src)}/pois.json`, { cache: 'no-store' });
        if (p.ok) {
          const pj = await p.json();
          a.centre = pj?.center && Number.isFinite(pj.center.x) && Number.isFinite(pj.center.z) ? { x: pj.center.x, z: pj.center.z } : null;
          (a as Any).pois = Array.isArray(pj?.pois) ? pj.pois : null;
        }
      } catch {
        /* no towns: no glow */
      }
    } catch (e) {
      a.failed = (e as Error).message;
      console.warn(`[viewer] the game's air for ${a.world}: ${a.failed} (the plain view stands)`);
    } finally {
      a.readDone();
    }
  }

  /** The world's night sky made (the game's `World.loadNight`: its system's stars and band, baked once), the last one let go. */
  private async makeNight(a: WorldAir): Promise<void> {
    if (!AIR.tables || this.nightMaking === a.world) return;
    this.nightMaking = a.world;
    const planet = gamePlanetOf(a.world);
    try {
      if (this.night) {
        this.night.dispose();
        this.night = null;
        this.nightWorld = '';
      }
      const at = nightPlaceOf(planet);
      // (the sky round's maker P, J) the night is made under the world's own applied system, as the game's screen makes it, so
      // its drawn belts are hung with it (`beltBand.ts`)
      SKY_MOTION.now = this.motionOf(a);
      const night = new NightSky(this.S.renderer, { planet, key: at.key, placeOf: at.placeOf });
      night.setCities(((a as Any).pois ?? null) as Any, a.centre);
      await night.warm();
      night.drawBake();
      if (this.nightMaking !== a.world) {
        night.dispose();
        return;
      }
      this.night = night;
      this.nightWorld = a.world;
    } catch (e) {
      console.warn(`[viewer] the game's night for ${a.world}: ${(e as Error).message}`);
    } finally {
      if (this.nightMaking === a.world) this.nightMaking = '';
    }
  }

  /** The night's group for the world drawn (the place view hangs it in its own group), or null while it is not made. */
  nightFor(world: string): THREE.Group | null {
    return this.night && this.nightWorld === world ? this.night.group : null;
  }

  /**
   * The ground drawn as the game does (once the tables exist): a level ground at the eye's height (the cap is centred on the
   * camera, so each pixel's direction is its place), its distance along the view to the world's horizon at that height at
   * most, its light the twin's own ground (Lambert's, `groundDown` over pi) and the air between: what gets through and what the
   * air adds, from the haze volume to the reach and the sky view past it, by the haze pass's own rule (`airHaze.ts`' `airTerms`).
   */
  groundMaterial(): THREE.Material | null {
    if (this.groundMat) return this.groundMat;
    const tables = AIR.tables as Any;
    if (!tables) return null;
    const G = this.groundU;
    const m = new MeshBasicNodeMaterial({ side: THREE.BackSide });
    m.name = "viewer: the ground as the game hazes it";
    m.fog = false;
    m.colorNode = Fn(() => {
      const d = normalize(positionLocal).toVar('vgDir');
      const down = max(d.y.negate(), float(1e-5));
      const dist = min(G.eyeM.div(down), G.reachM).toVar('vgDist');
      const clip = cameraProjectionMatrix.mul(vec4(positionView, 1.0)).toVar('vgClip');
      const ndc = clip.xy.div(clip.w).toVar('vgNdc');
      // `airTerms`, read at the top before anything branches (three writes a `select` out as an `if`)
      const hz = vec4(tables.hazeAt(ndc, min(dist, HAZE_REACH_M))).toVar('vgHaze');
      const skyL = vec3(tables.skyRadiance(d)).toVar('vgSky');
      const t0 = max(hz.a, HAZE_NUMBERS.tFloor);
      const far = dist.greaterThan(HAZE_REACH_M);
      const t = select(far, pow(t0, dist.div(HAZE_REACH_M)), hz.a).toVar('vgT');
      const l = select(far, hz.rgb.add(skyL.sub(hz.rgb).mul(float(1).sub(t.div(t0)))), hz.rgb).toVar('vgL');
      return vec4(vec3(G.light).mul(t).add(l), 1.0);
    })();
    this.groundMat = m;
    return m;
  }

  /**
   * One frame of a world's air at an hour (0 to 24): the game's day at that time on SWG's path (or, under the system the file
   * applies to the world, at the day's unbroken count `count`, a match's own winning: its bodies where the game puts them at
   * that count), the mix (the match's rows and weights, else the clear row), the twin's sums and lighting, the tables for the
   * camera, the night, the ground's light, and the eye's answer. Answers whether the air drew.
   */
  frameAir(a: WorldAir, hours: number, count = Number.NaN): boolean {
    if (!a.run) return false;
    const m = this.match && this.match.planet === gamePlanetOf(a.world) ? this.match : null;
    const day = this.day;
    // (wave 5) the applied system the game follows here, as its world sets it behind the screen (`SKY_MOTION.now`, the day's own)
    // (the sky round's fixer, H) and its suns, the world drawn's (a page's call, set again only when the world or the file moves)
    this.sunsOf(a);
    const motion = this.motionOf(a);
    SKY_MOTION.now = motion;
    if (day.motion !== motion) day.follow(motion);
    const mc = m && typeof m.count === 'number' && Number.isFinite(m.count) ? m.count : Number.NaN;
    const c = motion ? (Number.isFinite(mc) ? mc : count) : Number.NaN;
    day.time = Number.isFinite(c) ? c - Math.floor(c) : m ? ((m.time % 1) + 1) % 1 : ((((hours / 24) % 1) + 1) % 1);
    day.held = true;
    day.update(0, false);
    if (Number.isFinite(c)) {
      // the count itself (its whole days the system's): taken at a second update, the time standing, so the motion moves to it
      day.count = c;
      day.update(0, false);
    }
    this.fillDay();
    const mix = this.mix;
    const rows = m?.air?.rows;
    if (rows && rows.length) {
      const n = Math.min(4, rows.length);
      mix.mixLength = n;
      for (let i = 0; i < n; i++) {
        mix.mixBlocks[i] = a.blocks[rows[i]] ?? null;
        mix.mixWeights[i] = m!.air!.weights[i] ?? 0;
      }
    } else {
      mix.mixLength = 1;
      mix.mixBlocks[0] = a.blocks[a.clear] ?? null;
      mix.mixWeights[0] = 1;
    }
    const run = a.run;
    run.heightM = m?.air ? m.air.heightM : GAME.heightM;
    run.overcast = m?.air ? m.air.overcast : 0;
    run.frame(day, mix, this.L);
    // The session's one set of tables follows the world drawn now, not the last one loaded (a Tatooine match after a Rori
    // one drew through Rori's numbers: the fixer of pass 2, wave 4a). The tables compare the record each frame, so a change
    // of world rebuilds their transmittance and multiple scattering once.
    if (this.tables && a.ready) {
      this.tables.follow(run.twin.record);
      this.tables.frame(this.S.camera);
    }
    // (wave 5) the night (the game's `nightFrame`: the camera's place for the towns' glow, then the night's own frame), made once
    // a world's tables exist; and the ground's light and reach for its haze
    if (a.ready && this.nightWorld !== a.world && this.nightMaking !== a.world) void this.makeNight(a);
    if (this.night && this.nightWorld === a.world) {
      NIGHT_IN.camX = m?.stand ? m.stand.x : a.centre ? a.centre.x : 0;
      NIGHT_IN.camZ = m?.stand ? m.stand.z : a.centre ? a.centre.z : 0;
      this.night.frame();
    }
    const gd = run.twin.out.groundDown;
    (this.groundU.light.value as THREE.Color).setRGB(gd[0] / Math.PI, gd[1] / Math.PI, gd[2] / Math.PI);
    const hM = run.heightM > 0.1 ? run.heightM : 0.1;
    const rM = run.twin.record[F.bottom] * 1000;
    this.groundU.eyeM.value = hM;
    this.groundU.reachM.value = Math.sqrt(2 * rM * hM + hM * hM);
    // The eye: the match's measured exposure; else (pass 2, wave 6, maker K) the game's adapting eye on the card, as the game's
    // Eye adaptation row draws it on (its pass measures the chain's buffer in `render`), eased at the game's pace over the frame's
    // own seconds and taken at once when the world changes or the hour jumps over an hour (as a loading screen takes it); else,
    // its computes not landed or `eyeAdapts` off, the game's "follow the sun" answer over the twin's level light.
    const held = !!(m?.eye && m.eye.exposure > 0);
    const adapt = !held && this.eyeAdapts && this.eyePass !== null && eyeReady();
    const now = performance.now();
    EYE_IN.dt = this.eyeAt > 0 ? (now - this.eyeAt) / 1000 : 0.016;
    this.eyeAt = now;
    let dh = hours - this.eyeHours;
    dh = dh - 24 * Math.round(dh / 24);
    const jump = a.world !== this.eyeWorld || dh > 1 || dh < -1;
    this.eyeWorld = a.world;
    this.eyeHours = hours;
    EYE_IN.air = true;
    EYE_IN.chain = true;
    EYE_IN.eye = adapt;
    EYE_IN.adapt = adapt ? 1 : 0;
    EYE_IN.stops = 0;
    EYE_IN.loading = adapt && jump;
    EYE_IN.level = AIR.frame.level;
    eyeFrameRun();
    if (adapt) {
      this.U.adapting.value = 1;
      // the card writes the buffer now; a later answer of the main thread's is written afresh
      this.eyeWritten = -1;
      this.report.eye = { exposure: 'on the card (`__debug` reads it back: readEyeBuffer)', from: `the game's adapting eye${jump ? ', taken at once (a jump)' : ''}` };
    } else {
      this.U.adapting.value = 0;
      const exposure = held ? m!.eye!.exposure : EYE_OUT.exposure;
      this.setExposure(exposure);
      this.report.eye = { exposure: Number(exposure.toPrecision(5)), stops: Number(Math.log2(exposure).toFixed(3)), from: held ? `the match '${m!.name}'` : `the game's follow-the-sun answer (${this.eyeAdapts ? "the eye's computes not landed" : 'adapting off'})` };
    }
    this.report.air = { world: a.world, time: Number(day.time.toFixed(4)), count: Number(day.count.toFixed(6)), sunDir: day.sunDir.toArray().map((v) => Number(v.toFixed(4))), level: Number(AIR.frame.level.toPrecision(4)), visibilityKm: Number(AIR.frame.visibilityKm.toFixed(2)), rows: mix.mixLength };
    this.report.motion = motion ? { system: motion.id, version: motion.version, T: Number(motion.T.toFixed(6)), daylight: Number(motion.daylight.toFixed(4)), sunShare: Number(motion.sunShare.toFixed(4)), moonShare: Number(motion.moonShare.toPrecision(4)) } : null;
    this.report.night = this.night && this.nightWorld === a.world ? { drawn: this.night.group.visible, world: a.world } : null;
    if (motion && a.view) {
      const o = a.view.out;
      o.T = motion.T;
      o.daylight = motion.daylight;
      o.night = motion.night;
    }
    this.framed = a.ready ? a : null;
    return a.ready;
  }

  /** The world whose air drew the last frame (`frameAir`), for the bodies seen through it (`bodySeen`), or null. */
  private framed: WorldAir | null = null;
  private readonly seenT = new Float64Array(3);
  private readonly seenL = new Float64Array(3);

  /**
   * (The fixer of pass 2, wave 5) What the game's card makes of a body seen from the ground toward (dx, dy, dz) through the air
   * that drew the last frame, on the twin's own numbers (`lookBody.ts`' and `skyBody.ts`' rule, whose GPU half reads the same
   * air's tables): what of it comes through the air to space (`trans`), the air's own light in front of it (`light`, the sky's
   * radiance that way) and the casting star's light at the top of the air over pi (`star`: what a white surface facing it
   * sends), each in scene units. Before this the place view laid its own wash's light in front of a body, in its own units,
   * under the game's eye: at dusk that light alone, times an eye opened some five stops, made Yavin Prime a flat white disc.
   * Answers false where no world's air drew.
   */
  bodySeen(dx: number, dy: number, dz: number, out: { trans: THREE.Vector3; light: THREE.Vector3; star: THREE.Vector3 }): boolean {
    const a = this.framed;
    const run = a?.run;
    if (!a || !run || !a.ready) return false;
    const tw = run.twin;
    const rec = tw.record;
    const hk = (run.heightM > 0.1 ? run.heightM : 0.1) / 1000;
    lightTransmittance(rec, tw.depth, rec[F.bottom] + hk, dy, this.seenT, 0);
    out.trans.set(this.seenT[0], this.seenT[1], this.seenT[2]);
    // the sky's radiance that way, in the sums' frame (the casting sun's azimuth on +X), as the twin works its own
    const sx = tw.inp[TWIN_IN.sx];
    const sz = tw.inp[TWIN_IN.sz];
    const h = Math.sqrt(sx * sx + sz * sz);
    const cx = h > 1e-9 ? sx / h : 1;
    const cz = h > 1e-9 ? sz / h : 0;
    tw.radianceIn(dx * cx + dz * cz, dy, -dx * cz + dz * cx, hk, SEEN_STEPS, this.seenL);
    out.light.set(this.seenL[0], this.seenL[1], this.seenL[2]);
    // (the sky round's fixer) the star's full light on a body, as the game's cards take it (`AIR.frame.bodyTop`: an eclipse of
    // our own sun is no shadow on the bodies; the disc's light where no applied system shades it)
    const bt = AIR.frame.bodyTop;
    out.star.set(bt.r / Math.PI, bt.g / Math.PI, bt.b / Math.PI);
    return true;
  }

  /** The game's day into the place view's reading of one (`dayView`), field by field. */
  private fillDay(): void {
    const d = this.day;
    const v = this.dayView;
    v.time = d.time;
    v.hours = d.time * 24;
    v.ratio = d.ratio;
    v.isDay = d.isDay;
    v.normalized = d.normalized;
    v.light.x = d.lightDir.x;
    v.light.y = d.lightDir.y;
    v.light.z = d.lightDir.z;
    v.sun.x = d.sunDir.x;
    v.sun.y = d.sunDir.y;
    v.sun.z = d.sunDir.z;
    v.moon.x = d.moonDir.x;
    v.moon.y = d.moonDir.y;
    v.moon.z = d.moonDir.z;
    v.clientTime = v.ratio * CLIENT_DAY_SECONDS;
    const sl = d.lightDir.y / 0.08;
    v.slotAlpha = sl < 0 ? 0 : sl > 1 ? 1 : sl;
  }

  /** The grade's source from the air's lighting this frame (`grade.ts`'s `readSource` over the twin's), and the night. */
  airSource(out: GradeSource): GradeSource {
    const L = this.L;
    out.key[0] = L.main.r * L.mainScale;
    out.key[1] = L.main.g * L.mainScale;
    out.key[2] = L.main.b * L.mainScale;
    out.fill[0] = L.ambient.r * L.ambientScale;
    out.fill[1] = L.ambient.g * L.ambientScale;
    out.fill[2] = L.ambient.b * L.ambientScale;
    const f = L.fog;
    const air = 0.2126 * f.r + 0.7152 * f.g + 0.0722 * f.b > 0.002 ? f : L.clear;
    out.air[0] = air.r;
    out.air[1] = air.g;
    out.air[2] = air.b;
    out.night = 1 - this.day.daylight;
    out.space = false;
    return out;
  }

  /** The light on a level surface the air makes this frame (the stars' gate: the game hides them above 0.05). */
  get level(): number {
    return AIR.frame.level;
  }

  /** The air's horizon colour this frame (the twin's fog colour, scene units), for the place view's far ground edge. */
  get fog(): THREE.Color {
    return this.L.fog as THREE.Color;
  }

  /** A frame handed over from the game held (null lets go). Answers what was taken, or why not. */
  setMatch(json: unknown): Record<string, unknown> {
    if (json === null) {
      const was = this.match?.name ?? null;
      this.match = null;
      return { let: was ?? 'nothing was held' };
    }
    const v = typeof json === 'string' ? JSON.parse(json) : json;
    if (!isGameMatch(v)) return { error: 'not a match: hand over what __debug.sky({ match }) answered as json' };
    this.match = v;
    return { held: v.name, planet: v.planet, time: v.time, count: typeof v.count === 'number' ? v.count : null, fov: v.camera.fov, air: !!v.air, eye: v.eye ? v.eye.exposure : null };
  }
}

/** The viewer's sky names its worlds by their sky's zone (`kashyyyk_main`); the game by its planet (`kashyyyk`). */
/** The steps of the march for a body's sky in front of it (`bodySeen`): the viewer's, a few bodies a frame. */
const SEEN_STEPS = 48;

export function gamePlanetOf(world: string): string {
  return world === 'kashyyyk_main' ? 'kashyyyk' : world;
}
/** And back: the viewer's world for a game planet. */
export function viewerWorldOf(planet: string): string {
  return planet === 'kashyyyk' ? 'kashyyyk_main' : planet;
}
