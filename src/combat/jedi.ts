import * as THREE from 'three';
import { RAPIER } from '../core/physics';
import type { Creature } from '../world/creatures';
import type { Kit, KitContext, KitSlot, Resource } from './kit';

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const mid = new THREE.Vector3();
const quat = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const LIGHTNING_SEGMENTS = 14;

export class JediKit implements Kit {
  readonly id = 'jedi' as const;
  readonly name = 'Jedi';
  readonly slots: KitSlot[] = [
    { key: '1', name: 'Force Jump', cost: '20' },
    { key: '2', name: 'Force Speed', cost: '6/s' },
    { key: '3', name: 'Force Push', cost: '25' },
    { key: '4', name: 'Force Lightning', cost: '18/s' },
  ];
  readonly help = [
    '<b>LMB</b> saber swing (hold to chain, direction keys pick the swing) · <b>K</b> saber style · <b>L</b> saber on/off',
    '<b>1</b> Force Jump · <b>2</b> Force Speed · <b>3</b> Force Push · <b>4</b> Force Lightning (hold)',
  ];
  readonly resource: Resource = { label: 'Force', value: 100, max: 100 };
  speedActive = false;
  lightningActive = false;
  /** Last style change, for the HUD. */
  styleNote = '';
  private readonly hitThisSwing = new Set<Creature>();
  private lastAttackId = -1;
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
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.boltPositions, 3));
    this.bolt = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xbfe6ff, toneMapped: false }));
    this.bolt.visible = false;
    this.bolt.frustumCulled = false;
    scene.add(this.aura, this.bolt, this.boltLight);
  }

  slotActive(i: number): boolean {
    return i === 1 ? this.speedActive : i === 3 ? this.lightningActive : false;
  }

  slotCooldown(): number {
    return 0;
  }

  update(ctx: KitContext): void {
    const { dt, input, player, world, cam, physics, effects } = ctx;
    this.time += dt;
    const planet = world.planet;
    const res = this.resource;
    const onFoot = !player.mounted;

    // Lightsaber: the player runs the swing itself (Jedi Academy's move system); each new swing
    // may hit every creature once.
    player.force = res;
    if (input.justPressed('KeyK') && onFoot) this.styleNote = `saber style: ${player.saber.cycleStyle()}`;
    if (player.saber.attackId !== this.lastAttackId) {
      this.lastAttackId = player.saber.attackId;
      this.hitThisSwing.clear();
    }
    if (player.swing === 0) this.hitThisSwing.clear();
    if (onFoot && player.saberOn && player.bladeActive) {
      player.bladeSegment(a, b);
      mid.copy(a).add(b).multiplyScalar(0.5);
      tmp.copy(b).sub(a);
      const len = tmp.length();
      quat.setFromUnitVectors(UP, tmp.normalize());
      physics.world.intersectionsWithShape(
        mid,
        quat,
        new RAPIER.Capsule(len / 2, 0.16),
        (collider) => {
          const c = world.creatures.byCollider.get(collider.handle);
          if (c && !this.hitThisSwing.has(c)) {
            this.hitThisSwing.add(c);
            c.damage(player.saberDamage, player.pos, 5);
            tmp2.copy(c.pos).y += c.halfHeight;
            effects.burst(tmp2, 0x9fd4ff, 1.2, 0.2);
            effects.flash(tmp2, 0x9fd4ff, 10, 8, 0.15);
          }
          return true;
        },
        undefined,
        undefined,
        undefined,
        player.body,
      );
    }

    // 1: Force Jump
    if (onFoot && input.justPressed('Digit1') && player.grounded && !player.swimming && res.value >= 20) {
      res.value -= 20;
      player.launch(Math.sqrt(2 * planet.gravity * 11), 9, cam);
      effects.ring(player.pos, 0x9fd4ff, 5, 0.5);
    }

    // 2: Force Speed (toggle)
    if (input.justPressed('Digit2')) {
      if (this.speedActive) this.speedActive = false;
      else if (res.value >= 10) this.speedActive = true;
    }
    if (this.speedActive) {
      res.value -= 6 * dt;
      if (res.value <= 0) this.speedActive = false;
    }
    player.speedMultiplier = this.speedActive ? 2.1 : 1;
    this.aura.visible = this.speedActive && onFoot;
    if (this.aura.visible) {
      this.aura.position.copy(player.pos).y += 1;
      const s = 1 + Math.sin(this.time * 9) * 0.08;
      this.aura.scale.set(s, s * 1.3, s);
    }

    // 3: Force Push
    if (onFoot && input.justPressed('Digit3') && res.value >= 25) {
      res.value -= 25;
      cam.forward(tmp);
      effects.ring(player.pos, 0xbfe0ff, 12, 0.45);
      for (const c of world.creatures.creatures) {
        tmp2.copy(c.pos).sub(player.pos);
        const d = tmp2.length();
        if (d > 16) continue;
        tmp2.normalize();
        if (d > 3 && tmp2.dot(tmp) < 0.35) continue;
        c.damage(10);
        c.knock(tmp2, 22 * (1 - d / 18) + 6);
      }
      for (const sp of world.speeders) {
        tmp2.copy(sp.pos).sub(player.pos);
        const d = tmp2.length();
        if (d > 12 || sp === player.mounted) continue;
        tmp2.normalize();
        const m = sp.body.mass();
        sp.body.applyImpulse({ x: tmp2.x * m * 9 * (1 - d / 14), y: m * 4, z: tmp2.z * m * 9 * (1 - d / 14) }, true);
      }
    }

    // 4: Force Lightning (hold)
    this.lightningActive = onFoot && input.isDown('Digit4') && res.value > 0;
    this.bolt.visible = this.lightningActive;
    if (this.lightningActive) {
      res.value -= 18 * dt;
      cam.forward(tmp);
      let target: Creature | null = null;
      let bestD = 26;
      for (const c of world.creatures.creatures) {
        if (c.dead) continue;
        tmp2.copy(c.pos).sub(player.pos);
        const d = tmp2.length();
        if (d >= bestD) continue;
        if (tmp2.normalize().dot(tmp) < 0.45) continue;
        bestD = d;
        target = c;
      }
      if (target) {
        target.damage(30 * dt);
        if (target.grounded && Math.random() < dt * 1.2) {
          tmp2.copy(target.pos).sub(player.pos).setY(0).normalize();
          target.knock(tmp2, 4);
        }
      }
      const start = tmp2.copy(player.pos).addScaledVector(tmp, 0.4);
      start.y += 1.35;
      const end = target ? target.pos.clone().setY(target.pos.y + target.halfHeight) : start.clone().addScaledVector(tmp, 14);
      this.drawBolt(start, end);
      this.boltLight.position.copy(end).lerp(start, 0.5).y += 0.5;
      this.boltLight.intensity = 14 + Math.random() * 12;
    } else {
      this.boltLight.intensity = 0;
    }

    res.value = Math.min(res.max, Math.max(0, res.value + 9 * dt));
  }

  private drawBolt(from: THREE.Vector3, to: THREE.Vector3): void {
    const arr = this.boltPositions;
    const dir = tmp.copy(to).sub(from);
    const len = dir.length();
    for (let i = 0; i <= LIGHTNING_SEGMENTS; i++) {
      const t = i / LIGHTNING_SEGMENTS;
      const jitter = i === 0 || i === LIGHTNING_SEGMENTS ? 0 : Math.min(1, len * 0.06) * (0.6 + t * 0.6);
      arr[i * 3] = from.x + dir.x * t + (Math.random() - 0.5) * jitter;
      arr[i * 3 + 1] = from.y + dir.y * t + (Math.random() - 0.5) * jitter;
      arr[i * 3 + 2] = from.z + dir.z * t + (Math.random() - 0.5) * jitter;
    }
    this.bolt.geometry.attributes.position.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.aura, this.bolt, this.boltLight);
    this.aura.geometry.dispose();
    this.aura.material.dispose();
    this.bolt.geometry.dispose();
    this.bolt.material.dispose();
  }
}
