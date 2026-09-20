// A lightsaber blade as the films have it: a white core inside a coloured glow, both drawn as
// ribbons that face the camera (so the blade reads the same from every side), the tip rounded,
// and behind the blade a smear: the surface the blade swept over the last fraction of a second,
// fading with age, so a blade in motion looks drawn out along its path. A swing sweeps far, so
// the smear is long; a walk sweeps little, so it is a shimmer; a still blade has none at all.
// Everything adds light rather than covering, and nothing writes depth, so blades cross cleanly.
import * as THREE from 'three';
import { sabers } from '../audio/saberSounds.ts';

/** What a saber's blade file gives: its length and width in metres, and the seconds to ignite and retract. */
export interface BladeSpec {
  length: number;
  width: number;
  open: number;
  close: number;
}

/** Samples of where the blade was, newest first. */
const HISTORY = 14;
/** Points along the blade the smear surface is built from. */
const ALONG = 7;
/** How long a swept sample lasts (seconds), at rest and boosted by a swing. */
const SMEAR_LIFE = 0.045;
const SMEAR_LIFE_SWING = 0.1;
/** The glow's width over the file's, the core's share of it, and their brightness over white (for the bloom to catch). */
const GLOW_WIDTH = 1.8;
const CORE_WIDTH = 0.26;
const CORE_BRIGHT = 2.4;
const GLOW_BRIGHT = 1.1;
/** The smear's brightness over the blade's: a veil behind it, not a second blade. */
const SMEAR_BRIGHT = 0.4;
/** Seconds the blade takes to come out and go back (the files say 1.5, which reads as slow motion). */
const IGNITE = 0.32;

const RIBBON_VERT = /* glsl */ `
  attribute float aFade;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    vUv = uv;
    vFade = aFade;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
/**
 * Across the ribbon (u) the light falls off from the middle; along it (v) the base and the tip
 * are capped softly. `uSoft` is where the falloff starts: near the edge for a hard core, near
 * the middle for a wide soft glow. The alpha is folded into the colour: the blend is additive.
 */
const RIBBON_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uBright;
  uniform float uSoft;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    float x = abs(vUv.x * 2.0 - 1.0);
    // No falloff at all when the soft edge is at the rim (a smear surface): smoothstep's edges must differ.
    float across = uSoft >= 1.0 ? 1.0 : 1.0 - smoothstep(uSoft, 1.0, x);
    across *= across;
    float along = smoothstep(0.0, 0.04, vUv.y) * (1.0 - smoothstep(0.9, 1.0, vUv.y));
    gl_FragColor = vec4(uColor * (across * along * vFade * uBright), 1.0);
  }
`;

function ribbonMaterial(color: THREE.Color, bright: number, soft: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: RIBBON_VERT,
    fragmentShader: RIBBON_FRAG,
    uniforms: { uColor: { value: color }, uBright: { value: bright }, uSoft: { value: soft } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/** A strip of `rows` × 2 vertices with uv, position and fade attributes, indexed as quads. */
function strip(rows: number, columns: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const n = rows * columns;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  g.setAttribute('aFade', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  const index: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < columns - 1; c++) {
      const i = r * columns + c;
      index.push(i, i + 1, i + columns, i + 1, i + columns + 1, i + columns);
    }
  }
  g.setIndex(index);
  return g;
}

const dir = new THREE.Vector3();
const toCam = new THREE.Vector3();
const side = new THREE.Vector3();
const pt = new THREE.Vector3();
const end = new THREE.Vector3();
const mid = new THREE.Vector3();
const localBase = new THREE.Vector3();

export class SaberBlade {
  readonly group = new THREE.Group();
  readonly color = new THREE.Color(0x3aa0ff);
  private readonly coreColor = new THREE.Color();
  private readonly glow: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly core: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly smearGlow: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly smearCore: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly history: { a: THREE.Vector3; b: THREE.Vector3; age: number }[] = [];
  /** How far the blade is out, 0 to 1. */
  private lit = 0;
  /** The frame the sweep is remembered in (a moving ship's hull), and whether there is one. */
  private readonly frameM = new THREE.Matrix4();
  private readonly frameInv = new THREE.Matrix4();
  private framed = false;
  spec: BladeSpec = { length: 1.1, width: 0.12, open: IGNITE, close: IGNITE };
  /** The blade as drawn this frame, world space: the emitter, and the end of the part that is out. The light it throws is read from here. */
  readonly drawnBase = new THREE.Vector3();
  readonly drawnTip = new THREE.Vector3();
  /** Whether `update` drew the blade this frame (cleared at the start of every update and by reset()). */
  private drawn = false;
  /** What the sound was last told about this blade, so it is told only when it changes. */
  private sounding = false;

  /** How far out the blade is, 0 to 1. */
  get ignition(): number {
    return this.lit;
  }

  /** Drawn this frame, with its group and every parent visible up to a scene: a blade that gives light. */
  get glowing(): boolean {
    if (!this.drawn) return false;
    for (let o: THREE.Object3D | null = this.group; o; o = o.parent) {
      if (!o.visible) return false;
      if ((o as THREE.Scene).isScene) return true;
    }
    // Not in a scene: a fighter's blade whose group was never added.
    return false;
  }

  constructor() {
    this.setColor(this.color.getHex());
    this.glow = new THREE.Mesh(strip(3, 2), ribbonMaterial(this.color, GLOW_BRIGHT, 0.0));
    this.core = new THREE.Mesh(strip(3, 2), ribbonMaterial(this.coreColor, CORE_BRIGHT, 0.45));
    this.smearGlow = new THREE.Mesh(strip(HISTORY, ALONG), ribbonMaterial(this.color, GLOW_BRIGHT * SMEAR_BRIGHT, 0.0));
    this.smearCore = new THREE.Mesh(strip(HISTORY, ALONG), ribbonMaterial(this.coreColor, CORE_BRIGHT * SMEAR_BRIGHT * 0.5, 0.2));
    // The smear's uv runs along the blade in v and across the sweep in u: no edge falloff across it.
    this.smearGlow.material.uniforms.uSoft.value = 1.0;
    this.smearCore.material.uniforms.uSoft.value = 1.0;
    for (const m of [this.glow, this.core, this.smearGlow, this.smearCore]) {
      m.frustumCulled = false;
      m.renderOrder = 6;
      m.visible = false;
      this.group.add(m);
    }
    for (let i = 0; i < HISTORY; i++) this.history.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), age: Infinity });
  }

  /** The glow's colour; the core stays near white, warmed a little toward it. */
  setColor(hex: number | string): void {
    this.color.set(hex);
    this.coreColor.set(0xffffff).lerp(this.color, 0.18);
  }

  /** Nothing drawn, and the swept history forgotten (a teleport, a holster). */
  reset(): void {
    this.lit = 0;
    this.drawn = false;
    // Nothing drawn and nothing heard: a blade put away this way never fades its hum out over a
    // place it is no longer in.
    this.sounding = false;
    sabers.forget(this);
    for (const h of this.history) h.age = Infinity;
    for (const m of [this.glow, this.core, this.smearGlow, this.smearCore]) m.visible = false;
  }

  /**
   * The white core, when lit and drawn in a scene: the part of the blade that must stay a sharp line
   * under the depth of field's lens (its glow depth). Fills `out` from `n`; returns the new count.
   */
  glowCore(out: THREE.Object3D[], n: number): number {
    if (this.core.visible && this.glowing) out[n++] = this.core;
    return n;
  }

  /**
   * Draw the blade from `base` (the hilt's emitter) toward `tip` (the full blade's end) this frame.
   * `on` ignites or retracts it; `swing` (0 to 1) is how hard it is being swung, which lengthens the smear.
   */
  update(dt: number, base: THREE.Vector3, tip: THREE.Vector3, on: boolean, camera: THREE.Camera, swing: number, snap = false, frame: THREE.Matrix4 | null = null): void {
    // Every blade in the world is heard through its own renderer, so a blade whose renderer stops
    // being called (a mobile culled behind the camera, a body dying off screen) would leave its hum
    // hanging where it was. This is the one call that happens on every frame whatever else is going
    // on -- the player's blades run through it whether they are lit or not -- so the sweep for such
    // hums hangs here, before any of the early returns below.
    sabers.tick();
    // Retracted, or with no length, the early returns below leave this false: no light.
    this.drawn = false;
    const openRate = 1 / Math.max(0.05, Math.min(IGNITE, this.spec.open));
    const closeRate = 1 / Math.max(0.05, Math.min(IGNITE, this.spec.close));
    this.lit = snap ? (on ? 1 : 0) : THREE.MathUtils.clamp(this.lit + (on ? openRate : -closeRate) * dt, 0, 1);
    // The sweep is remembered in a frame: the world's, or aboard a moving ship the hull's, so the
    // ship's own motion is no smear. A change of frame forgets the path.
    // The blade is also what the ear hears: it lights and goes out here, it hums here while it is
    // out, and the rain hisses off it here. A blade snapped on or off (the thrown saber leaving the
    // hand and coming back, a world arriving with the saber already lit) changes state without
    // igniting, so it is switched quietly.
    if (on !== this.sounding) {
      this.sounding = on;
      sabers.ignite(this, on, base, { quiet: snap });
    }
    const framed = frame !== null;
    if (framed !== this.framed) for (const h of this.history) h.age = Infinity;
    this.framed = framed;
    if (frame) {
      this.frameM.copy(frame);
      this.frameInv.copy(frame).invert();
    } else {
      this.frameM.identity();
      this.frameInv.identity();
    }
    localBase.copy(base).applyMatrix4(this.frameInv);
    // A jump (a teleport, a catch back into the hand) is not a sweep: forget the path.
    if (Number.isFinite(this.history[0].age) && this.history[0].a.distanceToSquared(localBase) > 4) for (const h of this.history) h.age = Infinity;
    if (this.lit <= 0.001) {
      for (const h of this.history) h.age = Infinity;
      for (const m of [this.glow, this.core, this.smearGlow, this.smearCore]) m.visible = false;
      return;
    }
    dir.copy(tip).sub(base);
    const full = dir.length();
    if (full < 1e-4) return;
    dir.divideScalar(full);
    // The blade as far as it is out, its end rounded off.
    const length = full * this.lit;
    end.copy(base).addScaledVector(dir, length);
    this.ribbon(this.glow, base, end, this.spec.width * GLOW_WIDTH, camera);
    this.ribbon(this.core, base, end, this.spec.width * CORE_WIDTH, camera);
    this.glow.visible = this.core.visible = true;
    this.drawnBase.copy(base);
    this.drawnTip.copy(end);
    this.drawn = true;
    // The hum follows the drawn blade rather than the hilt: the tip's own speed is what makes it
    // rise through a swing, and it is the one measure a fighter's blade has as well as the player's.
    sabers.hum(this, base, end, dt);
    // The sweep: this frame's blade in front, older ones behind it, fading with age.
    for (let i = HISTORY - 1; i > 0; i--) {
      this.history[i].a.copy(this.history[i - 1].a);
      this.history[i].b.copy(this.history[i - 1].b);
      this.history[i].age = this.history[i - 1].age + dt;
    }
    this.history[0].a.copy(localBase);
    this.history[0].b.copy(end).applyMatrix4(this.frameInv);
    this.history[0].age = 0;
    const life = SMEAR_LIFE + (SMEAR_LIFE_SWING - SMEAR_LIFE) * THREE.MathUtils.clamp(swing, 0, 1);
    this.sweep(this.smearGlow, life, 2);
    this.sweep(this.smearCore, life * 0.6, 3);
  }

  /** A camera-facing strip from `a` to `b`, `width` across, in three rows so the tip narrows. */
  private ribbon(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>, a: THREE.Vector3, b: THREE.Vector3, width: number, camera: THREE.Camera): void {
    toCam.copy(camera.position).sub(a);
    side.crossVectors(dir, toCam);
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
    side.normalize().multiplyScalar(width / 2);
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
    const rows: [THREE.Vector3, number, number][] = [
      [a, 0, 1],
      [mid.copy(a).lerp(b, 0.9), 0.9, 1],
      [b, 1, 0.45],
    ];
    let k = 0;
    for (const [p, v, w] of rows) {
      pos.setXYZ(k, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w);
      uv.setXY(k, 0, v);
      k++;
      pos.setXYZ(k, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w);
      uv.setXY(k, 1, v);
      k++;
    }
    pos.needsUpdate = true;
    uv.needsUpdate = true;
  }

  /** The swept surface: a row per remembered blade, `ALONG` points along each, fading by age. */
  private sweep(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>, life: number, power: number): void {
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
    const fade = mesh.geometry.getAttribute('aFade') as THREE.BufferAttribute;
    let any = false;
    for (let r = 0; r < HISTORY; r++) {
      const h = this.history[r];
      // A row with nothing remembered yet, or too old, folds onto the row before it: zero area.
      const src = Number.isFinite(h.age) ? h : this.history[Math.max(0, r - 1)];
      let f = Number.isFinite(h.age) ? Math.max(0, 1 - h.age / life) : 0;
      f = Math.pow(f, power);
      if (r > 0 && f > 0.01) any = true;
      for (let c = 0; c < ALONG; c++) {
        const s = c / (ALONG - 1);
        const i = r * ALONG + c;
        pt.copy(src.a).lerp(src.b, s).applyMatrix4(this.frameM);
        pos.setXYZ(i, pt.x, pt.y, pt.z);
        uv.setXY(i, 0.5, s);
        fade.setX(i, f);
      }
    }
    pos.needsUpdate = true;
    uv.needsUpdate = true;
    fade.needsUpdate = true;
    mesh.visible = any;
  }

  dispose(): void {
    this.sounding = false;
    sabers.forget(this);
    for (const m of [this.glow, this.core, this.smearGlow, this.smearCore]) {
      m.geometry.dispose();
      m.material.dispose();
    }
  }
}
