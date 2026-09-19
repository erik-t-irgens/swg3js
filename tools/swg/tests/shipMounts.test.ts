// Fitted parts at run time (src/vehicles/shipMounts.ts): hanging parts by hardpoint in dependency order,
// the guns and engine spots measured in the vehicle's frame with the wings closed, each gun's slot, the
// glows re-hung after a refit, a part's children split into what it carries and what hangs by name, the
// refit's staging (its compile order with stock and with custom paint) and one-step swap, the stand-ins
// decided again, two refits of one ship in turn, and the fitted tree on copies of two committed trees.
// Synthetic models only; no pack is read.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TRAIL_FORGET, collectMounts, countSpotHardpoints, dropWingsUnder, engineSpotsOf, fitTree, hangParts, inTurn, rebindGlows, recordHung, refitSwap, settleStandIns, splitPartChildren, stageRefit, swapParts, type GlowHost, type PendingPart, type ShipBuild, type StandIn } from '../../../src/vehicles/shipMounts.ts';
import { partsOf, type FitDef, type ResolvedFit } from '../../../src/vehicles/shipFit.ts';
import { WingSet, poseWing, type Wing } from '../../../src/vehicles/wings.ts';
import type { AttachmentDef } from '../../../src/vehicles/shipAssembly.ts';
import type { EngineTrail } from '../../../src/vehicles/trail';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const nearV = (a: THREE.Vector3, b: THREE.Vector3, eps = 1e-5) => a.distanceTo(b) < eps;
const show = (v: THREE.Vector3) => v.toArray().map((n) => n.toFixed(3)).join(', ');

/** A hardpoint node as GLTFLoader leaves it. */
function hp(name: string, x = 0, y = 0, z = 0): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = `hp${name}`;
  o.userData.name = `hp:${name}`;
  o.position.set(x, y, z);
  return o;
}
function group(...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  for (const c of children) g.add(c);
  return g;
}
/** A fitted part as the garage marks one. */
function part(slot: string, hardpoint: string, ...children: THREE.Object3D[]): THREE.Group {
  const g = group(...children);
  g.userData.attachment = 'component';
  g.userData.slot = slot;
  g.userData.hangsOn = hardpoint || null;
  g.userData.fitPart = true;
  return g;
}
const pending = (node: THREE.Object3D, slot: string, hardpoint: string, key?: string): PendingPart => ({ node, slot, hardpoint, label: `${slot} ${key ?? hardpoint}`, ...(key ? { key } : {}) });
const onModel = (n: THREE.Object3D, root: THREE.Object3D) => {
  for (let o: THREE.Object3D | null = n; o; o = o.parent) if (o === root) return true;
  return false;
};
/** A stand-in trail: its ribbon mesh and its calls. */
function fakeTrail(): EngineTrail & { calls: number[]; dts: number[] } {
  const t = { mesh: new THREE.Mesh(), calls: [] as number[], dts: [] as number[], update(dt: number, strength: number) { t.calls.push(strength); t.dts.push(dt); }, dispose() {} };
  return t as unknown as EngineTrail & { calls: number[]; dts: number[] };
}

// --- 1: hangParts -----------------------------------------------------------------------------------
{
  const model = group(hp('engine_pos1', 1, 0, 0));
  const engine = part('engine', 'engine_pos1', hp('booster1', 0, 0, -1));
  const booster = part('booster', 'booster1');
  const left = hangParts(model, [pending(booster, 'booster', 'booster1'), pending(engine, 'engine', 'engine_pos1')]);
  ok(left.length === 0 && engine.parent?.userData.name === 'hp:engine_pos1' && booster.parent?.userData.name === 'hp:booster1' && onModel(booster, model), 'a part whose hardpoint is on another pending part hangs after it, whatever the list order');
  const carrier = model.children[0];
  model.updateMatrixWorld(true);
  const before = booster.getWorldPosition(new THREE.Vector3());
  carrier.position.x += 2;
  model.updateMatrixWorld(true);
  ok(nearV(booster.getWorldPosition(new THREE.Vector3()), before.clone().setX(before.x + 2)), 'a part hangs under the node carrying its hardpoint, and moving that node moves the part');
  ok(carrier.userData.mountUsed === true, "the anchor is marked mountUsed");
  const stray = part('weapon_0', 'nowhere');
  const out = hangParts(model, [pending(stray, 'weapon_0', 'nowhere')]);
  ok(out.length === 1 && out[0].node === stray && stray.parent === null, 'a part whose hardpoint nothing carries is returned and not added');
  const c = part('a', 'x', hp('y'));
  const d = part('b', 'y', hp('x'));
  const both = hangParts(group(), [pending(c, 'a', 'x'), pending(d, 'b', 'y')]);
  ok(both.length === 2 && !c.parent && !d.parent, 'two parts that each wait for the other end in two passes, without spinning');
  const hull = group(hp('weapon1'));
  const g0 = part('weapon_0', 'weapon1');
  const g1 = part('weapon_1', 'weapon1');
  const shared = hangParts(hull, [pending(g0, 'weapon_0', 'weapon1', 'ships/gun.glb'), pending(g1, 'weapon_1', 'weapon1', 'ships/gun.glb')]);
  ok(shared.length === 0 && g0.parent !== null && g1.parent === null && g1.userData.sharedInto === g0 && (g0.userData.sharedWith as string[]).join() === 'weapon_1', 'the same file on the same hardpoint hangs once; the later slot joins sharedWith');
  const origin = part('bridge', '');
  hangParts(hull, [pending(origin, 'bridge', '')]);
  ok(origin.parent === hull, "a part with hardpoint '' hangs on the model itself");
  const wingNode = group(hp('engine_pos1'));
  wingNode.userData.attachment = 'wing';
  const hullHp = hp('engine_pos1');
  const both2 = group(wingNode, hullHp);
  const e2 = part('engine', 'engine_pos1');
  hangParts(both2, [pending(e2, 'engine', 'engine_pos1')]);
  ok(e2.parent === hullHp, "the hull's own hardpoint is taken before one on a part");
}

// --- 2: collectMounts in the frame, wings closed -------------------------------------------------------
{
  const frame = new THREE.Group();
  frame.rotation.y = Math.PI / 2;
  frame.position.set(5, 0, -3);
  const model = new THREE.Group();
  const muzzle = hp('muzzle1', 1, 0, 2);
  model.add(muzzle);
  frame.add(model);
  const m = collectMounts(model, frame, [], []);
  ok(m.guns.length === 1 && nearV(m.guns[0].pos, new THREE.Vector3(1, 0, 2)), `pos is in the frame's space whatever its turn: (1, 0, 2), not (2, 0, -1) (${show(m.guns[0].pos)})`);
  ok(nearV(m.guns[0].dir, new THREE.Vector3(0, 0, 1)), 'dir is +Z in the frame');
  // The same with a wing turned open: the gun is measured where it stands with the wing closed.
  const model2 = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.userData.wingPivot = true;
  pivot.position.set(1, 0, 0);
  const wmuzzle = hp('muzzle1', 2, 0, 0);
  pivot.add(wmuzzle);
  model2.add(pivot);
  const frame2 = new THREE.Group();
  frame2.rotation.y = Math.PI / 2;
  frame2.add(model2);
  const wing: Wing = { pivot, angle: Math.PI / 4, time: 1, open: 0, label: 'w' };
  const set = new WingSet();
  set.add(wing);
  poseWing(wing, 1);
  const open = collectMounts(model2, frame2, [], set);
  ok(nearV(open.guns[0].pos, new THREE.Vector3(3, 0, 0)) && wing.open === 1, `an open wing's gun is measured closed (${show(open.guns[0].pos)}), and the wing is posed back open`);
}

// --- 3: each gun's slot ---------------------------------------------------------------------------------
{
  const model = group(hp('weapon1_pos1'));
  const gunPart = part('weapon_1', 'weapon1_pos1', hp('muzzle1', 0, 0, 1));
  hangParts(model, [pending(gunPart, 'weapon_1', 'weapon1_pos1')]);
  const m = collectMounts(model, model, [], []);
  ok(m.guns.length === 1 && m.guns[0].slot === 'weapon_1' && m.guns[0].hardpoint === 'weapon1_pos1', 'a muzzle inside a part tagged weapon_1 gives slot weapon_1');
  const model2 = group(hp('weapon1'));
  const bare = part('weapon_0', 'weapon1', new THREE.Mesh());
  hangParts(model2, [pending(bare, 'weapon_0', 'weapon1')]);
  const m2 = collectMounts(model2, model2, [], []);
  ok(m2.guns.length === 1 && m2.guns[0].slot === 'weapon_0', 'a hull mount hardpoint with a part tagged weapon_0 hung under it and no muzzle gives weapon_0');
  const model3 = group(hp('weapon1'), hp('muzzle1', 0, 0, 2));
  const m3 = collectMounts(model3, model3, [], []);
  ok(m3.guns.length === 1 && m3.guns[0].node.userData.name === 'hp:muzzle1' && m3.guns[0].slot === null, 'muzzles replace mounts (a hull muzzle has no slot)');
}

// --- 4: engine spots and rebindGlows ----------------------------------------------------------------------
{
  const model = group(hp('engine1'), hp('exhaust1'));
  ok(engineSpotsOf(model, []).map((o) => o.userData.name).join() === 'hp:exhaust1', 'engine spots take the best tier (exhaust over a numbered engine)');
  const glowPart = part('engine', '', hp('engine_glow1'), hp('engine_glow2'));
  model.add(glowPart);
  ok(engineSpotsOf(model, []).length === 2 && countSpotHardpoints(model, []) === 4, "an engine part's own glow points win; every candidate counts toward the spares");
  const bare = group();
  const rear = new THREE.Object3D();
  rear.userData.glowSpot = true;
  bare.add(rear);
  ok(engineSpotsOf(bare, [])[0] === rear, 'with no hardpoints, the glow spots at the rear of the box');

  const scene = new THREE.Scene();
  const vgroup = new THREE.Group();
  scene.add(vgroup);
  const hull = new THREE.Group();
  vgroup.add(hull);
  const spotA = hp('engine_glow1');
  const spotB = hp('engine_glow2');
  hull.add(spotA, spotB);
  const made: (EngineTrail & { calls: number[] })[] = [];
  const host: GlowHost = { group: vgroup, glows: [], glowMaterial: new THREE.SpriteMaterial(), glowSize: 1.5, glowColor: 0x9fd8ff, engines: [], trails: [] };
  const makeTrail = () => {
    const t = fakeTrail();
    made.push(t);
    return t;
  };
  const leaves = () => host.engines.some((e) => !onModel(e.object, vgroup));
  rebindGlows(host, [spotA], makeTrail);
  ok(host.engines.length === 1 && host.trails.length === 1 && host.glows.length === 1 && host.engines[0].object.parent === spotA && host.engines[0].size === 1.5, 'one spot: one live glow on it, one trail');
  rebindGlows(host, [spotA, spotB], makeTrail);
  ok(host.engines.length === 2 && host.trails.length === 2 && host.engines[1].object.parent === spotB && !leaves(), 'two spots: two live glows, two trails, none outside the group');
  ok(made.every((t) => t.mesh.parent === scene), "every trail's ribbon is in the trails' holder (the group's parent)");
  const second = host.glows[1];
  rebindGlows(host, [spotB], makeTrail);
  ok(host.engines.length === 1 && host.trails.length === 1 && host.engines[0].object.parent === spotB, 'one spot again: one live glow');
  ok(second.parent === vgroup && second.visible === false && second.userData.parked === true && host.glows.length === 2, 'the surplus sprite is parked under the group, invisible');
  ok(!leaves() && Math.abs(host.engines[0].seed) < 1e-9, "no engine's object leaves the group; seeds follow the live order");
  const parkedTrail = second.userData.trail as EngineTrail & { calls: number[]; dts: number[] };
  ok(parkedTrail.mesh.visible === false && parkedTrail.calls[parkedTrail.calls.length - 1] === 0, "a parked glow's trail is hidden, at strength 0");
  ok(parkedTrail.dts[parkedTrail.dts.length - 1] === TRAIL_FORGET && TRAIL_FORGET > 0.9, `a parked glow's trail is aged past its 0.9 s span (${TRAIL_FORGET} s), so brought back it draws no ribbon from where it was parked`);
}

// --- 5: swapParts ---------------------------------------------------------------------------------------
{
  const model = group(hp('engine_pos1'));
  const build: ShipBuild = { root: model, fitParts: new Map(), pending: [] };
  const engine1 = part('engine', 'engine_pos1', hp('booster1'));
  const booster = part('booster', 'booster1');
  const first = [pending(engine1, 'engine', 'engine_pos1', 'e1'), pending(booster, 'booster', 'booster1', 'b')];
  const w0 = hangParts(model, first);
  recordHung(build, first, w0);
  ok(booster.parent?.parent === engine1, 'the booster rides the engine that carries booster1');
  const engine2 = part('engine', 'engine_pos1', hp('booster1'));
  const r1 = swapParts(build, ['engine'], [pending(engine2, 'engine', 'engine_pos1', 'e2')]);
  ok(r1.removed.length === 1 && r1.removed[0] === engine1 && r1.waiting.length === 0, 'removed lists exactly the old root');
  ok(booster.parent?.parent === engine2 && onModel(booster, model), 'taking down an engine that carries a booster re-hangs the booster when the new engine carries booster1');
  const engine3 = part('engine', 'engine_pos1');
  const r2 = swapParts(build, ['engine'], [pending(engine3, 'engine', 'engine_pos1', 'e3')]);
  ok(r2.waiting.length === 1 && r2.waiting[0].node === booster && !onModel(booster, model) && build.pending.length === 1, 'and leaves it waiting when it does not');
  const engine4 = part('engine', 'engine_pos1', hp('booster1'));
  const r3 = swapParts(build, ['engine'], [pending(engine4, 'engine', 'engine_pos1', 'e2')]);
  ok(r3.waiting.length === 0 && booster.parent?.parent === engine4 && build.pending.length === 0, 'a later swap back hangs it');
  ok(model.children[0].userData.mountUsed === true && (build.fitParts.get('booster') ?? []).includes(booster), 'the build records what hangs where');
  // A part two slots share stays when only one of them changes.
  const hull = group(hp('weapon1'));
  const b2: ShipBuild = { root: hull, fitParts: new Map(), pending: [] };
  const gun = part('weapon_0', 'weapon1');
  const twin = part('weapon_1', 'weapon1');
  const list = [pending(gun, 'weapon_0', 'weapon1', 'gun'), pending(twin, 'weapon_1', 'weapon1', 'gun')];
  recordHung(b2, list, hangParts(hull, list));
  const r4 = swapParts(b2, ['weapon_0'], []);
  ok(r4.removed.length === 0 && gun.parent !== null && gun.userData.slot === 'weapon_1', 'a part another slot also shows stays, now that slot\'s alone');
}

// --- 6: the refit's order ----------------------------------------------------------------------------------
{
  const scene = new THREE.Scene();
  const vgroup = new THREE.Group();
  scene.add(vgroup);
  const model = group(hp('engine_pos1'));
  vgroup.add(model);
  const build: ShipBuild = { root: model, fitParts: new Map(), pending: [] };
  const old = part('engine', 'engine_pos1', hp('engine_glow1'));
  const list = [pending(old, 'engine', 'engine_pos1', 'old')];
  recordHung(build, list, hangParts(model, list));
  const host: GlowHost = { group: vgroup, glows: [], glowMaterial: new THREE.SpriteMaterial(), glowSize: 1, glowColor: 0, engines: [], trails: [] };
  rebindGlows(host, engineSpotsOf(model, []), () => fakeTrail());
  ok(host.glows[0].parent === old.children[0], 'before: the glow sits on the old engine');
  const fresh = part('engine', 'engine_pos1', hp('engine_glow1'), hp('engine_glow2'));
  const order: string[] = [];
  const tracked: THREE.Object3D[] = [];
  const untracked: THREE.Object3D[] = [];
  const spare = { sprites: [] as THREE.Sprite[], trails: [] as EngineTrail[] };
  const staged = await stageRefit(build, ['engine'], [pending(fresh, 'engine', 'engine_pos1', 'fresh')], {
    track: (n) => tracked.push(n),
    untrack: (n) => untracked.push(n),
    prepare: async (roots) => {
      order.push(`prepare(${roots.length})`);
      ok(fresh.parent === roots[0] && !onModel(fresh, model) && build.fitParts.get('engine')?.[0] === old && old.parent !== null, 'prepare runs on the staged group, before anything is swapped');
      ok(roots.length === 2 && roots[1] === spare.trails[0].mesh, 'the spare trails are prepared with it');
    },
    extra: (g) => {
      order.push('extra');
      const sp = new THREE.Sprite(host.glowMaterial!);
      g.add(sp);
      spare.sprites.push(sp);
      spare.trails.push(fakeTrail());
      return [spare.trails[0].mesh];
    },
    after: async () => {
      order.push('after');
    },
  });
  ok(order.join() === 'extra,prepare(2),after' && tracked[0] === fresh, 'staging with stock paint: extra, prepared once, tracked (no material changed), then the paint waited for');
  ok(old.parent !== null && !onModel(fresh, model), 'nothing on the model changed while staging');
  const glowsUnderRemoved = () => host.glows.some((g) => onModel(g, old) && old !== g);
  const commit = () => {
    order.push('swap');
    ok(!glowsUnderRemoved(), 'no glow sprite is under the part about to go when the swap runs');
    return staged.commit();
  };
  const r = refitSwap(host, commit, model, [], [], () => fakeTrail(), spare);
  ok(order[order.length - 1] === 'swap' && r.removed[0] === old && untracked[0] === old && !onModel(old, model), 'the swap takes the old engine down, and the paint forgets it');
  ok(host.engines.length === 2 && host.engines.every((e) => onModel(e.object, fresh)) && host.glows.includes(spare.sprites[0]), 'the glows are re-hung on the new engine, the spare sprite among them');
  ok(!host.glows.some((g) => onModel(g, old)), 'no glow is left under the removed part');
}

// --- 6b: staging while the paint is custom: the part's own materials compile first, then the copies -----------
{
  const model = group(hp('engine_pos1'));
  const build: ShipBuild = { root: model, fitParts: new Map(), pending: [] };
  const source = new THREE.MeshStandardMaterial({ name: 'hull_paint' });
  const copy = source.clone();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), source);
  const fresh = part('engine', 'engine_pos1', mesh);
  const order: string[] = [];
  const compiled = new Set<THREE.Material>();
  let untracked: THREE.Object3D[] = [];
  const hooks = {
    // The paint while custom: tracking puts the ship's copy on at once.
    track: (n: THREE.Object3D) => {
      order.push('track');
      n.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material === source) (o as THREE.Mesh).material = copy;
      });
    },
    untrack: (n: THREE.Object3D) => untracked.push(n),
    prepare: async (roots: THREE.Object3D[]) => {
      order.push(`prepare(${roots.length})`);
      for (const r of roots) r.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) compiled.add((o as THREE.Mesh).material as THREE.Material);
      });
    },
    after: async () => {
      order.push('after');
    },
  };
  const staged = await stageRefit(build, ['engine'], [pending(fresh, 'engine', 'engine_pos1', 'fresh')], hooks);
  ok(order.join() === 'prepare(1),track,prepare(1),after', `custom paint: prepared, tracked, prepared again, then the paint waited for (${order.join()})`);
  ok(compiled.has(source) && compiled.has(copy), "both the part's own material (what it wears when the paint goes back to stock) and the ship's copy are compiled before the swap");
  staged.commit();
  ok(onModel(fresh, model) && mesh.material === copy, 'the swap hangs the part wearing the copy');
  // A staged duplicate of a part already hung merges into it and never goes on the ship: the paint lets it go.
  const hull = group(hp('weapon1'));
  const b2: ShipBuild = { root: hull, fitParts: new Map(), pending: [] };
  const kept = part('weapon_0', 'weapon1');
  const first = [pending(kept, 'weapon_0', 'weapon1', 'gun')];
  recordHung(b2, first, hangParts(hull, first));
  const dup = part('weapon_1', 'weapon1');
  untracked = [];
  const s2 = await stageRefit(b2, ['weapon_1'], [pending(dup, 'weapon_1', 'weapon1', 'gun')], { track: () => {}, untrack: (n) => untracked.push(n), prepare: async () => {} });
  s2.commit();
  ok(dup.parent === null && dup.userData.sharedInto === kept && untracked.includes(dup) && !untracked.includes(kept), 'a staged part merged into an identical one already hung is untracked; the kept one is not');
}

// --- 6c: by-name parts hang after every fitted part --------------------------------------------------------
{
  const hull = group(hp('engine1'));
  const onFitted = part('engine', 'engine1');
  const onByName = part('engine', 'engine1');
  const byName: PendingPart = { ...pending(onByName, 'engine', 'engine1', 'same'), byName: true };
  const left = hangParts(hull, [byName, pending(onFitted, 'engine', 'engine1', 'same')]);
  ok(left.length === 0 && onFitted.parent !== null && onByName.parent === null && onByName.userData.sharedInto === onFitted, 'a by-name part listed first still waits for the fitted parts: the fitted one hangs, the by-name duplicate merges into it');
  const hull2 = group(hp('engine1'));
  const carrier = part('engine', 'engine1', hp('engine_on1'));
  const onApp = part('engine', 'engine_on1');
  const gunOnOn = part('weapon_0', 'gun_on_on', new THREE.Object3D());
  onApp.add(hp('gun_on_on'));
  const left2 = hangParts(hull2, [{ ...pending(onApp, 'engine', 'engine_on1'), byName: true }, pending(gunOnOn, 'weapon_0', 'gun_on_on'), pending(carrier, 'engine', 'engine1')]);
  ok(left2.length === 0 && onApp.parent?.userData.name === 'hp:engine_on1' && onModel(gunOnOn, hull2), 'a by-name part hangs on a fitted part; a fitted part waiting for a hardpoint only a by-name part carries still hangs, in the second round');
}

// --- 6d: stand-ins decided again on a swap ------------------------------------------------------------------
{
  const model = group(hp('engine1'));
  const standMesh = new THREE.Group();
  standMesh.userData.attachment = 'carrier';
  const mount = new THREE.Group();
  mount.userData.mountOf = -1;
  mount.add(standMesh);
  model.add(mount);
  const si: StandIn = { standsFor: 'engine', def: { kind: 'carrier', file: 'none.glb', parent: null, hardpoint: null, place: [0, 0, 0, 0, 0, 0], standInFor: 'engine' }, label: 'carrier none.glb', node: mount, ready: true };
  const build: ShipBuild = { root: model, fitParts: new Map(), pending: [], standIns: [si] };
  const engine = part('engine', 'engine1');
  const r1 = swapParts(build, ['engine'], [pending(engine, 'engine', 'engine1', 'e')]);
  ok(onModel(engine, model) && !onModel(mount, model) && r1.standIns?.down[0] === mount && !r1.removed.includes(mount), "an engine refitted onto a ship that showed its empty engine's stand-in takes the stand-in down (kept for later, not untracked)");
  const r2 = swapParts(build, ['engine'], []);
  ok(!onModel(engine, model) && mount.parent === model && r2.standIns?.up[0] === mount, 'emptying the engine again hangs the stand-in where it stood');
  // A weapon slot fills a stand-in for `weapon`; a stand-in not yet prepared is never hung.
  const w: StandIn = { standsFor: 'weapon', def: { kind: 'carrier', file: 'w.glb', parent: null, hardpoint: 'engine1', place: null, standInFor: 'weapon' }, label: 'carrier w.glb', node: new THREE.Group(), ready: false };
  const b2: ShipBuild = { root: group(hp('engine1')), fitParts: new Map(), pending: [], standIns: [w] };
  const s0 = settleStandIns(b2);
  ok(s0.missing[0] === w && w.node!.parent === null, 'a stand-in not prepared is not hung (named as missing)');
  const staged = await stageRefit(b2, ['weapon_0'], [], { prepare: async (roots) => ok(onModel(w.node!, roots[0]), 'the staging prepares a loaded stand-in with the parts') });
  ok(w.ready === true, 'and marks it prepared');
  const r3 = staged.commit();
  ok(r3.standIns?.up[0] === w.node && w.node!.parent?.userData.name === 'hp:engine1', 'the swap then hangs it on its hardpoint, the weapon slots being empty');
  b2.fitParts.set('weapon_1', [new THREE.Object3D()]);
  ok(settleStandIns(b2).down[0] === w.node, "any weapon_N with a part fills a stand-in for 'weapon'");
}

// --- 6e: two refits of one ship, one after the other ---------------------------------------------------------
{
  /** A ship with its engine slot, refitted by staging and swapping as the garage does, reading the ship's fit when its turn comes. */
  const make = () => {
    const model = group(hp('engine1'));
    const build: ShipBuild = { root: model, fitParts: new Map(), pending: [] };
    const a = part('engine', 'engine1');
    a.name = 'A';
    const first = [pending(a, 'engine', 'engine1', 'A')];
    recordHung(build, first, hangParts(model, first));
    return { model, build, ship: { fit: 'A' } };
  };
  /** A promise and the function that settles it (the paint's wait, released by the test). */
  const gate = () => {
    let open!: () => void;
    const wait = new Promise<void>((r) => (open = r));
    return { wait, open };
  };
  const refit = async (s: ReturnType<typeof make>, next: string, wait: Promise<void> | null) => {
    const was = s.ship.fit;
    const slots = was === next ? [] : ['engine'];
    const node = part('engine', 'engine1');
    node.name = next;
    const parts = slots.length ? [pending(node, 'engine', 'engine1', next)] : [];
    const staged = await stageRefit(s.build, slots, parts, { prepare: async () => {}, after: async () => void (await wait) });
    staged.commit();
    s.ship.fit = next;
  };
  const shows = (s: ReturnType<typeof make>) => (s.build.fitParts.get('engine') ?? []).map((n) => n.name).join();
  // Overlapping (what the queue prevents): the second is staged from the fit the first has not yet replaced,
  // and its paint wait ends after the first has swapped.
  const loose = make();
  const g1 = gate();
  const g2 = gate();
  const l1 = refit(loose, 'B', g1.wait);
  const l2 = refit(loose, 'A', g2.wait);
  g1.open();
  await l1;
  g2.open();
  await l2;
  ok(shows(loose) === 'B' && loose.ship.fit === 'A', `overlapping refits leave the model showing B while the fit says A (the failure the queue prevents: shows ${shows(loose)}, fit ${loose.ship.fit})`);
  const queued = make();
  const turns = new WeakMap<object, Promise<unknown>>();
  const h1 = gate();
  const h2 = gate();
  const q1 = inTurn(turns, queued.ship, () => refit(queued, 'B', h1.wait));
  const q2 = inTurn(turns, queued.ship, () => refit(queued, 'A', h2.wait));
  h1.open();
  await q1;
  ok(shows(queued) === 'B' && queued.ship.fit === 'B', 'in turn: the first refit swaps B in while the second has not started');
  h2.open();
  await q2;
  ok(shows(queued) === 'A' && queued.ship.fit === 'A', `the second starts from the first's result and the model ends with the second fit's part (shows ${shows(queued)})`);
  const failing = inTurn(turns, queued.ship, async () => {
    throw new Error('staging failed');
  });
  const after = inTurn(turns, queued.ship, async () => 'ran');
  ok((await failing.then(() => 'no', () => 'threw')) === 'threw' && (await after) === 'ran', 'a refit that fails does not stop the next');
}

// --- 6f: wings on parts taken down leave the set --------------------------------------------------------------
{
  const set = new WingSet();
  const partRoot = group();
  const onPart: Wing = { pivot: new THREE.Group(), angle: 0.3, time: 1, open: 0, label: 'on part' };
  partRoot.add(onPart.pivot);
  const own: Wing = { pivot: new THREE.Group(), angle: 0.3, time: 1, open: 0, label: 'hull' };
  set.add(own);
  set.add(onPart);
  ok(dropWingsUnder(set, [partRoot]) === 1 && set.list.length === 1 && set.list[0] === own, "a wing under a part taken down leaves the ship's set; the hull's own stays");
}

// --- 6g: the fitted tree on the committed X-wing and YT-1300 trees (copied from a ships manifest) ------------------
{
  const xwing: AttachmentDef[] = [
    { kind: 'wing', source: 'WING', file: 'xwing_wing_pos.glb', parent: null, hardpoint: null, place: [0, 0, 0, 0, 0, 0], turn: { angle: -14, time: 3 } },
    { kind: 'wing', source: 'WING', file: 'xwing_wing_neg.glb', parent: null, hardpoint: null, place: [0, 0, 0, 0, 0, 0], turn: { angle: 14, time: 3 } },
    { kind: 'component', source: 'chassis', file: 'xwing_engine_pos_s01.glb', parent: 0, hardpoint: 'engine_pos1', place: null, slot: 'engine' },
    { kind: 'component', source: 'chassis', file: 'xwing_engine_neg_s01.glb', parent: 1, hardpoint: 'engine_neg1', place: null, slot: 'engine' },
    { kind: 'component', source: 'chassis', file: 'xwing_booster_pos_s01.glb', parent: 0, hardpoint: 'booster_pos1', place: null, slot: 'booster' },
    { kind: 'engine', source: 'ONOF', file: 'xwing_booster_pos_s01_on.glb', parent: 4, hardpoint: 'booster_on1', place: null, on: 'booster', owner: 4 },
    { kind: 'component', source: 'chassis', file: 'xwing_booster_neg_s01.glb', parent: 1, hardpoint: 'booster_neg1', place: null, slot: 'booster' },
    { kind: 'engine', source: 'ONOF', file: 'xwing_booster_neg_s01_on.glb', parent: 6, hardpoint: 'booster_on1', place: null, on: 'booster', owner: 6 },
    { kind: 'component', source: 'chassis', file: 'xwing_weapon1_pos_s01.glb', parent: 0, hardpoint: 'weapon1_pos1', place: null, slot: 'weapon_0' },
    { kind: 'component', source: 'chassis', file: 'xwing_weapon1_neg_s01.glb', parent: 1, hardpoint: 'weapon1_neg1', place: null, slot: 'weapon_1' },
    { kind: 'component', source: 'chassis', file: 'xwing_weapon2_pos_s01.glb', parent: 0, hardpoint: 'weapon2_pos1', place: null, slot: 'weapon_2' },
    { kind: 'component', source: 'chassis', file: 'xwing_weapon2_neg_s01.glb', parent: 1, hardpoint: 'weapon2_neg1', place: null, slot: 'weapon_2' },
  ];
  // The X-wing's stock looks, one per slot, as the fit lists them: the same parts the tree's components were.
  const look = (...parts: [string, string, AttachmentDef[]?][]) => ({ parts: parts.map(([file, hardpoint, children]) => ({ file, hardpoint, template: '', ...(children ? { children } : {}) })), components: [0] });
  const onChild = (file: string): AttachmentDef[] => [{ kind: 'engine', file, parent: null, hardpoint: 'booster_on1', place: null, on: 'booster' }];
  const fitDef: FitDef = {
    chassis: 'player_xwing',
    droid: 'astromech',
    paint: null,
    slots: [
      { slot: 'engine', compat: ['eng_0'], stock: 'e', looks: [look(['xwing_engine_pos_s01.glb', 'engine_pos1'], ['xwing_engine_neg_s01.glb', 'engine_neg1'])] },
      { slot: 'booster', compat: ['bst_0'], stock: 'b', looks: [look(['xwing_booster_pos_s01.glb', 'booster_pos1', onChild('xwing_booster_pos_s01_on.glb')], ['xwing_booster_neg_s01.glb', 'booster_neg1', onChild('xwing_booster_neg_s01_on.glb')])] },
      { slot: 'weapon_0', compat: ['wpn_0'], stock: 'w', looks: [look(['xwing_weapon1_pos_s01.glb', 'weapon1_pos1'])] },
      { slot: 'weapon_1', compat: ['wpn_0'], stock: 'w', looks: [look(['xwing_weapon1_neg_s01.glb', 'weapon1_neg1'])] },
      { slot: 'weapon_2', compat: ['wpn_0'], stock: 'w', looks: [look(['xwing_weapon2_pos_s01.glb', 'weapon2_pos1'], ['xwing_weapon2_neg_s01.glb', 'weapon2_neg1'])] },
    ],
  };
  const stock: ResolvedFit = { components: { engine: 'e', booster: 'b', weapon_0: 'w', weapon_1: 'w', weapon_2: 'w' }, looks: { engine: 0, booster: 0, weapon_0: 0, weapon_1: 0, weapon_2: 0 }, paint: {}, painted: false, droid: null, notes: [] };
  const placed = partsOf(fitDef, 'xwing', stock, []);
  const t = fitTree(xwing, placed.map((p) => p.slot));
  ok(t.main.length === 2 && t.main.every((d) => d.kind === 'wing') && t.dropped.filter(Boolean).length === 10 && t.retry.length === 0 && t.standIns.length === 0, `the X-wing keeps its 2 wings and drops its 8 stock components and the 2 "on" parts they produced (kept ${t.main.length}, dropped ${t.dropped.filter(Boolean).length}, retried ${t.retry.length})`);
  ok(placed.length === 8 && placed.filter((p) => p.children?.length).length === 2, `its stock fit hangs 8 part roots in their place, the boosters each with their "on" part (${placed.length})`);
  ok(placed.every((p) => splitPartChildren(p.children ?? []).byName.length === 0), "the boosters' \"on\" parts are carried by the boosters (none by name)");
  const yt: AttachmentDef[] = [
    { kind: 'carrier', source: 'HOBJ', file: 'yt1300_radar_s01.glb', parent: null, hardpoint: 'radar1', place: null },
    { kind: 'carrier', source: 'CHLD', file: 'yt1300_engine_none.glb', parent: null, hardpoint: null, place: [0, 0, 0, 0, 0, 0], standInFor: 'engine' },
    { kind: 'component', source: 'chassis', file: 'yt1300_engine_s01.glb', parent: null, hardpoint: 'engine1', place: null, slot: 'engine' },
    { kind: 'engine', source: 'ONOF', file: 'yt1300_engine_s01_on.glb', parent: 2, hardpoint: 'engine_on1', place: null, on: 'engine', owner: 2 },
    { kind: 'component', source: 'chassis', file: 'yt1300_booster_s01.glb', parent: null, hardpoint: 'booster1', place: null, slot: 'booster' },
    { kind: 'engine', source: 'ONOF', file: 'yt1300_booster_s01_on.glb', parent: 4, hardpoint: 'booster_on1', place: null, on: 'booster', owner: 4 },
    { kind: 'component', source: 'chassis', file: 'yt1300_turret_base.glb', parent: null, hardpoint: 'turretyaw1', place: null, slot: 'weapon_0' },
    { kind: 'carrier', source: 'IHOB', file: 'yt1300_turret_body_s01.glb', parent: 6, hardpoint: 'turretpitch1', place: null, owner: 6 },
    { kind: 'carrier', source: 'IHOB', file: 'yt1300_turret_barrel_s01.glb', parent: 7, hardpoint: 'turretbarrel1', place: null, owner: 6 },
    { kind: 'carrier', source: 'IHOB', file: 'yt1300_turret_barrel_s01.glb', parent: 7, hardpoint: 'turretbarrel2', place: null, owner: 6 },
    { kind: 'component', source: 'chassis', file: 'yt1300_turret_base.glb', parent: null, hardpoint: 'turretyaw2', place: null, slot: 'weapon_1' },
    { kind: 'carrier', source: 'IHOB', file: 'yt1300_turret_body_s01.glb', parent: 10, hardpoint: 'turretpitch1', place: null, owner: 10 },
    { kind: 'carrier', source: 'IHOB', file: 'yt1300_turret_barrel_s01.glb', parent: 11, hardpoint: 'turretbarrel1', place: null, owner: 10 },
    { kind: 'carrier', source: 'IHOB', file: 'yt1300_turret_barrel_s01.glb', parent: 11, hardpoint: 'turretbarrel2', place: null, owner: 10 },
  ];
  const full = fitTree(yt, ['engine', 'booster', 'weapon_0', 'weapon_1']);
  ok(full.main.length === 1 && full.main[0].file === 'yt1300_radar_s01.glb' && full.dropped.filter(Boolean).length === 13 && full.retry.length === 0, 'the YT-1300 with every slot filled keeps its radar only: its turrets, engine, booster and their "on" parts come from the fit');
  ok(full.standIns.length === 1 && full.standIns[0] === 1 && full.dropped[1], 'its empty-engine stand-in is dropped while the engine is filled, and recorded for a refit');
  const empty = fitTree(yt, ['booster', 'weapon_0', 'weapon_1']);
  ok(empty.main.map((d) => d.file).join() === 'yt1300_radar_s01.glb,yt1300_engine_none.glb' && !empty.dropped[1] && empty.standIns[0] === 1, 'with the engine left empty the stand-in stays in the tree');
  const orphan = fitTree([{ kind: 'component', file: 'c.glb', parent: null, hardpoint: 'x', place: null, slot: 'engine' }, { kind: 'carrier', file: 'rides.glb', parent: 0, hardpoint: 'y', place: null }, { kind: 'carrier', file: 'deeper.glb', parent: 1, hardpoint: 'z', place: null }], ['engine']);
  ok(orphan.retry.length === 2 && orphan.retry[0].parent === undefined && orphan.retry[1].parent === 0 && orphan.main.length === 0, 'a def the tree hung on a dropped component is retried by name, its own children re-indexed under it');
}

// --- 7: a part's children split --------------------------------------------------------------------------
{
  const kids: AttachmentDef[] = [
    { kind: 'carrier', file: 'body.glb', parent: null, hardpoint: 'turret1', place: null },
    { kind: 'carrier', file: 'barrel.glb', parent: 0, hardpoint: 'barrel1', place: null },
    { kind: 'engine', file: 'on.glb', hardpoint: 'engine1', place: null, on: 'engine' },
    { kind: 'carrier', file: 'dish.glb', parent: 2, hardpoint: 'dish1', place: null },
    { kind: 'carrier', file: 'dish2.glb', parent: 3, hardpoint: null, place: [0, 1, 0, 0, 0, 0] },
    { kind: 'carrier', file: 'broken.glb', parent: 9, hardpoint: 'x', place: null },
  ];
  const s = splitPartChildren(kids);
  ok(s.local.map((d) => `${d.file}:${d.parent}`).join() === 'body.glb:null,barrel.glb:0', 'the children the part carries, re-indexed');
  ok(s.byName.length === 1 && s.byName[0].root.file === 'on.glb' && !('parent' in s.byName[0].root && s.byName[0].root.parent !== undefined), 'a child with no parent is a by-name root');
  ok(s.byName[0].descendants.map((d) => `${d.file}:${d.parent}`).join() === 'dish.glb:null,dish2.glb:0', "its descendants come with it, re-indexed under it");
  ok(!s.local.some((d) => d.file === 'broken.glb') && !s.byName.some((b) => b.descendants.some((d) => d.file === 'broken.glb')), 'a broken chain is dropped');
}

console.log(`shipMounts: ${checks} checks passed`);
