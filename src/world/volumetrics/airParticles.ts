// The kick-up pool (the fourth wave, the design's §2.16): leaves off grass and forest litter, puffs of the game's own
// sand cloud off sand, ash and dirt, spray off water (the game's own trail's look behind a machine crossing it, the
// owner's Q14), and fine streaks of ours (Q7), each a particle that lives on the graphics card and reads the air
// directly. One multi-target pair (three RGBA32F attachments: position and age, velocity and life, seed, size, a spare
// and the colour packed), rows by kind, one update draw a frame the field runs its update, and four instanced draws with
// no instanced attribute (the leaves cut and writing depth; the puffs, spray and streaks blended, one program between
// them). Positions are relative to the air window's corner, its height a corner of the pool's own snapped to whole metres,
// so a slow drift moves at its own speed eight kilometres out at any frame rate (`airParticleMath.ts`' `driftOver`).
//
// **What it borrows** (§2.16): the game's own pictures, read from the converted packs at run time and never copied -- the
// leaf (`pt_leaf_single`, the green `pt_leaf` where a world's pack has it), the sand cloud (`pt_sand_cloud`) and the
// spray (`pt_fountain_splash_alpha`, Dathomir's own `pt_sm_splash_bright` there) -- handed in by the world
// (`setPicture`); a kind whose picture is in no pack draws nothing and says why. A borrowed texture is let go to a 1×1
// stand-in before the world unloads, never left on a material for the next draw to upload (`dropPictures`).
//
// **Nothing here is built in play** (rule 2): every material is made with the pool, compiled behind a loading screen or
// the master's in-play warm; a detail dial resizes the targets and the meshes' instance counts (class T) and never
// disposes a material. Nothing about a particle is read back to decide anything (rule 3); the console's counts are a
// readback of their own.
import * as THREE from 'three';
import { AIR_VERTEX } from './airShaders.ts';
import { KICK_DRAW_FRAGMENT, KICK_DRAW_VERTEX, KICK_FILL_FRAGMENT, KICK_UPDATE_FRAGMENT, RING_FRAGMENT, RING_VERTEX } from './airParticleShaders.ts';
import { KICK_KINDS, SPAWN_MOST, SPAWN_W, type SpawnTable } from './airSpawn.ts';
import { AIR_TUNE } from './airTune.ts';
import { CARD_LIGHT_UNIFORMS } from '../cardLight.ts';
import { GRASS_UNIFORMS } from '../grass.ts';

/** The pool's texture width: every count by preset is a whole number of its rows. */
export const KICK_WIDTH = 128;

/** Each kind's count at the High preset (`volParticleDetail` ×1): leaves, puffs, spray, streaks [ours, §2.16; streaks ours, Q7]. */
export const KICK_COUNTS: readonly number[] = [2048, 256, 1024, 1024];

/** The rows each kind takes at a detail (×0.5, ×1, ×2): its count over the width, at least one. */
export function kickRows(detail: number, out: number[] = [0, 0, 0, 0]): number[] {
  for (let k = 0; k < KICK_KINDS; k++) out[k] = Math.max(1, Math.round((KICK_COUNTS[k] * detail) / KICK_WIDTH));
  return out;
}

/** The pool's memory on the card at a detail, bytes: three RGBA32F attachments a slot, ping-ponged. */
export function kickBytes(detail: number): number {
  const rows = kickRows(detail);
  let n = 0;
  for (const r of rows) n += r;
  return n * KICK_WIDTH * 16 * 3 * 2;
}

/** What the pool reads of the field, by reference: the kept uniform objects the field writes in place. */
export interface KickSources {
  window: { value: THREE.Vector4 };
  wind: { value: THREE.Vector2 };
  height: { value: THREE.Texture | null };
  obstacles: { value: THREE.Texture | null };
  klass: { value: THREE.Texture | null };
  colour: { value: THREE.Texture | null };
  tint: { value: THREE.Texture | null };
  light: { value: THREE.Texture | null };
  lightShift: { value: THREE.Vector2 };
  lightHeights: { value: THREE.Vector4 };
  slabTiles: { value: THREE.Vector4[] };
  slabScale: { value: THREE.Vector4 };
  slabShare: { value: THREE.Vector4 };
  atlasHalf: { value: THREE.Vector2 };
  slabMid: { value: THREE.Vector4 };
  obstacleOver: { value: number };
  hullInverse: { value: THREE.Matrix4 };
  hullBox: { value: THREE.Vector4 };
  groundTint: { value: THREE.Vector4 };
  groundTintRef: { value: THREE.Vector4 };
}

/** The sky's light the blended kinds take (the volume's dust's: the sun, toward it, and the ambient), written by the world each frame. */
export interface KickLight {
  sunDir: { value: THREE.Vector3 };
  sunColour: { value: THREE.Color };
  ambient: { value: THREE.Color };
}

export function newKickLight(): KickLight {
  return { sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColour: { value: new THREE.Color(1, 1, 1) }, ambient: { value: new THREE.Color(0.3, 0.3, 0.3) } };
}

/** A one-texel picture a kind draws with while it has none of its own (white, so a streak's shape is all it shows). */
function standInPicture(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.needsUpdate = true;
  t.name = 'air.kick.standIn';
  return t;
}

function poolTarget(w: number, h: number, name: string): THREE.WebGLRenderTarget {
  const t = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    generateMipmaps: false,
    count: 3,
  });
  t.texture.name = name;
  for (let i = 1; i < t.textures.length; i++) t.textures[i].name = `${name}.${i}`;
  return t;
}

/** A quad of four corners, two triangles: what every instance is drawn from. */
function quadGeometry(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.instanceCount = 0;
  return g;
}

/** What `KickPool.count` read back: live particles by kind, the leaves lying, the wind's pickups and the wake's spray. */
export interface KickCount {
  live: [number, number, number, number];
  lying: number;
  flying: number;
  pickups: number;
  wake: number;
  /** Drops of spray that landed back in the water on the frame read (the fifth wave's rings). */
  rings: number;
}

export class KickPool {
  readonly width = KICK_WIDTH;
  /** Each kind's first row and rows, at the detail in force. */
  readonly rowStart = [0, 0, 0, 0];
  readonly rows = [0, 0, 0, 0];
  private sized = -1;
  pair: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  readonly updateMaterial: THREE.ShaderMaterial;
  readonly fillMaterial: THREE.ShaderMaterial;
  /** The leaves' material (cut, writing depth) and the blended kinds' (one program between them, a material each). */
  readonly cutMaterial: THREE.ShaderMaterial;
  readonly blendMaterials: THREE.ShaderMaterial[];
  /** A mesh a kind, standing at the corner: leaves, puffs, spray, streaks. */
  readonly meshes: THREE.Mesh[];
  /** A stand-in a material for the sweep and the in-play warm (`World.kickStandIns`), each one instance of nothing. */
  readonly standIns: THREE.Mesh[];
  /** The window's moves owed the next update, metres (the field adds each move's whole cells), and the corner's height (whole metres). */
  readonly shift = new THREE.Vector3();
  cornerY = 0;
  /**
   * This frame's numbers, written field by field by the field before `placeCorner`, `step` and `writeDraws` (no number is
   * handed across a call on the frame's path): the frame's dt, the window's corner, the sand's lift threshold, the storm,
   * the window's edge band, the camera's height, the screen's height in pixels, the dust's brightness, whether the light
   * pass and the leaves' shadow are on. Each starts a fraction so it is a double from its first write.
   */
  readonly frame = { dt: 0.5, ox: 0.5, oz: 0.5, threshold: 0.5, storm: 0.5, edge: 0.5, camY: 0.5, screen: 1080.5, bright: 0.5, lightOn: true, shadows: true };
  /** The air's pending scroll (window uv), written by the field before each step. */
  readonly velShift = new THREE.Vector2();
  /** Each kind's ring head, and whether the pool must start again empty at its next update. */
  private readonly head = new Float64Array(KICK_KINDS);
  needsFill = true;
  /** Set by `step` on a frame the update drew; the draws are hidden on any other (§2.4). */
  shown = false;
  /** Each kind's switch, its picture (borrowed or the pool's own) and why it draws nothing. */
  readonly on = [true, true, true, true];
  readonly pictures: (THREE.Texture | null)[] = [null, null, null, null];
  readonly why: (string | null)[] = ['no picture yet', 'no picture yet', 'no picture yet', null];
  private readonly stand = standInPicture();
  /** Frames the field ran and the pool stepped, and frames hidden while the field ran (which should be none). */
  readonly stats = { steps: 0, hiddenWhileRun: 0, fills: 0, spawned: new Float64Array(KICK_KINDS) };
  private frameSeed = 1;
  private readonly kP = new THREE.Vector4(1 / 60, 1, 0, KICK_WIDTH);
  private readonly kShift = new THREE.Vector4();
  private readonly kKind = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
  private readonly kOn = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
  private readonly recA = new Float32Array(SPAWN_MOST * 4);
  private readonly recB = new Float32Array(SPAWN_MOST * 4);
  private readonly recC = new Float32Array(SPAWN_MOST * 4);
  private readonly recD = new Float32Array(SPAWN_MOST * 4);
  private readonly pick = new THREE.Vector4();
  private readonly tau = new THREE.Vector4();
  private readonly grav = new THREE.Vector4();
  private readonly leaf = new THREE.Vector4();
  private readonly lift = new THREE.Vector4();
  private readonly liftB = new THREE.Vector4();
  private readonly pickLife = new THREE.Vector4();
  private readonly pickSize = new THREE.Vector4();
  private readonly streak = new THREE.Vector4();
  private readonly streakD = new THREE.Vector4();
  private readonly drawP = new THREE.Vector4(2.5, 0.15, 0, 1080);
  private readonly drawE = new THREE.Vector4(0.08, 0.6, 0.6, 1.2);
  private readonly drawW = new THREE.Vector4(3, 0.19, 0.88, 0.7);
  private readonly phase = new THREE.Vector4(0.55, 1.6, 6, 1);
  private readonly shade = new THREE.Vector4(1, 0, 0, 0);
  private readonly drawK: THREE.Vector4[] = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
  private readonly drawQ: THREE.Vector4[] = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
  private readonly fragK: THREE.Vector4[] = [new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(1, 0, 0.5, 0), new THREE.Vector4(2, 0, 0, 0), new THREE.Vector4(3, 1, 0, 0)];
  private readonly s0 = { value: null as THREE.Texture | null };
  private readonly s1 = { value: null as THREE.Texture | null };
  private readonly s2 = { value: null as THREE.Texture | null };
  /**
   * The spray's rings (the fifth wave): the update's flag (x one: a drop landing back on the water is kept a frame as a
   * ring), and the draw that presses each into the ripples' state, additive, one instance a spray slot.
   */
  readonly ring = new THREE.Vector4(0, 0, 0, 0);
  readonly ringMaterial: THREE.ShaderMaterial;
  readonly ringMesh: THREE.Mesh;
  private readonly ringScene = new THREE.Scene();
  private readonly ringCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly ringK = new THREE.Vector4(0, KICK_WIDTH, 0, 6);
  private readonly ringW = new THREE.Vector4(0, 0, 0, 0.375);
  private readonly ringP = new THREE.Vector4(0.08, 0, 0, 0);
  /** Frames the ring draw ran (the console's `ripples()`). */
  ringDraws = 0;

  constructor(src: KickSources, light: KickLight) {
    this.updateMaterial = new THREE.ShaderMaterial({
      name: 'air.kick',
      vertexShader: AIR_VERTEX,
      fragmentShader: KICK_UPDATE_FRAGMENT,
      uniforms: {
        uWindow: src.window,
        uWind: src.wind,
        uSlabTiles: src.slabTiles,
        uSlabScale: src.slabScale,
        uSlabShare: src.slabShare,
        uAtlasHalf: src.atlasHalf,
        uGroundTint: src.groundTint,
        uGroundTintRef: src.groundTintRef,
        uS0: { value: null },
        uS1: { value: null },
        uS2: { value: null },
        uVel: { value: null },
        uGround: src.height,
        uObstacles: src.obstacles,
        uKlass: src.klass,
        uColour: src.colour,
        uTint: src.tint,
        uVelShift: { value: this.velShift },
        uSlabMid: src.slabMid,
        uObstacleOver: src.obstacleOver,
        uHullInverse: src.hullInverse,
        uHullBox: src.hullBox,
        uKickP: { value: this.kP },
        uKickShift: { value: this.kShift },
        uKind: { value: this.kKind },
        uKindOn: { value: this.kOn },
        uRecA: { value: this.recA },
        uRecB: { value: this.recB },
        uRecC: { value: this.recC },
        uRecD: { value: this.recD },
        uPick: { value: this.pick },
        uTau: { value: this.tau },
        uGrav: { value: this.grav },
        uLeaf: { value: this.leaf },
        uLift: { value: this.lift },
        uLiftB: { value: this.liftB },
        uPickLife: { value: this.pickLife },
        uPickSize: { value: this.pickSize },
        uStreak: { value: this.streak },
        uRing: { value: this.ring },
      },
      blending: THREE.NoBlending,
      toneMapped: false,
      depthTest: false,
      depthWrite: false,
      glslVersion: THREE.GLSL3,
    });
    this.fillMaterial = new THREE.ShaderMaterial({ name: 'air.kick.fill', vertexShader: AIR_VERTEX, fragmentShader: KICK_FILL_FRAGMENT, blending: THREE.NoBlending, toneMapped: false, depthTest: false, depthWrite: false, glslVersion: THREE.GLSL3 });
    const shared = {
      uS0: this.s0,
      uS1: this.s1,
      uS2: this.s2,
      uGround: src.height,
      uLight: src.light,
      uWindow: src.window,
      uLightShift: src.lightShift,
      uLightH: src.lightHeights,
      uDrawP: { value: this.drawP },
      uDrawW: { value: this.drawW },
      uDrawE: { value: this.drawE },
      uStreakD: { value: this.streakD },
      uSunDir: light.sunDir,
      uSunColour: light.sunColour,
      uAmbient: light.ambient,
      uPhase: { value: this.phase },
    };
    const c = CARD_LIGHT_UNIFORMS;
    const g = GRASS_UNIFORMS;
    // The leaves: cut at a half, opaque, writing depth, the leaf cards' client sum and the grass's shadow tap by reference.
    this.cutMaterial = new THREE.ShaderMaterial({
      name: 'air.kick.leaves',
      vertexShader: KICK_DRAW_VERTEX,
      fragmentShader: KICK_DRAW_FRAGMENT,
      defines: { KICK_CUT: '' },
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        ...shared,
        uDrawK: { value: this.drawK[0] },
        uDrawQ: { value: this.drawQ[0] },
        uFragK: { value: this.fragK[0] },
        uMap: { value: this.stand as THREE.Texture },
        uKickShade: { value: this.shade },
        uSwgCardFront: c.uSwgCardFront,
        uSwgCardTangent: c.uSwgCardTangent,
        uSwgCardBack: c.uSwgCardBack,
        uSwgCardAmbient: c.uSwgCardAmbient,
        uSwgCardFill: c.uSwgCardFill,
        uSwgCardBounce: c.uSwgCardBounce,
        uSwgCardFillDir: c.uSwgCardFillDir,
        uSwgCardBounceDir: c.uSwgCardBounceDir,
        uSwgCardFills: c.uSwgCardFills,
        uSwgCardGain: c.uSwgCardGain,
        uSwgLeafSun: c.uSwgLeafSun,
        uSwgCardCurve: c.uSwgCardCurve,
        uSwgCardExposureRef: c.uSwgCardExposureRef,
        uSwgCardBloomCap: c.uSwgCardBloomCap,
        uSwgGrassShadow0: g.uSwgGrassShadow0,
        uSwgGrassShadow1: g.uSwgGrassShadow1,
        uSwgGrassShadow2: g.uSwgGrassShadow2,
        uSwgGrassShadowMatrix: g.uSwgGrassShadowMatrix,
        uSwgGrassCascade: g.uSwgGrassCascade,
        uSwgGrassShadowRange: g.uSwgGrassShadowRange,
        uSwgGrassCascadeFade: g.uSwgGrassCascadeFade,
        uSwgGrassShadowBias: g.uSwgGrassShadowBias,
        uSwgGrassShadowOn: g.uSwgGrassShadowOn,
      },
      fog: true,
      transparent: false,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    this.blendMaterials = [1, 2, 3].map(
      (k) =>
        new THREE.ShaderMaterial({
          name: `air.kick.${['', 'puffs', 'spray', 'streaks'][k]}`,
          vertexShader: KICK_DRAW_VERTEX,
          fragmentShader: KICK_DRAW_FRAGMENT,
          uniforms: {
            ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
            ...shared,
            uDrawK: { value: this.drawK[k] },
            uDrawQ: { value: this.drawQ[k] },
            uFragK: { value: this.fragK[k] },
            uMap: { value: this.stand as THREE.Texture },
          },
          fog: true,
          transparent: true,
          depthWrite: false,
          blending: THREE.NormalBlending,
          side: THREE.DoubleSide,
        }),
    );
    const mats = [this.cutMaterial, ...this.blendMaterials];
    for (const m of mats) {
      // Unlit and dry: never adopted into the cascades or wrapped by the weather, so its key never changes after its warm.
      m.userData.unlit = true;
      m.userData.dry = true;
    }
    this.meshes = mats.map((m, k) => {
      const mesh = new THREE.Mesh(quadGeometry(), m);
      mesh.name = `air.kick.${['leaves', 'puffs', 'spray', 'streaks'][k]}`;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.visible = false;
      mesh.matrixAutoUpdate = true;
      // The game's own smoke's order for the blended kinds; the leaves are opaque and need none.
      mesh.renderOrder = k === 0 ? 0 : 11;
      mesh.userData.noBox = true;
      return mesh;
    });
    this.standIns = [this.cutMaterial, this.blendMaterials[0]].map((m) => {
      const mesh = new THREE.Mesh(quadGeometry(), m);
      mesh.name = 'air.kick stand-in';
      mesh.frustumCulled = false;
      return mesh;
    });
    // The spray's rings: additive into the ripples' state (a half float there blends on every WebGL2 browser, a float32
    // one only with `EXT_float_blend`, which `rippleStateTarget` asks).
    this.ringMaterial = new THREE.ShaderMaterial({
      name: 'air.kick.rings',
      vertexShader: RING_VERTEX,
      fragmentShader: RING_FRAGMENT,
      uniforms: { uS0: this.s0, uS1: this.s1, uS2: this.s2, uRingK: { value: this.ringK }, uRingW: { value: this.ringW }, uRingP: { value: this.ringP } },
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.ringMaterial.userData.unlit = true;
    this.ringMaterial.userData.dry = true;
    this.ringMesh = new THREE.Mesh(quadGeometry(), this.ringMaterial);
    this.ringMesh.name = 'air.kick.rings';
    this.ringMesh.frustumCulled = false;
    this.ringScene.add(this.ringMesh);
    this.ringScene.matrixAutoUpdate = false;
    this.ringScene.matrixWorldAutoUpdate = false;
  }

  /** Every material of the pool, for the warm and the scanner. */
  materials(): THREE.ShaderMaterial[] {
    return [this.updateMaterial, this.fillMaterial, this.cutMaterial, ...this.blendMaterials, this.ringMaterial];
  }

  /**
   * The spray's rings pressed into the ripples' state (`target`, the state the ripples' next step reads), after this
   * frame's update: the spray's slots read, a ring where a drop landed back in the water this frame. `win` is the
   * ripples' window (`WATER_SIM_WINDOW`'s vector); the air window's corner is `frame`'s. A render call of its own, the
   * renderer's target put back by the caller. Nothing is made.
   */
  drawRings(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, win: THREE.Vector4): void {
    const k = this.ringK;
    k.x = this.rowStart[2];
    k.y = KICK_WIDTH;
    k.z = this.cornerY;
    k.w = AIR_TUNE.liquid.ringSize;
    const w = this.ringW;
    w.x = win.x;
    w.y = win.y;
    w.z = win.z;
    w.w = win.w;
    const p = this.ringP;
    p.x = AIR_TUNE.liquid.ringDepth;
    p.z = this.frame.ox;
    p.w = this.frame.oz;
    (this.ringMesh.geometry as THREE.InstancedBufferGeometry).instanceCount = this.rows[2] * KICK_WIDTH;
    renderer.setRenderTarget(target);
    renderer.render(this.ringScene, this.ringCamera);
    this.ringDraws++;
  }

  /** The targets at a detail (×0.5, ×1, ×2; class T): made again only when it moved, every slot dead. Answers whether it resized. */
  ensure(detail: number): boolean {
    if (this.pair && this.sized === detail) return false;
    kickRows(detail, this.rows);
    let r = 0;
    for (let k = 0; k < KICK_KINDS; k++) {
      this.rowStart[k] = r;
      r += this.rows[k];
    }
    if (!this.pair) this.pair = [poolTarget(KICK_WIDTH, r, 'air.kick.a'), poolTarget(KICK_WIDTH, r, 'air.kick.b')];
    else for (const t of this.pair) t.setSize(KICK_WIDTH, r);
    this.sized = detail;
    for (let k = 0; k < KICK_KINDS; k++) {
      this.head[k] = 0;
      const g = this.meshes[k].geometry as THREE.InstancedBufferGeometry;
      g.instanceCount = this.rows[k] * KICK_WIDTH;
      this.drawK[k].set(this.rowStart[k], KICK_WIDTH, k, 0);
    }
    this.needsFill = true;
    this.bindState();
    return true;
  }

  /** The state textures every draw reads, as the pair stands now (written in place, so every material keeps its objects). */
  private bindState(): void {
    const p = this.pair;
    this.s0.value = p ? p[0].textures[0] : null;
    this.s1.value = p ? p[0].textures[1] : null;
    this.s2.value = p ? p[0].textures[2] : null;
  }

  /**
   * The corner's height for this frame's camera (`frame.camY`): it moves by whole metres only when the camera has gone
   * more than four metres from it, the move owed as a shift. A fill takes the camera's own.
   */
  placeCorner(): void {
    const want = Math.round(this.frame.camY);
    if (this.needsFill) {
      this.cornerY = want;
      return;
    }
    const d = want - this.cornerY;
    if (d > 4 || d < -4) {
      this.shift.y += d;
      this.cornerY = want;
    }
  }

  /**
   * A picture for a kind (borrowed from the weather's or the world's cache, or the world's own copy), or null for none
   * with the reason; the material's `map` swaps (not in the program's key).
   */
  setPicture(kind: number, t: THREE.Texture | null, why: string | null): void {
    this.pictures[kind] = t;
    this.why[kind] = t ? null : why;
    const m = kind === 0 ? this.cutMaterial : this.blendMaterials[kind - 1];
    m.uniforms.uMap.value = t ?? this.stand;
  }

  /** Every borrowed picture let go to the stand-in (an unload, before the weather detaches): nothing disposed here. */
  dropPictures(): void {
    for (let k = 0; k < KICK_KINDS; k++) {
      if (k === 3) continue;
      this.setPicture(k, null, 'no picture yet');
    }
  }

  /** Whether a kind draws: its switch on and a picture to draw it with (a streak needs none). */
  draws(kind: number): boolean {
    return this.on[kind] && (kind === 3 || this.pictures[kind] !== null);
  }

  /**
   * Into this frame's uniforms, then the update drawn (`draw` the field's drawer's own): the records the frame's sources
   * staged (`table`, world metres; the corner taken off here), sorted by kind with their counts cumulative within it,
   * each kind's ring head moved on by what it starts; the tune's numbers; the window's moves owed. Then the pair swapped
   * and the draws' state rebound. The frame's numbers are `frame`'s. Nothing is made.
   */
  step(draw: (m: THREE.ShaderMaterial, t: THREE.WebGLRenderTarget) => void, vel: THREE.Texture, table: SpawnTable): void {
    const pair = this.pair;
    if (!pair) return;
    const fr = this.frame;
    const dt = fr.dt;
    const ox = fr.ox;
    const oz = fr.oz;
    const storm = fr.storm;
    if (this.needsFill) {
      draw(this.fillMaterial, pair[0]);
      draw(this.fillMaterial, pair[1]);
      this.needsFill = false;
      this.shift.set(0, 0, 0);
      for (let k = 0; k < KICK_KINDS; k++) this.head[k] = 0;
      this.stats.fills++;
    }
    const P = AIR_TUNE.particles;
    // The records, sorted by kind.
    const rec = table.rec;
    const A = this.recA;
    const B = this.recB;
    const C = this.recC;
    const D = this.recD;
    let n = 0;
    for (let k = 0; k < KICK_KINDS; k++) {
      const size = this.rows[k] * KICK_WIDTH;
      const start = n;
      let cum = 0;
      if (this.on[k]) {
        for (let i = 0; i < table.count; i++) {
          const s = i * SPAWN_W;
          if (rec[s + 12] !== k || n >= SPAWN_MOST) continue;
          const take = rec[s + 3];
          if (cum + take > size) continue;
          cum += take;
          const o = n * 4;
          A[o] = rec[s] - ox;
          A[o + 1] = rec[s + 1] - this.cornerY;
          A[o + 2] = rec[s + 2] - oz;
          A[o + 3] = cum;
          B[o] = rec[s + 4];
          B[o + 1] = rec[s + 5];
          B[o + 2] = rec[s + 6];
          B[o + 3] = rec[s + 7];
          C[o] = rec[s + 8];
          C[o + 1] = rec[s + 9];
          C[o + 2] = rec[s + 10];
          // The spare as it stands (spray's water surface a world height, which the program compares with the place plus
          // the corner's height, so a corner moved later never leaves it wrong): no branch by kind here, since a kind seen
          // once in a while left one the compiled code had not met, and its arithmetic boxed a number.
          C[o + 3] = rec[s + 11];
          D[o] = k;
          D[o + 1] = rec[s + 13];
          D[o + 2] = rec[s + 14];
          D[o + 3] = 0;
          n++;
        }
      }
      const kk = this.kKind[k];
      kk.x = this.rowStart[k];
      kk.y = this.rows[k];
      kk.z = this.head[k];
      kk.w = cum;
      this.stats.spawned[k] += cum;
      this.head[k] = size > 0 ? (this.head[k] + cum) % size : 0;
      const ko = this.kOn[k];
      ko.x = start;
      ko.y = n;
      ko.z = this.draws(k) ? 1 : 0;
      // A kind's share of the wind's pickups: leaves and puffs whenever the air passes their threshold, streaks only in a
      // storm (at `streakStorm` of the tries, by the storm's strength), spray never.
      ko.w = k === 2 ? 0 : k === 3 ? (storm > 0 ? P.streakStorm * storm : 0) : 1;
    }
    this.frameSeed = (this.frameSeed + 1) % 16777216;
    const kp = this.kP;
    kp.x = dt;
    kp.y = this.frameSeed;
    kp.z = this.cornerY;
    kp.w = KICK_WIDTH;
    const ks = this.kShift;
    ks.x = this.shift.x;
    ks.y = this.shift.y;
    ks.z = this.shift.z;
    ks.w = fr.edge;
    const pk = this.pick;
    const rate = P.pickupRate > 0 ? P.pickupRate : 0;
    pk.x = 1 - Math.exp(-rate * dt);
    pk.y = fr.threshold;
    pk.z = P.liftLeaf;
    pk.w = storm;
    // Component by component, as every number a frame writes (a `set` would hand its numbers across a call).
    const g = 9.8;
    const ta = this.tau;
    ta.x = P.tauLeaf;
    ta.y = P.tauPuff;
    ta.z = P.tauSpray;
    ta.w = P.tauStreak;
    const gr = this.grav;
    gr.x = P.gravLeaf * g;
    gr.y = P.gravPuff * g;
    gr.z = P.gravSpray * g;
    gr.w = P.gravStreak * g;
    const lf = this.leaf;
    lf.x = P.leafDrag;
    lf.y = P.leafFlutter;
    lf.z = P.leafRest;
    lf.w = P.wakeGrav * g;
    const li = this.lift;
    li.x = P.oroK;
    li.y = P.oroSpan;
    li.z = P.oroMax;
    li.w = P.vortK;
    const lb = this.liftB;
    lb.x = P.vortFrom;
    lb.y = P.vortMax;
    lb.w = P.streakLift;
    const pl = this.pickLife;
    pl.x = P.leafLife;
    pl.y = P.puffLife;
    pl.z = P.sprayLife;
    pl.w = P.streakLife;
    const ps = this.pickSize;
    ps.x = P.leafSize;
    ps.y = P.puffSize;
    ps.z = P.spraySize;
    ps.w = P.streakWidth;
    this.streak.x = P.streakLow;
    this.streak.y = P.streakHigh;
    const u = this.updateMaterial.uniforms;
    u.uS0.value = pair[0].textures[0];
    u.uS1.value = pair[0].textures[1];
    u.uS2.value = pair[0].textures[2];
    u.uVel.value = vel;
    draw(this.updateMaterial, pair[1]);
    const t = pair[0];
    pair[0] = pair[1];
    pair[1] = t;
    this.bindState();
    this.shift.set(0, 0, 0);
    this.stats.steps++;
    this.shown = true;
  }

  /**
   * The draws' own numbers for this frame (the tune as it stands, the corner, the screen's height in pixels, the kinds'
   * switches), and the meshes stood at the corner and shown or hidden. Called by the field after its update, every frame.
   */
  writeDraws(): void {
    const P = AIR_TUNE.particles;
    const V = AIR_TUNE.volume;
    const fr = this.frame;
    const dp = this.drawP;
    dp.x = P.near > 1e-3 ? P.near : 1e-3;
    dp.y = P.clamp;
    dp.z = this.cornerY;
    dp.w = fr.screen > 1 ? fr.screen : 1;
    const de = this.drawE;
    de.x = AIR_TUNE.window.edge;
    de.y = P.leafTint;
    de.z = fr.bright;
    de.w = AIR_TUNE.rain.minPx;
    const dw = this.drawW;
    dw.x = P.wakeGrow;
    dw.y = P.wakeIn;
    dw.z = P.wakeOut;
    dw.w = P.wakeAlpha;
    const sd = this.streakD;
    sd.x = P.streakTrail;
    sd.y = P.streakMin;
    sd.z = P.streakMax > P.streakMin ? P.streakMax : P.streakMin;
    sd.w = P.streakWidth;
    const ph = this.phase;
    ph.x = V.phaseBase;
    ph.y = V.phaseLift;
    ph.z = V.phasePower;
    ph.w = fr.lightOn ? 1 : 0;
    this.shade.x = fr.shadows ? 1 : 0;
    const q = this.drawQ;
    q[0].x = 1;
    q[0].z = P.spinLeaf;
    q[0].w = P.leafRest;
    q[1].x = P.puffAlpha;
    q[1].y = P.puffGrow;
    q[1].z = P.spinPuff;
    q[2].x = P.sprayAlpha;
    q[2].y = P.sprayGrow;
    q[2].z = P.spinSpray;
    q[3].x = P.streakAlpha;
    this.fragK[1].z = P.puffFloor;
    for (let k = 0; k < KICK_KINDS; k++) {
      const drawn = this.shown && this.draws(k);
      this.drawK[k].w = drawn ? 1 : 0;
      const mesh = this.meshes[k];
      mesh.visible = drawn;
      mesh.position.x = fr.ox;
      mesh.position.y = this.cornerY;
      mesh.position.z = fr.oz;
    }
  }

  /** Hidden this frame (the field did not run its update): the draws are hidden, and a frame the field ran counts if any is. */
  hide(fieldRan: boolean): void {
    if (fieldRan && this.shown === false) this.stats.hiddenWhileRun++;
    this.shown = false;
    for (const m of this.meshes) m.visible = false;
  }

  /** Every slot dead at the next update (a jump, a new world, a switch turned on again). */
  clear(): void {
    this.needsFill = true;
    this.shift.set(0, 0, 0);
  }

  /** The targets freed (the master off); the materials kept for a later on, which makes them again at their size. */
  release(): void {
    if (this.pair) for (const t of this.pair) t.dispose();
    this.pair = null;
    this.sized = -1;
    this.bindState();
    this.hide(false);
  }

  /**
   * Read the pool back (console only, a GPU sync): live particles by kind, the leaves lying and flying, the wind's
   * pickups and the wake's spray; with `near`, the leaves in the air within `radius` of a world point. Never on a frame path.
   */
  count(renderer: THREE.WebGLRenderer, ox: number, oz: number, near?: { x: number; z: number; radius: number }): (KickCount & { nearLeaves: number | null }) | null {
    const p = this.pair;
    if (!p) return null;
    const h = p[0].height;
    const s0 = new Float32Array(KICK_WIDTH * h * 4);
    const s1 = new Float32Array(KICK_WIDTH * h * 4);
    const s2 = new Float32Array(KICK_WIDTH * h * 4);
    try {
      renderer.readRenderTargetPixels(p[0], 0, 0, KICK_WIDTH, h, s0, undefined, 0);
      renderer.readRenderTargetPixels(p[0], 0, 0, KICK_WIDTH, h, s1, undefined, 1);
      renderer.readRenderTargetPixels(p[0], 0, 0, KICK_WIDTH, h, s2, undefined, 2);
    } catch {
      return null;
    }
    const out = { live: [0, 0, 0, 0] as [number, number, number, number], lying: 0, flying: 0, pickups: 0, wake: 0, rings: 0, nearLeaves: near ? 0 : null };
    for (let k = 0; k < KICK_KINDS; k++) {
      for (let r = this.rowStart[k]; r < this.rowStart[k] + this.rows[k]; r++) {
        for (let x = 0; x < KICK_WIDTH; x++) {
          const i = (r * KICK_WIDTH + x) * 4;
          // A drop that landed back in the water this frame (the fifth wave's ring flag).
          if (k === 2 && !(s1[i + 3] > 0) && s2[i + 2] === -1) out.rings++;
          if (!(s1[i + 3] > 0)) continue;
          out.live[k]++;
          const look = Math.floor(s2[i]);
          if (look === 2) out.pickups++;
          if (k === 2 && look === 1) out.wake++;
          if (k === 0) {
            if (s2[i + 2] > 0) out.lying++;
            else {
              out.flying++;
              if (near && out.nearLeaves !== null) {
                const dx = s0[i] + ox - near.x;
                const dz = s0[i + 2] + oz - near.z;
                if (dx * dx + dz * dz <= near.radius * near.radius) out.nearLeaves++;
              }
            }
          }
        }
      }
    }
    return out;
  }

  dispose(): void {
    this.release();
    for (const m of this.materials()) m.dispose();
    for (const mesh of [...this.meshes, ...this.standIns, this.ringMesh]) mesh.geometry.dispose();
    this.stand.dispose();
  }
}
