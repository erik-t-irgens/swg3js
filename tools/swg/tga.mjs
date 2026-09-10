// Targa decoder for terrain bitmaps, mirroring the engine's TargaFormat loader: uncompressed
// and RLE, true-colour, colour-mapped and 8-bit greyscale. Returns rows top-down, one byte
// per pixel (the first stored byte of each pixel, which is what the terrain bitmap filter reads).

export function decodeTga(buf) {
  const idLength = buf[0];
  const colorMapType = buf[1];
  const imageType = buf[2];
  const cmStart = buf.readUInt16LE(3);
  const cmLength = buf.readUInt16LE(5);
  const cmDepth = buf[7];
  const width = buf.readUInt16LE(12);
  const height = buf.readUInt16LE(14);
  const pixelDepth = buf[16];
  const descriptor = buf[17];
  const topToBottom = (descriptor & 0x20) !== 0;
  if (![1, 2, 3, 9, 10, 11].includes(imageType)) throw new Error(`tga: unsupported image type ${imageType}`);
  if (cmStart !== 0) throw new Error('tga: unsupported colour map start');
  let o = 18 + idLength;
  const cmBytes = cmDepth >> 3;
  let cmap = null;
  if (colorMapType === 1) {
    cmap = buf.subarray(o, o + cmLength * cmBytes);
    o += cmLength * cmBytes;
  }
  const bpp = pixelDepth >> 3;
  const rle = imageType >= 9;
  const pixels = new Uint8Array(width * height);
  const rgba = new Uint8Array(width * height * 4);
  // Value of one pixel: greyscale -> the byte, colour-mapped -> first byte of the palette entry, true colour -> first stored byte.
  const value = (at) => {
    if (cmap) {
      const idx = bpp === 2 ? buf.readUInt16LE(at) : buf[at];
      return cmap[idx * cmBytes];
    }
    return buf[at];
  };
  // The full colour of one pixel (stored BGR(A), or a palette entry, or a grey level).
  const colour = (at, out, o) => {
    let src = buf;
    let depth = bpp;
    if (cmap) {
      const idx = bpp === 2 ? buf.readUInt16LE(at) : buf[at];
      src = cmap;
      at = idx * cmBytes;
      depth = cmBytes;
    }
    if (depth >= 3) {
      out[o] = src[at + 2];
      out[o + 1] = src[at + 1];
      out[o + 2] = src[at];
      out[o + 3] = depth === 4 ? src[at + 3] : 255;
    } else if (depth === 2) {
      const v = src[at] | (src[at + 1] << 8);
      out[o] = ((v >> 10) & 31) * 255 / 31;
      out[o + 1] = ((v >> 5) & 31) * 255 / 31;
      out[o + 2] = (v & 31) * 255 / 31;
      out[o + 3] = 255;
    } else {
      out[o] = out[o + 1] = out[o + 2] = src[at];
      out[o + 3] = 255;
    }
  };
  const put = (row, x, at) => {
    const y = topToBottom ? row : height - 1 - row;
    pixels[y * width + x] = value(at);
    colour(at, rgba, (y * width + x) * 4);
  };
  if (!rle) {
    for (let row = 0; row < height; row++) {
      for (let x = 0; x < width; x++) {
        put(row, x, o);
        o += bpp;
      }
    }
  } else {
    for (let row = 0; row < height; row++) {
      let x = 0;
      while (x < width) {
        const packet = buf[o++];
        const count = (packet & 0x7f) + 1;
        if (packet & 0x80) {
          for (let k = 0; k < count && x < width; k++) put(row, x++, o);
          o += bpp;
        } else {
          for (let k = 0; k < count && x < width; k++) {
            put(row, x++, o);
            o += bpp;
          }
        }
      }
    }
  }
  return { width, height, pixels, rgba, imageType, pixelDepth, greyscale: imageType === 3 || imageType === 11 };
}

/** Pack a decoded bitmap as the game's terrain heightmap file: "HMAP", uint32 width, uint32 height, top-down bytes. */
export function encodeHeightmap(img) {
  const out = Buffer.alloc(12 + img.pixels.length);
  out.write('HMAP', 0, 'latin1');
  out.writeUInt32LE(img.width, 4);
  out.writeUInt32LE(img.height, 8);
  Buffer.from(img.pixels.buffer, img.pixels.byteOffset, img.pixels.length).copy(out, 12);
  return out;
}
