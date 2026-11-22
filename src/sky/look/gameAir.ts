// "Draw as the game does" with the game's own air (the GPU port's pass 2, wave 4; the brief's item 3): the space body
// viewer's stage and place views drawn through the game's light, in place of the old viewer's `gamelook.js`, which drew a
// world's colour ramp and a copy of the game's last steps as they stood before pass 2. Here everything that makes the sky
// is the game's own code, run on the viewer's renderer:
//
//   - **the record and the fit**: the world's air (`AirRun`, `src/sky/air/airRun.ts`), its rows fitted from its converted
//     sky.json by the game's own fit worker, the mix's rows blended into the game's twin each frame;
//   - **the tables**: the game's four (`makeAirTables`), drawn for the viewer's camera every frame;
//   - **the sky**: the game's dome (`airSkyMaterial`: the sky view toward each direction and the star's discs through the
//     air), on the place view's own sphere;
//   - **the day**: the game's `DayCycle` on SWG's path at the hour (the sun, the moon), the game's twin's lighting;
//   - **the eye**: the game's "follow the sun" answer (`eyeFrameRun` over the twin's level light, the Eye adaptation row
//     off), or a match's measured exposure handed over as JSON from the game (`__debug.sky({ match })`'s `json`);
//   - **the bloom, the grade, the output**: the game's numbers in the game's order on WebGPU (the bloom's threshold against
//     the exposed light, the grade's parameters from `gradeMath.ts`'s `deriveGrade` over the twin's lighting with its pivot
//     in the exposed light, then three's ACES at the player's compensation and sRGB). WebGPU draws no vignette; neither does
//     this. Not drawn: the edge smoothing, the occlusion, the flare, the clouds (pass 3's) and the haze on solids (the
//     place view's ground is the viewer's own stage, not the world's).
//
// The haze on bodies seen from the ground is the bodies' own (`airProfile.js` and the day wash in `skywash.js`); in the
// game it is `skyBody.ts`'s. A world with no converted sky (an added zone, a world not converted) keeps the plain view.
import * as THREE from 'three';
import { MeshBasicNodeMaterial, RenderPipeline } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { AIR } from '../air/airApi.ts';
import { AirRun } from '../air/airRun.ts';
import { makeAirTables } from '../air/airTables.ts';
import { airSkyMaterial } from '../air/airSky.ts';
import { DayCycle } from '../../world/daycycle.ts';
import { EYE_IN, EYE_OUT, eyeFrameRun } from '../exposure/eyeRun.ts';
import { createGradeParams, createGradeSource, deriveGrade, lookFor, LUMA, GRADE_PIVOT, type GradeParams, type GradeSource } from '../../core/fx/gradeMath.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { pass, renderOutput, uniform, vec3, vec4, float, dot, mix, max, min, clamp, log2, pow, smoothstep, Fn, select } = TSL as Any;

/** The game's numbers the chain reads (the settings' defaults; `src/core/fxRegistry.ts`, `gpuChain.ts`'s composite). */
export const GAME = {
  bloom: { strength: 0.35, radius: 0.5, threshold: 0.85, composite: 3 },
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
 * exposure the game's card measured, the player's compensation).
 */
export interface GameMatch {
  name: string;
  planet: string;
  time: number;
  camera: { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number; fov: number };
  air?: { rows: number[]; weights: number[]; heightM: number; overcast: number } | null;
  eye?: { exposure: number; renderer: number } | null;
}

/** Whether a value handed in is a match the viewer can hold (anything else is refused whole). */
export function isGameMatch(v: unknown): v is GameMatch {
  const m = v as Record<string, Any> | null;
  const fin = (x: unknown): boolean => typeof x === 'number' && Number.isFinite(x);
  return !!m && typeof m === 'object' && typeof m.planet === 'string' && /^[a-z0-9_]+$/.test(m.planet) && fin(m.time) && !!m.camera && ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw', 'fov'].every((k) => fin(m.camera[k]));
}

/** One world's air in the viewer: its run, its sky's rows, its clear row, and its dome once the tables exist. */
interface WorldAir {
  world: string;
  run: AirRun | null;
  blocks: Any[];
  clear: number;
  ready: boolean;
  failed: string;
  dome: THREE.Material | null;
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
  bloomNode: Any = null;
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

  constructor(S: Any) {
    this.S = S;
    this.day.swg = true;
    this.day.held = true;
    this.U = {
      exposure: uniform(1), amount: uniform(1), balance: uniform(new THREE.Vector3(1, 1, 1)), shadow: uniform(new THREE.Vector3(1, 1, 1)), high: uniform(new THREE.Vector3(1, 1, 1)),
      split: uniform(0), sat: uniform(1), contrast: uniform(1), pivot: uniform(GRADE_PIVOT),
    };
    this.report = { path: 'off', planet: '', params: this.params, source: this.source, air: null, eye: null };
  }

  build(): void {
    const { renderer, scene, camera } = this.S;
    const U = this.U;
    const scenePass = pass(scene, camera, { samples: 4 });
    const hdr = scenePass.getTextureNode('output');
    // The eye's exposure first (the game's chain multiplies the scene by the eye before the bloom's bright pass, which holds
    // its threshold against the exposed light, and the grade's pivot stands in it).
    const exposed = hdr.rgb.mul(U.exposure);
    const bl = bloom(vec4(exposed, 1), GAME.bloom.strength * GAME.bloom.composite, GAME.bloom.radius, GAME.bloom.threshold);
    const L = vec3(LUMA[0], LUMA[1], LUMA[2]);
    // grade.ts's fragment, line for line (as gpuChain.ts's gradeGraph draws it on WebGPU)
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
    const graded = grade(exposed.add(bl.rgb));
    const shown = renderOutput(vec4(graded, 1.0), THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace);
    const pipe = new RenderPipeline(renderer);
    pipe.outputColorTransform = false;
    pipe.outputNode = vec4(shown.rgb, 1.0);
    this.pipeline = pipe;
    this.bloomNode = bl;
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
    this.report.path = path;
    this.report.planet = planet;
  }

  /** The player's compensation: a match's own, else nought stops (three's exposure 1). */
  private rendererExposure(): number {
    return this.match?.eye?.renderer && this.match.eye.renderer > 0 ? this.match.eye.renderer : 1;
  }

  render(): void {
    if (this.on && this.pipeline) {
      this.S.renderer.toneMappingExposure = 1;
      this.pipeline.render();
    } else this.S.renderer.render(this.S.scene, this.S.camera);
  }

  // ---------------------------------------------------------------- the world's air

  /** The world's air, asked for once (its sky.json read from the converted packs, its rows fitted in the game's worker). */
  useWorld(world: string): WorldAir {
    let a = this.airs.get(world);
    if (a) return a;
    a = { world, run: null, blocks: [], clear: 0, ready: false, failed: '', dome: null };
    this.airs.set(world, a);
    void this.loadWorld(a);
    return a;
  }

  /** Whether a world's air is made and drawing. */
  ready(world: string): boolean {
    return !!this.airs.get(world)?.ready;
  }

  private async loadWorld(a: WorldAir): Promise<void> {
    const planet = gamePlanetOf(a.world);
    try {
      const r = await fetch(`/assets-private/${encodeURIComponent(a.world)}/sky.json`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`no converted sky for ${a.world} (${r.status})`);
      const data = await r.json();
      if (!Array.isArray(data?.blocks) || !data.blocks.length || data.space) throw new Error(`${a.world}'s sky has no ground rows`);
      a.blocks = data.blocks;
      const c = data.blocks.findIndex((b: Any) => b && b.weatherIndex === 0);
      a.clear = c >= 0 ? c : 0;
      const run = new AirRun(planet, { sunElevationDegrees: +data.sunElevationDegrees || 0, blocks: data.blocks }, (file) => `/assets-private/${encodeURIComponent(a.world)}/${file}`);
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
    } catch (e) {
      a.failed = (e as Error).message;
      console.warn(`[viewer] the game's air for ${a.world}: ${a.failed} (the plain view stands)`);
    }
  }

  /**
   * One frame of a world's air at an hour (0 to 24): the game's day at that time on SWG's path, the mix (the match's rows and
   * weights, else the clear row), the twin's sums and lighting, the tables for the camera, and the eye's answer. Answers
   * whether the air drew.
   */
  frameAir(a: WorldAir, hours: number): boolean {
    if (!a.run) return false;
    const m = this.match && this.match.planet === gamePlanetOf(a.world) ? this.match : null;
    const day = this.day;
    day.time = m ? ((m.time % 1) + 1) % 1 : ((((hours / 24) % 1) + 1) % 1);
    day.held = true;
    day.update(0, false);
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
    // The eye: the match's measured exposure, else the game's "follow the sun" answer over the twin's level light.
    EYE_IN.air = true;
    EYE_IN.chain = true;
    EYE_IN.eye = false;
    EYE_IN.adapt = 0;
    EYE_IN.stops = 0;
    EYE_IN.loading = false;
    EYE_IN.level = AIR.frame.level;
    eyeFrameRun();
    const exposure = m?.eye && m.eye.exposure > 0 ? m.eye.exposure : EYE_OUT.exposure;
    this.U.exposure.value = exposure;
    this.report.eye = { exposure: Number(exposure.toPrecision(5)), stops: Number(Math.log2(exposure).toFixed(3)), from: m?.eye ? `the match '${m.name}'` : "the game's follow-the-sun answer (Eye adaptation off)" };
    this.report.air = { world: a.world, time: Number(day.time.toFixed(4)), sunDir: day.sunDir.toArray().map((v) => Number(v.toFixed(4))), level: Number(AIR.frame.level.toPrecision(4)), visibilityKm: Number(AIR.frame.visibilityKm.toFixed(2)), rows: mix.mixLength };
    return a.ready;
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
    return { held: v.name, planet: v.planet, time: v.time, fov: v.camera.fov, air: !!v.air, eye: v.eye ? v.eye.exposure : null };
  }
}

/** The viewer's sky names its worlds by their sky's zone (`kashyyyk_main`); the game by its planet (`kashyyyk`). */
export function gamePlanetOf(world: string): string {
  return world === 'kashyyyk_main' ? 'kashyyyk' : world;
}
/** And back: the viewer's world for a game planet. */
export function viewerWorldOf(planet: string): string {
  return planet === 'kashyyyk' ? 'kashyyyk_main' : planet;
}
