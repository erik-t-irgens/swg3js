// The debug menu's own arithmetic (src/ui/debugModel.ts), which is everything it does but draw: how
// the arguments box becomes a call's arguments, how an answer is shown and folded, how it is copied
// out as JSON, what the console said while a call ran and how the console is put back, what is kept
// of the history and the pins, and which group a helper is listed in.
//
// Everything here is synthetic: no browser, and the three.js objects are stand-ins carrying the flags
// three sets (`isVector3`, `isObject3D`), which is all the menu reads them by.
import assert from 'node:assert/strict';
import {
  CAPTURED_LEVELS,
  DEBUG_GROUPS,
  DEBUG_MENU_TUNE,
  OTHER_GROUP,
  bestMatch,
  callText,
  captureConsole,
  consoleText,
  describeValue,
  evaluateArgs,
  filterGroups,
  functionText,
  groupHelpers,
  isThenable,
  keepsColumns,
  numberText,
  PLACEHOLDER_HINT,
  pushHistory,
  readStore,
  searchScore,
  textTable,
  toJsonText,
  togglePin,
  writeStore,
  type ConsoleLike,
  type ConsoleLine,
  type HelperEntry,
  type ViewBranch,
  type ViewNode,
} from '../../../src/ui/debugModel.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const branchOf = (n: ViewNode): ViewBranch => {
  assert.equal(n.kind, 'branch');
  return n as ViewBranch;
};
const leafText = (n: ViewNode): string => (n.kind === 'leaf' ? n.text : `<${n.label}>`);
const entry = (b: ViewBranch, key: string) => b.entries().find((e) => e.key === key);

// ---------------------------------------------------------------------------------------------
// The arguments box.
{
  const args = (t: string) => {
    const r = evaluateArgs(t);
    return r.ok ? r.args : r.error;
  };
  ok(Array.isArray(args('')) && (args('') as unknown[]).length === 0 && (args('   ') as unknown[]).length === 0, 'an empty box is a call with no arguments');
  ok(JSON.stringify(args('{ go: true }')) === '[{"go":true}]', 'an object literal reads as one argument, as it would in the console');
  ok(JSON.stringify(args("'wolf', 14")) === '["wolf",14]', 'a list reads as that many arguments');
  ok(JSON.stringify(args('...[1, 2]')) === '[1,2]', 'a spread spreads');
  ok(JSON.stringify(args('7 // the seventh')) === '[7]', 'a line comment at the end does not swallow the closing bracket');
  ok(Math.abs((args('Math.PI / 2') as number[])[0] - Math.PI / 2) < 1e-12, "the page's own globals are in scope");
  ok(JSON.stringify(args('undefined, { tune: { reach: 12 } }')) === '[null,{"tune":{"reach":12}}]' && (args('undefined, 1') as unknown[])[0] === undefined, 'an argument left out on purpose stays undefined');
  const bad = evaluateArgs('{ go: }');
  ok(!bad.ok && /do not read as JavaScript/.test(bad.error), `a syntax error is said, not thrown (${bad.ok ? '' : bad.error})`);
  const threw = evaluateArgs("(() => { throw new Error('no'); })()");
  ok(!threw.ok && /threw: no/.test(threw.error), 'an expression that throws is said, with what it threw');
  const free = evaluateArgs('x, z');
  ok(!free.ok && /x is not defined/.test(free.error) && free.error.endsWith(PLACEHOLDER_HINT), `a README example's placeholder names say they are placeholders, and what to do about it (${free.ok ? '' : free.error})`);
  const typo = evaluateArgs('{ go: ture }');
  ok(!typo.ok && typo.error.includes('ture is not defined'), 'a name mistyped is named the same way');
  ok(!threw.ok && !threw.error.includes(PLACEHOLDER_HINT), 'and only a name nothing defines is said to be a placeholder, not every throw');
  ok(isThenable(Promise.resolve(1)) && isThenable({ then() {} }) && !isThenable({}) && !isThenable(null) && !isThenable(3), 'a promise, or anything with a then, is waited on; nothing else is');
}

// ---------------------------------------------------------------------------------------------
// Showing an answer.
{
  ok(leafText(describeValue(null)) === 'null' && leafText(describeValue(undefined)) === 'undefined', 'null and undefined say so');
  ok(leafText(describeValue('a"b')) === '"a\\"b"' && describeValue('x').kind === 'leaf', 'a string is quoted and escaped');
  ok(leafText(describeValue(0.1 + 0.2)) === '0.3' && leafText(describeValue(-0)) === '-0' && leafText(describeValue(NaN)) === 'NaN' && leafText(describeValue(12)) === '12', 'numbers read cleanly: six figures, whole numbers whole, -0 and NaN as they are');
  ok(numberText(1234567.891) === '1234570' && numberText(1e-9) === '1e-9', 'and very large and very small ones are still numbers');
  ok(leafText(describeValue(10n)) === '10n' && leafText(describeValue(true)) === 'true', 'a bigint and a boolean');
  ok(leafText(describeValue(Symbol('s'))) === 'Symbol(s)', 'a symbol');
  const long = 'x'.repeat(DEBUG_MENU_TUNE.stringMax + 10);
  ok(/… \([\d,]+ characters\)$/.test(leafText(describeValue(long))), 'a long string is cut and says how long it was');

  function aim(yaw: number, pitch: number) {
    return yaw + pitch;
  }
  ok(functionText(aim as (...a: unknown[]) => unknown) === 'ƒ aim(yaw, pitch)', `a function by its name and its parameters (${functionText(aim as (...a: unknown[]) => unknown)})`);
  const arrow = (o: number) => o * Math.max(1, 2);
  ok(functionText(arrow as (...a: unknown[]) => unknown) === 'ƒ arrow(o)', `an arrow's own brackets, not the first ones in its body (${functionText(arrow as (...a: unknown[]) => unknown)})`);
  const bare = eval('(q) => q') as (...a: unknown[]) => unknown;
  ok(functionText(bare).startsWith('ƒ (anonymous)(q)') || functionText(bare) === 'ƒ (anonymous)(q)', 'an anonymous one says so');
  class Thing {}
  ok(functionText(Thing as unknown as (...a: unknown[]) => unknown) === 'class Thing', 'a class says it is a class');
  ok(describeValue(aim).kind === 'leaf' && (describeValue(aim) as { tone: string }).tone === 'fn', 'and is drawn in the function colour');

  const small = branchOf(describeValue({ ready: true, standing: 3, name: 'wolf' }));
  ok(small.label === 'Object' && small.count === 3 && small.open, 'a small object is a branch, open at the top');
  ok(small.preview === '{ ready: true, standing: 3, name: "wolf" }', `with a one-line preview (${small.preview})`);
  ok(leafText(entry(small, 'standing')!.node) === '3', 'and its entries, keyed');

  const deep = branchOf(describeValue({ a: { b: { c: { d: 1 } } } }));
  const a = branchOf(entry(deep, 'a')!.node);
  const b = branchOf(entry(a, 'b')!.node);
  ok(a.open && !b.open, `nesting starts folded from depth ${DEBUG_MENU_TUNE.openDepth} down`);
  const wide: Record<string, number> = {};
  for (let i = 0; i < DEBUG_MENU_TUNE.openEntries + 1; i++) wide[`k${i}`] = i;
  ok(!branchOf(entry(branchOf(describeValue({ wide })), 'wide')!.node).open, 'and a large branch starts folded wherever it is');

  const list = Array.from({ length: 250 }, (_, i) => i);
  const lb = branchOf(describeValue(list));
  const le = lb.entries();
  ok(lb.label === 'Array(250)' && lb.count === 250, 'a list says how long it is');
  ok(le.length === DEBUG_MENU_TUNE.entriesShown + 1 && leafText(le[le.length - 1].node) === `… ${250 - DEBUG_MENU_TUNE.entriesShown} more`, 'and shows its first hundred, the rest summed up');
  ok(lb.preview.startsWith('[ 0, 1, 2') && !lb.preview.includes(':'), `a list's preview is its values, not its indices (${lb.preview})`);

  const loop: Record<string, unknown> = { name: 'loop' };
  loop.self = loop;
  loop.kids = [loop];
  const cb = branchOf(describeValue(loop));
  ok(leafText(entry(cb, 'self')!.node) === '[Circular ↑1]', 'a reference to itself is named, not followed');
  ok(leafText(branchOf(entry(cb, 'kids')!.node).entries()[0].node) === '[Circular ↑2]', 'and says how far up it points');
  const shared = { x: 1 };
  const twice = branchOf(describeValue({ p: shared, q: shared }));
  ok(entry(twice, 'p')!.node.kind === 'branch' && entry(twice, 'q')!.node.kind === 'branch', 'the same object twice, side by side, is not a cycle');

  const m = new Map<unknown, unknown>([['wolf', 3], [7, 'seven'], [{ id: 1 }, true]]);
  const mb = branchOf(describeValue(m));
  ok(mb.label === 'Map(3)' && mb.entries().map((e) => e.key).join('|') === 'wolf|7|{…}', `a Map by its keys (${mb.entries().map((e) => e.key).join(', ')})`);
  const sb = branchOf(describeValue(new Set(['a', 'b'])));
  ok(sb.label === 'Set(2)' && sb.entries().every((e) => e.key === null), 'a Set by its members');
  const tb = branchOf(describeValue(new Float32Array([1.5, 2.5])));
  ok(tb.label === 'Float32Array(2)' && leafText(tb.entries()[1].node) === '2.5', 'a typed array like a list');
  ok(leafText(describeValue(new Date(0))) === '1970-01-01T00:00:00.000Z' && leafText(describeValue(/a+/g)) === '/a+/g', 'a date and a pattern on one line');
  const eb = branchOf(describeValue(new RangeError('too far')));
  ok(eb.label === 'RangeError: too far' && eb.error, 'an Error by its name and message, in the error colour');

  const getterThrows = Object.defineProperty({}, 'bad', { enumerable: true, get() { throw new Error('nope'); } });
  ok(leafText(entry(branchOf(describeValue(getterThrows)), 'bad')!.node) === '(threw: nope)', 'a getter that throws says what it threw');

  // three's own, by their flags.
  const v3 = { isVector3: true, x: 1, y: 2.5, z: -3 };
  ok(leafText(describeValue(v3)) === 'Vector3(1, 2.5, -3)', "three's vectors on one line");
  ok(leafText(describeValue({ isQuaternion: true, x: 0, y: 0, z: 0, w: 1 })) === 'Quaternion(0, 0, 0, 1)', 'and quaternions');
  ok(leafText(describeValue({ isColor: true, r: 1, g: 0.5, b: 0 })) === 'Color(#ff8000)', 'and colours');
  const parent = { isObject3D: true, type: 'Scene', name: 'world', children: [] as unknown[], position: v3, visible: true };
  const mesh: Record<string, unknown> = { isObject3D: true, isMesh: true, type: 'Mesh', name: 'hull', uuid: 'u1', visible: true, position: v3, quaternion: { isQuaternion: true, x: 0, y: 0, z: 0, w: 1 }, scale: v3, layers: { mask: 1 }, children: [], userData: { glass: true }, parent, geometry: { isBufferGeometry: true, type: 'BufferGeometry', name: '', attributes: { position: { count: 24, itemSize: 3 } }, index: null }, material: { isMaterial: true, type: 'MeshStandardMaterial', name: 'hull', opacity: 1 }, matrixWorld: { elements: new Array(16).fill(0) } };
  parent.children.push(mesh);
  const ob = branchOf(describeValue(mesh));
  ok(ob.label === 'Mesh "hull"' && /0 children/.test(ob.preview), `a three object by its type and name (${ob.label}, ${ob.preview})`);
  const keys = ob.entries().map((e) => e.key);
  ok(keys.includes('position') && keys.includes('material') && keys.includes('geometry') && !keys.includes('parent') && !keys.includes('matrixWorld'), 'with the handful of things worth knowing about it, and not its parent or its matrices');
  ok(leafText(entry(ob, 'position')!.node) === 'Vector3(1, 2.5, -3)', 'its place on one line');
  ok(branchOf(entry(ob, 'geometry')!.node).entries().some((e) => e.key === 'vertices' && leafText(e.node) === '24'), 'its geometry by its size, not its arrays');
  ok(branchOf(entry(ob, 'material')!.node).label === 'MeshStandardMaterial "hull"', 'its material by its type and name');
  ok(entry(ob, '(every field)')!.node.kind === 'branch', 'and every other field one fold further in');
}

// ---------------------------------------------------------------------------------------------
// Copying an answer out.
{
  const loop: Record<string, unknown> = { a: 1 };
  loop.me = loop;
  const j = JSON.parse(toJsonText(loop));
  ok(j.a === 1 && j.me === '[Circular]', 'a cycle is named in the JSON');
  const jm = JSON.parse(toJsonText({ m: new Map([['x', 1]]), s: new Set([1, 2]), odd: new Map([[1, 'one']]) }));
  ok(jm.m.x === 1 && JSON.stringify(jm.s) === '[1,2]' && JSON.stringify(jm.odd) === '[[1,"one"]]', 'a Map of words as an object, any other Map as pairs, a Set as a list');
  const jv = JSON.parse(toJsonText({ at: { isVector3: true, x: 1, y: 2, z: 3 }, f: function go() {}, big: 5n, n: NaN, u: undefined }));
  ok(jv.at.x === 1 && jv.at.z === 3 && jv.f === 'ƒ go()' && jv.big === '5n' && jv.n === 'NaN' && !('u' in jv), 'vectors as numbers, functions by name, bigints and NaN as words, undefined left out');
  const jo = JSON.parse(toJsonText({ isObject3D: true, type: 'Group', name: 'g', uuid: 'u', children: [1, 2] }));
  ok(jo.type === 'Group' && jo.children === 2, 'a three object summed up');
  ok(toJsonText(undefined) === 'undefined' && toJsonText('x') === '"x"', 'and the plain answers as they are');
}

// ---------------------------------------------------------------------------------------------
// What the console said.
{
  ok(consoleText('log', ['plain']) === 'plain', 'a plain line');
  ok(consoleText('log', ['%s has %d', 'wolf', 3.7, 'left']) === 'wolf has 3 left', 'the format directives the console honours, and the rest after a space');
  ok(consoleText('log', ['%cstyled%c text', 'color: red', '']) === 'styled text', 'a style directive prints nothing');
  ok(consoleText('warn', ['n', { a: 1 }]) === 'n {"a":1}', 'an object as its JSON');
  ok(consoleText('log', ['at', { isVector3: true, x: 1, y: 2, z: 3 }]) === 'at Vector3(1, 2, 3)', "and three's vectors as they read");
  ok(consoleText('log', ['100%%']) === '100%', 'a doubled percent is one');
  const table = textTable([{ id: 'a', n: 1 }, { id: 'b', n: 22 }]);
  const tl = table.split('\n');
  ok(tl.length === 4 && tl[0].startsWith('(index)') && tl[0].includes('id') && tl[3].includes('22'), `console.table as a text table:\n${table}`);
  ok(textTable({ x: 1, y: 'two' }).includes('Values'), 'rows that are not objects go in a column of values');
  ok(consoleText('table', [[{ id: 'a' }]]).startsWith('(index)'), 'and console.table is drawn that way');
  // Laid out in columns: drawn without wrapping, so a row wider than the window scrolls rather than breaking.
  ok(keepsColumns('table', table) && keepsColumns('table', 'one row'), 'a console.table keeps its columns, however many rows');
  ok(keepsColumns('log', 'perf: 120 frames of play\n  frame  p50 6.9') && keepsColumns('log', 'a\nb'), "a report of several lines (perf's own) keeps them too");
  ok(!keepsColumns('log', 'x'.repeat(400)) && !keepsColumns('warn', 'one long sentence of prose'), 'and a single line of prose still wraps, so it is read whole');

  const printed: string[] = [];
  const fake: ConsoleLike = {};
  for (const level of CAPTURED_LEVELS) fake[level] = (...a: unknown[]) => printed.push(`${level}:${a.join(' ')}`);
  const originals = { ...fake };
  const heard: ConsoleLine[] = [];
  const stop = captureConsole(fake, (l) => heard.push(l));
  fake.log!('one');
  fake.warn!('two %s', 'x');
  ok(heard.length === 2 && heard[1].level === 'warn' && heard[1].text === 'two x', 'every line printed while the call runs is heard');
  ok(printed.join('|') === 'log:one|warn:two %s x', 'and still goes to the console as it would have');
  // Somebody else hangs a wrapper of their own on log while ours is on, and calls through to what it
  // replaced, as the dev server's own console forwarding does: ours is then still in the chain after
  // it has been put back, and must go quiet there rather than keep collecting a finished call's lines.
  const under = fake.log!;
  const theirs = (...a: unknown[]) => {
    printed.push(`theirs:${a.join(' ')}`);
    under(...a);
  };
  fake.log = theirs;
  fake.log('during');
  ok(heard.length === 3 && heard[2].text === 'during', 'a line through a wrapper hung over ours while the call runs is heard');
  stop();
  ok(fake.warn === originals.warn && fake.error === originals.error, 'putting it back puts back the methods it wrapped');
  ok(fake.log === theirs, "and leaves a wrapper somebody hung over ours in place, so it never unplugs theirs");
  fake.warn!('after');
  ok(heard.length === 3, 'and hears nothing once it is put back');
  const printedWas = printed.length;
  fake.log('after the call finished');
  ok(heard.length === 3, 'not even through the wrapper still hung over ours: ours stays in their chain, and goes quiet there');
  ok(printed.length === printedWas + 2 && printed[printed.length - 1] === 'log:after the call finished', 'and the line still reaches the console, through theirs and ours alike');

  const ours: ConsoleLike = { log: (..._a: unknown[]) => {} };
  const stopA = captureConsole(ours, () => {});
  const heardB: ConsoleLine[] = [];
  const stopB = captureConsole(ours, (l) => heardB.push(l));
  stopA();
  ours.log!('b hears this');
  ok(heardB.length === 1, 'two listeners in turn: the first letting go does not unplug the second');
  stopB();
  const bad: ConsoleLike = { log: () => {} };
  const stopBad = captureConsole(bad, () => {
    throw new Error('a listener that breaks');
  });
  let threw = false;
  try {
    bad.log!('x');
  } catch {
    threw = true;
  }
  stopBad();
  ok(!threw, 'a listener that throws never takes the console down with it');
}

// ---------------------------------------------------------------------------------------------
// What is kept.
{
  ok(readStore(null).history.length === 0 && readStore('not json').pinned.length === 0 && readStore('[1,2]').last === null, 'nothing kept, or nothing readable, is an empty store');
  const text = JSON.stringify({ history: [{ helper: 'perf', on: 'debug', args: '{ frames: 240 }', at: 5 }, { helper: '__proto__', args: '' }, { helper: 'no good', args: '' }, 7], pinned: [{ helper: 'hud', args: '' }, { helper: 'hud', args: ' ' }, { helper: '__sharedDay', on: 'window', args: '' }], last: { helper: 'wild', args: 1 } });
  const s = readStore(text);
  ok(s.history.length === 1 && s.history[0].helper === 'perf' && s.history[0].at === 5, 'the history is read back, and a name that is not a name is dropped (`__proto__` among them)');
  ok(s.pinned.length === 2 && s.pinned[1].on === 'window', 'the pins too, the same call pinned twice read once, and a window knob kept as one');
  ok(s.last?.helper === 'wild' && s.last.args === '', 'and what was picked last, arguments that are not text read as none');
  ok(JSON.stringify(readStore(writeStore(s))) === JSON.stringify(s), 'what is written reads back as it was');

  let h = pushHistory([], { helper: 'perf', on: 'debug', args: '' }, 1);
  h = pushHistory(h, { helper: 'hud', on: 'debug', args: '{ boxes: true }' }, 2);
  h = pushHistory(h, { helper: 'perf', on: 'debug', args: ' ' }, 3);
  ok(h.map(callText).join(' ') === 'perf() hud({ boxes: true })' && h[0].at === 3, 'the same call run again moves to the top rather than being kept twice');
  for (let i = 0; i < DEBUG_MENU_TUNE.historyMax + 5; i++) h = pushHistory(h, { helper: 'time', on: 'debug', args: String(i) }, 10 + i);
  ok(h.length === DEBUG_MENU_TUNE.historyMax && h[0].args === String(DEBUG_MENU_TUNE.historyMax + 4), `and the history keeps the last ${DEBUG_MENU_TUNE.historyMax}`);

  const p1 = togglePin([], { helper: 'hud', on: 'debug', args: '' });
  ok(p1.pinned && p1.list.length === 1, 'a call is pinned');
  const p2 = togglePin(p1.list, { helper: 'hud', on: 'debug', args: '  ' });
  ok(!p2.pinned && p2.list.length === 0, 'and pinning it again unpins it');
  ok(callText({ helper: '__sharedDay', on: 'window', args: ' { release: true } ' }) === '__sharedDay({ release: true })', 'a kept call reads as the call it is');
}

// ---------------------------------------------------------------------------------------------
// The groups and the search.
{
  const e = (name: string, haystack = '', on: 'debug' | 'window' = 'debug'): HelperEntry => ({ name, on, haystack });
  const helpers = [e('perf', 'the frame report'), e('teleport', 'move'), e('brandNew'), e('__sharedDay', 'the clock the world shares', 'window'), e('hud', 'what the head-up display costs')];
  const groups = groupHelpers(helpers);
  const titles = groups.map((g) => g.title);
  ok(titles[titles.length - 1] === OTHER_GROUP && groups[groups.length - 1].entries[0].name === 'brandNew', 'a helper nobody filed is listed under Other, last');
  ok(groups.find((g) => g.title === 'Playing together')?.entries[0].name === '__sharedDay', "the window's own knobs are filed by their own names");
  ok(!titles.includes('Sound'), 'a group with nothing in it is left out');
  ok(groups.flatMap((g) => g.entries).length === helpers.length, 'and every helper is listed exactly once');
  const all = DEBUG_GROUPS.flatMap((g) => g.helpers);
  ok(new Set(all).size === all.length, `no helper is filed under two groups (${all.length})`);

  ok(searchScore(e('perf'), 'perf') === 0 && searchScore(e('perfMarks'), 'perf') === 1 && searchScore(e('flowPerf'), 'perf') === 2, 'the search ranks the name itself, then a name starting with it, then one holding it');
  ok(searchScore(e('bench', 'draw thirty frames'), 'frames') === 4 && searchScore(e('bench', 'draw thirty frames'), 'sound') === -1, 'and finds a helper by what its row says, after all of those');
  ok(searchScore(e('hud', 'what the head-up display costs'), 'hud costs') >= 0 && searchScore(e('hud', 'what the display costs'), 'hud sound') === -1, 'every word of the query has to be found');
  const found = filterGroups(groups, 'the');
  ok(found.every((g) => g.entries.every((h) => searchScore(h, 'the') >= 0)), 'the filtered groups hold only what answers');
  ok(filterGroups(groups, '').flatMap((g) => g.entries).length === helpers.length, 'and an empty search is everything');
  ok(filterGroups(groups, 'zzz').length === 0, 'and a search nothing answers is nothing');
  // Enter picks the best answer, not the first group's: the smoke test had "perf" open `ride`,
  // whose README row mentions perf, because its group is listed before the frame cost's.
  const listed = groupHelpers([e('ride', 'await perf({ at: here })'), e('perf', 'the frame report'), e('perfMarks')]);
  ok(listed[0].entries[0].name === 'ride', 'a helper that only mentions the word can be listed first');
  ok(bestMatch(listed, 'perf')?.name === 'perf' && bestMatch(listed, 'perfm')?.name === 'perfMarks' && bestMatch(listed, 'zzz') === null, 'and still Enter takes the one the search names best');
}

console.log(`\n${checks} checks passed`);
