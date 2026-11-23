// The types of `drafts.js` (the skies' drafts, one per star system: plain JavaScript shared with the space body viewer) as the
// game's TypeScript reads them (pass 2, wave 5, maker M: the galaxy map's opened system names a body by its draft's lore name
// where the owner's Save to game keeps only its id, `src/ui/galaxySystem.ts`). The systems are `system.js`' cleaned records,
// typed loosely here as `system.d.ts` types them.

export { V1_WORLDS, draftV1For, blankSystemV1, lockedStart } from './drafts1.js';
/** The systems with a draft, in the order the page lists them. */
export const DRAFT_SYSTEMS: string[];
/** A system's draft, checked and marked Draft (the same object each time: copy it before changing it), or null. */
export function draftSystem(id: string): Record<string, unknown> | null;
/** The draft system that holds a ground world, or null. */
export function draftSystemOf(world: string): string | null;
/** A system of the owner's own to start from: the world's sun (its place when it has one) and the world, which he stands on. */
export function blankSystem2(world: string, name: string, sunPlace: string | null): Record<string, unknown> | null;
