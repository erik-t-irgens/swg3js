// What the clouds are asked to draw (the volumetrics' seventh wave's second half, the design's §2.18): the sky's own mix
// walked per deck, each picture's own numbers, the wet overcast, the decks' winds, the frames' unwrapped offsets and each
// reader's fold, the pictures' scrolls started from the sky's own, each smear phase's frozen streets, the decks' packs of
// the one wind's gust function, the low deck's eased ground and the holes. Kept records only: every uniform the clouds'
// programs read is an object made here once and held by those programs by reference, written in place each frame.
//
// **Never time × speed** (the September's drift, which raced its deck at twenty times the wind after an hour of play): each
// frame's offset and each picture's scroll is a kept double moved by the frame's `dt` alone and never wrapped; each reader
// is handed it folded at its own period (the base volume's, the detail's, the hole field's, a picture's repeat after the
// streets' stretch), so a wind that changes never moves the field and a fold moves no reader (the design's risks 68, 78).
//
// **The decks read the world's wind whatever `volWind` is**: the weather writes the sheets' wind aloft (`sky.sheetAloft`)
// while `WIND_STATE.decks` says a deck draws, which this sets, and the decks' gusts are the unified wind's own pattern at a
// cloud's scale (`packDecks`), so the ground's readers are today's with the unified wind off and the decks still drift
// and smear (the design's risk 89).
//
// Three only for the uniform objects' types (vectors and colours), so the node tests run the very records the programs
// read. Nothing allocated in a frame.
import * as THREE from 'three';
import { cutForCover, type CoverPoint } from '../../core/fx/cloudMath.ts';
import { AIR_TUNE } from './airTune.ts';
import { CloudHoles, type CloudHull, type CloudJets, type CloudRides } from './airCloudHoles.ts';
import { VOL_TUNE, type VolTune } from './volSettings.ts';
import { WIND_DECK_ASK, WIND_DECK_PACKS, WIND_HOLD, WIND_STATE, WIND_TUNE, packDecks, type WindSky } from '../wind.ts';

const DEG = Math.PI / 180;

/** One image of a deck as the sky groups it (`SwgSky.cloudImages`): what the feed reads of it. */
export interface CloudsSkyImage {
  file: string | null;
  weight: number;
  size: number;
  speed: number;
  repeat: number;
  texture: THREE.Texture | null;
  scrollX: number;
  scrollY: number;
  scrolled: boolean;
}

/** What the feed reads of the sky (`SwgSky`): its mix by deck, the sheets' wind aloft, the dome's uniforms, its light, and the two setters the clouds move. */
export interface CloudsSky extends WindSky {
  cloudImages(slot: 0 | 1, out: { readonly images: readonly [CloudsSkyImage, CloudsSkyImage] }): void;
  readonly sheetAloft: ArrayLike<number>;
  readonly sheetAloftOn: boolean;
  readonly domeUniforms: Readonly<Record<'uGradient' | 'uGradient2' | 'uGradientMix' | 'uTime' | 'uHasGradient' | 'uHasGradient2' | 'uClear', THREE.IUniform>>;
  readonly lighting: { windSpeedScale: number; shadowScale: number; bounce: THREE.Color; bounceScale: number; ambient: THREE.Color; ambientScale: number };
}

/** A picture's own numbers (a world's `clouds.json`, `pictures` 2), held per file at the load. */
export interface CloudPicture {
  /** Its mean alpha (the share of sky a sheet covers), its alpha's spread, its brightness and its alpha-weighted mean colour (sRGB bytes). */
  coverage: number;
  spread: number | null;
  brightness: number;
  colour: readonly [number, number, number] | null;
}

/** What a world's `clouds.json` says of its pictures, by file name (the base name). */
export interface CloudPictures {
  /** Whether the file carries each picture's numbers (`pictures` 2); without them every picture is heaps at its coverage. */
  numbered: boolean;
  readonly tiles: ReadonlyMap<string, CloudPicture>;
}

/** A world's `clouds.json` (format 1, perhaps with `pictures` 2) as the feed's picture table. */
export function cloudPicturesOf(pack: { pictures?: number; tiles?: Record<string, { coverage?: number; spread?: number; brightness?: number; colour?: number[] }> } | null): CloudPictures | null {
  if (!pack || !pack.tiles) return null;
  const numbered = pack.pictures === 2;
  const tiles = new Map<string, CloudPicture>();
  for (const [name, t] of Object.entries(pack.tiles)) {
    const c = Array.isArray(t.colour) && t.colour.length === 3 && t.colour.every((v) => Number.isFinite(v)) ? ([t.colour[0], t.colour[1], t.colour[2]] as const) : null;
    tiles.set(name, {
      coverage: Number.isFinite(t.coverage) ? (t.coverage as number) : 0,
      spread: numbered && Number.isFinite(t.spread) ? (t.spread as number) : null,
      brightness: Number.isFinite(t.brightness) ? (t.brightness as number) : 1,
      colour: numbered ? c : null,
    });
  }
  return { numbered, tiles };
}

/** A picture's base name from the path a row names. */
function baseName(file: string): string {
  const i = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  return i >= 0 ? file.slice(i + 1) : file;
}

/** A picture's kind from its numbers: 1 a layer, 0 heaps (`clouds.kindFrom`, `kindTo`); heaps where the file has none. */
export function layeredOfPicture(p: CloudPicture | null | undefined): number {
  if (!p || p.spread === null) return 0;
  const C = AIR_TUNE.clouds;
  const cov = p.spread / Math.max(p.coverage, 1e-3);
  const span = C.kindTo - C.kindFrom;
  const t = 1 - (cov - C.kindFrom) / (Math.abs(span) > 1e-6 ? span : 1e-6);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** The wet overcast from the weather's own numbers: rain, snow, or a sunless row that is not a dust storm (the design's §2.18). */
export function wetOvercast(rain: number, snow: number, shadowScale: number, dust: number): number {
  const sunless = (1 - shadowScale) * (1 - dust);
  const m = rain > snow ? rain : snow;
  const o = m > sunless ? m : sunless;
  return o < 0 ? 0 : o > 1 ? 1 : o;
}

/** A double folded into [0, period). */
export function foldAt(v: number, period: number): number {
  return v - period * Math.floor(v / period);
}

/**
 * The stretched picture coordinate the weather pass draws a street with (`streetUv` in its text): a metre vector `x`
 * along a frozen heading (sin h, cos h) divided by the stretch `s`, across it kept, as metres. The feed works a scroll out
 * through this in double before it folds it at the repeat, since a fold of a stretched coordinate is a whole repeat only
 * along an axis.
 */
export function streetOf(x: number, z: number, sh: number, ch: number, inv: number, out: { x: number; z: number }): void {
  const a = (x * sh + z * ch) * inv;
  const c = x * ch - z * sh;
  out.x = sh * a + ch * c;
  out.z = ch * a - sh * c;
}

/** A picture's scroll, kept: metres, started from the sky's own when the deck first takes it, never wrapped. */
class PictureScroll {
  x = 0.5;
  z = 0.5;
  /** The frame the record last moved, so a picture two images name moves once. */
  at = -1;
}

/** A pair of doubles a fold or a stretch answers in (a class: its doubles in place). */
class XZ {
  x = 0.5;
  z = 0.5;
}

/** What the game hands the feed each frame (a kept record the world writes). */
export class CloudsFeedInput {
  dt = 0.5;
  simulate = false;
  camX = 0.5;
  camY = 0.5;
  camZ = 0.5;
  /** The weather's own numbers: what falls, the dust, the heading, the clock its wind was worked out at, whether it is on. */
  rain = 0.5;
  snow = 0.5;
  dust = 0.5;
  heading = 0.5;
  windClock = 0.5;
  weatherOn = false;
  /** The world's travel speed aloft (`WIND_FRAME.travel`), m/s. */
  travel = 0.5;
  space = false;
  inside = false;
  sky: CloudsSky | null = null;
  pictures: CloudPictures | null = null;
  hulls: readonly CloudHull[] = [];
  rides: CloudRides | null = null;
  jets: CloudJets | null = null;
  /** The cached ground under a point the feed writes into the record it hands, or null (never a generation). */
  groundAt: ((q: { readonly x: number; readonly z: number }) => number | null) | null = null;
  /** The console's: the low deck held on (true), off (false) or as the weather says (null). */
  lowForce: boolean | null = null;
  constructor() {
    this.dt = 0;
  }
}

/** The kept uniform objects every one of the clouds' programs holds by reference. */
function v4(x = 0, y = 0, z = 0, w = 0): { value: THREE.Vector4 } {
  return { value: new THREE.Vector4(x, y, z, w) };
}

/**
 * The feed: one a session, made the first time the clouds' pass asks for it (`cloudsFeed`), never with the master off.
 */
export class AirCloudsFeed {
  readonly input = new CloudsFeedInput();
  readonly holes = new CloudHoles();
  /** The decks' two images each, as the sky groups them. */
  readonly bottom = { images: [new PictureImage(), new PictureImage()] as const };
  readonly top = { images: [new PictureImage(), new PictureImage()] as const };
  /** The pictures each image binds (bottom 0, 1, top 0, 1), null where none is loaded; the pass binds a stand-in for null and lets go after each draw. */
  readonly pictures: (THREE.Texture | null)[] = [null, null, null, null];

  // ------------------------------------------------------------------ the weather pass's uniforms
  readonly weatherU = {
    uWin: v4(0, 0, 52000, 100),
    uImgB0: v4(),
    uImgB1: v4(),
    uImgT0: v4(),
    uImgT1: v4(),
    uScrB0: v4(),
    uScrB1: v4(),
    uScrT0: v4(),
    uScrT1: v4(),
    uStrBA: v4(0, 1, 1, 0),
    uStrBB: v4(0, 1, 1, 0),
    uStrTA: v4(0, 1, 1, 0),
    uStrTB: v4(0, 1, 1, 0),
    uDeckU: v4(),
    uSlabU: v4(),
    uSmearW: v4(),
    uLook: v4(1.5, 0.9, 0.15, 1),
    uOver: v4(),
    uCover: { value: new Float32Array(32) },
    uCoverN: { value: 0 },
    uWind7: { value: WIND_DECK_PACKS.high },
  };
  // ------------------------------------------------------------------ the low deck's wind pass
  readonly lowWindU = {
    uLowW: v4(0, 0, 8000, 0),
    uLowU: v4(),
    uWind7: { value: WIND_DECK_PACKS.low },
  };
  // ------------------------------------------------------------------ the hole tick
  readonly holeU = {
    uH: { value: new Float32Array(4) },
    uSqL: { value: new Float32Array(4) },
    uSqH: { value: new Float32Array(4) },
    uMove: { value: new Float32Array(4) },
    uCap: { value: new Float32Array(64 * 4) },
  };
  // ------------------------------------------------------------------ the march's
  readonly marchU = {
    uHigh: v4(1500, 2300, 48, 4),
    uLow: v4(200, 380, 0, 6000),
    uLowP: v4(1, 0.33, 20, 0),
    uLowW: this.lowWindU.uLowW,
    uWin: this.weatherU.uWin,
    uDriftH: v4(),
    uDriftL: v4(),
    uHoleOff: v4(),
    uHoleP: v4(1024, 32, 1.2, 0.2),
    uHoleOn: v4(),
    uFineL: { value: new Float32Array([1, 1, -1, -1]) },
    uFineH: { value: new Float32Array([1, 1, -1, -1]) },
    uFineP: v4(0, 0, 32, 4),
    uKind: v4(0, 0, 1, 0),
    uErode: v4(),
    uDens: v4(),
    uPhase: v4(),
    uMs: v4(),
    uAmb: v4(),
    uNear: v4(),
    uScale: v4(4200, 260, 0.3, 26000),
    uSmear: v4(),
    uSmear2: v4(),
    uAlbLo: { value: new THREE.Vector3(1, 1, 1) },
    uAlbHi: { value: new THREE.Vector3(1, 1, 1) },
    uAlbLow: { value: new THREE.Vector3(1, 1, 1) },
    uBounce: { value: new THREE.Color(0.2, 0.2, 0.2) },
    uAmbient: { value: new THREE.Color(0.3, 0.3, 0.35) },
  };
  /** The low deck's cover curve, (cut, sky) pairs, and its length (the worker's, else the manifest's). */
  readonly lowCover = new Float32Array(32);
  lowCoverN = 0;

  // ------------------------------------------------------------------ state, doubles kept
  /** The high slab's frame offset and the low deck's, metres, unwrapped (a world point p is the frame's p + D). */
  dhx = 0.5;
  dhz = 0.5;
  dlx = 0.5;
  dlz = 0.5;
  /** The smear's clock, seconds. */
  smearT = 0.5;
  /** Each smear phase's age at its last restart check (a restart is the age wrapping). */
  private ageA = 0.5;
  private ageB = 0.5;
  /** The low deck's eased ground, metres, and whether it has one yet. */
  ground = 0.5;
  private groundSeen = false;
  private groundAsk = 0.5;
  /** The wet overcast, the low deck's cover, and each deck's coverage this frame (the console's and the refusal's). */
  overcast = 0.5;
  low = 0.5;
  coverBottom = 0.5;
  coverTop = 0.5;
  /** Each deck's presence (the images' summed weight), and its overcast's. */
  presBottom = 0.5;
  presTop = 0.5;
  /** Why nothing is drawn, from the sky's side (no sky, a dust storm, nothing to draw), or null. */
  why: string | null = 'no sky yet';
  /** The noise volumes and their manifest's curve, once fetched (the warm's, `setNoise`), and whether they are on the card yet (`AirCloudsPass.uploadNoise`, in the warm, never on a live frame). */
  base: THREE.Data3DTexture | null = null;
  detail: THREE.Data3DTexture | null = null;
  noiseUploaded = false;
  /** The milliseconds the upload took, for the notes. */
  uploadMs = 0;
  /** The high deck's curve as the manifest measured it, and the billow's top (a cut at or past it is empty sky). */
  private manifestCover: readonly CoverPoint[] = [];
  billowTop = 0.898;
  /** Where each deck's curve came from: the manifest's, or the worker's (when it was taken, `performance.now()`, and how long its job took, ms). */
  calibration = { high: 'manifest', low: 'manifest', at: 0, ms: 0 };
  /** The frame number, so a picture two images name moves once a frame. */
  private frame = 0;
  /** Each picture's scroll, kept by file. */
  private readonly scrolls = new Map<string, PictureScroll>();
  private readonly tmp = new XZ();

  constructor() {
    this.cutQuery = { coverage: 0.5, pairs: this.lowCover, n: 0, cut: 0.5 };
    this.smearT = 0;
    this.ageA = 0;
    this.ageB = 0;
    this.dhx = 0;
    this.dhz = 0;
    this.dlx = 0;
    this.dlz = 0;
  }

  /** The noise volumes and the manifest's calibration (`loadCloudVolumes`), handed over by the warm once uploaded. */
  setNoise(base: THREE.Data3DTexture, detail: THREE.Data3DTexture, cover: readonly CoverPoint[], billowTop: number): void {
    this.base = base;
    this.detail = detail;
    this.manifestCover = cover;
    if (Number.isFinite(billowTop) && billowTop > 0) this.billowTop = billowTop;
    writeCurve(this.weatherU.uCover.value, cover);
    this.weatherU.uCoverN.value = Math.min(cover.length, 16);
    if (this.calibration.low === 'manifest') {
      writeCurve(this.lowCover, cover);
      this.lowCoverN = Math.min(cover.length, 16);
    }
  }

  /**
   * A curve the calibration worker measured: the high deck's (the tuned march's) or the low deck's, `ms` the milliseconds
   * the job took. `calibration.at` is when it was taken (`performance.now()`), `calibration.ms` how long it took.
   */
  setCurve(which: 'high' | 'low', cover: readonly CoverPoint[], ms: number): void {
    if (cover.length < 2) return;
    if (which === 'high') {
      writeCurve(this.weatherU.uCover.value, cover);
      this.weatherU.uCoverN.value = Math.min(cover.length, 16);
    } else {
      writeCurve(this.lowCover, cover);
      this.lowCoverN = Math.min(cover.length, 16);
    }
    this.calibration[which] = 'worker';
    this.calibration.at = typeof performance !== 'undefined' ? performance.now() : 0;
    this.calibration.ms = ms;
  }

  /**
   * One answer of the calibration worker: each curve taken only when no newer ask has spoken for its deck since (the
   * worker runs each ask as a job of its own, so a later ask can answer first, and a deck put back at the manifest's own
   * march counts as asked then), so an older curve never stands over a newer one.
   */
  takeCalibration(a: { id: number; curves: readonly { which: 'high' | 'low'; cover: CoverPoint[] }[]; ms: number; error?: string }): void {
    if (a.error) console.info(`clouds: the calibration worker could not measure (${a.error}); the manifest's curve stands`);
    for (const c of a.curves) {
      const asked = c.which === 'high' ? this.askedHigh : this.askedLow;
      if (!(a.id >= asked)) continue;
      this.setCurve(c.which, c.cover, a.ms);
    }
  }
  /** The newest ask that spoke for each deck's curve, set as it is posted (an answer of an older one is dropped). */
  private askedHigh = 0;
  private askedLow = 0;

  // ------------------------------------------------------------------ the calibration worker
  private worker: Worker | null = null;
  private workerAsk = 0;
  private noiseFiles: { baseUrl: string; detailUrl: string; baseSize: number; detailSize: number } | null = null;
  /** The numbers a deck's curve depends on, as last asked of the worker (NaN: never). */
  private readonly calAsked = new Float64Array(10).fill(Number.NaN);
  private readonly calNow = new Float64Array(10);
  /** Seconds the numbers have stood still since they last moved (a dial dragged asks once it rests). */
  private calStill = 0.5;

  /**
   * The calibration worker started (the warm's: never on the main thread, never with the master off), with the noise
   * volumes' addresses: the low deck's curve asked at once, the high deck's whenever a number it depends on moves off the
   * manifest's (`calibrateCheck`). Until it answers the manifest's curve stands for both.
   */
  startCalibration(files: { baseUrl: string; detailUrl: string; baseSize: number; detailSize: number }): void {
    this.noiseFiles = files;
    if (this.worker || typeof Worker === 'undefined') return;
    try {
      this.worker = new Worker(new URL('./cloudCalibrate.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      this.worker = null;
      return;
    }
    this.worker.onmessage = (e: MessageEvent<{ id: number; curves: { which: 'high' | 'low'; cover: CoverPoint[] }[]; ms: number; error?: string }>) => this.takeCalibration(e.data);
    this.calAsked.fill(Number.NaN);
    this.calibrateCheck(1);
  }

  /** Whether the calibration worker has been started (the off-proof: never with the master off). */
  get calibrating(): boolean {
    return this.worker !== null;
  }

  /**
   * Once a frame: the numbers a curve depends on against those last asked; moved and then still for half a second, the
   * worker is asked again (the high deck only where they differ from the manifest's own march). Nothing allocated unless
   * a job is posted.
   */
  calibrateCheck(dt: number): void {
    this.calDt = dt;
    this.calibrateNow();
  }
  /** The step `calibrateNow` counts the stillness by (a field, so no number is handed across a call in a frame). */
  private calDt = 0.5;
  private calibrateNow(): void {
    const dt = this.calDt;
    if (!this.worker || !this.noiseFiles) return;
    const C = AIR_TUNE.clouds;
    const LD = AIR_TUNE.lowDeck;
    const n = this.calNow;
    n[0] = C.density;
    n[1] = C.detailBite;
    n[2] = C.erodeBite;
    n[3] = C.feather;
    n[4] = C.baseScale;
    n[5] = C.detailScale;
    n[6] = C.bottom;
    n[7] = C.top;
    n[8] = LD.scale;
    n[9] = LD.depth;
    let same = true;
    for (let i = 0; i < 10; i++) if (!(n[i] === this.calAsked[i])) same = false;
    if (same) return;
    this.calStill += dt;
    if (this.calStill < 0.5) return;
    this.calStill = 0;
    const lowOnly = !(this.calAsked[0] === this.calAsked[0]);
    this.calAsked.set(n);
    const id = ++this.workerAsk;
    const M = { steps: 64, density: C.density, detailBite: C.detailBite, erodeBite: C.erodeBite, feather: C.feather };
    const jobs: { which: 'high' | 'low'; march: Record<string, number>; decks: number }[] = [];
    const manifestMarch = C.density === 0.055 && C.detailBite === 0.32 && C.erodeBite === 0.35 && C.feather === 0.22 && C.baseScale === 4200 && C.detailScale === 260 && C.bottom === 1500 && C.top === 2300;
    if (!lowOnly || !manifestMarch) {
      if (!manifestMarch) {
        jobs.push({ which: 'high', march: { ...M, bottom: C.bottom, top: C.top, baseScale: C.baseScale, detailScale: C.detailScale }, decks: 2 });
        this.askedHigh = id;
      } else if (this.calibration.high === 'worker' || this.askedHigh > 0) {
        // Back at the manifest's own march: its curve again, with no worker needed, and a high curve still on its way from
        // an older ask dropped when it lands.
        writeCurve(this.weatherU.uCover.value, this.manifestCover);
        this.weatherU.uCoverN.value = Math.min(this.manifestCover.length, 16);
        this.calibration.high = 'manifest';
        this.askedHigh = id;
      }
    }
    jobs.push({ which: 'low', march: { ...M, steps: 32, bottom: 0, top: LD.depth > 1 ? LD.depth : 1, baseScale: C.baseScale * LD.scale, detailScale: C.detailScale * LD.scale }, decks: 1 });
    this.askedLow = id;
    const f = this.noiseFiles;
    this.worker.postMessage({ id, baseUrl: f.baseUrl, detailUrl: f.detailUrl, baseSize: f.baseSize, detailSize: f.detailSize, rays: 32, jobs });
  }

  /** The worker let go (the master off for good is not a reason: it is kept for the session, idle). */
  stopCalibration(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  /** Everything this world drew let go (an arrival, a travel): the holes, the scrolls, the ground, the pictures. */
  reset(): void {
    this.holes.reset();
    this.scrolls.clear();
    this.groundSeen = false;
    for (let i = 0; i < 4; i++) this.pictures[i] = null;
    for (const im of this.bottom.images) im.texture = null;
    for (const im of this.top.images) im.texture = null;
  }

  /** The borrowed pictures let go (`World.unload`, before the sky that owns them is disposed). */
  letGoPictures(): void {
    for (let i = 0; i < 4; i++) this.pictures[i] = null;
    for (const im of this.bottom.images) im.texture = null;
    for (const im of this.top.images) im.texture = null;
  }

  /**
   * A frame: the mix walked, the decks' numbers, winds, offsets, phases and packs, the low deck and the holes, every
   * uniform written in place. `WIND_STATE.decks` set (the weather drives the sheets at the wind aloft the next frame).
   *
   * **Nothing allocated, and no number handed across a call**: a call the compiler does not build in boxes every double it
   * is handed or hands back (the volumetrics' lesson), and this frame is long, so it is a list of small parts each reading
   * and writing the feed's own kept doubles, every vector written by its components, and a picture's numbers found once a
   * file (`numbersOf`, whose base name is the one string a file ever makes).
   */
  update(t: VolTune = VOL_TUNE): void {
    const I = this.input;
    this.frame++;
    WIND_STATE.decks = true;
    this.dtNow = I.dt > 0 && I.dt < 1 ? I.dt : 0;
    this.calDt = this.dtNow;
    this.calibrateNow();
    const sky = I.sky;
    if (!sky) {
      this.why = 'no sky';
      return;
    }
    // The mix by deck, as the sheets group it.
    sky.cloudImages(0, this.bottom);
    sky.cloudImages(1, this.top);
    this.stepWinds(t);
    this.stepOffsets();
    this.stepSmear(t);
    // The pictures: each image's numbers, presence and scroll (started from the sky's own, moved by the sheets' rule).
    this.writeDeck(this.bottom, 0);
    this.writeDeck(this.top, 1);
    this.stepWeather(t);
    this.stepCover(t);
    this.stepMarch(t);
    // The low deck: when, where, its cut and its wind window.
    this.stepLow(t);
    this.stepHoles(t);
    this.stepWhy();
  }
  /** This frame's step, seconds (nought for a step of nothing). */
  private dtNow = 0.5;
  /** The decks' headings (sin, cos: the bottom's, the top's veered, the slab's half veered) and winds, m/s, this frame. */
  private sB = 0.5;
  private cB = 0.5;
  private sT = 0.5;
  private cT = 0.5;
  private vbNow = 0.5;
  private vtNow = 0.5;
  /** The wet overcast's cover this frame, and each deck's share of it where its rows hang no picture. */
  private ocNow = 0.5;
  private poB = 0.5;
  private poT = 0.5;
  /** Whether the smear runs this frame (its switch on and the decks' packs written). */
  smearing = false;

  /**
   * The winds: each deck's the sheets' wind aloft along the weather's heading (the top's veered), the slab's one frame
   * their mean along half the veer, the low deck's the world's travel times its own factor, floored unless held; and the
   * decks' packs of the one wind's gust function, at a cloud's scale: the smear runs only where they were packed (a world
   * the weather has not attached has no pattern, and an unpacked lattice reads as no gust at all, never as nought).
   */
  private stepWinds(t: VolTune): void {
    const I = this.input;
    const sky = I.sky!;
    const C = AIR_TUNE.clouds;
    const LD = AIR_TUNE.lowDeck;
    const A = WIND_TUNE.aloft;
    const h = I.heading;
    const sa = sky.sheetAloft;
    const on = sky.sheetAloftOn;
    const hs = WIND_HOLD.speed;
    const fb = I.travel * A.bottom;
    const ft = I.travel * A.top;
    const fl = I.travel * A.low;
    const vb = on ? sa[0] : hs !== null ? hs * A.bottom : fb > A.floor ? fb : A.floor;
    const vt = on ? sa[1] : hs !== null ? hs * A.top : ft > A.floor ? ft : A.floor;
    const veer = on ? sa[2] : A.veerTop * DEG;
    const vl = hs !== null ? hs * A.low : fl > A.floor ? fl : A.floor;
    this.sB = Math.sin(h);
    this.cB = Math.cos(h);
    this.sT = Math.sin(h + veer);
    this.cT = Math.cos(h + veer);
    this.vbNow = vb;
    this.vtNow = vt;
    const vm = 0.5 * (vb + vt);
    const du = this.weatherU.uDeckU.value;
    du.x = this.sB * vb;
    du.y = this.cB * vb;
    du.z = this.sT * vt;
    du.w = this.cT * vt;
    let smear = false;
    if (t.cloudsSmear) {
      const D = WIND_DECK_ASK;
      D.t = I.windClock;
      D.highScale = C.gustScale;
      D.highShare = 0.5 * (A.bottom + A.top);
      D.lowScale = LD.gustScale;
      D.lowShare = A.low;
      smear = packDecks(sky);
    }
    this.smearing = smear;
    const su = this.weatherU.uSlabU.value;
    su.x = Math.sin(h + 0.5 * veer) * vm;
    su.y = Math.cos(h + 0.5 * veer) * vm;
    su.z = smear ? 1 : 0;
    const lu = this.lowWindU.uLowU.value;
    lu.x = this.sB * vl;
    lu.y = this.cB * vl;
  }

  /**
   * The frames' offsets, integrated by `dt` alone and never wrapped (a feature moves downwind as the offset falls), and
   * each reader its own fold: the base volume's and the detail's periods for each frame, the hole field's size.
   */
  private stepOffsets(): void {
    const C = AIR_TUNE.clouds;
    const LD = AIR_TUNE.lowDeck;
    const dt = this.dtNow;
    const su = this.weatherU.uSlabU.value;
    const lu = this.lowWindU.uLowU.value;
    this.dhx -= su.x * dt;
    this.dhz -= su.y * dt;
    this.dlx -= lu.x * dt;
    this.dlz -= lu.y * dt;
    const bs = C.baseScale > 1 ? C.baseScale : 1;
    const ds = C.detailScale > 1 ? C.detailScale : 1;
    const ls = LD.scale > 1e-3 ? LD.scale : 1e-3;
    const hs = AIR_TUNE.holes.size;
    const bl = bs * ls;
    const dl = ds * ls;
    const hx = this.dhx;
    const hz = this.dhz;
    const lx = this.dlx;
    const lz = this.dlz;
    const dh = this.marchU.uDriftH.value;
    dh.x = hx - bs * Math.floor(hx / bs);
    dh.y = hz - bs * Math.floor(hz / bs);
    dh.z = hx - ds * Math.floor(hx / ds);
    dh.w = hz - ds * Math.floor(hz / ds);
    const dlv = this.marchU.uDriftL.value;
    dlv.x = lx - bl * Math.floor(lx / bl);
    dlv.y = lz - bl * Math.floor(lz / bl);
    dlv.z = lx - dl * Math.floor(lx / dl);
    dlv.w = lz - dl * Math.floor(lz / dl);
    const ho = this.marchU.uHoleOff.value;
    ho.x = lx - hs * Math.floor(lx / hs);
    ho.y = lz - hs * Math.floor(lz / hs);
    ho.z = hx - hs * Math.floor(hx / hs);
    ho.w = hz - hs * Math.floor(hz / hs);
  }

  /** The smear's two phases half a period apart, cross-faded by a triangle; each freezes its streets at its restart. */
  private stepSmear(t: VolTune): void {
    const C = AIR_TUNE.clouds;
    const LD = AIR_TUNE.lowDeck;
    const P = C.smearPeriod > 1 ? C.smearPeriod : 1;
    this.smearT += this.dtNow;
    const a = this.smearT;
    const b = this.smearT + 0.5 * P;
    const fa = a - P * Math.floor(a / P);
    const fb = b - P * Math.floor(b / P);
    const restartA = fa < this.ageA;
    const restartB = fb < this.ageB;
    this.ageA = fa;
    this.ageB = fb;
    if (restartA || this.frame === 1) this.freezeStreets(0);
    if (restartB || this.frame === 1) this.freezeStreets(1);
    const tri = (2 * fa) / P - 1;
    const wA = 1 - (tri < 0 ? -tri : tri);
    const share = C.smearShare;
    const sw = this.weatherU.uSmearW.value;
    sw.x = fa * share;
    sw.y = fb * share;
    sw.z = wA;
    sw.w = C.smearMost;
    const sm = this.marchU.uSmear.value;
    sm.x = this.smearing && t.cloudsSmear ? 1 : 0;
    sm.y = fa * share;
    sm.z = fb * share;
    sm.w = wA;
    const s2 = this.marchU.uSmear2.value;
    s2.x = C.detailSmearMost;
    s2.y = LD.smearMost;
    s2.z = C.stepGrow;
    s2.w = C.stepMost;
  }

  /** The weather window: the square round the camera, snapped to whole texels, and a texel's metres for a picture's level. */
  private stepWeather(t: VolTune): void {
    const I = this.input;
    const C = AIR_TUNE.clouds;
    const res = t.cloudsWeather > 1 ? t.cloudsWeather : 512;
    const sq = C.weatherSquare > 1 ? C.weatherSquare : 52000;
    const tx = sq / res;
    const wv = this.weatherU.uWin.value;
    wv.x = Math.floor((I.camX - 0.5 * sq) / tx) * tx;
    wv.y = Math.floor((I.camZ - 0.5 * sq) / tx) * tx;
    wv.z = sq;
    wv.w = this.billowTop;
    this.weatherU.uSlabU.value.w = tx;
    const lk = this.weatherU.uLook.value;
    lk.x = C.gain;
    lk.y = C.extent;
    lk.z = C.thin;
    lk.w = t.cloudsArt;
  }

  /**
   * The wet overcast and each deck's presence, coverage, kind and albedo (the slab draws two decks where the top has
   * anything), and the overcast's and the low deck's albedo.
   */
  private stepCover(t: VolTune): void {
    const I = this.input;
    const C = AIR_TUNE.clouds;
    const sky = I.sky!;
    // The wet overcast from the weather's own numbers (`wetOvercast`, written out): rain, snow, or a sunless row that is
    // not a dust storm.
    if (I.weatherOn) {
      const sunless = (1 - sky.lighting.shadowScale) * (1 - I.dust);
      const m = I.rain > I.snow ? I.rain : I.snow;
      const o = m > sunless ? m : sunless;
      this.overcast = o < 0 ? 0 : o > 1 ? 1 : o;
    } else this.overcast = 0;
    const bi = this.bottom.images;
    const ti = this.top.images;
    this.presBottom = (bi[0].texture ? bi[0].weight : 0) + (bi[1].texture ? bi[1].weight : 0);
    this.presTop = (ti[0].texture ? ti[0].weight : 0) + (ti[1].texture ? ti[1].weight : 0);
    const oc = this.overcast * C.overcastCover;
    this.ocNow = oc;
    const pb = 1 - (this.presBottom < 1 ? this.presBottom : 1);
    const pt = 1 - (this.presTop < 1 ? this.presTop : 1);
    this.poB = oc > 0 && pb > 0 ? pb : 0;
    this.poT = oc > 0 && pt > 0 ? pt : 0;
    const ov = this.weatherU.uOver.value;
    ov.x = oc;
    ov.y = C.overcastThick;
    ov.z = this.poB;
    ov.w = this.poT;
    // Each deck's coverage, kind and albedo, for the march, the refusal and the console.
    this.deckCover(0);
    this.deckCover(1);
    this.deckLayered(0);
    this.deckLayered(1);
    const kd = this.marchU.uKind.value;
    kd.x *= t.cloudsArt;
    kd.y *= t.cloudsArt;
    kd.z = this.presTop + this.poT > 0.002 ? 2 : 1;
    this.deckAlbedo(0);
    this.deckAlbedo(1);
    // The overcast's and the low deck's albedo: `mix(1, overcastBright / albedoRef, artBright · art)`, written out.
    const ref = C.albedoRef > 1e-3 ? C.albedoRef : 1e-3;
    const ob = 1 + (C.overcastBright / ref - 1) * C.artBright * t.cloudsArt;
    const al = this.marchU.uAlbLow.value;
    al.x = ob;
    al.y = ob;
    al.z = ob;
  }

  /** The march's numbers, and the sky's bounce and ambient, by their components. */
  private stepMarch(t: VolTune): void {
    const C = AIR_TUNE.clouds;
    const LD = AIR_TUNE.lowDeck;
    const M = this.marchU;
    const hi = M.uHigh.value;
    hi.x = C.bottom;
    hi.y = C.top;
    hi.z = t.cloudsSteps;
    hi.w = t.cloudsLight;
    const er = M.uErode.value;
    er.x = C.erodeBite;
    er.y = C.detailBite;
    er.z = C.layerDepth;
    er.w = C.layerErode;
    const de = M.uDens.value;
    de.x = C.density;
    de.y = C.lightDensity;
    de.z = C.powder;
    de.w = C.feather;
    const ph = M.uPhase.value;
    ph.x = C.gForward;
    ph.y = C.gBackward;
    ph.z = C.gMix;
    ph.w = C.octaves;
    const ms = M.uMs.value;
    ms.x = C.msA;
    ms.y = C.msB;
    ms.z = C.msC;
    ms.w = C.skyAmbient;
    const am = M.uAmb.value;
    am.x = C.ambientTop;
    am.y = C.ambientBottom;
    am.z = C.haze;
    am.w = t.cloudsBright;
    const near = M.uNear.value;
    near.x = C.nearFrom < C.nearTo ? C.nearFrom : C.nearTo;
    near.y = C.nearTo;
    near.z = t.cloudsAmount;
    const sc = M.uScale.value;
    sc.x = C.baseScale > 1 ? C.baseScale : 1;
    sc.y = C.detailScale > 1 ? C.detailScale : 1;
    sc.z = LD.scale > 1e-3 ? LD.scale : 1e-3;
    sc.w = C.reach;
    const L = this.input.sky!.lighting;
    const bo = M.uBounce.value as THREE.Color;
    bo.r = L.bounce.r * L.bounceScale;
    bo.g = L.bounce.g * L.bounceScale;
    bo.b = L.bounce.b * L.bounceScale;
    const ab = M.uAmbient.value as THREE.Color;
    ab.r = L.ambient.r * L.ambientScale;
    ab.g = L.ambient.g * L.ambientScale;
    ab.b = L.ambient.b * L.ambientScale;
  }

  /** The holes: the decks' bands and frames, the hulls walked on the tick, the live boxes and the fine steps. */
  private stepHoles(t: VolTune): void {
    const I = this.input;
    const C = AIR_TUNE.clouds;
    const H = AIR_TUNE.holes;
    const M = this.marchU;
    const holes = this.holes;
    holes.camX = I.camX;
    holes.camZ = I.camZ;
    holes.low.on = t.cloudsLow && t.cloudsHoles && this.low > 0;
    holes.low.bottom = M.uLow.value.x;
    holes.low.top = M.uLow.value.y;
    holes.low.dx = this.dlx;
    holes.low.dz = this.dlz;
    holes.high.on = t.cloudsHoles && this.coverBottom + this.coverTop > C.minCoverage;
    holes.high.bottom = C.bottom;
    holes.high.top = C.top;
    holes.high.dx = this.dhx;
    holes.high.dz = this.dhz;
    if (I.simulate) {
      holes.dtIn = this.dtNow;
      holes.stepKept(I.hulls, I.rides, I.jets);
    }
    holes.liveBoxes(M.uFineL.value, M.uFineH.value, this.fineSteps);
    const fp = M.uFineP.value;
    fp.x = this.fineSteps[0];
    fp.y = this.fineSteps[1];
    fp.z = H.fineMost;
    fp.w = H.fineLight;
    const hp = M.uHoleP.value;
    hp.x = H.size;
    hp.y = H.edge;
    hp.z = H.edgeLift;
    hp.w = H.edgeSoft > 0.02 ? H.edgeSoft : 0.02;
    const ho = M.uHoleOn.value;
    ho.x = holes.low.on ? 1 : 0;
    ho.y = holes.high.on ? 1 : 0;
    ho.z = 0;
    ho.w = 0;
  }

  /** Why nothing is drawn, from the sky's side, or null. */
  private stepWhy(): void {
    const I = this.input;
    const C = AIR_TUNE.clouds;
    this.why =
      I.space ? 'in space there is no sky to put cloud in'
      : I.weatherOn && I.dust > C.standDownDust ? 'a dust storm has the sky (the dust stands the decks down)'
      : this.coverBottom < C.minCoverage && this.coverTop < C.minCoverage && !(this.low > 0) ? "this sky has nothing to draw (both decks under the least coverage and no low deck)"
      : null;
  }
  private readonly fineSteps = new Float32Array(2);

  /** Phase `ph`'s streets frozen at its restart: each deck's heading and its stretch by its wind. */
  private freezeStreets(ph: number): void {
    const C = AIR_TUNE.clouds;
    const most = C.stretchMost > 1 ? C.stretchMost : 1;
    const vb = this.vbNow < 0 ? -this.vbNow : this.vbNow;
    const vt = this.vtNow < 0 ? -this.vtNow : this.vtNow;
    const b = 1 + C.stretch * vb;
    const tt = 1 + C.stretch * vt;
    const sB = b < most ? b : most;
    const sT = tt < most ? tt : most;
    const U = this.weatherU;
    const bv = (ph === 0 ? U.uStrBA : U.uStrBB).value;
    bv.x = this.sB;
    bv.y = this.cB;
    bv.z = 1 / sB;
    bv.w = 0;
    const tv = (ph === 0 ? U.uStrTA : U.uStrTB).value;
    tv.x = this.sT;
    tv.y = this.cT;
    tv.z = 1 / sT;
    tv.w = 0;
  }

  /**
   * A picture's own numbers by its file as the row names it, or null: looked up by base name once a file (the one string
   * a file ever makes), the table kept for the pictures' table in force.
   */
  private numbersOf(file: string): CloudPicture | null {
    const pics = this.input.pictures;
    if (pics !== this.numbersFor) {
      this.numbers.clear();
      this.numbersFor = pics;
    }
    const got = this.numbers.get(file);
    if (got !== undefined) return got;
    const p = pics ? (pics.tiles.get(baseName(file)) ?? null) : null;
    this.numbers.set(file, p);
    return p;
  }
  private readonly numbers = new Map<string, CloudPicture | null>();
  private numbersFor: CloudPictures | null = null;

  /**
   * One deck's two images into the weather pass's uniforms: each one's repeat, weight while its picture is loaded (nought
   * while it loads: never the white stand-in a sheet binds), mean alpha and kind; its scroll moved by the sheets' rule and
   * handed through each phase's frozen streets folded at the repeat (the street worked out in double, written out as
   * `streetOf` is, since a fold of a stretched coordinate is a whole repeat only along an axis).
   */
  private writeDeck(deck: { readonly images: readonly [PictureImage, PictureImage] }, slot: number): void {
    const U = this.weatherU;
    const s = slot === 0 ? this.sB : this.sT;
    const c = slot === 0 ? this.cB : this.cT;
    const v = slot === 0 ? this.vbNow : this.vtNow;
    const dt = this.dtNow;
    for (let m = 0; m < 2; m++) {
      const im = deck.images[m];
      const img = (slot === 0 ? (m === 0 ? U.uImgB0 : U.uImgB1) : m === 0 ? U.uImgT0 : U.uImgT1).value;
      const scr = (slot === 0 ? (m === 0 ? U.uScrB0 : U.uScrB1) : m === 0 ? U.uScrT0 : U.uScrT1).value;
      this.pictures[slot * 2 + m] = im.texture;
      const file = im.file;
      if (!file || !im.texture) {
        img.x = 1;
        img.y = 0;
        img.z = 0;
        img.w = 0;
        continue;
      }
      const numbers = this.numbersOf(file);
      img.x = im.repeat;
      img.y = im.weight;
      img.z = numbers ? numbers.coverage : 0;
      img.w = layeredOfPicture(numbers);
      // The scroll in metres: started from the sky's own when this picture is first taken, then moved as the sheets move
      // while a deck draws (the wind aloft along this deck's heading), once a frame however many images name it.
      let sc = this.scrolls.get(file);
      if (!sc) {
        sc = new PictureScroll();
        sc.x = im.scrolled ? im.scrollX * im.repeat : 0;
        sc.z = im.scrolled ? im.scrollY * im.repeat : 0;
        sc.at = this.frame;
        this.scrolls.set(file, sc);
      } else if (sc.at !== this.frame) {
        sc.at = this.frame;
        sc.x -= s * v * dt;
        sc.z -= c * v * dt;
      }
      // Each phase's streets, stretched in double and folded at the repeat.
      const stA = (slot === 0 ? U.uStrBA : U.uStrTA).value;
      const stB = (slot === 0 ? U.uStrBB : U.uStrTB).value;
      const r = im.repeat > 1e-3 ? im.repeat : 1e-3;
      const aA = (sc.x * stA.x + sc.z * stA.y) * stA.z;
      const cA = sc.x * stA.y - sc.z * stA.x;
      const xA = (stA.x * aA + stA.y * cA) / r;
      const zA = (stA.y * aA - stA.x * cA) / r;
      const aB = (sc.x * stB.x + sc.z * stB.y) * stB.z;
      const cB = sc.x * stB.y - sc.z * stB.x;
      const xB = (stB.x * aB + stB.y * cB) / r;
      const zB = (stB.y * aB - stB.x * cB) / r;
      scr.x = xA - Math.floor(xA);
      scr.y = zA - Math.floor(zA);
      scr.z = xB - Math.floor(xB);
      scr.w = zB - Math.floor(zB);
    }
  }

  /** A deck's coverage into its field: its pictures' gained mean share of sky at their presence, and its overcast's. */
  private deckCover(slot: number): void {
    const C = AIR_TUNE.clouds;
    const images = slot === 0 ? this.bottom.images : this.top.images;
    let cv = 0;
    for (let m = 0; m < 2; m++) {
      const im = images[m];
      const file = im.file;
      if (!file || !im.texture) continue;
      const p = this.numbersOf(file);
      const g = (p ? p.coverage : 0.12) * C.gain;
      cv += im.weight * (g < 1 ? g : 1);
    }
    if (slot === 0) this.coverBottom = cv + this.poB * this.ocNow;
    else this.coverTop = cv + this.poT * this.ocNow;
  }

  /** A deck's kind into the march's record: its pictures' kinds weighted by presence, its overcast a layer. */
  private deckLayered(slot: number): void {
    const images = slot === 0 ? this.bottom.images : this.top.images;
    const po = slot === 0 ? this.poB : this.poT;
    let w = 0;
    let s = 0;
    for (let m = 0; m < 2; m++) {
      const im = images[m];
      const file = im.file;
      if (!file || !im.texture) continue;
      s += im.weight * layeredOfPicture(this.numbersOf(file));
      w += im.weight;
    }
    s += po;
    w += po;
    const kd = this.marchU.uKind.value;
    if (slot === 0) kd.x = w > 1e-6 ? s / w : 0;
    else kd.y = w > 1e-6 ? s / w : 0;
  }

  /**
   * A deck's albedo into the march's record: half from the art (`mix(1, brightness / albedoRef, artBright)` times the
   * picture's colour by `artTint`, the design's §2.18), its pictures weighted by presence and its overcast at the
   * overcast's brightness. The picture's colour normalised to its own brightness, so the tint moves the hue and the
   * brightness term the value.
   */
  private deckAlbedo(slot: number): void {
    const C = AIR_TUNE.clouds;
    const images = slot === 0 ? this.bottom.images : this.top.images;
    const po = slot === 0 ? this.poB : this.poT;
    const out = slot === 0 ? this.marchU.uAlbLo.value : this.marchU.uAlbHi.value;
    const art = VOL_TUNE.cloudsArt;
    const ref = C.albedoRef > 1e-3 ? C.albedoRef : 1e-3;
    const tint = C.artTint * art;
    let w = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let m = 0; m < 2; m++) {
      const im = images[m];
      const file = im.file;
      if (!file || !im.texture) continue;
      const p = this.numbersOf(file);
      const k = 1 + ((p ? p.brightness : C.albedoRef) / ref - 1) * C.artBright * art;
      const col = p ? p.colour : null;
      let cr = 1;
      let cg = 1;
      let cb = 1;
      if (col) {
        cr = SRGB_TO_LINEAR[col[0] & 255];
        cg = SRGB_TO_LINEAR[col[1] & 255];
        cb = SRGB_TO_LINEAR[col[2] & 255];
        const lum = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
        const n = lum > 1e-4 ? 1 / lum : 0;
        cr *= n;
        cg *= n;
        cb *= n;
      }
      r += im.weight * k * (1 + (cr - 1) * tint);
      g += im.weight * k * (1 + (cg - 1) * tint);
      b += im.weight * k * (1 + (cb - 1) * tint);
      w += im.weight;
    }
    const ob = 1 + (C.overcastBright / ref - 1) * C.artBright * art;
    r += po * ob;
    g += po * ob;
    b += po * ob;
    w += po;
    if (w > 1e-6) {
      out.x = r / w;
      out.y = g / w;
      out.z = b / w;
    } else {
      out.x = 1;
      out.y = 1;
      out.z = 1;
    }
  }

  /**
   * The low deck (the design's §2.18): its cover the wet overcast's (`lowDeck.cover`), or on any other day the lower
   * pictures' own cover's (`fair`: nought, Q22's none), or the console's hold; its floor over the cached ground under the
   * camera eased over `groundEase` (a cached read, else the last value, never a generation; asked of a kept record, never
   * handed a number); its cut off its own curve, its wind window round the camera. Off it costs the march nothing.
   */
  private stepLow(t: VolTune): void {
    const I = this.input;
    const LD = AIR_TUNE.lowDeck;
    const dt = this.dtNow;
    const force = I.lowForce;
    const wet = this.overcast * LD.cover;
    const fair = LD.fair * this.coverBottom;
    const wanted = force === true ? 1 : force === false ? 0 : wet > fair ? wet : fair;
    this.low = t.cloudsLow && !I.space ? (wanted < 1 ? wanted : 1) : 0;
    // The ground, read at most twice a second, eased.
    this.groundAsk -= dt;
    if (I.groundAt && (this.groundAsk <= 0 || !this.groundSeen)) {
      this.groundAsk = 0.5;
      const q = this.groundQuery;
      q.x = I.camX;
      q.z = I.camZ;
      const g = I.groundAt(q);
      if (g !== null && g === g && g !== Infinity && g !== -Infinity) {
        if (!this.groundSeen) {
          this.ground = g;
          this.groundSeen = true;
        }
        this.groundTarget = g;
      }
    }
    if (this.groundSeen) {
      const ease = LD.groundEase > 1e-3 ? LD.groundEase : 1e-3;
      this.ground += (this.groundTarget - this.ground) * (1 - Math.exp(-dt / ease));
    } else this.ground = I.camY - 2;
    const floor = this.ground + LD.floor;
    const ul = this.marchU.uLow.value;
    ul.x = floor;
    ul.y = floor + (LD.depth > 1 ? LD.depth : 1);
    ul.z = this.low > 0 ? LD.steps : 0;
    ul.w = LD.reach;
    const cq = this.cutQuery;
    cq.coverage = this.low;
    cq.n = this.lowCoverN;
    if (this.low > 0) cutForCurveIn(cq);
    const lp = this.marchU.uLowP.value;
    lp.x = this.low > 0 ? cq.cut : 1;
    lp.y = LD.reachFade;
    lp.z = LD.smearMost;
    lp.w = 0;
    const lw = this.lowWindU.uLowW.value;
    const sq = LD.windSquare > 1 ? LD.windSquare : 8000;
    const tx = sq / 256;
    lw.x = Math.floor((I.camX - 0.5 * sq) / tx) * tx;
    lw.y = Math.floor((I.camZ - 0.5 * sq) / tx) * tx;
    lw.z = sq;
    lw.w = 0;
  }
  private groundTarget = 0.5;
  /** The kept records the low deck's ground and its cut are asked through. */
  private readonly groundQuery = { x: 0.5, z: 0.5 };
  private readonly cutQuery: CutQuery;

  /** What the console reports of the feed. */
  report(): Record<string, unknown> {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    // Each image's scroll in metres, never folded (how far its picture has moved since it was first taken): two reads a
    // second apart are its apparent speed.
    const img = (im: PictureImage) => {
      if (!im.file) return null;
      const sc = this.scrolls.get(im.file);
      return { file: baseName(im.file), weight: r2(im.weight), loaded: !!im.texture, repeat: Math.round(im.repeat), scroll: sc ? [r2(sc.x), r2(sc.z)] : null };
    };
    const pics = this.input.pictures;
    return {
      why: this.why,
      decks: {
        bottom: { images: [img(this.bottom.images[0]), img(this.bottom.images[1])], coverage: r2(this.coverBottom), presence: r2(this.presBottom), layered: r2(this.marchU.uKind.value.x) },
        top: { images: [img(this.top.images[0]), img(this.top.images[1])], coverage: r2(this.coverTop), presence: r2(this.presTop), layered: r2(this.marchU.uKind.value.y) },
      },
      overcast: r2(this.overcast),
      low: { on: this.low > 0, cover: r2(this.low), floor: Math.round(this.marchU.uLow.value.x), top: Math.round(this.marchU.uLow.value.y), cut: r2(this.marchU.uLowP.value.x), ground: Math.round(this.ground) },
      winds: { bottom: r2(Math.hypot(this.weatherU.uDeckU.value.x, this.weatherU.uDeckU.value.y)), top: r2(Math.hypot(this.weatherU.uDeckU.value.z, this.weatherU.uDeckU.value.w)), slab: r2(Math.hypot(this.weatherU.uSlabU.value.x, this.weatherU.uSlabU.value.y)), low: r2(Math.hypot(this.lowWindU.uLowU.value.x, this.lowWindU.uLowU.value.y)) },
      offsets: { high: [r2(this.dhx), r2(this.dhz)], low: [r2(this.dlx), r2(this.dlz)] },
      holes: { remembered: this.holes.remembered, waiting: this.holes.pendCount, stamped: this.holes.stamped, dropped: this.holes.dropped, live: [this.holes.live(0), this.holes.live(1)] },
      pictures: pics ? (pics.numbered ? `${pics.tiles.size} pictures' numbers` : 'no pictures numbers: heaps at the coverage (npm run swg -- clouds assets-private --no-noise)') : 'no clouds.json for this sky',
      calibration: { ...this.calibration },
      noise: !!this.base,
    };
  }
}

/** One image record (the sky's own class's shape; made here so the node tests need no sky). */
export class PictureImage implements CloudsSkyImage {
  file: string | null = null;
  weight = 0.5;
  size = 0.5;
  speed = 0.5;
  repeat = 0.5;
  texture: THREE.Texture | null = null;
  scrollX = 0.5;
  scrollY = 0.5;
  scrolled = false;
  constructor() {
    this.weight = 0;
  }
}

/** An sRGB channel in 0 to 1 as linear light. */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
/** Every sRGB byte as linear light, worked out once (a picture's colour read in a frame makes nothing). */
const SRGB_TO_LINEAR = Float64Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));

/** A curve into a uniform's (cut, sky) pairs, at most sixteen. */
function writeCurve(out: Float32Array, cover: readonly CoverPoint[]): void {
  const n = Math.min(cover.length, 16);
  for (let i = 0; i < 16; i++) {
    out[i * 2] = i < n ? cover[i].cut : 1;
    out[i * 2 + 1] = i < n ? cover[i].sky : 0;
  }
}

/** The kept record the low deck's cut is worked out through: its coverage, the curve's pairs and length, the cut. */
export interface CutQuery {
  coverage: number;
  readonly pairs: Float32Array;
  n: number;
  cut: number;
}

/**
 * `cutForCover` over a curve held as a uniform's pairs (the low deck's cut, worked out on the processor), through a kept
 * record: the cut written into `q.cut`, so a frame hands no number across the call.
 */
export function cutForCurveIn(q: CutQuery): void {
  const n = q.n;
  const pairs = q.pairs;
  if (n <= 0) {
    q.cut = 1;
    return;
  }
  const c = q.coverage;
  const want = c < 0 ? 0 : c > 1 ? 1 : c;
  if (want >= pairs[1]) {
    q.cut = pairs[0];
    return;
  }
  for (let i = 1; i < n; i++) {
    const ac = pairs[(i - 1) * 2];
    const as = pairs[(i - 1) * 2 + 1];
    const bc = pairs[i * 2];
    const bsk = pairs[i * 2 + 1];
    if (want >= bsk) {
      const span = as - bsk;
      const tt = span > 1e-6 ? (want - bsk) / span : 0;
      q.cut = bc + (ac - bc) * tt;
      return;
    }
  }
  q.cut = pairs[(n - 1) * 2];
}

/** `cutForCurveIn` with its numbers handed in (the tests' and the console's). */
export function cutForCurve(coverage: number, pairs: Float32Array, n: number): number {
  const q: CutQuery = { coverage, pairs, n, cut: 1 };
  cutForCurveIn(q);
  return q.cut;
}

/** The session's feed, made the first time the clouds' pass asks (never with the master off). */
let feed: AirCloudsFeed | null = null;
export function cloudsFeed(): AirCloudsFeed {
  if (!feed) feed = new AirCloudsFeed();
  return feed;
}
/** Whether the feed has been made (the off-proof: never with the master off). */
export function cloudsFeedMade(): boolean {
  return feed !== null;
}

/** The manifest's high-deck curve's cut at a coverage (the console's). */
export function manifestCut(coverage: number, cover: readonly CoverPoint[]): number {
  return cutForCover(coverage, cover);
}
