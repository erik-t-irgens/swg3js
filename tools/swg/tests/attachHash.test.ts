// What hangs on a permanent row never stands its row again (Map-maker II's seventh wave, `attachHash` beside the stand's
// hash): the permanent layer over the real streamer (`streamHarness.ts`), a tree-like row folded into its tier with an
// effect hung on it, the effect then moved by a write landed by difference -- the holder asked to stand it anew alone, the
// streamer asked nothing, the row still the very folded object it was, drawn once and solid -- where a look changed on it
// stands the row again (on meshes of its own, its tier being loaded). A mark (a row with no model) is the holder's alone:
// the streamer never files one, and taking one out of its file asks the holder alone. A file read whole again with only
// attachments moved asks the holder alone too (`sync`); a row taken in hand lets what hangs on it go first, a mark asking
// the streamer nothing; and a story layer's mark guards nothing.
//
// Run: node tools/swg/tests/attachHash.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const { makeStreamer } = await import('./streamHarness.ts');
const { PermanentLayer, dressingStandOf } = await import('../../../src/world/permanent.ts');
const { placementKey, placementsFileText, readPlacementsFile } = await import('../../../src/story/placements.ts');
type PlacementRow = import('../../../src/story/placements.ts').PlacementRow;

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const h = await makeStreamer();
const calls: string[] = [];
const held = new Map<string, string>();
const layer = new PermanentLayer({
  stand(row, g, key) {
    calls.push(`stand ${key}`);
    const s = dressingStandOf(row, g, key, () => null, () => false);
    return s ? h.stream.standPermanent(s, h.s.pack) : null;
  },
  unstand(key) {
    calls.push(`unstand ${key}`);
    h.stream.unplaceMany([key]);
  },
  unstandMany(keys) {
    calls.push(`unstandMany ${keys.join(',')}`);
    h.stream.unplaceMany(keys);
  },
  packReady: () => true,
  generation: () => 1,
  attach(key, row) {
    calls.push(`attach ${key}`);
    held.set(key, JSON.stringify(row.attach));
  },
  detach(key) {
    calls.push(`detach ${key}`);
    held.delete(key);
  },
});
layer.enter('tatooine', { x: 0, z: 0 }, 'ground', 1);
const crate = (attach: unknown, mats?: unknown): PlacementRow =>
  ({ id: 'crate-1', kind: 'prop', pack: 'world', model: 'crate', x: -40, y: 0, z: 40, q: [1, 0, 0, 0], ...(mats ? { mats } : {}), ...(attach ? { attach } : {}) }) as PlacementRow;
const mark = (at: number): PlacementRow => ({ id: 'mark-1', kind: 'mark', x: -50, y: 2, z: 40, q: [1, 0, 0, 0], attach: [{ snd: 'sound/hum.snd', at: [0, at, 0] }] }) as PlacementRow;
const read = (rows: PlacementRow[]) => readPlacementsFile(placementsFileText('tatooine', 'raw', rows), 'tatooine', 'ground');

// ---- Stood, folded. ----
layer.setLayers(null, read([crate([{ fx: 'props:particles/fire.json', at: [0, 1, 0] }]), mark(1)]));
await h.settle({ x: 45, z: 40 }, 30);
const key = placementKey('crate-1');
const first = h.s.placedByKey.get(key);
ok(calls.join(';') === `stand ${key};attach ${key};attach ${placementKey('mark-1')}`, `the crate is stood and its effect hung; the mark is the holder's alone (${calls.join('; ')})`);
ok(!!first && !!h.s.foldOf.get(first) && !h.s.placedByKey.get(placementKey('mark-1')), 'the crate is folded into its tier, and no mark is filed in the streamer');
ok(h.meshesAt(40, 40) === 1 && h.rayDown(40, 40) !== null, 'drawn once and solid');

// ---- The effect moved: the holder alone. ----
calls.length = 0;
layer.landChanges([{ layer: 'world', put: [crate([{ fx: 'props:particles/fire.json', at: [0, 2, 0] }])], deleted: [] }]);
await h.settle({ x: 45, z: 40 }, 5);
ok(calls.join(';') === `detach ${key};attach ${key}`, `an effect moved asks the holder alone, the streamer nothing (${calls.join('; ')})`);
ok(h.s.placedByKey.get(key) === first && !!h.s.foldOf.get(first) && h.meshesAt(40, 40) === 1 && h.rayDown(40, 40) !== null, 'the row is the very folded object it was, drawn once and solid');
ok(held.get(key) === JSON.stringify([{ fx: 'props:particles/fire.json', at: [0, 2, 0] }]), 'and the holder holds it where it was moved');

// ---- The same row put again unchanged: nothing at all. ----
calls.length = 0;
layer.landChanges([{ layer: 'world', put: [crate([{ fx: 'props:particles/fire.json', at: [0, 2, 0] }])], deleted: [] }]);
ok(calls.length === 0, 'the row put again as it was asks nothing of anybody');

// ---- Its last attachment taken off: the holder lets it go, the row stands. ----
layer.landChanges([{ layer: 'world', put: [crate(null)], deleted: [] }]);
ok(calls.join(';') === `detach ${key}` && h.s.placedByKey.get(key) === first, 'its last attachment taken off lets the holder go of it, and the row stands on');
calls.length = 0;

// ---- A look changed: the row stood again. ----
layer.landChanges([{ layer: 'world', put: [crate(null, [{ of: '*', tint: '#ff0000' }])], deleted: [] }]);
await h.settle({ x: 45, z: 40 }, 10);
const second = h.s.placedByKey.get(key);
ok(calls.some((c) => c.startsWith('unstandMany') || c.startsWith('unstand ')) && calls.includes(`stand ${key}`), `a look changed stands the row again (${calls.join('; ')})`);
ok(second !== first && !!h.s.runtime.get(second) && h.meshesAt(40, 40) === 1, 'stood on meshes of its own, its tier being loaded, drawn once');

// ---- The mark moved, then taken out. ----
calls.length = 0;
layer.landChanges([{ layer: 'world', put: [mark(3)], deleted: [] }]);
ok(calls.join(';') === `detach ${placementKey('mark-1')};attach ${placementKey('mark-1')}`, `a mark's attachment moved: the holder alone (${calls.join('; ')})`);
calls.length = 0;
layer.landChanges([{ layer: 'world', put: [mark(3)], deleted: [] }]);
ok(calls.length === 0, 'unchanged, nothing');
layer.landChanges([{ layer: 'world', put: [], deleted: ['mark-1'] }]);
ok(calls.join(';') === `detach ${placementKey('mark-1')}`, `a mark taken out asks the holder alone, never the streamer (${calls.join('; ')})`);
calls.length = 0;
layer.landChanges([{ layer: 'world', put: [mark(4)], deleted: [] }]);
ok(calls.join(';') === `attach ${placementKey('mark-1')}`, 'and put back, the holder stands it with nothing filed');

// ---- A file read whole again (the dev server's word) with only attachments moved: the holder alone (`sync`). ----
calls.length = 0;
const looked = h.s.placedByKey.get(key);
layer.setLayers(null, read([crate([{ fx: 'props:particles/fire.json', at: [0, 3, 0] }], [{ of: '*', tint: '#ff0000' }]), mark(5)]));
const mk = placementKey('mark-1');
ok([...calls].sort().join(';') === [`attach ${key}`, `attach ${mk}`, `detach ${mk}`].sort().join(';') && calls.indexOf(`detach ${mk}`) < calls.indexOf(`attach ${mk}`), `a whole read with only attachments moved hangs the crate's new one and stands the mark's again, the holder alone (${calls.join('; ')})`);
ok(!calls.some((c) => c.startsWith('stand ') || c.startsWith('unstand')) && h.s.placedByKey.get(key) === looked, 'and asks the streamer nothing: the row stands on as it stood');

// ---- Taken in hand: what hangs on it goes with it; a mark has nothing filed to take down. ----
calls.length = 0;
layer.lift(key);
ok(calls.join(';') === `detach ${key};unstand ${key}`, `a row taken in hand lets its attachments go first, then its stand (${calls.join('; ')})`);
calls.length = 0;
layer.lift(mk);
ok(calls.join(';') === `detach ${mk}`, `and a mark taken in hand asks the holder alone, never the streamer (${calls.join('; ')})`);

// ---- A mark guards nothing: a story layer's smoke or sound refuses no prop put down beside it. ----
{
  const l2 = new PermanentLayer({ stand: () => ({ bounds: { min: [-1, 0, -1], max: [1, 2, 1] } }), unstand: () => {}, packReady: () => true, generation: () => 1 });
  l2.enter('tatooine', { x: 0, z: 0 }, 'ground', 1);
  const storyRead = read([{ ...mark(1), id: 'story-mark' }, { id: 'story-crate', kind: 'prop', pack: 'world', model: 'crate', x: -200, y: 0, z: 40, q: [1, 0, 0, 0] } as PlacementRow]);
  l2.setLayers(storyRead, null);
  ok(l2.guardedAt(50, 40, 0.5) === null && l2.guardedAt(200, 40, 0.5)?.row.id === 'story-crate', "a story layer's mark guards nothing, where a story layer's crate guards its spot");
}

// ---- Day one: with no look, no attachment and no mark, the layer asks the world what a70487c's asked. ----
{
  const { loadOld } = await import('./oldModules.ts');
  const PRE_WAVE = 'a70487c';
  type Mod = { PermanentLayer: typeof PermanentLayer };
  const old = await loadOld<Mod>(['src/world/permanent.ts', 'src/story/placements.ts'], 'src/world/permanent.ts', PRE_WAVE);
  {
    let seed = 0x7a11;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed / 4294967296;
    };
    const run = (Layer: typeof PermanentLayer) => {
      seed = 0x7a11;
      const log: string[] = [];
      const l = new Layer({
        stand: (row, g, k) => {
          log.push(`stand ${k} ${g.x.toFixed(3)} ${g.z.toFixed(3)}`);
          return row.model === 'missing' ? null : { bounds: { min: [-1, 0, -1], max: [1, 2, 1] } };
        },
        unstand: (k) => log.push(`unstand ${k}`),
        unstandMany: (ks) => log.push(`unstandMany ${ks.join(',')}`),
        packReady: (pack) => pack !== 'gallery',
        generation: () => 1,
        label: (row) => row.name ?? row.id,
      });
      l.enter('tatooine', { x: 10.5, z: -3.25 }, 'ground', 1);
      const rows: PlacementRow[] = [];
      for (let i = 0; i < 40; i++) rows.push({ id: `r-${i}`, kind: rand() < 0.2 ? 'building' : 'prop', pack: rand() < 0.15 ? 'gallery' : 'world', model: rand() < 0.05 ? 'missing' : 'crate', x: Math.round(rand() * 200), y: 0, z: Math.round(rand() * 200), q: [1, 0, 0, 0], ...(rand() < 0.3 ? { scale: 2 } : {}), ...(rand() < 0.2 ? { name: `TEST ${i}` } : {}) } as PlacementRow);
      l.setLayers(null, read(rows));
      for (let step = 0; step < 60; step++) {
        const put: PlacementRow[] = [];
        const deleted: string[] = [];
        for (let k = 0; k < 4; k++) {
          const i = Math.floor(rand() * 50);
          if (rand() < 0.3) deleted.push(`r-${i}`);
          else put.push({ id: `r-${i}`, kind: 'prop', pack: 'world', model: 'crate', x: Math.round(rand() * 200), y: rand() < 0.5 ? 0 : 1, z: Math.round(rand() * 200), q: [1, 0, 0, 0], ...(rand() < 0.3 ? { name: `TEST ${step}` } : {}) } as PlacementRow);
        }
        const ids = new Set(put.map((p) => p.id));
        l.landChanges([{ layer: 'world', put, deleted: deleted.filter((d) => !ids.has(d)) }]);
      }
      return { log, report: JSON.stringify(l.report()) };
    };
    const now = run(PermanentLayer);
    const hash = (r: { log: string[]; report: string }) => createHash('sha1').update(`${r.log.join('\n')}\n${r.report}`).digest('hex').slice(0, 16);
    // a70487c's layer's calls and report over these very writes, hashed: what today's is held to where git cannot hand
    // that layer over, so the day one never passes on nothing.
    const PRE_WAVE_TRACE = '9857021001978db7';
    if (old) {
      const then = run(old.PermanentLayer);
      ok(now.log.length > 100 && now.log.join('\n') === then.log.join('\n'), `with no look, attachment or mark, every call into the world over 60 landed writes is ${PRE_WAVE}'s, in order (${now.log.length} calls)`);
      ok(now.report === then.report, 'and the layer reports what it reported');
      ok(hash(then) === PRE_WAVE_TRACE, `and that layer's trace is the one recorded here for a machine where git cannot hand it over (${hash(then)})`);
    } else ok(hash(now) === PRE_WAVE_TRACE, `git cannot hand ${PRE_WAVE} over: with no look, attachment or mark, every call into the world over 60 landed writes is the trace recorded from it (${hash(now)})`);
  }
}

console.log(`\nattachHash: ${checks} checks passed`);
