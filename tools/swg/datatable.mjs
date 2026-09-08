// SWG datatables (FORM DTII) and localized string tables (.stf), as the engine reads them.
//
// DTII > 0000|0001 > COLS (int32 count, C-string names), TYPE (0000: int32 basic types;
// 0001: type-spec strings whose first letter gives the storage: i/h/b/e/v int32, f float,
// s/c/p C-string), ROWS (int32 count, cells in column order).
//
// .stf: uint32 magic 0xabcd, uint8 version, uint32 next id, uint32 count, then per string
// {uint32 id, uint32 time (v0) or crc (v1), uint32 length, UTF-16LE chars}, then per string
// {uint32 id, uint32 length, ASCII name}.

import { childOf, isForm, readCString } from './iff.mjs';

const INT_SPECS = 'ihbev';

/** Parse a datatable IFF into { columns: string[], rows: object[] }. */
export function parseDatatable(root) {
  if (root.type !== 'DTII') throw new Error(`not a datatable: ${root.type ?? root.tag}`);
  const version = root.children.find(isForm);
  const cols = childOf(version, 'COLS').data;
  const numCols = cols.readInt32LE(0);
  const columns = [];
  let cursor = 4;
  for (let i = 0; i < numCols; i++) {
    const { value, next } = readCString(cols, cursor);
    columns.push(value);
    cursor = next;
  }
  const typeChunk = childOf(version, 'TYPE').data;
  const types = [];
  if (version.type === '0000') {
    for (let i = 0; i < numCols; i++) types.push([0, 'i', 1, 'f', 2, 's'][typeChunk.readInt32LE(i * 4) * 2 + 1] ?? 'i');
  } else {
    cursor = 0;
    for (let i = 0; i < numCols; i++) {
      const { value, next } = readCString(typeChunk, cursor);
      const c = value[0]?.toLowerCase() ?? 'i';
      types.push(INT_SPECS.includes(c) ? 'i' : c === 'f' ? 'f' : 's');
      cursor = next;
    }
  }
  const rowsChunk = childOf(version, 'ROWS').data;
  const numRows = rowsChunk.readInt32LE(0);
  cursor = 4;
  const rows = [];
  for (let r = 0; r < numRows; r++) {
    const row = {};
    for (let c = 0; c < numCols; c++) {
      if (types[c] === 'i') {
        row[columns[c]] = rowsChunk.readInt32LE(cursor);
        cursor += 4;
      } else if (types[c] === 'f') {
        row[columns[c]] = rowsChunk.readFloatLE(cursor);
        cursor += 4;
      } else {
        const { value, next } = readCString(rowsChunk, cursor);
        row[columns[c]] = value;
        cursor = next;
      }
    }
    rows.push(row);
  }
  return { columns, types, rows };
}

/** Parse a string table into a Map from string name to text. */
export function parseStringTable(buf) {
  // magic_type is a 4-byte long; the version is one byte after it
  if (buf.readUInt32LE(0) !== 0xabcd) throw new Error('not a string table');
  const version = buf.readUInt8(4);
  let cursor = 5 + 4; // magic, version, next id
  const count = buf.readUInt32LE(cursor);
  cursor += 4;
  const texts = new Map();
  for (let i = 0; i < count; i++) {
    const id = buf.readUInt32LE(cursor);
    cursor += 8; // id + time/crc
    const len = buf.readUInt32LE(cursor);
    cursor += 4;
    texts.set(id, buf.toString('utf16le', cursor, cursor + len * 2));
    cursor += len * 2;
  }
  const out = new Map();
  for (let i = 0; i < count; i++) {
    const id = buf.readUInt32LE(cursor);
    cursor += 4;
    const len = buf.readUInt32LE(cursor);
    cursor += 4;
    out.set(buf.toString('latin1', cursor, cursor + len), texts.get(id) ?? '');
    cursor += len;
  }
  void version;
  return out;
}

/** Resolve "@table:name" (or "table:name") through string/en/<table>.stf; null when missing. */
export function localize(vfs, stringId, cache = new Map()) {
  const m = /^@?([^:]+):(.+)$/.exec(stringId);
  if (!m) return null;
  const [, table, name] = m;
  let strings = cache.get(table);
  if (!strings) {
    const path = `string/en/${table}.stf`;
    strings = vfs.has(path) ? parseStringTable(vfs.read(path)) : new Map();
    cache.set(table, strings);
  }
  return strings.get(name) ?? null;
}
