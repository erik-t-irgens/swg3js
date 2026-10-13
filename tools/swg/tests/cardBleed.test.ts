// The leaf cards' converter half (`tools/swg/cardBleed.mjs`, the flora command's card table):
//
//   1. a hand-built green disc on black keeps a green mip 3 within two levels once bled, where unbled it darkens;
//      alpha and every kept texel come back byte for byte; odd sizes, a picture with nothing under the cut and one
//      with nothing kept all come back whole and finite;
//   2. on every flora pack converted with the card table (SWG3JS_PACKS, else assets-private; a pack converted
//      before it is skipped with a note): every card material carries `extras.swgCard`, the manifest's `cards`
//      equals the GLBs' own, including the two shaders whose class the name rule gets wrong (`leaf_dath_rinor_aa7`
//      cut out, `kashyyyk_floor_cone_flower_as8` blended); no material but a cut-out card draws a bled picture; and
//      the table beside the packs (`flora-cards.json`) holds every world's own rows as they are;
//   3. and where the client's archives are on this machine (SWG in the environment or .env): every card's
//      `extras.swgCard` is its effect's pass and its MATL's emissive; every card picture's alpha bytes and kept
//      texels equal the archives' own top level; every plain cut-out's picture is exactly the bleed of that top
//      level, under a name of its own in its GLB; and down the box chain to mip 3 the leaf's edge is truer than
//      the unbled picture's: the kept texels' brightness rises in the median and the tenth darkest, the error
//      against the leaf under each kept texel falls in the median and the tenth worst, and grows on no picture
//      by more than a tenth.
//
// Run: node tools/swg/tests/cardBleed.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BLEED_CUT, bleedCard } from '../cardBleed.mjs';
import { decodeDds } from '../dds.mjs';
import { readGlb } from '../glbclips.mjs';
import { decodePng } from '../png.mjs';
import { describeSurface } from '../surface.mjs';
import { mountRetail, PACKS, type Img, type Vfs } from './materialsHarness.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

/** The browser's box chain, one level down, rounded to bytes as an 8-bit mip is. */
function down(img: Img): Img {
  const w = Math.max(1, img.width >> 1);
  const h = Math.max(1, img.height >> 1);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) {
        let s = 0;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) s += img.rgba[(Math.min(img.height - 1, y * 2 + dy) * img.width + Math.min(img.width - 1, x * 2 + dx)) * 4 + c];
        out[(y * w + x) * 4 + c] = Math.round(s / 4);
      }
  return { width: w, height: h, rgba: out };
}
const mip3 = (img: Img) => down(down(down(img)));
const LIN = new Float64Array(256).map((_, i) => (i / 255 <= 0.04045 ? i / 255 / 12.92 : Math.pow((i / 255 + 0.055) / 1.055, 2.4)));
const lum = (p: Uint8Array, k: number) => 0.2126 * LIN[p[k]] + 0.7152 * LIN[p[k + 1]] + 0.0722 * LIN[p[k + 2]];
/** The kept texels' mean brightness, in linear light. */
function kept(img: Img): number {
  let s = 0;
  let n = 0;
  for (let k = 0; k < img.rgba.length; k += 4) if (img.rgba[k + 3] >= BLEED_CUT) {
    s += lum(img.rgba, k);
    n++;
  }
  return n ? s / n : NaN;
}
/** At mip 3, how far each kept texel's brightness is from that of the kept texels it stands for, as a share of theirs, on the average. */
function edgeError(img: Img): number {
  const m = mip3(img);
  let s = 0;
  let n = 0;
  for (let y = 0; y < m.height; y++)
    for (let x = 0; x < m.width; x++) {
      const k = (y * m.width + x) * 4;
      if (m.rgba[k + 3] < BLEED_CUT) continue;
      let ls = 0;
      let ln = 0;
      for (let dy = 0; dy < 8; dy++)
        for (let dx = 0; dx < 8; dx++) {
          const q = (Math.min(img.height - 1, y * 8 + dy) * img.width + Math.min(img.width - 1, x * 8 + dx)) * 4;
          if (img.rgba[q + 3] >= BLEED_CUT) {
            ls += lum(img.rgba, q);
            ln++;
          }
        }
      if (!ln) continue;
      s += Math.abs(lum(m.rgba, k) - ls / ln) / Math.max(1e-3, ls / ln);
      n++;
    }
  return n ? s / n : 0;
}
/** Alpha bytes and kept texels the same in two pictures of one size. */
function sameWhereKept(a: Img, b: Img): { alpha: number; kept: number } {
  let alpha = 0;
  let keptDiff = 0;
  for (let i = 0; i < a.width * a.height; i++) {
    if (a.rgba[i * 4 + 3] !== b.rgba[i * 4 + 3]) alpha++;
    else if (a.rgba[i * 4 + 3] >= BLEED_CUT && (a.rgba[i * 4] !== b.rgba[i * 4] || a.rgba[i * 4 + 1] !== b.rgba[i * 4 + 1] || a.rgba[i * 4 + 2] !== b.rgba[i * 4 + 2])) keptDiff++;
  }
  return { alpha, kept: keptDiff };
}
const q = (a: number[], p: number) => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
};

// ---------------------------------------------------------------- 1. a disc of our own

{
  const N = 64;
  const disc: Img = { width: N, height: N, rgba: new Uint8Array(N * N * 4) };
  const green = [40, 200, 60];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const r = Math.hypot(x + 0.5 - 30, y + 0.5 - 34);
      const a = Math.round(255 * Math.min(1, Math.max(0, (20 - r) / 2)));
      const k = (y * N + x) * 4;
      // A leaf on black: what the cut throws away carries no colour, as in every planted leaf picture.
      if (a > 0) [disc.rgba[k], disc.rgba[k + 1], disc.rgba[k + 2]] = green;
      disc.rgba[k + 3] = a;
    }
  const bled = bleedCard(disc) as Img;
  const same = sameWhereKept(disc, bled);
  ok(same.alpha === 0 && same.kept === 0, 'alpha and every kept texel come back byte for byte');
  const worst = (img: Img) => {
    const m = mip3(img);
    let w = 0;
    for (let k = 0; k < m.rgba.length; k += 4) if (m.rgba[k + 3] >= BLEED_CUT) w = Math.max(w, Math.abs(m.rgba[k] - green[0]), Math.abs(m.rgba[k + 1] - green[1]), Math.abs(m.rgba[k + 2] - green[2]));
    return w;
  };
  ok(worst(bled) <= 2, `a green disc on black keeps a green mip 3 within two levels once bled (worst ${worst(bled)})`);
  ok(worst(disc) > 20, `where unbled its edge at mip 3 darkens (worst ${worst(disc)} levels): the test can tell the two apart`);
  const odd: Img = { width: 37, height: 5, rgba: new Uint8Array(37 * 5 * 4).map((_, i) => (i % 4 === 3 ? (i % 7 ? 255 : 0) : (i * 13) % 256)) };
  const none: Img = { width: 16, height: 16, rgba: new Uint8Array(16 * 16 * 4).map((_, i) => (i % 4 === 3 ? 255 : 90)) };
  const clear: Img = { width: 16, height: 16, rgba: new Uint8Array(16 * 16 * 4) };
  const one: Img = { width: 1, height: 1, rgba: Uint8Array.of(10, 20, 30, 0) };
  const bo = bleedCard(odd) as Img;
  ok(bo.width === 37 && bo.height === 5 && sameWhereKept(odd, bo).alpha === 0 && sameWhereKept(odd, bo).kept === 0, 'an odd-sized picture comes back its own size, alpha and kept texels whole');
  ok((bleedCard(none) as Img).rgba.every((v, i) => v === none.rgba[i]), 'a picture with nothing under the cut comes back unchanged');
  ok([...(bleedCard(clear) as Img).rgba, ...(bleedCard(one) as Img).rgba].every((v) => Number.isFinite(v)), 'and one with nothing kept, or a single texel, comes back finite');
}

// ---------------------------------------------------------------- 2 and 3. the packs

type GlbMaterial = { name?: string; alphaMode?: string; extras?: { invisible?: boolean; swgCard?: { blend: boolean; emissive: number[] } }; pbrMetallicRoughness?: { baseColorTexture?: { index: number } }; emissiveTexture?: unknown };
const packs: { pack: string; dir: string; manifest: { cards?: Record<string, { blend: boolean; emissive: number[] }>; categories: { flora?: { file: string }[] } } }[] = [];
if (existsSync(PACKS)) {
  for (const pack of readdirSync(PACKS)) {
    const mf = join(PACKS, pack, 'manifest.json');
    if (!existsSync(mf)) continue;
    try {
      const manifest = JSON.parse(readFileSync(mf, 'utf8'));
      if (manifest?.categories?.flora?.length) packs.push({ pack, dir: join(PACKS, pack), manifest });
    } catch {
      /* a manifest cut short is no pack to read */
    }
  }
}
const withCards = packs.filter((p) => p.manifest.cards);
if (!packs.length) console.log(`skip the packs: no pack with flora under ${PACKS}`);
else if (!withCards.length) console.log(`skip the packs: no flora pack under ${PACKS} was converted with the card table yet (\`flora <swg-dir> all <out> --retail-only\`)`);
else {
  const isCard = (m: GlbMaterial) => (m.alphaMode === 'MASK' || m.alphaMode === 'BLEND') && !m.extras?.invisible;
  let materials = 0;
  let unstamped = 0;
  let tableDiffers = 0;
  const glbCards = new Map<string, { blend: boolean; emissive: number[] }>();
  const pictures = new Map<string, Img>();
  /** Whether each card picture went into its GLB under a name of its own (`#bled`), and any other material drawing one. */
  const bledName = new Map<string, boolean>();
  const bledElsewhere: string[] = [];
  for (const p of withCards) {
    const seenHere = new Set<string>();
    for (const d of p.manifest.categories.flora ?? []) {
      const file = join(p.dir, d.file);
      if (!existsSync(file)) continue;
      const { json, bin } = readGlb(readFileSync(file));
      const imageName = (m: GlbMaterial): string => {
        const ti = m.pbrMetallicRoughness?.baseColorTexture?.index;
        return ti === undefined ? '' : (json.images[json.textures[ti].source].name ?? '');
      };
      for (const m of (json.materials ?? []) as GlbMaterial[]) {
        // A bled picture is a cut-out card's own: a bark or a branch on the same texture draws the archives' picture.
        if (!(m.alphaMode === 'MASK') && imageName(m).endsWith('#bled')) bledElsewhere.push(`${p.pack}/${m.name}`);
        if (!isCard(m)) continue;
        materials++;
        const card = m.extras?.swgCard;
        if (!card) {
          unstamped++;
          continue;
        }
        seenHere.add(m.name ?? '');
        glbCards.set(m.name ?? '', card);
        if (JSON.stringify(p.manifest.cards![m.name ?? '']) !== JSON.stringify(card)) tableDiffers++;
        const ti = m.pbrMetallicRoughness?.baseColorTexture?.index;
        if (m.alphaMode === 'MASK' && ti !== undefined && !m.emissiveTexture && !pictures.has(m.name ?? '')) {
          const im = json.images[json.textures[ti].source];
          const v = json.bufferViews[im.bufferView];
          const img = decodePng(bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength)) as Img | null;
          if (img) pictures.set(m.name ?? '', img);
          if (img) bledName.set(m.name ?? '', (im.name ?? '').endsWith('#bled'));
        }
      }
    }
    for (const name of Object.keys(p.manifest.cards!)) if (!seenHere.has(name)) tableDiffers++;
  }
  ok(materials > 0 && unstamped === 0, `every card material of ${withCards.length} flora pack${withCards.length === 1 ? '' : 's'} carries extras.swgCard (${materials} materials)`);
  ok(tableDiffers === 0, "each manifest's cards table is its GLBs' own, row for row");
  ok(bledElsewhere.length === 0, `no material but a cut-out card draws a bled picture: a bark sharing its leaves' texture keeps the archives' own (${bledElsewhere.length}${bledElsewhere.length ? `: ${bledElsewhere.slice(0, 4).join(', ')}` : ''})`);
  // The table of every world's card shaders beside the packs: every world's own rows in it, the same.
  const sharedFile = join(PACKS, 'flora-cards.json');
  if (!existsSync(sharedFile)) console.log('     (no flora-cards.json beside these packs: written by the flora command from the leaf pass\'s fix on, and the game then knows every world\'s card shaders at once)');
  else {
    const shared = JSON.parse(readFileSync(sharedFile, 'utf8')) as { version?: number; cards?: Record<string, { blend: boolean; emissive: number[] }> };
    let rows = 0;
    const off: string[] = [];
    for (const p of withCards)
      for (const [name, row] of Object.entries(p.manifest.cards!)) {
        rows++;
        if (JSON.stringify(shared.cards?.[name]) !== JSON.stringify(row)) off.push(`${p.pack}: ${name}`);
      }
    ok(shared.version === 1 && off.length === 0, `the table beside the packs holds every world's own rows as they are (${rows} rows over ${withCards.length} worlds, ${Object.keys(shared.cards ?? {}).length} shaders${off.length ? `; not: ${off.slice(0, 4).join(', ')}` : ''})`);
  }
  const rinor = glbCards.get('shader/leaf_dath_rinor_aa7.sht');
  const cone = glbCards.get('shader/kashyyyk_floor_cone_flower_as8.sht');
  if (rinor || cone) ok((!rinor || rinor.blend === false) && (!cone || cone.blend === true), 'the two shaders the name rule gets wrong carry their own pass: the Dathomir leaf cut out, the Kashyyyk cone flower blended');
  else console.log('     (neither of the two shaders the name rule gets wrong is in these packs)');

  const vfs = (await mountRetail()) as Vfs | null;
  if (!vfs) console.log('skip the archives: no SWG install on this machine (SWG in the environment or .env)');
  else {
    const cache = new Map();
    let passWrong = 0;
    const wrong: string[] = [];
    for (const [name, card] of glbCards) {
      const d = describeSurface(vfs, name, cache);
      const blend = !!(d.pass?.alphaBlend && !d.pass.zWrite);
      const emissive = (d.material?.emissive ?? [0, 0, 0]).map((v: number) => Math.round(v * 1e4) / 1e4);
      if (card.blend !== blend || JSON.stringify(card.emissive) !== JSON.stringify(emissive)) {
        passWrong++;
        wrong.push(name);
      }
    }
    ok(passWrong === 0, `every card's extras.swgCard is its effect's pass and its MATL's emissive (${glbCards.size} shaders${wrong.length ? `; wrong: ${wrong.slice(0, 4).join(', ')}` : ''})`);
    let compared = 0;
    let unread = 0;
    let sizes = 0;
    let alphaWrong = 0;
    let keptWrong = 0;
    const before: number[] = [];
    const after: number[] = [];
    const errBefore: number[] = [];
    const errAfter: number[] = [];
    let worstGrowth = 0;
    let worstName = '';
    let plain = 0;
    const notBled: string[] = [];
    const unnamed: string[] = [];
    for (const [name, img] of pictures) {
      const d = describeSurface(vfs, name, cache);
      if (!d.main || !vfs.has(d.main) || d.emissive) {
        unread++;
        continue;
      }
      let top: Img;
      try {
        top = decodeDds(vfs.read(d.main)) as Img;
      } catch {
        unread++;
        continue;
      }
      if (top.width !== img.width || top.height !== img.height) {
        sizes++;
        continue;
      }
      compared++;
      const s = sameWhereKept(top, img);
      if (s.alpha) alphaWrong++;
      if (s.kept) keptWrong++;
      // A plain cut-out (no flip-book, no split alpha) is bled, byte for byte the bleed of the archives' own top
      // level, and under a name of its own; a picture the bleed was never run on reads as the archives' unchanged.
      if (!d.anim && !d.split) {
        plain++;
        const want = bleedCard(top) as Img;
        if (want.rgba.some((v, i) => v !== img.rgba[i])) notBled.push(name);
        if (!bledName.get(name)) unnamed.push(name);
      }
      const k0 = kept(top);
      before.push(kept(mip3(top)) / k0);
      after.push(kept(mip3(img)) / k0);
      const eb = edgeError(top);
      const ea = edgeError(img);
      errBefore.push(eb);
      errAfter.push(ea);
      if (ea - eb > worstGrowth) {
        worstGrowth = ea - eb;
        worstName = name;
      }
    }
    ok(compared > 0 && sizes === 0, `every card picture is the archives' top level's size (${compared} compared, ${unread} with a glow split or no picture of their own left out)`);
    ok(alphaWrong === 0 && keptWrong === 0, `and its alpha bytes and kept texels are the archives' own, byte for byte (${alphaWrong} differ in alpha, ${keptWrong} in a kept texel)`);
    ok(plain > 0 && notBled.length === 0, `every plain cut-out card picture is the bleed of the archives' own top level, byte for byte (${plain}${notBled.length ? `; not: ${notBled.slice(0, 4).join(', ')}` : ''})`);
    ok(unnamed.length === 0, `and goes into its GLB under a name of its own, apart from any bark sharing its texture (${unnamed.length}${unnamed.length ? `: ${unnamed.slice(0, 4).join(', ')}` : ''})`);
    console.log(`     mip 3 against mip 0, kept brightness: unbled median ${q(before, 0.5).toFixed(3)} tenth ${q(before, 0.1).toFixed(3)}, bled median ${q(after, 0.5).toFixed(3)} tenth ${q(after, 0.1).toFixed(3)}; edge error unbled median ${q(errBefore, 0.5).toFixed(3)} tenth worst ${q(errBefore, 0.9).toFixed(3)}, bled ${q(errAfter, 0.5).toFixed(3)} and ${q(errAfter, 0.9).toFixed(3)}`);
    ok(q(after, 0.5) > q(before, 0.5) && q(after, 0.1) > q(before, 0.1), 'down to mip 3 the kept texels keep more of their brightness, in the median and the tenth darkest');
    ok(q(errAfter, 0.5) < q(errBefore, 0.5) && q(errAfter, 0.9) < q(errBefore, 0.9), 'and stand nearer the leaf under them, in the median and the tenth worst');
    ok(worstGrowth <= 0.1, `and on no picture does that error grow by more than a tenth (worst ${worstGrowth.toFixed(3)}${worstName ? `, ${worstName}` : ''})`);
  }
}

console.log(`\ncardBleed: ${passed} checks passed`);
