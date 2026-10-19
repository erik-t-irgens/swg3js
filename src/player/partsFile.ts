// A parts pack's `parts.json`, fetched and parsed once a folder for the session (the performance pass's second
// wave), as `Character.wardrobeAt` keeps a wardrobe's: every dressed person's look of one body reads the same file
// (about 700 KB for a species), and `Character.load` used to fetch and parse it again for each look on the main thread.
// A promise is kept per URL from the moment it is asked for, so two looks asked for together share one fetch; one that
// fails is dropped, so a later look tries again. Nothing writes to the parsed manifest.
//
// A module of its own because `character.ts` cannot be loaded by a node test (its constructor has a parameter
// property, which node's type stripping refuses), and nothing here imports it (`partsFile.test.ts`).

/** The parsed file as the loader reads it; the character's own type is `PartsManifest` in `character.ts`. */
export type PartsJson = Record<string, unknown>;

const files = new Map<string, Promise<PartsJson | null>>();

/** What fetches: the page's own, unless a test hands another. */
export const PARTS_FETCH: { fetch: (url: string) => Promise<{ ok: boolean; headers: { get(name: string): string | null }; json(): Promise<unknown> }> } = {
  fetch: (url) => fetch(url),
};

/**
 * The `parts.json` of a folder (a full URL ending in `/`), parsed: one promise per folder for the session, null when
 * the folder has none (a missing file is answered with the page, so the kind is checked as well as the status).
 */
export function partsFile(dir: string): Promise<PartsJson | null> {
  let p = files.get(dir);
  if (!p) {
    p = PARTS_FETCH.fetch(`${dir}parts.json`)
      .then(async (res) => (!res.ok || !(res.headers.get('content-type') ?? '').includes('json') ? null : ((await res.json()) as PartsJson)))
      .catch(() => null);
    files.set(dir, p);
    // A failure is not kept: the next look of that body asks again.
    void p.then((file) => {
      if (!file && files.get(dir) === p) files.delete(dir);
    });
  }
  return p;
}

/** Forget every folder's file (a test's fresh start). */
export function forgetPartsFiles(): void {
  files.clear();
}
