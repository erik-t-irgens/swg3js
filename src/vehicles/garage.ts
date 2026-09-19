// The garage: every vehicle the gallery pack converted and every animal mount the creatures pack
// has, sorted into the four kinds by name, and spawned beside the player to ride.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Vehicle, specFor, vehicleKindOf, type VehicleKind, type VehicleSpec } from './vehicle';
import type { Physics } from '../core/physics';
import { ACTOR_LAYER } from '../world/portalRender';
import { surfaces } from '../world/surfaces';
import { cellIndexOf } from './interior';
import { COCKPIT_BODY_NUDGE, EYE_OVER_PELVIS, GUN_MOUNT, GUN_MUZZLE, addVec, bodyLift, frameFileName, isEyeHardpoint, isSeatHardpoint, mirroredOffset, pelvisOnSeat, seatDropBelow, type Vec3 } from './cockpitSeat';
import { EngineTrail } from './trail';
import { advanceEnginePhase, engineHeatOf } from './enginePlumes';
import { planSeat, hangSaddle, type SaddleDef, type SeatPlan } from './saddle';
import { PART_LIMIT, collectGuns, frameExtents, hangAttachments, hardpointName, partOf, underPivot, wingDrop, type AttachmentDef, type Assembly } from './shipAssembly';
import { WING_DROP_MIN, WING_TIP_ROOM, type WingSet } from './wings';

// Moved to shipAssembly.ts (node-testable); every existing import from here keeps working.
export { hardpointName } from './shipAssembly';

export interface VehicleDef {
  id: string;
  label: string;
  kind: VehicleKind;
  /** Whether the kind was read off the name; unknown names default to a speeder bike and are marked. */
  inferred: boolean;
  source: 'gallery' | 'creature' | 'ship';
  /** A ship's interior, when it has one: the model, and what the manifest says of its cells and bounds. */
  interior?: { file: string; cells: number; def: import('./interior').InteriorDef } | null;
  /** What the manifest says of the hull model's own cells, when it is a portal building (rooms, their lights), and its portal polygons. */
  cells?: NonNullable<import('./interior').InteriorDef['cells']>;
  portals?: NonNullable<import('./interior').InteriorDef['portals']>;
  /**
   * What hangs on the ship, as a tree: each part names the part it hangs on (or the hull), the
   * hardpoint there and where it stands; wings (and wings on wings), carriers, the "on"
   * appearances and the stock parts from the chassis tables. A pack converted before carries
   * defs without `parent`, hung by hardpoint name (shipAssembly.ts).
   */
  attachments?: AttachmentDef[];
  /** The ship's chassis (the row of the game's chassis table), or null; absent on a pack converted before. */
  chassis?: string | null;
  /** The chassis's wing_open_speed_factor: the share of top speed with the wings open (1 when it has none). */
  wingOpenSpeedFactor?: number;
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
  /** A mount's saddle from the creatures pack: its model, the joint the creature's own hardpoint hangs it from, and its rider point. */
  saddle?: SaddleDef | null;
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

/** What a spawn may be given to do before the vehicle is shown. */
export interface BuildOptions {
  /** Join the world's material schemes and compile, a mesh at a time, before the model is shown. */
  prepare?: (roots: THREE.Object3D[]) => Promise<void>;
}

/** The engine glows made before a vehicle exists (so the preparation compiles them with it), wired to it once it does. */
interface EngineGlow {
  mat: THREE.SpriteMaterial;
  sprites: THREE.Sprite[];
  trails: EngineTrail[];
  size: number;
}

export class Garage {
  readonly vehicles: VehicleDef[] = [];
  /** The game's projectiles, by index, when the ships pack carries them. */
  readonly projectiles = new Map<number, ProjectileDef>();
  private readonly loader = surfaces.withPlugin(new GLTFLoader());
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
        type Saddle = { appearance: string; file: string | null; joint: string | null; from: string | null; player: [number, number, number] | null };
        const manifest = (await res.json()) as { creatures: { id: string; file: string; clipSpeeds?: Record<string, number>; bounds?: VehicleSpec['bounds']; riderPose?: string; mount?: boolean; hardpoints?: string[]; saddle?: Saddle }[] };
        // The mounts the game sold (the saddle map's creatures) come first; the planets' other creatures can be ridden too, as a wild thing.
        // A mount's saddle is the one the mount tables name; a pack converted before saddles has none.
        for (const c of manifest.creatures) g.vehicles.push({ id: c.id, label: `${c.id.replace(/_/g, ' ')} (${c.mount ? 'mount' : 'wild'})`, kind: 'ground', inferred: true, source: 'creature', file: `assets-private/${c.file}`, bounds: c.bounds, clipSpeeds: c.clipSpeeds, riderPose: c.riderPose ?? null, saddle: c.saddle ? { file: c.saddle.file ? `assets-private/${c.saddle.file}` : null, joint: c.saddle.joint ?? null, player: c.saddle.player ?? null } : null });
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
        type Portals = NonNullable<import('./interior').InteriorDef['portals']>;
        const manifest = (await res.json()) as { ships: { id: string; label: string; template: string; file: string; bounds?: VehicleSpec['bounds']; class: string; interior: { file?: string; cells?: number; failed?: string } | null; attachments?: Attachment[]; cockpit?: Cockpit | null; thrusters?: string[]; weapon?: ShipWeapon | null; chassis?: string | null; wingOpenSpeedFactor?: number }[]; models?: { file: string; bounds?: { min: number[]; max: number[] }; cells?: Cells; portals?: Portals }[] };
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
            interior: sh.interior?.file ? { file: `assets-private/ships/${sh.interior.file}`, cells: sh.interior.cells ?? 0, def: { bounds: im?.bounds, cells: im?.cells, portals: im?.portals } } : null,
            cells: hull?.cells,
            portals: hull?.portals,
            attachments: (sh.attachments ?? []).map((a) => ({ ...a, file: `assets-private/ships/${a.file}` })),
            chassis: sh.chassis ?? null,
            wingOpenSpeedFactor: sh.wingOpenSpeedFactor ?? 1,
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
        // A hull's rooms (cells past the shell) get their own copies of the materials they share
        // with the shell, marked dry: rain never reaches a room, and marking the shared material
        // would dry the hull too. Made once per model, before any instance reaches the scene; a
        // copy keeps its original's userData (glass, invisible) and shares its program.
        const roomCopies = new Map<THREE.Material, THREE.Material>();
        const roomCopy = (mat: THREE.Material): THREE.Material => {
          let c = roomCopies.get(mat);
          if (!c) {
            c = mat.clone();
            c.userData.dry = true;
            roomCopies.set(mat, c);
          }
          return c;
        };
        gltf.scene.traverse((o) => {
          o.layers.enable(ACTOR_LAYER);
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.frustumCulled = false;
            m.userData.shared = true;
            if (cellIndexOf(o) > 0) m.material = Array.isArray(m.material) ? m.material.map(roomCopy) : roomCopy(m.material);
            // A ship's own materials are dry whatever kind it is spawned as: the material scan
            // judges a shared material once, by the first copy it meets, for every copy after.
            if (def.kind === 'ship') markDry(m);
            // An invisible collidable surface (a room's window pane): not drawn, still a collider.
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            if (mats.length && mats.every((mat) => mat.userData.invisible)) {
              m.visible = false;
              m.castShadow = false;
            }
            // Glass casts no shadow: the shadow pass draws depth whatever the opacity, and a pane
            // that did would keep the sun out of the room behind it. The converter marks glass by
            // name; a hull's windows are drawn opaque and reflective as the game draws them.
            if (mats.some((mat) => mat.userData.glass || (mat.transparent && mat.opacity < 1) || mat.userData.noShadow)) m.castShadow = false;
          }
        });
        return { scene: gltf.scene, animations: gltf.animations };
      });
      this.models.set(def.file, p);
    }
    return p;
  }

  /** Saddle files that failed to load, so each is warned of once. */
  private readonly saddleFailed = new Set<string>();

  /**
   * A copy of a mount's saddle model (loaded once per file, sharing its geometry and materials,
   * on the actor layer and casting shadows; not a ship's, so rain wets the leather), or null when
   * it does not load. Never throws.
   */
  private async saddleModel(file: string): Promise<THREE.Object3D | null> {
    try {
      return (await this.model({ file } as VehicleDef)).scene.clone();
    } catch (err) {
      if (!this.saddleFailed.has(file)) {
        this.saddleFailed.add(file);
        console.warn(`garage: the saddle ${file} did not load; its mounts are seated without it`, err);
      }
      return null;
    }
  }

  /** A mount's saddle model, fetched beside the creature's own (null when it has none): it must be in hand before the vehicle is built. */
  private saddleFor(def: VehicleDef): Promise<THREE.Object3D | null> {
    return def.source === 'creature' && def.saddle?.file ? this.saddleModel(def.saddle.file) : Promise.resolve(null);
  }

  /** Stand a vehicle on the ground at a point, facing a heading, and hand it back to drive. */
  async spawn(def: VehicleDef, physics: Physics, scene: THREE.Scene, x: number, y: number, z: number, heading: number, kind: VehicleKind = def.kind, place?: (bounds: VehicleSpec['bounds']) => [number, number, number], opts: BuildOptions = {}): Promise<Vehicle> {
    // A mount's saddle loads beside it, before the body exists: nothing may be awaited once it does.
    const [loaded, saddle] = await Promise.all([this.model(def), this.saddleFor(def)]);
    // A skinned model (a creature, a walker, a pod racer built on a skeleton) needs a skeleton of
    // its own: a plain clone shares the loaded scene's bones, and its mesh then draws where that
    // scene stands, at the origin, however the vehicle moves.
    let skinned = false;
    loaded.scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
    });
    const model = skinned ? cloneSkinned(loaded.scene) : loaded.scene.clone();
    const a = await this.assemble(def, model);
    const bounds = this.frameModel(def, model);
    // How far the open wings reach under the closed belly, on the real vertices (a portal hull's rooms left out).
    const drop = a.wings.length ? wingDrop(model, a.wings, (o) => cellIndexOf(o) <= 0) : 0;
    const hardpoints: string[] = [];
    return this.finishSpawn(def, model, a, drop, bounds, hardpoints, loaded.animations, saddle, physics, scene, x, y, z, heading, kind, place, opts);
  }

  /**
   * A vehicle as a picture only, for another player's ride seen across the relay: the model with
   * its parts hung on it and framed as a spawned one is, its rooms hidden, with no physics.
   */
  async visual(def: VehicleDef, opts: BuildOptions = {}): Promise<THREE.Object3D> {
    return (await this.visualParts(def, opts)).holder;
  }

  /**
   * Another player's ride as a picture (`visual`), with its wings, which the relay's word moves
   * (RemotePlayers steps them), and what could not be hung. Prepared (`opts.prepare`) before it is
   * handed back, so it compiles nothing once shown.
   */
  async visualParts(def: VehicleDef, opts: BuildOptions = {}): Promise<{ holder: THREE.Object3D; wings: WingSet; unresolved: string[] }> {
    const [loaded, saddle] = await Promise.all([this.model(def), this.saddleFor(def)]);
    let skinned = false;
    loaded.scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
    });
    const model = skinned ? cloneSkinned(loaded.scene) : loaded.scene.clone();
    const a = await this.assemble(def, model);
    this.frameModel(def, model);
    model.traverse((o) => {
      if (cellIndexOf(o) > 0) o.visible = false;
    });
    const holder = new THREE.Group();
    // A ship is never wetted, parked or flying: its materials were marked dry when the model
    // loaded (by the model's own kind), and another player's is held dry as well.
    if (def.kind === 'ship') holder.userData.weatherDry = true;
    holder.add(model);
    if (def.source === 'creature') {
      // Posed as it stands in its idle before anything is measured or hung (its rest pose can stand
      // metres from it), so another player's mount wears its saddle where the rider's own does.
      const idle = loaded.animations.find((a) => a.name === 'idle' || a.name === 'loop_stand:speed0') ?? loaded.animations[0];
      if (idle) {
        const mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(idle).play();
        // Posed once; the mixer is dropped, not stopped (stopping would restore the rest pose).
        mixer.update(0);
      }
      const hardpoints: string[] = [];
      model.traverse((o) => {
        const n = hardpointName(o);
        if (n !== null) hardpoints.push(n);
      });
      hangSaddle(model, planSeat(hardpoints, def.saddle), saddle, findHardpoint, holder, null);
    }
    // Compiled before it is shown, saddle and parts included (the holder carries everything).
    if (opts.prepare) await opts.prepare([holder]);
    return { holder, wings: a.wings, unresolved: a.unresolved };
  }

  /**
   * Hang what the ship carries, before the hull is measured: every part under the node it names
   * (its parent part's hardpoint, or its origin at its place), a wing under a pivot that turns it,
   * so a part on a wing rides it (hangAttachments, shipAssembly.ts). The parts are part of the
   * ship's box and its collision, and their hardpoints (glows, muzzles) count with the hull's.
   */
  private async assemble(def: VehicleDef, model: THREE.Object3D): Promise<Assembly> {
    const a = await hangAttachments(model, def.attachments ?? [], async (file) => {
      const part = (await this.model({ file } as VehicleDef)).scene.clone();
      // A ship's wings, engines and guns stay dry as its hull does (the clone shares the loaded materials).
      if (def.kind === 'ship') markDry(part);
      return part;
    });
    // A hull with more parts than the physics and the shadow pass want (the Star Destroyer's 207):
    // its parts are pictures only, culled one by one, casting nothing.
    if (a.hung > PART_LIMIT) {
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !partOf(o, model)) return;
        m.userData.noCollider = true;
        m.castShadow = false;
        m.frustumCulled = true;
      });
    }
    if (a.unresolved.length) console.warn(`garage: ${def.id}: left off: ${a.unresolved.join('; ')}`);
    return a;
  }

  /**
   * The vehicle's box, and the model moved so the box is centred on the vehicle and stands on
   * its underside (a creature keeps its pack's bounds and its place). Returns the bounds.
   */
  private frameModel(def: VehicleDef, model: THREE.Object3D): VehicleSpec['bounds'] {
    let bounds = def.bounds;
    if (!bounds || def.source !== 'creature') {
      // A machine's box is measured from the model itself: the pack's bounds are the mesh file's
      // own, which for a substituted appearance can be another mesh's, and a wrong box is a
      // collider the model does not fill, springs in the wrong place and a vehicle that tumbles.
      // The model is then moved so the box is centred on the vehicle and sits on its underside:
      // a pod whose parts hang off to one side of its origin would otherwise stand its collider
      // where the mesh is not, and the rider could walk through the mesh.
      // A hull that is a portal building carries its rooms as cells beside the shell, and the
      // game's rooms are often larger than the hull around them: the vehicle is the shell, cell 0,
      // with the parts hung on it (a belly turret counts: the ship stands on it, not through it).
      // A ship is centred on the meshes that do not ride a wing (frameExtents): framed on its
      // closed box, the B-wing would turn about a point 7 m out along its flat wing.
      let shell = false;
      model.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && cellIndexOf(o) === 0) shell = true;
      });
      const include = shell ? (o: THREE.Object3D) => cellIndexOf(o) === 0 || (cellIndexOf(o) < 0 && !!partOf(o, model)) : () => true;
      const f = frameExtents(model, include);
      if (f) {
        const w = f.halfW * 2;
        const l = f.halfL * 2;
        if (shell) {
          const all = new THREE.Box3().setFromObject(model);
          console.info(`garage: ${def.id} is a portal building; its shell measures ${w | 0}×${f.h | 0}×${l | 0} m, its rooms with it ${all.max.x - all.min.x | 0}×${all.max.y - all.min.y | 0}×${all.max.z - all.min.z | 0} m`);
        }
        model.position.sub(new THREE.Vector3(f.cx, f.minY, f.cz));
        model.updateMatrixWorld(true);
        bounds = { min: [-f.halfW, 0, -f.halfL], max: [f.halfW, f.h, f.halfL] };
        model.userData.reach = f.reach;
        if (Math.max(w, f.h, l) > 40) console.warn(`garage: ${def.id} measures ${w.toFixed(1)}×${f.h.toFixed(1)}×${l.toFixed(1)} m, more than a vehicle should; its model may carry an effect plane or a far part`);
      }
    }
    return bounds ?? { min: [-0.5, 0, -1], max: [0.5, 1, 1] };
  }

  private async finishSpawn(def: VehicleDef, model: THREE.Object3D, a: Assembly, drop: number, bounds: VehicleSpec['bounds'], hardpoints: string[], animations: THREE.AnimationClip[], saddle: THREE.Object3D | null, physics: Physics, scene: THREE.Scene, x: number, y: number, z: number, heading: number, kind: VehicleKind, place?: (bounds: VehicleSpec['bounds']) => [number, number, number], opts: BuildOptions = {}): Promise<Vehicle> {
    // Where the engines glow, by what the hardpoints are called, best first: the engine parts'
    // own glow points, the client data's thruster points, any exhaust, any numbered engine. The
    // nodes themselves: a glow hung on one rides whatever carries it (an engine on a wing).
    const engineSpots: { glow: THREE.Object3D[]; thruster: THREE.Object3D[]; exhaust: THREE.Object3D[]; engine: THREE.Object3D[] } = { glow: [], thruster: [], exhaust: [], engine: [] };
    const seat = { point: null as THREE.Vector3 | null, cockpit: null as THREE.Vector3 | null };
    let cockpitName = '';
    // The game's hardpoints ride along as hp:<name> nodes; a rider's, saddle's or seat's places the seat.
    // The loader strips the colon from a node's name ("hp:engine" arrives as "hpengine") and
    // keeps the original in userData, which is where the hardpoints are read.
    model.traverse((o) => {
      const name = hardpointName(o);
      if (name === null) return;
      hardpoints.push(name);
      const local = () => o.getWorldPosition(new THREE.Vector3()).sub(model.getWorldPosition(new THREE.Vector3())).add(model.position);
      // Only the hull's own hardpoints seat the pilot or set the eye: a turret body's turretcamera1 is not the cockpit.
      const hull = !partOf(o, model);
      // A gun is never a seat or an eye (the gunboats' pilotmuzzle1 is a gun).
      if (hull && !seat.point && isSeatHardpoint(name)) seat.point = local();
      // Not the "engine on" appearance's or the engine sound's hardpoints, which sit at the hull's origin, and not the boosters'.
      if (/engine_glow/i.test(name)) engineSpots.glow.push(o);
      else if (def.thrusters?.includes(name)) engineSpots.thruster.push(o);
      else if (/exhaust|thrust/i.test(name)) engineSpots.exhaust.push(o);
      else if (/^engine\d*$|(^|[_:])eng\d/i.test(name)) engineSpots.engine.push(o);
      if (hull && !seat.cockpit && isEyeHardpoint(name)) {
        seat.cockpit = local();
        cockpitName = name;
      }
    });
    if (hardpoints.length) console.info(`garage: ${def.id} hardpoints: ${hardpoints.join(', ')}`);
    const spec = specFor(kind, def.id, def.label, bounds, { animal: def.source === 'creature' });
    // The ship's own size, for the chase camera and the boarding range (its bounds reach its farthest wing either side).
    if (model.userData.reach) spec.reach = model.userData.reach as number;
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
    // Only the ships pack's ships sit by the cockpit eye: a speeder or a creature spawned "as a ship" keeps its own seat.
    const shipPack = !!spec.ship && def.source === 'ship';
    let eye: Vec3 | null = null;
    let eyeFrom = 'hull';
    let seatDrop: number | null = null;
    // The cockpit frame (the game's cockpit file): the instruments and canopy around the pilot,
    // authored in the ship's own space, so it hangs on the model at its origin and lands in the
    // canopy by itself. Its one hardpoint, camera, is the game's first-person eye; the game never
    // drew a pilot, so the body hangs under that eye and sits on the cushion found under it in the
    // frame's own triangles. A ship flown from its rooms has a bridge, not a frame.
    let frame: THREE.Object3D | null = null;
    if (shipPack && def.cockpit && !(def.cells ?? []).some((c) => c.index > 0)) {
      try {
        frame = (await this.model({ file: def.cockpit.file } as VehicleDef)).scene.clone();
        frame.traverse((o) => {
          o.userData.cockpit = true;
          const m = o as THREE.Mesh;
          if (m.isMesh) m.castShadow = false;
        });
        // The instruments inside the canopy never weather.
        markDry(frame);
        frame.position.copy(FRAME_NUDGE);
        frame.visible = false;
        model.add(frame);
        model.updateMatrixWorld(true);
        // In the hull's frame, as the traverse's hardpoints are (the model carries the re-centring; FRAME_NUDGE is included).
        const modelAt = model.getWorldPosition(new THREE.Vector3());
        const hullLocal = (p: THREE.Vector3) => p.sub(modelAt).add(model.position);
        let camera: Vec3 | null = null;
        const hp = findHardpoint(frame, 'camera');
        if (hp) {
          const at = hullLocal(hp.getWorldPosition(new THREE.Vector3()));
          camera = [at.x, at.y, at.z];
          eyeFrom = 'hp:camera';
          const along = new THREE.Vector3(0, 0, 1).applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(hp.getWorldQuaternion(new THREE.Quaternion()))).normalize();
          const off = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(along.z, -1, 1)));
          if (off > 2) console.warn(`garage: ${def.id}: the cockpit's camera point looks ${off.toFixed(1)}° off the nose; the view is kept along the nose`);
        } else {
          // No camera point (none of the game's frames lacks one): a seated pilot's eyes over the old guess from the frame's middle.
          const box = new THREE.Box3().setFromObject(frame);
          if (!box.isEmpty()) {
            const middle = hullLocal(box.getCenter(new THREE.Vector3()));
            camera = [middle.x + SEAT_FROM_FRAME.x + EYE_OVER_PELVIS[0], middle.y + SEAT_FROM_FRAME.y + EYE_OVER_PELVIS[1], middle.z + SEAT_FROM_FRAME.z + EYE_OVER_PELVIS[2]];
            eyeFrom = 'frame middle';
          }
        }
        if (camera) {
          const offset = mirroredOffset(def.cockpit.firstOffset);
          eye = addVec(camera, offset);
          // The seat: one ray straight down through the frame's own triangles, from the eye at the seated pelvis's depth.
          // Spawn-time arithmetic on a few thousand triangles; nothing is kept.
          const tris: number[] = [];
          const p = new THREE.Vector3();
          frame.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            const pos = m.geometry.getAttribute('position');
            if (!pos) return;
            const index = m.geometry.getIndex();
            const count = index ? index.count : pos.count;
            for (let i = 0; i + 2 < count; i += 3) {
              for (let k = 0; k < 3; k++) {
                hullLocal(p.fromBufferAttribute(pos, index ? index.getX(i + k) : i + k).applyMatrix4(m.matrixWorld));
                tris.push(p.x, p.y, p.z);
              }
            }
          });
          seatDrop = seatDropBelow(tris, eye[0], eye[1], eye[2] - EYE_OVER_PELVIS[2]);
          // The pelvis for the logs and the spawn report, at scale 1 wheeled out; the rider is placed by the eye.
          spec.seat = pelvisOnSeat(eye, seatDrop);
          const n2 = (a: readonly number[]) => a.map((n) => n.toFixed(2)).join(',');
          const up = bodyLift(seatDrop, EYE_OVER_PELVIS[1], 1, false);
          const upFirst = bodyLift(seatDrop, EYE_OVER_PELVIS[1], 1, true);
          const moved = (n: number) => `${n < 0 ? 'lowered' : 'raised'} ${Math.abs(n).toFixed(2)}`;
          console.info(`garage: ${def.id} cockpit: eye at ${eyeFrom} ${n2(camera)} (+1OFF ${n2(offset)}) in the hull's frame; ${seatDrop !== null ? `seat ${seatDrop.toFixed(2)} m under it, the body ${moved(up)} (${upFirst.toFixed(2)} in first person)` : 'no seat under it (only steep surfaces): the body hangs from the eye'}`);
        }
      } catch (err) {
        console.warn(`garage: ${def.id}: its cockpit frame did not load`, err);
        frame = null;
        eye = null;
        eyeFrom = 'hull';
        seatDrop = null;
      }
    }
    // The glows and trails are made now, on their nodes, so the preparation below compiles them too.
    const engines = engineSpots.glow.length ? engineSpots.glow : engineSpots.thruster.length ? engineSpots.thruster : engineSpots.exhaust.length ? engineSpots.exhaust : engineSpots.engine;
    const glow = def.source !== 'creature' ? makeEngineGlow(spec, model, engines) : null;
    // The whole assembly (parts, cockpit frame, glows, trails) joins the world's material schemes and is compiled
    // before the vehicle exists, so nothing compiles once it is shown.
    if (opts.prepare) {
      const began = performance.now();
      await opts.prepare([model, ...(glow?.trails.map((t) => t.mesh) ?? [])]);
      // A big hull (hundreds of drawables, rooms included) takes seconds to appear: said, so the wait is not a mystery.
      const took = performance.now() - began;
      if (took > 1000) console.info(`garage: ${def.id}: prepared in ${(took / 1000).toFixed(1)} s before it was shown`);
    }
    // The ground is read when the vehicle is made, after the preparation's wait.
    if (place) [x, y, z] = place(bounds);
    // Nothing may be awaited in finishSpawn after this line: the body is live, falling and unsprung until the world adds the vehicle.
    const v = new Vehicle(spec, model, physics, scene, x, y - bounds.min[1] + spec.hover, z, heading);
    // The wings, for every kind (a vehicle that is not a ship never flies, so its stay shut unless the console forces them).
    v.wings = a.wings;
    v.wingDrop = drop > WING_DROP_MIN ? drop : 0;
    v.wingClearance = v.wingDrop ? v.wingDrop + WING_TIP_ROOM : 0;
    v.wingOpenFactor = def.wingOpenSpeedFactor ?? 1;
    v.unhung = a.unresolved;
    // A ship's pilot is placed by the eye (Vehicle.eyeSeat), not by a pelvis seat: seatPelvis stays for the vehicles that use it.
    if (frame) {
      v.cockpitFrame = frame;
      v.cockpitOffset = mirroredOffset(def.cockpit?.firstOffset);
      v.seatDrop = seatDrop;
      const nudge = COCKPIT_BODY_NUDGE[frameFileName(def.cockpit?.file)];
      if (nudge) {
        v.bodyNudge[0] = nudge[0];
        v.bodyNudge[1] = nudge[1];
        v.bodyNudge[2] = nudge[2];
      }
    }
    v.hardpoints = hardpoints;
    v.riderPose = def.riderPose ?? null;
    if (kind === 'podracer') {
      // A pod's cockpit, from the mesh, for the pods whose authored origin is nowhere near it
      // (some were left unfinished): the pod hangs at the end its origin leans to, and the pilot
      // sits half a metre under the mesh's top there. The rider takes it when the game's own seat
      // lands outside the pod.
      const L = bounds.max[2] - bounds.min[2];
      const h = bounds.max[1] - bounds.min[1];
      const end = model.position.z < -0.5 ? -1 : 1;
      const z = end * Math.max(0, L / 2 - Math.min(2.5, L * 0.16));
      const top = backHeight(model, bounds, z);
      v.podSeat = [0, THREE.MathUtils.clamp((top ?? h * 0.6) - 0.55, 0.3, h * 0.9), z];
      console.info(`garage: ${def.id} cockpit guessed at ${v.podSeat.map((n) => n.toFixed(2)).join(',')} from the mesh (its origin sits at ${model.position.toArray().map((n) => n.toFixed(2)).join(',')} in its box)`);
    }
    v.def = def;
    // The "on" appearances: an engine's while the drive runs, a booster's only while boosting.
    model.traverse((o) => {
      if (o.userData.attachment !== 'engine') return;
      o.visible = false;
      (o.userData.on === 'booster' ? v.boosterParts : v.engineParts).push(o);
    });
    if (glow) wireEngineGlow(v, glow);
    if (spec.ship) {
      // The guns are their muzzle nodes, read live at each shot (Vehicle.muzzle): a gun on a wing fires from where the
      // wing has turned it. The place and the way at spawn stay for the vehicle's frame; a gun that points nowhere
      // useful (a hardpoint with no turn of its own) fires along the nose.
      v.group.updateMatrixWorld(true);
      const toGroup = new THREE.Matrix4().copy(v.group.matrixWorld).invert();
      const groupTurn = v.group.getWorldQuaternion(new THREE.Quaternion()).invert();
      v.guns = collectGuns(model, (n) => GUN_MUZZLE.test(n), (n) => GUN_MOUNT.test(n)).map((g) => {
        const pos = g.node.getWorldPosition(new THREE.Vector3()).applyMatrix4(toGroup);
        const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(groupTurn.clone().multiply(g.node.getWorldQuaternion(new THREE.Quaternion()))).normalize();
        return { pos, dir: dir.z > 0.5 ? dir : new THREE.Vector3(0, 0, 1), node: g.node, hardpoint: g.hardpoint, turret: g.turret };
      });
      v.boltColor = /(^|_)tie|imperial|lambda|star_destroyer|decimator/i.test(def.id) ? 0x3af06a : 0xff4a2a;
      v.weapon = def.weapon ?? null;
      if (v.guns.length) console.info(`garage: ${def.id} guns: ${v.guns.length}${v.weapon ? `, firing ${v.weapon.name} (projectile ${v.weapon.projectile}${this.projectiles.has(v.weapon.projectile) ? '' : ', not in the pack: drawn as a blaster bolt'}, ${v.weapon.speed} m/s to ${v.weapon.range} m)` : ', no weapon in the manifest: a blaster bolt'}`);
    }
    if (a.hung || a.wings.length) {
      const hungParts = new Set(a.parts.filter((p): p is THREE.Object3D => !!p));
      const onWings = [...hungParts].filter((p) => p.userData.attachment !== 'wing' && underPivot(p, model)).length;
      const opening = a.wings.list.map((w) => `${Math.round(-THREE.MathUtils.radToDeg(w.angle))}° in ${w.time} s`).join(', ');
      console.info(`garage: ${def.id} parts: ${a.hung} hung (${onWings} on wings)${opening ? `, wings that open: ${opening}, reaching ${drop.toFixed(1)} m under the belly` : ''}`);
    }
    // The cockpit view: the frame's own camera point (cockpitEye() adds 1OFF back, so __debug.cockpit({ offset: false }) can
    // drop it), else a hull hardpoint's that is not a gun's, else the seated pilot's eyes over the seat.
    if (spec.ship) {
      // Only the ships pack's ships sit by the eye: a speeder or a creature spawned "as a ship" keeps its own seat and rider.
      v.eyeSeat = shipPack;
      if (eye) {
        v.cockpit = [eye[0] - v.cockpitOffset[0], eye[1] - v.cockpitOffset[1], eye[2] - v.cockpitOffset[2]];
        v.eyeSource = eyeFrom;
      } else {
        // No frame: the eye is a hull hardpoint's (never a gun's), else a seated eye over the kind's seat, until the rooms'
        // bridge gives the pilot's place. A room ship from the pack has no pilot drawn, as the game never drew one.
        v.cockpit = seat.cockpit ? [seat.cockpit.x, seat.cockpit.y, seat.cockpit.z] : [spec.seat[0], spec.seat[1] + SEATED_EYE, spec.seat[2]];
        v.eyeSource = seat.cockpit ? `hardpoint ${cockpitName}` : 'hull';
        v.riderHidden = shipPack && !frame;
      }
    }
    if (def.source !== 'creature') collectPanes(v);
    if (def.source === 'creature' && !animations.length) seatRider(def, v, model, hardpoints, saddle);
    if (animations.length) {
      // Its own idle, walk and run, picked by speed: an animal's, or a walker's from its animation table.
      const mixer = new THREE.AnimationMixer(model);
      const clips = new Map(animations.map((a) => [a.name, a]));
      const pick = (names: string[]) => names.map((n) => clips.get(n)).find((c) => c);
      const idle = pick(['idle', 'loop_stand:speed0']);
      const walk = pick(['walk', 'loop_stand:speed1']);
      const run = pick(['run', 'loop_stand:speed2']);
      const actions = new Map<string, THREE.AnimationAction>();
      for (const c of [idle, walk, run]) if (c) actions.set(c.name, mixer.clipAction(c).setLoop(THREE.LoopRepeat, Infinity));
      let current: THREE.AnimationAction | null = null;
      // A mount's seat rides its back: hung on the skeleton once the idle has posed it (its rest pose
      // can stand far from any animated one), so only the gait's own motion reaches the rider.
      if (def.source === 'creature') {
        const first = idle ?? walk ?? run;
        if (first) {
          current = actions.get(first.name)!;
          current.reset().setEffectiveWeight(1).play();
          mixer.update(0);
        }
        seatRider(def, v, model, hardpoints, saddle);
      }
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
 * Seat a mount's rider (synchronous, once the idle has posed the skeleton): the game's saddle on
 * the creature's saddle hardpoint with the pelvis on the saddle's player point, the creature's own
 * player point, a saddle on the back where the idle stands it, or a bare seat on the back
 * (`hangSaddle`, src/vehicles/saddle.ts). The seat and saddle ride the skeleton, so the rider sways
 * with the gait.
 */
function seatRider(def: VehicleDef, v: Vehicle, model: THREE.Object3D, hardpoints: string[], saddle: THREE.Object3D | null): void {
  const plan = planSeat(hardpoints, def.saddle);
  const hung = hangSaddle(model, plan, saddle, findHardpoint, v.group, v);
  console.info(`garage: ${def.id}: ${describeSeat(v, hung, plan)}`);
}

/** What the log says of how a mount's rider was seated. */
function describeSeat(v: Vehicle, hung: { node: THREE.Object3D; from: string } | null, plan: SeatPlan): string {
  const boneOf = (o: THREE.Object3D | null | undefined) => o?.name || 'unnamed';
  if (v.seatFrom === 'saddle' && hung) {
    const where = `the saddle hangs on its ${boneOf(hung.node.parent)} joint (the game's hardpoint)`;
    if (v.saddle) return `${where}; the rider's pelvis on the saddle's player point`;
    return `${where}; ${plan.saddleFile ? 'its model did not load, so ' : 'no saddle model in the pack, so '}the rider's pelvis sits where the saddle's player point would be`;
  }
  if (v.seatFrom === 'rider') return "the rider's pelvis on its own player point";
  if (v.seatFrom === 'guess' && hung) {
    const bone = hung.node.parent;
    const on = bone && (bone as THREE.Bone).isBone ? `hung on the ${boneOf(bone)} bone` : 'fixed to the body (no skeleton)';
    if (v.saddle) return `a saddle on its back where the idle stands it (guessed), ${on}`;
    return `a seat on its back where the idle stands it (guessed; ${plan.saddleFile ? 'its saddle model did not load' : 'no saddle model in the pack'}), ${on}`;
  }
  const bone = v.seat.parent;
  return v.seatFollows && bone ? `the seat on its back where the idle stands it, on the ${boneOf(bone)} bone` : 'the seat on its back where the idle stands it, fixed to the body (no skeleton)';
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

/** A seated pilot's eyes over the seat point, metres: the eye of a ship without a cockpit frame until its bridge is known. */
const SEATED_EYE = 1.0;
/**
 * Where the pilot's pelvis sits from the cockpit frame's middle: a little below and behind it, found by eye in the X-wing
 * (with the default saddle pose, whose pelvis is 0.16 m over the rider's origin). Only the fallback for a frame without
 * its camera point, which none of the game's frames lacks.
 */
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
 * Mark every material under a node (the node itself included) `userData.dry`, so the material
 * scan never wets it. On a clone this marks the loaded model's shared materials, for every copy.
 */
function markDry(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.userData.dry = true;
  });
}

/**
 * Engine glow on a machine, made before the vehicle exists (so the preparation compiles it with
 * the model): additive discs on the engine hardpoints (under whatever carries them, so a glow on a
 * wing's engine turns with it) or at the rear of the box, and for a ship a trail per glow, its
 * mesh not yet in the scene. Orange for a podracer's turbines and blue for a repulsor drive.
 */
function makeEngineGlow(spec: VehicleSpec, model: THREE.Object3D, spots: THREE.Object3D[]): EngineGlow {
  const b = spec.bounds;
  const w = b.max[0] - b.min[0];
  const h = b.max[1] - b.min[1];
  const pod = spec.kind === 'podracer';
  const ship = !!spec.ship;
  const color = pod ? 0xffa040 : ship ? 0x9fd8ff : 0x4fd0ff;
  const mat = new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const sprites: THREE.Sprite[] = [];
  // At the engine hardpoints when the model has them (a ship's engine is a part a player fits,
  // so the hull carries only the socket), else at the rear of the box (in the vehicle's frame,
  // taken into the model's: the model only ever moves, never turns, when it is framed).
  if (spots.length) {
    for (const spot of spots) {
      const sp = new THREE.Sprite(mat);
      sp.scale.setScalar(0.2);
      spot.add(sp);
      sprites.push(sp);
    }
  } else {
    for (const x of w > 1.2 ? [-w * 0.28, w * 0.28] : [0]) {
      const sp = new THREE.Sprite(mat);
      sp.position.set(x, b.min[1] + h * 0.45, b.min[2] - 0.05).sub(model.position);
      sp.scale.setScalar(0.2);
      model.add(sp);
      sprites.push(sp);
    }
  }
  // A ship's glow is sized by its hull's height, not its width: a fighter's wings make it wide, its engines are not.
  const size = ship ? Math.min(7, Math.max(0.5, h * 0.4)) : Math.min(1.6, 0.25 + w * 0.18);
  // A ship's exhaust leaves a ribbon behind it in flight, longer the faster it goes; each follows its glow wherever that is carried.
  const trails = ship ? sprites.map((sp) => new EngineTrail(color, sp)) : [];
  return { mat, sprites, trails, size };
}

/**
 * The glows made by makeEngineGlow, wired to the vehicle once it exists (synchronously: nothing is
 * awaited after `new Vehicle`): the heat haze reads each glow, the trails go into the world, and
 * the update scales the glows, runs the trails and shows the "on" appearances.
 */
function wireEngineGlow(v: Vehicle, glow: EngineGlow): void {
  const { mat, sprites: glows, size } = glow;
  const ship = !!v.spec.ship;
  // The heat haze follows the same glows: each one's place, base size and its own noise offset.
  glows.forEach((g, i) => v.engines.push({ object: g, size, seed: (i * 0.618034) % 1 }));
  const holder = v.group.parent ?? v.group;
  for (const trail of glow.trails) {
    holder.add(trail.mesh);
    v.trails.push(trail);
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
    for (const p of self.boosterParts) p.visible = running && self.boosting;
    // How hard the engines run, for the air shimmering behind them, and its noise flowing with it.
    self.engineHeat = engineHeatOf(running, share, throttle, self.boosting, self.overheated > 0);
    advanceEnginePhase(self, size, dt);
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
