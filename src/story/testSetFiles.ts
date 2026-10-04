// Where the browser reads a story set's files from: the committed test set out of the build itself, and
// the owner's own folder from the dev server (or a local build's copy of it); and the adoptions of the
// emulator's conversations, which are read out of the build in the same way. Browser only: the test set
// is gathered by the bundler (`import.meta.glob`), which nothing but the bundler understands, so no node
// test and no server module ever imports this file. Both answer the files as the rules read them
// (`{ path, text }`, relative paths with forward slashes), and the local host does the reading.
//
// The test set is lazy: each of its files is a chunk of its own, fetched only when the test set is
// switched on (under `npm run dev`, or `__debug.story({ tests: true })`), so a release carries a handful of
// small files that nobody ever asks for. The owner's folder is fetched through its index
// (`/story-private/index.json`, which the dev server makes fresh on every ask); a page with no such
// folder simply has no set of its own.

const TEST_FILES = import.meta.glob('./testSet/**/*.{jsonc,json,txt}', { query: '?raw', import: 'default' });
const ADOPTION_FILES = import.meta.glob('./core3/*.jsonc', { query: '?raw', import: 'default' });

/**
 * The adoptions of the emulator's conversations (`core3/*.jsonc`, `core3Trees.ts`): committed like the test
 * set but read in every build, since they are the game's own people speaking and no test content.
 */
export async function core3AdoptionFiles(): Promise<{ path: string; text: string }[]> {
  const out: { path: string; text: string }[] = [];
  for (const key of Object.keys(ADOPTION_FILES).sort()) {
    const text = await ADOPTION_FILES[key]();
    if (typeof text === 'string') out.push({ path: key.replace(/^\.\/core3\//, ''), text });
  }
  return out;
}

/** The committed test set, without the fixtures built to fail the checker, which are never loaded. */
export async function testSetFiles(): Promise<{ path: string; text: string }[]> {
  const out: { path: string; text: string }[] = [];
  for (const key of Object.keys(TEST_FILES).sort()) {
    const path = key.replace(/^\.\/testSet\//, '');
    if (path.startsWith('fixtures/')) continue;
    const text = await TEST_FILES[key]();
    if (typeof text === 'string') out.push({ path, text });
  }
  return out;
}

/** The longest list of files an index may name before it is not a story set. Ours, and generous. */
const OWN_FILES_MAX = 4000;
const SAFE_PATH = /^[A-Za-z0-9_ .-]+(\/[A-Za-z0-9_ .-]+)*\.(jsonc|json|txt)$/i;

/**
 * The owner's own folder, or null when there is none to read (no index, or an empty one). `base` is the
 * page's own base (`import.meta.env.BASE_URL`). A file that will not come is left out and named in the
 * console, so the set is read as it stands.
 */
export async function ownSetFiles(base: string): Promise<{ path: string; text: string }[] | null> {
  const root = `${base.endsWith('/') ? base : `${base}/`}story-private/`;
  let names: string[] = [];
  try {
    const res = await fetch(`${root}index.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    const index = (await res.json()) as { files?: unknown };
    if (Array.isArray(index.files)) names = index.files.filter((f): f is string => typeof f === 'string' && SAFE_PATH.test(f) && !f.split('/').includes('..'));
  } catch {
    return null;
  }
  if (!names.length) return null;
  const out: { path: string; text: string }[] = [];
  for (const path of names.slice(0, OWN_FILES_MAX)) {
    try {
      const res = await fetch(`${root}${path.split('/').map(encodeURIComponent).join('/')}`, { cache: 'no-store' });
      if (res.ok) out.push({ path, text: await res.text() });
      else console.warn(`story-private: ${path} did not come (${res.status})`);
    } catch (err) {
      console.warn(`story-private: ${path} did not come`, err);
    }
  }
  return out;
}
