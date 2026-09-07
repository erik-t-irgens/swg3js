import * as THREE from 'three';
import type { Input } from './input';
import type { Collider } from '../world/props';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** SWG-style free-orbit third-person camera. */
export class ThirdPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = Math.PI;
  pitch = 0.32;
  distance = 7;
  private readonly focus = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 9000);
  }

  /** Horizontal forward direction (from camera toward the player). */
  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  right(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  update(
    input: Input,
    target: THREE.Vector3,
    heightAt: (x: number, z: number) => number,
    blockers: (x: number, z: number, radius: number) => Collider[],
  ): void {
    if (input.locked) {
      this.yaw -= input.mouseDX * 0.0025;
      this.pitch = clamp(this.pitch + input.mouseDY * 0.0025, -0.35, 1.35);
    }
    this.distance = clamp(this.distance + input.wheel * 0.9, 1.5, 24);

    this.focus.copy(target).y += 1.6;
    const cp = Math.cos(this.pitch);
    this.desired.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp)
      .multiplyScalar(this.distance)
      .add(this.focus);
    // Step the camera toward the player until it is clear of terrain and props.
    let dist = this.distance;
    for (let i = 0; i < 24 && dist > 1.2; i++) {
      const ground = heightAt(this.desired.x, this.desired.z) + 0.7;
      let blocked = this.desired.y < ground;
      if (!blocked) {
        for (const c of blockers(this.desired.x, this.desired.z, 0.8)) {
          if (this.desired.y < c.top && Math.hypot(c.x - this.desired.x, c.z - this.desired.z) < c.r + 0.8) {
            blocked = true;
            break;
          }
        }
      }
      if (!blocked) break;
      dist -= 0.6;
      this.desired.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp)
        .multiplyScalar(Math.max(dist, 1.2))
        .add(this.focus);
    }
    const ground = heightAt(this.desired.x, this.desired.z) + 0.7;
    if (this.desired.y < ground) this.desired.y = ground;
    this.camera.position.copy(this.desired);
    this.camera.lookAt(this.focus);
  }
}
