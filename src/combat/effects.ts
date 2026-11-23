import * as THREE from 'three';
import { markActor } from '../world/portalRender';
import { luminance, pointIrradiance } from '../core/fx/bladeGlowMath.ts';
import { EYE_LIGHTS } from '../sky/eyeLights.ts';

type RingMesh = THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
type BurstMesh = THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
type TracerLine = THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
interface Ring { mesh: RingMesh; age: number; life: number; maxScale: number }
interface Tracer { line: TracerLine; age: number; life: number }
interface Flash { light: THREE.PointLight; age: number; life: number; intensity: number }

/** Point lights kept in the scene for the flashes, so the light count never changes (a change recompiles every material). */
const FLASH_POOL = 4;
/**
 * The most pooled lights held by lit blades at once (the sky and light fix round): the rest stay with shots, hits and a ship's
 * rooms. Three blades of four slots leaves one for a shot even with the orbiting pair and a fighter's blade lit.
 */
export const HOLD_MOST = 3;
/** A light the pool hands out that carries the eye's flag (WebGPU's `carriedLights.ts`): 1 a carried light, 0 one a room is lit by. */
interface CarriedFlag {
  carried: number;
}
/** A lit blade's wish for a held slot (`Effects.hold`): where, how strong (before the Blade light dial), how far. */
export interface HoldSpot {
  readonly pos: THREE.Vector3;
  intensity: number;
  distance: number;
}
interface Burst { mesh: BurstMesh; age: number; life: number; size: number }

/**
 * Short-lived visual effects: shock rings, blaster tracers, light flashes, impact bursts.
 *
 * The meshes and their materials are pooled and never disposed. A material made for each
 * spark and disposed after it would take its compiled shader program with it (three deletes a
 * program when the last material using it goes), and the next spark would compile it again:
 * a stall on every first shot after a quiet moment.
 */
export class Effects {
  private readonly rings: Ring[] = [];
  private readonly tracers: Tracer[] = [];
  private readonly flashes: Flash[] = [];
  private readonly bursts: Burst[] = [];
  private readonly ringGeo = new THREE.RingGeometry(0.6, 1, 32).rotateX(-Math.PI / 2);
  private readonly burstGeo = new THREE.SphereGeometry(1, 8, 6);
  private readonly ringPool: RingMesh[] = [];
  private readonly burstPool: BurstMesh[] = [];
  private readonly tracerPool: TracerLine[] = [];

  private readonly lights: THREE.PointLight[] = [];
  /**
   * The sky and light fix round: the flashes now lighting are `flashes`' first `flashN` records, oldest asked first, the rest
   * kept for the next (one a light, made with the pool): a flash moves records about and never makes one, nor grows or empties
   * the list (an array emptied by `splice` or `length` gives its store back, and the next `push` makes another, about 80 bytes
   * a flash).
   */
  private flashN = 0;
  /**
   * The sky and light fix round: whether the pool's lights carry the eye's flag (made by WebGPU's `carriedLights.ts`, handed in
   * as `makeLight`); with the plain lights of WebGL no flag is written.
   */
  private readonly carry: boolean;
  /** Each slot's hold: the frame count it was last held on (-1 never), and the frame the pool is in (moved by `update`). */
  private readonly heldOn = new Int32Array(FLASH_POOL).fill(-1);
  /** The slot each hold of this frame's order took last frame (-1 none), so a blade keeps its light from frame to frame. */
  private readonly holdSlot = new Int32Array(HOLD_MOST).fill(-1);
  private holdsNow = 0;
  private frameNo = 0;

  /** The flash lights, for the effects' light estimate; never add or remove them. */
  get lightPool(): readonly THREE.PointLight[] {
    return this.lights;
  }

  private readonly scene: THREE.Scene;

  /**
   * `makeLight` is the pool's light (the sky and light fix round: on WebGPU a point light whose node carries the eye's flag,
   * `GPU.rt.carried.point`); without it a plain `PointLight`, as ever.
   */
  constructor(scene: THREE.Scene, makeLight: (() => THREE.PointLight) | null = null) {
    this.scene = scene;
    this.carry = makeLight !== null;
    for (let i = 0; i < FLASH_POOL; i++) {
      // Always in the scene and always visible: three.js counts the visible lights when it
      // compiles a material, so a light that comes and goes recompiles everything each time.
      const light = makeLight ? makeLight() : new THREE.PointLight(0xffffff, 0, 1);
      if (makeLight) {
        light.color.setHex(0xffffff);
        light.intensity = 0;
        light.distance = 1;
      }
      scene.add(light);
      markActor(light);
      this.lights.push(light);
      // A flash record for each light, its numbers begun as fractions (a field that will hold one starts as one).
      this.flashes.push({ light, age: 0.5, life: 0.5, intensity: 0.5 });
    }
  }

  /** The live flash at `i` let go: the later ones moved down in order (as `splice` would), its record kept past the live ones. */
  private dropFlash(i: number): void {
    const flashes = this.flashes;
    const n = this.flashN - 1;
    const r = flashes[i];
    for (let j = i; j < n; j++) flashes[j] = flashes[j + 1];
    flashes[n] = r;
    this.flashN = n;
  }

  ring(pos: THREE.Vector3, color: number, maxScale: number, life: number): void {
    let mesh = this.ringPool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      markActor(mesh);
    }
    mesh.material.color.set(color);
    mesh.material.opacity = 0.8;
    mesh.scale.set(0.3, 1, 0.3);
    mesh.position.copy(pos).y += 0.08;
    this.scene.add(mesh);
    this.rings.push({ mesh, age: 0, life, maxScale });
  }

  tracer(a: THREE.Vector3, b: THREE.Vector3, color: number, life = 0.07): void {
    let line = this.tracerPool.pop();
    if (!line) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, toneMapped: false }));
      line.frustumCulled = false;
      markActor(line);
    }
    const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, a.x, a.y, a.z);
    pos.setXYZ(1, b.x, b.y, b.z);
    pos.needsUpdate = true;
    line.material.color.set(color);
    line.material.opacity = 1;
    this.scene.add(line);
    this.tracers.push({ line, age: 0, life });
  }

  /**
   * A short light: the pool's first light neither held by a blade this frame nor holding a flash, else the one whose flash is
   * oldest (a held light is never taken). `carried` (the sky and light fix round) is the eye's flag where the pool's lights
   * carry one: true for a shot, a hit, a power, a glow; false for a light a room is lit by (a ship's rooms), which the eye's
   * Carried lights dial leaves alone. Nothing is made once the pool has been full once.
   */
  flash(pos: THREE.Vector3, color: number, intensity: number, distance: number, life: number, carried = true): void {
    const lights = this.lights;
    const flashes = this.flashes;
    let light: THREE.PointLight | null = null;
    for (let i = 0; i < lights.length && light === null; i++) {
      // A slot a blade holds (this frame, or last frame and not yet let go) is never a flash's: no flash ever stands on one.
      if (this.heldOn[i] >= 0) continue;
      const l = lights[i];
      let busy = false;
      for (let j = 0; j < this.flashN; j++) if (flashes[j].light === l) busy = true;
      if (!busy) light = l;
    }
    if (light === null) {
      let oldest = -1;
      for (let i = 0; i < this.flashN; i++) {
        const f = flashes[i];
        if (oldest >= 0 && !(f.age / f.life > flashes[oldest].age / flashes[oldest].life)) continue;
        oldest = i;
      }
      // Every slot is held by a blade (more than the pool's share can only be asked for in a scratch test): nothing to light.
      if (oldest < 0) return;
      light = flashes[oldest].light;
      this.dropFlash(oldest);
    }
    light.color.set(color);
    light.intensity = intensity;
    light.distance = distance;
    light.position.copy(pos);
    if (this.carry) (light as unknown as CarriedFlag).carried = carried ? 1 : 0;
    // A record past the live ones (each live flash holds a light of its own, and this light holds none now, so one is free).
    const f = flashes[this.flashN];
    f.light = light;
    f.age = 0;
    f.life = life;
    f.intensity = intensity;
    this.flashN++;
  }

  /**
   * A lit blade's light for this frame (the sky and light fix round): one pooled slot per lit blade, written in place each
   * frame at the intensity asked, so the light is the same at any frame rate (a 0.08 s flash asked every frame stacked four
   * flashes deep: about 1.9 times the asked light at 60 frames a second, 0.75 at 30 and 3.1 at 144) and the rest of the pool
   * stays with shots and hits. The blades are held in the same order each frame, so each keeps its slot; at most `HOLD_MOST`
   * are held, and a slot a blade let go is dark from the frame's end (`update`). A slot is taken from a flash only when no
   * other is free. Carried (the eye's flag) where the pool's lights carry one. The blade's place, light and reach are read off
   * its kept record (a number handed across a call is a number made), its light times the `exposure` set's Blade light dial
   * (`EYE_LIGHTS.blade`). Returns whether a slot was held.
   */
  hold(spot: HoldSpot, color: number): boolean {
    const k = this.holdsNow;
    if (k >= HOLD_MOST) return false;
    const now = this.frameNo;
    const lights = this.lights;
    const flashes = this.flashes;
    let slot = this.holdSlot[k];
    // Last frame's slot, unless another hold of this frame has it (the order moved).
    if (slot >= 0 && this.heldOn[slot] === now) slot = -1;
    if (slot < 0) {
      // A slot nobody holds and no flash lights, else one a blade held last frame and has not held again yet (the order of
      // the blades moved), else the oldest flash's.
      for (let i = 0; i < lights.length && slot < 0; i++) {
        if (this.heldOn[i] >= 0) continue;
        let busy = false;
        for (let j = 0; j < this.flashN; j++) if (flashes[j].light === lights[i]) busy = true;
        if (!busy) slot = i;
      }
      for (let i = 0; i < lights.length && slot < 0; i++) if (this.heldOn[i] >= 0 && this.heldOn[i] !== now) slot = i;
      if (slot < 0) {
        let oldest = -1;
        for (let i = 0; i < this.flashN; i++) {
          const f = flashes[i];
          if (oldest >= 0 && !(f.age / f.life > flashes[oldest].age / flashes[oldest].life)) continue;
          oldest = i;
        }
        if (oldest < 0) return false;
        const l = flashes[oldest].light;
        for (let i = 0; i < lights.length; i++) if (lights[i] === l) slot = i;
      }
    }
    // The slot's flash, if it held one, is let go: the blade's light stands in its place.
    for (let j = this.flashN - 1; j >= 0; j--) if (flashes[j].light === lights[slot]) this.dropFlash(j);
    const light = lights[slot];
    light.color.set(color);
    light.intensity = spot.intensity * EYE_LIGHTS.blade;
    light.distance = spot.distance;
    light.position.copy(spot.pos);
    if (this.carry) (light as unknown as CarriedFlag).carried = 1;
    this.heldOn[slot] = now;
    this.holdSlot[k] = slot;
    this.holdsNow = k + 1;
    return true;
  }

  /** How many slots lit blades hold this frame (the console's and the test's). */
  get heldNow(): number {
    return this.holdsNow;
  }

  /**
   * Irradiance luminance at a point from the pooled lights now lit, each taken no nearer than
   * `reach` short of it: part of the brightest a surface near a lit blade can be from other lights.
   */
  litIrradianceNear(p: THREE.Vector3, reach: number): number {
    let e = 0;
    for (const l of this.lights) {
      if (l.intensity <= 0) continue;
      e += pointIrradiance(luminance(l.color.r, l.color.g, l.color.b), l.intensity, l.position.distanceTo(p), reach, l.decay);
    }
    return e;
  }

  /** For the console: each pooled light's colour, intensity, and the age of the flash holding it (null when free). Allocates. */
  poolState(): { color: string; intensity: number; age: number | null; held: boolean; carried: number | null }[] {
    return this.lights.map((l, i) => {
      const f = this.flashes.slice(0, this.flashN).find((x) => x.light === l);
      const c = (l as unknown as Partial<CarriedFlag>).carried;
      return { color: `#${l.color.getHexString()}`, intensity: Number(l.intensity.toFixed(2)), age: f ? Number(f.age.toFixed(3)) : null, held: this.heldOn[i] >= 0, carried: typeof c === 'number' ? c : null };
    });
  }

  burst(pos: THREE.Vector3, color: number, size: number, life: number): void {
    let mesh = this.burstPool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(this.burstGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      markActor(mesh);
    }
    mesh.material.color.set(color);
    mesh.material.opacity = 0.9;
    mesh.scale.setScalar(size * 0.2);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.bursts.push({ mesh, age: 0, life, size });
  }

  /**
   * Bursts still bright (their first half: opacity fades from 0.9), for the depth of field's glow
   * depth; a faded sphere listed would leave a sharp disc of background. Fills `out` from `n`.
   */
  glowMeshes(out: THREE.Object3D[], n: number): number {
    for (const b of this.bursts) if (b.mesh.material.opacity > 0.45) out[n++] = b.mesh;
    return n;
  }

  /**
   * One of each effect far below the world for a moment: their shaders compile with the first
   * draw, which the loading screen hides, rather than with the first shot or the first hit.
   */
  warmUp(): void {
    const at = new THREE.Vector3(0, -900, 0);
    this.ring(at, 0xffa050, 1, 0.5);
    this.tracer(at, at.clone().setY(-899), 0xff6a3a, 0.5);
    this.burst(at, 0xffc080, 1, 0.5);
  }

  update(dt: number): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        this.scene.remove(r.mesh);
        this.ringPool.push(r.mesh);
        this.rings.splice(i, 1);
        continue;
      }
      const s = 0.3 + r.maxScale * Math.sqrt(t);
      r.mesh.scale.set(s, 1, s);
      r.mesh.material.opacity = 0.8 * (1 - t);
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.age += dt;
      const t = tr.age / tr.life;
      if (t >= 1) {
        this.scene.remove(tr.line);
        this.tracerPool.push(tr.line);
        this.tracers.splice(i, 1);
        continue;
      }
      tr.line.material.opacity = 1 - t;
    }
    for (let i = this.flashN - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.age += dt;
      const t = f.age / f.life;
      if (t >= 1) {
        f.light.intensity = 0;
        this.dropFlash(i);
        continue;
      }
      f.light.intensity = f.intensity * (1 - t);
    }
    // The frame's end for the blades' holds (the sky and light fix round): a slot no blade held this frame goes dark and free,
    // and a hold of this frame's order not asked for forgets its slot.
    const now = this.frameNo;
    for (let i = 0; i < this.heldOn.length; i++) {
      if (this.heldOn[i] < 0 || this.heldOn[i] === now) continue;
      this.heldOn[i] = -1;
      this.lights[i].intensity = 0;
    }
    for (let k = this.holdsNow; k < this.holdSlot.length; k++) this.holdSlot[k] = -1;
    this.holdsNow = 0;
    this.frameNo = now + 1;
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += dt;
      const t = b.age / b.life;
      if (t >= 1) {
        this.scene.remove(b.mesh);
        this.burstPool.push(b.mesh);
        this.bursts.splice(i, 1);
        continue;
      }
      b.mesh.scale.setScalar(b.size * (0.2 + 0.8 * Math.sqrt(t)));
      b.mesh.material.opacity = 0.9 * (1 - t);
    }
  }
}
