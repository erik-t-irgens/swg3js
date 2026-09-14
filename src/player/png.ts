// A PNG decoder for the customization images. A canvas would do it in two lines, but a canvas
// stores its pixels with the alpha premultiplied and un-multiplies them on the way out, which
// zeroes the colour of every fully transparent texel and rounds the colour of translucent ones:
// the overlay masks the game's texture renderer draws keep their colour under a zero alpha and
// read it back through modulate stages, so those texels came out black (splotches on the skin,
// a black base colour under a shirt's mask). This reads the bytes as they are.
import type { Img } from './texrender';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Inflate zlib data with the browser's own decompressor. */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  void writer.write(new Uint8Array(data));
  void writer.close();
  const out = new Uint8Array(await new Response(ds.readable).arrayBuffer());
  return out;
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Decode an 8-bit, non-interlaced PNG (greyscale, RGB, palette, or either with alpha) to RGBA rows top to bottom. */
export async function decodePng(bytes: Uint8Array): Promise<Img> {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) throw new Error('not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let depth = 8;
  let colorType = 6;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let p = 8;
  while (p + 8 <= bytes.length) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    const data = bytes.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = view.getUint32(p + 8);
      height = view.getUint32(p + 12);
      depth = bytes[p + 16];
      colorType = bytes[p + 17];
      interlace = bytes[p + 20];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8) throw new Error(`PNG: ${depth}-bit images are not read`);
  if (interlace) throw new Error('PNG: interlaced images are not read');
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : 4;
  const total = idat.reduce((n, d) => n + d.length, 0);
  const z = new Uint8Array(total);
  let o = 0;
  for (const d of idat) {
    z.set(d, o);
    o += d.length;
  }
  const raw = await inflate(z);
  const stride = width * channels;
  const rgba = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const row = new Uint8Array(stride);
  let r = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[r++];
    for (let x = 0; x < stride; x++) {
      const v = raw[r + x];
      const a = x >= channels ? row[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let out: number;
      switch (filter) {
        case 1: out = v + a; break;
        case 2: out = v + b; break;
        case 3: out = v + ((a + b) >> 1); break;
        case 4: out = v + paeth(a, b, c); break;
        default: out = v;
      }
      row[x] = out & 255;
    }
    r += stride;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const s = x * channels;
      if (colorType === 6) {
        rgba[i] = row[s]; rgba[i + 1] = row[s + 1]; rgba[i + 2] = row[s + 2]; rgba[i + 3] = row[s + 3];
      } else if (colorType === 2) {
        rgba[i] = row[s]; rgba[i + 1] = row[s + 1]; rgba[i + 2] = row[s + 2]; rgba[i + 3] = 255;
      } else if (colorType === 4) {
        rgba[i] = rgba[i + 1] = rgba[i + 2] = row[s]; rgba[i + 3] = row[s + 1];
      } else if (colorType === 3) {
        const k = row[s];
        rgba[i] = palette?.[k * 3] ?? 0; rgba[i + 1] = palette?.[k * 3 + 1] ?? 0; rgba[i + 2] = palette?.[k * 3 + 2] ?? 0; rgba[i + 3] = trns && k < trns.length ? trns[k] : 255;
      } else {
        rgba[i] = rgba[i + 1] = rgba[i + 2] = row[s]; rgba[i + 3] = 255;
      }
    }
    prev.set(row);
  }
  return { width, height, rgba };
}
