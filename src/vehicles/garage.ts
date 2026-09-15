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
  /**
   * What the ship's client data hangs on the hull: its wings (with the hinge each opens about,
   * as a position and yaw, pitch and roll in degrees, the angle it opens by and the seconds it
   * takes), an appearance shown while the drive runs, and the fitted components.
   */
  attachments?: { kind: 'wing' | 'engine' | 'component'; slot?: string; file: string; hardpoint?: string | null; transform?: number[] | null; hinge?: number[] | null; angle?: number; time?: number }[];
  /** The gun a ship fires, from the game's weapon table. */
  weapon?: ShipWeapon | null;
  /** How the rider sits, from the game's mount tables (the riding clip's selector value), or null for the default saddle. */
  riderPose?: string | null;
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

export interface ShipWeapon {
  name: string;
  /** An index into the projectile table. */
  projectile: number;
  /** Metres a second, and the range in metres. */
  speed: number;
  range: number;
}

/** A row of the game's projectile table, as the ships pack carries it: the bolt's effect and the hit effects per surface. */
export interface ProjectileDef {
  index: number;
  effect: string;
  reach: number;
  hit: { metal: string | null; other: string | null; shield: string | null };
}

interface GalleryIndex {
  sections: { id: string; items: { label: string; template: string; model: string; radius: number; height?: number; riderPose?: string }[] }[];
}

/** A hardpoint node's name without its hp: prefix, or null for any other node. */
export function hardpointName(o: THREE.Object3D): string | null {
  const name = ((o.userData as { name?: string }).name ?? o.name) || '';
  const m = /^hp[:_]?(.+)$/i.exec(name);
  return m ? m[1] : null;
}

export class Garage {
  readonly vehicles: VehicleDef[] = [];
  /** The game's projectiles, by index, when the ships pack carries them. */
  readonly projectiles = new Map<number, ProjectileDef>();
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
        const manifest = (await man.json()) as { categories: { layout: { id: string; file: string; bounds?: VehicleSpec['bounds']; clipSpeeds?: Record<string, number> }[] } };
        const files = new Map(manifest.categories.layout.map((m) => [m.id, m]));
        for (const it of index.sections.find((s) => s.id === 'vehicles')?.items ?? []) {
          const m = files.get(it.model);
          if (!m) continue;
          const kind = vehicleKindOf(it.label) ?? vehicleKindOf(it.template) ?? vehicleKindOf(it.model);
          g.vehicles.push({ id: it.label, label: it.label.replace(/_/g, ' '), kind: kind ?? 'speederbike', inferred: kind !== null, source: 'gallery', file: `assets-private/gallery/${m.file}`, template: it.template, bounds: m.bounds, riderPose: it.riderPose ?? null, clipSpeeds: m.clipSpeeds });
        }
      }
    } catch (err) {
      console.warn('garage: no gallery vehicles', err);
    }
    try {
      const res = await fetch(`${baseUrl}assets-private/creatures/manifest.json`);
      if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
        const manifest = (await res.json()) as { creatures: { id: string; file: string; clipSpeeds?: Record<string, number>; bounds?: VehicleSpec['bounds']; riderPose?: string; mount?: boolean }[] };
        // The mounts the game sold (the saddle map's creatures) come first; the planets' other creatures can be ridden too, as a wild thing.
        for (const c of manifest.creatures) g.vehicles.push({ id: c.id, label: `${c.id.replace(/_/g, ' ')} (${c.mount ? 'mount' : 'wild'})`, kind: 'ground', inferred: true, source: 'creature', file: `assets-private/${c.file}`, bounds: c.bounds, clipSpeeds: c.clipSpeeds, riderPose: c.riderPose ?? null });
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
        const manifest = (await res.json()) as { ships: { id: string; label: string; template: string; file: string; bounds?: VehicleSpec['bounds']; class: string; interior: { file?: string; cells?: number; failed?: string } | null; attachments?: Attachment[]; cockpit?: Cockpit | null; thrusters?: string[]; weapon?: ShipWeapon | null }[]; models?: { file: string; bounds?: { min: number[]; max: number[] }; cells?: Cells }[] };
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
            weapon: sh.weapon ?? null,
            // A pilot sits as the game's pilot chairs seat one (space_sitting), the one riding pose that is a chair.
            riderPose: 'space_sitting',
          });
        }
      }
    } catch (err) {
      console.warn('garage: no ships', err);
    }
    try {
      // The projectile table beside the ships: the bolts' effects and where they strike. An
      // older pack has none, and the ships' bolts are then drawn as a blaster's.
      const res = await fetch(`${baseUrl}assets-private/ships/projectiles.json`);
      if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
        const table = (await res.json()) as { projectiles: ProjectileDef[] };
        for (const p of table.projectiles) g.projectiles.set(p.index, p);
      }
    } catch (err) {
      console.warn('garage: no projectile table', err);
    }
    g.vehicles.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
    return g;
  }

  find(name: string): VehicleDef | undefined {
    const n = name.toLowerCase();
    return this.vehicles.find((v) => v.id.toLowerCase() === n) ?? this.vehicles.find((v) => v.id.toLowerCase().includes(n));
  }

  /** How a ship's bolt looks, from the projectile table, or null when the pack has no table. */
  projectileFor(index: number): import('../combat/bolts').ProjectileVisual | null {
    const p = this.projectiles.get(index);
    if (!p) return null;
    return { effect: p.effect, reach: p.reach, hit: p.hit.metal ?? p.hit.other ?? null };
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
    // A skinned model (a creature, a walker, a pod racer built on a skeleton) needs a skeleton of
    // its own: a plain clone shares the loaded scene's bones, and its mesh then draws where that
    // scene stands, at the origin, however the vehicle moves.
    const animated = loaded.animations.length > 0;
    let skinned = false;
    loaded.scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
    });
    const model = skinned ? cloneSkinned(loaded.scene) : loaded.scene.clone();
    // What the client data hangs on the hull, before the hull is measured: a wing is part of the
    // ship's box and its collision, and its hardpoints (the thrusters') count with the hull's.
    // The game's attachments are modelled in the hull's frame: they sit at its origin unless
    // the client data names a hardpoint or gives a place. A wing that opens keeps its hinge.
    const wings: Vehicle['wings'] = [];
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
        if (a.kind === 'wing' && a.angle && a.hinge && a.hinge.length >= 6) {
          // The hinge, authored in the hull's frame: the converter mirrors X, so its place flips
          // in X, its yaw and roll change sign, and so does the turn about it (a roll).
          const [hx, hy, hz, yaw, pitch, roll] = a.hinge;
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(pitch), -THREE.MathUtils.degToRad(yaw), -THREE.MathUtils.degToRad(roll), 'YXZ'));
          const hinge = new THREE.Matrix4().compose(new THREE.Vector3(-hx, hy, hz), q, new THREE.Vector3(1, 1, 1));
          part.updateMatrix();
          part.matrixAutoUpdate = false;
          wings.push({ node: part, base: part.matrix.clone(), hinge, hingeInverse: hinge.clone().invert(), angle: -THREE.MathUtils.degToRad(a.angle), time: a.time ?? 3 });
        }
      } catch (err) {
        console.warn(`garage: ${def.id}: ${a.kind} ${a.file} did not load`, err);
      }
    }
    let bounds = def.bounds;
    const hardpoints: string[] = [];
    // The guns: a gun part's own muzzle when it names one, else the weapon hardpoint it hangs on,
    // each firing the way its hardpoint points (forward, for a fixed gun).
    const guns: { muzzle: { pos: THREE.Vector3; dir: THREE.Vector3 }[]; mount: { pos: THREE.Vector3; dir: THREE.Vector3 }[] } = { muzzle: [], mount: [] };
    // Where the engines glow, by what the hardpoints are called, best first: the engine parts'
    // own glow points, the client data's thruster points, any exhaust, any numbered engine.
    const engineSpots: { glow: THREE.Vector3[]; thruster: THREE.Vector3[]; exhaust: THREE.Vector3[]; engine: THREE.Vector3[] } = { glow: [], thruster: [], exhaust: [], engine: [] };
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
      const pointing = () => new THREE.Vector3(0, 0, 1).applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(o.getWorldQuaternion(new THREE.Quaternion()))).normalize();
      if (/muzzle|barrel|(^|_)fire|flash/i.test(name)) guns.muzzle.push({ pos: local(), dir: pointing() });
      else if (/^weapon\d*(_[a-z]+)?\d*$|^gun\d*(_[a-z]+)?\d*$/i.test(name)) guns.mount.push({ pos: local(), dir: pointing() });
      if (!seat.point && /rider|saddle|seat|driver|pilot|passenger|player|mount/i.test(name)) seat.point = local();
      // Not the "engine on" appearance's or the engine sound's hardpoints, which sit at the hull's origin, and not the boosters'.
      if (/engine_glow/i.test(name)) engineSpots.glow.push(local());
      else if (def.thrusters?.includes(name)) engineSpots.thruster.push(local());
      else if (/exhaust|thrust/i.test(name)) engineSpots.exhaust.push(local());
      else if (/^engine\d*$|(^|[_:])eng\d/i.test(name)) engineSpots.engine.push(local());
      if (!seat.cockpit && /cockpit|canopy|camera|view|pilot/i.test(name)) seat.cockpit = local();
    });
    if (hardpoints.length) console.info(`garage: ${def.id} hardpoints: ${hardpoints.join(', ')}`);
    if (place) [x, y, z] = place(bounds);
    const spec = specFor(kind, def.id, def.label, bounds, { animal: def.source === 'creature' });
    if (def.source === 'creature') {
      // A mount's saddle sits on its back: the top of the body over the middle of its length
      // (measured from the mesh at rest, since the box's top is the head or the hump), and the
      // saddle poses put the pelvis 0.16 m over that. It walks and runs with its own clips at their own pace.
      const zMid = (bounds.min[2] + bounds.max[2]) / 2;
      const back = backHeight(model, bounds, zMid);
      spec.seat = [0, back ?? bounds.max[1] * 0.92, zMid];
    } else if (def.source === 'gallery' && def.riderPose) {
      // The game's own convention for its vehicles: the rider sits at the vehicle's authored
      // origin and the riding clip's root offset puts the pelvis in the seat (a speeder bike's
      // rider hardpoint is exactly its clip's root, 1.16 m up). The model was moved so its box
      // stands on the vehicle's origin, so the authored origin is where the model now sits.
      spec.seat = [model.position.x, model.position.y, model.position.z];
    } else if (seat.point) spec.seat = [seat.point.x, seat.point.y, seat.point.z];
    // The cockpit frame (the game's cockpit file): the instruments and canopy around the pilot,
    // authored in the ship's own space, so it hangs on the model at its origin and lands in the
    // canopy by itself. The game never drew a pilot in a fighter, so the seat comes from the
    // frame: a little below and behind its middle. A ship flown from its rooms has a bridge, not a frame.
    let frame: THREE.Object3D | null = null;
    if (spec.ship && def.cockpit && !(def.cells ?? []).some((c) => c.index > 0)) {
      try {
        frame = (await this.model({ file: def.cockpit.file } as VehicleDef)).scene.clone();
        frame.traverse((o) => {
          o.userData.cockpit = true;
          const m = o as THREE.Mesh;
          if (m.isMesh) m.castShadow = false;
        });
        frame.position.copy(FRAME_NUDGE);
        frame.visible = false;
        model.add(frame);
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(frame);
        if (!box.isEmpty() && !seat.point) {
          // The frame's middle in the hull's frame (the model carries the re-centring).
          const middle = box.getCenter(new THREE.Vector3()).sub(model.getWorldPosition(new THREE.Vector3())).add(model.position);
          spec.seat = [middle.x + SEAT_FROM_FRAME.x, middle.y + SEAT_FROM_FRAME.y, middle.z + SEAT_FROM_FRAME.z];
          console.info(`garage: ${def.id} cockpit frame: middle at ${middle.toArray().map((n) => n.toFixed(2)).join(',')} in the hull's frame, the seat under it at ${spec.seat.map((n) => n.toFixed(2)).join(',')}`);
        }
      } catch (err) {
        console.warn(`garage: ${def.id}: its cockpit frame did not load`, err);
        frame = null;
      }
    }
    const v = new Vehicle(spec, model, physics, scene, x, y - bounds.min[1] + spec.hover, z, heading);
    // A pilot's seat from the cockpit frame names where the pelvis goes; the pilot's chair pose
    // has its origin half a metre under it, which the game takes off when it seats the rider.
    if (spec.ship && frame) v.seatPelvis = true;
    if (frame) {
      v.cockpitFrame = frame;
      const off = def.cockpit?.firstOffset;
      if (off && off.length >= 3) v.cockpitOffset = [off[0], off[1], off[2]];
    }
    v.hardpoints = hardpoints;
    v.riderPose = def.riderPose ?? null;
    model.traverse((o) => {
      if (o.userData.attachment === 'engine') {
        o.visible = false;
        v.engineParts.push(o);
      }
    });
    const engines = engineSpots.glow.length ? engineSpots.glow : engineSpots.thruster.length ? engineSpots.thruster : engineSpots.exhaust.length ? engineSpots.exhaust : engineSpots.engine;
    if (def.source !== 'creature') addEngineGlow(v, engines);
    if (spec.ship) {
      // A gun that points nowhere useful (a hardpoint with no turn of its own) fires along the nose.
      v.guns = (guns.muzzle.length ? guns.muzzle : guns.mount).map((g) => ({ pos: g.pos, dir: g.dir.z > 0.5 ? g.dir : new THREE.Vector3(0, 0, 1) }));
      v.boltColor = /(^|_)tie|imperial|lambda|star_destroyer|decimator/i.test(def.id) ? 0x3af06a : 0xff4a2a;
      v.weapon = def.weapon ?? null;
      v.wings.push(...wings);
      if (v.guns.length) console.info(`garage: ${def.id} guns: ${v.guns.length}${v.weapon ? `, firing ${v.weapon.name} (projectile ${v.weapon.projectile}${this.projectiles.has(v.weapon.projectile) ? '' : ', not in the pack: drawn as a blaster bolt'}, ${v.weapon.speed} m/s to ${v.weapon.range} m)` : ', no weapon in the manifest: a blaster bolt'}`);
      if (wings.length) console.info(`garage: ${def.id} wings that open: ${wings.map((w) => `${Math.round(THREE.MathUtils.radToDeg(-w.angle))}° in ${w.time} s`).join(', ')}`);
    }
    // The cockpit view: the model's own point when it names one, else the seated pilot's eyes over the seat, else forward of the middle at eye height.
    // The cockpit view: the model's own point when it names one, else the seated pilot's eyes over the seat (a hardpoint's, or the kind's own place, where the rider is drawn).
    if (spec.ship) v.cockpit = seat.cockpit ? [seat.cockpit.x, seat.cockpit.y, seat.cockpit.z] : [spec.seat[0], spec.seat[1] + SEATED_EYE, spec.seat[2]];
    if (def.source !== 'creature') collectPanes(v);
    if (animated) {
      // Its own idle, walk and run, picked by speed: an animal's, or a walker's from its animation table.
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

/**
 * The height of a creature's back over a point along its length: the highest vertex of its
 * meshes at rest within a strip round the spine there, or null when nothing lies in the strip.
 */
function backHeight(model: THREE.Object3D, bounds: VehicleSpec['bounds'], z: number): number | null {
  const halfW = Math.max(0.1, (bounds.max[0] - bounds.min[0]) * 0.12);
  const halfL = Math.max(0.1, (bounds.max[2] - bounds.min[2]) * 0.08);
  let top = -Infinity;
  const p = new THREE.Vector3();
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute('position');
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      if (Math.abs(p.x) <= halfW && Math.abs(p.z - z) <= halfL && p.y > top) top = p.y;
    }
  });
  return Number.isFinite(top) ? top : null;
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
/** Where the pilot's pelvis sits from the cockpit frame's middle: a little below and behind it, found by eye in the X-wing (with the default saddle pose, whose pelvis is 0.16 m over the rider's origin). */
const SEAT_FROM_FRAME = new THREE.Vector3(0, -0.29, -0.32);
/** A live adjustment of where the cockpit frame sits in the hull, for checking it (__debug.cockpitFrame). */
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
  // A ship's glow is sized by its hull's height, not its width: a fighter's wings make it wide, its engines are not.
  const size = ship ? Math.min(7, Math.max(0.5, h * 0.4)) : Math.min(1.6, 0.25 + w * 0.18);
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
    for (const t of self.trails) t.update(dt, self.airborne && Math.abs(self.speed) > 6 ? 0.5 * (0.3 + 0.7 * share + 0.3 * throttle) : 0, size * (0.015 + 0.0225 * share));
    // The drive's own appearance while it runs; the cockpit frame and clear glass while someone is at the controls or aboard.
    const running = throttle > 0 || self.airborne || Math.abs(self.speed) > 1;
    for (const p of self.engineParts) p.visible = running;
    if (self.cockpitFrame) self.cockpitFrame.visible = drive !== null;
    self.setGlassClear(drive !== null || self.occupied);
    const k = size * (0.35 + 0.65 * Math.min(1, Math.abs(self.speed) / self.spec.maxSpeed) + 0.4 * throttle + (self.boosting ? 0.6 : 0)) * (self.overheated > 0 ? 0.4 + 0.3 * Math.random() : 1);
    for (const g of glows) g.scale.set(k, k, 1);
    mat.opacity = (ship ? 0.35 : 0.55) + 0.45 * Math.min(1, Math.abs(self.speed) / 8 + throttle);
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
