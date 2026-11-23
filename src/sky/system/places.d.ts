// The types of `places.js` (SWG's places and the rules the game places them by, plain JavaScript shared with the space
// body viewer) as the game's TypeScript reads them (pass 2, wave 5, maker S). Only the numbers; the readers of the survey
// and the places' records are typed loosely.

export const CELESTIAL_DISTANCE: number;
export const DISC_FILL: number;
export const GLOW_FILL: number;
export const STAR_DISC_FILL: number;
export const STAR_GLOW_FILL: number;
export const DAY_NIGHT_SPLIT: number;
export const SWG_LIGHT_ELEVATION: number;
export const CLIENT_DAY_SECONDS: number;
export const SPACE_FRAME: { distance: number; radius: number };
export function skyDirection(yawDeg: number, pitchDeg: number): { x: number; y: number; z: number };
export function yawPitchOf(d: { x: number; y: number; z: number }): { yaw: number; pitch: number };
export function offsetDir(dir: { x: number; y: number; z: number }, yawDeg: number, pitchDeg: number): { x: number; y: number; z: number };
export function dayAt(hours: number): Record<string, unknown>;
export function clockText(hours: number): string;
export function skySquareDegrees(size: number): number;
export function parseSkies(text: string): Map<string, Record<string, unknown>>;
export function worldName(id: string): string;
export function buildPlaces(skies: Map<string, Record<string, unknown>>, extras?: unknown[]): Record<string, unknown>[];
export function unknownPlace(id: string): Record<string, unknown>;
