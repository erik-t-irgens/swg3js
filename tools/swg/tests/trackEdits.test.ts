// The track editor's endpoint as the dev server runs it: its rules (`src/race/trackEdits.ts`) as they stand, and its
// glue (`tools/dev/tracksEndpoint.mjs`) against real files in a folder of its own under the system's temporary folder,
// taken away after, over a real HTTP server on this machine's loopback, so a request is read, judged and answered by
// the very code the dev server loads.
//
// What is pinned: who may ask (a POST alone, this machine alone, the game's own page alone, the editor's own header,
// JSON, under the cap), each refused in words and writing nothing; a put writes the world's file whole through a
// dot-named copy that is gone afterwards, into a folder made when it is missing, and says the world to the page once;
// the answer's read is exactly what the file on disk reads as; a track replaced keeps the fields this build does not
// read, and every other track goes back as it was read; a file holding a track this build cannot read, or one that
// does not read at all, is refused until it is mended by hand; the world of copies takes no track, and a world there is
// not is refused; two asks at once are answered one after the other, both tracks kept; the last track taken out takes
// the file away and the tracks folder with it, and nothing above; and the config serves the files from disk and loads
// the glue by a name it works out, the dev server's alone.
//
// Run: node tools/swg/tests/trackEdits.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { TRACKS_ENDPOINT_TUNE, TRACK_EDITOR_HEADER, TRACK_EDITOR_HEADER_VALUE, applyTrackOp, refuseTrackRequest, trackEditFile, type TrackWorldKind } from '../../../src/race/trackEdits.ts';
import { readTrackFile, trackFileText, type TrackDef } from '../../../src/race/trackFile.ts';
import { headingTurn } from '../../../src/race/gates.ts';
import { fromGame } from '../../../src/story/placements.ts';

const glue = await import('../../../tools/dev/tracksEndpoint.mjs');

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

const turn = (h: number) => {
  const q = fromGame({ x: 0, y: 0, z: 0, q: headingTurn(h) }, null, 'raw').q;
  return [q[0], q[1], q[2], q[3]] as [number, number, number, number];
};
/** A small circuit in the raw frame: what a put carries. */
function track(id: string, over: Partial<TrackDef> = {}): TrackDef {
  return {
    id,
    name: `TEST: ${id}`,
    kind: 'circuit',
    laps: 2,
    for: ['podracer'],
    clear: 10,
    grid: { x: 0, y: 1, z: -30, q: turn(0) },
    gates: [
      { x: 0, y: 1, z: 0, q: turn(0), w: 24, h: 40 },
      { x: 0, y: 1, z: 100, q: turn(0), w: 24, h: 40 },
      { x: 100, y: 1, z: 100, q: turn(Math.PI), w: 24, h: 40 },
    ],
    ...over,
  };
}

const WORLDS = new Map<string, TrackWorldKind>([
  ['tatooine', 'ground'],
  ['space_tatooine', 'space'],
  ['dungeon1', 'copies'],
]);
const ctx = { worlds: WORLDS, now: 1_760_000_000_000 };

// --- the rules ---------------------------------------------------------------------------------------------------

{
  const good = { method: 'POST', remoteAddress: '127.0.0.1', origin: 'http://localhost:5180', host: 'localhost:5180', dev: TRACK_EDITOR_HEADER_VALUE, contentType: 'application/json', length: 100 };
  ok(refuseTrackRequest(good) === null && refuseTrackRequest({ ...good, remoteAddress: '::1' }) === null && refuseTrackRequest({ ...good, remoteAddress: '::ffff:127.0.0.1', contentType: 'application/json; charset=utf-8' }) === null, 'a POST from this machine, its own page, the header and JSON is heard');
  const cases: [string, Record<string, unknown>, number][] = [
    ['a GET', { method: 'GET' }, 405],
    ['another machine', { remoteAddress: '192.168.1.20' }, 403],
    ['another page', { origin: 'http://evil.example' }, 403],
    ['no Origin', { origin: null }, 403],
    ['no editor header', { dev: null }, 403],
    ["the placements editor's header", { dev: 'placements' }, 403],
    ['a body that is not JSON', { contentType: 'text/plain' }, 415],
    ['a body past the cap', { length: TRACKS_ENDPOINT_TUNE.bodyMax + 1 }, 413],
  ];
  for (const [what, change, status] of cases) {
    const r = refuseTrackRequest({ ...good, ...change });
    ok(!!r && r.status === status && r.why.length > 0, `${what} is refused ${status}, in words (${r?.why})`);
  }
  ok(TRACK_EDITOR_HEADER === 'x-swg3js-dev', "the editor's header is the placements editor's, saying tracks");

  // A put into no file: a file of one track, which reads back.
  const a = applyTrackOp({ op: 'put', world: 'tatooine', track: track('loop_a') }, null, ctx);
  ok(a.status === 200 && a.body.ok && typeof a.write === 'string' && a.body.read?.tracks.length === 1 && a.body.read.tracks[0].at === ctx.now, 'a put into no file writes a file of that one track, stamped with the moment');
  ok(a.body.ok && a.body.file === 'public/tracks/tatooine.json' && trackEditFile('tatooine') === a.body.file, 'and the answer names the file as the owner reads it');
  const text = a.write as string;
  // Hand-written fields this build does not read, on the file's track and at the top: both kept through a replace.
  const hand = text.replace('"id": "loop_a"', '"id": "loop_a", "drawn": "by hand"');
  ok(hand !== text, '(a field written by hand into the file)');
  const b = applyTrackOp({ op: 'put', world: 'tatooine', track: track('loop_b') }, hand, ctx);
  ok(b.status === 200 && b.body.ok && b.body.read?.tracks.length === 2 && (b.write as string).includes('"drawn": "by hand"'), 'a second track goes in beside it, the first written back exactly as it was read, its hand-written field kept');
  const c = applyTrackOp({ op: 'put', world: 'tatooine', track: track('loop_a', { laps: 5 }) }, b.write as string, ctx);
  ok(c.status === 200 && c.body.ok && c.body.read?.tracks.find((t) => t.id === 'loop_a')?.laps === 5 && (c.write as string).includes('"drawn": "by hand"'), 'a track of the same id is replaced, and keeps what it carried that this build does not read');
  const unknown = applyTrackOp({ op: 'put', world: 'tatooine', track: { ...track('loop_c'), colour: 'red' } }, null, ctx);
  ok(unknown.status === 400 && !unknown.body.ok && unknown.write === undefined, `a put carrying a field this build does not write is refused, and writes nothing (${!unknown.body.ok ? unknown.body.why : ''})`);
  const bad = applyTrackOp({ op: 'put', world: 'tatooine', track: track('loop_d', { gates: [] }) }, null, ctx);
  ok(bad.status === 400 && bad.write === undefined, 'a track the reader refuses is refused');
  const copies = applyTrackOp({ op: 'put', world: 'dungeon1', track: track('loop_e') }, null, ctx);
  ok(copies.status === 409 && copies.write === undefined, "the dungeons' world of copies takes no track");
  const nowhere = applyTrackOp({ op: 'put', world: 'atlantis', track: track('loop_f') }, null, ctx);
  ok(nowhere.status === 404 && applyTrackOp({ op: 'put', world: '../x', track: track('loop_f') }, null, ctx).status === 400, 'a world there is not, or a name that is not a pack id, is refused');
  const notReading = applyTrackOp({ op: 'put', world: 'tatooine', track: track('loop_g') }, '{ "world": "tatooine", "version": 99, "tracks": [] }', ctx);
  ok(notReading.status === 409 && notReading.write === undefined, 'a file that does not read is refused until it is mended by hand');
  const broken = (b.write as string).replace('"laps": 2', '"laps": -4');
  const skips = applyTrackOp({ op: 'put', world: 'tatooine', track: track('loop_h') }, broken, ctx);
  ok(skips.status === 409 && skips.write === undefined, `a file holding a track this build cannot read is refused, or the editor would write over it (${!skips.body.ok ? skips.body.why : ''})`);
  // Space: the file is in the game's frame.
  const space = applyTrackOp({ op: 'put', world: 'space_tatooine', track: track('orbit') }, null, ctx);
  ok(space.status === 200 && /"frame": "game"/.test(space.write as string) && readTrackFile(space.write as string, 'space_tatooine', 'space').problem === null && readTrackFile(space.write as string, 'space_tatooine', 'ground').problem !== null, "a space zone's file is written in the game's own frame, and read only as a space zone's");
  // Delete.
  const del = applyTrackOp({ op: 'delete', world: 'tatooine', id: 'loop_b' }, c.write as string, ctx);
  ok(del.status === 200 && del.body.ok && del.body.read?.tracks.length === 1 && (del.write as string).includes('"drawn": "by hand"'), 'a delete takes one track out and writes the rest back as they were');
  const last = applyTrackOp({ op: 'delete', world: 'tatooine', id: 'loop_a' }, del.write as string, ctx);
  ok(last.status === 200 && last.write === null && last.body.ok && last.body.read === null, 'the last track taken out takes the file away');
  ok(applyTrackOp({ op: 'delete', world: 'tatooine', id: 'loop_z' }, del.write as string, ctx).status === 404 && applyTrackOp({ op: 'delete', world: 'tatooine', id: 'constructor' }, del.write as string, ctx).status === 400, "a delete of a track not there is 404, and of a language's own name 400");
  ok(applyTrackOp({ op: 'move', world: 'tatooine' }, null, ctx).status === 400 && applyTrackOp(null, null, ctx).status === 400 && applyTrackOp([1], null, ctx).status === 400, 'an ask that is not a put or a delete is refused');
  // A file at the cap takes no new track, and a replace in one still goes.
  const many = Array.from({ length: 50 }, (_, i) => ({ ...track(`t${i}`), at: 1 }));
  const full = trackFileText('tatooine', 'raw', many);
  ok(applyTrackOp({ op: 'put', world: 'tatooine', track: track('t50') }, full, ctx).status === 409 && applyTrackOp({ op: 'put', world: 'tatooine', track: track('t7', { laps: 3 }) }, full, ctx).status === 200, 'a file of fifty tracks takes no fifty-first, and a track in it may still be replaced');
}

// --- the glue over HTTP ------------------------------------------------------------------------------------------

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'swg3js-tracks-'));
const dir = path.join(scratch, 'public', 'tracks');
const listing = (folder: string) => (fs.existsSync(folder) ? fs.readdirSync(folder).sort().join(',') : '(none)');

try {
  ok(glue.trackFileFor(dir, 'tatooine') === path.join(dir, 'tatooine.json') && glue.trackFileFor(dir, '../x') === null && glue.trackFileFor(dir, 'a/b') === null, "a path that would leave the tracks folder is none, and a world's is directly in it");
  const said: { world: string }[] = [];
  let clock = 1_760_000_000_000;
  const server = http.createServer((req, res) => {
    void glue.handle(req, res, { dir, notify: (w: { world: string }) => said.push(w), now: () => clock, worlds: WORLDS });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  const ask = async (op: unknown, init: { header?: boolean; method?: string; type?: string; origin?: string; body?: string } = {}) => {
    const headers: Record<string, string> = { 'Content-Type': init.type ?? 'application/json', Origin: init.origin ?? origin };
    if (init.header !== false) headers[TRACK_EDITOR_HEADER] = TRACK_EDITOR_HEADER_VALUE;
    const res = await fetch(`${origin}/`, { method: init.method ?? 'POST', headers, body: init.method === 'GET' ? undefined : (init.body ?? JSON.stringify(op)) });
    return { status: res.status, type: res.headers.get('content-type') ?? '', body: (await res.json()) as Record<string, unknown> };
  };
  const file = path.join(dir, 'tatooine.json');
  try {
    const noHeader = await ask({ op: 'put', world: 'tatooine', track: track('loop_a') }, { header: false });
    ok(noHeader.status === 403 && !fs.existsSync(dir), "an ask with no editor's header is 403, and nothing is made");
    const get = await ask(null, { method: 'GET' });
    ok(get.status === 405, 'a GET is 405');
    const otherPage = await ask({ op: 'put', world: 'tatooine', track: track('loop_a') }, { origin: 'http://evil.example' });
    ok(otherPage.status === 403 && !fs.existsSync(dir), 'an ask from another page is 403');
    const plain = await ask({ op: 'put', world: 'tatooine', track: track('loop_a') }, { type: 'text/plain' });
    ok(plain.status === 415 && !fs.existsSync(dir), 'a body that says it is not JSON is 415');
    const long = await ask(null, { body: JSON.stringify({ op: 'put', world: 'tatooine', pad: 'x'.repeat(TRACKS_ENDPOINT_TUNE.bodyMax) }) });
    ok(long.status === 413 && !fs.existsSync(dir), 'a body past the cap is 413');
    const notJson = await ask(null, { body: '{ op: put' });
    ok(notJson.status === 400 && !fs.existsSync(dir), 'a body that does not parse is 400');
    const copies = await ask({ op: 'put', world: 'dungeon1', track: track('loop_a') });
    ok(copies.status === 409 && !fs.existsSync(dir), "the world of copies is refused, and nothing is made");

    // A put: the folder made, the file written whole, the page told once.
    const put = await ask({ op: 'put', world: 'tatooine', track: track('loop_a') });
    ok(put.status === 200 && put.body.ok === true && put.body.id === 'loop_a' && put.body.file === 'public/tracks/tatooine.json' && put.type.startsWith('application/json'), 'a put is saved, answered in JSON naming the file and the id');
    ok(listing(dir) === 'tatooine.json', 'the file is written, and nothing else is left beside it');
    ok(said.length === 1 && said[0].world === 'tatooine', 'and the page is told once that the file changed');
    const onDisk = readTrackFile(fs.readFileSync(file, 'utf8'), 'tatooine', 'ground');
    ok(JSON.stringify(put.body.read) === JSON.stringify(onDisk), "the answer's read is exactly what the file on disk reads as");

    // Two asks at once: answered one after the other, both tracks kept.
    clock += 1000;
    const [a, b] = await Promise.all([ask({ op: 'put', world: 'tatooine', track: track('loop_b') }), ask({ op: 'put', world: 'tatooine', track: track('loop_c') })]);
    const both = readTrackFile(fs.readFileSync(file, 'utf8'), 'tatooine', 'ground');
    ok(a.status === 200 && b.status === 200 && both.tracks.length === 3, `two asks at once both land, neither writing the other's file back as it read it (${both.tracks.map((t) => t.id).join(', ')})`);
    ok(listing(dir) === 'tatooine.json', 'and no copy is left beside it');

    // Taking every track out takes the file and the tracks folder away, and nothing above.
    said.length = 0;
    for (const id of ['loop_a', 'loop_b']) await ask({ op: 'delete', world: 'tatooine', id });
    const lastOne = await ask({ op: 'delete', world: 'tatooine', id: 'loop_c' });
    ok(lastOne.status === 200 && lastOne.body.read === null && !fs.existsSync(file), 'taking out the last track takes the file away');
    ok(!fs.existsSync(dir) && fs.existsSync(path.dirname(dir)), 'and the emptied tracks folder with it, and nothing above it');
    ok(said.length === 3 && said.every((w) => w.world === 'tatooine'), 'every write said to the page');
    // A folder still holding another world's file stays.
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'naboo.json'), '{}');
    await ask({ op: 'put', world: 'tatooine', track: track('loop_a') });
    await ask({ op: 'delete', world: 'tatooine', id: 'loop_a' });
    ok(fs.existsSync(path.join(dir, 'naboo.json')) && !fs.existsSync(file), "while a folder with another world's file in it stays");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
  ok(glue.worldKinds().get('tatooine') === 'ground' && glue.worldKinds().get('dungeon1') === 'copies', 'the glue reads the game\'s own list of worlds, the placements editor\'s');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
ok(!fs.existsSync(scratch), 'and the folder it worked in is gone');

// --- the config ---------------------------------------------------------------------------------------------------

{
  const vite = fs.readFileSync(new URL('../../../vite.config.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const editor = vite.slice(vite.indexOf('function tracksEditor(): Plugin {'), vite.indexOf('\n}\n', vite.indexOf('function tracksEditor(): Plugin {')));
  ok(/apply: 'serve'/.test(editor) && /server\.middlewares\.use\('\/__dev\/tracks'/.test(editor), "the endpoint is the dev server's alone, at /__dev/tracks");
  ok(/pathToFileURL\(path\.resolve\(ROOT, 'tools', 'dev', 'tracksEndpoint\.mjs'\)\)\.href/.test(editor) && /import\(\/\* @vite-ignore \*\/ glue\)/.test(editor) && !/import .* from '\.\/tools\/dev\/tracksEndpoint/.test(vite), 'and its glue is loaded at the first ask by a name the config works out, never a dependency of it');
  const files = vite.slice(vite.indexOf('function trackFiles(): Plugin {'), vite.indexOf('function tracksEditor(): Plugin {'));
  ok(/req\.method !== 'GET' && req\.method !== 'HEAD'/.test(files) && /fs\.readFile\(file/.test(files) && /application\/json/.test(files) && /statusCode = 404/.test(files), "the page's ask for a track file is answered from the disk as it stands, JSON, and a missing file a plain 404");
  ok(/server\.ws\.send\('tracks:changed', word\)/.test(files) && /plugins: \[[^\]]*trackFiles\(\), tracksEditor\(\)/.test(vite), 'a file changing on disk is said to the page as tracks:changed, and both plugins are in');
  const main = fs.readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8');
  const readAt = main.indexOf('private async readTracks(');
  const reader = main.slice(readAt, main.indexOf('\n  }\n', readAt));
  ok(readAt > 0 && /content-type/i.test(reader) && /json/.test(reader) && /cache: 'no-store'/.test(reader), "the page reads a world's file with no cache and takes it only as JSON, since a missing public file is answered with the page");
}

console.log(`\ntrackEdits: ${passed} checks passed`);
