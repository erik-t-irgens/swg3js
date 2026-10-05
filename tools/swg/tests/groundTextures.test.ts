// The ground's pictures as the terrain command writes them (terrain shaders version 4): every alternate of
// every family with its weight, the bump map's height kept in the gloss map's green, the client's three
// border masks and its cloud tile, and the colour ramps with the world's brightness reference.
//
// Every check below that touches the archives is of what was written: the PNGs and the JSON a run of the
// converter's own writers (`tools/swg/terrainShaders.mjs`, the very code the terrain command runs) left on
// disk, decoded here and set against the archives' own pictures, decoded here too.
//
//   1. by hand: the child the version-3 fields carry, a mask as grey, the ramp file's reference written and
//      read back, and what `status` makes of each shape a pack's ground can be in
//   2. with the client's archives (SWG): the writers run over five worlds' terrain files into a folder of
//      their own -- Tatooine, Dathomir (where five families list an alternate first that is not the
//      heaviest), Kashyyyk's hunting grounds (thirteen shaders with a bump map and no gloss, and shaders
//      with neither), Kashyyyk's Rryatt trail (black but for a fifth of itself, so the reference's leaving
//      black places out decides its value) and dungeon1 (black everywhere, so no reference at all) -- and
//      every child the archives hold required written and every picture compared texel for texel: each
//      child's colour, bump map and gloss against its DDS after the same box filter, the height channel
//      against the bump map's alpha, each mask against its DDS's alpha, the masks' shared edge profile, the
//      cloud tile; the family list's order, its children and weights and each child's MATL colour against the
//      file's own bytes; the version-3 fields against the child an older converter drew; every ramp against
//      its TGA; the brightness reference worked out again from the whole map's 64 m grid, luminance and each
//      channel, and set beside the world's own blocks of 2 m poles sampled apart; and a file an older run left
//      in the folder gone
//   3. with converted packs at version 4 (SWG3JS_PACKS, else assets-private): the same of the packs on disk
//
// Run: node tools/swg/tests/groundTextures.test.ts
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachBitmap, attachRamp, bitmapFiles, colorRampFile, parseTerrainTemplate, rampNames, readColorRampFile, readColorReference, TerrainSampler, type TerrainTemplate } from '../../../src/swg/terrain/trn.ts';
import { decodeDds } from '../dds.mjs';
import { findAll, parseIff } from '../iff.mjs';
import { decodePng } from '../png.mjs';
import { shaderTextures } from '../sht.mjs';
import { decodeTga } from '../tga.mjs';
import { COLOR_RAMPS, GROUND_CLOUDS, GROUND_MASKS, REFERENCE_STEP, TERRAIN_SHADERS_VERSION, alphaAsGrey, downscaleRgba, groundShaderPath, groundStatus, primaryChild, writeColorRamps, writeGroundTextures, writeTerrainBitmaps } from '../terrainShaders.mjs';
import { mountRetail, PACKS, type Img, type Vfs } from './materialsHarness.ts';
import { RandomGenerator } from '../../../src/swg/terrain/fractal.ts';
import { rampFromArchives } from './terrainHarness.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string) => console.log(`note ${s}`);

// ---------------------------------------------------------------- 1. by hand

{
  const kids = (...w: number[]) => w.map((weight, i) => ({ name: `c${i}`, weight }));
  ok(primaryChild(kids(1, 1, 1)) === 0 && primaryChild(kids(0.8, 1)) === 1 && primaryChild(kids(0.5, 2, 1.5, 2)) === 1 && primaryChild([]) === -1, 'the version-3 fields carry the heaviest child, the first of the heaviest where two weigh the same (what a stable sort by weight picked), and nothing for no children');
  const g = alphaAsGrey({ width: 2, height: 1, rgba: Uint8Array.from([9, 9, 9, 17, 200, 0, 0, 238]) });
  ok([...g.rgba].join() === '17,17,17,255,238,238,238,255', 'a mask is its alpha in every colour channel, opaque, so a 2D canvas cannot premultiply it away');

  const ramp = { width: 2, rgb: Uint8Array.from([1, 2, 3, 4, 5, 6]) };
  const reference = { step: 64, points: 9, nonBlack: 8, luminance: 0.5746, rgb: [0.6314, 0.5647, 0.5176] as [number, number, number] };
  const json = JSON.parse(JSON.stringify(colorRampFile(new Map([['colorramp/a.tga', ramp]]), reference)));
  ok(readColorRampFile(json).get('colorramp/a.tga')?.rgb.join() === '1,2,3,4,5,6' && JSON.stringify(readColorReference(json)) === JSON.stringify(reference), "the ramp file carries the world's brightness reference beside its ramps, and both read back as written");
  ok(!('reference' in colorRampFile(new Map([['colorramp/a.tga', ramp]]))), 'a file written with no reference has no such key, the shape the game has read since the colour map was ported');
  ok(readColorReference({ ramps: {} }) === null && readColorReference({ reference: { ...reference, luminance: 2 } }) === null && readColorReference({ reference: { ...reference, nonBlack: 10 } }) === null && readColorReference(null) === null, 'a reference out of range, one counting more places than were sampled, or none at all reads as none');

  const fam = (over: Record<string, unknown> = {}) => ({ id: 1, name: 'sand', file: 'terrain/shaders/sand.png', normal: 'n.png', specular: 's.png', ...over });
  ok(groundStatus('tatooine', null, null).why === 'tatooine has no ground textures', 'status: a pack with no ground textures asks for the terrain');
  ok(/bump and gloss/.test(groundStatus('tatooine', { version: 2, families: [fam()] }, null).why ?? '') && /FLAT/.test(groundStatus('tatooine', { version: 2, families: [fam()] }, null).line), 'a version-2 pack is asked for again for its bump and gloss maps');
  const v3 = groundStatus('tatooine', { version: 3, families: [fam()] }, null);
  ok(/alternates/.test(v3.why ?? '') && /ONE PICTURE A FAMILY/.test(v3.line), `a version-3 pack is asked for again for its alternates, masks and colour ramps (${v3.why})`);
  const children = [{ shader: 'a', weight: 1, file: 'a.png', normal: 'a_n.png', specular: 'a_s.png' }, { shader: 'b', weight: 1, file: 'b.png', normal: null, specular: null }];
  const v4 = { version: TERRAIN_SHADERS_VERSION, families: [fam({ children })], blend: { quarter: 'q', half: 'h', threequarter: null } };
  ok(/colour ramps/.test(groundStatus('tatooine', v4, null).why ?? ''), `a version-${TERRAIN_SHADERS_VERSION} pack with no colour ramp file is asked for again`);
  const done = groundStatus('tatooine', v4, { ramps: { 'colorramp/a.tga': { width: 1, rgb: [1, 2, 3] } }, reference });
  ok(done.why === null && /2 pictures, alternates in 1 families, 1 bumped/.test(done.line) && /2\/3 border masks/.test(done.line) && /1 colour ramps, brightness 0\.5746/.test(done.line), `and one with its ramps is not, and says what it holds (${done.line})`);
}

// ---------------------------------------------------------------- the checks a written ground answers to

/** A PNG on disk, decoded; null where it is not there or does not decode. */
const png = (dir: string, rel: string | null | undefined): Img | null => (rel && existsSync(join(dir, rel)) ? (decodePng(readFileSync(join(dir, rel))) as Img | null) : null);
const dds = (vfs: Vfs, path: string) => downscaleRgba(decodeDds(vfs.read(path)), 512) as Img;
/** The MATL's specular colour read straight off the shader's bytes: the fourth ARGB group, floats 13 to 15, the MAIN-tagged material's where there are several. */
function matlColour(root: any): number[] | null {
  for (const mats of findAll(root, 'MATS')) {
    const tags = findAll(mats, 'TAG ');
    const list = findAll(mats, 'MATL');
    let first: number[] | null = null;
    for (let i = 0; i < list.length; i++) {
      const b = list[i].data as Buffer;
      if (!b || b.length < 68) continue;
      const c = [13, 14, 15].map((k) => Math.round(b.readFloatLE(k * 4) * 1e4) / 1e4);
      const tag = tags[i]?.data ? Buffer.from(tags[i].data.subarray(0, 4)).reverse().toString('latin1') : null;
      if (tag === 'MAIN') return c;
      first ??= c;
    }
    if (first) return first;
  }
  return null;
}

interface Tally { pictures: number; bumps: number; glosses: number; heights: number; noGloss: number; noBump: number; worst: number; off: string[] }

/**
 * A terrain freshly parsed with the bitmaps the pack in `dir` carries and the ramps decoded here from the
 * archives' own TGAs, attached the way the game attaches them: what the reference is checked against,
 * owing nothing to the ramp file it checks.
 */
function planetOf(trn: Uint8Array, dir: string, vfs: Vfs): TerrainTemplate {
  const planet = parseTerrainTemplate(trn);
  for (const b of bitmapFiles(planet)) if (existsSync(join(dir, b.file))) attachBitmap(planet, b.familyId, new Uint8Array(readFileSync(join(dir, b.file))));
  for (const key of rampNames(planet)) {
    const r = rampFromArchives(vfs, key);
    if (r) attachRamp(planet, key, r.ramp);
  }
  return planet;
}

/**
 * Everything one written ground answers to, against the archives: its family list, every child's three
 * pictures, the version-3 fields, the masks, the cloud tile, the ramps and the reference. `planet` is the
 * terrain the archives hold for it, freshly parsed; a pack's own list may carry families its building
 * layers added after the planet's. Returns how many children name a shader or a texture the archives do
 * not hold, which therefore have no pictures.
 */
function checkGround(label: string, dir: string, vfs: Vfs, planet: TerrainTemplate, tally: Tally): number {
  const shaders = JSON.parse(readFileSync(join(dir, 'terrain/shaders.json'), 'utf8'));
  ok(shaders.version === TERRAIN_SHADERS_VERSION, `${label}: terrain/shaders.json says version ${TERRAIN_SHADERS_VERSION}`);
  const own = [...planet.generator.shaderGroup.families.values()];
  const listed = shaders.families as any[];
  const orderRight = own.every((f, i) => listed[i]?.id === f.id && listed[i]?.name === f.name && listed[i]?.priority === i);
  const extraRight = listed.slice(own.length).every((f, k) => f.priority === own.length + k);
  ok(orderRight && extraRight, `${label}: the ${own.length} families stand in the order the terrain's family list gives them, each with its place in it as its priority${listed.length > own.length ? `, and the ${listed.length - own.length} its building layers add after them` : ''}`);
  const kidsRight = own.every((f, i) => listed[i].children.length === f.children.length && f.children.every((c, k) => listed[i].children[k].shader === c.name.replace(/\\/g, '/') && listed[i].children[k].weight === c.weight));
  ok(kidsRight, `${label}: every family lists every child in the file's own order with its own weight (${listed.reduce((a, f) => a + f.children.length, 0)} children)`);

  // The version-3 fields: the child the converter drew every family with before (the heaviest, by a stable sort).
  let v3Wrong = 0;
  let notFirst = 0;
  for (const f of listed) {
    if (!f.children.length) continue;
    const before = f.children.indexOf([...f.children].sort((a: any, b: any) => b.weight - a.weight)[0]);
    const p = f.children[f.primary];
    if (f.primary !== before || !['shader', 'texture', 'file', 'normal', 'specular'].every((k) => (f[k] ?? null) === (p[k] ?? null)) || JSON.stringify(f.specularColor) !== JSON.stringify(p.specularColor)) v3Wrong++;
    if (f.primary !== 0) notFirst++;
  }
  ok(v3Wrong === 0, `${label}: every family's version-3 fields are its heaviest child's own, the very child an older converter drew it with (${notFirst} where that is not the first listed)`);

  // Every child whose shader the archives hold with its colour texture has its pictures written; one whose shader
  // or texture is not there has none, and is counted. A child skipped quietly would otherwise drop out of every
  // check below, since they compare what was written.
  const mainOf = new Map<string, string | null>();
  let unresolved = 0;
  for (const f of listed) {
    for (const c of f.children) {
      const path = groundShaderPath(vfs, c.shader);
      if (path && !mainOf.has(path)) {
        const m = shaderTextures(parseIff(vfs.read(path))).main;
        mainOf.set(path, m && vfs.has(m) ? m : null);
      }
      const main = path ? mainOf.get(path) : null;
      if (!main) {
        unresolved++;
        if (c.file) tally.off.push(`${label} ${c.shader}: written although its shader or its texture is not in the archives`);
      } else if (!c.file) tally.off.push(`${label} ${c.shader}: in the archives with its texture ${main} and not written`);
    }
  }

  // Every child's pictures against the archives' own.
  const seen = new Set<string>();
  for (const f of listed) {
    for (const c of f.children) {
      const path = groundShaderPath(vfs, c.shader);
      if (!path || !c.file) continue;
      const key = `${path}|${c.file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const root = parseIff(vfs.read(path));
      const { main, slots } = shaderTextures(root);
      const want = dds(vfs, main);
      const got = png(dir, c.file);
      tally.pictures++;
      const bad = (what: string) => tally.off.push(`${label} ${path} ${what}`);
      if (!got || got.width !== want.width || got.height !== want.height) bad('colour missing or of another size');
      else for (let i = 0; i < want.rgba.length; i += 4) if (got.rgba[i] !== want.rgba[i] || got.rgba[i + 1] !== want.rgba[i + 1] || got.rgba[i + 2] !== want.rgba[i + 2] || got.rgba[i + 3] !== 255) { bad(`colour differs at texel ${i / 4}`); break; }
      if (JSON.stringify(c.specularColor) !== JSON.stringify(matlColour(root))) bad(`specular colour ${JSON.stringify(c.specularColor)} against the MATL's ${JSON.stringify(matlColour(root))}`);
      const nrml = slots.find((s: any) => s.slot === 'NRML');
      const cnrm = slots.find((s: any) => s.slot === 'CNRM' || s.slot === 'DOT3');
      if (cnrm) bad(`a ${cnrm.slot} slot, which no retail ground shader has and this test does not decode`);
      const aux = slots.find((s: any) => s.slot === 'AUX0');
      const bump = nrml && vfs.has(nrml.path) ? dds(vfs, nrml.path) : null;
      const shine = aux && vfs.has(aux.path) ? dds(vfs, aux.path) : null;
      if (!bump) tally.noBump++;
      if (!shine) tally.noGloss++;
      if (bump) {
        tally.bumps++;
        const n = png(dir, c.normal);
        if (!n || n.width !== bump.width) bad('bump map missing or of another size');
        else for (let i = 0; i < bump.rgba.length; i += 4) if (n.rgba[i] !== bump.rgba[i] || n.rgba[i + 1] !== bump.rgba[i + 1] || n.rgba[i + 2] !== bump.rgba[i + 2] || n.rgba[i + 3] !== 255) { bad(`bump map differs at texel ${i / 4}`); break; }
      } else if (c.normal) bad('a bump map written for a shader with none');
      if (bump || shine) {
        const s = png(dir, c.specular);
        const ref = shine ?? bump!;
        if (!s || s.width !== ref.width || s.height !== ref.height) bad('gloss missing or of another size');
        else {
          if (shine) tally.glosses++;
          if (bump) tally.heights++;
          for (let i = 0; i < ref.rgba.length; i += 4) {
            const mask = shine ? shine.rgba[i] : 0;
            const height = bump ? bump.rgba[i + 3] : 128;
            tally.worst = Math.max(tally.worst, Math.abs(s.rgba[i] - mask), Math.abs(s.rgba[i + 1] - height));
            if (s.rgba[i] !== mask || s.rgba[i + 2] !== mask || s.rgba[i + 1] !== height || s.rgba[i + 3] !== 255) {
              bad(`gloss differs at texel ${i / 4} (${s.rgba[i]},${s.rgba[i + 1]},${s.rgba[i + 2]} against mask ${mask}, height ${height})`);
              break;
            }
          }
        }
      } else if (c.specular) bad('a gloss written for a shader with neither a gloss nor a bump map');
    }
  }

  // The masks and the cloud tile, each against its texture's alpha.
  const masks: Record<string, Img> = {};
  for (const [key, m] of Object.entries(GROUND_MASKS)) {
    const tex = shaderTextures(parseIff(vfs.read(m.shader))).main;
    const want = decodeDds(vfs.read(tex)) as Img;
    const got = png(dir, shaders.blend?.[key]);
    let same = !!got && got.width === want.width && got.height === want.height && shaders.blend[key] === m.file;
    for (let i = 0; same && i < want.rgba.length; i += 4) same = got!.rgba[i] === want.rgba[i + 3] && got!.rgba[i + 1] === want.rgba[i + 3] && got!.rgba[i + 2] === want.rgba[i + 3] && got!.rgba[i + 3] === 255;
    ok(same, `${label}: the ${key} border mask (${m.file}) is ${tex}'s alpha as grey, texel for texel (${want.width} x ${want.height})`);
    if (got) masks[key] = got;
  }
  if (masks.quarter && masks.half && masks.threequarter) {
    // The edge each shape's covered corner falls along: the quarter's and the half's top rows, the three
    // quarters' right column. The masks' alpha is four bits (steps of 17), so a sample is held within one step
    // of the profile, and the whole edge within five levels on average of the half's top row, the research's own
    // measure of how closely the shapes meet (1.1 to 4.4).
    const PROFILE = [255, 238, 204, 187, 153, 85, 51, 17];
    const W = masks.half.width;
    const edges: Record<string, (i: number) => number> = {
      quarter: (i) => masks.quarter.rgba[i * 4],
      half: (i) => masks.half.rgba[i * 4],
      threequarter: (i) => masks.threequarter.rgba[(i * W + W - 1) * 4],
    };
    for (const [key, at] of Object.entries(edges)) {
      const samples = PROFILE.map((_, k) => at(k * 32));
      let mad = 0;
      for (let i = 0; i < W; i++) mad += Math.abs(at(i) - edges.half(i));
      mad /= W;
      ok(samples.every((v, k) => Math.abs(v - PROFILE[k]) <= 17) && mad <= 5, `${label}: the ${key} mask's edge falls through the shared profile every 32 px (${samples.join(' ')}) and meets the half's along its whole length within ${mad.toFixed(1)} levels`);
    }
  }
  const cloudTex = shaderTextures(parseIff(vfs.read(GROUND_CLOUDS.shader))).main;
  const cloudWant = decodeDds(vfs.read(cloudTex)) as Img;
  const cloudGot = png(dir, shaders.clouds);
  let cloudSame = !!cloudGot && cloudGot.width === cloudWant.width && shaders.clouds === GROUND_CLOUDS.file;
  for (let i = 0; cloudSame && i < cloudWant.rgba.length; i += 4) cloudSame = cloudGot!.rgba[i] === cloudWant.rgba[i + 3] && cloudGot!.rgba[i + 3] === 255;
  ok(cloudSame, `${label}: the cloud tile (${GROUND_CLOUDS.file}) is ${cloudTex}'s alpha as grey, texel for texel`);

  // Nothing under terrain/shaders that the list does not name.
  const named = new Set<string>();
  for (const f of listed) for (const c of f.children) for (const k of ['file', 'normal', 'specular']) if (c[k]) named.add(c[k]);
  const onDisk = readdirSync(join(dir, 'terrain/shaders')).map((f) => `terrain/shaders/${f}`);
  ok(onDisk.every((f) => named.has(f)) && [...named].every((f) => onDisk.includes(f)), `${label}: terrain/shaders holds exactly the ${named.size} pictures the list names`);

  // The ramps, each against its TGA's first row, and every one the terrain names that the archives hold.
  const rampJson = JSON.parse(readFileSync(join(dir, COLOR_RAMPS), 'utf8'));
  const ramps = readColorRampFile(rampJson);
  const names = rampNames(planet);
  let rampsRight = names.length > 0 || ramps.size === 0;
  for (const key of names) {
    const r = ramps.get(key);
    if (!vfs.has(key)) {
      rampsRight &&= !r;
      continue;
    }
    const tga = decodeTga(vfs.read(key)) as { width: number; rgba: Uint8Array };
    rampsRight &&= !!r && r.width === tga.width && [...Array(tga.width)].every((_, x) => r.rgb[x * 3] === tga.rgba[x * 4] && r.rgb[x * 3 + 1] === tga.rgba[x * 4 + 1] && r.rgb[x * 3 + 2] === tga.rgba[x * 4 + 2]);
  }
  ok(rampsRight && ramps.size <= names.length, `${label}: every one of the ${names.length} ramps its colour affectors name is the first row of its TGA, pixel for pixel (${ramps.size} written)`);

  // The reference, worked out again here from what it is: the colour map at every multiple of 64 m inside the
  // map, as one grid, with the black places left out; the value at the middle of each sorted list (the upper of
  // the two where the count is even); luminance by Rec. 709 on the bytes as they stand. Held to the file to the
  // half unit in the fourth place it is written to, the luminance and each channel apart.
  const ref = readColorReference(rampJson);
  const step = REFERENCE_STEP;
  const half = planet.mapWidthInMeters / 2;
  const first = Math.ceil(-half / step) * step;
  const across = Math.floor(half / step) - Math.ceil(-half / step) + 1;
  const whole = new TerrainSampler(planet).generate(first, first, across, step).colors;
  const lums: number[] = [];
  const chans: number[][] = [[], [], []];
  for (let k = 0; k < across * across; k++) {
    const r = whole[k * 3], g = whole[k * 3 + 1], b = whole[k * 3 + 2];
    if (r === 0 && g === 0 && b === 0) continue;
    lums.push((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);
    chans[0].push(r / 255);
    chans[1].push(g / 255);
    chans[2].push(b / 255);
  }
  const middle = (list: number[]) => [...list].sort((a, b) => a - b)[list.length >> 1];
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.00005 + 1e-9;

  // And 128 of the world's own blocks of 2 m poles scattered over the whole map, sampled apart: fewer, and Yavin
  // 4's median wanders 0.06 from one seed to the next. The two never agree exactly, since a slope read across 64 m
  // is not one read across 2 m; measured over every retail world the gap is at most 0.038 (Kashyyyk's Rryatt trail,
  // black but for a fifth of itself).
  const sampler = new TerrainSampler(planet);
  const n = sampler.numberOfPoles;
  const lum: number[] = [];
  const draw = new RandomGenerator(777);
  for (let i = 0; i < 128; i++) {
    const x = (draw.randomReal() * 2 - 1) * half;
    const z = (draw.randomReal() * 2 - 1) * half;
    const st = sampler.blockStart(Math.floor(x / 64), Math.floor(z / 64));
    const grid = sampler.generate(st.x, st.z, n, sampler.poleStep);
    for (let k = 0; k < n * n; k += 7) {
      const r = grid.colors[k * 3], g = grid.colors[k * 3 + 1], bb = grid.colors[k * 3 + 2];
      if (r | g | bb) lum.push((0.2126 * r + 0.7152 * g + 0.0722 * bb) / 255);
    }
  }

  if (!lums.length) {
    ok(ref === null && rampJson.reference === null && lum.length === 0, `${label}: black at every one of the ${across * across} places of the 64 m grid and at every 2 m pole sampled, so its reference is null`);
    return unresolved;
  }
  const want = { luminance: middle(lums), rgb: chans.map(middle) };
  ok(
    !!ref && ref.step === step && ref.points === across * across && ref.nonBlack === lums.length && near(ref.luminance, want.luminance) && want.rgb.every((v, i) => near(ref.rgb[i], v)),
    `${label}: the brightness reference is the medians of the ${lums.length} places of ${across * across} on the whole map's 64 m grid that are not black, worked out again here: luminance ${ref?.luminance} (${want.luminance.toFixed(4)}), rgb ${ref?.rgb.join(', ')} (${want.rgb.map((v) => v.toFixed(4)).join(', ')})`,
  );
  const median = middle(lum);
  ok(lum.length > 0 && Math.abs(median - ref!.luminance) <= 0.045, `${label}: the reference's median luminance ${ref!.luminance} is within 0.045 of the median over 128 of the world's own blocks of 2 m poles, sampled apart (${median?.toFixed(4)})`);
  return unresolved;
}

// ---------------------------------------------------------------- 2. the converter's writers, run here

const vfs = (await mountRetail()) as Vfs | null;
if (!vfs) note('no SWG install on this machine (SWG in the environment or .env), so no ground is written or compared here');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'swg3js-ground-'));
  const tally: Tally = { pictures: 0, bumps: 0, glosses: 0, heights: 0, noGloss: 0, noBump: 0, worst: 0, off: [] };
  try {
    for (const world of ['tatooine', 'dathomir', 'kashyyyk_hunting', 'kashyyyk_rryatt_trail', 'dungeon1']) {
      const trn = `terrain/${world}.trn`;
      if (!vfs.has(trn)) {
        note(`${trn} is not in the archives here`);
        continue;
      }
      const dir = join(tmp, world);
      // A file an older run left behind, under the name the last version gave a family's picture.
      mkdirSync(join(dir, 'terrain/shaders'), { recursive: true });
      writeFileSync(join(dir, 'terrain/shaders/1_old_family.png'), 'x');
      const template = parseTerrainTemplate(new Uint8Array(vfs.read(trn)));
      const quiet = { log: () => {}, warn: () => {} };
      writeTerrainBitmaps(vfs, template, dir, quiet);
      const wrote = writeGroundTextures(vfs, template, dir, quiet);
      writeColorRamps(vfs, template, dir, quiet);
      ok(!existsSync(join(dir, 'terrain/shaders/1_old_family.png')), `${world}: a picture an older run left under terrain/shaders is taken away`);
      const unresolved = checkGround(world, dir, vfs, planetOf(new Uint8Array(vfs.read(trn)), dir, vfs), tally);
      // Measured over every retail world: every child names a shader the archives hold with its texture.
      ok(unresolved === 0 && wrote.missing === 0 && wrote.childTextures === wrote.children, `${world}: every one of its ${wrote.children} children names a shader the archives hold with its colour texture, and every one was written`);
    }
    ok(tally.off.length === 0, `every picture written is the archives' own: ${tally.pictures} children's colours, ${tally.bumps} bump maps, ${tally.glosses} gloss masks and ${tally.heights} heights, texel for texel${tally.off.length ? `; not: ${tally.off.slice(0, 5).join('; ')}` : ''}`);
    ok(tally.glosses > 0 && tally.heights > 0 && tally.noGloss > 0 && tally.noBump > 0, `the shapes a ground shader comes in were all among them: ${tally.noGloss} with no gloss of their own (nought in red, the height still kept) and ${tally.noBump} with no bump map at all`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // ---------------------------------------------------------------- 3. the packs on disk
  let checked = 0;
  const packTally: Tally = { pictures: 0, bumps: 0, glosses: 0, heights: 0, noGloss: 0, noBump: 0, worst: 0, off: [] };
  for (const world of existsSync(PACKS) ? readdirSync(PACKS).sort() : []) {
    const dir = join(PACKS, world);
    const file = join(dir, 'terrain/shaders.json');
    if (!existsSync(file) || !existsSync(join(dir, 'terrain.trn'))) continue;
    let version = 0;
    try {
      version = JSON.parse(readFileSync(file, 'utf8')).version ?? 1;
    } catch {
      /* read as old below */
    }
    if (version < TERRAIN_SHADERS_VERSION) {
      note(`${world} under ${PACKS} is terrain shaders version ${version}, older than ${TERRAIN_SHADERS_VERSION}: not read here (status asks for the terrain again)`);
      continue;
    }
    checkGround(`${world} (on disk)`, dir, vfs, planetOf(new Uint8Array(readFileSync(join(dir, 'terrain.trn'))), dir, vfs), packTally);
    checked++;
  }
  if (checked) ok(packTally.off.length === 0, `the ${checked} worlds on disk carry the archives' own pictures, ${packTally.pictures} children's colours texel for texel${packTally.off.length ? `; not: ${packTally.off.slice(0, 5).join('; ')}` : ''}`);
  else note(`no world under ${PACKS} is at terrain shaders version ${TERRAIN_SHADERS_VERSION} yet, so no pack on disk is read here`);
}

console.log(`\nground textures: ${passed} checks passed`);
