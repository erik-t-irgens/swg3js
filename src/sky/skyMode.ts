// Which sky the game draws on WebGPU (the GPU port's pass 2, wave 1; the wave's small question 1): ours, the air's sky with
// its sun discs and the haze to the horizon, or SWG's, today's sky exactly (the dome's stand-in by the ramps' colours, the
// client's sun pictures, the planet's own fog on every material). The Graphics page's Sky row (`skyAir`), default ours.
//
// Read once as the game loads and held for the session (`SKY_AT_LOAD`), like the port's other switches at load
// (`LOOKS_AT_LOAD`): three keys every render object on the scene's one fog node, which ours makes the haze's and SWG's
// leaves the planet's, and the far rings' graph is the session's and is built without the sky's two pictures under ours
// (the rings' fog path retired). So a change on the page is taken at the next start of the game, and the row says so; no
// pipeline is ever built for the other sky, in play or behind a screen. WebGL never reads it: its sky is today's.
//
// Pure: no three, no DOM. `localStorage['swg.sky']` = 'swg' or 'ours' overrides the setting at load (a prover's switch).

/** The sky the session draws, read once (`readSkyMode`). */
export const SKY_AT_LOAD = {
  /** Ours: WebGPU, and the setting (or the storage's override) asked for it. False on WebGL and until read. */
  ours: false,
  /** Whether it has been read. */
  read: false,
  /** What the setting asked for when it was read (1 ours, 0 SWG's), and where the answer came from. */
  asked: 1,
  how: 'setting' as 'setting' | 'storage' | 'webgl',
};

/** The storage's override, or null (refused storage, none, or another word). */
function storageWord(): 'ours' | 'swg' | null {
  try {
    const v = typeof localStorage === 'undefined' ? null : localStorage.getItem('swg.sky');
    return v === 'ours' || v === 'swg' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Read the session's sky: once, as the game loads, after the renderer is chosen and before the first world is made.
 * `skyAir` is the setting (1 ours, 0 SWG's). Later calls change nothing.
 */
export function readSkyMode(webgpu: boolean, skyAir: number): boolean {
  if (SKY_AT_LOAD.read) return SKY_AT_LOAD.ours;
  SKY_AT_LOAD.read = true;
  SKY_AT_LOAD.asked = skyAir === 0 ? 0 : 1;
  if (!webgpu) {
    SKY_AT_LOAD.ours = false;
    SKY_AT_LOAD.how = 'webgl';
    return false;
  }
  const w = storageWord();
  if (w !== null) {
    SKY_AT_LOAD.ours = w === 'ours';
    SKY_AT_LOAD.how = 'storage';
  } else {
    SKY_AT_LOAD.ours = SKY_AT_LOAD.asked === 1;
    SKY_AT_LOAD.how = 'setting';
  }
  return SKY_AT_LOAD.ours;
}

/** The tests' own: the read forgotten, so each case reads afresh. Nothing in the game calls it. */
export function resetSkyModeForTests(): void {
  SKY_AT_LOAD.ours = false;
  SKY_AT_LOAD.read = false;
  SKY_AT_LOAD.asked = 1;
  SKY_AT_LOAD.how = 'setting';
}

/** The session draws our sky (WebGPU, read at load). */
export function skyOurs(): boolean {
  return SKY_AT_LOAD.ours;
}

/**
 * What the Sky row says beside itself (`Menu.knobState`): hidden on WebGL, and "from the next start of the game" while the
 * setting asks for the other sky than the one this session draws.
 */
export function skyRowState(webgpu: boolean, skyAir: number): { hide?: boolean; note?: string } | null {
  if (!webgpu) return { hide: true };
  if (!SKY_AT_LOAD.read || SKY_AT_LOAD.how === 'storage') return SKY_AT_LOAD.how === 'storage' ? { note: `held at ${SKY_AT_LOAD.ours ? 'ours' : "SWG's"} by localStorage['swg.sky']` } : null;
  const want = skyAir === 0 ? 0 : 1;
  return want !== (SKY_AT_LOAD.ours ? 1 : 0) ? { note: "from the next start of the game: the sky's fog and the far ground's program are chosen as it loads" } : null;
}
