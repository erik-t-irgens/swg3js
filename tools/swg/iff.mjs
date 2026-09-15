// Generic EA-IFF parser as used by SWG: "FORM" + big-endian size + type, chunks: tag + big-endian size + data.
// Payload values inside chunks are little-endian.

export function parseIff(buf) {
  const nodes = parseRange(buf, 0, buf.length);
  if (nodes.length !== 1) throw new Error(`Expected one root FORM, got ${nodes.length}`);
  return nodes[0];
}

function parseRange(buf, start, end) {
  const nodes = [];
  let o = start;
  while (o + 8 <= end) {
    const tag = buf.toString('latin1', o, o + 4);
    const size = buf.readUInt32BE(o + 4);
    const dataStart = o + 8;
    const dataEnd = Math.min(dataStart + size, end);
    if (tag === 'FORM') {
      const type = buf.toString('latin1', dataStart, dataStart + 4);
      nodes.push({ tag, type, children: parseRange(buf, dataStart + 4, dataEnd) });
    } else {
      nodes.push({ tag, data: buf.subarray(dataStart, dataEnd) });
    }
    o = dataStart + size;
  }
  return nodes;
}

export function isForm(node) {
  return node.tag === 'FORM';
}

/** Direct children matching a FORM type or a chunk tag. */
export function childrenOf(node, name) {
  return (node.children ?? []).filter((c) => (isForm(c) ? c.type === name : c.tag === name));
}

export function childOf(node, name) {
  return childrenOf(node, name)[0];
}

/** Depth-first search for every node with the given FORM type or chunk tag. */
export function findAll(node, name, out = []) {
  if (isForm(node) ? node.type === name : node.tag === name) out.push(node);
  for (const c of node.children ?? []) findAll(c, name, out);
  return out;
}

export function find(node, name) {
  return findAll(node, name)[0];
}

/**
 * An IFF tree as lines. With `strings`, every run of printable text of four characters or more
 * in a chunk is listed after it, so a file's names and paths can be read off (a ship's client
 * data, a cockpit's) without knowing its layout.
 */
export function dump(node, depth = 0, lines = [], strings = false) {
  const pad = '  '.repeat(depth);
  if (isForm(node)) {
    lines.push(`${pad}FORM ${node.type} (${node.children.length} children)`);
    for (const c of node.children) dump(c, depth + 1, lines, strings);
  } else {
    const preview = node.data.subarray(0, 16).toString('hex').replace(/(..)/g, '$1 ').trim();
    const text = node.data.subarray(0, 32).toString('latin1').replace(/[^\x20-\x7e]/g, '.');
    lines.push(`${pad}${node.tag} ${node.data.length} bytes  ${preview}  |${text}|`);
    if (strings) {
      const found = node.data.toString('latin1').match(/[\x20-\x7e]{4,}/g) ?? [];
      if (found.length) lines.push(`${pad}  strings: ${found.join(' | ')}`);
    }
  }
  return lines;
}

export function readCString(buf, offset = 0) {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  return { value: buf.toString('latin1', offset, end), next: end + 1 };
}
