// What a shader says about its surface beyond its main texture: flip-books (root SWTS, a list of
// textures, and SWSH, a list of whole shaders), texture scrolling (TSNS) where the effect's vertex
// program applies it, split alpha (colour and alpha scrolled apart from one texture), glow (unlit
// screens, additive effects, and textures lit toward themselves by a mask), and the effect pass read
// at the offsets its version uses. `surfaceTexture` turns all of it into the texture entry `glb.mjs`
// writes; everything else here is a pure function over parsed IFF nodes or RGBA images.
// eff.mjs imports this module and re-exports `alphaModeFor` from it; nothing here imports eff.mjs.
import { childOf, childrenOf, findAll, find, isForm, parseIff, readCString } from './iff.mjs';
import { shaderTextures } from './sht.mjs';

/** Manifests written by this code carry it; `status` asks for a run when a pack's is older. */
export const MATERIAL_FORMAT = 2;

/** The glTF alpha mode an effect's pass state gives (a cut-out effect by name is a MASK too). */
export function alphaModeFor({ alphaBlend, alphaTest }, effectName = '') {
  const name = effectName.toLowerCase();
  if (alphaTest || /punchout|atest|alphatest|cutout/.test(name)) return 'MASK';
  if (alphaBlend) return 'BLEND';
  return 'OPAQUE';
}

/** A slot tag as stored in a chunk: four bytes, little-endian ("NIAM" on disk is MAIN). */
function tagAt(buf, offset = 0) {
  if (!buf || buf.length < offset + 4) return '????';
  return Buffer.from(buf.subarray(offset, offset + 4)).reverse().toString('latin1');
}

const slashes = (p) => p.replace(/\\/g, '/');

/** A shader path as the archives key it: backslashes, case, and exporter paths (c:\a_exported\shader\x.sht -> shader/x.sht). */
export function shaderPathOf(raw) {
  let p = slashes(String(raw ?? '').trim()).toLowerCase();
  // An exporter's absolute path: the file lives under shader/ by its own name.
  if (/^[a-z]:\//.test(p) || p.includes('/a_exported/')) p = `shader/${p.slice(p.lastIndexOf('/') + 1)}`;
  return p.replace(/^\.?\/+/, '');
}

/**
 * Timing form (DTST, DRTS, DPPT, DFST, DRFS) -> { mode: 'time'|'random'|'pingpong'|'frame'|'randomFrame', count, seconds: [min, max] }.
 * DTST [s,s] 'time'; DRTS [min(a,b), max(a,b)] 'random'; DPPT [min(a,b), max(a,b)] 'pingpong';
 * DFST 'frame', DRFS 'randomFrame', both [1/30, 1/30]. The names are the client's switcher classes
 * (DeltaTimeSwitcher, DeltaRandomTimeSwitcher, DeltaPingPongSwitcher, DeltaFrameSwitcher,
 * DeltaRandomFrameSwitcher); DRFT (random frame, random time) is read as a random frame with its range.
 * Null for anything else.
 */
export function timingOf(form) {
  if (!form || !isForm(form)) return null;
  const data = form.children.find((c) => !isForm(c))?.data;
  if (!data || data.length < 4) return null;
  const count = data.readInt32LE(0);
  const f = (i) => (data.length >= 8 + i * 4 ? data.readFloatLE(4 + i * 4) : NaN);
  const range = () => {
    const a = f(0);
    const b = f(1);
    if (!Number.isFinite(a)) return null;
    if (!Number.isFinite(b)) return [a, a];
    return [Math.min(a, b), Math.max(a, b)];
  };
  const perFrame = 1 / 30;
  switch (form.type) {
    case 'DTST': {
      const s = f(0);
      return Number.isFinite(s) ? { mode: 'time', count, seconds: [s, s] } : null;
    }
    case 'DRTS': {
      const r = range();
      return r ? { mode: 'random', count, seconds: r } : null;
    }
    case 'DPPT': {
      const r = range();
      return r ? { mode: 'pingpong', count, seconds: r } : null;
    }
    case 'DFST':
      return { mode: 'frame', count, seconds: [perFrame, perFrame] };
    case 'DRFS':
      return { mode: 'randomFrame', count, seconds: [perFrame, perFrame] };
    case 'DRFT':
      return { mode: 'randomFrame', count, seconds: range() ?? [perFrame, perFrame] };
    default:
      return null;
  }
}

/**
 * Where a pass's render state sits in its DATA chunk, by pass version (texrender's parsePassData
 * reads the same): versions 2 to 4 start with a pixel-shader byte, and from version 10 a heat byte
 * follows dither, so in both every field from z-enable on is one byte later than in 5 to 9.
 */
function passOffsets(version) {
  if (version === 0) return { zWrite: 4, alphaBlend: 6 };
  if (version === 1) return { zWrite: 8, alphaBlend: 10 };
  const o = version <= 4 || version >= 10 ? 1 : 0;
  return { zWrite: 5 + o, alphaBlend: 7 + o };
}

function readPass(passForm) {
  const pv = passForm?.children.find(isForm);
  const data = pv ? childOf(pv, 'DATA')?.data : null;
  if (!pv || !data) return null;
  const version = Number.parseInt(pv.type, 10);
  if (!Number.isFinite(version)) return null;
  const at = passOffsets(version);
  const test = at.alphaBlend + 4;
  if (data.length <= test) return null;
  return {
    pv,
    version,
    zWrite: data[at.zWrite] !== 0,
    alphaBlend: data[at.alphaBlend] !== 0,
    blendOp: data.readInt8(at.alphaBlend + 1),
    blendSrc: data.readInt8(at.alphaBlend + 2),
    blendDst: data.readInt8(at.alphaBlend + 3),
    alphaTest: data[test] !== 0,
    // A zero tag names no reference: the test compares against 0.
    alphaRefTag: data.length >= test + 5 && data.readUInt32LE(test + 1) !== 0 ? tagAt(data, test + 1) : null,
  };
}

/**
 * The first implementation's first pass, read at the offsets for its version (the implementations are
 * listed best first, so this is the one a modern client runs), plus whether any implementation's first
 * pass blends or tests (the rule `effectAlpha` has always used). Null when no implementation has a pass.
 *  -> { version, zWrite, alphaBlend, blendOp, blendSrc, blendDst, alphaTest, alphaRefTag, additive,
 *       anyBlend, anyTest, lastVersion, vertexProgram, pixelProgram, samplers: { [register]: tag } }
 */
export function passState(efctRoot) {
  if (!isForm(efctRoot) || efctRoot.type !== 'EFCT') throw new Error(`Not an effect (got ${efctRoot?.type ?? efctRoot?.tag})`);
  let first = null;
  let anyBlend = false;
  let anyTest = false;
  let lastVersion = null;
  for (const impl of findAll(efctRoot, 'IMPL')) {
    const p = readPass(find(impl, 'PASS'));
    if (!p) continue;
    first ??= p;
    lastVersion = String(p.pv.type);
    if (p.alphaBlend) anyBlend = true;
    if (p.alphaTest) anyTest = true;
  }
  if (!first) return null;
  const { pv, ...state } = first;
  const pvsh = childOf(pv, 'PVSH');
  const vchunk = pvsh?.children.find((c) => !isForm(c));
  const vertexProgram = vchunk ? slashes(readCString(vchunk.data).value).toLowerCase() || null : null;
  let pixelProgram = null;
  const samplers = {};
  const ppsh = childOf(pv, 'PPSH');
  if (ppsh) {
    const pf = ppsh.children.find(isForm) ?? ppsh;
    const data = childOf(pf, 'DATA')?.data;
    if (data && data.length > 1) pixelProgram = slashes(readCString(data, 1).value).toLowerCase() || null;
    for (const ptxm of childrenOf(pf, 'PTXM')) {
      const c = ptxm.children.find((x) => !isForm(x))?.data;
      if (c && c.length >= 5) samplers[c[0]] = tagAt(c, 1);
    }
  }
  // Additive: destination One under the add operation (0); e_particle_subtract (operation 2) darkens instead.
  return { ...state, additive: state.alphaBlend && state.blendDst === 1 && state.blendOp === 0, anyBlend, anyTest, lastVersion, vertexProgram, pixelProgram, samplers };
}

/**
 * Which texcoord sets a vertex program moves by textureScroll: { set0: 'xy'|'zw'|null, set1: ... }.
 * Each statement that adds `textureScroll.<swizzle>` names the set it writes by the number its target ends in.
 */
export function scrollSets(vshText) {
  const out = { set0: null, set1: null };
  if (!vshText) return out;
  const text = vshText.replace(/\/\/[^\n]*/g, '');
  for (const stmt of text.split(';')) {
    const hit = /textureScroll(?!\w)(?:\s*\.\s*([xyzw]+))?/.exec(stmt);
    if (!hit || /register\s*\(/.test(stmt)) continue;
    // Two components move a texcoord pair; one (holonet's vertex offsets) is not a UV use.
    const swizzle = hit[1] ?? 'xy';
    if (swizzle !== 'xy' && swizzle !== 'zw') continue;
    const eq = stmt.indexOf('=');
    if (eq < 0 || eq > hit.index) continue;
    const target = stmt.slice(0, eq).replace(/[+\-*/]$/, '').trim();
    // The target must be a texture coordinate output (textureCoordinateSet1, tcs0, oT1, texcoord0).
    const coord = /(?:textureCoordinateSet|texcoord|tcs|tc|oT)(\d*)\s*(?:\.[xyzw]+)?$/i.exec(target);
    if (!coord) continue;
    const set = coord[1] ? Number(coord[1]) : 0;
    if (set === 0 && !out.set0) out.set0 = swizzle;
    else if (set === 1 && !out.set1) out.set1 = swizzle;
  }
  return out;
}

/** The pixel program takes RGB from sampler 0 and alpha from sampler 1, both on the same tag (a_splitalpha). */
export function isSplitAlpha(pixelName, pixelText, samplers) {
  const s0 = samplers?.[0];
  if (!s0 || s0 !== samplers?.[1]) return false;
  const text = (pixelText ?? '').replace(/\/\/[^\n]*/g, '');
  // ps.1.x: the colour from t0, the alpha from t1's alpha.
  const asm = /r0\.rgb\s*,\s*t0\b/.test(text) && /r0\.a\s*,\s*t1\.a\b/.test(text);
  return asm || /splitalpha/i.test(pixelName ?? '');
}

/** The slot a sampler variable most likely reads, when its register is not declared in the program. */
function slotByVariable(name) {
  const n = name.toLowerCase();
  if (/spec/.test(n)) return 'SPEC';
  if (/emis/.test(n)) return 'EMIS';
  if (/normal|nrml|bump/.test(n)) return 'NRML';
  return 'MAIN';
}

/**
 * How an effect glows (table 3.5 of the design): null | { kind: 'full' } | { kind: 'add' } |
 * { kind: 'mask', slot: 'MAIN'|'EMIS'|'NRML'|'SPEC', channel: 'a'|'rgb' }.
 * HLSL programs are read for the `emisMask`/`emisMap` assignment and the sampler it samples, directly or
 * through the local most recently read before it (its register gives the tag); assembly for the first
 * `lrp rN.rgb, tK.a, tJ` whose tJ is on MAIN (sampler K's tag); otherwise the name decides.
 */
export function emissiveOf(effectName, pixelText, samplers) {
  const name = slashes(effectName ?? '').toLowerCase().replace(/^.*\//, '');
  const text = (pixelText ?? '').replace(/\/\/[^\n]*/g, '');
  if (/emisadd/.test(name)) return { kind: 'add' };
  if (/emis_?full/.test(name)) return { kind: 'full' };
  // Assembly: the lit colour lerps toward the texture itself (a sampler on MAIN) by a sampler's alpha.
  // An lrp toward the environment cube (ENVM, the envmask programs) is an environment mask, not a glow.
  let lrpGlow = null;
  for (const m of text.matchAll(/\blrp\s+r\d+\.rgb\s*,\s*t(\d+)\.a\s*,\s*t(\d+)\b/g)) {
    if (samplers?.[Number(m[2])] === 'MAIN') {
      lrpGlow = m;
      break;
    }
  }
  const hasEmisCode = /\bemis(?:Mask|Map)\s*=/.test(text) || !!lrpGlow;
  if (!/emis/.test(name) && !hasEmisCode) {
    // An unnamed (inline) effect: an additive program writes no alpha, an unlit one no light.
    if (/result\.a\s*=\s*0(?:\.0)?f?\s*;/.test(text) && /result\.rgb\s*=\s*tex2D/.test(text)) return { kind: 'add' };
    return null;
  }
  // HLSL: sampler variables to tags by their declared registers, locals to the samplers they read.
  const bySampler = new Map();
  for (const m of text.matchAll(/sampler\w*\s+(\w+)\s*:\s*register\s*\(\s*s(\d+)\s*\)/g)) {
    const tag = samplers?.[Number(m[2])];
    if (tag) bySampler.set(m[1], tag);
  }
  const slotOf = (samplerVar) => bySampler.get(samplerVar) ?? slotByVariable(samplerVar);
  const assign = /\bemis(?:Mask|Map)\s*=\s*([^;]+);/.exec(text);
  if (assign) {
    const rhs = assign[1];
    const direct = /tex2D\w*\s*\(\s*(\w+)[^)]*\)\s*\.\s*(rgb|a)\b/.exec(rhs);
    if (direct) return { kind: 'mask', slot: slotOf(direct[1]), channel: direct[2] };
    const viaLocal = /\b(\w+)\s*\.\s*(rgb|a)\b/.exec(rhs);
    if (viaLocal) {
      // The nearest read before the assignment: a program may reuse one local name in separate blocks
      // (a_specmap_bump_emismap reads `sample` from the diffuse map, then from the normal map for the mask).
      const reads = [...text.slice(0, assign.index).matchAll(new RegExp(`\\b${viaLocal[1]}\\s*=\\s*tex2D\\w*\\s*\\(\\s*(\\w+)`, 'g'))];
      if (reads.length) return { kind: 'mask', slot: slotOf(reads[reads.length - 1][1]), channel: viaLocal[2] };
    }
  }
  if (lrpGlow) return { kind: 'mask', slot: samplers?.[Number(lrpGlow[1])] ?? 'MAIN', channel: 'a' };
  if (/emismap/.test(name)) return { kind: 'mask', slot: 'MAIN', channel: 'a' };
  return null;
}

/** Records of a shader's TSNS / ARVS / TCSS form: tag -> values. */
function records(v, formName, size, read) {
  const out = new Map();
  const f = childOf(v, formName);
  const data = f?.children.find((c) => !isForm(c))?.data;
  if (!data) return out;
  for (let o = 0; o + size <= data.length; o += size) out.set(tagAt(data, o), read(data, o + 4));
  return out;
}

const blank = (shader) => ({
  kind: null,
  shader,
  base: undefined,
  effect: null,
  inline: false,
  main: null,
  mainSlot: null,
  textures: [],
  pass: null,
  alphaRef: 0,
  scroll: null,
  split: false,
  emissive: null,
  anim: null,
  timing: null,
  flip: null,
  programs: { vertex: null, pixel: null },
  records: { scroll: {}, alphaRefs: {}, texcoordSets: {} },
  notes: [],
});

/** A program's source text, read once per cache. */
function programText(vfs, path, cache) {
  if (!path) return null;
  const key = `\0program:${path}`;
  if (!cache.has(key)) cache.set(key, vfs.has(path) ? vfs.read(path).toString('latin1') : null);
  return cache.get(key);
}

/** An effect file's pass state, read once per cache. */
function effectState(vfs, path, cache) {
  const key = `\0effect:${path.toLowerCase()}`;
  if (!cache.has(key)) {
    let state = null;
    let note = null;
    try {
      if (vfs.has(path)) state = passState(parseIff(vfs.read(path)));
      else note = `effect ${path} not in the archives`;
    } catch (err) {
      note = `effect ${path} unreadable: ${err.message}`;
    }
    cache.set(key, { state, note });
  }
  return cache.get(key);
}

function describeStatic(vfs, ssht, out, cache) {
  const v = ssht.children.find(isForm);
  if (!v) return out;
  const nameChunk = childOf(v, 'NAME');
  const inline = childOf(v, 'EFCT');
  const t = shaderTextures(ssht);
  out.main = t.main;
  out.textures = t.slots.map((s) => ({ slot: s.slot, path: s.path }));
  out.mainSlot = t.slots.find((s) => s.path === t.main)?.slot ?? null;
  out.effect = nameChunk ? slashes(readCString(nameChunk.data).value) || null : null;
  out.inline = !nameChunk && !!inline;
  if (out.inline) {
    try {
      out.pass = passState(inline);
    } catch (err) {
      out.notes.push(`inline effect unreadable: ${err.message}`);
    }
  } else if (out.effect) {
    const e = effectState(vfs, out.effect, cache);
    out.pass = e.state;
    if (e.note) out.notes.push(e.note);
  }
  const scrolls = records(v, 'TSNS', 20, (d, o) => [0, 1, 2, 3].map((i) => Math.round(d.readFloatLE(o + i * 4) * 1e4) / 1e4));
  const refs = records(v, 'ARVS', 5, (d, o) => d[o]);
  const coordSets = records(v, 'TCSS', 5, (d, o) => d[o]);
  out.records = { scroll: Object.fromEntries(scrolls), alphaRefs: Object.fromEntries(refs), texcoordSets: Object.fromEntries(coordSets) };
  out.alphaRef = out.pass?.alphaRefTag ? (refs.get(out.pass.alphaRefTag) ?? 0) : 0;
  const pass = out.pass;
  if (!pass) return out;
  out.programs = { vertex: pass.vertexProgram, pixel: pass.pixelProgram };
  const vsh = programText(vfs, pass.vertexProgram, cache);
  const psh = programText(vfs, pass.pixelProgram, cache);
  out.split = isSplitAlpha(pass.pixelProgram, psh, pass.samplers);
  out.emissive = emissiveOf(out.effect ?? (out.inline ? '' : pass.pixelProgram), psh, pass.samplers);
  const sets = scrollSets(vsh);
  const rates = scrolls.get(out.mainSlot ?? 'MAIN') ?? scrolls.get('MAIN');
  if (rates && sets.set0 === 'xy') {
    const alpha = out.split && sets.set1 === 'zw' && (rates[2] || rates[3]) ? [rates[2], rates[3]] : null;
    if (rates[0] || rates[1] || alpha) out.scroll = { map: [rates[0], rates[1]], alpha };
  }
  return out;
}

/**
 * Everything a shader file says about its surface, following SWTS and SWSH to their base (depth <= 3).
 *  -> { kind: 'SSHT'|'CSHD'|'SWTS'|'SWSH'|'OPST'|null, shader, base?, effect: string|null, inline: boolean,
 *       main: string|null, mainSlot, textures: [{ slot, path }], pass, alphaRef, scroll: { map: [u,v], alpha: [u,v]|null }|null,
 *       split: boolean, emissive, anim: { mode, seconds, frames: [path], missing: [path] }|null,
 *       timing, flip: { frames, missing: [path] }|null, programs: { vertex, pixel }, notes: [string] }
 * `anim` is null whenever a frame is missing (`flip.missing` names them); frame 1, if present, is still the main.
 */
export function describeSurface(vfs, shaderPath, cache = new Map(), depth = 0) {
  const key = shaderPathOf(shaderPath);
  if (cache.has(key)) return cache.get(key);
  const out = blank(key);
  if (!vfs.has(key)) {
    out.notes.push(`${key} not in the archives`);
    cache.set(key, out);
    return out;
  }
  const root = parseIff(vfs.read(key));
  out.kind = root.type;
  if (root.type === 'SWTS') describeTextureFlip(vfs, root, out, cache, depth);
  else if (root.type === 'SWSH') describeShaderFlip(vfs, root, out, cache, depth);
  else {
    const ssht = root.type === 'SSHT' ? root : findAll(root, 'SSHT')[0];
    if (ssht) describeStatic(vfs, ssht, out, cache);
    else {
      const t = shaderTextures(root);
      out.main = t.main;
      out.textures = t.slots.map((s) => ({ slot: s.slot, path: s.path }));
      out.mainSlot = t.slots.find((s) => s.path === t.main)?.slot ?? null;
    }
  }
  cache.set(key, out);
  return out;
}

/** Copy a described base into a flip-book's own description, arrays included. */
function adopt(out, base) {
  for (const k of ['effect', 'inline', 'main', 'mainSlot', 'pass', 'alphaRef', 'scroll', 'split', 'emissive', 'programs', 'records']) out[k] = base[k];
  out.textures = base.textures.map((t) => ({ ...t }));
  out.notes.push(...base.notes);
}

function describeTextureFlip(vfs, root, out, cache, depth) {
  const v = root.children.find(isForm);
  if (!v) return;
  const nameChunk = childOf(v, 'NAME');
  const basePath = nameChunk ? shaderPathOf(readCString(nameChunk.data).value) : null;
  const timing = timingOf(v.children.find((c) => isForm(c) && c.type.startsWith('D')));
  out.timing = timing;
  const texts = childrenOf(v, 'TEXT').map((c) => ({ slot: tagAt(c.data, 0), path: readCString(c.data, 4).value }));
  out.base = basePath ?? undefined;
  if (basePath && depth < 3) {
    const base = describeSurface(vfs, basePath, cache, depth + 1);
    adopt(out, base);
    if (!base.kind) out.notes.push(`base ${basePath} not in the archives`);
  } else if (basePath) out.notes.push(`base ${basePath} is nested too deep`);
  if (!texts.length) {
    out.notes.push('a flip-book with no frames');
    return;
  }
  const baseSlot = out.mainSlot ?? 'MAIN';
  const frameSlot = texts[0].slot;
  const missing = texts.filter((t) => !vfs.has(t.path)).map((t) => t.path);
  out.flip = { frames: texts.length, missing };
  if (frameSlot !== baseSlot) {
    out.notes.push(`frames in slot ${frameSlot}, not the base's main ${baseSlot}: not animated`);
    return;
  }
  // Frame 1 replaces the base's main, in the texture list too, whether or not the rest are there.
  out.main = vfs.has(texts[0].path) ? texts[0].path : null;
  out.mainSlot = frameSlot;
  const i = out.textures.findIndex((t) => t.slot === frameSlot);
  if (i >= 0) out.textures[i] = { slot: frameSlot, path: texts[0].path };
  else out.textures.unshift({ slot: frameSlot, path: texts[0].path });
  if (missing.length) {
    out.notes.push(`${missing.length} of ${texts.length} frames missing: not animated`);
    return;
  }
  if (!timing) {
    out.notes.push('a timing form this converter does not know: not animated');
    return;
  }
  if (texts.length < 2) return;
  if (out.scroll) {
    out.notes.push('flip-book over a scrolling base: scroll ignored');
    out.scroll = null;
  }
  out.anim = { mode: timing.mode, seconds: timing.seconds, frames: texts.map((t) => t.path), missing: [] };
}

function describeShaderFlip(vfs, root, out, cache, depth) {
  const v = root.children.find(isForm);
  if (!v) return;
  const timing = timingOf(v.children.find((c) => isForm(c) && c.type.startsWith('D')));
  out.timing = timing;
  const names = childrenOf(v, 'NAME').map((c) => shaderPathOf(readCString(c.data).value));
  const present = names.filter((n) => vfs.has(n));
  out.flip = { frames: names.length, missing: names.filter((n) => !vfs.has(n)) };
  if (!present.length) {
    out.notes.push(`0/${names.length} frame shaders in the archives`);
    return;
  }
  if (depth >= 3) {
    out.notes.push('frame shaders nested too deep');
    return;
  }
  const frames = names.map((n) => (vfs.has(n) ? describeSurface(vfs, n, cache, depth + 1) : null));
  const first = frames.find(Boolean);
  out.base = first.shader;
  adopt(out, first);
  if (present.length < names.length) {
    out.notes.push(`${names.length - present.length} of ${names.length} frame shaders missing: not animated`);
    return;
  }
  if (!timing) {
    out.notes.push('a timing form this converter does not know: not animated');
    return;
  }
  if (frames.some((f) => f.effect !== first.effect || f.inline !== first.inline)) {
    out.notes.push('frame shaders use different effects: not animated');
    return;
  }
  if (frames.some((f) => !f.main || !vfs.has(f.main))) {
    out.notes.push('a frame shader has no main texture in the archives: not animated');
    return;
  }
  if (names.length < 2) return;
  if (out.scroll) {
    out.notes.push('flip-book over a scrolling base: scroll ignored');
    out.scroll = null;
  }
  out.anim = { mode: timing.mode, seconds: timing.seconds, frames: frames.map((f) => f.main), missing: [] };
}

// ---------------------------------------------------------------------------------------------
// Images: { width, height, rgba }. Colour arithmetic in linear light.

const SRGB_TO_LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function encodeSrgb(linear) {
  const l = linear <= 0 ? 0 : linear >= 1 ? 1 : linear;
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.round(c * 255);
}

/** The colour with alpha forced to 255 (a split-alpha colour; a One/One additive surface). */
export function rgbOnly(img) {
  const rgba = new Uint8Array(img.rgba);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return { width: img.width, height: img.height, rgba };
}

/** The alpha as grey (r = g = b = a, a = 255): three's alphaMap reads green. */
export function alphaAsGrey(img) {
  const rgba = new Uint8Array(img.width * img.height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = img.rgba[i + 3];
    rgba[i] = a;
    rgba[i + 1] = a;
    rgba[i + 2] = a;
    rgba[i + 3] = 255;
  }
  return { width: img.width, height: img.height, rgba };
}

/** The mask values at img's size (the mask sampled nearest) and their largest. */
function maskValues(img, mask, channel) {
  const m = new Float32Array(img.width * img.height);
  let max = 0;
  for (let y = 0; y < img.height; y++) {
    const my = Math.min(mask.height - 1, Math.floor((y * mask.height) / img.height));
    for (let x = 0; x < img.width; x++) {
      const mx = Math.min(mask.width - 1, Math.floor((x * mask.width) / img.width));
      const j = (my * mask.width + mx) * 4;
      const v = (channel === 'rgb' ? Math.max(mask.rgba[j], mask.rgba[j + 1], mask.rgba[j + 2]) : mask.rgba[j + 3]) / 255;
      m[y * img.width + x] = v;
      if (v > max) max = v;
    }
  }
  return { m, max };
}

/** Float32Array of m in [0,1] at img's size (mask resampled nearest); null when max m < 8/255. */
export function maskOf(img, mask, channel) {
  const { m, max } = maskValues(img, mask, channel);
  return max < 8 / 255 ? null : m;
}

/**
 * Split a texture into a lit base colour and a glow that add up to it in linear light:
 * lit.rgb = enc(dec(rgb)·(1−m)), emis.rgb = enc(dec(rgb)·m); lit.a = keepAlpha ? img.a : 255; emis.a = 255.
 */
export function splitGlow(img, m, keepAlpha) {
  const n = img.width * img.height;
  const lit = new Uint8Array(n * 4);
  const emis = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const k = m[i];
    for (let c = 0; c < 3; c++) {
      const l = SRGB_TO_LINEAR[img.rgba[i * 4 + c]];
      lit[i * 4 + c] = encodeSrgb(l * (1 - k));
      emis[i * 4 + c] = encodeSrgb(l * k);
    }
    lit[i * 4 + 3] = keepAlpha ? img.rgba[i * 4 + 3] : 255;
    emis[i * 4 + 3] = 255;
  }
  return { lit: { width: img.width, height: img.height, rgba: lit }, emis: { width: img.width, height: img.height, rgba: emis } };
}

/** Box-filter halving until the long side is <= max. */
export function fitRgba(img, max) {
  let cur = img;
  while (Math.max(cur.width, cur.height) > max && (cur.width > 1 || cur.height > 1)) {
    const w = Math.max(1, cur.width >> 1);
    const h = Math.max(1, cur.height >> 1);
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      const y0 = Math.min(cur.height - 1, y * 2);
      const y1 = Math.min(cur.height - 1, y * 2 + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.min(cur.width - 1, x * 2);
        const x1 = Math.min(cur.width - 1, x * 2 + 1);
        for (let c = 0; c < 4; c++) {
          const s = cur.rgba[(y0 * cur.width + x0) * 4 + c] + cur.rgba[(y0 * cur.width + x1) * 4 + c] + cur.rgba[(y1 * cur.width + x0) * 4 + c] + cur.rgba[(y1 * cur.width + x1) * 4 + c];
          out[(y * w + x) * 4 + c] = (s + 2) >> 2;
        }
      }
    }
    cur = { width: w, height: h, rgba: out };
  }
  return cur === img ? { width: img.width, height: img.height, rgba: img.rgba } : cur;
}

/** The glow images of one texture are capped at this size; its lit image with them, texel for texel. */
export const GLOW_MAX = 512;

/** A main image handed in by deps.mainImage, as decodeDds gives one: `hasAlpha` from the answer, else read from its pixels. */
function paintedImage(img) {
  let hasAlpha = img.hasAlpha;
  if (typeof hasAlpha !== 'boolean') {
    hasAlpha = false;
    for (let i = 3; i < img.rgba.length; i += 4) {
      if (img.rgba[i] !== 255) {
        hasAlpha = true;
        break;
      }
    }
  }
  return { width: img.width, height: img.height, rgba: img.rgba, hasAlpha };
}

/**
 * The whole texture entry for one shader: what textureFor returned before, plus the new fields.
 * deps: { cache, decodeDds, encodePng, alphaFromEffect(effect, fallback), surfaceFor(effect, slots, dds, alphaMode, { alphaIsEmissive }),
 *         normalFor(path), glassNamed: RegExp, byName(effect), log, thumb?(width, height, rgba),
 *         mainImage?(shaderPath) -> { path, width, height, rgba, hasAlpha? } | null }.
 * With `thumb`, the entry carries a non-enumerable `thumb` made from the unsplit main image.
 * With `mainImage` answering (a customizable shader baked at its defaults, the ships command's paint),
 * that image replaces the main texture before every later step (the gloss mask, the glow split, the
 * opaque copy, the thumbnail) and the entry's path is the answer's, so a painted hull glows where its
 * painted colour does; answering null leaves the shader as its main texture has it. The answer's alpha
 * is the gloss mask (and a MAIN-alpha glow's mask), so it should be the chosen pattern's own alpha, as
 * the ships command's paint hands it. A flip-book is never painted: its answer is dropped with a note.
 */
export function surfaceTexture(vfs, shaderPath, deps) {
  const log = deps.log ?? (() => {});
  const d = describeSurface(vfs, shaderPath, deps.cache ?? new Map());
  // 1. An invisible collidable surface: drawn as nothing, kept for the colliders built from it.
  if (/invisible/i.test(d.effect ?? '')) return { path: shaderPath, invisible: true, alphaMode: 'BLEND', opacity: 0, hasAlpha: false };
  if (d.flip?.missing.length) log(`flip-book ${shaderPath}: base ${d.base ?? '(none)'}, ${d.flip.missing.length} of ${d.flip.frames} frames missing`);
  // A painted main stands in for the shader's own texture, never for a shader the archives lack. A
  // flip-book keeps its own frames: the bake is of one image, and painting frame 1 alone would flicker
  // between the painted and the plain (no retail paint shader is a flip-book).
  let painted = d.kind ? deps.mainImage?.(shaderPath) ?? null : null;
  if (painted && d.anim) {
    log(`paint ${shaderPath} is a flip-book: drawn with its own frames, unpainted`);
    painted = null;
  }
  // 2. No main texture: drawn untextured, as before.
  if (!painted && (!d.main || !vfs.has(d.main))) return null;
  const decode = (p) => deps.decodeDds(vfs.read(p));
  const png = (img) => deps.encodePng(img.width, img.height, img.rgba);
  const main = painted ? paintedImage(painted) : decode(d.main);
  const mainPath = painted ? painted.path : d.main;
  const pass = d.pass;
  // 3. alphaMode keeps its meaning: the effect's own reading (any implementation's first pass).
  const alphaMode = d.inline ? alphaModeFor({ alphaBlend: !!pass?.anyBlend, alphaTest: !!pass?.anyTest }) : deps.alphaFromEffect(d.effect, deps.byName(d.effect));
  const result = { path: mainPath, png: png(main), hasAlpha: main.hasAlpha, alphaMode };
  if (deps.glassNamed?.test(`${shaderPath} ${d.main}`)) result.glass = true;

  // 4. Additive: unlit, and opaque when the source factor is One or SrcColor (three's additive is SrcAlpha/One).
  const additive = !!pass?.additive;
  const opaqueAdd = additive && (pass.blendSrc === 1 || pass.blendSrc === 2);
  if (additive) {
    result.blend = 'add';
    result.unlit = true;
  }
  const em = d.emissive;
  // 5. Translucent: blending (InvSrcAlpha) and testing without depth writes, for the looks that need it.
  const looksTranslucent = !!(d.scroll || d.split || em?.kind === 'full' || d.anim);
  if (!additive && alphaMode === 'MASK' && pass?.alphaBlend && pass.alphaTest && !pass.zWrite && pass.blendDst === 5 && looksTranslucent) {
    result.translucent = true;
    if (d.alphaRef > 0) result.alphaTest = Math.round((d.alphaRef / 255) * 1e4) / 1e4;
  }
  // 6. Emissive: unlit screens; a masked glow split into a lit and a glowing image.
  if (em?.kind === 'full') result.unlit = true;
  let glow = null;
  if (em?.kind === 'mask' && !result.unlit) {
    const own = em.slot === (d.mainSlot ?? 'MAIN');
    const slotPath = own ? d.main : d.textures.find((t) => t.slot === em.slot)?.path;
    if (!slotPath || !vfs.has(slotPath)) log(`glow mask ${em.slot} of ${shaderPath} is not in the archives: drawn unglowing`);
    else glow = { own, channel: em.channel, path: slotPath, image: own ? null : decode(slotPath), keepAlpha: !(own && em.channel === 'a') };
  }
  // Each image (the main, then every flip-book frame) gets the same treatment.
  const frames = d.anim ? d.anim.frames.map((p, i) => (i === 0 ? { path: mainPath, image: main } : { path: p, image: decode(p) })) : [{ path: mainPath, image: main }];
  let masks = null;
  if (glow) {
    masks = frames.map((f) => {
      const fitted = fitRgba(f.image, GLOW_MAX);
      return { fitted, ...maskValues(fitted, glow.own ? fitted : glow.image, glow.channel) };
    });
    // A flip-book glows in every frame or in none, so no frame ever takes the glow map away.
    if (Math.max(...masks.map((x) => x.max)) < 8 / 255) masks = null;
  }
  // The main's alpha is a glow mask, not a gloss mask, only when it is split into a glow.
  Object.assign(result, deps.surfaceFor(d.effect, d.textures, main, alphaMode, { alphaIsEmissive: !!masks && !glow.keepAlpha }));
  const normalSlot = d.textures.find((s) => /^(CNRM|NRML|DOT3)$/.test(s.slot));
  const normal = normalSlot ? deps.normalFor(normalSlot.path) : null;
  if (normal) result.normal = normal;
  const treat = (f, i) => {
    const out = {};
    if (opaqueAdd || d.split) out.rgb = { path: `${f.path}#rgb`, png: png(rgbOnly(f.image)) };
    if (masks) {
      const { fitted, m } = masks[i];
      const { lit, emis } = splitGlow(fitted, m, glow.keepAlpha);
      const maskKey = `${glow.own ? f.path : glow.path}:${glow.channel}`;
      out.lit = { path: `${f.path}#lit:${maskKey}`, png: png(lit) };
      out.emissive = { path: `${f.path}#emis:${maskKey}`, png: png(emis) };
    }
    return out;
  };
  Object.assign(result, treat(frames[0], 0));
  // 7. Split alpha: an opaque colour image and the alpha as grey, each scrolled on its own.
  if (d.split) result.alphaImage = { path: `${mainPath}#alpha`, png: png(alphaAsGrey(main)) };
  // 8. Scroll, and no shadow for anything blended.
  if (d.scroll) result.scroll = { map: [...d.scroll.map], alpha: d.scroll.alpha ? [...d.scroll.alpha] : null };
  if (result.blend || result.translucent) result.noShadow = true;
  // 9. Flip-book frames.
  if (d.anim && frames.length > 1) {
    const list = [];
    let anyAlpha = main.hasAlpha;
    frames.forEach((f, i) => {
      if (i === 0) {
        list.push({ path: result.path, png: result.png, hasAlpha: main.hasAlpha, ...(result.rgb ? { rgb: result.rgb } : {}), ...(result.lit ? { lit: result.lit, emissive: result.emissive } : {}) });
        return;
      }
      if (f.image.hasAlpha) anyAlpha = true;
      list.push({ path: f.path, png: png(f.image), hasAlpha: !!f.image.hasAlpha, ...treat(f, i) });
    });
    result.hasAlpha = anyAlpha;
    result.anim = { mode: d.anim.mode, seconds: [...d.anim.seconds], frames: list };
  }
  if (deps.thumb) Object.defineProperty(result, 'thumb', { value: deps.thumb(main.width, main.height, main.rgba), enumerable: false, configurable: true, writable: true });
  return result;
}

// ---------------------------------------------------------------------------------------------
// Reports: the converter's log lines and diagnostics.

const num = (v) => String(Math.round(v * 1e4) / 1e4);
const seconds = (s) => (s[0] === s[1] ? `${num(s[0])} s each` : `${num(s[0])} to ${num(s[1])} s each`);
const MODE_WORDS = { time: '', random: ', each frame timed at random', pingpong: ', forward then back', frame: ', one per drawn frame', randomFrame: ', frames picked at random' };

/** One line on what a texture entry does beyond its picture, for `materials` and `shader`. */
export function surfaceLine(entry, described = null) {
  if (!entry) return described?.notes.length ? `untextured; ${described.notes.join('; ')}` : 'untextured';
  if (entry.invisible) return 'invisible (collision only)';
  const groups = [];
  const look = [];
  if (entry.blend === 'add') look.push('additive');
  if (entry.translucent) look.push('translucent');
  if (entry.alphaTest) look.push(`alpha test ${Math.round(entry.alphaTest * 255)}/255`);
  if ((entry.blend || entry.translucent) && described?.pass && !described.pass.zWrite) look.push('no depth write');
  if (entry.noShadow) look.push('no shadow');
  if (look.length) groups.push(look.join(', '));
  const motion = [];
  if (entry.anim) motion.push(`flip-book ${entry.anim.frames.length} frames, ${seconds(entry.anim.seconds)}${MODE_WORDS[entry.anim.mode] ?? ''}`);
  if (entry.scroll) motion.push(`scrolls colour (${entry.scroll.map.map(num).join(',')})/s${entry.scroll.alpha ? `, alpha (${entry.scroll.alpha.map(num).join(',')})/s` : ''}`);
  if (entry.alphaImage) motion.push('split alpha');
  if (motion.length) groups.push(motion.join(', '));
  if (entry.unlit) groups.push('unlit');
  if (entry.emissive) {
    const em = described?.emissive;
    groups.push(`glows by ${em?.kind === 'mask' ? `${em.slot}.${em.channel}` : 'a mask'} (lit and glow images)`);
  }
  if (!groups.length) groups.push('as painted');
  if (described?.notes.length) groups.push(described.notes.join('; '));
  return groups.join('; ');
}

/** What describeSurface found, line by line, for the `shader` command. */
export function describeLines(d) {
  const lines = [];
  const kinds = { SSHT: 'static shader', CSHD: 'customizable shader', SWTS: 'flip-book of textures', SWSH: 'flip-book of shaders', OPST: 'OPST shader' };
  lines.push(`surface: ${d.kind ? `${d.kind} (${kinds[d.kind] ?? 'unknown form'})` : 'not in the archives'}${d.base ? `, base ${d.base}` : ''}`);
  if (d.timing) {
    const frames = d.flip ? `${d.flip.frames - d.flip.missing.length} of ${d.flip.frames} frames present` : 'no frames';
    lines.push(`  timing: ${d.timing.mode}, ${d.timing.count} frames, ${seconds(d.timing.seconds)}; ${frames}${d.anim ? '' : ' (not animated)'}`);
    for (const m of d.flip?.missing ?? []) lines.push(`    missing ${m}`);
  }
  lines.push(`  effect: ${d.inline ? '(inline)' : d.effect ?? '(none)'}`);
  const p = d.pass;
  if (p) {
    lines.push(`  pass: version ${p.version}, z-write ${p.zWrite ? 'on' : 'off'}, blend ${p.alphaBlend ? `on (${p.blendSrc}/${p.blendDst}${p.blendOp ? `, operation ${p.blendOp}` : ''}${p.additive ? ', additive' : ''})` : 'off'}, alpha test ${p.alphaTest ? 'on' : 'off'}, reference ${p.alphaRefTag ?? '-'} = ${d.alphaRef}; any implementation blends ${p.anyBlend ? 'yes' : 'no'}, tests ${p.anyTest ? 'yes' : 'no'}`);
    lines.push(`  programs: vertex ${p.vertexProgram ?? '(fixed function)'}, pixel ${p.pixelProgram ?? '(fixed function)'}${Object.keys(p.samplers).length ? `, samplers ${Object.entries(p.samplers).map(([r, t]) => `s${r}=${t}`).join(' ')}` : ''}`);
  } else lines.push('  pass: none read');
  lines.push(`  scroll: ${d.scroll ? `colour (${d.scroll.map.map(num).join(',')})/s${d.scroll.alpha ? `, alpha (${d.scroll.alpha.map(num).join(',')})/s` : ''}` : 'none'}; split alpha ${d.split ? 'yes' : 'no'}`);
  const em = d.emissive;
  lines.push(`  emissive: ${!em ? 'none' : em.kind === 'mask' ? `mask ${em.slot}.${em.channel}` : em.kind === 'add' ? 'additive' : 'full (unlit)'}`);
  lines.push(`  main: ${d.main ?? '(none)'}${d.mainSlot ? ` (${d.mainSlot})` : ''}`);
  for (const n of d.notes) lines.push(`  note: ${n}`);
  return lines;
}

/** Counts over a pack's texture entries for the snapshot's `surfaces:` line. */
export function surfaceCounts(entries) {
  const c = { flipBooks: 0, scrolling: 0, unlit: 0, additive: 0, glowing: 0, glowBytes: 0 };
  const glow = new Map();
  for (const t of entries ?? []) {
    if (!t || t.invisible) continue;
    if (t.anim) c.flipBooks++;
    if (t.scroll) c.scrolling++;
    if (t.unlit && t.blend !== 'add') c.unlit++;
    if (t.blend === 'add') c.additive++;
    if (t.emissive) {
      c.glowing++;
      glow.set(t.emissive.path, t.emissive.png.length);
      for (const f of t.anim?.frames ?? []) if (f.emissive) glow.set(f.emissive.path, f.emissive.png.length);
    }
  }
  for (const n of glow.values()) c.glowBytes += n;
  return c;
}

export function surfaceCountsLine(c) {
  return `surfaces: ${c.flipBooks} flip-books, ${c.scrolling} scrolling, ${c.unlit} unlit, ${c.additive} additive, ${c.glowing} glowing (${(c.glowBytes / 1e6).toFixed(1)} MB of glow images)`;
}
