// The README's Debugging table read as data (src/ui/debugReadme.ts), and the one promise the debug
// menu rests on: that every helper the game hangs on `window.__debug` has a row there.
//
// The menu lists what `__debug` really holds, so a helper with no row still shows -- as a bare name
// with nothing to say about it and nothing to put in its box. That is the failure pinned here, from
// the source, since node cannot load `main.ts`: the TypeScript parser reads every file that names the
// toolbox, so the literal that makes `__debug` is read key by key, and so are the helpers the game
// hangs on it afterwards, in `main.ts` and in the modules that hang their own (the sabers' report,
// the marks, the nebulae, ...), and the window's own knobs (`__sharedDay` and the rest). A name the
// table has and the game does not is said, not failed: the menu leaves it out of the list, and it is
// the README's to tidy.
//
// Nothing is read from the game's own files. The README and the TypeScript sources are all it needs.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { closingBracket, codeSpans, docKey, docsByHelper, escapeHtml, firstArgs, inlineMarkdown, parseCall, parseDebugTable, splitRow } from '../../../src/ui/debugReadme.ts';
import { DEBUG_GROUPS, PLACEHOLDER_HINT, evaluateArgs } from '../../../src/ui/debugModel.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const root = new URL('../../../', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), 'utf8');
const readme = read('README.md');

// ---------------------------------------------------------------------------------------------
// The pieces, on made-up input.
{
  ok(splitRow('| `a()` | b |').join('¦') === '`a()`¦b', 'a row splits into its two cells, the outer pipes dropped');
  ok(splitRow('| `x()` | one \\| two |')[1] === 'one | two', 'an escaped pipe stays in its cell as a plain pipe');
  ok(closingBracket("say('(', 1)", 3) === 10, 'a bracket inside a string does not close the call');
  ok(closingBracket('f({ a: [1, 2] })', 1) === 15, 'nested brackets close where they should');
  ok(closingBracket('f(1', 1) === -1, 'an unclosed call is said to be unclosed');

  const plain = parseCall('teleport(x, z)')!;
  ok(plain.helper === 'teleport' && plain.on === 'debug' && plain.args === 'x, z' && !plain.awaits, 'a plain call: its helper and the inside of its brackets');
  const awaited = parseCall('await perf({ fly: { speed: 120, heading: Math.PI / 2 } })')!;
  ok(awaited.helper === 'perf' && awaited.awaits && awaited.args === '{ fly: { speed: 120, heading: Math.PI / 2 } }', 'an awaited call keeps its whole argument, nested brackets and all');
  const after = parseCall('hud().messages')!;
  ok(after.helper === 'hud' && after.args === '' && after.after === '.messages', "what an example does with the answer is kept apart from the call's own arguments");
  const named = parseCall('wear')!;
  ok(named.helper === 'wear' && named.args === null, 'a helper named without being called has no arguments at all, not empty ones');
  const prefixed = parseCall('__debug.session()')!;
  ok(prefixed.helper === 'session' && prefixed.on === 'debug', '`__debug.` in front names the toolbox, not the window');
  const knob = parseCall('__sharedDay({ release: true })')!;
  ok(knob.helper === '__sharedDay' && knob.on === 'window' && knob.args === '{ release: true }', "a name beginning `__` on its own is the window's own knob");
  ok(parseCall('3 + 4') === null && parseCall("'wolf'") === null && parseCall('window.__debug') === null, 'a span that does not start with a helper\'s name is not a call');

  ok(codeSpans('a `b()` and `c(1)`').join('|') === 'b()|c(1)', 'the code spans of a cell, backticks off');
  ok(escapeHtml('<b a="1">&') === '&lt;b a=&quot;1&quot;&gt;&amp;', 'text is escaped before it goes in the page');
  const md = inlineMarkdown('**bold** `<code>` and *soft* <script>x</script>');
  ok(md.includes('<b>bold</b>') && md.includes('<code>&lt;code&gt;</code>') && md.includes('<i>soft</i>') && !md.includes('<script>'), "the README's markdown becomes markup and nothing else does");
}

// ---------------------------------------------------------------------------------------------
// The real README.
const rows = parseDebugTable(readme);
const docs = docsByHelper(rows);
{
  const lines = readme.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Debugging\s*$/.test(l));
  const end = lines.findIndex((l, i) => i > start && /^##\s+\S/.test(l));
  const tableLines = lines.slice(start, end).filter((l) => l.trimStart().startsWith('|')).length;
  ok(start >= 0 && end > start, `the Debugging section is found (lines ${start + 1} to ${end})`);
  ok(rows.length === tableLines - 2, `every table line but the header and its rule is a row (${rows.length} of ${tableLines})`);
  ok(rows.length > 100, `and there are plenty of them (${rows.length})`);
  ok(rows.every((r) => lines[r.line - 1].trimStart().startsWith('|')), "every row's line number points at its own line");
  ok(rows.every((r) => r.description.trim().length > 0), 'every row says what its helpers do');
  const empty = rows.filter((r) => !r.calls.length);
  ok(empty.length === 0, `every row names at least one helper${empty.length ? `: lines ${empty.map((r) => r.line).join(', ')}` : ''}`);
  // Every span in a first cell is a call: a span that did not read as one would be a helper the
  // menu cannot find, or a note the first column should not be carrying.
  const strays: string[] = [];
  for (const r of rows) for (const s of codeSpans(r.usage)) if (!parseCall(s)) strays.push(`${r.line}: ${s}`);
  ok(strays.length === 0, `every code span in a first cell reads as a call${strays.length ? `: ${strays.join('; ')}` : ''}`);
  const unclosed: string[] = [];
  for (const r of rows) for (const c of r.calls) if (c.args !== null && c.code.includes('(') && closingBracket(c.code, c.code.indexOf('(')) < 0) unclosed.push(`${r.line}: ${c.code}`);
  ok(unclosed.length === 0, `every example closes its own brackets${unclosed.length ? `: ${unclosed.join('; ')}` : ''}`);
  ok(docs.size > 200, `the rows gather into a doc per helper (${docs.size})`);

  const perf = docs.get('perf');
  ok(!!perf && perf.rows.length >= 5, `a helper named on several rows gathers all of them (perf: ${perf?.rows.length} rows)`);
  ok(!!perf && perf.examples.some((e) => e.args === '{ frames: 240 }' && e.awaits), 'and its examples, with their arguments, awaits and all');
  ok(firstArgs(perf) === '', "the box starts from the first example, which for perf is the bare call");
  ok(firstArgs(docs.get('teleport')) === 'x, z', 'and for teleport what the README writes inside its brackets');
  ok(firstArgs(docs.get('npcShip')) === "'tiefighter_tier1', { distance: 400 }", "a quoted name and an object come across as written");
  // Every example's arguments read as JavaScript, and the only ones that do not run are the
  // README's placeholders (`x, z`), which the box says are values to fill in rather than failing
  // blankly. The helpers whose box starts from one have, today, no other example to start from
  // instead, and an empty box would be worse: `teleport()` with nothing puts the player at NaN.
  const broken: string[] = [];
  const placeholders = new Set<string>();
  for (const [key, doc] of docs) {
    for (const e of doc.examples) {
      if (e.args === null) continue;
      const r = evaluateArgs(e.args);
      if (r.ok) continue;
      if (r.error.endsWith(PLACEHOLDER_HINT)) placeholders.add(key);
      else broken.push(`${key}: ${e.code} (${r.error})`);
    }
  }
  ok(broken.length === 0, `every example's arguments read, or name a placeholder${broken.length ? `: ${broken.join('; ')}` : ` (${placeholders.size} helpers write one)`}`);
  const startsOnPlaceholder = [...docs].filter(([, d]) => !evaluateArgs(firstArgs(d)).ok).map(([k]) => k);
  const couldStartElsewhere = startsOnPlaceholder.filter((k) => docs.get(k)!.examples.some((e) => e.args !== null && evaluateArgs(e.args).ok));
  console.log(`note ${startsOnPlaceholder.length} helper(s) start on a placeholder (${startsOnPlaceholder.join(', ')}); ${couldStartElsewhere.length} of them have an example that runs as well${couldStartElsewhere.length ? `: ${couldStartElsewhere.join(', ')}` : ''}`);
  // A helper's own row first: `ride` is named at the end of the detail levels' row, and that row is
  // not what `ride` does. Every helper some row starts with opens on one of those.
  const ride = docs.get('ride')!;
  ok(ride.rows[0].calls[0].helper === 'ride' && firstArgs(ride) === '', `a helper opens on its own row, not one that mentions it on the way (ride: line ${ride.rows[0].line})`);
  const misled: string[] = [];
  for (const [key, doc] of docs) {
    const own = doc.rows.some((r) => docKey(r.calls[0].helper, r.calls[0].on) === key);
    if (own && docKey(doc.rows[0].calls[0].helper, doc.rows[0].calls[0].on) !== key) misled.push(key);
  }
  ok(misled.length === 0, `and so does every helper that has a row of its own${misled.length ? `: ${misled.join(', ')}` : ''}`);
  const hud = docs.get('hud');
  ok(!!hud && hud.examples.some((e) => e.after === '.messages'), "`hud().messages` is kept as the example it is");
  ok(docs.get('wear')?.examples[0].args === null && firstArgs(docs.get('wear')) === '', 'a helper only named (`wear`) starts with an empty box');
  ok(docs.has(docKey('__sharedDay', 'window')) && !docs.has('__sharedDay'), "the window's own knobs are filed apart from the toolbox's");
  // `roomAir`'s row writes `view: 'haze' \| 'patch' \| null` inside a code span. It is a row the game's
  // own helper has, so it stays when the README's stale names are tidied away; a check that let a
  // missing row pass would stop testing anything the day it went.
  const roomAir = docs.get('roomAir');
  ok(!!roomAir && roomAir.rows[0].description.includes("view: 'haze' | 'patch' | null"), "a pipe the README escapes inside a description comes through as a pipe");
  ok(!!roomAir && !/\\\|/.test(roomAir.rows[0].description) && inlineMarkdown(roomAir.rows[0].description).includes("<code>view: &#39;haze&#39; | &#39;patch&#39; | null</code>"), 'with no backslash left in it, code span and all');
  // Four examples are written on two rows each (`hurt(180)`, `hit(12, true)`, `mobileCull()` and
  // `await perf({ census: true })`): each helper offers each once, not a chip per row.
  const repeated: string[] = [];
  for (const [key, doc] of docs) {
    const codes = doc.examples.map((e) => e.code);
    if (new Set(codes).size !== codes.length) repeated.push(key);
  }
  ok(repeated.length === 0, `no helper offers the same example twice${repeated.length ? `: ${repeated.join(', ')}` : ''}`);
  const writtenTwice = ['hurt(180)', 'hit(12, true)', 'mobileCull()', 'await perf({ census: true })'].filter((code) => rows.filter((r) => r.calls.some((c) => c.code === code)).length >= 2);
  ok(writtenTwice.length === 4, `though the README writes these on two rows each, which is what that is for (${writtenTwice.join(', ')})`);
  ok(docs.get('hurt')!.examples.filter((e) => e.code === 'hurt(180)').length === 1, 'hurt offers hurt(180) once');
  const menuRow = docs.get('debugMenu');
  ok(!!menuRow && /Escape menu/.test(menuRow.rows[0].description), 'the debug menu has a row of its own');
  ok(/\*\*The debug menu\*\*/.test(readme.slice(readme.indexOf('## Debugging'))), "and the section's introduction says what it is");
}

// ---------------------------------------------------------------------------------------------
// Reading the source for what it hangs on `__debug` and on the window.
//
// The TypeScript parser reads it, the one the build already carries, rather than a pattern over its
// lines: a pattern knows only today's shapes, and a helper written any other way -- a shorthand key,
// a quoted one, `Object.assign` onto the toolbox, a module's own name for its handle, a knob hung
// with an inline arrow or another cast -- would slip past it with the test still passing. What the
// reader cannot name (a spread into the toolbox, a key worked out at run time) is not skipped either:
// it is said, and fails the check, since a helper hung that way can have no row the test could find.
const ts = createRequire(import.meta.url)('typescript') as typeof import('typescript');

interface SourceHelpers {
  /** Every name hung on `__debug`, with where. */
  keys: Map<string, string>;
  /** Every function hung on the window under a name beginning `__`, with where. */
  knobs: Map<string, string>;
  /** Anything written onto the toolbox whose name cannot be read. */
  unreadable: string[];
  /** The keys of the largest object literal made into `__debug` (the game's own, in main.ts). */
  literal: { at: string; keys: number };
}

function readSourceHelpers(files: readonly { name: string; text: string }[]): SourceHelpers {
  const out: SourceHelpers = { keys: new Map(), knobs: new Map(), unreadable: [], literal: { at: '', keys: 0 } };
  for (const f of files) readOne(f.name, f.text, out);
  return out;
}

function readOne(file: string, text: string, out: SourceHelpers): void {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const where = (n: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const unwrap = (e: ts.Expression): ts.Expression => {
    for (;;) {
      if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
      else return e;
    }
  };
  /** A key written out as a literal (`['x']`, `dbg['x']`), or null for one worked out at run time. */
  const literalText = (e: ts.Expression): string | null => {
    const u = unwrap(e);
    return ts.isStringLiteral(u) || ts.isNumericLiteral(u) || ts.isNoSubstitutionTemplateLiteral(u) ? u.text : null;
  };
  /** A property's own name: an identifier as it stands, a bracketed one only when it is a literal. */
  const nameText = (n: ts.PropertyName): string | null => {
    if (ts.isComputedPropertyName(n)) return literalText(n.expression);
    if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    return null;
  };
  // The names in this file bound to the toolbox, and to the window itself; gathered until nothing
  // new is found, so a name bound from another such name (`const root = dbg`) counts as well.
  const toolbox = new Set<string>();
  const windows = new Set<string>(['window', 'globalThis', 'self']);
  const isWindow = (e: ts.Expression): boolean => {
    const u = unwrap(e);
    return ts.isIdentifier(u) && windows.has(u.text);
  };
  const isToolbox = (e: ts.Expression): boolean => {
    const u = unwrap(e);
    if (ts.isIdentifier(u)) return toolbox.has(u.text);
    if (ts.isPropertyAccessExpression(u)) return u.name.text === '__debug';
    if (ts.isElementAccessExpression(u)) return literalText(u.argumentExpression) === '__debug';
    // `holder.__debug ??= {}` is the toolbox, and so is `w.__debug ?? {}`.
    if (ts.isBinaryExpression(u)) {
      const op = u.operatorToken.kind;
      if (op === ts.SyntaxKind.QuestionQuestionEqualsToken || op === ts.SyntaxKind.BarBarEqualsToken || op === ts.SyntaxKind.EqualsToken) return isToolbox(u.left);
      if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) return isToolbox(u.left);
    }
    return false;
  };
  for (let grew = true; grew; ) {
    grew = false;
    const visit = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        const name = n.name.text;
        if (!toolbox.has(name) && isToolbox(n.initializer)) {
          toolbox.add(name);
          grew = true;
        } else if (!windows.has(name) && isWindow(n.initializer)) {
          windows.add(name);
          grew = true;
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  // Which names in this file are functions, for the window's knobs.
  const functions = new Set<string>();
  const isFunctionLike = (e: ts.Expression): boolean => {
    const u = unwrap(e);
    return ts.isArrowFunction(u) || ts.isFunctionExpression(u);
  };
  const gatherFunctions = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name) functions.add(n.name.text);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && isFunctionLike(n.initializer)) functions.add(n.name.text);
    ts.forEachChild(n, gatherFunctions);
  };
  gatherFunctions(sf);
  const isFunctionValue = (e: ts.Expression): boolean => {
    const u = unwrap(e);
    return isFunctionLike(u) || (ts.isIdentifier(u) && functions.has(u.text));
  };

  const addKey = (name: string | null, at: ts.Node, how: string): void => {
    if (name === null) out.unreadable.push(`${where(at)}: ${how}`);
    else if (!out.keys.has(name)) out.keys.set(name, where(at));
  };
  const addKnob = (name: string, value: ts.Expression | 'method', at: ts.Node): void => {
    // The menu lists a window's own `__name` only when it is a function; a plain object there
    // (`__stats`, `__character`) is not a helper.
    if (name === '__debug' || !/^__[a-z][A-Za-z0-9]*$/.test(name)) return;
    if ((value === 'method' || isFunctionValue(value)) && !out.knobs.has(name)) out.knobs.set(name, where(at));
  };
  const literalKeys = (lit: ts.ObjectLiteralExpression): number => {
    let n = 0;
    for (const p of lit.properties) {
      if (ts.isSpreadAssignment(p)) addKey(null, p, `a spread into the toolbox (${p.getText(sf).slice(0, 40)})`);
      else {
        const name = p.name ? nameText(p.name) : null;
        addKey(name, p, `a key worked out at run time (${p.getText(sf).slice(0, 40)})`);
        if (name !== null) n++;
      }
    }
    return n;
  };
  const isAssign = (k: ts.SyntaxKind) => k === ts.SyntaxKind.EqualsToken || k === ts.SyntaxKind.QuestionQuestionEqualsToken || k === ts.SyntaxKind.BarBarEqualsToken || k === ts.SyntaxKind.AmpersandAmpersandEqualsToken;
  const visit = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n) && isAssign(n.operatorToken.kind)) {
      const left = unwrap(n.left);
      const right = unwrap(n.right);
      if (ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left)) {
        const name = ts.isPropertyAccessExpression(left) ? left.name.text : literalText(left.argumentExpression);
        if (name === '__debug') {
          // The toolbox made whole: an object literal is read key by key, anything else cannot be.
          if (ts.isObjectLiteralExpression(right)) {
            const keys = literalKeys(right);
            if (keys > out.literal.keys) out.literal = { at: where(n), keys };
          } else if (!(ts.isIdentifier(right) && right.text === 'undefined') && right.kind !== ts.SyntaxKind.NullKeyword) addKey(null, n, `the toolbox made from something not written out (${n.getText(sf).slice(0, 60)})`);
        } else if (isToolbox(left.expression)) addKey(name, n, `a helper hung by a name worked out at run time (${n.left.getText(sf)})`);
        else if (name !== null && isWindow(left.expression)) addKnob(name, n.right, n);
      }
    }
    if (ts.isCallExpression(n)) {
      const callee = unwrap(n.expression);
      const method = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'Object' ? callee.name.text : '';
      const target = n.arguments[0];
      if (method === 'assign' && target && isToolbox(target)) {
        for (const src of n.arguments.slice(1)) {
          const u = unwrap(src);
          if (ts.isObjectLiteralExpression(u)) literalKeys(u);
          else addKey(null, src, `Object.assign onto the toolbox from something not written out (${src.getText(sf).slice(0, 40)})`);
        }
      } else if (method === 'assign' && target && isWindow(target)) {
        for (const src of n.arguments.slice(1)) {
          const u = unwrap(src);
          if (!ts.isObjectLiteralExpression(u)) continue;
          for (const p of u.properties) {
            const name = p.name ? nameText(p.name) : null;
            if (name === null) continue;
            if (ts.isPropertyAssignment(p)) addKnob(name, p.initializer, p);
            else if (ts.isShorthandPropertyAssignment(p)) addKnob(name, p.name, p);
            else if (ts.isMethodDeclaration(p)) addKnob(name, 'method', p);
          }
        }
      } else if ((method === 'defineProperty' || method === 'defineProperties') && target && isToolbox(target)) {
        const key = method === 'defineProperty' && n.arguments[1] ? literalText(n.arguments[1]) : null;
        addKey(key, n, `Object.${method} onto the toolbox by a name that cannot be read`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

// The reader itself, on made-up source: every way of hanging a helper it must see, and the ways it
// cannot read, which it must say rather than pass over.
{
  const made = readSourceHelpers([
    {
      name: 'made.ts',
      text: `
        (window as unknown as { __debug: unknown }).__debug = {
          plain: () => 1,
          async method(o?: number) { return o; },
          get lookup() { return 1; },
          shorthand,
          'quoted': () => 2,
          ['bracketed']: () => 3,
        };
        const debugRoot = (window as unknown as { __debug?: Record<string, unknown> }).__debug;
        if (debugRoot) debugRoot.late = () => 4;
        if (debugRoot) Object.assign(debugRoot, { assigned: () => 5 });
        const root = debugRoot!;
        root.aliased = () => 6;
        root['byBracket'] = () => 7;
        const holder = globalThis as unknown as { __debug?: Record<string, unknown> };
        const debug = (holder.__debug ??= {});
        debug.fromHolder ??= () => 8;
        const w = window as unknown as { __debug?: Record<string, unknown> };
        w.__debug!.throughWindow = () => 9;
        Object.defineProperty(debugRoot, 'defined', { value: () => 10 });
        function knobByName() { return 1; }
        const knobByArrow = () => 2;
        (globalThis as unknown as { __byName?: typeof knobByName }).__byName = knobByName;
        (window as Window & { __otherCast?: () => number }).__otherCast = knobByArrow;
        (globalThis as unknown as { __inline?: () => number }).__inline = () => 3;
        w.__throughHandle = function () { return 4; };
        (window as unknown as { __stats: object }).__stats = { fps: 60 };
        Object.assign(window, { __assignedKnob: () => 5 });
      `,
    },
    {
      name: 'unreadable.ts',
      text: `
        (window as unknown as { __debug: unknown }).__debug = { ...more, fine: () => 1 };
        const dbg = (window as unknown as { __debug?: Record<string, unknown> }).__debug;
        dbg[someName] = () => 2;
        Object.assign(dbg, extra);
      `,
    },
  ]);
  const want = ['plain', 'method', 'lookup', 'shorthand', 'quoted', 'bracketed', 'late', 'assigned', 'aliased', 'byBracket', 'fromHolder', 'throughWindow', 'defined', 'fine'];
  const missed = want.filter((k) => !made.keys.has(k));
  ok(missed.length === 0, `the reader finds a helper hung every way the source can hang one${missed.length ? `; it missed ${missed.join(', ')}` : ` (${want.length} ways)`}`);
  ok(made.keys.size === want.length, `and nothing else as a helper (${[...made.keys.keys()].filter((k) => !want.includes(k)).join(', ') || 'none'})`);
  const knobsWanted = ['__byName', '__otherCast', '__inline', '__throughHandle', '__assignedKnob'];
  ok(knobsWanted.every((k) => made.knobs.has(k)) && !made.knobs.has('__stats') && made.knobs.size === knobsWanted.length, `a knob on the window is found by name, by an inline function and through any cast, and a plain object there is not (${[...made.knobs.keys()].join(', ')})`);
  ok(made.unreadable.length === 3 && made.unreadable.some((u) => /spread/.test(u)) && made.unreadable.some((u) => /someName/.test(u)) && made.unreadable.some((u) => /extra/.test(u)), `and what it cannot name is said, not skipped (${made.unreadable.length}: ${made.unreadable.join(' | ')})`);
}

// ---------------------------------------------------------------------------------------------
// Every helper the game hangs on `__debug` has a row, read out of the source.
{
  const src = new URL('src/', root);
  const files = (readdirSync(src, { recursive: true }) as string[])
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => f.endsWith('.ts'))
    .map((name) => ({ name, text: readFileSync(new URL(name, src), 'utf8') }))
    // Only a file that names the toolbox or hangs something on the window under `__` can add to either.
    .filter((f) => f.text.includes('__debug') || /\.__[a-z]/.test(f.text));
  const found = readSourceHelpers(files);
  const keys = found.keys;
  const knobs = found.knobs;
  ok(found.literal.at.startsWith('main.ts:'), `the literal that makes \`__debug\` is found in main.ts (${found.literal.at})`);
  ok(found.literal.keys > 200, `its keys are read (${found.literal.keys})`);
  ok(['teleport', 'perf', 'hud', 'advance', 'windows'].every((k) => keys.has(k)), 'the ones every test leans on among them');
  const hung = keys.size - found.literal.keys;
  ok(hung >= 10, `and the helpers hung on it afterwards are found too (${hung}: the session's, the sabers', the marks', ...)`);
  ok(keys.has('debugMenu') && keys.has('sabers') && keys.has('nebulae') && keys.has('galaxy') && keys.has('forceLightning'), "the debug menu's own handle among them, and the modules' own");
  ok(found.unreadable.length === 0, `nothing is hung on the toolbox in a way the reader cannot name${found.unreadable.length ? `: ${found.unreadable.join('; ')}` : ''}`);
  ok(knobs.size >= 6 && knobs.has('__sharedDay') && !knobs.has('__stats') && !knobs.has('__character'), `the window's own knobs are found, and the plain objects on it are not (${[...knobs.keys()].join(', ')})`);

  const missing = [...keys].filter(([k]) => !docs.has(k)).map(([k, where]) => `${k} (${where})`);
  ok(missing.length === 0, `every helper on __debug has a row in the README's Debugging table${missing.length ? `; these have none: ${missing.join(', ')}` : ` (${keys.size})`}`);
  const missingKnobs = [...knobs].filter(([k]) => !docs.has(docKey(k, 'window'))).map(([k, where]) => `${k} (${where})`);
  ok(missingKnobs.length === 0, `and so does every knob on the window${missingKnobs.length ? `; these have none: ${missingKnobs.join(', ')}` : ` (${knobs.size})`}`);

  const stale = [...docs.values()].filter((d) => (d.on === 'debug' ? !keys.has(d.helper) : !knobs.has(d.helper))).map((d) => d.helper);
  console.log(`note the README names ${stale.length} helper(s) the game does not have, which the menu leaves out: ${stale.join(', ') || 'none'}`);

  // The menu's own groups name real helpers: a name there that is nowhere is a typo, and the helper
  // it meant would be listed under Other.
  const filed = DEBUG_GROUPS.flatMap((g) => g.helpers);
  const nowhere = filed.filter((n) => (n.startsWith('__') ? !knobs.has(n) : !keys.has(n)));
  ok(nowhere.length === 0, `every name the menu files under a group is a real helper${nowhere.length ? `: ${nowhere.join(', ')}` : ` (${filed.length})`}`);
  ok(new Set(filed).size === filed.length, 'and none is filed twice');
  const unfiled = [...keys.keys()].filter((k) => !filed.includes(k));
  console.log(`note ${unfiled.length} helper(s) are listed under Other: ${unfiled.join(', ') || 'none'}`);
}

console.log(`\n${checks} checks passed`);
