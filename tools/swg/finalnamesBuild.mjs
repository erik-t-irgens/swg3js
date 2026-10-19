// The maintainer's writer of SOE's final names list (`final-names <folder with SOE's final indexes> <swg-dir>`).
//
// Run once on the owner's machine and never by a player. It reads exactly four files of the folder it is
// pointed at, SOE's final sku0..3_client.toc, refuses them unless each is SOE's by retail.json's SHA-256, and
// reads the Legends install's own four as `against`. It replays both as `openVfs` replays an index (each in
// `tocRank` order, entries in file order, the later winning, a deletion removing the name) and keeps every
// name whose answer differs: a `set` where SOE's final index points the name at bytes, a `gone` where it no
// longer names it, and SOE's own deletion records as `deleted`. Being a difference, no row is one the Legends
// indexes already answer the same way, so the list applies after them in any order. Every `set` row is read
// back from the install, its length checked and its SHA-1 written; a path twice refuses the whole list.
// The file it writes names neither the folder it read nor any tool of it.
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FINAL_NAMES_COLUMNS, SKU_TOCS, sha256File } from './finalnames.mjs';

const RETAIL_NOTE =
  "SOE's final names list: the difference between the mount SOE's own final indexes (sku0..3_client.toc) give and the mount a Legends install's own indexes give, " +
  "as names and places only (each file's path, archive, offset, lengths, compressor and checksum, and SOE's deletions; no content), for archives every Legends install already holds. " +
  "Committed by the owner's decision of 2026-10-18, so every player's converter reads SOE's final client from their own install with nothing extra (tools/swg/finalnames.mjs, docs/ASSETS.md).";

/** One install's four indexes replayed as openVfs replays them: the last entry for each name, and every deletion in order. */
function replay(dir, { openToc, tocRank }) {
  const mount = new Map();
  const deletions = [];
  for (const t of [...SKU_TOCS].sort((a, b) => tocRank(a) - tocRank(b))) {
    const toc = openToc(join(dir, t));
    const index = t.replace('_client.toc', '');
    for (const e of toc.entries) {
      const rec = { index, path: e.name, key: e.name.toLowerCase(), archive: toc.treeFiles[e.treeFileIndex], offset: e.offset, length: e.length, stored: e.compressedLength, compressor: e.compressor, deleted: e.deleted };
      mount.set(rec.key, rec);
      if (e.deleted) deletions.push(rec);
    }
  }
  return { mount, deletions };
}

const signature = (r) => (r ? (r.deleted ? 'deleted' : `${r.archive.toLowerCase()}@${r.offset}:${r.length}:${r.stored}:${r.compressor}`) : 'none');
const present = (r) => !!r && !r.deleted;

/**
 * The list, from SOE's final indexes in `finalDir` and the install in `swgDir`. `deps` hands in the readers
 * (openToc, tocRank, openTre, archiveRank) and retail.json's `nge_final`. Throws, naming why, on anything
 * that would make the list wrong.
 */
export function buildFinalNames(finalDir, swgDir, { openToc, tocRank, openTre, archiveRank, ngeFinal, log = () => {} }) {
  const from = {};
  const against = {};
  for (const t of SKU_TOCS) {
    const f = join(finalDir, t);
    if (!existsSync(f)) throw new Error(`${finalDir} has no ${t}`);
    from[t] = { size: statSync(f).size, sha256: sha256File(f) };
    if (from[t].sha256 !== ngeFinal[t]?.sha256) throw new Error(`${t} in ${finalDir} is not SOE's final index (its SHA-256 is not retail.json's)`);
    const a = join(swgDir, t);
    if (!existsSync(a)) throw new Error(`${swgDir} has no ${t}`);
    against[t] = { size: statSync(a).size, sha256: sha256File(a) };
  }
  if (SKU_TOCS.every((t) => from[t].sha256 === against[t].sha256)) throw new Error(`${swgDir} already has SOE's final indexes: there is no difference to write`);

  const fin = replay(finalDir, { openToc, tocRank });
  const leg = replay(swgDir, { openToc, tocRank });
  const rows = [];
  for (const key of new Set([...fin.mount.keys(), ...leg.mount.keys()])) {
    const f = fin.mount.get(key);
    const l = leg.mount.get(key);
    if (signature(f) === signature(l)) continue;
    if (present(f)) rows.push({ kind: 'set', ...f, was: present(l) ? 'newer' : 'new' });
    else if (!present(l)) continue;
    else if (f?.deleted) rows.push({ kind: 'deleted', ...f });
    else rows.push({ kind: 'gone', index: l.index, path: l.path, key, archive: l.archive, offset: 0, length: 0, stored: 0, compressor: 0 });
  }
  // SOE's own deletion records go with the list (the owner's decision), each only where SOE's final answer for
  // the name is the deletion, so applied after everything it can never take away a name the index set again.
  const seen = new Set(rows.map((r) => r.key));
  for (const d of fin.deletions) {
    if (seen.has(d.key) || fin.mount.get(d.key) !== d) continue;
    rows.push({ kind: 'deleted', ...d, length: 0 });
    seen.add(d.key);
  }
  const counts = new Map();
  for (const r of rows) counts.set(r.key, (counts.get(r.key) ?? 0) + 1);
  const twice = [...counts].filter(([, n]) => n > 1).map(([k]) => k);
  if (twice.length) throw new Error(`${twice.length} paths would be written twice (${twice.slice(0, 3).join(', ')}): the list is refused`);

  // Every set row read back from the install, its length held to the index's and its SHA-1 written.
  const open = new Map();
  const treOf = (name) => {
    if (!open.has(name)) {
      let p = join(swgDir, name);
      if (!existsSync(p) && existsSync(join(swgDir, 'tres', name))) p = join(swgDir, 'tres', name);
      if (!existsSync(p)) throw new Error(`${name}, which SOE's final index reads, is not in ${swgDir}`);
      open.set(name, openTre(p));
    }
    return open.get(name);
  };
  let stored = 0;
  try {
    for (const r of rows) {
      if (r.kind !== 'set') {
        r.sha1 = '';
        continue;
      }
      const bytes = treOf(r.archive).readBlob(r.offset, r.length, r.stored, r.compressor);
      if (bytes.length !== r.length) throw new Error(`${r.path}: ${bytes.length} bytes in ${r.archive}, the index says ${r.length}`);
      stored += r.compressor === 0 ? r.length : r.stored;
      r.sha1 = createHash('sha1').update(bytes).digest('hex');
    }
  } finally {
    for (const t of open.values()) t.close();
  }

  // SOE's order: the index, then the archive's place in the search order, then where in it.
  const indexOrder = (i) => SKU_TOCS.findIndex((t) => t.startsWith(i));
  const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  rows.sort((a, b) => indexOrder(a.index) - indexOrder(b.index) || archiveRank(a.archive) - archiveRank(b.archive) || byName(a.archive.toLowerCase(), b.archive.toLowerCase()) || a.offset - b.offset || byName(a.key, b.key));
  const archives = [...new Set(rows.map((r) => r.archive))].sort((a, b) => archiveRank(a) - archiveRank(b) || byName(a.toLowerCase(), b.toLowerCase()));
  for (const a of archives) if (!ngeFinal[a.toLowerCase()]?.sha256) throw new Error(`${a} has no SHA-256 in retail.json's nge_final, so no install could be checked against it`);
  const at = new Map(archives.map((a, i) => [a, i]));
  const list = {
    format: 1,
    note: RETAIL_NOTE,
    from,
    against,
    archives,
    columns: FINAL_NAMES_COLUMNS,
    rows: rows.map((r) => [r.kind, r.index, r.path, at.get(r.archive), r.offset, r.length, r.stored, r.compressor, r.sha1]),
  };
  const kinds = { set: 0, gone: 0, deleted: 0 };
  for (const r of rows) kinds[r.kind]++;
  const stats = { rows: rows.length, kinds, newPaths: rows.filter((r) => r.was === 'new').length, newer: rows.filter((r) => r.was === 'newer').length, archives: archives.length, readArchives: new Set(rows.filter((r) => r.kind === 'set').map((r) => r.archive)).size, stored };
  log(`final names: ${stats.rows} rows (${kinds.set} set, ${kinds.gone} gone, ${kinds.deleted} deleted) over ${stats.archives} archives, ${stats.readArchives} of them read`);
  return { list, stats };
}

/** The list as it is committed: one field a line, one row a line, LF, so a list made again diffs by line. */
export function finalNamesText(list) {
  const head = ['format', 'note', 'from', 'against', 'archives', 'columns'].map((k) => ` ${JSON.stringify(k)}: ${JSON.stringify(list[k])},`);
  const rows = list.rows.map((r, i) => `${JSON.stringify(r)}${i < list.rows.length - 1 ? ',' : ''}`);
  return `{\n${head.join('\n')}\n "rows": [\n${rows.join('\n')}\n ]\n}\n`;
}
