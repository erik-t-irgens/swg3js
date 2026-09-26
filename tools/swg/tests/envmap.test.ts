// The reflections registry: where reflections come from, and that a material leaves when it is disposed.
//
// Run: node tools/swg/tests/envmap.test.ts

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { REFLECTIONS, currentEnvironment, reflectiveCount, registerReflective, setEnvironment, setReflectionSource } from '../../../src/world/envmap.ts';

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

console.log(`\nenvmap: ${passed} checks passed`);
