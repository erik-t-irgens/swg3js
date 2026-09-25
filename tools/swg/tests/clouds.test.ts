// What each world's sky is really like, measured off the pictures the client drew it with.
//
// The rules are pure, so this runs the real ones. Where the owner's packs are installed it then
// measures the **real** worlds and prints what they say, which is how the claim that this comes out
// of the client's own art stays an observed fact rather than an assertion in a comment.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { gatherLevels, measureTile } from '../clouds.mjs';
import { cloudLook, levelAt, worthDrawing, CLOUD_TUNE, type CloudPack } from '../../../src/world/cloudLook.ts';
import { cutForCover, densityFrom, CLOUD_MARCH } from '../../../src/core/fx/cloudMath.ts';
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

{
  // The calibration, checked by marching the real volumes rather than by arithmetic.
  //
  // Coverage is a share of sky and the march turns it into a threshold on the billow channel, and
  // three things stand between the two: the billow does not fill nought to one, the erosion and the
  // detail then eat most of what survives the threshold, and a ray crosses eight hundred metres of
  // deck so the sky fills faster than the volume does. The converter therefore marches the volumes
  // it has just written at a set of thresholds and records what share of sky each one filled. This
  // reads those bytes and marches them again, with its own ray set and with trilinear sampling
  // rather than the sweep's nearest texel, which is the only way to know the table is right.
  const noiseFile = 'assets-private/clouds/noise_base.rgba';
  const detailFile = 'assets-private/clouds/noise_detail.rgba';
  const manFile = 'assets-private/clouds/manifest.json';
  if (!existsSync(noiseFile) || !existsSync(detailFile) || !existsSync(manFile)) {
    note('no noise volume here, so the curve was checked on its own');
    const curve = [
      { cut: 0.2, sky: 1 },
      { cut: 0.6, sky: 0.7 },
      { cut: 0.9, sky: 0 },
    ];
    ok(cutForCover(1, curve) === 0.2, 'a sky asked to be full cuts where the curve says it fills');
    ok(cutForCover(0, curve) === 0.9, 'and an empty one where it says it empties');
    ok(cutForCover(0.85, curve) > 0.2 && cutForCover(0.85, curve) < 0.6, 'a share between two measured points lands between their cuts');
    ok(cutForCover(2, curve) === 0.2 && cutForCover(-1, curve) === 0.9, 'a coverage outside nought to one is held inside it');
    ok(cutForCover(0.5, []) === 1, 'and with no curve at all nothing is drawn, rather than something arbitrary');
  } else {
    const man = JSON.parse(readFileSync(manFile, 'utf8')) as { format: number; billow: { lo: number; hi: number }; base: { size: number }; detail: { size: number }; cover: { cut: number; sky: number }[] };
    const base = new Uint8Array(readFileSync(noiseFile));
    const detail = new Uint8Array(readFileSync(detailFile));
    const n = man.base.size ** 3;
    ok(base.length === n * 4, `the volume on disk is the size its manifest claims (${base.length} bytes for ${man.base.size} cubed)`);
    ok(man.format === 2 && man.cover.length > 1, `and carries the measured curve the march reads (${man.cover.length} thresholds)`);
    // Monotone, or a cloudier world would somehow come out with less cloud.
    let rising = true;
    for (let i = 1; i < man.cover.length; i++) {
      if (man.cover[i].cut <= man.cover[i - 1].cut || man.cover[i].sky > man.cover[i - 1].sky + 1e-9) rising = false;
    }
    ok(rising, 'the curve rises in threshold and falls in sky, which is what makes it invertible');

    // Trilinear, as the GPU samples, on a repeat-wrapped volume: deliberately not the nearest texel
    // the sweep used, so the two are not the same arithmetic twice.
    const wrap = (i: number, size: number): number => ((i % size) + size) % size;
    const trilinear = (buf: Uint8Array, size: number, x: number, y: number, z: number, out: number[]): number[] => {
      const fx = x * size - 0.5;
      const fy = y * size - 0.5;
      const fz = z * size - 0.5;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const iz = Math.floor(fz);
      const tx = fx - ix;
      const ty = fy - iy;
      const tz = fz - iz;
      out[0] = out[1] = out[2] = out[3] = 0;
      for (let dz = 0; dz < 2; dz++) {
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
            if (w === 0) continue;
            const o = ((wrap(iz + dz, size) * size + wrap(iy + dy, size)) * size + wrap(ix + dx, size)) * 4;
            for (let c = 0; c < 4; c++) out[c] += (buf[o + c] / 255) * w;
          }
        }
      }
      return out;
    };
    const b: number[] = [0, 0, 0, 0];
    const d: number[] = [0, 0, 0, 0];
    const M = CLOUD_MARCH;
    const span = M.top - M.bottom;
    const stepLen = span / M.steps;
    /** What share of straight-up rays find more than half the light stopped, at this threshold. */
    const skyAt = (cut: number): number => {
      let hit = 0;
      const rays = 40;
      for (let i = 0; i < rays * rays; i++) {
        const px = ((i * 1013) % 12000) + 0.5;
        const pz = ((i * 3571) % 12000) + 0.5;
        let od = 0;
        for (let s = 0; s < M.steps; s++) {
          const py = M.bottom + (s + 0.5) * stepLen;
          const h = (py - M.bottom) / span;
          trilinear(base, man.base.size, px / M.baseScale, py / M.baseScale, pz / M.baseScale, b);
          trilinear(detail, man.detail.size, px / M.detailScale, py / M.detailScale, pz / M.detailScale, d);
          od += densityFrom(b, d, h, cut, 2) * M.density * stepLen;
        }
        if (1 - Math.exp(-od) >= 0.5) hit++;
      }
      return hit / (rays * rays);
    };
    const worlds: [number, string][] = [
      [0.12, 'Tatooine'],
      [0.27, 'Corellia, Naboo'],
      [0.35, 'Mustafar'],
      [0.67, 'Kashyyyk dead forest'],
      [0.85, 'Dathomir'],
    ];
    let worst = 0;
    for (const [coverage, who] of worlds) {
      const cut = cutForCover(coverage, man.cover);
      const got = skyAt(cut);
      note(`${who.padEnd(22)} asked for ${(coverage * 100).toFixed(0).padStart(3)}% of the sky, cut ${cut.toFixed(3)} gives ${(got * 100).toFixed(0).padStart(3)}%`);
      worst = Math.max(worst, Math.abs(got - coverage));
    }
    ok(worst < 0.08, `every world gets the sky its own art asked for (worst off by ${(worst * 100).toFixed(0)} points)`);
    // And what the old reading got wrong, which is why this is marched and not reasoned about: a cut
    // placed between the billow's own measured ends left the commonest sky in the game with almost
    // nothing in it, because everything it let through was then eaten by the erosion and the detail.
    const ends = man.billow.hi - (man.billow.hi - man.billow.lo) * 0.27;
    const wasGiven = skyAt(ends);
    ok(wasGiven < 0.1, `placing the cut by the billow's ends alone would give a world asking for 27% of the sky only ${(wasGiven * 100).toFixed(0)}%, which is sixteen of the eighteen worlds`);
  }
}

{
  // The march carries its own copy of the cut, because the pass may not import the world. Two
  // copies of one number are kept in step by checking rather than by hoping -- the same footing the
  // palette and the display's geometry are on -- and the shader's own constants are read as text,
  // since a shader is a string and no compiler will ever look at it.
  const src = readFileSync(new URL('../../../src/core/fx/clouds.ts', import.meta.url), 'utf8');
  ok(/cutForCover\(this\.look\.coverage, this\.cover\)/.test(src), 'the march takes its threshold off the measured curve rather than working one out');
  ok(/uLook\.x/.test(src) && /base\.r - uLook\.x/.test(src), 'and the shader cuts the billow channel at the number it is handed, rather than at one of its own');
  // The shader is a string and no compiler will look at it, so its constants are read as text and
  // checked against the one table the converter and this test evaluate the same rule from.
  const math = readFileSync(new URL('../../../src/core/fx/cloudMath.ts', import.meta.url), 'utf8');
  ok(/export \{ CLOUD_MARCH \} from '\.\/cloudMath\.ts'/.test(src), 'and the numbers are that table\'s, not a second copy of them');
  ok(/ERODE_BITE = \$\{CLOUD_MARCH\.erodeBite/.test(src) && /DETAIL_BITE = \$\{CLOUD_MARCH\.detailBite/.test(src), 'both bites the density rule takes are written into the program from it');
  ok(/base\.g \* 0\.625 \+ base\.b \* 0\.25 \+ base\.a \* 0\.125/.test(src) && /g \* 0\.625 \+ b \* 0\.25 \+ a \* 0\.125/.test(math), 'the erosion channels are weighed the same way in the shader and in the rule the calibration used');
  // Nothing in the march may ask for a light or write depth: both would reach outside the pass.
  ok(!/castShadow|PointLight|DirectionalLight/.test(src), 'the march asks for no light, so no material anywhere recompiles when it is switched on');
  ok(/depthWrite: false/.test(src) && !/depthWrite: true/.test(src), 'and writes no depth, which is what keeps a cloud pixel sky to the god rays');
  // The deck hangs where the sheets hang and does not follow the eye. One that follows is a ceiling
  // exactly fifteen hundred metres up wherever you go, which no ship can ever climb into and which
  // rolls as you walk, and that is what it looked like.
  ok(/uSlab\.value as THREE\.Vector2\)\.set\(CLOUD_MARCH\.bottom, CLOUD_MARCH\.top\)/.test(src), 'the deck hangs at a fixed altitude in the world, so a ship can fly up into it');
  ok(!/cam\.position\.y \+ CLOUD_MARCH/.test(src), 'and nothing adds the camera back on');

  // The owner asked for the march to stand where the sheets stand, and the sheets to stand down for
  // it. Both are two files apart, so both are read as text here.
  const sky = readFileSync(new URL('../../../src/world/sky.ts', import.meta.url), 'utf8');
  // The sky is read as text because it is a renderer file and pulls three in behind it; the march's
  // own slab comes off the table this test already imports.
  const altitudes = /const CLOUD_ALTITUDES = \[(\d+), (\d+)\]/.exec(sky);
  ok(!!altitudes, 'the sky still declares the altitudes its own sheets hang at');
  ok(
    Number(altitudes![1]) === CLOUD_MARCH.bottom && Number(altitudes![2]) === CLOUD_MARCH.top,
    'and the march fills exactly the slab the flat sheets hang in, rather than a deck of its own somewhere else',
  );
  ok(/c\.mesh\.visible = this\.sheetsOn && /.test(sky), 'the sheets are taken down by one flag, so the two skies are never drawn at once');
  // The flare is dimmed by cloud, and it reads the sheets: it must go on reading them while they are
  // hidden, or switching the march on would make a cloudy noon flare like a clear one.
  const layers = /cloudLayers\(out: readonly FxCloudLayer\[\]\): number \{[\s\S]*?\n  \}/.exec(sky)?.[0] ?? '';
  ok(layers.length > 0 && !/mesh\.visible/.test(layers), 'and a hidden sheet is still reported to the lens flare, which is dimmed by cloud rather than by what is drawn');

  // **The two that made it draw nothing at all**, both of them invisible in the code and identical
  // on screen to "the march found no cloud", which is why they are pinned rather than remembered.
  //
  // A full-screen pass writes every pixel of its target outright and the alpha it writes is data,
  // not a blend factor. Left at three's default blending the composite's own `gl_FragColor.a`,
  // which is the scene's alpha carried on, is read as coverage -- so wherever the scene's alpha is
  // zero, which over a planet is the whole sky, the pass writes nothing whatever. Every other pass
  // in the chain says `NoBlending` and this one did not.
  ok((src.match(/blending: THREE\.NoBlending/g) ?? []).length === 2, 'the march and its composite both write outright, since the alpha they write is data and not a blend factor');
  // And the depth product writes the far plane wherever nothing was drawn, so a sky pixel read as a
  // surface stops the ray before it reaches a deck that is 8.6 km off ten degrees above the horizon.
  ok(/depth < uFar \* 0\.999/.test(src), 'a pixel at the far plane is sky, not a surface the ray stops at');
  ok(/u\.uFar\.value = ctx\.far/.test(src), 'and the far plane it is compared against is the frame\'s own');

  // The same trap across the rest of the chain, since it is not the clouds' alone: a pass that turns
  // the depth test off is drawing over the whole screen, and every one of them must say how it blends.
  const fxDir = new URL('../../../src/core/fx/', import.meta.url);
  for (const file of readdirSync(fxDir).filter((f) => f.endsWith('.ts'))) {
    const text = readFileSync(new URL(file, fxDir), 'utf8');
    for (const block of text.match(/new THREE\.ShaderMaterial\(\{[\s\S]*?\n {4}\}\)/g) ?? []) {
      if (!/depthTest: false/.test(block)) continue;
      ok(/blending: THREE\./.test(block), `${file}: a full-screen material says how it blends rather than taking three's default`);
    }
  }

  // The wind. A cloud must blow the way the rain leans, which is the sign on the drift and nothing else.
  ok(/uDrift\.value as THREE\.Vector2\)\.set\(-Math\.sin\(this\.look\.heading\)/.test(src), "the volume is sampled against the wind, so the cloud blows toward the heading as the rain and the dust do");
}

interface CloudLevelish {
  coverage: number;
  brightness: number;
}

console.log(`\n${passed} checks passed`);
