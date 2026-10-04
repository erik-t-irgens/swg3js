// What the wardrobe conversion writes for the colours (tools/swg/dye.mjs, the wardrobe case in cli.mjs), read
// back from the files themselves and never from what the converter decided: every dye recipe's images are
// decoded and run through the game's own renderer (src/player/texrender.ts) against the base picture its
// GLB embeds, the coverage each piece reports is counted again from the pixels written, every palette a
// piece names has a recipe that reads it, and every hairstyle's picture is decoded and looked at.
//
// First what `status` asks of a wardrobe folder, over made-up folders, which needs nothing on this machine.
// Then every wardrobe folder under assets-private (or the packs folder SWG3JS_PACKS names); a machine with
// none, or with folders converted before the colours, says so and checks the rest. A folder converted with
// --no-dye has its dye left unread and everything else read; one with --no-icons, its hair pictures.
//
// Run: node tools/swg/tests/dyeConvert.test.ts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DYE_FORMAT, DYE_PALETTE, DYE_PALETTE_COLOURS, DYE_VARIABLE, EXTRA_GARMENT_PALETTES, dyeCoverage } from '../dye.mjs';
import { readGlb } from '../glbclips.mjs';
import { decodePng } from '../png.mjs';
import { MATERIAL_FORMAT } from '../surface.mjs';
import { renderRecipe } from '../../../src/player/texrender.ts';
import { runPaintJob } from '../../../src/vehicles/paintJob.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string) => console.log(`note ${s}`);

type Img = { width: number; height: number; rgba: Uint8Array };
type Recipe = { mesh: string; material: string; invented?: string; glow?: { maskTag: string; channel: string; keepAlpha: boolean }; shader: { effect: string | null; passes: unknown[]; textures: Record<string, string>; palettes: { tag: string; palette: string; variable: string; private: boolean; default: number }[]; choices: unknown[] }; slots: unknown[] };
type Item = { id: string; kind: string; parts: { name: string; file: string }[]; icon?: string | null; colour?: string; dyeCover?: number; variables?: { name: string; kind: string; meshes?: string[] }[] };

// ---------------------------------------------------------------- what status asks

{
  const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'swg3js-dye-status-'));
  try {
    const folder = join(dir, 'wardrobe', 'human_male');
    mkdirSync(folder, { recursive: true });
    const wear = { id: 'shirt', kind: 'wearables', parts: [{ name: 'shirt_m_l0', file: 'shirt_m_l0.glb' }], slots: [['chest1']], name: 'A shirt', icon: 'icons/shirt.png', colour: 'dye', dyeCover: 0.9 };
    const hair = { id: 'hair_x', kind: 'hair', parts: [{ name: 'hair_m_l0', file: 'hair_m_l0.glb' }], slots: [['hair']], name: 'hair', icon: 'icons/hair_x.png', colour: 'palette' };
    const write = (w: object) => writeFileSync(join(folder, 'wardrobe.json'), JSON.stringify({ species: 'human_male', gender: 'm', materialFormat: MATERIAL_FORMAT, ...w }));
    const reasons = (): string => {
      const run = spawnSync(process.execPath, [cli, 'status', dir], { encoding: 'utf8', maxBuffer: 16 * 1048576 });
      const out = run.stdout ?? '';
      const at = out.indexOf('swg -- wardrobe ');
      return at < 0 ? '' : out.slice(at, out.indexOf('\n', out.indexOf('\n', at) + 1));
    };
    write({ items: [wear, hair] });
    ok(/before every garment could be coloured/.test(reasons()), 'status asks again for a wardrobe stamped before the dye');
    write({ dyeFormat: DYE_FORMAT, items: [{ ...wear, colour: 'none' }, hair] });
    ok(/no garment carrying a dye/.test(reasons()), 'and for one stamped but holding no dyed garment, the thing the new run must make');
    write({ dyeFormat: DYE_FORMAT, items: [wear, { ...hair, icon: null }] });
    ok(/no pictures of its hairstyles/.test(reasons()), 'and for one whose hairstyles have no pictures');
    write({ dyeFormat: DYE_FORMAT, items: [wear, hair] });
    ok(reasons() === '', 'and asks nothing of a whole one');
    write({ noDye: true, items: [{ ...wear, colour: 'none' }, hair] });
    ok(reasons() === '', 'nor of one converted with --no-dye');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- the packs

const root = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private/', import.meta.url));
const wardrobeRoot = join(root, 'wardrobe');
const folders = existsSync(wardrobeRoot) ? readdirSync(wardrobeRoot).filter((f) => existsSync(join(wardrobeRoot, f, 'wardrobe.json'))).sort() : [];
if (!folders.length) note(`no wardrobe folders under ${root}, so nothing converted is read here`);

/** The largest difference of any channel of any texel between two pictures; Infinity when one is missing or their sizes differ. */
const same = (a: Img | null, b: Img | null): number => {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return Infinity;
  let worst = 0;
  for (let i = 0; i < a.rgba.length; i++) worst = Math.max(worst, Math.abs(a.rgba[i] - b.rgba[i]));
  return worst;
};

/** sRGB byte to linear light, and back, as the converter's glow split works (surface.mjs). */
const toLinear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const toByte = (l: number): number => {
  const v = Math.min(1, Math.max(0, l));
  return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255);
};

/**
 * What a whole folder of the retail archives holds, as measured on the run that made it: the pieces whose palettes
 * the every-pass rule gives back, the pieces dyed, the dyed pieces named in the design, and the bakes whose glow is
 * split out of them. Each is a floor at the measured count with no slack, so a run that loses any of it fails here;
 * a folder converted with --match or --limit is not whole and is held to none of it.
 */
const WHOLE: Record<string, { items: number; back: number; dyed: number; named: string[]; glowing: number }> = {
  human_male: { items: 1300, back: 65, dyed: 230, named: ['armor_snowtrooper_chest_plate', 'robe_jedi_dark_s01'], glowing: 0 },
  human_female: { items: 1300, back: 65, dyed: 230, named: ['armor_snowtrooper_chest_plate', 'robe_jedi_dark_s01'], glowing: 0 },
  // The Ithorians' snowtrooper chest takes a palette of the game's; their dark robe is dyed.
  ithorian_male: { items: 500, back: 22, dyed: 79, named: ['robe_jedi_dark_s01'], glowing: 2 },
  ithorian_female: { items: 500, back: 22, dyed: 78, named: ['robe_jedi_dark_s01'], glowing: 2 },
};

for (const folder of folders) {
  const dir = join(wardrobeRoot, folder);
  const wardrobe = JSON.parse(readFileSync(join(dir, 'wardrobe.json'), 'utf8')) as { dyeFormat?: number; noDye?: boolean; items: Item[] };
  // A folder this run's code made: stamped with the dye, or stamped as left without it on purpose. Anything else
  // was converted before the colours, has none of what is read here and is asked for again by `status`.
  const dyed = (wardrobe.dyeFormat ?? 0) >= DYE_FORMAT;
  if (!dyed && !wardrobe.noDye) {
    note(`wardrobe/${folder} was converted before the colours (run the wardrobe again), so they are not read here`);
    continue;
  }
  if (!dyed) note(`wardrobe/${folder} was converted with --no-dye, so its dye is not read here; everything else is`);
  const want = WHOLE[folder];
  const whole = !!want && wardrobe.items.length >= want.items;
  const cz = JSON.parse(readFileSync(join(dir, 'customize.json'), 'utf8')) as { recipes: Recipe[]; palettes: Record<string, number[][]>; dye?: { variable: string; palette: string } };
  const decoded = new Map<string, Img | null>();
  const image = (f: string | null): Img | null => {
    if (!f) return null;
    if (!decoded.has(f)) decoded.set(f, decodePng(readFileSync(join(dir, 'customize', f))) as Img | null);
    return decoded.get(f)!;
  };
  // Every mesh's GLB, read once: its materials by name with the base and glow images it embeds.
  const fileOf = new Map<string, string>();
  for (const it of wardrobe.items) for (const p of it.parts ?? []) fileOf.set(p.name, p.file);
  type Embedded = { base: Img | null; emissive: Img | null; cutout: boolean };
  type GlbMaterial = { name: string; alphaMode?: string; pbrMetallicRoughness?: { baseColorTexture?: { index: number } }; emissiveTexture?: { index: number } };
  const glbs = new Map<string, Map<string, Embedded>>();
  const embedded = (mesh: string, material: string): Embedded | null => {
    if (!glbs.has(mesh)) {
      const { json, bin } = readGlb(readFileSync(join(dir, fileOf.get(mesh)!)));
      const pic = (index: number | undefined): Img | null => {
        const t = index === undefined ? null : json.textures?.[index];
        const im = t ? json.images?.[t.source] : null;
        if (!im) return null;
        const bv = json.bufferViews[im.bufferView];
        return decodePng(bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength)) as Img | null;
      };
      glbs.set(mesh, new Map((json.materials ?? []).map((m: GlbMaterial) => [m.name, { base: pic(m.pbrMetallicRoughness?.baseColorTexture?.index), emissive: pic(m.emissiveTexture?.index), cutout: m.alphaMode === 'MASK' }])));
    }
    return glbs.get(mesh)!.get(material) ?? null;
  };
  const dyeRecipes = cz.recipes.filter((r) => r.invented === 'dye');
  const dyedItems = wardrobe.items.filter((i) => i.colour === 'dye');
  const meshed = wardrobe.items.filter((i) => (i.parts ?? []).length);
  note(`wardrobe/${folder}: ${dyeRecipes.length} dye recipes on ${dyedItems.length} pieces; ${meshed.filter((i) => i.colour === 'palette').length} pieces take the game's own colours, ${meshed.filter((i) => i.colour === 'none').length} none${whole ? '' : '; not a whole folder, so held to no count'}`);

  // Our palette and the pack's word on it; the palettes kept beside the recipes' own.
  if (dyed) ok(JSON.stringify(cz.palettes[DYE_PALETTE]) === JSON.stringify(DYE_PALETTE_COLOURS) && cz.dye?.variable === DYE_VARIABLE && cz.dye?.palette === DYE_PALETTE, `wardrobe/${folder}: our palette is set after the archives' (one entry, alpha nought), and the pack says it is ours`);
  else ok(!cz.dye && !(DYE_PALETTE in cz.palettes) && !dyeRecipes.length && !dyedItems.length, `wardrobe/${folder}: converted with --no-dye, it carries no dye, no palette of ours and no word of one`);
  ok(EXTRA_GARMENT_PALETTES.every((p) => (cz.palettes[p]?.length ?? 0) > 0), `wardrobe/${folder}: the three garment palettes no piece names are kept beside the rest`);
  ok(!Object.keys(cz.palettes).some((p) => /^palette\/ui(_|\.)/.test(p)), `wardrobe/${folder}: and no interface palette is among them`);
  ok(meshed.every((i) => i.colour === 'palette' || i.colour === 'dye' || i.colour === 'none'), `wardrobe/${folder}: every piece says what colour it takes`);

  if (dyed) {
    // Dye off: at every index of our palette a dye recipe gives back the base its GLB embeds, byte for byte.
    {
      const off: string[] = [];
      for (const r of dyeRecipes) {
        const glb = embedded(r.mesh, r.material);
        const out = renderRecipe(r as never, new Map([[`${r.mesh}|${DYE_VARIABLE}`, 0]]), cz.palettes, image) as Img | null;
        const d = same(out, glb?.base ?? null);
        if (d > 0) off.push(`${r.mesh} ${r.material} (${d})`);
      }
      ok(off.length === 0, `wardrobe/${folder}: undyed, every one of the ${dyeRecipes.length} dye recipes renders exactly the base its GLB embeds${off.length ? `; not: ${off.slice(0, 4).join(', ')}` : ''}`);
    }

    // Dye on: only what the mask lets through changes, and a dyed piece comes out as a game palette piece of that
    // swatch would. In a whole folder the pieces named here must be there and dyed: they are the only real data a
    // dye is seen to move at all, so they cannot be allowed to drop out with a note.
    {
      const RED = [200, 30, 30, 255];
      const red = { ...cz.palettes, [DYE_PALETTE]: [RED] };
      const target = RED.slice(0, 3).map((c) => c * 0.58);
      let leaked = 0;
      for (const r of dyeRecipes.slice(0, 60)) {
        const before = renderRecipe(r as never, new Map(), cz.palettes, image) as Img;
        const after = renderRecipe(r as never, new Map(), red, image) as Img;
        const mask = image(r.shader.textures.DYEB)!;
        for (let i = 0; i < mask.width * mask.height; i++) if (mask.rgba[i * 4 + 3] === 0 && (after.rgba[i * 4] !== before.rgba[i * 4] || after.rgba[i * 4 + 1] !== before.rgba[i * 4 + 1] || after.rgba[i * 4 + 2] !== before.rgba[i * 4 + 2] || after.rgba[i * 4 + 3] !== before.rgba[i * 4 + 3])) leaked++;
      }
      ok(leaked === 0, `wardrobe/${folder}: dyed, no texel outside the mask moves (${Math.min(60, dyeRecipes.length)} recipes)`);
      for (const id of whole && want ? want.named : ['armor_snowtrooper_chest_plate', 'robe_jedi_dark_s01']) {
        const item = wardrobe.items.find((i) => i.id === id);
        if (!item || item.colour !== 'dye') {
          if (whole) ok(false, `wardrobe/${folder}: ${id} is there and dyed (${item ? `it takes ${item.colour}` : 'it is missing'})`);
          note(`wardrobe/${folder}: no dyed ${id} in this part of a folder`);
          continue;
        }
        const sum = [0, 0, 0];
        let weight = 0;
        for (const r of dyeRecipes.filter((x) => item.parts.some((p) => p.name === x.mesh))) {
          const after = renderRecipe(r as never, new Map(), red, image) as Img;
          const mask = image(r.shader.textures.DYEB)!;
          const glb = embedded(r.mesh, r.material);
          for (let i = 0; i < mask.width * mask.height; i++) {
            if (glb?.cutout && glb.base && glb.base.rgba[i * 4 + 3] < 128) continue;
            const m = mask.rgba[i * 4 + 3] / 255;
            for (let c = 0; c < 3; c++) sum[c] += m * after.rgba[i * 4 + c];
            weight += m;
          }
        }
        const mean = sum.map((s) => s / weight);
        ok(weight > 0 && mean.every((v, c) => Math.abs(v - target[c]) <= 12), `wardrobe/${folder}: ${id} dyed (200,30,30) comes out (${mean.map((v) => v.toFixed(0)).join(',')}) under its mask, within 12 of (${target.map((v) => v.toFixed(0)).join(',')})`);
      }
    }

    // Coverage: each dyed piece's figure, counted again from the dye images as written; and none under half.
    {
      const wrong: string[] = [];
      let min = 1;
      for (const item of dyedItems) {
        let shown = 0, covered = 0;
        const seen = new Set<string>();
        for (const r of dyeRecipes) {
          if (!item.parts.some((p) => p.name === r.mesh) || seen.has(`${r.mesh}|${r.material}`)) continue;
          seen.add(`${r.mesh}|${r.material}`);
          const glb = embedded(r.mesh, r.material)!;
          const c = dyeCoverage(image(r.shader.textures.DYEB)!, glb.base!, glb.cutout);
          shown += c.shown;
          covered += c.covered;
        }
        const cover = shown ? covered / shown : 0;
        if (Math.abs(cover - (item.dyeCover ?? -1)) > 1e-4) wrong.push(`${item.id} ${cover.toFixed(4)} against ${item.dyeCover}`);
        min = Math.min(min, cover);
      }
      ok(wrong.length === 0, `wardrobe/${folder}: every dyed piece's coverage is what its dye images hold${wrong.length ? `; not: ${wrong.slice(0, 4).join(', ')}` : ''}`);
      ok(!dyedItems.length || min >= 0.5, `wardrobe/${folder}: and no dyed piece is covered under half (least ${(min * 100).toFixed(0)}%)`);
      if (whole && want) ok(dyedItems.length >= want.dyed, `wardrobe/${folder}: ${dyedItems.length} pieces the game gave no colour carry a dye of ours (at least ${want.dyed}, as measured)`);
    }
  }

  // The palettes kept: every palette a piece names (met on a shader as it was read) has a recipe on that mesh that reads it.
  {
    const readers = new Map<string, Set<string>>();
    for (const r of cz.recipes) for (const p of r.shader?.palettes ?? []) (readers.get(r.mesh) ?? readers.set(r.mesh, new Set()).get(r.mesh)!).add(p.variable.replace(/^.*\//, ''));
    const lost = meshed.filter((i) => (i.variables ?? []).some((v) => v.kind === 'palette' && (v.meshes ?? []).some((m) => !readers.get(m)?.has(v.name.replace(/^.*\//, '')))));
    ok(lost.length === 0, `wardrobe/${folder}: no piece names a palette that no recipe of it reads${lost.length ? ` (${lost.length}: ${lost.slice(0, 4).map((i) => i.id).join(', ')})` : ''}`);
    // The family the first-pass rule dropped: each at its defaults is the base its GLB embeds. One whose GLB carries
    // its glow split out says so (`glow`) and is rendered as the game renders it, split (paintJob.ts): its lit half
    // is the base and its glow the GLB's own glow.
    const family = cz.recipes.filter((r) => /h_color2w/.test(r.shader?.effect ?? '') && (r.shader?.palettes ?? []).length);
    const pieces = meshed.filter((i) => family.some((r) => i.parts.some((p) => p.name === r.mesh)));
    let worst = 0;
    const off: string[] = [];
    for (const r of family) {
      const glb = embedded(r.mesh, r.material);
      const out = r.glow ? runPaintJob(r as never, new Map(), cz.palettes, image) : (renderRecipe(r as never, new Map(), cz.palettes, image) as Img);
      const d = Math.max(same(out as Img, glb?.base ?? null), r.glow ? same(out?.emis ?? null, glb?.emissive ?? null) : 0);
      if (d > 1) off.push(`${r.mesh} ${r.material} (${d})`);
      else worst = Math.max(worst, d);
    }
    if (!family.length) note(`wardrobe/${folder}: no piece here lays its palette on after the first pass`);
    if (whole && want) ok(pieces.length >= want.back, `wardrobe/${folder}: ${pieces.length} pieces have their palettes back (at least ${want.back}, as measured; the research counted 60 a human folder had no colour left at all, and 5 more that lose one of two)`);
    ok(off.length === 0, `wardrobe/${folder}: the ${family.length} recipes of the palettes laid on after the first pass (${pieces.length} pieces) render their GLBs' bases (and a glowing one its glow) at their defaults, within ${worst} level${off.length ? `; not: ${off.slice(0, 4).join(', ')}` : ''}`);

    // A bake whose glow is split out of it: its GLB carries both halves, and the two add up to the whole bake in
    // linear light, so the glowing part is lit once. The plain path's glow laid over the whole bake, which is
    // what the every-pass rule first did with the two Ithorian GCW helmets, lit it twice over.
    const glowing = cz.recipes.filter((r) => r.glow);
    const doubled: string[] = [];
    for (const r of glowing) {
      const glb = embedded(r.mesh, r.material);
      const full = renderRecipe(r as never, new Map(), cz.palettes, image) as Img | null;
      if (!glb?.base || !glb.emissive || !full || glb.base.width !== full.width || glb.emissive.width !== full.width || glb.base.height !== full.height || glb.emissive.height !== full.height) {
        doubled.push(`${r.mesh} (${!glb?.emissive ? 'no glow in its GLB' : 'sizes differ'})`);
        continue;
      }
      let worstSum = 0;
      for (let i = 0; i < full.width * full.height; i++) {
        for (let c = 0; c < 3; c++) {
          const sum = toByte(toLinear(glb.base.rgba[i * 4 + c]) + toLinear(glb.emissive.rgba[i * 4 + c]));
          worstSum = Math.max(worstSum, Math.abs(sum - full.rgba[i * 4 + c]));
        }
      }
      if (worstSum > 2) doubled.push(`${r.mesh} (lit and glow add up to the bake within ${worstSum})`);
    }
    ok(doubled.length === 0, `wardrobe/${folder}: each of the ${glowing.length} bakes with a glow carries it split out, the lit half and the glow adding up to the whole bake within 2 levels${doubled.length ? `; not: ${doubled.slice(0, 4).join(', ')}` : ''}`);
    if (whole && want) ok(glowing.length >= want.glowing, `wardrobe/${folder}: ${glowing.length} bakes keep their glow (at least ${want.glowing}, as measured: the Ithorian GCW helmets' visors)`);
  }

  // Hair: every hairstyle with meshes has a picture that decodes and shows something. A folder converted with
  // --no-icons has no pictures of anything, which `status` accepts as the owner's choice, and so does this.
  if (!wardrobe.items.some((i) => i.icon)) note(`wardrobe/${folder} was converted with --no-icons, so its hairstyles' pictures are not read here`);
  else {
    const hair = meshed.filter((i) => i.kind === 'hair');
    const bad: string[] = [];
    for (const h of hair) {
      const pic = h.icon && existsSync(join(dir, h.icon)) ? (decodePng(readFileSync(join(dir, h.icon))) as Img | null) : null;
      if (!pic) {
        bad.push(`${h.id} (none)`);
        continue;
      }
      let opaque = 0;
      for (let i = 3; i < pic.rgba.length; i += 4) if (pic.rgba[i] > 0) opaque++;
      if (opaque < 0.05 * pic.width * pic.height) bad.push(`${h.id} (${((opaque / (pic.width * pic.height)) * 100).toFixed(1)}%)`);
    }
    ok(bad.length === 0, `wardrobe/${folder}: each of its ${hair.length} hairstyles has a picture that decodes, at least 5% of it drawn${bad.length ? `; not: ${bad.slice(0, 4).join(', ')}` : ''}`);
  }
}

console.log(`\ndye conversion: ${passed} checks passed`);
