// Re-rooting a file named relative to one pack so the effects loader, which resolves against the world's
// own pack, finds it.
//
// Run: node tools/swg/tests/packPath.test.ts

import assert from 'node:assert/strict';
import { relativeRoot } from '../../../src/world/packPath.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

ok(relativeRoot('/assets-private/tatooine/', '/assets-private/gallery/') === '../gallery/', "the gallery standing behind a world is one folder over, which is where its garden fountains' spray is");
ok(relativeRoot('/assets-private/tatooine/', '/assets-private/props/') === '../props/', 'and so is the props pack, which is how the props command writes its own effects already');
ok(relativeRoot('/assets-private/naboo/', '/assets-private/naboo/') === '', 'a pack is no distance from itself, so a world\'s own effects are left exactly as they are');
ok(relativeRoot('/base/assets-private/space_tatooine/', '/base/assets-private/gallery/') === '../gallery/', 'a base path in front of both changes nothing');
ok(relativeRoot('http://127.0.0.1:47031/game/assets-private/tatooine/', 'http://127.0.0.1:47031/game/assets-private/props/') === '../props/', "and neither does a whole address, which is how the launcher's page serves the packs");
ok(`${relativeRoot('/assets-private/tatooine/', '/assets-private/gallery/')}particles/fx_pt_fountain_garden.json` === '../gallery/particles/fx_pt_fountain_garden.json', 'so the fountain names a file the loader can fetch from the world it is standing in');

console.log(`\npack paths: ${passed} checks passed`);
