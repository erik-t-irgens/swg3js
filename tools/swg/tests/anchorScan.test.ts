// The anchor-relative rule (the GPU port's pass 1 design, section 11; pass 1, wave 1, item 6): from pass 1 on, nothing new
// places a thing on the card measured from the world's middle in a 32-bit value (1 mm steps at 8 km, 2 mm at 16 km). A group
// is kept relative to its anchor and handed the anchor less the camera in doubles; world-locked patterns read an offset the
// CPU wraps to their period.
//
// This test reads every GPU file added from pass 1 on -- the files `PASS1_FILES` names, and every file under
// `src/core/gpu/` that the base of pass 1 (`64a6438`, its list recorded below) does not have -- and what pass 1 added to a
// file the base had (`PASS1_PARTS`, each part by its first and last lines, the rest of that file blanked), with comments and
// the words inside strings blanked (each blanked character kept as a space, so every place in the code is the file's own),
// and fails where:
//   1. a line places with three's world-space nodes: `positionWorld`, `modelWorldMatrix`, `modelPosition`, `cameraPosition`,
//      `cameraWorldMatrix`, `objectPosition`, `objectWorldMatrix` (a new node never places with `positionWorld`);
//   2. the card is handed a place measured from the world's middle. A world place is a world matrix or a read of one
//      (`matrixWorld`, `getWorldPosition(`, `localToWorld(`, `worldPos…`), an object's `.position` (the camera's, a light's,
//      anything standing in the scene: the scan cannot tell a child's, so a deliberate one is allowed with its reason), a
//      component of a value named for the camera or the eye (`camera.x`, `eye.y`), or any name the file fills from one of
//      those (`const eye = camera.position`, `o.getWorldPosition(at)`, `m.compose(at, q, s)`, followed to a fixed point, each
//      name from where it is filled to the end of that block, a field through the file). It reaches the card through: a
//      uniform made of one (the call's whole argument, brackets and all, across
//      lines), a uniform's `.value` set from one or updated from one by three's `onObjectUpdate`/`onRenderUpdate`/
//      `onFrameUpdate`, a `reference` node reading an object's `position` or `matrixWorld` by name, a 32-bit array made
//      from one or filled from one (by index, by `set`, by `toArray`), a buffer attribute set from one (`setXYZ` and its
//      kin), an instance matrix set from one, or any buffer written to the card (`writeBuffer`), which must say why it is
//      not such a place;
//   3. a last-frame copy of a uniform is made (`previousUniform`, pass 1, wave 5's motion): it holds whatever that uniform is
//      filled with, in a file the scan may not read, so each copy must say what it holds;
// unless the line the reach starts on is in `ALLOW` with its reason. Each rule is held to catch planted code in each of its
// forms, and to let through the forms that keep to the rule; the wave's own new files are its first subjects.
//
// Run: node tools/swg/tests/anchorScan.test.ts
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
};

/** `src/core/gpu/` as pass 1's base (`64a6438`) has it: any other file there is pass 1's or later. */
const BASE_GPU = new Set(['bundles.ts', 'carries.ts', 'consoleWords.ts', 'drawCost.ts', 'fallback.ts', 'framePerf.ts', 'gpuCard.ts', 'gpuCardSelfTest.ts', 'gpuChain.ts', 'gpuChainPasses.ts', 'gpuDetail.ts', 'gpuEnv.ts', 'gpuGround.ts', 'gpuGroundSelfTest.ts', 'gpuLook.ts', 'gpuPrograms.ts', 'gpuSpec.ts', 'gpuSpecSelfTest.ts', 'gpuSsao.ts', 'gpuSsaoPass.ts', 'inlineOutput.ts', 'looks.ts', 'patchReplay.ts', 'patchShadow.ts', 'patchStencilBundles.ts', 'patchStill.ts', 'patchTable.ts', 'patchWarm.ts', 'patches.ts', 'shadowCull.ts', 'standIns.ts', 'start.ts', 'stillMark.ts', 'sun.ts', 'usageHint.ts', 'warmDepth.ts']);

/** GPU files of pass 1 on outside `src/core/gpu/`, or inside it under a base name (a later pass adds its own here). */
const PASS1_FILES: string[] = [];

/**
 * What pass 1 added to a file the base already had, scanned as its own files are: each from the line holding `from` to the line
 * before the one holding `to` (both read off the file's own text, each there once), everything else in the file blanked.
 */
const PASS1_PARTS: { file: string; from: string; to: string }[] = [
  // Wave 5 (its fixer, from the review): the far rings' hand-in of last frame's place to the motion output.
  { file: 'src/core/gpu/gpuGround.ts', from: "/** A uniform's last-frame copy where its value is a vector (`motion.ts`), else the node it already has. */", to: "// The bake's lattices and the morph (`HORIZON_RING_FUNCTIONS`), each as nodes over float operands." },
  { file: 'src/core/gpu/gpuGround.ts', from: "// Pass 1, wave 5: the ring's place last frame, for the motion output (`motion.ts`): the same vertex worked over last frame's", to: '// The vertex (`HORIZON_RING_VERTEX`): an instance is a node' },
];

/** Wave 1's own new files: the rule's first subjects, held to be scanned. */
const WAVE1 = ['src/core/gpu/pipeLedger.ts', 'src/core/gpu/keyCensus.ts', 'src/core/gpu/gpuTimer.ts'];

/** Lines let through, each with its reason: `file` and a piece of the line's code as scanned. */
const ALLOW: { file: string; has: string; why: string }[] = [
  // Pass 1, wave 4: the bone pool's one write a frame. What it sends is body space, the rule itself: each matrix the body
  // root's world matrix inverted times the bone's world matrix times its inverse bind matrix, worked in doubles before it is
  // a float (`bonePool.ts`, `writeSlot`, held by `bonePool.test.ts` to be small 4,000 m from the middle).
  { file: 'src/core/gpu/patchBones.ts', has: 'queue.writeBuffer(buffer, at * 4, mirror, at, count)', why: "the bone pool's matrices are body space (root inverse times bone world times inverse bind, in doubles): no place measured from the world's middle reaches the card" },
  // Pass 1, wave 5's fixer: the far rings' last-frame copies (`ringPrevious`, and the ground's frame beside them).
  { file: 'src/core/gpu/gpuGround.ts', has: 'previousUniform(src as { value: Any })', why: "the far rings' last-frame copies of the vectors their vertex already places by, from before pass 1 (the eye and the square written as world places by horizonField.ts, the ground's frame by terrainTextures.ts): the ring is still placed so, and the motion is the difference of two vertices worked by the same arithmetic over this frame's and last frame's copies, read within 0.003 px 8 and 14.9 km out (wave 5's prover); the ring placed from its anchor is the later precision work's" },
];

// ---------------------------------------------------------------- reading the code

/** A file's code with comments and the words inside strings blanked to spaces (their quotes kept, line ends kept), so
 * every offset in it is the same place in the file. */
function blank(text: string): string {
  const out = text.split('');
  const n = text.length;
  const sp = (k: number): void => {
    if (k < n && out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  let i = 0;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && text[i] !== '\n') sp(i++);
      continue;
    }
    if (c === '/' && d === '*') {
      sp(i++);
      sp(i++);
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) sp(i++);
      sp(i++);
      sp(i++);
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      i++;
      while (i < n && text[i] !== c) {
        if (text[i] === '\\') sp(i++);
        sp(i++);
      }
      i++;
      continue;
    }
    i++;
  }
  return out.join('');
}

/** A file's code, line by line, blanked as `blank` does it. */
function codeLines(text: string): string[] {
  return blank(text).split(/\r?\n/);
}

/** Where the bracket opened at `open` closes (or the code's end), counting every kind of bracket between. */
function closeOf(code: string, open: number): number {
  let depth = 0;
  for (let k = open; k < code.length; k++) {
    const ch = code[k];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return k;
    }
  }
  return code.length;
}

/** Where an assignment's right-hand side that starts at `from` ends: at the `;` or `,` that ends it, or where the bracket it
 * sits in closes. */
function rhsEnd(code: string, from: number): number {
  let depth = 0;
  for (let k = from; k < code.length; k++) {
    const ch = code[k];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return k;
      depth--;
    } else if (depth === 0 && (ch === ';' || ch === ',')) return k;
  }
  return code.length;
}

/** Whether a right-hand side is a function or a class (an arrow at its own level, or `function`, `class`, a block): what it
 * holds is code, not a place, whatever the code inside reads. */
function isCode(code: string, from: number, to: number): boolean {
  if (/^\s*(?:async\b|function\b|class\b|\{)/.test(code.slice(from, to))) return true;
  let depth = 0;
  for (let k = from; k < to; k++) {
    const ch = code[k];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (depth === 0 && ch === '=' && code[k + 1] === '>') return true;
  }
  return false;
}

const NAME = String.raw`(?<![\w$.])((?:this\.)?[A-Za-z_$][\w$]*)`;
const bare = (s: string): string => s.replace(/^this\./, '');
const escape = (s: string): string => s.replace(/[$]/g, '\\$');
const nameRes = new Map<string, RegExp>();
/** A name as it is read, everywhere in a piece of code: a field as `this.name`, any other as itself, never as another
 * object's field of that name. */
function nameRe(name: string): RegExp {
  let re = nameRes.get(name);
  if (!re) {
    re = name.startsWith('this.') ? new RegExp(String.raw`\bthis\.${escape(bare(name))}(?![\w$])`, 'g') : new RegExp(String.raw`(?<![\w$.])${escape(name)}(?![\w$])`, 'g');
    nameRes.set(name, re);
  }
  return re;
}

/** A world place read directly: a world matrix or a read of one, an object's place, a camera's or an eye's component. */
const SOURCE = /\bmatrixWorld\b|\bgetWorldPosition\s*\(|\blocalToWorld\s*\(|\bworldPos\w*|(?<!\battributes)\.position\b|\b\w*(?:[Cc]amera|[Cc]am|[Ee]ye)\.[xyz]\b/;

/** Methods that write what they are handed into their receiver (three's vectors and matrices). */
const FILLS = 'copy|set|setFromMatrixPosition|setPosition|compose|makeTranslation|add|addVectors|addScaledVector|lerp|lerpVectors|applyMatrix4|fromArray|setFromMatrixColumn|multiplyMatrices|multiply|premultiply|copyPosition';

/** A file's blanked code with its braces matched: for each place, the innermost block open round it, and where each block
 * closes. */
interface Code {
  code: string;
  encl: Int32Array;
  close: Int32Array;
}
function codeOf(code: string): Code {
  const n = code.length;
  const encl = new Int32Array(n + 1).fill(-1);
  const close = new Int32Array(n).fill(n);
  const open: number[] = [];
  for (let k = 0; k < n; k++) {
    encl[k] = open.length ? open[open.length - 1] : -1;
    if (code[k] === '{') open.push(k);
    else if (code[k] === '}') {
      const o = open.pop();
      if (o !== undefined) close[o] = k;
    }
  }
  return { code, encl, close };
}

/** Where a name filled at `at` holds its world place: a field (`this.at`) through the whole file, any other name from there
 * to the end of the block it was filled in. */
type Filled = Map<string, [number, number][]>;
function fill(c: Code, filled: Filled, name: string, at: number): boolean {
  const o = c.encl[at];
  const span: [number, number] = name.startsWith('this.') ? [0, c.code.length] : [at, o < 0 ? c.code.length : c.close[o]];
  const spans = filled.get(name) ?? [];
  if (spans.some(([a, b]) => a <= span[0] && b >= span[1])) return false;
  spans.push(span);
  filled.set(name, spans);
  return true;
}

/** Whether the code from `from` to `to` reads a world place, directly or through a name filled from one where it is read. */
function placed(c: Code, from: number, to: number, filled: Filled): boolean {
  const frag = c.code.slice(from, to);
  if (SOURCE.test(frag)) return true;
  for (const [name, spans] of filled) {
    for (const m of frag.matchAll(nameRe(name))) {
      const at = from + m.index!;
      if (spans.some(([a, b]) => at >= a && at <= b)) return true;
    }
  }
  return false;
}

/** The names the file fills from a world place, followed to a fixed point: assigned one (`const eye = camera.position`,
 * `this.at = …`), handed one by a method that writes its receiver (`at.copy(o.position)`, `m.compose(at, q, s)`), or handed
 * to a world read (`o.getWorldPosition(at)`, `o.localToWorld(at)`). A name holds its place from where it is filled to the
 * end of that block (a field through the file), so a short name filled in one function is not taken for a place in
 * another; a right-hand side that is a function holds code, not a place. */
function filledNames(c: Code): Filled {
  const code = c.code;
  const filled: Filled = new Map();
  const assign = new RegExp(String.raw`${NAME}\s*(?::[^=;(){}]+)?(?<![=!<>+\-*/%&|^?])=(?![=>])`, 'g');
  const fills = new RegExp(String.raw`${NAME}\.(?:${FILLS})\s*\(`, 'g');
  const handed = /\b(?:getWorldPosition|localToWorld)\s*\(\s*((?:this\.)?[A-Za-z_$][\w$]*)/g;
  for (let pass = 0; pass < 12; pass++) {
    let grew = false;
    for (const m of code.matchAll(assign)) {
      const from = m.index! + m[0].length;
      const to = rhsEnd(code, from);
      if (!isCode(code, from, to) && placed(c, from, to, filled)) grew = fill(c, filled, m[1], m.index!) || grew;
    }
    for (const m of code.matchAll(fills)) {
      const open = m.index! + m[0].length - 1;
      if (placed(c, open + 1, closeOf(code, open), filled)) grew = fill(c, filled, m[1], m.index!) || grew;
    }
    for (const m of code.matchAll(handed)) grew = fill(c, filled, m[1], m.index!) || grew;
    if (!grew) break;
  }
  return filled;
}

/** The names that hold a 32-bit array: made as one, or typed as one. */
function f32Names(code: string): Set<string> {
  const out = new Set<string>();
  for (const m of code.matchAll(new RegExp(String.raw`${NAME}\s*(?::[^=;(){}]+)?=\s*(?:new\s+Float32Array\b|Float32Array\.from\b)`, 'g'))) out.add(bare(m[1]));
  for (const m of code.matchAll(new RegExp(String.raw`${NAME}\??\s*:\s*Float32Array\b`, 'g'))) out.add(bare(m[1]));
  return out;
}

const R_NODES = "three's world-space placing nodes";
const R_UNIFORM = 'a uniform made of a world place';
const R_VALUE = 'a uniform set from a world place';
const R_REFERENCE = "a node reading an object's world place by name";
const R_F32 = 'a 32-bit array filled from a world place';
const R_ATTRIBUTE = 'a buffer attribute set from a world place';
const R_INSTANCE = 'an instance placed from a world matrix';
const R_BUFFER = 'a buffer written to the card';
const R_COPY = "a last-frame copy of a uniform (it holds what that uniform holds, filled where the scan does not read)";

/** Every reach of a world place to the card in `text` not allowed, as `file:line: rule: code`, once a line and rule. */
function scan(file: string, text: string): string[] {
  const code = blank(text);
  const lines = code.split('\n');
  const starts: number[] = [0];
  for (let k = 0; k < code.length; k++) if (code[k] === '\n') starts.push(k + 1);
  const lineAt = (at: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= at) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const seen = new Set<string>();
  const faults: string[] = [];
  const fault = (at: number, rule: string): void => {
    const k = lineAt(at);
    const line = lines[k].replace(/\r$/, '');
    if (ALLOW.some((a) => a.file === file && line.includes(a.has))) return;
    const key = `${k}|${rule}`;
    if (seen.has(key)) return;
    seen.add(key);
    faults.push(`${file}:${k + 1}: ${rule}: ${line.trim().slice(0, 160)}`);
  };
  const c = codeOf(code);
  const filled = filledNames(c);
  const f32 = f32Names(code);
  const each = (re: RegExp, then: (m: RegExpMatchArray, end: number) => void): void => {
    for (const m of code.matchAll(re)) then(m, m.index! + m[0].length);
  };
  /** Whether the argument of the call whose bracket opens just before `end` reads a world place. */
  const argPlaced = (end: number): boolean => placed(c, end, closeOf(code, end - 1), filled);
  /** Whether the right-hand side that starts at `from` reads one. */
  const rhsPlaced = (from: number): boolean => placed(c, from, rhsEnd(code, from), filled);
  // 1. three's world-space nodes, line by line.
  lines.forEach((line, k) => {
    if (/\b(positionWorld|modelWorldMatrix|modelPosition|cameraPosition|cameraWorldMatrix|objectPosition|objectWorldMatrix)\b/.test(line)) fault(starts[k], R_NODES);
  });
  // 2. a uniform made of a world place: the call's whole argument.
  each(/\b(?:uniform|uniformArray)\s*\(/g, (m, end) => {
    if (argPlaced(end)) fault(m.index!, R_UNIFORM);
  });
  // A uniform's value set from one, a component at a time or whole, or updated from one by three's callbacks.
  each(new RegExp(String.raw`\.value\s*(?:\.\s*[xyzw]\s*)?(?<![=!<>+\-*/%&|^?])=(?![=>])`, 'g'), (m, end) => {
    if (rhsPlaced(end)) fault(m.index!, R_VALUE);
  });
  each(new RegExp(String.raw`\.value\s*\.\s*(?:${FILLS})\s*\(`, 'g'), (m, end) => {
    if (argPlaced(end)) fault(m.index!, R_VALUE);
  });
  each(/\.on(?:Object|Render|Frame)Update\s*\(/g, (m, end) => {
    if (argPlaced(end)) fault(m.index!, R_VALUE);
  });
  // A reference node reading an object's place or world matrix by its field's name (read from the file's own text).
  each(/\b(?:reference|referenceBuffer|referenceArray|uniformArrayOf)\s*\(/g, (m, end) => {
    const open = end - 1;
    if (/(['"`])(?:position|matrixWorld|worldPos\w*)(?:\.[xyz])?\1/.test(text.slice(open, closeOf(code, open)))) fault(m.index!, R_REFERENCE);
  });
  // A 32-bit array made from one, or filled from one by index, by `set` or by a `toArray` into it.
  each(/\b(?:new\s+Float32Array|Float32Array\.from)\s*\(/g, (m, end) => {
    if (argPlaced(end)) fault(m.index!, R_F32);
  });
  for (const name of f32) {
    const at = String.raw`(?:(?<![\w$.])|(?<=\bthis\.))${escape(name)}`;
    each(new RegExp(String.raw`${at}\s*\[`, 'g'), (m, end) => {
      const close = closeOf(code, end - 1);
      const after = /^\s*(?<![=!<>+\-*/%&|^?])=(?![=>])/.exec(code.slice(close + 1));
      if (after && rhsPlaced(close + 1 + after[0].length)) fault(m.index!, R_F32);
    });
    each(new RegExp(String.raw`${at}\.set\s*\(`, 'g'), (m, end) => {
      if (argPlaced(end)) fault(m.index!, R_F32);
    });
  }
  each(/\.toArray\s*\(/g, (m, end) => {
    const into = /^\s*((?:this\.)?[A-Za-z_$][\w$]*)/.exec(code.slice(end, closeOf(code, end - 1)))?.[1] ?? '';
    if (!into || !(f32.has(bare(into)) || /f32|Float32|array/i.test(into))) return;
    if (placed(c, starts[lineAt(m.index!)], m.index!, filled)) fault(m.index!, R_F32);
  });
  // A buffer attribute (32-bit) set from one.
  each(/\.(?:setXYZW|setXYZ|setXY|setX|setY|setZ|copyArray)\s*\(/g, (m, end) => {
    if (argPlaced(end)) fault(m.index!, R_ATTRIBUTE);
  });
  // An instance placed from a world matrix (or anything filled from a world place).
  each(/\.setMatrixAt\s*\(/g, (m, end) => {
    if (argPlaced(end)) fault(m.index!, R_INSTANCE);
  });
  // Any buffer written to the card.
  each(/\bwriteBuffer\s*\(/g, (m) => fault(m.index!, R_BUFFER));
  // A last-frame copy of a uniform (`motion.ts`'s `previousUniform`), its definition aside: whatever the copied uniform is filled
  // with is filled in another file, so each copy says what it holds.
  each(/\bpreviousUniform\s*\(/g, (m) => {
    if (!/\bfunction\s+$/.test(code.slice(Math.max(0, m.index! - 12), m.index!))) fault(m.index!, R_COPY);
  });
  return faults;
}

/** A file's text with everything outside its parts blanked to spaces (line ends kept), so only the parts are scanned. */
function partsOf(text: string, parts: { from: string; to: string }[]): { text: string; found: boolean } {
  const keep = new Uint8Array(text.length);
  let found = true;
  for (const p of parts) {
    const a = text.indexOf(p.from);
    const b = a < 0 ? -1 : text.indexOf(p.to, a);
    if (a < 0 || b < 0 || text.indexOf(p.from, a + 1) >= 0) {
      found = false;
      continue;
    }
    keep.fill(1, text.lastIndexOf('\n', a) + 1, text.lastIndexOf('\n', b) + 1);
  }
  let out = '';
  for (let k = 0; k < text.length; k++) out += keep[k] || text[k] === '\n' || text[k] === '\r' ? text[k] : ' ';
  return { text: out, found };
}

// ---------------------------------------------------------------- the rules catch what they are for
{
  const planted: [string, string][] = [
    ['const p = positionWorld.sub(anchor);', R_NODES],
    ['material.positionNode = modelWorldMatrix.mul(vec4(positionLocal, 1));', R_NODES],
    ['const eye = cameraPosition;', R_NODES],
    ['const at = objectPosition(mesh);', R_NODES],
    ['const w = objectWorldMatrix(mesh);', R_NODES],
    ['const u = uniform(mesh.matrixWorld);', R_UNIFORM],
    // Found by the review: each was let through by the first cut of the scan.
    ['const a1 = uniform(new Vector3().setFromMatrixPosition(mesh.matrixWorld));', R_UNIFORM],
    ['const a2 = uniform(camera.position);', R_UNIFORM],
    ['uB.value.copy(camera.position);', R_VALUE],
    ['const a3 = new Float32Array(3); mesh.getWorldPosition(v); a3[0] = v.x;', R_F32],
    ['const a5 = uniform(vec3(eye.x, eye.y, eye.z));', R_UNIFORM],
    // The same reaches across lines, through names the file filled, and through three's other ways in.
    ['const a6 = uniform(\n  new Vector3(\n    mesh.matrixWorld.elements[12], 0, 0,\n  ),\n);', R_UNIFORM],
    ['const eyeAt = camera.position;\nconst u2 = uniform(vec3(eyeAt.x, 0, 0));', R_UNIFORM],
    ['const at = new Vector3();\nbody.getWorldPosition(at);\nuAt.value.copy(at);', R_VALUE],
    ['uAt.value.copy(body.getWorldPosition(tmp));', R_VALUE],
    ['uAt.value = obj.matrixWorld;', R_VALUE],
    ['uLight.value.copy(light.position);', R_VALUE],
    ['uAt.value.x = camera.position.x;', R_VALUE],
    ['const u3 = uniform(new Vector3()).onRenderUpdate(({ camera }) => camera.position);', R_VALUE],
    ['const u4 = uniform(new Matrix4()).onObjectUpdate(({ object }) => object.matrixWorld);', R_VALUE],
    ["const r = reference('position', 'vec3', camera);", R_REFERENCE],
    ['const r2 = reference("matrixWorld", "mat4", mesh);', R_REFERENCE],
    ['const a = new Float32Array(mesh.matrixWorld.elements);', R_F32],
    ['mesh.matrixWorld.toArray(f32, 0);', R_F32],
    ['private readonly places = new Float32Array(48);\nfill(o) {\n  this.places.set([o.position.x, o.position.y, o.position.z], 3);\n}', R_F32],
    ['function put(out: Float32Array, o) {\n  const at = o.getWorldPosition(tmp);\n  out[0] = at.x;\n}', R_F32],
    ['attr.setXYZ(i, camera.position.x, camera.position.y, camera.position.z);', R_ATTRIBUTE],
    ['inst.setMatrixAt(i, o.matrixWorld);', R_INSTANCE],
    ['m.compose(body.position, q, s);\ninst.setMatrixAt(i, m);', R_INSTANCE],
    ['const tmp = new Vector3();\nfunction put(o) {\n  tmp.copy(o.position);\n  uAt.value.copy(tmp);\n}', R_VALUE],
    ['class K {\n  private at = new Vector3();\n  read(o) {\n    this.at.copy(o.position);\n  }\n  write() {\n    this.uAt.value.copy(this.at);\n  }\n}', R_VALUE],
    ['device.queue.writeBuffer(buf, 0, data);', R_BUFFER],
    ['const eyeLast = previousUniform(u.uHorizonEye);', R_COPY],
  ];
  for (const [code, rule] of planted) {
    const got = scan('planted.ts', code);
    ok(got.some((g) => g.includes(`: ${rule}: `)), `the rule '${rule}' catches planted code: ${code.replace(/\n\s*/g, ' ')} (${got.join('; ') || 'nothing caught'})`);
  }
  const fine = [
    '// positionWorld in a comment is no placing',
    "const word = 'cameraPosition, modelWorldMatrix and writeBuffer( in a string are words';",
    'const d = positionWorldDirection;',
    'const v = positionView.sub(anchorView);',
    'uAnchor.value.set(ax - cx, ay - cy, az - cz);',
    '/* a block\n   with positionWorld */ const ok = 1;',
    'const u = uniform(new Vector3());',
    'const t = uniform(0);',
    'uTime.value = now * 0.001;',
    'uTint.value.copy(colour);',
    'const pos = new Float32Array(geo.attributes.position.array);',
    "const op = reference('opacity', 'float', material);",
    'mesh.position.set(0, 1, 0);',
    'const rel = new Vector3();\nrel.set(ax - cx, ay - cy, az - cz);\nuRel.value.copy(rel);',
    'const f = new Float32Array(16);\nf[0] = scale;\nlocal.toArray(f, 0);',
    'if (a.value === b.value) return;',
    'const same = (x) => x.value <= 1;',
    // A short name filled from a place in one function is not taken for a place in another, and a function is no place.
    'function a(o) {\n  const p = o.position;\n  return p.x;\n}\nfunction b() {\n  const p = 1;\n  uScale.value = p;\n}',
    'const near = (o) => o.position.x < 10;\nuNear.value = near;',
    // The copy's own definition is no copy.
    'export function previousUniform(src: { value: Any }): Any {\n  return uniform(kept(src)).setGroup(renderGroup);\n}',
  ];
  for (const code of fine) ok(scan('fine.ts', code).length === 0, `code within the rule is let through: ${code.replace(/\n\s*/g, ' ')} (${scan('fine.ts', code).join('; ')})`);
  ok(codeLines('a /* x\n y */ b\nc').length === 3 && blank("x = 'abc'; // d").length === "x = 'abc'; // d".length, "blanking keeps the file's line numbers and every offset in it");
  // An allowed line is let through, and only that line.
  ALLOW.push({ file: 'allowed.ts', has: 'uSun.value.copy(sun.position)', why: 'a planted line, to show an allowed reach is let through' });
  const allowed = scan('allowed.ts', 'uSun.value.copy(sun.position);\nuMoon.value.copy(moon.position);');
  ALLOW.pop();
  ok(allowed.length === 1 && allowed[0].startsWith('allowed.ts:2:'), `an allowed line is let through and the next is not (${allowed.join('; ')})`);
  // A part of a base file is scanned, and the rest of that file is not; its line numbers are the file's own.
  const base = 'uOld.value.copy(camera.position);\n// pass 1 from here\nuNew.value.copy(camera.position);\n// pass 1 to here\nuOld2.value.copy(camera.position);';
  const part = partsOf(base, [{ from: '// pass 1 from here', to: '// pass 1 to here' }]);
  const inPart = scan('base.ts', part.text);
  ok(part.found && inPart.length === 1 && inPart[0].startsWith('base.ts:3:'), `a base file's part is scanned and the rest is not (${inPart.join('; ')})`);
  ok(!partsOf(base, [{ from: '// not there', to: '// pass 1 to here' }]).found, "a part whose first line is not in the file is said so");
}

// ---------------------------------------------------------------- the subjects: pass 1's GPU files
const gpuDir = join(ROOT, 'src', 'core', 'gpu');
const added = readdirSync(gpuDir)
  .filter((f) => /\.tsx?$/.test(f) && !BASE_GPU.has(f))
  .map((f) => `src/core/gpu/${f}`);
const subjects = [...new Set([...PASS1_FILES, ...added])].sort();
for (const f of WAVE1) ok(subjects.includes(f), `wave 1's ${f} is a subject of the scan`);
for (const f of PASS1_FILES) ok(existsSync(join(ROOT, f)), `${f} named in PASS1_FILES is there`);
const faults = subjects.flatMap((f) => scan(f, readFileSync(join(ROOT, f), 'utf8')));
// And what pass 1 added to the base's own files, part by part.
const partFiles = [...new Set(PASS1_PARTS.map((p) => p.file))];
for (const f of partFiles) {
  const got = partsOf(readFileSync(join(ROOT, f), 'utf8'), PASS1_PARTS.filter((p) => p.file === f));
  ok(got.found, `${f}: every part pass 1 added is found by its first and last lines`);
  faults.push(...scan(f, got.text));
}
ok(faults.length === 0, `no GPU file of pass 1 on, nor what pass 1 added to the base's, places a thing from the world's middle in a 32-bit value on the card:\n  ${faults.join('\n  ')}`);
for (const a of ALLOW) ok((subjects.includes(a.file) || partFiles.includes(a.file)) && a.why.length > 20, `the allowed line in ${a.file} is in a subject and says why`);
// Each allowed line is still there to be allowed (a line moved away leaves no reason standing for nothing).
for (const a of ALLOW) {
  const t = readFileSync(join(ROOT, a.file), 'utf8');
  const scanned = partFiles.includes(a.file) && !subjects.includes(a.file) ? partsOf(t, PASS1_PARTS.filter((p) => p.file === a.file)).text : t;
  ok(blank(scanned).includes(a.has), `the allowed line in ${a.file} (${a.has}) is in what is scanned`);
}

console.log(`anchorScan: ${checks} checks passed (${subjects.length} files scanned: ${subjects.join(', ')}; and ${PASS1_PARTS.length} parts of ${partFiles.join(', ')})`);
