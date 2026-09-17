// What the `mobiles` command reads out of the archives: template chains, appearances, worn mesh
// headers, animation headers and name tables. Everything goes through an injected vfs
// ({ has, read, list }), so a test can drive it over synthetic buffers, and nothing here writes.
// No image is ever decoded: a shader is read for the names of its customization variables only.
import { childOf, childrenOf, isForm, parseIff } from './iff.mjs';
import { R, mergeSkeletons, parseAnimation, parseLmg, parseMgn, parseSat, parseSkeleton, readIff } from './skeletal.mjs';
import { readTemplate, stringParam } from './objtemplate.mjs';
import { parseStringTable } from './datatable.mjs';
import { parseBlueprint } from './texrender.mjs';
import { riderPoseFor } from './mounts.mjs';
import { appearanceIdOf, decodeFloatArray, decodeNumberParam, decodeStringId, readClientData, tableNames } from './mobiles.mjs';

const norm = (s) => String(s ?? '').replace(/\\/g, '/').replace(/^\//, '').toLowerCase();
const stemOf = (p) => norm(p).replace(/^.*\//, '').replace(/\.[^.]+$/, '');
const short = (name) => String(name ?? '').replace(/^.*\//, '');

const FLOAT_PARAMS = ['collisionRadius', 'collisionLength', 'cameraHeight', 'stepHeight', 'swimHeight', 'scale'];
const INT_PARAMS = ['gameObjectType', 'gender'];
const ARRAY_PARAMS = ['speed', 'turnRate', 'acceleration'];

/** Every template of a chain, following the shared link and then the base, as the client does. */
function chainOf(vfs, templatePath, cache) {
  const out = [];
  let path = templatePath;
  for (let depth = 0; depth < 12 && path; depth++) {
    if (!vfs.has(path)) {
      const guess = path.replace(/([^/]+)$/, 'shared_$1');
      if (path === templatePath && !/\/shared_[^/]+$/.test(path) && vfs.has(guess)) {
        path = guess;
        continue;
      }
      break;
    }
    let t = cache.get(path);
    if (t === undefined) {
      try {
        t = readTemplate(parseIff(vfs.read(path)));
      } catch {
        t = null;
      }
      cache.set(path, t);
    }
    if (!t) break;
    out.push(t);
    const shared = stringParam(t.params.get('sharedTemplate'));
    path = shared ? norm(shared) : t.base ? norm(t.base) : null;
  }
  return out;
}

/**
 * Every mobile template, with the appearance and client data it resolves to and the first set
 * value of each parameter along its chain. The catalogue's rows are made from these.
 */
export function scanTemplates(vfs, { progress = null } = {}) {
  const cache = new Map();
  const cdfCache = new Map();
  const paths = vfs.list('object/mobile/').filter((p) => p.startsWith('object/mobile/') && /\/shared_[^/]+\.iff$/.test(p)).sort();
  const rows = [];
  for (const template of paths) {
    const chain = chainOf(vfs, template, cache);
    const first = (name, decode) => {
      for (const t of chain) {
        const v = decode(t.params.get(name));
        if (v !== undefined && v !== null && v !== '') return v;
      }
      return undefined;
    };
    const values = {};
    for (const name of FLOAT_PARAMS) values[name] = first(name, (b) => decodeNumberParam(b, true));
    for (const name of INT_PARAMS) values[name] = first(name, (b) => decodeNumberParam(b, false));
    for (const name of ARRAY_PARAMS) values[name] = first(name, decodeFloatArray);
    const appearance = first('appearanceFilename', stringParam);
    const clientData = first('clientDataFile', stringParam);
    let cdf = null;
    if (clientData) {
      const key = norm(clientData);
      if (!cdfCache.has(key)) {
        let read = null;
        try {
          if (vfs.has(key)) read = readClientData(parseIff(vfs.read(key)));
        } catch {
          read = null;
        }
        cdfCache.set(key, read);
      }
      cdf = cdfCache.get(key);
    }
    const rest = template.slice('object/mobile/'.length);
    rows.push({
      template,
      folder: rest.includes('/') ? rest.slice(0, rest.lastIndexOf('/')) : '',
      base: stemOf(template).replace(/^shared_/, ''),
      appearance: appearance ? norm(appearance) : null,
      appearanceExists: appearance ? vfs.has(norm(appearance)) : false,
      clientData: clientData ? norm(clientData) : null,
      cdf,
      values,
      objectName: first('objectName', decodeStringId),
      description: first('detailedDescription', decodeStringId),
    });
    if (progress && rows.length % 500 === 0) progress(rows.length, paths.length);
  }
  return rows;
}

/** The player species' own bodies, by appearance id: what a dressed NPC is wearing its clothes on. */
export function playerBodies(vfs) {
  const cache = new Map();
  const out = new Map();
  for (const template of vfs.list('object/creature/player/').filter((p) => /^object\/creature\/player\/shared_[^/]+\.iff$/.test(p)).sort()) {
    const chain = chainOf(vfs, template, cache);
    let appearance = null;
    for (const t of chain) {
      const a = stringParam(t.params.get('appearanceFilename'));
      if (a) {
        appearance = norm(a);
        break;
      }
    }
    if (!appearance || !appearance.endsWith('.sat')) continue;
    const species = stemOf(template).replace(/^shared_/, '');
    out.set(appearanceIdOf(appearance), { species, template, sat: appearance, gender: /female/.test(species) ? 'f' : 'm' });
  }
  return out;
}

/** How many joints a skeleton has (a LOD skeleton counts its finest level, as the meshes are weighted). */
function jointCount(vfs, file, cache) {
  const key = norm(file);
  if (cache.has(key)) return cache.get(key);
  let n = 0;
  try {
    if (vfs.has(key)) n = parseSkeleton(readIff(vfs, key), (f) => (vfs.has(f) ? readIff(vfs, f) : null)).joints.length;
  } catch {
    n = 0;
  }
  cache.set(key, n);
  return n;
}

/** A logical animation table, parsed once per run however many appearances share it. */
export function readTable(vfs, path, caches = {}) {
  caches.tables ??= new Map();
  const key = norm(path);
  if (!caches.tables.has(key)) {
    let table = { hierarchy: '', names: new Map() };
    try {
      if (vfs.has(key)) table = tableNames(readIff(vfs, key));
    } catch {
      table = { hierarchy: '', names: new Map() };
    }
    caches.tables.set(key, table);
  }
  return caches.tables.get(key);
}

/** The short names of the customization variables a shader reads, without decoding one image. */
export function shaderVariableNames(vfs, shaderPath, cache = new Map()) {
  const key = norm(shaderPath);
  if (cache.has(key)) return cache.get(key);
  const out = [];
  try {
    if (vfs.has(key)) {
      const root = parseIff(vfs.read(key));
      // Only the outermost customizable wrapper counts: loadShader resets the list for each one.
      if (isForm(root) && root.type === 'CSHD') {
        const v = root.children.find(isForm);
        const txtr = childOf(v, 'TXTR');
        const cust = txtr && childOf(txtr, 'CUST');
        for (const op of cust ? childrenOf(cust, 'TX1D') : []) {
          const r = new R(op.data);
          r.u32();
          r.i16();
          r.i16();
          out.push(short(r.str()));
        }
        const tfac = childOf(v, 'TFAC');
        for (const op of tfac ? childrenOf(tfac, 'PAL ') : []) out.push(short(new R(op.data).str()));
      }
    }
  } catch {
    return out;
  }
  cache.set(key, out);
  return out;
}

/** The same for a texture renderer's blueprint (skin, hair, eyes): its variables, names only. */
export function blueprintVariableNames(vfs, trtPath, cache = new Map()) {
  const key = norm(trtPath);
  if (cache.has(key)) return cache.get(key);
  let out = [];
  try {
    if (vfs.has(key)) out = parseBlueprint(readIff(vfs, key)).variables.map((v) => short(v.name));
  } catch {
    out = [];
  }
  cache.set(key, out);
  return out;
}

/**
 * One skeletal appearance: its skeletons and table, its meshes with the variables their shaders
 * read, and its bind-pose bounds (X mirrored, as the converter mirrors the model).
 */
export function scanAppearance(vfs, satPath, caches = {}) {
  caches.skeletons ??= new Map();
  caches.shaders ??= new Map();
  caches.blueprints ??= new Map();
  caches.appearances ??= new Map();
  const key = norm(satPath);
  if (caches.appearances.has(key)) return caches.appearances.get(key);
  const out = { id: appearanceIdOf(key), sat: key, skeletons: [], joints: 0, table: null, hierarchy: '', meshes: [], readable: [], bounds: null, riderPose: null, missing: [] };
  caches.appearances.set(key, out);
  let sat;
  try {
    sat = parseSat(readIff(vfs, key));
  } catch (err) {
    out.missing.push(`${key}: ${err.message}`);
    return out;
  }
  for (const k of sat.skeletons) {
    const joints = jointCount(vfs, k.file, caches.skeletons);
    out.skeletons.push({ file: norm(k.file), attachTo: String(k.attachTo ?? ''), joints });
    out.joints += joints;
  }
  const baseFile = sat.skeletons[0]?.file?.toLowerCase() ?? '';
  const table = sat.animationTables.get(baseFile) ?? [...sat.animationTables.values()][0] ?? null;
  if (table && vfs.has(norm(table))) {
    out.table = norm(table);
    out.hierarchy = readTable(vfs, out.table, caches).hierarchy;
  } else if (table) out.missing.push(norm(table));
  const readable = new Set();
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  let any = false;
  for (const name of sat.meshes) {
    let file = norm(name);
    if (/\.lmg$/.test(file)) {
      if (!vfs.has(file)) {
        out.missing.push(file);
        continue;
      }
      const lods = parseLmg(readIff(vfs, file));
      file = norm(lods.find((l) => vfs.has(l)) ?? lods[0] ?? '');
    }
    if (!file || !vfs.has(file)) {
      out.missing.push(file || name);
      continue;
    }
    let mgn;
    try {
      mgn = parseMgn(readIff(vfs, file));
    } catch (err) {
      out.missing.push(`${file}: ${err.message}`);
      continue;
    }
    for (const s of mgn.shaders) for (const v of shaderVariableNames(vfs, s.shader, caches.shaders)) readable.add(v);
    for (const t of mgn.textureRenderers) for (const v of blueprintVariableNames(vfs, t.file, caches.blueprints)) readable.add(v);
    for (let i = 0; i < mgn.positions.length; i += 3) {
      any = true;
      const p = [-mgn.positions[i], mgn.positions[i + 1], mgn.positions[i + 2]];
      for (let k = 0; k < 3; k++) {
        bounds.min[k] = Math.min(bounds.min[k], p[k]);
        bounds.max[k] = Math.max(bounds.max[k], p[k]);
      }
    }
    out.meshes.push({ file, part: stemOf(file), shaders: mgn.shaders.map((s) => s.shader), morphs: mgn.blendTargets.map((b) => b.name), skeletons: mgn.skeletons.map(norm) });
  }
  if (any) out.bounds = { min: bounds.min.map((v) => Number(v.toFixed(3))), max: bounds.max.map((v) => Number(v.toFixed(3))) };
  out.readable = [...readable];
  try {
    out.riderPose = riderPoseFor(vfs, key)?.pose ?? null;
  } catch {
    out.riderPose = null;
  }
  return out;
}

/**
 * An animation's header: how long it is and how much of the skeleton it really moves, which is
 * what the pack plan sizes itself with. The keys themselves are read and dropped.
 */
export function readAnimationHeader(vfs, file, caches = {}) {
  caches.headers ??= new Map();
  const key = norm(file);
  if (caches.headers.has(key)) return caches.headers.get(key);
  let out = null;
  try {
    if (vfs.has(key)) {
      const a = parseAnimation(readIff(vfs, key));
      let rotations = 0;
      let translations = 0;
      let offsets = 0;
      for (const t of a.transforms) {
        if (t.animatedRotation) rotations++;
        if ((t.translationMask & 0x38) !== 0) translations++;
        else if ((a.staticTranslations[t.xIndex] ?? 0) || (a.staticTranslations[t.yIndex] ?? 0) || (a.staticTranslations[t.zIndex] ?? 0)) offsets++;
      }
      out = { frames: Math.max(1, a.frameCount), fps: a.fps, speed: a.locomotionSpeed ?? 0, transforms: a.transforms.map((t) => t.name), animatedRotations: rotations, animatedTranslations: translations, offsetTranslations: offsets };
    }
  } catch {
    out = null;
  }
  caches.headers.set(key, out);
  return out;
}

/** One animation in full, for the bake; nothing keeps it afterwards. */
export function loadAnimation(vfs, file) {
  const key = norm(file);
  return vfs.has(key) ? parseAnimation(readIff(vfs, key)) : null;
}

/** A name table reader: (table, key) -> text, each table read once. */
export function nameLookup(vfs) {
  const cache = new Map();
  return (table, key) => {
    if (!table || key === undefined || key === null) return null;
    let strings = cache.get(table);
    if (!strings) {
      const path = `string/en/${table}.stf`;
      try {
        strings = vfs.has(path) ? parseStringTable(vfs.read(path)) : new Map();
      } catch {
        strings = new Map();
      }
      cache.set(table, strings);
    }
    return strings.get(key) ?? null;
  };
}

/**
 * A worn mesh's name, skeletons and morph names, read from its header chunks alone: the wardrobe
 * match needs the part name, and nothing needs its vertices until it is converted.
 */
export function meshInfo(vfs, lmgPath, cache = new Map()) {
  const key = norm(lmgPath);
  if (cache.has(key)) return cache.get(key);
  let out = { exists: false, mgn: null, part: stemOf(key), skeletons: [], morphs: [] };
  try {
    let file = key;
    if (/\.lmg$/.test(key) && vfs.has(key)) {
      const lods = parseLmg(readIff(vfs, key));
      file = norm(lods.find((l) => vfs.has(l)) ?? lods[0] ?? '');
    }
    if (file && vfs.has(file)) {
      const root = readIff(vfs, file);
      const v = root.children.find(isForm);
      const info = new R(childOf(v, 'INFO').data);
      info.i32();
      info.i32();
      const skeletonCount = info.i32();
      const skeletons = [];
      const sktm = childOf(v, 'SKTM');
      if (sktm) {
        const r = new R(sktm.data);
        for (let i = 0; i < skeletonCount; i++) skeletons.push(norm(r.str()));
      }
      const morphs = [];
      const blts = childOf(v, 'BLTS');
      for (const blt of blts ? childrenOf(blts, 'BLT ') : []) {
        const bi = childOf(blt, 'INFO');
        if (bi && bi.data.length > 8) morphs.push(new R(bi.data.subarray(8)).str());
      }
      out = { exists: true, mgn: file, part: stemOf(file), skeletons, morphs };
    }
  } catch {
    out = { exists: false, mgn: null, part: stemOf(key), skeletons: [], morphs: [] };
  }
  cache.set(key, out);
  return out;
}

/** The merged skeleton of a set, exactly as the model conversion merges it, so the joints line up. */
export function loadSkeletonSet(vfs, skeletons) {
  const load = (file) => parseSkeleton(readIff(vfs, file), (f) => (vfs.has(f) ? readIff(vfs, f) : null));
  const base = load(skeletons[0].file);
  const extras = skeletons.slice(1).filter((k) => vfs.has(k.file)).map((k) => ({ skeleton: load(k.file), attachTo: k.attachTo, file: k.file }));
  return mergeSkeletons(base, extras);
}
