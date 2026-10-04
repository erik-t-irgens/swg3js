// How the game's own people greet you and say goodbye in the client's reaction lines (src/story/reactions.ts),
// and the client's string tables those and every conversation are read from (src/story/strings.ts).
//
// What is pinned:
//
//   - a diction is its `npc_reaction` table, and a line is one of its sixteen greetings or farewells at a warmth,
//     as a reference and never words;
//   - nice at `niceAt` Standing on the speaker's side's track or more, mean when that track has burned the
//     character or its Trust is `meanTrust` or less, mid otherwise -- and mid with no Standing at all;
//   - the track is the faction's: the Rebellion's for a rebel, the Empire's for an imperial, freelance else, and
//     the greeting the game asks for (`reactionFor`) is as warm as the book says on it;
//   - the line is drawn from who says it and the shared clock: the same in every browser, kept for `every`,
//     spread over all sixteen across people, and moved past a key a table has not got once it has come;
//   - somebody with no way of speaking has no reaction;
//   - a string table is fetched once, kept, answered by key, retried only after a while when it would not
//     come, and its listeners told; a path that climbs anywhere in it is never fetched; `%TU` and `%NU` take
//     the player's name.
//
// Synthetic: nothing is read from the game's own files.
import assert from 'node:assert/strict';
import { emptyBook, type StoryBook } from '../../../src/story/book.ts';
import { REACTION_TUNE, reactionFor, reactionLine, reactionSeed, reactionTable, trackOfFaction, tuneReactions, warmthOf } from '../../../src/story/reactions.ts';
import { ClientStrings, STRINGS_TUNE, fillName, isTablePath } from '../../../src/story/strings.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const bookWith = (track: string, rec: Record<string, unknown>): StoryBook => ({ ...emptyBook('char-r'), tracks: { [track]: { standing: 0, trust: 0, ...rec } } } as unknown as StoryBook);

// ---- warmth and the track -----------------------------------------------------------------------------------------
{
  ok(trackOfFaction('rebel') === 'rebellion' && trackOfFaction('imperial') === 'empire' && trackOfFaction('townsperson') === 'freelance' && trackOfFaction(null) === 'freelance', "the track is the speaker's faction's, and freelance for anybody of neither side");
  ok(warmthOf(emptyBook('c'), 'rebellion') === 'mid' && warmthOf(null, 'empire') === 'mid', 'with no Standing at all, everybody greets at mid');
  ok(warmthOf(bookWith('rebellion', { standing: REACTION_TUNE.niceAt }), 'rebellion') === 'nice' && warmthOf(bookWith('rebellion', { standing: REACTION_TUNE.niceAt - 1 }), 'rebellion') === 'mid', 'nice from `niceAt` Standing on the track, and not a point below');
  ok(warmthOf(bookWith('empire', { trust: REACTION_TUNE.meanTrust }), 'empire') === 'mean' && warmthOf(bookWith('empire', { trust: REACTION_TUNE.meanTrust + 1 }), 'empire') === 'mid', 'mean at `meanTrust` Trust or less');
  ok(warmthOf(bookWith('empire', { standing: 9000, status: 'burned' }), 'empire') === 'mean', 'and mean for a track that has burned the character, whatever their Standing');
  ok(warmthOf(bookWith('rebellion', { standing: 9000 }), 'empire') === 'mid', 'Standing on another track is nothing to this speaker');
}

// ---- the lines -------------------------------------------------------------------------------------------------------
{
  ok(reactionTable('military') === 'npc_reaction/military', 'a diction is its own reaction table');
  const now = 1_800_000_000_000;
  const r = reactionFor({ diction: 'military', faction: 'rebel' }, emptyBook('c'), 'row:abc', now);
  ok(!!r && /^@npc_reaction\/military:hi_mid_([1-9]|1[0-6])$/.test(r.hi) && /^@npc_reaction\/military:bye_mid_([1-9]|1[0-6])$/.test(r.bye) && r.track === 'rebellion' && r.warmth === 'mid', `a rebel trooper greets and says goodbye in the military table's lines at mid (${r?.hi}, ${r?.bye})`);
  ok(reactionFor({ diction: 'military' }, emptyBook('c'), 'row:abc', now)?.hi === reactionFor({ diction: 'military' }, emptyBook('c'), 'row:abc', now + REACTION_TUNE.every - (now % REACTION_TUNE.every) - 1)?.hi, 'the same person says the same thing for the rest of the stretch of the shared clock');
  ok(reactionFor(null, null, 'row:abc', now) === null && reactionFor({ faction: 'rebel' }, null, 'row:abc', now) === null && reactionFor({ diction: '../x' }, null, 'row:abc', now) === null, 'somebody with no way of speaking, or one that is not a name, has no reaction');
  // What the game calls reads the book: warm on the speaker's own track, cold where it burned them, and the
  // other side's Standing is nothing to them.
  const warm = reactionFor({ diction: 'military', faction: 'rebel' }, bookWith('rebellion', { standing: REACTION_TUNE.niceAt }), 'row:abc', now);
  const cold = reactionFor({ diction: 'military', faction: 'imperial' }, bookWith('empire', { status: 'burned' }), 'row:abc', now);
  const other = reactionFor({ diction: 'military', faction: 'imperial' }, bookWith('rebellion', { standing: REACTION_TUNE.niceAt }), 'row:abc', now);
  ok(warm?.warmth === 'nice' && /:hi_nice_/.test(warm.hi) && /:bye_nice_/.test(warm.bye) && cold?.warmth === 'mean' && /:hi_mean_/.test(cold.hi) && cold.track === 'empire' && other?.warmth === 'mid', 'a greeting is as warm as the book says on the speaker\'s own track, and no warmer for the other side');
  // And moves past a key the table has come without, greeting and farewell alike.
  const plain = reactionFor({ diction: 'military' }, null, 'row:abc', now)!;
  const without = reactionFor({ diction: 'military' }, null, 'row:abc', now, (table, key) => table === 'npc_reaction/military' && `@${table}:${key}` !== plain.hi && `@${table}:${key}` !== plain.bye)!;
  ok(without.hi !== plain.hi && without.bye !== plain.bye && without.table === 'npc_reaction/military' && reactionFor({ diction: 'military' }, null, 'row:abc', now, () => false) === null, "a key the table has come without is moved past, and a table with none of them gives no reaction");
  // Spread: many people, every line drawn, and roughly evenly.
  const counts = new Map<string, number>();
  for (let i = 0; i < 1600; i++) {
    const line = reactionLine('slang', 'hi', 'mid', reactionSeed(`row:k${i}`, now));
    counts.set(line!, (counts.get(line!) ?? 0) + 1);
  }
  const lo = Math.min(...counts.values());
  const hi = Math.max(...counts.values());
  const all = Array.from({ length: 16 }, (_, i) => `@npc_reaction/slang:hi_mid_${i + 1}`);
  ok(counts.size === 16 && all.every((l) => counts.has(l)) && lo >= 60 && hi <= 145, `over many people every one of the sixteen, hi_mid_1 to hi_mid_16, is drawn, none far more than another (${lo} to ${hi} of 1600)`);
  // Over time the same person moves on.
  const seen = new Set<string>();
  for (let k = 0; k < 40; k++) seen.add(reactionLine('fancy', 'bye', 'nice', reactionSeed('row:one', k * REACTION_TUNE.every))!);
  ok(seen.size >= 10, `and the same person says other things in other stretches (${seen.size} of 16 over forty)`);
  // A table that has come without a key: moved past it; with none of the sixteen, nothing.
  const first = reactionLine('military', 'hi', 'mean', 'seed');
  const has = (key: string) => key !== first!.split(':')[1];
  const moved = reactionLine('military', 'hi', 'mean', 'seed', has);
  ok(moved !== null && moved !== first && reactionLine('military', 'hi', 'mean', 'seed', () => null) === first && reactionLine('military', 'hi', 'mean', 'seed', () => false) === null, 'a key the table has not got is moved past once it has come, the draw stands before, and a table with none of them gives nothing');
  const before = { ...REACTION_TUNE };
  tuneReactions({ niceAt: 10, every: Number.NaN });
  ok(REACTION_TUNE.niceAt === 10 && REACTION_TUNE.every === before.every && warmthOf(bookWith('freelance', { standing: 10 }), 'freelance') === 'nice', 'the thresholds move live, and only for a number');
  tuneReactions(before);
}

// ---- the client's string tables -----------------------------------------------------------------------------------
{
  let clock = 0;
  const asked: string[] = [];
  let fail = true;
  const fetcher = async (url: string) => {
    asked.push(url);
    if (url.includes('broken')) {
      if (fail) return { ok: false, status: 404, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({ hi_mid_1: 'Hello, %TU.', empty: '', __proto__: 'no' }) };
  };
  const s = new ClientStrings('/base/', fetcher, () => clock);
  const landed: string[] = [];
  s.onLoad((t) => landed.push(t));
  ok(s.look('npc_reaction/military', 'hi_mid_1') === null && s.has('npc_reaction/military') === false && s.hasKey('npc_reaction/military', 'x') === null, 'a line of a table that has not come answers null at once, and the table is set on its way');
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  ok(asked[0] === '/base/assets-private/conversations/strings/npc_reaction/military.json' && landed[0] === 'npc_reaction/military', 'it is fetched from beside the packs, by the client\'s own path, and its listeners are told');
  ok(s.look('npc_reaction/military', 'hi_mid_1') === 'Hello, %TU.' && s.look('npc_reaction/military', 'empty') === null && s.hasKey('npc_reaction/military', 'hi_mid_1') === true && s.hasKey('npc_reaction/military', 'nope') === false, 'then answered by key; an empty line is no line');
  s.want('npc_reaction/military');
  ok(asked.length === 1, 'and never fetched twice');
  s.want('conversation/broken');
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  s.want('conversation/broken');
  ok(asked.filter((u) => u.includes('broken')).length === 1, 'one that would not come is not asked for again at once');
  clock += STRINGS_TUNE.retry + 1;
  fail = false;
  s.want('conversation/broken');
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  ok(asked.filter((u) => u.includes('broken')).length === 2 && s.has('conversation/broken'), 'but after `retry` it is, and comes');
  s.want('../secret');
  s.want('a//b');
  s.want('conversation/../x');
  s.want('conversation/../../x');
  s.want('a/./b');
  ok(s.look('conversation/../../x', 's_1') === null, 'a line of a path that climbs is no line');
  ok(!isTablePath('../secret') && !isTablePath('a//b') && !isTablePath('conversation/../../x') && !isTablePath('a/./b') && !isTablePath('a/..') && isTablePath('conversation/heraldcorellia2') && asked.length === 3, 'a path that climbs, at its head or part way, or is not one, is never asked for');
  ok(fillName(s.look('npc_reaction/military', 'hi_mid_1')!, 'Kira') === 'Hello, Kira.' && fillName('%NU, go.', 'Kira') === 'Kira, go.' && fillName('no tokens', 'x') === 'no tokens', "the player's name goes where the client's words write %TU or %NU");
}

console.log(`\nreactions: ${checks} checks passed`);
