// The clouds' stacks (pass 3, wave 1, maker M and the fixer): every world's starting stack (the Low, Middle and High decks of
// the design's 2.1 at their heights, real types, shares that move with the level, each world's line of why, a world of his own
// taking the decks of the world it borrows), shares by level, the clouds file's version-1 reader (only what he
// set, values clamped, a later version refused whole, nothing written), the console's edits of a layer (any type at any
// height, overlapping, mixes of up to three, more decks from the world's starts and blank layers added, removed, moved,
// nothing refused but the safety clamps), the regions' and the borrowed world's wiring, and the drift's
// kept steps (a clock walked back a step answers as before, with nothing summed again).
//
// Run: node tools/swg/tests/cloudStacks.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLOUD_CLAMP, CLOUD_LAYER_MAX, CLOUD_TYPES, CLOUD_TYPE_TUNE, cleanLayer, copyStack, sharesAtLevel, sharesWritten, type CloudLayer } from '../../../src/sky/clouds/cloudLayers.ts';
import { CLOUD_CLIMATES, CLOUD_DECKS, DECK_NAMES, blankLayer, climateKey, climateWorlds, cloudDeckFor, cloudStartFor } from '../../../src/sky/clouds/cloudClimate.ts';
import { CLOUDS_FILE_VERSION, readCloudsFile, stackFromFile } from '../../../src/sky/clouds/cloudsFile.ts';
import { editLayer, keepLine, type StackHost } from '../../../src/sky/clouds/cloudEdit.ts';
import { CloudDrift, KEPT_STEPS } from '../../../src/sky/clouds/cloudMap.ts';
import { climateFor, seedOf, STEP_SECONDS } from '../../../src/world/weatherSchedule.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---------------------------------------------------------------------------------------------- the starting stacks

{
  const worlds = climateWorlds();
  for (const w of ['tatooine', 'naboo', 'corellia', 'talus', 'dantooine', 'lok', 'endor', 'yavin4', 'dathomir', 'rori', 'kashyyyk', 'mustafar']) ok(worlds.includes(w), `${w} has a starting stack`);
  for (const w of [...worlds, 'nowhere']) {
    const s = cloudStartFor(w, w);
    // The owner's late word of 24 November: every world starts from 2.1's three decks, one layer each, named for its deck.
    ok(s.layers.map((l) => l.name).join() === 'Low deck,Middle deck,High deck', `${w}: the Low, Middle and High decks, one layer each`);
    const [lo, mi, hi] = s.layers;
    ok(lo.base >= 300 && lo.base <= 3000 && mi.base >= 3000 && mi.base <= 6000 && hi.base >= 7000 && hi.base <= 10000, `${w}: the decks at 2.1's heights (low ${lo.base} m, middle ${mi.base}, high ${hi.base})`);
    ok(lo.base + lo.thickness <= 10000 + 1, `${w}: the low deck's storm towers top out by 10 km over the ground`);
    ok(typeof s.why === 'string' && s.why.length > 40, `${w}: its line of why`);
    let real = true;
    for (const l of s.layers) {
      for (const t of l.types) if (!(CLOUD_TYPES as readonly string[]).includes(t)) real = false;
      if (l.cover.length !== 5 || l.cover.some((c) => !(c >= 0 && c <= 1))) real = false;
      if (l.levelShares && (l.levelShares.length !== l.types.length || l.levelShares.some((row) => row.length !== 5))) real = false;
      // A start is a whole layer already: cleaned again it is itself.
      assert.deepEqual(cleanLayer(l, l), l);
    }
    ok(real, `${w}: real types, five covers in 0 to 1, a row of five shares a type where they move with the level`);
    const low = (k: string): boolean => (CLOUD_TYPES as readonly string[]).indexOf(k) <= CLOUD_TYPES.indexOf('nimbostratus');
    ok(lo.types.every(low) && mi.types.every((t) => t === 'altocumulus' || t === 'altostratus') && hi.types.every((t) => t.startsWith('cirro') || t === 'cirrus'), `${w}: each deck holds its own genera (low, middle, high)`);
  }
  // Rain by the world's character: nimbostratus for the mild worlds, cumulonimbus for the plains and the jungle, growing with the level.
  const deck = (w: string, i = 0): CloudLayer => cloudStartFor(w, w).layers[i];
  const shareAt = (l: CloudLayer, t: string, lv: number): number => sharesAtLevel(l, lv, [])[l.types.indexOf(t as never)] / sharesAtLevel(l, lv, []).reduce((a, b) => a + b, 0);
  ok(deck('naboo').types.includes('nimbostratus') && deck('dantooine').types.includes('cumulonimbus') && deck('yavin4').types.includes('cumulonimbus'), "rain gives nimbostratus or cumulonimbus in the low deck by a world's character");
  ok(shareAt(deck('naboo'), 'nimbostratus', 0) === 0 && shareAt(deck('naboo'), 'nimbostratus', 4) > 0.8, "Naboo's rain deck takes no share on a fair day and most of the low deck in the storm");
  ok(shareAt(deck('dantooine'), 'cumulonimbus', 0) === 0 && shareAt(deck('dantooine'), 'cumulonimbus', 4) >= 0.5, "Dantooine's plains storms rise from its low deck as the level climbs");
  ok(deck('dathomir').types.includes('stratus'), "Dathomir's fog in every row gives a low stratus in its low deck");
  ok(deck('hoth').types.includes('nimbostratus') && deck('hoth').types.includes('stratus'), "Hoth's snow gives nimbostratus over its low stratus");
  const tat = cloudStartFor('tatooine', 'tatooine').layers;
  ok(tat[0].types.join() === 'cumulus' && tat[0].cover[0] < 0.2 && tat[0].base >= 2500, 'Tatooine: rare fair cumulus on a high base (dry)');
  ok(tat[0].cover[4] === 0 && tat[0].cover[3] === 0, "Tatooine's dust levels leave the low sky bare");
  ok(tat[1].cover.every((c) => c < 0.05), "Tatooine's middle deck stands there with little or no cover, his to adjust");
  ok(tat[2].types.includes('cirrus') && shareAt(tat[2], 'cirrostratus', 4) > shareAt(tat[2], 'cirrostratus', 0), "Tatooine's high thin cirrus gives way to a veil as the dust rises");
  ok(deck('rori').base < deck('naboo').base && deck('naboo').base < tat[0].base, "the low deck's base set by moisture: Rori's under Naboo's under Tatooine's");
  ok(deck('naboo').diurnal > 0, "Naboo's fair cumulus builds through the afternoon");
  // A type's own clouds stand its thickness of a deck (the shape's reach): the deck reaches its tallest type's top.
  ok(deck('naboo').thickness === CLOUD_TYPE_TUNE.nimbostratus.thickness && deck('tatooine').thickness === CLOUD_TYPE_TUNE.cumulus.thickness && deck('kashyyyk').thickness === CLOUD_TYPE_TUNE.towering.thickness, "a deck's thickness is its tallest type's");
  // The world found by its planet, its pack, then what it borrows; an unknown world the temperate default.
  ok(cloudStartFor('his_world', 'naboo').key === 'naboo', 'a copy of a world takes the stack of the pack it copies');
  ok(cloudStartFor('canyon', 'canyon', 'lok').key === 'lok' && cloudStartFor('seattle', 'seattle', 'dantooine').key === 'dantooine', "a world of his own takes the decks of the world whose ground rules or sky it borrows (Granyon Lok's, Rainier Dantooine's)");
  ok(cloudStartFor('canyon', 'canyon').key === null, 'with nothing borrowed it would be the temperate default');
  ok(climateKey('kashyyyk_main') === 'kashyyyk' && climateKey('kashyyyk_dead_forest') === 'kashyyyk', "Kashyyyk's packs take Kashyyyk's");
  ok(cloudStartFor('nowhere', 'nowhere').key === null && cloudStartFor('nowhere', null).layers.length === 3, 'an unknown world takes the temperate default');
  // The decks to add from: each at its world's real height and types.
  const d = cloudDeckFor('low', 'naboo', 'naboo');
  ok(d.name === 'Low deck' && d.base === deck('naboo').base && d.types.join() === deck('naboo').types.join(), "a deck to add is the world's own, at its real height and types");
  ok(blankLayer().cover.every((c) => c === 0), 'a blank layer has no cover at any level');
  ok(CLOUD_DECKS.join() === 'low,middle,high' && DECK_NAMES.high === 'High deck', 'the three decks and their names');
  // Fresh records each call.
  const a = cloudStartFor('naboo', 'naboo').layers;
  a[0].cover[0] = 0.99;
  a[0].levelShares![0][0] = 9;
  ok(cloudStartFor('naboo', 'naboo').layers[0].cover[0] !== 0.99 && cloudStartFor('naboo', 'naboo').layers[0].levelShares![0][0] !== 9, 'a start handed out is a copy (editing it moves no other world)');
  ok(Object.keys(CLOUD_CLIMATES).length === worlds.length, 'every climate is listed');
  // No number of SWG's clouds in the climates: the file names no sheet, no colour.
  const src = readFileSync(new URL('../../../src/sky/clouds/cloudClimate.ts', import.meta.url), 'utf8');
  ok(!/cloudtile|\.png|#[0-9a-f]{6}/i.test(src), 'the climates name no SWG sheet, picture or colour');
}

// ---------------------------------------------------------------------------------------------- shares by level

{
  // Written as `shares` with five numbers in place of one: read into rows, the record's `shares` each row's mean.
  const notes: string[] = [];
  const L = cleanLayer({ name: 'x', types: ['cumulus', 'nimbostratus'], shares: [1, [0, 0, 0.3, 0.7, 0.9]] }, null, notes);
  ok(L.levelShares!.length === 2 && L.levelShares![0].join() === '1,1,1,1,1' && L.levelShares![1].join() === '0,0,0.3,0.7,0.9', 'a share of five numbers makes a row a type; a plain number a row of it');
  ok(Math.abs(L.shares[1] - 0.38) < 1e-9 && sharesWritten(L)[0] === 1 && Array.isArray(sharesWritten(L)[1]), "the record's shares are the rows' means; written back, a constant row is one number again");
  ok(sharesAtLevel(L, 2.5, [])[1] === 0.5 && sharesAtLevel(L, 0, [])[1] === 0, 'a share at a level between two is eased, as the cover is');
  // Plain shares given again: the rows go.
  ok(cleanLayer({ ...L, shares: [1, 0.5], levelShares: null }, L).levelShares === null, 'plain shares hold at every level again');
  // A type taken out with its row; a type added with a plain share.
  const host: StackHost = { layers: [L], setLayers(list) { this.layers = copyStack(list); return []; } };
  editLayer(host, { index: 0, type2: 'cumulonimbus' });
  ok(host.layers[0].types.length === 3 && host.layers[0].levelShares![1].join() === '0,0,0.3,0.7,0.9' && host.layers[0].levelShares![2].join() === '1,1,1,1,1', 'a type added keeps the others\' rows and takes a share of one at every level');
  editLayer(host, { index: 0, share2: [0, 0, 0.1, 0.4, 0.6] });
  ok(host.layers[0].levelShares![2].join() === '0,0,0.1,0.4,0.6', 'one type\'s share set level by level');
  editLayer(host, { index: 0, type1: 'none' });
  ok(host.layers[0].types.join() === 'cumulus,cumulonimbus' && host.layers[0].levelShares![1].join() === '0,0,0.1,0.4,0.6', 'a type taken out takes its row with it');
  editLayer(host, { index: 0, base: 1200 });
  ok(host.layers[0].levelShares !== null && host.layers[0].base === 1200, 'another field changed keeps the rows');
  const line = keepLine(host.layers);
  const back = JSON.parse(line.slice('__debug.clouds('.length, -1)).layers[0];
  ok(back.shares[0] === 1 && back.shares[1].join() === '0,0,0.1,0.4,0.6' && cleanLayer(back, null).levelShares![1].join() === '0,0,0.1,0.4,0.6', 'the copied line writes the rows as shares of five and reads back to them');
  // The file reads the same form.
  const f = readCloudsFile({ version: 1, worlds: { naboo: { layers: [{ name: 'Low deck', shares: [1, [0, 0, 0.5, 1, 1]] }] } } });
  const got = stackFromFile(f, ['naboo'], cloudStartFor('naboo', 'naboo').layers);
  ok(f.notes.length === 0 && got.layers[0].levelShares![1].join() === '0,0,0.5,1,1' && got.layers[0].types.join() === 'cumulus,nimbostratus', "the file's shares by level are read in the same form, the rest from the start of the same name");
  const kept = stackFromFile(readCloudsFile({ version: 1, worlds: { naboo: { layers: [{ name: 'Low deck', base: 1500 }] } } }), ['naboo'], cloudStartFor('naboo', 'naboo').layers);
  ok(kept.layers[0].base === 1500 && kept.layers[0].levelShares![1].join() === '0,0,0.3,0.7,0.9', "a saved deck that sets no shares keeps its start's rows");
}

// ---------------------------------------------------------------------------------------------- the clouds file

{
  const start = cloudStartFor('naboo', 'naboo').layers;
  ok(readCloudsFile(null).worlds.size === 0 && readCloudsFile(null).refused === null, 'no file: nothing read, nothing refused');
  ok(readCloudsFile({ version: 2, worlds: {} }).refused !== null && readCloudsFile({ version: 2, worlds: { naboo: { layers: [{}] } } }).worlds.size === 0, 'a later version is refused whole');
  ok(readCloudsFile({ worlds: {} }).refused !== null, 'a file naming no version is refused');
  ok(CLOUDS_FILE_VERSION === 1, 'the reader reads version 1');
  const f = readCloudsFile({
    version: 1,
    extra: 1,
    worlds: {
      Naboo: { layers: [{ name: 'Low deck', cover: [2, 0.5, 0.5, 0.5, -1] }, { name: 'my veil', types: ['cirrostratus'], base: 30000, colour: 'red' }] },
      tatooine: { nothing: true },
    },
  });
  ok(f.refused === null && f.worlds.has('naboo') && !f.worlds.has('tatooine'), 'a world with layers is read (its id lower-cased); one without is noted and left');
  ok(f.notes.some((n) => n.includes('"extra"')) && f.notes.some((n) => n.includes('"colour"')), "fields that are not the file's are noted, never fatal");
  const notes: string[] = [];
  const got = stackFromFile(f, ['naboo'], start, notes);
  ok(got.from === 'naboo' && got.layers.length === 2, "the file's layers stand in place of the start, in the file's order");
  const cu = got.layers[0];
  ok(cu.cover[0] === 1 && cu.cover[4] === 0 && cu.base === start[0].base && cu.diurnal === start[0].diurnal, 'only what he set is taken; the rest comes from the start of the same name; values clamped');
  const veil = got.layers[1];
  ok(veil.base === CLOUD_CLAMP.heightMax && veil.types[0] === 'cirrostratus' && veil.thickness === CLOUD_TYPE_TUNE.cirrostratus.thickness, "a new layer's missing fields come from its type's starts; heights clamped to 20 km");
  const none = stackFromFile(f, ['dathomir'], cloudStartFor('dathomir', 'dathomir').layers);
  ok(none.from === null && none.layers.length === cloudStartFor('dathomir', 'dathomir').layers.length, 'a world the file does not name keeps its start');
  const many = readCloudsFile({ version: 1, worlds: { naboo: { layers: Array.from({ length: 9 }, (_, i) => ({ name: `l${i}` })) } } });
  ok(many.worlds.get('naboo')!.length === CLOUD_LAYER_MAX && many.notes.length === 9 - CLOUD_LAYER_MAX, `past ${CLOUD_LAYER_MAX} layers a world's are noted and left`);
}

// ---------------------------------------------------------------------------------------------- the console's edits

{
  const host: StackHost & { calls: number } = {
    layers: copyStack(cloudStartFor('naboo', 'naboo').layers),
    calls: 0,
    setLayers(list: readonly CloudLayer[]) {
      this.layers = copyStack(list);
      this.calls++;
      return [];
    },
    deckOf: (deck) => cloudDeckFor(deck, 'naboo', 'naboo'),
  };
  // Any type at any height: a cumulus at 8 km.
  let w = editLayer(host, { name: 'Low deck', type: 'cumulus', base: 8000, thickness: 1200 });
  ok(host.layers[0].base === 8000 && host.layers[0].types.join() === 'cumulus' && host.layers[0].levelShares === null && w.length === 0, 'a deck made a cumulus at 8 km stays a cumulus at 8 km, said nothing');
  // A mix of three, by the menu's fields.
  w = editLayer(host, { index: 0, type1: 'stratocumulus', type2: 'towering', share1: 2 });
  ok(host.layers[0].types.join() === 'cumulus,stratocumulus,towering' && host.layers[0].shares[1] === 2, 'a layer mixes up to three types with shares');
  w = editLayer(host, { index: 0, type2: 'none' });
  ok(host.layers[0].types.length === 2, 'a type taken out of a mix');
  // The late addition's second item: more decks from the same starts, and a blank one.
  w = editLayer(host, { add: 'low' });
  const second = host.layers[3];
  const nabooLow = cloudDeckFor('low', 'naboo', 'naboo');
  ok(host.layers.length === 4 && second.name === 'Low deck 2' && second.base === nabooLow.base && second.types.join() === nabooLow.types.join() && second.levelShares![1].join() === nabooLow.levelShares![1].join(), "a second low deck added at the world's real height and types, named apart");
  ok(second.seed !== nabooLow.seed, 'a second deck is its own clouds (its seed from its own name), not the first again');
  w = editLayer(host, { add: { deck: 'high', base: 11000 } });
  ok(host.layers[4].name === 'High deck 2' && host.layers[4].base === 11000 && host.layers[4].types.join() === cloudDeckFor('high', 'naboo', 'naboo').types.join(), 'a deck added with a field of his laid over it');
  w = editLayer(host, { add: 'blank', at: 0 });
  ok(host.layers[0].name === 'New layer' && host.layers[0].cover.every((c) => c === 0) && host.layers.length === 6, 'a blank layer added (no cover until he gives it some) at a place in the stack');
  w = editLayer(host, { add: 'stratus' });
  ok(host.layers.length === CLOUD_LAYER_MAX && /holds 6/.test(w[0]), `past ${CLOUD_LAYER_MAX} layers an add is answered in words, nothing else moved`);
  w = editLayer(host, { name: 'New layer', to: 5 });
  ok(host.layers[5].name === 'New layer', 'a layer moved to the end');
  w = editLayer(host, { index: 5, remove: true });
  ok(host.layers.length === 5 && !host.layers.some((l) => l.name === 'New layer'), 'a layer removed');
  // Overlapping layers, several of one type.
  w = editLayer(host, { add: { types: ['cumulus'], base: 8100 } });
  ok(host.layers.length === 6 && host.layers[5].name === 'cumulus' && host.layers[5].base === 8100 && host.layers[0].base === 8000, 'a cumulus layer added overlapping the first, a type at its starts');
  w = editLayer(host, { index: 5, remove: true });
  w = editLayer(host, { add: 'nonsense' });
  ok(/not a cloud type or a start/.test(w[0]) && host.layers[5].types.join() === 'cumulus', 'an add of no type and no start is said, and a cumulus stands in');
  w = editLayer(host, { index: 5, remove: true });
  w = editLayer(host, { name: 'Middle deck', cover2: 0.9, on: false });
  ok(host.layers.find((l) => l.name === 'Middle deck')!.cover[2] === 0.9 && host.layers.find((l) => l.name === 'Middle deck')!.on === false, 'one level of a cover set, a layer switched off');
  w = editLayer(host, { name: 'nobody', base: 1 });
  ok(/no layer/.test(w[0]), 'an edit of a layer that is not there says so');
  w = editLayer(host, { index: 0, sparkle: 3 });
  ok(/not a layer's field/.test(w[0]), "a field that is not a layer's is said, not taken");
  const line = keepLine(host.layers);
  ok(line.startsWith('__debug.clouds({"layers":[') && JSON.parse(line.slice('__debug.clouds('.length, -1)).layers.length === host.layers.length, 'the line that keeps a stack is the helper\'s own argument');
  // Without a world's decks (a host with none) a deck's add is said and a blank layer stands in.
  const bare: StackHost = { layers: [], setLayers(list) { this.layers = copyStack(list); return []; } };
  w = editLayer(bare, { add: 'middle' });
  ok(/no world's middle deck/.test(w[0]) && bare.layers[0].cover.every((c) => c === 0), 'a deck asked of no world is said, and a blank layer stands in');
}

// ---------------------------------------------------------------------------------------------- the wiring

{
  // The regional term reaches the map: the app hands the run its places' index (`regionSource`) and tells it when they move,
  // and the run asks at each arrival; the world hands the borrowed world's id with the planet's and the pack's.
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8');
  const run = readFileSync(new URL('../../../src/sky/clouds/cloudRun.ts', import.meta.url), 'utf8');
  const world = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8');
  const shown = main.slice(main.indexOf('  private refreshPlacesShown(): void {'), main.indexOf('  private refreshPlacesShown(): void {') + 2500);
  ok(shown.includes('cl.run.regionSource ??= () => cl.regionsOf(this.placesNow());') && shown.includes('cl.run.regionsMoved();') && shown.includes('if (GPU.webgpu && GPU.rt) {'), "the places' index handed to the clouds whenever the places are shown, on WebGPU alone");
  const attach = run.slice(run.indexOf('  attach(o: {'), run.indexOf('  deckOf(deck: CloudDeckId)'));
  ok(attach.includes('this.regionsMoved();') && attach.includes('cloudStartFor(o.planetId, o.packId, this.borrowId)'), 'the run asks for the regions and takes the borrowed world at every arrival');
  ok(/sf\.regions = this\.regionsN;/.test(run) && /packBands\(this\.stackF, this\.count, this\.bandsF, sf\.bandTop\)/.test(run), "the frame hands the regions to the packing and the band tops to the bands");
  ok(world.includes('const borrowId = this.planet.ground?.pack ?? this.planet.borrowSky ?? null;') && world.includes('packId: this.packId, borrowId,'), "the world hands the clouds the world whose ground rules or sky it borrows");
}

// ---------------------------------------------------------------------------------------------- the drift's kept steps

{
  const seed = seedOf('rori');
  const weights = climateFor('rori', 5);
  const speeds = [5, 6, 8, 10, 12];
  const now = 1_796_000_123.4;
  const A = new CloudDrift();
  A.setWorld(seed, weights, speeds);
  A.tau = now;
  A.at();
  const x0 = A.x;
  const z0 = A.z;
  // On a few steps (as the console's asked moment does), then back: answered from the kept steps, nothing summed again.
  A.tau = now + 3 * STEP_SECONDS + 17;
  A.at();
  const before = A.steps;
  A.tau = now;
  A.at();
  ok(A.x === x0 && A.z === z0 && A.steps === before, `a moment ${3} steps back answers as before, to the bit, from the kept steps (none summed again)`);
  // Farther back than the kept steps: summed again from the epoch, and still the same.
  A.tau = now + (KEPT_STEPS + 3) * STEP_SECONDS;
  A.at();
  A.tau = now;
  A.at();
  ok(A.x === x0 && A.z === z0, `a moment ${KEPT_STEPS + 3} steps back is summed again from the epoch and is the same`);
}

console.log(`\ncloudStacks: ${checks} checks passed`);
