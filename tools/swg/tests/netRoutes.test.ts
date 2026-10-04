// Every word the server sends has somewhere to go in the browser.
//
// `src/net/net.ts`'s `receive()` is a switch with no default: a word with no case is dropped in silence.
// That cost a whole feature once -- the server's `purse` answer never reached the purse, so with a server
// every fare waited for ever and the balance read nought, and nothing anywhere said why. This reads the
// server's own source as text, finds every word it can send a browser, and fails for any that has no
// case in that switch, unless it is on the short list below of words dropped on purpose, each with its
// reason. A word the server sends is told from a record it writes down by where it is made: a record goes
// through `write(` or `.change(`, and everything else spelled `t: '<word>'` in a server module is a word.
//
// Nothing is run: the files are read as they are.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** Words the server sends that the browser drops on purpose, and why. None today. */
const DROPPED: Record<string, string> = {};

const root = new URL('../../../', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), 'utf8');

// The words the server can send, out of every server module, comments and records left out.
const sent = new Map<string, string>();
for (const file of readdirSync(new URL('server/', root)).filter((f) => f.endsWith('.mjs'))) {
  const lines = read(`server/${file}`).split('\n');
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    if (/^\s*\*/.test(code) || /\bwrite\(|\.change\(/.test(code)) return;
    for (const m of code.matchAll(/\bt: '([A-Za-z]+)'/g)) if (!sent.has(m[1])) sent.set(m[1], `${file}:${i + 1}`);
  });
}

// The words the header of the relay says it sends, under "Server to browser".
const relay = read('server/relay.mjs');
const header = relay.slice(relay.indexOf('// Server to browser:'), relay.indexOf('import { createServer }'));
const promised = new Set([...header.matchAll(/\{ t: '([A-Za-z]+)'/g)].map((m) => m[1]));

// The cases `receive()` has.
const net = read('src/net/net.ts');
const body = net.slice(net.indexOf('private receive('));
const cases = new Set([...body.matchAll(/case '([A-Za-z]+)':/g)].map((m) => m[1]));

ok(sent.size > 30 && cases.size > 30 && promised.size > 30, `the server's source, its header and the browser's switch all read (${sent.size} words sent, ${promised.size} promised, ${cases.size} cases)`);
const missing = [...sent.keys()].filter((w) => !cases.has(w) && !(w in DROPPED));
ok(missing.length === 0, `every word the server sends has a case in receive()${missing.length ? `; none for ${missing.map((w) => `${w} (${sent.get(w)})`).join(', ')}` : ''}`);
const unsaid = [...sent.keys()].filter((w) => !promised.has(w));
ok(unsaid.length === 0, `and every one of them is in the relay's own list of what it sends${unsaid.length ? `; missing ${unsaid.join(', ')}` : ''}`);
const stale = Object.keys(DROPPED).filter((w) => cases.has(w) || !sent.has(w));
ok(stale.length === 0, `every word dropped on purpose is really sent and really has no case${stale.length ? `; not so for ${stale.join(', ')}` : ''}`);
ok(cases.has('purse') && cases.has('story') && sent.has('purse') && sent.has('story'), 'the purse\'s answer and the story\'s words, both of which a server sends, both reach the browser');

console.log(`\n${checks} checks passed`);
