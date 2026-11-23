// The air of one world in play (the GPU port's pass 2, wave 1): its rows fitted behind the loading screen by the fit's
// worker (`airFit.ts`), the mix's rows blended into the twin each frame (`airTwin.ts`), the frame record the drawers read
// (`AIR.frame`), `SwgSky.lighting`'s fields written from the twin (after keeping SWG's own of the hour in `AIR.swg`, the
// steer's reference), and the card's tables drawn once a frame (`airTables.ts`, WebGPU only, loaded
// by a dynamic import so nothing of three's WebGPU build reaches the WebGL path).
//
// The world makes one of these on WebGPU under our sky (`World.loadSky`) and nowhere else: on WebGL, and under SWG's sky,
// nothing here runs and the lighting is the ramps' as it always was.
//
// The sky's time: the air reads only the sun's and the moon's directions (the day's `sunDir` and `moonDir`, whatever moves
// them: the day's path today, wave 5's orbits later) and the hour; nothing here keeps a clock of its own.
import * as THREE from 'three';
import { GPU } from '../../core/gpuSwitch.ts';
import { AIR, AIR_UNITS, type AirTables } from './airApi.ts';
import { AIR_DIAL_STATE, AIR_FILE_FIELDS, F, LUMA_B, LUMA_G, LUMA_R, airDialsOf, newAirRecord, ozoneOf, recordWords, setHazeGlow, setHazeTint, setVisibility, worldRecord, type AirRecord } from './airParams.ts';
import { AirTwin, DEPTH_FLOATS, IN, MOON_SHARE, PSI_FLOATS, buildDepthTable, buildPsiTable, sceneUnits, steerGain, writeTwinLighting, type TwinLighting } from './airTwin.ts';
import { fitGradients, fitSkyOf, type FitAsk, type FitReply, type FitRow } from './airFit.ts';
import { PAIR_TUNE, kelvinToLinear, secondOf } from '../stars.ts';
import { registerAirDials } from './airDials.ts';

/** The scene's units, worked once as the module loads (`sceneUnits`: a clear Tatooine noon's sun at today's key light there). */
AIR_UNITS.scene = sceneUnits();
// The visibility and steer dials join the sky's set before the menu first asks for it.
registerAirDials();

/** How long an arrival waits for the fit's worker before it takes the world's base record (it answers in a few hundred ms). */
export const FIT_WAIT_MS = 8000;

/** What the run reads of the day (`DayCycle`'s fields). */
export interface AirDay {
  readonly sunDir: THREE.Vector3;
  readonly moonDir: THREE.Vector3;
  readonly isDay: boolean;
}

/** What the run reads of the sky's mix (`SwgSky`'s accessors). */
export interface AirMix {
  readonly mixLength: number;
  mixBlock(i: number): object | null;
  readonly mixWeights: Float64Array;
}

/** The sky's lighting fields the run writes (`SwgSky.lighting`), each a colour and its scale. */
type Lighting = TwinLighting & { clear: { r: number; g: number; b: number } };

/** Most rows the sky blends at once (`sky.ts`'s `MIX_MAX`). */
const MIX_MOST = 4;

export class AirRun {
  readonly planet: string;
  readonly twin = new AirTwin();
  /** Each row's record and multiple scattering, by the sky's block (identity), and the world's base for anything else. */
  private readonly rows = new Map<object, number>();
  private readonly recs: AirRecord[] = [];
  private readonly psis: Float32Array[] = [];
  private readonly base: AirRecord;
  private readonly basePsi = new Float32Array(PSI_FLOATS);
  /** The mix's rows and weights last blended (so a frame whose mix did not move blends nothing). */
  private readonly lastRows = new Int32Array(MIX_MOST);
  private readonly lastWeights = new Float64Array(MIX_MOST);
  private lastN = -1;
  /** Kept slots the blend is handed. */
  private readonly mixRecs: AirRecord[] = [];
  private readonly mixPsis: Float32Array[] = [];
  private readonly mixW = new Float64Array(MIX_MOST);
  /** The second star's colour times its strength (luminance of the caster's share), or null for a world of one. */
  private readonly sun2Rgb: Float64Array | null;
  /** The dials' count last seen, and the visibility the rows were last set to. */
  private dialSeen = -1;
  private visSet = 0.5;
  /** Pass 2, wave 2: the ozone's limits the rows were last fitted under (the owner's dials), and a kept pair to read the dials into. */
  private readonly ozSet: [number, number] = [0.75, 4];
  private readonly ozNow: [number, number] = [0.75, 4];
  /** How many times a moved ozone limit asked for a refit, for the report. */
  refits = 0;
  /** Pass 2, wave 4a: the haze colour the rows were last set to (the world's dials), and what the last fit was asked with. */
  private readonly hazeSet: [number, number, number] = [1, 1, 1];
  private readonly hazeAsked: [number, number, number] = [1, 1, 1];
  /** The sky and light fix round: the glow round the sun (the haze's g, the world's dial) the rows were last set to, and asked with. */
  private glowSet = 0.5;
  private glowAsked = 0.5;
  private worker: Worker | null = null;
  private fitAsked = 0;
  private fitAnswered = 0;
  private readonly fitWaiters: (() => void)[] = [];
  private lastFit: Omit<FitReply, 'records' | 'psis' | 'depth'> | null = null;
  private readonly sky: { planet: string; sunElevationDegrees: number; blocks: readonly FitRow[] };
  private readonly urlOf: (file: string) => string;
  /** The tables on WebGPU, once made. */
  private tables: (AirTables & { warm(camera: THREE.PerspectiveCamera): Promise<void> }) | null = null;
  disposed = false;
  /** Frames the run has written, for the report. */
  frames = 0;
  /** The frame's numbers the caller writes before `frame`: the camera's height over the datum, metres, and the overcast (0 to 1). */
  heightM = 0.5;
  overcast = 0.5;

  constructor(planet: string, sky: { sunElevationDegrees: number; blocks: readonly FitRow[] }, urlOf: (file: string) => string) {
    this.planet = planet;
    this.urlOf = urlOf;
    this.sky = { planet, sunElevationDegrees: sky.sunElevationDegrees, blocks: sky.blocks };
    this.base = worldRecord(planet);
    for (let i = 0; i < MIX_MOST; i++) {
      this.mixRecs.push(this.base);
      this.mixPsis.push(this.basePsi);
    }
    const second = secondOf(planet);
    if (second) {
      const c = [1, 1, 1];
      kelvinToLinear(second.kelvin, c);
      this.sun2Rgb = new Float64Array([c[0] * second.strength, c[1] * second.strength, c[2] * second.strength]);
    } else this.sun2Rgb = null;
    sky.blocks.forEach((b, i) => this.rows.set(b, i));
    const dials = airDialsOf(planet);
    this.visSet = dials.visibilityKm;
    setVisibility(this.base, dials.visibilityKm);
    // Pass 2, wave 4a: the world's haze colour (its dials; grey to start).
    this.hazeSet[0] = dials.hazeR;
    this.hazeSet[1] = dials.hazeG;
    this.hazeSet[2] = dials.hazeB;
    setHazeTint(this.base, dials.hazeR, dials.hazeG, dials.hazeB);
    // The sky and light fix round: the world's glow round the sun (its dial; its own haze's g to start).
    this.glowSet = dials.glow;
    setHazeGlow(this.base, dials.glow);
    ozoneOf(planet, this.ozSet);
    this.dialSeen = AIR_DIAL_STATE.version;
    // The world's column densities on this thread at once (a millisecond): the transmittance is exact from the first frame,
    // whatever the fit's worker has yet to answer.
    const depth = new Float64Array(DEPTH_FLOATS);
    buildDepthTable(this.base, depth);
    this.twin.useDepth(depth);
    this.twin.useRecord(this.base, this.basePsi);
  }

  /** The fit asked of the worker (at load, and again when the world's visibility dial moves). */
  ask(): void {
    if (this.disposed) return;
    if (!this.worker) {
      try {
        this.worker = new Worker(new URL('./airFit.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent<FitReply>) => this.take(e.data);
        this.worker.onerror = () => this.fallback('the fit worker failed');
      } catch {
        this.fallback('no fit worker');
        return;
      }
    }
    const sky = fitSkyOf(this.planet, this.sky.sunElevationDegrees, this.sky.blocks);
    const gradients: Record<string, string> = {};
    for (const f of fitGradients(sky)) gradients[f] = this.urlOf(f);
    this.hazeAsked[0] = this.hazeSet[0];
    this.hazeAsked[1] = this.hazeSet[1];
    this.hazeAsked[2] = this.hazeSet[2];
    this.glowAsked = this.glowSet;
    // The world's saved air's record fields (wave 4b) and its glow round the sun (the fix round's dial, which the saved air's
    // forward glow sets: `bodiesFile.ts`) both handed over; the worker lays the fields, then the glow over them.
    const ask: FitAsk = { id: ++this.fitAsked, sky, visibilityKm: this.visSet, gradients, ozoneMin: this.ozSet[0], ozoneMax: this.ozSet[1], hazeTint: [this.hazeSet[0], this.hazeSet[1], this.hazeSet[2]], fileFields: AIR_FILE_FIELDS[this.planet] ?? null, glow: this.glowSet };
    this.worker.postMessage(ask);
  }

  /** Answers once the fit asked last has answered (or `ms` has gone by): an arrival waits on it behind its screen. */
  ready(ms: number = FIT_WAIT_MS): Promise<void> {
    if (this.fitAnswered >= this.fitAsked && this.fitAsked > 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        this.fallback(`the fit did not answer in ${ms} ms`);
        resolve();
      }, ms);
      this.fitWaiters.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  /** The fit's answer taken: every row's record and multiple scattering, the world's column densities. */
  private take(r: FitReply): void {
    if (this.disposed) return;
    this.fitAnswered = Math.max(this.fitAnswered, r.id);
    if (r.error || r.records.length !== this.sky.blocks.length) {
      this.fallback(r.error ?? 'the fit answered for other rows');
    } else if (r.id === this.fitAsked) {
      this.recs.length = 0;
      this.psis.length = 0;
      for (let i = 0; i < r.records.length; i++) {
        this.recs.push(r.records[i]);
        this.psis.push(r.psis[i]);
      }
      if (r.depth.length === DEPTH_FLOATS) this.twin.useDepth(r.depth);
      const { records: _a, psis: _b, depth: _c, ...words } = r;
      this.lastFit = words;
      this.lastN = -1;
      // A dial moved while the worker worked: the rows' haze follows it now, and the fit is asked again.
      if (this.visSet !== r.visibilityKm) this.setRowsVisibility(this.visSet);
      // Pass 2, wave 4a: likewise the haze's colour (its multiple scattering follows when the asked fit lands).
      if (this.hazeSet[0] !== this.hazeAsked[0] || this.hazeSet[1] !== this.hazeAsked[1] || this.hazeSet[2] !== this.hazeAsked[2] || this.glowSet !== this.glowAsked) this.setRowsHaze();
    }
    const w = this.fitWaiters.splice(0);
    for (const f of w) f();
  }

  /** No fit: every row is the world's base record (its haze by its own fog share is still the fit's word), on this thread. */
  private fallback(why: string): void {
    if (this.disposed || this.recs.length) {
      const w = this.fitWaiters.splice(0);
      for (const f of w) f();
      return;
    }
    console.warn(`air: ${why}; every row takes the world's base record`);
    const depth = new Float64Array(DEPTH_FLOATS);
    buildDepthTable(this.base, depth);
    buildPsiTable(this.base, depth, this.basePsi);
    this.twin.useDepth(depth);
    this.lastN = -1;
    const w = this.fitWaiters.splice(0);
    for (const f of w) f();
  }

  /** Every row's haze set to the world's visibility times its share (the dial moved), at once on this thread. */
  private setRowsVisibility(v: number): void {
    setVisibility(this.base, v);
    for (const rec of this.recs) setVisibility(rec, v * rec[F.visShare]);
    this.lastN = -1;
  }

  /** Every row's haze colour set to the world's dials (pass 2, wave 4a), at once on this thread; the fit's worker gives their multiple scattering. */
  private setRowsHaze(): void {
    const h = this.hazeSet;
    setHazeTint(this.base, h[0], h[1], h[2]);
    for (const rec of this.recs) setHazeTint(rec, h[0], h[1], h[2]);
    // The sky and light fix round: the glow round the sun with it (the haze's g; its multiple scattering the worker's too).
    setHazeGlow(this.base, this.glowSet);
    for (const rec of this.recs) setHazeGlow(rec, this.glowSet);
    this.lastN = -1;
  }

  /**
   * One frame, after the sky's own update and before the world turns the lighting into lights: the mix blended where it
   * moved, the twin's sums, the frame record, SWG's lighting of the hour kept and the air's written over it, the night
   * light's aim and the level light the eye's "off" follows. The camera's height over the world's datum (metres) and the weather's overcast are the
   * caller's to write into `heightM` and `overcast` first: a number handed across a call is a number made. Allocates nothing.
   */
  frame(day: AirDay, mix: AirMix, L: Lighting): void {
    if (this.disposed) return;
    this.frames++;
    const dials = airDialsOf(this.planet);
    if (AIR_DIAL_STATE.version !== this.dialSeen) {
      this.dialSeen = AIR_DIAL_STATE.version;
      // Pass 2, wave 2: the ozone's limits moved (the owner's dials): the rows fitted again in the worker, whose answer the
      // twin and the tables follow as they follow a moved visibility (numbers only, nothing built).
      const oz = ozoneOf(this.planet, this.ozNow);
      const ozMoved = oz[0] !== this.ozSet[0] || oz[1] !== this.ozSet[1];
      if (ozMoved) {
        this.ozSet[0] = oz[0];
        this.ozSet[1] = oz[1];
        this.refits++;
      }
      // Pass 2, wave 4a: the haze's colour moved (the owner's dials): the rows take it at once, the worker their multiple scattering.
      const hz = this.hazeSet;
      // The sky and light fix round: the glow round the sun moved is a moved haze too (the same refit, numbers only).
      const hazeMoved = dials.hazeR !== hz[0] || dials.hazeG !== hz[1] || dials.hazeB !== hz[2] || dials.glow !== this.glowSet;
      if (hazeMoved) {
        hz[0] = dials.hazeR;
        hz[1] = dials.hazeG;
        hz[2] = dials.hazeB;
        this.glowSet = dials.glow;
        this.setRowsHaze();
      }
      if (dials.visibilityKm !== this.visSet) {
        this.visSet = dials.visibilityKm;
        this.setRowsVisibility(this.visSet);
        this.ask();
      } else if (ozMoved || hazeMoved) this.ask();
    }
    this.blendMix(mix);
    const tw = this.twin;
    const rec = tw.record;
    const f = AIR.frame;
    const k = AIR_UNITS.scene * rec[F.sunStrength];
    tw.sunTop[0] = rec[F.sunR] * k;
    tw.sunTop[1] = rec[F.sunG] * k;
    tw.sunTop[2] = rec[F.sunB] * k;
    tw.moonTop[0] = tw.sunTop[0] * MOON_SHARE;
    tw.moonTop[1] = tw.sunTop[1] * MOON_SHARE;
    tw.moonTop[2] = tw.sunTop[2] * MOON_SHARE;
    const s = day.sunDir;
    const m = day.moonDir;
    const two = this.sun2Rgb !== null;
    if (two) {
      pairInto(s, f.sun2Dir);
      const s2 = this.sun2Rgb!;
      tw.sun2Top[0] = s2[0] * AIR_UNITS.scene;
      tw.sun2Top[1] = s2[1] * AIR_UNITS.scene;
      tw.sun2Top[2] = s2[2] * AIR_UNITS.scene;
    } else {
      f.sun2Dir.copy(s);
      tw.sun2Top[0] = tw.sun2Top[1] = tw.sun2Top[2] = 0;
    }
    const hKm = this.heightM / 1000;
    const heightKm = hKm > 0.001 ? hKm : 0.001;
    const overcast = this.overcast;
    // The twin's inputs into its kept array (a number handed across a call is a number made).
    const inp = tw.inp;
    inp[IN.sx] = s.x;
    inp[IN.sy] = s.y;
    inp[IN.sz] = s.z;
    inp[IN.mx] = m.x;
    inp[IN.my] = m.y;
    inp[IN.mz] = m.z;
    inp[IN.s2x] = f.sun2Dir.x;
    inp[IN.s2y] = f.sun2Dir.y;
    inp[IN.s2z] = f.sun2Dir.z;
    inp[IN.heightKm] = heightKm;
    tw.sun2 = two;
    tw.frame();
    const o = tw.out;
    f.on = true;
    f.sunDir.copy(s);
    f.moonDir.copy(m);
    f.sun2 = two;
    // Each colour's fields written straight (a number handed to setRGB across a call is a number made).
    rgbInto(f.sunTop, tw.sunTop);
    rgbInto(f.sun2Top, tw.sun2Top);
    rgbInto(f.moonTop, tw.moonTop);
    rgbInto(f.sunHere, o.sunHere);
    rgbInto(f.sun2Here, o.sun2Here);
    rgbInto(f.moonHere, o.moonHere);
    f.sunRadius = rec[F.sunRadius];
    f.heightKm = heightKm;
    f.clearVisibilityKm = dials.visibilityKm;
    f.visibilityKm = o.visibilityKm;
    f.fogDensity = o.fogDensity;
    f.overcast = overcast > 0 ? (overcast < 1 ? overcast : 1) : 0;
    f.steer = dials.steer;
    // SWG's lighting of this hour, kept before the air writes over it: the steer's reference.
    const w = AIR.swg;
    w.main.copy(L.main as THREE.Color);
    w.mainScale = L.mainScale;
    w.ambient.copy(L.ambient as THREE.Color);
    w.ambientScale = L.ambientScale;
    w.fill.copy(L.fill as THREE.Color);
    w.fillScale = L.fillScale;
    w.bounce.copy(L.bounce as THREE.Color);
    w.bounceScale = L.bounceScale;
    w.fog.copy(L.fog as THREE.Color);
    w.fogDensity = L.fogDensity;
    w.clear.copy(L.clear as THREE.Color);
    o.steer = dials.steer;
    // Pass 2, wave 2: the night light aims at the brightest body up, by what each sends to the ground through the air (the
    // twin's light here: nought for a body under the land), so the sun by day and SWG's nearly full moon by night
    // (`MOON_SHARE`, until wave 5's phases), and the world's main light shines from it (`AIR.frame.lightDir`). No light is
    // added: it is the one main light, aimed.
    const sh = o.sunHere;
    const mh = o.moonHere;
    const sunLum = LUMA_R * sh[0] + LUMA_G * sh[1] + LUMA_B * sh[2];
    const moonLum = LUMA_R * mh[0] + LUMA_G * mh[1] + LUMA_B * mh[2];
    o.night = moonLum > sunLum;
    f.lightDir.copy(o.night ? m : s);
    // The light on a level surface the eye's "off" follows (`src/sky/exposure/eyeRun.ts`): each body's light times the sine of
    // its height, and the sky's.
    const s2h = o.sun2Here;
    const up = o.skyUp;
    const sy = s.y > 0 ? s.y : 0;
    const my = m.y > 0 ? m.y : 0;
    const s2y = two && f.sun2Dir.y > 0 ? f.sun2Dir.y : 0;
    f.level = sunLum * sy + moonLum * my + (LUMA_R * s2h[0] + LUMA_G * s2h[1] + LUMA_B * s2h[2]) * s2y + (LUMA_R * up[0] + LUMA_G * up[1] + LUMA_B * up[2]);
    steerGain(o, w.fog, f.gain);
    writeTwinLighting(o, w, L);
    f.fogColour.copy(L.fog as THREE.Color);
    // Wave 1's night floor is gone (wave 2): the nights are physical, made readable by the eye's dark-night rule
    // (`src/sky/exposure/eyeMath.ts`).
  }

  /** The mix's rows blended into the twin, only where a row or a weight moved. */
  private blendMix(mix: AirMix): void {
    const n0 = mix.mixLength;
    const n = n0 < MIX_MOST ? n0 : MIX_MOST;
    let moved = n !== this.lastN;
    for (let i = 0; i < n; i++) {
      const b = mix.mixBlock(i);
      const idx = b === null ? -1 : (this.rows.get(b) ?? -1);
      const wt = mix.mixWeights[i];
      if (idx !== this.lastRows[i] || wt !== this.lastWeights[i]) moved = true;
      this.lastRows[i] = idx;
      this.lastWeights[i] = wt;
      const have = idx >= 0 && idx < this.recs.length;
      this.mixRecs[i] = have ? this.recs[idx] : this.base;
      this.mixPsis[i] = have ? this.psis[idx] : this.basePsi;
      this.mixW[i] = wt;
    }
    if (!moved) return;
    this.lastN = n;
    if (n > 0) this.twin.blendRows(this.mixRecs, this.mixPsis, this.mixW, n);
    else this.twin.useRecord(this.base, this.basePsi);
  }

  /**
   * The card's tables made and warmed behind the loading screen (WebGPU only: through the runtime, `GPU.rt.airTables`, so
   * nothing of three's WebGPU build reaches the WebGL path), following the twin's blended record. Answers once they are
   * built and drawn once.
   */
  async attachTables(camera: THREE.PerspectiveCamera): Promise<void> {
    if (this.disposed || !GPU.webgpu || !GPU.rt) return;
    const t = GPU.rt.airTables(this.twin.record);
    t.follow(this.twin.record);
    // Handed to the frame only once warmed: drawn before, a frame behind the screen met the compute's pipeline still being
    // built (`setPipeline` refused it, "frame failed") and the render passes' unbuilt.
    await t.warm(camera);
    if (!this.disposed) this.tables = t;
  }

  /** Once a game frame, after the camera is placed and before the scene's passes: the tables drawn for this camera. */
  drawTables(camera: THREE.PerspectiveCamera): void {
    if (this.disposed || !this.tables || !AIR.frame.on) return;
    this.tables.frame(camera);
  }

  /** The run let go (another world loads): the worker stopped, the frame record off. Answers null, for the holder's field. */
  dispose(): null {
    this.disposed = true;
    AIR.frame.on = false;
    this.worker?.terminate();
    this.worker = null;
    const w = this.fitWaiters.splice(0);
    for (const f of w) f();
    return null;
  }

  /** What `__debug.sky()` reports of the air: the record in force, the visibility, the fit and the tables' last rebuild. */
  report(): Record<string, unknown> {
    const f = AIR.frame;
    const lum = (c: THREE.Color) => Number((LUMA_R * c.r + LUMA_G * c.g + LUMA_B * c.b).toFixed(4));
    return {
      planet: this.planet,
      on: f.on,
      dials: { ...airDialsOf(this.planet) },
      ozoneLimits: { least: this.ozSet[0], most: this.ozSet[1], refits: this.refits },
      level: Number(f.level.toPrecision(4)),
      night: this.twin.out.night,
      visibilityKm: Number(f.visibilityKm.toFixed(2)),
      fogDensityPerM: Number(f.fogDensity.toPrecision(3)),
      sceneUnits: Number(AIR_UNITS.scene.toFixed(4)),
      sunHere: { luminance: lum(f.sunHere), rgb: f.sunHere.toArray().map((v) => Number(v.toFixed(4))) },
      sun2Here: f.sun2 ? { luminance: lum(f.sun2Here), rgb: f.sun2Here.toArray().map((v) => Number(v.toFixed(4))) } : null,
      moonHere: lum(f.moonHere),
      twin: {
        skyUp: Array.from(this.twin.out.skyUp, (v) => Number(v.toFixed(4))),
        groundDown: Array.from(this.twin.out.groundDown, (v) => Number(v.toFixed(4))),
        horizon: Array.from(this.twin.out.horizon, (v) => Number(v.toFixed(4))),
        zenith: Array.from(this.twin.out.zenith, (v) => Number(v.toFixed(4))),
        sums: this.twin.out.sums,
      },
      record: recordWords(this.twin.record),
      fit: this.lastFit ? { ms: Math.round(this.lastFit.ms), distinct: this.lastFit.distinct, rows: this.sky.blocks.length, visibilityKm: this.lastFit.visibilityKm, asked: this.fitAsked, answered: this.fitAnswered } : { asked: this.fitAsked, answered: this.fitAnswered, rows: 'the base record (no fit yet)' },
      tables: this.tables ? this.tables.report() : 'not made (WebGL, or not yet)',
      frames: this.frames,
    };
  }
}

/**
 * Tatooine's second sun's direction for the caster's `s`, into `out`: `src/sky/stars.ts`'s pair rule (`pairDirectionIn`,
 * its dial `PAIR_TUNE.belowDeg`), worked here from the vectors' own fields, since that function takes the caster's three
 * numbers across its call, and in four processes of twelve V8 left it out of the frame and made each one (48 B a frame).
 * `airRun.test.ts` holds the two to the same answer.
 */
export function pairInto(s: THREE.Vector3, out: THREE.Vector3): void {
  const h = Math.sqrt(s.x * s.x + s.z * s.z);
  const y = s.y > 1 ? 1 : s.y < -1 ? -1 : s.y;
  const e = Math.asin(y) - (PAIR_TUNE.belowDeg * Math.PI) / 180;
  const ce = Math.cos(e);
  if (h > 1e-9) {
    out.x = (s.x / h) * ce;
    out.z = (s.z / h) * ce;
  } else {
    out.x = 0;
    out.z = ce;
  }
  out.y = Math.sin(e);
}

/** A colour's fields from a kept rgb (no number across a call). */
function rgbInto(c: THREE.Color, v: Float64Array): void {
  c.r = v[0];
  c.g = v[1];
  c.b = v[2];
}

/** A record made fresh for a caller that wants one outside a run (the console's, the tests'). */
export function freshRecord(): AirRecord {
  return newAirRecord();
}
