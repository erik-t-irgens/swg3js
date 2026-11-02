// The walk grid follows the removal file by being baked again (Map-maker II's twelfth wave; the owner's answer to Q7, as the
// fifth wave built it for heights and water: there is no run-time patch of the grid). The bake (`navgrid`) reads the world's
// removal file (`public/placements/removed/<world>.json`): an object it hides stands nothing in the grid, its building's own
// rooms marked indoor no more and, with `ground: 'drop'`, its terrain layer flattening nothing; and every walk-through
// switch, the thing's own row over this world's template row over the shared `solid.json`, the narrowest winning. The grid's
// key folds in the rows the bake reads and no other, so `status` asks for `navgrid <world>` when one of them moves.
//
// Held here, over one small converted world's own layout (kashyyyk_main):
// - **Day one**: with no removal file the bake is cfa55f3's to the byte, and a file of people, sites and zones alone bakes
//   and keys as no file does.
// - **A hidden building's own cells reopen** with the rank of the open ground beside them; everything that changes lies in
//   its turned footprint and the margin round it; the grid baked with it hidden is the grid baked with it left out of the
//   layout, every plane to the byte.
// - **A cell another object still covers stays blocked**: of two exact twins at one place, hiding either leaves the grid as
//   it was, and hiding both is the grid with both left out.
// - **A deep one stays blocked**: under a lake of ours over half its footprint, those cells stay water while the other half
//   reopens.
// - **An unhide blocks them again**: the file without the row, and a row that only says the thing is solid, are the grid with
//   it standing.
// - **The switches**: a thing walked through (`solid: false`) is the grid with it hidden; a template walked through here is
//   every copy left out; a thing made solid over its template's row stands; a template made solid here stands over the shared
//   file.
// - **The ground it takes**: a building's terrain layer hidden with `ground: 'drop'` flattens nothing, the grid that of the
//   layout with neither building nor layer.
// - **The key**: folds in the rows the bake reads, never a person, a site or a zone; a grid baked before them is stale.
//
// It reads the converted packs on disk (`assets-private`); a world not converted is said and stepped over.

import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { oldTexts, REPO } from './oldModules.ts';
import { NAV_FLAGS, buildNavGrid, gridEditsOf, gridRemovalRows, removalGridWords } from '../navgrid.mjs';
import { gridLayoutStale, layoutKeyOf } from '../finalnames.mjs';
import { ObjectKeyIndex, objectKey, removalsFileText } from '../../../src/story/removals.ts';
import { waterFileText } from '../../../src/world/editFiles/waterFile.ts';

let passed = 0;
function ok(cond: unknown, msg: string): void {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
}
function note(msg: string): void {
  console.log(`note ${msg}`);
}

const PACKS = join(REPO, 'assets-private');
const WORLD = 'kashyyyk_main';
const DIR = join(PACKS, WORLD);
const PLAIN_TEXTS = { heights: null, water: null, world: null, story: null };
const PLAIN = { world: WORLD, texts: PLAIN_TEXTS };
/** No shared walk-through file: the switches below are the only rules over what stands. */
const NO_WT = new Set<string>();

interface Grid {
  header: Record<string, unknown>;
  nibbles: Uint8Array;
  coarse: Uint8Array;
  edges: Uint8Array;
  clear: Uint8Array;
  flags: Uint8Array;
}
type LayoutObject = { template: string; model: string; x: number; y: number; z: number; q?: number[]; contained?: boolean; layer?: string; in?: number };
type Layout = { center: { x: number; z: number }; terrain?: string; objects: LayoutObject[] };

function planes(g: Grid): Buffer {
  return Buffer.concat([g.nibbles, g.coarse, g.edges, g.clear].map((a) => Buffer.from(a)));
}
function nibbleOf(nibbles: Uint8Array, k: number): number {
  const b = nibbles[k >> 1];
  return k & 1 ? b >> 4 : b & 0x0f;
}
const walkable = (v: number): boolean => v >= 1 && v <= 14;
const same = (a: Grid, b: Grid): boolean => planes(a).equals(planes(b));

/** The edits of a removal file holding these rows (and a water file's text, where one is given). */
function withRows(rows: Record<string, unknown>[], water: string | null = null): { world: string; texts: typeof PLAIN_TEXTS & { water: string | null }; removed: string } {
  return { world: WORLD, texts: { ...PLAIN_TEXTS, water }, removed: removalsFileText(WORLD, 'raw', rows) };
}

if (!existsSync(join(DIR, 'nav.json')) || !existsSync(join(DIR, 'layout.json'))) {
  note(`${WORLD} is not converted: the bake over a removal file is not checked here`);
} else {
  const layout = JSON.parse(readFileSync(join(DIR, 'layout.json'), 'utf8')) as Layout;
  const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as { categories: Record<string, { id: string; bounds?: { min: number[]; max: number[] }; cells?: unknown[] }[]> };
  const defs = new Map<string, { id: string; bounds?: { min: number[]; max: number[] }; cells?: unknown[] }>();
  for (const list of Object.values(manifest.categories)) for (const e of list) defs.set(e.id, e);
  const index = new ObjectKeyIndex(layout.objects);
  const bake = (edits: unknown, opts: { layout?: Layout; walkThrough?: Set<string> } = {}): Promise<Grid> => buildNavGrid(DIR, { walkThrough: opts.walkThrough ?? NO_WT, edits, ...(opts.layout ? { layout: opts.layout } : {}) }) as Promise<Grid>;
  const plain = await bake(PLAIN);
  const { nx, nz, cell, x0, z0 } = plain.header as { nx: number; nz: number; cell: number; x0: number; z0: number };
  const cx = layout.center.x;
  const cz = layout.center.z;

  // The building: the first portal building out in the open whose rooms the plain bake marks indoor.
  const isBuilding = (o: LayoutObject): boolean => !o.contained && (defs.get(o.model)?.cells?.length ?? 0) > 1;
  /** A layout object's turned footprint (its box, three's own turn), grown by `pad`, as a test of a cell's middle. */
  const footprint = (o: LayoutObject, pad: number): ((k: number) => boolean) => {
    const b = defs.get(o.model)!.bounds!;
    const lo = [Math.min(b.min[0], b.max[0]) - pad, Math.min(b.min[2], b.max[2]) - pad];
    const hi = [Math.max(b.min[0], b.max[0]) + pad, Math.max(b.min[2], b.max[2]) + pad];
    // The layout's raw frame into the game's (`placementFrame`): x mirrored about the centre, the turn mirrored with it.
    const q = o.q ?? [1, 0, 0, 0];
    const quat = new THREE.Quaternion(q[1], -q[2], -q[3], q[0]);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(cx - o.x, o.y, o.z - cz), quat, new THREE.Vector3(1, 1, 1));
    const inv = m.clone().invert();
    const v = new THREE.Vector3();
    return (k) => {
      const i = k % nx;
      const j = Math.floor(k / nx);
      v.set(x0 + (i + 0.5) * cell, o.y, z0 + (j + 0.5) * cell).applyMatrix4(inv);
      return v.x >= lo[0] && v.x <= hi[0] && v.z >= lo[1] && v.z <= hi[1];
    };
  };
  const bi = layout.objects.findIndex((o) => {
    if (!isBuilding(o)) return false;
    const inside = footprint(o, 0);
    for (let k = 0; k < nx * nz; k++) if (inside(k) && nibbleOf(plain.nibbles, k) === 15) return true;
    return false;
  });
  ok(bi >= 0, `${WORLD} stands a portal building whose rooms the plain bake marks indoor (#${bi}, ${layout.objects[bi]?.template})`);
  const B = layout.objects[bi];
  const key = index.keyOf(bi);
  ok(/^o:object\//.test(key) && index.find(key) === bi, `its content key finds it again (${key})`);
  const leftOut = (drop: readonly number[]): Layout => ({ ...layout, objects: layout.objects.filter((_o, i) => !drop.includes(i)) });

  // ---- day one ------------------------------------------------------------------------------------------------------
  const OLD = 'cfa55f3';
  const texts = oldTexts(['tools/swg/navgrid.mjs', 'tools/swg/finalnames.mjs'], OLD);
  if (!texts) note(`git could not hand over ${OLD}'s bake: the day-one comparison is not made here`);
  else {
    const tmp = mkdtempSync(join(tmpdir(), 'mm2-w12-old-'));
    try {
      for (const f of ['tools/swg/navgrid.mjs', 'tools/swg/finalnames.mjs']) {
        const from = resolve(REPO, f, '..');
        const point = (p: string): string => pathToFileURL(resolve(from, p)).href;
        const text = texts
          .get(f)!
          .replace(/from '(\.\.?\/[^']+)'/g, (_m, p: string) => `from '${point(p)}'`)
          .replace(/import\('(\.\.?\/[^']+)'\)/g, (_m, p: string) => `import('${point(p)}')`)
          .replace(/import\.meta\.url/g, `'${pathToFileURL(resolve(REPO, f)).href}'`);
        writeFileSync(join(tmp, f.split('/').pop()!), text);
      }
      const oldNav = (await import(pathToFileURL(join(tmp, 'navgrid.mjs')).href)) as { buildNavGrid: (d: string, o: unknown) => Promise<Grid> };
      const oldFin = (await import(pathToFileURL(join(tmp, 'finalnames.mjs')).href)) as { layoutKeyOf: (d: string, w: unknown, e: unknown) => string };
      const before = await oldNav.buildNavGrid(DIR, { walkThrough: NO_WT, edits: PLAIN });
      ok(same(before, plain), `${WORLD}: with no removal file the bake is ${OLD}'s to the byte (${planes(plain).length} bytes)`);
      ok(layoutKeyOf(DIR, NO_WT, PLAIN) === oldFin.layoutKeyOf(DIR, NO_WT, PLAIN), `and the key with no removal file is ${OLD}'s`);
      ok(JSON.stringify((before.header as { stats: unknown }).stats, (k, v) => (k === 'seconds' ? 0 : v)) === JSON.stringify((plain.header as { stats: unknown }).stats, (k, v) => (k === 'seconds' ? 0 : v)), "and its header's census says the same");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  {
    // A file of people, sites and zones alone moves no cell and no key.
    const others = withRows([
      { id: 'p:2b2c346e6abc' },
      { id: `s:${WORLD}:1:2` },
      { id: 'z:quiet', shape: { kind: 'circle', c: [B.x, B.z], r: 80 } },
    ]);
    ok(gridRemovalRows(others).length === 0 && removalGridWords(gridRemovalRows(others)) === '', 'a removal file of a person, a site and a zone holds no row the grid reads');
    ok(same(await bake(others), plain), 'and bakes the grid of no file, a zone round the building included');
    const header = (await bake(others)).header as { stats: Record<string, unknown> };
    ok(!('removed' in header.stats), 'whose header says nothing of it');
  }

  // ---- a hidden building ---------------------------------------------------------------------------------------------
  const hideB = withRows([{ id: key, hide: true }]);
  const hidden = await bake(hideB);
  const near = footprint(B, 2 * cell);
  let changed = 0;
  let outside = 0;
  const reopened: number[] = [];
  for (let k = 0; k < nx * nz; k++) {
    const a = nibbleOf(plain.nibbles, k);
    const b = nibbleOf(hidden.nibbles, k);
    if (!walkable(a) && walkable(b)) reopened.push(k);
    if ((a === 0 || a === 15) !== (b === 0 || b === 15)) {
      changed++;
      if (!near(k)) outside++;
    }
  }
  ok(reopened.length > 0, `hiding it reopens ${reopened.length} cells (its rooms and the shell round them)`);
  ok(outside === 0, `every cell whose walking changed lies in its turned footprint and the margin round it (${changed} changed)`);
  // Each reopened cell is joined to the open ground round it: its rank is the rank of a cell beside the reopened set that was
  // open before, and no reopened cell is a region of its own.
  const re = new Set(reopened);
  const borderRanks = new Set<number>();
  for (const k of reopened) {
    const i = k % nx;
    for (const d of [-1, 1, -nx, nx]) {
      const n2 = k + d;
      if (n2 < 0 || n2 >= nx * nz || re.has(n2) || (d === -1 && i === 0) || (d === 1 && i === nx - 1)) continue;
      if (walkable(nibbleOf(plain.nibbles, n2))) borderRanks.add(nibbleOf(hidden.nibbles, n2));
    }
  }
  const ownRanks = new Set(reopened.map((k) => nibbleOf(hidden.nibbles, k)));
  ok([...ownRanks].every((r) => borderRanks.has(r)), `the reopened cells take the rank of the open ground beside them (${[...ownRanks].join(', ')} of ${[...borderRanks].join(', ')})`);
  ok(reopened.every((k) => nibbleOf(plain.nibbles, k) === 15 || nibbleOf(plain.nibbles, k) === 0), 'each was indoor or blocked before');
  const leftB = await bake(PLAIN, { layout: leftOut([bi]) });
  ok(same(hidden, leftB), 'the grid baked with it hidden is the grid baked with it left out of the layout, every plane to the byte');
  const stats = (hidden.header as { stats: { removed?: { hidden: number; through: number; solid: number; layersDropped: number; missing: number } } }).stats;
  ok(stats.removed?.hidden === 1 && stats.removed.missing === 0, `and its header says what the file did (${JSON.stringify(stats.removed)})`);
  // Its key moved by a hair: the row still finds it (`HIDE_TUNE.match`), and one a metre off finds nothing and hides nothing.
  const hair = withRows([{ id: objectKey(B.template, B.x + 0.01, B.y, B.z), hide: true }]);
  ok(same(await bake(hair), hidden), 'a key a centimetre off its place still finds it');
  const far = withRows([{ id: objectKey(B.template, B.x + 1, B.y, B.z), hide: true }]);
  const farGrid = await bake(far);
  ok(same(farGrid, plain) && (farGrid.header as { stats: { removed?: { missing: number } } }).stats.removed?.missing === 1, 'one a metre off finds nothing, hides nothing, and is counted as finding nothing');

  // ---- a cell another object still covers -------------------------------------------------------------------------------
  {
    const twinLayout: Layout = { ...layout, objects: [...layout.objects, { ...B }] };
    const twinIndex = new ObjectKeyIndex(twinLayout.objects);
    const first = twinIndex.keyOf(bi);
    const second = twinIndex.keyOf(twinLayout.objects.length - 1);
    ok(first === key && second === `${key}#2`, `two exact twins are keyed apart (${second})`);
    const both = await bake(PLAIN, { layout: twinLayout });
    ok(same(both, plain), 'the layout with a twin bakes as it did (the same cells covered twice)');
    ok(same(await bake(withRows([{ id: first, hide: true }]), { layout: twinLayout }), plain), 'hiding the first leaves every cell the second covers blocked: the grid is as it was');
    ok(same(await bake(withRows([{ id: second, hide: true }]), { layout: twinLayout }), plain), 'and hiding the second alone, the same');
    ok(same(await bake(withRows([{ id: first, hide: true }, { id: second, hide: true }]), { layout: twinLayout }), leftB), 'hiding both is the grid with the building left out');
  }

  // ---- a deep one stays blocked ---------------------------------------------------------------------------------------------
  {
    // A lake of ours over the building's half on the raw -x side of its middle, 3 m over the highest ground there.
    const b = defs.get(B.model)!.bounds!;
    const r = Math.max(Math.abs(b.min[0]), Math.abs(b.max[0]), Math.abs(b.min[2]), Math.abs(b.max[2])) + 6;
    const lake = { id: 'deep', kind: 'lake', h: B.y + Math.abs(b.max[1] - b.min[1]) + 3, points: [[B.x - r, B.z - r], [B.x, B.z - r], [B.x, B.z + r], [B.x - r, B.z + r]] as [number, number][], shader: null };
    const water = waterFileText(WORLD, [lake] as never[]);
    const wet = await bake({ world: WORLD, texts: { ...PLAIN_TEXTS, water } });
    const wetHidden = await bake(withRows([{ id: key, hide: true }], water));
    let underWater = 0;
    let wetOpened = 0;
    let dryReopened = 0;
    for (const k of reopened) {
      const i = k % nx;
      const gx = x0 + (i + 0.5) * cell;
      const rawX = cx - gx;
      const lakeSide = rawX < B.x - cell * 2;
      const drySide = rawX > B.x + cell * 2;
      if (lakeSide) {
        underWater++;
        if (walkable(nibbleOf(wetHidden.nibbles, k))) wetOpened++;
      }
      if (drySide && walkable(nibbleOf(wetHidden.nibbles, k))) dryReopened++;
    }
    ok(underWater > 0 && wetOpened === 0, `under a deep lake of ours the ${underWater} cells of its half that hiding reopened stay blocked`);
    ok(dryReopened > 0, `while ${dryReopened} of the dry half's reopen`);
    ok((wetHidden.flags as Uint8Array).some((f, k) => (f & NAV_FLAGS.water) !== 0 && footprint(B, 0)(k)), 'blocked by the water, as the grid says why');
    ok(!same(wet, plain), 'and the lake alone moves the grid too (the test is not of nothing)');
  }

  // ---- an unhide, and the switches ------------------------------------------------------------------------------------------
  ok(same(await bake(withRows([])), plain), 'the file with the row taken out (an unhide) is the grid with it standing again');
  ok(same(await bake(withRows([{ id: key, solid: true }])), plain), 'a row that only says it is solid is the grid with it standing');
  ok(same(await bake(withRows([{ id: key, solid: false }])), hidden), 'a row that says it is walked through is the grid with it hidden');
  {
    // A template with two copies out in the open, not a building (a tower guard's tower, a tree: whatever stands twice).
    const counts = new Map<string, number[]>();
    layout.objects.forEach((o, i) => {
      if (o.contained || isBuilding(o) || !defs.get(o.model)?.bounds) return;
      const l = counts.get(o.template) ?? [];
      l.push(i);
      counts.set(o.template, l);
    });
    const twoBy = [...counts].find(([, l]) => l.length === 2);
    if (!twoBy) note(`${WORLD} places no template exactly twice out in the open: the template switches are not checked`);
    else {
      const [T, [a, b2]] = twoBy;
      const leftBoth = await bake(PLAIN, { layout: leftOut([a, b2]) });
      const through = await bake(withRows([{ id: `t:${T}`, solid: false }]));
      ok(same(through, leftBoth), `a template walked through here (${T}) is the grid with both its copies left out`);
      ok(same(await bake(withRows([{ id: `t:${T}`, solid: false }, { id: index.keyOf(a), solid: true }])), await bake(PLAIN, { layout: leftOut([b2]) })), "a thing made solid over its template's row stands, and its twin of the template is walked through");
      const wtT = new Set([T]);
      ok(same(await bake(PLAIN, { walkThrough: wtT }), leftBoth), 'the shared file walking it through everywhere leaves both out, as the template row does');
      ok(same(await bake(withRows([{ id: `t:${T}`, solid: true }]), { walkThrough: wtT }), plain), "a template made solid here stands over the shared file's walk-through");
      ok(same(await bake(withRows([{ id: index.keyOf(a), solid: true }]), { walkThrough: wtT }), await bake(PLAIN, { layout: leftOut([b2]) })), "and one thing made solid stands over it, its twin still walked through");
    }
  }

  // ---- the ground a hidden building takes ---------------------------------------------------------------------------------
  {
    const lay = '../tatooine/terrain/poi_large.lay';
    if (!existsSync(join(DIR, lay))) note('tatooine is not converted with its building terrain layers: the ground a hide drops is not checked here');
    else {
      const layered: Layout = { ...layout, objects: layout.objects.map((o, i) => (i === bi ? { ...o, layer: lay } : o)) };
      const withLayer = await bake(PLAIN, { layout: layered });
      const dropped = await bake(withRows([{ id: key, hide: true, ground: 'drop' }]), { layout: layered });
      const kept = await bake(withRows([{ id: key, hide: true }]), { layout: layered });
      ok(same(dropped, leftB), "a building hidden with `ground: 'drop'` takes its terrain layer with it: the grid with neither building nor layer");
      ok((dropped.header as { stats: { removed?: { layersDropped: number } } }).stats.removed?.layersDropped === 1, 'and its header counts the layer dropped');
      if (same(withLayer, plain) || same(kept, dropped)) note("the borrowed layer moves no cell of this world: the hide that keeps its ground is not told apart here");
      else ok(same(kept, await bake(PLAIN, { layout: { ...layered, objects: layered.objects.map((o, i) => (i === bi ? { ...o, model: '__none__', template: '__none__' } : o)) } })), 'a hide alone keeps the ground its layer flattened (the grid of the layer with no building on it)');
    }
  }

  // ---- the key ------------------------------------------------------------------------------------------------------------
  {
    const folder = mkdtempSync(join(tmpdir(), 'mm2-w12-key-'));
    try {
      mkdirSync(join(folder, 'removed'));
      const file = join(folder, 'removed', `${WORLD}.json`);
      const plainKey = layoutKeyOf(DIR, NO_WT, gridEditsOf(WORLD, folder, null));
      ok(plainKey === layoutKeyOf(DIR, NO_WT, PLAIN), 'a folder with no removal file keys as no edit files do');
      writeFileSync(file, removalsFileText(WORLD, 'raw', [{ id: 'p:2b2c346e6abc' }, { id: 'z:quiet', shape: { kind: 'circle', c: [0, 0], r: 50 } }]));
      const people = gridEditsOf(WORLD, folder, null) as { removedGrid?: string };
      ok(people.removedGrid === undefined && layoutKeyOf(DIR, NO_WT, people) === plainKey, 'a file of a person and a zone keys as no file (no grid follows them)');
      ok(gridLayoutStale({ layoutKey: plainKey }, DIR, null, NO_WT, people) === null && gridLayoutStale({}, DIR, null, NO_WT, people) === null, 'and asks for no grid again');
      writeFileSync(file, removalsFileText(WORLD, 'raw', [{ id: key, hide: true, at: 1 }]));
      const hiding = gridEditsOf(WORLD, folder, null) as { removedGrid?: string };
      const k1 = layoutKeyOf(DIR, NO_WT, hiding);
      ok(typeof hiding.removedGrid === 'string' && k1 !== plainKey, 'a hide folds into the key');
      writeFileSync(file, removalsFileText(WORLD, 'raw', [{ id: key, hide: true, at: 2, note: 'moved words' }]).replace(/\n/g, '\r\n'));
      ok(layoutKeyOf(DIR, NO_WT, gridEditsOf(WORLD, folder, null)) === k1, "its time, its note and its line endings do not");
      writeFileSync(file, removalsFileText(WORLD, 'raw', [{ id: key, hide: true, ground: 'drop' }]));
      ok(layoutKeyOf(DIR, NO_WT, gridEditsOf(WORLD, folder, null)) !== k1, 'the ground dropped with it does');
      writeFileSync(file, removalsFileText(WORLD, 'raw', [{ id: key, solid: false }]));
      ok(layoutKeyOf(DIR, NO_WT, gridEditsOf(WORLD, folder, null)) !== k1, 'and so does a walk-through switch in its place');
      writeFileSync(file, removalsFileText(WORLD, 'raw', [{ id: key, hide: true }]));
      ok(gridLayoutStale({ layoutKey: plainKey }, DIR, null, NO_WT, gridEditsOf(WORLD, folder, null)) !== null, 'a grid baked before the hide is stale');
      ok(gridLayoutStale({ layoutKey: k1 }, DIR, null, NO_WT, gridEditsOf(WORLD, folder, null)) === null, 'and one baked over it is not');
      ok(/removal file/.test(gridLayoutStale({}, DIR, null, NO_WT, gridEditsOf(WORLD, folder, null)) ?? ''), 'a grid with no key is stale once the world hides something, and says why');
      // What the bake never reads keys nothing, read over the pack's own layout as every real caller hands it (`packDir`): a
      // piece of a building's own furniture, a thing in a room, and a key that finds nothing here.
      const ci = layout.objects.findIndex((o) => !!o.contained);
      const indoor = ci >= 0 ? index.keyOf(ci) : null;
      // The key of no removal file, with the pack folder handed over (a folder holding no edit file at all).
      const plainWithPack = layoutKeyOf(DIR, NO_WT, gridEditsOf(WORLD, join(folder, 'none'), DIR));
      writeFileSync(file, removalsFileText(WORLD, 'raw', [{ id: `${key}/3`, hide: true }, { id: 'o:object/tangible/nowhere.iff@1,2,3', hide: true }, ...(indoor ? [{ id: indoor, hide: true, solid: false }] : [])]));
      const unread = gridEditsOf(WORLD, folder, DIR) as { removedGrid?: string };
      ok(unread.removedGrid === undefined && layoutKeyOf(DIR, NO_WT, unread) === plainWithPack, `a hide of a piece, of a thing in a room${indoor ? '' : ' (none in this layout)'} and of nothing at all keys as no file: no re-bake is asked for that cannot change the grid`);
      if (indoor) ok(same(await bake(withRows([{ id: indoor, hide: true }])), plain), 'and the bake of a thing in a room hidden is the grid of no file');
      writeFileSync(file, removalsFileText(WORLD, 'raw', [{ id: key, hide: true }, { id: `${key}/3`, hide: true }]));
      const withPack = gridEditsOf(WORLD, folder, DIR) as { removedGrid?: string };
      ok(typeof withPack.removedGrid === 'string' && withPack.removedGrid.split('\n').length === 1 && withPack.removedGrid.startsWith(key), "while the building's own hide, read over the layout, folds in alone");
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }
}

{
  // The bake's hand-overs, as text: it reads the file `gridEditsOf` hands it, before the buildings' layers.
  const nav = readFileSync(join(REPO, 'tools/swg/navgrid.mjs'), 'utf8');
  ok(/readFileSync\(join\(folder, 'removed', `\$\{world\}\.json`\), 'utf8'\)/.test(nav), "gridEditsOf reads the world's removal file out of the placements folder this install ships");
  ok(/const removal = gridRemovals\(edits, layout\.objects, log\);[\s\S]{0,600}if \(removal\.groundDrop\.size && removal\.groundDrop\.has\(li\)\)/.test(nav), "the bake matches the rows over the layout's own objects before it lays the buildings' layers, and a dropped ground lays none");
  ok(/if \(removal\.hidden\.size && removal\.hidden\.has\(li\)\) \{/.test(nav) && /removal\.solid\.get\(li\) \?\? removal\.templates\.get\(o\.template\)/.test(nav), 'a hidden object stands nothing, and the thing over its template over the shared file decides what is walked through');
  const fin = readFileSync(join(REPO, 'tools/swg/finalnames.mjs'), 'utf8');
  ok(/edits\?\.removedGrid/.test(fin), "the grid's key and its staleness fold in the rows the bake reads");
  ok(!existsSync(join(REPO, 'src/world/nav/gridPatch.ts')), 'there is no run-time patch of the grid (the owner\'s answer to Q7)');
}

console.log(`\n${passed} checks passed`);
