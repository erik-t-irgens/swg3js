// Reading a converted model back, shrinking its textures, and writing it out again.
//
// The scene bake never converts anything from the archives: it takes the GLBs the planet commands
// already wrote and makes smaller copies of them for a camera that never moves. **It reads the
// packs and writes only under `scenes/`** -- see `sceneOut` in `scenebake.mjs`, which is the one
// thing in the bake that names an output file.
//
// Everything here is pure: buffers in, buffers out, no file system. That is what lets the node test
// build a GLB by hand, shrink it and read it back without a converted world anywhere in sight.

import { decodePng, encodePng } from './png.mjs';

const MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** Split a GLB into its glTF document and its binary blob. Throws on anything that is not one. */
export function readGlb(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length < 12 || b.readUInt32LE(0) !== MAGIC) throw new Error('not a GLB');
  let off = 12;
  let json = null;
  let bin = Buffer.alloc(0);
  while (off + 8 <= b.length) {
    const len = b.readUInt32LE(off);
    const type = b.readUInt32LE(off + 4);
    const data = b.subarray(off + 8, off + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(data.toString('utf8'));
    else if (type === CHUNK_BIN) bin = data;
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new Error('a GLB with no glTF document');
  return { json, bin };
}

/** Put one back together. The JSON chunk pads with spaces and the binary one with zeroes, as the format says. */
export function buildGlb(json, bin) {
  const text = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (text.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + text.length + jsonPad + (bin.length ? 8 + bin.length + binPad : 0);
  const out = Buffer.alloc(total);
  out.writeUInt32LE(MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  let off = 12;
  out.writeUInt32LE(text.length + jsonPad, off);
  out.writeUInt32LE(CHUNK_JSON, off + 4);
  text.copy(out, off + 8);
  out.fill(0x20, off + 8 + text.length, off + 8 + text.length + jsonPad);
  off += 8 + text.length + jsonPad;
  if (bin.length) {
    out.writeUInt32LE(bin.length + binPad, off);
    out.writeUInt32LE(CHUNK_BIN, off + 4);
    bin.copy(out, off + 8);
  }
  return out;
}

/**
 * Shrink an RGBA image by averaging over the area each new texel covers.
 *
 * An area average rather than a bilinear sample, because these are shrinks and often by a lot: a
 * bilinear sample reads four texels however far it is shrinking, so a 1024 taken to 64 would be
 * reading one texel in sixteen and dropping the rest, which is aliasing by another name.
 */
export function shrinkRgba(rgba, w, h, tw, th) {
  if (tw === w && th === h) return rgba;
  const out = new Uint8Array(tw * th * 4);
  const sx = w / tw;
  const sy = h / th;
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(h, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(w, Math.ceil((x + 1) * sx)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * w + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) {
          r += rgba[i];
          g += rgba[i + 1];
          b += rgba[i + 2];
          a += rgba[i + 3];
          n++;
        }
      }
      const o = (y * tw + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

/**
 * Which images feed a cut-out material.
 *
 * These need a floor of their own. A cut-out is decided by a threshold on alpha, and averaging
 * alpha down is exactly what thins a frond until it disappears: a leaf that covered three texels in
 * eight comes out at 0.375 alpha and fails a 0.5 test everywhere at once. Shrinking them less is
 * the cheap half of the answer; the honest other half is that foliage is the first thing to look at
 * on a screen, and no measurement here can stand in for that.
 */
export function maskImages(json) {
  const out = new Set();
  const texImage = (i) => json.textures?.[i]?.source;
  for (const m of json.materials ?? []) {
    if (m.alphaMode !== 'MASK') continue;
    const slots = [m.pbrMetallicRoughness?.baseColorTexture, m.emissiveTexture, m.normalTexture, m.occlusionTexture, m.pbrMetallicRoughness?.metallicRoughnessTexture];
    for (const s of slots) {
      if (!s || s.index === undefined) continue;
      const img = texImage(s.index);
      if (img !== undefined) out.add(img);
    }
  }
  return out;
}

/**
 * Rebuild a model's binary blob with some bufferViews replaced.
 *
 * Every view is laid out afresh, four-byte aligned, because an image that changed size moves
 * everything after it. A view's `byteStride` and `target` are carried across untouched: they
 * describe how the vertex data is read and have nothing to do with where it sits.
 */
export function relayout(json, bin, replaced) {
  const views = json.bufferViews ?? [];
  const parts = [];
  let at = 0;
  const next = views.map((v, i) => {
    const data = replaced.get(i) ?? bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
    const pad = (4 - (at % 4)) % 4;
    if (pad) {
      parts.push(Buffer.alloc(pad));
      at += pad;
    }
    parts.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
    const out = { ...v, byteOffset: at, byteLength: data.length };
    at += data.length;
    return out;
  });
  const blob = Buffer.concat(parts);
  const doc = { ...json, bufferViews: next, buffers: [{ ...(json.buffers?.[0] ?? {}), byteLength: blob.length }] };
  return { json: doc, bin: blob };
}

/**
 * Make a smaller copy of one model for a scene: every texture taken down to the size the fixed
 * camera really needs, everything else carried across as it is.
 *
 * `target(sourceDim, isMask)` answers the dimension to take an image to, so the caller owns the
 * rule and this owns the mechanics. An image that cannot be decoded is left exactly as it was
 * rather than dropped, since a model with a missing texture is worse than a model with a big one.
 */
export function shrinkModel(buf, target) {
  const { json, bin } = readGlb(buf);
  const masks = maskImages(json);
  const replaced = new Map();
  const images = [];
  for (let i = 0; i < (json.images ?? []).length; i++) {
    const im = json.images[i];
    if (im.bufferView === undefined) continue;
    const view = json.bufferViews?.[im.bufferView];
    if (!view) continue;
    const raw = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const decoded = decodePng(raw);
    if (!decoded) {
      images.push({ index: i, kept: true, why: 'not a PNG this reader knows' });
      continue;
    }
    const src = Math.max(decoded.width, decoded.height);
    const want = target(src, masks.has(i));
    if (want >= src) {
      images.push({ index: i, from: src, to: src, kept: true });
      continue;
    }
    const tw = Math.max(1, Math.round((decoded.width * want) / src));
    const th = Math.max(1, Math.round((decoded.height * want) / src));
    const small = shrinkRgba(decoded.rgba, decoded.width, decoded.height, tw, th);
    replaced.set(im.bufferView, encodePng(tw, th, small));
    images.push({ index: i, from: src, to: want, mask: masks.has(i), bytesBefore: view.byteLength, bytesAfter: replaced.get(im.bufferView).length });
  }
  const laid = relayout(json, bin, replaced);
  return { buf: buildGlb(laid.json, laid.bin), images, before: buf.length };
}
