// The GPU port's pass 2, wave 6, maker C: city worlds and the planet maker's gaps (src/sky/look/generate.js, build.js).
// Recipe version 4 (the living world's 5) brings ring cities and the cities' own glint, soft cloud, soft edges, the colour picked by
// its hue and kept in its hue, a two-tone lace, red-rimmed smoke, a halo round glow specks, cracks that keep their colour, and a gas
// giant's softer bands. Held here: every older version exactly as the base had it (its dial lists and every preset's look, hashed
// from 1b2a6c6 by the maker's `basehash.mjs`), every new dial nothing at its start, the ring cities' places (pure, apart, within
// their arrays), the twins moved to the new version carried by their old prints, and the bake's passes: what the warm asks for is
// what the bake draws, with soft edges too, and a look drawn sharp is baked without its rings.
//   node tools/swg/tests/ringCities.test.ts
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let checks = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++; console.log('ok  ', m); };
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const G: Any = await import('../../../src/sky/look/generate.js');
const P: Any = await import('../../../src/sky/look/placeholders.js');
const L: Any = await import('../../../src/sky/look/looks.js');
const h = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

// ---------------------------------------------------------------- 1. every older version as the base had it
{
  // recorded from 1b2a6c6 (a git archive of it, the maker's basehash.mjs): each recipe's dials at each version it had
  const BASE: Record<string, string> = {
    'gasgiant@1': '8208d185f45bfbea', 'gasgiant@2': '9792af981bc42bc6', 'gasgiant@3': '887ea7eababddcbe',
    'desert@1': '94638446b04923bb', 'desert@2': '5127a0aba1ff57b6', 'desert@3': 'fbb5a2ac5fcd604e',
    'ice@1': 'b813764475ef6dba', 'ice@2': 'b6433461b5a87bb9', 'ice@3': '07fb67553bb8feb5',
    'volcanic@1': '2f14ece4f75ebf6b', 'volcanic@2': '05490f9a7959d58c', 'volcanic@3': '07ff0d18486ec513',
    'terran@1': 'df5535c90dc8f8d9', 'terran@2': '43fa78243619b59b', 'terran@3': '55cfe14b61f24e1e',
    'moon@1': '30175c3b49483f11', 'moon@2': '109ddb4458e17343', 'moon@3': 'cf2c5faf8ff77942',
    'living@1': '3b5cb29a7c66f991', 'living@2': 'adbff1f770e2108a', 'living@3': 'a33d7617bca0a5be', 'living@4': 'de253ef0a48243f7',
    'molten@1': '4a0eb3162aab9b02', 'molten@2': 'ca3ba72c725d6011', 'molten@3': '9882c2947995e6e6',
    'flats@1': '5e0db2506cc222e5', 'flats@2': 'abd67685052f6682', 'flats@3': '1d0865c85fa2ec41',
    'cityworld@1': '34792c7748620fb4', 'cityworld@2': '2a4e888847587132', 'cityworld@3': '3c12709b24a71f8f',
  };
  const moved = Object.entries(BASE).filter(([k, v]) => { const [r, n] = k.split('@'); return h(G.dialsOf(r, +n)) !== v; }).map(([k]) => k);
  ok(moved.length === 0, `every recipe's dials at every older version are the base's, to the hash (${Object.keys(BASE).length} lists${moved.length ? '; moved: ' + moved.join(', ') : ''})`);
  // every preset's look as the base's table made it, but the twins this wave moved (three by its maker, seven more by its critic)
  // and the one preset it added
  const MOVED = ['twin-rori', 'twin-yavin4', 'twin-sullust', 'twin-kamino', 'twin-tatooine', 'twin-geonosis', 'twin-kashyyyk', 'twin-bespin', 'twin-jakku', 'twin-pillio'];
  const ids = Object.keys(G.PRESETS).filter((id) => !['w-coruscant-rings', ...MOVED].includes(id)).sort();
  // (the hash made by 1b2a6c6's own generate.js over this very set, the critic's basehash2.mjs; over the maker's set of 76 it was
  // 670e55d64c4867ae, which the base gives too)
  ok(h(ids.map((id) => [id, G.presetLook(id)])) === '782ecdfed4c38de7', `every other preset's look is the base's, to the hash (${ids.length} presets)`);
  ok(G.recipeVersion('cityworld') === 4 && G.recipeVersion('gasgiant') === 4 && G.recipeVersion('living') === 5 && G.ringsVersion('living') === 5 && G.ringsVersion('desert') === 4,
    "version 4 is every recipe's newest, the living world's 5");
}

// ---------------------------------------------------------------- 2. the new dials: at the new version alone, each nothing at its start
{
  const none: Record<string, unknown> = {
    ringCity: 0, glintCity: 0, cloudSoft: 0, cloudHaze: 0, softEdges: 0, gradeHold: 0, gradePickTurn: 0, gradePickStrength: 1,
    laceGround: 0, laceTwoTone: 0, mottleRim: 0, starKeep: 0, speckHalo: 0, bandSoft: 0, moreColours: 0,
  };
  for (const r of G.RECIPE_ORDER) {
    const v = G.ringsVersion(r);
    const before = G.dialsOf(r, v - 1), after = G.dialsOf(r, v);
    const added = after.filter((d: Any) => !before.some((b: Any) => b.k === d.k));
    ok(before.every((b: Any) => after.some((d: Any) => d.k === b.k && d.def === b.def)) && added.every((d: Any) => G.sinceOf(d, r) === v),
      `${r}: version ${v} keeps every dial of ${v - 1} at its start and adds ${added.length}, each of version ${v}`);
    const off = added.filter((d: Any) => d.k in none && d.def !== none[d.k]);
    ok(off.length === 0 && added.some((d: Any) => d.k === 'softEdges') && (!!G.RECIPES[r].lights === added.some((d: Any) => d.k === 'ringCity')),
      `${r}: every part it adds is none at its start (the ring cities only where the recipe grows cities)`);
    // a look of the new version with every new dial at its start carries nothing new: no rings, no extra channel (but a whole-planet city's metal)
    const gen = G.cleanGenerated({ recipe: r, version: v, seed: 5, dials: {} });
    const ex = G.extraChannels(gen);
    ok(!G.ringsOn(gen) && (r === 'cityworld' ? ex && ex.metal === true : !ex || !ex.metal), `${r}: at its starts no ring cities, ${r === 'cityworld' ? 'its built-up metal for the glint' : 'no metal channel'}`);
    // an older version never has a new dial, whatever its dials say
    const old = G.cleanGenerated({ recipe: r, version: v - 1, seed: 5, dials: { ringCity: 1, softEdges: 1, glintCity: 1 } });
    ok(!('ringCity' in old.dials) && !('softEdges' in old.dials) && !G.ringsOn(old) && !G.metalOn(old), `${r}: a look of version ${v - 1} holds none of them and stays as it was`);
  }
}

// ---------------------------------------------------------------- 3. the ring cities' places
{
  const look = G.presetLook('w-coruscant-rings');
  const gen = G.cleanGenerated(look.generated);
  const S = G.ringSitesOf(gen);
  ok(G.ringsOn(gen) && G.ringsSharp(gen) && G.metalOn(gen) && S.sites.length > 12 && S.sites.length <= G.MAX_RING_SITES && S.trunks.length > 8 && S.trunks.length <= G.MAX_RING_TRUNKS,
    `the ring preset's cities: ${S.sites.length} sites (${S.meta.filter((m: number[]) => m[3] === 0).length} great hubs), ${S.trunks.length} trunk lines, within the arrays`);
  ok(JSON.stringify(G.ringSitesOf(gen)) === JSON.stringify(S), 'the same look gives the same cities (pure, seeded)');
  const ang = (a: number[], b: number[]) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  const R = (s: number[]) => 2 * Math.asin(s[3] / 2);
  let apart = true;
  for (let i = 0; i < S.sites.length; i++) for (let j = i + 1; j < S.sites.length; j++) if (ang(S.sites[i], S.sites[j]) <= R(S.sites[i]) + R(S.sites[j])) apart = false;
  ok(apart, 'no two sites overlap (a point of the globe is one city\'s, so the material looks at one site a pixel)');
  ok(S.sites.every((s: number[]) => Math.abs(Math.hypot(s[0], s[1], s[2]) - 1) < 1e-9) && S.trunks.every((t: number[]) => Math.abs(Math.hypot(t[0], t[1], t[2]) - 1) < 1e-9 && t[3] > 0 && t[3] < 1),
    'every centre and every trunk line\'s pole is a unit direction, every line shorter than half the globe');
  for (const lay of [1, 2]) ok(JSON.stringify(G.ringSitesOf({ ...gen, dials: { ...gen.dials, ringLayout: lay } }).sites) === JSON.stringify(S.sites), `layout ${lay} stands its cities where layout 0 does`);
  const off = G.ringSitesOf({ ...gen, dials: { ...gen.dials, ringCity: 0 } });
  ok(off.sites.length === 0 && off.trunks.length === 0, 'with the ring cities at 0 there are none');
  const few = G.ringSitesOf({ ...gen, dials: { ...gen.dials, ringTrunks: 0, ringSatellites: 0 } });
  ok(few.trunks.length === 0 && few.meta.every((m: number[]) => m[3] === 0), 'no trunk lines at 0, no satellites at 0');
}

// ---------------------------------------------------------------- 4. the twins moved to the new version: their old prints carried
{
  // (the base's table's look of each, with its air and without, made by 1b2a6c6's own modules: prints.mjs in the critic's scratch)
  const BASE_PRINTS: Record<string, [string, string]> = { 'generated:twin-rori': ['43536945', '3f1cedf9'], 'generated:twin-yavin4': ['77546fc1', '5e18bbe6'], 'generated:twin-sullust': ['6686ab11', '73073665'],
    'generated:twin-kamino': ['7ff1f510', '237459e0'], 'generated:twin-tatooine': ['f887d80c', 'd8b0cb90'], 'generated:twin-geonosis': ['3bfba92f', '0053cd9a'],
    'generated:twin-kashyyyk': ['bbe420b3', 'f72195a6'], 'generated:twin-bespin': ['ce934236', '937650f3'], 'generated:twin-jakku': ['c0ad2ae5', '34fd4707'],
    'generated:twin-pillio': ['2e1e28ab', '7803870c'] };
  for (const [id, [a, b]] of Object.entries(BASE_PRINTS)) {
    const now = L.makeLook(G.presetLook(id.slice('generated:'.length)));
    ok(P.TWIN_PAST_PRINTS[id].includes(a) && P.TWIN_PAST_PRINTS[id].includes(b) && P.placeholderPrint(now) !== a && now.generated.version === G.ringsVersion(now.generated.recipe),
      `${id} moved to version ${now.generated.version}: the base's look (with its air and without) is one of its past prints, so his unchanged copy takes the new one`);
  }
  // (the fixer of wave 6, the checker's finding) each moved twin asked at the version it stood at or older keeps the dials it had
  // there (an older look lacking a dial is filled, and a dial reset, from them): every one of them, at every such version, the
  // base's to the hash (1b2a6c6's own `presetDials` out of a copy of its module: `pasthash.mjs` in the fixer's scratch)
  const was: Record<string, number> = { 'twin-tatooine': 2, 'twin-jakku': 2, 'twin-geonosis': 2, 'twin-bespin': 2, 'twin-sullust': 3, 'twin-kashyyyk': 3, 'twin-yavin4': 3, 'twin-kamino': 3, 'twin-rori': 3, 'twin-pillio': 3 };
  const past = Object.entries(was).map(([id, w]) => {
    const r: unknown[] = [];
    for (let v = 1; v <= w; v++) r.push([id, v, G.presetDials(id, v)]);
    return r;
  });
  ok(h(past) === 'f485349621fb57ee', `the ten moved twins' dials at every older version are the base's (${h(past)})`);
  ok(Object.keys(was).every((id) => (G.PRESETS[id].version || 1) > was[id]) && G.presetDials('twin-kamino').cloudSoft !== undefined, 'while at their own new version they take the new tuning');
}

// ---------------------------------------------------------------- 5. the bake: the warm asks for what the bake draws; sharp rings left out of it
{
  const THREE: Any = await import('three/webgpu');
  const asked: Any[] = [], drawn: Any[] = [];
  const stand = {
    rt: null as unknown,
    getRenderTarget() { return this.rt; },
    setRenderTarget(t: unknown) { this.rt = t; },
    compileAsync(q: Any) { asked.push({ mat: q.material, rt: this.rt }); return Promise.resolve(); },
    render(q: Any) { drawn.push({ mat: q.material, rt: this.rt }); },
    readRenderTargetPixelsAsync: async () => new Uint8Array(4),
  };
  const gen = { ...G.presetLook('w-coruscant-rings').generated, size: 1024 };
  gen.dials = { ...gen.dials, softEdges: 0.5 };
  const set = new G.GeneratedSet(1024);
  await set.warm(stand, gen, { withClouds: true, again: true });
  await set.bake(stand, gen, { withClouds: true, ringless: true });
  ok(asked.length === 6 && drawn.length === 6, `a ring city with soft edges bakes six passes (height, its metal, its colour into the soft picture, the soft pass, relief, clouds): asked ${asked.length}, drawn ${drawn.length}`);
  ok(drawn.every((d, i) => d.mat === asked[i].mat && d.rt === asked[i].rt), 'each pass is drawn with the very material, into the very target, the warm asked it against');
  ok(drawn[2].rt !== set.surface && drawn[3].rt === set.surface && drawn[1].rt === set.more, "the colour goes into the soft picture and the soft pass into the surface; the metal into the extra channels");
  ok(set.rings && set.rings.counts.value.x === G.ringSitesOf(G.cleanGenerated(gen)).sites.length && set.rings.plate.value.w === 0,
    'the set keeps the ring cities\' numbers for its material, marked as not baked (the material lays them)');
  await set.bake(stand, gen, { withClouds: true });
  ok(set.rings.plate.value.w === 1, 'baked for a picture (the map\'s globes, a disc), the rings go into it');
  set.dispose();
  void THREE;
}

// ---------------------------------------------------------------- 6. the material: only what the new version asks, by its own rules
{
  const b = readFileSync(join(REPO, 'src', 'sky', 'look', 'build.js'), 'utf8');
  ok(/const RS = !!\(G\.rings && ringsSharp\(gen\)\);/.test(b) && /if \(G\.more && metalOn\(gen\)\) \{/.test(b), "the material draws the rings only for a look that draws them sharp, and the cities' glint only for a look that carries their metal");
  ok(/const Rv = Fn\(\(\) => \{ const R = ringLayer\(dir, RU, ringLayoutOf\(gen\)\);/.test(b), "the rings' loops run inside a function of their own (statements outside one are dropped: one site drawn), one layout's arithmetic a program");
  ok(/const ringsKey = \(g\) => \(\(\+g\.version \|\| 1\) >= ringsVersion\(g\.recipe\) \?/.test(b) && /\$\{ringsOn\(g\) \? 'L' \+ ringLayoutOf\(g\) : ''\}/.test(b), "an older look's material key gains nothing; a ring city's names its layout (a new layout builds anew)");
  ok(/await set\.bake\(bakeRenderer, gen, \{ withClouds, ringless: ringsSharp\(gen\) \}\);/.test(b), 'a look drawn sharp is baked without its rings');
}

console.log(`\nringCities: ${checks} checks passed`);
