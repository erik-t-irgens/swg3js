// The animated surfaces, checked without a browser: the program-key flags the plugin sets before
// anything compiles, a material and its clone sharing one flip-book, a frame swap that leaves every
// program-key field alone, adoption only through `adopt` (the plugin registers and nothing more),
// the records' end (dispose, double dispose, shared owned frames, sweep), the scrolls' own offsets,
// the clock's freeze, speed and backwards time, and the shadow and draw-order helpers.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AnimatedSurfaces, applySurface, castsShadow, drawsAfterWater, type SurfaceContext, type SwgSurface } from '../../../src/world/surfaces.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};

/** A fake loader's textures: index i is a fresh Texture, the same object every time it is asked for (GLTFLoader caches too). */
function texturesOf(n: number, missing: number[] = []): { list: (THREE.Texture | null)[]; ctx: (referenced?: number[]) => SurfaceContext } {
  const list: (THREE.Texture | null)[] = [];
  for (let i = 0; i < n; i++) {
    if (missing.includes(i)) {
      list.push(null);
      continue;
    }
    const t = new THREE.Texture();
    t.name = `tex${i}`;
    list.push(t);
  }
  return {
    list,
    ctx: (referenced = []) => ({ getTexture: (i: number) => Promise.resolve(list[i] as THREE.Texture), referenced: new Set(referenced), trackByKey: new Map() }),
  };
}

/** A renderer stand-in that counts uploads. */
function fakeRenderer(): { renderer: THREE.WebGLRenderer; uploads: THREE.Texture[] } {
  const uploads: THREE.Texture[] = [];
  return { renderer: { initTexture: (t: THREE.Texture) => void uploads.push(t) } as unknown as THREE.WebGLRenderer, uploads };
}

const disposeCount = (t: THREE.Texture) => {
  const box = { n: 0 };
  t.addEventListener('dispose', () => box.n++);
  return box;
};

/** A standard material whose map is texture 0, as GLTFLoader would give it. */
function standardWith(map: THREE.Texture, name = 'shader/anim_mission_terminal.sht'): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map });
  m.name = name;
  map.colorSpace = THREE.SRGBColorSpace;
  return m;
}

const anim8 = (map = [0, 1, 2, 3, 4, 5, 6, 7]): SwgSurface => ({ anim: { mode: 'time', seconds: [0.1, 0.1], map } });

// The flags.
{
  const s = new AnimatedSurfaces();
  const { ctx } = texturesOf(4);
  const add = new THREE.MeshStandardMaterial();
  await applySurface(s, add, { blend: 'add' }, ctx());
  ok(add.blending === THREE.AdditiveBlending && add.transparent && !add.depthWrite && add.fog === false, 'blend add: additive, transparent, no depth write, no fog');

  const { list, ctx: ctx2 } = texturesOf(4);
  const masked = new THREE.MeshStandardMaterial({ map: list[0] as THREE.Texture });
  await applySurface(s, masked, { alphaMap: 3, alphaTest: 0.0235 }, ctx2([0]));
  ok(masked.alphaTest === 0.0235 && masked.alphaMap === list[3], 'alphaMap 3 and alphaTest 0.0235: both set, the alpha map is texture 3');
  ok(masked.alphaMap?.colorSpace === THREE.NoColorSpace, 'the alpha map is data, with no colour space');

  const { list: l3, ctx: ctx3 } = texturesOf(8);
  const screen = standardWith(l3[0] as THREE.Texture);
  await applySurface(s, screen, anim8(), ctx3([0]));
  ok(typeof screen.userData.swgTrack === 'string', `anim: userData.swgTrack is a string (${screen.userData.swgTrack})`);
  ok(l3.every((t) => t?.colorSpace === THREE.SRGBColorSpace), 'anim: every frame is sRGB');
  const d = s.describe('mission');
  ok(d.list.length === 1 && d.list[0].frames === 8 && d.list[0].mode === 'time', 'anim: one track of 8 frames, time mode');

  // Owned frames: index 0 is referenced (the material's own map) and is not disposed with the track.
  const spies = l3.map((t) => disposeCount(t as THREE.Texture));
  s.adopt(screen);
  screen.dispose();
  ok(spies[0].n === 0 && spies.slice(1).every((b) => b.n === 1), 'a referenced frame is not owned: the track disposes frames 1-7 only');

  // An unlit (basic) screen flips too; a missing frame means no animation at all.
  const { list: l4, ctx: ctx4 } = texturesOf(4, [2]);
  const broken = new THREE.MeshBasicMaterial({ map: l4[0] as THREE.Texture });
  await applySurface(s, broken, anim8([0, 1, 2, 3]), ctx4([0]));
  ok(broken.userData.swgTrack === undefined && broken.map === l4[0], 'a frame that failed to load: no track, the material keeps its texture');
}

// Clones join the track, and a swap changes nothing in the program key.
{
  const s = new AnimatedSurfaces();
  const { list, ctx } = texturesOf(8);
  const m = standardWith(list[0] as THREE.Texture);
  await applySurface(s, m, anim8(), ctx([0]));
  const clone = m.clone();
  ok(clone.userData.swgTrack === m.userData.swgTrack, 'the clone kept swgTrack through the JSON copy of userData');

  // The plugin adopts nothing: before adopt, nothing is active and update swaps nothing.
  s.update(0, null);
  s.update(0.5, null);
  ok(s.describe().active === 0 && m.map === list[0], 'before adopt: no active track, and update changes no map');

  s.adopt(m);
  s.adopt(clone);
  s.adopt(m); // idempotent
  ok(s.describe().materials === 2 && s.describe().list[0].materials === 2, 'the material and its clone are both adopted, once each');

  const key = (x: THREE.MeshStandardMaterial) => ({
    version: x.version,
    alphaTest: x.alphaTest,
    transparent: x.transparent,
    blending: x.blending,
    fog: x.fog,
    alphaMap: !!x.alphaMap,
    emissiveMap: !!x.emissiveMap,
    map: !!x.map,
    channel: x.map?.channel,
    colorSpace: x.map?.colorSpace,
    video: !!(x.map as THREE.VideoTexture | null)?.isVideoTexture,
  });
  const before = JSON.stringify(key(m));

  // Seven owned frames upload four a step before the track starts.
  const { renderer, uploads } = fakeRenderer();
  s.update(1, renderer);
  ok(uploads.length === 4 && s.describe().uploadsPending === 3, `uploads: four a step (${uploads.length}, ${s.describe().uploadsPending} pending)`);
  s.update(1.01, renderer);
  ok(uploads.length === 7 && s.describe().uploadsPending === 0, 'uploads: the rest the next step, each owned frame once');
  ok(new Set(uploads).size === 7 && !uploads.includes(list[0] as THREE.Texture), 'uploads: the seven owned frames, not the material\'s own');
  ok(m.map === list[0], 'the first step after the uploads starts the clock at frame 0');
  s.update(1.12, renderer);
  ok(m.map === list[1] && clone.map === list[1], 'past one frame, the material and its clone both show frame 1');
  ok(JSON.stringify(key(m)) === before, `a swap leaves every program-key field alone (${before})`);
  ok(uploads.length === 7, 'a swap uploads nothing');

  // Freeze, speed, backwards time.
  s.frozen = true;
  s.update(5, renderer);
  ok(m.map === list[1], 'frozen: the clock stands still');
  s.frozen = false;
  const t0 = s.describe().time;
  s.update(5.1, renderer);
  ok(Math.abs(s.describe().time - t0 - 0.1) < 1e-4, 'unfrozen: the clock moves by the step, not the time frozen');
  s.speed = 4;
  const t1 = s.describe().time;
  s.update(5.2, renderer);
  ok(Math.abs(s.describe().time - t1 - 0.4) < 1e-4, 'speed 4: the clock moves four times as fast');
  s.speed = 1;
  const t2 = s.describe().time;
  const frame = s.describe().list[0].frame;
  s.update(0.3, renderer); // a planet load reset the sim clock
  ok(s.describe().time === t2 && s.describe().list[0].frame === frame, 'time going backwards does not step');
  s.update(0.4, renderer);
  ok(Math.abs(s.describe().time - t2 - 0.1) < 1e-4, 'and the clock resumes from the new time');
  s.update(10.4, renderer);
  ok(Math.abs(s.describe().time - t2 - 0.6) < 1e-4, 'a long step counts as half a second at most');

  // Disposal: both materials disposed empties the track, each owned frame disposed exactly once.
  const spies = list.map((t) => disposeCount(t as THREE.Texture));
  m.dispose();
  ok(s.describe().tracks === 1 && s.describe().list[0].materials === 1, 'one material disposed: the track stays for the other');
  ok(m.map === list[0], 'a forgotten material is given back its own frame');
  m.dispose(); // twice
  s.forget(m); // and forget after dispose
  ok(s.describe().list[0].materials === 1 && s.describe().materials === 1, 'disposing twice and forgetting after dispose remove nothing else');
  clone.dispose();
  ok(s.describe().tracks === 0 && s.describe().active === 0 && s.describe().materials === 0, 'both disposed: the track is gone from the records and the active list');
  ok(spies[0].n === 0 && spies.slice(1).every((b) => b.n === 1), 'each owned frame was disposed exactly once, the referenced one not at all');
}

// Glowing flip-books: emissiveMap follows the frame, and an empty glow is a black stand-in, never null.
{
  const s = new AnimatedSurfaces();
  const { list, ctx } = texturesOf(8);
  const m = standardWith(list[0] as THREE.Texture);
  m.emissiveMap = list[4];
  await applySurface(s, m, { anim: { mode: 'time', seconds: [0.1, 0.1], map: [0, 1, 2, 3], emissive: [4, 5, -1, 7] } }, ctx([0, 4]));
  s.adopt(m);
  ok(s.describe().list[0].glows, 'the track glows');
  for (let i = 0; i < 4; i++) s.update(i * 0.001, null);
  const seen: string[] = [];
  for (let k = 0; k < 4; k++) {
    s.update(0.01 + (k + 1) * 0.1, null);
    seen.push(`${m.map?.name}/${m.emissiveMap?.name}`);
  }
  ok(seen.join(' ') === 'tex1/tex5 tex2/swg:no-glow tex3/tex7 tex0/tex4', `map and emissiveMap swap together (${seen.join(' ')})`);
  ok(m.emissiveMap !== null, 'the emissive slot never empties');
}

// A glow list on a material whose own glow slot is null (its texture failed to load): no glow swap, the slot stays null.
{
  const s = new AnimatedSurfaces();
  const { list, ctx } = texturesOf(8);
  const m = standardWith(list[0] as THREE.Texture);
  ok(m.emissiveMap === null, 'a standard material with no glow texture has a null emissive slot');
  await applySurface(s, m, { anim: { mode: 'time', seconds: [0.1, 0.1], map: [0, 1, 2, 3], emissive: [4, 5, 6, 7] } }, ctx([0]));
  s.adopt(m);
  ok(!s.describe().list[0].glows, 'the track carries no glows when the material has no glow of its own');
  for (let k = 0; k < 7; k++) s.update(k * 0.1 + 0.01, null);
  ok(m.emissiveMap === null && m.map !== list[0], `the frames swap and the null emissive slot stays null (map ${m.map?.name})`);
  m.dispose();
  ok(m.emissiveMap === null, 'forget leaves a null emissive slot null');
}

// The timing is part of the flip-book's key: one frame list, a loop and a ping-pong, two clocks.
{
  const s = new AnimatedSurfaces();
  const { list, ctx } = texturesOf(4);
  const c = ctx([0]);
  const loop = standardWith(list[0] as THREE.Texture, 'shader/frn_all_guild_registry_screen_imp.sht');
  const back = standardWith(list[0] as THREE.Texture, 'shader/frn_all_guild_registry_screen_imp_s02.sht');
  const twin = standardWith(list[0] as THREE.Texture, 'shader/frn_all_guild_registry_screen_imp_twin.sht');
  await applySurface(s, loop, { anim: { mode: 'time', seconds: [0.1, 0.1], map: [0, 1, 2, 3] } }, c);
  await applySurface(s, back, { anim: { mode: 'pingpong', seconds: [0.1, 0.1], map: [0, 1, 2, 3] } }, c);
  await applySurface(s, twin, { anim: { mode: 'time', seconds: [0.1, 0.1], map: [0, 1, 2, 3] } }, c);
  ok(loop.userData.swgTrack !== back.userData.swgTrack, 'same frames, a different mode: two tracks');
  ok(loop.userData.swgTrack === twin.userData.swgTrack, 'same frames and the same timing: one track');
  const slow = standardWith(list[0] as THREE.Texture, 'shader/slow.sht');
  await applySurface(s, slow, { anim: { mode: 'time', seconds: [0.2, 0.2], map: [0, 1, 2, 3] } }, c);
  ok(slow.userData.swgTrack !== loop.userData.swgTrack, 'same frames and mode, other seconds: its own track');
  const modes = s.describe('guild_registry').list.map((t) => t.mode).sort().join(',');
  ok(modes === 'pingpong,time', `each track keeps its own mode (${modes})`);
  // Frame textures shared by the tracks are owned by each and disposed once, when the last goes.
  const spy = disposeCount(list[2] as THREE.Texture);
  for (const m of [loop, back, twin, slow]) s.adopt(m);
  for (const m of [loop, back, twin]) m.dispose();
  ok(spy.n === 0, 'a frame shared by tracks survives while one of them lives');
  slow.dispose();
  ok(spy.n === 1, 'and is disposed once with the last');
}

// Warming: a frame that is another material's base colour is not owned, but is uploaded ahead all the same.
{
  const s = new AnimatedSurfaces();
  const { list, ctx } = texturesOf(4);
  const m = standardWith(list[0] as THREE.Texture);
  await applySurface(s, m, anim8([0, 1, 2, 3]), ctx([0, 2]));
  const spy = disposeCount(list[2] as THREE.Texture);
  s.adopt(m);
  const { renderer, uploads } = fakeRenderer();
  s.update(0, renderer);
  ok(uploads.length === 3 && new Set(uploads).size === 3 && uploads.includes(list[2] as THREE.Texture) && !uploads.includes(list[0] as THREE.Texture), 'frames 1-3 upload ahead, the referenced frame 2 among them, the material\'s own frame 0 not');
  s.update(0.25, renderer);
  ok(uploads.length === 3, 'swaps after the warm-up upload nothing');
  m.dispose();
  ok(spy.n === 0, 'the referenced frame is warmed but not owned: the track does not dispose it');
}

// Shared owned frames: two tracks, one texture; the first retirement keeps it, the second disposes it.
{
  const s = new AnimatedSurfaces();
  const a = new THREE.Texture();
  const b = new THREE.Texture();
  const shared = new THREE.Texture();
  const spy = disposeCount(shared);
  const id1 = s.registerTrack('k1', 'one', [a, shared], [], [shared], 'time', [0.1, 0.1]);
  const id2 = s.registerTrack('k2', 'two', [b, shared], [], [shared], 'time', [0.1, 0.1]);
  const m1 = new THREE.MeshBasicMaterial({ map: a });
  m1.userData.swgTrack = id1;
  const m2 = new THREE.MeshBasicMaterial({ map: b });
  m2.userData.swgTrack = id2;
  s.adopt(m1);
  s.adopt(m2);
  m1.dispose();
  ok(spy.n === 0, 'a frame two tracks own survives the first track');
  m2.dispose();
  ok(spy.n === 1, 'and is disposed with the second');
}

// sweep: a track no material joined goes, an adopted one stays.
{
  const s = new AnimatedSurfaces();
  const t = new THREE.Texture();
  const spy = disposeCount(t);
  s.registerTrack('lonely', 'cell original', [new THREE.Texture(), t], [], [t], 'time', [0.1, 0.1]);
  const kept = s.registerTrack('kept', 'shown', [new THREE.Texture(), new THREE.Texture()], [], [], 'time', [0.1, 0.1]);
  const m = new THREE.MeshBasicMaterial({ map: new THREE.Texture() });
  m.userData.swgTrack = kept;
  s.adopt(m);
  s.sweep();
  ok(s.describe().tracks === 1 && s.describe().list[0].name === 'shown', 'sweep retires the track nobody joined and keeps the adopted one');
  ok(spy.n === 1, 'the swept track disposed its owned frame');
  // An id that was swept is ignored by a later adopt.
  const late = new THREE.MeshBasicMaterial({ map: new THREE.Texture() });
  late.userData.swgTrack = 'track1';
  const own = late.map;
  s.adopt(late);
  ok(late.map === own && s.describe().tracks === 1, 'a material whose track was swept keeps its texture');
}

// Scrolls.
{
  const s = new AnimatedSurfaces();
  const { list, ctx } = texturesOf(3);
  const base = list[0] as THREE.Texture;
  const sibling = base.clone(); // a second sampler on the same image: one Source, its own Texture
  ok(sibling.source === base.source, 'two textures of one source');
  const c = ctx([0]);
  const fall = standardWith(base, 'shader/waterfall_scroll.sht');
  const slow = standardWith(sibling, 'shader/waterfall_scroll_slow.sht');
  await applySurface(s, fall, { scroll: { map: [-0.15, -0.5], alpha: [0, -0.5] }, alphaMap: 2 }, c);
  await applySurface(s, slow, { scroll: { map: [-0.13, -0.5], alpha: null } }, c);
  ok(Array.isArray(fall.userData.swgScroll) && fall.userData.swgScroll.length === 2, 'a split-alpha scroll registers its colour and its alpha');
  ok(slow.userData.swgScroll.length === 1, 'a colour-only scroll registers one');
  // The vertex-colour clone shares the Texture: it gets the same record.
  const vc = fall.clone();
  const again = s.registerScroll('dup', vc.map as THREE.Texture, 1, 1);
  ok(again === fall.userData.swgScroll[0], 'a texture that already scrolls gives back its record');
  s.update(0, null);
  s.update(1, null);
  ok(base.offset.x === 0 && base.offset.y === 0, 'no scroll moves before its material is adopted');
  s.adopt(fall);
  s.adopt(slow);
  s.adopt(vc);
  ok(s.describe().activeScrolls === 3 && s.describe().scrolls === 3, 'three scrolls active');
  // The module's clock stood at 0.5 (the step to t = 1 counted half a second); half-second steps to 1.5.
  s.update(1.5, null);
  s.update(2, null);
  ok(Math.abs(s.describe().time - 1.5) < 1e-9, `the clock reads 1.5 s (${s.describe().time})`);
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  ok(near(base.offset.x, 0.775) && near(base.offset.y, 0.25), `the fall's colour moves at its own rate: frac(-0.15 x 1.5), frac(-0.5 x 1.5) (${base.offset.x.toFixed(3)}, ${base.offset.y.toFixed(3)})`);
  ok(near(sibling.offset.x, 0.805) && near(sibling.offset.y, 0.25), `the slow fall on the same image keeps its own offset (${sibling.offset.x.toFixed(3)}, ${sibling.offset.y.toFixed(3)})`);
  ok(near((fall.alphaMap as THREE.Texture).offset.x, 0) && near((fall.alphaMap as THREE.Texture).offset.y, 0.25), 'the alpha map moves at the alpha rate');
  slow.dispose();
  ok(s.describe().scrolls === 2 && s.describe().activeScrolls === 2, 'a scroll goes when its last material is disposed');
  fall.dispose();
  ok(s.describe().scrolls === 2, 'a scroll shared with a clone stays while the clone is in the scene');
  const offsetBefore = base.offset.x;
  s.forgetUnder(new THREE.Mesh(new THREE.BufferGeometry(), vc));
  ok(s.describe().scrolls === 0 && s.describe().activeScrolls === 0, 'forgetUnder drops the clone and with it both of the fall\'s scrolls');
  s.update(3.5, null);
  ok(base.offset.x === offsetBefore, 'update walks only the active records');
}

// The plugin: registers in afterRoot, adopts nothing, handles the vertex-colour clone, and skips plain GLBs.
{
  const s = new AnimatedSurfaces();
  let register: ((parser: unknown) => { name: string; afterRoot?: (r: unknown) => Promise<void> | null }) | null = null;
  const loader = { register(cb: typeof register) {
    register = cb;
    return this;
  } };
  const returned = s.withPlugin(loader as never);
  ok(returned === (loader as unknown) && typeof register === 'function', 'withPlugin registers and hands the loader back');
  const { list } = texturesOf(8);
  const json = {
    materials: [
      { name: 'shader/anim_mission_terminal.sht', pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, extras: { swg: anim8() } },
      { name: 'shader/plain.sht', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
    ],
  };
  const parser = { json, getDependency: (type: string, i: number) => (type === 'texture' ? Promise.resolve(list[i]) : Promise.reject(new Error(type))) };
  const plugin = (register as unknown as (p: unknown) => { name: string; afterRoot: (r: unknown) => Promise<void> | null })(parser);
  ok(plugin.name === 'SWG_surfaces', 'the plugin is named SWG_surfaces');
  const screen = standardWith(list[0] as THREE.Texture);
  Object.assign(screen.userData, json.materials[0].extras);
  const vertexClone = screen.clone();
  vertexClone.vertexColors = true;
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BufferGeometry(), screen), new THREE.Mesh(new THREE.BufferGeometry(), vertexClone), new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial()));
  await plugin.afterRoot({ scene, scenes: [scene] });
  ok(typeof screen.userData.swgTrack === 'string' && screen.userData.swgTrack === vertexClone.userData.swgTrack, 'the material and GLTFLoader\'s vertex-colour clone share one track');
  ok(s.describe().tracks === 1 && s.describe().active === 0, 'the plugin registered one track and adopted nothing');
  const plainParser = { json: { materials: [json.materials[1]] }, getDependency: () => Promise.reject(new Error('should not load')) };
  const plainPlugin = (register as unknown as (p: unknown) => { afterRoot: (r: unknown) => Promise<void> | null })(plainParser);
  ok(plainPlugin.afterRoot({ scene: new THREE.Group(), scenes: [] }) === null, 'a GLB with no extras.swg costs one scan of its JSON and nothing else');
}

// The helpers.
{
  const plain = new THREE.MeshStandardMaterial();
  const noShadow = new THREE.MeshStandardMaterial();
  noShadow.userData.noShadow = true;
  ok(castsShadow(plain) && !castsShadow(noShadow), 'castsShadow follows userData.noShadow');
  ok(!castsShadow([plain, noShadow]), 'castsShadow is false with one noShadow material in an array');
  const fall = new THREE.MeshStandardMaterial({ transparent: true });
  fall.userData.swg = { scroll: { map: [0, -0.5] } };
  const fence = new THREE.MeshBasicMaterial({ transparent: true });
  fence.userData.noShadow = true;
  const glass = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.5 });
  const screen = new THREE.MeshBasicMaterial();
  screen.userData.swg = { anim: {} };
  screen.userData.noShadow = true;
  ok(drawsAfterWater(fall) && drawsAfterWater(fence), 'drawsAfterWater: a transparent material with userData.swg or noShadow');
  ok(!drawsAfterWater(glass) && !drawsAfterWater(screen) && !drawsAfterWater(plain), 'drawsAfterWater: not plain glass, not an opaque screen, not a plain material');
  ok(drawsAfterWater([plain, fall]), 'drawsAfterWater: any material of an array');
}

console.log(`surfaces: ${passed} passed`);
