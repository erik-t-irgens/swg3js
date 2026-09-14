import * as THREE from 'three';
import type { Input } from './input';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Distance along from->to at which the world blocks the camera, or null when clear. */
export type CameraBlocker = (from: THREE.Vector3, to: THREE.Vector3) => number | null;

const FIRST_PERSON_BELOW = 1.2;
/** How far below level the third-person camera itself may go; the view tilts on past it. */
const LOWEST_CAMERA_PITCH = -0.35;
const EYE_HEIGHT = 1.5;
const chaseOffset = new THREE.Vector3();
/** Seconds for the follow camera to catch up with the ship's frame. */
const CHASE_LAG = 0.28;
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
/** A touch of nose-down, so the ship sits below the middle of the view. */
const chaseTilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.1);

/** SWG-style free-orbit third-person camera that becomes first person when zoomed all the way in. */
export class ThirdPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = Math.PI;
  pitch = 0.32;
  distance = 7;
  /** Zoomed in past the character: first person, character hidden. */
  firstPerson = false;
  /** Aiming a blaster: the camera comes in over the shoulder and the view narrows. */
  aim = false;
  private aimBlend = 0;
  private readonly focus = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly posDir = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly chaseFrame = new THREE.Quaternion();
  private chasing = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 9000);
  }

  /**
   * Behind a ship in its own frame: above and behind it looking along its nose, rolling and
   * looping with it. The orbit's yaw is kept at the ship's heading so leaving it is seamless.
   */
  chase(input: Input, dt: number, target: THREE.Vector3, attitude: THREE.Quaternion, heading: number, reach: number, cockpit: THREE.Vector3 | null): void {
    this.distance = clamp(this.distance + input.wheel * 0.9, 0, 24);
    input.wheel = 0;
    this.yaw = heading + Math.PI;
    this.pitch = 0.32;
    this.firstPerson = this.distance < FIRST_PERSON_BELOW;
    // The camera's frame follows the ship's with a lag (a quarter of a second to catch up), so a
    // turn shows the ship swinging and banking against the view before the view comes round.
    if (!this.chasing) {
      this.chaseFrame.copy(attitude);
      this.chasing = true;
    }
    this.chaseFrame.slerp(attitude, 1 - Math.exp(-dt / CHASE_LAG)).normalize();
    if (this.firstPerson) {
      // In the cockpit: on the ship's own frame exactly, looking along its nose.
      chaseOffset.copy(cockpit ?? chaseOffset.set(0, 1, 0)).applyQuaternion(attitude);
      this.camera.position.copy(target).add(chaseOffset);
      this.camera.quaternion.copy(attitude).multiply(FLIP);
    } else {
      // The wheel sets how far back, scaled to the ship: zoomed out it sits well behind a barge.
      const distance = reach * (0.35 + this.distance / 12);
      chaseOffset.set(0, distance * 0.32, -distance).applyQuaternion(this.chaseFrame);
      this.camera.position.copy(target).add(chaseOffset);
      // Cameras look down their own -Z; the ship's nose is its +Z.
      this.camera.quaternion.copy(this.chaseFrame).multiply(FLIP).multiply(chaseTilt);
    }
    this.focus.copy(target);
  }

  /** Back to orbiting: the next chase starts from the ship's frame afresh. */
  release(): void {
    this.chasing = false;
  }

  /** Horizontal forward direction (from camera toward the player). */
  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  right(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  /**
   * @param blocked  physics query for what the camera would cut through; null skips collision (noclip)
   */
  update(input: Input, target: THREE.Vector3, blocked: CameraBlocker | null): void {
    if (input.locked) {
      this.yaw -= input.mouseDX * 0.0025;
      this.pitch = clamp(this.pitch + input.mouseDY * 0.0025, this.firstPerson ? -1.4 : -1.25, 1.4);
    }
    this.distance = clamp(this.distance + input.wheel * 0.9, 0, 24);
    // The movement is spent here, not at the end of the frame: an error later in the frame used to
    // leave it accumulating, and every frame after re-applied the growing sum, so the view slid
    // on with a momentum of its own whenever something in a particular direction failed to draw.
    input.mouseDX = 0;
    input.mouseDY = 0;
    input.wheel = 0;
    this.firstPerson = this.distance < FIRST_PERSON_BELOW;

    this.focus.copy(target).y += EYE_HEIGHT;
    const cp = Math.cos(this.pitch);
    this.dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    // Behind the player the camera cannot go below the ground, so past a mild upward pitch it stays at that
    // height and tilts up instead, the player sliding down the frame: the view keeps going where the mouse does.
    const posPitch = this.firstPerson ? this.pitch : Math.max(this.pitch, LOWEST_CAMERA_PITCH);
    const cpp = Math.cos(posPitch);
    this.posDir.set(Math.sin(this.yaw) * cpp, Math.sin(posPitch), Math.cos(this.yaw) * cpp);

    if (this.firstPerson) {
      this.camera.position.copy(this.focus);
      this.camera.lookAt(this.desired.copy(this.focus).sub(this.dir));
      return;
    }

    this.aimBlend += ((this.aim ? 1 : 0) - this.aimBlend) * 0.15;
    const fov = 60 - 14 * this.aimBlend;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    let dist = this.distance * (1 - 0.45 * this.aimBlend);
    this.desired.copy(this.posDir).multiplyScalar(dist).add(this.focus);
    if (blocked) {
      // Pull the camera in front of whatever it would cut through: walls, props, ground.
      const hit = blocked(this.focus, this.desired);
      if (hit !== null) {
        dist = Math.max(0.6, hit - 0.35);
        this.desired.copy(this.posDir).multiplyScalar(dist).add(this.focus);
      }
    }
    this.camera.position.copy(this.desired);
    if (posPitch === this.pitch) this.camera.lookAt(this.focus);
    else this.camera.lookAt(this.lookTarget.copy(this.camera.position).addScaledVector(this.dir, -Math.max(dist, 1)));
  }
}
