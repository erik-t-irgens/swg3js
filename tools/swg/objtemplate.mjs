// Object template (.iff) reader, following SharedObjectTemplate::load:
//   FORM <TYPE> > [FORM DERV > XXXX { cstring base template }] > FORM 00NN > PCNT { int32 n } + n x XXXX { cstring name, value }
// String values are int8 dataType (1 = SINGLE) then a cstring. Parameters not
// present are inherited from the base template chain.
import { childrenOf, isForm, readCString, parseIff } from './iff.mjs';
import { appearancePath, resolveParts } from './appearance.mjs';

const SINGLE = 1;

/**
 * Template files nest class sections: FORM STAT { [DERV], FORM 0000 { PCNT, params },
 * FORM SHOT { [DERV], FORM 0010 { PCNT, params } } }. Walk every form and
 * collect parameters from all levels; the outermost DERV is the base template.
 */
export function readTemplate(root) {
  if (!isForm(root)) throw new Error('template root is not a FORM');
  let base = null;
  const params = new Map();
  const walk = (form) => {
    for (const child of form.children) {
      if (isForm(child)) {
        if (child.type === 'DERV') {
          const chunk = child.children.find((c) => !isForm(c));
          if (chunk && base === null) base = readCString(chunk.data).value.replace(/\\/g, '/');
        } else {
          walk(child);
        }
      } else if (child.tag !== 'PCNT') {
        const { value: name, next } = readCString(child.data);
        if (name && !params.has(name)) params.set(name, child.data.subarray(next));
      }
    }
  };
  walk(root);
  return { type: root.type, base, params };
}

export function stringParam(buf) {
  if (!buf || buf.length < 2 || buf[0] !== SINGLE) return null;
  return readCString(buf, 1).value.replace(/\\/g, '/');
}

/**
 * Resolve an object template to mesh parts by following the DERV chain for
 * appearanceFilename (or a building's portalLayoutFilename), then unwrapping
 * .pob (exterior cell), .apt, .lod and .cmp. Returns { appearance, parts, effects? } for meshes,
 * { appearance, particle, parts: [] } for a particle effect on its own, or { skip }.
 */
export function resolveTemplateMesh(vfs, templatePath, cache = new Map()) {
  if (cache.has(templatePath)) return cache.get(templatePath);
  let result;
  if (/^object\/cell\//.test(templatePath)) result = { skip: 'cell container (not renderable)' };
  else if (/^object\/soundobject\//.test(templatePath)) result = { skip: 'sound object' };
  try {
    if (result) throw null;
    let appearance = null;
    let path = templatePath;
    let lastParams = [];
    for (let depth = 0; depth < 12 && path; depth++) {
      if (!vfs.has(path)) {
        // Server templates name their client twin; fall back to the shared_ naming convention.
        const guess = path.replace(/([^/]+)$/, 'shared_$1');
        if (path === templatePath && !/\/shared_[^/]+$/.test(path) && vfs.has(guess)) {
          path = guess;
          continue;
        }
        result = { skip: `template missing: ${path}` };
        break;
      }
      const t = readTemplate(parseIff(vfs.read(path)));
      lastParams = [...t.params.keys()];
      // Buildings usually leave appearanceFilename empty and carry their look in the portal layout.
      const a = stringParam(t.params.get('appearanceFilename')) || stringParam(t.params.get('portalLayoutFilename'));
      if (a) {
        appearance = a;
        break;
      }
      // Server object templates link to the client template that holds the appearance.
      const shared = stringParam(t.params.get('sharedTemplate'));
      if (shared) {
        path = shared;
        continue;
      }
      if (!t.base) {
        const guess = templatePath.replace(/([^/]+)$/, 'shared_$1');
        if (path !== guess && vfs.has(guess)) {
          path = guess;
          continue;
        }
      }
      path = t.base;
    }
    if (!result) {
      if (!appearance) result = { skip: `no appearanceFilename (params: ${lastParams.join(', ') || 'none'})` };
      else result = resolveAppearanceToMesh(vfs, appearance);
    }
  } catch (err) {
    if (err) result = { skip: `error: ${err.message}` };
  }
  cache.set(templatePath, result);
  return result;
}

/**
 * Separate an appearance's particle effects from its meshes: an effect on its own (a campfire's
 * smoke) becomes { particle }, a mesh with effects attached (a candle with its flame) keeps them
 * in `effects` with their transforms in the appearance's space.
 */
function splitParticles(appearance, parts) {
  const meshes = parts.filter((p) => p.mesh);
  const effects = parts.filter((p) => p.particle).map((p) => ({ particle: p.particle, transform: p.transform }));
  if (!meshes.length && effects.length) return { appearance, particle: effects[0].particle, parts: [], effects: effects.slice(1) };
  return effects.length ? { appearance, parts: meshes, effects } : { appearance, parts: meshes };
}

export function resolveAppearanceToMesh(vfs, rawAppearance) {
  const appearance = appearancePath(rawAppearance);
  const lower = appearance.toLowerCase();
  if (lower.endsWith('.pob')) {
    if (!vfs.has(appearance)) return { skip: `pob missing: ${appearance}` };
    try {
      return splitParticles(appearance, resolveParts(vfs, appearance));
    } catch (err) {
      return { skip: `pob failed: ${err.message}` };
    }
  }
  // Skeletal appearances (creatures, and static things with animated parts such as the Sarlacc)
  // resolve to their .sat; the caller decides whether to bake one at its bind pose.
  if (lower.endsWith('.sat')) return vfs.has(appearance) ? { appearance, skeletal: appearance, parts: [] } : { skip: `skeletal appearance missing: ${appearance}` };
  if (!/\.(apt|lod|msh|cmp|prt)$/.test(lower)) return { skip: `appearance type ${lower.slice(lower.lastIndexOf('.'))}` };
  try {
    return splitParticles(appearance, resolveParts(vfs, appearance));
  } catch (err) {
    return { skip: `resolve failed: ${err.message}` };
  }
}

/**
 * First value of any of the named string parameters along a template's
 * inheritance chain (sharedTemplate link, DERV base, shared_ naming fallback).
 */
export function resolveTemplateString(vfs, templatePath, names, cache = new Map()) {
  const key = `${templatePath}|${names.join(',')}`;
  if (cache.has(key)) return cache.get(key);
  let result = null;
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
    let t;
    try {
      t = readTemplate(parseIff(vfs.read(path)));
    } catch {
      break;
    }
    for (const name of names) {
      const v = stringParam(t.params.get(name));
      if (v) {
        result = v;
        break;
      }
    }
    if (result) break;
    const shared = stringParam(t.params.get('sharedTemplate'));
    if (shared) {
      path = shared;
      continue;
    }
    if (!t.base) {
      const guess = templatePath.replace(/([^/]+)$/, 'shared_$1');
      if (path !== guess && vfs.has(guess)) {
        path = guess;
        continue;
      }
    }
    path = t.base;
  }
  cache.set(key, result);
  return result;
}
