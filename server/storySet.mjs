// A story set's folder read off the disk as the rules want it: every file's path (relative, with forward
// slashes) and its text, in path order. The relay reads the owner's folder and the test set with this, the
// checker's command line (`tools/story/check.mjs`) does too, and the dev server's private-folder plugin
// lists the folder with it, so all three agree about which files a set is made of.
//
// What is read: `.jsonc`, `.json` and `.txt` files (a document is `docs/<id>.doc.txt`), at any depth,
// skipping anything whose name starts with a dot. A file larger than `FILE_MAX`, or a folder past
// `TOTAL_MAX` in all, is refused with the reason rather than read in part: a set is a few hundred
// kilobytes of hand-written text, and anything near these sizes is something else put in the folder.
// The numbers are ours.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The largest one file of a set may be, in bytes. */
export const FILE_MAX = 4 * 1024 * 1024;
/** The largest a whole set may be, in bytes. */
export const TOTAL_MAX = 32 * 1024 * 1024;
/** The kinds of file a set is made of. */
export const STORY_FILE = /\.(jsonc|json|txt)$/i;

/**
 * Every story file under a folder, as `{ path, size }` with paths relative to it, in path order. A folder
 * that does not exist has none. Throws only when the folder is past `TOTAL_MAX`.
 */
export function listStorySet(dir) {
  const out = [];
  let total = 0;
  const walk = (abs, rel) => {
    let names;
    try {
      names = readdirSync(abs).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith('.')) continue;
      const full = join(abs, name);
      const path = rel ? `${rel}/${name}` : name;
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full, path);
      else if (st.isFile() && STORY_FILE.test(name)) {
        total += st.size;
        if (total > TOTAL_MAX) throw new Error(`${dir} holds more than ${TOTAL_MAX} bytes of story files, which is not a story set`);
        out.push({ path, size: st.size });
      }
    }
  };
  if (existsSync(dir)) walk(dir, '');
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

/**
 * Every story file under a folder, read: `{ files: [{ path, text }], refused: [why] }`. A file too large is
 * left out and named in `refused`, so the loader reports the set as it stands rather than half of a file.
 */
export function readStorySet(dir) {
  const files = [];
  const refused = [];
  for (const f of listStorySet(dir)) {
    if (f.size > FILE_MAX) {
      refused.push(`${f.path} is larger than ${FILE_MAX} bytes and was not read`);
      continue;
    }
    files.push({ path: f.path, text: readFileSync(join(dir, ...f.path.split('/')), 'utf8') });
  }
  return { files, refused };
}
