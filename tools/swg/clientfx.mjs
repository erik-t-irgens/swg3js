// The effects an object's client data hangs on it: a brazier's fire, a fountain's spray, a tiki torch's
// flame, a streetlamp's glow, a harvester's blinking light, a geyser, a waterfall's mist.
//
// None of these is in the object's appearance. The client hangs them from the file its object template
// names as `clientDataFile` (FORM CLDF > FORM 0000), in chunks that sit directly in the version form:
//
//   CHLD  an appearance cstring, then 17 floats: 0-2 where it stands, 3-5 yaw, pitch and roll in degrees
//         (the WING form's PSOR shape). The rest are almost always nought. 198 in retail hang a `.prt`.
//   CHL2  the same with an object template in place of the appearance; a template that is a particle
//         on its own is placed the same way.
//   HOBJ  an appearance cstring and a hardpoint cstring on the object's own appearance. IHOB is the same
//         with three floats after, which are the ships' turret barrels' and are not read.
//   LOBJ  an int32, a cstring naming a `.prt` or nothing, then 17 floats; the point is floats 14-16.
//         The light itself (colours, range) is not decoded, and the x/z order of the point is inferred
//         (its y, float 15, is certain: the tiki torch's LOBJ flame is at y 1.445 where its twin's CHLD
//         puts the same flame at 1.45). 58 of 103 name a `.prt`.
//   HLOB  an int32, a `.prt` cstring, 13 floats, an int32 and a hardpoint cstring. One in retail names
//         a `.prt`: the shuttleport's green blink on its `hardpoint`.
//
// Measured over every retail template the worlds place and the Props tab offers, this reaches 4,181
// placed objects over 144 templates in the worlds and 411 prop templates, and none of it was carried:
// the converter only ever found an effect listed as a `.cmp` PART inside the appearance, which reaches 85
// prop templates and not a single brazier. What is returned is exactly what `attachedEffects` already
// takes -- a particle path and a 3x4 transform in the model's own (unflipped) space.
import { find, isForm, parseIff, readCString } from './iff.mjs';
import { composeTransform, resolveParts, yawPitchRollTransform } from './appearance.mjs';
import { readHardpoints } from './msh.mjs';
import { resolveTemplateMesh, resolveTemplateString } from './objtemplate.mjs';

/** Bumped when what `objeffects` writes changes shape or meaning; `status` asks again when it moves. */
export const OBJECT_EFFECTS_VERSION = 1;

const norm = (p) => String(p ?? '').replace(/\\/g, '/').replace(/^\//, '');
const isPrt = (p) => /\.prt$/i.test(p);
const DEG = Math.PI / 180;

function floatsAt(buf, offset, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(offset + i * 4 + 4 <= buf.length ? buf.readFloatLE(offset + i * 4) : 0);
  return out;
}

/**
 * The children a client data file hangs, as plain rows, from its parsed root. Pure: it reads only the
 * chunks, never the archives, so a node test can hand it a file built by hand.
 * Each row is `{ tag, name, hardpoint?, place?: [x, y, z], angles?: [yaw, pitch, roll] (degrees) }`.
 */
export function readClientChildren(root) {
  if (!isForm(root) || root.type !== 'CLDF') return [];
  const version = root.children.find(isForm) ?? root;
  const out = [];
  for (const c of version.children ?? []) {
    if (isForm(c)) continue;
    const d = c.data;
    if (!d || !d.length) continue;
    if (c.tag === 'CHLD' || c.tag === 'CHL2') {
      const a = readCString(d, 0);
      const f = floatsAt(d, a.next, 17);
      if (a.value) out.push({ tag: c.tag, name: norm(a.value), place: [f[0], f[1], f[2]], angles: [f[3], f[4], f[5]] });
    } else if (c.tag === 'HOBJ' || c.tag === 'IHOB') {
      const a = readCString(d, 0);
      const h = readCString(d, a.next);
      if (a.value) out.push({ tag: c.tag, name: norm(a.value), hardpoint: h.value || null });
    } else if (c.tag === 'LOBJ') {
      if (d.length < 5) continue;
      const a = readCString(d, 4);
      const f = floatsAt(d, a.next, 17);
      if (a.value) out.push({ tag: 'LOBJ', name: norm(a.value), place: [f[14], f[15], f[16]], angles: [0, 0, 0] });
    } else if (c.tag === 'HLOB') {
      if (d.length < 5) continue;
      const a = readCString(d, 4);
      const hardAt = a.next + 13 * 4 + 4;
      const h = hardAt < d.length ? readCString(d, hardAt) : { value: '' };
      if (a.value) out.push({ tag: 'HLOB', name: norm(a.value), hardpoint: h.value || null });
    }
  }
  return out;
}

/** A child placed by its own numbers: where it stands, turned by yaw, pitch and roll in degrees. */
export function placeTransform(place, angles) {
  return yawPitchRollTransform(place, (angles?.[0] ?? 0) * DEG, (angles?.[1] ?? 0) * DEG, (angles?.[2] ?? 0) * DEG);
}

/**
 * Reads the effects objects' client data hangs on them, over one archive mount, with its own caches:
 * one client data file serves many templates, and one appearance's hardpoints many client data files.
 */
export function clientEffectReader(vfs) {
  const paramCache = new Map();
  const meshCache = new Map();
  const cdfCache = new Map();
  const hardpointCache = new Map();
  const counts = { templates: 0, withClientData: 0, withEffects: 0, effects: 0, missingHardpoint: 0, skeletal: 0 };
  const missing = [];

  const childrenOfFile = (path) => {
    if (cdfCache.has(path)) return cdfCache.get(path);
    let rows = [];
    try {
      if (vfs.has(path)) rows = readClientChildren(parseIff(vfs.read(path)));
    } catch {
      rows = [];
    }
    cdfCache.set(path, rows);
    return rows;
  };

  // Every hardpoint of an appearance in the model's own frame: the chain's own (carried on the first
  // part already in that frame) and each mesh's own, moved by its part's transform.
  const hardpointsOf = (appearance) => {
    if (hardpointCache.has(appearance)) return hardpointCache.get(appearance);
    const out = new Map();
    try {
      for (const part of resolveParts(vfs, appearance)) {
        for (const h of part.hardpoints ?? []) if (!out.has(h.name)) out.set(h.name, h.matrix);
        if (!part.mesh || !vfs.has(part.mesh)) continue;
        const appr = find(parseIff(vfs.read(part.mesh)), 'APPR');
        for (const h of appr ? readHardpoints(appr) : []) if (!out.has(h.name)) out.set(h.name, part.transform ? composeTransform(part.transform, h.matrix) : h.matrix);
      }
    } catch {
      /* an appearance that will not resolve has no hardpoints to hang anything on */
    }
    hardpointCache.set(appearance, out);
    return out;
  };

  /**
   * The effects one object template's client data hangs on it: `[{ particle, transform }]`, the
   * transform a row-major 3x4 in the model's unflipped space, or `[]`.
   */
  const effectsOf = (template) => {
    counts.templates++;
    let cdf = null;
    try {
      cdf = resolveTemplateString(vfs, template, ['clientDataFile'], paramCache);
    } catch {
      cdf = null;
    }
    if (!cdf) return [];
    const rows = childrenOfFile(norm(cdf));
    if (!rows.length) return [];
    counts.withClientData++;
    let mesh = null;
    const meshOf = () => {
      if (mesh === null) {
        try {
          mesh = resolveTemplateMesh(vfs, template, meshCache);
        } catch {
          mesh = {};
        }
      }
      return mesh;
    };
    const out = [];
    for (const r of rows) {
      if (r.tag === 'CHLD' || r.tag === 'LOBJ') {
        if (isPrt(r.name)) out.push({ particle: r.name, transform: placeTransform(r.place, r.angles) });
      } else if (r.tag === 'CHL2') {
        let child = null;
        try {
          child = resolveTemplateMesh(vfs, r.name, meshCache);
        } catch {
          child = null;
        }
        if (child?.particle) out.push({ particle: norm(child.particle), transform: placeTransform(r.place, r.angles) });
      } else if ((r.tag === 'HOBJ' || r.tag === 'IHOB' || r.tag === 'HLOB') && isPrt(r.name) && r.hardpoint) {
        const m = meshOf();
        if (m.skeletal || !m.appearance) {
          counts.skeletal++;
          continue;
        }
        const hp = hardpointsOf(m.appearance).get(r.hardpoint);
        // A hardpoint the appearance has not got is left out and counted, never hung at the origin:
        // two templates the worlds place name one (a waterfall's mist on a placeholder with none).
        if (!hp) {
          counts.missingHardpoint++;
          if (missing.length < 20) missing.push(`${template}: ${r.hardpoint}`);
          continue;
        }
        out.push({ particle: r.name, transform: hp });
      }
    }
    if (out.length) {
      counts.withEffects++;
      counts.effects += out.length;
    }
    return out;
  };

  return { effectsOf, counts, missing };
}
