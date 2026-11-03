// The race drawer's first wave: a world's track file written through the world editor's batch (`tracksKind` in
// src/world/placementEdits.ts, kept outside the placements folder by `OUTSIDE_EDIT_FILES`), so a drawn course and its gates
// are one undo entry. The kind's own rules (open, clean, parse, same, extras, text); a drawn course through the real editing
// class over the endpoint's own rules (`editsHarness.ts`): one action and one batch, undone and done again byte for byte,
// a row changed by hand since refused by name; the endpoint over HTTP in a folder of its own (`public/tracks/<world>.json`
// written and nothing under `public/placements/`, the file taken away with its last track and its folder with it, never
// `public/`; a path held to the tracks folder; the word said with the kind and the revision); the dev server's words routed
// by kind (text pins of `vite.config.ts`); and an endpoint from before the kind read as one, in words.
//
// Run: node tools/swg/tests/tracksKind.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { makeHarness } from './editsHarness.ts';
import { REPO } from './oldModules.ts';
import { BATCH_FILE_KINDS, EDIT_FILE_KINDS, OUTSIDE_EDIT_FILES, editFileOf, isOutsideKind, outsideFilePath } from '../../../src/story/placementPath.ts';
import { EDITOR_HEADER, EDITOR_HEADER_VALUE, TRACKS_OLDER_ENDPOINT, applyPlacementOp, batchKindOf, olderTracksEndpoint, tracksKind } from '../../../src/world/placementEdits.ts';
import { olderEndpoint, refusalWords } from '../../../src/editor/devVerdict.ts';
import { readTrackFile, trackFileText, type TrackDef } from '../../../src/race/trackFile.ts';
import { courseCtx, drawTrack } from '../../../src/editor/courseEdit.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const WORLD = 'dantooine';
const land = (x: number, z: number) => 5 + 0.01 * x;
const ring = (cx: number, cz: number, r: number) => Array.from({ length: 6 }, (_, i) => ({ x: cx + r * Math.cos((i * Math.PI) / 3), z: cz + r * Math.sin((i * Math.PI) / 3), y: land(cx + r * Math.cos((i * Math.PI) / 3), 0) }));
const made = (id: string, cx: number) => {
  const t = drawTrack(id, id.replace(/_/g, ' '), ring(cx, 0, 120), true, courseCtx(land));
  assert.ok(typeof t !== 'string', String(t));
  return t as TrackDef;
};

// ---------------------------------------------------------------- 1. the kind's own rules

{
  ok(!(EDIT_FILE_KINDS as readonly string[]).includes('tracks') && editFileOf('tracks/dantooine.json') === null && BATCH_FILE_KINDS[BATCH_FILE_KINDS.length - 1] === 'tracks', "the tracks are no placements kind: EDIT_FILE_KINDS and editFileOf as they were, the batch's list naming them last");
  ok(isOutsideKind('tracks') && !isOutsideKind('world') && OUTSIDE_EDIT_FILES.tracks === 'tracks' && outsideFilePath('tracks', WORLD) === `tracks/${WORLD}.json` && batchKindOf('tracks') === (tracksKind as unknown), 'the outside kind, its folder and its file');
  const k = tracksKind;
  const empty = k.open(null, WORLD, 'ground');
  ok(typeof empty !== 'string' && empty.rows.length === 0 && empty.text === null, 'no file opens as no rows');
  const a = made('alpha', 0);
  const b = made('beta', 600);
  const text = trackFileText(WORLD, 'raw', [{ ...a, at: 1 }, { ...b, at: 2 }]);
  const opened = k.open(text, WORLD, 'ground');
  ok(typeof opened !== 'string' && opened.rows.length === 2 && opened.rows[0].row.id === 'alpha', 'a file of two tracks opens as two rows');
  const later = text.replace('"wallHigh": 8,', '"wallHigh": 8, "rules": 1,');
  const droppy = k.open(later, WORLD, 'ground');
  ok(typeof droppy === 'string' && /would drop course\.rules: update first/.test(droppy), `a file whose course carries a field this build does not read is refused for writing, never written lossy (${droppy})`);
  const broken = k.open(text.replace('"kind": "circuit"', '"kind": "lap"'), WORLD, 'ground');
  ok(typeof broken === 'string' && /cannot read/.test(broken), 'a file holding a track the reader refuses is refused, never written over');
  const cleaned = k.clean({ ...a } as unknown as Record<string, unknown>, 'alpha', 1234, {} as never, 'ground');
  ok(typeof cleaned !== 'string' && cleaned.at === 1234 && JSON.stringify(cleaned.course) === JSON.stringify(a.course), 'a put is cleaned by the reader and stamped');
  const space = k.clean({ ...a } as unknown as Record<string, unknown>, 'alpha', 1234, {} as never, 'space');
  ok(typeof space === 'string' && /space is a later pass/.test(space), `a course put into a space zone's file is refused (${space})`);
  const unknownPut = k.clean({ ...a, gates: a.gates.map((g, i) => (i === 0 ? { ...g, rule: 'must' } : g)) } as unknown as Record<string, unknown>, 'alpha', 1, {} as never, 'ground');
  ok(typeof unknownPut === 'string' && /fields this build does not write/.test(unknownPut), 'a put carrying a field this build does not write is refused');
  const parsed = k.parse(JSON.parse(JSON.stringify({ ...a, at: 1 })));
  ok(typeof parsed !== 'string' && k.same(parsed as TrackDef, { ...a, at: 1 }), 'a track parses and is the same as itself');
  const moved = JSON.parse(JSON.stringify(a)) as TrackDef;
  moved.course!.paths[0].nodes[2].x += 1;
  ok(!k.same({ ...moved, at: 1 }, { ...a, at: 1 }), 'and not the same once a node has moved');
  ok(JSON.stringify(k.extras(a, { ...a, owner: 'him' } as unknown as Record<string, unknown>)).includes('"owner":"him"'), "a field at the head of the track it replaces is carried (the head's own)");
  ok(k.text(WORLD, 'raw', [a]) === trackFileText(WORLD, 'raw', [a]), "its text is the track file's own writer");
  const rt = readTrackFile(k.text(WORLD, 'raw', [{ ...a, at: 5 }]), WORLD, 'ground');
  ok(rt.tracks.length === 1 && isDeepStrictEqual(rt.tracks[0], { ...a, at: 5 }), 'and reads back the track written');
  const bad = applyPlacementOp({ op: 'batch', world: WORLD, edits: [{ file: 'nope', put: {} }] }, {}, { worlds: new Map([[WORLD, 'ground']]), now: 1 });
  ok(bad.status === 400 && /lightsAll or tracks$/.test((bad.body as { why: string }).why), "a kind the batch does not know is refused naming every kind, ending in today's tracks");
}

// ---------------------------------------------------------------- 2. a drawn course through the real editing class

{
  const h = makeHarness({ world: WORLD });
  const t = made('course_1', 0);
  const s = h.e.beginStroke('a course drawn');
  const no = await h.e.strokeWrite(s, [{ file: 'tracks', id: t.id, before: null, after: t }]);
  h.e.endStroke(s);
  await h.settle();
  ok(no === '' && h.e.history.actions.length === 1 && h.batches.length === 1 && h.batches[0].every((e) => e.file === 'tracks'), 'a drawn course is one action and one batch of the tracks kind');
  const written = h.files.tracks!;
  ok(!!written && readTrackFile(written, WORLD, 'ground').tracks[0].course!.paths[0].nodes.length === 6 && h.files.world === null && h.files.story === null, 'the track file holds it, and no placements file was written');
  // A second action: a node moved.
  const before = readTrackFile(written, WORLD, 'ground').tracks[0];
  const after = JSON.parse(JSON.stringify(before)) as TrackDef;
  after.course!.paths[0].nodes[1].z += 3;
  const s2 = h.e.beginStroke('a node moved');
  await h.e.strokeWrite(s2, [{ file: 'tracks', id: t.id, before, after }]);
  h.e.endStroke(s2);
  await h.settle();
  const second = h.files.tracks!;
  await h.e.undo(1);
  await h.settle();
  ok(h.files.tracks === written, 'undone, the file is the text before byte for byte');
  await h.e.undo(1);
  await h.settle();
  ok(h.files.tracks === null, 'and undone again, the file goes with its last track');
  await h.e.redo(2);
  await h.settle();
  ok(h.files.tracks === second, 'done again twice, byte for byte');
  // A row changed by hand since (the owner's own edit): the undo is refused by its name, and the file is left as he left it.
  const hand = second.replace(/"name": "course 1"/, '"name": "His loop"');
  h.files.tracks = hand;
  const said = await h.e.undo(1);
  await h.settle();
  ok(h.files.tracks === hand && /course_1/.test(said) && /changed|since|refus/i.test(said), `an undo over a track changed since is refused by name (${said})`);
}

// ---------------------------------------------------------------- 3. the endpoint over HTTP, in a folder of its own

const glue = await import('../../../tools/dev/placementsEndpoint.mjs');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'swg3js-tracks-'));
const pub = path.join(scratch, 'public');
const dir = path.join(pub, 'placements');
try {
  fs.mkdirSync(pub, { recursive: true });
  ok(glue.fileFor(dir, 'tracks', WORLD) === path.join(pub, 'tracks', `${WORLD}.json`) && glue.fileFor(dir, 'tracks', '../x') === null && glue.fileFor(dir, 'tracks', 'a/b') === null, "the tracks' file is directly in the tracks folder beside the placements folder, and a path that would leave it is none");
  ok(glue.pruneOf('tracks') === 1 && glue.pruneOf('world') === 2 && glue.pruneOf('heights') === 2, 'a track file taken away prunes one folder, a placements kind two');
  ok(glue.kindsRead({ op: 'batch', edits: [{ file: 'tracks' }] }).includes('tracks') && !glue.kindsRead({ op: 'batch', edits: [{ file: 'nope' }] }).includes('nope'), 'a batch naming the tracks reads their file, and no kind it does not know');
  const said: { kind: string; layer: string; world: string; rev: string }[] = [];
  let clock = 1_760_000_000_000;
  const server = http.createServer((req, res) => {
    void glue.handle(req, res, { dir, notify: (w: { kind: string; layer: string; world: string; rev: string }) => said.push(w), now: () => clock++ });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  const ask = async (op: unknown) => {
    const res = await fetch(`${origin}/`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, [EDITOR_HEADER]: EDITOR_HEADER_VALUE }, body: JSON.stringify(op) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  try {
    const t = made('course_1', 0);
    const file = path.join(pub, 'tracks', `${WORLD}.json`);
    const put = await ask({ op: 'batch', world: WORLD, edits: [{ file: 'tracks', put: t }] });
    ok(put.status === 200 && fs.existsSync(file) && !fs.existsSync(dir), `the batch writes public/tracks/${WORLD}.json and nothing under public/placements/`);
    const text = fs.readFileSync(file, 'utf8');
    ok(fs.readdirSync(path.dirname(file)).join(',') === `${WORLD}.json`, 'and nothing else beside it (no copy left)');
    ok(said.length === 1 && said[0].kind === 'tracks' && said[0].world === WORLD && said[0].rev === glue.revisionOf(text), "the page is told once, the word naming the kind and the file's revision");
    const files = (put.body.files ?? {}) as Record<string, { file: string; rev: string; put: TrackDef[] }>;
    ok(files.tracks?.file === `public/tracks/${WORLD}.json` && files.tracks.rev === said[0].rev && files.tracks.put[0].id === 'course_1', 'the answer names the file, its revision and the track put as stamped');
    const gone = await ask({ op: 'batch', world: WORLD, edits: [{ file: 'tracks', delete: 'course_1', was: files.tracks.put[0] }] });
    ok(gone.status === 200 && !fs.existsSync(file) && !fs.existsSync(path.join(pub, 'tracks')) && fs.existsSync(pub), 'the last track taken out takes the file away, and the tracks folder with it, never public/');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

// ---------------------------------------------------------------- 4. the dev server's words, routed by kind (text pins)

{
  const vite = fs.readFileSync(path.join(REPO, 'vite.config.ts'), 'utf8').replace(/\r\n/g, '\n');
  ok(vite.includes("server.ws.send(word.kind === 'tracks' ? 'tracks:changed' : 'placements:changed', word)"), "the endpoint's word about a track file goes to the page as the tracks' own word");
  ok(vite.includes("server.ws.send('tracks:changed', { world: word.world, rev: revisionOfFile(abs) });"), "and the tracks' watcher's word carries the file's revision");
}

// ---------------------------------------------------------------- 5. an endpoint from before the kind

{
  const old = "edit 0's file is story, world, removed, people, heights, paint, water, locations, looks, solid, lights or lightsAll";
  const today = "edit 0's file is story, world, removed, people, heights, paint, water, locations, looks, solid, lights, lightsAll or tracks";
  ok(olderTracksEndpoint(old) && !olderTracksEndpoint(today), "an endpoint from before the tracks is told by its words, and today's is not");
  ok(olderEndpoint(old) && !olderEndpoint(today) && refusalWords(old).includes('npm run dev'), "the editor's own reading says so too, with the restart's words");
  ok(TRACKS_OLDER_ENDPOINT.includes('stop npm run dev and start it again'), "and the tracks' own words say to stop and start the dev server");
}

console.log(`\ntracksKind: ${checks} checks passed`);
