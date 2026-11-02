// The world editor's hand on what the world places (Map-maker II's twelfth wave): the very `EditorRemovals` and `EditorZones`
// classes the editor runs, over a host of their own whose edits record each write (one write and one undo entry a change,
// `putRows`). Hide and hide with its ground; Move (the thing hidden and a world row of its model at its place in the same
// write, the row picked) and Copy as row (the row alone); the walk-through switch on one thing, on this world's model and on
// every world's (the shared file, its row's before as it stood); a person taken away and given back, a site the same; one of
// his own people placed at the aim in the raw frame with the person dials' defaults; a seat of ours made permanent into the
// editor's destination file; Copy as cast; a space zone refused in words. And the zone tool's circle at the aim carried into
// the raw frame, and a zone made from a place of ours.
import assert from 'node:assert/strict';
import { EditorRemovals, PLACED_PERSON_TUNE, type RemovalsHost } from '../../../src/editor/editorRemovals.ts';
import { EditorZones, ZONE_TOOL_TUNE, type ZonesHost } from '../../../src/editor/editorZones.ts';
import { readPersonRow } from '../../../src/story/placedPeople.ts';
import { readRemovalRow, type RemovalRow } from '../../../src/story/removals.ts';
import type { PlacedObject } from '../../../src/world/layoutStream.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

type Change = { file: string; id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null };
const T = 'object/building/tatooine/shared_cantina_tatooine.iff';
const KEY = `o:${T}@3500,5,-4800`;
const centre = { x: 3500, z: -4800 };

function host(kind: 'ground' | 'space' = 'ground') {
  const writes: { label: string; changes: Change[] }[] = [];
  let rows: RemovalRow[] = [];
  const people: Record<string, unknown>[] = [];
  const solid = new Map<string, boolean>([['object/tangible/flora/shared_fern.iff', false]]);
  const selected: string[][] = [];
  const said: string[] = [];
  const edits = {
    putRows: async (label: string, changes: Change[]) => {
      writes.push({ label, changes });
      // Landed as the batch would: the removal file's rows laid over by id.
      for (const c of changes) if (c.file === 'removed') rows = [...rows.filter((r) => r.id !== c.id), ...(c.after ? [c.after as unknown as RemovalRow] : [])];
      return label;
    },
    mintIds: (bases: readonly string[]) => bases.map((b, i) => `${b}-${i + 1}`),
  };
  const obj = { template: T, x: 0, y: 5, z: 0, contained: false } as unknown as PlacedObject;
  const h: RemovalsHost = {
    edits: edits as never,
    worldKind: () => kind,
    world: () => 'tatooine',
    rows: () => rows,
    people: () => people as never,
    solidRows: () => solid,
    keyOf: () => KEY,
    extentWords: () => "not converted (only the flora's extents are read)",
    ruleWords: () => 'solid, by its size',
    rowsFromObject: (_o, ids) => ({ file: 'world', rows: [{ id: ids(['cantina'])[0], kind: 'building', pack: 'world', model: 'cantina', template: T, x: 3500, y: 5, z: -4800, q: [1, 0, 0, 0] }] }),
    peopleNear: () => [],
    sitesNear: () => [],
    hiddenNear: () => [],
    nullNear: () => [],
    nullTemplates: () => [{ template: 'object/tangible/flora/shared_fern.iff', count: 12 }],
    seatsNear: () => [],
    seatRow: (key) => (key === 'seat-a' ? { id: 'thm_frn_chair_s01-1', kind: 'prop', pack: 'props', thing: 'chair', x: 1, y: 2, z: 3, q: [1, 0, 0, 0], furniture: 'seat' } : `no seat of ours ${key} stands here`),
    dest: () => 'world',
    aim: () => ({ x: 10, y: 6, z: 20, valid: true }),
    rawOf: (x, z) => ({ x: centre.x - x, z: z + centre.z }),
    roomAt: () => 0,
    headingRaw: () => -90,
    select: (ids) => selected.push(ids),
    gridNote: () => '',
    say: (w) => said.push(w),
  };
  return { h, writes, selected, said, obj, rows: () => rows };
}

{
  const t = host();
  const r = new EditorRemovals(t.h);
  ok((await r.hide()) !== '' && t.writes.length === 0, 'nothing picked: Hide writes nothing, and says so');
  r.pick(t.obj);
  await r.hide(true);
  const w = t.writes[0];
  ok(w.changes.length === 1 && w.changes[0].file === 'removed' && w.changes[0].id === KEY && w.changes[0].after?.hide === true && w.changes[0].after?.ground === 'drop' && w.changes[0].before === null, 'Hide with its ground: one write of one row, the thing hidden and its ground with it');
  ok(typeof readRemovalRow(w.changes[0].after) !== 'string', 'a row the file\'s own reader takes');
  await r.unhide(KEY);
  ok(t.writes[1].changes[0].after === null && t.writes[1].changes[0].before?.hide === true, 'Show again takes the row out, its before the row as it stood (one undo puts it back)');
  await r.move(false);
  const mv = t.writes[2];
  ok(mv.changes.length === 2 && mv.changes[0].file === 'removed' && mv.changes[0].after?.hide === true && mv.changes[1].file === 'world' && mv.changes[1].after?.template === T, 'Move: the thing hidden and a world row of its model at its place, in one write');
  ok(t.selected.at(-1)?.[0] === 'cantina-1' && r.picked === null, 'the row picked for the gizmo, the world thing let go');
  r.pick(t.obj);
  t.rows().length = 0;
  await r.move(true);
  ok(t.writes[3].changes.length === 1 && t.writes[3].changes[0].file === 'world', 'Copy as row: the row alone, the thing left standing');
}
{
  const t = host();
  const r = new EditorRemovals(t.h);
  r.pick(t.obj);
  await r.setSolid('thing', false);
  ok(t.writes[0].changes[0].id === KEY && t.writes[0].changes[0].after?.solid === false && t.writes[0].changes[0].after?.hide === undefined, 'walked through, this thing: its own row');
  await r.setSolid('world', true);
  ok(t.writes[1].changes[0].id === `t:${T}` && t.writes[1].changes[0].after?.solid === true, "solid, this world's model: its template row");
  await r.setSolid('everywhere', false, 'object/tangible/flora/shared_fern.iff');
  ok(t.writes.length === 2, "every world's switch already as asked writes nothing");
  await r.setSolid('everywhere', true, 'object/tangible/flora/shared_fern.iff');
  const s = t.writes[2].changes[0];
  ok(s.file === 'solid' && s.id === 'object/tangible/flora/shared_fern.iff' && s.before?.solid === false && s.after?.solid === true, "every world's: the shared file's row, its before as it stood, so an undo gives the file back");
  await r.setSolid('everywhere', null, 'object/tangible/flora/shared_fern.iff');
  ok(t.writes[3].changes[0].after === null, 'and taken off it altogether');
  await r.setSolid('thing', null);
  ok(t.writes[4].changes[0].after === null, "this thing's switch taken off: its row, saying nothing more, taken out");
}
{
  const t = host();
  const r = new EditorRemovals(t.h);
  await r.person('2b2c346e6abc');
  await r.site('tatooine:3:4');
  ok(t.writes[0].changes[0].id === 'p:2b2c346e6abc' && t.writes[1].changes[0].id === 's:tatooine:3:4', 'a person and a site taken away by key');
  await r.person('2b2c346e6abc', true);
  ok(t.writes[2].changes[0].after === null, 'and given back');
  // His own person at the aim.
  const tune = { ...PLACED_PERSON_TUNE };
  try {
    PLACED_PERSON_TUNE.respawn = 0;
    PLACED_PERSON_TUNE.roam = 4;
    await r.placePerson('human_male', 'npc_sitting_chair', null, 'Kael');
  } finally {
    Object.assign(PLACED_PERSON_TUNE, tune);
  }
  const p = t.writes[3].changes[0];
  const row = readPersonRow(p.after);
  ok(p.file === 'people' && typeof row !== 'string' && row.id === 'kael-1' && row.x === 3490 && row.z === -4780 && row.y === 6 && row.heading === 270 && row.mood === 'npc_sitting_chair' && row.still === true && row.peaceful === true && row.respawn === 0 && row.roam === 4 && row.name === 'Kael', "his own person at the aim, carried into the raw frame, its heading the eye's (0 to 360), the person dials' defaults written");
  await r.makeSeatPermanent('seat-a');
  ok(t.writes[4].changes[0].file === 'world' && t.writes[4].changes[0].after?.furniture === 'seat', "a seat of ours made permanent into the editor's destination file, its furniture word with it");
  ok(/no seat of ours/.test(await r.makeSeatPermanent('nope')) && t.writes.length === 5, 'one not standing writes nothing and says so');
}
{
  const t = host('space');
  const r = new EditorRemovals(t.h);
  r.pick(t.obj);
  ok(/space zone/.test(await r.hide()) && t.writes.length === 0, "a space zone's removals are refused in words");
}
{
  // The zone tool.
  const writes: { label: string; changes: Change[] }[] = [];
  const zh: ZonesHost = {
    edits: { putRows: async (label: string, changes: Change[]) => (writes.push({ label, changes }), label) } as never,
    worldKind: () => 'ground',
    rows: () => [],
    locations: () => [{ id: 'quiet-flats', kind: 'area', name: 'Quiet Flats', shape: { kind: 'rect', min: [-10, -20], max: [30, 40] } } as never],
    toRaw: (x, z, out) => {
      out.x = centre.x - x;
      out.z = z + centre.z;
    },
    toGame: (x, z, out) => {
      out.x = centre.x - x;
      out.z = z - centre.z;
    },
    groundAt: () => 0,
    groundCached: () => false,
    keptOff: () => null,
    goTo: () => {},
    say: () => {},
  };
  const z = new EditorZones(zh);
  await z.writeCircle(10.004, 20.006, 60.0049);
  const c = writes[0].changes[0];
  ok(c.file === 'removed' && c.id === 'z:zone-1' && (c.after?.shape as { c: number[]; r: number }).c.join() === '3490,-4779.99' && (c.after?.shape as { r: number }).r === 60, 'a circle at the aim carried into the raw frame, to the centimetre');
  ok(c.after?.keeps === undefined && ZONE_TOOL_TUNE.keeps.length === 3, 'keeping all three by default, written as none');
  await z.fromPlace('quiet-flats', ['wild']);
  const f = writes[1].changes[0];
  ok(f.id === 'z:quiet-flats' && f.after?.name === 'Quiet Flats' && (f.after?.shape as { kind: string }).kind === 'rect' && (f.after?.keeps as string[]).join() === 'wild', 'a zone from a place of ours: its shape and name, keeping what was asked');
}

{
  // The Here tab's whole-world list of what the client walked through (the owner's amendment: a world's, not only what is
  // near), each model switched by its template with nothing picked.
  const t = host();
  const r = new EditorRemovals(t.h);
  const sec = r.sections('here').find((s) => /walked through/.test(s.title) && /This world/.test(s.title));
  ok(!!sec && sec.rows?.[0]?.words.includes('x12') === true && /1 model with a NULL extent, 12 copies/.test(sec.note ?? ''), `the world's NULL-extent models are listed with their copies (${sec?.rows?.[0]?.words})`);
  await r.act('solidT:world:0:object/tangible/flora/shared_fern.iff');
  ok(t.writes[0]?.changes[0]?.id === 't:object/tangible/flora/shared_fern.iff' && t.writes[0].changes[0].after?.solid === false, "and one walked through here by its template's row, with nothing picked");
}

// ---- the real host's frames ---------------------------------------------------------------------------------------------------
// What the editor's host (and the console's `removals`) carries into the files' raw frame is `removalFrames.ts`, run here and
// held to the streamer's own mirror and the people's own carry, since the hand above runs over a host this test wrote.
{
  const THREE = await import('three');
  const { rawOfGame, headingRawOf, rowOfLayoutThing } = await import('../../../src/world/removalFrames.ts');
  const { readPlacementRow, toGame } = await import('../../../src/story/placements.ts');
  const { placedStandingRow, readPersonRow: readPerson } = await import('../../../src/story/placedPeople.ts');
  const { StandingPeople } = await import('../../../src/world/standingPeople.ts');
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { REPO } = await import('./oldModules.ts');
  // One of the layout's own objects, turned and tilted, on a world whose centre is kilometres off the origin.
  const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 1.3, -0.1));
  const o = { model: 'cantina', template: T, x: 3612.345, y: 7.25, z: -4731.5, q: [tq.w, tq.x, tq.y, tq.z], contained: false };
  const row = rowOfLayoutThing(o, 'cantina-1', true);
  const read = readPlacementRow(row);
  ok(typeof read !== 'string', `Move's row is one the file's own reader takes (${typeof read === 'string' ? read : 'read'})`);
  const g = toGame(read as never, centre);
  // The streamer's own mirror of that layout object (its constructor): x about the centre negated, z less the centre's, the
  // turn (w, x, y, z) as three's (x, -y, -z, w).
  const want = { x: -(o.x - centre.x), y: o.y, z: o.z - centre.z, q: new THREE.Quaternion(o.q[1], -o.q[2], -o.q[3], o.q[0]) };
  const got = new THREE.Quaternion(g.q[0], g.q[1], g.q[2], g.q[3]);
  ok(Math.abs(g.x - want.x) < 1e-3 && Math.abs(g.y - want.y) < 1e-3 && Math.abs(g.z - want.z) < 1e-3 && got.angleTo(want.q) < 1e-5, `Move's row stands where the streamer stands the object it moved, at its very turn (${g.x.toFixed(3)}, ${g.z.toFixed(3)})`);
  ok((row as { kind: string; inside?: boolean }).kind === 'building' && rowOfLayoutThing({ ...o, contained: true }, 'c-2', false).inside === true, 'a building as a building, a thing in a room inside');
  const raw = rawOfGame(centre, want.x, want.z)!;
  ok(Math.abs(raw.x - o.x) < 1e-9 && Math.abs(raw.z - o.z) < 1e-9 && rawOfGame(null, 1, 2) === null, "a point of the game's frame carried back into the raw frame lands on the layout's own place (and with no frame, nowhere)");
  // A person placed facing as the eye faces: stood by the people's own carry, they face the eye's way.
  let worst = 0;
  for (const yaw of [0, 0.4, 1.7, 3.0, -2.2, 5.9]) {
    const heading = headingRawOf(yaw, false);
    const person = readPerson({ id: 'p-1', body: 'human_male', x: 3500, y: 0, z: -4800, heading: ((heading % 360) + 360) % 360 });
    assert.ok(typeof person !== 'string');
    const people = new StandingPeople();
    people.adopt([placedStandingRow(person) as never], null, { world: 'tatooine' });
    let stood = NaN;
    people.step(0, 0, new THREE.Vector3(0, 0, 0), { catalogue: () => ({ byId: (id: string) => ({ id, name: id, ready: true }) }), spawn: (_e: unknown, at: { heading?: number }) => ((stood = at.heading ?? NaN), {}), remove: () => {}, centre: () => centre, held: () => false } as never, true);
    worst = Math.max(worst, Math.hypot(Math.sin(stood) - -Math.sin(yaw), Math.cos(stood) - -Math.cos(yaw)));
  }
  ok(worst < 1e-9, `a person placed at the eye's raw heading stands facing the way the eye looks, at every yaw tried (worst ${worst.toExponential(1)})`);
  const entry = readFileSync(join(REPO, 'src/editor/editorEntry.ts'), 'utf8');
  const main = readFileSync(join(REPO, 'src/main.ts'), 'utf8');
  ok(/const toRaw = \(x: number, z: number\): \{ x: number; z: number \} \| null => rawOfGame\(w\.placeFrame, x, z\);/.test(entry) && /headingRaw: \(\) => headingRawOf\(me\.fly\.yaw, !!w\.planet\?\.space\),/.test(entry) && /rows\.push\(rowOfLayoutThing\(\{ model: x\.model, template: x\.template, x: x\.x, y: x\.y, z: x\.z, q: x\.q, contained: x\.contained \}, made\[i\], i === 0 && building\)\);/.test(entry), "the editor's host carries every point, facing and moved object through these very functions");
  ok(/toRaw: \(x, z\) => rawOfGame\(this\.world\.placeFrame, x, z\),/.test(main), "and so does the console's");
}
{
  // A zone gone to from the Here tab: the eye over its middle, back from it by its reach.
  const went: number[][] = [];
  const zh = {
    edits: {} as never,
    worldKind: () => 'ground' as const,
    rows: () => [{ id: 'z:quiet', name: 'Quiet', shape: { kind: 'circle', c: [3480, -4790], r: 40 } }] as never,
    locations: () => [],
    toRaw: (x: number, z: number, out: { x: number; z: number }) => {
      out.x = centre.x - x;
      out.z = z + centre.z;
    },
    toGame: (x: number, z: number, out: { x: number; z: number }) => {
      out.x = centre.x - x;
      out.z = z - centre.z;
    },
    groundAt: () => 0,
    groundCached: () => false,
    keptOff: () => null,
    goTo: (x: number, z: number, r: number) => void went.push([x, z, r]),
    say: () => {},
  };
  const z = new EditorZones(zh as ZonesHost);
  ok(z.sections('here')[0]?.rows?.[0]?.buttons?.some((b) => b.label === 'Go to' && b.act === 'zone:go:z:quiet') === true, "the Here tab's zones carry a Go to");
  await z.act('zone:go:z:quiet');
  ok(went.length === 1 && Math.abs(went[0][0] - 20) < 1e-9 && Math.abs(went[0][1] - 10) < 1e-9 && Math.abs(went[0][2] - 40) < 0.5, `and it flies the eye over the zone's middle in the game's frame, by its reach (${went[0]?.map((v) => v.toFixed(2)).join(', ')})`);
}

console.log(`\n${checks} checks passed`);
