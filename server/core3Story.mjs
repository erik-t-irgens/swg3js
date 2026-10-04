// The game's own conversations as the server holds them: the Core3 reference's structure and who speaks
// which (`tools/swg/core3ref/conversations.json` and `conversation-speakers.json`, which every release
// carries), folded with the adoptions of ours (`src/story/core3/*.jsonc`) by the very rules the browser
// folds its own copy with (`src/story/core3Trees.ts`), so a herald says the same on a server as alone.
// Read once when the server reads its story sets, and again with them on the admin's `reload`.
//
// Nothing here is the game's or the emulator's beyond what the reference already holds: its screens'
// names and links and the client's string ids. A browser is never sent a tree, only the node it reached.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureOf, core3Set, readOverlays, voicesOf } from '../src/story/core3Trees.ts';
import { readStorySet } from './storySet.mjs';

/** Where the Core3 reference lives (in a checkout and in every release), and the adoptions of ours laid over it. */
export const CORE3_REF = fileURLToPath(new URL('../tools/swg/core3ref/', import.meta.url));
export const CORE3_ADOPTIONS = fileURLToPath(new URL('../src/story/core3/', import.meta.url));

/**
 * The folded set (`core3Set`'s answer), with the adoptions' problems in `errors` as a story set's would be;
 * null when the reference holds no conversations, which is a release that lost the files.
 */
export function readCore3Story({ ref = CORE3_REF, adoptions = CORE3_ADOPTIONS } = {}) {
  const conv = join(ref, 'conversations.json');
  const speakers = join(ref, 'conversation-speakers.json');
  if (!existsSync(conv) || !existsSync(speakers)) return null;
  const capture = captureOf(JSON.parse(readFileSync(conv, 'utf8')));
  const voices = voicesOf(JSON.parse(readFileSync(speakers, 'utf8')));
  const o = readOverlays(readStorySet(adoptions).files);
  return { ...core3Set(capture, voices, o.overlays), errors: o.errors };
}
