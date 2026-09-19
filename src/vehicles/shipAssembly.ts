// What hangs on a ship, and how: the converter writes every part as a tree (the part it hangs on,
// the hardpoint there, where it stands), and this hangs each one under the node it names, a wing
// under a pivot group turned about its own Z, so whatever rides a wing (engines, guns, glows,
// nested foils) follows it with nothing copied. Also the box a ship is framed on, how far its open
// wings reach below it, and which muzzles are its guns. Plain three and ./wings.ts, no Rapier or
// DOM, so the node tests can load it.
import * as THREE from 'three';
import { WingSet, type Wing } from './wings.ts';

/** One thing a ship's manifest hangs on it (the converter's ships command writes these). */
export interface AttachmentDef {
  kind: 'wing' | 'carrier' | 'engine' | 'component';
  /** The part's model in the ships pack (the garage prefixes the pack's path). */
  file: string;
  /**
   * Index into this ship's attachments of the part it hangs on; null: the hull. Undefined: a def
   * converted before (or the converter's by-name fallback), hung by its hardpoint's name anywhere on
   * the model. Decided per def, so a list can mix both.
   */
  parent?: number | null;
  /** The hardpoint on the parent it hangs at; null: the parent's origin (at `place`, when given). */
  hardpoint?: string | null;
  /** Where it stands in its parent's frame, the client's own numbers: x, y, z, yaw, pitch, roll (degrees). */
  place?: number[] | null;
  /** A wing: the angle it turns by about its own Z when opening (degrees) and the seconds it takes. */
  turn?: { angle: number; time: number } | null;
  /** An ONOF appearance: shown while the drive runs, or only while boosting. */
  on?: 'engine' | 'booster';
  /** A stock part's chassis slot (weapon_0, engine, booster). */
  slot?: string;
  /** Other slots whose identical part this one stands for: their guns map here. */
  sharedWith?: string[];
  source?: 'WING' | 'HOBJ' | 'IHOB' | 'CHL2' | 'CHLD' | 'ONOF' | 'chassis';
  template?: string;
  appearance?: string;
  /** A wing's opening sound, for when there is audio. */
  sound?: string | null;
  /** The index of the component whose own client data produced this node (at any depth); absent for the hull's and the wings' own. */
  owner?: number;
  /** An empty slot's stand-in (`yt1300_engine_none`): the slot it stands for. Not hung when a component fills that slot. */
  standInFor?: string;
  // A pack converted before: transform, hinge (a wing's PSOR), angle, time.
  transform?: number[] | null;
  hinge?: number[] | null;
  angle?: number;
  time?: number;
}

/** A hardpoint node's name without its hp: prefix, or null for any other node. */
export function hardpointName(o: THREE.Object3D): string | null {
  const name = ((o.userData as { name?: string }).name ?? o.name) || '';
  const m = /^hp[:_]?(.+)$/i.exec(name);
  return m ? m[1] : null;
}

/** Signs taking the client's yaw and roll into three's mirrored frame (the V-wing's yaw and the B-wing's roll are the only uses). */
export const PLACE_SIGN = { yaw: -1, roll: -1 };

const toRad = THREE.MathUtils.degToRad;
const placeEuler = new THREE.Euler();

/**
 * Stand `o` at a place [x, y, z, a3, a4, a5] (degrees), mirrored as the converter mirrors X: position (-x, y, z) and
 * Euler(a4, sign·a3, sign·a5, 'YXZ'): index 3 turns about Y (yaw), 4 about X (pitch), 5 about Z (roll).
 */
export function applyPlace(o: THREE.Object3D, place: readonly number[]): void {
  o.position.set(0 - (place[0] ?? 0), place[1] ?? 0, place[2] ?? 0);
  placeEuler.set(toRad(place[4] ?? 0), PLACE_SIGN.yaw * toRad(place[3] ?? 0), PLACE_SIGN.roll * toRad(place[5] ?? 0), 'YXZ');
  o.quaternion.setFromEuler(placeEuler);
}

/** A node that belongs to something hung on a model, not to the model itself: a part, a mount, a wing pivot, the cockpit frame. */
function hungThere(o: THREE.Object3D): boolean {
  const u = o.userData;
  return u.attachment !== undefined || u.mountOf !== undefined || u.wingPivot === true || u.cockpit === true;
}

/** A hardpoint on one part's own model: never inside another part, a mount, a wing pivot or the cockpit frame hung on it. */
export function ownHardpoint(root: THREE.Object3D, name: string): THREE.Object3D | null {
  const want = name.toLowerCase();
  const visit = (o: THREE.Object3D): THREE.Object3D | null => {
    for (const c of o.children) {
      if (hungThere(c)) continue;
      if (hardpointName(c)?.toLowerCase() === want) return c;
      const found = visit(c);
      if (found) return found;
    }
    return null;
  };
  return visit(root);
}

/** Any hardpoint on the model and its parts, first found, skipping the cockpit frame (the legacy lookup). */
export function anyHardpoint(model: THREE.Object3D, name: string): THREE.Object3D | null {
  const want = name.toLowerCase();
  const visit = (o: THREE.Object3D): THREE.Object3D | null => {
    for (const c of o.children) {
      if (c.userData.cockpit === true) continue;
      if (hardpointName(c)?.toLowerCase() === want) return c;
      const found = visit(c);
      if (found) return found;
    }
    return null;
  };
  return visit(model);
}

/** The attachment root a node belongs to (the nearest ancestor, or the node, with userData.attachment below `model`), or null for the hull's own. */
export function partOf(o: THREE.Object3D, model: THREE.Object3D): THREE.Object3D | null {
  for (let n: THREE.Object3D | null = o; n && n !== model; n = n.parent) if (n.userData.attachment !== undefined) return n;
  return null;
}

/** Whether a node turns with a wing (an ancestor below `model`, or the node itself, is a wing pivot). */
export function underPivot(o: THREE.Object3D, model: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n && n !== model; n = n.parent) if (n.userData.wingPivot === true) return true;
  return false;
}

export interface Assembly {
  wings: WingSet;
  /** Per def, the part hung for it (a duplicate's is the part it merged into), or null when it was not hung. */
  parts: (THREE.Object3D | null)[];
  /** What could not be hung, and why, for the console. */
  unresolved: string[];
  /** How many parts were hung (duplicates and stand-ins not counted). */
  hung: number;
}

/** Whether a chassis slot fills what a stand-in stands for (`engine` fills `engine`; `weapon_0` fills `weapon`). */
function slotFills(slot: string, standsFor: string): boolean {
  return slot === standsFor || slot.startsWith(`${standsFor}_`);
}

const fileName = (file: string): string => file.replace(/^.*[\\/]/, '');

/**
 * Hang the attachments on the model, in order. A def with `parent` defined (a number or null) goes
 * under its anchor: its parent's hardpoint (ownHardpoint on the parent part, or on the hull for
 * null), else the parent's origin. With a place, a mount group (name `mount:<i>`,
 * userData.mountOf = i) stands at it; a wing adds a pivot group (name `wing:<i>`,
 * userData.wingPivot = true) turned about its own Z by -angle. The part's clone goes last.
 * A def with `parent` undefined (converted before, or the converter's by-name fallback) is hung by
 * name anywhere on the model (anyHardpoint, which also finds hardpoints on parts hung earlier in this
 * call), its `hinge` taken as its place and `angle`/`time` as its turn. Mixed lists work: each def
 * is decided on its own, and no def ever names a legacy def as its parent.
 * A stand-in (`standInFor`) is not hung when a component of its slot is hung: when one is listed, the stand-in is
 * decided after everything else, and hung then only if that component was left off.
 * Marks: part.userData.{ attachment: kind, attachmentIndex: i, hangsOn: hardpoint|null, on?, slot?, sharedWith? };
 * the anchor hardpoint node's userData.mountUsed = true. The same file twice on one anchor at one place hangs
 * once (the later def's slot joins the kept part's sharedWith). Nothing unresolved is ever put at the origin.
 */
export async function hangAttachments(model: THREE.Object3D, defs: readonly AttachmentDef[], load: (file: string) => Promise<THREE.Object3D>): Promise<Assembly> {
  const wings = new WingSet();
  const parts: (THREE.Object3D | null)[] = defs.map(() => null);
  const unresolved: string[] = [];
  let hung = 0;
  const listed = (standsFor: string) => defs.some((d) => d.kind === 'component' && !!d.slot && slotFills(d.slot, standsFor));
  const hungFor = (standsFor: string) => defs.some((d, j) => d.kind === 'component' && !!d.slot && slotFills(d.slot, standsFor) && parts[j] !== null);
  // A stand-in whose slot a component is listed for waits until the rest is hung, and is hung then only if no
  // component of that slot was (its model failed, or its hardpoint was missing). The converter never hangs anything on
  // such a stand-in, so nothing waits for it.
  const later = defs.map((d) => !!d.standInFor && listed(d.standInFor));
  // Every model asked for at once (the garage caches each file), then hung in order: a parent always comes before its children.
  type Loaded = { part?: THREE.Object3D; error?: unknown };
  const loadOf = (file: string): Promise<Loaded> =>
    load(file).then(
      (part): Loaded => ({ part }),
      (error: unknown): Loaded => ({ error }),
    );
  const loads: (Promise<Loaded> | null)[] = defs.map((d, i) => (later[i] ? null : loadOf(d.file)));
  // What already hangs on each anchor, by file and place, so a def repeated there hangs once.
  const onAnchor = new Map<THREE.Object3D, Map<string, THREE.Object3D>>();
  const order: number[] = [];
  for (let i = 0; i < defs.length; i++) if (!later[i]) order.push(i);
  for (let i = 0; i < defs.length; i++) if (later[i]) order.push(i);
  for (const i of order) {
    const def = defs[i];
    const label = `${def.slot ?? def.kind} ${fileName(def.file)}`;
    if (later[i] && hungFor(def.standInFor!)) continue;
    const legacy = def.parent === undefined;
    let anchor: THREE.Object3D | null;
    let place: readonly number[] | null;
    let turn: { angle: number; time: number } | null;
    /** A legacy def's `transform`, taken as a position in the hull's frame, as it always was. */
    let legacyAt: readonly number[] | null = null;
    if (!legacy) {
      const p = def.parent;
      const parentNode = p === null ? model : typeof p === 'number' && p >= 0 && p < i ? parts[p] : null;
      if (!parentNode) {
        unresolved.push(`${label}: the part it hangs on (#${p}) was not hung`);
        continue;
      }
      anchor = def.hardpoint ? ownHardpoint(parentNode, def.hardpoint) : parentNode;
      if (!anchor) {
        unresolved.push(`${label}: no hardpoint "${def.hardpoint}" on ${p === null ? 'the hull' : `#${p}`}`);
        continue;
      }
      place = def.place ?? null;
      turn = def.turn ?? null;
    } else {
      anchor = def.hardpoint ? anyHardpoint(model, def.hardpoint) : model;
      if (!anchor) {
        unresolved.push(`${label}: no hardpoint "${def.hardpoint}" anywhere on the ship`);
        continue;
      }
      place = def.place ?? (def.hinge && def.hinge.length >= 3 ? def.hinge : null);
      turn = def.turn ?? (def.angle ? { angle: def.angle, time: def.time ?? 3 } : null);
      if (!place && !def.hardpoint && def.transform && def.transform.length >= 3 && def.transform.slice(0, 3).some((n) => n !== 0)) legacyAt = def.transform;
    }
    const key = `${def.file}|${place ? place.join(',') : legacyAt ? `t${legacyAt.slice(0, 3).join(',')}` : ''}`;
    let here = onAnchor.get(anchor);
    const same = here?.get(key);
    if (same) {
      // Hung once: a later slot showing the same part on the same hardpoint is that part's too.
      parts[i] = same;
      if (def.slot && same.userData.slot !== def.slot) {
        const shared: string[] = same.userData.sharedWith ?? (same.userData.sharedWith = []);
        if (!shared.includes(def.slot)) shared.push(def.slot);
      }
      continue;
    }
    const got = await (loads[i] ?? loadOf(def.file));
    if (!got.part) {
      const err = got.error;
      unresolved.push(`${label}: did not load (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    const part = got.part;
    let host = anchor;
    if (place || legacyAt) {
      const mount = new THREE.Group();
      mount.name = `mount:${i}`;
      mount.userData.mountOf = i;
      if (place) applyPlace(mount, place);
      else if (legacyAt) mount.position.set(legacyAt[0], legacyAt[1], legacyAt[2]);
      host.add(mount);
      host = mount;
    }
    if (def.kind === 'wing' && turn && turn.angle) {
      const pivot = new THREE.Group();
      pivot.name = `wing:${i}`;
      pivot.userData.wingPivot = true;
      host.add(pivot);
      host = pivot;
      const w: Wing = { pivot, angle: -toRad(turn.angle), time: Number.isFinite(turn.time) && turn.time > 0 ? turn.time : 3, open: 0, label: fileName(def.file) };
      wings.add(w);
    }
    const u = part.userData;
    u.attachment = def.kind;
    u.attachmentIndex = i;
    u.hangsOn = def.hardpoint ?? null;
    if (def.on) u.on = def.on;
    if (def.slot) u.slot = def.slot;
    if (def.sharedWith?.length) u.sharedWith = [...def.sharedWith];
    if (anchor !== model && hardpointName(anchor) !== null) anchor.userData.mountUsed = true;
    host.add(part);
    parts[i] = part;
    hung++;
    if (!here) onAnchor.set(anchor, (here = new Map()));
    here.set(key, part);
  }
  return { wings, parts, unresolved, hung };
}

/** More parts than this and they are pictures only (no colliders, no shadows, culled one by one): only the Star Destroyer's 207 passes it; the next is the neutral gunship's 26. */
export const PART_LIMIT = 100;

const boxTmp = new THREE.Box3();
const matTmp = new THREE.Matrix4();
const invTmp = new THREE.Matrix4();
const vTmp = new THREE.Vector3();

/** The inverse of the frame `model` is measured in: its parent's world matrix, or identity with none. */
function parentFrameInverse(model: THREE.Object3D, out: THREE.Matrix4): THREE.Matrix4 {
  model.updateMatrixWorld(true);
  return model.parent ? out.copy(model.parent.matrixWorld).invert() : out.identity();
}

/** A mesh's box in the frame `toFrame` takes world space into (its geometry's box, or a skinned mesh's posed box, corners transformed). */
function meshBox(m: THREE.Mesh, toFrame: THREE.Matrix4, out: THREE.Box3): THREE.Box3 {
  const sk = m as THREE.SkinnedMesh;
  if (sk.isSkinnedMesh) {
    sk.computeBoundingBox();
    out.copy(sk.boundingBox!);
  } else {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    out.copy(m.geometry.boundingBox!);
  }
  return out.applyMatrix4(matTmp.multiplyMatrices(toFrame, m.matrixWorld));
}

/**
 * The box a vehicle is framed on, from the meshes `include` accepts (cell 0 of a portal hull, every mesh of another),
 * in the model's parent's frame. The centre across (x) is that of the meshes **not under a wing pivot** (every mesh
 * when none is), so a ship turns about its hull, not about a wing lying to one side; the centre along (z) is the whole
 * box's, as it always was (the X-wing's foils carry engines that reach behind the fuselage, and a hull-only z would move
 * its turn point 0.77 m forward and its length 1.5 m past the nose); the half-width and half-length are the farthest
 * closed-pose extent from that centre, so the bounds stay symmetric; y is the closed pose's whole height.
 * `reach` is half the larger of the real (unsymmetric) width and length: the ship's own size for the chase camera and
 * the boarding range. Null when nothing is included.
 */
export function frameExtents(model: THREE.Object3D, include: (o: THREE.Object3D) => boolean): { cx: number; cz: number; minY: number; h: number; halfW: number; halfL: number; reach: number } | null {
  const toFrame = parentFrameInverse(model, invTmp);
  const all = new THREE.Box3();
  const hull = new THREE.Box3();
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry || !include(o)) return;
    meshBox(m, toFrame, boxTmp);
    if (boxTmp.isEmpty()) return;
    all.union(boxTmp);
    if (!underPivot(o, model)) hull.union(boxTmp);
  });
  if (all.isEmpty()) return null;
  const centre = hull.isEmpty() ? all : hull;
  const cx = (centre.min.x + centre.max.x) / 2;
  const cz = (all.min.z + all.max.z) / 2;
  const halfW = Math.max(all.max.x - cx, cx - all.min.x);
  const halfL = Math.max(all.max.z - cz, cz - all.min.z);
  return { cx, cz, minY: all.min.y, h: all.max.y - all.min.y, halfW, halfL, reach: Math.max(all.max.x - all.min.x, all.max.z - all.min.z) / 2 };
}

/** The lowest vertex of the included meshes, in the model's parent's frame (Infinity when there is none). */
function lowestPoint(model: THREE.Object3D, include: (o: THREE.Object3D) => boolean): number {
  const toFrame = parentFrameInverse(model, invTmp);
  let low = Infinity;
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry || !include(o)) return;
    const pos = m.geometry.getAttribute('position');
    if (!pos) return;
    matTmp.multiplyMatrices(toFrame, m.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      m.getVertexPosition(i, vTmp).applyMatrix4(matTmp);
      if (vTmp.y < low) low = vTmp.y;
    }
  });
  return low;
}

/**
 * Metres the open wings reach below the closed pose's lowest point (0 when none): what the ground must leave under
 * the ship before they open. Measured on the real vertices of the meshes `include` accepts (every mesh by default; the
 * garage leaves out a portal hull's rooms), closed, then snapped open, then snapped closed again.
 */
export function wingDrop(model: THREE.Object3D, wings: WingSet, include: (o: THREE.Object3D) => boolean = () => true): number {
  if (!wings.length) return 0;
  const closed = lowestPoint(model, include);
  wings.snap(true);
  const open = lowestPoint(model, include);
  wings.snap(false);
  model.updateMatrixWorld(true);
  return Number.isFinite(closed) && Number.isFinite(open) ? Math.max(0, closed - open) : 0;
}

/** The most guns a pilot fires from: the forward-most, when a ship carries more (the Star Destroyer's turrets). */
export const MAX_PILOT_GUNS = 16;

/**
 * A ship's guns from its model: muzzle nodes (isMuzzle) that no part hangs on; turret muzzles only when there are no
 * others; with no muzzles at all, the mount hardpoints (isMount) with nothing hung on them, else those with a part hung
 * there. At most MAX_PILOT_GUNS, the forward-most. A muzzle is a turret one when any ancestor up to the model hangs on
 * a turret hardpoint; `hardpoint` is the nearest part's `hangsOn` (the part's mount: weapon1_pos1), else the node's own name.
 */
export function collectGuns(model: THREE.Object3D, isMuzzle: (name: string) => boolean, isMount: (name: string) => boolean): { node: THREE.Object3D; hardpoint: string; turret: boolean }[] {
  type Gun = { node: THREE.Object3D; hardpoint: string; turret: boolean; z: number };
  model.updateMatrixWorld(true);
  const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const muzzles: Gun[] = [];
  const turretMuzzles: Gun[] = [];
  const mounts: Gun[] = [];
  const usedMounts: Gun[] = [];
  const describe = (o: THREE.Object3D, name: string): Gun => {
    let turret = false;
    let hardpoint: string | null = null;
    let nearest = true;
    for (let n: THREE.Object3D | null = o.parent; n && n !== model; n = n.parent) {
      const on = n.userData.hangsOn as string | null | undefined;
      if (typeof on === 'string' && /turret/i.test(on)) turret = true;
      if (nearest && n.userData.attachment !== undefined) {
        nearest = false;
        if (typeof on === 'string') hardpoint = on;
      }
    }
    const z = vTmp.setFromMatrixPosition(o.matrixWorld).applyMatrix4(toModel).z;
    return { node: o, hardpoint: hardpoint ?? name, turret, z };
  };
  const visit = (o: THREE.Object3D) => {
    for (const c of o.children) {
      if (c.userData.cockpit === true) continue;
      const name = hardpointName(c);
      if (name !== null) {
        const used = c.userData.mountUsed === true;
        if (isMuzzle(name)) {
          if (!used) {
            const g = describe(c, name);
            (g.turret ? turretMuzzles : muzzles).push(g);
          }
        } else if (isMount(name)) (used ? usedMounts : mounts).push(describe(c, name));
      }
      visit(c);
    }
  };
  visit(model);
  let list = muzzles.length ? muzzles : turretMuzzles.length ? turretMuzzles : mounts.length ? mounts : usedMounts;
  if (list.length > MAX_PILOT_GUNS) {
    const keep = new Set([...list].sort((a, b) => b.z - a.z).slice(0, MAX_PILOT_GUNS));
    list = list.filter((g) => keep.has(g));
  }
  return list.map((g) => ({ node: g.node, hardpoint: g.hardpoint, turret: g.turret }));
}
