// Resolve appearance files to a static mesh: .apt points at a child, .lod lists detail levels.
import { find, findAll, readCString } from './iff.mjs';
import { parseIff } from './iff.mjs';

export function resolveToMesh(vfs, path, depth = 0) {
  const lower = path.toLowerCase();
  if (depth > 6) throw new Error(`Appearance chain too deep at ${path}`);
  if (lower.endsWith('.msh')) return path;
  const root = parseIff(vfs.read(path));
  if (lower.endsWith('.apt')) {
    const name = find(root, 'NAME');
    if (!name) throw new Error(`${path}: .apt without NAME`);
    return resolveToMesh(vfs, readCString(name.data).value, depth + 1);
  }
  if (lower.endsWith('.lod')) {
    // CHLD chunks: u32 detail index followed by the child path; take the highest detail.
    const children = findAll(root, 'CHLD').map((c) => ({ level: c.data.readUInt32LE(0), name: readCString(c.data, 4).value }));
    if (!children.length) throw new Error(`${path}: .lod without CHLD`);
    children.sort((a, b) => a.level - b.level);
    return resolveToMesh(vfs, children[0].name, depth + 1);
  }
  throw new Error(`Unsupported appearance type: ${path}`);
}
