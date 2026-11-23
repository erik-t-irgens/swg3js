// The types of `system.js` (the skies' clockwork, plain JavaScript shared with the space body viewer) as the game's
// TypeScript reads them (pass 2, wave 5, maker S: `skyMotion.ts`, `worldDays.ts`). The models and states are records of
// typed arrays, typed loosely here: their fields are the file's own and its head says what each holds.

export const SYSTEM_VERSION: number;
export const POLE_ELEVATION: number;
export const BODY_KINDS: string[];
export const MAX_BODIES: number;
export const MAX_MEMBERS: number;
export const NIGHT_REF_SIZE: number;
export const SHEET_SHARE: number;
export const DIALS: Record<string, { min: number; max: number; start: number | null; unit: string; step?: number; log?: boolean }>;
export const EPOCH_MS: number;
export const DAY_MS: number;
export const KINDS: string[];
export const MAX_BODIES2: number;

export function dayShare(hours: number): number;
export function skyTime(day: number, hours: number): number;
export function hoursOf(T: number): number;
export function dayOf(T: number): number;
export function cleanBody(raw: unknown): Record<string, unknown> | null;
export function cleanSystem(raw: unknown): Record<string, unknown> | null;
export function compileSystem(
  sys: Record<string, unknown>,
  sizeOf?: (placeId: string) => number | null,
  sheetOf?: (placeId: string) => boolean,
  opts?: { world?: string; placeExists?: (placeId: string) => boolean },
): Record<string, unknown>;
export function makeSkyState(model: Record<string, unknown>): Record<string, unknown>;
export function moonLight(lit: number, sizeDeg: number, sinUp: number): number;
export function nightBrightness(model: Record<string, unknown>, out: Record<string, unknown>): number;
export function skyAt(model: Record<string, unknown>, T: number, out: Record<string, unknown>): Record<string, unknown>;
export function toSky(out: Record<string, unknown>, x: number, y: number, z: number, into: { x: number; y: number; z: number }): { x: number; y: number; z: number };
export function realDays(ms: number): number;
export function msOfRealDays(T: number): number;
export function defaultDayHours(loreHours: number): number;
export function groundWorlds(sys: unknown): string[];
export function groundOf(sys: unknown, world: string): Record<string, unknown> | null;
export function declination(tiltDeg: number, seasonDeg: number): number;
export function noonHeight(latDeg: number, tiltDeg: number, seasonDeg: number): number;
export function daylightHours(latDeg: number, tiltDeg: number, seasonDeg: number, dayHours: number): { day: number; night: number };
export function skyRuleFor(world: string, v1: unknown, v2: unknown, holds: (world: string) => string | null): { rule: string; id: string | null };
export function localHour(model: Record<string, unknown>, T: number): number;
export function timeAtHour(model: Record<string, unknown>, T: number, hour: number): number;
export function skyAtNext(model: Record<string, unknown>, out: Record<string, unknown>): Record<string, unknown>;
