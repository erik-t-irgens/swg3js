// Types for `looks.js` (the space body viewer's looks: the slots, the layers' starts, the shipped half and the private table's
// seam), the little the game's TypeScript reads (the GPU port's pass 2, wave 5, maker L: `privateSky.ts`). The module is the
// viewer's plain JavaScript and stays as it is.
/* eslint-disable @typescript-eslint/no-explicit-any */

/** A complete look from a partial description: every slot and setting present. */
export function makeLook(part: Record<string, any>): Record<string, any>;
/** His private table handed in (`{ meshes, halos, rings, parts }`): false where it is not of that shape. */
export function usePrivateLooks(table: unknown, from?: string): boolean;
/** Where the private table came from and how many looks it made. */
export function privateLooks(): { from: string; looks: number };
export const MESHES: Record<string, any>;
export const HALOS: Record<string, any>;
export const RINGS: Record<string, any>;
