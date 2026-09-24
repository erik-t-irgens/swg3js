// What goes into a creation or selection scene, and how big each texture in it needs to be.
//
// The rules are pure, so this runs the real ones rather than a mirror. Where the owner's converted
// packs are present it also *measures* the real worlds and prints the numbers as notes, which is
// how the size of the bake stays an observed fact rather than a claim in a comment; with no packs
// it checks the arithmetic alone and says so.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { frustumPlanes, inFrustum, pixelSpan, placedAt, placesForRoster, planPlace, scenePlan, textureTarget, SCENE_BAKE_TUNE } from '../scenebake.mjs';
import { sceneSpots } from '../../../src/data/scenes.ts';
import { CREATOR_KEYS } from '../../../src/world/scenePlaces.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string): void => console.log(`note ${s}`);

const CAM = { x: 0, y: 0, z: 0, look: { x: 0, y: 0, z: -1 }, fov: 62 };

{
  // The frustum, from the outside in.
  const P = frustumPlanes(CAM, CAM.look, 62, 3, 1000);
  ok(P.length === 6, 'a view has six sides');
  ok(inFrustum(P, { x: 0, y: 0, z: -100 }), 'a point straight ahead is inside');
  ok(!inFrustum(P, { x: 0, y: 0, z: 100 }), 'and one behind the camera is not');
  ok(!inFrustum(P, { x: 0, y: 0, z: -2000 }), 'nor one past the far cap');
  const tv = Math.tan((62 * Math.PI) / 360);
  ok(inFrustum(P, { x: 0, y: tv * 100 * 0.99, z: -100 }), 'a point just inside the top edge is in');
  ok(!inFrustum(P, { x: 0, y: tv * 100 * 1.05, z: -100 }), 'and just outside it is out');
  ok(inFrustum(P, { x: 0, y: tv * 100 * 1.05, z: -100 }, 20), 'unless it is given room, which is how a wide object half in shot is kept');
  // Sideways the aspect is what decides, so a wider build keeps more.
  const narrow = frustumPlanes(CAM, CAM.look, 62, 1, 1000);
  const wideOnly = { x: tv * 2 * 100, y: 0, z: -100 };
  ok(!inFrustum(narrow, wideOnly) && inFrustum(P, wideOnly), 'a thing off to the side is in a 3:1 build and not in a square one');
}

{
  // The pixel rule, which is what both the cull and the texture size are reckoned from.
  const near = pixelSpan(2, 10);
  const far = pixelSpan(2, 1000);
  ok(near > far * 99 && near < far * 101, `a thing a hundred times further off covers a hundredth of the pixels (${near.toFixed(0)} against ${far.toFixed(1)})`);
  // A thing exactly as tall as the view at one metre spans 2*tan(fov/2) metres, and that is the
  // whole screen: the check is the definition, which is the point of writing it down.
  ok(Math.abs(pixelSpan(2 * Math.tan((62 * Math.PI) / 360), 1) - 1440) < 1, `a thing filling the view is the whole screen tall (${pixelSpan(2 * Math.tan((62 * Math.PI) / 360), 1).toFixed(1)})`);
  ok(pixelSpan(1, 0) > 0 && Number.isFinite(pixelSpan(1, 0)), 'and one at no distance at all answers a number rather than dividing by nought');
}

{
  // Texture sizing: powers of two, never up, never below the floor.
  ok(textureTarget(1024, 4000) === 1024, 'a texture is never enlarged past what the source really holds');
  ok(textureTarget(1024, 100) === 64, `a model a hundred pixels tall takes a 64 texture at the chosen quality (${textureTarget(1024, 100)})`);
  ok(textureTarget(1024, 1) === SCENE_BAKE_TUNE.minTexture, 'and a speck takes the floor rather than a single texel');
  const sizes = new Set([16, 32, 64, 128, 256, 512, 1024, 2048]);
  let allPow = true;
  for (let px = 1; px < 3000; px += 7) if (!sizes.has(textureTarget(2048, px))) allPow = false;
  ok(allPow, 'every answer is a power of two, so the mip chain stays exact');
  let monotone = true;
  let last = 0;
  for (let px = 1; px < 3000; px += 7) {
    const t = textureTarget(2048, px);
    if (t < last) monotone = false;
    last = t;
  }
  ok(monotone, 'and a thing seen closer never gets a smaller texture than one seen further off');
}

{
  // The snapshot frame: mirrored in X and centred, exactly as the streamer reads it.
  const at = placedAt({ x: 10, y: 5, z: 20 }, { x: 4, z: 6 });
  ok(at.x === -6 && at.y === 5 && at.z === 14, `a placed object lands where the streamer puts it (${at.x}, ${at.y}, ${at.z})`);
}

{
  // One place, over a made-up world, so the rules are exercised with nothing installed.
  const spot = { key: 'test', pack: 'nowhere', stand: { x: 0, y: 0, z: 0, heading: 0 }, camera: { x: 0, y: 2, z: 4, look: { x: 0, y: 2, z: 0 }, fov: 62 } };
  const models = new Map([
    ['big', { size: 20 }],
    ['small', { size: 0.2 }],
  ]);
  const layout = {
    center: { x: 0, z: 0 },
    objects: [
      { model: 'big', x: 0, y: 0, z: -40, q: [1, 0, 0, 0], contained: false },
      { model: 'big', x: 0, y: 0, z: 400, q: [1, 0, 0, 0], contained: false },
      { model: 'small', x: 0, y: 0, z: -300, q: [1, 0, 0, 0], contained: false },
      { model: 'big', x: 0, y: 0, z: -10, q: [1, 0, 0, 0], contained: true },
      { model: 'gone', x: 0, y: 0, z: -10, q: [1, 0, 0, 0], contained: false },
    ],
  };
  const plan = planPlace(spot, layout, models);
  const kept = plan.instances.map((i) => `${i.model}@${i.z}`);
  ok(plan.instances.length === 1 && plan.instances[0].model === 'big', `only what the camera can really see is kept (${kept.join(', ') || 'none'})`);
  ok(plan.missing === 1, 'a model the pack does not carry is counted rather than crashing the bake');
  ok(plan.dropped === 2, `the speck and the thing behind the camera are both dropped (${plan.dropped})`);
  ok(plan.instances[0].y === 0 && plan.instances[0].z === -40, 'and what is kept is written in the place’s own frame, with the standing spot as the origin');
  ok(plan.nearest.get('big')! > SCENE_BAKE_TUNE.cullPixels, 'with the pixels it covers recorded, which is what sizes its texture');
}

{
  // The roster rule, which is what makes this affordable: three places plus the worlds in play.
  const spots = sceneSpots();
  const none = placesForRoster(spots, CREATOR_KEYS, []);
  ok(none.length === 3, `a browser with no characters loads only the creator's three (${none.length})`);
  const sameWorld = placesForRoster(spots, CREATOR_KEYS, ['tatooine', 'naboo']);
  ok(sameWorld.length === 3, 'a character standing on a world the creator already offers adds nothing');
  const away = placesForRoster(spots, CREATOR_KEYS, ['dathomir', 'endor']);
  ok(away.length === 5, `and one on another world adds that world's place, one apiece (${away.join(', ')})`);
  const twice = placesForRoster(spots, CREATOR_KEYS, ['dathomir', 'dathomir']);
  ok(twice.length === 4, 'two characters on one world still cost one place');
  ok(placesForRoster(spots, CREATOR_KEYS, ['space_tatooine']).length === 3, 'and a world with no place of its own asks for nothing, which is the plain doll');
}

{
  // The real worlds, where they are installed. Measured rather than claimed.
  const packs = new Map<string, { layout: { center: { x: number; z: number }; objects: { model: string; x: number; y: number; z: number; q: number[]; contained?: boolean }[] }; models: Map<string, { size: number }> }>();
  let have = 0;
  for (const pack of new Set(sceneSpots().map((s) => s.pack))) {
    const dir = `assets-private/${pack}`;
    if (!existsSync(`${dir}/layout.json`) || !existsSync(`${dir}/manifest.json`)) continue;
    const layout = JSON.parse(readFileSync(`${dir}/layout.json`, 'utf8'));
    const man = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'));
    const models = new Map<string, { size: number }>();
    for (const list of Object.values(man.categories ?? {})) {
      if (!Array.isArray(list)) continue;
      for (const m of list as { id?: string; bounds?: { min: number[]; max: number[] } }[]) {
        if (!m?.id) continue;
        const b = m.bounds;
        // The BOX chunk stores the larger corner first, so extents are taken componentwise.
        const size = b ? Math.max(Math.abs(b.max[0] - b.min[0]), Math.abs(b.max[1] - b.min[1]), Math.abs(b.max[2] - b.min[2])) : 3;
        models.set(m.id, { size });
      }
    }
    packs.set(pack, { layout, models });
    have++;
  }
  if (!have) {
    note('no converted worlds here, so the rules above were checked on their own');
  } else {
    const spots = sceneSpots();
    const wanted = new Set(placesForRoster(spots, CREATOR_KEYS, []));
    const plan = scenePlan(spots.filter((s) => wanted.has(s.key)), packs);
    let instances = 0;
    for (const p of plan.places) {
      instances += p.instances.length;
      note(`${p.key.padEnd(18)} ${String(p.instances.length).padStart(5)} instances, ${String(p.nearest.size).padStart(4)} models, ${p.dropped} dropped${p.missing ? `, ${p.missing} the pack has not got` : ''}`);
    }
    note(`the creator's three: ${instances} instances over ${plan.pool.size} distinct models`);
    ok(plan.places.length === Math.min(3, have * 3), `every creator place that is installed planned (${plan.places.length})`);
    ok(plan.places.every((p) => p.instances.length > 0), 'and none of them came out empty, which would be a camera pointing at nothing');
    ok(plan.places.every((p) => p.missing === 0), 'with every model they name really in its pack');
    ok(plan.pool.size < instances, `the pool is smaller than the instance count, which is what instancing is for (${plan.pool.size} against ${instances})`);
  }
}

console.log(`\n${passed} checks passed`);
