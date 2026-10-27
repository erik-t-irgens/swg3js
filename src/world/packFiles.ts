// What the game asks the server for that belongs to one world's pack, asked through one place, so that nothing is
// asked that the game knows cannot be answered (the performance pass's fifth wave). Before it, every boot asked for 18
// places files that cannot exist (the real-elevation worlds', the gallery's and every space zone's), and an arrival on
// a real-elevation world asked for ten files of a pack it does not have, `sounds.json` three times over.
//
// Four rules, in the order they are asked:
// - A world that declares no pack (`PlanetDef.pack === false`) is asked for nothing under `assets-private/<id>/`.
// - A file the converter writes only for some kinds of world (`packHolds`: the places, the sound places, the walk
//   grid, the measured sky, the map picture, the server's people and creatures, the zones' gates) is asked for only
//   where the converter's own rule for writing it would have written it; `packFiles.test.ts` holds every rule to the
//   packs on disk, so a rule can never hide a file a pack has.
// - The pack's manifest is the one probe the rest wait on (`packExists`, `AssetPack.load`'s own ask shared through
//   `manifestText`): a world whose pack is not converted costs that one request and nothing else.
// - A file that answered missing (a 404, and only a 404) is remembered for the session and not asked again (a
//   conversion is seen after a reload, which is what converting asks anyway: the dev server is stopped for it); a page
//   handed back or a failed request is a server's fallback or a moment's, and is asked again, which every reader here
//   that keeps its own answer for the session must keep to as well (`knownAbsent`); `__debug.files({ forget: true })`
//   asks again.
// Beside them, the public files a built game ships (`public/tracks`, `public/placements`, `public/dem`) are asked for
// only when the build's own list holds them (`shippedAsk`, `virtual:shipped-public` in `vite.config.ts`); the dev server
// hands no list, so there every such file is asked for and answered from the disk as the editors need.
//
// Rule for this file (node runs it with type stripping for the tests): every value import with its `.ts` extension,
// nothing that touches the page at load, no constructor parameter properties.

import { PLANETS, type PlanetDef } from '../data/planets.ts';

/** The little of a fetch's answer this file reads; a node test hands in a counting stand-in. */
export interface FileAnswer {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
  /** The answer's bytes (`packBytes`): every real answer has it; a stand-in without it is read as its text. */
  arrayBuffer?(): Promise<ArrayBuffer>;
}

/** What fetches: the page's own, unless a test hands another. */
export const PACK_FILES: { fetch: (url: string, init?: RequestInit) => Promise<FileAnswer> } = {
  fetch: (url, init) => fetch(url, init),
};

/** Where the site is served from: the page's own base, which the builder rewrites (a node test passes its own). */
export function siteBase(): string {
  const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  return env?.BASE_URL ?? '/';
}

/** The development gallery: a pack of exhibits with no places, sounds, walk grid, sky of its own or people. */
const GALLERY = 'gallery';

/**
 * The worlds whose standing people and wildlife the server placed, the converter's `CORE3_WORLDS` (`tools/swg/core3.mjs`):
 * the `spawns` command writes a `spawns.json` into each of them (and the copies' world), and into no other world.
 * `packFiles.test.ts` holds this list to the converter's.
 */
export const SERVER_WORLDS: readonly string[] = ['corellia', 'dantooine', 'dathomir', 'endor', 'lok', 'naboo', 'rori', 'talus', 'tatooine', 'yavin4'];

/** Whether a world declares no pack of its own (`PlanetDef.pack`): nothing under `assets-private/<id>/` is asked for it. */
export function packless(planet: Pick<PlanetDef, 'pack'> | null | undefined): boolean {
  return planet?.pack === false;
}

let packWorlds: Map<string, PlanetDef> | null = null;

/** The world a pack belongs to: the planet of that id, or the planet one of whose zones it is; null for a pack no world names. */
export function worldOfPack(packId: string): PlanetDef | null {
  if (!packWorlds) {
    packWorlds = new Map();
    for (const p of PLANETS) {
      packWorlds.set(p.id, p);
      for (const z of p.zones ?? []) if (!packWorlds.has(z.pack)) packWorlds.set(z.pack, p);
    }
  }
  return packWorlds.get(packId) ?? null;
}

/**
 * Whether a pack can hold a file the converter writes for some kinds of world and not others, by the converter's own
 * rule for writing it. A file this answers no for is never asked for; any file it does not name, and any pack no world
 * names, is asked for as it always was.
 */
export function packHolds(packId: string, file: string): boolean {
  const world = worldOfPack(packId);
  if (!world) return true;
  if (packless(world)) return false;
  // A world with ground of its own: no space zone (whose pack is a sky, stations and fields) and not the gallery.
  const ground = !world.space && world.id !== GALLERY;
  switch (file) {
    // The places (`pois`), the sound places (`sounds`, a world with a snapshot or buildout tables), the walk grid
    // (`navgrid`) and the measured sky (`clouds`): written for the ground worlds, the copies' world among them.
    case 'pois.json':
    case 'sounds.json':
    case 'nav.json':
    case 'clouds.json':
      return ground;
    // The map picture (`maps`): a ground world's own, and the copies' world has none.
    case 'map.json':
      return ground && !world.instances;
    // The server's people and creatures (`spawns`): the worlds it populated, and its copies.
    case 'spawns.json':
      return SERVER_WORLDS.includes(world.id) || !!world.instances;
    // The gates walked between a planet's zones (`gates`): a planet split into zones, and nothing else.
    case 'gates.json':
      return !!world.zones?.length;
    default:
      return true;
  }
}

// ---- The session's record: what was asked, what it answered, and what was answered without asking ----

/** How an ask was answered: the file, a 404, something that was not the file (a page), or no answer at all. */
export type FileAnswerKind = 'ok' | 'missing' | 'page' | 'error';

const asked = new Map<string, { answer: FileAnswerKind; times: number }>();
/**
 * The public files asked (`fetchPublic`), kept apart from a pack's own: on the dev server every world's placements and
 * tracks are asked whether the disk holds them or not, so a 404 there is the editors' due and no file the game should
 * have known was not there.
 */
const publicAsked = new Map<string, { answer: FileAnswerKind; times: number }>();
const skipped = new Map<string, { why: string; times: number }>();
/** Files that answered 404, never asked again this session. */
const misses = new Set<string>();

function note(url: string, answer: FileAnswerKind): void {
  const had = asked.get(url);
  if (had) {
    had.answer = answer;
    had.times++;
  } else asked.set(url, { answer, times: 1 });
  if (answer === 'missing') misses.add(url);
}

function skip(url: string, why: string): void {
  const had = skipped.get(url);
  if (had) {
    had.why = why;
    had.times++;
  } else skipped.set(url, { why, times: 1 });
}

/** A JSON file, fetched and read; null for a miss (remembered), a page, or a failure. */
async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await PACK_FILES.fetch(url);
    if (res.status === 404) {
      note(url, 'missing');
      return null;
    }
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) {
      note(url, 'page');
      return null;
    }
    const data = await res.json();
    note(url, 'ok');
    return data;
  } catch {
    note(url, 'error');
    return null;
  }
}

/** A file's bytes, fetched; null for a miss (remembered), a page, or a failure. */
async function getBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await PACK_FILES.fetch(url);
    if (res.status === 404) {
      note(url, 'missing');
      return null;
    }
    if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) {
      note(url, 'page');
      return null;
    }
    const data = res.arrayBuffer ? new Uint8Array(await res.arrayBuffer()) : new TextEncoder().encode(await res.text());
    note(url, 'ok');
    return data;
  } catch {
    note(url, 'error');
    return null;
  }
}

// ---- The probe: a pack's manifest, asked once for whoever comes first ----

/** Whether a pack's manifest was there, by its URL, once it answered one way or the other. */
const exists = new Map<string, boolean>();
/** The manifest's text in flight, so the probe and `AssetPack.load` share one request. */
const probes = new Map<string, Promise<string | null>>();

const packDir = (packId: string, base: string): string => `${base}assets-private/${packId}/`;

/**
 * A pack's manifest as text, or null where it has none: `AssetPack.load`'s own ask, shared with whoever is waiting on
 * `packExists` for the same pack (each reader parses the text itself, so no two loads share an object). A pack whose
 * manifest answered missing this session is not asked again, and a packless world's never.
 */
export function manifestText(packId: string, base = siteBase()): Promise<string | null> {
  const url = `${packDir(packId, base)}manifest.json`;
  const world = worldOfPack(packId);
  if (world && packless(world)) {
    skip(url, 'the world declares no pack');
    return Promise.resolve(null);
  }
  if (exists.get(url) === false) {
    skip(url, 'missing earlier this session');
    return Promise.resolve(null);
  }
  let p = probes.get(url);
  if (p) return p;
  p = (async () => {
    try {
      const res = await PACK_FILES.fetch(url);
      if (res.status === 404) {
        exists.set(url, false);
        note(url, 'missing');
        return null;
      }
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) {
        note(url, 'page');
        return null;
      }
      const text = await res.text();
      exists.set(url, true);
      note(url, 'ok');
      return text;
    } catch {
      note(url, 'error');
      return null;
    }
  })();
  probes.set(url, p);
  const own = p;
  void own.then(() => {
    if (probes.get(url) === own) probes.delete(url);
  });
  return p;
}

/** Whether a pack is there: the manifest's answer once known, else the probe (one request for every reader). */
export async function packExists(packId: string, base = siteBase()): Promise<boolean> {
  const world = worldOfPack(packId);
  if (world && packless(world)) return false;
  const known = exists.get(`${packDir(packId, base)}manifest.json`);
  if (known !== undefined) return known;
  return (await manifestText(packId, base)) !== null;
}

// ---- A pack's own files ----

/** One fetch of a file for every reader of it on a world, by URL; the world in play's and the one before it are kept. */
const shared = new Map<string, Promise<unknown | null>>();
const SHARED_KEPT = 2;

/**
 * A file read once for every reader that asks for it (the three readers of a world's `sounds.json`). An answer that
 * came back empty for any reason but a 404 (a page handed back, a failed request) is not kept: the readers asking at
 * that moment share it, and the next ask fetches again, as the rule for a miss says.
 */
export function sharedJson<T = unknown>(url: string): Promise<T | null> {
  let p = shared.get(url);
  if (p) {
    // Kept as the newest again, so a world's own file outlives the one before it.
    shared.delete(url);
    shared.set(url, p);
    return p as Promise<T | null>;
  }
  const own = getJson(url);
  p = own;
  shared.set(url, own);
  while (shared.size > SHARED_KEPT) shared.delete(shared.keys().next().value as string);
  void own.then((data) => {
    if (data === null && !misses.has(url) && shared.get(url) === own) shared.delete(url);
  });
  return p as Promise<T | null>;
}

/**
 * One of a pack's own files, read, or null: asked only for a world with a pack, where the converter's rule says the
 * pack can hold it (`packHolds`), where it did not answer missing earlier this session, and once the pack's own probe
 * says the pack is there. `probe` false never starts the probe, only heeds its answer once it has one: for a file read
 * after the pack itself was (the walk grid, the server's people), for a file that is itself what says whether the pack
 * is converted (a space zone's `space.json`, the places the galaxy's cards read at boot), and for a far world's file (its
 * map picture, its pads), whose manifest, up to 2.8 MB, nothing has fetched and the arrival would fetch again. `shared`
 * reads it once for every reader (`sharedJson`).
 */
export async function packJson<T = unknown>(packId: string, file: string, base = siteBase(), opts: { shared?: boolean; probe?: boolean } = {}): Promise<T | null> {
  const url = `${packDir(packId, base)}${file}`;
  const world = worldOfPack(packId);
  if (world && packless(world)) {
    skip(url, 'the world declares no pack');
    return null;
  }
  if (!packHolds(packId, file)) {
    skip(url, 'the converter writes none for this kind of world');
    return null;
  }
  if (misses.has(url)) {
    skip(url, 'missing earlier this session');
    return null;
  }
  const known = exists.get(`${packDir(packId, base)}manifest.json`);
  if (known === false || (opts.probe !== false && known === undefined && !(await packExists(packId, base)))) {
    skip(url, 'the pack is not there');
    return null;
  }
  return opts.shared ? sharedJson<T>(url) : (getJson(url) as Promise<T | null>);
}

/**
 * One of a pack's own files as bytes (another world's `terrain.trn`, which lending reads for its family table), by the
 * very rules `packJson` keeps: nothing for a packless world, a file the converter writes none of for its kind, a miss
 * earlier this session, or a pack whose probe said it is not there; asked, the answer is in the session's record.
 */
export async function packBytes(packId: string, file: string, base = siteBase(), opts: { probe?: boolean } = {}): Promise<Uint8Array | null> {
  const url = `${packDir(packId, base)}${file}`;
  const world = worldOfPack(packId);
  if (world && packless(world)) {
    skip(url, 'the world declares no pack');
    return null;
  }
  if (!packHolds(packId, file)) {
    skip(url, 'the converter writes none for this kind of world');
    return null;
  }
  if (misses.has(url)) {
    skip(url, 'missing earlier this session');
    return null;
  }
  const known = exists.get(`${packDir(packId, base)}manifest.json`);
  if (known === false || (opts.probe !== false && known === undefined && !(await packExists(packId, base)))) {
    skip(url, 'the pack is not there');
    return null;
  }
  return getBytes(url);
}

/**
 * Whether one of a pack's files is known not to be there for the rest of the session: its world declares no pack, the
 * converter's rule writes none for its kind (`packHolds`), the file answered 404, or the pack's manifest did. What a
 * reader that keeps its own answer for the session asks before keeping an empty one (`loadSpacePack`): a page handed
 * back or a failed request is a server's fallback or a moment's, and is asked again.
 */
export function knownAbsent(packId: string, file: string, base = siteBase()): boolean {
  const world = worldOfPack(packId);
  if (world && packless(world)) return true;
  if (!packHolds(packId, file)) return true;
  if (misses.has(`${packDir(packId, base)}${file}`)) return true;
  return exists.get(`${packDir(packId, base)}manifest.json`) === false;
}

// ---- The loading pictures ----

let loadingIndex: Promise<Record<string, { file?: string }> | null> | null = null;

/**
 * The address of a world's loading picture (`assets-private/loading/<id>.png`), or null where the `loading` command
 * found none for it: its own index lists the worlds it pictured (ten, of every world the game has), read once a session.
 * A packless world has none. An install with no index (a 404) has no pictures at all, and every screen draws its own;
 * an index that came back as a page or not at all is asked for again at the next screen.
 */
export async function loadingPicture(planet: Pick<PlanetDef, 'id' | 'pack'>, base = siteBase()): Promise<string | null> {
  if (packless(planet)) return null;
  if (!loadingIndex) {
    const url = `${base}assets-private/loading/index.json`;
    const own = (async () => (misses.has(url) ? null : ((await getJson(url)) as Record<string, { file?: string }> | null)))();
    loadingIndex = own;
    void own.then((index) => {
      if (index === null && !misses.has(url) && loadingIndex === own) loadingIndex = null;
    });
  }
  const index = await loadingIndex;
  const row = index && Object.prototype.hasOwnProperty.call(index, planet.id) ? index[planet.id] : null;
  return row && typeof row.file === 'string' ? `${base}assets-private/loading/${row.file}` : null;
}

// ---- The public files a built game ships ----

/** The build's list of the public files it ships (paths under `public/`), or null: the dev server's, which lists none. */
let shippedList: readonly string[] | null = null;
let shippedSet: ReadonlySet<string> | null = null;

/** A public path as the list keeps it: no leading `./` or `/`, no query. */
function publicPath(path: string): string {
  return path.split('?')[0].replace(/^\.?\/+/, '');
}

/** Hand over the build's list (`virtual:shipped-public`): null on the dev server, where every file is asked for. */
export function setShippedPublic(list: readonly string[] | null): void {
  shippedList = list ? [...list] : null;
  shippedSet = list ? new Set(list.map(publicPath)) : null;
}

/**
 * Whether a public file (a world's tracks, its permanent placements, a real-elevation raster) is worth asking for: always
 * on the dev server (no list: the editors write these files while it runs, and it answers them from the disk), and in a
 * built game only when its own list holds the file, since a file not in the build cannot be answered.
 */
export function shippedAsk(path: string): boolean {
  return !shippedSet || shippedSet.has(publicPath(path));
}

/**
 * A public file asked for, or null without a request where the build does not ship it. The caller reads the answer
 * (a file not there may come back as the page itself with a 200, which is the caller's to tell from the file).
 */
export async function fetchPublic(path: string, init?: RequestInit, base = siteBase()): Promise<FileAnswer | null> {
  const url = `${base}${publicPath(path)}`;
  if (!shippedAsk(path)) {
    skip(url, 'not in the build');
    return null;
  }
  try {
    const res = await PACK_FILES.fetch(url, init);
    const type = res.headers.get('content-type') ?? '';
    // Never remembered as a miss: the dev server's editors may write the file the next moment.
    publicAsked.set(url, { answer: res.ok && (type.includes('json') || type.includes('text/plain')) ? 'ok' : res.status === 404 ? 'missing' : 'page', times: (publicAsked.get(url)?.times ?? 0) + 1 });
    return res;
  } catch (err) {
    publicAsked.set(url, { answer: 'error', times: (publicAsked.get(url)?.times ?? 0) + 1 });
    throw err;
  }
}

// ---- The console ----

type AnswerCounts = { asked: number; ok: number; missing: number; page: number; error: number };

/**
 * `__debug.files()`: a pack's own files asked this session and their answers (`asked`, counted in `counts`), the public
 * files asked apart from them (`public`, counted in `counts.public`: on the dev server every world's placements and
 * tracks are asked whether the disk holds them or not, so a world with none of its own shows there as missing, which
 * is the editors' due and no fault), the misses kept, the asks answered without one.
 */
export function filesReport(): {
  asked: { url: string; answer: FileAnswerKind; times: number }[];
  public: { url: string; answer: FileAnswerKind; times: number }[];
  misses: string[];
  skipped: { url: string; why: string; times: number }[];
  packless: string[];
  shipped: readonly string[] | null;
  counts: AnswerCounts & { skipped: number; public: AnswerCounts };
} {
  const rows = (m: Map<string, { answer: FileAnswerKind; times: number }>) => [...m].map(([url, a]) => ({ url, answer: a.answer, times: a.times }));
  const tally = (list: { answer: FileAnswerKind }[]): AnswerCounts => {
    const count = (k: FileAnswerKind) => list.filter((a) => a.answer === k).length;
    return { asked: list.length, ok: count('ok'), missing: count('missing'), page: count('page'), error: count('error') };
  };
  const list = rows(asked);
  const pub = rows(publicAsked);
  return {
    asked: list,
    public: pub,
    misses: [...misses],
    skipped: [...skipped].map(([url, s]) => ({ url, why: s.why, times: s.times })),
    packless: PLANETS.filter((p) => packless(p)).map((p) => p.id),
    shipped: shippedList,
    counts: { ...tally(list), skipped: skipped.size, public: tally(pub) },
  };
}

/** Forget every answer kept (`files({ forget: true })`, a test's fresh start): every file is asked for again. */
export function forgetFiles(): void {
  asked.clear();
  publicAsked.clear();
  skipped.clear();
  misses.clear();
  exists.clear();
  probes.clear();
  shared.clear();
  loadingIndex = null;
}
