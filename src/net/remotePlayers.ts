// The other players: each one a rig of its species, stood where the relay last said, gliding to
// each new place, playing the state the other's rig plays, with a name over its head.
import * as THREE from 'three';
import { CharacterRig, loadPlayerRig, type RigState } from '../player/rig';
import { markActor } from '../world/portalRender';
import { isDanceClip, isFlourishClip, loopsEmote } from '../core/emotes';
import type { Hello, PeerState, PeerVehicle } from './net';
import type { Garage } from '../vehicles/garage';

/** The vehicle a peer is on, as a picture: which, where it is heading to, and how it is turned. */
interface RemoteVehicle {
  id: string;
  obj: THREE.Object3D | null;
  target: THREE.Vector3;
  targetQ: THREE.Quaternion;
  pose: string | null;
}

interface Remote {
  id: number;
  hello: Hello;
  group: THREE.Group;
  rig: CharacterRig | null;
  label: THREE.Sprite;
  target: THREE.Vector3;
  heading: number;
  /** The figure's whole turn, when the peer sends one (aboard a hull, adrift). */
  targetQ: THREE.Quaternion | null;
  state: string;
  speed: number;
  saber: boolean;
  /** Seconds since the last state: past a while the figure stands still. */
  silent: number;
  /** The dance loop playing, to come back to after a flourish. */
  dance: string | null;
  vehicle: RemoteVehicle | null;
}

const STATES: Set<string> = new Set(['idle', 'walk', 'run', 'air', 'seated', 'swim', 'float', 'crouch', 'crouchWalk', 'crouchWalkBack', 'stance', 'strafeLeft', 'strafeRight', 'runBack', 'walkBack', 'runSaber', 'walkSaber', 'gunIdle', 'gunWalk', 'gunRun', 'gunReadyIdle', 'gunReadyWalk', 'gunReadyRun', 'gunAimIdle', 'gunAimWalk', 'gunAimRun', 'kneel', 'prone', 'proneMove']);

export class RemotePlayers {
  private readonly remotes = new Map<number, Remote>();
  /** The world the local player is on: peers elsewhere are kept but not shown. */
  private planet = '';
  private zone: string | undefined;

  /** The garage, for the vehicles the peers ride (loaded the first time one is seen). */
  private garage: Promise<Garage> | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly baseUrl: string,
    private readonly loadGarage: () => Promise<Garage>,
  ) {}

  get count(): number {
    return this.remotes.size;
  }

  /** How many are on this world, and their names. */
  here(): string[] {
    return [...this.remotes.values()].filter((r) => this.sameWorld(r.hello)).map((r) => r.hello.name);
  }

  setWorld(planet: string, zone: string | undefined): void {
    this.planet = planet;
    this.zone = zone;
    for (const r of this.remotes.values()) r.group.visible = this.sameWorld(r.hello);
  }

  private sameWorld(h: Hello): boolean {
    return h.planet === this.planet && (h.zone ?? undefined) === this.zone;
  }

  add(id: number, hello: Hello): void {
    this.remove(id);
    const group = new THREE.Group();
    group.visible = this.sameWorld(hello);
    const label = makeLabel(hello.name);
    label.position.y = 2.15;
    group.add(label);
    this.scene.add(group);
    markActor(group);
    const remote: Remote = { id, hello, group, rig: null, label, target: new THREE.Vector3(0, -1000, 0), heading: 0, targetQ: null, state: 'idle', speed: 0, saber: false, silent: 0, dance: null, vehicle: null };
    this.remotes.set(id, remote);
    void this.dress(remote);
  }

  /** The rig of the peer's species, put under its group once it loads (the placeholder is nothing meanwhile). */
  private async dress(remote: Remote): Promise<void> {
    const species = remote.hello.species;
    try {
      const rig = await loadPlayerRig(this.baseUrl, species);
      if (this.remotes.get(remote.id) !== remote || remote.hello.species !== species) return;
      rig.root.scale.setScalar(rig.scale);
      remote.group.add(rig.root);
      markActor(rig.root);
      remote.rig = rig;
      remote.rig.setState('idle');
    } catch (err) {
      console.warn(`remote player ${remote.hello.name}: no rig for ${species}`, err);
    }
  }

  hello(id: number, hello: Hello): void {
    const r = this.remotes.get(id);
    if (!r) return;
    const speciesChanged = r.hello.species !== hello.species;
    r.hello = hello;
    r.group.visible = this.sameWorld(hello);
    (r.label.material as THREE.SpriteMaterial).map?.dispose();
    r.group.remove(r.label);
    r.label = makeLabel(hello.name);
    r.label.position.y = 2.15;
    r.group.add(r.label);
    if (speciesChanged) {
      if (r.rig) r.group.remove(r.rig.root);
      r.rig = null;
      void this.dress(r);
    }
  }

  state(id: number, s: PeerState): void {
    const r = this.remotes.get(id);
    if (!r) return;
    const first = r.target.y < -900;
    r.target.set(s.p[0], s.p[1], s.p[2]);
    if (first) r.group.position.copy(r.target);
    r.heading = s.h;
    r.targetQ = s.q && s.q.length === 4 ? (r.targetQ ?? new THREE.Quaternion()).set(s.q[0], s.q[1], s.q[2], s.q[3]).normalize() : null;
    r.state = STATES.has(s.s) ? s.s : 'idle';
    r.speed = s.v;
    r.saber = s.sab;
    r.silent = 0;
    this.vehicleState(r, s.veh);
  }

  /** The vehicle a peer is on: brought in when first seen (or changed), moved along after, taken away when they are off it. */
  private vehicleState(r: Remote, veh: PeerVehicle | undefined): void {
    if (!veh) {
      this.dropVehicle(r);
      return;
    }
    if (!r.vehicle || r.vehicle.id !== veh.id) {
      this.dropVehicle(r);
      const rv: RemoteVehicle = { id: veh.id, obj: null, target: new THREE.Vector3(veh.p[0], veh.p[1], veh.p[2]), targetQ: new THREE.Quaternion(veh.q[0], veh.q[1], veh.q[2], veh.q[3]), pose: veh.pose ?? null };
      r.vehicle = rv;
      void this.bringVehicle(r, rv);
    }
    const rv = r.vehicle;
    rv.target.set(veh.p[0], veh.p[1], veh.p[2]);
    rv.targetQ.set(veh.q[0], veh.q[1], veh.q[2], veh.q[3]).normalize();
    rv.pose = veh.pose ?? null;
    if (rv.obj && rv.obj.position.y < -900) {
      rv.obj.position.copy(rv.target);
      rv.obj.quaternion.copy(rv.targetQ);
    }
  }

  private async bringVehicle(r: Remote, rv: RemoteVehicle): Promise<void> {
    try {
      this.garage ??= this.loadGarage();
      const g = await this.garage;
      const def = g.find(rv.id);
      if (!def) {
        console.warn(`remote player ${r.hello.name} rides a ${rv.id} the garage does not know`);
        return;
      }
      const obj = await g.visual(def);
      if (r.vehicle !== rv) return;
      obj.position.copy(rv.target);
      obj.quaternion.copy(rv.targetQ);
      obj.visible = r.group.visible;
      this.scene.add(obj);
      markActor(obj);
      rv.obj = obj;
    } catch (err) {
      console.warn(`remote player ${r.hello.name}: their ${rv.id} did not load`, err);
    }
  }

  private dropVehicle(r: Remote): void {
    if (!r.vehicle) return;
    if (r.vehicle.obj) this.scene.remove(r.vehicle.obj);
    r.vehicle = null;
  }

  /** An emote from the relay: a dance or a sit loops, a flourish plays over the dance (which comes back after it), an empty clip ends whatever plays. */
  emote(id: number, clip: string): void {
    const r = this.remotes.get(id);
    if (!r) return;
    if (!clip) {
      r.rig?.stopOverride(0.2);
      r.dance = null;
      return;
    }
    r.rig?.play(clip, { fadeIn: 0.15, loop: loopsEmote(clip) });
    r.dance = isDanceClip(clip) ? clip : isFlourishClip(clip) ? r.dance : null;
  }

  remove(id: number): void {
    const r = this.remotes.get(id);
    if (!r) return;
    this.remotes.delete(id);
    this.dropVehicle(r);
    this.scene.remove(r.group);
    (r.label.material as THREE.SpriteMaterial).map?.dispose();
  }

  update(dt: number): void {
    for (const r of this.remotes.values()) {
      if (r.vehicle?.obj) r.vehicle.obj.visible = r.group.visible;
      if (!r.group.visible) continue;
      r.silent += dt;
      // Glide to the last place heard, a tenth of a second's worth at a time, so the figure moves
      // smoothly between the relay's few updates a second.
      const k = 1 - Math.exp(-dt / 0.1);
      r.group.position.lerp(r.target, k);
      if (r.targetQ) {
        // The whole turn: aboard a hull or adrift, the figure is not upright in the world.
        r.group.quaternion.slerp(r.targetQ, k);
      } else {
        let diff = r.heading - r.group.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        r.group.rotation.set(0, r.group.rotation.y + diff * k, 0);
      }
      const rv = r.vehicle;
      if (rv?.obj) {
        rv.obj.position.lerp(rv.target, k);
        rv.obj.quaternion.slerp(rv.targetQ, k);
      }
      const rig = r.rig;
      if (rig) {
        // A flourish over, the dance goes on.
        if (r.dance && !rig.overriding) rig.play(r.dance, { fadeIn: 0.15, loop: true });
        const moving = r.silent < 0.6 && r.group.position.distanceTo(r.target) > 0.05;
        const state = (r.silent > 1.5 ? 'idle' : moving || r.state === 'idle' ? r.state : r.state) as RigState;
        // Seated the way the peer's own vehicle seats them: its riding pose's branch of the riding loop.
        if (state === 'seated') {
          const pose = rv?.pose ?? (rv ? `vehicle_${rv.id.replace(/^pv_/, '')}` : null);
          const clip = pose ? rig.variant('loop_riding', pose) : null;
          rig.prefer('seated', clip && clip !== 'loop_riding' ? clip : null);
        }
        rig.setState(rig.hasState(state) ? state : 'idle', r.speed);
        rig.update(dt);
      }
    }
  }

  dispose(): void {
    for (const id of [...this.remotes.keys()]) this.remove(id);
  }
}

/** A name over the head: text on a small canvas, as a sprite that faces the camera. */
function makeLabel(name: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '600 28px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  const w = Math.min(250, ctx.measureText(name).width + 24);
  ctx.beginPath();
  ctx.roundRect(128 - w / 2, 12, w, 40, 8);
  ctx.fill();
  ctx.fillStyle = '#dff1ff';
  ctx.fillText(name, 128, 33);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.renderOrder = 10;
  return sprite;
}
