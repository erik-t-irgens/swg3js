// The garage: every vehicle the gallery pack converted and every animal mount the creatures pack
// has, sorted into the four kinds by name, and spawned beside the player to ride.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Vehicle, specFor, vehicleKindOf, type VehicleKind, type VehicleSpec } from './vehicle';
import type { Physics } from '../core/physics';
import { ACTOR_LAYER } from '../world/portalRender';
import { surfaces } from '../world/surfaces';
import { cellIndexOf } from './interior';
import { COCKPIT_BODY_NUDGE, EYE_OVER_PELVIS, addVec, bodyLift, frameFileName, isEyeHardpoint, isSeatHardpoint, mirroredOffset, pelvisOnSeat, seatDropBelow, type Vec3 } from './cockpitSeat';
import { EngineTrail } from './trail';
import { advanceEnginePhase, engineHeatOf } from './enginePlumes';
import { planSeat, hangSaddle, type SaddleDef, type SeatPlan } from './saddle';
import { PART_LIMIT, applyPlace, frameExtents, hangAttachments, hardpointName, partOf, underPivot, wingDrop, type AttachmentDef, type Assembly } from './shipAssembly';
import { WING_DROP_MIN, WING_TIP_ROOM, WingSet, type Wing } from './wings';
import { boltSlotOf, changedSlots, componentIndex, gunWeapon, partsOf, resolveFit, samePaint, type ComponentDef, type DroidDef, type FitDef, type PlacedPart, type ResolvedFit, type ShipFit } from './shipFit';
import { collectMounts, countSpotHardpoints, dropWingsUnder, engineSpotsOf, fitTree, hangParts, onModel, rebindGlows, recordHung, refitSwap, splitPartChildren, stageRefit, type Mounts, type PendingPart, type ShipBuild, type SpareGlows, type StandIn, type SwapResult } from './shipMounts';
import { ShipPaint } from './shipPaint';
import { renderPaint } from './paintRender';

// Moved to shipAssembly.ts (node-testable); every existing import from here keeps working.
export { hardpointName } from './shipAssembly';

/** A spawn dropped because the world it was asked for went while the ship was being prepared. */
export class SpawnCancelled extends Error {
  constructor(readonly id: string) {
    super(`garage: ${id}: the world changed while it was being prepared; not spawned`);
    this.name = 'SpawnCancelled';
  }
}

/** A refit's new parts, loaded, painted and compiled in a detached group; `commit` swaps them in, in one synchronous step. */
export interface Staged {
  /** The slots whose look changes ('droid' when the droid does). */
  slots: string[];
  parts: PendingPart[];
  group: THREE.Group;
  commit: () => SwapResult;
}

/** What a refit did. */
export interface RefitReport {
  slots: string[];
  /** Parts staged and hung. */
  parts: number;
  /** Parts still waiting for a carrier (label and hardpoint). */
  waiting: string[];
  repainted: boolean;
  weaponsChanged: boolean;
  ms: number;
}

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
  /** A ship's chassis slots with the components each takes and the parts each shows, its droid socket and its paint; absent on a pack converted before (or without components.json). */
  fit?: FitDef | null;
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
  /** The fit to build (a ship with `fit`); null or absent: the stock fit. */
  fit?: ResolvedFit | null;
  /** Join the world's material schemes and compile, a mesh at a time, before the model is shown. */
  prepare?: (roots: THREE.Object3D[]) => Promise<void>;
  /** Take materials out of the world's sets (the paint's own copies, when they are disposed). */
  forget?: (materials: THREE.Material[]) => void;
  /** The longest wait for custom paint before the model is shown (ms); 3000 by default. */
  paintWait?: number;
  /** Checked just before the vehicle is made: false drops the spawn (SpawnCancelled; the world unloaded meanwhile). */
  alive?: () => boolean;
}

/** The engine glows made before a vehicle exists (so the preparation compiles them with it), wired to it once it does. */
interface EngineGlow {
  mat: THREE.SpriteMaterial;
  sprites: THREE.Sprite[];
  trails: EngineTrail[];
  size: number;
  color: number;
  /** The nodes the sprites hang on, sprite i on spot i (hardpoints, or glow spots at the rear of the box). */
  spots: THREE.Object3D[];
}

export class Garage {
  readonly vehicles: VehicleDef[] = [];
  /** The game's projectiles, by index, when the ships pack carries them. */
  readonly projectiles = new Map<number, ProjectileDef>();
  /** The pack's ship components (components.json), by index (what a fit's looks list), and by name; the droids and flight computers. */
  readonly components: ComponentDef[] = [];
  readonly componentByName = new Map<string, number>();
  readonly droids: DroidDef[] = [];
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
      // The ship components (components.json) beside the manifest: without them a fit cannot be resolved,
      // and the ships are built as their manifest's stock tree (as a pack converted before).
      const [res, comps] = await Promise.all([fetch(`${baseUrl}assets-private/ships/manifest.json`), fetch(`${baseUrl}assets-private/ships/components.json`).catch(() => null)]);
      if (comps?.ok && (comps.headers.get('content-type') ?? '').includes('json')) {
        try {
          const file = (await comps.json()) as { format?: number; components?: ComponentDef[]; droids?: DroidDef[] };
          g.components.push(...(file.components ?? []));
          for (const [name, i] of componentIndex(g.components)) g.componentByName.set(name, i);
          g.droids.push(...(file.droids ?? []));
        } catch (err) {
          console.warn('garage: components.json did not read; ships are built stock', err);
        }
      }
      if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
        type Cells = NonNullable<import('./interior').InteriorDef['cells']>;
        type Attachment = NonNullable<VehicleDef['attachments']>[number];
        type Cockpit = NonNullable<VehicleDef['cockpit']>;
        type Portals = NonNullable<import('./interior').InteriorDef['portals']>;
        const manifest = (await res.json()) as { ships: { id: string; label: string; template: string; file: string; bounds?: VehicleSpec['bounds']; class: string; interior: { file?: string; cells?: number; failed?: string } | null; attachments?: Attachment[]; cockpit?: Cockpit | null; thrusters?: string[]; weapon?: ShipWeapon | null; chassis?: string | null; wingOpenSpeedFactor?: number; fit?: FitDef | null }[]; models?: { file: string; bounds?: { min: number[]; max: number[] }; cells?: Cells; portals?: Portals }[] };
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
            // Only with the components to resolve it against: a fit whose names cannot be looked up would hang nothing.
            fit: sh.fit && g.components.length ? sh.fit : null,
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

  /** A saved fit checked against a ship's chassis (resolveFit with this pack's tables); null for a def without `fit`. */
  resolve(def: VehicleDef, saved: ShipFit | null): ResolvedFit | null {
    if (!def.fit) return null;
    return resolveFit(def.fit, this.components, this.componentByName, this.droids, saved);
  }

  /**
   * Stage a change of fit on a built model (a spawned ship's, the preview's, a peer's picture): the parts of
   * every slot whose look changes (and the droid) are loaded and hung with their own children in a detached
   * group, with the stand-in of any slot that may be left empty; they are prepared in their own materials,
   * then tracked by the paint (which, while custom, puts the ship's copies on them, and those are prepared
   * too); then the paint is applied when it changed, or its renders for the new parts are waited for (3 s at
   * most). Nothing in the scene changes until `commit`, which is one synchronous step: the swap
   * (`swapParts`, the stand-ins decided again), the paint forgetting what was taken down, and `wings` (the
   * model's own set, when given) losing any wing on a part taken down and gaining the wings the new parts
   * brought.
   */
  async restage(def: VehicleDef, build: ShipBuild, fit: ResolvedFit, next: ResolvedFit, paint: ShipPaint | null, prepare: (roots: THREE.Object3D[]) => Promise<void>, wings?: WingSet): Promise<Staged> {
    return this.stage(def, build, fit, next, paint, prepare, null, wings);
  }

  /** `restage`, with `extra` adding to the staging group (and naming more roots to prepare) before the prepare: a refit's spare glows. */
  private async stage(def: VehicleDef, build: ShipBuild, fit: ResolvedFit, next: ResolvedFit, paint: ShipPaint | null, prepare: (roots: THREE.Object3D[]) => Promise<void>, extra: ((group: THREE.Group, parts: PendingPart[]) => THREE.Object3D[]) | null, wings?: WingSet): Promise<Staged> {
    if (!def.fit) throw new Error(`garage: ${def.id} has no fit to change`);
    const slots = changedSlots(def.fit, fit, next);
    const changing = new Set(slots);
    const placed = partsOf(def.fit, def.id, next, this.droids).filter((p) => changing.has(p.slot));
    // The new parts' wings join the model's set only at the swap: until then they are in a detached group.
    const staging = new WingSet();
    const built = await this.buildPlaced(def, placed, staging);
    for (const note of built.unresolved) console.warn(`garage: ${def.id}: ${note}`);
    // A stand-in whose slot changes may be wanted after the swap: loaded now, so the staging prepares it.
    await this.loadStandIns(def, build, slots);
    const parts = built.parts;
    const staged = await stageRefit(build, slots, parts, {
      track: paint ? (n) => paint.track(n) : undefined,
      untrack: paint ? (n) => paint.untrack(n) : undefined,
      prepare,
      extra: extra ?? undefined,
      after: paint ? () => (!samePaint(fit, next) ? paint.apply(next.paint, 3000) : paint.custom ? paint.settled(3000) : Promise.resolve()) : undefined,
    });
    const commit = (): SwapResult => {
      const r = staged.commit();
      if (wings) {
        dropWingsUnder(wings, r.removed);
        for (const w of staging.list) if (onModel(w.pivot, build.root)) wings.add(w);
      }
      for (const s of r.standIns?.missing ?? []) console.warn(`garage: ${def.id}: ${s.label} stands in for an empty ${s.standsFor}, but ${!s.node || !s.ready ? 'it did not load' : `nothing carries its hardpoint ${s.def.hardpoint}`}; left off`);
      return r;
    };
    return { slots, parts, group: staged.group, commit };
  }

  /** Load (once) the stand-in of every slot among `slots`, marked as hangAttachments marks a part and stood at its place; not hung, not prepared (the staging does that). A model that fails is warned of and stays unloaded. */
  private async loadStandIns(def: VehicleDef, build: ShipBuild, slots: string[]): Promise<void> {
    const want = (build.standIns ?? []).filter((s) => !s.node && slots.some((k) => k === s.standsFor || k.startsWith(`${s.standsFor}_`)));
    if (!want.length) return;
    const load = this.partLoader(def);
    await Promise.all(
      want.map(async (s) => {
        try {
          // The def is the garage's own (its file already under assets-private/ships/).
          s.node = standInNode(s.def, await load(s.def.file));
          s.ready = false;
        } catch (err) {
          console.warn(`garage: ${def.id}: the stand-in ${s.label} did not load`, err);
        }
      }),
    );
  }

  /**
   * Refit a spawned ship in place. The new parts are staged, painted and compiled first (with spare glow
   * sprites and trails for any engine spots they bring, so those compile too); then, in one synchronous
   * step: every glow sprite to the vehicle's group (none left under a part about to go), the swap, the fit,
   * the guns measured again (each with what its slot fires), the glows re-hung on the engine spots now there,
   * and the "on" appearances collected again. Colliders, bounds, seat and cockpit stay as spawned.
   */
  async refit(v: Vehicle, next: ResolvedFit, prepare: (roots: THREE.Object3D[]) => Promise<void>): Promise<RefitReport> {
    const began = performance.now();
    const def = v.def;
    if (!def?.fit || !v.build || !v.fit) throw new Error(`garage: ${v.spec.id} has no fit to change`);
    const was = v.fit;
    const weaponsChanged = Object.keys({ ...was.components, ...next.components }).some((s) => s.startsWith('weapon') && (was.components[s] ?? null) !== (next.components[s] ?? null));
    const repainted = !samePaint(was, next);
    const thrusters = def.thrusters ?? [];
    const spare: SpareGlows = { sprites: [], trails: [] };
    // A change of look can move the engine spots even with no new part (an engine slot emptied falls back to the hull's thrusters).
    const looksChange = changedSlots(def.fit, was, next).length > 0;
    const s = await this.stage(def, v.build, was, next, v.paint, prepare, (group, parts) => {
      // As many spare glows as the ship could want after the swap, beyond the sprites it has.
      if (!v.glowMaterial || !looksChange) return [];
      const root = v.build!.root;
      let could = countSpotHardpoints(root, thrusters);
      for (const p of parts) could += countSpotHardpoints(p.node, thrusters);
      for (const si of v.build!.standIns ?? []) if (si.node && !onModel(si.node, root)) could += countSpotHardpoints(si.node, thrusters);
      const n = Math.max(0, could - v.glows.length);
      for (let i = 0; i < n; i++) {
        const sp = new THREE.Sprite(v.glowMaterial);
        sp.scale.setScalar(0.2);
        group.add(sp);
        spare.sprites.push(sp);
        if (v.spec.ship) spare.trails.push(new EngineTrail(v.glowColor, sp));
      }
      return spare.trails.map((t) => t.mesh);
    }, v.wings);
    if (!v.group.parent) {
      // The ship went while its parts were staged: nothing to swap into.
      for (const t of spare.trails) t.dispose(v.group);
      for (const p of s.parts) v.paint?.untrack(p.node);
      return { slots: [], parts: 0, waiting: [], repainted: false, weaponsChanged: false, ms: performance.now() - began };
    }
    // The swap: one synchronous step, nothing awaited (glows off the parts, the swap, the mounts measured, the glows re-hung).
    const r = refitSwap(v, s.commit, v.build.root, thrusters, v.wings, v.spec.ship ? (sp) => new EngineTrail(v.glowColor, sp) : null, spare);
    v.fit = next;
    this.fitGuns(v, def, next, r.mounts);
    collectOnParts(v, v.build.root);
    const waiting = r.waiting.map((p) => `${p.label} waits for hardpoint ${p.hardpoint}`);
    for (const w of waiting) console.warn(`garage: ${def.id}: ${w}, which nothing on the model carries`);
    const hung = s.parts.filter((p) => !r.waiting.includes(p)).length;
    const standIns = r.standIns && (r.standIns.up.length || r.standIns.down.length) ? `, stand-ins ${r.standIns.up.length} up and ${r.standIns.down.length} down` : '';
    console.info(`garage: ${def.id} refitted: ${s.slots.length ? s.slots.join(', ') : 'no parts changed'}${repainted ? ', repainted' : ''}; ${hung} parts hung${standIns}, ${v.guns.length} guns, ${v.engines.length} glows (${(performance.now() - began).toFixed(0)} ms)`);
    return { slots: s.slots, parts: hung, waiting, repainted, weaponsChanged, ms: performance.now() - began };
  }

  /** A ship's guns from its measured mounts: with a fit, each fires its slot's component (a gun on the hull, the first bolt slot's) and a gun whose slot fires nothing is left out; without, the ship's one weapon. */
  private fitGuns(v: Vehicle, def: VehicleDef, fit: ResolvedFit | null, m: Mounts): void {
    const fitted = !!def.fit && !!fit;
    const fallback = fitted ? boltSlotOf(this.components, this.componentByName, fit!) : null;
    v.guns = m.guns
      .map((g) => ({
        pos: g.pos,
        dir: g.dir.z > 0.5 ? g.dir : new THREE.Vector3(0, 0, 1),
        node: g.node,
        hardpoint: g.hardpoint,
        turret: g.turret,
        slot: g.slot,
        ...(fitted ? { weapon: gunWeapon(this.components, this.componentByName, fit!, g.slot, fallback) } : {}),
      }))
      .filter((g) => !fitted || g.weapon !== null);
    v.weapon = fitted ? (v.guns[0]?.weapon ?? def.weapon ?? null) : (def.weapon ?? null);
  }

  /** The paint a fitted hull wears (null for one with nothing to paint), rendered in the paint worker. */
  private paintFor(def: VehicleDef, opts: BuildOptions): ShipPaint | null {
    if (!def.fit?.paint) return null;
    return new ShipPaint(def.fit.paint, `${this.baseUrl}assets-private/ships/`, { prepare: opts.prepare ?? noPrepare, forget: opts.forget ?? noForget, render: renderPaint });
  }

  /** A fitted part's model: loaded once per file, cloned (a skinned droid with its own skeleton), dry, and marked with its slot and hardpoint. */
  private async fitPart(def: VehicleDef, p: PlacedPart): Promise<THREE.Object3D> {
    const loaded = await this.model({ file: `assets-private/${p.path}` } as VehicleDef);
    const node = p.skinned ? cloneSkinned(loaded.scene) : loaded.scene.clone();
    if (def.kind === 'ship') markDry(node);
    const u = node.userData;
    u.attachment = 'component';
    u.slot = p.slot;
    u.hangsOn = p.hardpoint || null;
    u.fitPart = true;
    if (p.skinned) {
      // A droid in its socket stands in its skeleton's rest pose; its skinned mesh is no collider (its rest vertices are not where it is drawn).
      u.droid = true;
      node.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.userData.noCollider = true;
      });
    }
    return node;
  }

  /** A part def's model, as hangAttachments loads one (a ship's stay dry). */
  private partLoader(def: VehicleDef): (file: string) => Promise<THREE.Object3D> {
    return async (file) => {
      const part = (await this.model({ file } as VehicleDef)).scene.clone();
      if (def.kind === 'ship') markDry(part);
      return part;
    };
  }

  /**
   * Load placed parts and make each ready to hang: its model, its own children whose chain ends at it hung
   * on it (hangAttachments on the part), and each child it does not carry (no parent: the Y-wing engine's
   * "on" appearance on the hull's engine1) made into a pending part of its own, with its descendants, to be
   * hung by name over the whole ship after the parts. Any wing among them joins `wings`.
   */
  private async buildPlaced(def: VehicleDef, placed: PlacedPart[], wings: WingSet): Promise<{ parts: PendingPart[]; unresolved: string[]; hung: number }> {
    const load = this.partLoader(def);
    const withPack = (d: AttachmentDef): AttachmentDef => ({ ...d, file: `assets-private/${d.file}` });
    const loaded = await Promise.all(placed.map((p) => this.fitPart(def, p).then((node) => ({ node, error: null as unknown }), (error: unknown) => ({ node: null, error }))));
    const parts: PendingPart[] = [];
    const unresolved: string[] = [];
    let hung = 0;
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i];
      const label = `${p.slot} ${fileName(p.path)}`;
      const node = loaded[i].node;
      if (!node) {
        const err = loaded[i].error;
        unresolved.push(`${label}: did not load (${err instanceof Error ? err.message : String(err)})`);
        continue;
      }
      const { local, byName } = splitPartChildren(p.children ?? []);
      if (local.length) {
        const sub = await hangAttachments(node, local.map(withPack), load);
        for (const w of sub.wings.list) wings.add(w);
        unresolved.push(...sub.unresolved.map((u) => `${label}: ${u}`));
        hung += sub.hung;
      }
      parts.push({ node, slot: p.slot, hardpoint: p.hardpoint, label, key: p.path });
      for (const b of byName) {
        const made = await this.byNamePart(def, withPack(b.root), b.descendants.map(withPack), p.slot, load, wings);
        if (made.part) parts.push(made.part);
        unresolved.push(...made.unresolved.map((u) => `${label}: ${u}`));
        hung += made.hung;
      }
    }
    return { parts, unresolved, hung };
  }

  /** A child a part does not carry, made ready to hang by name: its model marked as hangAttachments marks one, at its place, with its own descendants hung on it. */
  private async byNamePart(def: VehicleDef, root: AttachmentDef, descendants: AttachmentDef[], slot: string, load: (file: string) => Promise<THREE.Object3D>, wings: WingSet): Promise<{ part: PendingPart | null; unresolved: string[]; hung: number }> {
    const label = `${root.kind} ${fileName(root.file)}`;
    let part: THREE.Object3D;
    try {
      part = await load(root.file);
    } catch (err) {
      return { part: null, unresolved: [`${label}: did not load (${err instanceof Error ? err.message : String(err)})`], hung: 0 };
    }
    const u = part.userData;
    u.attachment = root.kind;
    u.hangsOn = root.hardpoint ?? null;
    if (root.on) u.on = root.on;
    u.slot = slot;
    let top: THREE.Object3D = part;
    const place = root.place ?? null;
    if (root.kind === 'wing' && root.turn?.angle) {
      const pivot = new THREE.Group();
      pivot.name = 'wing:by-name';
      pivot.userData.wingPivot = true;
      pivot.add(part);
      const w: Wing = { pivot, angle: -THREE.MathUtils.degToRad(root.turn.angle), time: Number.isFinite(root.turn.time) && root.turn.time > 0 ? root.turn.time : 3, open: 0, label: fileName(root.file) };
      wings.add(w);
      top = pivot;
    }
    if (place) {
      const mount = new THREE.Group();
      mount.name = 'mount:by-name';
      mount.userData.mountOf = -1;
      applyPlace(mount, place);
      mount.add(top);
      top = mount;
    }
    let unresolved: string[] = [];
    let hung = 1;
    if (descendants.length) {
      const sub = await hangAttachments(part, descendants, load);
      for (const w of sub.wings.list) wings.add(w);
      unresolved = sub.unresolved;
      hung += sub.hung;
    }
    // Owned by its part: taken down with it (the same slot), hung again by name when a part it rides goes.
    // Hung by name after every fitted part is on (hangParts' second round).
    return { part: { node: top, slot, hardpoint: root.hardpoint ?? '', label: `${slot} ${label}`, key: `${root.file}|${place ? place.join(',') : ''}`, byName: true }, unresolved, hung };
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
    // A fitted ship is built from its fit (the stock one when none is given).
    const fit = def.fit ? (opts.fit ?? this.resolve(def, null)) : null;
    const a = await this.assemble(def, model, fit);
    // Its paint notes the meshes wearing a paint shader now; copies only come with custom paint.
    const paint = this.paintFor(def, opts);
    paint?.track(model);
    const bounds = this.frameModel(def, model);
    // How far the open wings reach under the closed belly, on the real vertices (a portal hull's rooms left out).
    const drop = a.wings.length ? wingDrop(model, a.wings, (o) => cellIndexOf(o) <= 0) : 0;
    const hardpoints: string[] = [];
    return this.finishSpawn(def, model, a, drop, bounds, hardpoints, loaded.animations, saddle, physics, scene, x, y, z, heading, kind, place, opts, fit, paint);
  }

  /**
   * A vehicle as a picture only, for another player's ride seen across the relay: the model with
   * its parts hung on it and framed as a spawned one is, its rooms hidden, with no physics. A custom
   * paint's copies ride on the holder's `userData.paint`, for whoever drops the picture to dispose.
   */
  async visual(def: VehicleDef, opts: BuildOptions = {}): Promise<THREE.Object3D> {
    const r = await this.visualParts(def, opts);
    if (r.paint) r.holder.userData.paint = r.paint;
    return r.holder;
  }

  /**
   * Another player's ride as a picture (`visual`), with its wings, which the relay's word moves
   * (RemotePlayers steps them), and what could not be hung; for a fitted ship also its build (for a
   * restage), its paint (the caller disposes it with the picture) and the fit it was built from.
   * Prepared (`opts.prepare`) and painted (`opts.fit`'s paint, waited for up to `opts.paintWait`) before
   * it is handed back, so it compiles nothing once shown.
   */
  async visualParts(def: VehicleDef, opts: BuildOptions = {}): Promise<{ holder: THREE.Object3D; wings: WingSet; unresolved: string[]; build: ShipBuild; paint: ShipPaint | null; fit: ResolvedFit | null }> {
    const [loaded, saddle] = await Promise.all([this.model(def), this.saddleFor(def)]);
    let skinned = false;
    loaded.scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
    });
    const model = skinned ? cloneSkinned(loaded.scene) : loaded.scene.clone();
    const fit = def.fit ? (opts.fit ?? this.resolve(def, null)) : null;
    const a = await this.assemble(def, model, fit);
    const paint = this.paintFor(def, opts);
    paint?.track(model);
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
    try {
      if (opts.prepare) await opts.prepare([holder]);
      if (paint && fit?.painted) await paint.apply(fit.paint, opts.paintWait ?? 3000);
    } catch (err) {
      paint?.dispose();
      throw err;
    }
    return { holder, wings: a.wings, unresolved: a.unresolved, build: a.build, paint, fit };
  }

  /**
   * Hang what the ship carries, before the hull is measured: every part under the node it names
   * (its parent part's hardpoint, or its origin at its place), a wing under a pivot that turns it,
   * so a part on a wing rides it (hangAttachments, shipAssembly.ts). The parts are part of the
   * ship's box and its collision, and their hardpoints (glows, muzzles) count with the hull's.
   *
   * A fitted ship (`def.fit` and a resolved `fit`) is hung in one tree with its fit's parts: the
   * manifest's tree without its stock components, without what they produced (`owner`) and without the
   * stand-in of a slot the fit fills, a def whose parent was left out becoming one hung by name after
   * the fit (fitTree, shipMounts.ts); then the fit's parts (partsOf) by hardpoint name over the ship
   * (hangParts, repeated passes, never at the origin), each with its own children (those it carries hung on
   * it; the rest by name, in hangParts' second round, after every fitted part is on); then the defs hung by
   * name; then a left-out stand-in again if no part of its slot hung after all. Every stand-in is recorded
   * in the build (`standIns`), so a refit takes it down or hangs it again as its slot fills or empties.
   */
  private async assemble(def: VehicleDef, model: THREE.Object3D, fit: ResolvedFit | null = null): Promise<Assembly & { build: ShipBuild }> {
    const build: ShipBuild = { root: model, fitParts: new Map(), pending: [] };
    const load = this.partLoader(def);
    const fitted = !!def.fit && !!fit;
    const defs = def.attachments ?? [];
    const placed = fitted ? partsOf(def.fit!, def.id, fit!, this.droids) : [];
    // The tree kept whole, and what hung on something left out (hung by name, after the fit's parts): fitTree.
    // Without a fit, the whole tree as it is (wave 3's path).
    const tree = fitted ? fitTree(defs, new Set(placed.map((p) => p.slot))) : null;
    const main = tree ? tree.main : [...defs];
    const retry = tree ? tree.retry : [];
    const a = await hangAttachments(model, main, load);
    const unresolved = [...a.unresolved];
    let hung = a.hung;
    if (fitted) {
      // The fit's parts, their own children, and the droid, hung by hardpoint name over the whole ship.
      const built = await this.buildPlaced(def, placed, a.wings);
      unresolved.push(...built.unresolved);
      hung += built.hung;
      const waiting = hangParts(model, built.parts);
      recordHung(build, built.parts, waiting);
      build.pending = waiting;
      hung += built.parts.length - waiting.length;
      for (const p of waiting) unresolved.push(`${p.label} waits for hardpoint ${p.hardpoint}, which nothing on the model carries`);
      if (retry.length) {
        const r = await hangAttachments(model, retry, load);
        unresolved.push(...r.unresolved);
        hung += r.hung;
        for (const w of r.wings.list) a.wings.add(w);
        // Each one hung by name is the ship's own, hung again wherever its hardpoint is when a part it rides goes.
        const shipNodes: PendingPart[] = [];
        retry.forEach((d, i) => {
          const part = r.parts[i];
          if (!part || d.parent !== undefined) return;
          let top = part;
          while (top.parent && top.parent !== model && (top.parent.userData.mountOf !== undefined || top.parent.userData.wingPivot === true)) top = top.parent;
          const pp: PendingPart = { node: top, slot: '', hardpoint: d.hardpoint ?? '', label: `${d.kind} ${fileName(d.file)}`, key: `${d.file}|${d.place ? d.place.join(',') : ''}`, byName: true };
          top.userData.fitPending = pp;
          top.userData.fitSlots = [''];
          shipNodes.push(pp);
        });
        recordHung(build, shipNodes, []);
      }
      // The stand-ins, recorded so a refit decides them again: one kept (its slot left empty) is on the model
      // already; one left out is hung after all when none of its slot's parts hung (its model failed, or its
      // hardpoint is missing), and otherwise waits unloaded until a refit may want it.
      const standIns: StandIn[] = [];
      const topOf = (node: THREE.Object3D): THREE.Object3D => {
        let top = node;
        while (top.parent && top.parent !== model && top.parent.userData.mountOf !== undefined) top = top.parent;
        return top;
      };
      for (const i of tree!.standIns) {
        const d = defs[i];
        const rec: StandIn = { standsFor: d.standInFor!, def: d, label: `${d.kind} ${fileName(d.file)}`, node: null, ready: false };
        standIns.push(rec);
        if (!tree!.dropped[i]) {
          const at = tree!.mainIndex.get(i);
          const node = at === undefined ? null : a.parts[at];
          if (node) {
            rec.node = topOf(node);
            rec.ready = true;
          }
          continue;
        }
        const hungFor = [...build.fitParts.keys()].some((s) => s === d.standInFor || s.startsWith(`${d.standInFor}_`));
        if (hungFor) continue;
        const s = await hangAttachments(model, [{ ...d, parent: d.parent === null ? null : undefined }], load);
        unresolved.push(...s.unresolved);
        hung += s.hung;
        if (s.parts[0]) {
          rec.node = topOf(s.parts[0]);
          rec.ready = true;
        }
      }
      build.standIns = standIns;
    }
    // A hull with more parts than the physics and the shadow pass want (the Star Destroyer's 207):
    // its parts are pictures only, culled one by one, casting nothing.
    if (hung > PART_LIMIT) {
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !partOf(o, model)) return;
        m.userData.noCollider = true;
        m.castShadow = false;
        m.frustumCulled = true;
      });
    }
    if (unresolved.length) console.warn(`garage: ${def.id}: left off: ${unresolved.join('; ')}`);
    return { wings: a.wings, parts: a.parts, unresolved, hung, build };
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

  private async finishSpawn(def: VehicleDef, model: THREE.Object3D, a: Assembly & { build: ShipBuild }, drop: number, bounds: VehicleSpec['bounds'], hardpoints: string[], animations: THREE.AnimationClip[], saddle: THREE.Object3D | null, physics: Physics, scene: THREE.Scene, x: number, y: number, z: number, heading: number, kind: VehicleKind, place?: (bounds: VehicleSpec['bounds']) => [number, number, number], opts: BuildOptions = {}, fit: ResolvedFit | null = null, paint: ShipPaint | null = null): Promise<Vehicle> {
    // Where the engines glow, by what the hardpoints are called, best first: the engine parts'
    // own glow points, the client data's thruster points, any exhaust, any numbered engine
    // (engineSpotsOf, the list a refit makes again). The nodes themselves: a glow hung on one rides
    // whatever carries it (an engine on a wing).
    const engines = engineSpotsOf(model, def.thrusters ?? []);
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
    const glow = def.source !== 'creature' ? makeEngineGlow(spec, model, engines) : null;
    try {
      // The whole assembly (parts, cockpit frame, glows, trails) joins the world's material schemes and is compiled
      // before the vehicle exists, so nothing compiles once it is shown.
      if (opts.prepare) {
        const began = performance.now();
        await opts.prepare([model, ...(glow?.trails.map((t) => t.mesh) ?? [])]);
        // A big hull (hundreds of drawables, rooms included) takes seconds to appear: said, so the wait is not a mystery.
        const took = performance.now() - began;
        if (took > 1000) console.info(`garage: ${def.id}: prepared in ${(took / 1000).toFixed(1)} s before it was shown`);
      }
      // A custom paint: the copies made, prepared and rendered (in the paint worker) before the ship is shown, 3 s at most.
      if (paint && fit?.painted) await paint.apply(fit.paint, opts.paintWait ?? 3000);
      // The world the spawn was asked for may have gone meanwhile (a travel): nothing is made for the next one.
      if (opts.alive && !opts.alive()) throw new SpawnCancelled(def.id);
    } catch (err) {
      paint?.dispose();
      if (glow) opts.forget?.([glow.mat, ...glow.trails.map((t) => t.mesh.material as THREE.Material)]);
      for (const t of glow?.trails ?? []) t.dispose(scene);
      glow?.mat.dispose();
      throw err;
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
    // The fit it was built from, its parts per slot (for a refit) and its paint.
    v.build = a.build;
    v.fit = fit;
    v.paint = paint;
    // The "on" appearances: an engine's while the drive runs, a booster's only while boosting.
    collectOnParts(v, model);
    if (glow) wireEngineGlow(v, glow);
    if (spec.ship) {
      // The guns are their muzzle nodes, read live at each shot (Vehicle.muzzle): a gun on a wing fires from where the
      // wing has turned it. The place and the way (in the vehicle's frame, wings closed) stay for the frame; a gun that
      // points nowhere useful (a hardpoint with no turn of its own) fires along the nose. A fitted ship's gun fires its
      // own slot's component, and a gun whose slot fires nothing (a launcher, countermeasures, empty) is left out.
      this.fitGuns(v, def, fit, collectMounts(model, v.group, def.thrusters ?? [], v.wings));
      v.boltColor = /(^|_)tie|imperial|lambda|star_destroyer|decimator/i.test(def.id) ? 0x3af06a : 0xff4a2a;
      if (v.guns.length) {
        const fires = [...new Set(v.guns.map((g) => g.weapon ?? v.weapon).filter((w): w is NonNullable<typeof w> => !!w).map((w) => `${w.name} (projectile ${w.projectile}${this.projectiles.has(w.projectile) ? '' : ', not in the pack: drawn as a blaster bolt'}, ${w.speed} m/s to ${w.range} m)`))];
        console.info(`garage: ${def.id} guns: ${v.guns.length}${fires.length ? `, firing ${fires.join('; ')}` : ', no weapon in the manifest: a blaster bolt'}`);
      }
    }
    if (a.hung || a.wings.length) {
      const hungParts = new Set([...a.parts.filter((p): p is THREE.Object3D => !!p), ...[...a.build.fitParts.values()].flat()]);
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
  // taken into the model's: the model only ever moves, never turns, when it is framed), on spot
  // nodes of their own (`userData.glowSpot`), so a refit finds them as it finds hardpoints.
  const at = spots.length ? spots : [];
  if (!at.length) {
    for (const x of w > 1.2 ? [-w * 0.28, w * 0.28] : [0]) {
      const spot = new THREE.Object3D();
      spot.name = 'glow spot';
      spot.userData.glowSpot = true;
      spot.position.set(x, b.min[1] + h * 0.45, b.min[2] - 0.05).sub(model.position);
      model.add(spot);
      at.push(spot);
    }
  }
  for (const spot of at) {
    const sp = new THREE.Sprite(mat);
    sp.scale.setScalar(0.2);
    spot.add(sp);
    sprites.push(sp);
  }
  // A ship's glow is sized by its hull's height, not its width: a fighter's wings make it wide, its engines are not.
  const size = ship ? Math.min(7, Math.max(0.5, h * 0.4)) : Math.min(1.6, 0.25 + w * 0.18);
  // A ship's exhaust leaves a ribbon behind it in flight, longer the faster it goes; each follows its glow wherever that is carried.
  const trails = ship ? sprites.map((sp) => new EngineTrail(color, sp)) : [];
  trails.forEach((t, i) => (sprites[i].userData.trail = t));
  return { mat, sprites, trails, size, color, spots: at };
}

/**
 * The glows made by makeEngineGlow, wired to the vehicle once it exists (synchronously: nothing is
 * awaited after `new Vehicle`): the glow state goes on the vehicle (`glows`, `glowMaterial`,
 * `glowSize`, `glowColor`), `rebindGlows` fills the heat haze's list and the trails (their ribbons
 * into the world), and the update scales the live glows, runs the trails and shows the "on"
 * appearances. The update reads the vehicle's state, not locals, so a refit's glows grow and fade
 * with the rest.
 */
function wireEngineGlow(v: Vehicle, glow: EngineGlow): void {
  v.glows = glow.sprites;
  v.glowMaterial = glow.mat;
  v.glowSize = glow.size;
  v.glowColor = glow.color;
  // The heat haze follows the same glows: each one's place, base size and its own noise offset.
  rebindGlows(v, glow.spots, null);
  const ship = !!v.spec.ship;
  const base = v.onUpdate;
  v.onUpdate = (dt, self, drive) => {
    base?.(dt, self, drive);
    const size = self.glowSize;
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
    // The live glows only (a refit's spare ones are parked, hidden).
    for (const e of self.engines) e.object.scale.set(k, k, 1);
    if (self.glowMaterial) self.glowMaterial.opacity = (ship ? 0.35 : 0.55) + 0.45 * Math.min(1, Math.abs(self.speed) / 8 + throttle);
  };
}

/** The "on" appearances of a model (an engine's while the drive runs, a booster's only while boosting), collected afresh (a refit brings its own). */
function collectOnParts(v: Vehicle, model: THREE.Object3D): void {
  v.engineParts.length = 0;
  v.boosterParts.length = 0;
  model.traverse((o) => {
    if (o.userData.attachment !== 'engine') return;
    o.visible = false;
    (o.userData.on === 'booster' ? v.boosterParts : v.engineParts).push(o);
  });
}

/** A part file's name, for the console. */
const fileName = (file: string): string => file.replace(/^.*[\\/]/, '');

/** A stand-in's model made ready to hang as hangAttachments would hang it: marked as a part of its kind, under a mount at its place when it has one. Returns the top node. */
function standInNode(d: AttachmentDef, part: THREE.Object3D): THREE.Object3D {
  const u = part.userData;
  u.attachment = d.kind;
  u.hangsOn = d.hardpoint ?? null;
  if (d.on) u.on = d.on;
  if (d.slot) u.slot = d.slot;
  if (!d.place) return part;
  const mount = new THREE.Group();
  mount.name = 'mount:stand-in';
  mount.userData.mountOf = -1;
  applyPlace(mount, d.place);
  mount.add(part);
  return mount;
}
/** No preparation or forgetting given (a picture made with no world). */
const noPrepare = (): Promise<void> => Promise.resolve();
const noForget = (): void => {};

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
