// The Force's waves stepped and their knock landed (the volumetrics pass's third wave, the owner's answer of 2026-10-24
// to the design's Q16): what the jedi kit runs every frame while a push, a pull or a repulse travels, out of `jedi.ts`
// so the node test drives the very loop the game runs (the kit's own file names modules node cannot load). Each body,
// vehicle and loose prop a wave's front reaches this step is knocked once, from where it stands then, by the arithmetic
// the instant knock knocks it with (`JediKit.shove`, `JediKit.repulse`: the damage, the direction from the wave's
// origin, the knock's speed by the distance); one that left the cone or outran the front before it arrived is missed.
//
// **Only when, never how hard**: the knock's lines here are the instant knock's own, which the test holds to the commit
// before the wave line for line. **Gameplay, never graphics**: nothing here reads a graphics setting.
import * as THREE from 'three';
import { strikeAs } from './strikeTag.ts';
import { shoveLooseProps } from '../world/looseProps.ts';
import { FRONT_KIND } from '../world/volumetrics/airMath.ts';
import { ForceWaves, type ForceWave } from './forceWave.ts';
import type { Living } from './kit.ts';

/** A vehicle as the knock reaches it: where it stands and its body to shove. */
export interface WaveVehicle {
  readonly pos: THREE.Vector3;
  readonly body: { mass(): number; applyImpulse(impulse: { x: number; y: number; z: number }, wake: boolean): void };
}

/** What a step reads of the frame: the kit's own context satisfies it. */
export interface WaveContext {
  readonly dt: number;
  readonly world: { targets(): Iterable<Living>; readonly playerTarget: Living; readonly vehicles: Iterable<WaveVehicle> };
  readonly player: { readonly mounted: unknown; readonly aboard: { readonly vehicle: unknown } | null };
}

const tmp2 = new THREE.Vector3();
/** A travelling wave's origin (the bodies' frame and the props'), and its aim, as vectors for the knock's own lines. */
const waveFrom = new THREE.Vector3();
const wavePropFrom = new THREE.Vector3();
const waveAim = new THREE.Vector3();

export class WaveKnock {
  readonly waves: ForceWaves;
  /** The wave the props' gate reads, and the gate itself (made once): whether the wave reaches a prop this step, each once. */
  private propWave: ForceWave | null = null;
  private readonly propGate = (x: number, y: number, z: number, key: object): boolean => {
    const w = this.propWave;
    if (!w || w.struck.has(key)) return false;
    const repulse = w.kind === FRONT_KIND.repulse;
    if (!this.waves.reaches(w, x, y, z, w.wx, w.wy, w.wz, repulse ? 10 : 16, !repulse)) return false;
    w.struck.add(key);
    return true;
  };

  // Written out rather than declared in the argument list: node's own type stripping, which runs the test, refuses a
  // parameter property.
  constructor(waves: ForceWaves) {
    this.waves = waves;
  }

  /**
   * Every wave a step on, and whatever its front reaches this step knocked once, from where it stands now: a body by the
   * very arithmetic `shove` and `repulse` knock it with, a vehicle by theirs, a loose prop by theirs. Steps on the
   * simulation's own `dt`, so it stands still behind a panel.
   */
  step(ctx: WaveContext): void {
    const { dt, player, world } = ctx;
    const W = this.waves;
    W.step(dt);
    for (const w of W.waves) {
      const repulse = w.kind === FRONT_KIND.repulse;
      const sign = w.kind === FRONT_KIND.pull ? -1 : 1;
      waveFrom.set(w.ox, w.oy, w.oz);
      for (const c of world.targets()) {
        if (c === world.playerTarget || c.dead || w.struck.has(c)) continue;
        if (!W.reaches(w, c.pos.x, c.pos.y, c.pos.z, w.ox, w.oy, w.oz, repulse ? 10 : 16, !repulse)) continue;
        w.struck.add(c);
        const d = w.d;
        tmp2.copy(c.pos).sub(waveFrom);
        if (repulse) {
          tmp2.setY(0).normalize();
          strikeAs('force', c, 25 * (1 - d / 12) + 5, waveFrom, 0, world.playerTarget);
          c.knock?.(tmp2, 26 * (1 - d / 12) + 8);
        } else {
          tmp2.normalize();
          strikeAs('force', c, sign > 0 ? 10 : 4, waveFrom, 0, world.playerTarget);
          // Pulled, it comes to the player's feet: the shove scales with how far it is.
          tmp2.multiplyScalar(sign);
          c.knock?.(tmp2, sign > 0 ? 22 * (1 - d / 18) + 6 : 4 + d * 1.1);
        }
      }
      for (const sp of world.vehicles) {
        if (sp === player.mounted || sp === player.aboard?.vehicle || w.struck.has(sp)) continue;
        if (!W.reaches(w, sp.pos.x, sp.pos.y, sp.pos.z, w.ox, w.oy, w.oz, repulse ? 10 : 12, false)) continue;
        w.struck.add(sp);
        const d = w.d;
        tmp2.copy(sp.pos).sub(waveFrom).normalize();
        const m = sp.body.mass();
        if (repulse) sp.body.applyImpulse({ x: tmp2.x * m * 10 * (1 - d / 12), y: m * 5, z: tmp2.z * m * 10 * (1 - d / 12) }, true);
        else {
          tmp2.multiplyScalar(sign);
          sp.body.applyImpulse({ x: tmp2.x * m * 9 * (1 - d / 14), y: m * 4, z: tmp2.z * m * 9 * (1 - d / 14) }, true);
        }
      }
      // The loose props, each the step the front reaches it (`propGate`), measured from the world's frame as before.
      this.propWave = w;
      wavePropFrom.set(w.wx, w.wy, w.wz);
      waveAim.set(w.ax, w.ay, w.az);
      if (repulse) shoveLooseProps(wavePropFrom, 10, 1, null, 20, this.propGate);
      else shoveLooseProps(wavePropFrom, 16, sign, waveAim, sign > 0 ? 18 : 10, this.propGate);
      this.propWave = null;
    }
    W.sweep();
  }
}
