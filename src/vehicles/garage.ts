// The garage: every vehicle the gallery pack converted and every animal mount the creatures pack
// has, sorted into the four kinds by name, and spawned beside the player to ride.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Vehicle, specFor, vehicleKindOf, type VehicleKind, type VehicleSpec } from './vehicle';
import type { Physics } from '../core/physics';
import { ACTOR_LAYER } from '../world/portalRender';
import { cellIndexOf } from './interior';
import { EngineTrail } from './trail';

export interface VehicleDef {
  id: string;
  label: string;
  kind: VehicleKind;
  /** Whether the kind was read off the name; unknown names default to a speeder bike and are marked. */
  inferred: boolean;
  source: 'gallery' | 'creature' | 'ship';
  /** A ship's interior, when it has one: the model, and what the manifest says of its cells and bounds. */
  interior?: { file: string; cells: number; def: import('./interior').InteriorDef } | null;
  /** What the manifest says of the hull model's own cells, when it is a portal building (rooms, their lights). */
  cells?: NonNullable<import('./interior').InteriorDef['cells']>;
  /** What the ship's client data hangs on the hull: its wings, and an appearance shown while the drive runs. */
  attachments?: { kind: 'wing' | 'engine' | 'component'; slot?: string; file: string; hardpoint?: string | null; transform?: number[] | null }[];
  /** The cockpit frame drawn around the pilot, with the first-person view's offset from the cockpit point. */
  cockpit?: { file: string; zoom?: number[]; firstOffset?: number[]; thirdOffset?: number[] } | null;
  /** The hardpoints the client data puts thruster effects at. */
  thrusters?: string[];
  file: string;
  template?: string;
  bounds?: VehicleSpec['bounds'];
  /** A creature's locomotion clip speeds, for its mixer. */
  clipSpeeds?: Record<string, number>;
}

interface GalleryIndex {
  sections: { id: string; items: { label: string; template: string; model: string; radius: number; height?: number }[] }[];
}

/** A hardpoint node's name without its hp: prefix, or null for any other node. */
export function hardpointName(o: THREE.Object3D): string | null {
  const name = ((o.userData as { name?: string }).name ?? o.name) || '';
  const m = /^hp[:_]?(.+)$/i.exec(name);
  return m ? m[1] : null;
}

export class Garage {
  readonly vehicles: VehicleDef[] = [];
  private readonly loader = new GLTFLoader();
  private readonly models = new Map<string, Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>>();

  private constructor(private readonly baseUrl: string) {}

  /** Read the gallery's vehicles and the creatures' manifest; either may be missing. */
  static async load(baseUrl: string): Promise<Garage> {
    const g = new Garage(baseUrl);
    try {
      const [idx, man] = await Promise.all([fetch(`${baseUrl}assets-private/gallery/gallery.json`), fetch(`${baseUrl}assets-private/gallery/manifest.json`)]);
      if (idx.ok && man.ok) {
        const index = (await idx.json()) as GalleryIndex;
        const manifest = (await man.json()) as { categories: { layout: { id: string; file: string; bounds?: VehicleSpec['bounds'] }[] } };
        const files = new Map(manifest.categories.layout.map((m) => [m.id, m]));
        for (const it of index.sections.find((s) => s.id === 'vehicles')?.items ?? []) {
          const m = files.get(it.model);
          if (!m) continue;
          const kind = vehicleKindOf(it.label) ?? vehicleKindOf(it.template) ?? vehicleKindOf(it.model);
          g.vehicles.push({ id: it.label, label: it.label.replace(/_/g, ' '), kind: kind ?? 'speederbike', inferred: kind !== null, source: 'gallery', file: `assets-private/gallery/${m.file}`, template: it.template, bounds: m.bounds });
        }
      }
    } catch (err) {
      console.warn('garage: no gallery vehicles', err);
    }
    try {
      const res = await fetch(`${baseUrl}assets-private/creatures/manifest.json`);
      if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
        const manifest = (await res.json()) as { creatures: { id: string; file: string; clipSpeeds?: Record<string, number>; bounds?: VehicleSpec['bounds'] }[] };
        for (const c of manifest.creatures) g.vehicles.push({ id: c.id, label: `${c.id.replace(/_/g, ' ')} (mount)`, kind: 'ground', inferred: true, source: 'creature', file: `assets-private/${c.file}`, bounds: c.bounds, clipSpeeds: c.clipSpeeds });
      }
    } catch (err) {
      console.warn('garage: no creatures', err);
    }
    try {
      const res = await fetch(`${baseUrl}assets-private/ships/manifest.json`);
      if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
        type Cells = NonNullable<import('./interior').InteriorDef['cells']>;
        type Attachment = NonNullable<VehicleDef['attachments']>[number];
        type Cockpit = NonNullable<VehicleDef['cockpit']>;
        const manifest = (await res.json()) as { ships: { id: string; label: string; template: string; file: string; bounds?: VehicleSpec['bounds']; class: string; interior: { file?: string; cells?: number; failed?: string } | null; attachments?: Attachment[]; cockpit?: Cockpit | null; thrusters?: string[] }[]; models?: { file: string; bounds?: { min: number[]; max: number[] }; cells?: Cells }[] };
        const modelByFile = new Map((manifest.models ?? []).map((m) => [m.file, m]));
        for (const sh of manifest.ships) {
          const im = sh.interior?.file ? modelByFile.get(sh.interior.file) : undefined;
          const hull = modelByFile.get(sh.file);
          g.vehicles.push({
            id: sh.id,
            label: `${sh.label} (${sh.class})`,
            kind: 'ship',
            inferred: true,
            source: 'ship',
            file: `assets-private/ships/${sh.file}`,
            template: sh.template,
            bounds: sh.bounds,
            interior: sh.interior?.file ? { file: `assets-private/ships/${sh.interior.file}`, cells: sh.interior.cells ?? 0, def: { bounds: im?.bounds, cells: im?.cells } } : null,
            cells: hull?.cells,
            attachments: (sh.attachments ?? []).map((a) => ({ ...a, file: `assets-private/ships/${a.file}` })),
            cockpit: sh.cockpit ? { ...sh.cockpit, file: `assets-private/ships/${sh.cockpit.file}` } : null,
            thrusters: sh.thrusters ?? [],
          });
        }
      }
    } catch (err) {
      console.warn('garage: no ships', err);
    }
    g.vehicles.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
    return g;
  }

  find(name: string): VehicleDef | undefined {
    const n = name.toLowerCase();
    return this.vehicles.find((v) => v.id.toLowerCase() === n) ?? this.vehicles.find((v) => v.id.toLowerCase().includes(n));
  }

  byKind(): Map<VehicleKind, VehicleDef[]> {
    const out = new Map<VehicleKind, VehicleDef[]>();
    for (const v of this.vehicles) (out.get(v.kind) ?? out.set(v.kind, []).get(v.kind)!).push(v);
    return out;
  }

  private model(def: VehicleDef): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> {
    let p = this.models.get(def.file);
    if (!p) {
      p = this.loader.loadAsync(`${this.baseUrl}${def.file}`).then((gltf) => {
        gltf.scene.traverse((o) => {
          o.layers.enable(ACTOR_LAYER);
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.frustumCulled = false;
            m.userData.shared = true;
            // An invisible collidable surface (a room's window pane): not drawn, still a collider.
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            if (mats.length && mats.every((mat) => mat.userData.invisible)) {
              m.visible = false;
              m.castShadow = false;
            }
            // Glass casts no shadow: the shadow pass draws depth whatever the opacity, and a pane
            // that did would keep the sun out of the room behind it. The converter marks glass by
            // name; a hull's windows are drawn opaque and reflective as the game draws them.
            if (mats.some((mat) => mat.userData.glass || (mat.transparent && mat.opacity < 1))) m.castShadow = false;
          }
        });
        return { scene: gltf.scene, animations: gltf.animations };
      });
      this.models.set(def.file, p);
    }
    return p;
  }

  /** Stand a vehicle on the ground at a point, facing a heading, and hand it back to drive. */
  async spawn(def: VehicleDef, physics: Physics, scene: THREE.Scene, x: number, y: number, z: number, heading: number, kind: VehicleKind = def.kind, place?: (bounds: VehicleSpec['bounds']) => [number, number, number]): Promise<Vehicle> {
    const loaded = await this.model(def);
    const model = def.source === 'creature' ? cloneSkinned(loaded.scene) : loaded.scene.clone();
    // What the client data hangs on the hull, before the hull is measured: a wing is part of the
    // ship's box and its collision, and its hardpoints (the thrusters') count with the hull's.
    // The game's attachments are modelled in the hull's frame: they sit at its origin unless
    // the client data names a hardpoint or gives a place.
    for (const a of def.attachments ?? []) {
      try {
        const part = (await this.model({ file: a.file } as VehicleDef)).scene.clone();
        part.userData.attachment = a.kind;
        const hp = a.hardpoint ? findHardpoint(model, a.hardpoint) : null;
        if (hp) {
          // At the hardpoint, turned its way (a gun points where its hardpoint does), in the model's frame.
          model.updateMatrixWorld(true);
          part.position.copy(hp.getWorldPosition(new THREE.Vector3())).sub(model.getWorldPosition(new THREE.Vector3()));
          part.quaternion.copy(model.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(hp.getWorldQuaternion(new THREE.Quaternion())));
        } else if (a.hardpoint) console.warn(`garage: ${def.id}: no hardpoint "${a.hardpoint}" for ${a.slot ?? a.kind} ${a.file}`);
        else if (a.transform && a.transform.length >= 3 && a.transform.slice(0, 3).some((n) => n !== 0)) part.position.set(a.transform[0], a.transform[1], a.transform[2]);
        model.add(part);
      } catch (err) {
        console.warn(`garage: ${def.id}: ${a.kind} ${a.file} did not load`, err);
      }
    }
    let bounds = def.bounds;
    const hardpoints: string[] = [];
    const engines: THREE.Vector3[] = [];
    const seat = { point: null as THREE.Vector3 | null, cockpit: null as THREE.Vector3 | null };
    if (!bounds || def.source !== 'creature') {
      // A machine's box is measured from the model itself: the pack's bounds are the mesh file's
      // own, which for a substituted appearance can be another mesh's, and a wrong box is a
      // collider the model does not fill, springs in the wrong place and a vehicle that tumbles.
      // The model is then moved so the box is centred on the vehicle and sits on its underside:
      // a pod whose parts hang off to one side of its origin would otherwise stand its collider
      // where the mesh is not, and the rider could walk through the mesh.
      // A hull that is a portal building carries its rooms as cells beside the shell, and the
      // game's rooms are often larger than the hull around them: the vehicle is the shell, cell 0.
      const box = new THREE.Box3();
      let shell = 0;
      model.updateMatrixWorld(true);
      model.traverse((o) => {
        if (!(o as THREE.Mesh).isMesh || cellIndexOf(o) !== 0) return;
        box.expandByObject(o);
        shell++;
      });
      if (!shell) box.setFromObject(model);
      else {
        const all = new THREE.Box3().setFromObject(model);
        console.info(`garage: ${def.id} is a portal building; its shell measures ${box.max.x - box.min.x | 0}×${box.max.y - box.min.y | 0}×${box.max.z - box.min.z | 0} m, its rooms with it ${all.max.x - all.min.x | 0}×${all.max.y - all.min.y | 0}×${all.max.z - all.min.z | 0} m`);
      }
      if (!box.isEmpty()) {
        const w = box.max.x - box.min.x;
        const h = box.max.y - box.min.y;
        const l = box.max.z - box.min.z;
        const cx = (box.min.x + box.max.x) / 2;
        const cz = (box.min.z + box.max.z) / 2;
        model.position.set(-cx, -box.min.y, -cz);
        model.updateMatrixWorld(true);
        bounds = { min: [-w / 2, 0, -l / 2], max: [w / 2, h, l / 2] };
        if (Math.max(w, h, l) > 40) console.warn(`garage: ${def.id} measures ${w.toFixed(1)}×${h.toFixed(1)}×${l.toFixed(1)} m, more than a vehicle should; its model may carry an effect plane or a far part`);
      }
    }
    if (!bounds) bounds = { min: [-0.5, 0, -1], max: [0.5, 1, 1] };
    // The game's hardpoints ride along as hp:<name> nodes; a rider's, saddle's or seat's places the seat.
    // The loader strips the colon from a node's name ("hp:engine" arrives as "hpengine") and
    // keeps the original in userData, which is where the hardpoints are read.
    model.traverse((o) => {
      const name = hardpointName(o);
      if (name === null) return;
      hardpoints.push(name);
      const local = () => o.getWorldPosition(new THREE.Vector3()).sub(model.getWorldPosition(new THREE.Vector3())).add(model.position);
      if (!seat.point && /rider|saddle|seat|driver|pilot|passenger|player|mount/i.test(name)) seat.point = local();
      // The thrusters: the hardpoints the client data puts them at, else any named for an exhaust
      // (not the "engine on" appearance's or the engine sound's, which sit at the hull's origin).
      if (def.thrusters?.length ? def.thrusters.includes(name) : /exhaust|thrust|booster|engine_glow|^engine\d*$|(^|[_:])eng\d/i.test(name)) engines.push(local());
      if (!seat.cockpit && /cockpit|canopy|camera|view|pilot/i.test(name)) seat.cockpit = local();
    });
    if (hardpoints.length) console.info(`garage: ${def.id} hardpoints: ${hardpoints.join(', ')}`);
    if (place) [x, y, z] = place(bounds);
    const spec = specFor(kind, def.id, def.label, bounds, { animal: def.source === 'creature' });
    if (def.source === 'creature') {
      // A mount's saddle sits on its back, and it walks and runs with its own clips at their own pace.
      spec.seat = [0, bounds.max[1] * 0.92, (bounds.min[2] + bounds.max[2]) / 2];
    } else if (seat.point) spec.seat = [seat.point.x, seat.point.y, seat.point.z];
    const v = new Vehicle(spec, model, physics, scene, x, y - bounds.min[1] + spec.hover, z, heading);
    v.hardpoints = hardpoints;
    model.traverse((o) => {
      if (o.userData.attachment === 'engine') {
        o.visible = false;
        v.engineParts.push(o);
      }
    });
    if (def.source !== 'creature') addEngineGlow(v, engines);
    // The cockpit view: the model's own point when it names one, else the seated pilot's eyes over the seat, else forward of the middle at eye height.
    // The cockpit view: the model's own point when it names one, else the seated pilot's eyes over the seat (a hardpoint's, or the kind's own place, where the rider is drawn).
    if (spec.ship) v.cockpit = seat.cockpit ? [seat.cockpit.x, seat.cockpit.y, seat.cockpit.z] : [spec.seat[0], spec.seat[1] + SEATED_EYE, spec.seat[2]];
    // The cockpit frame, hung at the cockpit point: the instruments and canopy around the pilot,
    // seen from outside through the glass and from the eyes in first person.
    // A ship flown from its rooms has a bridge, not a frame.
    if (spec.ship && def.cockpit && v.cockpit && !(def.cells ?? []).some((c) => c.index > 0)) {
      try {
        const frame = (await this.model({ file: def.cockpit.file } as VehicleDef)).scene.clone();
        frame.traverse((o) => {
          o.userData.cockpit = true;
          const m = o as THREE.Mesh;
          if (m.isMesh) m.castShadow = false;
        });
        // The frame's middle on the seated pilot's chest: the frame is drawn around the pilot,
        // and its model's origin is not where the pilot sits.
        const box = new THREE.Box3().setFromObject(frame);
        const centre = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
        frame.position.set(spec.seat[0] - centre.x + FRAME_NUDGE.x, spec.seat[1] + SEATED_CHEST - centre.y + FRAME_NUDGE.y, spec.seat[2] - centre.z + FRAME_NUDGE.z);
        frame.visible = false;
        v.group.add(frame);
        v.cockpitFrame = frame;
        const off = def.cockpit.firstOffset;
        if (off && off.length >= 3) v.cockpitOffset = [off[0], off[1], off[2]];
      } catch (err) {
        console.warn(`garage: ${def.id}: its cockpit frame did not load`, err);
      }
    }
    if (def.source !== 'creature') collectPanes(v);
    if (def.source === 'creature' && loaded.animations.length) {
      const mixer = new THREE.AnimationMixer(model);
      const clips = new Map(loaded.animations.map((a) => [a.name, a]));
      const pick = (names: string[]) => names.map((n) => clips.get(n)).find((c) => c);
      const idle = pick(['idle', 'loop_stand:speed0']);
      const walk = pick(['walk', 'loop_stand:speed1']);
      const run = pick(['run', 'loop_stand:speed2']);
      const actions = new Map<string, THREE.AnimationAction>();
      for (const c of [idle, walk, run]) if (c) actions.set(c.name, mixer.clipAction(c).setLoop(THREE.LoopRepeat, Infinity));
      let current: THREE.AnimationAction | null = null;
      v.onUpdate = (dt, self) => {
        const s = Math.abs(self.speed);
        const want = s < 0.4 ? idle : s < 5 ? (walk ?? run) : (run ?? walk);
        const next = want ? actions.get(want.name) ?? null : null;
        if (next && next !== current) {
          next.reset().setEffectiveWeight(1).fadeIn(0.2).play();
          if (current) current.fadeOut(0.2);
          current = next;
        }
        if (current && want && want !== idle) {
          const natural = def.clipSpeeds?.[want.name] || (want === run ? 8 : 2.5);
          current.timeScale = THREE.MathUtils.clamp(s / natural, 0.5, 2.5);
        }
        mixer.update(dt);
      };
    }
    return v;
  }
}

/** The node of a model's hardpoint by name, or null. */
function findHardpoint(model: THREE.Object3D, name: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  const want = name.toLowerCase();
  model.traverse((o) => {
    if (!found && hardpointName(o)?.toLowerCase() === want) found = o;
  });
  return found;
}

/** A seated pilot's eyes over the seat point, metres. */
const SEATED_EYE = 1.0;
/** A seated pilot's chest over the seat point, where the cockpit frame is centred. */
const SEATED_CHEST = 0.6;
/** A live adjustment of where the cockpit frame sits over the seat, for finding the right place (__debug.cockpitFrame). */
export const FRAME_NUDGE = new THREE.Vector3();
/** How much of a hull's glass is seen through while someone is aboard or at the controls. */
const CLEAR_PANE = 0.45;
/** A "glass" covering more of the hull's triangles than this is its skin under a glassy name, not a window. */
const PANE_SHARE = 0.35;

/**
 * The hull's glass (the converter marks it by name): a clear copy of each pane's material, on
 * a hidden stand-in mesh so the background compile has its shader ready, swapped in while
 * someone is in the ship. A portal building's rooms (cells past the shell) are left alone.
 */
function collectPanes(v: Vehicle): void {
  const tris = new Map<THREE.Material, number>();
  let total = 0;
  const meshes: THREE.Mesh[] = [];
  v.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || cellIndexOf(o) > 0 || m.userData.cockpit) return;
    meshes.push(m);
    const n = (m.geometry.getIndex()?.count ?? m.geometry.getAttribute('position')?.count ?? 0) / 3;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) tris.set(mat, (tris.get(mat) ?? 0) + n / mats.length);
    total += n;
  });
  for (const m of meshes) {
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    mats.forEach((mat, i) => {
      if (mat.userData.invisible || !(mat.userData.glass || (mat.transparent && mat.opacity < 1))) return;
      if (total && (tris.get(mat) ?? 0) / total > PANE_SHARE) {
        console.info(`${v.spec.id}: "${mat.name}" covers ${Math.round(((tris.get(mat) ?? 0) / total) * 100)}% of the hull, kept solid`);
        return;
      }
      const clear = mat.clone();
      clear.userData = { ...mat.userData };
      clear.transparent = true;
      clear.opacity = Math.min(mat.transparent ? mat.opacity : 1, CLEAR_PANE);
      clear.depthWrite = false;
      v.panes.push({ mesh: m, index: i, solid: mat, clear });
      const standIn = new THREE.Mesh(m.geometry, clear);
      standIn.visible = false;
      standIn.castShadow = false;
      standIn.layers.enable(ACTOR_LAYER);
      v.group.add(standIn);
    });
  }
}

/**
 * Engine glow on a machine: additive discs at the rear of its box, brighter and longer the
 * faster it goes, orange for a podracer's turbines and blue for a repulsor drive.
 */
function addEngineGlow(v: Vehicle, engines: THREE.Vector3[] = []): void {
  const b = v.spec.bounds;
  const w = b.max[0] - b.min[0];
  const h = b.max[1] - b.min[1];
  const pod = v.spec.kind === 'podracer';
  const ship = !!v.spec.ship;
  const color = pod ? 0xffa040 : ship ? 0x9fd8ff : 0x4fd0ff;
  const mat = new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const glows: THREE.Sprite[] = [];
  // At the engine hardpoints when the model has them (a ship's engine is a part a player fits,
  // so the hull carries only the socket), else at the rear of the box.
  const spots = engines.length ? engines : (w > 1.2 ? [-w * 0.28, w * 0.28] : [0]).map((x) => new THREE.Vector3(x, b.min[1] + h * 0.45, b.min[2] - 0.05));
  for (const p of spots) {
    const sp = new THREE.Sprite(mat);
    sp.position.copy(p);
    sp.scale.setScalar(0.2);
    v.group.add(sp);
    glows.push(sp);
  }
  const size = ship ? Math.min(7, (0.6 + w * 0.12) * 1.7) : Math.min(1.6, 0.25 + w * 0.18);
  // A ship's exhaust leaves a ribbon behind it in flight, longer the faster it goes.
  if (ship) {
    const holder = v.group.parent ?? v.group;
    for (const g of glows) {
      const trail = new EngineTrail(color, g);
      holder.add(trail.mesh);
      v.trails.push(trail);
    }
  }
  const base = v.onUpdate;
  v.onUpdate = (dt, self, drive) => {
    base?.(dt, self, drive);
    const throttle = drive ? Math.max(0, drive.throttle) : 0;
    const share = Math.min(1, Math.abs(self.speed) / self.spec.maxSpeed);
    for (const t of self.trails) t.update(dt, self.airborne && Math.abs(self.speed) > 6 ? 0.3 + 0.7 * share + 0.3 * throttle : 0, size * (0.25 + 0.35 * share));
    // The drive's own appearance while it runs; the cockpit frame and clear glass while someone is at the controls or aboard.
    const running = throttle > 0 || self.airborne || Math.abs(self.speed) > 1;
    for (const p of self.engineParts) p.visible = running;
    if (self.cockpitFrame) self.cockpitFrame.visible = drive !== null;
    self.setGlassClear(drive !== null || self.occupied);
    const k = size * (0.35 + 0.65 * Math.min(1, Math.abs(self.speed) / self.spec.maxSpeed) + 0.4 * throttle + (self.boosting ? 0.6 : 0)) * (self.overheated > 0 ? 0.4 + 0.3 * Math.random() : 1);
    for (const g of glows) g.scale.set(k, k, 1);
    mat.opacity = 0.55 + 0.45 * Math.min(1, Math.abs(self.speed) / 8 + throttle);
  };
}

let glowTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowTex = new THREE.CanvasTexture(canvas);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

/** Clone a skinned model so its skeleton is its own (three's SkeletonUtils, inlined for the one use). */
function cloneSkinned(source: THREE.Object3D): THREE.Group {
  const sourceLookup = new Map<THREE.Object3D, THREE.Object3D>();
  const cloneLookup = new Map<THREE.Object3D, THREE.Object3D>();
  const clone = source.clone() as THREE.Group;
  const pair = (a: THREE.Object3D, b: THREE.Object3D) => {
    sourceLookup.set(b, a);
    cloneLookup.set(a, b);
    for (let i = 0; i < a.children.length; i++) pair(a.children[i], b.children[i]);
  };
  pair(source, clone);
  clone.traverse((node) => {
    const sm = node as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh) return;
    const sourceMesh = sourceLookup.get(node) as THREE.SkinnedMesh;
    const sourceBones = sourceMesh.skeleton.bones;
    sm.skeleton = sourceMesh.skeleton.clone();
    sm.bindMatrix.copy(sourceMesh.bindMatrix);
    sm.skeleton.bones = sourceBones.map((b) => (cloneLookup.get(b) as THREE.Bone) ?? b);
    sm.bind(sm.skeleton, sm.bindMatrix);
  });
  return clone;
}
