// What a node test can say about a shader it cannot compile. Node compiles no GLSL, so a test that pins a
// shader by its text pins its words and not its program: the blade glow pass once declared `own` twice in
// one scope of `bladeLight`, which every GLSL compiler refuses, and the whole pass stayed unlinked in every
// browser while every test passed. These helpers are shared by the tests that read a shader's text
// (`bladeGlow.test.ts`, `ssao.test.ts`): one GLSL function's text, the source as one variant of its
// `#ifdef` branches would be compiled, and the one fault a compiler refuses that no type check here sees.

/** One GLSL function's whole text, from its return type to its closing brace; '' when there is none. */
export function glslFunction(glsl: string, name: string): string {
  const m = new RegExp(`\\b\\w+\\s+${name}\\s*\\(`).exec(glsl);
  if (!m) return '';
  const open = glsl.indexOf('{', m.index + m[0].length);
  if (open < 0) return '';
  let depth = 0;
  for (let j = open; j < glsl.length; j++) {
    if (glsl[j] === '{') depth++;
    else if (glsl[j] === '}' && --depth === 0) return glsl.slice(m.index, j + 1);
  }
  return '';
}

/**
 * The source as it would be compiled with these names defined: each `#ifdef` / `#ifndef` keeps the branch
 * the names choose and drops the other, `#else` swapping them, `#endif` closing. Any other `#if` keeps its
 * first branch and drops every `#elif` and `#else` after it, which is enough for a scan and is said here so
 * nobody reads more into it. The kept lines are returned as they were, since `redeclared` steps over
 * directives itself.
 */
export function glslVariant(glsl: string, defined: ReadonlySet<string>): string {
  const out: string[] = [];
  // One entry per open conditional: whether its current branch is kept, and whether a branch of it already was.
  const stack: { keep: boolean; taken: boolean }[] = [];
  const kept = () => stack.every((s) => s.keep);
  for (const line of glsl.split('\n')) {
    const d = /^\s*#\s*(ifdef|ifndef|if|else|elif|endif)\b\s*(\w*)/.exec(line);
    if (!d) {
      if (kept()) out.push(line);
      continue;
    }
    if (d[1] === 'ifdef' || d[1] === 'ifndef' || d[1] === 'if') {
      const keep = d[1] === 'ifdef' ? defined.has(d[2]) : d[1] === 'ifndef' ? !defined.has(d[2]) : true;
      stack.push({ keep, taken: keep });
    } else if (d[1] === 'else' || d[1] === 'elif') {
      const top = stack[stack.length - 1];
      if (top) {
        top.keep = d[1] === 'else' && !top.taken;
        top.taken = top.taken || top.keep;
      }
    } else stack.pop();
  }
  return out.join('\n');
}

/**
 * Every name a GLSL source declares twice in one scope, as `function: name`. A small scanner and not a
 * compiler: it follows braces, a function's parameters (which share its body's scope in GLSL ES 3.00),
 * a for loop's own scope, and declarations of the built-in types, which is all these shaders write.
 * Where it is unsure it opens a new scope, so it can miss a fault but never invents one -- with one
 * exception it cannot see past: both branches of an `#ifdef` are read as one body, so a shader with
 * branches is scanned one variant at a time (`glslVariant`).
 */
export function redeclared(glsl: string): string[] {
  const text = glsl
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/^\s*#[^\n]*/gm, ' ');
  const tokens = text.match(/[A-Za-z_]\w*|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+|\S/g) ?? [];
  const TYPES = new Set(['void', 'bool', 'int', 'uint', 'float', 'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4', 'uvec2', 'uvec3', 'uvec4', 'bvec2', 'bvec3', 'bvec4', 'mat2', 'mat3', 'mat4', 'sampler2D', 'sampler3D', 'samplerCube', 'sampler2DShadow', 'isampler2D', 'usampler2D']);
  const QUALIFIERS = new Set(['const', 'in', 'out', 'inout', 'highp', 'mediump', 'lowp', 'uniform', 'varying', 'attribute', 'flat', 'smooth', 'centroid']);
  const isIdent = (t: string | undefined) => !!t && /^[A-Za-z_]\w*$/.test(t) && !TYPES.has(t) && !QUALIFIERS.has(t);
  type Scope = { names: Set<string>; endsFor: Scope | null; forHeader: number; single: boolean };
  const scope = (): Scope => ({ names: new Set(), endsFor: null, forHeader: -1, single: false });
  const stack: Scope[] = [scope()];
  const out: string[] = [];
  let fnName = '';
  let paren = 0;
  let params: Scope | null = null;
  let paramsParen = -1;
  let paramsDone = false;
  let afterFor: Scope | null = null;
  const declare = (into: Scope, name: string) => {
    if (into.names.has(name)) out.push(`${fnName || '(global)'}: ${name}`);
    into.names.add(name);
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (afterFor && t !== '{') {
      // A loop whose body is one statement: its scope closes at that statement's end.
      afterFor.single = true;
      afterFor = null;
    }
    if (t === 'for' && tokens[i + 1] === '(') {
      const s = scope();
      s.forHeader = paren;
      stack.push(s);
      continue;
    }
    if (t === '(') {
      paren++;
      continue;
    }
    if (t === ')') {
      paren--;
      const top = stack[stack.length - 1];
      if (top.forHeader === paren && !top.single && afterFor === null && params === null) {
        top.forHeader = -1;
        afterFor = top;
      }
      if (params && paren === paramsParen) paramsDone = true;
      continue;
    }
    if (t === '{') {
      const s = scope();
      if (params && paramsDone) {
        s.names = params.names;
        params = null;
        paramsDone = false;
      } else if (afterFor) {
        s.endsFor = afterFor;
        afterFor = null;
      }
      stack.push(s);
      continue;
    }
    if (t === '}') {
      const s = stack.pop();
      if (s?.endsFor) stack.pop();
      if (stack.length === 1) fnName = '';
      continue;
    }
    if (t === ';') {
      const top = stack[stack.length - 1];
      if (top.single && paren === 0) stack.pop();
      if (params && paramsDone) {
        // A prototype, not a definition.
        params = null;
        paramsDone = false;
      }
      continue;
    }
    if (!TYPES.has(t) || !isIdent(tokens[i + 1])) continue;
    const name = tokens[i + 1];
    const next = tokens[i + 2];
    if (next === '(' && stack.length === 1) {
      // A function: overloads may share a name, so it is not declared; its parameters wait for its body.
      fnName = name;
      params = scope();
      paramsParen = paren;
      paramsDone = false;
      i++;
      continue;
    }
    if (params && !paramsDone) {
      declare(params, name);
      i++;
      continue;
    }
    if (next === '=' || next === ';' || next === ',' || next === '[' || next === ')') {
      declare(stack[stack.length - 1], name);
      i++;
    }
  }
  return out;
}
