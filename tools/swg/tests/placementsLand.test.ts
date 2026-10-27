// A write of the world editor's landed by difference (DESIGN.md §2.11): `PermanentLayer.landChanges`, handed what the
// endpoint's batch put and took out, stands and takes down exactly what a whole `setLayers` over the files as they then
// read does -- the same rows standing with the same rows, layers and words, the same skipped and why (a clash, a pack not
// in hand, a building in space, a row in hand), and the very same calls into the world -- over two hundred random batches
// through the endpoint's own rules on real file texts; and the page drops the dev server's word about a revision it has
// already landed, holding words that arrive while a write of its own is out (pinned as text in `main.ts`).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPlacementOp, type BatchEdit, type PlacementBatchOk } from '../../../src/world/placementEdits.ts';
import { PermanentLayer, type LayerChange } from '../../../src/world/permanent.ts';
import { placementKey, readPlacementsFile, type PlacementPack, type PlacementRow } from '../../../src/story/placements.ts';

const REPO = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// A seeded generator, so a failure is the same failure every run.
let seed = 0x5eed;
const rand = () => {
  seed = (seed * 1103515245 + 12345) >>> 0;
  return seed / 4294967296;
};
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];

function harness(worldKind: 'ground' | 'space') {
  const calls: string[] = [];
  let generation = 1;
  const layer = new PermanentLayer({
    stand(row, _g, key) {
      calls.push(`stand ${key}`);
      // A model not in its pack: one id stands for it.
      if (row.thing === 'missing' || row.model === 'missing') return null;
      return { bounds: { min: [-1, 0, -1], max: [1, 2, 1] } };
    },
    unstand(key) {
      calls.push(`unstand ${key}`);
    },
    unstandMany(keys) {
      calls.push(`unstandMany ${keys.join(',')}`);
    },
    packReady: (pack: PlacementPack) => pack !== 'world',
    generation: () => generation,
    label: (row) => row.name ?? row.id,
  });
  layer.enter('tatooine', { x: 10.5, z: -3.25 }, worldKind, 1);
  return { layer, calls, gone: () => generation++ };
}

/** What a layer stands and skips, in words, for comparing two. */
function picture(layer: PermanentLayer): string {
  const r = layer.report();
  const rows = r.rows.map((x) => `${x.key}|${x.layer}|${x.stood}|${x.why}|${x.label}|${x.stood ? JSON.stringify(layer.rowOf(x.key)?.row) : ''}`).sort();
  return JSON.stringify({ rows, story: r.layers.story.rows, world: r.layers.world.rows });
}

const IDS = Array.from({ length: 30 }, (_, i) => `r-${i}`);
function randomRow(id: string): Record<string, unknown> {
  const building = rand() < 0.2;
  const row: Record<string, unknown> = building
    ? { id, kind: 'building', pack: 'gallery', model: rand() < 0.1 ? 'missing' : pick(['house_a', 'house_b']) }
    : rand() < 0.15
      ? { id, kind: 'prop', pack: 'world', model: 'tree_a' }
      : { id, kind: 'prop', pack: 'props', thing: rand() < 0.05 ? 'missing' : pick(['chair', 'crate', 'lamp']) };
  row.x = Math.round(rand() * 200 - 100);
  row.y = Math.round(rand() * 10);
  row.z = Math.round(rand() * 200 - 100);
  row.q = [1, 0, 0, 0];
  if (rand() < 0.3) row.scale = pick([2, 0.5, [1, 2, 1]]);
  if (rand() < 0.2) row.name = `TEST: ${id}`;
  return row;
}

for (const worldKind of ['ground', 'space'] as const) {
  const world = worldKind === 'space' ? 'space_tatooine' : 'tatooine';
  const files: { story: string | null; world: string | null } = { story: null, world: null };
  const full = harness(worldKind);
  const diff = harness(worldKind);
  let clock = 1_800_000_000_000;
  let same = 0;
  let sameCalls = 0;
  let steps = 0;
  let lifts = 0;
  for (let step = 0; step < 200; step++) {
    // A batch of one to twelve edits across both files: puts, moves, deletes, and now and then a row of one file put
    // into the other where it stands (a clash the reader settles for the world edit).
    const edits: BatchEdit[] = [];
    const have = (l: 'story' | 'world') => new Set(files[l] ? readPlacementsFile(files[l]!, world, worldKind).rows.map((r) => r.id) : []);
    const inStory = have('story');
    const inWorld = have('world');
    const n = 1 + Math.floor(rand() * 12);
    const touched = new Set<string>();
    for (let i = 0; i < n; i++) {
      const id = pick(IDS);
      if (touched.has(id)) continue;
      touched.add(id);
      const where = inWorld.has(id) ? 'world' : inStory.has(id) ? 'story' : null;
      if (where && rand() < 0.3) {
        edits.push({ file: where, delete: id });
        (where === 'world' ? inWorld : inStory).delete(id);
      } else if (where && rand() < 0.2) {
        // Moved to the other file.
        const to = where === 'world' ? 'story' : 'world';
        edits.push({ file: where, delete: id });
        edits.push({ file: to, put: randomRow(id) });
      } else {
        const to = where ?? (rand() < 0.5 ? 'story' : 'world');
        edits.push({ file: to, put: randomRow(id) });
      }
    }
    if (!edits.length) continue;
    const a = applyPlacementOp({ op: 'batch', world, edits }, { ...files }, { worlds: new Map([[world, worldKind]]), now: (clock += 1000) });
    if (a.status !== 200) continue;
    for (const w of a.writes) files[w.layer] = w.text;
    const body = a.body as PlacementBatchOk;
    // Now and then a row is in the editor's hand while the batch lands, and the batch is what put it down.
    let landed: string[] = [];
    if (rand() < 0.15) {
      const pool = [...diff.layer.standing].map((s) => s.key);
      if (pool.length) {
        const key = pick(pool);
        full.layer.lift(key);
        diff.layer.lift(key);
        lifts++;
        if (rand() < 0.7) landed = [key];
      }
    }
    full.calls.length = 0;
    diff.calls.length = 0;
    const reads = { story: files.story ? readPlacementsFile(files.story, world, worldKind) : null, world: files.world ? readPlacementsFile(files.world, world, worldKind) : null };
    if (landed.length) full.layer.land(landed[0], reads.story, reads.world);
    else full.layer.setLayers(reads.story, reads.world);
    const changes: LayerChange[] = (['story', 'world'] as const).filter((l) => body.files[l]).map((l) => ({ layer: l, put: body.files[l]!.put, deleted: body.files[l]!.deleted }));
    diff.layer.landChanges(changes, landed);
    steps++;
    if (picture(full.layer) === picture(diff.layer)) same++;
    else console.log(`step ${step}: ${picture(full.layer)}\n     vs ${picture(diff.layer)}`);
    // A row whose model is not in its pack is never standing, so a whole read asks the world for it again every time and a
    // landing only when it changed: those asks (each answered nothing) are left out of the comparison.
    const noModel = new Set(diff.layer.report().rows.filter((x) => x.why === 'noModel').map((x) => x.key));
    const norm = (c: string[]) =>
      c
        .flatMap((x) => (x.startsWith('unstandMany ') ? x.slice(12).split(',').map((k) => `unstand ${k}`) : [x]))
        .filter((x) => !(x.startsWith('stand ') && noModel.has(x.slice(6))))
        .sort()
        .join(';');
    if (norm(full.calls) === norm(diff.calls)) sameCalls++;
    else console.log(`step ${step} calls: ${norm(full.calls)}\n           vs ${norm(diff.calls)}`);
    // The file each holds reads as the file on disk.
    for (const l of ['story', 'world'] as const) {
      const held = diff.layer.fileOf(l)?.rows.map((r) => JSON.stringify(r)).join('\n') ?? '';
      const disk = reads[l]?.rows.map((r) => JSON.stringify(r)).join('\n') ?? '';
      if (held !== disk) {
        same = -1e9;
        console.log(`step ${step}: the ${l} file landed by difference reads ${held.length} chars against the disk's ${disk.length}`);
      }
    }
  }
  ok(steps > 150 && same === steps, `${worldKind}: over ${steps} random batches through the endpoint, landing by difference stands exactly what a whole read of both files does (${lifts} with a row in hand)`);
  ok(sameCalls === steps, `${worldKind}: and makes exactly the same calls into the world, stand for stand and take-down for take-down`);
  ok([...diff.layer.standing].length > 5, `${worldKind}: with rows standing at the end (${[...diff.layer.standing].length})`);
  // A world gone takes everything with it, and a late landing does nothing.
  diff.gone();
  ok(diff.layer.landChanges([{ layer: 'world', put: [], deleted: [] }]).length === 0 && diff.layer.count === 0, `${worldKind}: a landing for a world that has gone does nothing`);
}

{
  // Landing touches only the ids that changed: a batch of one row on a file of 5,000 asks the world nothing about the rest.
  const h = harness('ground');
  const rows: PlacementRow[] = [];
  for (let i = 0; i < 5000; i++) rows.push({ id: `c-${i}`, kind: 'prop', pack: 'props', thing: 'chair', x: i % 100, y: 0, z: Math.floor(i / 100), q: [1, 0, 0, 0], at: 1 });
  h.layer.setLayers(null, { rows, skipped: [], unknown: [], problem: null });
  h.calls.length = 0;
  const t0 = performance.now();
  h.layer.landChanges([{ layer: 'world', put: [{ ...rows[17], x: 55.5 }], deleted: ['c-4000'] }]);
  const ms = performance.now() - t0;
  ok(h.calls.length === 2 && h.calls[0] === 'unstandMany place/c-4000,place/c-17' && h.layer.count === 4999 && h.layer.rowOf(placementKey('c-17'))?.row.x === 55.5, `one row moved and one taken out of 5,000 asks the world two things, one taking both down at once (${h.calls.join('; ')}) in ${ms.toFixed(1)} ms`);
}

{
  // The page drops the dev server's word about a revision it has landed and holds words while a write of its own is out.
  const src = fs.readFileSync(path.join(REPO, 'src', 'main.ts'), 'utf8').split(/\r?\n/).join('\n');
  const word = src.match(/private placementWord\(d: PlacementWord\): void \{[\s\S]*?\n {2}\}/)?.[0] ?? '';
  ok(/if \(this\.placementsInFlight > 0\) \{\s*this\.heldWords\.push\(d\);\s*return;\s*\}\s*if \(typeof d\.rev === 'string' && this\.placementRevs\.get\(`\$\{kind\}\/\$\{here\}`\) === d\.rev\) return;/.test(word), "main's placementWord holds a word while a write is out, then drops one naming a revision already landed");
  // Map-maker II's groundwork: routed by kind to the layer that reads it, a kind no layer reads yet dropped.
  ok(/const reload = this\.editLayerOf\(kind\);\s*if \(!reload\) return;/.test(word), "and drops a word for a kind of file no layer reads yet (the later waves')");
  const batch = src.match(/private async editorBatch\([\s\S]*?\n {2}\}/)?.[0] ?? '';
  ok(/const files = reply\.files;[\s\S]{0,200}for \(const k of kinds\) \{\s*const f = files\[k\];\s*if \(f\) this\.placementRevs\.set\(`\$\{k\}\/\$\{pack\}`, f\.rev\);\s*\}/.test(batch), "editorBatch records each file's revision the moment its answer comes, every kind it wrote, before anything is awaited");
  ok(/this\.permanent\.landChanges\(changes\)/.test(batch) && !/fetchPlacements|setLayers/.test(batch), 'and lands it by difference, reading no file whole');
  const post = src.match(/private async postPlacements\([\s\S]*?\n {2}\}/)?.[0] ?? '';
  ok(/this\.placementsInFlight\+\+;/.test(post) && /setTimeout\(\(\) => \{\s*this\.placementsInFlight--;\s*this\.releaseHeldWords\(\);\s*\}, 0\);/.test(post), 'a write counts as out until a moment after its answer, then the held words are heard');
  // An action written as several batches: the word about an earlier batch's revision comes after a later one has landed,
  // and is dropped as one of this page's own (each once), never read whole; a reload stands the revision of the text it
  // read, never the word's.
  ok(/=== d\.rev\) return;\s*\/\/[^\n]*\n\s*if \(typeof d\.rev === 'string' && this\.takeOwnRev\(`\$\{kind\}\/\$\{here\}`, d\.rev\)\) return;\s*reload\(here, d\.rev\);/.test(word), "a word naming a revision one of this page's own writes made is dropped, once, even after a later write has landed");
  ok(/for \(const k of kinds\) if \(files\[k\]\) this\.noteOwnRev\(`\$\{k\}\/\$\{pack\}`, files\[k\]!\.rev\);/.test(batch), "every revision a batch wrote, every kind, is noted as the page's own");
  ok(/for \(const \[l, rev\] of Object\.entries\(reply\.revs \?\? \{\}\)\) if \(typeof rev === 'string'\) this\.noteOwnRev\(`\$\{l\}\/\$\{pack\}`, rev\);/.test(src), 'and so is every revision a one-row write wrote');
  const reload = src.match(/private async reloadDressing\([\s\S]*?\n {2}\}/)?.[0] ?? '';
  ok(/const read = this\.readRevs\.get\(key\);\s*if \(read !== undefined\) this\.placementRevs\.set\(key, read\);/.test(reload) && /if \(import\.meta\.env\.DEV\) await this\.noteReadRev\(`\$\{layer\}\/\$\{pack\}`, text\);/.test(src), "a reload stands the revision of the text it read (its SHA-1, as the endpoint's), never the one the word named before the file moved on");
}

console.log(`\n${checks} checks passed`);
