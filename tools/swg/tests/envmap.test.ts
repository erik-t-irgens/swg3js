// The reflections registry: where reflections come from, and that a material leaves when it is disposed.
//
// Run: node tools/swg/tests/envmap.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { REFLECTIONS, currentEnvironment, plainReflectiveCount, reflectiveCount, registerReflective, setEnvironment, setPlainReflections, setReflectionSource } from '../../../src/world/envmap.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

{
  ok(REFLECTIONS.source === 'sky', "the default is our own sky, not the planet's cube maps out of the client's files");
  setReflectionSource('game');
  ok(REFLECTIONS.source === 'game', 'and the old way can be put back');
  setReflectionSource('sky');
  ok(REFLECTIONS.source === 'sky', 'and taken away again');
}

{
  const before = reflectiveCount();
  const m = new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.2 });
  m.envMapIntensity = 0.55;
  registerReflective(m);
  registerReflective(m);
  ok(reflectiveCount() === before + 1, 'a material registered twice is registered once');
  const tex = new THREE.Texture();
  setEnvironment(tex, 1);
  ok(m.envMap === tex && m.envMapIntensity === 0.55 && currentEnvironment().texture === tex, 'a new environment reaches it, and it keeps its own strength');
  const next = new THREE.Texture();
  setEnvironment(next, 1);
  ok(m.envMap === next, 'and the next one replaces it, which is what lets the last one be freed');
  m.dispose();
  ok(reflectiveCount() === before, 'a disposed material leaves the registry by itself, so a world left behind is not refreshed for ever');
  setEnvironment(new THREE.Texture(), 1);
  ok(m.envMap === next, 'and nothing is written to it afterwards');
  setEnvironment(null);
}

// A surface whose shader has no reflection cube (material format 6's `swgCube: false`) takes none of the
// environment by default: in three 0.185 the map also lights that material's diffuse, so it was a faint mirror
// and a sky-coloured fill its matt neighbours lacked, and the client gave it neither.
{
  ok(REFLECTIONS.plain === 0, 'by default a surface with no reflection cube takes none of the environment');
  const plain = new THREE.MeshStandardMaterial({ roughness: 0.4 });
  plain.envMapIntensity = 0.8;
  plain.userData.swgCube = false;
  const chrome = new THREE.MeshStandardMaterial({ metalness: 1 });
  chrome.userData.swgCube = true;
  const older = new THREE.MeshStandardMaterial({ metalness: 1 });
  registerReflective(plain);
  registerReflective(chrome);
  registerReflective(older);
  const tex = new THREE.Texture();
  setEnvironment(tex, 0.5);
  ok(plain.envMap === tex && plain.envMapIntensity === 0, 'it stays registered and keeps the map, so its program is the one it had, at nought');
  ok(chrome.envMapIntensity === 0.5 && older.envMapIntensity === 0.5, 'chrome, and a material from a pack converted before format 6, reflect as they did');
  ok(plainReflectiveCount() >= 1, `the console can count them (${plainReflectiveCount()})`);
  const versionBefore = plain.version;
  ok(setPlainReflections(1) >= 1 && plain.envMapIntensity === 0.4 && chrome.envMapIntensity === 0.5, 'plain 1 puts back what they had before, its own strength times the scale');
  ok(plain.version === versionBefore, 'and the change is a uniform: nothing asks for the program again');
  setPlainReflections(Number.NaN);
  ok(REFLECTIONS.plain === 1, 'a share that is not a number is ignored');
  setPlainReflections(0);
  const late = new THREE.MeshStandardMaterial({ roughness: 0.3 });
  late.userData.swgCube = false;
  registerReflective(late);
  ok(late.envMap === tex && late.envMapIntensity === 0, 'a plain surface registered after the environment arrived takes the share in force');
  for (const m of [plain, chrome, older, late]) m.dispose();
  setEnvironment(null);
}

// An interior cell's own copy of a material (`AssetPack.model`) is made after the original is registered, and
// once an environment is in force the original's field holds what the registry wrote into it: nought on a plain
// surface, the scale times its own elsewhere. The copy takes the original's own strength, not that.
{
  const tex = new THREE.Texture();
  setEnvironment(tex, 0.5);
  const wall = new THREE.MeshStandardMaterial({ roughness: 0.4 });
  wall.envMapIntensity = 0.8;
  wall.userData.swgCube = false;
  const rail = new THREE.MeshStandardMaterial({ metalness: 1 });
  rail.envMapIntensity = 0.6;
  rail.userData.swgCube = true;
  registerReflective(wall);
  registerReflective(rail);
  const wallCopy = wall.clone();
  const railCopy = rail.clone();
  ok(wallCopy.envMapIntensity === 0 && railCopy.envMapIntensity === 0.3, 'a copy made then carries what the registry wrote into its original (the trap)');
  registerReflective(wallCopy, wall);
  registerReflective(railCopy, rail);
  ok(railCopy.envMapIntensity === 0.3 && rail.envMapIntensity === 0.3, "a mirroring copy registered with its original's strength is the original's, not the scale taken twice");
  setPlainReflections(1);
  ok(wall.envMapIntensity === 0.4 && wallCopy.envMapIntensity === 0.4, 'and plain 1 brings back the old look on a room\'s own copy of a plain wall as on the wall itself');
  setPlainReflections(0);
  ok(wall.envMapIntensity === 0 && wallCopy.envMapIntensity === 0, 'and plain 0 takes it off both again');
  const stray = new THREE.MeshStandardMaterial({ metalness: 1 });
  stray.envMapIntensity = 0.7;
  const strayCopy = stray.clone();
  registerReflective(strayCopy, stray);
  ok(strayCopy.envMapIntensity === 0.35, 'a copy of a material that was never registered keeps its own field, which nothing has written');
  for (const m of [wall, rail, wallCopy, railCopy, stray, strayCopy]) m.dispose();
  setEnvironment(null);
  const pack = readFileSync(new URL('../../../src/world/assetPack.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  ok(/const original = m;\s*m = m\.clone\(\);[\s\S]{0,700}?registerReflective\(m, original as THREE\.MeshStandardMaterial\);/.test(pack), "and the pack registers each interior cell's copy with the material it was copied from");
}

console.log(`\nenvmap: ${passed} checks passed`);
