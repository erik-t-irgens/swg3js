// The light between the sky's bodies (the GPU port's sky round, maker L; the brief `A:\swg3js\port\SKY-BODIES.md`, items D,
// E, F and G; H is `systemSuns.ts`). Under an applied star system (`skyMotion.ts`) the bodies' true places in the system's
// space give, each frame, allocating nothing:
//   - **D, bodies shadowing each other**: for every drawn body, up to four others standing between it and its star (and the
//     world one stands on, for a lunar eclipse), each as a disc of its radius at its place, in the body's own radii and the
//     sky's frame (`ShadeOf`), so the look's own light (`build.js`' `shadeLight`) works at every pixel the share of the star's
//     disc each one covers: a moon's shadow a dark spot crossing a giant, a moon darkening into a giant's shadow. Umbra and
//     penumbra are what the discs' radii and distances make; a caster with air lets a reddened share through its limb's band
//     and bends a little light into its full shadow (`ring`), an airless one is grey.
//   - **E, soft eclipses through air alone**: the share of each sun's disc a nearer body covers (`coverOf`'s, over the disc
//     the game draws), now with a band at an air body's limb through which the sun fades and reddens (its width the body's
//     air times `SHADE_TUNE.band`); an airless body cuts the sun off across the sun's own disc, no reddening. Into `direct1`
//     (the light that reaches the play area straight, rgb) and the motion's `cover`, `sunShare`, `sun2Share`.
//   - **F, the darkness by the shadow's size**: the air's light (sky, ambient) falls by the mean over the visible air
//     (`SHADE_TUNE.reachKm` round the play area, laid on the shadow's plane) of what reaches each place of it, from the true
//     umbra and penumbra there (the occluder's and the sun's radii and distances): a small moon's shadow leaves deep twilight
//     and a brighter ring of sky at the horizon (the card's tables work the same rule per sample: `gpu`), a giant's swallows
//     the air (lit by its red ring if it has air: the sky round's fixer draws that ring about the occluder's limb, `ringSky` and
//     `airSky.ts`, and lays its light on the land as light from the whole sky, `airRun.ts`, never as light from the sun's
//     place). Into `air1`, `air2` and the motion's `daylight`. For scale: Earth's
//     totality is about 1 to 3 lux against 100,000 in sun, and a full moon about 0.2.
//   - **G, the night floor**: read by `airRun.ts` (`SHADE_TUNE.floor`).
//
// The radii: a body's radius is its size at its mean distance from the world one stands on (worked out once at the arrival
// over the system's own clockwork, `meanDistances`), the world's own its air record's (km), a star's its drawn disc at its
// mean distance. Pure: no three, no page; node runs it as it stands.
import { worldRecord } from '../air/airParams.ts';
import { airStartFor, recordOf, F as AF } from '../look/airProfile.js';
import { bodyOfPicture } from '../bodies/bodyAir.ts';
import { casterOf, secondOf } from '../stars.ts';
import { DISC_TUNE } from '../skyDials.ts';
import { makeSkyState, skyAtNext } from './system.js';

/** Kilometres in an astronomical unit (the system's lengths are in AU). */
export const AU_KM = 149597870.7;

/**
 * The shadows' and eclipses' dials (the owner's to set; feel and look are his, each starts where the reason beside it says):
 *   - `shadows` 1: how much of a body's shadow on another is drawn (0 none, 1 the share of the star's disc the caster really
 *     covers there). 1 to start: the system's own geometry, as the owner asked ("celestial bodies shadowed each other").
 *   - `band` 30: an air body's limb band, through which a sun fades and reddens, as a multiple of its air's true depth (six
 *     scale heights of its record's Rayleigh air, where all but a quarter of a percent of its air lies). The true band of the
 *     giants and worlds in these skies is a few hundredths of a degree, a tenth of the sun's disc, so the fade would last no
 *     longer than an airless cut; thirty times makes it span about three of the sun's diameters on Endor's giant, so an
 *     eclipse through air fades and reddens over several times the sun's own crossing (the owner's "slower, as it is passing
 *     through the atmosphere of another planet").
 *   - `ring` 0.0001: the share of the sunlight the occluder's air bends into its full shadow, reddened by that air (the light
 *     that lights a totally eclipsed moon). Earth's own ring lights the Moon in totality at about a ten-thousandth of full
 *     sunlight (Danjon 2 to 3), so a giant's total eclipse is near night with a red light, not black. 0 for none.
 *   - `reachKm` 320: how far round the play area the air whose light reaches the eye is counted, km. A ray at the horizon
 *     leaves the lowest scale height of an Earth-like air some sqrt(2 R H) = 320 km out, so the sky the eye sees and the
 *     light it sheds come from about that far: a shadow wider than this swallows the air, one narrower leaves its sky lit.
 *     Within it each place counts by the light it sheds on level ground (the near air most, `airRadii`), so a small umbra
 *     leaves the land in deep twilight (Earth's totality is about 1 to 3 lux against 100,000 in sun) while the card draws the
 *     far air's brighter ring at the horizon place by place.
 *   - `floor` 1: the night's floor (starlight, airglow and the Milky Way) as a share of today's full-moon night (`MOON_SHARE`,
 *     the light every night has had since pass 2), under every applied system's night light and in a totality by day, so a
 *     moonless night is never black. Real skies give about 1% (0.002 lux against 0.2), but under the eye's dark-night rule
 *     (`eyeMath.ts`' `low` -20.5) the ground 20 m off on Naboo's moonless night read black at 0.03 and at 0.3 and just
 *     readable at 1 (the sky round's pictures, `sky-makerL-sheet-naboo-moonless-ground.png`): 1 is where the ground stays
 *     readable, pass 2's own night. The moons, the giants and his smoke layer's glow add on top; lower it for darker nights.
 *   - `worldScale` 1: the world one stands on casts its shadow on its moons at this share of its own radius (its air
 *     record's, its true size). The moons in these skies are drawn many times a true moon's size, so at 1 a lunar eclipse is
 *     a dark spot crossing a moon; raise it for a shadow that swallows one.
 *   - `innerShare` 1/3 (the sky round's fixer: it was a fixed number): the share of the band's depth its inner, redder part
 *     takes, from the limb up. A third to start: the lowest two of its six scale heights, where all but a seventh of the air's
 *     column lies and the sun's light through it is already well reddened, so the fade turns red where the light is deep in
 *     the air and stays white through its thin outer part, as a sunset turns. Raise it for a redder, longer reddening; lower it
 *     for a whiter fade that reddens only at the last.
 */
export const SHADE_TUNE = { shadows: 1, band: 30, ring: 0.0001, reachKm: 320, floor: 1, worldScale: 1, innerShare: 1 / 3 };
/** The dials' ranges (the console's and the sliders' alike). */
export const SHADE_RANGE: { readonly [K in keyof typeof SHADE_TUNE]: readonly [number, number] } = {
  shadows: [0, 1],
  band: [0, 400],
  ring: [0, 0.01],
  reachKm: [20, 5000],
  floor: [0, 4],
  worldScale: [0.1, 50],
  innerShare: [0.05, 0.95],
};

/** Where each caster's numbers stand in a `ShadeOf`'s `c`: its middle (x, y, z) and radius in the body's radii, its band's two edges, its air's light through the inner and outer band. */
export const SHADE_STRIDE = 12;
/** The most casters a body takes (the look's material reads four). */
export const SHADE_CASTERS = 4;
/** The air's depth a body's band stands for, in its Rayleigh scale heights (the inner band's share of it: `SHADE_TUNE.innerShare`). */
const BAND_HEIGHTS = 6;
/** The card's tables' record (`gpu`): seven vectors of four (`airTables.ts` reads them as they stand). */
export const SHADE_GPU_FLOATS = 28;
/** How far the card's march may look from the play area for a shadow's edge, km (a horizon ray's run through the air). */
const MARCH_REACH_KM = 1500;
/** The sunflower points the visible air is sampled at (equal areas), and the golden angle. */
const AIR_POINTS = 48;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * The stars' full light at the top of the air while a shade is on (`airRun.ts` writes it each frame, in the scene's units), which
 * the card's two marches take per sample with the eclipse's shadow there (`airTables.ts`), while the disc, which a body's card
 * may not hide whole, takes the direct light alone. `on` 0: the marches take the frame's own (no applied system: as before).
 */
export const SHADE_AIR = { on: 0, sun: new Float64Array(3), sun2: new Float64Array(3) };

/** The numbers one frame works with, in a kept array (a number handed across a call is a number made). */
const REG = new Float64Array(8);

/**
 * The share of a disc of radius REG[0] that a disc of radius REG[1] covers, their middles REG[2] apart (radians), into
 * REG[3]: the exact lens of two circles over the first's area (`coverOf`'s arithmetic, worked here once for its three bands).
 */
function overlapReg(): void {
  const a = REG[0];
  const b = REG[1];
  const d = REG[2];
  if (!(a > 0) || !(b > 0) || d >= a + b) {
    REG[3] = 0;
    return;
  }
  const lo = a < b ? a : b;
  const diff = a > b ? a - b : b - a;
  let covered: number;
  if (d <= diff) covered = Math.PI * lo * lo;
  else {
    const ca = (d * d + a * a - b * b) / (2 * d * a);
    const cb = (d * d + b * b - a * a) / (2 * d * b);
    const kk = (-d + a + b) * (d + a - b) * (d - a + b) * (d + a + b);
    covered = a * a * Math.acos(ca < -1 ? -1 : ca > 1 ? 1 : ca) + b * b * Math.acos(cb < -1 ? -1 : cb > 1 ? 1 : cb) - 0.5 * Math.sqrt(kk > 0 ? kk : 0);
  }
  const s = covered / (Math.PI * a * a);
  REG[3] = s > 1 ? 1 : s;
}

/**
 * The smooth share the card works at each pixel and each sample (`build.js`' `shadeLight`, `airTables.ts`' `shadeAt`): a disc of
 * radius REG[1] over one of radius REG[0], REG[2] apart, as a smoothstep between first and last contact times the most it
 * can cover. Into REG[3]. The same arithmetic as the card's, so the twin's air and the drawn sky agree.
 */
function smoothShareReg(): void {
  const rs = REG[0];
  const r = REG[1];
  const d = REG[2];
  const lo = rs > r ? rs - r : r - rs;
  const hi = rs + r;
  const span = hi - lo > 1e-6 ? hi - lo : 1e-6;
  let t = (d - lo) / span;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const s = t * t * (3 - 2 * t);
  const most = rs > 1e-12 ? (r * r) / (rs * rs) : 0;
  REG[3] = (most < 1 ? most : 1) * (1 - s);
}

/** One body's casters this frame (`SkyShade.items[j]`): what `build.js`' `updateLookWith` turns into the look's uniforms. */
export class ShadeOf {
  /** Casters in use, 0 to `SHADE_CASTERS`. */
  n = 0;
  /** The star's disc's angular radius seen from this body, radians. */
  sunRad = 0.5;
  /** Per caster (`SHADE_STRIDE` numbers): its middle from this body's (x, y, z, the sky's frame, in this body's radii), its radius, its band's inner and outer edges (radii), its air's light through the inner band (r, g, b) and the outer (r, g, b). */
  readonly c = new Float64Array(SHADE_CASTERS * SHADE_STRIDE);
  /** Which body each caster is (its item, -2 the world one stands on), for the console. */
  readonly who = new Int16Array(SHADE_CASTERS);
  /** The light its casters' air bends into their full shadows (`SHADE_TUNE.ring`) and the shadows' strength (`shadows`), this frame. */
  ring = 0.5;
  strength = 0.5;
}

/** What the shade reads of the motion and writes back (the motion's own fields: `SkyMotion`'s). */
export interface ShadeMotion {
  readonly m: number;
  readonly items: readonly { readonly star: boolean; readonly drawn: boolean; readonly sheet: boolean; readonly kind: string; readonly body: string; readonly picture: string | null; readonly sizeDeg: number; readonly brightness: number }[];
  readonly dir: Float64Array;
  readonly dist: Float64Array;
  readonly cover: Float64Array;
  readonly casterJ: number;
  readonly secondJ: number;
  /** (Maker P's C) each item's mean distance (AU) and its drawn size now (degrees), where the motion has them. */
  readonly meanDist?: Float64Array;
  readonly sizeNow?: Float64Array;
  sunShare: number;
  sun2Share: number;
  daylight: number;
}

/** What the shade reads of the system's model (`system.js`' compiled numbers, either version). */
interface ShadeModel {
  n: number;
  m: number;
  worldI: number;
  sunI: number;
  itemBody: Int16Array;
  itemMember?: Uint8Array;
  itemSheet: Uint8Array;
  itemStar: Uint8Array;
  sys: { bodies: { id: string; kind: string }[]; grounds?: { world: string; body: string | null; copy?: string | null }[] };
}
/** What it reads of the system's state each frame: the bodies' places in the system's space and the turn into the sky. */
interface ShadeState {
  pos: Float64Array;
  R: Float64Array;
}

/**
 * A record's air as the shade reads it, into `out` at `at` (8 numbers): whether it has air, its band's depth over its radius
 * (`BAND_HEIGHTS` Rayleigh scale heights over the record's bottom), and the light through its band's inner and outer parts,
 * rgb: the transmittance along a tangent ray at each height (Rayleigh, haze and ozone, the column `sqrt(2 pi r H)` of each),
 * averaged over the part's heights. Worked once at the arrival.
 */
export function bandAirOf(rec: ArrayLike<number> | null, out: Float64Array, at: number): void {
  for (let k = 0; k < 8; k++) out[at + k] = 0;
  if (!rec) return;
  const R = rec[AF.bottom];
  const H = rec[AF.rayH];
  const ext = rec[AF.rayR] + rec[AF.rayG] + rec[AF.rayB] + rec[AF.mieS] + rec[AF.mieA];
  if (!(R > 0) || !(H > 0) || !(ext > 0)) return;
  out[at] = 1;
  out[at + 1] = (BAND_HEIGHTS * H) / R;
  const Hm = rec[AF.mieH] > 0 ? rec[AF.mieH] : H;
  const mie = rec[AF.mieS] + rec[AF.mieA];
  const N = 24;
  const top = BAND_HEIGHTS * H;
  const cut = SHADE_TUNE.innerShare * top;
  for (let part = 0; part < 2; part++) {
    const from = part === 0 ? 0 : cut;
    const to = part === 0 ? cut : top;
    let tr = 0;
    let tg = 0;
    let tb = 0;
    for (let i = 0; i < N; i++) {
      const h = from + ((i + 0.5) / N) * (to - from);
      const colR = Math.sqrt(2 * Math.PI * (R + h) * H) * Math.exp(-h / H);
      const colM = Math.sqrt(2 * Math.PI * (R + h) * Hm) * Math.exp(-h / Hm);
      // ozone: a tent at its centre, its column along the tangent ray the layer's half width times the chord's lengthening
      const oz = rec[AF.ozW] > 0 ? Math.max(0, 1 - Math.abs(h - rec[AF.ozC]) / rec[AF.ozW]) * Math.sqrt(2 * (R + h) * rec[AF.ozW]) : 0;
      tr += Math.exp(-(rec[AF.rayR] * colR + mie * colM + rec[AF.ozR] * oz));
      tg += Math.exp(-(rec[AF.rayG] * colR + mie * colM + rec[AF.ozG] * oz));
      tb += Math.exp(-(rec[AF.rayB] * colR + mie * colM + rec[AF.ozB] * oz));
    }
    const o = at + 2 + part * 3;
    out[o] = tr / N;
    out[o + 1] = tg / N;
    out[o + 2] = tb / N;
  }
}

/**
 * Each item's mean distance from the world one stands on, and the world's from its star (AU), over the system's own clockwork:
 * the model run on a scratch state at 64 times a little over 53 days apart (some nine years, every orbit's phase met many
 * times), each distance averaged. Worked once at the arrival (it makes its scratch state); never in a frame.
 */
export function meanDistances(model: ShadeModel & Record<string, unknown>, out: Float64Array): number {
  const st = makeSkyState(model) as unknown as { next: number; pos: Float64Array };
  const m = model.m;
  for (let j = 0; j < m; j++) out[j] = 0;
  let sun = 0;
  const K = 64;
  const w3 = 3 * model.worldI;
  const s3 = 3 * model.sunI;
  for (let k = 0; k < K; k++) {
    st.next = k * 53.37 + 0.123;
    skyAtNext(model, st as unknown as Record<string, unknown>);
    const p = st.pos;
    for (let j = 0; j < m; j++) {
      const b3 = 3 * model.itemBody[j];
      const x = p[b3] - p[w3];
      const y = p[b3 + 1] - p[w3 + 1];
      const z = p[b3 + 2] - p[w3 + 2];
      out[j] += Math.sqrt(x * x + y * y + z * z);
    }
    const x = p[s3] - p[w3];
    const y = p[s3 + 1] - p[w3 + 1];
    const z = p[s3 + 2] - p[w3 + 2];
    sun += Math.sqrt(x * x + y * y + z * z);
  }
  for (let j = 0; j < m; j++) out[j] /= K;
  return sun / K;
}

/**
 * The air a system's item has by default: another ground world of the system its own record (the game's), a SWG picture of a
 * world (`bodyOfPicture`) that world's, a giant a giant's start, a planet a temperate world's, a moon, a comet or a station
 * none. The world's drawer may say better from the look it wears (`SkyShade.setAir`).
 */
function defaultAirOf(model: ShadeModel, it: { kind: string; body: string; picture: string | null }): ArrayLike<number> | null {
  const grounds = model.sys.grounds ?? [];
  for (const g of grounds) if (!g.copy && g.body === it.body) return worldRecord(g.world);
  if (it.picture) {
    const b = bodyOfPicture(it.picture);
    if (b.kind === 'world') return worldRecord(b.world);
    if (b.kind === 'giant') return recordOf(airStartFor('gasgiant'));
    if (b.kind === 'temperate') return recordOf(airStartFor('temperate'));
  }
  if (it.kind === 'giant') return recordOf(airStartFor('gasgiant'));
  if (it.kind === 'planet') return recordOf(airStartFor('temperate'));
  return null;
}

/**
 * One world's light between its bodies under its applied system: made with the motion at the arrival (`SkyMotion`'s own
 * constructor), then `frame` once a frame at the end of the motion's `at`. Allocates nothing in `frame`.
 */
export class SkyShade {
  readonly m: number;
  readonly planet: string;
  /** Each item's body in the model, whether it takes and casts shadows (drawn, not a star, a sheet or a group's member). */
  private readonly bodyOf: Int16Array;
  private readonly eligible: Uint8Array;
  /** Each item's radius (AU), from its size at its mean distance; the world's own and the star's mean distance. */
  readonly radius: Float64Array;
  readonly meanDist: Float64Array;
  readonly sunMean: number;
  /** Each item's air (`bandAirOf`, 8 numbers an item), and the world's own; the world's radius from its record (AU). */
  readonly air: Float64Array;
  readonly worldAir = new Float64Array(8);
  readonly worldRadius: number;
  /** The motion's drawn sizes now (degrees, maker P's C), or null: then a body's angle is its radius over its distance. */
  private readonly sizeNow: Float64Array | null;
  /** The caster's and the second sun's disc radii the game draws at the mean distance before the size dial (radians). */
  private readonly discA: number;
  private readonly discB: number;
  private readonly worldI: number;
  private readonly sunI: number;
  /** Each item's casters this frame (D). */
  readonly items: ShadeOf[];
  /** The light that reaches the play area straight from each sun, rgb (E), and the air's (F), each a share of the sun's own. */
  readonly direct1 = new Float64Array(3);
  readonly direct2 = new Float64Array(3);
  readonly air1 = new Float64Array(3);
  readonly air2 = new Float64Array(3);
  /**
   * (The sky round's fixer) the share of each sun's disc the drawn disc shows: the direct light, which no longer counts the light
   * an occluder's air bends into its full shadow (`ring`: it comes from the ring at the occluder's limb, `ringSky`, drawn there by
   * the sky and laid on the land as light from the whole sky by the air's run), so at totality the disc, the land's direct light
   * and the flare are nought, and no glow stands at the sun's place.
   */
  readonly disc1 = new Float64Array(3);
  readonly disc2 = new Float64Array(3);
  /**
   * (The sky round's fixer) the casting sun's occluder's ring of light at its limb as the sky draws it (`airSky.ts`): its middle's
   * way in the sky (x, y, z), its inner and outer angular radii (radians: the occluder's disc and its band's top), and its light
   * as a share of the sun's own (r, g, b; nought for an airless occluder or none).
   */
  readonly ringSky = new Float64Array(8);
  /** Each item's air record as last set (the band worked from it again when `innerShare` moves), and the world's. */
  private readonly recs: (ArrayLike<number> | null)[] = [];
  private readonly worldRec: ArrayLike<number> | null;
  private bandsAt = 0.5;
  /** The drawn disc's radius against its mean (the star's true distance against its mean, C's rule for the sun). */
  sunScale = 0.5;
  /** The card's tables' record (F's horizon ring): see `airTables.ts`' `shadeAt`. */
  readonly gpu = new Float64Array(SHADE_GPU_FLOATS);
  /** The dominant occluder of each sun this frame (-1 none), for the console. */
  occluder1 = -1;
  occluder2 = -1;
  /** The air's light as a whole (luminance, the stars' brightness weighed) and the direct's, for the console. */
  airLight = 0.5;
  directLight = 0.5;
  /** Frames worked, for the console. */
  frames = 0;
  /**
   * The visible air's sample points: each one's way round the play area (cos, sin, made once) and its distance (km), laid so
   * each point stands for an equal share of the light the air sheds on level ground (`airRadii`: the air at the world's scale
   * height seen at the zenith angle `atan(r / H)`, `cos sin dtheta` of it, out to `SHADE_TUNE.reachKm`), so the near air, which
   * lights the ground most, counts most, and the far air (the horizon's ring) as little as it lights the ground.
   */
  private readonly pts = new Float64Array(2 * AIR_POINTS);
  private readonly ptR = new Float64Array(AIR_POINTS);
  private ptReach = -1;
  /** The world's Rayleigh scale height (km), the height the air that lights the ground stands at. */
  private readonly scaleKm: number;
  /** The four nearest casters a body is choosing among (item index, -2 the world; their margins). */
  private readonly bestK = new Int16Array(SHADE_CASTERS);
  private readonly bestV = new Float64Array(SHADE_CASTERS);
  /** A sun's numbers for the air share (the shadow plane's basis, the offset, the radii, the band, the air's light). */
  private readonly sh = new Float64Array(24);

  constructor(motion: ShadeMotion, model: ShadeModel & Record<string, unknown>, planet: string) {
    const m = motion.m;
    this.m = m;
    this.planet = planet;
    this.worldI = model.worldI;
    this.sunI = model.sunI;
    this.bodyOf = new Int16Array(m);
    this.eligible = new Uint8Array(m);
    this.radius = new Float64Array(m);
    this.meanDist = new Float64Array(m);
    this.air = new Float64Array(8 * m);
    // the mean distances: the motion's own (maker P's C, so a body's radius is the one its drawn size grows from), else ours
    const own = meanDistances(model, this.meanDist);
    const md = motion.meanDist;
    if (md && md.length === m) for (let j = 0; j < m; j++) this.meanDist[j] = md[j];
    this.sunMean = md && md.length === m && motion.casterJ >= 0 && md[motion.casterJ] > 0 ? md[motion.casterJ] : own;
    this.sizeNow = motion.sizeNow && motion.sizeNow.length === m ? motion.sizeNow : null;
    this.bandsAt = SHADE_TUNE.innerShare;
    for (let j = 0; j < m; j++) {
      const it = motion.items[j];
      this.bodyOf[j] = model.itemBody[j];
      const member = model.itemMember ? model.itemMember[j] === 1 : it.kind === 'group';
      this.eligible[j] = !it.star && !it.sheet && it.drawn && !member && it.kind !== 'belt' ? 1 : 0;
      const d = this.meanDist[j] > 0 ? this.meanDist[j] : 1;
      this.radius[j] = d * Math.tan(((it.sizeDeg > 0 ? it.sizeDeg : 1) * Math.PI) / 360);
      const rec = this.eligible[j] ? defaultAirOf(model, it) : null;
      this.recs.push(rec);
      if (this.eligible[j]) bandAirOf(rec, this.air, 8 * j);
    }
    const wrec = worldRecord(planet);
    this.worldRec = wrec;
    bandAirOf(wrec, this.worldAir, 0);
    this.worldRadius = wrec[AF.bottom] / AU_KM;
    this.scaleKm = wrec[AF.rayH] > 0 ? wrec[AF.rayH] : 8;
    const c = casterOf(planet);
    const s2 = secondOf(planet);
    this.discA = ((c ? c.radiusDeg : 0.27) * Math.PI) / 180;
    this.discB = ((s2 ? s2.radiusDeg : c ? c.radiusDeg : 0.27) * Math.PI) / 180;
    this.items = [];
    for (let j = 0; j < m; j++) this.items.push(new ShadeOf());
    for (let i = 0; i < AIR_POINTS; i++) {
      const a = i * GOLDEN;
      this.pts[2 * i] = Math.cos(a);
      this.pts[2 * i + 1] = Math.sin(a);
    }
    this.airRadii();
    for (let k = 0; k < 3; k++) {
      this.direct1[k] = 1;
      this.direct2[k] = 1;
      this.air1[k] = 1;
      this.air2[k] = 1;
      this.disc1[k] = 1;
      this.disc2[k] = 1;
    }
  }

  /** (The sky round's fixer) every band worked again from the records kept, for a moved `innerShare` (a dial's move, never a frame's own). */
  private rebands(): void {
    this.bandsAt = SHADE_TUNE.innerShare;
    for (let j = 0; j < this.m; j++) if (this.eligible[j]) bandAirOf(this.recs[j], this.air, 8 * j);
    bandAirOf(this.worldRec, this.worldAir, 0);
  }

  /**
   * The sample points' distances for the reach now: the light a level ground takes from air at distance `r` (at the scale
   * height H, zenith angle atan(r / H)) goes as `H^2 r / (r^2 + H^2)^2`, whose share out to `r` against the reach R is
   * `(1 - H^2/(r^2+H^2)) / (1 - H^2/(R^2+H^2))`; each point at the middle of an equal share. Worked when the reach moves (a
   * dial), never otherwise.
   */
  private airRadii(): void {
    const R = SHADE_TUNE.reachKm;
    this.ptReach = R;
    const H = this.scaleKm;
    const c = 1 - (H * H) / (R * R + H * H);
    for (let i = 0; i < AIR_POINTS; i++) {
      const u = ((i + 0.5) / AIR_POINTS) * c;
      this.ptR[i] = H * Math.sqrt(u / (1 - u));
    }
  }

  /** An item's air set from the look it wears (`build.js`' record of it), or none (null): its band and its ring's light. */
  setAir(j: number, rec: ArrayLike<number> | null): void {
    if (j < 0 || j >= this.m || !this.eligible[j]) return;
    this.recs[j] = rec;
    bandAirOf(rec, this.air, 8 * j);
  }

  /**
   * One frame, at the end of the motion's `at` (the bodies' places in `st.pos`, the turn into the sky in `st.R`): each sun's
   * direct light and the air's, the motion's cover, shares and daylight written over, the card's tables' record, and every
   * drawn body's casters. `eclipse` the motion's dial. Allocates nothing.
   */
  frame(mo: ShadeMotion, st: ShadeState, tune: { readonly eclipse: number }): void {
    this.frames++;
    if (SHADE_TUNE.innerShare !== this.bandsAt) this.rebands();
    const e = tune.eclipse;
    const a = mo.casterJ;
    const b = mo.secondJ;
    const da = a >= 0 ? mo.dist[a] : 0;
    this.sunScale = da > 0 && this.sunMean > 0 ? this.sunMean / da : 1;
    const g = this.gpu;
    for (let i = 0; i < SHADE_GPU_FLOATS; i++) g[i] = 0;
    // E and F for the casting sun, then the second (its basis the first's: the pair stands a degree or two apart).
    this.occluder1 = -1;
    this.occluder2 = -1;
    const rg = this.ringSky;
    for (let i = 0; i < 8; i++) rg[i] = 0;
    if (a >= 0) {
      this.sh[0] = this.discA * DISC_TUNE.size * this.sunScale;
      this.sh[1] = e;
      this.sunLight(mo, a, this.direct1, this.air1, this.disc1, 0);
      this.occluder1 = this.dominant;
      mo.cover[a] = 1 - (0.2126 * this.direct1[0] + 0.7152 * this.direct1[1] + 0.0722 * this.direct1[2]);
    } else for (let k = 0; k < 3; k++) this.direct1[k] = this.air1[k] = this.disc1[k] = 1;
    if (b >= 0) {
      this.sh[0] = this.discB * DISC_TUNE.size * this.sunScale;
      this.sh[1] = e;
      this.sunLight(mo, b, this.direct2, this.air2, this.disc2, 1);
      this.occluder2 = this.dominant;
      mo.cover[b] = 1 - (0.2126 * this.direct2[0] + 0.7152 * this.direct2[1] + 0.0722 * this.direct2[2]);
    } else for (let k = 0; k < 3; k++) this.direct2[k] = this.air2[k] = this.disc2[k] = 1;
    // The motion's words for the rest of the game: each sun's share its direct light's luminance, the daylight the air's.
    const l1 = 0.2126 * this.direct1[0] + 0.7152 * this.direct1[1] + 0.0722 * this.direct1[2];
    const l2 = 0.2126 * this.direct2[0] + 0.7152 * this.direct2[1] + 0.0722 * this.direct2[2];
    const q1 = 0.2126 * this.air1[0] + 0.7152 * this.air1[1] + 0.0722 * this.air1[2];
    const q2 = 0.2126 * this.air2[0] + 0.7152 * this.air2[1] + 0.0722 * this.air2[2];
    mo.sunShare = a >= 0 ? l1 : 1;
    mo.sun2Share = b >= 0 ? l2 : 1;
    let all = 0;
    let lit = 0;
    let dir = 0;
    for (let k = 0; k < this.m; k++) {
      const it = mo.items[k];
      if (!it.star || !it.drawn) continue;
      const br = it.brightness;
      all += br;
      lit += br * (k === a ? q1 : k === b ? q2 : 1 - e * mo.cover[k]);
      dir += br * (k === a ? l1 : k === b ? l2 : 1 - e * mo.cover[k]);
    }
    mo.daylight = all > 0 ? lit / all : 1;
    this.airLight = mo.daylight;
    this.directLight = all > 0 ? dir / all : 1;
    // D: every drawn body's casters.
    this.bodies(mo, st);
  }

  /** The dominant occluder of the sun `sunLight` last worked (-1 none). */
  private dominant = -1;

  /**
   * One sun's direct light (E: the exact share of its drawn disc of radius `rs` each nearer body covers, with an air body's
   * band and ring) into `direct`, the air's light (F: the mean over the visible air of the smooth shares the card works) into
   * `air`, and the card's record for it (`slot` 0 the caster, 1 the second). Allocates nothing.
   */
  private sunLight(mo: ShadeMotion, k: number, direct: Float64Array, air: Float64Array, disc: Float64Array, slot: number): void {
    // its disc's radius and the eclipse dial from the kept registers (a number handed across a call is a number made)
    const rs = this.sh[0];
    const e = this.sh[1];
    const dir = mo.dir;
    const dist = mo.dist;
    const k3 = 3 * k;
    const sx = dir[k3];
    const sy = dir[k3 + 1];
    const sz = dir[k3 + 2];
    let dr = 1;
    let dg = 1;
    let db = 1;
    let best = -1;
    let bestLum = 2;
    const ring = SHADE_TUNE.ring;
    const band = SHADE_TUNE.band;
    const inner = SHADE_TUNE.innerShare;
    const rg = this.ringSky;
    for (let j = 0; j < this.m; j++) {
      if (!this.eligible[j] || !(dist[j] < dist[k])) continue;
      const j3 = 3 * j;
      const c = sx * dir[j3] + sy * dir[j3 + 1] + sz * dir[j3 + 2];
      const d = Math.acos(c < -1 ? -1 : c > 1 ? 1 : c);
      const ro = this.sizeNow !== null ? (this.sizeNow[j] * Math.PI) / 360 : Math.atan(this.radius[j] / (dist[j] > 1e-12 ? dist[j] : 1e-12));
      const A = 8 * j;
      const thick = this.air[A] > 0 ? this.air[A + 1] * band : 0;
      const outer = ro * (1 + thick);
      if (d >= rs + outer) continue;
      const mid = ro * (1 + thick * inner);
      REG[0] = rs;
      REG[2] = d;
      REG[1] = ro;
      overlapReg();
      const c0 = REG[3];
      REG[1] = mid;
      overlapReg();
      const cm = REG[3];
      REG[1] = outer;
      overlapReg();
      const c1 = REG[3];
      const ir = this.air[A + 2];
      const ig = this.air[A + 3];
      const ib = this.air[A + 4];
      // (the sky round's fixer) the light straight from the sun's place: what shows of its disc past the body and through its
      // band; the light its air bends into the full shadow comes from the ring at its limb (`ringSky`), not from here
      const lr = 1 - c1 + (c1 - cm) * this.air[A + 5] + (cm - c0) * ir;
      const lg = 1 - c1 + (c1 - cm) * this.air[A + 6] + (cm - c0) * ig;
      const lb = 1 - c1 + (c1 - cm) * this.air[A + 7] + (cm - c0) * ib;
      dr *= lr;
      dg *= lg;
      db *= lb;
      const lum = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
      if (lum < bestLum) {
        bestLum = lum;
        best = j;
        // (the sky round's fixer) the casting sun's deepest occluder's ring: at its limb, out to its band's top, lit by what its
        // air bends round it (nought for an airless one, whose band's light is nought)
        if (slot === 0) {
          rg[0] = dir[j3];
          rg[1] = dir[j3 + 1];
          rg[2] = dir[j3 + 2];
          rg[3] = ro;
          rg[4] = outer;
          rg[5] = e * ring * c0 * ir;
          rg[6] = e * ring * c0 * ig;
          rg[7] = e * ring * c0 * ib;
        }
      }
    }
    direct[0] = 1 - e * (1 - dr);
    direct[1] = 1 - e * (1 - dg);
    direct[2] = 1 - e * (1 - db);
    disc[0] = direct[0];
    disc[1] = direct[1];
    disc[2] = direct[2];
    // The best occluder also near enough for its shadow to reach the march's air (the card's ring of sky), though it covers
    // nothing of the sun here yet.
    if (best < 0) best = this.nearest(mo, k);
    this.dominant = best;
    if (best < 0) {
      air[0] = direct[0];
      air[1] = direct[1];
      air[2] = direct[2];
      return;
    }
    this.sh[2] = dr;
    this.sh[3] = dg;
    this.sh[4] = db;
    this.airShare(mo, k, best, air, slot);
  }

  /** The eligible body whose shadow comes within the march's reach of the play area round sun `k` (-1 none). */
  private nearest(mo: ShadeMotion, k: number): number {
    const rs = this.sh[0];
    const dir = mo.dir;
    const dist = mo.dist;
    const k3 = 3 * k;
    const band = SHADE_TUNE.band;
    let best = -1;
    let bestM = 0;
    const dk = dist[k] * AU_KM;
    for (let j = 0; j < this.m; j++) {
      if (!this.eligible[j] || !(dist[j] < dist[k])) continue;
      const j3 = 3 * j;
      const c = dir[k3] * dir[j3] + dir[k3 + 1] * dir[j3 + 1] + dir[k3 + 2] * dir[j3 + 2];
      const d = Math.acos(c < -1 ? -1 : c > 1 ? 1 : c);
      const ro = this.sizeNow !== null ? (this.sizeNow[j] * Math.PI) / 360 : Math.atan(this.radius[j] / (dist[j] > 1e-12 ? dist[j] : 1e-12));
      const A = 8 * j;
      const outer = ro * (1 + (this.air[A] > 0 ? this.air[A + 1] * band : 0));
      const dj = dist[j] * AU_KM;
      const kappa = 1 / (dj > 1 ? dj : 1) - 1 / (dk > 1 ? dk : 1);
      const margin = d - (rs + outer) - kappa * MARCH_REACH_KM;
      if (margin < bestM) {
        bestM = margin;
        best = j;
      }
    }
    return best;
  }

  /**
   * F: the air's light for sun `k` under occluder `j`: the shadow's plane square to the sun (`e1`, `e2`), the occluder's offset
   * from the sun there (radians), how fast that offset moves a kilometre across (`kappa`: the near body's parallax less the
   * sun's), and the mean over the visible air (`SHADE_TUNE.reachKm` round the play area on the level, laid on that plane) of
   * the smooth shares the card works, times what every other occluder leaves at the play area. The card's record written
   * with the same numbers. Allocates nothing.
   */
  private airShare(mo: ShadeMotion, k: number, j: number, air: Float64Array, slot: number): void {
    const rs = this.sh[0];
    const e = this.sh[1];
    const dr = this.sh[2];
    const dg = this.sh[3];
    const db = this.sh[4];
    const dir = mo.dir;
    const dist = mo.dist;
    const k3 = 3 * k;
    const j3 = 3 * j;
    const sx = dir[k3];
    const sy = dir[k3 + 1];
    const sz = dir[k3 + 2];
    // e1 square to the sun and level where it can be, e2 = s x e1
    let ax = sz;
    let ay = 0;
    let az = -sx;
    let al = Math.sqrt(ax * ax + az * az);
    if (al < 1e-6) {
      ax = 1;
      ay = 0;
      az = 0;
      al = 1;
    }
    ax /= al;
    az /= al;
    const bx = sy * az - sz * ay;
    const by = sz * ax - sx * az;
    const bz = sx * ay - sy * ax;
    const ox = dir[j3];
    const oy = dir[j3 + 1];
    const oz = dir[j3 + 2];
    const c = sx * ox + sy * oy + sz * oz;
    const d = Math.acos(c < -1 ? -1 : c > 1 ? 1 : c);
    const px = ox - c * sx;
    const py = oy - c * sy;
    const pz = oz - c * sz;
    const pl = Math.sqrt(px * px + py * py + pz * pz);
    const u = pl > 1e-12 ? d / pl : 0;
    const dx = (px * ax + py * ay + pz * az) * u;
    const dy = (px * bx + py * by + pz * bz) * u;
    const ro = this.sizeNow !== null ? (this.sizeNow[j] * Math.PI) / 360 : Math.atan(this.radius[j] / (dist[j] > 1e-12 ? dist[j] : 1e-12));
    const A = 8 * j;
    const thick = this.air[A] > 0 ? this.air[A + 1] * SHADE_TUNE.band : 0;
    const outer = ro * (1 + thick);
    const mid = ro * (1 + thick * SHADE_TUNE.innerShare);
    const djk = dist[j] * AU_KM;
    const dkk = dist[k] * AU_KM;
    const kappa = 1 / (djk > 1 ? djk : 1) - 1 / (dkk > 1 ? dkk : 1);
    // (the sky round's fixer) the light bent into the full shadow is the ring's (`ringSky`), never scattered by our air as from the
    // sun's place (which drew a glow there at totality): nought here and on the card's record
    const ring = 0;
    const ir = this.air[A + 2];
    const ig = this.air[A + 3];
    const ib = this.air[A + 4];
    const tr = this.air[A + 5];
    const tg = this.air[A + 6];
    const tb = this.air[A + 7];
    // what the other occluders leave at the play area (the direct's product without this one's own share there)
    REG[0] = rs;
    REG[2] = d;
    REG[1] = ro;
    overlapReg();
    const c0x = REG[3];
    REG[1] = mid;
    overlapReg();
    const cmx = REG[3];
    REG[1] = outer;
    overlapReg();
    const c1x = REG[3];
    const ownR = 1 - c1x + (c1x - cmx) * tr + (cmx - c0x) * ir + ring * c0x * ir;
    const ownG = 1 - c1x + (c1x - cmx) * tg + (cmx - c0x) * ig + ring * c0x * ig;
    const ownB = 1 - c1x + (c1x - cmx) * tb + (cmx - c0x) * ib + ring * c0x * ib;
    const restR = ownR > 1e-9 ? dr / ownR : 1;
    const restG = ownG > 1e-9 ? dg / ownG : 1;
    const restB = ownB > 1e-9 ? db / ownB : 1;
    // the mean over the visible air of the smooth shares, each point an equal share of the light the air sheds on the ground
    if (SHADE_TUNE.reachKm !== this.ptReach) this.airRadii();
    let sr = 0;
    let sg = 0;
    let sb = 0;
    const pts = this.pts;
    const ptR = this.ptR;
    for (let i = 0; i < AIR_POINTS; i++) {
      const vx = pts[2 * i] * ptR[i];
      const vz = pts[2 * i + 1] * ptR[i];
      // the level place (vx, 0, vz) on the shadow's plane, and the offset there
      const qx = dx - kappa * (vx * ax + vz * az);
      const qy = dy - kappa * (vx * bx + vz * bz);
      REG[0] = rs;
      REG[2] = Math.sqrt(qx * qx + qy * qy);
      REG[1] = ro;
      smoothShareReg();
      const s0 = REG[3];
      REG[1] = mid;
      smoothShareReg();
      const sm = REG[3];
      REG[1] = outer;
      smoothShareReg();
      const s1 = REG[3];
      sr += 1 - s1 + (s1 - sm) * tr + (sm - s0) * ir + ring * s0 * ir;
      sg += 1 - s1 + (s1 - sm) * tg + (sm - s0) * ig + ring * s0 * ig;
      sb += 1 - s1 + (s1 - sm) * tb + (sm - s0) * ib + ring * s0 * ib;
    }
    const inv = 1 / AIR_POINTS;
    air[0] = 1 - e * (1 - sr * inv * restR);
    air[1] = 1 - e * (1 - sg * inv * restG);
    air[2] = 1 - e * (1 - sb * inv * restB);
    // the card's record (`airTables.ts`' shadeAt): the basis and kappa, the offset and radii, the band, the air's light
    const g = this.gpu;
    if (slot === 0) {
      g[0] = ax;
      g[1] = ay;
      g[2] = az;
      g[3] = kappa;
      g[4] = bx;
      g[5] = by;
      g[6] = bz;
      g[7] = e;
      g[8] = dx;
      g[9] = dy;
      g[10] = rs;
      g[11] = ro;
      g[12] = mid;
      g[13] = outer;
      g[14] = ring;
      g[16] = ir;
      g[17] = ig;
      g[18] = ib;
      g[20] = tr;
      g[21] = tg;
      g[22] = tb;
      g[24] = 1;
    } else {
      // the second sun: its offset from this same occluder in the first's basis (a degree or two apart), its own disc; with
      // no shadow on the first sun's record, the second's occluder writes the shared numbers
      if (g[24] === 0) {
        g[0] = ax;
        g[1] = ay;
        g[2] = az;
        g[3] = kappa;
        g[4] = bx;
        g[5] = by;
        g[6] = bz;
        g[7] = e;
        g[11] = ro;
        g[12] = mid;
        g[13] = outer;
        g[14] = ring;
        g[16] = ir;
        g[17] = ig;
        g[18] = ib;
        g[20] = tr;
        g[21] = tg;
        g[22] = tb;
        g[8] = 1e3;
        g[9] = 0;
        g[10] = rs;
      }
      g[15] = 1;
      g[19] = dx;
      g[23] = dy;
      g[25] = rs;
    }
  }

  /**
   * D: for every drawn body, the four nearest of the others (and the world one stands on) whose shadow cones reach it from its
   * star, each written in its radii in the sky's frame (`ShadeOf`). Allocates nothing.
   */
  private bodies(mo: ShadeMotion, st: ShadeState): void {
    const p = st.pos;
    const R = st.R;
    const s3 = 3 * this.sunI;
    const w3 = 3 * this.worldI;
    const sunR = this.sunMean * Math.tan(this.discA * DISC_TUNE.size);
    const band = SHADE_TUNE.band;
    const worldR = this.worldRadius * SHADE_TUNE.worldScale;
    const on = SHADE_TUNE.shadows > 0;
    const bestK = this.bestK;
    const bestV = this.bestV;
    const ringNow = SHADE_TUNE.ring;
    const strength = SHADE_TUNE.shadows;
    for (let j = 0; j < this.m; j++) {
      const out = this.items[j];
      out.n = 0;
      out.ring = ringNow;
      out.strength = strength;
      if (!on || !this.eligible[j]) continue;
      const b3 = 3 * this.bodyOf[j];
      const pjx = p[b3];
      const pjy = p[b3 + 1];
      const pjz = p[b3 + 2];
      let sx = p[s3] - pjx;
      let sy = p[s3 + 1] - pjy;
      let sz = p[s3 + 2] - pjz;
      const sd = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (!(sd > 1e-12)) continue;
      sx /= sd;
      sy /= sd;
      sz /= sd;
      const rsj = Math.atan(sunR / sd);
      out.sunRad = rsj;
      const Rj = this.radius[j];
      let n = 0;
      for (let q = 0; q < SHADE_CASTERS; q++) {
        bestK[q] = -1;
        bestV[q] = 0;
      }
      // every other body and the world (-2), each a candidate when it stands toward the star and its shadow reaches this body
      for (let k = -1; k < this.m; k++) {
        let kx: number;
        let ky: number;
        let kz: number;
        let Rk: number;
        let thickK: number;
        if (k < 0) {
          kx = p[w3];
          ky = p[w3 + 1];
          kz = p[w3 + 2];
          Rk = worldR;
          thickK = this.worldAir[0] > 0 ? this.worldAir[1] * band : 0;
        } else {
          if (k === j || !this.eligible[k] || this.bodyOf[k] === this.bodyOf[j]) continue;
          const k3 = 3 * this.bodyOf[k];
          kx = p[k3];
          ky = p[k3 + 1];
          kz = p[k3 + 2];
          Rk = this.radius[k];
          thickK = this.air[8 * k] > 0 ? this.air[8 * k + 1] * band : 0;
        }
        const ux = kx - pjx;
        const uy = ky - pjy;
        const uz = kz - pjz;
        const ud = Math.sqrt(ux * ux + uy * uy + uz * uz);
        if (!(ud > 1e-12) || ud >= sd) continue;
        const cd = (ux * sx + uy * sy + uz * sz) / ud;
        if (!(cd > 0)) continue;
        const dlt = Math.acos(cd > 1 ? 1 : cd);
        const outer = Math.atan((Rk * (1 + thickK)) / ud);
        const self = Rj < ud ? Math.asin(Rj / ud) : Math.PI / 2;
        const margin = dlt - (rsj + outer + self);
        if (!(margin < 0)) continue;
        // into the four nearest by margin (the deepest in first)
        let at = n < SHADE_CASTERS ? n : -1;
        if (at < 0) {
          let worst = 0;
          for (let q = 1; q < SHADE_CASTERS; q++) if (bestV[q] > bestV[worst]) worst = q;
          if (margin < bestV[worst]) at = worst;
        } else n++;
        if (at < 0) continue;
        bestK[at] = k < 0 ? -2 : k;
        bestV[at] = margin;
      }
      out.n = n;
      const c = out.c;
      for (let q = 0; q < n; q++) {
        const k = bestK[q];
        let kx: number;
        let ky: number;
        let kz: number;
        let Rk: number;
        let A: Float64Array;
        let a0: number;
        if (k === -2) {
          kx = p[w3];
          ky = p[w3 + 1];
          kz = p[w3 + 2];
          Rk = worldR;
          A = this.worldAir;
          a0 = 0;
        } else {
          const k3 = 3 * this.bodyOf[k];
          kx = p[k3];
          ky = p[k3 + 1];
          kz = p[k3 + 2];
          Rk = this.radius[k];
          A = this.air;
          a0 = 8 * k;
        }
        const ux = (kx - pjx) / Rj;
        const uy = (ky - pjy) / Rj;
        const uz = (kz - pjz) / Rj;
        const o = q * SHADE_STRIDE;
        out.who[q] = k;
        // into the sky's frame (R's rows), as `dir` and `light` are
        c[o] = R[0] * ux + R[1] * uy + R[2] * uz;
        c[o + 1] = R[3] * ux + R[4] * uy + R[5] * uz;
        c[o + 2] = R[6] * ux + R[7] * uy + R[8] * uz;
        const thick = A[a0] > 0 ? A[a0 + 1] * band : 0;
        const rr = Rk / Rj;
        c[o + 3] = rr;
        c[o + 4] = rr * (1 + thick * SHADE_TUNE.innerShare);
        c[o + 5] = rr * (1 + thick);
        c[o + 6] = A[a0 + 2];
        c[o + 7] = A[a0 + 3];
        c[o + 8] = A[a0 + 4];
        c[o + 9] = A[a0 + 5];
        c[o + 10] = A[a0 + 6];
        c[o + 11] = A[a0 + 7];
      }
    }
  }

  /**
   * The share of the star's light reaching a point of body `j` whose outward direction is (`nx`, `ny`, `nz`) in the sky's
   * frame (the light's direction `lx`, `ly`, `lz` toward the star): the look's own arithmetic (`build.js`' `shadeLight`)
   * worked in node, for the tests and the console. Luminance-weighted, into `out` (r, g, b). Not a frame's.
   */
  lightAt(j: number, nx: number, ny: number, nz: number, lx: number, ly: number, lz: number, out: Float64Array): void {
    out[0] = out[1] = out[2] = 1;
    const it = this.items[j];
    if (!it || it.n === 0) return;
    const ring = SHADE_TUNE.ring;
    for (let q = 0; q < it.n; q++) {
      const o = q * SHADE_STRIDE;
      const c = it.c;
      const ux = c[o] - nx;
      const uy = c[o + 1] - ny;
      const uz = c[o + 2] - nz;
      const ud = Math.sqrt(ux * ux + uy * uy + uz * uz);
      const cd = (ux * lx + uy * ly + uz * lz) / ud;
      const d = Math.acos(cd < -1 ? -1 : cd > 1 ? 1 : cd);
      const asn = (r: number): number => Math.asin(r / ud < 1 ? r / ud : 1);
      REG[0] = it.sunRad;
      REG[2] = d;
      REG[1] = asn(c[o + 3]);
      smoothShareReg();
      const s0 = REG[3];
      REG[1] = asn(c[o + 4]);
      smoothShareReg();
      const sm = REG[3];
      REG[1] = asn(c[o + 5]);
      smoothShareReg();
      const s1 = REG[3];
      for (let ch = 0; ch < 3; ch++) out[ch] *= 1 - s1 + (s1 - sm) * c[o + 9 + ch] + (sm - s0) * c[o + 6 + ch] + ring * s0 * c[o + 6 + ch];
    }
    const s = SHADE_TUNE.shadows;
    for (let ch = 0; ch < 3; ch++) out[ch] = 1 - s * (1 - out[ch]);
  }

  /** What the console says: the suns' light, the dominant occluders, each shadowed body's casters. */
  report(mo: { items: readonly { name: string }[] }): Record<string, unknown> {
    const r3 = (a: ArrayLike<number>): number[] => [a[0], a[1], a[2]].map((v) => Number(v.toPrecision(4)));
    const name = (k: number): string => (k === -2 ? `${this.planet} (the world)` : mo.items[k]?.name ?? String(k));
    const shadowed: Record<string, unknown>[] = [];
    for (let j = 0; j < this.m; j++) {
      const it = this.items[j];
      if (!it.n) continue;
      const casters: string[] = [];
      for (let q = 0; q < it.n; q++) {
        const c = it.c;
        const o = q * SHADE_STRIDE;
        casters.push(`${name(it.who[q])}: radius ${c[o + 3].toPrecision(3)} of its own, ${Math.sqrt(c[o] * c[o] + c[o + 1] * c[o + 1] + c[o + 2] * c[o + 2]).toPrecision(4)} of its radii away`);
      }
      shadowed.push({ body: mo.items[j].name, sunRadDeg: Number(((it.sunRad * 180) / Math.PI).toPrecision(4)), casters });
    }
    return {
      tune: { ...SHADE_TUNE },
      sunScale: Number(this.sunScale.toFixed(5)),
      direct1: r3(this.direct1),
      air1: r3(this.air1),
      direct2: r3(this.direct2),
      air2: r3(this.air2),
      // (the sky round's fixer) what the drawn disc shows, and the casting sun's occluder's ring at its limb
      disc1: r3(this.disc1),
      ringSky: this.ringSky[5] + this.ringSky[6] + this.ringSky[7] > 0 ? { innerDeg: Number(((this.ringSky[3] * 180) / Math.PI).toPrecision(4)), outerDeg: Number(((this.ringSky[4] * 180) / Math.PI).toPrecision(4)), light: r3(this.ringSky.subarray(5, 8)) } : null,
      daylight: Number(this.airLight.toPrecision(4)),
      direct: Number(this.directLight.toPrecision(4)),
      occluder1: this.occluder1 >= 0 ? name(this.occluder1) : null,
      occluder2: this.occluder2 >= 0 ? name(this.occluder2) : null,
      card: this.gpu[24] > 0 || this.gpu[15] > 0 ? 'the sky drawn with a shadow' : 'no shadow on the sky',
      radiiKm: Object.fromEntries(mo.items.map((it, j) => [it.name, this.eligible[j] ? Math.round(this.radius[j] * AU_KM) : null]).filter((e) => e[1] !== null)),
      worldRadiusKm: Math.round(this.worldRadius * AU_KM * SHADE_TUNE.worldScale),
      shadowed,
    };
  }
}

/**
 * The share of sun `which` (0 the caster, 1 the second) reaching a place `v` km from the eye (its three numbers in the sky's
 * frame, +Y up) by the card's record `g` (`SkyShade.gpu`), into `out` (r, g, b): the arithmetic `airTables.ts`' `shadeAt` works
 * at each sample of the sky view and the haze, here for the tests and the console (never a frame's). 1 where the record is off.
 */
export function airShadeAt(g: Float64Array, which: 0 | 1, vx: number, vy: number, vz: number, out: Float64Array): void {
  const on = which === 0 ? g[24] : g[15];
  if (!(on > 0.5)) {
    out[0] = out[1] = out[2] = 1;
    return;
  }
  const dX = which === 0 ? g[8] : g[19];
  const dY = which === 0 ? g[9] : g[23];
  const rs = which === 0 ? g[10] : g[25];
  const qx = dX - g[3] * (vx * g[0] + vy * g[1] + vz * g[2]);
  const qy = dY - g[3] * (vx * g[4] + vy * g[5] + vz * g[6]);
  REG[0] = rs;
  REG[2] = Math.sqrt(qx * qx + qy * qy);
  REG[1] = g[11];
  smoothShareReg();
  const s0 = REG[3];
  REG[1] = g[12];
  smoothShareReg();
  const sm = REG[3];
  REG[1] = g[13];
  smoothShareReg();
  const s1 = REG[3];
  const e = g[7];
  for (let c = 0; c < 3; c++) {
    const tin = g[16 + c];
    const tout = g[20 + c];
    const L = 1 - s1 + tout * (s1 - sm) + tin * (sm - s0) + tin * g[14] * s0;
    out[c] = 1 - (1 - L) * e;
  }
}

/** Set the shade's dials from the console's argument: each held to its range, words for what was held or refused. */
export function tuneShade(o: unknown): string[] {
  const said: string[] = [];
  if (!o || typeof o !== 'object') return said;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const r = (SHADE_RANGE as Record<string, readonly [number, number]>)[k];
    if (!r) {
      said.push(`shade.${k}: no such dial`);
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      said.push(`shade.${k}: not a number`);
      continue;
    }
    const held = v < r[0] ? r[0] : v > r[1] ? r[1] : v;
    if (held !== v) said.push(`shade.${k}: held to ${held}`);
    SHADE_TUNE[k as keyof typeof SHADE_TUNE] = held;
  }
  return said;
}
