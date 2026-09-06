// TRE archive reader for Star Wars Galaxies client data.
// Layout (little-endian): "EERT" "5000", then eight u32 header fields, file data,
// a record table (24 bytes per record, optionally zlib-compressed), then a
// name block (optionally zlib-compressed) of NUL-terminated paths.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

const RECORD_SIZE = 24;

function decompress(buf, compression, size) {
  if (compression === 0) return buf.subarray(0, size);
  if (compression === 2) return inflateSync(buf);
  throw new Error(`Unsupported TRE compression ${compression}`);
}

function cstring(buf, offset) {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  return buf.toString('latin1', offset, end);
}

export function openTre(path) {
  const buf = readFileSync(path);
  const magic = buf.toString('latin1', 0, 8);
  if (magic !== 'EERT5000' && magic !== 'TREE0005') throw new Error(`${path}: not a TRE archive (magic ${JSON.stringify(magic)})`);
  const totalRecords = buf.readUInt32LE(8);
  const infoOffset = buf.readUInt32LE(12);
  const infoCompression = buf.readUInt32LE(16);
  const infoCompressedSize = buf.readUInt32LE(20);
  const infoSize = buf.readUInt32LE(24);
  const nameCompression = buf.readUInt32LE(28);
  const nameCompressedSize = buf.readUInt32LE(32);
  const nameSize = buf.readUInt32LE(36);

  const info = decompress(buf.subarray(infoOffset, infoOffset + infoCompressedSize), infoCompression, infoSize);
  const nameStart = infoOffset + infoCompressedSize;
  const names = decompress(buf.subarray(nameStart, nameStart + nameCompressedSize), nameCompression, nameSize);

  const records = new Map();
  for (let i = 0; i < totalRecords; i++) {
    const o = i * RECORD_SIZE;
    const rec = {
      checksum: info.readUInt32LE(o),
      size: info.readUInt32LE(o + 4),
      offset: info.readUInt32LE(o + 8),
      compression: info.readUInt32LE(o + 12),
      compressedSize: info.readUInt32LE(o + 16),
      name: cstring(names, info.readUInt32LE(o + 20)).replace(/\\/g, '/'),
      archive: path,
    };
    records.set(rec.name, rec);
  }
  return {
    path,
    records,
    read(rec) {
      return Buffer.from(decompress(buf.subarray(rec.offset, rec.offset + rec.compressedSize), rec.compression, rec.size));
    },
  };
}

/**
 * A virtual file system over every .tre in a directory. Archives are applied in
 * name order so patch archives override base data, matching the client.
 */
export function openVfs(dir) {
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.tre')).sort((a, b) => a.localeCompare(b, 'en'));
  if (files.length === 0) throw new Error(`No .tre archives found in ${dir}`);
  const index = new Map();
  const archives = [];
  for (const f of files) {
    const tre = openTre(join(dir, f));
    archives.push(tre);
    for (const rec of tre.records.values()) index.set(rec.name.toLowerCase(), { tre, rec });
  }
  return {
    archives,
    list(filter) {
      const out = [];
      for (const key of index.keys()) if (!filter || key.includes(filter.toLowerCase())) out.push(key);
      return out.sort();
    },
    has(name) {
      return index.has(name.toLowerCase().replace(/\\/g, '/'));
    },
    read(name) {
      const entry = index.get(name.toLowerCase().replace(/\\/g, '/'));
      if (!entry) throw new Error(`Not in archives: ${name}`);
      return entry.tre.read(entry.rec);
    },
  };
}
