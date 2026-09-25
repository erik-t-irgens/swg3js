// What each world's sky is really like, measured off the pictures the client drew it with.
//
// The rules are pure, so this runs the real ones. Where the owner's packs are installed it then
// measures the **real** worlds and prints what they say, which is how the claim that this comes out
// of the client's own art stays an observed fact rather than an assertion in a comment.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { gatherLevels, measureTile } from '../clouds.mjs';
import { cloudLook, levelAt, worthDrawing, CLOUD_TUNE, type CloudPack } from '../../../src/world/cloudLook.ts';
import { encodePng } from '../png.mjs';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string): void => console.log(`note ${s}`);

/** A tile of a known coverage and colour, so the measurement can be checked against arithmetic. */
function tile(alpha: number, grey: number, size = 16): Buffer {
  const px = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    px[i * 4] = grey;
    px[i * 4 + 1] = grey;
    px[i * 4 + 2] = grey;
    px[i * 4 + 3] = Math.round(alpha * 255);
  }
  return encodePng(size, size, px);
}

{
  // The measurement, against tiles whose answer is known.
  const full = measureTile(tile(1, 255));
  ok(full !== null && Math.abs(full.coverage - 1) < 0.01, `a sheet that hides the sky reads as covering all of it (${full?.coverage})`);
  ok(Math.abs(full!.brightness - 1) < 0.01, 'and a white one reads as bright');
  const clear = measureTile(tile(0, 255));
  ok(clear !== null && clear.coverage < 0.01, 'a sheet that hides nothing reads as covering nothing');
  const half = measureTile(tile(0.5, 128));
  ok(Math.abs(half!.coverage - 0.5) < 0.01, `half-transparent reads as half covered (${half?.coverage})`);
  ok(Math.abs(half!.brightness - 0.502) < 0.02, `and mid grey reads as mid bright (${half?.brightness})`);

  // The brightness is weighted by alpha, which is the whole difference between reading the cloud
  // and reading the gaps: a mostly empty tile would otherwise report the colour of its own holes.
  const size = 16;
  const px = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const cloud = i < 16; // a sixteenth of it is dark cloud, the rest is clear white
    px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = cloud ? 20 : 255;
    px[i * 4 + 3] = cloud ? 255 : 0;
  }
  const sparse = measureTile(encodePng(size, size, px));
  ok(sparse!.brightness < 0.2, `a mostly empty tile reports the colour of its cloud, not of its holes (${sparse?.brightness})`);
  ok(measureTile(Buffer.from('not a png')) === null, 'and something that is not a picture is refused rather than guessed at');
}

{
  // Gathering rows into levels. A level's coverage is the cloudiest area in it, not the mean: the
  // rows of a level are different places on the map, and a player standing in the cloudiest of them
  // should see that sky rather than an average of it with the clear side of the world.
  const tiles = { 'thin.png': { coverage: 0.1, brightness: 0.8, solid: 0, width: 8, height: 8 }, 'thick.png': { coverage: 0.9, brightness: 0.2, solid: 0.7, width: 8, height: 8 } };
  const levels = gatherLevels(
    [
      { weatherIndex: 0, cloudBottom: { file: 'sky/thin.png' } },
      { weatherIndex: 0, cloudBottom: { file: 'sky/thick.png' }, cloudTop: { file: 'sky/thin.png' } },
      { weatherIndex: 1, cloudTop: { file: 'sky/thin.png' } },
    ],
    tiles,
  );
  ok(levels.length === 2, 'the rows gather into one record per weather level');
  ok(levels[0].coverage === 0.9, `and a level takes the cloudiest area in it (${levels[0].coverage})`);
  ok(levels[0].brightness === 0.2, 'with that area’s own darkness, not an average of the world’s');
  ok(levels[0].decks === 2, 'a row carrying a bottom and a top is two layers of sky');
  ok(levels[1].decks === 1, 'and one carrying a single sheet is one');
  ok(gatherLevels([], tiles).length === 0, 'a world with no rows gathers into nothing rather than throwing');
}

{
  // The look, and the one thing that looks like a rule and is not.
  const pack: CloudPack = {
    format: 1,
    planet: 'test',
    tiles: {},
    levels: [
      { level: 0, rows: 4, decks: 2, coverage: 0.35, brightness: 0.17, tiles: [] },
      { level: 2, rows: 4, decks: 2, coverage: 0.35, brightness: 0.17, tiles: [] },
    ],
  };
  const calm = cloudLook(pack, 0, 1, false);
  const blustery = cloudLook(pack, 2, 1, false);
  ok(calm.brightness === 0.17 && calm.decks === 2, 'the look takes its darkness and its depth straight off the art');
  ok(blustery.coverage > calm.coverage, `and the weather level moves the coverage only a little (${calm.coverage.toFixed(3)} to ${blustery.coverage.toFixed(3)})`);
  ok(blustery.coverage / calm.coverage < 1.5, 'a little, because the art already said what the sky is: the level is not the coverage');
  ok(cloudLook(pack, 99, 1, false).level === undefined, 'a level the world has not got is answered by its nearest rather than by nothing');
  ok(levelAt(pack, 99)?.level === 2 && levelAt(pack, -5)?.level === 0, 'which is the nearest at either end');

  // A storm on the camera: the march stands down, because the client's own rows do.
  ok(!worthDrawing(cloudLook(pack, 0, 1, true)), 'a row hanging a storm effect on the camera draws no cloud behind it');
  ok(worthDrawing(calm), 'and one that is not, does');

  // No pack at all: a clear day, and never a storm nobody asked for.
  const none = cloudLook(null, 0, 1, false);
  ok(none.coverage === CLOUD_TUNE.fallback.coverage, 'a world nobody has measured gets a clear day rather than a guess');
  ok(worthDrawing(none), 'which is still worth drawing, so the toggle is a fair comparison');
  // And a measured world whose rows carry no cloud at all draws nothing, rather than a fallback.
  const bare: CloudPack = { format: 1, planet: 'bare', tiles: {}, levels: [{ level: 0, rows: 2, decks: 0, coverage: 0, brightness: 1, tiles: [] }] };
  ok(!worthDrawing(cloudLook(bare, 0, 1, false)), 'a world measured as having no cloud draws none, which is not the same as one never measured');
}

{
  // The real worlds, where they are installed.
  const roots = existsSync('assets-private') ? readdirSync('assets-private') : [];
  const rows: string[] = [];
  let measured = 0;
  let darkest = { pack: '', brightness: 1 };
  let thickest = { pack: '', coverage: 0 };
  for (const pack of roots) {
    const f = `assets-private/${pack}/clouds.json`;
    if (!existsSync(f)) continue;
    const doc = JSON.parse(readFileSync(f, 'utf8')) as CloudPack;
    measured++;
    const worst = doc.levels.reduce((m, l) => (l.coverage > m.coverage ? l : m), { coverage: 0, brightness: 1 } as CloudLevelish);
    if (worst.coverage > 0 && worst.brightness < darkest.brightness) darkest = { pack, brightness: worst.brightness };
    if (worst.coverage > thickest.coverage) thickest = { pack, coverage: worst.coverage };
    rows.push(`${pack.padEnd(24)} up to ${(worst.coverage * 100).toFixed(0).padStart(3)}% covered, brightness ${worst.brightness.toFixed(2)}, ${doc.levels.length} levels`);
  }
  if (!measured) {
    note('no world here has been measured, so the rules above stand on their own');
  } else {
    for (const r of rows) note(r);
    ok(measured >= 1, `${measured} worlds measured`);
    ok(darkest.pack === 'mustafar', `the darkest sky in the game is the lava world's, which is what its own art says (${darkest.pack}, brightness ${darkest.brightness})`);
    ok(thickest.coverage > 0.8, `and the thickest is a real storm deck (${thickest.pack}, ${(thickest.coverage * 100).toFixed(0)}%)`);
  }
}

interface CloudLevelish {
  coverage: number;
  brightness: number;
}

console.log(`\n${passed} checks passed`);
