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
 * The detail levels a .lod lists, highest detail first: [{ name, near, far }].
 * The engine picks by camera distance; `near` is where a level takes over.
 */
export function lodLevels(root) {
  const children = findAll(root, 'CHLD').map((c) => ({ id: c.data.readInt32LE(0), name: readCString(c.data, 4).value }));
  if (!children.length) return [];
  const info = find(root, 'INFO');
  const levels = [];
  if (info) {
    for (let o = 0; o + 12 <= info.data.length; o += 12) {
      const id = info.data.readInt32LE(o);
      const child = children.find((c) => c.id === id);
      if (child) levels.push({ name: child.name, near: info.data.readFloatLE(o + 4), far: info.data.readFloatLE(o + 8) });
    }
  }
  // Highest detail (near 0) first. Without INFO the file's last child is the detailed one.
  if (levels.length) return levels.sort((a, b) => a.near - b.near);
  return [{ name: children[children.length - 1].name, near: 0, far: Infinity }];
}

/**
 * How many detail levels an appearance offers, and where each takes over. A model may hold
 * several .lod chains (a building's cells each have their own); the count is the deepest chain
 * and a level's distance is the farthest any chain defers to it, so detail is never dropped
 * earlier than the artists intended.
 */
export function detailLevels(vfs, rawPath, depth = 0, seen = new Set()) {
  const path = appearancePath(rawPath);
  const lower = path.toLowerCase();
  if (depth > 8 || seen.has(path) || !vfs.has(path)) return [];
  seen.add(path);
  if (lower.endsWith('.msh') || lower.endsWith('.prt')) return [];
  let root;
  try {
    root = parseIff(vfs.read(path));
  } catch {
    return [];
  }
  const merge = (chains) => {
    const out = [];
    for (const chain of chains) {
      chain.forEach((lvl, i) => {
        if (!out[i]) out[i] = { near: lvl.near, far: lvl.far };
        else {
          out[i].near = Math.max(out[i].near, lvl.near);
          out[i].far = Math.max(out[i].far, lvl.far);
        }
      });
    }
    return out;
  };
  if (lower.endsWith('.apt')) {
    const name = find(root, 'NAME');
    return name ? detailLevels(vfs, readCString(name.data).value, depth + 1, seen) : [];
  }
  if (lower.endsWith('.lod')) {
    const levels = lodLevels(root);
    const nested = levels.map((l) => detailLevels(vfs, l.name, depth + 1, seen));
    // This chain's own levels, deepened by any chain nested under its highest-detail level.
    const own = levels.map((l) => ({ near: l.near, far: l.far }));
    const deeper = merge(nested.filter((n) => n.length > own.length));
    return own.length >= deeper.length ? own : merge([own, deeper]);
  }
  if (lower.endsWith('.pob')) {
    const { cells } = parsePob(root);
    return merge(cells.filter((c) => c.appearance).map((c) => detailLevels(vfs, c.appearance, depth + 1, seen)));
  }
  if (lower.endsWith('.cmp')) {
    const version = root.children.find(isForm);
    const chains = [];
    for (const part of childrenOf(version ?? root, 'PART')) {
      chains.push(detailLevels(vfs, readCString(part.data).value, depth + 1, seen));
    }
    return merge(chains);
  }
  return [];
}

/**
 * Resolve an appearance to mesh parts: [{ mesh, transform | null }], where
 * transform is a row-major 3x4 in the appearance's local space.
 *
 * `detail` picks a level of detail: 0 is the highest, and a chain with fewer levels than
 * asked for stays on its own lowest. A level the artists left empty (`no_render`) resolves
 * to no parts, which is how the game makes small things vanish in the distance.
 */
export function resolveParts(vfs, rawPath, depth = 0, detail = 0) {
  const path = appearancePath(rawPath);
  const lower = path.toLowerCase();
  if (depth > 8) throw new Error(`Appearance chain too deep at ${path}`);
  if (lower.endsWith('.msh')) return [{ mesh: path, transform: null }];
  // The engine's placeholder for "draw nothing at this range".
  if (/(^|\/)no_render\.[^/]+$/.test(lower)) return [];
  if (!vfs.has(path)) throw new Error(`Not in archives: ${path}`);
  // Particle effects are parts too (a candle is a mesh plus a flame); callers place them.
  if (lower.endsWith('.prt')) return [{ particle: path, transform: null }];
  const root = parseIff(vfs.read(path));
  if (lower.endsWith('.apt')) {
    const name = find(root, 'NAME');
    if (!name) throw new Error(`${path}: .apt without NAME`);
    return resolveParts(vfs, readCString(name.data).value, depth + 1, detail);
  }
  if (lower.endsWith('.lod')) {
    // Detail levels, highest first. A chain shorter than the level asked for stays on its
    // own lowest, so a whole model can drop a level even where only some parts have one.
    const levels = lodLevels(root);
    if (!levels.length) throw new Error(`${path}: .lod without CHLD`);
    const pick = levels[Math.min(detail, levels.length - 1)];
    // Levels below the first are already reduced; nested chains stay on their highest.
    return resolveParts(vfs, pick.name, depth + 1, detail === 0 ? 0 : Math.max(0, detail - (levels.length - 1)));
  }
  if (lower.endsWith('.pob')) {
    // Portal building: exterior (cell 0) plus every interior cell, all in building space.
    const { cells, portals } = parsePob(root);
    const out = [];
    const errors = [];
    cells.forEach((cell, i) => {
      if (!cell.appearance) return;
      try {
        for (const part of resolveParts(vfs, cell.appearance, depth + 1, detail)) out.push({ ...part, cell: i, cellName: cell.name || (i === 0 ? 'exterior' : `cell${i}`), cellPortals: cell.portals, cellLights: cell.lights ?? [], portalGeometry: portals });
      } catch (err) {
        errors.push(`cell ${i}: ${err.message}`);
      }
    });
    if (!out.length && detail === 0) throw new Error(`${path}: no cell appearances resolved (${errors.join('; ')})`);
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
      for (const sub of resolveParts(vfs, name, depth + 1, detail)) {
        out.push({ ...(sub.particle ? { particle: sub.particle } : { mesh: sub.mesh }), transform: sub.transform ? composeTransform(transform, sub.transform) : transform });
      }
    }
    if (!out.length && detail === 0) throw new Error(`${path}: component appearance without parts`);
    return out;
  }
  throw new Error(`Unsupported appearance type: ${path}`);
}

export { IDENTITY };
