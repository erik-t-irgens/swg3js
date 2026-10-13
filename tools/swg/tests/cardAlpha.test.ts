// How a leaf card is cut (`src/world/cardAlpha.ts`, the card rule's shader in `src/world/cardRule.ts`):
//
//   1. the rule gives each class its own cut and scale, and a card of no known class the cut-out's cut and no
//      scale; the scaled alpha is the identity at k nought or a level of nought or less, and clamps at one; the
//      level is half the log of the larger squared footprint, never the log of nought;
//   2. the shader's text says the same: the floor sits inside the `log2` (GLSL ES 3.00 leaves log2 undefined at
//      nought, and a NaN alpha draws a clear texel the effects' NaN pass cannot see), `textureSize( map, 0 )` only
//      under `USE_MAP`, the class picks between two shared cuts, and the name's stand-in agrees with the effect on
//      all but the two shaders it is known to get wrong;
//   3. a five-second crown check, cut down from the soft-leaves study's rasteriser to three blended tree models
//      on disk: the share of a crown's silhouette covered at the texture level a distance gives, ours against
//      blending (the client's), today's cut below 0.9 of blending at 320 m and the rule within 0.9 to 1.1 of it
//      from 10 to 320 m. Blending is worked from our own box chain, which keeps a level's mean alpha as the
//      client's chain does; the models come from SWG3JS_PACKS, else assets-private, and a machine with neither is
//      told so.
//
// Run: node tools/swg/tests/cardAlpha.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOD_FLOOR, cardCut, cardKeeps, cardLod, cardMipScale, classByName, scaledAlpha, type CardAlphaTune } from '../../../src/world/cardAlpha.ts';
import { CARD_ALPHA, CARD_TUNE } from '../../../src/world/cardRule.ts';
import { readGlb } from '../glbclips.mjs';
import { decodePng } from '../png.mjs';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

const T: CardAlphaTune = { cutPunch: 0.5, cutBlend: 0.5, mipScale: 0.1, mipScalePunch: 0 };

// ---------------------------------------------------------------- 1. the rule

{
  ok(cardCut('punch', T) === 0.5 && cardCut('blend', { ...T, cutBlend: 0.4 }) === 0.4 && cardCut(null, { ...T, cutPunch: 0.45 }) === 0.45, "each class takes its own cut, and a card of no known class the cut-out's");
  ok(cardMipScale('blend', T) === 0.1 && cardMipScale('punch', T) === 0 && cardMipScale('punch', { ...T, mipScalePunch: 0.2 }) === 0.2 && cardMipScale(null, T) === 0, 'a blended card is raised by the level, a cut-out by its own knob (nought), and one of no known class not at all');
  let identity = true;
  let clamps = true;
  for (let i = 0; i < 2000; i++) {
    const a = Math.random();
    const lod = (Math.random() - 0.5) * 20;
    if (scaledAlpha(a, 0, lod) !== a) identity = false;
    if (scaledAlpha(a, 0.3, Math.min(lod, 0)) !== a) identity = false;
    if (scaledAlpha(a, Math.random(), lod) > 1) clamps = false;
  }
  ok(identity, 'the scaled alpha is the identity at k nought and at any level of nought or less');
  ok(clamps && scaledAlpha(0.9, 0.5, 6) === 1, 'and it never passes one');
  ok(Math.abs(scaledAlpha(0.4, 0.1, 3) - 0.52) < 1e-12, 'a texel of 0.4 three levels down is raised to 0.52, over the cut, by the rule');
  ok(cardKeeps(0.4, 'blend', 3, T) && !cardKeeps(0.4, 'punch', 3, T) && !cardKeeps(0.4, 'blend', 0, T), 'so it is kept on a blended card there, and not on a cut-out, nor at the top level');
  let levels = true;
  for (let i = 0; i < 2000; i++) {
    const v = [Math.random() * 40 - 20, Math.random() * 40 - 20, Math.random() * 40 - 20, Math.random() * 40 - 20];
    const big = Math.max(v[0] * v[0] + v[1] * v[1], v[2] * v[2] + v[3] * v[3]);
    if (Math.abs(cardLod(v[0], v[1], v[2], v[3]) - 0.5 * Math.log2(big)) > 1e-9) levels = false;
  }
  ok(levels, 'the level is half the log of the larger squared footprint, in texels a screen pixel');
  ok(cardLod(0, 0, 0, 0) === 0.5 * Math.log2(LOD_FLOOR) && Number.isFinite(cardLod(0, 0, 0, 0)), 'and a footprint of nought gives the floor, a finite level, never the log of nought');
  ok(CARD_TUNE.cutPunch === 0.5 && CARD_TUNE.cutBlend === 0.5 && CARD_TUNE.mipScale === 0.1 && CARD_TUNE.mipScalePunch === 0, 'the tune ships at the client\'s half, our half, a scale of 0.1 and none for cut-outs');
}

// ---------------------------------------------------------------- 2. the shader says the same

{
  const text = CARD_ALPHA;
  ok(/log2\(\s*max\(\s*max\(\s*dot\(\s*swgCardDx,\s*swgCardDx\s*\),\s*dot\(\s*swgCardDy,\s*swgCardDy\s*\)\s*\),\s*1e-12\s*\)\s*\)/.test(text), 'the floor sits inside the log2, at the mirror\'s floor');
  ok(String(LOD_FLOOR) === '1e-12', 'the mirror\'s floor is the shader\'s');
  const useMap = text.indexOf('#ifdef USE_MAP');
  const endMap = text.indexOf('#endif', useMap);
  const size = text.indexOf('textureSize( map, 0 )');
  ok(useMap >= 0 && size > useMap && size < endMap && text.split('textureSize').length === 2, '`textureSize( map, 0 )` sits only under USE_MAP');
  ok(/diffuseColor\.a = min\( 1\.0, diffuseColor\.a \* \( 1\.0 \+ swgCardK \* max\( 0\.0, swgCardLod \) \) \);/.test(text), 'the scale is the mirror\'s: min(1, a × (1 + k × max(0, level)))');
  ok(/swgCardBlend > 0\.5 \? uSwgCardMipScale : uSwgCardMipScalePunch/.test(text) && /swgCardBlend > 0\.5 \? uSwgCardCutBlend : uSwgCardCutPunch/.test(text), 'and the class only picks between two shared knobs, so moving a cut compiles nothing');
  ok(text.includes('#ifdef USE_ALPHATEST') && text.includes('discard;'), 'it cuts only where three would (USE_ALPHATEST), and cuts by discarding');
  // The name's stand-in: right on every retail card shader but two (`cardAlpha.ts` names them).
  ok(classByName('shader/ever_eucalyptus_leaves_aa7.sht') === 'blend' && classByName('shader/decd_lok_mkpud_leaves_aa7_phong1.sht') === 'blend' && classByName('shader/kash_flow_lily_ap10_phong1.sht') === 'punch' && classByName('shader/decd_trillium_palm_leaves_sm.sht') === 'punch', 'the name says blended by its _aa<n>, wherever it falls, and cut out otherwise');
  ok(classByName('shader/leaf_dath_rinor_aa7.sht') === 'blend' && classByName('shader/kashyyk_floor_cone_flower_as8.sht') === 'punch', 'and gets exactly the two known exceptions wrong (a cut-out and a blended card), which a pack\'s own class corrects');
}

// ---------------------------------------------------------------- 3. the crown check

const PACKS = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private/', import.meta.url));
/** Three blended tree models, the commonest round Theed and Endor's redwood, the first of each list found on disk. */
const CANDIDATES = [
  ['naboo/flora/ever_eucalyptus_med.glb', 'corellia/flora/ever_eucalyptus_med.glb'],
  ['naboo/flora/nboo_decd_cambylictustree.glb', 'rori/flora/nboo_decd_cambylictustree.glb'],
  ['endor/flora/frst_conf_redwood_lg.glb', 'endor/flora/frst_conf_redwood_med.glb', 'yavin4/flora/decd_massassi_a.glb', 'yavin4/flora/decd_tallbirch.glb'],
];
const RES = 96;
const MIPS = 7;
type Level = { width: number; height: number; a: Float32Array };

function down(l: Level): Level {
  const w = Math.max(1, l.width >> 1);
  const h = Math.max(1, l.height >> 1);
  const a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) s += l.a[Math.min(l.height - 1, y * 2 + dy) * l.width + Math.min(l.width - 1, x * 2 + dx)];
      a[y * w + x] = Math.round(s / 4);
    }
  }
  return { width: w, height: h, a };
}
function sample(l: Level, u: number, v: number): number {
  const x = u * l.width - 0.5;
  const y = v * l.height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const W = l.width;
  const H = l.height;
  const xi = (k: number) => ((k % W) + W) % W;
  const yi = (k: number) => ((k % H) + H) % H;
  const a00 = l.a[yi(y0) * W + xi(x0)];
  const a10 = l.a[yi(y0) * W + xi(x0 + 1)];
  const a01 = l.a[yi(y0 + 1) * W + xi(x0)];
  const a11 = l.a[yi(y0 + 1) * W + xi(x0 + 1)];
  return ((a00 * (1 - fx) + a10 * fx) * (1 - fy) + (a01 * (1 - fx) + a11 * fx) * fy) / 255;
}

type Acc = { array: ArrayLike<number> };
function accessor(json: any, bin: Buffer, i: number): Acc {
  const a = json.accessors[i];
  const view = json.bufferViews[a.bufferView];
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type as 'VEC3'];
  const off = bin.byteOffset + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const C = a.componentType === 5126 ? Float32Array : a.componentType === 5125 ? Uint32Array : Uint16Array;
  const copy = new Uint8Array(a.count * n * C.BYTES_PER_ELEMENT);
  copy.set(new Uint8Array(bin.buffer, off, copy.length));
  return { array: new C(copy.buffer) };
}

interface CrownPrim {
  P: ArrayLike<number>;
  I: ArrayLike<number> | null;
  UV: ArrayLike<number> | null;
  chain: Level[] | null;
  blend: boolean;
}

/** One model's finest level: its card triangles with their pictures' box chains, and its opaque ones. */
function crownPrims(file: string): CrownPrim[] {
  const { json, bin } = readGlb(readFileSync(file)) as { json: any; bin: Buffer };
  const chains = new Map<number, Level[]>();
  const out: CrownPrim[] = [];
  for (const ni of json.scenes[json.scene ?? 0].nodes) {
    const node = json.nodes[ni];
    if (node.mesh === undefined) continue;
    for (const p of json.meshes[node.mesh].primitives) {
      const m = json.materials[p.material];
      const P = accessor(json, bin, p.attributes.POSITION).array;
      const I = p.indices !== undefined ? accessor(json, bin, p.indices).array : null;
      const mode = m?.alphaMode ?? 'OPAQUE';
      const tex = m?.pbrMetallicRoughness?.baseColorTexture?.index;
      if (mode === 'OPAQUE' || tex === undefined || p.attributes.TEXCOORD_0 === undefined) {
        out.push({ P, I, UV: null, chain: null, blend: false });
        continue;
      }
      let chain = chains.get(tex);
      if (!chain) {
        const img = json.images[json.textures[tex].source];
        const view = json.bufferViews[img.bufferView];
        const png = decodePng(Buffer.from(bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength))) as { width: number; height: number; rgba: Uint8Array };
        const a = new Float32Array(png.width * png.height);
        for (let i = 0; i < a.length; i++) a[i] = png.rgba[i * 4 + 3];
        chain = [{ width: png.width, height: png.height, a }];
        for (let k = 1; k < MIPS; k++) chain.push(down(chain[k - 1]));
        chains.set(tex, chain);
      }
      const blend = typeof m.extras?.swgCard?.blend === 'boolean' ? m.extras.swgCard.blend : classByName(m.name) === 'blend';
      out.push({ P, I, UV: accessor(json, bin, p.attributes.TEXCOORD_0).array, chain, blend });
    }
  }
  return out;
}

/**
 * The share of the crown's silhouette covered, at each texture level, from four level views: blending (one less
 * the product of what each layer lets through), today's cut at a half, and the rule's raised alpha cut at a half.
 * Opaque pieces cover. Only pixels a triangle of the model touches count.
 */
function coverage(prims: CrownPrim[]): { client: number[]; today: number[]; rule: number[]; texelsPerMetre: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const p of prims) {
    for (let i = 0; i < p.P.length; i += 3) {
      x0 = Math.min(x0, p.P[i]);
      x1 = Math.max(x1, p.P[i]);
      y0 = Math.min(y0, p.P[i + 1]);
      y1 = Math.max(y1, p.P[i + 1]);
      z0 = Math.min(z0, p.P[i + 2]);
      z1 = Math.max(z1, p.P[i + 2]);
    }
  }
  const span = Math.max(x1 - x0, y1 - y0, z1 - z0);
  const px = span / RES;
  const sums = { client: new Array(MIPS).fill(0), today: new Array(MIPS).fill(0), rule: new Array(MIPS).fill(0) };
  let touchedAll = 0;
  // Texel density of the cards, area-weighted, for the distance-to-level mapping.
  let densW = 0;
  let densA = 0;
  for (const p of prims) {
    if (!p.chain || !p.UV) continue;
    const nt = p.I ? p.I.length / 3 : p.P.length / 9;
    const tw = p.chain[0].width;
    const th = p.chain[0].height;
    for (let t = 0; t < nt; t++) {
      const ia = p.I ? p.I[t * 3] : t * 3;
      const ib = p.I ? p.I[t * 3 + 1] : t * 3 + 1;
      const ic = p.I ? p.I[t * 3 + 2] : t * 3 + 2;
      const ux = p.P[ib * 3] - p.P[ia * 3];
      const uy = p.P[ib * 3 + 1] - p.P[ia * 3 + 1];
      const uz = p.P[ib * 3 + 2] - p.P[ia * 3 + 2];
      const vx = p.P[ic * 3] - p.P[ia * 3];
      const vy = p.P[ic * 3 + 1] - p.P[ia * 3 + 1];
      const vz = p.P[ic * 3 + 2] - p.P[ia * 3 + 2];
      const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      const du1 = (p.UV[ib * 2] - p.UV[ia * 2]) * tw;
      const dv1 = (p.UV[ib * 2 + 1] - p.UV[ia * 2 + 1]) * th;
      const du2 = (p.UV[ic * 2] - p.UV[ia * 2]) * tw;
      const dv2 = (p.UV[ic * 2 + 1] - p.UV[ia * 2 + 1]) * th;
      const tarea = Math.abs(du1 * dv2 - du2 * dv1) / 2;
      if (area > 1e-9 && tarea > 0) {
        densW += area * Math.sqrt(tarea / area);
        densA += area;
      }
    }
  }
  for (const yaw of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    const R = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const T = new Array(MIPS).fill(null).map(() => new Float32Array(RES * RES).fill(1));
    const today = new Array(MIPS).fill(null).map(() => new Uint8Array(RES * RES));
    const rule = new Array(MIPS).fill(null).map(() => new Uint8Array(RES * RES));
    const touched = new Uint8Array(RES * RES);
    const ox = Math.min(x0 * R[0] + z0 * R[2], x1 * R[0] + z1 * R[2], x0 * R[0] + z1 * R[2], x1 * R[0] + z0 * R[2]);
    const proj = (P: ArrayLike<number>, i: number): [number, number] => [(P[i * 3] * R[0] + P[i * 3 + 2] * R[2] - ox) / px, (P[i * 3 + 1] - y0) / px];
    for (const p of prims) {
      const nt = p.I ? p.I.length / 3 : p.P.length / 9;
      for (let t = 0; t < nt; t++) {
        const id = [p.I ? p.I[t * 3] : t * 3, p.I ? p.I[t * 3 + 1] : t * 3 + 1, p.I ? p.I[t * 3 + 2] : t * 3 + 2];
        const s = id.map((k) => proj(p.P, k));
        const minX = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0])));
        const maxX = Math.min(RES - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
        const minY = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1])));
        const maxY = Math.min(RES - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
        const d = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
        if (Math.abs(d) < 1e-9) continue;
        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            const cx = x + 0.5;
            const cy = y + 0.5;
            const w1 = ((s[1][0] - cx) * (s[2][1] - cy) - (s[2][0] - cx) * (s[1][1] - cy)) / d;
            const w2 = ((s[2][0] - cx) * (s[0][1] - cy) - (s[0][0] - cx) * (s[2][1] - cy)) / d;
            const w3 = 1 - w1 - w2;
            if (w1 < 0 || w2 < 0 || w3 < 0) continue;
            const k = y * RES + x;
            touched[k] = 1;
            if (!p.chain || !p.UV) {
              for (let m = 0; m < MIPS; m++) {
                T[m][k] = 0;
                today[m][k] = 1;
                rule[m][k] = 1;
              }
              continue;
            }
            const u = w1 * p.UV[id[0] * 2] + w2 * p.UV[id[1] * 2] + w3 * p.UV[id[2] * 2];
            const v = w1 * p.UV[id[0] * 2 + 1] + w2 * p.UV[id[1] * 2 + 1] + w3 * p.UV[id[2] * 2 + 1];
            for (let m = 0; m < MIPS; m++) {
              const a = sample(p.chain[m], u, v);
              if (p.blend) T[m][k] *= 1 - a;
              else if (a >= 0.5) T[m][k] = 0;
              if (a >= 0.5) today[m][k] = 1;
              if (scaledAlpha(a, p.blend ? T_MIP : 0, m) >= 0.5) rule[m][k] = 1;
            }
          }
        }
      }
    }
    for (let k = 0; k < RES * RES; k++) {
      if (!touched[k]) continue;
      touchedAll++;
      for (let m = 0; m < MIPS; m++) {
        sums.client[m] += 1 - T[m][k];
        sums.today[m] += today[m][k];
        sums.rule[m] += rule[m][k];
      }
    }
  }
  const n = Math.max(1, touchedAll);
  return { client: sums.client.map((v) => v / n), today: sums.today.map((v) => v / n), rule: sums.rule.map((v) => v / n), texelsPerMetre: densA > 0 ? densW / densA : 64 };
}
const T_MIP = 0.1;

/** The fractional texture level a card of this density takes at a distance: 1440 lines over a 60 degree field. */
function levelAt(texelsPerMetre: number, metres: number): number {
  const perPixel = (2 * metres * Math.tan(Math.PI / 6)) / 1440;
  return Math.min(MIPS - 1, Math.max(0, Math.log2(texelsPerMetre * perPixel)));
}
const at = (series: number[], lv: number): number => {
  const i = Math.floor(lv);
  const f = lv - i;
  return i >= MIPS - 1 ? series[MIPS - 1] : series[i] * (1 - f) + series[i + 1] * f;
};

{
  const t0 = performance.now();
  const files = CANDIDATES.map((list) => list.map((f) => join(PACKS, f)).find((f) => existsSync(f)) ?? null).filter((f): f is string => !!f);
  if (files.length < 3) console.log(`skip the crown check: three tree models are not on disk under ${PACKS} (found ${files.length})`);
  else {
    const dists = [10, 20, 40, 80, 160, 320];
    const rows = files.map((f) => {
      const c = coverage(crownPrims(f));
      return { f, c, ratio: dists.map((d) => {
        const lv = levelAt(c.texelsPerMetre, d);
        const client = at(c.client, lv);
        return { d, lv, today: at(c.today, lv) / client, rule: at(c.rule, lv) / client };
      }) };
    });
    for (const r of rows) console.log(`     ${r.f.split(/[\\/]/).slice(-1)[0]}: ${r.ratio.map((x) => `${x.d} m (level ${x.lv.toFixed(1)}) today ${x.today.toFixed(2)} rule ${x.rule.toFixed(2)}`).join('; ')}`);
    const mean = (fn: (x: { today: number; rule: number }) => number, i: number) => rows.reduce((s, r) => s + fn(r.ratio[i]), 0) / rows.length;
    const today320 = mean((x) => x.today, dists.length - 1);
    ok(today320 < 0.9, `today's cut keeps under 0.9 of a blended crown at 320 m (${today320.toFixed(3)}, the mean of the three)`);
    const ruleOk = dists.every((_, i) => {
      const v = mean((x) => x.rule, i);
      return v >= 0.9 && v <= 1.1;
    });
    ok(ruleOk, `the rule keeps every crown within 0.9 to 1.1 of blending from 10 to 320 m (${dists.map((d, i) => `${d} m ${mean((x) => x.rule, i).toFixed(3)}`).join(', ')})`);
    const s = (performance.now() - t0) / 1000;
    ok(s < 30, `the check takes seconds (${s.toFixed(1)} s)`);
  }
}

console.log(`\ncardAlpha: ${passed} checks passed`);
