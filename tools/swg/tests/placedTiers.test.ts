// Step 6 of the frame-time wave: placed objects filed by their own model's size rather than the snapshot's
// radius (src/world/placedTiers.ts), the portal materials' one shared stencil reference
// (src/world/stencilRef.ts), and the material scan walking only what was added (src/world/sceneAdds.ts).
//
// The tier counts are taken over the owner's converted Tatooine, Naboo and Corellia (their `layout.json` and
// `manifest.json`), through the very functions the streamer files and ranges with, on the streamer's own grid
// (the snapshot mirrored in x and centred on the layout's centre); the old rule's numbers are held to the LOD
// research's own table on the research's own grid: Tatooine's 16,207 of 16,228 in the first tier, and 3,257
// placed objects within range of Mos Eisley. A world whose pack is not converted is skipped, and each check
// that needs one says so. Nothing read from the packs is written.
//
// Run with --allow-natives-syntax (as `test:perf` does) to check that the stencil accessor leaves every
// material in V8's fast mode; without it that one check is skipped and says so.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { boxDistance, gameX, gameZ, hostRadiusOf, hostReach, modelSize, modelTier, PLACED_TIERS, PLACED_TUNE, REGION, regionCentre, regionIndex, regionRange, snapshotTier, tierFor, tierOfSize } from '../../../src/world/placedTiers.ts';
import { isShared, legacyCount, PORTAL_REF, setPortalRef, setSharedRef, shareRef, unshareRef } from '../../../src/world/stencilRef.ts';
import { MaterialScan, SCAN_TUNE, SceneAdds, under, type ScanHost } from '../../../src/world/sceneAdds.ts';
import { HOST_FLAG, furnitureHosts, type HostDef } from '../../../src/world/furnitureHost.ts';
import { interiorBuildRangeMax, INTERIOR_LEAD, PORTAL_CULL, PORTAL_RANGE } from '../../../src/world/portalVis.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const ROOT = fileURLToPath(new URL('../../../assets-private/', import.meta.url));

interface Obj {
  model: string;
  x: number;
  y: number;
  z: number;
  q: number[];
  radius: number;
  contained?: boolean;
}
interface Def extends HostDef {
  id: string;
  file?: string;
  particle?: unknown;
  bounds: { min: number[]; max: number[] };
}

{
  // The arithmetic.
  ok(modelSize({ min: [1, 2, 3], max: [-1, -2, -3] }) === 3 && modelSize({ min: [-1, -2, -3], max: [1, 2, 3] }) === 3, "a model's size is half its box's largest span, whichever way round its corners are");
  ok(modelSize({ min: [0, 0, 0], max: [1, 30, 1] }) === 15, 'over all three axes: a 30 m obelisk a metre across is 15 m, not half a metre');
  ok(Number.isNaN(modelSize(null)) && Number.isNaN(modelSize({ min: [0, 0], max: [1, 1] })) && Number.isNaN(modelSize({ min: [0, 0, Number.NaN], max: [1, 1, 1] })), 'no box, a short one or a broken one is no size');
  ok(tierOfSize(12) === 0 && tierOfSize(11.99) === 1 && tierOfSize(3) === 1 && tierOfSize(2.99) === 2 && tierOfSize(0) === 2 && tierOfSize(Number.NaN) === 2, "the tiers' floors are 12 m and 3 m");
  ok(snapshotTier(32) === 0 && snapshotTier(4) === 1, 'the old rule reads the snapshot radius as a size: 32 m is the first tier');
  ok(modelTier(32, { min: [0, 0, 0], max: [1, 1, 1] }) === 2 && modelTier(32, null) === 0 && modelTier(1, { min: [0, 0, 0], max: [40, 40, 40] }, true) === 2, 'the new rule takes the box, and keeps the snapshot for a model with none and for a particle effect');
  ok(tierFor('snapshot', 32, { min: [0, 0, 0], max: [1, 1, 1] }) === 0 && tierFor('model', 32, { min: [0, 0, 0], max: [1, 1, 1] }) === 2, 'each rule files by its own measure');
  ok(PLACED_TUNE.tierRule === 'model' && PLACED_TUNE.warm === true && PLACED_TUNE.warmWaitMs === 0, 'the model rule is the one in force, with the old rule\'s models warmed behind a loading screen as best it can, never holding the screen up for them');
  ok(regionIndex(255.9) === 0 && regionIndex(256) === 1 && regionIndex(-0.1) === -1 && regionCentre(-1) === -128 && REGION === 256, 'regions are 256 m squares, counted from the origin');
  ok(boxDistance(0, 0, 128, 128) === 0 && boxDistance(-100, 128, 128, 128) === 100 && Math.abs(boxDistance(-30, -40, 128, 128) - 50) < 1e-9, "a point's distance is to the region's box, nought inside it");
  ok(gameX(10, 110) === 100 && gameZ(10, 110) === -100, 'the snapshot is mirrored in x and centred, as the streamer reads it');
  ok(hostRadiusOf({ min: [10, 0, 4], max: [-10, 5, -4] }) === 10 && hostRadiusOf(null) === 0, "a building's reach from its middle is its larger half-extent on the ground, whichever way round its corners are");
  ok(hostReach(128, 128, 20, 128, 128) === 20 && hostReach(-50, 128, 20, 128, 128) === 70, 'and a region reaches as far past the rooms\' range as the building reaches past the region\'s box');
  ok(regionRange(320, -1, 360, 'model') === 320 && regionRange(320, 30, 360, 'model') === 390 && regionRange(512, 30, 360, 'model') === 512 && regionRange(320, 30, 360, 'snapshot') === 320, "a tier holding furniture loads at least as far as its rooms can be built from, only under the model rule and only when that is farther");
  ok(interiorBuildRangeMax() === Math.max(PORTAL_RANGE, PORTAL_CULL.rangeBase, PORTAL_CULL.rangeMax) + INTERIOR_LEAD && interiorBuildRangeMax() === 360, "the farthest a building's rooms are built from is the widest door range plus the lead: 360 m");
  ok(interiorBuildRangeMax({ ...PORTAL_CULL, doorRange: false }) === PORTAL_RANGE + INTERIOR_LEAD, 'and 160 m with the door range the old fixed one');
}

/** The old streamer's own filing, as it was written before step 6: the first tier whose floor the radius reaches, else the last. */
const oldTier = (radius: number): number => {
  const t = PLACED_TIERS.findIndex((x) => radius >= x.minRadius);
  return t < 0 ? PLACED_TIERS.length - 1 : t;
};

/** A world read as the streamer reads it, on its own grid, with each thing in a room's host (`furnitureHosts`, the streamer's own call). */
interface Placed {
  model: string;
  x: number;
  z: number;
  radius: number;
  contained: boolean;
  sizeTier: number;
  snapTier: number;
  host: number;
  drawn: boolean;
}
interface Table {
  regions: Map<string, { cx: number; cz: number; objects: number[][]; indoor: number[] }>;
}

function readWorld(planet: string): { objs: Placed[]; defs: Map<string, Def>; center: { x: number; z: number } } | null {
  const dir = join(ROOT, planet);
  if (!existsSync(join(dir, 'layout.json')) || !existsSync(join(dir, 'manifest.json'))) return null;
  const layout = JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf8')) as { center: { x: number; z: number }; objects: Obj[] };
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { categories: Record<string, Def[]> };
  const defs = new Map<string, Def>();
  for (const list of Object.values(manifest.categories)) for (const d of list) if (d?.id) defs.set(d.id, d);
  const c = layout.center;
  const hostIn = layout.objects.map((o) => ({ model: o.model, x: gameX(o.x, c.x), y: o.y, z: gameZ(o.z, c.z), q: { x: o.q[1], y: -o.q[2], z: -o.q[3], w: o.q[0] }, contained: !!o.contained }));
  const hosted = furnitureHosts(hostIn, (id) => defs.get(id));
  const drawn = new Map<string, boolean>();
  const objs = layout.objects.map((o, i): Placed => {
    const d = defs.get(o.model);
    let dr = drawn.get(o.model);
    if (dr === undefined) {
      dr = !!d && !d.particle && !!d.file && existsSync(join(dir, d.file));
      drawn.set(o.model, dr);
    }
    const doorway = (hosted.flags[i] & HOST_FLAG.doorway) !== 0;
    return { model: o.model, x: hostIn[i].x, z: hostIn[i].z, radius: o.radius, contained: !!o.contained, sizeTier: modelTier(o.radius, d?.bounds, !!d?.particle), snapTier: snapshotTier(o.radius), host: o.contained && !doorway ? hosted.host[i] : -1, drawn: dr };
  });
  return { objs, defs, center: c };
}

/** The streamer's regions under a rule: every object in its region's tier, and each tier's furniture reach (`LayoutStreamer.noteIndoor`). */
function file(objs: Placed[], defs: Map<string, Def>, rule: 'model' | 'snapshot'): Table {
  const regions: Table['regions'] = new Map();
  const regionOf = (x: number, z: number) => {
    const rx = regionIndex(x);
    const rz = regionIndex(z);
    const k = `${rx},${rz}`;
    let r = regions.get(k);
    if (!r) regions.set(k, (r = { cx: regionCentre(rx), cz: regionCentre(rz), objects: PLACED_TIERS.map(() => []), indoor: PLACED_TIERS.map(() => -1) }));
    return r;
  };
  objs.forEach((p, i) => regionOf(p.x, p.z).objects[rule === 'snapshot' ? p.snapTier : p.sizeTier].push(i));
  for (const p of objs) {
    if (p.host < 0) continue;
    const h = objs[p.host];
    const r = regionOf(p.x, p.z);
    const t = rule === 'snapshot' ? p.snapTier : p.sizeTier;
    r.indoor[t] = Math.max(r.indoor[t], hostReach(h.x, h.z, hostRadiusOf(defs.get(h.model)?.bounds), r.cx, r.cz));
  }
  return { regions };
}

/** What `update` would hold in range of a point: region tiers, and the drawn objects in them. */
function inRange(t: Table, objs: Placed[], px: number, pz: number, reach: number, rule: 'model' | 'snapshot', floor = true): { tiers: number; objects: number } {
  let tiers = 0;
  let objects = 0;
  const room = interiorBuildRangeMax();
  for (const r of t.regions.values()) {
    const d = boxDistance(px, pz, r.cx, r.cz);
    for (let k = 0; k < PLACED_TIERS.length; k++) {
      if (!r.objects[k].length) continue;
      if (d > regionRange(PLACED_TIERS[k].range * reach, floor ? r.indoor[k] : -1, room, rule)) continue;
      tiers++;
      for (const i of r.objects[k]) if (objs[i].drawn) objects++;
    }
  }
  return { tiers, objects };
}

for (const planet of ['tatooine', 'naboo', 'corellia']) {
  const w = readWorld(planet);
  if (!w) {
    console.log(`skip  ${planet}: no converted layout`);
    continue;
  }
  const { objs, defs } = w;
  const n = objs.length;
  const bySnapshot = [0, 0, 0];
  const byModel = [0, 0, 0];
  for (const o of objs) {
    bySnapshot[o.snapTier]++;
    byModel[o.sizeTier]++;
  }
  console.log(`      ${planet}: ${n} objects; by the snapshot ${bySnapshot.join(' / ')}, by the model ${byModel.join(' / ')}`);
  ok(objs.every((o) => o.snapTier === oldTier(o.radius)), `${planet}: filed by the snapshot's radius, every one of ${n} objects is in the very tier the streamer before step 6 filed it in`);
  ok(bySnapshot[0] / n > 0.998, `${planet}: the old rule puts ${bySnapshot[0]} of ${n} in the first tier (more than 99.8%)`);
  ok(byModel[0] / n < 0.1 && byModel[2] > byModel[1] && byModel[1] > byModel[0], `${planet}: by the model's own size ${byModel[0]} load from 1.7 km, ${byModel[1]} from 750 m and ${byModel[2]} from 320 m`);
  if (planet === 'tatooine') ok(bySnapshot[0] === 16207 && n === 16228, "Tatooine: the old rule's 16,207 of 16,228 in the first tier, the LOD research's own figure");

  // The floor under a tier holding furniture: whenever a building's rooms can be built -- the player within the
  // widest room range of its edge -- everything filed under it is in range. Checked on every hosted object of
  // the world, from sixteen points round each host at exactly that distance, at the menu's least reach, the
  // default and the most; and counted without the floor, which is the fault the floor is for.
  if (planet === 'tatooine' || planet === 'naboo') {
    const room = interiorBuildRangeMax();
    const model = file(objs, defs, 'model');
    for (const reach of [0.4, 1.0, 1.6]) {
      let hosted = 0;
      let missWith = 0;
      let missWithout = 0;
      const buildingsWithout = new Set<number>();
      for (const p of objs) {
        if (p.host < 0) continue;
        hosted++;
        const h = objs[p.host];
        const r = model.regions.get(`${regionIndex(p.x)},${regionIndex(p.z)}`)!;
        const own = PLACED_TIERS[p.sizeTier].range * reach;
        const withFloor = regionRange(own, r.indoor[p.sizeTier], room, 'model');
        const ring = room + hostRadiusOf(defs.get(h.model)?.bounds);
        let worst = 0;
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          worst = Math.max(worst, boxDistance(h.x + Math.cos(a) * ring, h.z + Math.sin(a) * ring, r.cx, r.cz));
        }
        if (worst > withFloor + 1e-6) missWith++;
        if (worst > own) {
          missWithout++;
          buildingsWithout.add(p.host);
        }
      }
      console.log(`      ${planet} at reach ${reach}: of ${hosted} things in rooms, ${missWithout} (in ${buildingsWithout.size} buildings) would be out of range while their rooms can be built without the floor, ${missWith} with it`);
      ok(missWith === 0, `${planet} at reach ${reach}: with the floor, none of the ${hosted} things standing in rooms is out of range while its building's rooms can be built`);
      if (reach < 1.6) ok(missWithout > 0, `${planet} at reach ${reach}: and without it ${missWithout} would be -- the room drawn empty the floor is for`);
    }
  }

  if (planet !== 'tatooine') continue;
  // Mos Eisley, from the town's own mark in the pack's places (the snapshot's frame, as the layout is).
  const dir = join(ROOT, planet);
  const pois = existsSync(join(dir, 'pois.json')) ? (JSON.parse(readFileSync(join(dir, 'pois.json'), 'utf8')).pois as { name: string; x: number; z: number }[]) : [];
  const town = pois.find((p) => p.name === 'Mos Eisley');
  if (!town) {
    console.log('skip  Mos Eisley: no places file');
    continue;
  }
  // The research's own count, on its own grid (the snapshot's frame, unmirrored), so its table can be held to.
  const layout = JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf8')) as { objects: Obj[] };
  let oldRule = 0;
  let research = 0;
  for (let i = 0; i < layout.objects.length; i++) {
    const o = layout.objects[i];
    if (!objs[i].drawn) continue;
    const dReg = boxDistance(town.x, town.z, regionCentre(regionIndex(o.x)), regionCentre(regionIndex(o.z)));
    if (dReg <= PLACED_TIERS[oldTier(o.radius)].range) oldRule++;
    const b = (defs.get(o.model) as Def).bounds;
    const half = Math.max(Math.abs(b.max[0] - b.min[0]), Math.abs(b.max[2] - b.min[2])) / 2;
    if (dReg <= (o.contained ? 160 : PLACED_TIERS[tierOfSize(half)].range)) research++;
  }
  ok(oldRule === 3257, "Mos Eisley, on the research's own grid: the old rule has 3,257 placed objects in range, the LOD research's own figure");
  ok(research === 2398, "and the research's model rule (ground-plane half-width, indoors within 160 m) its 2,398");
  // The streamer's own grid: the town's mark mirrored and centred, every region filed as the streamer files it.
  const tx = gameX(town.x, w.center.x);
  const tz = gameZ(town.z, w.center.z);
  const oldT = file(objs, defs, 'snapshot');
  const modelT = file(objs, defs, 'model');
  for (const reach of [1.6, 1.0]) {
    const a = inRange(oldT, objs, tx, tz, reach, 'snapshot');
    const b = inRange(modelT, objs, tx, tz, reach, 'model');
    const bare = inRange(modelT, objs, tx, tz, reach, 'model', false);
    console.log(`      Mos Eisley at reach ${reach}, the streamer's grid: the old rule ${a.tiers} region tiers (${a.objects} objects), the model rule ${b.tiers} (${b.objects}), ${bare.tiers} (${bare.objects}) without the furniture floor`);
    ok(b.objects < a.objects && b.objects >= bare.objects && b.tiers >= bare.tiers, `Mos Eisley at reach ${reach}: the model rule holds ${a.objects - b.objects} fewer objects in range than the old one (${b.objects} against ${a.objects}), the furniture floor keeping ${b.objects - bare.objects} of them`);
    if (reach === 1.6) ok(a.tiers === 47, 'at the owner\'s reach the old streamer held 47 region tiers round Mos Eisley, as counted against the code before step 6: the old rule is filed exactly as it was, not as a proxy');
  }
}

{
  // One shared stencil reference, through an accessor on three's Material prototype.
  ok(PORTAL_REF.installed && Object.getOwnPropertyDescriptor(THREE.Material.prototype, 'stencilRef')?.get !== undefined, 'the accessor is on `Material.prototype` once this module is loaded');
  PORTAL_REF.value = 1;
  const set = new Set<THREE.Material>();
  const a = new THREE.MeshStandardMaterial();
  const b = new THREE.MeshBasicMaterial();
  ok(a.stencilRef === 0 && !Object.prototype.hasOwnProperty.call(a, 'stencilRef'), 'a new material reads the constructor\'s own 0 through the accessor, and has no field of that name of its own');
  for (const m of [a, b]) {
    m.stencilRef = 7;
    shareRef(m);
    set.add(m);
  }
  ok(isShared(a) && a.stencilRef === 1 && b.stencilRef === 1, "a registered material's reference is the shared one");
  setPortalRef(2, set);
  ok(a.stencilRef === 2 && b.stencilRef === 2, 'moving the shared value moves every registered material with no walk');
  const clone = a.clone();
  ok(!isShared(clone) && clone.stencilRef === 2, 'a clone gets the value of that moment as a plain value of its own');
  setPortalRef(1, set);
  ok(clone.stencilRef === 2 && a.stencilRef === 1, 'and does not follow the shared value after');
  const before = PORTAL_REF.foreignWrites;
  a.stencilRef = 5;
  a.stencilRef = 1;
  ok(a.stencilRef === 1 && PORTAL_REF.foreignWrites === before + 1, 'a write from elsewhere is not taken, and is counted (a write of the value in force is no write)');
  const c = new THREE.MeshBasicMaterial();
  c.copy(a);
  ok(c.stencilRef === 1 && !isShared(c), '`Material.copy` from a registered material writes a plain value');
  ok(new THREE.MeshBasicMaterial({ stencilRef: 3 }).stencilRef === 3, 'a material made with a reference in its parameters takes it through the accessor');
  unshareRef(a);
  setPortalRef(2, set);
  ok(!isShared(a) && a.stencilRef === 1 && b.stencilRef === 2, 'a material let go holds the value in force as its own, and no longer follows');
  a.stencilRef = 9;
  ok(a.stencilRef === 9, 'and takes writes again');
  shareRef(a);
  setSharedRef(false, set);
  ok(!isShared(a) && !isShared(b) && a.stencilRef === 2 && b.stencilRef === 2, 'switched off, every material holds the value in force');
  setPortalRef(1, set);
  ok(a.stencilRef === 1 && b.stencilRef === 1, 'and the old way walks the set writing each');
  setSharedRef(true, set);
  setPortalRef(2, set);
  ok(isShared(a) && isShared(b) && a.stencilRef === 2, 'switched back on, every material follows again');
  // A material made before the accessor existed carries a field of its own that shadows it: it cannot follow, so it is walked.
  const old = new THREE.MeshBasicMaterial();
  Object.defineProperty(old, 'stencilRef', { configurable: true, enumerable: true, writable: true, value: 0 });
  const legacyBefore = legacyCount();
  shareRef(old);
  set.add(old);
  setPortalRef(1, set);
  ok(old.stencilRef === 1 && legacyCount() === legacyBefore + 1 && !isShared(old), 'a material with a field of its own is registered as a legacy one and written each time the reference moves');
  unshareRef(old);
  set.delete(old);
  ok(legacyCount() === legacyBefore, 'and let go of like any other');
  // Fast mode: the reason the accessor is on the prototype. Only with --allow-natives-syntax.
  let hasFast: ((o: object) => boolean) | null = null;
  try {
    hasFast = new Function('o', 'return %HasFastProperties(o)') as (o: object) => boolean;
  } catch {
    hasFast = null;
  }
  if (!hasFast) console.log('skip  V8 fast mode: run with --allow-natives-syntax to check it');
  else {
    const fresh = [new THREE.MeshStandardMaterial(), new THREE.MeshBasicMaterial(), new THREE.MeshLambertMaterial(), new THREE.ShaderMaterial()];
    const reg = new Set<THREE.Material>(fresh);
    for (const m of fresh) shareRef(m);
    setPortalRef(2, reg);
    setSharedRef(false, reg);
    setPortalRef(1, reg);
    setSharedRef(true, reg);
    for (const m of fresh) unshareRef(m);
    ok(fresh.every((m) => hasFast!(m)) && [a, b, clone, c].every((m) => hasFast!(m)), 'every material stays in V8\'s fast mode through registering, both ways of moving the reference, the switch and being let go (an accessor defined on the material itself turned it into a dictionary for good)');
    // What the first cut did: three's constructor had made `stencilRef` a plain field of the material's own, and
    // registering redefined that field as an accessor on the material. Played out here on a material given the
    // plain field three would have made without the prototype's accessor.
    const redefined = new THREE.MeshStandardMaterial();
    Object.defineProperty(redefined, 'stencilRef', { configurable: true, enumerable: true, writable: true, value: 0 });
    const fastWithField = hasFast(redefined);
    Object.defineProperty(redefined, 'stencilRef', { configurable: true, enumerable: true, get: () => 1, set: () => {} });
    ok(fastWithField && !hasFast(redefined), 'which is so: a material whose own plain field is redefined as an accessor becomes a dictionary');
  }
  PORTAL_REF.value = 1;
  // The renderer's reads cost nothing to allocate: a million reads through the getter.
  let sum = 0;
  for (let i = 0; i < 1e6; i++) sum += b.stencilRef;
  ok(sum === 1e6, 'a million reads through the getter');
}

{
  // What was added, queued for the scan.
  const scene = new THREE.Scene();
  const ground = new THREE.Group();
  scene.add(ground);
  const adds = new SceneAdds();
  adds.watch(scene);
  adds.watch(ground);
  adds.watch(scene);
  const tier = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const chunk = new THREE.Group();
  const gone = new THREE.Mesh();
  const deep = new THREE.Mesh();
  scene.add(tier);
  ground.add(chunk);
  scene.add(gone);
  scene.remove(gone);
  tier.add(deep);
  scene.add(tier);
  ok(adds.pending === 4 && adds.watching === 2, 'an add to the scene or the ground root is queued (the same container watched twice hears it once); one deeper is not');
  const seen: THREE.Object3D[] = [];
  const walked = adds.drain(scene, (o) => seen.push(o));
  ok(walked === 2 && seen[0] === tier && seen[1] === chunk, 'the drain walks each root still in the scene, once');
  ok(adds.stats.gone === 1 && adds.stats.repeats === 1 && adds.pending === 0, 'one that left again is skipped, one added twice is walked once, and the queue is empty after');
  ok(under(deep, scene) && !under(gone, scene) && under(scene, scene), '`under` climbs the parents');
  adds.unwatch(ground);
  ground.add(new THREE.Group());
  ok(adds.pending === 0 && adds.watching === 1, 'a container unwatched is not heard');
  scene.add(new THREE.Group());
  adds.clear();
  ok(adds.pending === 0 && adds.drain(scene, () => assert.fail('nothing to walk')) === 0, 'a cleared queue walks nothing');
  ok(SCAN_TUNE.queued && SCAN_TUNE.backstopMs >= 8 * SCAN_TUNE.everyMs, 'the scan walks what was added, and the whole scene only every eight scans or more');
}

{
  // The scan itself (`MaterialScan`), driven over a real scene with an adopt that does what the world's does
  // to the one thing that matters here: says which drawables' materials it has not seen before.
  const scene = new THREE.Scene();
  const adds = new SceneAdds();
  adds.watch(scene);
  const known = new Set<THREE.Material>();
  const compiled: THREE.Object3D[] = [];
  let screen = false;
  const host: ScanHost = {
    scene,
    adopt: (root) => {
      const fresh: THREE.Object3D[] = [];
      root.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (!(o as THREE.Mesh).isMesh || !m || known.has(m)) return;
        known.add(m);
        fresh.push(o);
      });
      return fresh;
    },
    compile: (fresh) => compiled.push(...fresh),
    get behindScreen() {
      return screen;
    },
  };
  const scan = new MaterialScan(adds);
  const tune = { queued: true, everyMs: 250, backstopMs: 2000 };
  scan.run(0, host, tune);
  ok(scan.last.whole && scan.stats.whole === 1, 'the first scan walks the whole scene');
  const container = new THREE.Group();
  scene.add(container);
  const tierMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  scene.add(tierMesh);
  scan.run(250, host, tune);
  ok(scan.last.roots === 2 && !scan.last.whole && compiled.includes(tierMesh) && known.has(tierMesh.material as THREE.Material), 'a mesh added to the scene is walked from the queue at the next scan, adopted and queued to compile, with no whole-scene walk');
  // Something hung deeper, under a container already standing that nobody watches: the queue does not hear it.
  const deep = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  container.add(deep);
  scan.run(500, host, tune);
  ok(scan.last.roots === 0 && !known.has(deep.material as THREE.Material), 'a mesh hung under a container nobody watches is not found by the queued scan');
  scan.run(1750, host, tune);
  ok(!scan.last.whole && scan.stats.missed === 0, 'nor before the backstop is due');
  scan.run(2000, host, tune);
  ok(scan.last.whole && scan.last.missed === 1 && scan.stats.missed === 1 && scan.stats.missedInPlay === 1 && compiled.includes(deep), 'the backstop finds it two seconds after the last whole walk, adopts and compiles it, and counts it missed in play');
  ok(/Mesh under Group under Scene/.test(scan.stats.lastMissed[scan.stats.lastMissed.length - 1]), `and names where it hung: "${scan.stats.lastMissed[scan.stats.lastMissed.length - 1]}"`);
  const deep2 = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  container.add(deep2);
  screen = true;
  scan.run(4000, host, tune);
  ok(scan.stats.missed === 2 && scan.stats.missedInPlay === 1 && /behind a screen/.test(scan.stats.lastMissed[scan.stats.lastMissed.length - 1]), 'one found behind a loading screen is counted missed but not in play, since nothing drew it');
  screen = false;
  // Hung under a group kept hidden while it is dressed (a fighter's rig): found, but nothing could have drawn it.
  const rig = new THREE.Group();
  rig.visible = false;
  container.add(rig);
  rig.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
  scan.run(6000, host, tune);
  ok(scan.stats.missed === 3 && scan.stats.missedInPlay === 1 && /\(hidden\)/.test(scan.stats.lastMissed[scan.stats.lastMissed.length - 1]), 'one found under a group still hidden is counted missed but not in play: nothing drew it before its own path adopts it');
  // Watched, the same container's adds are heard.
  adds.watch(container);
  const deep3 = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  container.add(deep3);
  scan.run(6250, host, tune);
  ok(scan.last.roots === 1 && known.has(deep3.material as THREE.Material) && scan.stats.missed === 3, 'watched, a container\'s adds are walked from the queue and never reach the backstop');
  // A root added and removed again before the scan is skipped, and never adopted.
  const brief = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  scene.add(brief);
  scene.remove(brief);
  scan.run(6500, host, tune);
  ok(!known.has(brief.material as THREE.Material), 'a mesh taken away again before the scan is not adopted, so nothing it had joins a set it has left');
  // The old way: the whole scene every scan, and nothing counted missed.
  const old = { queued: false, everyMs: 250, backstopMs: 2000 };
  const deep4 = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  container.add(deep4);
  const wholeBefore = scan.stats.whole;
  scan.run(6750, host, old);
  scan.run(7000, host, old);
  ok(scan.stats.whole === wholeBefore + 2 && known.has(deep4.material as THREE.Material) && scan.stats.missed === 3 && adds.pending === 0, 'switched off it walks the whole scene every time, finds what is new, counts nothing missed and keeps no queue');
}

{
  // The wiring, read as text.
  const src = (p: string): string => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const ls = src('world/layoutStream.ts');
  const pr = src('world/portalRender.ts');
  const world = src('world/world.ts');
  const main = src('main.ts');
  const creatures = src('world/creatures.ts');
  ok(/const sizeTier = modelTier\(o\.radius, def\?\.bounds, !!def\?\.particle\);\s*const snapTier = snapshotTier\(o\.radius\);[\s\S]{0,300}tier: this\.filing === 'snapshot' \? snapTier : sizeTier/.test(ls), "the layout's objects are filed by the rule the world was read under, each rule's answer kept");
  ok(/const sizeTier = modelTier\(p\.radius, def\?\.bounds, !!def\?\.particle\);\s*const snapTier = snapshotTier\(p\.radius\);[\s\S]{0,400}tier: this\.filing === 'snapshot' \? snapTier : sizeTier/.test(ls), 'and a thing placed in play the same way');
  ok(/private filingRule: 'model' \| 'snapshot' = PLACED_TUNE\.tierRule;/.test(ls), 'the rule is read when the world is read');
  ok(/private rangeOf\(region: Region, t: number, room: number\): number \{\s*return regionRange\(this\.ranges\[t\], region\.indoor\[t\], room, this\.filing\);/.test(ls) && (ls.match(/this\.rangeOf\(region, t, room\)/g) ?? []).length === 5, "every range test goes through `rangeOf`, which is `regionRange` over the tier's own range, its furniture reach and the rooms' range");
  ok(/private roomRange\(\): number \{\s*return interiorBuildRangeMax\(\);/.test(ls), "the rooms' range is `interiorBuildRangeMax`, read live");
  ok(/const reach = hostReach\(host\.x, host\.z, hostRadiusOf\(hostDef\?\.bounds\), region\.cx, region\.cz\);\s*if \(reach > region\.indoor\[p\.tier\]\) region\.indoor\[p\.tier\] = reach;/.test(ls) && /this\.noteIndoor\(p, defs\.get\(p\.host\.model\)\);/.test(ls) && /if \(placed\.host\) this\.noteIndoor\(placed, this\.defOf\(placed\.host\.model\)\);/.test(ls), "a thing in a building's rooms raises its tier's furniture reach, from the layout and when placed in play");
  ok(/refile\(rule: 'model' \| 'snapshot'\): boolean \{[\s\S]{0,400}this\.unloadTier\(region, t\);[\s\S]{0,600}p\.tier = rule === 'snapshot' \? p\.snapTier : p\.sizeTier;/.test(ls), 'filing again drops every tier and files every object by the other rule');
  ok(/if \(!this\.world\.refilePlaced\(rule\)\) return[\s\S]{0,200}await this\.settle\(\);\s*cell = this\.world\.enterCellAt\(to, room\);/.test(main) && /this\.loadingScreen\.show\([\s\S]{0,200}'filing the world again'\);/.test(main), 'and only behind a loading screen, the player put back in their room after');
  ok(/private setRef\(ref: number\): void \{\s*setPortalRef\(ref, this\.materials\);\s*\}/.test(pr), "the renderer's reference is one call");
  ok(/m\.stencilFunc = THREE\.EqualStencilFunc;\s*shareRef\(m\);/.test(pr) && /if \(this\.materials\.delete\(m\)\) unshareRef\(m\);/.test(pr), 'a material registered takes the shared reference, and one forgotten gives it back');
  ok(/^\/\/[^\n]*\n\/\/[^\n]*\n\/\/[^\n]*\nimport '\.\/world\/stencilRef\.ts';\nimport \* as THREE from 'three';/.test(main), "the game loads the stencil accessor before anything else, so no material is made before it");
  ok(/this\.sceneAdds\.watch\(scene\);\s*this\.sceneAdds\.watch\(this\.chunkRoot\);/.test(world), 'the world queues what is added to the scene and to the ground root');
  ok(/this\.sceneAdds\.watch\(this\.creatures\.group\);\s*this\.creatures\.onModel = \(root\) => this\.noteAdded\(root\);/.test(world) && /this\.sceneAdds\.watch\(this\.turrets\.group\);/.test(world) && /this\.sceneAdds\.watch\(this\.mobiles\.group\);/.test(world), "and to the creatures', turrets' and mobiles' groups, with the creatures' late model queued");
  ok(/this\.sceneAdds\.unwatch\(this\.creatures\.group\);/.test(world) && /this\.sceneAdds\.unwatch\(this\.mobiles\.group\);/.test(world) && /this\.sceneAdds\.unwatch\(this\.turrets\.group\);/.test(world), 'and stops listening to them when they go with their world');
  ok(/for \(const c of this\.creatures\) c\.setModel\(m\);\s*this\.onModel\?\.\(this\.group\);/.test(creatures), 'the creatures say when their model is hung');
  ok(/async compileReady\(objects: THREE\.Object3D\[\]\): Promise<void> \{[\s\S]{0,1200}for \(const o of objects\) this\.adoptMaterials\(o\);\s*const meshes: THREE\.Object3D\[\] = \[\];/.test(world), 'every compile path adopts before it builds a program: a fighter dressed at run time among them');
  ok(/this\.ghost\.hold\(shown\);\s*this\.hangGhost\(\);/.test(main) && /this\.ghost\.hold\(model\);\s*this\.hangGhost\(\);/.test(main) && /this\.world\.watchAdds\(this\.ghost\.group\);[\s\S]{0,40}\}\s*this\.world\.adoptNow\(this\.ghost\.group\);/.test(main), "the placement ghost's see-through copies are adopted the moment it takes a model, and its group is listened to");
  ok(/if \(now - this\.csmScanAt > SCAN_TUNE\.everyMs\) \{\s*this\.csmScanAt = now;\s*perf\.begin\(SEC\.scan\);\s*this\.scanMaterials\(now\);\s*perf\.end\(SEC\.scan\);/.test(world) && /this\.scan\.run\(now, this\.scanHost\);/.test(world), "the quarter-second scan is `MaterialScan`, timed in the frame report's `scan` section");
  ok(/if \(this\.pack\) this\.forgetMaterials\(this\.pack\.loadedMaterials\(\)\);[\s\S]{0,60}this\.pack\?\.dispose\(\);/.test(world), "a world let go takes its placed objects' materials out of the portal set and the cascades before its pack disposes them");
  ok(/const placed = this\.behindScreen \? this\.placedStandIns\(\) : \[\];/.test(world) && /this\.world\.warmPlaced\(this\.player\.worldPos\);/.test(main) && /this\.warmPlaced\(spawn\);/.test(world), "the old rule's models round an arrival are loaded behind the screen and their programs built from stand-ins in the screen's own sweep");
  ok(/if \(PLACED_TUNE\.warmWaitMs > 0\) \{[\s\S]{0,120}await this\.world\.placedWarmSettled\(PLACED_TUNE\.warmWaitMs\);\s*\}\s*const tCompile = performance\.now\(\);/.test(main) && /if \(!indoor && this\.compiledMaterials\.has\(prim\.material\)\) continue;/.test(world), 'the screen waits for them only as long as the knob says, before its sweep, and an indoor piece is always warmed for the rooms\' pass');
  for (const k of ['placedTiers', 'sharedStencilRef', 'scanNew']) ok(new RegExp(`registerPerfSwitch\\('${k}'`).test(main), `the frame report's switch \`${k}\``);
}

console.log(`\n${checks} checks passed`);
