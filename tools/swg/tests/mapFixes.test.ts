// The map fixes' first wave (A:\swg3js\mapfix\DESIGN.md Â§3): the bombed house's decals drawn the client's way and
// never solid nor drawn outside their room, the world builder's markers drawn nowhere, invisible panes casting nothing,
// fittings the layout already stands not stood twice, lily pads on the water, arrivals on open ground judged on the
// real ground, the ports' rule for a world's centre, the room arrivals, Tansarii's way in, Kashyyyk's zone names, the
// emulator's launch, landing, cloning and tutorial data, and the library asking again for a world converted since.
//
// Every section runs the game's or the converter's own code: the real streamer over the real physics
// (`streamHarness.ts`), the real furniture hosting, the real planter, the real readers over the committed Core3
// reference, and the packs on disk where they are converted (each such part says so and is skipped where they are not).
// A hand-over only the game makes is pinned as text. Nothing is written but a temporary folder; counts are printed.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { THREE, boxGeo, loadedOf, makeStreamer, type Def } from './streamHarness.ts';

// After the harness: it stands a stub in front of the particle player before the streamer's graph loads.
const { CLEAR_SPAWN, DOORLESS_ENTRY, LayoutStreamer, TOOL_ONLY_TEMPLATES, arrivalSlope, isToolOnly, openGroundAt, sameTemplateName } = await import('../../../src/world/layoutStream.ts');
const { AnimatedSurfaces, DECAL_TUNE, applyDecal, castsShadow, isDecal, isDecalShader } = await import('../../../src/world/surfaces.ts');
const { FURNITURE_TUNE, HOST_FLAG, furnitureHosts } = await import('../../../src/world/furnitureHost.ts');
const { FloraPlanter } = await import('../../../src/world/flora.ts');
const { arrivalBuilding, arrivalInGame } = await import('../../../src/world/arrival.ts');
const { STANDING_TWICE, cloningPointOf, cloningPointsOf, fittingsOf, fittingsReadable, tubeFor, FITTINGS_PACK_VERSION } = await import('../../../src/world/fittings.ts');
const { ROOM_CREW_WORLDS, packHolds } = await import('../../../src/world/packFiles.ts');
const { PLANETS } = await import('../../../src/data/planets.ts');
const { landingInGame, landingsOf, launchAt } = await import('../../../src/space/spaceData.ts');
const { launchForward } = await import('../../../src/space/hyperspaceMath.ts');
const { namedCellIndex } = await import('../../../src/world/cloning.ts');
const { autoCenter, portKindOf } = await import('../places.mjs');
const { core3Source } = await import('../core3ref.mjs');
const { LAUNCH_FIT_MOST, SPACE_PACK_VERSION, STATION_STANDOFF, landingsFor, launchArrival, spaceZoneStatus } = await import('../space.mjs');
const { MATERIAL_FORMAT } = await import('../surface.mjs');
const { TUTORIAL_HALL, tutorialCrew, tutorialFittingRows } = await import('../tutorial.mjs');
const { packRow } = await import('../spawnpack.mjs');
const { libraryStatus, libraryWorlds } = await import('../library.mjs');

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const REPO = new URL('../../../', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, REPO), 'utf8').replace(/\r\n/g, '\n');
const PACKS = process.env.SWG3JS_PACKS ?? new URL('assets-private/', REPO).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const packJson = (pack: string, file: string): any => {
  const p = join(PACKS, pack, file);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};
/** A method's text out of a source (from its signature to the first line that closes it at its own indent). */
function methodOf(src: string, sig: string): string {
  const at = src.indexOf(sig);
  if (at < 0) return '';
  const indent = sig.match(/^\s*/)?.[0] ?? '';
  const end = src.indexOf(`\n${indent}}\n`, at);
  return src.slice(at, end < 0 ? undefined : end);
}

// ---------------------------------------------------------------------------------------------
// 3.1 The decals: the client's way, never solid, never outside their room.
{
  // The rule is the shader's name, measured over every GLB: the scorches, graffiti and marks and the moon decals.
  for (const n of ['shader/decal_main_blast.sht', 'shader/decal_blast_lg.sht', 'shader/decal_blast_sm.sht', 'shader/decal_meatlump_aur_s02_aa7.sht', 'shader/moon_decal_aa7.sht', 'shader/decal_deathtrooper_smear_01_aa7.sht']) ok(isDecalShader(n), `a decal by its shader: ${n}`);
  for (const n of ['shader/ksk_metl_decal_asb14.sht', 'shader/sd_metal_decal2_cd8.sht', 'shader/ivy_decal_arbor_apb15.sht', 'shader/dath_prison_decal_adb13.sht', 'shader/plain.sht']) ok(!isDecalShader(n), `no decal: ${n} (an opaque surface with a sign painted on, or a true cut-out)`);
  // The plugin makes one: blended, no depth write, cut only where wholly clear, offset, casting nothing.
  const s = new AnimatedSurfaces();
  const registered: ((parser: unknown) => { afterRoot: (r: unknown) => Promise<void> | null })[] = [];
  s.withPlugin({ register(cb: (typeof registered)[number]) { registered.push(cb); return this; } } as never);
  const decal = new THREE.MeshStandardMaterial({ name: 'shader/decal_main_blast.sht', alphaTest: 0.5 });
  const wall = new THREE.MeshStandardMaterial({ name: 'shader/plain.sht', alphaTest: 0.5 });
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BufferGeometry(), decal), new THREE.Mesh(new THREE.BufferGeometry(), wall));
  const plugin = registered[0]({ json: { materials: [{ name: decal.name }, { name: wall.name }] }, getDependency: () => Promise.reject(new Error('no')) });
  ok(plugin.afterRoot({ scene, scenes: [scene] }) === null, 'a GLB with no animated surface still returns at once from the plugin');
  ok(decal.transparent && !decal.depthWrite && decal.alphaTest === DECAL_TUNE.alphaFloor && decal.polygonOffset && isDecal(decal), 'and its decal is drawn the client\'s way: blended, writing no depth, cut only where wholly clear, held over what it lies on');
  ok(!castsShadow(decal) && castsShadow(wall) && wall.alphaTest === 0.5 && !wall.transparent, 'the decal casts no shadow; the plain wall beside it is as it was');
  // An invisible pane casts nothing either (3.3).
  const pane = new THREE.MeshStandardMaterial();
  pane.userData.invisible = true;
  ok(!castsShadow(pane) && !castsShadow([wall, pane]), 'a pane nobody sees (e_invisible_collidable) casts no shadow, alone or beside another material');
  // A fresh one through applyDecal is the same.
  const fresh = new THREE.MeshBasicMaterial();
  applyDecal(fresh);
  ok(fresh.userData.noShadow === true && fresh.userData.decal === true, 'applyDecal marks the material for the shadow and collider rules');
  // Three turns a polygon offset's factor round under reversed depth and not its units: both the plugin and the console's
  // knob turn the units themselves, or under reversed depth a decal is pushed into what it lies on.
  ok(/\n  m\.polygonOffsetUnits = REVERSED_DEPTH \? -DECAL_TUNE\.units : DECAL_TUNE\.units;\n/.test(read('src/world/surfaces.ts')), 'a decal\'s offset units are turned round under reversed depth (text)');
  ok(/m\.polygonOffsetUnits = REVERSED_DEPTH \? -DECAL_TUNE\.units : DECAL_TUNE\.units;/.test(read('src/main.ts')), 'and so are they when the console moves them (text)');
}

// The collider sweep leaves a decal out: the real streamer, the real physics.
{
  const SCORCH: Def = { id: 'scorch', file: 'scorch.glb', bounds: { min: [-59, 0, -59], max: [59, 0.1, 59] }, triangles: 2 };
  const SLAB: Def = { id: 'slab', file: 'slab.glb', bounds: { min: [-5, 0, -5], max: [5, 0.5, 5] }, triangles: 12 };
  const scorchMat = new THREE.MeshStandardMaterial({ name: 'shader/decal_main_blast.sht' });
  applyDecal(scorchMat);
  const h = await makeStreamer(
    [
      { template: 'object/static/worldbuilding/decal/shared_mun_decal_blast_main.iff', model: 'scorch', x: -100, y: 0, z: 100, q: [1, 0, 0, 0], radius: 1024 },
      { template: 'object/static/slab', model: 'slab', x: -150, y: 0, z: 100, q: [1, 0, 0, 0], radius: 20 },
    ],
    { defs: [SCORCH, SLAB], models: { scorch: loadedOf(SCORCH, [{ geometry: boxGeo(118, 0.1, 118, 0.5), cell: -1, material: scorchMat }]), slab: loadedOf(SLAB, [{ geometry: boxGeo(10, 0.5, 10, 0), cell: -1 }]) } },
  );
  await h.settle({ x: 120, z: 100 });
  ok(h.rayDown(100, 100, 5) === null, 'the scorch decal, solid by the size rule, has no collider: a ray down through it meets nothing');
  ok(h.rayDown(150, 100, 5) !== null, 'a plain slab beside it is solid as ever');
  const blockers = (h.s.blockList as { o: { model: string } }[]).map((b) => b.o.model);
  ok(!blockers.includes('scorch') && blockers.includes('slab'), 'and a thing that came to no collider is cover for nobody');
  const stream = read('src/world/layoutStream.ts');
  ok(/\|\| isDecal\(prim\.material\)\) \{/.test(stream) && /\n\s+if \(isDecal\(prim\.material\)\) continue;/.test(stream), 'both collider paths, the plain one and the one for things kilometres wide, leave a decal out (text)');
}

// The doorway rule leaves out a thing far bigger than its building: the real hosting over a made-up house.
{
  const HOUSE: any = {
    id: 'house',
    bounds: { min: [-10, -16, -10], max: [10, 8, 10] },
    cells: [
      { index: 0, name: 'r0', bounds: { min: [-10, -16, -10], max: [10, 8, 10] }, portals: [{ geometry: 0, target: 1 }] },
      { index: 1, name: 'r1', bounds: { min: [-9, 0, -9], max: [9, 7.5, 9] }, portals: [{ geometry: 0, target: 0 }] },
    ],
    portals: [{ v: [[-1, 0, 10], [1, 0, 10], [1, 2, 10], [-1, 2, 10]], i: [0, 1, 2, 0, 2, 3] }],
  };
  const defs: Record<string, any> = {
    house: HOUSE,
    scorch: { id: 'scorch', bounds: { min: [-59, 0, -59], max: [59, 0.1, 59] } },
    sign: { id: 'sign', bounds: { min: [-0.8, 0, -0.2], max: [0.8, 1.2, 0.2] } },
    rug: { id: 'rug', bounds: { min: [-2, 0, -2], max: [2, 0.05, 2] } },
  };
  const q = { x: 0, y: 0, z: 0, w: 1 };
  const objects = [
    { model: 'house', x: 0, y: 0, z: 0, q, contained: false },
    { model: 'scorch', x: 0, y: 0.05, z: 0, q, contained: true, hostIndex: 0, cell: 1 },
    { model: 'sign', x: 0, y: 1, z: 9.6, q, contained: true, hostIndex: 0, cell: 1 },
    { model: 'rug', x: 0, y: 0.05, z: 0, q, contained: true, hostIndex: 0, cell: 1 },
  ];
  const hosted = furnitureHosts(objects, (id: string) => defs[id], FURNITURE_TUNE);
  ok(hosted.host[1] === 0 && !(hosted.flags[1] & HOST_FLAG.doorway), 'a 118 m decal in a 20 m house is held by its room and never taken for a thing in its doorway');
  ok(hosted.host[2] === 0 && !!(hosted.flags[2] & HOST_FLAG.doorway), 'a sign at the door still stands in the doorway');
  ok(hosted.host[3] === 0 && !(hosted.flags[3] & HOST_FLAG.doorway), 'a rug in the middle of the room is the room\'s');
  const loose = furnitureHosts(objects, (id: string) => defs[id], { ...FURNITURE_TUNE, pastBox: Infinity });
  ok(!!(loose.flags[1] & HOST_FLAG.doorway), 'with the rule taken off, the decal is a doorway thing again (drawn in every pass): the rule is what moved it');
}

// Over the packs on disk: the bombed house's two big decals are held by their room and nothing else changes kind.
{
  const lay = packJson('tatooine', 'layout.json');
  const man = packJson('tatooine', 'manifest.json');
  if (!lay || !man) console.log('skip the bombed house in Mos Eisley: no Tatooine pack');
  else {
    const { fileByState } = await import('../../../src/world/worldState.ts');
    const defs = new Map<string, any>();
    for (const list of Object.values(man.categories ?? {}) as any[]) for (const d of list) defs.set(d.id, d);
    const filed = fileByState(lay.objects, () => true);
    const objs: any[] = [];
    lay.objects.forEach((o: any, li: number) => {
      if (filed.placedAt[li] < 0) return;
      const p: any = { model: o.model, x: -(o.x - lay.center.x), y: o.y, z: o.z - lay.center.z, q: { x: o.q[1], y: -o.q[2], z: -o.q[3], w: o.q[0] }, contained: !!o.contained, li };
      if (o.contained && typeof o.in === 'number' && typeof o.cell === 'number') {
        p.hostIndex = filed.host[li];
        p.cell = o.cell;
      }
      objs.push(p);
    });
    const hosted = furnitureHosts(objs, (id: string) => defs.get(id), FURNITURE_TUNE);
    const old = furnitureHosts(objs, (id: string) => defs.get(id), { ...FURNITURE_TUNE, pastBox: Infinity });
    let changed = 0;
    const decals: string[] = [];
    for (let i = 0; i < objs.length; i++) {
      if (!objs[i].contained) continue;
      const a = !!(hosted.flags[i] & HOST_FLAG.doorway);
      const b = !!(old.flags[i] & HOST_FLAG.doorway);
      if (a !== b) {
        changed++;
        decals.push(objs[i].model);
      }
    }
    ok(changed === 2 && decals.every((m) => /decal/.test(m)), `on Tatooine exactly the bombed house's two big decals leave the doorway rule (${decals.join(', ')})`);
  }
}

// ---------------------------------------------------------------------------------------------
// 3.2 The world builder's markers: their flora circle and nothing else.
{
  ok(TOOL_ONLY_TEMPLATES.size === 3 && isToolOnly('object/static/structure/nobuild/shared_noflora_10.iff') && !isToolOnly('object/static/structure/nobuild/shared_nobuild_32.iff'), 'the three no-flora rings are the markers, by template');
  const RING: Def = { id: 'godclient_cylinder_20m', file: 'ring.glb', bounds: { min: [-10, 0, -10], max: [10, 2, 10] }, triangles: 72 };
  const HALLDEF: any = { id: 'hut', file: 'hut.glb', bounds: { min: [-5, 0, -5], max: [5, 4, 5] }, triangles: 12, cells: [{ index: 0, name: 'r0', bounds: { min: [-5, 0, -5], max: [5, 4, 5] }, portals: [] }, { index: 1, name: 'r1', bounds: { min: [-4, 0, -4], max: [4, 3, 4] }, portals: [] }], portals: [] };
  const h = await makeStreamer(
    [
      { template: 'object/static/structure/nobuild/shared_noflora_10.iff', model: 'godclient_cylinder_20m', x: -100, y: 0, z: 100, q: [1, 0, 0, 0], radius: 128 },
      { template: 'object/building/hut', model: 'hut', x: -200, y: 0, z: 100, q: [1, 0, 0, 0], radius: 10 },
      { template: 'object/static/crate', model: 'crate', x: -200, y: 0.1, z: 100, q: [1, 0, 0, 0], radius: 2, ...({ contained: true, in: 1, cell: 1 } as object) },
    ] as never,
    { defs: [RING, HALLDEF], models: { godclient_cylinder_20m: loadedOf(RING, [{ geometry: boxGeo(20, 2, 20, 0), cell: -1 }]), hut: loadedOf(HALLDEF, [{ geometry: boxGeo(10, 4, 10, 0), cell: 0 }], [new THREE.Box3(new THREE.Vector3(-4, 0, -4), new THREE.Vector3(4, 3, 4))]) } },
  );
  await h.settle({ x: 120, z: 100 });
  ok(h.rayDown(100, 100, 5) === null && h.meshesAt(100, 100) === 0, 'a no-flora ring is drawn nowhere and is solid nowhere');
  ok(h.stream.objectsNear(100, 100, 5).length === 0 && h.stream.toolOnly === 1, 'and is in the way of nothing, counted as a marker');
  const circles = h.stream.exclusionsFor(Math.floor(100 / 64), Math.floor(100 / 64));
  ok(circles.some((e: { x: number; z: number; r: number }) => Math.abs(e.x - 100) < 0.01 && Math.abs(e.z - 100) < 0.01 && e.r >= 9), 'and keeps the plants off its circle, as it was put down to');
  const crate = h.s.objects[2];
  ok(crate.hostIndex === 1 && h.s.objects[crate.hostIndex].model === 'hut', 'a thing in a room after the marker still names its own building: the marker keeps its place in the list');
  // Filed again by either rule (the world editor's Fold now, the console's filing switch): still nowhere.
  for (const rule of ['snapshot', 'model'] as const) {
    ok(h.stream.refile(rule, true), `the world is filed again by the ${rule} rule`);
    await h.settle({ x: 120, z: 100 });
    ok(h.rayDown(100, 100, 5) === null && h.meshesAt(100, 100) === 0 && h.stream.objectsNear(100, 100, 5).length === 0, `and the ring is still drawn nowhere, solid nowhere and in nobody's way after it (${rule})`);
    await h.settle({ x: 195, z: 100 });
    ok(h.meshesAt(200, 100) > 0 && h.rayDown(200, 100, 5) !== null, `while the hut beside it is filed and built again, drawn and solid (${rule})`);
  }
}

// A marker of a world state not standing (Restuss's other state) is out of the dormant list as well: only its circle is kept.
{
  const RING: Def = { id: 'godclient_cylinder_20m', file: 'ring.glb', bounds: { min: [-10, 0, -10], max: [10, 2, 10] }, triangles: 72 };
  const h = await makeStreamer(
    [
      { template: 'object/static/structure/nobuild/shared_noflora_15.iff', model: 'godclient_cylinder_20m', x: -100, y: 0, z: 100, q: [1, 0, 0, 0], radius: 128, state: 'restuss=living' },
      { template: 'object/static/crate', model: 'crate', x: -130, y: 0, z: 100, q: [1, 0, 0, 0], radius: 2, state: 'restuss=living' },
    ],
    { defs: [RING], models: { godclient_cylinder_20m: loadedOf(RING, [{ geometry: boxGeo(20, 2, 20, 0), cell: -1 }]) }, stands: (tag?: string) => !tag },
  );
  const dormant = h.s.dormant as { template: string }[];
  ok(dormant.length === 1 && dormant[0].template === 'object/static/crate', 'of two objects of a state not standing, only the crate lies dormant: the marker is in no list');
  ok(h.stream.exclusionsFor(Math.floor(100 / 64), Math.floor(100 / 64)).some((e: { x: number; z: number }) => Math.abs(e.x - 100) < 0.01 && Math.abs(e.z - 100) < 0.01), 'and the plants are still kept off its circle');
}

// ---------------------------------------------------------------------------------------------
// 3.4 A fitting the layout already stands is not stood twice.
{
  ok(sameTemplateName('object/tangible/camp/shared_camp_tent_s1.iff') === sameTemplateName('object/tangible/camp/camp_tent_s1.iff'), 'a template\'s two spellings are one name');
  const h = await makeStreamer([{ template: 'object/tangible/camp/shared_campfire.iff', model: 'crate', x: -10, y: 2, z: 10, q: [1, 0, 0, 0], radius: 4 }]);
  ok(h.stream.standsTemplateNear('object/tangible/camp/campfire.iff', 10.2, 2, 10.1, STANDING_TWICE), 'a fitting of the template the layout stands, at the same spot, is standing already');
  ok(!h.stream.standsTemplateNear('object/tangible/camp/campfire.iff', 12, 2, 10, STANDING_TWICE) && !h.stream.standsTemplateNear('object/tangible/camp/tent.iff', 10, 2, 10, STANDING_TWICE), 'a metre off, or another template, is not');
  ok(!h.stream.standsTemplateNear('object/tangible/camp/campfire.iff', 10, 3, 10, STANDING_TWICE), 'nor one at the same x and z a metre higher: the height counts');
  // A thing put down in play is no reason to skip one: a player's own, or another run's fitting not yet finished standing.
  await h.stream.place({ model: 'crate', template: 'fitting:tatooine:1:0', effectsOf: 'object/tangible/camp/shared_campfire.iff', x: 30, y: 0, z: 10, q: new THREE.Quaternion(), radius: 1, solid: true });
  ok(!h.stream.standsTemplateNear('object/tangible/camp/campfire.iff', 30, 0, 10, STANDING_TWICE), 'a fitting of that template put down in play does not answer for the layout');
  await h.stream.place({ model: 'crate', template: 'object/tangible/camp/shared_campfire.iff', x: 50, y: 0, z: 10, q: new THREE.Quaternion(), radius: 1, solid: true });
  ok(!h.stream.standsTemplateNear('object/tangible/camp/campfire.iff', 50, 0, 10, STANDING_TWICE), 'nor does anything put down in play under the template\'s own name: only the layout\'s own rows do');
  ok(STANDING_TWICE === 0.5, 'the design\'s half metre');
  const main = read('src/main.ts');
  const stand = methodOf(main, '  private async standFittings(');
  ok(/placeProp\(f\.model, \{.*solid: true, template: f\.template, unlessStanding: true \}\)/.test(stand), 'the world stands its fittings unless the layout already stands them, naming the template it asks by (text)');
  const world = read('src/world/world.ts');
  ok(/if \(o\.unlessStanding && o\.template && stream\.standsTemplateNear\(o\.template, o\.at\.x, o\.at\.y, o\.at\.z, STANDING_TWICE\)\)/.test(world) && /import \{ STANDING_TWICE, type CloningPoint \} from '\.\/fittings\.ts';/.test(world), 'placeProp asks the streamer before it stands one, by the shared half metre (text)');
  // Over the packs on disk: the real streamer over each world's own layout, asked of each fitting in the world's frame exactly
  // as the game asks it. Measured: 61 over seven worlds, every one a row the server stood (`server:`).
  const SKIPPED: Record<string, number> = { tatooine: 21, corellia: 13, talus: 12, naboo: 10, rori: 3, lok: 1, dathomir: 1, dantooine: 0, endor: 0, yavin4: 0 };
  const { Physics } = await import('../../../src/core/physics.ts');
  const physics = await Physics.create();
  for (const [w, want] of Object.entries(SKIPPED)) {
    const f = packJson(w, 'fittings.json');
    const l = packJson(w, 'layout.json');
    const man = packJson(w, 'manifest.json');
    if (!f || !l || !man || !fittingsReadable(f.version)) {
      console.log(`skip ${w}'s doubles: no fittings, layout or manifest`);
      continue;
    }
    const defs = new Map<string, any>();
    for (const list of Object.values(man.categories ?? {}) as any[]) for (const d of list) defs.set(d.id, d);
    const pack = { manifest: man, root: `/assets-private/${w}/`, objectEffects: null, doors: null, find: (id: string) => defs.get(id), isFlora: () => false, loaded: () => null, model: async () => Promise.reject(new Error('no model in a count')) };
    const stream = new LayoutStreamer(new THREE.Scene(), physics, pack as never, l as never, null, {});
    let skipped = 0;
    for (const x of fittingsOf(f.rows, l.center)) if (x.template && stream.standsTemplateNear(x.template, x.x, x.y, x.z, STANDING_TWICE)) skipped++;
    ok(skipped === want, `${w}: the game skips ${skipped} of its ${f.rows.length} fittings as standing already (${want} measured)`);
  }
}

// ---------------------------------------------------------------------------------------------
// 3.5 Lily pads float: the real planter over a stub world.
{
  const pad = (family: number) => ({ familyId: family, appearance: 'appearance/lily.apt', weight: 1, shouldSway: false, displacement: 0, period: 0, alignToTerrain: false, shouldScale: false, minScale: 1, maxScale: 1 });
  const families = new Map<number, { floats: boolean }>([[1, { floats: true }], [2, { floats: false }]]);
  const swg = {
    template: {
      mapWidthInMeters: 16384,
      flora: { collidable: { tileBorder: 0 }, nonCollidable: { tileSize: 8, tileBorder: 0, maximumDistance: 50 }, legacyMap: true, collidableMap: null },
      generator: { floraGroup: { createFlora: (family: number) => (family ? pad(family) : null), families } },
    },
    toSwgX: (x: number) => -x,
    toSwgZ: (z: number) => z,
    toGameX: (x: number) => -x,
    toGameZ: (z: number) => z,
    sampler: { excludedAt: () => false, floraAt: (x: number, _z: number, collidable: boolean) => (collidable ? { family: 0, choice: 0 } : { family: x < -32 ? 1 : 2, choice: 0.5 }) },
  };
  const model = { primitives: [{ geometry: new THREE.BoxGeometry(1, 0.1, 1), material: new THREE.MeshBasicMaterial(), cell: 0 }], radius: 0.5, height: 0.1, def: {} };
  const planter = new FloraPlanter(swg as never, new Map([['appearance/lily.apt', model]]) as never);
  const ground = () => 10;
  const lake = (x: number) => (x < 48 ? 12 : -Infinity);
  const built = planter.buildForChunk(0, 0, ground, [], lake);
  const ys: { x: number; y: number }[] = [];
  for (let i = 0; i < built.data.n; i++) ys.push({ x: built.data.x[i], y: built.data.y[i] });
  const floating = ys.filter((p) => p.x > 32);
  const rooted = ys.filter((p) => p.x <= 32);
  ok(floating.length > 0 && floating.filter((p) => p.x < 48).every((p) => p.y === 12) && floating.filter((p) => p.x >= 48).every((p) => p.y === 10), 'a floating family stands on the water over a lake bed, and on the ground where there is no water');
  ok(rooted.length > 0 && rooted.every((p) => p.y === 10), 'a family that does not float stands on the bed under the water, as it did');
  const dry = planter.buildForChunk(0, 0, ground, []);
  ok([...dry.data.y].every((y) => y === 10), 'with no water asked, every planting stands on the ground as before');
  // The collidable flora's own path (one a 16 m tile) floats a floating family the same way: the rest of the chunk bare.
  const tall = { ...swg, sampler: { excludedAt: () => false, floraAt: (_x: number, _z: number, collidable: boolean) => (collidable ? { family: 1, choice: 0.5 } : { family: 0, choice: 0 }) } };
  const trees = new FloraPlanter(tall as never, new Map([['appearance/lily.apt', model]]) as never).buildForChunk(0, 0, ground, [], lake);
  const ty: { x: number; y: number }[] = [];
  for (let i = 0; i < trees.data.n; i++) ty.push({ x: trees.data.x[i], y: trees.data.y[i] });
  ok(ty.length > 0 && ty.every((p) => p.y === (p.x < 48 ? 12 : 10)) && ty.some((p) => p.x < 48), `a floating family planted on the collidable tiling stands on the water too (${ty.length} plantings)`);
  ok(/buildForChunk\(cx, cz, \(x, z\) => this\.terrain\.heightAt\(x, z\), exclude, \(x, z\) => this\.waterColumnAt\(x, z\)\)/.test(read('src/world/world.ts')), 'the world plants a chunk with the drawn water over each column, lava left out (text)');
}

// ---------------------------------------------------------------------------------------------
// 3.6 Arrivals: open ground by each object's own box, judged on the real ground.
{
  const BIG: Def = { id: 'port', file: 'port.glb', bounds: { min: [-20, 0, -20], max: [20, 10, 20] }, triangles: 12 };
  const h = await makeStreamer([{ template: 'object/building/tatooine/shared_starport_tatooine.iff', model: 'port', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], radius: 1024 }], { defs: [BIG], models: { port: loadedOf(BIG, [{ geometry: boxGeo(40, 10, 40, 0), cell: -1 }]) } });
  const flat = () => 0;
  const at = h.stream.clearSpawn(new THREE.Vector3(0, 0, 0), flat);
  ok(!!at && Math.hypot(at.x, at.z) > 20 + CLEAR_SPAWN.pad && Math.hypot(at.x, at.z) < 20 * Math.SQRT2, `open ground is found just past the port's own box (${at ? Math.hypot(at.x, at.z).toFixed(1) : 'none'} m out), never inside the snapshot's 1024 m radius nor the circle round the box`);
  const wet = h.stream.clearSpawn(new THREE.Vector3(0, 0, 0), flat, (x: number) => x > 100);
  ok(!!wet && wet.x > 100, 'a spot the world will not take (under water, too steep) is passed over for one it will');
  ok(h.stream.clearSpawn(new THREE.Vector3(0, 0, 0), flat, () => false) === null, 'and none at all answers null, which leaves the arrival where it was');
  // No clear spot gentle enough: the gentlest dry one clear of every box (`rank`), never the flattest spot inside the port.
  const gentlest = h.stream.clearSpawn(new THREE.Vector3(0, 0, 0), flat, () => false, (x: number, z: number) => (x < 0 ? Infinity : 1 / (1 + z + 200)));
  ok(!!gentlest && gentlest.x >= 0 && Math.max(Math.abs(gentlest.x), Math.abs(gentlest.z)) > 20 + CLEAR_SPAWN.pad - 1e-9 && gentlest.z > 100, `with none standable, the clear spot the rank puts lowest (${gentlest ? `${gentlest.x.toFixed(1)}, ${gentlest.z.toFixed(1)}` : 'none'}), outside the port's box`);
  ok(h.stream.clearSpawn(new THREE.Vector3(0, 0, 0), flat, () => false, () => Infinity) === null, 'and with every spot ranked out (all under water) still none');
  // What "standable" is: dry by a metre and a half and no steeper than `steepest`, over a ground of our own.
  const n = new THREE.Vector3();
  const steepAt = (deg: number) => ({ heightAt: () => 10, waterHeightAt: () => 0, normalAt: (_x: number, _z: number, out: THREE.Vector3) => out.set(Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180), 0) });
  ok(openGroundAt(steepAt(0), 0, 0, n) && openGroundAt(steepAt(CLEAR_SPAWN.steepest - 1), 0, 0, n) && !openGroundAt(steepAt(CLEAR_SPAWN.steepest + 1), 0, 0, n), `ground is open up to ${CLEAR_SPAWN.steepest} degrees and no steeper`);
  const wetGround = { heightAt: () => 10, waterHeightAt: () => 9, normalAt: (_x: number, _z: number, out: THREE.Vector3) => out.set(0, 1, 0) };
  ok(!openGroundAt(wetGround, 0, 0, n) && arrivalSlope(wetGround, 0, 0, n) === Infinity, 'and ground within a metre and a half of the water is neither open nor ranked');
  ok(Math.abs(arrivalSlope(steepAt(60), 0, 0, n) - 0.5) < 1e-9 && arrivalSlope(steepAt(0), 0, 0, n) === 0, 'the rank is one less the normal\'s upright share');
  // A long wall reaching out along its own +x, turned a quarter about the upright: in the game's frame its +x lies along
  // -z, so the first ring's spot along +z is clear and the one along -z is in it. (The snapshot's turn is stored mirrored.)
  const WALL: Def = { id: 'wall', file: 'wall.glb', bounds: { min: [0, 0, -5], max: [40, 6, 5] }, triangles: 12 };
  const s45 = Math.SQRT1_2;
  const hw = await makeStreamer([{ template: 'object/static/wall', model: 'wall', x: 0, y: 0, z: 0, q: [s45, 0, -s45, 0], radius: 50 }], { defs: [WALL], models: { wall: loadedOf(WALL, [{ geometry: boxGeo(40, 6, 10, 0), cell: -1 }]) } });
  ok(Math.abs(hw.s.objects[0].q.y - s45) < 1e-9, 'the wall stands turned a quarter in the game\'s frame');
  const w8 = hw.stream.clearSpawn(new THREE.Vector3(0, 0, 0), flat);
  ok(!!w8 && Math.abs(w8.x) < 0.01 && Math.abs(w8.z - CLEAR_SPAWN.step) < 0.01, `a turned box is tested turned: the first clear spot is one ring out along +z, beside the wall's end and not along it (${w8 ? `${w8.x.toFixed(1)}, ${w8.z.toFixed(1)}` : 'none'})`);
  const world = read('src/world/world.ts');
  ok(/const from = opts\.auto && this\.terrain\.swg \? this\.spawnPoint\(\) : spawn;/.test(world) && /clearSpawn\(from, \(x, z\) => this\.terrain\.heightAt\(x, z\), \(x, z\) => this\.openGround\(x, z\), \(x, z\) => arrivalSlope\(this\.terrain, x, z, tmpN\)\);/.test(world), 'loadPack judges an arrival with no place again on the real ground and looks for open ground from there, else the gentlest dry ground clear of every box (text)');
  ok(/\n    return openGroundAt\(this\.terrain, x, z, tmpN\);\n/.test(methodOf(world, '  private openGround(x: number, z: number): boolean {') + '\n'), 'and open ground is the streamer\'s own rule over the terrain (text)');
  ok(/loadPack\(stand, \{ keepOff, auto: !at && !home \}\)/.test(read('src/main.ts')), 'the arrival asks for it only with no place and no home of its own (text)');
  ok(/if \(h < this\.terrain\.waterHeightAt\(x, z\) \+ 1\.5\) continue;/.test(methodOf(world, '  spawnPoint(): THREE.Vector3 {')), 'the flattest dry spot is dry of the water over each spot, a lake as well as the sea (text)');
}

// The ports' rule for a world's centre: a port building, never a sign.
{
  const snap = { templates: ['object/static/structure/tatooine/shared_thm_sign_starport.iff', 'object/building/tatooine/shared_starport_tatooine.iff', 'object/tangible/x.iff'] };
  const e = (t: number, x: number, z: number) => ({ node: { templateIndex: t }, parentId: 0, world: { pos: [x, 0, z] } });
  const c = autoCenter(snap, [e(0, 5, 5), e(1, 100, 200)]);
  ok(c.x === 100 && c.z === 200 && /starport/.test(c.why), 'a starport sign that comes first is passed over for the starport building');
  const busy = autoCenter(snap, [e(0, 5, 5), e(2, 600, 600), e(2, 610, 610), e(2, 620, 620)]);
  ok(/busiest/.test(busy.why) && busy.x === 610, 'with no port building at all, the busiest square');
  ok(portKindOf('object/building/naboo/shared_hangar_naboo_theed.iff') === 'starport' && portKindOf('object/static/structure/tatooine/shared_thm_sign_starport.iff') === null, 'and the rule is the ports\' own, Theed\'s hangar included');
  ok(!/function autoCenter/.test(read('tools/swg/cli.mjs')) && /import \{ autoCenter,/.test(read('tools/swg/cli.mjs')), 'the converter asks places.mjs\'s rule and keeps no copy of its own (text)');
}

// The room arrivals: Echo Base's Main Hangar and the old tutorial's first room.
{
  const echo = PLANETS.find((p) => p.id === 'adventure2')!;
  const tut = PLANETS.find((p) => p.id === 'tutorial')!;
  ok(echo.arrival?.room?.template === 'object/building/heroic/shared_echo_base.iff' && echo.arrival.room.cell === 'r15', 'Echo Base arrives in its Main Hangar (r15)');
  ok(tut.arrival?.room?.cell === 'r1' && tut.arrival.room.at?.join(',') === '0,0,-3' && tut.arrival.raw.x === 0 && tut.arrival.raw.z === -3, 'the old tutorial arrives in its hall\'s first room at (0, 0, -3) in the hall\'s frame, Core3\'s');
  const home = arrivalInGame(tut.arrival!, { x: 0, z: 0 });
  ok(home.room === tut.arrival!.room && home.x === 0 && home.z === -3, 'the arrival carries its room into the game\'s frame');
  const b = (template: string, x: number, z: number, effectsOf?: string) => ({ template, x, z, ...(effectsOf ? { object: { effectsOf } } : {}) });
  const list = [b('object/building/heroic/shared_echo_base.iff', 5000, 0), b('object/building/heroic/shared_echo_base.iff', 0, 600), b('place/tutorial_newbie_hall', 0, 0, 'object/building/general/shared_newbie_hall.iff')];
  ok(arrivalBuilding(list, { x: 240, z: 546 }, 'object/building/heroic/shared_echo_base.iff') === list[1], 'the copy of the base nearest the arrival is the one stood in');
  ok(arrivalBuilding(list, { x: 0, z: -3 }, 'object/building/general/shared_newbie_hall.iff') === list[2], 'and a permanent row of ours is found by the template it stands as');
  ok(arrivalBuilding(list, { x: 90000, z: 0 }, 'object/building/heroic/shared_echo_base.iff') === null, 'nothing past the reach');
  const man = packJson('adventure2', 'manifest.json');
  if (!man) console.log('skip Echo Base\'s room r15: no adventure2 pack');
  else {
    const base = (Object.values(man.categories ?? {}).flat() as any[]).find((d) => d.id === 'echo_base_pob');
    ok(!!base && namedCellIndex(base.cells, 'r15') > 0, `the base's model has a room named r15 (cell ${base ? namedCellIndex(base.cells, 'r15') : 0})`);
  }
  const main = read('src/main.ts');
  ok(/if \(!c\.pos && home\?\.room\) this\.standInHomeRoom\(home\);/.test(main) && /else if \(homeRoom && home && !arrived\) this\.standInHomeRoom\(home\);/.test(main), 'a new character and a travel with no place stand in the room once the world is in (text)');
  const standInHome = methodOf(main, '  private standInHomeRoom(');
  ok(/\n    const got = this\.world\.standInArrivalRoom\(home\);\n/.test(standInHome) && /\n    p\.reset\(got\.at\);\n/.test(standInHome) && /\n    this\.spawn\.copy\(got\.at\);\n/.test(standInHome), 'which asks the world for the room\'s spot, stands the player there and keeps it as the spawn (text)');
  ok(/const spot = this\.layoutStream\.roomArrivalSpot\(home, home\.room\);/.test(read('src/world/world.ts')), 'and the world asks the streamer\'s rule for it (text)');
  ok(/this\.reenterArrivalRoom\(this\.spawn\);/.test(methodOf(main, '  private respawn(): void {')) && /onFloor = home\?\.room \? this\.standInHomeRoom\(home, true\) : this\.floorUnder\(at\);/.test(methodOf(main, '  private async standAtHome(')), 'and a death comes round in it again, a far one under a loading screen stood in the room (text)');
  ok(/if \(!this\.standInHomeRoom\(home, true\) && !\(await this\.standAtHome\(at, home, 'arriving'/.test(main) && /if \(!home\.room\) this\.spawn\.copy\(at\);/.test(main), 'the console\'s go stands a room arrival in its room, never the spawn in the room\'s air (text)');
}

// The rooms the arrivals, the station's way in and the cloning tubes stand in: the real streamer over buildings of two named
// rooms each, turned a quarter, their floors solid, and every spot held to three's own turn of the building's frame.
{
  const s45 = Math.SQRT1_2;
  const twoRooms = (id: string, names: [string, string]) => {
    const def: any = {
      id,
      file: `${id}.glb`,
      bounds: { min: [-10, 0, -10], max: [10, 8, 10] },
      triangles: 36,
      cells: [
        { index: 0, name: 'r0', bounds: { min: [-10, 0, -10], max: [10, 8, 10] }, portals: [] },
        { index: 1, name: names[0], bounds: { min: [-9, 0, -9], max: [-1, 6, 9] }, portals: [] },
        { index: 2, name: names[1], bounds: { min: [1, 0, -9], max: [9, 6, 9] }, portals: [] },
      ],
      portals: [],
    };
    // A room's floor is one sheet facing up at 0.3 m, as a model's room floor is: a box's bottom face would read as a
    // second, lower floor to a ray that passes through the first.
    const floor = (x0: number, x1: number) => {
      const g = new THREE.PlaneGeometry(x1 - x0, 18);
      g.rotateX(-Math.PI / 2);
      g.translate((x0 + x1) / 2, 0.3, 0);
      return g;
    };
    const pole = boxGeo(0.5, 8, 0.5, 0);
    pole.translate(0, 0, -9.5);
    const rooms = [new THREE.Box3(new THREE.Vector3(-9, 0, -9), new THREE.Vector3(-1, 6, 9)), new THREE.Box3(new THREE.Vector3(1, 0, -9), new THREE.Vector3(9, 6, 9))];
    return { def, model: loadedOf(def, [{ geometry: pole, cell: 0 }, { geometry: floor(-9, -1), cell: 1 }, { geometry: floor(1, 9), cell: 2 }], rooms) };
  };
  const base = twoRooms('base_like', ['hall', 'hangar']);
  const station = twoRooms('thm_spc_nebula_orion_station', ['hangarbay1', 'hangarbay2']);
  const other = twoRooms('other_station', ['hangarbay1', 'hangarbay2']);
  const turn = [s45, 0, -s45, 0];
  const h = await makeStreamer(
    [
      { template: 'object/building/heroic/shared_base_like.iff', model: 'base_like', x: -300, y: 0, z: 100, q: turn, radius: 30 },
      { template: 'object/building/general/shared_station.iff', model: 'thm_spc_nebula_orion_station', x: -300, y: 0, z: 140, q: turn, radius: 30 },
      { template: 'object/building/general/shared_other.iff', model: 'other_station', x: -300, y: 0, z: 180, q: turn, radius: 30 },
    ],
    { defs: [base.def, station.def, other.def], models: { base_like: base.model, thm_spc_nebula_orion_station: station.model, other_station: other.model } },
  );
  await h.settle({ x: 300, z: 140 });
  const of = (id: string) => [...(h.s.buildings as Set<any>)].find((b) => b.model.def.id === id);
  const bBase = of('base_like');
  const bStation = of('thm_spc_nebula_orion_station');
  const bOther = of('other_station');
  ok(!!bBase && !!bStation && !!bOther, 'the three buildings are standing, turned a quarter');
  // Three's own carry of a point in a building's model frame into the world, independent of the streamer's matrices.
  const frame = new THREE.Object3D();
  const world = (b: any, x: number, y: number, z: number) => {
    frame.position.set(b.x, 0, b.z);
    frame.quaternion.set(0, s45, 0, s45);
    frame.updateMatrixWorld(true);
    return frame.localToWorld(new THREE.Vector3(x, y, z));
  };
  const near = (a: THREE.Vector3, b: THREE.Vector3, tol = 1e-6) => Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol && Math.abs(a.z - b.z) < tol;
  const floorY = 0.3 + 0.15;
  // spotIn: a place in the client's frame (x mirrored into the model's), on the floor under it, facing the client's way.
  const local = { x: 3, y: 0.2, z: 2 };
  const spot = h.stream.spotIn(bBase, local, 0.5);
  const wantAt = world(bBase, -local.x, floorY, local.z);
  ok(near(spot.at, wantAt, 1e-4), `a place in a building's frame is carried into the world with x mirrored, turned with the building and stood on the floor under it (${spot.at.toArray().map((n: number) => n.toFixed(2)).join(', ')})`);
  frame.quaternion.set(0, s45, 0, s45);
  const facing = new THREE.Vector3(-Math.sin(0.5), 0, Math.cos(0.5)).applyQuaternion(frame.quaternion);
  ok(Math.abs(spot.heading - Math.atan2(facing.x, facing.z)) < 1e-9, `and its heading is the client's, mirrored and turned with the building (${spot.heading.toFixed(4)})`);
  // A cloning tube in its own room, and none in a room the building has not got.
  const tube = h.stream.tubeSpotIn(bBase, { cell: 2, ...local, yaw: 0.5 });
  ok(!!tube && tube.cell === 2 && near(tube.at, spot.at) && tube.heading === spot.heading, 'a cloning tube stands where its place in the building says, in its room, facing its way');
  ok(h.stream.tubeSpotIn(bBase, { cell: 7, ...local, yaw: 0.5 }) === null, 'and a tube for a room the building has not got gives none');
  // A room arrival: the building of its template nearest the place, its room by name, at its own place or the room's floor.
  const place = { x: 300, z: 100 };
  const named = h.stream.roomArrivalSpot(place, { template: 'object/building/heroic/shared_base_like.iff', cell: 'hangar' });
  ok(!!named && named.cell === 2 && named.building === bBase && near(named.at, world(bBase, 5, floorY, 0), 1e-4), `a room arrival with no place of its own stands on its named room's floor under the room's middle (cell ${named?.cell})`);
  const at = h.stream.roomArrivalSpot(place, { template: 'object/building/heroic/shared_base_like.iff', cell: 'hangar', at: [local.x, local.y, local.z] });
  ok(!!at && at.cell === 2 && near(at.at, wantAt, 1e-4), 'and one that gives a place stands at that place in the building\'s frame, in the named room');
  ok(h.stream.roomArrivalSpot(place, { template: 'object/building/heroic/shared_base_like.iff', cell: 'nowhere' }) === null && h.stream.roomArrivalSpot(place, { template: 'object/building/heroic/shared_echo_base.iff', cell: 'hangar' }) === null, 'a room the building has not got, or a building that is not there, gives none');
  // Tansarii Point Station's way in is its hangar bay 2, where any other building of the same rooms is entered at its first.
  const entry = h.stream.entryOf(bStation);
  ok(!!entry && entry.cell === 2 && near(entry.at, world(bStation, 5, floorY, 0), 1e-4), `the station is entered in hangar bay 2, on its floor (cell ${entry?.cell})`);
  const plain = h.stream.entryOf(bOther);
  ok(!!plain && plain.cell === 1, `and the same rooms under another model's name are entered at the first (cell ${plain?.cell}): the table is what moves it`);
}

// ---------------------------------------------------------------------------------------------
// 3.7 Tansarii Point Station's way in is hangar bay 2's room.
{
  ok(DOORLESS_ENTRY.get('thm_spc_nebula_orion_station') === 'hangarbay2', 'the station is entered by its hangar bay 2, by the room\'s own name');
  ok(/const named = DOORLESS_ENTRY\.get\(b\.model\.def\.id\);/.test(methodOf(read('src/world/layoutStream.ts'), '  entryOf(b: Building)')), 'entryOf asks the table first (text)');
  const man = packJson('dungeon1', 'manifest.json');
  if (!man) console.log('skip the station\'s hangar bay 2 in its own layout: no dungeon1 pack');
  else {
    const st = (Object.values(man.categories ?? {}).flat() as any[]).find((d) => d.id === 'thm_spc_nebula_orion_station');
    ok(!!st && namedCellIndex(st.cells.filter((c: any) => c.index > 0), 'hangarbay2') === 8, 'which is cell 8 of the station\'s own layout');
  }
}

// 3.8 Kashyyyk's zones by what they hold.
{
  const k = PLANETS.find((p) => p.id === 'kashyyyk')!;
  const name = (id: string) => k.zones!.find((z) => z.id === id)!.name;
  ok(name('dead_forest') === 'Kkowir Forest' && name('south_dungeons') === 'Hracca and Bocctyyy' && name('north_dungeons') === 'Blackscale Processing Camp and the Arena', 'the dead forest is Kkowir Forest, the south holds Hracca and Bocctyyy, the north the slave camps and the Arena');
}

// ---------------------------------------------------------------------------------------------
// 3.9 The emulator's data nothing read, out of the committed reference.
{
  const src = core3Source();
  const launches = src.readLaunchPoints();
  ok(launches.size === 11 && launches.get('rori')?.zone === 'space_naboo' && launches.get('talus')?.zone === 'space_corellia', 'eleven launch points, Rori into Naboo\'s zone and Talus into Corellia\'s');
  ok(launches.get('tatooine')!.at.join(',') === '2300,-5900,1900', 'kept as the client\'s x, height, z');
  const landings = src.readLandingPoints();
  ok(landings.length === 29 && new Set(landings.map((l: any) => l.world)).size === 10, 'twenty-nine landing places over ten worlds');
  const cloning = src.readCloningPoints();
  ok(cloning.size === 42 && cloning.get('object/building/tatooine/shared_cloning_facility_tatooine.iff')?.length === 7, 'twenty-one facilities\' tubes under both spellings, seven in Tatooine\'s large facility');
  const tut = src.readTutorial();
  ok(tut.mobiles.length === 26 && tut.objects.length === 8 && tut.chosen === 1 && tut.mobiles.every((m: any) => /^r\d+$/.test(m.room)), 'the old tutorial\'s 26 people and 8 things by room, the trainer the code chooses counted');
  // The fit: each launch as read lies near its zone's station; mirrored it is kilometres off.
  const station = (name: string, x: number, y: number, z: number, radius: number) => ({ name, x, y, z, radius });
  const fit = launchArrival({ zone: 'space_tatooine', at: [2300, -5900, 1900] }, [station('station_tatooine', 2311, -5872, 1865, 300)], 'tatooine');
  ok(!!fit && fit.fit.asIs < 80 && fit.fit.mirrored > 4000 && Math.hypot(fit.x - 2311, fit.y + 5872, fit.z - 1865) >= 300 + STATION_STANDOFF - 1, 'Tatooine\'s point fits its station as read and is carried clear of it');
  ok(launchArrival({ zone: 'z', at: [-150, 0, 0] }, [station('s', 100, 0, 0, 30)], 'x') === null && launchArrival({ zone: 'z', at: [9000, 0, 0] }, [station('s', 0, 0, 0, 300)], 'x') === null, 'a point that fits better mirrored, or no station within the reach, is not believed');
  ok(launchArrival({ zone: 'z', at: [150, 0, 0] }, [station('s', 100, 0, 0, 30)], 'x') !== null, 'the same point the right way round is');
  ok(LAUNCH_FIT_MOST === 500, 'the reach is 500 m');
  // Every space pack on disk: each of its launches lies off its stations' spheres.
  for (const zone of ['space_tatooine', 'space_corellia', 'space_naboo']) {
    const pack = packJson(zone, 'space.json');
    if (!pack || !Array.isArray(pack.launches)) {
      console.log(`skip ${zone}: no pack, or one converted before the launch points`);
      continue;
    }
    for (const l of pack.launches) {
      const s = pack.stations.find((x: any) => x.name === l.station);
      ok(!!s && Math.hypot(l.x - s.x, l.y - s.y, l.z - s.z) >= s.radius + STATION_STANDOFF - 1 && l.fit.asIs <= LAUNCH_FIT_MOST && l.fit.asIs < l.fit.mirrored, `${zone}: ${l.planet}'s launch stands clear of ${l.station} (fit ${l.fit.asIs} m as read, ${l.fit.mirrored} m mirrored)`);
    }
    ok(pack.arrival.planet === pack.planet && pack.arrival.from === 'core3', `${zone}: its arrival is its planet's launch point`);
  }
  // The runtime's reads of the pack.
  const pack = { planet: 'naboo', arrival: { x: 10, y: 0, z: 5, kind: 'launch' }, launches: [{ x: 1, y: 2, z: 3, kind: 'launch', planet: 'rori' }], landings: { rori: [{ key: 'narmle', name: 'Narmle', x: 1, y: 2, z: 3 }] } } as never;
  ok(launchAt(pack, 'rori')!.join(',') === '-1,2,3' && launchAt(pack, 'naboo')!.join(',') === '-10,0,5' && launchAt(pack, 'tatooine') === null, 'a world\'s launch in the game\'s frame, the zone\'s own world its arrival, any other none');
  ok(landingsOf(pack, 'rori').length === 1 && landingsOf(pack, 'naboo').length === 0, 'the landing places by world');
  // Given the far place first, the nearer still comes out first: the converter sorts them.
  const named = landingsFor([{ key: 'kor_vella', world: 'corellia', x: -3155, y: 31, z: 2880 }, { key: 'coronet', world: 'corellia', x: -66, y: 28, z: -4705 }], ['corellia'], () => ({ center: { x: -51, z: -4735 }, pois: [{ name: 'Coronet Starport', x: -50, z: -4730, r: 0 }] }));
  ok(named.corellia[0].name === 'Coronet Starport' && named.corellia[1].name === 'Kor Vella', 'a landing is named for the world\'s place it stands in, else the emulator\'s key in words, nearest the world\'s arrival first');
  // A landing place in the game's frame: x mirrored about the world's centre, z taken off it, the height as given.
  ok(landingInGame({ x: -66, y: 28, z: -4705 }, { x: -51, z: -4735 }).join(',') === '15,28,30', 'a landing place is carried into its world\'s frame about that world\'s centre');
  // Leaving a planet faces away from its station, which the launch point stands about 400 m off.
  const away = launchForward([0, 0, 0], [{ at: [781, 0, 0], radius: 382 }, { at: [0, 0, 5000], radius: 100 }]);
  ok(away[0] < -0.999 && Math.abs(away[1]) < 1e-9 && Math.abs(away[2]) < 1e-9, `a ship climbing out of a planet's sky faces away from the nearest station (${away.map((n) => n.toFixed(3)).join(', ')})`);
  ok(Math.abs(Math.hypot(...launchForward([5000, 0, 0], [])) - 1) < 1e-9 && launchForward([5000, 0, 0], [])[0] > 0.999, 'and with no landmark, away from the zone\'s origin');
  // Cloning tubes.
  const tubes = [{ cell: 4, x: 1, y: 0, z: 0, yaw: 0 }, { cell: 4, x: 2, y: 0, z: 0, yaw: 0 }, { cell: 4, x: 3, y: 0, z: 0, yaw: 0 }];
  ok(cloningPointOf(tubes, 'abc') === cloningPointOf(tubes, 'abc') && cloningPointOf(undefined, 'abc') === null, 'a character comes round in the same tube every time, and a facility with none gives none');
  ok(new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((w) => cloningPointOf(tubes, w))).size > 1, 'and characters are spread over the tubes');
  const kept = cloningPointsOf({ cloning: { 'object/building/x/shared_clone.iff': tubes } });
  ok(tubeFor(kept, 'object/building/x/shared_clone.iff', 'abc') === cloningPointOf(tubes, 'abc') && tubeFor(kept, 'object/building/x/shared_other.iff', 'abc') === null && tubeFor(kept, undefined, 'abc') === null, 'a world\'s tubes are read out of its fittings by template, and a facility it has none for gives none');
  ok(Object.keys(cloningPointsOf({})).length === 0 && Object.keys(cloningPointsOf(null)).length === 0 && Object.keys(cloningPointsOf({ cloning: [] })).length === 0, 'and a fittings pack from before them has none');
  ok(fittingsReadable(1) && fittingsReadable(FITTINGS_PACK_VERSION) && !fittingsReadable(3), 'a fittings pack of the version before is still read');
  const main = read('src/main.ts');
  const respawnAt = methodOf(main, '  private async respawnAt(');
  ok(/const tube = this\.fittingRowsFor === packIdOf\(this\.world\.planet, this\.zone\) \? tubeFor\(this\.cloningPoints, f\.template, this\.current\?\.id \?\? ''\) : null;/.test(respawnAt) && /cloneRoomAt\(f\.x, f\.z, f\.template, tube\)/.test(respawnAt), 'a death at a facility comes round in the tube this character\'s id picks (text)');
  ok(/\n      this\.cloningPoints = cloningPointsOf\(data\);\n/.test(methodOf(main, '  private async loadFittings(')), 'and the world\'s tubes are what its fittings pack keeps (text)');
  ok(/const spot = tube \? this\.layoutStream\.tubeSpotIn\(b, tube\) : null;\n    if \(spot\) \{/.test(read('src/world/world.ts')), 'which the facility stands the dead in, in the tube\'s own room (text)');
  const goUp = methodOf(main, '  private async goToSpace(');
  ok(/const launch = launchAt\(pack, this\.world\.planet\.id\);/.test(goUp) && /const arrival = launch && pack \? this\.launchPose\(pack, launch\) : undefined;/.test(goUp) && /\.\.\.\(arrival \? \{ arrival \} : \{\}\) \}\);/.test(goUp), 'leaving a planet comes out at its launch point, handed to the crossing (text)');
  ok(/const q = lookRotation\(launchForward\(\[pos\.x, pos\.y, pos\.z\], landmarksOf\(pack\)\)\);/.test(methodOf(main, '  private launchPose(')), 'facing away from its station (text)');
  const goDown = methodOf(main, '  private async landShip(');
  ok(/landingsOf\(this\.world\.spaceData, below\.id\)\[at\]/.test(goDown) && /new THREE\.Vector3\(\.\.\.landingInGame\(place, centre\)\)/.test(goDown) && /\.\.\.\(arrival \? \{ arrival \} : \{\}\) \}\);/.test(goDown), 'and the ship menu lands over the landing place picked, in its world\'s frame (text)');
  ok(/if \(!this\.arrivalHome && height === 0\) this\.spawn\.copy\(at\);/.test(methodOf(main, '  private async arriveInShip(')), 'a ship coming down over a landing place leaves the spawn on the ground (text)');
  // An orbit's pack converted before the launch points is asked for again; one with them is not.
  const orbit = { version: SPACE_PACK_VERSION, title: 'Tatoo System', stations: [], hyperspace: { points: [], effects: { enter: 'a', exit: 'b' } }, materialFormat: MATERIAL_FORMAT, planets: [], arrival: { kind: 'launch' } };
  ok(spaceZoneStatus('space_tatooine', orbit, 0).stale && /launch points/.test(spaceZoneStatus('space_tatooine', orbit, 0).line), 'an orbit converted before the launch points is asked for again');
  ok(!spaceZoneStatus('space_tatooine', { ...orbit, launches: [] }, 0).stale, 'and one with them is not');
  // Tubes lie in their own rooms: Tatooine's large facility, its points carried into the model's mirrored frame.
  const tat = packJson('tatooine', 'manifest.json');
  if (!tat) console.log('skip the tubes of Tatooine\'s large facility: no Tatooine pack');
  else {
    const fac = (Object.values(tat.categories ?? {}).flat() as any[]).find((d) => d.id === 'mun_tato_cloning_s01');
    const pts = cloning.get('object/building/tatooine/shared_cloning_facility_tatooine.iff') as any[];
    ok(!!fac, 'Tatooine\'s pack carries its large cloning facility');
    const inside = pts.filter((p) => {
      const c = fac.cells.find((x: any) => x.index === p.cell);
      if (!c) return false;
      const lo = [0, 1, 2].map((a) => Math.min(c.bounds.min[a], c.bounds.max[a]) - 0.5);
      const hi = [0, 1, 2].map((a) => Math.max(c.bounds.min[a], c.bounds.max[a]) + 0.5);
      const v = [-p.x, p.y, p.z];
      return v.every((n, a) => n >= lo[a] && n <= hi[a]);
    });
    ok(inside.length === pts.length, `every tube of Tatooine's large facility lies in its own room with x mirrored (${inside.length} of ${pts.length})`);
  }
}

// The old tutorial's people and things in its hall's rooms.
{
  const rows = JSON.parse(read('public/placements/world/tutorial.json')).rows as any[];
  const hall = rows.find((r) => r.template === TUTORIAL_HALL.template);
  ok(!!hall && hall.model === TUTORIAL_HALL.model && hall.x === TUTORIAL_HALL.x && hall.y === TUTORIAL_HALL.y && hall.z === TUTORIAL_HALL.z && hall.q.join(',') === '1,0,0,0', 'the converter\'s hall is the permanent row\'s, place and turn');
  const cells = [{ index: 1, name: 'r1' }, { index: 2, name: 'r2' }];
  const tut = { mobiles: [{ room: 'r1', name: 'tutorial_banker', respawn: 0, x: -2.4, y: 0, z: -17.4, heading: 0 }, { room: 'r9', name: 'tutorial_banker', respawn: 0, x: 1, y: 0, z: 1, heading: 0 }], objects: [{ room: 'r2', template: 'object/tangible/terminal/terminal_bank.iff', x: 50.9, y: -0.5, z: -6.2, yaw: -1.5708 }] };
  const crew = tutorialCrew(tut, cells);
  ok(crew.rows.length === 1 && crew.noRoom === 1 && crew.rooms.get(1)?.cellIndex === 1, 'a person in a room the hall has is a row; one in a room it has not is counted');
  const joined = new Map([['tutorial_banker', { id: 'banker_body', bodies: [], dress: [] }]]);
  const got = packRow(crew.rows[0], { joined, rooms: crew.rooms, pools: new Map() });
  ok(!got.lost && got.row.x === -2.4 && Math.abs(got.row.y - 3.5) < 1e-9 && got.row.z === -17.4 && got.row.room === 1, 'and stands at the hall\'s place plus its own, in its room');
  const things = tutorialFittingRows(tut, cells, (t: string) => (t.includes('bank') ? 'bank_terminal' : null));
  ok(things.rows.length === 1 && things.rows[0].cell === 2 && things.rows[0].bx === 0 && things.rows[0].by === 3.5, 'a thing is a child of the hall in its room');
  ok(ROOM_CREW_WORLDS.includes('tutorial') && packHolds('tutorial', 'spawns.json') && !packHolds('simple', 'spawns.json'), 'the tutorial\'s spawns.json is asked for, and no other extra world\'s');
}

// ---------------------------------------------------------------------------------------------
// 3.10 The library asks again for a world converted since it was built.
{
  const root = join(tmpdir(), `mapfix-library-${process.pid}`);
  rmSync(root, { recursive: true, force: true });
  for (const w of ['alpha', 'beta']) {
    mkdirSync(join(root, w), { recursive: true });
    writeFileSync(join(root, w, 'layout.json'), '{}');
    writeFileSync(join(root, w, 'manifest.json'), '{}');
  }
  mkdirSync(join(root, 'library'), { recursive: true });
  const { LIBRARY_FORMAT } = await import('../library.mjs');
  const index = (packs: object) => writeFileSync(join(root, 'library', 'library.json'), JSON.stringify({ version: LIBRARY_FORMAT, packs, entries: [] }));
  index({ alpha: { manifest: 'alpha/manifest.json', mtime: Date.now() + 60000 } });
  ok(libraryWorlds(root).join(',') === 'alpha,beta', 'the library reads every world folder with a layout and a manifest');
  const st = libraryStatus(root);
  ok(st.stale && /beta/.test(st.line), 'a world converted since the library was built makes it stale, named');
  index({ alpha: { manifest: 'alpha/manifest.json', mtime: Date.now() + 60000 }, beta: { manifest: 'beta/manifest.json', mtime: Date.now() + 60000 } });
  ok(!libraryStatus(root).stale, 'with every world in it, it is not');
  rmSync(root, { recursive: true, force: true });
  if (existsSync(join(PACKS, 'library', 'library.json'))) {
    const real = libraryStatus(PACKS);
    console.log(`the library on disk: ${real.line}`);
  }
}

// The weather's comment says where the emulator's numbers are, and changes none.
ok(/weather_manager\.lua/.test(read('src/world/weatherSchedule.ts')), "the weather schedule says the emulator's numbers are to be had (text)");
ok(/spawningPoints/.test(read('src/world/cloning.ts')), "and the cloning rule says whose the tubes are (text)");

console.log(`\n${passed} checks passed`);
