// Which placed things and plants cast the sun's shadow (wave 8; `src/world/shadowCasters.ts`), and that every path
// that makes a caster reads the rule live:
//
//   1. the rule itself: flora by its line and the two switches, a small plant at its finest only, a placed thing by
//      the page's smallest caster unless it is flora
//   2. a real `FloraField` with a 0.5 m and a 3 m model: its batches' `castShadow` follows the switches through
//      `applyShadows()` with no rebuild, and a leaf card's receiving under the cards' `none` is keyed on size; and a
//      small plant of two levels, which casts at its finest alone while `plantsFinest` holds
//   3. the real streamer over a tier of a 0.8 m, a 3 m and a glass model with the smallest caster moved 1.2, 0.5 and 4
//      (glass never casting); a model the pack files as flora and one wearing a leaf card following the trees' and
//      the plants' switches and not the radius; a rock that wears a few cards, whose card pieces follow the trees and
//      whose solid pieces follow the slider; two models drawn at their levels (a level group), a small plant casting
//      at its finest alone and a pebble at both levels as the slider says; and a thing put down in play following
//      the radius, before the move and after it
//   3b. the rule in force when a tier is built or a thing is put down, with nothing walked after: a fresh streamer
//      built with the slider already low and small plants already on, and a crate put down with the slider low
//   4. the plain depth combinations the world's warm-up draws (`plainDepthCombos`) holding every way three's own
//      depth material is drawn for a placed or flora caster on the converted packs (SWG3JS_PACKS, else assets-private),
//      and three's own rule for when a depth material chooses its program, played over them, choosing one for each
//
// Run: node tools/swg/tests/shadowCasters.test.ts
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boxGeo, loadedOf, makeStreamer, THREE } from './streamHarness.ts';

const { SHADOW_CASTER_DEFAULTS, SHADOW_CASTER_TUNE, floraBig, floraCasts, placedCasts, setShadowCasterTune } = await import('../../../src/world/shadowCasters.ts');
const { FloraField } = await import('../../../src/world/floraBatch.ts');
const { CARD_LIGHT_TUNE } = await import('../../../src/world/cardLight.ts');
const { castsShadow } = await import('../../../src/world/surfaces.ts');
const { chooseDepthProgram, plainDepthCombos } = await import('../../../src/world/floraSway.ts');
const { prepareCardModel, registerPackCards } = await import('../../../src/world/cardRule.ts');
const { classByName } = await import('../../../src/world/cardAlpha.ts');
const { floraPacks, glbJsonOf, glbScenes, isCardJson } = await import('./glbThree.ts');

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

const reset = () => Object.assign(SHADOW_CASTER_TUNE, SHADOW_CASTER_DEFAULTS);

// ---------------------------------------------------------------- 1. the rule

{
  reset();
  ok(floraBig(1.2) && !floraBig(1.19) && floraCasts(3, 0) && floraCasts(3, 2) && !floraCasts(0.5, 0), 'as shipped a tree (1.2 m and over) casts at every level and a small plant at none');
  setShadowCasterTune({ plants: true });
  ok(floraCasts(0.5, 0) && !floraCasts(0.5, 1) && !floraCasts(0.5, 2), 'small plants on cast at their finest level only');
  setShadowCasterTune({ plantsFinest: false });
  ok(floraCasts(0.5, 2), 'and at every level with `plantsFinest` off');
  setShadowCasterTune({ trees: false });
  ok(!floraCasts(3, 0) && floraCasts(0.5, 0), 'trees off: no tree casts, whatever the plants do');
  reset();
  setShadowCasterTune({ floraMinRadius: 4 });
  ok(!floraCasts(3, 0) && !floraBig(3), 'the flora\'s own line moves which side a planting is');
  reset();
  ok(placedCasts(1.2, false, 0) && !placedCasts(0.8, false, 0) && placedCasts(3, true, 0), 'a placed thing casts by the page\'s smallest caster, a placed tree by the flora\'s rule');
  setShadowCasterTune({ placedMinRadius: 0.5 });
  ok(placedCasts(0.8, false, 0) && !placedCasts(0.8, true, 0), 'the slider lowered, a 0.8 m prop casts, and a 0.8 m placed plant still follows the flora\'s rule');
  setShadowCasterTune({ placedMinRadius: 4 });
  ok(!placedCasts(3, false, 0) && placedCasts(3, true, 0), 'raised past a 3 m rock, the rock stops casting, and a 3 m placed tree does not, being a tree');
  ok(!setShadowCasterTune({ placedMinRadius: Number.NaN, trees: 'no' as unknown as boolean }) && SHADOW_CASTER_TUNE.placedMinRadius === 4 && SHADOW_CASTER_TUNE.trees, 'a value that is not usable moves nothing');
  reset();
}

// ---------------------------------------------------------------- 2. the flora's batches

{
  reset();
  const prim = (card: boolean) => {
    const m = new THREE.MeshStandardMaterial();
    if (card) m.userData.swgCardBlend = false;
    return { geometry: boxGeo(1, 1, 1, 0), material: m as THREE.Material, cell: -1 };
  };
  const model = (id: string, radius: number) => ({ ...loadedOf({ id, file: '', bounds: { min: [-radius, 0, -radius], max: [radius, 2, radius] }, triangles: 12 }, []), primitives: [prim(false), prim(true)], radius }) as never;
  const small = model('fern', 0.5);
  const big = model('oak', 3);
  const n = 4;
  const data = { n, models: [small, small, big, big], mats: new Float32Array(n * 16), x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), scale: new Float32Array(n).fill(1), collidable: new Uint8Array([0, 0, 1, 1]) };
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    m4.makeTranslation(i * 3, 0, 0).toArray(data.mats, i * 16);
    data.x[i] = i * 3;
  }
  const root = new THREE.Group();
  const field = new FloraField(root);
  field.add('0,0', 0, 0, data, { group: { visible: true }, trees: { visible: true }, plants: { visible: true } });
  field.sweep(0, 0, 0, 1);
  field.rebuild(Infinity);
  const meshes = () => field.batches().flatMap((b) => b.meshes.map((m) => ({ big: b.model === big, m })));
  const casting = (which: boolean) => meshes().filter((x) => x.big === which).every((x) => x.m.castShadow);
  const none = (which: boolean) => meshes().filter((x) => x.big === which).every((x) => !x.m.castShadow);
  ok(casting(true) && none(false), 'as built, the oak\'s batches cast and the fern\'s do not');
  const made = meshes().map((x) => x.m);
  setShadowCasterTune({ plants: true });
  field.applyShadows();
  ok(casting(true) && casting(false), 'small plants switched on: the fern casts, by `applyShadows()` alone');
  setShadowCasterTune({ trees: false });
  field.applyShadows();
  ok(none(true) && casting(false), 'trees switched off: the oak stops casting');
  ok(meshes().every((x, i) => x.m === made[i]), 'and nothing was rebuilt: the same meshes throughout');
  const was = CARD_LIGHT_TUNE.shadow;
  CARD_LIGHT_TUNE.shadow = 'none';
  field.applyShadows();
  const cardOf = (which: boolean) => meshes().find((x) => x.big === which && x.m.material.userData.swgCardBlend !== undefined)!.m;
  ok(!cardOf(true).receiveShadow && cardOf(false).receiveShadow, 'under the cards\' `none` the oak\'s leaf card takes no shadow and the fern\'s does: keyed on size, though the oak casts nothing now');
  CARD_LIGHT_TUNE.shadow = was;
  field.dispose();
  reset();
}

{
  // A small plant of two levels, a planting near the eye at its finest and one 50 m off at its second.
  reset();
  const lod = { ...loadedOf({ id: 'reed', file: '', bounds: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }, triangles: 12 }, []), radius: 0.5 } as Record<string, unknown>;
  const fine = [{ geometry: boxGeo(1, 1, 1, 0), material: new THREE.MeshStandardMaterial() as THREE.Material, cell: -1 }];
  const coarse = [{ geometry: boxGeo(1, 1, 1, 0), material: new THREE.MeshStandardMaterial() as THREE.Material, cell: -1 }];
  lod.primitives = fine;
  lod.levels = [{ near: 0, far: 20, level: 0, primitives: fine }, { near: 20, far: 1e9, level: 1, primitives: coarse }];
  const n = 2;
  const data = { n, models: [lod, lod] as never[], mats: new Float32Array(n * 16), x: new Float32Array([0, 50]), y: new Float32Array(n), z: new Float32Array(n), scale: new Float32Array(n).fill(1), collidable: new Uint8Array(n) };
  const m4 = new THREE.Matrix4();
  m4.makeTranslation(0, 0, 0).toArray(data.mats, 0);
  m4.makeTranslation(50, 0, 0).toArray(data.mats, 16);
  const field = new FloraField(new THREE.Group());
  field.add('0,0', 0, 0, data, { group: { visible: true }, trees: { visible: true }, plants: { visible: true } });
  field.sweep(0, 0, 0, 1);
  field.rebuild(Infinity);
  const at = (level: number) => field.batches().filter((b) => b.count > 0 && b.level === level).flatMap((b) => [...b.meshes]);
  ok(at(0).length === 1 && at(1).length === 1 && at(0)[0].geometry === fine[0].geometry && at(1)[0].geometry === coarse[0].geometry, 'the near planting stands at the finest level and the far one at the second');
  ok(!at(0)[0].castShadow && !at(1)[0].castShadow, 'as shipped neither casts: a small plant');
  setShadowCasterTune({ plants: true });
  field.applyShadows();
  ok(at(0)[0].castShadow && !at(1)[0].castShadow, 'small plants switched on, the finest level casts and the second does not (`plantsFinest`)');
  setShadowCasterTune({ plantsFinest: false });
  field.applyShadows();
  ok(at(0)[0].castShadow && at(1)[0].castShadow, 'and with `plantsFinest` off, both');
  field.dispose();
  reset();
}

// ---------------------------------------------------------------- 3. the streamer

{
  reset();
  const def = (id: string, r: number) => ({ id, file: `${id}.glb`, bounds: { min: [-r, 0, -r], max: [r, 2, r] }, triangles: 12 });
  const glass = new THREE.MeshStandardMaterial();
  glass.userData.noShadow = true;
  const card = new THREE.MeshStandardMaterial();
  card.userData.swgCardBlend = false;
  const geos: Record<string, THREE.BufferGeometry> = {};
  const piece = (id: string, material?: THREE.Material) => {
    geos[id] = boxGeo(1, 1, 1, 0);
    return [{ geometry: geos[id], cell: -1, material }];
  };
  // Two models drawn at their levels: a small plant the pack files as flora and a pebble, a geometry a level each.
  const levelled = (id: string, r: number) => {
    const m = loadedOf(def(id, r), piece(`${id}0`));
    const coarse = loadedOf(def(id, r), piece(`${id}1`)).primitives;
    (m as unknown as { levels: unknown }).levels = [{ near: 0, far: 30, level: 0, primitives: m.primitives }, { near: 30, far: 1e9, level: 1, primitives: coarse }];
    return m;
  };
  const defs = [def('pebble', 0.8), def('boulder', 3), def('pane', 3), def('shrub', 0.6), def('oak', 3), def('potplant', 0.5), def('crystals', 3), def('reed', 0.5), def('stone', 0.8)];
  const models = {
    pebble: loadedOf(defs[0], piece('pebble')),
    boulder: loadedOf(defs[1], piece('boulder')),
    pane: loadedOf(defs[2], piece('pane', glass)),
    shrub: loadedOf(defs[3], piece('shrub')),
    oak: loadedOf(defs[4], piece('oak')),
    potplant: loadedOf(defs[5], piece('potplant', card)),
    // A rock of 3 m with crystal cards on it, as Corellia's crystal arches and geyser rocks are: no pack files it as flora.
    crystals: loadedOf(defs[6], [...piece('crystalsRock'), ...piece('crystalsCard', card)]),
    reed: levelled('reed', 0.5),
    stone: levelled('stone', 0.8),
  };
  const flora = ['shrub', 'oak', 'reed'];
  const objects = Object.keys(models).map((id, i) => ({ template: `object/${id}`, model: id, x: -(100 + i * 6), y: 0, z: 100, q: [1, 0, 0, 0], radius: 4 }));
  const h = await makeStreamer(objects, { defs, models, flora });
  await h.settle({ x: 110, z: 100 }, 30);
  const meshIn = (scene: THREE.Scene, id: string): THREE.Mesh | undefined => {
    let found: THREE.Mesh | undefined;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry === geos[id]) found = m;
    });
    return found;
  };
  const meshOf = (id: string) => meshIn(h.scene, id);
  const casts = (id: string) => meshOf(id)?.castShadow === true;
  ok(Object.keys(models).filter((id) => id !== 'crystals' && id !== 'reed' && id !== 'stone').every((id) => meshOf(id) !== undefined) && ['crystalsRock', 'crystalsCard', 'reed0', 'reed1', 'stone0', 'stone1'].every((id) => meshOf(id) !== undefined), 'every model of the tier stands, the two at their levels with a mesh a level');
  ok(!!meshOf('reed1')?.name.startsWith('level:') && !!meshOf('stone1')?.name.startsWith('level:'), 'and those two drawn by a level group');
  ok(!casts('pebble') && casts('boulder') && !casts('pane'), 'at the shipped 1.2 m the 3 m boulder casts, the 0.8 m pebble does not, and glass never');
  ok(casts('oak') && !casts('shrub') && !casts('potplant'), 'the pack\'s flora and a model wearing a leaf card follow the flora\'s rule: the 3 m oak casts as a tree, the 0.6 m shrub and the leaf-carded pot plant do not, as small plants');
  ok(casts('crystalsRock') && casts('crystalsCard') && !casts('stone0') && !casts('stone1') && !casts('reed0') && !casts('reed1'), 'the crystal rock casts, rock and cards; the levelled pebble and small plant cast at no level');
  setShadowCasterTune({ placedMinRadius: 0.5 });
  h.stream.applyCasters();
  ok(casts('pebble') && casts('boulder') && !casts('pane'), 'the smallest caster lowered to 0.5 m: the pebble casts, live, and glass still never');
  ok(casts('stone0') && casts('stone1'), 'and the levelled pebble at both its levels, through its level group');
  ok(!casts('shrub') && !casts('potplant') && !casts('reed0'), 'while the shrub, the pot plant and the levelled small plant, being flora, do not follow the slider');
  setShadowCasterTune({ placedMinRadius: 4 });
  h.stream.applyCasters();
  ok(!casts('pebble') && !casts('boulder') && !casts('stone0') && !casts('stone1') && casts('oak'), 'raised to 4 m: none of them casts, and the oak, a tree, still does');
  ok(!casts('crystalsRock') && casts('crystalsCard'), 'and the crystal rock\'s rock stops with the slider while its cards, a tree\'s by size, still cast: decided by the piece, not the model');
  setShadowCasterTune({ placedMinRadius: 1.2, plants: true });
  h.stream.applyCasters();
  ok(casts('shrub') && casts('potplant') && !casts('pebble'), 'small plants switched on: the shrub and the pot plant cast, and the slider\'s pebble does not');
  ok(casts('reed0') && !casts('reed1'), 'and the levelled small plant at its finest level alone (`plantsFinest`), through its level group');
  setShadowCasterTune({ plants: false, trees: false });
  h.stream.applyCasters();
  ok(!casts('oak') && casts('boulder'), 'trees switched off: the placed oak stops casting, and the boulder, no plant, is unmoved');
  ok(casts('crystalsRock') && !casts('crystalsCard'), 'and the crystal rock keeps its rock\'s shadow and loses only its cards\'');
  reset();
  h.stream.applyCasters();
  // A thing put down in play: a crate of half a metre, its own mesh of one in the tier.
  const putAt = (x: number, z: number): THREE.Mesh | undefined => {
    let found: THREE.Mesh | undefined;
    h.scene.traverse((o) => {
      const m = o as THREE.InstancedMesh;
      if (!m.isInstancedMesh || m.count !== 1 || m.userData.casterRadius === undefined) return;
      const p = new THREE.Vector3();
      const mm = new THREE.Matrix4();
      m.getMatrixAt(0, mm);
      p.setFromMatrixPosition(mm);
      if (Math.abs(p.x - x) < 0.01 && Math.abs(p.z - z) < 0.01) found = m;
    });
    return found;
  };
  await h.put('home:crate', 'crate', 112, 104);
  await h.settle({ x: 110, z: 100 }, 4);
  const crate = putAt(112, 104);
  ok(crate !== undefined && !crate.castShadow, 'a crate put down in play stands, and at the shipped 1.2 m casts nothing');
  setShadowCasterTune({ placedMinRadius: 0.5 });
  h.stream.applyCasters();
  ok(crate!.castShadow, 'with the slider at 0.5 m it casts: what players put down follows the slider too');
  reset();
  h.stream.applyCasters();
  ok(!crate!.castShadow && castsShadow(crate!.material), 'and put back, it stops again');

  // ---------------------------------------------------------------- 3b. the rule in force at the build
  // The slider lowered and small plants switched on, and nothing walked after: what is built now is built by them.
  setShadowCasterTune({ placedMinRadius: 0.5, plants: true });
  await h.put('home:crate2', 'crate', 114, 104);
  await h.settle({ x: 110, z: 100 }, 4);
  const crate2 = putAt(114, 104);
  ok(crate2 !== undefined && crate2.castShadow, 'a crate put down while the slider stands at 0.5 m casts as it is made, with nothing walked after');
  const h2 = await makeStreamer(objects, { defs, models, flora });
  await h2.settle({ x: 110, z: 100 }, 30);
  const casts2 = (id: string) => meshIn(h2.scene, id)?.castShadow === true;
  ok(['pebble', 'stone0', 'stone1', 'shrub', 'potplant', 'reed0'].every((id) => meshIn(h2.scene, id) !== undefined), 'a fresh tier stands, built with the rule already moved');
  ok(casts2('pebble') && casts2('stone0') && casts2('stone1') && !casts2('pane'), 'and its pebble casts at both its levels as it is built, by the slider in force, with no walk of the casters after');
  ok(casts2('shrub') && casts2('potplant') && casts2('reed0') && !casts2('reed1'), 'and its small plants cast as they are built, the levelled one at its finest alone');
  reset();
}

// ---------------------------------------------------------------- 4. the plain depth combinations

const PACKS = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private/', import.meta.url));
{
  const combos = plainDepthCombos('test');
  const sideOf = (m: THREE.Material): THREE.Side => m.shadowSide ?? (m.side === THREE.FrontSide ? THREE.BackSide : m.side === THREE.BackSide ? THREE.FrontSide : THREE.DoubleSide);
  const keyOf = (instanced: boolean, m: THREE.Material): string => {
    const s = m as THREE.MeshStandardMaterial;
    return `${instanced}|${sideOf(m)}|${s.alphaTest > 0}|${s.map ? s.map.channel : 'none'}|${s.alphaMap ? s.alphaMap.channel : 'none'}`;
  };
  const instancedOf = (c: THREE.Mesh): boolean => (c as THREE.InstancedMesh).isInstancedMesh === true;
  const fixed = new Set(combos.map((c) => keyOf(instancedOf(c), c.material as THREE.Material)));
  // The sixth wave added the fifteen that are not instanced (a door's leaf, a camp's wire, a vehicle's pieces).
  ok(combos.length === fixed.size && fixed.size === 30 && combos.filter(instancedOf).length === 15 && combos.every((c) => c.castShadow && !c.customDepthMaterial), `the warm-up's plain combinations are ${fixed.size} casters on three's own depth material, fifteen instanced and fifteen not, each a way apart`);
  ok(plainDepthCombos('test') === combos && plainDepthCombos('other') !== combos && (plainDepthCombos('other')[0].material as THREE.Material) !== combos[0].material, 'kept for the session by light set, each set with sources of its own (so each gets a clone of its own)');
  // Three's own rule, played over them as its shadow pass draws them (`WebGLShadowMap.getDepthMaterial`, then
  // `WebGLRenderer.setProgram`): a caster with a picture or an alpha picture and a cut is drawn through a clone made
  // per source material, which chooses its program at its own first draw; any other through the one shared depth
  // material, onto which the pass writes the side, the picture and the alpha picture for each caster with no step of
  // its version, and which chooses its program again only when its version or the draw's instancing moved. The
  // shared material comes to them from an instanced draw, the case where nothing else would make it choose.
  const play = (hook: boolean): Set<string> => {
    const shared = new THREE.MeshDepthMaterial();
    let seenVersion = shared.version;
    // Three also chooses again when the draw's instancing differs from the shared material's last draw's.
    let lastInstanced: boolean | null = null;
    const chosen = new Set<string>();
    for (const c of combos) {
      const m = c.material as THREE.MeshStandardMaterial;
      const inst = instancedOf(c);
      const clone = (!!m.map || !!m.alphaMap) && m.alphaTest > 0;
      const depth = clone ? new THREE.MeshDepthMaterial() : shared;
      depth.side = sideOf(m);
      depth.map = m.map;
      depth.alphaMap = m.alphaMap;
      if (hook) c.onBeforeShadow(null as never, c, null as never, null as never, c.geometry, depth, null as never);
      if (clone || depth.version !== seenVersion || (!clone && inst !== lastInstanced)) chosen.add(keyOf(inst, m));
      if (!clone) {
        seenVersion = shared.version;
        lastInstanced = inst;
      }
    }
    return chosen;
  };
  ok(combos.every((c) => c.onBeforeShadow === chooseDepthProgram), 'every one hangs the hook that makes the depth material three hands it choose its program again');
  const withHook = play(true);
  const without = play(false);
  ok(withHook.size === fixed.size && without.size < fixed.size, `under three's rule each of the ${fixed.size} chooses a program of its own (${withHook.size}); without the hook the shared material's ${fixed.size - 12} keys would have come to almost none of their own (${without.size} chosen, the clones' and the two where the instancing turned), left for a live frame`);
  const packs = floraPacks(PACKS);
  if (!packs.length) console.log(`skip the packs: no pack with flora under ${PACKS}`);
  else {
    // Every world's card shaders at once, so a card met anywhere is ruled as the game rules it (its shadow side and its cut).
    const names = new Set<string>();
    for (const p of packs) {
      if (p.manifest.cards) registerPackCards(p.manifest.cards);
      for (const d of p.manifest.categories.flora) for (const m of glbJsonOf(join(p.dir, d.file)).materials ?? []) if (isCardJson(m)) names.add(m.name ?? '');
    }
    registerPackCards(Object.fromEntries([...names].map((n) => [n, { blend: classByName(n) === 'blend', emissive: [0, 0, 0] }])));
    const real = new Map<string, string>();
    let models = 0;
    for (const p of packs) {
      for (const cat of ['flora', 'layout'] as const) {
        let taken = 0;
        for (const d of p.manifest.categories[cat] ?? []) {
          if (cat === 'layout' && taken >= 400) break;
          const file = join(p.dir, d.file);
          if (!file.endsWith('.glb') || !existsSync(file)) continue;
          taken++;
          models++;
          const { scenes } = glbScenes(file);
          prepareCardModel(scenes, { flora: cat === 'flora', count: false }, 'cards');
          for (const s of scenes) {
            s.traverse((o) => {
              const mesh = o as THREE.Mesh;
              if (!mesh.isMesh || Array.isArray(mesh.material)) return;
              const m = mesh.material as THREE.Material;
              if (!castsShadow(m) || m.userData.swgSway !== undefined) return;
              const k = keyOf(true, m);
              if (!real.has(k)) real.set(k, `${p.pack}/${d.id}`);
            });
          }
        }
      }
    }
    const uncovered = [...real.keys()].filter((k) => !fixed.has(k));
    ok(models > 0 && uncovered.length === 0, `they hold every way three's depth material is drawn for a placed or flora caster on the packs (${real.size} met over ${models} models${uncovered.length ? `; not held: ${uncovered.map((k) => `${k} (${real.get(k)})`).join(', ')}` : ''})`);
  }
}

console.log(`\nshadowCasters: ${passed} checks passed`);
process.exit(0);
