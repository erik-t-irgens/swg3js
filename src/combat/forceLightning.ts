// Force lightning: the beam the Jedi's Lightning and Drain are drawn with. A small pool built with
// the world and hidden in the scene from the moment it is made, so the loading screen's warm-up
// compiles it and nothing is ever made on the frame a trigger is pulled. Never a beam made when the
// key goes down, and never a light of its own: the near end borrows one from `effects.flash`, the
// pool everything else borrows from, so the number of lights in the scene never changes.
//
// The shape is the nebulae's (`src/space/nebulae.ts`, `makeBeams`/`startBeam`/`endBeam`): a ribbon
// of `segments` quads whose two ends are uniforms, wandering off the straight line by sums of sines
// in the vertex program, wearing one frame of the appearance's flip-book, drawn additively,
// depth-tested, writing no depth, unlit, never wet, casting nothing, frustum culling off. Its two
// shaping curves are read with the nebulae's own `beamCurves`, so the client's waveforms are
// interpreted in exactly one place in this game.
//
// What differs from a nebula's bolt, and why:
//   - A strike lives its own second and dies. This beam is HELD: a caller asks for it every frame
//     the key is down (`holdForceBeam`), and a frame that does not ask starts a short fade, so
//     letting go is a fade and not a cut. `flashForceBeam` is the other shape, a bolt that lives
//     its own seconds, which is what a single zap and the console's test use.
//   - A strike is placed once, at two fixed points kilometres apart. This one is re-aimed every
//     frame from a hand that moves, over metres, so its width, wander and flicker are in metres and
//     its flip-book runs on its own clock rather than on its age.
//   - A strike ends where the table said. This one must never end in the air: given nothing to
//     strike it casts a ray of its own and ends on the first surface it finds, and only when there
//     is no surface within `skyReach` does it fray out (`uFray`), which reads as a bolt spending
//     itself rather than as a bolt cut off.
//   - Both of a strike's ends are free to wander. Both of this one's are pinned (the `pin` in the
//     vertex program), because a bolt whose end wanders off the hand or off what it struck reads as
//     two loose ends rather than as a bolt between them.
//   - Aboard a ship's rooms the caller's points are in the hull's frame, so the beam is carried into
//     the world every frame from that matrix and its own ray is cast in the room's own physics; the
//     two particles it plays are placed with the frame, so they ride the hull as everything else
//     placed aboard does.
//
// The picture, the flip-book's timing, the two waveforms and the two particles come from the game's
// own `force_lightning*.ltn` (FORM LEFX) and the effects beside it, converted into the weapons pack;
// a pack converted before that has none and the pool draws a stand-in picture of ours instead, so
// the power always looks like something. Everything else here -- the widths, the wander, the
// flicker, the colours, the fade, the light and how often the end effect is played -- is INVENTED,
// lives in `FORCE_LIGHTNING`, and moves live through `__debug.forceLightning({ ... })`.
import * as THREE from 'three';
import { RAPIER, type Physics } from '../core/physics.ts';
import { markActor } from '../world/portalRender.ts';
import { beamCurves } from '../space/nebulaMath.ts';
import type { EffectHandle, ParticleEffects } from '../world/particles.ts';
import type { BoltFrame } from './bolts.ts';

/**
 * Every number a Force beam has that the client's files do not give. INVENTED, all of them, and all
 * live through `__debug.forceLightning({ ... })`; the three that are spent when the pool is built
 * are in `BUILD_ONLY_KEYS` and take effect at the next world load.
 */
export const FORCE_LIGHTNING = {
  /** The most beams alive at once (the player's Lightning and Drain, and one for anything else). Next world load. */
  beams: 3,
  /** Segments along a beam, and how many points its shaping curves are sampled at. Next world load. */
  segments: 22,
  /**
   * How far apart two beams of the pool start their own clocks, seconds: the flicker and the
   * flip-book both run off that clock, and beams started together would otherwise flicker in
   * lockstep and read as one wide bolt. Spent when the pool is built, so: next world load.
   */
  phaseStep: 0.37,
  /** A beam at its widest, and how far it wanders off the straight line. Metres. */
  width: 0.13,
  wander: 0.28,
  /**
   * How it wanders along its length: two rates each on the two axes across it, and how much of the
   * faster is mixed into the slower. Sums of sines, so the wander is smooth and repeatable and
   * costs the vertex program four sines.
   */
  waveSlowA: 7.5,
  waveFastA: 23,
  waveSlowB: 9,
  waveFastB: 31,
  waveMix: 0.45,
  /** How many times a second the wander is re-rolled: the flicker, on its own clock so 30 and 144 frames a second look alike. */
  jitterHz: 22,
  /** How many tiles of the appearance's picture stand along a metre of beam. */
  tilesPerMetre: 0.35,
  /** Frames a second of the flip-book when the appearance names no rate of its own. */
  fps: 12,
  /** Seconds a beam takes to go out once nothing holds it. */
  fade: 0.09,
  /** How far back off the surface the far end is pulled, so the ribbon does not fight the wall it ends on. Metres. */
  endInset: 0.06,
  /**
   * The shortest a beam may be once that inset is taken off, metres. Lightning held against a wall
   * at arm's length is governed by this one number: without it the inset would turn a very near
   * surface into a beam of no length, or of negative length running back through the hand.
   */
  minLength: 0.2,
  /** How far past the power's own reach a ray still looks for a surface to end on, as a multiple of it. */
  skyReach: 3,
  /** With no surface anywhere, the share of the beam's length that fades out at the far end. */
  frayShare: 0.35,
  /** The pooled light at the near end: how bright, how far it carries, how long it lives, and the least time between two. */
  flashIntensity: 16,
  flashDistance: 14,
  flashSeconds: 0.09,
  flashEvery: 0.05,
  /** How often the far end's own effect is played again while a beam is held, seconds. */
  endEvery: 0.22,
  /** Where three draws a beam in its see-through order. */
  order: 4,
  /** Lightning's two colours, at the hand and at the far end. OURS: the appearance carries no colour. */
  lightningNear: 0xbfe6ff,
  lightningFar: 0x6fa8ff,
  /** Drain's. */
  drainNear: 0xff8a8a,
  drainFar: 0xc02840,
};

/** The knobs that are spent when the pool is built: moving one takes effect at the next world load. */
export const BUILD_ONLY_KEYS: readonly string[] = ['beams', 'segments', 'phaseStep'];

export type ForceLightningTune = typeof FORCE_LIGHTNING;

/** Which of the two looks a beam wears. Both colour pairs are ours. */
export type ForceBeamStyle = 'lightning' | 'drain';

/**
 * The beam appearance as the converter writes it into the weapons pack out of a `.ltn` (FORM LEFX):
 * the same shape the space pack's `lightning` block already has, since it is the same reader. Every
 * field is optional, because the game must read a pack converted before this wave without asking
 * what version it is -- such a pack simply has none, and the stand-in below is drawn.
 */
export interface ForceBeamLook {
  /** The `.ltn` it came from, for the console. */
  source?: string;
  /** The pack-relative picture, under the weapons pack. */
  texture?: string | null;
  /** The flip-book the appearance's particle texture describes. */
  flipbook?: { frames?: number; frameStart?: number; frameEnd?: number; uvSize?: number; perColumn?: number; fps?: number } | null;
  /** The two waveforms, in the particle reader's shape: the beam's width along its length, and how far it wanders there. */
  waveforms?: { points: number[][] }[];
  /** The effects played where the beam starts and where it ends, as pack-relative particle files. */
  start?: string | null;
  end?: string | null;
}

/** What the pool needs of the game. One kept record: a load allocates nothing and a beam allocates nothing. */
export interface ForceLightningDeps {
  scene: THREE.Scene;
  /** The world's own physics: what a beam given nothing to strike ends on. */
  physics: Physics;
  /** The weapons pack's effects player, which is where the powers' own particles live. */
  particles: ParticleEffects | null;
  /** The renderer, for preparing those particles' batches behind the loading screen. */
  renderer: THREE.WebGLRenderer | null;
  /** One light from the pool for the near end; never a light of this file's own. */
  flash(at: THREE.Vector3, colour: number, intensity: number, distance: number, seconds: number): void;
  /** A pack-relative file as a URL. */
  url(file: string): string;
  /** False once the load this was started for was abandoned: a travel part way through leaves nothing behind. */
  stillWanted(): boolean;
  /** How a picture is loaded; the game leaves it out and three's own loader is used. A node check hands its own. */
  texture?: (url: string) => Promise<THREE.Texture | null>;
}

/** What a caller asks for while a power is held. One beam per `owner`. */
export interface ForceBeamHold {
  /** Whoever is holding it: the kit, a fighter, whatever. One beam each, and identity is all that is read. */
  owner: object;
  style: ForceBeamStyle;
  /** Where it leaves the hand, in `frame`'s space when a frame is given and in the world's otherwise. */
  from: THREE.Vector3;
  /** Which way it goes, in the same space as `from`; need not be a unit vector. */
  dir: THREE.Vector3;
  /** How far the power reaches, metres. */
  reach: number;
  /** What it struck, when the power already knows (a body's middle); null to go looking for a surface. */
  to?: THREE.Vector3 | null;
  /** Aboard a ship's rooms: the hull's live matrix and the room's own physics. */
  frame?: BoltFrame | null;
  /** The body the beam leaves, so a caster's own capsule is never what it ends on. */
  exclude?: RAPIER.RigidBody;
}

/** One beam of the pool. */
interface Beam {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** Whoever holds it (null: free, or living out a `flash`'s own seconds). */
  owner: object | null;
  /** Set by every `hold` and cleared by every step: a step that finds it clear starts the fade. */
  held: boolean;
  /** Seconds of life left. A held beam is topped back up to `FORCE_LIGHTNING.fade`; a freed one counts down. */
  left: number;
  /** Its own clock, for the flicker and the flip-book, so two beams are never in step. */
  time: number;
  /** When it last borrowed a light and last played its far end's effect, on its own clock. */
  litAt: number;
  endAt: number;
  /** The effect held at the near end for as long as the beam lasts. */
  startFx: EffectHandle | null;
  /** The hull's live matrix while the beam is aboard one, else null. */
  frame: THREE.Matrix4 | null;
}

const tmpFrom = new THREE.Vector3();
const tmpTo = new THREE.Vector3();
const tmpLocalTo = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpAxis = new THREE.Vector3();
const tmpNormal = new THREE.Vector3();
const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const ONE = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
/**
 * One ray for every cast this file makes, written rather than made: a beam is aimed every frame it
 * is held. Made on the first cast rather than with the module, since the module is loaded long
 * before `RAPIER.init()` has run.
 */
let tmpRay: RAPIER.Ray | null = null;
/** One request the one-off `flash` fills in, so a bolt fired from the console allocates nothing either. */
const tmpReq: ForceBeamHold = { owner: {}, style: 'lightning', from: new THREE.Vector3(), dir: new THREE.Vector3(), reach: 0, to: null, frame: null };

const BEAM_VERTEX = /* glsl */ `
  attribute float aT;
  attribute float aSide;
  attribute float aWidth;
  attribute float aWander;
  uniform vec3 uFrom;
  uniform vec3 uTo;
  uniform float uWidth;
  uniform float uWander;
  uniform vec4 uWaveRates;
  uniform float uWaveMix;
  uniform float uSeed;
  uniform float uRepeat;
  varying vec2 vUv;
  varying float vT;
  void main() {
    vec3 p = mix(uFrom, uTo, aT);
    vec3 dir = normalize(uTo - uFrom);
    // A beam pointing straight at the camera makes a zero cross product, and a normalized zero is
    // NaN, which spreads to gl_Position and loses the whole triangle: fall back to any axis across
    // the beam when that happens. (The nebulae's own bolts learned this first.)
    vec3 c = cross(dir, normalize(cameraPosition - p));
    vec3 side = dot(c, c) < 1e-8 ? normalize(cross(dir, abs(dir.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))) : normalize(c);
    vec3 up = normalize(cross(side, dir));
    float w1 = sin(aT * uWaveRates.x + uSeed) + uWaveMix * sin(aT * uWaveRates.y + uSeed * 2.7);
    float w2 = cos(aT * uWaveRates.z + uSeed * 1.7) + uWaveMix * cos(aT * uWaveRates.w + uSeed * 3.1);
    // Both ends pinned: a beam has to leave the hand and arrive at what it struck.
    float pin = sin(aT * 3.14159265);
    p += (side * w1 + up * w2) * (aWander * uWander * pin);
    p += side * (aSide * aWidth * uWidth);
    vUv = vec2(aT * uRepeat, aSide * 0.5 + 0.5);
    vT = aT;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const BEAM_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2 uFrameOffset;
  uniform vec2 uFrameSize;
  uniform vec3 uColourA;
  uniform vec3 uColourB;
  uniform float uAlpha;
  uniform float uFray;
  varying vec2 vUv;
  varying float vT;
  void main() {
    // The frame is one tile of the picture, so the length along the beam is wrapped into the tile
    // here rather than in the vertex program, where the wrap falls between two vertices and shows a
    // whole frame backwards across one segment. Across the ribbon the edge really is 1.
    float u = fract(vUv.x);
    if (u == 0.0 && vUv.x > 0.0) u = 1.0;
    vec4 t = texture2D(uMap, uFrameOffset + vec2(u, vUv.y) * uFrameSize);
    // With nothing to end on, the last share of the beam spends itself instead of stopping dead.
    // Written as one minus a rising step rather than as a falling one: GLSL ES leaves smoothstep
    // undefined when its first edge is not the smaller, and this is the same curve either way.
    float fray = uFray > 0.0 ? 1.0 - smoothstep(1.0 - uFray, 1.0, vT) : 1.0;
    float a = t.a * uAlpha * fray;
    if (a <= 0.003) discard;
    gl_FragColor = vec4(t.rgb * mix(uColourA, uColourB, vT), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * The stand-in picture, for a weapons pack converted before the Force effects were read: a soft core
 * across the ribbon with a little life along it. OURS, made once with the pool, four kilobytes, and
 * never drawn once the pack has the appearance's own. Nothing random in it, so every browser's
 * stand-in is the same picture.
 */
function standInPicture(): THREE.DataTexture {
  const w = 64;
  const h = 16;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    // Across the ribbon: a bell, so the edges are air and the middle is the bolt.
    const across = (y + 0.5) / h - 0.5;
    const core = Math.exp(-(across * across) / 0.022);
    for (let x = 0; x < w; x++) {
      const t = (x + 0.5) / w;
      // Along it: a repeatable ripple, so one tile is not a flat bar.
      const along = 0.62 + 0.38 * Math.abs(Math.sin(t * Math.PI * 3.5) * Math.cos(t * Math.PI * 1.7));
      const a = Math.max(0, Math.min(1, core * along));
      const i = (y * w + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** The near end's colour for a style, as one number, for the pooled light. */
function styleLight(style: ForceBeamStyle): number {
  return style === 'drain' ? FORCE_LIGHTNING.drainNear : FORCE_LIGHTNING.lightningNear;
}

/** A flip-book's numbers as the appearance gives them, with the whole book as the answer when it gives none. */
function bookOf(look: ForceBeamLook | null): { frames: number; first: number; columns: number; fps: number; size: number } {
  const flip = look?.flipbook ?? null;
  const size = flip && typeof flip.uvSize === 'number' && flip.uvSize > 0 ? flip.uvSize : 1;
  const all = Math.max(1, flip && typeof flip.frames === 'number' && flip.frames > 0 ? Math.round(flip.frames) : 1);
  const start = flip && typeof flip.frameStart === 'number' && Number.isFinite(flip.frameStart) ? Math.max(0, Math.round(flip.frameStart)) : 0;
  const first = Math.min(start, all - 1);
  const rawEnd = flip && typeof flip.frameEnd === 'number' && Number.isFinite(flip.frameEnd) ? Math.round(flip.frameEnd) : all - 1;
  const last = rawEnd >= first ? rawEnd : all - 1;
  return {
    frames: Math.max(1, Math.min(last - first + 1, all - first)),
    first,
    columns: Math.max(1, Math.ceil(all / Math.max(1, flip && typeof flip.perColumn === 'number' && flip.perColumn > 0 ? Math.round(flip.perColumn) : 1))),
    fps: flip && typeof flip.fps === 'number' && flip.fps > 0 ? flip.fps : FORCE_LIGHTNING.fps,
    size,
  };
}

/**
 * The pool. Built by `loadForceLightning` with each world, disposed with it, and reached through the
 * module's own helpers below rather than by being handed about, exactly as the nebulae are reached
 * through `current` in their own file.
 */
export class ForceBeams {
  readonly group = new THREE.Group();
  /** Beams drawn, callers turned away because every beam was busy, ends found by a ray of our own, and ends frayed. */
  readonly tally = { drawn: 0, busy: 0, traced: 0, frayed: 0 };

  private readonly deps: ForceLightningDeps;
  private readonly beams: Beam[] = [];
  private readonly textures: THREE.Texture[] = [];
  private look: ForceBeamLook | null = null;
  /** Whether what `uMap` holds is the appearance's own picture or our stand-in. */
  private own = false;
  private book = bookOf(null);
  private disposed = false;

  private constructor(deps: ForceLightningDeps) {
    this.deps = deps;
    this.group.name = 'force-lightning';
    this.group.frustumCulled = false;
  }

  /**
   * The pool, in the scene and hidden, with the appearance's own picture and its two particles ready
   * when the pack has them. It is built before the warm-up, so every material it owns is compiled
   * behind the loading screen; a load abandoned part way through leaves nothing behind.
   */
  static async build(deps: ForceLightningDeps, look: ForceBeamLook | null): Promise<ForceBeams | null> {
    const self = new ForceBeams(deps);
    let map: THREE.Texture | null = null;
    if (look?.texture) {
      const url = deps.url(look.texture);
      const loader = deps.texture ? null : new THREE.TextureLoader();
      map = await (deps.texture ? deps.texture(url) : loader!.loadAsync(url)).catch(() => null);
      if (map) {
        map.colorSpace = THREE.SRGBColorSpace;
        map.wrapS = THREE.RepeatWrapping;
        map.wrapT = THREE.RepeatWrapping;
        self.textures.push(map);
      }
    }
    if (!deps.stillWanted()) {
      for (const t of self.textures) t.dispose();
      return null;
    }
    self.own = !!map;
    if (!map) {
      map = standInPicture();
      self.textures.push(map);
    }
    self.look = look;
    self.makeBeams(map, look);
    // The two particles a beam plays at its ends: their batches and textures made now, so a beam
    // never builds a program on a live frame.
    const fx = deps.particles;
    if (fx) {
      for (const f of [look?.start, look?.end]) {
        if (f) await fx.prepare(f, deps.renderer).catch(() => false);
      }
    }
    if (!deps.stillWanted()) {
      self.dispose(() => {});
      return null;
    }
    return self;
  }

  /** The ribbons: made once, hidden, reused. Every number of them is `FORCE_LIGHTNING`'s. */
  private makeBeams(map: THREE.Texture, look: ForceBeamLook | null): void {
    const shape = look?.waveforms ?? [];
    const segments = Math.max(2, Math.round(FORCE_LIGHTNING.segments));
    // The nebulae's own reading of the appearance's two curves, through their own function: the
    // first widens the beam along its length, the second says how far it wanders there.
    const width = beamCurves(shape[0]?.points ?? [], segments + 1);
    const wander = beamCurves(shape[1]?.points ?? [], segments + 1);
    const verts = (segments + 1) * 2;
    const aT = new Float32Array(verts);
    const aSide = new Float32Array(verts);
    const aWidth = new Float32Array(verts);
    const aWander = new Float32Array(verts);
    const index: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      for (let s = 0; s < 2; s++) {
        const v = i * 2 + s;
        aT[v] = t;
        aSide[v] = s === 0 ? -1 : 1;
        aWidth[v] = width[i];
        aWander[v] = wander[i];
      }
      if (i < segments) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.book = bookOf(look);
    for (let i = 0; i < Math.max(1, Math.round(FORCE_LIGHTNING.beams)); i++) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
      geometry.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
      geometry.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
      geometry.setAttribute('aWidth', new THREE.BufferAttribute(aWidth, 1));
      geometry.setAttribute('aWander', new THREE.BufferAttribute(aWander, 1));
      geometry.setIndex(index);
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: map },
          uFrom: { value: new THREE.Vector3() },
          uTo: { value: new THREE.Vector3(0, 1, 0) },
          uWidth: { value: FORCE_LIGHTNING.width },
          uWander: { value: FORCE_LIGHTNING.wander },
          uWaveRates: { value: new THREE.Vector4(FORCE_LIGHTNING.waveSlowA, FORCE_LIGHTNING.waveFastA, FORCE_LIGHTNING.waveSlowB, FORCE_LIGHTNING.waveFastB) },
          uWaveMix: { value: FORCE_LIGHTNING.waveMix },
          uSeed: { value: 0 },
          uRepeat: { value: 1 },
          uFrameOffset: { value: new THREE.Vector2(0, 0) },
          uFrameSize: { value: new THREE.Vector2(this.book.size, this.book.size) },
          uColourA: { value: new THREE.Color(1, 1, 1) },
          uColourB: { value: new THREE.Color(1, 1, 1) },
          uAlpha: { value: 0 },
          uFray: { value: 0 },
        },
        vertexShader: BEAM_VERTEX,
        fragmentShader: BEAM_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      });
      material.name = 'force:lightning';
      // Unlit and dry: kept out of the shadow cascades and never wrapped by the rain, both of which
      // are part of a program's key and would rebuild this behind the player's back.
      material.userData.unlit = true;
      material.userData.dry = true;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `force:lightning:${i}`;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = FORCE_LIGHTNING.order;
      mesh.visible = false;
      // A power is used indoors as often as out, and an actor is drawn in the rooms' pass and in the
      // world's alike, which is what the rings and tracers beside it already do.
      markActor(mesh);
      this.group.add(mesh);
      this.beams.push({ mesh, material, owner: null, held: false, left: 0, time: i * FORCE_LIGHTNING.phaseStep, litAt: -Infinity, endAt: -Infinity, startFx: null, frame: null });
    }
  }

  /**
   * The appearance arrived after the pool was built (the weapons catalogue is fetched beside the
   * first world's load, and either may land first): point every beam at its picture. A texture is
   * not part of a program's key, so this compiles nothing. The shaping curves are attributes built
   * with the pool, so a pack that lands late keeps the stand-in's even width until the next world
   * load, which is one loading screen away and is not worth rebuilding a buffer under a live frame.
   *
   * The look's two particles are prepared here BEFORE the look is taken, exactly as `build` prepares
   * them: this is the ordinary path on a first arrival, and a look taken without preparing them
   * would have the first beam place effects whose batch, texture and program had never been built,
   * which is a compile on the frame the power is first used. Nothing is drawn differently while the
   * wait lasts -- the pool simply goes on wearing the stand-in, which has no end effects at all.
   */
  async adopt(look: ForceBeamLook | null, texture: THREE.Texture | null): Promise<void> {
    if (this.disposed || !look || !texture || this.own) {
      if (texture && (this.disposed || this.own)) texture.dispose();
      return;
    }
    const fx = this.deps.particles;
    if (fx) {
      for (const f of [look.start, look.end]) {
        if (f) await fx.prepare(f, this.deps.renderer).catch(() => false);
      }
    }
    // The world may have gone, or a second look landed, while those were being built.
    if (this.disposed || this.own) {
      texture.dispose();
      return;
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    this.textures.push(texture);
    this.look = look;
    this.own = true;
    this.book = bookOf(look);
    for (const beam of this.beams) {
      beam.material.uniforms.uMap.value = texture;
      (beam.material.uniforms.uFrameSize.value as THREE.Vector2).set(this.book.size, this.book.size);
    }
  }

  /** Hold a beam this frame. True when one was drawn; false when every beam was busy. */
  hold(req: ForceBeamHold): boolean {
    if (this.disposed) return false;
    let beam = this.beamOf(req.owner);
    if (!beam) {
      beam = this.free();
      if (!beam) {
        this.tally.busy++;
        return false;
      }
      this.start(beam, req.owner, req.style, req.frame ?? null);
    }
    beam.held = true;
    beam.left = Math.max(0.01, FORCE_LIGHTNING.fade);
    beam.frame = req.frame?.matrix ?? null;
    this.aim(beam, req);
    return true;
  }

  /** Let go of a beam: it fades out from the next step rather than being cut. */
  release(owner: object): void {
    const beam = this.beamOf(owner);
    if (!beam) return;
    beam.owner = null;
    beam.held = false;
  }

  /**
   * One bolt that lives its own seconds and is held by nobody: a single zap, and what the console's
   * test fires. It takes a beam of the pool exactly as a held one does.
   */
  flash(style: ForceBeamStyle, from: THREE.Vector3, dir: THREE.Vector3, reach: number, seconds: number, to: THREE.Vector3 | null = null, frame: BoltFrame | null = null, exclude?: RAPIER.RigidBody): boolean {
    if (this.disposed) return false;
    const beam = this.free();
    if (!beam) {
      this.tally.busy++;
      return false;
    }
    this.start(beam, null, style, frame);
    beam.held = false;
    beam.left = Math.max(0.02, seconds);
    tmpReq.style = style;
    tmpReq.from.copy(from);
    tmpReq.dir.copy(dir);
    tmpReq.reach = reach;
    tmpReq.to = to;
    tmpReq.frame = frame;
    tmpReq.exclude = exclude;
    this.aim(beam, tmpReq);
    return true;
  }

  /**
   * One frame: the flicker, the flip-book, the fade of anything nothing holds, and the end of one
   * whose time is up. Allocates nothing.
   */
  step(dt: number): void {
    if (this.disposed) return;
    for (const beam of this.beams) {
      if (beam.left <= 0) continue;
      beam.time += dt;
      const u = beam.material.uniforms;
      if (beam.held) {
        // Asked for this frame: held at full, and the flag cleared so the frame that stops asking
        // starts the fade by itself.
        beam.held = false;
        u.uAlpha.value = 1;
      } else {
        beam.left -= dt;
        if (beam.left <= 0) {
          this.end(beam);
          continue;
        }
        u.uAlpha.value = Math.max(0, Math.min(1, beam.left / Math.max(0.01, FORCE_LIGHTNING.fade)));
      }
      u.uWidth.value = FORCE_LIGHTNING.width;
      u.uWander.value = FORCE_LIGHTNING.wander;
      (u.uWaveRates.value as THREE.Vector4).set(FORCE_LIGHTNING.waveSlowA, FORCE_LIGHTNING.waveFastA, FORCE_LIGHTNING.waveSlowB, FORCE_LIGHTNING.waveFastB);
      u.uWaveMix.value = FORCE_LIGHTNING.waveMix;
      // The flicker: the wander's seed steps on its own clock rather than every frame, so a beam
      // looks the same at thirty frames a second and at a hundred and forty-four.
      u.uSeed.value = Math.floor(beam.time * Math.max(0, FORCE_LIGHTNING.jitterHz)) % 1024;
      const frame = this.book.first + (Math.floor(beam.time * this.book.fps) % this.book.frames);
      const cx = frame % this.book.columns;
      const cy = Math.floor(frame / this.book.columns);
      (u.uFrameOffset.value as THREE.Vector2).set(cx * this.book.size, 1 - this.book.size - cy * this.book.size);
    }
  }

  /** What the console shows. */
  report(): Record<string, unknown> {
    let live = 0;
    let held = 0;
    for (const b of this.beams) {
      if (b.left > 0) live++;
      if (b.owner !== null) held++;
    }
    return {
      beams: this.beams.length,
      live,
      held,
      picture: this.own ? (this.look?.texture ?? 'the appearance\'s own') : 'a stand-in of ours: the weapons pack carries no converted beam appearance',
      source: this.look?.source ?? null,
      flipbook: { ...this.book },
      ends: { start: this.look?.start ?? null, end: this.look?.end ?? null },
      tally: { ...this.tally },
      ours: 'the width, the wander, the flicker, the colours, the fade, the light and how often the far end plays are ours, not the game\'s',
    };
  }

  /** The line the world prints when a world's beams are up. */
  get status(): string {
    return `${this.beams.length} Force beams, ${this.own ? 'the game\'s own appearance' : 'a stand-in picture'}`;
  }

  /** Taken out of the world for good: the materials forgotten (both registers are strong), then everything freed. */
  dispose(forget: (materials: THREE.Material[]) => void): void {
    this.disposed = true;
    for (const beam of this.beams) this.end(beam);
    const materials: THREE.Material[] = [];
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.push(m);
    });
    forget(materials);
    for (const m of materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.textures.length = 0;
    this.group.clear();
    this.beams.length = 0;
  }

  private beamOf(owner: object): Beam | null {
    for (const b of this.beams) if (b.owner === owner && b.left > 0) return b;
    return null;
  }

  private free(): Beam | null {
    for (const b of this.beams) if (b.left <= 0) return b;
    return null;
  }

  /** A beam taken out of the pool: shown, coloured, and given the near end's own effect. */
  private start(beam: Beam, owner: object | null, style: ForceBeamStyle, frame: BoltFrame | null): void {
    this.tally.drawn++;
    beam.owner = owner;
    beam.left = Math.max(0.01, FORCE_LIGHTNING.fade);
    beam.litAt = -Infinity;
    beam.endAt = -Infinity;
    (beam.material.uniforms.uColourA.value as THREE.Color).setHex(style === 'drain' ? FORCE_LIGHTNING.drainNear : FORCE_LIGHTNING.lightningNear);
    (beam.material.uniforms.uColourB.value as THREE.Color).setHex(style === 'drain' ? FORCE_LIGHTNING.drainFar : FORCE_LIGHTNING.lightningFar);
    beam.material.uniforms.uAlpha.value = 1;
    beam.mesh.visible = true;
    // Read here rather than only when the pool is made, so the see-through order is a live knob:
    // order is not part of a program's key, so writing it compiles nothing.
    beam.mesh.renderOrder = FORCE_LIGHTNING.order;
    beam.frame = frame?.matrix ?? null;
    // The near end's own effect, held for as long as the beam is: aboard, in the hull's frame, so it
    // rides the ship as everything else placed aboard does. Not transient: it is ended by hand when
    // the beam is, which is what a power held down wants.
    const fx = this.deps.particles;
    if (fx && this.look?.start) beam.startFx = fx.place(this.look.start, tmpMatrix.identity(), false, false, beam.frame, false, { sound: false });
  }

  /** A beam put back: hidden, its held effect taken away, and free for the next caller. */
  private end(beam: Beam): void {
    beam.left = 0;
    beam.owner = null;
    beam.held = false;
    beam.mesh.visible = false;
    beam.material.uniforms.uAlpha.value = 0;
    if (beam.startFx) this.deps.particles?.remove(beam.startFx);
    beam.startFx = null;
    beam.frame = null;
  }

  /**
   * Where a beam runs this frame. The caller's points are in the hull's frame aboard and in the
   * world's otherwise; the ribbon is drawn in the world, so they are carried out of that frame here,
   * every frame, which is what makes a beam ride a ship that is flying.
   */
  private aim(beam: Beam, req: ForceBeamHold): void {
    tmpFrom.copy(req.from);
    tmpDir.copy(req.dir);
    if (tmpDir.lengthSq() < 1e-8) tmpDir.set(0, 0, -1);
    tmpDir.normalize();
    let frayed = false;
    let onSurface = false;
    if (req.to) {
      tmpTo.copy(req.to);
    } else {
      // Nothing was struck, so the beam goes looking for a surface: the power's own reach first and
      // then as far again, because a bolt that stops in mid-air at exactly its reach reads as a bug
      // while a wall eight metres past it is what the room actually offers.
      const physics = req.frame?.physics ?? this.deps.physics;
      const far = Math.max(req.reach, req.reach * Math.max(1, FORCE_LIGHTNING.skyReach));
      const hit = castBeam(physics, tmpFrom, tmpDir, far, req.exclude);
      if (hit > 0) {
        this.tally.traced++;
        onSurface = true;
        tmpTo.copy(tmpFrom).addScaledVector(tmpDir, Math.max(FORCE_LIGHTNING.minLength, hit - FORCE_LIGHTNING.endInset));
      } else {
        // Open sky, and nothing anywhere: the beam spends itself over its last share rather than
        // stopping dead in the air.
        this.tally.frayed++;
        frayed = true;
        tmpTo.copy(tmpFrom).addScaledVector(tmpDir, req.reach);
      }
    }
    // Kept before the two ends are carried into the world, because an effect placed with a frame is
    // placed in that frame.
    tmpLocalTo.copy(tmpTo);
    const u = beam.material.uniforms;
    if (beam.frame) {
      tmpFrom.applyMatrix4(beam.frame);
      tmpTo.applyMatrix4(beam.frame);
    }
    (u.uFrom.value as THREE.Vector3).copy(tmpFrom);
    (u.uTo.value as THREE.Vector3).copy(tmpTo);
    u.uFray.value = frayed ? Math.max(0, Math.min(0.95, FORCE_LIGHTNING.frayShare)) : 0;
    // One tile of the picture every few metres, so a beam at two metres and one at twenty wear the
    // same bolt rather than the same stretched smear.
    u.uRepeat.value = Math.max(1, Math.round(tmpFrom.distanceTo(tmpTo) * Math.max(0.01, FORCE_LIGHTNING.tilesPerMetre)));
    const fx = this.deps.particles;
    // The near end's held effect follows the hand, in whichever frame the beam is in.
    if (fx && beam.startFx) fx.move(beam.startFx, beam.frame ? tmpMatrix.makeTranslation(req.from.x, req.from.y, req.from.z) : tmpMatrix.makeTranslation(tmpFrom.x, tmpFrom.y, tmpFrom.z));
    // One pooled light at the near end, on its own clock rather than one a frame: a flash a frame
    // spends the whole pool and pushes out a ship's room lights and the fighters' own glows.
    if (beam.time - beam.litAt >= Math.max(0.01, FORCE_LIGHTNING.flashEvery)) {
      beam.litAt = beam.time;
      this.deps.flash(tmpFrom, styleLight(req.style), FORCE_LIGHTNING.flashIntensity, FORCE_LIGHTNING.flashDistance, FORCE_LIGHTNING.flashSeconds);
    }
    // The far end's own effect, played again while the beam is held, so lightning into a body and
    // lightning into a wall both keep something happening where they land. Nothing is played where
    // the beam frayed out, because nothing is there.
    if (fx && this.look?.end && !frayed && beam.time - beam.endAt >= Math.max(0.02, FORCE_LIGHTNING.endEvery)) {
      beam.endAt = beam.time;
      if (onSurface && tmpNormal.lengthSq() > 1e-6) tmpQuat.setFromUnitVectors(UP, tmpNormal.normalize());
      else tmpQuat.setFromUnitVectors(UP, tmpAxis.copy(tmpDir).negate());
      fx.place(this.look.end, tmpMatrix.compose(beam.frame ? tmpLocalTo : tmpTo, tmpQuat, ONE), false, true, beam.frame, false, { sound: false });
    }
  }
}

/**
 * The bolts' own ray filter: a collider in no collision group is a ghosted hull (a ship in a jump,
 * or one still being prepared before it joins the world's vehicles), and a beam passes through it as
 * a bolt does.
 */
const passable = (c: RAPIER.Collider): boolean => c.collisionGroups() !== 0;

/** The distance to the first surface along a ray, or 0 for nothing within `range`; the normal lands in `tmpNormal`. */
function castBeam(physics: Physics, from: THREE.Vector3, dir: THREE.Vector3, range: number, exclude?: RAPIER.RigidBody): number {
  const ray = (tmpRay ??= new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }));
  ray.origin.x = from.x;
  ray.origin.y = from.y;
  ray.origin.z = from.z;
  ray.dir.x = dir.x;
  ray.dir.y = dir.y;
  ray.dir.z = dir.z;
  const hit = physics.world.castRayAndGetNormal(ray, range, true, undefined, undefined, undefined, exclude, passable);
  if (!hit) {
    tmpNormal.set(0, 0, 0);
    return 0;
  }
  tmpNormal.set(hit.normal.x, hit.normal.y, hit.normal.z);
  return hit.timeOfImpact;
}

/** The world's beams while a world is loaded. One at a time, as the nebulae are. */
let current: ForceBeams | null = null;
/** The beam appearance the weapons pack carries, once the catalogue has been read; kept for the next world too. */
let known: ForceBeamLook | null = null;
/** How a pack-relative file of the weapons pack becomes a URL; the catalogue hands it over with the look. */
let knownUrl: ((file: string) => string) | null = null;

/**
 * The beam appearance out of the weapons pack, whatever the pack has in it. Everything is optional
 * and everything is checked, because the game must read a pack converted before this wave without
 * asking what version it is: such a pack simply has none and the stand-in is drawn.
 */
export function readBeamLook(raw: unknown): ForceBeamLook | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const flipRaw = r.flipbook && typeof r.flipbook === 'object' ? (r.flipbook as Record<string, unknown>) : null;
  const waves: { points: number[][] }[] = [];
  if (Array.isArray(r.waveforms)) {
    for (const w of r.waveforms) {
      const pts = w && typeof w === 'object' ? (w as { points?: unknown }).points : null;
      waves.push({ points: Array.isArray(pts) ? (pts as number[][]) : [] });
    }
  }
  const look: ForceBeamLook = {
    source: typeof r.source === 'string' ? r.source : undefined,
    texture: typeof r.texture === 'string' ? r.texture : null,
    flipbook: flipRaw ? { frames: num(flipRaw.frames), frameStart: num(flipRaw.frameStart), frameEnd: num(flipRaw.frameEnd), uvSize: num(flipRaw.uvSize), perColumn: num(flipRaw.perColumn), fps: num(flipRaw.fps) } : null,
    waveforms: waves,
    start: typeof r.start === 'string' ? r.start : null,
    end: typeof r.end === 'string' ? r.end : null,
  };
  // A look with nothing in it says nothing the stand-in does not already say.
  if (!look.texture && !waves.length && !look.start && !look.end) return null;
  return look;
}

/**
 * What the weapons pack says a Force beam looks like. Called once, when the weapons catalogue has
 * been read; the catalogue and the first world's load race each other, so this both keeps the look
 * for the next world and gives it to a pool that is already up (a texture is not part of a program's
 * key, so nothing compiles on the swap).
 */
export function setForceBeamLook(raw: unknown, url: (file: string) => string): void {
  const look = readBeamLook(raw);
  known = look;
  knownUrl = url;
  const pool = current;
  if (!pool || !look?.texture) return;
  void new THREE.TextureLoader()
    .loadAsync(url(look.texture))
    .then((t) => {
      // `adopt` waits for the look's own particles before it takes the look, and disposes the
      // picture itself if the world went while it waited.
      if (current === pool) void pool.adopt(look, t);
      else t.dispose();
    })
    .catch(() => {});
}

/** What the world hands over when it builds the pool: what the pool needs, and nothing of the world's shape. */
export interface ForceLightningHost {
  readonly scene: THREE.Scene;
  readonly physics: Physics;
  readonly weaponFx: ParticleEffects;
  readonly renderer: THREE.WebGLRenderer | null;
  readonly npcDeps: { effects?: { flash(at: THREE.Vector3, colour: number, intensity: number, distance: number, seconds: number): void } | null };
  forgetMaterials(materials: Iterable<THREE.Material>): void;
}

/**
 * Build the world's beams and put them in its scene, hidden. Called from the world's load-time
 * warm-up list, before the warm-up itself, so every material is compiled behind the loading screen.
 * A load abandoned part way through (`stillWanted` gone false) leaves nothing behind.
 */
export async function loadForceLightning(host: ForceLightningHost, stillWanted: () => boolean): Promise<void> {
  // The console hook answers in every world, including one whose pack has no Force effects at all.
  installForceLightningDebug();
  const deps: ForceLightningDeps = {
    scene: host.scene,
    physics: host.physics,
    particles: host.weaponFx,
    renderer: host.renderer,
    flash: (at, colour, intensity, distance, seconds) => host.npcDeps.effects?.flash(at, colour, intensity, distance, seconds),
    url: (file) => knownUrl?.(file) ?? `${import.meta.env.BASE_URL}assets-private/weapons/${file}`,
    stillWanted,
  };
  const built = await ForceBeams.build(deps, known);
  if (!built) return;
  if (!stillWanted()) {
    built.dispose((m) => host.forgetMaterials(m));
    return;
  }
  dropForceLightning(host);
  current = built;
  host.scene.add(built.group);
  console.info(`force: ${built.status}`);
}

/** The beams taken out of the world for good: their materials forgotten (both registers are strong), then freed. */
export function dropForceLightning(host: ForceLightningHost): void {
  const pool = current;
  if (!pool) return;
  current = null;
  host.scene.remove(pool.group);
  pool.dispose((m) => host.forgetMaterials(m));
}

/** One frame of every beam: the flicker, the flip-book and the fade. Called once a frame by the world. */
export function stepForceLightning(dt: number): void {
  current?.step(dt);
}

/** Hold a beam this frame; false when there is no pool or every beam is busy. */
export function holdForceBeam(req: ForceBeamHold): boolean {
  return current?.hold(req) ?? false;
}

/**
 * Let go: the beam fades out rather than being cut. This is the only way a caller ever lets go, and
 * it is enough for every case the pool has: a kit that is disposed (a class change, a world going
 * away) calls it by hand, and a holder that simply stops asking -- a Jedi who dies, or one whose
 * panel takes the screen -- is let go by the step itself, which fades any beam that went a frame
 * without being asked for. There is deliberately no "release everything" call: nothing could name a
 * moment for it that the two above do not already cover, and an exported hook nothing calls reads as
 * wired when it is not.
 */
export function releaseForceBeam(owner: object): void {
  current?.release(owner);
}

/** One bolt that lives its own seconds and is held by nobody: a single zap, and what the console fires. */
export function flashForceBeam(style: ForceBeamStyle, from: THREE.Vector3, dir: THREE.Vector3, reach: number, seconds: number, to: THREE.Vector3 | null = null, frame: BoltFrame | null = null, exclude?: RAPIER.RigidBody): boolean {
  return current?.flash(style, from, dir, reach, seconds, to, frame, exclude) ?? false;
}

/**
 * `__debug.forceLightning()` says what the world's beams are and where their picture came from;
 * `__debug.forceLightning({ width: 0.3 })` (and every other name in FORCE_LIGHTNING) moves a number
 * live, the two that are spent when the pool is built being answered with `atNextWorld`;
 * `{ test: true, at: [x, y, z], dir: [x, y, z] }` fires one where you say, which is how lightning at
 * a wall is looked at without a Jedi. Nothing here ever compiles.
 *
 * The hook lives in this file rather than beside the rest in the game's own debug block, so that
 * everything about the beams is in one place, and it is put back on every world load, since the game
 * makes its `__debug` in one go at startup and that would drop a hook installed before it. This is
 * `installNebulaDebug`'s shape exactly.
 */
const forceLightningHook = (opts?: Partial<ForceLightningTune> & { test?: boolean; at?: [number, number, number]; dir?: [number, number, number]; style?: ForceBeamStyle; seconds?: number }): Record<string, unknown> | string => {
  const later: string[] = [];
  if (opts) {
    for (const [key, value] of Object.entries(opts)) {
      if (!(key in FORCE_LIGHTNING) || typeof value !== typeof (FORCE_LIGHTNING as unknown as Record<string, unknown>)[key]) continue;
      (FORCE_LIGHTNING as unknown as Record<string, unknown>)[key] = value;
      if (BUILD_ONLY_KEYS.includes(key)) later.push(key);
    }
  }
  const pool = current;
  if (!pool) {
    const answer = 'no Force beams here: they are built with the world, so a world has to be loaded';
    return later.length ? `${answer} (${later.join(', ')} will be spent when one is)` : answer;
  }
  const report = pool.report();
  if (opts?.test) {
    const at = opts.at ?? [0, 0, 0];
    const dir = opts.dir ?? [0, 0, -1];
    const fired = flashForceBeam(opts.style ?? 'lightning', new THREE.Vector3(at[0], at[1], at[2]), new THREE.Vector3(dir[0], dir[1], dir[2]), 26, opts.seconds ?? 0.6);
    report.test = fired ? 'one fired from the point given (the default is the world origin, looking down -Z)' : 'every beam was busy';
  }
  report.tune = { ...FORCE_LIGHTNING };
  if (later.length) report.atNextWorld = later.join(', ');
  return report;
};

export function installForceLightningDebug(): void {
  if (typeof window === 'undefined') return;
  const holder = window as unknown as { __debug?: Record<string, unknown> };
  const debug = (holder.__debug ??= {});
  if (debug.forceLightning !== forceLightningHook) debug.forceLightning = forceLightningHook;
}

installForceLightningDebug();
