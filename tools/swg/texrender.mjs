// Texture renderer blueprints (.trt): how the game bakes a character's skin, hair and eye textures
// at run time from base textures, overlays and palette colours. A blueprint is a tiny render
// pipeline: shaders (with textures and texture factors chosen by customization variables),
// vertex and index buffers in texture space, and a list of draw commands run through a parallel
// projection into the destination texture. This module reads the blueprint and runs it in
// software, so a converted character carries its finished skin instead of a grey placeholder.
//
// Ported from BlueprintTextureRendererTemplate, StaticShaderTemplate, ShaderImplementation,
// VertexBuffer and PaletteArgb loaders. Fixed-function texture stages follow Direct3D 8 semantics.
import { childOf, childrenOf, isForm, parseIff } from './iff.mjs';
import { decodeDds } from './dds.mjs';
import { decodeTga } from './tga.mjs';
import { R, tagString } from './skeletal.mjs';

const WHITE = 0xffffffff;

// ---------------------------------------------------------------------------------------------
// Palettes: Microsoft RIFF PAL files, entries stored r, g, b, flags.
export function parsePalette(buf) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'PAL ' || buf.toString('latin1', 12, 16) !== 'data') {
    throw new Error('not a RIFF palette');
  }
  const version = buf[21];
  const count = buf.readUInt16LE(22);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const o = 24 + i * 4;
    entries.push([buf[o], buf[o + 1], buf[o + 2], version === 4 ? buf[o + 3] : 255]);
  }
  return entries;
}

const argb = (r, g, b, a) => (((a & 255) << 24) | ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)) >>> 0;
const argbToRgba = (v) => [((v >>> 16) & 255) / 255, ((v >>> 8) & 255) / 255, (v & 255) / 255, ((v >>> 24) & 255) / 255];

// ---------------------------------------------------------------------------------------------
// Images: any texture file the game ships, as 8-bit RGBA rows top to bottom.
export function loadImage(vfs, path, cache = new Map()) {
  const key = path.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  let img = null;
  if (vfs.has(path)) {
    const buf = vfs.read(path);
    if (/\.dds$/i.test(path)) {
      const d = decodeDds(buf);
      img = { width: d.width, height: d.height, rgba: d.rgba };
    } else if (/\.tga$/i.test(path)) {
      const t = decodeTga(buf);
      const rgba = new Uint8Array(t.width * t.height * 4);
      const px = t.pixels;
      const ch = px.length / (t.width * t.height);
      for (let i = 0; i < t.width * t.height; i++) {
        if (ch >= 3) {
          rgba[i * 4] = px[i * ch];
          rgba[i * 4 + 1] = px[i * ch + 1];
          rgba[i * 4 + 2] = px[i * ch + 2];
          rgba[i * 4 + 3] = ch >= 4 ? px[i * ch + 3] : 255;
        } else {
          rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = px[i * ch];
          rgba[i * 4 + 3] = ch === 2 ? px[i * ch + 1] : 255;
        }
      }
      img = { width: t.width, height: t.height, rgba };
    }
  }
  cache.set(key, img);
  return img;
}

// Texture addressing (TextureAddress enum): wrap, mirror, clamp, border, mirrorOnce.
function wrapCoord(t, n, mode) {
  if (mode === 2 || mode === 3) return Math.min(n - 1, Math.max(0, t));
  if (mode === 1 || mode === 4) {
    const period = 2 * n;
    let m = ((t % period) + period) % period;
    if (m >= n) m = period - 1 - m;
    return m;
  }
  return ((t % n) + n) % n;
}

/** Bilinear sample, texel centres at half-integers, into out[0..3] (0..1 floats). */
function sample(img, u, v, addrU, addrV, out) {
  const { width: w, height: h, rgba } = img;
  const x = u * w - 0.5;
  const y = v * h - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const xa = wrapCoord(x0, w, addrU);
  const xb = wrapCoord(x0 + 1, w, addrU);
  const ya = wrapCoord(y0, h, addrV);
  const yb = wrapCoord(y0 + 1, h, addrV);
  const i00 = (ya * w + xa) * 4;
  const i10 = (ya * w + xb) * 4;
  const i01 = (yb * w + xa) * 4;
  const i11 = (yb * w + xb) * 4;
  for (let c = 0; c < 4; c++) {
    const top = rgba[i00 + c] * (1 - fx) + rgba[i10 + c] * fx;
    const bottom = rgba[i01 + c] * (1 - fx) + rgba[i11 + c] * fx;
    out[c] = (top * (1 - fy) + bottom * fy) / 255;
  }
}

// ---------------------------------------------------------------------------------------------
// Vertex buffers (FORM VTXA).
function parseVertexBuffer(root) {
  if (!isForm(root) || root.type !== 'VTXA') throw new Error(`expected VTXA, got ${root.type ?? root.tag}`);
  const v = root.children.find(isForm);
  const version = Number.parseInt(v.type, 10);
  const info = new R(childOf(v, 'INFO').data);
  let flags;
  let count;
  let legacyUvSets = 0;
  if (version === 1) {
    count = info.i32();
    legacyUvSets = info.i32();
    flags = info.u32();
  } else {
    flags = info.u32();
    count = info.i32();
  }
  const hasPosition = (flags & 1) !== 0;
  const transformed = (flags & 2) !== 0;
  const hasNormal = (flags & 4) !== 0;
  const hasColor0 = (flags & 8) !== 0;
  const hasColor1 = (flags & 16) !== 0;
  const hasPointSize = (flags & 32) !== 0 && version >= 3;
  const uvSets = version === 1 ? legacyUvSets : (flags >>> 8) & 15;
  const dims = [];
  for (let i = 0; i < uvSets; i++) dims.push(version === 1 ? 2 : ((flags >>> (12 + 2 * i)) & 3) + 1);
  const r = new R(childOf(v, 'DATA').data);
  const vertices = [];
  for (let i = 0; i < count; i++) {
    const vert = { x: 0, y: 0, z: 0, color: WHITE, uv: [] };
    if (hasPosition) {
      vert.x = r.f32();
      vert.y = r.f32();
      vert.z = r.f32();
    }
    if (transformed) r.f32();
    if (hasNormal) r.vec();
    if (hasPointSize) r.f32();
    if (hasColor0) {
      if (version === 1) {
        const a = r.f32(), cr = r.f32(), g = r.f32(), b = r.f32();
        vert.color = argb(cr * 255, g * 255, b * 255, a * 255);
      } else vert.color = r.u32();
    }
    if (hasColor1) r.u32();
    for (let s = 0; s < uvSets; s++) {
      const set = [];
      for (let k = 0; k < dims[s]; k++) set.push(r.f32());
      vert.uv.push(set);
    }
    vertices.push(vert);
  }
  return vertices;
}

// ---------------------------------------------------------------------------------------------
// Shader effects (.eff): implementations of fixed-function passes and their texture stages.
function parsePassData(version, r) {
  const p = { stages: 0, alphaBlend: false, blendOp: 0, blendSrc: 1, blendDst: 0, alphaTest: false, alphaRefTag: null, alphaFunc: 7, writeMask: 15, tfactorTag: null, tfactorTag2: null, pixelShader: false };
  if (version === 0) {
    p.stages = r.i8(); r.i8(); r.u8(); r.u8(); r.u8(); r.i8();
  } else if (version === 1) {
    p.stages = r.i8(); r.u32(); r.i8(); r.u8(); r.u8(); r.u8(); r.i8();
  } else if (version <= 4) {
    p.pixelShader = r.u8() !== 0; p.stages = r.i8(); r.i8(); r.i8(); r.u8(); r.u8(); r.u8(); r.i8();
  } else {
    p.stages = r.i8(); r.i8(); r.i8(); r.u8();
    if (version >= 10) r.u8(); // heat
    r.u8(); r.u8(); r.i8();
  }
  p.alphaBlend = r.u8() !== 0;
  p.blendOp = r.i8();
  p.blendSrc = r.i8();
  p.blendDst = r.i8();
  p.alphaTest = r.u8() !== 0;
  p.alphaRefTag = tagString(r.u32());
  p.alphaFunc = r.i8();
  p.writeMask = r.u8();
  p.tfactorTag = tagString(r.u32());
  if (version >= 7) p.tfactorTag2 = tagString(r.u32());
  return p;
}

function parseStage(form) {
  const chunk = form.children.find((c) => !isForm(c));
  const r = new R(chunk.data);
  const version = Number.parseInt(chunk.tag, 10);
  const s = {};
  s.colorOp = r.u8();
  s.colorArgs = [];
  for (let i = 0; i < 3; i++) s.colorArgs.push({ arg: r.u8(), complement: r.u8() !== 0, alphaReplicate: r.u8() !== 0 });
  s.alphaOp = r.u8();
  s.alphaArgs = [];
  for (let i = 0; i < 3; i++) s.alphaArgs.push({ arg: r.u8(), complement: r.u8() !== 0, alphaReplicate: false });
  s.result = r.u8();
  s.textureTag = tagString(r.u32());
  s.coordSetTag = tagString(r.u32());
  if (version === 0) {
    s.addressU = r.u8();
    s.addressV = r.u8();
    r.u8(); r.u8(); r.u8(); r.u8();
  }
  s.coordGen = r.u8();
  return s;
}

function parseImplementation(form) {
  const v = form.children.find(isForm);
  const passes = [];
  for (const pass of childrenOf(v, 'PASS')) {
    const pv = pass.children.find(isForm);
    const version = Number.parseInt(pv.type, 10);
    const data = childOf(pv, 'DATA');
    const p = parsePassData(version, new R(data.data));
    p.vertexShader = !!childOf(pv, 'PVSH');
    p.pixelShader = p.pixelShader || !!childOf(pv, 'PPSH');
    p.stageList = childrenOf(pv, 'STAG').map(parseStage);
    passes.push(p);
  }
  return { passes, fixedFunction: passes.every((p) => !p.pixelShader && !p.vertexShader && p.stageList.length > 0) };
}

/** An effect form's fixed-function implementation (the one a texture bake can emulate), or null. */
export function parseEffect(vfs, root, label = '(inline effect)') {
  if (!isForm(root) || root.type !== 'EFCT') throw new Error(`expected EFCT, got ${root.type ?? root.tag}`);
  const v = root.children.find(isForm);
  const impls = [];
  for (const c of v.children) {
    if (isForm(c) && c.type === 'IMPL') impls.push(parseImplementation(c));
    else if (!isForm(c) && c.tag === 'NAME') {
      const file = new R(c.data).str().replace(/\\/g, '/');
      if (vfs.has(file)) impls.push(parseImplementation(parseIff(vfs.read(file))));
    }
  }
  const result = impls.find((i) => i.fixedFunction) ?? null;
  if (result) result.file = label;
  return result;
}

/** The effect file's fixed-function implementation, cached by path. */
export function loadEffect(vfs, path, cache = new Map()) {
  const key = path.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const result = vfs.has(path) ? parseEffect(vfs, parseIff(vfs.read(path)), path) : null;
  cache.set(key, result);
  return result;
}

// ---------------------------------------------------------------------------------------------
// Static shaders (.sht): FORM SSHT, or FORM CSHD wrapping one with customization defaults.
function parseStaticShader(form, vfs, ctx) {
  const v = form.children.find(isForm);
  const shader = { textures: new Map(), addresses: new Map(), tfactors: new Map(), coordSets: new Map(), alphaRefs: new Map(), effect: null, effectFile: null, textureFiles: new Map() };
  // The effect comes first: by file name, or written inline (blueprint shaders do this).
  const name = childOf(v, 'NAME');
  const inlineEffect = childOf(v, 'EFCT');
  if (name) shader.effectFile = new R(name.data).str().replace(/\\/g, '/');
  else if (inlineEffect) {
    shader.effectFile = '(inline effect)';
    shader.effect = parseEffect(vfs, inlineEffect);
  }
  const txms = childOf(v, 'TXMS');
  if (txms) {
    for (const txm of childrenOf(txms, 'TXM ')) {
      const tv = txm.children.find(isForm);
      const r = new R(childOf(tv, 'DATA').data);
      let tag;
      let placeholder;
      let addressU = 0;
      let addressV = 0;
      if (tv.type === '0000') {
        placeholder = r.u8() !== 0;
        tag = tagString(r.u32());
      } else {
        tag = tagString(r.u32());
        placeholder = r.u8() !== 0;
        addressU = r.u8();
        addressV = r.u8();
      }
      shader.addresses.set(tag, [addressU, addressV]);
      const n = childOf(tv, 'NAME');
      if (!placeholder && n) {
        const file = new R(n.data).str().replace(/\\/g, '/');
        shader.textureFiles.set(tag, file);
        shader.textures.set(tag, loadImage(vfs, file, ctx.images));
      }
    }
  }
  const tcss = childOf(v, 'TCSS');
  if (tcss) {
    const r = new R(childOf(tcss, '0000').data);
    while (r.remaining >= 5) shader.coordSets.set(tagString(r.u32()), r.u8());
  }
  const tfns = childOf(v, 'TFNS');
  if (tfns) {
    const r = new R(childOf(tfns, '0000').data);
    while (r.remaining >= 8) shader.tfactors.set(tagString(r.u32()), r.u32());
  }
  const arvs = childOf(v, 'ARVS');
  if (arvs) {
    const r = new R(childOf(arvs, '0000').data);
    while (r.remaining >= 5) shader.alphaRefs.set(tagString(r.u32()), r.u8());
  }
  if (shader.effectFile && !inlineEffect) shader.effect = loadEffect(vfs, shader.effectFile, ctx.effects);
  return shader;
}

function paletteColor(vfs, file, index, ctx) {
  const key = file.toLowerCase();
  if (!ctx.palettes.has(key)) ctx.palettes.set(key, vfs.has(file) ? parsePalette(vfs.read(file)) : null);
  const pal = ctx.palettes.get(key);
  if (!pal || !pal.length) return WHITE;
  const e = pal[Math.min(Math.max(index, 0), pal.length - 1)];
  return argb(e[0], e[1], e[2], e[3]);
}

/**
 * A shader with its customization defaults applied, from an inline form or a file. Values for
 * named customization variables (palette indices, texture choices) come from ctx.values.
 */
export function loadShader(vfs, source, ctx) {
  let form = source;
  let file = null;
  if (typeof source === 'string') {
    file = source.replace(/\\/g, '/');
    const key = file.toLowerCase();
    if (ctx.shaders.has(key)) return ctx.shaders.get(key);
    form = vfs.has(file) ? parseIff(vfs.read(file)) : null;
  }
  let shader = null;
  if (form && isForm(form) && form.type === 'SSHT') shader = parseStaticShader(form, vfs, ctx);
  else if (form && isForm(form) && form.type === 'CSHD') {
    const v = form.children.find(isForm);
    const base = v.children.find((c) => isForm(c) ? c.type === 'SSHT' || c.type === 'CSHD' : c.tag === 'NAME');
    shader = base ? loadShader(vfs, isForm(base) ? base : new R(base.data).str(), ctx) : null;
    if (shader) {
      shader = { ...shader, textures: new Map(shader.textures), tfactors: new Map(shader.tfactors), textureFiles: new Map(shader.textureFiles), variables: [] };
      const txtr = childOf(v, 'TXTR');
      if (txtr) {
        const r = new R(childOf(txtr, 'DATA').data);
        const count = r.i16();
        const files = [];
        for (let i = 0; i < count; i++) files.push(r.str().replace(/\\/g, '/'));
        const cust = childOf(txtr, 'CUST');
        for (const op of cust ? childrenOf(cust, 'TX1D') : []) {
          const o = new R(op.data);
          const tag = tagString(o.u32());
          const baseIndex = o.i16();
          const n = o.i16();
          const variable = o.str();
          const isPrivate = o.u8() !== 0;
          const def = o.i16();
          const value = variableValue(ctx, variable, isPrivate, def);
          shader.variables.push({ name: variable, kind: 'int', min: 0, max: n, default: def, private: isPrivate });
          const chosen = files[baseIndex + Math.min(Math.max(value, 0), n - 1)];
          if (chosen) {
            shader.textureFiles.set(tag, chosen);
            shader.textures.set(tag, loadImage(vfs, chosen, ctx.images));
          }
        }
      }
      const tfac = childOf(v, 'TFAC');
      for (const op of tfac ? childrenOf(tfac, 'PAL ') : []) {
        const o = new R(op.data);
        const variable = o.str();
        const isPrivate = o.u8() !== 0;
        const tag = tagString(o.u32());
        const palette = o.str().replace(/\\/g, '/');
        const def = o.i32();
        const value = variableValue(ctx, variable, isPrivate, def);
        shader.variables.push({ name: variable, kind: 'palette', palette, default: def, private: isPrivate });
        shader.tfactors.set(tag, paletteColor(vfs, palette, value, ctx));
      }
    }
  }
  if (file) ctx.shaders.set(file.toLowerCase(), shader);
  return shader;
}

function variableValue(ctx, name, isPrivate, def) {
  const values = ctx.values ?? new Map();
  const short = name.replace(/^.*\//, '');
  for (const key of [name, short]) if (values.has(key)) return values.get(key);
  return def;
}

/** Fresh loader state: caches plus the customization values to apply. */
export function renderContext(values = new Map()) {
  return { images: new Map(), effects: new Map(), shaders: new Map(), palettes: new Map(), values };
}

// ---------------------------------------------------------------------------------------------
// Blueprints (FORM BTRT).
export function parseBlueprint(root) {
  if (!isForm(root) || root.type !== 'BTRT') throw new Error(`expected BTRT, got ${root.type ?? root.tag}`);
  const v = root.children.find(isForm);
  const version = Number.parseInt(v.type, 10);
  const dest = new R(childOf(v, 'DEST').data);
  const bp = { version, width: dest.i32(), height: dest.i32(), shaders: [], textures: [], vertexBuffers: [], indexBuffers: [], camera: 1, commands: [], prepare: [], variables: [] };
  const shtm = childOf(v, 'SHTM');
  for (const c of shtm.children) {
    if (isForm(c)) bp.shaders.push({ inline: c });
    else if (c.tag === 'NAME') bp.shaders.push({ file: new R(c.data).str().replace(/\\/g, '/') });
  }
  {
    const r = new R(childOf(childOf(v, 'TXTS'), 'INFO').data);
    const n = r.i32();
    for (let i = 0; i < n; i++) bp.textures.push(r.str().replace(/\\/g, '/'));
  }
  for (const vb of childrenOf(childOf(v, 'VBS '), 'VTXA')) bp.vertexBuffers.push(parseVertexBuffer(vb));
  for (const ib of childrenOf(childOf(v, 'IBS '), 'IDAT')) {
    const r = new R(ib.data);
    const n = r.i32();
    const idx = new Uint16Array(n);
    for (let i = 0; i < n; i++) idx[i] = r.u16();
    bp.indexBuffers.push(idx);
  }
  const cam = childOf(v, 'CAM ');
  const pcam = cam && childOf(cam, 'PCAM');
  if (!pcam) throw new Error('blueprint: only parallel projection cameras are supported');
  bp.camera = new R(pcam.data).f32();
  for (const c of childOf(v, 'RCMS').children) {
    if (!isForm(c) && c.tag === 'CFBC') {
      const r = new R(c.data);
      const clearColor = r.i32() !== 0;
      const color = r.u32();
      bp.commands.push({ kind: 'clear', clearColor, color });
    } else if (isForm(c) && c.type === 'SRSC') {
      const info = new R(childOf(c, 'INFO').data);
      const cmd = { kind: 'draw', shader: info.i32(), primitives: [] };
      for (const p of c.children) {
        if (isForm(p)) continue;
        const r = new R(p.data);
        if (p.tag === 'RTLI') cmd.primitives.push({ kind: 'list', vb: r.i32(), ib: r.i32(), minIndex: r.i32(), vertexCount: r.i32(), start: r.i32(), triangles: r.i32() });
        else if (p.tag === 'RTFC') cmd.primitives.push({ kind: 'fan', vb: r.i32() });
      }
      bp.commands.push(cmd);
    }
  }
  const submit = (name, isPrivate, kind, extra) => {
    let i = bp.variables.findIndex((x) => x.name === name && x.private === isPrivate);
    if (i < 0) {
      bp.variables.push({ name, private: isPrivate, kind, ...extra });
      i = bp.variables.length - 1;
    }
    return i;
  };
  const parseOps = (form) => {
    const ops = [];
    for (const c of form.children) {
      if (isForm(c)) continue;
      const r = new R(c.data);
      switch (c.tag) {
        case 'INFO':
        case 'NOP ':
          break;
        case 'SSTC':
          ops.push({ kind: 'texture', shader: r.i32(), tag: tagString(r.u32()), texture: r.i32() });
          break;
        case 'SST1': {
          const shader = r.i32(), tag = tagString(r.u32()), base = r.i32(), name = r.str(), n = r.i32();
          ops.push({ kind: 'texture1d', shader, tag, base, count: n, variable: submit(name, false, 'int', { min: 0, max: n, default: 0 }) });
          break;
        }
        case 'SST2': {
          const shader = r.i32(), tag = tagString(r.u32()), base = r.i32();
          const name0 = r.str(), n0 = r.i32(), name1 = r.str(), n1 = r.i32();
          ops.push({ kind: 'texture2d', shader, tag, base, count0: n0, count1: n1, variable0: submit(name0, false, 'int', { min: 0, max: n0, default: 0 }), variable1: submit(name1, false, 'int', { min: 0, max: n1, default: 0 }) });
          break;
        }
        case 'STF ': {
          const shader = r.i32(), tag = tagString(r.u32()), name = r.str();
          ops.push({ kind: 'tfactor', shader, tag, variable: submit(name, false, 'int', { min: -2147483648, max: 2147483647, default: 0 }) });
          break;
        }
        case 'STFA': {
          const shader = r.i32(), tag = tagString(r.u32()), cr = r.u8(), g = r.u8(), b = r.u8(), name = r.str();
          ops.push({ kind: 'tfactorAlpha', shader, tag, rgb: [cr, g, b], variable: submit(name, false, 'int', { min: 0, max: 256, default: 0 }) });
          break;
        }
        case 'STFP': {
          const shader = r.i16(), tag = tagString(r.u32()), palette = r.str().replace(/\\/g, '/'), name = r.str(), isPrivate = r.u8() !== 0;
          ops.push({ kind: 'palette', shader, tag, palette, variable: submit(name, isPrivate, 'palette', { palette, default: 0 }) });
          break;
        }
        default:
          throw new Error(`blueprint: unsupported prepare operation ${c.tag}`);
      }
    }
    return ops;
  };
  for (const pcmd of childrenOf(childOf(v, 'PCMS'), 'PCMD')) {
    // Conditions still in the data are always true (CVTP is deprecated and reads as true).
    const cond = childOf(pcmd, 'COND');
    const falseAlways = cond && cond.children.some((c) => !isForm(c) && c.tag === 'FALS');
    const tops = childOf(pcmd, 'TOPS');
    const fops = childOf(pcmd, 'FOPS');
    const chosen = falseAlways ? fops : tops;
    if (chosen) bp.prepare.push(...parseOps(chosen));
  }
  return bp;
}

// ---------------------------------------------------------------------------------------------
// Fixed-function pixel pipeline.
const c4 = () => [0, 0, 0, 0];

function argValue(arg, complement, alphaReplicate, regs, out) {
  const src = arg === 0 ? regs.current : arg === 1 ? regs.diffuse : arg === 2 ? regs.specular : arg === 3 ? regs.temp : arg === 4 ? regs.texture : regs.tfactor;
  for (let i = 0; i < 4; i++) out[i] = alphaReplicate ? src[3] : src[i];
  if (complement) for (let i = 0; i < 4; i++) out[i] = 1 - out[i];
  return out;
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** One texture-stage operation on channels [from, to). */
function stageOp(op, a1, a2, a0, regs, stage, out, from, to) {
  for (let i = from; i < to; i++) {
    let v;
    switch (op) {
      case 1: v = a1[i]; break;
      case 2: v = a2[i]; break;
      case 3: v = a1[i] * a2[i]; break;
      case 4: v = a1[i] * a2[i] * 2; break;
      case 5: v = a1[i] * a2[i] * 4; break;
      case 6: v = a1[i] + a2[i]; break;
      case 7: v = a1[i] + a2[i] - 0.5; break;
      case 8: v = (a1[i] + a2[i] - 0.5) * 2; break;
      case 9: v = a1[i] - a2[i]; break;
      case 10: v = a1[i] + a2[i] - a1[i] * a2[i]; break;
      case 11: v = a1[i] * regs.diffuse[3] + a2[i] * (1 - regs.diffuse[3]); break;
      case 12: v = a1[i] * regs.texture[3] + a2[i] * (1 - regs.texture[3]); break;
      case 13: v = a1[i] * regs.tfactor[3] + a2[i] * (1 - regs.tfactor[3]); break;
      case 14: v = a1[i] + a2[i] * (1 - regs.texture[3]); break;
      case 15: v = a1[i] * regs.current[3] + a2[i] * (1 - regs.current[3]); break;
      case 16: v = a1[i]; break;
      case 17: v = a1[i] + a1[3] * a2[i]; break;
      case 18: v = a1[i] * a2[i] + a1[3]; break;
      case 19: v = (1 - a1[3]) * a2[i] + a1[i]; break;
      case 20: v = (1 - a1[i]) * a2[i] + a1[3]; break;
      case 23: {
        const d = (a1[0] - 0.5) * (a2[0] - 0.5) + (a1[1] - 0.5) * (a2[1] - 0.5) + (a1[2] - 0.5) * (a2[2] - 0.5);
        v = d * 4;
        break;
      }
      case 24: v = a0[i] + a1[i] * a2[i]; break;
      case 25: v = a0[i] * a1[i] + (1 - a0[i]) * a2[i]; break;
      default: v = a1[i];
    }
    out[i] = clamp01(v);
  }
}

const BLEND = (mode, src, dst) => {
  switch (mode) {
    case 0: return [0, 0, 0, 0];
    case 1: return [1, 1, 1, 1];
    case 2: return src;
    case 3: return src.map((x) => 1 - x);
    case 4: return [src[3], src[3], src[3], src[3]];
    case 5: return [1 - src[3], 1 - src[3], 1 - src[3], 1 - src[3]];
    case 6: return [dst[3], dst[3], dst[3], dst[3]];
    case 7: return [1 - dst[3], 1 - dst[3], 1 - dst[3], 1 - dst[3]];
    case 8: return dst;
    case 9: return dst.map((x) => 1 - x);
    case 10: { const f = Math.min(src[3], 1 - dst[3]); return [f, f, f, 1]; }
    default: return [1, 1, 1, 1];
  }
};

const compare = (fn, a, b) => {
  switch (fn) {
    case 0: return false;
    case 1: return a < b;
    case 2: return a === b;
    case 3: return a <= b;
    case 4: return a > b;
    case 5: return a >= b;
    case 6: return a !== b;
    default: return true;
  }
};

/** Runs a pass's stages for one fragment. uvs: per coordinate set [u, v]; diffuse: [r,g,b,a]. */
function shadeFragment(shader, pass, uvs, diffuse, out) {
  const regs = { current: diffuse.slice(), diffuse, specular: [0, 0, 0, 1], temp: c4(), texture: c4(), tfactor: c4() };
  const tf = shader.tfactors.get(pass.tfactorTag);
  regs.tfactor = argbToRgba(tf === undefined ? WHITE : tf);
  const a1 = c4(), a2 = c4(), a0 = c4(), res = c4();
  for (const stage of pass.stageList) {
    if (stage.colorOp === 0) break;
    const tex = shader.textures.get(stage.textureTag);
    if (tex) {
      const set = shader.coordSets.get(stage.coordSetTag) ?? 0;
      const uv = uvs[set] ?? uvs[0] ?? [0, 0];
      const addr = stage.addressU !== undefined ? [stage.addressU, stage.addressV] : shader.addresses.get(stage.textureTag) ?? [0, 0];
      sample(tex, uv[0], uv[1], addr[0], addr[1], regs.texture);
    } else regs.texture[0] = regs.texture[1] = regs.texture[2] = regs.texture[3] = 1;
    const ca = stage.colorArgs;
    argValue(ca[0].arg, ca[0].complement, ca[0].alphaReplicate, regs, a1);
    argValue(ca[1].arg, ca[1].complement, ca[1].alphaReplicate, regs, a2);
    argValue(ca[2].arg, ca[2].complement, ca[2].alphaReplicate, regs, a0);
    stageOp(stage.colorOp, a1, a2, a0, regs, stage, res, 0, 3);
    if (stage.alphaOp === 0) res[3] = regs.current[3];
    else {
      const aa = stage.alphaArgs;
      argValue(aa[0].arg, aa[0].complement, false, regs, a1);
      argValue(aa[1].arg, aa[1].complement, false, regs, a2);
      argValue(aa[2].arg, aa[2].complement, false, regs, a0);
      stageOp(stage.alphaOp, a1, a2, a0, regs, stage, res, 3, 4);
    }
    const target = stage.result === 3 ? regs.temp : regs.current;
    for (let i = 0; i < 4; i++) target[i] = res[i];
  }
  for (let i = 0; i < 4; i++) out[i] = regs.current[i];
}

/** Writes a shaded fragment into the RGBA float framebuffer with the pass's blend state. */
function writeFragment(fb, index, src, pass, shader) {
  if (pass.alphaTest) {
    const ref = (shader.alphaRefs.get(pass.alphaRefTag) ?? 0) / 255;
    if (!compare(pass.alphaFunc, src[3], ref)) return;
  }
  const dst = [fb[index], fb[index + 1], fb[index + 2], fb[index + 3]];
  let result = src;
  if (pass.alphaBlend) {
    const fs = BLEND(pass.blendSrc, src, dst);
    const fd = BLEND(pass.blendDst, src, dst);
    result = c4();
    for (let i = 0; i < 4; i++) {
      const s = src[i] * fs[i];
      const d = dst[i] * fd[i];
      switch (pass.blendOp) {
        case 1: result[i] = s - d; break;
        case 2: result[i] = d - s; break;
        case 3: result[i] = Math.min(s, d); break;
        case 4: result[i] = Math.max(s, d); break;
        default: result[i] = s + d;
      }
      result[i] = clamp01(result[i]);
    }
  }
  const mask = pass.writeMask || 15;
  if (mask & 1) fb[index] = result[0];
  if (mask & 2) fb[index + 1] = result[1];
  if (mask & 4) fb[index + 2] = result[2];
  if (mask & 8) fb[index + 3] = result[3];
}

/** Rasterises one screen-space triangle (x, y in pixels, y down) with interpolated uv sets and colour. */
function drawTriangle(fb, width, height, va, vb, vc, shader, pass, scale) {
  const ax = va.x * scale.x, ay = va.y * scale.y;
  const bx = vb.x * scale.x, by = vb.y * scale.y;
  const cx = vc.x * scale.x, cy = vc.y * scale.y;
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 1e-12) return;
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
  const sets = Math.max(va.uv.length, 1);
  const uvs = [];
  for (let s = 0; s < sets; s++) uvs.push([0, 0]);
  const diffuse = c4();
  const src = c4();
  const ca = argbToRgba(va.color), cb = argbToRgba(vb.color), cc = argbToRgba(vc.color);
  const inv = 1 / area;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      let w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * inv;
      let w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * inv;
      let w2 = 1 - w0 - w1;
      const eps = -1e-6;
      if (w0 < eps || w1 < eps || w2 < eps) continue;
      for (let s = 0; s < sets; s++) {
        const ua = va.uv[s] ?? [0, 0], ub = vb.uv[s] ?? [0, 0], uc = vc.uv[s] ?? [0, 0];
        uvs[s][0] = ua[0] * w0 + ub[0] * w1 + uc[0] * w2;
        uvs[s][1] = (ua[1] ?? 0) * w0 + (ub[1] ?? 0) * w1 + (uc[1] ?? 0) * w2;
      }
      for (let i = 0; i < 4; i++) diffuse[i] = ca[i] * w0 + cb[i] * w1 + cc[i] * w2;
      shadeFragment(shader, pass, uvs, diffuse, src);
      writeFragment(fb, (y * width + x) * 4, src, pass, shader);
    }
  }
}

/** Runs the blueprint's prepare operations: textures and texture factors chosen by the variables. */
function applyPrepare(vfs, bp, ctx, shaders, missing) {
  const valueOf = (i) => {
    const v = bp.variables[i];
    const short = v.name.replace(/^.*\//, '');
    for (const key of [v.name, short]) if (ctx.values.has(key)) return ctx.values.get(key);
    return v.default;
  };
  const setTexture = (shader, tag, index) => {
    const file = bp.textures[index];
    const img = file ? loadImage(vfs, file, ctx.images) : null;
    if (img) shader.textures.set(tag, img);
    else {
      shader.textures.delete(tag);
      missing.add(file ?? `texture #${index}`);
    }
    shader.textureFiles.set(tag, file);
  };
  for (const op of bp.prepare) {
    const shader = shaders[op.shader];
    if (!shader) continue;
    switch (op.kind) {
      case 'texture': setTexture(shader, op.tag, op.texture); break;
      case 'texture1d': setTexture(shader, op.tag, op.base + Math.min(Math.max(valueOf(op.variable), 0), op.count - 1)); break;
      case 'texture2d': {
        const a = Math.min(Math.max(valueOf(op.variable0), 0), op.count0 - 1);
        const b = Math.min(Math.max(valueOf(op.variable1), 0), op.count1 - 1);
        setTexture(shader, op.tag, op.base + a * op.count1 + b);
        break;
      }
      case 'tfactor': shader.tfactors.set(op.tag, valueOf(op.variable) >>> 0); break;
      case 'tfactorAlpha': shader.tfactors.set(op.tag, argb(op.rgb[0], op.rgb[1], op.rgb[2], valueOf(op.variable))); break;
      case 'palette': shader.tfactors.set(op.tag, paletteColor(vfs, op.palette, valueOf(op.variable), ctx)); break;
    }
  }
}

/**
 * Runs a blueprint: prepares its shaders from the customization values in ctx, then executes the
 * draw commands into an RGBA image of the blueprint's preferred size.
 */
export function renderBlueprint(vfs, bp, ctx = renderContext()) {
  const shaders = bp.shaders.map((s) => {
    const sh = loadShader(vfs, s.inline ?? s.file, ctx);
    if (!sh) throw new Error(`blueprint: shader ${s.file ?? '(inline)'} not found`);
    // Blueprint textures replace the template's copies; work on a private set.
    return { ...sh, textures: new Map(sh.textures), tfactors: new Map(sh.tfactors), textureFiles: new Map(sh.textureFiles) };
  });
  const missing = new Set();
  applyPrepare(vfs, bp, ctx, shaders, missing);
  const { width, height } = bp;
  const fb = new Float32Array(width * height * 4);
  const scale = { x: width / bp.camera, y: height / bp.camera };
  const unsupported = [];
  for (const cmd of bp.commands) {
    if (cmd.kind === 'clear') {
      if (!cmd.clearColor) continue;
      const c = argbToRgba(cmd.color);
      for (let i = 0; i < fb.length; i += 4) {
        fb[i] = c[0]; fb[i + 1] = c[1]; fb[i + 2] = c[2]; fb[i + 3] = c[3];
      }
      continue;
    }
    const shader = shaders[cmd.shader];
    if (!shader || !shader.effect) {
      unsupported.push(shader ? `${shader.effectFile ?? 'no effect'} (shader #${cmd.shader}: ${[...shader.textureFiles.values()].join(', ') || 'no textures'})` : `shader #${cmd.shader}`);
      continue;
    }
    for (const pass of shader.effect.passes) {
      for (const prim of cmd.primitives) {
        const vb = bp.vertexBuffers[prim.vb];
        if (!vb) continue;
        if (prim.kind === 'fan') {
          for (let i = 1; i + 1 < vb.length; i++) drawTriangle(fb, width, height, vb[0], vb[i], vb[i + 1], shader, pass, scale);
        } else {
          const ib = bp.indexBuffers[prim.ib];
          if (!ib) continue;
          for (let t = 0; t < prim.triangles; t++) {
            const o = prim.start + t * 3;
            drawTriangle(fb, width, height, vb[ib[o]], vb[ib[o + 1]], vb[ib[o + 2]], shader, pass, scale);
          }
        }
      }
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < fb.length; i++) rgba[i] = Math.round(clamp01(fb[i]) * 255);
  return { width, height, rgba, missing: [...missing], unsupported };
}

/**
 * Bakes a mesh shader to one texture by running its fixed-function stages per texel of the given
 * base slot, with white vertex lighting. Used for customizable shaders whose look depends on a
 * palette colour or a rendered texture, so the converted material matches the game's default.
 */
export function bakeShader(shader, baseTag = 'MAIN') {
  const base = shader.textures.get(baseTag);
  if (!base || !shader.effect) return null;
  const pass = shader.effect.passes[0];
  const { width, height } = base;
  const rgba = new Uint8Array(width * height * 4);
  const out = c4();
  const white = [1, 1, 1, 1];
  const uvs = [[0, 0]];
  let hasAlpha = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      uvs[0][0] = (x + 0.5) / width;
      uvs[0][1] = (y + 0.5) / height;
      shadeFragment(shader, pass, uvs, white, out);
      const o = (y * width + x) * 4;
      rgba[o] = Math.round(out[0] * 255);
      rgba[o + 1] = Math.round(out[1] * 255);
      rgba[o + 2] = Math.round(out[2] * 255);
      rgba[o + 3] = Math.round(out[3] * 255);
      if (rgba[o + 3] !== 255) hasAlpha = true;
    }
  }
  return { width, height, rgba, hasAlpha };
}

/** Whether the shader's first pass ever reads a texture factor or a slot other than the base one. */
export function shaderNeedsBake(shader, baseTag = 'MAIN') {
  if (!shader || !shader.effect) return false;
  for (const stage of shader.effect.passes[0].stageList) {
    if (stage.colorOp === 0) break;
    const args = [...stage.colorArgs, ...stage.alphaArgs].filter((a) => a.arg === 5).length;
    if (args && shader.tfactors.size) return true;
    if (stage.textureTag !== baseTag && shader.textures.has(stage.textureTag)) return true;
  }
  return false;
}

/** All customization variables a mesh shader or blueprint exposes, for the converter's report. */
export function describeVariables(list) {
  return list.map((v) => `${v.name}${v.private ? ' (private)' : ''}: ${v.kind === 'palette' ? `palette ${v.palette}` : `0..${v.max - 1}`}, default ${v.default}`);
}

const OP_NAMES = ['disable', 'arg1', 'arg2', 'modulate', 'modulate2x', 'modulate4x', 'add', 'addSigned', 'addSigned2x', 'subtract', 'addSmooth', 'blendDiffuseAlpha', 'blendTextureAlpha', 'blendFactorAlpha', 'blendTextureAlphaPM', 'blendCurrentAlpha', 'premodulate', 'modulateAlphaAddColor', 'modulateColorAddAlpha', 'modulateInvAlphaAddColor', 'modulateInvColorAddAlpha', 'bumpEnvMap', 'bumpEnvMapLuminance', 'dot3', 'multiplyAdd', 'lerp'];
const ARG_NAMES = ['current', 'diffuse', 'specular', 'temp', 'texture', 'tfactor'];
const argName = (a) => `${a.complement ? '1-' : ''}${ARG_NAMES[a.arg] ?? a.arg}${a.alphaReplicate ? '.a' : ''}`;

/** Effect, passes, stage operations and bound textures/factors of a static shader, for diagnostics. */
export function describeShader(shader) {
  if (!shader) return 'missing';
  const passes = shader.effect
    ? shader.effect.passes.map((p) => {
        const stages = p.stageList.map((st) => `${OP_NAMES[st.colorOp] ?? st.colorOp}(${st.colorArgs.slice(0, 2).map(argName).join(',')})/${OP_NAMES[st.alphaOp] ?? st.alphaOp}(${st.alphaArgs.slice(0, 2).map(argName).join(',')}) tex ${st.textureTag}`).join(' > ');
        return `${stages}${p.alphaBlend ? `; blend ${p.blendSrc}/${p.blendDst}` : ''}${p.alphaTest ? '; alphatest' : ''}; tfactor tag ${p.tfactorTag}`;
      }).join(' | ')
    : 'no fixed-function implementation';
  const textures = [...shader.textureFiles].map(([tag, file]) => `${tag}=${file}`).join(', ');
  const factors = [...shader.tfactors].map(([tag, v]) => `${tag}=${(v >>> 0).toString(16).padStart(8, '0')}`).join(', ');
  return `${shader.effectFile ?? 'no effect'} [${passes}] textures: ${textures || 'none'}; factors: ${factors || 'none'}`;
}

/** The blueprint's shaders after its prepare operations ran (textures chosen, palette colours set). */
export function preparedShaders(vfs, bp, ctx = renderContext()) {
  const shaders = bp.shaders.map((s) => {
    const sh = loadShader(vfs, s.inline ?? s.file, ctx);
    return sh ? { ...sh, textures: new Map(sh.textures), tfactors: new Map(sh.tfactors), textureFiles: new Map(sh.textureFiles) } : null;
  });
  applyPrepare(vfs, bp, ctx, shaders, new Set());
  return shaders;
}


