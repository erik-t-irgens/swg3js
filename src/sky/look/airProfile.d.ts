// Types for `airProfile.js` (the air round a body: the viewer's atmosphere waves A and B, the game's body path since the GPU
// port's pass 2, wave 4a), so the game's TypeScript imports it as it stands. Only what the game reads is typed; the module
// itself is the viewer's plain JavaScript, moved byte for byte.

/** Where each number of a record sits (`airParams.ts`'s `F`, number for number, the haze's colour included). */
export const F: Readonly<Record<string, number>> & {
  readonly bottom: number;
  readonly top: number;
  readonly rayR: number;
  readonly rayG: number;
  readonly rayB: number;
  readonly rayH: number;
  readonly mieS: number;
  readonly mieA: number;
  readonly mieH: number;
  readonly mieG: number;
  readonly ozR: number;
  readonly ozG: number;
  readonly ozB: number;
  readonly ozC: number;
  readonly ozW: number;
  readonly mieTintR: number;
  readonly mieTintG: number;
  readonly mieTintB: number;
  readonly smokeER: number;
  readonly smokeEG: number;
  readonly smokeEB: number;
  readonly smokeSR: number;
  readonly smokeSG: number;
  readonly smokeSB: number;
  readonly smokeC: number;
  readonly smokeW: number;
  readonly smokeG: number;
  readonly glowR: number;
  readonly glowG: number;
  readonly glowB: number;
};
export const GAME_FIELD_COUNT: number;
export const HAZE_FIELD_COUNT: number;
export const AIR_FIELD_COUNT: number;

/** (pass 2, wave 6) The smoke and ash: its dials (the game's and the viewer's, one set of names), their starts and ranges. */
export interface SmokeDials {
  smokeDepth: number;
  smokeAngstrom: number;
  smokeAlbedo: number;
  smokeBrown: number;
  smokeHeightKm: number;
  smokeThickKm: number;
  smokeG: number;
  glowLux: number;
  glowKelvin: number;
}
export const SMOKE_NONE: { c: number; w: number; g: number };
export const SMOKE_NM: readonly number[];
export const SMOKE_SUN_LUX: number;
export const DIFFUSIVITY: number;
export const GLOW_PHASE: number;
export const SMOKE_DIAL_START: SmokeDials;
export const SMOKE_DIAL_RANGE: { readonly [K in keyof SmokeDials]: readonly [number, number] };
export const SMOKE_DIAL_NAMES: readonly (keyof SmokeDials)[];
export function hasSmoke(rec: ArrayLike<number>): boolean;
export function smokeDensity(c: number, w: number, h: number): number;
export function smokeColumnTo(c: number, w: number, z: number): number;
export const SMOKE_STEPS: number;
export function smokeColumnAlong(c: number, w: number, bottom: number, top: number, r: number, mu: number, steps?: number): number;
export function blackBody(kelvin: number, out: Float64Array | number[]): Float64Array | number[];
export function smokeInto(rec: Float64Array, d: Partial<SmokeDials> | Record<string, unknown> | null | undefined): Float64Array;
export function glowUp(rec: ArrayLike<number>, h: number, out: Float64Array | number[]): Float64Array | number[];
export function recordLength(rec: ArrayLike<number>): number;
export function smokeUniformValues(rec: ArrayLike<number>): { smokeE: number[]; smokeS: number[]; smokeC: number; smokeW: number; smokeG: number; glow: number[] };
export function opticalDepth(rec: ArrayLike<number>, r: number, mu: number, steps: number, out: Float64Array | number[]): Float64Array | number[];
export function marchDirect(rec: ArrayLike<number>, tabs: AirProfileTables, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, lx: number, ly: number, lz: number, steps: number, sEnd: number, out: Float64Array | number[], sunSteps?: number, withMs?: boolean): Float64Array | number[];

/** A look's air (its form and dials, `AIR_DIALS`' keys). */
export interface LookAir {
  mode?: 'scattered' | 'painted' | 'none';
  [dial: string]: unknown;
}

/** The three tables of a record (RGBA floats), with its key and their sizes. */
export interface AirProfileTables {
  rec: Float64Array;
  key: string;
  size: { tw: number; th: number; mw: number; mh: number; ew: number };
  T: Float32Array;
  MS: Float32Array;
  E: Float32Array;
  ms: number;
}

export const TABLES: {
  transmittance: { width: number; height: number; steps: number };
  multiScatter: { width: number; height: number; dirs: number; steps: number };
  irradiance: { width: number; height: number; rings: number; azimuths: number; steps: number };
};

export function cleanAir(a: LookAir | null | undefined): LookAir & { mode: 'scattered' | 'painted' | 'none'; limbBright: number; twilightBright: number };
export function airStartFor(recipe: string, dials?: Record<string, unknown>, opts?: { shaped?: boolean }): LookAir;
export function newRecord(): Float64Array;
export function recordOf(air: LookAir | null | undefined, out?: Float64Array): Float64Array;
export function recordKey(rec: ArrayLike<number>): string;
export function airless(rec: ArrayLike<number>): boolean;
export function hazeTintOf(rec: ArrayLike<number>, out: number[] | Float64Array): number[] | Float64Array;
export function makeTables(rec: ArrayLike<number>, sizes?: typeof TABLES): AirProfileTables;
export function marchAir(rec: ArrayLike<number>, tabs: AirProfileTables, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, lx: number, ly: number, lz: number, steps: number, sEnd: number, gains: { limb: number; twilight: number } | null, out: Float64Array | number[], lay?: number): Float64Array | number[];
export function lightAt(rec: ArrayLike<number>, tabs: AirProfileTables, r: number, muS: number, out: Float64Array | number[]): Float64Array | number[];
export function transmittanceAt(rec: ArrayLike<number>, tabs: AirProfileTables, r: number, mu: number, out: Float64Array | number[]): Float64Array | number[];
export function multiScatterAt(rec: ArrayLike<number>, tabs: AirProfileTables, r: number, muS: number, out: Float64Array | number[]): Float64Array | number[];
export function irradianceAt(tabs: AirProfileTables, muS: number, out: Float64Array | number[]): Float64Array | number[];
export function limbWeight(b: number, bottom: number): number;
export function twilightWeight(mu: number): number;
export const SHADOW_SOFT: number;

/** The march and the light as nodes of three's shading language (the viewer's shader half). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function airShader(T: any, U: any, tex: { T: any; MS: any; E: any }, steps: any, lay?: number): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  march: (rd: any, C: any, kmPer: any, Ls: any, sEnd?: any) => { L: any; Tv: any; b: any; P: any; s0: any; s1: any };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lightAt: (r: any, muS: any) => { sun: any; sky: any };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transmit: (r: any, mu: any) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  multi: (r: any, mu: any) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sky: (mu: any) => any;
};
export function airUniformValues(rec: ArrayLike<number>, a: { limbBright: number; twilightBright: number }): {
  bottom: number;
  top: number;
  ray: number[];
  rayH: number;
  mieS: number;
  mieA: number;
  mieH: number;
  mieG: number;
  oz: number[];
  ozC: number;
  ozW: number;
  limb: number;
  twilight: number;
  mieTint: number[];
  smokeE: number[];
  smokeS: number[];
  smokeC: number;
  smokeW: number;
  smokeG: number;
  glow: number[];
};
export const AIR_QUALITIES: [string, string, number][];
export function stepsOf(q: string): number;
