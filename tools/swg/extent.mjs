// The collision shapes the client authored for an appearance, read out of its APPR form.
//
//   FORM APPR > FORM 0003 > [extent] [collision extent] FORM HPTS FORM FLOR
//
// The first form is the drawing extent (a box round the whole model, which `msh.mjs` reads as the
// bounds); the second is what the client collided with, and it is a separate, much smaller thing:
// a tree's is its trunk, a rock's a few cylinders round its body. Every extent is one of these:
//
//   FORM NULL                                              nothing: walked through
//   FORM XCYL > FORM 0000 > CYLN                           an upright cylinder: base x, y, z, radius, height
//   FORM EXSP > FORM 000N > SPHR                           a sphere: centre x, y, z, radius
//   FORM EXBX > FORM 000N > [FORM EXSP] + BOX              a box: two corners, the larger one first
//   FORM CPST > FORM 0000 > extent...                      several extents together
//   FORM CMPT > FORM 0000 > FORM CPST                      the same, under the name the client gives a compound
//   FORM DTAL > FORM 0000 > FORM CPST                      a broad test then the fine ones: the first child is
//                                                          only the broad test, so it is left out
//   FORM CMSH > FORM 0000 > FORM IDTL > FORM 0000 > VERT + INDX
//                                                          a small mesh: x, y, z floats, then int32 triangles
//
// Measured over the 455 flora appearances the converted worlds plant, looking at the .lod first and
// then its finest mesh: 127 cylinders, 31 compounds, 39 detail extents, 24 boxes, 12 spheres, 10
// meshes of 11 to 24 triangles, and 212 NULL (the living wroshyr trees and the big bushes among
// them: the client walked through those). The box's corner order is the trap `msh.mjs` already paid
// for, and is taken componentwise here for the same reason.
//
// Everything is read in the client's own frame and mirrored once, when it is written (`flipX`), as
// the GLBs are, so the game hangs a shape on a planting exactly as it hangs the model.

import { childrenOf, find, isForm, parseIff, readCString } from './iff.mjs';
import { appearancePath, lodLevels } from './appearance.mjs';

/** The shape of flora-collision.json; the game's `FLORA_COLLISION_VERSION` (`src/world/floraCollision.ts`), held equal by a node test. */
export const FLORA_COLLISION_VERSION = 1;

/** Four decimals: a tenth of a millimetre, and a file a sixth the size. */
const round = (v) => Math.round(v * 10000) / 10000;

/** The version form under an extent form (its only form child). */
const versionOf = (form) => (form.children ?? []).find(isForm) ?? null;

/** A chunk's floats, as many as it holds up to `n`. */
function floats(chunk, n) {
  const out = [];
  if (!chunk) return out;
  for (let i = 0; i < n && (i + 1) * 4 <= chunk.data.length; i++) out.push(chunk.data.readFloatLE(i * 4));
  return out;
}

/**
 * One extent form as shapes in the client's frame: `{ kind, shapes, unread }`, where `kind` is the
 * form's own tag and `unread` names any form inside it that is not one of the kinds above (a shape
 * this reader does not know is left out and said, never guessed at).
 */
export function readExtent(form) {
  const kind = form?.type ?? 'NULL';
  const shapes = [];
  const unread = [];
  const walk = (f, depth = 0) => {
    if (!f || !isForm(f) || depth > 8) return;
    const v = versionOf(f);
    switch (f.type) {
      case 'NULL':
        return;
      case 'XCYL': {
        const [x, y, z, r, h] = floats(find(f, 'CYLN'), 5);
        if ([x, y, z, r, h].every(Number.isFinite) && r > 0 && h > 0) shapes.push({ t: 'cyl', c: [x, y, z].map(round), r: round(r), h: round(h) });
        else unread.push('XCYL (no usable CYLN)');
        return;
      }
      case 'EXSP': {
        const [x, y, z, r] = floats(find(f, 'SPHR'), 4);
        if ([x, y, z, r].every(Number.isFinite) && r > 0) shapes.push({ t: 'ball', c: [x, y, z].map(round), r: round(r) });
        else unread.push('EXSP (no usable SPHR)');
        return;
      }
      case 'EXBX': {
        // The box's own chunk, directly under the version form: the EXSP beside it is the sphere round it.
        const box = v ? childrenOf(v, 'BOX ')[0] : null;
        const b = floats(box, 6);
        if (b.length === 6 && b.every(Number.isFinite)) {
          const a = b.slice(0, 3);
          const c = b.slice(3, 6);
          const min = a.map((x, k) => Math.min(x, c[k]));
          const max = a.map((x, k) => Math.max(x, c[k]));
          if (max.every((x, k) => x > min[k])) shapes.push({ t: 'box', min: min.map(round), max: max.map(round) });
          else unread.push('EXBX (a flat box)');
        } else unread.push('EXBX (no usable BOX)');
        return;
      }
      case 'CPST':
      case 'CMPT': {
        // A compound's children sit in its version form, or one level further down in the composite it holds.
        for (const c of (v?.children ?? []).filter(isForm)) walk(c, depth + 1);
        return;
      }
      case 'DTAL': {
        const inner = (v?.children ?? []).find((c) => isForm(c) && c.type === 'CPST');
        const list = inner ? (versionOf(inner)?.children ?? []).filter(isForm) : (v?.children ?? []).filter(isForm);
        // The first is the broad test round the rest; with nothing after it, it is all there is.
        for (const c of list.length > 1 ? list.slice(1) : list) walk(c, depth + 1);
        return;
      }
      case 'CMSH': {
        const idtl = find(f, 'IDTL');
        const vert = idtl ? find(idtl, 'VERT') : null;
        const indx = idtl ? find(idtl, 'INDX') : null;
        const vs = vert ? floats(vert, Math.floor(vert.data.length / 4)) : [];
        const n = Math.floor(vs.length / 3);
        const is = [];
        if (indx) for (let o = 0; o + 12 <= indx.data.length; o += 12) {
          const a = indx.data.readInt32LE(o);
          const b = indx.data.readInt32LE(o + 4);
          const c = indx.data.readInt32LE(o + 8);
          // A corner past the vertices, or a repeated one, is no triangle (the game cleans again before the engine sees it).
          if (a < 0 || b < 0 || c < 0 || a >= n || b >= n || c >= n || a === b || b === c || a === c) continue;
          is.push(a, b, c);
        }
        if (n >= 3 && is.length >= 3 && vs.every(Number.isFinite)) shapes.push({ t: 'mesh', v: vs.slice(0, n * 3).map(round), i: is });
        else unread.push('CMSH (no usable triangles)');
        return;
      }
      default:
        unread.push(f.type);
    }
  };
  walk(form);
  return { kind, shapes, unread };
}

/** The collision extent of a file's APPR form: the second form of its version form, or null where there is none. */
export function apprCollision(root) {
  const appr = find(root, 'APPR');
  if (!appr) return null;
  const v = versionOf(appr);
  if (!v) return null;
  // Version 0003 is extent, collision extent, hardpoints, floor; the older versions carried no collision extent.
  if (v.type !== '0003') return null;
  const forms = v.children.filter(isForm);
  const c = forms[1];
  return c && c.type !== 'HPTS' && c.type !== 'FLOR' ? c : null;
}

/**
 * The collision an appearance's chain carries: the first non-NULL collision extent along it, the
 * .lod's own before its finest level's (a tree's trunk is on its .lod; its meshes say NULL), through
 * any .apt that names the next. `{ kind, from, shapes, unread }` in the client's frame, `kind` 'NULL'
 * for a chain that carries none anywhere (walked through, as the client did), or null for a chain
 * that cannot be read at all -- which the game takes as "no word", and guesses as it always did.
 */
export function collisionExtentOf(vfs, appearance) {
  let path = appearancePath(appearance);
  let last = path;
  for (let step = 0; step < 8; step++) {
    if (!vfs.has(path)) return step === 0 ? null : { kind: 'NULL', from: last, shapes: [], unread: [`${path} is not in the archives`] };
    last = path;
    const lower = path.toLowerCase();
    if (lower.endsWith('.prt')) return null;
    let root;
    try {
      root = parseIff(vfs.read(path));
    } catch {
      return null;
    }
    const own = apprCollision(root);
    if (own && own.type !== 'NULL') return { ...readExtent(own), from: path };
    if (lower.endsWith('.apt')) {
      const name = find(root, 'NAME');
      if (!name) break;
      path = appearancePath(readCString(name.data).value);
      continue;
    }
    if (lower.endsWith('.lod')) {
      const levels = lodLevels(root);
      if (!levels.length) break;
      path = appearancePath(levels[0].name);
      continue;
    }
    // A mesh, a component or anything else: its own extent was the last word, and it said NULL.
    break;
  }
  return { kind: 'NULL', from: last, shapes: [], unread: [] };
}

/** Shapes mirrored in X, as the GLBs are: a mesh's triangles are turned round so they still face out. */
export function mirrorShapes(shapes) {
  return shapes.map((s) => {
    if (s.t === 'cyl' || s.t === 'ball') return { ...s, c: [round(-s.c[0]) || 0, s.c[1], s.c[2]] };
    if (s.t === 'box') return { ...s, min: [round(-s.max[0]) || 0, s.min[1], s.min[2]], max: [round(-s.min[0]) || 0, s.max[1], s.max[2]] };
    if (s.t === 'mesh') {
      const v = s.v.slice();
      for (let k = 0; k < v.length; k += 3) v[k] = round(-v[k]) || 0;
      const i = s.i.slice();
      for (let k = 0; k + 2 < i.length; k += 3) [i[k + 1], i[k + 2]] = [i[k + 2], i[k + 1]];
      return { ...s, v, i };
    }
    return s;
  });
}

/** A flora def's appearance as the game keys its flora models: forward slashes, lower case. */
export const floraKey = (appearance) => String(appearance ?? '').replace(/\\/g, '/').toLowerCase();

/**
 * flora-collision.json for one pack: every appearance its flora category plants, keyed as the game
 * keys its flora models, with the shapes in the GLBs' frame. `appearances` is the list of appearance
 * paths (the manifest's flora defs' `appearance`).
 */
export function floraCollisionFile(vfs, appearances, { flipX = true } = {}) {
  const out = {};
  const byKind = {};
  const shapes = {};
  const unreadable = [];
  let unreadParts = 0;
  for (const a of appearances) {
    const key = floraKey(a);
    if (!key || key in out || unreadable.includes(key) || /\.prt$/.test(key)) continue;
    let c = null;
    try {
      c = collisionExtentOf(vfs, a);
    } catch {
      c = null;
    }
    if (!c) {
      // Named, so `status` can tell "read and found unreadable" from "never looked at".
      unreadable.push(key);
      continue;
    }
    byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
    for (const s of c.shapes) shapes[s.t] = (shapes[s.t] ?? 0) + 1;
    if (c.unread.length) unreadParts += c.unread.length;
    out[key] = { kind: c.kind, from: c.from, shapes: flipX ? mirrorShapes(c.shapes) : c.shapes, ...(c.unread.length ? { unread: c.unread } : {}) };
  }
  return {
    version: FLORA_COLLISION_VERSION,
    flipX,
    counts: { appearances: Object.keys(out).length, byKind, shapes, unreadable: unreadable.length, unreadParts },
    appearances: out,
    ...(unreadable.length ? { unreadable } : {}),
  };
}

/**
 * What `status` says about a pack's flora-collision.json against the flora its manifest plants: a
 * line, and whether the pass is wanted (no file, an older shape, or a planted appearance the file has
 * no word on -- a world converted again with flora the last pass never saw).
 */
export function floraCollisionStatus(file, floraDefs) {
  const wanted = [...new Set((floraDefs ?? []).map((d) => floraKey(d?.appearance)).filter((k) => k && !/\.prt$/.test(k)))];
  if (!wanted.length) return { line: null, stale: false, why: '' };
  if (!file) return { line: 'flora collision: none (every tree and rock is a guessed cylinder)', stale: true, why: 'no flora-collision.json' };
  if (file.version !== FLORA_COLLISION_VERSION || !file.appearances) return { line: `flora collision: an older shape (${file.version ?? '?'})`, stale: true, why: 'an older flora-collision.json' };
  // A chain the pass could not read is named in the file and is not asked about again: a rerun reads it no better.
  const unreadable = new Set(file.unreadable ?? []);
  const missing = wanted.filter((k) => !(k in file.appearances) && !unreadable.has(k)).length;
  const k = file.counts?.byKind ?? {};
  const line = `flora collision: ${Object.keys(file.appearances).length} appearances (${Object.entries(k).map(([n, c]) => `${c} ${n}`).join(', ')})${unreadable.size ? `, ${unreadable.size} unreadable (guessed)` : ''}${missing ? `, ${missing} planted ones never read` : ''}`;
  return { line, stale: missing > 0, why: missing ? `${missing} planted appearances are not in flora-collision.json` : '' };
}
