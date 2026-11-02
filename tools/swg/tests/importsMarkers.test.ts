// The import pass's three markers (Map-maker II's tenth wave) are an import's alone: `extras.swgColliderOnly` (a piece the
// streamer collides and never draws), `extras.swgNoCollide` (one it draws and never collides) and `extras.swgNormalY` (a normal
// map read the glTF way, turning the world's override round). Every reader of them (`AssetPack.model`, the streamer's
// colliders, the walk grid's bake, the library's picture, the world's normal scale) takes a model without them exactly as it
// took it before, so the guard is that no converted pack on disk carries any of them: every GLB under SWG3JS_PACKS (else
// assets-private), its JSON chunk read from the head of the file alone. A machine with no packs says so and checks the rule
// on a GLB of its own.
//
// Run: node tools/swg/tests/importsMarkers.test.ts
import assert from 'node:assert/strict';
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb } from '../sceneglb.mjs';
import { IMPORT_TUNE, importModel } from '../imports.mjs';
import { cube, writeRawGlb } from './blenderGlb.ts';

let checks = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
}
const note = (what: string) => console.log(`note ${what}`);

const PACKS = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private/', import.meta.url));
const MARKERS = ['swgColliderOnly', 'swgNoCollide', 'swgNormalY'];

/** A GLB's JSON chunk as text, read from the head of the file alone; null for a file that is not one. */
function jsonText(file: string): string | null {
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(20);
    if (readSync(fd, head, 0, 20, 0) < 20 || head.readUInt32LE(0) !== 0x46546c67) return null;
    const len = head.readUInt32LE(12);
    const body = Buffer.alloc(len);
    readSync(fd, body, 0, len, 20);
    return body.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/** The markers a GLB's JSON text names, by the rule the scan uses: the key quoted, as a JSON writer writes it. */
const markersIn = (text: string): string[] => MARKERS.filter((m) => text.includes(`"${m}"`));

{
  // The rule itself, on a GLB the pass makes: all three found where they are, none on a plain one.
  const glb = writeRawGlb({
    materials: [{ name: 'Plain', pbrMetallicRoughness: { metallicFactor: 0 }, normalTexture: { index: 0 } }],
    meshes: [{ name: 'Cube', primitives: [cube(0)] }, { name: 'Stand', primitives: [cube(0)] }, { name: 'Sign', primitives: [cube(0)] }],
    nodes: [{ name: 'Body', mesh: 0 }, { name: 'Body-colonly', mesh: 1 }, { name: 'Sign-nocol', mesh: 2, translation: [0, 3, 0] }],
    textures: [{ source: 0, sampler: 0 }],
    images: [{ name: 'n', png: Buffer.from('89504e470d0a1a0a', 'hex') }],
  });
  const made = importModel({ json: readGlb(glb).json, buffers: [readGlb(glb).bin], uriBytes: () => Buffer.alloc(0), file: 'mine.glb' }, { id: 'test_markers', kind: 'prop', collision: 'triangles', look: 'pbr', ship: false }, IMPORT_TUNE);
  assert.ok(!made.refuse, String(made.refuse));
  const text = JSON.stringify(readGlb(made.glb).json);
  ok(markersIn(text).join() === MARKERS.join(), `the scan finds all three on a GLB the pass made (${markersIn(text).join(', ')})`);
  ok(markersIn(JSON.stringify(readGlb(glb).json)).length === 0, 'and none on the source it was made from');
}

{
  const glbs: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (e.endsWith('.glb')) glbs.push(p);
    }
  };
  if (existsSync(PACKS)) walk(PACKS);
  if (!glbs.length) note(`no GLB under ${PACKS}: the packs' check is skipped`);
  else {
    const found: string[] = [];
    for (const f of glbs) {
      const t = jsonText(f);
      if (!t) continue;
      const m = markersIn(t);
      if (m.length) found.push(`${f.slice(PACKS.length)} (${m.join(', ')})`);
    }
    ok(found.length === 0, `no converted pack's GLB carries an import's marker, over ${glbs.length} GLBs${found.length ? `; these do: ${found.slice(0, 8).join('; ')}` : ''}`);
  }
}

console.log(`\nimportsMarkers: ${checks} checks passed`);
