// His imported looks asked of the dev server (the GPU port's pass 2, wave 5, maker L; `privateSky.ts` says the seam). Imported by
// the world only under `import.meta.env.DEV` (`World.loadBodies`, `World.loadSpaceBodies`), which every build makes false, so no
// build carries this module or its addresses and no build asks for anything of his. Never throws; with no answer, none (every
// place its twin or SWG's picture).

import { applyPrivateSky } from './privateSky.ts';

/** Where the dev server answers (`tools/dev/skyPrivate.mjs`). */
const ASK = '/__dev/sky/private';
const FILES = '/__dev/sky/imported/';

/** Behind a loading screen: his imported looks read again (a change in the viewer shows at the next screen). */
export async function readPrivateSky(): Promise<void> {
  try {
    const res = await fetch(ASK, { cache: 'no-store' });
    applyPrivateSky(res.ok ? ((await res.json()) as Record<string, unknown>) : { why: `no answer (${res.status})` }, FILES);
  } catch (e) {
    applyPrivateSky({ why: `not read (${(e as Error).message})` }, FILES);
  }
}
