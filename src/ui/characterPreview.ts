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
import { PreviewDof, type PreviewEffects, type PreviewReport } from './previewDof';
import { PREVIEW_DOF, previewGate, previewLensOn, previewSpan, type PreviewSpan } from '../core/fx/dofMath.ts';

export class CharacterPreview {
  /** What the settings ask of every doll: App keeps it in step with Effects and Depth of field (a change shows on the next frame). */
  static effects: PreviewEffects = { on: false, strength: 1, view: 0 };
  /** The doll's lens, made the first frame the effect is on; null while it is off. */
  private dof: PreviewDof | null = null;
  /** On the lens path this frame (with hysteresis). */
  private lens = false;
  private lastGate = 0;
  /** The model both program variants were compiled for. */
  private warmedFor: THREE.Object3D | null = null;
  /** The clone's scale when modelSize was measured: follow() rescales the model afterwards (the height slider). */
  private builtScale = 1;
  private readonly bufferSize = new THREE.Vector2();
  private readonly span: PreviewSpan = { focus: 0, nearest: 0, farthest: 0 };
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
    // The doll shows everything worn, including what first person keeps on the shadow layer at the moment (a clone copies layers).
    this.camera.layers.enableAll();
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

  /** Where the camera looks, off the doll's middle: the right button drags it, to bring the face up close. */
  private readonly pan = new THREE.Vector3();
  private panning = false;

  private bindDrag(): void {
    const down = (e: PointerEvent) => {
      this.dragging = e.button !== 2;
      this.panning = e.button === 2;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (!this.dragging && !this.panning) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (this.panning) {
        // Slide the view across the screen: a pixel moves the target the same way whatever the zoom.
        const perPixel = (2 * this.distance * Math.tan(((this.camera.fov * Math.PI) / 180) / 2)) / Math.max(1, this.canvas.clientHeight);
        const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        this.pan.addScaledVector(right, -dx * perPixel);
        this.pan.y += dy * perPixel;
      } else {
        this.yaw -= dx * 0.011;
        this.pitch = Math.min(Math.max(this.pitch + dy * 0.006, -0.5), 0.7);
      }
      this.userFramed = true;
      this.dirty = true;
    };
    const up = (e: PointerEvent) => {
      this.dragging = false;
      this.panning = false;
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    };
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('dblclick', () => {
      // Back to the whole doll.
      this.pan.set(0, 0, 0);
      this.userFramed = false;
      this.distance = this.fitDistance(this.modelSize);
      this.dirty = true;
    });
    this.canvas.addEventListener('pointerdown', down);
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    this.canvas.addEventListener('wheel', (e) => {
      // Finer steps close in, so the face can be framed.
      this.distance = Math.min(Math.max(this.distance * (e.deltaY > 0 ? 1.12 : 1 / 1.12), 0.25), 12);
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
    // The clone carries the character's place and heading in the world; the doll stands at the
    // origin facing the viewer, in the character's own frame (its height scale kept).
    copy.position.set(0, 0, 0);
    copy.quaternion.identity();
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
    // meshBounds reads through matrixWorld, so the size already carries this scale: the lens's span
    // takes only the change since (a height slider moved afterwards).
    this.builtScale = copy.scale.y || 1;
    const centre = box.getCenter(new THREE.Vector3());
    // Stand the model in the middle of the view with its feet on the floor, so turning it spins
    // it about its own middle rather than about whatever corner the origin happens to sit in.
    copy.position.sub(new THREE.Vector3(centre.x, box.min.y, centre.z));
    // The clone is a snapshot: a slider moved afterwards changes the character in the world and
    // not the doll, unless the doll follows. Each frame copies the shape sliders and the height
    // across, mesh by mesh (the clone walks in the same order as the original).
    const sources: THREE.Mesh[] = [];
    character.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) sources.push(o as THREE.Mesh);
    });
    const clones: THREE.Mesh[] = [];
    copy.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) clones.push(o as THREE.Mesh);
    });
    this.pairs = sources.length === clones.length ? sources.map((m, i) => [m, clones[i]]) : [];
    this.source = character.group;
    this.foot = new THREE.Vector3(centre.x, box.min.y, centre.z).divide(character.group.scale);
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

  private pairs: [THREE.Mesh, THREE.Mesh][] = [];
  private source: THREE.Object3D | null = null;
  /** Where the feet sit under the character's origin, at a scale of one. */
  private foot = new THREE.Vector3();

  /** The doll takes the character's shape sliders, its height and what is visible, as they are now. */
  private follow(): void {
    if (!this.model || !this.source) return;
    for (const [src, dst] of this.pairs) {
      if (src.morphTargetInfluences && dst.morphTargetInfluences) for (let i = 0; i < src.morphTargetInfluences.length; i++) dst.morphTargetInfluences[i] = src.morphTargetInfluences[i];
      dst.visible = src.visible;
    }
    if (!this.model.scale.equals(this.source.scale)) {
      this.model.scale.copy(this.source.scale);
      this.model.position.copy(this.foot).multiply(this.source.scale).negate();
    }
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
    if (this.dof) {
      this.renderer.getDrawingBufferSize(this.bufferSize);
      this.dof.setSize(this.bufferSize.x, this.bufferSize.y);
    }
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
    this.follow();
    const cp = Math.cos(this.pitch);
    this.camera.position.set(Math.sin(this.yaw) * cp * this.distance + this.pan.x, this.height + Math.sin(this.pitch) * this.distance + this.pan.y, Math.cos(this.yaw) * cp * this.distance + this.pan.z);
    this.camera.lookAt(this.pan.x, this.height + this.pan.y, this.pan.z);
    this.draw(this.model);
    // On the lens path three's counts hold only its last render() (the quad): the lens keeps the frame's.
    const lensed = this.lens && this.dof !== null;
    this.lastRender = {
      calls: lensed ? this.dof!.last.calls : this.renderer.info.render.calls,
      triangles: lensed ? this.dof!.last.triangles : this.renderer.info.render.triangles,
      camera: this.camera.position.toArray().map((v) => Number(v.toFixed(2))),
      path: this.lens ? 'lens' : 'direct',
    };
  };

  /**
   * Straight onto the canvas as always, or, with the depth of field on and the doll close enough for a
   * lens to show on it (more than a pixel of blur, less than 0.7 px to go back), through its lens.
   */
  private draw(model: THREE.Object3D): void {
    const fx = CharacterPreview.effects;
    if (fx.on && fx.strength > 0 && PreviewDof.supported(this.renderer)) {
      const dof = this.dofFor();
      if (this.warmedFor !== model) {
        this.warmedFor = model;
        void dof.warm(this.scene, this.camera);
      }
      // The doll turns about the vertical axis at the origin (refresh centres it there); its
      // front-to-back depth is the rest pose's, rescaled by the height slider since.
      const k = model.scale.y / this.builtScale;
      const r = Math.min(PREVIEW_DOF.halfDepthMax, Math.max(PREVIEW_DOF.halfDepthMin, 0.5 * this.modelSize.z * k));
      previewSpan(this.distance, Math.hypot(this.camera.position.x, this.camera.position.z), r, this.camera.near, this.span);
      this.lastGate = previewGate(this.renderer.getDrawingBufferSize(this.bufferSize).y, fx.strength, this.span);
      this.lens = fx.view === 1 || previewLensOn(this.lens, this.lastGate);
      if (this.lens) dof.render(this.scene, this.camera, this.span, this.lastGate, fx.strength, fx.view);
      else this.renderer.render(this.scene, this.camera);
      return;
    }
    this.lens = false;
    this.lastGate = 0;
    if (this.dof) {
      this.dof.dispose();
      this.dof = null;
      this.warmedFor = null;
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** The doll's lens, made and sized on first use. */
  private dofFor(): PreviewDof {
    if (!this.dof) {
      this.dof = new PreviewDof(this.renderer);
      this.renderer.getDrawingBufferSize(this.bufferSize);
      this.dof.setSize(this.bufferSize.x, this.bufferSize.y);
    }
    return this.dof;
  }

  /** For __debug.previewDof: which path the doll draws by, and why. */
  dofReport(): PreviewReport {
    return {
      running: this.running,
      path: this.lens ? 'lens' : 'direct',
      gate: Number(this.lastGate.toFixed(3)),
      maxRadiusPx: this.dof ? Number(this.dof.last.maxRadiusPx.toFixed(2)) : 0,
      span: { focus: Number(this.span.focus.toFixed(3)), nearest: Number(this.span.nearest.toFixed(3)), farthest: Number(this.span.farthest.toFixed(3)) },
      size: this.dof?.last.size ? [this.dof.last.size[0], this.dof.last.size[1]] : null,
      warmed: this.model !== null && this.warmedFor === this.model,
    };
  }

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
    // The first frame after opening compiles both of the doll's program variants (direct and lens).
    this.warmedFor = null;
    requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    // The lens target's memory goes back while the panel is shut; the next lens frame sizes it again.
    this.dof?.release();
    this.lens = false;
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
