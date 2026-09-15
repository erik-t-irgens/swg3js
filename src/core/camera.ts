import * as THREE from 'three';
import type { Input } from './input';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Distance along from->to at which the world blocks the camera, or null when clear. */
export type CameraBlocker = (from: THREE.Vector3, to: THREE.Vector3) => number | null;

/** Closer than this and the view is from the eyes: the body stays, the head goes. */
const FIRST_PERSON_BELOW = 0.5;
/** The nearest the orbit sits when it is not first person: the shoulders fill the side of the view. */
const NEAREST_ORBIT = 0.7;
/** One wheel notch scales the distance by this: small steps in close, larger ones far out. */
const ZOOM_STEP = 1.08;
/** Seconds for the distance to settle on the wheel's target. */
const ZOOM_LAG = 0.09;
/** How far below level the third-person camera itself may go; the view tilts on past it. */
const LOWEST_CAMERA_PITCH = -0.35;
const EYE_HEIGHT = 1.5;
/** Aiming a blaster in third person: how far the view sits over the right shoulder, and how much higher. */
const AIM_SHOULDER = 0.6;
const AIM_RAISE = 0.15;
const shoulder = new THREE.Vector3();
const chaseOffset = new THREE.Vector3();
/** Seconds for the follow camera to catch up with the ship's frame. */
const CHASE_LAG = 0.28;
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
/** A touch of nose-down, so the ship sits below the middle of the view. */
const chaseTilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.1);
const frameInverse = new THREE.Quaternion();

/** SWG-style free-orbit third-person camera that becomes first person when zoomed all the way in. */
export class ThirdPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = Math.PI;
  pitch = 0.32;
  distance = 7;
  /** Where the wheel has asked the distance to go; the distance eases there. */
  zoomTarget = 7;
  /** Zoomed in past the character: first person, from the eyes. */
  firstPerson = false;
  /** Aiming a blaster: the camera comes in over the shoulder and the view narrows. */
  aim = false;
  /** Mouse look speed over the game's own, and whether pushing forward looks down. */
  sensitivity = 1;
  invertY = false;
  /** The field of view when not aiming, degrees. */
  baseFov = 60;
  private aimBlend = 0;
  private readonly focus = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly posDir = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly chaseFrame = new THREE.Quaternion();
  private chasing = false;
  /**
   * The frame the view is upright in: the world's, or aboard a ship the hull's, so the orbit,
   * its up and the yaw all follow the room whatever the hull is doing. Yaw and pitch are in this frame.
   */
  private readonly frame = new THREE.Quaternion();
  private framed = false;
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.05, 9000);
  }

  /**
   * The wheel moves a target the distance glides to, by a fraction of itself per notch, so the
   * steps are fine in close and the motion never jumps. In past the nearest orbit it drops to the
   * eyes; out from there it comes back to that orbit.
   */
  private zoom(input: Input, dt: number, max = 24): void {
    if (input.wheel) {
      let t = this.zoomTarget;
      if (t < NEAREST_ORBIT) t = input.wheel > 0 ? NEAREST_ORBIT : 0;
      else {
        t = clamp(t * Math.pow(ZOOM_STEP, input.wheel), 0, max);
        if (t < NEAREST_ORBIT) t = input.wheel > 0 ? NEAREST_ORBIT : 0;
      }
      this.zoomTarget = t;
      input.wheel = 0;
    }
    this.distance += (this.zoomTarget - this.distance) * (1 - Math.exp(-dt / ZOOM_LAG));
    if (Math.abs(this.zoomTarget - this.distance) < 0.002) this.distance = this.zoomTarget;
    this.firstPerson = this.distance < FIRST_PERSON_BELOW;
  }

  /**
   * Behind a ship in its own frame: above and behind it looking along its nose, rolling and
   * looping with it. The orbit's yaw is kept at the ship's heading so leaving it is seamless.
   */
  chase(input: Input, dt: number, target: THREE.Vector3, attitude: THREE.Quaternion, heading: number, reach: number, cockpit: THREE.Vector3 | null): void {
    this.zoom(input, dt);
    this.yaw = heading + Math.PI;
    this.pitch = 0.32;
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

  /**
   * Put the view in a frame (a ship's hull, aboard) or back in the world's (null). The way the
   * camera looks is kept across the change: its yaw and pitch are re-read in the new frame.
   */
  setFrame(q: THREE.Quaternion | null): void {
    const was = this.framed;
    if (!q && !was) return;
    if (q && was) {
      // The frame turning under a view already in it: the view turns with it, as the body does,
      // so the yaw and pitch stay what they are in the room.
      this.frame.copy(q);
      this.up.set(0, 1, 0).applyQuaternion(q);
      this.camera.up.copy(this.up);
      return;
    }
    const cp = Math.cos(this.pitch);
    this.dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    if (was) this.dir.applyQuaternion(this.frame);
    if (q) {
      this.frame.copy(q);
      this.dir.applyQuaternion(frameInverse.copy(q).invert());
    }
    this.framed = !!q;
    this.yaw = Math.atan2(this.dir.x, this.dir.z);
    this.pitch = clamp(Math.asin(clamp(this.dir.y, -1, 1)), -1.4, 1.4);
    this.up.set(0, 1, 0);
    if (this.framed) this.up.applyQuaternion(this.frame);
    this.camera.up.copy(this.up);
  }

  /** Horizontal forward direction (from camera toward the player), in the view's frame: the world's, or aboard, the hull's. */
  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  right(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  /**
   * @param blocked  physics query for what the camera would cut through; null skips collision (noclip)
   * @param eyes     where the character's eyes are this frame, for the first-person view; the standing eye height over `target` otherwise
   * @param scale    the orbit's distance over the wheel's, for orbiting something larger than a figure (a ship)
   */
  update(input: Input, target: THREE.Vector3, blocked: CameraBlocker | null, dt = 1 / 60, eyes: THREE.Vector3 | null = null, scale = 1): void {
    if (input.locked) {
      const k = 0.0025 * this.sensitivity;
      this.yaw -= input.mouseDX * k;
      this.pitch = clamp(this.pitch + input.mouseDY * k * (this.invertY ? -1 : 1), this.firstPerson ? -1.4 : -1.25, 1.4);
    }
    // The movement is spent here, not at the end of the frame: an error later in the frame used to
    // leave it accumulating, and every frame after re-applied the growing sum, so the view slid
    // on with a momentum of its own whenever something in a particular direction failed to draw.
    input.mouseDX = 0;
    input.mouseDY = 0;
    this.zoom(input, dt);

    this.focus.copy(target).addScaledVector(this.up, EYE_HEIGHT);
    // Aiming a blaster: the view comes in over the right shoulder, and back to the middle after.
    this.aimBlend += ((this.aim ? 1 : 0) - this.aimBlend) * 0.15;
    if (this.aimBlend > 0.001 && !this.firstPerson) {
      this.right(shoulder);
      if (this.framed) shoulder.applyQuaternion(this.frame);
      this.focus.addScaledVector(shoulder, AIM_SHOULDER * this.aimBlend).addScaledVector(this.up, AIM_RAISE * this.aimBlend);
    }
    const cp = Math.cos(this.pitch);
    this.dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    // Behind the player the camera cannot go below the ground, so past a mild upward pitch it stays at that
    // height and tilts up instead, the player sliding down the frame: the view keeps going where the mouse does.
    const posPitch = this.firstPerson ? this.pitch : Math.max(this.pitch, LOWEST_CAMERA_PITCH);
    const cpp = Math.cos(posPitch);
    this.posDir.set(Math.sin(this.yaw) * cpp, Math.sin(posPitch), Math.cos(this.yaw) * cpp);
    // Aboard, the orbit is in the hull's frame: the room stays upright however the hull banks.
    if (this.framed) {
      this.dir.applyQuaternion(this.frame);
      this.posDir.applyQuaternion(this.frame);
    }

    if (this.firstPerson) {
      // From the eyes as the animation carries them (a crouch, a jump, a run's bob), a touch
      // forward of the head's joint so the neck is not in the picture.
      if (eyes) this.focus.copy(eyes);
      this.camera.position.copy(this.focus).addScaledVector(this.dir, -0.12);
      this.camera.lookAt(this.desired.copy(this.camera.position).sub(this.dir));
      return;
    }

    const fov = this.baseFov - 14 * this.aimBlend;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    let dist = this.distance * scale * (1 - 0.45 * this.aimBlend);
    this.desired.copy(this.posDir).multiplyScalar(dist).add(this.focus);
    if (blocked) {
      // Pull the camera in front of whatever it would cut through: walls, props, ground.
      const hit = blocked(this.focus, this.desired);
      if (hit !== null) {
        dist = Math.max(0.3, hit - 0.35);
        this.desired.copy(this.posDir).multiplyScalar(dist).add(this.focus);
      }
    }
    this.camera.position.copy(this.desired);
    if (posPitch === this.pitch) this.camera.lookAt(this.focus);
    else this.camera.lookAt(this.lookTarget.copy(this.camera.position).addScaledVector(this.dir, -Math.max(dist, 1)));
  }
}
