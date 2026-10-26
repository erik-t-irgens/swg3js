// The world editor's library (DESIGN.md §2.5): without the `library` pass's index it falls back on the props catalogue,
// the gallery's list and this world's own models and flora, with initials for pictures; a search over 29,000 rows finds
// exactly what a plain filter finds; a group shows a page of 120 at a time; Recent and Favourites are kept through a
// storage that may refuse (a private window), the session's own copy answering then; and Used here names the entries
// this world's files already stand, most used first.
import assert from 'node:assert/strict';
import { ENTRY_FLAG, LIBRARY_VERSION, LibraryKeep, entryKey, fallbackEntries, groupsOf, haystackOf, libraryView, packsOf, pageOf, readLibraryIndex, searchLibrary, usedHereKeys, type LibraryEntry } from '../../../src/editor/libraryModel.ts';
import { LIBRARY_TUNE } from '../../../src/editor/editorTune.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

{
  const entries = fallbackEntries({
    props: [
      { id: 'test_chair', model: 'chair_a', name: 'TEST chair', group: 'furniture', template: 'object/tangible/test/shared_chair.iff', size: { w: 1, h: 1, d: 1 }, icon: 'icons/chair_a.png' },
      { id: 'test_crate', model: 'crate_a', name: null, group: 'containers', template: null },
    ],
    gallery: { sections: [{ id: 'houses', items: [{ model: 'test_house', label: 'TEST house', template: 'object/building/test/shared_house.iff' }] }, { id: 'weapons', items: [{ model: 'test_gun' }] }] },
    world: { id: 'testworld', manifest: { categories: { layout: [{ id: 'test_hut', cells: [{}, {}] }, { id: 'test_fire', particle: true }, { id: 'test_rock' }], flora: [{ id: 'test_tree', familyName: 'TEST family' }] } } },
  });
  const keys = entries.map(entryKey);
  ok(keys.includes('props:test_chair') && keys.includes('props:test_crate'), "without an index the props catalogue's things are there");
  ok(entries.find((e) => e.id === 'test_chair')?.pic === 'props/icons/chair_a.png' && entries.find((e) => e.id === 'test_crate')?.pic === null, 'with their own pictures where they have one, initials otherwise');
  ok(keys.includes('buildings:shared_house') || keys.some((k) => k.startsWith('buildings:')), "the gallery's houses are there");
  ok(!entries.some((e) => e.m === 'test_gun'), "and nothing of the gallery's weapons or vehicles");
  ok(keys.includes('world:testworld:test_hut') && keys.includes('world:testworld:test_rock') && !keys.includes('world:testworld:test_fire'), "this world's own models are there (its effects are not models)");
  ok((entries.find((e) => e.id === 'test_hut')!.f & ENTRY_FLAG.building) !== 0, 'one with rooms is a building');
  ok(keys.includes('flora:testworld:test_tree'), 'and its flora');
  ok(readLibraryIndex({ version: LIBRARY_VERSION + 1, entries: [] }) === null, 'an index of another shape is read as none');
  ok(readLibraryIndex({ version: LIBRARY_VERSION, made: 'x', packs: {}, entries: [{ s: 'props', p: 'props', id: 'a', m: 'b' }, { s: 'nonsense', p: 'x', id: 'c', m: 'd' }] })!.entries.length === 1, 'an entry of a source this build has not got is passed over');
}

{
  const words = ['chair', 'table', 'crate', 'lamp', 'barrel', 'tree', 'rock', 'house', 'fountain', 'banner', 'statue', 'terminal'];
  const sources = ['props', 'buildings', 'world', 'flora'] as const;
  const entries: LibraryEntry[] = [];
  for (let i = 0; i < 29_000; i++) {
    const w = words[i % words.length];
    const w2 = words[(i * 7) % words.length];
    entries.push({ s: sources[i % 4], p: i % 4 >= 2 ? (i % 3 === 0 ? 'naboo' : 'tatooine') : i % 4 === 0 ? 'props' : 'gallery', id: `${w}_${w2}_${i}`, m: `m_${i}`, n: i % 5 === 0 ? null : `TEST ${w2} ${w} ${i}`, g: `group_${i % 37}`, t: null, sz: [1, 1, 1], tri: 12, pic: null, f: 0 });
  }
  const v = libraryView(entries);
  const plain = (source: string | null, q: string, pack: string | null) => {
    const ws = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return entries.filter((e) => (!source || e.s === source) && (!pack || e.p === pack) && ws.every((w) => haystackOf(e).includes(w)));
  };
  let same = true;
  let compared = 0;
  const t0 = performance.now();
  for (const [source, q, pack] of [
    [null, 'chair', null],
    ['props', 'crate lamp', null],
    ['world', 'tree', 'naboo'],
    ['flora', 'group_3', 'tatooine'],
    [null, '', null],
    ['buildings', 'TEST house', null],
  ] as [string | null, string, string | null][]) {
    const a = searchLibrary(v, source as never, q, pack);
    const b = plain(source, q, pack);
    compared += a.length;
    if (a.length !== b.length || a.some((e, i) => e !== b[i])) same = false;
  }
  const ms = performance.now() - t0;
  ok(same && compared > 0, `a search over 29,000 rows finds exactly what a plain filter finds, in the index's own order (${compared} found over six, ${ms.toFixed(1)} ms with the filter's own time)`);
  const first = pageOf(entries, 0);
  const second = pageOf(entries, 1);
  ok(LIBRARY_TUNE.page === 120 && first.length === 120 && second[0] === entries[120], 'a page is 120, the next page the next 120');
  ok(pageOf(entries, Math.floor(29_000 / 120)).length === 29_000 % 120, 'and the last page what is left');
  const groups = groupsOf(entries);
  ok(groups.length === 37 && groups.reduce((n, g) => n + g.count, 0) === 29_000 && groups[0].count >= groups[groups.length - 1].count, 'the groups count every row, most first');
  ok(packsOf(entries, 'world').join(',') === 'naboo,tatooine', 'the worlds a source spans, for its chooser');
}

{
  // A storage that refuses every read and write: the session's copy answers.
  const refusing = {
    getItem: (): string | null => {
      throw new Error('refused');
    },
    setItem: (): void => {
      throw new Error('refused');
    },
  };
  const keep = new LibraryKeep(refusing);
  for (let i = 0; i < LIBRARY_TUNE.recent + 5; i++) keep.noteUsed(`props:thing_${i}`);
  keep.noteUsed('props:thing_3');
  ok(keep.recent.length === LIBRARY_TUNE.recent && keep.recent[0] === 'props:thing_3' && new Set(keep.recent).size === keep.recent.length, `Recent holds the last ${LIBRARY_TUNE.recent}, newest first, each once, with storage refusing`);
  ok(keep.toggleFavourite('props:thing_1') && keep.favourites.includes('props:thing_1') && !keep.toggleFavourite('props:thing_1') && !keep.favourites.includes('props:thing_1'), 'a star turns on and off');
  keep.setHotbar(3, 'props:thing_2');
  keep.setHotbar(12, 'props:nothing');
  ok(keep.hotbar[2] === 'props:thing_2' && keep.hotbar.length === 9, 'a hotbar slot is set; a slot past nine is not');
  // And a storage that works keeps them for the next session.
  const map = new Map<string, string>();
  const good = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  const a = new LibraryKeep(good);
  a.noteUsed('props:x');
  a.toggleFavourite('flora:naboo:y');
  const b = new LibraryKeep(good);
  ok(b.recent[0] === 'props:x' && b.favourites.includes('flora:naboo:y'), 'kept in local storage, read back by the next session');
  map.set('swg.editor.recent', '{not json');
  ok(new LibraryKeep(good).recent.length === 0, 'and storage that holds rubbish reads as nothing');
}

{
  // Used here: the entries this world's files already stand, most used first.
  const e = (s: LibraryEntry['s'], p: string, id: string, m: string, t: string | null = null): LibraryEntry => ({ s, p, id, m, n: null, g: 'g', t, sz: [0, 0, 0], tri: 0, pic: null, f: 0 });
  const view = libraryView([
    e('props', 'props', 'test_chair', 'chair_a'),
    e('props', 'props', 'test_crate', 'crate_a'),
    e('buildings', 'gallery', 'test_house', 'house_m', 'object/building/test/shared_test_house.iff'),
    e('buildings', 'gallery', 'test_house_b', 'house_m', 'object/building/test/shared_test_house_b.iff'),
    e('world', 'tatooine', 'test_rock', 'rock_m', 'object/static/test/shared_test_rock.iff'),
    e('world', 'naboo', 'test_tree_placed', 'tree_m', 'object/tangible/test/shared_test_tree.iff'),
    e('flora', 'naboo', 'tree_m', 'tree_m'),
    e('flora', 'naboo', 'bush_m', 'bush_m'),
  ]);
  const rows = [
    { pack: 'props', thing: 'test_chair' },
    { pack: 'props', thing: 'test_chair' },
    { pack: 'props', thing: 'test_chair' },
    { pack: 'props', thing: 'nothing_like_it' },
    { pack: 'gallery', model: 'house_m', template: 'object/building/test/shared_test_house_b.iff' },
    { pack: 'gallery', model: 'house_m' },
    { pack: 'world', model: 'rock_m', template: 'object/static/test/shared_test_rock.iff' },
    { pack: 'world', model: 'tree_m', template: 'object/tangible/test/shared_test_tree.iff', from: 'naboo' },
    { pack: 'world', model: 'bush_m', from: 'naboo' },
    { pack: 'world', model: 'rock_m', from: 'naboo' },
  ];
  const used = usedHereKeys(view, rows, 'tatooine');
  ok(used[0] === 'props:test_chair', `the most used first (${used.join(', ')})`);
  ok(used.includes('buildings:test_house_b') && used.includes('buildings:test_house'), "a gallery row is its template's building where it names one, else its model's");
  ok(used.includes('world:tatooine:test_rock') && used.includes('world:naboo:test_tree_placed') && used.includes('flora:naboo:bush_m'), "a world row is its model's entry in its own world or the one it names, the planting where nothing placed it");
  ok(!used.includes('props:test_crate') && used.length === 6, 'and a row no entry answers, or a model of another world it is not in, is left out');
}

console.log(`\n${checks} checks passed`);
