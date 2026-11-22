// The space body viewer's server in the repo and Save to game (the GPU port's pass 2, wave 4a): `viewer/server.mjs` (the
// old viewer's serve.mjs as `npm run viewer`'s middleware), `viewer/gameBodies.mjs` (the game's bodies file, numbers
// only) and the game's reader of that file, `src/sky/look/bodiesFile.ts`. Everything is written into a folder of the
// system's temporary space and taken away after; the server listens on a port the system picks.
//   node tools/swg/tests/viewerSave.test.mjs
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { viewerPaths, viewerMiddleware, privateTableOf, mainCheckoutOf } = await import(new URL('../../../viewer/server.mjs', import.meta.url).href);
const { gameBodiesFile, worldOfPlanetPlace, gamePictureName, stillKind } = await import(new URL('../../../viewer/gameBodies.mjs', import.meta.url).href);
const B = await import(new URL('../../../src/sky/look/bodiesFile.ts', import.meta.url).href);
const LOOKS = await import(new URL('../../../src/sky/look/looks.js', import.meta.url).href);
const PICS = await import(new URL('../../../src/sky/look/pictures.js', import.meta.url).href);

let pass = 0, fail = 0;
const fails = [];
const ok = (c, what) => { if (c) pass++; else { fail++; fails.push(what); console.log('FAIL', what); } };

// ---------------------------------------------------------------- a small PNG, made here
function png(w, h, rgb) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- the paths
{
  const P = viewerPaths({}, ROOT);
  ok(P.port === 5194 && !P.shared, `the port is 5194 by default, this PC alone (${P.port})`);
  // (the fixer of pass 2, wave 4a) beside the repo's main checkout, so a linked worktree (where he tests the port) finds them too
  const HOME = mainCheckoutOf(ROOT);
  ok(P.save === path.resolve(HOME, '..', 'Feature-requests', 'space-body-viewer', 'space-bodies.json') && P.imported === path.resolve(HOME, '..', 'Feature-requests', 'WebGPU Port - Imported Textures'), `his file of choices where the old viewer keeps it, beside the repo's main checkout (${HOME})`);
  const W = viewerPaths({}, path.resolve(ROOT, '..', 'a-worktree'), path.resolve(ROOT, '..', 'main-checkout'));
  ok(W.save === path.resolve(ROOT, '..', 'Feature-requests', 'space-body-viewer', 'space-bodies.json') && W.survey === path.resolve(ROOT, '..', '..', 'imported') && W.packs === path.resolve(ROOT, '..', 'a-worktree', 'assets-private') && W.game === path.resolve(ROOT, '..', 'a-worktree', 'public', 'sky', 'bodies.json'), 'from a worktree: his things beside the main checkout, the packs and the bodies file the worktree\'s own');
  const gitHome = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' });
  ok(gitHome.status !== 0 || HOME === path.dirname(path.resolve(gitHome.stdout.trim())), 'the main checkout is the folder of git\'s common folder');
  ok(mainCheckoutOf(os.tmpdir()) === os.tmpdir() || spawnSync('git', ['rev-parse'], { cwd: os.tmpdir() }).status === 0, 'outside a checkout the root stands for itself');
  ok(P.game === path.resolve(ROOT, 'public', 'sky', 'bodies.json'), 'Save to game writes the game\'s own public/sky/bodies.json by default');
  ok(P.looks[0] === path.resolve(ROOT, 'imports-private', 'sky', 'looks-private.json') && P.looks[2].endsWith(path.join('space-body-viewer', 'looks.js')), 'the private table from imports-private/, then his imported folder, then the old viewer\'s looks.js beside his file');
  const Q = viewerPaths({ SBV_PORT: '5196', SBV_SAVE: 'x/a.json', SBV_GAME: 'y/b.json', SBV_LOOKS: 'z/t.json' }, ROOT);
  ok(Q.port === 5196 && Q.save === path.resolve(ROOT, 'x/a.json') && Q.prev === path.resolve(ROOT, 'x/a.prev.json') && Q.game === path.resolve(ROOT, 'y/b.json') && Q.looks.length === 1, 'each path and the port from the environment');
  let threw = 0;
  for (const env of [{ SBV_PORT: '80' }, { SBV_PORT: 'x' }, { SBV_SHARE: 'wan' }]) { try { viewerPaths(env, ROOT); } catch { threw++; } }
  ok(threw === 3, 'a port out of range, not a number, or a share other than lan is refused');
}

// ---------------------------------------------------------------- the game's air in the viewer follows the world it draws
{
  // (the fixer of pass 2, wave 4a) The session has one set of the air's tables (`makeAirTables`), made for the first world
  // loaded: a Tatooine match after a Rori one drew through Rori's numbers (49.5, 43.4, 42.7 of its sky against a fresh page's
  // 68.3, 55.9, 59.7). Node draws nothing, so the page's proof is the fixer's alternation of matches in one page
  // (`A:\swg3js\port\scratch\p2w4a-fixer\tools\vmatch.mjs`); this holds its one line where it must stand.
  const ga = fs.readFileSync(path.join(ROOT, 'src', 'sky', 'look', 'gameAir.ts'), 'utf8');
  const frameAt = ga.indexOf('frameAir(a: WorldAir, hours: number): boolean {');
  const body = ga.slice(frameAt, ga.indexOf('\n  }\n', frameAt));
  ok(frameAt > 0 && /if \(this\.tables && a\.ready\) \{\s*this\.tables\.follow\(run\.twin\.record\);\s*this\.tables\.frame\(this\.S\.camera\);/.test(body), "each frame of a world's air points the session's tables at that world's record before they are drawn");
}

// ---------------------------------------------------------------- the server
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-save-'));
try {
  const imported = path.join(TMP, 'imported');
  fs.mkdirSync(imported);
  fs.writeFileSync(path.join(imported, 'his photo.png'), png(4, 2, [200, 120, 40]));
  fs.writeFileSync(path.join(imported, 'a still.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]));
  fs.writeFileSync(path.join(imported, 'T_Imported_Texture_01_C.png'), png(2, 2, [1, 2, 3]));
  fs.writeFileSync(path.join(imported, 'notes.txt'), 'not served');
  const survey = path.join(TMP, 'survey');
  fs.mkdirSync(path.join(survey, 'game-side'), { recursive: true });
  fs.writeFileSync(path.join(survey, 'textures.json'), '{"textures":[]}');
  const packs = path.join(TMP, 'packs');
  fs.mkdirSync(path.join(packs, 'tatooine'), { recursive: true });
  fs.writeFileSync(path.join(packs, 'tatooine', 'sky.json'), JSON.stringify({ planet: 'tatooine', blocks: [{ name: 'clear', weatherIndex: 0, ramp: { rows: 1, rgba: Buffer.alloc(1024).toString('base64') } }] }));
  const table = path.join(TMP, 'looks-private.json');
  fs.writeFileSync(table, JSON.stringify({ version: 1, meshes: { m1: { kind: 'dome', label: 'one' } }, halos: {}, rings: {}, parts: { mine: { name: 'Mine', kind: 'dome', mesh: 'm1', layers: {} } } }));
  const save = path.join(TMP, 'his', 'space-bodies.json');
  fs.mkdirSync(path.dirname(save));
  const game = path.join(TMP, 'game', 'sky', 'bodies.json');
  const server = http.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const P = { ...viewerPaths({ SBV_SAVE: save, SBV_IMPORTED: imported, SBV_SURVEY: survey, SBV_PACKS: packs, SBV_LOOKS: table, SBV_GAME: game, SBV_CREDIT: 'Test Owner' }, ROOT), port };
  const logs = [];
  const mw = viewerMiddleware(P, (s) => logs.push(s));
  server.on('request', (req, res) => mw(req, res, () => { res.statusCode = 418; res.end('next'); }));
  const base = `http://127.0.0.1:${port}`;
  const get = (p, headers = {}) => fetch(base + p, { headers });
  const post = (p, body, type = 'application/json', headers = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': type, ...headers }, body });

  ok((await get('/space-bodies.json')).status === 204, 'no file of choices yet: 204, the page starts from its defaults');
  const choices = { version: 2, savedAt: '2026-11-22T00:00:00.000Z', looks: { a: { name: 'A' } }, uses: { 'x:y': 'a' }, places: {}, zones: {}, pictures: {} };
  let r = await post('/save', JSON.stringify(choices));
  ok(r.status === 200 && fs.readFileSync(save, 'utf8') === JSON.stringify(choices, null, 2) + '\n', 'Save writes the file of choices exactly as the old server did (two-space JSON and a newline)');
  await post('/save', JSON.stringify({ ...choices, looks: {} }));
  ok(fs.readFileSync(P.prev, 'utf8') === JSON.stringify(choices, null, 2) + '\n', 'the one before is kept as .prev.json');
  ok((await (await get('/space-bodies.json')).text()) === JSON.stringify({ ...choices, looks: {} }, null, 2) + '\n', 'the file of choices is served back as written');
  ok((await post('/save', JSON.stringify({ looks: [] }))).status === 400 && (await post('/save', 'x', 'text/plain')).status === 415, 'a save of the wrong shape or not JSON is refused');
  ok((await post('/save', JSON.stringify(choices), 'application/json', { Origin: 'http://elsewhere.example' })).status === 403, 'a save from another site is refused');
  // (fetch will not send another Host; node's own client will, as a page elsewhere pointing its name here would)
  const rawStatus = (p, host) => new Promise((res) => { const q = http.request({ host: '127.0.0.1', port, path: p, headers: { Host: host } }, (a) => { a.resume(); res(a.statusCode); }); q.end(); });
  ok((await rawStatus('/api/files', `evil.example:${port}`)) === 403 && (await rawStatus('/api/files', `localhost:${port}`)) === 200, 'a request under another host name is refused (DNS rebinding); its own names are answered');
  // (the address is made plain before it is read, so a climb out of the packs leaves their name and is never theirs to serve)
  ok((await rawStatus('/assets-private/tatooine/../../imported/notes.txt', `127.0.0.1:${port}`)) !== 200, 'a pack path climbing out of the packs is never served');
  const files = await (await get('/api/files')).json();
  ok(files.files.map((f) => f.name).join('|') === 'a still.jpg|his photo.png|T_Imported_Texture_01_C.png', `the imported folder lists its pictures and meshes alone (${files.files.map((f) => f.name).join(', ')})`);
  ok((await get('/assets/' + encodeURIComponent('his photo.png'))).status === 200 && (await get('/assets/notes.txt')).status === 404 && (await get('/assets/..%2F..%2Fpackage.json')).status === 404, 'a picture of the folder is served; nothing else, and nothing outside it');
  ok((await get('/survey/textures.json')).status === 200 && (await get('/survey/other.json')).status === 404, 'the survey\'s fixed files alone');
  ok((await get('/pack/tatooine/skyramp.json')).status === 200 && (await get('/pack/space_x/sky.json')).status === 404, 'a ground world\'s ramp; a zone with no pack is a 404');
  ok((await get('/assets-private/tatooine/sky.json')).status === 200 && (await get('/assets-private/..%2Fimported/notes.txt')).status === 404, 'a converted pack\'s file for the game\'s air, and nothing outside the packs');
  const priv = await (await get('/private/looks.json')).json();
  ok(priv.parts?.mine?.name === 'Mine' && priv.from === table, 'the private table is served from SBV_LOOKS');
  ok((await get('/unknown')).status === 418, 'anything else passes on to Vite');
  // a picture added: never over a file, its name made plain
  r = await post('/picture?name=' + encodeURIComponent('his photo.png'), png(2, 2, [9, 9, 9]), 'image/png');
  ok(r.status === 409, 'a picture is never written over one already there');
  r = await post('/picture?name=' + encodeURIComponent('new one.png'), png(2, 2, [9, 9, 9]), 'image/png');
  ok(r.status === 200 && fs.existsSync(path.join(imported, 'new one.png')), 'a new picture is added to the imported folder');
  ok((await post('/picture?name=' + encodeURIComponent('../x.png'), png(2, 2, [9, 9, 9]), 'image/png')).status === 400, 'a name that reaches another folder is refused');

  // Save to game
  const looks = {
    'generated:w3-naboo': LOOKS.makeLook({ name: 'Naboo (twin of his Naboo map as he wears it)', kind: 'sphere', generated: { preset: 'w3-naboo', recipe: 'living', version: 4, seed: 3141, dials: { sea: 0.6 }, size: 1024 }, air: { mode: 'scattered', visibilityKm: 50 }, layers: { atmosphere: { on: true, form: 'rim' } } }),
    naboo: LOOKS.makeLook({ name: 'Naboo (his)', kind: 'dome', mesh: 'his_dome_07_mesh', note: 'his_tile_07.png on the dome', layers: { surface: { on: true, tex: 'his_tile_07.png' } } }),
    photo: LOOKS.makeLook({ name: 'A photo of his', kind: 'sphere', layers: { surface: { on: true, tex: 'his photo.png' } } }),
    stillLook: LOOKS.makeLook({ name: 'A still', kind: 'sphere', layers: { surface: { on: true, tex: 'a still.jpg' } } }),
    unmarked: LOOKS.makeLook({ name: 'Unmarked', kind: 'sphere', layers: { surface: { on: true, tex: 'new one.png' } } }),
  };
  const pictures = { 'his photo.png': { kind: 'colour-unlit', added: 'x', ship: true }, 'a still.jpg': { kind: 'still', added: 'x', ship: true }, 'new one.png': { kind: 'colour-unlit', added: 'x' } };
  const sys = { applied: true, system: { version: 2, id: 'naboo', bodies: [{ id: 'rori', look: 'naboo' }, { id: 'ohma', look: 'photo' }] } };
  const data = {
    looks, pictures, worlds: ['naboo', 'tatooine', 'kashyyyk_main'], twins: { naboo: 'generated:w3-naboo' },
    uses: { 'space_naboo:planet_naboo': 'naboo', 'naboo:moon': 'photo', 'naboo:moon2': 'stillLook', 'naboo:celestial:x': 'unmarked', 'space_kashyyyk:planet_kashyyyk': 'generated:w3-naboo' },
    starSystems: { naboo: sys, hoth: { applied: false, system: { version: 2, id: 'hoth', bodies: [] } } },
  };
  r = await post('/save-game', JSON.stringify(data));
  const said = await r.json();
  ok(r.status === 200 && fs.existsSync(game), `Save to game answers and writes SBV_GAME (${said.looks} looks, ${said.uses} places)`);
  const text = fs.readFileSync(game, 'utf8');
  const made = JSON.parse(text);
  ok(made.version === 1 && made.credits === 'Sky looks and photos by Test Owner, made in the space body viewer.', `a version and a credits line naming him (${made.credits})`);
  ok(made.uses['space_naboo:planet_naboo'] === 'generated:w3-naboo', 'a look of his imported pictures goes as its generated twin');
  ok(made.uses['naboo:moon'] === 'photo' && made.looks.photo.layers.surface.tex === 'pictures/his photo.png' && made.pictures['his photo.png']?.kind === 'colour-unlit', 'a look of his own photo marked to ship goes, its picture under pictures/');
  ok(fs.existsSync(path.join(path.dirname(game), 'pictures', 'his photo.png')) && fs.readFileSync(path.join(path.dirname(game), 'pictures', 'his photo.png')).equals(fs.readFileSync(path.join(imported, 'his photo.png'))), 'the photo marked to ship is copied beside the file, byte for byte');
  ok(!('naboo:moon2' in made.uses) && !made.looks.stillLook && !fs.existsSync(path.join(path.dirname(game), 'pictures', 'a still.jpg')), 'a still never ships, whatever its mark');
  ok(!('naboo:celestial:x' in made.uses) && !made.looks.unmarked && !fs.existsSync(path.join(path.dirname(game), 'pictures', 'new one.png')), 'a photo not marked stays on his machine (only on my machine, the default)');
  ok(!/his_tile_07|his_dome_07_mesh|_mesh"|\.fbx|a still/.test(text) && !/"note"/.test(text), 'no picture or mesh name of his imports, and no note, anywhere in the file');
  // (the fixer of pass 2, wave 4a) a twin's name says what it twins: the game's file carries its plain name alone
  ok(made.looks['generated:w3-naboo'].name === 'Naboo' && made.looks.photo.name === 'A photo of his' && !/twin of|his Naboo map/.test(text), `a look's name goes without its bracketed remark, so nothing says what his imports are (${made.looks['generated:w3-naboo'].name})`);
  ok(Object.keys(made.systems).join() === 'naboo' && made.systems.naboo.bodies[0].look === 'generated:w3-naboo' && made.systems.naboo.bodies[1].look === 'photo', 'only the systems he applied; a body\'s look of his imports goes as its twin, one that can ship as itself');
  ok(made.air.kashyyyk?.visibilityKm === 50 && made.air.naboo?.visibilityKm === 50 && Object.keys(made.air).sort().join() === 'kashyyyk,naboo', 'a ground world\'s air dials from the look its planet wears in its space zone (by the game\'s planet name; a twin\'s where his look went as its twin), none for a moon');
  ok(logs.some((l) => l.startsWith('[save to game]')), 'the server says where it wrote');

  // the game's reader, over what the writer made
  const read = await B.readBodiesFile(async (p) => ({ ok: true, status: 200, text: async () => (p === B.BODIES_PATH ? text : '') }));
  ok(!!read && B.SKY_BODIES.dropped === 0 && Object.keys(read.looks).length === Object.keys(made.looks).length && JSON.stringify(read.uses) === JSON.stringify(made.uses), `the game reads the file back whole (${Object.keys(read.looks).length} looks, ${Object.keys(read.uses).length} places, nothing dropped)`);
  ok(B.bodyLookOf('naboo:moon')?.layers.surface.tex === 'pictures/his photo.png' && B.bodyAirOf('kashyyyk')?.visibilityKm === 50 && B.bodyLookOf('nowhere') === null, 'a place\'s look and a world\'s air by their names');
  ok(read.credits === made.credits && B.bodiesReport().file.generated === 1, 'its credits line, and the report');
  ok(B.SKY_BODIES.reads === 1, 'read once a loading screen');
  await new Promise((r) => server.close(r));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

// ---------------------------------------------------------------- the game's reader refuses and drops
{
  const c1 = B.cleanBodiesFile({ version: 2, looks: {} });
  ok(c1.file === null && /later viewer/.test(c1.why), 'a later version is refused whole');
  ok(B.cleanBodiesFile('x').file === null && B.cleanBodiesFile({ looks: {} }).file === null, 'not an object, or no version: refused');
  const c2 = B.cleanBodiesFile({
    version: 1, credits: 'a\u0000b',
    looks: { a: { name: 'A', kind: 'sphere', layers: { surface: { tex: 'T_Imported_01_C.png', tint: '#ffaa00', mesh: 'x_mesh' } }, generated: { recipe: 'living', dials: { sea: 0.4, bad: Infinity, words: 'x'.repeat(200) } } } },
    uses: { 'p:1': 'a', 'p:2': 'missing' },
    pictures: { 'ok.png': { kind: 'clouds' }, 'still.png': { kind: 'still' }, '../up.png': { kind: 'clouds' } },
  });
  const L = c2.file.looks.a;
  ok(L.layers.surface.tex === undefined && L.layers.surface.tint === '#ffaa00' && L.layers.surface.mesh === 'x_mesh', 'a picture name of his imports is dropped; a colour kept; a mesh id kept as a word (the writer never writes one)');
  ok(L.generated.dials.sea === 0.4 && L.generated.dials.bad === undefined && L.generated.dials.words === undefined, 'a number not finite and a long string are dropped');
  ok(c2.file.uses['p:1'] === 'a' && !('p:2' in c2.file.uses), 'a place naming a look the file does not hold is dropped');
  ok(Object.keys(c2.file.pictures).join() === 'ok.png' && c2.file.credits === 'a b', 'a still or a name that reaches another folder is no shipped picture; the credits line made plain');
  const miss = await B.readBodiesFile(async () => ({ ok: false, status: 404, text: async () => '' }));
  ok(miss === null && B.SKY_BODIES.file === null && /no file/.test(B.SKY_BODIES.why), 'no file: none kept, quietly');
  const html = await B.readBodiesFile(async () => ({ ok: true, status: 200, text: async () => '<!doctype html>' }));
  ok(html === null && /not the file/.test(B.SKY_BODIES.why), 'the dev server\'s page in its place: none kept');
}

// ---------------------------------------------------------------- the writer alone, and the pictures' marks
{
  ok(worldOfPlanetPlace('space_kashyyyk:planet_kashyyyk', ['kashyyyk_main']) === 'kashyyyk' && worldOfPlanetPlace('space_naboo:planet_naboo_moon#1', ['naboo']) === null && worldOfPlanetPlace('space_yavin4:planet_yavin4', ['yavin4']) === 'yavin4', 'a ground world\'s planet in its zone, by the game\'s name; a moon is none');
  ok(gamePictureName('a.jpeg') === 'a.jpg' && gamePictureName('b.png') === 'b.png' && stillKind('still') && !stillKind('clouds'), 'a .jpeg goes as .jpg (a release takes .jpg and .png); a still is a still');
  const none = gameBodiesFile({ looks: {}, uses: {} }, { at: 'now' });
  ok(none.credits === 'Sky looks made in the space body viewer.' && Object.keys(none.looks).length === 0, 'with no name to credit, a plain line');
  const cp = PICS.cleanPictures({ 'a.png': { kind: 'clouds', added: 't', ship: true }, 'b.png': { kind: 'still', added: 't', ship: true }, 'c.png': { kind: 'clouds', added: 't' } });
  ok(cp['a.png'].ship === true && cp['b.png'].ship === undefined && !('ship' in cp['c.png']) && JSON.stringify(cp['c.png']) === '{"kind":"clouds","added":"t"}', 'a picture\'s mark is kept only when marked and no still; unmarked, the record is as it was');
  ok(PICS.KIND_ORDER.includes('still') && !PICS.shippable('still') && PICS.shippable('clouds'), 'the still is a kind of its own, never shippable');
}

// ---------------------------------------------------------------- looks.js's seam
{
  ok(JSON.stringify(Object.keys(LOOKS.MESHES)) === '["planet_01_mesh","sheet"]' && Object.keys(LOOKS.HALOS).length === 0 && Object.keys(LOOKS.RINGS).length === 0, 'the shipped looks.js names only the sphere and the card');
  const src = fs.readFileSync(path.join(ROOT, 'src/sky/look/looks.js'), 'utf8');
  ok(!/T_[A-Za-z]+_[A-Za-z0-9_]*\.(png|jpg)|\.fbx/.test(src), 'and no picture or mesh file of his imports');
  ok(Object.keys(LOOKS.defaultLooks()).length === 0, 'without the private table it makes none of his looks');
  const t = privateTableOf({ MESHES: { planet_01_mesh: {}, a_mesh: { kind: 'dome' }, sheet: {} }, HALOS: { h: {} }, RINGS: {}, defaultLooks: () => ({ x: { name: 'X' } }) });
  ok(Object.keys(t.meshes).join() === 'a_mesh' && t.parts.x.name === 'X', 'a private table from the old looks.js\'s shape: its own meshes and its looks');
  ok(LOOKS.usePrivateLooks(t, 'test') && JSON.stringify(Object.keys(LOOKS.MESHES)) === '["planet_01_mesh","a_mesh","sheet"]' && LOOKS.HALOS.h && LOOKS.defaultLooks().x.name === 'X' && LOOKS.privateLooks().looks === 1, 'handed in, its meshes stand between the sphere and the card and its looks are the defaults');
  ok(LOOKS.usePrivateLooks({ parts: 'no' }) === false, 'a table not of that shape is refused');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.map((f) => '  FAIL ' + f).join('\n')); process.exit(1); }
// (a fetch's kept-alive socket would hold the process open for its timeout)
process.exit(0);
