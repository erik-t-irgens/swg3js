// The scatter brush keeps off roads and rivers (Map-maker II's fourth wave, DESIGN.md §2.6), by the generator's own road
// byte (`roadByte.test.ts` holds that byte to the clearing): `BRUSH_TUNE.keepOffRoads`, on.
//   - Day one: over every way a road cannot refuse a candidate -- no road asked for, a road that answers no or "not
//     cached", or the switch off over a road everywhere -- a stamp is 0a86da7's (the third wave's `brush.ts`, out of git)
//     plant for plant by `Object.is`, over many seeds, discs, filters and grounds.
//   - With the switch on, no plant of a stamp stands where the road answers yes, the brush still fills the disc off the
//     road, and where no road reaches the disc the stamp is the old one's to the bit.
//   - Through the real glue (`EditorBrush` round the real editing class): a stroke across a road writes no row on it, and
//     the game hands the brush the world's own road (`roadIfCached`, game frame, cached ground only).
// Every number here is a fixture's, never the owner's tune.
//
// Run: node tools/swg/tests/brushRoads.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeHarness, propRow } from './editsHarness.ts';
import { BRUSH_TUNE } from '../../../src/editor/editorTune.ts';
import { brushRandom, brushTarget, paintStamp, type BrushGround, type BrushTune } from '../../../src/editor/brush.ts';
import { EditorBrush, brushNearOf, type BrushHost, type BrushNearWorld } from '../../../src/editor/editorBrush.ts';
import { libraryView, type LibraryEntry } from '../../../src/editor/libraryModel.ts';
import { toGame, type PlacementRow } from '../../../src/story/placements.ts';
import { loadOld, REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

const W3 = '0a86da7';
const old = await loadOld<{ paintStamp: typeof paintStamp }>(['src/editor/brush.ts'], 'src/editor/brush.ts', W3);
if (!old) note(`git cannot hand ${W3} over here: the day-one comparison is skipped`);

function tune(over: Partial<BrushTune> = {}): BrushTune {
  return { radius: 8, density: 2, spacing: 1.5, rate: 8, randomYaw: true, scaleMin: 0.8, scaleMax: 1.2, align: false, alignMax: 10, slopeMin: 0, slopeMax: 30, heightOn: false, heightMin: -1000, heightMax: 10000, keepOffWater: true, keepOffStanding: true, keepOffRoads: true, eraseShare: 1, tries: 8, ...over };
}
const entries = [
  { key: 'props:tree', weight: 1, water: false },
  { key: 'props:reed', weight: 0.5, water: true },
];
/** Rolling ground with a pond and a rock: every filter has something to refuse. */
const rolling = (road?: (x: number, z: number) => boolean | null): BrushGround => ({
  ground: (x, z) => Math.sin(x * 0.11) * 2 + Math.cos(z * 0.07) * 3,
  water: (x, z) => (x * x + (z - 6) ** 2 < 9 ? 5 : Number.NaN),
  blocked: (x, z) => (x - 4) ** 2 + (z + 3) ** 2 < 2,
  ...(road ? { road } : {}),
});
const samePlants = (a: ReturnType<typeof paintStamp>, b: ReturnType<typeof paintStamp>): boolean =>
  a.length === b.length && a.every((p, i) => (['entry', 'x', 'y', 'z', 'yaw', 'scale', 'nx', 'ny', 'nz'] as const).every((k) => Object.is(p[k], b[i][k])));
/** A road along x across the disc: |z - 1| under 2.5 m. */
const strip = (_x: number, z: number) => Math.abs(z - 1) < 2.5;

{
  // Day one: every way a road cannot refuse a candidate is the old brush to the bit.
  const ways: [string, BrushTune, BrushGround][] = [];
  if (old) {
    let held = 0;
    let plants = 0;
    let failed = '';
    for (let s = 0; s < 400; s++) {
      const r = 4 + (s % 9) * 1.5;
      const over: Partial<BrushTune> = { radius: r, density: 1 + (s % 5), spacing: 0.5 + (s % 4) * 0.5, slopeMax: 20 + (s % 3) * 15, heightOn: s % 7 === 0, heightMin: -2, heightMax: 3, keepOffWater: s % 2 === 0, keepOffStanding: s % 3 !== 0, randomYaw: s % 4 !== 0, tries: 2 + (s % 6) };
      ways.length = 0;
      ways.push(['no road asked', tune(over), rolling()]);
      ways.push(['a road that answers no', tune(over), rolling(() => false)]);
      ways.push(['a road not cached', tune(over), rolling(() => null)]);
      ways.push(['the switch off over a road everywhere', tune({ ...over, keepOffRoads: false }), rolling(() => true)]);
      const cx = (s % 11) - 5;
      const cz = (s % 13) - 6;
      const near = s % 2 ? [{ x: cx + 1, z: cz, mine: true }, { x: cx - 2, z: cz + 3, mine: false }] : [];
      const want = old.paintStamp(tune(over) as never, cx, cz, entries, near, rolling(), brushRandom(1000 + s), 0.7);
      for (const [name, t, g] of ways) {
        const got = paintStamp(t, cx, cz, entries, near, g, brushRandom(1000 + s), 0.7);
        if (!samePlants(got, want)) failed ||= `seed ${s}, ${name}`;
        held++;
      }
      plants += want.length;
    }
    ok(!failed && plants > 0, `${held} stamps (400 seeds, each four ways a road cannot refuse: none asked, one answering no, one not cached, the switch off over a road everywhere) are ${W3}'s plant for plant by Object.is, ${plants} plants a way${failed ? ` (first apart: ${failed})` : ''}`);
  }
}

{
  // On: nothing on the road, the disc still filled off it, and a disc no road reaches is the old stamp to the bit.
  let onRoad = 0;
  let planted = 0;
  let stamps = 0;
  let full = 0;
  let apart = '';
  for (let s = 0; s < 300; s++) {
    const t = tune({ radius: 10, density: 3, spacing: 1, tries: 12 });
    const got = paintStamp(t, 0, 0, entries.slice(0, 1), [], rolling(strip), brushRandom(5000 + s), 0);
    stamps++;
    planted += got.length;
    for (const p of got) if (strip(p.x, p.z)) onRoad++;
    if (got.length === brushTarget(t)) full++;
    // The same stamp 100 m off the road: no candidate asks a yes, so the stamp is the one with no road at all.
    if (old) {
      const far = paintStamp(t, 0, 100, entries.slice(0, 1), [], rolling(strip), brushRandom(5000 + s), 0);
      const want = old.paintStamp(t as never, 0, 100, entries.slice(0, 1), [], rolling(), brushRandom(5000 + s), 0);
      if (!samePlants(far, want)) apart ||= `seed ${s}`;
    }
  }
  ok(onRoad === 0 && planted > 0, `over ${stamps} stamps across a road 5 m wide through the middle of the disc, ${planted} plants and not one on the road`);
  ok(full > stamps * 0.9, `and the brush still fills the disc off the road (${full} of ${stamps} stamps reached the target of ${brushTarget(tune({ radius: 10, density: 3 }))})`);
  if (old) ok(!apart, `a disc no road reaches paints exactly what ${W3}'s brush paints, with the switch on${apart ? ` (first apart: ${apart})` : ''}`);
  // The switch off: the road is painted over as before.
  let offRoad = 0;
  for (let s = 0; s < 60; s++) for (const p of paintStamp(tune({ radius: 10, density: 3, spacing: 1, tries: 12, keepOffRoads: false }), 0, 0, entries.slice(0, 1), [], rolling(strip), brushRandom(7000 + s), 0)) if (strip(p.x, p.z)) offRoad++;
  ok(offRoad > 0, `with the switch off the brush paints over the road as before (${offRoad} plants on it over 60 stamps)`);
  ok(BRUSH_TUNE.keepOffRoads === true, "the switch is on by default (BRUSH_TUNE.keepOffRoads)");
}

{
  // Through the real glue: a stroke across a road writes no row on it.
  const propEntry = (id: string): LibraryEntry => ({ s: 'props', p: 'props', id, m: '', n: null, g: '', t: null, sz: [0, 0, 0], tri: 0, pic: null, f: 0 });
  const VIEW = libraryView([propEntry('chair')]);
  const h = makeHarness({ rows: [propRow('keep', 40, 40)] });
  const world = (): BrushNearWorld<never> => ({ view: VIEW, here: 'tatooine', rows: h.host.standing(), placedOfRow: () => null, forEachPlacedIn: () => {}, boxOf: () => null as never });
  // The road in the game's frame (the brush asks the world in the game's frame; the files hold the raw).
  let asked = 0;
  const host: BrushHost = {
    edits: h.e,
    source: async (key) => ({ key, id: 'chair', src: { kind: 'prop', pack: 'props', thing: 'chair', template: 'object/tangible/test/shared_chair.iff' } as never, bounds: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }, water: false }),
    near: (cx, cz, reach, keys) => brushNearOf(world(), cx, cz, reach, keys),
    ground: () => 0,
    water: () => Number.NaN,
    road: (x, z) => {
      asked++;
      return strip(x, z);
    },
    centre: () => ({ x: 0, z: 0 }),
    frame: () => 'raw',
    packId: () => 'tatooine',
    inSpace: () => false,
    dest: () => 'world',
    cameraYaw: () => 0,
    say: () => {},
  };
  const brush = new EditorBrush(host);
  const was = { ...BRUSH_TUNE };
  Object.assign(BRUSH_TUNE, tune({ radius: 10, density: 3, spacing: 1, tries: 12 }));
  try {
    brush.toggle('props:chair');
    await brush.arm(null);
    await brush.strokeAt(0, 0, 'paint', 2, 91);
    const rows = [...h.rowsOf('world').values()].filter((r) => r.id !== 'keep');
    const games = rows.map((r) => toGame(r as PlacementRow, { x: 0, z: 0 }, 'raw'));
    ok(rows.length > 0 && asked > 0 && games.every((g) => !strip(g.x, g.z)), `a stroke through the real editing class asked the world's road ${asked} times and wrote ${rows.length} rows, none on the road`);
  } finally {
    Object.assign(BRUSH_TUNE, was);
  }
}

{
  // The game hands the brush the world's own road: cached ground only, in the game's frame.
  const read = (f: string) => readFileSync(join(REPO, f), 'utf8').replace(/\r\n/g, '\n');
  ok(/road: \(x, z\) => w\.roadIfCached\(x, z\),/.test(read('src/editor/editorEntry.ts')) && /road: h\.road \? \(x, z\) => h\.road!\(x, z\) : undefined/.test(read('src/editor/editorBrush.ts')), "the editor's brush host asks the world's road (`roadIfCached`), and the brush's ground carries it");
  ok(/roadIfCached\(gx: number, gz: number\): boolean \| null \{\n\s*const swg = this\.terrain\?\.swg;\n\s*return swg \? swg\.roadIfCached\(gx, gz\) : false;/.test(read('src/world/world.ts')) && /roadIfCached\(gx: number, gz: number\): boolean \| null \{\n\s*return this\.sampler\.roadAt\(this\.toSwgX\(gx\), this\.toSwgZ\(gz\)\);/.test(read('src/world/swgTerrain.ts')), "which is the generator's byte read off the cached block under the point (none on a world with no generated ground)");
}

console.log(`\nbrushRoads: ${checks} checks passed`);
