import * as THREE from 'three';
import type { ThirdPersonCamera } from '../core/camera';
import type { Input } from '../core/input';
import type { Player } from '../player/player';
import type { World } from '../world/world';

export interface PowerDef {
  key: string;
  code: string;
  name: string;
  cost: string;
}

export const POWERS: PowerDef[] = [
  { key: '1', code: 'Digit1', name: 'Force Jump', cost: '20' },
  { key: '2', code: 'Digit2', name: 'Force Speed', cost: '6/s' },
  { key: '3', code: 'Digit3', name: 'Force Push', cost: '25' },
  { key: '4', code: 'Digit4', name: 'Force Lightning', cost: '18/s' },
];

interface Ring {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  age: number;
  life: number;
  maxScale: number;
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const LIGHTNING_SEGMENTS = 14;

export class ForcePowers {
  force = 100;
  readonly maxForce = 100;
  speedActive = false;
  lightningActive = false;
  private readonly rings: Ring[] = [];
  private readonly ringGeo = new THREE.RingGeometry(0.6, 1, 32).rotateX(-Math.PI / 2);
  private readonly aura: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly bolt: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly boltPositions = new Float32Array((LIGHTNING_SEGMENTS + 1) * 3);
  private readonly boltLight = new THREE.PointLight(0x9fd4ff, 0, 18);
  private time = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.aura = new THREE.Mesh(
      new THREE.SphereGeometry(1.3, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x5fb8ff, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.aura.visible = false;
    scene.add(this.aura);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.boltPositions, 3));
    this.bolt = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xbfe6ff, toneMapped: false }));
    this.bolt.visible = false;
    this.bolt.frustumCulled = false;
    scene.add(this.bolt, this.boltLight);
  }

  private spawnRing(pos: THREE.Vector3, color: number, maxScale: number, life: number): void {
    const mesh = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    mesh.position.copy(pos).y += 0.08;
    this.scene.add(mesh);
    this.rings.push({ mesh, age: 0, life, maxScale });
  }

  update(dt: number, input: Input, player: Player, world: World, cam: ThirdPersonCamera): void {
    this.time += dt;
    const planet = world.planet;

    // 1: Force Jump
    if (input.justPressed('Digit1') && player.grounded && !player.swimming && this.force >= 20) {
      this.force -= 20;
      const vy = Math.sqrt(2 * planet.gravity * 11);
      player.launch(vy, 9, cam);
      this.spawnRing(player.pos, 0x9fd4ff, 5, 0.5);
    }

    // 2: Force Speed (toggle)
    if (input.justPressed('Digit2')) {
      if (this.speedActive) this.speedActive = false;
      else if (this.force >= 10) this.speedActive = true;
    }
    if (this.speedActive) {
      this.force -= 6 * dt;
      if (this.force <= 0) this.speedActive = false;
    }
    player.speedMultiplier = this.speedActive ? 2.1 : 1;
    this.aura.visible = this.speedActive;
    if (this.speedActive) {
      this.aura.position.copy(player.pos).y += 1;
      const s = 1 + Math.sin(this.time * 9) * 0.08;
      this.aura.scale.set(s, s * 1.3, s);
    }

    // 3: Force Push
    if (input.justPressed('Digit3') && this.force >= 25) {
      this.force -= 25;
      cam.forward(tmp);
      this.spawnRing(player.pos, 0xbfe0ff, 12, 0.45);
      for (const c of world.creatures.creatures) {
        tmp2.copy(c.pos).sub(player.pos);
        const d = tmp2.length();
        if (d > 16) continue;
        tmp2.normalize();
        const facing = tmp2.dot(tmp);
        if (d > 3 && facing < 0.35) continue;
        const power = 22 * (1 - d / 18) + 6;
        c.knock(tmp2, power);
      }
    }

    // 4: Force Lightning (hold)
    this.lightningActive = input.isDown('Digit4') && this.force > 0;
    this.bolt.visible = this.lightningActive;
    if (this.lightningActive) {
      this.force -= 18 * dt;
      cam.forward(tmp);
      let target: THREE.Vector3 | null = null;
      let bestD = 26;
      for (const c of world.creatures.creatures) {
        tmp2.copy(c.pos).sub(player.pos);
        const d = tmp2.length();
        if (d >= bestD) continue;
        if (tmp2.normalize().dot(tmp) < 0.45) continue;
        bestD = d;
        target = c.pos;
        c.stunned = Math.max(c.stunned, 0.25);
        if (c.grounded && Math.random() < dt * 1.5) c.knock(tmp2.clone(), 4);
      }
      const start = tmp2.copy(player.pos).addScaledVector(tmp, 0.4);
      start.y += 1.35;
      const end = target ? target.clone().setY(target.y + 0.8) : start.clone().addScaledVector(tmp, 14);
      this.drawBolt(start, end);
      this.boltLight.position.copy(end).lerp(start, 0.5).y += 0.5;
      this.boltLight.intensity = 14 + Math.random() * 12;
    } else {
      this.boltLight.intensity = 0;
    }

    this.force = Math.min(this.maxForce, Math.max(0, this.force + 9 * dt));

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        this.scene.remove(r.mesh);
        r.mesh.material.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const s = 0.3 + r.maxScale * Math.sqrt(t);
      r.mesh.scale.set(s, 1, s);
      r.mesh.material.opacity = 0.8 * (1 - t);
    }
  }

  private drawBolt(a: THREE.Vector3, b: THREE.Vector3): void {
    const arr = this.boltPositions;
    const dir = tmp.copy(b).sub(a);
    const len = dir.length();
    for (let i = 0; i <= LIGHTNING_SEGMENTS; i++) {
      const t = i / LIGHTNING_SEGMENTS;
      const jitter = i === 0 || i === LIGHTNING_SEGMENTS ? 0 : Math.min(1, len * 0.06) * (0.6 + t * 0.6);
      arr[i * 3] = a.x + dir.x * t + (Math.random() - 0.5) * jitter;
      arr[i * 3 + 1] = a.y + dir.y * t + (Math.random() - 0.5) * jitter;
      arr[i * 3 + 2] = a.z + dir.z * t + (Math.random() - 0.5) * jitter;
    }
    this.bolt.geometry.attributes.position.needsUpdate = true;
  }
}
