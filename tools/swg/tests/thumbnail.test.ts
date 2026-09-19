// Item pictures baked at conversion: the PNG reader, the rasterizer's views, depth, texture flip and fit
// (tools/swg/thumbnail.mjs, tools/swg/png.mjs).
import assert from 'node:assert/strict';
import { crc32, deflateSync } from 'node:zlib';
import { decodePng, encodePng } from '../png.mjs';
import { iconMeshes, renderThumbnail, thumbTexture } from '../thumbnail.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

type Img = { width: number; height: number; rgba: Uint8Array };
type Mesh = { positions: Float32Array; normals?: Float32Array | null; uvs?: Float32Array | null; indices: Uint32Array; texture?: { width: number; height: number; rgba: Uint8Array; alphaTest: number } | null; color?: number[] };

// ---- 1. decodePng
const pixels = (w: number, h: number, f: (x: number, y: number) => number[]) => {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set(f(x, y), (y * w + x) * 4);
  return out;
};
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const img = pixels(7, 5, (x, y) => [x * 30, y * 50, (x * y * 13) & 255, 255 - x * 10]);
const back = decodePng(encodePng(7, 5, img));
ok(!!back && back.width === 7 && back.height === 5 && same(back.rgba, img), 'decodePng reads back what encodePng wrote');

/** A PNG written with the given filter per row (forward filters as the specification defines them). */
function filteredPng(w: number, h: number, data: Uint8Array, bpp: 3 | 4, filters: number[], opts: { depth?: number; colorType?: number } = {}): Buffer {
  const stride = w * bpp;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const f = filters[y % filters.length];
    raw[y * (stride + 1)] = f;
    for (let x = 0; x < stride; x++) {
      const v = data[y * stride + x];
      const a = x >= bpp ? data[y * stride + x - bpp] : 0;
      const up = y > 0 ? data[(y - 1) * stride + x] : 0;
      const c = y > 0 && x >= bpp ? data[(y - 1) * stride + x - bpp] : 0;
      let pred = 0;
      if (f === 1) pred = a;
      else if (f === 2) pred = up;
      else if (f === 3) pred = (a + up) >> 1;
      else if (f === 4) {
        const p = a + up - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      raw[y * (stride + 1) + 1 + x] = (v - pred) & 255;
    }
  }
  const chunk = (type: string, body: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([len, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = opts.depth ?? 8;
  ihdr[9] = opts.colorType ?? (bpp === 4 ? 6 : 2);
  // Two IDAT chunks, to check they are joined before inflating.
  const z = deflateSync(raw);
  const half = z.length >> 1;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', z.subarray(0, half)), chunk('IDAT', z.subarray(half)), chunk('IEND', Buffer.alloc(0))]);
}
const filtered = decodePng(filteredPng(7, 5, img, 4, [1, 2, 3, 4, 0]));
ok(!!filtered && same(filtered.rgba, img), 'rows filtered with Sub, Up, Average and Paeth decode to the same pixels');
const rgb = new Uint8Array(7 * 5 * 3);
for (let i = 0; i < 35; i++) rgb.set(img.subarray(i * 4, i * 4 + 3), i * 3);
const fromRgb = decodePng(filteredPng(7, 5, rgb, 3, [4, 3, 2, 1]));
ok(!!fromRgb && same(fromRgb.rgba, pixels(7, 5, (x, y) => [x * 30, y * 50, (x * y * 13) & 255, 255])), 'an RGB PNG decodes with alpha 255');
ok(decodePng(filteredPng(7, 5, img, 4, [0], { depth: 16 })) === null, 'a 16-bit PNG returns null');
ok(decodePng(Buffer.from('not a png at all, not at all, not at all')) === null, 'something that is not a PNG returns null');

// ---- meshes
const quad = (x0: number, x1: number, y0: number, y1: number, z: number, extra: Partial<Mesh> = {}): Mesh => ({
  positions: new Float32Array([x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
  uvs: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  ...extra,
});
const box = (min: number[], max: number[], color: number[]): Mesh => {
  const p: number[] = [];
  for (let i = 0; i < 8; i++) p.push(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]);
  const faces = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  const idx: number[] = [];
  for (const [a, b, c, d] of faces) idx.push(a, b, c, a, c, d);
  return { positions: new Float32Array(p), indices: new Uint32Array(idx), color };
};
const at = (r: Img, x: number, y: number) => [...r.rgba.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 4)];
const front = { yawDeg: 0, pitchDeg: 0 };

// ---- 2. A front-facing quad fills the centre and leaves a corner.
const flat = renderThumbnail([quad(-1, 1, -1, 1, 0)], { ...front })!;
ok(!!flat && flat.width === 96 && flat.height === 96, 'the picture is 96 px square by default');
ok(at(flat, 48, 48)[3] === 255 && at(flat, 1, 1)[3] === 0, 'the quad covers the centre and leaves the corner transparent');
ok(flat.coverage > 0.3 && flat.coverage < 0.9, `the quad is fitted to 88% of the square (coverage ${flat.coverage.toFixed(3)})`);
const lit = at(flat, 48, 48);
ok(lit[0] > 168 * 0.42 && lit[0] <= 168, 'a face towards the viewer is lit above the ambient');

// ---- 3. Depth: the quad nearer the viewer (+Z) wins, whichever is drawn first.
const red = quad(-1, 1, -1, 1, 0, { color: [255, 0, 0] });
const blue = quad(-0.5, 0.5, -0.5, 0.5, 0.5, { color: [0, 0, 255] });
const d1 = renderThumbnail([red, blue], { ...front })!;
const d2 = renderThumbnail([blue, red], { ...front })!;
ok(at(d1, 48, 48)[2] > 0 && at(d1, 48, 48)[0] === 0 && at(d2, 48, 48)[2] > 0 && at(d2, 48, 48)[0] === 0, 'the nearer quad wins the centre pixel in either order');

// ---- 4. The game's X flip: the model's -X half shows on the picture's right.
const tex = { width: 4, height: 1, rgba: new Uint8Array([0, 255, 0, 255, 0, 255, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]), alphaTest: 0 };
const flipped = renderThumbnail([quad(-1, 1, -1, 1, 0, { texture: tex })], { ...front, ambient: 1 })!;
const right = at(flipped, 72, 48), left = at(flipped, 24, 48);
ok(right[1] > 200 && right[0] < 50 && left[0] > 200 && left[1] < 50, 'green at u < 0.5 (the model\'s -X) is on the picture\'s right');
const turned = renderThumbnail([quad(-1, 1, -1, 1, 0, { texture: tex })])!;
ok(!!turned && at(turned, 72, 48)[1] > at(turned, 72, 48)[0], 'the default wear view (turned and tilted) keeps the sides where they were');
// A model written with --no-flip is in the client's own frame: its picture is not mirrored either.
const unflipped = renderThumbnail([quad(-1, 1, -1, 1, 0, { texture: tex })], { ...front, ambient: 1, flipX: false })!;
ok(at(unflipped, 24, 48)[1] > 200 && at(unflipped, 24, 48)[0] < 50 && at(unflipped, 72, 48)[0] > 200, 'with flipX false the model\'s -X half shows on the picture\'s left');

// ---- 5. A weapon: side on, the far end up and to the right.
const quadrants = (r: Img, test: (p: number[]) => boolean) => {
  const q = { ul: 0, ur: 0, ll: 0, lr: 0 };
  const h = r.width / 2;
  for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
    const p = at(r, x, y);
    if (!test(p)) continue;
    if (y < h) x < h ? q.ul++ : q.ur++;
    else x < h ? q.ll++ : q.lr++;
  }
  return q;
};
const covered = (p: number[]) => p[3] > 0;
const isRed = (p: number[]) => p[3] > 128 && p[0] > 150 && p[1] < 80;
const barrel = box([-0.05, -0.1, 0], [0.05, 0.1, 1.8], [150, 150, 150]);
const tip = box([-0.05, -0.1, 1.8], [0.05, 0.1, 2], [255, 0, 0]);
const gun = renderThumbnail([barrel, tip], { view: 'weapon' })!;
const g = quadrants(gun, covered);
ok(g.ll > 40 && g.ur > 40 && g.ul < g.ll / 10 && g.lr < g.ur / 10, `a long thin box lies from lower left to upper right (${JSON.stringify(g)})`);
const t = quadrants(gun, isRed);
ok(t.ur > 0 && t.ll === 0 && t.ul === 0 && t.lr === 0, 'its far end (+Z) is the upper right');
const back2 = renderThumbnail([box([-0.05, -0.1, -1.8], [0.05, 0.1, 0.2], [150, 150, 150]), box([-0.05, -0.1, -2], [0.05, 0.1, -1.8], [255, 0, 0])], { view: 'weapon' })!;
const tb = quadrants(back2, isRed);
ok(tb.ur > 0 && tb.ll === 0, 'a model reaching along -Z from its grip still points its far end up and right');
// A weapon lying along X (its far end at -X in the client's frame, +X once flipped): flipped or not, the far end is
// found on the frame the picture draws, and is up and right.
const sideGun = [box([-2, -0.1, -0.05], [-1.8, 0.4, 0.05], [255, 0, 0]), box([-1.8, -0.1, -0.05], [0.2, 0.1, 0.05], [150, 150, 150])];
const sideFlipped = renderThumbnail(sideGun, { view: 'weapon' })!;
const sideRaw = renderThumbnail(sideGun, { view: 'weapon', flipX: false })!;
const sf = quadrants(sideFlipped, isRed), su = quadrants(sideRaw, isRed);
ok(sf.ur > 0 && sf.ll === 0 && su.ur > 0 && su.ll === 0, 'a weapon along X points its far end up and right flipped or not');

// ---- 6. Nothing drawn is null.
const clear = { width: 2, height: 2, rgba: new Uint8Array(16), alphaTest: 0.5 };
ok(renderThumbnail([quad(-1, 1, -1, 1, 0, { texture: clear })]) === null, 'an alpha-tested texture that is all transparent draws nothing: null');
ok(renderThumbnail([]) === null && renderThumbnail([{ positions: new Float32Array(0), indices: new Uint32Array(0) }]) === null, 'an empty mesh list is null');
const cut = { width: 2, height: 1, rgba: new Uint8Array([255, 255, 255, 255, 255, 255, 255, 0]), alphaTest: 0 };
ok(renderThumbnail([quad(-1, 1, -1, 1, 0, { texture: cut })], { ...front })!.coverage > 0.7, 'with no alpha test the texture\'s alpha is ignored');

// ---- 7. Supersampling leaves partial alpha along an edge.
const tri: Mesh = { positions: new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0]), indices: new Uint32Array([0, 1, 2]) };
const edge = renderThumbnail([tri], { ...front })!;
let partial = 0;
for (let i = 3; i < edge.rgba.length; i += 4) if (edge.rgba[i] > 0 && edge.rgba[i] < 255) partial++;
ok(partial > 20, `a diagonal edge has partly covered pixels (${partial})`);
const hard = renderThumbnail([tri], { ...front, supersample: 1 })!;
let hardPartial = 0;
for (let i = 3; i < hard.rgba.length; i += 4) if (hard.rgba[i] > 0 && hard.rgba[i] < 255) hardPartial++;
ok(hardPartial === 0, 'without supersampling every pixel is in or out');

// ---- A pair worn far apart (gloves at the two hands) is drawn close together; one piece across the middle is not moved.
const hands = [quad(-1.7, -1.5, -0.1, 0.1, 0), quad(1.5, 1.7, -0.1, 0.1, 0)];
const pair = renderThumbnail(hands, { ...front })!;
const apart = renderThumbnail([...hands, quad(-0.01, 0.01, -0.1, 0.1, 0)], { ...front })!;
ok(pair.coverage > 0.15 && apart.coverage < 0.05, `gloves far apart fill the picture (${pair.coverage.toFixed(3)}); with something across the middle they stay where they are (${apart.coverage.toFixed(3)})`);
ok(at(pair, 48, 48)[3] === 0 && at(pair, 30, 48)[3] === 255 && at(pair, 66, 48)[3] === 255, 'the two sides keep a small gap between them');

// ---- 8. The reduced texture copy, and the entries it rides on.
const big = pixels(512, 256, (x, y) => [(x * 7 + y * 3) & 255, (x ^ y) & 255, (x * y) & 255, 255 - (x & 15)]);
const small = thumbTexture(512, 256, big);
ok(small.width === 128 && small.height === 64, 'a 512 x 256 texture is reduced to 128 x 64');
const blockAvg = (bx: number, by: number, c: number) => {
  let s = 0;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) s += big[((by * 4 + y) * 512 + bx * 4 + x) * 4 + c];
  return Math.round(s / 16);
};
ok([0, 1, 2, 3].every((c) => small.rgba[c] === blockAvg(0, 0, c) && small.rgba[((10 * 128 + 37) * 4) + c] === blockAvg(37, 10, c)), 'each output texel is the average of its 4 x 4 block');
const tiny = thumbTexture(64, 32, big.subarray(0, 64 * 32 * 4));
ok(tiny.width === 64 && tiny.height === 32 && tiny.rgba !== big && same(tiny.rgba, big.subarray(0, 64 * 32 * 4)), 'a texture already small enough is copied as it is');

const greenThumb = thumbTexture(2, 2, new Uint8Array([0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255]));
const entry: Record<string, unknown> = { path: 'texture/x.dds', png: Buffer.from('garbage, not a png'), hasAlpha: false, alphaMode: 'OPAQUE' };
Object.defineProperty(entry, 'thumb', { value: greenThumb, enumerable: false });
const group = (shader: string, m: Mesh) => ({ shader, primitives: [{ positions: m.positions, normals: m.normals, uvs: m.uvs, indices: m.indices }] });
const fromThumb = iconMeshes([group('shader/x.sht', quad(-1, 1, -1, 1, 0))], new Map([['shader/x.sht', entry]]));
const drawn = renderThumbnail(fromThumb as Mesh[], { ...front, ambient: 1 })!;
ok(!!drawn && at(drawn, 48, 48)[1] > 200 && at(drawn, 48, 48)[0] < 30, 'an entry whose png is garbage but whose thumb is set draws from the thumb');
ok(!JSON.stringify(entry).includes('thumb'), 'JSON.stringify of such an entry has no thumb');
const pngEntry = { png: encodePng(2, 1, new Uint8Array([0, 0, 255, 255, 0, 0, 255, 255])), hasAlpha: false, alphaMode: 'OPAQUE' };
const decoded = iconMeshes([group('b', quad(-1, 1, -1, 1, 0))], { b: pngEntry });
ok(decoded.length === 1 && decoded[0].texture?.width === 2 && decoded[0].texture.rgba[2] === 255, 'an entry without a thumb is decoded from its png');
const mixed = iconMeshes([group('inv', quad(-1, 1, -1, 1, 0)), group('bad', quad(-1, 1, -1, 1, 0)), group('glow', quad(-1, 1, -1, 1, 0)), group('none', quad(-1, 1, -1, 1, 0))], new Map<string, Record<string, unknown>>([
  ['inv', { invisible: true }],
  ['bad', { png: Buffer.from('broken'), hasAlpha: false, alphaMode: 'OPAQUE' }],
  ['glow', { png: pngEntry.png, hasAlpha: false, alphaMode: 'BLEND', blend: 'add' }],
]));
ok(mixed.length === 2 && !mixed[0].texture && JSON.stringify(mixed[0].color) === '[168,168,168]' && !mixed[1].texture, 'an invisible or additive group is dropped; an undecodable or missing texture draws flat grey');
const masked = iconMeshes([group('m', quad(-1, 1, -1, 1, 0))], { m: { png: pngEntry.png, hasAlpha: true, alphaMode: 'MASK' } });
ok(masked[0].texture?.alphaTest === 0.5, 'a cut-out texture is alpha-tested at half');

console.log(`${checks} checks passed`);
