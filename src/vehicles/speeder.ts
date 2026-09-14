// The placeholder speeder bike: the stand-in model the game spawns beside you on every world, as
// a speeder-bike vehicle. The rack of real vehicles lives in the garage (B).
import * as THREE from 'three';
import type { Physics } from '../core/physics';
import { Vehicle, specFor, type DriveInput } from './vehicle';

export type { DriveInput };
export type Speeder = Vehicle;

/** The stand-in bike: a hull, a nose, a seat, two vanes and two engines with glowing discs. */
export function placeholderBike(): { model: THREE.Group; glows: THREE.Mesh[] } {
  const model = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0xb35a2a, roughness: 0.6, metalness: 0.3, flatShading: true });
  const metal = new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.5, metalness: 0.7, flatShading: true });
  const glow = new THREE.MeshBasicMaterial({ color: 0x4fd0ff, toneMapped: false });
  const main = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 2.6), hull);
  main.position.y = 0.5;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.2, 6).rotateX(Math.PI / 2), hull);
  nose.position.set(0, 0.5, 1.9);
  const seatMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.9), metal);
  seatMesh.position.set(0, 0.8, -0.4);
  const bars = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.06), metal);
  bars.position.set(0, 0.95, 0.5);
  model.add(main, nose, seatMesh, bars);
  const glows: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const vane = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.07, 0.5), hull);
    vane.position.set(sx * 0.75, 0.42, 1.4);
    vane.rotation.z = sx * 0.15;
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.9, 8).rotateX(Math.PI / 2), metal);
    engine.position.set(sx * 0.38, 0.45, -1.55);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.17, 12), glow);
    disc.position.set(sx * 0.38, 0.45, -2.01);
    disc.rotation.y = Math.PI;
    model.add(vane, engine, disc);
    glows.push(disc);
  }
  model.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return { model, glows };
}

/** The placeholder bike as a vehicle, with the handling of a speeder bike and its seat where it was. */
export function createPlaceholderSpeeder(physics: Physics, scene: THREE.Scene, x: number, y: number, z: number, heading: number): Vehicle {
  const { model, glows } = placeholderBike();
  const spec = specFor('speederbike', 'placeholder_speeder', 'Placeholder speeder', { min: [-0.55, 0.1, -1.5], max: [0.55, 0.8, 1.5] });
  spec.seat = [0, 0.86, -0.35];
  const v = new Vehicle(spec, model, physics, scene, x, y, z, heading);
  v.onUpdate = (_dt, self) => {
    const glowScale = 0.6 + Math.min(1, Math.abs(self.speed) / 20) * 0.8 + (self.boosting ? 0.4 : 0);
    for (const gl of glows) gl.scale.setScalar(glowScale);
  };
  return v;
}
