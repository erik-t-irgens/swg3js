// The owner's file of choices in the repo (the GPU port's pass 2, wave 6, maker K: `viewer/choices.mjs`, `viewer/server.mjs`'s
// `viewerPaths` and its routes, `tools/dev/skyPrivate.mjs`, `placeholders.js`' `twinOfLook`), on two scratch "machines" made
// here, each a repo folder with its own imported folder (made-up pictures; nothing of his is read):
//   - machine A's first start copies its old file of choices into `viewer/choices/`, its picture names made keys, the old file
//     left byte for byte; read back, every key is A's picture again and the file is the old one's choices;
//   - machine B (the repo's file as a pull brings it, one of the three pictures in its folder) reads that one by name and the
//     two it lacks as keys, which `twinOfLook` takes for the generated twin; B's Save writes every picture as its key again, so
//     the file A reads back after B's save is A's own choices with B's edit;
//   - no picture name in the repo's file; `SBV_SAVE` still names a file of one machine's own, written with its names;
//   - the game's dev server reads the keyed file through the same keys (or the old file before the first run);
//   - `choices.mjs`' key is `placeholders.js`' `pictureKey` to the bit.
//
// Run: node tools/swg/tests/viewerChoices.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
// @ts-ignore a plain module of the viewer's
import { viewerMiddleware, viewerPaths } from '../../../viewer/server.mjs';
// @ts-ignore a plain module of the viewer's
import { PICTURE_TOKEN, keyPictures, pictureKey, resolvePictures } from '../../../viewer/choices.mjs';
// @ts-ignore a plain module of the viewer's
import { pictureKey as tableKey, twinOfLook, TWIN_OF_PICTURE } from '../../../src/sky/look/placeholders.js';
// @ts-ignore a plain module of the game's dev server
import { privateSkyOf } from '../../dev/skyPrivate.mjs';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let checks = 0;
const ok = (cond: boolean, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  console.log(`ok   ${msg}`);
};
const sha = (f: string): string => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

// ---------------------------------------------------------------- the key
{
  const names = ['Alpha.png', 'Beta Clouds.png', 'Gamma.jpg', 'T_Imported_Texture_01_C.png', 'é ü.jpeg', ''];
  ok(names.every((n) => pictureKey(n) === tableKey(n)), "the file's key is placeholders.js' pictureKey to the bit");
  const k = Object.keys(TWIN_OF_PICTURE)[0];
  ok(twinOfLook('a look of his', { layers: { surface: { tex: '#' + k } } }) === TWIN_OF_PICTURE[k] && twinOfLook('a look of his', { layers: { surface: { tex: 'not his.png' } } }) === null, 'a key the machine cannot resolve is drawn as the picture\'s generated twin (twinOfLook reads the key)');
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-choices-'));
/** One machine: a repo folder beside a Feature-requests folder, an imported folder holding `pics`. */
function machine(name: string, pics: string[]): { root: string; imported: string; old: string } {
  const top = path.join(TMP, name);
  const root = path.join(top, 'repo');
  const imported = path.join(top, 'Feature-requests', 'WebGPU Port - Imported Textures');
  const old = path.join(top, 'Feature-requests', 'space-body-viewer', 'space-bodies.json');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(imported, { recursive: true });
  fs.mkdirSync(path.dirname(old), { recursive: true });
  for (const p of pics) fs.writeFileSync(path.join(imported, p), PNG);
  return { root, imported, old };
}
/** A server of the viewer's own middleware for `P`, on a free port; its log kept. */
async function serve(P: Any): Promise<{ base: string; logs: string[]; close: () => Promise<void> }> {
  const server = http.createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as Any).port;
  const logs: string[] = [];
  const mw = viewerMiddleware({ ...P, port }, (s: string) => logs.push(s));
  server.on('request', (req, res) => mw(req, res, () => { res.statusCode = 418; res.end('next'); }));
  return { base: `http://127.0.0.1:${port}`, logs, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}
const OLD = {
  version: 2,
  savedAt: '2026-11-23T00:00:00.000Z',
  looks: {
    // (the fixer of wave 6) a mesh of his imports in a layer, and a note naming two of his pictures, one with its ending
    tat: { name: 'Tatooine', kind: 'sphere', mesh: 'planet_01_mesh', note: 'From Alpha.png and Beta Clouds, tuned by eye.', layers: { surface: { on: true, tex: 'Alpha.png' }, clouds: { on: true, tex: 'Beta Clouds.png', flow: { on: true, tex: 'Gamma.jpg' } }, atmosphere: { on: true, mesh: 'Delta_Halo' } } },
    gen: { name: 'Made', generated: { recipe: 'rocky', seed: 3 } },
  },
  uses: { 'tatooine:sun': 'tat' },
  places: { 'tatooine:moon': { size: 9 } },
  zones: {},
  pictures: { 'Alpha.png': { kind: 'photo', ship: true } },
};

try {
  // ---------------------------------------------------------------- machine A: the first run
  const A = machine('A', ['Alpha.png', 'Beta Clouds.png', 'Gamma.jpg', 'Delta_Halo.fbx']);
  fs.writeFileSync(A.old, JSON.stringify(OLD, null, 2) + '\n');
  const oldHash = sha(A.old);
  const PA = viewerPaths({ SBV_IMPORTED: A.imported, SBV_GAME: path.join(TMP, 'A-game.json') }, A.root, A.root);
  ok(PA.save === path.join(A.root, 'viewer', 'choices', 'space-bodies.json') && PA.keyed && PA.firstFrom === A.old, "machine A's file of choices is its repo's, its first copy the old file");
  const before = await privateSkyOf(PA);
  ok(before.from === A.old && before.looks.tat?.layers.surface.tex === 'Alpha.png', 'before the first run the game\'s dev server reads the old file in place');
  const sa = await serve(PA);
  ok(fs.existsSync(PA.save) && sa.logs.some((l) => l.startsWith('[choices] first run:')), `the first start copies it in (${sa.logs.find((l) => l.startsWith('[choices]'))})`);
  ok(sha(A.old) === oldHash, 'and leaves the old file byte for byte');
  const repoText = fs.readFileSync(PA.save, 'utf8');
  ok(!/Alpha|Beta|Gamma|Delta/.test(repoText), "no imported file's name is in the repo's file: no picture's, no mesh's, none in a note");
  const repo = JSON.parse(repoText);
  ok(PICTURE_TOKEN.test(repo.looks.tat.layers.surface.tex) && PICTURE_TOKEN.test(repo.looks.tat.layers.clouds.flow.tex) && Object.keys(repo.pictures).every((k: string) => PICTURE_TOKEN.test(k)) && repo.looks.tat.mesh === 'planet_01_mesh', 'each picture (a layer\'s, a flow map\'s, an added picture\'s entry) is its key; the shipped mesh name stands');
  ok(repo.looks.tat.layers.atmosphere.mesh === '#' + pictureKey('Delta_Halo') && repo.looks.tat.note === `From #${pictureKey('Alpha.png')} and #${pictureKey('Beta Clouds')}, tuned by eye.`, `a mesh of his imports is the key of its id, and a note's names their keys, the rest of its words kept ("${repo.looks.tat.note}")`);
  const readA = await (await fetch(sa.base + '/space-bodies.json')).json();
  ok(JSON.stringify(readA) === JSON.stringify(OLD), 'read back on A every key is its picture again: the old file\'s choices, exactly');
  const afterA = await privateSkyOf(PA);
  ok(afterA.from === PA.save && afterA.looks.tat?.layers.clouds.tex === 'Beta Clouds.png', "the game's dev server reads the repo's file through the same keys");
  await sa.close();

  // ---------------------------------------------------------------- machine B: a pull, one picture of three
  const B = machine('B', ['Alpha.png']);
  const PB = viewerPaths({ SBV_IMPORTED: B.imported, SBV_GAME: path.join(TMP, 'B-game.json') }, B.root, B.root);
  fs.mkdirSync(path.dirname(PB.save), { recursive: true });
  fs.copyFileSync(PA.save, PB.save);
  const sb = await serve(PB);
  ok(!sb.logs.some((l) => l.startsWith('[choices] first run')), 'with the repo\'s file there (a pull), nothing is copied (B has no old file anyway)');
  const readB = await (await fetch(sb.base + '/space-bodies.json')).json();
  ok(readB.looks.tat.layers.surface.tex === 'Alpha.png' && readB.looks.tat.layers.clouds.tex === '#' + pictureKey('Beta Clouds.png') && readB.looks.tat.layers.clouds.flow.tex === '#' + pictureKey('Gamma.jpg') && readB.pictures['Alpha.png']?.ship === true, "B reads the picture it has by its own name and keeps the two it lacks as keys");
  ok(readB.looks.tat.layers.atmosphere.mesh === '#' + pictureKey('Delta_Halo') && readB.looks.tat.note === `From Alpha.png and #${pictureKey('Beta Clouds')}, tuned by eye.`, 'and keeps the mesh it lacks as its key, its note naming what it has and keying what it lacks');
  ok(sb.logs.some((l) => l.includes('2 of the file\'s pictures are not in this machine\'s imported folder')), 'and says so in its console');
  // B's page saves what it read, with one edit of its own.
  const editB = { ...readB, savedAt: '2026-11-24T00:00:00.000Z', uses: { ...readB.uses, 'tatooine:moon': 'gen' } };
  const r = await fetch(sb.base + '/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editB) });
  ok(r.status === 200, 'B saves');
  const savedB = JSON.parse(fs.readFileSync(PB.save, 'utf8'));
  ok(JSON.stringify(savedB.looks) === JSON.stringify(repo.looks) && JSON.stringify(savedB.pictures) === JSON.stringify(repo.pictures) && !/Alpha|Beta|Gamma|Delta/.test(fs.readFileSync(PB.save, 'utf8')), "B's save writes every picture as its key again: the looks and pictures A wrote, to the letter, no name in it");
  ok(fs.existsSync(PB.prev) && fs.readFileSync(PB.prev, 'utf8') === repoText, 'the one before is kept beside it (.prev.json, which the folder\'s .gitignore keeps out of git)');
  // A page on a machine with fewer pictures builds its looks in another order (a missing picture's twin first): the file keeps
  // the order it has, so its save changes only what changed.
  const savedText = fs.readFileSync(PB.save, 'utf8');
  const reversed = { ...editB, looks: Object.fromEntries(Object.entries(editB.looks).reverse()) };
  await fetch(sb.base + '/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reversed) });
  ok(fs.readFileSync(PB.save, 'utf8') === savedText, "the looks handed over in another order are written in the file's own order: the same bytes");
  await sb.close();

  // ---------------------------------------------------------------- back on A: B's save pulled
  fs.copyFileSync(PB.save, PA.save);
  const sa2 = await serve(PA);
  const readA2 = await (await fetch(sa2.base + '/space-bodies.json')).json();
  ok(JSON.stringify(readA2.looks) === JSON.stringify(OLD.looks) && JSON.stringify(readA2.pictures) === JSON.stringify(OLD.pictures) && readA2.uses['tatooine:moon'] === 'gen', "A reads B's save as its own choices with B's edit: the round trip loses nothing");
  ok(sha(A.old) === oldHash && !sa2.logs.some((l) => l.startsWith('[choices] first run')), 'the old file still untouched, and no second copy');
  await sa2.close();

  // ---------------------------------------------------------------- SBV_SAVE, a file of one machine's own
  const own = path.join(TMP, 'own', 'mine.json');
  fs.mkdirSync(path.dirname(own), { recursive: true });
  const PO = viewerPaths({ SBV_SAVE: own, SBV_IMPORTED: A.imported }, A.root, A.root);
  const so = await serve(PO);
  await fetch(so.base + '/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(OLD) });
  ok(fs.readFileSync(own, 'utf8') === JSON.stringify(OLD, null, 2) + '\n', 'a file named by SBV_SAVE is written with its names, exactly as before');
  await so.close();

  // ---------------------------------------------------------------- the pure halves
  const k = keyPictures(OLD);
  ok(JSON.stringify(keyPictures(k)) === JSON.stringify(k), 'a keyed file keyed again is itself');
  const back = resolvePictures(k, ['Gamma.jpg', 'Alpha.png', 'Beta Clouds.png', 'Delta_Halo.fbx', 'notes.txt']);
  ok(JSON.stringify(back.file) === JSON.stringify(OLD) && back.resolved === 4 && back.left === 0 && k.looks.tat.layers.atmosphere.mesh === 'Delta_Halo', 'resolved against every picture, it is the file it was made from (keyed with no folder named, its pictures alone are keyed)');
  const sect = keyPictures({ looks: { x: { layers: { atmosphere: { mesh: 'Delta_Halo#lambert3' } } } } }, ['Delta_Halo.fbx']);
  ok(sect.looks.x.layers.atmosphere.mesh === `#${pictureKey('Delta_Halo')}#lambert3` && resolvePictures(sect, ['Delta_Halo.fbx']).file.looks.x.layers.atmosphere.mesh === 'Delta_Halo#lambert3' && resolvePictures(sect, []).left === 1, 'a mesh naming one of its sections keeps the section after its key, and comes back whole where the mesh is');
  ok(keyPictures({ looks: { x: { mesh: 'not a file', layers: { atmosphere: { mesh: 'planet_01_mesh' } } } } }, ['Delta_Halo.fbx', 'planet_01_mesh.fbx']).looks.x.mesh === 'not a file' && keyPictures({ looks: { x: { layers: { atmosphere: { mesh: 'planet_01_mesh' } } } } }, ['planet_01_mesh.fbx']).looks.x.layers.atmosphere.mesh === 'planet_01_mesh', "a mesh word naming no file of the folder, and the mesh the game ships, stay as they are");
  const names = ['Gamma.jpg', 'Alpha.png', 'Beta Clouds.png', 'Delta_Halo.fbx'];
  const kn = keyPictures(OLD, names);
  ok(JSON.stringify(keyPictures(kn, names)) === JSON.stringify(kn) && !/Alpha|Beta|Gamma|Delta/.test(JSON.stringify(kn)), 'keyed against a folder, no name of it is left anywhere, and keyed again it is itself');
  const backN = resolvePictures(kn, names);
  ok(JSON.stringify(backN.file) === JSON.stringify(OLD) && backN.resolved === 7 && backN.left === 0, 'and resolved against that folder it is the file it was made from, the note\'s two names back as they were written');
  ok(keyPictures({ looks: { x: { note: 'Alphabet soup, AlphaX and my_Alpha stay; made from Alpha.' } } }, names).looks.x.note === `Alphabet soup, AlphaX and my_Alpha stay; made from #${pictureKey('Alpha')}.`, 'a name is keyed only where it stands as a whole word');
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log(`\nviewerChoices: ${checks} checks passed`);
process.exit(0);
