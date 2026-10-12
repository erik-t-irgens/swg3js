// The placement editor's endpoint as the dev server runs it (`tools/dev/placementsEndpoint.mjs`), against real
// files in a folder of its own under the system's temporary folder, taken away after, and over a real HTTP
// server on this machine's loopback, so the request is read, judged and answered by the very glue the dev
// server loads.
//
// What is pinned: a file is written whole through a dot-named copy beside it, into a folder made when it is
// missing, and the dot-named copy is gone afterwards on every path -- a rename another program refuses, tried
// its number of times and then given up, included (an untracked file left under `public/placements/` would stop
// a local release pack); a file is taken away when its last row goes; an ask with no editor's header, or one
// that is not a POST, writes nothing; two asks at once are answered one after the other, both rows kept; every
// file written is said to the page once (`placements:changed`); and the answer's two layers are exactly what the
// files on disk read as, so the dev server's own word that the file changed, which follows, stands nothing:
// a permanent layer handed the answer and then the file read from disk stands the row once.
//
// Run: node tools/swg/tests/placementsEndpoint.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const glue = await import('../../../tools/dev/placementsEndpoint.mjs');
const { PLACEMENTS_ENDPOINT_TUNE, EDITOR_HEADER, EDITOR_HEADER_VALUE } = await import('../../../src/world/placementEdits.ts');
const { readPlacementsFile, placementKey } = await import('../../../src/story/placements.ts');
const { PermanentLayer } = await import('../../../src/world/permanent.ts');

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'swg3js-placements-'));
const dir = path.join(scratch, 'public', 'placements');
/** Everything in a folder, by name, sorted: what is left there is exactly what is asserted, whatever a temporary copy is called. */
const listing = (folder: string) => (fs.existsSync(folder) ? fs.readdirSync(folder).sort().join(',') : '(none)');

try {
  // ---------------------------------------------------------------------------------------------
  // Writing a file whole.
  {
    const file = path.join(scratch, 'made', 'world', 'tatooine.json');
    await glue.writeWhole(file, '{ "a": 1 }\n');
    ok(fs.readFileSync(file, 'utf8') === '{ "a": 1 }\n', 'a file is written into a folder made for it');
    ok(listing(path.dirname(file)) === 'tatooine.json', 'and the copy it went through is gone: the folder holds the file and nothing else');
    await glue.writeWhole(file, '{ "a": 2 }\n');
    ok(fs.readFileSync(file, 'utf8') === '{ "a": 2 }\n' && listing(path.dirname(file)) === 'tatooine.json', 'written again over itself, the same');
    await glue.writeWhole(file, null);
    ok(!fs.existsSync(file), 'null takes the file away');
    await glue.writeWhole(file, null);
    ok(!fs.existsSync(file), 'and taking away a file that is not there is no fault');
    ok(glue.fileFor(dir, 'world', '../tatooine') === null && glue.fileFor(dir, 'world', 'a/b') === null && glue.fileFor(dir, 'story', 'tatooine') === path.join(dir, 'story', 'tatooine.json'), 'a path that would leave its layer\'s folder is none, and a world\'s is directly in it');
  }

  // A rename another program refuses every time (Windows, a file open in an editor): tried its number of times,
  // then given up -- with the dot-named copy taken away all the same, through node's own fs on a real folder.
  {
    const folder = path.join(scratch, 'held');
    const file = path.join(folder, 'tatooine.json');
    const p = fs.promises;
    let tries = 0;
    const refusing = {
      mkdir: p.mkdir,
      writeFile: p.writeFile,
      unlink: p.unlink,
      readFile: p.readFile,
      rename: async () => {
        tries++;
        throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
      },
    };
    let threw: unknown = null;
    try {
      await glue.writeWhole(file, 'x', { ...PLACEMENTS_ENDPOINT_TUNE, renameWaitMs: 1 }, refusing);
    } catch (err) {
      threw = err;
    }
    ok(!!threw && tries === PLACEMENTS_ENDPOINT_TUNE.renameTries, `a rename refused every time is tried ${PLACEMENTS_ENDPOINT_TUNE.renameTries} times and then fails (${tries})`);
    ok(listing(folder) === '', `and leaves nothing at all behind in the folder, no copy and no file (${listing(folder)})`);
    let once = 0;
    const flaky = { ...refusing, rename: async (a: string, b: string) => (once++ === 0 ? Promise.reject(Object.assign(new Error('EBUSY'), { code: 'EBUSY' })) : p.rename(a, b)) };
    await glue.writeWhole(file, 'y', { ...PLACEMENTS_ENDPOINT_TUNE, renameWaitMs: 1 }, flaky);
    ok(fs.readFileSync(file, 'utf8') === 'y' && listing(folder) === 'tatooine.json', 'one refused once and then allowed lands, with no copy left');
    // Whatever refused the rename is usually still holding the copy: its taking away is tried again as the rename
    // is, rather than given up at the first refusal and left behind.
    fs.rmSync(file);
    let held = 0;
    const holding = {
      ...refusing,
      unlink: async (f: string) => {
        if (f !== file && held++ < 2) throw Object.assign(new Error('EBUSY: resource busy or locked, unlink'), { code: 'EBUSY' });
        return p.unlink(f);
      },
    };
    let threwAgain: unknown = null;
    try {
      await glue.writeWhole(file, 'z', { ...PLACEMENTS_ENDPOINT_TUNE, renameWaitMs: 1 }, holding);
    } catch (err) {
      threwAgain = err;
    }
    ok(!!threwAgain && held === 3 && listing(folder) === '', `a copy held for a moment after the rename failed is taken away on a later try (${held} tries), and nothing is left (${listing(folder)})`);
  }

  // ---------------------------------------------------------------------------------------------
  // The endpoint over HTTP.
  const said: { layer: string; world: string }[] = [];
  let clock = 1_760_000_000_000;
  const server = http.createServer((req, res) => {
    void glue.handle(req, res, { dir, notify: (w: { layer: string; world: string }) => said.push(w), now: () => clock });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  const ask = async (op: unknown, init: { header?: boolean; method?: string; type?: string } = {}) => {
    const headers: Record<string, string> = { 'Content-Type': init.type ?? 'application/json', Origin: origin };
    if (init.header !== false) headers[EDITOR_HEADER] = EDITOR_HEADER_VALUE;
    const res = await fetch(`${origin}/`, { method: init.method ?? 'POST', headers, body: init.method === 'GET' ? undefined : JSON.stringify(op) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const worldFile = path.join(dir, 'world', 'tatooine.json');
  const storyFile = path.join(dir, 'story', 'tatooine.json');
  const crate = { kind: 'prop', pack: 'props', thing: 'crate_s01', x: 3476.5, y: 5.25, z: -4694, q: [1, 0, 0, 0] };

  try {
    const noHeader = await ask({ op: 'put', layer: 'world', world: 'tatooine', row: crate }, { header: false });
    ok(noHeader.status === 403 && !fs.existsSync(dir), 'an ask with no editor\'s header is 403, and nothing is made');
    const get = await ask(null, { method: 'GET' });
    ok(get.status === 405, 'a GET is 405');
    const text = await ask({ op: 'put', layer: 'world', world: 'tatooine', row: crate }, { type: 'text/plain' });
    ok(text.status === 415 && !fs.existsSync(worldFile), 'a body that says it is not JSON is 415');
    const unknownWorld = await ask({ op: 'put', layer: 'world', world: '..', row: crate });
    ok(unknownWorld.status === 400 && !fs.existsSync(dir), 'a world that is not a pack id is refused, and nothing is made');

    // A put: the folder made, the file written whole, the page told once.
    const put = await ask({ op: 'put', layer: 'world', world: 'tatooine', row: crate });
    ok(put.status === 200 && put.body.ok === true && put.body.id === 'crate_s01-1' && put.body.file === 'public/placements/world/tatooine.json', `a put is saved and the answer names the file and the id (${put.body.id})`);
    ok(listing(path.dirname(worldFile)) === 'tatooine.json', 'the file is written, and nothing else is left beside it');
    ok(said.length === 1 && said[0].layer === 'world' && said[0].world === 'tatooine', 'and the page is told once that the file changed');
    const onDisk = readPlacementsFile(fs.readFileSync(worldFile, 'utf8'), 'tatooine', 'ground');
    ok(JSON.stringify(put.body.world) === JSON.stringify(onDisk), "the answer's world layer is exactly what the file on disk reads as");

    // The answer stood, and then the dev server's own word that the file changed, which reads the file from disk:
    // the second sync stands nothing.
    let stands = 0;
    let unstands = 0;
    const layer = new PermanentLayer({
      stand: () => {
        stands++;
        return { bounds: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] } };
      },
      unstand: () => {
        unstands++;
      },
      packReady: () => true,
      generation: () => 1,
    });
    layer.enter('tatooine', { x: 0, z: 0 }, 'ground', 1);
    layer.land(null, put.body.story as never, put.body.world as never);
    const echo = layer.setLayer('world', readPlacementsFile(fs.readFileSync(worldFile, 'utf8'), 'tatooine', 'ground'));
    ok(stands === 1 && unstands === 0 && echo.length === 0 && layer.rowOf(placementKey('crate_s01-1')) !== null, `the answer stands the row once, and the file read again from disk stands nothing more (${stands} stood, ${unstands} taken down)`);

    // Two asks at once: answered one after the other, both rows kept.
    clock += 1000;
    const [a, b] = await Promise.all([ask({ op: 'put', layer: 'world', world: 'tatooine', row: { ...crate, x: 3480 } }), ask({ op: 'put', layer: 'world', world: 'tatooine', row: { ...crate, x: 3490 } })]);
    const both = readPlacementsFile(fs.readFileSync(worldFile, 'utf8'), 'tatooine', 'ground');
    ok(a.status === 200 && b.status === 200 && a.body.id !== b.body.id && both.rows.length === 3, `two asks at once both land, neither writing the other's file back as it read it (${both.rows.map((r) => r.id).join(', ')})`);

    // A move to the story: both files written, the page told of both.
    said.length = 0;
    const moved = await ask({ op: 'move', from: 'world', layer: 'story', world: 'tatooine', id: 'crate_s01-1' });
    ok(moved.status === 200 && fs.existsSync(storyFile) && said.length === 2 && said.some((w) => w.layer === 'story') && said.some((w) => w.layer === 'world'), 'a move writes both files and tells the page of each');
    // Deleting every row takes both files away, and leaves nothing under the folder at all.
    for (const id of ['crate_s01-2', 'crate_s01-3']) await ask({ op: 'delete', layer: 'world', world: 'tatooine', id });
    const last = await ask({ op: 'delete', layer: 'story', world: 'tatooine', id: 'crate_s01-1' });
    ok(last.status === 200 && !fs.existsSync(worldFile) && !fs.existsSync(storyFile), 'taking out every row takes both files away');
    ok(!fs.existsSync(dir) && fs.existsSync(path.dirname(dir)), 'and the emptied folders with them, the placements folder too, and nothing above it');
    // A layer's folder still holding something is left alone.
    fs.mkdirSync(path.join(dir, 'world'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'world', 'naboo.json'), '{}');
    await glue.writeWhole(path.join(dir, 'world', 'tatooine.json'), null);
    ok(fs.existsSync(path.join(dir, 'world', 'naboo.json')), "while a folder with another world's file in it stays");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }

  // The glue reads the game's own list of worlds.
  const kinds = glue.worldKinds();
  ok(kinds.get('tatooine') === 'ground' && [...kinds.values()].includes('space') && kinds.get('dungeon1') === 'copies', 'every world there is, by pack id, with its kind');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
ok(!fs.existsSync(scratch), 'and the folder it worked in is gone');

console.log(`\n${passed} checks passed`);
