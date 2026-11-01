// The world editor's places tool, live (Map-maker II's eighth wave, `src/editor/editorPlaces.ts`), driven as the editor drives
// it -- its frames (`step`, then `overlay` from the frame's view) -- over a stand-in host whose writes land as the endpoint
// stamps them and the game lands them (a row put by id, an id taken out). Held here: a circle by a click, a rectangle by a
// drag (a slip writing nothing), an outline by clicks (closed, RMB taking a point back), each one write and one undo entry,
// its shape in the raw frame about the world's centre with x mirrored and to the centimetre; a move, a size, a field and a
// removal, each exact; the world row's switch and lines (and a world row left saying nothing taken out); the size the wheel
// asks written once the wheel rests; a ring picked by a click and a click away letting it go; the outlines drawn, a place
// players may not build in marked bad and the world row never drawn; Escape's order; a space zone and the copies refused; a
// place as a story area; and the editor's and the game's hand-overs, pinned as text.
//
// Run: node tools/swg/tests/placesTool.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EditorPlaces, movedShape, placeAreaSnippet, placesTool, scaledShape, shapePoints, type PlacesHost } from '../../../src/editor/editorPlaces.ts';
import { PLACES_TOOL_TUNE, PLACES_TOOL_TUNE_DEFAULTS, tunePlacesTool } from '../../../src/editor/editorTune.ts';
import { toolFrame } from '../../../src/editor/tools.ts';
import { screenView } from '../../../src/editor/gizmo.ts';
import { marksView } from '../../../src/ui/editorMarks.ts';
import { readLocationRow, type LocationRow } from '../../../src/world/editFiles/locationsFile.ts';
import { landedLocations } from '../../../src/world/places.ts';
import type { RowChange } from '../../../src/editor/undo.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const read = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** A world's frame about a centre (a converted world's mirror): raw x = cx - gx, raw z = cz + gz. */
const CX = 1000;
const CZ = -500;

function standIn(kind: 'ground' | 'space' | 'copies' = 'ground') {
  const s = { rows: [] as LocationRow[], writes: [] as RowChange[][], strokes: 0, said: [] as string[], stamp: 100 };
  const edits = {
    beginStroke: (label: string) => ({ label, changes: [] as RowChange[] }),
    async strokeWrite(es: { changes: RowChange[] }, changes: RowChange[]): Promise<string | null> {
      s.writes.push(changes);
      es.changes.push(...changes);
      // The endpoint stamps every put and reads it back; the game lands the rows by difference by its own rule
      // (`landedLocations`, which `GalaxyMap.landLocations` lands by): the rows put, the ids taken out.
      const put: LocationRow[] = [];
      const deleted: string[] = [];
      for (const c of changes) {
        if (c.after) {
          const row = readLocationRow({ ...(c.after as object), at: ++s.stamp });
          if (typeof row === 'string') return row;
          put.push(row);
        } else deleted.push(c.id);
      }
      s.rows = landedLocations(s.rows, put, deleted);
      return null;
    },
    endStroke: (es: { changes: RowChange[] }) => {
      s.strokes++;
      return `${es.changes.length} row${es.changes.length === 1 ? '' : 's'} written`;
    },
  };
  const host: PlacesHost = {
    edits: edits as never,
    worldKind: () => kind,
    rows: () => s.rows,
    toRaw: (x, z, out) => {
      out.x = CX - x;
      out.z = CZ + z;
    },
    toGame: (x, z, out) => {
      out.x = CX - x;
      out.z = z - CZ;
    },
    groundAt: () => 2,
    groundCached: (_x, _z, out) => {
      out.y = 2;
      return true;
    },
    say: (words) => {
      s.said.push(words);
    },
  };
  return Object.assign(s, { host });
}

// A view from straight over the ground: screen x = 500 + gx / 2, screen y = 500 + gz / 2 (one pixel two metres).
const view = screenView();
view.vp[0] = 0.001;
view.vp[9] = -0.001;
view.vp[15] = 1;
view.w = 1000;
view.h = 1000;
const marks = marksView();
const draw = { marks, radius: 0.5, ring() {} };
let now = 1;
function frame(p: EditorPlaces, f: Partial<ReturnType<typeof toolFrame>>): void {
  const t = toolFrame();
  now += 1 / 60;
  Object.assign(t, { apply: false, inverse: false, shift: false, sampled: false, valid: true, dt: 1 / 60, now, sx: 2000, sy: 2000, dy: 0, lift: false }, f);
  p.step(t);
  p.overlay(draw as never, view);
}
async function click(p: EditorPlaces, x: number, z: number, more: Partial<ReturnType<typeof toolFrame>> = {}): Promise<void> {
  frame(p, { apply: true, x, y: 2, z, ...more });
  frame(p, { x, y: 2, z, ...more });
  for (let i = 0; i < 4; i++) await Promise.resolve();
}
const settle = () => new Promise((r) => setTimeout(r, 0));

tunePlacesTool({ ...PLACES_TOOL_TUNE_DEFAULTS });

{
  // Refused where no place of ours is drawn this pass.
  for (const k of ['space', 'copies'] as const) {
    const s = standIn(k);
    const p = new EditorPlaces(s.host);
    await p.arm();
    ok(!p.armed && s.said.length === 1, `P is refused in words in ${k === 'space' ? 'a space zone' : "the dungeons' world of copies"}`);
  }
}

{
  const s = standIn();
  const p = new EditorPlaces(s.host);
  await p.arm();
  ok(p.armed, 'P arms it on a ground world');
  // A circle by a click.
  tunePlacesTool({ mode: 'circle', kind: 'city', radius: 150 });
  await click(p, 40, 60);
  await settle();
  ok(s.writes.length === 1 && s.strokes === 1, 'a click writes a circle: one write, one undo entry');
  const c1 = s.writes[0][0].after as LocationRow;
  ok(c1.id === 'city-1' && c1.kind === 'city' && c1.name === 'City 1', 'named for its kind and number, its id minted from its name');
  ok(c1.shape?.kind === 'circle' && c1.shape.c[0] === CX - 40 && c1.shape.c[1] === CZ + 60 && c1.shape.r === 150, "at the aim, in the raw frame (x mirrored about the centre), the tune's radius");
  ok(p.picked === 'city-1', 'and the tool picks it');
  // C with the wheel and nothing picked sizes the next circle.
  p.picked = null;
  p.size(2);
  ok(Math.abs(PLACES_TOOL_TUNE.radius - 150 * PLACES_TOOL_TUNE.sizeStep ** 2) < 1e-9, 'C with the wheel and nothing picked sizes the next circle');
  tunePlacesTool({ radius: 150 });

  // A rectangle by a drag, and a slip that writes nothing.
  tunePlacesTool({ mode: 'rect', kind: 'area' });
  frame(p, { apply: true, x: 300, y: 2, z: 300 });
  frame(p, { apply: true, x: 340, y: 2, z: 360 });
  ok(p.busy && s.writes.length === 1, 'a drag held writes nothing yet');
  frame(p, { x: 360, y: 2, z: 380 });
  await settle();
  const r1 = s.writes[1][0].after as LocationRow;
  ok(r1.kind === 'area' && r1.shape?.kind === 'rect' && r1.shape.min[0] === CX - 360 && r1.shape.max[0] === CX - 300 && r1.shape.min[1] === CZ + 300 && r1.shape.max[1] === CZ + 380, 'let go, a rectangle from corner to corner, its corners in order in the raw frame');
  // (The rectangle just written is picked: a press away from it lets it go first, so it is let go here.)
  p.picked = null;
  frame(p, { apply: true, x: 500, y: 2, z: 500 });
  frame(p, { x: 500.5, y: 2, z: 520 });
  await settle();
  ok(s.writes.length === 2, `a drag under ${PLACES_TOOL_TUNE.rectLeast} m one way is a slip: nothing written`);
  p.picked = null;
  frame(p, { apply: true, x: 600, y: 2, z: 600 });
  frame(p, { apply: true, inverse: true, x: 640, y: 2, z: 640 });
  frame(p, { x: 640, y: 2, z: 640 });
  await settle();
  ok(s.writes.length === 2, 'RMB during a drag gives it up');

  // An outline by clicks: three points, one taken back, a fourth, then closed.
  tunePlacesTool({ mode: 'outline', kind: 'zone' });
  p.picked = null;
  await click(p, -100, 0);
  await click(p, -60, 0);
  await click(p, -50, 0);
  await click(p, -50, 0, { inverse: true, apply: false });
  ok(p.draftN === 2, 'RMB takes the last point back');
  await click(p, -60, 40);
  await click(p, -100, 40);
  ok(p.draftN === 4 && s.writes.length === 2, 'four points, nothing written');
  // A click on the screen within closePx of the first point closes it (the cursor over its projection: 500 - 50, 500).
  frame(p, { apply: true, x: -99, y: 2, z: 1, sx: 450, sy: 500 });
  frame(p, { x: -99, y: 2, z: 1, sx: 450, sy: 500 });
  await settle();
  const o1 = s.writes[2][0].after as LocationRow;
  ok(o1.kind === 'zone' && o1.shape?.kind === 'poly' && o1.shape.pts.length === 4 && o1.shape.pts[0][0] === CX + 100 && o1.shape.pts[3][1] === CZ + 40, 'a click near the first on the screen closes it: an outline of its four points in the raw frame');
  ok(p.draftN === 0 && s.strokes === 3, 'one write, one undo entry');

  // The drawing: every place's outline, a zone and the circle in their colours; the world row never.
  frame(p, {});
  ok(marks.lakesOn && marks.lakeCount === 3, 'three places drawn');

  // A move, a size, the fields, a removal: each exact.
  const before = s.rows.find((r) => r.id === 'city-1')!;
  await p.movePlace('city-1', 10, -5);
  const mv = s.writes[3][0];
  ok(mv.before === before && (mv.after as LocationRow).shape?.kind === 'circle' && (mv.after as LocationRow & { shape: { c: number[] } }).shape.c[0] === CX - 50 && (mv.after as LocationRow & { shape: { c: number[] } }).shape.c[1] === CZ + 55, 'a move carries its middle by the offset of the game\'s frame, x mirrored in the file');
  await p.scalePlace('city-1', 2);
  ok((s.writes[4][0].after as LocationRow & { shape: { r: number } }).shape.r === 300, 'a size grows a circle about its middle');
  await p.setPlace('city-1', { name: 'Dune Town', build: false, loading: ['Sand gets everywhere.', '  ', 'The dunes sing.'], desc: 'ours' });
  const set = s.writes[5][0].after as LocationRow;
  ok(set.name === 'Dune Town' && set.build === false && set.loading?.length === 2 && set.desc === 'ours' && set.id === 'city-1', 'its fields written: a name, no building, its loading lines (a blank one dropped), a tooltip');
  frame(p, {});
  const townSlot = s.rows.findIndex((r) => r.id === 'city-1');
  ok(marks.lakeBad[townSlot] === 1 && marks.lakeBad[s.rows.findIndex((r) => r.id === 'zone-1')] === 0, 'a place players may not build in is drawn bad, the rest not');
  await p.setPlace('city-1', { build: null });
  ok(!('build' in (s.writes[6][0].after as object)), "a switch set to null goes back to its kind's own (the field taken off)");
  const no = await p.setPlace('city-1', { kind: 'world' });
  ok(s.writes.length === 7 && /kind/.test(no), "a place is never made the world row: refused in words, nothing written");
  // The wheel's size, written as it rests.
  p.picked = 'area-1';
  p.size(1);
  frame(p, {});
  ok(s.writes.length === 7 && p.busy, 'the wheel on a picked place holds its size, nothing written');
  for (let i = 0; i < Math.ceil(PLACES_TOOL_TUNE.sizeRest * 60) + 2; i++) frame(p, {});
  await settle();
  const grown = s.writes[7][0].after as LocationRow & { shape: { min: number[]; max: number[] } };
  ok(s.writes.length === 8 && Math.abs(grown.shape.max[0] - grown.shape.min[0] - 60 * PLACES_TOOL_TUNE.sizeStep) < 0.02, `and written once the wheel has rested ${PLACES_TOOL_TUNE.sizeRest} s, grown about its middle`);
  await p.remove('zone-1');
  ok(s.writes[8][0].after === null && !s.rows.some((r) => r.id === 'zone-1'), 'a removal takes it out');

  // The world row.
  await p.setWorld({ cities: true });
  const w1 = s.rows.find((r) => r.id === 'world');
  ok(w1?.kind === 'world' && w1.cities === 'noBuild' && s.writes[9][0].before === null, "the world row's switch writes the world row");
  await p.setWorld({ loading: ['A world of ours.'] });
  ok(s.rows.find((r) => r.id === 'world')?.loading?.[0] === 'A world of ours.' && s.rows.find((r) => r.id === 'world')?.cities === 'noBuild', 'its loading lines beside the switch');
  await p.setWorld({ cities: false, loading: [] });
  ok(!s.rows.some((r) => r.id === 'world') && s.writes[11][0].after === null, 'a world row left saying nothing is taken out');
  frame(p, {});
  ok(marks.lakeCount === 2, 'and the world row is never drawn');

  // A ring picked by a click on its handle; a click away lets it go first.
  tunePlacesTool({ mode: 'circle' });
  p.picked = null;
  const town = s.rows.find((r) => r.id === 'city-1')!;
  const tg = { x: CX - (town.shape as { c: number[] }).c[0], z: (town.shape as { c: number[] }).c[1] - CZ };
  await click(p, 900, 900, { sx: 500 + tg.x / 2, sy: 500 + tg.z / 2 });
  ok(p.picked === 'city-1' && s.writes.length === 12, "a click on a place's ring picks it and writes nothing");
  await click(p, 900, 900, { sx: 50, sy: 50 });
  ok(p.picked === null && s.writes.length === 12, 'a click away lets it go first, writing nothing');
  await click(p, 900, 900, { sx: 50, sy: 50 });
  ok(s.writes.length === 13, 'and the next click draws');

  // Escape's order: a draft, then the picked place, then nothing (the tool let go by the editor).
  tunePlacesTool({ mode: 'outline' });
  p.picked = null;
  await click(p, 1, 1);
  p.picked = 'city-1';
  ok(p.draftN === 1 && p.escape() && p.draftN === 0 && p.picked === 'city-1', 'Escape gives a draft up first');
  ok(p.escape() && p.picked === null && !p.escape(), 'then lets the picked place go, then nothing of its own');

  // A shape handed in by the console is written to the centimetre, as the file keeps every point.
  await p.writePlace({ kind: 'rect', min: [1549.529, -558.976], max: [1749.5251, -428.9749] }, { kind: 'area', name: 'Odd Figures' }, 'a rectangle (console)');
  const odd = s.rows.find((r) => r.name === 'Odd Figures') as LocationRow & { shape: { min: number[]; max: number[] } };
  ok(!!odd && odd.shape.min[0] === 1549.53 && odd.shape.min[1] === -558.98 && odd.shape.max[0] === 1749.53 && odd.shape.max[1] === -428.97, `a shape handed in by the console is written to the centimetre (${odd?.shape.min.join(', ')})`);
  await p.remove(odd.id);

  // Delete with a place picked takes it out.
  p.picked = 'city-1';
  ok(p.deleteKey(), 'Delete with a place picked takes the key');
  await settle();
  ok(!s.rows.some((r) => r.id === 'city-1'), 'and takes it out');
}

{
  // The pure helpers.
  const turn = (x: number, z: number, out: { x: number; z: number }) => {
    out.x = CX - x;
    out.z = z - CZ;
  };
  const back = (x: number, z: number, out: { x: number; z: number }) => {
    out.x = CX - x;
    out.z = CZ + z;
  };
  const r = movedShape({ kind: 'rect', min: [0, 0], max: [10, 5] }, 3, 2, turn, back);
  ok(r.kind === 'rect' && r.min[0] === -3 && r.max[0] === 7 && r.min[1] === 2 && r.max[1] === 7, "a rectangle moved keeps its corners in order (the game's +x the file's -x)");
  const g = scaledShape({ kind: 'poly', pts: [[0, 0], [10, 0], [10, 10], [0, 10]] }, 0.5);
  ok(g.kind === 'poly' && g.pts[0][0] === 2.5 && g.pts[2][1] === 7.5, 'an outline sized about its middle');
  ok(shapePoints({ kind: 'circle', c: [0, 0], r: 10 }, 48).length === 48 && shapePoints({ kind: 'rect', min: [0, 0], max: [1, 1] }, 48).length === 4, 'a circle drawn round its rim, a rectangle by its corners');
  const snip = placeAreaSnippet({ id: 'dune-town', kind: 'city', name: 'Dune Town', shape: { kind: 'circle', c: [-1250, -3600], r: 300 } }, 'tatooine');
  ok(/"id": "dune-town-area"/.test(snip) && /"world": "tatooine"/.test(snip) && /"shape": \{"kind": "circle", "c": \[-1250, -3600\], "r": 300\}/.test(snip) && /"label": "Dune Town"/.test(snip), "a place as a story area: its own shape in the raw frame, in an area's shape");
  const tool = placesTool(new EditorPlaces(standIn().host));
  ok(tool.id === 'places' && tool.action === 'editorPlaces' && tool.owns('apply') && tool.owns('inverse') && !tool.owns('middle') && !!tool.size, 'the places tool is the list\'s entry on P, owning both buttons and the size');
  // The landing's own rule: the ids taken out leave, a row put by an id it has stands in its place, a new one after the rest.
  const a: LocationRow = { id: 'a', kind: 'place', name: 'A' };
  const b: LocationRow = { id: 'b', kind: 'place', name: 'B' };
  const c: LocationRow = { id: 'c', kind: 'place', name: 'C' };
  const b2: LocationRow = { id: 'b', kind: 'city', name: 'B again' };
  const d: LocationRow = { id: 'd', kind: 'zone', name: 'D' };
  const landed = landedLocations([a, b, c], [b2, d], ['a']);
  ok(landed.map((r) => r.name).join() === 'B again,C,D' && landed[0] === b2, 'a landing takes the ids out, puts a row by its id in its place and a new one after the rest');
  ok(landedLocations([a, b], [], []).length === 2 && landedLocations([a, b], [], ['a', 'b']).length === 0, 'and with nothing put, the rows less the ids taken out');
}

{
  // The hand-overs.
  const input = read('src/core/input.ts');
  ok(/editorPlaces: \['KeyP'\]/.test(input) && /ship: \['KeyP'\]/.test(input), 'P is the places tool, beside the ship menu\'s P (muted while the editor flies)');
  ok(/'editorPlaces'/.test(read('src/editor/editorKeys.ts')), "it is one of the editor's own actions");
  const ed = read('src/editor/editorEntry.ts');
  ok(/this\.places = new EditorPlaces\(this\.placesHost\(\)\);\s*this\.tools\.add\(placesTool\(this\.places\)\);/.test(ed), 'the editor makes the places tool an entry of its Tools list');
  ok(/rows: \(\) => h\.locationRows\?\.\(\) \?\? none,/.test(ed), "its rows are the game's landed rows, one list until the next landing (a frame asks; nothing made)");
  ok(/this\.places\.worldGone\(\);/.test(ed) && /this\.places\.busy/.test(ed), 'the world going drops it, and a write or a held move keeps the automatic fold quiet');
  ok(/if \(!drawnOnMap\(row\)\) notes\.push\('It is not drawn on the maps, so its name is never said and no outline is drawn\.'\);\s*else \{\s*if \(saidOnEntry\(row\)\) notes\.push\([^)]*\);\s*if \(row\.kind === 'city'\) notes\.push\('Its outline is drawn on the minimap\.'\);\s*\}/.test(ed), "the Selected tab says a place on no map is neither said nor outlined, and says either only of a place drawn");
  ok(/LOCATION_DIALS\.tool = placesToolDials\(\);/.test(ed), "the tool's numbers of feel are handed to the debug menu's locations set as the editor loads");
  const main = read('src/main.ts');
  ok(/locationRows: \(\) => this\.placesFile\?\.locations \?\? this\.noLocationRows,/.test(main), 'the game hands the editor its landed rows, a kept empty list before any');
  ok(/if \(lf && this\.world\.generation === gen && this\.editWorld\(\) === pack\) await this\.landLocationRows\(pack, lf\.put as LocationRow\[\], lf\.deleted\);/.test(main), "the editor's write is landed by difference as its answer comes");
  ok(/if \(kind === 'locations'\) return \(pack, rev\) => void this\.reloadLocations\(pack, rev\);/.test(main), "the dev server's word about the file reads it again");
  ok(/const f = await this\.landPlacesOf\(pack, put, deleted\);[\s\S]*?this\.placesFile = f;\s*this\.cityWatch\.reset\(\);\s*this\.refreshPlacesShown\(\);/.test(main), 'a landing makes the merged file again, the city line, the minimap and the maps told');
}

console.log(`placesTool: ${checks} checks passed`);
