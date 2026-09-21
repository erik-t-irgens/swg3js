// The ship's edit page's model: the ship as fitted, on its own canvas, turning slowly until it is
// dragged.
//
// Like the wardrobe's doll it has a WebGL context of its own rather than a second view of the
// world: the world's lights and materials stay as they are, so nothing in the world recompiles
// because a preview is lit differently. It shares the garage's geometry and materials (the model
// is a clone of the loaded ship, as a spawned one is) and uploads its own copies of their
// textures; it never disposes a geometry or a garage material, since a dispose event reaches the
// world renderer's copy too. The context is made when the page first opens, never at boot, and is
// made again (a fresh canvas) after a few ships have been shown, since only losing the context
// frees the textures it uploaded.
//
// A model is compiled a drawable at a time with a breath between (World.compileReady's way): a
// whole freighter at once is dozens of programs in one main-thread task while the world draws
// behind the page. A material the world has already set up for its shadow cascades keeps the
// world's record through the compile (`keepShadows`).

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { cellIndexOf } from '../vehicles/interior';
import type { WingSet } from '../vehicles/wings';
import type { ShipPaint } from '../vehicles/shipPaint';

/** How fast the ship turns on its own until the view is dragged (rad/s). */
const AUTO_TURN = 0.22;
/** The camera's starting turn and tilt: a three-quarter view from the front, a little above. */
const START_YAW = 0.75;
const START_PITCH = 0.28;
/** Textures newly uploaded between yields while a model is prepared. */
const UPLOADS_PER_BREATH = 4;
/** Ships shown in one context before a change of ship makes the context again (its uploaded textures go with it). */
const SHIPS_PER_CONTEXT = 3;

export interface ShipPreviewOptions {
  /**
   * Called with a drawable's materials just before it is compiled here; the function it returns is called
   * right after the compile's synchronous part. The world's shadow cascades keep one shader record per
   * material, the last compiled in any context, and move the cascades' uniforms in that one only: this puts
   * the world's back, so a compile here never takes them from the world's program.
   */
  keepShadows?: (materials: THREE.Material[]) => () => void;
}

export class ShipPreview {
  private canvasEl: HTMLCanvasElement;
  private renderer!: THREE.WebGLRenderer;
  private envTarget!: THREE.WebGLRenderTarget;
  /** Settles when the current context is given up, so a compile waiting on a lost context lets go. */
  private retired!: Promise<void>;
  private retire: () => void = () => {};
  /** Models shown (not restaged) in the current context. */
  private shipsInContext = 0;
  /**
   * Prepares running now. The context is only made again when none is: three polls a compile's linking
   * with a chained timer that never ends on a lost context.
   */
  private compiling = 0;
  private readonly keepShadows: ShipPreviewOptions['keepShadows'];
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);
  /** What turns: the model's holder hangs under it. */
  private readonly pivot = new THREE.Group();
  private readonly observer: ResizeObserver;
  private holder: THREE.Object3D | null = null;
  private wings: WingSet | null = null;
  private paint: ShipPaint | null = null;
  /** A show() superseded by a later one drops its model instead of putting it up. */
  private showGen = 0;
  private wingsOpen = false;
  private running = false;
  /** The pending animation frame (0: none), cancelled on stop so a stop and a start in one step never leave two loops. */
  private raf = 0;
  private lastTime = 0;
  /** The model's framing: the middle the camera looks at and the sphere's radius round it. */
  private readonly centre = new THREE.Vector3();
  private radius = 5;
  private yaw = START_YAW;
  private pitch = START_PITCH;
  private distance = 20;
  private readonly pan = new THREE.Vector3();
  /** Set once the view is dragged, turned or zoomed: the ship stops turning on its own and nothing reframes it until a double-click. */
  private userFramed = false;
  private dragging = false;
  private panning = false;
  private lastX = 0;
  private lastY = 0;
  /** Frames drawn, and contexts made, for the console. */
  frames = 0;
  contexts = 0;

  constructor(opts: ShipPreviewOptions = {}) {
    this.keepShadows = opts.keepShadows;
    // Everything a spawned ship draws, whichever layers the world put it on.
    this.camera.layers.enableAll();
    this.scene.add(this.pivot);
    // Lit its own way, the same at midnight as at noon: a key, a fill, a rim and a sky, and a room's reflections for the metal.
    // Made once; a new context compiles for the same four.
    const key = new THREE.DirectionalLight(0xfff4e2, 2.4);
    key.position.set(3, 4, 3);
    const fill = new THREE.DirectionalLight(0x9fc4e8, 1.0);
    fill.position.set(-3.5, 1.2, 1.5);
    const rim = new THREE.DirectionalLight(0xffffff, 1.3);
    rim.position.set(-1, 2.5, -4);
    this.scene.add(key, fill, rim, new THREE.HemisphereLight(0xbcd3e8, 0x35302a, 0.9));
    this.scene.environmentIntensity = 0.5;
    // The panel sizes the canvas with CSS: watching it keeps the drawing buffer the shape of the box.
    this.observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      this.resize(Math.round(box.width), Math.round(box.height));
      // Sizing empties the buffer after this frame's draw: drawn again before it is shown, so a window
      // being sized never shows an empty stage. The camera is placed first, since the fit may have moved.
      if (this.running && this.holder) {
        this.placeCamera();
        this.renderer.render(this.scene, this.camera);
      }
    });
    this.canvasEl = this.makeContext();
  }

  /** The canvas drawn into (a new one after the context is made again; it takes the old one's place in the page). */
  get canvas(): HTMLCanvasElement {
    return this.canvasEl;
  }

  /** The model shown now (its holder), or null. */
  get model(): THREE.Object3D | null {
    return this.holder;
  }

  /** A canvas, its renderer and the environment the metal reflects; the drag and the size follow the canvas. */
  private makeContext(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.className = 'preview-canvas';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.envTarget = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    this.scene.environment = this.envTarget.texture;
    this.retired = new Promise<void>((resolve) => {
      this.retire = resolve;
    });
    this.shipsInContext = 0;
    this.contexts++;
    this.bindDrag(canvas);
    this.observer.observe(canvas);
    return canvas;
  }

  /** Give up the context and make another on a fresh canvas in the same place (nothing is shown at the time). */
  private renewContext(): void {
    const old = this.canvasEl;
    const width = old.clientWidth;
    const height = old.clientHeight;
    this.observer.unobserve(old);
    this.retire();
    this.envTarget.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvasEl = this.makeContext();
    old.replaceWith(this.canvasEl);
    this.resize(width, height);
  }

  /**
   * Show a model: the old one comes down (its paint disposed), the new one is compiled in this
   * context before it is drawn, and framed. A show() overtaken by a later one while it compiles
   * disposes its own paint and shows nothing.
   */
  async show(holder: THREE.Object3D, wings: WingSet, paint: ShipPaint | null): Promise<void> {
    const gen = ++this.showGen;
    holder.position.set(0, 0, 0);
    holder.quaternion.identity();
    holder.updateMatrixWorld(true);
    // Already compiled here when it came through this preview's prepare; then this walk finds every program made and yields nowhere.
    await this.prepare([holder]);
    if (gen !== this.showGen) {
      if (paint !== this.paint) paint?.dispose();
      return;
    }
    this.takeDown();
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.add(holder);
    this.holder = holder;
    this.wings = wings;
    this.paint = paint;
    this.shipsInContext++;
    wings.force = this.wingsOpen ? 'open' : 'closed';
    wings.snap(this.wingsOpen);
    this.frame(holder);
  }

  /**
   * Take the model down and dispose its paint (the page is about to build another ship, or went away).
   * After a few ships the context is made again here, while nothing is shown, so the textures of the
   * ships browsed past are freed.
   */
  clear(): void {
    this.showGen++;
    this.takeDown();
    // With a compile still going (the last ship's restage), the next change of ship tries again.
    if (this.shipsInContext >= SHIPS_PER_CONTEXT && this.compiling === 0) this.renewContext();
  }

  private takeDown(): void {
    if (this.holder) this.pivot.remove(this.holder);
    // The paint's copies and textures are this preview's own; the sources belong to the garage.
    this.paint?.dispose();
    this.holder = null;
    this.wings = null;
    this.paint = null;
  }

  /**
   * Compile roots in this context (the page's restage and the preview's ShipPaint call it): the
   * textures of what is drawn uploaded a few at a time, then the programs a drawable at a time with a
   * breath between (none where nothing new was made), so no step holds the main thread for long and the
   * first frame that draws them builds nothing. Nothing hidden is compiled (a portal hull's rooms are
   * never shown here). A hidden tab compiles each drawable at once: compileAsync waits on the linking
   * with a chained timer, which a hidden tab throttles to one a second and then one a minute.
   */
  async prepare(roots: THREE.Object3D[]): Promise<void> {
    this.compiling++;
    try {
      await this.prepareIn(this.renderer, this.retired, roots);
    } finally {
      this.compiling--;
    }
  }

  private async prepareIn(r: THREE.WebGLRenderer, gone: Promise<void>, roots: THREE.Object3D[]): Promise<void> {
    const drawables: THREE.Object3D[] = [];
    const textures = new Set<THREE.Texture>();
    for (const root of roots) {
      root.traverseVisible((o) => {
        if (!isDrawable(o)) return;
        drawables.push(o);
        for (const mat of materialsOf(o)) {
          for (const v of Object.values(mat)) if ((v as THREE.Texture | null)?.isTexture) textures.add(v as THREE.Texture);
        }
      });
    }
    let uploaded = 0;
    for (const t of textures) {
      if (r !== this.renderer) return;
      const before = r.info.memory.textures;
      r.initTexture(t);
      if (r.info.memory.textures !== before && ++uploaded % UPLOADS_PER_BREATH === 0) await breath();
    }
    for (const o of drawables) {
      // The context was given up meanwhile: what is left is compiled by whoever shows it next.
      if (r !== this.renderer) return;
      const before = r.info.programs?.length ?? 0;
      const restore = this.keepShadows?.(materialsOf(o));
      let job: Promise<unknown> | null = null;
      try {
        if (document.hidden) r.compile(soloRoot(o), this.camera, this.scene);
        else job = r.compileAsync(soloRoot(o), this.camera, this.scene);
      } finally {
        restore?.();
      }
      // With the parallel-compile extension a program already linked answers at once, so a model already
      // compiled here is walked in a few microtasks; the breath is only where a program was made.
      if (job) await Promise.race([job.catch(() => {}), gone]);
      if ((r.info.programs?.length ?? 0) !== before) await breath();
    }
  }

  /** Open or close the wings; they swing at the game's own pace. */
  setWingsOpen(open: boolean): void {
    this.wingsOpen = open;
    if (this.wings) this.wings.force = open ? 'open' : 'closed';
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  /** No frames drawn while the page is shut; the context and the model are kept for the next show. */
  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** The context goes; geometry and the garage's materials are left alone (the world draws them too). */
  dispose(): void {
    this.stop();
    this.showGen++;
    this.takeDown();
    this.observer.disconnect();
    this.retire();
    this.envTarget.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  /** What the preview holds and draws, for the console. */
  report(): { running: boolean; frames: number; programs: number; textures: number; contexts: number; shipsInContext: number; radius: number; distance: number; wingsOpen: boolean; wings: number } {
    return {
      running: this.running,
      frames: this.frames,
      programs: this.renderer.info.programs?.length ?? 0,
      textures: this.renderer.info.memory.textures,
      contexts: this.contexts,
      shipsInContext: this.shipsInContext,
      radius: round2(this.radius),
      distance: round2(this.distance),
      wingsOpen: this.wingsOpen,
      wings: this.wings?.length ?? 0,
    };
  }

  private readonly box = new THREE.Box3();
  private readonly local = new THREE.Box3();
  private readonly sphere = new THREE.Sphere();

  /**
   * Frame the shell: a box over the drawn meshes that are not a room past cell 0 (a portal
   * building's rooms are hidden and would triple the box), with the wings as they stand. The
   * camera backs off to fit the bounding sphere; near and far follow its size, so the corvette,
   * the Star Destroyer and the yacht fit as well as a fighter.
   */
  private frame(holder: THREE.Object3D): void {
    holder.updateMatrixWorld(true);
    this.box.makeEmpty();
    holder.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry || !visibleUnder(o, holder) || cellIndexOf(o) > 0) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      if (!m.geometry.boundingBox) return;
      this.local.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
      this.box.union(this.local);
    });
    if (this.box.isEmpty()) this.box.setFromCenterAndSize(new THREE.Vector3(0, 1, 0), new THREE.Vector3(2, 2, 2));
    this.box.getBoundingSphere(this.sphere);
    this.centre.copy(this.sphere.center);
    this.radius = Math.max(0.5, this.sphere.radius);
    this.camera.near = Math.max(0.05, this.radius / 200);
    this.camera.far = this.radius * 40;
    this.camera.updateProjectionMatrix();
    this.resetView();
  }

  /** Back to the whole ship, turning on its own again. */
  private resetView(): void {
    this.pan.set(0, 0, 0);
    this.yaw = START_YAW;
    this.pitch = START_PITCH;
    this.userFramed = false;
    this.distance = this.fitDistance();
  }

  /** How far back the camera must sit for the sphere to fit, the narrower of the two fields of view deciding. */
  private fitDistance(): number {
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * Math.max(0.2, this.camera.aspect));
    return (this.radius / Math.sin(Math.min(vHalf, hHalf))) * 1.1;
  }

  private resize(width: number, height: number): void {
    if (width < 8 || height < 8) return;
    // The window may have been carried to a screen of another scale, or the browser zoomed.
    const ratio = Math.min(window.devicePixelRatio, 2);
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (!this.userFramed) this.distance = this.fitDistance();
  }

  private bindDrag(c: HTMLCanvasElement): void {
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      this.dragging = e.button !== 2;
      this.panning = e.button === 2;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      c.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.dragging && !this.panning) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (this.panning) {
        // A pixel moves the target the same way on screen whatever the zoom.
        const perPixel = (2 * this.distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / Math.max(1, c.clientHeight);
        const cy = Math.cos(this.yaw);
        const sy = Math.sin(this.yaw);
        this.pan.x -= cy * dx * perPixel;
        this.pan.z += sy * dx * perPixel;
        this.pan.y += dy * perPixel;
      } else {
        this.yaw -= dx * 0.009;
        this.pitch = Math.min(Math.max(this.pitch + dy * 0.006, -1.3), 1.3);
      }
      this.userFramed = true;
    });
    const up = (e: PointerEvent) => {
      this.dragging = false;
      this.panning = false;
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('dblclick', () => this.resetView());
    c.addEventListener(
      'wheel',
      (e) => {
        this.distance = Math.min(Math.max(this.distance * (e.deltaY > 0 ? 1.12 : 1 / 1.12), this.radius * 0.25), this.radius * 12);
        this.userFramed = true;
        e.preventDefault();
      },
      { passive: false },
    );
  }

  /**
   * Draw every frame while the page is open (a canvas's buffer is not kept between composites).
   * Allocation-free: the wings step at their own pace, the ship turns until dragged.
   */
  private readonly tick = (): void => {
    this.raf = 0;
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (!this.holder) return;
    this.wings?.step(dt);
    if (!this.userFramed) this.yaw += AUTO_TURN * dt;
    this.placeCamera();
    this.renderer.render(this.scene, this.camera);
    this.frames++;
  };

  /** The camera on its orbit about the ship, from the turn, tilt, distance and slide as they are now. */
  private placeCamera(): void {
    const cp = Math.cos(this.pitch);
    const tx = this.centre.x + this.pan.x;
    const ty = this.centre.y + this.pan.y;
    const tz = this.centre.z + this.pan.z;
    this.camera.position.set(tx + Math.sin(this.yaw) * cp * this.distance, ty + Math.sin(this.pitch) * this.distance, tz + Math.cos(this.yaw) * cp * this.distance);
    this.camera.lookAt(tx, ty, tz);
  }
}

/** A mesh, sprite, points or line with a material: what the renderer draws and compiles. */
function isDrawable(o: THREE.Object3D): boolean {
  const m = o as THREE.Mesh;
  return (m.isMesh || (o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.Line).isLine) === true && !!m.material;
}

function materialsOf(o: THREE.Object3D): THREE.Material[] {
  const mat = (o as THREE.Mesh).material;
  return Array.isArray(mat) ? mat : mat ? [mat] : [];
}

/** A stand-in root the renderer walks as just this one drawable (its children are compiled on their own turn, and hidden ones never). */
function soloRoot(o: THREE.Object3D): THREE.Object3D {
  const root = new THREE.Object3D();
  root.traverse = (cb: (x: THREE.Object3D) => void) => {
    cb(o);
  };
  root.traverseVisible = () => {};
  return root;
}

/** Drawn: this node and every parent up to the holder visible. */
function visibleUnder(o: THREE.Object3D, top: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    if (!n.visible) return false;
    if (n === top) return true;
  }
  return true;
}

/** A yield between compile steps (World.breath's): a zero timer, so a frame can fall between; a message to itself in a hidden tab, whose timers are throttled. */
function breath(): Promise<void> {
  return new Promise((resolve) => {
    if (!document.hidden) {
      setTimeout(resolve, 0);
      return;
    }
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(0);
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
