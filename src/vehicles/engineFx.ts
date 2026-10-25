// The smoke and fire at a race-driven hull's damaged engines (the design's §7.3): one standing effect a side, at that
// side's rearmost glow point, lit while the side's worst part is in a damage band -- light smoke, burning (or any part on
// fire), heavy smoke -- and changed or put out as the band moves. The three effects are the ships pack's own thruster
// damage files, already converted for the ships, played through the session's ship effects (`World.shipFx`); they are
// made ready behind the first loading screen (`prepare`), so the first fire builds nothing, and a pack without them
// places nothing and says so once in the console.
//
// A band's effect stands where it is lit and follows its point every frame; one put out makes nothing more and is taken
// away once what it made has died away, still riding its point. Nothing is allocated in a frame but a vehicle's first
// record, made the first frame it races.
import * as THREE from 'three';
import { ENGINE_TUNE, sideBand, type EngineSet } from './drivetrain.ts';
import { AIR_TUNE } from '../world/volumetrics/airTune.ts';

/** The sphere a damaged side's smoke is laid over in the moving air, metres [ours: an engine's own size]. */
const ENGINE_SMOKE_RADIUS = 1.2;

/** The three bands' effects, relative to the ships pack: light smoke, burning, heavy smoke. */
export const ENGINE_FX_FILES: readonly string[] = ['particles/fx_pt_smoking_thruster_light.json', 'particles/fx_pt_burning_thruster_2.json', 'particles/fx_pt_smoking_thruster_heavy.json'];

/** A placed effect, as the ship effects hand one back. */
export interface EngineFxHandle {
  rateScale: number;
}

/** What the engines' effects need of the ship effects (`ParticleEffects`): satisfied structurally, so a test can stand in. */
export interface EngineFxHost {
  prepare(file: string, renderer?: THREE.WebGLRenderer | null): Promise<boolean>;
  place(file: string, matrix: THREE.Matrix4, contained: boolean, transient?: boolean): EngineFxHandle;
  move(handle: EngineFxHandle, matrix: THREE.Matrix4): void;
  remove(handle: EngineFxHandle): void;
  particlesOf(handle: EngineFxHandle): number;
}

/** What it reads of a vehicle: the race drive's engines, whether it races now, its group and its glows. */
export interface EngineFxVehicle {
  readonly group: THREE.Object3D;
  readonly disposed: boolean;
  readonly destroyed: boolean;
  readonly spec: { readonly bounds: { readonly min: readonly number[]; readonly max: readonly number[] } };
  readonly engines: readonly { readonly object: THREE.Object3D }[];
  readonly race: { readonly engines: EngineSet; readonly active: boolean } | null;
}

/** One side of a vehicle: the band showing, its effect, and the point it stands at (a glow's spot, else the group at an offset). */
interface Side {
  band: number;
  handle: EngineFxHandle | null;
  node: THREE.Object3D | null;
  readonly offset: THREE.Vector3;
}

interface Rec {
  v: EngineFxVehicle;
  seen: number;
  sides: Side[];
}

const at = new THREE.Vector3();
const m4 = new THREE.Matrix4();

export class EngineFx {
  private host: EngineFxHost | null = null;
  /** Which of the three files loaded (null: not asked yet). */
  private ready: boolean[] | null = null;
  private preparing: Promise<void> | null = null;
  private said = false;
  private readonly recs = new Map<object, Rec>();
  private readonly live: Rec[] = [];
  private readonly dying: { handle: EngineFxHandle; node: THREE.Object3D; offset: THREE.Vector3 }[] = [];
  private pass = 0;
  /** Effects lit, ever, and how many are standing now: for the console. */
  readonly counts = { lit: 0, out: 0 };
  /**
   * Where a damaged side's smoke goes into the moving air beside the effect (the volumetrics' third wave, `World.air`'s
   * `smoke`; null for none): called every frame a side shows a band, at the side's point, at `smoke.burning` times the
   * band's share, grey. Cosmetic.
   */
  smokeSink: ((x: number, y: number, z: number, radius: number, rate: number, colour: number) => void) | null = null;

  /** The ship effects to play through (the session's, `World.shipFx`). */
  attach(host: EngineFxHost | null): void {
    this.host = host;
  }

  /**
   * The three effects made ready (their batches made hidden, their textures uploaded), once a session: behind the first
   * loading screen, before its compile. A file that does not load is left out and said once.
   */
  prepare(renderer: THREE.WebGLRenderer | null): Promise<void> {
    const host = this.host;
    if (!host || this.ready) return this.preparing ?? Promise.resolve();
    this.preparing ??= Promise.all(ENGINE_FX_FILES.map((f) => host.prepare(f, renderer).catch(() => false))).then((ok) => {
      this.ready = ok;
      const missing = ENGINE_FX_FILES.filter((_f, i) => !ok[i]);
      if (missing.length && !this.said) {
        this.said = true;
        console.info(`engines: the ships pack has no ${missing.join(', ')}: a damaged engine shows no smoke or fire there (convert the ships to have them)`);
      }
    });
    return this.preparing;
  }

  /** Whether the band's effect loaded. */
  private has(band: number): boolean {
    return !!this.ready?.[band - 1];
  }

  /**
   * Every race-driven hull's bands this frame: the effect of each side's band lit, changed or put out, every standing
   * one moved to its point, and the records of vehicles gone dropped with their effects.
   */
  update(vehicles: readonly EngineFxVehicle[]): void {
    const host = this.host;
    this.pass++;
    if (host && this.ready) {
      for (let i = 0; i < vehicles.length; i++) {
        const v = vehicles[i];
        const race = v.race;
        if (!race || v.disposed || v.destroyed) continue;
        let rec = this.recs.get(v as object);
        if (!rec) {
          // A hull whose engines are whole has nothing to show and no record yet.
          if (!race.active || (race.engines.mean <= 0 && race.engines.burnBits === 0)) continue;
          rec = this.recOf(v);
        }
        rec.seen = this.pass;
        const e = race.engines;
        for (let s = 0; s < rec.sides.length; s++) {
          const side = rec.sides[s];
          const want = race.active ? sideBand(e, s, ENGINE_TUNE) : 0;
          if (want !== side.band) {
            this.putOut(side);
            side.band = want;
            if (want > 0 && this.has(want)) {
              this.place(side);
              side.handle = host.place(ENGINE_FX_FILES[want - 1], m4, false, false);
              this.counts.lit++;
            }
          } else if (side.handle) {
            this.place(side);
            host.move(side.handle, m4);
          }
          // The band's smoke into the moving air beside the effect: light smoke a half, burning one, heavy smoke one and a
          // half of `smoke.burning`, the heavier the darker.
          const sink = this.smokeSink;
          if (sink && side.band > 0) {
            if (!side.handle) this.place(side);
            const share = side.band === 1 ? 0.5 : side.band === 2 ? 1 : 1.5;
            sink(at.x, at.y, at.z, ENGINE_SMOKE_RADIUS, AIR_TUNE.smoke.burning * share, side.band === 3 ? 0x2e2c2a : 0x55524e);
          }
        }
      }
    }
    // Vehicles gone: their effects out where they stand.
    for (let i = this.live.length - 1; i >= 0; i--) {
      const rec = this.live[i];
      if (rec.seen === this.pass && !rec.v.disposed) continue;
      for (const side of rec.sides) this.putOut(side);
      this.recs.delete(rec.v as object);
      this.live[i] = this.live[this.live.length - 1];
      this.live.length--;
    }
    this.sweep();
  }

  /** A vehicle's record: each side's point, the rearmost of that side's glows in its own frame (left +x), else its box's rear. */
  private recOf(v: EngineFxVehicle): Rec {
    const sides: Side[] = [];
    const n = v.race!.engines.sides;
    const b = v.spec.bounds;
    v.group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(v.group.matrixWorld).invert();
    for (let s = 0; s < n; s++) {
      let node: THREE.Object3D | null = null;
      let rear = Infinity;
      for (const g of v.engines) {
        const spot = g.object.parent;
        if (!spot) continue;
        spot.getWorldPosition(at).applyMatrix4(inv);
        const side = n === 1 ? 0 : at.x >= 0 ? 0 : 1;
        if (side !== s || at.z >= rear) continue;
        rear = at.z;
        node = spot;
      }
      const offset = new THREE.Vector3();
      if (!node) {
        // No glow on this side: its box's rear, a quarter of the width out to the side.
        const w = Math.abs(b.max[0] - b.min[0]);
        offset.set(n === 1 ? 0 : (s === 0 ? 1 : -1) * w * 0.28, Math.min(b.min[1], b.max[1]) + Math.abs(b.max[1] - b.min[1]) * 0.45, Math.min(b.min[2], b.max[2]));
        node = v.group;
      }
      sides.push({ band: 0, handle: null, node, offset });
    }
    const rec: Rec = { v, seen: this.pass, sides };
    this.recs.set(v as object, rec);
    this.live.push(rec);
    return rec;
  }

  /**
   * The side's place in the world into the scratch matrix: its point, turned as the vehicle is. Its world matrix is
   * worked out afresh first (its parents' and its own, nothing below and nothing made): the drive wrote the hull's place
   * this step and three works matrices out only as it draws, so read as it stood the effect was a frame's travel behind
   * the engine drawn, five metres at a racing pod's speed.
   */
  private place(side: Side): void {
    const node = side.node!;
    node.updateWorldMatrix(true, false);
    at.copy(side.offset).applyMatrix4(node.matrixWorld);
    m4.copy(node.matrixWorld);
    m4.setPosition(at);
  }

  /** A side's effect put out: it makes nothing more and is swept away once what it made has died. */
  private putOut(side: Side): void {
    if (!side.handle) return;
    side.handle.rateScale = 0;
    this.dying.push({ handle: side.handle, node: side.node!, offset: side.offset });
    side.handle = null;
    this.counts.out++;
  }

  /** The effects put out, moved with their points until nothing they made is left, then taken away. */
  private sweep(): void {
    const host = this.host;
    if (!host) return;
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      if (host.particlesOf(d.handle) === 0) {
        host.remove(d.handle);
        this.dying[i] = this.dying[this.dying.length - 1];
        this.dying.length--;
        continue;
      }
      d.node.updateWorldMatrix(true, false);
      at.copy(d.offset).applyMatrix4(d.node.matrixWorld);
      m4.copy(d.node.matrixWorld);
      m4.setPosition(at);
      host.move(d.handle, m4);
    }
  }

  /** Every effect taken away at once (a world unload, the select screen). */
  clear(): void {
    const host = this.host;
    for (const rec of this.live) for (const side of rec.sides) if (side.handle) host?.remove(side.handle);
    for (const d of this.dying) host?.remove(d.handle);
    this.dying.length = 0;
    this.live.length = 0;
    this.recs.clear();
  }

  /** What stands at a vehicle's engines now, for the console. */
  report(v: object | null): Record<string, unknown> {
    const rec = v ? this.recs.get(v) : undefined;
    const names = ['none', 'light smoke', 'burning', 'heavy smoke'];
    return {
      prepared: this.ready ? ENGINE_FX_FILES.map((f, i) => `${f.replace(/^.*\//, '')}: ${this.ready![i] ? 'ready' : 'not in the pack'}`) : 'not yet',
      sides: rec ? rec.sides.map((s) => ({ band: names[s.band] ?? s.band, standing: !!s.handle, at: s.node === (rec.v.group as THREE.Object3D) ? 'its box\'s rear' : String(s.node?.userData?.name ?? '') || s.node?.name || 'a glow point' })) : 'nothing damaged yet',
      dying: this.dying.length,
      counts: { ...this.counts },
    };
  }
}
