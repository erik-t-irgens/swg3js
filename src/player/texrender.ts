// The game's texture renderer, in the browser: the fixed-function pixel pipeline the converter
// bakes skin, hair and eyes with (tools/swg/texrender.mjs), run again here from the recipes the
// parts pack carries (customize.json and its PNG images), so a palette colour or a texture choice
// changes the character live. Pure data in, RGBA pixels out; nothing here touches three.js.

export interface Img {
  width: number;
  height: number;
  /** Rows top to bottom, 0..255. */
  rgba: Uint8Array | Uint8ClampedArray;
}

/** [arg, complement, alphaReplicate] as Direct3D numbers them: 0 current, 1 diffuse, 2 specular, 3 temp, 4 texture, 5 tfactor. */
export type StageArg = [number, number, number];

export interface Stage {
  colorOp: number;
  colorArgs: StageArg[];
  alphaOp: number;
  alphaArgs: StageArg[];
  result: number;
  textureTag: string;
  coordSetTag: string;
  address?: [number, number];
}

export interface Pass {
  alphaBlend: boolean;
  blendOp: number;
  blendSrc: number;
  blendDst: number;
  alphaTest: boolean;
  alphaRefTag: string | null;
  alphaFunc: number;
  writeMask: number;
  tfactorTag: string | null;
  stages: Stage[];
}

export interface ShaderDef {
  effect: string | null;
  passes: Pass[] | null;
  /** Texture tag → image file. */
  textures: Record<string, string>;
  addresses: Record<string, [number, number]>;
  coordSets: Record<string, number>;
  /** Tag → ARGB. */
  tfactors: Record<string, number>;
  alphaRefs: Record<string, number>;
  /** An int variable choosing among textures for a tag. */
  choices: { tag: string; variable: string; private: boolean; default: number; files: (string | null)[] }[];
  /** A palette variable setting a texture factor. */
  palettes: { tag: string; palette: string; variable: string; private: boolean; default: number }[];
}

export type PrepareOp =
  | { kind: 'texture'; shader: number; tag: string; texture: number }
  | { kind: 'texture1d'; shader: number; tag: string; base: number; count: number; variable: number }
  | { kind: 'texture2d'; shader: number; tag: string; base: number; count0: number; count1: number; variable0: number; variable1: number }
  | { kind: 'tfactor'; shader: number; tag: string; variable: number }
  | { kind: 'tfactorAlpha'; shader: number; tag: string; rgb: number[]; variable: number }
  | { kind: 'palette'; shader: number; tag: string; palette: string; variable: number };

export interface BlueprintDef {
  width: number;
  height: number;
  camera: number;
  shaders: (ShaderDef | null)[];
  textures: (string | null)[];
  /** Per vertex: [x, y, argb, u0, v0, u1, v1, ...]. */
  vertexBuffers: number[][][];
  uvSets: number[];
  indexBuffers: number[][];
  commands: ({ kind: 'clear'; clearColor: boolean; color: number } | { kind: 'draw'; shader: number; primitives: ({ kind: 'list'; vb: number; ib: number; start: number; triangles: number } | { kind: 'fan'; vb: number })[] })[];
  prepare: PrepareOp[];
  variables: { name: string; private: boolean; kind: string; default: number; palette?: string; max?: number }[];
}

export interface Recipe {
  mesh: string;
  material: string;
  kind: 'render' | 'bake';
  baseTag: string;
  shader: ShaderDef | null;
  slots: { tag: string; file: string; blueprint: BlueprintDef }[];
}

export interface CustomizeFile {
  images: string;
  recipes: Recipe[];
  /** Palette path → colours [r, g, b, a] 0..255. */
  palettes: Record<string, number[][]>;
}

/** The variable values in force: by full name or short name (the last path segment). */
export type Values = Map<string, number>;

const WHITE = 0xffffffff;
const argb = (r: number, g: number, b: number, a: number): number => (((a & 255) << 24) | ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)) >>> 0;
const argbToRgba = (v: number, out: number[] = [0, 0, 0, 0]): number[] => {
  out[0] = ((v >>> 16) & 255) / 255;
  out[1] = ((v >>> 8) & 255) / 255;
  out[2] = (v & 255) / 255;
  out[3] = ((v >>> 24) & 255) / 255;
  return out;
};
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export function valueOf(values: Values, name: string, def: number): number {
  const short = name.replace(/^.*\//, '');
  for (const key of [name, short]) {
    const v = values.get(key);
    if (v !== undefined) return v;
  }
  return def;
}

/** A palette's colour for an index, as ARGB; white when the palette is unknown or empty. */
export function paletteColor(palettes: Record<string, number[][]>, file: string, index: number): number {
  const pal = palettes[file];
  if (!pal || !pal.length) return WHITE;
  const e = pal[Math.min(Math.max(index, 0), pal.length - 1)];
  return argb(e[0], e[1], e[2], e[3] ?? 255);
}

/** A shader ready to shade: its images resolved, its choices and palette factors applied for the values. */
interface LiveShader {
  passes: Pass[] | null;
  textures: Map<string, Img>;
  addresses: Map<string, [number, number]>;
  coordSets: Map<string, number>;
  tfactors: Map<string, number>;
  alphaRefs: Map<string, number>;
}

export function liveShader(def: ShaderDef | null, images: (file: string | null) => Img | null, values: Values, palettes: Record<string, number[][]>): LiveShader | null {
  if (!def) return null;
  const textures = new Map<string, Img>();
  for (const [tag, file] of Object.entries(def.textures)) {
    const img = images(file);
    if (img) textures.set(tag, img);
  }
  for (const c of def.choices) {
    const v = Math.min(Math.max(valueOf(values, c.variable, c.default), 0), c.files.length - 1);
    const img = images(c.files[v] ?? null);
    if (img) textures.set(c.tag, img);
  }
  const tfactors = new Map<string, number>(Object.entries(def.tfactors));
  for (const p of def.palettes) tfactors.set(p.tag, paletteColor(palettes, p.palette, valueOf(values, p.variable, p.default)));
  return {
    passes: def.passes,
    textures,
    addresses: new Map(Object.entries(def.addresses)),
    coordSets: new Map(Object.entries(def.coordSets)),
    tfactors,
    alphaRefs: new Map(Object.entries(def.alphaRefs)),
  };
}

// ---------------------------------------------------------------------------------------------
// Sampling.
function wrapCoord(t: number, n: number, mode: number): number {
  if (mode === 2 || mode === 3) return Math.min(n - 1, Math.max(0, t));
  if (mode === 1 || mode === 4) {
    const period = 2 * n;
    let m = ((t % period) + period) % period;
    if (m >= n) m = period - 1 - m;
    return m;
  }
  return ((t % n) + n) % n;
}

function sample(img: Img, u: number, v: number, addrU: number, addrV: number, out: number[]): void {
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
// The fixed-function pixel pipeline.
interface Regs {
  current: number[];
  diffuse: number[];
  specular: number[];
  temp: number[];
  texture: number[];
  tfactor: number[];
}

function argValue(arg: StageArg, regs: Regs, out: number[]): number[] {
  const a = arg[0];
  const src = a === 0 ? regs.current : a === 1 ? regs.diffuse : a === 2 ? regs.specular : a === 3 ? regs.temp : a === 4 ? regs.texture : regs.tfactor;
  for (let i = 0; i < 4; i++) out[i] = arg[2] ? src[3] : src[i];
  if (arg[1]) for (let i = 0; i < 4; i++) out[i] = 1 - out[i];
  return out;
}

function stageOp(op: number, a1: number[], a2: number[], a0: number[], regs: Regs, out: number[], from: number, to: number): void {
  for (let i = from; i < to; i++) {
    let v: number;
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

function blendFactor(mode: number, src: number[], dst: number[], out: number[]): number[] {
  switch (mode) {
    case 0: out[0] = out[1] = out[2] = out[3] = 0; break;
    case 1: out[0] = out[1] = out[2] = out[3] = 1; break;
    case 2: for (let i = 0; i < 4; i++) out[i] = src[i]; break;
    case 3: for (let i = 0; i < 4; i++) out[i] = 1 - src[i]; break;
    case 4: out[0] = out[1] = out[2] = out[3] = src[3]; break;
    case 5: out[0] = out[1] = out[2] = out[3] = 1 - src[3]; break;
    case 6: out[0] = out[1] = out[2] = out[3] = dst[3]; break;
    case 7: out[0] = out[1] = out[2] = out[3] = 1 - dst[3]; break;
    case 8: for (let i = 0; i < 4; i++) out[i] = dst[i]; break;
    case 9: for (let i = 0; i < 4; i++) out[i] = 1 - dst[i]; break;
    case 10: { const f = Math.min(src[3], 1 - dst[3]); out[0] = out[1] = out[2] = f; out[3] = 1; break; }
    default: out[0] = out[1] = out[2] = out[3] = 1;
  }
  return out;
}

function compare(fn: number, a: number, b: number): boolean {
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
}

const scratch = { a1: [0, 0, 0, 0], a2: [0, 0, 0, 0], a0: [0, 0, 0, 0], res: [0, 0, 0, 0], fs: [0, 0, 0, 0], fd: [0, 0, 0, 0], dst: [0, 0, 0, 0], tf: [0, 0, 0, 0] };
const regs: Regs = { current: [0, 0, 0, 0], diffuse: [0, 0, 0, 0], specular: [0, 0, 0, 1], temp: [0, 0, 0, 0], texture: [0, 0, 0, 0], tfactor: [0, 0, 0, 0] };

/** Runs a pass's stages for one fragment. uvs: per coordinate set [u, v]; diffuse: [r, g, b, a]. */
function shadeFragment(shader: LiveShader, pass: Pass, uvs: number[][], diffuse: number[], out: number[]): void {
  for (let i = 0; i < 4; i++) {
    regs.current[i] = diffuse[i];
    regs.diffuse[i] = diffuse[i];
    regs.temp[i] = 0;
  }
  regs.specular[0] = regs.specular[1] = regs.specular[2] = 0;
  regs.specular[3] = 1;
  const tf = pass.tfactorTag ? shader.tfactors.get(pass.tfactorTag) : undefined;
  argbToRgba(tf === undefined ? WHITE : tf, regs.tfactor);
  const { a1, a2, a0, res } = scratch;
  for (const stage of pass.stages) {
    if (stage.colorOp === 0) break;
    const tex = shader.textures.get(stage.textureTag);
    if (tex) {
      const set = shader.coordSets.get(stage.coordSetTag) ?? 0;
      const uv = uvs[set] ?? uvs[0] ?? [0, 0];
      const addr = stage.address ?? shader.addresses.get(stage.textureTag) ?? [0, 0];
      sample(tex, uv[0], uv[1], addr[0], addr[1], regs.texture);
    } else regs.texture[0] = regs.texture[1] = regs.texture[2] = regs.texture[3] = 1;
    const ca = stage.colorArgs;
    argValue(ca[1], regs, a1);
    argValue(ca[2], regs, a2);
    argValue(ca[0], regs, a0);
    stageOp(stage.colorOp, a1, a2, a0, regs, res, 0, 3);
    if (stage.alphaOp === 0) res[3] = regs.current[3];
    else {
      const aa = stage.alphaArgs;
      argValue(aa[1], regs, a1);
      argValue(aa[2], regs, a2);
      argValue(aa[0], regs, a0);
      stageOp(stage.alphaOp, a1, a2, a0, regs, res, 3, 4);
    }
    const target = stage.result === 3 ? regs.temp : regs.current;
    for (let i = 0; i < 4; i++) target[i] = res[i];
  }
  for (let i = 0; i < 4; i++) out[i] = regs.current[i];
}

/** Writes a shaded fragment into the RGBA float framebuffer with the pass's blend state. */
function writeFragment(fb: Float32Array, index: number, src: number[], pass: Pass, shader: LiveShader): void {
  if (pass.alphaTest) {
    const ref = (pass.alphaRefTag ? shader.alphaRefs.get(pass.alphaRefTag) ?? 0 : 0) / 255;
    if (!compare(pass.alphaFunc, src[3], ref)) return;
  }
  const { dst, fs, fd, res } = scratch;
  for (let i = 0; i < 4; i++) dst[i] = fb[index + i];
  let result = src;
  if (pass.alphaBlend) {
    blendFactor(pass.blendSrc, src, dst, fs);
    blendFactor(pass.blendDst, src, dst, fd);
    result = res;
    for (let i = 0; i < 4; i++) {
      const s = src[i] * fs[i];
      const d = dst[i] * fd[i];
      let v: number;
      switch (pass.blendOp) {
        case 1: v = s - d; break;
        case 2: v = d - s; break;
        case 3: v = Math.min(s, d); break;
        case 4: v = Math.max(s, d); break;
        default: v = s + d;
      }
      result[i] = clamp01(v);
    }
  }
  const mask = pass.writeMask || 15;
  if (mask & 1) fb[index] = result[0];
  if (mask & 2) fb[index + 1] = result[1];
  if (mask & 4) fb[index + 2] = result[2];
  if (mask & 8) fb[index + 3] = result[3];
}

/** A blueprint vertex as stored: [x, y, argb, u0, v0, u1, v1, ...]. */
type Vert = number[];

function drawTriangle(fb: Float32Array, width: number, height: number, va: Vert, vb: Vert, vc: Vert, sets: number, shader: LiveShader, pass: Pass, sx: number, sy: number): void {
  const ax = va[0] * sx, ay = va[1] * sy;
  const bx = vb[0] * sx, by = vb[1] * sy;
  const cx = vc[0] * sx, cy = vc[1] * sy;
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 1e-12) return;
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
  const n = Math.max(sets, 1);
  const uvs: number[][] = [];
  for (let s = 0; s < n; s++) uvs.push([0, 0]);
  const diffuse = [0, 0, 0, 0];
  const src = [0, 0, 0, 0];
  const ca = argbToRgba(va[2]), cb = argbToRgba(vb[2]), cc = argbToRgba(vc[2]);
  const inv = 1 / area;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * inv;
      const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * inv;
      const w2 = 1 - w0 - w1;
      const eps = -1e-6;
      if (w0 < eps || w1 < eps || w2 < eps) continue;
      for (let s = 0; s < n; s++) {
        const o = 3 + s * 2;
        uvs[s][0] = (va[o] ?? 0) * w0 + (vb[o] ?? 0) * w1 + (vc[o] ?? 0) * w2;
        uvs[s][1] = (va[o + 1] ?? 0) * w0 + (vb[o + 1] ?? 0) * w1 + (vc[o + 1] ?? 0) * w2;
      }
      for (let i = 0; i < 4; i++) diffuse[i] = ca[i] * w0 + cb[i] * w1 + cc[i] * w2;
      shadeFragment(shader, pass, uvs, diffuse, src);
      writeFragment(fb, (y * width + x) * 4, src, pass, shader);
    }
  }
}

/** Runs a blueprint's prepare operations: textures and factors chosen by the values. */
function applyPrepare(bp: BlueprintDef, shaders: (LiveShader | null)[], values: Values, palettes: Record<string, number[][]>, images: (file: string | null) => Img | null): void {
  const value = (i: number): number => {
    const v = bp.variables[i];
    return v ? valueOf(values, v.name, v.default) : 0;
  };
  const setTexture = (shader: LiveShader, tag: string, index: number): void => {
    const img = images(bp.textures[index] ?? null);
    if (img) shader.textures.set(tag, img);
    else shader.textures.delete(tag);
  };
  for (const op of bp.prepare) {
    const shader = shaders[op.shader];
    if (!shader) continue;
    switch (op.kind) {
      case 'texture': setTexture(shader, op.tag, op.texture); break;
      case 'texture1d': setTexture(shader, op.tag, op.base + Math.min(Math.max(value(op.variable), 0), op.count - 1)); break;
      case 'texture2d': {
        const a = Math.min(Math.max(value(op.variable0), 0), op.count0 - 1);
        const b = Math.min(Math.max(value(op.variable1), 0), op.count1 - 1);
        setTexture(shader, op.tag, op.base + a * op.count1 + b);
        break;
      }
      case 'tfactor': shader.tfactors.set(op.tag, value(op.variable) >>> 0); break;
      case 'tfactorAlpha': shader.tfactors.set(op.tag, argb(op.rgb[0], op.rgb[1], op.rgb[2], value(op.variable))); break;
      case 'palette': shader.tfactors.set(op.tag, paletteColor(palettes, op.palette, value(op.variable))); break;
    }
  }
}

/** Runs a blueprint into an RGBA image of its own size. */
export function renderBlueprint(bp: BlueprintDef, values: Values, palettes: Record<string, number[][]>, images: (file: string | null) => Img | null): Img {
  const shaders = bp.shaders.map((s) => liveShader(s, images, values, palettes));
  applyPrepare(bp, shaders, values, palettes, images);
  const { width, height } = bp;
  const fb = new Float32Array(width * height * 4);
  const sx = width / bp.camera;
  const sy = height / bp.camera;
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
    if (!shader || !shader.passes) continue;
    for (const pass of shader.passes) {
      for (const prim of cmd.primitives) {
        const vb = bp.vertexBuffers[prim.vb];
        if (!vb) continue;
        const sets = bp.uvSets[prim.vb] ?? 1;
        if (prim.kind === 'fan') {
          for (let i = 1; i + 1 < vb.length; i++) drawTriangle(fb, width, height, vb[0], vb[i], vb[i + 1], sets, shader, pass, sx, sy);
        } else {
          const ib = bp.indexBuffers[prim.ib];
          if (!ib) continue;
          for (let t = 0; t < prim.triangles; t++) {
            const o = prim.start + t * 3;
            drawTriangle(fb, width, height, vb[ib[o]], vb[ib[o + 1]], vb[ib[o + 2]], sets, shader, pass, sx, sy);
          }
        }
      }
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < fb.length; i++) rgba[i] = Math.round(clamp01(fb[i]) * 255);
  return { width, height, rgba };
}

/**
 * Bakes a mesh shader to one texture by running its passes per texel of the base slot with white
 * vertex lighting, the alpha being the first pass's; what the converter did for customizable
 * shaders whose look depends on a palette colour or a rendered texture.
 */
export function bakeShader(shader: LiveShader, baseTag: string): Img | null {
  const base = shader.textures.get(baseTag);
  if (!base || !shader.passes) return null;
  const { width, height } = base;
  const fb = new Float32Array(width * height * 4);
  const alpha = new Float32Array(width * height);
  const out = [0, 0, 0, 0];
  const white = [1, 1, 1, 1];
  const uvs = [[0, 0]];
  shader.passes.forEach((pass, index) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        uvs[0][0] = (x + 0.5) / width;
        uvs[0][1] = (y + 0.5) / height;
        shadeFragment(shader, pass, uvs, white, out);
        const o = (y * width + x) * 4;
        if (index === 0) {
          fb[o] = out[0]; fb[o + 1] = out[1]; fb[o + 2] = out[2]; fb[o + 3] = out[3];
          alpha[y * width + x] = out[3];
        } else writeFragment(fb, o, out, pass, shader);
      }
    }
  });
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = Math.round(clamp01(fb[i * 4]) * 255);
    rgba[i * 4 + 1] = Math.round(clamp01(fb[i * 4 + 1]) * 255);
    rgba[i * 4 + 2] = Math.round(clamp01(fb[i * 4 + 2]) * 255);
    rgba[i * 4 + 3] = Math.round(clamp01(alpha[i]) * 255);
  }
  return { width, height, rgba };
}

/** The variable names (full and short) a recipe's output depends on. */
export function recipeVariables(r: Recipe): Set<string> {
  const out = new Set<string>();
  const add = (n: string) => {
    out.add(n);
    out.add(n.replace(/^.*\//, ''));
  };
  const fromShader = (s: ShaderDef | null) => {
    for (const c of s?.choices ?? []) add(c.variable);
    for (const p of s?.palettes ?? []) add(p.variable);
  };
  fromShader(r.shader);
  for (const slot of r.slots) {
    for (const s of slot.blueprint.shaders) fromShader(s);
    for (const v of slot.blueprint.variables) add(v.name);
  }
  return out;
}

/** Makes a recipe's texture for the values: the rendered blueprint, or the shader baked over it and its own textures. */
export function renderRecipe(r: Recipe, values: Values, palettes: Record<string, number[][]>, images: (file: string | null) => Img | null): Img | null {
  const rendered = new Map<string, Img>();
  for (const slot of r.slots) rendered.set(slot.tag, renderBlueprint(slot.blueprint, values, palettes, images));
  if (r.kind === 'render') return rendered.get(r.baseTag) ?? [...rendered.values()][0] ?? null;
  const shader = liveShader(r.shader, images, values, palettes);
  if (!shader) return rendered.get(r.baseTag) ?? null;
  for (const [tag, img] of rendered) shader.textures.set(tag, img);
  return bakeShader(shader, r.baseTag) ?? rendered.get(r.baseTag) ?? null;
}
