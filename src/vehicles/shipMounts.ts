// The parts a fit hangs on a ship, by hardpoint name, and what follows from them: the guns (with the
// chassis slot each belongs to) and the engine spots, measured with the wings closed; the glows re-hung
// on new spots after a refit; and the refit's one synchronous swap. Built on shipAssembly.ts's helpers
// (hardpoint search, gun choice) and wings.ts. Plain three, no Rapier or DOM: `EngineTrail` is a type
// here only (trail.ts imports the portal renderer, which plain node cannot load), and the garage hands
// `rebindGlows` a `makeTrail`, so the node tests can load this module.
import * as THREE from 'three';
import type { EngineTrail } from './trail';
import { anyHardpoint, collectGuns, hardpointName, ownHardpoint, type AttachmentDef } from './shipAssembly.ts';
import { WingSet, poseWing, type Wing } from './wings.ts';
import { GUN_MOUNT, GUN_MUZZLE } from './cockpitSeat.ts';

/**
 * A part waiting to be hung: its top node (the part's model, or the mount group standing it at its place),
 * its chassis slot, the hardpoint it hangs at ('' = the model's origin), a label for the console, a
 * key (its file, and place) by which the same part on the same hardpoint is hung once, and whether it is
 * hung by name after the fitted parts (a part's child it does not carry, or the ship's own node that rode
 * a stock component).
 */
export interface PendingPart { node: THREE.Object3D; slot: string; hardpoint: string; label: string; key?: string; byName?: boolean }

/** Whether a chassis slot fills what a stand-in stands for (`engine` fills `engine`; `weapon_0` fills `weapon`). */
function slotFills(slot: string, standsFor: string): boolean {
  return slot === standsFor || slot.startsWith(`${standsFor}_`);
}

/** The node carrying a hardpoint: the hull's own first, else the first found anywhere on the ship (a wing, a part hung before). */
function carrierOf(model: THREE.Object3D, name: string): THREE.Object3D | null {
  return ownHardpoint(model, name) ?? anyHardpoint(model, name);
}

/** Whether a node is anything hung (a part, a mount, a fitted node) rather than the hardpoint's own. */
function isHung(o: THREE.Object3D): boolean {
  const u = o.userData;
  return u.attachment !== undefined || u.mountOf !== undefined || u.fitPending !== undefined;
}

/** A hardpoint's `mountUsed` mark, after a part left it: still used while anything else hangs there. */
function refreshMountUsed(anchor: THREE.Object3D | null): void {
  if (!anchor || hardpointName(anchor) === null) return;
  anchor.userData.mountUsed = anchor.children.some(isHung);
}

/**
 * Hang parts in dependency order: repeat passes until one hangs nothing. A part with hardpoint '' is added
 * to `model` as it stands (a fitted part at identity); otherwise the node carrying that hardpoint (the
 * hull's own first, then anywhere on the ship, parts hung in earlier passes included; never inside the part
 * itself, which is not on the ship yet) gets `node.add(part)`, so the part rides whatever carries the
 * hardpoint (a wing, an engine part, a carrier). The same key on the same anchor hangs once: the later
 * slot joins the kept part's `sharedWith` (and `fitSlots`), and the pending node is marked `sharedInto`.
 * The parts hung by name (`byName`) wait until every other part is on (passes over the rest first), then
 * go over the whole ship with whatever of the rest still waits.
 * Marks each hung node `fitPending` (its PendingPart) and `fitSlots`, and the anchor `mountUsed`.
 * Returns the parts nothing carries (left off the model, never dropped at the origin).
 */
export function hangParts(model: THREE.Object3D, pending: PendingPart[]): PendingPart[] {
  const later = pending.filter((p) => p.byName);
  if (!later.length) return hangPasses(model, pending);
  const left = hangPasses(model, pending.filter((p) => !p.byName));
  return hangPasses(model, [...later, ...left]);
}

/** hangParts' passes over one list: repeated until a pass hangs nothing. */
function hangPasses(model: THREE.Object3D, pending: PendingPart[]): PendingPart[] {
  let left = [...pending];
  if (!left.length) return left;
  for (;;) {
    const next: PendingPart[] = [];
    let hung = false;
    for (const p of left) {
      const anchor = p.hardpoint ? carrierOf(model, p.hardpoint) : model;
      if (!anchor) {
        next.push(p);
        continue;
      }
      const same = p.key ? anchor.children.find((c) => c !== p.node && (c.userData.fitPending as PendingPart | undefined)?.key === p.key) : undefined;
      if (same) {
        const slots: string[] = same.userData.fitSlots ?? (same.userData.fitSlots = [same.userData.slot ?? p.slot]);
        if (!slots.includes(p.slot)) {
          slots.push(p.slot);
          const shared: string[] = same.userData.sharedWith ?? (same.userData.sharedWith = []);
          if (!shared.includes(p.slot)) shared.push(p.slot);
        }
        p.node.userData.sharedInto = same;
        hung = true;
        continue;
      }
      anchor.add(p.node);
      p.node.userData.fitPending = p;
      // A node hung again (its carrier went) keeps the slots it already showed.
      if (!Array.isArray(p.node.userData.fitSlots)) p.node.userData.fitSlots = [p.slot];
      delete p.node.userData.sharedInto;
      if (anchor !== model && hardpointName(anchor) !== null) anchor.userData.mountUsed = true;
      hung = true;
    }
    left = next;
    if (!hung || !left.length) return left;
  }
}

/**
 * A part's own children (converted by the part's client data, parents relative to the part: null is the
 * part) split two ways: the local ones, whose chain ends at the part (hung on it with hangAttachments,
 * parents re-indexed), and each by-name root (no parent: a hardpoint the part does not carry, looked for
 * over the whole ship after the other parts) with its own descendants (parents re-indexed, the root being
 * null). A child whose chain is broken (a parent that is not earlier) is dropped.
 */
export function splitPartChildren(children: readonly AttachmentDef[]): { local: AttachmentDef[]; byName: { root: AttachmentDef; descendants: AttachmentDef[] }[] } {
  // -2: broken; -1: ends at the part; else the index of its by-name root.
  const rootOf = children.map(() => -2);
  for (let i = 0; i < children.length; i++) {
    const p = children[i].parent;
    if (p === undefined) rootOf[i] = i;
    else if (p === null) rootOf[i] = -1;
    else if (typeof p === 'number' && p >= 0 && p < i) rootOf[i] = rootOf[p];
  }
  const local: AttachmentDef[] = [];
  const localIdx = new Map<number, number>();
  children.forEach((d, i) => {
    if (rootOf[i] !== -1) return;
    localIdx.set(i, local.length);
    local.push({ ...d, parent: d.parent === null || d.parent === undefined ? null : localIdx.get(d.parent)! });
  });
  const byName: { root: AttachmentDef; descendants: AttachmentDef[] }[] = [];
  children.forEach((d, i) => {
    if (rootOf[i] !== i) return;
    const descendants: AttachmentDef[] = [];
    const idx = new Map<number, number>();
    for (let k = i + 1; k < children.length; k++) {
      if (rootOf[k] !== i) continue;
      const p = children[k].parent as number;
      idx.set(k, descendants.length);
      descendants.push({ ...children[k], parent: p === i ? null : idx.get(p)! });
    }
    byName.push({ root: { ...d }, descendants });
  });
  return { local, byName };
}

const TIER_GLOW = /engine_glow/i;
const TIER_EXHAUST = /exhaust|thrust/i;
const TIER_ENGINE = /^engine\d*$|(^|[_:])eng\d/i;

/** Every hardpoint under a root in traverse order (node, then its children), leaving out a cockpit frame. */
function visitHardpoints(root: THREE.Object3D, each: (o: THREE.Object3D, name: string) => void): void {
  const visit = (o: THREE.Object3D) => {
    const name = hardpointName(o);
    if (name !== null) each(o, name);
    for (const c of o.children) if (c.userData.cockpit !== true) visit(c);
  };
  visit(root);
}

/**
 * Where the engines glow, by what the hardpoints are called, best first: the engine parts' own glow points,
 * the client data's thruster points, any exhaust, any numbered engine; with none of them, the glow spots
 * the garage stood at the rear of the box (`userData.glowSpot`). The same list, in the same order, the
 * spawn's hardpoint traverse makes, so a refit re-hangs the glows as a spawn would.
 */
export function engineSpotsOf(model: THREE.Object3D, thrusters: readonly string[]): THREE.Object3D[] {
  const glow: THREE.Object3D[] = [];
  const thruster: THREE.Object3D[] = [];
  const exhaust: THREE.Object3D[] = [];
  const engine: THREE.Object3D[] = [];
  visitHardpoints(model, (o, name) => {
    if (TIER_GLOW.test(name)) glow.push(o);
    else if (thrusters.includes(name)) thruster.push(o);
    else if (TIER_EXHAUST.test(name)) exhaust.push(o);
    else if (TIER_ENGINE.test(name)) engine.push(o);
  });
  const found = glow.length ? glow : thruster.length ? thruster : exhaust.length ? exhaust : engine;
  if (found.length) return found;
  const rear: THREE.Object3D[] = [];
  model.traverse((o) => {
    if (o.userData.glowSpot === true) rear.push(o);
  });
  return rear;
}

/** How many hardpoints under a root could be an engine spot in any tier: the most glows a model can need. */
export function countSpotHardpoints(root: THREE.Object3D, thrusters: readonly string[]): number {
  let n = 0;
  visitHardpoints(root, (_o, name) => {
    if (TIER_GLOW.test(name) || thrusters.includes(name) || TIER_EXHAUST.test(name) || TIER_ENGINE.test(name)) n++;
  });
  return n;
}

/** The chassis slot a gun belongs to: the nearest `slot` on itself or an ancestor below the model; for a mount hardpoint, the slot of the part hung directly under it. */
function slotOfGun(node: THREE.Object3D, model: THREE.Object3D): string | null {
  for (let n: THREE.Object3D | null = node; n && n !== model; n = n.parent) if (typeof n.userData.slot === 'string') return n.userData.slot as string;
  for (const c of node.children) {
    if (typeof c.userData.slot === 'string') return c.userData.slot as string;
    if (c.userData.mountOf !== undefined) for (const cc of c.children) if (typeof cc.userData.slot === 'string') return cc.userData.slot as string;
  }
  return null;
}

/** A gun as measured: where it fires from and which way in the frame's space (wings closed), its node, its slot, its part's hardpoint, and whether it is a turret's. */
export interface MountGun { pos: THREE.Vector3; dir: THREE.Vector3; node: THREE.Object3D; slot: string | null; hardpoint?: string; turret?: boolean }
export interface Mounts {
  guns: MountGun[];
  spots: THREE.Object3D[];
}

const frameInv = new THREE.Matrix4();
const frameTurn = new THREE.Quaternion();
const nodeTurn = new THREE.Quaternion();

/**
 * The guns and engine spots of a model hung under `frame` (the vehicle's group; the model itself before it
 * has one). `pos`/`dir` are in `frame`'s space, whatever `frame`'s own turn: pos = p_world · inverse(frame's
 * world matrix), dir = inverse(frame's world quaternion) · q_world · +Z. They are measured with every wing
 * closed (each wing's share open is kept, the wing posed shut, measured, and posed back), so a refit made
 * in flight does not freeze open-wing places. The guns are shipAssembly's `collectGuns` (muzzles over mounts,
 * the turret rule, 16 at most), each with its slot (`slotOfGun`). The spots are `engineSpotsOf`.
 */
export function collectMounts(model: THREE.Object3D, frame: THREE.Object3D, thrusters: readonly string[], wings: WingSet | readonly Wing[]): Mounts {
  const list: readonly Wing[] = wings instanceof WingSet ? wings.list : wings;
  const kept = list.map((w) => w.open);
  for (const w of list) poseWing(w, 0);
  frame.updateMatrixWorld(true);
  model.updateMatrixWorld(true);
  frameInv.copy(frame.matrixWorld).invert();
  frame.getWorldQuaternion(frameTurn).invert();
  const guns = collectGuns(model, (n) => GUN_MUZZLE.test(n), (n) => GUN_MOUNT.test(n)).map((g): MountGun => {
    const pos = g.node.getWorldPosition(new THREE.Vector3()).applyMatrix4(frameInv);
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(nodeTurn.copy(frameTurn).multiply(g.node.getWorldQuaternion(new THREE.Quaternion()))).normalize();
    return { pos, dir, node: g.node, slot: slotOfGun(g.node, model), hardpoint: g.hardpoint, turret: g.turret };
  });
  const spots = engineSpotsOf(model, thrusters);
  list.forEach((w, i) => poseWing(w, kept[i]));
  frame.updateMatrixWorld(true);
  return { guns, spots };
}

/** What a glow can be re-hung on: the vehicle's glow state (the sprites, their material, size and colour, the heat haze's list, the live trails). */
export interface GlowHost {
  readonly group: THREE.Group;
  glows: THREE.Sprite[];
  glowMaterial: THREE.SpriteMaterial | null;
  glowSize: number;
  glowColor: number;
  readonly engines: { object: THREE.Object3D; size: number; seed: number }[];
  trails: EngineTrail[];
}
/** Seconds a parked glow's trail is aged by, well past a trail's 0.9 s span, so every sample it held is dropped. */
export const TRAIL_FORGET = 10;

/** Sprites (and their trails, index for index) a refit made in its staging group, prepared with the new parts. */
export interface SpareGlows { sprites: THREE.Sprite[]; trails: EngineTrail[] }

/**
 * Put glow i under spot i at its origin; take the sprites beyond `glows.length` from `spare` first (a refit
 * makes these in its staging group, so they are prepared), else make them with `glowMaterial` and a trail
 * from `makeTrail` (null: no trail); park the surplus under `group`, invisible, `userData.parked`, their
 * trails hidden. Then rebuild `engines` in place (one entry per live sprite, seed (i·0.618034) mod 1, size
 * `glowSize`) and `trails` to the live sprites' trails. Every trail's ribbon is in the trails' holder (the
 * group's parent). No sprite is left under a node outside `group`. A sprite's trail is its `userData.trail`.
 */
export function rebindGlows(host: GlowHost, spots: THREE.Object3D[], makeTrail: ((sprite: THREE.Sprite) => EngineTrail) | null, spare?: SpareGlows): void {
  const holder = host.group.parent ?? host.group;
  const pool = [...host.glows];
  if (spare) {
    spare.sprites.forEach((sp, i) => {
      const t = spare.trails[i];
      if (t) sp.userData.trail = t;
      if (!pool.includes(sp)) pool.push(sp);
    });
  }
  while (pool.length < spots.length && host.glowMaterial) {
    const sp = new THREE.Sprite(host.glowMaterial);
    sp.scale.setScalar(0.2);
    const t = makeTrail?.(sp);
    if (t) sp.userData.trail = t;
    pool.push(sp);
  }
  host.engines.length = 0;
  host.trails.length = 0;
  pool.forEach((sp, i) => {
    const t = sp.userData.trail as EngineTrail | undefined;
    if (t && t.mesh.parent !== holder) holder.add(t.mesh);
    sp.position.set(0, 0, 0);
    if (i < spots.length) {
      spots[i].add(sp);
      sp.visible = true;
      delete sp.userData.parked;
      host.engines.push({ object: sp, size: host.glowSize, seed: (i * 0.618034) % 1 });
      if (t) host.trails.push(t);
    } else {
      host.group.add(sp);
      sp.visible = false;
      sp.userData.parked = true;
      if (t) {
        // Aged past its span (0.9 s): a glow brought back later starts a fresh ribbon, never one from where it was parked.
        t.update(TRAIL_FORGET, 0, host.glowSize);
        t.mesh.visible = false;
      }
    }
  });
  host.glows = pool;
}

/**
 * An empty slot's stand-in (the YT-1300's `yt1300_engine_none`), kept with the build so that a refit takes it
 * down when its slot fills and hangs it again when the slot empties, as a spawn would have decided.
 */
export interface StandIn {
  /** The slot it stands for (`engine`; `weapon` stands for every `weapon_N`). */
  standsFor: string;
  /** Its def as the manifest has it (its file, its hardpoint on the hull or anywhere, its place). */
  def: AttachmentDef;
  label: string;
  /** Its top node (the mount standing it at its place, else the part), loaded; null until something needs it. */
  node: THREE.Object3D | null;
  /** Whether that node's materials have been prepared (hung at spawn, or staged by a refit). */
  ready: boolean;
}

/** A ship's model and the fitted parts hung on it: the top nodes per slot ('' for the ship's own nodes that hang on a part), what waits for a carrier, and the stand-ins of slots that can be emptied. */
export interface ShipBuild {
  root: THREE.Object3D;
  fitParts: Map<string, THREE.Object3D[]>;
  pending: PendingPart[];
  standIns?: StandIn[];
}

/** Whether a node still hangs on the model (the node itself or any ancestor is `root`). */
export function onModel(node: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = node; n; n = n.parent) if (n === root) return true;
  return false;
}

/**
 * What a fitted ship keeps of its manifest tree. Out: every stock component (`kind: 'component'`), every def a
 * stock component's own client data produced (`owner`), and the stand-in of a slot the fit fills. A def whose
 * chain reaches something left out cannot hang where the tree put it, so it goes to `retry` (its top one
 * with no parent, hung by name over the whole ship after the fit's parts; the rest re-indexed under it).
 * `main` keeps the tree's order with parents re-indexed; `mainIndex` and `retryIndex` map a def's index in
 * `defs` to its place in each list. `standIns` lists the index of every hull-level stand-in (parent null or
 * absent), kept or not, which the build records so a refit can decide it again.
 */
export interface FitTree {
  main: AttachmentDef[];
  mainIndex: Map<number, number>;
  retry: AttachmentDef[];
  retryIndex: Map<number, number>;
  dropped: boolean[];
  standIns: number[];
}
export function fitTree(defs: readonly AttachmentDef[], filled: Iterable<string>): FitTree {
  const slots = [...filled];
  const fills = (standsFor: string) => slots.some((s) => slotFills(s, standsFor));
  const dropped = defs.map((d) => d.kind === 'component' || d.owner !== undefined || (!!d.standInFor && fills(d.standInFor)));
  const main: AttachmentDef[] = [];
  const mainIndex = new Map<number, number>();
  const retry: AttachmentDef[] = [];
  const retryIndex = new Map<number, number>();
  defs.forEach((d, i) => {
    if (dropped[i]) return;
    const p = d.parent;
    if (p === undefined || p === null) {
      mainIndex.set(i, main.length);
      main.push(d);
    } else if (mainIndex.has(p)) {
      mainIndex.set(i, main.length);
      main.push({ ...d, parent: mainIndex.get(p)! });
    } else if (retryIndex.has(p)) {
      retryIndex.set(i, retry.length);
      retry.push({ ...d, parent: retryIndex.get(p)! });
    } else {
      retryIndex.set(i, retry.length);
      const byName: AttachmentDef = { ...d };
      delete byName.parent;
      retry.push(byName);
    }
  });
  const standIns: number[] = [];
  defs.forEach((d, i) => {
    if (d.standInFor && d.kind !== 'component' && d.owner === undefined && (d.parent === null || d.parent === undefined)) standIns.push(i);
  });
  return { main, mainIndex, retry, retryIndex, dropped, standIns };
}

/**
 * The stand-ins decided again from what hangs now: one whose slot has a part on the ship is taken down (kept,
 * for the next time the slot empties), and one whose slot has none is hung again where its def says (its
 * hardpoint, the hull's own first, else the model's origin at its place), if its node is loaded and prepared.
 * Returns what went up, what came down, and the stand-ins that should hang but cannot (not loaded or
 * prepared, or nothing carries their hardpoint).
 */
export function settleStandIns(build: ShipBuild): { up: THREE.Object3D[]; down: THREE.Object3D[]; missing: StandIn[] } {
  const up: THREE.Object3D[] = [];
  const down: THREE.Object3D[] = [];
  const missing: StandIn[] = [];
  for (const s of build.standIns ?? []) {
    let filled = false;
    for (const [slot, nodes] of build.fitParts) if (nodes.length && slotFills(slot, s.standsFor)) filled = true;
    const node = s.node;
    const on = !!node && onModel(node, build.root);
    if (filled) {
      if (node && on) {
        const anchor = node.parent;
        node.removeFromParent();
        refreshMountUsed(anchor);
        down.push(node);
      }
      continue;
    }
    if (on) continue;
    const anchor = s.def.hardpoint ? carrierOf(build.root, s.def.hardpoint) : build.root;
    if (!node || !s.ready || !anchor) {
      missing.push(s);
      continue;
    }
    anchor.add(node);
    if (anchor !== build.root && hardpointName(anchor) !== null) anchor.userData.mountUsed = true;
    up.push(node);
  }
  return { up, down, missing };
}

/** Record in `build.fitParts` every part of a list that hung: under each slot it shows (its own, or the part it was merged into under this one's). */
export function recordHung(build: ShipBuild, parts: readonly PendingPart[], waiting: readonly PendingPart[]): void {
  const left = new Set(waiting);
  for (const p of parts) {
    if (left.has(p)) continue;
    const merged = p.node.userData.sharedInto as THREE.Object3D | undefined;
    const node = merged ?? p.node;
    const slots: string[] = merged ? [p.slot] : Array.isArray(node.userData.fitSlots) ? node.userData.fitSlots : [p.slot];
    for (const s of slots) {
      const list = build.fitParts.get(s) ?? (build.fitParts.set(s, []).get(s) as THREE.Object3D[]);
      if (!list.includes(node)) list.push(node);
    }
  }
}

/**
 * One synchronous refit step: take down the parts of `slots` (a part another slot also shows stays, now
 * that slot's alone), and any fitted node whose parent chain ran through one of them, which is re-hung;
 * drop what those slots had waiting; hang `staged`, the re-hung ones and what the other slots had waiting
 * (hangParts), and record what hangs where; then the stand-ins are decided again (settleStandIns). Returns
 * the part roots taken down (for ShipPaint.untrack), what still waits, and what the stand-ins did.
 */
export function swapParts(build: ShipBuild, slots: string[], staged: PendingPart[]): SwapResult {
  const changing = new Set(slots);
  const removed: THREE.Object3D[] = [];
  for (const s of slots) {
    for (const node of build.fitParts.get(s) ?? []) {
      const owners: string[] = node.userData.fitSlots ?? [s];
      const keep = owners.filter((o) => !changing.has(o));
      if (keep.length) {
        // Shown by another slot too: it stays, that slot's.
        node.userData.fitSlots = keep;
        node.userData.slot = keep[0];
        const rest = keep.slice(1);
        if (rest.length) node.userData.sharedWith = rest;
        else delete node.userData.sharedWith;
        continue;
      }
      const anchor = node.parent;
      node.removeFromParent();
      refreshMountUsed(anchor);
      if (!removed.includes(node)) removed.push(node);
    }
    build.fitParts.delete(s);
  }
  // What hung on a part that went: taken off and hung again wherever its hardpoint is now.
  const rehang: PendingPart[] = [];
  const seen = new Set<THREE.Object3D>();
  for (const nodes of build.fitParts.values()) {
    for (const node of nodes) {
      if (seen.has(node) || removed.includes(node) || onModel(node, build.root)) continue;
      seen.add(node);
      const p = node.userData.fitPending as PendingPart | undefined;
      const anchor = node.parent;
      node.removeFromParent();
      refreshMountUsed(anchor);
      if (p) rehang.push(p);
    }
  }
  for (const [s, nodes] of build.fitParts) {
    const still = nodes.filter((n) => onModel(n, build.root));
    if (still.length) build.fitParts.set(s, still);
    else build.fitParts.delete(s);
  }
  // What those slots had waiting goes too (the page's paint forgets it with the rest).
  for (const p of build.pending) if (changing.has(p.slot) && !removed.includes(p.node)) removed.push(p.node);
  const before = build.pending.filter((p) => !changing.has(p.slot));
  const all = [...staged, ...rehang, ...before];
  const waiting = hangParts(build.root, all);
  recordHung(build, all, waiting);
  build.pending = waiting;
  return { removed, waiting, standIns: settleStandIns(build) };
}

/** What a swap did: the part roots taken down, what still waits for a carrier, and the stand-ins hung, taken down or missing. */
export interface SwapResult {
  removed: THREE.Object3D[];
  waiting: PendingPart[];
  standIns?: { up: THREE.Object3D[]; down: THREE.Object3D[]; missing: StandIn[] };
}

/** What staging a refit may be given: the paint's tracking, the preparation, extra things for the group, and a wait after the prepare (the paint's). */
export interface StageHooks {
  track?: (part: THREE.Object3D) => void;
  untrack?: (part: THREE.Object3D) => void;
  prepare: (roots: THREE.Object3D[]) => Promise<void>;
  /** Called with the staging group and the parts before the prepare; returns more roots to prepare (spare trails' ribbons). */
  extra?: (group: THREE.Group, parts: PendingPart[]) => THREE.Object3D[];
  /** Awaited after the prepare, before the swap is handed back (the paint applied, or its renders waited for). */
  after?: () => Promise<void>;
}

/** Every material the meshes under a root wear now. */
function wornMaterials(root: THREE.Object3D): Set<THREE.Material> {
  const out = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = (o as THREE.Mesh).isMesh ? (o as THREE.Mesh).material : null;
    if (!m) return;
    for (const x of Array.isArray(m) ? m : [m]) if (x) out.add(x);
  });
  return out;
}

/**
 * The staging half of a refit: the new parts into a detached group (nothing in the scene changes), with any
 * stand-in the build has loaded but never prepared (the garage loads one when a slot it stands for changes),
 * and `extra` given the group. Everything is prepared first in its own materials, which are what a part wears
 * whenever the paint is stock or goes back to it; then each part is tracked by the paint, which while it is
 * custom (or showing its static view) puts the ship's copies on them, and when that changed any material the
 * group is prepared again, so the copies compile too. Then `after` is awaited. Returns the group and
 * `commit`, the one synchronous step: the parts and stand-ins out of the group, `swapParts`, `untrack` on
 * everything taken down, and on any staged part merged into an identical one already hung (never on the
 * ship, so the paint must not keep it).
 */
export async function stageRefit(build: ShipBuild, slots: string[], parts: PendingPart[], hooks: StageHooks): Promise<{ group: THREE.Group; commit: () => SwapResult }> {
  const group = new THREE.Group();
  const standIns = (build.standIns ?? []).filter((s) => !!s.node && !s.ready && !onModel(s.node, build.root));
  for (const p of parts) group.add(p.node);
  for (const s of standIns) group.add(s.node!);
  const more = hooks.extra?.(group, parts) ?? [];
  await hooks.prepare([group, ...more]);
  if (hooks.track) {
    const before = wornMaterials(group);
    for (const p of parts) hooks.track(p.node);
    for (const s of standIns) hooks.track(s.node!);
    let changed = false;
    for (const m of wornMaterials(group)) if (!before.has(m)) changed = true;
    if (changed) await hooks.prepare([group]);
  }
  for (const s of standIns) s.ready = true;
  await hooks.after?.();
  return {
    group,
    commit: () => {
      for (const p of parts) p.node.removeFromParent();
      for (const s of standIns) if (s.node && s.node.parent === group) s.node.removeFromParent();
      const r = swapParts(build, slots, parts);
      for (const n of r.removed) hooks.untrack?.(n);
      for (const p of parts) if (p.node.userData.sharedInto && !r.removed.includes(p.node)) hooks.untrack?.(p.node);
      return r;
    },
  };
}

/**
 * Run `work` once every earlier one queued under the same key has settled (a failed one included), so two
 * refits of one ship never overlap and each starts from what the last one left. The promise is `work`'s own.
 */
export function inTurn<K extends object, T>(turns: WeakMap<K, Promise<unknown>>, key: K, work: () => Promise<T>): Promise<T> {
  const before = turns.get(key) ?? Promise.resolve();
  const run = before.catch(() => {}).then(work);
  turns.set(key, run);
  void run
    .catch(() => {})
    .finally(() => {
      if (turns.get(key) === run) turns.delete(key);
    });
  return run;
}

/** Take out of a wing set every wing whose pivot hangs under one of `roots` (parts taken down): nothing on the ship turns with it any more. Returns how many went. */
export function dropWingsUnder(wings: WingSet, roots: readonly THREE.Object3D[]): number {
  let n = 0;
  for (let i = wings.list.length - 1; i >= 0; i--) {
    const pivot = wings.list[i].pivot;
    if (roots.some((r) => onModel(pivot, r))) {
      wings.list.splice(i, 1);
      n++;
    }
  }
  return n;
}

/**
 * A refit's swap on a ship with glows, in one synchronous step: every glow sprite to the host's group (so
 * none is under a part about to go), `commit` (the staged swap), the guns and spots measured again on the
 * model (wings closed), and the glows re-hung on the spots now there. Returns what the commit returned and
 * the mounts.
 */
export function refitSwap(host: GlowHost, commit: () => SwapResult, model: THREE.Object3D, thrusters: readonly string[], wings: WingSet | readonly Wing[], makeTrail: ((sprite: THREE.Sprite) => EngineTrail) | null, spare?: SpareGlows): SwapResult & { mounts: Mounts } {
  for (const g of host.glows) host.group.add(g);
  const r = commit();
  const mounts = collectMounts(model, host.group, thrusters, wings);
  rebindGlows(host, mounts.spots, makeTrail, spare);
  return { ...r, mounts };
}
