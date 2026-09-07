// Table-of-contents index files (.toc) used by the CU and NGE clients, following
// the engine's TreeFile::SearchTOC. Header (36 bytes): token "TOC " and version
// "0001" as little-endian tags, uint8 tocCompressor, uint8 nameBlockCompressor,
// two unused bytes, then uint32 numberOfFiles, sizeOfTOC, sizeOfNameBlock,
// uncompSizeOfNameBlock, numberOfTreeFiles, sizeOfTreeFileNameBlock. Then the
// archive name block, the entries (24 bytes each, optionally zlib), and the
// file name block (optionally zlib). Each entry's name field holds the name's
// LENGTH on disk; names are laid out consecutively in that order.
import { closeSync, openSync, readSync } from 'node:fs';
import { expandBlock } from './tre.mjs';

const HEADER_SIZE = 36;
const ENTRY_SIZE = 24;

function tag(buf, offset) {
  return Buffer.from(buf.subarray(offset, offset + 4)).reverse().toString('latin1');
}

export function openToc(path) {
  const fd = openSync(path, 'r');
  const readAt = (offset, length) => {
    const buf = Buffer.alloc(length);
    const n = readSync(fd, buf, 0, length, offset);
    if (n !== length) throw new Error(`short read at ${offset}`);
    return buf;
  };
  try {
    const h = readAt(0, HEADER_SIZE);
    const token = tag(h, 0);
    const version = tag(h, 4);
    if (token === 'NTOC') throw new Error('encrypted TitanPak index, not supported');
    if (token !== 'TOC ') throw new Error(`not a TOC index (token ${JSON.stringify(token)})`);
    if (version !== '0001') throw new Error(`unknown TOC version ${JSON.stringify(version)}`);
    const tocCompressor = h[8];
    const nameCompressor = h[9];
    const numberOfFiles = h.readUInt32LE(12);
    const sizeOfTOC = h.readUInt32LE(16);
    const sizeOfNameBlock = h.readUInt32LE(20);
    const uncompSizeOfNameBlock = h.readUInt32LE(24);
    const numberOfTreeFiles = h.readUInt32LE(28);
    const sizeOfTreeFileNameBlock = h.readUInt32LE(32);

    let pos = HEADER_SIZE;
    const treeBlock = readAt(pos, sizeOfTreeFileNameBlock);
    pos += sizeOfTreeFileNameBlock;
    const treeFiles = [];
    for (let i = 0, cursor = 0; i < numberOfTreeFiles; i++) {
      let end = cursor;
      while (end < treeBlock.length && treeBlock[end] !== 0) end++;
      treeFiles.push(treeBlock.toString('latin1', cursor, end).replace(/\\/g, '/'));
      cursor = end + 1;
    }

    const tocUncompressed = numberOfFiles * ENTRY_SIZE;
    const tocStored = tocCompressor === 0 ? tocUncompressed : sizeOfTOC;
    const entriesBuf = expandBlock(readAt(pos, tocStored), tocCompressor, tocUncompressed);
    pos += tocStored;
    const nameStored = nameCompressor === 0 ? uncompSizeOfNameBlock : sizeOfNameBlock;
    const names = expandBlock(readAt(pos, nameStored), nameCompressor, uncompSizeOfNameBlock);

    const entries = [];
    let nameCursor = 0;
    for (let i = 0; i < numberOfFiles; i++) {
      const o = i * ENTRY_SIZE;
      const nameLength = entriesBuf.readUInt32LE(o + 8);
      const length = entriesBuf.readUInt32LE(o + 16);
      entries.push({
        compressor: entriesBuf[o],
        treeFileIndex: entriesBuf.readUInt16LE(o + 2),
        crc: entriesBuf.readUInt32LE(o + 4),
        offset: entriesBuf.readUInt32LE(o + 12),
        length,
        compressedLength: entriesBuf.readUInt32LE(o + 20),
        name: names.toString('latin1', nameCursor, nameCursor + nameLength).replace(/\\/g, '/'),
        deleted: length === 0,
      });
      nameCursor += nameLength + 1;
    }
    return { path, treeFiles, entries };
  } finally {
    closeSync(fd);
  }
}

/** sku0 first, then sku1..3, then anything else (server projects' own indexes). */
export function tocRank(file) {
  const m = /^sku(\d+)_client\.toc$/i.exec(file);
  return m ? parseInt(m[1], 10) : 100;
}
