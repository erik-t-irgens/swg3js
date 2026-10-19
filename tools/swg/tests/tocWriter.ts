// A client index and a data-only archive written the way the converter reads them (toc.mjs, tre.mjs), for the
// tests of SOE's final names list (finalNames.test.ts, lateStatus.test.ts). Not a test itself. Everything written is
// TEST bytes in a temporary folder.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

export interface TocEntry {
  name: string;
  tree: number;
  offset: number;
  length: number;
  stored: number;
  comp: number;
}

/** A TOC 0001 index of `entries` into `treeFiles`, written as `openToc` reads it (names stored, no compression). */
export function writeToc(file: string, treeFiles: string[], entries: TocEntry[]): void {
  const treeBlock = Buffer.from(treeFiles.map((t) => `${t}\0`).join(''), 'latin1');
  const names = Buffer.from(entries.map((e) => `${e.name}\0`).join(''), 'latin1');
  const table = Buffer.alloc(entries.length * 24);
  entries.forEach((e, i) => {
    const o = i * 24;
    table[o] = e.comp;
    table.writeUInt16LE(e.tree, o + 2);
    table.writeUInt32LE(0, o + 4);
    table.writeUInt32LE(e.name.length, o + 8);
    table.writeUInt32LE(e.offset, o + 12);
    table.writeUInt32LE(e.length, o + 16);
    table.writeUInt32LE(e.stored, o + 20);
  });
  const h = Buffer.alloc(36);
  // The token and version are little-endian tags, so each is written reversed.
  Buffer.from(' COT', 'latin1').copy(h, 0);
  Buffer.from('1000', 'latin1').copy(h, 4);
  h.writeUInt32LE(entries.length, 12);
  h.writeUInt32LE(table.length, 16);
  h.writeUInt32LE(names.length, 20);
  h.writeUInt32LE(names.length, 24);
  h.writeUInt32LE(treeFiles.length, 28);
  h.writeUInt32LE(treeBlock.length, 32);
  writeFileSync(file, Buffer.concat([h, treeBlock, table, names]));
}

/** A data-only (6000) archive of `blobs`, each stored or deflated; answers each blob's place for an index entry. */
export function writeTre(file: string, blobs: { bytes: Buffer; zip?: boolean }[]): Omit<TocEntry, 'name' | 'tree'>[] {
  const parts: Buffer[] = [Buffer.concat([Buffer.from('EERT6000', 'latin1'), Buffer.alloc(28)])];
  let at = 36;
  const out: Omit<TocEntry, 'name' | 'tree'>[] = [];
  for (const b of blobs) {
    const stored = b.zip ? deflateSync(b.bytes) : b.bytes;
    out.push({ offset: at, length: b.bytes.length, stored: stored.length, comp: b.zip ? 2 : 0 });
    parts.push(stored);
    at += stored.length;
  }
  writeFileSync(file, Buffer.concat(parts));
  return out;
}

/** TEST bytes for a blob, a few dozen of them. */
export const TEST = (s: string): Buffer => Buffer.from(`TEST ${s} `.repeat(8), 'latin1');
