// The backend the game's context runs on, read once at boot off its renderer string (`backendOf`, the first wave's
// reading made a function), over the strings the performance pass's researchers recorded on the owner's machine and a
// masked one; the one sentence the message line says of a backend (a software rasteriser alone), said once at the
// first world; and the console's explanation of the one driver message some Vulkan machines print at start-up, which is
// the browser's own readback and not the game's (the performance pass's fifth wave).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backendLine, backendOf, readbackNote, type Backend } from '../../../src/core/shaderWatch.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---- the renderer strings, as `UNMASKED_RENDERER_WEBGL` gave them ----
const strings: [string, Backend, string][] = [
  ['ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'd3d11', "Chrome's default on Windows, Direct3D 11 (the owner's card)"],
  ['ANGLE (NVIDIA, Vulkan 1.4.351 (NVIDIA NVIDIA GeForce RTX 5080 (0x00002C02)), NVIDIA-617.14.0.0)', 'vulkan', "Chrome started with --use-angle=vulkan (the owner's own)"],
  ['ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 5080/PCIe/SSE2, OpenGL 4.5.0 NVIDIA 617.14)', 'gl', 'ANGLE over desktop OpenGL'],
  ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'software', 'SwiftShader, which runs on Vulkan and is still software'],
  ['ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'software', "Windows' own Basic Render driver, which says Direct3D 11 and is software"],
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', 'metal', 'ANGLE on Metal (a Mac)'],
  ['llvmpipe (LLVM 15.0.7, 256 bits)', 'software', "Mesa's llvmpipe"],
  ['WebKit WebGL', 'unknown', 'a masked renderer (no debug-renderer extension): unknown, never mistaken for OpenGL'],
  ['Mozilla', 'unknown', "a browser that says only its own name"],
];
for (const [s, want, what] of strings) ok(backendOf(s) === want, `${what}: ${want}`);
ok(backendOf('') === 'unknown' && backendOf(null) === 'unknown' && backendOf(undefined) === 'unknown', 'nothing to read is unknown');

// ---- what is said of it ----
const all: Backend[] = ['d3d11', 'vulkan', 'gl', 'metal', 'software', 'unknown'];
ok(all.filter((b) => backendLine(b) !== null).join() === 'software', 'the message line says something of a software rasteriser and of no other backend');
ok(/without the graphics card/.test(backendLine('software') ?? '') && /acceleration/.test(backendLine('software') ?? ''), 'and says the browser is drawing without the graphics card, and what to turn on');
ok(all.filter((b) => readbackNote(b) !== null).join() === 'vulkan', 'the readback note is said on Vulkan alone, the backend whose start-up prints the driver message');
ok(/GPU stall due to ReadPixels/.test(readbackNote('vulkan') ?? '') && /not the game's/.test(readbackNote('vulkan') ?? '') && /reads no pixels/.test(readbackNote('vulkan') ?? ''), "and names the message, whose it is, and that the game reads no pixels");

// ---- the wiring, read as text (the app does not load under node) ----
{
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const read = main.indexOf('this.backend = backendOf(');
  const note = main.indexOf('const readback = readbackNote(this.backend);');
  ok(read > 0 && note > read && /if \(readback\) console\.info\(readback\);/.test(main.slice(note, note + 120)), 'the boot reads the backend once and puts the readback note on the console straight after');
  const arrive = main.slice(main.indexOf('  private arrive('), main.indexOf('  private travelStanding'));
  ok(/if \(!this\.backendSaid\) \{\s*this\.backendSaid = true;\s*const line = backendLine\(this\.backend\);\s*if \(line\) this\.messages\.system\(line\);\s*\}/.test(arrive), 'and an arrival says the backend line on the message line once a session');
  ok((main.match(/this\.backendSaid = true;/g) ?? []).length === 1, 'nowhere else');
}

console.log(`\n${checks} checks passed`);
