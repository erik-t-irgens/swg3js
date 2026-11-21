// The people's loads at once behind a loading screen (the GPU port's pass 1, wave 8, cut 4), on the asset cache itself
// (src/world/mobiles/assets.ts): `MOBILE_CACHE.concurrency` loads under way in play, `screenConcurrency` from the moment a
// screen comes up (`screenLoads(true)`, the loads already waiting let go at once) to the moment it begins to go
// (`screenLoads(false)`: nothing new starts until fewer than `concurrency` are under way, and nothing under way is stopped),
// the loads still starting in the order they were asked, and a number raised live (`wakeLoads`, the console's knob) letting
// the waiting ones go. Then the wiring only the game makes, held as text: the screen tells the loads as it comes up and as
// it begins to go, the game hands it `screenLoads`, and `__debug.mobileTune({ screenConcurrency })` moves the number.
//
// The cache is driven for real, from `acquireModel` through `loadLook` and its slot; only the parts character underneath is
// a stand-in (served in place of `character.ts` by a resolve hook, as lookBudget.test.ts does), which records each build as
// it starts and holds it until the test lets it finish.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import * as THREE from 'three';

const charStub = 'export class Character { static load(...a) { return globalThis.__characterLoad(...a); } }';
const hook = `export async function resolve(s, c, next) {
  if (s.endsWith('/player/character.ts') || s.endsWith('/player/character')) {
    return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(charStub)}), shortCircuit: true };
  }
  return next(s, c);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { MobileAssets, MOBILE_CACHE, screenLoads, wakeLoads, loadsBehindScreen } = await import('../../../src/world/mobiles/assets.ts');
type MobileEntry = import('../../../src/world/mobiles/types.ts').MobileEntry;
type MobileCatalogue = import('../../../src/world/mobiles/catalogue.ts').MobileCatalogue;

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

// ------------------------------------------------------------------ the stand-in body, held until let go
/** Every build begun, in order, each with the hand that lets it finish. */
const begun: { id: string; finish: () => void }[] = [];
let underWay = 0;
let most = 0;
(globalThis as unknown as { __characterLoad: unknown }).__characterLoad = async (_base: string, id: string) => {
  underWay++;
  most = Math.max(most, underWay);
  await new Promise<void>((finish) => begun.push({ id, finish }));
  underWay--;
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial()));
  return { group: root, customizer: null, setMorph() {}, async wearItemFrom() { return true; }, lookSources: () => null };
};
// Each its own parts body (an appearance of its own folder), so no look waits on another's.
const cat = { modelFile: () => null, appearanceOf: (e: { id: string }) => ({ form: 'parts', file: `characters/${e.id}/parts.json` }), packOf: () => null } as unknown as MobileCatalogue;
const entry = (id: string): MobileEntry => ({ id, name: id, kind: 'npc', appearance: id }) as unknown as MobileEntry;
const assets = MobileAssets.for('test://screenLoads/');
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};
/** Let the oldest build still held finish. */
const finishOne = async (): Promise<void> => {
  const b = begun.find((x) => !(x as { done?: boolean }).done) as { id: string; finish: () => void; done?: boolean };
  b.done = true;
  b.finish();
  await settle();
};
const loads: Promise<unknown>[] = [];
const ask = (ids: string[]): void => {
  for (const id of ids) loads.push(assets.acquireModel(MobileAssets.modelKey(entry(id), cat)!, { hologram: false, look: { entry: entry(id), cat } }).catch(() => null));
};

ok(MOBILE_CACHE.concurrency === 2 && MOBILE_CACHE.screenConcurrency === 6, `two loads at once in play and six behind a screen (${MOBILE_CACHE.concurrency}, ${MOBILE_CACHE.screenConcurrency})`);
ok(loadsBehindScreen() === false, 'no screen is up to begin with');

// ------------------------------------------------------------------ in play: two at once
const ids = Array.from({ length: 14 }, (_, i) => `look${String(i).padStart(2, '0')}`);
ask(ids);
await settle();
ok(begun.length === 2 && underWay === 2, `in play two of fourteen begin (${begun.length})`);

// ------------------------------------------------------------------ a screen comes up: the waiting ones go at once
screenLoads(true);
await settle();
ok(loadsBehindScreen() && begun.length === 6 && underWay === 6 && most === 6, `a screen up lets the waiting loads take its six slots at once (${begun.length} begun, ${underWay} under way)`);
await finishOne();
ok(begun.length === 7 && underWay === 6, 'behind the screen a load finished hands its slot to the next at once');

// ------------------------------------------------------------------ the screen begins to go: back to two, nothing stopped
screenLoads(false);
await settle();
ok(!loadsBehindScreen() && underWay === 6 && begun.length === 7, 'the screen going stops nothing under way and starts nothing new');
for (let i = 0; i < 4; i++) await finishOne();
ok(underWay === 2 && begun.length === 7, `four finished leave two under way and none begun in their place (${underWay}, ${begun.length})`);
await finishOne();
ok(underWay === 2 && begun.length === 8, 'with fewer than two under way the next begins, so play keeps two');
ok(most === 6, `never more than six at once (${most})`);

// ------------------------------------------------------------------ a number raised live
MOBILE_CACHE.concurrency = 3;
wakeLoads();
await settle();
ok(underWay === 3 && begun.length === 9, 'the number in play raised live lets one more go at once (the console\'s knob wakes the loads)');
MOBILE_CACHE.concurrency = 2;

// ------------------------------------------------------------------ the order they were asked in
while (begun.some((b) => !(b as { done?: boolean }).done)) await finishOne();
await Promise.all(loads);
ok(begun.map((b) => b.id).join(',') === ids.join(','), 'every load began, in the order they were asked, across the screen coming and going');
ok(underWay === 0 && assets.underWay === 0, 'and nothing is left under way');

// ------------------------------------------------------------------ the old way, for comparing
{
  MOBILE_CACHE.screenConcurrency = 2;
  most = 0;
  begun.length = 0;
  screenLoads(true);
  ask(['old0', 'old1', 'old2', 'old3']);
  await settle();
  ok(begun.length === 2, 'with screenConcurrency 2 a screen loads two at once, as before the cut');
  screenLoads(false);
  while (begun.length < 4 || begun.some((b) => !(b as { done?: boolean }).done)) await finishOne();
  ok(most === 2, 'and never more');
  MOBILE_CACHE.screenConcurrency = 6;
}

// ------------------------------------------------------------------ the wiring only the game makes, as text
{
  const crlf = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8');
  const loading = crlf('../../../src/ui/loading.ts');
  const show = loading.slice(loading.indexOf('  show(planet'), loading.indexOf('  private planet:'));
  ok(/this\.visible = true;\s*this\.hiding = false;\s*this\.onCover\?\.\(true\);/.test(show), 'the screen says it covers as it comes up (and again when it is asked back mid-reveal)');
  const hide = loading.slice(loading.indexOf('  async hide('), loading.indexOf('  private tick'));
  ok(/this\.hiding = true;\s*this\.onCover\?\.\(false\);\s*if \(!opts\.quick\)/.test(hide), 'and that it no longer does the moment it begins to go, before the reveal\'s glide');
  const main = crlf('../../../src/main.ts');
  ok(/this\.loadingScreen = new LoadingScreen\([^)]*\);[^\n]*\r?\n[^\n]*\r?\n\s*this\.loadingScreen\.onCover = screenLoads;/.test(main), 'the game hands the screen `screenLoads` as it makes it');
  ok(/import \{ MobileAssets, screenLoads \} from '\.\/world\/mobiles\/assets';/.test(main), 'from the cache\'s own module');
  const manager = crlf('../../../src/world/mobiles/manager.ts');
  ok(/if \(t\.screenConcurrency !== undefined\) MOBILE_CACHE\.screenConcurrency = Math\.max\(1, Math\.floor\(t\.screenConcurrency\)\);\s*if \(t\.concurrency !== undefined \|\| t\.screenConcurrency !== undefined\) wakeLoads\(\);/.test(manager), '`__debug.mobileTune({ screenConcurrency })` moves the number live and lets the waiting loads go');
}

console.log(`\n${passed} passed`);
