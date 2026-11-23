// The air's four tables on the card (the GPU port's pass 2, wave 1, the design's 2.1 and 2.2), in three's shading
// language: the transmittance (256 by 64) and the multiple scattering (32 by 32), drawn again only when the record moves;
// the sky view (192 by 108) and the haze volume (32 by 32 by 32, out to 24 km, on compute), every frame. The readers the
// drawers build their graphs with (`airApi.ts`'s `AirTables`) sample them.
//
// The sums are the twin's (`airTwin.ts`) at the card's sizes and step counts: Hillaire's 2020 sky, its transmittance in
// Bruneton's 2017 mapping, as the MIT ports the design names carry it (pmndrs/sky, Dennis Smolek; webgpu-sky-atmosphere,
// Lukas Herzberger: CREDITS.md), written here from the method.
//
// WebGPU only: nothing here is loaded on the WebGL path (the world imports this module only with the switch at WebGPU).
// Every number a frame writes goes into a vector or a matrix a uniform node holds by reference (the volumetrics'
// lesson: a double written into a uniform's `value` is a number made each write), and nothing is made per frame.
import * as THREE from 'three';
import { NodeMaterial, Storage3DTexture } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { chainMaterial, chainMesh } from '../../core/gpu/gpuChain.ts';
import { FX_CAMERA } from '../../core/fx/pass.ts';
import { AIR, AIR_SIZES, HAZE_REACH_M, type AirNode, type AirNodes, type AirTables } from './airApi.ts';
import { AIR_FIELD_COUNT, F, copyRecord, newAirRecord, recordMoved, recordWords, type AirRecord } from './airParams.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { Fn, If, Loop, abs, acos, asin, atan, clamp, cos, exp, float, instanceIndex, int, ivec3, max, min, normalize, renderGroup, select, sin, sqrt, storageTexture3D, texture, texture3D, uniform, uv, vec2, vec3, vec4 } = TSL as Any;

/** The card's step counts (the twin's are `TWIN_STEPS`). */
export const TABLE_STEPS = {
  /** Along a ray to the top of the air, a transmittance texel. */
  transmittance: 40,
  /** The multiple scattering's sphere of directions, and the steps along each. */
  msDirs: 64,
  ms: 20,
  /** Along a view ray, a sky-view texel. */
  skyView: 30,
  /** Sub-steps between two of the haze volume's slices. */
  hazeSub: 2,
} as const;

/** The record's changes smaller than this share of a number draw nothing again (the slow tables). */
export const REBUILD_SHARE = 1e-4;

/**
 * The sky and light fix round (maker L; the owner's "at night I can see steps to the haze"): the sky view's and the haze
 * volume's light are stored times this in their half floats and read back times its inverse. A moonlit sky is about 1e-7 in
 * the scene's units, under a half float's smallest normal (6.1e-5), where only its subnormals' steps of 2^-24 remain: read back
 * at Tatooine's night the sky view held eight values in all (nought and seven steps of 6e-8), and the eye's 2^16 made each a
 * band several levels apart on the screen. Times 2^10 the same night stands at 6e-5 to 4e-4 with ten bits of its own; the
 * brightest the day reaches (the sky by a dusk sun through a 5 km haze at the glow's highest dial, about 50 in the twin) stands
 * at 51,200, under the half float's 65,504, and every store is held to `AIR_STORE_MOST` besides. Not a dial: a store's
 * precision, which nothing of the picture asks to move.
 */
export const AIR_STORE = 1024;
export const AIR_STORE_MOST = 65000;

const PI = Math.PI;
const GOLDEN = PI * (3 - Math.sqrt(5));

/**
 * The air's tables, made once a session on WebGPU (`makeAirTables`): its uniform objects (written in place), its four
 * targets, its five graphs, and the record it last drew the slow tables from.
 */
class Tables implements AirTables {
  readonly transmittance: THREE.Texture;
  readonly multiScatter: THREE.Texture;
  readonly skyView: THREE.Texture;
  readonly haze: THREE.Texture;
  readonly nodes: AirNodes;
  ready = false;
  /** The record the slow tables were last drawn from, and how often and why. */
  private readonly built: AirRecord = newAirRecord();
  private builtOnce = false;
  rebuilds = 0;
  lastRebuildFrame = -1;
  lastRebuildWhy = 'not yet';
  frames = 0;

  // The uniforms' own objects, written in place.
  private readonly u0 = new THREE.Vector4(); // bottom, top, rayleigh height, mie height
  private readonly u1 = new THREE.Vector4(); // rayleigh r, g, b, mie scattering
  private readonly u2 = new THREE.Vector4(); // ozone r, g, b, mie absorption
  private readonly u3 = new THREE.Vector4(); // ozone centre, ozone half width, mie g, sun radius
  private readonly u4 = new THREE.Vector4(); // ground r, g, b, 0
  /** Pass 2, wave 4a: the haze's colour, each channel's share of the Mie scattering (1, 1, 1 a grey haze). */
  private readonly u5 = new THREE.Vector3(1, 1, 1);
  /** heightKm, overcast, the sun's azimuth as (cx, cz). */
  private readonly uView = new THREE.Vector4(0.5, 0, 1, 0);
  private readonly uSun = new THREE.Vector3(0, 1, 0);
  private readonly uSun2 = new THREE.Vector3(0, 1, 0);
  private readonly uMoon = new THREE.Vector3(0, -1, 0);
  private readonly uSunTop = new THREE.Vector3(1, 1, 1);
  private readonly uSun2Top = new THREE.Vector3(0, 0, 0);
  private readonly uMoonTop = new THREE.Vector3(0, 0, 0);
  private readonly uGain = new THREE.Vector3(1, 1, 1);
  private readonly uSunRadius = new THREE.Vector2(0.0047, 0);
  /** The frame camera's turn alone (no place: nothing measured from the world's middle reaches the card), and its projection's inverse. */
  private readonly camTurn = new THREE.Matrix4();
  private readonly projInv = new THREE.Matrix4();
  private readonly zero = new THREE.Vector3(0, 0, 0);
  private readonly one = new THREE.Vector3(1, 1, 1);

  private readonly tTarget: THREE.RenderTarget;
  private readonly msTarget: THREE.RenderTarget;
  private readonly svTarget: THREE.RenderTarget;
  private readonly volume: Storage3DTexture;
  readonly tMesh: THREE.Mesh;
  readonly msMesh: THREE.Mesh;
  readonly svMesh: THREE.Mesh;
  readonly hazeNode: Any;
  private readonly renderer: Any;
  /** The record the tables are made from: the twin's blended one, read by reference. */
  private record: AirRecord;

  constructor(renderer: Any, record: AirRecord) {
    this.renderer = renderer;
    this.record = record;
    const half = (w: number, h: number): THREE.RenderTarget => {
      const t = new THREE.RenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false });
      t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter;
      t.texture.wrapS = t.texture.wrapT = THREE.ClampToEdgeWrapping;
      t.texture.generateMipmaps = false;
      return t;
    };
    this.tTarget = half(AIR_SIZES.transmittance.width, AIR_SIZES.transmittance.height);
    this.msTarget = half(AIR_SIZES.multiScatter.width, AIR_SIZES.multiScatter.height);
    this.svTarget = half(AIR_SIZES.skyView.width, AIR_SIZES.skyView.height);
    this.tTarget.texture.name = 'air-transmittance';
    this.msTarget.texture.name = 'air-multi-scattering';
    this.svTarget.texture.name = 'air-sky-view';
    const vol = new Storage3DTexture(AIR_SIZES.haze.width, AIR_SIZES.haze.height, AIR_SIZES.haze.depth);
    vol.type = THREE.HalfFloatType;
    vol.format = THREE.RGBAFormat;
    vol.minFilter = vol.magFilter = THREE.LinearFilter;
    vol.wrapS = vol.wrapT = (vol as Any).wrapR = THREE.ClampToEdgeWrapping;
    vol.generateMipmaps = false;
    vol.name = 'air-haze';
    this.volume = vol;
    this.transmittance = this.tTarget.texture;
    this.multiScatter = this.msTarget.texture;
    this.skyView = this.svTarget.texture;
    this.haze = vol;

    const g = makeGraphs(this);
    this.nodes = g.nodes;
    this.tMesh = chainMesh(g.transmittance);
    this.msMesh = chainMesh(g.multiScatter);
    this.svMesh = chainMesh(g.skyView);
    this.hazeNode = g.haze;
    this.reads = g.reads;
    this.writeRecord();
  }

  /** The graphs' readers (built once, with the tables' own nodes). */
  private readonly reads: GraphReads;

  /** The record the tables follow (the twin's blended record): read by reference, compared each frame. */
  follow(record: AirRecord): void {
    this.record = record;
  }

  // ---------------------------------------------------------------- the readers (the drawers')

  skyRadiance(dir: AirNode): AirNode {
    return this.reads.skyRadiance(dir);
  }

  transmittanceToSpace(dir: AirNode): AirNode {
    return this.reads.transmittanceToSpace(dir);
  }

  hazeAt(ndc: AirNode, distanceM: AirNode): AirNode {
    return this.reads.hazeAt(ndc, distanceM);
  }

  // ---------------------------------------------------------------- the frame

  /** The record's numbers into the uniforms' vectors. */
  private writeRecord(): void {
    const r = this.record;
    this.u0.set(r[F.bottom], r[F.top], r[F.rayH], r[F.mieH]);
    this.u1.set(r[F.rayR], r[F.rayG], r[F.rayB], r[F.mieS]);
    this.u2.set(r[F.ozR], r[F.ozG], r[F.ozB], r[F.mieA]);
    this.u3.set(r[F.ozC], r[F.ozW], r[F.mieG], r[F.sunRadius]);
    this.u4.set(r[F.groundR], r[F.groundG], r[F.groundB], 0);
    this.u5.set(r[F.mieTintR], r[F.mieTintG], r[F.mieTintB]);
  }

  /** `AIR.frame`'s numbers into the frame's uniforms' vectors. */
  private writeFrame(): void {
    const f = AIR.frame;
    this.uSun.copy(f.sunDir);
    this.uSun2.copy(f.sun2Dir);
    this.uMoon.copy(f.moonDir);
    this.uSunTop.set(f.sunTop.r, f.sunTop.g, f.sunTop.b);
    if (f.sun2) this.uSun2Top.set(f.sun2Top.r, f.sun2Top.g, f.sun2Top.b);
    else this.uSun2Top.set(0, 0, 0);
    this.uMoonTop.set(f.moonTop.r, f.moonTop.g, f.moonTop.b);
    this.uGain.copy(f.gain);
    const sx = f.sunDir.x;
    const sz = f.sunDir.z;
    const h = Math.sqrt(sx * sx + sz * sz);
    this.uView.set(f.heightKm > 0.001 ? f.heightKm : 0.001, f.overcast, h > 1e-9 ? sx / h : 1, h > 1e-9 ? sz / h : 0);
    this.uSunRadius.x = f.sunRadius;
  }

  frame(camera: THREE.PerspectiveCamera): void {
    const r = this.renderer;
    this.frames++;
    if (!this.builtOnce || recordMoved(this.built, this.record, REBUILD_SHARE)) {
      this.lastRebuildWhy = this.builtOnce ? 'the record moved (the weather or a dial)' : 'first frame';
      copyRecord(this.record, this.built);
      this.builtOnce = true;
      this.writeRecord();
      this.writeFrame();
      const prev = r.getRenderTarget();
      try {
        r.setRenderTarget(this.tTarget);
        r.render(this.tMesh, FX_CAMERA);
        r.setRenderTarget(this.msTarget);
        r.render(this.msMesh, FX_CAMERA);
      } finally {
        r.setRenderTarget(prev);
      }
      this.rebuilds++;
      this.lastRebuildFrame = this.frames;
    } else this.writeFrame();
    this.camTurn.compose(this.zero, camera.quaternion, this.one);
    this.projInv.copy(camera.projectionMatrixInverse);
    const prev = r.getRenderTarget();
    try {
      r.setRenderTarget(this.svTarget);
      r.render(this.svMesh, FX_CAMERA);
    } finally {
      r.setRenderTarget(prev);
    }
    r.compute(this.hazeNode);
    this.ready = true;
  }

  /**
   * Every graph built behind the loading screen: the three passes compiled against their own targets and the compute's
   * pipeline made, then one frame drawn, so nothing of the air is built in play.
   */
  async warm(camera: THREE.PerspectiveCamera): Promise<void> {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const jobs: Promise<unknown>[] = [];
    try {
      for (const [t, m] of [
        [this.tTarget, this.tMesh],
        [this.msTarget, this.msMesh],
        [this.svTarget, this.svMesh],
      ] as const) {
        r.setRenderTarget(t);
        jobs.push(Promise.resolve(r.compileAsync(m, FX_CAMERA)).catch(() => {}));
      }
    } finally {
      r.setRenderTarget(prev);
    }
    if (typeof r.compileComputeAsync === 'function') jobs.push(Promise.resolve(r.compileComputeAsync(this.hazeNode)).catch(() => {}));
    await Promise.all(jobs);
    this.frame(camera);
  }

  /**
   * The three drawn tables read back as floats (the proof's: the twin against the card's tables, `airProbe.js`), with the
   * record they were drawn from and the frame's lights and height in force. Not for play: it waits on the card.
   */
  async readBack(): Promise<{ record: number[]; view: number[]; sun: number[]; sun2: number[]; moon: number[]; sunTop: number[]; sun2Top: number[]; moonTop: number[]; gain: number[]; transmittance: Float32Array; multiScatter: Float32Array; skyView: Float32Array }> {
    const r = this.renderer;
    const read = async (t: THREE.RenderTarget): Promise<Float32Array> => {
      const raw = (await r.readRenderTargetPixelsAsync(t, 0, 0, t.width, t.height)) as ArrayLike<number>;
      const out = new Float32Array(t.width * t.height * 4);
      const half = raw instanceof Uint16Array;
      for (let i = 0; i < out.length; i++) out[i] = half ? THREE.DataUtils.fromHalfFloat(raw[i]) : raw[i];
      return out;
    };
    return {
      record: Array.from(this.built),
      view: this.uView.toArray(),
      sun: this.uSun.toArray(),
      sun2: this.uSun2.toArray(),
      moon: this.uMoon.toArray(),
      sunTop: this.uSunTop.toArray(),
      sun2Top: this.uSun2Top.toArray(),
      moonTop: this.uMoonTop.toArray(),
      gain: this.uGain.toArray(),
      transmittance: await read(this.tTarget),
      multiScatter: await read(this.msTarget),
      // The light back in the scene's units (the fix round's `AIR_STORE`).
      skyView: (await read(this.svTarget)).map((v, i) => ((i & 3) === 3 ? v : v / AIR_STORE)),
    };
  }

  /** The haze volume's probe: a float target of its 32 slices laid down one under another and the draw that copies them (the proof's alone, made at its first ask). */
  private hazeProbe: { target: THREE.RenderTarget; mesh: THREE.Mesh } | null = null;

  /**
   * The haze volume read back as floats (the proof's, the wave's fixer: `A:\swg3js\port\scratch\p2w1-fixer\hazeProbe.js`
   * holds it against the twin's direct sums along each texel's ray), with the camera turn, the projection's inverse and the
   * frame's lights it was computed with. Its 32 slices are laid one under another in a 32 by 1,024 float target, each texel
   * fetched at its centre, so texel (x, y, slice) is row `slice · 32 + y` of the copy as `uv()` counts it. Its one draw is
   * made the first time it is asked (`compileAsync` before it draws, so no frame meets it unbuilt) and never in play.
   */
  async readHaze(): Promise<{ record: number[]; camTurn: number[]; projInv: number[]; view: number[]; sun: number[]; sun2: number[]; moon: number[]; sunTop: number[]; sun2Top: number[]; moonTop: number[]; gain: number[]; width: number; height: number; depth: number; volume: Float32Array }> {
    const r = this.renderer;
    const W = AIR_SIZES.haze.width;
    const H = AIR_SIZES.haze.height;
    const D = AIR_SIZES.haze.depth;
    if (!this.hazeProbe) {
      const target = new THREE.RenderTarget(W, H * D, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false });
      target.texture.minFilter = target.texture.magFilter = THREE.NearestFilter;
      target.texture.generateMipmaps = false;
      const m = chainMaterial('air-haze-probe');
      const vol = this.volume;
      m.fragmentNode = Fn(() => {
        const at = uv();
        const x = at.x.mul(W).floor().toVar('airHpX');
        const y = at.y.mul(H * D).floor().toVar('airHpY');
        const slice = y.div(H).floor().toVar('airHpS');
        const iy = y.sub(slice.mul(H)).toVar('airHpIy');
        return texture3D(vol, vec3(x.add(0.5).div(W), iy.add(0.5).div(H), slice.add(0.5).div(D))).level(0);
      })();
      const mesh = chainMesh(m);
      const prev = r.getRenderTarget();
      try {
        r.setRenderTarget(target);
        await Promise.resolve(r.compileAsync(mesh, FX_CAMERA)).catch(() => {});
      } finally {
        r.setRenderTarget(prev);
      }
      this.hazeProbe = { target, mesh };
    }
    const p = this.hazeProbe;
    const words = {
      record: Array.from(this.built),
      camTurn: Array.from(this.camTurn.elements),
      projInv: Array.from(this.projInv.elements),
      view: this.uView.toArray(),
      sun: this.uSun.toArray(),
      sun2: this.uSun2.toArray(),
      moon: this.uMoon.toArray(),
      sunTop: this.uSunTop.toArray(),
      sun2Top: this.uSun2Top.toArray(),
      moonTop: this.uMoonTop.toArray(),
      gain: this.uGain.toArray(),
    };
    const prev = r.getRenderTarget();
    try {
      r.setRenderTarget(p.target);
      r.render(p.mesh, FX_CAMERA);
    } finally {
      r.setRenderTarget(prev);
    }
    const raw = (await r.readRenderTargetPixelsAsync(p.target, 0, 0, W, H * D)) as ArrayLike<number>;
    const volume = new Float32Array(W * H * D * 4);
    const half = raw instanceof Uint16Array;
    for (let i = 0; i < volume.length; i++) volume[i] = half ? THREE.DataUtils.fromHalfFloat(raw[i]) : raw[i];
    // The light back in the scene's units (the fix round's `AIR_STORE`); what gets through is stored as it is.
    for (let i = 0; i < volume.length; i += 4) {
      volume[i] /= AIR_STORE;
      volume[i + 1] /= AIR_STORE;
      volume[i + 2] /= AIR_STORE;
    }
    return { ...words, width: W, height: H, depth: D, volume };
  }

  /**
   * Each piece drawn `n` times on its own and the card waited out after each run (the proof's cost, `airProbe.js`): the
   * wall milliseconds a draw of the transmittance, the multiple scattering, the sky view and the haze volume, the encoding
   * on this thread and the card's work together, so an upper bound on the card's own time. Not for play.
   */
  async bench(n = 200): Promise<Record<string, number>> {
    const r = this.renderer;
    const device = r.backend?.device;
    const idle = async (): Promise<void> => {
      if (device?.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
    };
    const prev = r.getRenderTarget();
    const out: Record<string, number> = {};
    try {
      for (const [name, t, m] of [
        ['transmittance', this.tTarget, this.tMesh],
        ['multiScatter', this.msTarget, this.msMesh],
        ['skyView', this.svTarget, this.svMesh],
      ] as const) {
        await idle();
        const t0 = performance.now();
        for (let i = 0; i < n; i++) {
          r.setRenderTarget(t);
          r.render(m, FX_CAMERA);
        }
        await idle();
        out[name] = (performance.now() - t0) / n;
      }
      r.setRenderTarget(prev);
      await idle();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) r.compute(this.hazeNode);
      await idle();
      out.haze = (performance.now() - t0) / n;
      await idle();
      const t1 = performance.now();
      for (let i = 0; i < n; i++) {
        r.setRenderTarget(null);
        r.setRenderTarget(prev);
      }
      await idle();
      out.empty = (performance.now() - t1) / n;
    } finally {
      r.setRenderTarget(prev);
    }
    return out;
  }

  report(): Record<string, unknown> {
    return {
      ready: this.ready,
      sizes: AIR_SIZES,
      hazeReachM: HAZE_REACH_M,
      steps: TABLE_STEPS,
      rebuilds: this.rebuilds,
      lastRebuild: { frame: this.lastRebuildFrame, framesAgo: this.lastRebuildFrame < 0 ? null : this.frames - this.lastRebuildFrame, why: this.lastRebuildWhy },
      frames: this.frames,
      record: recordWords(this.built),
    };
  }

  /** The uniform objects, for the graphs (built once). */
  get u(): { u0: THREE.Vector4; u1: THREE.Vector4; u2: THREE.Vector4; u3: THREE.Vector4; u4: THREE.Vector4; u5: THREE.Vector3; view: THREE.Vector4; sun: THREE.Vector3; sun2: THREE.Vector3; moon: THREE.Vector3; sunTop: THREE.Vector3; sun2Top: THREE.Vector3; moonTop: THREE.Vector3; gain: THREE.Vector3; sunRadius: THREE.Vector2; camTurn: THREE.Matrix4; projInv: THREE.Matrix4; volume: Storage3DTexture } {
    return { u0: this.u0, u1: this.u1, u2: this.u2, u3: this.u3, u4: this.u4, u5: this.u5, view: this.uView, sun: this.uSun, sun2: this.uSun2, moon: this.uMoon, sunTop: this.uSunTop, sun2Top: this.uSun2Top, moonTop: this.uMoonTop, gain: this.uGain, sunRadius: this.uSunRadius, camTurn: this.camTurn, projInv: this.projInv, volume: this.volume };
  }

  /** The targets' textures, for the graphs. */
  get targets(): { t: THREE.Texture; ms: THREE.Texture; sv: THREE.Texture } {
    return { t: this.tTarget.texture, ms: this.msTarget.texture, sv: this.svTarget.texture };
  }
}

interface GraphReads {
  skyRadiance(dir: AirNode): AirNode;
  transmittanceToSpace(dir: AirNode): AirNode;
  hazeAt(ndc: AirNode, distanceM: AirNode): AirNode;
}

/** The node graphs: the four passes and the readers, over the tables' uniform objects and targets. */
function makeGraphs(t: Tables): { transmittance: NodeMaterial; multiScatter: NodeMaterial; skyView: NodeMaterial; haze: Any; nodes: AirNodes; reads: GraphReads } {
  const U = t.u;
  const T = t.targets;
  // Every number in the render group, read once a render (and at every compute dispatch, which refreshes all its
  // bindings): three refreshes an object-group uniform only at a full refresh of the draw, while these are written in
  // place, so in the object group the card read the record as nought (every table blank: webgpu.md).
  const live = (v: unknown): Any => uniform(v).setGroup(renderGroup);
  const u0 = live(U.u0);
  const u1 = live(U.u1);
  const u2 = live(U.u2);
  const u3 = live(U.u3);
  const u4 = live(U.u4);
  // Pass 2, wave 4a: the haze's colour (each channel's share of the Mie scattering; its extinction stays grey).
  const mieTint = live(U.u5);
  const view = live(U.view);
  const sunDir = live(U.sun);
  const sun2Dir = live(U.sun2);
  const moonDir = live(U.moon);
  const sunTop = live(U.sunTop);
  const sun2Top = live(U.sun2Top);
  const moonTop = live(U.moonTop);
  const gain = live(U.gain);
  const sunRadius = live(U.sunRadius);
  const camTurn = live(U.camTurn);
  const projInv = live(U.projInv);

  const bottom = u0.x;
  const top = u0.y;
  const rayH = u0.z;
  const mieH = u0.w;
  const rayS = u1.xyz;
  const mieS = u1.w;
  const ozA = u2.xyz;
  const mieA = u2.w;
  const ozC = u3.x;
  const ozW = u3.y;
  const mieG = u3.z;
  const ground = u4.xyz;
  const heightKm = view.x;

  const TW = AIR_SIZES.transmittance.width;
  const TH = AIR_SIZES.transmittance.height;
  const MW = AIR_SIZES.multiScatter.width;
  const MH = AIR_SIZES.multiScatter.height;
  const SW = AIR_SIZES.skyView.width;
  const SH = AIR_SIZES.skyView.height;

  // ---------------------------------------------------------------- the medium (the twin's `densities`, `rayLength`)
  const densities = (h: Any): Any => {
    const hh = max(h, 0);
    return vec3(exp(hh.negate().div(rayH)), exp(hh.negate().div(mieH)), max(float(0), float(1).sub(abs(h.sub(ozC)).div(ozW))));
  };
  const extinction = (d: Any): Any => rayS.mul(d.x).add(vec3(mieS.add(mieA).mul(d.y))).add(ozA.mul(d.z));
  const hitsGround = (r: Any, mu: Any): Any => mu.lessThan(0).and(r.mul(r).mul(mu.mul(mu).sub(1)).add(bottom.mul(bottom)).greaterThanEqual(0));
  const toTop = (r: Any, mu: Any): Any => max(float(0), r.negate().mul(mu).add(sqrt(max(float(0), r.mul(r).mul(mu.mul(mu).sub(1)).add(top.mul(top))))));
  const toGround = (r: Any, mu: Any): Any => max(float(0), r.negate().mul(mu).sub(sqrt(max(float(0), r.mul(r).mul(mu.mul(mu).sub(1)).add(bottom.mul(bottom))))));
  const rayLength = (r: Any, mu: Any): Any => select(hitsGround(r, mu), toGround(r, mu), toTop(r, mu));
  const unitToTexel = (x: Any, size: number): Any => float(0.5 / size).add(x.mul(1 - 1 / size));
  const texelToUnit = (u: Any, size: number): Any => u.sub(0.5 / size).div(1 - 1 / size);

  // Bruneton's mapping (`airApi.ts`'s `transmittanceUv`).
  const transmittanceUv = (r: Any, mu: Any): Any => {
    const H = sqrt(top.mul(top).sub(bottom.mul(bottom)));
    const rr = clamp(r, bottom, top);
    const rho = sqrt(max(float(0), rr.mul(rr).sub(bottom.mul(bottom))));
    const d = max(float(0), rr.negate().mul(mu).add(sqrt(max(float(0), rr.mul(rr).mul(mu.mul(mu).sub(1)).add(top.mul(top))))));
    const dMin = top.sub(rr);
    const dMax = rho.add(H);
    const xMu = clamp(d.sub(dMin).div(max(dMax.sub(dMin), 1e-6)), 0, 1);
    const xR = clamp(rho.div(H), 0, 1);
    return vec2(unitToTexel(xMu, TW), unitToTexel(xR, TH));
  };
  const transmittanceTo = (r: Any, mu: Any): Any => select(hitsGround(r, mu), vec3(0), texture(T.t, transmittanceUv(r, mu)).level(0).rgb);
  const msUv = (r: Any, muS: Any): Any => vec2(unitToTexel(clamp(muS.mul(0.5).add(0.5), 0, 1), MW), unitToTexel(clamp(r.sub(bottom).div(top.sub(bottom)), 0, 1), MH));
  const psiAt = (r: Any, muS: Any): Any => texture(T.ms, msUv(r, muS)).level(0).rgb;
  const rayleighPhase = (c: Any): Any => float(3 / (16 * PI)).mul(c.mul(c).add(1));
  const miePhase = (c: Any): Any => {
    const g2 = mieG.mul(mieG);
    const den = g2.add(1).sub(mieG.mul(c).mul(2));
    return float(3 / (8 * PI)).mul(float(1).sub(g2)).mul(c.mul(c).add(1)).div(g2.add(2).mul(den).mul(sqrt(den)));
  };
  /** A step's own integral of the light it adds through its own extinction (exact for a step's constant medium). */
  const stepIntegral = (sigma: Any, dt: Any): Any => {
    const st = exp(sigma.negate().mul(dt));
    return vec3(
      select(sigma.x.greaterThan(1e-9), float(1).sub(st.x).div(sigma.x), dt),
      select(sigma.y.greaterThan(1e-9), float(1).sub(st.y).div(sigma.y), dt),
      select(sigma.z.greaterThan(1e-9), float(1).sub(st.z).div(sigma.z), dt),
    );
  };

  /**
   * One light's share of a step's source (`viewRadiance`'s inner loop): its transmittance, both phases and its multiple
   * scattering. `sM` the haze's scattering by channel (pass 2, wave 4a: its colour times its scattering, a vec3).
   */
  const lightSource = (px: Any, rr: Any, d: Any, L: Any, Ltop: Any, sR: Any, sM: Any): Any => {
    const muL = px.dot(L).div(rr);
    const c = d.dot(L);
    const tl = transmittanceTo(rr, muL);
    const ps = psiAt(rr, muL);
    return Ltop.mul(tl.mul(sR.mul(rayleighPhase(c)).add(sM.mul(miePhase(c)))).add(ps.mul(sR.add(sM))));
  };

  /**
   * A view ray's light and transmittance from a point (0, r, 0) along a unit world direction `d`, `steps` steps by the square
   * of their place, to the ray's end or `maxT` km: into the two vars handed in.
   */
  const march = (r: Any, d: Any, maxT: Any, steps: number, L: Any, Tr: Any): void => {
    const len = min(rayLength(r, d.y), maxT);
    const prev = float(0).toVar();
    Loop({ start: 0, end: steps, type: 'int', condition: '<' }, ({ i }: Any) => {
      const u = float(i).add(1).div(steps);
      const e1 = len.mul(u).mul(u).toVar('airVE');
      const dt = e1.sub(prev).toVar('airVDt');
      const tm = prev.add(dt.mul(0.5)).toVar('airVTm');
      const p = vec3(d.x.mul(tm), r.add(d.y.mul(tm)), d.z.mul(tm)).toVar('airVP');
      const rr = p.length().toVar('airVR');
      const m = densities(rr.sub(bottom)).toVar('airVM');
      const sR = rayS.mul(m.x).toVar('airVSR');
      const sM = mieTint.mul(mieS.mul(m.y)).toVar('airVSM');
      const sigma = extinction(m).toVar('airVSig');
      const S = lightSource(p, rr, d, sunDir, sunTop, sR, sM).add(lightSource(p, rr, d, sun2Dir, sun2Top, sR, sM)).add(lightSource(p, rr, d, moonDir, moonTop, sR, sM));
      L.addAssign(Tr.mul(S).mul(stepIntegral(sigma, dt)));
      Tr.mulAssign(exp(sigma.negate().mul(dt)));
      prev.assign(e1);
    });
  };

  // ---------------------------------------------------------------- the transmittance (`opticalDepth` at the card's size)
  const tMat = chainMaterial('air-transmittance');
  tMat.fragmentNode = Fn(() => {
    const at = uv();
    const xMu = clamp(texelToUnit(at.x, TW), 0, 1);
    const xR = clamp(texelToUnit(at.y, TH), 0, 1);
    const H = sqrt(top.mul(top).sub(bottom.mul(bottom)));
    const rho = H.mul(xR);
    const r = sqrt(rho.mul(rho).add(bottom.mul(bottom))).toVar('airTR');
    const dMin = top.sub(r);
    const dMax = rho.add(H);
    const dd = dMin.add(xMu.mul(dMax.sub(dMin)));
    const mu = clamp(select(dd.lessThan(1e-6), float(1), H.mul(H).sub(rho.mul(rho)).sub(dd.mul(dd)).div(r.mul(dd).mul(2))), -1, 1).toVar('airTMu');
    const len = toTop(r, mu).toVar('airTLen');
    const depth = vec3(0).toVar('airTDepth');
    const prev = float(0).toVar('airTPrev');
    // Segments laid by the square of their place, each at its middle (the twin's `columnDepths`): even steps would first
    // sample the haze's 1.2 km layer at 1.25 km up and miss a sixth of it.
    Loop({ start: 0, end: TABLE_STEPS.transmittance, type: 'int', condition: '<' }, ({ i }: Any) => {
      const u = float(i).add(1).div(TABLE_STEPS.transmittance);
      const e1 = len.mul(u).mul(u).toVar('airTE');
      const dt = e1.sub(prev).toVar('airTDt');
      const tm = prev.add(dt.mul(0.5)).toVar('airTTm');
      const rr = sqrt(tm.mul(tm).add(r.mul(mu).mul(tm).mul(2)).add(r.mul(r)));
      depth.addAssign(extinction(densities(rr.sub(bottom))).mul(dt));
      prev.assign(e1);
    });
    return vec4(exp(depth.negate()), 1);
  })();

  // ---------------------------------------------------------------- the multiple scattering (`psiOf` at the card's size)
  const msMat = chainMaterial('air-multi-scattering');
  msMat.fragmentNode = Fn(() => {
    const at = uv();
    const muS = clamp(texelToUnit(at.x, MW), 0, 1).mul(2).sub(1).toVar('airMsMuS');
    const r = min(bottom.add(clamp(texelToUnit(at.y, MH), 0, 1).mul(top.sub(bottom))).add(0.001), top.sub(0.001)).toVar('airMsR');
    const L = sqrt(max(float(0), float(1).sub(muS.mul(muS))));
    const sun = vec3(L, muS, 0).toVar('airMsSun');
    const L2 = vec3(0).toVar('airMsL2');
    const fms = vec3(0).toVar('airMsF');
    const n = TABLE_STEPS.msDirs;
    Loop({ start: 0, end: n, type: 'int', condition: '<' }, ({ i }: Any) => {
      const fi = float(i);
      const y = float(1).sub(fi.add(0.5).mul(2 / n));
      const s = sqrt(max(float(0), float(1).sub(y.mul(y))));
      const a = fi.mul(GOLDEN);
      const d = vec3(cos(a).mul(s), y, sin(a).mul(s)).toVar('airMsD');
      const len = rayLength(r, d.y).toVar('airMsLen');
      const Tr = vec3(1).toVar('airMsT');
      const Li = vec3(0).toVar('airMsLi');
      const Fi = vec3(0).toVar('airMsFi');
      const prev = float(0).toVar('airMsPrev');
      Loop({ start: 0, end: TABLE_STEPS.ms, type: 'int', condition: '<', name: 'k' }, ({ k }: Any) => {
        const u = float(k).add(1).div(TABLE_STEPS.ms);
        const e1 = len.mul(u).mul(u).toVar('airME');
        const dt = e1.sub(prev).toVar('airMDt');
        const tm = prev.add(dt.mul(0.5)).toVar('airMTm');
        const p = vec3(d.x.mul(tm), r.add(d.y.mul(tm)), d.z.mul(tm)).toVar('airMP');
        const rr = p.length().toVar('airMR');
        const m = densities(rr.sub(bottom)).toVar('airMM');
        const sigS = rayS.mul(m.x).add(mieTint.mul(mieS.mul(m.y))).toVar('airMSS');
        const sigma = extinction(m).toVar('airMSig');
        const tl = transmittanceTo(rr, p.dot(sun).div(rr)).toVar('airMTl');
        const g = stepIntegral(sigma, dt).toVar('airMG');
        Li.addAssign(Tr.mul(sigS).mul(tl).mul(1 / (4 * PI)).mul(g));
        Fi.addAssign(Tr.mul(sigS).mul(g));
        Tr.mulAssign(exp(sigma.negate().mul(dt)));
        prev.assign(e1);
      });
      // The ground's bounce at the ray's end (Lambert's), where the ray meets it.
      If(hitsGround(r, d.y), () => {
        const gp = vec3(d.x.mul(len), r.add(d.y.mul(len)), d.z.mul(len));
        const gr = gp.length();
        const muG = gp.dot(sun).div(gr);
        If(muG.greaterThan(0), () => {
          Li.addAssign(Tr.mul(ground).mul(transmittanceTo(gr, muG)).mul(muG).mul(1 / PI));
        });
      });
      L2.addAssign(Li);
      fms.addAssign(Fi);
    });
    const inv = 1 / n;
    const f = min(fms.mul(inv), vec3(0.99));
    return vec4(L2.mul(inv).div(vec3(1).sub(f)), 1);
  })();

  // ---------------------------------------------------------------- the sky view (`viewRadiance` at the card's size)
  /** The true horizon's dip below the eye's level at the camera's height (`airApi.ts`'s `horizonDip`). */
  const dipOf = (r: Any): Any => acos(clamp(bottom.div(r), 0, 1));
  const svMat = chainMaterial('air-sky-view');
  svMat.fragmentNode = Fn(() => {
    const at = uv();
    const r = bottom.add(max(heightKm, 0.001)).toVar('airSvR');
    const dip = dipOf(r).toVar('airSvDip');
    const x = clamp(texelToUnit(at.x, SW), 0, 1);
    const y = clamp(texelToUnit(at.y, SH), 0, 1);
    const az = x.mul(x).mul(PI);
    const above = y.lessThanEqual(0.5);
    const ta = float(0.5).sub(y).div(0.5);
    const tb = y.sub(0.5).div(0.5);
    const el = select(above, ta.mul(ta).mul(dip.add(PI / 2)).sub(dip), dip.negate().sub(tb.mul(tb).mul(float(PI / 2).sub(dip)))).toVar('airSvEl');
    // The texel's direction in the frame turned so the sun's azimuth is +X, then into the world's.
    const lx = cos(el).mul(cos(az));
    const lz = cos(el).mul(sin(az));
    const cx = view.z;
    const cz = view.w;
    const d = normalize(vec3(lx.mul(cx).sub(lz.mul(cz)), sin(el), lx.mul(cz).add(lz.mul(cx)))).toVar('airSvD');
    const L = vec3(0).toVar('airSvL');
    const Tr = vec3(1).toVar('airSvT');
    march(r, d, float(1e9), TABLE_STEPS.skyView, L, Tr);
    // Stored times `AIR_STORE` (the fix round: a night's light has bits of its own there), read back times its inverse.
    return vec4(min(L.mul(gain).mul(AIR_STORE), AIR_STORE_MOST), 1);
  })();

  // ---------------------------------------------------------------- the haze volume (on compute)
  const HX = AIR_SIZES.haze.width;
  const HY = AIR_SIZES.haze.height;
  const HZ = AIR_SIZES.haze.depth;
  const reachKm = HAZE_REACH_M / 1000;
  const haze = Fn(() => {
    const idx = instanceIndex;
    const ix = idx.mod(HX);
    const iy = idx.div(HX);
    const ndc = vec2(float(ix).add(0.5).mul(2 / HX).sub(1), float(iy).add(0.5).mul(2 / HY).sub(1));
    const vp = projInv.mul(vec4(ndc, 0.5, 1));
    const vdir = normalize(vp.xyz.div(vp.w));
    const d = normalize(camTurn.mul(vec4(vdir, 0)).xyz).toVar('airHzD');
    const r = bottom.add(max(heightKm, 0.001)).toVar('airHzR');
    const len = rayLength(r, d.y).toVar('airHzLen');
    const L = vec3(0).toVar('airHzL');
    const Tr = vec3(1).toVar('airHzT');
    const prev = float(0).toVar('airHzPrev');
    const sub = TABLE_STEPS.hazeSub;
    Loop({ start: 0, end: HZ, type: 'int', condition: '<' }, ({ i }: Any) => {
      const w = float(i).add(0.5).div(HZ);
      const slice = min(w.mul(w).mul(reachKm), len).toVar('airHzSlice');
      const from = prev.toVar('airHzFrom');
      Loop({ start: 0, end: sub, type: 'int', condition: '<', name: 'k' }, ({ k }: Any) => {
        const e1 = from.add(slice.sub(from).mul(float(k).add(1).div(sub))).toVar('airHE');
        const dt = max(e1.sub(prev), 0).toVar('airHDt');
        const tm = prev.add(dt.mul(0.5)).toVar('airHTm');
        const p = vec3(d.x.mul(tm), r.add(d.y.mul(tm)), d.z.mul(tm)).toVar('airHP');
        const rr = p.length().toVar('airHR');
        const m = densities(rr.sub(bottom)).toVar('airHM');
        const sR = rayS.mul(m.x).toVar('airHSR');
        const sM = mieTint.mul(mieS.mul(m.y)).toVar('airHSM');
        const sigma = extinction(m).toVar('airHSig');
        const S = lightSource(p, rr, d, sunDir, sunTop, sR, sM).add(lightSource(p, rr, d, sun2Dir, sun2Top, sR, sM)).add(lightSource(p, rr, d, moonDir, moonTop, sR, sM));
        L.addAssign(Tr.mul(S).mul(stepIntegral(sigma, dt)));
        Tr.mulAssign(exp(sigma.negate().mul(dt)));
        prev.assign(e1);
      });
      // The light stored times `AIR_STORE` as the sky view's is; what gets through, a share, as it is.
      const store = storageTexture3D(U.volume, ivec3(int(ix), int(iy), i), vec4(min(L.mul(gain).mul(AIR_STORE), AIR_STORE_MOST), Tr.x.add(Tr.y).add(Tr.z).div(3)));
      store.toWriteOnly();
      store.toStack();
    });
  })().compute(HX * HY, [64]);

  // ---------------------------------------------------------------- the readers
  const camR = (): Any => bottom.add(max(heightKm, 0.001));
  const reads: GraphReads = {
    skyRadiance(dir: Any): Any {
      const d = normalize(dir);
      const r = camR();
      const dip = dipOf(r);
      const cx = view.z;
      const cz = view.w;
      const xp = d.x.mul(cx).add(d.z.mul(cz));
      const zp = d.x.mul(cz).negate().add(d.z.mul(cx));
      const az = abs(atan(zp, xp));
      const el = asin(clamp(d.y, -1, 1));
      const fromH = el.add(dip);
      const ya = float(0.5).sub(sqrt(clamp(fromH.div(dip.add(PI / 2)), 0, 1)).mul(0.5));
      const yb = float(0.5).add(sqrt(clamp(fromH.negate().div(max(float(PI / 2).sub(dip), 1e-6)), 0, 1)).mul(0.5));
      const y = select(fromH.greaterThanEqual(0), ya, yb);
      const x = sqrt(clamp(az.div(PI), 0, 1));
      return texture(T.sv, vec2(unitToTexel(x, SW), unitToTexel(y, SH))).level(0).rgb.mul(1 / AIR_STORE);
    },
    transmittanceToSpace(dir: Any): Any {
      const d = normalize(dir);
      return transmittanceTo(camR(), d.y);
    },
    hazeAt(ndc: Any, distanceM: Any): Any {
      const w = sqrt(clamp(distanceM.div(HAZE_REACH_M), 0, 1));
      const h = texture3D(U.volume, vec3(ndc.x.mul(0.5).add(0.5), ndc.y.mul(0.5).add(0.5), w)).level(0);
      return vec4(h.rgb.mul(1 / AIR_STORE), h.a);
    },
  };

  const nodes: AirNodes = { sunDir, sun2Dir, moonDir, sunTop, sun2Top, moonTop, sunRadius: sunRadius.x, heightKm, gain, overcast: view.y };
  return { transmittance: tMat, multiScatter: msMat, skyView: svMat, haze, nodes, reads };
}

/**
 * The air's tables, made once a session on WebGPU and put in `AIR.tables`, following `record` (the twin's blended
 * record, read by reference). Answers the same tables on a second call.
 */
export function makeAirTables(renderer: THREE.WebGLRenderer, record: AirRecord): AirTables & { follow(record: AirRecord): void; warm(camera: THREE.PerspectiveCamera): Promise<void>; bench(n?: number): Promise<Record<string, number>> } {
  const have = AIR.tables as (Tables | null);
  if (have) {
    have.follow(record);
    return have;
  }
  const t = new Tables(renderer as Any, record);
  AIR.tables = t;
  return t;
}

/** How many numbers a record carries, for the report (and a check that the uniforms' packing covers them). */
export const RECORD_PACKED = AIR_FIELD_COUNT;
