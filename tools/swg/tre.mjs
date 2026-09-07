// TRE archive reader for Star Wars Galaxies client data, following the engine's
// TreeFile_SearchNode.h: a 36-byte header of nine little-endian uint32 values
// (token "EERT", version "5000", numberOfFiles, tocOffset, tocCompressor,
// sizeOfTOC, blockCompressor, sizeOfNameBlock, uncompSizeOfNameBlock), file data,
// then the table of contents (24-byte records), the name block and an MD5 block.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

const HEADER_SIZE = 36;
const RECORD_SIZE = 24;
export const CT_NONE = 0;
export const CT_DEPRECATED = 1;
export const CT_ZLIB = 2;

function expand(buf, compressor, uncompressedSize) {
  if (compressor === CT_NONE) return buf.subarray(0, uncompressedSize);
  if (compressor === CT_ZLIB) return inflateSync(buf);
  throw new Error(`Unsupported TRE compressor ${compressor}`);
}

function cstring(buf, offset) {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  return buf.toString('latin1', offset, end);
}

export function openTre(path) {
  const buf = readFileSync(path);
  const token = buf.toString('latin1', 0, 4);
  const version = buf.toString('latin1', 4, 8);
  if (token !== 'EERT' || (version !== '5000' && version !== '4000')) {
    const hex = buf.subarray(0, 16).toString('hex').replace(/(..)/g, '$1 ').trim();
    throw new Error(`not a TRE archive I recognise (starts ${JSON.stringify(token + version)}, bytes ${hex})`);
  }
  const numberOfFiles = buf.readUInt32LE(8);
  const tocOffset = buf.readUInt32LE(12);
  const tocCompressor = buf.readUInt32LE(16);
  const sizeOfTOC = buf.readUInt32LE(20);
  const blockCompressor = buf.readUInt32LE(24);
  const sizeOfNameBlock = buf.readUInt32LE(28);
  const uncompSizeOfNameBlock = buf.readUInt32LE(32);

  const tocBytes = tocCompressor === CT_NONE ? numberOfFiles * RECORD_SIZE : sizeOfTOC;
  const toc = expand(buf.subarray(tocOffset, tocOffset + tocBytes), tocCompressor, numberOfFiles * RECORD_SIZE);
  const nameStart = tocOffset + tocBytes;
  const nameBytes = blockCompressor === CT_NONE ? uncompSizeOfNameBlock : sizeOfNameBlock;
  const names = expand(buf.subarray(nameStart, nameStart + nameBytes), blockCompressor, uncompSizeOfNameBlock);

  const records = [];
  for (let i = 0; i < numberOfFiles; i++) {
    const o = i * RECORD_SIZE;
    const length = toc.readInt32LE(o + 4);
    records.push({
      crc: toc.readUInt32LE(o),
      length,
      offset: toc.readInt32LE(o + 8),
      compressor: toc.readInt32LE(o + 12),
      compressedLength: toc.readInt32LE(o + 16),
      name: cstring(names, toc.readInt32LE(o + 20)).replace(/\\/g, '/'),
      /** A zero-length record hides the file from lower-priority archives. */
      deleted: length === 0,
      archive: path,
    });
  }
  return {
    path,
    records,
    read(rec) {
      if (rec.deleted) throw new Error(`${rec.name} is a deletion marker in ${path}`);
      if (rec.compressor === CT_NONE) return Buffer.from(buf.subarray(rec.offset, rec.offset + rec.length));
      if (rec.compressor === CT_ZLIB) return inflateSync(buf.subarray(rec.offset, rec.offset + rec.compressedLength));
      throw new Error(`${rec.name}: compressor ${rec.compressor} is not supported (1 is the retired SOE codec)`);
    },
  };
}

function publish(major, minor) {
  return parseInt(major, 10) * 100 + (minor ? parseInt(minor, 10) : 0);
}

/**
 * Search priority of an archive, higher wins, modelled on the client's
 * [SharedFile] searchTree ordering: bottom first, base data, then each publish's
 * patch archives in order, with SKU (expansion) archives just above the matching
 * base patch and hotfixes above that. Archives with unknown names (server-side
 * custom content) sort above everything retail, as the client would place them.
 */
export function archiveRank(file) {
  const n = file.toLowerCase().replace(/\.tre$/, '');
  if (n === 'bottom') return 0;
  if (n === 'default_patch') return 1_000_000;
  if (n === 'holidays') return 999_999;
  let m;
  if ((m = /^data_sku(\d+)_(\d+)$/.exec(n))) return 1050 + parseInt(m[2], 10);
  if (n.startsWith('data_')) return 1;
  if ((m = /^(patch|hotfix)_sku(\d+)_(\d+)(?:_(\d+))?/.exec(n))) return publish(m[3], m[4]) + (m[1] === 'hotfix' ? 6 : 2);
  if ((m = /^(patch|hotfix)_(\d+)(?:_(\d+))?/.exec(n))) return publish(m[2], m[3]) + (m[1] === 'hotfix' ? 4 : 0);
  return 500_000;
}

/**
 * A virtual file system over every .tre in a directory. Archives are applied in
 * priority order so later publishes override earlier ones and deletion markers
 * hide files, matching the client. Pass a `filter(fileName)` to restrict which
 * archives are mounted (for example only retail ones).
 */
export function openVfs(dir, { filter } = {}) {
  let files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.tre'));
  if (filter) files = files.filter(filter);
  files.sort((a, b) => archiveRank(a) - archiveRank(b) || a.localeCompare(b, 'en'));
  if (files.length === 0) throw new Error(`No .tre archives found in ${dir}`);
  const index = new Map();
  const archives = [];
  const skipped = [];
  for (const f of files) {
    let tre;
    try {
      tre = openTre(join(dir, f));
    } catch (err) {
      skipped.push(f);
      console.error(`skipping ${f}: ${err.message}`);
      continue;
    }
    archives.push(tre);
    for (const rec of tre.records) {
      const key = rec.name.toLowerCase();
      if (rec.deleted) index.delete(key);
      else index.set(key, { tre, rec });
    }
  }
  const norm = (name) => name.toLowerCase().replace(/\\/g, '/');
  if (!archives.length) throw new Error(`None of the ${files.length} archives in ${dir} could be read`);
  return {
    archives,
    skipped,
    order: files,
    list(filterText) {
      const out = [];
      for (const key of index.keys()) if (!filterText || key.includes(filterText.toLowerCase())) out.push(key);
      return out.sort();
    },
    has(name) {
      return index.has(norm(name));
    },
    stat(name) {
      const e = index.get(norm(name));
      return e ? { archive: e.tre.path, size: e.rec.length, compressor: e.rec.compressor } : null;
    },
    read(name) {
      const entry = index.get(norm(name));
      if (!entry) throw new Error(`Not in archives: ${name}`);
      return entry.tre.read(entry.rec);
    },
  };
}
