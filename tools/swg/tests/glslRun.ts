// A GLSL function's own body, run as script (the volumetrics' tests): node compiles no GLSL, so a shared function's text
// is turned word for word into script -- a typed declaration a `let`, a cast its Math namesake, the scalar built-ins
// handed in -- and run against its mirror over a sweep. A body pinned only by its text can lose a term, swap two
// arguments or scale a constant with every suite green (the volumetrics' third wave's review did all three); run, it
// cannot. Scalars only: a vector is handed in as an object with `x`, `y`, `z` and `w`, and read by its components, which
// is all the functions run this way do; a `void` function runs too, writing the globals declared beside it (each a `let`
// of the script's own), and a sampler or a matrix parameter is whatever the test hands in, read through the stand-ins it
// puts in `env` (`texture`, `textureGrad`, `vec3`).
//
// Plain type stripping.

/** GLSL's scalar built-ins the functions run here use, as script (GLSL's own definitions). */
export const GLSL_SCALARS: Readonly<Record<string, (...a: number[]) => number>> = {
  clamp: (x, a, b) => Math.min(Math.max(x, a), b),
  mix: (a, b, t) => a * (1 - t) + b * t,
  smoothstep: (e0, e1, x) => {
    const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
    return t * t * (3 - 2 * t);
  },
  step: (e, x) => (x < e ? 0 : 1),
  fract: (x) => x - Math.floor(x),
};

// An unsigned integer runs as a whole number (`uint(` a truncation, `1u` and `0x…u` their plain numbers): right for an
// index or a count, never for a hash, whose multiplies and shifts wrap at 32 bits, so a hash is read by its shape
// (`glslHash`, `glslW7Hash`) and handed in from `env`, its own text taken out of what is run.
const TYPES = '(?:float|int|uint|bool|vec2|vec3|vec4)';
/** What a function may answer: a type, or nothing (a `void` one writes globals, which run as the script's own `let`s). */
const RETURNS = '(?:void|float|int|uint|bool|vec2|vec3|vec4)';
/** What a parameter may be: a type or a sampler, with a precision before it or not (stood in from `env` when run). */
const PARAMS = '(?:(?:highp|mediump|lowp)\\s+)?(?:float|int|uint|bool|vec2|vec3|vec4|mat3|sampler2D|sampler3D)';

/** One function's text out of a shader's source, header to its own closing brace; throws when it is not there. */
export function glslFunctionText(src: string, name: string): string {
  const head = new RegExp(`\\b${RETURNS}\\s+${name}\\s*\\(`).exec(src);
  if (!head) throw new Error(`no GLSL function ${name} in the source`);
  const open = src.indexOf('{', head.index);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(head.index, i + 1);
  }
  throw new Error(`GLSL function ${name} has no closing brace`);
}

/**
 * The particles' 32-bit hash (`airHash`) and the share drawn from it (`airRand`), out of a shader's own source, as script
 * (the volumetrics' fourth wave): node has no unsigned 32-bit integer, so each statement of the hash is read by its shape
 * and written out with `Math.imul` and `>>> 0`, and a statement of any other shape throws, so a hash rewritten some other
 * way fails its test rather than running as something it is not. Its shifts and constants are the source's own.
 */
export function glslHash(src: string): { airHash: (x: number) => number; airRand: (x: number) => number } {
  const m = /uint airHash\(uint x\) \{([\s\S]*?)\n\}/.exec(src);
  if (!m) throw new Error('no airHash(uint x) in the source');
  const steps: ((x: number) => number)[] = [];
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line === 'return x;') continue;
    const xs = /^x \^= x >> (\d+)u;$/.exec(line);
    const mul = /^x \*= (0x[0-9a-fA-F]+)u;$/.exec(line);
    if (xs) {
      const s = Number(xs[1]);
      steps.push((x) => (x ^ (x >>> s)) >>> 0);
    } else if (mul) {
      const c = Number(mul[1]);
      steps.push((x) => Math.imul(x, c) >>> 0);
    } else throw new Error(`airHash: a statement of no shape this reader knows: ${line}`);
  }
  const airHash = (x0: number): number => {
    let x = x0 >>> 0;
    for (const f of steps) x = f(x);
    return x;
  };
  const r = /float airRand\(uint x\) \{ return float\(airHash\(x\) >> (\d+)u\) \* \(1\.0 \/ ([\d.]+)\); \}/.exec(src);
  if (!r) throw new Error('no airRand(uint x) of the known shape in the source');
  const shift = Number(r[1]);
  const over = 1 / Number(r[2]);
  return { airHash, airRand: (x) => (airHash(x) >>> shift) * over };
}

/**
 * The unified wind's hash (`w7Mix` and `w7Hash`, the weather's own chained mix, the volumetrics' seventh wave), out of a
 * shader's own source, as script, read statement by statement by its shape as `glslHash` reads the particles' (a
 * statement of any other shape throws): its constants and shifts are the source's own, so a hash rewritten wrong in the
 * program fails its test against the processor's `windHash` rather than running as something it is not.
 */
export function glslW7Hash(src: string): { w7Mix: (h: number, v: number) => number; w7Hash: (a: number, b: number, c: number) => number } {
  const m = /uint w7Mix\(uint h, uint v\) \{([\s\S]*?)\n\}/.exec(src);
  if (!m) throw new Error('no w7Mix(uint h, uint v) in the source');
  const steps: ((h: number, v: number) => number)[] = [];
  let returned = false;
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (returned) throw new Error(`w7Mix: a statement after its return: ${line}`);
    const xorMul = /^h = \(h \^ v\) \* (0x[0-9a-fA-F]+)u;$/.exec(line);
    const shift = /^(?:h = |return )h \^ \(h >> (\d+)u\);$/.exec(line);
    const mul = /^h = h \* (0x[0-9a-fA-F]+)u;$/.exec(line);
    if (xorMul) {
      const c = Number(xorMul[1]);
      steps.push((h, v) => Math.imul((h ^ v) >>> 0, c) >>> 0);
    } else if (shift) {
      const s = Number(shift[1]);
      steps.push((h) => (h ^ (h >>> s)) >>> 0);
      if (line.startsWith('return')) returned = true;
    } else if (mul) {
      const c = Number(mul[1]);
      steps.push((h) => Math.imul(h, c) >>> 0);
    } else throw new Error(`w7Mix: a statement of no shape this reader knows: ${line}`);
  }
  if (!returned) throw new Error('w7Mix: no return of the known shape');
  const w7Mix = (h0: number, v0: number): number => {
    let h = h0 >>> 0;
    const v = v0 >>> 0;
    for (const f of steps) h = f(h, v);
    return h;
  };
  const r = /float w7Hash\(uint a, uint b, uint c\) \{\s*uint h = w7Mix\(w7Mix\(w7Mix\((0x[0-9a-fA-F]+)u, a\), b\), c\);\s*return float\(h >> (\d+)u\) \* \(1\.0 \/ ([\d.]+)\);\s*\}/.exec(src);
  if (!r) throw new Error('no w7Hash(uint a, uint b, uint c) of the known shape in the source');
  const seed = Number(r[1]);
  const shift = Number(r[2]);
  const over = 1 / Number(r[3]);
  return { w7Mix, w7Hash: (a, b, c) => (w7Mix(w7Mix(w7Mix(seed, a), b), c) >>> shift) * over };
}

/**
 * The named functions of `glsl` (one function's text or several, uniforms beside them ignored), as script: each typed
 * header a `function`, each typed declaration a `let`, `int(` and `float(` the casts, the Math built-ins Math's, and every
 * other name it reads from `env` (the uniforms and the scalar built-ins, `GLSL_SCALARS` by default).
 */
export function glslFunctions(glsl: string, names: readonly string[], env: Record<string, unknown> = {}): Record<string, (...a: unknown[]) => number> {
  const body = glsl
    .replace(/^\s*uniform[^;]*;\s*$/gm, '')
    .replace(new RegExp(`\\b${RETURNS}\\s+(\\w+)\\s*\\(([^)]*)\\)\\s*\\{`, 'g'), (_m, fn: string, params: string) => `function ${fn}(${params.replace(new RegExp(`\\b(?:(?:in|out|inout)\\s+)?${PARAMS}\\s+`, 'g'), '').trim()}) {`)
    .replace(new RegExp(`\\b${TYPES}\\s+(?=\\w)`, 'g'), 'let ')
    .replace(/\bu?int\(/g, 'Math.trunc(')
    .replace(/\b(0x[0-9a-fA-F]+|\d+)u\b/g, '$1')
    .replace(/\bfloat\(/g, 'Number(')
    .replace(/(?<![\w.])(exp|abs|max|min|sqrt|floor|log2|pow)\(/g, 'Math.$1(');
  const all: Record<string, unknown> = { ...GLSL_SCALARS, ...env };
  const keys = Object.keys(all);
  const make = new Function(...keys, `${body}\nreturn { ${names.join(', ')} };`) as (...a: unknown[]) => Record<string, (...a: unknown[]) => number>;
  return make(...keys.map((k) => all[k]));
}
