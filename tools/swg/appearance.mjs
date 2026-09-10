// Resolve appearance files to static mesh parts:
//   .msh is a mesh; .apt points at a child; .lod lists detail levels (take the highest);
//   .cmp (component appearance) is a list of parts, each a child appearance with a 3x4 transform;
//   .prt is a particle effect, returned as a part of its own ({ particle }) for the caller to place.
// Paths inside these files are relative to appearance/ unless already prefixed.
import { childrenOf, find, findAll, isForm, readCString, parseIff } from './iff.mjs';
import { parsePob } from './pob.mjs';

export function appearancePath(name) {
  const n = name.replace(/\\/g, '/');
  return n.toLowerCase().startsWith('appearance/') ? n : `appearance/${n}`;
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** Compose two row-major 3x4 transforms: result = a then applied after b (a * b). */
export function composeTransform(a, b) {
  const out = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) out[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c];
    out[r * 4 + 3] = a[r * 4] * b[3] + a[r * 4 + 1] * b[7] + a[r * 4 + 2] * b[11] + a[r * 4 + 3];
  }
  return out;
}

function yawPitchRollTransform(pos, yaw, pitch, roll) {
  // Engine order: yaw about Y, then pitch about X, then roll about Z, applied locally.
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const Y = [cy, 0, sy, 0, 0, 1, 0, 0, -sy, 0, cy, 0];
  const X = [1, 0, 0, 0, 0, cp, -sp, 0, 0, sp, cp, 0];
  const Z = [cr, -sr, 0, 0, sr, cr, 0, 0, 0, 0, 1, 0];
  const m = composeTransform(composeTransform(Y, X), Z);
  m[3] = pos[0];
  m[7] = pos[1];
  m[11] = pos[2];
  return m;
}

/** Single-mesh resolution (.msh, .apt, .lod). Throws for component appearances. */
export function resolveToMesh(vfs, path, depth = 0) {
  const parts = resolveParts(vfs, path, depth);
  if (parts.length !== 1 || parts[0].transform) throw new Error(`${path} is a component appearance; use resolveParts`);
  return parts[0].mesh;
}

/**
 * Resolve an appearance to mesh parts: [{ mesh, transform | null }], where
 * transform is a row-major 3x4 in the appearance's local space.
 */
export function resolveParts(vfs, rawPath, depth = 0) {
  const path = appearancePath(rawPath);
  const lower = path.toLowerCase();
  if (depth > 8) throw new Error(`Appearance chain too deep at ${path}`);
  if (lower.endsWith('.msh')) return [{ mesh: path, transform: null }];
  if (!vfs.has(path)) throw new Error(`Not in archives: ${path}`);
  // Particle effects are parts too (a candle is a mesh plus a flame); callers place them.
  if (lower.endsWith('.prt')) return [{ particle: path, transform: null }];
  const root = parseIff(vfs.read(path));
  if (lower.endsWith('.apt')) {
    const name = find(root, 'NAME');
    if (!name) throw new Error(`${path}: .apt without NAME`);
    return resolveParts(vfs, readCString(name.data).value, depth + 1);
  }
  if (lower.endsWith('.lod')) {
    // Detail levels: INFO lists (id, nearDistance, farDistance); the entry whose
    // near distance is 0 (the last one) is the highest detail, per the engine.
    const children = findAll(root, 'CHLD').map((c) => ({ id: c.data.readInt32LE(0), name: readCString(c.data, 4).value }));
    if (!children.length) throw new Error(`${path}: .lod without CHLD`);
    const info = find(root, 'INFO');
    let pick = children[children.length - 1];
    if (info && info.data.length >= 12) {
      let bestNear = Infinity;
      for (let o = 0; o + 12 <= info.data.length; o += 12) {
        const id = info.data.readInt32LE(o);
        const near = info.data.readFloatLE(o + 4);
        const child = children.find((c) => c.id === id);
        if (child && near <= bestNear) {
          bestNear = near;
          pick = child;
        }
      }
    }
    return resolveParts(vfs, pick.name, depth + 1);
  }
  if (lower.endsWith('.pob')) {
    // Portal building: exterior (cell 0) plus every interior cell, all in building space.
    const { cells, portals } = parsePob(root);
    const out = [];
    const errors = [];
    cells.forEach((cell, i) => {
      if (!cell.appearance) return;
      try {
        for (const part of resolveParts(vfs, cell.appearance, depth + 1)) out.push({ ...part, cell: i, cellName: cell.name || (i === 0 ? 'exterior' : `cell${i}`), cellPortals: cell.portals, cellLights: cell.lights ?? [], portalGeometry: portals });
      } catch (err) {
        errors.push(`cell ${i}: ${err.message}`);
      }
    });
    if (!out.length) throw new Error(`${path}: no cell appearances resolved (${errors.join('; ')})`);
    return out;
  }
  if (lower.endsWith('.cmp')) {
    if (!isForm(root) || root.type !== 'CMPA') throw new Error(`${path}: not a component appearance`);
    const version = root.children.find(isForm);
    const v = version ? parseInt(version.type, 10) : 0;
    const out = [];
    for (const part of childrenOf(version ?? root, 'PART')) {
      const { value: name, next } = readCString(part.data);
      const d = part.data;
      let transform;
      if (v >= 4) {
        transform = [];
        for (let i = 0; i < 12; i++) transform.push(d.readFloatLE(next + i * 4));
      } else {
        const pos = [d.readFloatLE(next), d.readFloatLE(next + 4), d.readFloatLE(next + 8)];
        const deg = Math.PI / 180;
        transform = yawPitchRollTransform(pos, d.readFloatLE(next + 12) * deg, d.readFloatLE(next + 16) * deg, d.readFloatLE(next + 20) * deg);
      }
      for (const sub of resolveParts(vfs, name, depth + 1)) {
        out.push({ ...(sub.particle ? { particle: sub.particle } : { mesh: sub.mesh }), transform: sub.transform ? composeTransform(transform, sub.transform) : transform });
      }
    }
    if (!out.length) throw new Error(`${path}: component appearance without parts`);
    return out;
  }
  throw new Error(`Unsupported appearance type: ${path}`);
}

export { IDENTITY };
