// What the server knows of the worlds a story's places are written on, which is very little and is all
// the story's checks need: which world a player stands on as a story names it, whether that world is a
// space zone or a dungeon's copies, and where its layout's centre is.
//
// **Which world.** A player says where they are as a planet and a zone (their hello), and the relay keeps
// that as a room (`rooms.mjs`); a story names a world by the pack the game loads for it (`tatooine`,
// `kashyyyk_main`, `space_naboo`), which is the game's own `packIdOf` over the game's own list of planets
// (`src/data/planets.ts`, which the converter already reads the same way). A planet the list does not know
// is named by itself.
//
// **The centre.** A planet's places are written in the raw (snapshot) frame and a player's position comes
// up in the game's, which mirrors X about the layout's centre (`World.layoutCenter` in the browser). The
// server has no packs, so it has no centre unless it is told where the converted content is (`--assets`, or
// `assets-private/` beside the checkout): then each world's `pois.json` says it, the very centre its
// `layout.json` carries, in a file a few kilobytes long rather than several megabytes. Read once a world
// and kept, a world with none included. A space zone needs none (its places and positions share one frame),
// and a dungeon's copies are none of this file's business: each copy stands somewhere of its own, so a
// place inside one is never measured here.
//
// **The hour.** A story's `gameHour()` asks the hour where the player stands. Every browser draws its sky
// from the clock this server hands out, the day's length and the planet's own place in the shared day,
// worked out from that planet's sun (`src/world/dayPhase.ts`); the server holds the same clock and reads the
// same list of planets, so it works the very same hour out itself rather than taking a browser's word that
// would be missing at a claim and stale between words. A browser whose console holds its own day still
// draws its own sky; the story's hour is the world's.
//
// Nothing here is the game's but the list of planets and the files it reads.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLANETS, packIdOf } from '../src/data/planets.ts';
import { hourOfDay, planetPhase } from '../src/world/dayPhase.ts';

/** A pack id a file may be read under: lower-case words, never a path. */
const PACK = /^[a-z0-9_]{1,64}$/;

/** The planet a pack id belongs to, or null. */
function planetOfPack(world) {
  for (const p of PLANETS) {
    if (p.id === world && !p.zones?.length) return p;
    if (p.zones?.some((z) => z.pack === world)) return p;
  }
  return null;
}

/**
 * The server's knowledge of the worlds, for the stories. `assets` is the converted content's folder, or
 * '' for none, in which case no centre is known and a planet's arrivals are taken on the browser's word, as
 * every position already is. `clock` is the server's own (`WorldClock`, `clock.mjs`), or null for none, in
 * which case no hour is known here.
 */
export function storyWorlds({ assets = '', clock = null } = {}) {
  /** @type {Map<string, { x: number, z: number } | null>} */
  const centres = new Map();
  let read = 0;
  return {
    assets,
    /** The world a hello names, as a story names it: its pack id, or the planet itself when the list does not know it. */
    worldOf(planet, zone) {
      if (typeof planet !== 'string' || !planet) return null;
      const p = PLANETS.find((x) => x.id === planet);
      return p ? packIdOf(p, zone || undefined) : planet;
    },
    /** `space` for a space zone, `copies` for a dungeon's copies, `ground` for a planet, '' for a world the list does not know. */
    kindOf(world) {
      const p = typeof world === 'string' ? planetOfPack(world) : null;
      if (!p) return '';
      if (p.space) return 'space';
      if (p.instances) return 'copies';
      return 'ground';
    },
    /** A planet's layout centre, from its `pois.json` under the converted content, or null. */
    centreOf(world) {
      if (!assets || typeof world !== 'string' || !PACK.test(world)) return null;
      if (centres.has(world)) return centres.get(world);
      let centre = null;
      const file = join(assets, world, 'pois.json');
      try {
        if (existsSync(file)) {
          const c = JSON.parse(readFileSync(file, 'utf8'))?.center;
          if (c && Number.isFinite(c.x) && Number.isFinite(c.z)) centre = { x: c.x, z: c.z };
        }
      } catch {
        centre = null;
      }
      read++;
      centres.set(world, centre);
      return centre;
    },
    /**
     * The game hour on a world, 0 to 23, as every browser on it draws its sky: the shared clock's time of day
     * at the planet's own phase. Null for a world the list of planets does not know, or with no clock.
     */
    hourOf(world) {
      const p = clock && typeof world === 'string' ? planetOfPack(world) : null;
      if (!p) return null;
      const phase = planetPhase(p.sky.sunAzimuth, p.sky.sunElevation);
      return hourOfDay(clock.dayFraction(phase * clock.dayMs));
    },
    /** What the status page prints. */
    describe() {
      let known = 0;
      for (const c of centres.values()) if (c) known++;
      return { assets: assets || 'none (a planet\'s arrivals are taken on the browser\'s word)', centres: known, read, hour: clock ? 'the server\'s own, from its clock and each planet\'s sun' : 'the browser\'s word' };
    },
  };
}
