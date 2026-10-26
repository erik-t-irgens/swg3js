// The clouds' light conversion (the volumetrics' seventh wave's second half, the design's §14c): `clouds.mjs` writes each
// picture's own numbers beside what it always wrote (`pictures: 2`), and the calibration's sweep moved from the
// converter's `cloudnoise.mjs` into `cloudMath.ts`. Held here:
//
//   1. `measureWorld` over a fixture pack of stand-in pictures, and over every converted world on disk (`SWG3JS_PACKS`,
//      else `assets-private/`), against the converter as it stood before the pass (`clouds.mjs` and `png.mjs` written out
//      of git): every field it wrote before byte for byte, `format` 1 kept, the new numbers under `pictures: 2` and sane;
//   2. `bakeClouds` writes them, into a folder of the test's own only;
//   3. `coverCurve` from `cloudMath.ts` is the old converter's sweep to the bit on the same bytes, and gives the noise
//      manifest's own curve where the volumes are converted;
//   4. `status` asks for `clouds --no-noise` while a world's file lacks the pictures' numbers, and nothing once it has them.
//
// Nothing under `assets-private/` is written: a world on disk is only read. Plain type stripping.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PRE_PASS, REPO, showOld } from './airTrees.ts';
import { CLOUD_MARCH, COVER_CUTS, coverCurve } from '../../../src/core/fx/cloudMath.ts';
import * as cloudMath from '../../../src/core/fx/cloudMath.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string): void => console.log(`note ${s}`);

type Mod = Record<string, unknown>;
// The converter as it stood before the pass, written out of git beside a copy of its one import.
const OLD = mkdtempSync(join(tmpdir(), 'swg3js-clouds-old-'));
const FIX = mkdtempSync(join(tmpdir(), 'swg3js-clouds-fix-'));
process.on('exit', () => {
  for (const d of [OLD, FIX]) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* a temporary folder the system clears in its own time */
    }
  }
});
for (const f of ['clouds.mjs', 'png.mjs', 'cloudnoise.mjs']) writeFileSync(join(OLD, f), showOld(`tools/swg/${f}`));
const oldClouds = (await import(pathToFileURL(join(OLD, 'clouds.mjs')).href)) as Mod;
const oldNoise = (await import(pathToFileURL(join(OLD, 'cloudnoise.mjs')).href)) as Mod;
const newClouds = (await import(pathToFileURL(join(REPO, 'tools', 'swg', 'clouds.mjs')).href)) as Mod;
const png = (await import(pathToFileURL(join(REPO, 'tools', 'swg', 'png.mjs')).href)) as { encodePng: (w: number, h: number, rgba: Uint8Array) => Uint8Array };
ok(typeof oldClouds.measureWorld === 'function' && typeof newClouds.measureWorld === 'function', `the converter as it stood before the pass (${PRE_PASS}) is written out of git and loaded beside today's`);

type Tile = Record<string, unknown>;
type World = { format: number; planet: string; tiles: Record<string, Tile>; levels: unknown[]; pictures?: number };
const NEW_TILE_KEYS = ['spread', 'q10', 'q50', 'q90', 'colour', 'layered'];
/** Today's record with the new numbers taken out: what the converter wrote before, in the order it wrote it. */
function stripped(w: World): World {
  const tiles: Record<string, Tile> = {};
  for (const [k, t] of Object.entries(w.tiles)) {
    const o: Tile = {};
    for (const [kk, v] of Object.entries(t)) if (!NEW_TILE_KEYS.includes(kk)) o[kk] = v;
    tiles[k] = o;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(w)) if (k !== 'pictures') out[k] = k === 'tiles' ? tiles : v;
  return out as unknown as World;
}

// --- a fixture pack of stand-in pictures ---
function picture(w: number, h: number, alpha: (x: number, y: number) => number, rgb: [number, number, number]): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      rgba[i] = rgb[0];
      rgba[i + 1] = rgb[1];
      rgba[i + 2] = rgb[2];
      rgba[i + 3] = Math.max(0, Math.min(255, Math.round(alpha(x, y) * 255)));
    }
  }
  return png.encodePng(w, h, rgba);
}
function fixtureWorld(root: string, planet: string): void {
  const dir = join(root, planet);
  mkdirSync(join(dir, 'texture'), { recursive: true });
  // Heaps: patches of cloud in clear sky. A veil: an even thin cover. A storm: thick and dark.
  writeFileSync(join(dir, 'texture', 'heaps.png'), picture(64, 64, (x, y) => (Math.sin(x * 0.4) * Math.cos(y * 0.3) > 0.55 ? 0.95 : 0), [235, 236, 242]));
  writeFileSync(join(dir, 'texture', 'veil.png'), picture(64, 64, (x, y) => 0.45 + 0.05 * Math.sin((x + y) * 0.2), [210, 214, 222]));
  writeFileSync(join(dir, 'texture', 'storm.png'), picture(64, 64, (x) => 0.7 + 0.2 * Math.sin(x * 0.1), [80, 84, 90]));
  const row = (weatherIndex: number, bottom: string | null, top: string | null) => ({ name: 'area', weatherIndex, cloudBottom: bottom ? { file: `texture/${bottom}`, size: 9, speed: 1.5 } : null, cloudTop: top ? { file: `texture/${top}`, size: 14, speed: 2 } : null });
  writeFileSync(join(dir, 'sky.json'), JSON.stringify({ planet, blocks: [row(0, 'heaps.png', 'veil.png'), row(1, 'heaps.png', null), row(2, null, 'veil.png'), row(3, 'storm.png', null), row(4, null, null)] }));
}
fixtureWorld(FIX, 'tatooine');

// --- 1. measureWorld: every field it wrote before, byte for byte ---
const measure = (m: Mod, root: string, pack: string): World | null => (m.measureWorld as (r: string, p: string) => World | null)(root, pack);
{
  const a = measure(oldClouds, FIX, 'tatooine')!;
  const b = measure(newClouds, FIX, 'tatooine')!;
  ok(JSON.stringify(stripped(b), null, 1) === JSON.stringify(a, null, 1), "a fixture world's clouds.json keeps every field the converter wrote before, in its order and to the byte");
  ok(b.format === 1 && b.pictures === 2 && Object.keys(b).join() === 'format,planet,tiles,levels,pictures', '`format` stays 1 (the September loader reads format 1 alone) and `pictures: 2` stands after everything it held before');
  const heaps = b.tiles['heaps.png'];
  const veil = b.tiles['veil.png'];
  const storm = b.tiles['storm.png'];
  ok(Object.values(b.tiles).every((t) => NEW_TILE_KEYS.every((k) => k in t) && Array.isArray(t.colour) && (t.colour as number[]).length === 3 && (t.colour as number[]).every((v) => Number.isInteger(v) && v >= 0 && v <= 255)), 'each picture carries its alpha\'s spread, three quantiles, its alpha-weighted mean colour as sRGB bytes and its kind');
  ok((veil.layered as number) === 1 && (heaps.layered as number) === 0 && (veil.spread as number) < (heaps.spread as number) && (heaps.q10 as number) === 0 && (heaps.q90 as number) > 0.9, `a veil reads as a layer (spread ${veil.spread}), patchy heaps as heaps (spread ${heaps.spread}, a tenth of it clear sky)`);
  ok((storm.colour as number[])[0] === 80 && (heaps.colour as number[])[2] === 242, "the colour is the covered texels' own, alpha-weighted");
}
// Every converted world on disk, read only.
{
  const root = process.env.SWG3JS_PACKS ?? join(REPO, 'assets-private');
  const worlds = existsSync(root) ? ['corellia', 'dantooine', 'dathomir', 'dungeon1', 'endor', 'kashyyyk_dead_forest', 'kashyyyk_hunting', 'kashyyyk_main', 'kashyyyk_north_dungeons', 'kashyyyk_pob_dungeons', 'kashyyyk_rryatt_trail', 'kashyyyk_south_dungeons', 'lok', 'mustafar', 'naboo', 'rori', 'talus', 'tatooine', 'yavin4'].filter((p) => existsSync(join(root, p, 'sky.json'))) : [];
  if (!worlds.length) note(`no converted world under ${root}: the fixture stands for them`);
  let same = 0;
  let tiles = 0;
  let layers = 0;
  const differ: string[] = [];
  for (const p of worlds) {
    const a = measure(oldClouds, root, p);
    const b = measure(newClouds, root, p);
    if (!a || !b) continue;
    if (JSON.stringify(stripped(b), null, 1) === JSON.stringify(a, null, 1) && b.pictures === 2 && b.format === 1) same++;
    else differ.push(p);
    tiles += Object.keys(b.tiles).length;
    layers += Object.values(b.tiles).filter((t) => (t.layered as number) > 0.5).length;
  }
  if (worlds.length) ok(same === worlds.length, `every converted world's measurement (${same} of ${worlds.length}, ${tiles} pictures, ${layers} of them layers) keeps what the converter wrote before byte for byte${differ.length ? `; differ: ${differ.join(', ')}` : ''}`);
}

// --- 2. bakeClouds writes it (into the test's own folder) ---
{
  const out = (newClouds.bakeClouds as (r: string, p: string[]) => { done: unknown[] })(FIX, ['tatooine']);
  const written = JSON.parse(readFileSync(join(FIX, 'tatooine', 'clouds.json'), 'utf8')) as World;
  ok(out.done.length === 1 && written.pictures === 2 && written.format === 1 && 'layered' in written.tiles['veil.png'], 'bakeClouds writes each picture\'s numbers under `pictures: 2`, format 1 kept');
}

// --- 3. coverCurve: the old converter's sweep to the bit, and the manifest's own curve ---
{
  let seed = 4242;
  const rnd = (): number => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) & 0xffff) / 0xffff;
  const bs = 16;
  const ds = 8;
  const base = new Uint8Array(bs ** 3 * 4);
  const detail = new Uint8Array(ds ** 3 * 4);
  for (let i = 0; i < base.length; i++) base[i] = Math.floor(rnd() * 255);
  for (let i = 0; i < detail.length; i++) detail[i] = Math.floor(rnd() * 255);
  const march = { ...CLOUD_MARCH, steps: 24 };
  const was = (oldNoise.coverCurve as (...a: unknown[]) => unknown)(base, detail, bs, ds, march, cloudMath, COVER_CUTS, 16);
  const now = coverCurve(base, detail, bs, ds, march, 2, COVER_CUTS, 16);
  ok(JSON.stringify(was) === JSON.stringify(now) && now.length === COVER_CUTS.length, "cloudMath.ts's coverCurve is the old converter's sweep to the bit on the same bytes (the sky's slab measured as two decks)");
  const viaConverter = (newClouds as Mod) && ((await import(pathToFileURL(join(REPO, 'tools', 'swg', 'cloudnoise.mjs')).href)) as Mod).coverCurve as (...a: unknown[]) => unknown;
  ok(JSON.stringify(viaConverter(base, detail, bs, ds, march, cloudMath, COVER_CUTS, 16)) === JSON.stringify(now), 'and the converter calls it back from there, the same curve');
  const root = process.env.SWG3JS_PACKS ?? join(REPO, 'assets-private');
  const manFile = join(root, 'clouds', 'manifest.json');
  if (existsSync(manFile)) {
    const man = JSON.parse(readFileSync(manFile, 'utf8')) as { format: number; base: { size: number; file: string }; detail: { size: number; file: string }; cover: { cut: number; sky: number }[] };
    const b = readFileSync(join(root, 'clouds', man.base.file));
    const d = readFileSync(join(root, 'clouds', man.detail.file));
    const t0 = performance.now();
    const curve = coverCurve(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), new Uint8Array(d.buffer, d.byteOffset, d.byteLength), man.base.size, man.detail.size, CLOUD_MARCH);
    ok(JSON.stringify(curve) === JSON.stringify(man.cover), `coverCurve from cloudMath.ts, over the converted volumes, gives the noise manifest's own curve to the bit (${curve.length} cuts, ${Math.round(performance.now() - t0)} ms)`);
  } else note(`no noise volumes under ${root}: the manifest's curve is not held this run`);
}

// --- 4. status asks for clouds --no-noise while a world's file lacks the numbers, and nothing once it has them ---
{
  const dir = mkdtempSync(join(tmpdir(), 'swg3js-clouds-status-'));
  try {
    fixtureWorld(dir, 'tatooine');
    // The September's file as the old converter wrote it, and noise volumes as status checks for them.
    writeFileSync(join(dir, 'tatooine', 'clouds.json'), JSON.stringify(measure(oldClouds, dir, 'tatooine'), null, 1));
    mkdirSync(join(dir, 'clouds'), { recursive: true });
    writeFileSync(join(dir, 'clouds', 'noise_base.rgba'), new Uint8Array(4));
    writeFileSync(join(dir, 'clouds', 'noise_detail.rgba'), new Uint8Array(4));
    writeFileSync(join(dir, 'clouds', 'manifest.json'), JSON.stringify({ format: 2, source: 'invented', base: { size: 1, channels: 4, file: 'noise_base.rgba' }, detail: { size: 1, channels: 4, file: 'noise_detail.rgba' }, billow: { lo: 0.5, hi: 0.9 }, cover: [{ cut: 0.2, sky: 1 }, { cut: 0.9, sky: 0 }] }));
    const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
    const status = (): string => spawnSync(process.execPath, [cli, 'status', dir], { encoding: 'utf8', maxBuffer: 16 * 1048576, env: { ...process.env, SWG: '' } }).stdout ?? '';
    const before = status();
    ok(/swg -- clouds \S+ --no-noise/.test(before) && before.includes('no numbers for (tatooine)'), 'status asks for `clouds --no-noise` while a world\'s clouds.json lacks the pictures\' numbers');
    (newClouds.bakeClouds as (r: string, p: string[]) => unknown)(dir, ['tatooine']);
    const after = status();
    ok(!/swg -- clouds /.test(after) && after.includes("each picture's numbers read"), 'and nothing once it has them');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${checks} checks passed`);
