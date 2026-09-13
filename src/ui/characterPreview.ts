// The wardrobe's doll: the character as it is now, on its own canvas, turned with the mouse.
//
// It is a clone on a renderer of its own rather than a second view of the character in the world.
// A second view would have to share the world's lights and materials, and three recompiles a
// material when the lights around it change -- so a preview lit its own way would stutter the
// whole scene every frame. A separate context costs one extra upload of a few meshes and cannot
// disturb anything.

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Character } from '../player/character';

export class CharacterPreview {
  readonly canvas = document.createElement('canvas');
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 0.05, 40);
  private readonly pivot = new THREE.Group();
  private model: THREE.Object3D | null = null;
  /** Facing the viewer: the character's front is down +Z, so the camera starts there. */
  private yaw = 0;
  private pitch = 0.05;
  private distance = 3.1;
  private height = 0.95;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private dirty = true;
  private framed = false;
  private running = false;

  constructor() {
    this.canvas.className = 'preview-canvas';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.add(this.pivot);
    // Three-point lighting of its own, so a character looks the same at midnight as at noon.
    const key = new THREE.DirectionalLight(0xfff4e2, 2.6);
    key.position.set(2.5, 3.5, 3);
    const fill = new THREE.DirectionalLight(0x9fc4e8, 1.1);
    fill.position.set(-3, 1.2, 1.5);
    const rim = new THREE.DirectionalLight(0xffffff, 1.4);
    rim.position.set(-1, 2, -3.5);
    this.scene.add(key, fill, rim, new THREE.HemisphereLight(0xbcd3e8, 0x35302a, 1.1));
    this.bindDrag();
    // The panel sizes the canvas with CSS, and measuring it once races the layout. Watching it
    // keeps the drawing buffer the same shape as the box, whatever the window does afterwards.
    this.observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) this.resize(Math.round(box.width), Math.round(box.height));
    });
    this.observer.observe(this.canvas);
  }

  private readonly observer: ResizeObserver;

  private bindDrag(): void {
    const down = (e: PointerEvent) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.yaw -= (e.clientX - this.lastX) * 0.011;
      this.pitch = Math.min(Math.max(this.pitch + (e.clientY - this.lastY) * 0.006, -0.5), 0.7);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.userFramed = true;
      this.dirty = true;
    };
    const up = (e: PointerEvent) => {
      this.dragging = false;
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    };
    this.canvas.addEventListener('pointerdown', down);
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    this.canvas.addEventListener('wheel', (e) => {
      this.distance = Math.min(Math.max(this.distance + Math.sign(e.deltaY) * 0.22, 0.6), 12);
      this.userFramed = true;
      this.dirty = true;
      e.preventDefault();
    }, { passive: false });
  }

  /**
   * Take a fresh copy of the character. Called whenever what it wears changes: the clone is a
   * snapshot, so anything put on after it was made would otherwise be missing from the doll.
   */
  refresh(character: Character): void {
    this.dispose();
    // The clone rebinds its own skeleton, so posing the doll never moves the character in the world.
    const copy = cloneSkinned(character.group);
    // The clone inherits stale matrices, and a skinned mesh's bounds are read through them, so
    // without this the box comes out empty and the camera frames nothing.
    copy.updateMatrixWorld(true);
    copy.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = false;
      m.receiveShadow = false;
      m.frustumCulled = false;
    });
    const box = meshBounds(copy);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    // Stand the model in the middle of the view with its feet on the floor, so turning it spins
    // it about its own middle rather than about whatever corner the origin happens to sit in.
    copy.position.sub(new THREE.Vector3(centre.x, box.min.y, centre.z));
    // Frame it once. A rebuild after an equip must leave the view exactly as the user set it.
    if (!this.framed) {
      this.height = size.y / 2;
      this.distance = this.fitDistance(size);
      this.framed = true;
    }
    this.modelSize = size.clone();
    this.pivot.add(copy);
    this.model = copy;
    this.dirty = true;
    let meshes = 0;
    copy.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    this.lastBuild = { meshes, size: [size.x, size.y, size.z].map((v) => Number(v.toFixed(2))), distance: Number(this.distance.toFixed(2)) };
  }

  /** What the last clone produced, for the console when the doll looks wrong. */
  lastBuild: { meshes: number; size: number[]; distance: number } | null = null;

  /** Size the drawing buffer to the box the panel gives it. */
  resize(width: number, height: number): void {
    if (width < 8 || height < 8) return;
    const shapeChanged = this.camera.aspect !== width / height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // The first real size arrives after the model, so the fit has to be redone once it does.
    if (shapeChanged && !this.userFramed) this.distance = this.fitDistance(this.modelSize);
    this.dirty = true;
  }

  /** Set once the user turns or zooms, so nothing recomputed afterwards overrides them. */
  private userFramed = false;

  /**
   * Draw every frame while the panel is open. Drawing only on change would be cheaper, but the
   * drawing buffer is not preserved between composites -- the canvas goes blank the moment the
   * browser has shown it once. A still character costs ten draw calls, and the game is paused
   * behind the panel anyway.
   */
  private frame = (): void => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    if (!this.model) return;
    this.dirty = false;
    this.frames++;
    const cp = Math.cos(this.pitch);
    this.camera.position.set(Math.sin(this.yaw) * cp * this.distance, this.height + Math.sin(this.pitch) * this.distance, Math.cos(this.yaw) * cp * this.distance);
    this.camera.lookAt(0, this.height, 0);
    this.renderer.render(this.scene, this.camera);
    this.lastRender = { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, camera: this.camera.position.toArray().map((v) => Number(v.toFixed(2))) };
  };

  frames = 0;
  lastRender: unknown = null;
  private modelSize = new THREE.Vector3(1, 1.9, 1);

  /** How far back the camera has to sit for the whole model to fit, both ways. */
  private fitDistance(size: THREE.Vector3): number {
    // Height decides it: the panel is a tall slot and the point is to see head to toe. Fitting
    // the width too would pull the camera far back, because the rest pose holds the arms straight
    // out and the character is never actually standing that way.
    const vFov = (this.camera.fov * Math.PI) / 180;
    return (size.y / 2 / Math.tan(vFov / 2)) * 1.1;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.dirty = true;
    requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
  }

  /** Drop the clone's own geometry; materials and textures belong to the character. */
  private dispose(): void {
    if (!this.model) return;
    this.pivot.remove(this.model);
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.model = null;
  }
}

/**
 * The box the character's own body and clothing occupy.
 *
 * Only skinned meshes count. Box3.setFromObject walks everything under the rig, which includes
 * whatever is held in the hands -- a drawn sabre reaches a metre past the body in each direction
 * and read 2.3 m deep for a figure half a metre thick. That threw the centre off the body, so the
 * model framed too far away and turned about a wrist instead of its own middle.
 */
function meshBounds(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  const local = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.visible || !m.geometry) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    if (!m.geometry.boundingBox) return;
    // A skinned mesh's geometry box is its rest pose, which is the shape worth framing: the doll
    // stands still, and the rest pose is near enough what it stands in.
    local.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
    box.union(local);
  });
  return box;
}
