// TRE archive reader for Star Wars Galaxies client data, following the engine's
// TreeFile_SearchNode.h: a 36-byte header of nine little-endian uint32 values
// (token "EERT", version "5000", numberOfFiles, tocOffset, tocCompressor,
// sizeOfTOC, blockCompressor, sizeOfNameBlock, uncompSizeOfNameBlock), file data,
// then the table of contents (24-byte records), the name block and an MD5 block.
//
// From Publish 18 on, SOE wrote version "6000" archives whose header is all
// zeros: they are data-only blobs indexed by the client's .toc files (see toc.mjs).
import { closeSync, existsSync, fstatSync, openSync, readSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { openToc, tocRank } from './toc.mjs';

const HEADER_SIZE = 36;
const RECORD_SIZE = 24;
export const CT_NONE = 0;
export const CT_DEPRECATED = 1;
export const CT_ZLIB = 2;

function cstring(buf, offset) {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  return buf.toString('latin1', offset, end);
}

/** Raw header bytes of an archive, for diagnosing unknown variants. */
export function readHeader(path) {
  const fd = openSync(path, 'r');
  const buf = Buffer.alloc(HEADER_SIZE);
  readSync(fd, buf, 0, HEADER_SIZE, 0);
  closeSync(fd);
  const fields = [];
  for (let i = 8; i < HEADER_SIZE; i += 4) fields.push(buf.readUInt32LE(i));
  return { magic: buf.toString('latin1', 0, 8), fields, hex: buf.toString('hex') };
}

/** Expand a stored block: uncompressed blocks are returned as-is. */
export function expandBlock(buf, compressor, uncompressedSize) {
  if (compressor === CT_NONE) return buf.subarray(0, uncompressedSize);
  if (compressor === CT_ZLIB) return inflateSync(buf);
  throw new Error(`compressor ${compressor} is not supported (1 is the retired SOE codec)`);
}

export function openTre(path) {
  const fd = openSync(path, 'r');
  const fileSize = fstatSync(fd).size;
  const readAt = (offset, length) => {
    const buf = Buffer.alloc(length);
    const n = readSync(fd, buf, 0, length, offset);
    if (n !== length) throw new Error(`${path}: short read at ${offset} (${n}/${length})`);
    return buf;
  };
  const readBlob = (offset, length, compressedLength, compressor) => {
    const stored = compressor === CT_NONE ? length : compressedLength;
    return Buffer.from(expandBlock(readAt(offset, stored), compressor, length));
  };

  const header = readAt(0, HEADER_SIZE);
  const token = header.toString('latin1', 0, 4);
  const version = header.toString('latin1', 4, 8);
  if (token !== 'EERT') {
    const hex = header.subarray(0, 16).toString('hex').replace(/(..)/g, '$1 ').trim();
    closeSync(fd);
    throw new Error(`not a TRE archive (starts ${JSON.stringify(token + version)}, bytes ${hex})`);
  }

  if (version === '6000') {
    return { path, version, fileSize, records: [], dataOnly: true, readBlob, close: () => closeSync(fd) };
  }
  if (version !== '5000' && version !== '4000') {
    closeSync(fd);
    throw new Error(`unknown TRE version ${JSON.stringify(version)}`);
  }

  const numberOfFiles = header.readUInt32LE(8);
  const tocOffset = header.readUInt32LE(12);
  const tocCompressor = header.readUInt32LE(16);
  const sizeOfTOC = header.readUInt32LE(20);
  const blockCompressor = header.readUInt32LE(24);
  const sizeOfNameBlock = header.readUInt32LE(28);
  const uncompSizeOfNameBlock = header.readUInt32LE(32);

  const tocBytes = tocCompressor === CT_NONE ? numberOfFiles * RECORD_SIZE : sizeOfTOC;
  const toc = expandBlock(readAt(tocOffset, tocBytes), tocCompressor, numberOfFiles * RECORD_SIZE);
  const nameStart = tocOffset + tocBytes;
  const nameBytes = blockCompressor === CT_NONE ? uncompSizeOfNameBlock : sizeOfNameBlock;
  const names = expandBlock(readAt(nameStart, nameBytes), blockCompressor, uncompSizeOfNameBlock);

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
    version,
    fileSize,
    records,
    dataOnly: false,
    readBlob,
    read(rec) {
      if (rec.deleted) throw new Error(`${rec.name} is a deletion marker in ${path}`);
      return readBlob(rec.offset, rec.length, rec.compressedLength, rec.compressor);
    },
    close: () => closeSync(fd),
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
 * A virtual file system over every .tre and .toc in a directory. Self-indexed
 * (5000) archives are applied in priority order, then each .toc index in SKU
 * order, so later publishes override earlier ones and deletion markers hide
 * files, matching the client. `filter(fileName)` restricts which archives may
 * supply data (for example only retail ones); .toc files are always read since
 * they hold no assets, but entries pointing at excluded archives are ignored.
 */
export function openVfs(dir, { filter, log = (msg) => console.error(msg) } = {}) {
  const treNames = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.tre'));
  const tocNames = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.toc')).sort((a, b) => tocRank(a) - tocRank(b) || a.localeCompare(b, 'en'));
  const archives = new Map();
  const skipped = [];
  const allowed = (name) => !filter || filter(name);

  const archiveFor = (name) => {
    const key = name.toLowerCase();
    if (archives.has(key)) return archives.get(key);
    let path = join(dir, name);
    if (!existsSync(path) && existsSync(join(dir, 'tres', name))) path = join(dir, 'tres', name);
    let tre = null;
    if (!existsSync(path)) {
      log(`missing archive ${name}`);
    } else {
      try {
        tre = openTre(path);
      } catch (err) {
        log(`skipping ${name}: ${err.message}`);
        skipped.push(name);
      }
    }
    archives.set(key, tre);
    return tre;
  };

  const index = new Map();
  const apply = (name, source) => {
    const key = name.toLowerCase();
    if (source.deleted) index.delete(key);
    else index.set(key, source);
  };

  // Self-indexed archives first, in publish order.
  const selfIndexed = treNames.filter(allowed).sort((a, b) => archiveRank(a) - archiveRank(b) || a.localeCompare(b, 'en'));
  let dataOnly = 0;
  for (const f of selfIndexed) {
    const tre = archiveFor(f);
    if (!tre) continue;
    if (tre.dataOnly) {
      dataOnly++;
      continue;
    }
    for (const rec of tre.records) apply(rec.name, { archive: tre.path, deleted: rec.deleted, size: rec.length, read: () => tre.read(rec) });
  }

  // Then the client's .toc indexes, which resolve the data-only archives.
  let indexed = 0;
  const tocsUsed = [];
  for (const f of tocNames) {
    let toc;
    try {
      toc = openToc(join(dir, f));
    } catch (err) {
      log(`skipping ${f}: ${err.message}`);
      continue;
    }
    tocsUsed.push(f);
    for (const e of toc.entries) {
      const treeName = toc.treeFiles[e.treeFileIndex];
      if (treeName === undefined || !allowed(treeName)) continue;
      const tre = archiveFor(treeName);
      if (!tre) continue;
      indexed++;
      apply(e.name, { archive: tre.path, deleted: e.deleted, size: e.length, read: () => tre.readBlob(e.offset, e.length, e.compressedLength, e.compressor) });
    }
  }

  const opened = [...archives.values()].filter(Boolean);
  if (!opened.length) throw new Error(`None of the archives in ${dir} could be read`);
  if (dataOnly && !tocsUsed.length) log(`${dataOnly} data-only (6000) archives found but no .toc index to read them with`);

  const norm = (name) => name.toLowerCase().replace(/\\/g, '/');
  return {
    archives: opened,
    tocs: tocsUsed,
    skipped,
    summary: `${opened.length} archives (${dataOnly} data-only), ${tocsUsed.length} index files, ${indexed} indexed entries, ${index.size} files`,
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
      return e ? { archive: e.archive, size: e.size } : null;
    },
    read(name) {
      const entry = index.get(norm(name));
      if (!entry) throw new Error(`Not in archives: ${name}`);
      return entry.read();
    },
    close() {
      for (const a of opened) a.close();
    },
  };
}
