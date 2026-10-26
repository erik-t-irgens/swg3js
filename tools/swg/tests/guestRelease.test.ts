// A world's guest packs (the gallery's houses, a world's copy of the props pack) are let go through one hand,
// `World.releaseGuest`, which takes their materials out of the portal renderer's set and the cascades' map before
// it disposes the pack: both hold what they are given strongly, and a dispose alone left a pack's worth of
// materials in the set walked a dozen times a frame with every world visited.
//
// `world.ts` and `main.ts` do not load under node, and every hand-over here is one only the game makes, so each
// is pinned as text: the forgetting before the dispose, the houses' pack and the props pack both going through
// it, and nothing else disposing either.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const world = read('src/world/world.ts');
const main = read('src/main.ts');
const catalogue = read('src/world/propCatalogue.ts');

/** The body of a method, from its signature to the first line that closes it at its own indent. */
function body(src: string, signature: string): string {
  const at = src.indexOf(signature);
  assert.ok(at >= 0, `found ${signature}`);
  const end = src.indexOf('\n  }\n', at);
  return src.slice(at, end);
}

{
  const release = body(world, '  releaseGuest(pack: AssetPack | null | undefined): void {');
  const forget = release.indexOf('this.forgetMaterials(pack.loadedMaterials())');
  const dispose = release.indexOf('pack.dispose()');
  ok(forget > 0 && dispose > forget, 'releaseGuest forgets every material the pack loaded, then disposes it');
  ok(/if \(!pack \|\| pack === this\.pack\) return;/.test(release), 'and never touches the world\'s own pack, which unload lets go itself');
}

{
  ok(world.includes('this.housePack?.then((p) => this.releaseGuest(p))'), 'the houses\' pack goes through it at the world\'s unload');
  ok(!/housePack\?\.then\(\(p\) => p\?\.dispose\(\)\)/.test(world), 'and is no longer disposed on its own');
}

{
  const release = body(catalogue, '  release(releaseGuest: (pack: AssetPack) => void): void {');
  ok(release.includes('if (this.assets) releaseGuest(this.assets);'), 'the props catalogue hands its world copy to the hand it is given');
  ok(!release.includes('.dispose()'), 'and disposes nothing itself');
  ok(main.includes('this.props.release((p) => this.world.releaseGuest(p));'), 'and the game hands it the world\'s releaseGuest');
  ok(!/this\.props\.release\(\)/.test(main), 'with no call left that would dispose it alone');
}

console.log(`\n${checks} checks passed`);
