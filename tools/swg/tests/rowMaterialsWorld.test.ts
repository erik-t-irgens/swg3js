// The rows' looks as the world keeps them (Map-maker II's seventh wave): the world's `RowMaterials` keeps a copy no one
// holds as a spare and, at the world's going, hands it to `forgetMaterials` before it disposes it, never a texture; the
// attachments' host names an effect's file by the pure rule and places and sizes it with its size; a copy of a material the sky's reflection
// registry holds joins it with its source's own strength (`registerReflective(copy, source)`), and leaves it when
// disposed; and the world lets the attachments go while its particles stand and the copies after its streamer let go of
// its tiers (the order pinned as text in `world.ts`, which node cannot load).
//
// Run: node tools/swg/tests/rowMaterialsWorld.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { RowMaterials } from '../../../src/world/rowMaterials.ts';
import { attachFileOf } from '../../../src/world/rowAttach.ts';
import { isRegisteredReflective, registerReflective } from '../../../src/world/envmap.ts';

const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---- The world's own wiring, as the world makes it (the very two callbacks, from its text). ----
const world = readFileSync(join(REPO, 'src', 'world', 'world.ts'), 'utf8').replace(/\r\n/g, '\n');
ok(/readonly rowLooks = new RowMaterials\(\{\s*forget: \(materials\) => this\.forgetMaterials\(materials\),\s*onCopy: \(copy, source\) => \{\s*if \(isRegisteredReflective\(source\)\) registerReflective\(copy as THREE\.MeshStandardMaterial, source as THREE\.MeshStandardMaterial\);\s*\},\s*\}\);/.test(world), "the world's looks forget a copy through `forgetMaterials`, and register a copy of a reflective material with its source");

// ---- The same, run: a reflective source's copy registered with its strength, forgotten before disposed. ----
{
  const order: string[] = [];
  const looks = new RowMaterials({
    forget: (ms) => {
      for (const m of ms) order.push(`forget ${m.name}`);
    },
    onCopy: (copy, source) => {
      if (isRegisteredReflective(source)) registerReflective(copy as THREE.MeshStandardMaterial, source as THREE.MeshStandardMaterial);
    },
  });
  const chrome = new THREE.MeshStandardMaterial({ metalness: 1 });
  chrome.name = 'chrome';
  chrome.map = new THREE.Texture();
  let textureDisposed = 0;
  chrome.map.addEventListener('dispose', () => textureDisposed++);
  registerReflective(chrome);
  const strength = chrome.userData.swgEnvBase;
  const owner = {};
  const geo = new THREE.BufferGeometry();
  const copy = looks.wear(owner, chrome, [{ of: '*', tint: '#3060a0' }], geo, () => null) as THREE.MeshStandardMaterial;
  copy.addEventListener('dispose', () => order.push(`dispose ${copy.name}`));
  ok(copy !== chrome && isRegisteredReflective(copy) && copy.userData.swgEnvBase === strength, `a copy of a reflective material is registered with its source's own strength (${strength})`);
  const plain = new THREE.MeshStandardMaterial();
  plain.name = 'plain';
  const plainCopy = looks.wear(owner, plain, [{ of: '*', tint: '#3060a0' }], geo, () => null);
  ok(!isRegisteredReflective(plainCopy), 'a copy of one that is not registered is not');
  looks.release(owner);
  ok(!order.length && looks.spares === 2 && isRegisteredReflective(copy), `let go by its last row, kept for the world as a spare, still registered: a tier coming back wears it with no program built (${order.join(', ')})`);
  // The world going (`World.unload` calls `clear`): forgotten first, then disposed.
  looks.clear();
  ok(order.indexOf('forget chrome') >= 0 && order.indexOf('forget chrome') < order.indexOf('dispose chrome'), `at the world's going, forgotten by the world first and then disposed (${order.join(', ')})`);
  ok(!isRegisteredReflective(copy), 'and disposed it leaves the reflection registry');
  ok(textureDisposed === 0 && isRegisteredReflective(chrome), 'its picture and its source untouched');
}

// ---- The attachments' host, as the world makes it: its file named by the pure rule, its effect placed and sized. ----
ok(world.includes('fileOf: (ref) => attachFileOf(ref, this.particlesRoot, import.meta.env.BASE_URL),'), "the world names an attachment's effect file by `attachFileOf`, against its own particles' folder");
ok(world.includes('place: (file, m, contained, size) => this.particles?.place(file, m, contained, false, null, false, { size }) ?? null,'), "and places it with the attachment's size, which the particles multiply into every emitter");
ok(world.includes('resize: (h, size) => this.particles?.resize(h, size.v),'), "and sizes one standing again in place (C held on its handle), never placing it again, the size read out of the holder's kept record");
{
  const root = '/assets-private/tatooine/';
  ok(attachFileOf('tatooine:particles/fire.json', root, '/') === 'particles/fire.json', "an effect of the world's own pack is read by its own path");
  ok(attachFileOf('props:particles/smoke.json', root, '/') === '../props/particles/smoke.json', "one of another pack is read out of that pack's folder, never copied");
  ok(attachFileOf('props:particles/smoke.json', '/swg/assets-private/naboo/', '/swg/') === '../props/particles/smoke.json' && attachFileOf('nopack.json', root, '/') === null && attachFileOf('props:x.json', null, '/') === null, 'under a page root of its own too; and nothing for a name with no pack, or with no world to read it from');
}

// ---- The unload's order. ----
ok(/this\.rowAttach\.clear\(\);\s*this\.layoutStream\?\.dispose\(\);\s*this\.layoutStream = null;[\s\S]{0,800}?this\.rowLooks\.clear\(\);/.test(world), "an unload lets the attachments go while the particles stand, then the streamer (releasing its tiers' copies), then whatever copies are left");
ok((world.match(/this\.rowAttach\.clear\(\);/g) ?? []).length >= 3, 'and a new world (both of the streamer\'s makings) starts with no attachment of the last');

console.log(`\nrowMaterialsWorld: ${checks} checks passed`);
