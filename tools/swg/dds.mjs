// DirectDraw Surface decoder for the formats the SWG client uses:
// DXT1/DXT3/DXT5 block compression and uncompressed masked RGB(A) / luminance.
// Returns the top mip level as RGBA8; an 8-bit luminance volume comes back as its bytes (decodeDdsVolume).

function rgb565(v) {
  return [((v >> 11) & 31) * 255 / 31, ((v >> 5) & 63) * 255 / 63, (v & 31) * 255 / 31];
}

function decodeBlockColors(buf, o, out, ox, oy, w, h, alphaFn, forceFour) {
  const c0 = buf.readUInt16LE(o);
  const c1 = buf.readUInt16LE(o + 2);
  const a = rgb565(c0);
  const b = rgb565(c1);
  const colors = [a, b];
  if (c0 > c1 || forceFour) {
    colors.push([(2 * a[0] + b[0]) / 3, (2 * a[1] + b[1]) / 3, (2 * a[2] + b[2]) / 3]);
    colors.push([(a[0] + 2 * b[0]) / 3, (a[1] + 2 * b[1]) / 3, (a[2] + 2 * b[2]) / 3]);
  } else {
    colors.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
    colors.push(null);
  }
  const bits = buf.readUInt32LE(o + 4);
  for (let py = 0; py < 4; py++) {
    for (let px = 0; px < 4; px++) {
      const x = ox + px;
      const y = oy + py;
      if (x >= w || y >= h) continue;
      const idx = (bits >> ((py * 4 + px) * 2)) & 3;
      const c = colors[idx];
      const p = (y * w + x) * 4;
      if (!c) {
        out[p] = out[p + 1] = out[p + 2] = 0;
        out[p + 3] = 0;
      } else {
        out[p] = c[0];
        out[p + 1] = c[1];
        out[p + 2] = c[2];
        out[p + 3] = alphaFn ? alphaFn(px, py) : 255;
      }
    }
  }
}

function dxt5Alpha(buf, o) {
  const a0 = buf[o];
  const a1 = buf[o + 1];
  const table = [a0, a1];
  if (a0 > a1) for (let i = 1; i <= 6; i++) table.push(((7 - i) * a0 + i * a1) / 7);
  else {
    for (let i = 1; i <= 4; i++) table.push(((5 - i) * a0 + i * a1) / 5);
    table.push(0, 255);
  }
  let bits = 0n;
  for (let i = 0; i < 6; i++) bits |= BigInt(buf[o + 2 + i]) << BigInt(8 * i);
  return (px, py) => table[Number((bits >> BigInt((py * 4 + px) * 3)) & 7n)];
}

function maskInfo(mask) {
  if (!mask) return null;
  let shift = 0;
  while (((mask >>> shift) & 1) === 0) shift++;
  let bits = 0;
  while (((mask >>> (shift + bits)) & 1) === 1) bits++;
  return { shift, max: (1 << bits) - 1 };
}

/** Bytes one mip level of the given size takes in this file's pixel format. */
function levelBytes(buf, width, height) {
  const pfFlags = buf.readUInt32LE(80);
  if (pfFlags & 0x4) {
    const fourCC = buf.toString('latin1', 84, 88);
    return Math.max(1, Math.ceil(width / 4)) * Math.max(1, Math.ceil(height / 4)) * (fourCC === 'DXT1' ? 8 : 16);
  }
  return width * height * (buf.readUInt32LE(88) / 8);
}

/** Whether the file holds the six faces of a cube map (DDSCAPS2_CUBEMAP). */
export function isDdsCube(buf) {
  return buf.toString('latin1', 0, 4) === 'DDS ' && (buf.readUInt32LE(112) & 0x200) !== 0;
}

/**
 * The six faces of a cube map DDS, each decoded at its top level, in the file's order:
 * +X, -X, +Y, -Y, +Z, -Z. Every face carries its whole mip chain before the next face.
 */
export function decodeDdsCube(buf) {
  if (!isDdsCube(buf)) throw new Error('Not a cube map DDS');
  const height = buf.readUInt32LE(12);
  const width = buf.readUInt32LE(16);
  const mips = buf.readUInt32LE(8) & 0x20000 ? Math.max(1, buf.readUInt32LE(28)) : 1;
  let faceBytes = 0;
  for (let m = 0, w = width, h = height; m < mips; m++, w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) faceBytes += levelBytes(buf, w, h);
  const faces = [];
  for (let f = 0; f < 6; f++) faces.push(decodeDds(buf, 128 + f * faceBytes));
  return { size: width, faces };
}

/**
 * A volume texture's top level (DDSCAPS2_VOLUME): width × height × depth texels, x fastest, then y, then z,
 * the order WebGL's texImage3D takes. Only 8-bit luminance is read (the client's noise volumes); anything else throws.
 */
export function decodeDdsVolume(buf) {
  if (buf.length < 128 || buf.toString('latin1', 0, 4) !== 'DDS ') throw new Error('Not a DDS file');
  if ((buf.readUInt32LE(112) & 0x200000) === 0) throw new Error('Not a volume DDS');
  const pfFlags = buf.readUInt32LE(80);
  const bitCount = buf.readUInt32LE(88);
  if ((pfFlags & 0x20000) === 0 || bitCount !== 8) throw new Error(`Unsupported volume format (flags 0x${pfFlags.toString(16)}, ${bitCount}-bit); only 8-bit luminance is read`);
  const height = buf.readUInt32LE(12);
  const width = buf.readUInt32LE(16);
  const depth = buf.readUInt32LE(24);
  const bytes = width * height * depth;
  if (!bytes) throw new Error(`Empty volume ${width}x${height}x${depth}`);
  if (buf.length < 128 + bytes) throw new Error(`Volume ${width}x${height}x${depth} needs ${bytes} bytes, the file has ${buf.length - 128}`);
  return { width, height, depth, data: new Uint8Array(buf.subarray(128, 128 + bytes)) };
}

export function decodeDds(buf, dataOffset = 128) {
  if (buf.toString('latin1', 0, 4) !== 'DDS ') throw new Error('Not a DDS file');
  const height = buf.readUInt32LE(12);
  const width = buf.readUInt32LE(16);
  const pfFlags = buf.readUInt32LE(80);
  const fourCC = buf.toString('latin1', 84, 88);
  const bitCount = buf.readUInt32LE(88);
  const masks = [buf.readUInt32LE(92), buf.readUInt32LE(96), buf.readUInt32LE(100), buf.readUInt32LE(104)];
  const data = buf.subarray(dataOffset);
  const out = new Uint8Array(width * height * 4);
  let hasAlpha = false;

  if (pfFlags & 0x4) {
    const bw = Math.max(1, Math.ceil(width / 4));
    const bh = Math.max(1, Math.ceil(height / 4));
    const blockSize = fourCC === 'DXT1' ? 8 : 16;
    if (!['DXT1', 'DXT2', 'DXT3', 'DXT4', 'DXT5'].includes(fourCC)) throw new Error(`Unsupported DDS fourCC ${fourCC}`);
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        const o = (by * bw + bx) * blockSize;
        if (fourCC === 'DXT1') {
          decodeBlockColors(data, o, out, bx * 4, by * 4, width, height, null, false);
        } else if (fourCC === 'DXT2' || fourCC === 'DXT3') {
          const alpha = (px, py) => {
            const nib = (data.readUInt16LE(o + py * 2) >> (px * 4)) & 15;
            return nib * 17;
          };
          decodeBlockColors(data, o + 8, out, bx * 4, by * 4, width, height, alpha, true);
        } else {
          decodeBlockColors(data, o + 8, out, bx * 4, by * 4, width, height, dxt5Alpha(data, o), true);
        }
      }
    }
    hasAlpha = fourCC !== 'DXT1' || out.some((v, i) => i % 4 === 3 && v < 255);
  } else if (pfFlags & 0x40 || pfFlags & 0x20000) {
    const luminance = !!(pfFlags & 0x20000);
    const bytes = bitCount / 8;
    const r = maskInfo(masks[0]);
    const g = luminance ? r : maskInfo(masks[1]);
    const b = luminance ? r : maskInfo(masks[2]);
    const a = pfFlags & 0x1 ? maskInfo(masks[3]) : null;
    for (let i = 0; i < width * height; i++) {
      let v = 0;
      for (let k = 0; k < bytes; k++) v |= data[i * bytes + k] << (8 * k);
      v >>>= 0;
      const ch = (m) => (m ? Math.round(((v >>> m.shift) & m.max) * 255 / m.max) : 0);
      out[i * 4] = ch(r);
      out[i * 4 + 1] = ch(g);
      out[i * 4 + 2] = ch(b);
      out[i * 4 + 3] = a ? ch(a) : 255;
      if (a && out[i * 4 + 3] < 255) hasAlpha = true;
    }
  } else {
    throw new Error(`Unsupported DDS pixel format flags 0x${pfFlags.toString(16)}`);
  }
  return { width, height, rgba: out, hasAlpha, format: pfFlags & 0x4 ? fourCC : `${bitCount}-bit` };
}
