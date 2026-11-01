// A row's looks and attachments in the files (Map-maker II's seventh wave, `src/story/placements.ts`): `mats` (each
// material's tint, borrowed picture or borrowed material) and `attach` (effects and sounds in the model's own frame), each
// read in one spelling and kept out with its note when it does not read; a mark (`kind: 'mark'`), a row with no model,
// carrying attachments alone; `mats` in the stand's hash and `attach` beside it (`attachHash`), so moving an effect never
// stands its row again; and every row without either hashes exactly as a70487c's reader hashed it (loaded out of git).
// The endpoint writes both and reads them back.
//
// Run: node tools/swg/tests/placementsLooks.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PLACEMENT_FIELDS, PLACEMENT_LIMITS, attachHash, lookSignature, parseDonor, placementsFileText, readAttachments, readLooks, readPlacementRow, readPlacementsFile, rowHash, type PlacementRow } from '../../../src/story/placements.ts';
import { applyPlacementOp, type PlacementCtx } from '../../../src/world/placementEdits.ts';
import { loadOld } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);
/** Where the wave began: main when Map-maker II's seventh wave started. */
const PRE_WAVE = 'a70487c';
const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);
// What a70487c's reader answered, hashed, held where git cannot hand it over: the day-one corpus's row hashes, and each
// committed map-edit file's text and what that reader and writer wrote it back as.
const PRE_WAVE_ROW_HASHES = '602af6ad3460240f';
const PRE_WAVE_FILES: Record<string, { text: string; back: string }> = { tutorial: { text: 'c679e9bfa4cddb1c', back: '909e07f1783fafdf' }, monument: { text: '2a1e5eb2a1923d22', back: '2a1e5eb2a1923d22' } };

// ---- parseDonor ----
ok(JSON.stringify(parseDonor('props:sign_a/face_01')) === '{"pack":"props","model":"sign_a","material":"face_01"}', 'a donor is <pack>:<model>/<material>');
ok(JSON.stringify(parseDonor('naboo:tree/leaf/with a slash')) === '{"pack":"naboo","model":"tree","material":"leaf/with a slash"}', 'its material name may hold what a material name holds');
ok(parseDonor('props:sign') === null && parseDonor('Props:sign/x') === null && parseDonor(7) === null && parseDonor('props:s/' + 'x'.repeat(PLACEMENT_LIMITS.material + 1)) === null, 'anything else is no donor');

// ---- readLooks ----
{
  ok(JSON.stringify(readLooks([{ of: '*', tint: '#a05030' }, { of: 'glass', map: 'props:s/face' }])) === '[{"of":"*","tint":"#a05030"},{"of":"glass","map":"props:s/face"}]', 'a tint and a borrowed picture read');
  ok(JSON.stringify(readLooks([{ of: 'body', tint: '#000000', map: 'props:s/face' }])) === '[{"of":"body","tint":"#000000","map":"props:s/face"}]', 'both on one material');
  ok(JSON.stringify(readLooks([{ of: 'body', like: 'tatooine:crate/wood' }])) === '[{"of":"body","like":"tatooine:crate/wood"}]', 'a borrowed material');
  ok(readLooks([]) === undefined, 'an empty list is no look at all');
  const bad: unknown[] = [
    'x',
    [{ of: 'a', like: 'p:m/n', tint: '#000000' }],
    [{ of: 'a' }],
    [{ of: 'a', tint: 'red' }],
    [{ of: 'a', tint: '#fff' }],
    [{ of: 'a', map: 'nowhere' }],
    [{ of: 'a', tint: '#000000', extra: 1 }],
    [{ of: 'a', tint: '#000000' }, { of: 'a', tint: '#111111' }],
    [{ of: '', tint: '#000000' }],
    Array.from({ length: PLACEMENT_LIMITS.looks + 1 }, (_, i) => ({ of: `m${i}`, tint: '#000000' })),
  ];
  ok(bad.every((b) => readLooks(b) === null), 'a borrowed material beside anything, nothing at all, a tint not #rrggbb, a bad donor, a field it has not got, a material named twice, no name, past the backstop: none read');
}

// ---- readAttachments ----
{
  const a = readAttachments([{ fx: 'props:particles/fire.json', at: [0, 1.5, 0], q: [0, 0, 1, 0], size: 2 }, { snd: 'sound/amb_hum.snd', at: [1, 0, 0] }]);
  ok(JSON.stringify(a) === '[{"fx":"props:particles/fire.json","at":[0,1.5,0],"q":[0,0,1,0],"size":2}, {"snd":"sound/amb_hum.snd","at":[1,0,0]}]'.replace(', ', ','), 'an effect with its place, turn and size, and a sound with its place');
  ok(JSON.stringify(readAttachments([{ fx: 'p:f.json', at: [0, 0, 0], q: [1, 0, 0, 0], size: 1 }])) === '[{"fx":"p:f.json"}]', 'the origin, no turn and a size of 1 are written absent: one place, one spelling');
  const bad: unknown[] = [
    [{ fx: 'p:f.json', snd: 'a.snd' }],
    [{}],
    [{ fx: 'p:../f.json' }],
    [{ fx: 'f.json' }],
    [{ snd: 'a.wav' }],
    [{ snd: 'a.snd', q: [1, 0, 0, 0] }],
    [{ snd: 'a.snd', size: 2 }],
    [{ fx: 'p:f.json', at: [0, 1] }],
    [{ fx: 'p:f.json', at: [PLACEMENT_LIMITS.attachReach + 1, 0, 0] }],
    [{ fx: 'p:f.json', q: [2, 0, 0, 0] }],
    [{ fx: 'p:f.json', size: PLACEMENT_LIMITS.sizeMax * 2 }],
    Array.from({ length: PLACEMENT_LIMITS.attachments + 1 }, () => ({ snd: 'a.snd' })),
  ];
  ok(bad.every((b) => readAttachments(b) === null), 'both or neither of an effect and a sound, a path that climbs, no pack, not a sound template, a sound turned or sized, a bad place, turn or size, past the backstop: none read');
  ok(readAttachments([]) === undefined, 'an empty list is none');
}

// ---- readPlacementRow: the fields, and a mark. ----
{
  const unknown: string[] = [];
  const row = readPlacementRow({ id: 'lamp-1', kind: 'prop', pack: 'props', thing: 'lamp', x: 1, y: 2, z: 3, q: [1, 0, 0, 0], mats: [{ of: '*', tint: '#102030' }], attach: [{ snd: 'sound/x.snd' }] }, unknown) as PlacementRow;
  ok(typeof row === 'object' && row.mats!.length === 1 && row.attach!.length === 1 && !unknown.length, 'a row keeps its looks and its attachments');
  const kept: string[] = [];
  const bad = readPlacementRow({ id: 'lamp-2', kind: 'prop', pack: 'props', thing: 'lamp', x: 1, y: 2, z: 3, q: [1, 0, 0, 0], mats: [{ of: 'x' }], attach: 'no' }, kept) as PlacementRow;
  ok(typeof bad === 'object' && bad.mats === undefined && bad.attach === undefined && kept.includes('lamp-2.mats') && kept.includes('lamp-2.attach'), 'ones that do not read are kept out of the row with their note, and the row stands as it is');
  const mark = readPlacementRow({ id: 'mark-1', kind: 'mark', x: 1, y: 2, z: 3, q: [1, 0, 0, 0], attach: [{ fx: 'props:particles/fire.json' }] }) as PlacementRow;
  ok(typeof mark === 'object' && mark.kind === 'mark' && mark.pack === undefined && mark.attach!.length === 1, 'a mark carries attachments alone, with no pack');
  ok(/a mark carries attachments/.test(readPlacementRow({ id: 'mark-2', kind: 'mark', x: 1, y: 2, z: 3, q: [1, 0, 0, 0] }) as string), 'a mark with nothing to carry is no row at all');
  ok(/a mark carries attachments/.test(readPlacementRow({ id: 'mark-3', kind: 'mark', x: 1, y: 2, z: 3, q: [1, 0, 0, 0], attach: [] }) as string), 'nor with an empty list');
  ok(/a mark names no pack/.test(readPlacementRow({ id: 'mark-4', kind: 'mark', pack: 'props', thing: 'x', x: 1, y: 2, z: 3, q: [1, 0, 0, 0], attach: [{ snd: 'a.snd' }] }) as string), 'and names no pack, thing or model');
  const marked: string[] = [];
  const m2 = readPlacementRow({ id: 'mark-5', kind: 'mark', x: 1, y: 2, z: 3, q: [1, 0, 0, 0], attach: [{ snd: 'a.snd' }], solid: true, scale: 2, mats: [{ of: '*', tint: '#000000' }] }, marked) as PlacementRow;
  ok(typeof m2 === 'object' && m2.solid === undefined && m2.scale === undefined && m2.mats === undefined && ['mark-5.solid', 'mark-5.scale', 'mark-5.mats'].every((k) => marked.includes(k)), "a thing's fields on a mark are kept out with their notes");
  ok(PLACEMENT_FIELDS.indexOf('mats') === PLACEMENT_FIELDS.indexOf('scale') + 1 && PLACEMENT_FIELDS.indexOf('attach') === PLACEMENT_FIELDS.indexOf('mats') + 1 && PLACEMENT_FIELDS.indexOf('name') === PLACEMENT_FIELDS.indexOf('attach') + 1, 'written after the scale and before the name');
  const text = placementsFileText('tatooine', 'raw', [row, mark]);
  const back = readPlacementsFile(text, 'tatooine', 'ground');
  ok(back.rows.length === 2 && JSON.stringify(back.rows.find((r) => r.id === 'lamp-1')) === JSON.stringify(row) && JSON.stringify(back.rows.find((r) => r.id === 'mark-1')) === JSON.stringify(mark), 'a file written with both reads back as it was written');
}

// ---- The hashes. ----
{
  const base = readPlacementRow({ id: 'lamp-1', kind: 'prop', pack: 'props', thing: 'lamp', x: 1, y: 2, z: 3, q: [1, 0, 0, 0] }) as PlacementRow;
  const tinted = { ...base, mats: [{ of: '*', tint: '#102030' }] } as PlacementRow;
  const hung = { ...base, attach: [{ fx: 'p:f.json', at: [0, 1, 0] as [number, number, number] }] } as PlacementRow;
  const moved = { ...base, attach: [{ fx: 'p:f.json', at: [0, 2, 0] as [number, number, number] }] } as PlacementRow;
  ok(rowHash(tinted) !== rowHash(base), "a look moves the stand's hash: a row tinted is stood again");
  ok(rowHash(hung) === rowHash(base) && rowHash(moved) === rowHash(base), "what hangs on a row does not: an attachment moved never stands its row again (a folded row stays folded)");
  ok(attachHash(base) === '' && attachHash(hung) !== attachHash(moved) && attachHash(hung) === attachHash({ ...hung }), 'it has a hash of its own beside it, nothing for none');
  ok(lookSignature([{ of: '*', tint: '#102030' }]) === lookSignature([{ of: '*', tint: '#102030' }]) && lookSignature([{ of: '*', tint: '#102030' }]) !== lookSignature([{ of: '*', tint: '#102031' }]), 'a look\'s signature: two alike are one group');
  const corpus: Record<string, unknown>[] = [
    { id: 'a-1', kind: 'prop', pack: 'props', thing: 'chair', x: 1, y: 2, z: 3, q: [1, 0, 0, 0] },
    { id: 'b-1', kind: 'building', pack: 'gallery', model: 'house', x: -100, y: 0.5, z: 20, q: [0.7071067811865476, 0, 0.7071067811865476, 0], clear: 12, guard: 3 },
    { id: 'c-1', kind: 'prop', pack: 'world', model: 'tree', template: 'object/tangible/x.iff', from: 'naboo', x: 5, y: 1, z: 2, q: [1, 0, 0, 0], scale: [1, 2, 1], state: 'restuss=ruins', solid: false },
    { id: 'd-1', kind: 'prop', pack: 'props', thing: 'lamp', x: 7, y: 2, z: -9, q: [1, 0, 0, 0], inside: true, scale: 3, name: 'TEST: a lamp', note: 'a note', at: 5 },
  ];
  const old = await loadOld<{ readPlacementRow: typeof readPlacementRow; rowHash: typeof rowHash }>(['src/story/placements.ts'], 'src/story/placements.ts', PRE_WAVE);
  const hashes = (h: (r: Record<string, unknown>) => string) => sha(corpus.map(h).join('\n'));
  const now = hashes((r) => rowHash(readPlacementRow(r) as PlacementRow));
  if (!old) ok(now === PRE_WAVE_ROW_HASHES, `git cannot hand ${PRE_WAVE} over: every row with neither looks nor attachments hashes as the hashes recorded from its reader (${now})`);
  else {
    const same = corpus.every((r) => rowHash(readPlacementRow(r) as PlacementRow) === old.rowHash(old.readPlacementRow(r) as PlacementRow));
    ok(same, `every row with neither looks nor attachments hashes exactly as ${PRE_WAVE}'s reader hashed it (${corpus.length} rows)`);
    const then = hashes((r) => old.rowHash(old.readPlacementRow(r) as PlacementRow));
    ok(then === PRE_WAVE_ROW_HASHES, `and its hashes are the ones recorded here for a machine where git cannot hand it over (${then})`);
  }
}

// ---- A file written before this wave reads and writes back byte for byte. ----
{
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const repo = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
  type Old = { readPlacementsFile: typeof readPlacementsFile; placementsFileText: typeof placementsFileText };
  const old = await loadOld<Old>(['src/story/placements.ts'], 'src/story/placements.ts', PRE_WAVE);
  for (const world of ['tutorial', 'monument']) {
    const text = readFileSync(join(repo, 'public', 'placements', 'world', `${world}.json`), 'utf8').replace(/\r\n/g, '\n');
    const read = readPlacementsFile(text, world, 'ground');
    const again = placementsFileText(world, 'raw', read.rows);
    // What a70487c's reader and writer made of the file as it stood when this wave began (its text's hash, then what was
    // written back's), held where git cannot hand that reader over and the file is still that text.
    const rec = PRE_WAVE_FILES[world];
    if (!old) {
      if (sha(text) === rec.text) ok(sha(again) === rec.back, `git cannot hand ${PRE_WAVE} over: ${world}'s committed map edits are written back as the writing recorded from it (${sha(again)})`);
      else note(`git cannot hand ${PRE_WAVE} over here and ${world}'s file has changed since the wave: it is held to its own text only`);
      continue;
    }
    const then = old.placementsFileText(world, 'raw', old.readPlacementsFile(text, world, 'ground').rows);
    ok(read.rows.length > 0 && again === then && JSON.stringify(read.rows) === JSON.stringify(old.readPlacementsFile(text, world, 'ground').rows), `${world}'s committed map edits (${read.rows.length} rows) read as ${PRE_WAVE} read them and are written back as it wrote them, byte for byte`);
    if (sha(text) === rec.text) ok(sha(then) === rec.back, `and that writing is the one recorded here for a machine where git cannot hand it over (${sha(text)} written back as ${sha(then)})`);
    else note(`${world}'s file has changed since the wave (${sha(text)}): the recorded writing is of the file it was`);
    // A file the writer itself wrote comes back exactly as it was (monument's is; the tutorial's was written by hand).
    if (world === 'monument') ok(again === text, "and monument's, which the writer wrote, reads and writes back to its own text");
  }
}

// ---- The endpoint writes both and reads them back. ----
{
  const glue = await import('../../../tools/dev/placementsEndpoint.mjs');
  const ctx: PlacementCtx = { worlds: new Map([['tatooine', 'ground']] as const), now: 1_800_000_000_000, hash: glue.revisionOf };
  const put = { id: 'lamp-1', kind: 'prop', pack: 'props', thing: 'lamp', x: 1, y: 2, z: 3, q: [1, 0, 0, 0], mats: [{ of: '*', tint: '#102030' }], attach: [{ fx: 'props:particles/fire.json', at: [0, 1, 0] }] };
  const r = applyPlacementOp({ op: 'batch', world: 'tatooine', edits: [{ file: 'world', put }, { file: 'world', put: { id: 'mark-1', kind: 'mark', x: 4, y: 0, z: 4, q: [1, 0, 0, 0], attach: [{ snd: 'sound/x.snd' }] } }] }, { story: null, world: null }, ctx);
  ok(r.status === 200 && r.writes.length === 1, `a batch putting a looked, hung row and a mark is written (${r.status})`);
  const back = readPlacementsFile(r.writes[0].text!, 'tatooine', 'ground');
  const lamp = back.rows.find((x) => x.id === 'lamp-1');
  ok(!!lamp && lamp.mats![0].tint === '#102030' && lamp.attach![0].fx === 'props:particles/fire.json' && back.rows.some((x) => x.id === 'mark-1' && x.kind === 'mark'), 'and reads back with them');
  // The endpoint's own sameness (`sameRow`, which the read-back and every `was` ask) sees what hangs on a row, though the
  // stand's hash does not: an undo whose row was read before its effect was moved is refused, as for any change.
  const current = { story: null, world: r.writes[0].text };
  const stood = { ...put, at: ctx.now };
  const fresh = applyPlacementOp({ op: 'batch', world: 'tatooine', edits: [{ file: 'world', put: { ...put, x: 2 }, was: stood }] }, current, ctx);
  ok(fresh.status === 200, `a write whose was is the row as it stands goes through (${fresh.status})`);
  const stale = applyPlacementOp({ op: 'batch', world: 'tatooine', edits: [{ file: 'world', put: { ...put, x: 2 }, was: { ...stood, attach: [{ fx: 'props:particles/fire.json', at: [0, 5, 0] }] } }] }, current, ctx);
  ok(stale.status === 409 && /has changed in .* since the editor read it/.test((stale.body as { why?: string }).why ?? ''), `and one whose was differs from it in an attachment alone is refused (${stale.status}: ${(stale.body as { why?: string }).why})`);
  const minted = applyPlacementOp({ op: 'batch', world: 'tatooine', edits: [{ file: 'world', put: { kind: 'mark', x: 4, y: 0, z: 4, q: [1, 0, 0, 0], attach: [{ snd: 'sound/x.snd' }] } }] }, { story: null, world: null }, ctx);
  const mintedRows = readPlacementsFile(minted.writes[0].text!, 'tatooine', 'ground').rows;
  ok(minted.status === 200 && /^mark-/.test(mintedRows[0].id), `a mark put with no id is minted one of its own kind (${mintedRows[0].id})`);
}

console.log(`\nplacementsLooks: ${checks} checks passed`);
