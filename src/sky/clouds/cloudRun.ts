// The clouds' model at run time (pass 3, wave 1, maker M): a world's stack of layers (its start, the clouds file's, and what
// the owner changes live), the shared level and drift in closed form, the frame's packing into the contract's layout
// (`cloudLayers.ts`) for the march and the map, the map's dispatch on the card, and `__debug.clouds(...)`'s model, layers,
// views and report, and the debug menu's `clouds` dials.
//
// WebGPU only: reached through the runtime (`GPU.rt.clouds`, made in `start.ts`); nothing here is imported by the WebGL path.
// The frame's path (`CloudRun.frame`, `dispatch`) allocates nothing: the world writes `CLOUD_IN`'s fields, the run writes
// its kept typed arrays and the march's feed in place.
import { CLOUD_DRAW, CLOUD_FEED, setCloudsOn, tuneMarch } from './cloudTune.ts';
// Pass 3, wave 1 (maker V): the march's own views ({ view: 'distance' }, 'transmittance').
import { setMarchView } from './cloudTune.ts';
import { marchDialGroups } from './cloudDials.ts';
import { CLOUD_FACE, cloudMarchReport } from './cloudMarch.ts';
import { tuneLook } from './cloudShape.ts';
import {
  CLOUD_BAND_FLOATS,
  CLOUD_FRAME_FLOATS,
  CLOUD_LAYER_MAX,
  CLOUD_LAYER_VEC4,
  CLOUD_LEVELS,
  CLOUD_MAP_RINGS,
  CLOUD_STACK_FLOATS,
  CLOUD_TYPES,
  CLOUD_TYPE_FLOATS,
  CLOUD_TYPE_TUNE,
  CLOUD_TYPE_WORDS,
  cleanLayer,
  copyStack,
  mixWeights,
  newCloudLayer,
  newStackFrame,
  packBands,
  packCovers,
  packStack,
  packStackFrame,
  packTypes,
  COVER_FLOATS,
  setMixSoft,
  sharesAtLevel,
  CLOUD_MIX_SOFT,
  type CloudLayer,
  type CloudTypeId,
} from './cloudLayers.ts';
import { cloudDeckFor, cloudStartFor, type CloudDeckId } from './cloudClimate.ts';
import { emptyCloudsFile, readCloudsFile, stackFromFile, type CloudsFileRead } from './cloudsFile.ts';
import { ADD_STARTS, editLayer, keepLine } from './cloudEdit.ts';
import {
  CLOUD_MAP_TUNE,
  CLOUD_MAP_TUNE_RANGE,
  CLOUD_REGION_MAX,
  CloudDrift,
  CloudMapFrame,
  MAP_TUNE_FLOATS,
  PLAN_FLOATS,
  REGION_DUST,
  REGION_RAIN,
  REGION_SNOW,
  evalRing,
  hash2,
  packMapTune,
  pcg,
  planRings,
  saltOf,
  sampleRing,
  unit,
  type CloudMapTune,
} from './cloudMap.ts';
import { cloudMapGpu, type CloudMapGpu } from './cloudMapGpu.ts';
import { LEVEL_RATE, seedOf } from '../../world/weatherSchedule.ts';
import { WIND_PROFILES, WIND_TUNE, windEntryNow, windWorldOf, windWorldTable } from '../../world/wind.ts';
import { PACK_FLOATS, WindPattern, defaultWindTable } from '../../world/windMath.ts';
import type { DialGroup, DialSet, Dial } from '../../ui/dials.ts';
import { readDials } from '../../ui/dials.ts';
import { PALETTE_FALLBACK } from '../../core/palette.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// ------------------------------------------------------------------------------------------------ the frame's inputs

/**
 * What the world hands the clouds each frame, written field by field (a number handed across a call is a number made): the
 * shared seconds the weather walks on (`Weather.windClock`), the day's time (0 midnight), the camera, the weather's own
 * continuous level and whether it follows the shared schedule (1) or is held or forced on this machine (0), and whether the
 * world is a space zone.
 */
export class CloudInput {
  tau = 0.5;
  dayTime = 0.5;
  camX = 0.5;
  camY = 0.5;
  camZ = 0.5;
  wLevel = 0.5;
  wFollow = 1;
  space = 0;
}
export const CLOUD_IN = new CloudInput();

/** A place that forces its weather, in the world's frame (x, z, radius, kind): the run's regions (`setRegions`). */
export interface CloudRegion {
  x: number;
  z: number;
  r: number;
  kind: 'rain' | 'dust' | 'snow';
}

// ------------------------------------------------------------------------------------------------ the run

/** The anchors' layout: [drift x, z at the anchor; the base drift x, z at the anchor; the factor; the turn in radians]. */
const ANCHOR_W = 6;

export class CloudRun {
  /** The world the run is attached to, and its start's key and line of why. */
  planetId = '';
  packId = '';
  /** The world whose ground rules or sky a world of his own borrows (its start's last key), or null. */
  borrowId: string | null = null;
  startKey: string | null = null;
  why = '';
  attached = false;
  /** The live stack (what the march and the map draw), its starts, and the file's read. */
  layers: CloudLayer[] = [];
  start: CloudLayer[] = [];
  file: CloudsFileRead = emptyCloudsFile();
  fileFrom: string | null = null;
  fileNotes: string[] = [];
  /** The world's ground: the median of its heights (m), what every layer's base stands on. */
  groundY = 0;
  readonly drift = new CloudDrift();
  /** The aloft speeds by whole level (m/s), and the tune they were made at (a dial moved makes them again). */
  readonly speeds = new Float64Array(CLOUD_LEVELS);
  private speedLow = Number.NaN;
  private speedFloor = Number.NaN;
  private seed = 0;
  private weights: number[] = [1];
  /** Each layer's anchor (`ANCHOR_W` numbers). */
  private readonly anchors = new Float64Array(CLOUD_LAYER_MAX * ANCHOR_W);
  /** The level: held on this machine (`hold`, from `holdFrom` at `holdAt`), or let go at `freeAt` from `freeFrom`. */
  hold: number | null = null;
  private holdFrom = 0.5;
  private holdAt = 0.5;
  private freeAt = -1e12;
  private freeFrom = 0.5;
  /** The level the frame used, and where it came from (0 the schedule, 1 the weather's own, 2 a hold). */
  level = 0.5;
  levelFrom = 0;
  // The frame's kept arrays (the contract's layout).
  readonly stackF = new Float32Array(CLOUD_STACK_FLOATS);
  readonly typesF = new Float32Array(CLOUD_TYPE_FLOATS);
  readonly bandsF = new Float32Array(CLOUD_BAND_FLOATS);
  readonly frameF = new Float32Array(CLOUD_FRAME_FLOATS);
  readonly planF = new Float64Array(PLAN_FLOATS);
  readonly tuneF = new Float32Array(MAP_TUNE_FLOATS);
  /** Each layer's full drift and its wind (x, z, vx, vz), never wrapped: the march's feed and the plan's. */
  readonly fullDrift = new Float64Array(CLOUD_LAYER_MAX * 4);
  readonly sf = newStackFrame();
  readonly mf = new CloudMapFrame();
  count = 0;
  bands = 0;
  /** The regions in the world's frame, and how many. */
  private readonly regionsW = new Float64Array(CLOUD_REGION_MAX * 4);
  private regionsN = 0;
  /** Frames packed, and the main thread's cost of a frame (µs, the console's measure: the frame itself reads no clock). */
  frames = 0;
  cpuUs = 0.5;
  /** The stack's kept covers and swings, and the version its still parts were packed at. */
  readonly coversF = new Float64Array(CLOUD_LAYER_MAX * COVER_FLOATS);
  private packedVersion = -1;
  /** The map on the card, once asked (the switch on). */
  map: CloudMapGpu | null = null;
  private warming: Promise<void> | null = null;
  renderer: Any = null;
  version = 0;
  /** The map held as it stands (a read-back's check under way: the card's map must be the frame the twin is handed). */
  held = false;

  // ---------------------------------------------------------------- the world

  /**
   * A world arrived (behind its loading screen): its start, the file's layers for it, its ground, the schedule's seed and
   * weights and the wind's aloft speeds (`wind.ts` attached by the weather first). The drift is summed from its epoch here.
   */
  attach(o: { planetId: string; packId: string; borrowId?: string | null; seed?: number; weights: readonly number[]; groundY: number; renderer: Any }): void {
    this.planetId = o.planetId;
    this.packId = o.packId;
    this.borrowId = o.borrowId ?? null;
    this.renderer = o.renderer;
    const s = cloudStartFor(o.planetId, o.packId, this.borrowId);
    this.startKey = s.key;
    this.why = s.why;
    this.start = s.layers;
    this.fileNotes = [];
    const got = stackFromFile(this.file, [o.planetId, o.packId], this.start, this.fileNotes);
    this.fileFrom = got.from;
    this.groundY = Number.isFinite(o.groundY) ? o.groundY : 0;
    // The schedule's own seed (the weather's: FNV-1a of the pack id), unless handed one.
    this.seed = (o.seed ?? seedOf(o.packId)) | 0;
    this.weights = o.weights.slice();
    this.speedLow = Number.NaN;
    this.makeSpeeds();
    this.anchors.fill(0);
    this.setLayers(got.layers, true);
    this.hold = null;
    this.freeAt = -1e12;
    // The drift summed from its epoch now, behind the screen (tens of milliseconds), not at the first frame.
    this.drift.tau = CLOUD_IN.tau;
    this.drift.at();
    this.attached = true;
    // The places that force their weather, as the world's index has them now (its file may land later: `regionsMoved` again).
    this.regionsMoved();
    this.publish();
  }

  /** One of this world's decks as a fresh layer at its real height and types (an `add` of a deck: `cloudEdit.ts`'s `StackHost`). */
  deckOf(deck: CloudDeckId): CloudLayer | null {
    return cloudDeckFor(deck, this.planetId, this.packId, this.borrowId);
  }

  /**
   * The world's places that force their weather, asked of whoever holds the places' index (the app's, set as its places are
   * first shown: `src/main.ts`), at an arrival and whenever the places move (a file landed, a write, a world state taken).
   */
  regionSource: (() => readonly CloudRegion[]) | null = null;
  regionsMoved(): void {
    const src = this.regionSource;
    if (src) this.setRegions(src());
  }

  /** The still parts packed again at the next frame (a type's tune moved: its column in a mix, its stretch in a streak). */
  touch(): void {
    this.version++;
    this.publish();
  }

  /** Whether the clouds are wanted (the switch, the march's CLOUD_DRAW.want): the frame packs nothing while they are not. */
  wanted(): boolean {
    return CLOUD_DRAW.want;
  }

  /** Between worlds: nothing drawn, nothing packed. */
  detach(): void {
    this.attached = false;
    this.regionsN = 0;
    CLOUD_FEED.stack = null;
    CLOUD_FEED.count = 0;
  }

  /** The clouds file's text read at the loading screen (null: none), kept for every world until the next screen. */
  readFile(json: unknown): void {
    this.file = readCloudsFile(json);
  }

  /** The aloft speeds by whole level from the wind's world table (`wind.ts`'s aloft rule: the travel times `aloft.low`, floored). */
  private makeSpeeds(): void {
    const A = WIND_TUNE.aloft;
    this.speedLow = A.low;
    this.speedFloor = A.floor;
    const world = windWorldTable();
    if (!world) {
      for (let i = 0; i < CLOUD_LEVELS; i++) this.speeds[i] = A.floor;
    } else {
      const entry = windEntryNow() ?? windWorldOf(this.planetId || 'unknown');
      const p = new WindPattern(this.seed, this.weights, world, WIND_PROFILES, entry, WIND_TUNE as never, new Float32Array(PACK_FLOATS), defaultWindTable());
      for (let L = 0; L < CLOUD_LEVELS; L++) {
        const lv = L < world.levels ? L : world.levels - 1;
        const wp = p.worldProfileAt(lv);
        const travel = Math.max(wp.scale * world.speeds[lv], wp.floor, WIND_TUNE.gusts.travelFloor);
        this.speeds[L] = Math.max(travel * A.low, A.floor);
      }
    }
    this.drift.setWorld(this.seed, this.weights, this.speeds, WIND_TUNE.heading.wanderPeriod);
  }

  /** The places that force their weather (the world's frame), the nearest `CLOUD_REGION_MAX` taken each frame. */
  setRegions(list: readonly CloudRegion[]): void {
    const n = list.length < CLOUD_REGION_MAX ? list.length : CLOUD_REGION_MAX;
    for (let i = 0; i < n; i++) {
      const r = list[i];
      this.regionsW[i * 4] = r.x;
      this.regionsW[i * 4 + 1] = r.z;
      this.regionsW[i * 4 + 2] = r.r;
      this.regionsW[i * 4 + 3] = r.kind === 'dust' ? REGION_DUST : r.kind === 'snow' ? REGION_SNOW : REGION_RAIN;
    }
    this.regionsN = n;
  }

  // ---------------------------------------------------------------- the stack

  /**
   * The stack replaced (a start, the file's, the console's, a slider's). Each layer's drift keeps its place where a layer of
   * the same name had another drift or turn (anchored now, so the edit does not throw it across the sky; a reload puts it on
   * the shared drift again); `fresh` drops every anchor (an arrival). Clamped for safety only; past `CLOUD_LAYER_MAX`
   * layers the rest are left, in words.
   */
  setLayers(list: readonly CloudLayer[], fresh = false): string[] {
    const words: string[] = [];
    const next = copyStack(list.slice(0, CLOUD_LAYER_MAX));
    if (list.length > CLOUD_LAYER_MAX) words.push(`${list.length - CLOUD_LAYER_MAX} layer(s) past the ${CLOUD_LAYER_MAX} a world holds were left`);
    const old = this.layers;
    const oldAnchors = this.anchors.slice();
    this.anchors.fill(0);
    if (!fresh) {
      const D = this.drift;
      D.tau = CLOUD_IN.tau;
      D.at();
      for (let i = 0; i < next.length; i++) {
        const j = old.findIndex((l) => l.name === next[i].name);
        const L = next[i];
        const turn = (L.turn * Math.PI) / 180;
        const o = i * ANCHOR_W;
        if (j < 0) {
          this.plainAnchor(o, L.drift, turn);
          continue;
        }
        const a = j * ANCHOR_W;
        const was = old[j];
        if (was.drift === L.drift && was.turn === L.turn) {
          for (let k = 0; k < ANCHOR_W; k++) this.anchors[o + k] = oldAnchors[a + k];
          continue;
        }
        // Where the layer stands now under its old rule, carried on under the new from here.
        const ox = oldAnchors[a] + this.driftOf(oldAnchors, a, D.x, D.z, 0);
        const oz = oldAnchors[a + 1] + this.driftOf(oldAnchors, a, D.x, D.z, 1);
        this.anchors[o] = ox;
        this.anchors[o + 1] = oz;
        this.anchors[o + 2] = D.x;
        this.anchors[o + 3] = D.z;
        this.anchors[o + 4] = L.drift;
        this.anchors[o + 5] = turn;
      }
    } else for (let i = 0; i < next.length; i++) this.plainAnchor(i * ANCHOR_W, next[i].drift, (next[i].turn * Math.PI) / 180);
    this.layers = next;
    this.version++;
    this.publish();
    return words;
  }

  private plainAnchor(o: number, mult: number, turn: number): void {
    this.anchors[o] = 0;
    this.anchors[o + 1] = 0;
    this.anchors[o + 2] = 0;
    this.anchors[o + 3] = 0;
    this.anchors[o + 4] = mult;
    this.anchors[o + 5] = turn;
  }

  /** A layer's drift since its anchor under its rule (axis 0 x, 1 z), from the base drift (dx, dz). The console's form. */
  private driftOf(A: Float64Array, a: number, dx: number, dz: number, axis: number): number {
    const ex = dx - A[a + 2];
    const ez = dz - A[a + 3];
    const c = Math.cos(A[a + 5]);
    const s = Math.sin(A[a + 5]);
    return A[a + 4] * (axis === 0 ? ex * c + ez * s : ez * c - ex * s);
  }

  /** The march's feed pointed at the run's arrays (its layers by reference, its version moved). */
  private publish(): void {
    CLOUD_FEED.stack = this.stackF;
    CLOUD_FEED.drift = this.fullDrift;
    CLOUD_FEED.layers = this.layers;
    CLOUD_FEED.version = this.version;
  }

  // ---------------------------------------------------------------- the level

  /** Hold the level on this machine (eased there at the weather's own rate), or let go (null) back to what it follows. */
  holdLevel(level: number | null): void {
    const now = CLOUD_IN.tau;
    if (level === null) {
      if (this.hold !== null) {
        this.freeFrom = this.level;
        this.freeAt = now;
      }
      this.hold = null;
      return;
    }
    const v = level < 0 ? 0 : level > CLOUD_LEVELS - 1 ? CLOUD_LEVELS - 1 : level;
    this.holdFrom = this.level;
    this.holdAt = now;
    this.hold = v;
  }

  // ---------------------------------------------------------------- the frame

  /**
   * The frame's numbers from `CLOUD_IN`: the level, the drift, the stack, its bands, the rings' plan, the regions and the
   * map's tune, into the kept arrays and the march's feed. Allocates nothing.
   */
  frame(): void {
    if (!this.attached) return;
    const I = CLOUD_IN;
    const tau = I.tau;
    // A dial of the wind aloft moved: the speeds made again and the drift summed again (a jump, as any change of the wind's rule).
    if (WIND_TUNE.aloft.low !== this.speedLow || WIND_TUNE.aloft.floor !== this.speedFloor) this.makeSpeeds();
    // The level.
    let followed = 0.5;
    // The schedule's level in closed form every frame (its walk kept hot and its next step kept, whatever the level follows).
    const S = this.drift.sched;
    S.tau = tau;
    S.at();
    if (I.wFollow > 0.5) {
      followed = S.level;
      this.levelFrom = 0;
    } else {
      followed = I.wLevel + 0;
      this.levelFrom = 1;
    }
    let lv = followed;
    const ramp = 1 / LEVEL_RATE;
    const h = this.hold;
    if (h !== null) {
      // Eased to the hold at the weather's rate (a level in 40 s): 0 to 4 over 160 s, "over minutes".
      const span = Math.abs(h - this.holdFrom) * ramp;
      // Math.min and Math.max: a conditional write of 0 or 1 makes the local a boxed value (CLAUDE.md).
      const f = span > 0 ? Math.min(1, Math.max(0, (tau - this.holdAt) / span)) : 1;
      lv = this.holdFrom + f * (h - this.holdFrom);
      this.levelFrom = 2;
    } else if (tau < this.freeAt + ramp * 4) {
      const span = Math.abs(followed - this.freeFrom) * ramp;
      const f = span > 0 ? Math.min(1, Math.max(0, (tau - this.freeAt) / span)) : 1;
      lv = this.freeFrom + f * (followed - this.freeFrom);
    }
    this.level = lv;
    // The drift, and each layer's under its anchor.
    const D = this.drift;
    D.tau = tau;
    D.at();
    const n = this.layers.length < CLOUD_LAYER_MAX ? this.layers.length : CLOUD_LAYER_MAX;
    const A = this.anchors;
    const fd = this.fullDrift;
    const sd = this.sf.drift;
    for (let i = 0; i < n; i++) {
      const a = i * ANCHOR_W;
      const ex = D.x - A[a + 2];
      const ez = D.z - A[a + 3];
      const c = Math.cos(A[a + 5]);
      const s = Math.sin(A[a + 5]);
      const m = A[a + 4];
      const dx = A[a] + m * (ex * c + ez * s);
      const dz = A[a + 1] + m * (ez * c - ex * s);
      const vx = m * (D.vx * c + D.vz * s);
      const vz = m * (D.vz * c - D.vx * s);
      fd[i * 4] = dx;
      fd[i * 4 + 1] = dz;
      fd[i * 4 + 2] = vx;
      fd[i * 4 + 3] = vz;
      let wx = dx % 65536;
      if (wx < 0) wx += 65536;
      let wz = dz % 65536;
      if (wz < 0) wz += 65536;
      sd[i * 4] = wx;
      sd[i * 4 + 1] = wz;
      sd[i * 4 + 2] = vx;
      sd[i * 4 + 3] = vz;
    }
    // The stack at this level and hour.
    const sf = this.sf;
    const T = CLOUD_MAP_TUNE;
    sf.groundY = this.groundY + 0;
    sf.regions = this.regionsN;
    sf.level = lv;
    sf.hour = Math.cos(2 * Math.PI * (I.dayTime - 0.625));
    const wt = Math.min(1, Math.max(0, (lv - T.wetFrom) / Math.max(0.01, T.wetFull - T.wetFrom)));
    sf.wet = wt * wt * (3 - 2 * wt);
    let sec = tau % 65536;
    if (sec < 0) sec += 65536;
    sf.seconds = sec;
    // The stack's still parts packed when it changed (its layers, a dial of the mix), its frame's own every frame.
    if (this.packedVersion !== this.version) {
      this.packedVersion = this.version;
      this.count = packStack(this.layers, sf, this.stackF);
      packCovers(this.layers, this.coversF);
    }
    packStackFrame(this.count, this.coversF, sf, this.stackF);
    packTypes(this.typesF);
    this.bands = packBands(this.stackF, this.count, this.bandsF, sf.bandTop);
    const fr = this.frameF;
    fr[0] = this.count;
    fr[1] = this.bands;
    fr[2] = lv;
    fr[3] = sec;
    planRings(this.stackF, this.count, I, fd, T, this.planF);
    // The cells' life as a wrapped whole number and a fraction of the shared seconds over it.
    const mf = this.mf;
    mf.groundY = this.groundY + 0;
    if (T.cellLife > 0) {
      const u = tau / T.cellLife;
      const fl = Math.floor(u);
      let li = fl % 65536;
      if (li < 0) li += 65536;
      mf.lifeI = li;
      mf.lifeF = u - fl;
    } else {
      mf.lifeI = 0;
      mf.lifeF = 0;
    }
    // The regions relative to the camera.
    const rn = this.regionsN;
    const R = mf.regions;
    const W = this.regionsW;
    for (let i = 0; i < rn; i++) {
      R[i * 4] = W[i * 4] - I.camX;
      R[i * 4 + 1] = W[i * 4 + 1] - I.camZ;
      R[i * 4 + 2] = W[i * 4 + 2];
      R[i * 4 + 3] = W[i * 4 + 3];
    }
    mf.regionCount = rn;
    packMapTune(T, mf, this.tuneF);
    CLOUD_FEED.count = this.count;
    this.frames++;
  }

  /** The map rewritten on the card for this frame (the march's `CLOUD_FACE.frame`, before it marches). */
  dispatch(): void {
    const map = this.map;
    if (!map || !map.warmed || !this.attached || !this.renderer || this.held) return;
    map.write(this);
    map.compute(this.renderer);
  }

  /** The map made and its computes compiled (off the frame); the march's face handed over. True once ready. */
  ensureMap(): boolean {
    if (!this.renderer) return false;
    if (!this.map) {
      this.map = cloudMapGpu();
      CLOUD_FACE.face = this.map.face;
    }
    if (!this.map.warmed && !this.warming) this.warming = this.map.warm(this.renderer).catch((e: unknown) => console.warn(`clouds: the map's computes did not compile: ${String(e)}`));
    return this.map.warmed && this.attached;
  }

  /** The map warmed behind a loading screen (an arrival with the switch on). */
  async warmBehindScreen(): Promise<void> {
    if (!CLOUD_DRAW.want) return;
    this.ensureMap();
    if (this.warming) await this.warming;
  }
}

export const CLOUD_RUN = new CloudRun();

// The march's hooks: whether the map has landed (the face handed over as it is made) and the dispatch before the march; the packed stack reaches the march through CLOUD_FEED.
CLOUD_FACE.ready = () => CLOUD_RUN.ensureMap();
CLOUD_FACE.frame = () => CLOUD_RUN.dispatch();

// ------------------------------------------------------------------------------------------------ the world's side

/**
 * The world's ground for the clouds: the median of its heights over a grid of `n` × `n` points across ±`reach` metres,
 * skipping any the terrain does not answer (the arrival's, behind the screen).
 */
export function groundMedianOf(heightAt: (x: number, z: number) => number | null | undefined, reach = 7000, n = 15): number {
  const v: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -reach + (2 * reach * i) / (n - 1);
      const z = -reach + (2 * reach * j) / (n - 1);
      const h = heightAt(x, z);
      if (typeof h === 'number' && Number.isFinite(h)) v.push(h);
    }
  }
  if (!v.length) return 0;
  v.sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
}

/** The places of a world's index that force their weather, as the clouds' regions (a box's middle and half its larger side). */
export function regionsOfPlaces(idx: { weatherHeld: { count: number; box: Float64Array; tag: Int32Array }; rows: readonly { weather?: string | null }[]; world: { weather?: string | null } | null }): CloudRegion[] {
  const out: CloudRegion[] = [];
  const L = idx.weatherHeld;
  for (let i = 0; i < L.count; i++) {
    const w = idx.rows[L.tag[i]]?.weather;
    if (w !== 'rain' && w !== 'dust' && w !== 'snow') continue;
    const b = L.box;
    const x = (b[i * 4] + b[i * 4 + 2]) / 2;
    const z = (b[i * 4 + 1] + b[i * 4 + 3]) / 2;
    const r = Math.max(b[i * 4 + 2] - b[i * 4], b[i * 4 + 3] - b[i * 4 + 1]) / 2;
    out.push({ x, z, r, kind: w });
  }
  const ww = idx.world?.weather;
  // The world row forcing its weather is every place at once.
  if (ww === 'rain' || ww === 'dust' || ww === 'snow') out.push({ x: 0, z: 0, r: 1e7, kind: ww });
  return out;
}

// ------------------------------------------------------------------------------------------------ the console

const round = (v: number, d: number): number => Number(v.toFixed(d));

/** The tune's change (`tune: { map, types, mixSoft, march, look }`): words for anything held or refused. */
function tuneClouds(o: Record<string, unknown>): string[] {
  const words: string[] = [];
  const map = o.map as Record<string, unknown> | undefined;
  if (map && typeof map === 'object') {
    for (const [k, v] of Object.entries(map)) {
      const range = (CLOUD_MAP_TUNE_RANGE as Record<string, [number, number]>)[k];
      if (!range) {
        words.push(`map: "${k}" is not one of ${Object.keys(CLOUD_MAP_TUNE).join(', ')}`);
        continue;
      }
      const n = Number(v);
      if (!Number.isFinite(n)) {
        words.push(`map.${k}: ${String(v)} is not a number`);
        continue;
      }
      (CLOUD_MAP_TUNE as Record<string, number>)[k] = Math.min(range[1], Math.max(range[0], n));
    }
  }
  const types = o.types as Record<string, Record<string, unknown>> | undefined;
  if (types && typeof types === 'object') {
    for (const [t, ch] of Object.entries(types)) {
      const p = CLOUD_TYPE_TUNE[t as CloudTypeId] as unknown as Record<string, number> | undefined;
      if (!p) {
        words.push(`types: "${t}" is not a type`);
        continue;
      }
      for (const [k, v] of Object.entries(ch ?? {})) {
        if (!(k in p)) {
          words.push(`types.${t}: "${k}" is not a slot (${Object.keys(p).join(', ')})`);
          continue;
        }
        const n = Number(v);
        if (Number.isFinite(n)) p[k] = Math.max(0, Math.min(k === 'base' || k === 'thickness' ? 20000 : k === 'cellSize' ? 64000 : k === 'stretch' ? 16 : k === 'density' ? 8 : 1, n));
      }
    }
    // A type's thickness is its column in a mix and its stretch a streak's: the still parts are packed again.
    CLOUD_RUN.touch();
  }
  if (o.mixSoft !== undefined) setMixSoft(Number(o.mixSoft));
  if (o.march && typeof o.march === 'object') words.push(...tuneMarch(o.march as Record<string, unknown>));
  if (o.look && typeof o.look === 'object') words.push(...tuneLook(o.look as Record<string, unknown>));
  return words;
}

/** The report (`__debug.clouds()`): the switch, the world, the stack, the level, the drift, the map and the march, and the line that keeps the stack. */
export function cloudsReport(r: CloudRun): Record<string, unknown> {
  const D = r.drift;
  const head = Math.atan2(D.vx, D.vz);
  const map = r.map;
  return {
    on: CLOUD_DRAW.want,
    ready: CLOUD_DRAW.ready,
    waiting: CLOUD_DRAW.waiting || null,
    world: { planet: r.planetId || null, pack: r.packId || null, start: r.startKey ?? 'the temperate default', why: r.why, ground: round(r.groundY, 1), file: r.fileFrom ? `public/sky/clouds.json's ${r.fileFrom}` : r.file.refused ? `refused: ${r.file.refused}` : 'none for this world', fileNotes: [...r.file.notes, ...r.fileNotes] },
    level: { now: round(r.level, 3), from: r.levelFrom === 2 ? `held at ${r.hold}` : r.levelFrom === 1 ? "the weather's own (held or forced on this machine)" : "the shared schedule's, in closed form" },
    layers: r.layers.map((l, i) => {
      const o = i * CLOUD_LAYER_VEC4 * 4;
      // Its types' shares at the level now (a deck whose rain type grows with the weather says so).
      const sh = sharesAtLevel(l, r.level, []);
      const total = sh.reduce((a, b) => a + Math.max(0, b), 0);
      return {
        i,
        name: l.name,
        on: l.on,
        types: l.types.map((t, k) => (l.types.length > 1 ? `${CLOUD_TYPE_WORDS[t]} ${total > 0 ? Math.round((100 * Math.max(0, sh[k])) / total) : k === 0 ? 100 : 0}%` : CLOUD_TYPE_WORDS[t])).join(' + '),
        ...(l.levelShares ? { sharesByLevel: l.types.map((t, k) => `${t}: ${l.levelShares![k].join(', ')}`) } : {}),
        base: round(r.stackF[o], 0),
        top: round(r.stackF[o + 1], 0),
        bandTop: round(r.sf.bandTop[i], 0),
        drawn: r.stackF[o + 7] > 0,
        coverNow: round(r.stackF[o + 11], 3),
        cover: l.cover,
        density: l.density,
        cellSize: l.cellSize,
        drift: { factor: l.drift, turn: l.turn, km: [round(r.fullDrift[i * 4] / 1000, 3), round(r.fullDrift[i * 4 + 1] / 1000, 3)], wind: round(Math.sqrt(r.fullDrift[i * 4 + 2] ** 2 + r.fullDrift[i * 4 + 3] ** 2), 2) },
        diurnal: l.diurnal,
        edge: l.edge,
        seed: l.seed,
      };
    }),
    bands: Array.from({ length: r.bands }, (_, b) => [round(r.bandsF[b * 4], 0), round(r.bandsF[b * 4 + 1], 0)]),
    wind: { speeds: Array.from(r.speeds, (v) => round(v, 2)), now: round(Math.sqrt(D.vx * D.vx + D.vz * D.vz), 2), headingDeg: Math.round((head * 180) / Math.PI), driftKm: [round(D.x / 1000, 3), round(D.z / 1000, 3)], summedSteps: D.steps, sumMs: round(D.primeMs, 1) },
    map: map
      ? { warmed: map.warmed, dispatches: map.dispatches, rings: { near: `${CLOUD_MAP_RINGS.near.size}² over ±${CLOUD_MAP_RINGS.near.span / 2000} km`, far: `${CLOUD_MAP_RINGS.far.size}² over ±${CLOUD_MAP_RINGS.far.span / 2000} km` }, slices: CLOUD_LAYER_MAX, regions: r.mf.regionCount, mainThreadUs: round(r.cpuUs, 1) }
      : { made: false, why: 'made the first time the switch is on' },
    march: cloudMarchReport(),
    tune: { map: { ...CLOUD_MAP_TUNE }, mixSoft: CLOUD_MIX_SOFT },
    keep: keepLine(r.layers),
  };
}

/**
 * `__debug.clouds(o)`'s model, layers, level, views and report (WebGPU's), and the draw's switch and tune handed to the
 * march's side: `()` the report; `{ on }` the switch; `{ layers: [...] }` the stack replaced; `{ layer: {...} }` one layer
 * changed, added, removed or moved (`editLayer`); `{ set: { <index>: {...} } }` the debug menu's form of the same; `{ level:
 * n | null }` held or followed; `{ reset: true }` the world's start (and the file's); `{ tune }`; `{ view }` an overlay of
 * the map; `{ picture }`, `{ check }`, `{ cells }` the proofs' reads (asynchronous).
 */
export function cloudsDebug(o: unknown): unknown {
  const r = CLOUD_RUN;
  if (o === undefined || o === null) return cloudsReport(r);
  if (typeof o !== 'object') return { said: [`clouds(${JSON.stringify(o)}): give an object, e.g. { on: true }, { layer: { name: 'cumulus', base: 1500 } }, { level: 3 }`] };
  const a = o as Record<string, unknown>;
  const said: string[] = [];
  if (a.check) return checkMap(r);
  // The map's card time by three's timer spans (`{ time: { frames } }`), at the stack drawn now.
  if (a.time) {
    const n = typeof a.time === 'object' && a.time && Number.isFinite((a.time as { frames?: number }).frames) ? Math.max(10, Math.min(2000, Math.round((a.time as { frames: number }).frames))) : 120;
    if (!r.map || !r.map.warmed) return { time: 'the map has not landed: turn the clouds on first ({ on: true })' };
    const part = (a.time as { part?: string }).part;
    r.map.timePart = part === 'near' ? 1 : part === 'far' ? 2 : 0;
    // The main thread's frame of the model, timed here (the frame reads no clock): 2,000 frames at this moment.
    const c0 = performance.now();
    for (let i = 0; i < 2000; i++) r.frame();
    r.cpuUs = ((performance.now() - c0) * 1000) / 2000;
    return r.map.time(n).then((x) => ({ map: x, mainThreadUs: Number(r.cpuUs.toFixed(2)), part: part === 'near' || part === 'far' ? part : 'both', layers: r.count, on: r.layers.filter((l) => l.on).length, rings: '512² and 256² (2×2 supersampled)', note: 'three GPUTimer spans of the two compute passes a frame' }));
  }
  if (a.picture) return pictureOf(r, a.picture as string, a);
  if (a.cells) return cellsNear(r, a);
  if (typeof a.on === 'boolean') {
    setCloudsOn(a.on);
    if (a.on) r.ensureMap();
  }
  if (a.reset === true) said.push(...r.setLayers(stackFromFile(r.file, [r.planetId, r.packId], r.start, r.fileNotes).layers));
  if (Array.isArray(a.layers)) {
    const words: string[] = [];
    const list = (a.layers as unknown[]).map((l) => cleanLayer((l ?? {}) as Record<string, unknown>, r.start.find((s) => s.name === (l as { name?: string } | null)?.name) ?? null, words));
    said.push(...words, ...r.setLayers(list));
  }
  if (a.layer && typeof a.layer === 'object') said.push(...editLayer(r, a.layer as Record<string, unknown>));
  if (a.set && typeof a.set === 'object') {
    for (const [k, v] of Object.entries(a.set as Record<string, unknown>)) {
      if (v && typeof v === 'object') said.push(...editLayer(r, { ...(v as Record<string, unknown>), index: Number(k) }));
    }
  }
  if ('level' in a) {
    const lv = a.level;
    if (lv === null || lv === 'follow') r.holdLevel(null);
    else if (typeof lv === 'number' && Number.isFinite(lv)) r.holdLevel(lv);
    else said.push(`level ${String(lv)}: a number 0 to 4 holds, null follows`);
  }
  if (a.tune && typeof a.tune === 'object') said.push(...tuneClouds(a.tune as Record<string, unknown>));
  if ('view' in a) said.push(setView(r, a.view as string | null, a));
  // The report after a change is the change's: the stack packed now (its heights, covers and bands), not the last frame's.
  if (r.attached && (a.layers || a.layer || a.set || a.reset || a.tune || 'level' in a)) r.frame();
  const rep = cloudsReport(r);
  return said.length ? { said, ...rep } : rep;
}

// ------------------------------------------------------------------------------------------------ the proofs' reads

/** The layers' slots and the world the check reads the twin with (a copy of this frame's numbers, taken at once). */
function snapshot(r: CloudRun): { stack: Float32Array; types: Float32Array; plan: Float64Array; mf: CloudMapFrame; tune: CloudMapTune } {
  const mf = new CloudMapFrame();
  mf.lifeI = r.mf.lifeI;
  mf.lifeF = r.mf.lifeF;
  mf.groundY = r.mf.groundY;
  mf.regions.set(r.mf.regions);
  mf.regionCount = r.mf.regionCount;
  return { stack: r.stackF.slice(), types: r.typesF.slice(), plan: r.planF.slice(), mf, tune: { ...CLOUD_MAP_TUNE } };
}

/**
 * The map against its twin (`{ check: true }`): every on layer's near and far ring read back and held to `evalRing` at the
 * numbers the card was handed that frame, the map held from that dispatch until the reads are done. Within 2/255 at every
 * texel and channel is the tolerance (the card's float32 against the twin's doubles, each rounded to eight bits: the wave's
 * read-backs met it at 1/255 over six layers' twelve rings). Asynchronous.
 */
async function checkMap(r: CloudRun): Promise<unknown> {
  const map = r.map;
  if (!map || !map.warmed || !r.renderer) return { check: 'the map has not landed: turn the clouds on first ({ on: true })' };
  // The numbers handed this frame, the dispatch, then the reads with the map held (no frame rewrites it until they are done):
  // the map read back is the very frame the twin is handed.
  r.frame();
  r.dispatch();
  r.held = true;
  const snap = snapshot(r);
  const out: Record<string, unknown>[] = [];
  let allOk = true;
  try {
    for (let l = 0; l < r.count; l++) {
      if (!(snap.stack[l * CLOUD_LAYER_VEC4 * 4 + 7] > 0)) continue;
      for (const ring of [0, 1] as const) {
        const card = await map.readBack(r.renderer, l, ring);
        const twin = evalRing(snap.stack, snap.types, snap.plan, snap.mf, snap.tune, l, ring);
        let worst = 0;
        let over2 = 0;
        const hist = [0, 0, 0, 0, 0];
        const odd: number[][] = [];
        const N = ring === 0 ? CLOUD_MAP_RINGS.near.size : CLOUD_MAP_RINGS.far.size;
        for (let i = 0; i < card.length; i++) {
          const d = Math.abs(card[i] - twin[i]);
          if (d > worst) worst = d;
          if (d > 2) {
            over2++;
            // The first few texels past the tolerance, as [i, j, channel, card, twin].
            if (odd.length < 6) odd.push([(i >> 2) % N, Math.floor((i >> 2) / N), i & 3, card[i], twin[i]]);
          }
          hist[d > 3 ? 4 : d]++;
        }
        const share = over2 / card.length;
        const ok = worst <= 2;
        allOk &&= ok;
        out.push({ layer: l, name: r.layers[l]?.name, ring: ring === 0 ? 'near' : 'far', ok, worst255: worst, over2Share: Number(share.toExponential(2)), byDiff: { 0: hist[0], 1: hist[1], 2: hist[2], 3: hist[3], more: hist[4] }, ...(odd.length ? { past: odd } : {}) });
      }
    }
  } finally {
    r.held = false;
  }
  return { check: allOk ? 'the map is its twin within 2/255 at every texel' : 'NOT within tolerance', tolerance: '2/255 at every texel and channel', rings: out };
}

/**
 * Cells and cover at chosen world places, from the card's read-back (`{ cells: { at: [[x, z], ...], layer } }`): each place's
 * stored cover, mix and wetness read by the sampler's rule, and each cellular layer's nearest cells' world places worked out
 * from the twin's lattice (their middles, x and z, metres): what two browsers compare. Asynchronous.
 */
async function cellsNear(r: CloudRun, a: Record<string, unknown>): Promise<unknown> {
  const map = r.map;
  const spec = (typeof a.cells === 'object' && a.cells ? a.cells : {}) as { at?: [number, number][]; layer?: number; tau?: number; dayTime?: number };
  const at = Array.isArray(spec.at) && spec.at.length ? spec.at : [[0, 0], [1500, -2200], [-4000, 3000], [8000, 8000]];
  const layer = typeof spec.layer === 'number' ? spec.layer : 0;
  const I = CLOUD_IN;
  // A moment and an hour asked for (two browsers asked for one moment compare one map): the frame worked at them, put back after.
  const keepTau = I.tau;
  const keepDay = I.dayTime;
  if (typeof spec.tau === 'number' && Number.isFinite(spec.tau)) I.tau = spec.tau;
  if (typeof spec.dayTime === 'number' && Number.isFinite(spec.dayTime)) I.dayTime = spec.dayTime;
  r.frame();
  if (map && map.warmed) r.dispatch();
  const snap = snapshot(r);
  const tauAt = I.tau;
  const levelAt = r.level;
  const dAt = [r.fullDrift[layer * 4], r.fullDrift[layer * 4 + 1]];
  I.tau = keepTau;
  I.dayTime = keepDay;
  const rows: Record<string, unknown>[] = [];
  // The map held from this dispatch until it is read, so the read is the frame the twin is handed.
  r.held = true;
  let card: Uint8Array | null = null;
  try {
    card = map && map.warmed && r.renderer ? await map.readBack(r.renderer, layer, 0) : null;
  } finally {
    r.held = false;
  }
  const twin = evalRing(snap.stack, snap.types, snap.plan, snap.mf, snap.tune, layer, 0);
  const s = new Float64Array(4);
  for (const [x, z] of at) {
    const rx = x - I.camX;
    const rz = z - I.camZ;
    sampleRing(twin, snap.plan, layer, 0, rx, rz, s);
    const tw = [round(s[0], 4), round(s[1], 4), round(s[2], 4)];
    let cd: number[] | null = null;
    if (card) {
      sampleRing(card, snap.plan, layer, 0, rx, rz, s);
      cd = [round(s[0], 4), round(s[1], 4), round(s[2], 4)];
    }
    rows.push({ at: [x, z], card: cd, twin: tw });
  }
  // The layer's cells near the camera: each cell's square in the layer's frame, its jittered middle, carried into the world.
  const L = r.layers[layer];
  const cell = L?.cellSize ?? 1600;
  const dx = dAt[0];
  const dz = dAt[1];
  const qx = I.camX - dx;
  const qz = I.camZ - dz;
  const T = CLOUD_MAP_TUNE;
  const salt = saltOf(snap.stack[layer * CLOUD_LAYER_VEC4 * 4 + 19], 0);
  const cells: Record<string, unknown>[] = [];
  const ci = Math.floor(qx / cell);
  const cj = Math.floor(qz / cell);
  for (let j = cj - 1; j <= cj + 1; j++) {
    for (let i = ci - 1; i <= ci + 1; i++) {
      let h = hash2(i & 0xffff, j & 0xffff, salt);
      if (T.cellLife > 0) {
        const ph = snap.mf.lifeF + unit(h);
        const e = (snap.mf.lifeI + Math.floor(ph)) & 0xffff;
        h = pcg((h + e) >>> 0);
      }
      // The cell's bytes as `evalTexel` reads them: its jitters, whether it is up, its size.
      const a = pcg(h);
      const up = ((a >>> 16) & 255) / 256 + 1 / 512 < Math.min(1, r.stackF[layer * CLOUD_LAYER_VEC4 * 4 + 11] * T.cellPresence);
      const px = (i + 0.5 + ((a & 255) / 256 + 1 / 512 - 0.5) * T.cellJitter) * cell + dx;
      const pz = (j + 0.5 + (((a >>> 8) & 255) / 256 + 1 / 512 - 0.5) * T.cellJitter) * cell + dz;
      cells.push({ cell: [i, j], up, world: [round(px, 2), round(pz, 2)] });
    }
  }
  return { tau: tauAt, asked: typeof spec.tau === 'number', cam: [round(I.camX, 2), round(I.camZ, 2)], layer, name: L?.name ?? null, driftM: [round(dx, 3), round(dz, 3)], level: round(levelAt, 4), summedSteps: r.drift.steps, places: rows, cells };
}

/** A type's colour in the views: one of the palette's eleven non-structural names a type, so every type reads apart. */
const TYPE_COLOURS = [0, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((i) => hexRgb(PALETTE_FALLBACK[i]));
function hexRgb(s: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(s);
  if (!m) return [200, 200, 200];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * The map as a picture (`{ picture: 'cover' | 'type' | 'layer', layer?, ring? }`): cover in grey, the dominant type's colour
 * by its cover, or each layer's colour by its cover over the stack, read back from the card (the twin where the card has
 * not landed). A PNG as a data URL, for the proofs' pictures. Asynchronous.
 */
async function pictureOf(r: CloudRun, view: string, a: Record<string, unknown>): Promise<unknown> {
  const ring = a.ring === 1 || a.ring === 'far' ? 1 : 0;
  const N = ring === 0 ? CLOUD_MAP_RINGS.near.size : CLOUD_MAP_RINGS.far.size;
  r.frame();
  const map = r.map;
  const fromCard = !!(map && map.warmed && r.renderer);
  if (fromCard) r.dispatch();
  const snap = snapshot(r);
  const slices: Uint8Array[] = [];
  const only = typeof a.layer === 'number' ? a.layer : -1;
  // The map held from this dispatch until every slice is read (one frame's map, whatever the reads take).
  r.held = fromCard;
  try {
    for (let l = 0; l < r.count; l++) {
      // A slot of count 0 is not laid this frame (off, or clear with no place forcing its weather): nothing to draw of it.
      if ((only >= 0 && l !== only) || !(snap.stack[l * CLOUD_LAYER_VEC4 * 4 + 7] > 0)) {
        slices.push(new Uint8Array(0));
        continue;
      }
      slices.push(fromCard ? await map!.readBack(r.renderer, l, ring) : evalRing(snap.stack, snap.types, snap.plan, snap.mf, snap.tune, l, ring));
    }
  } finally {
    r.held = false;
  }
  const px = new Uint8ClampedArray(N * N * 4);
  const w = [0, 0, 0];
  for (let k = 0; k < N * N; k++) {
    let R = 6;
    let G = 10;
    let B = 18;
    for (let l = 0; l < slices.length; l++) {
      const s = slices[l];
      if (!s.length) continue;
      const c = s[k * 4] / 255;
      if (view === 'cover') {
        const g = Math.min(255, (R + c * 255) | 0);
        R = G = B = Math.max(R, g);
      } else {
        const o = l * CLOUD_LAYER_VEC4 * 4;
        let col: [number, number, number];
        if (view === 'type') {
          mixWeights(snap.stack[o + 7], snap.stack[o + 8], snap.stack[o + 9], snap.stack[o + 10], s[k * 4 + 1] / 255, w);
          const best = w[0] >= w[1] && w[0] >= w[2] ? 0 : w[1] >= w[2] ? 1 : 2;
          col = TYPE_COLOURS[snap.stack[o + 4 + best] | 0];
        } else col = TYPE_COLOURS[(l * 2 + 1) % TYPE_COLOURS.length];
        R = R + (col[0] - R) * c * 0.85;
        G = G + (col[1] - G) * c * 0.85;
        B = B + (col[2] - B) * c * 0.85;
      }
    }
    // Rows top to bottom with +Z down the picture's height read as the map's j.
    px[k * 4] = R;
    px[k * 4 + 1] = G;
    px[k * 4 + 2] = B;
    px[k * 4 + 3] = 255;
  }
  const canvas = document.createElement('canvas');
  canvas.width = N;
  canvas.height = N;
  const g = canvas.getContext('2d')!;
  g.putImageData(new ImageData(px, N, N), 0, 0);
  return { view, ring: ring === 0 ? 'near' : 'far', from: fromCard ? 'the card' : 'the twin', layers: r.layers.map((l) => `${l.name}: ${l.types.join(' + ')}`), typeColours: Object.fromEntries(CLOUD_TYPES.map((t, i) => [t, PALETTE_FALLBACK[[0, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17][i]]])), png: canvas.toDataURL('image/png') };
}

// ------------------------------------------------------------------------------------------------ the on-screen views

let viewCanvas: HTMLCanvasElement | null = null;
let viewTimer: ReturnType<typeof setInterval> | null = null;
let viewBusy = false;

/**
 * A view of the map over the screen's corner (`{ view: 'cover' | 'type' | 'layer' | null, layer? }`), drawn from a read-back
 * twice a second: debug only, so it reads asynchronously off the frame and builds no program. The march's distance view is
 * the march's (`{ view: 'distance' }`).
 */
function setView(r: CloudRun, view: string | null, a: Record<string, unknown>): string {
  if (viewTimer) clearInterval(viewTimer);
  viewTimer = null;
  // Pass 3, wave 1 (maker V): the march's own views over the picture (a uniform of its composite's: nothing built), and none
  // for any other view.
  const marchWord = setMarchView(view === 'distance' || view === 'transmittance' ? view : null);
  if (view === 'distance' || view === 'transmittance') {
    viewCanvas?.remove();
    viewCanvas = null;
    return marchWord;
  }
  if (!view || view === 'off' || view === 'distance') {
    viewCanvas?.remove();
    viewCanvas = null;
    return view === 'distance' ? "the distance view is the march's" : 'the map view is off';
  }
  if (!viewCanvas) {
    viewCanvas = document.createElement('canvas');
    viewCanvas.style.cssText = 'position:fixed;left:12px;bottom:12px;width:256px;height:256px;z-index:50;pointer-events:none;image-rendering:pixelated;border:1px solid rgba(127,215,255,0.28)';
    document.body.appendChild(viewCanvas);
  }
  const c = viewCanvas;
  viewTimer = setInterval(() => {
    if (viewBusy) return;
    viewBusy = true;
    void (pictureOf(r, view, a) as Promise<{ png: string }>)
      .then((p) => {
        const img = new Image();
        img.onload = () => {
          c.width = img.width;
          c.height = img.height;
          c.getContext('2d')?.drawImage(img, 0, 0);
        };
        img.src = p.png;
      })
      .finally(() => (viewBusy = false));
  }, 500);
  return `the map's ${view} view in the corner, from ${r.map?.warmed ? 'the card' : 'the twin'}, twice a second`;
}

// ------------------------------------------------------------------------------------------------ the debug menu's dials

const DIAL_FIELDS: { k: string; label: string; min: number; max: number; step: number; unit: string; note: string }[] = [
  { k: 'base', label: 'Base', min: 0, max: 20000, step: 50, unit: 'm', note: "Its base over the world's ground (its median height): any type at any height." },
  { k: 'thickness', label: 'Thickness', min: 50, max: 20000, step: 50, unit: 'm', note: 'From its base to its top.' },
  { k: 'cover0', label: 'Cover, level 0', min: 0, max: 1, step: 0.01, unit: '', note: 'Its cover at the clearest weather level.' },
  { k: 'cover1', label: 'Cover, level 1', min: 0, max: 1, step: 0.01, unit: '', note: 'At level 1.' },
  { k: 'cover2', label: 'Cover, level 2', min: 0, max: 1, step: 0.01, unit: '', note: 'At level 2.' },
  { k: 'cover3', label: 'Cover, level 3', min: 0, max: 1, step: 0.01, unit: '', note: 'At level 3.' },
  { k: 'cover4', label: 'Cover, level 4', min: 0, max: 1, step: 0.01, unit: '', note: 'At the stormiest level.' },
  { k: 'share0', label: "First type's share", min: 0, max: 4, step: 0.05, unit: '×', note: "The first type's share of the layer's area against the others' (a share that moves with the weather level is scaled whole, its mean the slider's; set it level by level with __debug.clouds({ layer: { name, share0: [five numbers] } }))." },
  { k: 'share1', label: "Second type's share", min: 0, max: 4, step: 0.05, unit: '×', note: "The second type's share (moving with the level as the first's does)." },
  { k: 'share2', label: "Third type's share", min: 0, max: 4, step: 0.05, unit: '×', note: "The third type's share." },
  { k: 'mixScale', label: 'Mix patches', min: 500, max: 64000, step: 100, unit: 'm', note: "How large each type's patches are where the layer mixes types." },
  { k: 'density', label: 'Density', min: 0, max: 4, step: 0.05, unit: '×', note: "A factor on its types' own densities." },
  { k: 'cellSize', label: 'Cell size', min: 100, max: 8000, step: 50, unit: 'm', note: 'How far apart its cells (one heap each) stand.' },
  { k: 'drift', label: 'Drift', min: -4, max: 4, step: 0.05, unit: '×', note: 'A factor on the one wind aloft.' },
  { k: 'turn', label: 'Turn', min: -180, max: 180, step: 1, unit: '°', note: "How far its drift turns from the wind's heading." },
  { k: 'diurnal', label: 'Diurnal swing', min: -1, max: 1, step: 0.01, unit: '', note: 'Cover added at mid-afternoon and taken at 03:00.' },
  { k: 'edge', label: 'Edge softness', min: 0, max: 1, step: 0.01, unit: '', note: 'How soft the edge between its cover and clear sky.' },
];

function layerGroup(i: number): DialGroup {
  const L = (): CloudLayer | undefined => CLOUD_RUN.layers[i];
  const set = (ch: Record<string, unknown>): string[] => (CLOUD_RUN.layers[i] ? editLayer(CLOUD_RUN, { ...ch, index: i }) : [`no layer ${i}: add one with __debug.clouds({ layer: { add: 'cumulus' } })`]);
  const choice = (k: string, label: string, list: readonly string[], get: () => string, note: string, as: (v: string) => unknown = (v) => v): Dial => ({ kind: 'choice', key: `set.${i}.${k}`, label, note, choices: list, get, set: (v) => set({ [k]: as(v) }) });
  const dials: Dial[] = [
    choice('on', 'Drawn', ['on', 'off'], () => (L()?.on === false ? 'off' : 'on'), 'Off, the layer is kept and costs nothing.', (v) => v === 'on'),
    choice('type0', 'Type', CLOUD_TYPES, () => L()?.types[0] ?? 'cumulus', 'Its type, or the first of its mix: a vertical profile and an erosion of the shape, at whatever height it stands.'),
    choice('type1', 'Second type', ['none', ...CLOUD_TYPES], () => L()?.types[1] ?? 'none', 'A second type laid in patches with the first.'),
    choice('type2', 'Third type', ['none', ...CLOUD_TYPES], () => L()?.types[2] ?? 'none', 'A third.'),
  ];
  for (const f of DIAL_FIELDS) {
    dials.push({
      kind: 'number',
      key: `set.${i}.${f.k}`,
      label: f.label,
      note: f.note,
      min: f.min,
      max: f.max,
      step: f.step,
      unit: f.unit,
      get: () => {
        const l = L();
        if (!l) return f.min;
        if (f.k.startsWith('cover')) return l.cover[Number(f.k[5])];
        if (f.k.startsWith('share')) return l.shares[Number(f.k[5])] ?? 0;
        return (l as unknown as Record<string, number>)[f.k];
      },
      set: (v) => {
        // A share that moves with the weather level keeps its shape by level: its row scaled so its mean is the slider's.
        const row = f.k.startsWith('share') ? L()?.levelShares?.[Number(f.k[5])] : null;
        if (row) {
          const mean = row.reduce((s, x) => s + x, 0) / row.length;
          if (mean > 0) return set({ [f.k]: row.map((x) => (x * v) / mean) });
        }
        return set({ [f.k]: v });
      },
    });
  }
  return { title: `Layer ${i}`, note: `The stack's layer ${i} (its name and types in __debug.clouds()). Moving a slider changes this world's layer live; the copied line keeps it.`, dials };
}

let DIALS: DialSet | null = null;

/** The clouds' dials (the layers' sliders, the map's tune), read the first time the menu asks. */
export function cloudDialSet(): DialSet {
  if (!DIALS) {
    const groups: DialGroup[] = [];
    // The stack itself (the fixer's, pass 3 wave 1): a layer added from one of this world's decks at its real height and
    // types, a blank one, or a type at its starts; and the world's start put back.
    groups.push({
      title: 'The stack',
      note: "Add a layer (it goes last; its sliders are the next Layer group) or put this world's start back. A deck starts at its real height with this world's types and covers.",
      dials: [
        { kind: 'choice', key: 'layer.add', label: 'Add a layer', note: "Low, Middle or High deck: a copy of this world's deck; blank: no cover until you give it some; a type: that type at its starts.", choices: ['—', ...ADD_STARTS, ...CLOUD_TYPES], get: () => '—', set: (v: string) => (v === '—' ? [] : editLayer(CLOUD_RUN, { add: v })) },
        { kind: 'choice', key: 'reset', label: "This world's start", note: "Back to this world's starting decks (and the clouds file's layers where it names this world).", choices: ['—', 'put back'], get: () => '—', set: (v: string) => (v === 'put back' ? CLOUD_RUN.setLayers(stackFromFile(CLOUD_RUN.file, [CLOUD_RUN.planetId, CLOUD_RUN.packId], CLOUD_RUN.start, CLOUD_RUN.fileNotes).layers) : []) },
      ],
    });
    for (let i = 0; i < CLOUD_LAYER_MAX; i++) groups.push(layerGroup(i));
    groups.push({
      title: "The map's tune",
      note: 'How the map lays cells and sheets (CLOUD_MAP_TUNE), for every world.',
      dials: (Object.keys(CLOUD_MAP_TUNE) as (keyof CloudMapTune)[]).map((k) => {
        const [min, max] = CLOUD_MAP_TUNE_RANGE[k];
        return { kind: 'number' as const, key: `tune.map.${k}`, label: k, note: `CLOUD_MAP_TUNE.${k}`, min, max, step: max - min > 100 ? 10 : max - min > 10 ? 0.5 : 0.01, unit: '', get: () => CLOUD_MAP_TUNE[k], set: (v: number) => tuneClouds({ map: { [k]: v } }) };
      }),
    });
    // Pass 3, wave 1 (maker V): the march's and the look's sliders (CLOUD_TUNE, CLOUD_LOOK), set through their own setters.
    groups.push(...marchDialGroups());
    DIALS = { helper: 'clouds', groups, shipped: readDials(groups) };
  }
  return DIALS;
}

/** The dials the clouds' helper of `__debug` has, or null (the debug menu's ask as a helper is picked). */
export function cloudDialsFor(helper: string): DialSet | null {
  return helper === 'clouds' ? cloudDialSet() : null;
}

