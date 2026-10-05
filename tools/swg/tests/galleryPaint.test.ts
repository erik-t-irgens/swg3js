// A speeder's paint, as the converter writes it (the Creator and dye pass, wave 7).
//
// The ships command's paint recipes are made by one function now (tools/swg/paintrecipes.mjs), which the
// gallery's vehicles share: a vehicle whose shaders take colours is baked at its defaults through every pass,
// as a ship is, its recipes go into the gallery's own customize.json and its paint onto its model's entry in the
// ships pack's own shape, and the manifest is stamped so `status` can tell a gallery converted before. Where this
// machine has the client (SWG in the environment or in .env), first the shared function is run on two of a ship's
// own paint shaders, a plain one and a glowing one, and their recipes read against the ones the ships pack holds,
// so the move out of the ships command changed nothing; then the real `gallery` command is run on the first
// vehicles into a folder of its own -- never into assets-private -- and what it wrote is read back: a static
// speeder and a skinned one, each with its paint, its recipes and its palettes, every material its paint names a
// material of its model wearing that recipe rendered at the defaults, and a picture an earlier run left taken out;
// and a run of another section into the same folder leaves all of the vehicles' paint as it was.
//
// Run: node tools/swg/tests/galleryPaint.test.ts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GALLERY_PAINT_FORMAT, galleryPaintStatus } from '../gallery.mjs';
import { readGlb } from '../glbclips.mjs';
import { decodePng } from '../png.mjs';
import { renderRecipe } from '../../../src/player/texrender.ts';
import { runPaintJob } from '../../../src/vehicles/paintJob.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string) => console.log(`note ${s}`);

type Recipe = { mesh: string; material: string; kind: string; baseTag: string; shader: { passes: unknown[]; textures: Record<string, string>; palettes: { tag: string; palette: string; variable: string; default: number }[]; choices: { variable: string; default: number; files: string[] }[] }; staticMain?: string | null; glow?: unknown };
type Img = { width: number; height: number; rgba: Uint8Array };
/**
 * The largest difference of any colour byte between two pictures of one size (Infinity when either is missing or
 * the sizes differ). Colour only: a paint bake's alpha in the GLB is the chosen pattern's own (the gloss,
 * `withPatternAlpha` in shipfit.mjs), as every ship's is, while a render keeps the bake's.
 */
const same = (a: Img | null | undefined, b: Img | null | undefined): number => {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return Infinity;
  let worst = 0;
  for (let i = 0; i < a.rgba.length; i++) if ((i & 3) !== 3) worst = Math.max(worst, Math.abs(a.rgba[i] - b.rgba[i]));
  return worst;
};
type Variable = { name: string; kind: string; palette?: string; size?: number; count?: number; default: number };

let swg = process.env.SWG ?? '';
const env = fileURLToPath(new URL('../../../.env', import.meta.url));
if (!swg && existsSync(env)) {
  for (const line of readFileSync(env, 'utf8').split(/\r?\n/)) {
    const m = /^\s*SWG\s*=\s*(.*?)\s*$/.exec(line);
    if (m) swg = m[1].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const ROOT = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private/', import.meta.url));

if (!swg || !existsSync(swg)) note('no SWG install on this machine, so the paint recipes are not made here');
else {
  const { openVfs } = await import('../tre.mjs');
  const { isRetailByName } = await import('../manifest.mjs');
  const { parseIff } = await import('../iff.mjs');
  const { renderContext } = await import('../texrender.mjs');
  const { paintRecipeMaker } = await import('../paintrecipes.mjs');
  const vfs = openVfs(swg, { filter: (f: string) => isRetailByName(f, statSync(join(swg, f)).size) !== null, log: () => {} });
  const isCustomizable = (p: string) => {
    try {
      return vfs.has(p) && parseIff(vfs.read(p)).type === 'CSHD';
    } catch {
      return false;
    }
  };

  // ---- the shared function makes a ship's recipe as the ships command always did ----------------------
  // Two of the ships pack's own recipes: a plain one with a pattern and a palette, and one that glows. How a shader
  // glows is the cli's to say (it reads the converted material), so the maker is handed the glow the ships pack
  // holds for the one that glows and none for the other, and what is held to is what the maker does with it: the
  // glow written on the recipe, and its mask kept among the trimmed shader's textures (the passes alone do not read
  // it), which only six hulls in the retail archives need and the next ships run depends on.
  const shipsFile = join(ROOT, 'ships', 'customize.json');
  if (!existsSync(shipsFile)) note('no ships pack on this machine, so the recipe the ships command wrote is not compared');
  else {
    const held = JSON.parse(readFileSync(shipsFile, 'utf8')) as { recipes: Recipe[]; palettes: Record<string, number[][]> };
    const pick = held.recipes.find((r) => !r.glow && r.shader.choices.length && r.shader.palettes.length) ?? held.recipes[0];
    const glowing = held.recipes.find((r) => r.glow) ?? null;
    const picks = [pick, ...(glowing ? [glowing] : [])];
    if (!glowing) note('the ships pack here holds no glowing paint recipe, so the glow path is not compared');
    const out = mkdtempSync(join(tmpdir(), 'swg3js-paintrecipe-'));
    try {
      const glowOf = (p: string) => (picks.find((r) => r.material === p)?.glow as never) ?? null;
      const maker = paintRecipeMaker(vfs, out, { ctx: renderContext(), isCustomizable, glowOf, log: () => {} });
      ok(picks.every((r) => maker.isPaint(r.material)) && maker.recipes.size === picks.length, `${picks.map((r) => r.material).join(' and ')} are paint to the shared function, as they were to the ships command`);
      const shape = (r: Recipe) => JSON.stringify({ mesh: r.mesh, material: r.material, kind: r.kind, baseTag: r.baseTag, passes: r.shader.passes, textures: Object.keys(r.shader.textures ?? {}).sort(), palettes: r.shader.palettes, choices: r.shader.choices.map((c) => [c.variable, c.default, c.files.length]), staticMain: !!r.staticMain, glow: r.glow ?? null });
      for (const r of picks) ok(shape(maker.recipes.get(r.material) as Recipe) === shape(r), `${r.material}: its recipe is the one the ships pack holds: its passes, textures, palettes, choices, static picture and ${r.glow ? 'glow, its mask kept' : 'no glow'}`);
      if (glowing) {
        const mask = (glowing.glow as { maskTag: string }).maskTag;
        const made = maker.recipes.get(glowing.material) as Recipe;
        ok(!!made.glow && mask in made.shader.textures, `and the glowing one keeps its mask (${mask}) and says how it glows`);
      }
      // Every retail glow's mask is read by a pass as well, so only a made-up glow shows the mask is kept for its own
      // sake: on the plain shader, a mask on a texture it binds and no pass reads (CNRM) is kept all the same.
      const extra = mkdtempSync(join(tmpdir(), 'swg3js-paintrecipe-mask-'));
      try {
        const glow = { maskTag: 'CNRM', channel: 'a', keepAlpha: true };
        const masked = paintRecipeMaker(vfs, extra, { ctx: renderContext(), isCustomizable, glowOf: (p: string) => (p === pick.material ? (glow as never) : null), log: () => {} });
        masked.isPaint(pick.material);
        const r = masked.recipes.get(pick.material) as Recipe | undefined;
        if (!r || 'CNRM' in pick.shader.textures) note(`${pick.material} binds no texture its passes leave unread, so a made-up mask is not tried`);
        else ok('CNRM' in r.shader.textures && JSON.stringify(r.glow) === JSON.stringify(glow), `a glow's mask no pass reads is kept beside the passes' own textures (${Object.keys(r.shader.textures).sort().join(', ')})`);
      } finally {
        rmSync(extra, { recursive: true, force: true });
      }
      const images = readdirSync(join(out, 'customize')).filter((f) => f.endsWith('.png'));
      ok(images.length > 0 && maker.stats.images === images.length && maker.stats.bytes > 0, `their pictures are written under customize/ and counted (${images.length}, ${(maker.stats.bytes / 1e6).toFixed(2)} MB)`);
      const merged = maker.variablesOf([pick.material]);
      ok(merged.variables.some((v: Variable) => v.kind === 'palette' && (v.size ?? 0) > 0) && merged.variables.every((v: Variable) => v.kind !== 'index' || (v.count ?? 0) > 0), 'its variables merge with each palette counted and each pattern its choices');
      maker.write([...maker.recipes.values()]);
      const written = JSON.parse(readFileSync(join(out, 'customize.json'), 'utf8')) as { recipes: Recipe[]; palettes: Record<string, number[][]> };
      ok(written.recipes.length === picks.length && picks.every((r) => r.shader.palettes.every((p) => JSON.stringify(written.palettes[p.palette]) === JSON.stringify(held.palettes[p.palette]))), 'and customize.json carries every palette they read, as the ships pack does');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }

  // ---- the gallery command on its first vehicles, into a folder of its own -----------------------------
  const out = mkdtempSync(join(tmpdir(), 'swg3js-gallerypaint-'));
  try {
    const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
    const dir = join(out, 'gallery');
    // A picture an earlier run left that nothing names now: the registry numbers its files in the order it meets
    // them, so a run that meets one image more early on renames every file after it, and the old copies must go.
    mkdirSync(join(dir, 'customize'), { recursive: true });
    writeFileSync(join(dir, 'customize', 'x_999.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const began = Date.now();
    // The first six vehicle templates: two that take no colour, the BARC speeder (a static model), two placeholders
    // with no body, and the basilisk (a skinned one).
    const run = spawnSync(process.execPath, [cli, 'gallery', swg, out, '--only=vehicles', '--limit=6', '--retail-only'], { encoding: 'utf8', maxBuffer: 64 * 1048576 });
    const paintLine = (run.stdout ?? '').split('\n').find((l) => /^\s+paint: /.test(l)) ?? '';
    ok(run.status === 0, `the gallery command runs on the vehicles alone (${((Date.now() - began) / 1000).toFixed(1)} s; ${paintLine.trim() || (run.stderr ?? '').trim().split('\n').slice(-2).join(' / ')})`);
    ok(!existsSync(join(dir, 'customize', 'x_999.png')) && /an earlier run left removed/.test(paintLine), 'a picture an earlier run left under customize/ that no recipe names is taken out, and the run says so');
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { paintFormat?: number; categories: { layout: { id: string; file: string; skeletal?: boolean; paint?: { shaders: string[]; variables: Variable[] } }[] } };
    const index = JSON.parse(readFileSync(join(dir, 'gallery.json'), 'utf8'));
    ok(manifest.paintFormat === GALLERY_PAINT_FORMAT && !galleryPaintStatus(manifest, index).stale, 'the manifest is stamped, and status asks for nothing of it');
    const painted = manifest.categories.layout.filter((m) => m.paint);
    note(`painted: ${painted.map((m) => `${m.id}${m.skeletal ? ' (skinned)' : ''}: ${m.paint!.variables.map((v) => `${v.name} ${v.palette}`).join(', ')}`).join('; ')}`);
    ok(painted.some((m) => !m.skeletal) && painted.some((m) => m.skeletal), 'a static speeder and a skinned vehicle each carry their paint');
    ok(manifest.categories.layout.filter((m) => !m.paint).length >= 1, 'and a vehicle whose shaders take no colours carries none');
    const cz = JSON.parse(readFileSync(join(dir, 'customize.json'), 'utf8')) as { images: string; recipes: Recipe[]; palettes: Record<string, number[][]> };
    const recipeOf = new Map(cz.recipes.map((r) => [r.material, r]));
    ok(painted.every((m) => m.paint!.shaders.every((s) => recipeOf.has(s))), "every paint shader a model names has its recipe in the gallery's customize.json");
    ok(painted.every((m) => m.paint!.variables.every((v) => (v.kind === 'palette') === /(^|\/)index_color_\d+$/.test(v.name) && (v.kind !== 'palette' || (v.palette && (cz.palettes[v.palette]?.length ?? 0) === v.size)))), 'every colour is named a colour and its palette is in the file at the size the paint says');
    const images = new Set(readdirSync(join(dir, cz.images)).filter((f) => f.endsWith('.png')));
    const named = new Set<string>();
    for (const r of cz.recipes) {
      for (const c of r.shader.choices) for (const f of c.files) if (f) named.add(f);
      for (const f of Object.values((r.shader as unknown as { textures?: Record<string, string> }).textures ?? {})) if (f) named.add(f);
      if (r.staticMain) named.add(r.staticMain);
    }
    ok(named.size > 0 && [...named].every((f) => images.has(f)) && [...images].every((f) => named.has(f)), `the folder holds exactly the pictures the recipes name (${images.size})`);
    // A model's own materials are named for its shaders: its paint must name ones it has, or nothing is painted.
    // And what each such material wears in the GLB is its recipe rendered at the defaults, byte for byte, as the
    // game renders it (a glowing one split as the paint worker splits it): the bake through every pass is the one
    // thing this changes in a vehicle's model, so a stock speeder is the very picture an unchanged repaint gives.
    const decoded = new Map<string, Img | null>();
    const image = (f: string | null): Img | null => {
      if (!f) return null;
      if (!decoded.has(f)) decoded.set(f, existsSync(join(dir, cz.images, f)) ? (decodePng(readFileSync(join(dir, cz.images, f))) as Img | null) : null);
      return decoded.get(f)!;
    };
    type GlbMaterial = { name?: string; pbrMetallicRoughness?: { baseColorTexture?: { index: number } }; emissiveTexture?: { index: number } };
    for (const m of painted) {
      const { json, bin } = readGlb(readFileSync(join(dir, m.file)));
      const mats = new Map<string, GlbMaterial>();
      for (const x of (json.materials ?? []) as GlbMaterial[]) if (!mats.has(String(x.name ?? '').toLowerCase())) mats.set(String(x.name ?? '').toLowerCase(), x);
      ok(m.paint!.shaders.every((s) => mats.has(s.toLowerCase())), `${m.id}: every shader its paint names is a material of its model`);
      const pic = (index: number | undefined): Img | null => {
        const t = index === undefined ? null : json.textures?.[index];
        const im = t ? json.images?.[t.source] : null;
        if (!im || im.bufferView === undefined) return null;
        const bv = json.bufferViews[im.bufferView];
        return decodePng(bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength)) as Img | null;
      };
      const off: string[] = [];
      for (const s of m.paint!.shaders) {
        const r = recipeOf.get(s)!;
        const mat = mats.get(s.toLowerCase());
        const base = pic(mat?.pbrMetallicRoughness?.baseColorTexture?.index);
        const made = r.glow ? (runPaintJob(r as never, new Map(), cz.palettes, image) as (Img & { emis?: Img | null }) | null) : (renderRecipe(r as never, new Map(), cz.palettes, image) as Img | null);
        const d = Math.max(same(made, base), r.glow ? same((made as { emis?: Img | null } | null)?.emis ?? null, pic(mat?.emissiveTexture?.index)) : 0);
        if (d !== 0) off.push(`${s} (${d})`);
      }
      ok(off.length === 0, `${m.id}${m.skeletal ? ' (skinned)' : ''}: each of its ${m.paint!.shaders.length} paint materials wears its recipe rendered at the defaults, colour byte for colour byte${off.length ? `; not: ${off.join(', ')}` : ''}`);
    }

    // ---- a run of another section keeps the vehicles' paint as it stands ----------------------------
    // It builds no vehicle, so it writes no recipe: the stamp, each model's paint, customize.json and every picture
    // under customize/ are the last run's, or `status` would ask for the vehicles again and the paint pages empty.
    const before = { cz: readFileSync(join(dir, 'customize.json'), 'utf8'), pictures: readdirSync(join(dir, cz.images)).sort().join(), paint: JSON.stringify(painted.map((m) => [m.id, m.paint])) };
    const again = spawnSync(process.execPath, [cli, 'gallery', swg, out, '--only=weapons', '--limit=1', '--retail-only'], { encoding: 'utf8', maxBuffer: 64 * 1048576 });
    ok(again.status === 0, `a run of the weapons alone into the same gallery runs (${(again.stderr ?? '').trim().split('\n').slice(-1).join('') || 'no complaint'})`);
    const after = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as typeof manifest;
    ok(after.paintFormat === GALLERY_PAINT_FORMAT && !galleryPaintStatus(after, JSON.parse(readFileSync(join(dir, 'gallery.json'), 'utf8'))).stale, 'and keeps the paint stamp, so status asks for nothing');
    ok(JSON.stringify(after.categories.layout.filter((m) => m.paint).map((m) => [m.id, m.paint])) === before.paint, "and every vehicle model's paint as it was");
    ok(readFileSync(join(dir, 'customize.json'), 'utf8') === before.cz && readdirSync(join(dir, cz.images)).sort().join() === before.pictures, 'and the recipes and their pictures untouched');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

console.log(`\ngalleryPaint: ${passed} checks passed`);
