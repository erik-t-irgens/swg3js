// Which models sway and what the world hangs on them (`src/world/floraSway.ts`), on the packs (SWG3JS_PACKS, else
// assets-private), each flora model ruled and measured as `AssetPack.model` does it as it loads:
//
//   1. the selection rule over the real packs gives exactly the measured 269 of 455 flora models (where the folder
//      holds those 455; the models on the rule's edges named should it move);
//   2. every material of a swaying model, at every level, carries `swgSway`, and nothing of a still one does;
//   3. every geometry of a swaying model has its bounding sphere grown once by the model's largest excursion,
//      and a second load of the model grows it no further;
//   4. every swaying mesh, drawn as the flora draws it (instanced), is handed a depth material, and with
//      `shadow` off none is;
//   5. the warm list holds exactly one stand-in per depth combination those meshes can cast with, and the fixed
//      combinations the warm-up always draws cover every one the planted and placed swaying meshes cast with;
//   6. a placed model sways only when it wears a card, and a building never;
//   7. the world builds those depth programs by drawing the stand-ins into the shadow maps as a frame does, after
//      the world pass's lights and then a room's are set up, with a target bound (read from
//      `World.compileShadowDepth`'s own text and the portal renderer's shadow-only draw), the fixed combinations with
//      them, and the plain combinations and the grass's own depth material in the same draws (wave 8); and a
//      building's rooms pass holds the flora still.
//
// Run: node tools/swg/tests/floraSway.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { classByName } from '../../../src/world/cardAlpha.ts';
import { prepareCardModel, registerPackCards } from '../../../src/world/cardRule.ts';
import { SWAY_COMBO_KEY, SWAY_TUNE, disposeStandIn, hangSwayDepth, prepareSwayModel, setSwayRoomPass, SWAY_UNIFORMS, setSwayTune, swayDepthCombos, swayDepthStandIns } from '../../../src/world/floraSway.ts';
import { RIGID, SOFT_PLANT } from '../../../src/world/swayMath.ts';
import { floraPacks, glbJsonOf, glbScenes, isCardJson } from './glbThree.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

const materialsOf = (m: THREE.Mesh): THREE.Material[] => (Array.isArray(m.material) ? m.material : [m.material]);
const meshesOf = (scenes: THREE.Object3D[]): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  for (const s of scenes) s.traverse((o) => void ((o as THREE.Mesh).isMesh && out.push(o as THREE.Mesh)));
  return out;
};

// ---------------------------------------------------------------- 7. the warm, from the world's own text

{
  const src = readFileSync(fileURLToPath(new URL('../../../src/world/world.ts', import.meta.url)), 'utf8');
  const start = src.indexOf('private compileShadowDepth(');
  const end = start >= 0 ? src.slice(start).search(/\r?\n {2}\}\r?\n/) : -1;
  const body = start >= 0 && end > 0 ? src.slice(start, start + end) : '';
  ok(body.includes('portals.drawShadowsOnly(this.scene)') && body.includes('swayDepthStandIns(swaying, set.name)') && body.includes('plainDepthCombos(set.name)') && body.includes('skinnedDepthCombos(set.name)'), "the sway's depth programs are built by drawing the stand-ins into the shadow maps, each light set with depth materials and sources of its own, the skinned bodies' beside them");
  ok(body.includes("[{ layer: -1, name: 'shadow' }]") && body.includes("{ layer: 0, name: 'world' }") && body.includes("{ layer: INTERIOR_LAYER, name: 'rooms' }") && body.includes("PASS_STATES.mode === 'perPass'"), "one set, the shadow pass's own scene's, while it has one; the world pass's and a room's in turn the old way");
  ok(body.indexOf('portals.primePasses(this.scene, camera)') >= 0 && body.indexOf('portals.primePasses(this.scene, camera)') < body.indexOf('portals.drawShadowsOnly'), "the shadow pass's own lights are set up before its draw (three keys a shadow draw on the state's lights)");
  ok(body.indexOf('r.compile(nothing, camera, this.scene)') >= 0 && body.indexOf('r.compile(nothing, camera, this.scene)') < body.indexOf('portals.drawShadowsOnly'), "and the old way each set's are, by a compile of nothing under that pass's layers before the shadow draw");
  ok(/this\.withTarget\(r, bound, \(\) => portals\.drawShadowsOnly/.test(body) && body.includes('new THREE.WebGLRenderTarget('), 'with a target bound, as a shadow draw always has one');
  ok(body.includes('this.scene.add(s)') && body.includes('this.scene.remove(s)') && body.indexOf('this.scene.remove(s)') > body.indexOf('finally'), 'and the stand-ins stand in the scene for those draws alone, taken out whatever happens');
  const portal = readFileSync(fileURLToPath(new URL('../../../src/world/portalRender.ts', import.meta.url)), 'utf8');
  // The method whole (since the performance pass's sixth wave it also asks every cascade's map and calls the hooks).
  const drawAt = portal.indexOf('drawShadowsOnly(scene');
  const drawEnd = drawAt >= 0 ? portal.slice(drawAt).search(/\r?\n {2}\}\r?\n/) : -1;
  const draw = drawAt >= 0 && drawEnd > 0 ? portal.slice(drawAt, drawAt + drawEnd) : '';
  ok(draw.includes('this.shadingShadows = true') && draw.includes('r.shadowMap.needsUpdate = true') && draw.includes('r.render(this.passScenes.forShadows(scene), this.shadowProbe)'), "the portal renderer's shadow-only draw is its own shadow pass: the probe, through the shadow pass's own scene, the maps marked for drawing, and its stray draws dropped");
  ok(src.indexOf('this.compileShadowDepth(r, target, objects)') > src.indexOf('this.compileFor(r, camera, objects.slice(i, i + BATCH), target)') && src.indexOf('this.compileShadowDepth(r, target, objects)') < src.indexOf('for (const s of placed) s.dispose()'), "after the sweep's own compiles, over everything it compiled, before the placed stand-ins are let go");
  ok(body.includes('...swayDepthCombos()]') && body.indexOf('...swayDepthCombos()]') < body.indexOf('swayDepthStandIns(swaying, set.name)'), 'and over the fixed combinations as well, so a placed tier streamed in later finds its depth program built');
  // Wave 8: the plain combinations and the grass's depth material go into the very same draws (and since the
  // performance pass's second wave the skinned bodies' combinations too).
  const loop = body.slice(body.indexOf('for (const set of sets) {'));
  // The performance pass's sixth wave added the shadow batches' one combination after them.
  const drawn = loop.indexOf('const drawn: THREE.Object3D[] = [...standIns, ...plain, ...skinned, batched];');
  const added = loop.indexOf('this.scene.add(s);');
  const shadowDraw = loop.indexOf('portals.drawShadowsOnly(this.scene)');
  ok(drawn > 0 && added > drawn && shadowDraw > added && /for \(const s of drawn\) \{[\s\S]{0,160}this\.scene\.add\(s\);/.test(loop) && /finally \{\s*for \(const s of drawn\) this\.scene\.remove\(s\);/.test(loop), 'the plain and skinned combinations stand in the scene beside the sway\'s stand-ins for the shadow-only draw of each light set, and are taken out in the `finally`');
  const tuft = loop.slice(loop.indexOf('if (withTuft) {'));
  ok(/const tuft = this\.grassStand && this\.grassDepth \? this\.grassStand : null;/.test(body) && /const withTuft = tuft !== null && set === sets\[0\];/.test(loop) && /tuft\.customDepthMaterial = this\.grassDepth!;\s*tuft\.castShadow = true;[\s\S]{0,160}this\.scene\.add\(tuft\);/.test(tuft) && loop.indexOf('this.scene.add(tuft);') < shadowDraw, 'the grass\'s stand-in hangs the grass\'s depth material, casts, and stands in the scene for the first set\'s shadow-only draw alone (the world\'s, or the shadow pass\'s own)');
  ok(/if \(withTuft\) warm\.grass = true;/.test(loop) && loop.indexOf('if (withTuft) warm.grass = true;') > shadowDraw && /if \(withTuft\) \{\s*this\.scene\.remove\(tuft\);\s*tuft\.castShadow = false;\s*tuft\.customDepthMaterial = undefined;/.test(loop), 'which the warm-up reports once it has been drawn, and puts back as it was, out of the scene and casting nothing');
  // A building's rooms pass: no wind indoors, and the switch back after.
  setSwayRoomPass(true);
  const inRooms = SWAY_UNIFORMS.uSwayWind.value.w;
  setSwayRoomPass(false);
  ok(inRooms === 0 && SWAY_UNIFORMS.uSwayWind.value.w === (SWAY_TUNE.on ? 1 : 0), 'a rooms pass holds the flora still for its own draws and lets it go after: a plant standing in a room stands in no wind');
}

const PACKS = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private/', import.meta.url));
{
  const packs = floraPacks(PACKS);
  if (!packs.length) console.log(`skip the packs: no pack with flora under ${PACKS}`);
  else {
    // Every world's card shaders at once, on purpose, so every placed model the rule can reach anywhere is tried;
    // that the game knows a world's whole set as it loads is cardRule.test's check.
    const names = new Set<string>();
    for (const p of packs) {
      if (p.manifest.cards) registerPackCards(p.manifest.cards);
      for (const d of p.manifest.categories.flora) for (const m of glbJsonOf(join(p.dir, d.file)).materials ?? []) if (isCardJson(m)) names.add(m.name ?? '');
    }
    registerPackCards(Object.fromEntries([...names].map((n) => [n, { blend: classByName(n) === 'blend', emissive: [0, 0, 0] }])));
    let models = 0;
    let swaying = 0;
    let unmarked = 0;
    let strayMark = 0;
    let unpadded = 0;
    let padTwice = 0;
    let noDepth = 0;
    const swayMeshes: THREE.Mesh[] = [];
    const byNameOnly: string[] = [];
    const byRigid: string[] = [];
    const seen = new Set<string>();
    for (const p of packs) {
      for (const d of p.manifest.categories.flora) {
        if (seen.has(d.id)) continue;
        const file = join(p.dir, d.file);
        if (!existsSync(file)) continue;
        seen.add(d.id);
        models++;
        const { scenes } = glbScenes(file);
        prepareCardModel(scenes, { flora: true, count: false }, 'cards');
        const meshes = meshesOf(scenes);
        const radii = new Map<THREE.BufferGeometry, number>();
        for (const m of meshes) {
          if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
          radii.set(m.geometry, m.geometry.boundingSphere!.radius);
        }
        const key = `test:${p.pack}/${d.id}`;
        const model = prepareSwayModel(scenes, key, d.id, { flora: true, building: false });
        // The rule's edges, named should the count ever move: a model swaying on its name alone, one kept still by a word.
        let finestCard = false;
        scenes[0].traverse((o) => {
          if ((o as THREE.Mesh).isMesh && materialsOf(o as THREE.Mesh).some((x) => x.userData.swgCardBlend !== undefined)) finestCard = true;
        });
        if (model && !finestCard) byNameOnly.push(d.id);
        if (!model && (finestCard || SOFT_PLANT.test(d.id)) && RIGID.test(d.id)) byRigid.push(d.id);
        if (!model) {
          for (const m of meshes) if (materialsOf(m).some((x) => x.userData.swgSway !== undefined)) strayMark++;
          continue;
        }
        swaying++;
        for (const m of meshes) {
          if (!materialsOf(m).every((x) => x.userData.swgSway === key)) unmarked++;
          const g = m.geometry;
          if (Math.abs(g.boundingSphere!.radius - (radii.get(g)! + model.excursion)) > 1e-6 || g.userData.swgSwayPad !== model.excursion) unpadded++;
        }
        // The same model loaded again (a second pack, a clone of the scene) grows nothing further.
        prepareSwayModel(scenes, key, d.id, { flora: true, building: false });
        for (const m of meshes) if (Math.abs(m.geometry.boundingSphere!.radius - (radii.get(m.geometry)! + model.excursion)) > 1e-6) padTwice++;
        // Drawn as the flora draws it: an instanced mesh per primitive, each handed its depth material.
        for (const m of meshes) {
          if (Array.isArray(m.material)) continue;
          const im = new THREE.InstancedMesh(m.geometry, m.material, 1);
          hangSwayDepth(im);
          if (!im.customDepthMaterial) noDepth++;
          swayMeshes.push(im);
        }
      }
    }
    // Exactly the measured number over the converted set it was measured on; another set of packs (a world left out,
    // a newer conversion) can only be held to sway something.
    if (models === 455) ok(swaying === 269, `the selection rule sways exactly the measured 269 of the 455 flora models (${swaying})${swaying === 269 ? '' : `; on the rule's edges: swaying by name alone ${byNameOnly.slice(0, 8).join(', ') || 'none'}, kept still by a rigid word ${byRigid.slice(0, 8).join(', ') || 'none'}`}`);
    else ok(swaying > 0, `the selection rule sways ${swaying} of ${models} flora models (the measured 269 was of 455; this folder holds another set)`);
    ok(unmarked === 0 && strayMark === 0, `every material of a swaying model, at every level, carries its model's key, and nothing of a still one does (${unmarked} unmarked, ${strayMark} marked still)`);
    ok(unpadded === 0 && padTwice === 0, `every geometry of a swaying model has its sphere grown once by the model's excursion (${unpadded} not, ${padTwice} grown twice)`);
    ok(noDepth === 0 && swayMeshes.length > 0, `every swaying mesh drawn as the flora draws it is handed a depth material (${swayMeshes.length} meshes)`);
    // The combinations as three keys a depth program: instancing, the side the shadow is drawn from, the cut, the
    // picture and its coordinate set, the second and third sets.
    const combos = new Set<string>();
    for (const m of swayMeshes) {
      const s = m.material as THREE.MeshStandardMaterial;
      const side = s.shadowSide ?? (s.side === THREE.FrontSide ? THREE.BackSide : s.side === THREE.BackSide ? THREE.FrontSide : THREE.DoubleSide);
      combos.add(`${side}|${s.alphaTest > 0}|${!!s.map}|${s.map?.channel ?? 0}|${!!s.alphaMap}|${!!m.geometry.attributes.uv1}|${!!m.geometry.attributes.uv2}`);
    }
    const standIns = swayDepthStandIns(swayMeshes);
    ok(standIns.length === combos.size && standIns.every((s) => (s as THREE.InstancedMesh).isInstancedMesh && s.castShadow && s.customDepthMaterial?.customProgramCacheKey() === 'swg-sway-depth' && (s.material as THREE.Material).userData.swgSway !== undefined), `the warm list holds one instanced, casting stand-in per depth combination, wearing its source's material and hanging its depth material (${standIns.length} for ${combos.size})`);
    for (const s of standIns) disposeStandIn(s);
    const was = SWAY_TUNE.shadow;
    setSwayTune({ shadow: false });
    let still = 0;
    for (const m of swayMeshes.slice(0, 50)) {
      hangSwayDepth(m);
      if (m.customDepthMaterial) still++;
    }
    ok(still === 0 && swayDepthStandIns(swayMeshes).length === 0, "with `shadow` off the depth materials come off and nothing is warmed");
    setSwayTune({ shadow: was });

    // 6. Placed models: one that wears a card sways on the same terms; one that does not, or a building, never.
    const placedMeshes: THREE.Mesh[] = [];
    let placedSway = 0;
    let placedWrong = 0;
    let checked = 0;
    for (const p of packs) {
      for (const d of p.manifest.categories.layout ?? []) {
        if (checked >= 300) break;
        const file = join(p.dir, d.file);
        if (!file.endsWith('.glb') || !existsSync(file)) continue;
        const json = glbJsonOf(file);
        const wears = (json.materials ?? []).some((m) => isCardJson(m) && names.has(m.name ?? ''));
        if (!wears && checked % 3) continue;
        checked++;
        const { scenes } = glbScenes(file);
        prepareCardModel(scenes, { flora: false, count: false }, 'cards');
        const building = !!d.cells?.length;
        const model = prepareSwayModel(scenes, `test:placed:${p.pack}/${d.id}`, d.id, { flora: false, building });
        let carries = false;
        scenes[0].traverse((o) => {
          if ((o as THREE.Mesh).isMesh && materialsOf(o as THREE.Mesh).some((x) => x.userData.swgCardBlend !== undefined)) carries = true;
        });
        if (model) placedSway++;
        if ((model && (building || !carries)) || (!model && carries && !building && !RIGID.test(d.id))) placedWrong++;
        // A placed tier draws it instanced, as the flora does.
        if (model) for (const s of scenes) s.traverse((o) => void ((o as THREE.Mesh).isMesh && !Array.isArray((o as THREE.Mesh).material) && placedMeshes.push(new THREE.InstancedMesh((o as THREE.Mesh).geometry, (o as THREE.Mesh).material as THREE.Material, 1))));
      }
    }
    // A folder holding the flora alone (a pilot conversion) has no placed model to read.
    if (!checked) console.log('     (no placed model on disk here: the placed check waits for a folder that has them)');
    else ok(placedWrong === 0, `a placed model sways exactly when it wears a card at its finest level and is no building nor named rigid (${placedSway} of ${checked} placed models sway)`);

    // 5b. The fixed combinations the world's warm-up always draws (`swayDepthCombos`) are every one these swaying
    // meshes, planted and placed, cast with, in the terms three keys a depth program by: instancing, the side the
    // shadow is drawn from, the cut, the picture's coordinate set and an alpha picture's. So a placed tier streamed
    // in after the loading screen never brings a depth combination nothing warmed.
    const keyOf = (m: THREE.Mesh): string => {
      const s = m.material as THREE.MeshStandardMaterial;
      const side = s.shadowSide ?? (s.side === THREE.FrontSide ? THREE.BackSide : s.side === THREE.BackSide ? THREE.FrontSide : THREE.DoubleSide);
      return `${(m as THREE.InstancedMesh).isInstancedMesh === true}|${side}|${s.alphaTest > 0}|${s.map ? s.map.channel : 'none'}|${s.alphaMap ? s.alphaMap.channel : 'none'}`;
    };
    const fixed = new Set(swayDepthCombos().map(keyOf));
    const real = new Set([...swayMeshes, ...placedMeshes].map(keyOf));
    const uncovered = [...real].filter((k) => !fixed.has(k));
    ok(swayDepthCombos().every((m) => m.material && (m.material as THREE.Material).userData.swgSway === SWAY_COMBO_KEY) && fixed.size === swayDepthCombos().length, `the fixed combinations are ${fixed.size} sources of their own, each a combination apart, marked as no model's`);
    ok(uncovered.length === 0, `and they cover every combination the swaying meshes on disk cast with (${real.size} met, planted and placed${uncovered.length ? `; not covered: ${uncovered.join(', ')}` : ''})`);
    const warmed = swayDepthStandIns(swayDepthCombos(), 'test');
    ok(warmed.length === fixed.size && warmed.every((s) => s.castShadow && s.customDepthMaterial?.customProgramCacheKey() === 'swg-sway-depth'), 'each of them makes a stand-in casting with a depth material of the sway\'s one key');
    for (const s of warmed) disposeStandIn(s);
  }
}

console.log(`\nfloraSway: ${passed} checks passed`);
